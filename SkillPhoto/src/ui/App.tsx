import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { roomClasses, useRoom } from './responsive';
import { uiZoom } from './theme';
import { FilePlus, FolderOpen, ImagePlus, Sparkles, Wand2, Layers, Command as CmdIcon, Bandage, ChevronDown, ChevronUp, ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { store, useStore } from '../core/store';
import { handleKey } from '../core/commands';
import * as io from '../core/io';
import * as ops from '../core/ops';
import { AiAssistant } from '../ai/AiAssistant';
import { photoAdapter } from '../ai/appAdapter';
import { MenuBar, DocTabs, StatusBar, Toasts, CommandPalette } from './Chrome';
import { ActiveToolbox } from './ActiveToolbox';
import { SocialPanel } from './SocialPanel';
import { PhotoPanel } from './PhotoPanel';
import { ToolRail } from './ToolRail';
import { OptionsBar } from './OptionsBar';
import { Viewport, clientToDoc, isTyping, isTextEntry } from './Viewport';
import { pickObject } from '../core/tools';
import { LayersPanel } from './LayersPanel';
import { AdjustPanel } from './AdjustPanel';
import { LooksPanel } from './LooksPanel';
import { isLookLayer } from '../core/lookOps';
import { HistogramPanel, ColorPanel, HistoryPanel, NavigatorPanel, InfoPanel, PropertiesPanel } from './SidePanels';
import { Dialogs } from './Dialogs';
import { ActionsPanel } from './ActionsPanel';
import { isRecording } from '../core/actions';
import { LayerStylePanel } from './LayerStylePanel';
import { formatKeys } from '../core/commands';
import { TEMPLATES, presetById, newFromTemplate } from '../core/social';
import { applyPrefs } from './theme';
import { loadSavedFonts } from '../core/fonts';
import { currentWorkspace, moveTab, setLayout, useLayout, workspaceTabs } from './layout';
import type { DockTab } from './layout';
import { GridsPanel } from './GridsPanel';

const SAMPLES = [
  { id: 'landscape', title: 'Alpine Lake', src: '/samples/landscape.jpg' },
  { id: 'portrait', title: 'Studio Portrait', src: '/samples/portrait.jpg' },
  { id: 'architecture', title: 'Architecture', src: '/samples/architecture.jpg' },
];

async function openSample(src: string, title: string) {
  await store.task(`Opening ${title}`, async () => {
    const blob = await (await fetch(src)).blob();
    io.docFromCanvas(await io.fileToCanvas(blob), title, src.split('/').pop());
  });
}

function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-mark" />
        <h1>Skill Photo</h1>
        <p className="welcome-sub">Non-destructive photo editing with a GPU develop engine and content-aware retouching.</p>
        <div className="welcome-actions">
          <button className="big-btn primary" onClick={() => store.set({ dialog: { type: 'new' } })}>
            <FilePlus size={18} /> New document <kbd className="kbd">{formatKeys('Mod+N')}</kbd>
          </button>
          <button className="big-btn" onClick={async () => io.openFiles(await io.pickFiles())}>
            <FolderOpen size={18} /> Open image <kbd className="kbd">{formatKeys('Mod+O')}</kbd>
          </button>
        </div>
        <div className="drop-hint">
          <ImagePlus size={16} /> or drop images anywhere · paste with {formatKeys('Mod+V')}
        </div>
        <div className="mini-title welcome-title">Start from a social template</div>
        <div className="welcome-templates">
          {TEMPLATES.map((t) => {
            const p = presetById(t.preset)!;
            return (
              <button key={t.id} className="welcome-template" onClick={() => newFromTemplate(t.id)} title={`${p.label} · ${p.w}×${p.h}`}>
                <span style={{ aspectRatio: `${p.w} / ${p.h}`, background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }} />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="mini-title welcome-title">Or edit a sample photo</div>
        <div className="samples">
          {SAMPLES.map((s) => (
            <button key={s.id} className="sample" onClick={() => openSample(s.src, s.title)}>
              <img src={s.src} alt={s.title} loading="lazy" />
              <span>{s.title}</span>
            </button>
          ))}
        </div>
        <div className="feature-row">
          <div><Wand2 size={14} /> Auto Enhance as an editable layer</div>
          <div><Bandage size={14} /> Paint objects away</div>
          <div><Layers size={14} /> Maskable adjustment layers</div>
          <div><CmdIcon size={14} /> {formatKeys('Mod+K')} runs any command</div>
        </div>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<DockTab, string> = {
  properties: 'Properties', social: 'Social', photo: 'Photo', adjust: 'Adjust', looks: 'Looks', grids: 'Grids', color: 'Color', info: 'Info', history: 'History', actions: 'Actions', navigator: 'Navigator',
};

/** Drags a dock edge or splitter; `onMove` gets the pointer position, `onEnd` runs once on release. */
function dragHandle(e: React.PointerEvent, cursor: string, onMove: (ev: PointerEvent) => void) {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  document.body.style.cursor = cursor;
  document.body.classList.add('resizing');
  const move = (ev: PointerEvent) => onMove(ev);
  const up = () => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    document.body.style.cursor = '';
    document.body.classList.remove('resizing');
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}

function RightDock({ overlay, maxWidth }: { overlay: boolean; maxWidth: number }) {
  const s = useStore();
  const lay = useLayout();
  const dockRef = useRef<HTMLDivElement>(null);
  const [dragTab, setDragTab] = useState<DockTab | null>(null);
  // A panel opened from a menu that this workspace doesn't list shows as an extra tab
  const base = workspaceTabs();
  const tabs = lay.tab && !base.includes(lay.tab) ? [...base, lay.tab] : base;
  const topTab = tabs.includes(lay.tab) ? lay.tab : tabs[0];
  const setTopTab = (tab: DockTab) => setLayout({ tab });

  // One row of tabs: as many as fit, the active one always among them, the rest under "More"
  const rowRef = useRef<HTMLDivElement>(null);
  const tabWidths = useRef(new Map<DockTab, number>());
  const [fit, setFit] = useState(tabs.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const tabsKey = tabs.join(',');
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const measure = () => {
      row.querySelectorAll<HTMLElement>('[data-tab]').forEach((el) => tabWidths.current.set(el.dataset.tab as DockTab, el.offsetWidth));
      const room = row.clientWidth - 8 - 26;
      const w = (t: DockTab) => tabWidths.current.get(t) ?? 64;
      if (tabs.reduce((a, t) => a + w(t), 0) <= room) return setFit(tabs.length);
      let used = 0;
      let n = 0;
      for (const t of tabs) {
        if (used + w(t) > room - 34) break;
        used += w(t);
        n++;
      }
      setFit(Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey]);
  let shownTabs = tabs.slice(0, fit);
  if (!shownTabs.includes(topTab) && shownTabs.length) shownTabs = [...shownTabs.slice(0, -1), topTab];
  const moreTabs = tabs.filter((t) => !shownTabs.includes(t));
  // Each panel opens at its top, not at the scroll position of the previous one
  const topRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (topRef.current) topRef.current.scrollTop = 0;
  }, [topTab]);
  useEffect(() => {
    // Picking an adjustment layer opens Adjust (but stay on Actions while recording, and look layers belong to Looks)
    if (s.rightTab === 'adjust' && !isRecording() && tabs.includes('adjust') && store.activeLayer?.kind === 'adjustment' && !isLookLayer(store.activeLayer)) setTopTab('adjust');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.rightTab, store.activeLayer?.id]);
  const lastTool = useRef(s.tool);
  useEffect(() => {
    // Only a real change of tool moves the tab (opening the dock keeps the tab the user left open)
    if (lastTool.current === s.tool) return;
    lastTool.current = s.tool;
    const show = (t: DockTab) => tabs.includes(t) && setTopTab(t);
    if (s.tool === 'color-sampler' || s.tool === 'ruler') show('info');
    else if (s.tool === 'history-brush') show('history');
    // Like Skill Vector: picking a tool brings its settings forward (but stay on Actions while recording,
    // and on Adjust while the white-balance picker is out)
    else if (!isRecording() && !(s.tool === 'eyedropper' && s.opts.eyedropperMode === 'wb')) show('properties');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.tool]);

  const panels = (
    <div className={`dock-section dock-panels ${lay.panelsCollapsed ? 'collapsed' : ''}`} style={lay.panelsCollapsed ? undefined : lay.layersCollapsed ? { flex: '1 1 0' } : { flexBasis: `${lay.split * 100}%` }}>
      <div className="dock-tabs" ref={rowRef} onDragOver={(e) => e.preventDefault()} onDrop={() => dragTab && moveTab(dragTab, null)}>
        {shownTabs.map((t) => (
          <button
            key={t}
            data-tab={t}
            draggable
            className={`${topTab === t && !lay.panelsCollapsed ? 'active' : ''} ${dragTab === t ? 'dragging' : ''}`}
            title="Click to open · drag to reorder"
            onClick={() => {
              setTopTab(t);
              if (lay.panelsCollapsed) setLayout({ panelsCollapsed: false });
            }}
            onDragStart={(e) => {
              setDragTab(t);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', t);
            }}
            onDragEnd={() => setDragTab(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragTab && dragTab !== t) moveTab(dragTab, t);
              setDragTab(null);
            }}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        {moreTabs.length > 0 && (
          <div className="dock-more" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setMoreOpen(false)}>
            <button className={`dock-more-btn ${moreOpen ? 'open' : ''}`} title={`More panels: ${moreTabs.map((t) => TAB_LABELS[t]).join(', ')}`} aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
              More <ChevronDown size={11} />
            </button>
            {moreOpen && (
              <div className="dock-more-menu" role="menu">
                {moreTabs.map((t) => (
                  <button
                    key={t}
                    role="menuitem"
                    onClick={() => {
                      setTopTab(t);
                      setMoreOpen(false);
                      if (lay.panelsCollapsed) setLayout({ panelsCollapsed: false });
                    }}
                  >
                    {TAB_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <span className="dock-tabs-spacer" />
        <button className="dock-mini" title={lay.panelsCollapsed ? 'Expand panels' : 'Collapse panels'} onClick={() => setLayout({ panelsCollapsed: !lay.panelsCollapsed })}>
          {lay.panelsCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>
      {!lay.panelsCollapsed && (
        <div className="dock-top" ref={topRef}>
          {topTab === 'properties' && <PropertiesPanel />}
          {topTab === 'social' && <SocialPanel />}
          {topTab === 'photo' && <PhotoPanel />}
          {topTab === 'adjust' && <AdjustPanel />}
          {topTab === 'looks' && <LooksPanel />}
          {topTab === 'grids' && <GridsPanel />}
          {topTab === 'color' && <ColorPanel />}
          {topTab === 'info' && <InfoPanel />}
          {topTab === 'history' && <HistoryPanel />}
          {topTab === 'actions' && <ActionsPanel />}
          {topTab === 'navigator' && <NavigatorPanel />}
        </div>
      )}
    </div>
  );
  const layers = (
    <div className={`dock-section dock-layers ${lay.layersCollapsed ? 'collapsed' : ''}`}>
      <div className="dock-title">
        <Layers size={12} /> Layers
        <span className="dock-tabs-spacer" />
        <button className="dock-mini" title={lay.layersOnTop ? 'Move Layers below the panels' : 'Move Layers above the panels'} onClick={() => setLayout({ layersOnTop: !lay.layersOnTop })}>
          {lay.layersOnTop ? <ArrowDownToLine size={13} /> : <ArrowUpToLine size={13} />}
        </button>
        <button className="dock-mini" title={lay.layersCollapsed ? 'Expand Layers' : 'Collapse Layers'} onClick={() => setLayout({ layersCollapsed: !lay.layersCollapsed })}>
          {lay.layersCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
      </div>
      {!lay.layersCollapsed && (
        <div className="dock-bottom">
          <LayersPanel />
        </div>
      )}
    </div>
  );
  const splitter = !lay.panelsCollapsed && !lay.layersCollapsed && (
    <div
      className="dock-splitter"
      title="Drag to resize · double-click to reset"
      onDoubleClick={() => setLayout({ split: 0.46 })}
      onPointerDown={(e) =>
        dragHandle(e, 'ns-resize', (ev) => {
          const r = dockRef.current!.getBoundingClientRect();
          let f = (ev.clientY - r.top) / r.height;
          if (lay.layersOnTop) f = 1 - f;
          setLayout({ split: Math.max(0.15, Math.min(0.85, f)) });
        })
      }
    />
  );
  return (
    <div className={`dock ${overlay ? 'overlay' : ''}`} ref={dockRef} style={{ width: Math.min(lay.dockWidth, maxWidth) }}>
      <div
        className="dock-edge"
        title="Drag to resize the panels · double-click to reset"
        onDoubleClick={() => setLayout({ dockWidth: 300 })}
        onPointerDown={(e) =>
          dragHandle(e, 'ew-resize', (ev) => {
            const right = dockRef.current!.getBoundingClientRect().right;
            setLayout({ dockWidth: Math.round(Math.max(220, Math.min(640, (right - ev.clientX) / uiZoom()))) });
          })
        }
      />
      {currentWorkspace().histogram && <HistogramPanel />}
      {lay.layersOnTop ? <>{layers}{splitter}{panels}</> : <>{panels}{splitter}{layers}</>}
    </div>
  );
}

function RecoveryBanner() {
  const [rec, setRec] = useState<{ json: string; time: number; title: string } | null>(null);
  useEffect(() => {
    io.readRecovery().then((r) => {
      if (r && Date.now() - r.time < 7 * 864e5) setRec(r);
    });
  }, []);
  if (!rec) return null;
  return (
    <div className="recovery">
      <Sparkles size={14} />
      <span>
        Recover unsaved “{rec.title}” from {new Date(rec.time).toLocaleString()}?
      </span>
      <button
        className="btn primary"
        onClick={async () => {
          setRec(null);
          await store.task('Recovering', () => io.loadProject(rec.json, rec.title));
        }}
      >
        Restore
      </button>
      <button
        className="btn ghost"
        onClick={() => {
          setRec(null);
          io.clearRecovery();
        }}
      >
        Discard
      </button>
    </div>
  );
}

export default function App() {
  const s = useStore();
  const room = useRoom();
  const lay = useLayout();
  const [dragging, setDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Native macOS drop integration
  useEffect(() => {
    (window as any).__skillSuiteOnNativeFileDrop = async (fileList: Array<{ name: string; mime?: string; type?: string; data?: string; base64?: string }>) => {
      if (!fileList || !fileList.length) return;
      const files: File[] = [];
      for (const item of fileList) {
        try {
          const raw = item.base64 || item.data;
          if (!raw) continue;
          const byteCharacters = atob(raw);
          const byteNumbers = new Uint8Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const mime = item.type || item.mime || 'application/octet-stream';
          const blob = new Blob([byteNumbers], { type: mime });
          files.push(new File([blob], item.name, { type: mime }));
        } catch (err) {
          console.error('Error decoding native dropped file', err);
        }
      }
      if (files.length > 0) {
        await io.dropFiles(files);
      }
    };
    return () => {
      delete (window as any).__skillSuiteOnNativeFileDrop;
    };
  }, []);

  // Theme, accent and pasteboard follow the saved preferences
  useEffect(() => applyPrefs(s.prefs), [s.prefs]);

  // Options bar: the wheel scrolls it sideways when it is wider than the window, and edge
  // fades show there is more (data attributes, so React's className stays untouched)
  useEffect(() => {
    const mark = (el: HTMLElement) => {
      el.dataset.moreLeft = String(el.scrollLeft > 2);
      el.dataset.moreRight = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    };
    const onWheel = (e: WheelEvent) => {
      const bar = (e.target as HTMLElement).closest?.('.options-bar') as HTMLElement | null;
      if (!bar || bar.scrollWidth <= bar.clientWidth || (e.target as HTMLElement).closest('select, input, .font-pop')) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        bar.scrollLeft += e.deltaY;
        e.preventDefault();
      }
      mark(bar);
    };
    const refresh = () => document.querySelectorAll<HTMLElement>('.options-bar').forEach(mark);
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el.classList?.contains('options-bar')) mark(el);
    };
    const ro = new ResizeObserver(refresh);
    let raf = 0;
    const mo = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        document.querySelectorAll<HTMLElement>('.options-bar').forEach((el) => ro.observe(el));
        refresh();
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', refresh);
    refresh();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('wheel', onWheel);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', refresh);
    };
  }, []);

  // Fonts added in earlier sessions
  useEffect(() => {
    void loadSavedFonts();
  }, []);

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      // Undo / redo keep working while the floating Layer Style panel is open
      const undoKey = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z';
      if (s.dialog?.type === 'layerStyle' && undoKey) {
        if (handleKey(e)) e.preventDefault();
        return;
      }
      if (s.dialog && e.key !== 'Escape') return;
      if (s.dialog && e.key === 'Escape') {
        store.set({ dialog: null });
        return;
      }
      if (handleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.dialog]);

  // Paste from the system or layer clipboard
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (isTextEntry(e.target)) return;
      e.preventDefault();
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) {
        if (store.doc) await store.task('Pasting', () => io.placeImage(file, 'Pasted'));
        else await store.task('Pasting', async () => io.docFromCanvas(await io.fileToCanvas(file), 'Pasted Image'));
        return;
      }
      await ops.paste();
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Autosave for crash recovery (every 45s when dirty)
  useEffect(() => {
    const t = setInterval(() => {
      const d = store.doc;
      if (d?.dirty && !store.state.busy) io.saveRecovery(d);
    }, 45000);
    return () => clearInterval(t);
  }, []);

  // Warn before closing with unsaved work
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (store.state.docs.some((d) => d.dirty)) {
        if (store.doc) io.saveRecovery(store.doc);
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);

  return (
    <div
      className={`app ${s.focusMode ? 'focus' : ''} ${roomClasses(room)}`}
      onDragEnter={(e) => {
        dragCounterRef.current++;
        const hasFiles = e.dataTransfer.types && (e.dataTransfer.types.includes('Files') || Array.from(e.dataTransfer.types).includes('Files'));
        if (hasFiles && !(window as any).__skillSuiteDragLayers) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragOver={(e) => {
        const hasFiles = e.dataTransfer.types && (e.dataTransfer.types.includes('Files') || Array.from(e.dataTransfer.types).includes('Files'));
        if (hasFiles && !(window as any).__skillSuiteDragLayers) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (!dragging) setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current <= 0) {
          dragCounterRef.current = 0;
          setDragging(false);
        }
      }}
      onDrop={async (e) => {
        dragCounterRef.current = 0;
        setDragging(false);
        // External files dropped
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          const files = Array.from(e.dataTransfer.files);
          const at = store.doc ? (clientToDoc(e.clientX, e.clientY) ?? undefined) : undefined;
          const hit = at && store.doc ? pickObject(at.x, at.y, store.doc.view.zoom, true) : null;
          const frame = hit?.kind === 'shape' && hit.id === store.activeLayer?.id ? hit : null;
          await io.dropFiles(files, { at, frame, asDocuments: e.shiftKey });
          return;
        }
      }}
    >
      <MenuBar />
      <OptionsBar />
      <div className="workspace">
        <ToolRail />
        <div className="center">
          <DocTabs />
          {s.docs.length ? <Viewport /> : <Welcome />}
          {s.dialog?.type === 'layerStyle' && store.doc && <LayerStylePanel />}
        </div>
        {!s.focusMode && !room.compact && s.opts.activeToolbox && <ActiveToolbox />}
        {!s.focusMode && room.compact && lay.dockOpen && <div className="dock-scrim" onPointerDown={() => setLayout({ dockOpen: false })} />}
        {!s.focusMode && (room.compact ? lay.dockOpen : !lay.dockHidden) && (
          // Wide windows: a column up to 42% of the width; narrow ones: a drawer over the canvas
          <RightDock overlay={room.compact} maxWidth={room.compact ? Math.max(240, room.w - 56) : Math.max(220, Math.round(room.w * 0.42))} />
        )}
      </div>
      <StatusBar />
      <RecoveryBanner />
      <Dialogs />
      <CommandPalette />
      <Toasts />
      <AiAssistant adapter={photoAdapter} />
      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={28} />
          <div>{store.doc ? 'Drop to place on this board · hold Shift to open as a new document' : 'Drop to open'}</div>
        </div>
      )}
      {s.busy && <div className="busy-veil" />}
    </div>
  );
}
