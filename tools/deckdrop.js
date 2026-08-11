#!/usr/bin/env node
/**
 * DECKDROP -- does the runner stay in frame when the ground leaves his feet?
 *
 * ---- WHY THIS IS NOT ALREADY tools/footroom.js ---------------------------
 *
 * footroom.js asks exactly the right question -- is the figure inside the
 * screen-space furniture -- and sweeps stride phase, camera phase and four
 * player states to answer it. What it cannot sweep is WHERE ON THE COURSE the
 * question is asked, because pace is set by ?skip=, and ?skip= is a wall-clock
 * seconds value that lands wherever the course happens to put the runner.
 *
 * That turned out to matter, and it cost a bisect to find out.
 *
 * The chase camera's deck term (s.dk in camera.js) was left hanging up to 1.28
 * units above a runner who had already landed off a lorry roof, and because dk
 * is added to the eye AND the aim it cannot move the pitch -- so the whole lag
 * was spent pushing the figure down the frame. At 390x844 that put the lowest
 * row of his shoe 104 px INSIDE the opaque readout, off the bottom of the
 * picture. Measured on the shipped build, forced at every pace: -93.8 at the
 * start line, -111.0 slow, -78.0 mid, -34.5 fast.
 *
 * footroom passed all four of those rows for months. It passed them at
 * 1042b5d, where the same forced dismount measures -117.6 / -128.2 / -111.3 /
 * -73.4 -- WORSE than the build that was eventually reported as broken. The
 * defect only became visible when an opening-density change (7b0a1d2) moved a
 * rideable lorry into the stretch of road that ?skip=90 lands on, at which
 * point twenty-one combinations failed at once and read like a pace defect.
 *
 * So the instrument was not wrong; it was aimed. A tool whose subject is the
 * runner's feet must not depend on the course generator putting a lorry under
 * them, and this file removes that dependence: it MOUNTS a deck, holds it
 * until the camera's filter has settled, then steps off the front and watches
 * the whole fall. It cannot miss the event, because it causes it.
 *
 *   node tools/deckdrop.js               all viewports, all paces
 *   node tools/deckdrop.js --file x.html against an alternate build
 *   node tools/deckdrop.js --deck 2.8    deck height in world units
 *   node tools/deckdrop.js --margin 12   change the pass threshold
 *   node tools/deckdrop.js --json        machine-readable
 *
 * ---- WHAT IS MEASURED, AND THE ONE THING IT DELIBERATELY FAKES -----------
 *
 * The lowest screen row of BOTH ANKLE SUBTREES against #railWrap's top, in CSS
 * pixels -- the same figure, the same rail and the same projection footroom
 * gates on, so the two numbers are directly comparable.
 *
 * The deck is imposed rather than driven into: player.resolveDeck is stubbed
 * and player.surface is written directly, so the event happens at a place of
 * this file's choosing instead of wherever the course put a lorry. That is the
 * whole point, and it has one consequence worth stating plainly -- THE WORLD
 * DOES NOT KNOW. There is no lorry mesh under him, so these frames are not
 * photographs of anything and this file never takes one. It reads geometry.
 * For a picture of the real event, ?skip= onto a real dismount instead.
 *
 * The fall itself is the shipped one: setting fallFrom and falling hands the
 * descent to player.js's own update(), which eases the surface down as
 * fallFrom * (1 - t*t) over FALL_TIME.
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}

// The same threshold footroom gates on, and for the same reasons: 2px of
// hairline border, 6px of backdrop blur, 4px of raster slack.
const MARGIN = parseFloat(arg('margin', 12));
// 2.80 is the roof height the camera's own notes are written against.
const DECK = parseFloat(arg('deck', 2.8));
const JSON_OUT = !!arg('json', false);
const FILE = arg('file', null);
const ONLY = arg('only', null);

const VIEWPORTS = [
  { name: '390x844', w: 390, h: 844 },
  { name: '620x1344', w: 620, h: 1344 },
  { name: '920x1363', w: 920, h: 1363 },
  { name: '844x390', w: 844, h: 390 },
  { name: '320x568', w: 320, h: 568 },
  { name: '1280x800', w: 1280, h: 800 },
];

// Same four pace samples footroom uses, so a row here can be read next to a
// row there without converting anything.
const PACES = [
  { name: 'start', skip: 1 },
  { name: 'slow', skip: 8 },
  { name: 'mid', skip: 90 },
  { name: 'fast', skip: 178 },
];

function pageHarness() {
  window.__dd = { pump: null };
  window.requestAnimationFrame = function (cb) { window.__dd.pump = cb; return 1; };
}

function pageRun(opt) {
  const g = MR.game, F = window.__dd;

  // Stepping does not need pixels; see footroom.js for why this is safe and
  // what it costs (the scene graph stops being updated for us, so every sample
  // updates the camera and the runner explicitly below).
  g.renderer.render = function () { };
  // Take the controls, the gates and the course's own decks away. Every event
  // in this run is fired deliberately.
  g.player.handle = function () { };
  g.player.resolveGates = function () { return []; };
  g.player.resolveAid = function () { return []; };
  g.player.resolveDeck = function () { return null; };

  F.now = performance.now();
  F.step = function (dtSec) {
    F.now += dtSec * 1000;
    const cb = F.pump; F.pump = null;
    if (cb) cb(F.now);
  };

  const r = g.runner;
  const ankles = r.parts.legs.map(function (L) { return L.ankle; });
  const inAnkle = function (o) {
    for (let n = o; n; n = n.parent) if (ankles.indexOf(n) >= 0) return true;
    return false;
  };
  const shoe = [];
  r.group.traverse(function (o) {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    if (!inAnkle(o)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    shoe.push(o);
  });
  if (!shoe.length) return { error: 'no ankle meshes found' };

  const v = new THREE.Vector3();
  const rect = g.renderer.domElement.getBoundingClientRect();
  const railEl = document.getElementById('railWrap');
  if (!railEl) return { error: 'railWrap not present' };
  const rail = railEl.getBoundingClientRect().top;
  let clipped = 0;

  // The oriented bounding box through the real lens. A perspective divide is a
  // projective map and takes the convex hull of the corners onto a set
  // containing the projected box, so this can never UNDER-report the overlap --
  // which is the direction that matters for a gate. See footroom.js.
  const lowestRow = function () {
    const cam = g.cam.camera;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    r.group.updateWorldMatrix(true, true);
    let lo = -Infinity;
    for (let i = 0; i < shoe.length; i++) {
      const o = shoe[i];
      let shown = true;
      for (let n = o; n; n = n.parent) if (!n.visible) shown = false;
      if (!shown) continue;
      const bb = o.geometry.boundingBox;
      for (let c = 0; c < 8; c++) {
        v.set(c & 1 ? bb.max.x : bb.min.x, c & 2 ? bb.max.y : bb.min.y, c & 4 ? bb.max.z : bb.min.z);
        v.applyMatrix4(o.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        // Behind the lens: DROP the sample rather than let a flipped w report
        // the top of the frame as the bottom. Counted, because a silent guard
        // is how the last one hid.
        if (-v.z < 0.5) { clipped++; continue; }
        v.applyMatrix4(cam.projectionMatrix);
        const y = rect.top + (1 - v.y) * 0.5 * rect.height;
        if (y > lo) lo = y;
      }
    }
    return lo;
  };

  // Settle the hand-pumped clock before anything is believed.
  for (let i = 0; i < 20; i++) F.step(1 / 120);
  const z0 = g.pace.units;

  const dt = 1 / 60;
  // Ride the roof until the camera's filter has caught up to it, so the fall
  // starts from a settled shot rather than from the middle of a mount.
  for (let i = 0; i < 150; i++) { g.player.surface = opt.deck; F.step(dt); }
  const settled = rail - lowestRow();
  const lagOnRoof = g.cam.dk - g.player.surface;

  // ...and step off the front. player.js's own update() takes the fall from
  // here; nothing below writes surface again.
  g.player.fallFrom = opt.deck;
  g.player.falling = 1e-6;

  let worst = Infinity, worstAt = 0, worstLag = 0, maxLag = 0;
  // Well past FALL_TIME, so the recovery after touchdown is swept too.
  for (let i = 0; i < 210; i++) {
    F.step(dt);
    const lag = g.cam.dk - (g.player.surface || 0);
    if (lag > maxLag) maxLag = lag;
    const clear = rail - lowestRow();
    if (clear < worst) { worst = clear; worstAt = i * dt; worstLag = lag; }
  }

  if (!(g.pace.units - z0 > 1)) {
    return { error: 'the clock did not advance -- ' + (g.pace.units - z0).toFixed(4) + ' units' };
  }
  if (g.player.falling !== 0 || g.player.surface !== 0) {
    return { error: 'the runner never landed -- surface ' + g.player.surface };
  }

  return {
    settled: settled, worst: worst, worstAt: worstAt, worstLag: worstLag,
    maxLag: maxLag, lagOnRoof: lagOnRoof, clipped: clipped,
    fov: g.cam.camera.fov,
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
  const problems = [];
  let failed = false;

  for (const vp of VIEWPORTS) {
    if (ONLY && vp.name !== ONLY) continue;
    for (const pc of PACES) {
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

      // Wait for the handover on a TIMER, not on a frame: waitForFunction polls
      // through the requestAnimationFrame this harness has just replaced, so a
      // frame-based wait deadlocks on its own callback. See footroom.js.
      let handed = false;
      for (let i = 0; i < 60 && !handed; i++) {
        handed = await page.evaluate(() => !!(window.__dd && window.__dd.pump));
        if (!handed) await page.waitForTimeout(100);
      }
      if (!handed) {
        problems.push(vp.name + ' ' + pc.name + ': the game loop never handed over a frame');
        failed = true; await ctx.close(); continue;
      }

      const res = await page.evaluate(pageRun, { deck: DECK });
      if (res.error || !isFinite(res.worst)) {
        problems.push(vp.name + ' ' + pc.name + ': ' + (res.error || 'no finite sample'));
        failed = true;
      } else {
        if (res.clipped) {
          problems.push(vp.name + ' ' + pc.name + ': ' + res.clipped
            + ' shoe vertices behind the near plane -- this row under-reports');
          failed = true;
        }
        rows.push({
          vp: vp.name, pace: pc.name,
          settled: +res.settled.toFixed(1), worst: +res.worst.toFixed(1),
          worstAt: +res.worstAt.toFixed(3), worstLag: +res.worstLag.toFixed(3),
          maxLag: +res.maxLag.toFixed(3), lagOnRoof: +res.lagOnRoof.toFixed(3),
          cost: +(res.settled - res.worst).toFixed(1),
        });
        if (res.worst < MARGIN) failed = true;
      }
      if (errs.length) {
        problems.push(vp.name + ' ' + pc.name + ': ' + errs.slice(0, 2).join(' | '));
        failed = true;
      }
      await ctx.close();
    }
  }

  await browser.close();

  if (JSON_OUT) {
    console.log(JSON.stringify({ margin: MARGIN, deck: DECK, rows, problems, ok: !failed }, null, 1));
    process.exit(failed ? 1 : 0);
  }

  const fmt = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);
  console.log('');
  console.log('DECKDROP -- lowest row of the shoe through a dismount, vs #railWrap, CSS px');
  console.log('positive = clear of the panel, negative = drawn inside it');
  console.log('deck ' + DECK.toFixed(2) + ' units, pass threshold ' + MARGIN + 'px');
  console.log('');
  console.log('  viewport     pace    on roof   WORST   at      cost   lag@worst  lag max');
  console.log('  ' + '-'.repeat(76));
  let lastVp = null;
  for (const r of rows) {
    if (lastVp && lastVp !== r.vp) console.log('');
    lastVp = r.vp;
    console.log(
      '  ' + r.vp.padEnd(12) + r.pace.padEnd(8) +
      fmt(r.settled).padStart(7) + fmt(r.worst).padStart(9) +
      (r.worstAt.toFixed(2) + 's').padStart(8) +
      r.cost.toFixed(1).padStart(8) +
      r.worstLag.toFixed(3).padStart(10) + r.maxLag.toFixed(3).padStart(9) +
      (r.worst < MARGIN ? '   FAIL' : '')
    );
  }
  console.log('');
  if (rows.length) {
    const worst = rows.reduce((a, b) => (b.worst < a.worst ? b : a), rows[0]);
    console.log('  worst: ' + worst.vp + ' ' + worst.pace + '  ' + fmt(worst.worst)
      + '  (' + worst.cost.toFixed(1) + 'px below its own settled framing)');
  }
  console.log('  ' + rows.length + ' combinations');
  for (const p of problems) console.log('  ! ' + p);
  console.log('  ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
