#!/usr/bin/env node
/**
 * OGIMAGE -- render the link-preview card that has to be HOSTED.
 *
 * ---- WHY THIS IS THE ONE ASSET THAT CANNOT BE INLINED ---------------------
 *
 * The whole premise of this project is one self-contained file: the favicon,
 * the typeface, the apple-touch icon and the manifest are all data URIs in
 * tools/shell.html for that reason. An Open Graph image cannot be. The scraper
 * that renders a link in Slack, iMessage, WhatsApp, Discord or a tweet is not
 * a browser: it fetches the og:image URL over HTTP from its own servers, and
 * every one of them rejects a data: URI. So this file has to exist somewhere
 * with a real address, and the owner has to put it there.
 *
 * WHAT THE OWNER MUST DO, stated here because a comment in a shell nobody
 * opens is not a handover:
 *
 *   1. Host this PNG at a public HTTPS URL.
 *   2. Replace REPLACE-WITH-YOUR-DOMAIN in tools/shell.html -- it appears in
 *      og:image, og:url and twitter:image -- with that domain.
 *   3. Rebuild (node tools/build.js). Nothing else changes.
 *
 * Until step 2 happens the tags are inert rather than wrong: a scraper that
 * cannot resolve the host shows the title and description and no picture,
 * which is still better than the bare URL the page produced before.
 *
 * ---- WHY IT IS DRAWN AND NOT PHOTOGRAPHED --------------------------------
 *
 * A screenshot of the game would be a picture of one day's road, and the road
 * is different every day -- so the preview would be a spoiler for whichever
 * city happened to be up when the shot was taken, and stale the next morning.
 * The card states what does not change: the name, the wager, and the six
 * blocks the shared result is made of.
 *
 *   node tools/ogimage.js          writes shots/share-og-1200x630.png
 *   node tools/ogimage.js --out P  writes somewhere else
 *   node tools/ogimage.js --icon   also writes the 180x180 apple-touch icon
 *                                  and prints its data: URI, which IS inlined
 *                                  into tools/shell.html
 *
 * The icon is a second output rather than a second file because it is the same
 * mark at a different size, and two generators drawing "the same" mark is how
 * two marks come to exist.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const i = process.argv.indexOf('--out');
const OUT = i >= 0 && process.argv[i + 1]
  ? path.resolve(process.argv[i + 1])
  : path.join(ROOT, 'shots', 'share-og-1200x630.png');

/**
 * ---- --gameplay: THE CARD IS NOW A FRAME OF THE GAME ---------------------
 *
 * The typographic card below was drawn on the argument that a screenshot
 * "would be a picture of one day's road ... a spoiler ... and stale the next
 * morning". The owner overruled it on seeing the card in a Reddit composer
 * (2026-09-22): "how can that be adjusted to show the gameplay or something
 * more standard". A game's link preview showing the game is the standard,
 * the spoiler is a still of one arbitrary moment on a FIXED past date (not
 * today's road), and marketing art is allowed to be a photograph.
 *
 *   node tools/ogimage.js --gameplay [--city TAG] [--skip N] [--out P]
 *
 * Boots the real built page as a bot on a pinned date, hides #ui, stamps
 * the wordmark and the wager over the frame in the page's own typeface,
 * and screenshots 1200x630. The old drawn card remains the default mode.
 */
const GAMEPLAY = process.argv.includes('--gameplay');
const argOf = (name, dflt) => {
  const k = process.argv.indexOf(name);
  return k >= 0 && process.argv[k + 1] ? process.argv[k + 1] : dflt;
};
if (GAMEPLAY) {
  (async () => {
    const { chromium: ch } = require('playwright');
    const browser = await ch.launch({
      executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--disable-dev-shm-usage', '--no-sandbox'],
    });
    const page = await (await browser.newContext({
      viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1,
    })).newPage();
    page.on('pageerror', (e) => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
    // A pinned date, so regenerating the card reproduces the same road and
    // no card is ever a picture of the road someone is about to run.
    const city = argOf('--city', 'LONDON');
    const skip = argOf('--skip', '18');
    await page.goto('file://' + path.join(ROOT, 'index.html')
      + '?bot=1&nosave=1&nocount=1&date=2026-09-01&city=' + city + '&skip=' + skip);
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
    // Let the skip land and the camera settle on the running frame.
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const ui = document.getElementById('ui');
      if (ui) ui.style.display = 'none';
      const o = document.createElement('div');
      o.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:26px 44px 30px;'
        + 'background:linear-gradient(transparent,rgba(10,13,38,0.88) 55%);'
        + "font-family:'MRCond',sans-serif;color:#fffdf5;z-index:99;";
      o.innerHTML = '<div style="font-size:64px;font-weight:700;letter-spacing:0.06em;'
        + 'line-height:1">MARATHON MILES</div>'
        + '<div style="font-size:25px;font-weight:700;letter-spacing:0.22em;margin-top:10px;'
        + 'color:#ffe45e">BREAK 1:59:30 &nbsp;&middot;&nbsp; ONE MARATHON A DAY &nbsp;&middot;&nbsp; FREE IN YOUR BROWSER</div>';
      document.body.appendChild(o);
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: OUT });
    await browser.close();
    console.log('wrote ' + OUT + '  (gameplay: ' + city + ' @ mile-skip ' + skip + ')');
  })().catch((e) => { console.error(e); process.exit(1); });
  return;
}

// The game's own typeface, from the file the build inlines, so the card is set
// in the same face as the wordmark it is advertising.
const font = fs.readFileSync(path.join(ROOT, 'src/ui/font.css'), 'utf8');

const HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
  + font
  + 'html,body{margin:0;padding:0;}'
  + 'body{width:1200px;height:630px;background:#0e1230;color:#fffdf5;'
  + "font-family:'MRCond',sans-serif;overflow:hidden;position:relative;}"
  // The road: a plain perspective wedge with the lane dashes on it. Painted
  // marks on a surface, which is the one thing in this project that correctly
  // has no back -- see standing rule 1.
  + '.road{position:absolute;left:0;right:0;bottom:0;height:236px;'
  + 'background:linear-gradient(#161a3f,#1d2250);}'
  + '.road::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;'
  + 'background:rgba(255,253,245,0.16);}'
  + '.dash{position:absolute;bottom:22px;height:7px;background:rgba(255,253,245,0.30);}'
  + '.wrap{position:absolute;left:74px;top:96px;right:74px;}'
  + '.kicker{font-size:26px;font-weight:700;letter-spacing:0.34em;opacity:0.6;}'
  + '.mark{font-size:132px;font-weight:700;letter-spacing:-0.01em;line-height:0.98;'
  + 'margin-top:10px;}'
  + '.sub{margin-top:26px;font-size:30px;font-weight:700;letter-spacing:0.16em;'
  + 'color:#ffe45e;}'
  + '.rec{margin-top:8px;font-size:64px;font-weight:700;letter-spacing:-0.02em;'
  + 'color:#ffe45e;font-variant-numeric:tabular-nums;}'
  + '.blocks{position:absolute;left:74px;bottom:62px;display:flex;gap:14px;}'
  + '.b{width:58px;height:58px;background:#4dfba0;}'
  + '.b.y{background:#ffe45e;} .b.r{background:#ff6b84;}'
  + '.tag{position:absolute;right:74px;bottom:74px;font-size:24px;font-weight:700;'
  + 'letter-spacing:0.2em;opacity:0.65;text-align:right;line-height:1.5;}'
  + '</style></head><body>'
  + '<div class="road"></div>'
  // Four dashes, receding: the only bit of scene in the card.
  + '<div class="dash" style="left:96px;width:150px;"></div>'
  + '<div class="dash" style="left:322px;width:150px;"></div>'
  + '<div class="dash" style="left:548px;width:150px;"></div>'
  + '<div class="dash" style="left:774px;width:150px;"></div>'
  + '<div class="dash" style="left:1000px;width:150px;"></div>'
  + '<div class="wrap">'
  + '<div class="kicker">ONE COURSE A DAY &middot; EVERYONE RUNS THE SAME ROAD</div>'
  + '<div class="mark">MARATHON MILES</div>'
  + '<div class="sub">BREAK THE MARATHON WORLD RECORD</div>'
  + '<div class="rec">1:59:30</div>'
  + '</div>'
  + '<div class="blocks"><span class="b"></span><span class="b"></span>'
  + '<span class="b y"></span><span class="b"></span><span class="b r"></span>'
  + '<span class="b"></span></div>'
  + '<div class="tag">26.2 MILES<br>THREE LANES</div>'
  + '</body></html>';

// THE HOME-SCREEN ICON. Solid ground to the edges -- iOS masks the corners
// itself and a transparent PNG comes out as a black square. The M is the
// wordmark's own letter in the wordmark's own face, over the game's navy, with
// the record-green bar the finish card uses under it.
const ICON = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
  + font
  + 'html,body{margin:0;padding:0;}'
  + 'body{width:180px;height:180px;background:#0e1230;overflow:hidden;'
  + "font-family:'MRCond',sans-serif;display:flex;align-items:center;"
  + 'justify-content:center;position:relative;}'
  + '.m{font-size:150px;font-weight:700;color:#ffe45e;line-height:1;'
  + 'margin-top:-10px;letter-spacing:-0.04em;}'
  + '.bar{position:absolute;left:30px;right:30px;bottom:26px;height:10px;'
  + 'background:#4dfba0;}'
  + '</style></head><body><div class="m">M</div><div class="bar"></div></body></html>';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(HTML, { waitUntil: 'load' });
  try { await page.evaluate(() => document.fonts.ready); } catch (e) { /* system face */ }
  await page.waitForTimeout(150);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.screenshot({ path: OUT });

  if (process.argv.includes('--icon')) {
    const ip = path.join(path.dirname(OUT), 'share-icon-180.png');
    const ic = await browser.newPage({ viewport: { width: 180, height: 180 } });
    await ic.setContent(ICON, { waitUntil: 'load' });
    try { await ic.evaluate(() => document.fonts.ready); } catch (e) { /* system face */ }
    await ic.waitForTimeout(120);
    await ic.screenshot({ path: ip });
    const b64 = fs.readFileSync(ip).toString('base64');
    fs.writeFileSync(path.join(path.dirname(OUT), 'share-icon-180.datauri.txt'),
      'data:image/png;base64,' + b64);
    console.log('wrote ' + path.relative(ROOT, ip) + '  180x180  '
      + (fs.statSync(ip).size / 1024).toFixed(1) + ' KB'
      + '  (data URI ' + (b64.length / 1024).toFixed(1) + ' KB, written beside it)');
  }

  await browser.close();
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
  console.log('wrote ' + path.relative(ROOT, OUT) + '  1200x630  ' + kb + ' KB');
  console.log('HOST THIS FILE. Then replace REPLACE-WITH-YOUR-DOMAIN in');
  console.log('tools/shell.html with the domain serving it, and rebuild.');
})();
