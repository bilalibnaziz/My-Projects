# Jiro

An offline-first infinite whiteboard for the desktop, part of the Skill suite. Built with **React 19 + TypeScript, Tailwind CSS v4, shadcn/ui and Tauri v2**.

Everything lives on your computer: boards autosave to local storage (IndexedDB), work without a network, and can be saved or opened as portable `.jiro` files.

## Run it

```bash
npm install
npm run tauri:dev     # desktop app (Tauri window, dev server on :5178)
npm run dev           # same UI in a browser at http://localhost:5178
npm run tauri:build   # release bundle (.app / .dmg / .msi …)
```

## What's in it

**Canvas.** Infinite pan and zoom (trackpad pinch, ⌘/ctrl + scroll, space-drag, middle mouse), with a dots, grid, lines or plain background, a minimap, viewport culling for big boards, and light and dark themes.

**Content:**
- Sticky notes: 12 colours and auto-fitting text. Tab makes the next note, and pasting a list gives one note per line.
- Text, and 12 shapes with fill, border, dash style and text.
- Frames, which carry their contents when moved and act as slides.
- Kanban cards with a tag colour, status, assignee and due date.
- A pen and a highlighter, plus an eraser.
- Images (drop, paste or upload), emoji stamps, and comment threads.

**Connections:**
- Curved, elbow or straight lines that stay attached to items, with caps, dashes and labels.
- The **"+" handles** on a selected item add a connected copy in one click (flowcharts at typing speed), or drag one to connect to something.
- While drawing a line, the target shows four connection points; drop near one to pin the line to that side.

**Mind maps.** Tab adds a child and Enter adds a sibling. Layout is automatic, one-sided or both-sided, and branches can collapse.

**Editing:**
- Smart alignment guides, resize and rotate (⇧ snaps), ⌥-drag to duplicate.
- Group, lock, z-order, align and distribute.
- Undo history where every drag or typing session is one step.

**Organize (beyond Miro).** Tidy up into a grid, cluster stickies by colour into an instant affinity map, sort A→Z, and wrap the selection in a frame.

**Facilitation:**
- A timer with a chime.
- Dot voting with ranked results.
- Presentation mode that walks through frames, with a laser pointer.

**Templates.** Brainstorm, Kanban, Retrospective, Mind map, Flowchart, SWOT, Priority matrix, Weekly planner, User story map and Lean canvas.

**Team & collaboration.** Offline-first: no account or server. Sharing works by carrying a copy of the board.
- **Team:** your profile plus teammates (email, WhatsApp number, role, colour).
- **Tasks:**
  - Assign cards to one or more people, with avatars on the card, a due date (red when overdue) and a priority.
  - The Tasks panel (⇧K) covers this board or all boards, with a "Mine" filter and overdue first. You can quick-add "Task @Name".
- **Notifications:** a bell with an inbox and board activity. It covers assignments, @mentions in comments, due-today/overdue reminders and boards shared with you, plus native macOS notifications.
- **Share (yellow button):**
  - Send by **email** to everyone you pick, or on **WhatsApp** (opens their chat).
  - Or **copy a link**. The `jiro://` link carries the whole board without images, a few KB. Teammates click it or paste the message into Jiro.
  - Share as a `.jiro` file, a PDF or a Markdown document (copy or save); saved files are revealed in Finder ready to attach.
  - When a teammate opens your link, *they* are notified about the tasks you assigned them and the places you @mentioned them.
- **WhatsApp inside Jiro (desktop):**
  - WhatsApp Web runs in its own Jiro window. Scan the QR code once and the session stays logged in.
  - Share → WhatsApp, the task notify button and @mention offers open the right chat with the message already typed.
  - The window has no access to Jiro's commands. Links clicked in WhatsApp open in your browser, and `jiro://` links open the board in Jiro.
  - You can switch to the WhatsApp app instead in the Share dialog.
- **Notes (⇧N):** per-board notes; `- [ ] Task @Name` lines become assigned task cards in one click.
- **Activity log:** who assigned, commented, notified and shared what.

Live co-editing (several people on one board at the same moment, with cursors) needs a sync server, so it's not part of this offline build.

**Jiro AI.** Use your own Claude, ChatGPT or Gemini key. Open it with ⌥⌘K, the AI button, or the right-click "Ask AI". It reads the board and builds on it:
- brainstorms as framed, colour-coded stickies;
- clusters stickies into themed frames (a real affinity map);
- writes mind maps and flowcharts, laid out automatically, with loops routed around the side;
- summarises the board and edits anything on it.

New work always lands in free space. Every request can be undone in one step ("Undo changes").

**Right-click menus.** On items: edit, cut/copy/duplicate, colour, order, group, lock, export, ask AI. On empty canvas: paste here, add a sticky/text/card/frame at that spot, templates, select all.

**Find everything.** ⌘K is a command palette: it searches all text on the board and also runs commands, picks tools, jumps to frames and inserts templates.

**Export.** PNG of the board, the selection or a single frame (rendered natively, so it's pixel-exact); **PDF with one page per frame**; copy as an image; save and open `.jiro` files (also by drag-drop).

**Fast on big boards.** Off-screen items and lines are culled, and far-out zoom draws simple blocks (level of detail). Measured on the production build with 3,000 stickies and 600 lines: panning and dragging run at 60 fps (p95 frame 17 ms). The fonts are bundled, so nothing needs the network.

The full shortcut list is under ⌘/ in the app.

## Layout

```
src/board/     model, store (undo/gestures), geometry, connectors, mind-map layout, templates, exporter, persistence
src/canvas/    the board: Canvas (all pointer interaction), object renderers, selection overlay, viewport math
src/ui/        toolbar, top bar, context toolbar, panels, presenter, command palette, dialogs, shortcuts
src/team/      team roster, notifications, tasks/notes panels, share dialog, share links, Markdown export
src/ai/        Skill AI assistant (shared copies of providers/agent/open/AiAssistant/ai.css) + Jiro's appAdapter (board tools)
src/home/      board gallery
src/components/ui/  shadcn components
src-tauri/     Rust shell: native save/open dialogs, file read/write, open links in the browser
e2e/           real-Chrome end-to-end suites (CDP, real mouse/keyboard input)
```

## Verify

```bash
npx tsc -p tsconfig.app.json --noEmit   # type-check (the root tsconfig has no files)
npm test                                 # unit tests (vitest)
npm run test:e2e                         # end-to-end in headless Chrome (board, features, collaboration, AI with a stubbed provider)
npm run test:perf                        # big-board frame timings on the production build
npm run lint                             # oxlint
npm run build
```

`window.__jiro.store` exposes the board store for e2e checks.
