-- Done — Supabase schema
--
-- Host project: Pulse (kjlmkjkzbbnzdpvjhkxz). This file is ADDITIVE: it creates
-- new, prefixed objects only and never alters Pulse's `sync_rows` or About
-- Time's `at_*` tables.
--
-- Apply: Supabase Dashboard → SQL Editor → paste this whole file → Run.
-- Idempotent: safe to re-run.
--
-- Before the app will work, one dashboard toggle is required:
--   Authentication → Sign In / Providers → "Allow anonymous sign-ins" = ON.
-- (It is already on for About Time; it is a project-wide setting.)

create extension if not exists pgcrypto;

-- ── Tables ────────────────────────────────────────────────────────────────

-- One room = one table playing one game. `round` is the round in progress.
-- When every player is done, the RPC advances this and clears the flags.
create table if not exists public.dn_rooms (
  id                uuid        primary key default gen_random_uuid(),
  code              text        not null unique,
  title             text        not null default 'Game night',
  round             integer     not null default 1 check (round > 0),
  created_by        uuid        references auth.users (id) on delete set null,
  last_notified_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint dn_rooms_code_format check (code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

-- One row per player per room. This is the realtime table.
create table if not exists public.dn_members (
  id          uuid        primary key default gen_random_uuid(),
  room_id     uuid        not null references public.dn_rooms (id) on delete cascade,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name        text        not null,
  emoji       text        not null default '🙂',
  done        boolean     not null default false,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists dn_members_room on public.dn_members (room_id);

-- Web Push subscriptions, one per device/browser. Delivery is user-based, so
-- the same row works across every room this device joins.
create table if not exists public.dn_push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text        not null unique,
  p256dh      text        not null,
  auth        text        not null,
  created_at  timestamptz not null default now()
);

-- ── Membership helper ─────────────────────────────────────────────────────
-- SECURITY DEFINER so the rooms/members SELECT policies can ask "am I in this
-- room?" without recursing into their own RLS policies.
create or replace function public.dn_is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.dn_members m
    where m.room_id = p_room_id
      and m.user_id = auth.uid()
  );
$$;

-- ── Row-level security ────────────────────────────────────────────────────
alter table public.dn_rooms              enable row level security;
alter table public.dn_members            enable row level security;
alter table public.dn_push_subscriptions enable row level security;

-- Rooms: you can read a room only after you are a member of it.
drop policy if exists dn_rooms_select on public.dn_rooms;
create policy dn_rooms_select on public.dn_rooms
  for select using (public.dn_is_member(id));

-- Members: everyone in the room can see everyone else; you may only edit or
-- remove your own row. Inserts happen exclusively through the RPCs below.
drop policy if exists dn_members_select on public.dn_members;
create policy dn_members_select on public.dn_members
  for select using (public.dn_is_member(room_id));

drop policy if exists dn_members_update on public.dn_members;
create policy dn_members_update on public.dn_members
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.dn_is_member(room_id));

drop policy if exists dn_members_delete on public.dn_members;
create policy dn_members_delete on public.dn_members
  for delete using (user_id = auth.uid());

-- Push subscriptions: private to the device that created them.
drop policy if exists dn_push_select on public.dn_push_subscriptions;
create policy dn_push_select on public.dn_push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists dn_push_insert on public.dn_push_subscriptions;
create policy dn_push_insert on public.dn_push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists dn_push_update on public.dn_push_subscriptions;
create policy dn_push_update on public.dn_push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists dn_push_delete on public.dn_push_subscriptions;
create policy dn_push_delete on public.dn_push_subscriptions
  for delete using (user_id = auth.uid());

-- ── Room codes ────────────────────────────────────────────────────────────
-- Unambiguous alphabet: no I, O, 0 or 1 to mistype across a noisy table.
create or replace function public.dn_generate_code()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32) + 1)::int, 1),
    ''
    order by g
  )
  from generate_series(1, 6) as g;
$$;

-- ── Create a room ─────────────────────────────────────────────────────────
create or replace function public.dn_create_room(
  p_title text,
  p_name  text,
  p_emoji text default '🙂'
)
returns table (room_id uuid, room_code text, room_title text, room_round integer, member_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_code   text;
  v_room   uuid;
  v_member uuid;
  v_try    int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A name is required' using errcode = '22023';
  end if;

  loop
    v_try := v_try + 1;
    v_code := public.dn_generate_code();
    begin
      insert into public.dn_rooms as r (code, title, created_by)
      values (v_code, coalesce(nullif(btrim(p_title), ''), 'Game night'), auth.uid())
      returning r.id into v_room;
      exit;
    exception when unique_violation then
      if v_try >= 8 then
        raise;
      end if;
    end;
  end loop;

  insert into public.dn_members as m (room_id, user_id, name, emoji)
  values (v_room, auth.uid(), left(btrim(p_name), 24), coalesce(nullif(p_emoji, ''), '🙂'))
  returning m.id into v_member;

  return query
    select v_room, r.code, r.title, r.round, v_member
    from public.dn_rooms r
    where r.id = v_room;
end;
$$;

-- ── Join a room by code ───────────────────────────────────────────────────
-- Rejoining with the same device updates your name/emoji instead of creating
-- a duplicate row, and leaves your current done flag alone.
create or replace function public.dn_join_room(
  p_code  text,
  p_name  text,
  p_emoji text default '🙂'
)
returns table (room_id uuid, room_code text, room_title text, room_round integer, member_id uuid)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_room   public.dn_rooms;
  v_member uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A name is required' using errcode = '22023';
  end if;

  select * into v_room from public.dn_rooms r where r.code = v_code;
  if not found then
    raise exception 'No room with that code' using errcode = 'P0002';
  end if;

  insert into public.dn_members as m (room_id, user_id, name, emoji)
  values (v_room.id, auth.uid(), left(btrim(p_name), 24), coalesce(nullif(p_emoji, ''), '🙂'))
  on conflict (room_id, user_id) do update
    set name       = excluded.name,
        emoji      = excluded.emoji,
        updated_at = now()
  returning m.id into v_member;

  return query select v_room.id, v_room.code, v_room.title, v_room.round, v_member;
end;
$$;

-- ── Mark yourself done (and complete the round) ───────────────────────────
-- One transaction: set the caller's flag, count the table, and when everyone
-- is done, advance the round and clear every flag. The row lock on the room
-- serialises two players tapping at the same instant, so the round can only
-- advance once. Returns completed=true exactly once per round.
create or replace function public.dn_set_done(
  p_room_id uuid,
  p_done    boolean
)
returns table (round integer, completed boolean, done_count integer, total_count integer)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_room  public.dn_rooms;
  v_total integer;
  v_done  integer;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  select r.* into v_room
  from public.dn_rooms r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception 'That room has ended' using errcode = 'P0002';
  end if;

  update public.dn_members m
     set done       = coalesce(p_done, false),
         done_at    = case when coalesce(p_done, false) then now() else null end,
         updated_at = now()
   where m.room_id = p_room_id
     and m.user_id = auth.uid();

  if not found then
    raise exception 'You are not in that room' using errcode = '42501';
  end if;

  select count(*) into v_total from public.dn_members m where m.room_id = p_room_id;
  select count(*) into v_done  from public.dn_members m where m.room_id = p_room_id and m.done;

  if coalesce(p_done, false) and v_total > 0 and v_done = v_total then
    update public.dn_rooms r
       set round = r.round + 1
     where r.id = p_room_id
     returning * into v_room;

    update public.dn_members m
       set done = false, done_at = null, updated_at = now()
     where m.room_id = p_room_id;

    return query select v_room.round, true, 0, v_total;
  end if;

  return query select v_room.round, false, v_done, v_total;
end;
$$;

-- ── Leave a room ──────────────────────────────────────────────────────────
-- Removes your row; the room itself is cleaned up when the last player leaves.
create or replace function public.dn_leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.dn_members
  where room_id = p_room_id and user_id = auth.uid();

  if not exists (select 1 from public.dn_members where room_id = p_room_id) then
    delete from public.dn_rooms where id = p_room_id;
  end if;
end;
$$;

-- ── Privileges ────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.dn_rooms              to authenticated;
grant select, insert, update, delete on public.dn_members            to authenticated;
grant select, insert, update, delete on public.dn_push_subscriptions to authenticated;

grant execute on function public.dn_is_member(uuid)                    to authenticated;
grant execute on function public.dn_create_room(text, text, text)      to authenticated;
grant execute on function public.dn_join_room(text, text, text)        to authenticated;
grant execute on function public.dn_set_done(uuid, boolean)            to authenticated;
grant execute on function public.dn_leave_room(uuid)                   to authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────
-- Realtime honours RLS, so subscribers only receive rows for rooms they
-- belong to. FULL identity makes UPDATE/DELETE payloads complete.
alter table public.dn_members replica identity full;
alter table public.dn_rooms   replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dn_members'
  ) then
    alter publication supabase_realtime add table public.dn_members;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dn_rooms'
  ) then
    alter publication supabase_realtime add table public.dn_rooms;
  end if;
end $$;

-- ── Sanity check ──────────────────────────────────────────────────────────
do $$
declare
  v_rls boolean;
begin
  select relrowsecurity into v_rls
  from pg_class where oid = 'public.dn_members'::regclass;
  if v_rls then
    raise notice 'OK: dn_members has row-level security enabled';
  end if;
end $$;
