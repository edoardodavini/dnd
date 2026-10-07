# Rune Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained `dist/portal.html`: a Stargate-style ring of 12 carved basalt blocks around a liquid-mercury event horizon, driven from the keyboard, that escalates as runes light and opens when all 12 are lit.

**Architecture:** Vite + Three.js. Pure-logic modules (state machine, colour ramp, phase timeline, layout, camera pose, glyph data, rune-light math, ripple driver) are unit-tested with Vitest. Rendering modules (stone ring shader, rune lights, GPU wave sim, mercury shader, post-processing) are verified by building the single-file HTML and taking headless-Chrome screenshots at fixed states via a `?lit=` URL preset. `main.js` wires everything; later tasks add code at anchor comments (`// @imports`, `// @modules`, `// @update`, `// @resize`).

**Tech Stack:** three@^0.186, vite@^8, vite-plugin-singlefile@^2.3, vitest@^5, puppeteer-core@^25 (screenshots with the installed Google Chrome). Node 24.

**Spec:** `docs/superpowers/specs/2026-10-07-rune-portal-design.md`

## Global Constraints

- Deliverable: one file `dist/portal.html`, opens by double-click, works offline, no external assets (all textures procedural).
- Background pure `#000`; OLED: no grain or effect may lift pure black.
- No full-white frames, no strobing faster than ~2 Hz.
- No sound. Cursor hidden.
- Keys by `KeyboardEvent.code`: `Digit1`…`Digit9`, `Digit0`, `Minus`, `Equal` toggle runes 1–12; `Backspace` reset; `KeyF` fullscreen; `KeyH` help; `KeyD` debug. Ignore key repeat and any key with Meta/Ctrl/Alt held.
- Rune `i` (1-based) sits at `i` o'clock; rune 12 at the top. In code, runes are 0-based indices 0–11.
- Energy runes (0-based index → energy): 2 → add (+), 5 → sub (−), 8 → mul (×), 11 → div (÷). Same look and glow as the others.
- Colour ramp by lit count: 1–3 deep amber, 4–6 gold, 7–9 white-gold, 10–11 pale blue-white, open brilliant blue-white.
- Timings: ignite 0.7 s, unlight 0.9 s, opening 5.0 s, collapse 2.0 s.
- Target 60 fps at 4K; pixel ratio capped (default 1.5).

## Review Focus

1. **Browser shortcuts while presenting** (Cmd+F, Cmd+R, Backspace history-back): modifier combos must do nothing in the portal; Backspace must reset without navigating away. Test in Task 5 (`input.test.js`).
2. **DM mashing keys mid-animation**: rapid toggles must never push progress outside [0, 1] or leave an invalid phase. Test in Task 1 (`state.test.js`).
3. **Long frame after tab switch / sleep (huge dt)**: no animation jumps past valid ranges, ripple driver must not flood the sim. Tests in Task 1 (`update(10)`) and Task 8 (`update` with dt = 5); `main.js` also clamps dt to 0.1 s.
4. **Window size change (fullscreen toggle, narrow/portrait window)**: ring must always fit on screen. Test in Task 2 (`fitCameraDistance`).
5. **Rune unlit in the middle of the opening surge**: plume and flare must ease away, not snap off in one frame. Test in Task 3 (`followCurves`).

---

### Task 1: Project scaffold + state machine

**Files:**
- Create: `package.json`, `vite.config.js`, `.gitignore`, `src/config.js`, `src/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONFIG` (object, see code) from `src/config.js`.
  - From `src/state.js`: `RUNE_COUNT = 12`; `KEY_TO_RUNE` (code → 0-based index); `ENERGY_RUNES = { add: 2, sub: 5, mul: 8, div: 11 }`; `runeForKey(code: string): number | undefined`; `parseLitParam(value: string | null): number[] | null`; `createState(timing = CONFIG.timing)` returning an object with getters `lit: boolean[12]`, `progress: number[12]` (0..1), `energies: {add, sub, mul, div}` (eased 0..1), `litCount: number`, `charge: number` (eased 0..1), `phase: 'dormant'|'charging'|'opening'|'open'|'collapsing'`, `phaseTime: number` (s); methods `toggle(i)`, `reset()`, `update(dt)`, `setInstant(indices: number[])`, `onIgnite(fn(i))`, `onUnlight(fn(i))`, `onPhase(fn(phase))`.

- [ ] **Step 1: Scaffold the project**

```bash
cd /Users/edoardo.davini/dev/dnd-portal
npm init -y >/dev/null
npm pkg set type=module private=true --json
npm pkg delete main scripts.test
npm pkg set scripts.dev="vite --open" scripts.build="vite build && mv dist/index.html dist/portal.html" scripts.test="vitest run" scripts.shoot="node scripts/shoot.mjs"
npm i three@^0.186
npm i -D vite@^8 vite-plugin-singlefile@^2.3 vitest@^5
```

Create `vite.config.js`:

```js
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022' },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
```

Create `.gitignore`:

```
node_modules/
dist/
shots/
```

Create `src/config.js`:

```js
// Every tunable lives here so the portal can be tuned on the TV without hunting through modules.
export const CONFIG = {
  quality: {
    maxPixelRatio: 1.5,
    simSize: 256,
    simHz: 120,
    mercurySegments: 256,
  },
  ring: {
    outer: 1.0,
    inner: 0.72,
    depth: 0.12,
    bevel: 0.018,
    seam: 0.008,
    glyphSize: 0.2,
    chipAmount: 0.006,
    bumpScale: 0.03,
  },
  mercury: { radius: 0.735, z: -0.035, displacement: 0.06, shapeScale: 0.06 },
  camera: { fov: 35, ringScreenFraction: 0.85, driftDeg: 2, driftPeriod: 30 },
  timing: {
    ignite: 0.7,
    unlight: 0.9,
    chargeTau: 0.5,
    energyTau: 0.8,
    opening: 5.0,
    collapse: 2.0,
  },
};
```

- [ ] **Step 2: Write the failing tests**

Create `tests/state.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createState, runeForKey, parseLitParam, RUNE_COUNT } from '../src/state.js';

const PHASES = ['dormant', 'charging', 'opening', 'open', 'collapsing'];
const lightAll = (s) => { for (let i = 0; i < RUNE_COUNT; i++) if (!s.lit[i]) s.toggle(i); };
const run = (s, seconds, step = 1 / 60) => { for (let k = 0; k < Math.round(seconds / step); k++) s.update(step); };

describe('runeForKey', () => {
  it('maps the number row to runes 0..11', () => {
    expect(runeForKey('Digit1')).toBe(0);
    expect(runeForKey('Digit9')).toBe(8);
    expect(runeForKey('Digit0')).toBe(9);
    expect(runeForKey('Minus')).toBe(10);
    expect(runeForKey('Equal')).toBe(11);
    expect(runeForKey('KeyA')).toBeUndefined();
  });
});

describe('parseLitParam', () => {
  it('parses 1-based lists, "all", and rejects junk', () => {
    expect(parseLitParam('1,2,12')).toEqual([0, 1, 11]);
    expect(parseLitParam('all')).toEqual([...Array(12).keys()]);
    expect(parseLitParam('0,13,x,3')).toEqual([2]);
    expect(parseLitParam('')).toBeNull();
    expect(parseLitParam(null)).toBeNull();
  });
});

describe('createState', () => {
  it('starts dormant with nothing lit', () => {
    const s = createState();
    expect(s.phase).toBe('dormant');
    expect(s.litCount).toBe(0);
    expect(s.charge).toBe(0);
  });

  it('toggles runes and moves dormant -> charging -> dormant', () => {
    const s = createState();
    s.toggle(3);
    expect(s.lit[3]).toBe(true);
    expect(s.phase).toBe('charging');
    s.toggle(3);
    expect(s.lit[3]).toBe(false);
    expect(s.phase).toBe('dormant');
  });

  it('ignores out-of-range toggles', () => {
    const s = createState();
    s.toggle(-1); s.toggle(12); s.toggle(1.5);
    expect(s.litCount).toBe(0);
  });

  it('opens when all 12 are lit, becoming open after 5 s', () => {
    const s = createState();
    lightAll(s);
    expect(s.phase).toBe('opening');
    run(s, 4.9);
    expect(s.phase).toBe('opening');
    run(s, 0.2);
    expect(s.phase).toBe('open');
  });

  it('collapses when a rune is unlit while open, then returns to charging', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.toggle(4);
    expect(s.phase).toBe('collapsing');
    expect(s.phaseTime).toBe(0);
    run(s, 2.1);
    expect(s.phase).toBe('charging');
  });

  it('collapses when a rune is unlit mid-opening', () => {
    const s = createState();
    lightAll(s);
    run(s, 2.4);
    s.toggle(0);
    expect(s.phase).toBe('collapsing');
  });

  it('restarts opening from t=0 if the missing rune is re-lit during collapse', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.toggle(7);
    run(s, 1);
    s.toggle(7);
    expect(s.phase).toBe('opening');
    expect(s.phaseTime).toBe(0);
  });

  it('reset from charging goes straight to dormant', () => {
    const s = createState();
    s.toggle(0); s.toggle(1);
    s.reset();
    expect(s.litCount).toBe(0);
    expect(s.phase).toBe('dormant');
  });

  it('reset from open plays the collapse, then dormant', () => {
    const s = createState();
    lightAll(s);
    run(s, 5.1);
    s.reset();
    expect(s.phase).toBe('collapsing');
    run(s, 2.1);
    expect(s.phase).toBe('dormant');
  });

  it('animates progress linearly and reverses from the current value', () => {
    const s = createState();
    s.toggle(0);
    run(s, 0.35, 0.05);
    expect(s.progress[0]).toBeCloseTo(0.5, 1);
    s.toggle(0);
    s.update(0.09);
    expect(s.progress[0]).toBeCloseTo(0.4, 1);
    run(s, 1);
    expect(s.progress[0]).toBe(0);
  });

  it('eases charge toward litCount/12 monotonically', () => {
    const s = createState();
    for (let i = 0; i < 6; i++) s.toggle(i);
    let prev = 0;
    for (let k = 0; k < 180; k++) {
      s.update(1 / 60);
      expect(s.charge).toBeGreaterThanOrEqual(prev);
      prev = s.charge;
    }
    expect(s.charge).toBeCloseTo(0.5, 2);
  });

  it('charge targets 1 while opening/open', () => {
    const s = createState();
    lightAll(s);
    run(s, 6);
    expect(s.charge).toBeCloseTo(1, 2);
  });

  it('eases energy levels for the cardinal runes only', () => {
    const s = createState();
    s.toggle(2);
    run(s, 4);
    expect(s.energies.add).toBeGreaterThan(0.99);
    expect(s.energies.sub).toBe(0);
    expect(s.energies.mul).toBe(0);
    expect(s.energies.div).toBe(0);
  });

  it('emits ignite/unlight/phase events', () => {
    const s = createState();
    const log = [];
    s.onIgnite((i) => log.push(`ignite ${i}`));
    s.onUnlight((i) => log.push(`unlight ${i}`));
    s.onPhase((p) => log.push(`phase ${p}`));
    s.toggle(5);
    s.toggle(5);
    expect(log).toEqual(['ignite 5', 'phase charging', 'unlight 5', 'phase dormant']);
  });

  it('survives key mashing with valid progress and phase', () => {
    const s = createState();
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 2000; k++) {
      if (rand() < 0.4) s.toggle(Math.floor(rand() * 12));
      if (rand() < 0.02) s.reset();
      s.update(rand() * 0.05);
      for (const p of s.progress) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
      expect(PHASES).toContain(s.phase);
      expect(s.charge).toBeGreaterThanOrEqual(0);
      expect(s.charge).toBeLessThanOrEqual(1);
    }
  });

  it('handles a huge dt (tab was hidden) without invalid values', () => {
    const s = createState();
    lightAll(s);
    s.update(10);
    expect(s.phase).toBe('open');
    expect(s.progress.every((p) => p === 1)).toBe(true);
    expect(s.charge).toBeLessThanOrEqual(1);
    expect(Number.isFinite(s.charge)).toBe(true);
  });

  it('setInstant jumps straight to a settled state', () => {
    const s = createState();
    s.setInstant([0, 1, 2]);
    expect(s.phase).toBe('charging');
    expect(s.progress.slice(0, 4)).toEqual([1, 1, 1, 0]);
    expect(s.charge).toBeCloseTo(0.25);
    expect(s.energies.add).toBe(1);
    s.setInstant([...Array(12).keys()]);
    expect(s.phase).toBe('open');
    expect(s.charge).toBe(1);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to load url ../src/state.js` (module does not exist).

- [ ] **Step 4: Write the implementation**

Create `src/state.js`:

```js
import { CONFIG } from './config.js';

export const RUNE_COUNT = 12;

export const KEY_TO_RUNE = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5,
  Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9, Minus: 10, Equal: 11,
};

// Rune index (0-based) of each hidden energy. Runes 3, 6, 9 and 12 sit at the cardinal points.
export const ENERGY_RUNES = { add: 2, sub: 5, mul: 8, div: 11 };

export function runeForKey(code) {
  return KEY_TO_RUNE[code];
}

// `?lit=1,2,12` (1-based rune numbers) or `?lit=all` → 0-based indices; used for screenshots.
export function parseLitParam(value) {
  if (!value) return null;
  if (value === 'all') return [...Array(RUNE_COUNT).keys()];
  return value
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= RUNE_COUNT)
    .map((n) => n - 1);
}

const ease = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));

export function createState(timing = CONFIG.timing) {
  const lit = new Array(RUNE_COUNT).fill(false);
  const progress = new Array(RUNE_COUNT).fill(0);
  const energies = { add: 0, sub: 0, mul: 0, div: 0 };
  const listeners = { ignite: [], unlight: [], phase: [] };
  let charge = 0;
  let phase = 'dormant';
  let phaseTime = 0;

  const litCount = () => lit.reduce((n, on) => n + (on ? 1 : 0), 0);
  const emit = (type, arg) => listeners[type].forEach((fn) => fn(arg));
  const isOpenish = () => phase === 'opening' || phase === 'open';

  function setPhase(next) {
    if (next === phase) return;
    phase = next;
    phaseTime = 0;
    emit('phase', next);
  }

  function resolvePhase() {
    const n = litCount();
    if (n === RUNE_COUNT) {
      if (!isOpenish()) setPhase('opening');
    } else if (isOpenish()) {
      setPhase('collapsing');
    } else if (phase !== 'collapsing') {
      setPhase(n === 0 ? 'dormant' : 'charging');
    }
  }

  function toggle(i) {
    if (!Number.isInteger(i) || i < 0 || i >= RUNE_COUNT) return;
    lit[i] = !lit[i];
    emit(lit[i] ? 'ignite' : 'unlight', i);
    resolvePhase();
  }

  function reset() {
    for (let i = 0; i < RUNE_COUNT; i++) {
      if (lit[i]) {
        lit[i] = false;
        emit('unlight', i);
      }
    }
    resolvePhase();
  }

  function update(dt) {
    phaseTime += dt;
    for (let i = 0; i < RUNE_COUNT; i++) {
      const delta = lit[i] ? dt / timing.ignite : -dt / timing.unlight;
      progress[i] = Math.min(1, Math.max(0, progress[i] + delta));
    }
    if (phase === 'opening' && phaseTime >= timing.opening) setPhase('open');
    if (phase === 'collapsing' && phaseTime >= timing.collapse) {
      setPhase(litCount() === 0 ? 'dormant' : 'charging');
    }
    const target = isOpenish() ? 1 : litCount() / RUNE_COUNT;
    charge = ease(charge, target, dt, timing.chargeTau);
    for (const [name, idx] of Object.entries(ENERGY_RUNES)) {
      energies[name] = ease(energies[name], lit[idx] ? 1 : 0, dt, timing.energyTau);
    }
  }

  // Jump to a settled state without animations or events (URL presets for screenshots).
  function setInstant(indices) {
    lit.fill(false);
    for (const i of indices) if (i >= 0 && i < RUNE_COUNT) lit[i] = true;
    for (let i = 0; i < RUNE_COUNT; i++) progress[i] = lit[i] ? 1 : 0;
    const n = litCount();
    phase = n === RUNE_COUNT ? 'open' : n === 0 ? 'dormant' : 'charging';
    phaseTime = 0;
    charge = phase === 'open' ? 1 : n / RUNE_COUNT;
    for (const [name, idx] of Object.entries(ENERGY_RUNES)) energies[name] = lit[idx] ? 1 : 0;
  }

  return {
    get lit() { return lit; },
    get progress() { return progress; },
    get energies() { return energies; },
    get litCount() { return litCount(); },
    get charge() { return charge; },
    get phase() { return phase; },
    get phaseTime() { return phaseTime; },
    toggle,
    reset,
    update,
    setInstant,
    onIgnite: (fn) => listeners.ignite.push(fn),
    onUnlight: (fn) => listeners.unlight.push(fn),
    onPhase: (fn) => listeners.phase.push(fn),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all `state.test.js` tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js .gitignore src/config.js src/state.js tests/state.test.js
git commit -m "feat: scaffold project and rune state machine"
```

---

### Task 2: Layout, palette and camera pose

**Files:**
- Create: `src/layout.js`, `src/palette.js`, `src/camera.js`
- Test: `tests/layout.test.js`, `tests/palette.test.js`, `tests/camera.test.js`

**Interfaces:**
- Consumes: `CONFIG` from `src/config.js`.
- Produces:
  - `src/layout.js`: `runeAngle(i: number): number` (radians, math convention, CCW from +X); `runeCenter(i, radius): {x, y}`; `fitCameraDistance(aspect: number, cfg = CONFIG): number`.
  - `src/palette.js`: `glowColor(charge: number): [r, g, b]` (sRGB 0..1); `EMBER_RGB: [r, g, b]`.
  - `src/camera.js`: `cameraPose(t: number, shake: number, cfg = CONFIG.camera): {yaw, pitch, offsetX, offsetY}`; `applyCamera(camera: THREE.PerspectiveCamera, pose, distance: number): void`.

- [ ] **Step 1: Write the failing tests**

Create `tests/layout.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { runeAngle, runeCenter, fitCameraDistance } from '../src/layout.js';
import { CONFIG } from '../src/config.js';

describe('rune layout', () => {
  it('puts rune 12 at the top and the cardinals at 3/6/9 o\'clock', () => {
    const top = runeCenter(11, 1);
    expect(top.x).toBeCloseTo(0);
    expect(top.y).toBeCloseTo(1);
    expect(runeCenter(2, 1).x).toBeCloseTo(1);
    expect(runeCenter(2, 1).y).toBeCloseTo(0);
    expect(runeCenter(5, 1).y).toBeCloseTo(-1);
    expect(runeCenter(8, 1).x).toBeCloseTo(-1);
  });

  it('runs clockwise: rune 1 is at 1 o\'clock', () => {
    const c = runeCenter(0, 1);
    expect(c.x).toBeGreaterThan(0);
    expect(c.y).toBeGreaterThan(c.x);
    expect(runeAngle(1)).toBeLessThan(runeAngle(0));
  });
});

describe('fitCameraDistance', () => {
  const tanHalf = Math.tan((CONFIG.camera.fov * Math.PI) / 360);
  const span = (2 * CONFIG.ring.outer) / CONFIG.camera.ringScreenFraction;

  it('makes the ring fill 85% of the height on a 16:9 screen', () => {
    const d = fitCameraDistance(16 / 9);
    expect(2 * d * tanHalf).toBeCloseTo(span);
  });

  it('keeps the whole ring visible on narrow / portrait windows', () => {
    for (const aspect of [1, 0.75, 0.5, 0.3]) {
      const d = fitCameraDistance(aspect);
      expect(2 * d * tanHalf * aspect).toBeGreaterThanOrEqual(span - 1e-9);
      expect(2 * d * tanHalf).toBeGreaterThanOrEqual(span - 1e-9);
    }
  });
});
```

Create `tests/palette.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { glowColor } from '../src/palette.js';

describe('glowColor', () => {
  it('is deep amber for 1-3 runes', () => {
    for (const n of [0, 1, 2]) expect(glowColor(n / 12)).toEqual([1.0, 0.42, 0.08]);
  });

  it('hits the band colours at their centres', () => {
    expect(glowColor(5 / 12)).toEqual([1.0, 0.68, 0.22]);
    expect(glowColor(8 / 12)).toEqual([1.0, 0.88, 0.62]);
    expect(glowColor(1)).toEqual([0.6, 0.82, 1.0]);
  });

  it('cools monotonically: blue never drops, red never rises', () => {
    let prev = glowColor(0);
    for (let c = 0; c <= 1.0001; c += 0.01) {
      const cur = glowColor(c);
      expect(cur[2]).toBeGreaterThanOrEqual(prev[2] - 1e-9);
      expect(cur[0]).toBeLessThanOrEqual(prev[0] + 1e-9);
      prev = cur;
    }
  });

  it('clamps out-of-range input', () => {
    expect(glowColor(-1)).toEqual(glowColor(0));
    expect(glowColor(2)).toEqual(glowColor(1));
  });
});
```

Create `tests/camera.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { cameraPose } from '../src/camera.js';

describe('cameraPose', () => {
  it('drifts within ±2 degrees', () => {
    const limit = (2 * Math.PI) / 180 + 1e-9;
    for (let t = 0; t < 120; t += 0.25) {
      const p = cameraPose(t, 0);
      expect(Math.abs(p.yaw)).toBeLessThanOrEqual(limit);
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(limit);
    }
  });

  it('only shakes when asked, and only a little', () => {
    for (let t = 0; t < 10; t += 0.1) {
      const calm = cameraPose(t, 0);
      expect(calm.offsetX).toBe(0);
      expect(calm.offsetY).toBe(0);
      const shaken = cameraPose(t, 1);
      expect(Math.abs(shaken.offsetX)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(shaken.offsetY)).toBeLessThanOrEqual(0.02);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot load `../src/layout.js`, `../src/palette.js`, `../src/camera.js`.

- [ ] **Step 3: Write the implementation**

Create `src/layout.js`:

```js
import { CONFIG } from './config.js';

// Rune i (0-based) sits at (i + 1) o'clock; angle is CCW from +X.
export function runeAngle(i) {
  return Math.PI / 2 - ((i + 1) * Math.PI) / 6;
}

export function runeCenter(i, radius) {
  const a = runeAngle(i);
  return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
}

// Distance at which the ring fills `ringScreenFraction` of the height, or of the width on narrow screens.
export function fitCameraDistance(aspect, cfg = CONFIG) {
  const span = (2 * cfg.ring.outer) / cfg.camera.ringScreenFraction;
  const tanHalf = Math.tan((cfg.camera.fov * Math.PI) / 360);
  return Math.max(span / (2 * tanHalf), span / (2 * tanHalf * aspect));
}
```

Create `src/palette.js`:

```js
// Glow colour (sRGB) by charge. Stops sit at the centre of each lit-count band.
const STOPS = [
  [2 / 12, [1.0, 0.42, 0.08]], // 1-3: deep amber
  [5 / 12, [1.0, 0.68, 0.22]], // 4-6: gold
  [8 / 12, [1.0, 0.88, 0.62]], // 7-9: white-gold
  [10.5 / 12, [0.78, 0.9, 1.0]], // 10-11: pale blue-white
  [1.0, [0.6, 0.82, 1.0]], // open: brilliant blue-white (brightness comes from intensity)
];

export const EMBER_RGB = [0.55, 0.1, 0.02];

export function glowColor(charge) {
  const c = Math.min(1, Math.max(0, charge));
  if (c <= STOPS[0][0]) return [...STOPS[0][1]];
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    if (c <= t1) {
      const [t0, c0] = STOPS[k - 1];
      const f = (c - t0) / (t1 - t0);
      if (f === 1) return [...c1];
      return c0.map((v, j) => v + (c1[j] - v) * f);
    }
  }
  return [...STOPS[STOPS.length - 1][1]];
}
```

Create `src/camera.js`:

```js
import { CONFIG } from './config.js';

const TAU = Math.PI * 2;

// Slow orbit around the ring so the stone shows parallax; high-frequency shake only during opening.
export function cameraPose(t, shake, cfg = CONFIG.camera) {
  const amp = (cfg.driftDeg * Math.PI) / 180;
  const yaw = amp * Math.sin((TAU * t) / cfg.driftPeriod);
  const pitch = amp * 0.6 * Math.sin((TAU * t) / (cfg.driftPeriod * 1.23) + 1.3);
  if (shake <= 0) return { yaw, pitch, offsetX: 0, offsetY: 0 };
  const offsetX = shake * 0.02 * (0.6 * Math.sin(t * 41.0) + 0.4 * Math.sin(t * 67.3));
  const offsetY = shake * 0.02 * (0.6 * Math.sin(t * 53.1) + 0.4 * Math.sin(t * 29.7));
  return { yaw, pitch, offsetX, offsetY };
}

export function applyCamera(camera, pose, distance) {
  const { yaw, pitch, offsetX, offsetY } = pose;
  camera.position.set(
    distance * Math.sin(yaw) * Math.cos(pitch) + offsetX,
    distance * Math.sin(pitch) + offsetY,
    distance * Math.cos(yaw) * Math.cos(pitch),
  );
  camera.lookAt(offsetX * 0.5, offsetY * 0.5, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — layout, palette, camera and state suites green.

- [ ] **Step 5: Commit**

```bash
git add src/layout.js src/palette.js src/camera.js tests/layout.test.js tests/palette.test.js tests/camera.test.js
git commit -m "feat: add rune layout, colour ramp and camera drift"
```

---

### Task 3: Phase timeline (opening, collapse, exposure, bloom)

**Files:**
- Create: `src/timeline.js`
- Test: `tests/timeline.test.js`

**Interfaces:**
- Consumes: `CONFIG.timing` from `src/config.js`.
- Produces (`src/timeline.js`):
  - `smoothstep(a, b, x): number`
  - `CURVE_KEYS = ['chase','chasePos','shake','inhale','surge','splash','open','collapse']`
  - `Curves` object shape: all keys above → number. `chase, shake, inhale, surge, splash, open, collapse` ∈ [0,1]; `chasePos` ∈ [0,2] (turns of the clockwise chase).
  - `openingCurves(t): Curves`; `phaseCurves(phase, phaseTime, timing = CONFIG.timing): Curves`; `followCurves(current: Curves, target: Curves, dt): Curves`
  - `exposure(charge, curves): number` (≤ `EXPOSURE_CAP`); `bloomStrength(charge, curves): number` (≤ `BLOOM_CAP`); `EXPOSURE_CAP = 1.6`; `BLOOM_CAP = 1.4`.

- [ ] **Step 1: Write the failing tests**

Create `tests/timeline.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  CURVE_KEYS, openingCurves, phaseCurves, followCurves,
  exposure, bloomStrength, EXPOSURE_CAP, BLOOM_CAP,
} from '../src/timeline.js';

const quiet = phaseCurves('dormant', 0);

describe('phaseCurves', () => {
  it('is all zero outside the opening/open/collapse phases', () => {
    for (const p of ['dormant', 'charging']) {
      const c = phaseCurves(p, 3);
      for (const k of CURVE_KEYS) expect(c[k]).toBe(0);
    }
  });

  it('follows the opening script', () => {
    expect(openingCurves(0.5).chase).toBeGreaterThan(0.9);
    expect(openingCurves(1.5).shake).toBeGreaterThan(0.9);
    expect(openingCurves(2.25).inhale).toBeGreaterThan(0.9);
    expect(openingCurves(2.75).surge).toBeGreaterThan(0.9);
    expect(openingCurves(3.5).splash).toBeGreaterThan(0.9);
    expect(openingCurves(5).open).toBe(1);
    expect(openingCurves(0.5).surge).toBe(0);
    expect(openingCurves(4.5).surge).toBe(0);
  });

  it('chases clockwise twice in the first second', () => {
    expect(openingCurves(0).chasePos).toBe(0);
    expect(openingCurves(0.5).chasePos).toBeCloseTo(1);
    expect(openingCurves(3).chasePos).toBe(2);
  });

  it('is fully open in the open phase', () => {
    expect(phaseCurves('open', 10).open).toBe(1);
    expect(phaseCurves('open', 10).surge).toBe(0);
  });

  it('flickers during collapse and is done after 2 s', () => {
    expect(phaseCurves('collapsing', 0.5).collapse).toBeGreaterThan(0.9);
    expect(phaseCurves('collapsing', 2).collapse).toBe(0);
    expect(phaseCurves('collapsing', 0.5).open).toBe(0);
  });
});

describe('followCurves', () => {
  it('eases a surge out instead of snapping when a rune is unlit mid-surge', () => {
    let c = followCurves(quiet, openingCurves(2.75), 10);
    expect(c.surge).toBeGreaterThan(0.9);
    const target = phaseCurves('collapsing', 0);
    c = followCurves(c, target, 1 / 60);
    expect(c.surge).toBeGreaterThan(0.8);
    for (let k = 0; k < 60; k++) c = followCurves(c, target, 1 / 60);
    expect(c.surge).toBeLessThan(0.01);
  });

  it('drains `open` slowly (about 2 s) during collapse', () => {
    let c = followCurves(quiet, phaseCurves('open', 0), 10);
    const target = phaseCurves('collapsing', 0);
    for (let k = 0; k < 30; k++) c = followCurves(c, target, 1 / 60);
    expect(c.open).toBeGreaterThan(0.3);
    for (let k = 0; k < 150; k++) c = followCurves(c, target, 1 / 60);
    expect(c.open).toBeLessThan(0.05);
  });

  it('copies chasePos directly (it wraps, so it must not be eased)', () => {
    const c = followCurves(quiet, openingCurves(0.5), 1 / 60);
    expect(c.chasePos).toBe(openingCurves(0.5).chasePos);
  });
});

describe('exposure & bloom', () => {
  it('brightens with charge', () => {
    expect(exposure(0.5, quiet)).toBeGreaterThan(exposure(0, quiet));
    expect(exposure(1, quiet)).toBeGreaterThan(exposure(0.5, quiet));
  });

  it('dips during the inhale', () => {
    expect(exposure(1, openingCurves(2.25))).toBeLessThan(exposure(1, quiet));
  });

  it('never exceeds the caps across the opening and open states', () => {
    for (let t = 0; t <= 6; t += 0.01) {
      const c = openingCurves(t);
      expect(exposure(1, c)).toBeLessThanOrEqual(EXPOSURE_CAP);
      expect(bloomStrength(1, c)).toBeLessThanOrEqual(BLOOM_CAP);
    }
    expect(exposure(1, phaseCurves('open', 0))).toBeLessThanOrEqual(EXPOSURE_CAP);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot load `../src/timeline.js`.

- [ ] **Step 3: Write the implementation**

Create `src/timeline.js`:

```js
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
  const b = 0.45 + 0.45 * charge + 0.5 * curves.surge + 0.2 * curves.chase + 0.15 * curves.open;
  return Math.min(BLOOM_CAP, b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/timeline.js tests/timeline.test.js
git commit -m "feat: add opening/collapse timeline with exposure and bloom curves"
```

---

### Task 4: Glyphs

**Files:**
- Create: `src/glyphs.js`
- Test: `tests/glyphs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (`src/glyphs.js`): `GLYPHS: Array<Array<Array<[x, y]>>>` (12 glyphs → strokes → points, glyph units, x right, y up = outward from the ring centre); `MAX_SEGMENTS = 16`; `flattenGlyph(glyph): { segments: [ax, ay, bx, by][], params: [start, length][] }` where `start`/`length` are fractions of the glyph's total stroke length (pen order).

- [ ] **Step 1: Write the failing tests**

Create `tests/glyphs.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { GLYPHS, MAX_SEGMENTS, flattenGlyph } from '../src/glyphs.js';

describe('GLYPHS', () => {
  it('has 12 distinct glyphs', () => {
    expect(GLYPHS).toHaveLength(12);
    expect(new Set(GLYPHS.map((g) => JSON.stringify(g))).size).toBe(12);
  });

  it('keeps every point inside the carving area', () => {
    for (const glyph of GLYPHS) {
      for (const stroke of glyph) {
        expect(stroke.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of stroke) {
          expect(Math.abs(x)).toBeLessThanOrEqual(0.45);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.45);
        }
      }
    }
  });
});

describe('flattenGlyph', () => {
  it('fits the shader segment budget and parameterises strokes in pen order', () => {
    for (const glyph of GLYPHS) {
      const { segments, params } = flattenGlyph(glyph);
      expect(segments.length).toBeGreaterThan(0);
      expect(segments.length).toBeLessThanOrEqual(MAX_SEGMENTS);
      expect(params[0][0]).toBe(0);
      for (let k = 1; k < params.length; k++) {
        expect(params[k][0]).toBeCloseTo(params[k - 1][0] + params[k - 1][1]);
      }
      const [lastStart, lastLen] = params[params.length - 1];
      expect(lastStart + lastLen).toBeCloseTo(1);
      for (const [, len] of params) expect(len).toBeGreaterThan(0);
    }
  });

  it('splits polylines into consecutive segments', () => {
    const { segments } = flattenGlyph([[[0, 0], [1, 0], [1, 1]]]);
    expect(segments).toEqual([[0, 0, 1, 0], [1, 0, 1, 1]]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot load `../src/glyphs.js`.

- [ ] **Step 3: Write the implementation**

Create `src/glyphs.js`:

```js
// Dethek-inspired runes: vertical stems with angular branches. Invented, not real letters.
// Glyph units: x right, y up (up = outward from the ring centre). Strokes are drawn in order;
// the lighting animation fills them in that order.
// Indices 2, 5, 8, 11 hide the four energies (+, −, ×, ÷) among extra stems and ticks.
export const GLYPHS = [
  // 1
  [[[0, -0.4], [0, 0.4]], [[0, 0.1], [0.25, 0.3]], [[0, -0.15], [0.25, 0.05]]],
  // 2
  [[[0, -0.4], [0, 0.4]], [[-0.25, 0.25], [0, 0.05], [0.25, 0.25]]],
  // 3 — addition
  [
    [[0, -0.4], [0, 0.32]], [[-0.3, 0], [0.3, 0]],
    [[-0.3, 0], [-0.3, 0.12]], [[0.3, 0], [0.3, -0.12]],
    [[-0.1, 0.4], [0, 0.32], [0.1, 0.4]],
  ],
  // 4
  [[[0, -0.4], [0, -0.05]], [[0, -0.05], [0.15, 0.15], [0, 0.35], [-0.15, 0.15], [0, -0.05]]],
  // 5
  [[[-0.15, -0.4], [-0.15, 0.4]], [[-0.15, 0.2], [0.15, 0]], [[0.15, -0.4], [0.15, 0.4]], [[0.15, 0.3], [0.28, 0.4]]],
  // 6 — subtraction
  [[[-0.28, 0], [0.28, 0]], [[-0.28, 0], [-0.28, -0.3]], [[0.28, 0], [0.28, 0.3]], [[0.28, 0.3], [0.18, 0.38]]],
  // 7
  [[[0, -0.4], [0, 0.4]], [[-0.2, -0.2], [0, -0.4], [0.2, -0.2]], [[-0.15, 0.25], [0, 0.4]]],
  // 8
  [[[0, -0.4], [0, 0.4]], [[0, 0.4], [-0.22, 0.18]], [[0, 0], [0.22, -0.22]], [[0, -0.2], [-0.2, -0.38]]],
  // 9 — multiplication
  [[[-0.25, -0.3], [0.25, 0.3]], [[-0.25, 0.3], [0.25, -0.3]], [[0, -0.42], [0, 0.42]], [[-0.1, -0.42], [0.1, -0.42]]],
  // 10
  [[[0, -0.4], [0, 0.4]], [[0, 0.4], [0.22, 0.25], [0, 0.1]], [[0, -0.4], [0.15, -0.3]]],
  // 11
  [[[0, -0.4], [0, 0.4]], [[-0.22, 0.18], [0, 0.4], [0.22, 0.18]], [[-0.18, -0.2], [0, -0.2]]],
  // 12 — division
  [
    [[-0.28, 0], [0.28, 0]],
    [[0, 0.2], [0.05, 0.25], [0, 0.3], [-0.05, 0.25], [0, 0.2]],
    [[0, -0.2], [0.05, -0.25], [0, -0.3], [-0.05, -0.25], [0, -0.2]],
    [[-0.28, 0], [-0.36, 0.1]], [[0.28, 0], [0.36, -0.1]],
  ],
];

export const MAX_SEGMENTS = 16;

export function flattenGlyph(glyph) {
  const segments = [];
  for (const stroke of glyph) {
    for (let k = 0; k < stroke.length - 1; k++) segments.push([...stroke[k], ...stroke[k + 1]]);
  }
  const lengths = segments.map(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay));
  const total = lengths.reduce((a, b) => a + b, 0);
  let acc = 0;
  const params = lengths.map((len) => {
    const p = [acc / total, len / total];
    acc += len;
    return p;
  });
  return { segments, params };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/glyphs.js tests/glyphs.test.js
git commit -m "feat: add Dethek-style rune glyphs with hidden energy signs"
```

---

### Task 5: App shell — input, render loop, overlays, screenshot pipeline

**Files:**
- Create: `index.html`, `src/input.js`, `src/main.js`, `scripts/shoot.mjs`
- Test: `tests/input.test.js`

**Interfaces:**
- Consumes: `createState`, `parseLitParam`, `runeForKey` (Task 1); `glowColor` (Task 2); `fitCameraDistance`, `cameraPose`, `applyCamera` (Task 2); `phaseCurves`, `followCurves` (Task 3).
- Produces:
  - `attachInput(state, actions: { fullscreen?, help?, debug? }, target = window): () => void` (returns detach).
  - `main.js` anchors other tasks edit: `// @imports`, `// @modules`, `// @update`, `// @resize`, and `function render()`. In scope at `// @update`: `state`, `curves`, `color` (`THREE.Color`, linear, current glow colour), `dt`, `t`, `scene`, `camera`, `renderer`.
  - `window.__portal = { state, frames, fps }`.
  - `npm run shoot [filter]` → builds nothing; screenshots `dist/portal.html` into `shots/*.png` at states `0-dormant`, `06-lit`, `11-lit`, `12-open`; exits 1 on any console error or page error.

- [ ] **Step 1: Write the failing test**

Create `tests/input.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { attachInput } from '../src/input.js';
import { createState } from '../src/state.js';

function key(code, extra = {}) {
  const e = new Event('keydown', { cancelable: true });
  Object.assign(e, { code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
  return e;
}

function setup() {
  const target = new EventTarget();
  const state = createState();
  const actions = { fullscreen: vi.fn(), help: vi.fn(), debug: vi.fn() };
  const detach = attachInput(state, actions, target);
  return { target, state, actions, detach };
}

describe('attachInput', () => {
  it('toggles runes from the number row', () => {
    const { target, state } = setup();
    target.dispatchEvent(key('Digit1'));
    target.dispatchEvent(key('Equal'));
    expect(state.lit[0]).toBe(true);
    expect(state.lit[11]).toBe(true);
    target.dispatchEvent(key('Digit1'));
    expect(state.lit[0]).toBe(false);
  });

  it('ignores auto-repeat', () => {
    const { target, state } = setup();
    target.dispatchEvent(key('Digit2'));
    target.dispatchEvent(key('Digit2', { repeat: true }));
    expect(state.lit[1]).toBe(true);
  });

  it('ignores browser shortcuts with Meta/Ctrl/Alt', () => {
    const { target, state, actions } = setup();
    target.dispatchEvent(key('KeyF', { metaKey: true }));
    target.dispatchEvent(key('Digit3', { ctrlKey: true }));
    target.dispatchEvent(key('KeyD', { altKey: true }));
    expect(actions.fullscreen).not.toHaveBeenCalled();
    expect(actions.debug).not.toHaveBeenCalled();
    expect(state.litCount).toBe(0);
  });

  it('Backspace resets and never navigates back', () => {
    const { target, state } = setup();
    target.dispatchEvent(key('Digit4'));
    const e = key('Backspace');
    target.dispatchEvent(e);
    expect(state.litCount).toBe(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it('routes F / H / D to their actions', () => {
    const { target, actions } = setup();
    target.dispatchEvent(key('KeyF'));
    target.dispatchEvent(key('KeyH'));
    target.dispatchEvent(key('KeyD'));
    expect(actions.fullscreen).toHaveBeenCalledOnce();
    expect(actions.help).toHaveBeenCalledOnce();
    expect(actions.debug).toHaveBeenCalledOnce();
  });

  it('detaches cleanly', () => {
    const { target, state, detach } = setup();
    detach();
    target.dispatchEvent(key('Digit1'));
    expect(state.litCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot load `../src/input.js`.

- [ ] **Step 3: Write `src/input.js`**

```js
import { runeForKey } from './state.js';

export function attachInput(state, actions, target = window) {
  function onKey(e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const rune = runeForKey(e.code);
    if (rune !== undefined) {
      e.preventDefault();
      state.toggle(rune);
      return;
    }
    switch (e.code) {
      case 'Backspace':
        e.preventDefault();
        state.reset();
        break;
      case 'KeyF':
        actions.fullscreen?.();
        break;
      case 'KeyH':
        actions.help?.();
        break;
      case 'KeyD':
        actions.debug?.();
        break;
    }
  }
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write `index.html` and `src/main.js`**

Create `index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The Portal</title>
    <style>
      html, body { margin: 0; height: 100%; background: #000; overflow: hidden; cursor: none; }
      canvas { display: block; }
      .overlay {
        position: fixed; display: none; padding: 12px 16px;
        color: #8d96a0; background: rgba(0, 0, 0, 0.8); border: 1px solid #1c1c1c;
        font: 14px/1.6 ui-monospace, Menlo, monospace; white-space: pre;
      }
      .overlay.show { display: block; }
      #help { left: 24px; bottom: 24px; }
      #debug { right: 24px; top: 24px; }
      #error { left: 50%; top: 50%; transform: translate(-50%, -50%); color: #c9a; }
    </style>
  </head>
  <body>
    <div id="help" class="overlay">1 … 0  -  =   light / extinguish runes 1–12
Backspace     extinguish all
F             fullscreen
H             this help
D             fps / state</div>
    <div id="debug" class="overlay"></div>
    <div id="error" class="overlay"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

Create `src/main.js`:

```js
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createState, parseLitParam } from './state.js';
import { glowColor } from './palette.js';
import { phaseCurves, followCurves } from './timeline.js';
import { fitCameraDistance } from './layout.js';
import { cameraPose, applyCamera } from './camera.js';
import { attachInput } from './input.js';
// @imports

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.quality.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  $('error').textContent = 'The portal lost its WebGL context.\nReload the page (Cmd+R).';
  $('error').classList.add('show');
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.05, 50);
let distance = fitCameraDistance(camera.aspect);

// Faint cold rim light: with no runes lit the ring is barely visible in the black.
const rim = new THREE.DirectionalLight(0xa8bcd8, 0.25);
rim.position.set(-1.5, 2, 1.2);
scene.add(rim);

const state = createState();
const preset = parseLitParam(params.get('lit'));
if (preset) state.setInstant(preset);
// @modules

attachInput(state, {
  fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  help: () => $('help').classList.toggle('show'),
  debug: () => $('debug').classList.toggle('show'),
});
if (params.has('debug')) $('debug').classList.add('show');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  distance = fitCameraDistance(camera.aspect);
  // @resize
}
window.addEventListener('resize', resize);

function render() {
  renderer.render(scene, camera);
}

const color = new THREE.Color();
let curves = phaseCurves(state.phase, state.phaseTime);
const portal = { state, frames: 0, fps: 0 };
window.__portal = portal;
let last = performance.now();
let t = 0;
let fpsTime = 0;
let fpsFrames = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.1); // a hidden tab must not fast-forward the portal
  t += dt;

  state.update(dt);
  curves = followCurves(curves, phaseCurves(state.phase, state.phaseTime), dt);
  const [r, g, b] = glowColor(state.charge);
  color.setRGB(r, g, b, THREE.SRGBColorSpace);
  // @update
  applyCamera(camera, cameraPose(t, curves.shake), distance);
  render();

  portal.frames++;
  fpsFrames++;
  fpsTime += raw;
  if (fpsTime >= 0.5) {
    portal.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
    $('debug').textContent = `${portal.fps} fps · ${state.phase} · lit ${state.litCount} · charge ${state.charge.toFixed(2)}`;
  }
});
```

- [ ] **Step 6: Write the screenshot script**

```bash
npm i -D puppeteer-core@^25
```

Create `scripts/shoot.mjs`:

```js
// Screenshots dist/portal.html at fixed states. Usage: npm run shoot [name-filter]
// Set PORTAL_GL=swiftshader if the GPU path fails in headless Chrome.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GL_ARGS = process.env.PORTAL_GL === 'swiftshader'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=metal', '--ignore-gpu-blocklist'];
const SHOTS = [
  ['0-dormant', ''],
  ['06-lit', '1,2,3,4,5,6'],
  ['11-lit', '1,2,3,4,5,6,7,8,9,10,11'],
  ['12-open', 'all'],
];

const file = pathToFileURL(path.resolve('dist/portal.html')).href;
const filter = process.argv[2];
const errors = [];
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });
try {
  for (const [name, lit] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    await page.goto(`${file}?debug=1${lit ? `&lit=${lit}` : ''}`);
    await page.waitForFunction(() => window.__portal?.frames > 30, { timeout: 120000 });
    await page.screenshot({ path: `shots/${name}.png` });
    const info = await page.evaluate(() => ({ phase: window.__portal.state.phase, fps: window.__portal.fps }));
    console.log(name.padEnd(10), JSON.stringify(info));
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
```

- [ ] **Step 7: Build and screenshot**

Run: `npm test && npm run build && npm run shoot`
Expected: tests pass; `dist/portal.html` exists as one file (`ls dist` shows only `portal.html`); shoot prints 4 lines with phases `dormant`, `charging`, `charging`, `open`; exit code 0. Screenshots are black apart from the debug text top-right (nothing rendered yet) — open one with the Read tool to confirm no error overlay.

- [ ] **Step 8: Commit**

```bash
git add index.html src/input.js src/main.js scripts/shoot.mjs tests/input.test.js package.json package-lock.json
git commit -m "feat: add app shell, keyboard input and screenshot pipeline"
```

---

### Task 6: Rune light math

**Files:**
- Create: `src/runeLights.js` (pure helpers only in this task)
- Test: `tests/runeLights.test.js`

**Interfaces:**
- Consumes: `RUNE_COUNT` (Task 1).
- Produces (`src/runeLights.js`): `updateHeat(heat, progress, dt, tau = 1.4): number`; `emberLevel(heat, progress): number` (0..0.8); `runeGlow(i, t, progress, flare): number` (0 when progress is 0, ≤ 2.5); `chaseBoost(i, curves): number` (0..2.5).

- [ ] **Step 1: Write the failing tests**

Create `tests/runeLights.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { updateHeat, emberLevel, runeGlow, chaseBoost } from '../src/runeLights.js';
import { openingCurves, phaseCurves } from '../src/timeline.js';

describe('heat / ember', () => {
  it('has no ember while the rune is lit', () => {
    let heat = 0;
    for (let p = 0; p <= 1; p += 0.1) {
      heat = updateHeat(heat, p, 1 / 60);
      expect(emberLevel(heat, p)).toBe(0);
    }
  });

  it('glows ember red after unlighting, then cools to dark', () => {
    let heat = 1;
    let p = 1;
    for (let k = 0; k < 54; k++) { p = Math.max(0, p - 1 / 54); heat = updateHeat(heat, p, 1 / 60); }
    expect(emberLevel(heat, p)).toBeGreaterThan(0.2);
    for (let k = 0; k < 600; k++) heat = updateHeat(heat, 0, 1 / 60);
    expect(emberLevel(heat, 0)).toBeLessThan(0.01);
  });
});

describe('runeGlow', () => {
  it('is dark when not lit and bounded when flaring', () => {
    expect(runeGlow(3, 12.3, 0, 1)).toBe(0);
    for (let t = 0; t < 30; t += 0.07) {
      const g = runeGlow(5, t, 1, 1);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(2.5 + 1e-9);
    }
  });

  it('breathes out of phase between runes', () => {
    expect(runeGlow(0, 1, 1, 0)).not.toBeCloseTo(runeGlow(1, 1, 1, 0), 3);
  });
});

describe('chaseBoost', () => {
  it('is zero outside the chase', () => {
    expect(chaseBoost(4, phaseCurves('charging', 0))).toBe(0);
  });

  it('peaks at the chase head and is near zero opposite it', () => {
    const c = { ...openingCurves(0.5), chasePos: 0.25 }; // head at rune index 3
    expect(chaseBoost(3, c)).toBeGreaterThan(2);
    expect(chaseBoost(9, c)).toBeLessThan(0.01);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot load `../src/runeLights.js`.

- [ ] **Step 3: Write the implementation**

Create `src/runeLights.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runeLights.js tests/runeLights.test.js
git commit -m "feat: add rune glow, flare, ember and chase math"
```

---

### Task 7: Stone ring + rune lighting (rendered)

**Files:**
- Create: `src/glsl/noise.js`, `src/ring.js`
- Modify: `src/runeLights.js` (append `createRuneLights`), `src/main.js` (anchors)

**Interfaces:**
- Consumes: `CONFIG.ring`; `runeAngle`, `runeCenter` (Task 2); `GLYPHS`, `MAX_SEGMENTS`, `flattenGlyph` (Task 4); `updateHeat`, `emberLevel`, `runeGlow`, `chaseBoost` (Task 6); `state`, `curves`, `color`, `dt`, `t` at `// @update` (Task 5).
- Produces:
  - `NOISE_GLSL` (string: `snoise(vec3)`, `fbm(vec3)`).
  - `createRing(cfg = CONFIG.ring): { group: THREE.Group, blocks: Array<{ mesh, uniforms }> }` — per-block `uniforms` include `uGlow` (float, HDR emissive gain applied), `uProgress`, `uEmber`, `uRuneColor` (`THREE.Color`).
  - `createRuneLights(scene, ring): { glows: number[12], burst(i, count), update(state, curves, color, dt, t) }` — `glows[i]` is the unscaled glow (0..~6) used later by the mercury reflections.

- [ ] **Step 1: Write `src/glsl/noise.js`**

```js
// 3D simplex noise — Ian McEwan, Stefan Gustavson (Ashima Arts), MIT licence. Plus fbm.
export const NOISE_GLSL = /* glsl */ `
vec3 pn_mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pn_mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 pn_permute(vec4 x) { return pn_mod289(((x * 34.0) + 10.0) * x); }
vec4 pn_taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = pn_mod289(i);
  vec4 p = pn_permute(pn_permute(pn_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = pn_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * snoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return s;
}
`;
```

- [ ] **Step 2: Write `src/ring.js`**

```js
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { runeAngle, runeCenter } from './layout.js';
import { GLYPHS, MAX_SEGMENTS, flattenGlyph } from './glyphs.js';
import { NOISE_GLSL } from './glsl/noise.js';

const VERTEX_HEAD = /* glsl */ `
uniform vec2 uBlockOffset;
uniform float uChipAmount;
varying vec3 vRingPos;
varying vec3 vObjNormal;
${NOISE_GLSL}
`;

// Displacement depends on position only, so vertices shared by faces stay welded (no cracks).
const VERTEX_DISPLACE = /* glsl */ `
#include <begin_vertex>
vRingPos = position + vec3(uBlockOffset, 0.0);
vObjNormal = normal;
vec3 np = vRingPos * 9.0;
vec3 chip = vec3(snoise(np), snoise(np + 31.7), snoise(np + 71.3));
np = vRingPos * 31.0;
chip += 0.4 * vec3(snoise(np), snoise(np + 13.1), snoise(np + 47.9));
transformed += chip * uChipAmount;
`;

const FRAGMENT_HEAD = /* glsl */ `
#define MAX_SEG ${MAX_SEGMENTS}
#define GROOVE_W 0.05
#define GROOVE_DEPTH 0.4
uniform vec2 uGlyphCenter;
uniform vec2 uGlyphUp;
uniform float uGlyphSize;
uniform vec4 uSeg[MAX_SEG];
uniform vec2 uSegParam[MAX_SEG];
uniform int uSegCount;
uniform float uSeed;
uniform float uBumpScale;
uniform float uGlow;
uniform float uProgress;
uniform float uEmber;
uniform vec3 uRuneColor;
varying vec3 vRingPos;
varying vec3 vObjNormal;
${NOISE_GLSL}

// Weathered basalt relief: broad undulation, grain, pits, hairline cracks.
float stoneHeight(vec3 p) {
  float h = 0.6 * fbm(p * 6.0);
  h += 0.25 * snoise(p * 38.0);
  h -= 0.4 * smoothstep(0.55, 0.8, snoise(p * 22.0 + 3.7));
  float crack = 1.0 - abs(snoise(p * 4.5 + 11.0));
  h -= 1.2 * smoothstep(0.965, 0.995, crack);
  return h;
}

vec2 glyphCoords(vec2 xy) {
  vec2 rel = xy - uGlyphCenter;
  vec2 right = vec2(uGlyphUp.y, -uGlyphUp.x);
  return vec2(dot(rel, right), dot(rel, uGlyphUp)) / uGlyphSize;
}

// x: distance to the nearest stroke (glyph units), y: pen-order position along the glyph (0..1).
vec2 glyphField(vec2 q) {
  float best = 1e3;
  float along = 0.0;
  for (int k = 0; k < MAX_SEG; k++) {
    if (k >= uSegCount) break;
    vec2 a = uSeg[k].xy;
    vec2 ab = uSeg[k].zw - a;
    float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(q - a - ab * t);
    if (d < best) {
      best = d;
      along = uSegParam[k].x + uSegParam[k].y * t;
    }
  }
  return vec2(best, along);
}

float grooveProfile(float d) { return 1.0 - smoothstep(GROOVE_W * 0.3, GROOVE_W, d); }

float surfaceHeight(vec3 p, bool front) {
  float h = stoneHeight(p + uSeed);
  if (front) h -= GROOVE_DEPTH * grooveProfile(glyphField(glyphCoords(p.xy)).x);
  return h;
}
`;

const FRAGMENT_ALBEDO = /* glsl */ `
#include <map_fragment>
bool isFront = vObjNormal.z > 0.5;
vec2 gField = isFront ? glyphField(glyphCoords(vRingPos.xy)) : vec2(1.0, 0.0);
float groove = grooveProfile(gField.x);
float hHere = stoneHeight(vRingPos + uSeed);
float tone = 0.5 + 0.5 * fbm(vRingPos * 2.5 + uSeed * 1.7);
vec3 stone = mix(vec3(0.026, 0.026, 0.03), vec3(0.062, 0.06, 0.056), tone);
stone += vec3(0.05) * smoothstep(0.72, 0.92, snoise(vRingPos * 90.0 + uSeed));
stone *= 1.0 - 0.55 * (1.0 - smoothstep(-0.8, -0.15, hHere));
stone *= 1.0 - 0.6 * groove;
diffuseColor.rgb = stone;
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(0.9 - 0.32 * smoothstep(0.15, 0.6, hHere), 0.3, 1.0);
`;

// Bump from the analytic height field. The ring sits unrotated at the origin and block tilts are
// tiny, so object space ≈ world space and mat3(viewMatrix) takes the gradient to view space.
const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  const float eps = 0.0015;
  float h0 = surfaceHeight(vRingPos, isFront);
  vec3 grad = vec3(
    surfaceHeight(vRingPos + vec3(eps, 0.0, 0.0), isFront) - h0,
    surfaceHeight(vRingPos + vec3(0.0, eps, 0.0), isFront) - h0,
    surfaceHeight(vRingPos + vec3(0.0, 0.0, eps), isFront) - h0) / eps;
  vec3 gv = mat3(viewMatrix) * (grad * uBumpScale);
  normal = normalize(normal - (gv - dot(gv, normal) * normal));
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
if (isFront) {
  float core = 1.0 - smoothstep(GROOVE_W * 0.5, GROOVE_W * 1.1, gField.x);
  float reveal = smoothstep(gField.y - 0.06, gField.y, uProgress * 1.06) * step(0.001, uProgress);
  totalEmissiveRadiance += uRuneColor * (core * reveal * uGlow);
  totalEmissiveRadiance += vec3(0.32, 0.035, 0.006) * (core * uEmber);
}
`;

function blockGeometry(i, cfg) {
  const a = runeAngle(i);
  const rOut = cfg.outer - cfg.bevel;
  const rIn = cfg.inner + cfg.bevel;
  // End faces are offset parallel to the radial line so seams stay a constant width after bevelling.
  const off = cfg.bevel + cfg.seam / 2;
  const hOut = Math.PI / 12 - Math.asin(off / rOut);
  const hIn = Math.PI / 12 - Math.asin(off / rIn);
  const shape = new THREE.Shape();
  shape.moveTo(rOut * Math.cos(a - hOut), rOut * Math.sin(a - hOut));
  shape.absarc(0, 0, rOut, a - hOut, a + hOut, false);
  shape.lineTo(rIn * Math.cos(a + hIn), rIn * Math.sin(a + hIn));
  shape.absarc(0, 0, rIn, a + hIn, a - hIn, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: cfg.depth,
    steps: 3,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: cfg.bevel,
    bevelSize: cfg.bevel,
    bevelSegments: 5,
  });
  geo.translate(0, 0, -(cfg.depth + cfg.bevel)); // front face at z = 0
  return geo;
}

function stoneMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_DISPLACE);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <map_fragment>', FRAGMENT_ALBEDO)
      .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE);
  };
  return material;
}

export function createRing(cfg = CONFIG.ring) {
  const group = new THREE.Group();
  const rMid = (cfg.inner + cfg.outer) / 2;
  const blocks = GLYPHS.map((glyph, i) => {
    const a = runeAngle(i);
    const c = runeCenter(i, rMid);
    const rnd = (k) => {
      const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const { segments, params } = flattenGlyph(glyph);
    const uniforms = {
      uBlockOffset: { value: new THREE.Vector2(c.x, c.y) },
      uChipAmount: { value: cfg.chipAmount },
      uGlyphCenter: { value: new THREE.Vector2(c.x, c.y) },
      uGlyphUp: { value: new THREE.Vector2(Math.cos(a), Math.sin(a)) },
      uGlyphSize: { value: cfg.glyphSize },
      uSeg: { value: Array.from({ length: MAX_SEGMENTS }, (_, k) => new THREE.Vector4(...(segments[k] ?? [0, 0, 0, 0]))) },
      uSegParam: { value: Array.from({ length: MAX_SEGMENTS }, (_, k) => new THREE.Vector2(...(params[k] ?? [0, 0]))) },
      uSegCount: { value: segments.length },
      uSeed: { value: i * 7.31 },
      uBumpScale: { value: cfg.bumpScale },
      uGlow: { value: 0 },
      uProgress: { value: 0 },
      uEmber: { value: 0 },
      uRuneColor: { value: new THREE.Color(1, 0.5, 0.1) },
    };
    const geo = blockGeometry(i, cfg);
    geo.translate(-c.x, -c.y, 0); // pivot at the block centre so tilts stay local
    const mesh = new THREE.Mesh(geo, stoneMaterial(uniforms));
    mesh.position.set(c.x, c.y, (rnd(4) - 0.5) * 0.012);
    mesh.rotation.set((rnd(1) - 0.5) * 0.02, (rnd(2) - 0.5) * 0.02, (rnd(3) - 0.5) * 0.006);
    mesh.scale.setScalar(1 + (rnd(5) - 0.5) * 0.015);
    group.add(mesh);
    return { mesh, uniforms };
  });
  return { group, blocks };
}
```

- [ ] **Step 3: Append `createRuneLights` to `src/runeLights.js`**

Add these imports at the top of `src/runeLights.js` (above the existing `import { RUNE_COUNT } ...`):

```js
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { runeAngle, runeCenter } from './layout.js';
```

Append to the end of `src/runeLights.js`:

```js
const EMISSIVE_GAIN = 6;
const LIGHT_GAIN = 0.35;
const MAX_EMBERS = 600;

function emberSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createRuneLights(scene, ring) {
  const rMid = (CONFIG.ring.inner + CONFIG.ring.outer) / 2;
  const heat = new Array(RUNE_COUNT).fill(0);
  const flare = new Array(RUNE_COUNT).fill(0);
  const prevProgress = new Array(RUNE_COUNT).fill(0);
  const glows = new Array(RUNE_COUNT).fill(0);

  const lights = Array.from({ length: RUNE_COUNT }, (_, i) => {
    const c = runeCenter(i, rMid);
    const light = new THREE.PointLight(0xffaa55, 0, 1.4, 2);
    light.position.set(c.x, c.y, 0.12);
    scene.add(light);
    return light;
  });

  const positions = new Float32Array(MAX_EMBERS * 3);
  const colors = new Float32Array(MAX_EMBERS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.014,
    map: emberSprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const embers = [];
  let lastOpeningTime = -1;

  // Embers rise "up" out of the groove: outward from the ring centre and toward the viewer.
  function burst(i, count) {
    const a = runeAngle(i);
    const c = runeCenter(i, rMid);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (let k = 0; k < count && embers.length < MAX_EMBERS; k++) {
      const s = (Math.random() - 0.5) * 0.16;
      const u = (Math.random() - 0.5) * 0.16;
      const speed = 0.04 + Math.random() * 0.06;
      embers.push({
        x: c.x + uy * s + ux * u,
        y: c.y - ux * s + uy * u,
        z: 0.01,
        vx: ux * speed + (Math.random() - 0.5) * 0.03,
        vy: uy * speed + (Math.random() - 0.5) * 0.03,
        vz: 0.03 + Math.random() * 0.06,
        age: 0,
        life: 1.2 + Math.random(),
      });
    }
  }

  function update(state, curves, color, dt, t) {
    for (let i = 0; i < RUNE_COUNT; i++) {
      const p = state.progress[i];
      if (prevProgress[i] < 1 && p >= 1) flare[i] = 1;
      prevProgress[i] = p;
      flare[i] *= Math.exp(-dt / 0.25);
      heat[i] = updateHeat(heat[i], p, dt);
      const g = runeGlow(i, t, p, flare[i]) * (1 + chaseBoost(i, curves)) * (1 + 0.6 * curves.open);
      glows[i] = g;
      const u = ring.blocks[i].uniforms;
      u.uGlow.value = g * EMISSIVE_GAIN;
      u.uProgress.value = p;
      u.uEmber.value = emberLevel(heat[i], p);
      u.uRuneColor.value.copy(color);
      lights[i].color.copy(color);
      lights[i].intensity = g * LIGHT_GAIN;
    }

    if (state.phase === 'opening') {
      if (lastOpeningTime < 1.0 && state.phaseTime >= 1.0) for (let i = 0; i < RUNE_COUNT; i++) burst(i, 25);
      lastOpeningTime = state.phaseTime;
    } else {
      lastOpeningTime = -1;
    }

    const drag = Math.exp(-dt * 0.8);
    for (let k = embers.length - 1; k >= 0; k--) {
      const e = embers[k];
      e.age += dt;
      if (e.age >= e.life) {
        embers.splice(k, 1);
        continue;
      }
      e.vx *= drag;
      e.vy *= drag;
      e.vz *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
    }
    embers.forEach((e, k) => {
      const fade = Math.pow(1 - e.age / e.life, 1.5) * Math.min(1, e.age * 8) * 2;
      positions.set([e.x, e.y, e.z], k * 3);
      colors.set([color.r * fade, color.g * fade, color.b * fade], k * 3);
    });
    geo.setDrawRange(0, embers.length);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { glows, burst, update };
}
```

- [ ] **Step 4: Wire into `src/main.js`**

Replace the line `// @imports` with:

```js
import { createRing } from './ring.js';
import { createRuneLights } from './runeLights.js';
// @imports
```

Replace the line `// @modules` with:

```js
const ring = createRing();
scene.add(ring.group);
const runeLights = createRuneLights(scene, ring);
state.onIgnite((i) => runeLights.burst(i, 18));
// @modules
```

Replace the line `// @update` with:

```js
runeLights.update(state, curves, color, dt, t);
// @update
```

- [ ] **Step 5: Verify unit tests still pass, build, screenshot**

Run: `npm test && npm run build && npm run shoot`
Expected: tests PASS; shoot exits 0 (no shader compile errors — a broken shader logs `THREE.WebGLProgram: Shader Error` as a console error and fails the run).

Open `shots/0-dormant.png`, `shots/06-lit.png`, `shots/12-open.png` with the Read tool and check:
- 0-dormant: a dark ring of 12 blocks barely visible against black; seams between blocks visible; no rune glow.
- 06-lit: runes 1–6 (1 o'clock to 6 o'clock) glow gold in carved strokes; nearby stone is lit warm and shows grain/pits; runes 7–12 dark.
- 12-open: all 12 glow blue-white.
- Stone reads as rough rock (not plastic, not flat grey). If too bright/dark or too smooth, tune only `CONFIG.ring.bumpScale`, `LIGHT_GAIN`, `EMISSIVE_GAIN` and the rim light intensity, re-run, and note the final values in the commit message.

- [ ] **Step 6: Commit**

```bash
git add src/glsl/noise.js src/ring.js src/runeLights.js src/main.js
git commit -m "feat: render basalt ring with carved, glowing runes and embers"
```

---

### Task 8: Ripple driver

**Files:**
- Create: `src/rippleDriver.js`
- Test: `tests/rippleDriver.test.js`

**Interfaces:**
- Consumes: `runeAngle` (Task 2); `smoothstep` (Task 3).
- Produces (`src/rippleDriver.js`): `MAX_IMPULSES = 16`; `createRippleDriver(rand = Math.random): { ignite(i), update(snap, curves, dt): Impulse[] }` where `snap` has `{ charge, litCount, energies: {add, sub, mul, div} }` (the state object satisfies this) and `Impulse = { x, y, r, s }` in disc coordinates (−1..1, disc radius = 1): Gaussian height bump of radius `r` and signed strength `s`. Returns at most `MAX_IMPULSES` per call.

- [ ] **Step 1: Write the failing tests**

Create `tests/rippleDriver.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createRippleDriver, MAX_IMPULSES } from '../src/rippleDriver.js';
import { phaseCurves } from '../src/timeline.js';

const quiet = phaseCurves('charging', 0);
const noEnergy = { add: 0, sub: 0, mul: 0, div: 0 };
const snap = (litCount, energies = noEnergy) => ({ litCount, charge: litCount / 12, energies });

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalForce(litCount, seconds = 10) {
  const d = createRippleDriver(seeded(42));
  let sum = 0;
  for (let k = 0; k < seconds * 60; k++) {
    for (const im of d.update(snap(litCount), quiet, 1 / 60)) sum += Math.abs(im.s);
  }
  return sum;
}

describe('createRippleDriver', () => {
  it('leaves the mercury still when no rune is lit', () => {
    const d = createRippleDriver(seeded(1));
    let count = 0;
    for (let k = 0; k < 600; k++) count += d.update(snap(0), phaseCurves('dormant', 0), 1 / 60).length;
    expect(count).toBe(0);
  });

  it('drives harder the more runes are lit', () => {
    const f3 = totalForce(3);
    const f6 = totalForce(6);
    const f11 = totalForce(11);
    expect(f3).toBeGreaterThan(0);
    expect(f6).toBeGreaterThan(f3 * 1.5);
    expect(f11).toBeGreaterThan(f6 * 1.5);
  });

  it('launches a ripple from the lit rune\'s rim position', () => {
    const d = createRippleDriver(seeded(1));
    d.ignite(11); // rune 12, top
    const out = d.update(snap(1), quiet, 1 / 60);
    const rim = out.find((im) => im.r === 0.08);
    expect(rim.x).toBeCloseTo(0, 5);
    expect(rim.y).toBeCloseTo(0.9, 5);
    expect(rim.s).toBeGreaterThan(0);
  });

  it('× energy echoes every ripple twice', () => {
    const d = createRippleDriver(seeded(1));
    const e = { ...noEnergy, mul: 1 };
    d.update(snap(1, e), quiet, 1 / 60);
    d.ignite(0);
    let rims = 0;
    for (let k = 0; k < 30; k++) rims += d.update(snap(1, e), quiet, 1 / 60).filter((im) => im.r === 0.08).length;
    expect(rims).toBe(3);
  });

  it('÷ energy adds four symmetric off-centre sources', () => {
    const d = createRippleDriver(seeded(1));
    const out = d.update(snap(6, { ...noEnergy, div: 1 }), quiet, 0.05);
    const at = (x, y) => out.some((im) => Math.abs(im.x - x) < 1e-9 && Math.abs(im.y - y) < 1e-9);
    expect(at(0.4, 0) && at(-0.4, 0) && at(0, 0.4) && at(0, -0.4)).toBe(true);
  });

  it('caps impulses per frame and delivers the backlog later', () => {
    const d = createRippleDriver(seeded(1));
    for (let k = 0; k < 40; k++) d.ignite(k % 12);
    let delivered = 0;
    for (let k = 0; k < 5; k++) {
      const out = d.update(snap(12), quiet, 1 / 60);
      expect(out.length).toBeLessThanOrEqual(MAX_IMPULSES);
      delivered += out.filter((im) => im.r === 0.08).length;
    }
    expect(delivered).toBe(40);
  });

  it('does not flood the sim after a huge dt', () => {
    const d = createRippleDriver(seeded(1));
    const out = d.update(snap(11), phaseCurves('collapsing', 0.5), 5);
    expect(out.length).toBeLessThanOrEqual(MAX_IMPULSES);
  });

  it('fires one big splash when the opening splash begins', () => {
    const d = createRippleDriver(seeded(1));
    const before = { ...quiet, splash: 0, open: 1 };
    const during = { ...quiet, splash: 0.5, open: 1 };
    d.update(snap(12), before, 1 / 60);
    const out = d.update(snap(12), during, 1 / 60);
    expect(out.filter((im) => im.r === 0.3)).toHaveLength(1);
    expect(d.update(snap(12), during, 1 / 60).filter((im) => im.r === 0.3)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot load `../src/rippleDriver.js`.

- [ ] **Step 3: Write the implementation**

Create `src/rippleDriver.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rippleDriver.js tests/rippleDriver.test.js
git commit -m "feat: add ripple driver with charge scaling and hidden energies"
```

---

### Task 9: GPU wave sim + mercury event horizon (rendered)

**Files:**
- Create: `src/waveSim.js`, `src/mercury.js`
- Modify: `src/main.js` (anchors)

**Interfaces:**
- Consumes: `MAX_IMPULSES`, `createRippleDriver` (Task 8); `CONFIG.mercury`, `CONFIG.quality`; `runeLights.glows` (Task 7); `state`, `curves`, `color`, `dt`, `t` at `// @update`.
- Produces:
  - `createWaveSim(renderer, size = CONFIG.quality.simSize): { texture: THREE.Texture (getter, R = height), size, step(impulses: Impulse[], substeps: number) }`
  - `createMercury(sim, cfg = CONFIG.mercury): { mesh: THREE.Mesh, light: THREE.PointLight, update(state, curves, color, glows, t) }`

- [ ] **Step 1: Write `src/waveSim.js`**

```js
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CONFIG } from './config.js';
import { MAX_IMPULSES } from './rippleDriver.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Discrete wave equation on a heightfield; R = height now, G = height last step.
// Cells outside the disc are held at 0, so waves reflect off the stone rim.
const fragmentShader = /* glsl */ `
#define MAX_IMP ${MAX_IMPULSES}
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec4 uImp[MAX_IMP];
uniform int uImpCount;
uniform float uWave;
uniform float uDamping;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  if (length(p) > 0.985) { gl_FragColor = vec4(0.0); return; }
  vec4 s = texture2D(uState, vUv);
  float n = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
  float so = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
  float e = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float w = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float next = (2.0 * s.r - s.g + uWave * (n + so + e + w - 4.0 * s.r)) * uDamping;
  for (int k = 0; k < MAX_IMP; k++) {
    if (k >= uImpCount) break;
    vec2 d = p - uImp[k].xy;
    next += uImp[k].w * exp(-dot(d, d) / (uImp[k].z * uImp[k].z));
  }
  gl_FragColor = vec4(clamp(next, -2.0, 2.0), s.r, 0.0, 1.0);
}
`;

export function createWaveSim(renderer, size = CONFIG.quality.simSize) {
  const options = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  };
  let read = new THREE.WebGLRenderTarget(size, size, options);
  let write = new THREE.WebGLRenderTarget(size, size, options);
  const uniforms = {
    uState: { value: null },
    uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
    uImp: { value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4()) },
    uImpCount: { value: 0 },
    uWave: { value: 0.45 }, // must stay ≤ 0.5 for stability
    uDamping: { value: 0.996 },
  };
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));

  function step(impulses, substeps) {
    const previous = renderer.getRenderTarget();
    for (let k = 0; k < substeps; k++) {
      const list = k === 0 ? impulses.slice(0, MAX_IMPULSES) : [];
      list.forEach((im, j) => uniforms.uImp.value[j].set(im.x, im.y, im.r, im.s));
      uniforms.uImpCount.value = list.length;
      uniforms.uState.value = read.texture;
      renderer.setRenderTarget(write);
      quad.render(renderer);
      [read, write] = [write, read];
    }
    renderer.setRenderTarget(previous);
  }

  return {
    get texture() { return read.texture; },
    size,
    step,
  };
}
```

- [ ] **Step 2: Write `src/mercury.js`**

```js
import * as THREE from 'three';
import { CONFIG } from './config.js';

const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uSim;
uniform float uRadius;
uniform float uDisp;
uniform float uShapeScale;
uniform float uTime;
uniform float uCharge;
uniform vec4 uEnergy; // add, sub, mul, div
uniform float uInhale;
uniform float uSurge;

// Slow, large-scale shape of the liquid (units: × uShapeScale).
float shapeHeight(vec2 q) {
  float r2 = dot(q, q);
  float rim = 1.0 - smoothstep(0.75, 1.0, sqrt(r2));
  float ang = atan(q.y, q.x + 1e-5);
  float breath = 0.15 * sin(uTime * 0.5) * (1.0 - r2);
  float dome = 0.9 * uEnergy.x * (1.0 - r2);
  float drain = -uEnergy.y * (1.1 * exp(-r2 * 3.0)
    + 0.12 * sin(ang * 3.0 - uTime * 0.8 + sqrt(r2) * 9.0) * (1.0 - r2));
  float swell = 0.6 * smoothstep(0.75, 1.0, uCharge) * (1.0 - r2);
  float inhale = -2.0 * uInhale * exp(-r2 * 4.0);
  return (breath + dome + drain + swell + inhale) * rim;
}

// Opening surge: the liquid erupts toward the viewer.
float plume(vec2 q) {
  float r2 = dot(q, q);
  return uSurge * 1.1 * exp(-r2 / 0.12) * (1.0 + 0.08 * sin(atan(q.y, q.x + 1e-5) * 5.0 + uTime * 6.0));
}

float totalHeight(vec2 q) {
  return texture2D(uSim, q * 0.5 + 0.5).r * uDisp + shapeHeight(q) * uShapeScale + plume(q);
}
`;

const vertexShader = /* glsl */ `
${HEIGHT_GLSL}
varying vec2 vDisc;
varying vec3 vWorldPos;
void main() {
  vec2 q = position.xy / uRadius;
  vDisc = q;
  vec3 pos = vec3(position.xy, length(q) <= 1.0 ? totalHeight(q) : 0.0);
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${HEIGHT_GLSL}
uniform float uSimTexel;
uniform float uOpen;
uniform float uCollapse;
uniform vec3 uColor;
uniform float uGlow[12];
varying vec2 vDisc;
varying vec3 vWorldPos;

float microWaves(vec2 q) {
  float a = sin(dot(q, vec2(41.0, 13.0)) + uTime * 2.3)
          + sin(dot(q, vec2(-17.0, 37.0)) - uTime * 1.9)
          + sin(dot(q, vec2(29.0, -31.0)) + uTime * 2.9);
  return a * (0.0004 + 0.0018 * uCharge);
}

// Procedural surroundings the liquid reflects: a soft silver studio gradient
// plus a ring of 12 lights mirroring the runes (seen when waves tilt the surface).
vec3 env(vec3 R) {
  float front = max(R.z, 0.0);
  vec3 sky = vec3(0.55, 0.58, 0.62) * (0.08 + 0.5 * uCharge + 0.6 * uOpen) * pow(front, 3.0);
  sky += vec3(0.9, 0.92, 1.0) * (0.04 + 0.35 * uCharge) * smoothstep(0.55, 0.95, R.y * 0.8 + R.z * 0.4);
  float lr = length(R.xy);
  float a = atan(R.y, R.x + 1e-5);
  float runes = 0.0;
  for (int i = 0; i < 12; i++) {
    float ai = 1.5707963 - float(i + 1) * 0.5235988;
    float da = abs(mod(a - ai + 3.14159265, 6.2831853) - 3.14159265);
    runes += uGlow[i] * exp(-da * da * 40.0);
  }
  runes *= exp(-pow((lr - 0.35) * 9.0, 2.0));
  return sky + uColor * runes * 3.0;
}

void main() {
  float rr = length(vDisc);
  if (rr > 1.0) discard;
  float e = uSimTexel;
  float hx = totalHeight(vDisc + vec2(e, 0.0)) - totalHeight(vDisc - vec2(e, 0.0))
           + microWaves(vDisc + vec2(e, 0.0)) - microWaves(vDisc - vec2(e, 0.0));
  float hy = totalHeight(vDisc + vec2(0.0, e)) - totalHeight(vDisc - vec2(0.0, e))
           + microWaves(vDisc + vec2(0.0, e)) - microWaves(vDisc - vec2(0.0, e));
  vec3 N = normalize(vec3(-hx, -hy, 2.0 * e * uRadius));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 R = reflect(-V, N);
  float NoV = max(dot(N, V), 0.0);
  vec3 F0 = vec3(0.78, 0.78, 0.8);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
  vec3 col = env(R) * F;

  // Light from within: brighter on crests, strongest once open.
  float crest = clamp(texture2D(uSim, vDisc * 0.5 + 0.5).r * 8.0, -1.0, 1.0);
  col += uColor * (0.02 + 0.25 * uCharge * uCharge + 1.6 * uOpen) * (0.6 + 0.4 * crest);

  // Faint slow rays once open.
  float ang = atan(vDisc.y, vDisc.x + 1e-5);
  float rays = pow(abs(sin(ang * 13.0 + uTime * 0.2) * sin(ang * 7.0 - uTime * 0.13)), 6.0);
  col += uColor * rays * (1.0 - rr) * uOpen * 0.5;

  // Collapse: slow uneven flicker (≤ ~1.5 Hz, never a strobe).
  col *= 1.0 - 0.35 * uCollapse * (0.5 + 0.5 * sin(uTime * 9.0) * sin(uTime * 5.3));

  // Meniscus: darker where the liquid meets the stone.
  col *= mix(0.35, 1.0, 1.0 - smoothstep(0.94, 1.0, rr));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createMercury(sim, cfg = CONFIG.mercury) {
  const segments = CONFIG.quality.mercurySegments;
  const uniforms = {
    uSim: { value: sim.texture },
    uSimTexel: { value: 2 / sim.size },
    uRadius: { value: cfg.radius },
    uDisp: { value: cfg.displacement },
    uShapeScale: { value: cfg.shapeScale },
    uTime: { value: 0 },
    uCharge: { value: 0 },
    uEnergy: { value: new THREE.Vector4() },
    uInhale: { value: 0 },
    uSurge: { value: 0 },
    uOpen: { value: 0 },
    uCollapse: { value: 0 },
    uColor: { value: new THREE.Color() },
    uGlow: { value: new Array(12).fill(0) },
  };
  const geometry = new THREE.PlaneGeometry(cfg.radius * 2, cfg.radius * 2, segments, segments);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.position.z = cfg.z;
  mesh.frustumCulled = false; // the plume leaves the plane's bounding box

  // Lights the inner rim of the stone from the liquid.
  const light = new THREE.PointLight(0xffffff, 0, 3, 2);
  light.position.set(0, 0, 0.35);

  function update(state, curves, color, glows, t) {
    const en = state.energies;
    uniforms.uSim.value = sim.texture;
    uniforms.uTime.value = t;
    uniforms.uCharge.value = state.charge;
    uniforms.uEnergy.value.set(en.add, en.sub, en.mul, en.div);
    uniforms.uInhale.value = curves.inhale;
    uniforms.uSurge.value = curves.surge;
    uniforms.uOpen.value = curves.open;
    uniforms.uCollapse.value = curves.collapse;
    uniforms.uColor.value.copy(color);
    for (let i = 0; i < 12; i++) uniforms.uGlow.value[i] = glows[i];
    light.color.copy(color);
    light.intensity = 0.02 + 0.6 * state.charge * state.charge + 2.5 * curves.open + 4 * curves.surge;
  }

  return { mesh, light, update };
}
```

- [ ] **Step 3: Wire into `src/main.js`**

Replace the line `// @imports` with:

```js
import { createWaveSim } from './waveSim.js';
import { createRippleDriver } from './rippleDriver.js';
import { createMercury } from './mercury.js';
// @imports
```

Replace the line `// @modules` with:

```js
const sim = createWaveSim(renderer);
const ripples = createRippleDriver();
state.onIgnite((i) => ripples.ignite(i));
const mercury = createMercury(sim);
scene.add(mercury.mesh, mercury.light);
let simClock = 0;
// @modules
```

Replace the line `// @update` with:

```js
const impulses = ripples.update(state, curves, dt);
simClock += dt * CONFIG.quality.simHz;
const steps = Math.max(1, Math.min(4, Math.floor(simClock)));
simClock = Math.max(0, simClock - steps);
sim.step(impulses, steps);
mercury.update(state, curves, color, runeLights.glows, t);
// @update
```

- [ ] **Step 4: Verify, build, screenshot**

Run: `npm test && npm run build && npm run shoot`
Expected: tests PASS; shoot exits 0.

Open the four screenshots with the Read tool and check:
- 0-dormant: mercury is a dim, smooth, slightly silver mirror inside the ring — not pure black, not grey plastic.
- 06-lit: visible concentric ripples and scattered droplet rings; silver sheen with warm glints.
- 11-lit: clearly rougher than 06 — crossing wave trains, more glints of the rune colour.
- 12-open: liquid glows blue-white from within, faint rays, still reads as liquid.
- The disc edge is hidden behind the stone's inner rim (no visible gap or overlap).

If ripples are invisible or the surface looks like noise, tune only `CONFIG.mercury.displacement` (sim height → world) and re-run. Note final values in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/waveSim.js src/mercury.js src/main.js src/config.js
git commit -m "feat: add GPU wave sim and liquid mercury event horizon"
```

---

### Task 10: Post-processing, final build and acceptance

**Files:**
- Create: `src/postfx.js`
- Modify: `src/main.js` (anchors + `render()`)

**Interfaces:**
- Consumes: `exposure`, `bloomStrength` (Task 3); `renderer`, `scene`, `camera`, `state`, `curves`, `t` from `main.js`.
- Produces: `createPostFx(renderer, scene, camera): { setSize(w, h), update(state, curves, t), render() }`.

- [ ] **Step 1: Write `src/postfx.js`**

```js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { exposure, bloomStrength } from './timeline.js';

// Runs after tone mapping. Vignette and grain are multiplicative so pure black stays pure black
// on the OLED; the clamp guarantees no full-white frame.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.07 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.8);
      c.rgb *= mix(0.55, 1.0, 1.0 - smoothstep(0.25, 0.85, length(d)));
      c.rgb *= 1.0 + (hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      c.rgb = clamp(c.rgb, 0.0, 0.96);
      gl_FragColor = c;
    }
  `,
};

export function createPostFx(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * ratio, size.y * ratio, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.55, 0.8);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  return {
    setSize(w, h) {
      composer.setSize(w, h);
    },
    update(state, curves, t) {
      renderer.toneMappingExposure = exposure(state.charge, curves);
      bloom.strength = bloomStrength(state.charge, curves);
      finish.uniforms.uTime.value = t;
    },
    render() {
      composer.render();
    },
  };
}
```

- [ ] **Step 2: Wire into `src/main.js`**

Replace the line `// @imports` with:

```js
import { createPostFx } from './postfx.js';
```

Replace the line `// @modules` with:

```js
const post = createPostFx(renderer, scene, camera);
```

Replace the line `// @resize` with:

```js
post.setSize(w, h);
```

Replace the line `// @update` with:

```js
post.update(state, curves, t);
```

Replace:

```js
function render() {
  renderer.render(scene, camera);
}
```

with:

```js
function render() {
  post.render();
}
```

- [ ] **Step 3: Full verification**

Run: `npm test && npm run build && npm run shoot`
Expected: all tests PASS; `ls dist` shows only `portal.html`; `grep -cE '<script[^>]+src=|<link[^>]+href=' dist/portal.html` prints 0 (no external references); shoot exits 0.

Open the four screenshots with the Read tool and check:
- Rune strokes and the open horizon now have a soft bloom halo; nothing clips to a flat white area.
- 0-dormant is almost entirely black (room dark); 12-open is clearly the brightest.
- Corners are pure black (vignette and grain do not lift black).

- [ ] **Step 4: Manual acceptance on the dev server**

Run: `npm run dev`, then in the browser:
- Press `1`…`0`, `-`, `=` one at a time: each rune fills along its strokes, flares, sends embers and a ripple from its rim; the colour shifts amber → gold → white-gold → blue-white as the count crosses 4, 7, 10.
- Press `3` alone (then `Backspace`), `6` alone, `9` alone, `=` alone: mercury shows dome, drain, echoed ripples, and four-source cell pattern respectively; stone looks identical for all four.
- Light all 12: chase, shake, inhale, surge plume toward the viewer, splash, stable open horizon (~5 s).
- Unlight one rune while open and once during the surge: horizon fades over ~2 s, no snap, no strobe.
- `Backspace` while open: collapse, then dark.
- `F` fullscreen and back: ring stays centred and fully visible. `H` help and `D` debug toggle.
- `D` overlay shows ~60 fps in fullscreen. If it doesn't on this machine, lower `CONFIG.quality.maxPixelRatio` to 1.25, then `simSize` to 192, and note it.

- [ ] **Step 5: Commit**

```bash
git add src/postfx.js src/main.js src/config.js
git commit -m "feat: add bloom, exposure and finishing pass; portal complete"
```
