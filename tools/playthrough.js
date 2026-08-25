#!/usr/bin/env node
/**
 * PLAYTHROUGH: run a whole race in the real page and report what happened.
 *
 *   node tools/playthrough.js                        today, the default policy
 *   node tools/playthrough.js --surge hold1          a named spend policy
 *   node tools/playthrough.js --effort 0             the game before the pool
 *   node tools/playthrough.js --date 2026-03-14      a named day
 *   node tools/playthrough.js --all                  every policy, side by side
 *
 * ---- WHY THIS FILE EXISTS -------------------------------------------------
 *
 * Standing rule 2: verify against the running page, never the build. Every
 * number the effort work produced before this file came out of node harnesses
 * -- tools/simulate.js models the race, tools/risk.js drives the shipped
 * modules but not the shipped PAGE -- and the one question none of them can
 * answer is whether the thing a person loads in a browser does what the model
 * says. A pool that fills, a guard that spends and a surge that is elected are
 * three claims about main.js, hud.js and player.js wired together, and wiring
 * is exactly what a module-level harness cannot see.
 *
 * It found two things on the first run that nothing else could have:
 *
 *   1. The ?skip= fast-forward in main.js never called resolveAid or
 *      resolveSurge, so every fast-forwarded race collected nothing, elected
 *      nothing, and finished with an empty tank. Every ?skip= frame in the
 *      shot library was a picture of a game with the mechanic switched off.
 *   2. The autopilot scored lanes on CLEAR, aid and ramp and had no term for
 *      the marked lane, so it took a surge only by coincidence.
 *
 * Both are the same defect as the one that stopped the previous attempt at
 * this work: THE BOT COULD NOT SEE THE MECHANIC, so every measurement of the
 * mechanic came back zero and was believable.
 *
 * ---- HOW IT PLAYS ---------------------------------------------------------
 *
 * ?skip= a whole marathon. The fast-forward loop is the live loop's own
 * sequence -- handle, elect, step, deck, gates, aid -- so this is the game
 * playing itself at speed rather than a second simulation of it, and it stops
 * on pace.finished exactly as the live loop does. Nothing is rendered, which
 * is why a full race costs seconds instead of two hours.
 *
 * The rendering path is still exercised once, at boot, before the skip: a page
 * that throws does not get to report a finish time.
 */
const { chromium } = require('playwright');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'index.html');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : (i >= 0 ? '1' : def);
}
const has = (n) => process.argv.indexOf('--' + n) >= 0;

const DATE = arg('date', '');
const SKILL = arg('bot', '1');
const EFFORT = arg('effort', '1');
const ALL = has('all');
// LINE policies now, not spend policies. ?surge= named which zones to elect;
// the surge is gone and ?line= names how the bot reads the paint. See main.js.
const POLICIES = ALL
  ? ['ignore', 'all', 'green', 'red', 'safe', 'greedy']
  : [arg('line', 'all')];

function clock(sec) {
  if (!isFinite(sec)) return '--:--';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

(async () => {
  // Same executable the rest of the toolchain pins, and pinned for the same
  // reason: a tool that silently picks a different browser is measuring a
  // different page from the one shoot.js passed.
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const rows = [];
  let record = 0, thrown = null;
  try {
    for (const pol of POLICIES) {
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      page.on('pageerror', (e) => { thrown = String(e); });
      const q = [
        'bot=' + SKILL, 'nocount=1', 'nosave=1', 'effort=' + EFFORT,
        'line=' + pol, 'skip=9000',
      ].concat(DATE ? ['date=' + DATE] : []).join('&');
      await page.goto('file://' + FILE + '?' + q);
      await page.waitForFunction('window.MR && MR.game && MR.game.ready', null, { timeout: 180000 });
      const r = await page.evaluate(() => {
        const p = MR.game.pace, c = MR.game.course, K = MR.K;
        return {
          finished: p.finished, finish: p.finishTime, race: p.raceTime,
          hits: p.hits, guards: p.guards, aid: p.aid, wasted: p.wasted,
          pool: p.pool, streak: p.bestStreak, gates: p.gatesSeen,
          total: K.TOTAL_UNITS, record: K.RECORD_SECONDS,
          // The mats and the roof, from the same live page. A mechanic that is
          // not in this table is a mechanic this file is not verifying, which
          // is the whole reason it exists.
          liftUnits: p.liftUnits, dragUnits: p.dragUnits,
          mats: (c.tempo || []).length,
          lifts: (c.tempo || []).filter((m) => m.dir > 0).length,
          drags: (c.tempo || []).filter((m) => m.dir < 0).length,
          matUnits: (c.tempo || []).reduce((a, m) => a + (m.z1 - m.z0), 0),
          ramps: (c.ramps || []).length,
          cones: (c.ramps || []).filter((r) => r.cone).length,
          pairs: (c.gates || []).filter((g) => g.ramp2 !== undefined).length,
          aidOnCourse: (c.aid || []).length,
          aidRoof: (c.aid || []).filter((a) => a.roof).length,
          effort: MR.Pace.EFFORT, narrow: MR.Course.NARROW,
          poolMax: MR.Pace.EFFORT_CFG.POOL_MAX,
          courseGates: c.gates.length, valid: c.valid.ok, why: c.valid.why || null,
        };
      });
      if (thrown) throw new Error('the page threw: ' + thrown);
      record = r.record;
      rows.push([pol, r]);
      if (rows.length === 1) {
        console.log(`\ncourse   ${r.courseGates} gates, valid=${r.valid}, ` +
          `EFFORT ${r.effort}, NARROW ${r.narrow}`);
        console.log(`aid      ${r.aidOnCourse} items on course, ${r.aidRoof} on roofs`);
        console.log(`pool     cap ${r.poolMax}, one spend: guard. A segment absorbs one contact.`);
        console.log(`mats     ${r.mats} tempo mats (${r.lifts} forward, ${r.drags} backward), ` +
          `${Math.round(r.matUnits)}u of painted lane`);
        console.log(`roof     ${r.ramps} rideable decks, ${r.cones} carrying a cone, ` +
          `${r.pairs} gates with two decks side by side`);
        console.log('');
        console.log('policy    finish     vs rec   hits  guards   aid  wasted  ' +
          '  left  streak    lift    drag');
      }
      const vs = r.finish - r.record;
      console.log(
        pol.padEnd(9) +
        (r.finished ? clock(r.finish) : 'DNF ' + clock(r.race)).padStart(8) +
        (vs <= 0 ? '  ' : '  +') + Math.round(vs) + 's'.padEnd(1) +
        String(r.hits).padStart(vs <= 0 ? 8 : 7) +
        String(r.guards).padStart(8) +
        String(r.aid).padStart(6) +
        String(r.wasted).padStart(8) +
        r.pool.toFixed(1).padStart(7) +
        String(r.streak).padStart(8) +
        (Math.round(r.liftUnits) + 'u').padStart(8) +
        (Math.round(r.dragUnits) + 'u').padStart(8));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ---- the assertions ----------------------------------------------------
  //
  // Not decoration. This file exists because a harness that cannot see a
  // mechanic reports zero and is believed, so it fails on exactly that.
  let fail = 0;
  const bad = (m) => { fail++; console.log('  ! ' + m); };
  console.log('');
  const byName = Object.fromEntries(rows);
  for (const [pol, r] of rows) {
    if (!r.finished) bad(`${pol}: did not finish`);
    if (!r.valid) bad(`${pol}: course invalid`);
  }
  if (EFFORT !== '0') {
    if (byName.all) {
      if (byName.all.aid <= 0) bad('the bot collected NO aid -- the pool can never fill');
      if (byName.all.liftUnits <= 0) bad('the bot ran NO forward mat -- it cannot see the paint');
    }
    /**
     * ---- THE SURGE ASSERTIONS THAT STOOD HERE, AND WHY THEY ARE GONE -----
     *
     * Three of them, all about the elected zone, all removed with it:
     *
     *   1. "the bot elected NO surge -- it cannot see the zones", the
     *      blindness check roadmap 67 added after every bot in the project
     *      turned out to score CLEAR, aid and ramp and nothing else. Its
     *      replacement is directly above: the bot must run some forward mat,
     *      which is the same check one mechanic along.
     *   2. COINCIDENTAL SURGE, printed every run: what share of marked road a
     *      bot that does not seek it lands on anyway (40-48%, above the 33% of
     *      three lanes, because the marked lane was guaranteed non-BLOCK). It
     *      has no analogue here -- a mat is not elected, it is simply the lane
     *      you are in -- and the question it asked, what share of the paint is
     *      decoration, is now answered by tools/simulate.js's policy spread.
     *   3. THE TWO SPEND ASSERTIONS: that the best spend policy beats never
     *      seeking, and that WHICH zones you buy is worth 10 s between the
     *      best and worst allocation. Together they were the proof that an
     *      allocation existed. There is no allocation now.
     *
     * WHAT REPLACES ALL THREE is the same question asked of the LINE rather
     * than of the tank, and it is asked where it belongs -- tools/simulate.js
     * sweeps eight line policies across five skills and fails the build if the
     * spread falls under 15 s. That is the assertion docs/risk-reward.md
     * demands, because before this game had two rival spends six policies
     * finished within 0.0 s of each other.
     */
    if (byName.ignore && byName.all) {
      const d = byName.ignore.finish - byName.all.finish;
      if (d <= 0) {
        bad(`reading the paint cost ${(-d).toFixed(1)}s against ignoring it ` +
          '-- the mats buy nothing on a real run');
      } else {
        console.log(`  ok  reading the paint is worth ${d.toFixed(1)}s over ignoring it, ` +
          `on ${Math.round(byName.all.liftUnits)}u of lift and ` +
          `${Math.round(byName.all.dragUnits)}u of drag`);
      }
    }
  }
  console.log(fail ? `\nFAIL  ${fail} problem(s)` : '\nPASS  played end to end in the real page');
  process.exit(fail ? 1 : 0);
})();
