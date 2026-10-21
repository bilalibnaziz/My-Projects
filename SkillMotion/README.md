# 🎬 Skill Motion
### The Unified 2-in-1 Video Editing & Motion Graphics VFX Suite
*Combining the power of Premiere Pro and After Effects into one lightning-fast, fully customized creative application.*

---

## 🌟 Overview

**Skill Motion** solves the single biggest friction in modern video production: jumping back and forth between an NLE (Premiere Pro) and a compositor (After Effects) through slow dynamic links or bulky intermediary files.

With **Skill Motion**, you get **both workflows unified in a single, responsive engine**:
1. **Premiere Pro Non-Linear Editing (NLE)**: Multi-track video & audio timeline, razor blade cutting, ripple trimming, slip editing, snapping, audio channel faders, and real-time playback.
2. **After Effects Motion Graphics & VFX**: Full keyframe animation engine, diamond keyframe tracks, cubic Bezier curve graph editor, on-screen interactive transform gizmos, and a 60fps real-time VFX stack (Glow, Glitch, Chromatic Aberration, Lumetri Color, Lens Flare, Film Grain, Chroma Key, Blur).

---

## 🚀 Key Features

### 1. 🎬 Multi-Track NLE Timeline (Premiere Pro Mode)
- **Unlimited Video & Audio Tracks**: Layer video, graphics, adjustment layers, audio foley, and music soundtracks.
- **Precision Editing Toolset**:
  - `V` **Selection Tool**: Select, drag, and move clips across time and tracks with automatic snapping.
  - `C` **Razor / Split Tool**: Split any clip at the exact playhead position (`Cmd + K`).
  - **Ripple Delete**: Delete a clip and instantly close the timeline gap (`Shift + Del`).
  - **Edge Trim Handles**: Drag left and right clip boundaries to trim in/out points in real-time.
  - **Duplicate Clip**: Rapid duplication with `Cmd + D`.
- **SMPTE Timecode Engine**: Real-time display in `00:00:00:00` (Hours:Minutes:Seconds:Frames) supporting 24fps (Cinema), 30fps (Broadcast), and 60fps (High Frame Rate).
- **In / Out Work Area**: Set in points (`I`) and out points (`O`) for loop playback or targeted rendering.

### 2. ✨ Motion Graphics & Keyframe Compositor (After Effects Mode)
- **Per-Property Keyframe Stopwatch**: Click the stopwatch icon next to Position X/Y, Scale, Rotation, Opacity, or any VFX parameter to create keyframes!
- **Diamond Keyframes (◆)**: Displayed directly on clips in the timeline; click any keyframe to jump the playhead or inspect values.
- **Cubic Bezier Easing & Velocity Graph Editor**: Switch between `Linear`, `Ease-In`, `Ease-Out`, and smooth `Ease-In-Out` S-curves with real-time velocity graph visualization.
- **Interactive On-Screen Transform Gizmo**:
  - Bounding box with 8 corner and edge handles for intuitive scaling.
  - Top stalk rotation handle.
  - Center anchor point crosshair (`X/Y`).
  - Drag directly on the program monitor to reposition layers.
- **Kinetic Animated Typography**: Real-time kinetic text with typewriter, bounce pop-in, 3D drop shadows, and glowing strokes.
- **Adjustment Layers**: Layers that apply their VFX stack downstream to all underlying video tracks.
- **Procedural Particle Generator**: Real-time floating sparks, bokeh, stars, and digital rain.
- **Audio Reactive Visualizer**: Dynamic spectrum bars and waveforms responding live to audio frequencies.

### 3. 🎨 Lumetri Color Grading Suite
- **3-Way Color Wheels**: Independent control over **Lift** (Shadows), **Gamma** (Midtones), and **Gain** (Highlights) with interactive color pucks.
- **Live Scopes**: Waveform and RGB Parade visualizer for Rec.709 balance.
- **Basic Correction**: Temperature (Kelvin), Tint, Exposure (EV), Contrast, and Saturation sliders.
- **3D Cinematic LUT Gallery**:
  - 🎥 *Hollywood Teal & Orange*
  - ⚡ *Cyberpunk Neon Magenta*
  - 🎞️ *Kodak Vision3 35mm Film*
  - 🖤 *Film Noir Dramatic B&W*
  - 🌅 *Golden Hour Sunset Glow*

### 4. 🔊 Multitrack Audio Console & SFX Engine
- **Dedicated Track Strips**: Volume faders (-60 dB to +6 dB), stereo pan knobs (-100% L to +100% R), and mute/solo controls for every track plus the Master Bus.
- **Live Stereo VU Meters**: Real-time L/R peak indicators with green, yellow, and red clipping warnings.
- **Procedural Sound Generators**: Built-in 808 sub-bass drops, whoosh transition sweeps, cyberpunk glitch risers, and UI snap clicks that work out of the box with zero external files needed.

### 5. 🚀 Deliver & Export Studio
- **Client-Ready Master Video Export**: every frame rendered offline at its exact time and encoded with WebCodecs (MP4 H.264 + AAC, or WebM VP9 + Opus), with the full audio mix. No dropped or repeated frames, and simple timelines render faster than real time. Browsers without WebCodecs fall back to real-time recording.
- **High-Res Frame Snapshots**: Instant PNG frame capture at the current playhead timestamp.
- **Resolution Presets**:
  - 4K Ultra HD (3840 × 2160)
  - 1080p Full HD (1920 × 1080)
  - 720p HD Ready (1280 × 720)
  - 9:16 Vertical (TikTok, Instagram Reels, YouTube Shorts)
  - 1:1 Square (Social Feed)
  - 2.39:1 Cinema Scope (2560 × 1080)
- **Render Range**: Entire timeline or Work Area In/Out with real-time progress bar.

---

## ⌨️ Essential Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Space` | Play / Pause playback |
| `J` / `Left Arrow` | Step 1 frame backward |
| `K` | Stop / Pause playback |
| `L` / `Right Arrow` | Step 1 frame forward |
| `I` | Mark In point |
| `O` | Mark Out point |
| `V` | Selection Tool |
| `C` | Razor / Split Tool |
| `H` | Hand / Pan Tool |
| `Cmd + K` | Split clip at playhead |
| `Shift + Del` | Ripple delete clip |
| `Cmd + D` | Duplicate clip |
| `Cmd + Z` / `Cmd + Shift + Z` | Undo / Redo |
| `Cmd + M` | Open Deliver / Export Studio |

---

## 🛠️ Development & Running Locally

```bash
# Install dependencies
npm install

# Run the development server
npm run dev

# Run unit tests
npm test

# Build production bundle
npm run build
```

---

## 📁 Project Directory Setup
The project folder is `SkillMotion/` inside `my projects`.
