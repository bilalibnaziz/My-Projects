import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Command as CmdIcon, X, Loader2, Search, Zap, Cpu, Menu as MenuIcon, ChevronLeft, ChevronRight, PanelRight, Plus, Sparkles } from 'lucide-react';
import { store, useStore } from '../core/store';
import { COMMANDS, formatKeys } from '../core/commands';
import type { MenuId } from '../core/commands';
import { onCursor } from './Viewport';
import { getAdjustEngine } from '../core/gl';
import { toolLabel } from './ToolRail';
import { WorkspaceSwitcher } from './Workspace';
import { toggleAssistant } from '../ai/open';
import { useRoom } from './responsive';
import { uiZoom } from './theme';
import { toggleDock, useLayout } from './layout';

const MENUS: MenuId[] = ['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'View', 'Window', 'Help'];

type MenuItemEntry = { type: 'command'; cmd: (typeof COMMANDS)[0] } | { type: 'submenu'; name: string; items: (typeof COMMANDS); sep?: boolean };

/**
 * A submenu rendered on <body>: the menu panel scrolls (overflow) and has a backdrop filter, so a
 * flyout nested inside it would be clipped and clicks would fall through to the canvas. Placed
 * beside its item, flipped to the left near the right edge and kept inside the window.
 */
function SubMenuPortal({ anchor, onMouseEnter, children }: { anchor: DOMRect; onMouseEnter: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const z = uiZoom();
    const r = el.getBoundingClientRect();
    let left = anchor.right - 2;
    if (left + r.width > innerWidth - 4) left = Math.max(4, anchor.left - r.width + 2);
    let top = anchor.top - 4;
    if (top + r.height > innerHeight - 4) top = Math.max(4, innerHeight - 4 - r.height);
    setPos({ left: left / z, top: top / z });
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      className="menu-sub-pop"
      style={{ position: 'fixed', left: pos?.left ?? anchor.right / uiZoom(), top: pos?.top ?? anchor.top / uiZoom(), visibility: pos ? 'visible' : 'hidden' }}
      onMouseEnter={onMouseEnter}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuBar() {
  useStore();
  const room = useRoom();
  const lay = useLayout();
  const [open, setOpen] = useState<MenuId | 'all' | null>(null);
  const [activeSub, setActiveSubName] = useState<string | null>(null);
  const [subAnchor, setSubAnchor] = useState<DOMRect | null>(null);
  const setActiveSub = (name: string | null, from?: Element) => {
    setActiveSubName(name);
    if (from) setSubAnchor(from.getBoundingClientRect());
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setActiveSub(null);
      return;
    }
    const close = (e: MouseEvent) => {
      // Submenus live on <body> (see SubMenuPortal), so clicks in them count as inside
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.menu-sub-pop')) {
        setOpen(null);
        setActiveSub(null);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const menuEntries = (m: MenuId): MenuItemEntry[] => {
    const cmds = COMMANDS.filter((c) => c.menu === m);
    const out: MenuItemEntry[] = [];
    const seenSubs = new Map<string, MenuItemEntry & { type: 'submenu' }>();

    for (const c of cmds) {
      if (c.submenu) {
        const existing = seenSubs.get(c.submenu);
        if (existing) {
          existing.items.push(c);
        } else {
          const subEntry: MenuItemEntry = {
            type: 'submenu',
            name: c.submenu,
            items: [c],
            sep: c.sep,
          };
          seenSubs.set(c.submenu, subEntry);
          out.push(subEntry);
        }
      } else {
        out.push({ type: 'command', cmd: c });
      }
    }
    return out;
  };

  const renderItems = (m: MenuId) => {
    const entries = menuEntries(m);
    return entries.map((entry) => {
      if (entry.type === 'command') {
        const c = entry.cmd;
        const disabled = c.enabled ? !c.enabled() : false;
        return (
          <div key={c.id}>
            {c.sep && <div className="menu-sep" />}
            <button
              className="menu-item"
              disabled={disabled}
              onClick={() => {
                setOpen(null);
                setActiveSub(null);
                c.run();
              }}
              onMouseEnter={() => setActiveSub(null)}
            >
              <span className="menu-check">{c.checked?.() ? <Check size={12} /> : null}</span>
              <span className="menu-label">{c.label}</span>
              <span className="menu-keys">{formatKeys(c.keys)}</span>
            </button>
          </div>
        );
      }

      const allDisabled = entry.items.every((it) => it.enabled && !it.enabled());
      const isSubOpen = activeSub === entry.name && !allDisabled;
      return (
        <div
          key={entry.name}
          className={`menu-sub-wrapper ${isSubOpen ? 'open' : ''}`}
          onMouseEnter={(e) => {
            if (!allDisabled) setActiveSub(entry.name, e.currentTarget.querySelector('.menu-item') ?? e.currentTarget);
          }}
        >
          {entry.sep && <div className="menu-sep" />}
          <button
            className={`menu-item ${isSubOpen ? 'sub-open' : ''}`}
            disabled={allDisabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!allDisabled) setActiveSub(isSubOpen ? null : entry.name, e.currentTarget);
            }}
          >
            <span className="menu-check" />
            <span className="menu-label">{entry.name}</span>
            <span className="menu-sub-arrow"><ChevronRight size={13} /></span>
          </button>
          {isSubOpen && subAnchor && (
            <SubMenuPortal anchor={subAnchor} onMouseEnter={() => setActiveSub(entry.name)}>
              {entry.items.map((subCmd) => {
                const disabled = subCmd.enabled ? !subCmd.enabled() : false;
                return (
                  <div key={subCmd.id}>
                    {subCmd.sep && <div className="menu-sep" />}
                    <button
                      className="menu-item"
                      disabled={disabled}
                      onClick={() => {
                        setOpen(null);
                        setActiveSub(null);
                        subCmd.run();
                      }}
                    >
                      <span className="menu-check">{subCmd.checked?.() ? <Check size={12} /> : null}</span>
                      <span className="menu-label">{subCmd.label}</span>
                      <span className="menu-keys">{formatKeys(subCmd.keys)}</span>
                    </button>
                  </div>
                );
              })}
            </SubMenuPortal>
          )}
        </div>
      );
    });
  };

  const panelsShown = room.compact ? lay.dockOpen : !lay.dockHidden;
  return (
    <div className="menubar" ref={ref}>
      <div className="brand" title="Skill Photo">
        <span className="brand-mark" />
        {!room.compact && 'Skill Photo'}
      </div>
      {room.compact ? (
        <div className="menu">
          <button className={`menu-btn ${open ? 'open' : ''}`} onClick={() => setOpen(open ? null : 'all')} title="Menus">
            <MenuIcon size={14} /> Menu
          </button>
          {open && (
            <div className="menu-pop">
              {open === 'all'
                ? MENUS.map((m) => (
                    <button key={m} className="menu-item" onClick={() => setOpen(m)}>
                      <span className="menu-check" />
                      <span className="menu-label">{m}</span>
                      <ChevronRight size={12} />
                    </button>
                  ))
                : (
                  <>
                    <button className="menu-item menu-back" onClick={() => setOpen('all')}>
                      <span className="menu-check"><ChevronLeft size={12} /></span>
                      <span className="menu-label">{open}</span>
                    </button>
                    <div className="menu-sep" />
                    {renderItems(open)}
                  </>
                )}
            </div>
          )}
        </div>
      ) : (
        MENUS.map((m) => (
          <div key={m} className="menu">
            <button
              className={`menu-btn ${open === m ? 'open' : ''}`}
              onClick={() => {
                setOpen(open === m ? null : m);
                setActiveSub(null);
              }}
              onMouseEnter={() => {
                if (open) {
                  setOpen(m);
                  setActiveSub(null);
                }
              }}
            >
              {m}
            </button>
            {open === m && <div className="menu-pop">{renderItems(m)}</div>}
          </div>
        ))
      )}
      <div className="opt-spacer" />
      <WorkspaceSwitcher compact={room.narrow} />
      <button className="palette-btn ai-launch" onClick={() => toggleAssistant()} title={`AI assistant — Claude, ChatGPT, Gemini (${formatKeys('Mod+Alt+K')})`} aria-label="AI assistant">
        <Sparkles size={12} />
        {!room.narrow && <span>Ask AI</span>}
      </button>
      <button className="palette-btn" onClick={() => store.set({ paletteOpen: true })} title="Search every command (⌘K)">
        <Search size={12} />
        {!room.narrow && <span>Search commands</span>}
        {!room.tiny && <kbd className="kbd">{formatKeys('Mod+K')}</kbd>}
      </button>
      <button
        className={`menubar-icon ${panelsShown ? 'on' : ''}`}
        onClick={() => toggleDock(room.compact)}
        title={panelsShown ? 'Hide panels' : 'Show panels'}
        aria-pressed={panelsShown}
      >
        <PanelRight size={14} />
      </button>
    </div>
  );
}

export function DocTabs() {
  const s = useStore();
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dropTabTarget, setDropTabTarget] = useState<{ id: string; placeAfter: boolean } | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const hoverTimerRef = useRef<{ tabId: string; timer: any } | null>(null);

  if (!s.docs.length) return null;

  const clearHover = () => {
    if (hoverTimerRef.current?.timer) {
      clearTimeout(hoverTimerRef.current.timer);
      hoverTimerRef.current = null;
    }
  };

  return (
    <div className="doc-tabs" onDragLeave={() => { clearHover(); setDragOverTabId(null); setDropTabTarget(null); }}>
      {s.docs.map((d) => {
        const isActive = d.id === s.activeDocId;
        const isDragging = dragTabId === d.id;
        const isOver = dragOverTabId === d.id;
        const dropIndicator = dropTabTarget?.id === d.id ? (dropTabTarget.placeAfter ? 'drop-after' : 'drop-before') : '';

        return (
          <div
            key={d.id}
            className={`doc-tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isOver ? 'drop-over' : ''} ${dropIndicator}`}
            draggable
            onDragStart={(e) => {
              setDragTabId(d.id);
              e.dataTransfer.setData('application/x-skillsuite-tab', d.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragTabId(null);
              setDropTabTarget(null);
              setDragOverTabId(null);
              clearHover();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              // 1. Tab reordering
              if (dragTabId) {
                if (dragTabId !== d.id) {
                  const r = e.currentTarget.getBoundingClientRect();
                  const placeAfter = (e.clientX - r.left) / r.width > 0.5;
                  setDropTabTarget({ id: d.id, placeAfter });
                }
                return;
              }

              // 2. Dragging layers or files over this tab
              e.dataTransfer.dropEffect = 'copy';
              setDragOverTabId(d.id);

              // Auto-switch to tab after hovering 260ms (Photoshop behavior)
              if (d.id !== s.activeDocId) {
                if (hoverTimerRef.current?.tabId !== d.id) {
                  clearHover();
                  hoverTimerRef.current = {
                    tabId: d.id,
                    timer: setTimeout(() => {
                      store.switchDoc(d.id);
                    }, 260),
                  };
                }
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) {
                if (dragOverTabId === d.id) setDragOverTabId(null);
                if (hoverTimerRef.current?.tabId === d.id) clearHover();
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              clearHover();
              setDragOverTabId(null);
              setDropTabTarget(null);

              // Case A: Tab reordering
              if (dragTabId && dragTabId !== d.id) {
                const r = e.currentTarget.getBoundingClientRect();
                const placeAfter = (e.clientX - r.left) / r.width > 0.5;
                store.reorderDocs(dragTabId, d.id, placeAfter);
                setDragTabId(null);
                return;
              }

              // Case B: Dropping files from Finder/Downloads onto this specific tab
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                store.switchDoc(d.id);
                const { dropFiles } = await import('../core/io');
                await dropFiles(Array.from(e.dataTransfer.files));
                return;
              }

              // Case C: Dropping layers from another tab onto this tab
              const dragLayers = (window as any).__skillSuiteDragLayers;
              if (dragLayers && dragLayers.layers && dragLayers.layers.length > 0) {
                const { transferLayersToDoc } = await import('../core/ops');
                transferLayersToDoc(d.id, dragLayers.layers);
                (window as any).__skillSuiteDragLayers = null;
                return;
              }
            }}
            onClick={() => store.switchDoc(d.id)}
            onAuxClick={(e) => e.button === 1 && store.closeDoc(d.id)}
          >
            <span className="doc-title">{d.title}</span>
            <span className="doc-meta">
              {Math.round(d.view.zoom * 100)}%{d.dirty ? ' •' : ''}
            </span>
            <button
              className="doc-close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                store.closeDoc(d.id);
              }}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
      <button
        className="doc-new-tab"
        title="New Document (⌘N)"
        onClick={() => store.set({ dialog: { type: 'new' } })}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function StatusBar() {
  const s = useStore();
  const doc = store.doc;
  const [cur, setCur] = useState<{ x: number; y: number; color: string | null } | null>(null);
  useEffect(() => onCursor(setCur), []);
  const gpu = useMemo(() => !!getAdjustEngine(), []);
  const layer = store.activeLayer;
  return (
    <div className="statusbar">
      <span className="sb-item sb-brand" title="Skill Photo">Skill Photo</span>
      {doc ? (
        <>
          <span className="sb-item">
            {doc.width} × {doc.height} px
          </span>
          <span className="sb-item" data-color-space title="Working colour space (Image ▸ Color Space)">
            {doc.colorSpace === 'display-p3' ? 'Display P3' : 'sRGB'}
          </span>
          <span className="sb-item">
            <input
              className="sb-zoom"
              value={`${Math.round(doc.view.zoom * 100)}%`}
              onChange={() => {}}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const v = parseFloat((e.target as HTMLInputElement).value);
                  if (v > 0) {
                    const vpEl = document.querySelector('.viewport') as HTMLElement;
                    const vp = { width: vpEl.clientWidth, height: vpEl.clientHeight };
                    const z = v / 100;
                    const view = doc.view;
                    view.panX = vp.width / 2 - ((vp.width / 2 - view.panX) * z) / view.zoom;
                    view.panY = vp.height / 2 - ((vp.height / 2 - view.panY) * z) / view.zoom;
                    view.zoom = z;
                    store.emit();
                  }
                  (e.target as HTMLInputElement).blur();
                }
              }}
              onFocus={(e) => e.target.select()}
            />
          </span>
          <span className="sb-item mono">{cur ? `X ${cur.x}  Y ${cur.y}` : '—'}</span>
          {cur?.color && (
            <span className="sb-item mono">
              <span className="sb-swatch" style={{ background: cur.color }} />
              {cur.color}
            </span>
          )}
          {doc.selection && (
            <span className="sb-item">
              Selection {Math.round(doc.selection.bounds.width)} × {Math.round(doc.selection.bounds.height)}
            </span>
          )}
          <span className="sb-item">
            {toolLabel(s.tool)} · {layer?.name ?? '—'}
            {doc.editMask && layer?.mask ? ' (mask)' : ''}
          </span>
        </>
      ) : (
        <span className="sb-item">Ready</span>
      )}
      <div className="opt-spacer" />
      {s.busy && (
        <span className="sb-item busy">
          <Loader2 size={12} className="spin" /> {s.busy}…
        </span>
      )}
      <span className={`sb-item ${gpu ? 'ok' : 'warn'}`} title={gpu ? 'Adjustments render on the GPU (WebGL2)' : 'WebGL2 unavailable — adjustment layers disabled'}>
        {gpu ? <Zap size={11} /> : <Cpu size={11} />} {gpu ? 'GPU' : 'CPU'}
      </span>
      <span className="sb-item">{doc?.dirty ? 'Unsaved changes' : doc ? 'Saved' : ''}</span>
    </div>
  );
}

export function Toasts() {
  const s = useStore();
  return (
    <div className="toasts">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function fuzzy(q: string, text: string): number {
  q = q.toLowerCase();
  text = text.toLowerCase();
  if (!q) return 1;
  if (text.includes(q)) return 100 - text.indexOf(q);
  let ti = 0;
  let score = 0;
  for (const ch of q) {
    const i = text.indexOf(ch, ti);
    if (i < 0) return 0;
    score += i === ti ? 3 : 1;
    ti = i + 1;
  }
  return score;
}

export function CommandPalette() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const results = useMemo(
    () =>
      COMMANDS.map((c) => ({ c, score: fuzzy(q, `${c.menu ?? ''} ${c.label}`) }))
        .filter((r) => r.score > 0 && (!r.c.enabled || r.c.enabled()))
        .sort((a, b) => b.score - a.score)
        .slice(0, 14),
    [q, s.paletteOpen]
  );
  if (!s.paletteOpen) return null;
  const run = (i: number) => {
    const r = results[i];
    if (!r) return;
    store.set({ paletteOpen: false });
    setQ('');
    r.c.run();
  };
  return (
    <div className="overlay" onPointerDown={() => store.set({ paletteOpen: false })}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <CmdIcon size={15} />
          <input
            autoFocus
            placeholder="Type a command… (e.g. “curves”, “remove object”, “rotate”)"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((v) => Math.min(results.length - 1, v + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === 'Enter') run(sel);
              else if (e.key === 'Escape') store.set({ paletteOpen: false });
            }}
          />
        </div>
        <div className="palette-list">
          {results.map((r, i) => (
            <button key={r.c.id} className={`palette-item ${i === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(i)}>
              <span className="palette-menu">{r.c.menu}</span>
              <span className="palette-label">{r.c.label}</span>
              <span className="menu-keys">{formatKeys(r.c.keys)}</span>
            </button>
          ))}
          {!results.length && <div className="panel-empty">No matching commands</div>}
        </div>
      </div>
    </div>
  );
}
