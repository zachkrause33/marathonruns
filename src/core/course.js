/**
 * Date-seeded course generation.
 *
 * The course is a list of gates ordered by z. A gate assigns one hazard to
 * each of the three lanes:
 *
 *   CLEAR  nothing
 *   JUMP   low block, cleared by jumping
 *   DUCK   overhead bar, cleared by ducking
 *   BLOCK  impassable; may span several gates as a "train"
 *
 * Two properties matter more than anything aesthetic:
 *
 *  1. Determinism. The seed is the UTC date, so every player worldwide runs
 *     the identical course. Nothing here may read wall-clock time.
 *
 *  2. Solvability. There must exist a lane path from the start line to the
 *     finish that never enters a BLOCK and never needs two conflicting
 *     actions inside one action window. This is *proved* by BFS in
 *     `validate`, not assumed -- generation retries a gate until the partial
 *     course is still solvable, and the finished course is verified end to
 *     end before it is handed to the game.
 */
MR.Course = (function () {
  const K = MR.K;

  // A jump covers this much ground; two conflicting action gates closer than
  // this would demand being airborne and ducking at once.
  const ACTION_WINDOW = 20;
  const START_GRACE = 150;   // clean runway so the first seconds read calmly
  const FINISH_GRACE = 190;  // clean straight into the tape

  const BIOMES = [
    { name: 'CITY START', from: 0.00 },
    { name: 'RIVERSIDE', from: 0.17 },
    { name: 'THE BRIDGE', from: 0.33 },
    { name: 'PARKLAND', from: 0.50 },
    { name: 'THE WALL', from: 0.72 },
    { name: 'FINAL MILE', from: 0.92 },
  ];

  function biomeAt(f) {
    let b = BIOMES[0];
    for (const x of BIOMES) if (f >= x.from) b = x;
    return b;
  }

  /**
   * Difficulty in [0,1]. Rises through the race with a deliberate spike at
   * mile 20 -- the point where real marathoners hit the wall.
   */
  function difficulty(f) {
    const base = Math.pow(f, 0.85);
    const wall = 0.28 * Math.exp(-Math.pow((f - 0.763) / 0.055, 2));
    return Math.min(1, base * 0.88 + wall);
  }

  function spacingAt(f, rnd) {
    const d = difficulty(f);
    // 44 units early -> 21 late. The floor is 20 rather than 22 because
    // ACTION_WINDOW is 20 and the solver rejects anything that would demand
    // two conflicting actions inside it -- so the generator can be pushed to
    // the edge of that rule and let the proof hold the line.
    const mean = 44 - 23 * d;
    return Math.max(20, mean * rnd.range(0.84, 1.16));
  }

  /** Hazard mix widens as difficulty rises. */
  function rollHazard(rnd, d, allowBlock) {
    const kinds = [K.JUMP, K.DUCK];
    const weights = [1, 0.55 + 0.45 * d];
    if (allowBlock) {
      kinds.push(K.BLOCK);
      weights.push(0.25 + 0.95 * d);
    }
    return rnd.weighted(kinds, weights);
  }

  /**
   * Build one gate's three lanes. Guarantees at least one non-BLOCK lane and
   * never fills all three with demanding hazards early on.
   */
  function makeGate(rnd, f) {
    const d = difficulty(f);
    const lanes = [K.CLEAR, K.CLEAR, K.CLEAR];

    // How many lanes carry a hazard.
    //
    // This is the difficulty dial and it was set far too low. A gate with any
    // CLEAR lane can be answered by moving into it, so the jump and the slide
    // are optional at that gate. Measured on the shipped course: 94% of gates
    // had a totally clear lane and only 6% forced an action -- nine of those
    // ten in the final third. A player could run the whole marathon by finding
    // the free lane and never once using the mechanic the game is built on,
    // which is exactly what the first record-breaking run did.
    //
    // A three-hazard gate is the one that forces the issue: makeGate never
    // puts a BLOCK on a full-width gate (see allowBlock below), so all three
    // lanes are JUMP or DUCK and every one of them is passable WITH the right
    // action. Forcing an action is therefore never unfair -- it is the
    // difference between choosing a lane and playing the game.
    const full = d < 0.14 ? 0
      : d < 0.34 ? 0.10
      : d < 0.58 ? 0.30
      : d < 0.80 ? 0.48
      : 0.62;
    const nHaz = rnd.chance(full) ? 3
      : d < 0.18 ? 1
      : d < 0.42 ? rnd.int(1, 2)
      : 2;

    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rnd.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }

    let blocks = 0;
    for (let i = 0; i < nHaz; i++) {
      const lane = order[i];
      // BLOCK may never take the last open lane, so it is off the table once
      // two lanes are already blocked, and never offered on a full-width gate.
      const allowBlock = blocks < 2 && nHaz < 3;
      const h = rollHazard(rnd, d, allowBlock);
      if (h === K.BLOCK) blocks++;
      lanes[lane] = h;
    }

    // Hard invariant: never three blocks.
    if (lanes.every((l) => l === K.BLOCK)) lanes[order[0]] = K.CLEAR;
    return lanes;
  }

  /**
   * Trains: a BLOCK extended over several gate-lengths in one lane. They are
   * what force committed lane choices instead of last-instant dodges.
   */
  function maybeTrain(rnd, f, lanes) {
    const d = difficulty(f);
    if (d < 0.3 || !rnd.chance(0.16 + 0.2 * d)) return 0;
    const candidates = [];
    for (let l = 0; l < 3; l++) if (lanes[l] === K.BLOCK) candidates.push(l);
    if (!candidates.length) return 0;
    return rnd.int(2, d > 0.7 ? 4 : 3);   // in gate-spans
  }


  /**
   * Aid: water tables and fruit, placed deterministically from the same date
   * seed as everything else.
   *
   * Two placement rules matter. They are only ever put in a lane that is
   * PASSABLE at that point on the course, so aid can never be dangled somewhere
   * a player is not allowed to go; and they are pushed to the gap BETWEEN
   * gates, so taking one is never entangled with a jump or a duck the player
   * is already committed to.
   *
   * One item per aid point, never a cluster. An earlier version put out a
   * table of 3-5 bottles, which fired five pickups inside a second and a half
   * and read as a single smear rather than as a decision -- and the decision
   * is the whole point, because the aid lane is often not the lane the racing
   * line wants.
   *
   * Sparse early and dense late, with fruit getting commoner as the race goes
   * on. A run is rarely broken in the first mile; the back half is where the
   * wall is, where the streak is worth most, and where a rescue is worth
   * having.
   */
  function generateAid(key, gates) {
    const rnd = MR.rng.stream(key, 'aid/v3');
    const items = [];
    if (!gates.length) return items;

    let gi = 0;
    let z = START_GRACE + rnd.range(200, 340);
    const end = K.TOTAL_UNITS - FINISH_GRACE - 60;
    let guard = 0;

    while (z < end && guard++ < 4000) {
      while (gi < gates.length - 1 && gates[gi + 1].z < z) gi++;
      const f = z / K.TOTAL_UNITS;

      // Sit in the gap between this gate and the next, never on a gate line.
      const a = gates[gi].z;
      const b = gi + 1 < gates.length ? gates[gi + 1].z : a + 40;
      if (b - a > 12) {
        // Only lanes passable at the gates either side of the gap, so aid can
        // never be dangled somewhere the player is not allowed to go.
        const open = [];
        for (let l = 0; l < 3; l++) {
          const here = gates[gi].lanes[l];
          const next = gi + 1 < gates.length ? gates[gi + 1].lanes[l] : K.CLEAR;
          if (here !== K.BLOCK && next !== K.BLOCK) open.push(l);
        }
        if (open.length) {
          // WHICH lane the aid goes in is the whole design of it.
          //
          // Dropping it in a random passable lane made it free: if the racing
          // line already ran through that lane you collected it without
          // deciding anything. Aid should be a trade -- leave the easy line,
          // clear something, get paid -- so the lane is chosen to be the
          // HARDEST one that is still legal, not an arbitrary one.
          //
          // Difficulty is scored from the gates either side of the gap,
          // because those are what the player has to survive to be in this
          // lane at this moment:
          //   an action at the gate BEFORE  -- you had to clear something to
          //                                   get here
          //   an action at the gate AFTER   -- you have to clear something on
          //                                   the way out, still in this lane
          //   off-centre                    -- costs a lane change and gives
          //                                   up the middle, which is the lane
          //                                   with an escape on both sides
          //
          // The lane is still guaranteed passable at both gates, so this makes
          // aid demanding without ever making it a trap. Nothing here can
          // reach a BLOCK: `open` excluded those before scoring.
          let lane = open[0], best = -1;
          for (const l of open) {
            const before = gates[gi].lanes[l];
            const after = gi + 1 < gates.length ? gates[gi + 1].lanes[l] : K.CLEAR;
            let score = 0;
            if (before === K.JUMP || before === K.DUCK) score += 3;
            if (after === K.JUMP || after === K.DUCK) score += 3;
            if (l !== 1) score += 1;
            // Break ties from the seeded stream so a course still varies.
            score += rnd.next() * 0.9;
            if (score > best) { best = score; lane = l; }
          }

          const f2 = z / K.TOTAL_UNITS;
          const fruit = rnd.chance(0.12 + 0.46 * f2 * f2);
          items.push(fruit
            ? { z, lane, kind: 'banana', gain: K.AID_BANANA, guarded: best >= 3 }
            : { z, lane, kind: 'water', gain: K.AID_WATER, guarded: best >= 3 });
        }
      }

      // Sparse early, dense late. Aid exists to rescue a broken run, and a run
      // is rarely broken in the first mile, so the opening stays clean and the
      // back half -- where the wall is and where the streak is worth most --
      // carries most of the help.
      const spacing = 620 - 400 * f;
      z += spacing * rnd.range(0.82, 1.18);
    }
    items.sort(function (p, q) { return p.z - q.z; });
    return items;
  }

  function generate(key) {
    const rnd = MR.rng.stream(key, 'course/v1');
    const gates = [];

    // trainUntil[lane] = gate index (exclusive) that lane stays blocked to.
    const trainUntil = [-1, -1, -1];

    let z = START_GRACE;
    const end = K.TOTAL_UNITS - FINISH_GRACE;
    let guard = 0;

    while (z < end && guard++ < 20000) {
      const f = z / K.TOTAL_UNITS;
      const idx = gates.length;

      let lanes = null;
      // Retry until this gate keeps the course solvable.
      for (let attempt = 0; attempt < 24; attempt++) {
        const cand = makeGate(rnd, f);

        // Carry active trains through.
        for (let l = 0; l < 3; l++) if (idx < trainUntil[l]) cand[l] = K.BLOCK;
        if (cand.every((l) => l === K.BLOCK)) continue;

        const trial = gates.concat([{ z, lanes: cand, f }]);
        if (solvable(trial)) { lanes = cand; break; }
      }
      if (!lanes) {
        // Degrade to a guaranteed-safe gate rather than emit something unfair.
        lanes = [K.CLEAR, K.CLEAR, K.CLEAR];
        for (let l = 0; l < 3; l++) if (idx < trainUntil[l]) lanes[l] = K.BLOCK;
      }

      const span = maybeTrain(rnd, f, lanes);
      if (span) {
        for (let l = 0; l < 3; l++) {
          if (lanes[l] === K.BLOCK && trainUntil[l] <= idx) {
            // Only extend if some other lane survives the whole span.
            const others = [0, 1, 2].filter((x) => x !== l);
            if (others.some((o) => idx >= trainUntil[o])) trainUntil[l] = idx + span;
            break;
          }
        }
      }

      gates.push({ z, lanes, f, train: span });
      z += spacingAt(f, rnd);
    }

    const mileMarkers = [];
    for (let m = 1; m <= 26; m++) mileMarkers.push({ mile: m, z: m * K.UNITS_PER_MILE });
    mileMarkers.push({ mile: K.MARATHON_MILES, z: K.TOTAL_UNITS, finish: true });

    const aid = generateAid(key, gates);
    const course = { key, gates, aid, mileMarkers, biomes: BIOMES, length: K.TOTAL_UNITS };
    course.valid = validate(course);
    return course;
  }

  /**
   * BFS over (gate, lane). A lane is enterable when it is not BLOCK; a lateral
   * move is allowed when the destination lane is free at that gate. Action
   * conflicts are rejected: two gates closer than ACTION_WINDOW may not demand
   * a jump and a duck back to back on the chosen path.
   */
  function solvable(gates) {
    if (!gates.length) return true;
    // state: set of (lane, lastAction, lastActionZ) -- collapse by lane+action.
    let states = [];
    for (let l = 0; l < 3; l++) states.push({ lane: l, act: K.CLEAR, z: -1e9 });

    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      const next = [];
      const seen = new Set();
      for (const s of states) {
        for (let l = 0; l < 3; l++) {
          const h = g.lanes[l];
          if (h === K.BLOCK) continue;
          // Conflicting actions inside one window are unplayable.
          if (h !== K.CLEAR && s.act !== K.CLEAR && h !== s.act && g.z - s.z < ACTION_WINDOW) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < ACTION_WINDOW ? 1 : 0);
          if (seen.has(tag)) continue;
          seen.add(tag);
          next.push({ lane: l, act, z: az });
        }
      }
      if (!next.length) return false;
      states = next;
    }
    return true;
  }

  function validate(course) {
    const errors = [];
    const g = course.gates;
    for (let i = 0; i < g.length; i++) {
      if (g[i].lanes.every((l) => l === K.BLOCK)) errors.push(`gate ${i}: all lanes blocked`);
      if (i > 0 && g[i].z <= g[i - 1].z) errors.push(`gate ${i}: not ordered in z`);
      if (i > 0 && g[i].z - g[i - 1].z < 18) errors.push(`gate ${i}: spacing ${(g[i].z - g[i - 1].z).toFixed(1)} too tight`);
    }
    if (!solvable(g)) errors.push('course has no solvable lane path');
    return { ok: errors.length === 0, errors, gates: g.length };
  }

  return { generate, generateAid, validate, solvable, biomeAt, difficulty, BIOMES, ACTION_WINDOW };
})();
