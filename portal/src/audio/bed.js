import { liquidDroplet } from './voices.js';
import { dropletsDue } from '../soundMap.js';

// The always-on layers. update() follows BedParams with smooth ramps only.
export function createBed(engine) {
  const { ctx } = engine;
  const out = engine.output(0, 0.3);
  const gain = (value = 0) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const osc = (type, frequency) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = frequency;
    o.start();
    return o;
  };
  const filter = (type, frequency, q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  };
  const lfoInto = (frequency, param) => {
    const depth = gain(0);
    osc('sine', frequency).connect(depth).connect(param);
    return depth;
  };

  // Air: the room breathing before the portal wakes.
  const air = gain();
  const airNoise = engine.noiseSource();
  airNoise.connect(filter('bandpass', 400, 0.8)).connect(air).connect(out);
  airNoise.start();

  // Drone: low A and its fifth, each with a detuned twin, through a lowpass and a tremolo stage.
  const drone = gain();
  const droneLp = filter('lowpass', 120, 0.5);
  const tremolo = gain(1);
  const droneVoices = [[1, -1], [1, 1], [1.5, -1], [1.5, 1]].map(([ratio, sign]) => {
    const o = osc('triangle', 55 * ratio);
    o.connect(droneLp);
    return { o, ratio, sign };
  });
  droneLp.connect(tremolo).connect(drone).connect(out);
  const restless = lfoInto(0.13, tremolo.gain);
  const beat = lfoInto(2, tremolo.gain); // ÷ energy
  const flutter = lfoInto(6, tremolo.gain); // collapse

  // Choir: stacked fifths in detuned pairs, swelling in when the portal opens.
  const choir = gain();
  const choirLp = filter('lowpass', 1200, 0.5);
  for (const f of [110, 164.81, 220, 329.63]) {
    for (const cents of [-7, 7]) {
      const o = osc('sawtooth', f);
      o.detune.value = cents;
      o.connect(choirLp);
    }
  }
  choirLp.connect(gain(0.15)).connect(choir).connect(out);

  // − energy: a sub-octave undertone with a slow wobble.
  const sub = gain();
  const subOsc = osc('triangle', 27.5); // triangle: its harmonics carry on TV speakers
  lfoInto(0.2, subOsc.detune).gain.value = 10;
  subOsc.connect(sub).connect(out);

  // + energy: an overtone gliding up an octave every 8 s, faded in and out each glide.
  const add = gain();
  const addOsc = osc('sine', 220);
  const addWindow = gain(0);
  addOsc.connect(addWindow).connect(add).connect(out);
  let nextGlide = 0;
  function scheduleGlide() {
    const now = ctx.currentTime;
    if (now + 0.5 < nextGlide) return;
    const start = Math.max(now, nextGlide);
    addOsc.frequency.setValueAtTime(220, start);
    addOsc.frequency.exponentialRampToValueAtTime(440, start + 8);
    addWindow.gain.setValueAtTime(0, start);
    addWindow.gain.linearRampToValueAtTime(1, start + 2);
    addWindow.gain.setValueAtTime(1, start + 6);
    addWindow.gain.linearRampToValueAtTime(0, start + 8);
    nextGlide = start + 8;
  }

  let liquidClock = 0;

  function update(p, dt) {
    const now = ctx.currentTime;
    const to = (param, value, tau = 0.2) => param.setTargetAtTime(value, now, tau);
    to(air.gain, p.air, 0.5);
    to(drone.gain, p.drone, 0.25);
    to(droneLp.frequency, p.droneCutoff, 0.3);
    for (const { o, ratio, sign } of droneVoices) {
      to(o.frequency, 55 * ratio * p.dronePitch, 0.3);
      to(o.detune, (sign * p.droneDetune) / 2, 0.5);
    }
    to(restless.gain, (0.2 * (p.droneDetune - 3)) / 9, 0.5);
    to(beat.gain, p.beat, 0.3);
    to(flutter.gain, 0.7 * p.flutter, 0.1);
    to(choir.gain, p.choir, 0.6);
    to(sub.gain, p.sub, 0.5);
    to(add.gain, p.add, 0.5);
    scheduleGlide();

    const due = dropletsDue(liquidClock, dt, p.liquidRate);
    liquidClock = due.clock;
    for (let k = 0; k < due.count; k++) {
      liquidDroplet(engine, { pan: Math.random() * 1.6 - 0.8, level: p.liquid, at: now + Math.random() * 0.05 });
    }
  }

  return { update };
}
