/** node --test test/deck.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDeck, draw, farEnough, fairPair, verdict, shuffle, NEAR_TIE }
  from '../js/deck.js';

const items = JSON.parse(readFileSync(new URL('../data/items.json', import.meta.url)));

/** Deterministic rng so a failure is reproducible. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const card = (price, dish = 'a', restaurant = 'r') => ({ price, dish, restaurant });

test('farEnough rejects coin-flip gaps and accepts clear ones', () => {
  assert.equal(farEnough(card(0.30), card(0.35)), false);   // 16.7%
  assert.equal(farEnough(card(0.25), card(0.30)), true);    // 20%
  assert.equal(farEnough(card(1.00), card(1.00)), false);
  assert.equal(farEnough(card(0.10), card(12.00)), true);
});

test('fairPair rejects a repeat dish or the same restaurant', () => {
  const left = card(1.00, 'Oysters', 'Delmonico');
  assert.equal(fairPair(card(5.00, 'Oysters', 'Astor'), left), false);
  assert.equal(fairPair(card(5.00, 'Squab', 'Delmonico'), left), false);
  assert.equal(fairPair(card(5.00, 'Squab', 'Astor'), left), true);
});

test('verdict reads the right card against the left', () => {
  assert.equal(verdict(card(0.25), card(1.00)), 'higher');
  assert.equal(verdict(card(1.00), card(0.25)), 'lower');
});

test('shuffle keeps every card exactly once', () => {
  const out = shuffle(items.slice(0, 500), seeded(7));
  assert.equal(out.length, 500);
  assert.equal(new Set(out.map(i => i.id)).size, 500);
});

test('a long run never repeats a card and always deals a fair pair', () => {
  const deck = createDeck(items, seeded(42));
  const seen = new Set();
  let left = draw(deck);
  seen.add(left.id);

  for (let round = 0; round < 2000; round++) {
    const right = draw(deck, left);
    assert.ok(!seen.has(right.id), `card ${right.id} dealt twice at round ${round}`);
    seen.add(right.id);
    assert.ok(fairPair(right, left, NEAR_TIE),
      `unfair pair at round ${round}: ${left.dish} ${left.price} / ${right.dish} ${right.price}`);
    assert.notEqual(left.price, right.price);
    left = right;
  }
});

test('the deck reshuffles instead of running dry', () => {
  const small = createDeck(items.slice(0, 40), seeded(3));
  for (let i = 0; i < 300; i++) assert.ok(draw(small, card(0.5, 'x', 'y')));
});
