"""Builds the README's GIFs from the frames of tools/capture-frames.mjs.

    node tools/capture-frames.mjs /tmp/frames          # needs Chrome, see its header
    python3 -I tools/make-gifs.py /tmp/frames docs     # needs Pillow

Each scene's PNGs (960x540) are scaled down to 480x270. The last FADE frames
carry on past the loop point, and are cross-faded into the first ones, so the
loop has no jump. One adaptive palette per GIF, with error-diffusion dither
(the pictures are dark gradients: without dither they band), and frame
differencing (unchanged pixels are transparent), which is what keeps a GIF of
rain, which moves everywhere, near 2 MB. Frames are 80 ms (12.5 fps). Needs
Pillow and numpy.
"""
import os
import sys

import numpy as np
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
SIZE = (480, 270)
FADE = 12          # frames cross-faded into the start
DELAY_MS = 80
ATTEMPTS = [(96, 24), (96, 40), (96, 64), (64, 64), (64, 90), (48, 90)]  # (colours, tolerance: summed |dR|+|dG|+|dB| below which a pixel is left unchanged)
MAX_BYTES = 2.5e6
TRANSPARENT = 255


def load(path):
    return Image.open(path).convert("RGB").resize(SIZE, Image.LANCZOS)


def encode(out, pal, rgb, table, tol, path):
    # Frame differencing: a pixel whose colour is within tol of what the viewer
    # already sees is left transparent (the previous frame shows through). The
    # test is against the true picture, so errors do not add up.
    q, shown = [], None
    for f in out:
        idx = np.array(f.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG))
        if shown is None:
            cur, shown = idx, idx.copy()
        else:
            same = np.abs(np.array(f, dtype=np.int16) - table[shown]).sum(2) <= tol
            cur = np.where(same, TRANSPARENT, idx).astype(np.uint8)
            shown = np.where(same, shown, idx)
        im = Image.fromarray(cur)
        im.putpalette(rgb + [0] * (768 - len(rgb)))
        q.append(im)
    q[0].save(path, save_all=True, append_images=q[1:], duration=DELAY_MS, loop=0, optimize=False, disposal=1, transparency=TRANSPARENT)


def build(name):
    d = os.path.join(SRC, name)
    files = sorted(f for f in os.listdir(d) if f.endswith(".png"))
    frames = [load(os.path.join(d, f)) for f in files]
    n = len(frames) - FADE
    out = frames[:n]
    # frame n+i is the continuation of the last frame: blend it into frame i.
    for i in range(FADE):
        out[i] = Image.blend(frames[n + i], frames[i], (i + 1) / (FADE + 1))
    # One palette from frames spread over the clip (index 255 is "unchanged").
    sample = Image.new("RGB", (SIZE[0], SIZE[1] * 8))
    for k in range(8):
        sample.paste(out[k * n // 8], (0, k * SIZE[1]))
    path = os.path.join(DST, name + ".gif")
    # Coarser (fewer colours, then a wider tolerance) until the file is small enough.
    for colors, tol in ATTEMPTS:
        pal = sample.quantize(colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        rgb = pal.getpalette()[: colors * 3]
        table = np.array(rgb, dtype=np.int16).reshape(-1, 3)
        encode(out, pal, rgb, table, tol, path)
        if os.path.getsize(path) <= MAX_BYTES:
            break
    print(f"{path}: {n} frames, {n * DELAY_MS / 1000:.1f} s, {colors} colours, tolerance {tol}, {os.path.getsize(path) / 1e6:.2f} MB")


os.makedirs(DST, exist_ok=True)
for name in sorted(os.listdir(SRC)):
    if os.path.isdir(os.path.join(SRC, name)) and not name.startswith("chrome-"):
        build(name)
