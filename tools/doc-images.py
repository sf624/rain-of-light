"""Builds the pictures of docs/settings.md from the shots of tools/doc-shots.mjs.

    node tools/doc-shots.mjs /tmp/shots              # needs Chrome, see tools/page.mjs
    python3 -I tools/doc-images.py /tmp/shots docs/img   # needs Pillow

A figure of one cell becomes one JPEG, 960 px wide. A figure of several
becomes a grid (`cols` columns, `width` px wide, 1600 by default), each cell
(cropped first, if the cell says so) with its label (the setting that made it) in its lower left corner. JPEG
quality 82, lowered step by step if a picture would pass 200 KB.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SRC, DST = sys.argv[1], sys.argv[2]
GAP = 4
MAX_BYTES = 200_000
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(size):
    try:
        return ImageFont.truetype(FONT, size)
    except OSError:
        return ImageFont.load_default()


def label(im, text):
    if not text:
        return
    d = ImageDraw.Draw(im, "RGBA")
    f = font(max(12, im.width // 30))
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
    pad = 5
    y = im.height - (y1 - y0) - 2 * pad - 6
    d.rectangle((6, y, 6 + x1 - x0 + 2 * pad, y + y1 - y0 + 2 * pad), fill=(0, 0, 0, 170))
    d.text((6 + pad - x0, y + pad - y0), text, font=f, fill=(235, 235, 235, 255))


def build(name):
    d = os.path.join(SRC, name)
    meta = json.load(open(os.path.join(d, "cells.json")))
    shots = [Image.open(os.path.join(d, f"{i}.png")).convert("RGB") for i in range(len(meta["labels"]))]
    for i, c in enumerate(meta.get("crops") or []):
        if c:
            w, h = shots[i].size
            shots[i] = shots[i].crop((round(c[0] * w), round(c[1] * h), round(c[2] * w), round(c[3] * h)))
    cols = meta["cols"]
    if len(shots) == 1:
        width = meta.get("width") or 960
        im = shots[0].resize((width, round(shots[0].height * width / shots[0].width)), Image.LANCZOS)
        label(im, meta["labels"][0])
    else:
        width = meta.get("width") or 1600
        cw = (width - GAP * (cols - 1)) // cols
        ch = round(shots[0].height * cw / shots[0].width)
        rows = -(-len(shots) // cols)
        im = Image.new("RGB", (cw * cols + GAP * (cols - 1), ch * rows + GAP * (rows - 1)), (40, 40, 40))
        for i, s in enumerate(shots):
            cell = s.resize((cw, ch), Image.LANCZOS)
            label(cell, meta["labels"][i])
            im.paste(cell, ((i % cols) * (cw + GAP), (i // cols) * (ch + GAP)))
    path = os.path.join(DST, name + ".jpg")
    for q in (82, 76, 70, 64, 58):
        im.save(path, "JPEG", quality=q, optimize=True, progressive=True)
        if os.path.getsize(path) <= MAX_BYTES:
            break
    print(f"{path}: {im.width}x{im.height}, quality {q}, {os.path.getsize(path) / 1e3:.0f} KB")


os.makedirs(DST, exist_ok=True)
only = sys.argv[3:]
for name in sorted(os.listdir(SRC)):
    if os.path.isfile(os.path.join(SRC, name, "cells.json")) and (not only or name in only):
        build(name)
