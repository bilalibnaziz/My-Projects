import React, { useState, useEffect } from 'react';
import { fxStore, EffectsScaleState } from '../store';
import { TopBar } from './TopBar';
import { ProgramMonitor } from './ProgramMonitor';
import { Timeline } from './Timeline';
import { EffectControls } from './EffectControls';
import { MediaBin, importFiles } from './MediaBin';
import { ColorPanel } from './ColorPanel';
import { AudioMixerPanel } from './AudioMixerPanel';
import { DeliverExportModal } from './DeliverExportModal';
import { ShortcutsModal } from './ShortcutsModal';
import './styles.css';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export const EffectsScaleApp: React.FC = () => {
  const [state, setState] = useState<EffectsScaleState>(() => fxStore.getState());
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  useEffect(() => {
    return fxStore.subscribe(() => {
      setState({ ...fxStore.getState() });
    });
  }, []);

  // Native macOS drop bridge
  useEffect(() => {
    (window as any).__skillSuiteOnNativeFileDrop = (files: Array<{ name: string; type: string; base64: string }>) => {
      try {
        const fileObjs: File[] = [];
        for (const f of files) {
          const byteCharacters = atob(f.base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const mime = f.type || (f.name.endsWith('.mp4') ? 'video/mp4' : f.name.endsWith('.png') ? 'image/png' : 'application/octet-stream');
          fileObjs.push(new File([byteArray], f.name, { type: mime }));
        }
        if (fileObjs.length > 0) {
          importFiles(fileObjs);
        }
      } catch (err) {
        console.error('Failed to import native dropped files:', err);
      }
    };
    return () => {
      delete (window as any).__skillSuiteOnNativeFileDrop;
    };
  }, []);

  // Every shortcut listed in the Shortcuts guide
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const s = fxStore.getState();
      let handled = true;

      if (mod && k === 'z') {
        if (e.shiftKey) fxStore.redo();
        else fxStore.undo();
      } else if (mod && k === 'y') fxStore.redo();
      else if (mod && k === 'c') fxStore.copyClip();
      else if (mod && k === 'x') fxStore.cutClip();
      else if (mod && k === 'v') fxStore.pasteClip();
      else if (mod && k === 'k') fxStore.splitAtPlayhead();
      else if (mod && k === 'd') fxStore.duplicateClip();
      else if (mod && k === 'm') setShowExportModal(true);
      else if (mod) handled = false;
      else if (e.key === ' ') fxStore.togglePlay();
      else if (k === 'j' || e.key === 'ArrowLeft') fxStore.stepFrames(e.shiftKey ? -10 : -1);
      else if (k === 'l' || e.key === 'ArrowRight') fxStore.stepFrames(e.shiftKey ? 10 : 1);
      else if (k === 'k') fxStore.pause();
      else if (k === 'i') fxStore.setInPoint();
      else if (k === 'o') fxStore.setOutPoint();
      else if (e.key === 'Home') fxStore.jumpToStart();
      else if (e.key === 'End') fxStore.jumpToEnd();
      else if (k === 'v') fxStore.setActiveTool('select');
      else if (k === 'c') fxStore.setActiveTool('razor');
      else if (k === 'h') fxStore.setActiveTool('hand');
      else if (k === 'm') fxStore.addMarker();
      else if (e.key === '=' || e.key === '+') fxStore.setZoomLevel(s.zoomLevel * 1.25);
      else if (e.key === '-') fxStore.setZoomLevel(s.zoomLevel / 1.25);
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (e.shiftKey) fxStore.rippleDeleteClip();
        else fxStore.deleteClip();
      } else if (e.key === '?') setShowShortcutsModal(true);
      else if (e.key === 'Escape') {
        setShowShortcutsModal(false);
        setShowExportModal(false);
      } else handled = false;

      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      className="fx-app"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        // Files dropped anywhere else land in the media bin
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        importFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {/* Top Header Bar */}
      <TopBar
        workspace={state.workspace}
        projectName={state.projectName}
        resolution={state.resolution}
        fps={state.fps}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        onOpenExport={() => setShowExportModal(true)}
        onOpenShortcuts={() => setShowShortcutsModal(true)}
        onOpenPresetModal={() => fxStore.loadPresetProject('cyberpunk')}
      />

      {/* Main Workspace Body */}
      <div className="fx-workspace-body">
        {/* Left Side: Media Bin & Generator Assets */}
        <MediaBin state={state} />

        {/* Center Stage & Timeline */}
        <div className="fx-main-split">
          <div className="fx-center-stage">
            <ProgramMonitor state={state} />
          </div>

          {/* Bottom: Multi-Track Timeline */}
          <Timeline state={state} />
        </div>

        {/* Right Side: Contextual Inspector based on Workspace */}
        {state.workspace === 'color' ? (
          <ColorPanel state={state} />
        ) : state.workspace === 'audio' ? (
          <AudioMixerPanel state={state} />
        ) : (
          <EffectControls state={state} />
        )}
      </div>

      {/* Modals */}
      {(showExportModal || state.workspace === 'deliver') && (
        <DeliverExportModal
          state={state}
          onClose={() => {
            setShowExportModal(false);
            if (state.workspace === 'deliver') fxStore.setWorkspace('edit');
          }}
        />
      )}

      {showShortcutsModal && (
        <ShortcutsModal onClose={() => setShowShortcutsModal(false)} />
      )}
    </div>
  );
};

export default EffectsScaleApp;
