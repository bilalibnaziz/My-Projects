# Photoscale — Improvement Doc (Mega Upgrade)

> Goal: not a Photoshop copy, but the editor people pick **over** Photoshop: faster, more precise, more
> automatable, fully local, and built to scale for the next decade.
> Rule for this doc: every feature has to work **without AI**. AI can be an optional extra later, never a
> dependency.

Status checked on 2026-10-12: 106/106 unit tests pass. Core rebuild is still **uncommitted** on top of
`6bac5fd`. Never `git stash` / `reset` in this repo.


## Review — 2026-11-08: Batch 3.7, remaining float filters (except Lens Correction)

- **B3.7 Float filters, the rest**: Pixelate, Emboss, Find Edges, Dreamy Glow (Orton), Chromatic Aberration and
  Halftone Dots now run on the layer buffer in float at 16 / 32 bits (`hibit.floatFilter`, `FLOAT_FILTERS` now
  13 of the 14 filters — only Lens Correction is left). Same maths as the 8-bit filters in `filters.ts`, on
  float values in the 0..255 scale, so parameters mean the same: block means (Pixelate), a luminance Sobel
  (Find Edges) / neighbour difference (Emboss) via a new `lumFloat` helper (same 0.2126 / 0.7152 / 0.0722
  coefficients, `blurChannel`), screen blend over a blurred copy (Glow), channel shifts from a snapshot
  (Chromatic), dot test on blurred luminance (Halftone). Alpha is untouched except Pixelate, which averages
  it like the 8-bit filter. No dispatch change was needed: `ops.commitFilter` already takes the float path
  (with `limitToSelection`) for any id in `FLOAT_FILTERS`, and `HIGH_BIT_NATIVE` lists the new six.
- Tests: the B3.1 block in `e2e/hibit.e2e.mjs` now runs all 12 non-Gaussian float filters against the 8-bit
  reference on the 16-bit ramp (Gaussian Blur is checked separately above it). Flat / two-level outputs
  (High Pass, Emboss, Find Edges, Halftone) are exempt from the between-8-bit-steps check; Emboss allows a
  mean of 2 levels (it differences neighbours, so the dithered 8-bit reference shows through); Halftone is
  judged by pixel agreement (> 98 % within 1 level) instead of the mean, since one flipped dot is 225 levels
  apart. The other new filters keep the mean < 1 level bar.
- **NOT RUN — Bilal's PC step:** no shell on this Mac, so `npm test`, `npm run test:e2e`, `npx tsc`,
  `npx oxlint` and `npm run build` were not run. No test counts are claimed; run them before trusting this batch.
- Still open: Lens Correction (radial resample + fringe + vignette — the only 8-bit-only filter left, and the
  hardest to lift: it resamples the image rather than filtering in place), 16-bit PSD, RAW, CMYK documents.

## Review — 2026-11-08: Batch 3.5, profiles everywhere, part 2 (B3.5–B3.6)

- **B3.5 WebP profiles**: `renderExport` now tags WebP too (`formats/iccEmbed.ts` `embedWebp`, `core/icc.ts`
  `readWebpIcc`): the working-space profile goes in as an ICCP chunk before the image data — after VP8X when
  present (its ICC flag is set), else straight after the RIFF header — with the RIFF size updated and odd
  lengths padded. Files that already carry a profile, and malformed WebP, are left alone.
- **B3.6 8-bit TIFF profiles**: `encodeTiff` takes an `icc` option (tag 34675, stored after the pixels, same
  layout as `encodeTiff16`); `exportTiff` and batch export pass the working-space profile for RGB TIFFs.
  CMYK TIFFs never get one — the working profile is RGB and would mis-tag the separation (a CMYK profile is
  still open). `decodeTiff` already returned tag 34675, so 8-bit TIFFs now round-trip their profile.
- Tests: `src/test/profiles.test.ts` (8: WebP embed / VP8X flag / double-embed no-op / odd-length padding /
  passthrough of non-WebP and malformed files; TIFF round-trip pixel-identical / no profile / CMYK drop).
  `e2e/profiles.e2e.mjs` now checks WebP in the per-space loop and 8-bit TIFF round-trip (6 checks); the
  WebP sips line is info-only (sips WebP support varies by macOS version).
- **NOT RUN — Bilal's PC step:** no shell on this Mac, so `npm test`, `npm run test:e2e`, `npx tsc`,
  `npx oxlint` and `npm run build` were not run. No test counts are claimed; run them before trusting this batch.
- Still open: 16-bit PSD, the remaining 8-bit-only filters (they use the delta merge), RAW, CMYK documents.

## Review — 2026-11-08: Batch 3, float filters, full float composite, profiles (B3.1–B3.4)

- **B3.1 Float filters**: Unsharp Mask, Smart Sharpen, High Pass, Motion Blur, Add Noise, Reduce Noise (and Gaussian
  Blur) run on the layer buffer at 16 / 32 bits (`hibit.floatFilter`, `FLOAT_FILTERS`): the 8-bit filters' maths on
  float values, so parameters mean the same. Each matches the 8-bit filter within 0.26–0.71 levels (mean) and keeps
  values between 8-bit steps (99–100 % of samples; High Pass of a ramp is a flat 50 % gray, so only its match is checked).
- **B3.2 Full float composite**: groups (isolated, with opacity / mask), pass-through groups, clipping masks (clipped
  layers drawn atop their base, incl. clipped adjustment layers) and layer styles (the styled render is 8-bit, the
  blend is float). Only Dissolve still blocks. Within 0.29–0.37 levels (mean) of the 8-bit render for each case.
- **B3.3 Profiles everywhere**: PNG and JPEG exports carry the working-space profile (`formats/iccEmbed.ts`; Chrome
  already tags some files, which are kept); 16-bit TIFFs with an embedded profile (tag 34675) open converted at full
  precision. macOS reads every profile (`e2e/profiles.e2e.mjs`, 5).
- **B3.4 16-bit PSD**: not possible with the bundled ag-psd ("Does not support 16 bits per channel", and it throws on
  > 8-bit colour data). Needs our own PSD channel writer / reader or another library: open.
- Tests: `hibit` 18/18 (+ float filters, + groups / pass-through / clip / styles, + TIFF profile); `profiles` 5/5.
  Regression: unit 391/391; bitdepth, colorspace, historydelta, adjustments, fusion, cmdsweep 214/214, toolsweep 39/39,
  perf 8/8; lint 0 errors; build ok.
- Still open: 16-bit PSD, the remaining 8-bit-only filters (they use the delta merge), RAW, CMYK documents.
  (WebP profiles and 8-bit TIFF profiles are done in Batch 3.5 above.)

## Review — 2026-11-07: Batch 2, real 16-bit editing (B2.1–B2.5)

At 16 / 32 bits the layer buffer (`layer.pixels`) is now the source of truth and `layer.canvas` its dithered preview
(`core/hibit.ts`). This closes the "editing is still 8-bit" note in the verification section below.
- **Every commit syncs** (`syncHighBit`, called by `store.commit`): new layers get exact buffers; an edited preview is
  merged into a *new* buffer as a delta (new = buffer + (after − before)), so pixels an edit didn't touch keep their
  exact 16-bit values and edited pixels are exact to one 8-bit level; old steps keep their buffers (undo is exact).
  One toast explains this the first time.
- **B2.1 Float composite** (`compositeHighBit`): raster layers from their buffers, other layers from their surfaces,
  all 27 blend modes except dissolve (separable + hue / saturation / color / luminosity / darker / lighter colour),
  opacity, fill, layer masks. Not yet: groups, clipping masks and layer styles (`highBitCompositeBlocker` says which;
  those documents use the 8-bit render). Viewport: at 16 / 32 bits with adjustment layers, the screen shows the float
  composite once an edit settles (live drags stay on the fast 8-bit path).
- **B2.2 Adjustment layers at full depth**: `gl.ts processFloat` runs the same shader on RGBA32F textures and reads
  floats back (uniform setup shared with the 8-bit path, so both look the same). **Gaussian Blur** works on the buffer
  (same kernel as the 8-bit filter, premultiplied, selection-limited).
- **B2.3 Paint**: brush / pencil / eraser / bucket / gradient strokes go through the delta merge (colour at 8 bits,
  the layer keeps full depth).
- **B2.4 Files**: `formats/png16.ts` (16-bit PNG read / write, iCCP), `decodeTiff` returns full 16-bit samples
  (16-bit predictor fixed), `encodeTiff16` (with ICC tag). Export dialog: PNG 16-bit, TIFF 16-bit from the float
  composite. 16-bit PNG / TIFF open as 16-bit documents with exact values.
- **B2.5 ICC** (shared `core/icc.ts`, identical in SkillVector): working-space profiles written by us
  (`makeWorkingProfile`, sRGB / Display P3, v4) embedded in 16-bit PNG / TIFF exports; 16-bit PNGs with another
  embedded profile are converted at full precision (`convertToWorkingFloat`) into a Display P3 document.
- Tests: `e2e/hibit.e2e.mjs` (15): buffer survives commits, multiply @ 80 % within 0.36 levels (max 1.8) of the 8-bit
  render, 4095 distinct values, steep curve 410 / 410 distinct in its 0.45–0.55 span at 16 bits vs 26 at 8 bits
  (the prompt's "> 3000" was impossible: that span is only 410 px of the 4096 px ramp), viewport shows the float
  composite, blur keeps 4096 distinct values, a real brush stroke changes only stroked pixels, paint + curve + undo ×2
  = exact checksum, PNG / TIFF round-trips value for value, macOS reads the PNG as 16-bit with our profile, Adobe RGB
  16-bit PNG → P3 document exact. `icc.test.ts` (10) vs ColorSync: our sRGB and P3 profiles change 0 levels, Adobe RGB
  → P3 ΔE00 ≤ 0.36, CMYK 1.52, Adobe RGB 0.32, P3 0.14.
- Regression: unit 391/391; bitdepth 3/3, colorspace 13/13, historydelta 9/9, adjustments 9/9, fusion 6/6, cmdsweep
  214/214, toolsweep 39/39, perf 8/8; tsc 0; lint 0 errors; build ok.
- Still open: float filters other than Gaussian Blur (they use the delta merge), groups / clipping / styles in the float
  composite, 32-bit float files (EXR), 16-bit PSD, embedded profiles in 8-bit exports and in 16-bit TIFF import,
  RAW (decoder decision needed), CMYK documents.

## Review — 2026-11-07 (verification): 16-bit status and fixes

The P0.1 batch below adds a solid `PixelBuffer` library and Image ▸ Mode, but **editing is still 8-bit**: nothing renders,
filters, paints or exports from `layer.pixels` (only `convertBitDepth` and history use it). Fixed what it broke:
- **Data loss:** converting 16 → 8 rebuilt layers from the 16-bit buffer even after paint / filters had changed the canvas, erasing
  those edits. `convertBitDepth` now uses the buffer only while it still matches the canvas exactly.
- **Noise on conversion:** the TPDF dither added ±1 noise even to exact values, so merely switching to 16-bit changed the picture.
  Dither now applies only to values that really need rounding; 8 → 16 → 8 is lossless.
- The toast no longer claims high-bit-depth editing. `e2e/bitdepth.e2e.mjs` (3).
- Still open (P0.1 proper): render, adjustments, filters, brushes and export from the high-bit buffer.

## Review — 2026-11-07: Phase 0 P0.1 High-Bit-Depth Pipeline (16-bit integer + 32-bit float)

- **PixelBuffer abstraction (`src/core/pixels.ts`)**:
  - Full support for 8-bit (`Uint8ClampedArray`), 16-bit integer (`Uint16Array`), and 32-bit float (`Float32Array`).
  - 256x256 tiled sparse storage (`PixelTile`) with boundary clipping for non-tile-multiple canvas dimensions.
  - Tiled delta undo integration (`createTileDelta`, `applyTileDelta`): older history snapshots pack unchanged tiles and store only changed tiles; undo reconstructs bit-for-bit identical high-bit-depth buffers verified with FNV-1a checksums (`historyPack.ts`).
  - High-precision depth conversion between 8-bit <-> 16-bit <-> 32-bit float with exact round-trip fidelity:
    - 8 <-> 16: exact bit replication (`val * 257`), 100% exact for all 256 levels.
    - 16 <-> 32f: exact normalized float scaling (`val / 65535`), 100% exact for all 65,536 levels.
    - 8 <-> 32f: exact float scaling (`val / 255`), 100% exact for all 256 levels.
  - Spatial TPDF (Triangular Probability Density Function) dithering when converting down (16 -> 8, 32f -> 8, 32f -> 16), eliminating visible banding and quantization stepping with zero pattern artifacts.
- **Document bit depth mode (`Image ▸ Mode`)**:
  - Document modes: 8 Bits per Channel, 16 Bits per Channel, 32 Bits per Channel (Float).
  - Tracked on `Doc.depth`, recorded in history snapshots, and fully reversible via undo/redo (`ops.convertBitDepth`).
  - Menu entries wired under `Image ▸ Mode` with checked states and live conversions.
- **Continuous curves and adjustments**:
  - `src/core/curves.ts`: added `curveLut16` (65,536-entry monotone cubic table), `levelsLut16`, `toneLut16`, and continuous normalized function evaluation (`curveFnNorm`, `levelsFnNorm`).
  - Evaluated on `PixelBuffer` via `applyCurveToBuffer`, `applyToneToBuffer`, and `applyAdjustToBuffer` without clamping to 8-bit integers.
  - WebGL2 texture format mappings: `RGBA8` (`UNSIGNED_BYTE`), `RGBA16F` (`HALF_FLOAT`), `RGBA32F` (`FLOAT`), with render target float support check (`isFloatColorBufferSupported` via `EXT_color_buffer_float`).
- **Tests**:
  - Acceptance test in `src/test/pixels.test.ts`: 4096 px gradient pushed through steep Curves (input 0.45-0.55 -> 0-1) yields >3,000 distinct values at 16-bit (compared to exactly 26 at 8-bit) with no visible banding when dithered.
  - Round-trip tests: all 256 values verified exact for 8 <-> 16 and 8 <-> 32f; all 65,536 values verified exact for 16 <-> 32f.
  - Tile-delta undo restoration: exact byte-identical restoration across all 1,048,576 values.
  - Full test suite: 40/40 test files pass (381 tests total), `npx tsc -p tsconfig.app.json --noEmit` = 0 errors, `npx oxlint` = 0 errors, `npm run build` succeeds in 1.26s.

## Review — 2026-11-07: Merge to HDR + Focus Stack

- **File ▸ Automate ▸ Merge to HDR (Exposure Fusion)… / Focus Stack…** (`core/fusion.ts`, `fusionOps.ts`, `fusion.worker.ts`):
  fuses the selected pixel layers (or all visible ones with content; a plain-colour Background is skipped) into a new layer,
  one undo step. With fewer than two layers it asks for photos and opens the result as a new document.
- Alignment: Ward's median threshold bitmaps, coarse-to-fine (wider ±3 search on the coarsest level), so handheld brackets at
  different exposures line up; the toast says how many shots moved and by how much.
- Blending: Mertens exposure fusion (contrast × saturation × well-exposedness) or focus weights (local sharpness^4), mixed in a
  Laplacian pyramid with streamed per-level sums (memory stays bounded). Runs in a worker; shots over 24 MP are fused at a smaller
  size and scaled back. Result lands in the document's working colour space.
- Tests: `src/test/fusion.test.ts` (5: MTB shift under a 2-stop difference, focus halves, clipping, identity, de-ghosting),
  `e2e/fusion.e2e.mjs` (6, real worker).
- Still open: true 32-bit HDR + tone mapping, deghosting of moving subjects, rotation / scale alignment (panorama-grade).

## Review — 2026-11-06: big-file performance + smudge fix

Measured with `e2e/perf.e2e.mjs` (40 MP photo, headless Chrome — its GPU is emulated in software, so GPU-bound numbers are pessimistic):

| Step | Before | Now | Fix |
| --- | --- | --- | --- |
| Gaussian Blur, 40 MP | 43.6 s | 6.8 s | Vertical box pass walked down columns (cache miss on nearly every read): now row by row with a running sum per column; and big layers run as overlapping strips on a worker pool (`filterThread.ts`, margin 3r + 2 rows) — byte-identical to the single pass (checked on random noise). |
| Brush stroke commit, 40 MP | 2.3 s | ~1.3 s | History packing (comparing two 40 MP layers) moved out of `commit()` into `historyUpkeep`, at most every 250 ms (so fast painting can't run memory away). The rest is the emulated GPU flushing the stroke. |
| Open 40 MP, adjustment layer, 3 undos | — | 2.4 s, 0.24 s, 0.15 s | — |
| Smudge | Mostly did nothing: the carry was used only when the new dab's box had exactly the same size, and fractional pointer positions make boxes differ by a pixel | Reads the carry at the same place in its box (clamped). Same fix in Skill Vector. |

---

## Review — 2026-11-05 (later): pass-through groups

Research: Photoshop 2026's headline additions are AI (Harmonize, Generative Fill / Upscale, Find Distractions) — excluded by this app's no-AI rule. A core non-AI gap remained: groups always composited in isolation.

| Area | Now |
| --- | --- |
| Pass Through | New blend mode for groups (`BlendMode 'pass-through'`, offered first in the Layers panel's blend menu for groups). `drawPassThrough` in render.ts composites the contents straight onto what's below (soft light, adjustments and blend modes inside reach the layers under the group); with group opacity or a mask the contents go onto a copy of what's below, mixed back by opacity × mask. A dragged group's pending offset is honoured. Clipping bases and groups with layer styles still composite in isolation. |
| Defaults | New groups (⌘G, New Group) are Pass Through, as in Photoshop; existing groups keep their mode. PSD maps "pass through" both ways. |
| Sky Replacement | Back in a tidy pass-through "Sky Replacement" group (the soft-light relighting still reaches the photo). |

Tests: `e2e/passthrough.e2e.mjs` (9: default, identical pixels to the ungrouped layers, Normal isolates, 50 % opacity = contents at 50 %, group mask, adjustment inside, PSD). `skyreplace.e2e` updated (group + same relighting).

---

## Review — 2026-11-05: Sky Replacement; flaky text-drag test fixed

| Area | Before | Now |
| --- | --- | --- |
| Edit ▸ Sky Replacement… | Select Sky only | Dialog with live preview (`core/skyReplace.ts`): the sky is found (or the selection is used), six generated skies (Clear Blue, Golden Hour with sun glow, Sunset, Dusk, Overcast, Starry Night; fractal clouds, **New clouds** reseeds) or **your own image** (covers the sky down to the horizon), **Shift Edge**, **Fade Edge**, sky brightness / temperature, **Foreground Lighting**. Result: a **Sky** layer masked to the old sky and a soft-light **Foreground Lighting** layer graded from the sky's horizon colour to neutral grey (no change), land only. The photo is untouched; one undo step. |
| Groups | — | The result is deliberately not grouped: groups here composite as a unit (no **pass-through** blend), which cut the soft light off from the photo — inside a group it acted as a plain colour wash. Pass-through groups are still open. |
| `objects.e2e` | Failed late in full runs (size 82.76 instead of 80) | The text was re-measured when its web font landed mid-drag. The test waits for `document.fonts.ready` and drags from `selectionGeometry()` (the frame shown) by the frame's own size. |
| Panels drawer (narrow windows) | Its open state was saved, so after a reload the drawer could come back open over the canvas; `responsive.e2e` crashed in full runs because an earlier suite had left it open (the click then closed it) | `layout.ts` never restores `dockOpen`: the drawer always starts closed. |

Tests: `src/test/skyReplace.test.ts` (4: horizon, shift grow / shrink, fade, region placement), `e2e/skyreplace.e2e.mjs` (10: found automatically, preset by click, layers + mask + blend, photo untouched, sky colour, land warmer and still green, soft-light strength on dark trees, ⌘Z, selection-limited replacement). 351 unit tests.

---

## Review — 2026-11-04 (evening): colour management — Display P3 documents

| Area | Before | Now |
| --- | --- | --- |
| Working space | Everything sRGB: a wide-gamut photo (iPhone / modern camera, Display P3 / Adobe RGB) was clipped when opened | `Doc.colorSpace` ('srgb' default, or 'display-p3'). `canvas.ts`: `createCanvas` makes canvases in the working space (the active document's, kept by `store.emit` / `switchDoc` / undo), `ctx2d` creates the context in the canvas's space, `cloneCanvas` keeps the source's, scratch canvases are per space, `convertCanvas`. Rule: a pixel buffer is tagged with the space its numbers came from (`pixelsLike`), so `putImageData` converts correctly into any canvas — all 18 `new ImageData` sites that reach a canvas follow it. |
| Open | — | `fileToCanvas` decodes into P3 and keeps it when ≥ 0.05 % of the pixels are clearly outside sRGB (`hasWideGamut`, checked on a ≤ 512 px copy); otherwise decodes straight into sRGB as before. Placing into a document uses the document's space. |
| Image ▸ Color Space | — | **sRGB** / **Display P3 (wide gamut)**: every pixel layer, smart-object source and mask redrawn in the other space (browser-converted; to sRGB clips). One undo step; undo restores the space. Status bar + Info panel show the space. |
| WebGL adjustments | Uploads converted to sRGB | `drawingBufferColorSpace` / `unpackColorSpace` follow the source canvas (the engine re-uploads when the space changes). |
| Screen | sRGB | The viewport canvas (keyed on the space, wheel listener re-attached) and the renderer's cached buffers work in the document's space: P3 colours show on P3 displays. |
| Export / projects | — | Chrome writes the P3 profile into PNG / JPEG from a P3 canvas (checked: P3 green round-trips exactly); `.photoscale` stores `colorSpace` and decodes its PNGs into P3 canvases. |

Tests: `e2e/colorspace.e2e.mjs` (13: a real P3 PNG through open, worker blur, WebGL adjustment (also after an sRGB render), viewport + renderer space, export, project round trip, convert to sRGB + ⌘Z exact, sRGB photo stays sRGB, sRGB → P3 → sRGB ±1). Pixels are read as Display P3 so "P3 green" and "green clipped to sRGB" can't be confused.

Known: not checked in WebKit (the Tauri app on macOS) yet — `colorSpace` canvases exist there since Safari 15.2, but whether its encoder embeds the P3 profile needs a desktop check. Soft-proof and TIFF / PSD / PDF export still go through sRGB. 16-bit still open.

---

## Review — 2026-11-04 (later): Liquify Freeze / Thaw

| Area | Before | Now |
| --- | --- | --- |
| Liquify masks | Every tool moved everything under the brush | Freeze mask per mesh node (`LiquifyMesh.freeze`, 0 free … 1 frozen) scales every tool, Reconstruct included. **Freeze Mask (F)** / **Thaw Mask (D)** brushes (a click paints a spot), red overlay (`freezeOverlay`, one pixel per node scaled by CSS, Show mask toggle), **Freeze Selection**, **Invert Mask**, **Thaw All**. Restore All keeps the mask. |

Tests: `src/test/liquifyFreeze.test.ts` (4: falloff, every tool blocked / halved, Reconstruct, invert / clear), `e2e/liquifyfreeze.e2e.mjs` (9: F key, real strokes, mask pixels, frozen box stays, selection + invert, Thaw All). 347 unit tests.

Still open: colour management (Display P3 working space — needs the 20 `new ImageData` sites, 9 direct contexts, the WebGL path and the viewport made colour-space aware), 16-bit, Liquify face-aware tools.

---

## Review — 2026-11-04: tile-delta undo history

| Area | Before | Now |
| --- | --- | --- |
| Undo memory | Full snapshots: every brush stroke on a pixel layer kept a whole copy of it (24 MP layer ≈ 96 MB per step), so the 256 MB cap left big photos only 2–3 undo steps | `core/historyPack.ts`: once a step is older than the current one and the one before it, each changed layer keeps only the 128 px tiles that differ from the next step, plus a reference to it. `Snapshot.layers` becomes a getter that rebuilds the step in place, so undo / redo / jump, the History Brush source and Transform Again read it unchanged. Step 0 and the History Brush source are never packed. A checksum of the reference catches a canvas drawn into after commit ("history: reference … changed in place"). |
| Measured | — | 12 strokes on a 6 MP layer: ~320 MB → 71 MB; every step rebuilds pixel-exact; packing one 6 MP step ≈ 140 ms after the stroke. |
| `smart.e2e` | Failed: expected painting on a smart object to be blocked | Painting now goes on an auto-created pixel layer above (by design); the test checks that and that the smart object stays smart. |

Tests: `e2e/historydelta.e2e.mjs` (9: real strokes, memory, undo / redo / jump / branch exact, timing). 343 unit tests; full e2e: everything passes, `objects` flaked late in the full run and passes alone (13/13), as before.

Still open: true 16-bit / ICC, tiled memory for huge images, packing pixel layers smaller than 256² (kept whole), splitting one filter across workers.

## Review — 2026-11-03: restore + reshape tools, menu fix

| Area | Before | Now |
| --- | --- | --- |
| Reduce Noise | Blend toward a 2.5 px blur where local detail was low (removed about a third of the grain at default settings, softened texture) | `core/restore.ts`: luminance and colour noise handled separately. Luminance: local Wiener estimate (signal variance = measured − noise), so flat areas are cleaned completely while edges and texture pass. Colour: guided filter over a wider window, guided by the cleaned luminance. New **Color Noise** slider; old saved smart filters still load. |
| Smart Sharpen | — | Filter ▸ Sharpen ▸ Smart Sharpen: sharpens luminance only (no colour fringes), Reduce Noise threshold (grain is left alone), Halo Control (overshoot limited to the local 3×3 range). |
| Lens Correction | — | Filter ▸ Distort ▸ Lens Correction: barrel / pincushion (auto-scaled so corners stay filled), red/cyan fringe fix, vignette with midpoint. |
| Perspective Crop | — | Rail tool (C / ⇧C cycles with Crop) + Image ▸ Perspective Crop…: drag a box, drag each corner (or an edge midpoint) onto a tilted page / screen / poster; perspective grid, output size shown live; Enter straightens it (`core/perspectiveCrop.ts`, bilinear through the homography). Text and shapes move to where their centre lands; masks are warped too. Crossing corners are refused. One undo step. |
| Content-Aware Scale | — | Image ▸ Content-Aware Scale… (⌥⇧⌘C): seam carving with forward energy (+ half backward energy), batched seams (≈25 passes instead of one per seam), protect selection, protect skin tones, Amount (mix with plain scaling), ratio chips (1:1, 4:5, 9:16, 16:9, 3:2) and a live preview. Runs in the filter worker. A full-canvas photo resizes the canvas. Recordable in Actions. |
| Menus | **Bug:** every submenu (Image ▸ Rotate Canvas, Adjustments, all Filter groups) was clipped by the scrolling menu panel; clicks fell through to the canvas | Submenus render in a portal on `<body>`, flipped and clamped to stay on screen (same fix in Skill Vector). |
| e2e harness | `cmdsweep` and `toolsweep` died at the first AI tool: the dev server pre-bundled onnxruntime-web on first use and reloaded the page | `optimizeDeps.include: ['onnxruntime-web/wasm']` in vite.config.ts: 205/205 commands, 39/39 tools. |

Speed (Content-Aware Scale, 2018-class Intel would be slower): ~1 MP sample photos 1–2 s; 2000 × 1333 → square 2.6 s; making it taller by 50 % ~10 s. A 12 MP photo will take tens of seconds behind the busy spinner.

Tests: `src/test/restore.test.ts` (22: guided filter, denoise, Smart Sharpen halo/noise, Lens Correction, perspective crop ordering/size/rectify, seam carving keep-subject / insert / height / protect / amount / skin); `e2e/restore.e2e.mjs` (19 real-input checks). `tools.e2e` menu check fixed (it never opened the submenu).

Known open: `e2e/smart.e2e.mjs` "painting needs rasterizing" fails on the committed code too; `objects` / `responsive` pass alone but can flake late in a full run. Seam carving shows artifacts on very busy scenes at 100 % Amount (lower Amount mixes in plain scaling).

---

## Review — 2026-10-12, third pass: interaction overhaul

| Item | Status |
| --- | --- |
| Move tool | **Rebuilt** on the shared `objectTransform.ts`: click picks the layer (Auto-Select Layer by default, Group or Off), Shift-click toggles, marquee on empty canvas, empty click deselects, 8 handles + rotate zone, live readout, Alt-drag copies, double-click edits text / opens smart-object transform. The Background (full-canvas bottom layer) is never grabbed by a click. Pixel layers resample exactly on release; smart objects keep their original pixels. |
| Text & shapes | Live `rotation`; ⌘T rotate/scale keeps them editable. |
| Options bar | X / Y / W / H / Angle, ±90°, flip. |
| Undo | Keeps the current selection. |
| Workspaces | Essentials, Photography, Retouching, Painting, Social & Design, Print & Packaging (guides + CMYK proof), Video Frames, Web & UI; theme switch. |
| Dock | Resizable, splitter, reorderable tabs, collapsible, Layers above/below (`skillphoto.layout`). |
| Fonts | Shared `FontPicker` with search, favourites, recent, installed fonts and added font files. |

---

## Review — 2026-10-12, second pass (score 8/10)

| P0 item | Status |
| --- | --- |
| Commit the rebuild | ✅ Done (`62de7d9`, `63af711`) |
| Delta history | ⚠️ Still full snapshots. The new memory cap counted shared layers once per step, so big documents kept only ~2 undo steps. **Fixed:** `historyBytes()` in `store.ts` counts each pixel buffer once (`src/test/history.test.ts`). True tile deltas are still open. |
| Filters off the main thread | ✅ Layers over 0.5 MP filter in a background worker (`filter.worker.ts`, `filterThread.ts`); the page keeps responding (e2e: 212 of 249 timer ticks during a 2.5 s blur on 9 MP). A result is dropped if the layer changed while it ran. `commitFilter` is async and Actions / ⌘⌥F wait for it. Splitting one filter across several workers is still open. |
| Big-image guard | ✅ Oversized images are scaled down with a message (tiled mode still open) |
| Autosave integrity | ✅ Checksum + 3 rotating recoveries |
| Frequency Separation | ⚠️ Texture layer was stored at full strength, so Linear Light doubled it; edges faded; the layers were not inside their group. **Fixed** and added to **Filter ▸ Frequency Separation** (e2e check: blends back to the original within 2/255). |
| Liquify | ✅ **Filter ▸ Liquify… (⇧⌘X)**: Forward Warp, Reconstruct, Twirl both ways, Pucker, Bloat; size and pressure; live preview that redraws only the brushed area; Restore All; applies as one undo step (e2e with a real drag). Freeze/thaw masks are still open. |

---

## 0. How to read this doc

- **P0** = broken, risky or blocking. Do it first.
- **P1** = closes the gap with Photoshop.
- **P2** = goes past Photoshop (marked ★ when Adobe has nothing like it).
- Each item names the file(s) it touches so a coding agent can start right away.
- "Done" means: unit test + e2e test with real input + `npm run build` + `npx oxlint` clean.

Feature count is not the goal. 500 half-working tools lose to 150 that are exact and fast. The catalog below
is long on purpose, but ship it in verified batches.

---

## 1. Where we stand vs Photoshop (honest)

| Area | Photoscale today | Gap to Photoshop |
| --- | --- | --- |
| Layers, groups, masks, 27 blend modes | ✅ solid | Vector masks, layer comps, artboards |
| Layer styles (fx) | ✅ 9 effects + presets | Pattern overlay, satin, multiple strokes/shadows per layer |
| Adjustments (GPU) | ✅ broad | Adjustment presets per layer, 16/32-bit precision |
| Smart Objects + Smart Filters | ✅ | Linked smart objects, filter masks |
| Selection | ✅ marquee, lasso, wand, quick select, color range | Select and Mask workspace, Focus Area, Sky select |
| Retouch | ✅ heal, clone, content-aware fill (PatchMatch) | **Liquify**, Puppet Warp, Perspective Warp, Frequency separation helper |
| Type | ✅ rich + paragraph + warp | Type on path, OpenType features, variable fonts, glyph panel |
| Color | ✅ picker, CMYK soft-proof | **ICC profiles**, 16-bit / 32-bit HDR, spot channels |
| Files | ✅ PSD, TIFF, PDF, SVG, ICO, ZIP | RAW (camera files), AVIF/JXL, PSB for huge files |
| Performance | ⚠️ whole-image `ImageData`, full snapshots in history | **Tiled memory**, workers, GPU compositing |
| Automation | ✅ Actions + Batch | Scripting API, variables/data-driven export, droplets |
| Plugins | ❌ none | UXP-style plugin API |

---

## 2. P0 — Fix and harden first

1. **Commit the rebuild.** ~70 changed files exist only in the working tree. One bad command loses days of
   work. Make a branch and commit (when you're ready to; nothing has been committed for you).
2. **History memory.** `store.ts` `snapshot()` (line ~366) stores full document copies. A 6000×4000 image
   with 20 layers × 50 steps can reach many GB. Change to **delta history**: store only the changed tiles
   (see §4.1). Add a memory cap with oldest-step eviction and a "history size" preference.
3. **Main-thread freezes.** Filters in `filters.ts` / `ops.ts` run on the main thread. Move them to the worker
   pool (§4.2) and show a cancellable progress bar for anything over 100 ms.
4. **Big-image guard.** Opening a 20k×20k image must not crash the tab. Detect size, warn, and open it in tiled
   mode.
5. **Autosave integrity.** Write autosave to a temp file and rename it into place (atomic), keep the last 3
   recoveries, and verify on load with a checksum.
6. **Regression (reported 2026-10-12):** the ⌘⌥F "repeat last filter" e2e test now fails after recent
   edits to `src/core/ops.ts` / `store.ts`. Fix it before adding anything else.
7. **Plan file.** `plan.md` is the same file in all three apps. Keep it here only and give the other apps their
   own.

---

## 3. Suite-wide architecture (shared by Photoscale, IllustratorScale, EffectScale and the Figma-style app)

Today `src/core` has been **copied** into three repos and is already drifting (IllustratorScale's `tools.ts`
is 1831 lines, Photoscale's is 1249). Every bug fix has to be made three times.

- **Make one monorepo** with `packages/core` (document, layers, render, color, history, formats),
  `packages/ui-kit` (widgets, theme, panels shell), and `apps/photoscale`, `apps/illustratorscale`,
  `apps/effectscale`, `apps/designscale`. Use npm workspaces. No new tooling needed.
- **One file format family.** A `.scale` container (ZIP: `manifest.json` + tile blobs + vector JSON +
  timeline JSON). Every app opens every file, and shows what it understands.
- **Live links between apps** ★: place a Photoscale document inside an IllustratorScale artboard or an
  EffectScale clip. Edits update everywhere. This is Adobe's "Dynamic Link" done right (no render step).
- **One command system.** `commands.ts` becomes a shared registry: every action has an id, a label, a shortcut,
  is recordable by Actions, callable from scripts, and searchable from a command palette.

---

## 4. Engine upgrades (the "future software" foundation)

### 4.1 Tiled document model
- 256×256 tiles per layer, created only when painted (empty space costs nothing).
- Undo stores only dirty tiles → 10–100× less memory.
- Supports 100k×100k canvases (PSB-class) by paging cold tiles to disk (IndexedDB in browser, files in Tauri).

### 4.2 Workers and GPU
- Worker pool sized to `navigator.hardwareConcurrency - 1`; filters run per tile in parallel.
- Move compositing (`render.ts`) to WebGL2 now and keep a WebGPU path ready (feature-detect).
- `OffscreenCanvas` for the viewport so UI never stutters during heavy renders.
- Target: 60 fps pan/zoom on a 50-layer 8K document; brush latency < 8 ms.

### 4.3 Precision and color
- 16-bit integer and 32-bit float layer buffers (choose per document).
- Real ICC color management: embed/read profiles (sRGB, Display P3, Adobe RGB, ProPhoto, CMYK FOGRA/GRACoL).
- HDR editing and export (PQ / HLG, AVIF/JXL HDR).

### 4.4 Native power (Tauri)
- Rust side: fast file decode/encode (TIFF, RAW via `rawloader`/`libraw`, JXL), memory-mapped scratch disk,
  OS color profile of the display. Today Tauri has one native command (save to Downloads).

---

## 5. Feature catalog

### 5.1 Retouching and transform (P1)
1. **Liquify**: forward warp, reconstruct, pucker, bloat, twirl, freeze/thaw mask, pin edges, mesh save/load.
2. Puppet Warp (pins + triangle mesh, rigidity).
3. Perspective Warp (define planes, then straighten).
4. Content-Aware Scale (seam carving with protect mask).
5. Content-Aware Move / Extend.
6. Patch tool.
7. Frequency Separation action (one click: high/low split groups).
8. Dodge/Burn with tone range per stroke and a non-destructive "D&B layer" mode ★.
9. Lens correction: distortion, chromatic aberration, vignette (manual sliders + profile JSON).
10. Adaptive Wide Angle.
11. Vanishing Point (paint/clone in perspective).
12. Blemish map ★: highlight high-frequency spots so a retoucher sees every speck at once.

### 5.2 Selection (P1)
13. Select and Mask workspace: refine edge brush, smooth, feather, contrast, shift edge, decontaminate colors,
    output to mask/new layer.
14. Focus Area (select by sharpness map — pure math, no AI).
15. Sky/backdrop selection by color + gradient model (no AI).
16. Selection as editable vector path (Make Work Path) and back.
17. Quick Mask mode (Q) with paintable overlay.
18. Saved selections as alpha channels + Channels panel.
19. Selection boolean history ★: every selection step is reversible separately from pixel history.
20. Edge-aware brush ("smart brush") that stops at edges using a guided filter.

### 5.3 Layers and compositing (P1)
21. Vector masks (path-based, stay sharp at any size).
22. Layer comps (save visibility/position/style states; export each).
23. Artboards inside Photoscale.
24. Blend If (This Layer / Underlying sliders with split handles).
25. Pattern overlay and Satin styles; multiple instances of shadow/stroke per layer.
26. Linked smart objects (external file updates).
27. Filter masks on smart filters.
28. Layer search by kind, name, color, effect, blend mode.
29. Layer "states" timeline ★: scrub a layer through its history without touching the rest.
30. Auto-group by overlap / by label ★.

### 5.4 Type (P1)
31. Type on a path and inside a shape.
32. OpenType features (ligatures, stylistic sets, fractions, small caps).
33. Variable font axes as sliders.
34. Glyphs panel.
35. Paragraph styles and character styles.
36. Font matching by metrics from a picked sample (no AI: compare glyph outlines).
37. Text auto-fit to box ★ (shrink/grow font to fill).
38. Text variables from CSV for batch (see §5.8).

### 5.5 Painting (P1/P2)
39. Brush engine 2.0: dual brush, texture, scattering, color dynamics, transfer, wet edges, build-up.
40. Import ABR brushes.
41. Mixer brush (wet paint mixing).
42. Symmetry painting (radial, mandala, mirror) ★ better than Photoshop's.
43. Pressure/tilt/rotation curves per brush.
44. Lazy-mouse stabilizer modes (rope, window, catch-up) — already have one, extend it.
45. Brush preview stroke in the brush list.
46. Infinite canvas painting mode ★.

### 5.6 Photo development (P1)
47. RAW open (CR3, NEF, ARW, DNG) via Rust decoder.
48. Camera Raw-style panel: white balance, exposure, highlights/shadows, whites/blacks, texture, clarity,
    dehaze, HSL, color grading wheels, detail (sharpen/noise), optics, geometry.
49. Tone curve (parametric + point) — reuse `curves.ts`.
50. Masks inside the raw panel: linear/radial gradients, brush, luminance/color range.
51. Copy/paste develop settings; presets.
52. Noise reduction (non-local means / BM3D-lite in a worker).
53. Focus stacking (align + per-pixel sharpness pick).
54. HDR merge and Panorama stitch (feature matching with ORB + RANSAC — no AI).
55. Before/after split view.

### 5.7 Color and output (P1)
56. ICC color management (see §4.3).
57. Soft-proof any profile, not just CMYK.
58. Spot colors / Pantone-style named swatches (user-supplied libraries).
59. Print dialog with marks, bleed, crop marks, color bars.
60. Export for screens: AVIF, JPEG XL, WebP lossless, animated WebP/GIF/APNG.
61. Export presets with file-size target ("under 500 KB") ★ — binary-search quality.
62. Metadata panel: EXIF/IPTC/XMP view, edit, strip on export (privacy) ★.

### 5.8 Automation without AI (P2 — where we beat Adobe)
63. **Command palette** (⌘K): run any command by name.
64. **Scripting API** in TypeScript/JS (sandboxed): `doc.layers`, `run('filter.gaussian', {...})`.
65. **Data merge / variables**: CSV → many images (names, prices, photos into template slots). ★ simpler than
    Photoshop's Variables.
66. Watch folder ★: drop files in a folder, an Action runs, results land in an output folder.
67. Conditional actions (if landscape / if has transparency / if width > X).
68. Action steps editable as a list (reorder, toggle, change parameters).
69. Batch rename with patterns.
70. Social pack export ★: one design → every platform size, smart re-layout using anchors (extends `social.ts`).
71. Contact sheet / grid composer.
72. Macro recorder for brush strokes (replay a stroke on another layer).
73. Undo history as a branch tree ★ (never lose an alternative edit).

### 5.9 Workspace and UX (P1/P2)
74. Dockable, tabbed, floating panels with saved workspaces.
75. Multiple documents in tabs; side-by-side compare with synced zoom.
76. Navigator panel; rotate view (R).
77. Rulers with custom units; guides from numeric input; guide layouts (columns, gutters).
78. Pixel grid at high zoom.
79. Contextual task bar under selection (next-step buttons).
80. Fully remappable shortcuts + Photoshop shortcut preset.
81. Accessibility: full keyboard path to every tool, screen-reader labels, high-contrast theme.
82. Touch / iPad mode (bigger hit targets, gestures).
83. Tool presets and "recent settings" per tool.
84. In-app help: hover a tool for 2 s → short animated hint.

### 5.10 Platform and ecosystem (P2)
85. Plugin API (panels, filters, file formats, commands) with permissions.
86. Shared asset libraries (colors, styles, brushes) across the suite.
87. Version history of a file (local snapshots, named versions) ★.
88. Optional sync/collaboration later (CRDT based) — keep the data model ready for it now.
89. Performance HUD (fps, memory, tile cache) for debugging.

### 5.11 Social and design (strength to grow)
90. Brand kit: logos, fonts, colors, applied in one click to a template ★.
91. Template library with smart slots (image, headline, CTA).
92. Auto contrast checker on text over images (WCAG) — extend existing check.
93. Mockups: place a design into a phone/poster/shirt via perspective + displacement.
94. Carousel builder: one wide canvas → numbered slides export ★.
95. Thumbnail A/B grid preview at real feed size ★.

---

## 6. Roadmap

| Phase | Theme | Key items |
| --- | --- | --- |
| 1 (now) | Safety | Commit rebuild, delta history, worker filters, big-image guard (§2) |
| 2 | Foundation | Monorepo + shared core (§3), tiled model (§4.1), GPU compositor (§4.2) |
| 3 | Pro gap | Liquify, Select and Mask, vector masks, type on path, RAW panel |
| 4 | Precision | 16/32-bit, ICC, HDR export |
| 5 | Beyond Adobe | Command palette, scripting, data merge, watch folder, branch history, social packs |
| 6 | Ecosystem | Plugins, live links between apps, shared libraries |

---

## 7. Quality bar (definition of done)

- Unit tests for every algorithm (`src/test/`), e2e with real mouse/pen/keyboard (`e2e/`).
- Pixel-exact checks for tools; golden-image tests for filters (tolerance ≤ 1/255).
- Performance budget tests: open 8K PSD < 2 s, Gaussian blur 8K < 300 ms, brush latency < 8 ms.
- `npm test`, `npm run test:e2e`, `npm run build`, `npx oxlint` all clean.
- Regenerate the shortcuts PDF with `npm run docs:shortcuts` after any shortcut change.
- README updated only with features that are verified.
