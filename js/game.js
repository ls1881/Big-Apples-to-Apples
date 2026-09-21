/** Wires the deck to the page: render two cards, take a guess, keep a streak. */

import { createDeck, draw, verdict, formatPrice } from './deck.js';

/** How long the revealed price stays up before the board moves on. */
const REVEAL_MS = 1500;

const el = {
  board: document.getElementById('board'),
  streak: document.getElementById('streak'),
  prompt: document.getElementById('prompt'),
  higher: document.getElementById('higher'),
  lower: document.getElementById('lower'),
  controls: document.getElementById('controls'),
  gameover: document.getElementById('gameover'),
  finalStreak: document.getElementById('final-streak'),
  again: document.getElementById('again'),
  status: document.getElementById('status'),
};

const state = { deck: null, left: null, right: null, streak: 0, locked: true };

function paint(side, card, { hidePrice = false } = {}) {
  const root = document.getElementById(side);
  root.querySelector('.dish').textContent = card.dish;
  root.querySelector('.restaurant').textContent = card.restaurant;
  root.querySelector('.year').textContent = card.year;
  const price = root.querySelector('.price');
  price.textContent = hidePrice ? '' : formatPrice(card.price);
  price.classList.toggle('is-hidden', hidePrice);
  root.classList.remove('is-right', 'is-wrong');
}

function render() {
  paint('left', state.left);
  paint('right', state.right, { hidePrice: true });
  el.prompt.textContent = `Did ${state.right.dish} cost more or less `
    + `than ${formatPrice(state.left.price)}?`;
  el.streak.textContent = state.streak;
}

function newRound() {
  state.left = draw(state.deck);
  state.right = draw(state.deck, state.left);
  state.streak = 0;
  el.gameover.hidden = true;
  el.controls.hidden = false;
  render();
  state.locked = false;
}

function guess(choice) {
  if (state.locked) return;
  state.locked = true;

  const truth = verdict(state.left, state.right);
  const right = document.getElementById('right');
  const correct = choice === truth;

  paint('right', state.right);                       // reveal
  right.classList.add(correct ? 'is-right' : 'is-wrong');
  el.status.textContent = correct
    ? `Correct - ${state.right.dish} was ${formatPrice(state.right.price)}.`
    : `Wrong - ${state.right.dish} was ${formatPrice(state.right.price)}.`;

  if (correct) {
    state.streak += 1;
    el.streak.textContent = state.streak;
    setTimeout(advance, REVEAL_MS);
  } else {
    setTimeout(endGame, REVEAL_MS);
  }
}

/** The card just guessed becomes the one to beat. */
function advance() {
  state.left = state.right;
  state.right = draw(state.deck, state.left);
  render();
  state.locked = false;
}

function endGame() {
  el.finalStreak.textContent = state.streak;
  el.prompt.textContent = '';
  el.controls.hidden = true;
  el.gameover.hidden = false;
  el.again.focus();
}

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

  el.higher.addEventListener('click', () => guess('higher'));
  el.lower.addEventListener('click', () => guess('lower'));
  el.again.addEventListener('click', newRound);
  el.board.classList.remove('is-loading');
  newRound();
}

init();
