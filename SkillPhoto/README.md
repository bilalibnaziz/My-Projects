# Skill Photo

A non-destructive, layer-based photo editor. It runs as a desktop app (Tauri) or in the browser, and all
processing happens locally.

- **Layers**: raster, text, shape and adjustment layers and nested **groups** (⌘G / ⇧⌘G, collapsible, drag
  layers in and out), with masks, clipping, fill opacity and all 27 Photoshop blend modes (the ten Canvas 2D
  lacks, such as Linear Burn, Vivid Light and Hard Mix, run in a per-pixel compositor).
- **Layer styles** (fx): drop shadow, outer / inner glow, inner shadow, bevel & emboss, color and gradient
  overlay, and stroke (inside / center / outside), edited live in a floating panel with one-click presets
  (Sticker, Neon, Retro Offset, Glass…) and copy / paste style. Strokes and spreads use an exact distance
  transform; effects are cached, so moving a styled layer is free.
- **Adjustments**: rendered on the GPU (WebGL2), each on its own maskable layer. Includes Auto Enhance, presets,
  Gradient Map (with duotone presets), Selective Color, Channel Mixer, Photo Filter, Color Balance, a Black & White
  mixer with tint, and Color Lookup (load any 3D `.cube` LUT).
- **Smart Objects**: transform, warp and filter without ever losing quality (every render starts from the original
  pixels). Filters on a smart object become Smart Filters you can hide, re-edit or delete; Replace Contents swaps
  the picture and keeps size, place and filters.
- **Layers, more**: right-click menu, color labels, lock transparency (`/`), and layer search.
- **Free Transform**: scale and rotate, plus Skew, Distort, Perspective and a 4×4 Bézier **Warp** mesh. Groups and
  multi-layer selections transform together (each layer keeps its own pixels and mask).
- **Type**: paragraph text boxes that wrap (drag with the Type tool) and rich text: select characters while editing
  to give them their own font, size, weight, color, italic, underline or strike (⌘B / ⌘I / ⌘U).
- **Color**: a full Color Picker (HSB, RGB, Lab, CMYK, hex, screen eyedropper), WCAG contrast check, color harmonies,
  saved swatches, and View ▸ Proof Colors (⌘Y) / Gamut Warning (⇧⌘Y) with a colour-managed CMYK print simulation.
- **Automation**: Actions record what you do (commands, filters, adjustments, image size, styles, exports) and play
  it back; Batch runs an action over many files into one ZIP. Actions can be saved and loaded as JSON.
- **Liquify** (Filter ▸ Liquify…, ⇧⌘X): Forward Warp, Reconstruct, Twirl, Pucker and Bloat on a live preview.
  **Frequency Separation** splits a layer into tone and texture layers that blend back to the original.
  Big-layer filters run in a background worker, so the window never freezes.
- **Retouching**: brush, pencil, eraser, clone stamp, smudge, dodge/burn/sponge and blur/sharpen. The
  Spot Healing Brush and Content-Aware Fill use multi-scale PatchMatch inpainting in a background worker.
- **Selections**: marquee (incl. single row / column), lasso, polygonal lasso, Quick Selection, magic wand and
  pen paths, plus feather, expand, contract, smooth and color range.
- **More tools**: Pen (bézier paths → shape layers or selections), Healing Brush (source texture, tone matched
  to the surroundings), History Brush, Background and Magic Eraser, Color Replacement (exact W3C
  Color/Hue/Saturation/Luminosity math), Red Eye, Ruler with Straighten Layer, Color Sampler and an Info panel
  (RGB, HSB, Lab, CMYK), and 3×3 / 5×5 / 11×11 sample averaging for the eyedropper.
- **Multiple layers at once**: ⌘/Ctrl-click and Shift-click in Layers, then move, nudge, align, distribute
  (edges, centres or equal spacing), set opacity / blend / lock, duplicate, merge or delete them together.
- **Precision**: paint lands exactly under the pointer. The optional stabilizer still ends every stroke at the
  release point. Zooming keeps the point under the cursor fixed, and moving layers snaps them to smart guides.
- **Social & design**: New Document presets for every major platform (2026 sizes), six editable starter
  templates, and platform safe-zone overlays (Stories, Reels/TikTok, YouTube, X, LinkedIn…) that never
  appear in exports. Text can be all-caps, sit on a rounded highlight box, or be warped (Arc, Arch, Bulge, Flag, Wave, Rise), and a selected shape works as
  a photo frame: Place Image fills it and clips to it. Export offers per-platform sizes.
- **Layout precision**: align to canvas or selection, center, and exact X / Y / W / H fields in the Move
  options bar. Vector layers stay vector when resized. The Type and Shape options bars edit the
  selected layer live (font, size, color, caps, fill, stroke, radius, opacity). ⌥-drag draws shapes from
  the center.
- **Appearance**: VS Code Dark Modern by default (its exact palette and button blue), plus Graphite, Midnight
  and Light themes, any accent color, and a choice of pasteboard gray (Edit ▸ Preferences, ⌘,). Compact
  layout throughout.
- **Files**: open/paste/drop images, save `.photoscale` projects, export PNG/JPEG/WebP, with crash recovery autosave.
  **Photoshop PSD** import and export keeps layers, groups, masks, blend modes, opacity, fill and layer styles
  (text and shapes are written as pixels; adjustment layers are left out of the PSD's layer list).
  Also: TIFF open and save (incl. LZW / PackBits / Deflate and print-ready CMYK TIFF), PDF, SVG (shapes and text stay
  vector), BMP, multi-size `.ico`, Export Layers to Files and @1x / @2x / @3x as ZIP. HEIC opens in the macOS app.

## Run

```bash
npm install
npm run dev          # browser, http://localhost:5173
npm run tauri:dev    # desktop app (needs the Rust toolchain)
npm run tauri:build  # desktop installer
```

## Test

```bash
npm test             # unit tests (Vitest): curves, selections, inpainting, filters, snapping, stabilizer, align, presets
npm run test:e2e     # drives the real app in headless Chrome with real mouse, pen, wheel and key input
npm run lint
```

The e2e suite (`e2e/`) starts Vite and Chrome itself. It checks pixel-exact pointer accuracy, zoom anchoring,
every tool, every menu command, the panels and dialogs. It needs Google Chrome or Chromium (set `CHROME_PATH`
if it isn't in the default location).

## Keyboard shortcuts

Press **⌘/** (Ctrl+/ on Windows/Linux) in the app, or open
[Skill-Photo-Shortcuts-Guide.pdf](Skill-Photo-Shortcuts-Guide.pdf). The PDF is generated from the app's own
command table, so after changing a shortcut regenerate it with:

```bash
npm run docs:shortcuts
```

## Layout

| Path | What lives there |
| --- | --- |
| `src/core/` | Document model and editing engine: store and undo history (`store.ts`), layer groups (`groups.ts`), layer styles (`effects.ts`, `layerStyle.ts`), extra blend modes (`blend.ts`), perspective and text warps (`warp.ts`), PSD I/O (`psd.ts`), tools and pointer handling (`tools.ts`), brush engine (`brush.ts`), selections, filters, GPU adjustments (`gl.ts`), compositing (`render.ts`), inpainting, file I/O, the command and shortcut table (`commands.ts`), snapping (`snap.ts`), alignment, distribution and numeric placement (`align.ts`), the added tools (`proTools.ts`), and social presets, safe zones and templates (`social.ts`). |
| `src/ui/` | React interface: viewport, tool rail, options bar, panels, dialogs. |
| `src-tauri/` | Desktop shell. Its one native command saves exports to the Downloads folder. |
| `e2e/` | Real-input end-to-end tests. |
| `scripts/` | PDF guide generator. |
