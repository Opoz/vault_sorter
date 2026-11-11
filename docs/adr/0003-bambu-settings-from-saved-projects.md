# Bambu project settings come from projects Bambu Studio saved, one per printer

A Bambu project must carry Bambu Studio's full settings (about 636 values for the H2S); naming the profiles alone crashes Bambu Studio's command line. We take those settings from a project the Bambu Studio app itself saved for each printer with Bambu PLA Basic and Bambu TPU 95A loaded. At export we only rebuild the per-filament lists for our slots (PLA Body, PLA Accent, TPU) and set the colours. A printer can only be exported to once someone has supplied such a project for it.

## Considered Options

- **Flatten Bambu's profile files ourselves.** Reproduced only 380 of 636 values: the rest are defaults built into Bambu Studio and per-nozzle expansions. Too fragile.
- **Have Bambu Studio's command line load the profiles and save a project.** It does not apply profile inheritance the way the app does; 217 values came out different (support type, bed type, G-code).
- **Name the profiles only.** Bambu Studio's command line crashes on load.

## Consequences

Each supported printer needs one saved project (a one-off), and its settings may lag Bambu Studio updates until re-captured. Exports are checked by slicing them with Bambu Studio's command line.
