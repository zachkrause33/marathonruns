// Gameplay profiler.
//
// What this gates, and why:
//
//  1. Lazy shader compilation. renderer.info.programs grows the first time a
//     material/lighting/shadow combination is drawn. Growth after boot is a
//     stall waiting to happen mid-run, and in a timed race a 700ms stall
//     corrupts the score rather than merely stuttering. Gated at 0.
//
//  2. Distribution, not median. A healthy p50 coexists happily with a p99 that
//     ruins a run, so simulation cost is reported as p50/p95/p99/max.
//
// The sweep visits every chapter plus the events that pull in their own
// materials (pickups, a stumble, the finish confetti), rendering at each sample
// point and advancing between them without drawing. That surfaces new programs
// far more efficiently than brute-forcing thousands of rendered frames, which
// matters because this normally runs on software GL.
//
// GPU frame time is deliberately NOT reported: on software GL absolute fps is
// meaningless. Draw calls, triangles and program counts are hardware
// independent, and those are what we gate on. Real fps needs a real device.
import { chromium } from 'playwright';
import { serve, launch, threeDirFromArgv, pct } from './serve.mjs';

const root = new URL('..', import.meta.url).pathname;
const { url, close } = await serve({ root, threeDir: threeDirFromArgv() });
const browser = await launch(chromium);
const page = await browser.newPage({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });

await page.clock.install({ time: new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) });
await page.addInitScript(() => localStorage.setItem('mr_tut_v1', '1'));
await page.goto(`${url}/index.html?debug`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.MR);
await page.waitForTimeout(400);

const report = await page.evaluate(async () => {
  const M = window.MR, r = M.renderer;
  M.detach();
  M.reseed();
  document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
  document.getElementById('ui').classList.add('playing');

  // info resets on every render call, and the composer makes several per frame;
  // manual reset gives whole-frame totals including the post chain
  r.info.autoReset = false;
  const compiles = [];
  let seen = r.info.programs.length;
  // keep the cache keys so a detected compile names the material that caused it,
  // instead of leaving a bare count to guess at
  let keys = new Set(r.info.programs.map(p => p.cacheKey));
  const note = label => {
    const n = r.info.programs.length;
    if (n !== seen) {
      const now = r.info.programs.map(p => p.cacheKey);
      const added = now.filter(k => !keys.has(k)).map(k => {
        const parts = k.split(',');
        const name = parts[0] || '?';
        const defs = parts.filter(x => /^(USE_|ALPHA|FLAT|TRANSPARENT|SHADOW|NUM_|TONE|VERTEX|INSTANC|MAP|DOUBLE|OPAQUE)/i.test(x));
        return { shader: name.slice(0, 60), hints: defs.slice(0, 8) };
      });
      compiles.push({ at: label, from: seen, to: n, added });
      keys = new Set(now);
      seen = n;
    }
  };
  const programsAtBoot = seen;

  // menu, before the run starts
  for (let i = 0; i < 8; i++) M.frame(1 / 60);
  note('menu');

  M.startRun();
  const simCpu = [], samples = [];
  const drawAt = (label) => {
    let calls = 0, tris = 0;
    for (let i = 0; i < 4; i++) { r.info.reset(); M.frame(1 / 60); calls = r.info.render.calls; tris = r.info.render.triangles; }
    note(label);
    samples.push({ at: label, mile: +M.S.mile.toFixed(2), drawCalls: calls, triangles: tris });
  };
  const runTo = (mile) => {
    const target = mile * M.WORLD_UNITS_PER_MILE;
    let guard = 0;
    while (M.S.s < target && guard++ < 400000) {
      const t0 = performance.now();
      M.frame(1 / 60, false);          // advance without drawing
      simCpu.push(performance.now() - t0);
    }
  };

  drawAt('start');
  for (const [label, mile] of [['park', 1.5], ['urban', 5.5], ['bridge', 12], ['hills', 18], ['finish', 25]]) {
    runTo(mile); drawAt(label);
  }
  // events that pull in their own materials
  M.S.gel = false;
  drawAt('pickup+rings');
  runTo(26.15); drawAt('near-finish');
  while (M.S.phase === 'running') M.frame(1 / 60, false);
  for (let i = 0; i < 6; i++) M.frame(1 / 60);
  note('finish+confetti+results');

  return {
    programsAtBoot,
    programsAtEnd: seen,
    programsCompiledDuringPlay: seen - programsAtBoot,
    compileEvents: compiles,
    samples,
    simFrames: simCpu.length,
    simCpuMs: { p50: +pctIn(simCpu, .5).toFixed(3), p95: +pctIn(simCpu, .95).toFixed(3),
                p99: +pctIn(simCpu, .99).toFixed(3), max: +Math.max(...simCpu).toFixed(2) },
    memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures },
    finalClock: document.getElementById('rTime').textContent,
  };
  function pctIn(a, p){ const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; }
});

report.pageErrors = errors;
console.log(JSON.stringify(report, null, 1));
await browser.close(); close();

let bad = false;
if (report.programsCompiledDuringPlay > 0) {
  console.error(`\nFAIL: ${report.programsCompiledDuringPlay} shader program(s) compiled after boot — mid-run stalls.`);
  report.compileEvents.forEach(e => console.error(`  at ${e.at}: ${e.from} -> ${e.to}`));
  bad = true;
}
if (errors.length) { console.error('\nFAIL: page errors\n' + errors.join('\n')); bad = true; }
if (!bad) console.log('\nOK: no shader compiles after boot, no page errors.');
process.exit(bad ? 1 : 0);
