#!/usr/bin/env python3
"""Build the colour tiles for /colours from the catalogue photographs.

    python3 scripts/build-colour-tiles.py

Why this exists. The catalogue shots were taken on different days against
different backdrops, and each shelf sits at a different size in its own frame.
Laid out in a row that reads as four unrelated products rather than one
product in four colours, which is the whole job of that page. This puts them
on one paper, one floor line and one margin.

What it does NOT do is touch the colours. The paper is replaced only where a
pixel is backdrop, and the shelf and the shadow at its feet are composited
back over it unaltered. On this page of all pages the finish has to be true.

How a shelf is told from its backdrop: the steel and the boards are either
saturated (Marine, Sage, Coral) or much darker than the paper (Charcoal), and
the backdrop is neither. Two masks come out of that. The strict one is the
shelf alone and gives the crop, so a long cast shadow cannot drag the frame
sideways and leave the shelf off centre. The generous one includes the shadow,
feathered, and is what the picture is composited with, so the shelf still sits
on something.

Needs Pillow, numpy and scipy. Rerun it if a catalogue photograph is replaced.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "images/shelving/configs"
OUT = ROOT / "images/colours"

# The catalogue product behind each colour, and the tile it becomes.
TILES = {
    "quadruple-emptied": "quadruple",
    "versatile-stack-emptied": "versatile-stack",
    "low-console-emptied": "low-console",
    "wide-four-tier-emptied": "wide-four-tier",
    "multicolor-stack-emptied": "multicolor-stack",
}

# The two pictures further down the page, square, on the same paper. Without
# these the page has four tiles on one paper and two photographs on two others,
# which is exactly the mismatch this script exists to remove.
FEATURES = {
    "multicolor-stack-emptied": "multicolor-stack-feature",
    "high-low-emptied": "high-low-feature",
    # /how puts this one between two close details of a joint and a board edge.
    # Both of those are square and lose nothing, so this is square too, and on
    # the same paper: otherwise it reads as a photograph dropped between two
    # drawings.
    "stepped-display-emptied": "stepped-display-feature",
}

PAPER = np.array([248.0, 248.0, 247.0])
W, H = 1000, 1250          # 4:5, the ratio css/colours.css gives the tiles
SIDE = 0.92                # the widest a shelf may run
TOP = 0.05                 # air above
FLOOR = 0.06               # the floor line every shelf stands on


def disc(diameter: int) -> np.ndarray:
    r = diameter / 2 - 0.5
    y, x = np.ogrid[:diameter, :diameter]
    return ((x - r) ** 2 + (y - r) ** 2) <= r ** 2


def build(src: Path, dest: Path, size=(W, H)) -> str:
    im = Image.open(src).convert("RGB")
    hsv = np.asarray(im.convert("HSV")).astype(np.float32)
    saturation, value = hsv[..., 1] / 255.0, hsv[..., 2] / 255.0
    # The backdrop's own brightness, read from the top corners, because it is
    # lit differently in every photograph.
    paper_value = np.median(np.concatenate([value[0:50, 0:150].ravel(), value[0:50, -150:].ravel()]))

    strict = (saturation > 0.20) | (value < paper_value - 0.24)
    strict = ndimage.binary_closing(strict, np.ones((7, 7)))
    labels, count = ndimage.label(strict)
    strict = labels == (np.argmax(ndimage.sum(strict, labels, range(1, count + 1))) + 1)
    ys, xs = np.where(strict)
    box = [xs.min(), ys.min(), xs.max() + 1, ys.max() + 1]

    generous = (saturation > 0.10) | (value < paper_value - 0.06)
    # A highlight on a pale board reads exactly like paper: on The Stepped
    # Display a lit board is S=0.04 V=0.96 and the backdrop beside it is
    # S=0.03 V=0.97, so no threshold can tell them apart and the boards came
    # out with holes punched in them. Closing bridges a highlight, which is
    # narrow and ringed by the board's own edges, while the gaps between tiers
    # are far wider than the kernel and stay paper.
    generous = ndimage.binary_closing(generous, disc(23))
    # A crease or a shadow on the backdrop is darker than paper too, and
    # against a clean field it lands as a grey rag hanging in the air. Two
    # constraints, and both are needed: stay near the shelf, because the
    # backdrop of The Stepped Display creases right beside it and is joined to
    # it through the shelf edge; and touch the shelf, because the same crease
    # leaves crescents floating loose inside that neighbourhood.
    generous &= ndimage.binary_dilation(strict, disc(41))
    generous_labels, _ = ndimage.label(generous)
    touching = np.unique(generous_labels[strict])
    generous = np.isin(generous_labels, touching[touching > 0])
    generous = np.asarray(Image.fromarray((generous * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255.0
    pixels = np.asarray(im).astype(np.float32)
    flat = pixels * generous[..., None] + PAPER * (1 - generous[..., None])
    flattened = Image.fromarray(np.clip(flat, 0, 255).astype(np.uint8))

    pad = int(0.03 * max(box[2] - box[0], box[3] - box[1]))
    box = [max(0, box[0] - pad), max(0, box[1] - pad),
           min(im.width, box[2] + pad), min(im.height, box[3] + int(pad * 1.6))]
    w, h = size
    sw, sh = box[2] - box[0], box[3] - box[1]
    scale = min(w * SIDE / sw, h * (1 - TOP - FLOOR) / sh)

    canvas = Image.new("RGB", (w, h), tuple(PAPER.astype(int)))
    piece = flattened.crop(tuple(box)).resize((round(sw * scale), round(sh * scale)), Image.LANCZOS)
    canvas.paste(piece, ((w - piece.width) // 2, round(h * (1 - FLOOR)) - piece.height))
    canvas.save(dest, quality=90, optimize=True)
    return f"{src.name:30} shelf {sw}x{sh}  scale {scale:.2f}  -> {dest.name}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for source, name in TILES.items():
        print(build(SRC / f"{source}.jpg", OUT / f"{name}.jpg"))
    for source, name in FEATURES.items():
        print(build(SRC / f"{source}.jpg", OUT / f"{name}.jpg", size=(1100, 1100)))


if __name__ == "__main__":
    main()
