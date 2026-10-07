// Dethek-inspired runes: vertical stems with angular branches. Invented, not real letters.
// Glyph units: x right, y up (up = outward from the ring centre). Strokes are drawn in order;
// the lighting animation fills them in that order.
// Indices 2, 5, 8, 11 hide the four energies (+, −, ×, ÷) among extra stems and ticks.
export const GLYPHS = [
  // 1
  [[[0, -0.4], [0, 0.4]], [[0, 0.1], [0.25, 0.3]], [[0, -0.15], [0.25, 0.05]]],
  // 2
  [[[0, -0.4], [0, 0.4]], [[-0.25, 0.25], [0, 0.05], [0.25, 0.25]]],
  // 3 — addition
  [
    [[0, -0.4], [0, 0.32]], [[-0.3, 0], [0.3, 0]],
    [[-0.3, 0], [-0.3, 0.12]], [[0.3, 0], [0.3, -0.12]],
    [[-0.1, 0.4], [0, 0.32], [0.1, 0.4]],
  ],
  // 4
  [[[0, -0.4], [0, -0.05]], [[0, -0.05], [0.15, 0.15], [0, 0.35], [-0.15, 0.15], [0, -0.05]]],
  // 5
  [[[-0.15, -0.4], [-0.15, 0.4]], [[-0.15, 0.2], [0.15, 0]], [[0.15, -0.4], [0.15, 0.4]], [[0.15, 0.3], [0.28, 0.4]]],
  // 6 — subtraction
  [[[-0.28, 0], [0.28, 0]], [[-0.28, 0], [-0.28, -0.3]], [[0.28, 0], [0.28, 0.3]], [[0.28, 0.3], [0.18, 0.38]]],
  // 7
  [[[0, -0.4], [0, 0.4]], [[-0.2, -0.2], [0, -0.4], [0.2, -0.2]], [[-0.15, 0.25], [0, 0.4]]],
  // 8
  [[[0, -0.4], [0, 0.4]], [[0, 0.4], [-0.22, 0.18]], [[0, 0], [0.22, -0.22]], [[0, -0.2], [-0.2, -0.38]]],
  // 9 — multiplication
  [[[-0.25, -0.3], [0.25, 0.3]], [[-0.25, 0.3], [0.25, -0.3]], [[0, -0.42], [0, 0.42]], [[-0.1, -0.42], [0.1, -0.42]]],
  // 10
  [[[0, -0.4], [0, 0.4]], [[0, 0.4], [0.22, 0.25], [0, 0.1]], [[0, -0.4], [0.15, -0.3]]],
  // 11
  [[[0, -0.4], [0, 0.4]], [[-0.22, 0.18], [0, 0.4], [0.22, 0.18]], [[-0.18, -0.2], [0, -0.2]]],
  // 12 — division
  [
    [[-0.28, 0], [0.28, 0]],
    [[0, 0.2], [0.05, 0.25], [0, 0.3], [-0.05, 0.25], [0, 0.2]],
    [[0, -0.2], [0.05, -0.25], [0, -0.3], [-0.05, -0.25], [0, -0.2]],
    [[-0.28, 0], [-0.36, 0.1]], [[0.28, 0], [0.36, -0.1]],
  ],
];

export const MAX_SEGMENTS = 16;

export function flattenGlyph(glyph) {
  const segments = [];
  for (const stroke of glyph) {
    for (let k = 0; k < stroke.length - 1; k++) segments.push([...stroke[k], ...stroke[k + 1]]);
  }
  const lengths = segments.map(([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay));
  const total = lengths.reduce((a, b) => a + b, 0);
  let acc = 0;
  const params = lengths.map((len) => {
    const p = [acc / total, len / total];
    acc += len;
    return p;
  });
  return { segments, params };
}
