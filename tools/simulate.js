#!/usr/bin/env node
/**
 * Headless verification of the pace model. Loads the real modules (no
 * reimplementation) and reports finish times across skill levels, so the
 * "about four minutes" and "beats 1:59:30 only on a clean line" claims are
 * checked against the shipped math rather than asserted.
 *
 *   node tools/simulate.js
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
const { Pace, Course, K } = ctx.MR;

/**
 * ---- WHICH GAME IS BEING MEASURED ---------------------------------------
 *
 * EFFORT ships at 1 -- the pool, the guard and the surge zones are the game --
 * and `--effort=0` returns the course and the pace model exactly as they were
 * before any of it existed, which is what makes the A/B one build rather than
 * a branch. Both settings are measured by this file; the assertions below know
 * which one they are looking at, because the CONTRACT DIFFERS between them and
 * pretending otherwise is how a tuning target gets quietly inherited.
 */
const EFFORT_ARG = process.argv.find((a) => a.indexOf('--effort=') === 0);
Pace.EFFORT = EFFORT_ARG ? parseFloat(EFFORT_ARG.slice(9)) : 1;
const EFFORT = Pace.EFFORT;

const DT = 1 / 60;
// Averaging over several dates keeps the verdict from hanging on one lucky
// course's gate count.
const KEYS = ['2026-08-05', '2026-08-06', '2026-12-25', '2027-03-14'];
// The policy sweep needs more courses than the pace tables do: it is comparing
// policies whose separation is tens of seconds against a per-race spread of
// the same order, so it averages over eight dates rather than four. Generation
// is cached, so the extra dates cost four course builds and nothing per race.
const SWEEP_KEYS = KEYS.concat(['2026-03-02', '2026-06-19', '2026-10-31', '2027-01-08']);

/**
 * Race a real generated course, clearing a fraction `skill` of its gates.
 * Driving the actual gate positions is the point -- a synthetic spacing
 * estimate is what hid a 13-second miss on the record during tuning.
 */
function raceOnce(key, skill) {
  const course = Course.generate(key);
  const p = Pace.create(course.elevation);
  let gi = 0, n = 0, guard = 0;
  while (!p.finished && guard++ < 200000) {
    p.update(DT);
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      gi++; n++;
      // Deterministic pattern rather than random, so the numbers reproduce.
      if (skill >= 1) p.onClean();
      else if (skill <= 0) p.onHit();
      else if (n % Math.max(2, Math.round(1 / (1 - skill))) === 0) p.onHit();
      else p.onClean();
    }
  }
  return p;
}

/** Mean over KEYS, returned as a synthetic Pace-like record. */
function run(skill) {
  const runs = KEYS.map((k) => raceOnce(k, skill));
  const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  return {
    finishTime: mean((r) => r.finishTime),
    realTime: mean((r) => r.realTime),
    hits: Math.round(mean((r) => r.hits)),
    bestStreak: Math.round(mean((r) => r.bestStreak)),
  };
}

console.log(`marathon      ${K.MARATHON_MILES.toFixed(5)} mi`);
console.log(`record        ${Pace.clock(K.RECORD_SECONDS)}  @ ${Pace.pace(K.RECORD_PACE)}/mi`);
console.log(`start pace    ${Pace.pace(K.START_PACE)}/mi`);
console.log(`floor pace    ${Pace.pace(K.FLOOR_PACE)}/mi`);
console.log('');
console.log('skill   finish     avg pace   real time   vs record   hits  best streak');

const rows = [
  ['perfect', 1.0],
  ['0.98', 0.98],
  ['0.95', 0.95],
  ['0.90', 0.90],
  ['0.75', 0.75],
  ['0.50', 0.50],
  ['never', 0.0],
];

let ok = true;
for (const [label, skill] of rows) {
  const p = run(skill);
  const avg = p.finishTime / K.MARATHON_MILES;
  const real = p.finishTime / K.TIME_SCALE + p.hits * 0; // race clock -> wall clock
  const vs = p.finishTime - K.RECORD_SECONDS;
  console.log(
    `${label.padEnd(7)} ${Pace.clock(p.finishTime).padStart(8)}  ${Pace.pace(avg).padStart(8)}/mi ` +
    `${(p.realTime).toFixed(1).padStart(8)}s  ${(vs >= 0 ? '+' : '') + vs.toFixed(0).padStart(6)}s ` +
    `${String(p.hits).padStart(6)} ${String(p.bestStreak).padStart(11)}`
  );
  // ---- THE CONTRACT THIS ROW IS HELD TO DEPENDS ON WHICH GAME IT IS ------
  //
  // These rows run the `n % k` counting model with NO surge and NO aid, so at
  // EFFORT = 1 the "perfect" row is a flawless line that spent nothing. In the
  // shipped game that line beat the record by 86 seconds and six policies tied
  // inside it; under EFFORT it must NOT, or the pool has nothing to buy and
  // the allocation is decoration. The assertion is inverted rather than
  // dropped, because a contract that stops being checked is a contract that
  // stops being true.
  if (label === 'perfect' && !EFFORT && vs >= 0) {
    ok = false; console.log('  FAIL: perfect run does not beat the record');
  }
  if (label === 'perfect' && EFFORT && vs <= 0) {
    ok = false;
    console.log('  FAIL: a flawless line that spent NOTHING still beats the record --');
    console.log('        there is nothing for the pool to buy, so there is no allocation');
  }
  if (label === 'perfect' && (p.realTime < 210 || p.realTime > 280)) {
    ok = false; console.log('  FAIL: perfect run is not ~4 minutes of wall clock');
  }
  if (label === 'never' && vs <= 0) { ok = false; console.log('  FAIL: a broken run still beats the record'); }
}

/**
 * A run that is clean except for exactly `n` hits, spread evenly. This is the
 * question that actually decides how forgiving the game is: what does one
 * mistake cost a player who is otherwise perfect?
 *
 * `take` is the fraction of aid items collected, and it is not optional
 * detail. Aid tops the streak back up to a ceiling, which exists precisely so
 * a broken run has a road back to record pace -- so a forgiveness table that
 * ignores it is not measuring this game. It answers the question for a player
 * who runs past every bottle on the course, which no real player does.
 *
 * `take` is modelled as "the first `take` fraction of items, by position", and
 * what that fraction COSTS is no longer a matter of luck. Every road item now
 * stands directly behind a JUMP or a DUCK, in that hazard's lane, at a gate
 * that also offers a lane through for nothing -- and player.resolveAid pays it
 * out only to a runner who was in that lane when that gate resolved. So the
 * "all of it" column is not a player who got lucky with their racing line. It
 * is a player who chose, fourteen times, to jump a thing they could have run
 * straight past, and this table charges them nothing for the risk of doing so.
 *
 * That makes this column the OPTIMISTIC bound and it should be read as one.
 * tools/aid.js races the same choice through the real state machine and prices
 * it: at 6% of actions fluffed, going for every bottle costs a full extra
 * contact over declining, and it stops being worth it once a player is 25%
 * likelier to fluff the jump they took for a bottle than the ones they had to
 * take anyway.
 */
function runWithNHits(n, take) {
  const times = KEYS.map((key) => {
    const course = Course.generate(key);
    const p = Pace.create(course.elevation);
    const hitAt = new Set();
    for (let i = 1; i <= n; i++) hitAt.add(Math.floor((course.gates.length * i) / (n + 1)));
    const aid = course.aid || [];
    const nTake = Math.round(aid.length * take);
    let gi = 0, ai = 0, gate = 0, got = 0, guard = 0;
    while (!p.finished && guard++ < 200000) {
      p.update(DT);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) {
        gi++; gate++;
        if (hitAt.has(gate)) p.onHit(); else p.onClean();
      }
      while (ai < aid.length && p.units >= aid[ai].z) {
        // Spread the misses evenly rather than skipping the tail, so a partial
        // take rate is not secretly "collect everything, then stop".
        if (got < nTake && (take >= 1 || Math.floor(ai * take) === got)) {
          p.onAid(aid[ai].gain); got++;
        }
        ai++;
      }
    }
    return p.finishTime;
  });
  return { finishTime: times.reduce((a, b) => a + b, 0) / times.length };
}

const nAid = Math.round(KEYS.reduce((a, k) => a + Course.generate(k).aid.length, 0) / KEYS.length);
console.log('');
console.log(`how many mistakes the record survives (${nAid} aid items on course)`);
if (EFFORT) {
  // Said out loud rather than left for a reader to trip over. Under EFFORT a
  // bottle fills the POOL instead of topping up the streak, so onAid returns
  // no seconds at all and the three columns below are the same number three
  // times. What the pool buys is a GUARD -- a contact that never happens --
  // and a contact that never happens does not appear in a table indexed by
  // how many contacts there were. The policy sweep is where aid is priced now.
  console.log('  (under EFFORT a bottle fills the pool, so it buys a GUARD rather than a');
  console.log('   refund -- the three columns are identical by construction. See the sweep.)');
}
console.log('');
console.log('mistakes   no aid       half the aid    all of it');
for (const n of [0, 1, 2, 3, 5, 10]) {
  const cells = [0, 0.5, 1].map((take) => {
    const t = runWithNHits(n, take).finishTime;
    const vs = t - K.RECORD_SECONDS;
    return `${Pace.clock(t)} ${(vs <= 0 ? '' : '+') + vs.toFixed(0)}s`.padEnd(15);
  });
  console.log(`${String(n).padStart(8)}   ${cells.join(' ')}`);
}
/**
 * The headline the tuning actually turns on: with aid, how many can you drop?
 *
 * ---- AND IT REPORTS ITS OWN MARGIN, BECAUSE IT IS AN INTEGER CUT FROM A
 *      CONTINUOUS NUMBER --------------------------------------------------
 *
 * This used to print the integer alone, and an integer alone is exactly the
 * kind of number rule 3 warns about. The aid placement rule was rewritten and
 * this line went from "3 taking all of it" to "4", which reads as the game
 * getting a whole mistake more forgiving. It did not: n = 4 finished 0.6s the
 * wrong side of the record before and 0.7s the right side after. A 1.3-second
 * swing on a 7,076-second race, caused by aid items moving tens of units along
 * the course and so landing their streak top-ups at slightly different places
 * relative to evenly-spaced mistakes.
 *
 * A reader shown only the integer would have gone looking for a difficulty
 * change that was never made, or -- worse -- retuned the pace model to put it
 * back. So the margin at the boundary is printed with it: how much room the
 * last surviving mistake had, and how much the first fatal one missed by.
 * When either is a second or two, the integer is noise and should be read as
 * such.
 */
const budget = (take) => {
  for (let n = 0; n <= 40; n++) {
    if (runWithNHits(n, take).finishTime > K.RECORD_SECONDS) {
      return { n: n - 1,
               spare: n > 0 ? K.RECORD_SECONDS - runWithNHits(n - 1, take).finishTime : 0,
               over: runWithNHits(n, take).finishTime - K.RECORD_SECONDS };
    }
  }
  return { n: 40, spare: 0, over: 0 };
};
console.log('');
const b0 = budget(0), b5 = budget(0.5), b1 = budget(1);
console.log(`  mistakes the record survives:  ${b0.n} with no aid, ` +
            `${b5.n} taking half, ${b1.n} taking all of it`);
console.log('');
console.log('  ...and how close each of those is to being a different integer:');
for (const [label, b] of [['no aid', b0], ['half', b5], ['all', b1]]) {
  console.log(`    ${label.padEnd(7)} ${b.n} survives with ${b.spare.toFixed(1)}s to spare; ` +
              `${b.n + 1} misses by ${b.over.toFixed(1)}s`);
}

/**
 * =======================================================================
 * THE POLICY SWEEP
 * =======================================================================
 *
 * Everything above this line sweeps SKILL and holds policy fixed, because
 * until now there was no policy to sweep -- and that is precisely the finding
 * that condemned the game. docs/risk-reward.md raced six distinct policies
 * through the real state machine and got 1:58:03 from all six, spread 0.0
 * seconds, all of them 86 s inside the record. One input, one monotone reward,
 * one optimal policy.
 *
 * The owner's acceptance criterion for the fix is not a feel:
 *
 *   "We want this to be difficult. If people get it on the first try
 *    everytime they will not always play."
 *
 * So this section sweeps SKILL x POLICY and reports what fraction of the grid
 * beats 1:59:30. The target the tuning was cut to is stated below the table
 * rather than left for a reader to infer.
 *
 * ---- WHY THIS DOES NOT USE THE `n % k` PATTERN THE TABLES ABOVE USE -------
 *
 * That pattern decides an outcome from a COUNTER. It cannot see this question
 * at all, and risk-reward.md says so in as many words: it "decides outcomes
 * from a counting pattern", so a policy that changes WHICH LANE the runner is
 * in changes nothing about how often they fall over. A sweep built on it would
 * have printed a beautiful table in which every policy was identical, for the
 * second time.
 *
 * So the model here is structural and it is read off the real gate table:
 *
 *   A CONTACT CAN ONLY HAPPEN WHERE AN ACTION IS DEMANDED. Outside a surge the
 *   runner takes the easiest lane, so the only gates that demand anything are
 *   the full-width ones -- makeGate ships 10% of those at d < 0.34 and 62% at
 *   the top of the curve, and it never puts a BLOCK on one, so all three lanes
 *   are answerable WITH the right action.
 *
 *   INSIDE A SURGE THE LANE IS NOT A CHOICE. Electing the surge means being in
 *   the marked lane, so the runner faces whatever the marked lane holds at
 *   every gate in the zone rather than the easiest of three. That is the whole
 *   risk of a surge and it needs no invented multiplier: it falls out of the
 *   course data.
 *
 *   COLLECTING AID IS AN ACTION TOO. The placement rule puts every road item
 *   directly behind a JUMP or a DUCK in that hazard's lane, at a gate that also
 *   offers a lane through for nothing -- so a policy that goes and gets a
 *   bottle has bought exactly one extra demanded action, which is what
 *   tools/aid.js measures on the real state machine.
 *
 * `skill` is then one number with one meaning: the probability of clearing a
 * demanded action. It is rolled from a seeded stream keyed on the date, the
 * skill and the policy, so every cell reproduces exactly.
 *
 * ---- AND THE GRID IS SPLIT BY WHAT A FIRST ATTEMPT CAN KNOW ---------------
 *
 * The criterion is about a FIRST attempt, so a policy that needs the day's
 * course memorised is not available on one. BLIND, ALL-IN and the two
 * never-spend policies can be run by someone who has never seen the course;
 * LATE, LONGEST and SPLIT cannot. Both fractions are reported, because "can a
 * stranger beat it" and "can anyone beat it" are different questions and the
 * design has to answer them differently.
 */
const Kk = K;
const rngOf = ctx.MR.rng;

/**
 * ---- THE POLICIES ARE LINES NOW, NOT SPENDS --------------------------------
 *
 * They used to be SURGE ALLOCATIONS -- which zones to elect out of six, with
 * HOLD 1 and HOLD 2 carrying the design's whole claim that the same pool spent
 * later is worth more. The owner removed the surge ("One speed system"), so
 * the pool has one spend again and there is no allocation left to sweep.
 *
 * docs/risk-reward.md is the standing warning about exactly this: BEFORE the
 * pool had two rival uses, six policies finished at 1:58:03 with a spread of
 * 0.0 seconds, because aid was insurance with no premium and there was nothing
 * to decide. If this sweep now comes back near zero, this pass has undone
 * roadmap 66 and the owner has to hear it in plain words.
 *
 * THE REPLACEMENT AXIS IS THE LINE. At nearly every gate the runner weighs
 * what a lane costs in ACTIONS against what it pays in TEMPO, and the policies
 * below are the different answers to that. It is a different KIND of strategy
 * from an allocation -- local and repeated rather than global and committed --
 * and whether it carries the weight is what the spread at the bottom measures.
 *
 * `mats` is how the policy reads the paint:
 *   cost      score both in race seconds; the informed line
 *   ignore    mats are invisible; route on actions alone
 *   green     take a lift lane whatever the action costs
 *   red       never stand on a drag while another lane is open
 *   freegreen take a lift only where it costs no action
 * `take` is aid: 0 none, 1 all, 'plan' only where the detour is not dragged.
 * `learned` records whether running it needs the day's course known in advance
 * -- and the split is real here: a mat is visible from READ_NEAR, so reading
 * one is a FIRST-ATTEMPT skill, while planning a chain of them or declining a
 * bottle you know sits in a slow lane is not.
 */
/**
 * ---- `take` CHANGED MEANING WITH THE ABUNDANCE PASS ----------------------
 *
 * Aid is hundreds of small pickups now -- trails collected by being in their
 * lane, arc strings bought at a gate with an action -- so "collect it or not"
 * stopped being a binary. EVERY policy collects whatever falls in the lane it
 * is running (a player cannot decline a coin under their feet), and `take` is
 * how the policy STEERS for more:
 *
 *   'none'   no pickup term in the lane choice; incidental collection only.
 *   'chase'  a flat attraction per visible pickup -- the coin-chasing
 *            newcomer the abundance is for, who will pay an action or stand
 *            on paint they have not read for a fat trail.
 *   'value'  pickups priced honestly in race seconds: a segment is worth
 *            roughly a mid-race contact's streak cost only when a hit is
 *            still likely and the pool has room, so the term scales with
 *            (1 - skill) and vanishes for a runner who does not miss.
 *   'plan'   'value' plus course knowledge: an arc whose lane is dragged, or
 *            a trail that parks the runner in red paint, is declined in
 *            advance -- the thing a stranger structurally cannot do.
 */
const POLICIES = [
  { name: 'NO AID',    take: 'none',  mats: 'cost',      learned: false },
  { name: 'COIN CHASE',take: 'chase', mats: 'ignore',    learned: false },
  { name: 'READ ROAD', take: 'value', mats: 'cost',      learned: false },
  { name: 'AVOID RED', take: 'none',  mats: 'red',       learned: false },
  { name: 'CHASE GRN', take: 'none',  mats: 'green',     learned: false },
  { name: 'FREE GRN',  take: 'none',  mats: 'freegreen', learned: false },
  // ---- WHAT KNOWING THE COURSE IS ACTUALLY WORTH NOW --------------------
  //
  // HOLD 1 and HOLD 2 carried this column and they were about the pool. With
  // one spend, what a learned player has that a stranger does not is the
  // ability to decline something in advance: a bottle standing in a lane they
  // already know is dragged, or a detour that costs a lift they already know
  // is coming. That is the same shape of claim -- the same resource spent with
  // foreknowledge is worth more -- moved from the tank to the line.
  { name: 'PLAN AID',  take: 'plan', mats: 'cost',      learned: true },
  { name: 'PLAN+RED',  take: 'plan', mats: 'red',       learned: true },
  // ---- GRN CHAIN IS RETIRED, AND THE REASON IS A FINDING ---------------
  //
  // CHAIN looked 300 units ahead and picked the lane leading to the most
  // green, on the claim that a greedy gate choice can strand the runner on
  // the wrong side of the road for a mat two gates later. Measured, it LOST
  // to the myopic informed line at every skill -- because a lane change in
  // this game costs nothing and every mat covers a gate line, so whatever a
  // greedy line "missed" it simply swerves into at the next gate. There is
  // no wrong side of the road to be stranded on. That is the structural cap
  // on what course knowledge can be worth here at flawless execution, and
  // it is stated in roadmap 73 rather than papered over.
  //
  // What replaces it is the learned line the ABUNDANCE actually creates:
  // HARVEST runs the informed read with a deliberate appetite for pickups
  // (drag-aware, pre-positioned so no trail head is missed, arcs fetched) --
  // the line that maximises guard, which is what knowing the day buys when
  // the currency is coins. It gives up mat-seconds for segments, so it is
  // the specialist of the sub-perfect rows where segments matter.
  { name: 'HARVEST',   take: 'harvest', mats: 'cost',   learned: true },
];

/**
 * One race. Real Course, real Pace, real elevation; the lane the runner is in
 * is decided by the policy and the outcome of every demanded action by `skill`.
 */
const COURSE_CACHE = new Map();
function courseFor(key) {
  if (!COURSE_CACHE.has(key)) COURSE_CACHE.set(key, Course.generate(key));
  return COURSE_CACHE.get(key);
}

function policyRace(key, skill, pol, seed) {
  // Cached. Generation is by far the most expensive thing here and the sweep
  // asks for the same four courses ~240 times; nothing in this loop writes to
  // the course, so one copy is one copy.
  const course = courseFor(key);
  const p = Pace.create(course.elevation);
  const rnd = rngOf.stream(key, 'sweep/' + skill + '/' + pol.name + '/' + seed);
  // The aid table, split the way the collection rules split it: ARCS are
  // receipt-guarded strings hanging off a gate (fetched by steering into the
  // hazard lane at that gate), LOOSE items are trails and clusters collected
  // by being in their lane when z passes them. Roof items need a ramp this
  // model does not ride, same as before.
  const arcs = new Map();                 // gate index -> [items]
  const loose = [];                       // unguarded road items, by z
  for (const it of (course.aid || [])) {
    if (it.roof) continue;
    if (it.gate != null) {
      if (!arcs.has(it.gate)) arcs.set(it.gate, []);
      arcs.get(it.gate).push(it);
    } else loose.push(it);
  }
  // What one pickup is worth to an HONEST line, in race seconds: a whole
  // segment guards one contact, a contact costs its streak (~tens of seconds
  // mid-race, proxied by the same 8x penalty the action term uses) less the
  // stumble the guard still charges -- and it is worth that only to a runner
  // who still misses. (1 - skill) is that runner. A perfect line prices every
  // pickup at zero, which is the honest answer and the reason a COIN CHASE
  // values them at a flat rate instead.
  const segWorth = Math.max(0, (1 - skill) * Kk.HIT_TIME_PENALTY * 8 - Pace.EFFORT_CFG.GUARD_TIME);
  const pickVal = segWorth / Pace.EFFORT_CFG.PER_SEG;
  const CHASE_VAL = 0.5;                  // flat seconds-equivalent per coin

  let gi = 0, guard = 0;
  /**
   * ---- THIS MODEL NOW HAS TO KNOW WHICH LANE IT IS IN -------------------
   *
   * It never did, and it never needed to: every question it asked was about a
   * KIND -- what does the lane I chose demand -- and the lane index itself was
   * a local variable that died at the end of the gate.
   *
   * A tempo mat is a fact about a LANE OVER A STRETCH OF ROAD, so a model that
   * forgets which lane it is in cannot see one. Left alone, this sweep would
   * have reported the record contract of a game with directional mats in it and
   * never applied a single mat -- which is the same blindness roadmap 67 found
   * in every bot in the project, and which this pass has now had to fix in
   * risk.js as well.
   *
   * The lane persists between gates because the runner does: whatever lane the
   * last gate was answered in is the lane the road under him belongs to until
   * the next one. Starts at 1, the lane the player starts in.
   */
  let lane = 1;
  let li = 0;                               // cursor over the loose pickups
  // ---- WHAT A FIRST ATTEMPT CAN SEE, AND WHAT PRE-POSITIONING BUYS --------
  //
  // Two facts about the real game that the first version of this model
  // flattened, both in the direction of making course knowledge worthless:
  //
  //   SIGHT. Paint and pickups are readable from READ_NEAR (~25 u), not from
  //   arbitrarily far. A first-attempt line choosing a lane at a gate can
  //   weigh what lies within that range of the gate; a learned line knows
  //   the whole gap and beyond. So the myopic policies read mats and coins
  //   over [gate, gate + READ_NEAR] and the learned ones over the full gap
  //   (and 300 u for CHAIN).
  //
  //   THE HEAD OF THE TRAIL. A trail is ~25-40 u of items. A stranger sees
  //   its first coin at READ_NEAR, swerves, and joins the line a few items
  //   in; a player who ran the day this morning is already in the lane. So a
  //   non-learned policy that SWITCHES lane at a gate misses the loose items
  //   in the first HEAD_MISS units past it. That is the pre-positioning
  //   edge, stated as geometry rather than invented as a bonus.
  const SIGHT = Course.READ_NEAR;
  const HEAD_MISS = 12;
  let missLane = -1, missBefore = -1;       // head-miss window after a switch
  while (!p.finished && guard++ < 200000) {
    // The mat under the lane being held. This is the whole of the speed
    // system now: there is no election and no burn, only which lane you are in.
    const mat = course.tempoAt ? course.tempoAt(p.units, lane) : null;
    p.tempo = mat ? mat.dir : 0;
    p.update(DT);
    // ---- LOOSE PICKUPS ARE COLLECTED BY THE LANE, NOT BY A DECISION ------
    //
    // A trail item pays out to whoever is in its lane when z passes it --
    // player.resolveAid's unguarded branch, term for term. Every policy
    // collects incidentally, because a player cannot decline a coin under
    // their feet; what `take` steers is whether the lane CHOICE leans toward
    // them, below.
    while (li < loose.length && loose[li].z <= p.units) {
      const it = loose[li++];
      if (it.lane !== lane) continue;
      if (it.lane === missLane && it.z < missBefore) continue;   // joined late
      p.onAid(it.gain);
    }
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      const g = course.gates[gi];
      let arc = arcs.get(gi) || null;
      gi++;
      const nextZ = gi < course.gates.length ? course.gates[gi].z : Kk.TOTAL_UNITS;

      // ---- FETCH THE ARC, OR PRICE IT AND DECLINE --------------------------
      //
      // An arc string is bought with one action at this gate. A COIN CHASE
      // fetches every one -- that is what chasing is. The honest policies
      // price it: the string's worth (which scales with (1 - skill), because
      // a segment only guards a hit you were going to take) against the
      // action's expected cost -- and at the shipped numbers that trade says
      // no for a runner who rarely misses, which is the intended shape:
      // arcs feed the players who need the guard. PLAN additionally declines
      // an arc whose lane is dragged, which a stranger cannot know in time.
      if (arc) {
        if (pol.take === 'none') arc = null;
        else if (pol.take === 'harvest') {
          // The learned harvester fetches every arc that is not in red paint:
          // segments are what it is there for.
          const dm = course.tempoAt ? course.tempoAt(g.z, arc[0].lane) : null;
          if (dm && dm.dir < 0) arc = null;
        } else if (pol.take === 'value' || pol.take === 'plan') {
          const aLane = arc[0].lane;
          const dm = course.tempoAt ? course.tempoAt(g.z, aLane) : null;
          if (pol.take === 'plan' && dm && dm.dir < 0) arc = null;
          else {
            const actCost = (1 - skill) * Kk.HIT_TIME_PENALTY * 8;
            if (arc.length * pickVal <= actCost) arc = null;
          }
        }
      }

      const prevLane = lane;
      if (arc) {
        // Gone to fetch the string: the lane it hangs in, which the arc rule
        // guarantees holds a JUMP or a DUCK.
        lane = arc[0].lane;
      } else {
        // ---- FREE CHOICE, AND THE MAT IS PART OF IT NOW ------------------
        //
        // It was "CLEAR if any lane offers it, otherwise lane 0", which is the
        // right model of a player who only cares about actions. With mats on
        // the road a clear lane is not necessarily the cheapest lane: a drag
        // costs 5.0 race seconds and clearing a hurdle costs P(fluff) times a
        // contact, which at the skills this sweep runs is less than that at
        // three of its five levels.
        //
        // So the choice is scored in ONE currency -- race seconds -- rather
        // than by a rule of thumb. An action is charged the seconds it is
        // expected to cost THIS runner, which this model happens to know
        // exactly, and the mat is charged what tools/tempo.js measured it at
        // over the length actually run. That is a better-informed player than
        // main.js's bot can be, and it is stated rather than hidden: what this
        // sweep bounds is what a player who reads the road perfectly can do,
        // which is the right question for a RECORD.
        // How far this policy reads the road it is choosing for: a stranger
        // to READ_NEAR past the gate, a learned line to the next gate. See
        // the SIGHT note above -- this is the honest split, and flattening
        // it is how the first version of this model priced course knowledge
        // at zero.
        const look = pol.learned ? nextZ : Math.min(nextZ, g.z + SIGHT);
        let best = null, bestCost = Infinity;
        for (let l = 0; l < 3; l++) {
          if (g.lanes[l] === Kk.BLOCK) continue;
          // Signed tempo seconds over what this policy can see of the lane,
          // and the presence flags the rule-of-thumb policies key on.
          let tempo = 0, hasLift = false, hasDrag = false;
          for (const mm of (course.tempo || [])) {
            if (mm.lane !== l || mm.z1 <= g.z || mm.z0 >= look) continue;
            const ov = Math.min(mm.z1, look) - Math.max(mm.z0, g.z);
            tempo += (mm.dir > 0 ? -Pace.TEMPO.LIFT : Pace.TEMPO.DRAG)
              * ov / Kk.UNITS_PER_MILE;
            if (mm.dir > 0) hasLift = true; else hasDrag = true;
          }
          // ---- THE SKILL TERM WAS INVERTED, AND IT MATTERED --------------
          //
          // `skill` is P(clear a demanded action) -- the loop below rolls
          // `rnd.next() >= skill` and calls that a hit. So the EXPECTED cost of
          // taking an action lane is (1 - skill) x the cost of a contact. This
          // charged `skill x cost`, which is exactly backwards: it billed a
          // PERFECT runner the full price of an action they never fluff, and
          // billed the sloppiest runner the least.
          //
          // The effect was not cosmetic. READ ROAD is the policy that scores
          // both channels in race seconds and is supposed to bound what a
          // player reading the road perfectly can do -- and it was losing to
          // the naive CHASE GRN, because it was declining green lanes whose
          // action it would have cleared every time. An instrument that makes
          // the informed line look worse than the greedy one is not measuring
          // the strategy, it is measuring its own arithmetic.
          const act = g.lanes[l] === Kk.CLEAR ? 0 : (1 - skill) * Kk.HIT_TIME_PENALTY * 8;
          let cost;
          switch (pol.mats) {
            // Actions only: the player who cannot or will not read the paint.
            case 'ignore': cost = act; break;
            // A drag is intolerable while any other lane is open; among the
            // rest, actions decide.
            case 'red': cost = act + (hasDrag ? 1e4 : 0); break;
            // A lift is taken whatever it costs in actions; among the rest,
            // actions decide.
            case 'green': cost = act - (hasLift ? 1e4 : 0); break;
            // A lift is worth having only where it is free.
            case 'freegreen':
              cost = act - (hasLift && g.lanes[l] === Kk.CLEAR ? 1e4 : 0);
              break;
            // The 'chain' case stood here and went with GRN CHAIN -- see the
            // retirement note on the POLICIES table.
            // Both charged in race seconds. The informed line, and the one
            // that bounds what a player reading the road perfectly can do --
            // which is the right question for a RECORD.
            default: cost = act + tempo;
          }
          // ---- AND THE COINS PULL ON THE CHOICE --------------------------
          //
          // The pickups lying in this lane over the same `look` the mats
          // use. A CHASE values each at a flat half-second-equivalent, which
          // is not a price, it is an appetite -- big enough to pay an unread
          // action or stand on unread paint for a fat trail, which is
          // exactly the newcomer the abundance is built to engage. The
          // honest policies use pickVal, priced above, which goes to zero as
          // skill goes to one -- and PLAN, which knows the day, does not
          // count a coin that sits in red paint.
          if (pol.take !== 'none') {
            let cnt = 0;
            for (let j = li; j < loose.length && loose[j].z < look; j++) {
              if (loose[j].lane !== l) continue;
              if ((pol.take === 'plan' || pol.take === 'harvest') && course.tempoAt) {
                const dm = course.tempoAt(loose[j].z, l);
                if (dm && dm.dir < 0) continue;
              }
              cnt++;
            }
            cost -= cnt * (pol.take === 'chase' ? CHASE_VAL
              : pol.take === 'harvest' ? 0.35 : pickVal);
          }
          if (cost < bestCost) { bestCost = cost; best = l; }
        }
        lane = best === null ? 0 : best;
      }
      // The head of the trail is missed by a stranger who switched for it --
      // see HEAD_MISS above. A learned line was already there.
      if (lane !== prevLane && !pol.learned) {
        missLane = lane; missBefore = g.z + HEAD_MISS;
      }
      const kind = g.lanes[lane];

      const demanded = kind !== Kk.CLEAR;
      if (demanded && rnd.next() >= skill) p.onHit();
      else p.onClean();
      // The string is bought at the gate, cleanly or not -- the shipped rule
      // (player.resolveAid pays the receipt either way, because a rescue that
      // only paid the players who did not need rescuing is roadmap 40's
      // defect). The fetch put the runner in the arc's lane, so the receipt
      // matches whenever the fetch happened.
      if (arc) for (const it of arc) p.onAid(it.gain);
    }
  }
  return p;
}

console.log('');
console.log('='.repeat(74));
console.log(`POLICY x SKILL  --  what beats ${Pace.clock(K.RECORD_SECONDS)}`);
console.log('='.repeat(74));
console.log(`  EFFORT ${ctx.MR.Pace.EFFORT}   ` +
  (ctx.MR.Pace.EFFORT > 0
    ? `floor ${Pace.pace(ctx.MR.Pace.EFFORT_CFG.FLOOR_BASE)}/mi, ` +
      `mat +-${Pace.TEMPO.LIFT}/${Pace.TEMPO.DRAG} s/mi, ` +
      `pool ${ctx.MR.Pace.EFFORT_CFG.POOL_MAX} (guard only)`
    : '(the shipped game -- no pool, no zones)'));
console.log('');

const SKILLS = [1.0, 0.995, 0.99, 0.98, 0.96];
const SEEDS = 14;
const SE = [];
const cells = [];
let head = 'policy      ';
for (const sk of SKILLS) head += String(sk === 1 ? 'perfect' : sk.toFixed(3)).padStart(10);
console.log(head + '     beats');
for (const pol of POLICIES) {
  let row = (pol.name + (pol.learned ? '*' : '')).padEnd(12);
  let win = 0;
  for (const sk of SKILLS) {
    // ---- ONE SEED PER CELL WAS AN INSTRUMENT DEFECT, NOT A RESULT --------
    //
    // The first version of this table ran one seeded race per date per cell,
    // and it printed ALL-IN and BLIND -- which were, through an unused flag,
    // literally the same policy -- 69 seconds apart at skill 0.98. Every cell
    // in the grid was one draw from a distribution whose spread was larger
    // than the effect being measured, and the table read as a strategy finding.
    //
    // SEEDS x KEYS races a cell, so each number below is a mean of 24. The
    // per-cell standard error is reported under the table rather than left for
    // a reader to assume it away.
    const ts = [];
    for (const k of SWEEP_KEYS) for (let sd = 0; sd < SEEDS; sd++) ts.push(policyRace(k, sk, pol, sd).finishTime);
    const t = ts.reduce((a, b) => a + b, 0) / ts.length;
    const sd2 = ts.reduce((a, b) => a + (b - t) * (b - t), 0) / (ts.length - 1);
    SE.push(Math.sqrt(sd2 / ts.length));
    const beat = t < K.RECORD_SECONDS;
    if (beat) win++;
    cells.push({ pol: pol.name, learned: pol.learned, skill: sk, t, beat });
    row += (Pace.clock(t) + (beat ? '*' : ' ')).padStart(10);
  }
  console.log(row + String(win + '/' + SKILLS.length).padStart(10));
}
console.log('');
console.log('  * after a policy name: needs the day\'s course learned first.');
console.log('  * after a time: beats the record.');
console.log(`  each cell is the mean of ${SWEEP_KEYS.length} dates x ${SEEDS} seeds; ` +
  `worst standard error ${Math.max.apply(null, SE).toFixed(1)}s.`);

const frac = (f) => {
  const set = cells.filter(f);
  return { n: set.filter((c) => c.beat).length, of: set.length };
};
const all = frac(() => true);
const first = frac((c) => !c.learned);
const learned = frac((c) => c.learned);
const spread = (() => {
  const at1 = cells.filter((c) => c.skill === 1).map((c) => c.t);
  return Math.max.apply(null, at1) - Math.min.apply(null, at1);
})();
console.log('');
console.log(`  beats the record, all cells          ${all.n} of ${all.of}  (${(100 * all.n / all.of).toFixed(0)}%)`);
console.log(`  ...on a FIRST attempt                ${first.n} of ${first.of}  (${(100 * first.n / first.of).toFixed(0)}%)`);
console.log(`  ...with the course learned           ${learned.n} of ${learned.of}  (${(100 * learned.n / learned.of).toFixed(0)}%)`);
console.log(`  spread across policies at perfect    ${spread.toFixed(1)}s`);

/**
 * THE TUNING TARGET, STATED SO IT CAN BE ARGUED WITH.
 *
 *   1. POLICY MUST MATTER. The shipped game's spread across policies at
 *      perfect skill is 0.0 s. Anything under about 15 s is inside the noise a
 *      player could feel, so the tank is not balanced (docs/strategy-space.md
 *      asked for exactly this check).
 *   2. A GOOD ALLOCATION MUST BE ABLE TO WIN. At least one cell beats it, or
 *      the record is dead and the game has no target.
 *   3. NOT EVERYTHING WINS. Under half the grid, or the allocation is a
 *      formality.
 *   4. A STRANGER MUST NOT WALK IT. Strictly under half of the first-attempt
 *      cells, which is the owner's sentence made checkable.
 */
if (ctx.MR.Pace.EFFORT > 0) {
  const fails = [];
  if (spread < 15) fails.push(`policy spread ${spread.toFixed(1)}s is under 15s -- policy does not matter`);
  if (all.n === 0) fails.push('no policy at any skill beats the record -- the target is dead');
  if (all.n > all.of * 0.5) fails.push(`${all.n}/${all.of} cells beat the record -- allocation is a formality`);
  if (first.n >= first.of * 0.5) {
    fails.push(`${first.n}/${first.of} FIRST-ATTEMPT cells beat the record -- a stranger walks it`);
  }
  for (const f of fails) { ok = false; console.log('  FAIL: ' + f); }
  if (!fails.length) console.log('  PASS  policy matters, the record is live, and it is not free');
}

console.log('');
console.log(ok ? 'PASS  pace model satisfies its stated contract' : 'FAIL  see above');
process.exit(ok ? 0 : 1);
