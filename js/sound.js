// Done — the chime.
//
// Synthesised with Web Audio: no asset to cache, no file to deploy, and it
// works offline. Browsers only start audio after a gesture, so unlock() is
// called from the join/start/done taps and from any other pointerdown.

let ctx = null;

function AudioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

export function soundSupported() {
  return Boolean(AudioCtor());
}

/** Create or resume the context. Safe to call on every tap. */
export function unlock() {
  const Ctor = AudioCtor();
  if (!Ctor) return false;

  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return false;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return true;
}

/**
 * A three-note rise: C5, E5, G5. Short, warm, and clear across a table
 * without sounding like an alarm. Returns false when the browser is still
 * holding audio back, so the UI can explain the one-tap fix.
 */
export function playChime() {
  if (!unlock() || !ctx || ctx.state !== 'running') return false;

  const t0 = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);

  const notes = [
    { freq: 523.25, at: 0.0, dur: 0.5, gain: 0.22 },
    { freq: 659.25, at: 0.15, dur: 0.5, gain: 0.2 },
    { freq: 783.99, at: 0.3, dur: 0.85, gain: 0.24 },
  ];

  for (const note of notes) {
    const start = t0 + note.at;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(note.freq, start);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + note.dur + 0.05);
  }

  return true;
}
