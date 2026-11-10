// Done — "everyone's done" push fan-out.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy new function → name it
// `notify-round`, paste this file, and turn OFF "Verify JWT" (the function
// verifies the caller itself, and the anon key is already public).
//
// Secrets: reuse the project-wide VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
// VAPID_SUBJECT already set for About Time. Edge Function secrets are shared
// across every function in the project, so nothing new is needed.
//
// The last player to tap calls this immediately after dn_set_done has advanced
// the round. The function re-reads the truth, throttles rapid repeats, and
// pushes to every other member's registered devices.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@changelinglabs.com';

  if (!supabaseUrl || !anonKey || !serviceKey || !vapidPublic || !vapidPrivate) {
    return json({ error: 'function is missing environment secrets' }, 500);
  }

  // ── Who is calling? ─────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } = await asUser.auth.getUser();
  if (authError || !user) return json({ error: 'unauthorized' }, 401);

  let payloadIn: { room_id?: string };
  try {
    payloadIn = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const roomId = payloadIn.room_id;
  if (!roomId) return json({ error: 'room_id is required' }, 400);

  // RLS scopes both reads to rooms the caller belongs to.
  const [meRes, roomRes] = await Promise.all([
    asUser
      .from('dn_members')
      .select('id')
      .eq('room_id', roomId)
      .eq('user_id', user.id)
      .maybeSingle(),
    asUser
      .from('dn_rooms')
      .select('code, title, round, last_notified_at')
      .eq('id', roomId)
      .maybeSingle(),
  ]);

  if (meRes.error || !meRes.data) return json({ error: 'not a member of that room' }, 403);
  if (roomRes.error || !roomRes.data) return json({ error: 'room not found' }, 404);

  const room = roomRes.data;

  // Two clients can race the last tap plus a retry; one push per 15 seconds.
  if (room.last_notified_at && Date.now() - new Date(room.last_notified_at).getTime() < 15_000) {
    return json({ skipped: 'throttled' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: members } = await admin
    .from('dn_members')
    .select('user_id, name, done')
    .eq('room_id', roomId);

  if (!members) return json({ error: 'room not found' }, 404);

  await admin
    .from('dn_rooms')
    .update({ last_notified_at: new Date().toISOString() })
    .eq('id', roomId);

  const recipientIds = members
    .filter((m) => m.user_id !== user.id)
    .map((m) => m.user_id);

  if (recipientIds.length === 0) return json({ sent: 0, reason: 'nobody else is at the table' });

  const { data: subscriptions } = await admin
    .from('dn_push_subscriptions')
    .select('endpoint, p256dh, auth')
    .in('user_id', recipientIds);

  if (!subscriptions || subscriptions.length === 0) {
    return json({ sent: 0, reason: 'no push subscriptions' });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const message = JSON.stringify({
    title: 'Everyone’s done',
    body: `${room.title} · on to round ${room.round}`,
    tag: `done-round-${roomId}`,
    url: `./?code=${room.code}`,
    code: room.code,
  });

  let sent = 0;
  const stale: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          message,
          { TTL: 3600, urgency: 'high' },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = the browser dropped this subscription; prune it.
        if (status === 404 || status === 410) stale.push(sub.endpoint);
      }
    }),
  );

  if (stale.length > 0) {
    await admin.from('dn_push_subscriptions').delete().in('endpoint', stale);
  }

  return json({ sent, round: room.round, pruned: stale.length });
});
