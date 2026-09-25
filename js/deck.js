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

/* Seeded play ------------------------------------------------------------ */

/** FNV-1a. Turns a date like "2026-09-21" into a seed, so everyone opening
 *  the game on the same day is dealt the same menu. */
export function seedFrom(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small LCG. Not good randomness, but reproducible, which is the point. */
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** Local date as YYYY-MM-DD -- the daily challenge turns over at midnight
 *  where the player is, not in UTC. */
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function yearRange(items) {
  let lo = Infinity, hi = -Infinity;
  for (const item of items) {
    if (item.year < lo) lo = item.year;
    if (item.year > hi) hi = item.year;
  }
  return [lo, hi];
}

export function withinYears(items, from, to) {
  return items.filter((item) => item.year >= from && item.year <= to);
}

/* Deck -------------------------------------------------------------------- */

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
    // Last resort before giving up on the rules entirely: any two prices that
    // are not the same number. A narrow year range can leave nothing else.
    { minGap: 0, maxGap: Infinity, minYears: 0, maxYears: 200 },
  ];
}

/**
 * Take the next unused card, preferring one that makes a fair pair with
 * `against`. Cards are consumed by swapping the chosen one down to the
 * cursor, so nothing repeats within a run.
 */
function recycle(deck) {
  deck.cards = shuffle(deck.cards, deck.rng);
  deck.cursor = 0;
}

/** Index of the best card left for `against`, or -1 if none will do. */
function findPartner(deck, against, streak) {
  const end = Math.min(deck.cards.length, deck.cursor + SCAN_LIMIT);
  for (const rule of relaxations(difficultyFor(streak))) {
    for (let i = deck.cursor; i < end; i++) {
      if (matchesRule(deck.cards[i], against, rule)) return i;
    }
  }
  // Even the distinct dish and restaurant have to go before the prices do: a
  // pair the player can reason about matters more than a tidy-looking one.
  for (let i = deck.cursor; i < end; i++) {
    if (deck.cards[i].price !== against.price) return i;
  }
  return -1;
}

export function draw(deck, against = null, streak = 0) {
  if (deck.cursor >= deck.cards.length) recycle(deck);   // ran the deck out
  if (!against) return take(deck, deck.cursor);

  let found = findPartner(deck, against, streak);
  if (found < 0) {
    // The tail of a small deck can hold nothing but cards at this very price.
    // Reshuffling repeats a card sooner than it would have, which is a far
    // smaller cost than asking the player a question with no right answer.
    recycle(deck);
    found = findPartner(deck, against, streak);
  }
  return take(deck, found >= 0 ? found : deck.cursor);   // a true dead heat
}

function take(deck, index) {
  const card = deck.cards[index];
  deck.cards[index] = deck.cards[deck.cursor];
  deck.cards[deck.cursor] = card;
  deck.cursor++;
  return card;
}

/** What the right card actually did, relative to the left one.
 *
 * Two dishes really can have been printed at the same price, and in a narrow
 * year range the deck can run out of anything better to deal. Saying so beats
 * picking a side, which would mark one of two equally defensible answers
 * wrong and end a run on a question with no right answer.
 */
export function verdict(left, right) {
  if (right.price === left.price) return 'tie';
  return right.price > left.price ? 'higher' : 'lower';
}

export function formatPrice(value) {
  return '$' + value.toFixed(2);
}
