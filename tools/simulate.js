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

// The spend policies. `wants(zone, course)` decides whether this policy elects
// the surge in a zone; `take` is whether it detours for aid at all; `learned`
// records whether running it needs the day's course known in advance.
const POLICIES = [
  { name: 'NO AID',   take: 0, learned: false, wants: () => false },
  { name: 'GUARD',    take: 1, learned: false, wants: () => false },
  { name: 'BLIND',    take: 1, learned: false, wants: () => true },
  // Alternate zones. Needs no knowledge of the day -- you can count them as
  // they arrive -- so it is a first-attempt policy, and it is the cheapest way
  // to find out whether HALF the road is the right amount to buy.
  { name: 'EVERY 2ND', take: 1, learned: false, wants: (s, c) => c.surges.indexOf(s) % 2 === 1 },
  { name: 'EARLY',    take: 1, learned: true,  wants: (s) => s.z0 < Kk.TOTAL_UNITS * 0.5 },
  { name: 'LATE',     take: 1, learned: true,  wants: (s) => s.z0 >= Kk.TOTAL_UNITS * 0.5 },
  { name: 'LONGEST',  take: 1, learned: true,
    wants: (s, c) => c.surges.slice().sort((a, b) => (b.z1 - b.z0) - (a.z1 - a.z0)).slice(0, 2).indexOf(s) >= 0 },
  { name: 'LAST TWO', take: 1, learned: true,
    wants: (s, c) => c.surges.indexOf(s) >= c.surges.length - 2 },
  // ---- THE POLICY THE DESIGN IS ACTUALLY CLAIMING IS BEST ----------------
  //
  // Every other selective policy above surges FEWER zones than BLIND, so of
  // course it is slower -- it is not a better allocation, it is a smaller one,
  // and a sweep made of those is a sweep that can only ever say "spend more".
  //
  // HOLD spends the SAME pool on LATER road: it declines the first zone and
  // takes every one after it. That is the whole design claim in one policy --
  // lowering the floor is worth 0.285x at streak 5 and 0.93x at streak 150, so
  // a segment burned in zone 1 buys about half what the same segment buys in
  // zone 4. If HOLD does not beat BLIND, the opposite time preference this
  // mechanic is built on does not exist and the tuning is wrong.
  { name: 'HOLD 1',   take: 1, learned: true, wants: (s, c) => c.surges.indexOf(s) >= 1 },
  { name: 'HOLD 2',   take: 1, learned: true, wants: (s, c) => c.surges.indexOf(s) >= 2 },
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
  // Which gates carry an aid item the policy wants, and in which lane.
  const wantAid = new Map();
  if (pol.take) {
    for (const it of (course.aid || [])) {
      if (it.gate == null) continue;       // roof items need a ramp, not a lane
      wantAid.set(it.gate, it);
    }
  }
  const surgeOn = new Set();
  for (const s of (course.surges || [])) if (pol.wants(s, course)) surgeOn.add(s);

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
  while (!p.finished && guard++ < 200000) {
    // The election, exactly as main.js makes it: in a zone, in its marked lane,
    // with fuel in the tank.
    const zone = course.surgeZoneAt ? course.surgeZoneAt(p.units) : null;
    p.surging = !!(zone && surgeOn.has(zone) && p.pool > 0);
    // ...and the mat under the lane being held. Never while surging, which is
    // Pace's own rule and is restated here only so the two cannot disagree
    // about a case the generator does not produce anyway.
    const mat = course.tempoAt ? course.tempoAt(p.units, lane) : null;
    p.tempo = mat && !p.surging ? mat.dir : 0;
    p.update(DT);
    while (gi < course.gates.length && p.units >= course.gates[gi].z) {
      const g = course.gates[gi];
      const z = course.surgeZoneAt ? course.surgeZoneAt(g.z) : null;
      const surging = !!(z && surgeOn.has(z) && p.pool > 0);
      const item = wantAid.get(gi);
      gi++;

      if (surging) {
        // Locked to the marked lane. Whatever is in it is what you answer.
        lane = z.lane;
      } else if (item) {
        // Gone to fetch a bottle: the lane it stands in, which the placement
        // rule guarantees holds a JUMP or a DUCK.
        lane = item.lane;
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
        let best = null, bestCost = Infinity;
        for (let l = 0; l < 3; l++) {
          if (g.lanes[l] === Kk.BLOCK) continue;
          const m = course.tempoAt ? course.tempoAt(g.z, l) : null;
          const run = m ? Math.min(m.z1, g.z + 60) - g.z : 0;
          let cost = g.lanes[l] === Kk.CLEAR ? 0 : skill * Kk.HIT_TIME_PENALTY * 8;
          if (m) cost += (m.dir > 0 ? -Pace.TEMPO.LIFT : Pace.TEMPO.DRAG)
            * run / Kk.UNITS_PER_MILE;
          if (cost < bestCost) { bestCost = cost; best = l; }
        }
        lane = best === null ? 0 : best;
      }
      const kind = g.lanes[lane];

      const demanded = kind !== Kk.CLEAR;
      if (demanded && rnd.next() >= skill) p.onHit();
      else {
        p.onClean();
        // The bottle is bought at the gate, cleanly or not -- but a run that
        // fell over is not in the lane any more, so only a cleared gate pays.
        if (item) p.onAid(item.gain);
      }
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
    ? `floor ${Pace.pace(ctx.MR.Pace.SURGE.FLOOR_BASE)}/mi, surge ${Pace.pace(ctx.MR.Pace.SURGE.FLOOR_SURGE)}/mi, ` +
      `pool ${ctx.MR.Pace.SURGE.POOL_MAX}, burn 1 per ${ctx.MR.Pace.SURGE.BURN_UNITS}u`
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
