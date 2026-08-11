#!/usr/bin/env node
/**
 * FOOTROOM -- does the runner fit above the readout?
 *
 * A player on an iPhone said "feet slightly caught off at the bottom". Half of
 * that was the artifact shell using 100vh where Safari wanted 100dvh. The other
 * half was real: `#railWrap` is an OPAQUE panel pinned to the bottom of the
 * frame, and at slow pace the runner's shoes were drawn 41px inside it.
 *
 * Nothing in the toolchain could have said so. `shoot.js` audits what the
 * player can SEE OF THE WORLD -- occlusion, contrast, overlays -- and the HUD
 * is not in the world. `stride.js` measures the rig in WORLD units and never
 * projects it. So the one question that spans both ("is the figure inside the
 * screen-space furniture") had no owner. This file is that owner.
 *
 *   node tools/footroom.js                  full sweep, all combinations
 *   node tools/footroom.js --file x.html    against an alternate build
 *   node tools/footroom.js --margin 14      change the pass threshold
 *   node tools/footroom.js --json           machine-readable
 *   node tools/footroom.js --only 390x844   one viewport
 *
 * Exit code is non-zero if any combination fails, or if the page threw.
 *
 * ---- WHY A SWEEP, AND NOT A SAMPLE --------------------------------------
 *
 * The defect was nearly missed because a single-instant probe of this exact
 * frame reported the feet 77px CLEAR when the true figure was 41px INSIDE.
 * Three things move the lowest point of the figure and none of them is
 * observable in one frame:
 *
 *   STRIDE PHASE   the trailing shoe reaches its lowest at one instant in a
 *                  ~0.35s cycle and is 0.25 world units up for most of it.
 *   CAMERA BOB     camera.js runs its own stride clock at a cadence divisor of
 *                  22 against the runner's SPEED_LO of 21.818 -- a 0.6%
 *                  difference, so the two beat against each other with a period
 *                  of about a minute. Sweeping one stride at the game's own
 *                  frame rate visits ONE relative alignment of the two. This
 *                  file deliberately walks the camera's phase by 1/12 at every
 *                  runner-stride wrap, so 12 windows cover the whole grid in
 *                  four seconds instead of one minute.
 *   STATE          jump, slide and the winded tail after a contact all move
 *                  the figure in frame, and two of them move the CAMERA as
 *                  well (SLIDE_UP, the landing dip spring, `winded` narrowing
 *                  the lens by up to five degrees).
 *
 * ---- WHAT IS MEASURED ----------------------------------------------------
 *
 * The lowest SCREEN ROW of the figure, in CSS pixels, against
 * `#railWrap.getBoundingClientRect().top`, both read from the live page.
 *
 * Not the lowest world y. The camera pitches and rolls, so the lowest point in
 * world space is not the lowest point on screen, and the difference is tens of
 * pixels at a 7-degree bank.
 *
 * The bound is computed from each mesh's own oriented bounding box -- eight
 * corners through the real lens. A perspective divide is a projective map, and
 * a projective map takes the convex hull of the corners onto a set containing
 * the projected box, so this can never UNDER-report the overlap. When a sample
 * gets within reach of the worst seen so far, the tool falls back to every
 * de-duplicated vertex of the offending meshes and reports the exact row. Both
 * numbers are printed; the gate is on the exact one and the conservative one is
 * the reason the exact one can be trusted to be the minimum.
 *
 * Three figures per combination:
 *
 *   SHOE   both ankle subtrees. This is what the report was about and it is
 *          what the brief's own numbers were measured on, so it is comparable.
 *   BODY   every mesh of the figure. Usually the shoe; during a slide it is
 *          not, which is the reason to measure it separately.
 *   MARK   the contact shadow and the landing reticle -- flat decals painted
 *          on the road at the runner's feet, not part of the figure. Reported,
 *          never gated: a shadow disappearing under an opaque panel reads as
 *          the panel being in front of the road, which it is.
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

// The pass threshold, in CSS pixels of clearance between the lowest row of the
// figure and the top of the panel.
//
// 12 is not a round number chosen for comfort. `#railWrap` carries a 2px hairline
// border and a 6px blur behind it (`backdrop-filter`), so the first ~8 rows above
// the stated top edge are already visually claimed by the panel; a shoe landing
// there reads as touching it even though no pixel is covered. 12 puts the sole
// clear of the border, clear of the blur, and leaves 4px for the sub-pixel
// rounding that separates a CSS rect from a rasterised triangle edge.
const MARGIN = parseFloat(arg('margin', 12));

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },     // iPhone 12/13/14, the report
  { name: '620x1344', w: 620, h: 1344 },   // shoot.js 07/08
  { name: '920x1363', w: 920, h: 1363 },   // large portrait
  { name: '844x390', w: 844, h: 390 },     // landscape phone
  { name: '320x568', w: 320, h: 568 },     // the smallest thing that runs it
  { name: '1280x800', w: 1280, h: 800 },   // desktop, shoot.js default
];

// Pace is set by `?skip=`, which is wall-clock seconds of simulation.
// TIME_SCALE is 30, so skip=8 is race-second 240 -- about mile 0.8, and the
// player's report came from mile 1.39. `start` is the true floor of the pace
// band and therefore the narrowest lens the game ever uses.
const PACES = [
  { name: 'start', skip: 1 },
  { name: 'slow', skip: 8 },
  { name: 'mid', skip: 90 },
  { name: 'fast', skip: 178 },
];

const STATES = ['run', 'jump', 'slide', 'hit'];

const ONLY = arg('only', null);
const JSON_OUT = !!arg('json', false);
const FILE = arg('file', null);
// `--quick` drops the camera-phase axis from twelve offsets to three. It is for
// the inside of a fix loop, where the question is "did that move it and which
// way"; it is NOT a pass. The full sweep is what the gate is read from, and
// the report prints which one it ran.
const QUICK = !!arg('quick', false);
const VERBOSE = !!arg('verbose', false);
const WINDOWS = parseInt(arg('windows', QUICK ? 3 : 12), 10);

// ---------------------------------------------------------------------------
// Everything below runs in the page. It drives the REAL game loop -- main.js's
// own frame() -- through a hand-pumped clock, so every filter, spring and
// one-shot in camera.js is the one that ships.
// ---------------------------------------------------------------------------
function pageHarness() {
  const g = MR.game;

  // Hand-pump the loop. main.js resolves `requestAnimationFrame` off window on
  // every call, so replacing it captures the next frame callback.
  window.__fr = { pump: null, now: performance.now(), errs: [] };
  window.requestAnimationFrame = function (cb) { window.__fr.pump = cb; return 1; };
}

function pageSetup() {
  const g = MR.game;
  const F = window.__fr;

  // Stepping does not need pixels. Stubbing the draw makes a 4-second sweep
  // cost milliseconds instead of minutes under swiftshader, and changes
  // nothing about the transforms -- but it does mean the scene graph is no
  // longer updated for us, so every sample updates the runner and the camera
  // explicitly.
  F.realRender = g.renderer.render.bind(g.renderer);
  g.renderer.render = function () { F.drawn = (F.drawn || 0) + 1; };

  // Take the controls away from the autopilot. Every action in this sweep is
  // fired deliberately, so `run` really is running and `jump` really is a jump.
  g.player.handle = function () { };
  // ...and stop gates resolving, so a contact can only happen where this file
  // asks for one. Without this the runner ploughs through every gate it meets
  // and the `run` rows quietly become `hit` rows.
  g.player.resolveGates = function () { return []; };
  g.player.resolveAid = function () { return []; };

  F.now = performance.now();
  F.step = function (dtSec) {
    F.now += dtSec * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };

  // ---- the figure, split three ways ------------------------------------
  const r = g.runner;
  const ankles = r.parts.legs.map(function (L) { return L.ankle; });
  const shoe = [], body = [], mark = [];
  const inAnkle = function (o) {
    for (let n = o; n; n = n.parent) if (ankles.indexOf(n) >= 0) return true;
    return false;
  };
  // r.group.children[0] is the figure; the rest are the ground decals (contact
  // shadow, landing reticle, dust) and lie flat on the road.
  const figure = r.group.children[0];
  const inFigure = function (o) {
    for (let n = o; n; n = n.parent) if (n === figure) return true;
    return false;
  };
  r.group.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    (inAnkle(o) ? shoe : inFigure(o) ? body : mark).push(o);
  });

  // De-duplicated local vertices, one array per geometry, built lazily and
  // shared between the meshes that use it. A shoe is 6780 positions and 1142
  // distinct points; the duplicates are normal splits and cost nothing to see.
  const PTS = {};
  const points = function (geo) {
    if (PTS[geo.uuid]) return PTS[geo.uuid];
    const p = geo.attributes.position, seen = {}, out = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      if (seen[k]) continue;
      seen[k] = 1; out.push(x, y, z);
    }
    PTS[geo.uuid] = out;
    return out;
  };

  const v = new THREE.Vector3();
  F.rect = g.renderer.domElement.getBoundingClientRect();
  // Counted PER GROUP, and that is the whole point -- see the guard below.
  F.clip = { shoe: 0, body: 0, mark: 0 };
  F.curKey = 'mark';

  // Screen row of a world point, in CSS pixels. Returns null behind the lens.
  //
  // DROP the sample, never poison the result. A point behind the camera has a
  // negative w, so the perspective divide flips its sign and it reports the top
  // of the frame as the bottom -- shoot.js's band() hit exactly this and
  // confidently claimed six hidden hazards on a frame that had none. The first
  // draft of this file did the opposite and let one bad vertex return Infinity
  // for a whole group, which read as "no data" on twelve rows.
  //
  // For the figure this is dead code: the runner is BASE_BACK = 4.35 units from
  // a lens whose near plane is 0.1, so nothing on him is ever close to it. The
  // count is reported anyway, because a silent guard is how the last one hid.
  //
  // ---- AND IT IS COUNTED PER GROUP, BECAUSE ONE OF THEM IS NOT GATED -------
  //
  // This counter used to be a single number and any non-zero value failed the
  // build. That contradicted the header two ways at once. MARK is documented
  // there as "reported, never gated" -- it is the contact shadow, the landing
  // reticle and the dust, decals lying on the road at the runner's feet -- and
  // a decal at the runner's feet PASSES UNDER THE CAMERA every few seconds,
  // which is not a defect in anything. Measured on the shipped build: all 24 of
  // the clipped-vertex failures were in MARK, and not one was in SHOE or BODY.
  //
  // So the build failed for a shadow going under the lens, on a gate whose
  // subject is the runner's feet, at exactly one pace -- which makes it read
  // like a finding about that pace. An instrument inventing a defect is worse
  // than one missing a defect, because someone will go and look for it.
  //
  // The guard is kept where it protects the answer. A dropped SHOE or BODY
  // vertex means the lowest row of the FIGURE was computed without a point that
  // might have been the lowest, so the gate would be UNDER-reporting -- the one
  // failure mode this file exists to prevent. That still fails, loudly.
  const rowOf = function (cam, rect) {
    v.applyMatrix4(cam.matrixWorldInverse);
    if (-v.z < 0.5) { F.clip[F.curKey]++; return null; }
    v.applyMatrix4(cam.projectionMatrix);
    return rect.top + (1 - v.y) * 0.5 * rect.height;
  };

  // Conservative lowest row of one mesh: its own oriented bounding box through
  // the real lens. Cannot under-report -- see the file header.
  const meshBound = function (o, cam, rect) {
    const bb = o.geometry.boundingBox;
    let lo = -Infinity;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z);
      v.applyMatrix4(o.matrixWorld);
      const y = rowOf(cam, rect);
      if (y !== null && y > lo) lo = y;
    }
    return lo;
  };

  // Exact lowest row of one mesh, every distinct vertex.
  const meshExact = function (o, cam, rect) {
    const pts = points(o.geometry), m = o.matrixWorld;
    let lo = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m);
      const y = rowOf(cam, rect);
      if (y !== null && y > lo) lo = y;
    }
    return lo;
  };

  F.groups = { shoe: shoe, body: body, mark: mark };
  F.counts = { shoe: shoe.length, body: body.length, mark: mark.length };

  F.shown = function (o) {
    for (let n = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };

  /**
   * One sample. Returns, per group, the conservative bound; and refines to the
   * exact row whenever the bound says this sample could beat the worst so far.
   * `best` is carried by the caller so the refinement only ever runs on the
   * handful of samples that matter.
   */
  F.sample = function (best) {
    const cam = g.cam.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    r.group.updateWorldMatrix(true, true);
    const rect = F.rect;
    const out = {};
    for (const key in F.groups) {
      const list = F.groups[key];
      F.curKey = key;
      let bound = -Infinity, exact = -Infinity;
      const hot = [];
      for (let i = 0; i < list.length; i++) {
        // ANCESTORS TOO. `mesh.visible` is not whether the mesh is drawn --
        // three.js culls a whole subtree when a parent's flag is false, and this
        // rig switches `fxPivot`, `streaks` and `reticle` off at the group. A
        // mesh under a hidden group still reports visible === true, so testing
        // the mesh alone measures geometry that is nowhere on screen.
        if (!F.shown(list[i])) continue;
        const b = meshBound(list[i], cam, rect);
        if (b > bound) bound = b;
        if (b >= (best[key] === undefined ? -Infinity : best[key])) hot.push(list[i]);
      }
      for (let i = 0; i < hot.length; i++) {
        const e = meshExact(hot[i], cam, rect);
        if (e > exact) exact = e;
      }
      out[key] = { bound: bound, exact: hot.length ? exact : -Infinity };
    }
    return out;
  };

  F.railTop = function () {
    const el = document.getElementById('railWrap');
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    return el.getBoundingClientRect().top;
  };

  F.cadence = function () {
    const SPEED_LO = (MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.START_PACE;
    return 2.55 * Math.pow(g.pace.speed() / SPEED_LO, 0.72);
  };

  return { counts: F.counts, rect: { top: F.rect.top, height: F.rect.height } };
}

/**
 * Run one state's sweep and return the worst clearance seen.
 *
 * `run`   twelve stride windows, 48 samples each, with the camera's own stride
 *         clock walked 1/12 at every wrap so the beat between the two cadences
 *         is covered in 4 seconds rather than 60.
 * `jump`  the same twelve windows, each firing a jump at a different point in
 *         the stride and flying it to the landing and past the dip spring.
 * `slide` likewise, through DUCK_TIME and the slow duck01 decay after it.
 * `hit`   likewise, through the full `winded` tail -- which NARROWS the lens by
 *         five degrees and therefore magnifies the figure.
 */
function pageSweep(opt) {
  const g = MR.game, F = window.__fr;
  const rail = F.railTop();
  if (rail === null) return { error: 'railWrap not visible' };

  const N = 48;                    // samples per stride window
  const WINDOWS = opt.windows || 12;   // camera-phase offsets
  F.clip = { shoe: 0, body: 0, mark: 0 };
  const best = { shoe: -Infinity, body: -Infinity, mark: -Infinity };
  const at = {};
  let fovLo = Infinity, fovHi = -Infinity, speedLo = Infinity, speedHi = -Infinity;
  let samples = 0;

  const record = function (tag) {
    const s = F.sample(best);
    samples++;
    for (const k in s) {
      const e = s[k].exact;
      if (isFinite(e) && e > best[k]) { best[k] = e; at[k] = tag; }
    }
    const fv = g.cam.camera.fov;
    if (fv < fovLo) fovLo = fv; if (fv > fovHi) fovHi = fv;
    const sp = g.pace.speed();
    if (sp < speedLo) speedLo = sp; if (sp > speedHi) speedHi = sp;
  };

  // Settle the hand-pumped clock before anything is believed: the first few
  // steps carry whatever dt the handover from the real scheduler produced.
  for (let i = 0; i < 20; i++) F.step(1 / 120);
  // And prove it is turning. A frozen pump returns finite, plausible, IDENTICAL
  // numbers for every state -- the failure this file already shipped once.
  const z0 = g.pace.units;

  for (let w = 0; w < WINDOWS; w++) {
    const period = 1 / F.cadence();
    const dt = period / N;
    // Walk the camera's own stride clock. The two cadences differ by 0.6%, so
    // without this a sweep only ever visits one alignment of bob to footfall.
    g.cam.stride = (g.cam.stride + 1 / WINDOWS) % 1;

    if (opt.state === 'run') {
      for (let i = 0; i < N; i++) { F.step(dt); record('w' + w + '.' + i); }
    } else {
      // Enter the state at this window's point in the stride, then fly it out.
      const off = Math.round(N * w / WINDOWS);
      for (let i = 0; i < off; i++) { F.step(dt); record('pre' + w + '.' + i); }
      if (opt.state === 'jump') {
        g.player.airborne = true; g.player.airT = 0;
        g.player.ducking = false; g.player.duckT = 0;
        g.player.events.push('jump');
      } else if (opt.state === 'slide') {
        g.player.ducking = true; g.player.duckT = 0;
        g.player.events.push('duck');
      } else if (opt.state === 'hit') {
        g.cam.impact(1);
        g.player.stumble = 1;
      }
      const dur = opt.state === 'jump' ? MR.K.JUMP_TIME + 0.8
        : opt.state === 'slide' ? MR.K.DUCK_TIME + 1.2
          : 2.8;                                  // the whole winded tail
      const steps = Math.ceil(dur / dt);
      for (let i = 0; i < steps; i++) { F.step(dt); record('w' + w + '.' + i); }
      // Let the state clear before the next window opens.
      for (let i = 0; i < N; i++) F.step(dt);
    }
  }

  if (!(g.pace.units - z0 > 1)) {
    return { error: 'the clock did not advance -- ' + (g.pace.units - z0).toFixed(4) + ' units over the whole sweep' };
  }

  return {
    rail: rail,
    shoe: best.shoe, body: best.body, mark: best.mark,
    atShoe: at.shoe, atBody: at.body,
    fov: [fovLo, fovHi], speed: [speedLo, speedHi],
    samples: samples,
    clip: F.clip,
    viewH: F.rect.height,
  };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const html = FILE ? path.resolve(String(FILE)) : path.join(ROOT, 'index.html');
  const rows = [];
  let failed = false;
  const problems = [];
  // Reported and never gated, the way MARK itself is. Kept separate from
  // `problems` so that a thing which cannot fail the build cannot fail it.
  const notes = [];

  for (const vp of VIEWPORTS) {
    if (ONLY && vp.name !== ONLY) continue;
    for (const pc of PACES) {
     // A FRESH PAGE PER STATE, and it is not fastidiousness.
     //
     // Each sweep advances the real simulation by ten to fifteen seconds of
     // wall time. Four of them in a row from `?skip=178` walk the runner over
     // the finish line, `state` leaves RUN, `pace.update` stops being called,
     // and the fourth sweep silently measures a frozen frame -- which is how
     // the `fast hit` row came back as 0.0000 units of travel. Reloading also
     // stops a landing dip or a winded tail leaking from one state's sweep
     // into the next one's first window.
     for (const st of STATES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      const BENIGN = /deprecated with r150|AudioContext was not allowed/;
      const errs = [];
      page.on('console', (m) => {
        const t = m.text();
        if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(t)) errs.push(m.type() + ': ' + t);
      });
      page.on('pageerror', (e) => { errs.push('pageerror: ' + e.message); failed = true; });

      await page.goto('file://' + html + '?bot=1&skip=' + pc.skip + '&debug=1', { waitUntil: 'load' });
      await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 20000 });
      await page.waitForTimeout(900);

      await page.evaluate(pageHarness);
      // WAIT FOR THE HANDOVER, do not sleep on it.
      //
      // Under swiftshader this page runs at 2-7 fps, so one frame is 140-500ms.
      // A fixed 80ms wait -- which looks generous next to 16ms -- expires before
      // the in-flight rAF has fired even once, `pump` is still null, and every
      // step after it is a no-op. The sweep then returns the SAME frame for
      // every state, which is exactly what it did: four different states, one
      // byte-identical row.
      // POLL ON A TIMER, NOT ON A FRAME.
      //
      // `page.waitForFunction` polls via requestAnimationFrame by default, in
      // the main world -- the same requestAnimationFrame this harness has just
      // replaced. So the poller's own callback goes into `pump`, is never
      // called again, and the wait deadlocks until it times out. It looks
      // exactly like "the game stopped rendering" and it is not.
      //
      // (Two smaller traps in the same call: waitForFunction(fn, arg, options)
      // takes options THIRD, so passing {timeout} second silently restores the
      // 30s default; and returning the captured callback hands Playwright an
      // unserialisable function, which is never truthy however long you wait.)
      let handed = false;
      for (let i = 0; i < 60 && !handed; i++) {
        handed = await page.evaluate(() => !!(window.__fr && window.__fr.pump));
        if (!handed) await page.waitForTimeout(100);
      }
      if (!handed) { problems.push(`${vp.name} ${pc.name}: the game loop never handed over a frame`); failed = true; await ctx.close(); continue; }
      await page.evaluate(pageSetup);

      const res = await page.evaluate(pageSweep, { state: st, windows: WINDOWS });
      if (res.error || !isFinite(res.shoe) || !isFinite(res.body)) {
        problems.push(`${vp.name} ${pc.name} ${st}: ${res.error || 'no finite sample'}`);
        failed = true;
      } else {
        // SHOE or BODY behind the near plane means the figure's lowest row was
        // computed with a point missing, so the gate under-reports. That fails.
        // MARK is the ground decals and is never gated -- see rowOf().
        const figClip = res.clip.shoe + res.clip.body;
        if (figClip) {
          problems.push(`${vp.name} ${pc.name} ${st}: ${figClip} FIGURE vertices behind the near plane -- this row under-reports`);
          failed = true;
        }
        if (res.clip.mark) notes.push(`${vp.name} ${pc.name} ${st}: ${res.clip.mark} mark vertices under the lens (decals, not gated)`);
        const clear = res.rail - res.shoe;
        const clearBody = res.rail - res.body;
        rows.push({
          vp: vp.name, pace: pc.name, state: st,
          rail: +res.rail.toFixed(0), shoe: +res.shoe.toFixed(0), body: +res.body.toFixed(0),
          mark: +res.mark.toFixed(0),
          clear: +clear.toFixed(1), clearBody: +clearBody.toFixed(1),
          clearMark: +(res.rail - res.mark).toFixed(1),
          fov: +res.fov[0].toFixed(1) + '-' + res.fov[1].toFixed(1),
          speed: +res.speed[0].toFixed(1),
          samples: res.samples,
        });
        if (Math.min(clear, clearBody) < MARGIN) failed = true;
      }
      if (errs.length) { problems.push(`${vp.name} ${pc.name} ${st}: ` + errs.slice(0, 2).join(' | ')); failed = true; }
      await ctx.close();
     }
    }
  }

  await browser.close();

  if (JSON_OUT) {
    console.log(JSON.stringify({ margin: MARGIN, rows, problems, notes, ok: !failed }, null, 1));
    process.exit(failed ? 1 : 0);
  }

  console.log('');
  console.log('FOOTROOM -- lowest row of the figure vs the top of #railWrap, CSS px');
  console.log('positive = clear of the panel, negative = drawn inside it');
  console.log(`pass threshold ${MARGIN}px  (2px border + 6px backdrop blur + 4px raster slack)`);
  console.log(`${WINDOWS} camera-phase windows x 48 stride phases` + (QUICK ? '   -- QUICK, not a pass' : ''));
  console.log('');
  console.log('  viewport     pace   state   fov          rail   shoe   body    SHOE    BODY   mark');
  console.log('  ' + '-'.repeat(88));
  let lastVp = null;
  for (const r of rows) {
    if (lastVp && lastVp !== r.vp) console.log('');
    lastVp = r.vp;
    const bad = Math.min(r.clear, r.clearBody) < MARGIN;
    console.log(
      '  ' + r.vp.padEnd(12) + r.pace.padEnd(7) + r.state.padEnd(8) + r.fov.padEnd(13) +
      String(r.rail).padStart(4) + String(r.shoe).padStart(7) + String(r.body).padStart(7) +
      fmt(r.clear).padStart(8) + fmt(r.clearBody).padStart(8) + fmt(r.clearMark).padStart(7) +
      (bad ? '   FAIL' : '')
    );
  }
  console.log('');
  const worst = rows.reduce((a, b) => (Math.min(b.clear, b.clearBody) < Math.min(a.clear, a.clearBody) ? b : a), rows[0]);
  if (worst) {
    console.log(`  worst: ${worst.vp} ${worst.pace} ${worst.state}  shoe ${fmt(worst.clear)}  body ${fmt(worst.clearBody)}`);
  }
  console.log(`  ${rows.length} combinations, ${rows.reduce((a, b) => a + b.samples, 0)} samples`);
  for (const p of problems) console.log('  ! ' + p);
  if (notes.length) console.log(`  (${notes.length} mark-under-lens notes, not gated; --verbose to list)`);
  if (VERBOSE) for (const nte of notes) console.log('  - ' + nte);
  console.log('  ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);

  function fmt(x) { return (x >= 0 ? '+' : '') + x.toFixed(1); }
})();
