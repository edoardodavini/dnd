import { runeForKey, ENERGY_RUNES } from './state.js';

const ENERGY_INDICES = Object.values(ENERGY_RUNES);

export function attachInput(state, actions, target = window) {
  function onKey(e) {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const rune = runeForKey(e.code);
    if (rune !== undefined && e.shiftKey) {
      // Shift + energy rune key: summon its vision (portal-hint only). Never toggles a rune.
      e.preventDefault();
      if (ENERGY_INDICES.includes(rune)) actions.vision?.(rune);
      return;
    }
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
      case 'KeyM':
        actions.mute?.();
        break;
      case 'BracketLeft':
        actions.volume?.(-1);
        break;
      case 'BracketRight':
        actions.volume?.(1);
        break;
    }
  }
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
