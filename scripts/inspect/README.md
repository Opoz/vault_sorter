# Inspecting Vault parts

Tools for working out how a part sits in a tower: read a part's shape from its STL, find where it joins its
neighbours, then render the 3D view to check. They were used to place every part in `src/scene/assembly.ts`
(see docs/adr/0006). They read the user's own Vault download, which is git-ignored and never committed (ADR 0001).

The approach, in short: measure the feature a part joins by (a bore, a pocket, a bolt hole, a recess) and place the
part by it, not by the middle of its bounding box; then render and check with the user against the manual.

## Reading a part

All take a binary STL. `side` is `+x`, `-x`, `+y`, `-y`, `+z` or `-z`: the side you look from.

- **`node profile.mjs <stl> <side> <step mm> [deg|auto] [offset mm]`** prints a depth map: each character is how far
  below the nearest surface that spot is (`.` = 0, digits in mm, `#` = 9+, space = nothing there). `deg` first turns
  the file about its z to square up a file stored at an angle on the bed (`auto` finds the angle that squares it;
  try ±90 if width and thickness come out swapped). `offset` subtracts mm from every digit, to read surfaces deep
  inside a hollow part.
- **`python bores.py <stl> <side> <step mm> [deg]`** lists through-holes seen from that side, with their centres and
  rough diameters. Blind holes don't show; read those off `profile.mjs` with an offset.
- **`python faces.py <stl> [deg]`** summarises all six faces (how much is flat, shallow, deep or empty): the flat face
  is usually the one printed on the bed; the detailed one is often the face that mates with another part.
- **`node pieces.mjs <stl...>`** lists the loose pieces in a file and their sizes (files often hold a pair: both
  hinges, both rails, four pins).
- **`node wallslice.mjs <stl> <deg> <from mm> <to mm>`** scatters the vertices in a slab across the squared-up
  width, to find a slot or socket hidden inside a wall.
- **`node heightmap.mjs <stl> <side> <out.png>`** writes a shaded depth image.

Things learned along the way: many roofs, bases, lids and the L/XL Modules are stored on end and turned about 45° on
the bed; S and M versions of a part can be stored differently from L and XL; a split part's halves sit in the whole
part's place in the file, with Part 1 at the back.

## Rendering the 3D view

**`node render.mjs <out.png> <az,el> <spread 0–1> <roof> <only-regex> <palette index> <depth> [plate|rails]`** opens the
planner in Edge (headless), places one unit from the palette (index into the drawer and sustainer buttons, e.g.
0 = S 1F drawer, 9 = XL 1F drawer, 10 = S 1F sustainer), loads the Vault folder into the 3D view and saves a
screenshot. `only-regex` keeps just the parts whose file names match (empty for all); `plate` adds a Gridfinity
baseplate, `rails` geared rails.

Start the dev server first (`npm run dev`). Settings through the environment:

| Variable | Does |
|---|---|
| `PLANNER_URL` | the planner's address (default `http://localhost:5173/`) |
| `VAULT_DIR` | the Vault download (default `261021_VAULT_USSA_S` at the repo root) |
| `Q=High` | the Detail switch (`Low`, `Medium`, `High`) |
| `DPR=2` | render at 2× resolution |
| `NOSEL=1` | don't select the unit (so nothing is faded) |
| `BOTTOM=wheels\|feet\|casters`, `BACKBONE=matching\|universal`, `STAT=1`, `PULL=1`, `PEG=skadis\|ussa`, `WALL=1`, `SPLIT=split`, `BOXES=2F+1F+1F` | tower and unit options |

The roof is the fourth argument (`none`, `grid`, `bowl`, `table`, `heavyweight`, `under table mount`).
