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
