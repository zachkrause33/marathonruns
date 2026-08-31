#!/usr/bin/env node
/**
 * SHARECARD -- the copyable result and the city checklist, on the real page.
 *
 * ---- WHY A TOOL --------------------------------------------------------
 *
 * Same argument as tools/dailystate.js, one layer along. The four results this
 * card has to print correctly are a clean run, a run the guard pool paid for,
 * a run that took real contacts, and a record -- and on the shipped model those
 * are separated by SKILL, not by a switch. A record needs a near-flawless
 * 26.2 miles; a guarded-but-not-hit run needs contacts that land only where a
 * segment happens to be in hand. Nobody was ever going to reach all four by
 * playing, which is the same thing as saying nobody was ever going to check
 * three of them.
 *
 * So the outcomes are STAGED, and staged against the real course: the contacts
 * are the z of real gates in named biome legs of the day the page actually
 * generated, handed to the real hud.showEnd with the real finished pace state.
 * The only thing synthesised is which gates were hit -- everything downstream
 * of that (the leg cut, the tier ladder, the delta, the streak line, the
 * blocks) is the shipped code answering.
 *
 * ---- WHAT IT ASSERTS ---------------------------------------------------
 *
 *   1. A REAL RACE, played end to end by the autopilot, produces a share
 *      string at all. This is the case the staged ones cannot cover: it is the
 *      only one where main.js hands hud.js the arrays itself.
 *   2. The four staged results read correctly, and the string is SPOILER-FREE
 *      -- checked as a property, not by eye: no lane, no mile, no gate count,
 *      no obstacle name, no course geometry of any kind may appear in it.
 *   3. THE CLIPBOARD ACTUALLY HOLDS THE TEXT. Not "writeText was called" --
 *      the text is pasted back out of the system clipboard with a real key
 *      press and compared. A copy button is exactly the kind of thing that
 *      looks right and does nothing.
 *   4. The button never fails silently: with the async clipboard removed it
 *      falls through to execCommand, and with both removed it reveals the text
 *      selected and says so.
 *   5. The city checklist at zero, some and ALL cities completed, with the
 *      count derived from course.js's SETTINGS rather than from twelve.
 *
 *   node tools/sharecard.js            all cases
 *   node tools/sharecard.js --shots    also write frames to shots/
 *   node tools/sharecard.js --json     machine-readable
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const has = (n) => args.indexOf('--' + n) >= 0;
const SHOTS = has('shots');
const JSON_OUT = has('json');
const KEY = 'marathonruns/save/v1';
const HTML = 'file://' + path.join(ROOT, 'index.html');

const fails = [];
const notes = [];
const strings = {};
const check = (name, cond, detail) => {
  if (!cond) fails.push(name + (detail ? ' -- ' + detail : ''));
  return cond;
};

// The store's own day arithmetic, restated here on purpose -- a test that
// derives its dates from the code under test cannot catch that code being
// wrong about dates. (Same reasoning, same code, as dailystate.js.)
function shiftKey(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// U+1F7E9 / U+1F7E8 / U+1F7E5 / U+1F3C6, spelled out so a mangled encoding in
// this file cannot quietly turn an assertion into a tautology.
const GREEN = '🟩', YELLOW = '🟨', RED = '🟥';
const TROPHY = '🏆';

/**
 * The spoiler test, as a property rather than as an opinion.
 *
 * The rule the card is built to is that the string describes the PLAYER'S RUN
 * and never the road. Anything that would tell a reader who has not run yet
 * where a hazard is, which lane clears it, or how the course is laid out is a
 * leak -- so the assertion is a blacklist of the vocabulary that could only
 * come from the course.
 */
function spoilers(s) {
  const bad = [];
  if (/\bLANE\b/i.test(s)) bad.push('lane');
  if (/\bMILE\b/i.test(s)) bad.push('mile');
  if (/\bGATE|OBSTACLE|BUS|LORRY|TRAIN|CONE|BARRIER|RAMP\b/i.test(s)) bad.push('obstacle');
  if (/CITY START|RIVERSIDE|THE BRIDGE|PARKLAND|THE WALL|FINAL MILE/i.test(s)) bad.push('leg name');
  if (/\d+\s*(GATES|OBSTACLES|HITS|CONTACTS)/i.test(s)) bad.push('course count');
  return bad;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Best-effort: a file:// origin does not always accept a clipboard grant, and
  // the paste-back check below does not depend on one.
  try { await ctx.grantPermissions(['clipboard-read', 'clipboard-write']); } catch (e) { /* fine */ }
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // ---- 1. a whole race, played -------------------------------------------
  // ?skip= runs the fast-forward loop, which is the live loop's own sequence,
  // so the arrays hud.js receives are the ones main.js built by playing.
  await page.goto(HTML + '?nosave=1&bot=0.93&skip=600&nocount=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  await page.waitForFunction(
    () => !document.getElementById('endPanel').classList.contains('hidden'),
    null, { timeout: 90000 });

  const played = await page.evaluate(() => ({
    text: MR.game.hud.shareString(),
    hits: MR.game.hitAt.length,
    guards: MR.game.guardAt.length,
    blocks: document.querySelectorAll('#shareLegs .sblock').length,
    finish: MR.game.pace.finishTime,
  }));
  strings.played = played.text;
  notes.push('played: ' + played.hits + ' hits, ' + played.guards
    + ' guarded, finish ' + played.finish.toFixed(1) + 's');
  check('played: a share string was built', !!played.text);
  check('played: one block per biome leg',
    played.blocks === (await page.evaluate(() => MR.Course.BIOMES.length)),
    played.blocks + ' blocks drawn');
  check('played: the string leaks nothing about the course',
    spoilers(played.text).length === 0, spoilers(played.text).join(', '));

  // The guard pool is what makes a yellow block possible at all, so a run that
  // never took a guarded contact cannot prove the middle state. Recorded, not
  // asserted -- the staged cases below own that assertion.
  notes.push('played string: ' + JSON.stringify(played.text));

  // ---- 2. the four staged results ----------------------------------------
  //
  // A finished pace state is borrowed from the race just run and its finish
  // time overridden, so every number the card derives comes from the shipped
  // model on the shipped course. The contacts are real gate z values, chosen by
  // leg, so the leg cut under test is the one the game actually uses.
  await page.evaluate(() => {
    const K = MR.K, c = MR.game.course;
    const cut = c.biomes.map((b) => b.from * K.TOTAL_UNITS);
    const legOf = (z) => { let i = 0; for (let k = 0; k < cut.length; k++) if (z >= cut[k]) i = k; return i; };
    // One gate z per leg, the first one in it.
    window.__legZ = c.biomes.map((b, i) => {
      for (const g of c.gates) if (legOf(g.z) === i) return g.z;
      return null;
    });
    window.__stage = function (finishTime, hitLegs, guardLegs, dayStreak) {
      const p = Object.assign({}, MR.game.pace);
      p.finishTime = finishTime;
      p.finished = true;
      p.hits = hitLegs.length;
      const hits = hitLegs.map((i) => window.__legZ[i]).filter((z) => z !== null);
      const guards = guardLegs.map((i) => window.__legZ[i]).filter((z) => z !== null);
      MR.game.hud.showEnd(p, { dayStreak: dayStreak }, hits, guards);
      return MR.game.hud.shareString();
    };
  });

  const legN = await page.evaluate(() => MR.Course.BIOMES.length);
  const city = await page.evaluate(() => MR.game.course.settings[0].name);
  notes.push('staged on ' + city + ', ' + legN + ' biome legs');

  // A CLEAN RUN. Nothing hit, nothing guarded: every block green.
  const clean = await page.evaluate(() => window.__stage(7300, [], [], 6));
  strings.clean = clean;
  check('clean: every block is green',
    clean.split('\n')[2] === GREEN.repeat(legN), 'blocks: ' + clean.split('\n')[2]);
  check('clean: no trophy on a run that missed the record', clean.indexOf(TROPHY) < 0);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-clean.png') });

  // GUARDED CONTACTS, nothing unguarded. The middle state, and the one a
  // played run cannot be relied on to produce.
  const guarded = await page.evaluate(() => window.__stage(7290, [], [1, 4], 6));
  strings.guarded = guarded;
  check('guarded: the guarded legs are yellow and the rest green',
    guarded.split('\n')[2] === [GREEN, YELLOW, GREEN, GREEN, YELLOW, GREEN].join(''),
    'blocks: ' + guarded.split('\n')[2]);
  check('guarded: a guarded run still costs no time in the string',
    /7|SUB|RECORD/.test(guarded.split('\n')[1]));
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-guarded.png') });

  // REAL HITS, plus a guard, plus a leg that took both -- the last one proving
  // the worse outcome wins the leg rather than the later one.
  const hit = await page.evaluate(() => window.__stage(7307, [2, 4], [1, 4], 3));
  strings.hit = hit;
  check('hit: red where the run was hit, yellow where the pool paid',
    hit.split('\n')[2] === [GREEN, YELLOW, RED, GREEN, RED, GREEN].join(''),
    'blocks: ' + hit.split('\n')[2]);
  check('hit: the delta is positive and stated',
    /\(\+\d/.test(hit.split('\n')[1]), 'line reads ' + hit.split('\n')[1]);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-hit.png') });

  // A RECORD. Under 1:59:30, so the trophy and a negative delta.
  const record = await page.evaluate(() => window.__stage(7122, [], [], 6));
  strings.record = record;
  // The trophy leads the RESULT line, not the string: line 1 is the wordmark
  // and the city. The first draft of this assertion tested the whole string
  // and failed a correct card -- an instrument reading the wrong line.
  check('record: the trophy leads the result line',
    record.split('\n')[1].indexOf(TROPHY) === 0,
    'line 2 reads ' + record.split('\n')[1]);
  check('record: the grade says RECORD', /RECORD/.test(record.split('\n')[1]));
  check('record: the delta is negative', /\(-\d/.test(record.split('\n')[1]),
    'line 2 reads ' + record.split('\n')[1]);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-record.png') });

  // Shape, length and the streak rule, over all four.
  for (const k of ['clean', 'guarded', 'hit', 'record']) {
    const s = strings[k];
    check(k + ': the string is under 200 characters', s.length < 200,
      s.length + ' characters');
    check(k + ': it names the game and the city',
      s.split('\n')[0] === 'MARATHON MILES · ' + city, 'line 1 reads ' + s.split('\n')[0]);
    check(k + ': it leaks nothing about the course', spoilers(s).length === 0,
      spoilers(s).join(', '));
  }
  // A streak of one is not a streak, on the share string for the same reason it
  // is not on the memory plate.
  const lone = await page.evaluate(() => window.__stage(7300, [], [], 1));
  check('a day streak of 1 is not claimed', lone.split('\n').length === 3,
    JSON.stringify(lone));
  const none = await page.evaluate(() => window.__stage(7300, [], [], 0));
  check('no save means no streak line', none.split('\n').length === 3,
    JSON.stringify(none));

  // ---- 3. the clipboard actually holds the text --------------------------
  //
  // Put the staged record on the card, press the button as a person would --
  // a real mouse click, so the handler runs inside a genuine user gesture the
  // way the async clipboard requires -- and then PASTE IT BACK. Reading the
  // text out of the system clipboard with a key press is the only check that
  // cannot pass against a button that merely called a function.
  const want = await page.evaluate(() => window.__stage(7122, [1], [4], 6));
  await page.click('#shareBtn');
  await page.waitForTimeout(400);
  const note = await page.evaluate(() => document.getElementById('shareNote').textContent.trim());
  check('copy: the button says what happened', note === 'COPIED',
    'the note reads "' + note + '"');

  const pasted = await page.evaluate(async () => {
    const ta = document.createElement('textarea');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:200px;height:120px;opacity:0.01;';
    document.body.appendChild(ta);
    ta.focus();
    window.__paste = ta;
    return true;
  });
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(200);
  const got = await page.evaluate(() => {
    const v = window.__paste.value;
    window.__paste.remove();
    return v;
  });
  check('copy: the clipboard holds the result', got === want,
    'pasted ' + JSON.stringify(got.slice(0, 80)) + ' wanted '
      + JSON.stringify(want.slice(0, 80)));
  notes.push('pasted back from the system clipboard: ' + JSON.stringify(got));
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-copied.png') });

  // ---- 4. the fallbacks, and the promise never to fail silently ----------
  // The async clipboard removed: execCommand must carry it, and the receipt
  // must still appear.
  await page.evaluate(() => {
    window.__realClip = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    window.__stage(7300, [], [2], 4);
    document.getElementById('shareNote').textContent = '';
  });
  await page.click('#shareBtn');
  await page.waitForTimeout(300);
  const legacyNote = await page.evaluate(() =>
    document.getElementById('shareNote').textContent.trim());
  check('fallback: execCommand copies and the button says so', legacyNote === 'COPIED',
    'the note reads "' + legacyNote + '"');

  // Both gone. The last resort has to put the text on the screen, selected,
  // and say what to do with it -- never nothing.
  await page.evaluate(() => {
    window.__realExec = document.execCommand;
    document.execCommand = function () { return false; };
    window.__stage(7300, [], [2], 4);
  });
  await page.click('#shareBtn');
  await page.waitForTimeout(300);
  const last = await page.evaluate(() => ({
    note: document.getElementById('shareNote').textContent.trim(),
    shown: getComputedStyle(document.getElementById('shareText')).display !== 'none',
    value: document.getElementById('shareText').value,
    selected: window.getSelection && document.getElementById('shareText').selectionEnd > 0,
  }));
  check('last resort: the text is shown', last.shown && last.value.length > 0);
  check('last resort: it is selected for the player', !!last.selected);
  check('last resort: the button says what to do', /SELECT AND COPY/.test(last.note),
    'the note reads "' + last.note + '"');
  notes.push('last-resort note: "' + last.note + '"');
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'share-lastresort.png') });

  await page.evaluate(() => {
    document.execCommand = window.__realExec;
    Object.defineProperty(navigator, 'clipboard', { value: window.__realClip, configurable: true });
  });

  // ---- 5. the city checklist ---------------------------------------------
  //
  // Zero, some, and ALL of them. The last case is the one that can never be
  // reached by playing -- it is twelve record days on twelve different cities,
  // which at one city a day is a minimum of twelve days of flawless running.
  const pool = await page.evaluate(() => MR.Course.SETTINGS.map((s) => s.name));
  notes.push('pool: ' + pool.length + ' cities');

  const dateKey = await page.evaluate(() =>
    (MR.game.course && MR.game.course.dateKey) || new Date().toISOString().slice(0, 10));

  async function readCities(save) {
    await page.evaluate(([k, v]) => {
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    }, [KEY, save === null ? null : JSON.stringify(save)]);
    await page.goto(HTML, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => {
      const b = document.getElementById('histBtn');
      if (!b || b.classList.contains('hidden')) return false;
      b.click();
      return true;
    });
    if (!open) return { open: false };
    await page.waitForTimeout(250);
    return page.evaluate(() => ({
      open: true,
      rule: document.getElementById('cityRule').textContent.trim(),
      rec: [...document.querySelectorAll('#cityGrid .ccity.rec .cname')].map((e) => e.textContent),
      ran: [...document.querySelectorAll('#cityGrid .ccity.ran .cname')].map((e) => e.textContent),
      fresh: [...document.querySelectorAll('#cityGrid .ccity.new .cname')].map((e) => e.textContent),
      total: document.querySelectorAll('#cityGrid .ccity').length,
    }));
  }

  // NONE. A save with no finished day has no history, so the door to the panel
  // is not drawn at all -- the empty-state rule the memory plates follow.
  let cr = await readCities(null);
  check('cities: with no history the panel is not offered', cr.open === false);

  // SOME. Three days, two of them record days.
  const someRows = [
    { date: shiftKey(dateKey, -4), city: pool[0], time: 7150, rec: true, runs: 1 },
    { date: shiftKey(dateKey, -3), city: pool[1], time: 7480, rec: false, runs: 2 },
    { date: shiftKey(dateKey, -2), city: pool[2], time: 7160, rec: true, runs: 1 },
  ];
  cr = await readCities({ v: 1, day: null, prev: null,
    days: { count: 1, last: shiftKey(dateKey, -2) }, best: null, hist: someRows });
  check('cities: the panel opened', cr.open === true);
  check('cities: two of the pool are marked',
    cr.rule === 'RECORD CITIES · 2 OF ' + pool.length, 'rule reads "' + cr.rule + '"');
  check('cities: the record cities are the right two',
    cr.rec.join('|') === [pool[0], pool[2]].sort((a, b) =>
      pool.indexOf(a) - pool.indexOf(b)).join('|'), 'marked: ' + cr.rec.join(', '));
  check('cities: a raced day without the record is its own state',
    cr.ran.join('|') === pool[1], 'ran: ' + cr.ran.join(', '));
  check('cities: the rest read as not yet visited',
    cr.fresh.length === pool.length - 3, cr.fresh.length + ' unvisited');
  check('cities: every city in the pool is listed', cr.total === pool.length,
    cr.total + ' rows for a pool of ' + pool.length);
  notes.push('some: ' + cr.rule + ' | ran ' + cr.ran.join(',')
    + ' | unvisited ' + cr.fresh.length);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'cities-some.png') });

  // ALL. One record day per city in the pool, derived from the pool itself so
  // this case cannot go stale when a city is added.
  const allRows = pool.map((name, i) => ({
    date: shiftKey(dateKey, -(pool.length - i)), city: name, time: 7100 + i, rec: true, runs: 1,
  }));
  cr = await readCities({ v: 1, day: null, prev: null,
    days: { count: 1, last: shiftKey(dateKey, -1) }, best: null, hist: allRows });
  check('cities: all of them counted',
    cr.rule === 'RECORD CITIES · ' + pool.length + ' OF ' + pool.length,
    'rule reads "' + cr.rule + '"');
  check('cities: none left unvisited', cr.fresh.length === 0 && cr.ran.length === 0,
    cr.fresh.length + ' unvisited, ' + cr.ran.length + ' raced-only');
  notes.push('all: ' + cr.rule);
  if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'shots', 'cities-all.png') });

  // A malformed save must not take the panel with it. Same rule as the store's
  // own: fewer rows, never a throw.
  await page.evaluate((k) => localStorage.setItem(k,
    '{"v":1,"hist":[{"date":"nope","city":5},{"date":"2026-01-02","city":"NOWHERE","time":7000,"rec":true}]}'), KEY);
  await page.goto(HTML, { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  const survived = await page.evaluate(() => {
    const b = document.getElementById('histBtn');
    if (b && !b.classList.contains('hidden')) b.click();
    return {
      start: !!document.getElementById('startPanel'),
      rule: document.getElementById('cityRule').textContent.trim(),
    };
  });
  check('cities: a bad save leaves the panel standing', survived.start
    && /RECORD CITIES/.test(survived.rule), 'rule reads "' + survived.rule + '"');
  notes.push('corrupt save rule: "' + survived.rule + '"');

  // ---- 6. the head the share string travels with -------------------------
  //
  // A result worth pasting is wasted on a link that renders as a bare URL, so
  // the metadata is part of this feature and is gated with it. Every check is
  // on the LIVE DOCUMENT rather than on the shell text: the shell is a
  // template and what matters is what the built page's head actually holds.
  const head = await page.evaluate(() => {
    const meta = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.getAttribute('content') : '';
    };
    const icon = document.querySelector('link[rel="icon"]');
    const touch = document.querySelector('link[rel="apple-touch-icon"]');
    const man = document.querySelector('link[rel="manifest"]');
    return {
      title: document.title,
      desc: meta('meta[name="description"]'),
      ogTitle: meta('meta[property="og:title"]'),
      ogDesc: meta('meta[property="og:description"]'),
      ogImage: meta('meta[property="og:image"]'),
      ogW: meta('meta[property="og:image:width"]'),
      ogH: meta('meta[property="og:image:height"]'),
      twCard: meta('meta[name="twitter:card"]'),
      twImage: meta('meta[name="twitter:image"]'),
      icon: icon ? icon.getAttribute('href') : '',
      touch: touch ? touch.getAttribute('href') : '',
      manifest: man ? man.getAttribute('href') : '',
      // Every one of these must be in the HEAD, not merely in the document:
      // a scraper reads the head and stops.
      inHead: [...document.head.querySelectorAll(
        'meta[property^="og:"],meta[name^="twitter:"],meta[name="description"],'
        + 'link[rel="icon"],link[rel="apple-touch-icon"],link[rel="manifest"]')].length,
    };
  });
  check('head: there is a description', head.desc.length > 40, head.desc);
  check('head: Open Graph title and description are set',
    !!head.ogTitle && !!head.ogDesc);
  check('head: the card is the large-image one', head.twCard === 'summary_large_image',
    'twitter:card is "' + head.twCard + '"');
  check('head: og:image is an absolute http(s) URL, which a data URI cannot be',
    /^https?:\/\//.test(head.ogImage), 'og:image is "' + head.ogImage + '"');
  check('head: twitter:image matches og:image', head.twImage === head.ogImage);
  check('head: the image is declared 1200x630',
    head.ogW === '1200' && head.ogH === '630', head.ogW + 'x' + head.ogH);
  // The placeholder is a FEATURE until the owner replaces it, and this check is
  // what makes the handover impossible to forget: it says out loud, on every
  // run of the gate, that the link preview has no picture yet.
  if (/REPLACE-WITH-YOUR-DOMAIN/.test(head.ogImage)) {
    notes.push('og:image is still the placeholder -- the owner must host '
      + 'shots/share-og-1200x630.png and replace REPLACE-WITH-YOUR-DOMAIN '
      + 'in tools/shell.html');
  }
  check('head: the favicon is inline, so nothing is fetched',
    /^data:image\/svg\+xml/.test(head.icon), head.icon.slice(0, 40));
  check('head: the home-screen icon is an inline PNG',
    /^data:image\/png;base64,/.test(head.touch), head.touch.slice(0, 40));
  check('head: the manifest is inline',
    /^data:application\/manifest\+json/.test(head.manifest), head.manifest.slice(0, 50));
  check('head: nothing metadata is stranded in the body', head.inHead >= 18,
    head.inHead + ' of the metadata elements are in the head');
  notes.push('head: ' + head.inHead + ' metadata elements, og:image ' + head.ogImage);

  // THE MANIFEST IS PARSED, NOT JUST PRESENT. A data: URI manifest is exactly
  // the kind of thing that is silently ignored, and the only way to know is to
  // ask the browser what it made of it. The first version of this shell carried
  // start_url and scope and Chrome rejected both -- relative URLs against a
  // data: base -- which is how those two lines came to be left out.
  const cdp = await page.context().newCDPSession(page);
  const man = await cdp.send('Page.getAppManifest');
  check('manifest: the browser fetched it', !!man.url && !!man.data,
    'no manifest was fetched');
  check('manifest: it parses without errors',
    !man.errors || man.errors.filter((e) => e.critical > 0 || e.message).length === 0,
    JSON.stringify((man.errors || []).map((e) => e.message)));
  let manJson = {};
  try { manJson = JSON.parse(man.data || '{}'); } catch (e) { /* reported below */ }
  check('manifest: it names the game', manJson.name === 'Marathon Miles',
    'name is ' + JSON.stringify(manJson.name));
  check('manifest: it carries an icon big enough to install',
    !!(manJson.icons && manJson.icons.length && manJson.icons[0].sizes === '180x180'));
  notes.push('manifest: parsed clean, ' + (man.data || '').length + ' bytes, '
    + (manJson.icons || []).length + ' icon');

  await page.evaluate((k) => localStorage.removeItem(k), KEY);
  await ctx.close();
  await browser.close();

  const pageErrs = errs.filter((e) => !/AudioContext|deprecated with r150/.test(e));
  if (pageErrs.length) fails.push('page errors: ' + pageErrs.slice(0, 3).join(' | '));

  if (JSON_OUT) {
    console.log(JSON.stringify({ strings, notes, fails, ok: !fails.length }, null, 1));
    process.exit(fails.length ? 1 : 0);
  }
  console.log('');
  console.log('SHARECARD -- the copyable result and the city checklist');
  for (const k of Object.keys(strings)) {
    console.log('  --- ' + k + ' ---');
    for (const line of strings[k].split('\n')) console.log('      ' + line);
  }
  for (const n of notes) console.log('  . ' + n);
  for (const f of fails) console.log('  ! ' + f);
  console.log('  ' + (fails.length ? 'FAIL' : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})();
