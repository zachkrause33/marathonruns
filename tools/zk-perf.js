#!/usr/bin/env node
/** Throwaway: average fps and draw calls over a settled window, per skip point. */
const { chromium } = require('playwright');
const path = require('path');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const files = String(arg('files', '/tmp/mr-pre.html,/tmp/mr-fix.html')).split(',');
  const skips = String(arg('skips', '25,110,185,225')).split(',');
  for (const f of files) {
    const rows = [];
    for (const sk of skips) {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      await page.goto('file://' + path.resolve(f) + '?bot=1&skip=' + sk + '&debug=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
      await page.waitForTimeout(1500);
      const s = await page.evaluate(async () => {
        const g = MR.game;
        const t0 = performance.now();
        let n = 0, draws = 0;
        await new Promise((res) => {
          const tick = () => {
            n++; draws += g.renderer.info.render.calls;
            if (performance.now() - t0 > 4000) res(); else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        return { fps: +(n / ((performance.now() - t0) / 1000)).toFixed(2), draws: Math.round(draws / n) };
      });
      rows.push(`skip=${sk} fps ${s.fps} draws ${s.draws}`);
      await ctx.close();
    }
    console.log(path.basename(f) + ':  ' + rows.join('   |   '));
  }
  await browser.close();
})();
