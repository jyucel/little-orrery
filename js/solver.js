// Little Orrery: optimal solver.
//
// Bidirectional breadth-first search between the current board and the set
// of all solved boards. Moves are permutations, so the backward search simply
// applies inverse permutations. Expanding whole layers and keeping the best
// meeting point of a layer yields a shortest solution (one step = one move).
//
// Used by the level generator (to compute par), by the tests (to prove every
// level is solvable) and by the in-game hint button (with a small budget).

import { buildMoves, goalStates } from './engine.js';

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function toKey(cells) {
  let s = '';
  for (const c of cells) s += CHARS[c];
  return s;
}

function permute(key, perm) {
  let s = '';
  for (let i = 0; i < perm.length; i++) s += key[perm[i]];
  return s;
}

function invert(perm) {
  const inv = new Array(perm.length);
  for (let i = 0; i < perm.length; i++) inv[perm[i]] = i;
  return inv;
}

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

/**
 * Find a shortest solution from `cells`.
 * @returns {{length:number, path:string[], nodes:number}|null} null when the
 *   node budget was exhausted (or, in theory, the board is unsolvable).
 */
export function solve(level, cells, { maxNodes = 3_000_000 } = {}) {
  const moves = distinctMoves(level);
  const fwdPerm = moves.map((m) => m.perm);
  const bwdPerm = moves.map((m) => invert(m.perm));
  const start = toKey(cells);
  const goals = goalStates(level, cells).map(toKey);
  if (!goals.length) return null;

  // value: [neighbourKey, moveIndex, depth]
  const fwd = new Map([[start, [null, -1, 0]]]);
  const bwd = new Map(goals.map((g) => [g, [null, -1, 0]]));
  if (bwd.has(start)) return { length: 0, path: [], nodes: 1 };

  let fFront = [start];
  let bFront = goals.slice();
  let fDepth = 0;
  let bDepth = 0;

  while (fFront.length && bFront.length) {
    const forward = fFront.length <= bFront.length;
    const front = forward ? fFront : bFront;
    const mine = forward ? fwd : bwd;
    const other = forward ? bwd : fwd;
    const perms = forward ? fwdPerm : bwdPerm;
    const depth = (forward ? fDepth : bDepth) + 1;
    const next = [];
    let best = null;

    for (const key of front) {
      for (let m = 0; m < perms.length; m++) {
        const nk = permute(key, perms[m]);
        if (mine.has(nk)) continue;
        mine.set(nk, [key, m, depth]);
        next.push(nk);
        const hit = other.get(nk);
        if (hit) {
          const total = depth + hit[2];
          if (!best || total < best.total) best = { total, key: nk };
        }
      }
      if (fwd.size + bwd.size > maxNodes) return null;
    }
    if (forward) {
      fFront = next;
      fDepth = depth;
    } else {
      bFront = next;
      bDepth = depth;
    }
    if (best) {
      const path = [];
      // walk back to the start
      let k = best.key;
      while (fwd.get(k)[0] !== null) {
        const [prev, m] = fwd.get(k);
        path.unshift(moves[m].id);
        k = prev;
      }
      // walk forward to a goal
      k = best.key;
      while (bwd.get(k)[0] !== null) {
        const [nextKey, m] = bwd.get(k);
        path.push(moves[m].id);
        k = nextKey;
      }
      return { length: path.length, path, nodes: fwd.size + bwd.size };
    }
  }
  return null;
}
