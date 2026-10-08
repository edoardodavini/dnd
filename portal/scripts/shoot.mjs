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
  ['0-dormant', 'portal.html', ''],
  ['06-lit', 'portal.html', 'lit=1,2,3,4,5,6'],
  ['11-lit', 'portal.html', 'lit=1,2,3,4,5,6,7,8,9,10,11'],
  ['12-open', 'portal.html', 'lit=all'],
  ['hint-0-div', 'portal-hint.html', 'vision=12'],
  ['hint-06-mul', 'portal-hint.html', 'lit=1,2,3,4,5,6&vision=9'],
  ['hint-11-add', 'portal-hint.html', 'lit=1,2,4,5,6,7,8,9,10,11&vision=3'],
  ['sound-06', 'portal-sound.html', 'lit=1,2,3,4,5,6'],
];

const url = (name) => pathToFileURL(path.resolve('dist', name)).href;
const file = url('portal.html');
const filter = process.argv[2];
const errors = [];
mkdirSync('shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: GL_ARGS, timeout: 180000 });
try {
  for (const [name, pageFile, query] of SHOTS) {
    if (filter && !name.includes(filter)) continue;
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    await page.goto(`${url(pageFile)}?debug=1${query ? `&${query}` : ''}`);
    await page.waitForFunction(() => window.__portal?.frames > 30, { timeout: 120000 });
    await page.screenshot({ path: `shots/${name}.png` });
    const info = await page.evaluate(() => ({ phase: window.__portal.state.phase, fps: window.__portal.fps }));
    console.log(name.padEnd(10), JSON.stringify(info));
    await page.close();
  }
  // Every generated sound rendered offline in the page: no NaN, no clipping, audible, faded tails.
  if (!filter || filter === 'audio') {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(`[audio] ${e.message}`));
    await page.goto(url('portal-sound.html'));
    await page.waitForFunction(() => window.__portal?.frames > 5, { timeout: 120000 });
    const results = await page.evaluate(() => window.__portal.audioSelfTest());
    for (const r of results) {
      const fail = [];
      if (r.kind === 'cap') {
        if (r.granted !== 24) fail.push(`voice cap granted ${r.granted}, expected 24`);
        if (!r.priorityGranted) fail.push('priority voice refused at full cap');
      } else {
        const peakDb = 20 * Math.log10(r.peak || 1e-12);
        if (r.nan) fail.push(`${r.nan} NaN samples`);
        if (peakDb > -1) fail.push(`peak ${peakDb.toFixed(1)} dBFS`);
        if (r.rms < 1e-5) fail.push('silent');
        if (r.kind === 'oneshot' && r.tailRms > 0.01 * r.peak) fail.push('tail not faded');
      }
      // Every opening cue must make it into the mix (a full voice cap once dropped the boom).
      const boomPeak = results.find((x) => x.name === 'boom')?.peak ?? 0;
      if (r.name === 'opening' && r.peak < boomPeak * 0.9) fail.push('opening is missing its boom');
      const whisperPeak = results.find((x) => x.name === 'whisper')?.peak ?? 0;
      if (r.name === 'whisperReplay' && r.peak > whisperPeak * 1.25) fail.push('replayed whispers stack');
      console.log(`audio:${r.name}`.padEnd(18), fail.length ? `FAIL ${fail.join(', ')}` : 'ok');
      for (const f of fail) errors.push(`[audio:${r.name}] ${f}`);
    }
    // The very first key of the night is a rune: it must unlock audio and be heard.
    await page.keyboard.press('Digit1');
    await new Promise((r) => setTimeout(r, 400));
    const live = await page.evaluate(() => window.__portal.audio.debug());
    console.log('audio:live'.padEnd(18), JSON.stringify(live));
    if (live.state !== 'running') errors.push(`[audio:live] context ${live.state}, expected running`);
    if (live.voices < 1) errors.push('[audio:live] first rune press made no sound');
    // A suspended audio clock (sleep, HDMI drop) must not queue droplets that later fire all at once.
    await page.evaluate(() => { for (let i = 1; i < 11; i++) window.__portal.state.toggle(i); });
    await page.evaluate(() => window.__portal.audio.context.suspend());
    const before = (await page.evaluate(() => window.__portal.audio.debug())).droplets;
    await new Promise((r) => setTimeout(r, 1500));
    const after = (await page.evaluate(() => window.__portal.audio.debug())).droplets;
    console.log('audio:suspended'.padEnd(18), after === before ? 'ok' : `FAIL ${after - before} droplets queued`);
    if (after !== before) errors.push(`[audio:suspended] ${after - before} droplets queued while the audio clock was stopped`);
    await page.evaluate(() => window.__portal.audio.context.resume());
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
