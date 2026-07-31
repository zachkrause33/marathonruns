// Stitch a directory of PNGs into one labelled contact sheet.
//
// tools/gait.mjs writes one frame per file, and flipping between a dozen
// separate images is a bad way to judge an animation cycle — the point is
// seeing successive poses side by side. There is no ImageMagick in the
// sandbox, so the compositing is done with a headless page and a CSS grid.
//
// Usage: node tools/sheet.mjs <dir> <out.png> [cols]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2], out = process.argv[3], cols = Number(process.argv[4] || 6);
if (!dir || !out) { console.error('usage: node tools/sheet.mjs <dir> <out.png> [cols]'); process.exit(1); }

const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
if (!files.length) { console.error(`no pngs in ${dir}`); process.exit(1); }
const imgs = files.map(f => ({
  name: f.replace('.png', ''),
  b64: fs.readFileSync(path.join(dir, f)).toString('base64'),
}));

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px">
${imgs.map(i => `<div style="position:relative"><img src="data:image/png;base64,${i.b64}" style="width:100%;display:block">
<span style="position:absolute;left:3px;top:3px;color:#0f0;font:bold 20px monospace;text-shadow:0 0 4px #000">${i.name}</span></div>`).join('')}
</body>`);
await page.waitForTimeout(400);
await page.locator('body').screenshot({ path: out });
await browser.close();
console.log(`wrote ${out} (${imgs.length} frames)`);
