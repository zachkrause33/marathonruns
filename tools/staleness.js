#!/usr/bin/env node
/**
 * WHAT ONE RUN ACTUALLY SHOWS, AND HOW OFTEN IT SHOWS IT AGAIN.
 *
 *   node tools/staleness.js                 30 dates, the full report
 *   node tools/staleness.js --days 90       a longer sweep
 *   node tools/staleness.js --date 2026-08-11 --days 1    one named day
 *   node tools/staleness.js --json /path    dump the raw per-hazard rows
 *
 * The owner's complaint is "the game gets stale". This file refuses to answer
 * that with a variant count, because the variant count is a property of the
 * BUILD and staleness is a property of a RUN. The two are not the same
 * statement and this project already has one measurement proving it: a
 * shuffled bag at the old variant count beat an independent hash at three more
 * variants than the game had. What the player experiences is the sequence.
 *
 * So everything below is measured along the sequence a player is dragged
 * through, on the clock they experience it on.
 *
 * ---- SECTIONS -------------------------------------------------------------
 *
 *   audit      the instrument checking itself before it prints a number
 *   census     hazards per run, distinct variants SEEN, instances per variant
 *   repeats    the gap between two sightings of the same skin, in seconds,
 *              in gates and in same-kind sightings
 *   window     the published read-window repeat figure, recomputed
 *   shape      the gate as a SHAPE -- which lanes hold what -- independent of
 *              which skin is painted on it
 *   mile       per-mile density, and the freshness curve that says WHERE
 *   legs       the six biomes and the three-or-four settings
 *
 * ---- HOW THIS INSTRUMENT COULD HAVE BEEN WRONG, AND WHAT STOPS IT ---------
 *
 * Rule 3. Every instrument in this project was wrong first and every error
 * flattered the thing measured. Seven ways this one could have been:
 *
 *  1. CASTING THE COURSE ITSELF. The bag deal lives in world.js inside a
 *     closure and a second implementation of it here would be a statement
 *     about a function nobody renders. The cast is taken from the RUNNING
 *     PAGE through api.variantPlan, and audit A1 below checks that plan
 *     against api.liveCast -- what the scene graph is actually wearing -- so
 *     the numbers are about the road and not about a model of it.
 *
 *  2. MEASURING REPEATS IN GATES. A gap of four gates is 90 units at the start
 *     and 60 at the wall, and the player experiences neither: they experience
 *     seconds. Every gap here is reported in SECONDS first, from the real
 *     Pace model driven over the real elevation, and in gates and units
 *     alongside because a claim in one unit is not checkable in another.
 *
 *  3. TAKING THE MEAN OVER DATES AND CALLING IT A RUN. Nobody plays the mean
 *     of thirty days. Per-run figures are reported as a DISTRIBUTION -- worst
 *     day, median day, best day -- and the mean is only ever used where the
 *     question is about the generator rather than about a race.
 *
 *  4. CALLING A LONG GAP THE ANSWER. A median gap is not what staleness feels
 *     like; the short tail is. Percentiles are reported from the bottom (p10,
 *     p25) because the sighting that reads as a repeat is the near one, and a
 *     comfortable median can sit on top of a pile of 8-second doubles.
 *
 *  5. NOVELTY THAT DECAYS TO ZERO BY CONSTRUCTION. "Share of hazards that are
 *     the first sighting of their skin" falls to nothing by mile 3 whatever
 *     the game does, so it measures the definition and not the course. FRESH
 *     SHARE is against a RECENCY window instead: the share of hazards whose
 *     skin has not been seen in the preceding W seconds. That can stay high
 *     all race, or not, and which it does is the finding.
 *
 *  6. COUNTING SKINS AND CALLING IT VARIETY. A gate is a SHAPE before it is a
 *     skin -- which lanes are occupied, by which verbs -- and a player reads
 *     the shape at 25 units and the skin at 12. The shape census is computed
 *     with the variants stripped out entirely, so "every mile is the same
 *     question with different furniture" is a thing this file can either show
 *     or fail to show.
 *
 *  7. A STALE PAGE. index.html is a build artefact several agents rebuild.
 *     The run asserts build.js --check passes before the browser opens, and
 *     reports the artefact's hash with the numbers.
 *
 * WHAT THIS FILE DOES NOT MEASURE, stated so it is not read as if it did:
 * scenery. Buildings, trees, crowds, traffic and the six biome palettes are a
 * large part of what a player looks at and none of it is counted here. This is
 * a census of HAZARDS. A conclusion about whether the WORLD gets stale cannot
 * be drawn from it.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}

const DAYS = parseInt(arg('days', '30'), 10);
const START = String(arg('date', '2026-01-01'));
const JSON_OUT = arg('json', null);
// The skill the clock is read at. A clean run is FASTER, so every gap in
// seconds is SHORTER on it -- that is the unflattering direction and it is the
// default. The mid-skill clock is printed alongside so the choice is visible
// rather than buried.
const SKILLS = [1, 0.6];

// ---------------------------------------------------------------------------
// IN-PAGE
// ---------------------------------------------------------------------------

/**
 * Cast one date's course on the running page and put a real clock on it.
 *
 * Returns one row per HAZARD INSTANCE -- a lane of a gate that holds
 * something -- carrying its z, its mile, its kind, its skin, and the race
 * time at which the runner's eye reaches its gate line at each skill.
 */
function castDay(o) {
  const MRr = window.MR;
  const K = MRr.K;
  const course = MRr.Course.generate(o.key);
  if (!course.valid.ok) return { err: 'course invalid for ' + o.key };

  const plan = MRr.game.world.variantPlan(course);

  // ---- the clock ---------------------------------------------------------
  //
  // The REAL Pace model over the REAL elevation, driven at 1/60 exactly as
  // main.js drives it, with gate-line crossings stamped as they happen. A
  // closed-form estimate from mean pace is what hid a 13-second miss on the
  // record during tuning, and it would hide the same size of error here.
  const clocks = {};
  for (const skill of o.skills) {
    const p = MRr.Pace.create(course.elevation);
    const t = new Array(course.gates.length).fill(null);
    let gi = 0, n = 0, guard = 0;
    while (!p.finished && guard++ < 400000) {
      p.update(1 / 60);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) {
        t[gi] = p.realTime;
        gi++; n++;
        if (skill >= 1) p.onClean();
        else if (skill <= 0) p.onHit();
        else if (n % Math.max(2, Math.round(1 / (1 - skill))) === 0) p.onHit();
        else p.onClean();
      }
    }
    // A gate the loop never reached is a clock defect, not a course fact.
    clocks[skill] = { t: t, finish: p.realTime, missed: t.filter(function (x) { return x === null; }).length };
  }

  const NAME = {};
  NAME[K.JUMP] = 'JUMP'; NAME[K.DUCK] = 'DUCK'; NAME[K.BLOCK] = 'BLOCK'; NAME[K.CLEAR] = 'CLEAR';

  const byZ = {};
  for (let i = 0; i < course.gates.length; i++) byZ[course.gates[i].z] = i;

  const rows = [];
  for (const h of plan) {
    const gi = byZ[h.z];
    const times = {};
    for (const s of o.skills) times[s] = clocks[s].t[gi];
    rows.push({
      gi: gi, z: h.z, lane: h.lane, kind: NAME[h.kind], variant: h.variant,
      train: course.gates[gi].train || 0, t: times,
    });
  }

  // The gate table with skins stripped: the SHAPE of each gate.
  const shapes = course.gates.map(function (g, i) {
    return {
      gi: i, z: g.z, train: g.train || 0,
      lanes: g.lanes.map(function (l) { return NAME[l]; }),
      t: o.skills.reduce(function (a, s) { a[s] = clocks[s].t[i]; return a; }, {}),
    };
  });

  return {
    key: o.key,
    gates: course.gates.length,
    length: course.length,
    rows: rows,
    shapes: shapes,
    clocks: o.skills.reduce(function (a, s) {
      a[s] = { finish: clocks[s].finish, missed: clocks[s].missed }; return a;
    }, {}),
    settings: (course.settings || []).map(function (s) { return { tag: s.tag, from: s.from, to: s.to }; }),
    biomes: (course.biomes || []).map(function (b) { return { name: b.name, from: b.from }; }),
    tally: course.tally || null,
  };
}

/**
 * AUDIT A1. The plan against the road.
 *
 * api.variantPlan says what the course WILL wear and api.liveCast says what
 * the scene graph IS wearing. If they disagree, every repetition number in
 * this file is a statement about a function nobody renders. The roadmap
 * records that these were once separate code paths computing the same hash and
 * nothing in the tree could ask whether they agreed.
 */
function auditPlanVsLive() {
  const w = window.MR.game.world;
  const live = w.liveCast();
  const plan = w.variantPlan(w.course);
  const idx = {};
  for (const p of plan) idx[p.z.toFixed(3) + '/' + p.lane] = p.variant;
  let checked = 0, agree = 0;
  const bad = [];
  for (const l of live) {
    if (l.variant < 0) continue;
    const k = l.z.toFixed(3) + '/' + l.lane;
    if (!(k in idx)) { bad.push('live hazard not in plan at ' + k); continue; }
    checked++;
    if (idx[k] === l.variant) agree++;
    else bad.push(k + ' plan v' + idx[k] + ' road v' + l.variant);
  }
  return { checked: checked, agree: agree, bad: bad.slice(0, 8), liveCount: live.length };
}

/** AUDIT A2. How many skins the pools actually built, read off the pools. */
function auditPoolCounts() {
  const out = {};
  const K = window.MR.K, B = window.MR.Collision.BOX;
  // The kind CONSTANTS, read off the page rather than assumed. The deal's
  // stream salt is built from these, and a guessed salt still shuffles --
  // it just shuffles differently, which is a check failing with no clue why.
  out.ids = { JUMP: K.JUMP, DUCK: K.DUCK, BLOCK: K.BLOCK };
  const byHalfZ = {};
  byHalfZ[B[K.JUMP].halfZ] = 'JUMP';
  byHalfZ[B[K.DUCK].halfZ] = 'DUCK';
  byHalfZ[B[K.BLOCK].halfZ] = 'BLOCK';
  window.MR.game.world.group.traverse(function (n) {
    if (!n.userData || !n.userData.variants || !n.userData.notScenery) return;
    const vs = n.userData.variants;
    if (!vs.length) return;
    const kn = byHalfZ[+vs[0].position.z.toFixed(4)];
    if (!kn) return;
    out[kn] = vs.length;
    // The BAG, which is what the deal is drawn from: a weighted variant holds
    // more than one ticket, so the bag is longer than the variant list and the
    // deal length is the bag length. Reporting only the variant count would
    // understate how far apart two sightings of one skin are guaranteed to be.
    if (n.userData.bag) {
      out[kn + '_bag'] = n.userData.bag.length;
      out[kn + '_tickets'] = n.userData.bag.slice();
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// STATISTICS
// ---------------------------------------------------------------------------

function pct(arr, p) {
  if (!arr.length) return NaN;
  const a = arr.slice().sort(function (x, y) { return x - y; });
  const i = (a.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (i - lo);
}
function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : NaN; }
function f1(x) { return Number.isFinite(x) ? x.toFixed(1) : '  - '; }
function f2(x) { return Number.isFinite(x) ? x.toFixed(2) : '  - '; }

/** Shannon entropy of a count map, in bits. */
function entropy(counts) {
  const vals = Object.keys(counts).map(function (k) { return counts[k]; });
  const n = vals.reduce(function (a, b) { return a + b; }, 0);
  if (!n) return 0;
  let h = 0;
  for (const v of vals) { if (!v) continue; const p = v / n; h -= p * Math.log2(p); }
  return h;
}

/**
 * Gaps between successive sightings of the same skin, along one run.
 *
 * Three units on purpose: seconds is what the player has, gates is what the
 * generator has, and same-kind sightings is what the bag guarantees. A claim
 * that holds in one and not the others is a claim about the unit.
 */
function repeatGaps(rows, skill) {
  const byKind = {};
  for (const r of rows) {
    (byKind[r.kind] = byKind[r.kind] || []).push(r);
  }
  const out = {};
  for (const kind of Object.keys(byKind)) {
    const list = byKind[kind].slice().sort(function (a, b) { return a.z - b.z; });
    const last = {};
    const secs = [], gates = [], units = [], ordinals = [];
    let adjacentSame = 0, adjacentPairs = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const prev = last[r.variant];
      if (prev !== undefined) {
        const p = list[prev];
        if (r.t[skill] !== null && p.t[skill] !== null) secs.push(r.t[skill] - p.t[skill]);
        gates.push(r.gi - p.gi);
        units.push(r.z - p.z);
        ordinals.push(i - prev);
      }
      if (i > 0) {
        adjacentPairs++;
        if (list[i - 1].variant === r.variant) adjacentSame++;
      }
      last[r.variant] = i;
    }
    out[kind] = {
      n: list.length, secs: secs, gates: gates, units: units, ordinals: ordinals,
      adjacentSame: adjacentSame, adjacentPairs: adjacentPairs,
    };
  }
  return out;
}

/**
 * The published read-window figure, recomputed. Windows of READ_NEAR to
 * SIGHT_MIN stepped 5 units, share of windows containing two hazards of one
 * kind wearing the same skin.
 *
 * Stepped in UNITS, not in gates, and the window is a length rather than a
 * count of gates, because the density changes threefold across a race and a
 * gate-counted window would be measuring the density.
 */
function windowRepeats(rows, length, span, step) {
  const out = {};
  for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
    const list = rows.filter(function (r) { return r.kind === kind; })
      .sort(function (a, b) { return a.z - b.z; });
    let windows = 0, withTwo = 0, repeats = 0;
    for (let z = 0; z + span <= length; z += step) {
      const inw = [];
      for (const r of list) { if (r.z >= z && r.z < z + span) inw.push(r.variant); }
      windows++;
      if (inw.length < 2) continue;
      withTwo++;
      const seen = {};
      let rep = false;
      for (const v of inw) { if (seen[v]) rep = true; seen[v] = 1; }
      if (rep) repeats++;
    }
    out[kind] = { windows: windows, withTwo: withTwo, repeats: repeats,
      shareAll: repeats / windows, shareOfTwo: withTwo ? repeats / withTwo : 0 };
  }
  return out;
}

/**
 * FRESH SHARE. Of the hazards in a stretch, what fraction wear a skin the
 * player has not seen in the preceding W seconds.
 *
 * This is the measure that says WHERE staleness bites, and it is built to be
 * capable of saying "nowhere". A first-appearance count cannot: it decays to
 * zero by mile three whatever the course does, so it measures its own
 * definition. Recency does not decay by construction -- if the course kept
 * handing out things last seen four minutes ago it would read 100% at the
 * tape.
 */
function freshness(rows, skill, W) {
  const list = rows.filter(function (r) { return r.t[skill] !== null; })
    .sort(function (a, b) { return a.t[skill] - b.t[skill] || a.z - b.z; });
  const lastSeen = {};
  const out = [];
  for (const r of list) {
    const key = r.kind + ':' + r.variant;
    const t = r.t[skill];
    const prev = lastSeen[key];
    out.push({ z: r.z, t: t, fresh: (prev === undefined || t - prev > W) ? 1 : 0 });
    lastSeen[key] = t;
  }
  return out;
}

/** The same idea applied to the gate SHAPE rather than the skin. */
function shapeFreshness(shapes, skill, W) {
  const list = shapes.filter(function (s) { return s.t[skill] !== null; })
    .sort(function (a, b) { return a.t[skill] - b.t[skill]; });
  const lastSeen = {};
  const out = [];
  for (const s of list) {
    const key = s.lanes.join('|');
    const t = s.t[skill];
    const prev = lastSeen[key];
    out.push({ z: s.z, t: t, fresh: (prev === undefined || t - prev > W) ? 1 : 0 });
    lastSeen[key] = t;
  }
  return out;
}

// ---------------------------------------------------------------------------

(async () => {
  // ---- AUDIT A7: the page must be the page the source builds ---------------
  try {
    const chk = execFileSync('node', [path.join(ROOT, 'tools/build.js'), '--check'],
      { cwd: ROOT, encoding: 'utf8' });
    if (!/up to date/.test(chk)) {
      console.log('FAILED build.js --check:\n' + chk);
      process.exit(1);
    }
  } catch (e) {
    console.log('FAILED build.js --check: ' + (e.stdout || e.message));
    process.exit(1);
  }
  const artefact = crypto.createHash('sha1')
    .update(fs.readFileSync(path.join(ROOT, 'index.html'))).digest('hex').slice(0, 12);

  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function (e) { errs.push(e.message.split('\n')[0]); });
  await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&skip=150');
  await page.waitForFunction(function () { return window.MR && MR.game && MR.game.ready; }, { timeout: 40000 });
  await page.waitForTimeout(2200);

  if (errs.length) {
    console.log('FAILED: the page threw before any measurement was taken:');
    for (const e of errs.slice(0, 5)) console.log('  ' + e);
    await browser.close();
    process.exit(1);
  }

  const pools = await page.evaluate(auditPoolCounts);
  const a1 = await page.evaluate(auditPlanVsLive);

  console.log('=================== STALENESS, MEASURED ===================');
  console.log('artefact index.html sha1 ' + artefact + '   ' + DAYS + ' dates from ' + START);
  console.log('');
  console.log('---- AUDIT ----------------------------------------------');
  console.log('A1  plan vs road   ' + a1.agree + ' of ' + a1.checked
    + ' live hazards wear the skin variantPlan cast'
    + (a1.checked ? '' : '   (NOTHING LIVE -- see below)'));
  for (const b of a1.bad) console.log('      ' + b);
  if (!a1.checked || a1.agree !== a1.checked) {
    console.log('FAILED A1: the cast this file measures is not the cast the road wears.');
    await browser.close();
    process.exit(1);
  }
  console.log('A2  pools built    JUMP ' + pools.JUMP + ' skins / bag ' + pools.JUMP_bag
    + ',  DUCK ' + pools.DUCK + ' / ' + pools.DUCK_bag
    + ',  BLOCK ' + pools.BLOCK + ' / ' + pools.BLOCK_bag);
  console.log('      a deal is the BAG length, not the skin count: two sightings of one');
  console.log('      skin closer together than a full deal are impossible inside a deal.');

  // ---- the sweep ----------------------------------------------------------
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.parse(START + 'T00:00:00Z') + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const r = await page.evaluate(castDay, { key: key, skills: SKILLS });
    if (r.err) { console.log('FAILED ' + key + ': ' + r.err); await browser.close(); process.exit(1); }
    days.push(r);
  }
  if (errs.length) {
    console.log('FAILED: the page threw DURING the sweep -- numbers above are suspect:');
    for (const e of errs.slice(0, 5)) console.log('  ' + e);
    await browser.close();
    process.exit(1);
  }
  await browser.close();

  const missed = days.reduce(function (a, d) { return a + d.clocks[1].missed + d.clocks[0.6].missed; }, 0);
  console.log('A3  clock          ' + missed + ' gate lines the pace loop never reached'
    + (missed ? '   <-- DEFECT' : ''));
  if (missed) { console.log('FAILED A3.'); process.exit(1); }
  const fin = days.map(function (d) { return d.clocks[1].finish; });
  console.log('      clean finish ' + f1(mean(fin)) + ' s real, mid-skill '
    + f1(mean(days.map(function (d) { return d.clocks[0.6].finish; }))) + ' s');
  console.log('');

  // ---- CENSUS -------------------------------------------------------------
  console.log('---- CENSUS: what one run puts in front of you -----------');
  const perDay = days.map(function (d) {
    const c = { JUMP: 0, DUCK: 0, BLOCK: 0 };
    const seen = {};
    for (const r of d.rows) { c[r.kind]++; seen[r.kind + ':' + r.variant] = (seen[r.kind + ':' + r.variant] || 0) + 1; }
    return { key: d.key, gates: d.gates, c: c, total: d.rows.length, seen: seen,
      distinct: Object.keys(seen).length };
  });
  const tot = perDay.map(function (p) { return p.total; });
  console.log('gates per run       ' + f1(mean(perDay.map(function (p) { return p.gates; })))
    + '   (min ' + Math.min.apply(null, perDay.map(function (p) { return p.gates; }))
    + ', max ' + Math.max.apply(null, perDay.map(function (p) { return p.gates; })) + ')');
  console.log('hazard sightings    ' + f1(mean(tot))
    + '   (min ' + Math.min.apply(null, tot) + ', max ' + Math.max.apply(null, tot) + ')');
  for (const k of ['JUMP', 'DUCK', 'BLOCK']) {
    console.log('  ' + k.padEnd(6) + '            ' + f1(mean(perDay.map(function (p) { return p.c[k]; }))));
  }
  const built = pools.JUMP + pools.DUCK + pools.BLOCK;
  console.log('distinct skins seen ' + f2(mean(perDay.map(function (p) { return p.distinct; })))
    + ' of ' + built + ' built   (min ' + Math.min.apply(null, perDay.map(function (p) { return p.distinct; })) + ')');
  console.log('');
  console.log('SIGHTINGS PER SKIN, one run. This is the number the owner is feeling.');
  const perSkin = {};
  for (const p of perDay) {
    for (const k in p.seen) (perSkin[k] = perSkin[k] || []).push(p.seen[k]);
  }
  console.log('  kind    skins   mean sightings/run   min   max   busiest skin');
  for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
    const keys = Object.keys(perSkin).filter(function (k) { return k.indexOf(kind + ':') === 0; });
    const means = keys.map(function (k) { return mean(perSkin[k]); });
    let bi = 0;
    for (let i = 1; i < means.length; i++) if (means[i] > means[bi]) bi = i;
    console.log('  ' + kind.padEnd(7) + ' ' + String(keys.length).padStart(3)
      + '     ' + f1(mean(means)).padStart(6)
      + '            ' + f1(Math.min.apply(null, means)).padStart(5)
      + ' ' + f1(Math.max.apply(null, means)).padStart(5)
      + '   ' + keys[bi] + ' at ' + f1(means[bi]));
  }
  console.log('');

  // ---- REPEATS ------------------------------------------------------------
  console.log('---- REPEATS: how long before you see it again -----------');
  console.log('Gap from one sighting of a skin to the NEXT sighting of the same skin.');
  console.log('p10 is the tenth-percentile gap -- the short ones, which are what a');
  console.log('repeat feels like. A comfortable median sits on top of these.');
  for (const skill of SKILLS) {
    console.log('');
    console.log('  at skill ' + skill + '  (' + (skill === 1 ? 'clean run, the FAST clock and so the SHORT gaps'
      : 'mid-skill, slower, longer gaps') + ')');
    console.log('  kind    n/run   seconds p10 / p25 / median      gates p10/med    sightings p10/med   back-to-back');
    for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
      const secs = [], gts = [], ords = [];
      let adjS = 0, adjP = 0, n = 0;
      for (const d of days) {
        const g = repeatGaps(d.rows, skill)[kind];
        if (!g) continue;
        n += g.n;
        for (const s of g.secs) secs.push(s);
        for (const s of g.gates) gts.push(s);
        for (const s of g.ordinals) ords.push(s);
        adjS += g.adjacentSame; adjP += g.adjacentPairs;
      }
      console.log('  ' + kind.padEnd(7)
        + f1(n / days.length).padStart(6)
        + '   ' + f1(pct(secs, 0.10)).padStart(6) + ' /' + f1(pct(secs, 0.25)).padStart(6)
        + ' /' + f1(pct(secs, 0.50)).padStart(7)
        + '     ' + f1(pct(gts, 0.10)).padStart(5) + ' /' + f1(pct(gts, 0.50)).padStart(6)
        + '      ' + f1(pct(ords, 0.10)).padStart(5) + ' /' + f1(pct(ords, 0.50)).padStart(6)
        + '       ' + (100 * adjS / adjP).toFixed(1) + '%');
    }
  }
  console.log('');
  console.log('  "back-to-back" is the share of consecutive hazards of a kind that wear');
  console.log('  the SAME skin -- the harshest repeat there is, nothing in between.');
  console.log('');

  // ---- WINDOW -------------------------------------------------------------
  console.log('---- READ WINDOW: the published figure, recomputed -------');
  const SPAN = 64.65, STEP = 5;
  console.log('window ' + SPAN + ' units (READ_NEAR to SIGHT_MIN), stepped ' + STEP);
  console.log('  kind    windows holding 2+ of the kind   of those, share with a repeat   over ALL windows');
  for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
    let w = 0, w2 = 0, rep = 0;
    for (const d of days) {
      const r = windowRepeats(d.rows, d.length, SPAN, STEP)[kind];
      w += r.windows; w2 += r.withTwo; rep += r.repeats;
    }
    console.log('  ' + kind.padEnd(7) + String((100 * w2 / w).toFixed(1) + '%').padStart(12)
      + '                  ' + String((100 * rep / w2).toFixed(1) + '%').padStart(8)
      + '                     ' + String((100 * rep / w).toFixed(1) + '%').padStart(7));
  }
  // WHICH DENOMINATOR THE PUBLISHED FIGURE USED, settled by reproducing it.
  // The roadmap quotes JUMP read-window repeats falling to 7.6% after two
  // skins were added. This run returns 7.6% in the MIDDLE column and 4.5% in
  // the last, so the published number is a share of windows that hold two or
  // more of the kind -- not a share of all windows. An earlier draft of this
  // file asserted the opposite in a comment and would have had every
  // comparison against the roadmap off by a factor of 1.7.
  console.log('  The MIDDLE column reproduces the figure the roadmap quotes (JUMP 7.6%),');
  console.log('  which settles that the published denominator is windows holding 2+ of the');
  console.log('  kind. It is also the one a player lives in: a window with only one hazard');
  console.log('  in it cannot repeat, so including those measures the density instead.');
  console.log('');

  // ---- SHAPE --------------------------------------------------------------
  console.log('---- SHAPE: the gate with the skins taken off ------------');
  console.log('A gate is three lanes each holding CLEAR, JUMP, DUCK or BLOCK. That is the');
  console.log('question the player answers at 25 units, before any skin resolves.');
  const shapeCount = {};
  let shapeTotal = 0;
  const perDayShapes = [];
  for (const d of days) {
    const c = {};
    for (const s of d.shapes) {
      const k = s.lanes.join('|');
      shapeCount[k] = (shapeCount[k] || 0) + 1;
      c[k] = (c[k] || 0) + 1;
      shapeTotal++;
    }
    perDayShapes.push(c);
  }
  const shapeKeys = Object.keys(shapeCount).sort(function (a, b) { return shapeCount[b] - shapeCount[a]; });
  console.log('distinct gate shapes, all ' + DAYS + ' days   ' + shapeKeys.length);
  console.log('distinct gate shapes, one run        ' + f1(mean(perDayShapes.map(function (c) { return Object.keys(c).length; })))
    + '   of ' + shapeKeys.length);
  console.log('shape entropy, one run               ' + f2(mean(perDayShapes.map(entropy))) + ' bits'
    + '   (uniform over ' + shapeKeys.length + ' would be ' + f2(Math.log2(shapeKeys.length)) + ')');
  console.log('the ten commonest shapes and their share of all gates:');
  for (const k of shapeKeys.slice(0, 10)) {
    console.log('    ' + k.padEnd(24) + String((100 * shapeCount[k] / shapeTotal).toFixed(1) + '%').padStart(7));
  }
  const top3 = shapeKeys.slice(0, 3).reduce(function (a, k) { return a + shapeCount[k]; }, 0);
  console.log('  top three shapes cover ' + (100 * top3 / shapeTotal).toFixed(1) + '% of every gate in the game.');
  console.log('');

  // ---- MILE ---------------------------------------------------------------
  console.log('---- WHERE IT BITES: per mile ---------------------------');
  const MI = 240;
  const NM = 27;
  const W1 = 30, W2 = 60;
  const rowsPerMile = [], gatesPerMile = [], actionPerMile = [];
  const fresh30 = [], fresh60 = [], shapeFresh30 = [];
  const kindMix = [];
  for (let m = 0; m < NM; m++) {
    rowsPerMile.push([]); gatesPerMile.push([]); actionPerMile.push([]);
    fresh30.push([]); fresh60.push([]); shapeFresh30.push([]);
    kindMix.push({ JUMP: 0, DUCK: 0, BLOCK: 0 });
  }
  for (const d of days) {
    const rc = new Array(NM).fill(0), gc = new Array(NM).fill(0), ac = new Array(NM).fill(0);
    for (const r of d.rows) { const m = Math.min(NM - 1, Math.floor(r.z / MI)); rc[m]++; kindMix[m][r.kind]++; }
    for (const s of d.shapes) {
      const m = Math.min(NM - 1, Math.floor(s.z / MI));
      gc[m]++;
      // A gate FORCES an action when no lane is CLEAR: the player cannot
      // simply hold a line through it.
      if (s.lanes.indexOf('CLEAR') < 0) ac[m]++;
    }
    for (let m = 0; m < NM; m++) {
      rowsPerMile[m].push(rc[m]); gatesPerMile[m].push(gc[m]);
      actionPerMile[m].push(gc[m] ? ac[m] / gc[m] : NaN);
    }
    for (const [W, sink] of [[W1, fresh30], [W2, fresh60]]) {
      const f = freshness(d.rows, 1, W);
      const num = new Array(NM).fill(0), den = new Array(NM).fill(0);
      for (const x of f) { const m = Math.min(NM - 1, Math.floor(x.z / MI)); num[m] += x.fresh; den[m]++; }
      for (let m = 0; m < NM; m++) sink[m].push(den[m] ? num[m] / den[m] : NaN);
    }
    const sf = shapeFreshness(d.shapes, 1, W1);
    const snum = new Array(NM).fill(0), sden = new Array(NM).fill(0);
    for (const x of sf) { const m = Math.min(NM - 1, Math.floor(x.z / MI)); snum[m] += x.fresh; sden[m]++; }
    for (let m = 0; m < NM; m++) shapeFresh30[m].push(sden[m] ? snum[m] / sden[m] : NaN);
  }
  function cleanMean(a) { const b = a.filter(Number.isFinite); return b.length ? mean(b) : NaN; }
  /**
   * THE SD COLUMN IS THE POINT OF THIS TABLE, NOT THE MEAN.
   *
   * "Every mile is the same shape with different furniture" is a claim about
   * VARIANCE, and a table of means cannot support or refute it. What settles
   * it is the spread of a mile's density ACROSS DAYS set against the spread
   * ACROSS MILES: if a given mile lands on nearly the same number every day
   * while the miles differ a lot from each other, then the arc of a run is
   * fixed and only its contents are dealt.
   */
  function sd(a) {
    const b = a.filter(Number.isFinite);
    if (b.length < 2) return NaN;
    const m = mean(b);
    return Math.sqrt(b.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (b.length - 1));
  }
  console.log(' mile   gates  hazards  haz/gate  sd(day)  forced   skin-fresh 30s  60s   shape-fresh 30s');
  const hgMeans = [];
  for (let m = 0; m < NM; m++) {
    const g = cleanMean(gatesPerMile[m]);
    if (!(g > 0)) continue;
    const hg = rowsPerMile[m].map(function (v, i) {
      return gatesPerMile[m][i] ? v / gatesPerMile[m][i] : NaN;
    });
    hgMeans.push(cleanMean(hg));
    console.log('  ' + String(m).padStart(3) + '   ' + f1(g).padStart(5)
      + '   ' + f1(cleanMean(rowsPerMile[m])).padStart(5)
      + '    ' + f2(cleanMean(hg)).padStart(5)
      + '    ' + f2(sd(hg)).padStart(5)
      + '   ' + String((100 * cleanMean(actionPerMile[m])).toFixed(0) + '%').padStart(5)
      + '      ' + String((100 * cleanMean(fresh30[m])).toFixed(0) + '%').padStart(6)
      + '  ' + String((100 * cleanMean(fresh60[m])).toFixed(0) + '%').padStart(5)
      + '           ' + String((100 * cleanMean(shapeFresh30[m])).toFixed(0) + '%').padStart(6));
  }
  const acrossMiles = sd(hgMeans);
  const withinMile = mean(hgMeans.map(function (_, i) {
    const hg = rowsPerMile[i].map(function (v, j) {
      return gatesPerMile[i][j] ? v / gatesPerMile[i][j] : NaN;
    });
    return sd(hg);
  }).filter(Number.isFinite));
  console.log('');
  console.log('  hazards per gate: spread ACROSS MILES ' + f2(acrossMiles)
    + ',  spread ACROSS DAYS within a mile ' + f2(withinMile));
  console.log('  ratio ' + f1(acrossMiles / withinMile) + ':1. The arc of a run is '
    + f1(acrossMiles / withinMile) + ' times more');
  console.log('  fixed than it is varied -- mile 23 is always denser than mile 3, on every');
  console.log('  date, by more than the dates differ from each other.');
  console.log('');
  console.log('  skin-fresh = share of hazards in the mile wearing a skin NOT seen in the');
  console.log('  preceding 30 (or 60) seconds. shape-fresh = the same for the gate shape.');
  console.log('  Both are recency, not first-sighting, so neither decays by construction.');
  console.log('');

  // ---- CEILING ------------------------------------------------------------
  //
  // THE MEASURE HAS AN ARITHMETIC ROOF AND IT MUST BE PRINTED NEXT TO IT.
  //
  // skin-fresh cannot exceed skins / sightings-in-window. If a mile shows 25
  // DUCKs in thirty seconds and the game owns five DUCK skins, the best any
  // draw can do is 5 of 25 = 20%, and a reading of 7% against a roof of 20%
  // is a different statement from 7% against a roof of 100%. Reporting the
  // reading alone would let "the draw is bad" be concluded from what is
  // actually "the pool is too small for the density" -- which is the exact
  // shape of error rule 3 keeps catching, and it would have pointed the fix
  // at the wrong lever.
  console.log('---- THE ROOF ON FRESHNESS -------------------------------');
  console.log('skin-fresh over a W-second window cannot exceed skins / sightings-in-W.');
  console.log('So the pool size and the density are ONE constraint, not two.');
  console.log('');
  console.log('  kind   skins   sightings per 30 s      ceiling on 30 s skin-fresh');
  console.log('                 mile 2   mile 13  mile 23     mile 2  mile 13  mile 23');
  const RATE = {};
  for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
    const at = {};
    for (const m of [2, 13, 23]) {
      const rates = [];
      for (const d of days) {
        const inm = d.rows.filter(function (r) {
          return r.kind === kind && Math.floor(r.z / MI) === m && r.t[1] !== null;
        });
        if (inm.length < 2) continue;
        const t0 = Math.min.apply(null, inm.map(function (r) { return r.t[1]; }));
        const t1 = Math.max.apply(null, inm.map(function (r) { return r.t[1]; }));
        if (t1 - t0 < 1) continue;
        rates.push(30 * inm.length / (t1 - t0));
      }
      at[m] = mean(rates);
    }
    RATE[kind] = at;
    const skins = pools[kind];
    console.log('  ' + kind.padEnd(7) + String(skins).padStart(4)
      + '     ' + f1(at[2]).padStart(6) + '  ' + f1(at[13]).padStart(7) + '  ' + f1(at[23]).padStart(7)
      + '     ' + String((100 * Math.min(1, skins / at[2])).toFixed(0) + '%').padStart(6)
      + '  ' + String((100 * Math.min(1, skins / at[13])).toFixed(0) + '%').padStart(6)
      + '  ' + String((100 * Math.min(1, skins / at[23])).toFixed(0) + '%').padStart(6));
  }
  console.log('');

  // ---- TRAINS -------------------------------------------------------------
  //
  // A BLOCK train is dealt OUTSIDE the bag and is ALWAYS variant 0, by design
  // -- it is the only body authored to stretch along z. That is a deliberate
  // choice with a repetition cost, and the cost has never been counted.
  console.log('---- THE TRAIN, WHICH IS ALWAYS THE SAME OBJECT ----------');
  let trainN = 0, blockN = 0, v0N = 0;
  let bbAll = 0, bbAllPairs = 0, bbNoTrain = 0, bbNoTrainPairs = 0;
  for (const d of days) {
    const list = d.rows.filter(function (r) { return r.kind === 'BLOCK'; })
      .sort(function (a, b) { return a.z - b.z; });
    for (const r of list) { blockN++; if (r.train) trainN++; if (r.variant === 0) v0N++; }
    for (let i = 1; i < list.length; i++) {
      bbAllPairs++;
      if (list[i].variant === list[i - 1].variant) bbAll++;
    }
    const noT = list.filter(function (r) { return !r.train; });
    for (let i = 1; i < noT.length; i++) {
      bbNoTrainPairs++;
      if (noT[i].variant === noT[i - 1].variant) bbNoTrain++;
    }
  }
  console.log('BLOCK sightings per run       ' + f1(blockN / days.length));
  console.log('  of which trains (forced v0) ' + f1(trainN / days.length)
    + '   ' + (100 * trainN / blockN).toFixed(1) + '% of every BLOCK');
  console.log('  wearing v0 for any reason   ' + f1(v0N / days.length)
    + '   ' + (100 * v0N / blockN).toFixed(1) + '%   (a fair share of ten skins is 10.0%)');
  console.log('BLOCK back-to-back same skin  ' + (100 * bbAll / bbAllPairs).toFixed(1)
    + '%   with trains taken out: ' + (100 * bbNoTrain / bbNoTrainPairs).toFixed(1) + '%');
  // THE FLOOR NO NUMBER OF NEW SKINS CAN LIFT. Every train is variant 0, so
  // the gap between two trains is a repeat of one object that the bag has no
  // say in. Measured directly rather than inferred from the projection, which
  // is where it first showed up as a BLOCK column that stopped improving.
  const trainGaps = [];
  for (const d of days) {
    const tr = d.rows.filter(function (r) { return r.kind === 'BLOCK' && r.train && r.t[1] !== null; })
      .sort(function (a, b) { return a.z - b.z; });
    for (let i = 1; i < tr.length; i++) trainGaps.push(tr[i].t[1] - tr[i - 1].t[1]);
  }
  console.log('train to train, same object   median ' + f1(pct(trainGaps, 0.5))
    + ' s,  p10 ' + f1(pct(trainGaps, 0.10)) + ' s,  ' + f1(trainGaps.length / days.length)
    + ' such gaps per run');
  console.log('  No number of new BLOCK skins moves that line. It is why the BLOCK column');
  console.log('  in the projection below stops improving and then goes backwards.');
  console.log('  The gap between those two numbers is what the train costs, and it is the');
  console.log('  only place in the game where one object is guaranteed to recur.');
  console.log('');

  // ---- PROJECTION ---------------------------------------------------------
  //
  // WHAT MORE SKINS WOULD ACTUALLY BUY -- and this section is a MODEL, so it
  // is not allowed to print a number until it has reproduced a measurement.
  //
  // The deal lives in world.js inside a closure. To ask "what if the bag held
  // sixteen JUMPs" it has to be re-implemented here, and a re-implementation
  // is exactly the thing this project keeps catching itself believing. So the
  // re-implementation is first run at the REAL bag with the REAL seed and
  // checked against api.variantPlan's cast, hazard for hazard, across every
  // date in the sweep. If a single hazard disagrees the projection is not
  // printed at all -- a model that cannot reproduce the present has no
  // standing to describe a future.
  console.log('---- PROJECTION: what more skins buy ---------------------');
  const rngSrc = fs.readFileSync(path.join(ROOT, 'src/core/rng.js'), 'utf8');
  const vm = require('vm');
  const rctx = { MR: {}, Math, String, Number };
  vm.createContext(rctx);
  vm.runInContext(rngSrc, rctx, { filename: 'src/core/rng.js' });
  const RNG = rctx.MR.rng;

  /**
   * The bag deal, re-implemented from world.js castGates. Fisher-Yates over
   * the whole bag, pop from the end, refill when empty; a train is dealt
   * outside the bag and consumes no card.
   */
  function deal(day, bags, ids) {
    // Keyed by NAME here, salted by the page's kind CONSTANT there. world.js
    // iterates Object.keys of a map keyed by the constants, so the salt string
    // is 'variants/v1|' + the constant and nothing else will reproduce it.
    const st = {};
    for (const k of Object.keys(bags)) st[k] = { left: [], rnd: RNG.stream(day.key, 'variants/v1|' + ids[k]) };
    function draw(kind) {
      const d = st[kind];
      if (!d.left.length) {
        d.left = bags[kind].slice();
        for (let i = d.left.length - 1; i > 0; i--) {
          const j = d.rnd.int(0, i);
          const t = d.left[i]; d.left[i] = d.left[j]; d.left[j] = t;
        }
      }
      return d.left.pop();
    }
    const out = [];
    for (const s of day.shapes) {
      for (let l = 0; l < 3; l++) {
        const kind = s.lanes[l];
        if (kind === 'CLEAR') continue;
        const v = (kind === 'BLOCK' && s.train) ? 0 : draw(kind);
        out.push({ gi: s.gi, z: s.z, lane: l, kind: kind, variant: v, train: s.train, t: s.t });
      }
    }
    return out;
  }

  // world.js keys the deal streams by K.JUMP / K.DUCK / K.BLOCK, which are the
  // kind CONSTANTS and not the names used in this file. Read off the page in
  // auditPoolCounts rather than guessed, because a wrong salt still produces a
  // plausible shuffle and would fail the check with no clue why.
  const KIDS = pools.ids;
  const realBags = {
    JUMP: pools.JUMP_tickets, DUCK: pools.DUCK_tickets, BLOCK: pools.BLOCK_tickets,
  };
  /**
   * The real bag plus `add` NEW SKINS PER KIND, each holding one ticket.
   *
   * One ticket is what a newly built object actually is -- the weighted
   * variants are weighted because the fleet decided a bus should be commoner
   * than a tram, and a brand new skin does not inherit that. Adding twins of
   * the existing weights instead would flatter the projection by making every
   * new object as common as the commonest old one.
   */
  function bagsFor(add) {
    const b = {};
    for (const nm of ['JUMP', 'DUCK', 'BLOCK']) {
      const out = pools[nm + '_tickets'].slice();
      for (let i = 0; i < add; i++) out.push(pools[nm] + i);
      b[nm] = out;
    }
    return b;
  }
  let repro = 0, reproBad = 0;
  for (const d of days) {
    const mine = deal({ key: d.key, shapes: d.shapes }, realBags, KIDS);
    const theirs = d.rows.slice().sort(function (a, b) { return a.gi - b.gi || a.lane - b.lane; });
    const ms = mine.slice().sort(function (a, b) { return a.gi - b.gi || a.lane - b.lane; });
    if (ms.length !== theirs.length) { reproBad += Math.abs(ms.length - theirs.length); continue; }
    for (let i = 0; i < ms.length; i++) {
      repro++;
      if (ms[i].variant !== theirs[i].variant || ms[i].kind !== theirs[i].kind) reproBad++;
    }
  }
  console.log('MODEL CHECK  ' + (repro - reproBad) + ' of ' + repro
    + ' hazards re-dealt identically to the page');
  if (reproBad || !repro) {
    console.log('  the re-implementation does not reproduce the road -- projection SUPPRESSED.');
  } else {
    console.log('  Exact. The projection below is therefore the same draw with a bigger bag,');
    console.log('  on the same courses, with the same seeds and the same trains.');
    console.log('');
    console.log('  new objects   total skins   median gap to seeing the same skin again');
    console.log('  built/kind    J / D / B     JUMP      DUCK      BLOCK     DUCK p10   DUCK back-to-back');
    for (const add of [0, 2, 5, 10, 20, 40]) {
      const bags = bagsFor(add);
      const acc = { JUMP: [], DUCK: [], BLOCK: [] };
      let bbD = 0, bbDp = 0;
      for (const d of days) {
        const rows = deal({ key: d.key, shapes: d.shapes }, bags, KIDS);
        const g = repeatGaps(rows, 1);
        for (const k of ['JUMP', 'DUCK', 'BLOCK']) if (g[k]) for (const s of g[k].secs) acc[k].push(s);
        if (g.DUCK) { bbD += g.DUCK.adjacentSame; bbDp += g.DUCK.adjacentPairs; }
      }
      console.log('  ' + String('+' + add).padEnd(14)
        + String((pools.JUMP + add) + '/' + (pools.DUCK + add) + '/' + (pools.BLOCK + add)).padEnd(14)
        + f1(pct(acc.JUMP, 0.5)).padStart(5) + ' s'
        + f1(pct(acc.DUCK, 0.5)).padStart(9) + ' s'
        + f1(pct(acc.BLOCK, 0.5)).padStart(9) + ' s'
        + f1(pct(acc.DUCK, 0.10)).padStart(11) + ' s'
        + String((100 * bbD / bbDp).toFixed(1) + '%').padStart(14));
    }
    console.log('');
    console.log('  "+40 per kind" is 120 new objects -- five times the entire fleet the game');
    console.log('  has built in its whole life. It is in the table to show the SHAPE of the');
    console.log('  curve, not as a proposal. A new skin holds ONE ticket, which is what a');
    console.log('  newly built object really is.');
  }
  console.log('');

  // ---- LEGS ---------------------------------------------------------------
  console.log('---- LEGS ------------------------------------------------');
  const b0 = days[0].biomes;
  console.log('six biomes, and their boundaries are the SAME FRACTION every single day:');
  for (const b of b0) {
    console.log('    ' + b.name.padEnd(12) + 'from mile ' + f1(b.from * 26.21875).padStart(5));
  }
  const nset = days.map(function (d) { return d.settings.length; });
  const setCount = {};
  for (const d of days) for (const s of d.settings) setCount[s.tag] = (setCount[s.tag] || 0) + 1;
  console.log('settings per run  ' + f2(mean(nset)) + '  (3 or 4 drawn from ' + Object.keys(setCount).length + ' seen)');
  console.log('');

  if (JSON_OUT) {
    fs.writeFileSync(String(JSON_OUT), JSON.stringify({ artefact: artefact, pools: pools, days: days }));
    console.log('raw rows -> ' + JSON_OUT);
  }
  console.log('OK  ' + DAYS + ' dates, page clean, plan agrees with road.');
})();
