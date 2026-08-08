#!/usr/bin/env node
/**
 * RUNNER ORBIT -- the character at every azimuth, through a perspective lens,
 * at one scale, in one sheet.
 *
 *   node tools/runner-orbit.js --out reference/runner-orbit-after.png
 *   node tools/runner-orbit.js --az 0,45,90,135,180,270 --file build.html
 *
 * ---- WHY THIS IS NOT tools/orbit.js --------------------------------------
 *
 * orbit.js drives world.variantObject, which is the obstacle fleet, and it
 * frames through an ORTHOGRAPHIC camera. Neither is right for the runner: he
 * is not a variant, and an orthographic lens flattens exactly the facial
 * planes a character pass is trying to put in. This drives the live rig in
 * the live scene through a PERSPECTIVE lens, which is the only lens that can
 * answer "does the nose read".
 *
 * ---- THE FRAMING, AND WHY IT IS THESE NUMBERS ----------------------------
 *
 * reference/runner-orbit-before.png is the owner's evidence sheet and its
 * framing is the one the after has to be shot at, or the comparison is a
 * comparison of cameras. The script that made it was never committed -- only
 * the png was -- so the framing here is recovered from the png itself and
 * then CHECKED against it: --verify renders the sheet and prints, per tile,
 * the row of the crown and the row of the lowest sole beside the same two
 * rows measured out of the committed before. Run against an unmodified build
 * those two columns agree to a couple of pixels, which is what licenses
 * calling the after "the same framing".
 *
 * DIST is measured to the look-at point, not to the runner's origin, and the
 * lens is held at the look-at height rather than pitched down: a pitched lens
 * puts a different amount of the road behind him in every tile and the eye
 * reads that as the figure changing size.
 *
 * ---- THE POSE IS PINNED --------------------------------------------------
 *
 * A contact sheet of an animated character is worthless if the two halves of
 * the comparison are at different points in the stride, and "wait 600ms after
 * ready" is not a point in the stride -- it is whatever the machine's load
 * left on the clock. So rAF is hand-pumped exactly as tools/resolve.js pumps
 * it: a fixed number of fixed-size steps from a fixed ?skip=, which lands the
 * cycle on the same phase on any machine and in any build.
 *
 * Everything but the runner stays visible. The road and the scenery are what
 * make the tile a frame rather than a swatch, and the ink shell reads
 * differently against sky than it does against tarmac -- which is a fact
 * about the character, not a distraction from it.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : true) : d;
}

const OUT = path.resolve(String(arg('out', path.join(ROOT, 'shots', 'runner-orbit.png'))));
const AZ = String(arg('az', '0,45,90,135,180,270')).split(',').map(Number);
const TW = parseInt(arg('tw', 200), 10);
const TH = parseInt(arg('th', 420), 10);
const DIST = parseFloat(arg('dist', 3.4));
const FOV = parseFloat(arg('fov', 32));
const TARGET_Y = parseFloat(arg('ty', 0.90));
const ELEV = parseFloat(arg('elev', 0));
const SKIP = String(arg('skip', '90'));
const STEPS = parseInt(arg('steps', 96), 10);
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const VERIFY = !!arg('verify', false);
const BEFORE = path.resolve(String(arg('before', path.join(ROOT, 'reference', 'runner-orbit-before.png'))));

function pageHarness() {
  window.__ro = { pump: null, now: performance.now() };
  const real = window.requestAnimationFrame;
  window.__ro.real = real;
  window.requestAnimationFrame = function (cb) { window.__ro.pump = cb; return 1; };
}

function pageSheet(o) {
  const g = MR.game, THREE = window.THREE, F = window.__ro;
  // The player's own inputs are silenced so the pose is the run cycle and
  // nothing else -- a gate resolving mid-sweep would put a jump in one tile.
  g.player.handle = function () { };
  g.player.resolveGates = function () { return []; };
  g.player.resolveAid = function () { return []; };
  F.now = performance.now();
  const step = function (dt) {
    F.now += dt * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };
  for (let i = 0; i < o.steps; i++) step(1 / 120);

  const rig = g.runner.group;
  rig.updateMatrixWorld(true);
  const c = new THREE.Vector3();
  rig.getWorldPosition(c);

  const rt = new THREE.WebGLRenderTarget(o.tw, o.th);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(o.tw * o.th * 4);
  const cam = new THREE.PerspectiveCamera(o.fov, o.tw / o.th, 0.05, 400);

  const cv = document.createElement('canvas');
  cv.width = o.az.length * o.tw;
  cv.height = o.th;
  const cg = cv.getContext('2d');
  const tmp = document.createElement('canvas');
  tmp.width = o.tw; tmp.height = o.th;
  const tg = tmp.getContext('2d');

  const prevRT = g.renderer.getRenderTarget();
  const target = new THREE.Vector3(c.x, c.y + o.ty, c.z);
  const el = o.elev * Math.PI / 180;

  o.az.forEach(function (adeg, ai) {
    const a = adeg * Math.PI / 180;
    // az 0 is dead astern, which on this rig is -z: the chase camera sits
    // behind the runner and the runner faces +z. The sheet's first tile has
    // to be the view the game actually shows or the comparison starts at an
    // angle nobody has ever seen.
    const ce = Math.cos(el), se = Math.sin(el);
    cam.position.set(
      target.x + o.dist * ce * Math.sin(a),
      target.y + o.dist * se,
      target.z - o.dist * ce * Math.cos(a)
    );
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    g.renderer.setRenderTarget(rt);
    g.renderer.render(g.scene, cam);
    g.renderer.readRenderTargetPixels(rt, 0, 0, o.tw, o.th, buf);
    const img = tg.createImageData(o.tw, o.th);
    for (let y = 0; y < o.th; y++) {
      const src = (o.th - 1 - y) * o.tw * 4;
      img.data.set(buf.subarray(src, src + o.tw * 4), y * o.tw * 4);
    }
    tg.putImageData(img, 0, 0);
    cg.drawImage(tmp, ai * o.tw, 0);
  });

  g.renderer.setRenderTarget(prevRT);
  return { png: cv.toDataURL('image/png'), at: [+c.x.toFixed(3), +c.y.toFixed(3), +c.z.toFixed(3)] };
}

// ---- the framing check ----------------------------------------------------
//
// Two rows per tile, taken the same way from both sheets. CROWN is the
// topmost row carrying the cap's saturated red; SOLE is the bottom-most row
// carrying a near-white in the lower half of the tile, which on this
// character is only ever the outsole. Both are properties of the CAMERA far
// more than of the geometry -- a nose does not move the crown -- so a pair
// that agrees says the two sheets were shot through the same lens.
// There is no PNG decoder in this repo's dependencies -- playwright is the
// whole of node_modules -- so both sheets are measured in the PAGE, off a
// canvas, which is also the only decoder guaranteed to agree with the one
// that wrote them.
function pageRows(o) {
  return new Promise(function (resolve) {
    const im = new Image();
    im.onload = function () {
      const cv = document.createElement('canvas');
      cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      // Restricted to the middle 60% of each tile and to runs of three or
      // more matching pixels on a row. The first draft of this took the
      // topmost red pixel anywhere in the tile and measured a red hazard
      // parked up the road instead of the cap -- a detector that finds the
      // background is the flattering kind of broken, because it produces a
      // number and the number looks like a measurement.
      const x0 = Math.round(o.tw * 0.20), x1 = Math.round(o.tw * 0.80);
      const out = [];
      for (let t = 0; t < o.n; t++) {
        let crown = null, sole = null;
        for (let y = 0; y < o.th; y++) {
          let nr = 0, nw = 0;
          for (let x = x0; x < x1; x++) {
            const i = ((y * cv.width) + t * o.tw + x) * 4;
            const r = d[i], gg = d[i + 1], b = d[i + 2];
            if (r > 140 && gg < 90 && b < 90) nr++;
            if (r > 195 && gg > 190 && b > 175 && Math.abs(r - b) < 60) nw++;
          }
          if (crown === null && nr >= 3) crown = y;
          if (y > o.th * 0.55 && nw >= 3) sole = y;
        }
        out.push({ crown: crown, sole: sole });
      }
      resolve(out);
    };
    im.onerror = function () { resolve(null); };
    im.src = o.src;
  });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));
  await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + SKIP, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(pageHarness);
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!(window.__ro && window.__ro.pump))); i++) {
    await page.waitForTimeout(50);
  }
  const res = await page.evaluate(pageSheet, {
    az: AZ, tw: TW, th: TH, dist: DIST, fov: FOV, ty: TARGET_Y, elev: ELEV, steps: STEPS,
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  console.log('wrote ' + OUT + '  ' + (AZ.length * TW) + 'x' + TH
    + '  az ' + AZ.join('/') + '  dist ' + DIST + '  fov ' + FOV + '  ty ' + TARGET_Y);
  console.log('  rig at ' + res.at.join(', '));

  if (VERIFY) {
    const bsrc = 'data:image/png;base64,' + fs.readFileSync(BEFORE).toString('base64');
    const a = await page.evaluate(pageRows, { src: res.png, tw: TW, th: TH, n: AZ.length });
    const b = await page.evaluate(pageRows, { src: bsrc, tw: TW, th: TH, n: AZ.length });
    if (!a || !b) { console.error('could not decode a sheet'); process.exit(1); }
    console.log('  tile   crown(this/before)   sole(this/before)');
    let worst = 0;
    for (let i = 0; i < a.length; i++) {
      const dc = a[i].crown - b[i].crown, ds = a[i].sole - b[i].sole;
      worst = Math.max(worst, Math.abs(dc), Math.abs(ds));
      console.log('   ' + String(AZ[i]).padStart(4) + '     '
        + String(a[i].crown).padStart(3) + ' / ' + String(b[i].crown).padStart(3)
        + '  ' + (dc >= 0 ? '+' : '') + dc
        + '        ' + String(a[i].sole).padStart(3) + ' / ' + String(b[i].sole).padStart(3)
        + '  ' + (ds >= 0 ? '+' : '') + ds);
    }
    console.log('  worst row disagreement: ' + worst + ' px');
  }
  await browser.close();
  if (errs.length) { console.error(errs.slice(0, 3).join('\n')); process.exit(1); }
})();
