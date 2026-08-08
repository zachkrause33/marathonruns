#!/usr/bin/env node
/**
 * RESOLVE -- does a piece of detail own any pixels in the frame that ships?
 *
 * The question this answers is the one runner.js kept answering by arithmetic
 * and getting wrong: "a part 0.078 across on a 110px figure is half a pixel,
 * so it goes". Two of the three numbers in that sentence were guesses. The
 * figure is not 110px (tools/figure.js), and turning a world dimension into a
 * screen dimension by proportion ignores the two things that actually decide
 * whether a small part is visible at all:
 *
 *   OCCLUSION       a part can be geometrically large and drawn nowhere,
 *                   because the limb in front of it covers it for the whole
 *                   cycle. The cap peak is the worked example -- 0.48 across
 *                   and exactly zero pixels from astern.
 *   FORESHORTENING  a panel lying on the top of a shoe is not seen at its own
 *                   width; it is seen at its width times the cosine of an
 *                   angle that changes twice a stride.
 *
 * So nothing here is computed from a dimension. Each candidate is BUILT, given
 * a flat unique colour, and its pixels are COUNTED in the real chase frame at
 * the real viewport across a whole stride. A part that resolves owns pixels; a
 * part that does not, does not, and no argument about its size can overrule
 * the count.
 *
 *   node tools/resolve.js                  all candidates, 390x844, mid pace
 *   node tools/resolve.js --vp 844x390     another viewport
 *   node tools/resolve.js --skip 8         another pace
 *   node tools/resolve.js --list           what the candidates are
 *
 * ---- HOW THE CANDIDATE GETS INTO THE BUILD -------------------------------
 *
 * By patching the BUILT html, never the source. build.js concatenates
 * src/render/runner.js verbatim, so a unique line of it is a reliable anchor,
 * and the tree is never left dirty -- which matters because several agents
 * work in it at once and a scratch build must not be able to reach index.html.
 *
 * Each probe is its own mesh in an unlit flat colour rather than a weld into
 * the part it belongs to. That is deliberate: the weld would be shaded by the
 * toon ramp into three bands of something near its neighbour's tone and could
 * not be counted, while an unlit primary is exact. It sits at exactly the
 * transform the real piece would, so it is occluded by exactly what would
 * occlude the real piece. What it measures is the piece's UNOCCLUDED SCREEN
 * FOOTPRINT, which is the ceiling on what the piece could ever show.
 *
 * Reported with three references that were KEPT and judged to read -- the heel
 * counter, the short cuff and the wristband. A raw pixel count means nothing
 * without them; "38 px" is only a verdict next to a part everyone agrees reads
 * at 240.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const VP = String(arg('vp', '390x844')).split('x').map(Number);
const SKIP = arg('skip', '90');
const WINDOWS = parseInt(arg('windows', 3), 10);
const N = parseInt(arg('n', 16), 10);

// The probe colours. Pure 0/1 channels only: 0 and 1 are the fixed points of
// the sRGB transfer curve, so an unlit MeshBasicMaterial at these values comes
// out of the framebuffer as exactly these bytes and can be counted without a
// tolerance argument. Tone mapping and fog are both turned off at the material
// for the same reason.
const COLOURS = [0xff00ff, 0x00ff00, 0x00ffff, 0xffff00, 0xff0000, 0x0000ff];

/**
 * The candidates. `anchor` is a line of runner.js that appears exactly once in
 * the built file; the probe is inserted directly after it, in that line's own
 * scope, so `parent` is whatever pivot is in scope there.
 *
 * Geometry and transforms are transcribed from the commit that removed them
 * (6400fbd, the wardrobe pass) so this measures what was actually taken out
 * rather than a reconstruction of it.
 */
const CANDIDATES = [
  {
    name: 'lace panel',
    kind: 'removed',
    anchor: '      ankle.add(foot);',
    note: '0.078 x 0.030 x 0.150 on the instep -- cut as "half a pixel wide"',
    code: (c) => `__probe('lace panel', ankle, new THREE.BoxGeometry(0.078, 0.030, 0.150), ${c}, { y: 0.020, z: 0.070 });`,
  },
  {
    name: 'waistband',
    kind: 'removed',
    anchor: '    spine.add(pelvis);',
    note: '0.052 tall, third navy -- cut as "a 3px band of a near tone"',
    code: (c) => `__probe('waistband', spine, new THREE.CylinderGeometry(0.234, 0.232, 0.052, 20, 1, true), ${c}, { y: 0.000, sz: 0.79 });`,
  },
  {
    name: 'base-layer sleeve',
    kind: 'removed',
    anchor: '      shoulder.add(upper);',
    note: 'cut for READING WRONG (holes in the vest), not for size -- stays out',
    code: (c) => `__probe('base-layer sleeve', shoulder, new THREE.CylinderGeometry(0.101, 0.096, 0.090, 20, 1, true), ${c}, { y: -0.108 });`,
  },
  {
    name: 'sleeve cuff',
    kind: 'removed',
    anchor: '      shoulder.add(upper);',
    note: 'the rolled cuff that went with the sleeve',
    code: (c) => `__probe('sleeve cuff', shoulder, new THREE.CylinderGeometry(0.100, 0.098, 0.024, 20, 1, true), ${c}, { y: -0.160 });`,
  },
  {
    name: 'three fingers',
    kind: 'removed',
    anchor: '      elbow.add(fore);',
    note: 'three separate capsules -- cut as "three 4px lobes that alias into one"',
    code: (c) => `__probe('three fingers', elbow, new THREE.CapsuleGeometry(0.032, 0.046, 2, 10), ${c}, { y: -0.320, z: 0.012, rx: 0.60 });`,
  },
  // ---- positive controls ---------------------------------------------------
  //
  // The same geometry at the same distance from the same lens, moved clear of
  // everything that could occlude it. A candidate that counts zero in place
  // and non-zero afloat is HIDDEN; one that counts zero in both is a probe
  // that was never drawn, which is a defect in this tool and not a finding
  // about the character. Without this pair a broken probe and an invisible
  // part are the same reading, and the broken one is the flattering one.
  {
    name: 'CTRL lace afloat',
    kind: 'control',
    anchor: '      ankle.add(foot);',
    note: 'the lace panel, same size and depth, held clear of the shoe',
    code: (c) => `__probe('CTRL lace afloat', ankle, new THREE.BoxGeometry(0.078, 0.030, 0.150), ${c}, { x: side * 0.62, y: 0.42, z: 0.070 });`,
  },
  {
    name: 'CTRL waist afloat',
    kind: 'control',
    anchor: '    spine.add(pelvis);',
    note: 'the waistband, same size and depth, held clear of the body',
    code: (c) => `__probe('CTRL waist afloat', spine, new THREE.CylinderGeometry(0.234, 0.232, 0.052, 20, 1, true), ${c}, { x: 0.95, y: 0.000, sz: 0.79 });`,
  },
  // ---- references: kept, and judged to read -------------------------------
  {
    name: 'REF heel counter',
    kind: 'kept',
    anchor: '      ankle.add(foot);',
    note: 'called the best-value detail on the character',
    code: (c) => `__probe('REF heel counter', ankle, new THREE.SphereGeometry(0.098, 16, 12), ${c}, { y: -0.030, z: -0.076, sx: 0.90, sy: 0.72, sz: 0.72 });`,
  },
  {
    name: 'REF short cuff',
    kind: 'kept',
    anchor: '    spine.add(pelvis);',
    note: 'the band the waistband was judged against',
    code: (c) => `__probe('REF short cuff', spine, new THREE.CylinderGeometry(0.236, 0.230, 0.044, 20, 1, true), ${c}, { y: -0.126, sz: 0.79 });`,
  },
  {
    name: 'REF wristband',
    kind: 'kept',
    anchor: '      elbow.add(fore);',
    note: 'one of TRIM three hits on the figure',
    code: (c) => `__probe('REF wristband', elbow, new THREE.CylinderGeometry(0.098, 0.098, 0.052, 20, 1, true), ${c}, { y: -0.180 });`,
  },
];

const HELPER = `
    var __probe = function (name, parent, geo, hex, o) {
      o = o || {};
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: hex, fog: false, toneMapped: false,
      }));
      m.position.set(o.x || 0, o.y || 0, o.z || 0);
      m.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
      m.scale.set(o.sx || 1, o.sy || 1, o.sz || 1);
      m.renderOrder = 0;
      parent.add(m);
      (window.__probes = window.__probes || []).push({ name: name, hex: hex, mesh: m });
    };
`;

if (arg('list', false)) {
  for (const c of CANDIDATES) console.log('  ' + c.kind.padEnd(8) + c.name.padEnd(20) + c.note);
  process.exit(0);
}

// ---- build the probed variants ---------------------------------------------
//
// In BATCHES of six, because six is how many corners the RGB cube has once
// black and white are spent, and a seventh probe would have to share a colour
// with an earlier one and silently pool its count with it. Batching is the
// honest fix; widening the match tolerance is not.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-resolve-'));
const base = path.join(TMP, 'base.html');
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js'), '--out', base], { cwd: ROOT });
const baseHtml = fs.readFileSync(base, 'utf8');

const CREATE = '  function create() {';
if (baseHtml.indexOf(CREATE) < 0) { console.error('anchor missing: create()'); process.exit(2); }

const BATCHES = [];
for (let i = 0; i < CANDIDATES.length; i += COLOURS.length) {
  BATCHES.push(CANDIDATES.slice(i, i + COLOURS.length));
}

const builds = BATCHES.map((batch, bi) => {
  let html = baseHtml.replace(CREATE, CREATE + HELPER);
  const used = [];
  const seen = {};
  batch.forEach((cand, i) => {
    const hex = COLOURS[i];
    if (seen[hex]) { console.error('colour collision inside a batch'); process.exit(2); }
    seen[hex] = cand.name;
    const n = html.split(cand.anchor).length - 1;
    if (n !== 1) { console.error('anchor for "' + cand.name + '" appears ' + n + ' times, not once'); process.exit(2); }
    html = html.replace(cand.anchor, cand.anchor + '\n      ' + cand.code('0x' + hex.toString(16).padStart(6, '0')));
    used.push({ name: cand.name, kind: cand.kind, note: cand.note, hex });
  });
  const file = path.join(TMP, 'probed' + bi + '.html');
  fs.writeFileSync(file, html);
  return { file, used };
});

// ---------------------------------------------------------------------------
function pageHarness() {
  window.__rs = { pump: null, now: performance.now() };
  window.requestAnimationFrame = function (cb) { window.__rs.pump = cb; return 1; };
}

function pageSetup() {
  const g = MR.game, F = window.__rs;
  g.player.handle = function () { };
  g.player.resolveGates = function () { return []; };
  g.player.resolveAid = function () { return []; };
  F.now = performance.now();
  F.step = function (dtSec) {
    F.now += dtSec * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };
  // Scope the probes to the PLAYER'S rig. create() is called more than once --
  // the record ghost is the same rig re-materialled, and each arm and leg is
  // built in a loop over both sides -- so a probe list taken at face value is
  // eleven meshes per rig across two rigs. The ghost runs on the same road and
  // can be in frame, so leaving its probes visible would pool its pixels with
  // the player's and inflate every count.
  const mine = [], theirs = [];
  (window.__probes || []).forEach(function (p) {
    let own = false;
    for (let n = p.mesh; n; n = n.parent) if (n === g.runner.group) { own = true; break; }
    (own ? mine : theirs).push(p);
  });
  theirs.forEach(function (p) { p.mesh.visible = false; });
  window.__probes = mine;

  const el = g.renderer.domElement;
  F.cv = document.createElement('canvas');
  F.cv.width = el.width; F.cv.height = el.height;
  F.ctx = F.cv.getContext('2d', { willReadFrequently: true });
  const names = {};
  mine.forEach(function (p) { names[p.name] = (names[p.name] || 0) + 1; });
  return { w: el.width, h: el.height, mine: mine.length, hidden: theirs.length, names: names };
}

function pageSweep(opt) {
  const g = MR.game, F = window.__rs;
  // One key per NAME, not per mesh. A part that exists on both sides is two
  // meshes in one colour, and the count that follows is therefore the PAIR --
  // which is what the eye is given, and is stated as such in the report.
  const probes = window.__probes || [];
  const keys = [], byName = {};
  probes.forEach(function (p) {
    if (byName[p.name]) return;
    byName[p.name] = 1;
    keys.push({ name: p.name, r: (p.hex >> 16) & 255, g: (p.hex >> 8) & 255, b: p.hex & 255 });
  });

  const cadence = function () {
    const SPEED_LO = (MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.START_PACE;
    return 2.55 * Math.pow(g.pace.speed() / SPEED_LO, 0.72);
  };

  for (let i = 0; i < 20; i++) F.step(1 / 120);
  const z0 = g.pace.units;

  // Per probe: pixels in each sample, and the union bounding box.
  const acc = {};
  keys.forEach(function (k) { acc[k.name] = { per: [], w: 0, h: 0 }; });

  const el = g.renderer.domElement;
  for (let w = 0; w < (opt.windows || 3); w++) {
    const dt = (1 / cadence()) / opt.n;
    g.cam.stride = (g.cam.stride + 1 / (opt.windows || 3)) % 1;
    for (let i = 0; i < opt.n; i++) {
      F.step(dt);
      // Same task as the render that F.step just drove, so the drawing buffer
      // is still intact and needs no preserveDrawingBuffer.
      F.ctx.drawImage(el, 0, 0);
      const d = F.ctx.getImageData(0, 0, F.cv.width, F.cv.height).data;
      const cnt = {}, bx = {};
      keys.forEach(function (k) { cnt[k.name] = 0; bx[k.name] = [1e9, 1e9, -1e9, -1e9]; });
      for (let p = 0, px = 0; p < d.length; p += 4, px++) {
        const R = d[p], G = d[p + 1], B = d[p + 2];
        for (let k = 0; k < keys.length; k++) {
          const K = keys[k];
          // EXACT, within rounding. The first draft of this loop allowed a
          // third of the cube's diagonal so that antialiased edges would
          // count, and that tolerance made the tool useless in the direction
          // that flatters: the yellow probe matched TRIM -- the headband, the
          // wristbands and the midsoles are a saturated yellow -- and the red
          // probe matched the vest, so two candidates came back owning up to
          // 1084 pixels spread over a 323x773 box that no 0.024-tall cylinder
          // could possibly cover. An unlit MeshBasicMaterial with toneMapped
          // and fog off lands on the framebuffer at exactly its own bytes
          // (0 and 1 are the fixed points of the sRGB transfer), so exactness
          // costs only the antialiased rim and buys immunity to the palette.
          // Every figure here therefore UNDER-reports by an outline of edge
          // pixels, references included, which is the safe direction and is
          // the same bias on every row.
          if (Math.abs(R - K.r) < 3 && Math.abs(G - K.g) < 3 && Math.abs(B - K.b) < 3) {
            cnt[K.name]++;
            const x = px % F.cv.width, y = (px / F.cv.width) | 0;
            const b = bx[K.name];
            if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
            if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
            break;
          }
        }
      }
      keys.forEach(function (k) {
        const a = acc[k.name];
        a.per.push(cnt[k.name]);
        if (cnt[k.name] > 0) {
          const b = bx[k.name];
          a.w = Math.max(a.w, b[2] - b[0] + 1);
          a.h = Math.max(a.h, b[3] - b[1] + 1);
        }
      });
    }
  }

  if (!(g.pace.units - z0 > 1)) return { error: 'the clock did not advance' };

  const out = {};
  keys.forEach(function (k) {
    const a = acc[k.name];
    const s = a.per.slice().sort(function (p, q) { return p - q; });
    out[k.name] = {
      min: s[0], med: s[s.length >> 1], max: s[s.length - 1],
      zero: a.per.filter(function (v) { return v === 0; }).length,
      n: a.per.length, w: a.w, h: a.h,
    };
  });
  // The canvas is the DRAWING BUFFER, which is CSS pixels times the device
  // pixel ratio. Report it so a count can be read back to CSS px.
  return { probes: out, buf: [F.cv.width, F.cv.height], dpr: window.devicePixelRatio };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const all = {};
  const allUsed = [];
  let buf = null, dpr = null;
  for (const b of builds) {
    const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
    await page.goto('file://' + b.file + '?bot=1&skip=' + SKIP);
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.evaluate(pageHarness);
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!(window.__rs && window.__rs.pump))); i++) {
      await page.waitForTimeout(50);
    }
    const info = await page.evaluate(pageSetup);
    const res = await page.evaluate(pageSweep, { windows: WINDOWS, n: N });
    await ctx.close();

    if (errs.length) { console.error('page errors: ' + errs.slice(0, 3).join(' | ')); process.exit(1); }
    if (res.error) { console.error(res.error); process.exit(1); }
    // Every candidate in the batch must have been built on the player's rig,
    // and nothing may have been built that was not asked for.
    const got = Object.keys(info.names).sort().join('|');
    const want = b.used.map((u) => u.name).sort().join('|');
    if (got !== want) {
      console.error('probe mismatch\n  wanted ' + want + '\n  got    ' + got);
      process.exit(2);
    }
    Object.assign(all, res.probes);
    allUsed.push(...b.used);
    buf = res.buf; dpr = res.dpr;
  }
  await browser.close();

  console.log('');
  console.log('RESOLVE -- unoccluded screen footprint, ' + VP[0] + 'x' + VP[1]
    + ' skip=' + SKIP + ', ' + (WINDOWS * N) + ' samples across the stride');
  console.log('  drawing buffer ' + buf[0] + 'x' + buf[1] + ' (dpr ' + dpr + '), '
    + builds.length + ' batches of at most ' + COLOURS.length);
  console.log('');
  console.log('  candidate               pixels owned          frames    largest');
  console.log('                       min    med    max        unseen    extent');
  for (const u of allUsed) {
    const p = all[u.name];
    if (!p) { console.log('  ' + u.name + '  -- no data'); continue; }
    console.log('  ' + u.name.padEnd(20)
      + String(p.min).padStart(6) + String(p.med).padStart(7) + String(p.max).padStart(7)
      + ('   ' + p.zero + '/' + p.n).padStart(14)
      + ('   ' + p.w + 'x' + p.h + ' px').padStart(14));
  }
  console.log('');
  for (const u of allUsed) console.log('  ' + u.kind.padEnd(9) + u.name.padEnd(20) + u.note);
  console.log('');
  fs.rmSync(TMP, { recursive: true, force: true });
})();
