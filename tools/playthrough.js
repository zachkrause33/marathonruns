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
const POLICIES = ALL
  ? ['none', 'all', 'hold1', 'hold2', 'late', 'every2']
  : [arg('surge', 'all')];

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
        'surge=' + pol, 'skip=9000',
      ].concat(DATE ? ['date=' + DATE] : []).join('&');
      await page.goto('file://' + FILE + '?' + q);
      await page.waitForFunction('window.MR && MR.game && MR.game.ready', null, { timeout: 180000 });
      const r = await page.evaluate(() => {
        const p = MR.game.pace, c = MR.game.course, K = MR.K;
        const zones = (c.surges || []).map((s) => ({
          n: s.n, z0: Math.round(s.z0), len: Math.round(s.z1 - s.z0), lane: s.lane,
        }));
        return {
          finished: p.finished, finish: p.finishTime, race: p.raceTime,
          hits: p.hits, guards: p.guards, aid: p.aid, wasted: p.wasted,
          pool: p.pool, streak: p.bestStreak, gates: p.gatesSeen,
          surgeUnits: p.surgeUnits, total: K.TOTAL_UNITS, record: K.RECORD_SECONDS,
          zones, zoneUnits: zones.reduce((a, z) => a + z.len, 0),
          aidOnCourse: (c.aid || []).length,
          aidRoof: (c.aid || []).filter((a) => a.roof).length,
          aidInZone: (c.aid || []).filter((a) => c.surgeZoneAt && c.surgeZoneAt(a.z)).length,
          effort: MR.Pace.EFFORT, narrow: MR.Course.NARROW,
          poolMax: MR.Pace.SURGE.POOL_MAX, burn: MR.Pace.SURGE.BURN_UNITS,
          courseGates: c.gates.length, valid: c.valid.ok, why: c.valid.why || null,
        };
      });
      if (thrown) throw new Error('the page threw: ' + thrown);
      record = r.record;
      rows.push([pol, r]);
      if (rows.length === 1) {
        console.log(`\ncourse   ${r.courseGates} gates, valid=${r.valid}, ` +
          `EFFORT ${r.effort}, NARROW ${r.narrow}`);
        console.log(`zones    ${r.zones.length}, ${r.zoneUnits}u of marked road ` +
          `(${(100 * r.zoneUnits / r.total).toFixed(1)}% of the course)`);
        for (const z of r.zones) {
          console.log(`  zone ${z.n}  z ${String(z.z0).padStart(5)}  ` +
            `${z.len}u  lane ${z.lane}  (${(100 * z.z0 / r.total).toFixed(0)}% in)`);
        }
        console.log(`aid      ${r.aidOnCourse} items on course, ${r.aidRoof} on roofs, ` +
          `${r.aidInZone} inside a marked zone`);
        console.log(`pool     cap ${r.poolMax}, 1 segment per ${r.burn}u, so a full tank ` +
          `buys ${r.poolMax * r.burn}u of marked road`);
        console.log('');
        console.log('policy    finish     vs rec   hits  guards   aid  wasted  ' +
          'surged   left  streak');
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
        (Math.round(r.surgeUnits) + 'u').padStart(8) +
        r.pool.toFixed(1).padStart(7) +
        String(r.streak).padStart(8));
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
      if (byName.all.surgeUnits <= 0) bad('the bot elected NO surge -- it cannot see the zones');
      if (byName.all.aid <= 0) bad('the bot collected NO aid -- the pool can never fill');
    }
    // ---- COINCIDENTAL SURGE IS A FINDING, NOT A FAILURE -------------------
    //
    // surge=none does not avoid the marked lane, it simply does not seek it --
    // and with three lanes it lands there about a third of the time by
    // accident. That number is worth printing every run rather than asserting
    // away, because it IS the marking contract's hardest number: the fraction
    // of marked road a player gets without deciding anything is the fraction
    // over which the paint is decoration. What must hold is that seeking beats
    // not seeking by a wide margin.
    if (byName.none && byName.all) {
      const co = 100 * byName.none.surgeUnits / byName.none.zoneUnits;
      console.log(`  --  coincidental surge (surge=none): ${co.toFixed(0)}% of marked road, ` +
        `against ${(100 * byName.all.surgeUnits / byName.all.zoneUnits).toFixed(0)}% when sought`);
      if (byName.all.surgeUnits < byName.none.surgeUnits * 1.3) {
        bad('seeking the marked lane barely beats ignoring it -- the election is not a choice');
      }
      const d = byName.none.finish - byName.all.finish;
      if (d <= 0) bad(`surging cost ${(-d).toFixed(1)}s instead of saving time`);
      else console.log(`  ok  surging every zone is worth ${d.toFixed(1)}s over never seeking one`);
    }
  }
  console.log(fail ? `\nFAIL  ${fail} problem(s)` : '\nPASS  played end to end in the real page');
  process.exit(fail ? 1 : 0);
})();
