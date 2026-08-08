#!/usr/bin/env node
/**
 * FIGURE -- how big is the runner, on screen, in the frame that ships?
 *
 * This tool exists because the answer was wrong in the source for a long time
 * and every detail decision on the character was made against it. runner.js
 * carried "110px" in a dozen comments; a later pass found 204-211px and wrote
 * that down instead; and then the camera moved twice (CAM_BASE_Y 2.62 -> 3.10
 * and LOOK_AHEAD 8.0 -> 11.0 in R2, the FOV floor 58 -> 61 and the swing
 * 10.5 -> 8.5 in the footroom work), which makes the second number stale in
 * exactly the way the first one was. A number nobody re-measures is a
 * preference with decimal places.
 *
 *   node tools/figure.js                 full sweep, all viewports and paces
 *   node tools/figure.js --only 390x844  one viewport
 *   node tools/figure.js --json          machine-readable
 *   node tools/figure.js --file x.html   against an alternate build
 *
 * ---- WHAT IS MEASURED, AND WHY IT IS TWO THINGS --------------------------
 *
 *   HEIGHT  the figure's crown-to-lowest extent in CSS pixels, taken from
 *           every de-duplicated vertex of every visible mesh of the figure
 *           through the real lens. This is the headline number and it is what
 *           "the runner is Npx tall" should mean.
 *
 *   SCALE   pixels per world unit at the runner's own depth, measured by
 *           projecting a unit-long vertical rod and a unit-long horizontal rod
 *           through the chest and taking their projected lengths.
 *
 * SCALE is the one that actually settles design arguments, and HEIGHT alone
 * cannot. Every removal in runner.js was justified by turning a world-unit
 * dimension into pixels -- "0.078 across, half a pixel" -- and that conversion
 * needs pixels per unit, not the height of the whole figure. Deriving it by
 * proportion (part / 1.60 * height) is close but not exact, because the figure
 * spans enough depth and enough of the frame that the crown and the sole do
 * not share a scale. So it is measured directly, at the depth the part lives
 * at, and the two rods are reported separately because a perspective camera
 * does not magnify x and y identically once a point is off-axis.
 *
 * ---- WHY A SWEEP ---------------------------------------------------------
 *
 * The same reason footroom.js sweeps. The FOV swings with pace (K.FOV_BASE to
 * FOV_BASE + FOV_SWING), the camera bobs on its own stride clock that beats
 * against the runner's, the bob raises and lowers the crown, and `winded`
 * narrows the lens after a contact. One frame is one alignment of four
 * clocks. Reported as min/median/max over the whole sweep, because a design
 * argument that only holds at the median is not an argument.
 *
 * The sweep drives main.js's own frame() through a hand-pumped clock, so every
 * filter and spring in camera.js is the one that ships -- lifted wholesale
 * from tools/footroom.js, which is where this pattern was proven.
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },     // iPhone 12/13/14 -- the frame that ships
  { name: '620x1344', w: 620, h: 1344 },   // shoot.js 07/08
  { name: '920x1363', w: 920, h: 1363 },   // large portrait
  { name: '844x390', w: 844, h: 390 },     // landscape phone
  { name: '320x568', w: 320, h: 568 },     // the smallest thing that runs it
  { name: '1280x800', w: 1280, h: 800 },   // desktop, shoot.js default
];

const PACES = [
  { name: 'start', skip: 1 },
  { name: 'slow', skip: 8 },
  { name: 'mid', skip: 90 },
  { name: 'fast', skip: 178 },
];

const ONLY = arg('only', null);
const JSON_OUT = !!arg('json', false);
const FILE = arg('file', null);
const WINDOWS = parseInt(arg('windows', 6), 10);

// ---------------------------------------------------------------------------
// In-page. Same hand-pumped harness footroom.js uses.
// ---------------------------------------------------------------------------
function pageHarness() {
  window.__fg = { pump: null, now: performance.now() };
  window.requestAnimationFrame = function (cb) { window.__fg.pump = cb; return 1; };
}

function pageSetup() {
  const g = MR.game;
  const F = window.__fg;

  F.realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = function () { F.drawn = (F.drawn || 0) + 1; };
  g.player.handle = function () { };
  g.player.resolveGates = function () { return []; };
  g.player.resolveAid = function () { return []; };

  F.now = performance.now();
  F.step = function (dtSec) {
    F.now += dtSec * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };

  const r = g.runner;
  const figure = r.group.children[0];
  const meshes = [];
  r.group.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let n = o; n; n = n.parent) if (n === figure) { meshes.push(o); return; }
  });

  // De-duplicated local vertices per geometry. Shared between the meshes that
  // use it, built once.
  const PTS = {};
  const points = function (geo) {
    if (PTS[geo.uuid]) return PTS[geo.uuid];
    const p = geo.attributes.position, seen = {}, out = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      if (seen[k]) continue;
      seen[k] = 1; out.push(x, y, z);
    }
    PTS[geo.uuid] = out;
    return out;
  };

  const v = new THREE.Vector3();
  F.rect = g.renderer.domElement.getBoundingClientRect();
  F.clipped = 0;

  // Screen position of a world point in CSS pixels, or null behind the lens.
  // DROP the sample, never poison the result -- a point behind the camera has
  // negative w and the divide flips its sign, which is how shoot.js's band()
  // once claimed six hidden hazards on a clean frame.
  const project = function (cam, rect, out) {
    v.applyMatrix4(cam.matrixWorldInverse);
    if (-v.z < 0.5) { F.clipped++; return false; }
    v.applyMatrix4(cam.projectionMatrix);
    out.x = rect.left + (v.x + 1) * 0.5 * rect.width;
    out.y = rect.top + (1 - v.y) * 0.5 * rect.height;
    return true;
  };

  F.shown = function (o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };

  const pt = { x: 0, y: 0 };

  /**
   * One sample: the figure's exact vertical extent in CSS pixels, its exact
   * horizontal half-width about the root, and pixels per world unit at the
   * chest -- measured with two unit rods rather than inferred by proportion.
   */
  F.sample = function () {
    const cam = g.cam.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    r.group.updateWorldMatrix(true, true);
    const rect = F.rect;

    let top = Infinity, bot = -Infinity, xlo = Infinity, xhi = -Infinity;
    for (let i = 0; i < meshes.length; i++) {
      const o = meshes[i];
      if (!F.shown(o)) continue;
      const pts = points(o.geometry), m = o.matrixWorld;
      for (let j = 0; j < pts.length; j += 3) {
        v.set(pts[j], pts[j + 1], pts[j + 2]).applyMatrix4(m);
        if (!project(cam, rect, pt)) continue;
        if (pt.y < top) top = pt.y;
        if (pt.y > bot) bot = pt.y;
        if (pt.x < xlo) xlo = pt.x;
        if (pt.x > xhi) xhi = pt.x;
      }
    }

    // The two rods, planted at the chest pivot -- the depth most of the
    // wardrobe lives at, and within a few percent of the hands and the head.
    const chest = r.parts.chest || r.parts.spine || r.group;
    const c = new THREE.Vector3();
    chest.getWorldPosition(c);
    let ppuY = null, ppuX = null;
    const a = { x: 0, y: 0 }, b = { x: 0, y: 0 };
    v.copy(c).setY(c.y - 0.5);
    if (project(cam, rect, a)) {
      v.copy(c).setY(c.y + 0.5);
      if (project(cam, rect, b)) ppuY = Math.abs(b.y - a.y);
    }
    v.copy(c).setX(c.x - 0.5);
    if (project(cam, rect, a)) {
      v.copy(c).setX(c.x + 0.5);
      if (project(cam, rect, b)) ppuX = Math.abs(b.x - a.x);
    }

    return {
      h: bot - top, w: xhi - xlo, top: top, bot: bot,
      ppuY: ppuY, ppuX: ppuX,
      fov: cam.fov, speed: g.pace.speed(),
    };
  };

  return { meshes: meshes.length, rect: { height: F.rect.height, width: F.rect.width } };
}

function pageSweep(opt) {
  const g = MR.game, F = window.__fg;
  const N = 48;
  const W = opt.windows || 6;

  const cadence = function () {
    const SPEED_LO = (MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.START_PACE;
    return 2.55 * Math.pow(g.pace.speed() / SPEED_LO, 0.72);
  };

  for (let i = 0; i < 20; i++) F.step(1 / 120);
  const z0 = g.pace.units;

  const H = [], WD = [], PY = [], PX = [], FV = [], SP = [];
  for (let w = 0; w < W; w++) {
    const dt = (1 / cadence()) / N;
    g.cam.stride = (g.cam.stride + 1 / W) % 1;
    for (let i = 0; i < N; i++) {
      F.step(dt);
      const s = F.sample();
      if (!isFinite(s.h)) continue;
      H.push(s.h); WD.push(s.w); PY.push(s.ppuY); PX.push(s.ppuX);
      FV.push(s.fov); SP.push(s.speed);
    }
  }

  // Prove the clock turned. A frozen pump returns finite, plausible,
  // IDENTICAL numbers for every row -- a failure footroom.js already shipped.
  if (!(g.pace.units - z0 > 1)) {
    return { error: 'the clock did not advance -- ' + (g.pace.units - z0).toFixed(4) };
  }

  const stat = function (a) {
    const s = a.slice().sort(function (p, q) { return p - q; });
    return { min: s[0], med: s[s.length >> 1], max: s[s.length - 1] };
  };
  return {
    n: H.length, clipped: F.clipped,
    h: stat(H), w: stat(WD), ppuY: stat(PY), ppuX: stat(PX),
    fov: stat(FV), speed: stat(SP),
    viewH: F.rect.height,
  };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const html = FILE ? path.resolve(String(FILE)) : path.join(ROOT, 'index.html');
  const rows = [];
  let bad = 0;

  for (const vp of VIEWPORTS) {
    if (ONLY && vp.name !== ONLY) continue;
    for (const pace of PACES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', function (e) { errs.push(e.message.split('\n')[0]); });
      await page.goto('file://' + html + '?bot=1&skip=' + pace.skip);
      await page.waitForFunction(function () { return window.MR && MR.game && MR.game.ready; }, { timeout: 30000 });
      await page.waitForTimeout(400);
      await page.evaluate(pageHarness);
      // Let the real scheduler hand over.
      for (let i = 0; i < 40 && !(await page.evaluate(function () { return !!(window.__fg && window.__fg.pump); })); i++) {
        await page.waitForTimeout(50);
      }
      await page.evaluate(pageSetup);
      const res = await page.evaluate(pageSweep, { windows: WINDOWS });
      if (res.error || errs.length) { bad++; console.error('  !! ' + vp.name + '/' + pace.name + ' ' + (res.error || errs[0])); }
      else rows.push({ vp: vp.name, viewH: vp.h, pace: pace.name, r: res });
      await ctx.close();
    }
  }
  await browser.close();

  if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); process.exit(bad ? 1 : 0); }

  console.log('');
  console.log('FIGURE -- the runner on screen, CSS px, ' + WINDOWS + ' camera-phase windows x 48 samples');
  console.log('');
  console.log('  viewport     pace    fov          HEIGHT px            frac of    px per unit');
  console.log('                                    min   med   max      frame H    vert   horiz');
  for (const row of rows) {
    const r = row.r;
    console.log('  ' + row.vp.padEnd(12) + row.pace.padEnd(7)
      + (r.fov.min.toFixed(1) + '-' + r.fov.max.toFixed(1)).padEnd(12)
      + r.h.min.toFixed(1).padStart(6) + r.h.med.toFixed(1).padStart(6) + r.h.max.toFixed(1).padStart(6)
      + ('   ' + (r.h.med / row.viewH).toFixed(4)).padStart(13)
      + r.ppuY.med.toFixed(1).padStart(9) + r.ppuX.med.toFixed(1).padStart(8));
  }
  console.log('');
  console.log('  px per unit is what turns a world dimension into pixels. A part 0.100');
  console.log('  wide at the chest measures 0.100 x (horiz) pixels across.');
  console.log('');
  process.exit(bad ? 1 : 0);
})();
