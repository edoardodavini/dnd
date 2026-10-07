import { CONFIG } from './config.js';

export const RUNE_COUNT = 12;

export const KEY_TO_RUNE = {
  Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5,
  Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9, Minus: 10, Equal: 11,
};

// Rune index (0-based) of each hidden energy. Runes 3, 6, 9 and 12 sit at the cardinal points.
export const ENERGY_RUNES = { add: 2, sub: 5, mul: 8, div: 11 };

export function runeForKey(code) {
  return KEY_TO_RUNE[code];
}

// `?lit=1,2,12` (1-based rune numbers) or `?lit=all` → 0-based indices; used for screenshots.
export function parseLitParam(value) {
  if (!value) return null;
  if (value === 'all') return [...Array(RUNE_COUNT).keys()];
  return value
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= RUNE_COUNT)
    .map((n) => n - 1);
}

const ease = (current, target, dt, tau) => current + (target - current) * (1 - Math.exp(-dt / tau));

export function createState(timing = CONFIG.timing) {
  const lit = new Array(RUNE_COUNT).fill(false);
  const progress = new Array(RUNE_COUNT).fill(0);
  const energies = { add: 0, sub: 0, mul: 0, div: 0 };
  const listeners = { ignite: [], unlight: [], phase: [] };
  let charge = 0;
  let phase = 'dormant';
  let phaseTime = 0;

  const litCount = () => lit.reduce((n, on) => n + (on ? 1 : 0), 0);
  const emit = (type, arg) => listeners[type].forEach((fn) => fn(arg));
  const isOpenish = () => phase === 'opening' || phase === 'open';

  function setPhase(next) {
    if (next === phase) return;
    phase = next;
    phaseTime = 0;
    emit('phase', next);
  }

  function resolvePhase() {
    const n = litCount();
    if (n === RUNE_COUNT) {
      if (!isOpenish()) setPhase('opening');
    } else if (isOpenish()) {
      setPhase('collapsing');
    } else if (phase !== 'collapsing') {
      setPhase(n === 0 ? 'dormant' : 'charging');
    }
  }

  function toggle(i) {
    if (!Number.isInteger(i) || i < 0 || i >= RUNE_COUNT) return;
    lit[i] = !lit[i];
    emit(lit[i] ? 'ignite' : 'unlight', i);
    resolvePhase();
  }

  function reset() {
    for (let i = 0; i < RUNE_COUNT; i++) {
      if (lit[i]) {
        lit[i] = false;
        emit('unlight', i);
      }
    }
    resolvePhase();
  }

  function update(dt) {
    phaseTime += dt;
    for (let i = 0; i < RUNE_COUNT; i++) {
      const delta = lit[i] ? dt / timing.ignite : -dt / timing.unlight;
      progress[i] = Math.min(1, Math.max(0, progress[i] + delta));
    }
    if (phase === 'opening' && phaseTime >= timing.opening) setPhase('open');
    if (phase === 'collapsing' && phaseTime >= timing.collapse) {
      setPhase(litCount() === 0 ? 'dormant' : 'charging');
    }
    const target = isOpenish() ? 1 : litCount() / RUNE_COUNT;
    charge = ease(charge, target, dt, timing.chargeTau);
    for (const [name, idx] of Object.entries(ENERGY_RUNES)) {
      energies[name] = ease(energies[name], lit[idx] ? 1 : 0, dt, timing.energyTau);
    }
  }

  // Jump to a settled state without animations or events (URL presets for screenshots).
  function setInstant(indices) {
    lit.fill(false);
    for (const i of indices) if (i >= 0 && i < RUNE_COUNT) lit[i] = true;
    for (let i = 0; i < RUNE_COUNT; i++) progress[i] = lit[i] ? 1 : 0;
    const n = litCount();
    phase = n === RUNE_COUNT ? 'open' : n === 0 ? 'dormant' : 'charging';
    phaseTime = 0;
    charge = phase === 'open' ? 1 : n / RUNE_COUNT;
    for (const [name, idx] of Object.entries(ENERGY_RUNES)) energies[name] = lit[idx] ? 1 : 0;
  }

  return {
    get lit() { return lit; },
    get progress() { return progress; },
    get energies() { return energies; },
    get litCount() { return litCount(); },
    get charge() { return charge; },
    get phase() { return phase; },
    get phaseTime() { return phaseTime; },
    toggle,
    reset,
    update,
    setInstant,
    onIgnite: (fn) => listeners.ignite.push(fn),
    onUnlight: (fn) => listeners.unlight.push(fn),
    onPhase: (fn) => listeners.phase.push(fn),
  };
}
