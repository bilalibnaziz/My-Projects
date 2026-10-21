# Skill Suite v1.0 — Official Installers (macOS & Windows)

Welcome to **Skill Suite v1.0**, the professional, 100% offline, local-first creative software suite. Every feature works without AI dependencies.

---

## The 4 Applications

| Application | Replaces | Key Capabilities |
| :--- | :--- | :--- |
| **Skill Photo** | Adobe Photoshop | Layer stack, RAW tone curve, non-destructive filters, frequency separation, liquify mesh engine, healing |
| **Skill Vector** | Adobe Illustrator | Infinite vector artboard, 2D polygon boolean clipping (Unite, Minus Front, Intersect, Exclude), Shape Builder tool, simplify path, outline stroke |
| **Skill Motion** | Adobe Premiere Pro & After Effects | Frame-accurate offline render loop, multi-track timeline, Bezier velocity curve graph editor (F9 Easy Ease, bounce, elastic), YouTube chapter exporter, 11 VFX shaders |
| **Skill Design** | Figma | Reactive scene graph, auto-layout flexbox engine (gap, padding, hug/fixed), interactive prototype player, deterministic code generator (React + Tailwind, HTML + CSS, SwiftUI) |

---

## macOS Installation Options

You have 3 easy ways to install on macOS:

### Option A: Drag-and-Drop Disk Images (.dmg)
1. Open `Mac/SkillSuite-v1.0-All-In-One.dmg` (or any individual `.dmg` file).
2. Drag the application icon(s) into the **Applications** folder shortcut.
3. Open from Launchpad, Spotlight, or your Applications folder!

### Option B: One-Click Terminal Installer
1. Double-click `Mac/Install-All-Mac.command` in Finder.
2. It automatically installs all 4 applications to `/Applications`, clears quarantine flags, and confirms completion.

### Option C: Direct Applications Folder
The standalone `.app` bundles are available directly in `Mac/Applications/`:
- `Skill Photo.app`
- `Skill Vector.app`
- `Skill Motion.app`
- `Skill Design.app`

---

## Windows Installation Options

### Option A: One-Click Batch Installer
1. Open the `Windows/` folder.
2. Double-click **`Setup-All-Windows.bat`**.
3. Press **Y** when prompted.
4. All 4 apps will be installed to `%LOCALAPPDATA%\Programs\SkillSuite` and shortcuts will be created on your **Desktop** and **Start Menu**.

### Option B: PowerShell Automated Setup
Open PowerShell and run:
```powershell
.\Windows\Install-SkillSuite.ps1
```

### Option C: Standalone Portable Use (Zero Install)
You can run any app directly from its folder without installing:
- `Windows/SkillPhoto-v1.0-Windows/SkillPhoto.bat`
- `Windows/SkillVector-v1.0-Windows/SkillVector.bat`
- `Windows/SkillMotion-v1.0-Windows/SkillMotion.bat`
- `Windows/SkillDesign-v1.0-Windows/SkillDesign.bat`

---

## Verification & Architecture
- **macOS Binary**: Universal Mach-O 64-bit (`arm64` Apple Silicon + `x86_64` Intel)
- **Windows Runtime**: Microsoft Edge / Chrome Chromium app-mode with full local file access
- **Version**: 1.0.0
