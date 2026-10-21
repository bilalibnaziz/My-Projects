# MASTER BUILD PROMPT — PHOTOSCALE
## Professional Image Editing, Retouching, Compositing & AI Creative Software

Act as a principal software architect, senior graphics-engine developer, computational imaging specialist, AI engineer, UX designer, and QA lead.

Your mission is to design, engineer, test, and deliver **Photoscale**, a professional image-editing application that aims to compete with Adobe Photoshop, Lightroom, Capture One, Affinity Photo, and leading AI photo-editing tools.

Do not build a superficial UI demo. Build a functioning, extensible image-editing product with real image processing, a reliable document model, editable layers, non-destructive adjustments, professional color workflows, and a polished user experience.

The application must have an original identity. Do not copy proprietary source code, protected branding, or exact competitor interfaces.

---

# 1. PRODUCT VISION

Product name: Photoscale

Product category: Professional photo editor, raster graphics editor, digital compositing application, RAW development studio, and AI-assisted creative workspace.

Primary objective:
Create a powerful desktop-first editor suitable for photographers, retouchers, designers, e-commerce studios, marketing teams, digital artists, and advanced hobbyists.

Core principles:
- Professional output quality.
- Non-destructive editing wherever technically possible.
- Responsive editing with progressive rendering.
- Pixel accuracy and color consistency.
- Reliable project saving and crash recovery.
- Excellent keyboard-driven workflows.
- Local-first operation for core editing.
- Optional AI assistance without making the editor dependent on cloud services.
- Accessible, customizable interface.
- Modular architecture that can grow for years.

Never claim a feature is implemented unless it actually works and has been tested.

# 2. PLATFORMS AND TECHNOLOGY

Build a native-feeling desktop application for Windows and macOS, with Linux support where practical.

Preferred architecture:
- Tauri 2 for the desktop shell.
- React and TypeScript for the interface.
- Rust for core image processing, document operations, file management, and performance-critical workloads.
- A GPU rendering backend using WebGPU, wgpu, or an appropriate graphics abstraction.
- A dedicated document and layer model.
- A command-based editing architecture.
- A background job system for expensive operations.
- SQLite for catalogs, metadata, presets, preferences, and job records when persistence is required.
- Versioned project files with explicit schema migrations.
- Automated unit, integration, visual, and performance tests.

Evaluate dependencies before adoption. Prefer maintained, well-documented libraries with compatible licenses.

Use established image codecs and imaging libraries instead of unnecessarily reinventing JPEG, PNG, TIFF, color-management, or RAW decoding.

Suggested integrations to evaluate:
- OpenImageIO or equivalent for image I/O.
- LibRaw or an equivalent licensed RAW-processing solution.
- LittleCMS or another ICC color-management engine.
- OpenEXR for supported high-dynamic-range workflows.
- OpenCV for selected image-processing operations.
- ONNX Runtime or another appropriate inference runtime for compatible local AI models.
- A GPU compute backend for acceleration.

These are candidates, not mandatory dependencies. Verify current maintenance, platform compatibility, redistribution terms, performance, and licensing before selecting them.

Establish a clear boundary between the UI, document model, rendering engine, file codecs, and optional AI modules.

# 3. PROFESSIONAL APPLICATION SHELL

Create a premium, polished, dark-first interface with restrained orange accents, neutral charcoal panels, readable typography, and subtle dividers.

Do not sacrifice editing space for decorative elements.

Main workspace:
- Application menu and command search.
- Top toolbar with context-sensitive options.
- Central canvas with zoom, pan, rotation, guides, and rulers.
- Left tool rail.
- Right-side dockable panels.
- Layer panel.
- Properties and adjustments panels.
- Histogram and color information.
- History panel.
- Status bar with document dimensions, zoom, color profile, and processing state.
- Optional filmstrip or asset browser.
- Bottom progress area for background tasks.
- Full-screen canvas mode.
- Compact, standard, and advanced workspace presets.

Support resizable and dockable panels, panel visibility preferences, configurable keyboard shortcuts, light and dark themes, and saved workspace layouts.

The interface must support small laptop screens and high-resolution monitors.

Provide empty states, loading states, errors, progress indicators, cancel controls, disabled states, and meaningful tooltips.

# 4. DOCUMENT AND IMAGE ENGINE

Implement a real document model that supports:
- Multiple open documents.
- Large canvas dimensions subject to available memory and explicit limits.
- Multiple image layers.
- Transparent layers and alpha channels.
- Layer groups and nested groups.
- Layer ordering and visibility.
- Layer opacity.
- Blend modes.
- Clipping relationships.
- Layer masks and vector masks where supported.
- Adjustment layers.
- Text layers with editable text properties.
- Shape layers.
- Smart or linked objects where feasible.
- Embedded and linked assets.
- Selection state.
- Guides, grids, rulers, and canvas metadata.
- Undo and redo.
- Document dirty-state tracking.
- Save, Save As, autosave, and recovery.
- Background rendering and progressive previews.

Use tiled rendering or another memory-aware strategy for large images.

Keep a high-quality source representation separate from display previews. Avoid repeatedly compressing or resampling the original image during ordinary editing.

Use immutable commands, snapshots, checkpoints, or a hybrid history model for dependable undo and redo.

Define resource limits and gracefully handle allocation failures.

# 5. PROFESSIONAL IMAGE ADJUSTMENTS

Implement genuine image-processing operations with configurable strength, predictable output, and preview support.

Basic adjustments:
- Exposure.
- Brightness.
- Contrast.
- Highlights.
- Shadows.
- Whites.
- Blacks.
- Gamma.
- Temperature.
- Tint.
- White balance.
- Saturation.
- Vibrance.
- Hue.
- Clarity or local contrast.
- Texture.
- Dehaze.
- Sharpening.
- Noise reduction.
- Vignette.
- Grain.
- Fade.
- Black and white conversion.
- Sepia and creative toning.

Tone and color tools:
- RGB curves.
- Individual red, green, and blue curves.
- Levels.
- White and black point controls.
- Color balance.
- Selective color.
- HSL controls.
- Color wheels.
- Split toning.
- Channel mixer.
- LUT import and application where compatible.
- Gradient maps.
- Posterization.
- Threshold.
- Invert.
- Solarization.
- False color where appropriate.

Advanced adjustments:
- Parametric and point curves.
- Localized adjustments through masks.
- Edge-aware contrast.
- Frequency-aware sharpening.
- Lens vignette correction.
- Chromatic aberration correction.
- Perspective correction.
- Lens distortion correction.
- Defringe.
- Highlight recovery where source data allows it.

Define the color space, transfer function, precision, and clipping behavior for every operation. Avoid hidden, inconsistent processing between preview and export.

# 6. LAYER SYSTEM AND COMPOSITING

Build a professional layer engine with:
- Raster layers.
- Transparent layers.
- Layer groups.
- Layer masks.
- Clipping masks.
- Opacity and fill controls where applicable.
- Blend modes.
- Layer locking.
- Rename, duplicate, delete, reorder, and merge.
- Move and transform.
- Group visibility.
- Linked-layer transforms.
- Alignment and distribution.
- Smart objects or non-destructive embedded objects where feasible.
- Adjustment layers.
- Text and vector shape layers.
- Layer search and filtering.
- Layer color labels.
- Multiple selections.
- Drag-and-drop reordering.
- Copy and paste layers between documents.

Support common blend modes such as Normal, Multiply, Screen, Overlay, Soft Light, Hard Light, Darken, Lighten, Difference, Add, and Subtract, using explicitly defined compositing rules.

Masks must support painting, inversion, feathering, density, blur, and grayscale editing where appropriate.

Implement mask previews, quick mask mode, and clear visual indicators of the active editing target.

# 7. SELECTIONS AND TRANSFORMATIONS

Selection tools:
- Rectangle and ellipse selection.
- Freehand lasso.
- Polygonal lasso.
- Magnetic or edge-following selection.
- Color-range selection.
- Contiguous magic-wand selection.
- Object selection assisted by optional AI.
- Subject selection.
- Select by transparency.
- Grow, shrink, expand, contract, and feather.
- Invert selection.
- Save and load selections.
- Refine edges.
- Hair and fine-edge refinement where supported.

Transformation tools:
- Move.
- Crop.
- Rotate.
- Flip horizontally and vertically.
- Scale.
- Free transform.
- Perspective transform.
- Distort.
- Skew.
- Warp.
- Straighten.
- Align and distribute.
- Content-aware fill or expansion when implemented.
- Perspective crop.

Provide guides, snapping, transform handles, numerical input, modifier-key constraints, and clear confirmation or cancellation behavior.

# 8. BRUSHES, PAINTING, AND RETOUCHING

Implement:
- Brush and pencil tools.
- Eraser.
- Adjustable brush size, hardness, opacity, and flow.
- Brush spacing.
- Pressure sensitivity on compatible hardware.
- Brush presets.
- Custom brush tips where feasible.
- Eyedropper.
- Clone stamp.
- Healing brush.
- Spot healing.
- Dodge and burn.
- Smudge.
- Blur and sharpen brushes.
- Gradient tool.
- Fill tool.
- Color replacement.
- Line and shape tools.
- Foreground and background colors.
- Swap, reset, and sample color controls.

For retouching tools, provide adjustable sampling sources, aligned sampling where relevant, edge-aware blending, and undoable strokes.

Do not present placeholder brushes as production-ready tools.

# 9. TEXT, VECTOR SHAPES, AND DESIGN TOOLS

Support:
- Editable text layers.
- Font family, weight, size, tracking, and leading.
- Paragraph alignment.
- Text color and outline.
- Text on a path where feasible.
- Rectangle, ellipse, line, polygon, and custom vector paths.
- Fill and stroke.
- Stroke width and alignment.
- Shape alignment and distribution.
- Editable paths and anchor points where supported.
- Guides, rulers, grids, and snapping.
- Common social media and marketing canvas presets.
- Safe-area guides and transparent exports.

Handle missing fonts gracefully. Respect font licensing and do not redistribute fonts without permission.

# 10. RAW PHOTO DEVELOPMENT

Build a dedicated RAW workflow for supported camera formats.

Features:
- RAW decoding.
- White-balance adjustment.
- Exposure and highlight recovery within source limitations.
- Demosaicing.
- Camera and lens metadata.
- Color rendering profiles where available.
- Lens correction.
- Noise reduction.
- Sharpening.
- Chromatic aberration correction.
- Crop and straighten.
- Non-destructive development settings.
- Before-and-after comparison.
- Copy and synchronize settings across photos.
- Sidecar or catalog-based edit storage.
- Full-resolution rendering on export.

Support camera formats based on the selected decoder and verified test files, not on assumed universal compatibility.

Keep RAW originals unchanged. Clearly distinguish RAW development from pixel-layer editing.

# 11. AI CREATIVE STUDIO

Design AI capabilities as modular tools with explicit model requirements, progress feedback, cancellation, and fallbacks.

Background tools:
- Subject segmentation.
- Background removal.
- Background replacement.
- Transparent cutout generation.
- Hair and fine-edge refinement.
- Background blur.

Retouching:
- Object removal.
- Inpainting.
- Dust and blemish cleanup.
- Skin retouching with adjustable intensity.
- Reflection and distraction removal where feasible.
- Image restoration and scratch repair.
- Face-aware retouching with user control.

Enhancement:
- Upscaling.
- Denoising.
- Deblurring.
- Face restoration.
- Detail enhancement.
- Low-light enhancement.
- Optional generative expansion.
- Optional generative fill.
- Optional generative background creation.

Automation:
- Auto tone.
- Auto white balance.
- Auto color.
- Subject-aware exposure.
- Batch background removal.
- Automatic cropping suggestions.
- Scene detection.
- Image quality assessment.
- Duplicate-image detection.
- Smart grouping and keyword suggestions.

AI rules:
- Offer local inference when practical.
- Clearly disclose when cloud processing sends images outside the device.
- Never upload photos without user authorization.
- Allow AI results to be previewed before application.
- Preserve originals.
- Provide mask or layer-based outputs whenever feasible.
- Keep AI providers replaceable.
- Treat downloaded models as untrusted until validated.
- Report missing models, unsupported hardware, and inference failures honestly.
- Never simulate successful inference with a static image or placeholder response.

# 12. PROFESSIONAL PHOTOGRAPHY WORKFLOW

Build a catalog and asset-management workspace with:
- Import from folders, drives, cards, and supported devices.
- Thumbnail generation.
- Contact sheets.
- Filmstrip browsing.
- Metadata display.
- EXIF and IPTC reading and supported editing.
- Ratings and color labels.
- Keywords and searchable tags.
- Albums and collections.
- Smart collections based on metadata.
- Duplicate detection.
- Rejected-photo flags.
- Compare and survey views.
- Side-by-side image comparison.
- Full-screen review.
- Batch rename.
- Batch metadata operations.
- Search and filter.
- Import presets.
- Export presets.

Do not move, overwrite, or delete original files without explicit user intent.

Use a resilient catalog design and recoverable background jobs.

# 13. BATCH PROCESSING AND AUTOMATION

Create a batch processing center with:
- Multi-file selection.
- Folder processing.
- Reusable adjustment presets.
- Copy and paste adjustments.
- Synchronize settings across selected photos.
- Batch crop and resize.
- Batch format conversion.
- Batch watermarking.
- Batch metadata handling.
- Batch renaming.
- Batch sharpening and compression.
- Batch AI tools when configured.
- Output folder templates.
- File conflict policies.
- Queue ordering.
- Pause, resume, cancel, and retry.
- Per-file success and failure reports.
- Overall progress.
- Safe reruns after failure.

Add an optional workflow builder using ordered, reusable processing steps.

Ensure canceled or failed jobs do not silently produce corrupt or misleading output.

# 14. COLOR MANAGEMENT AND PROFESSIONAL OUTPUT

Support a coherent color-managed pipeline:
- Embedded ICC profile detection.
- Profile-aware previews.
- ICC profile conversion.
- Display profile awareness where supported.
- Working color space selection.
- 8-bit and 16-bit integer processing where supported.
- Higher-precision internal processing where practical.
- Grayscale and alpha handling.
- Soft proofing where feasible.
- Gamut warnings.
- HDR workflows only when the entire processing and display path supports them.
- Explicit rendering intent.
- Configurable dithering.
- Correct alpha handling.
- Consistent preview and export color conversion.

Document the limits of each bit depth, file format, and rendering backend.

Do not advertise a color workflow as fully professional until it has been validated using reference images and independent color-management tests.

# 15. IMPORT, EXPORT, AND FILE COMPATIBILITY

Import common raster formats such as JPEG, PNG, WebP, TIFF, BMP, and other formats supported by verified codecs.

Add supported RAW camera formats through the selected RAW decoder.

Evaluate support for:
- PSD import and export.
- OpenRaster.
- EXR.
- Animated image formats.
- SVG and PDF import.
- Multi-page documents where useful.

Treat proprietary formats as compatibility projects, not guarantees.

Preserve supported layers and metadata during interchange. Clearly warn users when exporting to a flattened format or when unsupported document features will be lost.

Export controls:
- Format.
- Dimensions.
- Resolution metadata.
- Compression and quality.
- Color profile.
- Alpha channel.
- Metadata inclusion.
- Resampling algorithm.
- Sharpening for output.
- Filename templates.
- Destination folder.
- Output preview.
- File-size estimate where practical.

Build a versioned native Photoscale project format that stores editable document state, embedded assets where appropriate, masks, layer structure, adjustment settings, and recovery information.

Validate file signatures and resource limits. Never trust file extensions alone.

# 16. HISTORY, AUTOSAVE, AND DATA SAFETY

Implement:
- Undo and redo.
- Human-readable history entries.
- Named snapshots.
- Periodic autosave.
- Crash recovery.
- Recovery prompts after abnormal termination.
- Atomic project saves.
- Temporary-file cleanup.
- File integrity checks.
- Safe replacement of existing projects.
- Versioned project schemas.
- Background operation cancellation.
- Explicit dirty-state indicators.
- Recoverable import and export operations.

Use temporary output files followed by an appropriate atomic replacement strategy when supported by the filesystem.

Avoid destructive source edits.

Never silently discard unsaved work. Test power-loss and interrupted-save scenarios to the extent practical.

# 17. PERFORMANCE AND RESOURCE MANAGEMENT

Performance targets are measurable goals, not guaranteed results.

Optimize for:
- Responsive canvas interaction.
- Incremental rendering.
- GPU acceleration where available.
- Background previews.
- Tiled processing for large images.
- Efficient thumbnail caches.
- Memory-aware decoding.
- Parallel batch operations.
- Lazy loading of assets.
- Reuse of intermediate results.
- Cancellation of expensive operations.
- Backpressure on job queues.
- Graceful behavior under memory pressure.

Instrument:
- Startup time.
- Import duration.
- Preview latency.
- Canvas frame times.
- Export duration.
- Peak memory usage.
- GPU memory where measurable.
- AI inference duration.
- Error and crash rates.

Benchmark using defined hardware, document dimensions, operation settings, and reference files. Do not claim superiority over competitors without reproducible comparisons.

# 18. EXTENSIBILITY AND PLUGINS

Design future extension points for:
- Image filters.
- Export formats.
- Import formats.
- AI providers.
- Brushes and presets.
- Workflow actions.
- Metadata handlers.
- Color transforms.

Create explicit interfaces and capability declarations.

Do not load arbitrary third-party native code without a security model. Prefer sandboxed extensions, declarative manifests, permission controls, and signed packages where feasible.

# 19. USER EXPERIENCE AND ACCESSIBILITY

Implement:
- Discoverable tooltips.
- Command search.
- Context menus.
- Keyboard shortcuts.
- Custom shortcut mapping.
- Undoable actions.
- Consistent selection behavior.
- Clear error messages.
- Progress and cancellation.
- Keyboard navigation.
- Accessible labels and focus states.
- Scalable interface elements.
- High-contrast options.
- Reduced-motion preferences where appropriate.
- Confirmation before destructive actions.
- Useful empty states and onboarding.

Provide guided tutorials for:
1. Opening and importing images.
2. Basic photo adjustments.
3. Layers and masks.
4. Background removal.
5. RAW development.
6. Batch processing.
7. Saving and exporting.

# 20. ARCHITECTURE AND CODE QUALITY

Keep the codebase modular.

Suggested logical modules:
- app-shell
- workspace-ui
- document-model
- rendering-engine
- image-processing
- layer-compositor
- color-management
- file-codecs
- raw-development
- selection-engine
- brush-engine
- text-and-shapes
- ai-runtime
- asset-catalog
- batch-engine
- export-engine
- persistence-and-recovery
- telemetry-and-diagnostics
- plugin-api

Define typed interfaces between modules.

Use a command model for editing operations so they can be validated, recorded, undone, and tested.

Separate UI state from persistent document state.

Document all native boundaries, threading rules, GPU resource ownership, error handling, and cancellation semantics.

Avoid oversized components, duplicated image-processing logic, hidden global state, and monolithic source files.

Never store enormous raw image buffers inside ordinary UI state.

# 21. TESTING AND QUALITY ASSURANCE

Create:
- Unit tests for image operations.
- Property tests for geometry and transformations.
- Golden-image tests.
- Color conversion tests.
- Layer compositing tests.
- Alpha and blend-mode tests.
- Selection and mask tests.
- Undo/redo round-trip tests.
- Save/open round-trip tests.
- File corruption tests.
- Unsupported-format tests.
- Import/export compatibility tests.
- RAW reference-image tests.
- Batch cancellation and retry tests.
- Autosave and recovery tests.
- Large-image stress tests.
- AI model failure tests.
- GPU fallback tests.
- Desktop installer tests.
- Windows and macOS smoke tests.

Use representative images with known expected results.

For every major feature, define acceptance criteria and a reproducible test.

Do not claim compatibility, color accuracy, or crash safety without relevant test evidence.

# 22. SECURITY AND PRIVACY

- Process files locally by default.
- Make cloud AI opt-in.
- Disclose outbound network processing.
- Store credentials using appropriate operating-system secure storage.
- Avoid logging image contents, secrets, or unnecessary personal metadata.
- Validate file inputs and paths.
- Prevent path traversal.
- Restrict plugin permissions.
- Verify model and update downloads.
- Sign and verify releases where feasible.
- Use secure update channels.
- Keep dependencies patched.
- Provide a clear privacy policy before introducing cloud accounts or analytics.

# 23. BUILD, DISTRIBUTION, AND UPDATES

Deliver:
- Development environment setup.
- Reproducible build configuration.
- Windows installer.
- macOS application package.
- Code-signing and notarization guidance.
- Update and rollback strategy.
- Versioned release notes.
- Crash log collection with user consent.
- Dependency license inventory.
- User documentation.
- Troubleshooting guide.
- Sample projects and test assets.

Do not bundle restricted codecs, fonts, models, or dependencies without verifying redistribution rights.

Test installation, upgrade, interrupted upgrade, and rollback behavior.

# 24. DELIVERY STRATEGY

Do not attempt to implement every feature in one enormous coding pass.

First inspect the repository and determine whether an existing project should be extended or a new project created.

Then produce:
1. A technical architecture.
2. A dependency and licensing assessment.
3. A feature dependency graph.
4. A milestone-based implementation plan.
5. A working application skeleton.
6. An automated test strategy.
7. A clear list of risks and unresolved decisions.

Implement in incremental, compilable milestones.

Milestone A — Foundation:
Application shell, document opening, canvas rendering, zoom, pan, basic image operations, save/export, and reliable undo/redo.

Milestone B — Photo editor:
Exposure, contrast, curves, HSL, crop, rotation, presets, before-and-after, and batch adjustments.

Milestone C — Layers:
Raster layers, groups, masks, opacity, blend modes, text, shapes, and layer history.

Milestone D — Professional workflows:
RAW processing, color management, metadata, cataloging, and robust export.

Milestone E — Advanced editing:
Selections, brushes, retouching, transformations, and advanced compositing.

Milestone F — AI studio:
Background removal, object removal, enhancement, and optional generative features.

Milestone G — Production:
Performance benchmarks, installer validation, recovery tests, accessibility, documentation, and release hardening.

Reorder milestones when technical dependencies require it.

# 25. CODING AGENT OPERATING RULES

- Begin by inspecting the repository, installed toolchain, and existing implementation.
- If the repository is empty, establish the project structure and build configuration.
- Never replace working code without inspecting it.
- Do not merely output a plan and stop when implementation tools are available.
- Build a working vertical slice first.
- Compile and run the application after meaningful changes.
- Run relevant tests and report failures.
- Fix errors instead of concealing them.
- Use real image data for image-processing tests.
- Avoid fake buttons, placeholder sliders, simulated progress, and nonfunctional menus.
- Every visible editing control must be wired to a real operation or clearly marked as planned.
- Keep features behind explicit capability checks when dependencies or hardware are missing.
- Document any feature that is deferred.
- Report actual files changed, tests run, build results, and remaining limitations.
- Do not claim a successful build unless the build command succeeded.
- Do not claim an AI model is working unless inference was actually executed.
- Do not claim Photoshop file compatibility without round-trip or reference-file tests.

# 26. DEFINITION OF DONE

The first usable Photoscale release must allow a user to:
- Open a real image.
- View it accurately on the canvas.
- Adjust exposure, contrast, color, and white balance.
- Crop, rotate, and resize.
- Compare original and edited results.
- Undo and redo edits.
- Save a recoverable editable project.
- Export a usable image.
- Process multiple images through a reliable batch queue.
- Recover unsaved work after a supported crash-recovery scenario.
- Receive meaningful error messages for unsupported or damaged files.

Every feature must be labeled internally as implemented, partially implemented, experimental, or planned.

Begin with repository inspection, architecture decisions, and the first working vertical slice. Prioritize correctness and a functioning editing engine over a long list of unfinished features.

The end goal is to grow Photoscale into a genuinely professional, maintainable, extensible image-editing platform.
