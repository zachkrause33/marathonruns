#!/usr/bin/env node
/**
 * WHERE THE COLOUR GOES, by depth band, by system, and by LIGHTING STAGE.
 *
 * tools/chroma.js can say that our near band carries a third of the reference's
 * chroma. It cannot say why, because a screenshot has no depth and no object
 * identity. This tool renders the same frozen frame many times through the
 * game's own renderer and reads it back, so every number is a property of the
 * shipped pipeline rather than of a description of it.
 *
 * It answers three questions that are usually run together and should not be:
 *
 *   1. WHICH BAND. Linear view depth, packed to 24 bits, cut into the same
 *      bands docs/clarity-pass.md used, so the two reconcile.
 *   2. WHICH SYSTEM. Per-pixel mesh identity with correct occlusion, clustered
 *      by geometry UUID -- everything pooled shares one geometry, so geometry
 *      identity is system identity and does not depend on anyone's reading of
 *      world.js being right.
 *   3. WHICH STAGE. Saturation is a property of the LIT RESULT, so an authored
 *      palette and a rendered frame are different claims -- this project has
 *      confused the two at least twice, most expensively when it counted a
 *      source hex 43 times and the screen turned out to hold zero of those
 *      pixels. The --mode ablations below take the pipeline apart one stage at
 *      a time and re-measure, so the loss is attributed to a stage by
 *      experiment rather than by argument.
 *
 * ---- THE MODES -----------------------------------------------------------
 *
 *   shipped    baseline, untouched.
 *   control    runs the whole ablation plumbing and changes NOTHING. If this
 *              does not reproduce `shipped` to the last decimal the tool is
 *              lying and every other row is void. Run it every time.
 *   albedo     every lit material replaced by an unlit MeshBasicMaterial of
 *              the same colour / vertex colours. This is the CEILING the
 *              authored palette can deliver: the frame with the lighting
 *              taken out but the art left in. shipped-vs-albedo is what the
 *              lighting stage costs; albedo-vs-reference is what the PALETTE
 *              costs, and the two are different bills.
 *   nofog      scene.fog removed and the outline pass's fog pushed past the
 *              far plane. Fog near is 60 units; if the near band is inside
 *              that, this must move nothing, and a mode that must move
 *              nothing is the strongest test there is.
 *   noink      every ink shell hidden.
 *   nohemi     hemisphere fill off.       noamb   ambient off.
 *   nobounce   the cool camera-facing bounce off.
 *   keyonly    hemisphere, ambient and bounce all off -- key light alone.
 *   whitelight every light's colour forced to white, intensities untouched.
 *              Separates the light SUM (which multiplies chroma down with
 *              value) from the light TINT (which shifts hue and can cancel
 *              the albedo's own).
 *   rampwhite  every toon gradient map replaced by a flat white ramp, so the
 *              banding and its blue-cooled dark end are gone and the shading
 *              is plain lambert. Isolates the ramp from the rig.
 *   rampfloor  the ramp rebuilt at floor 0.60 instead of 0.31, everything
 *              else untouched. This is a candidate FIX measured rather than
 *              argued.
 *
 * Usage:
 *   node tools/chromadepth.js --skip 25 --mode shipped
 *   node tools/chromadepth.js --skip 25 --modes shipped,control,albedo,nofog
 *   node tools/chromadepth.js --skip 25 --clusters        per-system table
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

const SKIP = arg('skip', '25');
const DATE = arg('date', '2026-08-10');
const W = parseInt(arg('w', '620'), 10);
const H = parseInt(arg('h', '1344'), 10);
const MODES = String(arg('modes', arg('mode', 'shipped'))).split(',');
const CLUSTERS = has('clusters');
const TOP = parseInt(arg('top', '16'), 10);
const INDEX = arg('index', path.join(ROOT, 'index.html'));

const PAGE_FN = function (opts) {
  const MODE = opts.mode, CLUSTERS = opts.clusters;
  window.requestAnimationFrame = function () { return 0; };
  const g = MR.game;
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
  const renderer = g.renderer, scene = g.scene;
  let cam = g.cam && (g.cam.camera || g.cam.cam);
  if (!cam || !cam.isCamera) { scene.traverse(function (o) { if (o.isCamera) cam = o; }); }
  if (!cam || !cam.isCamera) return { fail: 'camera not found' };

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const RW = size.x, RH = size.y;

  const meshes = [];
  scene.traverse(function (o) {
    if (!o.isMesh || !o.visible) return;
    for (var p = o.parent; p; p = p.parent) if (!p.visible) return;
    if (o.material && o.material.visible === false) return;
    meshes.push(o);
  });

  const lights = [];
  scene.traverse(function (o) { if (o.isLight) lights.push(o); });

  // ---- role, exactly as inkbudget.js defines it (root before ink weight;
  // testing ink first files the player as a rival, which it once did) --------
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
      isInk: !!(mat && mat.type === 'ShaderMaterial' && mat.uniforms && mat.uniforms.thickness),
    };
  });

  // ---- the ablation ------------------------------------------------------
  const undo = [];
  function setLight(l, k, v) { const old = l[k]; undo.push(function () { l[k] = old; }); l[k] = v; }
  function swapMat(m, nm) { const old = m.material; undo.push(function () { m.material = old; }); m.material = nm; }

  function whiteRamp() {
    const d = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
    const t = new THREE.DataTexture(d, 2, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }

  if (MODE === 'albedo') {
    meshes.forEach(function (m) {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || !mat.color || mat.type === 'MeshBasicMaterial') return;
      if (mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial') return;
      const nm = new THREE.MeshBasicMaterial({
        color: mat.color.clone(), vertexColors: mat.vertexColors, map: mat.map || null,
        transparent: mat.transparent, opacity: mat.opacity, side: mat.side,
        depthWrite: mat.depthWrite, depthTest: mat.depthTest, alphaTest: mat.alphaTest,
        blending: mat.blending, fog: mat.fog,
      });
      swapMat(m, nm);
    });
  } else if (MODE === 'nofog') {
    const oldFog = scene.fog;
    undo.push(function () { scene.fog = oldFog; MR.shading.syncFog(oldFog); });
    scene.fog = null;
    // The outline pass carries its OWN copy of the fog and is not touched by
    // scene.fog, so removing only scene.fog would leave the ink still fading.
    MR.shading.syncFog({ color: new THREE.Color(1, 1, 1), near: 1e6, far: 2e6,
                         getHex: function () { return 0xffffff; } });
  } else if (MODE === 'noink') {
    meshes.forEach(function (m, i) {
      if (!info[i].isInk) return;
      undo.push(function () { m.visible = true; });
      m.visible = false;
    });
  } else if (MODE === 'nohemi') {
    lights.forEach(function (l) { if (l.isHemisphereLight) setLight(l, 'intensity', 0); });
  } else if (MODE === 'noamb') {
    lights.forEach(function (l) { if (l.isAmbientLight) setLight(l, 'intensity', 0); });
  } else if (MODE === 'nobounce') {
    lights.forEach(function (l) { if (l.isDirectionalLight && l.intensity < 1) setLight(l, 'intensity', 0); });
  } else if (MODE === 'keyonly') {
    lights.forEach(function (l) {
      if (l.isHemisphereLight || l.isAmbientLight) setLight(l, 'intensity', 0);
      if (l.isDirectionalLight && l.intensity < 1) setLight(l, 'intensity', 0);
    });
  } else if (MODE === 'whitelight') {
    lights.forEach(function (l) {
      if (l.color) { const c = l.color.clone(); undo.push(function () { l.color.copy(c); }); l.color.setRGB(1, 1, 1); }
      if (l.groundColor) { const c2 = l.groundColor.clone(); undo.push(function () { l.groundColor.copy(c2); }); l.groundColor.setRGB(1, 1, 1); }
    });
  } else if (MODE === 'rampwhite' || MODE === 'rampfloor') {
    const wr = MODE === 'rampwhite' ? whiteRamp() : null;
    const seen = {};
    meshes.forEach(function (m) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(function (mat) {
        if (!mat || mat.type !== 'MeshToonMaterial' || seen[mat.uuid]) return;
        seen[mat.uuid] = 1;
        const old = mat.gradientMap;
        const steps = old && old.image ? old.image.width : 3;
        undo.push(function () { mat.gradientMap = old; mat.needsUpdate = true; });
        mat.gradientMap = MODE === 'rampwhite' ? wr : MR.shading.ramp(steps, opts.floor);
        mat.needsUpdate = true;
      });
    });
  }

  // ---- render + read back ------------------------------------------------
  const gl = renderer.getContext();
  renderer.render(scene, cam);
  const colour = new Uint8Array(RW * RH * 4);
  gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, colour);

  // id + depth, MSAA off, always from the SHIPPED geometry regardless of mode
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
  function inkThick(m) {
    const mt = Array.isArray(saved[meshes.indexOf(m)]) ? saved[meshes.indexOf(m)][0] : saved[meshes.indexOf(m)];
    return mt && mt.type === 'ShaderMaterial' && mt.uniforms && mt.uniforms.thickness ? mt.uniforms.thickness.value : 0;
  }
  const idMats = meshes.map(function (m, i) {
    const t = inkThick(m); const src = Array.isArray(saved[i]) ? saved[i][0] : saved[i];
    return new THREE.RawShaderMaterial({
      vertexShader: t > 0 ? ID_VS_INK : ID_VS, fragmentShader: ID_FS,
      uniforms: t > 0 ? { oid: { value: idColour(i) }, thickness: { value: t } } : { oid: { value: idColour(i) } },
      side: src.side });
  });
  const depthMats = meshes.map(function (m, i) {
    const t = inkThick(m); const src = Array.isArray(saved[i]) ? saved[i][0] : saved[i];
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

  for (var u = undo.length - 1; u >= 0; u--) undo[u]();

  // ---- analysis ----------------------------------------------------------
  const N = RW * RH;
  const depth = new Float32Array(N), id = new Int32Array(N);
  for (var i = 0; i < N; i++) {
    depth[i] = (dbuf[i * 4] / 255 + dbuf[i * 4 + 1] / 65280 + dbuf[i * 4 + 2] / 16711680) * 600;
    var v = idbuf[i * 4] | (idbuf[i * 4 + 1] << 8) | (idbuf[i * 4 + 2] << 16);
    id[i] = v - 1;
  }
  // readPixels is bottom-up: row 0 of the buffer is the BOTTOM of the screen,
  // so the NEAR band is rows 0..RH/3, not RH*2/3..RH. Getting this backwards
  // inverts every per-band finding, so it is asserted rather than assumed --
  // the report prints mean depth per band and the near band must be nearest.
  function stat(pick) {
    var n = 0, S = 0, C = 0, L = 0, vivid = 0, D = 0;
    for (var y = 0; y < RH; y++) {
      for (var x = 0; x < RW; x++) {
        var i2 = y * RW + x;
        if (!pick(i2, y)) continue;
        var R = colour[i2 * 4], G = colour[i2 * 4 + 1], B = colour[i2 * 4 + 2];
        var mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        S += mx > 0 ? (mx - mn) / mx : 0;
        C += (mx - mn) / 255;
        L += (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
        if ((mx - mn) / 255 > 0.25 && mx / 255 > 0.35) vivid++;
        D += depth[i2];
        n++;
      }
    }
    return n ? { n: n, pix: n / N * 100, S: S / n, C: C / n, L: L / n, vivid: vivid / n * 100, depth: D / n } : null;
  }
  const third = Math.floor(RH / 3);
  const out = {
    RW: RW, RH: RH, mode: MODE,
    frame: stat(function () { return true; }),
    near: stat(function (i2, y) { return y < third; }),
    mid: stat(function (i2, y) { return y >= third && y < 2 * third; }),
    far: stat(function (i2, y) { return y >= 2 * third; }),
    d_fg: stat(function (i2) { return depth[i2] < 8; }),
    d_obst: stat(function (i2) { return depth[i2] >= 8 && depth[i2] < 30; }),
    d_read: stat(function (i2) { return depth[i2] >= 30 && depth[i2] < 90; }),
    d_env: stat(function (i2) { return depth[i2] >= 90 && depth[i2] < 235; }),
    d_sky: stat(function (i2) { return depth[i2] >= 235; }),
    // The near SCREEN band, restricted to the geometry that is genuinely near.
    near_ground: stat(function (i2, y) { return y < third && depth[i2] < 30; }),
  };
  const roles = {};
  ['runner', 'ghost', 'hazard', 'rival', 'world'].forEach(function (r) {
    roles[r] = stat(function (i2, y) { return y < third && id[i2] >= 0 && info[id[i2]].owner === r; });
  });
  out.roles = roles;

  if (CLUSTERS) {
    const byGeo = {};
    for (var k = 0; k < info.length; k++) {
      var gid = info[k].geo;
      (byGeo[gid] = byGeo[gid] || { geo: gid, ids: [], owner: info[k].owner, matType: info[k].matType,
                                    color: info[k].color, vcol: info[k].vcol, n: 0 }).ids.push(k);
      byGeo[gid].n++;
    }
    const of = new Int32Array(info.length).fill(-1);
    const keys = Object.keys(byGeo);
    keys.forEach(function (kk, ci) { byGeo[kk].ids.forEach(function (mi) { of[mi] = ci; }); });
    const cl = keys.map(function (kk) { return byGeo[kk]; });
    cl.forEach(function (c, ci) {
      c.all = stat(function (i2) { return id[i2] >= 0 && of[id[i2]] === ci; });
      c.nearb = stat(function (i2, y) { return y < third && id[i2] >= 0 && of[id[i2]] === ci; });
    });
    out.clusters = cl.filter(function (c) { return c.nearb; })
      .sort(function (a, b) { return b.nearb.pix - a.nearb.pix; })
      .slice(0, 40)
      .map(function (c) {
        return { meshes: c.n, owner: c.owner, matType: c.matType, color: c.color, vcol: c.vcol,
                 nearPix: c.nearb.pix, nearS: c.nearb.S, nearC: c.nearb.C, nearL: c.nearb.L,
                 nearVivid: c.nearb.vivid, nearDepth: c.nearb.depth };
      });
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const results = [];
  for (const mode of MODES) {
    // A FRESH PAGE PER MODE. Restoring an ablation in place is one missed undo
    // away from contaminating every row after it, and a contaminated sweep
    // that still looks plausible is exactly what this project keeps having to
    // withdraw. A reload costs ten seconds and removes the whole class.
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
    await page.goto('file://' + INDEX + `?bot=1&date=${DATE}&skip=${SKIP}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 60000 });
    await page.waitForTimeout(900);
    const where = await page.evaluate(() => {
      const f = MR.game.pace.units / MR.K.TOTAL_UNITS;
      let leg = '?'; try { const b = MR.Course.biomeAt(f); leg = (b && (b.name || b.key)) || String(b); } catch (e) {}
      return { leg, mile: f * MR.K.MARATHON_MILES };
    });
    const r = await page.evaluate(PAGE_FN, { mode, clusters: CLUSTERS && mode === 'shipped', floor: 0.60 });
    if (errs.length) { console.error('PAGE THREW during ' + mode + ': ' + errs.join(' | ')); process.exit(1); }
    r.leg = where.leg; r.mile = where.mile;
    results.push(r);
    await ctx.close();
  }

  const base = results[0];
  console.log(`skip ${SKIP}  date ${DATE}  ${W}x${H}  leg ${base.leg}  mile ${base.mile.toFixed(2)}  HUD off\n`);
  console.log('SCREEN BANDS (near = bottom third). meanDepth confirms the bands are not inverted.');
  console.log('mode        band    pix%   S      C      L      vivid%  meanDepth');
  for (const r of results) {
    for (const bandKey of ['frame', 'near', 'mid', 'far']) {
      const b = r[bandKey]; if (!b) continue;
      console.log(`${r.mode.padEnd(11)} ${bandKey.padEnd(7)} ${b.pix.toFixed(1).padStart(5)}  ${b.S.toFixed(3)}  ` +
        `${b.C.toFixed(3)}  ${b.L.toFixed(3)}  ${b.vivid.toFixed(1).padStart(5)}   ${b.depth.toFixed(1).padStart(6)}`);
    }
  }
  console.log('\nDEPTH BANDS, shipped frame (the clarity-pass cuts).');
  console.log('band                 pix%   S      C      L      vivid%');
  const names = { d_fg: '<8u foreground', d_obst: '8-30u obstacles', d_read: '30-90u read window',
                  d_env: '90-235u environment', d_sky: '>235u distant/sky' };
  for (const k of Object.keys(names)) {
    const b = base[k]; if (!b) { console.log(names[k].padEnd(20) + '  (empty)'); continue; }
    console.log(`${names[k].padEnd(20)} ${b.pix.toFixed(1).padStart(5)}  ${b.S.toFixed(3)}  ${b.C.toFixed(3)}  ` +
      `${b.L.toFixed(3)}  ${b.vivid.toFixed(1).padStart(5)}`);
  }
  console.log('\nNEAR BAND BY ROLE, shipped.');
  console.log('role         pix%   S      C      L      vivid%');
  for (const k of Object.keys(base.roles)) {
    const b = base.roles[k]; if (!b) continue;
    console.log(`${k.padEnd(12)} ${b.pix.toFixed(1).padStart(5)}  ${b.S.toFixed(3)}  ${b.C.toFixed(3)}  ${b.L.toFixed(3)}  ${b.vivid.toFixed(1).padStart(5)}`);
  }
  if (base.clusters) {
    console.log('\nNEAR BAND BY SYSTEM (geometry cluster). meshes = pooled instances submitted.');
    console.log('  pix%  S      C      L      viv%  dep    n  owner    material              colour');
    for (const c of base.clusters.slice(0, TOP)) {
      console.log(`${c.nearPix.toFixed(2).padStart(6)}  ${c.nearS.toFixed(3)}  ${c.nearC.toFixed(3)}  ` +
        `${c.nearL.toFixed(3)}  ${c.nearVivid.toFixed(1).padStart(4)}  ${c.nearDepth.toFixed(0).padStart(4)}  ` +
        `${String(c.meshes).padStart(3)}  ${c.owner.padEnd(8)} ${(c.matType + (c.vcol ? '+vcol' : '')).padEnd(21)} ${c.color}`);
    }
  }
  await browser.close();
})();
