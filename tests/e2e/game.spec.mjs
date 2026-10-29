// End-to-end tests: drive the real game in a browser with real pointer input.
import { test, expect } from '@playwright/test';

const KEY = 'little-orrery.v1';

/** Seed saved progress before the page loads (all levels up to `upTo` solved). */
async function seedProgress(page, upTo, extra = {}) {
  await page.addInitScript(
    ([key, n, extra]) => {
      const stars = {};
      for (let i = 1; i <= n; i++) stars[i] = 3;
      localStorage.setItem(
        key,
        JSON.stringify({ v: 1, stars, best: {}, seen: extra.seen || {}, last: 1, settings: { sfx: true, music: false, glyphs: true } }),
      );
    },
    [KEY, upTo, extra],
  );
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Firefox reports in-flight work aborted by a test navigation this way
    if (m.type() === 'error' && !m.text().includes('Navigated away from page')) errors.push(m.text());
  });
  return errors;
}

async function openLevel(page, id) {
  await page.goto(`./#level=${id}`);
  await expect(page.locator('#screen-game')).toHaveClass(/active/);
  await expect(page.locator('#hud-level')).toHaveText(`Level ${id}`);
  const intro = page.locator('#modal-intro');
  if (await intro.isVisible()) await page.click('#intro-ok');
  await page.waitForTimeout(150); // let layout settle
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__orrery.game;
    return { cells: g.cells.join(''), initial: g.initial.join(''), moves: g.moveCount, solved: g.solved };
  });

/** Screen point for a move target (bridge button or ring centre). */
const pointFor = (page, id) => page.evaluate((id) => window.__orrery.view.clientPointFor(id), id);

/** Drag ring `r` by `steps` slots (negative = counter-clockwise) with the mouse. */
async function dragRing(page, r, steps) {
  const geo = await page.evaluate((r) => {
    const v = window.__orrery.view;
    const ring = v.geo.rings[r];
    const rect = v.canvas.getBoundingClientRect();
    const [cx, cy] = v.px(ring.x, ring.y);
    return { cx: rect.left + cx, cy: rect.top + cy, R: ring.r * v.s * 0.62, n: ring.n };
  }, r);
  const a0 = -Math.PI / 2 + 0.3;
  const total = (steps * 2 * Math.PI) / geo.n;
  const pt = (a) => [geo.cx + Math.cos(a) * geo.R, geo.cy + Math.sin(a) * geo.R];
  await page.mouse.move(...pt(a0));
  await page.mouse.down();
  const N = 6 * Math.abs(steps);
  for (let i = 1; i <= N; i++) await page.mouse.move(...pt(a0 + (total * i) / N));
  await page.mouse.up();
}

/** Perform one move id through real input: taps for swaps and clockwise turns, drags for counter-clockwise. */
async function input(page, id, touch) {
  if (id.endsWith('-')) return dragRing(page, parseInt(id.slice(1), 10), -1);
  const p = await pointFor(page, id);
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

test('title screen loads cleanly with relative assets under a sub-path', async ({ page }) => {
  const errors = trackErrors(page);
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto('./');
  await expect(page.locator('h1.logo')).toContainText('Little');
  await expect(page.locator('#btn-play')).toBeVisible();
  await expect(page.locator('#title-stats')).toContainText('250 puzzles');
  await expect(page.locator('#btn-daily')).toBeVisible();
  await page.waitForTimeout(300);
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});

test('tutorial: level 1 is won by tapping the bridge, then progress is saved', async ({ page, isMobile }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await page.click('#btn-play');
  await expect(page.locator('#hud-level')).toHaveText('Level 1');
  await expect(page.locator('#coach')).toContainText('one color');
  await expect(page.locator('#hand')).toBeVisible();
  await input(page, 'b0', isMobile);
  await expect(page.locator('#modal-win')).toBeVisible();
  await expect(page.locator('#win-stars svg.on')).toHaveCount(3);
  await expect(page.locator('#win-detail')).toContainText('1 move');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(saved.stars['1']).toBe(3);

  // Next level opens, and the tutorial continues
  await page.click('#win-next');
  await expect(page.locator('#hud-level')).toHaveText('Level 2');
  await expect(page.locator('#coach')).toContainText('Tap a ring');

  // Reload: progress survives, level select reflects it
  await page.goto('./');
  await page.click('#btn-levels');
  await expect(page.locator('.lvl[data-level="1"]')).toHaveClass(/solved/);
  await expect(page.locator('.lvl[data-level="4"]')).toBeEnabled();
  await expect(page.locator('.lvl[data-level="5"]')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('tutorial level 2: spin then swap', async ({ page, isMobile }) => {
  await seedProgress(page, 1);
  await openLevel(page, 2);
  const lv = await page.evaluate(() => window.__orrery.level.solution);
  for (const id of lv) await input(page, id, isMobile);
  await expect(page.locator('#modal-win')).toBeVisible();
  await expect(page.locator('#win-stars svg.on')).toHaveCount(3);
});

test('undo and restart buttons restore earlier states', async ({ page, isMobile }) => {
  await seedProgress(page, 20);
  await openLevel(page, 12);
  const s0 = await state(page);
  await expect(page.locator('#btn-undo')).toBeDisabled();
  await input(page, 'r0+', isMobile);
  const s1 = await state(page);
  expect(s1.moves).toBe(1);
  expect(s1.cells).not.toBe(s0.cells);
  await expect(page.locator('#hud-moves')).toHaveText('1');
  await page.click('#btn-undo');
  expect(await state(page)).toEqual(s0);
  await expect(page.locator('#hud-moves')).toHaveText('0');

  await input(page, 'r0+', isMobile);
  await input(page, 'b0', isMobile);
  await input(page, 'r1+', isMobile);
  expect((await state(page)).moves).toBe(3);
  await page.click('#btn-undo');
  expect((await state(page)).moves).toBe(2);
  await page.click('#btn-restart');
  const s2 = await state(page);
  expect(s2.cells).toBe(s0.initial);
  expect(s2.moves).toBe(0);
  await expect(page.locator('#btn-restart')).toBeDisabled();
});

test('dragging a ring turns it counter-clockwise and counts slots as moves', async ({ page }) => {
  await seedProgress(page, 20);
  await openLevel(page, 15);
  const expected = await page.evaluate(() => {
    const g = window.__orrery.game;
    const perm = g.byId.get('r0-').perm;
    const once = perm.map((i) => g.cells[i]);
    return { one: once.join(''), two: perm.map((i) => once[i]).join('') };
  });
  await dragRing(page, 0, -1);
  let s = await state(page);
  expect(s.cells).toBe(expected.one);
  expect(s.moves).toBe(1);
  await dragRing(page, 0, -1);
  s = await state(page);
  expect(s.cells).toBe(expected.two);
  expect(s.moves).toBe(2);
  // one drag action is one undo step
  await page.click('#btn-undo');
  expect((await state(page)).cells).toBe(expected.one);
});

test('keyboard shortcuts: Z undoes, R restarts', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard is a desktop feature');
  await seedProgress(page, 20);
  await openLevel(page, 9);
  const s0 = await state(page);
  await input(page, 'r1+', false);
  await page.keyboard.press('z');
  expect(await state(page)).toEqual(s0);
  await input(page, 'b0', false);
  await input(page, 'b0', false);
  await page.keyboard.press('r');
  expect(await state(page)).toEqual(s0);
});

for (const id of [7, 33, 61, 88, 112, 140, 163, 190, 215, 250]) {
  test(`level ${id} can be solved at par through real input`, async ({ page, isMobile }) => {
    const errors = trackErrors(page);
    await seedProgress(page, id - 1);
    await openLevel(page, id);
    const { solution, par } = await page.evaluate(() => window.__orrery.level);
    for (const mv of solution) {
      expect((await state(page)).solved).toBe(false);
      await input(page, mv, isMobile);
    }
    await expect(page.locator('#modal-win')).toBeVisible();
    await expect(page.locator('#win-detail')).toContainText(`${par} move`);
    await expect(page.locator('#win-stars svg.on')).toHaveCount(3);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
    expect(saved.stars[String(id)]).toBe(3);
    expect(saved.best[String(id)]).toBe(par);
    if (id === 250) {
      await expect(page.locator('#win-title')).toContainText('Grand Orrery');
      await expect(page.locator('#win-next')).toBeHidden();
    }
    expect(errors).toEqual([]);
  });
}

test('anchored rings refuse to spin and say why', async ({ page, isMobile }) => {
  await seedProgress(page, 80, { seen: { locked: true } });
  await page.goto('./');
  const target = await page.evaluate(async () => {
    const { LEVELS } = await import('./js/levels.js');
    const l = LEVELS.find((l) => l.chapter === 3 && l.rings.some((r) => r.locked));
    return { id: l.id, ring: l.rings.findIndex((r) => r.locked) };
  });
  await openLevel(page, target.id);
  const s0 = await state(page);
  await input(page, `r${target.ring}+`, isMobile);
  await expect(page.locator('#toast')).toContainText('Anchored');
  expect(await state(page)).toEqual(s0);
});

test('one-way rings refuse counter-clockwise drags', async ({ page }) => {
  await seedProgress(page, 110, { seen: { oneway: true } });
  await page.goto('./');
  const target = await page.evaluate(async () => {
    const { LEVELS } = await import('./js/levels.js');
    const l = LEVELS.find((l) => l.chapter === 4 && l.rings.some((r) => r.oneway));
    return { id: l.id, ring: l.rings.findIndex((r) => r.oneway) };
  });
  await openLevel(page, target.id);
  const s0 = await state(page);
  await dragRing(page, target.ring, -1);
  await expect(page.locator('#toast')).toContainText('clockwise');
  expect(await state(page)).toEqual(s0);
});

test('mechanism intro appears once for a new chapter', async ({ page }) => {
  await seedProgress(page, 75);
  await page.goto('./#level=76');
  await expect(page.locator('#modal-intro')).toBeVisible();
  await expect(page.locator('#intro-title')).toHaveText('Anchored rings');
  await page.click('#intro-ok');
  await page.goto('./#level=77');
  await page.waitForTimeout(200);
  await expect(page.locator('#modal-intro')).toBeHidden();
});

test('hint points at a useful move and costs a hint token', async ({ page }) => {
  await seedProgress(page, 40);
  await openLevel(page, 41);
  await expect(page.locator('#hint-count')).toHaveText('3');
  await page.click('#btn-hint');
  await expect(page.locator('#toast')).toContainText('from here');
  await expect(page.locator('#hint-count')).toHaveText('2');
  const hint = await page.evaluate(() => window.__orrery.view.hint && window.__orrery.view.hint.id);
  expect(hint).toBeTruthy();
  const ok = await page.evaluate((h) => window.__orrery.game.canPlay(h), hint);
  expect(ok).toBe(true);
});

test('locked levels cannot be opened from level select or deep link', async ({ page }) => {
  await page.goto('./#level=150');
  await expect(page.locator('#screen-title')).toHaveClass(/active/);
  await page.click('#btn-levels');
  await expect(page.locator('.lvl')).toHaveCount(250);
  await expect(page.locator('.lvl.locked')).toHaveCount(247);
  await page.locator('.lvl[data-level="2"]').click();
  await expect(page.locator('#hud-level')).toHaveText('Level 2');
  await page.click('#btn-back');
  await expect(page.locator('#screen-levels')).toHaveClass(/active/);
});

test('sound and music toggles persist', async ({ page }) => {
  await page.goto('./');
  await page.locator('#screen-title [data-toggle="sfx"]').click();
  await page.locator('#screen-title [data-toggle="music"]').click();
  await expect(page.locator('#screen-title [data-toggle="sfx"]')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#screen-title [data-toggle="sfx"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#screen-title [data-toggle="music"]')).toHaveAttribute('aria-pressed', 'false');
  const audio = await page.evaluate(() => ({ s: window.__orrery.audio.sfxOn, m: window.__orrery.audio.musicOn }));
  expect(audio).toEqual({ s: false, m: false });
});

test('layout fits the viewport with touch-sized controls', async ({ page }) => {
  await seedProgress(page, 250);
  for (const id of [1, 100, 181, 250]) {
    await openLevel(page, id);
    const m = await page.evaluate(() => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
      const v = window.__orrery.view;
      // every orb must be inside the canvas
      let inside = true;
      v.level.rings.forEach((ring, r) => {
        for (let k = 0; k < ring.n; k++) {
          const [ux, uy] = v.slotPoint(r, k);
          const [x, y] = v.px(ux, uy);
          if (x < 0 || y < 0 || x > v.W || y > v.H) inside = false;
        }
      });
      return {
        overflowX: document.documentElement.scrollWidth > vw,
        vw,
        vh,
        board: rect('#board'),
        undo: rect('#btn-undo'),
        hint: rect('#btn-hint'),
        hud: rect('#hud-moves'),
        inside,
        orbPx: 0.8 * v.s,
      };
    });
    expect(m.overflowX).toBe(false);
    expect(m.inside).toBe(true);
    expect(m.undo.bottom).toBeLessThanOrEqual(m.vh);
    expect(m.undo.height).toBeGreaterThanOrEqual(44);
    expect(m.hint.right).toBeLessThanOrEqual(m.vw);
    expect(m.hud.right).toBeLessThanOrEqual(m.vw);
    expect(m.board.height).toBeGreaterThan(m.vh * 0.45);
    expect(m.orbPx).toBeGreaterThan(24);
  }
});

test('running out of moves blocks further moves until undo or restart', async ({ page, isMobile }) => {
  await seedProgress(page, 40);
  await openLevel(page, 30);
  const limit = await page.evaluate(() => window.__orrery.level.limit);
  await expect(page.locator('#hud-limit')).toHaveText(String(limit));
  for (let i = 0; i < limit; i++) await input(page, 'r0+', isMobile);
  await expect(page.locator('#modal-out')).toBeVisible();
  expect((await state(page)).moves).toBe(limit);
  await page.click('#out-undo');
  await expect(page.locator('#modal-out')).toBeHidden();
  expect((await state(page)).moves).toBe(limit - 1);
  await input(page, 'r0+', isMobile);
  await expect(page.locator('#modal-out')).toBeVisible();
  await page.click('#out-restart');
  expect((await state(page)).moves).toBe(0);
});

test('daily puzzle: playable from the title, records a streak and grants a hint', async ({ page, isMobile }) => {
  await seedProgress(page, 0, { seen: { locked: true, oneway: true, gear: true, pattern: true } });
  await page.goto('./');
  await expect(page.locator('#daily-sub')).toContainText('fresh puzzle');
  await page.click('#btn-daily');
  await expect(page.locator('#hud-level')).toHaveText('Daily Orrery');
  await page.waitForTimeout(150);
  const solution = await page.evaluate(() => window.__orrery.level.solution);
  for (const mv of solution) await input(page, mv, isMobile);
  await expect(page.locator('#modal-win')).toBeVisible();
  await expect(page.locator('#win-title')).toContainText('Daily');
  await expect(page.locator('#win-best')).toContainText('1-day streak');
  await expect(page.locator('#win-next')).toBeHidden();
  await page.click('#win-levels');
  await expect(page.locator('#screen-title')).toHaveClass(/active/);
  await expect(page.locator('#daily-sub')).toContainText('Solved today');
  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  expect(saved.daily.streak).toBe(1);
  expect(saved.hints).toBe(4);
});

test('star chart intro appears and chart rings render', async ({ page }) => {
  await seedProgress(page, 150);
  await page.goto('./#level=151');
  await expect(page.locator('#modal-intro')).toBeVisible();
  await expect(page.locator('#intro-title')).toHaveText('Star charts');
  await page.click('#intro-ok');
  const hasChart = await page.evaluate(() => window.__orrery.level.rings.some((r) => r.pattern));
  expect(hasChart).toBe(true);
});
