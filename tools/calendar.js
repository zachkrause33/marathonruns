#!/usr/bin/env node
/**
 * THE FAIRNESS HARNESS, ACROSS THE CALENDAR.
 *
 *   node tools/calendar.js                 the gate: 32 days walked, 6 raced
 *   node tools/calendar.js --days 90       agree with course-test.js's sample
 *   node tools/calendar.js --full          all 365
 *   node tools/calendar.js --date 2026-09-06   one named day, raced end to end
 *   node tools/calendar.js --deep 12       race more of the sampled days
 *   node tools/calendar.js --json          machine-readable
 *
 * Exit code is non-zero if any day fails, or if any page threw or warned.
 *
 * ---- WHY THIS FILE EXISTS ------------------------------------------------
 *
 * tools/shoot.js is the fairness gate. CLAUDE.md rule 4 says so, and it fails
 * the build on LOW, HIDES, BLANKS, PAINTS and hazard contrast, which is
 * exactly right. It also photographs ONE DATE -- whatever day it is run on,
 * with a query string that has never carried `date` -- and everything it
 * asserts is therefore asserted about one course out of 365.
 *
 * That is not a theoretical gap. Pointed at `?date=2026-09-06&skip=46`,
 * shipped code failed LOW and HIDES: Chicago's quayside crane stood its
 * containers at world x 1.80-8.20 against a CORRIDOR_HALF of 3.75, at road
 * level up to y 5.5, hiding a JUMP 38 units out -- and painted 0x37d6ff, hue
 * 192.3 degrees, 1.7 degrees off DUCK cyan. It shipped, and it shipped GREEN,
 * because no shot had ever been taken on a day that draws it.
 *
 * It is the second time. docs/roadmap.md records a tree crossing the corridor
 * at y 7.74 that the six default shots never sampled, and that entry already
 * drew the conclusion for the OTHER axis: "six shots is a thin sample of a
 * 6,293-unit course, and a green suite that has not visited most of the road
 * is a more dangerous object than a red one." The same sentence is true with
 * "course" replaced by "calendar" and nobody had written it down.
 *
 * The calendar is worse than the course, because the course generator draws
 * 3-4 named settings per day out of twelve. WHOLE SET PIECES ONLY EXIST ON
 * SOME DAYS -- the viaduct that prompted this appears on 66 of 365 -- so a
 * single-date harness cannot see most of the game's content however many
 * skips it takes. tools/motion.js hit the identical wall and grew --date.
 *
 * ---- THE THING NOBODY HAD MEASURED: THE CALENDAR HAS NO STRUCTURE ---------
 *
 * The obvious sample is "spread the days across the year". It buys nothing.
 * Nothing under src/ reads a month, a season or a day of the week: `date` is
 * hashed into an RNG seed by MR.rng.dateKey and that is the whole of its
 * effect. So a day is a SEED, days are exchangeable, and "well spread across
 * the year" and "the first N of the year" are the same sample with different
 * decoration. Any argument for one over the other has to be made on coverage
 * of CONTENT, not of dates.
 *
 * So the enumeration is course-test.js's, exactly: day i is 2026-01-01 plus i
 * days, and the sample is the first N. Three things follow, all of them worth
 * more than spread:
 *
 *   NESTED    --days 32 is a prefix of --days 90 is a prefix of --full. A
 *             failure found by a big run is reproducible by a small one, and
 *             the day index means the same thing in both.
 *   SHARED    course-test.js already proves days 0..89 solvable. This file
 *             audits a prefix of the same list, so "day 37" is one course
 *             across both tools rather than two.
 *   HONEST    a fixed prefix is a fixed sample and can miss what a random one
 *             would catch. The answer is not to randomise (which is not
 *             reproducible) but to size the prefix against a measured
 *             saturation curve and then run the whole year at least once.
 *             Both are below.
 *
 * ---- HOW BIG, AND THE NUMBER IT COMES FROM -------------------------------
 *
 * The coverage axis that matters is not "days" and not "settings" either. A
 * setting draws different content depending on which biome leg it lands on --
 * CHICAGO on a RIVERSIDE leg is the quay and the crane, CHICAGO on PARKLAND is
 * not -- so the unit is the (setting, biome) PAIR. There are 12 x 6 = 72 of
 * them and all 72 occur within a year. Walking the prefix:
 *
 *      8 days   11/12 settings   45/72 pairs
 *     16 days   12/12 settings   65/72 pairs
 *     24 days   12/12 settings   69/72 pairs
 *     32 days   12/12 settings   72/72 pairs      <- saturates here
 *     90 days   12/12 settings   72/72 pairs
 *
 * 32 is therefore the smallest prefix that stands on every piece of ground the
 * game can generate, and it is where the default sits. The tool prints the
 * pairs and the named-scenery census it actually reached on every run, so the
 * claim is checkable against the run rather than against this comment -- which
 * is the failure mode docs/roadmap.md lists four times.
 *
 * ---- TWO LAYERS, AND WHAT EACH ONE GUARANTEES ----------------------------
 *
 * The full eight-shot photographic suite on 32 days would be far too slow, and
 * a gate nobody runs is worse than no gate. The four assertions are not
 * equally expensive, so they are not run equally often.
 *
 *   WALK   (every sampled day, all 6,293 units, no camera, no pixels)
 *          LOW alone. "Nothing reaches back over the carriageway below
 *          OVERHEAD_Y" is a statement in world space about the scenery, with
 *          no lens in it, so it can be asked of the WHOLE COURSE instead of a
 *          frame: stub the draw, stream world.update() forward in 150-unit
 *          steps, walk crossings() at each. About 2.0 s a day, of which 1.8 s
 *          is loading the page.
 *
 *          THE GUARANTEE IS NEARLY ALL OF IT, and that is not luck. shoot.js's
 *          own header states why LOW is the load-bearing half: the eye is at
 *          2.62 and OVERHEAD_Y is 9.0, so anything obeying LOW projects above
 *          everything a hazard can occupy and HIDES cannot then fire. LOW is
 *          what makes occlusion by scenery POSSIBLE. The crane failed LOW
 *          first and HIDES only in consequence.
 *
 *   RACE   (a nested sub-sample, the whole race, real camera, no pixels)
 *          all four, plus contrast. The autopilot runs the day from the gun to
 *          the tape on a hand-pumped clock with renderer.render stubbed --
 *          tools/footroom.js's trick -- so every spring, filter and lane
 *          change in camera.js is the one that ships and nothing is drawn.
 *          The audit is the SAME CODE shoot.js runs, out of tools/lib, called
 *          every 2 seconds of simulation: at 26.7 units of road per second
 *          that is a sample every 53 units, comfortably inside the 210-unit
 *          spawn distance, so the race covers the whole course too and does it
 *          with a lens. About 6 s a day.
 *
 *          BLANKS is why this layer has to exist at all. Hazard-on-hazard
 *          occlusion is a fact about GATE LAYOUT, which is the most per-date
 *          thing in the game, and it cannot be computed without the camera's
 *          real lateral position.
 *
 * CONTRAST rides on RACE and is charged per (setting, biome) pair rather than
 * per day, because that is what it is a function of: the palette. The first
 * time a race enters a pair it renders the audit swatches and never again.
 *
 * PORTRAIT, for RACE. shoot.js's 07-wall-tall note establishes that the
 * portrait frame is the strictly harder case for BLANKS -- the lens follows
 * 0.95 of the runner's lane offset against a desktop's 0.78, so it sits very
 * nearly IN his lane and there is no parallax left to open a sightline. The
 * stricter case is also the one most people play in.
 *
 * ---- WHAT THIS DOES NOT COVER, SAID OUT LOUD -----------------------------
 *
 * The WALK layer is a rest pose. A part that only enters the corridor once its
 * animation runs is tools/motion.js's subject, and that file takes --date for
 * the same reason this file exists. The RACE layer does animate, but only on
 * its sub-sample.
 *
 * Neither layer rasterises the frame, so nothing here can see a defect that is
 * only in the pixels. That is shoot.js's job and shoot.js still has it.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const fairness = require('./lib/fairness');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}
const has = (n) => args.indexOf('--' + n) >= 0;

const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const JSON_OUT = has('json');
const STEP = parseFloat(arg('step', 150));
// Seconds of simulation between sightline samples on a RACE day. 2.0 is 53
// units of road at race pace -- see the header.
const EVERY = parseFloat(arg('every', 2.0));
const NO_CONTRAST = has('no-contrast');

// The enumeration, and it is course-test.js's. See the header.
const EPOCH = String(arg('from', '2026-01-01'));
function dayKey(i) {
  const [y, m, d] = EPOCH.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + i * 86400000);
  return t.toISOString().slice(0, 10);
}

const ONE = arg('date', null);
const FULL = has('full');
const DAYS = ONE ? 1 : (FULL ? 365 : parseInt(arg('days', 32), 10));
// How many of the sampled days get raced. A nested prefix of the same list, so
// --deep 6 is the first six days of --days 32, not a different six.
const DEEP = ONE ? 1 : Math.min(DAYS, parseInt(arg('deep', 6), 10));

const dates = ONE ? [String(ONE)] : Array.from({ length: DAYS }, (_, i) => dayKey(i));

// Which biome a course fraction is in. BIOMES is course.js's and is the same
// every day by design, so it is read off the page rather than duplicated here.
const KIND = ['-', 'JUMP', 'DUCK', 'BLOCK'];

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const report = [];
  let failed = false;
  const censusAll = {};
  const pairsAll = {};
  const settingsAll = {};

  /** One page, reused across days. goto() re-runs main.js with a new date. */
  async function makePage(w, h) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    // Same rule as shoot.js, and the same two benign exceptions. A warning is
    // a failure here too: the collision audit reports through console.warn,
    // and a day on which it fires is exactly the day nobody would look at.
    const BENIGN = /deprecated with r150|AudioContext was not allowed/;
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(t)) {
        errors.push(m.type() + ': ' + t);
      }
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.split('\n')[0]));
    return { ctx, page, errors };
  }

  async function load(page, errors, date) {
    errors.length = 0;
    await page.goto('file://' + FILE + '?bot=1&nocount=1&debug=1&date=' + date, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 })
      .catch(() => { errors.push('MR.game never became ready'); });
  }

  /** The plan every day is judged for coverage against. */
  async function planOf(page) {
    return page.evaluate(() => {
      const c = MR.game.course;
      const out = { settings: c.settings.map((s) => s.tag), pairs: [], gates: c.gates.length };
      const seen = {};
      for (let f = 0; f <= 1; f += 0.002) {
        const b = c.biomes.reduce((acc, x) => (f >= x.from ? x : acc), c.biomes[0]);
        const k = c.settingAt(Math.min(f, 0.99999)).tag + ' / ' + b.name;
        if (!seen[k]) { seen[k] = 1; out.pairs.push(k); }
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ RACE
  // The deep layer. See the header for what it buys and what it costs.
  const raceDates = dates.slice(0, DEEP);
  if (raceDates.length) {
    const { ctx, page, errors } = await makePage(620, 1344);
    for (const date of raceDates) {
      const a = Date.now();
      await load(page, errors, date);
      const plan = await planOf(page).catch(() => null);
      const res = await page.evaluate(async ({ AUDIT, EVERY, CONTRAST }) => {
        const g = MR.game;
        // ---- take the clock, exactly as tools/motion.js does ------------
        //
        // POLLED, not a single guess. motion.js records that a fixed wait
        // captured the callback on one skip in eight, because whether a real
        // frame lands inside the window depends on how busy swiftshader is
        // that second, and a tool whose pass rate depends on machine load is
        // not an instrument.
        let captured = null;
        const realRAF = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = function (cb) { captured = cb; return 1; };
        for (let t = 0; t < 60 && !captured; t++) {
          await new Promise((r) => realRAF(() => r()));
          await new Promise((r) => setTimeout(r, 16));
        }
        if (!captured) return { err: 'never captured the frame callback' };
        let clock = performance.now();
        const realNow = performance.now.bind(performance);
        performance.now = function () { return clock; };

        // Nothing is drawn. The transforms, the springs and the lane changes
        // are untouched; only the rasteriser is gone.
        const realRender = g.renderer.render.bind(g.renderer);
        g.renderer.render = function () { };

        const audit = new Function('return ' + AUDIT)();
        const STEP_MS = 1000 / 60;
        const GAP = Math.max(1, Math.round(EVERY * 60));
        // A hard cap so a course that somehow never finishes cannot hang the
        // sweep. A race is about 236 wall-seconds; 30,000 frames is 500.
        const CAP = 30000;

        const low = {}, hide = {}, blank = [], overlays = {}, contrast = [];
        const seenPair = {};
        let samples = 0, frames = 0, drift = null, envelope = null;
        let minVis = 2, minVisRow = null;
        let lastU = -1, maxGap = 0;

        for (; frames < CAP; frames++) {
          clock += STEP_MS;
          captured(clock);
          if (frames % GAP) continue;
          const r = audit();
          if (r.skipped) return { err: r.skipped };
          samples++;
          if (r.drift) drift = r.drift;
          if (r.envelope && r.envelope.bad && r.envelope.bad.length) envelope = r.envelope.bad;
          const f = g.pace.units / MR.K.TOTAL_UNITS;
          const set = g.course.settingAt(Math.min(0.99999, Math.max(0, f))).tag;
          // THE COORDINATE A FAILURE HAS TO BE REPRODUCIBLE IN.
          //
          // Not the frame count. The pump only takes the clock AFTER the page
          // has run some real frames -- polling for the callback costs up to a
          // second of real time and how much depends on how busy swiftshader
          // is -- so frames/60 is not where the race is. `skip` is read off
          // pace.raceTime, which is the number ?skip= sets, so every row this
          // file prints can be handed straight to shoot.js and motion.js.
          const skip = +(g.pace.raceTime / MR.K.TIME_SCALE).toFixed(1);
          for (const e of r.low) low[e.name + '@' + Math.round(e.z0 / 24)] = { setting: set, skip: skip, e };
          for (const h of r.hide) hide[h.el + '@' + h.gateZ] = { setting: set, skip: skip, h };
          for (const b of r.blank) blank.push(Object.assign({ setting: set, skip: skip, f: +f.toFixed(3) }, b));
          for (const o of r.overlays) overlays[o.name.replace(/#\d+$/, '')] = 1;
          for (const row of r.gateVis) {
            if (row.vis - row.need < minVis) { minVis = row.vis - row.need; minVisRow = Object.assign({ setting: set, skip: skip }, row); }
          }
          // ---- CONTRAST, charged per (setting, biome) pair --------------
          //
          // It is a function of the PALETTE, and the palette is a function of
          // where on the course the runner is, not of the date. Rendering it
          // once per pair instead of once per sample is the difference
          // between 8 offscreen audits a race and 118 of them.
          if (CONTRAST) {
            const b = g.course.biomes.reduce((acc, x) => (f >= x.from ? x : acc), g.course.biomes[0]);
            const key = set + ' / ' + b.name;
            if (!seenPair[key]) {
              seenPair[key] = 1;
              // The swatches are real renders into an offscreen target, so
              // the draw has to come back for the duration.
              g.renderer.render = realRender;
              // performance.now too: three's WebGLRenderer does not read it,
              // but a shader chunk that did would see a frozen clock and the
              // audit would silently measure one animation phase for ever.
              performance.now = realNow;
              try {
                const a2 = g.world.contrastAudit(g.renderer, g.scene);
                contrast.push({ key, hazards: a2.hazards, roads: a2.roads });
              } catch (err) {
                contrast.push({ key, err: String(err && err.message || err) });
              }
              performance.now = function () { return clock; };
              g.renderer.render = function () { };
            }
          }
          // WHERE THE RACE ACTUALLY GOT TO, kept per sample so the coverage
          // claim is a measurement. The RACE layer is only a whole-course
          // audit if consecutive samples are closer together than the spawn
          // distance; at 2 s and race pace that is about 53 units against 210,
          // but "about" is what this project keeps having to retract.
          const u = g.pace.units;
          if (lastU >= 0 && u - lastU > maxGap) maxGap = u - lastU;
          lastU = u;
          if (g.pace.finished) break;
        }
        return {
          samples, frames,
          low: Object.keys(low).map((k) => Object.assign({ setting: low[k].setting, skip: low[k].skip }, low[k].e)),
          hide: Object.keys(hide).map((k) => Object.assign({ setting: hide[k].setting, skip: hide[k].skip }, hide[k].h)),
          blank, contrast, drift, envelope,
          overlays: Object.keys(overlays),
          miles: +g.pace.miles.toFixed(2), hits: g.pace.hits,
          units: +g.pace.units.toFixed(0), total: MR.K.TOTAL_UNITS,
          maxGap: +maxGap.toFixed(1), view: MR.World && MR.World.VIEW,
          finished: !!g.pace.finished,
          tightest: minVisRow,
        };
      }, { AUDIT: fairness.call.replace(/^\(|\)\(\)$/g, ''), EVERY, CONTRAST: !NO_CONTRAST })
        .catch((e) => ({ err: 'evaluate failed: ' + e.message }));
      report.push({ date, layer: 'race', ms: Date.now() - a, plan, res, errors: errors.slice(0, 6) });
      if (plan) {
        plan.settings.forEach((s) => { settingsAll[s] = 1; });
        plan.pairs.forEach((p) => { pairsAll[p] = 1; });
      }
      if (!JSON_OUT) process.stderr.write('.');
    }
    await ctx.close();
  }

  // ------------------------------------------------------------------ WALK
  const walkDates = dates.slice(DEEP);
  if (walkDates.length) {
    const { ctx, page, errors } = await makePage(640, 400);
    for (const date of walkDates) {
      const a = Date.now();
      await load(page, errors, date);
      const plan = await planOf(page).catch(() => null);
      const res = await page.evaluate(fairness.corridorCall(STEP, true))
        .catch((e) => ({ err: 'evaluate failed: ' + e.message }));
      if (res && res.census) for (const k of Object.keys(res.census)) censusAll[k] = (censusAll[k] || 0) + 1;
      report.push({ date, layer: 'walk', ms: Date.now() - a, plan, res, errors: errors.slice(0, 6) });
      if (plan) {
        plan.settings.forEach((s) => { settingsAll[s] = 1; });
        plan.pairs.forEach((p) => { pairsAll[p] = 1; });
      }
      if (!JSON_OUT) process.stderr.write('.');
    }
    await ctx.close();
  }

  await browser.close();
  const elapsed = (Date.now() - t0) / 1000;

  // ------------------------------------------------------------------ out
  for (const r of report) {
    const res = r.res || {};
    if (r.errors.length) failed = true;
    if (res.err) failed = true;
    // A SKIPPED AUDIT IS A FAILED AUDIT. This checked res.err and not
    // res.skipped, so an audit that refused to run passed the sweep -- the
    // same class of hole as the NaN it was written to catch.
    if (res.skipped) failed = true;
    if (res.low && res.low.length) failed = true;
    if (res.hide && res.hide.length) failed = true;
    if (res.blank && res.blank.length) failed = true;
    if (res.drift) failed = true;
    if (res.envelope) failed = true;
    r.contrastFail = [];
    for (const c of (res.contrast || [])) {
      if (c.err) { failed = true; r.contrastFail.push({ key: c.key, err: c.err }); continue; }
      // The same two thresholds shoot.js gates on, and the same reasoning:
      // GATE is the weakest object the reference demonstrates is legible.
      const G_L = 1.25, G_S = 0.22;
      for (const h of c.hazards) {
        let hardest = null;
        for (const rd of c.roads) {
          const ratio = Math.max(h.L, rd.L) / Math.max(1e-6, Math.min(h.L, rd.L));
          const dS = Math.abs(h.S - rd.S);
          const gm = Math.max(ratio / G_L - 1, dS / G_S - 1);
          if (!hardest || gm < hardest.gate) {
            hardest = { name: h.name, lane: rd.lane, hL: h.L, rL: rd.L, hS: h.S, rS: rd.S,
                        ratio: +ratio.toFixed(2), dS: +dS.toFixed(3), gate: +gm.toFixed(3) };
          }
        }
        if (hardest.gate < 0) { failed = true; r.contrastFail.push(Object.assign({ key: c.key }, hardest)); }
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ dates, DAYS, DEEP, elapsed, failed, report,
      settings: Object.keys(settingsAll).sort(), pairs: Object.keys(pairsAll).sort(),
      census: censusAll }, null, 1));
    process.exit(failed ? 1 : 0);
  }

  console.log('');
  for (const r of report) {
    const res = r.res || {};
    const bad = r.errors.length || res.err || res.skipped || (res.low || []).length || (res.hide || []).length
      || (res.blank || []).length || res.drift || res.envelope || r.contrastFail.length;
    if (!bad) continue;
    console.log(`\n=== ${r.date}  [${r.layer}]  ${r.plan ? r.plan.settings.join(' / ') : '?'} ===`);
    for (const e of r.errors) console.log('  ! ' + e);
    if (res.err) console.log('  ! ' + res.err);
    if (res.skipped) console.log('  ! AUDIT DID NOT RUN: ' + res.skipped);
    if (res.drift) console.log('  ! DRIFT: ' + res.drift);
    for (const e of (res.envelope || [])) console.log('  ! ENVELOPE: ' + e);
    for (const e of (res.low || [])) {
      // The two layers hand back different amounts. The WALK layer owns the
      // whole course and knows where on it this is; the RACE layer gets its
      // rows from the shared audit, which reports what shoot.js reports and
      // no more. Printing the walk's fields unconditionally put a literal
      // "mile undefined" in the first red run this tool ever produced -- the
      // instrument's own defect, found the same way everything else here is.
      console.log(`  ! LOW: ${e.name} crosses the corridor at y=${e.yMin} (below OVERHEAD_Y)`
        + ` at z=${e.z0}${e.z1 === undefined ? '' : '-' + e.z1}`
        + (e.mile === undefined ? '' : `, mile ${e.mile}`)
        + `, in ${e.setting}`
        + (e.skip === undefined ? '' : `  [--date ${r.date} --skip ${e.skip}]`));
    }
    for (const h of (res.hide || [])) {
      console.log(`  ! HIDES: ${h.el} (y>=${h.elY}, z<=${h.elZ}) projects onto the `
        + `${KIND[h.kind]} in lane ${h.lane} at z=${h.gateZ} (${h.d}u ahead), in ${h.setting}`
        + `  [--date ${r.date} --skip ${h.skip}]`);
    }
    for (const b of (res.blank || []).slice(0, 6)) {
      const what = b.over > 0 ? 'PAINTS' : 'BLANKS';
      console.log(`  ! ${what}: the ${KIND[b.kind]} in lane ${b.lane} ${b.d}u ahead is `
        + `${Math.round(b.vis * 100)}% visible and is owed ${Math.round(b.need * 100)}% -- `
        + `${b.over > 0 ? 'painted over by ' + b.byOver : 'hidden by the ' + b.by}`
        + (b.tightBy !== null && b.tightBy !== undefined
            ? `, ${Math.abs(b.tightBy) < 1e-6 ? 'which clears the read window EXACTLY -- a float tie, see below'
                                              : b.tightBy + 'u inside the read window'}` : '')
        + `  (${b.setting}, ${Math.round(b.f * 100)}% of the way)  [--date ${r.date} --skip ${b.skip}]`);
    }
    if ((res.blank || []).length > 6) console.log(`    ...and ${res.blank.length - 6} more`);
    for (const c of r.contrastFail.slice(0, 6)) {
      if (c.err) { console.log(`  ! CONTRAST: audit threw in ${c.key}: ${c.err}`); continue; }
      console.log(`  ! CONTRAST: ${c.name} is L=${c.hL} S=${c.hS} on a lane-${c.lane} road of `
        + `L=${c.rL} S=${c.rS} -- ${c.ratio}x luminance and ${c.dS} saturation, in ${c.key}. `
        + 'It matches the tarmac on both axes.');
    }
  }

  // ---- coverage, printed pass or fail -----------------------------------
  //
  // The whole argument for the sample size is in these two lines, so they are
  // not conditional on failure. A green run that had not stood on most of the
  // ground is the object docs/roadmap.md calls more dangerous than a red one.
  const races = report.filter((r) => r.layer === 'race');
  const walks = report.filter((r) => r.layer === 'walk');
  const pairs = Object.keys(pairsAll).sort();
  const sets = Object.keys(settingsAll).sort();
  console.log('');
  console.log(`days           ${report.length}  (${walks.length} walked, ${races.length} raced)`
    + `  from ${dates[0]}`);
  console.log(`settings       ${sets.length}/12  ${sets.join(' ')}`);
  console.log(`setting/biome  ${pairs.length}/72 pairs reached`);
  if (pairs.length < 72 && !ONE) {
    const missing = [];
    console.log(`               short of the 72 a year contains -- raise --days`);
  }
  const cen = Object.keys(censusAll).sort();
  if (cen.length) {
    console.log(`named scenery  ${cen.length} distinct, over the walked days`);
    console.log('               ' + cen.map((k) => k + ' x' + censusAll[k]).join(', '));
  }
  // ---- THE COVERAGE OF THE RACE LAYER, AS A NUMBER ---------------------
  //
  // Not "it samples every two seconds, which is about 53 units". A whole-course
  // claim is only true if the widest gap between consecutive samples is inside
  // the spawn distance and the race actually reached the tape, and both of
  // those are measured per day rather than asserted here.
  const finished = races.filter((r) => r.res && r.res.finished).length;
  const gaps = races.map((r) => r.res && r.res.maxGap).filter((x) => x !== undefined);
  if (races.length) {
    const worstGap = Math.max.apply(null, gaps.concat([0]));
    const view = (races[0].res && races[0].res.view) || 210;
    const shortest = Math.min.apply(null, races.map((r) => (r.res && r.res.units) || 0));
    console.log(`race coverage  ${finished}/${races.length} reached the tape; `
      + `shortest run ${shortest}u of ${(races[0].res && races[0].res.total || 0).toFixed(0)}u; `
      + `widest sample gap ${worstGap}u against a ${view}u spawn distance`
      + (worstGap > view ? '  -- TOO WIDE, road went unsampled' : ''));
    if (worstGap > view) failed = true;
  }
  const walkCov = walks.map((r) => r.res && r.res.step).filter(Boolean);
  if (walkCov.length) {
    const w0 = walks.find((r) => r.res && r.res.step).res;
    console.log(`walk coverage  step ${w0.step}u against a ${w0.view}u spawn distance, `
      + `${w0.samples} samples reaching ${w0.reach}u of ${w0.total.toFixed(0)}u, `
      + `${w0.elements} crossings seen`);
  }
  const tightest = races.map((r) => r.res && r.res.tightest).filter(Boolean)
    .sort((a, b) => (a.vis - a.need) - (b.vis - b.need))[0];
  if (tightest) {
    console.log(`tightest gate  ${KIND[tightest.kind]} L${tightest.lane} at ${tightest.d}u: `
      + `${Math.round(tightest.vis * 100)}% seen against ${Math.round(tightest.need * 100)}% owed`
      + `  (${tightest.setting})`);
  }
  // ---- THE TIE COUNT, and it is the headline on a red run ---------------
  //
  // See the note in tools/lib/fairness.js where tightBy is computed.
  // course.js floors gate spacing at readWindowAt(z) + reachOf(lanes), and on
  // flat ground readWindowAt IS READ_NEAR -- so every pair the floor binds
  // sits at gt.z - hit.z1 == READ_NEAR exactly, and the shipped `<` resolves
  // it on the last bit of a double. A BLANKS row whose tightBy is zero to the
  // 1e-13 scale is that tie and not a hazard anyone cannot see: `raw` is the
  // same either way, and the rule the credit implements is satisfied with
  // precisely zero margin, by construction.
  //
  // COUNTED, NOT FORGIVEN. The comparison is untouched and these rows still
  // fail the run.
  let blankRows = 0, blankTies = 0;
  for (const r of races) {
    for (const b of ((r.res && r.res.blank) || [])) {
      blankRows++;
      if (b.tightBy !== null && b.tightBy !== undefined && Math.abs(b.tightBy) < 1e-6) blankTies++;
    }
  }
  if (blankRows) {
    console.log(`BLANKS         ${blankRows} rows, ${blankTies} of them EXACT float ties at READ_NEAR`);
    if (blankTies === blankRows) {
      console.log('               every one has the same root cause, and it is not art:');
      console.log('               src/core/course.js spacingAt() floors spacing at');
      console.log('               readWindowAt(z) + reachOf(lanes), which on flat ground is');
      console.log('               READ_NEAR + the gate box depth exactly -- so the audit\'s');
      console.log('               strict < is decided by rounding a subtraction of two');
      console.log('               world coordinates near 4,000. Not fixed here: src is not');
      console.log('               this pass\'s to touch, and a fairness threshold must not be');
      console.log('               relaxed to make a sweep go green.');
    }
  }
  const pairsAudited = races.reduce((n, r) => n + ((r.res && r.res.contrast) || []).length, 0);
  if (pairsAudited) console.log(`contrast       ${pairsAudited} (setting, biome) palettes rendered and measured`);
  console.log(`runtime        ${elapsed.toFixed(1)}s  (${(elapsed / Math.max(1, report.length)).toFixed(1)}s a day)`);
  console.log('');
  console.log(failed
    ? 'FAIL: a day of this game hides a hazard, matches one to the road, or throws'
    : `OK: ${report.length} days clean`);
  process.exit(failed ? 1 : 0);
})();
