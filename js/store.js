// Done — data layer.
//
// One interface, two implementations: the Supabase store and an in-memory demo
// store (js/demo.js). The UI never knows which one it is talking to.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EDGE_FUNCTION } from './config.js';

let client = null;

export function supabaseClient() {
  if (!client) {
    if (!window.supabase?.createClient) {
      throw new Error('Supabase client failed to load');
    }
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return client;
}

/**
 * Anonymous sign-in. Invisible to the user: no email, no password, no screen.
 * It exists so row-level security can tell devices apart.
 */
export async function ensureSession() {
  const sb = supabaseClient();
  const { data } = await sb.auth.getSession();
  if (data?.session) return data.session;

  const { data: created, error } = await sb.signInAnonymously();
  if (error) throw error;
  if (!created?.session) throw new Error('Anonymous sign-in returned no session');
  return created.session;
}

export function createRemoteStore() {
  const sb = supabaseClient();
  let channel = null;

  const row = (data) => (Array.isArray(data) ? data[0] : data);

  return {
    async start({ title, name, emoji }) {
      const { data, error } = await sb.rpc('dn_create_room', {
        p_title: title,
        p_name: name,
        p_emoji: emoji,
      });
      if (error) throw error;
      const r = row(data);
      if (!r) throw new Error('Could not create the room');
      return {
        room: { id: r.room_id, code: r.room_code, title: r.room_title, round: r.room_round },
        memberId: r.member_id,
      };
    },

    async join({ code, name, emoji }) {
      const { data, error } = await sb.rpc('dn_join_room', {
        p_code: code,
        p_name: name,
        p_emoji: emoji,
      });
      if (error) throw error;
      const r = row(data);
      if (!r) throw new Error('Could not join the room');
      return {
        room: { id: r.room_id, code: r.room_code, title: r.room_title, round: r.room_round },
        memberId: r.member_id,
      };
    },

    async fetch(roomId) {
      const [roomRes, membersRes] = await Promise.all([
        sb.from('dn_rooms').select('id, code, title, round').eq('id', roomId).maybeSingle(),
        sb.from('dn_members').select('*').eq('room_id', roomId),
      ]);
      if (roomRes.error) throw roomRes.error;
      if (membersRes.error) throw membersRes.error;
      return { room: roomRes.data, members: membersRes.data ?? [] };
    },

    async setDone(roomId, done) {
      const { data, error } = await sb.rpc('dn_set_done', {
        p_room_id: roomId,
        p_done: done,
      });
      if (error) throw error;
      const r = row(data);
      return {
        round: Number(r?.round) || 1,
        completed: Boolean(r?.completed),
        doneCount: Number(r?.done_count) || 0,
        total: Number(r?.total_count) || 0,
      };
    },

    watch(roomId, onChange) {
      this.unwatch();
      channel = sb
        .channel(`dn-${roomId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'dn_members',
            filter: `room_id=eq.${roomId}`,
          },
          onChange,
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'dn_rooms',
            filter: `id=eq.${roomId}`,
          },
          onChange,
        )
        .subscribe();
      return channel;
    },

    unwatch() {
      if (channel) {
        sb.removeChannel(channel);
        channel = null;
      }
    },

    async leave(roomId) {
      const { error } = await sb.rpc('dn_leave_room', { p_room_id: roomId });
      if (error) throw error;
    },

    async saveSubscription({ endpoint, p256dh, auth }) {
      const { data } = await sb.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error('Not signed in');

      const { error } = await sb.from('dn_push_subscriptions').upsert(
        { user_id: userId, endpoint, p256dh, auth },
        { onConflict: 'endpoint' },
      );
      if (error) throw error;
    },

    async notifyRound(roomId) {
      const { error } = await sb.functions.invoke(EDGE_FUNCTION, {
        body: { room_id: roomId },
      });
      if (error) throw error;
    },
  };
}
