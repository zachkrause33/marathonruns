#!/usr/bin/env node
/**
 * ORBIT CONTACT SHEET -- the instrument CLAUDE.md rule 1 needs.
 *
 *   node tools/orbit.js --kind DUCK --out reference/duck-orbit-after.png
 *   node tools/orbit.js --kind JUMP --az 0,45,90,180,270 --tile 360
 *
 * Every variant of one kind, at every requested azimuth, at ONE scale, in one
 * png. That last property is the whole point and is the correction recorded at
 * roadmap entry 2: a sheet that frames each variant to its own height prints
 * ten different objects as ten identical rectangles and tells you about the
 * camera. Here the frame is grown once until the largest variant fits at the
 * widest angle asked for, and then every tile uses it -- so relative height,
 * relative width, relative DEPTH and the shape of the lower edge are all facts
 * about the geometry.
 *
 * WHY IT IS A SEPARATE TOOL FROM world.fleetSheet. That one renders at
 * AUDIT_PX = 128 a tile, which is the right resolution for an area mean and
 * far too coarse to answer "does this thing have a back", which is the question
 * rule 1 actually asks. This drives api.variantObject instead -- the same
 * assembly the spawn site uses, inked body plus caution face plus moving part
 * -- through a render target of any size.
 *
 * A rear-only or featureless-flank object photographs as a finished one at
 * az 0 and only at az 0. That is what this is for, and it is how the JUMP and
 * DUCK rebuild was found: az 0 said six well-dressed JUMPs, az 90 and az 180
 * said one dressed face and three blank ones on half of them.
 *
 * It renders through the GAME'S OWN renderer into an offscreen target, with
 * everything but the lights hidden, exactly as world.js's shotMean does -- so
 * the toon ramps, the ink shell and the cel specular are the shipped ones and
 * not a second lighting rig that could flatter the art.
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

const KIND = String(arg('kind', 'JUMP')).toUpperCase();
const OUT = path.resolve(String(arg('out', path.join(ROOT, 'shots', 'orbit.png'))));
const TILE = parseInt(arg('tile', 300), 10);
const AZ = String(arg('az', '0,90,180,270')).split(',').map(Number);
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await page.goto('file://' + FILE + '?bot=1&nocount=1&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 20000 });
  // The sculpted fleet dresses asynchronously; the sheet must show the
  // object the player meets. On timeout the code art is what ships and is
  // what gets photographed.
  await page.waitForFunction(
    () => !MR.game.world.sculptsPending || MR.game.world.sculptsPending() === 0,
    { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(600);

  const res = await page.evaluate(({ KIND, TILE, AZ }) => {
    const g = MR.game, w = g.world, THREE = window.THREE;
    const KID = { JUMP: 1, DUCK: 2, BLOCK: 3 }[KIND];
    if (!KID) return { error: 'unknown kind ' + KIND };
    const objs = [];
    for (let i = 0; i < 24; i++) {
      const o = w.variantObject(KID, i);
      if (!o) break;
      objs.push(o);
    }
    if (!objs.length) return { error: 'no variants for ' + KIND };

    const boxes = objs.map((o) => new THREE.Box3().setFromObject(o));
    // The audit camera's elevation, which is the game's own sightline.
    const pitch = Math.atan2(2.62 - 1.16, 8.0);
    let top = 0;
    for (const b of boxes) top = Math.max(top, b.max.y);
    const cy = top * 0.5;
    // Grow the frame until the worst (variant, azimuth) pair fits, then freeze
    // it. Screen basis as world.js fitHalf derives it: right is (cos az, 0,
    // sin az), up is (-sin el sin az, cos el, sin el cos az).
    let half = 0.6;
    for (const b of boxes) {
      for (const adeg of AZ) {
        const az = adeg * Math.PI / 180;
        const ca = Math.cos(az), sa = Math.sin(az);
        const ce = Math.cos(pitch), se = Math.sin(pitch);
        for (const px of [b.min.x, b.max.x]) {
          for (const py of [b.min.y, b.max.y]) {
            for (const pz of [b.min.z, b.max.z]) {
              const dy = py - cy;
              half = Math.max(half, Math.abs(px * ca + pz * sa) * 1.10,
                Math.abs(-px * se * sa + dy * ce + pz * se * ca) * 1.10);
            }
          }
        }
      }
    }

    const rt = new THREE.WebGLRenderTarget(TILE, TILE);
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    rt.texture.generateMipmaps = false;
    const buf = new Uint8Array(TILE * TILE * 4);
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.05, 120);
    const holder = new THREE.Group();
    const scene = g.scene;
    const saved = [];
    for (const o of scene.children) {
      if (o.isLight) continue;
      saved.push([o, o.visible]);
      o.visible = false;
    }
    scene.add(holder);

    const PAD = 26, LBL = 22, GUT = 84;
    const cv = document.createElement('canvas');
    cv.width = GUT + AZ.length * (TILE + PAD);
    cv.height = PAD + LBL + objs.length * (TILE + PAD);
    const cg = cv.getContext('2d');
    cg.fillStyle = '#1b1f2a';
    cg.fillRect(0, 0, cv.width, cv.height);
    cg.fillStyle = '#e8eefc';
    cg.font = '16px monospace';
    AZ.forEach((a, ai) => { cg.fillText('az ' + a, GUT + ai * (TILE + PAD), PAD + LBL - 8); });

    const tmp = document.createElement('canvas');
    tmp.width = TILE; tmp.height = TILE;
    const tg = tmp.getContext('2d');
    const prevRT = g.renderer.getRenderTarget();
    const clr = new THREE.Color();
    g.renderer.getClearColor(clr);
    const prevA = g.renderer.getClearAlpha();

    objs.forEach((obj, vi) => {
      holder.clear();
      holder.add(obj);
      const rowY = PAD + LBL + vi * (TILE + PAD);
      cg.fillStyle = '#e8eefc';
      cg.fillText(KIND, 6, rowY + TILE / 2 - 8);
      cg.fillText('v' + vi, 6, rowY + TILE / 2 + 12);
      AZ.forEach((adeg, ai) => {
        const az = adeg * Math.PI / 180;
        const d = 40, ce = Math.cos(pitch);
        cam.position.set(d * ce * Math.sin(az), cy + d * Math.sin(pitch), -d * ce * Math.cos(az));
        cam.lookAt(0, cy, 0);
        g.renderer.setRenderTarget(rt);
        g.renderer.setClearColor(0x2b3346, 1);
        g.renderer.clear();
        g.renderer.render(scene, cam);
        g.renderer.readRenderTargetPixels(rt, 0, 0, TILE, TILE, buf);
        // readRenderTargetPixels is bottom-up.
        const img = tg.createImageData(TILE, TILE);
        for (let y = 0; y < TILE; y++) {
          const src = (TILE - 1 - y) * TILE * 4;
          img.data.set(buf.subarray(src, src + TILE * 4), y * TILE * 4);
        }
        tg.putImageData(img, 0, 0);
        cg.drawImage(tmp, GUT + ai * (TILE + PAD), rowY);
      });
    });

    g.renderer.setRenderTarget(prevRT);
    g.renderer.setClearColor(clr, prevA);
    scene.remove(holder);
    holder.clear();
    for (const s of saved) s[0].visible = s[1];

    const ext = w.fleetExtents().filter((e) => e.kind === KID);
    return { png: cv.toDataURL('image/png'), half: +half.toFixed(2), ext };
  }, { KIND, TILE, AZ });

  if (res.error) { console.error(res.error); process.exit(1); }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  console.log('wrote ' + OUT + '  (one scale, half ' + res.half + ')');
  // The envelope beside the sheet, because "does it fit" and "is it built" are
  // the two questions a rebuild has to answer at the same time.
  for (const e of res.ext) {
    console.log(`  ${e.name}  halfX ${e.halfX}/${e.boxHalfX}`
      + `  halfZ ${e.halfZ}/${e.boxHalfZ}  y ${e.yMin}..${e.yMax} / ${e.boxYMin}..${e.boxYMax}`);
  }
  for (const e of errs) console.log('  ! ' + e);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
