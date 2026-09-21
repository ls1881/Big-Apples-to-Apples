# Big-Apples-to-Apples
Big Apples to Apples is a higher-or-lower game built on real restaurant menus from the New York Public Library's archive. Each round shows two dishes, each with its restaurant and year. You know what the first one cost; you guess whether the second was pricier or cheaper. Get it right and your streak grows. Get it wrong and dinner's over.


## Running the game

It is a static site with no build step, but it fetches `data/items.json`, so it
needs to be served over http rather than opened as a file.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
node --test test/deck.test.mjs  # pair-selection rules
```

- `index.html` / `css/style.css` - the board.
- `js/deck.js` - shuffling and what counts as a fair pair. No DOM, so it is
  testable on its own.
- `js/game.js` - renders the cards, reads a guess, keeps the streak.

Cards are compared on the price **as printed on the menu**, not adjusted for
inflation - a 1907 lobster really is cheaper than a 1987 coffee, and that is
the game. Today's-money equivalent appears only once a price is revealed, so
the card you are betting against shows a single number. A pair is never dealt
closer than 18% apart (`NEAR_TIE`), and never repeats a dish or a restaurant
within a run.

Play with the buttons, or the arrow keys. The dish on the left links out to
the NYPL scan of the menu page it was printed on - the left card only, since
the scan shows the prices and linking the card being guessed would hand over
the answer. It opens in a new tab so a run is never lost to a stray click.

### Modes

**Daily** is what opens by default: one fixed run per calendar day, the same
cards in the same order for everyone. The seed is an FNV-1a hash of the local
date, so the day turns over at the player's midnight rather than UTC, and
"Play again" replays that same day rather than reshuffling. Its best score is
kept per day (`baa:daily:<date>`), so yesterday's number is not sitting next to
today's cards.

**Endless** reshuffles freshly each run and adds a year range. Narrowing it
rebuilds the deck from just those years; the card count updates live, and below
60 cards the range is refused rather than dealt, because the deck cannot keep
finding fair pairs in a pool that small. The range is remembered
(`baa:years`), but the mode is not - the daily is always the front door.

A narrow range and a long streak pull in opposite directions: by streak 15 the
ramp wants cards 40+ years apart, which a 1940-1950 range cannot supply. The
draw relaxes the era rule rather than repeating a card, so a tight range plays
like a flatter difficulty curve.

### Difficulty

`difficultyFor(streak)` in `js/deck.js` narrows a band rather than setting a
floor - a minimum gap only *permits* a hard pair, it does not deal one, so the
ceiling is what actually makes the game harder. Over 15 rounds it moves from a
wide gap between dishes of the same era to a narrow one between dishes decades
apart, where inflation is working against the player:

| streak | price gap allowed | years apart | median gap dealt |
| -----: | ----------------- | ----------- | ---------------: |
|      0 | 150% - 5000%      | 0 - 20      |             338% |
|      5 | 74% - 1310%       | 13 - 80     |             275% |
|     10 | 36% - 343%        | 27 - 140    |             133% |
|    15+ | 18% - 90%         | 40 - 200    |              50% |

If no unused card fits the rule, the draw relaxes it (first the era, then the
gap) rather than repeating a card. Over 6,800 simulated draws that fallback
fired 0.1% of the time.

The endless best streak is kept in `localStorage` under `baa:best`, and the
game still works where that is unavailable. Animations are skipped for anyone with
`prefers-reduced-motion` set.
## Data pipeline (Phase 1)

The game reads a single static file, `data/items.json`: one card per
dish/restaurant/year, with the nominal menu price and its 2025 equivalent.
It is committed, so you only need to rebuild it if you want different filters.

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

.venv/bin/python scripts/fetch_data.py     # download the NYPL CSVs (~35 MB)
.venv/bin/python scripts/build_items.py    # -> data/items.json
.venv/bin/python scripts/spot_check.py     # assertions + a sample to eyeball
```

`scripts/fetch_cpi.py` refreshes `data/cpi.csv`; it only needs rerunning when a
new year's inflation figure lands.

### Item schema

```json
{"id": 5, "dish": "St. Emilion", "restaurant": "La Noche Buena",
 "year": 1900, "price": 0.5, "price_today": 19.35,
 "image_url": "https://images.nypl.org/index.php?id=467274&t=w"}
```

`id` is the source `MenuItem.id`, so any card traces back to the archive.
`image_url` points at the scan of the menu page the dish came from (the whole
page, not the dish) — it is there for Phase 4.

### Notes on the source data

- **Where it lives.** menus.nypl.org is retired and now redirects to an NYPL
  info page, but the dataset snapshots are still published to a public S3
  bucket. `fetch_data.py` picks the newest one.
- **Currency.** `Menu.currency` is blank for ~63% of menus; blank means USD
  here. Menus naming any other currency are dropped, "Cents" included, since
  its price column is not in dollars.
- **Prices.** The archive contains cents keyed as dollars (`695` for $6.95) and
  per-dozen prices. Because a plausible price depends on the era, outliers are
  clipped to the 1st–99th percentile *within each decade*.
- **Repeats.** The same dish recurs across pages and reprints. Where copies
  disagree on price, the build takes the most frequently printed one.
- **Caps.** Without them the deck is mostly Waldorf Astoria coffee, so it is
  limited to 8 items per restaurant and 12 per dish (`--max-per-restaurant`,
  `--max-per-dish`).
- **Scope.** The build keeps the whole collection by default, and that is what
  ships: 12,218 cards. Despite the name, only about 19% of them are New York -
  the rest are other US cities, ocean liners and railroad dining cars, which is
  why the tagline credits the library rather than claiming the menus are local.
  `--scope nyc` narrows it to menus whose place reads as New York, which yields
  2,613 cards from 346 restaurants.
- **Unnamed restaurants.** The archive records some menus with no restaurant at
  all. Its placeholder has four spellings and a stray bracket, so the build
  collapses them to one phrase, "Restaurant name not given", and strips
  editorial brackets from names like "Wabash [Railway Company]".

`data/build_report.json` records the snapshot used and the row count after
every filter.

### Credits

Menu data: The New York Public Library, ["What's on the
Menu?"](https://www.nypl.org/research/support/whats-on-the-menu). Inflation
index: Federal Reserve Bank of Minneapolis, "Consumer Price Index, 1800–".
Not affiliated with NYPL or the Apples to Apples card game.
