#!/usr/bin/env node
/**
 * ROUTEREAD -- does the racing line read as a PATH, or as a row of objects?
 *
 *   node tools/routeread.js
 *   node tools/routeread.js --skip 25,110,185 --vp 390x844
 *
 * ---- WHY THIS EXISTS ------------------------------------------------------
 *
 * A blind reader shown 1:1 crops through the chase camera flagged, unprompted
 * and in two separate frames, "a small pale green object I cannot identify --
 * it might be a bottle or a flag furled on a pole" and "a small green block on
 * the road between them I cannot make out". A raycast through those pixels
 * named the object: it is neither. It is the RACING LINE -- the painted route
 * ribbon at src/render/world.js routeMesh -- seen through a gap between two
 * occluders, with the rest of its run hidden.
 *
 * routeTexture() already carries the right instinct in its comment: "a line
 * that breaks stops reading as a path and starts reading as a row of objects".
 * That comment is about the texture's own alpha pulse. It is not about
 * OCCLUSION, and occlusion is what actually breaks the line: the runner's own
 * body, the hazard fleet, the barriers, the crowd. Nothing measured that.
 *
 * ---- ONE THING ABOUT ?skip=, WHICH COST THE FIRST RUN OF THIS TOOL --------
 *
 * ?skip= is race SECONDS and it SATURATES. Measured on the live page: skip 60
 * is mile 6.11, skip 150 is mile 16.26, and skip 240 is mile 26.22 at z 6293 --
 * the finish. Every skip from 240 upward returns that same frame. So a sweep
 * over "150,900,1560,2050" is not four legs of the course, it is one leg and
 * the finish photographed three times, and the agreement between the last
 * three rows is the tool agreeing with itself.
 *
 * tools/people.js still ships those four as its default. tools/shoot.js does
 * not -- its eight shots run 25 to 225 and every one of them lands inside the
 * race. The skips below are chosen the same way.
 *
 * ---- WHAT IT MEASURES -----------------------------------------------------
 *
 * The ribbon's exact screen mask, by rendering the real frame twice -- once as
 * it ships, once with routeMesh hidden -- and taking the pixels that changed.
 * That is the ribbon MINUS its occlusion, with no colour threshold to tune and
 * no confusion with the hedges, the aid cloth or anything else green.
 *
 * The mask is then split into connected components (8-neighbour), and each
 * component is judged on the one property that separates a path from an
 * object:
 *
 *   ELONGATION   bbox height / bbox width. A strip of paint running away from
 *                a camera is tall and narrow. A blob under about 2.2 is a
 *                shape with no direction, and a shape with no direction at
 *                this size is a thing rather than a marking.
 *
 * A component that is both SHORT (bbox height under 26 px, roughly the height
 * of a marshal's head at 8 units) and STUBBY (elongation under 2.2) is counted
 * as a BLOCK -- the failure the blind reader named. Everything else is counted
 * as a RUN.
 *
 * ---- AUDITING THIS INSTRUMENT ---------------------------------------------
 *
 * Four things it deliberately does, each because the first draft of this tool
 * got it wrong in the direction that made the ribbon look worse or better than
 * it is:
 *
 *   IT SUBTRACTS ITS OWN NOISE FLOOR. The first draft differenced one render
 *   with the ribbon against one without, and reported 116 components in a
 *   frame whose ribbon is one strip. Dumping the mask over the beauty frame
 *   showed why: most of it was the outline of the CLOUDS. The sky shader is
 *   driven by a clock it reads per draw, so two renders a few microseconds
 *   apart disagree by a subpixel along every high-contrast edge, and a
 *   subpixel disagreement clears a flat difference threshold. So a third
 *   render is taken with the ribbon still visible, and any pixel that differs
 *   between two IDENTICAL renders is struck out of the mask before anything is
 *   counted. Without it this tool reports the weather.
 *
 *   It does not threshold on colour. A green mask would pick up the hedge, the
 *   verge and the aid table's cloth and report a longer, healthier ribbon than
 *   exists. The difference render is exact.
 *
 *   It does not count the ribbon's own alpha pulse as a break. The pulse never
 *   reaches zero (routeTexture flow floors at 0.54), so a pulse trough still
 *   differs from the no-ribbon render and stays in the mask. Only real
 *   occlusion splits a component.
 *
 *   It does not average over the frame. One 40-px run and one 9-px block is
 *   not "a 24-px ribbon"; the block is the finding and a mean would hide it.
 *
 * The one thing it cannot see: a component that is occluded to zero pixels is
 * not in the mask at all, so "blocks" is a floor on the failure and never a
 * ceiling.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}
const VP = String(arg('vp', '390x844')).split('x').map(Number);
const SKIPS = String(arg('skip', '10,25,45,60,90,110,150,178,185,200,225')).split(',');
const FRAMES = parseInt(arg('frames', 6), 10);
// The ribbon's own material colour, which is how the tool finds it. It moved
// from 0x5ff0a6 to 0xa87bff when the line was taken out of the aid hue band.
const HUE = parseInt(String(arg('hue', '0xa87bff')), 16);
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));

// A component this short and this stubby is what the blind reader called a
// block. Both thresholds are stated here and nowhere else.
const SHORT_PX = 26;
const STUBBY = 2.2;

function pageRun(o) {
  const g = MR.game, THREE = window.THREE;
  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position); cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect; cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);

  let route = null;
  g.scene.traverse(function (n) {
    if (n.isMesh && n.userData && n.userData.notScenery && n.material
      && n.material.type === 'MeshBasicMaterial' && n.material.transparent
      && n.material.color
      && n.material.color.getHex(THREE.SRGBColorSpace) === o.hue) route = n;
  });
  if (!route) return { error: 'route ribbon not found (hue moved? update --hue)' };
  if (!route.visible) return { error: 'route ribbon hidden this frame', hidden: true };

  const W = o.w, H = o.h;
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const a = new Uint8Array(W * H * 4), a2 = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
  const prevRT = g.renderer.getRenderTarget();
  g.renderer.setRenderTarget(rt);
  g.renderer.render(g.scene, cam);
  g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, a);
  // The control: the SAME frame again, nothing changed. Everything that moves
  // between these two is the renderer's own per-draw clock, not the ribbon.
  g.renderer.render(g.scene, cam);
  g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, a2);
  route.visible = false;
  g.renderer.render(g.scene, cam);
  g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, b);
  route.visible = true;
  g.renderer.setRenderTarget(prevRT);
  rt.dispose();

  function diff(p, q, i) {
    return Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
  }

  // ---- the mask: pixels the ribbon actually changed ------------------------
  // 6/255 is the readback's own dither floor. The control diff strikes out
  // every pixel that a clock-driven shader moves on its own.
  const mask = new Uint8Array(W * H);
  let n = 0, noise = 0;
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    if (diff(a, a2, i) > 0) { noise++; continue; }
    if (diff(a, b, i) > 6) { mask[p] = 1; n++; }
  }

  // ---- connected components, 8-neighbour, iterative ------------------------
  const lab = new Int32Array(W * H).fill(-1);
  const comps = [];
  const stack = new Int32Array(W * H);
  for (let p0 = 0; p0 < mask.length; p0++) {
    if (!mask[p0] || lab[p0] >= 0) continue;
    const id = comps.length;
    let sp = 0;
    stack[sp++] = p0; lab[p0] = id;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, area = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % W, y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const q = yy * W + xx;
          if (mask[q] && lab[q] < 0) { lab[q] = id; stack[sp++] = q; }
        }
      }
    }
    // Single stray pixels are readback dither that survived the floor.
    if (area < 3) continue;
    const wpx = x1 - x0 + 1, hpx = y1 - y0 + 1;
    comps.push({ area, w: wpx, h: hpx, elong: +(hpx / wpx).toFixed(2), y: y0 });
  }
  comps.sort(function (p, q) { return q.area - p.area; });
  const blocks = comps.filter(function (c) { return c.h < o.shortPx && (c.h / c.w) < o.stubby; });
  return {
    total: n, noise: noise, comps: comps.length,
    biggest: comps[0] || null,
    blocks: blocks.length,
    blockList: blocks.slice(0, 6),
    all: comps.slice(0, 8),
  };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));

  console.log('');
  console.log('ROUTEREAD -- the racing line as the player sees it, after occlusion');
  console.log('  viewport ' + VP[0] + 'x' + VP[1] + ', ' + FRAMES + ' frames per leg');
  console.log('  a BLOCK is a component under ' + SHORT_PX + ' px tall with elongation under ' + STUBBY);
  console.log('');
  console.log('  skip   frame   ribbon px  parts   biggest (w x h, elong)   BLOCKS   noise px');

  let totalBlocks = 0, totalFrames = 0, worst = null;
  for (const skip of SKIPS) {
    await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + skip, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const buf = await page.evaluate(() => [MR.game.renderer.domElement.width, MR.game.renderer.domElement.height]);
    for (let f = 0; f < FRAMES; f++) {
      if (f) await page.waitForTimeout(320);
      const r = await page.evaluate(pageRun, {
        w: buf[0], h: buf[1], hue: HUE, shortPx: SHORT_PX, stubby: STUBBY,
      });
      if (r.error) { console.log('  ' + String(skip).padEnd(6) + ' ' + String(f).padStart(5) + '   ' + r.error); continue; }
      totalFrames++;
      totalBlocks += r.blocks;
      const bg = r.biggest;
      console.log('  ' + String(skip).padEnd(6) + ' ' + String(f).padStart(5)
        + String(r.total).padStart(11) + String(r.comps).padStart(7)
        + ('   ' + (bg ? bg.w + 'x' + bg.h + ', ' + bg.elong : '-')).padEnd(27)
        + String(r.blocks).padStart(7) + String(r.noise).padStart(11));
      if (r.blocks && (!worst || r.blocks > worst.blocks)) worst = { skip, f, ...r };
    }
  }
  console.log('');
  console.log('  ' + totalBlocks + ' block-shaped fragments over ' + totalFrames + ' frames'
    + '  (' + (totalFrames ? (totalBlocks / totalFrames).toFixed(2) : '-') + ' per frame)');
  if (worst) {
    console.log('  worst frame: skip ' + worst.skip + ' frame ' + worst.f + ' -- '
      + worst.blockList.map(function (c) { return c.w + 'x' + c.h + ' (' + c.elong + ')'; }).join(', '));
  }
  for (const e of errs) console.log('  ! ' + e);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
