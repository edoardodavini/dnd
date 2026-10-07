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
