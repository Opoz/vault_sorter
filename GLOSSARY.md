# Vault Planner

A planning tool for USSA's Vault 3D-printable modular storage system: you design towers of drawers and sustainers, and it tells you what to print and buy. Terms follow the official Vault manuals where they exist.

## Structure

**Layout**:
A named set of one or more Towers planned, printed and shared together.
_Avoid_: Project, plan, design, build

**Tower**:
One vertical stack: an optional Base, then Units, then a Roof. A Tower has one Width and one Depth.
_Avoid_: Stack, build

**Row**:
One horizontal layer of a Tower: either a single Unit of the Tower's Width, or two Columns side by side whose Widths add up to it (S+S for L, S+M or M+S for XL). A Row's height is its Columns' height, which must be the same for both.
_Avoid_: Floor (a Height measure), level, layer, shelf

**Column**:
One side of a split Row: a stack of Units of one Width, any mix of Heights, drawers or sustainers. Modules only connect at their top, so the two Columns of a Row need only reach the same total height (e.g. S4F + S1F beside S2F + S1F + S2F, both 5F); their joins needn't line up.
_Avoid_: Stack (a Tower is the stack), side

**Unit**:
One Module plus every part needed to make it work (its Box, Facade, runners and latch for a Drawer; its lid, hinges and locks for a Sustainer). A Tower is made of Units.
_Avoid_: Module (when the whole assembly is meant), slot

**Module**:
The outer shell of a Unit, a single printed part. The manuals never say "case"; the Module is the case.
_Avoid_: Case, shell, body

**Drawer**:
A Unit whose contents are reached through a Box that pulls out of the front.

**Sustainer**:
A Unit with a hinged lid on top and locks on the front, opened from above.
_Avoid_: Case, lidded box, chest

## Sizes

**Width**:
One of S, M, L or XL. An L equals two S side by side; an XL equals one S plus one M.

**Depth**:
A whole number of 42 mm Gridfinity units, from 3 to 7. Depth belongs to a Tower: every Unit in it shares the same Depth.

**Height**:
One of 1F, 2F or 4F, measured in floors (F). There is no 3F. XL exists in 1F only.
_Avoid_: Tier, level

**Size code**:
Width, then Depth, then Height, e.g. `S3 1F`. A Family is one Width across all its Depths, e.g. the S Family is S3 to S7.

## Printing

**Part**:
One printed copy of one Vault file. A Unit needs several Parts; print progress is counted in Parts.
_Avoid_: File, piece, model, STL (an STL is the source file a Part is printed from)

**Bambu project**:
The `.3mf` file exported for one Tower: its Parts arranged on Plates, with Bambu Studio's settings for the chosen printer, ready to open and print.
_Avoid_: Project (on its own), export, print file

**Plate**:
One print job's worth of Parts, arranged to fit the chosen printer's bed.
_Avoid_: Bed, batch, job

**Fit**:
Whether a Part, in the orientation its file is stored in, can be turned on the bed to lie within a printer's printable area. A **tight fit** leaves less than 2 mm to spare.
_Avoid_: Clearance (a separate margin we deliberately don't apply)

**Colour role**:
Which colour a part is printed in, chosen once per Layout, shown in this order. **Primary** (called `body` in code) covers Modules, Boxes, Roofs, Facades, Labels, Key Caps, drawer Latches and Bases; **Secondary** covers keys, sustainer lock outer parts and handles; **Accent** covers the runners (slides, guides and stoppers).
_Avoid_: Theme, palette, filament (a filament is the material loaded for a Colour role)

## Drawer parts

**Box**:
The tray that pulls out of a Drawer.
_Avoid_: Drawer (for the tray itself), tray, bin

**Facade**:
The front plate bolted to a Box. One Facade fits every Depth of its Width and Height.
_Avoid_: Front, face

## Tower parts

**Roof**:
The top cap of a Tower. Types are Grid, Table, Heavyweight, Bowl and Under Table Mount.
_Avoid_: Lid (lid is the Sustainer's hinged top), top

**Base**:
The bottom plate of a mobile Tower. Wheels, feet or casters attach to it.

**Backbone**:
A vertical rear plate bolted across stacked Modules to tie a Tower together.
