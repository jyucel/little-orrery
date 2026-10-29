# Little Orrery: Game Design

## Three concepts

### A. Little Orrery (selected)
Colored orbs ride on circular orbits (rings), like planets in a brass orrery.
**Spin** a ring to move all of its orbs one slot, or tap a **bridge** where two
rings meet to swap the two orbs on its ends. Goal: every ring holds a single
color. Later chapters add mechanisms: **anchored** rings that cannot spin,
**one-way** rings that only turn clockwise, and **geared** pairs that turn
together in opposite directions.

### B. Tidepool Shift
Stones drift through channels with currents. You open and close sluices so the
currents push the stones into pools of their own color, like a Sokoban with water.

### C. Lantern Line
Lanterns travel on one conveyor loop past several docks. You tap a dock to pull
in the lantern passing by, or to push its top lantern back onto the loop. Each
dock has to end up with lanterns stacked in color order.

## Evaluation (1 = weak, 5 = strong)

| Criterion            | A. Little Orrery | B. Tidepool Shift | C. Lantern Line |
|----------------------|:---:|:---:|:---:|
| Originality          | 4 | 4 | 3 |
| Fun & replayability  | 4 | 4 | 3 |
| Ease of learning     | 5 | 3 | 4 |
| Puzzle depth         | 4 | 5 | 3 |
| Mobile suitability   | 5 | 3 | 4 |
| Technical feasibility (provable solvability) | 5 | 3 | 4 |
| **Total**            | **27** | 22 | 21 |

**Why A wins.** It needs only two gestures (spin and swap), and both work as a
single tap, so it is learned in seconds and plays well on a phone. Depth comes
from the topology: rings that share bridges interact, and each new mechanism
changes how you plan. Every move is a permutation of the board, which makes an
exact solver practical. That solver proves each level is solvable and gives the
optimal move count ("par") that the star rating is measured against. B has more
depth but is harder to read on a small screen. C is too close to existing
conveyor-sorting games.

## Core rules
- A **ring** has 3–7 slots, each holding one orb.
- **Spin**: tap a ring (clockwise) or drag it around either way. Each slot of
  travel is one move.
- **Swap**: tap a bridge to exchange the two orbs it connects. One move.
- **Win**: every ring is monochrome. Any color may end up on any ring, as long
  as each ring is a single color.
- **Stars**: ★★★ at or under par (the optimal solution), ★★ within par + 50%
  (at least +2), ★ for any solution.

## Mechanisms (introduced one chapter at a time)
| Mechanism | Rule | Visual cue |
|---|---|---|
| Anchor | Ring cannot spin; its orbs only change through bridges | Padlock hub, dashed track |
| One-way | Ring spins clockwise only | Arrow hub, chevrons on track |
| Gears | Spinning one ring of a geared pair spins the other the opposite way | Cog hubs joined by a chain |

## Progression (200 levels, 8 chapters × 25)
1. **First Light**: two to three rings, guided tutorial in levels 1–3.
2. **Twin Orbits**: double bridges and larger rings.
3. **Constellations**: four rings, loops of bridges.
4. **Anchors**: anchored rings.
5. **Clockwork**: one-way rings.
6. **Gearworks**: geared pairs.
7. **Nebula**: five rings, twin colors (two rings share a color).
8. **Grand Orrery**: two or three mechanisms combined.

Within each chapter, par climbs steadily (from 1 to 13 across the game). The
next level always unlocks, plus three levels of look-ahead, so players never
get stuck on a single puzzle.

## Feel & identity
- Night-sky orrery: deep indigo backdrop, brass orbits, glossy gem-like orbs,
  and a serif display face (Fraunces).
- Each color also carries a glyph (circle, triangle, square, diamond, star, cross)
  for color-blind accessibility.
- Orbs glide along arcs, swaps hop across bridges, a finished ring glows in its
  color, and a win sets off a burst of sparks.
- Synthesized sound (no audio files): soft marimba ticks, glassy swaps, bell
  chimes, and a calm generative ambient soundtrack. Sound and music can each
  be muted.

## Verification
- `tools/generate-levels.mjs` scrambles solved boards and keeps a board only
  after the bidirectional-BFS solver finds its optimal solution.
- `npm test` re-solves every level, replays every stored solution through the
  game engine, and checks rules, undo, restart and progression.
- `npm run test:e2e` drives the real game in Chromium (desktop and mobile
  viewports) with Playwright.
