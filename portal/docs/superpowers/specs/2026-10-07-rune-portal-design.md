# Rune Portal — Design Spec

Date: 2026-10-07
Status: Draft for review

## 1. Purpose

A single-use, single-page visual prop for the final session of a D&D 5e campaign. A Stargate-style ring of 12 carved stone blocks surrounds a liquid-mercury event horizon. The DM lights runes from the keyboard; the portal escalates and finally opens when all 12 are lit.

### Context & constraints

- Displayed fullscreen on a **65" OLED TV**, which is the **only light source in the room**. The screen's overall brightness therefore lights the players; it is a storytelling tool.
- Must run **offline** from a **single self-contained HTML file** (double-click to open).
- No sound. The DM runs music separately.
- Driven only by the DM's keyboard; no mouse interaction, cursor hidden.

### Success criteria

1. Stones read as real, weathered rock on a 65" screen up close.
2. Rune lighting is visibly animated (ignite, sustain, unlight), never a hard on/off switch.
3. Mercury looks like liquid metal: reflective, with ripples and small waves.
4. Ripple intensity increases clearly and monotonically with the number of lit runes.
5. The 12th rune triggers a dramatic opening sequence.
6. The four hidden "energy" runes are indistinguishable on the stone but each has a distinct, discoverable effect on the mercury.
7. Steady 60 fps at 4K on the presentation machine (with configurable quality knobs as fallback).
8. No full-white frames and no fast strobing (dark room, large screen).

## 2. Technology

- **Three.js** (WebGL2) with custom shaders where needed.
- **Vite** dev project; **vite-plugin-singlefile** builds `dist/portal.html` with all JS (including Three.js) inlined. No external assets: all textures are generated procedurally at load.
- **Vitest** for unit tests of non-rendering logic.

## 3. Architecture

| File | Responsibility | Depends on |
|---|---|---|
| `src/config.js` | All tunables: quality (pixel-ratio cap, sim resolution, mercury mesh density), timings, colours, geometry sizes | — |
| `src/state.js` | 12 lit flags, key → rune mapping, phase machine, eased `charge` (0→1), per-rune animation progress, energy flags. Pure JS, no Three.js | config |
| `src/palette.js` | Colour ramp: charge/phase → glow colour | config |
| `src/glyphs.js` | Stroke definitions for 12 runes (normalized 2D polylines) | — |
| `src/stoneTextures.js` | Procedural basalt albedo / roughness / normal textures, rune height + emissive + stroke-progress masks per block | glyphs, config |
| `src/ring.js` | 12 stone block meshes, materials, rune emissive uniforms | stoneTextures, config |
| `src/runeLights.js` | Point light per rune, flicker, embers particles | state, palette |
| `src/waveSim.js` | GPU ping-pong heightfield wave simulation, impulse API | config |
| `src/mercury.js` | Event-horizon disc mesh + shader, reads waveSim, procedural environment reflections, energy effects, opening plume | waveSim, state, palette |
| `src/postfx.js` | Bloom (capped), vignette, film grain, global exposure from charge | state, config |
| `src/camera.js` | Slow drift, shake during opening | state |
| `src/input.js` | keydown → state actions, fullscreen, help, debug overlay | state |
| `src/main.js` | Renderer setup, render loop, wiring | all |

**Frame data flow:** `input` mutates `state` on keydown → each frame `state.update(dt)` eases charge, advances rune animations and phase timers → `ring`, `runeLights`, `mercury`, `camera`, `postfx` read `state` → render.

`state.js` exposes a small read-only snapshot interface (`lit[]`, `litCount`, `charge`, `phase`, `phaseTime`, `runeProgress[]`, `energies`) plus actions (`toggle(i)`, `reset()`), and an event hook (`onIgnite(i)`, `onUnlight(i)`, `onPhase(p)`) so `waveSim` can inject ripples on ignition.

## 4. Scene

- Background pure `#000`.
- Camera front-on; ring outer diameter ≈ 85% of screen height.
- Camera drift: ±2° yaw/pitch, ~30 s cycle, smooth sine. Shake only during opening.
- Renderer: ACES Filmic tone mapping, sRGB output, pixel ratio capped by config.
- Global exposure scales with charge: near-black at 0 runes, bright at open, never a full-white frame.

## 5. Stone ring

- **Material:** dark weathered basalt — near-black grey, fine grain, pitting, faint mineral speckle, hairline cracks.
- **Blocks:** 12 annular wedges, thickness ≈ 15% of outer radius, separated by thin dark seams. Each block gets a small random tilt, offset and scale for a hand-laid look.
- **Edges:** beveled; dense mesh with noise-based vertex displacement on edges for chipped, irregular silhouettes.
- **Textures** (generated at load, per-block variation): albedo, roughness (rough overall, slightly polished on worn high points), normal (grain + pits + cracks), AO baked into grooves and seams.
- **Rune carving:** glyph strokes evaluated per pixel as a signed-distance field (segment list per block) with a rounded groove profile → drives per-pixel normals, groove darkening (AO) and the emissive mask. The camera is front-on, so per-pixel relief is visually equivalent to geometric displacement and stays crisp at 4K.
- **Ambient:** faint cold rim light only; at 0 runes the ring is barely visible.
- **Rune positions:** rune `i` (1–12) sits at `i` o'clock, clockwise from 1 o'clock; rune 12 at the top.

## 6. Runes & light

### Glyphs

- 8 runes: invented Dethek-inspired glyphs — angular strokes, vertical stems, branching ticks. Not real Dethek letters (avoid spelling accidental words).
- 4 energy runes (positions 3, 6, 9, 12) built from the same stroke vocabulary with the math sign (+, −, ×, ÷) embedded among extra stems and ticks so it is not obvious.
- All runes: same carve depth, same glow colour and animation.

### Animation

- **Ignite (~0.7 s):** glow enters at one stroke end and flows along the strokes (stroke-progress mask) → short bloom flare → a few embers drift up from the groove. Also emits an inward ripple into the mercury from that rune's rim angle.
- **Sustain:** soft breathing glow with noise flicker, each rune phase-offset. Its point light flickers in sync.
- **Unlight (~0.9 s):** glow drains back along strokes in reverse; groove cools to dull ember red, then dark.
- Toggling a rune mid-animation reverses smoothly from its current progress.

### Colour ramp (global, eased ~1.5 s)

| Lit | Colour |
|---|---|
| 1–3 | deep amber |
| 4–6 | gold |
| 7–9 | white-gold |
| 10–11 | pale blue-white |
| opening / open | brilliant blue-white |

All lit runes share the current colour; lighting a rune that crosses a band shifts every lit rune together.

### Lights

Each rune has a point light just in front of its groove; intensity follows glow, colour follows the ramp. Light spills onto neighbouring blocks and grazes surface detail.

## 7. Mercury event horizon

- **Simulation:** GPU wave equation on a ping-pong float heightfield inside a circular boundary (reflective rim). API: `impulse(x, y, radius, strength)`, `setDamping`, `setDriver(...)`.
- **Mesh:** dense disc filling the ring's inner radius; vertices displaced by the heightfield; normals from heightfield gradients.
- **Shading:** liquid metal — metalness 1, very low roughness, Fresnel. Reflects a procedural environment evaluated in the shader: a soft silver studio gradient plus a ring of 12 light blobs driven by the runes' glow (so lit runes appear mirrored and distorted in the waves). Cheaper and more controllable than a cube-camera capture, whose view would mostly show the dark room behind the viewer. Inner emissive glow increases with charge.

### Intensity by charge

| Lit | Behaviour |
|---|---|
| 0 | Near-perfect mirror, slow breathing undulation |
| 1–3 | Calm; occasional droplet impulses |
| 4–6 | Steady concentric waves from centre + more droplets |
| 7–9 | Choppy, crossing wave trains, slight swell |
| 10–11 | Restless, turbulent, surface bulging toward viewer |

Driven by charge-scaled parameters: droplet rate, droplet strength, central oscillator amplitude/frequency, number of crossing wave sources, damping.

### Hidden energies

| Key | Position | Energy | Mercury effect while lit |
|---|---|---|---|
| `3` | 3 o'clock | + | Surface swells convex (gentle dome) |
| `6` | 6 o'clock | − | Centre sinks, slow spiral drain |
| `9` | 9 o'clock | × | Each impulse spawns echo impulses → denser interference |
| `=` | 12 o'clock | ÷ | Waves come from symmetric off-centre sources → nodal "cell" pattern |

Effects stack additively. + and − together roughly cancel the mean level but leave a turbulent seam.

## 8. Phases & opening

States: `dormant` (0 lit) → `charging` (1–11) → `opening` (12th lit) → `open`.
Unlighting any rune during `opening` or `open` → `collapsing` (~2 s) → `charging`.
Re-lighting the missing rune during `collapsing` → `opening` restarts from t = 0.
`reset()` from any state → all runes unlight with normal animation (via `collapsing` if `opening`/`open`) → `dormant`.

### Opening (~5 s)

| t | Event |
|---|---|
| 0.0 s | Runes chase-flare clockwise around the ring twice; colour jumps to blue-white |
| 1.0 s | Camera shake; ember burst from all grooves |
| 1.8 s | Mercury draws inward, centre sinks; global exposure dips (inhale) |
| 2.4 s | Surge: mercury erupts toward camera as a large plume (vertex displacement); bloom peaks, capped below full white |
| 3.2 s | Plume recedes; splash rings rush outward and hit the rim |
| 5.0 s | `open`: stable horizon, glows from within, slow majestic ripples, faint light rays, brightest steady exposure |

### Collapse (~2 s)

Horizon flickers, ripples turn chaotic, glow drains, settles into the charging behaviour for the current lit count.

## 9. Controls

Uses `KeyboardEvent.code` so physical keys work on any layout (including Italian).

| Key (code) | Action |
|---|---|
| `Digit1`…`Digit9`, `Digit0` | toggle runes 1–10 |
| `Minus` | toggle rune 11 |
| `Equal` | toggle rune 12 |
| `Backspace` | reset all |
| `KeyF` | toggle fullscreen |
| `KeyH` | toggle help overlay (`?` sits on different physical keys across layouts) |
| `KeyD` | toggle debug FPS overlay |

Cursor hidden. Key repeat ignored.

## 10. Performance

- Target 60 fps at 4K.
- Config knobs: pixel-ratio cap, wave-sim resolution, mercury mesh density, sim steps per second.
- Debug overlay shows fps and current state.

## 11. Testing

- **Unit (Vitest):** `state.js` — key mapping, toggle, ignore repeats, phase transitions (incl. collapse and reset), charge easing, energy flags, event hooks; `palette.js` — ramp bands and interpolation.
- **Visual:** headless-browser screenshots of the built `portal.html` at 0, 6, 11 lit and open states; check for WebGL errors in console.
- **Final:** DM eyeball test on the TV.

## 12. Out of scope

Sound, mouse/touch controls, mobile, saving state, multiple portals, configurable glyphs at runtime.
