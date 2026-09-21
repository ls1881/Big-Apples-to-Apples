/** Deck handling and the rules for what makes a fair pair.
 *
 * Kept free of the DOM so the pairing rules can be tested directly.
 */

/** Minimum price gap between the two cards, relative to the cheaper one.
 *  PLAN: skip pairs within ~10-20% of each other -- at a coin-flip gap the
 *  player is guessing, not playing. */
export const NEAR_TIE = 0.18;

/** How far to look for a fair partner before settling for any unused card. */
const SCAN_LIMIT = 600;

/** Streak at which the ramp is fully wound up. */
const RAMP_OVER = 15;

/** The opening pair: a wide price gap, and two dishes from roughly the same
 *  era, so ordinary price sense is enough to get it right. */
const EASY = { minGap: 1.5, maxGap: 50, minYears: 0, maxYears: 20 };

/** The endgame: prices close enough to hurt, decades apart, so inflation is
 *  working against the player. The ceiling matters as much as the floor --
 *  a minimum gap only permits a hard pair, it does not deal one. */
const HARD = { minGap: NEAR_TIE, maxGap: 0.9, minYears: 40, maxYears: 200 };

export function shuffle(list, rng = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True if the prices are far enough apart to be worth guessing about. */
export function farEnough(a, b, band = NEAR_TIE) {
  const lo = Math.min(a.price, b.price);
  const hi = Math.max(a.price, b.price);
  return lo > 0 && (hi - lo) / lo > band;
}

/** Two cards from the same kitchen, or the same dish twice, read as a trick. */
export function fairPair(candidate, against, band = NEAR_TIE) {
  return candidate.dish !== against.dish
    && candidate.restaurant !== against.restaurant
    && farEnough(candidate, against, band);
}

export function createDeck(items, rng = Math.random) {
  return { cards: shuffle(items, rng), cursor: 0, rng, band: NEAR_TIE };
}

const mix = (from, to, t) => from + (to - from) * t;

/** Price gaps span orders of magnitude, so they narrow geometrically. */
const mixLog = (from, to, t) => from * (to / from) ** t;

/** How demanding the next pair should be, given the streak so far. */
export function difficultyFor(streak) {
  const t = Math.min(Math.max(streak, 0) / RAMP_OVER, 1);
  return {
    minGap: mixLog(EASY.minGap, HARD.minGap, t),
    maxGap: mixLog(EASY.maxGap, HARD.maxGap, t),
    minYears: Math.round(mix(EASY.minYears, HARD.minYears, t)),
    maxYears: Math.round(mix(EASY.maxYears, HARD.maxYears, t)),
  };
}

export function priceGap(a, b) {
  return Math.abs(a.price - b.price) / Math.min(a.price, b.price);
}

export function matchesRule(candidate, against, rule) {
  const years = Math.abs(candidate.year - against.year);
  return fairPair(candidate, against, rule.minGap)
    && priceGap(candidate, against) <= rule.maxGap
    && years >= rule.minYears && years <= rule.maxYears;
}

/** The rule, then the same rule with each demand dropped in turn.
 *
 * The deck thins out as a run goes on, and the strict rule can simply have no
 * match left among the unused cards. Better to deal a slightly easier pair
 * than to repeat a card or stall.
 */
function relaxations(rule) {
  return [
    rule,
    { ...rule, minYears: 0, maxYears: 200 },            // any era
    { ...rule, minGap: NEAR_TIE, maxGap: 50, minYears: 0, maxYears: 200 },
  ];
}

/**
 * Take the next unused card, preferring one that makes a fair pair with
 * `against`. Cards are consumed by swapping the chosen one down to the
 * cursor, so nothing repeats within a run.
 */
export function draw(deck, against = null, streak = 0) {
  if (deck.cursor >= deck.cards.length) {       // ran the deck out; start over
    deck.cards = shuffle(deck.cards, deck.rng);
    deck.cursor = 0;
  }
  if (!against) return take(deck, deck.cursor);

  const end = Math.min(deck.cards.length, deck.cursor + SCAN_LIMIT);
  for (const rule of relaxations(difficultyFor(streak))) {
    for (let i = deck.cursor; i < end; i++) {
      if (matchesRule(deck.cards[i], against, rule)) return take(deck, i);
    }
  }
  return take(deck, deck.cursor);               // nothing fair nearby; move on
}

function take(deck, index) {
  const card = deck.cards[index];
  deck.cards[index] = deck.cards[deck.cursor];
  deck.cards[deck.cursor] = card;
  deck.cursor++;
  return card;
}

/** What the right card actually did, relative to the left one. */
export function verdict(left, right) {
  return right.price > left.price ? 'higher' : 'lower';
}

export function formatPrice(value) {
  return '$' + value.toFixed(2);
}
