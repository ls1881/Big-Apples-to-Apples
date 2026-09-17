"""Refresh data/cpi.csv (step 5 input).

Source: Minneapolis Fed, "Consumer Price Index, 1800-". That table is the
CPI-U rebased (it runs exactly 3x the BLS 1982-84=100 series) and, unlike the
BLS series, it extends back past 1913 -- which we need, since the menu
collection peaks around 1900. Only ratios between years are ever used, so the
base of the index does not matter.
"""

import html
import re
import urllib.request
from pathlib import Path

URL = ("https://www.minneapolisfed.org/about-us/monetary-policy/"
       "inflation-calculator/consumer-price-index-1800-")
OUT = Path(__file__).resolve().parent.parent / "data" / "cpi.csv"


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        page = resp.read().decode("utf-8", "replace")

    rows = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub("<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S)]
        if len(cells) >= 2 and re.fullmatch(r"\d{4}", cells[0]) \
                and re.fullmatch(r"[\d.]+", cells[1]):
            rows[int(cells[0])] = float(cells[1])

    if len(rows) < 200:
        raise SystemExit(f"Only parsed {len(rows)} CPI rows; page layout changed?")

    lines = ["year,cpi"] + [f"{y},{rows[y]}" for y in sorted(rows)]
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT} ({len(rows)} years: {min(rows)}-{max(rows)})")


if __name__ == "__main__":
    main()
