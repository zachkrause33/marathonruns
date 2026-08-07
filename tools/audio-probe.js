#!/usr/bin/env node
/**
 * AUDIO PROBE -- the mix, measured.
 *
 * Every review of this project has ended with "I could not check the audio in
 * a headless environment". That was never true. You cannot LISTEN headlessly,
 * but a Web Audio graph is a deterministic function from schedule to samples,
 * and `OfflineAudioContext` renders it faster than real time. So this harness
 * renders every cue in src/audio/audio.js through the real graph -- the real
 * compressor, the real master gain, the real ambient bed -- and measures it.
 *
 *   node tools/audio-probe.js                 the table
 *   node tools/audio-probe.js --json f.json   machine-readable, for diffing
 *   node tools/audio-probe.js --wav DIR       also dump 16-bit WAVs to DIR
 *   node tools/audio-probe.js --cue hit       one cue only (substring match)
 *
 * ---- what is measured, and why each column earns its place ---------------
 *
 *   peak    dBFS. Anything at 0.0 is clipping. The master sits at 0.85 and a
 *           DynamicsCompressor is the only thing between the cues and the
 *           DAC, so headroom is real but finite.
 *   rms     dBFS over the whole cue. Cheap, and wrong on its own: a 4-second
 *           roar and a 70 ms footstep with the same rms sound nothing alike.
 *   pnch    max rms in a sliding 50 ms window, dBFS. THIS is the number that
 *           decides relative loudness for transients -- the ear integrates
 *           over roughly this window, so `pnch` is what tells you whether a
 *           footstep is louder than a crash. It is the most important column.
 *   dur     seconds from the first sample above -60 dB relative to peak to
 *           the last. A cue that outlasts its event smears. Note that this
 *           includes any change the cue makes to the ambient bed, because the
 *           bed-only reference does not contain it -- so `hit` and `roar`,
 *           which deliberately duck and swell the environment, report the
 *           length of the whole disturbance rather than of the burst. That is
 *           the honest number: it is how long the soundscape is altered for.
 *   cent    spectral centroid in Hz, energy-weighted across the cue. If every
 *           cue reports the same centroid the mix is piled in one octave and
 *           nothing will separate in play.
 *   lo/lm/  share of energy below 200 Hz / 200-800 / 800-3k / above 3k, as
 *   md/hi   percentages. Small laptop speakers roll off below ~200, so a cue
 *           whose whole body is `lo` is inaudible on the hardware most people
 *           will play this on.
 *   clip    samples at or beyond full scale.
 *
 * ---- how the offline render is made faithful -----------------------------
 *
 * Three things have to be handled or the numbers are fiction:
 *
 *   THE CLOCK.  Offline, `ctx.currentTime` is 0 until rendering starts and
 *               then advances in render quanta, so cues scheduled from a
 *               callback would all pile up at 0. The context is wrapped in a
 *               Proxy that reports a virtual clock this harness drives.
 *   setTimeout. `roar`, `finish` and `crossover` schedule parts of themselves
 *               with setTimeout. Offline rendering completes in microseconds,
 *               so those callbacks would land after the render and contribute
 *               nothing -- the roar would measure as its first burst only.
 *               setTimeout is captured during the cue call (recursively) and
 *               replayed with the virtual clock advanced to each delay, which
 *               is exactly what real-time playback does.
 *   THE BED.    `unlock()` starts the ambient bed and ramps the master with a
 *               0.2 s time constant. Cues are fired after a 1.5 s lead-in so
 *               the master has settled, and every cue is measured against a
 *               bit-identical bed-only render (Math.random is seeded, so the
 *               noise buffer and the bed are reproducible) which is subtracted
 *               sample-wise. What is left is the cue.
 *
 * The compressor is shared and non-linear, so the subtraction is not perfect
 * -- but the bed is ~40 dB below the cues, so the residue is far below the
 * precision any of these numbers are read at. The bed is reported as its own
 * row so that claim is checkable rather than asserted.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

// ---- the cue list ---------------------------------------------------------
// `label` is what prints; `call` is evaluated in the page against `a`, the
// live MR.Audio instance; `len` is the render window in seconds and must be
// long enough to contain the whole tail or `dur` lies.
const CUES = [
  { label: 'ambient(bed)',      call: 'null',                  len: 2.0, bed: true },
  { label: 'footstep(1)',       call: 'a.footstep(1)',         len: 1.0 },
  { label: 'footstep(.85)',     call: 'a.footstep(0.85)',      len: 1.0 },
  { label: 'jump',              call: 'a.jump()',              len: 1.5 },
  { label: 'land',              call: 'a.land()',              len: 1.5 },
  { label: 'duck',              call: 'a.duck()',              len: 1.0 },
  { label: 'hit',               call: 'a.hit()',               len: 3.0 },
  { label: 'clean(1)',          call: 'a.clean(1)',            len: 1.0 },
  { label: 'clean(25)',         call: 'a.clean(25)',           len: 1.0 },
  { label: 'clean(45)',         call: 'a.clean(45)',           len: 1.0 },
  { label: 'clean(90)',         call: 'a.clean(90)',           len: 1.0 },
  { label: 'clean(140)',        call: 'a.clean(140)',          len: 1.0 },
  { label: 'clean(205)',        call: 'a.clean(205)',          len: 1.0 },
  // Contact at the two ends of the race. The cue reads the gear it is in, so
  // these must not measure the same -- the whole point is that losing a
  // 190-gate line is not the same event as losing a 5-gate one.
  { label: 'hit@gear0',         call: 'a.hit()',               len: 3.0 },
  { label: 'hit@gear.6',        call: 'a.clean(60); a.hit()',  len: 3.0 },
  { label: 'hit@gear1',         call: 'a.clean(200); a.hit()', len: 3.0 },
  { label: 'gearUp',            call: 'a.clean(2); a.clean(9)', len: 1.5 },
  { label: 'crossover(ahead)',  call: 'a.crossover(true)',     len: 3.0 },
  { label: 'crossover(caught)', call: 'a.crossover(false)',    len: 3.0 },
  { label: 'aid(water)',        call: 'a.aid(false)',          len: 1.0 },
  { label: 'aid(banana)',       call: 'a.aid(true)',           len: 1.5 },
  { label: 'mile(1)',           call: 'a.mile(1)',             len: 2.0 },
  { label: 'mile(26)',          call: 'a.mile(26)',            len: 2.5 },
  // world.js calls roar(1) for a record and 0.55 + 0.35*chase otherwise, so
  // 0.55 and 0.9 are the values that actually reach a player, not 0.
  { label: 'roar(0)',           call: 'a.roar(0)',             len: 6.0 },
  { label: 'roar(.55)',         call: 'a.roar(0.55)',          len: 7.0 },
  { label: 'roar(.9)',          call: 'a.roar(0.9)',           len: 8.0 },
  { label: 'roar(1)',           call: 'a.roar(1)',             len: 9.0 },
  { label: 'finish(miss)',      call: 'a.finish(false)',       len: 4.0 },
  { label: 'finish(RECORD)',    call: 'a.finish(true)',        len: 7.0 },
  { label: 'countdown(3)',      call: 'a.countdown(false)',    len: 1.0 },
  { label: 'countdown(go)',     call: 'a.countdown(true)',     len: 1.5 },
  // Written and measured, but not yet called from anywhere -- see the note at
  // the foot of audio.js for the one line each of them needs.
  { label: '~aidMissed',        call: 'a.aidMissed()',         len: 1.0 },
  { label: '~recordLost',       call: 'a.recordLost()',        len: 4.0 },
  { label: '~tier(up)',         call: 'a.tier(true)',          len: 1.5 },
];

// Realistic pile-ups. The mix is never one cue at a time, and headroom is only
// real if it survives the worst frame the game can actually produce.
const STACKS = [
  {
    label: 'STACK contact',
    // A hit fires with the land of the stumble and a footstep still ringing.
    call: 'a.footstep(1); a.hit(); setTimeout(function(){a.land();}, 60)',
    len: 3.0,
  },
  {
    label: 'STACK mile+aid',
    call: 'a.mile(13); a.aid(true); a.clean(120); a.footstep(1)',
    len: 3.0,
  },
  {
    label: 'STACK finish',
    call: 'a.roar(1); a.finish(true)',
    len: 9.0,
  },
  {
    label: 'STACK worst',
    // Not a frame the game produces often, but it is a frame the game CAN
    // produce: contact on the same step as a landing, on a mile boundary,
    // with the ghost changing sides. Headroom is only real if it survives it.
    call: 'a.clean(190); a.footstep(1); a.hit(); a.land(); a.mile(26); a.crossover(false)',
    len: 3.5,
  },
  {
    label: 'STACK 4s run',
    // Four seconds of top-gear running: footsteps at ~3 Hz with a clean gate
    // every ~0.6 s, which is what mile 20 of a flawless run sounds like.
    call: [
      'for (var i = 0; i < 12; i++) (function(i){',
      '  setTimeout(function(){ a.footstep(i % 2 ? 0.85 : 1); }, i * 320);',
      '  if (i % 2 === 0) setTimeout(function(){ a.clean(150 + i); }, i * 320 + 90);',
      '})(i);',
    ].join(''),
    len: 5.0,
  },
];

// ---- page-side render + analysis -----------------------------------------
// Runs inside Chromium. Kept as a string so the whole harness is one file and
// the injected audio.js source sits next to it in the same document.
const PAGE = String.raw`
window.__probe = (function () {
  const SR = 48000;
  const LEAD = 1.5;          // master-gain settle time before the cue fires

  // Seeded PRNG. audio.js fills its noise buffer with Math.random and roar()
  // scatters its whistles with it, so without a seed no two renders -- and no
  // before/after comparison -- would be comparable.
  function seedRandom(seed) {
    let t = seed >>> 0;
    Math.random = function () {
      t += 0x6D2B79F5;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }
  const realRandom = Math.random;

  async function render(callSrc, len) {
    const oc = new OfflineAudioContext(1, Math.ceil(SR * (LEAD + len)), SR);
    let vnow = 0;

    // The virtual clock. Everything audio.js reads as "now" comes through here.
    const proxy = new Proxy(oc, {
      get(t, p) {
        if (p === 'currentTime') return vnow;
        if (p === 'state') return 'running';        // offline ctx is 'suspended'
        if (p === 'resume') return function () {};  // ...and resume() would throw
        const v = t[p];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });

    const prevAC = window.AudioContext;
    window.AudioContext = function () { return proxy; };
    seedRandom(20260807);

    let a;
    try {
      a = MR.Audio.create();
      a.unlock();                                   // starts the bed at t=0

      // Capture setTimeout, recursively, and replay it on the virtual clock.
      const pending = [];
      const realST = window.setTimeout;
      window.setTimeout = function (fn, ms) { pending.push({ at: (ms || 0) / 1000, fn }); return 0; };

      vnow = LEAD;
      let base = LEAD;
      try {
        if (callSrc) (new Function('a', callSrc))(a);
        // Drain in time order; a callback may schedule more.
        let guard = 0;
        while (pending.length && guard++ < 2000) {
          pending.sort((x, y) => x.at - y.at);
          const job = pending.shift();
          vnow = base + job.at;
          const nested = [];
          window.setTimeout = function (fn, ms) { nested.push({ at: job.at + (ms || 0) / 1000, fn }); return 0; };
          job.fn();
          for (const n of nested) pending.push(n);
        }
      } finally {
        window.setTimeout = realST;
      }
    } finally {
      window.AudioContext = prevAC;
    }

    const buf = await oc.startRendering();
    Math.random = realRandom;
    const all = buf.getChannelData(0);
    return all.slice(Math.round(LEAD * SR));       // drop the lead-in
  }

  // ---- analysis ----------------------------------------------------------
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  const dB = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -Infinity);

  function analyse(x) {
    const n = x.length;
    let peak = 0, sum = 0, clip = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(x[i]);
      if (v > peak) peak = v;
      sum += x[i] * x[i];
      if (v >= 0.999) clip++;
    }
    const rms = Math.sqrt(sum / n);

    // Sliding 50 ms rms -- the punch column.
    const W = Math.round(0.05 * SR);
    let run = 0, punch = 0;
    for (let i = 0; i < n; i++) {
      run += x[i] * x[i];
      if (i >= W) run -= x[i - W] * x[i - W];
      if (i >= W) { const r = Math.sqrt(run / W); if (r > punch) punch = r; }
    }

    // Duration: first to last sample above -60 dB relative to peak.
    const gate = peak * 0.001;
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) if (Math.abs(x[i]) > gate) { if (first < 0) first = i; last = i; }
    const dur = first < 0 ? 0 : (last - first + 1) / SR;

    // Energy-weighted average spectrum over Hann-windowed 2048-pt frames.
    const N = 2048, HOP = 1024;
    const mag = new Float64Array(N / 2);
    let frames = 0;
    for (let off = 0; off + N <= n; off += HOP) {
      const re = new Float64Array(N), im = new Float64Array(N);
      let e = 0;
      for (let i = 0; i < N; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
        re[i] = x[off + i] * w;
        e += x[off + i] * x[off + i];
      }
      if (e < 1e-12) continue;
      fft(re, im);
      for (let k = 0; k < N / 2; k++) mag[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      frames++;
    }
    let cent = 0, tot = 0;
    const band = [0, 0, 0, 0];
    for (let k = 1; k < N / 2; k++) {
      const f = (k * SR) / N;
      const m = mag[k] * mag[k];
      cent += f * m; tot += m;
      band[f < 200 ? 0 : f < 800 ? 1 : f < 3000 ? 2 : 3] += m;
    }
    cent = tot > 0 ? cent / tot : 0;

    return {
      peak, peakDb: dB(peak), rmsDb: dB(rms), punchDb: dB(punch),
      dur, cent, clip, frames,
      band: tot > 0 ? band.map((b) => (100 * b) / tot) : [0, 0, 0, 0],
    };
  }

  function subtract(cue, bed) {
    const out = new Float32Array(cue.length);
    for (let i = 0; i < cue.length; i++) out[i] = cue[i] - (bed[i] || 0);
    return out;
  }

  return { render, analyse, subtract, SR };
})();
`;

// ---- WAV writer (node side) ----------------------------------------------
function wav(samples, sr) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const f = (x, d = 1) => (isFinite(x) ? x.toFixed(d) : '  -inf');
const pad = (s, w) => String(s).padEnd(w);
const rpad = (s, w) => String(s).padStart(w);

async function main() {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const only = arg('--cue');
  const wavDir = arg('--wav');
  const jsonOut = arg('--json');
  if (wavDir) fs.mkdirSync(wavDir, { recursive: true });

  // audio.js derives its gear curve from the live pace model rather than
  // restating it, so the probe loads the same modules the game does, in the
  // same order. Measuring audio.js alone would exercise its fallback curve and
  // report numbers no player will ever hear.
  const mods = ['src/core/constants.js', 'src/core/pace.js', 'src/audio/audio.js']
    .map((m) => `<script>${fs.readFileSync(path.join(ROOT, m), 'utf8')}</script>`)
    .join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>audio probe</title>
<script>var MR = {};</script>
${mods}
<script>${PAGE}</script>`;
  const tmp = path.join(ROOT, 'tools/tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const page404 = path.join(tmp, 'audio-probe.html');
  fs.writeFileSync(page404, html);

  const browser = await chromium.launch({
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.goto('file://' + page404);

  const list = [...CUES, ...STACKS].filter((c) => !only || c.label.includes(only));
  const rows = [];

  for (const cue of list) {
    const r = await page.evaluate(async ({ call, len, bed }) => {
      const cueBuf = await window.__probe.render(bed ? null : call, len);
      let sig = cueBuf;
      if (!bed) {
        const bedBuf = await window.__probe.render(null, len);
        sig = window.__probe.subtract(cueBuf, bedBuf);
      }
      const m = window.__probe.analyse(sig);
      return { m, samples: Array.from(sig) };
    }, cue);
    rows.push({ label: cue.label, ...r.m });
    if (wavDir) {
      fs.writeFileSync(path.join(wavDir, cue.label.replace(/[^\w.-]+/g, '_') + '.wav'),
        wav(r.samples, 48000));
    }
  }

  await browser.close();

  // ---- print ------------------------------------------------------------
  console.log('');
  console.log('  ' + pad('cue', 18) + rpad('peak', 7) + rpad('rms', 8) + rpad('pnch', 7)
    + rpad('dur', 7) + rpad('cent', 7) + rpad('lo', 6) + rpad('lm', 6) + rpad('md', 6)
    + rpad('hi', 6) + rpad('clip', 6));
  console.log('  ' + pad('', 18) + rpad('dBFS', 7) + rpad('dBFS', 8) + rpad('dBFS', 7)
    + rpad('s', 7) + rpad('Hz', 7) + rpad('%', 6) + rpad('%', 6) + rpad('%', 6)
    + rpad('%', 6) + rpad('n', 6));
  console.log('  ' + '-'.repeat(82));
  for (const r of rows) {
    if (r.label.startsWith('STACK')) console.log('  ' + '-'.repeat(82));
    console.log('  ' + pad(r.label, 18)
      + rpad(f(r.peakDb), 7) + rpad(f(r.rmsDb), 8) + rpad(f(r.punchDb), 7)
      + rpad(f(r.dur, 2), 7) + rpad(Math.round(r.cent), 7)
      + rpad(f(r.band[0], 0), 6) + rpad(f(r.band[1], 0), 6)
      + rpad(f(r.band[2], 0), 6) + rpad(f(r.band[3], 0), 6)
      + rpad(r.clip, 6));
  }
  console.log('');

  // ---- the assertions the mix has to keep -------------------------------
  // Stated here rather than in prose so a regression fails instead of being
  // noticed. Each one is a claim about how the game should sound.
  const by = {};
  for (const r of rows) by[r.label] = r;
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  const p = (k) => (by[k] ? by[k].punchDb : NaN);

  for (const r of rows) {
    check(r.clip === 0, `${r.label}: ${r.clip} clipped samples`);
    check(r.peakDb <= -0.5, `${r.label}: peak ${f(r.peakDb)} dBFS, no headroom`);
  }
  // Contact costs the record; a footstep costs nothing. 12 dB is the gap that
  // makes that true to the ear rather than only on paper.
  check(p('hit') > p('footstep(1)') + 12, 'hit is not decisively louder than a footstep');
  check(p('hit') > p('land') + 6, 'hit does not beat a landing');
  check(p('hit') > p('clean(90)') + 10, 'hit does not beat a clean gate');
  // Eight thousand people watching a world record fall outrank a signpost.
  check(p('roar(1)') > p('mile(26)') + 4, 'the roar is not bigger than a mile marker');
  check(p('roar(1)') > p('roar(.55)') + 2, 'roar power does not change level');
  check(p('finish(RECORD)') > p('finish(miss)') + 3, 'a record sounds like a miss');
  check(p('finish(RECORD)') >= p('hit') - 1, 'the finish is smaller than a stumble');
  // The reward has to be above the sound of the player's own running.
  check(p('clean(90)') > p('footstep(1)') + 2, 'the clean gate is under the footsteps');

  // The streak must stay audible all the way to the gates a real run reaches.
  const c90 = by['clean(90)'], c205 = by['clean(205)'], c45 = by['clean(45)'];
  if (c90 && c205) {
    check(c205.cent > c90.cent * 1.2,
      `clean() saturates: centroid ${Math.round(c90.cent)}Hz at streak 90 vs `
      + `${Math.round(c205.cent)}Hz at 205 -- a flawless run reaches 205`);
  }
  if (c45 && c90) check(c90.cent > c45.cent * 1.1, 'clean() is flat across mid-race');
  // Contact must mean more at the top of a run than at the bottom.
  const h0 = by['hit@gear0'], h1 = by['hit@gear1'];
  if (h0 && h1) check(h1.dur > h0.dur * 1.2, 'contact sounds the same at gear 0 and gear 1');

  // The ambient bed is the floor everything has to clear.
  const bed = by['ambient(bed)'];
  for (const r of rows) {
    if (r.label.startsWith('STACK') || r.label.startsWith('ambient')) continue;
    check(r.punchDb > bed.punchDb + 6,
      `${r.label}: punch ${f(r.punchDb)} dBFS is inside the ${f(bed.punchDb)} dBFS bed`);
  }
  // Steps land ~3x a second at speed; a tail longer than that is a drone.
  check(by['footstep(1)'] && by['footstep(1)'].dur < 0.3, 'footstep tail smears into the next step');
  // Small speakers roll off below ~200 Hz. A cue that lives entirely down
  // there does not exist on the hardware most people will play this on.
  for (const k of ['footstep(1)', 'land', 'hit']) {
    if (by[k]) check(by[k].band[0] < 80, `${k}: ${f(by[k].band[0], 0)}% of energy below 200 Hz`);
  }

  if (errs.length) {
    console.log('  PAGE ERRORS:');
    for (const e of errs.slice(0, 10)) console.log('    ' + e);
  }
  if (fails.length) {
    console.log('  FAIL');
    for (const m of fails) console.log('    - ' + m);
  } else {
    console.log('  OK: mix assertions hold');
  }
  console.log('');

  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 2));
  process.exit(fails.length || errs.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
