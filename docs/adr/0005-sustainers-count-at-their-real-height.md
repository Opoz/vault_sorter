# Sustainers count at their real height; the floor grid stays for editing

Drawers stack 48 mm a floor. Sustainers don't (issue #17). A Sustainer Module has the same 5 mm feet as a drawer's and stacks the same way, from its body to the top of its lid, plus the 1 mm drawers leave between floors. Every height shares one lid, whose top is 13.9 mm above the Module's rim:

| Height | Module body | Stacks | Drawer floors | Off by |
|---|---|---|---|---|
| 1F | 45.8 mm | 60.7 mm | 48 | +12.7 |
| 2F | 79.8 mm | 94.7 mm | 96 | −1.3 |
| 4F | 175.8 mm | 190.7 mm | 192 | −1.3 |

The Facades agree: a Sustainer Facade is exactly its Module body (46 / 80 / 176 mm). So 2F and 4F Sustainers fit their floors to a millimetre, but a 1F Sustainer is about a quarter of a floor too tall.

We keep laying out Towers on the floor grid (a 1F Sustainer still takes one floor in the editor), and use the real heights where they matter: the Tower's height, the 3D stack (a Row is as tall as its tallest Column), and a "Check:" warning when a split Row's Columns end more than 3 mm apart, as a 1F Sustainer beside a 1F drawer does. The heights are worked out from the files and flagged as inferred until checked on a real stack.

## Considered Options

- **Keep counting Sustainers as whole floors.** Simple, but the Tower's height and the 3D view were wrong, and a 1F Sustainer overlapped whatever sat on it. Rejected.
- **Lay out on real heights instead of floors.** Exact, but every editing rule (Columns reaching the same height, empty space, filling Rows) is built on whole floors, and only 1F Sustainers are off. Rejected.
- **Forbid 1F Sustainers in split Rows.** Avoids uneven Columns, but takes away a layout someone may want and is happy to shim. Rejected in favour of the warning (the user's choice).
