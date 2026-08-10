#!/usr/bin/env node
/**
 * ENVELOPE -- the runner's silhouette, per vertex, in every state he has.
 *
 *   node tools/envelope.js                          the table
 *   node tools/envelope.js --json out.json          machine-readable
 *   node tools/envelope.js --base before.json       and the diff against it
 *   node tools/envelope.js --file build.html        against an alternate build
 *
 * ---- WHY THIS EXISTS -----------------------------------------------------
 *
 * src/render/runner.js states a contract its own header calls rule 4: state
 * has to read as SILHOUETTE, the jump is separated from everything else by
 * half-width and the slide from everything else by crown height, and no two
 * states may differ on the same axis. Three animation passes and a wardrobe
 * pass have all quoted numbers against that contract -- "stage 1 moved jump
 * half-width by 0.0007, stage 2 by 0.0000", "the run and jump silhouettes came
 * through IDENTICAL" -- and every one of them was measured by a script that
 * was thrown away afterwards. So the contract was re-derived from scratch, by
 * hand, four times, and a fifth agent has no way to check the fourth.
 *
 * This is that script, kept.
 *
 * ---- WHAT IS MEASURED, AND WHY IT IS PER VERTEX --------------------------
 *
 * Box3.setFromObject walks bounding boxes, and a bounding box under rotation
 * is the box of a box: it overstates. On a rig where every part is a rotated
 * sphere that overstatement is large and, worse, it MOVES with the pose, so a
 * geometry change can be masked or invented by it. So every de-duplicated
 * vertex of every visible fill mesh is transformed into ROOT space and the
 * extremes taken directly.
 *
 * Root space, not world space: the world position carries the lane, the hill
 * and the jump arc, and none of those is a fact about the character.
 *
 * The INK SHELL is not included. It is the same geometry drawn again through
 * a shader that pushes each vertex along its normal by a width measured at
 * the camera, so it is a screen-space skin on the number rather than part of
 * it -- and it is identical on both sides of any before/after this tool is
 * used for. What is reported is the geometry, which is what an author moves.
 *
 * ---- THE EIGHT STATES ----------------------------------------------------
 *
 * The rig is posed by calling api.update directly with a synthetic state
 * rather than by playing the game into that state, which is what makes the
 * sweep exhaustive instead of anecdotal: the half-open states (a jump 40%
 * inflated, a slide half-entered) are exactly where a new part can poke out
 * of the envelope, and they are the ones a played run passes through in three
 * frames.
 *
 * Every state is SETTLED before it is measured, for the reason recorded in
 * tools/stride.js: this rig carries lag filters and springs, and a filter
 * measured cold reports its transient as the pose. Settling is 300 steps at
 * 1/120 in the state itself, and only then are two full strides swept.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : true) : d;
}

const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const JSON_OUT = arg('json', null);
const BASE = arg('base', null);
const N = parseInt(arg('n', 48), 10);
const SKIP = String(arg('skip', '90'));

function pageSweep(o) {
  const g = MR.game, THREE = window.THREE;
  const r = g.runner;
  const root = r.group;
  // THE BODY, not the whole rig. The contact shadow, the landing reticle, the
  // skid ribbon and the dust are all direct children of the group, and two of
  // them are anchored in WORLD space -- the skid holds points the runner has
  // already passed, so a naive walk of the group reported zMin -2275 and a
  // lowest point 1.9 units under the road. Neither is a fact about the
  // silhouette. Measuring the body pivot in the group's frame is the whole
  // fix and it is exact: everything welded to a bone is under here.
  const figure = r.parts.body;

  // ---- the vertex set, de-duplicated once --------------------------------
  //
  // outlined() gives the fill and the ink shell the SAME geometry object, so
  // walking meshes naively counts every part twice and doubles the work for
  // no new extreme. Keyed on the geometry's uuid.
  const seen = {};
  const parts = [];
  figure.traverse(function (n) {
    if (!n.isMesh || !n.visible) return;
    if (n.renderOrder === -1) return;             // the ink shell
    const geo = n.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return;
    if (seen[geo.uuid + '|' + n.uuid]) return;
    seen[geo.uuid + '|' + n.uuid] = 1;
    const p = geo.attributes.position;
    // De-duplicate at 1e-5, which is four orders under the smallest dimension
    // on the character and two under the ink width.
    const key = {}, xs = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.round(x * 1e5) + '_' + Math.round(y * 1e5) + '_' + Math.round(z * 1e5);
      if (key[k]) continue;
      key[k] = 1;
      xs.push(x, y, z);
    }
    parts.push({ mesh: n, v: new Float32Array(xs), name: n.name || '' });
  });

  const m = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  const v = new THREE.Vector3();

  function extents(acc) {
    root.updateWorldMatrix(true, true);
    inv.copy(root.matrixWorld).invert();
    for (let pi = 0; pi < parts.length; pi++) {
      const P = parts[pi];
      // Skip anything the pose has switched off -- the reticle, the skid, the
      // dust. They are effects on the road, not the figure, and a dust puff
      // 4 units behind him is not a silhouette.
      let on = P.mesh.visible;
      for (let q = P.mesh.parent; q && on; q = q.parent) { if (!q.visible) on = false; if (q === root) break; }
      if (!on) continue;
      if (P.mesh.userData && P.mesh.userData.notFigure) continue;
      m.multiplyMatrices(inv, P.mesh.matrixWorld);
      const a = P.v;
      for (let i = 0; i < a.length; i += 3) {
        v.set(a[i], a[i + 1], a[i + 2]).applyMatrix4(m);
        if (v.x < acc.xMin) acc.xMin = v.x;
        if (v.x > acc.xMax) acc.xMax = v.x;
        if (v.y < acc.yMin) acc.yMin = v.y;
        if (v.y > acc.yMax) acc.yMax = v.y;
        if (v.z < acc.zMin) acc.zMin = v.z;
        if (v.z > acc.zMax) acc.zMax = v.z;
        const h = Math.abs(v.x);
        if (h > acc.half) acc.half = h;
      }
    }
  }

  const STATES = o.states;
  const out = {};
  for (let si = 0; si < STATES.length; si++) {
    const S = STATES[si];
    const st = {};
    for (const k in S.st) st[k] = S.st[k];
    st.speed = S.st.speed === undefined ? o.speed : S.st.speed;
    // Settle. See the header: a filter measured cold reports its transient.
    r.phase = 0;
    for (let k = 0; k < 300; k++) r.update(1 / 120, st);
    const acc = { xMin: 1e9, xMax: -1e9, yMin: 1e9, yMax: -1e9, zMin: 1e9, zMax: -1e9, half: 0 };
    // Two full strides at the sweep resolution, so a term with a period of
    // half a stride is sampled at both of its peaks.
    // The sweep window is two strides long, so it is sized off the cadence the
    // state would run at. The floor is for the start line and nothing else: a
    // standing runner is handed a ground speed of ZERO, cadence is a power of
    // speed, and 2/0 is an infinite dt that steps every spring in the rig to
    // NaN on the first sample. 0.5 Hz gives that state a four-second window,
    // which is the right length for the only things it has to move -- a breath
    // at 0.24 Hz and a weight shift at 0.11.
    const cadence = Math.max(0.5, 2.55 * Math.pow(st.speed / o.speedLo, 0.72));
    const dt = (2 / cadence) / (o.n * 2);
    for (let i = 0; i < o.n * 2; i++) {
      r.update(dt, st);
      extents(acc);
    }
    out[S.name] = {
      half: +acc.half.toFixed(5),
      crown: +acc.yMax.toFixed(5),
      low: +acc.yMin.toFixed(5),
      zMin: +acc.zMin.toFixed(5),
      zMax: +acc.zMax.toFixed(5),
    };
  }
  return { states: out, parts: parts.length, verts: parts.reduce(function (s, p) { return s + p.v.length / 3; }, 0) };
}

// The eight, and then the two that are not play. `air01` and `duck01` are swept
// at their half-open values as well as their full ones because that is where a
// new part escapes the envelope.
//
// ---- THE START LINE IS MEASURED, AND IT IS NOT PART OF THE CONTRACT -------
//
// `stand` and `stand-half` are here because a pose nobody measures is a pose
// that drifts, and because the standing start has one number that genuinely
// matters and is invisible from any screenshot: LOW. The stride's foot is
// planted by solving the ankle so hip + knee + ankle sums to zero, and the
// standing pose plants itself by obeying the same identity by hand -- there is
// no road clamp outside a slide, so a stand that got that sum wrong would float
// or sink and only a side elevation would ever show it.
//
// They are NOT part of rule 4's silhouette contract and must not be read as
// though they were. That contract exists so a player can tell a jump from a
// slide in three frames at forty pixels; the start line is a state the player
// is looking at while a countdown runs, with nothing to tell it apart from.
// What is being checked here is that the figure stands ON the road and inside
// the width the game already draws him at.
const STATES = [
  { name: 'run', st: {} },
  { name: 'stand', st: { stand: 1, speed: 0 } },
  // Halfway off the line, which is where the pose blend and the stride ramp are
  // both mid-flight and therefore where a joint can be somewhere neither end
  // ever puts it.
  { name: 'stand-half', st: { stand: 0.5, speed: 11 } },
  { name: 'jump-rise', st: { airborne: 1, air01: 0.42 } },
  { name: 'jump', st: { airborne: 1, air01: 1 } },
  { name: 'slide-enter', st: { ducking: 1, duck01: 0.5 } },
  { name: 'slide', st: { ducking: 1, duck01: 1 } },
  { name: 'lean', st: { lean: 1 } },
  { name: 'trip', st: { trip: 1, stumble: 1 } },
  { name: 'bounce', st: { bounce: 1, stumble: 1 } },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));
  await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + SKIP, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(400);

  const speeds = await page.evaluate(() => {
    const K = MR.K;
    return {
      lo: (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE,
      hi: (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE,
    };
  });
  const res = await page.evaluate(pageSweep, {
    states: STATES, n: N, speed: (speeds.lo + speeds.hi) / 2, speedLo: speeds.lo,
  });
  await browser.close();
  if (errs.length) { console.error(errs.slice(0, 3).join('\n')); process.exit(1); }

  const base = BASE ? JSON.parse(fs.readFileSync(path.resolve(String(BASE)), 'utf8')) : null;
  console.log('');
  console.log('  ' + res.parts + ' meshes, ' + res.verts + ' de-duplicated vertices, '
    + (N * 2) + ' samples a state');
  console.log('');
  const head = '  state          half      crown     low       zMin      zMax';
  console.log(head);
  console.log('  ' + '-'.repeat(head.length - 2));
  let worst = 0, worstAt = '';
  for (const S of STATES) {
    const r = res.states[S.name];
    let row = '  ' + S.name.padEnd(13)
      + r.half.toFixed(4).padStart(8) + '  ' + r.crown.toFixed(4).padStart(8) + '  '
      + r.low.toFixed(4).padStart(8) + '  ' + r.zMin.toFixed(4).padStart(8) + '  '
      + r.zMax.toFixed(4).padStart(8);
    console.log(row);
    if (base && base.states[S.name]) {
      const b = base.states[S.name];
      const d = ['half', 'crown', 'low', 'zMin', 'zMax'].map(function (k) {
        const dv = r[k] - b[k];
        if (Math.abs(dv) > worst) { worst = Math.abs(dv); worstAt = S.name + '.' + k; }
        return (dv >= 0 ? '+' : '') + dv.toFixed(4);
      });
      console.log('    vs base   ' + d.map(function (s) { return s.padStart(8); }).join('  '));
    }
  }
  if (base) {
    console.log('');
    console.log('  worst movement against the base: ' + worst.toFixed(5) + '  at ' + worstAt);
  }
  console.log('');
  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(String(JSON_OUT)), JSON.stringify(res, null, 1));
    console.log('  wrote ' + JSON_OUT);
  }
})();
