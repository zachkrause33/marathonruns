#!/usr/bin/env node
/**
 * THE TWO MECHANICS UNDER TEST, MEASURED.
 *
 *   node tools/mechanics.js              everything below, 365 days
 *   node tools/mechanics.js --days 90    a shorter sweep
 *
 * Sections, in the order a reader needs them:
 *
 *   identity     flags off is BIT-IDENTICAL to the generator before either
 *                mechanic existed
 *   guard        Course.DECK_Y still equals Collision.BOX[BLOCK].yMax
 *   narrow       how narrow the road already gets today, and how narrow lane
 *                closure makes it -- and whether each closure is a REST or a
 *                DECISION
 *   ramp         how many, how long a ride, whether the fall lands on road the
 *                course guarantees is clear, and what is waiting in the lane
 *   flank        the hole this pass closed on the owner's instruction: a BLOCK
 *                train is one gate carrying 17.9 units of vehicle, so swerving
 *                into one between gate lines used to touch nothing. Three
 *                probes -- side, head-on, and a clean pass as the control
 *   transit      that a lane path solvable() proved is still walkable now the
 *                flanks are solid
 *   ride         the same course raced over the roofs and around them, and the
 *                shipped course raced by a bot that reads the road and one
 *                that reads only the gate table
 *   roofaid      a roof pickup is collectable on the roof and nowhere else
 *   pace         what each mechanic does to the finish time and the record
 *
 * ---- WHAT THIS INSTRUMENT GETS WRONG IF NOBODY WATCHES IT ----------------
 *
 * Rule 3 says audit the instrument as hard as the work, and every instrument
 * this project has written was wrong first, always in the direction that
 * flattered the thing measured. The five ways this one could have been:
 *
 *  1. MEASURING A CLOSURE IN GATES. A closure of three gates is 60 units at one
 *     spacing and 130 at another, and the player experiences the units. Every
 *     length here is in world units and, where it matters, in seconds at the
 *     local top speed.
 *
 *  2. CALLING A CLOSURE SOLVABLE BECAUSE Course.generate SAID SO. It cannot say
 *     otherwise: after 24 failed attempts generate() DEGRADES to an all-clear
 *     gate, so an unsolvable course is unreachable by construction and
 *     "solvable on all 365 days" is a tautology. What a bad mechanic actually
 *     does is make the generator give up more often, and nothing counted that
 *     until this pass added course.tally. The degrade count is reported here,
 *     and it is the number that matters.
 *
 *  3. SIZING THE FALL AT RECORD PACE. A slower runner falls a shorter distance,
 *     so record pace flatters the landing margin. The fall is sized at the
 *     FASTEST the runner can be at that point -- the pace floor plus the local
 *     descent, which is the same quantity Course.actionWindowAt is derived
 *     against -- and the margin reported is the minimum over every ramp on
 *     every day, not the mean.
 *
 *  4. CALLING A CLOSURE A DECISION BECAUSE IT CONTAINS A HAZARD. It is only a
 *     decision if the player can get it WRONG. A closure that leaves two lanes
 *     open with one of them CLEAR at every gate is answerable by sitting in the
 *     clear lane, so it is a rest however many hazards are in the other one.
 *     The test below is per gate and asks whether EVERY open lane demands an
 *     action -- see restOrDecision.
 *
 *  5. COUNTING ONLY THE CLOSURES IT PLANTED. The generator already produces
 *     one-lane stretches by accident, because two trains can overlap. Reporting
 *     only planned closures would credit the mechanic with inventing something
 *     the game already does. The same scan runs at NARROW = 0 and NARROW = 1
 *     and both numbers are printed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
const DAYS = parseInt(arg('days', 365), 10);

// ---- the sandbox ---------------------------------------------------------
// The REAL modules, including collision.js and player.js, so the pass-through
// probe below drives the shipped state machine rather than a description of it.
// collision.js reads MR.Runner.HEIGHT and nothing else off the renderer, so a
// one-field stub is the whole of what a headless player needs -- and the stub
// carries the shipped value rather than a guess, checked below.
const ctx = {
  MR: { Runner: { HEIGHT: 1.78 } },
  Math, console, isFinite, String, Number, Set, Array, JSON, Float64Array,
  parseFloat, parseInt, Object,
};
vm.createContext(ctx);
for (const f of ['src/core/rng.js', 'src/core/constants.js', 'src/core/elevation.js',
                 'src/core/pace.js', 'src/core/course.js',
                 'src/game/collision.js', 'src/game/player.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { Course, Collision, Player, Pace, K, Elevation } = ctx.MR;

let fail = 0;
function bad(msg) { fail++; console.log('  ! ' + msg); }

function keys(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(ctx.MR.rng.dateKey(new Date(Date.UTC(2026, 0, 1) + i * 86400000)));
  }
  return out;
}
const KEYS = keys(DAYS);
// The same four dates tools/simulate.js averages over, so every finish time in
// this file sits alongside the ones that already gate the build.
const PKEYS_RIDE = ['2026-08-05', '2026-08-06', '2026-12-25', '2027-03-14'];

function withFlags(narrow, ramp, fn) {
  Course.NARROW = narrow; Course.RAMP = ramp;
  try { return fn(); } finally { Course.NARROW = 0; Course.RAMP = 0; }
}

/** The fastest the runner can be at z: the pace floor plus the local grade. */
function topSpeedAt(elev, z) {
  const g = elev ? elev.gradeAt(z) : 0;
  const pace = K.FLOOR_PACE + K.GRADE_SPM * Math.min(0, g);   // descent only
  return (K.UNITS_PER_MILE * K.TIME_SCALE) / pace;
}

console.log(`\n=== identity: flags off must be the generator that shipped ===\n`);
/**
 * TWO HASHES OVER THE WHOLE CALENDAR, and it used to be one.
 *
 * These are golden numbers and they are SUPPOSED to be brittle. Any deliberate
 * change to course generation breaks one, and the correct response is to re-take
 * that one and say so in docs/roadmap.md -- never to delete the check. What they
 * guard is narrower and worth keeping: that NARROW = 0 and RAMP = 0 draw no
 * random numbers, so the seeded stream stays in phase and today's course is
 * today's course whether or not the mechanics exist.
 *
 * ---- WHY IT IS TWO NOW ------------------------------------------------
 *
 * The single hash covered gates AND aid, which meant a change to where the
 * bottles go read as "course generation has MOVED" -- indistinguishable from a
 * flag leaking into the gate stream, which is the thing this check exists to
 * catch. The aid placement rule was rewritten (see the long note in
 * generateAid) and the gate stream was deliberately not touched, and a single
 * hash cannot say that. Split, it says it precisely: GATES is the number that
 * has never moved and must not, and AID moved once, on purpose, and here is
 * the new one.
 */
// ---- RE-TAKEN ONCE, AND IT HAD ALREADY BEEN STALE FOR TWO COMMITS --------
//
// It was d24862235d30ff68daf8e6142d7162f1f230b6e1, described here as "unmoved
// since before either mechanic existed", and the description had stopped being
// true without this line changing.
//
// 7b0a1d2 "The opening two miles were a road with one thing on it" retuned
// makeGate's nHaz thresholds so the second hazard arrives earlier. That is a
// deliberate change to gate generation and it is a good one; what it did not do
// is re-take this number, so from that commit onward `mechanics --identity`
// reported "GATE generation has MOVED" on every run -- which is exactly the
// message a FLAG LEAK produces, and the check had therefore been announcing a
// false alarm indistinguishable from the true one it exists to raise.
//
// BISECTED RATHER THAN ASSUMED, because "it was probably already broken" is the
// most dangerous sentence available to whoever re-takes a golden number. The
// identity hash was recomputed from each commit's OWN course.js:
//
//   c32e6ea  d24862235d30ff68daf8e6142d7162f1f230b6e1   <- matches this file
//   7b0a1d2  e9f8d87fa92e7a5d62a89f660964441e8c227a45   <- moved here
//   b9b2170  e9f8d87fa92e7a5d62a89f660964441e8c227a45
//   EFFORT   e9f8d87fa92e7a5d62a89f660964441e8c227a45   <- this pass, flags off
//
// So the surge work is bit-identical to the commit before it at EFFORT = 0,
// which is the property this check is for, and the number below is 7b0a1d2's.
// Recorded in docs/roadmap.md.
const BASELINE_GATES = 'e9f8d87fa92e7a5d62a89f660964441e8c227a45';
// Re-taken twice. Once deliberately, when the aid placement rule was rewritten
// so a bottle stands behind an obstacle rather than in open road (it was
// 7f17eb4893b067571344191ddd6478b4f8da3329); and once here, for the same reason
// and at the same commit as the gate hash above -- aid hangs off the gate
// table, so a gate change moves it. It was
// e81209a3dd064fbebaf5c7253b4d3ac0c634d39b. See docs/roadmap.md.
const BASELINE_AID = 'ae74e0eef42e5eca0774bc0721f684dc9bb67dfe';
/**
 * ---- THE FLAGS ARE FORCED OFF HERE, AND THAT IS NOT A WEAKENING ----------
 *
 * This used to hash `Course.generate` at whatever the DEFAULTS happened to be,
 * and called the result "flags off" -- true only for as long as both flags
 * shipped at zero. The day RAMP ships at 1 that sentence quietly becomes false
 * and the check reports "GATE generation has MOVED", which is indistinguishable
 * from the thing it exists to catch: a flag leaking into the seeded stream.
 *
 * The invariant being protected is not "the defaults are zero". It is "NARROW
 * and RAMP draw no random numbers when OFF, so today's course is today's course
 * whether or not the mechanics exist". So the flags are now SET to zero rather
 * than assumed to be, and the golden numbers keep meaning exactly what they
 * always meant -- including through a release that turns a mechanic on. Neither
 * baseline moves, which is the point: if either does, something really did leak.
 */
(function identity() {
  const n0 = Course.NARROW, r0 = Course.RAMP;
  // ...and EFFORT, which is the third flag and the one that moves the most.
  // It plans surge zones BEFORE the gates and widens the action window inside
  // them, so at EFFORT > 0 the course is legitimately a different course and
  // this hash SHOULD differ. Forced off here for the same reason the other two
  // are: the invariant is not "the defaults are zero", it is "a flag draws no
  // random number when it is off", and that is what the baseline proves.
  const e0 = Pace.EFFORT;
  Course.NARROW = 0; Course.RAMP = 0; Pace.EFFORT = 0;
  const hg = crypto.createHash('sha1');
  const ha = crypto.createHash('sha1');
  for (const key of keys(365)) {
    const c = Course.generate(key);
    hg.update(JSON.stringify(c.gates));
    ha.update(JSON.stringify(c.aid));
  }
  Course.NARROW = n0; Course.RAMP = r0; Pace.EFFORT = e0;
  const gotG = hg.digest('hex'), gotA = ha.digest('hex');
  console.log(`  shipped defaults     NARROW=${n0} RAMP=${r0}   (hashes below are with both forced OFF)`);
  console.log(`  365-day gate hash    ${gotG}`);
  console.log(`  365-day aid hash     ${gotA}`);
  let ok = true;
  if (BASELINE_GATES && gotG !== BASELINE_GATES) {
    ok = false;
    bad(`GATE generation has MOVED at NARROW=0 RAMP=0 (expected ${BASELINE_GATES}).`);
    console.log('    Either a flag is drawing from the seeded stream when it should not,');
    console.log('    or gate generation was deliberately changed -- in which case re-take');
    console.log('    this hash and record why in docs/roadmap.md.');
  }
  if (BASELINE_AID && gotA !== BASELINE_AID) {
    ok = false;
    bad(`AID placement has MOVED (expected ${BASELINE_AID}). Re-take and record why.`);
  }
  if (ok) console.log('  flags off is bit-identical to the recorded baselines  OK');
})();

console.log(`\n=== guard: duplicated constants ===\n`);
(function guard() {
  // Same class of guard tools/lib/fairness.js already runs for HAZARD_HALF_Z,
  // and here for the same reason: course.js cannot read MR.Collision, because
  // collision.js loads after it and generation runs headless where it is not
  // loaded at all. So the number is duplicated and then checked where both are
  // live -- which, unlike the browser-only guard, is here.
  const a = Course.DECK_Y, b = Collision.BOX[K.BLOCK].yMax;
  console.log(`  Course.DECK_Y ${a}   Collision.BOX[BLOCK].yMax ${b}`);
  if (a !== b) bad(`the ramp deck is not the top of the box it stands on (${a} vs ${b})`);
  const r = ctx.MR.Runner.HEIGHT, c = Collision.PLAYER_STAND_TOP;
  if (r !== c) bad(`this harness stubs Runner.HEIGHT at ${r}, collision reads ${c}`);
  const audit = Collision.audit();
  if (!audit.ok) for (const n of audit.notes) bad('collision audit: ' + n);
  if (!fail) console.log('  the deck is the box top, and the collision audit is clean  OK');
})();

// ---- lane closure --------------------------------------------------------
/**
 * A gate is a REST when at least one lane the player may enter is CLEAR: they
 * can answer it by standing still. It is a DECISION when every enterable lane
 * demands a jump or a slide -- which the game already ships as the full-width
 * gate, at 62% of gates at the top of the difficulty curve.
 */
function restGate(lanes) {
  for (let l = 0; l < 3; l++) if (lanes[l] === K.CLEAR) return true;
  return false;
}

/** Maximal runs of consecutive gates with at most `max` lanes open, in units. */
function narrowRuns(gates, max) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= gates.length; i++) {
    const open = i < gates.length
      ? gates[i].lanes.filter((l) => l !== K.BLOCK).length : 99;
    if (open <= max) { if (start < 0) start = i; continue; }
    if (start >= 0) {
      // In UNITS, from the first constrained gate line to the last. A single
      // constrained gate is a run of length zero and is still counted -- the
      // constraint is real, it just has no depth.
      runs.push({
        from: start, to: i - 1,
        z0: gates[start].z, z1: gates[i - 1].z,
        units: gates[i - 1].z - gates[start].z,
        gates: i - start,
        rest: gates.slice(start, i).every((g) => restGate(g.lanes)),
      });
      start = -1;
    }
  }
  return runs;
}

function narrowScan(narrow) {
  const acc = {
    days: 0, gates: 0, degraded: 0, attempts: 0, planned: 0, abandoned: 0,
    one: [], two: [], oneRest: 0, oneDecision: 0, invalid: 0,
    // EXPOSURE, in units of road, which is the number the player experiences.
    // The run COUNT flatters a mechanic that produces many tiny constraints and
    // the run LENGTH flatters one that produces a few long ones; the share of
    // the course spent constrained is neither.
    oneUnits: 0, twoUnits: 0, total: 0,
    // Does a corridor ASK more or less than open road? Counted per gate, over
    // the lanes the player may actually enter.
    corridorGates: 0, corridorAction: 0, allGates: 0, allAction: 0,
  };
  for (const key of KEYS) {
    const c = withFlags(narrow, 0, () => Course.generate(key));
    acc.days++;
    acc.gates += c.gates.length;
    acc.total += K.TOTAL_UNITS;
    acc.degraded += c.tally.degraded;
    acc.attempts += c.tally.attempts;
    acc.planned += c.tally.narrowings;
    acc.abandoned += c.tally.narrowAbandoned;
    if (!c.valid.ok) { acc.invalid++; bad(`${key}: ${c.valid.errors[0]}`); }
    for (const g of c.gates) {
      acc.allGates++;
      if (!restGate(g.lanes)) acc.allAction++;
    }
    for (const r of narrowRuns(c.gates, 1)) {
      acc.one.push(r);
      acc.oneUnits += r.units;
      if (r.rest) acc.oneRest++; else acc.oneDecision++;
      for (let i = r.from; i <= r.to; i++) {
        acc.corridorGates++;
        if (!restGate(c.gates[i].lanes)) acc.corridorAction++;
      }
    }
    for (const r of narrowRuns(c.gates, 2)) { acc.two.push(r); acc.twoUnits += r.units; }
  }
  return acc;
}

/** Runs of at least two gates -- a STRETCH, as opposed to a single tight gate. */
function stretches(list) { return list.filter((r) => r.gates >= 2); }

function stat(list, f) {
  if (!list.length) return { n: 0, mean: 0, max: 0, p50: 0 };
  const v = list.map(f).sort((a, b) => a - b);
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    max: v[v.length - 1],
    p50: v[Math.floor(v.length / 2)],
  };
}

console.log(`\n=== narrow: how narrow the road gets, over ${DAYS} days ===\n`);
const nOff = narrowScan(0);
const nOn = narrowScan(1);
console.log('                                  NARROW=0        NARROW=1');
for (const [label, f] of [
  ['gates per day', (a) => (a.gates / a.days).toFixed(1)],
  ['generator gave up (degrades)', (a) => String(a.degraded)],
  ['solvable attempts per gate', (a) => (a.attempts / a.gates).toFixed(2)],
  ['closures planted', (a) => String(a.planned)],
  ['closures abandoned as unsolvable', (a) => String(a.abandoned)],
  ['ONE lane open -- occurrences', (a) => String(a.one.length)],
  ['  per day', (a) => (a.one.length / a.days).toFixed(2)],
  ['  of those, runs of 2+ gates', (a) => String(stretches(a.one).length)],
  ['  median length of those, units', (a) => stat(stretches(a.one), (r) => r.units).p50.toFixed(1)],
  ['  longest, units', (a) => stat(a.one, (r) => r.units).max.toFixed(1)],
  ['  share of the race, %', (a) => (100 * a.oneUnits / a.total).toFixed(2)],
  ['  RESTS (some open lane CLEAR)', (a) => String(a.oneRest)],
  ['  DECISIONS (every open lane acts)', (a) => String(a.oneDecision)],
  ['TWO or fewer lanes -- occurrences', (a) => String(a.two.length)],
  ['  share of the race, %', (a) => (100 * a.twoUnits / a.total).toFixed(2)],
  ['gates demanding an action, %', (a) => (100 * a.allAction / a.allGates).toFixed(1)],
  ['  inside a one-lane corridor, %', (a) => (a.corridorGates ? (100 * a.corridorAction / a.corridorGates).toFixed(1) : '-')],
  ['courses failing validate()', (a) => String(a.invalid)],
]) {
  console.log('  ' + label.padEnd(32) + String(f(nOff)).padStart(10) + String(f(nOn)).padStart(16));
}

// ---- the ramp ------------------------------------------------------------
console.log(`\n=== ramp: the rideable roof, over ${DAYS} days ===\n`);
const rampAcc = {
  n: 0, days: 0, rides: [], margins: [], landing: { CLEAR: 0, JUMP: 0, DUCK: 0, BLOCK: 0, END: 0 },
  gateInFall: 0, gateInRide: 0, degraded: 0, gates: 0, invalid: 0,
};
for (const key of KEYS) {
  const c = withFlags(0, 1, () => Course.generate(key));
  rampAcc.days++;
  rampAcc.gates += c.gates.length;
  rampAcc.degraded += c.tally.degraded;
  if (!c.valid.ok) { rampAcc.invalid++; bad(`${key}: ${c.valid.errors[0]}`); }
  const gz = c.gates.map((g) => g.z);
  for (const r of c.ramps) {
    rampAcc.n++;
    const v = topSpeedAt(c.elevation, r.z1);
    // The ride, in units and in the seconds a runner at the local TOP speed
    // spends on it -- the shortest honest answer, not the most flattering.
    rampAcc.rides.push({ units: r.z1 - r.z0, secs: (r.z1 - r.z0) / v, roof: r.z1 - r.z0 - r.run });
    // Where the fall lands, against the next GATE LINE.
    //
    // ---- AND THE FINISH IS NOT A GATE, WHICH THIS GOT WRONG -------------
    //
    // The first version substituted K.TOTAL_UNITS when a ramp was the last gate
    // on the course, and then reported the distance to the TAPE as a landing
    // margin. That fired the trap assertion at 3.0 units on 2026-12-02 -- and
    // the assertion was right that something was wrong and wrong about what.
    // There is no hazard at the finish, so landing near it costs the player
    // nothing; what it actually broke was the run-in, which is a different
    // problem with a different fix (course.js now refuses a ramp past f=0.90).
    // A margin against a thing that cannot be hit is not a margin, so those
    // ramps are counted as END and left out of the statistic entirely.
    const nextI = gz.findIndex((z) => z > r.z1);
    const land = r.z1 + 0.50 * v;              // FALL_TIME in player.js
    if (nextI < 0) {
      rampAcc.landing.END++;
      bad(`${key}: a ramp at z ${r.z0.toFixed(0)} (f=${(r.z0 / K.TOTAL_UNITS).toFixed(3)}) is the `
        + 'last gate on the course -- its roof runs into the finish run-in');
    } else {
      const nextZ = gz[nextI];
      rampAcc.margins.push({ margin: nextZ - land, key, z: r.z0 });
      if (nextZ - land < 0) rampAcc.gateInFall++;
      // Anything standing in the lane the runner is committed to when he lands.
      rampAcc.landing[['CLEAR', 'JUMP', 'DUCK', 'BLOCK'][c.gates[nextI].lanes[r.lane]]]++;
    }
    // A gate INSIDE the vehicle would mean the runner resolving a hazard while
    // standing on a lorry roof, which nothing in the audit can see.
    for (let i = 0; i < gz.length; i++) if (gz[i] > r.z0 && gz[i] < r.z1) rampAcc.gateInRide++;
  }
}
const ride = stat(rampAcc.rides, (r) => r.units);
const secs = stat(rampAcc.rides, (r) => r.secs);
const marg = stat(rampAcc.margins, (m) => m.margin);
console.log(`  ramps                       ${rampAcc.n}  (${(rampAcc.n / rampAcc.days).toFixed(2)} per day)`);
console.log(`  gates per day               ${(rampAcc.gates / rampAcc.days).toFixed(1)}   against ${(nOff.gates / nOff.days).toFixed(1)} with no ramps`);
console.log(`  generator gave up           ${rampAcc.degraded}`);
console.log(`  ride length, units          median ${ride.p50.toFixed(1)}   max ${ride.max.toFixed(1)}`);
console.log(`  ride length, seconds        median ${secs.p50.toFixed(2)}   max ${secs.max.toFixed(2)}   (at the local TOP speed)`);
console.log(`  landing margin, units       min ${marg.n ? Math.min(...rampAcc.margins.map((m) => m.margin)).toFixed(1) : '-'}   median ${marg.p50.toFixed(1)}`);
console.log(`  falls that reach a gate     ${rampAcc.gateInFall}`);
console.log(`  gates inside a vehicle      ${rampAcc.gateInRide}`);
console.log(`  what is in the lane you land in:`);
for (const k of ['CLEAR', 'JUMP', 'DUCK', 'BLOCK', 'END']) {
  console.log(`    ${k.padEnd(6)} ${String(rampAcc.landing[k]).padStart(5)}`);
}
console.log(`  courses failing validate()  ${rampAcc.invalid}`);
if (rampAcc.gateInFall) bad(`${rampAcc.gateInFall} falls are still in the air at the next gate -- a free clear`);
if (rampAcc.gateInRide) bad(`${rampAcc.gateInRide} gates sit inside a rideable vehicle`);

/**
 * ---- CAN THE PLAYER ANSWER WHAT THEY LAND IN? --------------------------
 *
 * `solvable()` proves a path that never uses a ramp. A player who takes one is
 * off that path, so the roof owes its own proof, and 10% of ramps put a BLOCK
 * in the lane the runner falls back into.
 *
 * The worst case is two lane changes, not one: solvable() allows two BLOCKs at
 * a gate, so the lane the runner lands in and the lane next to it can both be
 * walls, and the only way out is two lanes across. changeLane will not serve a
 * second move until laneT >= 0.55, so two changes cost 1.55 * LANE_CHANGE_TIME,
 * and that is priced at the FASTEST the runner can be there.
 */
(function landing() {
  const worst = rampAcc.margins.reduce((a, b) => (b.margin < a.margin ? b : a),
    { margin: Infinity, key: '-', z: 0 });
  const need = 1.55 * K.LANE_CHANGE_TIME * ((K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE);
  console.log(`  two lane changes need         ${need.toFixed(1)}u at the pace floor`);
  console.log(`  tightest landing on record    ${worst.margin.toFixed(1)}u  (${worst.key} at z ${worst.z.toFixed(0)})`);
  if (rampAcc.n && worst.margin < need) {
    bad(`a fall lands ${worst.margin.toFixed(1)}u short of the next gate and needs ${need.toFixed(1)}u `
      + 'to get out of a doubly-blocked lane -- the roof would be a trap');
  }
})();

// Aid on the roof. Without it the ramp is strictly dominated; see the note in
// generateAid. Counted here so the claim is a number rather than an intention.
(function roofAid() {
  let roof = 0, road = 0;
  for (const key of KEYS) {
    const c = withFlags(0, 1, () => Course.generate(key));
    for (const a of c.aid) { if (a.roof) roof++; else road++; }
  }
  console.log(`  aid items on roofs            ${roof}   against ${road} on the road`);
  if (rampAcc.n && roof !== rampAcc.n) {
    bad(`${rampAcc.n} ramps but ${roof} roof pickups -- the reward does not match the ride`);
  }
})();

// ---- the flank -----------------------------------------------------------
console.log(`\n=== flank: a vehicle you can see is a vehicle you can hit ===\n`);
/**
 * THE OWNER'S DECISION, MEASURED THREE WAYS.
 *
 * The shipped game let you run the whole length of a bus: contact was a single
 * plane at gate.z (player.resolveGates) and a BLOCK train is ONE gate carrying
 * up to 17.9 units of vehicle. The owner was shown that, told plainly that
 * closing it makes the game harder, and chose to close it -- "a vehicle you can
 * see is a vehicle you can hit."
 *
 * Every probe below drives the REAL MR.Player, in main.js's own order (update,
 * resolveDeck, resolveGates), on a SHIPPED course with both scalars at zero. A
 * description of the state machine would not have caught the per-frame re-fire
 * the previous pass found, and would not catch a double charge now.
 *
 * ---- WHAT THIS INSTRUMENT WOULD GET WRONG WITHOUT ALL THREE -------------
 *
 * SIDE alone flatters the fix: it proves the flank now bites and says nothing
 * about what it costs elsewhere. So:
 *
 *   SIDE     swerve into the flank mid-vehicle. Must record EXACTLY ONE
 *            contact -- zero is the shipped hole, and more than one is the
 *            per-frame re-fire that made four incidents read as 27.
 *   HEAD     take the same vehicle head-on at its gate line, which the game
 *            already charged for. Must STILL be exactly one contact, and must
 *            not also hand back a clean gate: resolveDeck and resolveGates are
 *            two contact paths over one solid, and the near face belongs to
 *            the gate line.
 *   PAST     stay in the clear lane for the vehicle's whole length. Must be
 *            ZERO. This is the control, and it is the one that fails if the
 *            occupancy spans are built wrong -- without it a fix that made
 *            EVERY lane solid would pass the other two.
 */
function flankProbe(c, g, lane, mode) {
  // Drive from one unit before the gate line to one unit past the far face.
  const depth = 2 * Collision.BOX[K.BLOCK].halfZ * (1 + (g.train || 0) * 0.9);
  const safe = g.lanes.findIndex((l) => l === K.CLEAR);
  const p = Player.create();
  const start = mode === 'head' ? lane : safe;
  p.lane = start; p.laneFrom = start; p.laneT = 1;
  const out = { hits: 0, cleanGates: 0, zs: [] };
  let z = g.z - 1.0;
  const STEP = 0.5;
  let swerved = false;
  while (z < g.z + depth + 1.0) {
    // Swerve into the vehicle a third of the way along it -- past the gate
    // line by a long way, which is exactly the moment the shipped game had
    // nothing to say.
    if (mode === 'side' && !swerved && z > g.z + depth * 0.33) {
      p.laneFrom = p.lane; p.lane = lane; p.laneT = 0; swerved = true;
    }
    p.update(1 / 60, STEP);
    const d = p.resolveDeck ? p.resolveDeck(c, z, z + STEP) : null;
    if (d && d.hit) { out.hits++; out.zs.push(z + STEP); }
    for (const r of p.resolveGates(c, z, z + STEP)) {
      if (r.clean) out.cleanGates++; else { out.hits++; out.zs.push(z + STEP); }
    }
    z += STEP;
  }
  return out;
}

(function flank() {
  const acc = { trains: 0, side: [0, 0, 0], head: [0, 0, 0], past: [0, 0, 0], headClean: 0, days: 0 };
  // The whole calendar, not one day. Rule 3, and the previous pass's own
  // lesson: its landing-margin defect was invisible at 90 days.
  for (const key of KEYS) {
    const c = withFlags(0, 0, () => Course.generate(key));
    acc.days++;
    for (let i = 0; i < c.gates.length; i++) {
      const g = c.gates[i];
      if (!g.train) continue;
      const lane = g.lanes.findIndex((l) => l === K.BLOCK);
      // The approach lane has to be genuinely CLEAR or the probe measures a
      // JUMP taken standing up and calls it a guarded train. That contamination
      // is on the record: it reported 8 of 16 where the truth was 13 of 13.
      const safe = g.lanes.findIndex((l) => l === K.CLEAR);
      if (lane < 0 || safe < 0) continue;
      acc.trains++;
      for (const mode of ['side', 'head', 'past']) {
        const r = flankProbe(c, g, mode === 'past' ? safe : lane, mode);
        const bucket = acc[mode];
        bucket[Math.min(2, r.hits)]++;
        if (mode === 'head') acc.headClean += r.cleanGates;
      }
    }
  }
  const pct = (n) => (100 * n / acc.trains).toFixed(1).padStart(6) + '%';
  console.log(`  ${acc.trains} BLOCK trains over ${acc.days} days with a genuinely CLEAR lane to approach in\n`);
  console.log('  contacts recorded          none    exactly one    two or more');
  for (const [label, b] of [['SIDE  swerve into the flank', acc.side],
                            ['HEAD  take it at the gate line', acc.head],
                            ['PAST  stay in the clear lane', acc.past]]) {
    console.log('  ' + label.padEnd(30) + pct(b[0]) + pct(b[1]).padStart(15) + pct(b[2]).padStart(15));
  }
  console.log(`\n  clean gates credited on a HEAD-ON contact: ${acc.headClean}  (must be 0)`);
  if (acc.side[0]) bad(`${acc.side[0]} of ${acc.trains} flanks are still silent -- you can run through the side of a tram`);
  if (acc.side[2]) bad(`${acc.side[2]} flanks charge more than one contact for one vehicle`);
  if (acc.head[1] !== acc.trains) bad(`a head-on BLOCK is not exactly one contact on ${acc.trains - acc.head[1]} trains`);
  if (acc.headClean) bad(`${acc.headClean} head-on contacts ALSO credited a clean gate -- the bounce is stealing a streak`);
  if (acc.past[0] !== acc.trains) bad(`${acc.trains - acc.past[0]} clean passes recorded a contact -- a lane that is not occupied is being called occupied`);
})();

// ---- is a proved path still walkable? ------------------------------------
console.log(`\n=== transit: solid flanks against the lane path solvable() proved ===\n`);
/**
 * solvable() proves a sequence of LANES AT GATE LINES. With flanks solid, the
 * player also has to get BETWEEN those lanes without touching anything, and
 * the lane they cross through may be occupied by the vehicle standing at the
 * gate they have just left.
 *
 * The proof survives for a reason that is structural rather than lucky, and it
 * is checked here rather than argued. Every occupancy span starts at a gate
 * line and ends at gate.z + reachOf, and spacingAt owes the NEXT gate
 * readWindowAt + reachOf -- so after the deepest vehicle in any gate there are
 * at least readWindowAt units of empty road before the next gate line. If that
 * clear run is longer than the ground two lane changes cover, every edge the
 * BFS drew is physically walkable: wait for the vehicle to end, then cross.
 *
 * This is the assertion that fails first if anyone retunes the sightline floor,
 * the jump arc or the pace floor, because readWindowAt is derived from all
 * three.
 */
(function transit() {
  const need = 1.55 * K.LANE_CHANGE_TIME * ((K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE);
  let worst = Infinity, worstKey = '-', worstZ = 0, spans = 0, crossing = 0;
  for (const key of KEYS) {
    const c = withFlags(0, 0, () => Course.generate(key));
    for (let i = 0; i < c.gates.length - 1; i++) {
      const g = c.gates[i];
      const far = g.z + Course.reachOf(g.lanes, g.train);
      const clear = c.gates[i + 1].z - far;
      if (clear < worst) { worst = clear; worstKey = key; worstZ = g.z; }
      // ...and no vehicle may reach the next gate line, or a lane the BFS
      // called free at that gate would have a lorry standing in it.
      for (let l = 0; l < 3; l++) {
        if (g.lanes[l] !== K.BLOCK) continue;
        spans++;
        if (far > c.gates[i + 1].z) crossing++;
      }
    }
  }
  console.log(`  occupancy spans checked            ${spans}`);
  console.log(`  spans reaching the next gate line  ${crossing}   (must be 0)`);
  console.log(`  two lane changes need              ${need.toFixed(1)}u at the pace floor`);
  console.log(`  tightest clear road after a gate   ${worst.toFixed(1)}u  (${worstKey} at z ${worstZ.toFixed(0)})`);
  if (crossing) bad(`${crossing} vehicles reach past the next gate line -- solvable() is proving a lane that is occupied`);
  if (worst < need) bad(`only ${worst.toFixed(1)}u of clear road after a vehicle, and crossing lanes needs ${need.toFixed(1)}u`);
})();

// ---- is the roof worth taking? -------------------------------------------
console.log(`\n=== ride: the same course run over the roofs and around them ===\n`);
/**
 * THE QUESTION THE BRIEF ACTUALLY ASKS: does the ramp add a decision, or does
 * it just add time?
 *
 * A decision needs two options that are both live. So the same generated course
 * is raced twice by the same bot, differing in ONE bit -- take every ramp, or
 * route around every ramp -- through the real MR.Player, the real
 * MR.Collision and the real MR.Pace. Nothing here re-implements the game.
 *
 * The bot is main.js's botThink, minus the deliberate-miss path, and it drives
 * the state machine through a controls queue exactly as a human does rather
 * than writing player.lane directly -- because the cost of the ramp IS a lane
 * constraint, and a bot that teleports between lanes would measure a version of
 * the mechanic that does not have one.
 */
function stubControls() {
  const q = [];
  return {
    push: (a) => q.push(a),
    take: function (pred) {
      for (let i = 0; i < q.length; i++) if (pred(q[i])) return q.splice(i, 1)[0];
      return null;
    },
  };
}

/**
 * Is lane `l` physically occupied anywhere between here and there? Sampled
 * rather than solved, because the answer only has to be good enough to steer a
 * bot -- but the STEP is now a quarter of the shortest vehicle rather than a
 * round number, so a standing taxi cannot fall between two samples.
 *
 * THIS FUNCTION IS THE FINDING. A bot that does not call it walks into the side
 * of a lorry 27 times in four races -- not at a gate line, but 26 units past
 * one, changing lane towards a gate that is still 34 units ahead. The shipped
 * mental model is "a lane is tested where the gate is", and a 43-unit vehicle
 * hanging off a single gate line breaks it.
 *
 * ---- AND IT ASKED THE WRONG QUESTION, WHICH ONLY SHOWED UP WHEN THE FLANK
 *      BECAME SOLID --------------------------------------------------------
 *
 * It read `deckAt > 0`, which is the height of a RUNNING SURFACE and is zero
 * over every vehicle that is not rideable. So the "flank-aware" column was
 * aware of ramps and blind to the other 27,000 vehicles on the calendar, and
 * the moment ordinary flanks became solid it took 137 contacts in four races
 * while the table went on calling it aware. The right question is
 * `occupiedAt`, which is the one place a lane's occupancy is stated. The old
 * form was harmless only because nothing but a ramp could be hit -- an
 * instrument that is correct because the bug it would expose does not exist
 * yet is not correct.
 */
const OCC_STEP = 2 * Collision.BOX[K.BLOCK].halfZ * 0.25;   // 0.98u
function occupied(course, lane, z0, z1) {
  for (let z = z0; z < z1; z += OCC_STEP) if (course.occupiedAt(z, lane)) return true;
  return !!course.occupiedAt(z1, lane);
}

function race(course, takeRamps, flankAware) {
  const p = Pace.create(course.elevation);
  const pl = Player.create();
  const ctrl = stubControls();
  const out = { hits: 0, aid: 0, roofAid: 0, mounts: 0, falls: 0, dismounts: 0, deckHits: 0, stuck: 0, waited: 0 };
  let gi = 0, planned = false, plannedLane = 1, acted = false, guard = 0;
  const DT = 1 / 60;

  while (!p.finished && guard++ < 200000) {
    // ---- plan ------------------------------------------------------------
    while (gi < course.gates.length && course.gates[gi].z < p.units - 1) {
      gi++; planned = false; acted = false;
    }
    const g = course.gates[gi];
    if (g) {
      const dist = g.z - p.units;
      const speed = p.speed();
      if (!planned && dist < 46) {
        planned = true; acted = false;
        const order = [pl.lane, pl.lane - 1, pl.lane + 1, 0, 1, 2]
          .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
        let best = null, bestScore = -Infinity;
        order.forEach(function (l, i) {
          const rideable = g.ramp === l;
          if (g.lanes[l] === K.BLOCK && !(rideable && takeRamps)) return;
          let score = (g.lanes[l] === K.CLEAR ? 100 : 0) - i;
          if (rideable && takeRamps) score += 220;
          if (score > bestScore) { bestScore = score; best = l; }
        });
        if (best === null) out.stuck++;
        plannedLane = best === null ? pl.lane : best;
      }
      /**
       * ---- WHERE FLANK AWARENESS ACTUALLY BELONGS ------------------------
       *
       * The first version of this put it in the PLAN: reject any lane with a
       * vehicle standing anywhere between here and the gate. That is the wrong
       * model and the table said so out loud -- 13 gates a race with "no way
       * out", every one of them a gate solvable() had proved was passable. A
       * lorry between you and a lane is not a reason to give the lane up; it is
       * a reason to WAIT, and the course guarantees the room to wait
       * (Course.validate's LANE_TRANSIT clause).
       *
       * So the plan is made off the gate table, exactly as solvable() proves
       * it, and awareness lives in the EXECUTION: never take a step sideways
       * into a lane that has something in it right now. `right now` is the
       * whole test and it is exact rather than approximate -- every span starts
       * at a gate line, the bot is always past the previous gate line when it
       * is steering for the next, so a vehicle that is not in the lane at this
       * instant cannot appear in it before the gate. The 1.0-unit lookahead is
       * float slack, not modelling.
       *
       * A two-lane move re-tests on every hop, so the lane crossed THROUGH is
       * checked as well as the lane arrived in. That was never true of the plan-
       * time version and is the case a human meets most often.
       */
      const stepDir = pl.lane < plannedLane ? 1 : -1;
      const nextLane = pl.lane + stepDir;
      const canEnter = !flankAware
        || (g.ramp === nextLane && takeRamps && nextLane === plannedLane)
        || !occupied(course, nextLane, p.units, p.units + 1.0);
      if (planned && pl.lane !== plannedLane && dist < 34 && pl.laneT >= 0.55
          && !pl.ramp) {
        if (canEnter) ctrl.push(pl.lane < plannedLane ? 'right' : 'left');
        else out.waited++;
      }
      if (planned && !acted && pl.lane === plannedLane) {
        const kind = g.lanes[plannedLane];
        // A rideable BLOCK is answered by being on it, not by an action.
        if (kind === K.JUMP && dist < speed * 0.30) { ctrl.push('jump'); acted = true; }
        else if (kind === K.DUCK && dist < speed * 0.16) { ctrl.push('duck'); acted = true; }
      }
    }

    // ---- step ------------------------------------------------------------
    pl.handle(ctrl);
    const before = p.units;
    p.update(DT);
    const after = p.units;
    pl.update(DT, after - before);

    const deck = pl.resolveDeck(course, before, after);
    if (deck && deck.hit) { p.onHit(); out.hits++; out.deckHits++;
      if (process.env.MR_TRACE) { const rr = course.rampAt(after, pl.lane); console.log('    trace flank z=' + after.toFixed(1) + ' lane=' + pl.lane + ' why=' + deck.why + ' vehicle=' + (rr ? rr.z0.toFixed(0) + '-' + rr.z1.toFixed(0) : '?') + ' nextGate=' + (g ? g.z.toFixed(0) : '-')); } }
    for (const r of pl.resolveGates(course, before, after)) {
      if (r.clean) p.onClean(); else { p.onHit(); out.hits++; }
    }
    for (const it of pl.resolveAid(course, before, after)) {
      p.onAid(it.gain); out.aid++; if (it.roof) out.roofAid++;
    }
    for (const e of pl.drainEvents()) {
      if (e === 'mount') out.mounts++;
      else if (e === 'fall') out.falls++;
      else if (e === 'dismount') out.dismounts++;
    }
  }
  out.time = p.finishTime;
  out.streak = p.bestStreak;
  return out;
}

(function ride() {
  const acc = {};
  // ---- THE CONTROL, AND IT IS NOT OPTIONAL ------------------------------
  //
  // The first run of this comparison reported 0 contacts taking the ramps
  // against 27 routing around them, which reads as the mechanic being free
  // safety. It is nothing of the kind: this bot is a port of main.js's and it
  // is not perfect, so SOME contacts are the harness and not the mechanic. A
  // two-column table cannot tell those apart. The third column is the same bot
  // on the same dates with the ramp switched off entirely, and the only honest
  // reading of the other two is the difference from it.
  //
  // ...and a FIFTH column, which is the one the flank decision turns on. `none`
  // is the shipped course played by a bot that already looks at the road; it
  // says what a competent player pays for solid flanks, and the answer has to
  // be nothing. `blind` is the SAME shipped course played off the gate table
  // alone -- the mental model the game itself had until this pass -- and the
  // gap between the two columns IS the difficulty change, isolated from the
  // ramp entirely.
  const COLS = [
    ['ride', 'takes every ramp', true, true, 1],
    ['naive', 'goes round, gate model', false, false, 1],
    ['aware', 'goes round, sees flanks', false, true, 1],
    ['none', 'no ramps, sees flanks', false, true, 0],
    ['blind', 'no ramps, gate model', false, false, 0],
  ];
  for (const [side] of COLS) {
    acc[side] = { time: 0, hits: 0, deckHits: 0, stuck: 0, waited: 0, aid: 0, roofAid: 0, mounts: 0, falls: 0, dismounts: 0, n: 0 };
  }
  for (const key of PKEYS_RIDE) {
    for (const [side, , take, aware, flag] of COLS) {
      const course = withFlags(0, flag, () => Course.generate(key));
      const r = race(course, take, aware);
      const a = acc[side];
      a.n++; a.time += r.time; a.hits += r.hits; a.deckHits += r.deckHits; a.stuck += r.stuck; a.waited += r.waited;
      a.aid += r.aid; a.roofAid += r.roofAid;
      a.mounts += r.mounts; a.falls += r.falls; a.dismounts += r.dismounts;
    }
  }
  console.log('  ' + ' '.repeat(22) + COLS.map(([s]) => s.padStart(9)).join(''));
  for (const [side, what] of COLS) console.log(`    ${side.padEnd(7)} ${what}`);
  console.log('');
  const row = (label, f) => console.log('  ' + label.padEnd(22)
    + COLS.map(([s]) => String(f(acc[s])).padStart(9)).join(''));
  row('finish, mean', (a) => Pace.clock(a.time / a.n));
  row('contacts', (a) => String(a.hits));
  row('  of them on a flank', (a) => String(a.deckHits));
  row('gates with no way out', (a) => String(a.stuck));
  row('frames spent waiting', (a) => String(a.waited));
  row('mounts', (a) => String(a.mounts));
  row('clean dismounts', (a) => String(a.dismounts));
  row('falls off the side', (a) => String(a.falls));
  row('aid collected', (a) => String(a.aid));
  row('  of it from a roof', (a) => String(a.roofAid));
  const dt = (acc.ride.time - acc.aware.time) / acc.ride.n;
  console.log(`\n  taking every ramp costs ${dt >= 0 ? '+' : ''}${dt.toFixed(1)}s against going round it`
    + ` and buys ${acc.ride.roofAid} roof pickups`);
  console.log(`  on the SHIPPED course, solid flanks cost a bot that reads the road `
    + `${acc.none.deckHits} contacts and one that reads only the gate table ${acc.blind.deckHits}`);
  // Not an assertion, because it is a property of the mechanic rather than a
  // defect: this bot INSISTS on every ramp (+220), so when the ramp is two
  // lanes away across an occupied middle lane it waits for the crossing, gets
  // to the vehicle past the top of its tailgate, and meets the flank instead of
  // the mouth. A human abandons; the bot does not, which is what makes the
  // number visible. It is the one way the ramp can cost a contact that going
  // round it would not, and it wants saying before RAMP is switched on.
  if (acc.ride.deckHits) {
    console.log(`  ${acc.ride.deckHits} of ${acc.ride.mounts + acc.ride.deckHits} ramp approaches `
      + 'reached the vehicle past its tailgate and hit the flank -- committing late to a ramp');
    console.log('  two lanes away, across an occupied middle lane, is the way to miss the mouth');
  }
  if (acc.ride.mounts === 0) bad('the bot never got onto a roof -- the mechanic is unexercised');
  // The claim the owner was sold on: this punishes steering into a lorry you
  // can see, and nothing else. A bot that looks at the road must pay nothing.
  if (acc.none.deckHits) bad(`${acc.none.deckHits} flank contacts taken by a bot that DOES look at the road `
    + '-- solid flanks are charging a player who read the lane correctly');
})();

// ---- aid on the roof -----------------------------------------------------
console.log(`\n=== roofaid: reachable up there, and not from the road ===\n`);
/**
 * The roof pickup is the whole reason to take a ramp (see generateAid), so
 * "there is an item at that z in that lane" is not the claim that matters --
 * the claim is that standing on the roof COLLECTS it and being anywhere else
 * does not. resolveAid took lane match alone, deliberately, so an item on a
 * roof was collectable by a runner at road level inside the lorry.
 *
 * Driven through the real resolveAid on both sides rather than reasoned about,
 * because the failing direction here is silent: a roof item that pays out at
 * road level makes the ramp free, which is the opposite of the trade it exists
 * to be.
 */
(function roofReach() {
  let items = 0, onRoof = 0, fromRoad = 0, roadItemsOnDeck = 0;
  for (const key of KEYS.slice(0, 60)) {
    const c = withFlags(0, 1, () => Course.generate(key));
    for (const it of c.aid) {
      if (!it.roof) continue;
      items++;
      const r = c.rampAt(it.z, it.lane);
      if (!r) { bad(`a roof item at z ${it.z.toFixed(0)} has no ramp under it`); continue; }
      // On the roof: mounted, riding, in the item's lane.
      const up = Player.create();
      up.lane = it.lane; up.laneFrom = it.lane; up.laneT = 1;
      up.ramp = r; up.surface = r.deck;
      if (up.resolveAid(c, it.z - 0.5, it.z + 0.5).length) onRoof++;
      // At road level in the same lane -- physically inside the lorry, which
      // the flank test now forbids, but resolveAid must refuse it on its own.
      const down = Player.create();
      down.lane = it.lane; down.laneFrom = it.lane; down.laneT = 1;
      if (down.resolveAid(c, it.z - 0.5, it.z + 0.5).length) fromRoad++;
    }
    // ...and the mirror: a ROAD item must not need a roof. Cheap to check and
    // it is the direction a careless gate would break.
    for (const it of c.aid) {
      if (it.roof) continue;
      if (c.rampAt(it.z, it.lane)) roadItemsOnDeck++;
    }
  }
  console.log(`  roof items probed             ${items}`);
  console.log(`  collected standing on it      ${onRoof}   (must be all of them)`);
  console.log(`  collected from the road       ${fromRoad}   (must be 0)`);
  console.log(`  road items inside a vehicle   ${roadItemsOnDeck}   (must be 0)`);
  if (items && onRoof !== items) bad(`${items - onRoof} roof items cannot be collected from the roof`);
  if (fromRoad) bad(`${fromRoad} roof items pay out at road level -- the ramp is free`);
  if (roadItemsOnDeck) bad(`${roadItemsOnDeck} road items sit inside a rideable vehicle`);
})();

// ---- pace ----------------------------------------------------------------
console.log(`\n=== pace: what each mechanic costs the race ===\n`);
/**
 * The same model tools/simulate.js uses, on the same four dates, so these
 * numbers sit alongside the ones that already gate the build.
 *
 * A PERFECT LINE ONLY. That is not laziness: the question each mechanic has to
 * answer is whether it moves the record, and the record is run clean. What a
 * mechanic does to a broken run is a different question and simulate.js's
 * forgiveness table is where it belongs.
 */
const PKEYS = PKEYS_RIDE;
function perfect(narrow, ramp) {
  const times = PKEYS.map((key) => {
    const course = withFlags(narrow, ramp, () => Course.generate(key));
    const p = Pace.create(course.elevation);
    let gi = 0, guard = 0;
    while (!p.finished && guard++ < 200000) {
      p.update(1 / 60);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) { gi++; p.onClean(); }
    }
    return { t: p.finishTime, gates: course.gates.length };
  });
  return {
    t: times.reduce((a, b) => a + b.t, 0) / times.length,
    gates: times.reduce((a, b) => a + b.gates, 0) / times.length,
  };
}
const rows = [['both off', 0, 0], ['narrow on', 1, 0], ['ramp on', 0, 1], ['both on', 1, 1]];
console.log('  config       gates   perfect finish   vs record');
const base = perfect(0, 0);
for (const [label, n, r] of rows) {
  const p = perfect(n, r);
  const vs = p.t - K.RECORD_SECONDS;
  console.log(`  ${label.padEnd(12)} ${p.gates.toFixed(1).padStart(5)}   ${Pace.clock(p.t).padStart(13)}   `
    + `${(vs >= 0 ? '+' : '') + vs.toFixed(0)}s   ${(p.t - base.t >= 0 ? '+' : '') + (p.t - base.t).toFixed(1)}s vs both off`);
  // ---- WHICH CONTRACT THIS ROW IS HELD TO DEPENDS ON EFFORT -------------
  //
  // This loop runs a perfect line that spends NOTHING -- no aid, no surge --
  // and under EFFORT that line is not supposed to beat the record. That is the
  // whole point of the pass: the shipped game handed a flawless run 86 seconds
  // of free margin and six different policies tied inside it, so the margin was
  // made purchasable rather than free. tools/simulate.js's policy sweep is
  // where the record is priced now.
  //
  // The assertion is INVERTED here rather than deleted, because what this loop
  // is really guarding is that NARROW and RAMP do not move the finish -- the
  // "vs both off" column -- and that guard is worth keeping under either flag.
  if (Pace.EFFORT > 0) {
    if (vs <= 0) bad(`${label}: a perfect line that spent nothing still beats the record`);
  } else if (vs >= 0) {
    bad(`${label}: a perfect line no longer beats the record`);
  }
}

console.log('');
console.log(fail === 0 ? 'PASS  both mechanics measured, no assertion broken'
                       : `FAIL  ${fail} assertion(s) broken -- see the ! lines above`);
process.exit(fail === 0 ? 0 : 1);
