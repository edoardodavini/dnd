# Portal Sound Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `dist/portal-sound.html`: the hint portal plus generated "ancient ritual" sound (drone, air, liquid, singing-bowl strikes, opening cues, energy tells, vision whisper), quiet under the DM's music, with mute and volume keys.

**Architecture:** A pure `src/soundMap.js` maps portal state to sound parameters, volume, opening cues and droplet scheduling (unit-tested in Node). `src/audio/` holds the Web Audio graph: `engine.js` (context, master, limiter, reverb, voice cap; accepts any `BaseAudioContext`), `voices.js` (one-shot recipes), `bed.js` (continuous layers), `index.js` (wiring to state hooks), and `selftest.js`, which renders every sound in an `OfflineAudioContext` inside the built page so `npm run shoot` can assert no NaN, no clipping, not silent, faded tails.

**Tech Stack:** Web Audio API (no library), Vite, Vitest, puppeteer-core (existing).

**Spec:** `docs/superpowers/specs/2026-10-08-portal-sound-design.md`

## Global Constraints

- Third page `dist/portal-sound.html`, built with `VITE_PORTAL_HINTS=1 VITE_PORTAL_SOUND=1`; includes the visions. `portal.html` and `portal-hint.html` stay silent.
- One self-contained offline HTML file; no audio assets.
- Master default −12 dB, 3 dB steps, clamp −36 … 0 dB. Keys: `KeyM` mute, `BracketLeft` −3 dB, `BracketRight` +3 dB. Meta/Ctrl/Alt still ignored.
- Master limiter: threshold −6 dB, ratio 20, attack 3 ms.
- At most 24 concurrent one-shots; extra ones are dropped.
- Every envelope ramps for ≥ 10 ms at start and end; continuous parameters change only via `setTargetAtTime`/ramps.
- At most 3 liquid bloops scheduled per frame.
- If the AudioContext cannot be created, the page runs silently.
- Bowl notes: A minor pentatonic from A3 (220 Hz), runes 1–12 ascending.

## Review Focus

1. **First key press of the night is a rune** — the audio context must exist before the rune lights so that very press is heard. Covered by the live check in Task 5 (`npm run shoot` presses `Digit1` on a fresh page and expects `state: running, voices ≥ 1`).
2. **Key mashing / the opening's 24-strike chase stacking with ignites** — voice cap must hold. Covered by the `voiceCap` self-test in Task 3.
3. **Long frame after a tab switch** — liquid must not burst-schedule dozens of bloops. Covered by `dropletsDue` tests in Task 1.
4. **Volume keys while muted** — a reasonable person expects `]` to bring the sound back. `createVolume.step` unmutes; tested in Task 1.
5. **No Web Audio (blocked/unsupported)** — visuals must keep running. Covered by `tests/audio.test.js` in Task 5 (injected failing context).

---

### Task 1: Sound map (pure)

**Files:**
- Modify: `src/config.js` (add `audio`)
- Create: `src/soundMap.js`
- Test: `tests/soundMap.test.js`

**Interfaces:**
- Consumes: `smoothstep` from `src/timeline.js`; `Curves` objects from `phaseCurves`/`openingCurves`.
- Produces (`src/soundMap.js`):
  - `bowlFrequency(i: number): number`
  - `soundParams(snapshot: { charge, energies: {add, sub, mul, div} }, curves: Curves, vision: number): BedParams` with fields `air, drone, droneCutoff, droneDetune, dronePitch, flutter, liquid, liquidRate, choir, add, sub, echo, beat` (formulas in spec §3).
  - `dbToGain(db): number`
  - `createVolume(cfg = CONFIG.audio): { gain: number (getter), label: string (getter), toggleMute(), step(dir: -1 | 1) }`
  - `OPENING_CUES: Array<[number, 'rumble'|'inhale'|'surge'|'splash']>`; `cuesCrossed(prev: number, now: number): string[]`
  - `dropletsDue(clock: number, dt: number, rate: number, max = 3): { count: number, clock: number }`

- [ ] **Step 1: Add the audio config**

In `src/config.js`, insert before the line `  vision: { fadeIn: 1.5, hold: 2.5, fadeOut: 2.0 },`:

```js
  audio: {
    masterDb: -12,
    minDb: -36,
    maxDb: 0,
    stepDb: 3,
    maxVoices: 24,
    reverbSeconds: 2.8,
  },
```

- [ ] **Step 2: Write the failing tests**

Create `tests/soundMap.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  soundParams, bowlFrequency, dbToGain, createVolume, cuesCrossed, dropletsDue,
} from '../src/soundMap.js';
import { phaseCurves, openingCurves } from '../src/timeline.js';

const NONE = { add: 0, sub: 0, mul: 0, div: 0 };
const quiet = phaseCurves('charging', 0);
const at = (charge, energies = NONE, curves = quiet, vision = 0) => soundParams({ charge, energies }, curves, vision);

describe('soundParams', () => {
  it('is silent except for the air when nothing is lit', () => {
    const p = at(0);
    expect(p.air).toBeGreaterThan(0);
    for (const k of ['drone', 'liquid', 'liquidRate', 'choir', 'add', 'sub', 'echo', 'beat']) expect(p[k]).toBe(0);
  });

  it('never lowers drone loudness or brightness as runes light', () => {
    let prev = at(0);
    for (let c = 0.01; c <= 1.0001; c += 0.01) {
      const p = at(c);
      expect(p.drone).toBeGreaterThanOrEqual(prev.drone);
      expect(p.droneCutoff).toBeGreaterThanOrEqual(prev.droneCutoff);
      prev = p;
    }
  });

  it('lets the air fade as the portal wakes', () => {
    expect(at(0.5).air).toBe(0);
  });

  it('colours the sound only for lit energy runes', () => {
    expect(at(0.5, { ...NONE, add: 1 }).add).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, sub: 1 }).sub).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, mul: 1 }).echo).toBeGreaterThan(0);
    expect(at(0.5, { ...NONE, div: 1 }).beat).toBeGreaterThan(0);
    const p = at(0.5, { ...NONE, add: 1 });
    expect([p.sub, p.echo, p.beat]).toEqual([0, 0, 0]);
  });

  it('quiets the liquid by at least 85% while a vision shows', () => {
    expect(at(0.5, NONE, quiet, 1).liquid).toBeLessThanOrEqual(0.15 * at(0.5).liquid);
  });

  it('ducks the drone on the inhale', () => {
    expect(at(1, NONE, openingCurves(2.25)).drone).toBeLessThan(0.2 * at(1).drone);
  });

  it('sags and flutters the drone while collapsing', () => {
    const p = at(0.5, NONE, phaseCurves('collapsing', 0.5));
    expect(p.dronePitch).toBeLessThan(1);
    expect(p.flutter).toBeGreaterThan(0.9);
  });

  it('brings in the choir when open', () => {
    const p = at(1, NONE, phaseCurves('open', 0));
    expect(p.choir).toBeCloseTo(0.3);
    expect(p.air).toBe(0);
  });
});

describe('bowlFrequency', () => {
  it('walks A minor pentatonic up from A3', () => {
    const f = [...Array(12).keys()].map(bowlFrequency);
    expect(f[0]).toBeCloseTo(220);
    expect(f[1]).toBeCloseTo(261.63, 1);
    expect(f[5]).toBeCloseTo(440);
    expect(f[11]).toBeCloseTo(1046.5, 0);
    for (let k = 1; k < 12; k++) expect(f[k]).toBeGreaterThan(f[k - 1]);
  });
});

describe('createVolume', () => {
  it('starts at -12 dB', () => {
    const v = createVolume();
    expect(v.gain).toBeCloseTo(dbToGain(-12));
    expect(v.label).toBe('vol -12 dB');
  });

  it('mutes and unmutes', () => {
    const v = createVolume();
    v.toggleMute();
    expect(v.gain).toBe(0);
    expect(v.label).toBe('muted');
    v.toggleMute();
    expect(v.gain).toBeCloseTo(dbToGain(-12));
  });

  it('steps by 3 dB within -36..0 dB', () => {
    const v = createVolume();
    v.step(1);
    expect(v.label).toBe('vol -9 dB');
    for (let k = 0; k < 20; k++) v.step(1);
    expect(v.label).toBe('vol 0 dB');
    for (let k = 0; k < 40; k++) v.step(-1);
    expect(v.label).toBe('vol -36 dB');
  });

  it('unmutes when the volume is changed', () => {
    const v = createVolume();
    v.toggleMute();
    v.step(1);
    expect(v.label).toBe('vol -9 dB');
    expect(v.gain).toBeGreaterThan(0);
  });
});

describe('cuesCrossed', () => {
  it('reports each opening cue exactly once as time passes it', () => {
    expect(cuesCrossed(0.9, 1.1)).toEqual(['rumble']);
    expect(cuesCrossed(1.0, 1.5)).toEqual([]);
    expect(cuesCrossed(0, 5)).toEqual(['rumble', 'inhale', 'surge', 'splash']);
  });
});

describe('dropletsDue', () => {
  it('accumulates fractional droplets', () => {
    let s = { clock: 0 };
    let total = 0;
    for (let k = 0; k < 8; k++) {
      s = dropletsDue(s.clock, 0.25, 2);
      total += s.count;
    }
    expect(total).toBe(4);
  });

  it('never bursts after a long frame', () => {
    const s = dropletsDue(0, 10, 8.5);
    expect(s.count).toBe(3);
    expect(s.clock).toBeLessThanOrEqual(1);
  });

  it('is silent at rate 0', () => {
    expect(dropletsDue(0.5, 1, 0)).toEqual({ count: 0, clock: 0.5 });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/soundMap.js'`.

- [ ] **Step 4: Write the implementation**

Create `src/soundMap.js`:

```js
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
    droneCutoff: 120 + 900 * c * c + 1500 * open,
    droneDetune: 3 + 9 * c,
    dronePitch: 1 - 0.12 * collapse,
    flutter: collapse,
    liquid: 0.12 * c * (1 - 0.9 * vision) * (1 - 0.5 * open),
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/soundMap.js tests/soundMap.test.js
git commit -m "feat: add pure sound map for the portal audio"
```

---

### Task 2: Mute and volume keys

**Files:**
- Modify: `src/input.js`
- Test: `tests/input.test.js`

**Interfaces:**
- Produces: `attachInput` actions `mute?: () => void`, `volume?: (dir: -1 | 1) => void`.

- [ ] **Step 1: Write the failing tests**

In `tests/input.test.js`, change the `setup()` actions line to:

```js
  const actions = { fullscreen: vi.fn(), help: vi.fn(), debug: vi.fn(), vision: vi.fn(), mute: vi.fn(), volume: vi.fn() };
```

and add before `  it('detaches cleanly', () => {`:

```js
  it('M mutes and [ ] step the volume', () => {
    const { target, actions } = setup();
    target.dispatchEvent(key('KeyM'));
    target.dispatchEvent(key('BracketLeft'));
    target.dispatchEvent(key('BracketRight'));
    expect(actions.mute).toHaveBeenCalledOnce();
    expect(actions.volume).toHaveBeenNthCalledWith(1, -1);
    expect(actions.volume).toHaveBeenNthCalledWith(2, 1);
  });

  it('sound keys are harmless on silent pages', () => {
    const target = new EventTarget();
    attachInput(createState(), {}, target);
    expect(() => target.dispatchEvent(key('KeyM'))).not.toThrow();
    expect(() => target.dispatchEvent(key('BracketRight'))).not.toThrow();
  });

```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `expected "vi.fn()" to be called once, but got 0 times`.

- [ ] **Step 3: Implement**

In `src/input.js`, replace:

```js
      case 'KeyD':
        actions.debug?.();
        break;
```

with:

```js
      case 'KeyD':
        actions.debug?.();
        break;
      case 'KeyM':
        actions.mute?.();
        break;
      case 'BracketLeft':
        actions.volume?.(-1);
        break;
      case 'BracketRight':
        actions.volume?.(1);
        break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/input.js tests/input.test.js
git commit -m "feat: add mute and volume keys"
```

---

### Task 3: Audio engine, one-shot voices, self-test and the sound page

**Files:**
- Create: `src/audio/engine.js`, `src/audio/voices.js`, `src/audio/selftest.js`
- Modify: `src/main.js`, `package.json` (build), `scripts/shoot.mjs`

**Interfaces:**
- Consumes: `CONFIG.audio`; `bowlFrequency` (Task 1); `runeCenter` (layout).
- Produces:
  - `createEngine(ctx: BaseAudioContext, cfg = CONFIG.audio)` → `{ ctx, output(pan = 0, wet = 0.35): GainNode, noiseSource(): AudioBufferSourceNode (looping, not started), claimVoice(): (() => void) | null, setMaster(gain: number), voices: number (getter) }`.
  - `src/audio/voices.js`: `runePan(i)`, `bowl`, `stoneGrind`, `cool`, `bloop`, `rumble`, `inhale`, `boom`, `splash`, `whisper`, `chase`, `CUE_SOUNDS: { rumble, inhale, surge, splash }`. Every voice is `(engine, opts = {}) => void` with optional `opts.at` (context time).
  - `audioSelfTest(): Promise<Array<{ name, kind: 'oneshot' | 'mix' | 'cap', nan?, peak?, rms?, tailRms?, granted? }>>` on `window.__portal.audioSelfTest` in `portal-sound.html`.

- [ ] **Step 1: Write the failing check**

In `scripts/shoot.mjs`, add `['sound-06', 'portal-sound.html', 'lit=1,2,3,4,5,6'],` as the last entry of `SHOTS`, and insert before the line `  // Bloom must run at half the drawing buffer on HiDPI too`:

```js
  // Every generated sound rendered offline in the page: no NaN, no clipping, audible, faded tails.
  if (!filter || filter === 'audio') {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`[audio] ${e.message}`));
    await page.goto(url('portal-sound.html'));
    await page.waitForFunction(() => window.__portal?.frames > 5, { timeout: 120000 });
    const results = await page.evaluate(() => window.__portal.audioSelfTest());
    for (const r of results) {
      const fail = [];
      if (r.kind === 'cap') {
        if (r.granted !== 24) fail.push(`voice cap granted ${r.granted}, expected 24`);
      } else {
        const peakDb = 20 * Math.log10(r.peak || 1e-12);
        if (r.nan) fail.push(`${r.nan} NaN samples`);
        if (peakDb > -1) fail.push(`peak ${peakDb.toFixed(1)} dBFS`);
        if (r.rms < 1e-5) fail.push('silent');
        if (r.kind === 'oneshot' && r.tailRms > 0.01 * r.peak) fail.push('tail not faded');
      }
      console.log(`audio:${r.name}`.padEnd(18), fail.length ? `FAIL ${fail.join(', ')}` : 'ok');
      for (const f of fail) errors.push(`[audio:${r.name}] ${f}`);
    }
    await page.close();
  }

```

In `package.json`, set `scripts.build` to:

```
vite build && mv dist/index.html dist/portal.html && VITE_PORTAL_HINTS=1 vite build --emptyOutDir false && mv dist/index.html dist/portal-hint.html && VITE_PORTAL_HINTS=1 VITE_PORTAL_SOUND=1 vite build --emptyOutDir false && mv dist/index.html dist/portal-sound.html
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `npm run build && npm run shoot audio`
Expected: FAIL — `window.__portal.audioSelfTest is not a function` (the page builds but has no audio yet).

- [ ] **Step 3: Write `src/audio/engine.js`**

```js
import { CONFIG } from '../config.js';
import { dbToGain } from '../soundMap.js';

// Darkened, decaying noise: a stone chamber.
function chamberImpulse(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lowpassed = 0;
    for (let k = 0; k < length; k++) {
      lowpassed += 0.25 * (Math.random() * 2 - 1 - lowpassed);
      data[k] = lowpassed * (1 - k / length) ** 3;
    }
  }
  return ir;
}

// Works on a live AudioContext or an OfflineAudioContext (self-test).
export function createEngine(ctx, cfg = CONFIG.audio) {
  const master = ctx.createGain();
  master.gain.value = dbToGain(cfg.masterDb);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = chamberImpulse(ctx, cfg.reverbSeconds);
  const reverbIn = ctx.createGain();
  reverbIn.connect(reverb).connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let k = 0; k < samples.length; k++) samples[k] = Math.random() * 2 - 1;

  let voices = 0;

  return {
    ctx,
    // A panned input that feeds the master dry and the chamber wet.
    output(pan = 0, wet = 0.35) {
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      const send = ctx.createGain();
      send.gain.value = wet;
      input.connect(panner);
      panner.connect(master);
      panner.connect(send).connect(reverbIn);
      return input;
    },
    noiseSource() {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      return src;
    },
    // One slot per one-shot; returns a release callback, or null when the cap is reached.
    claimVoice() {
      if (voices >= cfg.maxVoices) return null;
      voices++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        voices--;
      };
    },
    setMaster(gain) {
      master.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    },
    get voices() { return voices; },
  };
}
```

- [ ] **Step 4: Write `src/audio/voices.js`**

```js
import { bowlFrequency } from '../soundMap.js';
import { runeCenter } from '../layout.js';

// Ratio, relative gain, decay (s): a singing bowl's inharmonic partials.
const BOWL_PARTIALS = [
  [1, 1, 4.5],
  [2.76, 0.5, 3.0],
  [5.4, 0.25, 1.8],
  [8.93, 0.12, 1.1],
];

export function runePan(i) {
  return Math.max(-0.8, Math.min(0.8, runeCenter(i, 0.8).x));
}

// Attack ≥ 10 ms and a final ramp to 0, so no envelope clicks.
function envelope(param, t0, attack, peak, decay) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.exponentialRampToValueAtTime(Math.max(peak * 1e-4, 1e-6), t0 + attack + decay);
  param.linearRampToValueAtTime(0, t0 + attack + decay + 0.02);
}

function begin(engine, at) {
  const release = engine.claimVoice();
  if (!release) return null;
  return { ctx: engine.ctx, t0: at ?? engine.ctx.currentTime, release };
}

function filter(ctx, type, frequency, q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

export function bowl(engine, { rune = 0, pan = 0, level = 0.35, brightness = 0.5, echo = 0, decayScale = 1, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const out = engine.output(pan, 0.45);
  let dest = out;
  if (echo > 0.01) {
    // × energy: the strike repeats through a feedback delay.
    const input = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.28;
    const feedback = ctx.createGain();
    feedback.gain.value = Math.min(echo, 0.6);
    input.connect(out);
    input.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(out);
    dest = input;
  }
  const f = bowlFrequency(rune);
  BOWL_PARTIALS.forEach(([ratio, gain, decay], k) => {
    const weight = k === 0 ? 1 : brightness;
    if (weight <= 0) return;
    const osc = ctx.createOscillator();
    osc.frequency.value = f * ratio;
    osc.detune.value = k === 0 ? 0 : 4;
    const g = ctx.createGain();
    envelope(g.gain, t0, 0.01, level * gain * weight, decay * decayScale);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + 0.01 + decay * decayScale + 0.05);
    if (k === 0) osc.onended = release;
  });
}

export function stoneGrind(engine, { pan = 0, level = 0.3, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  src.playbackRate.value = 0.6;
  const rough = ctx.createGain();
  rough.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'sawtooth';
  lfo.frequency.value = 25 + Math.random() * 15;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(rough.gain);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.04, level, 0.4);
  src.connect(filter(ctx, 'lowpass', 300)).connect(rough).connect(g).connect(engine.output(pan, 0.25));
  src.start(t0, Math.random());
  src.stop(t0 + 0.5);
  lfo.start(t0);
  lfo.stop(t0 + 0.5);
  src.onended = release;
}

export function cool(engine, { rune = 0, pan = 0, level = 0.2, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const out = engine.output(pan, 0.4);
  const f = bowlFrequency(rune);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f / 1.5, t0 + 0.9);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 0.9);
  osc.connect(g).connect(out);
  const hiss = engine.noiseSource();
  const hg = ctx.createGain();
  envelope(hg.gain, t0, 0.05, level * 0.4, 0.9);
  hiss.connect(filter(ctx, 'highpass', 3000)).connect(hg).connect(out);
  osc.start(t0);
  osc.stop(t0 + 1.0);
  hiss.start(t0, Math.random());
  hiss.stop(t0 + 1.0);
  osc.onended = release;
}

export function bloop(engine, { pan = 0, level = 0.08, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const f0 = 300 + Math.random() * 600;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * 1.8, t0 + 0.06);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 0.09);
  osc.connect(g).connect(engine.output(pan, 0.5));
  osc.start(t0);
  osc.stop(t0 + 0.13);
  osc.onended = release;
}

export function rumble(engine, { level = 0.6, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  src.playbackRate.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 2.0);
  g.gain.linearRampToValueAtTime(0, t0 + 2.6);
  src.connect(filter(ctx, 'lowpass', 80)).connect(g).connect(engine.output(0, 0.2));
  src.start(t0, Math.random());
  src.stop(t0 + 2.7);
  src.onended = release;
}

export function inhale(engine, { level = 0.35, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  const hp = filter(ctx, 'highpass', 200);
  hp.frequency.setValueAtTime(200, t0);
  hp.frequency.exponentialRampToValueAtTime(4000, t0 + 0.6);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 0.55);
  g.gain.linearRampToValueAtTime(0, t0 + 0.62);
  src.connect(hp).connect(g).connect(engine.output(0, 0.4));
  src.start(t0, Math.random());
  src.stop(t0 + 0.65);
  src.onended = release;
}

export function boom(engine, { level = 0.7, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const out = engine.output(0, 0.35);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.4);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 1.5);
  osc.connect(g).connect(out);
  const whoosh = engine.noiseSource();
  const bp = filter(ctx, 'bandpass', 3000, 1.5);
  bp.frequency.setValueAtTime(3000, t0);
  bp.frequency.exponentialRampToValueAtTime(150, t0 + 1.2);
  const wg = ctx.createGain();
  envelope(wg.gain, t0, 0.05, level * 0.35, 1.2);
  whoosh.connect(bp).connect(wg).connect(out);
  osc.start(t0);
  osc.stop(t0 + 1.6);
  whoosh.start(t0, Math.random());
  whoosh.stop(t0 + 1.3);
  osc.onended = release;
}

export function splash(engine, { level = 0.3, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 0.5);
  src.connect(filter(ctx, 'bandpass', 1500, 0.7)).connect(g).connect(engine.output(0, 0.5));
  src.start(t0, Math.random());
  src.stop(t0 + 0.6);
  src.onended = release;
  for (let k = 0; k < 8; k++) {
    bloop(engine, { pan: Math.random() * 1.4 - 0.7, level: 0.1, at: t0 + 0.05 + Math.random() * 0.8 });
  }
}

// Vision: a breathy whisper sweeping between vowel-like formants, with a faint glassy shimmer.
export function whisper(engine, { level = 0.12, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  const { ctx, t0, release } = v;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 1.5);
  g.gain.setValueAtTime(level, t0 + 4.0);
  g.gain.linearRampToValueAtTime(0, t0 + 6.0);
  g.connect(engine.output(0, 0.6));
  let last;
  for (const [from, to] of [[700, 300], [1200, 2300]]) {
    const src = engine.noiseSource();
    const bp = filter(ctx, 'bandpass', from, 8);
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.linearRampToValueAtTime(to, t0 + 6);
    src.connect(bp).connect(g);
    src.start(t0, Math.random());
    src.stop(t0 + 6.1);
    last = src;
  }
  for (const f of [2200, 2900]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 8;
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    const sg = ctx.createGain();
    sg.gain.value = 0.12;
    osc.connect(sg).connect(g);
    osc.start(t0);
    osc.stop(t0 + 6.1);
    vibrato.start(t0);
    vibrato.stop(t0 + 6.1);
  }
  last.onended = release;
}

// Opening: two quick turns of bowl strikes clockwise around the ring.
export function chase(engine, { at } = {}) {
  const t0 = at ?? engine.ctx.currentTime;
  for (let k = 0; k < 24; k++) {
    const rune = k % 12;
    bowl(engine, { rune, pan: runePan(rune), level: 0.15, brightness: 1, decayScale: 0.15, at: t0 + k / 24 });
  }
}

export const CUE_SOUNDS = {
  rumble: (engine, opts) => rumble(engine, opts),
  inhale: (engine, opts) => inhale(engine, opts),
  surge: (engine, opts) => boom(engine, opts),
  splash: (engine, opts) => splash(engine, opts),
};
```

- [ ] **Step 5: Write `src/audio/selftest.js`**

```js
import { createEngine } from './engine.js';
import * as voices from './voices.js';

const RATE = 48000;

function measure(buffer) {
  let nan = 0;
  let peak = 0;
  let sum = 0;
  let tailSum = 0;
  const tailStart = buffer.length - Math.floor(0.05 * buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let k = 0; k < data.length; k++) {
      const x = data[k];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      if (k >= tailStart) tailSum += x * x;
    }
  }
  const channels = buffer.numberOfChannels;
  return {
    nan,
    peak,
    rms: Math.sqrt(sum / (buffer.length * channels)),
    tailRms: Math.sqrt(tailSum / ((buffer.length - tailStart) * channels)),
  };
}

async function render(seconds, play) {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const engine = createEngine(ctx);
  play(engine);
  return measure(await ctx.startRendering());
}

// Durations include the 2.8 s chamber tail.
export const ONE_SHOTS = {
  stoneGrind: [3.5, (e) => voices.stoneGrind(e)],
  bowl: [8, (e) => voices.bowl(e, { rune: 0, brightness: 1 })],
  bowlEcho: [10, (e) => voices.bowl(e, { rune: 11, brightness: 1, echo: 0.45 })],
  cool: [4, (e) => voices.cool(e, { rune: 5 })],
  bloop: [3, (e) => voices.bloop(e)],
  rumble: [6, (e) => voices.rumble(e)],
  inhale: [3.5, (e) => voices.inhale(e)],
  boom: [5, (e) => voices.boom(e)],
  splash: [4.5, (e) => voices.splash(e)],
  whisper: [9.5, (e) => voices.whisper(e)],
  chase: [5, (e) => voices.chase(e)],
};

// Continuous layers and overlapping scenes: no tail check.
export const MIXES = {
  opening: [6, (e) => {
    voices.chase(e, { at: 0 });
    for (const [t, cue] of [[1.0, 'rumble'], [1.8, 'inhale'], [2.4, 'surge'], [3.2, 'splash']]) voices.CUE_SOUNDS[cue](e, { at: t });
  }],
};

export async function audioSelfTest() {
  const results = [];
  for (const [name, [seconds, play]] of Object.entries(ONE_SHOTS)) {
    results.push({ name, kind: 'oneshot', ...(await render(seconds, play)) });
  }
  for (const [name, [seconds, play]] of Object.entries(MIXES)) {
    results.push({ name, kind: 'mix', ...(await render(seconds, play)) });
  }
  const capEngine = createEngine(new OfflineAudioContext(2, RATE, RATE));
  let granted = 0;
  for (let k = 0; k < 30; k++) if (capEngine.claimVoice()) granted++;
  results.push({ name: 'voiceCap', kind: 'cap', granted });
  return results;
}
```

- [ ] **Step 6: Expose the self-test in the sound page**

In `src/main.js`, replace:

```js
const HINTS = import.meta.env.VITE_PORTAL_HINTS === '1';
```

with:

```js
// portal-sound.html is built with VITE_PORTAL_SOUND=1 and always includes the hints.
const SOUND = import.meta.env.VITE_PORTAL_SOUND === '1';
const HINTS = SOUND || import.meta.env.VITE_PORTAL_HINTS === '1';
```

Add `import { audioSelfTest } from './audio/selftest.js';` after `import { createVision } from './vision.js';`, and insert after the line `const portal = { state, frames: 0, fps: 0, bloomWidth: post.bloomWidth };`:

```js
if (SOUND) portal.audioSelfTest = audioSelfTest;
```

- [ ] **Step 7: Run the check to verify it passes**

Run: `npm test && npm run build && npm run shoot audio`
Expected: tests PASS; `ls dist` shows `portal.html portal-hint.html portal-sound.html`; every `audio:*` line prints `ok`, including `audio:voiceCap`; exit 0. If a sound clips or fails "tail not faded", lower that voice's default `level` or lengthen its render duration in `ONE_SHOTS` (only if the tail is the chamber reverb still ringing), and ledger the change.

- [ ] **Step 8: Commit**

```bash
git add src/audio/engine.js src/audio/voices.js src/audio/selftest.js src/main.js package.json scripts/shoot.mjs
git commit -m "feat: add audio engine, ritual one-shot voices and offline self-test"
```

---

### Task 4: Continuous sound bed

**Files:**
- Create: `src/audio/bed.js`
- Modify: `src/audio/selftest.js`

**Interfaces:**
- Consumes: `createEngine` (Task 3), `bloop` (Task 3), `BedParams` and `dropletsDue` (Task 1).
- Produces: `createBed(engine): { update(params: BedParams, dt: number): void }`.

- [ ] **Step 1: Write the failing check**

In `src/audio/selftest.js`, add the imports:

```js
import { createBed } from './bed.js';
import { soundParams } from '../soundMap.js';
import { phaseCurves } from '../timeline.js';
```

add above `export const MIXES`:

```js
const NONE = { add: 0, sub: 0, mul: 0, div: 0 };
const ALL = { add: 1, sub: 1, mul: 1, div: 1 };
const bedAt = (charge, curves, energies = NONE, vision = 0) => (engine) =>
  createBed(engine).update(soundParams({ charge, energies }, curves, vision), 1 / 60);
```

and add these entries at the top of the `MIXES` object:

```js
  bedDormant: [3, bedAt(0, phaseCurves('dormant', 0))],
  bedHalf: [3, bedAt(0.5, phaseCurves('charging', 0))],
  bedEleven: [3, bedAt(11 / 12, phaseCurves('charging', 0), ALL)],
  bedOpen: [3, bedAt(1, phaseCurves('open', 0), ALL)],
  bedCollapse: [3, bedAt(0.9, phaseCurves('collapsing', 0.5))],
```

and change the `opening` mix to also run the bed by inserting as its first statement:

```js
    bedAt(1, phaseCurves('open', 0), ALL)(e);
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `npm run build`
Expected: FAIL — build error `Could not resolve "./bed.js"`.

- [ ] **Step 3: Write `src/audio/bed.js`**

```js
import { bloop } from './voices.js';
import { dropletsDue } from '../soundMap.js';

// The always-on layers. update() follows BedParams with smooth ramps only.
export function createBed(engine) {
  const { ctx } = engine;
  const out = engine.output(0, 0.3);
  const gain = (value = 0) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const osc = (type, frequency) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start();
    return o;
  };
  const filter = (type, frequency, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const lfoInto = (frequency, param) => {
    const depth = gain(0);
    osc('sine', frequency).connect(depth).connect(param);
    return depth;
  };

  // Air: the room breathing before the portal wakes.
  const air = gain();
  const airNoise = engine.noiseSource();
  airNoise.connect(filter('bandpass', 400, 0.8)).connect(air).connect(out);
  airNoise.start();

  // Drone: low A and its fifth, each with a detuned twin, through a lowpass and a tremolo stage.
  const drone = gain();
  const droneLp = filter('lowpass', 120, 0.5);
  const tremolo = gain(1);
  const droneVoices = [[1, -1], [1, 1], [1.5, -1], [1.5, 1]].map(([ratio, sign]) => {
    const o = osc('triangle', 55 * ratio);
    o.connect(droneLp);
    return { o, ratio, sign };
  });
  droneLp.connect(tremolo).connect(drone).connect(out);
  const restless = lfoInto(0.13, tremolo.gain);
  const beat = lfoInto(2, tremolo.gain); // ÷ energy
  const flutter = lfoInto(6, tremolo.gain); // collapse

  // Choir: stacked fifths in detuned pairs, swelling in when the portal opens.
  const choir = gain();
  const choirLp = filter('lowpass', 1200, 0.5);
  for (const f of [110, 164.81, 220, 329.63]) {
    for (const cents of [-7, 7]) {
      const o = osc('sawtooth', f);
      o.detune.value = cents;
      o.connect(choirLp);
    }
  }
  choirLp.connect(gain(0.15)).connect(choir).connect(out);

  // − energy: a sub-octave undertone with a slow wobble.
  const sub = gain();
  const subOsc = osc('sine', 27.5);
  lfoInto(0.2, subOsc.detune).gain.value = 10;
  subOsc.connect(sub).connect(out);

  // + energy: an overtone gliding up an octave every 8 s, faded in and out each glide.
  const add = gain();
  const addOsc = osc('sine', 220);
  const addWindow = gain(0);
  addOsc.connect(addWindow).connect(add).connect(out);
  let nextGlide = 0;
  function scheduleGlide() {
    const now = ctx.currentTime;
    if (now + 0.5 < nextGlide) return;
    const start = Math.max(now, nextGlide);
    addOsc.frequency.setValueAtTime(220, start);
    addOsc.frequency.exponentialRampToValueAtTime(440, start + 8);
    addWindow.gain.setValueAtTime(0, start);
    addWindow.gain.linearRampToValueAtTime(1, start + 2);
    addWindow.gain.setValueAtTime(1, start + 6);
    addWindow.gain.linearRampToValueAtTime(0, start + 8);
    nextGlide = start + 8;
  }

  let liquidClock = 0;

  function update(p, dt) {
    const now = ctx.currentTime;
    const to = (param, value, tau = 0.2) => param.setTargetAtTime(value, now, tau);
    to(air.gain, p.air, 0.5);
    to(drone.gain, p.drone, 0.25);
    to(droneLp.frequency, p.droneCutoff, 0.3);
    for (const { o, ratio, sign } of droneVoices) {
      to(o.frequency, 55 * ratio * p.dronePitch, 0.3);
      to(o.detune, (sign * p.droneDetune) / 2, 0.5);
    }
    to(restless.gain, (0.2 * (p.droneDetune - 3)) / 9, 0.5);
    to(beat.gain, p.beat, 0.3);
    to(flutter.gain, 0.7 * p.flutter, 0.1);
    to(choir.gain, p.choir, 0.6);
    to(sub.gain, p.sub, 0.5);
    to(add.gain, p.add, 0.5);
    scheduleGlide();

    const due = dropletsDue(liquidClock, dt, p.liquidRate);
    liquidClock = due.clock;
    for (let k = 0; k < due.count; k++) {
      bloop(engine, { pan: Math.random() * 1.6 - 0.8, level: p.liquid, at: now + Math.random() * 0.05 });
    }
  }

  return { update };
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `npm test && npm run build && npm run shoot audio`
Expected: all `audio:*` lines `ok`, including `bedDormant`, `bedHalf`, `bedEleven`, `bedOpen`, `bedCollapse`, `opening`; exit 0. If a bed clips, lower the offending layer's coefficient in `soundParams` (Task 1 tests must still pass) and ledger it.

- [ ] **Step 5: Commit**

```bash
git add src/audio/bed.js src/audio/selftest.js
git commit -m "feat: add continuous ritual sound bed"
```

---

### Task 5: Wire audio into the sound page

**Files:**
- Create: `src/audio/index.js`
- Modify: `src/main.js`, `index.html`, `scripts/shoot.mjs`
- Test: `tests/audio.test.js`

**Interfaces:**
- Consumes: everything above; `state` hooks `onIgnite/onUnlight/onPhase`; `curves`; `vision.level`.
- Produces: `createPortalAudio({ state, target = window, createContext = () => new AudioContext() })` → `{ update(curves, visionLevel, dt), vision(), toggleMute(): string, volume(dir): string, debug(): { state: string, voices: number } }`. `debug().state` is `'waiting'` before the first key, `'unavailable'` if the context failed, else the AudioContext state.

- [ ] **Step 1: Write the failing tests**

Create `tests/audio.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createPortalAudio } from '../src/audio/index.js';
import { createState } from '../src/state.js';
import { phaseCurves } from '../src/timeline.js';

describe('createPortalAudio', () => {
  it('waits for the first key press before touching audio', () => {
    let created = 0;
    const audio = createPortalAudio({
      state: createState(),
      target: new EventTarget(),
      createContext: () => { created++; throw new Error('not yet'); },
    });
    expect(created).toBe(0);
    expect(audio.debug().state).toBe('waiting');
  });

  it('keeps the portal running silently when Web Audio is unavailable', () => {
    const target = new EventTarget();
    const state = createState();
    const audio = createPortalAudio({ state, target, createContext: () => { throw new Error('no audio'); } });
    target.dispatchEvent(new Event('keydown'));
    expect(() => {
      state.toggle(0);
      state.toggle(0);
      audio.update(phaseCurves('charging', 0), 0, 1 / 60);
      audio.vision();
    }).not.toThrow();
    expect(audio.debug().state).toBe('unavailable');
    expect(audio.toggleMute()).toBe('muted');
    expect(audio.volume(1)).toBe('vol -9 dB');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/audio/index.js'`.

- [ ] **Step 3: Write `src/audio/index.js`**

```js
import { createEngine } from './engine.js';
import { createBed } from './bed.js';
import * as voices from './voices.js';
import { soundParams, createVolume, cuesCrossed } from '../soundMap.js';

const defaultContext = () => new AudioContext({ latencyHint: 'interactive' });

export function createPortalAudio({ state, target = window, createContext = defaultContext }) {
  const volume = createVolume();
  let engine = null;
  let bed = null;
  let unavailable = false;
  let params = null;
  let prevOpeningTime = 0;

  function start() {
    if (engine || unavailable) return;
    try {
      engine = createEngine(createContext());
      bed = createBed(engine);
      engine.setMaster(volume.gain);
    } catch {
      engine = null;
      unavailable = true;
    }
  }

  // Browsers allow audio only after a user gesture. Capture phase, so the context exists
  // before the input handler lights the rune this very key press asks for.
  target.addEventListener('keydown', () => {
    start();
    engine?.ctx.resume?.();
  }, { capture: true });

  state.onIgnite((i) => {
    if (!engine) return;
    const pan = voices.runePan(i);
    const now = engine.ctx.currentTime;
    voices.stoneGrind(engine, { pan, at: now });
    voices.bowl(engine, { rune: i, pan, brightness: 0.3 + 0.7 * state.charge, echo: params?.echo ?? 0, at: now + 0.3 });
  });
  state.onUnlight((i) => {
    if (engine) voices.cool(engine, { rune: i, pan: voices.runePan(i) });
  });
  state.onPhase((phase) => {
    if (phase !== 'opening' || !engine) return;
    prevOpeningTime = 0;
    voices.chase(engine);
  });

  const applyVolume = () => engine?.setMaster(volume.gain);

  return {
    update(curves, visionLevel, dt) {
      if (!engine) return;
      params = soundParams(state, curves, visionLevel);
      bed.update(params, dt);
      if (state.phase === 'opening') {
        for (const cue of cuesCrossed(prevOpeningTime, state.phaseTime)) voices.CUE_SOUNDS[cue](engine);
        prevOpeningTime = state.phaseTime;
      }
    },
    vision() {
      if (engine) voices.whisper(engine);
    },
    toggleMute() {
      volume.toggleMute();
      applyVolume();
      return volume.label;
    },
    volume(dir) {
      volume.step(dir);
      applyVolume();
      return volume.label;
    },
    debug: () => ({
      state: unavailable ? 'unavailable' : engine ? engine.ctx.state : 'waiting',
      voices: engine?.voices ?? 0,
    }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Wire into the page**

In `index.html`, add after `      #debug { right: 24px; top: 24px; }`:

```css
      #volume { right: 24px; bottom: 24px; }
```

and after `    <div id="error" class="overlay"></div>`:

```html
    <div id="volume" class="overlay"></div>
```

In `src/main.js`:

Add `import { createPortalAudio } from './audio/index.js';` after `import { audioSelfTest } from './audio/selftest.js';`.

Replace `attachInput(state, {` with:

```js
const audio = SOUND ? createPortalAudio({ state }) : null;
if (SOUND) $('help').textContent += '\nM  mute     [ ]  volume';
let volumeTimer = 0;
function flashVolume(label) {
  $('volume').textContent = label;
  $('volume').classList.add('show');
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => $('volume').classList.remove('show'), 1200);
}

attachInput(state, {
  mute: audio ? () => flashVolume(audio.toggleMute()) : undefined,
  volume: audio ? (dir) => flashVolume(audio.volume(dir)) : undefined,
```

Replace `        ripples.pulse(0, 0, 0.25, -0.12); // something surfaces` with:

```js
        ripples.pulse(0, 0, 0.25, -0.12); // something surfaces
        audio?.vision();
```

Replace `if (SOUND) portal.audioSelfTest = audioSelfTest;` with:

```js
if (SOUND) Object.assign(portal, { audio, audioSelfTest });
```

Replace `  vision.update(dt);` with:

```js
  vision.update(dt);
  audio?.update(curves, vision.level, dt);
```

- [ ] **Step 6: Add the live check**

In `scripts/shoot.mjs`, inside the audio block, insert before `    await page.close();`:

```js
    // The very first key of the night is a rune: it must unlock audio and be heard.
    await page.keyboard.press('Digit1');
    await new Promise((r) => setTimeout(r, 400));
    const live = await page.evaluate(() => window.__portal.audio.debug());
    console.log('audio:live'.padEnd(18), JSON.stringify(live));
    if (live.state !== 'running') errors.push(`[audio:live] context ${live.state}, expected running`);
    if (live.voices < 1) errors.push('[audio:live] first rune press made no sound');
```

- [ ] **Step 7: Verify**

Run: `npm test && npm run build && npm run shoot`
Expected: all tests PASS; all image shots log; every `audio:*` line `ok`; `audio:live {"state":"running","voices":≥1}`; `dpr2-bloom` ok; exit 0. `portal.html` and `portal-hint.html` contain no `AudioContext` usage: `grep -c "createDynamicsCompressor" dist/portal.html dist/portal-hint.html` prints `0` for both (tree-shaken), `dist/portal-sound.html` prints ≥ 1.

- [ ] **Step 8: Commit**

```bash
git add src/audio/index.js src/main.js index.html scripts/shoot.mjs tests/audio.test.js
git commit -m "feat: wire ritual sound into portal-sound.html"
```
