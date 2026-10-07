import * as THREE from 'three';
import { CONFIG } from './config.js';
import { runeAngle, runeCenter } from './layout.js';
import { RUNE_COUNT } from './state.js';

// Heat remembers how lit a rune was; the gap between heat and progress is the cooling ember.
export function updateHeat(heat, progress, dt, tau = 1.4) {
  return Math.max(progress, heat * Math.exp(-dt / tau));
}

export function emberLevel(heat, progress) {
  return Math.min(1, Math.max(0, heat - progress)) * 0.8;
}

export function runeGlow(i, t, progress, flare) {
  if (progress <= 0) return 0;
  const breathe = 0.86 + 0.09 * Math.sin(t * 1.7 + i * 1.9) + 0.05 * Math.sin(t * 6.1 + i * 4.3);
  return progress * breathe * (1 + 1.5 * flare);
}

// Opening: a bright head runs clockwise around the ring.
export function chaseBoost(i, curves) {
  if (curves.chase <= 0) return 0;
  const head = (curves.chasePos * RUNE_COUNT) % RUNE_COUNT;
  let d = Math.abs(i - head);
  d = Math.min(d, RUNE_COUNT - d);
  return curves.chase * 2.5 * Math.exp((-d * d) / 1.5);
}

const EMISSIVE_GAIN = 2.5;
const LIGHT_GAIN = 0.35;
const MAX_EMBERS = 600;

function emberSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export function createRuneLights(scene, ring) {
  const rMid = (CONFIG.ring.inner + CONFIG.ring.outer) / 2;
  const heat = new Array(RUNE_COUNT).fill(0);
  const flare = new Array(RUNE_COUNT).fill(0);
  const prevProgress = new Array(RUNE_COUNT).fill(0);
  const glows = new Array(RUNE_COUNT).fill(0);

  const lights = Array.from({ length: RUNE_COUNT }, (_, i) => {
    const c = runeCenter(i, rMid);
    const light = new THREE.PointLight(0xffaa55, 0, 1.4, 2);
    light.position.set(c.x, c.y, 0.12);
    scene.add(light);
    return light;
  });

  const positions = new Float32Array(MAX_EMBERS * 3);
  const colors = new Float32Array(MAX_EMBERS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.014,
    map: emberSprite(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const embers = [];
  let lastOpeningTime = -1;

  // Embers rise "up" out of the groove: outward from the ring centre and toward the viewer.
  function burst(i, count) {
    const a = runeAngle(i);
    const c = runeCenter(i, rMid);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    for (let k = 0; k < count && embers.length < MAX_EMBERS; k++) {
      const s = (Math.random() - 0.5) * 0.16;
      const u = (Math.random() - 0.5) * 0.16;
      const speed = 0.04 + Math.random() * 0.06;
      embers.push({
        x: c.x + uy * s + ux * u,
        y: c.y - ux * s + uy * u,
        z: 0.01,
        vx: ux * speed + (Math.random() - 0.5) * 0.03,
        vy: uy * speed + (Math.random() - 0.5) * 0.03,
        vz: 0.03 + Math.random() * 0.06,
        age: 0,
        life: 1.2 + Math.random(),
      });
    }
  }

  function update(state, curves, color, dt, t) {
    for (let i = 0; i < RUNE_COUNT; i++) {
      const p = state.progress[i];
      if (prevProgress[i] < 1 && p >= 1) flare[i] = 1;
      prevProgress[i] = p;
      flare[i] *= Math.exp(-dt / 0.25);
      heat[i] = updateHeat(heat[i], p, dt);
      const g = runeGlow(i, t, p, flare[i]) * (1 + chaseBoost(i, curves)) * (1 + 0.6 * curves.open);
      glows[i] = g;
      const u = ring.blocks[i].uniforms;
      u.uGlow.value = g * EMISSIVE_GAIN;
      u.uProgress.value = p;
      u.uEmber.value = emberLevel(heat[i], p);
      u.uRuneColor.value.copy(color);
      lights[i].color.copy(color);
      lights[i].intensity = g * LIGHT_GAIN;
    }

    if (state.phase === 'opening') {
      if (lastOpeningTime < 1.0 && state.phaseTime >= 1.0) for (let i = 0; i < RUNE_COUNT; i++) burst(i, 25);
      lastOpeningTime = state.phaseTime;
    } else {
      lastOpeningTime = -1;
    }

    const drag = Math.exp(-dt * 0.8);
    for (let k = embers.length - 1; k >= 0; k--) {
      const e = embers[k];
      e.age += dt;
      if (e.age >= e.life) {
        embers.splice(k, 1);
        continue;
      }
      e.vx *= drag;
      e.vy *= drag;
      e.vz *= drag;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.z += e.vz * dt;
    }
    embers.forEach((e, k) => {
      const fade = Math.pow(1 - e.age / e.life, 1.5) * Math.min(1, e.age * 8) * 2;
      positions.set([e.x, e.y, e.z], k * 3);
      colors.set([color.r * fade, color.g * fade, color.b * fade], k * 3);
    });
    geo.setDrawRange(0, embers.length);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  return { glows, burst, update };
}
