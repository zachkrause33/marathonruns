#!/usr/bin/env node
/**
 * Throwaway: replicate OUTLINE_VS on the CPU for the block hazard.
 *
 * For a grid of pixels over the block's screen footprint it software-rasterises
 * both meshes -- the fill (no extrusion, FRONT faces only, as GL culls) and the
 * shell (extruded, BACK faces only) -- and reports how often the shell wins the
 * depth test, plus which source primitive of the merged geometry is winning.
 */
const { chromium } = require('playwright');
const path = require('path');

const args = process.argv.slice(2);
function arg(n, d) { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; }

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

  const out = await page.evaluate(({ back, thick }) => {
    window.requestAnimationFrame = function () { return 0; };
    const g = MR.game;
    const trains = g.course.gates.filter((x) => x.train);
    let gate = trains[0];
    for (const t of trains) if (t.train > gate.train) gate = t;
    const z = gate.z - back;
    g.pace.units = z; g.pace.miles = z / MR.K.TOTAL_UNITS * 26.2;
    g.world.update(z, 1);
    g.runner.group.position.set(MR.K.LANE_X[1], 0, z);
    for (let i = 0; i < 4; i++) g.cam.update(0.5, { z: z, x: MR.K.LANE_X[1], y: 0, speed: 0, lean: 0, duck01: 0 });
    g.renderer.render(g.scene, g.cam.camera);

    let blk = null;
    g.world.group.traverse(function (o) {
      if (o.userData && o.userData.body && o.userData.body.userData &&
          o.userData.body.userData.fill && Math.abs(o.position.z - gate.z) < 0.01) blk = o;
    });
    const body = blk.userData.body;
    const fill = body.userData.fill, line = body.userData.line;
    const cam = g.cam.camera;
    g.scene.updateMatrixWorld(true); cam.updateMatrixWorld(true);

    const mv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, fill.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(mv);
    const proj = cam.projectionMatrix;

    const pos = fill.geometry.attributes.position;
    const nor = fill.geometry.attributes.normal;
    const N = pos.count;
    // The merged geometry is a concatenation of BoxGeometry blocks, 36 verts
    // each; index/36 therefore names the source primitive.
    const PART = ['body', 'skirt', 'stripe', 'roofrail', 'beaconL', 'beaconR'];

    function build(t) {
      const P = new Float64Array(N * 4);
      const a = new THREE.Vector3(), n = new THREE.Vector3();
      const c = new THREE.Vector4();
      for (let i = 0; i < N; i++) {
        a.fromBufferAttribute(pos, i).applyMatrix4(mv);
        if (t !== 0) {
          n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
          const d = -a.z;
          const k = Math.min(3.6, Math.max(0.90, 0.75 + 0.05 * d));
          a.addScaledVector(n, t * k);
        }
        c.set(a.x, a.y, a.z, 1).applyMatrix4(proj);
        P[i * 4] = c.x; P[i * 4 + 1] = c.y; P[i * 4 + 2] = c.z; P[i * 4 + 3] = c.w;
      }
      return P;
    }

    // Nearest fragment at (px,py) among triangles of the requested facing.
    // wantFront true = GL FrontSide (CCW in NDC with y up), false = BackSide.
    function hit(P, px, py, wantFront) {
      let best = Infinity, bestTri = -1;
      for (let t = 0; t < N; t += 3) {
        const w0 = P[t * 4 + 3], w1 = P[(t + 1) * 4 + 3], w2 = P[(t + 2) * 4 + 3];
        if (w0 <= 0 || w1 <= 0 || w2 <= 0) continue;
        const x0 = P[t * 4] / w0, y0 = P[t * 4 + 1] / w0, z0 = P[t * 4 + 2] / w0;
        const x1 = P[(t + 1) * 4] / w1, y1 = P[(t + 1) * 4 + 1] / w1, z1 = P[(t + 1) * 4 + 2] / w1;
        const x2 = P[(t + 2) * 4] / w2, y2 = P[(t + 2) * 4 + 1] / w2, z2 = P[(t + 2) * 4 + 2] / w2;
        const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if ((area > 0) !== wantFront) continue;
        const d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
        if (Math.abs(d) < 1e-14) continue;
        const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / d;
        const l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / d;
        const l2 = 1 - l0 - l1;
        if (l0 < 0 || l1 < 0 || l2 < 0) continue;
        const zz = l0 * z0 + l1 * z1 + l2 * z2;
        if (zz < best) { best = zz; bestTri = t; }
      }
      return { z: best, part: bestTri < 0 ? null : PART[Math.floor(bestTri / 36)] || ('#' + Math.floor(bestTri / 36)) };
    }

    // Screen bounds of the block.
    const v = new THREE.Vector3();
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < N; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(fill.matrixWorld).project(cam);
      minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x);
      miny = Math.min(miny, v.y); maxy = Math.max(maxy, v.y);
    }

    const results = {};
    for (const t of thick) {
      const fillP = build(0), lineP = build(t);
      let shellWins = 0, fillWins = 0, none = 0;
      const winners = {};
      const G = 24;
      for (let iy = 0; iy < G; iy++) {
        for (let ix = 0; ix < G; ix++) {
          const px = minx + (maxx - minx) * (ix + 0.5) / G;
          const py = miny + (maxy - miny) * (iy + 0.5) / G;
          const f = hit(fillP, px, py, true);
          const s = hit(lineP, px, py, false);
          if (!isFinite(f.z) && !isFinite(s.z)) { none++; continue; }
          if (s.z <= f.z) { shellWins++; winners[s.part] = (winners[s.part] || 0) + 1; }
          else fillWins++;
        }
      }
      results['t=' + t] = { shellWins, fillWins, offBlock: none, shellWinningPart: winners };
    }

    return {
      gateZ: +gate.z.toFixed(1), span: body.scale.z,
      camY: +cam.position.y.toFixed(3),
      blockTopY: 2.80,
      liveThickness: line.material.uniforms.thickness.value,
      results: results,
    };
  }, { back: parseFloat(arg('back', 16)), thick: [0.0, 0.001, 0.025, 0.30, -0.30] });

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
