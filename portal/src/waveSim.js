import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CONFIG } from './config.js';
import { MAX_IMPULSES } from './rippleDriver.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Discrete wave equation on a heightfield; R = height now, G = height last step.
// Cells outside the disc are held at 0, so waves reflect off the stone rim.
const fragmentShader = /* glsl */ `
#define MAX_IMP ${MAX_IMPULSES}
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec4 uImp[MAX_IMP];
uniform int uImpCount;
uniform float uWave;
uniform float uDamping;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  if (length(p) > 0.985) { gl_FragColor = vec4(0.0); return; }
  vec4 s = texture2D(uState, vUv);
  float n = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
  float so = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
  float e = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float w = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float next = (2.0 * s.r - s.g + uWave * (n + so + e + w - 4.0 * s.r)) * uDamping;
  for (int k = 0; k < MAX_IMP; k++) {
    if (k >= uImpCount) break;
    vec2 d = p - uImp[k].xy;
    next += uImp[k].w * exp(-dot(d, d) / (uImp[k].z * uImp[k].z));
  }
  gl_FragColor = vec4(clamp(next, -2.0, 2.0), s.r, 0.0, 1.0);
}
`;

export function createWaveSim(renderer, size = CONFIG.quality.simSize) {
  const options = {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  };
  let read = new THREE.WebGLRenderTarget(size, size, options);
  let write = new THREE.WebGLRenderTarget(size, size, options);
  const uniforms = {
    uState: { value: null },
    uTexel: { value: new THREE.Vector2(1 / size, 1 / size) },
    uImp: { value: Array.from({ length: MAX_IMPULSES }, () => new THREE.Vector4()) },
    uImpCount: { value: 0 },
    uWave: { value: 0.45 }, // must stay ≤ 0.5 for stability
    uDamping: { value: 0.996 },
  };
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader }));

  function step(impulses, substeps) {
    const previous = renderer.getRenderTarget();
    for (let k = 0; k < substeps; k++) {
      const list = k === 0 ? impulses.slice(0, MAX_IMPULSES) : [];
      list.forEach((im, j) => uniforms.uImp.value[j].set(im.x, im.y, im.r, im.s));
      uniforms.uImpCount.value = list.length;
      uniforms.uState.value = read.texture;
      renderer.setRenderTarget(write);
      quad.render(renderer);
      [read, write] = [write, read];
    }
    renderer.setRenderTarget(previous);
  }

  return {
    get texture() { return read.texture; },
    size,
    step,
    setDamping(value) {
      uniforms.uDamping.value = value;
    },
  };
}
