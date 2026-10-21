import React from 'react';
import { 
  Film, 
  Sparkles, 
  Palette, 
  Volume2, 
  Download, 
  Undo2, 
  Redo2, 
  HelpCircle,
  FolderOpen
} from 'lucide-react';
import { fxStore, RESOLUTION_PRESETS } from '../store';
import { WorkspaceMode, ResolutionPreset } from '../types';

interface TopBarProps {
  workspace: WorkspaceMode;
  projectName: string;
  resolution: ResolutionPreset;
  fps: number;
  canUndo: boolean;
  canRedo: boolean;
  onOpenExport: () => void;
  onOpenShortcuts: () => void;
  onOpenPresetModal: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  workspace,
  projectName,
  resolution,
  fps,
  canUndo,
  canRedo,
  onOpenExport,
  onOpenShortcuts,
  onOpenPresetModal,
}) => {
  return (
    <header className="fx-topbar">
      {/* Brand & Project Name */}
      <div className="fx-brand-wrap">
        <div className="fx-logo-badge">SM</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="fx-brand-title">Skill Motion</span>
            <span className="fx-brand-tag">2-in-1 Suite</span>
          </div>
          <input
            type="text"
            value={projectName}
            onChange={(e) => fxStore.setProjectName(e.target.value)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9d9d9d',
              fontSize: '11px',
              outline: 'none',
              padding: 0,
              width: '160px',
            }}
          />
        </div>
      </div>

      {/* 2-in-1 Workspace Switcher */}
      <div className="fx-workspaces">
        <button
          className={`fx-workspace-tab ${workspace === 'edit' ? 'active' : ''}`}
          onClick={() => fxStore.setWorkspace('edit')}
          title="Premiere Pro Multi-Track NLE Timeline"
        >
          <Film size={14} />
          Edit
        </button>
        <button
          className={`fx-workspace-tab ${workspace === 'vfx' ? 'active' : ''}`}
          onClick={() => fxStore.setWorkspace('vfx')}
          title="After Effects Motion Graphics & Compositing"
        >
          <Sparkles size={14} />
          Motion & VFX
        </button>
        <button
          className={`fx-workspace-tab ${workspace === 'color' ? 'active' : ''}`}
          onClick={() => fxStore.setWorkspace('color')}
          title="Lumetri 3-Way Color Wheels & Scopes"
        >
          <Palette size={14} />
          Color
        </button>
        <button
          className={`fx-workspace-tab ${workspace === 'audio' ? 'active' : ''}`}
          onClick={() => fxStore.setWorkspace('audio')}
          title="Multitrack Audio Mixer & dB VU Meters"
        >
          <Volume2 size={14} />
          Audio
        </button>
        <button
          className={`fx-workspace-tab ${workspace === 'deliver' ? 'active' : ''}`}
          onClick={() => fxStore.setWorkspace('deliver')}
          title="Render & Export Video"
        >
          <Download size={14} />
          Deliver
        </button>
      </div>

      {/* Quick Settings, Resolution, Undo/Redo & Export */}
      <div className="fx-topbar-actions">
        {/* Preset Projects */}
        <button className="fx-chip-btn" onClick={onOpenPresetModal} title="Load Template Project">
          <FolderOpen size={13} />
          <span>Presets</span>
        </button>

        {/* Resolution Picker */}
        <select
          value={resolution.name}
          onChange={(e) => {
            const found = RESOLUTION_PRESETS.find((p) => p.name === e.target.value);
            if (found) fxStore.setResolution(found);
          }}
          className="fx-chip-btn"
          style={{ background: '#252526', color: '#cccccc', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          {RESOLUTION_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>

        {/* FPS Picker */}
        <select
          value={fps}
          onChange={(e) => fxStore.setFps(Number(e.target.value))}
          className="fx-chip-btn"
          style={{ background: '#252526', color: '#cccccc', border: '1px solid rgba(255,255,255,0.1)', width: '74px' }}
        >
          <option value={24}>24 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>

        {/* Undo / Redo */}
        <button
          className="fx-chip-btn"
          disabled={!canUndo}
          onClick={() => fxStore.undo()}
          style={{ opacity: canUndo ? 1 : 0.4 }}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={13} />
        </button>
        <button
          className="fx-chip-btn"
          disabled={!canRedo}
          onClick={() => fxStore.redo()}
          style={{ opacity: canRedo ? 1 : 0.4 }}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={13} />
        </button>

        {/* Shortcuts */}
        <button className="fx-chip-btn" onClick={onOpenShortcuts} title="Keyboard Shortcuts (?)">
          <HelpCircle size={13} />
        </button>

        {/* Glowing Export Button */}
        <button className="fx-export-btn" onClick={onOpenExport}>
          <Download size={14} />
          Export Video
        </button>
      </div>
    </header>
  );
};
