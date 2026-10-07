import { runeAngle } from './layout.js';
import { smoothstep } from './timeline.js';

export const MAX_IMPULSES = 16;
const MAX_PENDING = 48;
const TAU = Math.PI * 2;

// Decides what disturbs the mercury each frame. Pure: no Three.js, deterministic given `rand`.
export function createRippleDriver(rand = Math.random) {
  let time = 0;
  let dropClock = 0;
  let lastMul = 0;
  let prevSplash = 0;
  let pending = [];

  function queue(imp, delay = 0) {
    pending.push({ ...imp, at: time + delay });
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  }

  // × energy: every disturbance spawns two rotated echoes.
  function withEchoes(imp) {
    queue(imp);
    if (lastMul < 0.05) return;
    for (let k = 1; k <= 2; k++) {
      const a = (k * TAU) / 3;
      const c = Math.cos(a);
      const s = Math.sin(a);
      queue({ x: imp.x * c - imp.y * s, y: imp.x * s + imp.y * c, r: imp.r, s: imp.s * 0.7 * lastMul }, 0.18 * k);
    }
  }

  function ignite(i) {
    const a = runeAngle(i);
    withEchoes({ x: 0.9 * Math.cos(a), y: 0.9 * Math.sin(a), r: 0.08, s: 0.15 });
  }

  function randomDrop(charge, collapse) {
    const r = 0.85 * Math.sqrt(rand());
    const a = TAU * rand();
    const sign = rand() < 0.5 ? -1 : 1;
    return {
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      r: 0.03 + 0.03 * rand(),
      s: sign * (0.02 + 0.08 * charge + 0.1 * collapse),
    };
  }

  function update(snap, curves, dt) {
    dt = Math.min(dt, 0.1);
    time += dt;
    const c = snap.charge;
    const en = snap.energies;
    lastMul = en.mul;
    const out = [];
    const osc = (x, y, r, amp, hz) => {
      if (amp > 1e-4) out.push({ x, y, r, s: amp * Math.sin(TAU * hz * time) });
    };

    // Continuous sources (at most 10).
    const hz = 0.6 + 0.8 * c;
    osc(0, 0, 0.06, 0.012 * (1 + c) * smoothstep(0.25, 0.5, c) * (1 - en.div), hz);
    const divAmp = 0.012 * en.div * Math.max(c, 0.3); // ÷ energy: split into four in-phase sources
    for (const [x, y] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) osc(x, y, 0.06, divAmp, hz);
    const trainAmp = 0.01 * smoothstep(0.55, 0.75, c);
    const trains = c > 0.85 ? 4 : 2;
    for (let k = 0; k < trains; k++) {
      const a = time * 0.15 + (k * TAU) / trains;
      osc(0.85 * Math.cos(a), 0.85 * Math.sin(a), 0.07, trainAmp, 1.3 + 0.4 * k);
    }
    osc(0, 0, 0.12, 0.02 * curves.open, 0.25); // open: slow majestic rings

    // Droplets.
    const active = snap.litCount > 0 || curves.open > 0.01 || curves.collapse > 0.01;
    const rate = active ? 0.3 + 6 * c * c + 12 * curves.collapse : 0;
    dropClock += dt * rate;
    let drops = 0;
    while (dropClock >= 1 && drops < 4) {
      dropClock -= 1;
      drops++;
      withEchoes(randomDrop(c, curves.collapse));
    }
    dropClock = Math.min(dropClock, 1);

    // Opening: one big splash as the plume falls back.
    if (curves.splash > 0.05 && prevSplash <= 0.05) queue({ x: 0, y: 0, r: 0.3, s: -0.6 });
    prevSplash = curves.splash;

    // Due queued impulses fill the remaining slots; the rest wait for the next frame.
    const keep = [];
    for (const imp of pending) {
      if (imp.at <= time && out.length < MAX_IMPULSES) out.push({ x: imp.x, y: imp.y, r: imp.r, s: imp.s });
      else keep.push(imp);
    }
    pending = keep;
    return out;
  }

  return { ignite, update };
}
