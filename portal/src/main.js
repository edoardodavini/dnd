import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createState, parseLitParam } from './state.js';
import { glowColor } from './palette.js';
import { phaseCurves, followCurves } from './timeline.js';
import { fitCameraDistance } from './layout.js';
import { cameraPose, applyCamera } from './camera.js';
import { attachInput } from './input.js';
// @imports

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.quality.maxPixelRatio));
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
const rim = new THREE.DirectionalLight(0xa8bcd8, 0.25);
rim.position.set(-1.5, 2, 1.2);
scene.add(rim);

const state = createState();
const preset = parseLitParam(params.get('lit'));
if (preset) state.setInstant(preset);
// @modules

attachInput(state, {
  fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  help: () => $('help').classList.toggle('show'),
  debug: () => $('debug').classList.toggle('show'),
});
if (params.has('debug')) $('debug').classList.add('show');

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  distance = fitCameraDistance(camera.aspect);
  // @resize
}
window.addEventListener('resize', resize);

function render() {
  renderer.render(scene, camera);
}

const color = new THREE.Color();
let curves = phaseCurves(state.phase, state.phaseTime);
const portal = { state, frames: 0, fps: 0 };
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
  // @update
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
