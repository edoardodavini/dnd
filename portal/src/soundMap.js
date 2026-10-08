import { CONFIG } from './config.js';
import { smoothstep } from './timeline.js';

// A minor pentatonic, semitones above A.
const PENTATONIC = [0, 3, 5, 7, 10];

export function bowlFrequency(i) {
  const semis = Math.floor(i / 5) * 12 + PENTATONIC[i % 5];
  return 220 * 2 ** (semis / 12);
}

// Portal state → continuous sound layers (linear gains, pre-master). See spec §3.
export function soundParams({ charge: c, energies: e }, curves, vision = 0) {
  const { open, inhale, collapse } = curves;
  return {
    air: 0.06 * (1 - smoothstep(0, 0.4, c)) * (1 - open),
    drone: 0.3 * smoothstep(0, 0.12, c) * (0.2 + 0.8 * c) * (1 - 0.9 * inhale) * (1 - 0.6 * open),
    droneCutoff: 250 + 900 * c * c + 1500 * open, // ≥ 250 Hz so harmonics carry on TV speakers
    droneDetune: 3 + 9 * c,
    dronePitch: 1 - 0.12 * collapse,
    flutter: collapse,
    liquid: 0.35 * c * (1 - 0.9 * vision) * (1 - 0.5 * open),
    liquidRate: c > 0.001 ? 0.5 + 8 * c * c : 0,
    choir: 0.3 * open,
    add: 0.06 * e.add,
    sub: 0.08 * e.sub,
    echo: 0.45 * e.mul,
    beat: 0.6 * e.div,
  };
}

export const dbToGain = (db) => 10 ** (db / 20);

export function createVolume(cfg = CONFIG.audio) {
  let db = cfg.masterDb;
  let muted = false;
  return {
    get gain() { return muted ? 0 : dbToGain(db); },
    get label() { return muted ? 'muted' : `vol ${db} dB`; },
    toggleMute() {
      muted = !muted;
    },
    // Changing the volume always unmutes: pressing ] while muted should bring the sound back.
    step(dir) {
      db = Math.min(cfg.maxDb, Math.max(cfg.minDb, db + dir * cfg.stepDb));
      muted = false;
    },
  };
}

// Opening sounds after the chase (which fires on the phase change itself).
export const OPENING_CUES = [[1.0, 'rumble'], [1.8, 'inhale'], [2.4, 'surge'], [3.2, 'splash']];

export function cuesCrossed(prev, now) {
  return OPENING_CUES.filter(([t]) => t > prev && t <= now).map(([, name]) => name);
}

// Poisson-ish liquid scheduling with a per-frame cap, so a long frame never bursts.
export function dropletsDue(clock, dt, rate, max = 3) {
  let next = clock + dt * rate;
  let count = 0;
  while (next >= 1 && count < max) {
    next -= 1;
    count++;
  }
  return { count, clock: Math.min(next, 1) };
}
