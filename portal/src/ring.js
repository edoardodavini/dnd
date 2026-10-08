import * as THREE from 'three';
import { CONFIG } from './config.js';
import { runeAngle, runeCenter } from './layout.js';
import { GLYPHS, MAX_SEGMENTS, flattenGlyph } from './glyphs.js';
import { NOISE_GLSL } from './glsl/noise.js';

const VERTEX_HEAD = /* glsl */ `
uniform vec2 uBlockOffset;
uniform float uChipAmount;
varying vec3 vRingPos;
varying vec3 vObjNormal;
${NOISE_GLSL}
`;

// Displacement depends on position only, so vertices shared by faces stay welded (no cracks).
const VERTEX_DISPLACE = /* glsl */ `
#include <begin_vertex>
vRingPos = position + vec3(uBlockOffset, 0.0);
vObjNormal = normal;
vec3 np = vRingPos * 9.0;
vec3 chip = vec3(snoise(np), snoise(np + 31.7), snoise(np + 71.3));
np = vRingPos * 31.0;
chip += 0.4 * vec3(snoise(np), snoise(np + 13.1), snoise(np + 47.9));
transformed += chip * uChipAmount;
`;

const FRAGMENT_HEAD = /* glsl */ `
#define MAX_SEG ${MAX_SEGMENTS}
#define GROOVE_W 0.05
#define GROOVE_DEPTH 0.4
uniform vec2 uGlyphCenter;
uniform vec2 uGlyphUp;
uniform float uGlyphSize;
uniform vec4 uSeg[MAX_SEG];
uniform vec2 uSegParam[MAX_SEG];
uniform int uSegCount;
uniform float uSeed;
uniform float uBumpScale;
uniform float uGlow;
uniform float uProgress;
uniform float uEmber;
uniform float uCarve;
uniform vec3 uRuneColor;
varying vec3 vRingPos;
varying vec3 vObjNormal;
${NOISE_GLSL}

// Weathered basalt relief: broad undulation, grain, pits, hairline cracks.
float stoneHeight(vec3 p) {
  float h = 0.6 * fbm(p * 6.0);
  h += 0.15 * snoise(p * 70.0);
  h -= 0.25 * smoothstep(0.6, 0.85, snoise(p * 48.0 + 3.7));
  float crack = 1.0 - abs(snoise(p * 3.0 + 11.0));
  h -= 0.8 * smoothstep(0.985, 0.998, crack);
  return h;
}

vec2 glyphCoords(vec2 xy) {
  vec2 rel = xy - uGlyphCenter;
  vec2 right = vec2(uGlyphUp.y, -uGlyphUp.x);
  return vec2(dot(rel, right), dot(rel, uGlyphUp)) / uGlyphSize;
}

// x: distance to the nearest stroke (glyph units), y: pen-order position along the glyph (0..1).
vec2 glyphField(vec2 q) {
  float best = 1e3;
  float along = 0.0;
  for (int k = 0; k < MAX_SEG; k++) {
    if (k >= uSegCount) break;
    vec2 a = uSeg[k].xy;
    vec2 ab = uSeg[k].zw - a;
    float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
    float d = length(q - a - ab * t);
    if (d < best) {
      best = d;
      along = uSegParam[k].x + uSegParam[k].y * t;
    }
  }
  return vec2(best, along);
}

float grooveProfile(float d) { return 1.0 - smoothstep(GROOVE_W * 0.3, GROOVE_W, d); }

// 1 where the rune is carved so far (along its strokes), 0 on plain stone. Unlit runes don't exist.
float carveMask(float along) {
  return smoothstep(along - 0.06, along, uCarve * 1.06) * step(0.001, uCarve);
}

float surfaceHeight(vec3 p, bool front) {
  float h = stoneHeight(p + uSeed);
  if (front && uCarve > 0.0) {
    vec2 f = glyphField(glyphCoords(p.xy));
    h -= GROOVE_DEPTH * grooveProfile(f.x) * carveMask(f.y);
  }
  return h;
}
`;

const FRAGMENT_ALBEDO = /* glsl */ `
#include <map_fragment>
bool isFront = vObjNormal.z > 0.5;
vec2 gField = isFront && uCarve > 0.0 ? glyphField(glyphCoords(vRingPos.xy)) : vec2(1.0, 0.0);
float groove = grooveProfile(gField.x) * carveMask(gField.y);
float hHere = stoneHeight(vRingPos + uSeed);
float tone = 0.5 + 0.5 * fbm(vRingPos * 2.5 + uSeed * 1.7);
vec3 stone = mix(vec3(0.026, 0.026, 0.03), vec3(0.062, 0.06, 0.056), tone);
stone += vec3(0.05) * smoothstep(0.72, 0.92, snoise(vRingPos * 90.0 + uSeed));
stone *= 1.0 - 0.55 * (1.0 - smoothstep(-0.8, -0.15, hHere));
stone *= 1.0 - 0.6 * groove;
diffuseColor.rgb = stone;
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = clamp(0.95 - 0.2 * smoothstep(0.2, 0.6, hHere), 0.5, 1.0);
`;

// Bump from the analytic height field. The ring sits unrotated at the origin and block tilts are
// tiny, so object space ≈ world space and mat3(viewMatrix) takes the gradient to view space.
const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
{
  const float eps = 0.0015;
  float h0 = surfaceHeight(vRingPos, isFront);
  vec3 grad = vec3(
    surfaceHeight(vRingPos + vec3(eps, 0.0, 0.0), isFront) - h0,
    surfaceHeight(vRingPos + vec3(0.0, eps, 0.0), isFront) - h0,
    surfaceHeight(vRingPos + vec3(0.0, 0.0, eps), isFront) - h0) / eps;
  vec3 gv = mat3(viewMatrix) * (grad * uBumpScale);
  normal = normalize(normal - (gv - dot(gv, normal) * normal));
}
`;

const FRAGMENT_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
if (isFront) {
  float core = 1.0 - smoothstep(GROOVE_W * 0.5, GROOVE_W * 1.1, gField.x);
  float reveal = smoothstep(gField.y - 0.06, gField.y, uProgress * 1.06) * step(0.001, uProgress);
  totalEmissiveRadiance += uRuneColor * (core * reveal * uGlow);
  totalEmissiveRadiance += vec3(0.32, 0.035, 0.006) * (core * uEmber * carveMask(gField.y));
}
`;

function blockGeometry(i, cfg) {
  const a = runeAngle(i);
  const rOut = cfg.outer - cfg.bevel;
  const rIn = cfg.inner + cfg.bevel;
  // End faces are offset parallel to the radial line so seams stay a constant width after bevelling.
  const off = cfg.bevel + cfg.seam / 2;
  const hOut = Math.PI / 12 - Math.asin(off / rOut);
  const hIn = Math.PI / 12 - Math.asin(off / rIn);
  const shape = new THREE.Shape();
  shape.moveTo(rOut * Math.cos(a - hOut), rOut * Math.sin(a - hOut));
  shape.absarc(0, 0, rOut, a - hOut, a + hOut, false);
  shape.lineTo(rIn * Math.cos(a + hIn), rIn * Math.sin(a + hIn));
  shape.absarc(0, 0, rIn, a + hIn, a - hIn, true);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: cfg.depth,
    steps: 3,
    curveSegments: 48,
    bevelEnabled: true,
    bevelThickness: cfg.bevel,
    bevelSize: cfg.bevel,
    bevelSegments: 5,
  });
  geo.translate(0, 0, -(cfg.depth + cfg.bevel)); // front face at z = 0
  return geo;
}

function stoneMaterial(uniforms) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_HEAD + shader.vertexShader.replace('#include <begin_vertex>', VERTEX_DISPLACE);
    shader.fragmentShader = FRAGMENT_HEAD + shader.fragmentShader
      .replace('#include <map_fragment>', FRAGMENT_ALBEDO)
      .replace('#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <emissivemap_fragment>', FRAGMENT_EMISSIVE);
  };
  return material;
}

export function createRing(cfg = CONFIG.ring) {
  const group = new THREE.Group();
  const rMid = (cfg.inner + cfg.outer) / 2;
  const blocks = GLYPHS.map((glyph, i) => {
    const a = runeAngle(i);
    const c = runeCenter(i, rMid);
    const rnd = (k) => {
      const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const { segments, params } = flattenGlyph(glyph);
    const uniforms = {
      uBlockOffset: { value: new THREE.Vector2(c.x, c.y) },
      uChipAmount: { value: cfg.chipAmount },
      uGlyphCenter: { value: new THREE.Vector2(c.x, c.y) },
      uGlyphUp: { value: new THREE.Vector2(Math.cos(a), Math.sin(a)) },
      uGlyphSize: { value: cfg.glyphSize },
      uSeg: { value: Array.from({ length: MAX_SEGMENTS }, (_, k) => new THREE.Vector4(...(segments[k] ?? [0, 0, 0, 0]))) },
      uSegParam: { value: Array.from({ length: MAX_SEGMENTS }, (_, k) => new THREE.Vector2(...(params[k] ?? [0, 0]))) },
      uSegCount: { value: segments.length },
      uSeed: { value: i * 7.31 },
      uBumpScale: { value: cfg.bumpScale },
      uGlow: { value: 0 },
      uProgress: { value: 0 },
      uEmber: { value: 0 },
      uCarve: { value: 0 },
      uRuneColor: { value: new THREE.Color(1, 0.5, 0.1) },
    };
    const geo = blockGeometry(i, cfg);
    geo.translate(-c.x, -c.y, 0); // pivot at the block centre so tilts stay local
    const mesh = new THREE.Mesh(geo, stoneMaterial(uniforms));
    mesh.position.set(c.x, c.y, (rnd(4) - 0.5) * 0.012);
    mesh.rotation.set((rnd(1) - 0.5) * 0.02, (rnd(2) - 0.5) * 0.02, (rnd(3) - 0.5) * 0.006);
    mesh.scale.setScalar(1 + (rnd(5) - 0.5) * 0.015);
    group.add(mesh);
    return { mesh, uniforms };
  });
  return { group, blocks };
}
