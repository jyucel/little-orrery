// Rules of the game: moves, mechanisms, win condition, undo and restart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Game,
  buildMoves,
  applyPerm,
  decodeStart,
  encodeCells,
  isSolved,
  goalStates,
  validateLevel,
  starsFor,
} from '../js/engine.js';

// Two rings of four joined by one bridge (ring0 slot0 <-> ring1 slot2).
function duo(extra = {}) {
  return {
    id: 'duo',
    rings: [
      { n: 4, x: 0, y: 0, r: 1, a0: 0, ...(extra.r0 || {}) },
      { n: 4, x: 3, y: 0, r: 1, a0: 0, ...(extra.r1 || {}) },
    ],
    bridges: [{ a: 0, sa: 0, b: 1, sb: 2 }],
    gears: extra.gears,
    start: extra.start || '0123|4567',
    par: 1,
  };
}

test('clockwise rotation moves each orb to the next slot', () => {
  const g = new Game(duo());
  assert.ok(g.play('r0+'));
  assert.equal(encodeCells(g.level, g.cells), '3012|4567');
});

test('counter-clockwise rotation is the inverse of clockwise', () => {
  const g = new Game(duo());
  g.play('r1-');
  assert.equal(encodeCells(g.level, g.cells), '0123|5674');
  g.play('r1+');
  assert.equal(encodeCells(g.level, g.cells), '0123|4567');
});

test('n single-step rotations return a ring to its start', () => {
  const g = new Game(duo());
  for (let i = 0; i < 4; i++) g.play('r0+');
  assert.deepEqual(g.cells, g.initial);
  assert.equal(g.moveCount, 4);
});

test('bridge swap exchanges exactly the two connected orbs', () => {
  const g = new Game(duo());
  g.play('b0');
  assert.equal(encodeCells(g.level, g.cells), '6123|4507');
  g.play('b0');
  assert.deepEqual(g.cells, g.initial);
});

test('moves never change color counts', () => {
  const lv = duo();
  let cells = decodeStart(lv);
  const moves = buildMoves(lv);
  const sorted = (c) => c.slice().sort().join('');
  const before = sorted(cells);
  for (let i = 0; i < 200; i++) cells = applyPerm(cells, moves[i % moves.length].perm);
  assert.equal(sorted(cells), before);
});

test('anchored rings cannot rotate', () => {
  const g = new Game(duo({ r0: { locked: true } }));
  assert.equal(g.canPlay('r0+'), false);
  assert.equal(g.canPlay('r0-'), false);
  assert.equal(g.play('r0+'), false);
  assert.deepEqual(g.cells, g.initial);
  assert.equal(g.moveCount, 0);
  assert.ok(g.play('b0'), 'bridges still work on anchored rings');
});

test('one-way rings only turn clockwise', () => {
  const g = new Game(duo({ r1: { oneway: true } }));
  assert.ok(g.canPlay('r1+'));
  assert.equal(g.play('r1-'), false);
  assert.deepEqual(g.cells, g.initial);
});

test('geared rings turn together in opposite directions', () => {
  const g = new Game(duo({ gears: [[0, 1]] }));
  g.play('r0+');
  assert.equal(encodeCells(g.level, g.cells), '3012|5674');
  g.play('r1+');
  assert.deepEqual(g.cells, g.initial);
});

test('illegal actions are rejected atomically', () => {
  const g = new Game(duo({ r0: { locked: true } }));
  assert.equal(g.play(['b0', 'r0+']), false);
  assert.deepEqual(g.cells, g.initial);
  assert.equal(g.history.length, 0);
  assert.equal(g.play('nonsense'), false);
  assert.equal(g.play([]), false);
});

test('win condition: every ring monochrome', () => {
  const lv = duo({ start: '0000|1111' });
  assert.ok(isSolved(lv, decodeStart(lv)));
  const lv2 = duo({ start: '0001|1110' });
  assert.equal(isSolved(lv2, decodeStart(lv2)), false);
  const g = new Game(lv2);
  assert.equal(g.solved, false);
  assert.equal(g.ringSolved(0), false);
  // bring ring0's odd orb onto the bridge, line ring1's odd orb up, then swap
  g.play('r0+');
  assert.equal(encodeCells(lv2, g.cells), '1000|1110');
  g.play('r1-');
  assert.equal(encodeCells(lv2, g.cells), '1000|1101');
  assert.equal(g.solved, false);
  g.play('b0');
  assert.equal(encodeCells(lv2, g.cells), '0000|1111');
  assert.ok(g.solved);
  assert.equal(g.moveCount, 3);
});

test('any color may finish on any ring', () => {
  const lv = duo({ start: '1111|0000' });
  assert.ok(isSolved(lv, decodeStart(lv)));
});

test('no moves are accepted once the level is solved', () => {
  const g = new Game(duo({ start: '1000|1101' }));
  assert.ok(g.play('b0'));
  assert.ok(g.solved);
  assert.equal(g.play('r0+'), false);
  assert.equal(g.moveCount, 1);
});

test('undo restores the exact previous state and move count', () => {
  const g = new Game(duo());
  g.play('r0+');
  const mid = g.cells.slice();
  g.play(['r1-', 'r1-', 'r1-']);
  assert.equal(g.moveCount, 4);
  const undone = g.undo();
  assert.deepEqual(undone.ids, ['r1-', 'r1-', 'r1-']);
  assert.deepEqual(g.cells, mid);
  assert.equal(g.moveCount, 1);
  g.undo();
  assert.deepEqual(g.cells, g.initial);
  assert.equal(g.moveCount, 0);
  assert.equal(g.undo(), null, 'undo on empty history is a no-op');
});

test('restart restores the initial state and clears history', () => {
  const g = new Game(duo());
  g.play('r0+');
  g.play('b0');
  g.play('r1-');
  g.restart();
  assert.deepEqual(g.cells, g.initial);
  assert.equal(g.moveCount, 0);
  assert.equal(g.history.length, 0);
  assert.equal(encodeCells(g.level, g.cells), '0123|4567');
});

test('initial state is never mutated by play', () => {
  const g = new Game(duo());
  const copy = g.initial.slice();
  g.play('r0+');
  g.play('b0');
  assert.deepEqual(g.initial, copy);
});

test('goal states account for twin colors', () => {
  const lv = {
    rings: [{ n: 2 }, { n: 2 }, { n: 3 }],
    bridges: [],
    start: '01|01|222',
  };
  const goals = goalStates(lv, decodeStart(lv)).map((c) => c.join(''));
  assert.deepEqual(goals.sort(), ['0011222', '1100222']);
});

test('validateLevel catches malformed levels', () => {
  assert.deepEqual(validateLevel(duo()).length > 0, true, 'distinct colors cannot be monochrome');
  assert.deepEqual(validateLevel(duo({ start: '0101|1010' })), []);
  const bad = duo({ start: '0101|1010' });
  bad.bridges.push({ a: 0, sa: 0, b: 1, sb: 1 });
  assert.match(validateLevel(bad).join(), /used twice/);
  const bad2 = duo({ start: '0101|1010' });
  bad2.bridges[0].sb = 9;
  assert.match(validateLevel(bad2).join(), /bad slot/);
  const bad3 = duo({ start: '010|1010' });
  assert.match(validateLevel(bad3).join(), /size mismatch/);
  const bad4 = duo({ start: '0101|1010', r0: { locked: true }, gears: [[0, 1]] });
  assert.match(validateLevel(bad4).join(), /must be free/);
});

test('star thresholds', () => {
  assert.equal(starsFor(5, 5), 3);
  assert.equal(starsFor(4, 5), 3);
  assert.equal(starsFor(7, 5), 2);
  assert.equal(starsFor(8, 5), 2);
  assert.equal(starsFor(9, 5), 1);
  assert.equal(starsFor(3, 1), 2);
  assert.equal(starsFor(4, 1), 1);
  assert.equal(starsFor(15, 10), 2);
  assert.equal(starsFor(16, 10), 1);
});
