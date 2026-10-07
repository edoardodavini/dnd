// Glow colour (sRGB) by charge. Stops sit at the centre of each lit-count band.
const STOPS = [
  [2 / 12, [1.0, 0.42, 0.08]], // 1-3: deep amber
  [5 / 12, [1.0, 0.68, 0.22]], // 4-6: gold
  [8 / 12, [1.0, 0.88, 0.62]], // 7-9: white-gold
  [10.5 / 12, [0.78, 0.9, 1.0]], // 10-11: pale blue-white
  [1.0, [0.6, 0.82, 1.0]], // open: brilliant blue-white (brightness comes from intensity)
];

export const EMBER_RGB = [0.55, 0.1, 0.02];

export function glowColor(charge) {
  const c = Math.min(1, Math.max(0, charge));
  if (c <= STOPS[0][0]) return [...STOPS[0][1]];
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    if (c <= t1) {
      const [t0, c0] = STOPS[k - 1];
      const f = (c - t0) / (t1 - t0);
      if (f === 1) return [...c1];
      return c0.map((v, j) => v + (c1[j] - v) * f);
    }
  }
  return [...STOPS[STOPS.length - 1][1]];
}
