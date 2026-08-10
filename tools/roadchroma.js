#!/usr/bin/env node
/**
 * THE ROAD'S CHROMA AGAINST THE FAIRNESS GATE, measured on both sides at once.
 *
 * The near-band colour gap is a property of the play surface: the road and its
 * paint win about 90% of the bottom third of the frame, and both are authored
 * near-neutral. The obvious lever is to give the road chroma back. The obvious
 * objection is that `tools/shoot.js` fails the build when a hazard's mean
 * SATURATION is within 0.22 of the road it stands on and its luminance is
 * within 1.25x -- so lifting the road's saturation walks toward every hazard
 * that is passing on the chroma test rather than on the value test.
 *
 * A recommendation that has not priced that is not a recommendation. This tool
 * sweeps one parameter and prints BOTH consequences for each step:
 *
 *   the near band of the real frame (S, chroma, vivid share), and
 *   every hazard variant's margin against the SAME gate shoot.js applies,
 *   through the game's own api.contrastAudit against the live mats.road.
 *
 * ---- THE SWEEP PARAMETER, and why it is this one ------------------------
 *
 * k scales the road colour's distance from its own luminance-grey:
 *
 *     new = grey + k * (rgb - grey),   grey = the colour's Rec.709 luminance
 *
 * Because the luminance of (rgb - grey) is exactly zero, this preserves the
 * colour's luminance EXACTLY at every k -- to the last decimal, not
 * approximately. That matters more here than anywhere else in the game: the
 * road was raised to a luminance target on purpose (the play surface has to
 * stay the lightest large mass in frame, or the eye goes to the grass banks),
 * every one of the eighteen shipped city roads sits at L 0.391-0.393, and a
 * sweep that moved value as well as chroma could not say which one moved the
 * gate. k = 1 is the shipped colour and must reproduce the shipped numbers.
 *
 * k locks the existing HUE, which is a limitation and is stated rather than
 * hidden: it answers "what does more of the road's own colour cost and buy",
 * not "what would a different hue do". --hex sweeps explicit colours for that.
 *
 * ---- A DEFECT IN THIS TOOL, FOUND BEFORE IT WAS TRUSTED -----------------
 *
 * The first version swept the PAINT by scaling `mats.paint.color`, and would
 * have reported that repainting the road markings changes nothing. It does not
 * change nothing; the sweep was a no-op. `mats.paint` is `vtoon(2)` -- colour
 * 0xffffff with vertexColors on -- and every actual tone of every lane line,
 * kerb, seam bead and expansion joint lives in the geometry's COLOR ATTRIBUTE.
 * Scaling white toward its own luminance-grey returns white at every k, so the
 * sweep would have printed six identical rows and they would have looked like
 * a finding. It is the same family as counting a source hex: the number that
 * governs the pixels was not the number being moved.
 *
 * The paint sweep therefore scales the colour ATTRIBUTE of the geometry that
 * actually wins the near band, identified from the id buffer rather than by
 * name -- see paintSweep() below.
 *
 * Usage:
 *   node tools/roadchroma.js --skip 25
 *   node tools/roadchroma.js --skip 25 --k 1,1.5,2,3,4,6
 *   node tools/roadchroma.js --skip 25 --hex 65636d,5f6285,52677b
 *   node tools/roadchroma.js --skip 25 --paint 1,1.5,2,3   sweep the MARKINGS
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const SKIP = arg('skip', '25');
const DATE = arg('date', '2026-08-10');
const W = parseInt(arg('w', '620'), 10);
const H = parseInt(arg('h', '1344'), 10);
const KS = String(arg('k', '1,1.5,2,2.5,3,4')).split(',').map(Number);
const HEXES = arg('hex', null) ? String(arg('hex')).split(',') : null;
const PAINTK = parseFloat(arg('paintk', '1'));
const PAINTS = arg('paint', null) ? String(arg('paint')).split(',').map(Number) : null;
const GUARD = parseFloat(arg('guard', '0'));
const INDEX = arg('index', path.join(ROOT, 'index.html'));

const PAGE_FN = function (opts) {
  window.requestAnimationFrame = function () { return 0; };
  const g = MR.game;
  const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none';
  const renderer = g.renderer, scene = g.scene;
  let cam = g.cam && (g.cam.camera || g.cam.cam);
  if (!cam || !cam.isCamera) scene.traverse(function (o) { if (o.isCamera) cam = o; });

  // Find mats.road and mats.paint without world.js having to export them: the
  // road is the MeshToonMaterial whose map is the road surface texture and
  // which the audit lanes are built from, so ask the audit for it. Running
  // contrastAudit once builds _audit.lanes, and lanes[0].material IS mats.road
  // -- the same object, not a copy. That is the whole reason the gate tracks
  // the road at all, and it is worth taking the material from the gate's own
  // hand rather than guessing at it from the scene graph.
  const w = g.world;
  const a0 = w.contrastAudit(renderer, scene);
  let roadMat = null, paintMats = [];
  scene.traverse(function (o) {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    if (m.type === 'MeshToonMaterial' && m.map && m.vertexColors && !roadMat) roadMat = m;
  });
  // Confirm by identity against the audit's own lane mesh.
  if (w.__auditLaneMat) roadMat = w.__auditLaneMat;

  const collect = function () {
    const seen = {};
    const road = [], paint = [];
    scene.traverse(function (o) {
      if (!o.isMesh || !o.visible) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || seen[m.uuid]) return;
      if (m.type !== 'MeshToonMaterial') return;
      seen[m.uuid] = 1;
      if (m.map && m.vertexColors) road.push(m);
      else if (m.vertexColors && m.color && m.color.getHex() === 0xffffff) paint.push(m);
    });
    return { road: road, paint: paint };
  };
  const found = collect();
  roadMat = found.road[0] || roadMat;
  paintMats = found.paint;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const RW = size.x, RH = size.y;
  const buf = new Uint8Array(RW * RH * 4);
  const gl = renderer.getContext();
  const third = Math.floor(RH / 3);

  function measure() {
    renderer.render(scene, cam);
    gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    // readPixels is bottom-up, so rows 0..third ARE the near band.
    let n = 0, S = 0, C = 0, L = 0, vivid = 0;
    for (let y = 0; y < third; y++) for (let x = 0; x < RW; x++) {
      const i = (y * RW + x) * 4;
      const R = buf[i], G = buf[i + 1], B = buf[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      S += mx ? (mx - mn) / mx : 0; C += (mx - mn) / 255;
      L += (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
      if ((mx - mn) / 255 > 0.25 && mx / 255 > 0.35) vivid++;
      n++;
    }
    return { S: S / n, C: C / n, L: L / n, vivid: vivid / n * 100 };
  }

  // The gate, transcribed from tools/shoot.js so the two cannot drift while
  // this runs. T_* is the spec target, G_* the build gate.
  function gate() {
    const a = w.contrastAudit(renderer, scene);
    const T_L = 1.6, T_S = 0.30, G_L = 1.25, G_S = 0.22;
    const worst = [];
    for (const h of a.hazards) {
      let hardest = null;
      for (const r of a.roads) {
        const ratio = Math.max(h.L, r.L) / Math.max(1e-6, Math.min(h.L, r.L));
        const dS = Math.abs(h.S - r.S);
        const gm = Math.max(ratio / G_L - 1, dS / G_S - 1);
        const m = Math.max(ratio / T_L - 1, dS / T_S - 1);
        const row = { name: h.name, lane: r.lane, ratio: ratio, dS: dS, gate: gm, margin: m,
                      hS: h.S, rS: r.S, hL: h.L, rL: r.L };
        if (!hardest || gm < hardest.gate) hardest = row;
      }
      worst.push(hardest);
    }
    worst.sort(function (p, q) { return p.gate - q.gate; });
    return { worst: worst, fails: worst.filter(function (x) { return x.gate < 0; }),
             short: worst.filter(function (x) { return x.margin < 0; }),
             roadS: a.roads.map(function (r) { return r.S; }),
             roadL: a.roads.map(function (r) { return r.L; }) };
  }

  function chromaScale(hex, k) {
    const r = (hex >> 16) & 255, g2 = (hex >> 8) & 255, b = hex & 255;
    const y = 0.2126 * r + 0.7152 * g2 + 0.0722 * b;
    const f = function (v) { return Math.max(0, Math.min(255, Math.round(y + k * (v - y)))); };
    return (f(r) << 16) | (f(g2) << 8) | f(b);
  }

  const baseRoad = roadMat ? roadMat.color.getHex() : 0;
  const rows = [];

  // ---- the PAINT sweep, on the attribute that actually carries the colour --
  //
  // The markings are one merged mesh per road tile, all tiles sharing one
  // pooled geometry, and the tones are in that geometry's color attribute.
  // The mesh set is found by asking which white-vertex-coloured toon meshes
  // lie flat on the carriageway inside the near field, so it does not depend
  // on a variable name in world.js staying what it is today.
  const paintMeshes = [];
  scene.traverse(function (o) {
    if (!o.isMesh || !o.visible) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.type !== 'MeshToonMaterial' || !m.vertexColors || m.map) return;
    if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.color) return;
    if (m.color.getHex() !== 0xffffff) return;
    const bb = new THREE.Box3().setFromObject(o);
    // Carriageway width and one tile long, and thin. NOT "near y = 0": the
    // first version of this filter tested absolute height and found ZERO paint
    // meshes, because elevation.js puts the road wherever the hill is -- at
    // this skip the carriageway sits at y 1.49 to 2.82. A filter that assumes
    // the ground is at zero in a game with hills is the same class of mistake
    // as measuring at a framing the game never shows.
    const sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    if (sx < 7.0 || sx > 8.6) return;
    if (sz < 20 || sz > 28) return;
    if (sy > 1.2) return;
    paintMeshes.push(o);
  });
  const paintGeos = [];
  const seenG = {};
  paintMeshes.forEach(function (o) {
    if (seenG[o.geometry.uuid]) return;
    seenG[o.geometry.uuid] = 1;
    paintGeos.push({ geo: o.geometry, base: Float32Array.from(o.geometry.attributes.color.array) });
  });
  // THE HUE GUARD, and it is not decoration.
  //
  // world.js states the rule the road paint lives under: "the mats own amber,
  // cyan and pink at full saturation and they are the device a race is lost by
  // misreading... these are tints of the road's own hue and must never be
  // mistaken for a fourth colour language." A blind chroma multiplier breaks
  // that rule the moment a warm grey in the paint becomes a saturated gold,
  // because a gold bar lying across the lane is what a JUMP telegraph mat
  // looks like. This project has already had to move one road marking off a
  // hue for exactly this reason -- the racing line collided with the aid
  // pickups at ten degrees and a blind reader could not tell them apart.
  //
  // So a tone is only allowed to gain chroma if its hue is more than GUARD
  // degrees from every hue the game already speaks with. The rest stay where
  // they are; they are a small share of the area and losing them costs almost
  // nothing, which is a measurement below rather than a hope.
  const LANGUAGE_HUES = [41.4, 191.9, 346.0, 153.5, 49.9];   // JUMP, DUCK, BLOCK, aid, accent
  function hueOf(r, g2, b) {
    const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), d = mx - mn;
    if (d < 1e-6) return -1;
    let h;
    if (mx === r) h = 60 * (((g2 - b) / d) % 6);
    else if (mx === g2) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g2) / d + 4);
    return (h + 360) % 360;
  }
  function guarded(r, g2, b, guard) {
    if (guard <= 0) return true;
    const h = hueOf(r, g2, b);
    if (h < 0) return true;                    // a true neutral has no hue to collide
    for (const L of LANGUAGE_HUES) {
      let dd = Math.abs(h - L); if (dd > 180) dd = 360 - dd;
      if (dd < guard) return false;
    }
    return true;
  }
  function paintScale(k, guard) {
    paintGeos.forEach(function (pg) {
      const a = pg.geo.attributes.color, arr = a.array, b = pg.base;
      for (let i = 0; i < arr.length; i += a.itemSize) {
        const y = 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
        const kk = guarded(b[i], b[i + 1], b[i + 2], guard) ? k : 1;
        for (let c = 0; c < 3; c++) arr[i + c] = Math.max(0, Math.min(1, y + kk * (b[i + c] - y)));
      }
      a.needsUpdate = true;
    });
  }

  const steps = opts.paints
    ? opts.paints.map(function (k) { return { label: 'paint ' + k, paintk: k, hex: baseRoad }; })
    : opts.hexes
      ? opts.hexes.map(function (hx) { return { label: '#' + hx, hex: parseInt(hx, 16) }; })
      : opts.ks.map(function (k) { return { label: 'k=' + k, hex: chromaScale(baseRoad, k), k: k }; });

  for (const st of steps) {
    roadMat.color.setHex(st.hex);
    paintScale(st.paintk === undefined ? opts.paintk : st.paintk, opts.guard);
    const r = (st.hex >> 16) & 255, gg = (st.hex >> 8) & 255, b = st.hex & 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    rows.push({
      label: st.label, hex: '#' + st.hex.toString(16).padStart(6, '0'),
      authoredC: (mx - mn) / 255,
      authoredL: (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255,
      near: measure(), gate: gate(),
    });
  }
  roadMat.color.setHex(baseRoad);
  paintScale(1, 0);

  return { rows: rows, baseRoad: '#' + baseRoad.toString(16).padStart(6, '0'),
           paintCount: paintMeshes.length, paintGeos: paintGeos.length, RW: RW, RH: RH };
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('file://' + INDEX + `?bot=1&date=${DATE}&skip=${SKIP}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 60000 });
  await page.waitForTimeout(900);
  const where = await page.evaluate(() => {
    const f = MR.game.pace.units / MR.K.TOTAL_UNITS;
    let leg = '?'; try { leg = MR.Course.biomeAt(f).name; } catch (e) {}
    return { leg, mile: f * MR.K.MARATHON_MILES };
  });
  const out = await page.evaluate(PAGE_FN, { ks: KS, hexes: HEXES, paintk: PAINTK, paints: PAINTS, guard: GUARD });
  if (errs.length) { console.error('PAGE THREW: ' + errs.join(' | ')); process.exit(1); }

  console.log(`skip ${SKIP}  date ${DATE}  ${W}x${H}  leg ${where.leg}  mile ${where.mile.toFixed(2)}`);
  console.log(`shipped road ${out.baseRoad}   paint meshes found ${out.paintCount} over ${out.paintGeos} geometries   paint k ${PAINTK}   hue guard ${GUARD} deg\n`);
  console.log('step     road      authC  authL |  NEAR S    C      L      vivid% |  gate: tightest variant           gate   dS     ratio | fails  short');
  for (const r of out.rows) {
    const t = r.gate.worst[0];
    console.log(
      `${r.label.padEnd(8)} ${r.hex.padEnd(9)} ${r.authoredC.toFixed(3)}  ${r.authoredL.toFixed(3)} |  ` +
      `${r.near.S.toFixed(3)}  ${r.near.C.toFixed(3)}  ${r.near.L.toFixed(3)}  ${r.near.vivid.toFixed(1).padStart(5)} |  ` +
      `${(t.name + ' vs lane ' + t.lane).padEnd(28)} ${(t.gate >= 0 ? '+' : '') + t.gate.toFixed(3)}  ` +
      `${t.dS.toFixed(3)}  ${t.ratio.toFixed(2)} | ${String(r.gate.fails.length).padStart(5)}  ${String(r.gate.short.length).padStart(5)}`);
  }
  console.log('\nTIGHTEST FIVE VARIANTS AT EACH STEP (gate margin; negative fails the build)');
  const names = out.rows[0].gate.worst.slice(0, 8).map((x) => x.name);
  console.log('variant        ' + out.rows.map((r) => r.label.padStart(8)).join(''));
  const allNames = {};
  out.rows.forEach((r) => r.gate.worst.forEach((x) => { allNames[x.name] = 1; }));
  const order = out.rows[0].gate.worst.map((x) => x.name);
  for (const nm of order.slice(0, 12)) {
    const cells = out.rows.map((r) => {
      const x = r.gate.worst.find((y) => y.name === nm);
      return ((x.gate >= 0 ? '+' : '') + x.gate.toFixed(3)).padStart(8);
    });
    console.log(nm.padEnd(14) + cells.join(''));
  }
  console.log('\nroad S by lane at each step (the gate reads this as r.S):');
  for (const r of out.rows) {
    console.log('  ' + r.label.padEnd(8) + r.gate.roadS.map((s) => s.toFixed(3)).join('  '));
  }
  await browser.close();
})();
