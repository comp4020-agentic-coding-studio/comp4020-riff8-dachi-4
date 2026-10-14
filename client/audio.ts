// Procedural sound: no audio files, so nothing to license. Three separately
// controlled buses (music, ambience, effects). Ambience follows the world:
// birdsong thins with the land's life, a machine hum rises with every
// running building. Starts only after an explicit click, as browsers require.
export interface Mix {
  music: number;
  ambience: number;
  effects: number;
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];
const MINOR = [0, 3, 5, 7, 10, 12, 15, 17];

export class Sound {
  private ctx: AudioContext | null = null;
  private buses: Record<keyof Mix, GainNode> | null = null;
  private hum: GainNode | null = null;
  private wind: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  life = 100;
  machines = 0;
  stage = 0;
  ended = false;
  private beat = 0;

  get running(): boolean {
    return this.ctx !== null;
  }

  start(mix: Mix): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const mk = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(ctx.destination);
      return g;
    };
    this.buses = { music: mk(mix.music), ambience: mk(mix.ambience), effects: mk(mix.effects) };

    // machine hum: two detuned saws through a low-pass
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    lp.connect(this.hum).connect(this.buses.ambience);
    for (const f of [55, 55.7]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.connect(lp);
      o.start();
    }
    // wind/water: filtered noise, louder when the land is alive
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 0.5;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.02;
    noise.connect(bp).connect(this.wind).connect(this.buses.ambience);
    noise.start();

    this.timer = setInterval(() => this.step(), 400);
  }

  setMix(mix: Mix): void {
    if (!this.buses || !this.ctx) return;
    for (const k of Object.keys(mix) as (keyof Mix)[]) this.buses[k].gain.setTargetAtTime(mix[k], this.ctx.currentTime, 0.05);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
    this.buses = null;
  }

  private tone(freq: number, dur: number, bus: keyof Mix, type: OscillatorType = "sine", vol = 0.2, slide = 0): void {
    if (!this.ctx || !this.buses) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.buses[bus]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private step(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const alive = this.life / 100;
    this.hum?.gain.setTargetAtTime(Math.min(0.12, this.machines * 0.008), t, 0.5);
    this.wind?.gain.setTargetAtTime(this.stage === 0 ? 0.01 + 0.04 * alive : 0.015, t, 0.5);
    // birdsong on Earth, as often as the land can still support it
    if (this.stage === 0 && Math.random() < alive * 0.6) {
      const f = 2200 + Math.random() * 1600;
      this.tone(f, 0.12, "ambience", "sine", 0.05, 600);
      if (Math.random() < 0.5) setTimeout(() => this.tone(f * 1.1, 0.1, "ambience", "sine", 0.04, -400), 140);
    }
    if (this.ended) return;
    // music: a gentle plucked line that thins and slows as the world empties
    this.beat++;
    const density = this.stage === 0 ? 0.35 + 0.5 * alive : 0.25 + 0.25 * alive;
    if (Math.random() < density) {
      const scale = this.stage >= 2 ? MINOR : PENTATONIC;
      const root = [261.6, 220, 196, 174.6, 146.8][this.stage] ?? 220;
      const note = scale[Math.floor(Math.random() * scale.length)];
      this.tone(root * 2 ** (note / 12), 1.2, "music", "triangle", 0.08);
    }
    if (this.beat % 8 === 0) {
      const root = [130.8, 110, 98, 87.3, 73.4][this.stage] ?? 110;
      this.tone(root, 3, "music", "sine", 0.06);
    }
  }

  tap(): void {
    this.tone(330 + Math.random() * 40, 0.06, "effects", "triangle", 0.08);
  }
  harvest(): void {
    this.tone(520 + Math.random() * 80, 0.12, "effects", "triangle", 0.18, 300);
  }
  build(): void {
    this.tone(140, 0.25, "effects", "square", 0.08, -60);
    setTimeout(() => this.tone(220, 0.2, "effects", "triangle", 0.12), 90);
  }
  blast(): void {
    this.tone(70, 0.6, "effects", "sawtooth", 0.2, -50);
    this.tone(45, 0.9, "effects", "square", 0.12, -25);
  }
  /** a god's turn starts: a rising tone */
  ascend(): void {
    this.tone(330, 0.8, "effects", "sine", 0.12, 330);
    setTimeout(() => this.tone(495, 0.6, "effects", "triangle", 0.08, 250), 160);
  }
  /** a Bless laid: a soft shimmer */
  shimmer(): void {
    for (let k = 0; k < 4; k++) setTimeout(() => this.tone(1200 + k * 180, 0.25, "effects", "sine", 0.04), k * 50);
  }
  launch(): void {
    this.tone(220, 0.7, "effects", "triangle", 0.1, 440);
  }
  landing(): void {
    this.tone(440, 0.5, "effects", "sine", 0.07, -200);
  }
  reject(): void {
    this.tone(160, 0.2, "effects", "sawtooth", 0.06, -40);
  }
  boundary(): void {
    for (let k = 0; k < 5; k++) setTimeout(() => this.tone(220 * 2 ** (k / 5), 1.6, "effects", "sine", 0.1), k * 160);
  }
}
