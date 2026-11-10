// Done — pure helpers.
//
// No DOM, no network. Everything here is unit-tested in test/lib.test.js so the
// fiddly bits (room codes, ordering, round copy) never regress.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/** Strip formatting, uppercase, and cap at six characters. */
export function normalizeCode(input = '') {
  return String(input)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

/** "ABC123" → "ABC 123" for display. */
export function formatCode(input = '') {
  const code = normalizeCode(input);
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export function isValidCode(input = '') {
  return CODE_RE.test(normalizeCode(input));
}

// ── People ─────────────────────────────────────────────────────────────────

export function cleanName(input = '') {
  return String(input).replace(/\s+/g, ' ').trim().slice(0, 24);
}

export function isValidName(input = '') {
  return cleanName(input).length > 0;
}

/**
 * Join order is the seat order. Rows must not shuffle when someone taps done —
 * a board-game table has a physical order, and jumping rows lose people.
 */
export function sortMembers(members = []) {
  return [...members].sort((a, b) => {
    const at = Date.parse(a?.created_at ?? '') || 0;
    const bt = Date.parse(b?.created_at ?? '') || 0;
    if (at !== bt) return at - bt;
    return String(a?.name ?? '').localeCompare(String(b?.name ?? ''));
  });
}

export function progressSummary(members = []) {
  const list = Array.isArray(members) ? members : [];
  const done = list.filter((m) => m?.done);
  return {
    done: done.length,
    total: list.length,
    waiting: list.length - done.length,
    names: done.map((m) => m.name).filter(Boolean),
    allDone: list.length > 0 && done.length === list.length,
    anyoneDone: done.length > 0,
  };
}

export function summaryText(summary) {
  if (!summary || summary.total === 0) return 'Waiting for players to join';
  if (summary.allDone) return 'Everyone’s done';
  if (summary.done === 0) return 'Nobody’s done yet';
  return `${summary.done} of ${summary.total} done`;
}

export function roundLabel(round) {
  const n = Number(round);
  return Number.isFinite(n) && n > 0 ? `Round ${n}` : 'Round 1';
}

/** "Ruth & Tom's wedding" → "Ruth & Tom's…" for tight titles. */
export function truncate(text, max = 40) {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Build a shareable join link that survives being opened from a chat app. */
export function joinUrl(code, base) {
  const root = String(base ?? '').split('?')[0].split('#')[0];
  return `${root}?code=${normalizeCode(code)}`;
}

/** Read a room code out of a URL query string. */
export function codeFromSearch(search = '') {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const raw = params.get('code') ?? '';
    return isValidCode(raw) ? normalizeCode(raw) : '';
  } catch {
    return '';
  }
}
