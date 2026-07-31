// Side-on contact sheet of the runner's gait cycle.
//
// The rear-chase camera hides almost everything about the animation: knee bend,
// arm swing and lean all happen in the sagittal plane, which is exactly the
// plane the game camera looks down. This tool parks a camera beside the runner
// and steps the gait so those can actually be reviewed.
//
// Usage: node tools/gait.mjs [outDir] [--three=/path] [--pace=4.3] [--mile=2]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { serve, launch, threeDirFromArgv } from './serve.mjs';

const arg = (k, d) => {
  const a = process.argv.find(x => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const outDir = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'shots/gait';
fs.mkdirSync(outDir, { recursive: true });

const MILE = Number(arg('mile', 2));
const FRAMES = Number(arg("frames", 8));
const DIST = Number(arg("dist", 9));

const root = new URL('..', import.meta.url).pathname;
const { url, close } = await serve({ root, threeDir: threeDirFromArgv() });
const browser = await launch(chromium);
const errors = [];

// Pace is an emergent sim value (combo, fatigue, grade), so it cannot be pinned
// by poking state — a passive seek keeps resetting the combo. animateRunner
// takes pace as an argument, so drive it directly and leave the sim frozen.
for (const tier of [{ name: 'jog', pace: 5.5 }, { name: 'sprint', pace: 4.22 }]) {
  for (let i = 0; i < FRAMES; i++) {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(`${tier.name}${i}: ${e.message}`));
    await page.clock.install({ time: new Date(Date.UTC(2026, 0, 15, 12, 0, 0)) });
    await page.goto(`${url}/index.html?debug`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MR);

    const info = await page.evaluate(({ tier, i, MILE, FRAMES, DIST }) => {
      const M = window.MR;
      M.detach(); M.reseed();
      document.querySelectorAll('.overlay').forEach(o => o.classList.add('hidden'));
      M.startRun();
      const target = MILE * M.WORLD_UNITS_PER_MILE;
      let guard = 0;
      while (M.S.s < target && guard++ < 400000) M.frame(1 / 60, false);

      // freeze the world; drive only the gait, at an exact pace
      const dt = 1 / 60;
      // settle the lean/duck springs at this pace first
      for (let k = 0; k < 90; k++) M.animateRunner(dt, tier.pace, false, false, 0);
      // then advance i/FRAMES of one stride cycle. cadence(pace) cycles/sec, and
      // one full sine period is two footfalls.
      const cadence = tier.pace <= 4.22 ? 2.35 : 1.55;
      const steps = Math.round((i / FRAMES) * (60 / cadence));
      for (let k = 0; k < steps; k++) M.animateRunner(dt, tier.pace, false, false, 0);
      M.placeRunner();

      // side camera, locked to the runner
      const r = M.runner.position;
      M.camera.position.set(r.x + DIST, r.y + 1.9, r.z);
      M.camera.lookAt(r.x, r.y + 1.6, r.z);
      M.camera.fov = 30; M.camera.updateProjectionMatrix();
      M.composer.render();
      return { pace: tier.pace, steps };
    }, { tier, i, MILE, FRAMES, DIST });

    await page.screenshot({ path: `${outDir}/${tier.name}-${String(i).padStart(2, '0')}.png` });
    if (i === 0) console.log(`${tier.name}: pace ${info.pace}/mi`);
    await page.close();
  }
}

await browser.close(); close();
if (errors.length) { console.error('\nerrors:\n' + errors.join('\n')); process.exit(1); }
console.log(`gait sheets written to ${outDir}/`);
