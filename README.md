# D&D

## [The Portal](portal/)

A Stargate-style ring of 12 carved runes around a liquid-mercury event horizon, built for the final session of a D&D 5e campaign. Fullscreen on a TV, driven from the keyboard.

**Play it:** https://edoardodavini.github.io/dnd/portal/

- `portal.html` — the portal
- `portal-hint.html` — plus visions of the four energy runes in the mercury
- `portal-sound.html` — plus generated ritual sound

Keys: `1`…`0`, `-`, `=` light runes 1–12 · `Backspace` reset · `F` fullscreen · `H` help · hint pages: `Shift` + `3`/`6`/`9`/`=` vision · sound page: `M` mute, `[` `]` volume.

Develop: `cd portal && npm install && npm run dev` · tests `npm test` · build `npm run build` (writes the three single-file pages to `portal/dist/`) · visual + audio checks `npm run shoot` (needs Google Chrome).
