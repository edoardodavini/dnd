import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { exposure, bloomStrength } from './timeline.js';

// Runs after tone mapping. Vignette and grain are multiplicative so pure black stays pure black
// on the OLED; the clamp guarantees no full-white frame.
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.035 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.8);
      c.rgb *= mix(0.55, 1.0, 1.0 - smoothstep(0.25, 0.85, length(d)));
      c.rgb *= 1.0 + (hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      c.rgb = clamp(c.rgb, 0.0, 0.96);
      gl_FragColor = c;
    }
  `,
};

export function createPostFx(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const ratio = renderer.getPixelRatio();
  const target = new THREE.WebGLRenderTarget(size.x * ratio, size.y * ratio, {
    type: THREE.HalfFloatType, // no MSAA: 4× half-float MSAA dropped 2880×1620 to 4 fps
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.4, 1.1);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  return {
    setSize(w, h) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(w, h);
    },
    update(state, curves, t) {
      renderer.toneMappingExposure = exposure(state.charge, curves);
      bloom.strength = bloomStrength(state.charge, curves);
      finish.uniforms.uTime.value = t;
    },
    render() {
      composer.render();
    },
  };
}
