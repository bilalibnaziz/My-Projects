# Photoscale — Improvement Doc (Mega Upgrade)

> Goal: not a Photoshop copy, but the editor people pick **over** Photoshop: faster, more precise, more
> automatable, fully local, and built to scale for the next decade.
> Rule for this doc: every feature has to work **without AI**. AI can be an optional extra later, never a
> dependency.

Status checked on 2026-10-12: 106/106 unit tests pass. Core rebuild is still **uncommitted** on top of
`6bac5fd`. Never `git stash` / `reset` in this repo.


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
