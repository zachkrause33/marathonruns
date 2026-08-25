#!/usr/bin/env node
/**
 * IS THERE A RISK-REWARD CURVE, AND WHERE IS THE DIFFICULTY ACTUALLY?
 *
 *   node tools/risk.js                 the default sweep
 *   node tools/risk.js --days 40       widen the course sample
 *   node tools/risk.js --section speed  just one section
 *
 * The owner's complaint, verbatim: "It cannot just be clear all but one
 * obstacle and you win. There needs to be a strategy where if you don't take
 * enough health and speed you cannot get there, but if you take too much you
 * go too fast and crash into something."
 *
 * That is a claim about a curve, and this file is the numbers under it.
 *
 * Sections:
 *
 *   curve    what the streak ramp actually pays. Gate 5 against gate 50, where
 *            it saturates, and what one contact costs by WHERE it happens
 *   window   the reaction window in MILLISECONDS at both ends of the pace
 *            range, and the action windows beside it, measured on real courses
 *   speed    THE CRUX. Same course, swept speed, a bot with a human reaction
 *            latency. Does going faster cost contacts, and at what speed does
 *            it start to
 *   aid      what aid IS -- fuel, speed, insurance -- and the marginal value of
 *            the 14th item against the 1st
 *   policy   six different ways to run the same course. Do they converge
 *
 * ---- HOW THIS INSTRUMENT WOULD FLATTER ITS OWN THESIS -------------------
 *
 * Rule 3, and it applies hardest to a tool written to support a conclusion.
 * The thesis this file was commissioned to test is "speed is not currently
 * dangerous", so every approximation in here is chosen to make speed look MORE
 * dangerous than it is. If a number still says speed is free, the bias was
 * fighting it.
 *
 *  1. THE BOT SEES A GATE AS LATE AS THE CONTRACT ALLOWS. readWindowAt only
 *     guarantees a gate is unoccluded once the eye has passed the previous
 *     gate's far face. In practice most gates are visible far earlier -- the
 *     occluder is in ONE lane and the gate is three lanes wide, and most gaps
 *     are well above the floor. The `guarded` sighting model here pretends the
 *     player is blind until the guarantee fires, which is the most pessimistic
 *     reading of the shipped course and shortens every reaction window. The
 *     `open` model is run beside it as the control.
 *
 *  2. THE LATENCY IS APPLIED TO EVERY GATE, INDEPENDENTLY. A real player reads
 *     a run of gates as a phrase and pre-plans; this bot re-perceives from
 *     scratch every time and pays full latency at each one. That over-charges
 *     reaction and so over-reports speed danger.
 *
 *  3. NO ANTICIPATION AND NO BUFFER USE. K.INPUT_BUFFER is 0.20s of forgiveness
 *     the shipped controls give a human and this bot never spends it.
 *
 *  4. CONSTANT SPEED, NOT THE PACE MODEL, in the speed section. That is on
 *     purpose: the question is what SPEED does, and running it through the pace
 *     model confounds speed with streak history. The cost is that hills are
 *     absent from that section -- stated rather than hidden, and the window
 *     section measures the real profile with hills in it.
 *
 *  5. THE CONTROL IS THE SHIPPED INSTRUMENT'S OWN BOT. react = 0 reproduces
 *     the model tools/aid.js and tools/mechanics.js use. If the control also
 *     shows danger, the finding is in my harness and not in the game.
 *
 * ---- AND WHAT THE EXISTING INSTRUMENTS CANNOT SEE ------------------------
 *
 * This is the reason the file exists at all. tools/simulate.js decides gate
 * outcomes from a fixed COUNTING PATTERN -- `n % round(1/(1-skill))` -- with no
 * reference to speed, spacing or state. tools/aid.js and tools/mechanics.js
 * drive the real state machine, but their bot plans at a fixed DISTANCE
 * (dist < 46) and fires its action at a fixed TIME BEFORE the gate
 * (dist < speed * 0.30), with zero latency. A trigger expressed in
 * time-to-gate rescales itself perfectly as the runner speeds up.
 *
 * So all three instruments are, by construction, incapable of registering that
 * speed is dangerous. They would report a clean run at any speed whatsoever.
 * That is not a defect in them -- they were built to measure other things --
 * but it does mean the project has never had a number on this question, and
 * "the record survives one mistake" has been read as a difficulty statement
 * when it is only a statement about the pace arithmetic.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
const DAYS = parseInt(arg('days', 12), 10);
const ONLY = arg('section', null);
// The mechanic flags, so a policy table can be taken with a mechanic on and
// again with it off THROUGH THE SAME INSTRUMENT. A before-and-after taken from
// two different runs of two different builds is the comparison this project
// has got wrong most often; one build, one binary, one switch is the only
// version of it that cannot go stale. Applied after the modules load and
// before any course is generated.
const TEMPO_FLAG = arg('tempo', null);
const ROOF_FLAG = arg('roof', null);
const want = (s) => !ONLY || ONLY === s;

// The REAL modules. Same one-field Runner stub tools/aid.js and
// tools/mechanics.js use, and it is checked in the latter.
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
const { Course, Collision, Player, Pace, K } = ctx.MR;
if (TEMPO_FLAG !== null) Course.TEMPO = TEMPO_FLAG;
if (ROOF_FLAG !== null) Course.ROOF = ROOF_FLAG;

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
// The four dates tools/simulate.js averages over, so any finish time here sits
// alongside the ones that already gate the build.
const PKEYS = ['2026-08-05', '2026-08-06', '2026-12-25', '2027-03-14'];

const START_SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE;
const FLOOR_SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
const RECORD_SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.RECORD_PACE;

const isAction = (k) => k === K.JUMP || k === K.DUCK;
const ms = (sec) => (sec * 1000).toFixed(0).padStart(5) + ' ms';
function pctl(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

// ===========================================================================
// curve: what the streak ramp pays, and what a contact costs
// ===========================================================================
if (want('curve')) {
  console.log('\n=== curve: what a clean gate buys, and what a contact costs ===\n');

  const tp = (s) => Pace.targetPace(s);
  console.log('  the target-pace ramp, and the MARGINAL value of the next gate');
  console.log('');
  console.log('  streak   target pace   s/mi left to win   next gate buys   share of ramp spent');
  const gap = K.START_PACE - K.FLOOR_PACE;
  for (const s of [0, 1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 185]) {
    const here = tp(s), next = tp(s + 1);
    console.log(
      `  ${String(s).padStart(6)}   ${Pace.pace(here).padStart(7)}/mi   ` +
      `${(here - K.FLOOR_PACE).toFixed(1).padStart(14)}   ` +
      `${(here - next).toFixed(3).padStart(12)} s/mi   ` +
      `${(100 * (K.START_PACE - here) / gap).toFixed(1).padStart(16)}%`
    );
  }
  const halfAt = (() => { for (let s = 0; s <= 400; s++) if (tp(s) - K.FLOOR_PACE <= gap * 0.5) return s; return -1; })();
  const p90 = (() => { for (let s = 0; s <= 400; s++) if (tp(s) - K.FLOOR_PACE <= gap * 0.1) return s; return -1; })();
  const p99 = (() => { for (let s = 0; s <= 400; s++) if (tp(s) - K.FLOOR_PACE <= gap * 0.01) return s; return -1; })();
  console.log('');
  console.log(`  half the ramp is spent by streak ${halfAt}, 90% by ${p90}, 99% by ${p99}`);
  console.log(`  gate 5 buys ${(tp(4) - tp(5)).toFixed(3)} s/mi; gate 50 buys ${(tp(49) - tp(50)).toFixed(3)} s/mi ` +
              `-- a factor of ${((tp(4) - tp(5)) / (tp(49) - tp(50))).toFixed(1)}`);
  console.log(`  AID_CEILING is streak ${K.AID_CEILING} (${Pace.pace(tp(K.AID_CEILING))}/mi), ` +
              `${(100 * (K.START_PACE - tp(K.AID_CEILING)) / gap).toFixed(0)}% of the ramp`);

  // ---- what one contact costs, by where it lands -------------------------
  //
  // Driven through the real Pace on real courses rather than integrated in
  // closed form, because the easing lag is the thing that makes the answer
  // depend on position at all.
  function raceWithHitsAt(course, fracs) {
    const p = Pace.create(course.elevation);
    const hitGates = new Set(fracs.map((f) => Math.max(1, Math.floor(course.gates.length * f))));
    let gi = 0, n = 0, guard = 0;
    while (!p.finished && guard++ < 200000) {
      p.update(1 / 60);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) {
        gi++; n++;
        if (hitGates.has(n)) p.onHit(); else p.onClean();
      }
    }
    return p.finishTime;
  }
  const CK = PKEYS.map((k) => Course.generate(k));
  const clean = CK.map((c) => raceWithHitsAt(c, []));
  const cleanMean = clean.reduce((a, b) => a + b, 0) / clean.length;
  console.log('');
  console.log(`  a clean run finishes ${Pace.clock(cleanMean)} (record ${K.RECORD_LABEL}, ` +
              `${(K.RECORD_SECONDS - cleanMean).toFixed(0)}s of headroom)`);
  console.log('');
  console.log('  ONE contact, by where in the race it happens:');
  console.log('');
  console.log('  at % of race   finish     costs      still beats the record');
  for (const f of [0.02, 0.05, 0.10, 0.20, 0.35, 0.50, 0.65, 0.80, 0.92, 0.99]) {
    const t = CK.map((c) => raceWithHitsAt(c, [f]));
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    const cost = mean - cleanMean;
    console.log(
      `  ${(100 * f).toFixed(0).padStart(11)}%   ${Pace.clock(mean)}   ` +
      `${cost.toFixed(1).padStart(5)}s     ${mean <= K.RECORD_SECONDS ? 'yes' : 'NO'}`
    );
  }
}

// ===========================================================================
// window: the reaction window, in milliseconds
// ===========================================================================
//
// Three different windows, and conflating them is how this question has stayed
// unanswered:
//
//   DECIDE   from the moment a gate is guaranteed unoccluded to the gate line.
//            Distance divided by speed, so it SHRINKS as the runner speeds up.
//            This is the only one speed touches.
//   JUMP     how long the runner is above JUMP_CLEAR_Y during a jump. Set by
//            the scripted arc, so it is a fixed number of SECONDS at every
//            speed -- player.js says so in its header and this measures it.
//   DUCK     the same for duck01 >= DUCK_CLEAR.
//
if (want('window')) {
  console.log('\n=== window: how long the player actually has, in milliseconds ===\n');

  // ---- the action windows, integrated off the shipped state machine ------
  const DT = 1 / 3000;
  let inAir = 0, firstAir = -1, lastAir = -1;
  {
    const pl = Player.create();
    pl.airborne = true; pl.airT = 0;
    for (let t = 0; t < K.JUMP_TIME * 1.2; t += DT) {
      pl.update(DT, 0);
      if (Collision.clears(K.JUMP, pl)) {
        if (firstAir < 0) firstAir = t;
        lastAir = t; inAir += DT;
      }
    }
  }
  let inDuck = 0, firstDuck = -1, lastDuck = -1;
  {
    const pl = Player.create();
    pl.ducking = true; pl.duckT = 0;
    for (let t = 0; t < K.DUCK_TIME * 1.6; t += DT) {
      pl.update(DT, 0);
      if (Collision.clears(K.DUCK, pl)) {
        if (firstDuck < 0) firstDuck = t;
        lastDuck = t; inDuck += DT;
      }
    }
  }
  console.log('  the ACTION windows -- how much timing slack an input has:');
  console.log('');
  console.log(`    jump   cleared from ${ms(firstAir)} to ${ms(lastAir)} after the press ` +
              `= ${ms(inAir)} of window`);
  console.log(`    duck   cleared from ${ms(firstDuck)} to ${ms(lastDuck)} after the press ` +
              `= ${ms(inDuck)} of window`);
  console.log(`    ...and both are SPEED-INVARIANT: the arc is scripted in time, not integrated`);
  console.log(`    under gravity, so these numbers are identical at 5:30/mi and 4:14/mi.`);
  console.log(`    K.INPUT_BUFFER adds ${ms(K.INPUT_BUFFER)} of forgiveness on top.`);

  // ---- the decide window -------------------------------------------------
  console.log('');
  console.log('  the DECIDE window -- the only one speed touches.');
  console.log('');
  console.log(`    guaranteed floor is ACTION_WINDOW = ${Course.ACTION_WINDOW} units, because`);
  console.log(`    spacing >= readWindowAt + reachOf(prev) and readWindowAt = ACTION_WINDOW`);
  console.log(`    + CAM_BASE_BACK, so the gap left after the occluder clears the lens is`);
  console.log(`    exactly ACTION_WINDOW. In SECONDS that floor is:`);
  console.log('');
  console.log('    pace          speed        floor of the decide window');
  for (const [label, pace] of [['start  5:30/mi', K.START_PACE],
                               ['record 4:33/mi', K.RECORD_PACE],
                               ['floor  4:14/mi', K.FLOOR_PACE]]) {
    const sp = (K.UNITS_PER_MILE * K.TIME_SCALE) / pace;
    console.log(`    ${label}  ${sp.toFixed(2).padStart(6)} u/s     ${ms(Course.ACTION_WINDOW / sp)}`);
  }
  const steepPace = K.FLOOR_PACE - K.GRADE_SPM * 4.0;
  const steepSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE) / steepPace;
  console.log(`    steepest legal descent at the floor: ${steepSpeed.toFixed(2)} u/s, and`);
  console.log(`    actionWindowAt grows with it by construction, so the window holds.`);

  // ---- and what the real courses actually deliver ------------------------
  //
  // The floor binds only where difficulty() has driven the mean down to it.
  // What matters to a player is the DISTRIBUTION, so it is measured: a clean
  // run through the real pace model on real courses, recording at every gate
  // the decide window under both sighting models.
  const rows = { guarded: [], open: [] };
  const byDecile = [];
  for (let i = 0; i < 10; i++) byDecile.push({ g: [], o: [], sp: [] });
  for (const key of KEYS) {
    const c = Course.generate(key);
    const p = Pace.create(c.elevation);
    let gi = 0, guard = 0;
    const speedAt = new Array(c.gates.length).fill(0);
    while (!p.finished && guard++ < 200000) {
      p.update(1 / 60);
      while (gi < c.gates.length && p.units >= c.gates[gi].z) { speedAt[gi] = p.speed(); gi++; p.onClean(); }
    }
    for (let i = 1; i < c.gates.length; i++) {
      const sp = speedAt[i] || RECORD_SPEED;
      const prev = c.gates[i - 1];
      const gapU = c.gates[i].z - prev.z;
      // guarded: blind until the eye passes the previous gate's far face.
      const gU = gapU - Course.reachOf(prev.lanes, prev.train) - K.CAM_BASE_BACK;
      // open: the gate is in shot the whole gap. The optimistic control.
      const oU = gapU;
      rows.guarded.push(gU / sp);
      rows.open.push(oU / sp);
      const d = Math.min(9, Math.floor(10 * c.gates[i].f));
      byDecile[d].g.push(gU / sp); byDecile[d].o.push(oU / sp); byDecile[d].sp.push(sp);
    }
  }
  for (const k of ['guarded', 'open']) rows[k].sort((a, b) => a - b);
  console.log('');
  console.log(`  measured on ${DAYS} real courses, ${rows.guarded.length} gate intervals, clean run:`);
  console.log('');
  console.log('  sighting model     min      5th     median      95th');
  for (const k of ['guarded', 'open']) {
    console.log(`  ${k.padEnd(16)} ${ms(rows[k][0])} ${ms(pctl(rows[k], 0.05))} ` +
                `${ms(pctl(rows[k], 0.5))} ${ms(pctl(rows[k], 0.95))}`);
  }
  console.log('');
  console.log('  ...and how it tightens through the race (guarded model):');
  console.log('');
  console.log('  decile of race   mean speed   median decide window   tightest');
  for (let d = 0; d < 10; d++) {
    const b = byDecile[d];
    if (!b.g.length) continue;
    const s = b.g.slice().sort((a, x) => a - x);
    const msp = b.sp.reduce((a, x) => a + x, 0) / b.sp.length;
    console.log(`  ${String(d * 10).padStart(12)}-%   ${msp.toFixed(2).padStart(7)} u/s   ` +
                `${ms(pctl(s, 0.5))}            ${ms(s[0])}`);
  }
  const g0 = pctl(byDecile[0].g.slice().sort((a, b) => a - b), 0.5);
  const g9 = pctl(byDecile[9].g.slice().sort((a, b) => a - b), 0.5);
  console.log('');
  console.log(`  the whole span of the difficulty curve moves the median window ` +
              `${ms(g0)} -> ${ms(g9)}, a ${(100 * (1 - g9 / g0)).toFixed(0)}% tightening.`);
  console.log(`  Simple visual reaction is ~250 ms and choice reaction ~400-500 ms.`);
}

// ===========================================================================
// speed: THE CRUX. Is going fast currently dangerous?
// ===========================================================================
//
// The design of the experiment matters more than the result, so it is stated
// before the numbers.
//
// HOLD THE COURSE, VARY THE SPEED. One generated course, raced repeatedly at a
// CONSTANT speed swept from the pace ceiling to well past the pace floor, by a
// bot with a fixed reaction latency. Every other variable is pinned. If speed
// is dangerous, contacts rise with the sweep; if it is free, the line is flat.
//
// Running it through Pace instead would confound speed with streak history --
// the fast runs would also be the ones that had already been clean, which is
// exactly the correlation that makes the question hard to see.
//
// THE BOT. It perceives a gate at `sightAt`, waits REACT seconds, then commits
// to a lane and drives the real Player. It fires jump and duck on the shipped
// bot's own leads (0.30s and 0.16s before the gate line, from tools/aid.js) so
// this differs from the existing instruments in exactly ONE property: latency.
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

const OCC_STEP = 2 * Collision.BOX[K.BLOCK].halfZ * 0.25;
function occupied(course, lane, z0, z1) {
  for (let z = z0; z < z1; z += OCC_STEP) if (course.occupiedAt(z, lane)) return true;
  return !!course.occupiedAt(z1, lane);
}

/**
 * Race at a CONSTANT speed. Returns contacts and where they came from.
 *
 * @param opts.speed   world units per second, held flat
 * @param opts.react   perception-to-decision latency, seconds
 * @param opts.sight   'guarded' (blind until the previous occluder clears the
 *                     lens -- the pessimistic reading of the contract) or a
 *                     number of units of clear sight (the optimistic control)
 * @param opts.seek    aid policy: 0 ignore, 1 pay an action for it
 * @param opts.line    LINE policy: { lift, drag } weights in hundredths of an
 *                     action avoided, exactly as main.js's bot scores them.
 *
 *                     ---- THE BLINDNESS THIS PARAMETER ENDS ----------------
 *
 *                     It was opts.surge, a SPEND policy over which zones to
 *                     elect, and it existed because this file once reported
 *                     six policies finishing within 0.0 s of each other AFTER
 *                     the pool, the guard and the surge zones had shipped --
 *                     honestly, because none of its bots ever stood in a
 *                     marked lane. An instrument that cannot see the mechanic
 *                     under test does not return "no effect", it returns "no
 *                     effect" INDISTINGUISHABLY from a mechanic that is broken
 *                     (standing rule 3). The surge is gone; the trap is not,
 *                     so the parameter moved to the mechanic that replaced it.
 * @param opts.aidFrom, opts.aidTo   only seek aid in this fraction of the race
 * @param opts.bias    lane tie-break
 * @param opts.miss    deliberately fluff this fraction of the ACTIONS the bot
 *                     is asked for. Counted ONCE PER GATE at decision time and
 *                     carried on the plan -- tools/aid.js shipped this knob
 *                     inside the per-frame branch first, where it ticked twenty
 *                     times per gate and flickered off on the frame that
 *                     mattered, so every miss rate reported zero contacts.
 *                     Deterministic rather than random so the table reproduces.
 */
function raceAt(course, opts) {
  // TWO MOTION SOURCES, AND THE CHOICE IS THE EXPERIMENT.
  //
  // Constant speed ISOLATES speed: it is the only way to ask what speed alone
  // does without the answer being contaminated by the fact that fast runs are
  // also the runs that have already been clean. The speed section uses it.
  //
  // The real Pace is FAITHFUL: streak, easing, hills and the finish clock, all
  // shipped. The policy section uses it, because there the question is what a
  // whole run costs and a constant-speed answer would not be a finish time.
  const usePace = !!opts.pace;
  const p = usePace ? Pace.create(course.elevation) : null;
  const react = opts.react || 0;
  const sight = opts.sight === undefined ? 'guarded' : opts.sight;
  const seek = opts.seek || 0;
  const aidFrom = opts.aidFrom === undefined ? 0 : opts.aidFrom;
  const aidTo = opts.aidTo === undefined ? 1 : opts.aidTo;
  const order0 = opts.bias || ((l) => [l, l - 1, l + 1]);
  const pl = Player.create();
  const ctrl = stubControls();
  const DT = 1 / 60;
  const out = { hits: 0, gates: 0, aid: 0, gain: 0, late: 0, wrongLane: 0, flank: 0, actions: 0,
                guards: 0, wasted: 0, liftU: 0, dragU: 0 };
  const aid = course.aid.filter((a) => !a.roof);

  // ---- the LINE policy, resolved once ------------------------------------
  //
  // It was a SPEND policy: which of a course's zones to elect. The surge is
  // gone, the pool has one spend, and what a policy varies now is how it reads
  // the paint. `opts.line` supplies the two weights, in the same currency
  // main.js's bot uses: hundredths of an action avoided, against a clear-lane
  // term of 100.
  const LINE = opts.line || { lift: 100, drag: -140 };

  // Where each gate becomes decidable, under the chosen sighting model.
  const seeAt = new Array(course.gates.length);
  for (let i = 0; i < course.gates.length; i++) {
    const g = course.gates[i];
    if (sight === 'guarded') {
      const prev = i > 0 ? course.gates[i - 1] : null;
      seeAt[i] = prev
        ? prev.z + Course.reachOf(prev.lanes, prev.train) + K.CAM_BASE_BACK
        : -1e9;
    } else {
      seeAt[i] = g.z - sight;
    }
  }

  const miss = opts.miss || 0;
  let actionGates = 0, fluff = false;

  let units = 0, gi = 0, ai = 0, guard = 0;
  let decidedFor = -1, targetLane = 1, acted = false, sawAt = -1;
  let speed = usePace ? p.speed() : opts.speed;

  while ((usePace ? !p.finished : units < K.TOTAL_UNITS) && guard++ < 400000) {
    while (gi < course.gates.length && course.gates[gi].z < units - 1) {
      gi++; decidedFor = -1; acted = false; sawAt = -1;
    }
    while (ai < aid.length && aid[ai].z < units - 1) ai++;
    const g = course.gates[gi];
    if (g) {
      const dist = g.z - units;
      // Perception, then latency.
      if (sawAt < 0 && units >= seeAt[gi]) sawAt = units;
      const decided = sawAt >= 0 && units >= sawAt + react * speed;
      if (decided && decidedFor !== gi) {
        decidedFor = gi; acted = false;
        const f = g.z / K.TOTAL_UNITS;
        const nextZ = course.gates[gi + 1] ? course.gates[gi + 1].z : 1e9;
        const wantLane = (seek === 1 && f >= aidFrom && f <= aidTo
          && ai < aid.length && aid[ai].z < nextZ && aid[ai].gate === gi)
          ? aid[ai].lane : -1;
        const cand = order0(pl.lane).concat([0, 1, 2])
          .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
        // Both ends of the road about to be run, for the same reason main.js
        // asks both: a zone is 420-560 units against a ~25-unit gate interval,
        // so the edges are the only place a single-point test can be wrong,
        // and they are exactly where the election is won or lost.

        let best = null, bestScore = -Infinity;
        cand.forEach(function (l, i) {
          if (g.lanes[l] === K.BLOCK) return;
          let score = (g.lanes[l] === K.CLEAR ? 100 : 0) - i;
          if (l === wantLane) score += 400;
          // Above aid, and it is the same ordering main.js scores: a segment
          // collected is only worth what it later buys, so detouring for a
          // bottle out of a zone already being paid for spends the pool to
          // fill the pool.
          // ---- AND THE MATS ------------------------------------------------
          //
          // Added the day the mechanic landed, and the reason is the reason
          // this whole file exists: roadmap 67 found that every bot here scored
          // CLEAR, aid and ramp and NOTHING ELSE, so a surge was elected only
          // by coincidence and this section reported six policies tying at
          // 0.0 seconds -- truthfully, about a game its own instrument could
          // not see. A tempo term omitted here would print exactly the same
          // kind of honest nothing.
          //
          // The weights are an EXPECTED-COST derivation and the first attempt
          // at them was wrong: they were set below the clear-lane term on the
          // argument that a contact is worth tens of seconds, which compares
          // the mat to the wrong thing. Taking a hurdle lane is taking an
          // ACTION, not a contact, and an action costs P(fluff) times a
          // contact -- 2 to 4 race seconds -- against a drag's measured 5.0
          // and a lift's 1.9. The clear-lane term is 100, so one unit is one
          // hundredth of an action avoided, and a drag is about one and a half
          // of them. See the fuller note at the same term in main.js.
          if (course.tempoAt) {
            const m = course.tempoAt(g.z, l);
            if (m) score += m.dir > 0 ? LINE.lift : LINE.drag;
          }
          if (score > bestScore) { bestScore = score; best = l; }
        });
        targetLane = best === null ? pl.lane : best;
        // Once per gate, now the lane is settled, and only where an action is
        // actually being asked for -- most gates are answered by standing in a
        // clear lane and there is nothing there to fluff.
        fluff = false;
        if (miss > 0 && isAction(g.lanes[targetLane])) {
          actionGates++;
          fluff = Math.floor(actionGates * miss) !== Math.floor((actionGates - 1) * miss);
        }
      }
      if (decidedFor === gi) {
        const stepDir = pl.lane < targetLane ? 1 : -1;
        const nextLane = pl.lane + stepDir;
        if (pl.lane !== targetLane && pl.laneT >= 0.55
            && !occupied(course, nextLane, units, units + 1.0)) {
          ctrl.push(pl.lane < targetLane ? 'right' : 'left');
        }
        if (!acted && pl.lane === targetLane && !fluff) {
          const kind = g.lanes[targetLane];
          if (kind === K.JUMP && dist < speed * 0.30) { ctrl.push('jump'); acted = true; out.actions++; }
          else if (kind === K.DUCK && dist < speed * 0.16) { ctrl.push('duck'); acted = true; out.actions++; }
        }
      }
    }

    pl.handle(ctrl);
    // ---- THE ELECTION, BEFORE THE STEP -----------------------------------
    //
    // Through player.resolveSurge rather than a test written here, so this
    // harness asks the shipped question -- in a marked lane, not on a deck,
    // with fuel -- instead of a second copy of it that can drift. Before
    // p.update for the reason main.js gives: the surge decides which floor
    // this step is run toward, and a step cannot be run at a pace chosen
    // after it.
    // And it is NOT conditioned on the policy. There is no decline in the
    // shipped game: standing in the marked lane with fuel IS the surge,
    // whether the runner meant it or not. The policy decides only where the
    // bot STEERS -- so a policy that never seeks a zone still surges wherever
    // the marked lane happened to be the lane it wanted anyway, and that
    // coincidence is a real property of a three-lane road rather than a
    // measurement artefact to be conditioned away.
    if (usePace) {
      // ---- AND THE MAT, WHICH THIS HARNESS WAS SILENT ABOUT ---------------
      //
      // Adding a tempo term to the LANE SCORER above and stopping there made
      // this instrument steer for mats and then never apply one, so the policy
      // table came out BIT-IDENTICAL at --tempo 0 and --tempo 1 -- an A/B that
      // proved the mechanic did nothing, about a harness that had not been told
      // it existed. That is roadmap 67's finding one level deeper: a scorer is
      // where a bot decides, and the election is where the game answers, and a
      // measurement needs both.
      //
      // Through player.resolveTempo for the same reason the line above goes
      // through resolveSurge: the shipped question, asked once, rather than a
      // second copy of it here that can drift.
      const mat = pl.resolveTempo(course, units);
      p.tempo = mat ? mat.dir : 0;
    }
    const before = units;
    if (usePace) { p.update(DT); units = p.units; speed = p.speed(); }
    else units += speed * DT;
    const after = units;
    pl.update(DT, after - before);

    // ---- A GUARDED CONTACT IS A DIFFERENT FACT FROM AN UNGUARDED ONE ------
    //
    // pace.onHit() returns 'guard' when a segment paid, and the two must be
    // counted apart or the contact column reads the same for a run that was
    // insured and one that was not -- which is precisely the difference the
    // pool exists to create. `hits` stays the count of contacts that COST
    // something, matching what the finish card and the streak actually saw.
    const charge = () => (p ? p.onHit() : 'hit') === 'guard';
    const deck = pl.resolveDeck(course, before, after);
    if (deck && deck.hit) { if (charge()) out.guards++; else { out.hits++; out.flank++; } }
    for (const r of pl.resolveGates(course, before, after)) {
      out.gates++;
      if (!r.clean) {
        if (charge()) { out.guards++; continue; }
        out.hits++;
        // Which failure was it: in the right lane and mistimed, or never got
        // to the lane at all? The two want different fixes and lumping them
        // is how a reaction problem gets misread as a spacing problem.
        if (r.lane === targetLane && isAction(r.kind)) out.late++;
        else out.wrongLane++;
      } else if (p) p.onClean();
    }
    for (const it of pl.resolveAid(course, before, after)) {
      out.aid++; out.gain += it.gain; if (p) p.onAid(it.gain);
    }
    pl.drainEvents();
  }
  if (p) {
    out.time = p.finishTime; out.streak = p.bestStreak;
    out.liftU = p.liftUnits; out.dragU = p.dragUnits;
    out.wasted = p.wasted; out.pool = p.pool;
  }
  return out;
}

if (want('speed')) {
  console.log('\n=== speed: is going fast dangerous today? ===\n');
  console.log('  Same courses, constant speed, swept. The ONLY variable is speed.');
  console.log(`  The game's own band is ${START_SPEED.toFixed(2)} u/s (5:30/mi) to ` +
              `${FLOOR_SPEED.toFixed(2)} u/s (4:14/mi).`);
  console.log('');
  const SPEEDS = [
    ['5:30 start   ', START_SPEED, 1],
    ['4:33 record  ', RECORD_SPEED, 0],
    ['4:14 floor   ', FLOOR_SPEED, 1],
    ['1.25x floor  ', FLOOR_SPEED * 1.25, 0],
    ['1.50x floor  ', FLOOR_SPEED * 1.5, 0],
    ['2.00x floor  ', FLOOR_SPEED * 2.0, 0],
    ['3.00x floor  ', FLOOR_SPEED * 3.0, 0],
    ['4.00x floor  ', FLOOR_SPEED * 4.0, 0],
  ];
  const REACTS = [
    ['0 ms  (the shipped instruments\' model)', 0],
    ['250 ms (simple visual reaction)', 0.25],
    ['450 ms (choice reaction, a real player)', 0.45],
  ];
  const courses = PKEYS.map((k) => Course.generate(k));
  for (const [rlabel, react] of REACTS) {
    console.log(`  reaction latency ${rlabel}`);
    console.log('');
    console.log('    speed              u/s    contacts (guarded sight)   contacts (open sight)');
    for (const [slabel, sp] of SPEEDS) {
      const gRuns = courses.map((c) => raceAt(c, { speed: sp, react, sight: 'guarded' }));
      const oRuns = courses.map((c) => raceAt(c, { speed: sp, react, sight: 140 }));
      const mean = (rs, f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
      console.log(
        `    ${slabel}  ${sp.toFixed(2).padStart(6)}    ` +
        `${mean(gRuns, (r) => r.hits).toFixed(1).padStart(10)}` +
        `               ${mean(oRuns, (r) => r.hits).toFixed(1).padStart(8)}`
      );
    }
    console.log('');
  }
  // The number the owner actually wants: where does it start to bite?
  console.log('  the breaking point -- lowest speed at which a 450 ms player takes a contact:');
  console.log('');
  for (const sight of ['guarded', 140]) {
    let broke = null;
    for (let m = 1.0; m <= 6.01; m += 0.25) {
      const sp = FLOOR_SPEED * m;
      const h = courses.map((c) => raceAt(c, { speed: sp, react: 0.45, sight }))
        .reduce((a, r) => a + r.hits, 0);
      if (h > 0) { broke = m; break; }
    }
    console.log(`    ${String(sight).padEnd(9)} first contact at ` +
      (broke ? `${broke.toFixed(2)}x the pace floor ` +
        `(${(FLOOR_SPEED * broke).toFixed(1)} u/s, ` +
        `${Pace.pace((K.UNITS_PER_MILE * K.TIME_SCALE) / (FLOOR_SPEED * broke))}/mi)`
        : 'never, up to 6x the pace floor'));
  }
}

// ===========================================================================
// aid: what it is, and what the 14th item is worth
// ===========================================================================
if (want('aid')) {
  console.log('\n=== aid: fuel, speed, insurance -- which? ===\n');
  console.log('  What aid touches, read off pace.js: it grants STREAK, bounded by');
  console.log('  min(streak + gain, gatesSeen, AID_CEILING) and floored at the current');
  console.log('  streak. It does not touch race time, contact, health or the clock.');
  console.log('  There is no health, no fuel and no consumable in this game -- so aid');
  console.log('  is exactly one thing: A PARTIAL REFUND ON A MISTAKE ALREADY MADE.');
  console.log('');

  const courses = PKEYS.map((k) => Course.generate(k));
  const nAid = Math.round(courses.reduce((a, c) => a + c.aid.length, 0) / courses.length);
  const nRoad = Math.round(courses.reduce((a, c) => a + c.aid.filter((x) => !x.roof).length, 0) / courses.length);
  console.log(`  ${nAid} items on an average course (${nRoad} on the road, the rest on roofs)`);
  console.log('');

  // Marginal value of the Nth item, at several damage levels.
  function runTakingN(course, nHits, nTake) {
    const p = Pace.create(course.elevation);
    const hitAt = new Set();
    for (let i = 1; i <= nHits; i++) hitAt.add(Math.floor((course.gates.length * i) / (nHits + 1)));
    let gi = 0, ai = 0, gate = 0, got = 0, guard = 0;
    const aid = course.aid;
    while (!p.finished && guard++ < 200000) {
      p.update(1 / 60);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) {
        gi++; gate++;
        if (hitAt.has(gate)) p.onHit(); else p.onClean();
      }
      while (ai < aid.length && p.units >= aid[ai].z) {
        if (got < nTake) { p.onAid(aid[ai].gain); got++; }
        ai++;
      }
    }
    return p.finishTime;
  }
  console.log('  the MARGINAL value of the Nth item, in seconds off the finish:');
  console.log('');
  console.log('  run          1st item   4th     8th     12th    14th    all of them');
  for (const nHits of [0, 1, 3, 6, 12]) {
    const base = courses.map((c) => runTakingN(c, nHits, 0));
    const mean = (ts) => ts.reduce((a, b) => a + b, 0) / ts.length;
    const b = mean(base);
    const cells = [1, 4, 8, 12, 14].map(function (n) {
      const a = mean(courses.map((c) => runTakingN(c, nHits, n)));
      const bPrev = mean(courses.map((c) => runTakingN(c, nHits, n - 1)));
      return (bPrev - a).toFixed(2).padStart(6);
    });
    const all = mean(courses.map((c) => runTakingN(c, nHits, 99)));
    console.log(`  ${(nHits + ' mistakes').padEnd(12)} ${cells.join('  ')}   ` +
                `${(b - all).toFixed(1).padStart(6)}s total`);
  }
  console.log('');
  console.log('  Read the top row first: on a CLEAN run every item is worth 0.00s, by');
  console.log('  construction -- the min(streak + gain, gatesSeen) bound in pace.js means');
  console.log('  a flawless streak already exceeds anything a bottle can grant.');
}

// ===========================================================================
// policy: is there more than one winning line?
// ===========================================================================
// ===========================================================================
// zone: the surge zone's marking contract, in numbers
// ===========================================================================
//
// ---- THIS SECTION IS A HANDOVER, NOT AN ANALYSIS -------------------------
//
// Another agent builds the paint, the signage and whatever stands at the
// entry line. Everything they need to know is a number, and every one of
// those numbers is measured off the shipped generator here rather than
// asserted in prose -- the same way the ramp handed over its deck height and
// tailgate run. If a number below moves, the art is wrong the next morning
// and this section says so before anybody paints anything.
//
// The one sentence the whole contract serves: THE PLAYER COMMITS BEFORE THEY
// CAN SEE INSIDE. That is the risk the mechanic is made of, so the marking
// must carry exactly enough to make the bet fair and not one unit more.
if (want('zone')) {
  console.log('\n=== zone: the surge marking contract, in numbers ===\n');
  const cs = KEYS.map((k) => Course.generate(k));
  const all = [];
  for (const c of cs) for (const s of (c.surges || [])) all.push({ c, s });
  if (!all.length) {
    console.log('  no zones (EFFORT is off)');
  } else {
    const lens = all.map((x) => x.s.z1 - x.s.z0).sort((a, b) => a - b);
    const cnt = cs.map((c) => (c.surges || []).length).sort((a, b) => a - b);
    const SIGHT = all[0].s.sight;
    const baseSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE) / Pace.EFFORT_CFG.FLOOR_BASE;
    const surgeSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE) / Pace.EFFORT_CFG.FLOOR_SURGE;

    console.log(`  measured over ${cs.length} days, ${all.length} zones\n`);
    console.log('  WHERE A ZONE IS');
    console.log(`    count            ${cnt[0]} to ${cnt[cnt.length - 1]} a course, ` +
      `mean ${(cnt.reduce((a, b) => a + b, 0) / cnt.length).toFixed(2)}`);
    console.log(`    length           ${lens[0].toFixed(0)} to ${lens[lens.length - 1].toFixed(0)} units, ` +
      `median ${pctl(lens, 0.5).toFixed(0)}`);
    console.log(`    marked road      ${(100 * lens.reduce((a, b) => a + b, 0) /
      (cs.length * K.TOTAL_UNITS)).toFixed(1)}% of the course`);
    const fs2 = all.map((x) => x.s.z0 / K.TOTAL_UNITS).sort((a, b) => a - b);
    console.log(`    first entry at   ${(100 * fs2[0]).toFixed(0)}% of the race, ` +
      `last at ${(100 * fs2[fs2.length - 1]).toFixed(0)}%`);
    const gaps = [];
    for (const c of cs) {
      const z = c.surges || [];
      for (let i = 1; i < z.length; i++) gaps.push(z[i].z0 - z[i - 1].z1);
    }
    gaps.sort((a, b) => a - b);
    console.log(`    closest two      ${gaps[0].toFixed(0)} units apart, so no entry marking is`);
    console.log(`                     ever read against another zone's paint`);
    console.log('');

    console.log('  WHAT MUST BE LEGIBLE, AND FROM HOW FAR');
    console.log(`    sight distance   ${SIGHT} units. NOT a taste number: it is`);
    console.log(`                     Elevation.SIGHT_MIN, the distance the terrain sweep`);
    console.log(`                     already PROVES stays visible over every crest on`);
    console.log(`                     every course, so a hill cannot break this by`);
    console.log(`                     construction.`);
    console.log(`    ...in seconds    ${(1000 * SIGHT / baseSpeed).toFixed(0)} ms of approach at the unsurged floor`);
    console.log(`                     (${baseSpeed.toFixed(2)} u/s), ${(1000 * SIGHT / surgeSpeed).toFixed(0)} ms if already surging`);
    console.log(`                     (${surgeSpeed.toFixed(2)} u/s)`);
    // The last moment a lane change can start and still land before the line.
    const laneT = K.LANE_CHANGE_TIME;
    console.log(`    commit point     a lane change takes ${(1000 * laneT).toFixed(0)} ms, so the last`);
    console.log(`                     one that lands by the entry line starts ` +
      `${(laneT * baseSpeed).toFixed(1)} units out.`);
    console.log(`                     The marking therefore owes ` +
      `${(1000 * (SIGHT - laneT * baseSpeed) / baseSpeed).toFixed(0)} ms of READING`);
    console.log(`                     time before the last moment to act, against a ~400-500 ms`);
    console.log(`                     choice reaction. It is ` +
      `${((SIGHT - laneT * baseSpeed) / (laneT * baseSpeed)).toFixed(1)}x the act itself.`);
    console.log(`    three facts      that a zone begins; WHICH LANE is marked; how far it`);
    console.log(`                     runs. All three at ${SIGHT} units, all three from one look.`);
    console.log('');

    console.log('  WHAT THE PLAYER CANNOT KNOW AT THE COMMIT POINT');
    // How much of the zone is inside the sight cone at the entry line, and how
    // many of its gates that is.
    let gIn = 0, gTot = 0, blindFrac = [];
    for (const { c, s } of all) {
      const inZone = c.gates.filter((g) => g.z >= s.z0 && g.z < s.z1);
      gTot += inZone.length;
      gIn += inZone.filter((g) => g.z <= s.z0 + SIGHT).length;
      blindFrac.push(1 - Math.min(1, SIGHT / (s.z1 - s.z0)));
    }
    blindFrac.sort((a, b) => a - b);
    console.log(`    gates in a zone  ${(gTot / all.length).toFixed(1)} on average`);
    console.log(`    visible at entry ${(gIn / all.length).toFixed(1)} of them ` +
      `(${(100 * gIn / gTot).toFixed(0)}%)`);
    console.log(`    bought blind     ${(100 * pctl(blindFrac, 0.5)).toFixed(0)}% of the zone's road is ` +
      `past the sight line`);
    console.log(`                     at the moment the player commits. THAT IS THE BET.`);
    console.log('');

    console.log('  WHAT THE MARKED LANE IS GUARANTEED TO BE');
    let blockIn = 0, trainIn = 0, actIn = 0, clearIn = 0;
    for (const { c, s } of all) {
      for (const g of c.gates) {
        if (g.z < s.z0 || g.z >= s.z1) continue;
        const k = g.lanes[s.lane];
        if (k === K.BLOCK) blockIn++;
        else if (k === K.CLEAR) clearIn++;
        else actIn++;
        // `ramp` is the lane whose roof is rideable. NOT `train`, which is a
        // SPAN MULTIPLIER and not a lane index -- comparing it to s.lane
        // reported 993 rideable trains in marked lanes on the first run of
        // this section, in a game whose generator provably puts zero BLOCK
        // there. The instrument gets the same scrutiny as the work.
        if (g.ramp === s.lane) trainIn++;
      }
    }
    console.log(`    never a wall     ${blockIn} BLOCK in a marked lane over ${gTot} gates ` +
      `(must be 0)`);
    console.log(`    never a roof     ${trainIn} rideable trains in a marked lane (must be 0)`);
    console.log(`    what it IS       ${(100 * clearIn / gTot).toFixed(0)}% clear, ` +
      `${(100 * actIn / gTot).toFixed(0)}% an action you must perform`);
    console.log(`                     So the price of the surge is that you cannot dodge --`);
    console.log(`                     you must ACT at what is in front of you.`);
    if (blockIn) bad(`${blockIn} BLOCK hazards stand in a marked lane`);
    if (trainIn) bad(`${trainIn} rideable trains stand in a marked lane`);
    console.log('');

    console.log('  HOW MUCH OF IT IS A DECISION AT ALL');
    // The marked lane is sometimes the lane a player would take anyway. That
    // fraction is the fraction over which the paint is decoration, and it is
    // the single most useful number the art has: the marking has to work
    // hardest in the OTHER case, where the surge asks the player to leave a
    // clear lane for one that demands an action.
    let coincide = 0, contested = 0;
    for (const { c, s } of all) {
      for (const g of c.gates) {
        if (g.z < s.z0 || g.z >= s.z1) continue;
        const marked = g.lanes[s.lane];
        const anyClear = [0, 1, 2].some((l) => l !== s.lane && g.lanes[l] === K.CLEAR);
        if (marked === K.CLEAR) coincide++;
        else if (anyClear) contested++;
      }
    }
    console.log(`    free             ${(100 * coincide / gTot).toFixed(0)}% of in-zone gates leave the marked`);
    console.log(`                     lane clear -- the surge costs nothing there`);
    console.log(`    contested        ${(100 * contested / gTot).toFixed(0)}% ask the player to give up a clear`);
    console.log(`                     lane for one that demands an action. THIS is where the`);
    console.log(`                     marking has to be unmistakable, and it is the majority`);
    console.log(`                     of the road bought.`);
    console.log('');

    // ---- THE FAIRNESS NUMBER, AND IT IS THE ONE THAT CAN FAIL THE BUILD --
    //
    // Rule 4: a hazard the player could not act on is the game taking a run
    // for something outside their control, and that is a build failure and
    // not a difficulty setting. A surge makes the runner faster over road
    // that was already spaced, so the ONLY thing standing between this
    // mechanic and a rule 4 violation is that course.js widened the spacing
    // inside a zone by at least as much as the speed took away.
    //
    // Measured as the guaranteed decide window in MILLISECONDS -- the gap
    // from a gate becoming unoccluded to its line, at the speed the runner is
    // actually travelling there. Outside a zone that is the base floor.
    // Inside, it is the surge floor, which is 7% faster. If the inside number
    // is not at least as large as the outside one, an elected surge is buying
    // a reaction window the player cannot use and the mechanic must not ship.
    console.log('  IS AN ELECTED SURGE STILL FAIR (rule 4)');
    const winIn = [], winOut = [];
    for (const c of cs) {
      const zs = c.surges || [];
      for (let i = 1; i < c.gates.length; i++) {
        const g = c.gates[i], prev = c.gates[i - 1];
        const seen = prev.z + Course.reachOf(prev.lanes, prev.train) + K.CAM_BASE_BACK;
        const gap = g.z - seen;
        if (gap <= 0) continue;
        const inZ = zs.some((s) => g.z >= s.z0 && g.z < s.z1);
        (inZ ? winIn : winOut).push(1000 * gap / (inZ ? surgeSpeed : baseSpeed));
      }
    }
    winIn.sort((a, b) => a - b); winOut.sort((a, b) => a - b);
    console.log(`    outside a zone   floor ${winOut[0].toFixed(0)} ms, ` +
      `5th ${pctl(winOut, 0.05).toFixed(0)} ms, median ${pctl(winOut, 0.5).toFixed(0)} ms  ` +
      `(at ${baseSpeed.toFixed(1)} u/s)`);
    console.log(`    inside, surging  floor ${winIn[0].toFixed(0)} ms, ` +
      `5th ${pctl(winIn, 0.05).toFixed(0)} ms, median ${pctl(winIn, 0.5).toFixed(0)} ms  ` +
      `(at ${surgeSpeed.toFixed(1)} u/s)`);
    const dFloor = winIn[0] - winOut[0];
    // 5 ms of tolerance, which is a twelfth of a frame and two orders below a
    // choice reaction. It exists for float and rounding noise, not for slack:
    // the two defects this assertion caught were 50 ms and 22 ms.
    if (winIn[0] < winOut[0] - 5) {
      bad(`an elected surge costs ${(-dFloor).toFixed(0)} ms off the guaranteed window ` +
          '-- the zone widening is not paying for the speed (rule 4)');
    } else {
      console.log(`    verdict          the guaranteed floor is ${dFloor >= 0 ? '+' : ''}` +
        `${dFloor.toFixed(0)} ms INSIDE a zone at the`);
      console.log(`                     surge speed. The widening pays for the speed, so a`);
      console.log(`                     surge buys risk the player elected and never a gate`);
      console.log(`                     they could not act on.`);
    }
    console.log('');

    console.log('  WHAT THE ZONE COSTS THE COURSE');
    // ---- MATCHED CONTROL BANDS, AND THE FIRST CUT WAS CONFOUNDED --------
    //
    // The obvious measurement -- gates per 1000 units inside a zone against
    // the whole rest of the course -- reported zones carrying 7.9% MORE
    // gates, i.e. the widening making the road DENSER, which is impossible.
    // The confound is position: gate spacing tightens monotonically through
    // the race by design, and zones live at 15-82% of it, so "the rest of the
    // course" is mostly the sparse opening. Exactly the defect
    // tools/clarity.js had to be re-cut for, one instrument along.
    //
    // So each zone is read against a control band of ITS OWN LENGTH taken
    // from the road immediately before and after it, which holds the
    // difficulty ramp, the elevation and the narrow rate roughly fixed and
    // varies only whether the window was widened.
    let gIn2 = 0, uIn = 0, gCtl = 0, uCtl = 0;
    for (const { c, s } of all) {
      const len = s.z1 - s.z0;
      const zs = c.surges || [];
      const free = (a, b) => !zs.some((o) => b > o.z0 && a < o.z1);
      const bands = [[s.z0 - len, s.z0], [s.z1, s.z1 + len]]
        .filter((b) => b[0] > 0 && b[1] < K.TOTAL_UNITS && free(b[0], b[1]));
      if (!bands.length) continue;
      gIn2 += c.gates.filter((g) => g.z >= s.z0 && g.z < s.z1).length;
      uIn += len;
      for (const [a, b] of bands) {
        gCtl += c.gates.filter((g) => g.z >= a && g.z < b).length;
        uCtl += b - a;
      }
    }
    const mi = gIn2 / uIn, mo = gCtl / uCtl;
    console.log(`    matched control  the road of the SAME LENGTH either side of each zone,`);
    console.log(`                     because gate spacing tightens through the race and a`);
    console.log(`                     whole-course comparison reads that ramp, not the zone`);
    console.log(`    gate density     ${(1000 * mo).toFixed(1)} per 1000u beside a zone, ` +
      `${(1000 * mi).toFixed(1)} inside`);
    console.log(`    the price        ${(100 * (1 - mi / mo)).toFixed(1)}% fewer gates in marked road.`);
    console.log(`                     That is not a cost to be minimised, it IS the price`);
    console.log(`                     mechanism: a surge trades gates for pace, and a clean`);
    console.log(`                     gate is worth 3.2 s/mi at streak 5 and 0.17 s/mi at 50.`);
    console.log(`                     Ruinous early, nearly free late -- which is the whole`);
    console.log(`                     reason guard and surge want opposite halves of the race.`);
  }
}

if (want('policy')) {
  console.log('\n=== policy: how many ways are there to run this course? ===\n');
  console.log('  Six policies through the real Player, Collision, Course AND Pace, with a');
  console.log('  450 ms reaction latency. Motion comes from the shipped pace model, so');
  console.log('  the finish times are the game\'s own and not a replay approximation.');
  console.log('');
  console.log('  Swept across fluff rates. The six ORIGINAL policies differed only in');
  console.log('  which bottles they fetched, and under the shipped game that made them');
  console.log('  identical by construction -- aid was worth 0.00 s to a clean run, so a');
  console.log('  perfect-player table proved nothing and the six tied at a 0.0 s spread.');
  console.log('');
  console.log('  They are kept, and four SPEND policies are added underneath, because the');
  console.log('  fix for that finding was to give the bottle a second exit. A table that');
  console.log('  only varied collection would now be measuring the input to a decision it');
  console.log('  never makes -- which is exactly how this instrument came to report');
  console.log('  "no strategy" about a build that had just shipped one.');
  console.log('');
  const courses = PKEYS.map((k) => Course.generate(k));
  const nZones = courses.reduce((a, c) => a + (c.surges || []).length, 0) / courses.length;
  console.log(`  ${nZones.toFixed(1)} surge zones a course; the marked lane is where a`);
  console.log('  policy that ignores them still lands about a third of the time.');
  console.log('');
  const POLICIES = [
    // Collection policies: what the bottle is worth is now what it later buys,
    // so these all spend nothing and are the floor the spend policies are read
    // against rather than rivals to them.
    ['take every bottle    ', { seek: 1 }],
    ['take none            ', { seek: 0 }],
    ['early half only      ', { seek: 1, aidFrom: 0, aidTo: 0.5 }],
    ['late half only       ', { seek: 1, aidFrom: 0.5, aidTo: 1 }],
    ['safe lane (centre)   ', { seek: 0, bias: () => [1, 0, 2] }],
    ['shortest line (stay) ', { seek: 0, bias: (l) => [l, l - 1, l + 1] }],
    // Spend policies. Same collection (take every bottle), different answer to
    // the only question the pool asks: which road do you buy?
    // LINE policies. Same collection (take every bottle), different answer to
    // the only question left: which lane, given what is painted on it.
    ['+ read the paint     ', { seek: 1, line: { lift: 100, drag: -140 } }],
    ['+ ignore the paint   ', { seek: 1, line: { lift: 0, drag: 0 } }],
    ['+ chase green only   ', { seek: 1, line: { lift: 170, drag: 0 } }],
    ['+ flee red only      ', { seek: 1, line: { lift: 0, drag: -200 } }],
  ];
  for (const miss of [0, 0.06, 0.15, 0.30]) {
    console.log(`  fluffing ${(100 * miss).toFixed(0)}% of the actions asked for:`);
    console.log('');
    console.log('    policy                  contacts  guards   aid    lift   finish     vs record');
    const times = [];
    for (const [label, opts] of POLICIES) {
      const rs = courses.map((c) => raceAt(c, Object.assign(
        { pace: true, react: 0.45, sight: 'guarded', miss }, opts)));
      const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
      const ft = mean((r) => r.time);
      times.push(ft);
      const vs = ft - K.RECORD_SECONDS;
      const lift = mean((r) => r.liftU || 0);
      console.log(`    ${label}  ${mean((r) => r.hits).toFixed(2).padStart(8)}  ` +
                  `${mean((r) => r.guards).toFixed(2).padStart(6)}  ` +
                  `${mean((r) => r.aid).toFixed(1).padStart(4)}   ` +
                  `${Math.round(lift).toString().padStart(5)}u   ${Pace.clock(ft)}   ` +
                  `${(vs <= 0 ? '' : '+') + vs.toFixed(0)}s`);
    }
    const spread = Math.max.apply(null, times) - Math.min.apply(null, times);
    const nWin = times.filter((t) => t <= K.RECORD_SECONDS).length;
    console.log('');
    console.log(`    spread ${spread.toFixed(1)}s (${(100 * spread / times[0]).toFixed(2)}%); ` +
                `${nWin} of ${times.length} policies beat the record`);
    console.log('');
  }
}

// ===========================================================================
// the instrument's own audit
// ===========================================================================
console.log('\n=== audit: is this instrument lying to me? ===\n');
{
  // 1. The harness must reproduce the existing instruments at react = 0.
  //    If it does not, the finding is in my bot and not in the game.
  const c = Course.generate(PKEYS[0]);
  const ctrl0 = raceAt(c, { speed: RECORD_SPEED, react: 0, sight: 'guarded' });
  if (ctrl0.hits !== 0) {
    bad(`the zero-latency control takes ${ctrl0.hits} contacts -- the harness is broken, ` +
        `not the game. Every existing instrument reports a clean run here.`);
  } else {
    console.log('  ok  zero-latency control is clean, matching aid.js and mechanics.js');
  }
  // 2. It must resolve every gate on the course, or contacts are being missed
  //    by a bot that fell off the end rather than by a player who was slow.
  if (ctrl0.gates !== c.gates.length) {
    bad(`resolved ${ctrl0.gates} of ${c.gates.length} gates -- the sweep is not covering the course`);
  } else {
    console.log(`  ok  all ${c.gates.length} gates resolved`);
  }
  // 3. The latency must actually be reaching the bot. A latency knob that does
  //    nothing is exactly the defect tools/aid.js found in its own miss knob.
  const slow = raceAt(c, { speed: FLOOR_SPEED * 4, react: 0.45, sight: 'guarded' });
  const fast = raceAt(c, { speed: FLOOR_SPEED * 4, react: 0, sight: 'guarded' });
  if (slow.hits <= fast.hits) {
    bad(`at 4x the pace floor a 450 ms player takes ${slow.hits} contacts and a 0 ms ` +
        `player ${fast.hits} -- the latency knob is inert, so every "speed is safe" ` +
        `number above is unearned`);
  } else {
    console.log(`  ok  latency knob bites where it should: at 4x floor, ` +
                `${fast.hits} contacts at 0 ms vs ${slow.hits} at 450 ms`);
  }
  // 4. The guarded sighting model must be strictly harsher than the open one.
  const gh = raceAt(c, { speed: FLOOR_SPEED * 3, react: 0.45, sight: 'guarded' }).hits;
  const oh = raceAt(c, { speed: FLOOR_SPEED * 3, react: 0.45, sight: 140 }).hits;
  if (gh < oh) {
    bad(`the pessimistic sighting model takes FEWER contacts (${gh}) than the ` +
        `optimistic one (${oh}) -- the models are the wrong way round`);
  } else {
    console.log(`  ok  guarded sight is at least as harsh as open (${gh} vs ${oh} at 3x floor)`);
  }
  // 5. HAZARD_HALF_Z must still equal Collision.BOX, or reachOf -- which every
  //    window number here is measured from -- is describing a different solid.
  for (const kind of [K.JUMP, K.DUCK, K.BLOCK]) {
    if (Math.abs(Course.HAZARD_HALF_Z[kind] - Collision.BOX[kind].halfZ) > 1e-9) {
      bad(`HAZARD_HALF_Z[${kind}] ${Course.HAZARD_HALF_Z[kind]} != ` +
          `Collision.BOX halfZ ${Collision.BOX[kind].halfZ}`);
    }
  }
  console.log('  ok  course.js hazard depths agree with collision.js');

  // 6. ---- CAN THIS INSTRUMENT SEE THE MECHANIC IT IS MEASURING? ----------
  //
  // The check that would have caught the thing that stopped this work. This
  // file spent a whole build reporting six policies at a 0.0 s spread while
  // the pool, the guard and the surge zones were live in the shipped page --
  // truthfully, because not one of its bots had ever stood in a marked lane.
  // A blind instrument does not report an error. It agrees with you.
  //
  // So: a bot told to surge everything must actually surge, must actually
  // reach the surge floor, and must beat the same bot told to surge nothing.
  // All three, because each fails differently -- a lane term that never fires
  // fails the first, an election that never reaches Pace fails the second,
  // and a floor swap that does nothing fails the third.
  if (Pace.EFFORT > 0) {
    const cs = PKEYS.slice(0, 3).map((k) => Course.generate(k));
    const on = cs.map((c) => raceAt(c, { pace: true, react: 0.45, sight: 'guarded',
                                         seek: 1, line: { lift: 170, drag: -200 } }));
    const off = cs.map((c) => raceAt(c, { pace: true, react: 0.45, sight: 'guarded',
                                          seek: 1, line: { lift: 0, drag: 0 } }));
    const avg = (a, f) => a.reduce((x, r) => x + f(r), 0) / a.length;
    // Same three checks, one mechanic along. A lane term that never fires
    // fails the first; a mat that never reaches Pace fails the second; a
    // target shift that does nothing fails the third.
    const lu = avg(on, (r) => r.liftU), lo = avg(off, (r) => r.liftU);
    if (lu <= 0) {
      bad('a bot told to chase green ran NO forward mat -- this instrument is blind');
    } else if (lu <= lo) {
      bad(`chasing green ran ${lu.toFixed(0)}u of lift against ${lo.toFixed(0)}u ignoring it`);
    } else {
      console.log(`  ok  the bot can see the paint: chasing green runs ` +
        `${lu.toFixed(0)}u of lift against ${lo.toFixed(0)}u ignoring it`);
    }
    const gain = avg(off, (r) => r.time) - avg(on, (r) => r.time);
    if (gain <= 1) bad(`reading the paint is worth ${gain.toFixed(1)}s -- it is not reaching Pace`);
    else console.log(`  ok  and it is worth something: ${gain.toFixed(1)}s over the same bot ignoring it`);
  }
}

console.log('');
console.log(fail ? `FAIL  ${fail} audit problem(s) -- do not quote the numbers above`
                 : 'PASS  instrument audit clean');
process.exit(fail ? 1 : 0);
