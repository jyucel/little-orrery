// Little Orrery: application controller.
// Wires screens, HUD, tutorial, progress and audio around the game engine
// and the board renderer.

import { Game, starsFor } from './engine.js';
import { solve } from './solver.js';
import { LEVELS, CHAPTERS } from './levels.js';
import { DAILY } from './daily.js';
import { BoardView } from './render.js';
import { AudioEngine } from './audio.js';
import { Progress, dayKey } from './progress.js';
import { startStarfield } from './starfield.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const PER_CHAPTER = 25;

const STAR_SVG = `<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z" fill="#ffd27a" stroke="#fff1c9" stroke-width="1" stroke-linejoin="round"/></svg>`;
const LOCK_SVG = `<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
const SFX_ON = `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const SFX_OFF = `<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const MUSIC_ON = `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/></svg>`;
const MUSIC_OFF = `<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" opacity=".5"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor" opacity=".5"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const INTROS = {
  locked: {
    title: 'Anchored rings',
    text: 'A ring with a padlock is anchored: it can never spin. Its orbs only change through its bridges, so plan around it.',
  },
  oneway: {
    title: 'One-way rings',
    text: 'Rings marked with arrows only turn clockwise. Going “back” one slot costs a trip almost all the way around.',
  },
  pattern: {
    title: 'Star charts',
    text: 'A ring with colored rims is a star chart: each slot must hold exactly the color of its rim. The other rings still just need to be one color.',
  },
  gear: {
    title: 'Geared rings',
    text: 'Two rings with cogs are chained together: spin one and the other turns the opposite way by the same number of slots.',
  },
};

const INTRO_ART = {
  pattern: `<svg viewBox="0 0 150 120"><circle cx="75" cy="60" r="40" fill="none" stroke="#e3c48b" stroke-opacity=".5" stroke-width="5"/>${[0, 1, 2, 3].map((k) => { const x = 75 + 40 * Math.cos((k * Math.PI) / 2); const y = 60 + 40 * Math.sin((k * Math.PI) / 2); const t = ['#ff6b6b', '#4cc3ff', '#ff6b6b', '#4cc3ff'][k]; const o = ['#ff6b6b', '#4cc3ff', '#4cc3ff', '#ff6b6b'][k]; return `<circle cx="${x}" cy="${y}" r="15" fill="none" stroke="${t}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="10" fill="${o}"/>`; }).join('')}<path d="M75 50l2.5 7.5 7.5 2.5-7.5 2.5-2.5 7.5-2.5-7.5-7.5-2.5 7.5-2.5z" fill="#ffe2a8"/></svg>`,
  locked: `<svg viewBox="0 0 150 120"><circle cx="75" cy="60" r="40" fill="none" stroke="#e3c48b" stroke-opacity=".5" stroke-width="5" stroke-dasharray="9 6"/><circle cx="75" cy="60" r="13" fill="#2a2350" stroke="#9fb0d9" stroke-width="2"/><rect x="69" y="59" width="12" height="9" rx="1.5" fill="#c8d4f2"/><path d="M71.5 59v-3a3.5 3.5 0 0 1 7 0v3" fill="none" stroke="#c8d4f2" stroke-width="2"/>${[0, 1, 2, 3].map((k) => `<circle cx="${75 + 40 * Math.cos((k * Math.PI) / 2)}" cy="${60 + 40 * Math.sin((k * Math.PI) / 2)}" r="11" fill="${['#ff6b6b', '#4cc3ff', '#ff6b6b', '#ff6b6b'][k]}"/>`).join('')}</svg>`,
  oneway: `<svg viewBox="0 0 150 120"><circle cx="75" cy="60" r="40" fill="none" stroke="#e3c48b" stroke-opacity=".5" stroke-width="5"/>${[0, 1, 2, 3].map((k) => { const a = (k * Math.PI) / 2 + Math.PI / 4; const x = 75 + 40 * Math.cos(a); const y = 60 + 40 * Math.sin(a); const d = (a * 180) / Math.PI + 90; return `<path d="M5 0 -4 -5 -1.5 0 -4 5z" fill="#ffe2a8" transform="translate(${x} ${y}) rotate(${d}) scale(1.4)"/>`; }).join('')}${[0, 1, 2, 3].map((k) => `<circle cx="${75 + 40 * Math.cos((k * Math.PI) / 2)}" cy="${60 + 40 * Math.sin((k * Math.PI) / 2)}" r="11" fill="${['#3fdc9a', '#ffbe45', '#3fdc9a', '#3fdc9a'][k]}"/>`).join('')}<path d="M68 52a10 10 0 1 1 0 16" fill="none" stroke="#ffe2a8" stroke-width="3" stroke-linecap="round"/></svg>`,
  gear: `<svg viewBox="0 0 150 120"><line x1="42" y1="60" x2="108" y2="60" stroke="#ffd68c" stroke-opacity=".6" stroke-width="4" stroke-dasharray="6 5"/><circle cx="42" cy="60" r="30" fill="none" stroke="#e3c48b" stroke-opacity=".5" stroke-width="4"/><circle cx="108" cy="60" r="30" fill="none" stroke="#e3c48b" stroke-opacity=".5" stroke-width="4"/><circle cx="42" cy="60" r="9" fill="#d9b46e"/><circle cx="108" cy="60" r="9" fill="#d9b46e"/><path d="M42 22a38 38 0 0 1 30 15" fill="none" stroke="#fff2c4" stroke-width="3" marker-end="url(#a)"/><path d="M108 98a38 38 0 0 1-30-15" fill="none" stroke="#fff2c4" stroke-width="3"/><circle cx="42" cy="30" r="9" fill="#a98bff"/><circle cx="108" cy="90" r="9" fill="#ff7ac8"/></svg>`,
};

class App {
  constructor() {
    this.progress = new Progress(safeStorage(), LEVELS.length);
    this.audio = new AudioEngine();
    this.audio.sfxOn = this.progress.setting('sfx');
    this.audio.musicOn = this.progress.setting('music');
    this.view = new BoardView($('#board'), {
      onAction: (ids, meta) => this.act(ids, meta),
      onInvalid: (kind) => this.invalid(kind),
      onDragStart: () => this.hideHand(),
    });
    this.view.setGlyphs(this.progress.setting('glyphs'));
    this.levelIndex = 0;
    this.game = null;
    this.screen = 'title';
    this.bindUi();
    this.refreshToggles();
    this.renderTitle();
    startStarfield($('#stars'));
    window.addEventListener('resize', () => this.onResize());
    // Deep links like #level=12 (handy for sharing and testing).
    this.openFromHash();
    window.addEventListener('hashchange', () => this.openFromHash());
  }

  openFromHash() {
    if (location.hash === '#daily') {
      if (this.mode !== 'daily' || this.screen !== 'game') this.openDaily();
      return;
    }
    const m = location.hash.match(/level=(\d+)/);
    if (!m) return;
    const id = Number(m[1]);
    if (id >= 1 && id <= LEVELS.length && this.progress.isUnlocked(id)) {
      if (this.mode !== 'level' || this.level.id !== id || this.screen !== 'game') this.openLevel(id - 1);
    } else {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  // ---- screens --------------------------------------------------------------

  show(name) {
    this.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
    if (name === 'game') {
      this.view.start();
      requestAnimationFrame(() => this.onResize());
    } else {
      this.view.stop();
      this.hideHand();
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    }
    if (name === 'title') this.renderTitle();
    if (name === 'levels') this.renderLevels();
  }

  renderTitle() {
    const next = this.progress.continueLevel();
    $('#play-level').textContent = this.progress.solvedCount() ? `Level ${next}` : '';
    const solved = this.progress.solvedCount();
    $('#title-stats').innerHTML = solved
      ? `<b>${solved}</b> / ${LEVELS.length} solved · <b>${this.progress.totalStars()}</b> ★`
      : `${LEVELS.length} puzzles · no ads · plays offline`;
    const streak = this.progress.dailyStreak();
    const done = this.progress.dailyDone();
    $('#daily-sub').textContent = done
      ? `Solved today ✓${streak ? ` · ${streak}-day streak` : ''}`
      : streak
        ? `Keep your ${streak}-day streak alive`
        : 'A fresh puzzle every day';
    $('#btn-daily').classList.toggle('done', done);
  }

  /** Today's daily puzzle (rotates through the pool by calendar day). */
  dailyLevel(day = dayKey()) {
    const days = Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000);
    return DAILY[days % DAILY.length];
  }

  renderLevels() {
    const list = $('#levels-list');
    const current = this.progress.continueLevel();
    $('#levels-stars').textContent = `${this.progress.totalStars()} / ${LEVELS.length * 3} ★`;
    list.innerHTML = CHAPTERS.map((ch, c) => {
      const ids = LEVELS.filter((l) => l.chapter === c).map((l) => l.id);
      const stars = ids.reduce((a, id) => a + this.progress.stars(id), 0);
      const buttons = ids
        .map((id) => {
          const unlocked = this.progress.isUnlocked(id);
          const st = this.progress.stars(id);
          const cls = ['lvl', st ? 'solved' : '', unlocked ? '' : 'locked', id === current ? 'current' : ''].join(' ');
          const starRow = `<span class="s">${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i></span>`;
          return `<button class="${cls}" data-level="${id}" ${unlocked ? '' : 'disabled aria-disabled="true"'} aria-label="Level ${id}${st ? `, ${st} stars` : ''}${unlocked ? '' : ', locked'}">${
            unlocked ? `${id}${starRow}` : LOCK_SVG
          }</button>`;
        })
        .join('');
      return `<section class="chapter"><div class="chapter-head"><span class="num">${toRoman(c + 1)}</span><h3>${ch.name}</h3><span class="cstars">${stars} / ${ids.length * 3} ★</span></div><p class="chapter-blurb">${ch.blurb}</p><div class="grid">${buttons}</div></section>`;
    }).join('');
    const cur = list.querySelector('.lvl.current');
    // scroll only the list (scrollIntoView would also scroll the fixed page)
    if (cur) requestAnimationFrame(() => (list.scrollTop = cur.offsetTop - list.offsetTop - list.clientHeight / 2));
  }

  // ---- level flow -----------------------------------------------------------

  openLevel(index) {
    this.mode = 'level';
    this.levelIndex = index;
    const level = LEVELS[index];
    this.progress.setLast(level.id);
    $('#hud-level').textContent = `Level ${level.id}`;
    $('#hud-chapter').textContent = `${toRoman(level.chapter + 1)} · ${CHAPTERS[level.chapter].name}`;
    this.startBoard(level);
    history.replaceState(null, '', `#level=${level.id}`);
  }

  openDaily() {
    this.mode = 'daily';
    this.day = dayKey();
    const level = this.dailyLevel(this.day);
    $('#hud-level').textContent = 'Daily Orrery';
    $('#hud-chapter').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    this.startBoard(level);
    history.replaceState(null, '', '#daily');
  }

  startBoard(level) {
    this.level = level;
    this.game = new Game(level);
    this.won = false;
    $('#hud-par').textContent = level.par;
    $('#hud-limit').textContent = level.limit;
    this.closeModal('#modal-win');
    this.closeModal('#modal-out');
    this.show('game');
    this.view.inputEnabled = true;
    this.view.setLevel(level, this.game);
    this.updateHud();
    this.setupTutorial();

    // introduce each mechanism the first time it appears
    const present = {
      locked: level.rings.some((r) => r.locked),
      oneway: level.rings.some((r) => r.oneway),
      gear: !!(level.gears && level.gears.length),
      pattern: level.rings.some((r) => r.pattern),
    };
    const intro = Object.keys(present).find((k) => present[k] && !this.progress.hasSeen(k));
    if (intro) this.showIntro(intro);
  }

  act(ids, meta = {}) {
    if (!this.game || this.won) return false;
    const before = this.level.rings.map((_, r) => this.game.ringSolved(r));
    if (!this.game.play(ids)) {
      if (this.game.moveCount + ids.length > this.game.limit) {
        this.audio.invalid();
        this.toast(this.game.movesLeft ? `Only ${this.game.movesLeft} move${this.game.movesLeft === 1 ? '' : 's'} left` : 'Out of moves. Undo or restart.');
      }
      return false;
    }
    this.view.animate(ids, meta);
    // sound: one tick per slot, staggered so multi-step drags "click" through
    const first = this.game.byId.get(ids[0]);
    if (first.type === 'swap') this.audio.swap();
    else ids.forEach((_, i) => setTimeout(() => this.audio.spin(first.ring, i), meta.drag ? i * 25 : i * 60));
    this.level.rings.forEach((_, r) => {
      if (!before[r] && this.game.ringSolved(r) && !this.game.solved) {
        this.audio.ringDone(r);
        this.view.burst(r);
      }
    });
    this.view.showHint(null);
    this.updateHud(true);
    if (this.game.solved) this.onWin();
    else {
      this.updateTutorial();
      if (this.game.outOfMoves) {
        clearTimeout(this.outTimer);
        this.outTimer = setTimeout(() => {
          if (this.game.outOfMoves && this.screen === 'game') this.openModal('#modal-out');
        }, 450);
      }
    }
    return true;
  }

  undo() {
    if (!this.game || this.won) return;
    this.closeModal('#modal-out');
    const last = this.game.undo();
    if (!last) return this.toast('Nothing to undo');
    this.view.animate(last.ids, { reverse: true });
    this.audio.undo();
    this.updateHud();
    this.updateTutorial();
  }

  restart() {
    if (!this.game || this.won) return;
    this.closeModal('#modal-out');
    if (!this.game.history.length) return;
    this.game.restart();
    this.view.resetAnimation();
    this.audio.undo();
    this.updateHud();
    this.updateTutorial();
  }

  hint() {
    if (!this.game || this.won) return;
    const free = this.mode === 'level' && this.level.id <= 3;
    if (!free && this.progress.hints <= 0) {
      this.toast('No hints left. Earn one with each new ★★★ or daily puzzle.');
      this.audio.invalid();
      return;
    }
    const res = solve(this.level, this.game.cells, { maxNodes: 1_500_000 });
    if (!res || !res.path.length) {
      this.toast('Too tangled for a hint. Try Undo or Restart.');
      return;
    }
    if (res.length > this.game.movesLeft) {
      this.toast(`Can’t finish within the limit from here (${res.length} needed). Undo or restart.`);
      return;
    }
    if (!free) this.progress.useHint();
    this.view.showHint(res.path[0]);
    this.toast(`${res.length} move${res.length === 1 ? '' : 's'} from here at best`);
    this.audio.click();
    this.updateHud();
  }

  invalid(kind) {
    this.audio.invalid();
    if (navigator.vibrate) navigator.vibrate(30);
    this.toast(kind === 'locked' ? 'Anchored rings can’t spin' : 'This ring only turns clockwise');
  }

  onWin() {
    this.won = true;
    this.view.inputEnabled = false;
    this.hideHand();
    if (this.tutorial) $('#coach').innerHTML = 'Beautiful! Every ring is <b>one color</b>.';
    this.view.celebrate();
    this.audio.win();
    const moves = this.game.moveCount;
    const res =
      this.mode === 'daily'
        ? this.progress.recordDaily(this.day, moves, this.level.par, this.level.limit)
        : this.progress.recordWin(this.level.id, moves, this.level.par, this.level.limit);
    clearTimeout(this.winTimer);
    this.winTimer = setTimeout(() => this.showWin(moves, res), 1100);
  }

  showWin(moves, res) {
    const par = this.level.par;
    const daily = this.mode === 'daily';
    const last = !daily && this.levelIndex === LEVELS.length - 1;
    const chapterEnd = !daily && (this.levelIndex + 1) % PER_CHAPTER === 0;
    $('#win-stars').innerHTML = [0, 1, 2].map(() => STAR_SVG).join('');
    $$('#win-stars svg').forEach((s, i) => {
      s.style.animationDelay = `${0.15 + i * 0.18}s`;
      s.classList.add(i < res.stars ? 'on' : 'off');
    });
    const titles = ['Solved!', 'Solved!', 'Nicely done!', 'Perfect alignment!'];
    $('#win-title').textContent = daily
      ? 'Daily Orrery solved!'
      : last
        ? 'The Grand Orrery turns!'
        : chapterEnd
          ? `${CHAPTERS[this.level.chapter].name} complete!`
          : titles[res.stars];
    $('#win-detail').innerHTML =
      `<b>${moves}</b> move${moves === 1 ? '' : 's'} · par <b>${par}</b>` +
      (res.stars < 3 ? `<br>Solve it in ${par} for three stars.` : moves < par ? '<br>Under par?! Remarkable.' : '');
    const notes = [];
    if (daily) notes.push(`🔥 ${res.streak}-day streak`);
    if (!daily && res.prevBest !== null && res.newBest) notes.push(`New best! (was ${res.prevBest})`);
    if (res.hintEarned || (daily && res.first)) notes.push('+1 hint');
    if (last) notes.push(`You solved all ${LEVELS.length} puzzles. Thank you for playing!`);
    $('#win-best').textContent = notes.join(' · ');
    $('#win-next').hidden = last || daily;
    $('#win-replay').hidden = daily;
    this.openModal('#modal-win');
    setTimeout(() => (last || daily ? $('#win-levels') : $('#win-next')).focus(), 50);
  }

  next() {
    if (this.mode === 'level' && this.levelIndex < LEVELS.length - 1) this.openLevel(this.levelIndex + 1);
  }

  updateHud(bump = false) {
    const g = this.game;
    const el = $('#hud-moves');
    el.textContent = g.moveCount;
    if (bump) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }
    $('.hud-moves').classList.toggle('low', g.movesLeft <= 2);
    const st = starsFor(g.moveCount, this.level.par, this.level.limit);
    $('#hud-stars').innerHTML = `${'★'.repeat(st)}<i>${'★'.repeat(3 - st)}</i>`;
    $('#btn-undo').disabled = !g.history.length;
    $('#btn-restart').disabled = !g.history.length;
    const free = this.mode === 'level' && this.level.id <= 3;
    $('#hint-count').textContent = free ? '∞' : this.progress.hints;
  }

  // ---- tutorial ---------------------------------------------------------------

  setupTutorial() {
    const id = this.level.id;
    this.tutorial = this.mode === 'level' && id <= 3 ? id : 0;
    this.updateTutorial();
  }

  updateTutorial() {
    const coach = $('#coach');
    if (!this.tutorial || this.won) {
      if (!coach.hidden && !this.won) {
        coach.hidden = true;
        this.view.layout();
      }
      this.hideHand();
      return;
    }
    const g = this.game;
    let text = '';
    let point = null;
    const sol = solve(this.level, g.cells, { maxNodes: 50_000 });
    const nextMove = sol && sol.path[0];
    if (this.tutorial === 1) {
      text = 'Make every ring <b>one color</b>. Tap the glowing <b>bridge</b> to swap the two orbs it joins.';
      point = nextMove;
    } else if (this.tutorial === 2) {
      if (nextMove && nextMove[0] === 'r') {
        text = '<b>Tap a ring</b> to spin it one slot clockwise, or <b>drag</b> it around either way.';
      } else {
        text = 'Lined up! Now <b>swap</b> across the bridge.';
      }
      point = nextMove;
    } else {
      text = g.moveCount
        ? 'Stuck? <b>Undo</b>, <b>Restart</b> or ask for a <b>Hint</b> below.'
        : 'Moves are limited (top right). Match <b>par</b>, the fewest possible, for <b>three stars</b>.';
    }
    coach.innerHTML = text;
    if (coach.hidden) {
      coach.hidden = false;
      this.view.layout(); // the board area just shrank
    }
    if (point) {
      this.view.showHint(point, true);
      this.handTarget = point;
      this.placeHand();
    } else {
      this.hideHand();
    }
  }

  placeHand() {
    if (!this.handTarget || this.screen !== 'game') return;
    const p = this.view.clientPointFor(this.handTarget);
    const hand = $('#hand');
    hand.style.left = `${p.x}px`;
    hand.style.top = `${p.y}px`;
    hand.hidden = false;
  }

  hideHand() {
    this.handTarget = null;
    $('#hand').hidden = true;
  }

  // ---- modals & misc --------------------------------------------------------------

  showIntro(key) {
    $('#intro-title').textContent = INTROS[key].title;
    $('#intro-text').textContent = INTROS[key].text;
    $('#intro-art').innerHTML = INTRO_ART[key];
    this.introKey = key;
    this.openModal('#modal-intro');
  }

  openModal(sel) {
    $(sel).hidden = false;
    this.modal = sel;
  }

  closeModal(sel) {
    $(sel).hidden = true;
    if (this.modal === sel) this.modal = null;
  }

  toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
  }

  refreshToggles() {
    $$('[data-toggle="sfx"]').forEach((b) => {
      const on = this.progress.setting('sfx');
      b.innerHTML = on ? SFX_ON : SFX_OFF;
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', String(on));
    });
    $$('[data-toggle="music"]').forEach((b) => {
      const on = this.progress.setting('music');
      b.innerHTML = on ? MUSIC_ON : MUSIC_OFF;
      b.classList.toggle('off', !on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('#set-sfx').checked = this.progress.setting('sfx');
    $('#set-music').checked = this.progress.setting('music');
    $('#set-glyphs').checked = this.progress.setting('glyphs');
  }

  setSfx(on) {
    this.progress.setSetting('sfx', on);
    this.audio.setSfx(on);
    this.refreshToggles();
  }

  setMusic(on) {
    this.progress.setSetting('music', on);
    this.audio.setMusic(on);
    this.refreshToggles();
  }

  onResize() {
    if (this.screen !== 'game') return;
    this.view.layout();
    if (this.handTarget) this.placeHand();
  }

  bindUi() {
    // first gesture unlocks audio
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    $('#btn-play').addEventListener('click', () => this.openLevel(this.progress.continueLevel() - 1));
    $('#btn-daily').addEventListener('click', () => this.openDaily());
    $('#out-undo').addEventListener('click', () => this.undo());
    $('#out-restart').addEventListener('click', () => this.restart());
    $('#btn-levels').addEventListener('click', () => this.show('levels'));
    $('#btn-help').addEventListener('click', () => this.openModal('#modal-help'));
    $('#btn-settings').addEventListener('click', () => this.openModal('#modal-settings'));
    $$('[data-nav="title"]').forEach((b) => b.addEventListener('click', () => this.show('title')));
    $('#btn-back').addEventListener('click', () => this.show(this.mode === 'daily' ? 'title' : 'levels'));
    $('#levels-list').addEventListener('click', (e) => {
      const b = e.target.closest('.lvl');
      if (!b || b.disabled) return;
      this.audio.click();
      this.openLevel(Number(b.dataset.level) - 1);
    });
    $('#btn-undo').addEventListener('click', () => this.undo());
    $('#btn-restart').addEventListener('click', () => this.restart());
    $('#btn-hint').addEventListener('click', () => this.hint());
    $('#win-next').addEventListener('click', () => this.next());
    $('#win-replay').addEventListener('click', () => this.openLevel(this.levelIndex));
    $('#win-levels').addEventListener('click', () => {
      this.closeModal('#modal-win');
      this.show(this.mode === 'daily' ? 'title' : 'levels');
    });
    $('#intro-ok').addEventListener('click', () => {
      this.progress.markSeen(this.introKey);
      this.closeModal('#modal-intro');
    });
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => this.closeModal(`#${b.closest('.modal').id}`)));
    $$('[data-toggle="sfx"]').forEach((b) => b.addEventListener('click', () => this.setSfx(!this.progress.setting('sfx'))));
    $$('[data-toggle="music"]').forEach((b) => b.addEventListener('click', () => this.setMusic(!this.progress.setting('music'))));
    $('#set-sfx').addEventListener('change', (e) => this.setSfx(e.target.checked));
    $('#set-music').addEventListener('change', (e) => this.setMusic(e.target.checked));
    $('#set-glyphs').addEventListener('change', (e) => {
      this.progress.setSetting('glyphs', e.target.checked);
      this.view.setGlyphs(e.target.checked);
    });
    $('#btn-reset').addEventListener('click', () => {
      if (!confirm('Reset all progress and stars?')) return;
      this.progress.reset();
      this.renderTitle();
      this.toast('Progress reset');
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.modal && this.modal !== '#modal-win' && this.modal !== '#modal-out') return this.closeModal(this.modal);
        if (this.screen === 'game') return this.show(this.mode === 'daily' ? 'title' : 'levels');
        if (this.screen === 'levels') return this.show('title');
        return;
      }
      const k = e.key.toLowerCase();
      if (this.modal === '#modal-out' && (k === 'z' || k === 'r' || k === 'backspace')) this.closeModal('#modal-out');
      if (this.screen !== 'game' || this.modal) return;
      if (k === 'z' || k === 'backspace') this.undo();
      else if (k === 'r') this.restart();
      else if (k === 'h') this.hint();
    });
  }
}

function toRoman(n) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
}

function safeStorage() {
  try {
    const s = window.localStorage;
    const k = '__lo_test';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

window.__orrery = new App();
