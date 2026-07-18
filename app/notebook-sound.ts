type AudioContextClass = typeof AudioContext;
type PenPlayback = "user" | "answer";

export class NotebookSound {
  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private penAudio: HTMLAudioElement | null = null;
  private penPlayback = new Set<PenPlayback>();
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!muted && this.penPlayback.size > 0) this.ensurePenAudio();
    if (!this.penAudio) return;

    if (muted) {
      this.penAudio.pause();
    } else if (this.penPlayback.size > 0) {
      void this.penAudio.play().catch(() => undefined);
    }
  }

  unlock() {
    if (this.muted || typeof window === "undefined") return;
    this.ensurePenAudio();

    const AudioContextConstructor = (window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: AudioContextClass })
        .webkitAudioContext) as AudioContextClass | undefined;

    if (!AudioContextConstructor) return;
    this.context ??= new AudioContextConstructor();
    if (this.context.state === "suspended") void this.context.resume();
  }

  nibDown() {
    const context = this.readyContext();
    if (!context) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(560, now);
    oscillator.frequency.exponentialRampToValueAtTime(250, now + 0.025);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.032);
  }

  startPen(playback: PenPlayback) {
    this.penPlayback.add(playback);
    if (this.muted) return;
    this.unlock();

    const audio = this.penAudio;
    if (!audio || !audio.paused) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }

  stopPen(playback: PenPlayback) {
    this.penPlayback.delete(playback);
    if (!this.penAudio || this.penPlayback.size > 0) return;
    this.penAudio.pause();
    this.penAudio.currentTime = 0;
  }

  listening() {
    this.chime([392, 587], 0.018, 0.19);
  }

  answer() {
    this.chime([523, 659, 784], 0.022, 0.48);
  }

  pageTurn() {
    const context = this.readyContext();
    if (!context) return;

    this.noise ??= createNoiseBuffer(context);
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const now = context.currentTime;

    source.buffer = this.noise;
    source.playbackRate.setValueAtTime(0.65, now);
    source.playbackRate.linearRampToValueAtTime(1.7, now + 0.24);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(850, now);
    filter.frequency.linearRampToValueAtTime(3100, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.026, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    source.connect(filter).connect(gain).connect(context.destination);
    source.start(now, 0, 0.32);
    source.stop(now + 0.32);
  }

  private chime(frequencies: number[], volume: number, duration: number) {
    const context = this.readyContext();
    if (!context) return;

    const now = context.currentTime;
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.075;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    });
  }

  private readyContext() {
    if (this.muted) return null;
    this.unlock();
    return this.context;
  }

  private ensurePenAudio() {
    if (this.penAudio || typeof Audio === "undefined") return;
    const audio = new Audio("/pen.mp3");
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 0.42;
    this.penAudio = audio;
  }
}

function createNoiseBuffer(context: AudioContext) {
  const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
  const channel = buffer.getChannelData(0);
  let lastSample = 0;

  for (let index = 0; index < channel.length; index += 1) {
    const white = Math.random() * 2 - 1;
    lastSample = lastSample * 0.66 + white * 0.34;
    channel[index] = lastSample;
  }

  return buffer;
}
