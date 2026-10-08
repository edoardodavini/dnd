import { CONFIG } from '../config.js';
import { dbToGain } from '../soundMap.js';

// Darkened, decaying noise: a stone chamber.
function chamberImpulse(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lowpassed = 0;
    for (let k = 0; k < length; k++) {
      lowpassed += 0.25 * (Math.random() * 2 - 1 - lowpassed);
      data[k] = lowpassed * (1 - k / length) ** 3;
    }
  }
  return ir;
}

// Works on a live AudioContext or an OfflineAudioContext (self-test).
export function createEngine(ctx, cfg = CONFIG.audio) {
  const master = ctx.createGain();
  master.gain.value = dbToGain(cfg.masterDb);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = chamberImpulse(ctx, cfg.reverbSeconds);
  const reverbIn = ctx.createGain();
  reverbIn.connect(reverb).connect(master);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = noise.getChannelData(0);
  for (let k = 0; k < samples.length; k++) samples[k] = Math.random() * 2 - 1;

  let voices = 0;

  return {
    ctx,
    // A panned input that feeds the master dry and the chamber wet.
    output(pan = 0, wet = 0.35) {
      const input = ctx.createGain();
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      const send = ctx.createGain();
      send.gain.value = wet;
      input.connect(panner);
      panner.connect(master);
      panner.connect(send).connect(reverbIn);
      return input;
    },
    noiseSource() {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      return src;
    },
    // One slot per one-shot; returns a release callback, or null when the cap is reached.
    claimVoice() {
      if (voices >= cfg.maxVoices) return null;
      voices++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        voices--;
      };
    },
    setMaster(gain) {
      master.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    },
    get voices() { return voices; },
  };
}
