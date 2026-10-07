// Every tunable lives here so the portal can be tuned on the TV without hunting through modules.
export const CONFIG = {
  quality: {
    maxPixelRatio: 1.5,
    simSize: 256,
    simHz: 120,
    mercurySegments: 256,
  },
  ring: {
    outer: 1.0,
    inner: 0.72,
    depth: 0.12,
    bevel: 0.018,
    seam: 0.008,
    glyphSize: 0.2,
    chipAmount: 0.006,
    bumpScale: 0.03,
  },
  mercury: { radius: 0.735, z: -0.035, displacement: 0.06, shapeScale: 0.06 },
  camera: { fov: 35, ringScreenFraction: 0.85, driftDeg: 2, driftPeriod: 30 },
  timing: {
    ignite: 0.7,
    unlight: 0.9,
    chargeTau: 0.5,
    energyTau: 0.8,
    opening: 5.0,
    collapse: 2.0,
  },
};
