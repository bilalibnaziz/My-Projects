import React, { useRef, useState } from 'react';
import { 
  FolderPlus, 
  Film, 
  Music, 
  Type, 
  Layers, 
  Sparkles, 
  Plus, 
  Activity, 
  Square,
  Image as ImageIcon
} from 'lucide-react';
import { fxStore, EffectsScaleState } from '../store';
import { MediaAsset } from '../types';
import { probeFiles } from '../media';
import { ASSET_DRAG_TYPE } from './Timeline';

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Picker / drop handler shared with the app-wide file drop
export async function importFiles(files: File[]): Promise<string | null> {
  const { assets, rejected } = await probeFiles(files);
  fxStore.importMedia(assets);
  return rejected.length ? `Couldn't read: ${rejected.join(', ')}` : null;
}

interface MediaBinProps {
  state: EffectsScaleState;
}

export const MediaBin: React.FC<MediaBinProps> = ({ state }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const runImport = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setNotice(await importFiles(files));
    setBusy(false);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    runImport(files);
  };

  const handleInsertAsset = (asset: MediaAsset) => {
    fxStore.addAssetClip(asset);
  };

  return (
    <div
      className={`fx-side-panel ${dropping ? 'fx-bin-drop' : ''}`}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        runImport(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Panel Header */}
      <div className="fx-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Film size={14} style={{ color: '#4daafc' }} />
          <span>Media Bin & Assets</span>
        </div>
        <button
          className="fx-chip-btn"
          onClick={() => fileInputRef.current?.click()}
          style={{ color: '#4daafc', padding: '2px 8px' }}
        >
          <FolderPlus size={12} /> {busy ? 'Reading…' : 'Import'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileUpload}
        />
      </div>

      <div className="fx-panel-content">
        {/* Quick Add Generators Section */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={12} />
            Add Generator to Timeline
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.addNewClip('text', 'v3')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Type size={14} style={{ color: '#f59e0b' }} />
              <span>Kinetic Title</span>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.addNewClip('adjustment', 'v2')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Layers size={14} style={{ color: '#ec4899' }} />
              <span>Adjustment Layer</span>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.addNewClip('shape', 'v2')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Square size={14} style={{ color: '#4daafc' }} />
              <span>Lower Third</span>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.addNewClip('particles', 'v2')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Sparkles size={14} style={{ color: '#a855f7' }} />
              <span>Particles FX</span>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.addNewClip('visualizer', 'v2')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526', gridColumn: 'span 2' }}
            >
              <Activity size={14} style={{ color: '#4daafc' }} />
              <span>Audio Reactive Spectrum</span>
            </button>
          </div>
        </div>

        {/* Project Media Assets List */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8 }}>
            Project Assets ({state.mediaAssets.length})
          </div>
          {notice && (
            <div style={{ fontSize: '11px', color: 'var(--fx-rose)', marginBottom: 6 }}>{notice}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {state.mediaAssets.map((asset) => {
              const kind = asset.mediaKind;
              const color = asset.type === 'audio' ? '#a855f7' : asset.url ? '#4daafc' : '#f59e0b';
              const Icon = kind === 'image' ? ImageIcon : asset.type === 'video' ? Film : asset.type === 'audio' ? Music : Sparkles;
              return (
                <div
                  key={asset.id}
                  className="fx-asset-row"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(ASSET_DRAG_TYPE, asset.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => handleInsertAsset(asset)}
                  title="Click to place at the playhead, or drag onto a track"
                >
                  <div
                    className="fx-asset-thumb"
                    style={asset.thumbnail ? { backgroundImage: `url(${asset.thumbnail})` } : undefined}
                  >
                    {!asset.thumbnail && <Icon size={14} style={{ color }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {asset.name}
                    </div>
                    <div className="fx-asset-meta">
                      {kind === 'image' ? 'Still' : formatDuration(asset.duration)}
                      {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                    </div>
                  </div>
                  <Plus size={12} style={{ color: 'var(--fx-text-muted)', flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* 1-Click Preset Template Sequences */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#9d9d9d', marginBottom: 8 }}>
            Preset Sequences
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.loadPresetProject('cyberpunk')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Sparkles size={14} style={{ color: '#ec4899' }} />
              <div>
                <div style={{ fontWeight: 600, color: '#cccccc' }}>Cyberpunk 2077 Title</div>
                <div style={{ fontSize: '10px', color: '#6e7681' }}>Synthwave grid, glitch & neon bloom</div>
              </div>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.loadPresetProject('cinematic')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Film size={14} style={{ color: '#f59e0b' }} />
              <div>
                <div style={{ fontWeight: 600, color: '#cccccc' }}>Cinematic 35mm Teaser</div>
                <div style={{ fontSize: '10px', color: '#6e7681' }}>2.39:1 Letterbox, grain & Lumetri grade</div>
              </div>
            </button>
            <button
              className="fx-chip-btn"
              onClick={() => fxStore.loadPresetProject('tiktok')}
              style={{ padding: '8px 10px', justifyContent: 'flex-start', background: '#252526' }}
            >
              <Activity size={14} style={{ color: '#4daafc' }} />
              <div>
                <div style={{ fontWeight: 600, color: '#cccccc' }}>TikTok 9:16 Viral Reel</div>
                <div style={{ fontSize: '10px', color: '#6e7681' }}>Vertical layout, bounce pop-in headlines</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
