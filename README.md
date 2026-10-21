# Skill Suite — Professional Offline Creative Software

A comprehensive, 100% offline, local-first creative software suite built with **React**, **TypeScript**, **Tauri v2**, and **Rust**.

---

## 🎨 Suite Overview

| Application | Replaces | Key Capabilities |
| :--- | :--- | :--- |
| **Skill Vector** | Adobe Illustrator | Infinite vector canvas, 2D polygon boolean clipping (Unite, Minus Front, Intersect, Exclude), Shape Builder tool, simplify path, outline stroke, gradients, logo grids |
| **Skill Photo** | Adobe Photoshop | Non-destructive layer stack, RAW tone curve, non-destructive filters, frequency separation, liquify displacement mesh, healing, LUT color grading |
| **Skill Motion** | Adobe Premiere Pro / After Effects | Multi-track video & audio timeline, frame-accurate offline render loop, Bezier velocity curve editor (F9 Easy Ease, bounce, elastic), 11 VFX shaders, YouTube chapter exporter |

---

## 📂 Repository Structure

```
my-projects/
├── SkillVector/      # Vector graphics & illustration application
├── SkillPhoto/       # Photo editing, retouching & raster design application
├── SkillMotion/      # Motion design, VFX & video sequencing application
├── installer/        # Cross-platform installers and packages (macOS & Windows)
│   ├── Mac/          # macOS .dmg installers and universal .app bundles
│   └── Windows/      # Windows automated batch & PowerShell installers
├── launch-all.sh     # Script to launch all applications simultaneously
└── scripts/          # Workspace automation and build scripts
```

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust & Cargo](https://rustup.rs/) (for Tauri desktop runtime)

### Running Skill Vector
```bash
cd SkillVector
npm install
npm run tauri:dev # or npm run dev for browser preview
```

### Running Skill Photo
```bash
cd SkillPhoto
npm install
npm run tauri:dev # or npm run dev for browser preview
```

### Running Skill Motion
```bash
cd SkillMotion
npm install
npm run tauri:dev # or npm run dev for browser preview
```

### Launching Installed Apps
```bash
chmod +x ./launch-all.sh
./launch-all.sh
```

---

## 💻 Architecture & Technologies
- **Frontend Core**: React 19, TypeScript, Vanilla CSS (Design System Tokens)
- **Desktop Runtime**: Tauri v2 (Rust backend with low memory footprint)
- **Vector Engine**: Custom boolean polygon clipping, SVG importer/exporter, Bézier curve math
- **Graphics & Shaders**: WebGL2 / Canvas2D hardware acceleration
- **Platform Support**: macOS (Universal Apple Silicon & Intel) & Windows 10/11

---

## 📄 License
Private project. All rights reserved.
