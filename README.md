# ✅ Done

**Everyone’s turn, at a glance.**

Open it at the table. Every player taps **I’m done** when their turn is over. When the last player taps, every phone chimes and the room rolls on to the next round — no “whose turn is it?”, no group chat, no reset button.

- **No accounts, no passwords.** One player opens a room and shares a six-character code.
- **One tap per turn.** A big button, a green row in the table list, nothing to interpret.
- **Auto-advancing rounds.** The round completes and resets itself in one transaction, so two people tapping at once cannot double-advance it.
- **A real chime on every phone.** Synthesised with Web Audio — works offline, no audio file.
- **Web Push fallback.** The last player’s app notifies everyone else’s phones, even if the app is closed.
- **Installable PWA.** Cache-first shell, light and dark, WCAG AA.

Status: **v0.1.0** — built, unit-tested, browser-verified. Live at
https://changelinglabs.com/done/ (GitHub Pages from `main`).

> **Backend:** the frontend ships now, but the Supabase objects must be created
> once in the dashboard. See [`supabase/README.md`](supabase/README.md) for the
> two remaining steps (run `schema.sql`, deploy `notify-round`). The chime works
> without them; the server-backed room does not.

---

## Try it without a backend

```bash
npm run serve
# open http://localhost:8942/?demo=1
```

`?demo=1` runs the whole interface against an in-memory store with four players
who tap done on a timer, so the round completes and the chime lands on its own.
`?demo=1&view=landing` shows the start/join screen, and adding `&code=ABC234`
shows the invite-first landing.

---

## How it works

```
 Phone A (last to tap)              Supabase                       Phone B
 ─────────────────────              ────────                       ───────
 tap "I'm done" ──▶ dn_set_done
                    round + 1, flags reset
                    ├── Realtime ───────────────────────────────▶ round changed
                    │                                             ──▶ chime
                    └── invoke notify-round ── Web Push ────────▶ notification
                                                                  (app closed)
```

1. **Start a room.** Creates a row in `dn_rooms` with a random six-character code and adds you to `dn_members`.
2. **Everyone joins** with the code (or a shared `?code=XXXXXX` link). Each device gets an invisible Supabase *anonymous* account.
3. **Tap I’m done.** The `dn_set_done` RPC sets your flag and counts the table. When everyone is done, it advances `round` and clears every flag in the same transaction, returning `completed = true` exactly once.
4. **Every open app** sees the round change over Realtime (with a 30s poll as insurance) and plays the chime. The last tapper also invokes `notify-round`, which pushes to everyone else’s devices.

The whole app is vanilla ES modules with no build step. State lives in one object in `js/app.js`; every mutation ends in `render()`.

### Files

| Path | What it does |
|---|---|
| `index.html` | Shell, meta tags, boot skeleton |
| `js/app.js` | State, routing, rendering, events |
| `js/lib.js` | Pure helpers — codes, ordering, round copy. Unit-tested. |
| `js/sound.js` | Web Audio chime + unlock-on-gesture |
| `js/store.js` | Supabase data layer + anonymous session |
| `js/demo.js` | In-memory store with a scripted table |
| `js/push.js` | Permission, VAPID subscription, platform detection |
| `js/config.js` | Public project URL, publishable key, VAPID public key, `APP_VERSION` |
| `sw.js` | Cache-first shell + `push` / `notificationclick` |
| `supabase/schema.sql` | Tables, RLS, RPCs, Realtime publication |
| `supabase/functions/notify-round/index.ts` | Push fan-out Edge Function |
| `scripts/make-icons.py` | Generates the PNG icons with Pillow |

### Data model

| Table | Purpose |
|---|---|
| `dn_rooms` | One row per table: `code`, `title`, `round`, `last_notified_at` |
| `dn_members` | One row per player: `name`, `emoji`, `done`, `done_at` |
| `dn_push_subscriptions` | One row per device: `endpoint`, `p256dh`, `auth` |

All objects are prefixed `dn_` and live in the **Pulse** Supabase project. Nothing touches Pulse's `sync_rows` or About Time's `at_*` tables.

---

## Notifications & install

Same approach as About Time, because the failure modes are identical:

- Every alerts card states the next action, and blocked cards give browser-specific unblock steps.
- The **How it works** sheet explains the round, the sound, notifications, and install per platform (iPhone Home Screen, macOS Safari Add to Dock, Chrome Android, Chrome/Edge desktop).
- `beforeinstallprompt` is captured, so Chrome gets a real **Install app** button.
- Dismissing the alert invite leaves a one-line “Alerts are off — turn them on”, so the only path is never closed.
- iPhone and macOS Safari only deliver Web Push to the installed app; the UI says so instead of showing a dead button.

## Sound

The chime is three triangle-wave notes (C5, E5, G5) generated with Web Audio in `js/sound.js`. Browsers only allow audio after a gesture, so every start/join/done tap unlocks the audio context, and any other tap retries. If a phone has not been touched since loading, the app says “tap the page once” instead of failing silently. The speaker button in the header mutes it, and the choice is remembered.

---

## Deploy

Static files only, served by GitHub Pages from `Changeling-Labs/done` at `changelinglabs.com/done/`. All paths are relative, so the subdirectory works as-is. `.nojekyll` keeps Pages from running Jekyll over the bundle.

**Every release:** bump `APP_VERSION` in `js/config.js` and `version` in `package.json` (they must match — `test/version.test.js` checks), bump `CACHE` in `sw.js`, and add any new module to `ASSETS`. The service worker is cache-first, so a stale client will otherwise keep the old JS. The version is shown in the landing fineprint, the room footer, and the help sheet.

---

## Tests

```bash
npm test
```

Node's built-in runner. Covers room-code normalisation, invite links, stable seat ordering, progress counts and copy, round labels, name cleaning, and the version/cache pairing.

---

## Design decisions

- **Six-character codes** from an unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) — no `I`, `O`, `0` or `1` to mistype across a noisy table.
- **Join order is seat order.** Rows never shuffle when someone taps; a physical table has a physical order.
- **One transactional RPC.** Completing the round and clearing the flags together is what makes “everyone was done at once” safe; two last taps cannot advance two rounds.
- **Anonymous auth over email links.** Nobody is signing in at game night.
- **A chime, plus push.** The sound is the table signal; push is for the phone in a pocket.
- **The round advances itself.** No reset button means no one has to remember, and no one can reset early.
- **A slow poll behind Realtime.** Table wifi is table wifi.

## Not built yet

- Choosing a player order or assigning “whose turn” — this tracker is deliberately unordered.
- Game history or score tracking.
- A “pause the round” / manual reset for abandoned games.
- Per-device notification management.
