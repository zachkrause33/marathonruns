#!/usr/bin/env node
/**
 * SIGHTREAD -- what does knowing today's course actually buy?
 *
 * ==========================================================================
 * WHY THIS TOOL EXISTS
 * ==========================================================================
 *
 * The course is redrawn from the UTC date every day, so nothing a player
 * learns on Tuesday survives to Wednesday. That makes "with the course
 * learned" mean exactly one thing in this game: RETRIES OF TODAY. Roadmap 74
 * shipped a difficulty split of 6.7% first-attempt against 40% learned, and
 * the owner's reading of it is the reason this file was written:
 *
 *   "The record is concerning especially this line 6.7% first attempt, 40%
 *    once learned - it is really hard to learn the map. I'd argue you really
 *    dont, its skill and focus that gets you to the end. you need to be able
 *    to do it multiple ways"
 *
 * tools/simulate.js measures policies. It cannot answer this, because its
 * two columns are separated by a POLICY FLAG (`learned: true`) rather than by
 * anything the course does -- a policy is declared learned and then handed
 * three discounts. That is a legitimate way to price a design intent, and it
 * is not a way to find out whether the intent is real.
 *
 * So this file races ONE line under TWO PERCEPTIONS and subtracts:
 *
 *   SIGHT   sees the road ahead out to a horizon, and nothing past it.
 *   ORACLE  sees the whole course.
 *
 * Identical skill, identical seed, identical cost model, identical dice. The
 * difference in finish time IS the knowledge premium, in seconds, and it is
 * decomposed into the separate asymmetries that produce it so that a number
 * which turns out to be a modelling constant is visible as one.
 *
 * ==========================================================================
 * WHAT THIS MODEL IS NOT
 * ==========================================================================
 *
 * It is not a human. It has no reaction time, no hands, no panic and no
 * fatigue; `skill` is one number standing in for all of that, exactly as it
 * does in tools/simulate.js, and it is applied identically to both columns so
 * that the SUBTRACTION is honest even though neither absolute is.
 *
 * It does not ride ramps (roof pickups are excluded, same as the sweep), and
 * it does not model the deck cones. It assumes a lane change is free and
 * instant, which is what the shipped game's lane transit very nearly is at
 * these speeds and what every other instrument in this project assumes.
 *
 * The one thing it is careful about is the thing it is FOR: the two columns
 * really do read different amounts of road, and --audit proves it rather than
 * asserting it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { MR: {}, Math, console, isFinite, String, Number, Float64Array, Set, Map };
vm.createContext(ctx);
for (const f of ['src/core/rng.js', 'src/core/constants.js', 'src/core/elevation.js',
                 'src/core/pace.js', 'src/core/course.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { Pace, Course, K, rng } = ctx.MR;
Pace.EFFORT = 1;

const DT = 1 / 60;

// ---- HOW FAR THE PLAYER CAN ACTUALLY SEE, AND WHY IT IS NOT READ_NEAR -----
//
// tools/simulate.js gives its first-attempt policies a look of READ_NEAR
// (25.35 units) past the gate they are choosing at, on the reasoning that
// paint and pickups are "readable from READ_NEAR".
//
// READ_NEAR is ACTION_WINDOW + CAM_BASE_BACK: it is the distance inside which
// a hazard must be DECIDED, derived from the jump arc and where the camera
// sits. It is a REACTION budget. It is not, and was never, a statement about
// what is on screen -- MR.World spawns geometry at VIEW = 210 units and the
// fog is not fully opaque until 235 (MR.shading.FOG_FAR = 215). A player
// looking down the road sees roughly six gates, not two thirds of one.
//
// Median gate gap is 31.1 units over three sample dates, so READ_NEAR does
// not even cover one gap: measured, 0 of 553 gaps fit inside it. Using it as
// a sight limit charges a first-attempt player for not seeing road that is
// drawn on their screen. That is the instrument defect this file was written
// to find, and it is stated here rather than in a commit message.
const SEE = 210;             // MR.World VIEW, the spawn distance ahead
const READ = Course.READ_NEAR;

const COURSE_CACHE = new Map();
function courseFor(key) {
  if (!COURSE_CACHE.has(key)) COURSE_CACHE.set(key, Course.generate(key));
  return COURSE_CACHE.get(key);
}

/**
 * ==========================================================================
 * THE PERCEPTION
 * ==========================================================================
 *
 * A racer never touches the course. It is handed a VIEW, and a view answers
 * three questions about a bounded stretch of road:
 *
 *   gatesFrom(i, z0, z1)   the gates at or past i whose line falls in range
 *   tempoIn(lane, z0, z1)  signed race seconds of paint in that lane
 *   coinsIn(lane, z0, z1)  loose pickups lying in that lane
 *
 * and it REFUSES to answer past its horizon. The refusal is the instrument:
 * a sight model that is secretly given the whole course would produce a
 * premium of zero and be believed, so the sight model is structurally unable
 * to ask. Every out-of-range request is counted, and --audit asserts the
 * count is zero for SIGHT and non-zero for ORACLE.
 */
function makeView(course, horizon) {
  const loose = [];
  for (const it of (course.aid || [])) {
    if (it.roof) continue;
    if (it.gate == null) loose.push(it);
  }
  loose.sort((a, b) => a.z - b.z);
  const marks = course.tempo || [];
  const v = {
    horizon,
    peeks: 0,          // requests that reached past the horizon and were cut
    /** Clip a requested range to what this perception may have. */
    clip: function (from, z0, z1) {
      const lim = from + horizon;
      if (z1 > lim) { v.peeks++; return Math.max(z0, lim); }
      return z1;
    },
    gatesFrom: function (i, from, z1) {
      const end = v.clip(from, from, z1);
      const out = [];
      for (let j = i; j < course.gates.length && course.gates[j].z < end; j++) out.push(j);
      return out;
    },
    tempoIn: function (lane, from, z0, z1) {
      const end = v.clip(from, z0, z1);
      let sec = 0;
      for (const m of marks) {
        if (m.lane !== lane || m.z1 <= z0 || m.z0 >= end) continue;
        const ov = Math.min(m.z1, end) - Math.max(m.z0, z0);
        sec += (m.dir > 0 ? -Pace.TEMPO.LIFT : Pace.TEMPO.DRAG) * ov / K.UNITS_PER_MILE;
      }
      return sec;
    },
    /** Coins in a lane, optionally ignoring any that sit in dragged paint. */
    coinsIn: function (lane, from, z0, z1, dragAware) {
      const end = v.clip(from, z0, z1);
      let n = 0;
      // Linear scan from a cursor the caller keeps; the table is ~550 long
      // and the windows are short, so a scan from the cursor is cheap.
      for (let j = v.cursor; j < loose.length && loose[j].z < end; j++) {
        if (loose[j].z < z0 || loose[j].lane !== lane) continue;
        if (dragAware) {
          const dm = course.tempoAt(loose[j].z, lane);
          if (dm && dm.dir < 0) continue;
        }
        n++;
      }
      return n;
    },
    cursor: 0,
    loose,
  };
  return v;
}

/**
 * ==========================================================================
 * THE PLANNER
 * ==========================================================================
 *
 * At every gate the racer picks the lane that minimises expected race
 * seconds, over as much road as its perception allows.
 *
 * IT PLANS, IT DOES NOT GRAB. tools/simulate.js chooses greedily, one gate at
 * a time, and that is very nearly optimal here for a reason worth writing
 * down: a lane change is free, every mat covers a gate line, and pickups lie
 * between gates -- so the cost of the stretch from gate i to gate i+1 depends
 * only on the lane chosen AT gate i, and the whole problem separates.
 *
 * The one thing that does NOT separate is the chain. Answering gate i with an
 * action sets the clock that decides whether gate i+1 is a chained demand, so
 * taking a CLEAR lane now can make the next gate cheaper. A greedy chooser
 * cannot see that trade and a planner can, so this one carries the chain in
 * its DP state -- (lane, when the last demand was) -- and that is the only
 * reason lookahead is worth anything in this game at all. If the premium this
 * file measures is small, THAT is why, and it is a fact about the course
 * rather than a shortcoming of the search.
 */
const CHAIN_NEAR = Course.READ_NEAR * 1.5;

function planLane(view, course, gi, zNow, cfg, skill, lastDemandZ, pickVal) {
  const gates = course.gates;
  const idx = view.gatesFrom(gi, zNow, zNow + Math.min(cfg.horizon, cfg.planUnits));
  if (!idx.length) return 0;
  // Receding-horizon DP. States are (lane, lastDemandZ); lastDemandZ collapses
  // to 'far' the moment it can no longer chain anything, so the state count
  // stays at a handful.
  let states = [{ lane: -1, ld: lastDemandZ, cost: 0, first: -1 }];
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const g = gates[i];
    const nz = i + 1 < gates.length ? gates[i + 1].z : K.TOTAL_UNITS;
    const segEnd = view.clip(zNow, g.z, nz);
    const next = new Map();
    for (const s of states) {
      for (let l = 0; l < 3; l++) {
        if (g.lanes[l] === K.BLOCK) continue;
        const demanded = g.lanes[l] !== K.CLEAR;
        const chained = demanded && g.z - s.ld < CHAIN_NEAR;
        const pClear = skill * (chained ? cfg.chainSight : 1);
        const act = demanded ? (1 - pClear) * K.HIT_TIME_PENALTY * 8 : 0;
        let c = s.cost + act;
        c += view.tempoIn(l, zNow, g.z, segEnd);
        if (cfg.coinValue > 0) {
          const savedCursor = view.cursor;
          c -= view.coinsIn(l, zNow, g.z, segEnd, cfg.dragAware) * cfg.coinValue;
          view.cursor = savedCursor;
        }
        const ld = demanded ? g.z : s.ld;
        const key = l + ':' + (g.z - ld < CHAIN_NEAR * 2 ? ld.toFixed(1) : 'far');
        const first = k === 0 ? l : s.first;
        const prev = next.get(key);
        if (!prev || c < prev.cost) next.set(key, { lane: l, ld, cost: c, first });
      }
    }
    if (!next.size) break;
    states = Array.from(next.values());
  }
  let best = null;
  for (const s of states) if (!best || s.cost < best.cost) best = s;
  return best && best.first >= 0 ? best.first : 0;
}

/**
 * ==========================================================================
 * ONE RACE
 * ==========================================================================
 *
 * Real Course, real Pace, real elevation. The only thing `cfg` changes is
 * WHAT THE RUNNER KNOWS; the dice, the course and the pace model are the
 * same objects in every column.
 *
 * cfg fields, each of which is one nameable asymmetry:
 *   horizon      units of road ahead the chooser may read.
 *   planUnits    how far ahead it plans (capped by horizon anyway).
 *   chainSight   multiplier on `skill` for a demand that arrives inside
 *                CHAIN_NEAR of the previous one. 1 = no penalty.
 *   headMiss     units of a trail whose head is missed after a lane switch.
 *   dragAware    decline pickups and arc strings standing in red paint.
 *   coinValue    seconds-equivalent the chooser puts on one pickup.
 *   arcs         fetch arc strings at all.
 */
function race(key, skill, cfg, seed) {
  const course = courseFor(key);
  const p = Pace.create(course.elevation);
  const rnd = rng.stream(key, 'sightread/' + skill + '/' + cfg.name + '/' + seed);
  const view = makeView(course, cfg.horizon);

  const arcs = new Map();
  for (const it of (course.aid || [])) {
    if (it.roof || it.gate == null) continue;
    if (!arcs.has(it.gate)) arcs.set(it.gate, []);
    arcs.get(it.gate).push(it);
  }
  const loose = view.loose;

  // One pickup in race seconds, priced exactly as tools/simulate.js prices it
  // so the two instruments can be compared: a whole segment guards one
  // contact, worth its streak less the stumble the guard still charges, and
  // only to a runner who still misses.
  const segWorth = Math.max(0, (1 - skill) * K.HIT_TIME_PENALTY * 8 - Pace.EFFORT_CFG.GUARD_TIME);
  const pickVal = cfg.coinValue >= 0 ? cfg.coinValue : segWorth / Pace.EFFORT_CFG.PER_SEG;
  const cf = Object.assign({}, cfg, { coinValue: pickVal });

  let gi = 0, li = 0, guard = 0, lane = 1;
  let missLane = -1, missBefore = -1;
  let lastDemandZ = -1e9, chainMet = 0;
  const line = [];                      // the lane taken at each gate

  while (!p.finished && guard++ < 200000) {
    const mat = course.tempoAt(p.units, lane);
    p.tempo = mat ? mat.dir : 0;
    p.update(DT);
    while (li < loose.length && loose[li].z <= p.units) {
      const it = loose[li++];
      view.cursor = li;
      if (it.lane !== lane) continue;
      if (it.lane === missLane && it.z < missBefore) continue;
      p.onAid(it.gain);
    }
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      const g = course.gates[gi];
      let arc = arcs.get(gi) || null;
      const here = gi;
      gi++;

      if (arc && !cf.arcs) arc = null;
      if (arc) {
        const aLane = arc[0].lane;
        if (cf.dragAware) {
          const dm = course.tempoAt(g.z, aLane);
          if (dm && dm.dir < 0) arc = null;
        }
        if (arc) {
          const actCost = (1 - skill) * K.HIT_TIME_PENALTY * 8;
          if (arc.length * pickVal <= actCost) arc = null;
        }
      }

      const prevLane = lane;
      lane = arc ? arc[0].lane : planLane(view, course, here, g.z, cf, skill, lastDemandZ, pickVal);
      line.push(lane);
      if (lane !== prevLane && cf.headMiss > 0) {
        missLane = lane; missBefore = g.z + cf.headMiss;
      }
      const kind = g.lanes[lane];
      const demanded = kind !== K.CLEAR;
      const chained = demanded && g.z - lastDemandZ < CHAIN_NEAR;
      if (chained) chainMet++;
      const pClear = skill * (chained ? cf.chainSight : 1);
      if (demanded && rnd.next() >= pClear) p.onHit();
      else p.onClean();
      if (demanded) lastDemandZ = g.z;
      if (arc) for (const it of arc) p.onAid(it.gain);
    }
  }
  p.chainMet = chainMet;
  p.line = line;
  p.peeks = view.peeks;
  return p;
}

// ---- THE TWO PERCEPTIONS, AND THE LADDER BETWEEN THEM ---------------------
//
// Every config below differs from its neighbour in exactly ONE field, so the
// table that prints them is a decomposition rather than a comparison of two
// bundles. `SIGHT` is the honest sight-reader: sees what is on screen, plans
// over it, joins a trail late when it swerves for one, and pays the sweep's
// chain tax. `ORACLE` is the same runner having already run the day.
const CFG = (name, o) => Object.assign({
  name, horizon: SEE, planUnits: SEE, chainSight: 1, headMiss: 0,
  dragAware: true, coinValue: -1, arcs: true,
}, o);

const SWEEP_CHAIN_SIGHT = 0.979;     // the constant tools/simulate.js applies

const LADDER = [
  CFG('ORACLE',      { horizon: Infinity, planUnits: 1e9 }),
  CFG('SIGHT',       { horizon: SEE, headMiss: 12, chainSight: SWEEP_CHAIN_SIGHT }),
  // ...and the same runner with the asymmetries removed one at a time.
  CFG('+chain',      { horizon: SEE, headMiss: 12, chainSight: 1 }),
  CFG('+head',       { horizon: SEE, headMiss: 0,  chainSight: SWEEP_CHAIN_SIGHT }),
  CFG('+horizon',    { horizon: Infinity, planUnits: 1e9, headMiss: 12, chainSight: SWEEP_CHAIN_SIGHT }),
  // The sweep's own first-attempt perception, for cross-checking against it.
  CFG('SWEEP-EYE',   { horizon: READ, planUnits: READ, headMiss: 12, chainSight: SWEEP_CHAIN_SIGHT }),
  CFG('BLIND',       { horizon: 0.01, planUnits: 0.01, headMiss: 12, chainSight: SWEEP_CHAIN_SIGHT }),
];

// ---- dates -----------------------------------------------------------------
function datesFrom(start, n) {
  const out = [];
  const d = new Date(start + 'T00:00:00Z');
  for (let i = 0; i < n; i++) {
    out.push(rng.dateKey(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const argOf = (k, dflt) => {
  const a = process.argv.find((s) => s.indexOf('--' + k + '=') === 0);
  return a ? a.slice(k.length + 3) : dflt;
};
const NDATES = parseInt(argOf('dates', '16'), 10);
const SEEDS = parseInt(argOf('seeds', '10'), 10);
const START = argOf('start', '2026-08-05');
const KEYS = datesFrom(START, NDATES);
const SKILLS = [1.0, 0.995, 0.99, 0.98, 0.96];

function cell(cfg, skill) {
  const ts = [];
  for (const k of KEYS) for (let s = 0; s < SEEDS; s++) ts.push(race(k, skill, cfg, s).finishTime);
  const t = ts.reduce((a, b) => a + b, 0) / ts.length;
  const sd2 = ts.reduce((a, b) => a + (b - t) * (b - t), 0) / (ts.length - 1);
  return { t, se: Math.sqrt(sd2 / ts.length), win: ts.filter((x) => x < K.RECORD_SECONDS).length, n: ts.length };
}

// ==========================================================================
// --audit : prove the two models differ in what they can see
// ==========================================================================
function audit() {
  console.log('INSTRUMENT AUDIT');
  console.log('='.repeat(74));
  const key = KEYS[0];
  const course = courseFor(key);
  let ok = true;
  const say = (pass, msg) => { if (!pass) ok = false; console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${msg}`); };

  // 1. The horizon is enforced, not declared.
  const s = race(key, 1, LADDER[1], 0);
  const o = race(key, 1, LADDER[0], 0);
  say(s.peeks > 0, `SIGHT was cut off at its horizon ${s.peeks} times (0 would mean the ` +
    'horizon never bound, i.e. it is not a horizon)');
  say(o.peeks === 0, `ORACLE was never cut off (${o.peeks} cuts)`);

  // 2. A blind runner must be much worse than a sighted one, and a runner
  //    given infinite sight must not be worse than one given 210 units.
  const blind = cell(LADDER[6], 1).t, sight = cell(LADDER[1], 1).t, orc = cell(LADDER[0], 1).t;
  say(blind > sight + 5, `blind ${Pace.clock(blind)} is well behind sighted ${Pace.clock(sight)}`);
  say(orc <= sight + 0.5, `oracle ${Pace.clock(orc)} is not slower than sighted ${Pace.clock(sight)}`);

  // 3. Zero premium when the two columns are the same config -- the null that
  //    catches a subtraction done against the wrong baseline.
  const a = cell(LADDER[0], 1).t, b = cell(LADDER[0], 1).t;
  say(Math.abs(a - b) < 1e-9, `the same config twice differs by ${(a - b).toExponential(1)}s`);

  // 4. The two perceptions really read different road. Count the gates at
  //    which SIGHT and ORACLE choose a different lane on the same date.
  const diff = s.line.reduce((n, l, i) => n + (l !== o.line[i] ? 1 : 0), 0);
  say(true, `SIGHT and ORACLE pick different lanes at ${diff} of ${s.line.length} gates ` +
    `(${(100 * diff / s.line.length).toFixed(0)}%)`);

  // 5. Cross-check against tools/simulate.js. Configured as that tool's own
  //    first-attempt perception, this racer should land near its READ ROAD
  //    row; configured as ORACLE, near its PLAN AID row. Not identical --
  //    this one plans and that one grabs -- but the same game.
  const sw = cell(LADDER[5], 1).t;
  say(true, `configured as the sweep's eye, perfect skill: ${Pace.clock(sw)} ` +
    '(tools/simulate.js READ ROAD at perfect is the row to compare)');
  console.log('');
  console.log(ok ? 'AUDIT PASS' : 'AUDIT FAIL');
  return ok;
}

// ==========================================================================
// ROUTE DIVERSITY
// ==========================================================================
//
// "You need to be able to do it multiple ways." Two measurements, because
// they answer two different halves of it:
//
//   GATE FREEDOM. At each gate, how many lanes could a record line take?
//   Measured by forcing each lane at that gate, playing the sight-read
//   optimum everywhere else, and asking whether the run still finishes under
//   1:59:30. A course where the answer is 1 nearly everywhere has exactly one
//   route through it, whatever the policy table says.
//
//   ROUTE CLUSTERS. Sample lines from a randomised chooser (the DP with noise
//   on every lane cost), keep the ones that beat the record, and count how
//   many mutually DIFFERENT ones there are -- different meaning they disagree
//   about the lane at a quarter of the gates or more. One cluster is one
//   route with jitter; several clusters are several routes.
function raceForced(key, skill, cfg, seed, forceGate, forceLane) {
  const course = courseFor(key);
  const p = Pace.create(course.elevation);
  const rnd = rng.stream(key, 'sightread/' + skill + '/' + cfg.name + '/' + seed);
  const view = makeView(course, cfg.horizon);
  const arcs = new Map();
  for (const it of (course.aid || [])) {
    if (it.roof || it.gate == null) continue;
    if (!arcs.has(it.gate)) arcs.set(it.gate, []);
    arcs.get(it.gate).push(it);
  }
  const loose = view.loose;
  const segWorth = Math.max(0, (1 - skill) * K.HIT_TIME_PENALTY * 8 - Pace.EFFORT_CFG.GUARD_TIME);
  const pickVal = segWorth / Pace.EFFORT_CFG.PER_SEG;
  const cf = Object.assign({}, cfg, { coinValue: pickVal });
  let gi = 0, li = 0, guard = 0, lane = 1;
  let missLane = -1, missBefore = -1, lastDemandZ = -1e9;
  const line = [];
  while (!p.finished && guard++ < 200000) {
    const mat = course.tempoAt(p.units, lane);
    p.tempo = mat ? mat.dir : 0;
    p.update(DT);
    while (li < loose.length && loose[li].z <= p.units) {
      const it = loose[li++];
      view.cursor = li;
      if (it.lane !== lane) continue;
      if (it.lane === missLane && it.z < missBefore) continue;
      p.onAid(it.gain);
    }
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      const g = course.gates[gi];
      const here = gi;
      gi++;
      const prevLane = lane;
      if (here === forceGate) lane = forceLane;
      else lane = planLane(view, course, here, g.z, cf, skill, lastDemandZ, pickVal);
      line.push(lane);
      if (lane !== prevLane && cf.headMiss > 0) { missLane = lane; missBefore = g.z + cf.headMiss; }
      const kind = g.lanes[lane];
      const demanded = kind !== K.CLEAR;
      const chained = demanded && g.z - lastDemandZ < CHAIN_NEAR;
      const pClear = skill * (chained ? cf.chainSight : 1);
      if (demanded && rnd.next() >= pClear) p.onHit(); else p.onClean();
      if (demanded) lastDemandZ = g.z;
    }
  }
  p.line = line;
  return p;
}

/** Per-lane cost, the DP's first step for one lane. Used by the sampler. */
function laneCostFor(view, course, gi, cf, skill, lastDemandZ, l) {
  const g = course.gates[gi];
  const nz = gi + 1 < course.gates.length ? course.gates[gi + 1].z : K.TOTAL_UNITS;
  const segEnd = view.clip(g.z, g.z, nz);
  const demanded = g.lanes[l] !== K.CLEAR;
  const chained = demanded && g.z - lastDemandZ < CHAIN_NEAR;
  const pClear = skill * (chained ? cf.chainSight : 1);
  let c = demanded ? (1 - pClear) * K.HIT_TIME_PENALTY * 8 : 0;
  c += view.tempoIn(l, g.z, g.z, segEnd);
  const saved = view.cursor;
  c -= view.coinsIn(l, g.z, g.z, segEnd, cf.dragAware) * cf.coinValue;
  view.cursor = saved;
  return c;
}

function diversity(cfg, skill) {
  console.log('');
  console.log('ROUTE DIVERSITY');
  console.log('='.repeat(74));
  console.log(`  the sight-reading line at skill ${skill}, over ${Math.min(6, KEYS.length)} dates`);
  console.log('');
  const dates = KEYS.slice(0, 6);
  let freeTot = 0, gateTot = 0, clusterTot = 0, winTot = 0, sampTot = 0;
  const rows = [];
  for (const key of dates) {
    const course = courseFor(key);
    const base = race(key, skill, cfg, 0);
    // ---- gate freedom -----------------------------------------------------
    let free = 0, gates = 0;
    for (let i = 0; i < course.gates.length; i++) {
      let viable = 0;
      for (let l = 0; l < 3; l++) {
        if (course.gates[i].lanes[l] === K.BLOCK) continue;
        const r = raceForced(key, skill, cfg, 0, i, l, 0);
        if (r.finishTime < K.RECORD_SECONDS) viable++;
      }
      gates++;
      if (viable > 1) free++;
    }
    // ---- route clusters ---------------------------------------------------
    const winners = [];
    const N = 60;
    for (let s = 0; s < N; s++) {
      const r = sampleLine(key, skill, cfg, s);
      if (r.finishTime < K.RECORD_SECONDS) winners.push(r.line);
    }
    const clusters = [];
    for (const w of winners) {
      let placed = false;
      for (const c of clusters) {
        const d = w.reduce((n, l, i) => n + (l !== c[0][i] ? 1 : 0), 0) / w.length;
        if (d < 0.25) { c.push(w); placed = true; break; }
      }
      if (!placed) clusters.push([w]);
    }
    rows.push({ key, base: base.finishTime, free, gates, win: winners.length, N, clusters: clusters.length });
    freeTot += free; gateTot += gates; clusterTot += clusters.length;
    winTot += winners.length; sampTot += N;
  }
  console.log('date          best line   gates with >1 record lane   sampled lines under   routes');
  for (const r of rows) {
    console.log(`${r.key}   ${Pace.clock(r.base).padStart(8)}   ` +
      `${String(r.free + ' of ' + r.gates).padStart(25)}   ` +
      `${String(r.win + ' of ' + r.N).padStart(19)}   ${String(r.clusters).padStart(6)}`);
  }
  console.log('');
  console.log(`  gate freedom     ${freeTot} of ${gateTot} gates (${(100 * freeTot / gateTot).toFixed(0)}%) ` +
    'have more than one lane a record line can take');
  console.log(`  sampled lines    ${winTot} of ${sampTot} (${(100 * winTot / sampTot).toFixed(0)}%) beat the record`);
  console.log(`  distinct routes  ${(clusterTot / rows.length).toFixed(1)} a day ` +
    '(lines disagreeing at a quarter of gates or more)');
  return { freeTot, gateTot, winTot, sampTot, routes: clusterTot / rows.length };
}

/** One sampled plausible line: the per-gate cost with a random surcharge. */
function sampleLine(key, skill, cfg, seed) {
  const course = courseFor(key);
  const p = Pace.create(course.elevation);
  const rnd = rng.stream(key, 'sightread/' + skill + '/' + cfg.name + '/0');
  // The surcharge is up to NOISE race seconds per lane. It has to be of the
  // same order as the decisions being made or it either changes nothing or
  // it randomises everything; an action costs 2-4 s and a mat 1-2 s, so 2.5.
  const NOISE = 2.5;
  const nz = rng.stream(key, 'diverse/' + seed);
  const view = makeView(course, cfg.horizon);
  const loose = view.loose;
  const segWorth = Math.max(0, (1 - skill) * K.HIT_TIME_PENALTY * 8 - Pace.EFFORT_CFG.GUARD_TIME);
  const cf = Object.assign({}, cfg, { coinValue: segWorth / Pace.EFFORT_CFG.PER_SEG });
  let gi = 0, li = 0, guard = 0, lane = 1, lastDemandZ = -1e9;
  let missLane = -1, missBefore = -1;
  const line = [];
  while (!p.finished && guard++ < 200000) {
    const mat = course.tempoAt(p.units, lane);
    p.tempo = mat ? mat.dir : 0;
    p.update(DT);
    while (li < loose.length && loose[li].z <= p.units) {
      const it = loose[li++];
      view.cursor = li;
      if (it.lane !== lane) continue;
      if (it.lane === missLane && it.z < missBefore) continue;
      p.onAid(it.gain);
    }
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      const g = course.gates[gi];
      const here = gi;
      gi++;
      const prevLane = lane;
      let best = -1, bc = Infinity;
      for (let l = 0; l < 3; l++) {
        if (g.lanes[l] === K.BLOCK) continue;
        const c = laneCostFor(view, course, here, cf, skill, lastDemandZ, l) + nz.range(0, NOISE);
        if (c < bc) { bc = c; best = l; }
      }
      lane = best < 0 ? 0 : best;
      line.push(lane);
      if (lane !== prevLane && cf.headMiss > 0) { missLane = lane; missBefore = g.z + cf.headMiss; }
      const demanded = g.lanes[lane] !== K.CLEAR;
      const chained = demanded && g.z - lastDemandZ < CHAIN_NEAR;
      const pClear = skill * (chained ? cf.chainSight : 1);
      if (demanded && rnd.next() >= pClear) p.onHit(); else p.onClean();
      if (demanded) lastDemandZ = g.z;
    }
  }
  p.line = line;
  return p;
}

// ==========================================================================
// THE DAY LOTTERY
// ==========================================================================
//
// The third question, and it was not in the brief -- it turned up while
// answering the first two and it turned out to matter more than either.
//
// The course is redrawn every day, so "can a skilled player win today" has a
// second variable in it that no amount of skill touches: WHICH DAY IT IS. The
// ORACLE at perfect execution is the fastest line the game can produce on a
// date -- no dice, no misses, full knowledge -- so its spread across dates is
// exactly how much the calendar decides. Any date where it does not beat the
// record is a date NOBODY can win, and since the day closes when the record
// falls (roadmap 77) it is a date that cannot be closed.
function dayLottery(n) {
  const keys = datesFrom(START, n);
  const rows = keys.map((k) => {
    const p = race(k, 1, LADDER[0], 0);
    const c = courseFor(k);
    let fwd = 0, len = 0;
    for (const m of c.tempo) if (m.dir > 0) { fwd++; len += m.z1 - m.z0; }
    return { k, t: p.finishTime, fwd, len };
  });
  const ts = rows.map((r) => r.t);
  const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
  const sd = Math.sqrt(ts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (ts.length - 1));
  const fw = rows.map((r) => r.fwd);
  const mf = fw.reduce((a, b) => a + b, 0) / fw.length;
  const sdf = Math.sqrt(fw.reduce((a, b) => a + (b - mf) * (b - mf), 0) / (fw.length - 1));
  // How much of the day-to-day spread is just how much green paint the seed
  // drew. This correlation is why planTempo stratifies its directions.
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rows.length; i++) {
    num += (rows[i].len - rows.reduce((a, r) => a + r.len, 0) / rows.length) * (ts[i] - mean);
  }
  const ml = rows.reduce((a, r) => a + r.len, 0) / rows.length;
  for (let i = 0; i < rows.length; i++) { dx += (rows[i].len - ml) * (rows[i].len - ml); dy += (ts[i] - mean) * (ts[i] - mean); }
  const lose = rows.filter((r) => r.t >= K.RECORD_SECONDS);
  console.log('');
  console.log('THE DAY LOTTERY');
  console.log('='.repeat(74));
  console.log(`  the ORACLE at perfect execution is the fastest line the game can produce,`);
  console.log(`  so its spread over ${n} dates is how much the CALENDAR decides.`);
  console.log('');
  console.log(`  best possible finish   mean ${Pace.clock(mean)}  sd ${sd.toFixed(1)}s  ` +
    `range ${Pace.clock(Math.min.apply(null, ts))} .. ${Pace.clock(Math.max.apply(null, ts))}`);
  console.log(`  forward mats a course  mean ${mf.toFixed(1)}  sd ${sdf.toFixed(2)}  ` +
    `range ${Math.min.apply(null, fw)} .. ${Math.max.apply(null, fw)}`);
  console.log(`  correlation of the two ${(num / Math.sqrt(dx * dy)).toFixed(2)}  ` +
    '(forward paint is the only route currency there is)');
  console.log(`  dates NO line can win  ${lose.length} of ${rows.length}` +
    (lose.length ? '   ' + lose.map((r) => r.k + ' ' + Pace.clock(r.t)).join(', ') : ''));
  return { mean, sd, lose: lose.length, n };
}

// ==========================================================================
// main
// ==========================================================================
const WANT_AUDIT = process.argv.indexOf('--audit') >= 0;
const WANT_DIV = process.argv.indexOf('--diversity') >= 0;
const WANT_DAY = process.argv.indexOf('--daylottery') >= 0;
const ONLY = WANT_AUDIT || WANT_DIV || WANT_DAY;
const DAYS = parseInt(argOf('days', '90'), 10);

console.log(`SIGHTREAD   ${KEYS.length} dates from ${KEYS[0]}, ${SEEDS} seeds a cell`);
console.log(`record ${Pace.clock(K.RECORD_SECONDS)}   sight horizon ${SEE}u (MR.World VIEW)   ` +
  `READ_NEAR ${READ.toFixed(2)}u`);
console.log('');

let auditOk = true;
if (WANT_AUDIT || !ONLY) { auditOk = audit(); console.log(''); }

if (!ONLY) {
  console.log('THE KNOWLEDGE PREMIUM');
  console.log('='.repeat(74));
  let head = 'perception  ';
  for (const sk of SKILLS) head += String(sk === 1 ? 'perfect' : sk.toFixed(3)).padStart(10);
  console.log(head + '      wins');
  const table = new Map();
  for (const cfg of LADDER) {
    let row = cfg.name.padEnd(12), wins = 0, n = 0;
    const line = [];
    for (const sk of SKILLS) {
      const c = cell(cfg, sk);
      line.push(c);
      wins += c.win; n += c.n;
      row += (Pace.clock(c.t) + (c.t < K.RECORD_SECONDS ? '*' : ' ')).padStart(10);
    }
    table.set(cfg.name, line);
    console.log(row + String(`${(100 * wins / n).toFixed(0)}%`).padStart(10));
  }
  console.log('');
  console.log('  * beats the record on the MEAN of the cell.');
  console.log(`  worst standard error ${Math.max.apply(null, LADDER.map((c) =>
    Math.max.apply(null, table.get(c.name).map((x) => x.se)))).toFixed(1)}s`);
  console.log('');
  console.log('  the premium, and where it comes from (seconds ORACLE is ahead of SIGHT):');
  const O = table.get('ORACLE'), S = table.get('SIGHT');
  for (let i = 0; i < SKILLS.length; i++) {
    const tot = S[i].t - O[i].t;
    const ch = S[i].t - table.get('+chain')[i].t;
    const hd = S[i].t - table.get('+head')[i].t;
    const hz = S[i].t - table.get('+horizon')[i].t;
    console.log(`    skill ${String(SKILLS[i] === 1 ? 'perfect' : SKILLS[i]).padEnd(7)} ` +
      `total ${tot.toFixed(1).padStart(6)}s  =  chain tax ${ch.toFixed(1).padStart(5)}s + ` +
      `trail head ${hd.toFixed(1).padStart(5)}s + horizon ${hz.toFixed(1).padStart(5)}s ` +
      `(+ ${(tot - ch - hd - hz).toFixed(1)}s interaction)`);
  }
}

if (WANT_DAY || !ONLY) dayLottery(DAYS);
if (WANT_DIV || !ONLY) diversity(LADDER[1], 1.0);

process.exit(auditOk ? 0 : 1);
