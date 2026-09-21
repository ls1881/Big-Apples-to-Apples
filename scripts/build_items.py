"""Steps 2-6: join, filter, normalize, CPI-adjust, and export data/items.json.

Run scripts/fetch_data.py first. Every filter prints how many rows it dropped,
so the funnel is auditable; the same numbers land in data/build_report.json.
"""

import argparse
import json
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

MIN_YEAR, MAX_YEAR = 1850, 2010
CPI_REF_YEAR = 2025          # latest complete annual average in data/cpi.csv
MIN_MENUS_APPEARED = 5       # "dishes that appear on multiple menus"
DISH_LEN = (3, 60)           # card-sized names only
RESTAURANT_LEN = (3, 60)
DECADE_TRIM = (0.01, 0.99)   # per-decade price percentile clip
MIN_DECADE_ROWS = 200        # below this, fall back to global percentiles

# Menu.currency is blank for ~63% of menus; in this dataset blank means USD.
# Anything explicitly named as another currency is dropped, and so is "Cents",
# whose price column is not in dollars.
USD_CURRENCIES = {"Dollars"}

# Menu scans still resolve here even though menus.nypl.org itself is retired.
IMAGE_URL = "https://images.nypl.org/index.php?id={image_id}&t=w"

SMALL_WORDS = {"a", "an", "and", "at", "de", "del", "der", "des", "du", "el",
               "en", "for", "in", "la", "le", "les", "of", "on", "or", "the",
               "to", "und", "van", "von"}
KEEP_UPPER = {"ss", "rms", "hms", "usa", "us", "ny", "nyc", "bbq", "ii", "iii",
              "iv", "vi", "vii", "viii", "ix", "xi", "xii", "kc", "mgm", "ymca",
              "rr", "usms", "uss", "bmt", "irt"}   # no "la"/"dc": articles win
JUNK_NAMES = {"", "?", "??", "???", "n/a", "na", "none", "unknown", "[]", "--"}

# The archive's stand-in for a menu whose restaurant was never recorded. It
# appears with several spellings and a stray bracket; on a card it should read
# as one plain phrase.
UNNAMED = "Restaurant name not given"
UNNAMED_RE = re.compile(r"restaurant\s*(name)?\s*(and\s*/?\s*or)?\s*location"
                        r"\s*not\s*given", re.I)


class Funnel:
    """Row counter that reports what each filter cost."""

    def __init__(self, df: pd.DataFrame, label: str):
        self.df = df
        self.steps = [(label, len(df))]
        print(f"{label:<44} {len(df):>9,}")

    def keep(self, mask: pd.Series, label: str) -> None:
        before = len(self.df)
        self.df = self.df[mask.reindex(self.df.index, fill_value=False)]
        dropped = before - len(self.df)
        self.steps.append((label, len(self.df)))
        print(f"  {label:<42} {len(self.df):>9,}  (-{dropped:,})")

    def note(self, label: str) -> None:
        self.steps.append((label, len(self.df)))
        print(f"  {label:<42} {len(self.df):>9,}")


def tidy(value: object) -> str:
    """Collapse whitespace and strip the archive's trailing punctuation."""
    if not isinstance(value, str):
        return ""
    s = re.sub(r"\s+", " ", value).strip()
    s = s.strip("\"'")
    s = re.sub(r"\(\?\)|\[\?\]", "", s).strip()      # archive's "not sure" marker
    if re.fullmatch(r"[(\[].*[)\]]", s):                # wholly parenthesised name
        s = s[1:-1].strip()
    # Editorial brackets around part of a name ("Wabash [Railway Company]")
    # read as a typo on a card; keep the words, drop the brackets.
    s = s.replace("[", "").replace("]", "").strip()
    s = re.sub(r"[;,.?\s]+$", "", s).strip()
    return s


def titlecase(s: str) -> str:
    """Title-case the archive's shouty names; leave normal ones alone.

    Mostly-caps counts as shouty, not just pure caps: the archive holds names
    like "McGOWN'S PASS TAVERN" and "SMITH & McNELL".
    """
    letters = [c for c in s if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.7:
        return s
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        low = w.lower()
        stripped = low.strip(".,&()[]\"'")
        if stripped in KEEP_UPPER:
            out.append(w.upper())
        elif stripped in SMALL_WORDS and 0 < i < len(words) - 1:
            out.append(low)
        else:
            # .title() mangles the possessive ("LARRY'S" -> "Larry'S"), but
            # the apostrophe in "O'DONNELL" is not one -- only lower a letter
            # that ends its word.
            out.append(re.sub(r"'([A-Z])\b",
                              lambda m: "'" + m.group(1).lower(), low.title()))
    joined = " ".join(out)
    # "Mcnell" / "Macarthur" -> "McNell" / "MacArthur"
    return re.sub(r"\b(Ma?c)([a-z])(?=[a-z]{2})",
                  lambda m: m.group(1) + m.group(2).upper(), joined)


def usable_name(s: pd.Series, bounds: tuple[int, int]) -> pd.Series:
    lo, hi = bounds
    return (s.str.len().between(lo, hi)
            & s.str.contains(r"[A-Za-z]{3}", regex=True)
            & ~s.str.contains("?", regex=False)   # archive's "name unknown"
            & ~s.str.lower().isin(JUNK_NAMES))


def load_joined() -> pd.DataFrame:
    """Step 2: MenuItem -> MenuPage -> Menu, plus Dish."""
    item = pd.read_csv(RAW / "MenuItem.csv", low_memory=False,
                       usecols=["id", "menu_page_id", "price", "dish_id"])
    page = pd.read_csv(RAW / "MenuPage.csv", low_memory=False,
                       usecols=["id", "menu_id", "image_id"])
    menu = pd.read_csv(RAW / "Menu.csv", low_memory=False,
                       usecols=["id", "sponsor", "name", "place", "location",
                                "date", "currency"])
    dish = pd.read_csv(RAW / "Dish.csv", low_memory=False,
                       usecols=["id", "name", "menus_appeared"])

    df = (item.rename(columns={"id": "item_id"})
          .merge(page.rename(columns={"id": "menu_page_id"}),
                 on="menu_page_id", how="inner")
          .merge(menu.rename(columns={"id": "menu_id", "name": "menu_name"}),
                 on="menu_id", how="inner")
          .merge(dish.rename(columns={"id": "dish_id", "name": "dish_name"}),
                 on="dish_id", how="inner"))
    df["year"] = pd.to_datetime(df["date"], errors="coerce").dt.year
    return df


def trim_outliers(df: pd.DataFrame) -> pd.Series:
    """Prices are era-relative, so clip percentiles inside each decade.

    Catches both the cents-keyed-as-dollars errors ("695" for $6.95) and the
    per-dozen/whole-bird prices that would otherwise read as absurd.
    """
    lo_q, hi_q = DECADE_TRIM
    decade = (df["year"] // 10 * 10).astype(int)
    g_lo, g_hi = df["price"].quantile([lo_q, hi_q])
    keep = pd.Series(True, index=df.index)
    for dec, idx in df.groupby(decade).groups.items():
        prices = df.loc[idx, "price"]
        lo, hi = (prices.quantile([lo_q, hi_q]) if len(prices) >= MIN_DECADE_ROWS
                  else (g_lo, g_hi))
        keep.loc[idx] = prices.between(lo, hi)
    return keep


def is_nyc(df: pd.DataFrame) -> pd.Series:
    blob = (df["place"].fillna("") + " | " + df["location"].fillna("")
            + " | " + df["menu_name"].fillna("")).str.upper()
    return blob.str.contains(
        r"NEW YORK|\bNYC\b|\bN\.? ?Y\.?\b|BROOKLYN|MANHATTAN|BRONX"
        r"|STATEN ISLAND|\bHARLEM\b", regex=True)


def cpi_table() -> dict[int, float]:
    cpi = pd.read_csv(ROOT / "data" / "cpi.csv")
    return dict(zip(cpi["year"].astype(int), cpi["cpi"].astype(float)))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--scope", choices=["all", "nyc"], default="all",
                    help="'nyc' keeps only menus whose place/location reads as "
                         "New York (far smaller pool)")
    ap.add_argument("--max-per-restaurant", type=int, default=8,
                    help="cap so the Waldorf does not eat the deck; 0 = no cap")
    ap.add_argument("--max-per-dish", type=int, default=12,
                    help="cap so the deck is not all coffee and milk; 0 = no cap")
    ap.add_argument("--min-menus-appeared", type=int, default=MIN_MENUS_APPEARED)
    ap.add_argument("--seed", type=int, default=20260917)
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "items.json")
    args = ap.parse_args()

    print("\n== step 2: join")
    df = load_joined()
    f = Funnel(df, "joined MenuItem/MenuPage/Menu/Dish")

    print("\n== step 3: filter")
    f.keep(~f.df["currency"].notna() | f.df["currency"].isin(USD_CURRENCIES),
           "USD only (blank currency = USD)")
    f.keep(f.df["year"].between(MIN_YEAR, MAX_YEAR), f"year {MIN_YEAR}-{MAX_YEAR}")
    f.keep(f.df["price"].notna() & (f.df["price"] > 0), "price present and non-zero")
    if args.scope == "nyc":
        f.keep(is_nyc(f.df), "New York menus only")

    print("\n== step 4: normalize")
    f.df = f.df.assign(
        dish=f.df["dish_name"].map(tidy).map(titlecase),
        restaurant=f.df["sponsor"].map(tidy).map(titlecase)
                                 .str.replace(UNNAMED_RE, UNNAMED, regex=True),
    )
    f.keep(usable_name(f.df["restaurant"], RESTAURANT_LEN), "valid restaurant name")
    f.keep(usable_name(f.df["dish"], DISH_LEN), "valid dish name")
    f.keep(f.df["menus_appeared"] >= args.min_menus_appeared,
           f"dish on >= {args.min_menus_appeared} menus")
    f.keep(trim_outliers(f.df), "price outliers trimmed (per decade)")

    # One card per dish/restaurant/year; the archive repeats the same dish
    # across pages and reprints of a menu. Where those copies disagree, take
    # the most frequently printed price (ties go to the cheaper) rather than a
    # median, which would invent half-cent prices no menu ever showed.
    priced = (f.df.groupby(["dish", "restaurant", "year", "price"], as_index=False)
              .agg(n=("item_id", "size"), id=("item_id", "first"),
                   image_id=("image_id", "first")))
    f.df = (priced.sort_values(["n", "price"], ascending=[False, True])
            .groupby(["dish", "restaurant", "year"], as_index=False)
            .first()
            .drop(columns="n"))
    f.note("deduped to dish/restaurant/year")

    shuffled = f.df.sample(frac=1, random_state=args.seed)
    if args.max_per_dish:
        shuffled = shuffled.groupby("dish", group_keys=False).head(args.max_per_dish)
        f.df = shuffled.sort_values("id")
        f.note(f"capped at {args.max_per_dish} per dish")
    if args.max_per_restaurant:
        shuffled = shuffled.groupby("restaurant", group_keys=False) \
                           .head(args.max_per_restaurant)
        f.df = shuffled.sort_values("id")
        f.note(f"capped at {args.max_per_restaurant} per restaurant")

    print("\n== step 5: CPI adjustment")
    cpi = cpi_table()
    base = cpi[CPI_REF_YEAR]
    f.keep(f.df["year"].isin(cpi), "year covered by CPI table")
    # Round first, then adjust, so the exported pair always agrees.
    f.df["price"] = f.df["price"].round(2)
    f.df["price_today"] = [round(p * base / cpi[int(y)], 2)
                           for p, y in zip(f.df["price"], f.df["year"])]
    print(f"  reference year: {CPI_REF_YEAR}")

    print("\n== step 6: export")
    items = [{"id": int(r.id),
              "dish": r.dish,
              "restaurant": r.restaurant,
              "year": int(r.year),
              "price": float(r.price),
              "price_today": float(r.price_today),
              "image_url": IMAGE_URL.format(image_id=int(r.image_id))}
             for r in f.df.itertuples()
             if pd.notna(r.image_id)]

    args.out.write_text(json.dumps(items, ensure_ascii=False,
                                   separators=(",", ":")) + "\n")
    print(f"  wrote {args.out} ({len(items):,} items, "
          f"{args.out.stat().st_size / 1e6:.1f} MB)")

    snapshot = (RAW / "SNAPSHOT")
    report = {
        "snapshot": snapshot.read_text().strip() if snapshot.exists() else None,
        "scope": args.scope,
        "cpi_reference_year": CPI_REF_YEAR,
        "items": len(items),
        "restaurants": int(f.df["restaurant"].nunique()),
        "dishes": int(f.df["dish"].nunique()),
        "year_range": [int(f.df["year"].min()), int(f.df["year"].max())],
        "funnel": [{"step": s, "rows": n} for s, n in f.steps],
    }
    (ROOT / "data" / "build_report.json").write_text(json.dumps(report, indent=1) + "\n")
    print(f"  {report['restaurants']:,} restaurants, {report['dishes']:,} dishes, "
          f"{report['year_range'][0]}-{report['year_range'][1]}")


if __name__ == "__main__":
    main()
