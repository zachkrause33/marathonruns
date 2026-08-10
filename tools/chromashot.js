#!/usr/bin/env node
/**
 * Capture our frames for the colour comparison, HUD off, at the framing the
 * game is actually played in, AND PRINT THE LEG IT LANDED ON.
 *
 * That last part is not a convenience. `?skip=` is race SECONDS, not distance,
 * and the leg it lands on depends on the day's course AND on the boot flags --
 * with `bot=1` the runner takes no hits, travels further, and lands somewhere
 * else. Two shipped tools in this repo carry per-leg tables whose leg labels
 * were attached by hand afterwards and cannot be checked, and that cost an hour
 * and one retracted conclusion. A table that labels itself cannot be
 * mislabelled, so every row here carries the biome and the mile it was taken
 * at, read out of the live game after boot.
 *
 * The date is pinned by default, because the course regenerates daily and an
 * unpinned comparison is between different legs.
 *
 * Usage:
 *   node tools/chromashot.js --dir /tmp/x --skips 25,60,95,110,140,178,200,230
 *   node tools/chromashot.js --dir /tmp/x --hud            keep the HUD
 *   node tools/chromashot.js --dir /tmp/x --w 390 --h 844  a different framing
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

// 620x1344 is the shape shoot.js calls "the shape the game is actually played
// in", and it is the framing every clarity figure on record was taken at.
const W = parseInt(arg('w', '620'), 10);
const H = parseInt(arg('h', '1344'), 10);
const DATE = arg('date', '2026-08-10');
const SKIPS = String(arg('skips', '25,60,95,110,140,178,200,230')).split(',');
const DIR = path.resolve(arg('dir', path.join(ROOT, 'tools/tmp/chroma')));
const HUD = has('hud');
const INDEX = arg('index', path.join(ROOT, 'index.html'));
const TAG = arg('tag', '');

fs.mkdirSync(DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  let failed = false;
  console.log('skip  leg              mile    file');
  for (const skip of SKIPS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
    const q = `?bot=1&date=${DATE}&skip=${skip}`;
    await page.goto('file://' + INDEX + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 60000 });
    await page.waitForTimeout(900);

    const where = await page.evaluate((keepHud) => {
      if (!keepHud) { const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none'; }
      const units = MR.game.pace.units;
      const f = units / MR.K.TOTAL_UNITS;
      let leg = 'unknown';
      try { const b = MR.Course.biomeAt(f); leg = (b && (b.name || b.key || b.id)) || String(b); } catch (e) { leg = 'biomeAt threw'; }
      return { leg, units, mile: f * MR.K.MARATHON_MILES, draws: MR.game.renderer.info.render.calls,
               tris: MR.game.renderer.info.render.triangles };
    }, HUD);
    await page.waitForTimeout(120);

    const name = `${TAG ? TAG + '-' : ''}s${skip}-${String(where.leg).replace(/[^a-z0-9]+/gi, '_')}.png`;
    await page.screenshot({ path: path.join(DIR, name) });
    console.log(`${String(skip).padEnd(5)} ${String(where.leg).padEnd(16)} ${where.mile.toFixed(2).padStart(6)}  ${name}` +
      `   draws ${where.draws} tris ${where.tris}` + (errs.length ? '   PAGE ERRORS: ' + errs.join(' | ') : ''));
    if (errs.length) failed = true;
    await ctx.close();
  }
  await browser.close();
  if (failed) { console.error('\nPAGE THREW -- every number taken from these frames is worthless.'); process.exit(1); }
})();
