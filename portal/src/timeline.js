import { CONFIG } from './config.js';

export const CURVE_KEYS = ['chase', 'chasePos', 'shake', 'inhale', 'surge', 'splash', 'open', 'collapse'];
export const EXPOSURE_CAP = 1.6;
export const BLOOM_CAP = 1.4;

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Rises over a→b, falls over c→d.
const pulse = (a, b, c, d, x) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));

const QUIET = Object.freeze({
  chase: 0, chasePos: 0, shake: 0, inhale: 0, surge: 0, splash: 0, open: 0, collapse: 0,
});

// The ~5 s opening script (see spec §8).
export function openingCurves(t) {
  return {
    chase: pulse(0, 0.1, 0.9, 1.15, t),
    chasePos: Math.min(2, t * 2),
    shake: pulse(1.0, 1.2, 3.0, 3.6, t),
    inhale: pulse(1.8, 2.2, 2.3, 2.45, t),
    surge: pulse(2.35, 2.6, 2.9, 3.4, t),
    splash: pulse(3.0, 3.2, 3.8, 4.8, t),
    open: smoothstep(3.2, 5.0, t),
    collapse: 0,
  };
}

export function phaseCurves(phase, phaseTime, timing = CONFIG.timing) {
  switch (phase) {
    case 'opening':
      return openingCurves(phaseTime);
    case 'open':
      return { ...QUIET, open: 1 };
    case 'collapsing':
      return { ...QUIET, collapse: pulse(0, 0.15, timing.collapse * 0.6, timing.collapse, phaseTime) };
    default:
      return { ...QUIET };
  }
}

// Falling `open` drains slowly so a collapse fades the horizon instead of cutting it.
const FALL_TAU = { open: 0.6 };
const TAU = 0.12;

export function followCurves(current, target, dt) {
  const out = {};
  for (const k of CURVE_KEYS) {
    if (k === 'chasePos') {
      out[k] = target[k];
      continue;
    }
    const tau = target[k] < current[k] ? (FALL_TAU[k] ?? TAU) : TAU;
    out[k] = current[k] + (target[k] - current[k]) * (1 - Math.exp(-dt / tau));
  }
  return out;
}

// Whole-screen brightness: the TV is the room's only light, so this is the room light.
export function exposure(charge, curves) {
  const base = 0.55 + 0.45 * charge;
  const e = base * (1 - 0.5 * curves.inhale) * (1 + 0.3 * curves.surge) * (1 + 0.15 * curves.open);
  return Math.min(EXPOSURE_CAP, e);
}

export function bloomStrength(charge, curves) {
  const b = 0.25 + 0.25 * charge + 0.4 * curves.surge + 0.15 * curves.chase + 0.1 * curves.open;
  return Math.min(BLOOM_CAP, b);
}
