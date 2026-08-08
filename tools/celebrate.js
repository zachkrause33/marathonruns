#!/usr/bin/env node
/**
 * CELEBRATE -- how big is the runner's FACE during the finish, in the frame
 * that ships?
 *
 * This tool exists because of one measurement and one habit.
 *
 * THE MEASUREMENT. The character pass counted the face at 0 pixels in 48 of 48
 * frames of play, 0 at the start panel and 0 at the finish. Everything the pass
 * built -- two eyes with catchlights, brows that furrow, an open mouth, a jaw --
 * has never been on a player's screen. camera.js now walks the lens round to
 * the front of him after the tape, so the claim to check is no longer "is there
 * a face" but "how many pixels of it, for how long, on a phone".
 *
 * THE HABIT. This project has repeatedly verified at framings the game never
 * uses -- a 110px runner assumed for a year, a silhouette sheet that was
 * unpassable by construction, a contact sheet that was a single panorama. The
 * whole point of this pass is that the framing CHANGED, so the new one is
 * measured rather than described.
 *
 *   node tools/celebrate.js                 the sweep: face px vs time, 4 sizes
 *   node tools/celebrate.js --frames        ...and write the contact sequence
 *   node tools/celebrate.js --joy 0         the losing pose
 *   node tools/celebrate.js --only 390x844  one viewport
 *   node tools/celebrate.js --json          machine-readable
 *
 * ---- WHAT IS MEASURED ----------------------------------------------------
 *
 *   FACE     brow line to chin, in CSS pixels, through the real lens. Both
 *            landmarks come from geometry rather than from a constant: the brow
 *            is the brow pivot's own origin, and the chin is the LOWEST vertex
 *            of the head mesh on the front centre line (|x| < 0.06, z > 0.06),
 *            which is the underside of the jaw mass. Nothing here would survive
 *            silently if runner.js moved either one.
 *   FEATURES the projected bounding box of every vertex of the eye, brow and
 *            mouth meshes. The face is not a flat card at an angle, so this is
 *            the honest "how much of the frame do his features occupy".
 *   TURN     the angle between the head's own +z (which is the direction the
 *            nose points) and the direction from the head to the lens. 0 is
 *            dead-on; past 90 the face is pointing away and the pixel counts
 *            above are meaningless, so it is printed beside them.
 *   FIGURE   crown-to-sole in pixels, and the lowest row of the figure against
 *            the readout panel -- the same assertion tools/footroom.js makes
 *            about play, made about a framing footroom.js never sees.
 *
 * ---- WHY THE CLOCK IS PUMPED ---------------------------------------------
 *
 * Lifted from tools/figure.js and tools/footroom.js: rAF is replaced with a
 * hand-pumped callback so the loop advances in exact synthetic steps. That
 * matters more here than in either of them, because the thing being measured is
 * a 2.6-second parametric MOVE. Under SwiftShader this page runs at about 7fps,
 * so a settle-and-shoot harness samples the move at whatever four instants the
 * software rasteriser happened to produce; pumping it puts the sample where the
 * tool asks for it, on the shipped build, through the real camera.
 *
 * main.js accumulates its finish clock from the loop's own unclamped dt for
 * exactly this reason -- see celClock there. The results card is a real
 * setTimeout and therefore does NOT follow the pump, so it is suppressed below;
 * everything measured here is the frame under the card, which is the frame this
 * pass is about.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },     // iPhone 12/13/14 -- the reference
  { name: '320x568', w: 320, h: 568 },     // the smallest thing that runs it
  { name: '620x1344', w: 620, h: 1344 },   // large portrait
  { name: '1280x800', w: 1280, h: 800 },   // desktop
];

// The move is 0.80s of held astern break, 1.80s of arc, then the hold. Sampled
// every 0.2s to 5.0s, which is past the 4.9s the results card lands at.
const T_END = 5.0;
const T_STEP = 0.2;
// The instants the contact sequence is written at, chosen to name the beats
// rather than to sample evenly: the tape, the break, the arc leaving, the arc
// broadside, the arrival, and two points of the hold.
const FRAMES = [0.15, 0.90, 1.50, 2.05, 2.55, 3.40, 4.60];

const ONLY = arg('only', null);
const JSON_OUT = !!arg('json', false);
const WANT_FRAMES = !!arg('frames', false);
const JOY = arg('joy', null);
const OUT = path.resolve(String(arg('dir', path.join(ROOT, 'shots', 'finish'))));

// ---------------------------------------------------------------------------
// In-page.
// ---------------------------------------------------------------------------
function pageHarness() {
  window.__cb = { pump: null };
  window.requestAnimationFrame = function (cb) { window.__cb.pump = cb; return 1; };
}

function pageSetup(opt) {
  const g = MR.game;
  const F = window.__cb;

  // The card is on a real timer and cannot follow a pumped clock. Suppressed
  // rather than raced: what this tool measures is the frame underneath it.
  g.hud.showEnd = function () { };
  g.hud.hideEnd();
  // Rewind the celebration. See the note on MR.game.celT: ?skip=250 boots
  // straight into the finish, so by the time this harness owns the pump the
  // move has already played out in real time. Not done for the contact sheet,
  // which runs on the page's own clock from before the tape.
  if (opt && opt.rewind) g.celT = 0;

  F.now = performance.now();
  F.step = function (dtSec) {
    F.now += dtSec * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };

  const r = g.runner;
  const P = r.parts;

  // Every mesh of the FIGURE (the ghost and the shadow are excluded by walking
  // down from the figure group, which is how tools/figure.js does it).
  const figure = r.group.children[0];
  const all = [];
  r.group.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    for (let n = o; n; n = n.parent) if (n === figure) { all.push(o); return; }
  });
  // The head's own meshes, and the three feature meshes by pivot.
  const under = function (root) {
    const out = [];
    root.traverse(function (o) {
      if (o.isMesh && o.geometry && o.geometry.attributes.position) out.push(o);
    });
    return out;
  };
  const headMeshes = under(P.head).filter(function (o) {
    // The face pivots hang off the head too; the chin search wants the SKULL
    // mesh only, so those are removed by parent identity rather than by name.
    for (let n = o; n; n = n.parent) {
      if (n === P.eyes || n === P.brows || n === P.mouth) return false;
    }
    return true;
  });
  const featureMeshes = under(P.eyes).concat(under(P.brows)).concat(under(P.mouth));

  // ---- the chin, found rather than typed ---------------------------------
  //
  // The lowest vertex of the skull mesh on the front centre line and FORWARD OF
  // THE NECK COLUMN. That last clause is not padding: the head mesh is one weld
  // that includes the bare neck cylinder, whose bottom rim sits 0.22 below the
  // jaw and passes any |x| test you like. Taking the lowest front-centre vertex
  // without a z floor found the neck, and reported a face 1.8x its real height
  // -- 152 px where the answer is 86. The cylinder's largest radius is 0.122,
  // so z > 0.16 is forward of every vertex it has and inside the jaw mass,
  // which reaches z 0.213.
  //
  // Computed once -- the geometry does not animate, only the pivots do.
  let chin = null;
  for (const o of headMeshes) {
    const pos = o.geometry.attributes.position;
    // The mesh sits under the head pivot, possibly with its own transform.
    o.updateWorldMatrix(true, false);
    const m = new THREE.Matrix4().copy(P.head.matrixWorld).invert()
      .multiply(o.matrixWorld);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (Math.abs(v.x) > 0.06 || v.z < 0.16) continue;
      if (!chin || v.y < chin.y) chin = { x: v.x, y: v.y, z: v.z };
    }
  }
  F.chin = chin;

  F.rect = g.renderer.domElement.getBoundingClientRect();
  F.clipped = 0;
  const v = new THREE.Vector3();
  const project = function (cam, out) {
    v.applyMatrix4(cam.matrixWorldInverse);
    if (-v.z < 0.05) { F.clipped++; return false; }
    v.applyMatrix4(cam.projectionMatrix);
    out.x = (v.x + 1) * 0.5 * F.rect.width;
    out.y = (1 - v.y) * 0.5 * F.rect.height;
    return true;
  };
  const shown = function (o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const PTS = {};
  const points = function (geo) {
    if (PTS[geo.uuid]) return PTS[geo.uuid];
    const p = geo.attributes.position, seen = {}, out = [];
    for (let i = 0; i < p.count; i++) {
      const k = Math.round(p.getX(i) * 1e4) + ',' + Math.round(p.getY(i) * 1e4)
        + ',' + Math.round(p.getZ(i) * 1e4);
      if (seen[k]) continue;
      seen[k] = 1; out.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    PTS[geo.uuid] = out;
    return out;
  };
  const pt = { x: 0, y: 0 };
  const box = function (cam, meshes) {
    let top = Infinity, bot = -Infinity, lo = Infinity, hi = -Infinity;
    for (const o of meshes) {
      if (!shown(o)) continue;
      const ps = points(o.geometry), m = o.matrixWorld;
      for (let j = 0; j < ps.length; j += 3) {
        v.set(ps[j], ps[j + 1], ps[j + 2]).applyMatrix4(m);
        if (!project(cam, pt)) continue;
        if (pt.y < top) top = pt.y;
        if (pt.y > bot) bot = pt.y;
        if (pt.x < lo) lo = pt.x;
        if (pt.x > hi) hi = pt.x;
      }
    }
    return { h: bot - top, w: hi - lo, top: top, bot: bot };
  };

  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  F.sample = function () {
    const cam = g.cam.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    r.group.updateWorldMatrix(true, true);

    // FACE: the brow pivot's origin to the chin, both through the head's own
    // world matrix, so a head turn or a nod is in the number.
    let face = null;
    const pa = { x: 0, y: 0 }, pb = { x: 0, y: 0 };
    P.brows.getWorldPosition(_a);
    v.copy(_a);
    const okA = project(cam, pa);
    _b.set(F.chin.x, F.chin.y, F.chin.z).applyMatrix4(P.head.matrixWorld);
    v.copy(_b);
    const okB = project(cam, pb);
    if (okA && okB) face = Math.abs(pb.y - pa.y);

    // TURN: the head's +z against the direction to the lens.
    const fwd = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(P.head.getWorldQuaternion(new THREE.Quaternion()));
    const toCam = new THREE.Vector3().copy(cam.position).sub(_a).normalize();
    const turn = Math.acos(Math.max(-1, Math.min(1, fwd.dot(toCam)))) * 180 / Math.PI;

    const feat = box(cam, featureMeshes);
    const fig = box(cam, all);

    return {
      face: face, turn: turn,
      featH: feat.h, featW: feat.w,
      figH: fig.h, figTop: fig.top, figBot: fig.bot,
      fov: cam.fov,
      // Draw calls, because the binding constraint in this project is draw
      // calls and a camera that turns round faces a different half of the
      // scene. Nothing here adds geometry; this is the number that says so.
      draws: g.renderer.info.render.calls,
      tris: g.renderer.info.render.triangles,
      camX: +cam.position.x.toFixed(3),
      camY: +cam.position.y.toFixed(3),
      camDZ: +(cam.position.z - r.group.position.z).toFixed(3),
      dist: +cam.position.distanceTo(_a).toFixed(3),
      viewH: F.rect.height, viewW: F.rect.width,
    };
  };

  // The readout panel, in CSS pixels, so the figure can be checked against it
  // the way tools/footroom.js checks the running frame.
  // The opaque bottom panel, which is what tools/footroom.js measures the
  // running figure against. Its top edge is the line a shoe must stay above.
  const el = document.getElementById('railWrap');
  F.panelTop = el ? el.getBoundingClientRect().top : null;

  // One sample on demand, for the real-time contact sheet, which has no pump.
  window.__cbOne = function () {
    const s = F.sample();
    s.celT = g.celT;
    return s;
  };

  return { meshes: all.length, chin: chin, panelTop: F.panelTop };
}

function pageRun(opt) {
  const g = MR.game, F = window.__cb;
  // Settle onto the tape: a handful of small steps so the game notices the
  // finish and starts its own clocks, without advancing the celebration far.
  for (let i = 0; i < 4; i++) F.step(1 / 120);
  const rows = [];
  let t = 0;
  const STEP = 1 / 60;
  let next = 0;
  while (t < opt.end + 1e-6) {
    if (t >= next - 1e-9) {
      const s = F.sample();
      s.t = +t.toFixed(3);
      rows.push(s);
      next += opt.step;
    }
    F.step(STEP);
    t += STEP;
  }
  return { rows: rows, clipped: F.clipped, panelTop: F.panelTop, state: g.state };
}

/**
 * Step the pumped clock FORWARD to an absolute celebration time and sample.
 *
 * Forward, from wherever the page already is, so one page serves the whole
 * contact sheet: the frames are in increasing t, so the sheet costs 4.6
 * seconds of pumped clock in total instead of 4.6 seconds per frame. The first
 * version reopened the page per frame and took four minutes a frame under
 * SwiftShader, which is most of an hour for a sheet of fourteen.
 */
function pageTo(opt) {
  const F = window.__cb;
  const g = MR.game;
  const STEP = 1 / 24;
  let guard = 0;
  while (g.celT < opt.t - 1e-6 && guard++ < 4000) F.step(STEP);
  // Put the tape where the camera is. See the note over the contact sheet.
  const fin = g.world && g.world.finale;
  if (fin && fin.broke >= 0) fin.broke = performance.now() * 0.001 - g.celT;
  F.step(1 / 60);
  const s = F.sample();
  s.t = g.celT;
  s.panelTop = F.panelTop;
  return s;
}

function stat(a) {
  const s = a.slice().sort(function (p, q) { return p - q; });
  return { min: s[0], med: s[s.length >> 1], max: s[s.length - 1] };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const target = arg('file', null);
  const html = target ? path.resolve(String(target)) : path.join(ROOT, 'index.html');
  const joy = JOY === null ? null : parseFloat(String(JOY));
  const out = [];
  let bad = 0;

  async function open(vp, jv) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(e.message.split('\n')[0]); });
    page.on('console', function (m) {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning')
        && !/deprecated with r150|AudioContext was not allowed/.test(t)) errs.push(t);
    });
    // skip=250 is past the tape on a bot=1 run (1:57:55 race time, 236s of wall
    // clock at TIME_SCALE 30), so the page opens with the race already over and
    // the celebration on its first frame.
    await page.goto('file://' + html + '?bot=1&nosave=1&skip=250'
      + (jv === null || jv === undefined ? '' : '&joy=' + jv));
    await page.waitForFunction(function () { return window.MR && MR.game && MR.game.ready; },
      { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.evaluate(pageHarness);
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(function () { return !!(window.__cb && window.__cb.pump); })) break;
      await page.waitForTimeout(50);
    }
    const info = await page.evaluate(pageSetup, { rewind: true });
    return { ctx, page, errs, info };
  }

  for (const vp of VIEWPORTS) {
    if (ONLY && vp.name !== ONLY) continue;
    let s = null;
    try {
      s = await open(vp, joy);
      const res = await page_run(s.page, { end: T_END, step: T_STEP });
      if (s.errs.length) { bad++; console.error('  !! ' + vp.name + ' ' + s.errs[0]); }
      out.push({ vp: vp.name, w: vp.w, h: vp.h, info: s.info, res: res });
    } catch (e) {
      bad++;
      console.error('  !! ' + vp.name + ' ' + String(e.message).split('\n')[0]);
    }
    if (s) await s.ctx.close();
  }

  async function page_run(page, o) { return page.evaluate(pageRun, o); }

  // ---- the contact sequence ----------------------------------------------
  //
  // ON THE PUMP, AND THE FIRST ATTEMPT AT THIS WAS WRONG IN A WAY WORTH
  // RECORDING. Real-time capture looks like the honest option -- open the page
  // before the line, let it cross under its own clock, screenshot at wall
  // offsets -- and it cannot work here: a screenshot of this scene under
  // SwiftShader takes one to three seconds, so by the time the frame asked for
  // at 0.15s is on disk the celebration is already at 3s. Every frame of the
  // first sheet this tool produced was the same settled hero shot with a
  // different name on it, which is precisely the failure mode CLAUDE.md records
  // for tools/stride.js's contact sheets.
  //
  // So the clock is pumped, and the ONE thing that does not follow a pumped
  // clock is fixed up explicitly: world.js runs the tape swing off
  // performance.now() directly, so before each frame `finale.broke` is set to
  // exactly t seconds ago and one more step is pumped. The tape is then at the
  // same instant of its 1.8s break as the camera is of its move. Confetti is
  // integrated on the same real dt and is therefore near-frozen in the sheet --
  // it is present and in the air, but its fall is not to be read off these
  // frames.
  if (WANT_FRAMES) {
    fs.mkdirSync(OUT, { recursive: true });
    const vp = VIEWPORTS.find(function (v) { return !ONLY || v.name === ONLY; });
    for (const jv of (joy === null ? [1, 0] : [joy])) {
      let s = null;
      try {
        s = await open(vp, jv);
        await s.page.evaluate(function () { MR.game.celT = 0; });
        for (const t of FRAMES) {
          const m = await s.page.evaluate(pageTo, { t: t });
          const tag = (jv >= 0.5 ? 'win' : 'spent') + '-'
            + String(t.toFixed(2)).replace('.', 'p');
          await s.page.screenshot({ path: path.join(OUT, tag + '.png') });
          console.log('  ' + tag + '  face ' + m.face.toFixed(1) + 'px  turn '
            + m.turn.toFixed(0) + 'deg  fov ' + m.fov.toFixed(1)
            + '  fig ' + m.figH.toFixed(0) + 'px  footroom '
            + (m.panelTop - m.figBot).toFixed(0) + '  draws ' + m.draws);
        }
        if (s.errs.length) { bad++; console.error('  !! frames ' + s.errs[0]); }
      } catch (e) {
        bad++; console.error('  !! frames ' + String(e.message).split('\n')[0]);
      }
      if (s) await s.ctx.close();
    }
  }

  await browser.close();

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(bad ? 1 : 0); }

  for (const row of out) {
    const rows = row.res.rows;
    console.log('');
    console.log('CELEBRATE -- ' + row.vp + (joy === null ? '' : '  joy=' + joy)
      + '   (chin found at head-local y ' + row.info.chin.y.toFixed(3)
      + ', z ' + row.info.chin.z.toFixed(3) + ')');
    console.log('');
    console.log('    t     fov    cam x/y/dz          dist   FACE px   frac    turn   features   figure  footroom   draws');
    for (const r of rows) {
      console.log('  ' + r.t.toFixed(2).padStart(5)
        + r.fov.toFixed(1).padStart(8)
        + ('  ' + r.camX.toFixed(2) + '/' + r.camY.toFixed(2) + '/' + r.camDZ.toFixed(2)).padEnd(21)
        + r.dist.toFixed(2).padStart(6)
        + (r.face === null ? '     --' : r.face.toFixed(1).padStart(9))
        + (r.face === null ? '      --' : ('  ' + (r.face / r.viewH).toFixed(4)).padStart(9))
        + r.turn.toFixed(0).padStart(7)
        + ('  ' + r.featW.toFixed(0) + 'x' + r.featH.toFixed(0)).padEnd(12)
        + r.figH.toFixed(0).padStart(6)
        + (row.res.panelTop === null ? '' : (row.res.panelTop - r.figBot).toFixed(0).padStart(8))
        + r.draws.toFixed(0).padStart(8));
    }
    const held = rows.filter(function (r) { return r.t >= 2.4 && r.face !== null; });
    if (held.length) {
      const f = stat(held.map(function (r) { return r.face; }));
      console.log('');
      console.log('  held shot (t >= 2.40): face ' + f.min.toFixed(1) + ' / ' + f.med.toFixed(1)
        + ' / ' + f.max.toFixed(1) + ' px    ' + (f.med / row.h * 100).toFixed(1) + '% of frame height');
    }
    const readable = rows.filter(function (r) {
      return r.face !== null && r.turn < 75 && r.face >= 0.06 * r.viewH;
    });
    if (readable.length) {
      console.log('  face at 6% of frame height or better, turned toward the lens: '
        + (readable.length * T_STEP).toFixed(1) + 's, from t='
        + readable[0].t.toFixed(2) + ' to t=' + readable[readable.length - 1].t.toFixed(2));
    } else {
      console.log('  THE FACE IS NEVER READABLE.');
    }
  }
  console.log('');
  process.exit(bad ? 1 : 0);
})();
