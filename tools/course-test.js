#!/usr/bin/env node
/**
 * Course generator verification. Checks the two properties that would ruin
 * the game silently if they broke: identical output for a given date, and a
 * provably runnable line from gun to tape.
 *
 *   node tools/course-test.js [days]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { MR: {}, Math, console, isFinite, String, Number, Set, Array, JSON };
vm.createContext(ctx);
for (const f of ['src/core/rng.js', 'src/core/constants.js', 'src/core/pace.js', 'src/core/course.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const { Course, K } = ctx.MR;

const DAYS = parseInt(process.argv[2] || '90', 10);
let fail = 0;
const stats = { gates: [], blocks: 0, jumps: 0, ducks: 0, trains: 0 };

for (let i = 0; i < DAYS; i++) {
  const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
  const key = ctx.MR.rng.dateKey(d);
  const a = Course.generate(key);

  if (!a.valid.ok) {
    fail++;
    console.log(`FAIL ${key}: ${a.valid.errors.slice(0, 3).join('; ')}`);
    continue;
  }

  // Determinism: regenerate and compare structurally.
  const b = Course.generate(key);
  if (JSON.stringify(a.gates) !== JSON.stringify(b.gates)) {
    fail++;
    console.log(`FAIL ${key}: not deterministic`);
    continue;
  }

  stats.gates.push(a.gates.length);
  for (const g of a.gates) {
    for (const l of g.lanes) {
      if (l === K.BLOCK) stats.blocks++;
      else if (l === K.JUMP) stats.jumps++;
      else if (l === K.DUCK) stats.ducks++;
    }
    if (g.train) stats.trains++;
  }
}

// Different dates must produce different courses.
const k1 = Course.generate('2026-03-01').gates;
const k2 = Course.generate('2026-03-02').gates;
if (JSON.stringify(k1) === JSON.stringify(k2)) { fail++; console.log('FAIL: consecutive dates identical'); }

const avg = stats.gates.reduce((a, b) => a + b, 0) / stats.gates.length;
const min = Math.min(...stats.gates), max = Math.max(...stats.gates);
console.log(`days tested   ${DAYS}`);
console.log(`gates         avg ${avg.toFixed(1)}  min ${min}  max ${max}`);
console.log(`hazards       jump ${stats.jumps}  duck ${stats.ducks}  block ${stats.blocks}  trains ${stats.trains}`);
console.log(`course length ${K.TOTAL_UNITS.toFixed(0)} units / ${K.MARATHON_MILES.toFixed(3)} mi`);
console.log('');
console.log(fail === 0 ? `PASS  ${DAYS} courses deterministic and solvable` : `FAIL  ${fail} bad courses`);
process.exit(fail === 0 ? 0 : 1);
