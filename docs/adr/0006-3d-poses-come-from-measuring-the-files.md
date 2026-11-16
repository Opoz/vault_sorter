# 3D poses come from measuring the files, checked with the user

ADR 0004 says where each part sits is inferred and then checked. This records how. The manuals only picture the parts (and the Sustainers have no assembly manual at all), and eyeballing renders cost round after round of nudges. So each part's pose in `src/scene/assembly.ts` is set from measurements of the STL files themselves: the feature it joins by (a bore, a connector pocket, a bolt hole, a label recess) is found in both parts, and the part is placed by that feature rather than by the middle of its bounding box. The tools are in `scripts/inspect` (see its README).

A pose is then rendered and checked with the user against the manual or a product render. Each scene part carries a `checked` field naming what it was checked against; a part without one is still inferred, and the comment beside it says why it sits where it does.

The files have quirks a placement has to handle, found this way:

- Many files are stored on end and turned about 45° on the bed (most roofs, bases, Sustainer lids, the L and XL Modules, XL Boxes and baseplates). They're squared up first (`planTurn`), which leaves a half-turn to choose; a face that differs (clips, a flat underside, a hollow) settles it.
- Versions of one part can be stored differently by width: S and M Bases stand square, L and XL ones turned.
- A split part's halves are stored in the whole part's place in the file: Part 1 is the back half.
- Many files hold several loose pieces (both hinges, both rails, four lock pins), drawn piece by piece. That also showed the parts list was printing some of them twice.

## Considered Options

- **Infer poses from part sizes and the pictures alone.** Quick, but it got turns and offsets wrong often enough that every kind of part needed several rounds of correction. Kept only as the starting point.
- **Ask the user to place each part.** They know the product, but placing parts by hand in 3D is slow and needs measurements anyway. Rejected; the user checks poses instead.
