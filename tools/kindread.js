#!/usr/bin/env node
/**
 * KINDREAD -- can a player tell GO OVER from GO UNDER from GO AROUND at the
 * distance the lane is actually chosen, WITHOUT using the hazard's hue?
 *
 *   node tools/kindread.js
 *   node tools/kindread.js --d 25.35 --bands 14
 *
 * ---- WHY THIS EXISTS ------------------------------------------------------
 *
 * world.js pins three kind hues -- amber JUMP, cyan DUCK, pink BLOCK -- and
 * docs/roadmap.md records them sitting 33 degrees apart in hue, as the channel
 * a player reads "over / under / around" from before the shape resolves. That
 * made the hue of every hazard in the game unavailable for anything else, and
 * it is why the DUCK bar is cyan rather than the yellow-and-black a real road
 * uses, and why the cones on JUMP v1 could not simply be orange.
 *
 * The claim was never measured. This measures it, and it measures the OTHER
 * channel at the same time, because the answer only matters as a comparison:
 *
 *   HUE          the mean hue of the object's own pixels.
 *   PROFILE      where the object's mass sits in the collision box, as
 *                fourteen bands of occupancy from the road to 2.80.
 *
 * The profile is the physical fact the three kinds are made of. A JUMP is mass
 * on the road and nothing above 0.80; a DUCK is a GAP from the road to 1.41
 * with a bar over it; a BLOCK is mass from the road past the 2.05 jump apex.
 * Those are not three shades of one signal, they are three different objects,
 * and if they separate on their own then hue is a redundant second copy and
 * can be spent on saying what the object IS -- which is what the owner asked
 * for when they wrote "the color is an important detail as it makes sense to
 * people what it is".
 *
 * ---- THE MEASUREMENT ------------------------------------------------------
 *
 * Every variant is placed where a gate at READ_NEAR would put it -- lane x
 * from K.LANE_X, y from the course's own elevation, pitched by the road's own
 * slope -- and rendered THROUGH THE LIVE CHASE CAMERA, exactly as
 * tools/framing.js does it and for the same reason: an orthographic lens the
 * builder chose is the wrong instrument for every question about reading.
 *
 * Occupancy is counted inside the LANE COLUMN, not inside the object's own
 * bounding box. A band's occupancy is the fraction of the lane's projected
 * width that the object's silhouette covers in that band, so "fills the lane"
 * and "two thin posts" are different numbers rather than the same one at two
 * scales. Screen rows are mapped back to world y by projecting the collision
 * box's own corners, so the bands are world bands and not screen bands.
 *
 * ---- THE VERDICT ----------------------------------------------------------
 *
 * A nearest-centroid classifier is run over each channel on its own. The
 * number that matters is the MARGIN: the smallest distance from a variant to a
 * foreign kind's centroid, minus its distance to its own. Positive on every
 * variant means the channel separates the three kinds by itself.
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
// READ_NEAR. The distance the lane is chosen at, and the distance every
// identification claim in docs/roadmap.md entry 33 turned out to fail at.
const DIST = parseFloat(arg('d', 25.35));
const BANDS = parseInt(arg('bands', 14), 10);
const SKIP = String(arg('skip', '150'));
const W = parseInt(arg('w', 390), 10);
const H = parseInt(arg('h', 844), 10);
const JSON_OUT = arg('json', null);
// The tallest collision box in the game. One ruler for all three kinds -- see
// the note at the band loop for why banding each kind against its own box is
// the defect this project already has a roadmap entry for.
const CEIL = parseFloat(arg('ceil', 2.80));

function pageRun(o) {
  const g = MR.game, w = g.world, THREE = window.THREE, K = MR.K;
  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position);
  cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect;
  cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const EL = (g.course && g.course.elevation) || MR.Elevation.FLAT;
  const runnerZ = g.pace.units;
  const lane = g.player.lane;

  // Hide the live hazards; keep everything else, because the beauty frame is
  // what the hue is read off and a swatch is not a frame.
  const hidden = [];
  g.scene.traverse(function (n) {
    if (n.userData && n.userData.variants && n.visible) { hidden.push(n); n.visible = false; }
  });

  const holder = new THREE.Group();
  g.scene.add(holder);

  const rt = new THREE.WebGLRenderTarget(o.w, o.h);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(o.w * o.h * 4);
  const prevRT = g.renderer.getRenderTarget();
  const prevClr = new THREE.Color();
  g.renderer.getClearColor(prevClr);
  const prevA = g.renderer.getClearAlpha();

  // A flat white clone of the object, for the silhouette. Same geometry, same
  // transforms, same depth test, no shading and no fog -- so the mask is the
  // object's true screen footprint and not its lit one.
  function maskClone(obj) {
    const root = new THREE.Group();
    root.position.copy(obj.position);
    root.rotation.copy(obj.rotation);
    root.scale.copy(obj.scale);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, toneMapped: false });
    obj.traverse(function (n) {
      if (!n.isMesh) return;
      const mesh = new THREE.Mesh(n.geometry, white);
      mesh.renderOrder = n.renderOrder;
      n.updateMatrixWorld(true);
      obj.updateMatrixWorld(true);
      const rel = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(n.matrixWorld);
      rel.decompose(mesh.position, mesh.quaternion, mesh.scale);
      root.add(mesh);
    });
    return root;
  }

  function rgb2hsv(r, gg, b) {
    r /= 255; gg /= 255; b /= 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
    let h = 0;
    if (dd > 1e-6) {
      if (mx === r) h = 60 * (((gg - b) / dd) % 6);
      else if (mx === gg) h = 60 * ((b - r) / dd + 2);
      else h = 60 * ((r - gg) / dd + 4);
    }
    if (h < 0) h += 360;
    return [h, mx > 1e-6 ? dd / mx : 0, mx];
  }

  const out = [];
  const KINDS = [['JUMP', 1], ['DUCK', 2], ['BLOCK', 3]];
  const z = runnerZ + o.dist;
  const yBase = EL.at(z);

  for (const [kname, KID] of KINDS) {
    const BOX = MR.Collision.BOX[KID];
    for (let vi = 0; vi < 24; vi++) {
      const obj = w.variantObject(KID, vi);
      if (!obj) break;
      obj.position.set(K.LANE_X[lane], yBase, z);
      obj.rotation.x = -Math.atan(EL.slope(z));
      holder.clear();
      holder.add(obj);

      // -- the beauty frame, for the hue ------------------------------------
      g.renderer.setRenderTarget(rt);
      g.renderer.render(g.scene, cam);
      g.renderer.readRenderTargetPixels(rt, 0, 0, o.w, o.h, buf);
      const beauty = new Uint8Array(buf);

      // -- the mask frame ---------------------------------------------------
      holder.clear();
      holder.add(maskClone(obj));
      const saved = [];
      for (const n of g.scene.children) {
        if (n === holder || n.isLight) continue;
        saved.push([n, n.visible]);
        n.visible = false;
      }
      const prevFog = g.scene.fog;
      g.scene.fog = null;
      g.renderer.setClearColor(0x000000, 1);
      g.renderer.clear();
      g.renderer.render(g.scene, cam);
      g.renderer.readRenderTargetPixels(rt, 0, 0, o.w, o.h, buf);
      g.scene.fog = prevFog;
      for (const s of saved) s[0].visible = s[1];
      g.renderer.setClearColor(prevClr, prevA);

      // -- the lane column and the world-y ruler ---------------------------
      // THE RULER IS ONE RULER FOR ALL THREE KINDS, and that is not a detail.
      // MR.Collision.BOX gives each kind its OWN yMax -- JUMP 0.80, DUCK 1.83,
      // BLOCK 2.80 -- so banding each variant against its own box would put a
      // JUMP's top band at y 0.77 beside a BLOCK's at y 2.70 and print three
      // different objects as three identical profiles. That is roadmap entry
      // 2's defect exactly, and this instrument walked into it on its first
      // run. Every kind is measured against CEIL, the tallest box in the game,
      // so band 3 means "y 0.60 to 0.80" whatever the object is.
      //
      // The lane column is likewise ONE width: BOX.halfX is the same HALF_X on
      // all three kinds, so the denominator is the lane and not the kind.
      const p = new THREE.Vector3();
      function sy(worldY) {
        p.set(K.LANE_X[lane], yBase + worldY, z).project(cam);
        return (1 - (p.y * 0.5 + 0.5)) * o.h;
      }
      function sx(worldX) {
        p.set(K.LANE_X[lane] + worldX, yBase + o.ceil * 0.5, z).project(cam);
        return (p.x * 0.5 + 0.5) * o.w;
      }
      // MIN AND MAX, NOT LEFT AND RIGHT. The chase camera looks down -z, so
      // world +x projects to the SMALLER screen x: sx(-halfX) came back as 227
      // and sx(+halfX) as 185, the column window never opened, and every
      // profile in the first run of this tool was an honest-looking zero.
      // Caught by the audit trail three lines down and not by the eye.
      const cA = sx(-BOX.halfX), cB = sx(BOX.halfX);
      const laneW = Math.max(1e-6, Math.abs(cB - cA));
      const x0 = Math.max(0, Math.floor(Math.min(cA, cB)));
      const x1 = Math.min(o.w - 1, Math.ceil(Math.max(cA, cB)));

      // -- occupancy per world band, as a fraction of the lane's width ------
      const prof = new Array(o.bands).fill(0);
      const seen = new Array(o.bands).fill(0);
      for (let bi = 0; bi < o.bands; bi++) {
        const y0 = o.ceil * bi / o.bands, y1 = o.ceil * (bi + 1) / o.bands;
        const r1 = sy(y0), r0 = sy(y1);          // screen y grows downward
        const ra = Math.max(0, Math.floor(Math.min(r0, r1)));
        const rb = Math.min(o.h - 1, Math.ceil(Math.max(r0, r1)));
        let cov = 0, n = 0;
        for (let Y = ra; Y <= rb; Y++) {
          const flip = o.h - 1 - Y;             // readRenderTargetPixels is bottom-up
          for (let X = x0; X <= x1; X++) {
            const q = (flip * o.w + X) * 4;
            if (buf[q] > 96) cov++;
          }
          n++;
        }
        seen[bi] = n;
        prof[bi] = n ? cov / (n * laneW) : 0;
      }
      // The instrument's own audit trail. A band window that never opened and
      // a lane column one pixel wide both print as an honest zero above, and
      // this is how the difference is told without guessing.
      let mn = [1e9, 1e9, -1e9, -1e9];
      for (let Y = 0; Y < o.h; Y++) {
        for (let X = 0; X < o.w; X++) {
          if (buf[((o.h - 1 - Y) * o.w + X) * 4] <= 96) continue;
          if (X < mn[0]) mn[0] = X; if (Y < mn[1]) mn[1] = Y;
          if (X > mn[2]) mn[2] = X; if (Y > mn[3]) mn[3] = Y;
        }
      }

      // -- the hue of the object's own pixels, off the beauty frame ---------
      let hs = 0, hc = 0, sSum = 0, vSum = 0, np = 0;
      for (let q = 0; q < buf.length; q += 4) {
        if (buf[q] <= 96) continue;
        const R = beauty[q], G = beauty[q + 1], B = beauty[q + 2];
        const hsv = rgb2hsv(R, G, B);
        if (hsv[1] < 0.12) continue;            // a neutral has no hue to average
        const a = hsv[0] * Math.PI / 180;
        hs += Math.sin(a); hc += Math.cos(a);
        sSum += hsv[1]; vSum += hsv[2]; np++;
      }
      let hue = np ? Math.atan2(hs / np, hc / np) * 180 / Math.PI : 0;
      if (hue < 0) hue += 360;

      out.push({
        kind: kname, v: vi, prof: prof.map(function (x) { return +x.toFixed(4); }),
        hue: +hue.toFixed(1), sat: np ? +(sSum / np).toFixed(3) : 0,
        val: np ? +(vSum / np).toFixed(3) : 0, huePx: np,
        laneW: +laneW.toFixed(1), col: [x0, x1], maskBox: mn, rows: seen,
      });
      holder.clear();
    }
  }

  g.scene.remove(holder);
  for (const n of hidden) n.visible = true;
  g.renderer.setRenderTarget(prevRT);
  rt.dispose();
  return { rows: out, dist: o.dist, lane: lane };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  ! page error: ' + e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&skip=' + SKIP);
  await page.waitForTimeout(2600);
  const res = await page.evaluate(pageRun, { w: W, h: H, dist: DIST, bands: BANDS, ceil: CEIL });
  await browser.close();

  if (res.error) { console.log('FAILED: ' + res.error); process.exit(1); }
  const rows = res.rows;

  console.log('KINDREAD -- over / under / around at ' + res.dist + ' units, lane ' + res.lane);
  console.log('  viewport ' + W + 'x' + H + ', ' + BANDS + ' bands of ' + (2.80 / BANDS).toFixed(3) + ' world y');
  console.log('  occupancy is the fraction of the LANE WIDTH the silhouette covers in that band\n');

  const bar = ' .:-=+*#%@';
  console.log('  variant   hue    S     road' + ' '.repeat(BANDS - 8) + 'top   profile');
  for (const r of rows) {
    const g = r.prof.map(function (x) { return bar[Math.min(9, Math.round(x * 9))]; }).join('');
    console.log('  ' + (r.kind + ' v' + r.v).padEnd(10)
      + String(r.hue).padStart(5) + ' ' + String(r.sat).padStart(5) + '   |' + g + '|  '
      + r.prof.map(function (x) { return x.toFixed(2); }).join(' '));
  }

  // ---- nearest-centroid, each channel on its own -------------------------
  const kinds = ['JUMP', 'DUCK', 'BLOCK'];
  function centroids(vec) {
    const c = {};
    for (const k of kinds) {
      const m = rows.filter(function (r) { return r.kind === k; }).map(vec);
      const n = m[0].length;
      c[k] = new Array(n).fill(0);
      for (const v of m) for (let i = 0; i < n; i++) c[k][i] += v[i] / m.length;
    }
    return c;
  }
  function report(name, vec, dist) {
    const c = centroids(vec);
    let worst = null, wrong = 0;
    for (const r of rows) {
      const own = dist(vec(r), c[r.kind]);
      let near = Infinity, nearK = null;
      for (const k of kinds) {
        if (k === r.kind) continue;
        const d = dist(vec(r), c[k]);
        if (d < near) { near = d; nearK = k; }
      }
      const margin = near - own;
      if (margin <= 0) wrong++;
      if (!worst || margin < worst.margin) worst = { r: r, margin: margin, nearK: nearK };
    }
    console.log('\n  ' + name);
    console.log('    misclassified ' + wrong + ' of ' + rows.length
      + ';  tightest ' + worst.r.kind + ' v' + worst.r.v
      + ' margin ' + worst.margin.toFixed(3) + ' (nearest foreign kind ' + worst.nearK + ')');
    return { wrong: wrong, margin: worst.margin };
  }

  const L1 = function (a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s; };
  const HUED = function (a, b) {
    let d = Math.abs(a[0] - b[0]) % 360;
    return d > 180 ? 360 - d : d;
  };
  const pr = report('PROFILE alone (L1 over ' + BANDS + ' bands)', function (r) { return r.prof; }, L1);
  const hr = report('HUE alone (degrees around the wheel)', function (r) { return [r.hue]; }, HUED);

  console.log('\n  Both channels are measured on the SAME frames. A channel that');
  console.log('  misclassifies nothing carries the read on its own.');

  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(String(JSON_OUT)), JSON.stringify({ res: res, profile: pr, hue: hr }, null, 1));
    console.log('\n  wrote ' + JSON_OUT);
  }
})();
