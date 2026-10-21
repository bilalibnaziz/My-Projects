import React from 'react';
import { X, Keyboard, Command } from 'lucide-react';

interface ShortcutsModalProps {
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Playback & Navigation',
    items: [
      { key: 'Space', desc: 'Play / Pause playback' },
      { key: 'J', desc: 'Step 1 frame backward / Rewind' },
      { key: 'K', desc: 'Stop / Pause playback' },
      { key: 'L', desc: 'Step 1 frame forward / Fast forward' },
      { key: 'I', desc: 'Mark In point' },
      { key: 'O', desc: 'Mark Out point' },
      { key: 'Home', desc: 'Jump to start of timeline' },
      { key: 'End', desc: 'Jump to end of timeline' },
    ],
  },
  {
    title: 'NLE Editing Tools',
    items: [
      { key: 'V', desc: 'Selection Tool' },
      { key: 'C', desc: 'Razor / Split Tool' },
      { key: 'H', desc: 'Hand / Pan Tool' },
      { key: 'Cmd + K', desc: 'Split clip at playhead' },
      { key: 'Backspace / Del', desc: 'Delete selected clip' },
      { key: 'Cmd + D', desc: 'Duplicate selected clip' },
      { key: 'Shift + Del', desc: 'Ripple delete clip' },
    ],
  },
  {
    title: 'Motion & VFX Compositing',
    items: [
      { key: 'Click Stopwatch', desc: 'Toggle property keyframing' },
      { key: 'Click Diamond (◆)', desc: 'Jump playhead to keyframe' },
      { key: 'Graph Editor', desc: 'Toggle Bezier velocity curve' },
      { key: 'Drag Canvas Box', desc: 'Transform position & scale' },
    ],
  },
  {
    title: 'General & History',
    items: [
      { key: 'Cmd + Z', desc: 'Undo last action' },
      { key: 'Cmd + Shift + Z', desc: 'Redo last action' },
      { key: 'Cmd + M', desc: 'Open Export / Deliver dialog' },
      { key: '?', desc: 'Open this shortcuts guide' },
    ],
  },
];

export const ShortcutsModal: React.FC<ShortcutsModalProps> = ({ onClose }) => {
  return (
    <div className="fx-modal-backdrop" onClick={onClose}>
      <div className="fx-modal-window" style={{ width: '640px' }} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="fx-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Keyboard size={18} style={{ color: '#4daafc' }} />
            <span>Skill Motion · Shortcuts Guide</span>
          </div>
          <button className="fx-track-icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="fx-modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title} style={{ background: '#252526', padding: '12px', borderRadius: 8, border: '1px solid var(--fx-border)' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#4daafc', marginBottom: 8 }}>
                  {group.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {group.items.map((item) => (
                    <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: '#cccccc' }}>{item.desc}</span>
                      <kbd
                        style={{
                          background: '#181818',
                          border: '1px solid rgba(255,255,255,0.15)',
                          borderRadius: 4,
                          padding: '2px 6px',
                          fontSize: '10px',
                          fontFamily: 'JetBrains Mono',
                          color: '#4daafc',
                        }}
                      >
                        {item.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="fx-modal-footer">
          <button className="fx-export-btn" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
