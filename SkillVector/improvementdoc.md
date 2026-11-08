# IllustratorScale — Improvement Doc (Mega Upgrade)

> Goal: the vector tool designers choose **over** Illustrator: exact geometry, instant performance on huge
> files, automation built in, fully local. Every feature works **without AI**.

Status checked on 2026-10-12: 128/128 unit tests pass. The app is a fork of the Photoscale core plus
`src/core/vectorOps.ts` (820 lines) and `src/ui/VectorPanels.tsx`. Its work is still **uncommitted** on top of
the Photoscale snapshot `6bac5fd`.


## Review — 2026-11-08: Batch 3, PDF / .ai import, step 4: shadings, patterns, soft masks (B3.4) — Rating: 9.5/10

- **Shadings** (`formats/pdfImport.ts`, `shadingToSvgGradient`): PDF axial (linear) and radial shadings (`OPS.shadingFill` and `OPS.setFillColorN` with Shading) are resolved via `page.objs.get(id)` and translated to SVG `<linearGradient>` and `<radialGradient>` definitions under `gradientUnits="userSpaceOnUse"`. Coords are mapped through pattern matrices and page base transform into document space, with stops preserving colors and alphas. When drawn, they become editable vector shape layers with first-class `ShapeGradient` fills.
- **Tiling Patterns** (`formats/pdfImport.ts`, `renderTilingPattern`): PDF tiling patterns (`OPS.setFillColorN` with TilingPattern) have their tile operator lists evaluated into `PatternArt` and converted to `PatternFill` (using `artFill`), preserving tile dimensions, matrix and color, attached to the shape's `shape.pattern`. `drawLayerVector` in `render.ts` was expanded to draw raster/art tile layers directly.
- **Soft Masks** (`formats/pdfImport.ts`, `renderSoftMask`): ExtGState `/SMask` transparency groups (`OPS.beginGroup` with `group.smask` ... `OPS.endGroup`) are rendered into dedicated mask canvases and converted (Rec. 709 luminosity `0.2126 R + 0.7152 G + 0.0722 B` to alpha). When activated via `OPS.setGState([['SMask', true]])`, the mask is attached directly to layers as `layer.mask` (`Mask` interface). `render.ts` `maskedSurface` renders them using `destination-in` compositing, matching pdf.js.
- **Fix to B3.2/B3.3 Image Placement**: Corrected double-application of `base` transform in `imagePlacement`, ensuring axis-aligned and rotated images land on exact document coordinates.
- **Verification Results**:
  - `npx tsc -b`: 0 errors.
  - `npm run lint`: 0 errors (43 warnings).
  - `npm test`: **490/490 passed** across 50 test files (+6 new tests in `pdfImport.test.ts` covering `shadingToSvgGradient`, `renderTilingPattern`, `renderSoftMask`).
  - `node e2e/run.mjs pdfimport`: **12/12 passed** (mean pixel differences: shapes 0.04, clips 0.18, images 2.11, blend 0, shadings 0.02, soft masks 0; all < 3.0 budget).
  - `npm run build`: Succeeded in 1.66s.
- **Rating Upgraded**: **9.0/10 → 9.5/10**.
- **Still Open**: Coated-model pickers, raster overprint, and X-1a transparency flattening.

## Review — 2026-11-08: Batch 3, PDF / .ai import, step 3: blend modes (B3.3)

- Blend modes (`formats/pdfImport.ts`, `pdfBlendMode`): a PDF ExtGState `/BM` is read from
  `setGState` and kept in the graphics state (saved / restored with `q` / `Q`, like the fill
  colour and alpha), then applied to every layer painted under it — paths (`withLayer(l,
  { blend })`), text (the blend rides with the fill through `matchTextFill`, so a blended line
  keeps its blend) and images (`makeLayer({ blend })`). pdf.js 4.10.38 normalises the PDF name
  to a canvas composite name before it reaches the operator list (`normalizeBlendMode` in
  `pdf.worker.mjs`, verified in the pinned build: Normal / Compatible → `source-over`,
  Multiply → `multiply`, … Luminosity → `luminosity`; an array takes its first supported
  entry, an unknown name falls back to `source-over` with a warning), and all 16 map 1:1 onto
  the app's `BlendMode`. The raw PDF names are accepted too, in case a later pdf.js stops
  normalising; a value the app cannot map is counted in `skipped['blend mode']` (in practice
  unreachable — pdf.js falls back to Normal first). No new renderer code: the layer's own blend
  is already first-class (`render.ts` `drawBlended`, canvas `globalCompositeOperation` / the
  custom blend engine), so the imported layer renders exactly as pdf.js does.
- Approximation, stated plainly: a PDF blend mode blends inside its transparency group; the
  imported layer blends over everything below it on the page. For the common case — one blended
  element over the artwork beneath it — that is identical; nested transparency groups may differ.
- Tests (written, NOT run here — this Mac has no shell, so no `tsc`, `npm test` or build was run;
  verification is Bilal's PC step: `npm test`, `npx tsc -b`, `npm run lint`, `node e2e/pdfimport.e2e.mjs`
  or `npm run test:e2e`): `src/test/pdfImport.test.ts` (now 18 cases: + `pdfBlendMode` — all 16
  pdf.js names, raw PDF names, array first-supported, unknown → null; + the blend rides along in
  `matchTextFill`); `e2e/pdfimport.e2e.mjs` (now 10 checks): 7th fixture — a cyan panel with a
  yellow panel over it under `/Multiply`, checked for the top layer's blend `multiply`, the
  bottom layer's `normal`, and a mean pixel difference < 3 against pdf.js's own render (green
  overlap).
- Still open in PDF import: shadings, patterns, soft masks; vertical text; image masks and
  repeated images (counted in the toast); stroked-only text (comes in as a fill); Type3 fonts
  (custom glyph shapes are not converted to outlines). Regression numbers from B3.1 (unit 466/466,
  e2e suites) are NOT
  re-claimed here — nothing was run.

## Review — 2026-11-08: Batch 3, PDF / .ai import, step 2: text + images (B3.2)

- Text (`formats/pdfImport.ts`): each page's `getTextContent()` becomes one editable text layer per
  line, with its real size, rotation and advance width, placed so its baseline lands where the PDF's
  is (the renderer's own convention: baseline 0.9 × size below the layer top, 1.2 × size tall;
  rotated text is boxed about the rotated line's centre, `Layer.rotation`). The fill colour comes
  from the operator list — `setFillRGBColor` / `setFillGray` / `setFillCMYKColor` (CMYK through the
  coated FOGRA39 preview model) live at each `showText` / `showSpacedText` / `nextLine…` operator —
  matched to each line by its string (`matchTextFill`, prefix-tolerant for pdf.js splitting or
  merging lines differently from the operator list; no match keeps the previous line's colour,
  black when there is none). Font names lose their 6-letter subset tag, map through the base-14
  table (Helvetica, Times New Roman, Courier New…), and read Bold / Italic from the name;
  `getTextContent()`'s resolved family wins when pdf.js has one.
- Images: `paintImageXObject` (pixels from `page.objs`, callback form with a 5 s timeout) and inline
  images (the data rides the operator arg) become raster layers with their own pixels, placed by the
  CTM that painted them (`imagePlacement`: the unit square's bounding box, canvas transform flips
  the top row upright, so rotated images land correctly). Image data is decoded the way pdf.js
  itself does: ImageBitmap, ImageData, or raw 1-bit grayscale (1 = white, MSB first), RGB and RGBA.
  Paths, text and images are merged into one z-ordered stream per page by operator index, so text
  under a shape stays under it, and text / images painted inside a clip are clipped like paths.
- Open summary and toast (`io.ts`) now count text layers and images alongside paths and clips.
- Tests (written, NOT run here — this Mac has no shell, so no `tsc`, `npm test` or build was run;
  verification is Bilal's PC step: `npm test`, `npx tsc -b`, `npm run lint`, `node e2e/pdfimport.e2e.mjs`
  or `npm run test:e2e`): `src/test/pdfImport.test.ts` (13 cases: font-name mapping, `placeText`
  horizontal + rotated, `imagePlacement` axis-aligned + rotated, `glyphsStr`, `matchTextFill` exact /
  merged / split / no-match); `e2e/pdfimport.e2e.mjs` (now 9 checks): the fixture writer gained a
  Helvetica /F1 font on every page and image XObjects, plus a 6th fixture — two colours and sizes
  of text, one line rotated 90°, over a grey panel, with a 2 × 2 RGB image placed 100 × 50 — checked
  for string / size / colour / rotation per line, image position, and a mean pixel difference < 3
  against pdf.js's own render.
- Still open in PDF import: shadings, patterns, soft masks, blend modes; vertical text; image masks
  and repeated images (counted in the toast); stroked-only text (comes in as a fill); Type3 fonts
  (custom glyph shapes are not converted to outlines). Regression numbers from B3.1 (unit 466/466,
  e2e suites) are NOT
  re-claimed here — nothing was run.

## Review — 2026-11-08: Batch 3, PDF / .ai import, step 1: paths (B3.1)

- File ▸ Open accepts `.pdf` and PDF-compatible `.ai` (`formats/pdfImport.ts`, pdf.js 4.10.38, Apache-2.0, pinned). Each
  page's operator list is walked (save / restore, cm, path ops incl. the `v` / `y` curve forms, fill / stroke / both,
  even-odd, line width / caps / joins / miter / dash, RGB fill / stroke, ExtGState alpha) and written as SVG for the
  existing SVG importer, so paths land as editable shape layers. Filling closes open subpaths (an open path that is
  also stroked becomes a closed fill + the open stroke). One artboard per page, side by side, with white paper.
- Clipping paths become Illustrator-style clip groups: new `Layer.clipPathOnly` ("Clipping Path" base that clips but
  isn't drawn; `render.ts` composites the clipped layers on their own layer). Page-sized rectangular clips are ignored.
- Not yet (counted in the open summary toast): text, images, shadings, patterns, soft masks, blend modes; nested
  clips use the innermost one.
- Tests: `e2e/pdfimport.e2e.mjs` (7): five PDFs written by the test (shapes + curves + even-odd + dash; nested
  transforms; elliptical clip + page clip + opacity; two pages; a round-trip of our own PDF export), each page within a
  mean pixel difference of 0.00–0.18 of pdf.js's own render; editable anchors; the clip group is built.
- Regression: unit 466/466; cmykpdf 11/11 (flaked once, passed on rerun), pdfbleed 12/12, separations 9/9, pdfx4 7/7,
  envelope 6/6, formats 7/7, cmdsweep, audit-tools 34/34, toolsweep; lint 0 errors; build ok (worker bundled).

## Review — 2026-11-07: Batch 2, print output (B2.1–B2.4)

- **Bleed + printer's marks** (B2.1). File ▸ Document Setup (⌥⌘P): bleed per side in mm (3 mm default, linked or
  per side), stored on the document in px (`Doc.bleed`), one undo step, saved in projects, drawn as a red line around
  every artboard. PDF export (`vectorPdf.ts` `pageBoxes`): TrimBox = artboard, BleedBox = trim + bleed, MediaBox =
  bleed + 24 pt when marks are on; content is clipped to the bleed, so artwork past the trim edge is kept up to it.
  Marks: crop (8 strokes outside the bleed), registration targets (in the `/All` Separation, so on every plate),
  colour bars (C/M/Y/K at 100/50/25 % + spots, CMYK documents), page info (Helvetica; it blocks the PDF/X claim with
  the reason, since that font isn't embedded). Options in the Export dialog (PDF), remembered in `skillvector.pdfPrint`.
  Tests: `e2e/pdfbleed.e2e.mjs` (12): real dialog, red guide pixels, undo + project save, exact box values for 3 mm,
  marks only when asked, Quartz render (artwork fills the bleed, nothing beyond), media + boxes with marks, /All
  plate, colour bars, page-info → no X claim, bleed off.
- **Overprint** (B2.2). Layer `overprintFill` / `overprintStroke` (Window ▸ Attributes, in the Separations tab),
  one undo step; written as ExtGState `/op` / `/OP` with `/OPM 1`. View ▸ Overprint Preview (⌥⇧⌘O) shows the inks
  as printed. Engine: `core/separations.ts` (each visible layer rendered alone, mapped to its exact inks through
  `PrintColors`, composited per plate: knockout replaces by coverage, overprint only where the layer has ink).
  Tests: `separations.test.ts` (5, `mixInk`: Y over C → C+Y, knockout → Y only, OPM 1, 50 % edge, black text over
  a panel); e2e below.
- **Separations Preview** (B2.3). Window ▸ Separations Preview: C, M, Y, K and each spot plate with eye toggles,
  click a name to see that plate alone in grayscale, ink % under the cursor and total ink coverage with a limit
  warning (default 300 %, `skillvector.inkLimit`). Closing the tab returns the normal canvas.
  Tests: `e2e/separations.e2e.mjs` (9): Attributes toggle + undo, PDF ExtGState used once on the right object,
  preview pixels (overprint green vs knockout yellow), hide Cyan → paper, solo Yellow → grayscale, readout
  50/40/30/20 = 140 %, overlap 200 %, normal view restored, no console errors.
- **ICC engine + PDF/X-4** (B2.4). `core/icc.ts` (shared module, dependency-free): header + tags, `curv` / `para`
  curves, matrix/TRC RGB and gray, `mft1` / `mft2` / `mAB ` LUTs with n-linear CLUT interpolation, Lab/XYZ PCS,
  D50 sRGB, CIEDE2000, embedded profiles in JPEG (APP2) and PNG (iCCP). Measured against Apple ColorSync (sips)
  with the system profiles: Generic CMYK max ΔE00 1.52 (mean 0.57), Adobe RGB 0.32, Display P3 0.14
  (`icc.test.ts`, 7, incl. published CIEDE2000 pairs). File ▸ Output Profile ▸ Load CMYK Profile (.icc): RGB
  profiles refused; kept with the document (undoable, saved in projects). With it, PDF export is **PDF/X-4**:
  PDF 1.6, OutputIntent with the profile embedded as DestOutputProfile, XMP metadata (`pdfxid:GTS_PDFXVersion`),
  live transparency allowed; without one, PDF/X-1a as before. Overprint / Separations Preview convert inks
  through the loaded profile. Tests: `e2e/pdfx4.e2e.mjs` (7): X-1a still refuses transparency, RGB profile
  refused, X-4 + transparency, profile bytes identical, XMP + xref, Quartz renders it, preview pixels = the
  profile's conversion (not the built-in model).
- Regression: unit 466/466; e2e cmykpdf 11/11, envelope 6/6, formats 7/7 (both flaked once on back-to-back runs,
  passed on rerun), cmdsweep, toolsweep, audit-tools 34/34; tsc 0; build ok; shortcuts PDF regenerated.
- Still open: PDF / .ai import (B2.5, not started), the normal canvas and colour pickers still use the built-in
  coated model (only the print previews use the loaded profile), raster layers / images can't overprint (they
  knock out), no transparency flattening for X-1a, no external PDF/X validator was available here (no qpdf /
  Ghostscript / veraPDF): checks are byte-level plus Quartz rendering.

## Review — 2026-11-07: CMYK print PDF (Phase 0 P0.2 / P0.3, part)

- **CMYK documents export as print PDFs** (`formats/vectorPdf.ts`, `PrintColors`): every Paint's screen-preview colour maps
  back to its exact values, so a fill typed as 0 / 96.7 / 58.5 / 0 is written `0 0.967 0.585 0 k`; gray Paints → DeviceGray;
  **spot colours → Separation plates** (`/CSP<i> cs <tint> scn`, alternate CMYK as a type 2 function); colours with no Paint
  are separated (neutrals → black ink only, others through the coated model). Gradients → DeviceCMYK shadings; pixel layers →
  DeviceCMYK images (opaque blocks lose the 1 px empty rim, so no soft mask).
- **Print markers**: TrimBox / BleedBox (= artboard; no bleed setting exists yet), OutputIntent (registered FOGRA39 condition,
  no embedded profile), trailer /ID, Creation / ModDate. **PDF/X-1a:2003** is claimed only when a preflight finds no
  transparency (layer opacity / blend, transparent colours, soft masks); the export toast shows CMYK, spot plates and the
  PDF/X result or what blocks it. RGB documents export exactly as before.
- Tests: `e2e/cmykpdf.e2e.mjs` (11): exact operators, Separation, DeviceGray, K-only black, no RGB left, boxes / intent / X
  markers, xref offsets, transparency → no X claim with reason, CMYK shadings and images, RGB unchanged, and an
  **independent render by macOS Quartz (sips)** of red / orange spot / gray / black on white paper.
- Still open: a bleed setting + crop / registration marks, embedding a real ICC output profile (PDF/X-4), overprint
  attributes + Overprint Preview, Separations Preview panel, transparency flattening for X-1a.
## Review — 2026-11-07 (verification): CMYK status

Verified in Chrome: CMYK document mode stores CMYK paints and undoes correctly. (Superseded: CMYK documents now export CMYK / spot PDFs, see the sections above.) Not done yet at the time: **PDF export still writes RGB**
(no DeviceCMYK, Separation, OutputIntent or PDF/X), and the preview is a Neugebauer approximation, not an ICC profile. The
picker badge said "FOGRA39 Coated"; it now says "Coated (approx.)" with an explanation.

## Review — 2026-11-07: Phase 0.1 Real CMYK Documents

- **Document Color Mode: RGB | CMYK**:
  - `File ▸ Document Color Mode ▸ CMYK` and `File ▸ Document Color Mode ▸ RGB` commands in `src/core/commands.ts`.
  - Added `colorMode: 'RGB' | 'CMYK'` to `Doc`, `Snapshot` (tracked in undo/redo history), and `ProjectFile` serialization (`io.ts`).
  - Switched color mode commits an undoable step (`store.setColorMode()`).
- **Paint Type (`src/core/types.ts` & `src/core/color.ts`)**:
  - `Paint` supporting `{ space: 'rgb' | 'cmyk' | 'spot' | 'gray', values: number[] }` with `spotName`, `tint`, and `fallback` metadata.
  - Native paint definitions added across shapes (`fillPaint`, `strokePaint`), text (`colorPaint`, `strokeColorPaint`), appearance stack (`paint`), gradients (`stops[].paint`), mesh points (`paint`), and swatches (`swatch.paint`).
- **Color Science & CMYK Math (`src/core/color.ts`)**:
  - Standard subtractive baseline formulas: `cmykToRgbStandard()`, `rgbToCmykStandard()`.
  - FOGRA39 / ISO Coated v2 characterization: `cmykToRgbFogra39()`, `rgbToCmykFogra39()` with Total Area Coverage (TAC) limit clamp.
  - Euroscale coated baseline formulas: `cmykToRgbEuroscale()`, `rgbToCmykEuroscale()`.
  - Total Ink Coverage calculation: `totalInkCoverage(c, m, y, k)` and press safety evaluation: `isInkCoverageSafe(c, m, y, k, 300)`.
  - Soft-proofing preview: `cmykSoftProof()`.
  - DeviceGray conversions: `grayToRgb(k)` and `rgbToGray(rgb)`.
- **Lossless Migration (`src/core/color.ts`)**:
  - `migrateDocColorMode(doc, targetMode)` and `migrateLayerColorMode(layer, targetMode)` convert all fills, strokes, gradients, swatches, symbols, and patterns.
  - Preserves exact source values in `fallback: { space, values }`, guaranteeing bit-exact 100% lossless round-trip conversions (RGB ↔ CMYK ↔ RGB).
- **Color Picker & Swatches UI (`src/ui/ColorPicker.tsx` & `src/ui/Appearance.tsx`)**:
  - New CMYK tab in ColorPicker with 4 independent channel sliders (Cyan, Magenta, Yellow, Black/Key) from 0 to 100%.
  - Sliders feature live dynamic ink ramps on the track, direct numeric inputs, Total Ink Coverage (TAC) indicator with press limit warnings, and 8 standard process swatches (Process Cyan, Magenta, Yellow, Black, Rich Black, Warm Red, Reflex Blue, Process Green).
  - Editing CMYK sliders modifies pure CMYK state directly without RGB recalculation drift.
  - Document swatches store native `Paint` objects, display true CMYK readouts in tooltips and the swatch editor, and serialize losslessly in project files.
- **Tests & Verification**:
  - New test suite in `src/test/cmyk.test.ts` (20 tests passing) covering Paint type handling, color conversions (FOGRA39 and standard formulas), swatch serialization, lossless document migration, and CMYK slider conversions.
  - Full unit test suite: 47/47 files, 454/454 unit tests pass (`npm test`).
  - TypeScript type check: `npx tsc -p tsconfig.app.json --noEmit` = 0 errors.
  - Linter: `npx oxlint` clean (0 errors, 0 warnings on modified files).
  - Production build: `npm run build` succeeds (2370 modules transformed in < 1s).


## Review — 2026-11-07: Envelope Distort ▸ Make with Warp

- **Object ▸ Envelope Distort ▸ Make with Warp…** (`core/envelope.ts`, dialog in `ui/Dialogs.tsx`): Illustrator's 15 styles
  (Arc, Arc Lower/Upper, Arch, Bulge, Shell Lower/Upper, Flag, Wave, Fish, Rise, Fisheye, Inflate, Squeeze, Twist),
  Horizontal / Vertical, Bend and Horizontal / Vertical Distortion, live preview, Cancel restores, OK = one undo step "Warp: <style>".
- Real vector result: each Bézier segment is cut into short pieces (de Casteljau) and every anchor and handle goes through the
  warp, so straight edges become true curves (sampled error < 0.5 px in tests); original anchors keep corner / smooth.
- The selection warps as one envelope (joint bounds); shapes inside selected groups are included. Text needs Create Outlines first.
- Tests: `src/test/envelope.test.ts` (8), `e2e/envelope.e2e.mjs` (6, rendered pixels).
- Still open: live (re-editable) envelopes, Make with Mesh / Top Object, warping text and images directly, a shortcut
  (Illustrator's ⌥⇧⌘W is already Export here).

## Review — 2026-11-06: lint pass

`npx oxlint`: 77 → 39 warnings. Removed unused imports, variables and a dead `checkerPattern`; comma
expressions in the flood fill (`proTools.ts`) became blocks; Brush preset picker lost its unused props. The 39
left are deliberate: 17 `only-export-components` (dev hot-reload only) and 22 React hook hints on effects that
mirror store state into local state or re-score the command palette on reopen. 414/414 unit tests and the
touched e2e suites pass.

## Review — 2026-11-06: performance with many objects + smudge fix

`e2e/perf.e2e.mjs` (500 shapes on a 4000 × 3000 artboard):

| Step | Before | Now | Fix |
| --- | --- | --- | --- |
| First render of 500 shapes | 47.7 s | 1.2 s | The Layers panel rebuilt every row on every store change (each pan, zoom, pointer move) and again 220 ms after each render: the row list is now memoised on the layers, active layer, selection, search, drag and thumbnail tick. |
| Pan, per frame | 1552 ms | ~100 ms (42 ms warm) | Same. |
| Select all / move all / SVG | 0.4 / 0.8 / 1.0 s | 0.7 / 0.6 / 1.0 s | — |
| Smudge | Mostly did nothing (carry needed an equal-size dab box) | Fixed (see Skill Photo). |

Tests: e2e driver clears saved settings per suite and again on the first navigation (a closing tab can still save on unload); `toolsweep` resets tool options per tool and gives pixel tools a pixel layer; `pencil` / `vectortools` wait for settled geometry.

---

## Review — 2026-11-05 (later): gradient Method + Dither

Research: Illustrator 2026 (v30) added a gradient **Method** menu and **dithering**.

| Area | Now |
| --- | --- |
| Method | `ShapeGradient.method`: **Classic** (sRGB numbers, as before), **Perceptual** (OKLab: even lightness, vivid middles), **Linear light** (mixes light). Drawn as 16 computed Classic stops per pair (`gradientMethod.ts` `renderStops`), so canvas, SVG and PDF all show it; the web kit's CSS uses `in oklab` / `in srgb-linear`. Fill and stroke gradients; the editor's preview bar shows it too. |
| Dither | Fills: ±1 level of noise (2/255 black / white, one tile pixel per device pixel, clipped to the shape) breaks up 8-bit banding. |

Measured (e2e): red → green middle Classic (127, 127, 0), Linear (187, 188, 0), Perceptual (207, 168, 0); a #202020 → #282828 ramp's longest flat band 94 px → 12 px with Dither, average level within 0.3.

Tests: `src/test/gradientMethod.test.ts` (6), `e2e/gradientmethod.e2e.mjs` (8).

---

## Review — 2026-11-05: Make Pattern from artwork

| Area | Before | Now |
| --- | --- | --- |
| Patterns | 10 parametric presets | **Object ▸ Pattern ▸ Make Pattern**: selected shapes / text (groups give their contents) become a tile with 15 % breathing room in the document's **pattern library** (`Doc.patterns`, `core/patternArt.ts`; undoable, saved in project files). Appearance ▸ Fill ▸ Pattern lists the library after the presets (⌥-click removes one). A fill keeps its own copy of the tile (`PatternFill.art`), so library changes never alter placed fills. **Tile width** slider; the tile keeps its proportions; the fill's background colour shows between the motifs. |
| Rendering | — | Art tiles are drawn with the vector drawer (`setArtDrawer` ← `drawLayerVector`) at the view's resolution, with the 8 neighbours so art crossing an edge tiles seamlessly; cached per tile + resolution. |
| SVG | — | A real `<pattern>` of the artwork's own `<path>` / `<text>` (9 copies), scaled to the tile width. |

Tests: `src/test/patternArt.test.ts` (4), `e2e/makepattern.e2e.mjs` (7: drawn shapes, menu command, library chip click, repeat across and down in pixels, SVG, project round trip, ⌥-click + ⌘Z). 408 unit tests; full e2e: commands 162/162, tools 112/112, the usual two late-run flakes.

Flaky tests fixed: `features` (smart guides) read the guide pixel 80 ms after the last move — on a busy machine before the redraw; it now waits for two animation frames. `shapewidgets` (star inner %) assumed the star landed exactly where it was dragged; smart guides can snap its corner while drawing, so the handle is now dropped at 80 % of the star's actual radius.

Still open: editing a library pattern in place (Pattern Options), brick / hex tile offsets, recolouring pattern art.

---

## Review — 2026-11-04 (later): live distort effects

| Area | Before | Now |
| --- | --- | --- |
| Distort & Transform | Pucker / Bloat only as destructive brush tools | `ShapeProps.distort` (`core/liveDistort.ts`): **Roughen** (size, detail, smooth, reseed), **Zig Zag** (size, ridges, smooth), **Pucker & Bloat** (%), **Twist** (°), live: the shape keeps its own geometry (a rectangle stays a rectangle, corners / widgets still work). `shapePath` records the outline as dense points (`FlattenRecorder`), bends it and draws it back, so rendering, hit tests and SVG export all follow; render padding grows with the effect. |
| Expand | — | Properties ▸ Appearance ▸ Distort ▸ **Expand** bakes it into an ordinary path, box centred where it was (rotation pivot unchanged), gradients and mesh remapped onto the new box. One undo step. |
| Panel | — | Distort row: effect, eye, amount (Pucker / Bloat / Angle / Size), detail / ridges, Smooth, reseed. |

Tests: `src/test/liveDistort.test.ts` (9: recorder, pucker / bloat geometry, zig zag offsets, roughen bound + seed, twist, padding, shapePath, Expand = same outline, SVG), `e2e/distort.e2e.mjs` (11, real drawing + clicks + pixels, Expand, ⌘Z). 404 unit tests; full e2e: all pass (features / shapewidgets flaked late in the full run, pass alone, as before).

Still open: Offset Path / Round Corners as live effects, live Gaussian blur (needs canvas filter support in WebKit), effects per stack item.

---

## Review — 2026-11-04: Appearance stack (extra fills and strokes)

| Area | Before | Now |
| --- | --- | --- |
| Fills / strokes per object | One fill and one stroke | `ShapeProps.appearance`: any number of extra fills and strokes, each **below** the base fill or **above** the base stroke, with colour or gradient, opacity, blend (multiply, screen, overlay, soft light…), weight / inside / outside / dash for strokes, and an X / Y offset. Each item is the same outline wearing only that paint, so live corners, compound paths and gradients all work (`core/appearanceStack.ts`). |
| Panel | — | Properties ▸ Appearance ▸ **Stack**: + Fill, + Stroke, presets (Double outline, Sticker, Hard shadow, Offset print, Gradient sheen, Inner line), per item: eye, colour, weight, move up / down (crossing the base row flips below / above), place, blend, align, opacity, X / Y, remove. One undo step per change. |
| Everywhere else | — | Render padding grows with wide strokes and offsets; SVG export writes one group (below items, base, above items; `mix-blend-mode` + isolation); Recolor and the colour list include the stack; Eyedropper look copy carries it; project files keep it. |

Tests: `src/test/appearanceStack.test.ts` (7), `e2e/appearancestack.e2e.mjs` (14: real button clicks, pixels for outline / tint / hide / reorder / shadow offset, undo, preset, number field, SVG order, project round trip). 395 unit tests; appearance, gradients, formats, colors, vector, repeat e2e pass.

Still open: on-canvas offset handles, gradients edited per stack item (preset gradients only), live effects (drop shadow / blur per item).

---

## Review — 2026-11-03: Repeat (Radial / Grid / Mirror), menu fix

| Area | Now |
| --- | --- |
| Object ▸ Repeat | **Radial** (instances, radius; the original sits at the top of the circle), **Grid** (columns, rows, gaps, brick row shift, mirror every other column / row), **Mirror** (vertical, horizontal or four-way, gap). Live: the selection becomes a repeat group; its copies are real locked layers tagged `repeatOf`, rebuilt after every edit by `applyRepeats` (store.commit / live, next to hugs; cached so unchanged copies keep their identity). Edit, recolour or ⌘-drag the original and every copy follows; undo, project files and SVG/PDF export include the copies. Clicking a copy selects the repeat. **Expand** keeps the copies as ordinary layers; **Release** keeps only the original; ungrouping turns copies into plain layers. Properties ▸ Repeat section; "Repeat Radial/Grid/Mirror" in Next steps. (`core/repeat.ts` pure, `core/repeatOps.ts`, `ui/RepeatPanel.tsx`) |
| Menus | **Bug fixed:** submenus (Object ▸ Path, Repeat…) were clipped by the scrolling menu panel and clicks went to the canvas; now portaled to `<body>` and kept on screen. |

Tests: `src/test/repeat.test.ts` (12), `e2e/repeat.e2e.mjs` (15: real Rectangle drag, real submenu clicks, pixel checks, click-a-copy, follow on move/recolour, undo, switch kind, SVG, Expand, Release, save/load). 388 unit tests, build, oxlint.

Known: the selection frame of a repeat shows the original only (copies are locked); dragging still moves everything. `features` (smart guides) and `shapewidgets` (star inner %) pass alone, on old and new code, but can flake late in a full e2e run.

Still open: on-canvas Repeat handles (radius / gap), path repeat, appearance stack, live effects.

---

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