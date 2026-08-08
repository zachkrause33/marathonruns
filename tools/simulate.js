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
const ctx = { MR: {}, Math, console, isFinite, String, Number, Float64Array };
vm.createContext(ctx);
for (const f of ['src/core/rng.js', 'src/core/constants.js', 'src/core/elevation.js',
                 'src/core/pace.js', 'src/core/course.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { Pace, Course, K } = ctx.MR;

const DT = 1 / 60;
// Averaging over several dates keeps the verdict from hanging on one lucky
// course's gate count.
const KEYS = ['2026-08-05', '2026-08-06', '2026-12-25', '2027-03-14'];

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
  if (label === 'perfect' && vs >= 0) { ok = false; console.log('  FAIL: perfect run does not beat the record'); }
  if (label === 'perfect' && (p.realTime < 210 || p.realTime > 270)) {
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

console.log('');
console.log(ok ? 'PASS  pace model satisfies its stated contract' : 'FAIL  see above');
process.exit(ok ? 0 : 1);
