#!/usr/bin/env node
/**
 * PEOPLE -- how big is a person in this game, in pixels, where the game
 * actually puts them?
 *
 *   node tools/people.js                     the default skip, 390x844
 *   node tools/people.js --skip 900          another leg
 *   node tools/people.js --skip 150,900,1560 several, in one run
 *
 * ---- WHY THIS EXISTS ------------------------------------------------------
 *
 * tools/framing.js answers this question for the HAZARD FLEET, because a
 * hazard is placed by a claim site the tool can copy: lane x, elevation, road
 * pitch, distance d. The crowd is not placed like that. A spectator knot rolls
 * to a lateral offset between 4.50 and 10.20, a walker to between 7.95 and
 * 14.60, a grandstand runs the whole length of a leg -- and the depth any of
 * them is READ at is not a number anybody chooses, it is whatever the frustum
 * leaves after the lateral offset is taken out.
 *
 * That last point is the whole reason this tool is not a spreadsheet. The
 * viewport is PORTRAIT: 390x844 at fov 72 vertical is a HORIZONTAL half-angle
 * of about 18.6 degrees. A spectator 4.5 units to the side is therefore not in
 * frame at all until it is roughly 13 units ahead, and one 10 units out needs
 * 30. The crowd has a MINIMUM READ DISTANCE that nothing in the source states,
 * and it is set by the aspect ratio.
 *
 * So this asks the running page instead. It snapshots the live chase camera
 * exactly as tools/framing.js does -- position, quaternion, fov, aspect, after
 * the springs have settled -- and then measures the people who are ACTUALLY IN
 * THE SCENE at that moment, at the transforms the claim sites gave them.
 *
 * ---- WHAT IT MEASURES -----------------------------------------------------
 *
 * Populations are found by userData.people, which world.js stamps on every
 * pool that builds human figures. Nothing is identified by material or by
 * guessing at a name.
 *
 * For each population it recovers INDIVIDUAL HEADS out of the merged geometry.
 * merge() writes one flat colour per authored part, so the skin hexes are a
 * mask; the masked vertices are then clustered in object space, and a cluster
 * wide enough and tall enough to be a head is a head (the rest are hands).
 * Every corner of every head cluster is projected through the live camera, in
 * world space, so what comes back is the head's real screen box in the frame
 * that ships.
 *
 * Two numbers per head, and they answer different questions:
 *
 *   PROJECTED   the head's screen bounding box in px. This is the CEILING on
 *               what any facial feature could ever occupy, and it is what
 *               decides whether a face is worth building.
 *   RENDERED    the head's actual pixel count, by re-rendering the real frame
 *               with head vertices swapped to a flat key colour and counting.
 *               This is the projected box MINUS occlusion -- the row in front,
 *               the barrier, the placard -- and it is what the player sees.
 *
 * The difference between the two is the finding, not a rounding error: a
 * grandstand's back rows project a head that is never drawn.
 *
 * ---- THE VERDICT COLUMN ---------------------------------------------------
 *
 * `eye` is the projected width of a mark 0.055 world units across -- the size
 * an eye would be authored at on a 0.28 head -- placed at the head's own
 * depth. A feature under about 1.2 px cannot be drawn: it lands inside one
 * pixel and is averaged into its neighbour, which is a smudge on the head and
 * not an eye. The tier each population lands in is read off that column and
 * off nothing else.
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}
const VP = String(arg('vp', '390x844')).split('x').map(Number);
const SKIPS = String(arg('skip', '150,900,1560,2050')).split(',');
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const FEATURE = parseFloat(arg('feature', 0.055));
const SAMPLES = parseInt(arg('samples', 6), 10);

// The four skin hexes every figure in the game is built from, plus the two
// the hazard fleet's riders use. Stated here rather than sniffed, so a skin
// added to world.js and not to this list shows up as a population with no
// heads -- a visible finding rather than a quiet undercount.
const SKINS = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];

// ---------------------------------------------------------------------------
function pageRun(o) {
  const g = MR.game, THREE = window.THREE;
  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position);
  cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect;
  cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const W = o.w, H = o.h;
  const skinSet = {};
  for (const s of o.skins) skinSet[s] = 1;

  // ---- find every population in the live scene ---------------------------
  const pops = {};
  const heads = [];          // { pop, world corners, depth }
  const marks = [];          // { mesh, indices } to key-colour for the render pass
  const _c = new THREE.Color();

  g.scene.traverse(function (n) {
    if (!n.isMesh || !n.visible) return;
    let p = n;
    let tag = null;
    while (p) { if (p.userData && p.userData.people) { tag = p.userData.people; break; } p = p.parent; }
    if (!tag) return;
    // The ink shell is the same geometry drawn twice; measure the fill only.
    if (p.userData.line === n) return;
    const geo = n.geometry;
    const col = geo.attributes.color;
    const pos = geo.attributes.position;
    if (!col || !pos) return;
    n.updateMatrixWorld(true);
    const mw = n.matrixWorld;

    // Which vertices are skin, in the author's own hex.
    const cache = {};
    const isSkin = new Uint8Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const key = Math.round(col.getX(i) * 4096) + '_' + Math.round(col.getY(i) * 4096)
        + '_' + Math.round(col.getZ(i) * 4096);
      let v = cache[key];
      if (v === undefined) {
        _c.setRGB(col.getX(i), col.getY(i), col.getZ(i));
        v = skinSet[_c.getHex(THREE.SRGBColorSpace)] ? 1 : 0;
        cache[key] = v;
      }
      isSkin[i] = v;
    }

    // Cluster the skin vertices in OBJECT space on a 0.34 grid. A head is one
    // box 0.24-0.60 across; a hand is a box a third of that. Grid cells are
    // unioned to their already-seen neighbours so a box straddling a boundary
    // is one cluster and not eight.
    const CELL = 0.34;
    const cellOf = {};
    const parent = [];
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    const vcell = new Int32Array(pos.count).fill(-1);
    for (let i = 0; i < pos.count; i++) {
      if (!isSkin[i]) continue;
      const cx = Math.floor(pos.getX(i) / CELL), cy = Math.floor(pos.getY(i) / CELL),
        cz = Math.floor(pos.getZ(i) / CELL);
      const k = cx + ',' + cy + ',' + cz;
      let id = cellOf[k];
      if (id === undefined) { id = parent.length; parent.push(id); cellOf[k] = id; }
      vcell[i] = id;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const nk = (cx + dx) + ',' + (cy + dy) + ',' + (cz + dz);
            if (cellOf[nk] !== undefined) uni(id, cellOf[nk]);
          }
        }
      }
    }
    const groups = {};
    for (let i = 0; i < pos.count; i++) {
      if (vcell[i] < 0) continue;
      const rootId = find(vcell[i]);
      (groups[rootId] || (groups[rootId] = [])).push(i);
    }

    const keyIdx = [];
    for (const k in groups) {
      const idx = groups[k];
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const i of idx) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const wW = x1 - x0, wH = y1 - y0;
      // A head, not a hand and not a bare forearm.
      if (wW < 0.20 || wH < 0.20) continue;
      /**
       * Project all eight corners of the object-space box through the world
       * transform and the live lens.
       *
       * EVERY CORNER IS TESTED IN VIEW SPACE FIRST, and that is not belt and
       * braces -- it is the defect this tool shipped with. `Vector3.project`
       * divides by w, and w goes through zero at the camera plane: a head
       * BESIDE or BEHIND the eye comes back with its screen box mirrored and
       * enormous. The first run of this tool reported a spectator head of
       * 114,730 px and an eye of 26,292 px, which is the whole viewport
       * several times over, and it reported it as the BEST CASE -- the number
       * a decision to build a face would have been taken on.
       *
       * Same family as everything in docs/roadmap.md: the instrument flattered
       * the thing it measured, and it did it by the largest margin available.
       */
      let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, dep = 0, behind = 0;
      const v = new THREE.Vector3();
      for (let c = 0; c < 8; c++) {
        v.set(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0).applyMatrix4(mw);
        const wv3 = v.clone();
        dep += wv3.distanceTo(cam.position) / 8;
        v.applyMatrix4(cam.matrixWorldInverse);
        if (-v.z <= cam.near) { behind++; continue; }
        v.applyMatrix4(cam.projectionMatrix);
        const px = (v.x * 0.5 + 0.5) * W, py = (0.5 - v.y * 0.5) * H;
        if (px < sx0) sx0 = px; if (px > sx1) sx1 = px;
        if (py < sy0) sy0 = py; if (py > sy1) sy1 = py;
      }
      const inFrame = behind === 0 && sx1 > 0 && sx0 < W && sy1 > 0 && sy0 < H;
      heads.push({
        pop: tag, d: +dep.toFixed(1),
        pw: +(sx1 - sx0).toFixed(1), ph: +(sy1 - sy0).toFixed(1),
        ww: +wW.toFixed(2), wh: +wH.toFixed(2),
        inFrame: inFrame,
      });
      if (inFrame) for (const i of idx) keyIdx.push(i);
      pops[tag] = pops[tag] || { n: 0, meshes: 0 };
    }
    pops[tag] = pops[tag] || { n: 0, meshes: 0 };
    pops[tag].meshes++;
    if (keyIdx.length) marks.push({ mesh: n, idx: keyIdx, tag: tag });
  });

  // ---- rendered head pixels ----------------------------------------------
  // The real frame, twice: once as it ships, once with head vertices keyed to
  // a flat unlit colour. Every pixel that turns the key colour is a head
  // pixel the player actually sees -- occlusion included, because everything
  // in front of it is still drawn by the same scene at the same depths.
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(W * H * 4);
  const prevRT = g.renderer.getRenderTarget();
  const perTag = {};

  const tags = Object.keys(pops);
  for (const tag of tags) {
    const swapped = [];
    for (const m of marks) {
      if (m.tag !== tag) continue;
      const geo = m.mesh.geometry;
      const col = geo.attributes.color;
      const save = new Float32Array(m.idx.length * 3);
      for (let j = 0; j < m.idx.length; j++) {
        const i = m.idx[j];
        save[j * 3] = col.getX(i); save[j * 3 + 1] = col.getY(i); save[j * 3 + 2] = col.getZ(i);
      }
      const mat = m.mesh.material;
      const basic = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false });
      swapped.push({ mesh: m.mesh, idx: m.idx, save: save, mat: mat, geo: geo });
      // Key colour on the heads, black everywhere else on this mesh, so the
      // count cannot be contaminated by the population's own body colours.
      const n = col.count;
      const keep = new Float32Array(col.array);
      for (let i = 0; i < n; i++) { col.setXYZ(i, 0, 0, 0); }
      for (const i of m.idx) col.setXYZ(i, 1, 0, 1);
      col.needsUpdate = true;
      swapped[swapped.length - 1].keep = keep;
      m.mesh.material = basic;
    }
    if (!swapped.length) { perTag[tag] = 0; continue; }
    g.renderer.setRenderTarget(rt);
    g.renderer.render(g.scene, cam);
    g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    let hit = 0;
    for (let i = 0; i < W * H; i++) {
      if (buf[i * 4] > 200 && buf[i * 4 + 1] < 60 && buf[i * 4 + 2] > 200) hit++;
    }
    perTag[tag] = hit;
    for (const s of swapped) {
      s.geo.attributes.color.array.set(s.keep);
      s.geo.attributes.color.needsUpdate = true;
      s.mesh.material = s.mat;
    }
  }
  g.renderer.setRenderTarget(prevRT);

  return {
    heads, perTag,
    pops: Object.keys(pops).map((k) => ({ tag: k, meshes: pops[k].meshes })),
    lens: {
      fov: +cam.fov.toFixed(2), aspect: +cam.aspect.toFixed(4),
      hHalfDeg: +(Math.atan(Math.tan(cam.fov * Math.PI / 360) * cam.aspect) * 180 / Math.PI).toFixed(2),
      runnerZ: +g.pace.units.toFixed(1), biome: (g.course && g.course.biomeAt) ? '' : '',
    },
  };
}

// ---------------------------------------------------------------------------
function pct(a, q) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

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

  console.log('');
  console.log('PEOPLE -- human figures through the live chase camera, ' + VP[0] + 'x' + VP[1]);

  const all = {};
  for (const skip of SKIPS) {
    await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + skip, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const buf = await page.evaluate(() => {
      const el = MR.game.renderer.domElement;
      return [el.width, el.height];
    });
    /**
     * SEVERAL FRAMES, NOT ONE, because a knot's read distance is a function
     * of WHEN you look. The claim sites roll a lateral offset and the portrait
     * frustum then decides how far ahead that offset has to be before it is in
     * shot at all -- so a single frame samples one arbitrary point of every
     * knot's approach and can miss the closest one by a hundred units. Six
     * samples over four seconds of wall clock is about 600 units of road.
     */
    const samples = [];
    let lens = null, z0 = 0, z1 = 0;
    for (let s = 0; s < SAMPLES; s++) {
      if (s) await page.waitForTimeout(650);
      const r = await page.evaluate(pageRun, { w: buf[0], h: buf[1], skins: SKINS });
      samples.push(r);
      lens = r.lens;
      if (!s) z0 = r.lens.runnerZ;
      z1 = r.lens.runnerZ;
    }
    console.log('');
    console.log('  skip ' + skip + 's -- runner z ' + z0 + ' to ' + z1
      + ', fov ' + lens.fov + ' vertical / ' + lens.hHalfDeg + ' horizontal half-angle');
    const byPop = {};
    const rend = {};
    for (const r of samples) {
      for (const h of r.heads) (byPop[h.pop] || (byPop[h.pop] = [])).push(h);
      for (const k in r.perTag) (rend[k] || (rend[k] = [])).push(r.perTag[k]);
    }
    if (!Object.keys(byPop).length) { console.log('    no human figures on this leg'); continue; }
    console.log('');
    console.log('   population        heads  inframe   depth range     head px w x h      best w   eye px   rendered/frame');
    for (const tag of Object.keys(byPop).sort()) {
      const hs = byPop[tag];
      const vis = hs.filter((h) => h.inFrame);
      const ds = vis.map((h) => h.d);
      const ws = vis.map((h) => h.pw), hh = vis.map((h) => h.ph);
      const near = ds.length ? Math.min.apply(null, ds) : 0;
      const far = ds.length ? Math.max.apply(null, ds) : 0;
      // The eye mark at the WIDEST head seen across every sample -- the best
      // case, which is the number a decision to build a face has to clear.
      const bestW = ws.length ? Math.max.apply(null, ws) : 0;
      const bestWorld = ws.length ? vis[ws.indexOf(bestW)].ww : 1;
      const eye = bestWorld ? (bestW * FEATURE / bestWorld) : 0;
      const rr = rend[tag] || [0];
      const rMean = rr.reduce((a, b) => a + b, 0) / rr.length;
      (all[tag] || (all[tag] = [])).push({ eye, bestW });
      console.log('   ' + tag.padEnd(16)
        + String(Math.round(hs.length / samples.length)).padStart(6)
        + String(Math.round(vis.length / samples.length)).padStart(9)
        + ('  ' + near.toFixed(0) + '-' + far.toFixed(0)).padStart(14)
        + ('  ' + (ws.length ? pct(ws, 0.5).toFixed(1) : '-') + ' x '
          + (hh.length ? pct(hh, 0.5).toFixed(1) : '-')).padStart(18)
        + bestW.toFixed(1).padStart(9)
        + eye.toFixed(2).padStart(9)
        + rMean.toFixed(0).padStart(16));
    }
  }
  console.log('');
  console.log('  heads/inframe are per frame, averaged over ' + SAMPLES + ' samples a leg.');
  console.log('  head px is the MEDIAN projected box of heads in frame; best w is the widest seen.');
  console.log('  eye px is a ' + FEATURE + '-unit mark on the widest head: under ~1.2 px it cannot be drawn.');
  console.log('  rendered is the population\'s head pixels actually on screen per frame, occlusion included.');
  console.log('');
  console.log('  BEST CASE ACROSS EVERY LEG SAMPLED');
  for (const tag of Object.keys(all).sort()) {
    const b = all[tag].reduce((a, x) => (x.bestW > a.bestW ? x : a), { bestW: 0, eye: 0 });
    console.log('   ' + tag.padEnd(16) + 'widest head ' + b.bestW.toFixed(1)
      + ' px, eye mark ' + b.eye.toFixed(2) + ' px  --  '
      + (b.eye >= 1.8 ? 'A FACE RESOLVES' : b.eye >= 1.2 ? 'a face is marginal' : 'NO FACE CAN RESOLVE'));
  }
  if (errs.length) { console.log(''); for (const e of errs) console.log('  ' + e); }
  await browser.close();
})();
