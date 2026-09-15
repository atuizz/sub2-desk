import { ref } from 'vue';

class AudioManager {
  private ctx: AudioContext | null = null;
  public enabled = ref(true);
  public volume = ref(0.35);

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playBootChord() {
    if (!this.enabled.value) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    // F-major macOS-like rich harmonic chord (F2, C3, F3, A3, C4)
    const freqs = [87.31, 130.81, 174.61, 220.0, 261.63];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = i === 0 ? 'sine' : i < 3 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);

      const amp = 0.15 / (i + 1);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(amp, t + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);

      osc.connect(gain);
      gain.connect(this.output(ctx));

      osc.start(t);
      osc.stop(t + 3.5);
    });
  }

  playClick() {
    if (!this.enabled.value) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.04);

    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(this.output(ctx));

    osc.start(t);
    osc.stop(t + 0.05);
  }

  playCoin() {
    if (!this.enabled.value) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    [987.77, 1318.51].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.09);

      gain.gain.setValueAtTime(0.001, t + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.16, t + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + idx * 0.09 + 0.55);

      osc.connect(gain);
      gain.connect(this.output(ctx));

      osc.start(t + idx * 0.09);
      osc.stop(t + idx * 0.09 + 0.6);
    });
  }

  playError() {
    if (!this.enabled.value) return;
    const ctx = this.initCtx();
    if (!ctx) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.linearRampToValueAtTime(110, t + 0.18);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.connect(gain);
    gain.connect(this.output(ctx));

    osc.start(t);
    osc.stop(t + 0.25);
  }

  private master: GainNode | null = null;
  private output(ctx: AudioContext) {
    if (!this.master) { this.master = ctx.createGain(); this.master.connect(ctx.destination); }
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1, this.volume.value)), ctx.currentTime, 0.02);
    return this.master;
  }
}

export const systemAudio = new AudioManager();
export function useSystemAudio() {
  return systemAudio;
}
