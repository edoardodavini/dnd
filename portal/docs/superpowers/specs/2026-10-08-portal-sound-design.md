# Portal Sound — Design Spec

Date: 2026-10-08
Status: Draft for review
Builds on: `2026-10-07-rune-portal-design.md` and the vision hints (`portal-hint.html`, Shift + 3/6/9/= — see commit 2e32ff2 / b56245a).

## 1. Purpose

Add generated sound to the portal as a third page, `dist/portal-sound.html`, which includes the vision hints. Character: **ancient ritual** — deep stone resonance, low drones, singing-bowl strikes, breath and wind. The sound sits **under the DM's music**: quiet ambience, accents that cut through.

`portal.html` and `portal-hint.html` stay silent and otherwise unchanged.

### Success criteria

1. Every visual event has a matching sound: rune ignite/unlight, the rising charge, the 5 s opening (chase, shake, inhale, surge, splash, open), collapse, vision.
2. The ambience escalates audibly and monotonically with the lit count.
3. The four energy runes have subtle, distinct sound tells while lit.
4. Never clips, never clicks, never stacks into chaos when keys are mashed.
5. Quiet by default; DM can mute and step volume from the keyboard.
6. Still one self-contained offline HTML file; no audio assets.

## 2. Technology

- Raw **Web Audio API** (no library). All sounds synthesised from oscillators, filtered noise and envelopes.
- Built with `VITE_PORTAL_HINTS=1 VITE_PORTAL_SOUND=1`; output renamed to `dist/portal-sound.html`.
- Audio starts on the first keydown (browser autoplay policy). If the `AudioContext` cannot be created or resumed, the page continues silently.

## 3. Architecture

| File | Responsibility | Depends on |
|---|---|---|
| `src/soundMap.js` | Pure. `soundParams(snapshot) → BedParams`: maps charge, phase curves, energies, vision level to continuous layer parameters. `masterGain(volumeDb, muted)`. `stepVolume(db, dir)`. `bowlFrequency(i)`. No Web Audio. | config, timeline (`smoothstep`) |
| `src/audio/engine.js` | `AudioContext` lifecycle, unlock on first keydown, master gain → limiter (`DynamicsCompressorNode`) → destination; shared stone-chamber reverb (`ConvolverNode` with a generated impulse response); per-rune stereo panners; voice counting/cap. Accepts an injected `BaseAudioContext` (real or `OfflineAudioContext`) so the same graph renders in tests. | soundMap, config |
| `src/audio/bed.js` | Continuous layers: air, drone, liquid, energy tells, open choir. `update(params, dt)` ramps `AudioParam`s smoothly (`setTargetAtTime`, never instant jumps). | engine |
| `src/audio/voices.js` | One-shot recipes, each a function `(engine, opts) → void` that builds, schedules and disconnects its own nodes: `stoneGrind`, `bowl`, `cool`, `rumble`, `inhale`, `boom`, `splash`, `whisper`. | engine |
| `src/audio/index.js` | `createPortalAudio({ state })` wiring: subscribes to `onIgnite`, `onUnlight`, `onPhase`; exposes `update(snapshot, curves, visionLevel, dt)`, `vision(i)`, `toggleMute()`, `volume(dir)`. Fires opening cues when `phaseTime` crosses 0.0/1.0/1.8/2.4/3.2/5.0 s. | all above, state |

`main.js` creates the audio only when `import.meta.env.VITE_PORTAL_SOUND === '1'`.

### BedParams (output of `soundParams`)

| Field | Meaning | Mapping (c = charge 0..1, curves from timeline, e = energies, v = vision level) |
|---|---|---|
| `air` | wind gain | `0.06 · (1 − smoothstep(0, 0.4, c)) · (1 − open)` |
| `drone` | drone gain | `0.3 · smoothstep(0, 0.12, c) · (0.2 + 0.8c) · (1 − 0.9·inhale) · (1 − 0.6·open)` |
| `droneCutoff` | lowpass Hz | `120 + 900c² + 1500·open` |
| `droneDetune` | cents between the two drone voices | `3 + 9c` |
| `dronePitch` | multiplier on 55 Hz | `1 − 0.12·collapse` (sags while collapsing) |
| `liquid` | liquid gain | `0.12 · c · (1 − 0.9v) · (1 − 0.5·open)` |
| `liquidRate` | bloops per second | `c > 0 ? 0.5 + 8c² : 0` |
| `choir` | open-portal pad gain | `0.3 · open` |
| `flutter` | 6 Hz tremolo depth on the drone | `collapse` |
| `add` | rising-overtone gain (+) | `0.06 · e.add` |
| `sub` | sinking undertone gain (−) | `0.08 · e.sub` |
| `echo` | bowl feedback-delay amount (×) | `0.45 · e.mul` |
| `beat` | drone throb depth at 2 Hz (÷) | `0.6 · e.div` |

All gains are linear, pre-master. The master defaults to **−12 dB** (0.25), steps of **3 dB**, clamped to **−36 … 0 dB**; mute → 0.

## 4. Sound recipes

- **Air:** pink-ish noise → bandpass ~400 Hz, slow random gain drift.
- **Drone:** two triangle oscillators at 55 Hz and 55·1.5 Hz plus a detuned twin of each (`droneDetune`) → lowpass (`droneCutoff`). Slow LFO on gain, depth growing with c (restless).
- **Liquid:** scheduler fires short "bloops" at `liquidRate` (Poisson): a sine with a fast upward pitch blip 300–900 Hz through a bandpass, 60–120 ms, random pan.
- **Choir (open):** stacked fifths on A2/E3/A3/E4 (sawtooth → lowpass 1.2 kHz) with slow detuned chorus.
- **Stone grind (ignite, 0.4 s):** brown noise → lowpass 300 Hz, rough amplitude modulation 25–40 Hz.
- **Bowl (ignite, after grind, 4–5 s):** inharmonic partials at ratios 1, 2.76, 5.40, 8.93 of `bowlFrequency(i)`, exponential decays (longer for lower partials), brightness (gain of upper partials) rising with c. Panned by rune x position. With `echo > 0`, routed through a feedback delay (0.28 s).
- **`bowlFrequency(i)`:** A minor pentatonic from A3 (220 Hz): A3 C4 D4 E4 G4 A4 C5 D5 E5 G5 A5 C6 for runes 1–12.
- **Cool (unlight, 1 s):** the rune's bowl note gliding down a fifth with fast decay + highpassed noise hiss decaying.
- **Opening:** 0.0 s — 24 bowl strikes clockwise over 1 s (two turns) at reduced level; 1.0 s — `rumble` (sub noise < 80 Hz rising over 2 s); 1.8 s — `inhale` (noise through a highpass sweeping 200 → 4000 Hz, swelling, 0.6 s); 2.4 s — `boom` (sine 45 Hz pitch-drop from 90 Hz, 1.5 s decay) + falling whoosh (noise bandpass 3000 → 150 Hz); 3.2 s — `splash` (noise burst + 6–10 scattered bloops); choir rises via `open`.
- **Collapse:** carried by the bed (`dronePitch` sag + `flutter`: 6 Hz tremolo on the drone).
- **Vision (`whisper`, ~5 s):** noise through two bandpass "formants" sweeping between vowel-ish centres (700/1200 → 300/2300 Hz), slow swell matching the vision envelope, plus a faint high shimmer (sines at 2–3 kHz with slow vibrato).
- **Energy tells:** `add` — a sine overtone at 4× drone gliding upward an octave over 8 s, looping with a crossfade; `sub` — a sine at 27.5 Hz (sub-octave) with slow ±10-cent wobble; `echo` — as above; `beat` — tremolo at 2 Hz on the drone gain with depth `beat`.

All one-shots go dry + into the shared reverb (stone chamber: 2.8 s decay, darkened). Every envelope starts and ends with a ramp of at least 10 ms.

## 5. Controls (portal-sound.html only)

| Key (code) | Action |
|---|---|
| `KeyM` | toggle mute |
| `BracketLeft` | volume −3 dB |
| `BracketRight` | volume +3 dB |

A small overlay shows `vol −12 dB` / `muted` for 1.2 s after any change. Help overlay lists these keys. All other keys unchanged (Meta/Ctrl/Alt still ignored).

## 6. Safety

- Master limiter: threshold −6 dB, ratio 20, fast attack.
- Voice cap: at most 24 concurrent one-shots; new ones beyond the cap are dropped (bed layers are not counted).
- No `AudioParam` jumps: changes use `setTargetAtTime` / ramps.
- Long frames (dt clamp 0.1 s already in main) never schedule a burst of liquid bloops: at most 3 per frame.

## 7. Testing

- **Unit (Vitest):** `soundParams` — monotonic drone gain/cutoff in c; silence except air at c = 0; energy tells only when lit; liquid drops ≥ 85% at v = 1; inhale ducks drone; collapse sags pitch. `masterGain` — mute = 0, −12 dB default ≈ 0.251. `stepVolume` clamps. `bowlFrequency` — 12 notes, ascending, A3 first.
- **Audio render (headless Chrome, `OfflineAudioContext`):** each one-shot and the bed at c = 0, 0.5, 0.92, open rendered offline; each must have no NaN, peak < −1 dBFS, RMS above a floor where audible, final 50 ms RMS < 1% of peak (no truncated tails). The full 5 s opening rendered through the limiter stays < −1 dBFS. Run by the check script (`npm run shoot`).
- **By ear:** the DM on the TV. Tunables live in `CONFIG.audio`.

## 8. Out of scope

Recorded samples, music, per-sound volume UI, spatial 3D audio, audio in `portal.html` / `portal-hint.html`.
