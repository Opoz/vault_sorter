# Finds through-holes (bores) seen along one axis, and the nearest-face blob, per piece, in mm relative to each
# piece's bounding-box middle. Usage: python bores.py <stl> <side> <step> [squareUpDeg]
import os, sys, re, subprocess, collections
f, side, step = sys.argv[1], sys.argv[2], float(sys.argv[3])
out = subprocess.run(['node', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'profile.mjs'), f, side, str(step)] + sys.argv[4:5], capture_output=True, text=True).stdout.split('\n')
hdr = out[0]; rows = [r for r in out[1:]]
while rows and not rows[-1].strip(): rows.pop()
m = re.search(r'u=(\w) (-?[\d.]+)\.\.(-?[\d.]+), v=(\w) (-?[\d.]+) \(top\)\.\.(-?[\d.]+)', hdr)
ua, u0, u1, va, vtop, vbot = m.group(1), float(m.group(2)), float(m.group(3)), m.group(4), float(m.group(5)), float(m.group(6))
H = len(rows); W = max(len(r) for r in rows)
grid = [r.ljust(W) for r in rows]
# empty cells connected to the border are outside; the rest are holes
seen = [[False] * W for _ in range(H)]
q = collections.deque()
for i in range(H):
    for j in range(W):
        if (i in (0, H - 1) or j in (0, W - 1)) and grid[i][j] == ' ':
            seen[i][j] = True; q.append((i, j))
while q:
    i, j = q.popleft()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + di, j + dj
        if 0 <= a < H and 0 <= b < W and not seen[a][b] and grid[a][b] == ' ':
            seen[a][b] = True; q.append((a, b))
holes = []
lab = [[0] * W for _ in range(H)]
n = 0
for i in range(H):
    for j in range(W):
        if grid[i][j] == ' ' and not seen[i][j] and not lab[i][j]:
            n += 1; cells = []; q = collections.deque([(i, j)]); lab[i][j] = n
            while q:
                a, b = q.popleft(); cells.append((a, b))
                for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    c, d = a + di, b + dj
                    if 0 <= c < H and 0 <= d < W and grid[c][d] == ' ' and not seen[c][d] and not lab[c][d]:
                        lab[c][d] = n; q.append((c, d))
            if len(cells) >= 4:
                ci = sum(c[0] for c in cells) / len(cells); cj = sum(c[1] for c in cells) / len(cells)
                holes.append((u0 + cj * step, vtop - ci * step, (len(cells) * step * step / 3.1416) ** 0.5 * 2))
print(hdr[:60])
for u, v, d in holes:
    print('  hole at %s=%.2f %s=%.2f  diameter ~%.1f' % (ua, u, va, v, d))
