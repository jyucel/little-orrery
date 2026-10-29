// Little Orrery: optimal solver.
//
// Bidirectional breadth-first search between the current board and the set
// of all solved boards. Moves are permutations, so the backward search simply
// applies inverse permutations. Expanding whole layers and keeping the best
// meeting point of a layer yields a shortest solution (one step = one move).
//
// Performance: a board is packed into two base-B integers (hi, lo) and kept
// in a typed-array open-addressing hash table, so millions of states fit in
// memory. A move only rewrites the digits it touches, so the packed key of a
// neighbour is updated incrementally instead of being rebuilt.
//
// Used by the level generator (to compute par), by the tests (to prove every
// level is solvable) and by the in-game hint button (with a small budget).

import { buildMoves, goalStates } from './engine.js';

/** Moves with duplicate permutations removed (geared rings create aliases). */
export function distinctMoves(level) {
  const seen = new Set();
  return buildMoves(level).filter((m) => {
    const k = m.perm.join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function invert(perm) {
  const inv = new Array(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

/** Changed positions of a permutation: next[pos[j]] = prev[src[j]]. */
function sparse(perm) {
  const pos = [];
  const src = [];
  perm.forEach((p, i) => {
    if (p !== i) {
      pos.push(i);
      src.push(p);
    }
  });
  return { pos: Int32Array.from(pos), src: Int32Array.from(src) };
}

const TWO32 = 4294967296;

function hash2(hi, lo, mask) {
  const a = (hi % TWO32) | 0;
  const b = Math.floor(hi / TWO32) | 0;
  const c = (lo % TWO32) | 0;
  const d = Math.floor(lo / TWO32) | 0;
  let h = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ c ^ (h >>> 15), 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(d, 0x27d4eb2d) ^ (h >>> 13), 0x165667b1);
  return (h ^ (h >>> 16)) & mask;
}

/**
 * Find a shortest solution from `cells`.
 * @returns {{length:number, path:string[], nodes:number}|null} null when the
 *   node budget was exhausted (or, in theory, the board is unsolvable).
 */
export function solve(level, cells, { maxNodes = 3_000_000 } = {}) {
  const moves = distinctMoves(level);
  const N = cells.length;
  const goals = goalStates(level, cells);
  if (!goals.length) return null;

  const B = Math.max(2, ...cells) + 1;
  const half = Math.ceil(N / 2); // digits [0, half) -> hi, [half, N) -> lo
  if (Math.pow(B, half) >= 2 ** 53) throw new Error('board too large for solver');
  const place = new Float64Array(N);
  for (let i = 0; i < N; i++) place[i] = Math.pow(B, i < half ? i : i - half);

  const fwd = moves.map((m) => sparse(m.perm));
  const bwd = moves.map((m) => sparse(invert(m.perm)));
  const M = moves.length;

  // node storage, grown on demand up to maxNodes
  let cap = Math.min(maxNodes + goals.length + 8, 1 << 16);
  let kHi = new Float64Array(cap);
  let kLo = new Float64Array(cap);
  let parent = new Int32Array(cap);
  let via = new Uint8Array(cap);
  let depth = new Uint16Array(cap);
  let side = new Uint8Array(cap);
  let count = 0;

  // hash table of node indices (+1; 0 = empty), kept under ~60% load
  let tsize = 1 << 17;
  let table = new Int32Array(tsize);
  let mask = tsize - 1;

  const grow = () => {
    const ncap = cap * 2;
    const g = (A) => {
      const b = new A.constructor(ncap);
      b.set(A);
      return b;
    };
    kHi = g(kHi);
    kLo = g(kLo);
    parent = g(parent);
    via = g(via);
    depth = g(depth);
    side = g(side);
    cap = ncap;
    tsize = 1;
    while (tsize < cap * 1.6) tsize <<= 1;
    table = new Int32Array(tsize);
    mask = tsize - 1;
    for (let n = 0; n < count; n++) {
      let h = hash2(kHi[n], kLo[n], mask);
      while (table[h] !== 0) h = (h + 1) & mask;
      table[h] = n + 1;
    }
  };

  const find = (hi, lo) => {
    let h = hash2(hi, lo, mask);
    for (;;) {
      const v = table[h];
      if (v === 0) return -1 - h; // free slot, encoded
      const n = v - 1;
      if (kHi[n] === hi && kLo[n] === lo) return n;
      h = (h + 1) & mask;
    }
  };
  // `slot` must come from a find() made after the last grow()
  const add = (slot, hi, lo, par, mv, d, sd) => {
    const n = count++;
    kHi[n] = hi;
    kLo[n] = lo;
    parent[n] = par;
    via[n] = mv;
    depth[n] = d;
    side[n] = sd;
    table[-1 - slot] = n + 1;
    return n;
  };
  const ensure = () => {
    if (count + 1 >= cap) grow();
  };
  const pack = (c) => {
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < N; i++) {
      if (i < half) hi += c[i] * place[i];
      else lo += c[i] * place[i];
    }
    return [hi, lo];
  };
  const digits = new Int32Array(N);
  const unpack = (hi, lo) => {
    for (let i = 0; i < half; i++) {
      const q = Math.floor(hi / B);
      digits[i] = hi - q * B;
      hi = q;
    }
    for (let i = half; i < N; i++) {
      const q = Math.floor(lo / B);
      digits[i] = lo - q * B;
      lo = q;
    }
  };

  const [sHi, sLo] = pack(cells);
  while (cap < goals.length + 2) grow();
  const start = add(find(sHi, sLo), sHi, sLo, -1, 0, 0, 0);
  let bFront = [];
  for (const g of goals) {
    const [hi, lo] = pack(g);
    const f = find(hi, lo);
    if (f === start) return { length: 0, path: [], nodes: 1 };
    if (f < 0) bFront.push(add(f, hi, lo, -1, 0, 0, 1));
  }
  let fFront = [start];

  const chainToRoot = (n) => {
    const out = [];
    while (parent[n] !== -1) {
      out.push(moves[via[n]].id);
      n = parent[n];
    }
    return out;
  };

  while (fFront.length && bFront.length) {
    const forward = fFront.length <= bFront.length;
    const front = forward ? fFront : bFront;
    const sd = forward ? 0 : 1;
    const ops = forward ? fwd : bwd;
    const next = [];
    let best = null;

    for (const u of front) {
      const hi0 = kHi[u];
      const lo0 = kLo[u];
      unpack(hi0, lo0);
      const d = depth[u] + 1;
      for (let m = 0; m < M; m++) {
        const { pos, src } = ops[m];
        let hi = hi0;
        let lo = lo0;
        for (let j = 0; j < pos.length; j++) {
          const p = pos[j];
          const delta = (digits[src[j]] - digits[p]) * place[p];
          if (p < half) hi += delta;
          else lo += delta;
        }
        if (count >= maxNodes) return null;
        ensure();
        const f = find(hi, lo);
        if (f >= 0) {
          if (side[f] !== sd) {
            const total = d + depth[f];
            if (!best || total < best.total) best = { total, u, m, v: f };
          }
          continue;
        }
        next.push(add(f, hi, lo, u, m, d, sd));
      }
    }
    if (forward) fFront = next;
    else bFront = next;

    if (best) {
      // forward: start..u -m-> v ..goal ; backward: start..v -m-> u ..goal
      const [fNode, bNode] = forward ? [best.u, best.v] : [best.v, best.u];
      const path = chainToRoot(fNode).reverse();
      path.push(moves[best.m].id);
      path.push(...chainToRoot(bNode));
      return { length: path.length, path, nodes: count };
    }
  }
  return null;
}
