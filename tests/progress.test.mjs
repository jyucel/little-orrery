// Saved progress: unlocking, stars, persistence, robustness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Progress, LOOKAHEAD } from '../js/progress.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
}

test('fresh progress unlocks only the first levels', () => {
  const p = new Progress(new MemoryStorage(), 200);
  for (let id = 1; id <= LOOKAHEAD; id++) assert.ok(p.isUnlocked(id));
  assert.equal(p.isUnlocked(LOOKAHEAD + 1), false);
  assert.equal(p.isUnlocked(0), false);
  assert.equal(p.isUnlocked(201), false);
  assert.equal(p.continueLevel(), 1);
});

test('solving a level unlocks the next ones', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  assert.ok(p.isUnlocked(4));
  assert.equal(p.isUnlocked(5), false);
  p.recordWin(4, 10, 3);
  assert.ok(p.isUnlocked(7));
  assert.equal(p.isUnlocked(8), false);
});

test('progression through all levels in order keeps the next level unlocked', () => {
  const p = new Progress(new MemoryStorage(), 200);
  for (let id = 1; id <= 200; id++) {
    assert.ok(p.isUnlocked(id), `level ${id} locked`);
    p.recordWin(id, 5, 5);
  }
  assert.equal(p.firstUnsolved(), null);
  assert.equal(p.solvedCount(), 200);
  assert.equal(p.totalStars(), 600);
});

test('stars and best moves only improve', () => {
  const p = new Progress(new MemoryStorage(), 200);
  let r = p.recordWin(2, 9, 4);
  assert.equal(r.stars, 1);
  assert.ok(r.newBest);
  r = p.recordWin(2, 4, 4);
  assert.equal(r.stars, 3);
  assert.equal(r.prevBest, 9);
  r = p.recordWin(2, 12, 4);
  assert.equal(r.stars, 1);
  assert.equal(r.newBest, false);
  assert.equal(p.stars(2), 3);
  assert.equal(p.best(2), 4);
});

test('progress persists across sessions', () => {
  const store = new MemoryStorage();
  const a = new Progress(store, 200);
  a.recordWin(1, 1, 1);
  a.recordWin(2, 3, 2);
  a.setSetting('music', false);
  a.markSeen('locked');
  a.setLast(3);
  const b = new Progress(store, 200);
  assert.equal(b.stars(1), 3);
  assert.equal(b.stars(2), 2);
  assert.equal(b.setting('music'), false);
  assert.equal(b.setting('sfx'), true);
  assert.ok(b.hasSeen('locked'));
  assert.equal(b.continueLevel(), 3);
});

test('continue skips to the first unsolved level when the last one is done', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  p.setLast(1);
  assert.equal(p.continueLevel(), 2);
});

test('corrupt or missing storage never throws', () => {
  const store = new MemoryStorage();
  store.setItem('little-orrery.v1', '{not json');
  const p = new Progress(store, 200);
  assert.equal(p.solvedCount(), 0);
  const q = new Progress(null, 200);
  q.recordWin(1, 1, 1);
  assert.equal(q.stars(1), 3);
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const t = new Progress(throwing, 200);
  t.recordWin(1, 1, 1);
  assert.equal(t.stars(1), 3);
});

test('reset clears progress but keeps settings', () => {
  const p = new Progress(new MemoryStorage(), 200);
  p.recordWin(1, 1, 1);
  p.setSetting('sfx', false);
  p.reset();
  assert.equal(p.solvedCount(), 0);
  assert.equal(p.setting('sfx'), false);
});
