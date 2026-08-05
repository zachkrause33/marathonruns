/**
 * Procedural audio. Every sound is synthesised from oscillators and noise at
 * runtime -- no samples, which keeps the single-file promise intact.
 *
 * The mix is built around the streak: the clean-gate blip rises in pitch as
 * the streak grows, so the player hears their pace improving before they read
 * it on the HUD. Breaking the streak drops it back to the bottom of the
 * scale, which is a far faster signal than any number.
 *
 * Browsers require a user gesture before audio starts, so everything is
 * routed through a context that stays suspended until `unlock()`.
 */
MR.Audio = (function () {

  function create() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return { unlock() {}, enabled: false, footstep() {}, jump() {}, land() {}, hit() {}, clean() {}, mile() {}, finish() {}, setIntensity() {}, ambient() {} };

    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // Gentle limiter so stacked hits never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 7;
    comp.connect(master);

    const s = { ctx, enabled: true, muted: false, started: false };

    // ---- shared noise buffer -------------------------------------------
    const noiseBuf = (function () {
      const n = ctx.sampleRate * 1.2;
      const b = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();

    function noise(dur, freq, q, gain, type) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q || 1;
      const g = ctx.createGain();
      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(comp);
      src.start(t); src.stop(t + dur + 0.02);
      return { f, g, t };
    }

    function tone(freq, dur, gain, type, glideTo) {
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      const g = ctx.createGain();
      const t = ctx.currentTime;
      o.frequency.setValueAtTime(freq, t);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(comp);
      o.start(t); o.stop(t + dur + 0.02);
      return { o, g, t };
    }

    // ---- ambience -------------------------------------------------------
    let amb = null;
    function ambient() {
      if (amb) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 620; f.Q.value = 0.55;
      const g = ctx.createGain(); g.gain.value = 0.035;
      src.connect(f); f.connect(g); g.connect(comp);
      src.start();
      amb = { src, f, g };
    }

    /** Crowd swells with pace and with the streak. */
    s.setIntensity = function (x) {
      if (!amb) return;
      const t = ctx.currentTime;
      amb.g.gain.setTargetAtTime(0.028 + 0.055 * x, t, 0.4);
      amb.f.frequency.setTargetAtTime(560 + 340 * x, t, 0.6);
    };

    // ---- one-shots ------------------------------------------------------
    let stepFlip = 0;
    s.footstep = function (power) {
      const p = power === undefined ? 1 : power;
      stepFlip ^= 1;
      noise(0.075, stepFlip ? 240 : 300, 1.5, 0.16 * p, 'bandpass');
      tone(stepFlip ? 74 : 66, 0.07, 0.10 * p, 'sine');
    };

    s.jump = function () {
      noise(0.26, 900, 0.8, 0.10, 'bandpass');
      tone(300, 0.24, 0.09, 'triangle', 700);
    };

    s.land = function () {
      noise(0.11, 190, 1.2, 0.20, 'lowpass');
      tone(96, 0.13, 0.13, 'sine', 62);
    };

    s.duck = function () {
      noise(0.16, 520, 1.1, 0.07, 'bandpass');
    };

    s.hit = function () {
      noise(0.34, 150, 0.7, 0.34, 'lowpass');
      tone(150, 0.32, 0.20, 'square', 58);
      tone(96, 0.40, 0.14, 'sawtooth', 44);
    };

    /** Rises across roughly three octaves as the streak builds. */
    s.clean = function (streak) {
      const step = Math.min(1, (streak || 0) / 90);
      const base = 520 * Math.pow(2, step * 1.6);
      tone(base, 0.075, 0.055, 'triangle');
      if (streak && streak % 25 === 0) tone(base * 1.5, 0.16, 0.06, 'sine');
    };

    s.mile = function (mile) {
      tone(660, 0.5, 0.10, 'sine');
      tone(990, 0.55, 0.06, 'sine');
      if (mile >= 26) tone(1320, 0.7, 0.05, 'sine');
    };

    s.finish = function (beatRecord) {
      const notes = beatRecord ? [523, 659, 784, 1047] : [523, 587, 523, 392];
      notes.forEach((n, i) => {
        setTimeout(() => tone(n, 0.55, 0.11, 'triangle'), i * 130);
      });
    };

    s.countdown = function (final) {
      tone(final ? 880 : 520, final ? 0.5 : 0.16, 0.12, 'square');
    };

    // ---- lifecycle ------------------------------------------------------
    s.unlock = function () {
      if (ctx.state === 'suspended') ctx.resume();
      if (!s.started) {
        s.started = true;
        ambient();
      }
      master.gain.setTargetAtTime(s.muted ? 0 : 0.85, ctx.currentTime, 0.2);
    };

    s.setMuted = function (m) {
      s.muted = m;
      master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.1);
    };

    s.ambient = ambient;
    return s;
  }

  return { create };
})();
