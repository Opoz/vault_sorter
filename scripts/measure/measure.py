"""Measure every Vault STL and write the part measurements the planner ships (see docs/adr/0001).

Usage (from this folder):
    .venv/Scripts/python -I measure.py <vault folder> [out json]

Per part, in the orientation the file is stored in (its print orientation):
    size     bounding size [x, y, z] in mm
    volume   mesh volume in mm^3
    area     surface area in mm^2 (for estimating printed weight: walls follow the surface)
    triangles  triangle count (for estimating the size of an exported project)
    outline  top-down convex outline, at most MAX_OUTLINE corners, relative to the bounding-box
             corner and drawn slightly outside the part, so a fit test on it never over-promises.
No geometry beyond that leaves this script. The input folder is only read.
"""
import json
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from scipy.spatial import ConvexHull

MAX_OUTLINE = 32
CHUNK = 1_000_000  # triangles per read
TRI_DTYPE = np.dtype([("n", "<f4", (3,)), ("v", "<f4", (3, 3)), ("attr", "<u2")])


def _triangle_chunks(path):
    """Yield (n, 3, 3) float64 vertex arrays. Binary STL, with an ASCII fallback."""
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        head = f.read(84)
    count = int(np.frombuffer(head[80:84], "<u4")[0]) if len(head) == 84 else -1
    if count >= 0 and 84 + 50 * count == size:
        for start in range(0, count, CHUNK):
            n = min(CHUNK, count - start)
            arr = np.fromfile(path, dtype=TRI_DTYPE, count=n, offset=84 + 50 * start)
            yield arr["v"].astype(np.float64)
        return
    text = Path(path).read_text(errors="replace").split()
    coords = [float(text[i + 1 + k]) for i, w in enumerate(text) if w == "vertex" for k in range(3)]
    yield np.array(coords, dtype=np.float64).reshape(-1, 3, 3)


def _hull_2d(points):
    if len(points) < 3:
        return points
    return points[ConvexHull(points).vertices]  # counter-clockwise


def _line_intersection(p1, d1, p2, d2):
    """Intersection of p1 + t*d1 and p2 + s*d2, or None if (nearly) parallel."""
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-12:
        return None
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
    return p1 + t * d1


def _simplify_outward(poly, max_points):
    """Reduce a counter-clockwise convex polygon to max_points corners without cutting into it.

    Removing edge i (from corner i to i+1) extends its neighbouring edges until they meet,
    which only ever adds area outside the polygon. Repeatedly remove the edge whose new corner
    sticks out least, so the outline stays within a small, even distance of the part."""
    pts = [np.asarray(p, dtype=np.float64) for p in poly]
    while len(pts) > max_points:
        n = len(pts)
        best = None
        for i in range(n):
            a, b = pts[i], pts[(i + 1) % n]
            prev_dir = a - pts[i - 1]
            next_dir = pts[(i + 2) % n] - b
            meet = _line_intersection(a, prev_dir, b, next_dir)
            if meet is None:
                continue
            # The meeting point must lie ahead of a along prev_dir (outside, not behind the polygon).
            if np.dot(meet - a, prev_dir) < 0:
                continue
            edge = b - a
            length = math.hypot(edge[0], edge[1])
            if length < 1e-12:
                best = (0.0, i, a)
                break
            sticks_out = abs(edge[0] * (meet[1] - a[1]) - edge[1] * (meet[0] - a[0])) / length
            if best is None or sticks_out < best[0]:
                best = (sticks_out, i, meet)
        if best is None:
            break
        _, i, meet = best
        n = len(pts)
        j = (i + 1) % n
        pts[i] = meet
        del pts[j]
    return np.array(pts)


def _round_outward(poly, decimals=2):
    """Round each corner away from the polygon's centre, so rounding never shrinks it."""
    scale = 10 ** decimals
    cx, cy = poly.mean(axis=0)
    out = []
    for x, y in poly:
        rx = (math.ceil(x * scale - 1e-9) if x >= cx else math.floor(x * scale + 1e-9)) / scale
        ry = (math.ceil(y * scale - 1e-9) if y >= cy else math.floor(y * scale + 1e-9)) / scale
        out.append([rx, ry])
    return out


def measure_file(path):
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    volume = 0.0
    area = 0.0
    triangles = 0
    hull = np.empty((0, 2))
    for v in _triangle_chunks(path):
        triangles += len(v)
        v = v[np.isfinite(v).all(axis=(1, 2))]
        if len(v) == 0:
            continue
        a, b, c = v[:, 0], v[:, 1], v[:, 2]
        volume += float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum()) / 6.0
        area += float(np.linalg.norm(np.cross(b - a, c - a), axis=1).sum()) / 2.0
        p = v.reshape(-1, 3)
        lo = np.minimum(lo, p.min(axis=0))
        hi = np.maximum(hi, p.max(axis=0))
        hull = _hull_2d(np.vstack([hull, p[:, :2]]))
    outline = _simplify_outward(hull - lo[:2], MAX_OUTLINE)
    return {
        "size": [round(float(s), 2) for s in hi - lo],
        "volume": round(abs(volume), 1),  # one known file is wound inside-out; magnitude is what matters
        "area": round(area, 1),
        "triangles": triangles,
        "outline": _round_outward(outline),
    }


def _measure_one(args):
    root, rel = args
    try:
        return rel, measure_file(root / rel), None
    except Exception as e:  # report and keep going; a failed part must not hide the others
        return rel, None, f"{type(e).__name__}: {e}"


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    root = Path(argv[1])
    out = Path(argv[2]) if len(argv) > 2 else Path(__file__).resolve().parents[2] / "src" / "data" / "parts.json"
    rels = sorted(
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.suffix.lower() == ".stl" and "__MACOSX" not in p.parts and not p.name.startswith("._")
    )
    start = time.time()
    parts, errors = [], []
    with ProcessPoolExecutor() as pool:
        for rel, m, err in pool.map(_measure_one, [(root, r) for r in rels], chunksize=4):
            if err:
                errors.append((rel, err))
            else:
                parts.append({"path": rel, **m})
    out.parent.mkdir(parents=True, exist_ok=True)
    data = {"source": root.name, "maxOutlinePoints": MAX_OUTLINE, "parts": parts}
    out.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(parts)} parts measured in {time.time() - start:.0f}s -> {out}")
    for rel, err in errors:
        print(f"FAILED {rel}: {err}", file=sys.stderr)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
