// Every shipped level: well formed, solvable, par is optimal, difficulty ramps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, CHAPTERS } from '../js/levels.js';
import { Game, decodeStart, isSolved, isRingSolved, validateLevel } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { ORB_R } from '../js/layout.js';

test('at least 200 levels with sequential ids', () => {
  assert.ok(LEVELS.length >= 200, `only ${LEVELS.length} levels`);
  LEVELS.forEach((l, i) => assert.equal(l.id, i + 1));
});

test('chapters hold 25 levels each, in order', () => {
  assert.equal(CHAPTERS.length * 25, LEVELS.length);
  LEVELS.forEach((l, i) => assert.equal(l.chapter, Math.floor(i / 25)));
});

test('every level is structurally valid', () => {
  for (const l of LEVELS) assert.deepEqual(validateLevel(l), [], `level ${l.id}`);
});

test('no level starts solved or with a finished ring', () => {
  for (const l of LEVELS) {
    const cells = decodeStart(l);
    assert.equal(isSolved(l, cells), false, `level ${l.id} starts solved`);
    l.rings.forEach((_, r) => assert.equal(isRingSolved(l, cells, r), false, `level ${l.id} ring ${r}`));
  }
});

test('stored solution solves every level through the game rules in exactly par moves', () => {
  for (const l of LEVELS) {
    const g = new Game(l);
    assert.equal(l.solution.length, l.par, `level ${l.id}`);
    l.solution.forEach((id, i) => {
      assert.equal(g.solved, false, `level ${l.id} solved early at step ${i}`);
      assert.ok(g.play(id), `level ${l.id}: illegal move ${id} at step ${i}`);
    });
    assert.ok(g.solved, `level ${l.id}: solution does not solve`);
    assert.equal(g.moveCount, l.par);
  }
});

test('independent solver proves every level solvable and par optimal', { timeout: 900_000 }, () => {
  for (const l of LEVELS) {
    const res = solve(l, decodeStart(l), { maxNodes: 4_000_000 });
    assert.ok(res, `level ${l.id}: solver found no solution`);
    assert.equal(res.length, l.par, `level ${l.id}: optimal ${res.length} != par ${l.par}`);
    const g = new Game(l);
    assert.ok(g.play(res.path), `level ${l.id}: solver path illegal`);
    assert.ok(g.solved, `level ${l.id}: solver path does not solve`);
  }
});

test('mechanisms appear only from their chapter on', () => {
  const first = (pred) => LEVELS.find(pred)?.chapter;
  assert.equal(first((l) => l.rings.some((r) => r.locked)), 3);
  assert.equal(first((l) => l.rings.some((r) => r.oneway)), 4);
  assert.equal(first((l) => (l.gears || []).length), 5);
});

test('difficulty increases: chapter average par rises and the curve trends upward', () => {
  const avg = CHAPTERS.map((_, c) => {
    const ls = LEVELS.filter((l) => l.chapter === c);
    return ls.reduce((a, l) => a + l.par, 0) / ls.length;
  });
  for (let c = 1; c < avg.length; c++) assert.ok(avg[c] >= avg[c - 1] - 0.5, `chapter ${c + 1} easier than ${c}`);
  assert.ok(avg.at(-1) > avg[0] + 5);
  for (let c = 0; c < CHAPTERS.length; c++) {
    const ls = LEVELS.filter((l) => l.chapter === c);
    assert.ok(ls.at(-1).par > ls[0].par, `chapter ${c + 1} does not ramp`);
  }
  const rings = (c) => LEVELS.filter((l) => l.chapter === c).reduce((a, l) => a + l.rings.length, 0) / 25;
  assert.ok(rings(7) > rings(0), 'late levels use more rings');
});

test('tutorial levels are gentle', () => {
  assert.equal(LEVELS[0].par, 1);
  assert.equal(LEVELS[0].rings.length, 2);
  assert.equal(LEVELS[1].par, 2);
  assert.ok(LEVELS[2].par <= 3);
});

test('geometry: rings do not overlap and bridges have room', () => {
  for (const l of LEVELS) {
    for (let i = 0; i < l.rings.length; i++) {
      for (let j = i + 1; j < l.rings.length; j++) {
        const a = l.rings[i];
        const b = l.rings[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(d > a.r + b.r + 2 * ORB_R, `level ${l.id}: rings ${i},${j} overlap`);
      }
    }
    for (const br of l.bridges) {
      const p = (r, k) => {
        const ring = l.rings[r];
        const ang = ring.a0 + (k * 2 * Math.PI) / ring.n;
        return [ring.x + Math.cos(ang) * ring.r, ring.y + Math.sin(ang) * ring.r];
      };
      const [x1, y1] = p(br.a, br.sa);
      const [x2, y2] = p(br.b, br.sb);
      const len = Math.hypot(x1 - x2, y1 - y2);
      assert.ok(len > 2 * ORB_R + 0.5, `level ${l.id}: bridge too short (${len.toFixed(2)})`);
      assert.ok(len < 4.5, `level ${l.id}: bridge too long (${len.toFixed(2)})`);
    }
  }
});

test('levels are distinct', () => {
  const seen = new Set();
  for (const l of LEVELS) {
    const key = JSON.stringify([l.rings.map((r) => [r.n, r.locked, r.oneway]), l.bridges, l.gears, l.start]);
    assert.ok(!seen.has(key), `level ${l.id} duplicates an earlier level`);
    seen.add(key);
  }
});
