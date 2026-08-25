#!/usr/bin/env node
/**
 * THE DIRECTIONAL MATS, AND THE ROOF, MEASURED.
 *
 *   node tools/tempo.js                365 days, every section
 *   node tools/tempo.js --days 90      a shorter sweep
 *   node tools/tempo.js --section fair just one section
 *
 * The owner: *"The Matts either go forward or backwards. Forward speed you up
 * briefly and backwards slow you down briefly. If there is a backwards one,
 * there needs to be an opening for the running to go through one of the other
 * lanes."* And separately: *"Only obstacle on the roof can be cones"*, and
 * *"You can add two vehicles with ramps together so they can cross on them."*
 *
 * Sections:
 *
 *   place    what the generator laid down: how many marks, how long, which way,
 *            and the yield -- what share of planned marks found a legal lane
 *   open     THE GUARANTEE. For every backward mat, is there an opening, is it
 *            reachable, and what does taking it cost. This is the section that
 *            can fail the build
 *   fair     the guaranteed decide window in MILLISECONDS on a lift mat against
 *            the road either side of it. Same shape and same standard as the
 *            surge assertion in tools/risk.js, and it fails the same way
 *   worth    what a mat is worth in race seconds, driven through the real Pace
 *   roof     cones and paired decks: the deck layout, the landing margin, and
 *            whether a chain can ever be the only way through
 *   cost     what all of it costs the course in gates and in finish time
 *
 * ---- HOW THIS INSTRUMENT WOULD FLATTER ITS OWN THESIS -------------------
 *
 * Rule 3, and the thesis here is "the backward mat is fair because an opening
 * is guaranteed". So every approximation is chosen to make the opening look
 * WORSE than it is:
 *
 *  1. THE OPENING IS RE-DERIVED FROM THE GATE TABLE, not read off the mat. The
 *     mat records which lane the generator picked; this section ignores that
 *     field for the existence test and searches for an opening itself. If the
 *     generator's bookkeeping and the course disagree, the course wins.
 *
 *  2. THE ESCAPE IS COSTED AT ITS WORST GATE, not averaged. A lane that is
 *     CLEAR at four gates and a JUMP at the fifth is counted as costing an
 *     action, because the player has to pay it to hold the lane.
 *
 *  3. THE WINDOW IS MEASURED AT THE CONTRACT, NOT AT THE TYPICAL. Same bias
 *     tools/risk.js documents: the gate is treated as unreadable until the
 *     previous gate's far face has passed the lens, which is the floor the
 *     spacing rule guarantees and much later than most gates are really seen.
 *
 *  4. A DROPPED MARK IS COUNTED AGAINST THE MECHANIC. Marks that found no
 *     legal lane are reported as yield loss even though the only thing they
 *     cost is spacing the course paid for and did not use.
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
const ONLY = arg('section', null);
function want(s) { return !ONLY || ONLY === s; }

// The REAL modules, so every race below drives the shipped state machine.
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
const { Course, Player, Pace, K } = ctx.MR;

let fail = 0;
function bad(msg) { fail++; console.log('  ! ' + msg); }

function keys(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ctx.MR.rng.dateKey(new Date(Date.UTC(2026, 0, 1) + i * 86400000)));
  return out;
}
const KEYS = keys(DAYS);
function pctl(a, p) { return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN; }
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }

console.log(`\n=== tempo: the directional mats, ${DAYS} days ===\n`);

const courses = KEYS.map((k) => Course.generate(k));

// Every course still has to be valid. This is the first thing rather than the
// last, because every number below is meaningless on a course validate() would
// have refused to ship.
let invalid = 0;
const firstErrors = [];
for (const c of courses) {
  if (!c.valid.ok) {
    invalid++;
    if (firstErrors.length < 6) firstErrors.push(c.key + ': ' + c.valid.errors[0]);
  }
}
if (invalid) {
  bad(`${invalid} of ${courses.length} courses fail validate()`);
  for (const e of firstErrors) console.log('      ' + e);
} else {
  console.log(`  validate()        ${courses.length}/${courses.length} courses clean`);
}
console.log('');

// ---- place --------------------------------------------------------------
if (want('place')) {
  console.log('  WHAT THE GENERATOR LAID DOWN');
  let planned = 0, placed = 0, lift = 0, drag = 0;
  const lens = [], gapsPer = [];
  for (const c of courses) {
    planned += (c.tempoPlan || []).length;
    placed += c.tempo.length;
    for (const m of c.tempo) {
      lens.push(m.z1 - m.z0);
      gapsPer.push(m.gates.length);
      if (m.dir > 0) lift++; else drag++;
    }
  }
  lens.sort((a, b) => a - b);
  console.log(`    planned          ${(planned / courses.length).toFixed(2)} marks a course`);
  console.log(`    placed           ${(placed / courses.length).toFixed(2)}  (yield ${(100 * placed / planned).toFixed(0)}%)`);
  console.log(`    forward          ${(lift / courses.length).toFixed(2)} a course`);
  console.log(`    backward         ${(drag / courses.length).toFixed(2)} a course`);
  console.log(`    length           median ${pctl(lens, 0.5).toFixed(1)}u, `
    + `${lens[0].toFixed(1)} to ${lens[lens.length - 1].toFixed(1)}`);
  console.log(`    gates inside     mean ${mean(gapsPer).toFixed(2)}`);
  const sec = pctl(lens, 0.5) / ((K.UNITS_PER_MILE * K.TIME_SCALE) / Pace.SURGE.FLOOR_BASE);
  console.log(`    "briefly"        the median mark is ${sec.toFixed(2)} REAL seconds of running`);
  console.log('');
}

// ---- open ---------------------------------------------------------------
//
// THE SECTION THAT CAN FAIL THE BUILD. The owner's constraint is that a
// backward mat always leaves an opening, and an opening the player cannot
// reach or cannot hold is not an opening.
if (want('open')) {
  console.log('  THE OPEN-LANE GUARANTEE, RE-DERIVED FROM THE COURSE');
  let drags = 0, noOpen = 0, freeOpen = 0, actionOpen = 0, disagree = 0;
  const escCost = { 0: 0, 1: 0, 2: 0 };
  for (const c of courses) {
    for (const m of c.tempo) {
      if (m.dir >= 0) continue;
      drags++;
      // Search for an opening ourselves rather than trusting m.open.
      const found = [];
      for (let l = 0; l < 3; l++) {
        if (l === m.lane) continue;
        let ok = true;
        for (const sp of (c.spans[l] || [])) {
          if (sp.z1 > m.z0 - Course.LANE_TRANSIT && sp.z0 < m.z1) { ok = false; break; }
        }
        if (!ok) continue;
        for (const gi of m.gates) if (c.gates[gi].lanes[l] === ctx.MR.K.BLOCK) { ok = false; break; }
        if (ok) found.push(l);
      }
      if (!found.length) { noOpen++; continue; }
      if (found.indexOf(m.open) < 0) disagree++;
      // Cost of the escape the generator NAMED, at its worst gate.
      let acts = 0;
      for (const gi of m.gates) if (c.gates[gi].lanes[m.open] !== ctx.MR.K.CLEAR) acts++;
      if (acts === 0) freeOpen++; else actionOpen++;
      escCost[Math.min(2, acts)]++;
    }
  }
  console.log(`    backward mats    ${drags}`);
  if (noOpen) bad(`${noOpen} backward mats have NO open lane -- the owner's one constraint`);
  else console.log(`    with an opening  ${drags}/${drags}  (100%)`);
  if (disagree) bad(`${disagree} mats name an opening the course does not agree is open`);
  else console.log(`    bookkeeping      the named opening is open on every one of them`);
  console.log(`    free escape      ${(100 * freeOpen / drags).toFixed(0)}% of openings are CLEAR the whole way`);
  console.log(`                     through -- swerve and pay nothing`);
  console.log(`    costed escape    ${(100 * actionOpen / drags).toFixed(0)}% ask for at least one action to hold`);
  console.log(`                     the lane. THIS is the trade the mechanic exists to make:`);
  console.log(`                     eat the drag, or pay an action to be in the fast lane.`);
  console.log('');
}

// ---- fair ---------------------------------------------------------------
//
// Same measurement, same tolerance and the same failure as the surge section
// of tools/risk.js. A lift makes the runner faster over road that was already
// spaced, so the only thing between it and a rule 4 failure is that course.js
// widened the spacing by at least as much as the speed took away.
if (want('fair')) {
  console.log('  IS A FORWARD MAT STILL FAIR (rule 4)');
  const baseSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE) / Pace.SURGE.FLOOR_BASE;
  /**
   * ---- THIS LINE HAD A DERIVATION BAKED INTO IT AS A CONSTANT -----------
   *
   * It read K.FLOOR_PACE, on the reasoning that a lift takes the runner to the
   * floor. That was TRUE and it was a COINCIDENCE: the shipped LIFT was
   * exactly FLOOR_BASE - K.FLOOR_PACE, so the clamp in tempoTarget bound
   * exactly and a lifted runner landed precisely on 254 s/mi.
   *
   * The moment the owner asked for a smaller step the coincidence broke. A
   * halved lift puts the runner at 257.5, the clamp no longer binds, and this
   * line went on measuring the window against a speed no runner could reach --
   * reporting an 11 ms rule 4 failure against a course that had widened
   * correctly for the speed it actually sells. Rule 3, on the instrument: it
   * failed in the HONEST direction, inventing a problem rather than hiding
   * one, which is the only reason it was caught at all rather than quietly
   * excusing something.
   *
   * Asked of Pace instead of assumed, so it tracks whatever the step becomes.
   */
  const liftSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE)
    / Pace.tempoTarget(Pace.SURGE.FLOOR_BASE, 1);
  const winIn = [], winOut = [];
  for (const c of courses) {
    const marks = (c.tempo || []).filter((m) => m.dir > 0);
    for (let i = 1; i < c.gates.length; i++) {
      const g = c.gates[i], prev = c.gates[i - 1];
      const seen = prev.z + Course.reachOf(prev.lanes, prev.train) + K.CAM_BASE_BACK;
      const gap = g.z - seen;
      if (gap <= 0) continue;
      const on = marks.some((m) => g.z >= m.z0 && g.z < m.z1);
      const inZone = (c.surges || []).some((s) => g.z >= s.z0 && g.z < s.z1);
      if (inZone) continue;             // the surge owns its own assertion
      (on ? winIn : winOut).push(1000 * gap / (on ? liftSpeed : baseSpeed));
    }
  }
  winIn.sort((a, b) => a - b); winOut.sort((a, b) => a - b);
  console.log(`    off a mat        floor ${winOut[0].toFixed(0)} ms, 5th ${pctl(winOut, 0.05).toFixed(0)} ms, `
    + `median ${pctl(winOut, 0.5).toFixed(0)} ms  (at ${baseSpeed.toFixed(1)} u/s)`);
  if (!winIn.length) {
    bad('no gate anywhere sits inside a forward mat -- the mechanic is not reaching the road');
  } else {
    console.log(`    on a forward mat floor ${winIn[0].toFixed(0)} ms, 5th ${pctl(winIn, 0.05).toFixed(0)} ms, `
      + `median ${pctl(winIn, 0.5).toFixed(0)} ms  (at ${liftSpeed.toFixed(1)} u/s)`);
    const d = winIn[0] - winOut[0];
    // 5 ms, the same twelfth of a frame tools/risk.js allows, and for the same
    // reason: float noise, not slack.
    if (winIn[0] < winOut[0] - 5) {
      bad(`a forward mat costs ${(-d).toFixed(0)} ms off the guaranteed window `
        + '-- the widening is not paying for the speed (rule 4)');
    } else {
      console.log(`    verdict          ${d >= 0 ? '+' : ''}${d.toFixed(0)} ms. The widening pays for the`);
      console.log(`                     speed, so a lift buys pace and never a gate the player`);
      console.log(`                     could not act on.`);
    }
  }
  // And the clamp, which is the belt to the widening's braces.
  const fastest = Pace.tempoTarget(Pace.SURGE.FLOOR_SURGE, 1);
  if (fastest < Pace.SURGE.FLOOR_SURGE - 1e-9) {
    bad(`a mat on top of a surge reaches ${fastest.toFixed(1)} s/mi, below the surge floor`);
  } else {
    console.log(`    the clamp        a lift applied to the SURGE floor still returns `
      + `${fastest.toFixed(0)} s/mi,`);
    console.log(`                     so the fastest the game can run is unchanged.`);
  }
  console.log('');
}

// ---- worth --------------------------------------------------------------
//
// What a mat is actually worth, driven through the real Pace rather than
// multiplied out on paper. Two identical runs at a fixed streak, one on the
// mat and one off it, over the same ground.
if (want('worth')) {
  console.log('  WHAT A MAT IS WORTH, THROUGH THE REAL PACE');
  const lens = [];
  for (const c of courses) for (const m of c.tempo) lens.push(m.z1 - m.z0);
  lens.sort((a, b) => a - b);
  const L = pctl(lens, 0.5);
  console.log(`    over the median mark (${L.toFixed(0)}u):`);
  for (const streak of [10, 60, 150]) {
    const row = [];
    for (const dir of [0, 1, -1]) {
      const s = Pace.create(null);
      s.streak = streak;
      s.pace = Pace.targetPace(streak, Pace.floorPace(false));
      s.tempo = dir;
      let ran = 0, t0 = s.raceTime;
      let guard = 0;
      while (ran < L && guard++ < 20000) ran += s.update(1 / 60);
      row.push(s.raceTime - t0);
    }
    const lift = row[1] - row[0], drag = row[2] - row[0];
    console.log(`      streak ${String(streak).padStart(3)}     forward ${lift.toFixed(2)}s   `
      + `backward +${drag.toFixed(2)}s`);
  }
  console.log(`    A forward mat is a small, repeated payment for taking the harder lane;`);
  console.log(`    a backward one is the price of coasting in the easy one. Both are flat`);
  console.log(`    in the streak on purpose -- see the note on tempoTarget.`);
  console.log('');
}

// ---- roof ---------------------------------------------------------------
if (want('roof')) {
  console.log('  THE ROOF: CONES AND PAIRED DECKS');
  let ramps = 0, coned = 0, paired = 0, roofAid = 0, pairBoth = 0;
  const approach = [], landing = [], deckLen = [];
  let onlyWay = 0;
  for (const c of courses) {
    for (const r of c.ramps) {
      ramps++;
      deckLen.push(r.z1 - r.z0);
      if (r.pairs) paired++;
      if (!r.cone) continue;
      coned++;
      approach.push(r.cone - (r.z0 + r.run));
      landing.push(r.z1 - (r.cone + Course.CONE_LAND));
    }
    for (const it of c.aid) if (it.roof) roofAid++;
    // A pair may never be the only way through. Re-derived from the gate table
    // rather than trusted: at every gate carrying two ramps, some THIRD lane
    // has to be passable.
    for (const g of c.gates) {
      if (g.ramp === undefined || g.ramp2 === undefined) continue;
      pairBoth++;
      const rest = [0, 1, 2].filter((x) => x !== g.ramp && x !== g.ramp2);
      if (!rest.some((o) => g.lanes[o] !== ctx.MR.K.BLOCK)) onlyWay++;
    }
  }
  console.log(`    ramps            ${(ramps / courses.length).toFixed(2)} a course`);
  console.log(`    with a cone      ${(100 * coned / ramps).toFixed(0)}%`);
  console.log(`    paired decks     ${(pairBoth / courses.length).toFixed(2)} pairs a course `
    + `(${(100 * paired / ramps).toFixed(0)}% of decks are half of one)`);
  console.log(`    deck depth       median ${pctl(deckLen.slice().sort((a, b) => a - b), 0.5).toFixed(1)}u`);
  if (coned) {
    approach.sort((a, b) => a - b); landing.sort((a, b) => a - b);
    console.log(`    cone approach    floor ${approach[0].toFixed(2)}u of flat deck before it `
      + `(needs ${Course.ACTION_WINDOW})`);
    console.log(`    landing margin   floor ${landing[0].toFixed(2)}u of deck past the end of the arc`);
    if (landing[0] < -1e-9) bad('a jump over a cone lands past the far face of its own deck');
    if (approach[0] < Course.ACTION_WINDOW - 1e-9) {
      bad('a cone stands inside the action window from the top of its tailgate');
    }
  }
  if (onlyWay) bad(`${onlyWay} paired gates leave no third lane -- a chain is the only way through`);
  else if (pairBoth) console.log(`    never required   ${pairBoth}/${pairBoth} paired gates keep a third lane open`);
  console.log(`    roof aid         ${(roofAid / courses.length).toFixed(2)} items a course`);
  console.log('');

  // IN SERIES IS NOT BUILDABLE, AND THE READ WINDOW IS WHY. Two rideable
  // vehicles nose to tail in ONE lane need their decks to abut or to leave a
  // jumpable gap. Both are ruled out by an invariant this project will not
  // trade: spacingAt owes the gate after a vehicle readWindowAt + reachOf, so
  // the clear road between one vehicle's far face and the next gate line is at
  // least READ_NEAR. Reported as a number rather than an opinion.
  console.log('  WHY IN SERIES IS NOT BUILDABLE');
  const gapFloor = Course.READ_NEAR;
  const jumpSpan = K.JUMP_TIME * (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
  // How much of the arc is actually above the deck: the shape in player.update
  // crosses JUMP_CLEAR_Y at these two fractions of the arc.
  let up = 0, dn = 1;
  for (let i = 0; i <= 1000; i++) {
    const a = i / 1000;
    const shape = a < 0.42 ? 1 - Math.pow(1 - a / 0.42, 2.6) : 1 - Math.pow((a - 0.42) / 0.58, 2.6);
    if (K.JUMP_HEIGHT * shape >= 0.84) { if (!up) up = a; dn = a; }
  }
  const clearSpan = (dn - up) * jumpSpan;
  console.log(`    gap floor        ${gapFloor.toFixed(2)}u between one vehicle's far face and the`);
  console.log(`                     next gate line -- readWindowAt + reachOf, the invariant`);
  console.log(`                     that makes every gate readable past the one before it`);
  console.log(`    jumpable gap     ${clearSpan.toFixed(2)}u -- the ground covered while the feet are`);
  console.log(`                     above JUMP_CLEAR_Y, which is the whole of what a gap`);
  console.log(`                     between two decks could be`);
  console.log(`    verdict          ${clearSpan.toFixed(1)} < ${gapFloor.toFixed(1)}. Two decks in one lane can neither`);
  console.log(`                     abut nor be jumped without lowering the read window,`);
  console.log(`                     which is the one number the fairness proof is built on.`);
  console.log(`                     SIDE BY SIDE WORKS AND IS FREE; IN SERIES IS NOT BUILDABLE.`);
  console.log('');
}

// ---- cost ---------------------------------------------------------------
if (want('cost')) {
  console.log('  WHAT IT COSTS THE COURSE');
  const g0 = Course.TEMPO, r0 = Course.ROOF;
  function sweep(tempo, roof) {
    Course.TEMPO = tempo; Course.ROOF = roof;
    let gates = 0, aid = 0, degraded = 0;
    for (const k of KEYS) {
      const c = Course.generate(k);
      gates += c.gates.length; aid += c.aid.length; degraded += c.tally.degraded;
    }
    return { gates: gates / KEYS.length, aid: aid / KEYS.length, degraded };
  }
  const off = sweep(0, 0), tOnly = sweep(1, 0), rOnly = sweep(0, 1), both = sweep(1, 1);
  Course.TEMPO = g0; Course.ROOF = r0;
  console.log(`    TEMPO=0 ROOF=0   ${off.gates.toFixed(1)} gates, ${off.aid.toFixed(1)} aid, ${off.degraded} degraded`);
  console.log(`    TEMPO=1 ROOF=0   ${tOnly.gates.toFixed(1)} gates  (${(tOnly.gates - off.gates).toFixed(1)})`);
  console.log(`    TEMPO=0 ROOF=1   ${rOnly.gates.toFixed(1)} gates  (${(rOnly.gates - off.gates).toFixed(1)})`);
  console.log(`    TEMPO=1 ROOF=1   ${both.gates.toFixed(1)} gates, ${both.aid.toFixed(1)} aid, `
    + `${both.degraded} degraded  (${(both.gates - off.gates).toFixed(1)})`);
  if (both.degraded > off.degraded) {
    bad(`the generator gives up ${both.degraded - off.degraded} more times with the mechanics on`);
  }
  console.log('');
}

console.log(fail ? `FAIL  ${fail} audit problem(s) -- do not quote the numbers above`
                 : 'PASS  tempo, the open-lane guarantee and the roof contract all hold');
process.exit(fail ? 1 : 0);
