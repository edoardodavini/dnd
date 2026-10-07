import * as THREE from 'three';
import { CONFIG } from './config.js';
import { NOISE_GLSL } from './glsl/noise.js';

const HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uSim;
uniform float uRadius;
uniform float uDisp;
uniform float uShapeScale;
uniform float uTime;
uniform float uCharge;
uniform vec4 uEnergy; // add, sub, mul, div
uniform float uInhale;
uniform float uSurge;

// Slow, large-scale shape of the liquid (units: × uShapeScale).
float shapeHeight(vec2 q) {
  float r2 = dot(q, q);
  float rim = 1.0 - smoothstep(0.75, 1.0, sqrt(r2));
  float ang = atan(q.y, q.x + 1e-5);
  float breath = 0.15 * sin(uTime * 0.5) * (1.0 - r2);
  float dome = 0.9 * uEnergy.x * (1.0 - r2);
  float drain = -uEnergy.y * (1.1 * exp(-r2 * 3.0)
    + 0.12 * sin(ang * 3.0 - uTime * 0.8 + sqrt(r2) * 9.0) * (1.0 - r2) * smoothstep(0.0, 0.35, sqrt(r2)));
  float swell = 0.6 * smoothstep(0.75, 1.0, uCharge) * (1.0 - r2);
  float inhale = -2.0 * uInhale * exp(-r2 * 4.0);
  return (breath + dome + drain + swell + inhale) * rim;
}

// Opening surge: the liquid erupts toward the viewer.
float plume(vec2 q) {
  float r2 = dot(q, q);
  return uSurge * 1.1 * exp(-r2 / 0.12) * (1.0 + 0.08 * sin(atan(q.y, q.x + 1e-5) * 5.0 + uTime * 6.0));
}

float totalHeight(vec2 q) {
  return texture2D(uSim, q * 0.5 + 0.5).r * uDisp + shapeHeight(q) * uShapeScale + plume(q);
}
`;

const vertexShader = /* glsl */ `
${HEIGHT_GLSL}
varying vec2 vDisc;
varying vec3 vWorldPos;
void main() {
  vec2 q = position.xy / uRadius;
  vDisc = q;
  vec3 pos = vec3(position.xy, length(q) <= 1.0 ? totalHeight(q) : 0.0);
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${HEIGHT_GLSL}
${NOISE_GLSL}
uniform float uSimTexel;
uniform float uOpen;
uniform float uCollapse;
uniform vec3 uColor;
uniform float uGlow[12];
varying vec2 vDisc;
varying vec3 vWorldPos;

// Fine, irregular surface shiver (animated noise, not plane waves: plane waves interfere into a lattice).
float microWaves(vec2 q) {
  return snoise(vec3(q * 14.0, uTime * 0.5)) * (0.00006 + 0.00025 * uCharge);
}

// Procedural surroundings the liquid reflects: a soft silver studio gradient
// plus a ring of 12 lights mirroring the runes (seen when waves tilt the surface).
vec3 env(vec3 R) {
  float front = max(R.z, 0.0);
  // Lit from above, dark below: a mirror shows this as a crisp gradient that ripples distort.
  float upper = smoothstep(-0.12, 0.22, R.y + 0.15 * R.x);
  vec3 sky = vec3(0.62, 0.64, 0.68) * (0.05 + 0.3 * uCharge + 0.1 * uOpen) * upper * front * front;
  vec2 k = R.xy - vec2(-0.12, 0.2);
  sky += vec3(1.0) * (0.05 + 0.6 * uCharge) * exp(-dot(k, k) * 60.0);
  float lr = length(R.xy);
  float a = atan(R.y, R.x + 1e-5);
  float runes = 0.0;
  for (int i = 0; i < 12; i++) {
    float ai = 1.5707963 - float(i + 1) * 0.5235988;
    float da = abs(mod(a - ai + 3.14159265, 6.2831853) - 3.14159265);
    runes += uGlow[i] * exp(-da * da * 40.0);
  }
  runes *= exp(-pow((lr - 0.35) * 9.0, 2.0));
  return sky + uColor * runes * 3.0;
}

void main() {
  float rr = length(vDisc);
  if (rr > 1.0) discard;
  float e = uSimTexel;
  float hx = totalHeight(vDisc + vec2(e, 0.0)) - totalHeight(vDisc - vec2(e, 0.0))
           + microWaves(vDisc + vec2(e, 0.0)) - microWaves(vDisc - vec2(e, 0.0));
  float hy = totalHeight(vDisc + vec2(0.0, e)) - totalHeight(vDisc - vec2(0.0, e))
           + microWaves(vDisc + vec2(0.0, e)) - microWaves(vDisc - vec2(0.0, e));
  vec3 N = normalize(vec3(-hx, -hy, 2.0 * e * uRadius));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 R = reflect(-V, N);
  float NoV = max(dot(N, V), 0.0);
  vec3 F0 = vec3(0.78, 0.78, 0.8);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
  vec3 col = env(R) * F;

  // Light from within: brighter on crests, strongest once open.
  float crest = clamp(texture2D(uSim, vDisc * 0.5 + 0.5).r * 8.0, -1.0, 1.0);
  col += uColor * (0.01 + 0.12 * uCharge * uCharge + 0.3 * uOpen) * (0.6 + 0.4 * crest);

  // Faint slow rays once open.
  float ang = atan(vDisc.y, vDisc.x + 1e-5);
  float rays = pow(abs(sin(ang * 13.0 + uTime * 0.2) * sin(ang * 7.0 - uTime * 0.13)), 6.0);
  col += uColor * rays * (1.0 - rr) * uOpen * 0.5;

  // Collapse: slow uneven flicker (≤ ~1.5 Hz, never a strobe).
  col *= 1.0 - 0.35 * uCollapse * (0.5 + 0.5 * sin(uTime * 9.0) * sin(uTime * 5.3));

  // Meniscus: darker where the liquid meets the stone.
  col *= mix(0.35, 1.0, 1.0 - smoothstep(0.94, 1.0, rr));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createMercury(sim, cfg = CONFIG.mercury) {
  const segments = CONFIG.quality.mercurySegments;
  const uniforms = {
    uSim: { value: sim.texture },
    uSimTexel: { value: 2 / sim.size },
    uRadius: { value: cfg.radius },
    uDisp: { value: cfg.displacement },
    uShapeScale: { value: cfg.shapeScale },
    uTime: { value: 0 },
    uCharge: { value: 0 },
    uEnergy: { value: new THREE.Vector4() },
    uInhale: { value: 0 },
    uSurge: { value: 0 },
    uOpen: { value: 0 },
    uCollapse: { value: 0 },
    uColor: { value: new THREE.Color() },
    uGlow: { value: new Array(12).fill(0) },
  };
  const geometry = new THREE.PlaneGeometry(cfg.radius * 2, cfg.radius * 2, segments, segments);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));
  mesh.position.z = cfg.z;
  mesh.frustumCulled = false; // the plume leaves the plane's bounding box

  // Lights the inner rim of the stone from the liquid.
  const light = new THREE.PointLight(0xffffff, 0, 3, 2);
  light.position.set(0, 0, 0.35);

  function update(state, curves, color, glows, t) {
    const en = state.energies;
    uniforms.uSim.value = sim.texture;
    uniforms.uTime.value = t;
    uniforms.uCharge.value = state.charge;
    uniforms.uEnergy.value.set(en.add, en.sub, en.mul, en.div);
    uniforms.uInhale.value = curves.inhale;
    uniforms.uSurge.value = curves.surge;
    uniforms.uOpen.value = curves.open;
    uniforms.uCollapse.value = curves.collapse;
    uniforms.uColor.value.copy(color);
    for (let i = 0; i < 12; i++) uniforms.uGlow.value[i] = glows[i];
    light.color.copy(color);
    light.intensity = 0.02 + 0.4 * state.charge * state.charge + 0.5 * curves.open + 3 * curves.surge;
  }

  return { mesh, light, update };
}
