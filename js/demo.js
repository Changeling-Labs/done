// Done — in-memory demo store.
//
// Lets the whole interface be explored (and screenshotted) with no Supabase
// project, and gives the round-complete moment something to show: the other
// players tap done on a timer, so the chime lands without a second phone.

import { cleanName } from './lib.js';

const iso = () => new Date().toISOString();
const ago = (ms) => new Date(Date.now() - ms).toISOString();

function fixture(name, emoji) {
  return {
    room: { id: 'demo-room', code: 'GAME42', title: 'Catan', round: 1 },
    members: [
      {
        id: 'me',
        user_id: 'demo-me',
        room_id: 'demo-room',
        name: cleanName(name) || 'You',
        emoji,
        done: false,
        done_at: null,
        created_at: ago(400_000),
        updated_at: iso(),
      },
      {
        id: 'm-mum',
        user_id: 'demo-mum',
        room_id: 'demo-room',
        name: 'Mum',
        emoji: '🌷',
        done: false,
        done_at: null,
        created_at: ago(300_000),
        updated_at: ago(40_000),
      },
      {
        id: 'm-dad',
        user_id: 'demo-dad',
        room_id: 'demo-room',
        name: 'Dad',
        emoji: '🎩',
        done: false,
        done_at: null,
        created_at: ago(200_000),
        updated_at: ago(30_000),
      },
      {
        id: 'm-grace',
        user_id: 'demo-grace',
        room_id: 'demo-room',
        name: 'Grace',
        emoji: '🐝',
        done: false,
        done_at: null,
        created_at: ago(100_000),
        updated_at: ago(20_000),
      },
    ],
  };
}

export function createDemoStore() {
  let data = fixture('You', '🦉');
  let onChange = null;
  let timers = [];

  const touch = () => {
    if (onChange) onChange();
  };

  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const patchMember = (id, patch) => {
    data.members = data.members.map((m) =>
      m.id === id ? { ...m, ...patch, updated_at: iso() } : m,
    );
  };

  /** Mirrors dn_set_done: when the last player is done, advance and reset. */
  const markDone = (id, done) => {
    patchMember(id, { done, done_at: done ? iso() : null });
    if (done && data.members.length > 0 && data.members.every((m) => m.done)) {
      data.room = { ...data.room, round: data.room.round + 1 };
      data.members = data.members.map((m) => ({ ...m, done: false, done_at: null }));
      return true;
    }
    return false;
  };

  const beginShow = () => {
    clearTimers();
    // The table taps around you. If you are already done, the last of these
    // completes the round and every screen chimes.
    timers.push(setTimeout(() => { markDone('m-grace', true); touch(); }, 7_000));
    timers.push(setTimeout(() => { markDone('m-dad', true); touch(); }, 14_000));
    timers.push(setTimeout(() => { markDone('m-mum', true); touch(); }, 21_000));
  };

  return {
    async start({ title, name, emoji }) {
      data = fixture(name, emoji);
      if (cleanName(title)) data.room.title = cleanName(title);
      beginShow();
      return { room: { ...data.room }, memberId: 'me' };
    },

    async join({ name, emoji }) {
      data = fixture(name, emoji);
      beginShow();
      return { room: { ...data.room }, memberId: 'me' };
    },

    async fetch() {
      return {
        room: { ...data.room },
        members: data.members.map((m) => ({ ...m })),
      };
    },

    async setDone(_roomId, done) {
      const before = data.room.round;
      const completed = markDone('me', done);
      touch();
      const doneCount = data.members.filter((m) => m.done).length;
      return {
        round: data.room.round,
        completed: completed || data.room.round > before,
        doneCount,
        total: data.members.length,
      };
    },

    watch(_roomId, cb) {
      onChange = cb;
      return { id: 'demo' };
    },

    unwatch() {
      onChange = null;
      clearTimers();
    },

    async leave() {
      clearTimers();
      onChange = null;
    },

    async saveSubscription() {
      // Nothing to do without a push service.
    },

    async notifyRound() {
      // Pretend the push went out.
    },
  };
}
