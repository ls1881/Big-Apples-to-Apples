/** Deck handling and the rules for what makes a fair pair.
 *
 * Kept free of the DOM so the pairing rules can be tested directly.
 */

/** Minimum price gap between the two cards, relative to the cheaper one.
 *  PLAN: skip pairs within ~10-20% of each other -- at a coin-flip gap the
 *  player is guessing, not playing. */
export const NEAR_TIE = 0.18;

/** How far to look for a fair partner before settling for any unused card. */
const SCAN_LIMIT = 400;

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

/**
 * Take the next unused card, preferring one that makes a fair pair with
 * `against`. Cards are consumed by swapping the chosen one down to the
 * cursor, so nothing repeats within a run.
 */
export function draw(deck, against = null) {
  if (deck.cursor >= deck.cards.length) {       // ran the deck out; start over
    deck.cards = shuffle(deck.cards, deck.rng);
    deck.cursor = 0;
  }
  const end = Math.min(deck.cards.length, deck.cursor + SCAN_LIMIT);
  for (let i = deck.cursor; i < end && against; i++) {
    if (fairPair(deck.cards[i], against, deck.band)) {
      return take(deck, i);
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
