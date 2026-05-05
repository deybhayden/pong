// Lightweight WebAudio blip generator for classic Pong sound effects.
//
// Browsers block AudioContext creation until a user gesture, so we lazily
// create the context on the first call to `unlock()` (wired to keydown/click).
// All sounds are short square-wave tones synthesized on demand — no asset
// files, no decoding, no network.

let ctx = null;
let muted = false;

/**
 * Create or resume the AudioContext. Safe to call repeatedly. Must run from
 * inside a user-gesture handler the first time, otherwise the context will
 * be created in the `suspended` state on most browsers.
 */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') {
    // Fire-and-forget; resume() returns a promise we don't need to await.
    ctx.resume().catch(() => {});
  }
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  return muted;
}

/**
 * Play a short square-wave tone.
 *
 * @param {number} freq      Frequency in Hz.
 * @param {number} duration  Length in seconds.
 * @param {number} gain      Peak gain (0..1). Kept low to avoid clipping.
 */
function blip(freq, duration, gain = 0.15) {
  if (muted || !ctx || ctx.state !== 'running') return;

  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, t0);

  // Tiny attack + exponential-ish decay so tones don't click on start/stop.
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.005);
  amp.gain.linearRampToValueAtTime(0, t0 + duration);

  osc.connect(amp).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Classic Atari Pong-ish frequencies: paddle high, wall mid, score low+long.
export const playPaddleHit = () => blip(480, 0.05);
export const playWallHit = () => blip(240, 0.05);
export const playScore = () => blip(160, 0.35, 0.18);
