# The 3D view reads and simplifies parts in the browser

The 3D view (issue #9) draws the real Vault parts when the user has chosen their Vault folder. Following ADR 0001, the files are read at run time from that folder and never leave the browser: no upload, no server, and nothing derived from them is stored or shipped. Without a folder, each part is drawn as a plain box at its shipped, measured size.

The files are too heavy to draw as they are. One drawer is about 3 million triangles across its parts, and the largest files carry over 7 million, so a whole Tower would be tens of millions. Each file is therefore cut to a display copy of at most about 150,000 triangles (corners merged on a grid of 0.5 mm, coarsened until the target is met; the view's Detail switch trades this for 40,000 or 1 million), in a background worker so the planner stays responsive. Each file is read once per visit, however many times it's used. The copies live only in memory, for the view; print files always use the full meshes.

Where each part sits (its turn from the stored print orientation, and its place in the Unit) is inferred from the part sizes and the manuals' assembly pictures, and checked kind by kind against the manual with the user before being treated as known.

## Considered Options

- **Draw the full meshes.** Exact, but far too slow for whole Towers on ordinary computers. Rejected.
- **Keep simplified copies between visits (IndexedDB).** Faster second visits, but it keeps derived geometry around outside the user's own folder, and the folder read is already quick enough. Not done for now.
- **Proper mesh decimation (edge collapse).** Better looking at low triangle counts, but slower and more code; at a 1 mm grid, vertex clustering looks the same at Tower scale. Rejected for now.
