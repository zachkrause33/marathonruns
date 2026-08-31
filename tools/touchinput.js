#!/usr/bin/env node
/**
 * TOUCHINPUT -- the real touchstart/touchmove/touchend listeners in
 * src/game/controls.js, driven with genuine touch events instead of ?bot=.
 *
 * ---- WHY THIS IS THE GAP EVERY OTHER TOOL LEAVES OPEN --------------------
 *
 * Every existing harness -- shoot, course-test, simulate, playthrough,
 * ridehold, dailystate, aidvanish -- drives the game through ?bot=, which
 * calls controls.push('left' | 'right' | 'jump' | 'duck') directly. That is
 * a straight write into the action queue controls.js itself fills from a
 * touchstart/touchmove/touchend listener pair on the canvas (el, around line
 * 124). No tool before this one has ever dispatched a touch event at the
 * real page and asked whether that listener still turns a finger into an
 * action -- which means the single most-executed piece of player-facing
 * code in this game (every lane change, jump and duck a phone player ever
 * makes) is the one path the whole green gate suite has never once run.
 * A CSS regression, a passive-listener change, a touch-action conflict or a
 * dead zone under the HUD would sail through build, shoot, course-test,
 * simulate and playthrough without moving a single number.
 *
 * This is the same shape of gap ridehold closed for the lorry deck
 * (roadmap 76): a real mechanism nothing was driving for real, closed only
 * once a purpose-built instrument caused the observation instead of hoping
 * a bot would produce it. A bot never touches the screen -- it writes to
 * the queue controls.js fills -- so no amount of bot mileage was ever going
 * to exercise this.
 *
 * ---- HOW A TOUCH IS MADE GENUINE -------------------------------------------
 *
 * page.touchscreen only taps; it cannot hold a finger down, move it, and
 * lift it on a schedule this file controls. So every gesture here goes
 * through CDP Input.dispatchTouchEvent (touchStart / touchMove / touchEnd)
 * on a context created with hasTouch: true and isMobile: true -- without
 * hasTouch the touch listeners in controls.js may never see a real event at
 * all, which is exactly the kind of thing this tool exists to catch rather
 * than assume.
 *
 * ---- THE CLOCK PROBLEM, AND WHY THE PUMP IS NOT FROZEN --------------------
 *
 * ridehold and deckdrop freeze requestAnimationFrame and hand-drive the
 * world because their subject is a spatial fact independent of wall time.
 * This tool's subject is SWIPE_MAX_TIME -- a real elapsed-time threshold
 * measured against controls.js's own `s.time`, which only advances through
 * real rAF frames (main.js: `controls.tick(dt)`, dt = real wall delta,
 * clamped to 1/25s per frame). Freezing the pump would make the "too slow"
 * case untestable by construction. So the pump runs live here, and to know
 * how much of controls.js's own clock has actually elapsed -- without ever
 * touching controls.js -- an init script installed before the page's own
 * scripts run wraps window.requestAnimationFrame and mirrors the exact same
 * clamp math against the exact same rAF timestamps main.js uses to drive
 * `s.time`. That mirror, not a wall-clock guess, is what this file polls
 * before firing the delayed half of a "too slow" swipe. It matters more
 * here than it looks: under the swiftshader software renderer this sandbox
 * runs on, real:game time ran at roughly 0.16x in measurement (about 5
 * rendered frames/sec, all under the 25fps clamp) -- a fixed real-ms sleep
 * tuned on a fast machine would have UNDER-shot 0.6s of controls.js's own
 * clock and silently turned every "too slow" case into a false pass.
 *
 * ---- COVERAGE ---------------------------------------------------------
 *
 *  - left/right swipe, one lane change, correct direction, from all three
 *    lanes, including the two edge cases that swipe into the wall
 *  - up swipe jumps, down swipe ducks
 *  - a swipe under SWIPE_MIN does nothing (read live from controls.js's
 *    source, never assumed -- see readThresholds())
 *  - a swipe slower than SWIPE_MAX_TIME does nothing (measured against the
 *    mirrored controls.js clock, not a wall-clock guess)
 *  - a tap with no move fires nothing
 *  - a diagonal swipe fires exactly one action, on the dominant axis
 *  - three viewports: a small phone (320x568), a large phone (430x926),
 *    and landscape (844x390)
 *  - a swipe on a visible panel (touch-action: pan-y pinch-zoom) is not
 *    swallowed by the canvas listener and does not fire a game action
 *  - keyboard input, which serves the same buffered queue
 *
 * ---- WHAT THIS DOES NOT PROVE ------------------------------------------
 *
 * A CDP-dispatched touch is a synthetic event the compositor treats as a
 * real one -- it is not a finger. It cannot catch a defect that lives in a
 * real device's own gesture stack: iOS Safari's edge-swipe-back gesture
 * eating the first 20px of a left swipe, a real touchmove coalescing
 * differently than CDP's, a devicePixelRatio bug that only shows up on
 * actual glass, or 300ms tap-delay quirks on a browser without the viewport
 * meta this page already sets. It also cannot prove FEEL -- whether a real
 * thumb produces the physical dx/dt this file constructs. It proves the
 * listener chain from event to action queue to player state, on a real
 * page, through a real DOM event; nothing past the glass.
 *
 * ---- PROVEN ABLE TO FAIL -------------------------------------------------
 *
 *   node tools/touchinput.js --selftest
 *
 * dispatches a swipe deliberately shorter than SWIPE_MIN and asserts --
 * wrongly, on purpose -- that it changes lane. See docs/roadmap.md 80 for
 * the verbatim output: the harness correctly reports FAIL on that assertion
 * and exits nonzero, which is the only way a PASS anywhere else in this
 * file means anything.
 *
 *   node tools/touchinput.js               today's course, default viewport
 *   node tools/touchinput.js --file x.html  against an alternate build
 *   node tools/touchinput.js --selftest     prove the checker can fail
 *   node tools/touchinput.js --json         machine-readable
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}
const FILE = arg('file', null);
const JSON_OUT = !!arg('json', false);
const SELFTEST = !!arg('selftest', false);
const HTML = FILE ? path.resolve(String(FILE)) : path.join(ROOT, 'index.html');
const URL_BASE = 'file://' + HTML + '?nosave=1&nocount=1&debug=1';

// ---- read the real thresholds off the real source, never assumed --------
function readThresholds() {
  const src = fs.readFileSync(path.join(ROOT, 'src/game/controls.js'), 'utf8');
  const minM = src.match(/SWIPE_MIN\s*=\s*(\d+(?:\.\d+)?)/);
  const maxM = src.match(/SWIPE_MAX_TIME\s*=\s*(\d+(?:\.\d+)?)/);
  if (!minM || !maxM) {
    console.error('touchinput: could not read SWIPE_MIN / SWIPE_MAX_TIME out of '
      + 'src/game/controls.js -- refusing to guess a number. Has the constant moved?');
    process.exit(1);
  }
  return { SWIPE_MIN: parseFloat(minM[1]), SWIPE_MAX_TIME: parseFloat(maxM[1]) };
}
const T = readThresholds();

// ---- the results ledger ---------------------------------------------------
const results = []; // { name, ok, detail }
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  return ok;
}

// ---- browser / page plumbing ----------------------------------------------
const LAUNCH_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage', '--no-sandbox'];

async function openGame(browser, vp, qs) {
  const ctx = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const pageErrs = [];
  page.on('pageerror', (e) => pageErrs.push(e.message));

  // The clock mirror. Installed before ANY page script runs, so it wraps the
  // real global requestAnimationFrame before main.js grabs a reference to it,
  // and it computes controls.js's own clamped-dt accumulation against the
  // exact same rAF timestamps -- see the header note on why this exists
  // instead of a wall-clock sleep.
  // window.__ti.touchEnds is the second half of this fix -- see the long
  // comment on waitForDrain below for why a gesture helper cannot return the
  // instant CDP's dispatch call resolves.
  await page.addInitScript(() => {
    window.__ti = { clock: 0, last: null, touchEnds: 0 };
    window.addEventListener('touchend', () => { window.__ti.touchEnds++; }, true);
    const raf0 = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return raf0(function (now) {
        if (window.__ti.last !== null) {
          let dt = (now - window.__ti.last) / 1000;
          dt = Math.max(0, Math.min(dt, 1 / 25)); // same clamp as main.js
          window.__ti.clock += dt;
        }
        window.__ti.last = now;
        return cb(now);
      });
    };
  });

  await page.goto(URL_BASE + (qs || ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, pageErrs };
}

async function dispatch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

/** THE SECOND CLOCK PROBLEM, FOUND BY THIS FILE FAILING ITS OWN CASES.
 *
 * `Input.dispatchTouchEvent`'s CDP promise resolves once the event is queued
 * into the browser's input pipeline -- NOT once the page's JS handler has
 * actually run. Measured directly (see the header), under this sandbox's
 * swiftshader renderer a single touch event can sit for well over a real
 * second before the congested main thread gets to it. The first version of
 * this file dispatched a whole gesture and returned as soon as the LAST CDP
 * call resolved, then immediately reset the player and started the NEXT
 * gesture's touchstart -- which reset controls.js's down()/tracking state
 * for the new gesture. If the PREVIOUS gesture's own touchmove/touchend
 * events were still queued behind the render backlog at that moment, they
 * would arrive AFTER the new touchstart and be read against the NEW
 * gesture's (sx, sy) origin instead of the old one -- a stale coordinate,
 * from a swipe that had already been asserted on and moved past, corrupting
 * the NEXT case with a phantom action. It reproduced twice in development:
 * once as two diagonal-swipe cases that both, independently of their own
 * intended direction, ended up on the lane the PRIOR case's swipe had
 * targeted; once as a "held past SWIPE_MAX_TIME" case that should have done
 * nothing instead firing the direction of the PRECEDING case's already-
 * consumed swipe. Both are this file racing itself, not controls.js racing
 * anyone -- so every gesture helper below now waits for its own touchend to
 * be OBSERVED BY THE PAGE (window.__ti.touchEnds, installed in openGame's
 * addInitScript, immediately proves the browser actually ran the handler)
 * before returning, which guarantees the next gesture's touchstart can never
 * again race a straggler from this one. */
async function waitForDrain(page, beforeCount) {
  await page.waitForFunction((b) => window.__ti.touchEnds > b, beforeCount, { timeout: 30000, polling: 50 });
}

/** Real-shaped swipe: a touchstart, a few incremental touchmoves ramping to
 *  the target delta with small real gaps, a touchend. This is the "does a
 *  genuine gesture work" path. */
async function swipeNatural(page, cdp, x0, y0, dx, dy, steps) {
  steps = steps || 5;
  const before = await page.evaluate(() => window.__ti.touchEnds);
  await dispatch(cdp, 'touchStart', [{ x: x0, y: y0, id: 1 }]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.waitForTimeout(16);
    await dispatch(cdp, 'touchMove', [{ x: x0 + dx * t, y: y0 + dy * t, id: 1 }]);
  }
  await page.waitForTimeout(16);
  await dispatch(cdp, 'touchEnd', []);
  await waitForDrain(page, before);
}

/** One touchstart, one touchmove straight to the target, one touchend --
 *  precise control for threshold-edge cases where the exact cumulative
 *  dx/dy at the moment move() runs is what is under test. */
async function swipeExact(page, cdp, x0, y0, dx, dy, gapMs) {
  const before = await page.evaluate(() => window.__ti.touchEnds);
  await dispatch(cdp, 'touchStart', [{ x: x0, y: y0, id: 1 }]);
  await page.waitForTimeout(gapMs == null ? 20 : gapMs);
  await dispatch(cdp, 'touchMove', [{ x: x0 + dx, y: y0 + dy, id: 1 }]);
  await page.waitForTimeout(20);
  await dispatch(cdp, 'touchEnd', []);
  await waitForDrain(page, before);
}

/** Hold past SWIPE_MAX_TIME (measured on the mirrored controls.js clock,
 *  not a wall-clock guess), THEN move past SWIPE_MIN in one step. */
async function swipeTooSlow(page, cdp, x0, y0, dx, dy) {
  const before = await page.evaluate(() => window.__ti.touchEnds);
  await dispatch(cdp, 'touchStart', [{ x: x0, y: y0, id: 1 }]);
  const base = await page.evaluate(() => window.__ti.clock);
  const target = T.SWIPE_MAX_TIME + 0.15; // margin past the real threshold
  await page.waitForFunction(
    ([b, tgt]) => window.__ti.clock - b > tgt,
    [base, target],
    { timeout: 60000, polling: 50 },
  );
  await dispatch(cdp, 'touchMove', [{ x: x0 + dx, y: y0 + dy, id: 1 }]);
  await page.waitForTimeout(20);
  await dispatch(cdp, 'touchEnd', []);
  await waitForDrain(page, before);
}

async function tapOnly(page, cdp, x0, y0) {
  const before = await page.evaluate(() => window.__ti.touchEnds);
  await dispatch(cdp, 'touchStart', [{ x: x0, y: y0, id: 1 }]);
  await dispatch(cdp, 'touchEnd', []);
  await waitForDrain(page, before);
}

/** Reset player lateral/vertical state directly for test isolation between
 *  sub-cases -- these are plain mutable fields on the object main.js exposes
 *  as MR.game.player, not a shortcut around any gate. */
async function resetPlayer(page, lane) {
  await page.evaluate((l) => {
    const p = MR.game.player;
    p.lane = l; p.laneFrom = l; p.laneT = 1;
    p.airborne = false; p.airT = 0;
    p.ducking = false; p.duckT = 0; p.duck01 = 0;
  }, lane);
}

async function playerState(page) {
  return page.evaluate(() => {
    const p = MR.game.player;
    return { lane: p.lane, laneT: p.laneT, airborne: p.airborne, ducking: p.ducking, state: MR.game.state };
  });
}

/** Poll for a condition with a generous timeout (the sandbox's swiftshader
 *  renderer measured near 5fps -- see header -- so "settles quickly" is a
 *  wall-clock lie here even though it is true in controls.js's own clock).
 *  Returns true/false rather than throwing, so a timeout is a clean "did not
 *  happen" rather than an uncaught rejection. */
async function waitFor(page, fn, arg, timeout) {
  try {
    await page.waitForFunction(fn, arg, { timeout: timeout || 15000, polling: 50 });
    return true;
  } catch (e) {
    return false;
  }
}

/** Enough real time for any wrongly-fired action to have shown up, without
 *  guessing a wall-clock number -- polls the mirrored clock past a game-time
 *  margin comfortably longer than a lane change (K.LANE_CHANGE_TIME) or a
 *  jump/duck (K.JUMP_TIME / K.DUCK_TIME), whichever the caller is guarding. */
async function settleWindow(page, marginSeconds) {
  const base = await page.evaluate(() => window.__ti.clock);
  await page.waitForFunction(
    ([b, m]) => window.__ti.clock - b > m,
    [base, marginSeconds],
    { timeout: 30000, polling: 50 },
  );
}

/** Retries a "this gesture SHOULD produce X" case up to `attempts` times.
 *
 * Why a retry belongs here and nowhere else in this file: measured directly
 * (see the header) under this sandbox's swiftshader software renderer, a
 * SINGLE dispatched touchmove event can sit for well over a real second
 * before the page's own main thread -- busy shading the scene -- gets around
 * to running its handler. That delay is capped by nothing on this file's
 * side; CDP's dispatch call returns as soon as the event is queued, not once
 * JS has run it. Because SWIPE_MAX_TIME is measured on controls.js's own
 * clock and that clock only advances through real rAF frames, a big enough
 * scheduling stall between touchstart and the touchmove that crosses
 * SWIPE_MIN can -- correctly, per the real threshold -- cause controls.js to
 * discard a gesture this file dispatched as a fast flick. That is a fact
 * about contention in a shared sandbox, not about the swipe code, and a
 * single unlucky sample of it is not evidence of a defect -- rule 3 is not
 * "trust the first number", it is "measure before diagnosing". So a
 * "should work" case gets up to three independently-dispatched attempts
 * before this file calls it broken; a "should do nothing" case never
 * retries, because extra scheduling delay cannot manufacture a false pass
 * there -- see settleWindow above, which is what those use instead. Every
 * attempt beyond the first is named in the recorded detail, so a run that
 * needed one is visible rather than laundered into a plain "ok". */
async function tryGesture(setupFn, gestureFn, checkFn, attempts) {
  attempts = attempts || 4;
  for (let i = 1; i <= attempts; i++) {
    await setupFn();
    await gestureFn();
    const ok = await checkFn();
    if (ok) return { ok: true, attempt: i, attempts };
  }
  return { ok: false, attempt: attempts, attempts };
}
function attemptSuffix(r) {
  return r.attempt > 1 ? ' [needed attempt ' + r.attempt + '/' + r.attempts + ']' : '';
}

// ---- the coverage suite -----------------------------------------------

async function coreSuite(page, cdp, vp, tag) {
  const cx = Math.round(vp.w / 2), cy = Math.round(vp.h / 2);
  const D = Math.max(60, Math.round(Math.min(vp.w, vp.h) / 3)); // swipe distance, on-screen

  // Bring the race in via the real begin() -- same door every start path in
  // the game funnels through.
  await page.evaluate(() => MR.game.begin());
  const started = await waitFor(page, () => MR.game.state === 2 /* RUN */, null, 15000);
  record(tag + ': race starts (MR.game.begin -> RUN)', started, 'MR.game.state after begin()');
  if (!started) return;

  // ---- lane changes, all three lanes, both directions ---------------------
  const laneCases = [
    { from: 0, dir: 'right', dx: D, expect: 1 },
    { from: 0, dir: 'left', dx: -D, expect: 0 },  // wall: no-op, must not misbehave
    { from: 1, dir: 'right', dx: D, expect: 2 },
    { from: 1, dir: 'left', dx: -D, expect: 0 },
    { from: 2, dir: 'right', dx: D, expect: 2 },  // wall: no-op
    { from: 2, dir: 'left', dx: -D, expect: 1 },
  ];
  for (const c of laneCases) {
    const wall = c.expect === c.from;
    let attemptInfo = { attempt: 1, attempts: 1 };
    let st;
    if (wall) {
      await resetPlayer(page, c.from);
      await swipeNatural(page, cdp, cx, cy, c.dx, 0);
      await settleWindow(page, 0.4);
      st = await playerState(page);
    } else {
      const r = await tryGesture(
        () => resetPlayer(page, c.from),
        () => swipeNatural(page, cdp, cx, cy, c.dx, 0),
        () => waitFor(page, ([exp]) => MR.game.player.lane === exp, [c.expect], 15000),
      );
      attemptInfo = r;
      st = await playerState(page);
    }
    record(
      tag + ': lane ' + c.from + ' swipe ' + c.dir + (wall ? ' (into wall)' : '') + ' -> lane ' + c.expect,
      st.lane === c.expect,
      'ended lane ' + st.lane + (wall ? ' (must stay ' + c.from + ')' : '')
        + (attemptInfo.attempt > 1 ? ' [needed attempt ' + attemptInfo.attempt + '/' + attemptInfo.attempts + ']' : ''),
    );
  }

  // ---- up swipe jumps, down swipe ducks ------------------------------------
  let r = await tryGesture(
    () => resetPlayer(page, 1),
    () => swipeNatural(page, cdp, cx, cy, 0, -D),
    () => waitFor(page, () => MR.game.player.airborne === true, null, 15000),
  );
  record(tag + ': up swipe -> jump (airborne)', r.ok,
    'airborne=' + (await playerState(page)).airborne + attemptSuffix(r));

  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => swipeNatural(page, cdp, cx, cy, 0, D),
    () => waitFor(page, () => MR.game.player.ducking === true, null, 15000),
  );
  record(tag + ': down swipe -> duck', r.ok,
    'ducking=' + (await playerState(page)).ducking + attemptSuffix(r));

  // ---- diagonal resolves to the dominant axis, exactly one action ---------
  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => swipeNatural(page, cdp, cx, cy, D, Math.round(D * 0.35)), // dx dominant, right+slightly-down
    () => waitFor(page, () => MR.game.player.lane === 2, null, 15000),
  );
  let st = await playerState(page);
  record(
    tag + ': diagonal (dx dominant) -> lane change only, no duck',
    r.ok && st.lane === 2 && st.ducking === false,
    'lane=' + st.lane + ' ducking=' + st.ducking + attemptSuffix(r),
  );

  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => swipeNatural(page, cdp, cx, cy, Math.round(D * 0.35), D), // dy dominant, down+slightly-right
    () => waitFor(page, () => MR.game.player.ducking === true, null, 15000),
  );
  st = await playerState(page);
  record(
    tag + ': diagonal (dy dominant) -> duck only, no lane change',
    r.ok && st.ducking === true && st.lane === 1,
    'lane=' + st.lane + ' ducking=' + st.ducking + attemptSuffix(r),
  );

  // ---- shorter than SWIPE_MIN does nothing ---------------------------------
  await resetPlayer(page, 1);
  const shortPx = Math.max(1, T.SWIPE_MIN - 1); // one px under the real threshold
  await swipeExact(page, cdp, cx, cy, shortPx, 0);
  await settleWindow(page, 0.5);
  st = await playerState(page);
  record(
    tag + ': swipe under SWIPE_MIN (' + shortPx + 'px < ' + T.SWIPE_MIN + 'px) does nothing',
    st.lane === 1 && st.airborne === false && st.ducking === false,
    'lane=' + st.lane + ' airborne=' + st.airborne + ' ducking=' + st.ducking,
  );

  // ---- slower than SWIPE_MAX_TIME does nothing -----------------------------
  await resetPlayer(page, 1);
  await swipeTooSlow(page, cdp, cx, cy, D, 0);
  await settleWindow(page, 0.5);
  st = await playerState(page);
  record(
    tag + ': swipe held past SWIPE_MAX_TIME (' + T.SWIPE_MAX_TIME + 's) does nothing',
    st.lane === 1,
    'lane=' + st.lane,
  );

  // ---- a tap with no move fires nothing -------------------------------------
  await resetPlayer(page, 1);
  await tapOnly(page, cdp, cx, cy);
  await settleWindow(page, 0.5);
  st = await playerState(page);
  record(
    tag + ': tap with no touchmove fires nothing',
    st.lane === 1 && st.airborne === false && st.ducking === false,
    'lane=' + st.lane + ' airborne=' + st.airborne + ' ducking=' + st.ducking,
  );
}

async function panelSuite(browser, vp) {
  const { ctx, page, cdp, pageErrs } = await openGame(browser, vp, '');
  // Deliberately no begin() -- the start panel is up by default and this is
  // the one screen in the game a swipe should NOT be read as a game verb.
  await page.evaluate(() => {
    window.__ti.canvasTouch = false;
    document.getElementById('gl').addEventListener('touchstart', () => { window.__ti.canvasTouch = true; });
  });
  const style = await page.evaluate(() => {
    const panel = document.getElementById('startPanel');
    return {
      panelVisible: !panel.classList.contains('hidden'),
      panelTouchAction: getComputedStyle(panel).touchAction,
      bodyTouchAction: getComputedStyle(document.body).touchAction,
    };
  });
  const cx = Math.round(vp.w / 2), cy = Math.round(vp.h / 2);
  await swipeNatural(page, cdp, cx, cy, Math.round(vp.w / 3), 0);
  await settleWindow(page, 0.4);
  const after = await page.evaluate(() => ({ canvasTouch: window.__ti.canvasTouch, lane: MR.game.player.lane }));
  record(
    'panel: start panel is up and covers the swipe target',
    style.panelVisible,
    'startPanel hidden=' + !style.panelVisible,
  );
  record(
    'panel: canvas touch listener never fires under the panel',
    after.canvasTouch === false,
    'canvas touchstart fired=' + after.canvasTouch,
  );
  record(
    'panel: no game action fires from a swipe on the panel',
    after.lane === 1,
    'lane=' + after.lane,
  );
  record(
    'panel: .panel opts back into scroll/zoom (touch-action: pan-y pinch-zoom)',
    /pan-y/.test(style.panelTouchAction) && /pinch-zoom/.test(style.panelTouchAction),
    'computed touch-action="' + style.panelTouchAction + '"',
  );
  record(
    'panel: body stays touch-action: none for the gameplay swipe',
    style.bodyTouchAction === 'none',
    'computed touch-action="' + style.bodyTouchAction + '"',
  );
  await ctx.close();
  return pageErrs;
}

async function keyboardSuite(browser, vp) {
  const { ctx, page, pageErrs } = await openGame(browser, vp, '');
  await page.evaluate(() => MR.game.begin());
  await waitFor(page, () => MR.game.state === 2, null, 15000);

  let r = await tryGesture(
    () => resetPlayer(page, 1),
    () => page.keyboard.press('ArrowRight'),
    () => waitFor(page, () => MR.game.player.lane === 2, null, 15000),
  );
  record('keyboard: ArrowRight -> lane 1 -> 2', r.ok, 'lane=' + (await playerState(page)).lane + attemptSuffix(r));

  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => page.keyboard.press('ArrowLeft'),
    () => waitFor(page, () => MR.game.player.lane === 0, null, 15000),
  );
  record('keyboard: ArrowLeft -> lane 1 -> 0', r.ok, 'lane=' + (await playerState(page)).lane + attemptSuffix(r));

  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => page.keyboard.press('ArrowUp'),
    () => waitFor(page, () => MR.game.player.airborne === true, null, 15000),
  );
  record('keyboard: ArrowUp -> jump', r.ok, 'airborne=' + (await playerState(page)).airborne + attemptSuffix(r));

  r = await tryGesture(
    () => resetPlayer(page, 1),
    () => page.keyboard.press('ArrowDown'),
    () => waitFor(page, () => MR.game.player.ducking === true, null, 15000),
  );
  record('keyboard: ArrowDown -> duck', r.ok, 'ducking=' + (await playerState(page)).ducking + attemptSuffix(r));

  await ctx.close();
  return pageErrs;
}

async function selftest(browser, vp) {
  console.log('');
  console.log('TOUCHINPUT --selftest -- proving the checker can actually report FAIL');
  console.log('  dispatching a ' + (T.SWIPE_MIN - 16) + 'px swipe (SWIPE_MIN is '
    + T.SWIPE_MIN + 'px) and asserting -- wrongly, on purpose -- that it changes lane');
  const { ctx, page, cdp, pageErrs } = await openGame(browser, vp, '');
  await page.evaluate(() => MR.game.begin());
  await waitFor(page, () => MR.game.state === 2, null, 15000);
  await resetPlayer(page, 1);
  const tooShort = Math.max(1, T.SWIPE_MIN - 16);
  await swipeExact(page, cdp, Math.round(vp.w / 2), Math.round(vp.h / 2), tooShort, 0);
  await settleWindow(page, 0.5);
  const st = await playerState(page);
  const wrongExpectation = (st.lane === 2); // this SHOULD be false -- lane must not have moved
  await ctx.close();
  const selftestOk = wrongExpectation === false;
  console.log('  actual lane after the too-short swipe: ' + st.lane + ' (started at 1)');
  console.log('  deliberately-wrong assertion ("this changed the lane"): '
    + (wrongExpectation ? 'PASS (unexpected!)' : 'FAIL (expected)'));
  if (selftestOk) {
    console.log('  SELFTEST OK: the checker correctly reported FAIL on a wrong expectation.');
    console.log('  A test that has never failed has not been tested; this one just did.');
  } else {
    console.log('  SELFTEST ALARM: the too-short swipe actually moved the lane -- that is');
    console.log('  either a real SWIPE_MIN regression or a bug in this harness. Investigate');
    console.log('  before trusting any PASS elsewhere in this file.');
  }
  console.log('  pageErrors: ' + pageErrs.length);
  console.log('');
  return selftestOk && pageErrs.length === 0;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: LAUNCH_ARGS,
  });

  if (SELFTEST) {
    const ok = await selftest(browser, { w: 390, h: 844 });
    await browser.close();
    process.exit(ok ? 0 : 1);
  }

  const allErrs = [];

  // ---- the primary viewport: the full threshold/diagonal/tap/panel suite --
  const PRIMARY = { w: 390, h: 844 };
  {
    const { ctx, page, cdp, pageErrs } = await openGame(browser, PRIMARY, '');
    await coreSuite(page, cdp, PRIMARY, 'primary 390x844');
    allErrs.push(...pageErrs);
    await ctx.close();
  }

  // ---- three more viewports: does the gesture still work at all -----------
  const VIEWPORTS = [
    { name: 'small phone', w: 320, h: 568 },
    { name: 'large phone', w: 430, h: 926 },
    { name: 'landscape', w: 844, h: 390 },
  ];
  for (const vp of VIEWPORTS) {
    const { ctx, page, cdp, pageErrs } = await openGame(browser, vp, '');
    const cx = Math.round(vp.w / 2), cy = Math.round(vp.h / 2);
    const D = Math.max(60, Math.round(Math.min(vp.w, vp.h) / 3));
    await page.evaluate(() => MR.game.begin());
    const started = await waitFor(page, () => MR.game.state === 2, null, 15000);
    record(vp.name + ' ' + vp.w + 'x' + vp.h + ': race starts', started);
    if (started) {
      let r = await tryGesture(
        () => resetPlayer(page, 1),
        () => swipeNatural(page, cdp, cx, cy, D, 0),
        () => waitFor(page, () => MR.game.player.lane === 2, null, 15000),
      );
      record(vp.name + ' ' + vp.w + 'x' + vp.h + ': right swipe works', r.ok,
        'lane=' + (await playerState(page)).lane + attemptSuffix(r));

      r = await tryGesture(
        () => resetPlayer(page, 1),
        () => swipeNatural(page, cdp, cx, cy, -D, 0),
        () => waitFor(page, () => MR.game.player.lane === 0, null, 15000),
      );
      record(vp.name + ' ' + vp.w + 'x' + vp.h + ': left swipe works', r.ok,
        'lane=' + (await playerState(page)).lane + attemptSuffix(r));
    }
    allErrs.push(...pageErrs);
    await ctx.close();
  }

  // ---- the panel must not swallow / be swallowed by the game --------------
  allErrs.push(...await panelSuite(browser, PRIMARY));

  // ---- keyboard shares the same buffered action path -----------------------
  allErrs.push(...await keyboardSuite(browser, PRIMARY));

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  const ok = failed.length === 0 && allErrs.length === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      thresholds: T, results, pageErrors: allErrs, ok,
    }, null, 1));
    process.exit(ok ? 0 : 1);
  }

  console.log('');
  console.log('TOUCHINPUT -- genuine touch/keyboard events against the real page');
  console.log('  SWIPE_MIN=' + T.SWIPE_MIN + 'px  SWIPE_MAX_TIME=' + T.SWIPE_MAX_TIME
    + 's (read live from src/game/controls.js)');
  console.log('  ' + results.length + ' checks, ' + failed.length + ' failed');
  for (const r of results) {
    console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + '  ' + r.name + (r.detail ? '  -- ' + r.detail : ''));
  }
  if (allErrs.length) {
    console.log('  page errors:');
    for (const e of allErrs) console.log('    ! ' + e);
  }
  console.log('  ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})();
