"""Step 7: sanity-check data/items.json and print a sample to hand-check.

The assertions catch the failures that would show up as a broken card mid-game
(missing fields, nonsense years, CPI maths that drifted). The printed sample is
for the part a script cannot judge: whether a dish, a restaurant and a price
actually read as a plausible line from a real menu.
"""

import argparse
import json
import random
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDS = {"id", "dish", "restaurant", "year", "price", "price_today",
          "image_id", "x", "y"}
OPTIONAL = {"place"}          # Menu.place is recorded for only ~a third

PAGE_URL = "https://images.nypl.org/index.php?id={id}&t=w"
CLIP_URL = ("https://iiif.nypl.org/iiif/2/{id}"
            "/pct:{x:.2f},{y:.2f},45,4.5/700,/0/default.jpg")


def page_url(item: dict) -> str:
    return PAGE_URL.format(id=item["image_id"])


def clip_url(item: dict) -> str:
    return CLIP_URL.format(id=item["image_id"],
                           x=max(0.0, item["x"] * 100 - 3),
                           y=max(0.0, item["y"] * 100 - 2))


def check(items: list[dict]) -> list[str]:
    problems = []

    def bad(label: str, rows: list[dict]) -> None:
        if rows:
            problems.append(f"{label}: {len(rows)} (e.g. {rows[0]})")

    bad("missing/extra fields",
        [i for i in items if not FIELDS <= set(i) <= FIELDS | OPTIONAL])
    bad("crop coordinates outside the page",
        [i for i in items if not (0 <= i["x"] <= 1 and 0 <= i["y"] <= 1)])
    bad("blank place", [i for i in items if "place" in i and not i["place"].strip()])
    bad("blank dish", [i for i in items if not str(i["dish"]).strip()])
    bad("blank restaurant", [i for i in items if not str(i["restaurant"]).strip()])
    bad("year out of range", [i for i in items if not 1850 <= i["year"] <= 2010])
    bad("non-positive price", [i for i in items if not i["price"] > 0])
    bad("price_today below price",
        [i for i in items if i["price_today"] < i["price"]])
    bad("implausible price_today (> $2000)",
        [i for i in items if i["price_today"] > 2000])
    bad("duplicate id",
        [{"id": i} for i, n in Counter(x["id"] for x in items).items() if n > 1])

    cpi = {int(l.split(",")[0]): float(l.split(",")[1])
           for l in (ROOT / "data" / "cpi.csv").read_text().splitlines()[1:]}
    base = cpi[2025]
    drift = [i for i in items
             if abs(i["price_today"] - i["price"] * base / cpi[i["year"]]) > 0.02]
    bad("price_today does not match CPI table", drift)
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--items", type=Path, default=ROOT / "data" / "items.json")
    ap.add_argument("--sample", type=int, default=100)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--check-images", type=int, default=0,
                    help="HEAD this many image_urls to confirm they resolve")
    args = ap.parse_args()

    items = json.loads(args.items.read_text())
    print(f"{len(items):,} items from {args.items}\n")

    problems = check(items)
    for p in problems:
        print(f"  FAIL  {p}")
    print("  all invariants hold" if not problems else "", end="\n\n")

    if args.check_images:
        rng = random.Random(args.seed)
        ok = 0
        clips = 0
        for it in rng.sample(items, args.check_images):
            for url, counter in ((page_url(it), "page"), (clip_url(it), "clip")):
                req = urllib.request.Request(url, method="HEAD",
                                             headers={"User-Agent": "Mozilla/5.0"})
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        hit = r.headers.get("Content-Type", "").startswith("image/")
                except Exception:
                    hit = False
                if counter == "page":
                    ok += hit
                else:
                    clips += hit
        print(f"menu pages resolving: {ok}/{args.check_images}")
        print(f"dish clips resolving: {clips}/{args.check_images}\n")

    rng = random.Random(args.seed)
    print(f"-- random {args.sample} items to hand-check --")
    print(f"{'year':<6}{'price':>8}{'today':>11}  dish / restaurant / place")
    for it in sorted(rng.sample(items, args.sample), key=lambda i: i["year"]):
        where = f"{it['restaurant'][:30]}"
        if it.get("place"):
            where += f" - {it['place'][:24]}"
        print(f"{it['year']:<6}{it['price']:>8.2f}{it['price_today']:>11,.2f}  "
              f"{it['dish'][:36]:<38}{where}")

    raise SystemExit(1 if problems else 0)


if __name__ == "__main__":
    main()
