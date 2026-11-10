# Done — backend

The app uses the **Pulse** Supabase project (`kjlmkjkzbbnzdpvjhkxz`) — the same
project as About Time, with every object prefixed `dn_`. It is additive: nothing
touches `sync_rows` or About Time's `at_*` tables.

## One-time setup (three dashboard steps)

These steps cannot be automated from the repo; there is no service-role key or
Supabase CLI login on this machine.

### 1. Anonymous sign-ins (already on)

Dashboard → **Authentication → Sign In / Providers → Allow anonymous sign-ins = ON**.

It is a project-wide toggle and About Time already needs it. Every device gets
an invisible anonymous account, which is what makes RLS and Realtime safe.

### 2. Run the schema

Dashboard → **SQL Editor** → paste all of `supabase/schema.sql` → **Run**.

Idempotent: safe to re-run. It creates:

| Object | Purpose |
|---|---|
| `dn_rooms` | One row per table/game: `code`, `title`, `round` |
| `dn_members` | One row per player: `name`, `emoji`, `done`, `done_at` |
| `dn_push_subscriptions` | One row per device: `endpoint`, `p256dh`, `auth` |
| `dn_create_room` / `dn_join_room` / `dn_set_done` / `dn_leave_room` | RPCs |
| `dn_is_member` | SECURITY DEFINER helper for RLS |

`dn_set_done` is the heart of it. In one transaction it sets your flag, counts
the table, and when everyone is done it advances `round` and clears every flag —
so the round can only complete once, even if two people tap at the same instant.
It returns `completed = true` exactly once.

### 3. Deploy the push function

Dashboard → **Edge Functions → Deploy new function**:

- **Name:** `notify-round`
- **Code:** paste `supabase/functions/notify-round/index.ts`
- **Verify JWT:** OFF (the function authenticates the caller itself)

The function needs no new secrets. Edge Function secrets are project-wide, so
it reuses the VAPID keys already configured for About Time
(`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). The public key is
already in `js/config.js`.

## How the sound and push work together

```
Phone A (last to tap)                 Supabase                    Phone B
────────────────────                 ────────                    ───────
tap "I'm done" ──▶ dn_set_done
                   round + 1, flags reset
                   ├── Realtime ──────────────────────────────▶ screen updates
                   │                                            round changed
                   │                                            ──▶ chime
                   └── invoke notify-round ── Web Push ───────▶ notification
                                                                (app closed)
```

Every open app detects the round change from its own fetch and plays the chime.
Push is the fallback for a phone in a pocket: the last tapper's app invokes
`notify-round`, which pushes to everyone else's registered devices.

The chime itself is synthesised with Web Audio (`js/sound.js`) — no audio asset,
works offline. Browsers only allow audio after a gesture, which is why every
join/start/done tap unlocks the context.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "The database needs updating" | `schema.sql` has not been run |
| "No room with that code" | Mistyped code, or the last player left and the room was deleted |
| Chime silent on one phone | That phone has not tapped the page since loading; tap once |
| Push not arriving | Notifications blocked, iPhone not on the Home Screen, or `notify-round` not deployed |
| Everyone stuck as "done" | Should not happen — `dn_set_done` clears flags in the same transaction. Re-run the schema if the function is an older version. |
