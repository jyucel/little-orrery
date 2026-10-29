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
- **Move limit**: every level has a budget of par + 3–6 moves (the margin
  tightens chapter by chapter). Undo gives moves back. Without the limit,
  wandering around eventually solves anything; with it, every move counts.
- **Stars**: ★★★ at or under par (the optimal solution), ★★ within half of the
  margin, ★ within the limit.

## Mechanisms (introduced one chapter at a time)
| Mechanism | Rule | Visual cue |
|---|---|---|
| Anchor | Ring cannot spin; its orbs only change through bridges | Padlock hub, dashed track |
| One-way | Ring spins clockwise only | Arrow hub, chevrons on track |
| Gears | Spinning one ring of a geared pair spins the other the opposite way | Cog hubs joined by a chain |
| Star chart | Each slot must hold one specific color (an exact pattern, not just one color) | Colored rim around every slot, star hub |

## Progression (250 levels, 10 chapters × 25)
1. **First Light**: tutorial in levels 1–3, then three- and four-ring boards by the end of the chapter.
2. **Twin Orbits**: double bridges and large rings.
3. **Constellations**: four rings, loops of bridges.
4. **Anchors**: anchored rings.
5. **Clockwork**: one-way rings.
6. **Gearworks**: geared pairs.
7. **Star Charts**: pattern rings (pattern recognition on top of sorting).
8. **Nebula**: five rings, twin colors.
9. **Celestial Clockwork**: star charts combined with a mechanism.
10. **Grand Orrery**: two or three mechanisms combined.

Par climbs from 1 to 18. Each new mechanism eases in a little before ramping
up. The next level always unlocks, plus three levels of look-ahead.

## Retention
- **Daily Orrery**: one hard board per calendar day from a pool of 120, with a
  streak counter on the title screen.
- **Hint tokens**: three to start, then one more for each first ★★★ and each
  daily solve (up to nine). Hints feel valuable, and three-starring old levels
  is worth the effort.

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
- `npm test` re-solves every level and daily puzzle, replays every stored
  solution through the game engine, and checks rules, limits, undo, restart and
  progression.
- `npm run test:e2e` drives the real game in Chromium (desktop and mobile
  viewports) with Playwright.
