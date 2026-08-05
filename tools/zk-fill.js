#!/usr/bin/env node
/**
 * Throwaway: measure the fill-rate cost of the (now visible again) telegraph
 * mats, A/B/A inside ONE page so machine load cannot masquerade as a result.
 */
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
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve(arg('file', '/tmp/mr-fix.html')) + '?bot=1&skip=' + arg('skip', 185) + '&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(async () => {
    const g = MR.game;
    function mats() {
      const list = [];
      g.world.group.traverse(function (o) { if (o.isMesh && o.renderOrder === 5) list.push(o); });
      return list;
    }
    async function measure(on, ms) {
      const t0 = performance.now();
      let n = 0;
      await new Promise((res) => {
        const tick = () => {
          for (const m of mats()) m.visible = on;
          n++;
          if (performance.now() - t0 > ms) res(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return +(n / ((performance.now() - t0) / 1000)).toFixed(2);
    }
    const a = await measure(true, 4000);
    const b = await measure(false, 4000);
    const c = await measure(true, 4000);
    return { matsOn1: a, matsOff: b, matsOn2: c, count: mats().length };
  });
  console.log(JSON.stringify(out));
  await browser.close();
})();
