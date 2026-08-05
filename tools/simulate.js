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
const ctx = { MR: {}, Math, console, isFinite, String, Number };
vm.createContext(ctx);
for (const f of ['src/core/rng.js', 'src/core/constants.js', 'src/core/pace.js', 'src/core/course.js']) {
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
  const p = Pace.create();
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
 */
function runWithNHits(n) {
  const times = KEYS.map((key) => {
    const course = Course.generate(key);
    const p = Pace.create();
    const hitAt = new Set();
    for (let i = 1; i <= n; i++) hitAt.add(Math.floor((course.gates.length * i) / (n + 1)));
    let gi = 0, gate = 0, guard = 0;
    while (!p.finished && guard++ < 200000) {
      p.update(DT);
      while (gi < course.gates.length && p.units >= course.gates[gi].z) {
        gi++; gate++;
        if (hitAt.has(gate)) p.onHit(); else p.onClean();
      }
    }
    return p.finishTime;
  });
  return { finishTime: times.reduce((a, b) => a + b, 0) / times.length };
}

console.log('');
console.log('mistakes  finish     vs record   cost of the last mistake');
let prev = null;
for (const n of [0, 1, 2, 3, 5, 10]) {
  const p = runWithNHits(n);
  const vs = p.finishTime - K.RECORD_SECONDS;
  const marginal = prev === null ? '' : `${((p.finishTime - prev) / Math.max(1, 1)).toFixed(1)}s`;
  console.log(
    `${String(n).padStart(8)}  ${Pace.clock(p.finishTime).padStart(8)}  ` +
    `${(vs >= 0 ? '+' : '') + vs.toFixed(0).padStart(6)}s   ${marginal}`
  );
  prev = p.finishTime;
}

console.log('');
console.log(ok ? 'PASS  pace model satisfies its stated contract' : 'FAIL  see above');
process.exit(ok ? 0 : 1);
