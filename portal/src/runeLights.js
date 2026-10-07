import { RUNE_COUNT } from './state.js';

// Heat remembers how lit a rune was; the gap between heat and progress is the cooling ember.
export function updateHeat(heat, progress, dt, tau = 1.4) {
  return Math.max(progress, heat * Math.exp(-dt / tau));
}

export function emberLevel(heat, progress) {
  return Math.min(1, Math.max(0, heat - progress)) * 0.8;
}

export function runeGlow(i, t, progress, flare) {
  if (progress <= 0) return 0;
  const breathe = 0.86 + 0.09 * Math.sin(t * 1.7 + i * 1.9) + 0.05 * Math.sin(t * 6.1 + i * 4.3);
  return progress * breathe * (1 + 1.5 * flare);
}

// Opening: a bright head runs clockwise around the ring.
export function chaseBoost(i, curves) {
  if (curves.chase <= 0) return 0;
  const head = (curves.chasePos * RUNE_COUNT) % RUNE_COUNT;
  let d = Math.abs(i - head);
  d = Math.min(d, RUNE_COUNT - d);
  return curves.chase * 2.5 * Math.exp((-d * d) / 1.5);
}
