import { describe, it, expect, vi } from 'vitest';
import { attachInput } from '../src/input.js';
import { createState } from '../src/state.js';

function key(code, extra = {}) {
  const e = new Event('keydown', { cancelable: true });
  Object.assign(e, { code, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  return e;
}

function setup() {
  const target = new EventTarget();
  const state = createState();
  const actions = { fullscreen: vi.fn(), help: vi.fn(), debug: vi.fn(), vision: vi.fn(), mute: vi.fn(), volume: vi.fn() };
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

  it('Shift + an energy rune key summons its vision without toggling it', () => {
    const { target, state, actions } = setup();
    target.dispatchEvent(key('Digit3', { shiftKey: true }));
    target.dispatchEvent(key('Equal', { shiftKey: true }));
    expect(actions.vision).toHaveBeenNthCalledWith(1, 2);
    expect(actions.vision).toHaveBeenNthCalledWith(2, 11);
    expect(state.litCount).toBe(0);
  });

  it('Shift + any other rune key does nothing', () => {
    const { target, state, actions } = setup();
    target.dispatchEvent(key('Digit4', { shiftKey: true }));
    expect(actions.vision).not.toHaveBeenCalled();
    expect(state.litCount).toBe(0);
  });

  it('Shift + energy key is harmless when visions are not enabled', () => {
    const target = new EventTarget();
    const state = createState();
    attachInput(state, {}, target);
    target.dispatchEvent(key('Digit6', { shiftKey: true }));
    expect(state.litCount).toBe(0);
  });

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

  it('detaches cleanly', () => {
    const { target, state, detach } = setup();
    detach();
    target.dispatchEvent(key('Digit1'));
    expect(state.litCount).toBe(0);
  });
});
