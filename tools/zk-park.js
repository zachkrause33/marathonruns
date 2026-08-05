#!/usr/bin/env node
/** Throwaway: freeze the game at an exact world z / lane and screenshot it. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: +arg('w', 1100), height: +arg('h', 700) }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto('file://' + path.resolve(arg('file', '/tmp/mr-fix.html')) + '?bot=1&skip=1&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(400);

  // Ascending: the world's spawn cursors only move forward, so jumping
  // backwards leaves the frame empty.
  const zs = String(arg('z', '5105')).split(',').map(Number).sort((a, b) => a - b);
  const lane = +arg('lane', 1);
  const dir = path.resolve(arg('dir', '/tmp/zk-park'));
  fs.mkdirSync(dir, { recursive: true });

  await page.evaluate(() => { window.requestAnimationFrame = function () { return 0; }; });
  for (const z of zs) {
    const info = await page.evaluate(({ z, lane }) => {
      const g = MR.game;
      g.pace.units = z; g.pace.miles = z / MR.K.TOTAL_UNITS * 26.2;
      g.world.update(z, lane);
      g.runner.group.position.set(MR.K.LANE_X[lane], 0, z);
      for (let i = 0; i < 6; i++) g.cam.update(0.5, { z: z, x: MR.K.LANE_X[lane], y: 0, speed: 0, lean: 0, duck01: 0 });
      g.renderer.render(g.scene, g.cam.camera);
      return { draws: g.renderer.info.render.calls, biome: MR.Course.biomeAt(z / MR.K.TOTAL_UNITS).name };
    }, { z, lane });
    const f = path.join(dir, 'z' + z + '.png');
    await page.screenshot({ path: f });
    console.log(`z=${z} ${info.biome} draws ${info.draws} -> ${f}`);
  }
  for (const l of logs.slice(0, 8)) console.log('  | ' + l);
  await browser.close();
})();
