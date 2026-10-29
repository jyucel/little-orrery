// Little Orrery: core puzzle rules.
//
// Pure module with no DOM access, shared by the game UI, the level generator
// and the automated tests so that every consumer applies the exact same rules.
//
// Board model
//   A level has rings ("orbits"). Ring i holds `n` slots. All slots of all
//   rings are stored in one flat array `cells`, ring by ring, each entry a
//   color index. Slot k of a ring sits at angle a0 + k * 2π / n (clockwise).
//
// Moves
//   Every move is a permutation of the flat array: next[i] = prev[perm[i]].
//   - rotate  ring r one step clockwise (+1) or counter-clockwise (-1).
//             Anchored rings cannot rotate, one-way rings only turn clockwise,
//             geared rings drag their partner one step the opposite way.
//   - swap    exchange the two orbs at the ends of a bridge.
//
// Goal
//   Every ring contains orbs of a single color, except "star chart" rings
//   (ring.pattern, one color digit per slot) whose slots must hold exactly
//   the colors of their pattern.
//
// Move limit
//   level.limit caps the number of moves; undo gives moves back.

export const CW = 1;
export const CCW = -1;

/** Offset of each ring's first slot inside the flat cell array. */
export function ringOffsets(level) {
  let o = 0;
  return level.rings.map((r) => {
    const v = o;
    o += r.n;
    return v;
  });
}

export function totalSlots(level) {
  return level.rings.reduce((s, r) => s + r.n, 0);
}

/** Decode the level's start string ("0101|1010") into a flat cell array. */
export function decodeStart(level) {
  const parts = level.start.split('|');
  if (parts.length !== level.rings.length) throw new Error(`Level ${level.id}: ring count mismatch`);
  const cells = [];
  parts.forEach((p, i) => {
    if (p.length !== level.rings[i].n) throw new Error(`Level ${level.id}: ring ${i} size mismatch`);
    for (const ch of p) cells.push(Number(ch));
  });
  return cells;
}

export function encodeCells(level, cells) {
  const off = ringOffsets(level);
  return level.rings.map((r, i) => cells.slice(off[i], off[i] + r.n).join('')).join('|');
}

/** Partner ring of a geared ring, or -1. */
export function gearPartner(level, ring) {
  for (const [a, b] of level.gears || []) {
    if (a === ring) return b;
    if (b === ring) return a;
  }
  return -1;
}

function rotatePerm(perm, off, n, dir) {
  for (let j = 0; j < n; j++) {
    // clockwise: the orb in slot j-1 moves into slot j
    perm[off + j] = off + ((j - dir) % n + n) % n;
  }
}

/**
 * All moves that exist in a level (legal from any state; legality never
 * depends on the board contents). Each move: { id, type, ring|bridge, dir, perm }.
 */
export function buildMoves(level) {
  const N = totalSlots(level);
  const off = ringOffsets(level);
  const identity = () => Array.from({ length: N }, (_, i) => i);
  const moves = [];
  level.rings.forEach((ring, r) => {
    if (ring.locked) return;
    const dirs = ring.oneway ? [CW] : [CW, CCW];
    for (const dir of dirs) {
      const perm = identity();
      rotatePerm(perm, off[r], ring.n, dir);
      const partner = gearPartner(level, r);
      if (partner >= 0) rotatePerm(perm, off[partner], level.rings[partner].n, -dir);
      moves.push({ id: `r${r}${dir > 0 ? '+' : '-'}`, type: 'rotate', ring: r, dir, perm });
    }
  });
  level.bridges.forEach((b, i) => {
    const perm = identity();
    const x = off[b.a] + b.sa;
    const y = off[b.b] + b.sb;
    perm[x] = y;
    perm[y] = x;
    moves.push({ id: `b${i}`, type: 'swap', bridge: i, perm });
  });
  return moves;
}

export function applyPerm(cells, perm) {
  const out = new Array(cells.length);
  for (let i = 0; i < perm.length; i++) out[i] = cells[perm[i]];
  return out;
}

export function ringCells(level, cells, r) {
  const off = ringOffsets(level)[r];
  return cells.slice(off, off + level.rings[r].n);
}

export function isRingSolved(level, cells, r) {
  const c = ringCells(level, cells, r);
  const pattern = level.rings[r].pattern;
  if (pattern) return c.every((v, k) => v === Number(pattern[k]));
  return c.every((v) => v === c[0]);
}

/** Per-slot match flags for a star-chart ring (null for ordinary rings). */
export function patternMatches(level, cells, r) {
  const pattern = level.rings[r].pattern;
  if (!pattern) return null;
  return ringCells(level, cells, r).map((v, k) => v === Number(pattern[k]));
}

export function isSolved(level, cells) {
  return level.rings.every((_, r) => isRingSolved(level, cells, r));
}

/** Count of each color across the board. */
export function colorCounts(cells) {
  const m = new Map();
  for (const c of cells) m.set(c, (m.get(c) || 0) + 1);
  return m;
}

/**
 * Validate a level's static structure. Returns a list of problems (empty when
 * the level is well formed).
 */
export function validateLevel(level) {
  const errs = [];
  const N = totalSlots(level);
  let cells;
  try {
    cells = decodeStart(level);
  } catch (e) {
    return [e.message];
  }
  if (cells.length !== N) errs.push('cell count mismatch');
  const used = new Set();
  level.bridges.forEach((b, i) => {
    for (const [r, s] of [[b.a, b.sa], [b.b, b.sb]]) {
      if (!level.rings[r]) errs.push(`bridge ${i}: bad ring ${r}`);
      else if (s < 0 || s >= level.rings[r].n) errs.push(`bridge ${i}: bad slot ${s}`);
      const key = `${r}:${s}`;
      if (used.has(key)) errs.push(`bridge ${i}: slot ${key} used twice`);
      used.add(key);
    }
    if (b.a === b.b) errs.push(`bridge ${i}: connects a ring to itself`);
  });
  level.rings.forEach((ring, r) => {
    if (ring.pattern && (ring.pattern.length !== ring.n || /[^0-9]/.test(ring.pattern))) errs.push(`ring ${r}: bad pattern`);
  });
  if (level.limit !== undefined && !(level.limit >= (level.par || 0))) errs.push('move limit below par');
  for (const [a, b] of level.gears || []) {
    for (const r of [a, b]) {
      if (!level.rings[r]) errs.push(`gear: bad ring ${r}`);
      else if (level.rings[r].locked || level.rings[r].oneway) errs.push(`gear: ring ${r} must be free`);
    }
  }
  // The goal must be reachable in principle: color counts must be packable
  // into the patterns and monochrome rings.
  if (!goalStates(level, cells).length) errs.push('color counts cannot fill the rings');
  return errs;
}

/**
 * Every solved arrangement compatible with the board's color counts:
 * star-chart rings hold their pattern, the other rings are monochrome.
 */
export function goalStates(level, cells) {
  const remaining = colorCounts(cells);
  const colors = [...remaining.keys()].sort();
  const rings = level.rings;
  for (const ring of rings) {
    if (!ring.pattern) continue;
    for (const ch of ring.pattern) {
      const c = Number(ch);
      if (!(remaining.get(c) > 0)) return [];
      remaining.set(c, remaining.get(c) - 1);
    }
  }
  const out = [];
  const pick = [];
  (function rec(i) {
    if (i === rings.length) {
      if ([...remaining.values()].every((v) => v === 0)) {
        out.push(rings.flatMap((ring, r) => (ring.pattern ? [...ring.pattern].map(Number) : new Array(ring.n).fill(pick[r]))));
      }
      return;
    }
    if (rings[i].pattern) {
      pick.push(null);
      rec(i + 1);
      pick.pop();
      return;
    }
    const n = rings[i].n;
    for (const c of colors) {
      if (remaining.get(c) >= n) {
        remaining.set(c, remaining.get(c) - n);
        pick.push(c);
        rec(i + 1);
        pick.pop();
        remaining.set(c, remaining.get(c) + n);
      }
    }
  })(0);
  return out;
}

/**
 * Stateful game session: current board, move counter, undo history.
 * One "action" may contain several single-step moves (e.g. a ring dragged
 * three slots); undo reverts a whole action.
 */
export class Game {
  constructor(level) {
    this.level = level;
    this.moves = buildMoves(level);
    this.byId = new Map(this.moves.map((m) => [m.id, m]));
    this.initial = decodeStart(level);
    this.limit = level.limit ?? Infinity;
    this.restart();
  }

  restart() {
    this.cells = this.initial.slice();
    this.history = [];
    this.moveCount = 0;
  }

  /** Move for rotating ring r in direction dir, or null if illegal. */
  rotateMove(r, dir) {
    return this.byId.get(`r${r}${dir > 0 ? '+' : '-'}`) || null;
  }

  canPlay(id) {
    return this.byId.has(id);
  }

  get movesLeft() {
    return this.limit - this.moveCount;
  }

  /** Out of moves without having solved the board (undo or restart to go on). */
  get outOfMoves() {
    return !this.solved && this.moveCount >= this.limit;
  }

  /**
   * Apply an action made of one or more move ids. Illegal actions, and
   * actions that would exceed the move limit, are rejected as a whole and
   * leave the state untouched. Returns true on success.
   */
  play(ids) {
    if (!Array.isArray(ids)) ids = [ids];
    if (!ids.length || !ids.every((id) => this.byId.has(id))) return false;
    if (this.solved) return false;
    if (this.moveCount + ids.length > this.limit) return false;
    const before = this.cells;
    let cells = before;
    for (const id of ids) cells = applyPerm(cells, this.byId.get(id).perm);
    this.history.push({ cells: before, ids: ids.slice() });
    this.cells = cells;
    this.moveCount += ids.length;
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.cells = last.cells;
    this.moveCount -= last.ids.length;
    return last;
  }

  get solved() {
    return isSolved(this.level, this.cells);
  }

  ringSolved(r) {
    return isRingSolved(this.level, this.cells, r);
  }
}

/**
 * Star rating for finishing a level in `moves`: three at or under par, two
 * within half of the margin to the move limit, otherwise one.
 */
export function starsFor(moves, par, limit = par + 4) {
  if (moves <= par) return 3;
  if (moves <= par + Math.max(1, Math.ceil((limit - par) / 2))) return 2;
  return 1;
}
