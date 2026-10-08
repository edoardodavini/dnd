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
