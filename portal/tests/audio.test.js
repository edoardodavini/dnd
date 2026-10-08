import { describe, it, expect } from 'vitest';
import { createPortalAudio } from '../src/audio/index.js';
import { createState } from '../src/state.js';
import { phaseCurves } from '../src/timeline.js';

// A permissive stand-in for AudioContext: every node/param is a no-op proxy.
// Flip `broken` to make the audio clock throw, simulating a browser audio failure mid-session.
function fakeContext() {
  const node = () => new Proxy(function () {}, {
    get: (_, k) => {
      if (k === 'then') return undefined;
      if (k === 'length') return 0;
      if (k === Symbol.toPrimitive) return () => 0;
      return node();
    },
    apply: () => node(),
    set: () => true,
  });
  const ctl = { broken: false };
  const ctx = new Proxy({}, {
    get: (_, k) => {
      if (k === 'currentTime') {
        if (ctl.broken) throw new Error('audio device lost');
        return 0;
      }
      if (k === 'sampleRate') return 48000;
      if (k === 'state') return 'running';
      if (k === 'then') return undefined;
      if (k === 'resume') return () => Promise.reject(new Error('not allowed'));
      return node();
    },
  });
  return { ctx, ctl };
}

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

  it('an audio failure mid-session never stops the portal', () => {
    const target = new EventTarget();
    const state = createState();
    const { ctx, ctl } = fakeContext();
    const audio = createPortalAudio({ state, target, createContext: () => ctx });
    target.dispatchEvent(new Event('keydown'));
    expect(audio.debug().state).toBe('running');
    ctl.broken = true;
    expect(() => {
      for (let i = 0; i < 12; i++) state.toggle(i);
      audio.update(phaseCurves('opening', 2.5), 0, 1 / 60);
      audio.vision();
    }).not.toThrow();
    expect(state.phase).toBe('opening');
    expect(audio.debug().state).toBe('unavailable');
  });
});
