// Little Orrery: saved progress and settings (localStorage).
// The storage object is injected so the logic can be tested in Node.

import { starsFor } from './engine.js';

const KEY = 'little-orrery.v1';
export const LOOKAHEAD = 3; // levels playable beyond the last solved one

function defaults() {
  return {
    v: 1,
    stars: {}, // level id -> best star count
    best: {}, // level id -> fewest moves
    seen: {}, // one-time intros already shown
    last: 1, // last level played
    settings: { sfx: true, music: true, glyphs: true },
  };
}

export class Progress {
  constructor(storage, totalLevels) {
    this.storage = storage;
    this.total = totalLevels;
    this.data = defaults();
    try {
      const raw = storage && storage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.v === 1) {
          this.data = { ...defaults(), ...parsed, settings: { ...defaults().settings, ...parsed.settings } };
        }
      }
    } catch {
      // corrupt or blocked storage: start fresh
    }
  }

  save() {
    try {
      this.storage && this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // storage full or unavailable; progress stays in memory
    }
  }

  stars(id) {
    return this.data.stars[id] || 0;
  }

  best(id) {
    return this.data.best[id] ?? null;
  }

  isSolved(id) {
    return this.stars(id) > 0;
  }

  /** A level is playable if it is among the first few or close after a solved one. */
  isUnlocked(id) {
    if (id < 1 || id > this.total) return false;
    if (id <= LOOKAHEAD) return true;
    for (let k = 1; k <= LOOKAHEAD; k++) if (this.isSolved(id - k)) return true;
    return this.isSolved(id);
  }

  /** Record a finished level. Returns the stars earned and whether it was a record. */
  recordWin(id, moves, par) {
    const stars = starsFor(moves, par);
    const prevBest = this.best(id);
    const newBest = prevBest === null || moves < prevBest;
    if (newBest) this.data.best[id] = moves;
    if (stars > this.stars(id)) this.data.stars[id] = stars;
    this.save();
    return { stars, newBest, prevBest };
  }

  setLast(id) {
    this.data.last = id;
    this.save();
  }

  firstUnsolved() {
    for (let id = 1; id <= this.total; id++) if (!this.isSolved(id)) return id;
    return null;
  }

  /** Level to open from the "Play" button. */
  continueLevel() {
    const last = this.data.last;
    if (last && this.isUnlocked(last) && !this.isSolved(last)) return last;
    return this.firstUnsolved() ?? this.total;
  }

  totalStars() {
    return Object.values(this.data.stars).reduce((a, b) => a + b, 0);
  }

  solvedCount() {
    return Object.keys(this.data.stars).length;
  }

  markSeen(key) {
    this.data.seen[key] = true;
    this.save();
  }

  hasSeen(key) {
    return !!this.data.seen[key];
  }

  setting(name) {
    return this.data.settings[name];
  }

  setSetting(name, value) {
    this.data.settings[name] = value;
    this.save();
  }

  reset() {
    const settings = this.data.settings;
    this.data = defaults();
    this.data.settings = settings;
    this.save();
  }
}
