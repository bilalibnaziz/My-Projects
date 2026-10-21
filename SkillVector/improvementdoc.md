# IllustratorScale — Improvement Doc (Mega Upgrade)

> Goal: the vector tool designers choose **over** Illustrator: exact geometry, instant performance on huge
> files, automation built in, fully local. Every feature works **without AI**.

Status checked on 2026-10-12: 128/128 unit tests pass. The app is a fork of the Photoscale core plus
`src/core/vectorOps.ts` (820 lines) and `src/ui/VectorPanels.tsx`. Its work is still **uncommitted** on top of
the Photoscale snapshot `6bac5fd`.


## Review — 2026-10-18 (evening): Image Trace power-up + Image Trace tool

| Area | Before | Now |
| --- | --- | --- |
| Colours | k-means in RGB on a 24k sample; colour = cluster centre | Lab k-means over a histogram of **every** pixel; small but distinct colours keep their own colour; each path takes the true average of the pixels it covers (edges excluded). |
| Auto | A preset suggested in the studio only | **Auto** (default) reads each picture: pixel art / line art / logo / colour logo / greys / photo, how many colours flat art really has (blended edge pixels ignored), drops a flat coloured backdrop, fits small pictures closer. Shows why ("Colour Logo · backdrop dropped · …"). |
| Edge accuracy | Edges on the pixel grid; flats at a circle's extremes; notches from stray edge pixels | Sub-pixel edges from the anti-aliasing, lone edge pixels re-coloured, staircase smoothed before fitting. AA circle R 110: 23 → 7 anchors, max error 0.73 → 0.36 px. Layer boxes are the true curve bounds (not the handles). |
| Stacking | Abutting + hairline stroke | **Stack colours** (overlap): each colour runs under the ones above it, no seams, fewer anchors. |
| Line art | Filled outlines only | **Centerline**: thinned skeleton → open strokes of the measured ink width (spurs pruned, strokes joined at former junctions, dots kept). |
| Result | One group, compound path per colour | Grouped / Ungrouped / **Every shape separate**; Object ▸ Image Trace ▸ **Expand to Shapes** and **Ungroup** (also in the studio's clean-up). |
| Speed | Main thread (1–4 s freeze on big photos) | Web worker; the UI keeps answering (e2e checks < 250 ms). |
| Tool | Menu dialog (traced at full size on every slider move, placed at 0,0), buttons that ignored the layer position | **Image Trace tool** on the rail (⇧I): hover outlines a picture, click traces it, drag traces a region, ⌥-click picks exact colours. Options bar, Properties and the menu all use the same placed, shared settings. |

Tests: `tracer.test.ts` (19, incl. AA circle accuracy, auto colours, backdrop, overlap, split, centerline), `e2e/imagetrace.e2e.mjs` (19 checks, real pointer).

Still open: rotated picture layers (trace ignores rotation), gradient detection (gradient fills instead of bands), trace progress %.


## Review — 2026-10-18: gradient annotator, gradient strokes, global swatches, pattern fills

| Area | Before | Now |
| --- | --- | --- |
| Gradient on the canvas | Gradients could only be re-dragged from scratch; stops only in the panel | Gradient tool on a shape with a gradient shows the line, start / end handles and every stop (`core/gradientAnnotator.ts`): drag an end (⇧ = 45°), drag a stop along the line, pull it off to delete, click the line to add a stop in the colour already there. Works on rotated shapes; the picked stop is shared with the Appearance editor. |
| Gradient tool options | The options bar (Linear / Radial / Reflected, Foreground → Background / Transparent, Reverse) only drove pixel gradients | A new vector gradient follows them all (Reflected = mirrored about the press point). |
| Gradient strokes | — | `ShapeProps.strokeGradient`: rendered (centre / inside / outside / variable width), SVG export, SVG import (stroke `url(#…)`), Recolor, Eyedropper. Stroke gradient editor in Appearance. |
| Global swatches | Swatches were per-app (localStorage) and not linked to anything | `Doc.swatches` (saved, in undo): Appearance ▸ Document swatches. Click = fill, ⌥-click = stroke, double-click = edit (colour, name, global, delete), From selection = make the selection's colours linked swatches. Editing a global swatch recolours every linked fill / stroke / type colour in one undo step; a colour changed some other way simply stops following (`core/swatches.ts`). |
| Pattern fills | — | Fill type **Pattern** (`core/patterns.ts`): dots, stripes, grid, checker, diamonds, crosses, zigzag, waves, triangles, rings; ink, background (or transparent), size, weight, angle. Rendered at the view's resolution (crisp at any zoom), SVG export as vector `<pattern>`, PDF falls back to a 300 dpi image for that layer, Recolor and Eyedropper include it. |

Tests: `gradientAnnotator`, `swatches`, `patterns` unit tests; `e2e/gradients.e2e.mjs` (30 checks, real pointer + pixels).

Still open: several fills / strokes per object (appearance stack), pattern from artwork (a symbol as the tile), live effects, gradient annotator for strokes.

## Review — 2026-10-16 (evening): opacity everywhere, live corners on paths, smart Appearance, buttons

Audit focus: "make every property re-editable and smart" (opacity on everything, re-round a button after editing it).

| Area | Before | Now |
| --- | --- | --- |
| Fill / stroke opacity | One opacity per object only | `ShapeProps.fillOpacity` / `strokeOpacity`, rendered (mesh fades with the fill), SVG `fill-opacity` / `stroke-opacity`, vector PDF (ExtGState alpha). SVG import maps `fill-opacity` / `stroke-opacity` onto them. |
| Properties ▸ Appearance | Edited only the *active* shape; no object opacity / blend; nothing for text, images, groups | `ui/Appearance.tsx`: Opacity + Blend for every selected object of any kind, Fill (on/off, colour, opacity), Stroke (colour, weight, opacity, cap, join), Corners radius for paths. Whole selection in one undo step; differing values show "mixed". |
| Gradients | The Gradient tool set fg → bg; no way to edit stops | Gradient editor in Appearance: Solid / Linear / Radial, click the bar to add a stop (interpolated colour), drag stops, drag down to remove, per-stop colour, **stop opacity**, location, angle, reverse (`core/gradientStops.ts`). |
| Live Corners on paths | Only live rectangles/polygons; a rounded rectangle lost its rounding as soon as one anchor was edited | `PathAnchor.corner` (px): exact fillets on any angle, curved sides trimmed on the curve (de Casteljau + Gauss–Legendre arc length) (`shapeGeometry.ts` `filletRing`). Direct Selection / Convert to Path keep a round rectangle as 4 anchors with live corners. Pathfinder, Outline, Offset… bake them (`convertToEditablePath(l, bake, live)`). Widgets: a dot inside every sharp path corner (Selection, Direct Selection, shape tools): drag = all, ⌥-drag = one, ⌥-click = sharp. Anchor panel: Corner field. View ▸ Corner Widgets toggles them. |
| Number keys | Always set the brush opacity (did nothing visible with the Selection tool) | With objects selected and a non-painting tool: the objects' opacity; two quick digits = exact (5 5 → 55%, 0 0 → 0%). |
| Eyedropper | Rail hint promised "transfers fill, stroke, styling" but it only set the foreground colour | With a selection: click an object = copy its whole look (fill, stroke, opacities, gradient, blend, styles; text ↔ shape), ⌥-click = paint the selection's look onto it, ⇧-click = sample colour into the fill (`core/appearanceCopy.ts`). |
| Buttons | — | **Object ▸ Make Button** (also in Next steps): a text gets a padded rounded rectangle with a readable fill, grouped; text + shape are linked. The shape hugs the label (`core/hug.ts`, run in `store.commit` / `live`): longer label → wider button, resize the shape → label re-centred, move either → both move. Release Button unlinks. |
| Bug | Object ▸ Convert Shape to Bézier Path showed a success toast but never committed the result | Fixed (commits, one undo step). |

Tests: `pathCorners`, `gradientStops`, `appearanceCopy`, `hug` unit tests; `e2e/appearance.e2e.mjs` (real pointer + pixel checks). Regression: shapewidgets, toolcontext, objects, vector, formats, audit-tools, stubtools, toolsweep, cmdsweep, transform, superzoom all pass.

Still open: several fills/strokes per object (appearance stack), gradient on strokes, global swatches, patterns, live effects, on-canvas gradient annotator, live corners on rotated paths' widgets in groups, hug for rotated buttons.

## Review — 2026-10-16: on-canvas live shape widgets + anchor panel

| Area | Status |
|---|---|
| Live Corners on canvas | ✅ `src/core/shapeWidgets.ts`: a dot inside each rectangle corner, shown with the Selection tool and every shape tool. Drag toward the centre rounds all corners (by exactly the distance moved), ⌥-drag one corner, ⌥-click cycles Round → Smooth → Cut → Scoop → Notch, Shift snaps to 5 px, the dot turns red at the maximum radius. Works at any live rotation. One undo step per drag; the next shape remembers the setting. |
| Polygon / star / ellipse widgets | ✅ ◆ diamond: drag up/down for sides; dot inside the top point rounds every point; star inner-radius handle; ellipse rim handle opens a pie (Shift = 15°), inner handle makes a donut. |
| Direct Selection on live shapes | **Fixed:** a click used to convert the shape to a path silently (no undo step) even when it hit nothing. Now the anchors are previewed, and the shape converts only when an anchor or handle is grabbed. |
| Anchor panel | ✅ `src/core/anchorEdit.ts` + `AnchorSection` in ToolContext.tsx: Anchor n of m, X/Y, Corner / Smooth / Symmetric (handles along the curve, ⅓ of the neighbour distance), In/Out handle lengths, previous/next, delete. |
| Tests | `src/test/shapeWidgets.test.ts`, `src/test/anchorEdit.test.ts`, `e2e/shapewidgets.e2e.mjs` (26 real-pointer checks). |
| Canva-style corner blocks | ✅ `ScrubBlock` (widgets.tsx): four corner blocks around the preview, each sets its own corner (drag left/right, Shift ×5, click to type, double-click resets, ↑↓ nudge), plus an All-corners block. |
| Widgets on every point | ✅ Polygons/stars show a rounding dot inside every outer point (one dot on shapes with more than 16 points). |
| Active Toolbox | ✅ `ui/ActiveToolbox.tsx`: strip between canvas and panels with the active tool's flyout family + shortcuts, recent tools, a hover card (name, key, hint, gestures). Window ▸ Active Toolbox toggles it (`opts.activeToolbox`). |
| Per-tool settings audit | ✅ Every type tool now gets the font bar + Font size/alignment in the card (only `text` had them). Tips added for 17 tools that had none. New card settings: Smooth size, Mesh point colour + Clear mesh, Hand/Zoom Fit/100%/±, Slice commands, Graph data, Join/Simplify for path cutters, Print Tiling. `e2e/activetoolbox.e2e.mjs` (24 checks). |
| Still open | Corner widgets on any path corner (Illustrator rounds pen-drawn corners too); Type tools in the tool card; gradient-stop editor on canvas. |

## Review — 2026-10-16: stand-in tools made real

An audit of every rail tool against its code found tools that were on the rail but faked their job.
Fixed in this pass:

| Tool | Before | Now |
| --- | --- | --- |
| Graph tools (all 9) | Every one drew the same hardcoded 5-bar picture | Drag a box → **Graph Data** dialog (type, CSV/TSV paste or import, legend, axes, colours, live preview) → a group of editable bars / lines / wedges / axes / labels. The group remembers its data: **Object ▸ Graph ▸ Data…** rebuilds it in place (`graphs.ts`, `graphOps.ts`). Negative values, stacked, scatter (X/Y pairs), pie, radar. |
| Live Paint Bucket | Recoloured the whole shape | With 2+ overlapping shapes selected, it highlights and fills only the region under the pointer; the pieces stay in a "Live Paint Group" (one undo step). |
| Live Paint Selection | No handler | Picks single regions; ⇧ adds; double-click selects every region of that colour. |
| Print Tiling | No handler | Numbered paper tiles over the artboard; drag moves them; double-click → paper/orientation/overlap; **File ▸ Print Tiling / Export Tiled PDF** writes one page per tile (`printTiling.ts`, multi-page `buildPdfPages`). |
| Width tool | Each click added 2 px to the whole stroke | Real variable-width strokes: drag from a stroke to add a width point, drag a point to resize, ⌥-click deletes; ends keep the weight. Stroke panel: 7 width profiles + Flip. Rendered, exported to SVG and honoured by Outline Stroke (`strokeProfile.ts`). |
| Align Stroke | `strokeAlign` existed in the types but nothing used it | Stroke panel ▸ Align: Center / Inside / Outside, rendered and exported to SVG (clip / mask). |
| Symbols | The Sprayer always sprayed a hardcoded star | Real symbol definitions in the document (undoable, saved): **Symbols panel** (new from selection, place, redefine, select instances, break link, delete, rename). Redefine updates every instance and keeps per-instance size, rotation, opacity, styles and Stainer colours. The Sprayer sprays the chosen symbol; ⌥-drag removes (`symbols.ts`, `ui/SymbolsPanel.tsx`). |

Verified: 268 unit tests (incl. graphs, printTiling, strokeProfile), `e2e/stubtools.e2e.mjs` 44/44 (real pointer input, pixel checks), vectortools, vector, formats, objects, build, oxlint. Tool sweep 110/111: the one failure is Scissors, which a parallel session was rewriting at the time.

Second pass the same day:

| Feature | Now |
| --- | --- |
| Pathfinder | **Minus Back, Trim, Merge, Crop, Outline** added (Object menu + Shape Builder options bar), built on the tested region split. |
| SVG import | Opening an `.svg` gives **editable layers** (paths with every command incl. arcs, live rect/ellipse, groups, `<use>`, transforms, `<style>` class rules, gradients, text, images); **Place** puts an SVG in as one editable group (`formats/svgImport.ts`). Unreadable markup still opens as an image. |
| Transform Again (⌘D) | Repeats the last move / scale / rotate from any tool; after an ⌥-drag copy it step-and-repeats. ⌘D still deselects when there is a pixel selection (shortcuts can now share a key: the first enabled command runs). |
| Transform Each (⌥⇧⌘D) | Scale / move / rotate each object about its own centre, Random, Copy, live preview (`transformAgain.ts`). |
| Offset Path / Round Corners | Object ▸ Path ▸ Offset Path… (inset with negative values; holes go the other way) and Round Corners… (live radius on rectangles, arcs on any path corner) (`pathOps.ts`). |
| Recolor Artwork | Edit ▸ Recolor Artwork…: every colour in the selection (fills, strokes, gradient stops, mesh, text) mapped by hand, by hue/saturation/brightness, by harmony or curated palette (matched by lightness) or shuffled; live preview (`recolor.ts`). |
| Smooth tool | Brushing smooths only the part under the brush (anchors relax toward their neighbours with smooth tangents); a click still smooths the whole path. |

Verified: 313 unit tests, `stubtools` 61/61, toolsweep 111/111, audit-tools, vectortools, vector, objects, formats, workspace, build, oxlint.

Still open: Touch Type (behaves like the Type tool), AI import (needs a PDF parser), vector clipping groups, appearance stack (several fills/strokes), live (re-editable) effects, global swatches, patterns, multi-shape symbols.

---

## Review — 2026-10-12, third pass: interaction overhaul

| Item | Status |
| --- | --- |
| Objects not re-editable | **Fixed.** Shapes and text have a live `rotation`; ⌘T rotate/scale no longer rasterizes them (only skew/distort/warp do). Rotation is baked into points only when anchors are edited or Pathfinder runs (`convertToEditablePath`). SVG export writes `rotate()`. |
| Selection tool | **Rebuilt** (`src/core/objectTransform.ts`): click picks the object (Auto-Select Group/Layer/Off), Shift-click toggles, marquee on empty canvas, empty click deselects (Delete then does nothing), 8 handles + rotate zone outside corners, live W×H / angle readout, Shift flips the proportion lock, Alt scales from centre, Shift snaps rotation 15°, Alt-drag copies, double-click edits points / text / group contents, hover outline. The page (full-canvas bottom layer) is never grabbed by a click. |
| Typed transform | Options bar + Properties: X, Y, W, H use real geometry (no stroke/rotation inflation), new Angle field, ±90°, flip (shapes flip as vector). |
| Undo | Keeps the current selection; artboards are now in history (artboard panel edits used to change silently with no redraw or undo). Artwork moves with its artboard (Alt-drag moves only the board). |
| Workspaces | Essentials, Graphic & Social, Packaging & Print (bleed/trim/safe guides, CMYK proof, Packaging presets), Video (title/action safe), Web & UI (12 columns), Typography. Theme switch in the same menu. |
| Dock | Resizable width, draggable panels/Layers split, drag-to-reorder tabs (per workspace), collapse either part, Layers above/below. Saved in `skillvector.layout`. |
| Fonts | `FontPicker`: search, previews in each face, favourites, recent, installed-font detection, "All installed" (Local Font Access), add TTF/OTF/WOFF/WOFF2 files (kept in IndexedDB). |
| Packaging | Reverse tuck end box dieline generator (Artboards panel) — cut path + 12 dashed folds, grouped (`src/core/dieline.ts`, unit-tested). |
| Panels CSS | Properties / Stroke / Artboards panels had no styles for their classes; now laid out. Quick color swatches (click fill, ⌥/right-click stroke), live corner radius / sides, Text section. |
| Open | Rotated bounding box stays oriented only for single objects; non-uniform scale of a rotated object inside a multi-selection is approximated (no skew). |

Verified: 167 unit tests, full e2e (incl. new `objects.e2e.mjs`, `workspace.e2e.mjs`), build, oxlint.

---

## Review — 2026-10-12, second pass (score 8/10)

| Item | Status |
| --- | --- |
| Real Pathfinder | ✅ Real geometry (`polygonClipping.ts`). **Fixed:** crossings were attached to the nearest vertex of the second shape instead of their edge; shared edges/corners broke the result; Unite of 3+ shapes could punch holes; tests only checked bounding boxes. Now Greiner–Hormann with per-edge ordering, a sub-pixel nudge for touching shapes, `uniteRings` / `subtractRings` for many shapes, and area tests (`src/test/polygonClipping.test.ts`). |
| Curves after Pathfinder | ✅ Results are refitted to smooth Béziers: points that came from curves get handles, crossings and original corners stay sharp (two united circles → smooth outline with exactly 2 corners). Exact Bézier–Bézier clipping is still open. |
| Shape Builder | ✅ Splits the selection into every region (`divideRings`), highlights the region under the pointer, merges the regions a drag crosses, ⌥ deletes; untouched regions stay as their own shapes. Also **Object ▸ Pathfinder: Divide**. e2e with real pointer input (`e2e/vector.e2e.mjs`). |
| Outline Stroke | **Fixed and added to Object ▸ Outline Stroke:** it offset in the 0..1 box (wrong width on non-square shapes), had no miter, lost curves and made no hole. Now document-space offsets with mitred joins, a real hole for closed paths, and the fill kept as its own layer. |
| Simplify Path | ✅ **Object ▸ Simplify Path**: Douglas–Peucker on the flattened outline, then smooth refit (a 120-point scribbled circle → under 40 smooth anchors, all within 1 px of the circle) |
| Branding | **Fixed:** visible name is Skill Vector; the "Ai" badge (Adobe's logo style) is replaced by the Skill mark; the shortcuts PDF is now `Skill-Vector-Shortcuts-Guide.pdf` and generates again |

---

## 0. How to read this doc

- **P0** = broken, misleading or blocking. **P1** = closes the gap with Illustrator. **P2** = goes past it
  (★ = Adobe has nothing like it).
- "Done" = unit test + real-input e2e + `npm run build` + `npx oxlint` clean.

---

## 1. Where we stand vs Illustrator (honest)

| Area | Today | Gap |
| --- | --- | --- |
| Pen / Curvature / Anchor / Direct Select | ✅ working | Handle constraints, smart guides on anchors, simplify path dialog |
| Artboards | ✅ create, presets, fit | Artboard rearrange, per-artboard export settings, artboard tool resize from center |
| Pathfinder | ❌ **not real booleans** (see P0) | Real Unite/Minus/Intersect/Exclude/Divide/Trim/Merge/Crop/Outline |
| Shape Builder | ❌ **click just runs the fake Unite** | Real region detection, drag-to-merge, ⌥ to delete |
| Strokes | ✅ caps, joins, dashes | Variable width profiles, arrowheads, align stroke inside/outside, Outline Stroke |
| Fills | ⚠️ solid only | Linear/radial/freeform gradients, gradient on stroke, patterns, mesh |
| Type | ⚠️ inherited raster-style text | Type on path, area type threading, outline text (Create Outlines), OpenType |
| Symbols / reuse | ❌ | Symbols, components, global swatches |
| Effects | ⚠️ raster layer styles | Live vector effects (offset path, round corners, zig-zag, warp, 3D) |
| Data model | ⚠️ paths stored **normalised 0..1 to the layer box** | Absolute document-space geometry with transform matrix |
| Files | ✅ SVG, PDF, PSD | AI/EPS import (PDF-compatible AI), DXF, SVG import with full fidelity |

---

## 2. P0 — Fix what is broken or misleading

1. **Pathfinder is fake.** `applyPathfinder()` in `src/core/vectorOps.ts` (~line 297) does not compute
   geometry. Every operation just stacks the shapes as sub-paths of one compound path, and `render.ts:205`
   fills it with `evenodd`. Results:
   - **Unite** punches a hole wherever shapes overlap (the opposite of union).
   - **Intersect** and **Exclude** produce the *same* result (`case 'minus-front': case 'intersect': case 'exclude':`
     share one branch).
   - **Minus Front** only works when the front shape is fully inside the back one.

   **Fix:** implement real boolean geometry.
   - Step 1 (fast to ship): flatten Béziers to polylines (adaptive, 0.1 px tolerance), run a robust polygon
     clipper (Martinez–Rueda or Clipper2-style Vatti, vendored as one TS file), then refit curves with
     Schneider's algorithm so output stays editable and light.
   - Step 2 (best quality): curve-curve intersection on cubic Béziers directly (Bézier clipping), split at
     intersections, classify segments by winding number, rebuild. This keeps original curves exact — better
     than Illustrator's output, which often adds extra anchors.
   - Tests: union of two overlapping circles has no hole; intersect ≠ exclude; area checks against an analytic
     answer within 0.1 %.
2. **Shape Builder** (`tools.ts:788`) calls `applyPathfinder('unite')` on click. Rebuild it on top of the real
   boolean engine: compute the planar arrangement of all selected paths, hover-highlight each region, drag
   across regions to merge, ⌥-click to delete a region.
3. **README overclaims.** It lists Pathfinder operations as finished. Mark them "in progress" until P0.1 ships.
   The README also points to `Photoscale-Shortcuts-Guide.pdf` and the Photoscale `plan.md`; generate an
   IllustratorScale guide and write its own plan.
4. **Geometry model.** Anchors are stored normalised to the layer box (`types.ts:254`). Non-uniform scaling
   then distorts stroke-handle relationships and makes booleans/offsets need conversions everywhere. Move to
   **absolute coordinates + a 2×3 transform matrix per object** (keep a migration for old files).
5. **Commit the work** into its own repo history (it still shares the Photoscale snapshot commit).

---

## 3. Suite-wide architecture

Same plan as in Photoscale's improvementdoc §3: one monorepo, shared `packages/core`, one `.scale` file family,
live links between apps, one command registry. IllustratorScale's `tools.ts` (1831 lines) has already drifted
from Photoscale's (1249). Merge before they drift further.

Vector-specific core to add in `packages/vector`:
- `Path` = list of sub-paths of cubic segments, absolute coordinates.
- Geometry kernel: bounds, length, point-at-length, nearest point, hit test with stroke width, intersections,
  offset, booleans, simplify, flatten, curve refit.
- Spatial index (R-tree) over all objects → hit-testing and snapping stay instant with 100k objects.

---

## 4. Engine upgrades for the future

- **GPU vector rendering.** Tessellate fills/strokes once, draw with WebGL2 (WebGPU later). Canvas 2D redraws
  everything every frame; GPU keeps 60 fps at 100k paths.
- **Dirty-rect rendering** and per-artboard caches.
- **Precision**: geometry in float64, display snapping to 1/64 px, units (px, pt, mm, in) everywhere.
- **Worker** for heavy ops (booleans on 1000+ shapes, image trace, offset path).
- **Exact SVG/PDF round-trip** tests: export → import → identical geometry.

---

## 5. Feature catalog

### 5.1 Path and drawing (P1)
1. Real Pathfinder: Unite, Minus Front, Minus Back, Intersect, Exclude, Divide, Trim, Merge, Crop, Outline.
2. Real Shape Builder (region merge/delete).
3. Live Paint bucket (fill regions formed by overlapping paths without changing them).
4. Offset Path (round/miter/bevel joins).
5. Outline Stroke (stroke → filled shape).
6. Simplify Path with a slider and anchor count preview.
7. Smooth tool and Path Eraser.
8. Scissors and Knife tools.
9. Join with smart averaging; Average anchors (⌥⌘J).
10. Blob Brush (paints filled shapes that merge on overlap).
11. Width tool with saved width profiles.
12. Live Corners: drag corner widgets to round any corner; per-corner radius (round, inverted, chamfer).
13. Polar grid, rectangular grid, spiral, star, polygon with live parameters.
14. Snap to: anchors, path, intersection, tangent, perpendicular, pixel, grid ★ (show *why* it snapped).
15. Precision construction mode ★: type a length/angle while drawing (CAD-style), e.g. `120 < 45`.
16. Path direction arrows and anchor count overlay in Outline mode.
17. Geometric constraints ★: lock parallel / equal length / tangent between segments that survive edits.

### 5.2 Color and paint (P1)
18. Linear, radial and **freeform** gradients on fills and strokes, with on-canvas gradient annotator.
19. Gradient along stroke / across stroke.
20. Pattern swatches (make pattern from selection, tile types: grid, brick, hex) with live pattern editing.
21. Gradient mesh.
22. Global swatches (change one, update everywhere) and spot swatches.
23. Recolor Artwork: map every color in the selection to a new palette; harmony rules; lock colors.
24. Color groups and palettes imported from ASE/GPL/JSON.
25. Opacity masks.
26. Multiple fills and strokes per object in an **Appearance panel** (stack, reorder, per-item effects).

### 5.3 Type (P1)
27. Point type, area type, type on path (with flip, spacing, effect).
28. Threaded text across frames.
29. Create Outlines (text → editable paths) using the real glyph outlines (opentype.js parse).
30. OpenType features, variable font axes, glyph panel.
31. Character and paragraph styles.
32. Text wrap around objects.
33. Kerning/tracking visual handles on canvas ★.

### 5.4 Reuse and systems (P1/P2)
34. Symbols: edit master, all instances update; per-instance overrides ★ (Illustrator can't override).
35. Components with variants ★ (borrowed from UI tools; great for icon sets).
36. Graphic styles (saved appearance stacks).
37. Repeat: radial, grid, mirror (live).
38. Blend tool (morph between shapes along a spine, specified steps/distance).
39. Envelope distort (warp, mesh, top object).
40. Icon-set mode ★: one artboard per icon, shared grid, keyline overlays, batch export to SVG + icon font.

### 5.5 Effects (P2)
41. Live vector effects (non-destructive): Offset, Round Corners, Zig Zag, Roughen, Pucker & Bloat, Twist,
    Transform (repeat copies), Warp presets.
42. Raster effects on vectors (drop shadow, glow, blur) with document raster resolution setting.
43. 3D extrude/revolve with lighting, kept vector-editable (render to vector shading bands) ★.
44. Halftone and engraving line effects as true vector output ★ (Illustrator rasterises these).

### 5.6 Image Trace (no AI) (P1)
45. Image Trace: posterize → contour (marching squares) → curve fit; presets (logo, sketch, 3/6/16 colors,
    line art, silhouette).
46. Centerline trace for line art ★ (thin to a skeleton, fit strokes — Illustrator only added this late).
47. Live preview with paths count and anchor count.

### 5.7 Layout and precision (P1)
48. Align to key object, distribute spacing with exact value.
49. Transform panel with reference point grid, scale strokes & effects toggles.
50. Transform Each and Transform Again (⌘D).
51. Rulers, guides, grids per artboard; artboard-relative coordinates.
52. Measurement overlay ★: hold ⌥ while hovering to see distances to neighbors (UI-tool style).
53. Pixel-perfect mode: align new paths to the pixel grid.

### 5.8 Files and export (P1)
54. SVG import with gradients, patterns, masks, text, `<use>` → symbols.
55. PDF import (vector), AI files saved PDF-compatible, EPS (via PDF path).
56. DXF import/export for laser/CNC ★.
57. Export for screens: per-artboard and per-asset, multiple scales, SVG/PNG/WebP/PDF.
58. SVG export options: minify, inline styles vs classes, IDs from layer names, precision digits.
59. Copy as CSS / SwiftUI / Jetpack Compose / React Native SVG code ★.
60. Lottie export of simple animated paths (handoff to EffectScale) ★.
61. Print: separations preview, overprint preview, bleed and marks.

### 5.9 Automation without AI (P2)
62. Command palette (⌘K) over the shared command registry.
63. Scripting API: create/modify paths in JS (`path.offset(4)`, `booleans.unite(a,b)`).
64. Data merge: CSV → badges/labels/cards across artboards.
65. Generative patterns ★: rule-based (grid + random seed + constraints) — deterministic, not AI.
66. Batch export of all artboards × all sizes × all formats in one click.
67. Find & Replace for colors, fonts, stroke widths across the document ★.
68. Select Same (fill, stroke, width, appearance, symbol instance).

### 5.10 UX (P1/P2)
69. Contextual task bar (next-step suggestions under a selection).
70. Properties panel that shows only what applies to the selection.
71. Outline mode per layer (not only whole document).
72. Isolation mode for groups/symbols.
73. Unlimited zoom with no precision loss (float64 view transform).
74. Remappable shortcuts + Illustrator preset.
75. Accessibility (keyboard-only editing of anchors, screen-reader object list).

---

## 6. Roadmap

| Phase | Theme | Key items |
| --- | --- | --- |
| 1 (now) | Truth | Real booleans + Shape Builder, honest README, own plan/shortcuts PDF |
| 2 | Kernel | Absolute geometry + matrix, geometry kernel, R-tree, shared monorepo |
| 3 | Pro gap | Gradients, Appearance panel, offset/outline stroke, type on path, Create Outlines, symbols |
| 4 | Speed | GPU tessellated rendering, workers, 100k-object benchmark |
| 5 | Beyond Adobe | Constraints, construction mode, components with variants, code export, DXF, centerline trace |
| 6 | Ecosystem | Live links with Photoscale/EffectScale, plugins, Lottie |

---

## 7. Quality bar

- Geometry kernel has property tests (random shapes: `area(A ∪ B) = area(A) + area(B) − area(A ∩ B)`).
- Round-trip tests for SVG and PDF.
- Benchmarks: 10k-path document pans at 60 fps; union of 500 shapes < 500 ms.
- `npm test`, `npm run test:e2e`, `npm run build`, `npx oxlint` clean before a feature is called done.
