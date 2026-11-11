"""Tests for the measurement script, at its public seam: measure_file(path)."""
import math
import struct
import tempfile
import unittest
from pathlib import Path

from measure import measure_file


def write_binary_stl(path, triangles):
    with open(path, "wb") as f:
        f.write(b"\0" * 80)
        f.write(struct.pack("<I", len(triangles)))
        for a, b, c in triangles:
            f.write(struct.pack("<3f", 0, 0, 0))
            for v in (a, b, c):
                f.write(struct.pack("<3f", *v))
            f.write(b"\0\0")


def box(x0, y0, z0, dx, dy, dz):
    """Closed, outward-wound box as 12 triangles."""
    p = [(x0 + i * dx, y0 + j * dy, z0 + k * dz) for k in (0, 1) for j in (0, 1) for i in (0, 1)]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    tris = []
    for a, b, c, d in faces:
        tris += [(p[a], p[b], p[c]), (p[a], p[c], p[d])]
    return tris


def cylinder(r, h, segments):
    """Closed, outward-wound cylinder around the Z axis."""
    ring = [(r * math.cos(2 * math.pi * i / segments), r * math.sin(2 * math.pi * i / segments)) for i in range(segments)]
    tris = []
    for i in range(segments):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % segments]
        tris += [((0, 0, 0), (x2, y2, 0), (x1, y1, 0)), ((0, 0, h), (x1, y1, h), (x2, y2, h))]
        tris += [((x1, y1, 0), (x2, y2, 0), (x2, y2, h)), ((x1, y1, 0), (x2, y2, h), (x1, y1, h))]
    return tris, ring


def point_in_convex(poly, x, y, tol=1e-6):
    n = len(poly)
    sign = 0
    for i in range(n):
        (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
        cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
        if abs(cross) <= tol:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            return False
    return True


class MeasureFileTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())

    def test_box_stored_at_an_offset_measures_its_true_size_volume_and_outline(self):
        path = self.dir / "box.stl"
        write_binary_stl(path, box(5, 5, 100, 10, 20, 30))

        m = measure_file(path)

        self.assertEqual(m["size"], [10.0, 20.0, 30.0])
        self.assertAlmostEqual(m["volume"], 6000.0, places=1)
        self.assertEqual(sorted(map(tuple, m["outline"])), [(0, 0), (0, 20), (10, 0), (10, 20)])

    def test_round_part_outline_is_simplified_but_never_cuts_into_the_part(self):
        path = self.dir / "cyl.stl"
        tris, ring = cylinder(50, 10, 200)
        write_binary_stl(path, tris)

        m = measure_file(path)

        outline = m["outline"]
        self.assertLessEqual(len(outline), 32)
        # Outline is relative to the part's bounding-box corner, which sits at (-50, -50).
        for x, y in ring:
            self.assertTrue(point_in_convex(outline, x + 50, y + 50), f"({x:.2f}, {y:.2f}) is outside the outline")
        # ...and stays close: no corner more than 1 mm (1% of the width) outside the circle.
        # A 200-sided circle is a worst case; real Vault parts measured at most 0.1 mm.
        for x, y in outline:
            self.assertLess(math.hypot(x - 50, y - 50), 51.0)


if __name__ == "__main__":
    unittest.main()
