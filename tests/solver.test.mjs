// Solver correctness on hand-made and randomly scrambled boards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, buildMoves, applyPerm, decodeStart, encodeCells, isSolved } from '../js/engine.js';
import { solve } from '../js/solver.js';

const tri = (start, extra = {}) => ({
  id: 't',
  rings: [
    { n: 4, x: 0, y: 0, r: 1, a0: 0, ...(extra.r0 || {}) },
    { n: 4, x: 3, y: 0, r: 1, a0: 0, ...(extra.r1 || {}) },
    { n: 3, x: 1.5, y: 2.5, r: 1, a0: 0, ...(extra.r2 || {}) },
  ],
  bridges: [
    { a: 0, sa: 0, b: 1, sb: 2 },
    { a: 1, sa: 1, b: 2, sb: 0 },
    { a: 0, sa: 1, b: 2, sb: 2 },
  ],
  gears: extra.gears,
  start,
});

test('already solved board needs zero moves', () => {
  const lv = tri('0000|1111|222');
  assert.deepEqual(solve(lv, decodeStart(lv)), { length: 0, path: [], nodes: 1 });
});

test('one swap away', () => {
  const lv = tri('1000|1101|222');
  const res = solve(lv, decodeStart(lv));
  assert.equal(res.length, 1);
  assert.deepEqual(res.path, ['b0']);
});

function mulberry(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

for (const [name, extra] of [
  ['free', {}],
  ['anchored', { r2: { locked: true } }],
  ['one-way', { r0: { oneway: true } }],
  ['geared', { gears: [[0, 1]] }],
]) {
  test(`random scrambles (${name}): solution is legal, solves, and is no longer than the scramble`, () => {
    const rnd = mulberry(name.length * 97);
    const lv = tri('0000|1111|222', extra);
    const moves = buildMoves(lv);
    for (let trial = 0; trial < 25; trial++) {
      let cells = decodeStart(lv);
      const k = 1 + Math.floor(rnd() * 9);
      for (let i = 0; i < k; i++) cells = applyPerm(cells, moves[Math.floor(rnd() * moves.length)].perm);
      const res = solve(lv, cells);
      assert.ok(res, 'solvable');
      assert.ok(res.length <= k);
      const g = new Game({ ...lv, start: encodeCells(lv, cells) });
      if (res.length) assert.ok(g.play(res.path));
      assert.ok(isSolved(lv, g.cells));
    }
  });
}

test('solver returns optimal length (cross-checked with plain BFS)', () => {
  const lv = tri('0000|1111|222', { r0: { oneway: true } });
  const moves = buildMoves(lv);
  // plain BFS distances from all goals over inverse moves = distances to goal
  const inv = (p) => {
    const q = new Array(p.length);
    p.forEach((v, i) => (q[v] = i));
    return q;
  };
  const invs = moves.map((m) => inv(m.perm));
  // multi-source BFS from both solved arrangements (colors 0/1 may trade rings)
  const goals = [decodeStart(lv), decodeStart({ ...lv, start: '1111|0000|222' })];
  const dist = new Map(goals.map((g) => [g.join(''), 0]));
  let frontier = goals;
  while (frontier.length && dist.size < 20000) {
    const next = [];
    for (const c of frontier) {
      for (const p of invs) {
        const n = applyPerm(c, p);
        const k = n.join('');
        if (!dist.has(k)) {
          dist.set(k, dist.get(c.join('')) + 1);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  let checked = 0;
  for (const [k, d] of dist) {
    if (checked++ > 400) break;
    const res = solve(lv, k.split('').map(Number));
    assert.equal(res.length, d, `state ${k}`);
  }
});

test('budget exhaustion returns null instead of hanging', () => {
  const lv = tri('0120|1201|201');
  assert.equal(solve(lv, decodeStart(lv), { maxNodes: 5 }), null);
});
