/** Everything is synthesised: no audio files to download. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private noise: AudioBuffer | null = null;
  private clickAcc = 0;
  private birdTimer = 2;

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 18000;
    this.master.connect(this.tone).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Air: a soft, slowly breathing wash.
    const air = this.loop();
    const airLp = ctx.createBiquadFilter();
    airLp.type = 'lowpass';
    airLp.frequency.value = 520;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.05;
    air.connect(airLp).connect(airGain).connect(this.master);
    this.lfo(airGain.gain, 0.07, 0.022);

    // Water lapping at the pier posts.
    const lap = this.loop();
    const lapBp = ctx.createBiquadFilter();
    lapBp.type = 'bandpass';
    lapBp.frequency.value = 900;
    lapBp.Q.value = 0.8;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0.012;
    lap.connect(lapBp).connect(lapGain).connect(this.master);
    this.lfo(lapGain.gain, 0.43, 0.01);
    this.lfo(lapBp.frequency, 0.31, 300);
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 1.5);
    return src;
  }

  private lfo(param: AudioParam, hz: number, depth: number): void {
    const osc = this.ctx!.createOscillator();
    osc.frequency.value = hz;
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    osc.connect(g).connect(param);
    osc.start();
  }

  private burst(freq: number, q: number, gain: number, dur: number, sweepTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  splash(power = 1): void {
    this.burst(1800, 0.6, 0.22 * power, 0.5 + power * 0.25, 500);
    this.burst(5200, 0.9, 0.08 * power, 0.25);
  }

  plop(): void {
    this.burst(700, 2.5, 0.16, 0.16, 260);
  }

  whoosh(): void {
    this.burst(900, 0.7, 0.12, 0.34, 3200);
  }

  snap(): void {
    this.burst(3200, 3, 0.35, 0.07);
  }

  /** Crown cap coming off a bottle. */
  capOff(): void {
    this.burst(4200, 4, 0.2, 0.05);
    this.burst(6500, 0.7, 0.1, 0.5, 3000);
  }

  glug(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(310, t + 0.11);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  lighter(): void {
    this.burst(5200, 5, 0.22, 0.03);
    this.burst(900, 0.5, 0.05, 0.55);
  }

  inhale(): void {
    this.burst(2600, 0.8, 0.045, 1.0, 3600);
  }

  exhale(): void {
    this.burst(1500, 0.5, 0.06, 1.1, 600);
  }

  cough(): void {
    for (let i = 0; i < 3; i++) {
      window.setTimeout(() => this.burst(520 + Math.random() * 200, 0.9, 0.3, 0.16, 260), i * 260 + Math.random() * 60);
    }
  }

  /** 0 = clear, 1 = the world heard through cotton wool. */
  setMuffle(x: number): void {
    if (!this.ctx || !this.tone) return;
    this.tone.frequency.setTargetAtTime(18000 - 14500 * Math.min(1, x), this.ctx.currentTime, 0.3);
  }

  rustle(): void {
    this.burst(4800 + Math.random() * 1500, 1.2, 0.05, 0.09);
  }

  /** Call every frame while the reel is turning; rate is clicks per second. */
  reel(dt: number, rate: number, pitch = 1): void {
    this.clickAcc += dt * rate;
    while (this.clickAcc >= 1) {
      this.clickAcc -= 1;
      this.burst(2400 * pitch, 6, 0.05, 0.022);
    }
  }

  private chirp(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    const out = ctx.createGain();
    out.gain.value = 0.012 + Math.random() * 0.016;
    if (pan) out.connect(pan).connect(this.master);
    else out.connect(this.master);
    const base = 2600 + Math.random() * 2400;
    const notes = 2 + Math.floor(Math.random() * 5);
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < notes; i++) {
      const dur = 0.05 + Math.random() * 0.09;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f = base * (0.85 + Math.random() * 0.4);
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * (0.75 + Math.random() * 0.6), t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur + 0.03 + Math.random() * 0.08;
    }
  }

  update(dt: number): void {
    if (!this.ctx) return;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.chirp();
      this.birdTimer = 1.2 + Math.random() * 5;
    }
  }
}
