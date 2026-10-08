import { createEngine } from './engine.js';
import * as voices from './voices.js';

const RATE = 48000;

function measure(buffer) {
  let nan = 0;
  let peak = 0;
  let sum = 0;
  let tailSum = 0;
  const tailStart = buffer.length - Math.floor(0.05 * buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let k = 0; k < data.length; k++) {
      const x = data[k];
      if (!Number.isFinite(x)) {
        nan++;
        continue;
      }
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      if (k >= tailStart) tailSum += x * x;
    }
  }
  const channels = buffer.numberOfChannels;
  return {
    nan,
    peak,
    rms: Math.sqrt(sum / (buffer.length * channels)),
    tailRms: Math.sqrt(tailSum / ((buffer.length - tailStart) * channels)),
  };
}

async function render(seconds, play) {
  const ctx = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const engine = createEngine(ctx);
  play(engine);
  return measure(await ctx.startRendering());
}

// Durations include the 2.8 s chamber tail.
export const ONE_SHOTS = {
  stoneGrind: [3.5, (e) => voices.stoneGrind(e)],
  bowl: [8, (e) => voices.bowl(e, { rune: 0, brightness: 1 })],
  bowlEcho: [10, (e) => voices.bowl(e, { rune: 11, brightness: 1, echo: 0.45 })],
  cool: [4, (e) => voices.cool(e, { rune: 5 })],
  bloop: [3, (e) => voices.bloop(e)],
  rumble: [6, (e) => voices.rumble(e)],
  inhale: [3.5, (e) => voices.inhale(e)],
  boom: [5, (e) => voices.boom(e)],
  splash: [4.5, (e) => voices.splash(e)],
  whisper: [9.5, (e) => voices.whisper(e)],
  chase: [5, (e) => voices.chase(e)],
};

// Continuous layers and overlapping scenes: no tail check.
export const MIXES = {
  opening: [6, (e) => {
    voices.chase(e, { at: 0 });
    for (const [t, cue] of [[1.0, 'rumble'], [1.8, 'inhale'], [2.4, 'surge'], [3.2, 'splash']]) voices.CUE_SOUNDS[cue](e, { at: t });
  }],
};

export async function audioSelfTest() {
  const results = [];
  for (const [name, [seconds, play]] of Object.entries(ONE_SHOTS)) {
    results.push({ name, kind: 'oneshot', ...(await render(seconds, play)) });
  }
  for (const [name, [seconds, play]] of Object.entries(MIXES)) {
    results.push({ name, kind: 'mix', ...(await render(seconds, play)) });
  }
  const capEngine = createEngine(new OfflineAudioContext(2, RATE, RATE));
  let granted = 0;
  for (let k = 0; k < 30; k++) if (capEngine.claimVoice()) granted++;
  results.push({ name: 'voiceCap', kind: 'cap', granted });
  return results;
}
