import { CONFIG } from './config.js';
import { ENERGY_RUNES } from './state.js';
import { smoothstep } from './timeline.js';

const ENERGY_INDICES = Object.values(ENERGY_RUNES);

// Fade in, linger, dissolve. 0..1.
export function visionEnvelope(t, timing = CONFIG.vision) {
  const { fadeIn, hold, fadeOut } = timing;
  if (t < fadeIn) return smoothstep(0, fadeIn, t);
  if (t < fadeIn + hold) return 1;
  return 1 - smoothstep(fadeIn + hold, fadeIn + hold + fadeOut, t);
}

// A hint of the next energy rune, glimpsed inside the mercury (portal-hint.html only).
export function createVision(timing = CONFIG.vision) {
  const total = timing.fadeIn + timing.hold + timing.fadeOut;
  let rune = null;
  let time = 0;

  function show(i) {
    if (!ENERGY_INDICES.includes(i)) return false;
    rune = i;
    time = 0;
    return true;
  }

  return {
    get rune() { return rune; },
    get level() { return rune === null ? 0 : visionEnvelope(time, timing); },
    show,
    update(dt) {
      if (rune === null) return;
      time += dt;
      if (time >= total) rune = null;
    },
    setInstant(i) {
      if (show(i)) time = timing.fadeIn;
    },
  };
}
