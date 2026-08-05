#!/usr/bin/env node
/**
 * Throwaway diagnosis harness for the dark-train defect.
 *
 * Freezes the game at the longest train on the course, parks the camera at a
 * fixed spot, then renders a series of A/B variants and reports the mean RGB
 * of a sample rectangle over the train plus the draw-call count for each.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }
const OUT = path.resolve(arg('dir', '/tmp/zk-train'));
fs.mkdirSync(OUT, { recursive: true });

const VARIANTS = [
  ['a-asis', 'function(){}'],
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  const file = path.resolve(arg('file', '/tmp/mr-base.html'));
  await page.goto('file://' + file + '?bot=1&skip=1&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(500);

  const setup = await page.evaluate(({ back }) => {
    window.requestAnimationFrame = function () { return 0; };
    const g = MR.game;
    const trains = g.course.gates.filter((x) => x.train);
    let gate = trains[0];
    for (const t of trains) if (t.train > gate.train) gate = t;
    const blockLane = gate.lanes.indexOf(3);
    const z = gate.z - back;
    g.pace.units = z;
    g.pace.miles = z / MR.K.TOTAL_UNITS * 26.2;
    g.world.update(z, 1);
    g.runner.group.position.set(MR.K.LANE_X[1], 0, z);
    for (let i = 0; i < 4; i++) g.cam.update(0.5, { z: z, x: MR.K.LANE_X[1], y: 0, speed: 0, lean: 0, duck01: 0 });
    window.__render = function () { g.renderer.render(g.scene, g.cam.camera); };
    const objs = [];
    g.world.group.traverse(function (o) {
      if (o.userData && o.userData.body && o.userData.body.userData &&
          o.userData.body.userData.fill && Math.abs(o.position.z - gate.z) < 0.01) objs.push(o);
    });
    window.B = objs;

    // Project the train's own bounding box to screen so the sampler always
    // measures the train and not whatever is behind it.
    const cam = g.cam.camera;
    const v = new THREE.Vector3();
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    const o = objs[0];
    const halfW = 1.05 * (MR.K.LANE_X[0] - MR.K.LANE_X[1]) / 2.35;
    for (const sx of [-halfW, halfW]) for (const sy of [0.5, 2.6]) for (const sz of [-0.6, 0.5]) {
      v.set(o.position.x + sx, sy, o.position.z + sz).project(cam);
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
      miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
    }
    window.__rect = {
      x: Math.round((minx * 0.5 + 0.5) * innerWidth),
      y: Math.round((0.5 - maxy * 0.5) * innerHeight),
      w: Math.round((maxx - minx) * 0.5 * innerWidth),
      h: Math.round((maxy - miny) * 0.5 * innerHeight),
    };
    return {
      gateZ: +gate.z.toFixed(1), train: gate.train, lanes: gate.lanes, blockLane: blockLane,
      camPos: cam.position.toArray().map((n) => +n.toFixed(2)),
      found: objs.length, blockX: objs.map((b) => +b.position.x.toFixed(2)),
      rect: window.__rect,
    };
  }, { back: parseFloat(arg('back', 16)) });
  console.log('SETUP ' + JSON.stringify(setup));

  for (const [name, fn] of VARIANTS) {
    const stat = await page.evaluate((src) => {
      (0, eval)('(' + src + ')')();
      const g = MR.game;
      g.renderer.info.reset();
      window.__render();
      // Read the framebuffer back directly -- a screenshot crop would include
      // the HUD, and the canvas is what the renderer actually produced.
      const cv = g.renderer.domElement;
      const gl = g.renderer.getContext();
      const r = window.__rect;
      const px = new Uint8Array(r.w * r.h * 4);
      // gl y is bottom-up.
      gl.readPixels(r.x, cv.height - (r.y + r.h), r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sr = 0, sg = 0, sb = 0, n = r.w * r.h;
      for (let i = 0; i < n; i++) { sr += px[i * 4]; sg += px[i * 4 + 1]; sb += px[i * 4 + 2]; }
      return {
        rgb: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
        draws: g.renderer.info.render.calls,
      };
    }, fn);
    const f = path.join(OUT, name + '.png');
    await page.screenshot({ path: f });
    console.log(`${name.padEnd(20)} meanRGB ${JSON.stringify(stat.rgb).padEnd(18)} draws ${stat.draws}`);
  }

  for (const l of logs.slice(0, 6)) console.log('  | ' + l);
  await browser.close();
})();
