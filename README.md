# Ball Blaster

A portrait, one-thumb billiards roguelite PWA. Pull back, release, and smash targets on a pixel-art table, spending a finite energy budget per run and buying upgrades between runs.

All art (sprites, bitmap font, icons) and all sound (WebAudio synthesis) are original and generated in code.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # sim determinism, rules and balance tests
npm run build    # production PWA in dist/
```

## Layout

- `src/core` shared types, tuning numbers, seeded RNG
- `src/sim` deterministic fixed-step simulation (physics, turns, energy curve, targets, boss, combos)
- `src/meta` upgrade trees, stats builder, save/export/import
- `src/render`, `src/ui`, `src/audio` canvas renderer, screens, procedural sfx
- `DECISIONS.md` rule gaps from the design doc and how they were resolved
