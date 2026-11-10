// Done — public client configuration.
//
// Static bundle, safe to publish (same model as About Time and Pulse). The
// service_role key is never used here.
//
// Host project: Pulse (shared Supabase project — free tier allows two).
// All Done objects are prefixed `dn_` and isolated by row-level security;
// nothing here can read Pulse's or About Time's data.
export const SUPABASE_URL = 'https://kjlmkjkzbbnzdpvjhkxz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_5w93zJNuHD9GtNFy4x71ZQ_BgrEDm-1';

// The same VAPID key pair as About Time: Edge Function secrets are project-wide,
// so the notify-round function reuses VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
// VAPID_SUBJECT. The private half never appears in the bundle.
export const VAPID_PUBLIC_KEY =
  'BGmrJjIFCMzUZc2604j3rePyDCjloomhflTaefCwGH_QmK_3BWTKSChe3luBnXblK-KCHxq1D29HhQs2hlEb2Ng';

export const APP_NAME = 'Done';
export const APP_TAGLINE = 'Everyone’s turn, at a glance.';
export const EDGE_FUNCTION = 'notify-round';

// Shown quietly in the UI and in the Help sheet. Keep it in step with
// package.json (test/version.test.js enforces it) and bump the service-worker
// CACHE in sw.js on every release.
export const APP_VERSION = '0.1.1';
