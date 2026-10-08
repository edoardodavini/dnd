import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createState, parseLitParam } from './state.js';
import { glowColor } from './palette.js';
import { phaseCurves, followCurves } from './timeline.js';
import { fitCameraDistance, renderPixelRatio } from './layout.js';
import { cameraPose, applyCamera } from './camera.js';
import { attachInput } from './input.js';
import { createRing } from './ring.js';
import { createRuneLights } from './runeLights.js';
import { createWaveSim } from './waveSim.js';
import { createRippleDriver } from './rippleDriver.js';
import { createMercury } from './mercury.js';
import { createPostFx } from './postfx.js';
import { createVision } from './vision.js';
import { audioSelfTest } from './audio/selftest.js';
import { createPortalAudio } from './audio/index.js';

// portal-hint.html is built with VITE_PORTAL_HINTS=1: Shift + energy rune key shows a vision.
// portal-sound.html is built with VITE_PORTAL_SOUND=1 and always includes the hints.
const SOUND = import.meta.env.VITE_PORTAL_SOUND === '1';
const HINTS = SOUND || import.meta.env.VITE_PORTAL_HINTS === '1';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(renderPixelRatio(window.innerWidth, window.innerHeight, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  $('error').textContent = 'The portal lost its WebGL context.\nReload the page (Cmd+R).';
  $('error').classList.add('show');
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.05, 50);
let distance = fitCameraDistance(camera.aspect);

// Faint cold rim light: with no runes lit the ring is barely visible in the black.
const rim = new THREE.DirectionalLight(0xa8bcd8, 1.4);
rim.position.set(-1.5, 2, 1.2);
scene.add(rim);

const state = createState();
const preset = parseLitParam(params.get('lit'));
if (preset) state.setInstant(preset);
const ring = createRing();
scene.add(ring.group);
const runeLights = createRuneLights(scene, ring);
state.onIgnite((i) => runeLights.burst(i, 18));
const sim = createWaveSim(renderer);
const ripples = createRippleDriver();
state.onIgnite((i) => ripples.ignite(i));
const mercury = createMercury(sim);
scene.add(mercury.mesh, mercury.light);
let simClock = 0;
const post = createPostFx(renderer, scene, camera);
const vision = createVision();
if (HINTS) {
  const [hinted] = parseLitParam(params.get('vision')) ?? [];
  if (hinted !== undefined) vision.setInstant(hinted);
  $('help').textContent += '\nShift + 3 6 9 =  vision of that rune';
}

const audio = SOUND ? createPortalAudio({ state }) : null;
if (SOUND) $('help').textContent += '\nM  mute     [ ]  volume';
let volumeTimer = 0;
function flashVolume(label) {
  $('volume').textContent = label;
  $('volume').classList.add('show');
  clearTimeout(volumeTimer);
  volumeTimer = setTimeout(() => $('volume').classList.remove('show'), 1200);
}

attachInput(state, {
  mute: audio ? () => flashVolume(audio.toggleMute()) : undefined,
  volume: audio ? (dir) => flashVolume(audio.volume(dir)) : undefined,
  fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  help: () => $('help').classList.toggle('show'),
  debug: () => $('debug').classList.toggle('show'),
  vision: HINTS
    ? (i) => {
        vision.show(i);
        ripples.pulse(0, 0, 0.25, -0.12); // something surfaces
        audio?.vision();
      }
    : undefined,
});
if (params.has('debug')) $('debug').classList.add('show');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setPixelRatio(renderPixelRatio(w, h, window.devicePixelRatio));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  distance = fitCameraDistance(camera.aspect);
  post.setSize(w, h);
}
window.addEventListener('resize', resize);

function render() {
  post.render();
}

const color = new THREE.Color();
let curves = phaseCurves(state.phase, state.phaseTime);
const portal = { state, frames: 0, fps: 0, bloomWidth: post.bloomWidth };
if (SOUND) Object.assign(portal, { audio, audioSelfTest });
window.__portal = portal;
let last = performance.now();
let t = 0;
let fpsTime = 0;
let fpsFrames = 0;

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(raw, 0.1); // a hidden tab must not fast-forward the portal
  t += dt;

  state.update(dt);
  curves = followCurves(curves, phaseCurves(state.phase, state.phaseTime), dt);
  const [r, g, b] = glowColor(state.charge);
  color.setRGB(r, g, b, THREE.SRGBColorSpace);
  runeLights.update(state, curves, color, dt, t);
  const impulses = ripples.update(state, curves, dt, vision.level);
  simClock += dt * CONFIG.quality.simHz;
  const steps = Math.max(1, Math.min(4, Math.floor(simClock)));
  simClock = Math.max(0, simClock - steps);
  sim.setDamping(0.996 - 0.015 * vision.level); // the pool stills while a vision shows
  sim.step(impulses, steps);
  vision.update(dt);
  audio?.update(curves, vision.level, dt);
  mercury.setVision(vision.rune, vision.level);
  mercury.update(state, curves, color, runeLights.glows, t);
  post.update(state, curves, t);
  applyCamera(camera, cameraPose(t, curves.shake), distance);
  render();

  portal.frames++;
  fpsFrames++;
  fpsTime += raw;
  if (fpsTime >= 0.5) {
    portal.fps = Math.round(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
    $('debug').textContent = `${portal.fps} fps · ${state.phase} · lit ${state.litCount} · charge ${state.charge.toFixed(2)}`;
  }
});
