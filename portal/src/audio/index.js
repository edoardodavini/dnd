import { createEngine } from './engine.js';
import { createBed } from './bed.js';
import * as voices from './voices.js';
import { soundParams, createVolume, cuesCrossed, allowChase } from '../soundMap.js';

const defaultContext = () => new AudioContext({ latencyHint: 'interactive' });

export function createPortalAudio({ state, target = window, createContext = defaultContext }) {
  const volume = createVolume();
  let engine = null;
  let bed = null;
  let unavailable = false;
  let params = null;
  let prevOpeningTime = 0;
  let lastChaseAt = null;
  let lastWhisper = null;

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

  // Audio must never take the portal down: any failure silences it for the rest of the night.
  const safely = (fn) => (...args) => {
    if (!engine) return;
    try {
      fn(...args);
    } catch (err) {
      console.warn('Portal audio disabled:', err);
      engine = null;
      unavailable = true;
    }
  };
  const resume = () => engine?.ctx.resume?.()?.catch?.(() => {});

  // Browsers allow audio only after a user gesture. Capture phase, so the context exists
  // before the input handler lights the rune this very key press asks for.
  target.addEventListener('keydown', () => {
    start();
    resume();
  }, { capture: true });
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resume();
    });
  }

  state.onIgnite(safely((i) => {
    const pan = voices.runePan(i);
    const now = engine.ctx.currentTime;
    voices.stoneGrind(engine, { pan, at: now });
    voices.bowl(engine, { rune: i, pan, brightness: 0.3 + 0.7 * state.charge, echo: params?.echo ?? 0, at: now + 0.3 });
  }));
  state.onUnlight(safely((i) => {
    voices.cool(engine, { rune: i, pan: voices.runePan(i) });
  }));
  state.onPhase(safely((phase) => {
    if (phase !== 'opening') return;
    prevOpeningTime = 0;
    const now = engine.ctx.currentTime;
    if (!allowChase(lastChaseAt, now)) return;
    lastChaseAt = now;
    voices.chase(engine);
  }));

  const applyVolume = () => engine?.setMaster(volume.gain);

  return {
    update: safely((curves, visionLevel, dt) => {
      // A suspended clock (sleep, HDMI drop) must not queue sounds that later fire all at once.
      if (engine.ctx.state !== 'running') return;
      params = soundParams(state, curves, visionLevel);
      bed.update(params, dt);
      if (state.phase === 'opening') {
        for (const cue of cuesCrossed(prevOpeningTime, state.phaseTime)) voices.CUE_SOUNDS[cue](engine);
        prevOpeningTime = state.phaseTime;
      }
    }),
    // A replayed vision replaces the whisper rather than stacking a second one.
    vision: safely(() => {
      lastWhisper?.fade(engine.ctx.currentTime);
      lastWhisper = voices.whisper(engine);
    }),
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
      droplets: bed?.droplets ?? 0,
    }),
    get context() { return engine?.ctx ?? null; },
  };
}
