"""Step 1: download the NYPL "What's on the Menu?" CSVs.

menus.nypl.org was retired and now redirects to an NYPL info page, but the
dataset snapshots are still published to the public S3 bucket below. We pick
the most recent snapshot unless one is named explicitly.
"""

import argparse
import io
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

BUCKET = "https://s3.amazonaws.com/menusdata.nypl.org"
EXPECTED = ["Dish.csv", "Menu.csv", "MenuItem.csv", "MenuPage.csv"]
UA = {"User-Agent": "Mozilla/5.0 (Big-Apples-to-Apples data build)"}

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as resp:
        return resp.read()


def latest_snapshot() -> str:
    """Return the newest gzips/ key in the bucket (keys are date-prefixed)."""
    xml = get(f"{BUCKET}/?list-type=2&max-keys=1000").decode("utf-8", "replace")
    keys = re.findall(r"<Key>(gzips/[^<]+\.tgz)</Key>", xml)
    if not keys:
        sys.exit("No snapshots found in bucket listing -- dataset may have moved.")
    return sorted(keys)[-1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--snapshot", help="e.g. gzips/2023_03_16_07_02_35_data.tgz")
    ap.add_argument("--out", type=Path, default=RAW_DIR)
    args = ap.parse_args()

    key = args.snapshot or latest_snapshot()
    print(f"snapshot: {key}")

    blob = get(f"{BUCKET}/{key}")
    print(f"downloaded: {len(blob) / 1e6:.1f} MB")

    args.out.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        members = [m for m in tar.getmembers() if Path(m.name).name in EXPECTED]
        for m in members:
            m.name = Path(m.name).name  # flatten
            tar.extract(m, args.out)
            print(f"  extracted {m.name}")

    missing = [f for f in EXPECTED if not (args.out / f).exists()]
    if missing:
        sys.exit(f"Snapshot is missing expected files: {missing}")

    (args.out / "SNAPSHOT").write_text(key + "\n")
    print(f"ok -> {args.out}")


if __name__ == "__main__":
    main()
