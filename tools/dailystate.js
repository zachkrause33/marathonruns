#!/usr/bin/env node
/**
 * DAILYSTATE -- the streak, the history tab and the daily lockout, driven on
 * the real page against synthetic save data.
 *
 * ---- WHY A TOOL AND NOT A SCREENSHOT -------------------------------------
 *
 * Every other panel in this game can be photographed by opening the page,
 * because the page shows it. These three cannot: a record streak of four days
 * takes four days to earn, a broken chain takes a missed day, and the lockout
 * only appears after 1:59:30 has actually fallen. So the states that matter
 * are exactly the states a person cannot reach by playing once, which is the
 * same thing as saying nobody would ever have checked them.
 *
 * This file writes the save directly (the store's own key and shape), reloads,
 * and reads back what the panels say. It asserts the four facts the owner's
 * request turns on:
 *
 *   1. a fresh save offers a run and shows no streak and no lock
 *   2. consecutive record days count, and a MISSED day breaks the chain
 *      (the case a stored counter would get wrong and this one is walked
 *      back from the history to avoid)
 *   3. the record falling TODAY locks today: the start button is gone, the
 *      completed state is up, and begin() refuses to start a race
 *   4. ?nosave= and ?bot= are never locked, whatever the save says --
 *      the whole gate suite boots through those doors, and a harness locked
 *      out of its own course would take the suite with it
 *
 *   node tools/dailystate.js            all cases
 *   node tools/dailystate.js --shots    also write frames to shots/
 *   node tools/dailystate.js --json     machine-readable
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (n) => args.indexOf('--' + n) >= 0;
const SHOTS = has('shots');
const JSON_OUT = has('json');
const KEY = 'marathonruns/save/v1';

// The store's own day arithmetic, restated here on purpose: a test that
// derives its dates from the code under test cannot catch that code being
// wrong about dates.
function shiftKey(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function row(date, city, time, rec) {
  return { date: date, city: city, time: time, rec: rec, runs: 1 };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const html = 'file://' + path.join(ROOT, 'index.html');
  const fails = [];
  const notes = [];

  // One context for the whole run so localStorage persists between loads; the
  // page is what gets reloaded, not the browser.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // The page has to be loaded once before localStorage on its origin can be
  // written -- a file:// origin does not exist until something is there.
  await page.goto(html + '?nosave=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  const today = await page.evaluate(() => MR.game.course.dateKey || MR.Store.KEY && null);

  // The date the page itself is keyed to. Read from the page rather than from
  // this process's clock, because the two can disagree across a UTC midnight
  // and the whole point of the lockout is that it agrees with the course.
  const dateKey = await page.evaluate(() => {
    // The course's own key if it exposes one; otherwise today in UTC, which is
    // how the store derives it.
    return (MR.game.course && MR.game.course.dateKey)
      || new Date().toISOString().slice(0, 10);
  });
  notes.push('page date key: ' + dateKey);

  async function setSave(save) {
    await page.evaluate(([k, v]) => { localStorage.setItem(k, v); },
      [KEY, JSON.stringify(save)]);
  }
  async function clearSave() {
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
  }
  // Reload and report what the start panel is showing.
  async function read(query) {
    await page.goto(html + (query || ''), { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const vis = (el) => !!(el && el.offsetParent !== null);
      const txt = (sel) => {
        const el = document.querySelector(sel);
        return el && vis(el) ? el.textContent.replace(/\s+/g, ' ').trim() : '';
      };
      const startBtn = document.getElementById('startBtn')
        || document.querySelector('#startPanel button');
      const panel = document.getElementById('startPanel') || document.body;
      return {
        panelText: panel.textContent.replace(/\s+/g, ' ').trim(),
        startVisible: vis(startBtn),
        lockText: txt('.lockChip') || txt('#lockChip'),
        title: txt('#startTitle'),
        target: txt('.targetLab'),
        phase: MR.game.state && MR.game.state.phase,
      };
    });
  }
  // Ask the page to start a race and report whether it actually did.
  async function tryBegin() {
    return page.evaluate(() => {
      const before = MR.game.state && MR.game.state.phase;
      try { MR.game.begin(); } catch (e) { return { threw: e.message, before: before }; }
      return { before: before, after: MR.game.state && MR.game.state.phase };
    });
  }
  const check = (name, cond, detail) => {
    if (!cond) fails.push(name + (detail ? ' -- ' + detail : ''));
    return cond;
  };

  // ---- 1. a fresh save ---------------------------------------------------
  await clearSave();
  let r = await read('');
  check('fresh: a run is offered', r.startVisible, 'start button not visible');
  check('fresh: nothing is locked', !r.lockText, 'lock chip reads "' + r.lockText + '"');
  check('fresh: no streak claimed', !/STREAK\s*[2-9]/.test(r.panelText));
  check('fresh: the record is the stated target',
    /RECORD/.test(r.target + ' ' + r.panelText),
    'target line reads "' + r.target + '"');
  check('fresh: the wordmark is the new name', /MARATHON MILES/.test(r.title),
    'title reads "' + r.title + '"');
  notes.push('fresh target line: "' + r.target + '"');
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'daily-fresh.png') });

  // ---- 2. an unbroken chain, then a broken one ---------------------------
  // Four record days ending YESTERDAY: today has not been run, so the chain is
  // alive at 4 and today would extend it.
  const chain = [1, 2, 3, 4].map((i) => row(shiftKey(dateKey, -i), 'CHICAGO', 7160, true));
  await setSave({ v: 1, day: null, prev: null, days: { count: 4, last: shiftKey(dateKey, -1) },
    best: null, hist: chain.slice().reverse() });
  r = await read('');
  const streak4 = /4/.test(r.panelText);
  check('chain: four record days are counted', streak4,
    'panel does not mention 4 -- "' + r.panelText.slice(0, 160) + '"');
  check('chain: an unfinished today still offers a run', r.startVisible);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'daily-streak4.png') });

  // The same four days with a HOLE two days back. A counter would still say 4;
  // a history walk says 1.
  const holed = [row(shiftKey(dateKey, -1), 'CHICAGO', 7160, true),
    row(shiftKey(dateKey, -3), 'ROME', 7160, true),
    row(shiftKey(dateKey, -4), 'TOKYO', 7160, true)];
  await setSave({ v: 1, day: null, prev: null, days: { count: 4, last: shiftKey(dateKey, -1) },
    best: null, hist: holed.slice().reverse() });
  const holedSum = await page.evaluate((k) => {
    return MR.Store.summary(k).recordStreak;
  }, dateKey);
  check('chain: a missed day breaks the streak', holedSum === 1,
    'recordStreak is ' + holedSum + ', expected 1');
  notes.push('holed chain recordStreak: ' + holedSum);

  // ---- 3. the record falls today -----------------------------------------
  const won = chain.concat([row(dateKey, 'BOSTON', 7150, true)]);
  await setSave({ v: 1, day: { date: dateKey, time: 7150, streak: 12, tier: 'RECORD', runs: 2 },
    prev: null, days: { count: 5, last: dateKey }, best: null,
    hist: won.slice().sort((a, b) => (a.date < b.date ? -1 : 1)) });
  r = await read('');
  check('locked: no run is offered', !r.startVisible, 'the start button is still there');
  check('locked: the page says why', !!r.lockText || /TOMORROW|BROKEN|COME BACK/i.test(r.panelText),
    'no completed-state copy found');
  const beg = await tryBegin();
  check('locked: begin() refuses to race', beg.after !== 'RACE' && beg.after !== 'RUN',
    'phase went ' + beg.before + ' -> ' + beg.after);
  notes.push('locked chip: "' + r.lockText + '"  begin(): ' + beg.before + ' -> ' + beg.after);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'daily-locked.png') });

  // ---- 4. the harness doors are never locked -----------------------------
  // Same won save, opened the way every tool opens it.
  for (const q of ['?nosave=1', '?bot=1', '?skip=90']) {
    const rr = await read(q);
    const openable = rr.startVisible || rr.phase === 'RACE' || rr.phase === 'RUN' || !rr.lockText;
    check('harness: ' + q + ' is not locked out', openable,
      'phase ' + rr.phase + ', lock "' + rr.lockText + '"');
  }

  // ---- 5. a corrupt save must not throw ----------------------------------
  await page.evaluate((k) => localStorage.setItem(k, '{"v":1,"hist":"not-an-array"'), KEY);
  const rr = await read('');
  check('corrupt save: the page still offers a run', rr.startVisible,
    'a malformed save took the start panel with it');

  await clearSave();
  await ctx.close();
  await browser.close();

  const pageErrs = errs.filter((e) => !/AudioContext|deprecated with r150/.test(e));
  if (pageErrs.length) fails.push('page errors: ' + pageErrs.slice(0, 3).join(' | '));

  if (JSON_OUT) {
    console.log(JSON.stringify({ dateKey, notes, fails, ok: !fails.length }, null, 1));
    process.exit(fails.length ? 1 : 0);
  }
  console.log('');
  console.log('DAILYSTATE -- streak, history and the daily lockout on the real page');
  for (const n of notes) console.log('  . ' + n);
  for (const f of fails) console.log('  ! ' + f);
  console.log('  ' + (fails.length ? 'FAIL' : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})();
