// Screenshots dist/portal.html at fixed states. Usage: npm run shoot [name-filter]
// Set PORTAL_GL=swiftshader if the GPU path fails in headless Chrome.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GL_ARGS = process.env.PORTAL_GL === 'swiftshader'
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=metal', '--ignore-gpu-blocklist'];
const SHOTS = [
  ['0-dormant', ''],
  ['06-lit', '1,2,3,4,5,6'],
  ['11-lit', '1,2,3,4,5,6,7,8,9,10,11'],
  ['12-open', 'all'],
];

const file = pathToFileURL(path.resolve('dist/portal.html')).href;
const filter = process.argv[2];
const errors = [];
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: GL_ARGS });
try {
  for (const [name, lit] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    await page.goto(`${file}?debug=1${lit ? `&lit=${lit}` : ''}`);
    await page.waitForFunction(() => window.__portal?.frames > 30, { timeout: 120000 });
    await page.screenshot({ path: `shots/${name}.png` });
    const info = await page.evaluate(() => ({ phase: window.__portal.state.phase, fps: window.__portal.fps }));
    console.log(name.padEnd(10), JSON.stringify(info));
    await page.close();
  }
  // Bloom must run at half the drawing buffer on HiDPI too (it was sized with pixelRatio² once).
  if (!filter) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
    await page.goto(`${file}?lit=1`);
    await page.waitForFunction(() => window.__portal?.frames > 5, { timeout: 120000 });
    const { bloom, canvas } = await page.evaluate(() => ({
      bloom: window.__portal.bloomWidth(),
      canvas: document.querySelector('canvas').width,
    }));
    console.log('dpr2-bloom'.padEnd(10), JSON.stringify({ bloom, canvas }));
    if (bloom !== Math.round(canvas / 2)) errors.push(`[dpr2-bloom] bloom mip0 ${bloom}px, expected ${Math.round(canvas / 2)}px`);
    await page.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
