#!/usr/bin/env node
/**
 * POSE DIFF -- did the animation change, or only the geometry?
 *
 *   node tools/pose-diff.js --a old.html --b new.html
 *   node tools/pose-diff.js --a old.html --b new.html --polish 0
 *   node tools/pose-diff.js --a x.html --b x.html          the noise floor
 *
 * ---- WHY THIS EXISTS -----------------------------------------------------
 *
 * src/render/runner.js carries an A/B: every term the three animation passes
 * added is scaled by MR.Runner.POLISH, and `?polish=0` is supposed to give
 * back the cycle as it was before any of them. That promise has been checked
 * three times and re-derived from scratch each time, most recently as "2.95e-13
 * against a same-build control at 3.42e-13" -- a number with no instrument
 * behind it that anyone can run again.
 *
 * It is also the check a GEOMETRY pass needs, and for the opposite reason. A
 * pass that only moves vertices must not move a joint at ANY polish setting,
 * and "I did not edit update()" is not evidence -- runner.js poses the rig off
 * constants that a geometry edit is exactly the kind of change that reaches.
 *
 * ---- WHAT IS COMPARED ----------------------------------------------------
 *
 * Every joint the file poses, by name, out of the api's own `parts` -- body,
 * hips, spine, chest, neck, head, the hood, and hip/knee/ankle and
 * shoulder/elbow on both sides. Position and quaternion, at every sample, in
 * every one of the eight states tools/envelope.js sweeps.
 *
 * BY NAME, and that is the whole design of it. The obvious implementation
 * walks the rig and compares the Nth node to the Nth node, and that silently
 * stops working the moment a pass ADDS a pivot -- which is what a face pass
 * does when it gives the mouth its own transform. An index-keyed diff would
 * then compare a shoulder to an elbow and report a large, meaningless, and
 * very alarming number.
 *
 * ---- THE CONTROL ---------------------------------------------------------
 *
 * Two runs of the SAME file are not bit-identical: the page runs a real clock
 * before the harness takes it over and the springs settle from wherever that
 * left them. So the honest reading is always the pair -- the A/B difference
 * beside the A/A difference on the same machine in the same session -- and
 * this prints both, with --control on by default.
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

const A = path.resolve(String(arg('a', path.join(ROOT, 'index.html'))));
const B = path.resolve(String(arg('b', path.join(ROOT, 'index.html'))));
const POLISH = arg('polish', null);
const N = parseInt(arg('n', 24), 10);
const SKIP = String(arg('skip', '90'));

const STATES = [
  { name: 'run', st: {} },
  { name: 'jump-rise', st: { airborne: 1, air01: 0.42 } },
  { name: 'jump', st: { airborne: 1, air01: 1 } },
  { name: 'slide-enter', st: { ducking: 1, duck01: 0.5 } },
  { name: 'slide', st: { ducking: 1, duck01: 1 } },
  { name: 'lean', st: { lean: 1 } },
  { name: 'trip', st: { trip: 1, stumble: 1 } },
  { name: 'bounce', st: { bounce: 1, stumble: 1 } },
];

function pageSample(o) {
  const g = MR.game;
  const r = g.runner;
  if (o.polish !== null) MR.Runner.POLISH = o.polish;
  const P = r.parts;
  const joints = [
    ['body', P.body], ['hips', P.hips], ['spine', P.spine], ['chest', P.chest],
    ['neck', P.neck], ['head', P.head], ['hood', P.hood],
  ];
  // The expression pivots are newer than this tool and may not exist in the
  // build on the other side of an A/B, so they are added only when BOTH have
  // them -- a missing joint is reported as a joint-set mismatch, which is the
  // right answer for a rename and the wrong one for a comparison against a
  // build that predates the pass.
  if (P.eyes) joints.push(['eyes', P.eyes]);
  if (P.brows) joints.push(['brows', P.brows]);
  if (P.mouth) joints.push(['mouth', P.mouth]);
  P.legs.forEach(function (L, i) {
    joints.push(['leg' + i + '.hip', L.hip], ['leg' + i + '.knee', L.knee], ['leg' + i + '.ankle', L.ankle]);
  });
  P.arms.forEach(function (Aa, i) {
    joints.push(['arm' + i + '.shoulder', Aa.shoulder], ['arm' + i + '.elbow', Aa.elbow]);
  });

  const out = {};
  for (let si = 0; si < o.states.length; si++) {
    const S = o.states[si];
    const st = {};
    for (const k in S.st) st[k] = S.st[k];
    st.speed = S.st.speed === undefined ? o.speed : S.st.speed;
    r.phase = 0;
    for (let k = 0; k < 300; k++) r.update(1 / 120, st);
    const cadence = 2.55 * Math.pow(st.speed / o.speedLo, 0.72);
    const dt = (1 / cadence) / o.n;
    const rows = [];
    for (let i = 0; i < o.n; i++) {
      r.update(dt, st);
      const row = [];
      for (let j = 0; j < joints.length; j++) {
        const n = joints[j][1];
        row.push(n.position.x, n.position.y, n.position.z,
          n.quaternion.x, n.quaternion.y, n.quaternion.z, n.quaternion.w,
          n.scale.x, n.scale.y, n.scale.z);
      }
      rows.push(row);
    }
    out[S.name] = rows;
  }
  return { names: joints.map(function (j) { return j[0]; }), states: out };
}

async function sample(browser, file, polish) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('file://' + file + '?bot=1&nocount=1&skip=' + SKIP, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(400);
  const speeds = await page.evaluate(() => {
    const K = MR.K;
    return {
      lo: (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE,
      hi: (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE,
    };
  });
  const res = await page.evaluate(pageSample, {
    states: STATES, n: N, polish: polish === null ? null : parseFloat(polish),
    speed: (speeds.lo + speeds.hi) / 2, speedLo: speeds.lo,
  });
  await ctx.close();
  if (errs.length) { console.error(errs.slice(0, 2).join('\n')); process.exit(1); }
  return res;
}

/**
 * Compare two samples on the joints they SHARE.
 *
 * An A/B across a pass that added a pivot has two joint sets that differ by
 * that pivot, and refusing to compare at all is the wrong answer: the whole
 * question is whether the joints that existed before still do the same thing.
 * So the intersection is compared and the difference is reported as a fact
 * about the pass rather than as an error. Each side is indexed by its OWN
 * name list, which is what stops an added pivot shifting every joint after it
 * by one and turning a shoulder into an elbow.
 */
function diff(a, b) {
  const ia = {}, ib = {};
  a.names.forEach(function (n, i) { ia[n] = i; });
  b.names.forEach(function (n, i) { ib[n] = i; });
  const shared = a.names.filter(function (n) { return ib[n] !== undefined; });
  if (!shared.length) return { error: 'no joints in common' };
  let worst = 0, at = '';
  const perJoint = {};
  for (const s in a.states) {
    const ra = a.states[s], rb = b.states[s];
    if (!rb || ra.length !== rb.length) return { error: 'sample counts differ in ' + s };
    for (let i = 0; i < ra.length; i++) {
      for (const n of shared) {
        for (let k = 0; k < 10; k++) {
          const d = Math.abs(ra[i][ia[n] * 10 + k] - rb[i][ib[n] * 10 + k]);
          if (!(perJoint[n] > d)) perJoint[n] = Math.max(perJoint[n] || 0, d);
          if (d > worst) { worst = d; at = s + ' ' + n + ' [' + k + ']'; }
        }
      }
    }
  }
  const onlyA = a.names.filter(function (n) { return ib[n] === undefined; });
  const onlyB = b.names.filter(function (n) { return ia[n] === undefined; });
  return { worst, at, perJoint, shared: shared.length, onlyA, onlyB };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const a = await sample(browser, A, POLISH);
  const b = await sample(browser, B, POLISH);
  // TWO controls, not one, and it is the difference between an instrument and
  // a number. At polish 0 the rig is a closed-form function of phase and a
  // same-build pair comes back at 1e-8; at shipped polish it comes back around
  // 1e-4, because the surge filters and the hood springs carry history from
  // the real clock the page ran before the harness took it over, and no amount
  // of settling makes two sessions agree bit for bit. A single control cannot
  // say whether an A/B reading of 1.6e-4 is a change or a draw from that same
  // distribution -- so the control's OWN spread is measured and printed beside
  // it, and the reader is given the three numbers rather than a verdict
  // computed off a threshold somebody chose.
  const c1 = await sample(browser, A, POLISH);
  const c2 = await sample(browser, A, POLISH);
  await browser.close();

  const d = diff(a, b);
  const c = diff(a, c1);
  const cc = diff(c1, c2);
  if (d.error || c.error || cc.error) { console.error(d.error || c.error || cc.error); process.exit(1); }

  console.log('');
  console.log('POSE DIFF   polish ' + (POLISH === null ? '(as shipped)' : POLISH)
    + '   ' + d.shared + ' shared joints x ' + N + ' samples x ' + STATES.length + ' states');
  if (d.onlyA.length) console.log('  only in A: ' + d.onlyA.join(', '));
  if (d.onlyB.length) console.log('  only in B: ' + d.onlyB.join(', '));
  console.log('  A  ' + A);
  console.log('  B  ' + B);
  console.log('');
  console.log('  A vs B         ' + d.worst.toExponential(3) + '   at ' + d.at);
  console.log('  A vs A  ctrl   ' + c.worst.toExponential(3) + '   at ' + c.at);
  console.log('  A vs A  ctrl   ' + cc.worst.toExponential(3) + '   at ' + cc.at);
  console.log('');
  const worst = Object.keys(d.perJoint).sort(function (p, q) { return d.perJoint[q] - d.perJoint[p]; });
  for (const j of worst.slice(0, 6)) {
    console.log('    ' + j.padEnd(16) + d.perJoint[j].toExponential(3));
  }
  console.log('');
  const floor = Math.max(c.worst, cc.worst);
  console.log('  A/B is ' + (d.worst / (floor || 1e-18)).toFixed(2)
    + 'x the larger of the two same-build controls'
    + (d.worst <= floor ? ' -- inside the floor.' : '.'));
})();
