#!/usr/bin/env node
/**
 * WHERE THE EDGES ARE, by depth band and by object.
 *
 * `tools/clarity.js` answers "how many strong edges does this frame have".
 * That number cannot brief anybody, because it does not say WHICH edges --
 * and the correction to its first run showed why whole-frame figures mislead:
 * composition dominates them. This tool answers the next question down.
 *
 * It renders the SAME frame three times and reads all three back:
 *
 *   COLOUR  the shipped frame, antialiased, exactly as shoot.js captures it.
 *           Sobel on its luminance gives the edge map, thresholded at the
 *           same 0.35 clarity.js uses, so the totals here reconcile with it.
 *   ID      every visible mesh flat-filled with a unique colour, into a
 *           render target with MSAA OFF (an antialiased ID buffer blends two
 *           ids into a third object's id, which is worse than useless).
 *           This gives per-pixel object identity WITH correct occlusion --
 *           an isolation render cannot, because it shows pixels the object
 *           does not actually win.
 *   DEPTH   linear view depth, packed to 24 bits, same target.
 *
 * ATTRIBUTION RULE: an edge pixel is credited to the NEAREST surface in its
 * 3x3 neighbourhood, not to the surface under it. A silhouette edge separates
 * two objects and belongs to the one in front -- that is whose shape it is.
 * This also absorbs the one-pixel disagreement between the antialiased colour
 * buffer and the aliased id buffer.
 *
 * Meshes are then clustered by GEOMETRY UUID. Nothing in this scene graph is
 * named, but everything pooled shares one geometry (see Pool() in world.js),
 * so geometry identity is system identity for free -- and it does not depend
 * on my reading of world.js being right.
 *
 * What comes out per cluster:
 *   PIX%    share of frame the cluster actually wins
 *   EDGE%   share of the frame's strong edges credited to it
 *   RATIO   EDGE% / PIX%. This is the number the brief asked for: edges per
 *           unit of screen area. 1.0 means the object is exactly as busy as
 *           the average of the frame. 4.0 means it spends four times its
 *           share. That ratio, not the raw count, is what identifies an
 *           object spending edges without earning them.
 *   NEAR    the same, restricted to the bottom third of the frame -- the band
 *           the correction identified as the finding.
 *
 * Usage:
 *   node tools/inkbudget.js --skip 185
 *   node tools/inkbudget.js --skip 185 --w 620 --h 1344
 *   node tools/inkbudget.js --skip 185 --iso 3      write an isolation PNG of
 *                                                   cluster #3, to see it
 *   node tools/inkbudget.js --skip 185 --hide 3,7   ablate clusters and
 *                                                   re-measure the whole frame
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

const SKIP = arg('skip', '185');
const W = parseInt(arg('w', 620), 10);
const H = parseInt(arg('h', 1344), 10);
let ISO = arg('iso', null);
let HIDE = arg('hide', null);
const TOP = parseInt(arg('top', 28), 10);
const OUT = arg('out', null);
const MASK = arg('mask', null);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.split('\n')[0]));

  await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&skip=' + SKIP,
    { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 60000 });
  await page.waitForTimeout(900);

  const res = await page.evaluate(({ ISO, HIDE, NOINK, NOHUD }) => {
    // Freeze the loop: every render below is ours, of one identical frame.
    window.requestAnimationFrame = function () { return 0; };
    const g = MR.game;
    // --noink: the outline A/B. Switch off every ink shell in the live scene
    // and measure the same frame again. This is the experiment, not an
    // opinion about what a back-face shell costs.
    if (NOINK) {
      g.scene.traverse(function (o) {
        if (!o.isMesh) return;
        const mt = Array.isArray(o.material) ? o.material[0] : o.material;
        if (mt && mt.type === 'ShaderMaterial' && mt.uniforms && mt.uniforms.thickness) o.visible = false;
      });
    }
    if (NOHUD) { const ui = document.getElementById('ui'); if (ui) ui.style.display = 'none'; }
    const renderer = g.renderer;
    const scene = g.scene;
    const camera = g.cam ? (g.cam.camera || g.cam.cam || g.cam) : null;
    if (!camera || !camera.isCamera) {
      // find it
      let c = null;
      scene.traverse(function (o) { if (o.isCamera) c = o; });
      if (!c) return { fail: 'no camera' };
    }
    const cam = camera.isCamera ? camera : null;
    if (!cam) return { fail: 'camera not found on MR.game.cam' };

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const RW = size.x, RH = size.y;

    // ---- inventory ------------------------------------------------------
    const meshes = [];
    scene.traverse(function (o) {
      if (!o.isMesh) return;
      if (!o.visible) return;
      // an ancestor switched off hides it too
      let p = o.parent, ok = true;
      while (p) { if (!p.visible) { ok = false; break; } p = p.parent; }
      if (!ok) return;
      if (o.material && o.material.visible === false) return;   // ink weight 0 shells
      meshes.push(o);
    });

    // Who owns this mesh. Depth alone cannot answer the owner's question --
    // "character / immediate obstacle / environment / distant" is a question
    // about ROLE, and role is in the scene graph. The hazard test is the ink
    // weight: outlined() parents the fill and its shell under one Group, and
    // only hazards carry INK.hazard, so a group whose shell is 0.025 thick is
    // by construction a hazard. That is the game's own definition, not mine.
    const HAZ = MR.shading.INK.hazard, CHR = MR.shading.INK.character;
    const runnerG = g.runner && g.runner.group, ghostG = g.ghost && g.ghost.group;
    function ownerOf(m) {
      // Root ownership FIRST. The player's own limbs are wrapped in
      // outlined() groups carrying INK.character, so an ink-first test walks
      // into the character weight before it ever reaches runner.group and
      // files the PLAYER as a rival -- which it did, and which would have put
      // the focal point of the game in the wrong row of the budget.
      for (let p = m; p; p = p.parent) {
        if (p === runnerG) return 'runner';
        if (p === ghostG) return 'ghost';
      }
      let p = m;
      while (p) {
        const ln = p.userData && p.userData.line;
        if (ln && ln.material && ln.material.uniforms && ln.material.uniforms.thickness) {
          const t = ln.material.uniforms.thickness.value;
          if (Math.abs(t - HAZ) < 1e-6) return 'hazard';
          if (Math.abs(t - CHR) < 1e-6) return 'rival';
        }
        p = p.parent;
      }
      return 'world';
    }

    const info = meshes.map(function (m, i) {
      const geo = m.geometry;
      const tri = geo && geo.attributes && geo.attributes.position
        ? (geo.index ? geo.index.count : geo.attributes.position.count) / 3 : 0;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const bb = new THREE.Box3().setFromObject(m);
      const map = mat && mat.map;
      return {
        i: i,
        owner: ownerOf(m),
        geo: geo ? geo.uuid : 'none',
        tri: tri,
        matType: mat ? mat.type : '?',
        matName: mat && mat.name ? mat.name : '',
        matUuid: mat ? mat.uuid : '',
        transparent: !!(mat && mat.transparent),
        depthTest: mat ? mat.depthTest !== false : true,
        isInk: !!(mat && mat.type === 'ShaderMaterial' && mat.uniforms && mat.uniforms.thickness),
        tex: map ? (map.image ? map.image.width + 'x' + map.image.height : 'tex') : '',
        texRepeat: map ? map.repeat.x.toFixed(1) + ',' + map.repeat.y.toFixed(1) : '',
        color: mat && mat.color ? '#' + mat.color.getHexString() : '',
        min: [bb.min.x, bb.min.y, bb.min.z].map(function (v) { return +v.toFixed(1); }),
        max: [bb.max.x, bb.max.y, bb.max.z].map(function (v) { return +v.toFixed(1); }),
      };
    });

    // ---- optional ablation ---------------------------------------------
    const hidden = [];
    if (HIDE) {
      const want = String(HIDE).split(',');
      // cluster key resolved below by the caller passing geometry uuids
      meshes.forEach(function (m, i) {
        if (want.indexOf(info[i].geo) >= 0) { hidden.push(m); m.visible = false; }
      });
    }

    // ---- pass 1: the shipped frame -------------------------------------
    const gl = renderer.getContext();
    function readCanvas() {
      renderer.render(scene, cam);
      const buf = new Uint8Array(RW * RH * 4);
      gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      return buf;
    }
    const colour = readCanvas();

    // ---- id + depth passes, MSAA off -----------------------------------
    const ID_VS = `
      attribute vec3 position;
      uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
      varying float vD;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vD=-mv.z;
        gl_Position = projectionMatrix*mv; }`;
    // An ink shell is not its geometry. shading.js OUTLINE_VS extrudes every
    // vertex along its view-space normal before projecting, and the extrusion
    // IS the visible object -- the shell is otherwise exactly coincident with
    // the fill it wraps. A plain id shader therefore renders the shell into
    // the same pixels as the fill, loses the z-fight, and reports that
    // outlines cost nothing. They do not: the --noink A/B removes 7.3% of the
    // frame's edges. This mirror of OUTLINE_VS is what makes the id buffer
    // agree with the picture. (Kept in sync with shading.js by hand; if the
    // outline vertex shader changes, change this too.)
    const ID_VS_INK = `
      attribute vec3 position; attribute vec3 normal;
      uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
      uniform mat3 normalMatrix; uniform float thickness;
      varying float vD;
      void main(){
        vec3 n = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix*vec4(position,1.0);
        vD = -mv.z;
        mv.xyz += n * thickness * clamp(0.75 + 0.05*vD, 0.90, 3.6);
        gl_Position = projectionMatrix*mv; }`;
    const ID_FS = `precision highp float; uniform vec3 oid; varying float vD;
      void main(){ gl_FragColor = vec4(oid,1.0); }`;
    const D_FS = `precision highp float; varying float vD;
      void main(){ float d = clamp(vD/600.0,0.0,0.999999);
        vec3 e = fract(d*vec3(1.0,256.0,65536.0));
        e -= e.yzz*vec3(1.0/256.0,1.0/256.0,0.0);
        gl_FragColor = vec4(e,1.0); }`;

    const target = new THREE.WebGLRenderTarget(RW, RH, { samples: 0 });
    const saved = meshes.map(function (m) { return m.material; });

    // unique id -> colour, spaced so nothing can collide after quantisation
    function idColour(n) {
      const v = n + 1;
      return new THREE.Vector3(((v & 255)) / 255, ((v >> 8) & 255) / 255, ((v >> 16) & 255) / 255);
    }
    const inkThick = function (m) {
      const mt = Array.isArray(m.material) ? m.material[0] : m.material;
      return mt && mt.type === 'ShaderMaterial' && mt.uniforms && mt.uniforms.thickness
        ? mt.uniforms.thickness.value : 0;
    };
    const idMats = meshes.map(function (m, i) {
      const t = inkThick(m);
      const src = (Array.isArray(m.material) ? m.material[0] : m.material);
      return new THREE.RawShaderMaterial({
        vertexShader: t > 0 ? ID_VS_INK : ID_VS, fragmentShader: ID_FS,
        uniforms: t > 0
          ? { oid: { value: idColour(i) }, thickness: { value: t } }
          : { oid: { value: idColour(i) } },
        side: src.side,
      });
    });
    const depthMats = meshes.map(function (m) {
      const t = inkThick(m);
      const src = (Array.isArray(m.material) ? m.material[0] : m.material);
      return new THREE.RawShaderMaterial({
        vertexShader: t > 0 ? ID_VS_INK : ID_VS, fragmentShader: D_FS,
        uniforms: t > 0 ? { thickness: { value: t } } : {},
        side: src.side,
      });
    });

    function readTarget(assign) {
      meshes.forEach(function (m, i) { m.material = assign(m, i); });
      const oldFog = scene.fog; scene.fog = null;
      const oldBg = scene.background; scene.background = null;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, cam);
      const buf = new Uint8Array(RW * RH * 4);
      renderer.readRenderTargetPixels(target, 0, 0, RW, RH, buf);
      renderer.setRenderTarget(null);
      scene.fog = oldFog; scene.background = oldBg;
      meshes.forEach(function (m, i) { m.material = saved[i]; });
      return buf;
    }
    const idbuf = readTarget(function (m, i) { return idMats[i]; });
    const dbuf = readTarget(function (m, i) { return depthMats[i]; });

    if (hidden.length) hidden.forEach(function (m) { m.visible = true; });

    // ---- analysis -------------------------------------------------------
    // rows come back bottom-up from readPixels; keep that and flip at the end.
    const N = RW * RH;
    const lum = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      lum[i] = (0.2126 * colour[i * 4] + 0.7152 * colour[i * 4 + 1] + 0.0722 * colour[i * 4 + 2]) / 255;
    }
    const depth = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      depth[i] = (dbuf[i * 4] / 255 + dbuf[i * 4 + 1] / 65280 + dbuf[i * 4 + 2] / 16711680) * 600;
    }
    const id = new Int32Array(N);
    for (let i = 0; i < N; i++) {
      const v = idbuf[i * 4] | (idbuf[i * 4 + 1] << 8) | (idbuf[i * 4 + 2] << 16);
      id[i] = v - 1;                     // -1 == cleared background
    }

    const edge = new Uint8Array(N);
    // Orientation, kept because it separates two things that live in the same
    // merged geometry and cannot be separated by mesh. paintGeo is ONE mesh
    // per tile carrying both the longitudinal lane/edge lines and the
    // full-width transverse expansion joints. On screen a transverse bar is
    // near-horizontal and a lane line is a steep diagonal, so |gy|>|gx| splits
    // them without needing them to be different objects.
    const horiz = new Uint8Array(N);
    for (let y = 1; y < RH - 1; y++) {
      for (let x = 1; x < RW - 1; x++) {
        const i = y * RW + x;
        const gx = -lum[i - RW - 1] - 2 * lum[i - 1] - lum[i + RW - 1]
                   + lum[i - RW + 1] + 2 * lum[i + 1] + lum[i + RW + 1];
        const gy = -lum[i - RW - 1] - 2 * lum[i - RW] - lum[i - RW + 1]
                   + lum[i + RW - 1] + 2 * lum[i + RW] + lum[i + RW + 1];
        edge[i] = Math.hypot(gx, gy) > 0.35 ? 1 : 0;
        if (edge[i]) horiz[i] = Math.abs(gy) > Math.abs(gx) ? 1 : 0;
      }
    }

    // per-mesh tallies
    const pix = new Float64Array(meshes.length + 1);
    const eds = new Float64Array(meshes.length + 1);
    const pixNear = new Float64Array(meshes.length + 1);
    const edsNear = new Float64Array(meshes.length + 1);
    const lsum = new Float64Array(meshes.length + 1);
    const ssum = new Float64Array(meshes.length + 1);
    const edsH = new Float64Array(meshes.length + 1);
    const edsHNear = new Float64Array(meshes.length + 1);
    // readPixels y=0 is the BOTTOM of the image, so the near band is y < RH/3.
    const nearTop = Math.floor(RH / 3);

    // depth-band tallies: 0 <8 (character band), 1 8-30, 2 30-90, 3 90-235, 4 >235/sky
    const BANDS = [8, 30, 90, 235, 1e9];
    const bandPix = new Float64Array(6), bandEdge = new Float64Array(6);
    // Mean value and chroma per band. THIS is the hierarchy measurement.
    // Edge density says how busy a layer is; it cannot say whether two layers
    // read as two layers. Adjacent bands that share a luminance merge into one
    // another however clean each one's silhouettes are -- which is exactly the
    // "washed / soft hierarchy" complaint, and no edge statistic can see it.
    const bandLum = new Float64Array(6), bandSat = new Float64Array(6);
    const bandLums = [[], [], [], [], [], []];
    const bandPixNear = new Float64Array(6), bandEdgeNear = new Float64Array(6);
    function bandOf(d) { for (let b = 0; b < BANDS.length; b++) if (d < BANDS[b]) return b; return 5; }

    let totalEdge = 0, totalNearEdge = 0, nearPixTotal = 0;
    for (let y = 1; y < RH - 1; y++) {
      const isNear = y < nearTop;
      for (let x = 1; x < RW - 1; x++) {
        const i = y * RW + x;
        const oi = id[i] >= 0 ? id[i] : meshes.length;
        pix[oi]++;
        lsum[oi] += lum[i];
        {
          const R = colour[i * 4] / 255, G = colour[i * 4 + 1] / 255, B = colour[i * 4 + 2] / 255;
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          ssum[oi] += mx > 0 ? (mx - mn) / mx : 0;
        }
        const b = id[i] >= 0 ? bandOf(depth[i]) : 5;
        bandPix[b]++;
        bandLum[b] += lum[i];
        const R = colour[i * 4] / 255, G = colour[i * 4 + 1] / 255, B = colour[i * 4 + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        bandSat[b] += mx > 0 ? (mx - mn) / mx : 0;
        if ((i & 31) === 0) bandLums[b].push(lum[i]);
        if (isNear) { pixNear[oi]++; bandPixNear[b]++; nearPixTotal++; }
        if (!edge[i]) continue;
        totalEdge++;
        if (isNear) totalNearEdge++;
        // credit the NEAREST surface in the 3x3
        let bestD = Infinity, bestI = i;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * RW + dx;
          if (id[j] < 0) continue;
          if (depth[j] < bestD) { bestD = depth[j]; bestI = j; }
        }
        const ci = id[bestI] >= 0 ? id[bestI] : meshes.length;
        eds[ci]++;
        if (horiz[i]) edsH[ci]++;
        const cb = id[bestI] >= 0 ? bandOf(depth[bestI]) : 5;
        bandEdge[cb]++;
        if (isNear) { edsNear[ci]++; bandEdgeNear[cb]++; if (horiz[i]) edsHNear[ci]++; }
      }
    }

    // Per-owner luminance DISTRIBUTION, not just the mean. Comparing our
    // character's mean against a hand-placed reference patch is not
    // like-for-like: a mean is always nearer the middle than a patch is. What
    // the references actually do is give the character a large area at a value
    // EXTREME relative to its ground, so the honest question is whether ours
    // has one at all -- and that is a question about spread, not about a mean.
    const ownerL = {};
    for (let i = 0; i < N; i++) {
      if (id[i] < 0) continue;
      const o = info[id[i]].owner + (info[id[i]].isInk ? '-ink' : '');
      if (!ownerL[o]) ownerL[o] = [];
      if (ownerL[o].length < 60000 && (i & 3) === 0) ownerL[o].push(lum[i]);
    }

    // Mean VISIBLE depth per mesh -- the distance the player actually sees the
    // object at. World-space z is useless here: the course runs to z~4900, so
    // every bbox reads "4600..4900" and says nothing. Accumulated over the id
    // buffer, so it is weighted by the pixels the object wins.
    const dsum = new Float64Array(meshes.length + 1);
    for (let i = 0; i < N; i++) if (id[i] >= 0) dsum[id[i]] += depth[i];

    // Cluster by geometry uuid AND ink-ness. outlined() hands the SAME
    // geometry to the fill and to its back-face shell, so a plain geometry
    // key silently merges a hazard with its own outline and makes the outline
    // question unanswerable. Splitting them is the whole point of question 3.
    const clusters = {};
    meshes.forEach(function (m, i) {
      const k = info[i].geo + (info[i].isInk ? '|ink' : '');
      if (!clusters[k]) clusters[k] = {
        geo: info[i].geo, key: k, n: 0, tri: 0, pix: 0, eds: 0, pixNear: 0, edsNear: 0,
        edsH: 0, edsHNear: 0, lsum: 0, ssum: 0,
        matType: info[i].matType, isInk: info[i].isInk, tex: info[i].tex,
        texRepeat: info[i].texRepeat, color: info[i].color, owner: info[i].owner,
        transparent: info[i].transparent, triEach: info[i].tri, dsum: 0,
        minY: 1e9, maxY: -1e9,
      };
      const c = clusters[k];
      c.n++; c.tri += info[i].tri;
      c.pix += pix[i]; c.eds += eds[i]; c.dsum += dsum[i];
      c.edsH += edsH[i]; c.edsHNear += edsHNear[i];
      c.lsum += lsum[i]; c.ssum += ssum[i];
      c.pixNear += pixNear[i]; c.edsNear += edsNear[i];
      c.minY = Math.min(c.minY, info[i].min[1]); c.maxY = Math.max(c.maxY, info[i].max[1]);
      if (c.owner === 'world' && info[i].owner !== 'world') c.owner = info[i].owner;
    });

    // Per-OWNER roll-up: the owner's four layers, answered by role not depth.
    const owners = {};
    meshes.forEach(function (m, i) {
      const o = info[i].owner + (info[i].isInk ? '-ink' : '');
      if (!owners[o]) owners[o] = { name: o, pix: 0, eds: 0, pixNear: 0, edsNear: 0, n: 0, tri: 0, lsum: 0, ssum: 0, L: [] };
      owners[o].lsum += lsum[i]; owners[o].ssum += ssum[i];
      owners[o].n++; owners[o].tri += info[i].tri;
      owners[o].pix += pix[i]; owners[o].eds += eds[i];
      owners[o].pixNear += pixNear[i]; owners[o].edsNear += edsNear[i];
    });

    const framePix = (RW - 2) * (RH - 2);
    return {
      RW: RW, RH: RH, framePix: framePix, nearPixTotal: nearPixTotal,
      totalEdge: totalEdge, totalNearEdge: totalNearEdge,
      meshCount: meshes.length,
      draws: renderer.info.render.calls,
      tris: renderer.info.render.triangles,
      bands: Array.from(bandPix).map(function (p, b) {
        const L = bandLums[b].slice().sort(function (a, c2) { return a - c2; });
        const q = function (f) { return L.length ? L[Math.floor(L.length * f)] : 0; };
        return { b: b, pix: p, edge: bandEdge[b], pixNear: bandPixNear[b], edgeNear: bandEdgeNear[b],
          lum: p ? bandLum[b] / p : 0, sat: p ? bandSat[b] / p : 0, p10: q(0.10), p90: q(0.90) };
      }),
      clusters: Object.keys(clusters).map(function (k) { return clusters[k]; }),
      owners: Object.keys(owners).map(function (k) {
        const o = owners[k];
        const L = (ownerL[k] || []).slice().sort(function (a, c2) { return a - c2; });
        const q = function (f) { return L.length ? L[Math.floor(L.length * f)] : 0; };
        o.p05 = q(0.05); o.p50 = q(0.50); o.p95 = q(0.95); o.L = undefined;
        return o;
      }),
      unattributed: { pix: pix[meshes.length], eds: eds[meshes.length] },
      // Everything needed to paint a mask later, without re-rendering. An
      // isolation render shows pixels the object does NOT win in the real
      // frame; only the id buffer knows which pixels it actually holds, and
      // identity claims in this repo have gone wrong exactly there before.
      _mask: function () {
        const keys = meshes.map(function (m, i) {
          return info[i].geo + (info[i].isInk ? '|ink' : '');
        });
        window.__ib = { colour: colour, id: id, keys: keys, RW: RW, RH: RH };
        return true;
      }(),
    };
  }, { ISO, HIDE, NOINK: has('noink'), NOHUD: has('nohud') });

  if (res.fail) { console.error('FAIL', res.fail); process.exit(1); }
  if (errs.length) console.error(errs.join('\n'));

  const F = res.framePix, E = res.totalEdge, NE = res.totalNearEdge, NP = res.nearPixTotal;
  console.log(`\n=== skip ${SKIP}  ${res.RW}x${res.RH} drawing buffer  ${res.meshCount} visible meshes  ` +
    `${res.draws} draws  ${res.tris} tris ===`);
  console.log(`frame strong-edge pixels ${E} = ${(E / F * 100).toFixed(1)}% of frame   ` +
    `NEAR band ${NE} = ${(NE / NP * 100).toFixed(1)}% of the near third`);

  const BANDNAME = ['under 8u (character/foreground)', '8-30u (immediate obstacles)',
    '30-90u (mid, the read window)', '90-235u (environment, into fog)', 'beyond 235u (distant/backdrop)',
    'sky / no geometry'];
  console.log('\n--- edges by DEPTH BAND (whole frame, then near third) ---');
  console.log('band                                pix%   edge%   ratio |  nearpix%  nearedge%  ratio |' +
    '  meanL  satur   L p10-p90');
  res.bands.forEach((b, i) => {
    if (!b.pix && !b.edge) return;
    const p = b.pix / F * 100, e = b.edge / E * 100;
    const pn = b.pixNear / NP * 100, en = NE ? b.edgeNear / NE * 100 : 0;
    console.log(`${BANDNAME[i].padEnd(34)} ${p.toFixed(1).padStart(5)}  ${e.toFixed(1).padStart(6)}  ` +
      `${(p > 0.05 ? e / p : 0).toFixed(2).padStart(5)} | ${pn.toFixed(1).padStart(8)}  ${en.toFixed(1).padStart(9)}  ` +
      `${(pn > 0.05 ? en / pn : 0).toFixed(2).padStart(5)} | ` +
      `${b.lum.toFixed(3).padStart(6)} ${b.sat.toFixed(3).padStart(6)}   ` +
      `${b.p10.toFixed(2)}-${b.p90.toFixed(2)}`);
  });
  // Adjacent-band value separation: the number the hierarchy question needs.
  const vis = res.bands.filter((b) => b.pix / F > 0.01);
  const seps = [];
  for (let i = 1; i < vis.length; i++) {
    seps.push(`${BANDNAME[vis[i - 1].b].split(' ')[0]}->${BANDNAME[vis[i].b].split(' ')[0]}: ` +
      `dL ${(vis[i].lum - vis[i - 1].lum >= 0 ? '+' : '')}${(vis[i].lum - vis[i - 1].lum).toFixed(3)}` +
      ` dS ${(vis[i].sat - vis[i - 1].sat >= 0 ? '+' : '')}${(vis[i].sat - vis[i - 1].sat).toFixed(3)}`);
  }
  console.log('adjacent-layer separation:  ' + seps.join('   '));

  console.log('\n--- edges by OWNER (the four layers, by role rather than depth) ---');
  console.log('owner              meshes    tri   pix%  edge%  ratio | nearpix% nearedge% NRATIO |  meanL  satur   L p05/p50/p95');
  res.owners.sort((a, b) => b.eds - a.eds).forEach((o) => {
    const p = o.pix / F * 100, e = o.eds / E * 100;
    const pn = o.pixNear / NP * 100, en = NE ? o.edsNear / NE * 100 : 0;
    console.log(`${o.name.padEnd(16)} ${String(o.n).padStart(6)} ${String(Math.round(o.tri)).padStart(6)} ` +
      `${p.toFixed(2).padStart(6)} ${e.toFixed(2).padStart(6)} ${(p > 0.02 ? e / p : 0).toFixed(2).padStart(6)} | ` +
      `${pn.toFixed(2).padStart(8)} ${en.toFixed(2).padStart(9)} ${(pn > 0.02 ? en / pn : 0).toFixed(2).padStart(6)} | ` +
      `${(o.pix ? o.lsum / o.pix : 0).toFixed(3).padStart(6)} ${(o.pix ? o.ssum / o.pix : 0).toFixed(3).padStart(6)}` +
      `   L ${o.p05.toFixed(2)}/${o.p50.toFixed(2)}/${o.p95.toFixed(2)}`);
  });

  const cl = res.clusters.slice().sort((a, b) => b.eds - a.eds);
  console.log(`\n--- top ${TOP} clusters by edges contributed (geometry+ink = one system) ---`);
  console.log('  # owner    inst   tri   pix%  edge%  RATIO | nearpix% nearedge% NRATIO | seen@  yrange' +
    '     mat / texture / key');
  cl.slice(0, TOP).forEach((c, i) => {
    const p = c.pix / F * 100, e = c.eds / E * 100;
    const pn = c.pixNear / NP * 100, en = NE ? c.edsNear / NE * 100 : 0;
    const d = c.pix ? c.dsum / c.pix : 0;
    console.log(
      `${String(i).padStart(3)} ${c.owner.padEnd(8)} ${String(c.n).padStart(4)} ${String(Math.round(c.tri)).padStart(6)} ` +
      `${p.toFixed(2).padStart(6)} ${e.toFixed(2).padStart(6)} ${(p > 0.02 ? e / p : 0).toFixed(2).padStart(6)} | ` +
      `${pn.toFixed(2).padStart(8)} ${en.toFixed(2).padStart(9)} ${(pn > 0.02 ? en / pn : 0).toFixed(2).padStart(6)} | ` +
      `${d.toFixed(0).padStart(4)}u ${(c.minY.toFixed(1) + '..' + c.maxY.toFixed(1)).padStart(11)}  ` +
      `${c.matType.replace('Material', '')}${c.isInk ? '/INK' : ''}${c.transparent ? '/tr' : ''} ` +
      `${c.tex ? c.tex + ' r' + c.texRepeat : c.color} ` +
      `L${(c.pix ? c.lsum / c.pix : 0).toFixed(2)} S${(c.pix ? c.ssum / c.pix : 0).toFixed(2)} ` +
      `H${(c.eds ? c.edsH / c.eds * 100 : 0).toFixed(0)}%/nH${(c.edsNear ? c.edsHNear / c.edsNear * 100 : 0).toFixed(0)}% ` +
      `${c.key.slice(0, 8)}${c.isInk ? '|ink' : ''}`);
  });

  // ---- isolation / ablation renders, so identity is SEEN not inferred ----
  // Every wrong diagnosis in docs/roadmap.md was reasoned from aggregate
  // geometry without looking at the thing. --iso renders one cluster alone
  // and --keep renders the frame with that cluster removed; between them a
  // claim about what a geometry uuid IS can be checked against a picture.
  // A geometry uuid is minted fresh on every page load, so a key copied off a
  // previous run addresses nothing. Ranks (--iso "#1") are resolved against
  // THIS run's table, which is the only way the picture and the numbers can be
  // guaranteed to be of the same object.
  const resolve = (s) => String(s).split(',').map((t) => t.trim().startsWith('#')
    ? (cl[parseInt(t.trim().slice(1), 10)] || {}).key : t.trim()).filter(Boolean).join(',');
  if (ISO) ISO = resolve(ISO);
  if (HIDE) HIDE = resolve(HIDE);

  if (MASK) {
    const want = resolve(MASK);
    const dataUrl = await page.evaluate((want) => {
      const S = window.__ib, keys = String(want).split(',');
      const c = document.createElement('canvas');
      c.width = S.RW; c.height = S.RH;
      const g2 = c.getContext('2d');
      const img = g2.createImageData(S.RW, S.RH);
      const hit = S.keys.map(function (k) { return keys.indexOf(k) >= 0; });
      for (let y = 0; y < S.RH; y++) {
        for (let x = 0; x < S.RW; x++) {
          const src = ((S.RH - 1 - y) * S.RW + x) * 4;   // readPixels is bottom-up
          const dst = (y * S.RW + x) * 4;
          const oi = S.id[(S.RH - 1 - y) * S.RW + x];
          const on = oi >= 0 && hit[oi];
          // kept pixels at full strength on a magenta ground; everything else
          // crushed to a dark grey ghost of itself so the context is readable.
          img.data[dst] = on ? 255 : S.colour[src] * 0.22;
          img.data[dst + 1] = on ? 0 : S.colour[src + 1] * 0.22;
          img.data[dst + 2] = on ? 255 : S.colour[src + 2] * 0.22;
          img.data[dst + 3] = 255;
        }
      }
      g2.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    }, want);
    const f = path.join(ROOT, 'shots', 'tmp', 'inkbudget-mask.png');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`\nmask of ${want} -> ${f}`);
  }

  if (ISO || HIDE) {
    const shot = await page.evaluate(({ ISO, HIDE }) => {
      const g = MR.game, scene = g.scene;
      const meshes = [];
      scene.traverse(function (o) {
        if (!o.isMesh || !o.visible) return;
        if (o.material && o.material.visible === false) return;
        meshes.push(o);
      });
      const isInk = function (m) {
        const mt = Array.isArray(m.material) ? m.material[0] : m.material;
        return !!(mt && mt.type === 'ShaderMaterial' && mt.uniforms && mt.uniforms.thickness);
      };
      const keyOf = function (m) { return m.geometry.uuid + (isInk(m) ? '|ink' : ''); };
      const want = String(ISO || HIDE).split(',');
      const hit = function (m) { return want.indexOf(keyOf(m)) >= 0 || want.indexOf(m.geometry.uuid) >= 0; };
      const touched = [];
      meshes.forEach(function (m) {
        const on = ISO ? hit(m) : !hit(m);
        if (!on) { touched.push(m); m.visible = false; }
      });
      // rAF is frozen and the buffer is not preserved, so the canvas must be
      // repainted here or the screenshot captures whatever survived compositing.
      const cam = g.cam.camera || g.cam.cam || g.cam;
      g.renderer.render(scene, cam);
      return touched.length;
    }, { ISO, HIDE });
    const f = OUT ? OUT.replace(/\.json$/, '') + (ISO ? '-iso.png' : '-ablate.png')
      : path.join(ROOT, 'shots', 'tmp', 'inkbudget-' + (ISO ? 'iso' : 'ablate') + '.png');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    await page.screenshot({ path: f });
    console.log(`\n${ISO ? 'isolated' : 'ablated'} ${shot} meshes -> ${f}`);
  }

  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  await browser.close();
})();
