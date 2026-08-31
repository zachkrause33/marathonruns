#!/usr/bin/env node
/**
 * AIDVANISH -- the pickup is gone at the touch, and nothing is painted under it.
 *
 * ---- WHY THIS IS A TOOL ---------------------------------------------------
 *
 * Two owner reports, one frame apart: "The water bottles and banana need to
 * somehow disappear after you capture them. You kind of just run through them
 * now", and "Take the circle out from under the bottles and banana."
 *
 * Both are about a thing that exists for a fifth of a second while the camera
 * is moving, which is exactly the kind of claim a screenshot cannot settle --
 * the first attempt at proving it shot bot-timed frames at headless frame
 * rates and caught the moment neither before nor after. So this file does not
 * photograph the animation, it MEASURES it: the rAF pump is taken, contact is
 * forced, and the item's scale is sampled frame by frame on a clock this file
 * owns. The frames it does write are illustrations, not evidence.
 *
 * It asserts four things:
 *
 *   1. NO GROUND DISC. Every aid geometry starts well above the road -- the
 *      mint pool used to put vertices at y 0.01-0.08, so a low minimum is the
 *      fingerprint of the thing the owner cut.
 *   2. THE TOUCH TAKES IT. The first rendered frame after contact is already
 *      visibly crushed, because a collapse that begins on the NEXT frame is
 *      the "ran through it" the owner reported.
 *   3. IT IS GONE BEFORE THE CAMERA GETS THERE. The whole animation finishes
 *      inside the time the runner takes to cover the ground to the item's own
 *      z at race pace -- the actual failure, stated in the units that caused
 *      it.
 *   4. THE POOL IS SAFE. A reclaimed item comes back at full scale. A shrunk
 *      mesh respawning tiny is the classic failure of collapse animations on
 *      pooled objects, and it would be invisible in every other gate.
 *
 *   node tools/aidvanish.js           measure
 *   node tools/aidvanish.js --shots   also write illustration frames
 *   node tools/aidvanish.js --json    machine-readable
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (n) => args.indexOf('--' + n) >= 0;
const SHOTS = has('shots');
const JSON_OUT = has('json');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&nosave=1&debug=1',
    { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  await page.waitForTimeout(600);


  // ---- 2/3/4. the animation, on a clock this file owns -------------------
  // Take the pump AND the clock. The pop is timed off performance.now()
  // directly rather than off the rAF timestamp, so a harness that owns only
  // the pump advances the WORLD while the ANIMATION stands still -- which is
  // exactly what the first draft of this file did: it stepped 24 frames in a
  // few real milliseconds, watched an animation that had barely started, and
  // reported the fix broken. Both clocks have to be the same clock.
  await page.evaluate(() => {
    window.__av = { pump: null, t: performance.now() };
    const realNow = performance.now.bind(performance);
    window.__av.real = realNow;
    performance.now = function () { return window.__av.t; };
    window.requestAnimationFrame = function (cb) { window.__av.pump = cb; return 1; };
  });
  let handed = false;
  for (let i = 0; i < 60 && !handed; i++) {
    handed = await page.evaluate(() => !!(window.__av && window.__av.pump));
    if (!handed) await page.waitForTimeout(100);
  }
  if (!handed) {
    console.log('AIDVANISH  FAIL: the game loop never handed over a frame');
    await browser.close(); process.exit(1);
  }

  const anim = await page.evaluate(() => {
    const g = MR.game, F = window.__av;
    // Stepping does not need pixels, and under swiftshader a rendered frame
    // costs tens of milliseconds -- fourteen thousand of them is a quarter of
    // an hour of drawing nothing anybody looks at. Same trade footroom.js and
    // deckdrop.js make, and it is safe for the same reason: this file reads
    // state the update() path computes, never the framebuffer.
    g.renderer.render = function () { };
    F.step = function (dtSec) {
      F.t += dtSec * 1000;                    // the clock the pop reads
      const cb = F.pump; F.pump = null;
      if (cb) cb(F.t);                        // ...and the one the loop reads
    };
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) F.step(dt);   // settle

    // Step until the bot actually TAKES something: the transition from a live
    // item to a popped one is the event, and it is driven by the shipped
    // collection path rather than by anything this file sets.
    const live = () => (g.world.aidState ? g.world.aidState() : []);
    if (!g.world.aidState) return { error: 'world.aidState() is not exposed' };

    // A popped entry is identified by lane+z, which is stable for its life.
    const idOf = (s) => s.lane + '@' + s.z.toFixed(2);
    let guard = 0, watch = null, popFrame = -1, frame = 0;
    const scales = [];
    const speeds = [];

    while (guard++ < 12000) {
      F.step(dt); frame++;
      speeds.push(g.pace.units);
      const st = live();

      if (!watch) {
        // Latch the first item we see pop, then follow it.
        for (const s of st) if (s.popped) { watch = idOf(s); popFrame = frame; break; }
        if (!watch) continue;
      }
      const still = st.find((s) => idOf(s) === watch);
      // The scale comes from the world's own record of the item, not from a
      // mesh this file picked out by proximity. See aidState().
      if (still) scales.push(still.scale);
      else break;                             // gone from the live list: over
      if (frame - popFrame > 120) break;   // two seconds is a hang, not an animation
    }
    if (popFrame < 0) return { error: 'the bot never collected an item in 200 seconds' };

    const framesAlive = Math.max(0, scales.length);
    // Metres of road covered per second at the pace this ran at, so the
    // duration can be stated in the units that caused the complaint.
    const spd = (speeds[speeds.length - 1] - speeds[0]) / (speeds.length * dt);

    // Pool safety, and the ground disc, over a long stretch of road: every
    // UNPOPPED item must stand at full scale (a shrunk mesh returning from the
    // pool is the classic leak) and none may reach down to the road.
    const respawn = [];
    let lowest = Infinity, checked = 0;
    for (let i = 0; i < 2400; i++) {
      F.step(dt);
      for (const s of live()) {
        if (s.popped) continue;
        checked++;
        if (s.scale < 0.999) respawn.push(+s.scale.toFixed(3));
        if (s.footY < lowest) lowest = s.footY;
      }
    }
    return {
      framesAlive: framesAlive, firstScale: scales[0], scales: scales.slice(0, 12),
      seconds: framesAlive * dt, speed: spd, respawnSmall: respawn.slice(0, 5),
      lowestFoot: isFinite(lowest) ? lowest : null, itemsChecked: checked,
    };
  });

  await browser.close();

  const fails = [];
  const notes = [];
  if (anim && anim.error) {
    fails.push('could not measure the animation: ' + anim.error);
  } else if (anim) {
    notes.push('visible for ' + anim.framesAlive + ' frames = '
      + anim.seconds.toFixed(3) + 's after contact, at ' + anim.speed.toFixed(1)
      + ' units/s (' + (anim.seconds * anim.speed).toFixed(2) + ' units of road)');
    notes.push('scale timeline: ' + anim.scales.map(
      (s) => (s < 0 ? 'gone' : s.toFixed(2))).join(' '));
    // 2. THE TOUCH TAKES IT.
    if (!(anim.firstScale >= 0 && anim.firstScale <= 0.65)) {
      fails.push('the first frame after contact is at scale '
        + (anim.firstScale < 0 ? 'not found' : anim.firstScale.toFixed(2))
        + ' -- the touch must visibly take the item, not start shrinking it later');
    }
    // 3. GONE BEFORE THE CAMERA GETS THERE. The chase camera sits 4.35 units
    // back, so the lens reaches the item's z that many units later.
    const overrun = 4.35 / Math.max(1, anim.speed);
    notes.push('camera overruns the spot in ' + overrun.toFixed(3) + 's');
    if (anim.seconds > overrun) {
      fails.push('the item is still on screen ' + anim.seconds.toFixed(3)
        + 's after contact but the lens passes its z in ' + overrun.toFixed(3)
        + 's -- the player runs through it, which is the report');
    }
    // 4. THE POOL IS SAFE.
    if (anim.respawnSmall && anim.respawnSmall.length) {
      fails.push('items respawned from the pool at reduced scale: '
        + anim.respawnSmall.join(', ') + ' -- the collapse leaked into reuse');
    }
    // 1. NO GROUND DISC, measured over every item that stood on the road.
    notes.push(anim.itemsChecked + ' standing items checked, lowest point y '
      + (anim.lowestFoot === null ? 'n/a' : anim.lowestFoot.toFixed(3)));
    if (anim.lowestFoot !== null && anim.lowestFoot < 0.30) {
      fails.push('an item reaches down to y ' + anim.lowestFoot.toFixed(3)
        + ' -- the mint disc sat on the road at y 0.01-0.08, so that is the'
        + ' circle the owner cut still being drawn');
    }
  }
  for (const e of errs.filter((x) => !/AudioContext|deprecated with r150/.test(x))) {
    fails.push('pageerror: ' + e);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ geo, anim, notes, fails, ok: !fails.length }, null, 1));
    process.exit(fails.length ? 1 : 0);
  }
  console.log('');
  console.log('AIDVANISH -- the pickup is gone at the touch, and nothing is painted under it');
  for (const n of notes) console.log('  . ' + n);
  for (const f of fails) console.log('  ! ' + f);
  console.log('  ' + (fails.length ? 'FAIL' : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})();
