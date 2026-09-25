/** Wires the deck to the page: render two cards, take a guess, keep a streak. */

import { createDeck, draw, verdict, formatPrice, makeRng, seedFrom, dayKey,
  yearRange, withinYears } from './deck.js';

/** How long the revealed price stays up before the board moves on. */
const REVEAL_MS = 1600;
const SLIDE_MS = 420;
const BEST_KEY = 'baa:best';
const YEARS_KEY = 'baa:years';

/** Below this the deck cannot keep dealing fair pairs without repeating. */
const MIN_CARDS = 60;

/** Keeps the two thumbs from landing on the same year, where neither could be
 *  grabbed to pull them apart again. */
const MIN_SPAN = 5;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* Menu scans ------------------------------------------------------------- */

const PAGE_URL = 'https://images.nypl.org/index.php?id={id}&t=w';

/** NYPL serves the scans over IIIF, and MenuItem.xpos/ypos say where on the
 *  page the dish was printed, so each card can show a clipping of its own
 *  line rather than the whole page. */
const CLIP_URL = 'https://iiif.nypl.org/iiif/2/{id}/pct:{x},{y},45,4.5/700,/0/default.jpg';

const pageUrl = (card) => PAGE_URL.replace('{id}', card.image_id);

function clipUrl(card) {
  const x = Math.max(0, card.x * 100 - 3).toFixed(2);
  const y = Math.max(0, card.y * 100 - 2).toFixed(2);
  return CLIP_URL.replace('{id}', card.image_id).replace('{x}', x).replace('{y}', y);
}

const el = {
  board: document.getElementById('board'),
  left: document.getElementById('left'),
  right: document.getElementById('right'),
  streak: document.getElementById('streak'),
  best: document.getElementById('best'),
  bestWrap: document.getElementById('best-wrap'),
  prompt: document.getElementById('prompt'),
  higher: document.getElementById('higher'),
  lower: document.getElementById('lower'),
  controls: document.getElementById('controls'),
  gameover: document.getElementById('gameover'),
  finalStreak: document.getElementById('final-streak'),
  finalNote: document.getElementById('final-note'),
  share: document.getElementById('share'),
  again: document.getElementById('again'),
  status: document.getElementById('status'),
  modeDaily: document.getElementById('mode-daily'),
  modeEndless: document.getElementById('mode-endless'),
  modeNote: document.getElementById('mode-note'),
  years: document.getElementById('years'),
  yearFrom: document.getElementById('year-from'),
  yearTo: document.getElementById('year-to'),
  rangeLabel: document.getElementById('range-label'),
  rangeFill: document.getElementById('range-fill'),
  yearsCount: document.getElementById('years-count'),
  bestLabel: document.getElementById('best-label'),
};

const state = {
  deck: null, left: null, right: null, streak: 0, best: 0, locked: true,
  all: [],            // every card, unfiltered
  mode: 'daily',      // 'daily' | 'endless'
  day: dayKey(),
  bounds: [0, 0],     // the years the data actually covers
  from: 0, to: 0,     // the years the player has chosen, endless only
  saved: {},          // a parked run per mode, so the toggle is not a reset
};

/* Best streak ------------------------------------------------------------ */
// localStorage throws in a private window or with site data blocked, and the
// game works fine without it, so every access is optional.

/** Endless keeps one all-time best; the daily keeps its record per day, so
 *  yesterday's score does not sit next to today's cards. */
function dailyKey() {
  return `baa:daily:${state.day}`;
}

/** Today's attempt: how far it got, and whether it is over.
 *
 * Stored rather than held in memory so the one attempt survives a reload --
 * otherwise refreshing would hand out a second go at the same puzzle. Older
 * builds stored a bare number here; treat that as a finished run.
 */
function readDaily() {
  const raw = readStore(dailyKey());
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (typeof value === 'number') return { s: value, done: true };
    return (value && typeof value.s === 'number') ? value : null;
  } catch {
    const n = Number(raw);
    return Number.isFinite(n) ? { s: n, done: true } : null;
  }
}

function writeDaily(streak, done) {
  writeStore(dailyKey(), JSON.stringify({ s: streak, done }));
}

function readStore(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch { /* not worth telling the player about */ }
}

function loadBest() {
  return Number(readStore(BEST_KEY)) || 0;
}

function saveBest(value) {
  writeStore(BEST_KEY, String(value));
}

/** Only endless has a best worth keeping: the daily is a single attempt, so
 *  its streak is its score and a second number beside it means nothing. */
function showBest() {
  el.best.textContent = state.best;
  el.bestLabel.textContent = 'Best';
  el.bestWrap.hidden = state.mode === 'daily' || state.best === 0;
}

/* Rendering -------------------------------------------------------------- */

/** Link the dish to the scan of the menu page it was printed on.
 *
 * Only ever the card whose price is already known: the scan shows the prices,
 * so linking the card being guessed would hand over the answer. Opens in a new
 * tab, since navigating away would throw the run away.
 */
function linkDish(node, card) {
  const link = document.createElement('a');
  link.className = 'dish-link';
  link.href = pageUrl(card);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = card.dish;          // never innerHTML; these come from a CSV
  link.title = `See the ${card.year} menu from ${card.restaurant}`;
  link.setAttribute('aria-label',
    `${card.dish}. See the ${card.year} menu from ${card.restaurant}, opens in a new tab.`);
  node.replaceChildren(link);
}

/** `price` shows the number on the menu; `fact` converts it to today's money.
 *  PLAN puts the conversion on the reveal only -- the card to beat shows one
 *  number, so there is no question which price is being compared. */
function paint(root, card,
               { price: showPrice = false, fact: showFact = false,
                 link: showLink = false } = {}) {
  // Clear last round's verdict here, not at the call sites -- a stale is-wrong
  // surviving into a new game turns a correct first guess red.
  root.classList.remove('is-right', 'is-wrong');
  const dish = root.querySelector('.dish');
  if (showLink) {
    linkDish(dish, card);
  } else {
    dish.textContent = card.dish;
  }
  root.querySelector('.restaurant').textContent = card.restaurant;
  // Menu.place is recorded for only about a third of menus.
  const place = root.querySelector('.place');
  place.textContent = card.place || '';
  place.hidden = !card.place;
  root.querySelector('.year').textContent = card.year;

  // The clipping shows the printed line, price and all, so it stays blurred
  // on the card being guessed until its price is out in the open anyway.
  const clip = root.querySelector('.clip');
  const img = clip.querySelector('img');
  const src = clipUrl(card);
  if (img.getAttribute('src') !== src) {
    clip.classList.remove('is-failed');
    // Keep the box either way, so a scan that will not load does not make
    // this card a different height from the other one.
    img.onerror = () => clip.classList.add('is-failed');
    img.src = src;
  }
  clip.classList.toggle('is-covered', !showPrice);
  img.alt = showPrice
    ? `The line for ${card.dish} on the ${card.year} menu`
    : '';

  const price = root.querySelector('.price');
  price.textContent = showPrice ? formatPrice(card.price) : '';
  price.classList.toggle('is-hidden', !showPrice);

  const fact = root.querySelector('.fact');
  fact.textContent = showFact
    ? `about ${formatPrice(card.price_today)} today`
    : '\u00A0';
  fact.classList.toggle('is-empty', !showFact);
}

function render() {
  paint(el.left, state.left, { price: true, link: true });
  paint(el.right, state.right);
  el.prompt.textContent = `Did ${state.right.dish} cost more or less `
    + `than ${formatPrice(state.left.price)}?`;
  el.streak.textContent = state.streak;
}

/* Animation -------------------------------------------------------------- */

const EASE = 'cubic-bezier(.4, 0, .2, 1)';

function animate(node, frames, options) {
  if (reducedMotion.matches) return null;
  return node.animate(frames, { easing: EASE, ...options });
}

/** Move the right card into the left slot, in whichever direction the cards
 *  are laid out -- side by side on a wide screen, stacked on a narrow one. */
async function slideOver() {
  const from = el.right.getBoundingClientRect();
  const to = el.left.getBoundingClientRect();
  const shift = `translate(${to.left - from.left}px, ${to.top - from.top}px)`;

  const moving = [
    animate(el.left, [{ transform: 'none', opacity: 1 },
                      { transform: shift, opacity: 0 }],
            { duration: SLIDE_MS, fill: 'forwards' }),
    animate(el.right, [{ transform: 'none' }, { transform: shift }],
            { duration: SLIDE_MS, fill: 'forwards' }),
  ].filter(Boolean);

  await Promise.all(moving.map(a => a.finished));
  return () => moving.forEach(a => a.cancel());   // hold the end pose until repaint
}

/** Opening deal only: both slots are new, so both fade up. */
function dealIn() {
  animate(el.left, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  dealInRight();
}

/** Mid-run, only the incoming card is new. The left slot already shows the
 *  card the player just guessed, sitting where the slide left it, so fading
 *  it would blink content that never actually changed on screen. */
function dealInRight() {
  animate(el.right, [{ opacity: 0, transform: 'translateX(24px)' },
                     { opacity: 1, transform: 'none' }], { duration: 320 });
  el.right.style.opacity = '';   // the animation, if any, takes it from here
}

/* Play ------------------------------------------------------------------- */

/** The cards this mode plays with, and the shuffle that orders them.
 *
 * Daily uses every card and a seed derived from the date, so the same day
 * deals the same menu to everyone -- and to the same player on a retry.
 * Endless honours the year range and shuffles freshly each run.
 */
function buildDeck() {
  if (state.mode === 'daily') {
    return createDeck(state.all, makeRng(seedFrom(state.day)));
  }
  return createDeck(withinYears(state.all, state.from, state.to));
}

/** Deal the daily forward to where it was left off.
 *
 * The deck is seeded and every draw is deterministic, so replaying the same
 * number of rounds rebuilds the exact pair the player was looking at -- and
 * leaves the deck's cursor where it belongs, so nothing repeats afterwards.
 * That means only the streak has to be stored.
 */
function replayDaily(streak) {
  const deck = buildDeck();
  let left = draw(deck);
  let right = draw(deck, left, 0);
  for (let s = 1; s <= streak; s++) {
    left = right;
    right = draw(deck, left, s);
  }
  return { deck, left, right };
}

function newRound() {
  delete state.saved[state.mode];
  state.deck = buildDeck();
  state.best = loadBest();
  showBest();
  state.left = draw(state.deck);
  state.right = draw(state.deck, state.left, 0);
  state.streak = 0;
  state.seen = new Set([state.left.id, state.right.id]);
  if (state.mode === 'daily') writeDaily(0, false);
  el.gameover.hidden = true;
  el.controls.hidden = false;
  el.again.hidden = false;
  state.over = false;
  el.share.textContent = 'Share';
  render();
  dealIn();
  state.locked = false;
}

/* Modes ------------------------------------------------------------------ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function prettyDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function setMode(mode) {
  const leaving = parkRun();
  if (leaving) state.saved[state.mode] = leaving;
  state.mode = mode;
  const daily = mode === 'daily';
  el.modeDaily.classList.toggle('is-on', daily);
  el.modeEndless.classList.toggle('is-on', !daily);
  el.modeDaily.setAttribute('aria-pressed', String(daily));
  el.modeEndless.setAttribute('aria-pressed', String(!daily));
  el.years.hidden = daily;
  document.body.classList.toggle('is-endless', !daily);
  el.modeNote.textContent = daily
    ? `Today's menu - ${prettyDay(state.day)}. Everyone gets these same cards.`
    : 'A fresh shuffle every run. Set the years you want to play.';
  if (!daily) showYearCount();

  const parked = state.saved[mode];
  if (parked) resumeRun(parked);
  else if (daily && readDaily()) resumeDaily();
  else newRound();
}

/** Put today's attempt back, mid-run or finished, after a reload. */
function resumeDaily() {
  const record = readDaily();
  const { deck, left, right } = replayDaily(record.s);
  state.deck = deck;
  state.left = left;
  state.right = right;
  state.streak = record.s;
  state.seen = new Set();
  state.best = loadBest();
  state.note = '';
  resumeRun({ deck, left, right, streak: record.s, note: state.note, over: record.done });
}

/* Year range (endless only) ---------------------------------------------- */

function countInRange() {
  return withinYears(state.all, state.from, state.to).length;
}

function showYearCount() {
  const n = countInRange();
  el.yearsCount.textContent = n < MIN_CARDS
    ? `Only ${n} cards in that range - widen it to play.`
    : `${n.toLocaleString()} cards`;
  el.yearsCount.classList.toggle('is-warning', n < MIN_CARDS);
  const short = n < MIN_CARDS;
  el.higher.disabled = short;
  el.lower.disabled = short;
  return !short;
}

/** Read both thumbs, stopping each at the other rather than letting them
 *  swap roles mid-drag, and redraw the bar between them. */
function readYearInputs(moved = null) {
  const [lo, hi] = state.bounds;
  let from = Number(el.yearFrom.value);
  let to = Number(el.yearTo.value);

  // Dragged into each other, the thumb being moved pushes the other one along
  // rather than stopping dead -- and only gives way once that one hits the end.
  if (to - from < MIN_SPAN) {
    if (moved === 'to') {
      from = Math.max(lo, to - MIN_SPAN);
      to = Math.max(to, from + MIN_SPAN);
    } else {
      to = Math.min(hi, from + MIN_SPAN);
      from = Math.min(from, to - MIN_SPAN);
    }
    el.yearFrom.value = from;
    el.yearTo.value = to;
  }

  state.from = from;
  state.to = to;
  el.rangeLabel.textContent = `${from}\u2013${to}`;

  const pct = (year) => ((year - lo) / (hi - lo)) * 100;
  el.rangeFill.style.left = `${pct(from)}%`;
  el.rangeFill.style.right = `${100 - pct(to)}%`;

  // Pushed to the far end the thumbs overlap, and the later input wins the
  // pointer; lift the low thumb there so it can still be dragged back.
  el.yearFrom.style.zIndex = from >= hi - MIN_SPAN ? '3' : '';
}

const inRange = (card) => card && card.year >= state.from && card.year <= state.to;

/**
 * Re-aim the deck at the new years without disturbing the round in progress.
 * The cards already on the board only go away if the player has narrowed the
 * range past them -- at which point the run cannot fairly continue, so it
 * starts over.
 */
function applyYears(moved) {
  readYearInputs(moved);
  writeStore(YEARS_KEY, `${state.from}-${state.to}`);
  if (!showYearCount()) return;

  if (state.over || !inRange(state.left) || !inRange(state.right)) {
    newRound();
    return;
  }
  // Keep the pair, the streak and the cards already spent; only the pool of
  // what comes next changes.
  const pool = withinYears(state.all, state.from, state.to)
    .filter((card) => !state.seen.has(card.id));
  state.deck = createDeck(pool);
  delete state.saved[state.mode];
}

function setupYears() {
  const [lo, hi] = state.bounds;
  const stored = (readStore(YEARS_KEY) || '').split('-').map(Number);
  const valid = stored.length === 2 && stored.every(Number.isFinite)
    && stored[0] >= lo && stored[1] <= hi && stored[0] < stored[1];
  [state.from, state.to] = valid ? stored : [lo, hi];

  for (const input of [el.yearFrom, el.yearTo]) {
    input.min = lo;
    input.max = hi;
  }
  el.yearFrom.value = state.from;
  el.yearTo.value = state.to;
  readYearInputs();

  // Live label while dragging; rebuild the deck only once a thumb is let go.
  for (const [input, which] of [[el.yearFrom, 'from'], [el.yearTo, 'to']]) {
    input.addEventListener('input', () => {
      readYearInputs(which);
      showYearCount();
    });
    input.addEventListener('change', () => applyYears(which));
  }
}

function guess(choice) {
  if (state.locked) return;
  state.locked = true;

  // A dead heat cannot be guessed wrong, so it is never counted wrong.
  const truth = verdict(state.left, state.right);
  const tie = truth === 'tie';
  const correct = tie || choice === truth;
  paint(el.right, state.right, { price: true, fact: true });
  el.right.classList.add(correct ? 'is-right' : 'is-wrong');
  animate(el.right.querySelector('.price'),
          [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
          { duration: 260 });
  animate(el.right.querySelector('.fact'), [{ opacity: 0 }, { opacity: 1 }],
          { duration: 260, delay: 120, fill: 'backwards' });

  const lead = tie ? 'Dead heat' : (correct ? 'Correct' : 'Wrong');
  el.status.textContent = `${lead} - ${state.right.dish} `
    + `was ${formatPrice(state.right.price)}, about `
    + `${formatPrice(state.right.price_today)} today.`;
  el.prompt.textContent = tie
    ? `Both ${formatPrice(state.left.price)}. That one is on the house.`
    : el.prompt.textContent;

  if (correct) {
    state.streak += 1;
    el.streak.textContent = state.streak;
    setTimeout(advance, REVEAL_MS);
  } else {
    setTimeout(endGame, REVEAL_MS);
  }
}

/** The card just guessed becomes the one to beat. */
async function advance() {
  const release = await slideOver();
  state.left = state.right;
  state.right = draw(state.deck, state.left, state.streak);
  state.seen.add(state.right.id);
  if (state.mode === 'daily') writeDaily(state.streak, false);
  // Hide the incoming card before it is painted, so releasing the slide
  // cannot flash the new dish for a frame at full opacity.
  if (!reducedMotion.matches) el.right.style.opacity = '0';
  render();
  if (release) release();
  dealInRight();
  state.locked = false;
}

function endGame() {
  if (state.mode === 'daily') {
    writeDaily(state.streak, true);       // the day is spent, however it went
    state.note = '';
  } else {
    const beaten = state.streak > state.best;
    if (beaten) {
      state.best = state.streak;
      saveBest(state.best);
    }
    state.note = beaten && state.streak > 0 ? 'A new best.' : `Best ${state.best}.`;
  }
  showBest();
  showEndScreen({ focus: true });
}

function showEndScreen({ focus = false } = {}) {
  const daily = state.mode === 'daily';
  el.finalStreak.textContent = state.streak;
  // One attempt at the day's menu, so there is nothing to play again.
  el.finalNote.textContent = daily
    ? "That was today's menu - a new one tomorrow."
    : state.note;
  el.again.hidden = daily;
  el.prompt.textContent = '';
  el.controls.hidden = true;
  el.gameover.hidden = false;
  state.locked = true;
  state.over = true;
  if (focus) (daily ? el.share : el.again).focus();
}

/* Parking a run ---------------------------------------------------------- */

/** Everything needed to put a half-played run back on the board. The deck
 *  carries its own cursor, so parking it is enough to resume mid-shuffle. */
function parkRun() {
  if (!state.left) return null;
  return {
    deck: state.deck, left: state.left, right: state.right,
    streak: state.streak, note: state.note, seen: state.seen,
    over: !el.gameover.hidden,
  };
}

function resumeRun(run) {
  Object.assign(state, {
    deck: run.deck, left: run.left, right: run.right,
    streak: run.streak, note: run.note,
    seen: run.seen || state.seen || new Set(),
  });
  state.best = loadBest();
  showBest();
  el.share.textContent = 'Share';
  el.streak.textContent = state.streak;

  if (run.over) {
    // Put the losing pair back as it was, price showing and marked wrong.
    paint(el.left, state.left, { price: true, link: true });
    paint(el.right, state.right, { price: true, fact: true });
    el.right.classList.add('is-wrong');
    showEndScreen();
  } else {
    render();
    el.gameover.hidden = true;
    el.controls.hidden = false;
    state.over = false;
    state.locked = false;
  }
  dealIn();
}

/* Sharing ---------------------------------------------------------------- */

function shareText() {
  const squares = state.streak <= 20
    ? '\u{1F7E9}'.repeat(state.streak) + '\u{1F7E5}'
    : `\u{1F7E9}×${state.streak} \u{1F7E5}`;
  // Name the run, so two scores are only compared when they mean the same
  // thing: the same day's cards, or the same slice of years.
  const label = state.mode === 'daily'
    ? `Daily, ${prettyDay(state.day)}`
    : `Endless, ${state.from}–${state.to}`;
  return `Big Apples to Apples \u{1F34E}\n${label}\n`
    + `Streak: ${state.streak}\n${squares}\n${location.href}`;
}

async function share() {
  const text = shareText();
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;      // player changed their mind
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    el.share.textContent = 'Copied';
    setTimeout(() => { el.share.textContent = 'Share'; }, 2000);
  } catch {
    el.share.textContent = 'Press Ctrl+C';
    window.prompt('Copy your score', text);
    el.share.textContent = 'Share';
  }
}

/* Start ------------------------------------------------------------------ */

async function init() {
  try {
    const res = await fetch('data/items.json');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    state.all = await res.json();            // raw items; buildDeck shuffles them
  } catch (err) {
    // Most often: opened as a file:// URL, where fetch is blocked.
    el.prompt.textContent = 'Could not load the menu data. Serve the folder '
      + 'over http (python3 -m http.server) and reload.';
    el.controls.hidden = true;
    console.error(err);
    return;
  }

  state.bounds = yearRange(state.all);
  setupYears();

  el.higher.addEventListener('click', () => guess('higher'));
  el.lower.addEventListener('click', () => guess('lower'));
  el.again.addEventListener('click', newRound);
  el.share.addEventListener('click', share);
  el.modeDaily.addEventListener('click', () => setMode('daily'));
  el.modeEndless.addEventListener('click', () => setMode('endless'));
  document.addEventListener('keydown', (e) => {
    if (el.controls.hidden) return;
    if (e.key === 'ArrowUp' || e.key === 'h') guess('higher');
    if (e.key === 'ArrowDown' || e.key === 'l') guess('lower');
  });
  el.board.classList.remove('is-loading');
  setMode('daily');                          // the day's menu is the front door
}

init();
