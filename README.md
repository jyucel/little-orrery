# Little Orrery

**A calm celestial sorting puzzle.** Spin the rings, swap orbs at the bridges,
and make every orbit a single color.

▶ **Play:** https://jyucel.github.io/little-orrery/

![Little Orrery icon](assets/icon-192.png)

## How to play

| Action | How |
|---|---|
| **Spin a ring** | Tap it to turn it one slot clockwise, or drag it around either way (mouse wheel works too) |
| **Swap** | Tap a bridge ⇄ to exchange the two orbs it connects |
| **Win** | Every ring holds orbs of one color, any color on any ring |
| **Move limit** | Each slot of spin and each swap is one move, and every level has a move budget. Undo gives moves back |
| **Stars** | Match *par* (the proven minimum) for ★★★. A new ★★★ or a daily puzzle earns a hint |

Mechanisms join the game chapter by chapter:

- **Anchored rings** (padlock) never spin.
- **One-way rings** (arrows) turn clockwise only.
- **Geared rings** (cogs) turn together, in opposite directions.
- **Star charts** (colored rims) must show their exact pattern, slot by slot.

Keyboard: `Z` undo · `R` restart · `H` hint · `Esc` back.

## Features

- 250 levels across 10 chapters, with difficulty that rises steadily (par from 1
  up to 18). Every level is proven solvable, and par is the optimal move count.
- Move limits that tighten chapter by chapter, so random tapping won't solve a level.
- A daily puzzle (a pool of 120 hard boards, one per calendar day) with a streak counter.
- An interactive tutorial (levels 1–3) that points at each next move.
- Undo, restart, and a solver-powered hint button. Hints are tokens, earned
  through ★★★ finishes and daily puzzles.
- Stars, best scores and settings saved in `localStorage`, plus a level select
  with look-ahead unlocking.
- Mouse, touch and keyboard controls. The layout adapts to desktop and to
  phones in portrait or landscape, and wide boards rotate to fit tall screens.
- Synthesized sound effects and a generative ambient soundtrack, with no audio
  files. Sound and music mute separately.
- Color-blind friendly: every color also carries a symbol (can be toggled).
- No ads, no accounts, no tracking, no backend. Plain static files.

## Running locally

No build step is needed. Any static server works:

```bash
npm install          # only needed for the browser tests
npm run serve        # http://localhost:8080/
```

## Tests

```bash
npm test             # unit tests: rules, undo/restart, solver, every level + daily, progress
npm run test:e2e     # Playwright: real input in Chromium (desktop + mobile) and Firefox
WEBKIT=1 npm run test:e2e   # also mobile WebKit (needs system libraries; runs in CI)
```

`npm test` re-solves all 250 levels and 120 daily puzzles with an optimal
solver, replays every stored solution through the game engine, and checks rules,
mechanisms, move limits, undo, restart, win detection, progression, hints,
daily streaks and level geometry.

The browser tests serve the built site under `/little-orrery/` (as GitHub Pages
does). They then play levels from every chapter to victory using real
taps and drags, and check undo/restart, saved progress, locked levels, invalid
move feedback, the hint button, audio toggles and the responsive layout.

## Project layout

```
index.html            app shell
css/style.css         styles
js/engine.js          pure game rules (shared by game, generator and tests)
js/solver.js          bidirectional BFS optimal solver (packed states, typed-array hash)
js/levels.js          generated level data (250 levels, with par, limit + solution)
js/daily.js           generated daily-puzzle pool (120 boards)
js/layout.js          board geometry
js/render.js          canvas renderer, animations and pointer input
js/audio.js           Web Audio sound effects and generative music
js/progress.js        saved progress and settings
js/main.js            screens, HUD, tutorial, flow
tools/generate-levels.mjs   deterministic level generator
tools/build.mjs       copies the playable files to _site/
tools/serve.mjs       tiny static server for local play and tests
tests/                unit tests (node:test) and e2e tests (Playwright)
```

Regenerate the levels with `npm run generate` (about 10 minutes, runs chapters in
parallel worker threads). The generator is seeded, so the output is deterministic. It scrambles solved boards and keeps a board only when
its optimal solution length matches the difficulty curve.

## Deployment

`.github/workflows/deploy.yml` runs the unit and browser tests, builds `_site/`,
and publishes it to GitHub Pages on every push to `main`. All asset paths are
relative, so the game works under any sub-path.

## License

Code: MIT (see `LICENSE`). Font: Fraunces, SIL Open Font License 1.1
(`assets/fonts/OFL.txt`).
