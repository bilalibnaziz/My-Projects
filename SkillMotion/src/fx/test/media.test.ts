import { describe, it, expect, beforeEach } from 'vitest';
import { fxStore } from '../store';
import { containRect, mediaKindOf, clipMediaKind } from '../media';
import { MediaAsset } from '../types';

const footage: MediaAsset = {
  id: 'a_clip',
  name: 'interview.mp4',
  type: 'video',
  mediaKind: 'video',
  url: 'blob:interview',
  duration: 20,
  width: 1920,
  height: 1080,
  category: 'video',
};

const song: MediaAsset = {
  id: 'a_song',
  name: 'song.mp3',
  type: 'audio',
  mediaKind: 'audio',
  url: 'blob:song',
  duration: 30,
  category: 'audio',
};

const clip = (id: string) => fxStore.getState().clips.find((c) => c.id === id)!;

describe('Effects Scale - real media', () => {
  beforeEach(() => {
    fxStore.loadPresetProject('cyberpunk');
  });

  it('recognises media kinds by MIME type or extension', () => {
    expect(mediaKindOf({ type: 'video/quicktime', name: 'a' })).toBe('video');
    expect(mediaKindOf({ type: '', name: 'Take 3.MOV' })).toBe('video');
    expect(mediaKindOf({ type: '', name: 'mix.wav' })).toBe('audio');
    expect(mediaKindOf({ type: 'image/png', name: 'logo' })).toBe('image');
    expect(mediaKindOf({ type: 'application/pdf', name: 'doc.pdf' })).toBeNull();
    expect(clipMediaKind({ sourceUrl: '/samples/portrait.jpg' })).toBe('image');
    expect(clipMediaKind({ sourceUrl: 'blob:x', mediaKind: 'video' })).toBe('video');
  });

  it('fits footage inside the frame without distortion', () => {
    expect(containRect(1080, 1920, 1920, 1080)).toEqual({ x: 656.25, y: 0, w: 607.5, h: 1080 });
    expect(containRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('places imported footage on the main video track with its real length', () => {
    fxStore.importMedia([footage, song]);
    expect(fxStore.getState().mediaAssets.some((a) => a.id === footage.id)).toBe(true);

    const id = fxStore.addAssetClip(footage, undefined, 0)!;
    const c = clip(id);
    expect(c.trackId).toBe('v1');
    expect(c.sourceUrl).toBe('blob:interview');
    expect(c.duration).toBe(20);
    expect(c.sourceDuration).toBe(20);
    expect(fxStore.getState().duration).toBeGreaterThanOrEqual(20);

    const aid = fxStore.addAssetClip(song, 'v1', 0)!; // wrong track type → first audio track
    expect(clip(aid).trackId).toBe('a1');
    expect(clip(aid).type).toBe('audio');
  });

  it('clears a work area that would cut new footage short', () => {
    fxStore.setCurrentTime(0);
    fxStore.setInPoint();
    fxStore.setCurrentTime(5);
    fxStore.setOutPoint();
    fxStore.addAssetClip({ ...footage, duration: 60 }, 'v1', 0);
    expect(fxStore.getState().outPoint).toBeNull();
  });

  it('click-insert never overlaps: it appends after the track when the playhead spot is taken', () => {
    const first = fxStore.addAssetClip(footage, 'v1', 100)!;
    fxStore.setCurrentTime(105);
    const second = fxStore.addAssetClip(footage, 'v1')!;
    expect(clip(second).startTime).toBeGreaterThanOrEqual(clip(first).startTime + clip(first).duration);
  });

  it('cannot trim past either end of the source file', () => {
    const id = fxStore.addAssetClip(footage, 'v1', 0)!;
    fxStore.updateClipTiming(id, { duration: 99 });
    expect(clip(id).duration).toBe(20);
    fxStore.updateClipTiming(id, { offset: 15, duration: 10 });
    expect(clip(id).offset).toBe(15);
    expect(clip(id).duration).toBe(5);
  });

  it('a drag is one undo step that restores the position before the drag', () => {
    const id = fxStore.addAssetClip(footage, 'v1', 0)!;
    fxStore.beginGesture();
    fxStore.updateClipTiming(id, { startTime: 3 });
    fxStore.updateClipTiming(id, { startTime: 7 });
    fxStore.commitGesture();
    expect(clip(id).startTime).toBe(7);
    fxStore.undo();
    expect(clip(id).startTime).toBe(0);
    fxStore.redo();
    expect(clip(id).startTime).toBe(7);
  });

  it('a click without movement adds no undo step', () => {
    const id = fxStore.addAssetClip(footage, 'v1', 0)!;
    fxStore.undo(); // drop the insert
    fxStore.redo();
    expect(clip(id)).toBeTruthy();
    const canUndoBefore = fxStore.getState().canUndo;
    fxStore.beginGesture();
    fxStore.commitGesture();
    expect(fxStore.getState().canUndo).toBe(canUndoBefore);
    fxStore.undo();
    expect(fxStore.getState().clips.some((c) => c.id === id)).toBe(false);
  });

  it('⌘K cuts every clip under the playhead in one undo step', () => {
    fxStore.selectClip(null);
    fxStore.setCurrentTime(2);
    const before = fxStore.getState().clips.length;
    const under = fxStore.getState().clips.filter((c) => 2 > c.startTime && 2 < c.startTime + c.duration).length;
    expect(under).toBeGreaterThan(1);
    fxStore.splitAtPlayhead();
    expect(fxStore.getState().clips.length).toBe(before + under);
    fxStore.undo();
    expect(fxStore.getState().clips.length).toBe(before);
  });

  it('split keeps the source continuous across the cut', () => {
    const id = fxStore.addAssetClip(footage, 'v1', 50)!;
    fxStore.setCurrentTime(58);
    fxStore.splitClipAtPlayhead(id);
    const right = clip(fxStore.getState().selectedClipId!);
    expect(clip(id).duration).toBe(8);
    expect(right.startTime).toBe(58);
    expect(right.offset).toBe(8);
    expect(right.sourceUrl).toBe(footage.url);
  });

  it('the built-in beat only plays under a generated music clip on an audible track', () => {
    const s = fxStore.getState();
    const gen = s.clips.find((c) => c.type === 'audio' && !c.sourceUrl)!;
    const t = gen.startTime + 0.5;
    expect(fxStore.hasGeneratedAudioAt(t)).toBe(true);
    const audioTracks = s.tracks.filter((tr) => tr.type === 'audio').map((tr) => tr.id);
    audioTracks.forEach((id) => fxStore.toggleTrackMute(id));
    expect(fxStore.hasGeneratedAudioAt(t)).toBe(false);
    audioTracks.forEach((id) => fxStore.toggleTrackMute(id));
    expect(fxStore.hasGeneratedAudioAt(9999)).toBe(false);
  });
});
