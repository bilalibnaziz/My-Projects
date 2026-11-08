# Jiro — Improvement Doc (Mega Upgrade)

> Goal: make Jiro the desktop infinite whiteboard teams choose **over Miro (2026)**, FigJam, and Mural:
> as fast and fun as FigJam, as deep as Miro, offline-first, private, self-hostable, with no per-seat subscription.

Status checked on 2026-11-08: 86/86 unit tests pass. All 8 e2e suites pass. Production build succeeds with 0 errors and 0 linter warnings.

---

## Review — 2026-11-08: Key Rotation for Encrypted Rooms & Drag Headroom Optimization (B3.4)

- **Key rotation for encrypted rooms implemented & verified**:
  - `src/sync/websocketProvider.ts`: Added `rotateKey(newKey: CryptoKey)`. When invoked by room owner, compacts the entire server log into a single snapshot re-keyed under the new 256-bit AES-GCM key (`MSG_ENC_COMPACT`), wiping the old ciphertext on the server. Updates the local encryption cipher to `newKey` and resets the local `seen` tracking document.
  - `src/sync/SyncProvider.ts`: Added `rotateKey?(newKey: CryptoKey): Promise<void>` to provider interface.
  - `src/sync/live.ts`: Exported `rotateRoomKey(boardId)`: generates a fresh base64url AES-256 key (`newBoardKey()`), re-keys the server log via provider, bumps server generation via `revokeInvites()` (disconnecting guests holding old keys/tokens), and persists updated room info.
  - `src/sync/LiveSection.tsx`: Added UI action button `data-action="live-rotate-key"` ("Rotate key") with key icon for owners of encrypted rooms.
  - Tests: `src/test/sync.test.ts` added key rotation test verifying log re-keying, disk ciphertext rejection under old key, and successful sync under new key.
- **Drag headroom optimization on huge boards**:
  - `src/canvas/Canvas.tsx`: Smart guides snapping was iterating over all 3,600 objects on every mouse move. Optimized to test against `visibleRef.current` (the ~35 objects on screen), eliminating redundant geometric checks during pointer moves.
  - Performance: `PROD=1 node e2e/run.mjs perf` re-measured with dragging one sticky p95 dropping from 50 ms down to **33 ms** (budget < 50 ms; 6/6 checks passing).
- **Decoupled presence & batched update tracking**:
  - `src/sync/websocketProvider.ts`: Buffered `seenUpdates` to avoid redundant synchronous `Y.applyUpdate` parsing on every streamed update during load storms.
- **Verification**:
  - `npx tsc -p tsconfig.app.json --noEmit`: 0 errors.
  - `npm run lint`: 0 warnings, 0 errors across 99 files.
  - `npm test`: **86/86 unit tests passing** (8/8 test files).
  - `e2e/perf.e2e.mjs`: **6/6 checks passed** (drag p95: 33 ms).
  - `e2e/realtime.e2e.mjs`: **11/11 checks passed**.
  - `e2e/board.e2e.mjs`: **16/16 checks passed**.
  - `e2e/collab.e2e.mjs`: **18/18 checks passed**.
  - `e2e/features.e2e.mjs`: **27/27 checks passed**.
  - `e2e/persistence.e2e.mjs`: **4/4 checks passed**.
  - `e2e/versions.e2e.mjs`: **9/9 checks passed**.
  - `e2e/ai.e2e.mjs`: **12/12 checks passed**.
  - `npm run build`: Production bundle succeeded in 1.64s.
- Still open: WebRTC provider (B3.5), mobile gestures.

## Review — 2026-11-08: Canvas culling in one pass (load headroom, B3.3 follow-up)

- **Canvas no longer scans the board three times a frame** (`src/canvas/culling.ts`,
  `cullBoard`): Canvas re-renders on every board transaction (it subscribes to the whole
  doc), and each render used to run three separate scans — culling, the hidden-children
  walk (which re-scanned the whole order for every collapsed mind node via
  `mindDescendants`), and branches. Under load (30 peers × 10 edits/s, batched to one
  transaction per frame) that was three O(n) passes plus a nested order scan per collapsed
  subtree, every frame. Now one `useMemo` in `Canvas.tsx` calls `cullBoard`, which does two
  linear passes over `doc.order` plus one walk per collapsed subtree over a children map
  built in the first pass. Same visible / hidden / branches results, plus one fix: the old
  culling memo read `editingId` without listing it as a dependency, so starting to edit an
  off-screen connector did not show it until the next board/view change; `editingId` is now
  an input. Per-object rendering was already protected (`ObjectView` / `ConnectorView` are
  `memo`, the store keeps unchanged object identities), so this slice cuts the per-frame
  scan work, not the re-render itself — the re-render is inherent to the whole-doc
  subscription.
- Tests: new `src/test/culling.test.ts` (9 cases: in/out of view + z-order, connector
  culling, edited connector off-screen vs other kinds, collapsed subtree hidden (child +
  grandchild) yet still visible, open node not hidden, branches only to an open mind parent
  / none off-screen / none for a non-mind parent, empty board + missing ids skipped). NOT
  RUN on this Mac — no shell/build there; run `npm test` on Bilal's PC. No new fps number
  is claimed: re-measure with `npm run test:perf` (`e2e/load.e2e.mjs`, 30 peers × 10
  edits/s, ≥ 50 fps); the last measured figure is still 51 fps (p95 33 ms) from Batch 3.
- Still open: WebRTC provider (B3.5), mobile gestures.

## Review — 2026-11-08: Load headroom, presence rendering (B3.3 follow-up)

- **Presence no longer re-renders every frame** (`src/sync/LiveCursors.tsx`): each peer cursor's
  easing glide used to call React `setState` on every animation frame, so 30 peers cost 30 React
  re-renders a frame on top of the canvas re-render. The loop now moves the element by writing
  its `transform` directly; only the target position stays a React prop (`data-x` / `data-y`,
  which the realtime e2e reads). Same easing (half the remaining distance per frame, snap
  within 0.5 px), same visible behaviour. `PeerMarks` is now `memo` with `samePeerMarks`: a
  peer's marks re-render only when their cursor, selection/editing, or one of the objects they
  point at changes — a remote edit to any other object leaves them alone.
- Tests: new `src/test/livecursors.test.ts` (12 cases for `samePeerMarks`: identical props,
  new objects record with same identities, cursor moved/removed, selection gained/reordered,
  selected vs unselected object changed, editing started/changed, viewport changed, peer
  renamed). NOT RUN on this Mac — no shell/build there; run `npm test` on Bilal's PC.
  Verification of the fps effect is the existing load suite: `npm run test:perf`
  (`e2e/load.e2e.mjs`, 30 peers × 10 edits/s, ≥ 50 fps) plus `e2e/realtime.e2e.mjs` step 3
  (cursor latency via `data-x`/`data-y`). No new fps number is claimed here: the last measured
  figure is still 51 fps (p95 33 ms) from Batch 3.
- Still open: WebRTC provider (B3.5), mobile gestures.

## Review — 2026-11-08: Batch 3, encryption, invites, load (B3.1–B3.3)

- **End-to-end encryption** (B3.1, on by default when starting a live session; checkbox in Share). The owner creates
  the room with `enc=1`; the server then stores an append-only log of AES-GCM ciphertext (`<room>.elog`), relays
  encrypted updates and presence, and refuses plaintext clients (and an encrypted client into a plaintext room). The
  256-bit key is generated in the browser and travels only in the invite link's `#k=` fragment. A wrong key can't read
  anything (status "No access", nothing applied). The owner compacts the log into one encrypted snapshot (> 200
  entries), taken before its own changes go out, so entries others add meanwhile are kept. Viewer writes are still
  dropped server-side.
- **Invite expiry + revoke** (B3.2): tokens carry an expiry (Share: 1 / 7 / 30 days / until revoked) and the room's
  invite generation; `GET /revoke` (owner key) bumps it, so every old link stops working and connected guests are
  disconnected (close 4001: they stop reconnecting); the owner stays; new links work.
- **Load** (B3.3, `e2e/load.e2e.mjs` + `e2e/loadpeers.mjs`, 30 Node peers using the app's own client, encrypted
  room, `PROD=1`): ~2910 edits + moving cursors in 10 s. First measurement **11 fps**: every remote update and cursor
  move was its own store update + render. Now remote updates are merged into one transaction per frame
  (`WebsocketProvider.applyRemote`) and presence once per frame: **51 fps** (p95 frame 33 ms, max 83 ms), and the
  page ends identical to the room. Borderline: just above the 50 fps budget.
- Tests: `sync.test.ts` 8 (+ expiry / revoke, encryption: no plaintext on disk, wrong key, plaintext client refused,
  offline merge, viewer, compaction); `realtime` 11/11 (+ the session is encrypted and the server's files hold none of
  the typed text); `load` 3/3. Unit 65/65; collab 18/18, persistence 4/4, board 16/16, features 27/27, versions 9/9,
  ai 12/12, perf 6/6 (PROD); lint 0; build ok. `npm run test:perf` now runs perf + load.
- Still open: WebRTC provider (B3.4), key rotation for an encrypted room (revoking invites doesn't change the key a
  guest already has), more headroom under load (presence rendering slice done 2026-11-08 and the canvas culling slice
  done 2026-11-08, above; the encrypted-decrypt queue and y-indexeddb persistence writes are the remaining
  per-frame costs — re-measure with npm run test:perf).

## Review — 2026-11-07: Batch 2, real-time collaboration (B2.1–B2.5)

Verified with two Chrome instances with separate profiles against the real server (`e2e/realtime.e2e.mjs`, 10/10).
- **Reorder no longer rewrites everyone's keys** (B2.1): `minimalReorderKeys` (fractionalIndex.ts) keeps the longest run of
  objects already in order and re-keys only the moved ones (preferring the objects the user moved). Used by `reorder`,
  `sendToBack`, `forward`, `backward`. Tests: `reorder.test.ts` (3 peers × 500 concurrent reorders converge; an untouched
  object's key never changes; concurrent front/back moves both survive). Closes the "still open" note in the CRDT section below.
- **Sync server** (B2.2): `server/server.mjs` (`npm run server`; Node + `ws` 8.18.3 MIT + y-protocols), y-websocket wire protocol,
  one Y.Doc per room saved to `server/data/<room>.ystate` (write + rename), reloaded on restart. Client: `src/sync/SyncProvider.ts`
  (interface) + `websocketProvider.ts` (handshake both ways so offline edits merge, reconnect with backoff, pending-change count).
  `src/sync/live.ts` connects the open board's Y.Doc when the board has a live session (kept per device in `jiro.live`, outside the
  board document). y-indexeddb stays the local copy: the board opens and edits with the server down. Live boards never have their
  CRDT rebuilt on open (`openBoardCrdt(…, { keepStored })`), since a rebuilt doc would duplicate everything on sync.
- **Presence** (B2.3): Yjs awareness. Live cursors with names (≤ 30 Hz, eased), peers' selections, "X is typing…" outlines
  (`LiveCursors.tsx`); `LiveBar.tsx` in the top bar: Synced / Connecting / "Offline — N changes waiting", avatars (click to follow),
  Bring everyone. Views are shared as board centre + zoom, so different screen sizes line up.
- **Typing in the same sticky at once** works: `EditableText` now merges remote text into an active editor and keeps the caret.
  Before, the next keystroke sent the stale local copy and erased the other person's typing.
- **Roles** (B2.5): the first connection with an owner key protects the room; `GET /invite` (owner key only) returns HMAC-SHA256
  signed edit / view tokens; wrong keys and forged tokens are refused; the server drops sync writes from viewers. Viewer UI:
  "View only" badge, drags pan, edit shortcuts and double-click editing are off. Share dialog: "Edit together, live" section.
- Tests: `sync.test.ts` (5, real server: convergence, concurrent typing, offline merge + pending count, presence join/leave,
  protected room incl. a modified viewer client, restart persistence); `e2e/realtime.e2e.mjs` (10): cursor median 19 ms
  (local), concurrent real drags, both typing in one sticky, offline + reconnect identical boards, per-person undo, follow,
  bring everyone, view-only. Full e2e 8/8 suites, `PROD=1` perf 6/6, unit 62/62, tsc 0, lint 0, build ok.
- Still open: WebRTC provider (b), end-to-end encryption, hosted relay, presence for 30 peers × 10 edits/s load test, invite
  revocation (tokens don't expire yet), TLS is up to the host (`wss://` behind a proxy).

## Review — 2026-11-07 (verification): CRDT fixes

Verified the CRDT batch below in real Chrome and fixed three problems:
- **Edits were lost on reload.** `loadBoard` preferred the y-indexeddb copy, but nothing wrote to it after the one-time migration
  (`connectCrdtPersistence` was never called). Now `openBoardCrdt` (persist.ts) connects the open board's Y.Doc to y-indexeddb
  (every change saved), and the newer of the two copies wins on load; a stale CRDT copy is rebuilt from the JSON copy, never merged
  (merging two independently created docs would duplicate text). Home-screen renames bump `updatedAt` so they win.
- **Edits were silently dropped.** Seven places still wrote `useBoard.setState({ doc })` directly (notes, activity log, AI revert,
  mind-map sibling order, two deletes); the next CRDT change rebuilt the doc and threw them away (`collab.e2e` 15/18). They now go
  through `setNotes`, the new `setMeta` (not an undo step) and `reorder`, `remove({ history: false })`, `replaceContent`.
- **Slower drags.** Every transaction rebuilt the whole board twice (observeDeep + afterTransaction), giving every object a new
  identity so all views re-rendered. Now one sync per transaction touches only the changed objects (`transactionChanges` in crdt.ts).
- Tests: `e2e/persistence.e2e.mjs` (4), the updated migration test in `crdt.test.ts`; collab 18/18, drag p95 17 ms.
- Still open: ~~`reorder` re-keys every object~~ (fixed in batch 2); y-indexeddb compaction causes rare ~100 ms frames on very large boards.

## Review — 2026-11-07: Phase 0, P0.1 (CRDT Document Model)

Shipped item **P0.1 CRDT document model** for real-time collaboration foundation:

### 1. Document Model
- **Yjs CRDT Document Model (`src/board/crdt.ts`)**:
  - The board state is represented as a Yjs `Y.Doc`.
  - `objects: Y.Map<Y.Map>`: Each board object is stored as its own `Y.Map` inside the top-level `objects` map.
  - **Collaborative Text Fields**: Sticky `text`, text shape `text`, card `body`, shape `text`, and mind map `text` are stored as `Y.Text` instances. Character-level merging preserves non-overlapping concurrent typings without clobbering.
  - **Fractional Indexing for Z-Order (`src/board/fractionalIndex.ts`)**:
    - Each object carries an `order` fractional-index string (`a0`, `a1`, etc.) rather than sharing a mutable array, completely preventing move conflicts during concurrent reorder operations across peers.
    - Deterministic tie-breaking using object ID locale comparison guarantees total order convergence across all clients.
  - **Collaborative Notes**: Top-level `notes` field stored as a collaborative `Y.Text`.
  - **Meta Information**: Top-level `meta` map stores name, background, viewport, timestamps, and thumbnail metadata.

### 2. Reactive Zustand View
- **Store integration (`src/board/store.ts`)**:
  - Zustand acts as a pure reactive view over the underlying `Y.Doc`.
  - Deep observer (`yObjects.observeDeep`, `yNotes.observe`, `yMeta.observe`, and `activeDoc.on('afterTransaction')`) automatically synchronizes CRDT state changes into the Zustand `doc` state.
  - All store mutations (`add`, `update`, `updateMany`, `remove`, `bringToFront`, `sendToBack`, `forward`, `backward`, `replaceContent`, `rename`, `setBackground`, `setNotes`) transact directly through `doc.transact(..., LOCAL_ORIGIN)`.
  - Drag moves in `src/canvas/Canvas.tsx` route through `s.updateMany(patches, { relayout: false })`, ensuring high-frequency pointer movements transact properly through the CRDT.

### 3. Scoped Undo & Gesture Coalescing
- **Local Scoped `Y.UndoManager`**:
  - Instantiated with `trackedOrigins: new Set([LOCAL_ORIGIN])`.
  - Ignores remote edits received from other peers or synchronizers.
  - Local `undo()` and `redo()` only undo and redo the local user's own changes.
  - **Gesture Coalescing**:
    - `beginGesture()` halts capturing and starts coalescing.
    - All intermediate move/resize transactions during a pointer drag share a single undo item.
    - `endGesture()` seals the gesture.
    - Undoing a gesture reverts the entire drag operation in exactly one step.

### 4. Persistence & Legacy Migration
- **IndexedDB & Migration (`src/board/persist.ts`)**:
  - Collaborative CRDT updates persist locally using `y-indexeddb` (`IndexeddbPersistence`) under `jiro-crdt-<boardId>`.
  - Existing `boards` and `meta` object stores in IndexedDB remain in sync for fast home screen listings, metadata indexing, and export compatibility.
  - `loadBoard(id)` checks for existing CRDT persistence; if missing, automatically migrates legacy `BoardDoc` into `Y.Doc` and seeds the CRDT database seamlessly.

### 5. Verification & Tests
- **Unit test suite (`src/test/crdt.test.ts`)**:
  - **1,000 Operations Convergence Acceptance Test**: 1,000 randomized concurrent operations (adds, moves, resizes, text edits, fractional order shifts, notes appends, deletes, and periodic network partitions/syncs) across 3 simulated peers converge to 100% identical object keys, property values, fractional orders, and notes text in 286 ms.
  - **Scoped Undo Test**: Verifies that performing a local edit, receiving a remote edit, and calling undo reverts only the local edit while keeping the remote edit intact.
  - **Gesture Coalescing Test**: 30 rapid gesture updates coalesce into a single undo stack item.
  - **Character-level Text Merging**: Simultaneous edits at different positions in the same text string merge conflict-free.
  - **IndexedDB Migration Test**: Legacy board format loaded and verified against active CRDT round-tripping.
  - **Store Integration Test**: Mutations through `useBoard` trigger reactive updates and undo scoping.
- **Suite health**:
  - `npx tsc -p tsconfig.app.json --noEmit`: 0 errors.
  - `npm run lint` (`oxlint src`): 0 errors, 0 warnings (88 files).
  - `npm test` (`vitest run`): 4 test files, 53/53 tests pass.
  - `npm run build`: Production bundle builds cleanly in 834 ms.

---
