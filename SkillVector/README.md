# IllustratorScale (ili ILI Scale)

A professional, local-first vector graphics and illustration design studio. Built as a high-performance vector alternative to Adobe Illustrator, running natively on macOS (Tauri desktop app) and in modern web browsers.

## Key Vector Capabilities

- **Vector Engine & Bézier Anchors**:
  - **Selection Tool (V)** & **Direct Selection Tool (A)**: Select whole objects or interactively manipulate individual anchor points and Bézier control tangent handles.
  - **Pen Tool (P)**: Draw exact cubic Bézier curves, open paths, and closed polygons.
  - **Curvature Tool (⇧P)**: Create and fine-tune smooth curves with automatic harmonic tangent solver.
  - **Anchor Point Tool (⇧C)**: Click or drag anchors to smoothly toggle between sharp corners and smooth continuous tangents.
  - **Join Paths (⌘J)** & **Reverse Path Direction**: Connect open vector endpoints or invert path winding.
- **Multi-Artboards Studio (⇧O)**:
  - Create, layout, and manage multiple artboards across an infinite canvas with live pill title badges.
  - Presets for Print (A4, Letter), Screen (1080p, 4K, 1440p), Mobile (iPhone, iPad), and Social Media.
  - View ▸ Fit Artboard in Window (`⌘0`) & Fit All Artboards (`⌥⌘0`).
- **Pathfinder & Boolean Operations**:
  - **Unite**: Merge overlapping shapes into a single outline.
  - **Minus Front**: Punch out foreground vector shapes from background objects.
  - **Intersect**: Keep only overlapping vector regions.
  - **Exclude**: Invert and punch out intersection areas.
  - **Divide**: Cut overlapping shapes into every region they form.
  - **Shape Builder (⇧M)**: Hover to see each region, drag across regions to merge them, ⌥-click to delete one.
  - Results keep smooth Bézier curves; corners and crossings stay sharp.
  - **Simplify Path** and **Outline Stroke** in the Object menu.
  - **Compound Paths (⌘8 / ⌥⇧⌘8)**: Create evenodd winding punchouts (e.g. stencil text, donuts, rings).
- **Stroke & Appearance Controls**:
  - Line weights, stroke caps (`butt`, `round`, `square`), and corner joins (`miter`, `round`, `bevel`).
  - Stroke dash patterns (`solid`, `dashed`, `dotted`, custom dash arrays).
  - Dual Illustrator Fill & Stroke swatches with toggle (`X`), swap (`⇧X`), and default black/white (`D`).
- **Outline Wireframe Mode (⌘Y)**:
  - Toggle between GPU Preview and authentic Illustrator wireframe Outline Mode to inspect raw Bézier anchor structures.
- **Export & Interoperability**:
  - Full `.illustratorscale` and `.photoscale` project file format saving and recovery.
  - Clean, semantic **SVG** export with native paths, dasharrays, and evenodd fill rules.
  - Quick **"Copy SVG to Clipboard"** for instant pasting into Figma, Affinity, or Illustrator.
  - High-res **PDF**, **PSD**, and zipped Artboard exports.

## Shortcuts Cheat Sheet

| Shortcut | Tool / Action |
|---|---|
| `V` | Selection Tool |
| `A` | Direct Selection Tool (anchors & tangents) |
| `P` | Pen Tool |
| `⇧P` | Curvature Tool |
| `⇧C` | Anchor Point Tool |
| `⇧O` | Artboard Tool |
| `⇧M` | Shape Builder Tool |
| `T` | Type Tool |
| `M` | Rectangle / Ellipse Tool |
| `B` / `N` | Paintbrush / Pencil Tool |
| `X` | Toggle active swatch (Fill ↔ Stroke) |
| `⇧X` | Swap Fill & Stroke colors |
| `D` | Default swatches (Black stroke, White fill) |
| `⌘Y` | Toggle Outline Mode (Wireframe) |
| `⌘8` | Make Compound Path |
| `⌥⇧⌘8` | Release Compound Path |
| `⌘J` | Join Vector Endpoints |
| `⌘0` | Fit Active Artboard in Window |
| `⌥⌘0` | Fit All Artboards in Window |
| `⌘G` / `⇧⌘G` | Group / Ungroup Objects |
| `⌘2` / `⌥⌘2` | Lock Selection / Unlock All |
| `⌘3` / `⌥⌘3` | Hide Selection / Show All |

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
[Skill-Vector-Shortcuts-Guide.pdf](Skill-Vector-Shortcuts-Guide.pdf). The PDF is generated from the app's own
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
