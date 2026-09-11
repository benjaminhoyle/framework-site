#!/usr/bin/env python3
"""
Resized copies of the catalogue photographs, for srcset.

The masters in images/shelving/configs/ are 1400x1400 JPEGs (a few older ones
are 1200 or so), shown in tiles of 250 to 380 CSS px on /shelving and /colours.
Without smaller copies every phone downloads the full master for every tile.
This writes, next to the existing thumbs/ folder:

    images/shelving/configs/w400/<name>.jpg    tiles at 1x
    images/shelving/configs/w800/<name>.jpg    tiles at 2x, the feature crops
    images/shelving/configs/w1100/<name>.jpg   tiles at 3x

and the same three widths for the homepage cover in images/home/ and for the
older shots in images/shelving/ (the featured strip on /shelving and the blog
posts). The masters are left untouched and stay the largest srcset candidate,
so the lightbox on /shelving still opens the full file.

Nothing is ever upscaled: when a master is narrower than a target width the
copy is written at the master's own width under that folder, so every name the
markup asks for exists. That only happens for the handful of older, smaller
masters, where the srcset descriptor then overstates the width slightly; the
tile renders exactly as it does today.

Re-run after adding a product (scripts/import-shelving-product.mjs does not
call this yet):

    python3 scripts/build-responsive-images.py            # only missing or stale
    python3 scripts/build-responsive-images.py --force    # rewrite everything

Needs Pillow.
"""
import os
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
WIDTHS = (400, 800, 1100)
QUALITY = 78
SETS = (
    ROOT / "images" / "shelving" / "configs",
    ROOT / "images" / "home",
    ROOT / "images" / "shelving",
)


def build(src: Path, dest: Path, width: int, force: bool) -> str:
    if not force and dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        return "kept"
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        if im.width > width:
            height = round(im.height * width / im.width)
            im = im.resize((width, height), Image.LANCZOS)
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    return "wrote"


def main() -> int:
    force = "--force" in sys.argv[1:]
    counts = {"wrote": 0, "kept": 0}
    bytes_master = 0
    bytes_out = {w: 0 for w in WIDTHS}
    for folder in SETS:
        masters = sorted(p for p in folder.glob("*.jpg") if p.is_file())
        for src in masters:
            bytes_master += src.stat().st_size
            for width in WIDTHS:
                dest = folder / f"w{width}" / src.name
                counts[build(src, dest, width, force)] += 1
                bytes_out[width] += dest.stat().st_size
    print(f"{counts['wrote']} written, {counts['kept']} already current")
    print(f"masters: {bytes_master // 1024} KB total")
    for width in WIDTHS:
        print(f"w{width}: {bytes_out[width] // 1024} KB total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
