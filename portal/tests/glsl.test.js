import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// GLSL pow(x, y) is undefined for x < 0 (NaN on some drivers, which bloom then smears).
// Every GLSL pow base must be visibly non-negative: wrapped in clamp(), abs() or max().
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}

describe('GLSL safety', () => {
  it('never calls pow() on a possibly negative base', () => {
    const bad = [];
    for (const file of sources('src')) {
      const text = readFileSync(file, 'utf8').replace(/Math\.pow\(/g, '');
      for (const m of text.matchAll(/\bpow\(\s*([^,]*)/g)) {
        if (!/^(clamp|abs|max)\(/.test(m[1].trim())) bad.push(`${file}: pow(${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
