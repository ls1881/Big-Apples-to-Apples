/** node --test test/deck.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDeck, draw, farEnough, fairPair, verdict, shuffle, NEAR_TIE,
  difficultyFor, matchesRule, priceGap, seedFrom, makeRng, dayKey, yearRange,
  withinYears } from '../js/deck.js';

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

test('the ramp tightens the price band and widens the years', () => {
  const easy = difficultyFor(0), mid = difficultyFor(7), hard = difficultyFor(15);
  assert.ok(easy.minGap > mid.minGap && mid.minGap > hard.minGap);
  assert.ok(easy.maxGap > mid.maxGap && mid.maxGap > hard.maxGap);
  assert.ok(hard.minYears > easy.minYears);
  assert.equal(hard.minGap, NEAR_TIE);
  for (const r of [easy, mid, hard]) assert.ok(r.minGap < r.maxGap, 'band inverted');
});

test('the ramp stops tightening once it is fully wound', () => {
  assert.deepEqual(difficultyFor(15), difficultyFor(400));
  assert.deepEqual(difficultyFor(0), difficultyFor(-5));
});

test('late pairs really are closer in price than early ones', () => {
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const gapsAt = (streak) => {
    const out = [];
    for (let run = 0; run < 120; run++) {
      const deck = createDeck(items, seeded(run + 1));
      let left = draw(deck);
      for (let s = 0; s <= streak; s++) {      // walk the ramp up to `streak`
        const right = draw(deck, left, s);
        if (s === streak) out.push(priceGap(right, left));
        left = right;
      }
    }
    return median(out);
  };
  const early = gapsAt(0), late = gapsAt(15);
  assert.ok(late < early / 2, `late pairs not much harder: ${early} -> ${late}`);
});

test('a drawn pair satisfies the rule, or a deliberately relaxed one', () => {
  const deck = createDeck(items, seeded(9));
  let left = draw(deck);
  let strict = 0, total = 0;
  for (let s = 0; s < 400; s++) {
    const right = draw(deck, left, s);
    total++;
    if (matchesRule(right, left, difficultyFor(s))) strict++;
    // Even a relaxed draw must never be a coin flip or a repeat.
    assert.ok(fairPair(right, left, NEAR_TIE), `unfair pair at streak ${s}`);
    left = right;
  }
  assert.ok(strict / total > 0.95, `too many fallbacks: ${strict}/${total}`);
});

test('every item carries the field the inflation fact needs', () => {
  for (const item of items) {
    assert.equal(typeof item.price_today, 'number');
    assert.ok(item.price_today >= item.price);
  }
});

/* Daily challenge --------------------------------------------------------- */

test('dayKey uses the local date, so the day turns over at local midnight', () => {
  assert.equal(dayKey(new Date(2026, 8, 21, 0, 0)), '2026-09-21');
  assert.equal(dayKey(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
  assert.equal(dayKey(new Date(2026, 0, 5)), '2026-01-05');    // zero padded
});

test('the seed is stable for a day and different the next', () => {
  assert.equal(seedFrom('2026-09-21'), seedFrom('2026-09-21'));
  assert.notEqual(seedFrom('2026-09-21'), seedFrom('2026-09-22'));
});

test('the same day deals the same run, a different day does not', () => {
  const run = (day) => {
    const deck = createDeck(items, makeRng(seedFrom(day)));
    const out = [];
    let left = draw(deck);
    out.push(left.id);
    for (let s = 0; s < 12; s++) {
      left = draw(deck, left, s);
      out.push(left.id);
    }
    return out.join(',');
  };
  assert.equal(run('2026-09-21'), run('2026-09-21'), 'daily run is not reproducible');
  assert.notEqual(run('2026-09-21'), run('2026-09-22'));
});

/* Year range -------------------------------------------------------------- */

test('withinYears keeps only the years asked for, inclusive', () => {
  const picked = withinYears(items, 1940, 1960);
  assert.ok(picked.length > 0);
  assert.ok(picked.every((i) => i.year >= 1940 && i.year <= 1960));
  assert.equal(picked.length, items.filter((i) => i.year >= 1940 && i.year <= 1960).length);
  assert.equal(withinYears(items, 1900, 1900).every((i) => i.year === 1900), true);
});

test('yearRange reports the span the data actually covers', () => {
  const [lo, hi] = yearRange(items);
  assert.ok(lo >= 1850 && hi <= 2010 && lo < hi);
  assert.equal(lo, Math.min(...items.map((i) => i.year)));
  assert.equal(hi, Math.max(...items.map((i) => i.year)));
});

test('a narrow range still deals fair pairs, by relaxing the era rule', () => {
  const slice = withinYears(items, 1940, 1950);        // far under 40 years apart
  const deck = createDeck(slice, seeded(5));
  let left = draw(deck);
  for (let s = 0; s < 200; s++) {
    const right = draw(deck, left, s);                 // late ramp wants 40+ years
    assert.ok(right, 'draw came back empty');
    assert.ok(right.year >= 1940 && right.year <= 1950, 'dealt outside the range');
    assert.ok(fairPair(right, left, NEAR_TIE), `coin-flip pair at streak ${s}`);
    left = right;
  }
});
