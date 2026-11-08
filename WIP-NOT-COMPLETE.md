# WIP — Desktop Tauri push, PARTIAL, do not merge to main yet

Branch: muse/desktop-tauri-wip
Pushed: 2026-11-09 ~02:10 PKT, from Bilal's Mac staging in Muse
Source: /Users/Apple/Desktop/my projects / on Bilal's MacBook Pro
Repo base: main @ ff3f6dd79a103953a6c965770368a1b4e79a8f4d (2026-10-21 initial commit)

## What this branch is
184 files staged and pushed. This is a partial snapshot only.

- Jiro: 111 files — new to this repo (Jiro was not in My-Projects before)
- SkillPhoto: 51 files
- SkillVector: 13 files
- SkillMotion: 9 files

## What is MISSING — do not treat this as a working pull yet
206 files were still on the Mac when it went offline (~02:06 PKT, 2026-11-09) and could not be copied:
- SkillVector: 81 files, including src/core/formats/pdfImport.ts, src/core/render.ts, src/core/io.ts, e2e/pdfimport.e2e.mjs
- SkillMotion: 75 files, including src/fx/compositor.ts, src/fx/gpuCompositor.ts, src/fx/gpuTransitions.test.ts, improvementdoc.md
- SkillPhoto: 34 files, including e2e/hibit.e2e.mjs, e2e/profiles.e2e.mjs, src/core/tools.ts
- Jiro: 16 files, including e2e/*.mjs tests and src-tauri/gen/schemas/*

Also NOT in this push (excluded by the staging rules, need a follow-up decision):
- CSS: Jiro src/index.css, src/ai/ai.css; SkillVector src/ui/styles.css, src/ai/ai.css; SkillPhoto src/ui/styles.css, src/ai/ai.css; SkillMotion src/fx/ui/styles.css, src/fx/ai/ai.css
- Rust / Tauri: Jiro src-tauri/src/*.rs, Cargo.toml, Cargo.lock, tauri.conf.json, etc.
- package-lock.json, dist/, node_modules/, binaries, PDFs

## Next step
Wake the Mac / reopen Muse on it, resume staging only the 206 missing files, then push them to this same branch. Only then run npm test / tsc / build on a desktop PC — nothing here is build-verified.
