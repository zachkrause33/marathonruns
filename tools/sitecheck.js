#!/usr/bin/env node
/**
 * Verify the DEPLOY flavor, not just the committed one.
 *
 * Every other tool loads the committed index.html from file://, where the
 * models travel embedded. marathon-miles.com serves a different build --
 * tools/build.js --site -- whose models are fetched as separate files, and
 * "the fetch path works" is exactly the kind of claim rule 2 says must be
 * proven against a running page. This tool builds the --site flavor into a
 * temp dir laid out like the deployed _site (page at root, models under
 * assets/), serves it over local HTTP, and fails unless:
 *
 *   - the page boots with zero console errors and zero failed requests,
 *   - the model request actually goes out (MR.ASSETS, not MR.EMBED),
 *   - the sculpted costume ATTACHES (api.skinned goes true), which proves
 *     fetch -> parse -> rigFromSkeleton end to end,
 *   - the crowd pack decoded (it stays embedded in every flavor).
 *
 * Run: node tools/sitecheck.js
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

(async () => {
  // assemble _site the way pages.yml does (minus the landing-page extras,
  // which have no bearing on the game)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-site-'));
  execFileSync('node', [path.join(__dirname, 'build.js'), '--site',
    '--out', path.join(dir, 'index.html')], { stdio: 'inherit' });
  fs.mkdirSync(path.join(dir, 'assets'));
  for (const f of fs.readdirSync(path.join(ROOT, 'assets'))) {
    if (f.endsWith('.glb')) {
      fs.copyFileSync(path.join(ROOT, 'assets', f), path.join(dir, 'assets', f));
    }
  }

  const types = { '.html': 'text/html', '.glb': 'model/gltf-binary' };
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]
      .replace(/\/$/, '/index.html')));
    if (!p.startsWith(dir) || !fs.existsSync(p)) {
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
  const errors = [];
  const requests = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('requestfailed', r => errors.push('request failed: ' + r.url()));
  page.on('request', r => requests.push(r.url()));

  await page.goto(base + '/?bot=1&nosave=1&debug=1', { waitUntil: 'load' });

  // poll-with-evaluate (waitForFunction raf-starves under SwiftShader)
  let state = null;
  for (let i = 0; i < 120; i++) {
    state = await page.evaluate(() => ({
      embedKeys: Object.keys((window.MR && MR.EMBED) || {}),
      assetKeys: Object.keys((window.MR && MR.ASSETS) || {}),
      skinned: !!(window.MR && MR.game && MR.game.runner && MR.game.runner.skinned),
      running: !!(window.MR && MR.game),
    }));
    if (state.skinned) break;
    await page.waitForTimeout(500);
  }
  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });

  const fetched = requests.filter(u => u.includes('/assets/'));
  const fail = [];
  if (state.embedKeys.includes('miles')) fail.push('miles is EMBEDDED in the site flavor');
  if (!state.assetKeys.includes('miles')) fail.push('MR.ASSETS.miles missing');
  if (!state.embedKeys.includes('crowd')) fail.push('crowd.pack must stay embedded (synchronous decode)');
  if (!fetched.some(u => u.includes('miles.glb'))) fail.push('no request for miles.glb went out');
  if (!state.skinned) fail.push('costume never attached (api.skinned stayed false)');
  for (const e of errors) fail.push('console: ' + e);

  console.log('site flavor:', JSON.stringify({
    assets: state.assetKeys, embedded: state.embedKeys,
    fetched: fetched.map(u => u.replace(base, '')), skinned: state.skinned,
  }, null, 2));
  if (fail.length) {
    for (const f of fail) console.error('SITECHECK FAIL:', f);
    process.exit(1);
  }
  console.log('SITECHECK PASS');
})().catch(e => { console.error(e); process.exit(1); });
