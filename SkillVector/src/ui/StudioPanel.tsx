// Studio: the tool kit of the current workspace — Trace, Print, Social, Web & UI, Video, Mood Board.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, XCircle, Copy, Check, ImagePlus, FileDown, Wand2, Lock, Unlock, Trash2 } from 'lucide-react';
import { store, useStore } from '../core/store';
import type { Layer } from '../core/types';
import { shapePath } from '../core/render';
import { ctx2d } from '../core/canvas';
import { pickFiles, placeImage, exportTiledPdf } from '../core/io';
import { getActiveArtboard } from '../core/vectorOps';
import { ColorInput, NumberField, Select, Slider, Toggle } from './widgets';
import { currentWorkspace, setLayout, switchWorkspace, useLayout, workspaceTabs } from './layout';
import { TRACE_PRESETS, autoTrace, colorTargets, colorsIn, currentTraceOptions, dropColor, expandTrace, makeTemplate, mergeByColor, previewTrace, recolor, releaseTemplate, runTrace, simplifyTargets, traceSource, traceVisible } from '../core/studio/trace';
import type { TraceOptions } from '../core/studio/trace';
import type { TraceResult } from '../core/tracer';
import { DEFAULT_PRINT, SHEETS, exportGangSheet, exportPrintPdf, extendToBleed, fixHairlines, inkCoverage, loadPrintPrefs, mmToPx, nUpLayout, preflight, pxToMm, savePrintPrefs } from '../core/studio/print';
import type { PrintPrefs, PreflightIssue } from '../core/studio/print';
import { CORE_PLATFORMS, PLATFORM_SIZES, createCarousel, exportCarousel, exportProfileGrid, legibility, resizeForPlatforms } from '../core/studio/socialKit';
import { COMPONENTS, COMPONENT_LABELS, DEVICES, addDevice, contrastReport, cssFor, exportSelectionAssets, fixContrast, insertComponent, snapSelection } from '../core/studio/webKit';
import type { ContrastRow } from '../core/studio/webKit';
import { FRAMES, GRAPHICS, GRAPHIC_LABELS, addFrame, exportOverlays, insertGraphic } from '../core/studio/videoKit';
import { NOTE_COLORS, addLabel, addNote, addPaletteStrip, addPictures, arrange, boardPalette } from '../core/studio/moodKit';
import { exportArtboards } from '../core/studio/export';
import type { BoardFormat } from '../core/studio/export';

export type Kit = 'trace' | 'print' | 'social' | 'web' | 'video' | 'mood';

const KITS: { id: Kit; label: string; tab: string }[] = [
  { id: 'trace', label: 'Trace', tab: 'Trace Studio' },
  { id: 'print', label: 'Print', tab: 'Print Studio' },
  { id: 'social', label: 'Social', tab: 'Social Studio' },
  { id: 'web', label: 'Web & UI', tab: 'UI Studio' },
  { id: 'video', label: 'Video', tab: 'Video Studio' },
  { id: 'mood', label: 'Mood Board', tab: 'Mood Board' },
];

const WORKSPACE_KIT: Record<string, Kit> = { trace: 'trace', print: 'print', packaging: 'print', design: 'social', web: 'web', video: 'video', mood: 'mood' };
const KIT_KEY = 'skillvector.studioKit';

function savedKit(): Kit {
  try {
    const k = localStorage.getItem(KIT_KEY) as Kit | null;
    if (k && KITS.some((x) => x.id === k)) return k;
  } catch {
    /* storage unavailable */
  }
  return 'trace';
}

/** The kit the current workspace opens with. */
export function workspaceKit(): Kit {
  return WORKSPACE_KIT[currentWorkspace().id] ?? savedKit();
}

export function studioTabLabel(): string {
  return KITS.find((k) => k.id === workspaceKit())!.tab;
}

let kitRequest: { kit: Kit; n: number; at: number } = { kit: 'trace', n: 0, at: 0 };

/** Shows a studio kit (e.g. from the Image Trace tool's options bar), switching workspace only if needed. */
export function openStudioKit(kit: Kit) {
  kitRequest = { kit, n: kitRequest.n + 1, at: Date.now() };
  if (workspaceTabs().includes('studio')) store.setDockTab('studio');
  else switchWorkspace(kit === 'trace' ? 'trace' : 'essentials');
}

export function StudioPanel() {
  useStore();
  const lay = useLayout();
  // A kit picked here sticks until the workspace changes
  const [choice, setChoice] = useState<{ ws: string; kit: Kit } | null>(null);
  // A kit asked for from elsewhere (openStudioKit) wins once
  // (a panel mounted by that very request still applies it)
  const [seenRequest, setSeenRequest] = useState(() => (Date.now() - kitRequest.at < 1500 ? -1 : kitRequest.n));
  if (kitRequest.n !== seenRequest) {
    setSeenRequest(kitRequest.n);
    setChoice({ ws: lay.workspace, kit: kitRequest.kit });
  }
  const kit = choice?.ws === lay.workspace ? choice.kit : workspaceKit();
  const doc = store.doc;
  if (!doc) return <div className="panel-empty">Open or create a document to use the studio</div>;
  const choose = (k: Kit) => {
    setChoice({ ws: lay.workspace, kit: k });
    try {
      localStorage.setItem(KIT_KEY, k);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <div className="studio-panel">
      <div className="kit-picker" role="tablist" aria-label="Studio kit">
        {KITS.map((k) => (
          <button key={k.id} role="tab" aria-selected={kit === k.id} className={kit === k.id ? 'active' : ''} onClick={() => choose(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      {kit === 'trace' && <TraceKit />}
      {kit === 'print' && <PrintKit />}
      {kit === 'social' && <SocialKit />}
      {kit === 'web' && <WebKit />}
      {kit === 'video' && <VideoKit />}
      {kit === 'mood' && <MoodKit />}
    </div>
  );
}

function Sec({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="panel-section studio-sec">
      <div className="mini-title studio-title">
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

function ExportRow({ which = 'all' as 'all' | 'active', defaultFormat = 'png' as BoardFormat, scales = [1, 2] }) {
  const [format, setFormat] = useState<BoardFormat>(defaultFormat);
  const [scale, setScale] = useState(1);
  const n = which === 'active' ? 1 : store.doc?.artboards?.length || 1;
  return (
    <div className="prop-row">
      <Select value={format} title="Format" onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPG' }, { value: 'webp', label: 'WebP' }, { value: 'pdf', label: 'PDF' }]} />
      <Select value={scale} title="Scale" onChange={setScale} options={scales.map((s) => ({ value: s, label: `@${s}x` }))} />
      <button className="btn primary" onClick={() => store.doc && exportArtboards(store.doc, { format, scale, which })}>
        <FileDown size={13} /> Export {n > 1 ? `${n} artboards` : 'artboard'}
      </button>
    </div>
  );
}

// ================================================================ Trace

function drawTrace(canvas: HTMLCanvasElement, res: TraceResult | null, src: HTMLCanvasElement | undefined, view: 'vector' | 'outline' | 'image') {
  const W = 268;
  const iw = src?.width ?? 1;
  const ih = src?.height ?? 1;
  const s = Math.min(W / iw, 190 / ih);
  canvas.width = Math.max(1, Math.round(iw * s));
  canvas.height = Math.max(1, Math.round(ih * s));
  const ctx = ctx2d(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (view === 'image' && src) {
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    return;
  }
  if (!res) return;
  if (view === 'outline' && src) {
    ctx.globalAlpha = 0.25;
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  for (const l of res.layers) {
    if (!l.shape) continue;
    shapePath(ctx, l.shape, l.x * s, l.y * s, l.width * s, l.height * s);
    if (view === 'outline') {
      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      if (l.shape.fillEnabled) {
        ctx.fillStyle = l.shape.fill;
        ctx.fill('evenodd');
      }
      if (l.shape.strokeWidth > 0) {
        ctx.strokeStyle = l.shape.stroke;
        ctx.lineWidth = Math.max(0.5, l.shape.strokeWidth * s);
        ctx.lineCap = l.shape.strokeCap ?? 'butt';
        ctx.lineJoin = l.shape.strokeJoin ?? 'miter';
        ctx.stroke();
      }
    }
  }
}

function TraceKit() {
  const st = useStore();
  const o = st.opts;
  const src = traceSource();
  const [view, setView] = useState<'vector' | 'outline' | 'image'>('vector');
  const [res, setRes] = useState<TraceResult | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const auto = o.tracePreset === 'auto' && src?.canvas ? autoTrace(src) : null;
  // What the sliders show: Auto's choice for this picture, else the saved settings
  const opts: TraceOptions = auto ? auto.opts : o.traceOpts;
  const fullOpts = useMemo(() => (src ? currentTraceOptions(src) : opts), [src, opts, o.tracePalette, o.traceOutput]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!src?.canvas) return setRes(null);
    const id = setTimeout(() => setRes(previewTrace(src, fullOpts)), 120);
    return () => clearTimeout(id);
  }, [src, fullOpts]);

  useEffect(() => {
    if (canvasRef.current) drawTrace(canvasRef.current, res, src?.canvas, view);
  }, [res, view, src]);

  const pick = (id: string) => {
    if (id === 'auto') return store.setOpts({ tracePreset: 'auto' });
    const p = TRACE_PRESETS.find((x) => x.id === id) ?? TRACE_PRESETS[0];
    store.setOpts({ tracePreset: p.id, traceOpts: { ...p.opts } });
  };
  // Any change starts from what is showing (Auto's choice included) and becomes Custom
  const set = (patch: Partial<TraceOptions>) => store.setOpts({ tracePreset: 'custom', traceOpts: { ...opts, ...patch } });
  const mode = opts.mode;
  const usesColors = mode === 'color' || mode === 'grayscale' || mode === 'pixel-exact';
  const inky = mode === 'bw' || mode === 'line-art' || mode === 'centerline';
  const isTemplate = !!src?.name.startsWith('Template · ');
  const targets = colorTargets();
  const presetId = o.tracePreset;

  return (
    <>
      <Sec title="Image">
        {src ? (
          <div className="trace-src">
            <b title={src.name}>{src.name}</b>
            <span>{src.canvas!.width} × {src.canvas!.height} px</span>
          </div>
        ) : (
          <div className="hint">Place a picture (logo, sketch, photo, pixel art), or select a pixel layer.</div>
        )}
        <div className="prop-row">
          <button className="btn ghost" onClick={async () => { const [f] = await pickFiles(undefined, false); if (f) await placeImage(f, f.name.replace(/\.[^.]+$/, '')); }}>
            <ImagePlus size={13} /> Place image…
          </button>
          {src && (isTemplate ? (
            <button className="btn ghost" onClick={() => releaseTemplate(src)} title="Back to a normal, unlocked picture"><Unlock size={13} /> Release template</button>
          ) : (
            <button className="btn ghost" onClick={() => makeTemplate(src)} title="Dim and lock the picture to trace it by hand with the Pen"><Lock size={13} /> Template for Pen</button>
          ))}
        </div>
        <button className="btn ghost" onClick={() => store.setTool('image-trace')} title="Click pictures on the canvas to trace them; drag to trace one part">
          <Wand2 size={13} /> Image Trace tool (⇧I)
        </button>
      </Sec>

      <Sec title="Preset" right={presetId === 'custom' ? <span className="mode-badge">Custom</span> : undefined}>
        <div className="shape-presets trace-presets">
          <button className={`preset-chip ${presetId === 'auto' ? 'on' : ''}`} title="Looks at the picture and picks the settings for it" onClick={() => pick('auto')}>
            Auto
          </button>
          {TRACE_PRESETS.map((p) => (
            <button key={p.id} className={`preset-chip ${presetId === p.id ? 'on' : ''} ${auto?.presetId === p.id ? 'suggested' : ''}`} title={p.hint} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        {auto && <div className="hint trace-auto">Auto: {auto.why}</div>}
      </Sec>

      {src && (
        <Sec
          title="Preview"
          right={
            <span className="seg compact">
              {(['vector', 'outline', 'image'] as const).map((v) => (
                <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                  {v === 'vector' ? 'Vector' : v === 'outline' ? 'Paths' : 'Image'}
                </button>
              ))}
            </span>
          }
        >
          <canvas ref={canvasRef} className="trace-preview" aria-label="Trace preview" />
          <div className="trace-stats">
            {res ? (
              <>
                <span>{res.colors.length} colour{res.colors.length === 1 ? '' : 's'}</span>
                <span>{res.layers.length.toLocaleString()} path{res.layers.length === 1 ? '' : 's'}</span>
                <span>{res.anchorCount.toLocaleString()} anchors</span>
              </>
            ) : (
              <span>Tracing…</span>
            )}
          </div>
          {res && res.colors.length > 0 && (
            <div className="swatch-row">
              {res.colors.slice(0, 32).map((c) => (
                <span key={c} className="swatch-dot" style={{ background: c }} title={c} />
              ))}
            </div>
          )}
        </Sec>
      )}

      <Sec title="Settings">
        <div className="prop-row">
          <span className="prop-label">Mode</span>
          <Select
            value={mode}
            onChange={(m) => set({ mode: m })}
            options={[{ value: 'bw', label: 'Black & white' }, { value: 'line-art', label: 'Line art (outlines)' }, { value: 'centerline', label: 'Centerline (strokes)' }, { value: 'color', label: 'Colour' }, { value: 'grayscale', label: 'Greyscale' }, { value: 'pixel-exact', label: 'Pixel exact' }]}
          />
        </div>
        {usesColors && <Slider label={opts.autoColors ? 'Colours (most)' : 'Colours'} value={opts.colors ?? 8} min={2} max={mode === 'pixel-exact' ? 128 : 64} onChange={(v) => set({ colors: v })} />}
        {mode === 'color' && (
          <div className="prop-row">
            <Toggle label="Find colours automatically" checked={!!opts.autoColors} onChange={(v) => set({ autoColors: v })} title="Uses only as many colours as the picture really has (up to the number above) and ignores the blended pixels along edges" />
          </div>
        )}
        {inky && <Slider label="Threshold" value={opts.threshold ?? 128} min={1} max={254} def={128} onChange={(v) => set({ threshold: v })} />}
        {mode === 'centerline' && <Slider label="Stroke width" value={opts.strokeWidth ?? 0} min={0} max={40} step={0.5} def={0} format={(v) => (v ? `${v} px` : 'Measured')} onChange={(v) => set({ strokeWidth: v })} />}
        {mode !== 'pixel-exact' && (
          <>
            <Slider label="Path fit" value={opts.simplification ?? 1} min={0.2} max={5} step={0.1} def={1} format={(v) => `${v.toFixed(1)} px`} onChange={(v) => set({ simplification: v })} />
            <Slider label="Corners" value={opts.cornerThreshold ?? 60} min={15} max={150} def={60} unit="°" onChange={(v) => set({ cornerThreshold: v })} />
            <Slider label="Smooth image" value={opts.blur ?? 0} min={0} max={4} step={0.5} def={0} format={(v) => (v ? `${v} px` : 'Off')} onChange={(v) => set({ blur: v })} />
            {!inky && <Slider label="Clean edges" value={opts.smoothEdges ?? 0} min={0} max={3} def={0} format={(v) => (v ? `${v}×` : 'Off')} onChange={(v) => set({ smoothEdges: v })} />}
          </>
        )}
        <Slider label="Ignore specks under" value={opts.minArea ?? 4} min={1} max={400} def={4} unit=" px" onChange={(v) => set({ minArea: v })} />
        <div className="prop-row wrap">
          {mode !== 'centerline' && <Toggle label="Leave white out" checked={opts.ignoreWhite ?? true} onChange={(v) => set({ ignoreWhite: v })} />}
          {(mode === 'color' || mode === 'grayscale' || mode === 'pixel-exact') && <Toggle label="Drop background" checked={!!opts.removeBackground} onChange={(v) => set({ removeBackground: v })} title="Removes the colour that fills the picture's border, where it touches the border (the same colour inside the artwork stays)" />}
          {(mode === 'color' || mode === 'grayscale') && <Toggle label="Stack colours" checked={opts.method === 'overlap'} onChange={(v) => set({ method: v ? 'overlap' : 'abutting' })} title="Each colour runs under the ones above it: no hairline seams, fewer anchors (Illustrator's Overlapping)" />}
          {(mode === 'color' || mode === 'grayscale') && opts.method !== 'overlap' && <Toggle label="Close gaps" checked={!!opts.fillGaps} onChange={(v) => set({ fillGaps: v })} title="Hairline in each colour so no seams show between shapes" />}
          {inky && <Toggle label="Invert" checked={!!opts.invert} onChange={(v) => set({ invert: v })} />}
          {mode === 'color' && <Toggle label="True colours" checked={opts.trueColors !== false} onChange={(v) => set({ trueColors: v })} title="Each path takes the exact average of the pixels it covers" />}
        </div>
        {(mode === 'color' || inky) && (
          <label className="field-block">
            <span className="prop-label">{inky ? 'Ink colour (optional)' : 'Exact colours (optional)'}</span>
            <input className="opt-input" placeholder="#e11d48, #0f172a — or ⌥-click the picture with the Trace tool" value={o.tracePalette} onChange={(e) => store.setOpts({ tracePalette: e.target.value })} title="Trace with exactly these colours" />
          </label>
        )}
      </Sec>

      <Sec title="Trace">
        <div className="prop-row">
          <span className="prop-label">Result</span>
          <Select value={o.traceOutput} onChange={(v) => store.setOpts({ traceOutput: v })} options={[{ value: 'group', label: 'One group' }, { value: 'ungroup', label: 'Ungrouped' }, { value: 'shapes', label: 'Every shape separate' }]} />
        </div>
        <div className="prop-row">
          <span className="prop-label">Picture after</span>
          <Select value={o.traceAfter} onChange={(v) => store.setOpts({ traceAfter: v })} options={[{ value: 'hide', label: 'Hide it' }, { value: 'keep', label: 'Keep it' }, { value: 'delete', label: 'Delete it' }]} />
        </div>
        <div className="prop-row">
          <button className="btn primary" disabled={!src || !!st.busy} onClick={() => src && void runTrace(src, fullOpts, { after: o.traceAfter, output: o.traceOutput })}>
            <Wand2 size={13} /> Trace image
          </button>
          <button className="btn ghost" onClick={() => traceVisible(fullOpts)} title="Flatten everything visible and trace it">Trace all visible</button>
        </div>
      </Sec>

      {targets.length > 0 && <TraceCleanup targets={targets} />}
    </>
  );
}

function TraceCleanup({ targets }: { targets: Layer[] }) {
  const colors = colorsIn(targets);
  const [last, setLast] = useState<string | null>(null);
  const grouped = store.selectedLayers.some((l) => l.kind === 'group');
  const compound = targets.some((l) => (l.shape?.compoundPoints?.length ?? 0) > 1);
  return (
    <Sec title={`Clean up · ${targets.length} path${targets.length === 1 ? '' : 's'}`}>
      <div className="trace-colors">
        {colors.slice(0, 32).map(({ color, ids }) => (
          <span key={color} className="trace-color">
            <ColorInput value={color} title={`${color} · ${ids.length} path${ids.length === 1 ? '' : 's'} — pick a new colour`} onChange={(c) => recolor(color, c)} />
            <button className="icon-x" title={`Delete every ${color} path`} onClick={() => dropColor(color)}>
              <Trash2 size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="prop-row wrap">
        <button className="btn ghost" disabled={!grouped && !compound} onClick={() => expandTrace({ split: true })} title="Ungroup and split every compound path into one path per separate shape">
          Expand to shapes
        </button>
        <button className="btn ghost" disabled={!grouped} onClick={() => expandTrace({ split: false })} title="Ungroup, keeping one compound path per colour">
          Ungroup
        </button>
        <button className="btn ghost" onClick={() => { const n = mergeByColor(); store.toast(n ? `Merged ${n} paths into their colour` : 'Nothing to merge', n ? 'success' : 'info'); }}>
          Merge by colour
        </button>
        <button className="btn ghost" onClick={() => { const r = simplifyTargets(); setLast(`${r.before.toLocaleString()} → ${r.after.toLocaleString()} anchors`); }}>
          Simplify
        </button>
      </div>
      {last && <div className="hint">{last}</div>}
    </Sec>
  );
}

// ================================================================ Print

const LEVEL_ICON = { error: <XCircle size={13} />, warn: <AlertTriangle size={13} />, info: <Info size={13} /> };

function PrintKit() {
  const s = useStore();
  const doc = store.doc!;
  const [p, setP] = useState<PrintPrefs>(loadPrintPrefs);
  const [sheet, setSheet] = useState('a4');
  const [gutter, setGutter] = useState(6);
  const update = (patch: Partial<PrintPrefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    savePrintPrefs(next);
    // The canvas bleed / safe guides follow
    setLayout({ bleed: Math.round(mmToPx(next.bleedMm, next.ppi)), safe: Math.round(mmToPx(next.safeMm, next.ppi)) });
  };
  const ab = getActiveArtboard(doc);
  const mm = (v: number) => Math.round(pxToMm(v, p.ppi) * 10) / 10;
  const issues = preflight(doc, p);
  const lay = nUpLayout(pxToMm(ab.width, p.ppi), pxToMm(ab.height, p.ppi), SHEETS.find((x) => x.id === sheet)!.w, SHEETS.find((x) => x.id === sheet)!.h, Math.max(gutter, p.bleedMm * 2), 10);
  const a = store.activeLayer;
  const inkColor = a?.kind === 'shape' && a.shape ? (a.shape.fillEnabled ? a.shape.fill : a.shape.stroke) : a?.kind === 'text' && a.text ? a.text.color : s.fg;
  const ink = /^#[0-9a-f]{6}/i.test(inkColor) ? inkCoverage(inkColor) : null;
  const fix = (i: PreflightIssue) => {
    const n = i.fix === 'bleed' ? extendToBleed(i.layerIds, p) : fixHairlines(i.layerIds, p);
    store.toast(n ? `Fixed ${n} object${n === 1 ? '' : 's'}` : 'Nothing could be fixed automatically (rotated or grouped objects)', n ? 'success' : 'info');
  };
  return (
    <>
      <Sec title="Document">
        <div className="prop-row">
          <span className="prop-label">Resolution</span>
          <Select value={p.ppi} onChange={(v) => update({ ppi: v })} options={[{ value: 300, label: '300 ppi (print)' }, { value: 150, label: '150 ppi (posters)' }, { value: 72, label: '72 ppi' }]} />
        </div>
        <div className="hint">“{ab.name}” prints at <b>{mm(ab.width)} × {mm(ab.height)} mm</b> ({(ab.width / p.ppi).toFixed(2)} × {(ab.height / p.ppi).toFixed(2)} in)</div>
        <div className="prop-row">
          <NumberField label="Bleed" value={p.bleedMm} min={0} max={20} step={0.5} unit="mm" onChange={(v) => update({ bleedMm: v })} />
          <NumberField label="Safe" value={p.safeMm} min={0} max={30} step={0.5} unit="mm" onChange={(v) => update({ safeMm: v })} />
        </div>
        <div className="prop-row">
          <Toggle label="CMYK proof" checked={s.proof === 'cmyk'} onChange={(v) => store.set({ proof: v ? 'cmyk' : 'off' })} title="Show colours as they will print" />
          <Toggle label="Gamut warning" checked={s.proof === 'gamut'} onChange={(v) => store.set({ proof: v ? 'gamut' : 'off' })} title="Grey out colours CMYK can't print" />
        </div>
      </Sec>

      <Sec title={`Preflight · ${issues.filter((i) => i.level !== 'info').length ? `${issues.filter((i) => i.level !== 'info').length} to check` : 'ready'}`}>
        {!issues.length && <div className="preflight-ok"><Check size={13} /> No print problems found</div>}
        {issues.map((i) => (
          <div key={i.id} className={`issue ${i.level}`}>
            <span className="issue-icon">{LEVEL_ICON[i.level]}</span>
            <span className="issue-text">
              <b>{i.title}</b> <span className="issue-count">{i.layerIds.length}</span>
              <span>{i.detail}</span>
            </span>
            <span className="issue-actions">
              <button className="btn ghost" onClick={() => store.setSelectedLayers(i.layerIds)}>Select</button>
              {i.fix && <button className="btn ghost" onClick={() => fix(i)}>Fix</button>}
            </span>
          </div>
        ))}
      </Sec>

      <Sec title="Ink">
        {ink ? (
          <div className="ink-row">
            <span className="swatch-dot big" style={{ background: inkColor }} />
            <span className="mono">C {ink.c} · M {ink.m} · Y {ink.y} · K {ink.k}</span>
            <span className={`ink-total ${ink.total > 300 ? 'bad' : ''}`}>{ink.total}%</span>
          </div>
        ) : (
          <div className="hint">Select a shape or text to read its ink</div>
        )}
        <div className="hint">Total ink above 300% can smear. Rich black: 60 / 40 / 40 / 100.</div>
      </Sec>

      <Sec title="Print-ready PDF">
        <div className="prop-row wrap">
          <Toggle label="Crop marks" checked={p.cropMarks} onChange={(v) => update({ cropMarks: v })} />
          <Toggle label="Registration" checked={p.registration} onChange={(v) => update({ registration: v })} />
          <Toggle label="Colour bars" checked={p.colorBars} onChange={(v) => update({ colorBars: v })} />
          <Toggle label="Page info" checked={p.pageInfo} onChange={(v) => update({ pageInfo: v })} />
        </div>
        <div className="prop-row">
          <button className="btn primary" onClick={() => exportPrintPdf(doc, p, 'all')}><FileDown size={13} /> Export print PDF</button>
          <button className="btn ghost" onClick={() => exportPrintPdf(doc, p, 'active')}>This artboard</button>
          <button className="btn ghost" onClick={() => update({ ...DEFAULT_PRINT, ppi: p.ppi })} title="Back to 3 mm bleed with every mark">Reset</button>
        </div>
      </Sec>

      <Sec title="Gang-up sheet (n-up)">
        <div className="prop-row">
          <Select value={sheet} onChange={setSheet} options={SHEETS.map((x) => ({ value: x.id, label: `${x.label} (${x.w} × ${x.h} mm)` }))} />
          <NumberField label="Gap" value={gutter} min={0} max={30} unit="mm" onChange={setGutter} />
        </div>
        <div className="hint">{lay.count ? <>Fits <b>{lay.count}</b> copies ({lay.cols} × {lay.rows}{lay.rotated ? ', turned' : ''}) with crop marks on every cut</> : "The artboard doesn't fit this sheet"}</div>
        <div className="prop-row">
          <button className="btn ghost" disabled={!lay.count} onClick={() => exportGangSheet(doc, p, sheet, gutter)}><FileDown size={13} /> Export sheet PDF</button>
          <button className="btn ghost" onClick={() => exportTiledPdf(doc)} title="Split a big poster across printer pages">Tile poster</button>
        </div>
      </Sec>
    </>
  );
}

// ================================================================ Social

function SocialKit() {
  useStore();
  const doc = store.doc!;
  const [picked, setPicked] = useState<Set<string>>(new Set(CORE_PLATFORMS));
  const [slides, setSlides] = useState(5);
  const [slideSize, setSlideSize] = useState('ig-portrait');
  const [grid, setGrid] = useState('3x3');
  const small = legibility(doc);
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  return (
    <>
      <Sec title="One design → every platform" right={<span className="mode-badge">{picked.size}</span>}>
        <div className="hint">Copies “{getActiveArtboard(doc).name}” onto a new artboard per size. Backgrounds fill each board; the rest scales to fit and stays centred.</div>
        <div className="platform-list">
          {PLATFORM_SIZES.map((p) => (
            <label key={p.id} className={`platform ${picked.has(p.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.label}</span>
              <span className="dim">{p.w}×{p.h}</span>
            </label>
          ))}
        </div>
        <button className="btn primary" disabled={!picked.size} onClick={() => resizeForPlatforms([...picked])}>
          Make {picked.size} size{picked.size === 1 ? '' : 's'}
        </button>
      </Sec>

      <Sec title="Seamless carousel">
        <div className="prop-row">
          <NumberField label="Slides" value={slides} min={2} max={20} onChange={setSlides} />
          <Select value={slideSize} onChange={setSlideSize} options={[{ value: 'ig-portrait', label: '4:5 portrait' }, { value: 'ig-square', label: '1:1 square' }, { value: 'li-square', label: 'LinkedIn 1:1' }]} />
        </div>
        <div className="prop-row">
          <button className="btn ghost" onClick={() => createCarousel(slides, slideSize)}>New carousel</button>
          <button className="btn ghost" onClick={() => exportCarousel()} title="Export the active carousel artboard as numbered slides">Export slides</button>
        </div>
      </Sec>

      <Sec title="Profile grid">
        <div className="prop-row">
          <Select value={grid} onChange={setGrid} options={[{ value: '3x3', label: '3 × 3 tiles' }, { value: '2x3', label: '2 rows × 3' }, { value: '1x3', label: '1 row × 3' }]} />
          <button className="btn ghost" onClick={() => { const [r, c] = grid.split('x').map(Number); exportProfileGrid(r, c); }}>Export tiles</button>
        </div>
        <div className="hint">Numbered in posting order (bottom-right first), so the grid reads right on your profile.</div>
      </Sec>

      <Sec title={`Phone legibility · ${small.length ? `${small.length} small` : 'good'}`}>
        {small.length ? (
          <>
            {small.slice(0, 8).map(({ layer, size, min }) => (
              <div key={layer.id} className="issue warn">
                <span className="issue-icon">{LEVEL_ICON.warn}</span>
                <span className="issue-text"><b>{layer.name}</b><span>{Math.round(size)} px — at least {min} px reads on a phone</span></span>
                <span className="issue-actions"><button className="btn ghost" onClick={() => store.selectLayer(layer.id)}>Select</button></span>
              </div>
            ))}
          </>
        ) : (
          <div className="preflight-ok"><Check size={13} /> Every text reads on a phone</div>
        )}
      </Sec>

      <Sec title="Export">
        <ExportRow />
        <button className="btn ghost" onClick={() => store.setDockTab('grids')}>Safe zones & layout grids…</button>
      </Sec>
    </>
  );
}

// ================================================================ Web & UI

function WebKit() {
  const s = useStore();
  const doc = store.doc!;
  // A report belongs to the layers it was made from; any edit clears it
  const [report, setReport] = useState<{ layers: Layer[]; rows: ContrastRow[] } | null>(null);
  const rows = report && report.layers === doc.layers ? report.rows : null;
  const setRows = (r: ContrastRow[] | null) => setReport(r ? { layers: doc.layers, rows: r } : null);
  const [copied, setCopied] = useState(false);
  const a = store.activeLayer;
  const css = a && a.kind !== 'group' && a.kind !== 'adjustment' ? cssFor(a, doc) : '';
  const failing = rows?.filter((r) => !r.pass) ?? [];
  return (
    <>
      <Sec title="Screens">
        <div className="shape-presets">
          {DEVICES.map((d) => (
            <button key={d.id} className="preset-chip" title={`${d.w} × ${d.h}`} onClick={() => addDevice(d.id)}>{d.label}</button>
          ))}
        </div>
      </Sec>

      <Sec title="Components" right={<ColorInput value={s.fg} title="Brand colour for new components" onChange={(c) => store.set({ fg: c })} />}>
        <div className="component-grid">
          {COMPONENTS.map((c) => (
            <button key={c} className="btn ghost" onClick={() => insertComponent(c)}>{COMPONENT_LABELS[c]}</button>
          ))}
        </div>
        <div className="hint">Live shapes and text: rename, recolour and resize freely. They scale with the screen size.</div>
      </Sec>

      <Sec title="Accessibility">
        <div className="prop-row">
          <button className="btn ghost" onClick={() => setRows(contrastReport(doc))}>Check text contrast</button>
          {failing.length > 0 && <button className="btn primary" onClick={() => { const n = fixContrast(failing); store.toast(`Adjusted ${n} text colour${n === 1 ? '' : 's'} to pass WCAG`, 'success'); setRows(null); }}>Fix {failing.length}</button>}
        </div>
        {rows && !rows.length && <div className="hint">No visible text on the page</div>}
        {rows?.map((r) => (
          <div key={r.layer.id} className={`contrast-row ${r.pass ? 'pass' : 'fail'}`} onClick={() => store.selectLayer(r.layer.id)} title="Select">
            <span className="contrast-sample" style={{ background: r.bg, color: r.fg }}>Aa</span>
            <span className="contrast-name">{r.layer.name}</span>
            <span className="mono">{r.ratio.toFixed(2)}:1</span>
            <span className={`grade ${r.pass ? 'ok' : 'bad'}`}>{r.pass ? r.grade : 'Fail'}</span>
          </div>
        ))}
      </Sec>

      <Sec title="Hand-off" right={css ? (
        <button className="btn ghost" onClick={() => { void navigator.clipboard?.writeText(css); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy CSS'}
        </button>
      ) : undefined}>
        {css ? <pre className="css-out">{css}</pre> : <div className="hint">Select an object to see its CSS</div>}
        <div className="prop-row">
          <button className="btn ghost" onClick={() => { const n = snapSelection(8); store.toast(n ? `Snapped ${n} object${n === 1 ? '' : 's'} to the 8-pt grid` : 'Already on the 8-pt grid', 'info'); }}>Snap to 8 pt</button>
          <button className="btn ghost" onClick={() => exportSelectionAssets()}>Assets @1x @2x @3x</button>
        </div>
      </Sec>

      <Sec title="Export screens">
        <ExportRow scales={[1, 2, 3]} />
      </Sec>
    </>
  );
}

// ================================================================ Video

function VideoKit() {
  const s = useStore();
  return (
    <>
      <Sec title="Frames">
        <div className="shape-presets">
          {FRAMES.map((f) => (
            <button key={f.id} className="preset-chip" title={`${f.w} × ${f.h}`} onClick={() => addFrame(f.id)}>{f.label}</button>
          ))}
        </div>
      </Sec>
      <Sec title="Graphics" right={<ColorInput value={s.fg} title="Accent colour" onChange={(c) => store.set({ fg: c })} />}>
        <div className="component-grid">
          {GRAPHICS.map((g) => (
            <button key={g} className="btn ghost" onClick={() => insertGraphic(g)}>{GRAPHIC_LABELS[g]}</button>
          ))}
        </div>
        <div className="hint">Placed inside the title-safe (80%) and action-safe (90%) areas of the active frame.</div>
      </Sec>
      <Sec title="Overlays for your editor">
        <div className="prop-row">
          <button className="btn primary" onClick={() => exportOverlays('active')}><FileDown size={13} /> This frame (transparent PNG)</button>
          <button className="btn ghost" onClick={() => exportOverlays('all')}>All frames</button>
        </div>
        <div className="hint">Hide the background before exporting to keep only the graphics.</div>
        <button className="btn ghost" onClick={() => store.setDockTab('grids')}>Safe-area grids…</button>
      </Sec>
    </>
  );
}

// ================================================================ Mood board

function MoodKit() {
  useStore();
  const [palette, setPalette] = useState<string[]>([]);
  const [k, setK] = useState(6);
  const [gap, setGap] = useState(2);
  const [note, setNote] = useState('Idea');
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  return (
    <>
      <Sec title="Pictures">
        <button className="btn primary" onClick={async () => { const files = await pickFiles(undefined, true); if (files.length) await addPictures(files); }}>
          <ImagePlus size={13} /> Add pictures…
        </button>
        <div className="hint">Pick many at once; they fill the board in columns.</div>
      </Sec>
      <Sec title="Arrange">
        <Slider label="Gap" value={gap} min={0} max={8} step={0.5} unit="%" onChange={setGap} />
        <div className="prop-row">
          <button className="btn ghost" onClick={() => arrange('masonry', gap)}>Masonry</button>
          <button className="btn ghost" onClick={() => arrange('grid', gap)}>Grid</button>
        </div>
        <div className="hint">Arranges the selection, or everything on the board.</div>
      </Sec>
      <Sec title="Palette">
        <div className="prop-row">
          <NumberField label="Colours" value={k} min={3} max={10} onChange={setK} />
          <button className="btn ghost" onClick={() => setPalette(boardPalette(k))}>Pull palette</button>
        </div>
        {palette.length > 0 && (
          <>
            <div className="swatch-row">
              {palette.map((c) => (
                <button key={c} className="swatch-dot big" style={{ background: c }} title={`${c} — click to use`} onClick={() => { store.set({ fg: c }); store.pushRecentColor(c); void navigator.clipboard?.writeText(c); store.toast(`${c} copied and set as colour`, 'success'); }} />
              ))}
            </div>
            <button className="btn ghost" onClick={() => addPaletteStrip(palette)}>Add to board</button>
          </>
        )}
      </Sec>
      <Sec title="Notes & labels">
        <input className="opt-input wide" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note text" />
        <div className="prop-row">
          {NOTE_COLORS.map((c) => (
            <button key={c} className={`swatch-dot ${noteColor === c ? 'on' : ''}`} style={{ background: c }} title="Note colour" onClick={() => setNoteColor(c)} />
          ))}
        </div>
        <div className="prop-row">
          <button className="btn ghost" onClick={() => addNote(note, noteColor)}>Sticky note</button>
          <button className="btn ghost" onClick={() => addLabel(note)}>Label</button>
        </div>
      </Sec>
      <Sec title="Share">
        <ExportRow which="active" defaultFormat="jpeg" scales={[1, 2]} />
      </Sec>
    </>
  );
}
