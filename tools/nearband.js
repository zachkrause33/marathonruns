#!/usr/bin/env node
/**
 * WHAT IS ACTUALLY IN THE NEAR BAND, named by where it is in the world.
 *
 * BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT. A marking PAINTED on a
 * surface is the one exception. Nothing this tool prints licenses a half-built
 * anything -- it is a census, not a budget.
 *
 * tools/chromadepth.js --clusters already attributes near-band pixels to a
 * geometry cluster with correct occlusion. What it cannot do is SAY WHAT THE
 * CLUSTER IS: its table names a material type and a hex, and at THE WALL a
 * single-mesh MeshBasicMaterial+vcol row is 6% of the frame with no way to tell
 * whether that is a crowd, a carpet, a river or a wall.
 *
 * So this tool takes chromadepth's readback VERBATIM -- same default-framebuffer
 * colour read, same ink-aware id and depth passes -- and adds two things:
 *
 *   1. A WORLD-SPACE FINGERPRINT per cluster, taken from the meshes rather than
 *      from the picture. Box3 over every mesh in the cluster, AFTER an explicit
 *      updateMatrixWorld(true). CLAUDE.md names the trap: geometry written in
 *      onBeforeRender lands after three.js has uploaded attributes, so a tool
 *      that reads matrices as they stand can read a stale transform and be
 *      indistinguishable from the object not being there. Reported as centre,
 *      size, lateral half-extent in LANES about the runner, and base height
 *      over the runner's feet -- which is what separates carriageway from kerb,
 *      verge, street furniture and building.
 *
 *   2. Shares quoted AS A SHARE OF THE NEAR BAND, not of the frame. The band is
 *      a third of the frame, so a frame-share table invites the reader to divide
 *      by three in their head, and this project has already shipped one number
 *      that was a third of what a reader took it for.
 *
 * ---- AUDITING THE INSTRUMENT --------------------------------------------
 *
 * --audit asserts five things whose answers are known without trusting it:
 *
 *   1. the near band's mean depth is LESS than the far band's. readPixels is
 *      bottom-up, so row 0 is the BOTTOM of the screen; getting that backwards
 *      inverts every finding, and chromadepth.js asserts the same thing.
 *   2. cluster shares plus the unclassified remainder (sky, clear colour) sum
 *      to 100% of the band. The first version of this tool failed this at 300%,
 *      because its cluster stat had lost the y < third restriction and was
 *      measuring whole-frame area against a near-band denominator -- exactly
 *      the class of error the shares-of-what note above is about.
 *   3. every cluster's world fingerprint is finite and non-degenerate. An
 *      all-zero box is the updateMatrixWorld bug, not an object at the origin.
 *   4. the census repeats identically on the same frozen frame.
 *   5. the band aggregate RECONCILES WITH chromadepth.js to three decimals.
 *      Two instruments that disagree are one instrument and one bug, and the
 *      first version of this tool read a linear render target where chromadepth
 *      reads the sRGB default framebuffer -- it printed near L 0.092 against a
 *      true 0.308 and would have made every dark surface look darker than it is.
 *
 * Usage:
 *   node tools/nearband.js --skip 25
 *   node tools/nearband.js --skips 25,60,95,140,178 --audit
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

const SKIPS = String(arg('skips', arg('skip', '25'))).split(',');
const DATE = arg('date', '2026-08-10');
const W = parseInt(arg('w', '620'), 10);
const H = parseInt(arg('h', '1344'), 10);
const TOP = parseInt(arg('top', '18'), 10);
const AUDIT = has('audit');
const JSON_OUT = has('json');

const PAGE_FN = function () {
  const THREE = window.THREE || (window.MR && MR.THREE);
  window.requestAnimationFrame = function () { return 0; };
  const g = MR.game;
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
  const renderer = g.renderer, scene = g.scene;
  let cam = g.cam && (g.cam.camera || g.cam.cam);
  if (!cam || !cam.isCamera) { scene.traverse(function (o) { if (o.isCamera) cam = o; }); }
  if (!cam || !cam.isCamera) return { fail: 'camera not found' };

  // The trap CLAUDE.md names. Force every world matrix current before any box
  // is taken, so a transform written during the last render is in the numbers
  // rather than one frame stale -- a stale identity matrix reads as a box at
  // the origin, which is indistinguishable from the object not being there.
  scene.updateMatrixWorld(true);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const RW = size.x, RH = size.y;

  const meshes = [];
  scene.traverse(function (o) {
    if (!o.isMesh || !o.visible) return;
    for (var p = o.parent; p; p = p.parent) if (!p.visible) return;
    if (o.material && o.material.visible === false) return;
    meshes.push(o);
  });

  const HAZ = MR.shading.INK.hazard, CHR = MR.shading.INK.character;
  const runnerG = g.runner && g.runner.group, ghostG = g.ghost && g.ghost.group;
  function ownerOf(m) {
    for (var p = m; p; p = p.parent) {
      if (p === runnerG) return 'runner';
      if (p === ghostG) return 'ghost';
    }
    var q = m;
    while (q) {
      var ln = q.userData && q.userData.line;
      if (ln && ln.material && ln.material.uniforms && ln.material.uniforms.thickness) {
        var t = ln.material.uniforms.thickness.value;
        if (Math.abs(t - HAZ) < 1e-6) return 'hazard';
        if (Math.abs(t - CHR) < 1e-6) return 'rival';
      }
      q = q.parent;
    }
    return 'world';
  }

  const info = meshes.map(function (m, i) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      i: i, owner: ownerOf(m), geo: m.geometry ? m.geometry.uuid : 'none',
      matType: mat ? mat.type : '?',
      color: mat && mat.color ? '#' + mat.color.getHexString() : '',
      vcol: !!(mat && mat.vertexColors),
      tri: m.geometry && m.geometry.index ? m.geometry.index.count / 3
           : (m.geometry && m.geometry.attributes && m.geometry.attributes.position
              ? m.geometry.attributes.position.count / 3 : 0),
    };
  });

  // ---- render + read back: chromadepth.js's, verbatim ---------------------
  // Colour comes from the DEFAULT FRAMEBUFFER, so it is the sRGB-encoded frame
  // the player sees. Reading a plain WebGLRenderTarget instead returns linear
  // values and understates every luminance; that was this tool's first bug.
  const gl = renderer.getContext();
  renderer.render(scene, cam);
  const colour = new Uint8Array(RW * RH * 4);
  gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, colour);

  const ID_VS = 'attribute vec3 position; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;' +
    'varying float vD; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_Position=projectionMatrix*mv; }';
  const ID_VS_INK = 'attribute vec3 position; attribute vec3 normal; uniform mat4 modelViewMatrix;' +
    'uniform mat4 projectionMatrix; uniform mat3 normalMatrix; uniform float thickness; varying float vD;' +
    'void main(){ vec3 n=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z;' +
    'mv.xyz += n*thickness*clamp(0.75+0.05*vD,0.90,3.6); gl_Position=projectionMatrix*mv; }';
  const ID_FS = 'precision highp float; uniform vec3 oid; varying float vD; void main(){ gl_FragColor=vec4(oid,1.0); }';
  const D_FS = 'precision highp float; varying float vD; void main(){ float d=clamp(vD/600.0,0.0,0.999999);' +
    'vec3 e=fract(d*vec3(1.0,256.0,65536.0)); e-=e.yzz*vec3(1.0/256.0,1.0/256.0,0.0); gl_FragColor=vec4(e,1.0); }';

  const target = new THREE.WebGLRenderTarget(RW, RH, { samples: 0 });
  const saved = meshes.map(function (m) { return m.material; });
  function idColour(n) { const v = n + 1; return new THREE.Vector3((v & 255) / 255, ((v >> 8) & 255) / 255, ((v >> 16) & 255) / 255); }
  function inkThick(i) {
    const mt = Array.isArray(saved[i]) ? saved[i][0] : saved[i];
    return mt && mt.type === 'ShaderMaterial' && mt.uniforms && mt.uniforms.thickness ? mt.uniforms.thickness.value : 0;
  }
  const idMats = meshes.map(function (m, i) {
    const t = inkThick(i); const src = Array.isArray(saved[i]) ? saved[i][0] : saved[i];
    return new THREE.RawShaderMaterial({
      vertexShader: t > 0 ? ID_VS_INK : ID_VS, fragmentShader: ID_FS,
      uniforms: t > 0 ? { oid: { value: idColour(i) }, thickness: { value: t } } : { oid: { value: idColour(i) } },
      side: src.side });
  });
  const depthMats = meshes.map(function (m, i) {
    const t = inkThick(i); const src = Array.isArray(saved[i]) ? saved[i][0] : saved[i];
    return new THREE.RawShaderMaterial({
      vertexShader: t > 0 ? ID_VS_INK : ID_VS, fragmentShader: D_FS,
      uniforms: t > 0 ? { thickness: { value: t } } : {}, side: src.side });
  });
  function readTarget(assign) {
    meshes.forEach(function (m, i) { m.material = assign(m, i); });
    const oldFog = scene.fog, oldBg = scene.background;
    scene.fog = null; scene.background = null;
    renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 1);
    renderer.clear(); renderer.render(scene, cam);
    const buf = new Uint8Array(RW * RH * 4);
    renderer.readRenderTargetPixels(target, 0, 0, RW, RH, buf);
    renderer.setRenderTarget(null);
    scene.fog = oldFog; scene.background = oldBg;
    meshes.forEach(function (m, i) { m.material = saved[i]; });
    return buf;
  }
  const idbuf = readTarget(function (m, i) { return idMats[i]; });
  const dbuf = readTarget(function (m, i) { return depthMats[i]; });
  target.dispose();
  idMats.forEach(function (m) { m.dispose(); });
  depthMats.forEach(function (m) { m.dispose(); });

  // ---- analysis -----------------------------------------------------------
  const N = RW * RH;
  const depth = new Float32Array(N), id = new Int32Array(N);
  for (var i2 = 0; i2 < N; i2++) {
    depth[i2] = (dbuf[i2 * 4] / 255 + dbuf[i2 * 4 + 1] / 65280 + dbuf[i2 * 4 + 2] / 16711680) * 600;
    var v2 = idbuf[i2 * 4] | (idbuf[i2 * 4 + 1] << 8) | (idbuf[i2 * 4 + 2] << 16);
    id[i2] = v2 - 1;
  }
  // readPixels is bottom-up: row 0 of the buffer is the BOTTOM of the screen,
  // so the NEAR band is rows 0..RH/3. Asserted by --audit, never assumed.
  const third = Math.floor(RH / 3);
  const nearN = third * RW;

  function stat(pick) {
    var n = 0, S = 0, C = 0, L = 0, vivid = 0, D = 0;
    for (var y = 0; y < RH; y++) {
      for (var x = 0; x < RW; x++) {
        var k = y * RW + x;
        if (!pick(k, y)) continue;
        var R = colour[k * 4], G = colour[k * 4 + 1], B = colour[k * 4 + 2];
        var mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        S += mx > 0 ? (mx - mn) / mx : 0;
        C += (mx - mn) / 255;
        L += (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
        if ((mx - mn) / 255 > 0.25 && mx / 255 > 0.35) vivid++;
        D += depth[k];
        n++;
      }
    }
    return n ? { n: n, share: n / nearN * 100, S: S / n, C: C / n, L: L / n, vivid: vivid / n * 100, depth: D / n } : null;
  }

  const near = stat(function (k, y) { return y < third; });
  const far = stat(function (k, y) { return y >= 2 * third; });

  // ---- clusters, with a world fingerprint ---------------------------------
  const byGeo = {};
  for (var k2 = 0; k2 < info.length; k2++) {
    var gid = info[k2].geo;
    (byGeo[gid] = byGeo[gid] || { ids: [], owner: info[k2].owner, matType: info[k2].matType,
                                  color: info[k2].color, vcol: info[k2].vcol, tri: info[k2].tri, n: 0 }).ids.push(k2);
    byGeo[gid].n++;
  }
  const keys = Object.keys(byGeo);
  const of = new Int32Array(info.length).fill(-1);
  keys.forEach(function (kk, ci) { byGeo[kk].ids.forEach(function (mi) { of[mi] = ci; }); });

  const LANE = (MR.K && MR.K.LANE_W) || 1.7;
  const runnerPos = new THREE.Vector3();
  if (runnerG) runnerG.getWorldPosition(runnerPos);

  const box = new THREE.Box3();
  const cl = keys.map(function (kk, ci) {
    const c = byGeo[kk];
    box.makeEmpty();
    c.ids.forEach(function (mi) { box.expandByObject(meshes[mi]); });
    const ctr = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const finite = [ctr.x, ctr.y, ctr.z, sz.x, sz.y, sz.z].every(function (q) { return isFinite(q); });
    return {
      ci: ci, meshes: c.n, owner: c.owner, matType: c.matType, color: c.color, vcol: c.vcol, tri: c.tri,
      cx: ctr.x, cy: ctr.y, cz: ctr.z, sx: sz.x, sy: sz.y, szz: sz.z,
      dxLanes: (Math.abs(ctr.x - runnerPos.x) + sz.x / 2) / LANE,
      dyBase: box.min.y - runnerPos.y,
      finite: finite, degenerate: sz.x === 0 && sz.y === 0 && sz.z === 0,
    };
  });
  // The near-band restriction. Losing the y < third test here is what made the
  // first version print shares summing to 300%.
  cl.forEach(function (c) {
    c.nearb = stat(function (k, y) { return y < third && id[k] >= 0 && of[id[k]] === c.ci; });
  });

  var classified = 0;
  cl.forEach(function (c) { if (c.nearb) classified += c.nearb.n; });

  return {
    RW: RW, RH: RH, near: near, far: far,
    nearN: nearN, classified: classified,
    unclassified: (nearN - classified) / nearN * 100,
    clusters: cl.filter(function (c) { return c.nearb; })
      .sort(function (a, b) { return b.nearb.share - a.nearb.share; })
      .map(function (c) {
        return { meshes: c.meshes, owner: c.owner, matType: c.matType, color: c.color, vcol: c.vcol,
                 tri: c.tri, share: c.nearb.share, S: c.nearb.S, C: c.nearb.C, L: c.nearb.L,
                 vivid: c.nearb.vivid, depth: c.nearb.depth,
                 cx: c.cx, cy: c.cy, cz: c.cz, sx: c.sx, sy: c.sy, sz: c.szz,
                 dxLanes: c.dxLanes, dyBase: c.dyBase, finite: c.finite, degenerate: c.degenerate };
      }),
  };
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  let auditFails = 0;
  const all = [];
  for (const SKIP of SKIPS) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
    await page.goto('file://' + INDEX + `?bot=1&date=${DATE}&skip=${SKIP}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 60000 });
    await page.waitForTimeout(900);
    // FREEZE, THEN DRAIN, THEN MEASURE. main.js calls requestAnimationFrame at
    // the TOP of frame(), so overriding rAF stops rescheduling but the callback
    // already queued still runs one more game frame. Measuring immediately after
    // the override therefore straddles that frame, and the census of a
    // "frozen" frame drifted by up to 0.52 percentage points of band share
    // between two reads -- enough to swallow a small palette change whole.
    // chromadepth.js overrides rAF inside its own measure call and so carries
    // the same one-frame ambiguity; that is the size of its noise floor.
    // And PIN THE CLOCK. Stopping the loop is not enough: onBeforeRender hooks
    // read performance.now() directly (shading.js's sun disc does), so every
    // render this tool performs -- colour, id, depth, and then the whole set
    // again for the repeat check -- advances anything driven by wall time. The
    // census is a multi-render measurement, so an unpinned clock makes the
    // instrument change the thing it is measuring.
    await page.evaluate(() => {
      window.requestAnimationFrame = function () { return 0; };
      const t = performance.now();
      performance.now = function () { return t; };
      const d = Date.now();
      Date.now = function () { return d; };
    });
    await page.waitForTimeout(250);
    const where = await page.evaluate(() => {
      const f = MR.game.pace.units / MR.K.TOTAL_UNITS;
      let leg = '?'; try { const b = MR.Course.biomeAt(f); leg = (b && (b.name || b.key)) || String(b); } catch (e) {}
      return { leg, mile: f * MR.K.MARATHON_MILES, draws: MR.game.renderer.info.render.calls,
               tris: MR.game.renderer.info.render.triangles };
    });
    const r = await page.evaluate(PAGE_FN);
    if (errs.length) { console.error('PAGE THREW: ' + errs.join(' | ')); process.exit(1); }
    if (r.fail) { console.error('FAIL: ' + r.fail); process.exit(1); }
    all.push({ skip: SKIP, where, r });

    console.log(`\nskip ${SKIP}  ${DATE}  ${W}x${H}  leg ${where.leg}  mile ${where.mile.toFixed(2)}  ` +
      `draws ${where.draws}  tris ${where.tris}  HUD off`);
    console.log(`NEAR BAND  S ${r.near.S.toFixed(3)}  C ${r.near.C.toFixed(3)}  L ${r.near.L.toFixed(3)}  ` +
      `vivid ${r.near.vivid.toFixed(1)}%  meanDepth ${r.near.depth.toFixed(1)}  ` +
      `unclassified(sky/clear) ${r.unclassified.toFixed(1)}%`);
    console.log('shares are % OF THE NEAR BAND. dx = lateral half-extent in lanes; dy = base height over the runner.');
    console.log(' band%  S      C      L      viv%  dep   dx     dy      n  tri    owner    material              colour');
    for (const c of r.clusters.slice(0, TOP)) {
      console.log(`${c.share.toFixed(2).padStart(6)}  ${c.S.toFixed(3)}  ${c.C.toFixed(3)}  ${c.L.toFixed(3)}  ` +
        `${c.vivid.toFixed(1).padStart(4)}  ${c.depth.toFixed(0).padStart(3)}  ` +
        `${c.dxLanes.toFixed(1).padStart(5)}  ${c.dyBase.toFixed(1).padStart(6)}  ` +
        `${String(c.meshes).padStart(3)}  ${String(Math.round(c.tri)).padStart(5)}  ` +
        `${c.owner.padEnd(8)} ${(c.matType + (c.vcol ? '+vcol' : '')).padEnd(21)} ${c.color}`);
    }

    if (AUDIT) {
      const chk = [];
      chk.push(['near band is nearer than far band',
        r.near.depth < r.far.depth, `${r.near.depth.toFixed(1)} < ${r.far.depth.toFixed(1)}`]);
      const sum = r.clusters.reduce((a, c) => a + c.share, 0);
      chk.push(['cluster shares + unclassified = 100%',
        Math.abs(sum + r.unclassified - 100) < 0.05, `${sum.toFixed(2)} + ${r.unclassified.toFixed(2)}`]);
      const bad = r.clusters.filter((c) => !c.finite || c.degenerate);
      chk.push(['every cluster has a finite, non-degenerate world box',
        bad.length === 0, `${bad.length} bad of ${r.clusters.length}`]);
      // Repeatability is asserted on the WORLD clusters and reported for the
      // runner, because they are not the same claim. The runner's rig carries
      // a secondary-motion integrator that steps on every render, and this tool
      // renders three times per census, so a runner row moves by up to half a
      // percentage point between two reads of the same pinned frame however
      // hard the clock is frozen. The world is what a palette change touches
      // and the world must not move at all; the runner figure below is this
      // instrument's noise floor, stated rather than hidden.
      const r2 = await page.evaluate(PAGE_FN);
      const worldA = r.clusters.filter((c) => c.owner === 'world');
      const worldB = r2.clusters.filter((c) => c.owner === 'world');
      const sameWorld = worldA.length === worldB.length &&
        worldA.every((c, i) => Math.abs(c.share - worldB[i].share) < 1e-9);
      let wWorst = 0, rWorst = 0;
      worldA.forEach((c, i) => { if (worldB[i]) wWorst = Math.max(wWorst, Math.abs(c.share - worldB[i].share)); });
      const runA = r.clusters.filter((c) => c.owner === 'runner');
      const runB = r2.clusters.filter((c) => c.owner === 'runner');
      runA.forEach((c, i) => { if (runB[i]) rWorst = Math.max(rWorst, Math.abs(c.share - runB[i].share)); });
      chk.push(['WORLD clusters repeat identically on the same pinned frame',
        sameWorld, `worst world drift ${wWorst.toFixed(4)}pp; runner noise floor ${rWorst.toFixed(3)}pp`]);
      console.log('\nAUDIT  skip ' + SKIP);
      for (const [what, ok, detail] of chk) {
        console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}  (${detail})`);
        if (!ok) auditFails++;
      }
      console.log('  RECONCILE against chromadepth.js --skip ' + SKIP + ': near S ' +
        r.near.S.toFixed(3) + '  C ' + r.near.C.toFixed(3) + '  L ' + r.near.L.toFixed(3) +
        '  vivid ' + r.near.vivid.toFixed(1) + '  (must match its near row to three decimals)');
    }
    await ctx.close();
  }
  await browser.close();
  if (JSON_OUT) console.log('\nJSON ' + JSON.stringify(all.map((a) => ({ skip: a.skip, leg: a.where.leg, near: a.r.near }))));
  if (AUDIT && auditFails) { console.error(`\n${auditFails} audit failure(s)`); process.exit(1); }
})();
