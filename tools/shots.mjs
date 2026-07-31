// Reproducible capture set.
//
// Each shot gets a FRESH page. Reusing one page across shots leaks particle age,
// ring/decal pool state and grade-pass accumulation forward, which made two
// identical runs differ on most shots and rendered any pixel gate useless.
// Each shot also advances a fixed number of fixed-dt frames and then freezes,
// so output does not depend on wall-clock rAF timing or on GPU speed.
//
// Usage: node tools/shots.mjs [outDir] [--three=/path/to/three]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve, launch, threeDirFromArgv } from './serve.mjs';

const SHOTS = [
  { name: 'menu',   mile: null },
  { name: 'park',   mile: 1.4 },
  { name: 'urban',  mile: 5.2 },
  { name: 'bridge', mile: 12.0 },
  { name: 'hills',  mile: 18.0 },
  { name: 'finish', mile: 25.3 },
  { name: 'aid',    mile: 2.75, wantPickups: true },
];

const outDir = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'shots';
fs.mkdirSync(outDir, { recursive: true });

const root = new URL('..', import.meta.url).pathname;
const { url, close } = await serve({ root, threeDir: threeDirFromArgv() });
const browser = await launch(chromium);
const errors = [];

for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => errors.push(`${shot.name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`${shot.name}: ${m.text()}`); });

  // a fixed seed keeps the course identical regardless of the day this runs
  await page.clock.install({ time: new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) });
  await page.addInitScript(() => localStorage.setItem('mr_tut_v1', '1'));
  await page.goto(`${url}/index.html?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.MR);

  const info = await page.evaluate((s) => {
    const M = window.MR;
    M.detach();
    M.reseed();          // rAF frames may have slipped in before we took control
    if (s.mile === null) {                       // menu: idle sway, fixed frames
      document.getElementById('menu').classList.remove('hidden');
      for (let i = 0; i < 20; i++) M.frame(1 / 60, i > 16);
      return { note: 'menu' };
    }
    document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
    document.getElementById('ui').classList.add('playing');
    M.startRun();
    // seek without drawing (software GL makes rendered seeks impossibly slow),
    // then render a fixed number of frames so output is deterministic
    const target = s.mile * M.WORLD_UNITS_PER_MILE;
    let guard = 0;
    while (M.S.s < target && guard++ < 400000) M.frame(1 / 60, false);
    // settle on a spot that shows the chapter rather than the inside of a car
    guard = 0;
    while (guard++ < 6000) {
      const busy = M.live.some(o => o.mode !== 'pickup' && o.mode !== 'decor' && Math.abs(o.s - M.S.s) < 30);
      const near = s.wantPickups
        ? M.live.some(o => o.mode === 'pickup' && o.s - M.S.s > 18 && o.s - M.S.s < 90)
        : true;
      if (!busy && near) break;
      M.frame(1 / 60, false);
    }
    for (let i = 0; i < 3; i++) M.frame(1 / 60);
    // fingerprint of simulation state, so a pixel difference can be attributed
    // to the sim or to the renderer rather than guessed at
    return { mile: +M.S.mile.toFixed(4),
             fp: [M.S.s, M.camera.position.x, M.camera.position.y, M.camera.position.z,
                  M.camera.rotation.x, M.camera.rotation.y, M.camera.rotation.z, M.camera.fov,
                  M.runner.position.x, M.runner.position.y, M.S.pace, M.S.combo, M.S.hits]
                 .map(v => +Number(v).toFixed(6)).join('|') };
  }, shot);

  await page.screenshot({ path: `${outDir}/${shot.name}.png` });
  console.log(`${shot.name.padEnd(8)} ${JSON.stringify(info)}`);
  await page.close();
}

await browser.close(); close();
if (errors.length) { console.error('\nerrors:\n' + errors.join('\n')); process.exit(1); }
console.log(`\n${SHOTS.length} shots written to ${outDir}/`);
