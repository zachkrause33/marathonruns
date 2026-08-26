#!/usr/bin/env node
/**
 * WHAT AID COSTS, WHAT IT PAYS, AND WHETHER THE ECONOMY HOLDS.
 *
 *   node tools/aid.js               365 days, every section
 *   node tools/aid.js --days 90     a shorter sweep
 *
 * ---- THE CONTRACT THIS FILE GUARDS CHANGED WITH THE ABUNDANCE PASS -------
 *
 * The owner: "Adjust the water and bananas. We need countless of them
 * similar to these other games that have coins. That keeps players engaged."
 * So the old headline -- "no item may be free" -- is RETIRED, deliberately:
 * trails and clusters are free to collect by design, and a version of this
 * file that failed the build on free items would be failing the build on the
 * owner's instruction. Roadmap 50's rule survives only where the price
 * survives: the ARC items, receipt-guarded behind an obstacle.
 *
 * What must now be true instead, and what this file asserts:
 *
 *   placement   every item class obeys its own geometry: arcs behind their
 *               obstacle at their own gate, loose items never inside a
 *               vehicle and never leading into a wall, roof items on decks
 *   economy     the guard a course can pay is BOUNDED. Countless pickups at
 *               the old per-item value would make contacts free -- the exact
 *               defect roadmap 66 existed to end -- so collectable segments
 *               per race must stay near the old economy, not inflate with
 *               the item count
 *   exploit     the receipt machinery still cannot be cheated: a bot that
 *               takes the free lane and cuts in behind the obstacle collects
 *               ZERO of the guarded items
 *   decision    collecting and declining are both live lines through the
 *               real state machine, at several ability levels
 *   reach       a broken run can still reach most of the aid, because
 *               rescue is what the pool is FOR
 *
 * Rule 3 note: the biases of the old instrument (everything erred toward
 * calling aid free) served a claim that no longer exists. The bias this
 * version must hold is the opposite one: every approximation in the ECONOMY
 * section errs toward counting MORE collectable guard, so if the band holds
 * here it holds in play.
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
const DAYS = parseInt(arg('days', 365), 10);

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
const PER_SEG = Pace.EFFORT_CFG.PER_SEG;

let fail = 0;
function bad(msg) { fail++; console.log('  ! ' + msg); }

function keys(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ctx.MR.rng.dateKey(new Date(Date.UTC(2026, 0, 1) + i * 86400000)));
  return out;
}
const KEYS = keys(DAYS);
// The four dates tools/simulate.js averages over, so every finish time here
// sits alongside the ones that already gate the build.
const PKEYS = ['2026-08-05', '2026-08-06', '2026-12-25', '2027-03-14'];

function pct(a, b) { return b ? (100 * a / b).toFixed(1).padStart(5) + '%' : '    -  '; }
const isAction = (k) => k === K.JUMP || k === K.DUCK;

function gateIndexBefore(gates, z) {
  let lo = 0, hi = gates.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gates[mid].z <= z) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// ---------------------------------------------------------------------------
// placement: what the generator laid down, class by class
// ---------------------------------------------------------------------------
console.log(`\n=== placement: the abundance, class by class, over ${DAYS} days ===\n`);
const place = { items: 0, arcs: 0, loose: 0, roof: 0, banana: 0, lifted: 0 };
(function placement() {
  const bads = {
    arcNotBehind: 0, arcNoFreeLane: 0, arcWrongGate: 0, arcHighDuck: 0,
    looseInVehicle: 0, looseIntoWall: 0, looseEarly: 0,
    roofOffDeck: 0, roofOnSlope: 0, roofWrongY: 0,
    pastTape: 0, unsorted: 0, badLane: 0,
  };
  const tape = K.TOTAL_UNITS - 55;    // FINISH_GRACE; the clear run to the tape
  for (const key of KEYS) {
    const c = Course.generate(key);
    let lastZ = -1;
    for (const it of c.aid) {
      place.items++;
      if (it.kind === 'banana') place.banana++;
      if (it.z < lastZ - 1e-9) bads.unsorted++;
      lastZ = it.z;
      if (it.lane < 0 || it.lane > 2) { bads.badLane++; continue; }
      if (it.z >= tape) bads.pastTape++;
      if (it.roof) {
        place.roof++;
        const r = c.rampAt ? c.rampAt(it.z, it.lane) : null;
        if (!r) { bads.roofOffDeck++; continue; }
        if (it.z < r.z0 + r.run) bads.roofOnSlope++;
        if (it.y !== Course.DECK_Y) bads.roofWrongY++;
        continue;
      }
      if (it.gate != null) {
        // An ARC: roadmap 50's machinery, held to roadmap 50's clauses.
        place.arcs++;
        if (it.y) place.lifted++;
        const g = c.gates[it.gate];
        if (!g || !isAction(g.lanes[it.lane])) bads.arcNotBehind++;
        else {
          if (!g.lanes.some((l) => l === K.CLEAR)) bads.arcNoFreeLane++;
          if (gateIndexBefore(c.gates, it.z) !== it.gate) bads.arcWrongGate++;
          // Elevated items only on the falling half of a JUMP arc; nothing
          // may hang where it could read as overhead furniture.
          if (it.y && (g.lanes[it.lane] !== K.JUMP || it.y > 1.35)) bads.arcHighDuck++;
        }
        continue;
      }
      // LOOSE: a trail or cluster item, collected by lane match. Free by
      // design; what it owes the player is that following it is never a trap.
      place.loose++;
      if (c.occupiedAt && c.occupiedAt(it.z, it.lane)) bads.looseInVehicle++;
      const gi = gateIndexBefore(c.gates, it.z);
      const nx = c.gates[gi + 1];
      if (nx && nx.lanes[it.lane] === K.BLOCK) bads.looseIntoWall++;
      if (it.z < 150) bads.looseEarly++;   // START_GRACE stays a clean runway
    }
  }
  const n = KEYS.length;
  console.log(`  items a course            ${(place.items / n).toFixed(1)}   (was ~16 before the abundance pass)`);
  console.log(`  ...loose (trail/cluster)  ${(place.loose / n).toFixed(1)}   collected by lane, free by design`);
  console.log(`  ...arc (receipt-guarded)  ${(place.arcs / n).toFixed(1)}   bought with the action at their gate`);
  console.log(`  ...roof runs              ${(place.roof / n).toFixed(1)}   collected standing on the ramp`);
  console.log(`  bananas                   ${pct(place.banana, place.items)}`);
  console.log(`  elevated (on the jump arc)${pct(place.lifted, place.arcs)} of arc items`);
  console.log(`  density                   ${(place.items / n / (K.TOTAL_UNITS / 100)).toFixed(1)} per 100 units of road`);
  if (bads.unsorted) bad(`${bads.unsorted} items out of z order`);
  if (bads.badLane) bad(`${bads.badLane} items in an impossible lane`);
  if (bads.pastTape) bad(`${bads.pastTape} items inside the run-in to the tape`);
  if (bads.arcNotBehind) bad(`${bads.arcNotBehind} arc items stand behind something that is not a JUMP or a DUCK`);
  if (bads.arcNoFreeLane) bad(`${bads.arcNoFreeLane} arc items sit at a gate with no free lane -- nothing is given up`);
  if (bads.arcWrongGate) bad(`${bads.arcWrongGate} arc items are bought at a gate they are not standing behind`);
  if (bads.arcHighDuck) bad(`${bads.arcHighDuck} elevated items hang somewhere that is not a JUMP arc under 1.35`);
  if (bads.looseInVehicle) bad(`${bads.looseInVehicle} loose items stand inside a vehicle`);
  if (bads.looseIntoWall) bad(`${bads.looseIntoWall} loose items lead into a lane the next gate walls off`);
  if (bads.looseEarly) bad(`${bads.looseEarly} loose items inside START_GRACE`);
  if (bads.roofOffDeck) bad(`${bads.roofOffDeck} roof items not over a rideable deck`);
  if (bads.roofOnSlope) bad(`${bads.roofOnSlope} roof items on the tailgate slope`);
  if (bads.roofWrongY) bad(`${bads.roofWrongY} roof items not carrying DECK_Y`);
  if (!Object.keys(bads).some((k) => bads[k])) {
    console.log('');
    console.log(`  every item obeys its class's placement rule  OK`);
  }
})();

// ---------------------------------------------------------------------------
// the bot: the real state machine, driven
// ---------------------------------------------------------------------------
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
 * The bot. main.js's line, with knobs:
 *
 *   seek  0 ignores aid entirely (the natural line; what it collects anyway
 *           is the INCIDENTAL rate, which is a design property now, not a
 *           defect); 1 pays an action for arcs and tie-breaks toward trails;
 *           2 is the EXPLOIT -- never pays at the gate, then cuts in behind
 *           the obstacle for the guarded string
 *   miss  deliberately fluff this fraction of demanded actions
 *   aidMiss  extra fluff on the actions taken only to reach an arc
 */
const BIASES = [
  { name: 'stay', order: (l) => [l, l - 1, l + 1] },
  { name: 'left', order: () => [0, 1, 2] },
  { name: 'right', order: () => [2, 1, 0] },
  { name: 'centre', order: () => [1, 0, 2] },
];

function race(course, opts) {
  const bias = opts.bias || BIASES[0];
  const seek = opts.seek || 0;
  const miss = opts.miss || 0;
  const aidMiss = opts.aidMiss || 0;
  const p = Pace.create(course.elevation);
  const pl = Player.create();
  const ctrl = stubControls();
  const out = { hits: 0, aid: 0, guarded: 0, loose: 0, got: new Set(), actions: 0 };
  const road = course.aid.filter((a) => !a.roof);
  const arcs = new Map();
  for (const a of road) {
    if (a.gate == null) continue;
    if (!arcs.has(a.gate)) arcs.set(a.gate, a.lane);
  }
  let gi = 0, ai = 0, planned = false, plannedLane = 1, gateLane = 1, acted = false, guard = 0;
  let gateN = 0, aidN = 0, fluff = false, want = -1;
  const DT = 1 / 60;

  while (!p.finished && guard++ < 200000) {
    while (gi < course.gates.length && course.gates[gi].z < p.units - 1) {
      gi++; planned = false; acted = false;
    }
    while (ai < road.length && road[ai].z < p.units - 1) ai++;
    const g = course.gates[gi];
    if (g) {
      const dist = g.z - p.units;
      const speed = p.speed();
      if (!planned && dist < 46) {
        planned = true; acted = false;
        want = seek === 1 && arcs.has(gi) ? arcs.get(gi) : -1;
        // Trails between this gate and the next, as a tie-break.
        const trailN = [0, 0, 0];
        if (seek === 1) {
          for (let j = ai; j < road.length && road[j].z < g.z + 50; j++) {
            if (road[j].gate == null && road[j].z > g.z) trailN[road[j].lane]++;
          }
        }
        const order = bias.order(pl.lane).concat([0, 1, 2])
          .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
        let best = null, bestScore = -Infinity;
        order.forEach(function (l, i) {
          if (g.lanes[l] === K.BLOCK) return;
          let score = (g.lanes[l] === K.CLEAR ? 100 : 0) - i;
          if (l === want) score += 400;
          score += Math.min(trailN[l], 5) * 8;
          if (score > bestScore) { bestScore = score; best = l; }
        });
        gateLane = best === null ? pl.lane : best;
        plannedLane = gateLane;
        fluff = false;
        if (isAction(g.lanes[plannedLane])) {
          gateN++;
          fluff = miss > 0 && Math.floor(gateN * miss) !== Math.floor((gateN - 1) * miss);
          if (!fluff && aidMiss > 0 && plannedLane === want) {
            aidN++;
            fluff = Math.floor(aidN * aidMiss) !== Math.floor((aidN - 1) * aidMiss);
          }
        }
      }
      // The exploit: pick the gate lane blind to aid, then dive for the
      // guarded string the moment the gate is behind. If the receipts hold,
      // this collects zero of them however hard it steers.
      if (seek === 2) {
        let target = -1;
        for (let j = ai; j < road.length && road[j].z < g.z; j++) {
          if (road[j].gate != null && road[j].z > p.units) { target = road[j].lane; break; }
        }
        if (target >= 0 && g.lanes[target] !== K.BLOCK) plannedLane = target;
        else if (planned) plannedLane = gateLane;
      } else if (planned) {
        plannedLane = gateLane;
      }
      const stepDir = pl.lane < plannedLane ? 1 : -1;
      const nextLane = pl.lane + stepDir;
      if (planned && pl.lane !== plannedLane && (dist < 34 || plannedLane !== gateLane)
          && pl.laneT >= 0.55
          && !occupied(course, nextLane, p.units, p.units + 1.0)) {
        ctrl.push(pl.lane < plannedLane ? 'right' : 'left');
      }
      if (planned && !acted && pl.lane === plannedLane) {
        const kind = g.lanes[plannedLane];
        if (isAction(kind) && !fluff) {
          if (kind === K.JUMP && dist < speed * 0.30) { ctrl.push('jump'); acted = true; out.actions++; }
          else if (kind === K.DUCK && dist < speed * 0.16) { ctrl.push('duck'); acted = true; out.actions++; }
        }
      }
    }

    pl.handle(ctrl);
    const before = p.units;
    p.update(DT);
    const after = p.units;
    pl.update(DT, after - before);

    const deck = pl.resolveDeck(course, before, after);
    if (deck && deck.hit) { p.onHit(); out.hits++; }
    for (const r of pl.resolveGates(course, before, after)) {
      if (r.clean) p.onClean(); else { p.onHit(); out.hits++; }
    }
    for (const it of pl.resolveAid(course, before, after)) {
      p.onAid(it.gain); out.aid++;
      if (it.gate != null) out.guarded++; else out.loose++;
      out.got.add(it.z.toFixed(3) + ':' + it.lane);
    }
    pl.drainEvents();
  }
  out.time = p.finishTime;
  out.segments = p.aid / PER_SEG;
  out.total = road.length;
  out.totalGuarded = road.filter((a) => a.gate != null).length;
  return out;
}

// ---------------------------------------------------------------------------
// economy: the guard a race can actually buy
// ---------------------------------------------------------------------------
console.log(`\n=== economy: collectable guard per race (PER_SEG = ${PER_SEG}) ===\n`);
/**
 * THE BAND, AND WHY IT IS WHAT IT IS. The scarce economy carried ~16 whole
 * segments on the course and ~13.7 collectable on one line. The abundance
 * pass must land near that or the guard inflates: the ceiling row below errs
 * HIGH (a flawless line steering for everything), and even it must stay
 * under 20 segments; the seeking line at realistic ability is the economy a
 * player actually lives in and must sit in single figures to the mid-teens.
 */
(function economy() {
  const onCourse = PKEYS.map((k) => Course.generate(k).aid.length / PER_SEG);
  const ceil = PKEYS.map((k) => race(Course.generate(k), { seek: 1 }));
  const nat = PKEYS.map((k) => race(Course.generate(k), { seek: 0 }));
  const mean = (xs, f) => xs.reduce((a, x) => a + (f ? f(x) : x), 0) / xs.length;
  const onC = mean(onCourse);
  const ceilSeg = mean(ceil, (r) => r.segments);
  const natSeg = mean(nat, (r) => r.segments);
  console.log(`  on the course (every item / PER_SEG)   ${onC.toFixed(1)} segments`);
  console.log(`  a flawless seeking line collects       ${ceilSeg.toFixed(1)} segments  (${mean(ceil, (r) => r.aid).toFixed(0)} pickups)`);
  console.log(`  a natural line collects incidentally   ${natSeg.toFixed(1)} segments  (${mean(nat, (r) => r.aid).toFixed(0)} pickups)`);
  console.log(`  guarded share of the seeking line      ${pct(mean(ceil, (r) => r.guarded), mean(ceil, (r) => r.aid))}`);
  if (ceilSeg > 20) bad(`a flawless seeking line collects ${ceilSeg.toFixed(1)} segments -- the guard economy has inflated past the old ~16`);
  if (ceilSeg < 8) bad(`a flawless seeking line collects only ${ceilSeg.toFixed(1)} segments -- the pool has starved and rescue is dead`);
  if (natSeg < 2) bad(`a natural line collects only ${natSeg.toFixed(1)} segments -- the flow places nothing where anyone runs`);
  if (!fail) console.log('\n  the guard economy is inside its band  OK');
})();

// ---------------------------------------------------------------------------
// exploit: the receipts still cannot be cheated
// ---------------------------------------------------------------------------
console.log(`\n=== exploit: take the free lane, then cut in behind the obstacle ===\n`);
(function exploit() {
  const ex = PKEYS.map((k) => race(Course.generate(k), { seek: 2 }));
  const mean = (f) => ex.reduce((a, r) => a + f(r), 0) / ex.length;
  console.log(`  guarded items collected by the cut-in bot   ${mean((r) => r.guarded).toFixed(1)} of ${mean((r) => r.totalGuarded).toFixed(1)}`);
  console.log(`  (loose items it walks through are legal -- they are the free class)`);
  if (mean((r) => r.guarded) > 0) {
    bad('the cut-in bot collected receipt-guarded items -- the roadmap 50 machinery has been cheated');
  }
})();

// ---------------------------------------------------------------------------
// decision: the same course, ignored and collected
// ---------------------------------------------------------------------------
console.log(`\n=== decision: ignore the aid, or go and get it ===\n`);
console.log('  fluffed   bot                 pickups   segments   contacts   finish');
for (const miss of [0, 0.06, 0.14, 0.30]) {
  for (const [label, seek] of [['ignores aid', 0], ['goes and gets it', 1]]) {
    const rs = PKEYS.map((k) => race(Course.generate(k), { seek, miss }));
    const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(`  ${(miss * 100).toFixed(0).padStart(6)}%   ${label.padEnd(18)} ` +
      `${mean((r) => r.aid).toFixed(0).padStart(7)}   ${mean((r) => r.segments).toFixed(1).padStart(8)}   ` +
      `${mean((r) => r.hits).toFixed(1).padStart(8)}   ${Pace.clock(mean((r) => r.time))}`);
  }
}
console.log('');
console.log('  The collector should win at high fluff (guard is the rescue) and buy');
console.log('  little at zero (a flawless line has nothing to insure). Reported, not');
console.log('  asserted: the record-level trade lives in tools/simulate.js now.');

// ---------------------------------------------------------------------------
// reach: a broken run can still fill the pool
// ---------------------------------------------------------------------------
console.log(`\n=== reach: aid is the road back for a broken run ===\n`);
(function reach() {
  const rs = PKEYS.map((k) => race(Course.generate(k), { seek: 1, miss: 0.30 }));
  const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const share = mean((r) => r.aid) / mean((r) => r.total);
  console.log(`  a 30%-fluff seeking run still collects ${pct(mean((r) => r.aid), mean((r) => r.total))} of the road items`);
  console.log(`  (${mean((r) => r.segments).toFixed(1)} segments -- the rescue is reachable by the player who needs it)`);
  if (share < 0.35) bad('a broken run cannot reach the aid -- rescue is gated behind being good');
})();

console.log('');
console.log(fail === 0 ? 'PASS  aid measured' : `FAIL  ${fail} assertion(s) broken`);
process.exit(fail === 0 ? 0 : 1);
