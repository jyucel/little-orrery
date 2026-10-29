// Every shipped level: well formed, solvable, par is optimal, difficulty ramps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, CHAPTERS } from '../js/levels.js';
import { DAILY } from '../js/daily.js';
import { Game, decodeStart, isSolved, isRingSolved, validateLevel } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { ORB_R } from '../js/layout.js';

test('250 levels with sequential ids', () => {
  assert.ok(LEVELS.length >= 250, `only ${LEVELS.length} levels`);
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

const ALL = [...LEVELS, ...DAILY];

test('stored solution solves every level (and daily puzzle) through the game rules in exactly par moves', () => {
  for (const l of ALL) {
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

test('independent solver proves every level solvable and par optimal', { timeout: 1_800_000 }, () => {
  for (const l of ALL) {
    const res = solve(l, decodeStart(l), { maxNodes: 8_000_000 });
    assert.ok(res, `level ${l.id}: solver found no solution`);
    assert.equal(res.length, l.par, `level ${l.id}: optimal ${res.length} != par ${l.par}`);
    const g = new Game(l);
    assert.ok(g.play(res.path), `level ${l.id}: solver path illegal`);
    assert.ok(g.solved, `level ${l.id}: solver path does not solve`);
  }
});

test('move limits leave a margin above par that tightens later', () => {
  for (const l of ALL) {
    assert.ok(Number.isInteger(l.limit), `level ${l.id} has no limit`);
    assert.ok(l.limit >= l.par + 3, `level ${l.id}: limit too tight`);
    assert.ok(l.limit <= l.par + 6, `level ${l.id}: limit too loose`);
  }
  const margin = (c) => LEVELS.filter((l) => l.chapter === c).reduce((a, l) => a + l.limit - l.par, 0) / 25;
  assert.ok(margin(CHAPTERS.length - 1) < margin(0));
});

test('daily pool: valid, distinct, mid-to-hard', () => {
  assert.ok(DAILY.length >= 100);
  for (const d of DAILY) {
    assert.deepEqual(validateLevel(d), [], `daily ${d.id}`);
    assert.ok(d.par >= 9, `daily ${d.id} too easy (${d.par})`);
    const cells = decodeStart(d);
    d.rings.forEach((_, r) => assert.equal(isRingSolved(d, cells, r), false, `daily ${d.id} ring ${r}`));
  }
  assert.equal(new Set(DAILY.map((d) => d.start + JSON.stringify(d.bridges))).size, DAILY.length);
});

test('mechanisms appear only from their chapter on', () => {
  const first = (pred) => LEVELS.find(pred)?.chapter;
  assert.equal(first((l) => l.rings.some((r) => r.locked)), 3);
  assert.equal(first((l) => l.rings.some((r) => r.oneway)), 4);
  assert.equal(first((l) => (l.gears || []).length), 5);
  assert.equal(first((l) => l.rings.some((r) => r.pattern)), 6);
  const chart = LEVELS.filter((l) => l.chapter === 6);
  assert.ok(chart.every((l) => l.rings.some((r) => r.pattern)), 'every Star Charts level has a chart');
});

test('difficulty increases: the curve climbs within chapters and across the game', () => {
  const avg = CHAPTERS.map((_, c) => {
    const ls = LEVELS.filter((l) => l.chapter === c);
    return ls.reduce((a, l) => a + l.par, 0) / ls.length;
  });
  // a new mechanism may ease in, but never drops far below the previous chapter
  for (let c = 1; c < avg.length; c++) assert.ok(avg[c] >= avg[c - 1] - 2, `chapter ${c + 1} much easier than ${c}`);
  const firstThird = (avg[0] + avg[1] + avg[2]) / 3;
  const lastThird = (avg.at(-1) + avg.at(-2) + avg.at(-3)) / 3;
  assert.ok(lastThird > firstThird + 5, `late game not harder (${firstThird.toFixed(1)} -> ${lastThird.toFixed(1)})`);
  for (let c = 0; c < CHAPTERS.length; c++) {
    const ls = LEVELS.filter((l) => l.chapter === c);
    const early = ls.slice(0, 5).reduce((a, l) => a + l.par, 0) / 5;
    const late = ls.slice(-5).reduce((a, l) => a + l.par, 0) / 5;
    assert.ok(late > early + 2, `chapter ${c + 1} does not ramp`);
  }
  assert.ok(LEVELS.filter((l) => l.chapter >= 7).every((l) => l.par >= 9), 'last chapters have no easy levels');
  const rings = (c) => LEVELS.filter((l) => l.chapter === c).reduce((a, l) => a + l.rings.length, 0) / 25;
  assert.ok(rings(CHAPTERS.length - 1) > rings(0), 'late levels use more rings');
});

test('tutorial levels are gentle', () => {
  assert.equal(LEVELS[0].par, 1);
  assert.equal(LEVELS[0].rings.length, 2);
  assert.equal(LEVELS[1].par, 2);
  assert.ok(LEVELS[2].par <= 3);
});

test('geometry: rings do not overlap and bridges have room', () => {
  for (const l of ALL) {
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
