import React, { useEffect, useRef, useState } from 'react';
import { decodeSource, channelsOf } from '../offlineRender';
import { waveformPeaks } from '../loudness';
import { sourceSpan } from '../clipTime';
import type { TimelineClip } from '../types';

const MAX_W = 4096; // Canvas width cap; wider clips are stretched (still one bucket per ~pixel at normal zoom)

/** The sound of a clip's source, drawn over the part of the file the clip uses (reversed clips flipped). */
export const ClipWaveform: React.FC<{ clip: TimelineClip; width: number; height: number }> = ({ clip, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const url = clip.sourceUrl;

  useEffect(() => {
    let live = true;
    if (url && typeof OfflineAudioContext !== 'undefined') decodeSource(url).then((b) => live && setBuf(b));
    return () => {
      live = false;
    };
  }, [url]);

  const w = Math.max(1, Math.min(MAX_W, Math.round(width)));
  const h = Math.max(1, Math.round(height));
  const from = clip.offset;
  const to = clip.offset + sourceSpan(clip);
  const gain = clip.volume;
  const reversed = !!clip.reversed;

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g || !buf) return;
    g.clearRect(0, 0, w, h);
    const peaks = waveformPeaks(channelsOf(buf), buf.sampleRate, from, to, w);
    const mid = h / 2;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let x = 0; x < w; x++) {
      const i = reversed ? w - 1 - x : x;
      const lo = Math.max(-1, peaks[i * 2] * gain);
      const hi = Math.min(1, peaks[i * 2 + 1] * gain);
      const top = mid - hi * mid;
      g.fillRect(x, top, 1, Math.max(1, mid - lo * mid - top));
    }
    c.dataset.ready = '1';
  }, [buf, w, h, from, to, gain, reversed]);

  if (!buf) return null;
  return (
    <canvas
      ref={ref}
      className="fx-clip-waveform"
      width={w}
      height={h}
      style={{ position: 'absolute', left: 0, bottom: 0, width: '100%', height: `${h}px`, pointerEvents: 'none', opacity: clip.muted ? 0.3 : 1 }}
    />
  );
};
