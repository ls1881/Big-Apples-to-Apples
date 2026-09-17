# Big-Apples-to-Apples
Big Apples to Apples is a higher-or-lower game built on real restaurant menus from the New York Public Library's archive. Each round shows two dishes, each with its restaurant and year. You know what the first one cost; you guess whether the second was pricier or cheaper. Get it right and your streak grows. Get it wrong and dinner's over.


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
- **Scope.** The build keeps the whole collection by default. `--scope nyc`
  narrows it to menus whose place reads as New York, which is a much smaller
  and patchier pool, since over half the menus have no place recorded.

`data/build_report.json` records the snapshot used and the row count after
every filter.

### Credits

Menu data: The New York Public Library, ["What's on the
Menu?"](https://www.nypl.org/research/support/whats-on-the-menu). Inflation
index: Federal Reserve Bank of Minneapolis, "Consumer Price Index, 1800–".
Not affiliated with NYPL or the Apples to Apples card game.
