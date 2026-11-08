import { useEffect, useMemo, useRef, useState } from 'react';
import { UiScaleControl } from './Workspace';
import { currentWorkspace } from './layout';
import type { ReactNode } from 'react';
import type { Doc } from '../core/types';
import { X, Link2, Link2Off, Download } from 'lucide-react';
import { store, useStore } from '../core/store';
import * as ops from '../core/ops';
import * as io from '../core/io';
import { renderDocument } from '../core/render';
import type { MultiExportFormatId } from '../core/io';
import { filterById, defaultParams } from '../core/filters';
import { renderSmart } from '../core/smart';
import { contentAwareScale } from '../core/seamCarve';
import { COMMANDS, MENU_ORDER, extraShortcuts, formatKeys } from '../core/commands';
import { canvasToBlob, createCanvas, ctx2d, touch, workingSpace } from '../core/canvas';
import { DEFAULT_SKY, SKY_PRESETS, alphaFromRegion, buildSky, composeSky, type SkyOptions } from '../core/skyReplace';
import { selectSky as selectSkyRegion } from '../core/segment';
import { ColorInput, Select, Slider, Toggle } from './widgets';
import { DOC_PRESETS, SAFE_ZONES, TEMPLATES, newFromTemplate, presetById, safeZoneFor } from '../core/social';
import type { PresetCategory } from '../core/social';
import { DEFAULT_PREFS } from '../core/store';
import type { Prefs, Theme } from '../core/store';
import { ACCENTS } from './theme';
import { ColorPickerDialog } from './ColorPicker';
import { BatchBody } from './ActionsPanel';
import { SelectMaskDialog } from './SelectMaskDialog';
import { LiquifyDialog } from './LiquifyDialog';
import { PlatformPicker, PlatformPreviews, SocialStudioBody } from './SocialStudio';
import { exportForPlatforms } from '../core/socialStudio';
import { transformEach, transformedLayers } from '../core/transformAgain';
import { collectColors, commitRecolor, paletteMap, previewRecolor, recolorTargets, shiftedMap, shuffledMap } from '../core/recolor';
import type { ColorMap } from '../core/recolor';
import { HARMONIES, harmony } from '../core/color';
import type { HarmonyKind } from '../core/color';
import { CURATED_COLOR_THEMES } from '../core/colorHarmonies';

function Modal({ title, children, onClose, onSubmit, footer, wide }: { title: string; children: ReactNode; onClose: () => void; onSubmit?: () => void; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Own the keyboard while open, so Enter/Esc reach this dialog even when no field has focus
  useEffect(() => {
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) el.focus();
  }, []);
  return (
    <div className="overlay" onPointerDown={onClose}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        } else if (e.key === 'Enter' && onSubmit && !e.nativeEvent.isComposing) {
          // Buttons, selects and multi-line fields keep their own Enter behaviour
          const t = e.target as HTMLElement;
          if (t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.tagName === 'SELECT') return;
          e.preventDefault();
          onSubmit();
        }
      }}>
        <div className="modal-head">
          <span>{title}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

const close = () => store.set({ dialog: null });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min = 1, max = 30000, autoFocus }: { value: number; onChange: (v: number) => void; min?: number; max?: number; autoFocus?: boolean }) {
  return (
    <input
      className="input"
      type="number"
      autoFocus={autoFocus}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      onChange={(e) => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || 0)))}
    />
  );
}

// ================================================================ new document

const CATEGORIES: (PresetCategory | 'Templates')[] = ['Social', 'Video', 'Screen', 'Print', 'Packaging', 'Templates'];

function NewDocDialog({ tab }: { tab?: 'presets' | 'templates' }) {
  // Opens on the sizes the current workspace is for
  const first = DOC_PRESETS.find((p) => p.category === currentWorkspace().newCategory) ?? DOC_PRESETS[0];
  const [cat, setCat] = useState<PresetCategory | 'Templates'>(tab === 'templates' ? 'Templates' : first.category);
  const [presetId, setPresetId] = useState<string | null>(first.id);
  const [w, setW] = useState(first.w);
  const [h, setH] = useState(first.h);
  const [bg, setBg] = useState<'white' | 'black' | 'transparent' | 'color'>('white');
  const [bgColor, setBgColor] = useState('#ff6b00');
  const [title, setTitle] = useState('Untitled');
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const preset = presetById(presetId ?? undefined);
  const create = () => {
    if (cat === 'Templates') newFromTemplate(templateId);
    else {
      // Custom sizes still get a zone when they match a platform size
      const zone = preset && preset.w === w && preset.h === h ? preset.safeZone : safeZoneFor(w, h);
      ops.newDocument(w, h, bg === 'color' ? bgColor : bg, title || 'Untitled', zone);
    }
    close();
  };
  const swap = () => {
    setW(h);
    setH(w);
    setPresetId(null);
  };
  return (
    <Modal
      title="New Document"
      wide
      onClose={close}
      onSubmit={create}
      footer={
        <>
          {cat !== 'Templates' && preset?.safeZone && <span className="hint">Shows the {SAFE_ZONES[preset.safeZone].label.toLowerCase()} while you design (View ▸ Safe Zones)</span>}
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={create}>{cat === 'Templates' ? 'Use Template' : 'Create'}</button>
        </>
      }
    >
      <div className="seg">
        {CATEGORIES.map((c) => (
          <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      {cat === 'Templates' ? (
        <div className="template-grid">
          {TEMPLATES.map((t) => {
            const p = presetById(t.preset)!;
            return (
              <button key={t.id} className={`template ${templateId === t.id ? 'active' : ''}`} onClick={() => setTemplateId(t.id)} onDoubleClick={() => { setTemplateId(t.id); newFromTemplate(t.id); close(); }}>
                <span className="template-art" style={{ aspectRatio: `${p.w} / ${p.h}`, background: `linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})` }}>
                  <span className="template-lines" />
                </span>
                <b>{t.label}</b>
                <span className="hint">{p.label} · {p.w}×{p.h}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <>
          <div className="preset-list three">
            {DOC_PRESETS.filter((p) => p.category === cat).map((p) => (
              <button
                key={p.id}
                className={`preset-doc ${presetId === p.id ? 'active' : ''}`}
                onClick={() => {
                  setPresetId(p.id);
                  setW(p.w);
                  setH(p.h);
                  if (title === 'Untitled' || DOC_PRESETS.some((x) => x.label === title)) setTitle(p.label);
                }}
              >
                <span className="preset-box"><span className="preset-shape" style={{ aspectRatio: `${p.w} / ${p.h}`, ...(p.w >= p.h ? { width: 24 } : { height: 24 }) }} /></span>
                <span className="preset-text">
                  <span>{p.label}</span>
                  <span className="hint">{p.w} × {p.h}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="form-grid four">
            <Field label="Name"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Width (px)"><NumInput value={w} onChange={(v) => { setW(v); setPresetId(null); }} /></Field>
            <Field label="Height (px)"><NumInput value={h} onChange={(v) => { setH(v); setPresetId(null); }} /></Field>
            <button className="btn ghost swap-btn" onClick={swap} title="Swap portrait / landscape">⇄ Swap</button>
          </div>
          <div className="props-row">
            <span className="hint">Background</span>
            <div className="seg compact">
              {(['white', 'black', 'transparent', 'color'] as const).map((b) => (
                <button key={b} className={bg === b ? 'active' : ''} onClick={() => setBg(b)}>
                  {b === 'color' ? 'Color' : b[0].toUpperCase() + b.slice(1)}
                </button>
              ))}
            </div>
            {bg === 'color' && <ColorInput value={bgColor} onChange={setBgColor} title="Background color" />}
          </div>
        </>
      )}
    </Modal>
  );
}

// ================================================================ export

const EXPORT_SIZES = [
  { id: 'original', label: 'Original size', width: 0 },
  { id: 'retina', label: 'Retina @2×', width: -2 },
  { id: 'ig', label: 'Instagram / Threads (1080 px wide)', width: 1080 },
  { id: 'social', label: 'X / LinkedIn / Facebook (1200 px)', width: 1200 },
  { id: 'web', label: 'Web (1600 px wide)', width: 1600 },
  { id: 'thumb', label: 'Thumbnail (640 px wide)', width: 640 },
];

/** Export scale in percent for a target width (0 = original, negative = multiplier). */
function sizeToScale(width: number, docWidth: number) {
  if (width === 0) return 100;
  if (width < 0) return -width * 100;
  return Math.round((width / docWidth) * 100000) / 1000;
}

function ExportDialog() {
  const doc = store.doc!;
  const [format, setFormat] = useState<io.ExportFormat | 'psd' | 'tiff' | 'tiff-cmyk' | 'pdf' | 'svg' | 'bmp' | 'ico' | 'png16' | 'tiff16'>('jpeg');
  const [lossless, setLossless] = useState(false);
  const extra = !['jpeg', 'png', 'webp', 'psd'].includes(format);
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(100);
  const [size, setSize] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Other platform sizes, each re-laid out for its platform, exported together in one zip
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [showPlatforms, setShowPlatforms] = useState(false);
  const multi = showPlatforms && platforms.size > 0;
  const rasterFormat = format === 'jpeg' || format === 'webp' ? format : 'png';

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const flat = io.flatten(doc);
      if (extra) {
        const blob = await canvasToBlob(flat, 'image/png');
        if (cancelled) return;
        setSize(null);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        return;
      }
      if (format === 'psd') {
        // Layered file: the size estimate is the real encoded size
        const { psdBytes } = await import('../core/psd');
        const { bytes } = await psdBytes(doc);
        const blob = await canvasToBlob(flat, 'image/png');
        if (cancelled) return;
        setSize(bytes.byteLength);
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        return;
      }
      const s = scale / 100;
      const out = createCanvas(doc.width * s, doc.height * s);
      const ctx = ctx2d(out);
      if (format === 'jpeg') {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, out.width, out.height);
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(flat, 0, 0, out.width, out.height);
      const blob = await canvasToBlob(out, `image/${format}`, quality / 100);
      if (cancelled) return;
      setSize(blob.size);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [format, quality, scale, extra]);

  const limitHit = doc.safeZone === 'yt-thumb' && size !== null && size > 2 * 1024 * 1024;
  const fmt = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(2)} MB` : `${Math.round(b / 1e3)} KB`);
  const doExport = async () => {
    close();
    if (multi) {
      await store.task(`Exporting ${platforms.size + 1} sizes`, () => exportForPlatforms([...platforms], rasterFormat, quality / 100, true));
      return;
    }
    if (format === 'psd') await store.task('Writing PSD', () => io.exportPsd(doc));
    else if (format === 'tiff' || format === 'tiff-cmyk') await store.task('Writing TIFF', () => io.exportTiff(doc, format === 'tiff-cmyk'));
    else if (format === 'png16') await store.task('Writing 16-bit PNG', () => io.exportHighBit(doc, 'png'));
    else if (format === 'tiff16') await store.task('Writing 16-bit TIFF', () => io.exportHighBit(doc, 'tiff'));
    else if (format === 'pdf') await store.task('Writing PDF', () => io.exportPdf(doc, { lossless, quality: quality / 100 }));
    else if (format === 'svg') await store.task('Writing SVG', () => io.exportSvg(doc));
    else if (format === 'bmp') await store.task('Writing BMP', () => io.exportBmp(doc));
    else if (format === 'ico') await store.task('Writing icon', () => io.exportIco(doc));
    else await store.task('Exporting', () => io.exportImage(doc, format, quality / 100, scale / 100, null));
  };
  return (
    <Modal
      title="Export As"
      wide
      onClose={close}
      onSubmit={doExport}
      footer={
        <>
          <span className={`hint ${limitHit ? 'warn-text' : ''}`}>
            {size !== null ? `Estimated file size: ${fmt(size)}` : extra ? '' : 'Estimating…'}
            {limitHit && ` — over YouTube's 2 MB thumbnail limit, lower the quality or use JPEG`}
          </span>
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={() => store.set({ dialog: { type: 'batchExport' } })}>Multi-Format Batch Export…</button>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={doExport}>
            {multi ? `Export ${platforms.size + 1} sizes (zip)` : 'Export'}
          </button>
        </>
      }
    >
      <div className="export-layout">
        <div className="export-preview">{preview && <img src={preview} alt="Export preview" />}</div>
        <div className="export-side">
          <Field label="Format">
            <Select value={format} onChange={setFormat} options={[{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG (lossless, transparency)' }, { value: 'webp', label: 'WebP' }, { value: 'psd', label: 'Photoshop PSD (layers, groups, styles)' }, { value: 'pdf', label: 'PDF' }, { value: 'svg', label: 'SVG (shapes & text stay vector)' }, { value: 'tiff', label: 'TIFF' }, { value: 'png16', label: 'PNG 16-bit' }, { value: 'tiff16', label: 'TIFF 16-bit' }, { value: 'tiff-cmyk', label: 'TIFF CMYK (print, 300 dpi)' }, { value: 'bmp', label: 'BMP' }, { value: 'ico', label: 'Icon .ico (16–256 px)' }]} />
          </Field>
          {format === 'psd' ? (
            <div className="hint">Keeps layers, groups, masks, blend modes, opacity, fill and layer styles. Text and shapes are saved as pixels.</div>
          ) : format === 'pdf' ? (
            <>
              <Toggle label="Lossless (larger file)" checked={lossless} onChange={setLossless} />
              {!lossless && <Slider label="Quality" value={quality} min={1} max={100} def={90} unit="%" onChange={setQuality} />}
              <div className="hint">One page, the size of the document at 72 dpi; transparency is kept.</div>
            </>
          ) : extra ? (
            <div className="hint">
              {format === 'svg' && 'Shape and text layers are written as editable vectors; photos and styled layers as embedded images.'}
              {format === 'tiff' && 'Uncompressed 8-bit RGB with transparency.'}
              {(format === 'png16' || format === 'tiff16') && `16 bits per channel from the ${doc.depth ?? 8}-bit layers, composited in float (no 8-bit rounding).`}
              {format === 'tiff-cmyk' && 'Colour-managed CMYK separation for coated paper, transparency flattened on white.'}
              {format === 'bmp' && '32-bit with transparency.'}
              {format === 'ico' && 'Six sizes from 16 to 256 px in one icon file, for favicons and apps.'}
            </div>
          ) : (
          <>
          <Field label="Size for">
            <Select
              value={EXPORT_SIZES.find((x) => Math.abs(sizeToScale(x.width, doc.width) - scale) < 0.01)?.id ?? 'custom'}
              onChange={(id) => {
                const x = EXPORT_SIZES.find((e) => e.id === id);
                if (x) setScale(sizeToScale(x.width, doc.width));
              }}
              options={[...EXPORT_SIZES.map((x) => ({ value: x.id, label: x.label })), { value: 'custom', label: 'Custom scale' }]}
            />
          </Field>
          {format !== 'png' && <Slider label="Quality" value={quality} min={1} max={100} def={90} unit="%" onChange={setQuality} />}
          <Slider label="Scale" value={scale} min={5} max={400} step={0.1} def={100} unit="%" onChange={setScale} />
          </>
          )}
          <div className="hint">
            Output: {format === 'ico' ? '16–256 × 16–256' : format === 'psd' || extra ? `${doc.width} × ${doc.height}` : `${Math.round((doc.width * scale) / 100)} × ${Math.round((doc.height * scale) / 100)}`} px
          </div>
        </div>
      </div>
      <div className="export-platforms">
        <div className="export-platforms-head">
          <Toggle label="Also export for other platforms" checked={showPlatforms} onChange={setShowPlatforms} />
          {showPlatforms && (
            <span className="hint">
              Each size is laid out for its platform (safe zones, logo corners, side-by-side or stacked) and saved with this one in a zip as {rasterFormat.toUpperCase()}
              {rasterFormat !== format ? ` (${format.toUpperCase()} is for single files)` : ''}.
            </span>
          )}
        </div>
        {showPlatforms && (
          <>
            <PlatformPicker picked={platforms} onChange={setPlatforms} compact />
            <PlatformPreviews doc={doc} ids={[...platforms]} />
          </>
        )}
      </div>
    </Modal>
  );
}

// ================================================================ multi-format batch export

const ALL_BATCH_FORMATS: { id: MultiExportFormatId; label: string; badge: string; desc: string }[] = [
  { id: 'psd', label: 'Photoshop PSD', badge: 'Layers', desc: 'Fully layered Photoshop document with blend modes, opacity, and masks' },
  { id: 'pdf', label: 'Adobe PDF Prepress', badge: 'Print', desc: 'Prepress-ready PDF at 300 DPI for high-end professional printing' },
  { id: 'cmyk-tiff', label: 'CMYK TIFF Separation', badge: 'Offset', desc: 'Commercial offset press separation (Cyan, Magenta, Yellow, Black) at 300 DPI' },
  { id: 'tiff', label: 'Master TIFF RGB', badge: 'Archival', desc: 'Uncompressed 8-bit master raster file with transparent alpha channel' },
  { id: 'png', label: 'Transparent PNG', badge: 'Web / App', desc: 'Lossless web graphics with full alpha transparency support' },
  { id: 'jpeg', label: 'Compressed JPEG', badge: 'Proof / Web', desc: 'Universal compressed image file on pure white background for client proofs' },
  { id: 'webp', label: 'Next-Gen WebP', badge: 'Modern', desc: 'Ultra-lightweight modern web asset format with advanced lossless/lossy compression' },
];

function BatchExportDialog() {
  const doc = store.doc!;
  const [selected, setSelected] = useState<Set<MultiExportFormatId>>(new Set(['psd', 'pdf', 'cmyk-tiff', 'png', 'jpeg']));
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState(92);
  const [asZip, setAsZip] = useState(true);

  const toggle = (id: MultiExportFormatId) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const applyPreset = (preset: 'all' | 'web' | 'print' | 'masters') => {
    if (preset === 'all') setSelected(new Set(ALL_BATCH_FORMATS.map((f) => f.id)));
    else if (preset === 'web') setSelected(new Set(['png', 'jpeg', 'webp']));
    else if (preset === 'print') setSelected(new Set(['pdf', 'cmyk-tiff', 'tiff']));
    else if (preset === 'masters') setSelected(new Set(['psd', 'tiff', 'png']));
  };

  const doExport = async () => {
    if (selected.size === 0) return store.toast('Select at least one format to export', 'info');
    close();
    await store.task(`Batch Exporting (${selected.size} formats)`, () =>
      io.batchExportFormats(doc, {
        formats: Array.from(selected),
        scale,
        quality: quality / 100,
        asZip,
      })
    );
  };

  return (
    <Modal
      title="Multi-Format Batch Export"
      wide
      onClose={close}
      onSubmit={doExport}
      footer={
        <>
          <span className="hint">
            {selected.size} format{selected.size === 1 ? '' : 's'} selected {asZip ? '• bundled in a single ZIP file' : '• saved individually'}
          </span>
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={doExport} disabled={selected.size === 0}>
            <Download size={14} style={{ marginRight: 4 }} />
            Export Selected ({selected.size})
          </button>
        </>
      }
    >
      <div className="mini-title">Quick presets</div>
      <div className="batch-export-presets">
        <button className="btn ghost compact" onClick={() => applyPreset('all')}>All 7 Formats</button>
        <button className="btn ghost compact" onClick={() => applyPreset('print')}>Print &amp; Prepress (PDF, CMYK, TIFF)</button>
        <button className="btn ghost compact" onClick={() => applyPreset('web')}>Web &amp; Digital (PNG, JPG, WebP)</button>
        <button className="btn ghost compact" onClick={() => applyPreset('masters')}>Master Archives (PSD, TIFF, PNG)</button>
      </div>

      <div className="mini-title">Select target output formats</div>
      <div className="batch-formats-grid">
        {ALL_BATCH_FORMATS.map((fmt) => {
          const isSel = selected.has(fmt.id);
          return (
            <div
              key={fmt.id}
              className={`batch-fmt-card ${isSel ? 'selected' : ''}`}
              onClick={() => toggle(fmt.id)}
            >
              <div style={{ display: 'flex', alignItems: 'center', paddingTop: 2 }}>
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(fmt.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="batch-fmt-info">
                <div className="batch-fmt-title">
                  <span>{fmt.label}</span>
                  <span className="batch-fmt-badge">{fmt.badge}</span>
                </div>
                <div className="batch-fmt-desc">{fmt.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mini-title">Packaging &amp; Resolution Options</div>
      <div className="props-row" style={{ gap: 16 }}>
        <Toggle label="Package into single ZIP archive" checked={asZip} onChange={setAsZip} />
        <div style={{ width: 140 }}>
          <Field label="Raster Scale">
            <Select
              value={String(scale)}
              onChange={(v) => setScale(parseFloat(v))}
              options={[
                { value: '1', label: '1x (Original)' },
                { value: '2', label: '2x (HiDPI / Retina)' },
                { value: '3', label: '3x (Mobile @3x)' },
                { value: '4.1667', label: '300 DPI Print' },
              ]}
            />
          </Field>
        </div>
        {(selected.has('jpeg') || selected.has('webp')) && (
          <div style={{ flex: 1, minWidth: 160 }}>
            <Slider label="JPEG / WebP Quality" value={quality} min={10} max={100} def={92} unit="%" onChange={setQuality} />
          </div>
        )}
      </div>
    </Modal>
  );
}

// ================================================================ image & canvas size

function ImageSizeDialog() {
  const doc = store.doc!;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [link, setLink] = useState(true);
  const ratio = doc.width / doc.height;
  const resize = () => {
    close();
    store.task('Resampling', () => ops.imageSize(Math.round(w), Math.round(h)));
  };
  return (
    <Modal
      title="Image Size"
      onClose={close}
      onSubmit={resize}
      footer={
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={resize}>Resize</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Width (px)"><NumInput autoFocus value={w} onChange={(v) => { setW(v); if (link) setH(Math.round(v / ratio)); }} /></Field>
        <button className="icon-btn link-toggle" title={link ? 'Constrain proportions' : 'Free'} onClick={() => setLink(!link)}>{link ? <Link2 size={14} /> : <Link2Off size={14} />}</button>
        <Field label="Height (px)"><NumInput value={h} onChange={(v) => { setH(v); if (link) setW(Math.round(v * ratio)); }} /></Field>
        <Field label="Percent">
          <NumInput value={Math.round((w / doc.width) * 100)} min={1} max={1000} onChange={(p) => { setW(Math.round((doc.width * p) / 100)); setH(Math.round((doc.height * p) / 100)); }} />
        </Field>
      </div>
      <div className="hint">Resamples every layer and mask with high-quality smoothing.</div>
    </Modal>
  );
}

function CanvasSizeDialog() {
  const doc = store.doc!;
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [ax, setAx] = useState(0.5);
  const [ay, setAy] = useState(0.5);
  const [extend, setExtend] = useState(true);
  const apply = () => {
    close();
    ops.canvasSize(Math.round(w), Math.round(h), ax, ay, extend ? store.state.bg : null);
  };
  return (
    <Modal
      title="Canvas Size"
      onClose={close}
      onSubmit={apply}
      footer={
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={apply}>Apply</button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Width (px)"><NumInput autoFocus value={w} onChange={setW} /></Field>
        <Field label="Height (px)"><NumInput value={h} onChange={setH} /></Field>
      </div>
      <div className="anchor-row">
        <span>Anchor</span>
        <div className="anchor-grid">
          {[0, 0.5, 1].map((y) => [0, 0.5, 1].map((x) => (
            <button key={`${x}-${y}`} className={ax === x && ay === y ? 'active' : ''} onClick={() => { setAx(x); setAy(y); }} />
          )))}
        </div>
        <Toggle label="Fill new area of bottom layer with background color" checked={extend} onChange={setExtend} />
      </div>
    </Modal>
  );
}

// ================================================================ content-aware scale

const CAS_RATIOS: { label: string; r: number }[] = [
  { label: '1:1', r: 1 },
  { label: '4:5', r: 4 / 5 },
  { label: '9:16', r: 9 / 16 },
  { label: '16:9', r: 16 / 9 },
  { label: '3:2', r: 3 / 2 },
];

function ContentAwareScaleDialog() {
  const doc = store.doc!;
  const layer = store.activeLayer;
  const src = layer?.kind === 'raster' && !layer.text && !layer.shape ? layer.canvas : undefined;
  const [w, setW] = useState(src?.width ?? doc.width);
  const [h, setH] = useState(src?.height ?? doc.height);
  const [amount, setAmount] = useState(100);
  const [protectSel, setProtectSel] = useState(!!doc.selection);
  const [protectSkin, setProtectSkin] = useState(true);
  const preview = useRef<HTMLCanvasElement>(null);

  // Ratio chips keep the longer side and change the other: a landscape → 9:16 keeps its height
  const toRatio = (r: number) => {
    if (!src) return;
    const sw = src.width, sh = src.height;
    if (sw / sh > r) {
      setW(Math.round(sh * r));
      setH(sh);
    } else {
      setW(sw);
      setH(Math.round(sw / r));
    }
  };

  // Live preview on a small proxy: same algorithm, fast enough to follow the fields
  useEffect(() => {
    const cv = preview.current;
    if (!src || !cv) return;
    const t = setTimeout(() => {
      const k = Math.min(1, 200 / Math.max(src.width, src.height, w, h));
      const pw = Math.max(1, Math.round(src.width * k));
      const ph = Math.max(1, Math.round(src.height * k));
      const small = createCanvas(pw, ph);
      ctx2d(small).drawImage(src, 0, 0, pw, ph);
      const img = ctx2d(small).getImageData(0, 0, pw, ph);
      let protect: Float32Array | undefined;
      if (protectSel && doc.selection && layer) {
        const sc = createCanvas(pw, ph);
        ctx2d(sc).drawImage(doc.selection.canvas, layer.x, layer.y, src.width, src.height, 0, 0, pw, ph);
        const a = ctx2d(sc).getImageData(0, 0, pw, ph).data;
        protect = new Float32Array(pw * ph);
        for (let i = 0; i < protect.length; i++) protect[i] = a[i * 4 + 3] / 255;
      }
      const out = contentAwareScale({ data: img.data, width: pw, height: ph }, Math.max(1, w * k), Math.max(1, h * k), { amount: amount / 100, protect, protectSkin });
      cv.width = out.width;
      cv.height = out.height;
      ctx2d(cv).putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height, { colorSpace: img.colorSpace }), 0, 0);
    }, 120);
    return () => clearTimeout(t);
  }, [src, w, h, amount, protectSel, protectSkin, doc.selection, layer]);

  const apply = () => {
    close();
    void ops.contentAwareScale(Math.round(w), Math.round(h), { amount, protectSelection: protectSel, protectSkin });
  };
  if (!src) {
    return (
      <Modal title="Content-Aware Scale" onClose={close} footer={<button className="btn primary" onClick={close}>OK</button>}>
        <p className="hint">Select a pixel layer (a photo) first. Text, shapes and adjustments can be scaled normally.</p>
      </Modal>
    );
  }
  return (
    <Modal
      title="Content-Aware Scale"
      onClose={close}
      onSubmit={apply}
      footer={
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={apply}>Scale</button>
        </>
      }
    >
      <p className="hint">Changes the shape of the photo by removing or adding low-detail areas (sky, walls, floor), so people and objects aren't squashed.</p>
      <div className="cas-preview" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 210, background: 'var(--bg-2, #1b1b1f)', borderRadius: 6, margin: '8px 0' }}>
        <canvas ref={preview} data-testid="cas-preview" style={{ maxWidth: '100%', maxHeight: 200, imageRendering: 'auto' }} />
      </div>
      <div className="crop-chips">
        {CAS_RATIOS.map((c) => (
          <button key={c.label} className="preset-chip" onClick={() => toRatio(c.r)} title={`Reshape to ${c.label}, keeping the longer side`}>
            {c.label}
          </button>
        ))}
        <button className="preset-chip" onClick={() => { setW(src.width); setH(src.height); }}>Original</button>
      </div>
      <div className="form-grid">
        <Field label="Width (px)"><NumInput autoFocus value={w} onChange={setW} /></Field>
        <Field label="Height (px)"><NumInput value={h} onChange={setH} /></Field>
      </div>
      <Slider label="Amount" value={amount} min={0} max={100} def={100} unit="%" onChange={setAmount} />
      {doc.selection && <Toggle label="Protect the selection" checked={protectSel} onChange={setProtectSel} />}
      <Toggle label="Protect skin tones" checked={protectSkin} onChange={setProtectSkin} />
    </Modal>
  );
}

// ================================================================ sky replacement

/** The picture and its sky mask on a small copy (found once per dialog; options only re-compose). */
function skyBase(doc: Doc) {
  const k = Math.min(1, 420 / Math.max(doc.width, doc.height));
  const w = Math.max(1, Math.round(doc.width * k));
  const h = Math.max(1, Math.round(doc.height * k));
  const full = createCanvas(doc.width, doc.height);
  renderDocument(doc, full);
  const photo = createCanvas(w, h);
  ctx2d(photo).drawImage(full, 0, 0, w, h);
  let alpha: Float32Array | null = null;
  if (doc.selection) {
    const sc = createCanvas(w, h);
    ctx2d(sc).drawImage(doc.selection.canvas, 0, 0, w, h);
    const a = ctx2d(sc).getImageData(0, 0, w, h).data;
    alpha = new Float32Array(w * h);
    for (let i = 0; i < alpha.length; i++) alpha[i] = a[i * 4 + 3] / 255;
  } else {
    const d = ctx2d(photo).getImageData(0, 0, w, h);
    const r = selectSkyRegion({ data: d.data, w, h });
    if (r) alpha = alphaFromRegion(r, w, h);
  }
  if (!alpha || !alpha.some((v) => v > 0.5)) return { ok: false as const, status: 'No sky found here: select the sky first (Select ▸ Sky, or a marquee).' };
  return { ok: true as const, photo, alpha, w, h, k, status: doc.selection ? 'Replacing the selected area.' : 'Sky found automatically.' };
}

function SkyReplaceDialog() {
  const doc = store.doc!;
  const [o, setO] = useState<SkyOptions>(() => ({ ...DEFAULT_SKY }));
  const preview = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = useMemo(() => skyBase(doc), [doc]);
  const set = (patch: Partial<SkyOptions>) => setO((p) => ({ ...p, ...patch }));

  useEffect(() => {
    const cv = preview.current;
    if (!base.ok || !cv) return;
    const t = setTimeout(() => {
      const parts = buildSky(base.alpha, base.w, base.h, o, base.k);
      const out = composeSky(base.photo, parts, o.lighting, base.w, base.h);
      cv.width = base.w;
      cv.height = base.h;
      ctx2d(cv).drawImage(out, 0, 0);
    }, 60);
    return () => clearTimeout(t);
  }, [o, base]);

  const apply = () => {
    if (!base.ok) return;
    close();
    void ops.replaceSky(o);
  };
  const presetId = o.source.kind === 'preset' ? o.source.id : null;
  return (
    <Modal
      title="Sky Replacement"
      wide
      onClose={close}
      onSubmit={apply}
      footer={
        <>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn primary" data-sky-apply onClick={apply} disabled={!base.ok}>Replace Sky</button>
        </>
      }
    >
      <p className="hint" data-sky-status>{base.status} The result is an editable group (Sky with a mask, Foreground Lighting); your photo isn't changed.</p>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, background: 'var(--bg-2, #1b1b1f)', borderRadius: 6, margin: '8px 0' }}>
        <canvas ref={preview} data-testid="sky-preview" style={{ maxWidth: '100%', maxHeight: 300 }} />
      </div>
      <div className="crop-chips">
        {SKY_PRESETS.map((p) => (
          <button key={p.id} className={`preset-chip ${presetId === p.id ? 'active' : ''}`} data-sky-preset={p.id} onClick={() => set({ source: { kind: 'preset', id: p.id } })} style={{ background: `linear-gradient(${p.zenith}, ${p.horizon})`, color: '#fff', textShadow: '0 1px 2px #000' }}>
            {p.label}
          </button>
        ))}
        <button className={`preset-chip ${o.source.kind === 'image' ? 'active' : ''}`} onClick={() => fileRef.current?.click()} title="Use a photo of a sky">
          Your image…
        </button>
        <button className="preset-chip" onClick={() => set({ seed: o.seed + 1 })} title="Other clouds / stars" disabled={o.source.kind !== 'preset'}>
          New clouds
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          data-sky-file
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) set({ source: { kind: 'image', canvas: await io.fileToCanvas(f, workingSpace()) } });
          }}
        />
      </div>
      <Slider label="Shift Edge" value={o.shiftEdge} min={-50} max={50} def={0} unit=" px" onChange={(v) => set({ shiftEdge: v })} />
      <Slider label="Fade Edge" value={o.fadeEdge} min={0} max={100} def={4} unit=" px" onChange={(v) => set({ fadeEdge: v })} />
      <Slider label="Sky Brightness" value={o.brightness} min={-100} max={100} def={0} onChange={(v) => set({ brightness: v })} />
      <Slider label="Sky Temperature" value={o.temperature} min={-100} max={100} def={0} onChange={(v) => set({ temperature: v })} />
      <Slider label="Foreground Lighting" value={o.lighting} min={0} max={100} def={40} unit="%" onChange={(v) => set({ lighting: v })} />
    </Modal>
  );
}

// ================================================================ filters (live preview)

function FilterDialog({ filterId, smartIndex, initial }: { filterId: string; smartIndex?: number; initial?: Record<string, number> }) {
  const f = filterById(filterId)!;
  const [params, setParams] = useState(() => ({ ...defaultParams(f), ...initial }));
  /** Smart objects: the filter list this dialog would produce (new filter added, or one edited). */
  const smartList = (p: Record<string, number>) => {
    const sm = layerRef.current?.smart;
    if (!sm || store.doc?.selection) return null;
    const entry = { id: filterId, params: { ...p }, enabled: true };
    return smartIndex !== undefined ? sm.filters.map((x, i) => (i === smartIndex ? { ...x, params: { ...p } } : x)) : [...sm.filters, entry];
  };
  const [previewOn, setPreviewOn] = useState(true);
  const [working, setWorking] = useState(false);
  const layerRef = useRef(store.activeLayer);

  useEffect(() => {
    const layer = layerRef.current;
    const doc = store.doc;
    if (!layer || !doc) return;
    if (!previewOn) {
      store.overrides.delete(layer.id);
      store.requestRender();
      return;
    }
    setWorking(true);
    const t = setTimeout(() => {
      const list = smartList(params);
      if (list && layer.smart) {
        const r = renderSmart(layer.smart, layer.x, layer.y, list);
        touch(r.canvas);
        store.overrides.set(layer.id, r);
        store.requestRender();
        setWorking(false);
        return;
      }
      const out = ops.applyFilterToLayer(layer, doc.selection, filterId, params);
      if (out) {
        touch(out);
        store.overrides.set(layer.id, { canvas: out, x: layer.x, y: layer.y });
        store.requestRender();
      }
      setWorking(false);
    }, 120);
    return () => clearTimeout(t);
  }, [params, previewOn]);

  const cancel = () => {
    store.overrides.clear();
    store.requestRender();
    close();
  };
  const apply = () => {
    close();
    const layer = layerRef.current;
    if (smartIndex !== undefined && layer) {
      store.overrides.clear();
      ops.setSmartFilters(layer.id, smartList(params) ?? [], `Edit Smart Filter: ${f.name}`);
    } else ops.commitFilter(filterId, params);
  };
  return (
    <Modal
      title={f.name}
      onClose={cancel}
      onSubmit={apply}
      footer={
        <>
          <Toggle label="Preview" checked={previewOn} onChange={setPreviewOn} />
          {working && <span className="hint">Rendering…</span>}
          <div className="opt-spacer" />
          <button className="btn ghost" onClick={cancel}>Cancel</button>
          <button className="btn primary" onClick={apply}>Apply</button>
        </>
      }
    >
      {f.params.map((p) =>
        p.max === 1 && p.step === 1 ? (
          <Toggle key={p.key} label={p.label} checked={!!params[p.key]} onChange={(v) => setParams({ ...params, [p.key]: v ? 1 : 0 })} />
        ) : (
          <Slider key={p.key} label={p.label} value={params[p.key]} min={p.min} max={p.max} step={p.step ?? 1} def={p.default} unit={p.unit === '%' || p.unit === '°' ? p.unit : p.unit ? ` ${p.unit}` : ''} onChange={(v) => setParams({ ...params, [p.key]: v })} />
        )
      )}
      <div className="hint">{store.doc?.selection ? 'Applies inside the selection.' : 'Applies to the whole active layer.'} Tip: duplicate the layer first to blend the effect.</div>
    </Modal>
  );
}

// ================================================================ number prompt

function NumberDialog({ d }: { d: Extract<NonNullable<ReturnType<typeof useStore>['dialog']>, { type: 'number' }> }) {
  const [v, setV] = useState(d.value);
  const ok = () => {
    close();
    // Typed values can be out of range or empty; clamp to what the command accepts
    d.onOk(Math.max(d.min, Math.min(d.max, Number.isFinite(v) ? v : d.value)));
  };
  return (
    <Modal title={d.title} onClose={close} onSubmit={ok} footer={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={ok}>OK</button></>}>
      <div className="form-grid">
        <Field label={`${d.label}${d.unit ? ` (${d.unit})` : ''}`}>
          <input className="input" type="number" autoFocus value={Number.isFinite(v) ? v : ''} min={d.min} max={d.max} onChange={(e) => setV(parseFloat(e.target.value))} />
        </Field>
      </div>
    </Modal>
  );
}

// ================================================================ shortcuts & about

function ShortcutsDialog() {
  const extra = extraShortcuts();
  return (
    <Modal title="Keyboard Shortcuts" wide onClose={close}>
      <div className="shortcut-cols">
        <div>
          {MENU_ORDER.map((menu) => {
            const items = COMMANDS.filter((c) => c.keys && c.menu === menu);
            if (!items.length) return null;
            return (
              <div key={menu}>
                <div className="shortcut-group">{menu}</div>
                {items.map((c) => (
                  <div key={c.id} className="shortcut-row">
                    <span>{c.label}</span>
                    <kbd className="kbd">{formatKeys(c.keys)}</kbd>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div>
          <div className="shortcut-group">Tools, brush &amp; pointer</div>
          {extra.map(([k, v]) => (
            <div key={k} className="shortcut-row">
              <span>{v}</span>
              <kbd className="kbd">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
      <div className="hint">
        Printable guide: <a href="/Skill-Photo-Shortcuts-Guide.pdf" target="_blank" rel="noreferrer">Skill-Photo-Shortcuts-Guide.pdf</a>
      </div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="About Skill Photo" onClose={close}>
      <p className="about">
        <b>Skill Photo 3</b> — a non-destructive photo editor. GPU develop engine (WebGL2), maskable adjustment layers, content-aware fill (multi-scale PatchMatch),
        pressure-sensitive brushes, and a command palette for everything.
      </p>
    </Modal>
  );
}

// ================================================================ preferences

const THEMES: { id: Theme; label: string; colors: [string, string, string] }[] = [
  { id: 'vscode', label: 'VS Code Dark', colors: ['#181818', '#1f1f1f', '#313131'] },
  { id: 'dark', label: 'Graphite', colors: ['#0f0f12', '#17171b', '#24242a'] },
  { id: 'midnight', label: 'Midnight', colors: ['#05070d', '#0b1020', '#151c33'] },
  { id: 'light', label: 'Light', colors: ['#e9e9ee', '#f7f7f9', '#ffffff'] },
];

function PreferencesDialog() {
  const s = useStore();
  const p = s.prefs;
  const up = (patch: Partial<Prefs>) => store.set({ prefs: { ...p, ...patch } });
  return (
    <Modal title="Preferences" onClose={close} onSubmit={close} footer={<><button className="btn ghost" onClick={() => store.set({ prefs: { ...DEFAULT_PREFS } })}>Reset</button><div className="opt-spacer" /><button className="btn primary" onClick={close}>Done</button></>}>
      <div className="mini-title">Interface theme</div>
      <div className="theme-row">
        {THEMES.map((t) => (
          <button key={t.id} className={`theme-card ${p.theme === t.id ? 'active' : ''}`} onClick={() => up({ theme: t.id })}>
            <span className="theme-art" style={{ background: t.colors[0] }}>
              <span style={{ background: t.colors[1] }} />
              <span style={{ background: t.colors[2] }} />
              <i style={{ background: p.accent }} />
            </span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mini-title">Accent color</div>
      <div className="props-row">
        {ACCENTS.map((a) => (
          <button key={a} className={`accent-dot ${p.accent.toLowerCase() === a ? 'active' : ''}`} style={{ background: a }} title={a} aria-label={`Accent ${a}`} onClick={() => up({ accent: a })} />
        ))}
        <ColorInput value={p.accent} onChange={(v) => up({ accent: v })} title="Custom accent" />
      </div>
      <div className="mini-title">Interface size (menus, panels and text — the canvas zoom is separate)</div>
      <UiScaleControl />
      <div className="mini-title">Pasteboard (around the canvas)</div>
      <div className="seg compact">
        {(['theme', 'black', 'dark', 'mid', 'light'] as const).map((b) => (
          <button key={b} className={p.pasteboard === b ? 'active' : ''} onClick={() => up({ pasteboard: b })}>
            {b === 'theme' ? 'Match theme' : b === 'mid' ? 'Medium gray' : b[0].toUpperCase() + b.slice(1)}
          </button>
        ))}
      </div>
      <div className="hint">A neutral gray pasteboard makes it easier to judge color and contrast.</div>
    </Modal>
  );
}

// ================================================================ transform each

function TransformEachDialog() {
  const [v, setV] = useState({ sx: 100, sy: 100, dx: 0, dy: 0, rot: 0, uniform: true, random: false, preview: true });
  const delta = (copy: boolean) => ({ sx: v.sx / 100, sy: (v.uniform ? v.sx : v.sy) / 100, dx: v.dx, dy: v.dy, rot: v.rot, copy });
  const ids = useRef(store.selectedLayers.map((l) => l.id));
  // Live preview of the result (not an undo step until OK)
  useEffect(() => {
    store.revert();
    store.setSelectedLayers(ids.current);
    const doc = store.doc;
    if (!doc || !v.preview || v.random) return;
    const layers = transformedLayers(doc.layers, store.selectedLayers, { ...delta(false), each: true });
    if (layers) store.live({ layers });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  const finish = (copy: boolean) => {
    store.revert();
    store.setSelectedLayers(ids.current);
    close();
    transformEach(delta(copy), v.random);
  };
  const cancel = () => {
    store.revert();
    store.setSelectedLayers(ids.current);
    close();
  };
  const num = (k: 'sx' | 'sy' | 'dx' | 'dy' | 'rot', label: string, unit: string, disabled = false) => (
    <Field label={`${label} (${unit})`}>
      <input className="input" type="number" disabled={disabled} value={v[k]} onChange={(e) => setV({ ...v, [k]: parseFloat(e.target.value) || 0 })} aria-label={label} />
    </Field>
  );
  return (
    <Modal
      title="Transform Each"
      onClose={cancel}
      onSubmit={() => finish(false)}
      footer={
        <>
          <button className="btn ghost" onClick={cancel}>Cancel</button>
          <button className="btn ghost" onClick={() => finish(true)}>Copy</button>
          <button className="btn primary" onClick={() => finish(false)}>OK</button>
        </>
      }
    >
      <div className="form-grid">
        {num('sx', v.uniform ? 'Scale' : 'Scale horizontal', '%')}
        {num('sy', 'Scale vertical', '%', v.uniform)}
        {num('dx', 'Move horizontal', 'px')}
        {num('dy', 'Move vertical', 'px')}
        {num('rot', 'Rotate', '°')}
      </div>
      <div className="graph-dialog-toggles">
        <Toggle checked={v.uniform} onChange={(uniform) => setV({ ...v, uniform })} label="Uniform scale" />
        <Toggle checked={v.random} onChange={(random) => setV({ ...v, random })} label="Random (each object gets 0…100% of the values)" />
        <Toggle checked={v.preview} onChange={(preview) => setV({ ...v, preview })} label="Preview" />
      </div>
      <div className="hint">Each object turns and scales about its own centre. ⌘D repeats it.</div>
    </Modal>
  );
}

// ================================================================ recolor artwork

function RecolorDialog({ ids }: { ids: string[] }) {
  const doc = store.doc!;
  const base = doc.history[doc.hIndex].layers;
  const [colors] = useState(() => collectColors(recolorTargets(base, base.filter((l) => ids.includes(l.id)))).map((c) => c.hex));
  const [map, setMap] = useState<ColorMap>(() => Object.fromEntries(colors.map((c) => [c, c])));
  const [hsb, setHsb] = useState({ h: 0, s: 0, b: 0 });
  const [palette, setPalette] = useState('');
  useEffect(() => {
    previewRecolor(map, ids);
  }, [map, ids]);
  const ok = () => {
    close();
    commitRecolor(map, ids);
  };
  const cancel = () => {
    store.revert();
    close();
  };
  const shift = (next: { h: number; s: number; b: number }) => {
    setHsb(next);
    setMap(shiftedMap(colors, next.h, next.s, next.b));
  };
  const palettes = [
    ...HARMONIES.map((h) => ({ value: `h:${h.id}`, label: `Harmony · ${h.label}` })),
    ...CURATED_COLOR_THEMES.map((t) => ({ value: `t:${t.id}`, label: `${t.category} · ${t.name}` })),
  ];
  const applyPalette = (id: string) => {
    setPalette(id);
    const pal = id.startsWith('h:') ? harmony(colors[0] ?? '#3b82f6', id.slice(2) as HarmonyKind) : CURATED_COLOR_THEMES.find((t) => t.id === id.slice(2))?.colors ?? [];
    setMap(paletteMap(colors, pal));
  };
  if (!colors.length) {
    return (
      <Modal title="Recolor Artwork" onClose={cancel}>
        <div className="hint">The selection has no colours to edit. Select shapes or text.</div>
      </Modal>
    );
  }
  return (
    <Modal
      title="Recolor Artwork"
      wide
      onClose={cancel}
      onSubmit={ok}
      footer={
        <>
          <button className="btn ghost" onClick={() => { setHsb({ h: 0, s: 0, b: 0 }); setPalette(''); setMap(Object.fromEntries(colors.map((c) => [c, c]))); }}>Reset</button>
          <button className="btn ghost" onClick={cancel}>Cancel</button>
          <button className="btn primary" onClick={ok}>OK</button>
        </>
      }
    >
      <div className="recolor">
        <div className="recolor-list" aria-label="Colour map">
          {colors.map((c) => (
            <div key={c} className="recolor-row">
              <span className="recolor-swatch" style={{ background: c }} title={c} />
              <span className="recolor-arrow">→</span>
              <ColorInput value={map[c] ?? c} title={`New colour for ${c}`} onChange={(v) => setMap({ ...map, [c]: v })} />
              <span className="recolor-hex">{map[c] ?? c}</span>
            </div>
          ))}
        </div>
        <div className="recolor-controls">
          <Slider label="Hue" min={-180} max={180} value={hsb.h} onChange={(h) => shift({ ...hsb, h })} />
          <Slider label="Saturation" min={-100} max={100} value={hsb.s} onChange={(s2) => shift({ ...hsb, s: s2 })} />
          <Slider label="Brightness" min={-100} max={100} value={hsb.b} onChange={(b2) => shift({ ...hsb, b: b2 })} />
          <Field label="Palette (matched by lightness)">
            <Select value={palette} options={[{ value: '', label: 'Choose a palette…' }, ...palettes]} onChange={(id) => id && applyPalette(id)} />
          </Field>
          <button className="btn ghost" onClick={() => setMap(shuffledMap(colors, map))}>Shuffle colours</button>
          <div className="hint">{colors.length} colour{colors.length === 1 ? '' : 's'} in the selection: fills, strokes, gradient stops, mesh points and text.</div>
        </div>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const s = useStore();
  const d = s.dialog;
  if (!d) return null;
  if (d.type !== 'new' && d.type !== 'shortcuts' && d.type !== 'about' && d.type !== 'preferences' && d.type !== 'colorPicker' && d.type !== 'batch' && !store.doc) return null;
  switch (d.type) {
    case 'new':
      return <NewDocDialog key={d.tab ?? 'presets'} tab={d.tab} />;
    case 'export':
      return <ExportDialog />;
    case 'batchExport':
      return <BatchExportDialog />;
    case 'imageSize':
      return <ImageSizeDialog />;
    case 'canvasSize':
      return <CanvasSizeDialog />;
    case 'contentAwareScale':
      return <ContentAwareScaleDialog />;
    case 'skyReplace':
      return <SkyReplaceDialog />;
    case 'filter':
      return <FilterDialog filterId={d.filterId} smartIndex={d.smartIndex} initial={d.params} />;
    case 'number':
      return <NumberDialog d={d} />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'preferences':
      return <PreferencesDialog />;
    case 'layerStyle':
      return null; // floating panel, rendered over the canvas by App
    case 'colorPicker':
      return <ColorPickerDialog key={d.target} target={d.target} />;
    case 'liquify':
      return <LiquifyDialog />;
    case 'socialStudio':
      return (
        <Modal title="Social Studio" wide onClose={close}>
          <SocialStudioBody onDone={close} />
        </Modal>
      );
    case 'transformEach':
      return <TransformEachDialog />;
    case 'recolor':
      return <RecolorDialog ids={d.ids} />;
    case 'selectMask':
      return <SelectMaskDialog />;
    case 'batch':
      return (
        <Modal title="Batch" onClose={close}>
          <BatchBody actionId={d.actionId} onDone={close} />
        </Modal>
      );
  }
}
