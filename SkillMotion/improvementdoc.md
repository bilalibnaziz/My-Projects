# EffectScale (Effects Scale) — Improvement Doc (Mega Upgrade)

> Goal: one app that replaces **Premiere Pro + After Effects**: no Dynamic Link, no render-to-preview, frame
> accurate, fully local. Every feature works **without AI**.

Status checked on 2026-10-12: 126/126 unit tests pass. The video app lives in `src/fx/` (~5.9k lines:
`store.ts`, `compositor.ts`, `vfxEngine.ts`, `keyframeEngine.ts`, `media.ts`, `audioEngine.ts`, `ui/`).
Work is still **uncommitted** on top of the Photoscale snapshot `6bac5fd`.

## Review — 2026-10-18: audio pass (speed/reverse made real, R128 loudness, silence remover, waveforms, honest mixer)

| Area | Before | Now |
| --- | --- | --- |
| Clip speed / reverse | Changed the clip's length only: playback, export audio and splits still used 1× forward source time (wrong frames, wrong sound) | `clipTime.ts` maps timeline ↔ source time for every consumer: live playback (`playbackRate`; reversed clips step by seeking), export mix (`playbackRate`, reversed buffer), split offsets, trim clamp. Pitch follows speed in preview and export alike. |
| Loudness | — | `loudness.ts`: BS.1770-4 K-weighting, gated integrated LUFS, short-term / momentary max, LRA, 4× true peak. Mixer ▸ Loudness: targets YouTube/Spotify −14, Apple −16, TikTok −14, EBU −23, ATSC −24; **Measure mix** renders the exact export mix; **Normalize** sets the master fader (held at the true-peak ceiling). |
| Remove Silence | — | Mixer ▸ Remove Silence on the selected clip: threshold, minimum pause, padding; Find pauses / Cut pauses ripples the track; works with speed and reverse; one undo step. |
| Waveforms | — | `ui/ClipWaveform.tsx` on audio clips and the sound of video clips (follows trim, speed, reverse, clip volume). |
| Mixer | Solo button did nothing; master fader unconnected; "0 dB" fixed text; track meters were the master level × fader | Per-track buses with real meters (RMS bar + peak tick, −60…0 dBFS); Solo works; master fader in dB drives the live mix and the export (`masterVolume`, undoable); faders in dB, double-click resets. |
| e2e harness | `nav()` waited for the load event, which also waits for the web-font CSS and timed out when Google Fonts was slow | Waits for the app instead. |

Tests: `loudness.test.ts` (EBU Tech 3341 cases, true peak, silence, clip time), `audioEdit.test.ts`, `offlineRender.test.ts` additions; `e2e/audio.e2e.mjs` (17 checks: WAV import, waveform pixels, per-track meters, Solo, Remove Silence + export-mix check, Measure, Normalize re-measured at −23.0 LUFS, 2× and reverse in the export mix).

Still open: time-stretch that keeps pitch at other speeds, keyframed volume (rubber bands), audio effects (EQ/compressor/limiter), auto-ducking, live frame-accurate playback (P0.2).

---

## Review — 2026-10-12, second pass (score 7/10)

| Item | Status |
| --- | --- |
| P0.1 offline export | ✅ `src/fx/offlineRender.ts`: every frame is seeked exactly, rendered and encoded with WebCodecs through Mediabunny 1.59.1 (MP4 H.264 + AAC, or WebM VP9 + Opus). The audio mix (clip × track gain, pan, mute, solo, trims, the generated beat) renders in an `OfflineAudioContext`. e2e: 1.2 s at 30 fps → exactly 36 frames with audio. Real-time recording stays as the fallback. ProRes / FFmpeg sidecar still open. |
| P0.2 frame-accurate playback | ❌ Still `<video>` seeking while playing; export is exact, the live monitor is not |
| P0.4 dead code | ✅ Done (moved to Trash by another session) |
| Look | **Fixed:** the neon cyan/slate palette and glows are replaced by the suite's VS Code Dark Modern palette (`#181818` panels, `#0078d4` accent); the logo uses the Skill mark |
| Markers / YouTube chapters | ✅ New buttons in the timeline toolbar |

---

## 0. How to read this doc

- **P0** = broken, misleading or blocking. **P1** = closes the gap with Premiere/After Effects.
  **P2** = goes past them (★ = Adobe has nothing like it).
- "Done" = unit test + real-input e2e + `npm run build` + `npx oxlint` clean, and for video features a
  frame-exact check (render frame N, compare pixels).

---

## 1. Where we stand vs Premiere Pro + After Effects (honest)

| Area | Today | Gap |
| --- | --- | --- |
| Timeline | ✅ tracks, razor, ripple delete, trim, snapping, in/out | Ripple/roll/slip/slide tools fully, nesting, multicam, track targeting |
| Playback | ⚠️ `<video>` elements seeked by `currentTime` (`media.ts`), 0.25 s drift tolerance | Frame-accurate decode, proxies, background caching |
| Keyframes | ⚠️ numbers only, 5 easing presets (`keyframeEngine.ts`, 102 lines) | Bézier handles, speed/influence graph, spatial motion paths, color/point keyframes |
| VFX | ⚠️ 11 effects on CPU via `getImageData` (`vfxEngine.ts`) | GPU shaders, 100+ effects, effect masks |
| Compositing | ⚠️ 2D layers, canvas blend modes | Masks with feather, track mattes, precomps, 3D layers + camera + lights |
| Motion tracking | ❌ | Point tracker, planar tracker, stabilizer |
| Text | ✅ 4 preset animations | Text animators (per-character range selectors), Essential Graphics templates |
| Color | ✅ 3-way wheels, waveform/parade, LUT looks | Vectorscope, curves, HSL secondaries, `.cube` import, color-managed pipeline |
| Audio | ✅ faders, pan, VU, generated SFX | Waveforms on clips, keyframed volume, EQ/compressor, loudness (LUFS) meter |
| Export | ❌ **real-time screen recording** (see P0) | Offline frame-by-frame encode, MP4 H.264/HEVC/AV1, ProRes (native), image sequences |

---

## 2. P0 — Fix what is broken or misleading

1. **Export is a real-time recording, not a render.** `ui/DeliverExportModal.tsx` plays the timeline with
   `requestAnimationFrame`, captures the canvas with `captureStream`, and records it with `MediaRecorder`.
   Consequences:
   - If a frame takes longer than 1/fps to draw (4K + glow + grain), **frames are dropped or duplicated**.
   - A 10-minute video takes 10 minutes minimum, even when frames are simple.
   - `requestAnimationFrame` pauses in a hidden/background window, so **switching away stalls the export**.
   - The output codec depends on the browser (the README's "VP9 / H.264" is not guaranteed).
   - **Regression (reported 2026-10-12):** a later edit pauses the media while recording, so exports are
     now **silent**. Fix this first, before the WebCodecs rewrite.

   **Fix: offline render pipeline.**
   - For each frame `n`: seek every source to exactly `n / fps` (see P0.2), render the composition, wrap it in
     a `VideoFrame` with timestamp `n * 1e6 / fps`, `encoder.encode(frame)` using **WebCodecs `VideoEncoder`**.
   - Audio: mix the timeline in an **`OfflineAudioContext`** (faster than real time), encode with
     `AudioEncoder` (AAC/Opus).
   - Mux into MP4/WebM with a small muxer library (e.g. `mp4-muxer` / `webm-muxer`, pin exact versions).
   - In the Tauri app, offer an FFmpeg sidecar for ProRes, DNxHR, HEVC 10-bit and image sequences.
   - Test: export 60 frames of a frame counter, decode the result, assert every frame number appears exactly once.
2. **Playback is not frame accurate.** `media.ts` seeks `<video>` with `currentTime` and allows 0.25 s drift
   while playing. Replace it with a **WebCodecs `VideoDecoder`** pipeline: demux (mp4box.js for MP4/MOV),
   decode around the playhead, keep an LRU frame cache (GPU textures), prefetch ahead of the playhead.
   Keep `<video>` only as a fallback.
3. **CPU effects.** `vfxEngine.ts` uses `getImageData`/`putImageData` (CPU readback every frame). Move every
   effect to a WebGL2 fragment shader chain (one texture in, one out). Expect 10–50× speed-up at 1080p+.
4. ~~**Dead code.** `src/core/` and `src/ui/` (~19k lines copied from Photoscale) were not imported by the
   app.~~ **Done 2026-10-12**: they were moved to the Trash along with `src/test`, `plan.md` and the
   `ag-psd` dependency. Later the shared `packages/core` (§3) can come back so the image editor can open
   inside EffectScale for frame paint.
5. **README is out of date.** It says the folder is `Effects Scale` with `Figma` / `EffectScale` symlinks;
   those aliases were removed on 2026-10-12. It also points to the Photoscale shortcuts PDF. Generate an
   EffectScale shortcuts guide. (~~`plan.md`~~ is gone; write an EffectScale plan only if one is wanted.)
6. **Commit the work** into its own history.

---

## 3. Suite-wide architecture

Same plan as Photoscale's improvementdoc §3: one monorepo, shared `packages/core` and `packages/ui-kit`, one
`.scale` file family, live links (place a Photoscale PSD or IllustratorScale artboard on the timeline and it
updates on save), one command registry for shortcuts, Actions and scripting.

Video-specific packages:
- `packages/media`: demux, decode, encode, frame cache, proxy generation, waveform/thumbnail extraction.
- `packages/timebase`: rational time (`frames / fps` as integers, drop-frame timecode). Floating-point seconds
  in `types.ts` (`startTime`, `duration`) will drift on long timelines; store frames or ticks instead.
- `packages/graph`: render graph (clip → effects → masks → blend → track → sequence) evaluated per frame on GPU,
  with per-node caching so unchanged nodes are free.

---

## 4. Engine upgrades for the future

- **GPU render graph** on WebGL2 now, WebGPU when available (compute shaders for blur, tracking, scopes).
- **Background render cache** ★: idle time renders ahead on the timeline (green bar); edits invalidate only
  the affected frames and nodes. After Effects needs RAM preview; we cache continuously.
- **Proxies**: auto-make low-res proxies on import (Tauri/FFmpeg), toggle with one button, export always uses
  originals.
- **Workers**: decoding, waveform peaks, thumbnails and audio analysis off the main thread.
- **Color pipeline**: linear-light compositing in float16 textures, input transforms (Rec.709, sRGB, Log
  profiles via LUT), output transforms (Rec.709, Rec.2020 PQ/HLG).
- **Performance targets**: 4K timeline with 3 layers + 3 effects plays at 30 fps on an M1; scrubbing shows the
  exact frame within 50 ms.

---

## 5. Feature catalog

### 5.1 Editing (Premiere side) (P1)
1. Ripple, roll, slip, slide tools with live two-up trim monitor.
2. Track targeting and source patching; insert (`,`) / overwrite (`.`) from the source monitor.
3. Source monitor with in/out marks per clip.
4. Nested sequences / precomps (one model for both).
5. Multicam: sync by audio waveform (cross-correlation — no AI), angle switching while playing.
6. Speed: constant speed, reverse, time remapping with keyframes, frame blending / optical-flow-lite.
7. J/K/L shuttle with speed steps (already J/K/L for steps; add 2×/4×).
8. Markers with ranges, colors, notes, export as YouTube chapters ★.
9. Auto-gap close, find gaps, select all clips forward (A) / backward.
10. Scene-cut detection on import (histogram difference — no AI) ★.
11. Silence remover ★: cut out quiet parts by RMS threshold (podcasts, talking-head).
12. Beat markers from music onset detection ★ and "snap cuts to beats".
13. Subtitles track: import/export SRT/VTT, styles, burn-in.
14. Edit-decision list export (EDL, FCPXML, OTIO) for interchange.
15. Timeline thumbnails and audio waveforms on clips.
16. Linked selection, groups, enable/disable clip.

### 5.2 Animation (After Effects side) (P1)
17. Keyframes for any property type: number, 2D point, color, path, boolean, text.
18. Bézier keyframe interpolation with speed and influence; Graph Editor with value and speed graphs.
19. Spatial motion paths with Bézier handles drawn on the monitor.
20. Easy Ease (F9) and custom easing library (copy/paste curves).
21. Roving keyframes, hold keyframes, keyframe velocity dialog.
22. Parenting and null objects.
23. **Expressions** in sandboxed JavaScript (`wiggle`, `loopOut`, `time`, `thisLayer`), with error display.
24. Shape layers: rectangle/ellipse/star/path + repeater, trim paths, offset, wiggle paths, merge paths.
25. Text animators: range selectors per character/word/line, wiggly selector.
26. Motion sketch (record mouse as keyframes) and smoother.
27. Puppet pin tool for raster layers.
28. Precompose and collapse transformations.
29. Motion templates (Essential Graphics) with exposed controls; saved as `.scale` templates ★ shareable.
30. Animation presets library (in, out, loop) applied by drag-and-drop.
31. Physics-lite ★: spring/bounce/inertia behaviors as deterministic presets on any property.

### 5.3 Compositing and VFX (P1/P2)
32. Masks: Bézier/ellipse/rect, feather (variable), expansion, mask modes, mask path keyframes.
33. Track mattes (alpha, luma, inverted) with any layer as the matte.
34. 3D layers, camera (one-node / two-node), depth of field, lights and shadows.
35. Point tracker (KLT optical flow — no AI) → apply to position/anchor.
36. Planar tracker (homography from feature tracks) → corner pin screens.
37. Warp stabilizer-lite (track + smooth path + crop).
38. Chroma key 2.0: spill suppression, edge choke/feather, garbage mask, matte view.
39. Rotoscope with interpolated Bézier shapes; edge feather per point.
40. Effects on GPU: Gaussian/directional/radial/lens blur, glow, sharpen, noise, grain matching,
    displacement map, turbulent displace, CC-style bend/ripple, mosaic, posterize time, echo, time
    displacement, fractal noise, gradient ramp, 4-color gradient, fill, stroke, tint, invert, levels, curves,
    hue/saturation, exposure, vibrance, black & white, light wrap, god rays, lens flare, film burn, VHS ★,
    halftone ★, pixel sort ★, datamosh-lite ★.
41. Effect masks (limit any effect to a mask).
42. Adjustment layers with blend modes and opacity (have basic; extend).
43. Particles 2.0: emitters (point, line, shape, text, layer), forces (gravity, wind, turbulence), collisions,
    sprites, deterministic seed ★.
44. Audio-reactive any property ★: link any parameter to a frequency band of a track (extend the visualizer).

### 5.4 Color (P1)
45. Vectorscope, histogram, waveform (luma/RGB), parade with scale overlays.
46. RGB curves and Hue-vs-Hue/Sat/Luma curves.
47. HSL secondaries with qualifier preview.
48. `.cube` 3D LUT import/export (reuse `src/core/lut.ts` idea from Photoscale).
49. Shot matching (histogram/statistics transfer — no AI) ★.
50. Color-managed timeline (see §4).
51. Grade versions per clip and A/B compare ★.

### 5.5 Audio (P1)
52. Waveforms on clips and audio clip gain.
53. Volume and pan keyframes (rubber bands).
54. Effects: EQ (parametric), compressor, limiter, de-esser, noise gate, reverb, delay, pitch shift.
55. Loudness meter (LUFS, true peak) and normalize to target (−14 LUFS YouTube, −16 podcast) ★ one click.
56. Auto-ducking music under dialogue by envelope detection ★.
57. Crossfades; audio transitions.
58. Sync audio to video by waveform.
59. Voice-over recording to a track.

### 5.6 Delivery (P0/P1)
60. Offline WebCodecs export (P0.1): MP4 H.264/HEVC, WebM VP9/AV1.
61. FFmpeg sidecar in Tauri: ProRes 422/4444, DNxHR, 10-bit HEVC, image sequences (PNG/EXR).
62. Export queue: multiple jobs, keep working while it renders ★.
63. Social deliver ★: one timeline → 16:9, 9:16, 1:1, 4:5 with per-format safe-zone reframing keyframes.
64. Target file size / bitrate calculator ★.
65. Animated GIF / WebP / APNG for short clips.
66. Lottie export for shape/text animations.
67. Smart render: copy untouched segments without re-encoding (when codecs match).

### 5.7 Automation without AI (P2)
68. Command palette (⌘K).
69. Scripting API (JS): build timelines, apply effects, export.
70. Templates + data merge: CSV → 100 personalised videos (names, prices, images) ★.
71. Watch folder render ★.
72. Auto-reframe by motion/brightness centroid tracking (no AI).
73. Batch transcode / proxy jobs.
74. Macro recording of timeline edits.

### 5.8 Workspace and UX (P1)
75. Dockable panels and saved workspaces (Edit, VFX, Color, Audio, Deliver already exist as modes).
76. Timeline zoom to fit, track height presets, collapse tracks.
77. Remappable shortcuts with Premiere and After Effects presets.
78. Project panel with bins, search, metadata columns, relink offline media.
79. Autosave + project versions; crash recovery that reopens the playhead position.
80. Accessibility: keyboard-only editing, captions on UI audio cues.

---

## 6. Roadmap

| Phase | Theme | Key items |
| --- | --- | --- |
| 1 (now) | Truth | Offline export, frame-accurate decode, remove dead `src/core`/`src/ui`, honest README |
| 2 | Engine | Rational time, GPU render graph, effect shaders, frame cache, proxies |
| 3 | AE gap | Bézier keyframes + graph editor, masks, track mattes, precomps, expressions, shape layers |
| 4 | Premiere gap | Trim tools, source monitor, multicam, captions, audio effects, LUFS |
| 5 | Beyond Adobe | Background cache, silence remover, beat cuts, social deliver, data-merge videos, audio-reactive any property |
| 6 | Pro finish | Tracking, 3D camera, color-managed HDR, FFmpeg sidecar, plugins, live links |

---

## 7. Quality bar

- Frame-exact tests: render frame N of a test project and compare against a stored PNG.
- Export tests decode the output and count frames and audio samples.
- Keyframe math has unit tests at segment boundaries (no off-by-one frame).
- Benchmarks: 4K 3-layer playback fps, export speed (frames/s), scrub latency.
- `npm test`, `npm run test:e2e`, `npm run build`, `npx oxlint` clean before calling a feature done.
