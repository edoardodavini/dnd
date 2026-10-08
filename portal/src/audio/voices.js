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

function begin(engine, at, priority = false) {
  const release = engine.claimVoice({ priority });
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

// One bowl strike into `dest`; returns the longest-ringing oscillator. Claims no voice slot.
function strike(ctx, dest, { rune, level, brightness, decayScale, t0 }) {
  const f = bowlFrequency(rune);
  let longest;
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
    if (k === 0) longest = osc;
  });
  return longest;
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
  strike(ctx, dest, { rune, level, brightness, decayScale, t0 }).onended = release;
}

export function stoneGrind(engine, { pan = 0, level = 4.0, at } = {}) {
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

// One liquid droplet into `dest`; returns its oscillator. Claims no voice slot.
function droplet(ctx, dest, { level, t0 }) {
  const f0 = 300 + Math.random() * 600;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f0 * 1.8, t0 + 0.06);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 0.09);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + 0.13);
  return osc;
}

// Liquid layer droplet: part of the bed, so it claims no voice slot.
export function liquidDroplet(engine, { pan = 0, level = 0.25, at } = {}) {
  droplet(engine.ctx, engine.output(pan, 0.5), { level, t0: at ?? engine.ctx.currentTime });
}

export function bloop(engine, { pan = 0, level = 0.25, at } = {}) {
  const v = begin(engine, at);
  if (!v) return;
  droplet(v.ctx, engine.output(pan, 0.5), { level, t0: v.t0 }).onended = v.release;
}

export function rumble(engine, { level = 2.4, at } = {}) {
  const v = begin(engine, at, true);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  src.playbackRate.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(level, t0 + 2.0);
  g.gain.linearRampToValueAtTime(0, t0 + 2.6);
  // 140 Hz rather than a pure sub: TV speakers barely reproduce below ~100 Hz.
  src.connect(filter(ctx, 'lowpass', 140)).connect(g).connect(engine.output(0, 0.2));
  src.start(t0, Math.random());
  src.stop(t0 + 2.7);
  src.onended = release;
}

export function inhale(engine, { level = 0.25, at } = {}) {
  const v = begin(engine, at, true);
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

export function boom(engine, { level = 1.2, at } = {}) {
  const v = begin(engine, at, true);
  if (!v) return;
  const { ctx, t0, release } = v;
  const out = engine.output(0, 0.35);
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(90, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + 0.4);
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 1.5);
  osc.connect(g).connect(out);
  // Octave-up layer so the boom survives TV speakers.
  const octave = ctx.createOscillator();
  octave.frequency.setValueAtTime(180, t0);
  octave.frequency.exponentialRampToValueAtTime(90, t0 + 0.4);
  const og = ctx.createGain();
  envelope(og.gain, t0, 0.01, level * 0.5, 1.0);
  octave.connect(og).connect(out);
  octave.start(t0);
  octave.stop(t0 + 1.1);
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

export function splash(engine, { level = 0.5, at } = {}) {
  const v = begin(engine, at, true);
  if (!v) return;
  const { ctx, t0, release } = v;
  const src = engine.noiseSource();
  const g = ctx.createGain();
  envelope(g.gain, t0, 0.01, level, 0.5);
  src.connect(filter(ctx, 'bandpass', 1500, 0.7)).connect(g).connect(engine.output(0, 0.5));
  src.start(t0, Math.random());
  src.stop(t0 + 0.6);
  // Scattered droplets belong to this one voice; the last one to finish releases it.
  let last = src;
  let lastEnd = t0 + 0.6;
  for (let k = 0; k < 8; k++) {
    const t = t0 + 0.05 + Math.random() * 0.8;
    const osc = droplet(ctx, engine.output(Math.random() * 1.4 - 0.7, 0.5), { level: 0.25, t0: t });
    if (t + 0.13 > lastEnd) {
      last = osc;
      lastEnd = t + 0.13;
    }
  }
  last.onended = release;
}

// Vision: a breathy whisper sweeping between vowel-like formants, with a faint glassy shimmer.
// Returns a handle whose fade(at) silences it, so a replayed vision replaces rather than stacks.
export function whisper(engine, { level = 0.3, at } = {}) {
  const v = begin(engine, at, true);
  if (!v) return null;
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
  return {
    fade(time) {
      g.gain.cancelAndHoldAtTime(time);
      g.gain.linearRampToValueAtTime(0, time + 0.15);
    },
  };
}

// Opening: two quick turns of bowl strikes clockwise around the ring — one voice for the whole gesture.
export function chase(engine, { at } = {}) {
  const v = begin(engine, at, true);
  if (!v) return;
  const { ctx, t0, release } = v;
  let last;
  for (let k = 0; k < 24; k++) {
    const rune = k % 12;
    last = strike(ctx, engine.output(runePan(rune), 0.45), { rune, level: 0.15, brightness: 1, decayScale: 0.15, t0: t0 + k / 24 });
  }
  last.onended = release;
}

export const CUE_SOUNDS = {
  rumble: (engine, opts) => rumble(engine, opts),
  inhale: (engine, opts) => inhale(engine, opts),
  surge: (engine, opts) => boom(engine, opts),
  splash: (engine, opts) => splash(engine, opts),
};
