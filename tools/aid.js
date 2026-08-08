#!/usr/bin/env node
/**
 * WHAT AID COSTS, AND WHETHER IT IS A DECISION.
 *
 *   node tools/aid.js               365 days, every section
 *   node tools/aid.js --days 90     a shorter sweep
 *
 * The owner's instruction: "Ensure waters and bananas are strategically placed
 * so that they have to go around an obstacle to get it." That is a claim about
 * COST, and a claim about cost needs a number before and after. This file is
 * that number.
 *
 * Sections:
 *
 *   placement   what the generator actually laid down: how far each item sits
 *               from the gate behind it, what stands in its lane at that gate,
 *               and whether the gate also offered a lane through for nothing
 *   free        the headline. Two independent instruments, both deliberately
 *               biased TOWARDS calling aid free -- see the audit below
 *   decision    the same course raced by a bot that ignores aid and one that
 *               goes and gets it, through the real Player, Collision and Pace.
 *               Both have to be viable or it is not a decision
 *   exploit     the bot that tries to cheat the rule: take the free lane at the
 *               gate, then swerve in behind it and grab the bottle anyway
 *   reach       what share of the aid a BROKEN run can still collect, because
 *               aid exists to rescue one
 *
 * ---- HOW THIS INSTRUMENT WOULD FLATTER THE WORK IF NOBODY WATCHED IT -----
 *
 * Rule 3. Every measurement tool this project has written was wrong first and
 * the error always flattered the thing measured. The claim this file exists to
 * support is "aid is no longer free", so EVERY approximation in it is chosen to
 * push the measured freeness UP. If a number here says aid is expensive, the
 * bias was fighting it.
 *
 *  1. ONE BOT IS ONE POLICY. A single natural-line bot has a lane preference,
 *     and measuring against it would report the free rate of that preference
 *     rather than of the course. So four bots run with four different tie-break
 *     biases and an item counts as free if ANY of them walks through it.
 *
 *  2. THE OPTIMAL LINE IS NOT UNIQUE. Asking "does THE cheapest line collect
 *     it" would undercount, because ties are everywhere. The DP asks "does SOME
 *     cheapest line collect it", which is the generous reading.
 *
 *  3. IGNORING THE ACTION-CONFLICT RULE MAKES THE LAZY LINE CHEAPER. The DP
 *     does not model solvable()'s jump-and-duck-in-one-window rejection, so it
 *     admits lines a real player could not run. That makes MORE lines optimal
 *     and therefore MORE items free. Left in on purpose.
 *
 *  4. A GAP IS NOT A GATE. An item sitting in open road between two gates can
 *     be taken by dipping into its lane and coming straight back out, paying
 *     two lane changes and no action at all. The DP offers that route -- but
 *     only when there is ROOM for it, and the room is read from the player's
 *     own re-arm delay (0.55 * LANE_CHANGE_TIME) rather than guessed. An item
 *     jammed up against the gate behind it does not get the route, and that is
 *     the whole mechanism the new placement rule leans on, so it is measured
 *     rather than assumed: the `exploit` section drives the real state machine
 *     into the same hole and reports what it gets.
 *
 *  5. COUNTING ITEMS INSTEAD OF COUNTING GAIN. A banana is worth 22 and a
 *     bottle 10, so a rule that made all the bananas free and all the bottles
 *     expensive would look good by item count. Every free rate here is reported
 *     by ITEM and by GAIN.
 *
 *  6. A 90-DAY SWEEP CLEARS NOTHING. The ramp's run-in defect was invisible at
 *     90 days and only appeared on the full calendar. The default is 365.
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

// The REAL modules, including collision.js and player.js, so every race below
// drives the shipped state machine rather than a description of it. Same
// one-field Runner stub tools/mechanics.js uses, and it is checked there.
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

const MAX_SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
/**
 * The ground a runner covers in the shortest interval in which they can be
 * shown to have moved laterally twice.
 *
 * player.handle refuses a second lane change until laneT >= 0.55, and laneT
 * fills at dt / LANE_CHANGE_TIME -- so 0.55 * LANE_CHANGE_TIME is the re-arm,
 * and at the fastest the runner ever goes that is this many units. It is read
 * from the shipped constants rather than typed, so a retune of the lane change
 * moves it. Below this, "dip into the lane and come back" is not a route.
 */
const SWERVE_ROOM = 0.55 * K.LANE_CHANGE_TIME * MAX_SPEED;

function pct(a, b) { return b ? (100 * a / b).toFixed(1).padStart(5) + '%' : '    -  '; }

// ---------------------------------------------------------------------------
// placement: what the generator laid down
// ---------------------------------------------------------------------------
function gateIndexBefore(gates, z) {
  let lo = 0, hi = gates.length - 1, found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gates[mid].z <= z) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

const isAction = (k) => k === K.JUMP || k === K.DUCK;

console.log(`\n=== placement: where the aid actually is, over ${DAYS} days ===\n`);
const place = {
  items: 0, roof: 0, road: 0, gain: 0,
  guardedLane: 0,        // the gate behind it stands a JUMP or DUCK in its lane
  freeLaneToo: 0,        // ...and that same gate leaves some other lane CLEAR
  clearLane: 0,          // the gate behind it leaves ITS lane clear
  fullWidth: 0,          // every lane at that gate demands an action
  exitFree: 0,           // the gate ahead leaves its lane CLEAR
  offCentre: 0,
  setbacks: [],
};
for (const key of KEYS) {
  const c = Course.generate(key);
  for (const it of c.aid) {
    place.items++;
    place.gain += it.gain;
    if (it.roof) { place.roof++; continue; }
    place.road++;
    const gi = gateIndexBefore(c.gates, it.z);
    const g = c.gates[gi];
    const nx = c.gates[gi + 1];
    const here = g.lanes[it.lane];
    place.setbacks.push(it.z - g.z);
    if (isAction(here)) place.guardedLane++;
    if (isAction(here) && g.lanes.some((l) => l === K.CLEAR)) place.freeLaneToo++;
    if (here === K.CLEAR) place.clearLane++;
    if (g.lanes.every((l) => isAction(l))) place.fullWidth++;
    if (!nx || nx.lanes[it.lane] === K.CLEAR) place.exitFree++;
    if (it.lane !== 1) place.offCentre++;
  }
}
place.setbacks.sort((a, b) => a - b);
const med = place.setbacks[place.setbacks.length >> 1];
console.log(`  items                     ${place.items}  (${place.road} on the road, ${place.roof} on a roof)`);
console.log(`  setback from its gate     median ${med.toFixed(1)}u   min ${place.setbacks[0].toFixed(1)}u   max ${place.setbacks[place.setbacks.length - 1].toFixed(1)}u`);
console.log(`  its lane at that gate     JUMP or DUCK ${pct(place.guardedLane, place.road)}   CLEAR ${pct(place.clearLane, place.road)}`);
console.log(`  ...and a free lane there  ${pct(place.freeLaneToo, place.road)}   (the shape the rule wants)`);
console.log(`  gate demands all three    ${pct(place.fullWidth, place.road)}   (nothing to give up, so nothing is paid)`);
console.log(`  lane clear on the way out ${pct(place.exitFree, place.road)}`);
console.log(`  off the centre lane       ${pct(place.offCentre, place.road)}`);

/**
 * ---- THE RULE, ASSERTED RATHER THAN REPORTED ---------------------------
 *
 * A section that prints 100% is a report. These are what make it a gate: every
 * clause of the placement rule, checked on every road item on every day, so
 * the rule cannot be quietly weakened by an edit somewhere else.
 */
(function assertRule() {
  const bads = { noGate: 0, notBehind: 0, noFreeLane: 0, wrongGate: 0, offObstacle: 0, pastTape: 0 };
  const tape = K.TOTAL_UNITS - 55;    // FINISH_GRACE; the clear run into the tape
  for (const key of KEYS) {
    const c = Course.generate(key);
    for (const it of c.aid) {
      if (it.roof) continue;
      if (it.gate == null) { bads.noGate++; continue; }
      const g = c.gates[it.gate];
      if (!g) { bads.noGate++; continue; }
      if (!isAction(g.lanes[it.lane])) bads.notBehind++;
      if (!g.lanes.some((l) => l === K.CLEAR)) bads.noFreeLane++;
      // The gate the item is bought at must be the gate it is STANDING behind,
      // or the picture and the rule have come apart.
      if (gateIndexBefore(c.gates, it.z) !== it.gate) bads.wrongGate++;
      const rear = 2 * Course.HAZARD_HALF_Z[g.lanes[it.lane]];
      const d = it.z - g.z;
      if (d < rear - 1e-9 || d > rear + 0.36) bads.offObstacle++;
      if (it.z >= tape) bads.pastTape++;
    }
  }
  if (bads.noGate) bad(`${bads.noGate} road items carry no gate -- nothing is guarding them`);
  if (bads.notBehind) bad(`${bads.notBehind} items stand behind something that is not a JUMP or a DUCK`);
  if (bads.noFreeLane) bad(`${bads.noFreeLane} items sit at a gate with no free lane -- nothing is given up`);
  if (bads.wrongGate) bad(`${bads.wrongGate} items are bought at a gate they are not standing behind`);
  if (bads.offObstacle) bad(`${bads.offObstacle} items are not tucked in behind their own obstacle`);
  if (bads.pastTape) bad(`${bads.pastTape} items are laid inside the run-in to the tape`);
  if (!Object.keys(bads).some((k) => bads[k])) {
    console.log('');
    console.log(`  every one of ${place.road} road items obeys the placement rule  OK`);
  }
})();

// ---------------------------------------------------------------------------
// free, instrument A: the cheapest line that still collects it
// ---------------------------------------------------------------------------
/**
 * Cost is a LEXICOGRAPHIC PAIR (actions, laneChanges), never a weighted sum.
 *
 * A weighted sum needs a number saying what a jump is worth in lane changes,
 * and there is no honest source for that number -- so the choice of weight
 * would decide the answer. Ordering them instead needs no weight: an action is
 * a thing you can fail and lose the run to, a lane change is not, so actions
 * are compared first and lane changes break the tie.
 */
const INF = [1e9, 1e9];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmp = (a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
const lexmin = (a, b) => (cmp(a, b) <= 0 ? a : b);

/**
 * The cheapest way through the whole course, and the cheapest way through the
 * whole course that passes through each (gate, lane).
 *
 * Deliberately does NOT model solvable()'s action-conflict rule -- see audit
 * note 3. That admits lines a real player could not run, which makes more
 * lines optimal and more aid free, which is the direction this file is
 * required to err in.
 */
function laneCosts(gates) {
  const n = gates.length;
  const cost = (i, l) => (gates[i].lanes[l] === K.BLOCK ? null : [isAction(gates[i].lanes[l]) ? 1 : 0, 0]);
  const fwd = [], bwd = [];
  for (let i = 0; i < n; i++) { fwd.push([INF, INF, INF]); bwd.push([INF, INF, INF]); }
  for (let l = 0; l < 3; l++) {
    const c = cost(0, l);
    // The runner starts in the centre lane, so getting to lane l at gate 0
    // costs the lane changes it takes to be there.
    if (c) fwd[0][l] = add(c, [0, Math.abs(l - 1)]);
  }
  for (let i = 1; i < n; i++) {
    for (let l = 0; l < 3; l++) {
      const c = cost(i, l);
      if (!c) continue;
      let best = INF;
      for (let p = 0; p < 3; p++) {
        if (fwd[i - 1][p][0] >= 1e9) continue;
        best = lexmin(best, add(fwd[i - 1][p], [0, Math.abs(l - p)]));
      }
      if (best[0] < 1e9) fwd[i][l] = add(best, c);
    }
  }
  for (let l = 0; l < 3; l++) { const c = cost(n - 1, l); if (c) bwd[n - 1][l] = c; }
  for (let i = n - 2; i >= 0; i--) {
    for (let l = 0; l < 3; l++) {
      const c = cost(i, l);
      if (!c) continue;
      let best = INF;
      for (let p = 0; p < 3; p++) {
        if (bwd[i + 1][p][0] >= 1e9) continue;
        best = lexmin(best, add(bwd[i + 1][p], [0, Math.abs(l - p)]));
      }
      if (best[0] < 1e9) bwd[i][l] = add(best, c);
    }
  }
  let base = INF;
  for (let l = 0; l < 3; l++) base = lexmin(base, fwd[n - 1][l]);
  const through = function (i, l) {
    if (fwd[i][l][0] >= 1e9 || bwd[i][l][0] >= 1e9) return INF;
    return sub(add(fwd[i][l], bwd[i][l]), cost(i, l) || [0, 0]);
  };
  return { base, through };
}

/**
 * What collecting `it` adds to the cheapest line through the whole course.
 *
 * ---- A GUARDED ITEM HAS EXACTLY ONE ROUTE, AND IT IS EXACT --------------
 *
 * player.resolveAid pays a guarded item out to whoever was in its lane when
 * its gate resolved, and to nobody else. So there is no modelling to do and no
 * approximation to bias: the cost of collecting it is the cost of the cheapest
 * whole-course line that passes through that (gate, lane), full stop.
 *
 * ---- AND AN UNGUARDED ONE HAS THREE, TWO OF WHICH I HAD WRONG -----------
 *
 * The old placement put items in open road, where a lane match at a point is
 * the whole test, and there the routes are:
 *
 *   A  be in the lane at the gate BEHIND and stay -- always available
 *   B  enter the lane after that gate and hold it to the gate AHEAD
 *   C  dip into the lane and come straight back out, two lane changes, no
 *      action at all
 *
 * The first version of this offered B unconditionally, which is simply false:
 * being in the lane at the gate AHEAD says nothing about being in it 27 units
 * earlier where the bottle is. Both B and C need room to get INTO the lane
 * after the gate behind, and that room is read from the player's own re-arm
 * delay rather than guessed. Left unguarded, B was reporting items as free
 * that no line could actually collect -- flattering the OLD placement, which
 * is the one direction that would have made this pass look unnecessary.
 */
function detour(c, it, lc) {
  const gates = c.gates;
  let best;
  if (it.gate != null) {
    best = lc.through(it.gate, it.lane);
  } else {
    const gi = gateIndexBefore(gates, it.z);
    const routes = [lc.through(gi, it.lane)];
    const roomBehind = it.z - gates[gi].z;
    const roomAhead = gi + 1 < gates.length ? gates[gi + 1].z - it.z : 1e9;
    if (roomBehind >= SWERVE_ROOM) {
      if (gi + 1 < gates.length) routes.push(lc.through(gi + 1, it.lane));
      if (roomAhead >= SWERVE_ROOM) routes.push(add(lc.base, [0, 2]));
    }
    best = INF;
    for (const r of routes) best = lexmin(best, r);
  }
  return best[0] >= 1e9 ? null : sub(best, lc.base);
}

console.log(`\n=== free: what the cheapest line already collects ===\n`);
const A = { n: 0, gain: 0, free: 0, freeGain: 0, laneOnly: 0, laneGain: 0, act: 0, actGain: 0, unreachable: 0 };
for (const key of KEYS) {
  const c = Course.generate(key);
  const lc = laneCosts(c.gates);
  for (const it of c.aid) {
    if (it.roof) continue;          // the roof is its own trade, measured in mechanics.js
    const d = detour(c, it, lc);
    A.n++; A.gain += it.gain;
    if (!d) { A.unreachable++; continue; }
    if (d[0] > 0) { A.act++; A.actGain += it.gain; }
    else if (d[1] > 0) { A.laneOnly++; A.laneGain += it.gain; }
    else { A.free++; A.freeGain += it.gain; }
  }
}
console.log('  what it costs to collect, over and above the cheapest line through the course');
console.log('');
console.log(`  nothing at all            ${pct(A.free, A.n)} of items   ${pct(A.freeGain, A.gain)} of the gain    <-- FREE`);
console.log(`  a lane change, no action  ${pct(A.laneOnly, A.n)} of items   ${pct(A.laneGain, A.gain)} of the gain`);
console.log(`  at least one more action  ${pct(A.act, A.n)} of items   ${pct(A.actGain, A.gain)} of the gain    <-- PAID FOR`);
if (A.unreachable) bad(`${A.unreachable} items sit in a lane no clean line can enter -- that is a trap, not a trade`);
// Rule 4: an item nothing has to be paid for is not the design, and an item
// that costs more than one extra action is the chain the last pass proved
// unreachable. Both are failures, and the DP is exact for a guarded item.
if (A.free) bad(`${A.free} items cost the cheapest line nothing at all -- that is scenery, not a trade`);
if (A.laneOnly) bad(`${A.laneOnly} items are had for a lane change and no action`);

// ---------------------------------------------------------------------------
// the bots
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
 * The bot. It is tools/mechanics.js's, which is main.js's, with three knobs:
 *
 *   bias    tie-break order among equally good lanes. FOUR of these are run and
 *           an item counts as free if any of them collected it, so the free
 *           rate is a property of the course rather than of one preference.
 *   seek    0 ignores aid entirely -- this is the NATURAL LINE and the baseline
 *           1 will pay an action to be in the aid lane at the gate
 *           2 will not: it takes the cheapest lane at the gate and then tries
 *             to swerve in behind it. This is the exploit, run on purpose.
 *   miss    deliberately fluff this fraction of actions, to model a broken run
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
  // The extra chance of fluffing the action the bot took ONLY to reach a
  // bottle. See the crossover section: a jump you chose is not the same bet as
  // a jump you were talked into.
  const aidMiss = opts.aidMiss || 0;
  const p = Pace.create(course.elevation);
  const pl = Player.create();
  const ctrl = stubControls();
  const out = { hits: 0, aid: 0, gain: 0, got: new Set(), laneMoves: 0, actions: 0 };
  const aid = course.aid.filter((a) => !a.roof);
  let gi = 0, ai = 0, planned = false, plannedLane = 1, gateLane = 1, acted = false, guard = 0;
  // ---- THE MISS KNOB, AND IT DID NOTHING THE FIRST TIME ------------------
  //
  // This counter used to live in the per-frame action branch, which runs every
  // frame from the moment the gate is planned until the action fires. So it
  // ticked twenty times for one gate, the fluff test flipped on and off inside
  // that gate, and the frame where it happened to be off fired the jump
  // anyway. Every miss rate reported 0.0 contacts, which read as "the aid is
  // free even for a broken run" -- flattering, and wrong. It is now counted
  // ONCE PER GATE, at plan time, and the plan carries the decision.
  let gateN = 0, aidN = 0, fluff = false, want = -1;
  const DT = 1 / 60;

  while (!p.finished && guard++ < 200000) {
    while (gi < course.gates.length && course.gates[gi].z < p.units - 1) {
      gi++; planned = false; acted = false;
    }
    while (ai < aid.length && aid[ai].z < p.units - 1) ai++;
    const g = course.gates[gi];
    if (g) {
      const dist = g.z - p.units;
      const speed = p.speed();
      if (!planned && dist < 46) {
        planned = true; acted = false;
        // The item this gate is the gate BEFORE, if there is one.
        want = seek === 1 && ai < aid.length && aid[ai].z < (course.gates[gi + 1] ? course.gates[gi + 1].z : 1e9)
          ? aid[ai].lane : -1;
        const order = bias.order(pl.lane).concat([0, 1, 2])
          .filter((l, i, a) => l >= 0 && l <= 2 && a.indexOf(l) === i);
        let best = null, bestScore = -Infinity;
        order.forEach(function (l, i) {
          if (g.lanes[l] === K.BLOCK) return;
          let score = (g.lanes[l] === K.CLEAR ? 100 : 0) - i;
          if (l === want) score += 400;       // a seeking bot will jump for it
          if (score > bestScore) { bestScore = score; best = l; }
        });
        gateLane = best === null ? pl.lane : best;
        plannedLane = gateLane;
        // The miss rate is a fraction of the ACTIONS the bot is asked for, not
        // of the gates it passes -- most gates are answered by standing in a
        // clear lane and there is nothing there to fluff. Counted once, here,
        // now the lane is settled. Deterministic rather than random so every
        // number in this file reproduces, and evenly spread rather than bunched.
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
      /**
       * ---- THE EXPLOIT ----------------------------------------------------
       *
       * The new placement rule leans on ONE thing: an item sitting a couple of
       * units behind a hazard cannot be reached by taking the free lane at the
       * gate and cutting in afterwards, because there is no road left to cut in
       * over. That is a claim about the shipped state machine, so it is DRIVEN
       * rather than argued.
       *
       * This bot chooses its lane at the gate WITHOUT looking at the aid -- it
       * never pays the action -- and then, the moment the gate is behind it,
       * overrides the plan and steers for the bottle, hopping as fast as
       * player.handle will serve a lane change. Once the bottle is behind it
       * the plan snaps back to the gate's own lane and it scrambles.
       *
       * It is deliberately reckless, and the contacts it takes are the honest
       * price of the attempt rather than a defect. If it collects everything
       * cheaply, the placement rule is decoration.
       */
      if (seek === 2 && ai < aid.length && aid[ai].z > p.units && aid[ai].z < g.z
          && g.lanes[aid[ai].lane] !== K.BLOCK) {
        plannedLane = aid[ai].lane;
      } else if (planned) {
        plannedLane = gateLane;
      }
      const stepDir = pl.lane < plannedLane ? 1 : -1;
      const nextLane = pl.lane + stepDir;
      // The cut-in steers whenever the bottle is ahead, not only inside the
      // gate's own 34-unit approach -- otherwise the exploit would be measured
      // with one hand behind its back on exactly the tight placements it is
      // supposed to be attacking.
      if (planned && pl.lane !== plannedLane && (dist < 34 || plannedLane !== gateLane)
          && pl.laneT >= 0.55
          && !occupied(course, nextLane, p.units, p.units + 1.0)) {
        ctrl.push(pl.lane < plannedLane ? 'right' : 'left');
        out.laneMoves++;
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
      p.onAid(it.gain); out.aid++; out.gain += it.gain; out.got.add(it.z.toFixed(3) + ':' + it.lane);
    }
    pl.drainEvents();
  }
  out.time = p.finishTime;
  out.streak = p.bestStreak;
  out.total = aid.length;
  out.totalGain = aid.reduce((a, b) => a + b.gain, 0);
  return out;
}

// ---------------------------------------------------------------------------
// free, instrument B: what a bot that is not looking for aid walks through
// ---------------------------------------------------------------------------
console.log(`\n=== free: what a bot that is not looking for aid walks through ===\n`);
console.log('  four natural-line bots, four tie-break biases, aid invisible to all of them');
console.log('');
const B = { n: 0, gain: 0, any: 0, anyGain: 0, per: BIASES.map(() => 0) };
for (const key of KEYS) {
  const c = Course.generate(key);
  const road = c.aid.filter((a) => !a.roof);
  const hit = new Set();
  BIASES.forEach(function (bias, i) {
    const r = race(c, { bias, seek: 0 });
    B.per[i] += r.aid;
    for (const k of r.got) hit.add(k);
  });
  B.n += road.length;
  B.gain += road.reduce((a, b) => a + b.gain, 0);
  for (const it of road) {
    if (hit.has(it.z.toFixed(3) + ':' + it.lane)) { B.any++; B.anyGain += it.gain; }
  }
}
BIASES.forEach(function (bias, i) {
  console.log(`  bias ${bias.name.padEnd(7)} collected  ${pct(B.per[i], B.n)} of the aid without trying`);
});
console.log('');
console.log(`  collected by ANY of them  ${pct(B.any, B.n)} of items   ${pct(B.anyGain, B.gain)} of the gain    <-- FREE`);
if (B.any) bad(`${B.any} items were collected by a bot that was not even looking for them`);

// ---------------------------------------------------------------------------
// decision: two live options, or one
// ---------------------------------------------------------------------------
console.log(`\n=== decision: the same course, ignored and collected ===\n`);
/**
 * ---- WHY THIS IS A MATRIX AND NOT TWO ROWS ------------------------------
 *
 * The first version of this section raced a FLAWLESS bot both ways and
 * reported an identical finish time to the second, which reads as "aid does
 * nothing". It is nothing of the kind, and it is not a finding about
 * placement: K.AID_CEILING caps what a bottle can top the streak up to, and a
 * clean line is already above the cap, so a perfect run gains exactly zero
 * from aid BY DESIGN. Measuring the trade on the one runner it was never for
 * would have said any placement rule was pointless.
 *
 * So the comparison runs at several ability levels. `fluffed` is the share of
 * the actions the bot is asked for that it simply does not make -- the same
 * knob as tools/simulate.js's skill, expressed where the mistakes actually
 * happen. A decision needs BOTH columns live: if going for the aid always wins
 * it is a tax on anyone who declines, and if it never wins it is decoration.
 */
const dec = {};
const MISSES = [0, 0.06, 0.14, 0.30, 0.50];
console.log('  fluffed   bot                aid taken    contacts   finish     vs record');
for (const miss of MISSES) {
  for (const [label, seek] of [['ignores aid', 0], ['goes and gets it', 1]]) {
    const rs = PKEYS.map((k) => race(Course.generate(k), { seek, miss }));
    const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    const t = mean((r) => r.time);
    const vs = t - K.RECORD_SECONDS;
    dec[miss + ':' + seek] = { t, hits: mean((r) => r.hits), aid: mean((r) => r.aid), total: mean((r) => r.total) };
    console.log(`  ${(miss * 100).toFixed(0).padStart(6)}%   ${label.padEnd(18)} ` +
      `${mean((r) => r.aid).toFixed(1).padStart(4)} / ${mean((r) => r.total).toFixed(1).padEnd(5)} ` +
      `${mean((r) => r.hits).toFixed(1).padStart(9)}   ${Pace.clock(t)}  ` +
      `${(vs >= 0 ? '+' : '') + vs.toFixed(0).padStart(5)}s`);
  }
}
console.log('');
for (const miss of MISSES) {
  const a = dec[miss + ':0'], b = dec[miss + ':1'];
  console.log(`  at ${(miss * 100).toFixed(0).padStart(2)}% fluffed: going for it costs ` +
    `${(b.hits - a.hits).toFixed(1).padStart(5)} more contacts and buys ` +
    `${(a.t - b.t).toFixed(0).padStart(5)}s`);
}

// ---------------------------------------------------------------------------
// exploit
// ---------------------------------------------------------------------------
console.log(`\n=== crossover: when is declining the better call ===\n`);
/**
 * ---- THE TABLE ABOVE IS NOT ENOUGH, AND SAYING SO IS THE POINT ----------
 *
 * At every ability level in it, going for the aid wins. Read alone that says
 * the aid is a tax on anyone who declines rather than a decision -- so the
 * question has to be asked properly, and asking it properly means noticing
 * that the two bots are not taking the same bet.
 *
 * The bot that ignores aid picks the EASIEST lane at every gate: it jumps only
 * when it has to. The bot that goes for the bottle jumps because it WANTS to,
 * in a lane it chose against a clear one standing right beside it. A player is
 * not equally likely to fluff those two. The forced one is the one they read
 * late, commit to under pressure, and get wrong.
 *
 * So this sweeps exactly that: base ability held at 6% fluffed, and an EXTRA
 * chance of missing only the jumps taken to reach a bottle. The number it
 * reports is the one the design turns on -- how much worse a player has to be
 * at the aid jump specifically before running past the bottle is the right
 * call. If that number is small, aid is a trap for the unskilled. If it is
 * huge, aid is free money and the placement rule bought nothing.
 */
const BASE_MISS = 0.06;
const noAid = PKEYS.map((k) => race(Course.generate(k), { seek: 0, miss: BASE_MISS }));
const noAidT = noAid.reduce((a, r) => a + r.time, 0) / noAid.length;
console.log(`  running past every bottle at ${(BASE_MISS * 100).toFixed(0)}% fluffed:  ${Pace.clock(noAidT)}`);
console.log('');
console.log('  extra fluff on the aid jump   aid taken   contacts   finish     vs declining');
let crossover = null;
for (const extra of [0, 0.25, 0.50, 0.75, 1.0]) {
  const rs = PKEYS.map((k) => race(Course.generate(k), { seek: 1, miss: BASE_MISS, aidMiss: extra }));
  const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const t = mean((r) => r.time);
  const d = t - noAidT;
  if (crossover === null && d > 0) crossover = extra;
  console.log(`  ${(extra * 100).toFixed(0).padStart(26)}%   ${mean((r) => r.aid).toFixed(1).padStart(9)}   ` +
    `${mean((r) => r.hits).toFixed(1).padStart(8)}   ${Pace.clock(t)}  ` +
    `${(d >= 0 ? '+' : '') + d.toFixed(0).padStart(6)}s`);
}
console.log('');
if (crossover === null) {
  console.log('  going for the aid wins even when EVERY aid jump is fluffed -- the price is');
  console.log('  not real, and the gain wants looking at rather than the placement');
  bad('aid wins at every risk level tested -- it is a tax on declining, not a decision');
} else {
  console.log(`  declining becomes the better call once a player is ${(crossover * 100).toFixed(0)}% likelier to fluff`);
  console.log('  the jump they took for the bottle than the ones they had to take anyway.');
  console.log('  Below that, going for it pays. Both calls are live, which is the whole ask.');
}

console.log(`\n=== exploit: take the free lane, then cut in behind it ===\n`);
const ex = PKEYS.map((k) => race(Course.generate(k), { seek: 2 }));
const exMean = (f) => ex.reduce((a, r) => a + f(r), 0) / ex.length;
const seekMean = dec["0:1"];
console.log(`  cutting in behind    ${exMean((r) => r.aid).toFixed(1)} / ${exMean((r) => r.total).toFixed(1)} items   ` +
  `${exMean((r) => r.hits).toFixed(1)} contacts   ${Pace.clock(exMean((r) => r.time))}`);
console.log(`  paying at the gate   ${seekMean.aid.toFixed(1)} / ${seekMean.total.toFixed(1)} items   ` +
  `${seekMean.hits.toFixed(1)} contacts   ${Pace.clock(seekMean.t)}`);

// ---------------------------------------------------------------------------
// reach: can a broken run still get to it
// ---------------------------------------------------------------------------
console.log(`\n=== reach: aid is the road back for a broken run ===\n`);
console.log('  fluffed actions   contacts   aid taken   share');
for (const miss of [0, 0.05, 0.15, 0.30]) {
  const rs = PKEYS.map((k) => race(Course.generate(k), { seek: 1, miss }));
  const mean = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  console.log(`  ${(miss * 100).toFixed(0).padStart(13)}%   ${mean((r) => r.hits).toFixed(1).padStart(8)}   ` +
    `${mean((r) => r.aid).toFixed(1).padStart(9)}   ${pct(mean((r) => r.aid), mean((r) => r.total))}`);
}

console.log('');
console.log(fail === 0 ? 'PASS  aid measured' : `FAIL  ${fail} assertion(s) broken`);
process.exit(fail === 0 ? 0 : 1);
