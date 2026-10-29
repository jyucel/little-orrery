// Little Orrery: deterministic level generator.
//
//   node tools/generate-levels.mjs
//
// Chapters (and the daily-puzzle pool) are generated in parallel worker
// threads; every level has its own seed, so the output is deterministic.
//
// For every level it:
//   1. picks a ring topology, ring sizes and mechanics for the chapter,
//   2. places rings and bridges geometrically,
//   3. scrambles a solved board with random legal moves,
//   4. runs the optimal solver and keeps the board only if its shortest
//      solution length ("par") fits the difficulty curve.
// The output (js/levels.js) stores the optimal solution of each level so the
// test-suite can replay it, and re-runs the solver to prove solvability.

import { writeFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildMoves, applyPerm, isRingSolved, isSolved, encodeCells, validateLevel } from '../js/engine.js';
import { solve } from '../js/solver.js';
import { ringRadius, BRIDGE_GAP, ORB_R } from '../js/layout.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS_PER_CHAPTER = 25;

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Ring topologies: centre positions on an abstract grid plus bridged pairs.
// An edge [a, b, 2] is a double bridge.
const H = Math.sqrt(3) / 2;
const TOPOS = {
  duo: { pos: [[0, 0], [1, 0]], edges: [[0, 1]] },
  duo2: { pos: [[0, 0], [1, 0]], edges: [[0, 1, 2]] },
  line3: { pos: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1], [1, 2]] },
  line3d: { pos: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1, 2], [1, 2]] },
  line3dd: { pos: [[0, 0], [1, 0], [2, 0]], edges: [[0, 1, 2], [1, 2, 2]] },
  vee3: { pos: [[0, 0], [1, 0], [0.5, H]], edges: [[0, 2], [1, 2]] },
  tri3: { pos: [[0, 0], [1, 0], [0.5, H]], edges: [[0, 1], [1, 2], [0, 2]] },
  line4: { pos: [[0, 0], [1, 0], [2, 0], [3, 0]], edges: [[0, 1], [1, 2], [2, 3]] },
  zig4: { pos: [[0, 0], [0.5, H], [1, 0], [1.5, H]], edges: [[0, 1], [1, 2], [2, 3]] },
  star4: { pos: [[0, 0], [0, -1], [H, 0.5], [-H, 0.5]], edges: [[0, 1], [0, 2], [0, 3]] },
  square4: { pos: [[0, 0], [1, 0], [1, 1], [0, 1]], edges: [[0, 1], [1, 2], [2, 3], [3, 0]] },
  cup4: { pos: [[0, 0], [1, 0], [1, 1], [0, 1]], edges: [[0, 1], [1, 2], [3, 0]] },
  diamond4: { pos: [[0, 0], [1, 0], [0.5, H], [0.5, -H]], edges: [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3]] },
  kite4: { pos: [[0, 0], [1, 0], [0.5, H], [0.5, -H]], edges: [[0, 2], [1, 2], [0, 3], [1, 3]] },
  plus5: { pos: [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]], edges: [[0, 1], [0, 2], [0, 3], [0, 4]] },
  line5: { pos: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  zig5: { pos: [[0, 0], [0.5, H], [1, 0], [1.5, H], [2, 0]], edges: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  house5: { pos: [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, -H]], edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]] },
  arch5: { pos: [[0, 0], [0.5, -H], [1.5, -H], [2, 0], [1, 0]], edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]] },
};

const angDiff = (a, b) => {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Place rings of the given sizes on a topology and create bridge slots. */
function place(topo, sizes) {
  const rings = sizes.map((n) => ({ n, r: ringRadius(n) }));
  const P = topo.pos;
  const dist = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
  let s = 0;
  for (const [a, b] of topo.edges) s = Math.max(s, (rings[a].r + rings[b].r + BRIDGE_GAP) / dist(a, b));
  for (let a = 0; a < rings.length; a++) {
    for (let b = a + 1; b < rings.length; b++) {
      s = Math.max(s, (rings[a].r + rings[b].r + 2 * ORB_R + 0.5) / dist(a, b));
    }
  }
  rings.forEach((r, i) => {
    r.x = P[i][0] * s;
    r.y = P[i][1] * s;
  });

  // desired bridge directions per ring
  const want = rings.map(() => []);
  const ends = [];
  for (const [a, b, mult = 1] of topo.edges) {
    const phi = Math.atan2(rings[b].y - rings[a].y, rings[b].x - rings[a].x);
    if (mult === 1) {
      ends.push([a, want[a].push(phi) - 1, b, want[b].push(phi + Math.PI) - 1]);
    } else {
      const dA = Math.PI / rings[a].n;
      const dB = Math.PI / rings[b].n;
      ends.push([a, want[a].push(phi + dA) - 1, b, want[b].push(phi + Math.PI - dB) - 1]);
      ends.push([a, want[a].push(phi - dA) - 1, b, want[b].push(phi + Math.PI + dB) - 1]);
    }
  }

  if (want.some((w, i) => w.length > rings[i].n)) return null;

  // choose each ring's base angle so its slots line up with its bridges
  const slotOf = rings.map(() => []);
  rings.forEach((ring, i) => {
    const step = (2 * Math.PI) / ring.n;
    let best = null;
    for (let t = 0; t < 360; t++) {
      const a0 = want[i].length ? want[i][0] - (t / 360) * step + step / 2 : -Math.PI / 2;
      const used = new Set();
      let cost = 0;
      const slots = [];
      for (const w of want[i]) {
        let bk = -1;
        let be = Infinity;
        for (let k = 0; k < ring.n; k++) {
          if (used.has(k)) continue;
          const e = Math.abs(angDiff(a0 + k * step, w));
          if (e < be) {
            be = e;
            bk = k;
          }
        }
        used.add(bk);
        slots.push(bk);
        cost += be * be;
      }
      if (!best || cost < best.cost - 1e-9) best = { cost, a0, slots };
      if (!want[i].length) break;
    }
    ring.a0 = best.a0;
    slotOf[i] = best.slots;
  });

  const bridges = ends.map(([a, ia, b, ib]) => ({ a, sa: slotOf[a][ia], b, sb: slotOf[b][ib] }));
  const r3 = (v) => Math.round(v * 1000) / 1000;
  return {
    rings: rings.map((r) => ({ n: r.n, x: r3(r.x), y: r3(r.y), r: r3(r.r), a0: r3(r.a0) })),
    bridges,
  };
}

function bridgeDegree(bridges, i) {
  return bridges.filter((b) => b.a === i || b.b === i).length;
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

const FOUR = ['line4', 'zig4', 'star4', 'square4', 'cup4', 'kite4', 'diamond4'];
const FIVE = ['plus5', 'line5', 'zig5', 'house5', 'arch5'];
const sizesFor = (rng, t, lo, hi) => TOPOS[t].pos.map(() => randInt(rng, lo, hi));

const CHAPTERS = [
  {
    name: 'First Light',
    blurb: 'Spin and swap your first orbits.',
    lo: 1,
    hi: 9,
    slack: 6,
    spec(i, rng) {
      if (i < 7) return { topo: pick(rng, ['duo', 'duo2']), sizes: [randInt(rng, 3, 5), randInt(rng, 3, 5)] };
      if (i < 16) { const t = pick(rng, ['line3', 'vee3', 'tri3']); return { topo: t, sizes: sizesFor(rng, t, 3, 4) }; }
      const t = pick(rng, ['tri3', 'line3d', 'line4', 'star4']);
      return { topo: t, sizes: sizesFor(rng, t, 3, 5) };
    },
  },
  {
    name: 'Twin Orbits',
    blurb: 'Double bridges and bigger rings.',
    lo: 6,
    hi: 12,
    slack: 6,
    spec(i, rng) {
      if (i < 6) return { topo: 'duo2', sizes: [randInt(rng, 6, 7), randInt(rng, 5, 7)] };
      const t = pick(rng, ['line3d', 'line3dd', 'tri3', 'vee3']);
      return { topo: t, sizes: sizesFor(rng, t, 4, 6) };
    },
  },
  {
    name: 'Constellations',
    blurb: 'Four orbits, four colors.',
    lo: 7,
    hi: 13,
    slack: 5,
    spec(i, rng) {
      const t = pick(rng, FOUR);
      return { topo: t, sizes: sizesFor(rng, t, 3, i < 10 ? 4 : 5) };
    },
  },
  {
    name: 'Anchors',
    blurb: 'Anchored rings never spin.',
    intro: 'locked',
    lo: 7,
    hi: 14,
    slack: 5,
    spec(i, rng) {
      const t = i < 6 ? pick(rng, ['line3dd', 'tri3', 'line3d']) : pick(rng, ['star4', 'square4', 'diamond4', 'kite4', 'plus5']);
      return { topo: t, sizes: sizesFor(rng, t, 3, 5), locked: i < 14 ? 1 : randInt(rng, 1, 2) };
    },
  },
  {
    name: 'Clockwork',
    blurb: 'One-way rings only turn clockwise.',
    intro: 'oneway',
    lo: 8,
    hi: 14,
    slack: 4,
    spec(i, rng) {
      const t = i < 6 ? pick(rng, ['duo2', 'line3', 'tri3']) : pick(rng, FOUR);
      return { topo: t, sizes: sizesFor(rng, t, 3, 5), oneway: i < 10 ? 1 : randInt(rng, 1, 2) };
    },
  },
  {
    name: 'Gearworks',
    blurb: 'Geared rings turn together, in opposite directions.',
    intro: 'gear',
    lo: 8,
    hi: 15,
    slack: 4,
    spec(i, rng) {
      const t = i < 6 ? pick(rng, ['line3', 'vee3', 'tri3']) : pick(rng, FOUR);
      return { topo: t, sizes: sizesFor(rng, t, 3, 5), gears: 1 };
    },
  },
  {
    name: 'Star Charts',
    blurb: 'Some rings must show an exact pattern.',
    intro: 'pattern',
    lo: 6,
    hi: 14,
    slack: 4,
    spec(i, rng) {
      const t = i < 8 ? pick(rng, ['duo2', 'line3', 'tri3', 'vee3']) : pick(rng, FOUR);
      return { topo: t, sizes: sizesFor(rng, t, 3, 5), patterns: i < 16 ? 1 : 2 };
    },
  },
  {
    name: 'Nebula',
    blurb: 'Five orbits and twin colors.',
    lo: 10,
    hi: 16,
    slack: 3,
    spec(i, rng) {
      const t = pick(rng, [...FIVE, 'square4', 'diamond4']);
      const s = { topo: t, sizes: sizesFor(rng, t, 3, 4) };
      const roll = rng();
      if (roll < 0.2) s.locked = 1;
      else if (roll < 0.4) s.oneway = 1;
      else if (roll < 0.55) s.gears = 1;
      else if (roll < 0.75) s.patterns = 1;
      if (rng() < 0.35) s.twins = true;
      return s;
    },
  },
  {
    name: 'Celestial Clockwork',
    blurb: 'Star charts meet the mechanisms.',
    lo: 11,
    hi: 17,
    slack: 3,
    spec(i, rng) {
      const t = pick(rng, [...FOUR, ...FIVE]);
      const s = { topo: t, sizes: sizesFor(rng, t, 3, 5), patterns: randInt(rng, 1, 2) };
      s[pick(rng, ['locked', 'oneway', 'gears'])] = 1;
      return s;
    },
  },
  {
    name: 'Grand Orrery',
    blurb: 'Every mechanism at once.',
    lo: 12,
    hi: 18,
    slack: 3,
    spec(i, rng) {
      const t = pick(rng, [...FIVE, 'diamond4', 'kite4', 'square4', 'star4']);
      const s = { topo: t, sizes: sizesFor(rng, t, 3, 5) };
      for (const m of shuffle(rng, ['locked', 'oneway', 'gears', 'patterns']).slice(0, randInt(rng, 2, 3))) s[m] = 1;
      if (rng() < 0.2) s.twins = true;
      return s;
    },
  },
];

// Daily puzzles: a pool of mid-to-hard boards, one per calendar day.
const DAILY_COUNT = 120;
const DAILY = {
  slack: 4,
  spec(i, rng) {
    const t = pick(rng, [...FOUR, ...FIVE, 'tri3', 'line3dd']);
    const s = { topo: t, sizes: sizesFor(rng, t, 3, 5) };
    const extra = pick(rng, [null, 'locked', 'oneway', 'gears', 'patterns', 'patterns']);
    if (extra) s[extra] = 1;
    return s;
  },
  target: (i) => 11 + (i % 4),
};

function target(ch, i) {
  const c = CHAPTERS[ch];
  return Math.round(c.lo + ((c.hi - c.lo) * i) / (LEVELS_PER_CHAPTER - 1));
}

/** Build the static part of a level from a spec, or null if infeasible. */
function buildLevel(spec, rng) {
  const topo = TOPOS[spec.topo];
  const sizes = topo.pos.map((_, i) => spec.sizes[i] ?? spec.sizes[spec.sizes.length - 1]);
  const placed = place(topo, sizes);
  if (!placed) return null;
  const { rings, bridges } = placed;
  const level = { rings, bridges, gears: [] };
  const idx = rings.map((_, i) => i);

  if (spec.locked) {
    const cands = shuffle(rng, idx.filter((i) => bridgeDegree(bridges, i) >= 2));
    if (cands.length < spec.locked) return null;
    for (const i of cands.slice(0, spec.locked)) rings[i].locked = true;
  }
  if (spec.oneway) {
    const cands = shuffle(rng, idx.filter((i) => !rings[i].locked));
    if (cands.length < spec.oneway) return null;
    for (const i of cands.slice(0, spec.oneway)) rings[i].oneway = true;
  }
  if (spec.gears) {
    const free = shuffle(rng, idx.filter((i) => !rings[i].locked && !rings[i].oneway));
    if (free.length < 2) return null;
    level.gears.push([free[0], free[1]].sort((a, b) => a - b));
  }
  if (!level.gears.length) delete level.gears;

  // colors: ring i is solved with color col[i]
  const palette = shuffle(rng, [0, 1, 2, 3, 4, 5]);
  const col = idx.map((i) => palette[i]);
  if (spec.twins) {
    // pair up rings of equal size to share a color
    const bySize = new Map();
    idx.forEach((i) => bySize.set(rings[i].n, [...(bySize.get(rings[i].n) || []), i]));
    const group = [...bySize.values()].find((g) => g.length >= 2);
    if (!group) return null;
    col[group[1]] = col[group[0]];
  }
  const solved = idx.map((i) => new Array(rings[i].n).fill(col[i]));

  if (spec.patterns) {
    // Star charts: a ring's target becomes a pattern mixing its own color
    // with colors of other rings. The board's orbs are exactly the solved
    // contents of every ring, so color counts are consistent by construction.
    const cands = shuffle(rng, idx.filter((i) => rings[i].n >= 3));
    if (cands.length < spec.patterns + 1) return null;
    const pat = cands.slice(0, spec.patterns);
    for (const i of pat) {
      const n = rings[i].n;
      const others = shuffle(rng, [...new Set(idx.filter((j) => j !== i).map((j) => col[j]))]);
      const a = col[i];
      const b = others[0];
      const c = others[1] ?? b;
      const style = pick(rng, ['alt', 'half', 'tri', 'odd']);
      let p;
      if (style === 'alt') p = Array.from({ length: n }, (_, k) => (k % 2 ? b : a));
      else if (style === 'half') p = Array.from({ length: n }, (_, k) => (k < Math.ceil(n / 2) ? a : b));
      else if (style === 'tri') p = Array.from({ length: n }, (_, k) => [a, b, c][k % 3]);
      else p = Array.from({ length: n }, (_, k) => (k === 0 ? b : a));
      if (p.every((v) => v === p[0])) return null;
      solved[i] = p;
      rings[i].pattern = p.join('');
    }
  }
  level.solvedCells = solved.flat();
  return level;
}

function scramble(level, k, rng) {
  const moves = buildMoves(level);
  let cells = level.solvedCells;
  let last = null;
  for (let s = 0; s < k; s++) {
    let m;
    do m = pick(rng, moves);
    while (last && m.type === 'swap' && last.id === m.id);
    if (last && m.type === 'rotate' && last.type === 'rotate' && last.ring === m.ring && last.dir === -m.dir) {
      s--;
      continue;
    }
    cells = applyPerm(cells, m.perm);
    last = m;
  }
  return cells;
}

function makeLevel({ id, seed, t, slack, specFn, fixed, extra }) {
  const rng = mulberry32(seed);
  let best = null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const spec = fixed ? fixed.spec : specFn(rng);
    const level = buildLevel(spec, rng);
    if (!level) continue;
    const k = Math.round(t * (1 + rng() * 1.5)) + 1;
    const cells = fixed ? fixed.cells(level) : scramble(level, k, rng);
    if (isSolved(level, cells)) continue;
    if (level.rings.some((_, r) => isRingSolved(level, cells, r))) continue;
    const sol = solve(level, cells, { maxNodes: 6_000_000 });
    if (!sol) continue;
    const tol = attempt < 100 ? 0 : attempt < 200 ? 1 : 2;
    const ok = fixed ? sol.length === fixed.par : Math.abs(sol.length - t) <= tol;
    const cand = { level, cells, sol, spec };
    if (!best || Math.abs(sol.length - t) < Math.abs(best.sol.length - t)) best = cand;
    if (ok) {
      best = cand;
      break;
    }
  }
  if (!best) throw new Error(`could not build level ${id}`);
  const { level, cells, sol, spec } = best;
  delete level.solvedCells;
  const out = {
    id,
    ...extra,
    rings: level.rings,
    bridges: level.bridges,
    ...(level.gears ? { gears: level.gears } : {}),
    start: '',
    par: sol.length,
    limit: sol.length + slack,
    solution: sol.path,
  };
  out.start = encodeCells(out, cells);
  const errs = validateLevel(out);
  if (errs.length) throw new Error(`level ${id}: ${errs.join(', ')}`);
  return { out, spec, t };
}

// Scripted tutorial boards (chapter 1, levels 1-2).
const tutorial = {
  1: {
    par: 1,
    spec: { topo: 'duo', sizes: [4, 4] },
    cells: (lv) => applyPerm(lv.solvedCells, buildMoves(lv).find((m) => m.id === 'b0').perm),
  },
  2: {
    par: 2,
    spec: { topo: 'duo', sizes: [4, 4] },
    cells: (lv) => {
      const mv = buildMoves(lv);
      const c = applyPerm(lv.solvedCells, mv.find((m) => m.id === 'b0').perm);
      return applyPerm(c, mv.find((m) => m.id === 'r1-').perm);
    },
  },
};

/** Generate one job: a chapter index, or 'daily'. */
function runJob(job) {
  const out = [];
  if (job === 'daily') {
    for (let i = 0; i < DAILY_COUNT; i++) {
      const r = makeLevel({
        id: `d${i + 1}`,
        seed: 777_000 + i * 104_729,
        t: DAILY.target(i),
        slack: DAILY.slack,
        specFn: (rng) => DAILY.spec(i, rng),
        extra: { daily: true },
      });
      out.push(r);
    }
    return out;
  }
  const ch = job;
  for (let i = 0; i < LEVELS_PER_CHAPTER; i++) {
    const id = ch * LEVELS_PER_CHAPTER + i + 1;
    out.push(
      makeLevel({
        id,
        seed: 1000 + id * 7919,
        t: target(ch, i),
        slack: CHAPTERS[ch].slack,
        specFn: (rng) => CHAPTERS[ch].spec(i, rng),
        fixed: tutorial[id],
        extra: { chapter: ch },
      }),
    );
  }
  return out;
}

if (!isMainThread) {
  parentPort.postMessage(runJob(workerData));
} else {
  const t0 = Date.now();
  // longest jobs first
  const jobs = ['daily', ...CHAPTERS.map((_, c) => c).reverse()];
  const results = new Map();
  const width = Math.max(1, Math.min(jobs.length, (availableParallelism?.() || 4) - 1));
  let next = 0;
  await new Promise((resolve, reject) => {
    let running = 0;
    const launch = () => {
      if (next >= jobs.length) {
        if (!running) resolve();
        return;
      }
      const job = jobs[next++];
      running++;
      const w = new Worker(fileURLToPath(import.meta.url), { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 2048 } });
      w.once('message', (res) => {
        results.set(job, res);
        for (const r of res) process.stdout.write(`${r.out.id} ${r.spec.topo} par=${r.out.par} (target ${r.t})\n`);
      });
      w.once('error', reject);
      w.once('exit', () => {
        running--;
        launch();
      });
    };
    for (let i = 0; i < width; i++) launch();
  });

  const levels = CHAPTERS.flatMap((_, c) => results.get(c).map((r) => r.out));
  const daily = results.get('daily').map((r) => r.out);
  const chapters = CHAPTERS.map(({ name, blurb, intro }) => ({ name, blurb, ...(intro ? { intro } : {}) }));
  const rows = (arr) => arr.map((l) => '  ' + JSON.stringify(l)).join(',\n');
  writeFileSync(
    join(ROOT, 'js', 'levels.js'),
    `// Generated by tools/generate-levels.mjs. Do not edit by hand.
// ${levels.length} levels, each verified solvable; "par" is the optimal move count,
// "limit" the move budget and "solution" one optimal solution.

export const CHAPTERS = ${JSON.stringify(chapters, null, 1)};

export const LEVELS = [
${rows(levels)}
];
`,
  );
  writeFileSync(
    join(ROOT, 'js', 'daily.js'),
    `// Generated by tools/generate-levels.mjs. Do not edit by hand.
// Pool of ${daily.length} daily puzzles; the game picks one per calendar day.

export const DAILY = [
${rows(daily)}
];
`,
  );
  console.log(`Wrote ${levels.length} levels + ${daily.length} daily puzzles in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
