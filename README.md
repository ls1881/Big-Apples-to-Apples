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

Play with the buttons, or the arrow keys.

### What is on a card

Each card carries a clipping of the dish's own line, cut straight out of the
scanned menu with IIIF using the position the archive recorded for it - the
actual printed or handwritten words, not a stand-in photo. There are no
photographs of the food or the restaurants anywhere in this dataset; NYPL
digitised the menus, not the dining rooms.

That clipping includes the printed price, so on the card being guessed it is
blurred until the guess is in, then comes into focus with the price. For the
same reason the dish links out to the full menu page on the left card only,
where the price is already known. The link opens in a new tab so a run is
never lost to a stray click.

Under the restaurant sits the place, where the archive recorded one - a city,
sometimes a street address, sometimes "En Route" for a dining car or an ocean
liner. Only about 30% of menus have one, so most cards show none.

### Modes

**Daily** is what opens by default: one fixed run per calendar day, the same
cards in the same order for everyone. The seed is an FNV-1a hash of the local
date, so the day turns over at the player's midnight rather than UTC.

It is one attempt. There is no "Play again" on the daily, and the attempt is
written to `baa:daily:<date>` as it goes, so reloading resumes the run rather
than handing out a second go at the same puzzle - finished or halfway. Only
the streak is stored: the deck is seeded and every draw is deterministic, so
replaying that many rounds rebuilds the exact pair the player was looking at
and leaves the deck's cursor where it belongs. There is no best-score chip in
daily mode, because with one attempt the streak *is* the score.

**Endless** reshuffles freshly each run and adds a year range: one track with
a thumb at each end. Moving it re-aims what comes *next* without disturbing
the round in progress - the two cards on the board and the streak survive, and
only the pool the next card is drawn from changes. The run restarts only if
the new range no longer contains the cards being compared, at which point it
could not fairly continue anyway. Cards already spent are carried across the
rebuild, so nothing repeats mid-run.

The card count updates live, and below 60 cards the range is refused rather
than dealt, because the deck cannot keep finding fair pairs in a pool that
small.

Even above that floor a tight range can strain the deck, and the last thing it
gives up is a price difference: when no card left satisfies any rule, the draw
reshuffles rather than deal two dishes at the same price. Repeating a card
sooner costs less than asking a question with no right answer. If two prices
really are equal, `verdict` returns `tie` and the round counts as correct
whichever button was pressed - "Both $0.25. That one is on the house." The range is remembered (`baa:years`), but the mode is not - the daily
is always the front door.

The range control is two native `input type="range"` elements stacked on one
track, rather than a hand-rolled widget, so keyboard and screen-reader support
come for free. The inputs take no pointer events; only their thumbs do. A thumb
dragged into the other pushes it along and gives way only at the ends, and they
are held `MIN_SPAN` years apart so they can never land on the same year, where
neither could be grabbed to pull them apart.

**Switching modes does not restart anything.** The run you leave is parked --
deck, cursor, both cards and the streak - and put back when you return, a
finished run included, end screen and all. Parking is per session, so a reload
drops an endless run; the daily survives one, since it is written to storage
as it goes.

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
game still works where that is unavailable.

### Light and dark

The page follows the system setting until the toggle in the top corner is
used; after that the choice is remembered in `baa:theme` and wins over the
system, so picking light on a device set to dark keeps light. The whole
palette lives in custom properties on `:root`, and the dark values appear
twice - once under `prefers-color-scheme`, once under `[data-theme="dark"]` -
so an explicit choice can override the media query in both directions.

A small inline script in `<head>` applies the stored choice before first
paint; the module that runs the game is deferred, so leaving it to that would
flash the light palette at a dark-theme player on every load. The scans are
photographs of cream paper and glare out of a dark page, so `--clip-tune`
dims them in dark mode - set on the clip's container rather than the image, so
it composes with the blur on the card being guessed instead of replacing it. Animations are skipped for anyone with
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
{
 "id": 215,
 "dish": "Puree of beans",
 "restaurant": "Curry & Burlingame",
 "place": "Chambers Street, NYC",
 "year": 1901,
 "price": 0.1,
 "price_today": 3.87,
 "image_id": 471199,
 "x": 0.2086,
 "y": 0.2607
}
```

`id` is the source `MenuItem.id`, so any card traces back to the archive.
`image_id` identifies the scan of the menu page, and `x`/`y` are
`MenuItem.xpos`/`ypos` - where on that page the dish was printed, as a
fraction of the page. The front end builds two URLs from them: the whole page
to link to, and an IIIF crop of the dish's own printed line to show on the
card. `place` is present on about 30% of items; the archive simply does not
record one for the rest.

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
