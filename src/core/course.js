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
  //
  // DERIVED, not typed, and that is not tidiness. It was the literal 20, with
  // a comment in constants.js justifying it as "0.70s * 26.3 u/s = 18.4" --
  // but 26.3 u/s is RECORD pace, not the fastest the runner ever goes. At the
  // pace floor the airborne span is longer, and when the floor moved 4:20 ->
  // 4:14 the span went to 19.84 against a window of 20. A 0.16-unit margin,
  // 0.8%, on the invariant that stops the course demanding a jump and a slide
  // at once -- reached silently, by editing a different file.
  //
  // Now it follows the arc and the top speed, so a retune of either moves it.
  // The +1 is real headroom rather than a rounding artefact: the generator
  // pushes gate spacing right down to this number, so the two are the same
  // constraint seen from both ends.
  const MAX_SPEED = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
  const ACTION_WINDOW = Math.ceil(K.JUMP_TIME * MAX_SPEED) + 1;

  /**
   * ...and the pace floor stopped being the fastest the runner ever moves the
   * day hills landed.
   *
   * With a grade term the local top speed is (UNITS_PER_MILE * TIME_SCALE) /
   * (FLOOR_PACE + GRADE_SPM * grade), so on the steepest legal descent the
   * airborne span is 21.54 units against a constant window of 21. The margin
   * is not merely thin, it is negative -- so the window becomes a function of
   * z and the BFS proof holds BY CONSTRUCTION rather than by luck.
   *
   * `Elevation.windowExtra(z)` is the extra span the steepest descent within
   * one airborne reach of z would buy, so this preserves the SAME 1.16-unit
   * absolute margin the flat course has today at every point of the profile.
   * On the steepest descent the solver demands ~22.7 units between conflicting
   * gates instead of 21 -- an 8% loosening of the tightest spacing, invisible
   * in play.
   *
   * This is what forces the elevation to be generated BEFORE the gates in
   * generate() below. Elevation reads nothing from the course, so there is no
   * cycle -- but the ordering is load-bearing and not incidental.
   */
  function actionWindowAt(z, elev) {
    return ACTION_WINDOW + (elev ? elev.windowExtra(z) : 0);
  }

  const START_GRACE = 150;   // clean runway so the first seconds read calmly
  // Clean straight into the tape. It was 190 units -- 0.80 of a mile, about
  // seven seconds at race pace -- and combined with the difficulty ramp's
  // natural tail it left the entire last mile holding TWO gates. The closing
  // act of a four-minute race was an empty road.
  //
  // 55 keeps what the grace was for: a beat of clear tarmac so the tape is a
  // moment you run through rather than something you scramble into. Two
  // seconds is enough to see it coming, and not enough to get bored.
  const FINISH_GRACE = 55;

  const BIOMES = [
    { name: 'CITY START', from: 0.00 },
    { name: 'RIVERSIDE', from: 0.17 },
    { name: 'THE BRIDGE', from: 0.33 },
    { name: 'PARKLAND', from: 0.50 },
    { name: 'THE WALL', from: 0.72 },
    { name: 'FINAL MILE', from: 0.92 },
  ];


  /**
   * THE SETTING POOL.
   *
   * Twelve places, led by the World Marathon Majors, because a daily marathon
   * game should be run somewhere you have heard of. Each is a real marathon
   * city with landmarks that can be modelled in this game's own flat-shaded
   * style -- no photography, no licensed imagery, nothing fetched at runtime.
   *
   * `tag` is the stable key world.js looks up for palette and content. `hint`
   * is not decorative: it is the contract for what that setting owes the
   * frame, so a renderer pass can be judged against something written down
   * rather than against taste.
   */
  const SETTINGS = [
    { tag: 'BOSTON',    name: 'BOSTON',        hint: 'brownstones, autumn maples, the Citgo sign, a right on Hereford and a left on Boylston' },
    { tag: 'LONDON',    name: 'LONDON',        hint: 'Tower Bridge, red buses, black cabs, plane trees, the Thames' },
    { tag: 'BERLIN',    name: 'BERLIN',        hint: 'the Brandenburg Gate, the Fernsehturm, linden avenues, the Spree' },
    { tag: 'CHICAGO',   name: 'CHICAGO',       hint: 'elevated L track over the road, river bascule bridges, a black glass skyline' },
    { tag: 'NEWYORK',   name: 'NEW YORK',      hint: 'the Verrazzano span, brownstones, yellow cabs, Central Park stone walls' },
    { tag: 'TOKYO',     name: 'TOKYO',         hint: 'the Imperial Palace moat, torii, neon signage, the Skytree' },
    { tag: 'SYDNEY',    name: 'SYDNEY',        hint: 'the Harbour Bridge, the Opera House shells, ferries, harbour water' },
    { tag: 'PARIS',     name: 'PARIS',         hint: 'the Eiffel Tower, Haussmann facades, Seine bridges, kiosks' },
    { tag: 'VALENCIA',  name: 'VALENCIA',      hint: 'the City of Arts and Sciences, palms, orange groves, white stone' },
    { tag: 'AMSTERDAM', name: 'AMSTERDAM',     hint: 'canals, gabled houses, bicycle racks, humpback bridges' },
    { tag: 'ROME',      name: 'ROME',          hint: 'the Colosseum, an aqueduct, umbrella pines, ochre walls' },
    { tag: 'CAPETOWN',  name: 'CAPE TOWN',     hint: 'Table Mountain, the coast road, fynbos, Atlantic surf' },
  ];

  /**
   * Pick this date's course settings.
   *
   * Three or four per run, drawn from the twelve. That number is chosen from
   * the clock rather than by feel: at four minutes a race, three settings is
   * ~80 seconds each and four is ~60, which is long enough for a place to
   * register and short enough that something new is always coming. One setting
   * for the whole race would be four minutes of the same street.
   *
   * Every day therefore gets a genuinely different course -- a different
   * layout AND a different journey -- from the same twelve places, and the
   * pool can grow without any of this changing.
   */
  function pickSettings(key) {
    const rnd = MR.rng.stream(key, 'settings/v1');
    const n = rnd.chance(0.5) ? 3 : 4;

    // Draw without replacement.
    const bag = SETTINGS.slice();
    const chosen = [];
    for (let i = 0; i < n; i++) chosen.push(bag.splice(rnd.int(0, bag.length - 1), 1)[0]);

    // Segment boundaries. Even splits, jittered, but never so far that a
    // setting becomes a blink: no segment may be under 60% of an even share.
    const even = 1 / n;
    const cuts = [0];
    for (let i = 1; i < n; i++) cuts.push(i * even + rnd.range(-0.35, 0.35) * even);
    cuts.push(1);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] < even * 0.6) cuts[i] = cuts[i - 1] + even * 0.6;
    }
    const span = cuts[cuts.length - 1] - cuts[0];
    for (let i = 0; i < cuts.length; i++) cuts[i] = cuts[i] / span;

    return chosen.map(function (s, i) {
      return {
        tag: s.tag, name: s.name, hint: s.hint,
        from: cuts[i], to: cuts[i + 1],
        first: i === 0,
        last: i === chosen.length - 1,
      };
    });
  }

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
    // The exponent was 0.85, which put the hardest part of the course a long
    // way behind the part of the race that actually decides it. Measured over
    // 40 days, the share of gates that forced an action ran 0% / 7% / 10%
    // across the first three tenths and 61% / 57% / 64% across the last three
    // -- while the cost of a single mistake peaks between 15% and 50% of the
    // race and has largely decayed by 80%. The most expensive stretch to make
    // a mistake in was the stretch where the game barely asked for one.
    //
    // 0.62 pulls the ramp forward without touching the top: at f=1 this still
    // lands on the same value, so the closing miles are as demanding as they
    // were. It also tightens spacing early for free, since spacingAt() derives
    // its mean from this number.
    //
    // The first few percent stay easy on purpose. START_GRACE already gives a
    // clean run-up, and an opening that reads calmly is what lets a new player
    // learn the lane geometry before the course starts asking questions.
    const base = Math.pow(f, 0.62);
    const wall = 0.28 * Math.exp(-Math.pow((f - 0.763) / 0.055, 2));
    // THE RUN-IN. A second, sharper spike over the closing half-mile.
    //
    // The wall at mile 20 is the race's hard middle; this is its last question.
    // Without it the difficulty curve simply tails off into the finish, which
    // is the wrong shape for an ending -- a player arrives at the tape having
    // been asked nothing for the better part of a minute. Narrower and later
    // than the wall so the two read as separate events rather than one long
    // grind, and it saturates the dial, which also pulls gate spacing to its
    // floor through spacingAt().
    const home = 0.34 * Math.exp(-Math.pow((f - 0.972) / 0.028, 2));
    return Math.min(1, base * 0.86 + wall + home);
  }

  function spacingAt(f, rnd, z, elev) {
    const d = difficulty(f);
    // 44 units early, tightening as difficulty rises. The floor is
    // ACTION_WINDOW itself rather than a number chosen to sit near it: the
    // solver rejects anything that would demand two conflicting actions inside
    // that distance, so the generator can be pushed right to the edge of the
    // rule and let the proof hold the line. Tying the two together means a
    // retune of the jump arc or the pace floor moves both ends of the same
    // constraint at once, instead of moving one and leaving the other stale.
    const mean = 44 - 23 * d;
    // The floor is the SAME call the solver makes, evaluated at the same z, so
    // a descent widens the generator's tightest spacing and the proof's window
    // together. Moving one without the other is how this invariant went stale
    // the first time.
    return Math.max(actionWindowAt(z, elev), mean * rnd.range(0.84, 1.16));
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
    let nudged = 0;   // consecutive gaps a rescue item has declined
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
          // ...but not EVERY item, and that qualification is the whole fix.
          //
          // Scoring every placement for maximum difficulty produced a rescue
          // mechanic that only a player who did not need rescuing could reach.
          // Measured over 171 items: 85% sat off the centre lane, 71% demanded
          // an action at the gate on BOTH sides, and 94% demanded one on at
          // least one side. Aid tops the streak back up to AID_CEILING, so it
          // is the designated road back for a broken run -- and it was gated
          // behind two consecutive clean clears plus a lane change, asked of
          // the one player whose defining problem is that they cannot string
          // two clean clears together. The stronger the aid was made, the
          // further out of reach it moved. A 16-contact run collected none.
          //
          // So the pool is mixed rather than uniformly hard. Roughly half the
          // items are still scored for maximum difficulty -- those are the
          // trade the design wants, and a strong run will hoover them up on
          // the way past. The rest are scored INVERTED, landing in the easiest
          // legal lane, and those are the ones a broken run can actually take.
          //
          // Deterministic, so the course stays identical for every player: the
          // choice comes from the same seeded stream as everything else, never
          // from the runner's live state.
          const rescue = rnd.chance(0.5);
          // -Infinity, not -1. On the rescue path `rank` is a NEGATED score
          // and is therefore always below zero, so a -1 seed meant no lane
          // scoring 1 or worse could ever beat the initial value: the loop
          // silently fell through, left the lane as an arbitrary open[0], and
          // reported a demand of 1 no matter how hard the placement actually
          // was. Two rounds of tuning measured no effect for exactly this
          // reason before the seed was found.
          let lane = open[0], best = -Infinity;
          for (const l of open) {
            const before = gates[gi].lanes[l];
            const after = gi + 1 < gates.length ? gates[gi + 1].lanes[l] : K.CLEAR;
            let score = 0;
            if (before === K.JUMP || before === K.DUCK) score += 3;
            if (after === K.JUMP || after === K.DUCK) score += 3;
            if (l !== 1) score += 1;
            // Break ties from the seeded stream so a course still varies.
            score += rnd.next() * 0.9;
            // A rescue item wants the LEAST demanding lane, so the same score
            // is simply read the other way up rather than duplicated.
            const rank = rescue ? -score : score;
            if (rank > best) { best = rank; lane = l; }
          }
          // `best` is negated on a rescue item, so recover the real score for
          // the guarded flag the renderer uses to decide how loudly to
          // telegraph the pickup.
          const demand = rescue ? -best : best;

          // Reading the score the other way up is not enough on its own, and
          // measurement is why this is here. Inverting the lane choice moved
          // "reachable without clearing anything" only from 6% to 9%, because
          // the LANE is picked after the POSITION and the course is now dense
          // enough that most gaps have no easy lane in any of the three.
          //
          // So a rescue item is allowed to decline a gap. If the gentlest lane
          // here still demands an action, skip this gap and look at the next
          // one; `nudged` bounds that walk so aid can never migrate far from
          // where the spacing rule wanted it, and so a stretch of course with
          // no easy gap at all cannot silently swallow every rescue item.
          if (rescue && demand >= 3 && nudged < 5) {
            nudged++;
            // Step to the NEXT GAP, not a fixed distance. The first version of
            // this advanced 26 units, which is less than the median gate
            // spacing of 29.6 -- so it usually re-tested the same gap, decided
            // the same thing, and burned its whole allowance without ever
            // looking at a new one. The measured effect was nil.
            const nz = gi + 1 < gates.length ? gates[gi + 1].z + 5 : z + 32;
            z = Math.max(z + 10, nz);
            continue;
          }
          nudged = 0;

          const f2 = z / K.TOTAL_UNITS;
          const fruit = rnd.chance(0.12 + 0.46 * f2 * f2);
          items.push(fruit
            ? { z, lane, kind: 'banana', gain: K.AID_BANANA, guarded: demand >= 3 }
            : { z, lane, kind: 'water', gain: K.AID_WATER, guarded: demand >= 3 });
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

  /**
   * Where the hills may not go, and where one is mandated.
   *
   * COMPOSITION LIVES HERE, not in elevation.js, because this file is the one
   * that knows what shape a race is: where the bridge is and where the wall is.
   *
   * THE BRIDGE. `deckLift` in world.js turns the ground plane into water across
   * the BRIDGE biome and 190 units either side of it. A seeded hill there would
   * arch the river with the road, so the whole span is excluded and the leg
   * over the water stays flat -- which is also what a real bridge deck is.
   *
   * THE WALL. difficulty() puts a Gaussian spike at f = 0.763, and measured on
   * two dates that band carries 35-36 gates against only 2 aid items. A hill
   * crested at the centre of it makes the player CLIMB INTO the density peak
   * and DESCEND OUT of it. The two reinforce rather than compete: the grade
   * changes no gate's difficulty, because clearance is measured against the
   * local road -- and uphill buys reaction time while downhill spends it, so at
   * +4% the 1.16 s gate interval goes to 1.24 and at -4% to 1.09. The hardest
   * stretch of the course is therefore also, very slightly, the most forgiving
   * one to react in, and the reward for cresting it has teeth.
   */
  function elevationPlan() {
    const bridge = BIOMES.find(function (b) { return b.name === 'THE BRIDGE'; });
    const after = BIOMES[BIOMES.indexOf(bridge) + 1];
    const PAD = 230;   // the water ramp, plus a little
    return {
      exclude: [[bridge.from * K.TOTAL_UNITS - PAD, after.from * K.TOTAL_UNITS + PAD]],
      mandate: [{ z: 0.763 * K.TOTAL_UNITS, L: 180 }],
    };
  }

  function generate(key) {
    // ELEVATION FIRST, AND THE ORDER IS THE POINT. actionWindowAt() reads the
    // profile, spacingAt() and solvable() both read actionWindowAt(), and the
    // generator calls both on every gate -- so the ground has to exist before
    // the first gate is placed. Elevation reads nothing back from the course.
    const elevation = MR.Elevation.create(key, elevationPlan());

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
        if (solvable(trial, elevation)) { lanes = cand; break; }
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
      z += spacingAt(f, rnd, z, elevation);
    }

    const mileMarkers = [];
    for (let m = 1; m <= 26; m++) mileMarkers.push({ mile: m, z: m * K.UNITS_PER_MILE });
    mileMarkers.push({ mile: K.MARATHON_MILES, z: K.TOTAL_UNITS, finish: true });

    const aid = generateAid(key, gates);
    const course = { key, gates, aid, mileMarkers, biomes: BIOMES, length: K.TOTAL_UNITS,
                     elevation };

    // This date's places, in the order they will be run through. Carried
    // ALONGSIDE `biomes` rather than replacing it: `biomes` describes the shape
    // of the race (where the bridge is, where the wall is) and is the same
    // every day by design, while `settings` describes where that race is being
    // run and is redrawn daily. The renderer can key palette and content off
    // the setting and still ask `biomes` whether it is currently on a bridge.
    course.settings = pickSettings(key);
    course.settingAt = function (f) {
      const list = course.settings;
      for (let i = list.length - 1; i >= 0; i--) if (f >= list[i].from) return list[i];
      return list[0];
    };

    course.valid = validate(course);
    return course;
  }

  /**
   * BFS over (gate, lane). A lane is enterable when it is not BLOCK; a lateral
   * move is allowed when the destination lane is free at that gate. Action
   * conflicts are rejected: two gates closer than ACTION_WINDOW may not demand
   * a jump and a duck back to back on the chosen path.
   */
  function solvable(gates, elev) {
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
          // Conflicting actions inside one window are unplayable. The window is
          // measured at the EARLIER gate, which is where the action was
          // committed and therefore where the airborne span starts; the profile
          // already looked one airborne reach forward from there when it built
          // the table. See actionWindowAt.
          if (h !== K.CLEAR && s.act !== K.CLEAR && h !== s.act
            && g.z - s.z < actionWindowAt(s.z, elev)) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < actionWindowAt(az, elev) ? 1 : 0);
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
    const elev = course.elevation;
    for (let i = 0; i < g.length; i++) {
      if (g[i].lanes.every((l) => l === K.BLOCK)) errors.push(`gate ${i}: all lanes blocked`);
      if (i > 0 && g[i].z <= g[i - 1].z) errors.push(`gate ${i}: not ordered in z`);
      if (i > 0 && g[i].z - g[i - 1].z < 18) errors.push(`gate ${i}: spacing ${(g[i].z - g[i - 1].z).toFixed(1)} too tight`);
    }
    if (!solvable(g, elev)) errors.push('course has no solvable lane path');
    // The sightline sweep. A profile that hides the road beyond a crest hides
    // the lane telegraph mats with it, which is the same class of failure
    // tools/shoot.js fails a build for when a prop occludes a hazard -- so it
    // is a course validation error, not a rendering note.
    if (elev) {
      const e = elev.validate();
      if (!e.ok) for (const m of e.errors) errors.push('elevation: ' + m);
    }
    return { ok: errors.length === 0, errors, gates: g.length };
  }

  return { generate, generateAid, validate, solvable, biomeAt, difficulty,
           BIOMES, SETTINGS, pickSettings, ACTION_WINDOW, actionWindowAt,
           elevationPlan };
})();
