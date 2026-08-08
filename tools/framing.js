#!/usr/bin/env node
/**
 * FRAMING -- what a hazard looks like THROUGH THE GAME'S OWN LENS, at the
 * distances the game actually shows it at, and what its pixels are made of.
 *
 *   node tools/framing.js --kind BLOCK --sheet shots/block-framing.png
 *   node tools/framing.js --kind BLOCK --v 9 --d 8,12,20,35
 *   node tools/framing.js --vp 402x528          the owner's own aspect
 *
 * ---- WHY THIS EXISTS, AND IT IS A CORRECTION ------------------------------
 *
 * The fleet rebuild was verified with tools/orbit.js and api.fleetSheet at
 * azimuth 0 / 45 / 90 / 135 / 180. At 45-135 the fleet is genuinely good. THE
 * GAME NEVER SHOWS THOSE ANGLES. The chase camera sits K.CAM_BASE_BACK behind
 * the runner at K.CAM_BASE_Y, looking at LOOK_Y over LOOK_AHEAD, so a hazard
 * ahead of the runner presents its REAR ELEVATION and a sliver of roof, and
 * everything the orbit sheet was proud of is on surfaces the lens cannot see.
 *
 * The owner looked at the game and said "I don't see any of these adjusted".
 * They were right, and the reason is that no committed tool in this repo ever
 * asked "what does this look like in play". Every instrument the fleet had --
 * contrastAudit, fleetSheet, orbit -- uses an ORTHOGRAPHIC camera the builder
 * chose, framed so the object fills the tile. That is the correct instrument
 * for an area mean and the wrong one for every question about reading.
 *
 * This is the fourth time this project has verified at a framing the game does
 * not use: the silhouette sheet that normalised every variant to the same
 * rectangle, the stride sheet posed at dt = 0, the runner detail budget judged
 * at 110px on a figure that is 163-208px, and now this. docs/roadmap.md.
 *
 * ---- WHAT IT DOES ---------------------------------------------------------
 *
 * It drives the real built page, lets the real game reach a real frame, and
 * then SNAPSHOTS THE LIVE CAMERA -- position, quaternion, fov, aspect, near,
 * far, exactly as camera.js left them after the springs settled. Every tile on
 * the sheet is rendered through a clone of that camera. There is no second
 * lighting rig and no second lens: the toon ramps, the ink shell, the cel
 * specular and the fog are the shipped ones.
 *
 * Each variant is placed where a gate at distance d would actually put it --
 * lane x from K.LANE_X, y from the course's own elevation profile, pitched by
 * the road's own slope -- which is claim site 2 in world.js copied verbatim.
 *
 * TILES ARE CROPPED, NEVER SCALED. A tile is a TILE x TILE window cut out of
 * the real 390x844 frame around the object, at 1:1. So the sheet's pixels are
 * shipped pixels: a variant that is 96 px tall on the sheet is 96 px tall on
 * the phone. Scaling each tile to fill its cell is exactly the defect this
 * tool was written to correct, and it is not available as an option.
 *
 * ---- THE PIXEL CENSUS -----------------------------------------------------
 *
 * "It reads as an orange box with a stripe" is an impression. The census turns
 * it into a number: for every variant at every distance, how many pixels the
 * object owns, and which PART of it owns them.
 *
 * The parts are recovered from the merged geometry's own colour attribute.
 * world.js's merge() writes one flat colour per authored part, so every vertex
 * carries the hex the author chose, and CATS below maps those hexes to the
 * categories a person would name -- body, glass, lamp, wheel, dark/trim,
 * plate, caution face, ink. The object is then re-rendered with a
 * MeshBasicMaterial whose vertex colours are the CATEGORY colours, through the
 * same camera, with the same depth test -- so occlusion is exactly the real
 * object's occlusion and the counts sum to the real silhouette.
 *
 * Three properties this deliberately keeps:
 *
 *   THE INK SHELL IS COUNTED. The outline is a real part of what the eye sees
 *     and at 35 units it is a large fraction of a small object. Its material
 *     is the SHIPPED outline shader with its colour uniform overridden, so the
 *     shell still expands along the normals by the shipped thickness.
 *   NOTHING IS SILENTLY DROPPED. A hex not in CATS lands in `other` and is
 *     printed with its own count, so an unclassified part is visible as a
 *     finding rather than as a smaller total.
 *   EXACT COLOUR MATCH, no tolerance beyond rounding. Category colours are
 *     pure-channel or half-channel sRGB, unlit and untonemapped, so they land
 *     on the framebuffer as their own bytes. tools/resolve.js's header records
 *     what a generous tolerance did to it: two candidates "owned" 1084 pixels
 *     of a part that could not cover 40.
 *
 * ONE KNOWN AMBIGUITY, stated rather than hidden. GLASS_PALE_HI and CHROME are
 * both 0xa8e0e8 in world.js, so a pale-glass upper band and a chrome trim strip
 * are the same hex and cannot be told apart by colour. They are counted
 * together as `glass` and the total is flagged. Every other hex in the fleet is
 * unique to one category.
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

const KIND = String(arg('kind', 'BLOCK')).toUpperCase();
const VP = String(arg('vp', '390x844')).split('x').map(Number);
const DISTS = String(arg('d', '8,12,20,35')).split(',').map(Number);
const TILE = parseInt(arg('tile', 260), 10);
const SKIP = String(arg('skip', '150'));
const LANE = arg('lane', 'same');          // same | left | right
const ONLY = arg('v', null);
const SHEET = arg('sheet', null);
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const JSON_OUT = arg('json', null);

/**
 * hex -> category. Transcribed from the constants in src/render/world.js; the
 * page prints anything it cannot find here, so this table failing to keep up
 * with the art is a visible finding and not a quiet undercount.
 */
const CATS = {
  // ---- glass (and the one hex it shares with chrome trim) ----
  0x8ec0ea: 'glass', 0x4f74bc: 'glass', 0xa8e0e8: 'glass', 0x6f9cb8: 'glass',
  0xb4dcff: 'glass', 0xc0f0fc: 'glass',
  // ---- lamps and plates ----
  0xff2b3c: 'lamp', 0xfff6e2: 'lamp', 0xb4d4ec: 'lamp', 0xffa32b: 'lamp',
  0xe8ecf4: 'plate',
  // ---- wheels ----
  0x1e2140: 'wheel', 0x241a10: 'wheel', 0x9fb8dc: 'wheel', 0xd4e4f8: 'wheel',
  0xd8b464: 'wheel', 0xf4dc9c: 'wheel',
  // ---- bodies ----
  0x1e9cf0: 'body', 0x00c896: 'body', 0xffdd00: 'body', 0xff8c00: 'body',
  0xb4c800: 'body', 0xe4ff2a: 'body', 0xf03a2a: 'body', 0xffd400: 'body',
  0xff3b6b: 'body', 0xfff23a: 'body',
  // ---- darks, creases, trims ----
  0x0c2436: 'trim', 0x0074a8: 'trim', 0x0e2a26: 'trim', 0x008060: 'trim',
  0x2e2412: 'trim', 0xd89800: 'trim', 0x35220a: 'trim', 0xc26200: 'trim',
  0x22300a: 'trim', 0x7ab800: 'trim', 0x1a1608: 'trim',
  // ---- the five that are figures on a machine ----
  // 0x2b2f52 is the fleet's structural navy AND the trike's tyre. Counted as
  // trim, which is where the structure belongs; the trike therefore reports
  // 0.0% wheel and that is a true statement about what the lens can see, not
  // a gap in this table -- see the note in the report.
  0x2b2f52: 'trim', 0x2a0c16: 'trim', 0x141a33: 'trim', 0x3a2a12: 'trim',
  0xc42a1e: 'trim', 0xd42a55: 'body',
  0x6d76a8: 'wheel',                     // the cyclists' tyre, a mid grey-blue
  0xffc79a: 'skin', 0xb87a4e: 'skin',
  0xfff2e0: 'cream', 0xffe45e: 'lamp',   // hoarding beacons
};
// The category colours written into the probe render. Pure and half channels
// only, so they survive the sRGB round trip exactly. Black is the clear colour.
const CAT_RGB = {
  face: [255, 0, 255],
  body: [0, 255, 0],
  glass: [0, 255, 255],
  lamp: [255, 255, 0],
  wheel: [255, 0, 0],
  plate: [255, 128, 0],
  trim: [0, 0, 255],
  skin: [255, 0, 128],
  cream: [128, 255, 128],
  ink: [255, 255, 255],
  other: [128, 128, 255],
};
const CAT_ORDER = ['face', 'body', 'glass', 'lamp', 'plate', 'wheel', 'trim',
  'skin', 'cream', 'ink', 'other'];

// ---------------------------------------------------------------------------
function pageRun(o) {
  const g = MR.game, w = g.world, THREE = window.THREE, K = MR.K;
  const KID = { JUMP: 1, DUCK: 2, BLOCK: 3 }[o.kind];
  if (!KID) return { error: 'unknown kind ' + o.kind };

  // ---- the lens, snapshotted from the live game ---------------------------
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
  const playerLane = g.player.lane;
  const lane = o.lane === 'left' ? Math.max(0, playerLane - 1)
    : o.lane === 'right' ? Math.min(2, playerLane + 1) : playerLane;

  // ---- what to hide -------------------------------------------------------
  // Live hazards only. The road, the scenery, the runner, the sky and the fog
  // stay, because the tile is supposed to be the frame and not a swatch.
  const hidden = [];
  g.scene.traverse(function (n) {
    if (n.userData && n.userData.variants && n.visible) { hidden.push(n); n.visible = false; }
  });

  const holder = new THREE.Group();
  g.scene.add(holder);

  // ---- render targets -----------------------------------------------------
  const W = o.w, H = o.h;
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(W * H * 4);
  const prevRT = g.renderer.getRenderTarget();
  const prevClr = new THREE.Color();
  g.renderer.getClearColor(prevClr);
  const prevA = g.renderer.getClearAlpha();

  function grab() {
    g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  }

  // ---- the category clone -------------------------------------------------
  // Same geometry, same transforms, same depth test; only the shading is
  // replaced. The ink shell keeps the shipped outline shader so it still
  // expands by the shipped thickness -- only its colour uniform moves.
  const catCol = {};
  for (const k in o.catRgb) {
    const c = new THREE.Color();
    c.setRGB(o.catRgb[k][0] / 255, o.catRgb[k][1] / 255, o.catRgb[k][2] / 255, THREE.SRGBColorSpace);
    catCol[k] = c;
  }
  const unknown = {};

  function categorise(src) {
    // src is the merged geometry's per-vertex colour, in the renderer's
    // working (linear) space, written by merge() from a hex. Reverse it the
    // same way THREE does so the lookup key is the author's own hex.
    const n = src.count;
    const out = new Float32Array(n * 3);
    const c = new THREE.Color();
    const cache = {};
    for (let i = 0; i < n; i++) {
      const r = src.getX(i), gg = src.getY(i), b = src.getZ(i);
      const key = (Math.round(r * 4096) << 0) + '_' + Math.round(gg * 4096) + '_' + Math.round(b * 4096);
      let cat = cache[key];
      if (cat === undefined) {
        c.setRGB(r, gg, b);
        const hex = c.getHex(THREE.SRGBColorSpace);
        cat = o.cats[hex];
        if (cat === undefined) {
          cat = 'other';
          unknown['0x' + hex.toString(16).padStart(6, '0')] = (unknown['0x' + hex.toString(16).padStart(6, '0')] || 0) + 1;
        }
        cache[key] = cat;
      }
      const cc = catCol[cat];
      out[i * 3] = cc.r; out[i * 3 + 1] = cc.g; out[i * 3 + 2] = cc.b;
    }
    return out;
  }

  function catClone(obj) {
    const root = new THREE.Group();
    root.position.copy(obj.position);
    root.rotation.copy(obj.rotation);
    root.scale.copy(obj.scale);
    obj.traverse(function (n) {
      if (!n.isMesh) return;
      const isInk = n.parent && n.parent.userData && n.parent.userData.line === n;
      let m;
      let geo = n.geometry;
      if (isInk) {
        m = n.material.clone();
        if (m.uniforms && m.uniforms.oColor) m.uniforms.oColor.value = catCol.ink.clone();
        if (m.uniforms && m.uniforms.inkFogFar) m.uniforms.inkFogFar = { value: 1e6 };
        if (m.uniforms && m.uniforms.inkFogNear) m.uniforms.inkFogNear = { value: 1e6 };
        m.fog = false;
      } else if (n.geometry.attributes.color) {
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', n.geometry.attributes.position);
        geo.setAttribute('normal', n.geometry.attributes.normal);
        geo.setAttribute('color', new THREE.BufferAttribute(
          categorise(n.geometry.attributes.color), 3));
        if (n.geometry.index) geo.setIndex(n.geometry.index);
        m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
      } else {
        // The caution face: one opaque striped quad, no colour attribute.
        m = new THREE.MeshBasicMaterial({ color: catCol.face, fog: false, toneMapped: false });
      }
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = n.renderOrder;
      // Flatten the world transform of this mesh relative to the variant root.
      n.updateMatrixWorld(true);
      obj.updateMatrixWorld(true);
      const rel = new THREE.Matrix4().copy(obj.matrixWorld).invert().multiply(n.matrixWorld);
      rel.decompose(mesh.position, mesh.quaternion, mesh.scale);
      root.add(mesh);
    });
    return root;
  }

  // ---- the sweep ----------------------------------------------------------
  const KEYS = o.catOrder;
  const rows = [];
  const png = {};
  const vlist = [];
  for (let i = 0; i < 24; i++) {
    const t = w.variantObject(KID, i);
    if (!t) break;
    vlist.push(i);
  }
  const want = (o.only === null || o.only === undefined) ? vlist : [Number(o.only)];

  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const tg = tmp.getContext('2d', { willReadFrequently: true });

  for (const vi of want) {
    for (const d of o.dists) {
      const obj = w.variantObject(KID, vi);
      const z = runnerZ + d;
      obj.position.set(K.LANE_X[lane], EL.at(z), z);
      obj.rotation.x = -Math.atan(EL.slope(z));
      holder.clear();
      holder.add(obj);

      // -- the beauty frame, whole scene, real lens --------------------------
      g.renderer.setRenderTarget(rt);
      g.renderer.render(g.scene, cam);
      grab();
      const beauty = new Uint8Array(buf);

      // -- the screen box of the object, from its own vertices ---------------
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj);
      let sx0 = 1e9, sy0 = 1e9, sx1 = -1e9, sy1 = -1e9;
      const p = new THREE.Vector3();
      for (const px of [bb.min.x, bb.max.x]) {
        for (const py of [bb.min.y, bb.max.y]) {
          for (const pz of [bb.min.z, bb.max.z]) {
            p.set(px, py, pz).project(cam);
            const X = (p.x * 0.5 + 0.5) * W, Y = (1 - (p.y * 0.5 + 0.5)) * H;
            sx0 = Math.min(sx0, X); sx1 = Math.max(sx1, X);
            sy0 = Math.min(sy0, Y); sy1 = Math.max(sy1, Y);
          }
        }
      }

      // -- the category frame, object only ----------------------------------
      const clone = catClone(obj);
      holder.clear();
      holder.add(clone);
      const savedVis = [];
      for (const n of g.scene.children) {
        if (n === holder || n.isLight) continue;
        savedVis.push([n, n.visible]);
        n.visible = false;
      }
      const prevFog = g.scene.fog;
      g.scene.fog = null;
      g.renderer.setClearColor(0x000000, 1);
      g.renderer.clear();
      g.renderer.render(g.scene, cam);
      grab();
      g.scene.fog = prevFog;
      for (const s of savedVis) s[0].visible = s[1];
      g.renderer.setClearColor(prevClr, prevA);

      const count = {};
      KEYS.forEach(function (k) { count[k] = 0; });
      let total = 0;
      let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
      for (let q = 0, pxi = 0; q < buf.length; q += 4, pxi++) {
        const R = buf[q], G = buf[q + 1], B = buf[q + 2];
        if (R < 6 && G < 6 && B < 6) continue;
        let hit = null;
        for (let k = 0; k < KEYS.length; k++) {
          const c = o.catRgb[KEYS[k]];
          if (Math.abs(R - c[0]) < 12 && Math.abs(G - c[1]) < 12 && Math.abs(B - c[2]) < 12) { hit = KEYS[k]; break; }
        }
        if (hit === null) continue;   // antialiased rim between two categories
        count[hit]++;
        total++;
        const X = pxi % W, Y = H - 1 - ((pxi / W) | 0);
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X;
        if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
      }

      rows.push({
        v: vi, d: d, total: total, count: count,
        px: total ? [bx1 - bx0 + 1, by1 - by0 + 1] : [0, 0],
        box: [sx0, sy0, sx1, sy1],
      });

      // -- crop the beauty tile, 1:1, around the object ---------------------
      if (o.tile) {
        const cx = Math.round((sx0 + sx1) / 2), cy = Math.round((sy0 + sy1) / 2);
        const T = o.tile;
        const ox = Math.max(0, Math.min(W - T, cx - (T >> 1)));
        const oy = Math.max(0, Math.min(H - T, cy - (T >> 1)));
        const img = tg.createImageData(W, H);
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4;
          img.data.set(beauty.subarray(src, src + W * 4), y * W * 4);
        }
        tg.putImageData(img, 0, 0);
        const cv2 = document.createElement('canvas');
        cv2.width = T; cv2.height = T;
        cv2.getContext('2d').drawImage(tmp, ox, oy, T, T, 0, 0, T, T);
        png[vi + '@' + d] = cv2.toDataURL('image/png');
      }

      holder.clear();
    }
  }

  g.renderer.setRenderTarget(prevRT);
  g.renderer.setClearColor(prevClr, prevA);
  g.scene.remove(holder);
  for (const n of hidden) n.visible = true;

  return {
    rows, png, unknown,
    lens: {
      fov: +cam.fov.toFixed(2), aspect: +cam.aspect.toFixed(4),
      pos: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)],
      runnerZ: +runnerZ.toFixed(1), lane: lane, playerLane: playerLane,
      laneX: K.LANE_X[lane], back: +(cam.position.z - runnerZ).toFixed(2),
    },
  };
}

// ---------------------------------------------------------------------------
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));
  await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + SKIP, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  // Let the camera springs settle at this pace before the lens is snapshotted.
  await page.waitForTimeout(1200);
  const buf = await page.evaluate(() => {
    const el = MR.game.renderer.domElement;
    return [el.width, el.height];
  });

  const res = await page.evaluate(pageRun, {
    kind: KIND, dists: DISTS, only: ONLY, lane: LANE,
    w: buf[0], h: buf[1], tile: SHEET ? TILE : 0,
    cats: CATS, catRgb: CAT_RGB, catOrder: CAT_ORDER,
  });
  if (res.error) { console.error(res.error); process.exit(1); }

  console.log('');
  console.log('FRAMING -- ' + KIND + ' through the live chase camera');
  console.log('  viewport ' + VP[0] + 'x' + VP[1] + ', drawing buffer ' + buf[0] + 'x' + buf[1]
    + ', skip=' + SKIP);
  console.log('  lens: fov ' + res.lens.fov + ', aspect ' + res.lens.aspect
    + ', eye ' + res.lens.pos.join(',') + ', ' + Math.abs(res.lens.back) + ' behind the runner');
  console.log('  hazard in lane ' + res.lens.lane + ' (x ' + res.lens.laneX
    + '), runner in lane ' + res.lens.playerLane + ' at z ' + res.lens.runnerZ);
  console.log('');
  const hdr = '  var    d   px on screen    total' + CAT_ORDER.map((c) => c.padStart(7)).join('');
  console.log(hdr);
  for (const r of res.rows) {
    const pct = CAT_ORDER.map(function (c) {
      const n = r.count[c] || 0;
      if (!r.total) return '      -';
      return (n ? (100 * n / r.total).toFixed(1) : '.').padStart(7);
    }).join('');
    console.log('  v' + String(r.v).padEnd(3) + String(r.d).padStart(4)
      + ('  ' + r.px[0] + 'x' + r.px[1]).padStart(13)
      + String(r.total).padStart(9) + pct);
  }
  console.log('');
  console.log('  (per-category figures are PERCENT of the object\'s own pixels)');
  const uk = Object.keys(res.unknown);
  if (uk.length) {
    console.log('');
    console.log('  UNCLASSIFIED HEXES (counted as "other"):');
    for (const k of uk) console.log('    ' + k + '  ' + res.unknown[k] + ' vertices');
  }

  if (SHEET) {
    const out = path.resolve(String(SHEET));
    const vs = [...new Set(res.rows.map((r) => r.v))];
    const sheet = await page.evaluate(({ png, vs, dists, TILE, rows }) => {
      const PAD = 8, LBL = 26, GUT = 54;
      const cv = document.createElement('canvas');
      cv.width = GUT + dists.length * (TILE + PAD);
      cv.height = PAD + LBL + vs.length * (TILE + PAD + 14);
      const c = cv.getContext('2d');
      c.fillStyle = '#12151d'; c.fillRect(0, 0, cv.width, cv.height);
      c.fillStyle = '#e8eefc'; c.font = '13px monospace';
      dists.forEach(function (d, i) { c.fillText(d + 'u', GUT + i * (TILE + PAD) + 4, PAD + LBL - 10); });
      const draws = [];
      vs.forEach(function (v, vi) {
        const y = PAD + LBL + vi * (TILE + PAD + 14);
        c.fillText('v' + v, 6, y + TILE / 2);
        dists.forEach(function (d, di) {
          const src = png[v + '@' + d];
          if (!src) return;
          const im = new Image();
          draws.push(new Promise(function (ok) {
            im.onload = function () {
              c.drawImage(im, GUT + di * (TILE + PAD), y);
              const r = rows.find(function (q) { return q.v === v && q.d === d; });
              c.fillStyle = '#9fb0d0'; c.font = '11px monospace';
              c.fillText(r.px[0] + 'x' + r.px[1] + ' ' + r.total + 'px',
                GUT + di * (TILE + PAD) + 2, y + TILE + 11);
              c.fillStyle = '#e8eefc'; c.font = '13px monospace';
              ok();
            };
            im.src = src;
          }));
        });
      });
      return Promise.all(draws).then(function () { return cv.toDataURL('image/png'); });
    }, { png: res.png, vs, dists: DISTS, TILE, rows: res.rows });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log('');
    console.log('  wrote ' + out + '  (tiles are ' + TILE + 'x' + TILE + ' 1:1 crops of the real frame)');
  }

  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(String(JSON_OUT)), JSON.stringify(res.rows, null, 1));
  }

  for (const e of errs) console.log('  ! ' + e);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
