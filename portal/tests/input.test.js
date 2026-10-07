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
