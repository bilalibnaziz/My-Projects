// Web Audio API multitrack mixing, procedural SFX synthesizer, and stereo dB VU meters
import { blockLevel } from './loudness';

const METER_FLOOR = -60; // dBFS at the bottom of every meter

/** Meter bar height 0…1 for a dBFS value (linear in dB from −60 to 0). */
export function meterFraction(dbfs: number): number {
  return Number.isFinite(dbfs) ? Math.max(0, Math.min(1, (dbfs - METER_FLOOR) / -METER_FLOOR)) : 0;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private outputGain: GainNode | null = null; // master → speakers; silenced while exporting
  private captureDest: MediaStreamAudioDestinationNode | null = null;
  private analyserL: AnalyserNode | null = null;
  private analyserR: AnalyserNode | null = null;
  private isMuted: boolean = false;
  private isInitialized: boolean = false;

  private masterLevel = 1;

  // One bus per timeline track (sources → bus → master) so each mixer strip meters its own sound
  private trackBuses: Map<string, { input: GainNode; analyser: AnalyserNode }> = new Map();
  private routedTo: WeakMap<AudioNode, string> = new WeakMap();
  private meterBuf = new Float32Array(2048);

  // Active procedural audio oscillators/nodes
  private activeSources: Set<AudioNode> = new Set();

  init() {
    if (this.isInitialized && this.ctx) return;
    try {
      const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : null;
      if (!AudioCtx || typeof AudioCtx !== 'function') return;
      this.ctx = new AudioCtx();

      // Master bus
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 1.0;

      // Stereo Analysers for VU Meter
      const splitter = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      this.analyserL.fftSize = 2048;
      this.analyserR.fftSize = 2048;

      this.masterGain.connect(splitter);
      splitter.connect(this.analyserL, 0);
      splitter.connect(this.analyserR, 1);

      this.outputGain = this.ctx.createGain();
      this.masterGain.connect(this.outputGain);
      this.outputGain.connect(this.ctx.destination);
      this.isInitialized = true;
    } catch (e) {
      console.warn('AudioContext not available yet:', e);
    }
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMasterVolume(val: number) {
    this.masterLevel = Math.max(0, val);
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterLevel, this.ctx.currentTime);
  }

  setMute(muted: boolean) {
    this.isMuted = muted;
    this.setMasterVolume(this.masterLevel);
  }

  /** The bus a track's sources feed, created on first use. */
  private trackBus(trackId: string) {
    if (!this.ctx || !this.masterGain) return null;
    let bus = this.trackBuses.get(trackId);
    if (!bus) {
      const input = this.ctx.createGain();
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 2048;
      input.connect(analyser);
      input.connect(this.masterGain);
      bus = { input, analyser };
      this.trackBuses.set(trackId, bus);
    }
    return bus;
  }

  /** Connects a source's last node to its track's bus (moving it when the clip changed track). */
  routeToTrack(node: AudioNode, trackId: string) {
    if (this.routedTo.get(node) === trackId) return;
    const bus = this.trackBus(trackId);
    if (!bus) return;
    try {
      node.disconnect();
    } catch {
      // Not connected yet
    }
    node.connect(bus.input);
    this.routedTo.set(node, trackId);
  }

  private level(an: AnalyserNode | null | undefined) {
    if (!an) return { rmsDb: -Infinity, peakDb: -Infinity };
    if (this.meterBuf.length !== an.fftSize) this.meterBuf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(this.meterBuf);
    return blockLevel(this.meterBuf);
  }

  /** Post-fader level of one track (dBFS); −∞ while nothing on it sounds. */
  getTrackLevel(trackId: string): { rmsDb: number; peakDb: number } {
    return this.level(this.trackBuses.get(trackId)?.analyser);
  }

  /** Master bus level per channel (dBFS), measured after the master fader. */
  getMasterLevels() {
    return { left: this.level(this.analyserL), right: this.level(this.analyserR) };
  }

  // Routes an imported <video>/<audio> element through the mixer so track volume, pan and the
  // VU meters apply to it. Returns null without Web Audio (the caller falls back to el.volume).
  attachMediaElement(el: HTMLMediaElement): { gain: GainNode; panner: StereoPannerNode } | null {
    this.init();
    if (!this.ctx || !this.masterGain) return null;
    try {
      const source = this.ctx.createMediaElementSource(el);
      const gain = this.ctx.createGain();
      const panner = this.ctx.createStereoPanner();
      source.connect(gain);
      gain.connect(panner); // panner → track bus is connected by routeToTrack
      return { gain, panner };
    } catch {
      return null;
    }
  }

  // Taps the master bus for the export recorder; while capturing, the speakers are muted
  startCapture(): MediaStream | null {
    this.resume();
    if (!this.ctx || !this.masterGain || !this.outputGain) return null;
    this.captureDest = this.ctx.createMediaStreamDestination();
    this.masterGain.connect(this.captureDest);
    this.outputGain.gain.setValueAtTime(0, this.ctx.currentTime);
    return this.captureDest.stream;
  }

  stopCapture() {
    if (!this.ctx || !this.masterGain || !this.outputGain) return;
    if (this.captureDest) {
      this.masterGain.disconnect(this.captureDest);
      this.captureDest = null;
    }
    this.outputGain.gain.setValueAtTime(1, this.ctx.currentTime);
  }

  // Stereo master meter for the monitors: dBFS RMS, and bar heights on the −60…0 dB scale
  getVUMeterLevels(): { leftDb: number; rightDb: number; leftRms: number; rightRms: number } {
    if (!this.analyserL || !this.analyserR) {
      return { leftDb: METER_FLOOR, rightDb: METER_FLOOR, leftRms: 0, rightRms: 0 };
    }
    const { left, right } = this.getMasterLevels();
    return {
      leftDb: Math.max(METER_FLOOR, left.rmsDb),
      rightDb: Math.max(METER_FLOOR, right.rmsDb),
      leftRms: meterFraction(left.rmsDb),
      rightRms: meterFraction(right.rmsDb),
    };
  }

  // Play procedural SFX (Cinematic Boom, Whoosh Transition, Cyber Glitch, Riser)
  playProceduralSound(type: 'boom' | 'whoosh' | 'glitch' | 'synth-beat' | 'click') {
    this.resume();
    if (!this.ctx || !this.masterGain) return;

    const t = this.ctx.currentTime;

    if (type === 'boom') {
      // Deep sub-bass 808 drop
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, t);
      osc.frequency.exponentialRampToValueAtTime(32, t + 0.8);

      gain.gain.setValueAtTime(0.7, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 1.2);
    } else if (type === 'whoosh') {
      // Filtered noise sweep
      const bufSize = this.ctx.sampleRate * 0.5;
      const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const output = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = buf;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.exponentialRampToValueAtTime(2800, t + 0.25);
      filter.frequency.exponentialRampToValueAtTime(400, t + 0.5);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.01, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);

      whiteNoise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      whiteNoise.start(t);
      whiteNoise.stop(t + 0.5);
    } else if (type === 'glitch') {
      // Fast pitch mod square chirp
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(220, t + 0.05);
      osc.frequency.setValueAtTime(1760, t + 0.1);
      osc.frequency.setValueAtTime(440, t + 0.15);

      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.25);
    } else if (type === 'click') {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, t);
      gain.gain.setValueAtTime(0.15, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.03);
    }
  }

  // Synthesizes a background music beat synced to timeline time
  playTimelineAudioClock(time: number, isPlaying: boolean, trackId?: string) {
    if (!isPlaying) return;
    this.resume();
    if (!this.ctx || !this.masterGain) return;
    const out = (trackId && this.trackBus(trackId)?.input) || this.masterGain;

    // Trigger procedural beat every quarter beat (120 BPM = 0.5s per beat)
    const beatIndex = Math.floor(time * 4);
    const subTime = (time * 4) % 1;

    // Sub-bass kick on beat 0 and beat 2 of each measure
    if (subTime < 0.04) {
      if (beatIndex % 4 === 0) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(110, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(out);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.2);
      } else if (beatIndex % 2 === 0) {
        // Snare / clap
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(320, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.1);
        osc.connect(gain);
        gain.connect(out);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.1);
      }
    }
  }
}

export const audioEngine = new AudioEngine();
