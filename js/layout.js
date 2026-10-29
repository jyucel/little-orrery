// Little Orrery: board geometry in abstract "units".
// Shared by the level generator (which places rings and bridges) and the
// renderer (which maps units to screen pixels).

export const ORB_R = 0.4; // orb radius
export const SLOT_ARC = 1.3; // distance between neighbouring slots along a ring
export const BRIDGE_GAP = 1.9; // minimum distance between two bridged slots

export function ringRadius(n) {
  return Math.max(1.12, (n * SLOT_ARC) / (2 * Math.PI));
}

export function slotAngle(ring, k) {
  return ring.a0 + (k * 2 * Math.PI) / ring.n;
}

export function slotPos(ring, k, extraAngle = 0) {
  const a = slotAngle(ring, k) + extraAngle;
  return { x: ring.x + Math.cos(a) * ring.r, y: ring.y + Math.sin(a) * ring.r };
}

/** Axis-aligned bounds of the whole board, including orbs. */
export function boardBounds(level) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of level.rings) {
    const e = r.r + ORB_R + 0.25;
    minX = Math.min(minX, r.x - e);
    maxX = Math.max(maxX, r.x + e);
    minY = Math.min(minY, r.y - e);
    maxY = Math.max(maxY, r.y + e);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * A copy of the level rotated a quarter turn (used to fit wide boards on
 * portrait screens). Slot indices are unchanged, so game state is unaffected.
 */
export function rotatedQuarter(level) {
  return {
    ...level,
    rings: level.rings.map((r) => ({ ...r, x: -r.y, y: r.x, a0: r.a0 + Math.PI / 2 })),
  };
}
