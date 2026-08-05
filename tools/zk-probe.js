#!/usr/bin/env node
// Ad-hoc probe: open a built page, run an arbitrary JS snippet, print result,
// optionally screenshot. Everything below is throwaway diagnosis.
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
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const file = path.resolve(arg('file', '/tmp/mr-base.html'));
  await page.goto('file://' + file + '?' + arg('q', 'bot=1&skip=30') + '&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(+arg('settle', 800));
  const script = arg('eval', null);
  if (script) {
    const src = fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : script;
    const out = await page.evaluate(src);
    console.log(JSON.stringify(out, null, 2));
  }
  const shot = arg('shot', null);
  if (shot) {
    await page.waitForTimeout(+arg('post', 200));
    await page.screenshot({ path: path.resolve(shot) });
    console.log('shot -> ' + shot);
  }
  for (const l of logs.slice(0, 25)) console.log('  | ' + l);
  await browser.close();
})();
