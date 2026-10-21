import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Unlink, Trash2, MousePointerClick } from 'lucide-react';
import { store, useStore } from '../core/store';
import { layerSurface } from '../core/render';
import { ctx2d } from '../core/canvas';
import { allSymbols, breakSymbolLink, deleteSymbol, instanceCount, instanceOf, newSymbolFromSelection, placeSymbol, redefineSymbol, renameSymbol, selectInstances, BUILTIN_SYMBOLS } from '../core/symbols';
import type { SymbolDef } from '../core/types';

/** The symbol drawn by the real renderer, fitted into a small square. */
function SymbolThumb({ def }: { def: SymbolDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = ctx2d(c);
    ctx.clearRect(0, 0, c.width, c.height);
    const surf = layerSurface(instanceOf(def, def.width / 2, def.height / 2));
    if (!surf) return;
    const k = Math.min((c.width - 8) / surf.canvas.width, (c.height - 8) / surf.canvas.height, 4);
    const w = surf.canvas.width * k;
    const h = surf.canvas.height * k;
    ctx.drawImage(surf.canvas, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [def]);
  return <canvas ref={ref} width={48} height={48} className="symbol-thumb" />;
}

export function SymbolsPanel() {
  const s = useStore();
  const doc = store.doc;
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!doc) return <div className="panel-empty">No document</div>;
  const symbols = allSymbols(doc);
  const current = s.opts.symbolId ?? doc.symbols?.[doc.symbols.length - 1]?.id ?? BUILTIN_SYMBOLS[0].id;
  const active = store.activeLayer;
  const isBuiltin = (id: string) => BUILTIN_SYMBOLS.some((b) => b.id === id);
  const canRedefine = !!active?.symbol && !!doc.symbols?.some((d) => d.id === active.symbol);
  const linked = store.selectedLayers.some((l) => l.symbol);
  return (
    <div className="properties-panel symbols-panel">
      <div className="panel-section">
        <div className="mini-title">Symbols ({symbols.length})</div>
        <div className="symbol-grid" role="listbox" aria-label="Symbols">
          {symbols.map((d) => (
            <div
              key={d.id}
              role="option"
              aria-selected={d.id === current}
              className={`symbol-cell ${d.id === current ? 'on' : ''}`}
              title={`${d.name} — click to spray with it, double-click to place one${isBuiltin(d.id) ? '' : ', double-click the name to rename'}`}
              onClick={() => store.setOpts({ symbolId: d.id })}
              onDoubleClick={() => placeSymbol(d.id)}
            >
              <SymbolThumb def={d} />
              {renaming === d.id ? (
                <input
                  className="input symbol-name-input"
                  autoFocus
                  defaultValue={d.name}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      renameSymbol(d.id, e.currentTarget.value);
                      setRenaming(null);
                    } else if (e.key === 'Escape') setRenaming(null);
                  }}
                  onBlur={(e) => {
                    renameSymbol(d.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className="symbol-name"
                  onDoubleClick={(e) => {
                    if (isBuiltin(d.id)) return;
                    e.stopPropagation();
                    setRenaming(d.id);
                  }}
                >
                  {d.name}
                </span>
              )}
              <span className="symbol-count">{instanceCount(doc, d.id)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel-section symbol-actions">
        <button className="btn ghost" title="Make the selected shape a symbol (it becomes the first instance)" disabled={active?.kind !== 'shape'} onClick={() => newSymbolFromSelection()}>
          <Plus size={13} /> New Symbol
        </button>
        <button className="btn ghost" title="Place an instance in the middle of the view" onClick={() => placeSymbol(current)}>
          <MousePointerClick size={13} /> Place
        </button>
        <button className="btn ghost" title="Make the selected instance's artwork the symbol; every instance updates" disabled={!canRedefine} onClick={() => redefineSymbol()}>
          <RefreshCw size={13} /> Redefine
        </button>
        <button className="btn ghost" title="Select every instance of this symbol" onClick={() => selectInstances(current)}>
          Select Instances
        </button>
        <button className="btn ghost" title="Turn the selected instances into ordinary shapes" disabled={!linked} onClick={() => breakSymbolLink()}>
          <Unlink size={13} /> Break Link
        </button>
        <button className="btn ghost" title="Delete the symbol (instances stay as ordinary shapes)" disabled={isBuiltin(current)} onClick={() => deleteSymbol(current)}>
          <Trash2 size={13} /> Delete
        </button>
      </div>
      <div className="hint">Edit an instance (points, colour, anything), then Redefine to update them all. The Symbol Sprayer sprays the highlighted symbol.</div>
    </div>
  );
}
