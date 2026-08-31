#!/usr/bin/env node
/**
 * FAILSTATE -- what the page says when it cannot run the game.
 *
 * ---- WHY A TOOL, AND WHY THIS ONE COULD NOT BE A SCREENSHOT ---------------
 *
 * Every gate in this project photographs a game that WORKS. The three failures
 * below are the ones nobody in this tree had ever seen, because reaching them
 * needs a browser configured to refuse the thing the whole game is built on:
 *
 *   1. NO WEBGL AT ALL. A locked-down browser, an enterprise policy, a
 *      blocklisted GPU driver, or a low-memory Android that will not hand out
 *      a context. Measured on the shipped build before the fix:
 *      document.body.innerText was the EMPTY STRING and the canvas sat at its
 *      300x150 default. The visitor got a dark rectangle and no explanation.
 *   2. ANY OTHER BOOT THROW. Not enumerable in advance -- that is what makes
 *      it the last resort -- so the assertion is about the OUTCOME: the page
 *      says something rather than nothing.
 *   3. THE GPU TAKING ITS CONTEXT BACK mid-race. Mobile Safari and Chrome
 *      reclaim contexts under memory pressure and when a tab is backgrounded.
 *      Before the fix the loop kept calling requestAnimationFrame and
 *      renderer.render against a dead context: a frozen frame in a tight loop.
 *
 * ---- THE INSTRUMENT GETS THE SAME SCRUTINY AS THE WORK ---------------------
 *
 * A guard nobody can fail is not a guard, so this tool is written to be able to
 * fail. Case 1 asserts on document.body.innerText -- the exact string the
 * pre-fix audit measured as empty -- and not on the presence of a handler or an
 * element id, either of which would pass against a message nobody can read.
 * Case 3 asserts that the LOOP ACTUALLY STOPS (MR.game.looping goes false and
 * the rAF callback stops being reached), not that a listener was registered.
 * And it checks that the flags it launched with really did remove WebGL, so a
 * Chromium that ignored --disable-webgl cannot quietly turn case 1 green.
 *
 *   node tools/failstate.js            all cases
 *   node tools/failstate.js --shots    also write frames to shots/
 *   node tools/failstate.js --json     machine-readable
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (n) => args.indexOf('--' + n) >= 0;
const SHOTS = has('shots');
const JSON_OUT = has('json');
const EXE = process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// MR_PAGE points this at a different build, which is how the tool was audited:
// a copy of the shipped page with the renderer guard and the last-resort error
// listener neutered reproduces the pre-fix blank body, and this tool fails on
// it. See the header. Defaults to the committed deliverable.
const HTML = 'file://' + (process.env.MR_PAGE || path.join(ROOT, 'index.html'));

// The working configuration every other tool in this tree launches with.
const GL_ON = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage', '--no-sandbox'];
// ...and the same browser with the graphics taken away. Three flags rather
// than one because they fail at different layers, and a build that honoured
// only one of them would leave the case untested without saying so.
const GL_OFF = ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis',
  '--disable-gpu', '--disable-software-rasterizer',
  '--disable-dev-shm-usage', '--no-sandbox'];

const fails = [];
const notes = [];
const check = (name, cond, detail) => {
  if (!cond) fails.push(name + (detail ? ' -- ' + detail : ''));
  return cond;
};

/**
 * Wait until the page has either booted or given up.
 *
 * The timeout is SWALLOWED on purpose. A page that does neither is precisely
 * the pre-fix failure this tool exists to catch -- it booted nothing and said
 * nothing -- and a harness that dies of its own timeout reports that as a crash
 * in the tool rather than as a defect in the page. So it returns either way and
 * lets the assertions describe what is actually on screen.
 */
async function settle(page, ms) {
  try {
    await page.waitForFunction(
      () => (window.MR && ((MR.game && MR.game.ready) || (MR.bail && MR.bail.shown))),
      null, { timeout: ms || 60000 });
  } catch (e) { /* the checks below say what the page is showing */ }
  await page.waitForTimeout(250);
}

(async () => {
  // ---- 1 & 2. the browser that will not give the page a context -----------
  {
    const browser = await chromium.launch({ executablePath: EXE, args: GL_OFF });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    await page.goto(HTML, { waitUntil: 'load' });

    // AUDIT THE INSTRUMENT FIRST. If this Chromium quietly handed out a
    // context anyway, case 1 is not being tested and must say so rather than
    // pass. Asked of the page's own canvas, the way the game asks.
    const glGone = await page.evaluate(() => {
      try {
        const c = document.createElement('canvas');
        return !(c.getContext('webgl2') || c.getContext('webgl')
          || c.getContext('experimental-webgl'));
      } catch (e) { return true; }
    });
    check('instrument: the browser really has no WebGL', glGone,
      'a context was still available, so the no-WebGL case did not run');

    await settle(page, 15000);
    const r = await page.evaluate(() => ({
      body: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
      bailed: !!(window.MR && MR.bail && MR.bail.shown),
      booted: !!(window.MR && MR.game && MR.game.ready),
      canvasW: (document.getElementById('gl') || {}).width || 0,
    }));

    // The pre-fix measurement, restated as the assertion: this was ''.
    check('no-webgl: the body is not empty', r.body.length > 0,
      'document.body.innerText is the empty string -- the blank-page failure');
    check('no-webgl: the message names the cause',
      /WEBGL|GRAPHICS/i.test(r.body),
      'body reads "' + r.body.slice(0, 120) + '"');
    check('no-webgl: the message says what to do',
      /BROWSER|RELOAD|HARDWARE ACCELERATION/i.test(r.body),
      'no remedy offered: "' + r.body.slice(0, 120) + '"');
    check('no-webgl: the game did not pretend to boot', !r.booted);
    check('no-webgl: the guard fired', r.bailed);
    notes.push('no-webgl body: "' + r.body.slice(0, 150) + '"');
    notes.push('no-webgl page errors: ' + (errs.length ? errs.slice(0, 2).join(' | ') : 'none'));

    if (SHOTS) {
      await page.screenshot({ path: path.join(ROOT, 'shots', 'fail-nowebgl.png') });
    }

    // ---- 2. the last resort, on a throw that is not WebGL ------------------
    // Driven rather than hoped for: the handler's contract is "the game never
    // came up and something threw", so that is what is staged. Same page, the
    // guard reset first so this is its own message and not the echo of case 1.
    const late = await page.evaluate(() => {
      MR.unbail();
      const g = MR.game; MR.game = null;
      window.dispatchEvent(new ErrorEvent('error', { message: 'staged boot failure' }));
      const out = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
      MR.game = g;
      return out;
    });
    check('last resort: a boot throw still puts words on the page',
      late.length > 0 && /DID NOT START|RELOAD|BROWSER/i.test(late),
      'body reads "' + late.slice(0, 120) + '"');
    notes.push('last-resort body: "' + late.slice(0, 120) + '"');

    await ctx.close();
    await browser.close();
  }

  // ---- 3. the GPU takes its context back ----------------------------------
  {
    const browser = await chromium.launch({ executablePath: EXE, args: GL_ON });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // Mid-race, because that is when it hurts: the fix has to pause a run, not
    // just stop a loop on an idle start screen.
    await page.goto(HTML + '?nosave=1&bot=1&nocount=1', { waitUntil: 'load' });
    await settle(page);
    check('context loss: the page booted with WebGL on',
      await page.evaluate(() => !!(MR.game && MR.game.ready)));

    // The handle is taken BEFORE the loss and kept: getExtension returns null
    // on a lost context, so a tool that looks the extension up again when it
    // wants to restore has thrown away its only way back.
    const ext = await page.evaluate(() => {
      const gl = MR.game.renderer.getContext();
      window.__lose = gl.getExtension('WEBGL_lose_context');
      return !!window.__lose;
    });
    check('instrument: WEBGL_lose_context is available', ext,
      'without it this case cannot be staged and is not being tested');

    // COUNT THE RENDERS, NOT THE ANIMATION FRAMES, and this correction is the
    // instrument auditing itself. The first draft wrapped
    // window.requestAnimationFrame and read 0 frames in 300ms on a page that
    // was plainly running -- because software-rasterised Chromium renders this
    // scene at about 0.9 FPS, so a 300ms window is a fifth of one frame. It
    // then read 2 frames after the loss, which looked like the loop refusing
    // to stop and was in fact hud.js scheduling its own layout callbacks
    // through the same wrapper. Both readings were wrong in the flattering
    // direction for the tool and the damning one for the fix.
    //
    // renderer.render is called from exactly one place in the whole game -- the
    // last line of the loop -- so wrapping it counts the loop and nothing else,
    // and every wait below is a condition with a generous timeout rather than a
    // guess at a frame rate.
    await page.evaluate(() => {
      window.__renders = 0;
      const r = MR.game.renderer;
      const orig = r.render.bind(r);
      r.render = function (a, b) { window.__renders++; return orig(a, b); };
    });
    await page.waitForFunction(() => window.__renders > 2, null, { timeout: 30000 });
    const running = await page.evaluate(() => window.__renders);
    check('context loss: the loop was turning before', running > 2,
      'only ' + running + ' renders observed');

    // ZERO RENDERS AFTER THE HANDLER RAN, which is a stricter claim than "zero
    // renders after loseContext() was called" and is the one the fix actually
    // owes. A frame can already be in flight when the browser queues the lost
    // event -- it is scheduled, it is not the loop refusing to stop -- so the
    // count is taken FROM the handler rather than from the call. This tool's
    // own listener is registered after the game's on the same element, so it
    // runs second and reads the count the game left behind.
    await page.evaluate(() => {
      const c = document.getElementById('gl');
      window.__atLoss = -1;
      c.addEventListener('webglcontextlost', function () { window.__atLoss = window.__renders; });
      window.__lose.loseContext();
    });
    // Three seconds is not padding: at the measured ~0.9 FPS it is nearly three
    // frames, so a loop that had NOT stopped would be caught here.
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => ({
      frames: window.__renders,
      atLoss: window.__atLoss,
      looping: MR.game.looping,
      bailed: !!(MR.bail && MR.bail.shown),
      body: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
    }));
    check('context loss: the handler fired', after.atLoss >= 0,
      'webglcontextlost never reached the page');
    check('context loss: the loop stops',
      after.looping === false && after.frames === after.atLoss,
      'looping=' + after.looping + ', ' + (after.frames - after.atLoss)
        + ' renders in the 3s after the handler ran');
    check('context loss: the player is told', after.bailed && /CONTEXT|GRAPHICS/i.test(after.body),
      'body reads "' + after.body.slice(0, 120) + '"');
    notes.push('context-loss body: "' + after.body.slice(0, 120) + '"');
    notes.push('renders in the 3s after the handler ran: '
      + (after.frames - after.atLoss) + ' (turning before the loss: ' + running + ')');
    if (SHOTS) {
      await page.screenshot({ path: path.join(ROOT, 'shots', 'fail-contextlost.png') });
    }

    // ...and back again. preventDefault on the lost event is what makes this
    // possible at all, so a restore that never arrives would mean the fix took
    // the page down permanently rather than pausing it.
    await page.evaluate(() => {
      window.__renders = 0;
      window.__lose.restoreContext();
    });
    await page.waitForFunction(() => window.__renders > 1, null, { timeout: 30000 })
      .catch(() => { /* the assertion below reports it */ });
    const back = await page.evaluate(() => ({
      frames: window.__renders,
      looping: MR.game.looping,
      bailed: !!(MR.bail && MR.bail.shown),
    }));
    check('context restore: the loop turns again', back.looping === true && back.frames > 1,
      'looping=' + back.looping + ', ' + back.frames + ' renders after the restore');
    check('context restore: the message is taken down', !back.bailed);
    notes.push('renders after the restore: ' + back.frames);
    if (SHOTS) {
      await page.screenshot({ path: path.join(ROOT, 'shots', 'fail-contextback.png') });
    }

    const pageErrs = errs.filter((e) => !/AudioContext|deprecated with r150|Context Lost/i.test(e));
    if (pageErrs.length) fails.push('page errors: ' + pageErrs.slice(0, 3).join(' | '));

    await ctx.close();
    await browser.close();
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ notes, fails, ok: !fails.length }, null, 1));
    process.exit(fails.length ? 1 : 0);
  }
  console.log('');
  console.log('FAILSTATE -- no WebGL, a boot throw, and a lost GPU context');
  for (const n of notes) console.log('  . ' + n);
  for (const f of fails) console.log('  ! ' + f);
  console.log('  ' + (fails.length ? 'FAIL' : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})();
