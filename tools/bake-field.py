#!/usr/bin/env python3
"""Bakes a closed shape into a field of signed distances for a form of light.

    python3 -I tools/bake-field.py NAME SOURCE [OUT] [--preview PNG]

NAME is an entry of tools/fields.json (where the shape comes from, its terms,
how to stand it upright); SOURCE is the downloaded file it names (read as
data only: a mesh, or the patch table of a C file, never run). OUT is the
field file (default fields/NAME.bin); --preview writes the field's three
silhouettes and a slice, to check the pose by eye.

The steps (see "The baked forms" in docs/design.md):
1. read the triangles (PLY or OBJ meshes; Bezier patches, tessellated here);
2. stand them upright, centred in x and z, the largest extent 1.8 wide, the
   base at y = -0.9, in the box [-1, 1]^3 the field covers;
3. close every hole: each loop of edges that only one triangle uses is
   capped with a fan of triangles from its centre;
4. mark the cells of a fine grid that the surface passes through (and, with
   `close`, the cells that near: small gaps between parts close), then fill
   the outside from the box's walls; what the fill does not reach is inside;
5. sample the signed distance to that solid's outer skin at the centres of
   a coarse grid (negative inside), and store it as one byte per cell.

The file: 16 bytes of header (b"FLD1", the cells along x, y and z as
uint16, the reach R as float32, 2 bytes of padding; little-endian), then
one byte per cell, x fastest, then y, then z: 128 + 127 * d / R, clamped
(1 .. 255), so a distance beyond R reads as R.
"""

import argparse
import json
import os
import re
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SPAN = 1.8          # the shape's largest extent in the box [-1, 1]
BASE = -0.9         # where its base stands


def read_ply(path):
    """An ASCII PLY: its vertices' x, y, z and its faces (fans of triangles)."""
    with open(path, "rb") as fh:
        lines = fh.read().decode("ascii").splitlines()
    i, nv, nf, props = 0, 0, 0, []
    if lines[0].strip() != "ply" or "ascii" not in lines[1]:
        raise SystemExit(f"{path}: not an ASCII PLY")
    element = None
    while lines[i].strip() != "end_header":
        w = lines[i].split()
        if w[:1] == ["element"]:
            element = w[1]
            if element == "vertex":
                nv = int(w[2])
            elif element == "face":
                nf = int(w[2])
        elif w[:1] == ["property"] and element == "vertex":
            props.append(w[-1])
        i += 1
    i += 1
    v = np.array([[float(x) for x in lines[i + k].split()] for k in range(nv)])
    v = v[:, [props.index("x"), props.index("y"), props.index("z")]]
    tris = []
    for k in range(nf):
        w = [int(x) for x in lines[i + nv + k].split()]
        idx = w[1:1 + w[0]]
        tris += [[idx[0], idx[j], idx[j + 1]] for j in range(1, len(idx) - 1)]
    return v, np.array(tris)


def read_obj(path):
    """A Wavefront OBJ: its vertices and its faces (fans of triangles)."""
    v, tris = [], []
    with open(path, "rb") as fh:
        for line in fh.read().decode("ascii", "replace").splitlines():
            w = line.split()
            if not w:
                continue
            if w[0] == "v":
                v.append([float(x) for x in w[1:4]])
            elif w[0] == "f":
                idx = [int(x.split("/")[0]) for x in w[1:]]
                idx = [k - 1 if k > 0 else len(v) + k for k in idx]
                tris += [[idx[0], idx[j], idx[j + 1]] for j in range(1, len(idx) - 1)]
    return np.array(v), np.array(tris)


def read_patches(path, steps=24):
    """Bicubic Bezier patches from a C file's tables: an int table of 4 x 4
    control points per patch (`Patches[...]`) and a table of their x, y, z
    (`Verts[...]`), indices from 0, as in the teapot of Eric Haines's
    Standard Procedural Databases. Each patch is cut into steps x steps
    quads, two triangles each."""
    with open(path, "rb") as fh:
        text = fh.read().decode("ascii", "replace")
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)

    def table(name):
        m = re.search(name + r"\s*\[[^=]*=\s*\{(.*?)\}\s*;", text, re.S)
        if not m:
            raise SystemExit(f"{path}: no table {name}")
        return np.array([float(x) for x in re.findall(r"-?\d+\.?\d*(?:[eE][-+]?\d+)?", m.group(1))])

    patches = table("Patches").astype(int).reshape(-1, 4, 4)
    cp = table("Verts").reshape(-1, 3)
    t = np.linspace(0, 1, steps + 1)
    b = np.stack([(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t ** 2 * (1 - t), t ** 3], 1)   # Bernstein, (steps+1, 4)
    verts, tris = [], []
    for p in patches:
        g = cp[p]                                         # (4, 4, 3)
        s = np.einsum("ui,ijk,vj->uvk", b, g, b).reshape(-1, 3)
        base = sum(len(x) for x in verts)
        verts.append(s)
        n = steps + 1
        for r in range(steps):
            for c in range(steps):
                a = base + r * n + c
                tris += [[a, a + 1, a + n + 1], [a, a + n + 1, a + n]]
    return np.concatenate(verts), np.array(tris)


READERS = {"ply": read_ply, "obj": read_obj, "patches": read_patches}
UP = {  # the model's up axis -> y up (a turn of the whole model, right-handed)
    "y": lambda v: v,
    "z": lambda v: np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1),
}


def stand(v, spec):
    """Upright, turned about the vertical, centred in x and z, base at BASE, SPAN wide."""
    v = UP[spec.get("up", "y")](v.astype(float))
    a = np.radians(spec.get("turn", 0))
    c, s = np.cos(a), np.sin(a)
    v = np.stack([c * v[:, 0] + s * v[:, 2], v[:, 1], -s * v[:, 0] + c * v[:, 2]], 1)
    lo, hi = v.min(0), v.max(0)
    k = SPAN / (hi - lo).max()
    centre = (lo + hi) / 2
    v = (v - centre) * k
    v[:, 1] += BASE - v[:, 1].min()
    return v


def weld(v, tris):
    """One vertex per place (patches share their edges), no degenerate triangles."""
    key = np.round(v / 1e-6).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1)
    tris = inv[tris]
    ok = (tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])
    return v[first], tris[ok]


def cap_holes(v, tris):
    """Caps each loop of boundary edges (used by one triangle only) with a fan."""
    e = np.sort(np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]]), 1)
    u, count = np.unique(e, axis=0, return_counts=True)
    edges = u[count == 1]
    nxt = {}
    for a, b in edges:
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)
    seen, loops = set(), []
    for start in nxt:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            ways = [x for x in nxt[cur] if x != prev and x not in seen]
            if not ways:
                break
            prev, cur = cur, ways[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    v = list(v)
    extra = []
    for loop in loops:
        if len(loop) < 3:
            continue
        c = len(v)
        v.append(np.mean([v[i] for i in loop], 0))
        extra += [[c, loop[i], loop[(i + 1) % len(loop)]] for i in range(len(loop))]
    tris = np.concatenate([tris, np.array(extra, dtype=tris.dtype).reshape(-1, 3)])
    return np.array(v), tris, [len(x) for x in loops]


def surface_points(v, tris, spacing):
    """Points on every triangle, no farther apart than spacing."""
    a, b, c = v[tris[:, 0]], v[tris[:, 1]], v[tris[:, 2]]
    longest = np.max([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1), np.linalg.norm(a - c, axis=1)], 0)
    steps = np.maximum(1, np.ceil(longest / spacing)).astype(int)
    out = []
    for n in np.unique(steps):
        sel = steps == n
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = i + j <= n
        u, w = (i[keep] / n)[:, None], (j[keep] / n)[:, None]   # (k, 1)
        A, B, C = a[sel][:, None], b[sel][:, None], c[sel][:, None]
        out.append((A + (B - A) * u[None] + (C - A) * w[None]).reshape(-1, 3))
    return np.concatenate(out)


def shifted(m, axis, step):
    """m moved one cell along axis, the cell that comes in False."""
    r = np.roll(m, step, axis)
    idx = [slice(None)] * 3
    idx[axis] = 0 if step > 0 else -1
    r[tuple(idx)] = False
    return r


def grow(m, times=1):
    for _ in range(times):
        g = m.copy()
        for axis in range(3):
            g |= shifted(m, axis, 1) | shifted(m, axis, -1)
        m = g
    return m


def solid(points, fine, close):
    """The cells of a fine grid inside the shape: those the fill from outside does not reach."""
    h = 2.0 / fine
    cell = np.clip(np.floor((points + 1) / h).astype(int), 0, fine - 1)
    skin = np.zeros((fine,) * 3, bool)
    skin[cell[:, 0], cell[:, 1], cell[:, 2]] = True
    wall = grow(skin, close)
    out = np.zeros_like(wall)
    for axis in range(3):
        for end in (0, -1):
            idx = [slice(None)] * 3
            idx[axis] = end
            out[tuple(idx)] = True
    out &= ~wall
    while True:
        more = grow(out) & ~wall
        if (more == out).all():
            break
        out = more
    # The gaps closed: the outside comes back as far as the wall had grown.
    out = grow(out, close) & ~skin if close else out
    return ~out


def skin_points(inside, fine):
    """The faces between inside and outside cells: points on the solid's outer skin."""
    h = 2.0 / fine
    pts = []
    for axis in range(3):
        a = inside[tuple(slice(0, -1) if k == axis else slice(None) for k in range(3))]
        b = inside[tuple(slice(1, None) if k == axis else slice(None) for k in range(3))]
        idx = np.argwhere(a != b).astype(float)
        idx += 0.5
        idx[:, axis] += 0.5
        pts.append(idx * h - 1)
    return np.concatenate(pts)


def signed_distance(inside, fine, cells, reach):
    """At each coarse cell's centre: the distance to the outer skin, negative inside."""
    skin = skin_points(inside, fine).astype(np.float32)
    c = (np.arange(cells) + 0.5) * (2.0 / cells) - 1
    z, y, x = np.meshgrid(c, c, c, indexing="ij")
    q = np.stack([x.ravel(), y.ravel(), z.ravel()], 1).astype(np.float32)
    d = np.empty(len(q), np.float32)
    s2 = (skin ** 2).sum(1)
    for i in range(0, len(q), 512):
        p = q[i:i + 512]
        d2 = (p ** 2).sum(1)[:, None] + s2[None] - 2 * p @ skin.T
        d[i:i + 512] = np.sqrt(np.maximum(d2.min(1), 0))
    f = np.clip(np.floor((q + 1) / (2.0 / fine)).astype(int), 0, fine - 1)
    d[inside[f[:, 0], f[:, 1], f[:, 2]]] *= -1
    return np.clip(d, -reach, reach).reshape(cells, cells, cells)   # [z][y][x]


def preview(d, path):
    from PIL import Image
    n = d.shape[0]
    ins = d < 0
    views = [ins.any(0)[::-1], ins.any(2).T[::-1], ins.any(1)]     # seen along z (its side), along x (its front), from above
    mid = (np.clip(-d[n // 2] / d.max(), -1, 1) * 0.5 + 0.5)[::-1]  # the middle slice in z
    imgs = [Image.fromarray((v * 255).astype(np.uint8)) for v in views] + [Image.fromarray((mid * 255).astype(np.uint8))]
    sheet = Image.new("L", (n * 4 + 12, n), 40)
    for k, im in enumerate(imgs):
        sheet.paste(im, (k * (n + 4), 0))
    sheet.resize((sheet.width * 4, sheet.height * 4), Image.NEAREST).save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("name")
    ap.add_argument("source")
    ap.add_argument("out", nargs="?")
    ap.add_argument("--preview")
    args = ap.parse_args()
    with open(os.path.join(HERE, "fields.json")) as fh:
        conf = json.load(fh)
    spec, common = conf["fields"][args.name], conf["grid"]
    v, tris = READERS[spec["format"]](args.source)
    v = stand(v, spec)
    v, tris = weld(v, tris)
    v, tris, loops = cap_holes(v, tris)
    fine, cells, reach = common["fine"], common["cells"], common["reach"]
    pts = surface_points(v, tris, 0.35 * 2.0 / fine)
    inside = solid(pts, fine, spec.get("close", 0))
    d = signed_distance(inside, fine, cells, reach)
    b = np.clip(np.round(128 + 127 * d / reach), 1, 255).astype(np.uint8)
    out = args.out or os.path.join(HERE, "..", "fields", f"{args.name}.bin")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "wb") as fh:
        fh.write(b"FLD1" + struct.pack("<3Hf2x", cells, cells, cells, reach) + b.tobytes())
    hi = v.max(0)
    print(f"{args.name}: {len(tris)} triangles, {len(loops)} holes capped (edges {sorted(loops)[:8]}), "
          f"top at y = {hi[1]:.3f}, inside {inside.mean() * 100:.1f}% of the fine grid; "
          f"{os.path.relpath(out)} {os.path.getsize(out)} bytes", file=sys.stderr)
    if args.preview:
        preview(d, args.preview)


if __name__ == "__main__":
    main()
