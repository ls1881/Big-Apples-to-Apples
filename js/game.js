/** Wires the deck to the page: render two cards, take a guess, keep a streak. */

import { createDeck, draw, verdict, formatPrice } from './deck.js';

/** How long the revealed price stays up before the board moves on. */
const REVEAL_MS = 1600;
const SLIDE_MS = 420;
const BEST_KEY = 'baa:best';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
};

const state = { deck: null, left: null, right: null, streak: 0, best: 0, locked: true };

/* Best streak ------------------------------------------------------------ */
// localStorage throws in a private window or with site data blocked, and the
// game works fine without it, so every access is optional.

function loadBest() {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch { /* not worth telling the player about */ }
}

function showBest() {
  el.best.textContent = state.best;
  el.bestWrap.hidden = state.best === 0;
}

/* Rendering -------------------------------------------------------------- */

/** `price` shows the number on the menu; `fact` converts it to today's money.
 *  PLAN puts the conversion on the reveal only -- the card to beat shows one
 *  number, so there is no question which price is being compared. */
function paint(root, card, { price: showPrice = false, fact: showFact = false } = {}) {
  // Clear last round's verdict here, not at the call sites -- a stale is-wrong
  // surviving into a new game turns a correct first guess red.
  root.classList.remove('is-right', 'is-wrong');
  root.querySelector('.dish').textContent = card.dish;
  root.querySelector('.restaurant').textContent = card.restaurant;
  root.querySelector('.year').textContent = card.year;

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
  paint(el.left, state.left, { price: true });
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

function newRound() {
  state.left = draw(state.deck);
  state.right = draw(state.deck, state.left, 0);
  state.streak = 0;
  el.gameover.hidden = true;
  el.controls.hidden = false;
  el.share.textContent = 'Share';
  render();
  dealIn();
  state.locked = false;
}

function guess(choice) {
  if (state.locked) return;
  state.locked = true;

  const correct = choice === verdict(state.left, state.right);
  paint(el.right, state.right, { price: true, fact: true });
  el.right.classList.add(correct ? 'is-right' : 'is-wrong');
  animate(el.right.querySelector('.price'),
          [{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
          { duration: 260 });
  animate(el.right.querySelector('.fact'), [{ opacity: 0 }, { opacity: 1 }],
          { duration: 260, delay: 120, fill: 'backwards' });

  el.status.textContent = `${correct ? 'Correct' : 'Wrong'} - ${state.right.dish} `
    + `was ${formatPrice(state.right.price)}, about `
    + `${formatPrice(state.right.price_today)} today.`;

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
  // Hide the incoming card before it is painted, so releasing the slide
  // cannot flash the new dish for a frame at full opacity.
  if (!reducedMotion.matches) el.right.style.opacity = '0';
  render();
  if (release) release();
  dealInRight();
  state.locked = false;
}

function endGame() {
  const beaten = state.streak > state.best;
  if (beaten) {
    state.best = state.streak;
    saveBest(state.best);
  }
  showBest();
  el.finalStreak.textContent = state.streak;
  el.finalNote.textContent = beaten && state.streak > 0
    ? 'A new best.'
    : `Best ${state.best}.`;
  el.prompt.textContent = '';
  el.controls.hidden = true;
  el.gameover.hidden = false;
  el.again.focus();
}

/* Sharing ---------------------------------------------------------------- */

function shareText() {
  const squares = state.streak <= 20
    ? '\u{1F7E9}'.repeat(state.streak) + '\u{1F7E5}'
    : `\u{1F7E9}×${state.streak} \u{1F7E5}`;
  return `Big Apples to Apples \u{1F34E}\n`
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
    state.deck = createDeck(await res.json());
  } catch (err) {
    // Most often: opened as a file:// URL, where fetch is blocked.
    el.prompt.textContent = 'Could not load the menu data. Serve the folder '
      + 'over http (python3 -m http.server) and reload.';
    el.controls.hidden = true;
    console.error(err);
    return;
  }

  state.best = loadBest();
  showBest();
  el.higher.addEventListener('click', () => guess('higher'));
  el.lower.addEventListener('click', () => guess('lower'));
  el.again.addEventListener('click', newRound);
  el.share.addEventListener('click', share);
  document.addEventListener('keydown', (e) => {
    if (el.controls.hidden) return;
    if (e.key === 'ArrowUp' || e.key === 'h') guess('higher');
    if (e.key === 'ArrowDown' || e.key === 'l') guess('lower');
  });
  el.board.classList.remove('is-loading');
  newRound();
}

init();
