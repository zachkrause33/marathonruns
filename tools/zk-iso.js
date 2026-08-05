#!/usr/bin/env node
/**
 * Throwaway isolating test. Drops three outlined test objects into the live
 * scene side by side -- a plain BoxGeometry, the real blockGeo, and blockGeo
 * with its winding reversed -- and samples each one's screen footprint. If the
 * plain box is bright and blockGeo is dark, the defect is in the geometry.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }
const OUT = path.resolve(arg('dir', '/tmp/zk-iso'));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror: ' + e.message));
  const file = path.resolve(arg('file', '/tmp/mr-base.html'));
  await page.goto('file://' + file + '?bot=1&skip=1&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(500);

  const out = await page.evaluate(() => {
    window.requestAnimationFrame = function () { return 0; };
    const g = MR.game, S = MR.shading;
    const z = 3000;
    g.pace.units = z; g.pace.miles = z / MR.K.TOTAL_UNITS * 26.2;
    g.world.update(z, 1);
    g.runner.group.position.set(MR.K.LANE_X[1], 0, z);
    for (let i = 0; i < 4; i++) g.cam.update(0.5, { z: z, x: MR.K.LANE_X[1], y: 0, speed: 0, lean: 0, duck01: 0 });

    // Grab the real blockGeo off any live block hazard.
    let blockGeo = null;
    g.world.group.traverse(function (o) {
      if (!blockGeo && o.userData && o.userData.body && o.userData.body.userData && o.userData.body.userData.fill) {
        const geo = o.userData.body.userData.fill.geometry;
        if (geo.attributes.position.count === 216) blockGeo = geo;   // 6 boxes x 36
      }
    });
    if (!blockGeo) {
      // Fall back: scan every hazard geometry and take the largest.
      g.world.group.traverse(function (o) {
        if (o.userData && o.userData.body && o.userData.body.userData && o.userData.body.userData.fill) {
          const geo = o.userData.body.userData.fill.geometry;
          if (!blockGeo || geo.attributes.position.count > blockGeo.attributes.position.count) blockGeo = geo;
        }
      });
    }

    const mat = g.world.mats.propLit;
    const box = new THREE.BoxGeometry(2.1, 2.3, 1.3).translate(0, 1.5, 0);
    // Vertex colours: the shared material reads them, so give the plain box
    // the block's own body colour.
    const bc = new THREE.Color(0xff3b6b);
    const n = box.attributes.position.count;
    const cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = bc.r; cols[i * 3 + 1] = bc.g; cols[i * 3 + 2] = bc.b; }
    box.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const boxNI = box.index ? box.toNonIndexed() : box;

    // blockGeo with its triangle winding reversed.
    const rev = blockGeo.clone();
    for (const key of ['position', 'normal', 'color', 'uv']) {
      const a = rev.attributes[key];
      if (!a) continue;
      const it = a.itemSize;
      for (let t = 0; t < a.count; t += 3) {
        for (let c = 0; c < it; c++) {
          const i0 = (t + 0) * it + c, i2 = (t + 2) * it + c;
          const tmp = a.array[i0]; a.array[i0] = a.array[i2]; a.array[i2] = tmp;
        }
      }
      a.needsUpdate = true;
    }

    const specs = [
      ['plainbox', boxNI, -3.4],
      ['blockGeo', blockGeo, 0.0],
      ['blockGeo-reversed', rev, 3.4],
    ];
    const probes = [];
    for (const [name, geo, dx] of specs) {
      const grp = S.outlined(geo, mat, S.INK.hazard);
      grp.position.set(dx, 0, z + 18);
      g.scene.add(grp);
      probes.push({ name, grp });
    }
    g.renderer.render(g.scene, g.cam.camera);

    const cam = g.cam.camera, v = new THREE.Vector3();
    const gl = g.renderer.getContext(), cv = g.renderer.domElement;
    const res = [];
    for (const p of probes) {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const sx of [-0.8, 0.8]) for (const sy of [0.6, 2.2]) {
        v.set(p.grp.position.x + sx, sy, p.grp.position.z).project(cam);
        minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
        miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
      }
      const rx = Math.round((minx * 0.5 + 0.5) * innerWidth);
      const ry = Math.round((0.5 - maxy * 0.5) * innerHeight);
      const rw = Math.max(2, Math.round((maxx - minx) * 0.5 * innerWidth));
      const rh = Math.max(2, Math.round((maxy - miny) * 0.5 * innerHeight));
      const px = new Uint8Array(rw * rh * 4);
      gl.readPixels(rx, cv.height - (ry + rh), rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < rw * rh; i++) { sr += px[i * 4]; sg += px[i * 4 + 1]; sb += px[i * 4 + 2]; }
      res.push({ name: p.name, rgb: [Math.round(sr / (rw * rh)), Math.round(sg / (rw * rh)), Math.round(sb / (rw * rh))] });
    }
    return { camY: +cam.position.y.toFixed(3), blockVerts: blockGeo.attributes.position.count, res: res };
  });

  console.log(JSON.stringify(out, null, 2));
  await page.screenshot({ path: path.join(OUT, 'iso.png') });
  console.log('shot -> ' + path.join(OUT, 'iso.png'));
  await browser.close();
})();
