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

  /**
   * ---- TWO MECHANICS UNDER TEST, BOTH BEHIND A SCALAR ---------------------
   *
   * Same A/B shape as MR.Runner.POLISH and for the same reason: ONE build
   * generates both courses, so a comparison cannot go stale the way a side
   * branch or a checked-in table does. main.js reads ?narrow= and ?ramp=;
   * tools/mechanics.js sets them directly.
   *
   * THE RULE BOTH OBEY, and it is what makes the A/B honest: at 0 the seeded
   * stream must not be touched. Every roll either mechanic makes sits behind a
   * short-circuiting `NARROW > 0 &&` / `RAMP > 0 &&`, so at zero no random
   * number is drawn, the stream stays in phase, and the course is BIT-IDENTICAL
   * to the one this file generated before either mechanic existed. That is
   * checked rather than claimed -- tools/mechanics.js --identity compares a
   * SHA-1 of gates and aid across the whole calendar against a baseline taken
   * before the first line of this went in.
   *
   * LANE CLOSURE (NARROW) shuts one or two lanes for a few gates, which is the
   * archway-and-crates squeeze in reference/ttgr-archway-and-crates.png. It is
   * expressed as a BLOCK train in the closed lanes rather than as a new kind,
   * because that is exactly what it is: the closure has to be impassable, it
   * has to occupy the lane continuously, and the generator already knows how to
   * space, prove and render that.
   *
   * THE RAMP (RAMP) marks a BLOCK train RIDEABLE: its roof becomes a second
   * running surface, entered up the tailgate. That is
   * reference/ttgr-ramp-onto-truck.png, where the "ramp" is the bin lorry's own
   * hopper folded down to the road, one lane wide.
   *
   * The single most important property of the ramp, and the reason it cannot
   * break the fairness proof: A RIDEABLE BLOCK ONLY ADDS EDGES TO THE BFS. It
   * is never generated where a BLOCK train was not already legal, so every lane
   * path solvable() proved before it existed is still there, untouched, and the
   * roof is one more way through on top. solvable() therefore needs no change
   * at all and is not given one -- see the note above it.
   */
  // LANE CLOSURE IS ON. It shipped built, proved and switched off, and the
  // case for turning it on was re-measured on today's build over all 365 days
  // rather than taken from the document that recommended it:
  //
  //   NARROW=0   185.4 gates/course   0 degraded   1-lane gates  5.75%
  //   NARROW=1   184.1 gates/course   0 degraded   1-lane gates 10.26%
  //
  // Zero degraded gates, zero abandoned closures, zero invalid courses, 2630
  // closures over the calendar. The staleness document called it a tripling of
  // one-lane decisions; measured, it is 1.78x, and the honest number is the one
  // that goes in the comment. It costs 1.3 gates a course.
  let NARROW = 1;
  let RAMP = 1;

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
  /**
   * ---- SURGE ZONES: THE SAME MACHINERY, A DIFFERENT CAUSE -----------------
   *
   * A surge zone is a marked stretch of road where a runner in the marked lane
   * runs to MR.Pace.SURGE.FLOOR_SURGE instead of FLOOR_BASE. That is a locally
   * higher top speed, which is EXACTLY the problem the descent already posed
   * and which Elevation.windowExtra already solved -- so this is not a new
   * fairness argument, it is the existing one with a second cause bolted to the
   * same bolt.
   *
   * THE WINDOW WIDENS. IT DOES NOT SHRINK. That is the whole of rule 4 here:
   * difficulty comes from the allocation and from the price of a mistake, never
   * from a gate the player could not read. Inside a zone the generator is told
   * about the surge speed and spaces the gates for it, so the guaranteed
   * reaction window inside a surge is 739 ms against 741 ms in the shipped
   * game, and 764 ms everywhere outside one -- MORE forgiving by default, and
   * the tightness is the thing the player elects.
   *
   * ---- AND THE EXTRA IS READ OFF ELEVATION'S OWN TABLE, NOT RE-DERIVED ----
   *
   * The tempting version of this function re-runs elevation's forward sliding
   * window to find the steepest descent within one airborne reach, so it can
   * add the grade to the surge floor. That is a second implementation of the
   * one number the fairness proof turns on, and this project has paid for that
   * pattern before (see HAZARD_HALF_Z, which is duplicated and then guarded).
   *
   * It is not necessary, because windowExtra is INVERTIBLE. Elevation stores
   *
   *     extra(z) = SPAN_NUM / (FLOOR_PACE + GRADE_SPM * gmin(z)) - flatSpan
   *
   * so the effective local pace including the hill comes straight back out:
   *
   *     pace(z) = SPAN_NUM / (extra(z) + flatSpan)
   *
   * and a surge subtracts a CONSTANT number of seconds per mile from the floor,
   * so the surged local pace is pace(z) - (FLOOR_PACE - FLOOR_SURGE). One table,
   * one source, and nothing to keep in step. On flat ground extra(z) is 0 and
   * this returns 0.813 units -- the difference between a 20.66-unit airborne
   * span at 4:04/mi and the 19.84-unit span the window was cut for -- which
   * leaves the SAME 1.16-unit margin the flat course keeps today.
   */
  const SPAN_NUM = K.JUMP_TIME * K.UNITS_PER_MILE * K.TIME_SCALE;
  const FLAT_SPAN = SPAN_NUM / K.FLOOR_PACE;
  // How far BEHIND a zone the widening starts. A jump committed just short of
  // the entry line lands inside the zone, and although the runner is not yet
  // surging when they commit, the pad costs a few units and removes the need to
  // reason about the boundary at all. Same constant elevation looks forward by.
  const SURGE_PAD = 28;

  function surgeExtraAt(z, surges) {
    if (!surges || !surges.length) return 0;
    for (let i = 0; i < surges.length; i++) {
      const s = surges[i];
      if (z >= s.z0 - SURGE_PAD && z < s.z1) return s;
    }
    return 0;
  }

  function windowExtraAt(z, elev, surges) {
    const base = elev ? elev.windowExtra(z) : 0;
    if (!surgeExtraAt(z, surges)) return base;
    // The local pace the base window was cut for, hill included, recovered from
    // elevation's own table -- then the same hill at the surge floor.
    //
    // ---- THE DATUM IS THE FLOOR THE PLAYER RUNS AT OUTSIDE A ZONE --------
    //
    // This subtracted (K.FLOOR_PACE - FLOOR_SURGE) = 10 s/mi, on the argument
    // that ACTION_WINDOW and elevation's table are both cut against
    // K.FLOOR_PACE so this had to be as well, and that FLOOR_BASE -- being
    // SLOWER than the datum -- owed nothing because a runner outside a zone
    // needs less window than the course already gives them.
    //
    // The first half is right and the conclusion does not follow, and the
    // measurement is unambiguous. What the player is owed is not a span in the
    // generator's private units, it is TIME, and the time they are owed is the
    // time the ordinary road gives them. Under EFFORT the ordinary road runs
    // at FLOOR_BASE, so its guaranteed decide window is 761 ms. Widening for a
    // 10 s/mi lift when the lift the player actually takes is
    // 261 - 244 = 17 s/mi handed an elected surge 739 ms: the generator had
    // paid for four sevenths of the speed it sold. It was fair by the SHIPPED
    // game's 741 ms standard and 22 ms tighter than the road either side of
    // it, which is difficulty coming out of a reaction window rather than out
    // of the allocation -- exactly what rule 4 forbids and exactly what this
    // mechanic was told not to do. Widen the window, do not eat it.
    //
    // So the lift is measured from FLOOR_BASE. K.FLOOR_PACE stays the datum
    // that ACTION_WINDOW and elevation's table are cut against -- that part of
    // the old argument was correct and nothing here disturbs it. Only the SIZE
    // of the step is now the size of the step the runner takes.
    //
    // Measured after the change: 761 ms outside, 760 ms inside. The surge buys
    // no reaction time and costs none. What it costs is gates, which is where
    // a price belongs.
    const pace = SPAN_NUM / (base + FLAT_SPAN);
    const surged = pace - (MR.Pace.SURGE.FLOOR_BASE - MR.Pace.SURGE.FLOOR_SURGE);
    return Math.max(base, SPAN_NUM / surged - FLAT_SPAN);
  }

  function actionWindowAt(z, elev, surges) {
    return ACTION_WINDOW + windowExtraAt(z, elev, surges);
  }

  /**
   * ---- THE SECOND REASON GATE SPACING HAS A FLOOR -------------------------
   *
   * ACTION_WINDOW is the floor the ARM needs: two conflicting gates closer than
   * one airborne span would demand being in the air and on the ground at once.
   * That rule has been enforced from both ends since the generator was written.
   *
   * The EYE needs a floor too, and nobody had written it down. A hazard is a
   * solid object standing in the lane, so while it is in front of the lens it
   * hides whatever is behind it in that lane -- and the shipped camera makes
   * that absolute rather than approximate for one of the three kinds:
   * Collision.BOX puts a BLOCK's top at 2.80 and the resting eye, K.CAM_BASE_Y,
   * at 2.62. The sightline over a BLOCK never comes back down to the road, so a
   * hazard behind one in the same lane is not merely dim, it is at zero, at
   * every distance and every camera height the framing can afford. (Raising the
   * eye to clear it takes 4.8 units, which is a helicopter, not a chase camera.
   * That was measured before this was written.)
   *
   * So the only thing that gives the read back is passing the occluder. The
   * near gate leaves the lens once the eye has travelled its own distance, and
   * at that instant the far gate is (z_far - z_near) in front of the lens. For
   * the player to still have a full action window to answer it:
   *
   *     z_far - z_near  >=  actionWindow + K.CAM_BASE_BACK
   *
   * -- the chase distance is in there because the LENS is what does the seeing
   * and it sits K.CAM_BASE_BACK behind the runner the window is measured for.
   *
   * That is 25.35 units against an action floor of 21, so it binds only on the
   * tightest spacings the difficulty curve asks for, which is precisely where
   * the complaint came from: "when there are so many obstacles back to back it
   * makes it a tad tough to see what's ahead of you." Holding it makes gaps
   * BETWEEN gates always wider than the read window, so no gate can ever be the
   * tight occluder of another, and tools/shoot.js's BLANKS assertion passes by
   * construction rather than by luck -- the same bargain solvable() and
   * Elevation.validate() already make with their own invariants.
   *
   * It costs about 5% of the gates on a course and nothing at all in finish
   * time; see tools/simulate.js, which is unchanged to the second by it because
   * pace integrates over distance and not over gates.
   */
  function readWindowAt(z, elev, surges) {
    return actionWindowAt(z, elev, surges) + K.CAM_BASE_BACK;
  }

  /**
   * ---- WHERE THE SURGE ZONES GO, AND THE CONTRACT THEY OWE THE PLAYER -----
   *
   * Planned from the seed in Z SPACE, BEFORE A SINGLE GATE IS PLACED, for the
   * identical reason elevation is: actionWindowAt reads the zones, spacingAt
   * and solvable() both read actionWindowAt, and the generator calls both on
   * every gate. The ground and the markings have to exist before the road does.
   * Nothing here reads the gate table, so there is no cycle.
   *
   * THE NUMBERS, and they are the contract the markings must be built to:
   *
   *   COUNT       4 or 5 a course, mean 4.53 over 40 days.
   *   LENGTH      420 to 560 units, median 492. At the surge floor that is
   *               14.2 to 19.0 real seconds, and at BURN_UNITS = 140 it costs
   *               3.0 to 4.0 segments out of a pool that holds 4. THE LONGEST
   *               ZONE IS EXACTLY A FULL TANK, which is not a coincidence: the
   *               cap is set by the longest zone precisely so that no zone is
   *               unbuyable however well a player allocated. A smaller cap
   *               would be a cap secretly editing the course.
   *
   *               And the pool is deliberately too small for the road. 2205
   *               units of zone against 13.7 collectible items is 15.7
   *               segments wanted against 13.7 had -- you can afford about
   *               seven eighths of the marked road, and only by spending the
   *               guard. Which eighth you decline is the strategy.
   *   LANE        one lane, constant for the whole zone. It is never BLOCK
   *               inside the zone -- enforced in generate(), see the surge
   *               clause there -- so an elected surge is always completable and
   *               the price is that you must ACT at what is in front of you
   *               rather than dodge into a free lane.
   *   WINDOW      SURGE_SIGHT = 90 units. The entry marking must be legible
   *               from that far out and it is not a taste number: it is
   *               Elevation.SIGHT_MIN, the distance the terrain sweep already
   *               PROVES stays visible over every crest on every course. A
   *               contract written at 90 cannot be broken by a hill, by
   *               construction, and Elevation.validate() is the proof.
   *   f RANGE     0.15 to 0.90. The same window narrowRate and the ramp use,
   *               and for the same two reasons: START_GRACE owns the opening,
   *               and the last question of a race should not be a novelty.
   *   SEPARATION  no two zones within SURGE_SIGHT + 60 units, so one zone's
   *               entry marking is never read against another zone's paint.
   *
   * WHAT THE PLAYER CAN AND CANNOT KNOW AT THE COMMIT POINT. From 90 units out
   * they can read that a zone begins, which lane is marked, and how long it
   * runs. They can see roughly the first 90 units of road inside it. They
   * CANNOT see the rest, and that is the risk the owner asked for -- a surge is
   * bought before its contents are known. Measured: a zone carries 15.1 gates,
   * 2.7 of them are inside the sight line at the commit point, and 82% of the
   * road bought is past it. THAT IS THE BET.
   *
   * It is a fair bet, not a hidden one, and "fair" is a number rather than a
   * claim: the guaranteed decide window is 760 ms inside a zone at the surge
   * speed against 761 ms on the road either side of it. A surge buys no
   * reaction time and costs none. Run `node tools/risk.js --section zone` --
   * it fails the build if that ever stops being true, and it has caught the
   * mechanic taking 50 ms and then 22 ms already.
   */
  const SURGE_SIGHT = 90;
  const SURGE_LEN_MIN = 420, SURGE_LEN_MAX = 560;
  const SURGE_N_MIN = 4, SURGE_N_MAX = 5;
  const SURGE_F0 = 0.15, SURGE_F1 = 0.90;

  function planSurge(key) {
    if (!(MR.Pace.EFFORT > 0)) return [];
    const rnd = MR.rng.stream(key, 'surge/v1');
    const total = K.TOTAL_UNITS;
    const lo = SURGE_F0 * total, hi = SURGE_F1 * total;
    const zones = [];
    const want = rnd.int(SURGE_N_MIN, SURGE_N_MAX);
    const GAP = SURGE_SIGHT + 60;
    let guard = 0;
    while (zones.length < want && guard++ < 400) {
      const len = rnd.range(SURGE_LEN_MIN, SURGE_LEN_MAX);
      const z0 = rnd.range(lo, hi - len);
      const z1 = z0 + len;
      let clash = false;
      for (const s of zones) if (z1 + GAP > s.z0 && z0 - GAP < s.z1) { clash = true; break; }
      if (clash) continue;
      zones.push({ z0, z1, lane: rnd.int(0, 2), sight: SURGE_SIGHT });
    }
    zones.sort(function (a, b) { return a.z0 - b.z0; });
    // Numbered in running order, so the marking, the HUD and the report can all
    // name the same zone.
    for (let i = 0; i < zones.length; i++) zones[i].n = i + 1;
    return zones;
  }

  /** The zone covering z, or null. Zones never overlap, so a scan is exact. */
  function zoneAt(surges, z) {
    if (!surges) return null;
    for (let i = 0; i < surges.length; i++) {
      if (z >= surges[i].z0 && z < surges[i].z1) return surges[i];
    }
    return null;
  }

  /**
   * The zone whose marked lane a hazard at THIS gate line could stand in, or
   * null -- which is a different and larger question than zoneAt.
   *
   * A HAZARD IS NOT A PLANE AT z, IT IS A BOX, and the deepest one in the game
   * is a rideable train: 2 * halfZ * (1 + RAMP_SPAN_MAX * 0.9) = 42.5 units of
   * lorry, all of it FORWARD of the gate line because the box is nose-anchored.
   * A gate two units short of an entry line with a BLOCK in the marked lane
   * therefore stands 40 units of vehicle under the paint.
   *
   * The first version of the marked-lane rule tested the gate line and nothing
   * else. It was validate()'s new surge clause that found it, on 13 of 60 days
   * -- four of them a standing 3.9-unit BLOCK and one a 17.9-unit train -- and
   * it is exactly the defect reachOf was written for one invariant along. So
   * the rule is stated in the same currency the rest of this file uses: how far
   * the geometry reaches, not where its gate line is.
   */
  // A function rather than a const because HAZARD_HALF_Z and RAMP_SPAN_MAX are
  // declared further down this file, and a `const` here reads them at module
  // evaluation time -- which throws on the temporal dead zone and takes the
  // whole page with it. Derived on every call rather than cached, so a retune
  // of either cannot leave this stale.
  function surgeBody() {
    return 2 * HAZARD_HALF_Z[K.BLOCK] * (1 + RAMP_SPAN_MAX * 0.9);
  }

  function zoneBody(surges, z) {
    if (!surges) return null;
    const body = surgeBody();
    for (let i = 0; i < surges.length; i++) {
      if (z + body > surges[i].z0 && z < surges[i].z1) return surges[i];
    }
    return null;
  }

  /**
   * Every hazard collision box's half-depth, by kind.
   *
   * This is Collision.BOX[kind].halfZ and it is written twice, which is a
   * thing this file otherwise refuses to do. The reason: collision.js loads
   * AFTER this one, and course generation also runs headless in tools/
   * course-test.js and tools/simulate.js, where collision.js is not loaded at
   * all. Reading MR.Collision from here would work in the browser and crash
   * both proofs.
   *
   * So it is duplicated and then GUARDED: tools/shoot.js compares this against
   * the real MR.Collision.BOX in the live page, FOR EVERY KIND, and fails the
   * build if any of them disagree. A number nobody checks is how the last four
   * corrections in this project started -- and this was a scalar covering one
   * kind while the other two went unguarded, which is the same hole one size
   * smaller.
   */
  const HAZARD_HALF_Z = {
    [K.JUMP]: 0.52,
    [K.DUCK]: 0.30,
    [K.BLOCK]: 1.95,
  };

  /**
   * How far a gate's geometry reaches FORWARD of its own gate line, in units.
   *
   * A hazard is not a plane at z, it is a box, and a BLOCK train is a long one:
   * world.js builds it with span = 1 + train * 0.9. That matters here for one
   * reason only -- the sightline argument in readWindowAt turns on WHEN THE
   * OCCLUDER LEAVES THE LENS, and a box leaves the lens when its FAR face
   * passes it, not when its gate line does. Measuring gate line to gate line
   * credits a train with clearing the shot early, which is a large fraction of
   * the window it is being checked against.
   *
   * The first draft of this fix did exactly that, and it made the assertion pass.
   *
   * ---- THE BOX IS NOSE-ANCHORED, SO THE WHOLE OF IT IS FORWARD ----------
   *
   * This used to read halfZ * (2 * span - 1), which is what a box CENTRED on
   * the gate line reaches forward. Collision.BOX is anchored at its near face
   * now -- it spans [gate.z, gate.z + 2 * halfZ] so that contact fires when the
   * runner touches the geometry instead of 1.95 units inside it -- and a
   * nose-anchored box reaches 2 * halfZ * span, with nothing at all behind the
   * gate line. See the anchor note in collision.js.
   *
   * A standing BLOCK therefore charges 3.90 where it charged 1.95, and the
   * longest train charges 17.94 where it charged 15.99. That is the honest
   * number: the geometry really is in front of the eye for that distance, and
   * it always was -- what changed is that half of it used to be booked behind
   * the gate line where the audit never looked for it.
   *
   * ---- PER LANE, AND PER KIND, BECAUSE THAT IS WHAT THE AUDIT MEASURES ----
   *
   * This used to charge every gate the BLOCK depth whatever it carried. That
   * was safe but it was not what world.js builds or what shoot.js casts:
   * gateBoxes() gives each LANE its own box from Collision.BOX[kind], so a gate
   * holding two JUMPs and a DUCK occludes with a 0.52 box, not a 1.95 one, and
   * BLANKS measures it that way. Charging the deepest kind for a gate that has
   * no BLOCK in it bought spacing nothing was asking for.
   *
   * Occlusion is per lane -- a hazard hides what is behind it IN ITS OWN LANE
   * -- so the gap a gate owes the next one is set by its deepest lane, and the
   * span multiplier applies only to a BLOCK carrying a train, exactly as
   * gateBoxes applies it. The two now describe the same solid.
   */
  function reachOf(lanes, train) {
    let reach = 0;
    for (let l = 0; l < 3; l++) {
      const kind = lanes ? lanes[l] : K.BLOCK;
      const halfZ = HAZARD_HALF_Z[kind];
      if (!halfZ) continue;                     // CLEAR contributes nothing
      const span = (kind === K.BLOCK && train) ? 1 + train * 0.9 : 1;
      const r = 2 * halfZ * span;
      if (r > reach) reach = r;
    }
    return reach;
  }

  /**
   * ---- LANE OCCUPANCY, WHICH IS THE THING THIS FILE NEVER HAD -------------
   *
   * Every lane-reasoning part of this game reasoned AT GATE LINES: the proof,
   * the spacing floor, the telegraph mats, the bot, and -- fatally --
   * player.resolveGates, which is the only contact path and fires only at
   * gate.z. A BLOCK train is ONE gate carrying up to 17.9 units of vehicle, so
   * a player who was in a clear lane at the gate line and swerved a moment
   * later ran the whole length of a bus with nothing to touch. Measured on the
   * shipped generator: 4895 of 4895 trains over 365 days recorded no contact
   * at all.
   *
   * The owner's decision, made after being shown that and told plainly that
   * fixing it makes the game harder: "A vehicle you can see is a vehicle you
   * can hit."
   *
   * So a lane is now occupied over a Z RANGE, said ONCE, here, in the form the
   * collision test and the solver both read. The interval is not invented: it
   * is [gate.z, gate.z + 2 * halfZ * span], the same nose-anchored expression
   * reachOf uses, world.js's gateBoxes builds, ramp.js extrudes and
   * tools/shoot.js casts. There is one solid and five files describing it,
   * which is the only arrangement in which art cannot disagree with clearance.
   *
   * THE SPAN MULTIPLIER APPLIES TO EVERY BLOCK LANE IN THE GATE, not only to
   * the lane maybeTrain picked. That is not an approximation -- it is what
   * gateBoxes DRAWS, so it is what the player sees, and a collision volume
   * shorter than the art it stands for is the one direction fairness cannot
   * survive.
   *
   * ---- WHY solvable() STILL NEEDS NO CHANGE ------------------------------
   *
   * Because every span is CONTAINED IN ONE GATE INTERVAL, and that is
   * guaranteed rather than observed. spacingAt owes the next gate
   * readWindowAt + reachOf, and reachOf is the deepest span in the gate -- so
   * a vehicle's far face is at least readWindowAt (25.35 units, and more on a
   * descent) short of the next gate line. "Lane l is free at gate i" and "lane
   * l is unoccupied from gate i to gate i+1" are therefore the SAME statement,
   * which is exactly what the BFS has always assumed without being able to say
   * so.
   *
   * What is genuinely new is crossing THROUGH an occupied lane: a path that
   * goes lane 0 at gate i to lane 2 at gate i+1 passes through lane 1, and
   * lane 1 may have a lorry standing in it just past gate i. The player waits
   * for it to end and then crosses -- and the room to do that is the same
   * readWindowAt, against the LANE_TRANSIT units two lane changes cover.
   * validate() proves both, on every course, rather than leaving this
   * paragraph to be trusted.
   */
  const LANE_TRANSIT = 1.55 * K.LANE_CHANGE_TIME * MAX_SPEED;

  function buildSpans(gates, ramps) {
    const lanes = [[], [], []];
    const halfZ = HAZARD_HALF_Z[K.BLOCK];
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i];
      for (let l = 0; l < 3; l++) {
        if (g.lanes[l] !== K.BLOCK) continue;
        const mult = g.train ? 1 + g.train * 0.9 : 1;
        // The ramp OBJECT, not a boolean: the two ways of leaving a roof are
        // different events and telling them apart means knowing where the far
        // face is. Matched on the gate line because a lane holds at most one
        // span starting there.
        let ride = null;
        if (g.ramp === l && ramps) {
          for (const r of ramps) if (r.lane === l && r.z0 === g.z) { ride = r; break; }
        }
        lanes[l].push({ lane: l, z0: g.z, z1: g.z + 2 * halfZ * mult, gate: i, ride });
      }
    }
    return lanes;
  }

  /**
   * The span covering (z, lane), or null.
   *
   * Binary search rather than a scan, and the reason is that this is now on the
   * per-frame path: player.resolveDeck calls it for the runner's lane every
   * frame and for both neighbours on a bounce. Spans within a lane never
   * overlap -- see the containment argument above -- so the last span starting
   * at or before z is the only one that can cover it.
   */
  function spanAt(lanes, z, lane) {
    const list = lanes[lane];
    if (!list || !list.length) return null;
    let lo = 0, hi = list.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].z0 <= z) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (found < 0) return null;
    const s = list[found];
    return z < s.z1 ? s : null;
  }

  /**
   * ---- THE RIDEABLE ROOF, IN NUMBERS --------------------------------------
   *
   * DECK_Y IS NOT CHOSEN. It is Collision.BOX[BLOCK].yMax, the top of the
   * impassable box, which is the one height in this game that already means
   * "the surface of the thing standing in the lane". Picking a ramp height by
   * eye would have put art in charge of clearance, which rule 4 forbids, and
   * would have let the runner's feet float above or sink into the roof of the
   * very box the audit casts.
   *
   * It is written here and not read from MR.Collision for the same reason
   * HAZARD_HALF_Z is: collision.js loads AFTER this file, and generation runs
   * headless in tools/ where collision.js is not loaded at all. So it is
   * duplicated and then GUARDED -- tools/mechanics.js --guard compares the two
   * in the live page and fails, exactly as tools/lib/fairness.js already does
   * for HAZARD_HALF_Z.
   *
   * RAMP_RUN is the tailgate: how much of the train's depth is spent climbing.
   * 6.0 units is 0.21 s at race pace, which is about a stride and a half -- long
   * enough to read as a slope and short enough that the roof is most of the
   * ride.
   *
   * RAMP_SPAN is where the honest cost of this mechanic is, and it is worth
   * stating plainly rather than burying. A BLOCK train's depth is
   * 2 * halfZ * (1 + 0.9 * span) = 3.9 + 3.51 * span, so maybeTrain's biggest
   * train, span 4, is 17.9 units -- 0.63 s of roof at race pace, and 6.0 of
   * that is the ramp. The reference ride is nearer two seconds. Buying two
   * seconds needs span 14, and reachOf charges the whole depth against the gap
   * to the next gate, so a 14-span train also punches a 75-unit hole in the
   * course. The prototype takes the middle: span 8-11 is 32-43 units, a
   * 1.1-1.5 s ride, and tools/mechanics.js reports what the hole costs in gates
   * and in finish time rather than leaving it as a feeling.
   */
  const DECK_Y = 2.80;
  const RAMP_RUN = 6.0;
  const RAMP_SPAN_MIN = 8, RAMP_SPAN_MAX = 11;

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

  function spacingAt(f, rnd, z, elev, lanes, train, surges) {
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
    //
    // ...and it is readWindowAt, not actionWindowAt, because the floor answers
    // to the eye as well as to the arm and the eye asks for more. See the
    // derivation on readWindowAt. This is still the solver's own call with a
    // constant added, so a retune of the jump arc, the pace floor or the terrain
    // still moves both ends of the constraint together.
    //
    // reachOf is the gate BEHIND this gap -- how far its geometry sticks
    // forward past its own gate line. The eye is clear of it only once its rear
    // face has gone by, so the gap it owes the next gate is measured from there.
    // A gate whose deepest lane is a DUCK costs 0.30 of this; a standing BLOCK
    // costs 1.95; a four-span BLOCK train costs 15.99, and pays it rather than
    // being waved through on its gate line.
    // ---- AND THE WINDOW IS OWED WHERE THE NEXT GATE LANDS, NOT HERE ------
    //
    // This read readWindowAt(z, ...) alone, and z is the gate BEHIND the gap.
    // Everywhere the window varies smoothly -- elevation -- that is fine. A
    // surge zone is a STEP: the window jumps at z0, and a gate sitting just
    // short of the entry line with the next one landing inside was spaced for
    // the unsurged window and answered at the surge speed.
    //
    // SURGE_PAD = 28 was meant to cover it and cannot: gate intervals run to
    // 70.4 units over 60 days (median 31.4), so any interval above the pad
    // walks straight through the boundary. Measured before this fix, the
    // guaranteed decide window inside a zone had a FLOOR of 712 ms against a
    // 5th percentile of 739 ms -- the tail was entirely these boundary gates,
    // and 712 ms is tighter than anything this game has ever shipped. That is
    // a rule 4 failure and not a difficulty setting: the player elected a
    // surge and was handed a gate the course had not paid for.
    //
    // The fix is exact rather than a bigger pad. Space provisionally, then ask
    // what the window is where that lands, and take the larger. It converges
    // in one step and cannot oscillate: widening only ever pushes the gate
    // FORWARD, a zone is at least 420 units against a ~70-unit maximum
    // interval, so a gate pushed further can enter a zone and never leave one.
    // The forward look is taken ONLY when there are zones, and that is a
    // correctness requirement rather than a saving. Elevation's window is
    // SMOOTH and its own table already looks 28 units ahead, so re-evaluating
    // it here would change the spacing on hills for no reason -- and change it
    // at EFFORT = 0, where the course must stay bit-identical to the generator
    // that shipped (tools/mechanics.js --identity). At zero, `surges` is empty,
    // this returns `first`, and that is the old expression character for
    // character. The seeded draw is taken exactly once either way.
    const reach = reachOf(lanes, train);
    const first = Math.max(readWindowAt(z, elev, surges) + reach,
                           mean * rnd.range(0.84, 1.16));
    if (!surges || !surges.length) return first;
    return Math.max(first, readWindowAt(z + first, elev, surges) + reach);
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
    // ---- AND THE SECOND HAZARD ARRIVES EARLIER THAN IT DID ---------------
    //
    // The owner: *"Add a few more obstacles to the beginning of the game."*
    // Measured before it was changed, over 60 days, per mile:
    //
    //   opening 3 miles   4.88 gates/mi   6.26 hazards/mi   1.28 hazards/gate
    //   the rest (3-26)   7.43 gates/mi  17.56 hazards/mi   2.36 hazards/gate
    //
    // The opening was carrying 64% fewer hazards per mile than the rest of the
    // race, and mile 0 and mile 1 came in at 1.00 and 1.09 hazards per gate --
    // a road with one thing on it, every time, for two miles.
    //
    // The threshold below was the whole cause: at d < 0.18 every gate takes
    // exactly one hazard, and d does not clear 0.18 until mile 2.05.
    //
    // WHY THE FIX IS THIS AND NOT SPACING. spacingAt() would have added gates
    // rather than obstacles, and its mean feeds the solver's own floor -- so
    // tightening the opening moves the proof's window at the same time and
    // buys a fairness argument nobody asked for. The number of lanes occupied
    // AT a gate is the thing the owner actually named, it is bounded by the
    // same makeGate invariants as every other gate, and it does not touch the
    // spacing the read window is derived from.
    //
    // WHY IT IS NOT PUSHED TO ZERO. 0.09 lands at mile 0.69, so the first
    // two thirds of a mile still carries exactly one hazard per gate. That
    // stretch is the one the comment on difficulty() is about -- START_GRACE
    // plus a road that reads calmly is what lets a new player learn the lane
    // geometry -- and it is kept. What changes is miles 1 through 3, which
    // were coasting on a teaching argument that had stopped applying.
    //
    // `full` IS DELIBERATELY NOT TOUCHED. That dial is three-lane gates, which
    // FORCE an action; it opens at mile 1.4 at 10% and it can stay there. More
    // obstacles is what was asked for. More forced actions is a different and
    // harsher change, and it should be argued for on its own evidence.
    const nHaz = rnd.chance(full) ? 3
      : d < 0.09 ? 1
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
   * ---- LANE CLOSURE -------------------------------------------------------
   *
   * Shut one or two lanes for a few gates, so the road tapers to two lanes or
   * to one and opens back out. It is expressed as a BLOCK in the closed lanes
   * at every gate of the stretch, which is not a compromise -- it is what a
   * closure IS. It has to be impassable, it has to hold the lane for a
   * distance, and spacingAt, reachOf, solvable() and the renderer already agree
   * on exactly that object.
   *
   * WHAT MAKES IT SAFE IS NOT THIS FUNCTION. It is that the closed gate still
   * goes through the same solvable() retry as every other gate, so a closure
   * the BFS cannot get through is never emitted -- it is abandoned and the gate
   * is built normally. The proof is not extended, weakened or special-cased.
   *
   * WHAT MAKES IT FAIR IS ALSO NOT THIS FUNCTION, and it is worth being exact
   * about which claim is which. The surviving lane is rolled by makeGate like
   * any other, so it can carry a JUMP or a DUCK. That is not a trap: makeGate
   * never allows a BLOCK to take the last open lane, so whatever stands in the
   * corridor is passable WITH the right action -- which is the identical
   * bargain a three-hazard full-width gate already makes, and the game ships
   * 62% of those at the top of the difficulty curve. A one-lane corridor with a
   * JUMP in it asks the player to read ONE thing; a full-width gate asks them to
   * read three. The corridor is the easier of the two.
   *
   * The rate is deliberately low. This is a punctuation mark in a four-minute
   * race, not a texture.
   */
  function narrowRate(f) {
    // Never in the opening -- START_GRACE and the difficulty ramp already own
    // the first minute, and a new player meeting a closed road before they have
    // learned the lane geometry learns the wrong lesson. Never in the run-in
    // either: difficulty() saturates there on purpose and the last question of
    // a race should not be a corridor.
    if (f < 0.12 || f > 0.88) return 0;
    return 0.06 * NARROW;
  }

  function narrowPlan(rnd) {
    // TWO closed is the archway -- a single-lane corridor, and the case that
    // has to be argued for. ONE closed is the cone taper, the same event one
    // step milder, and it leaves the player a choice of two lanes throughout.
    const shut = rnd.chance(0.40) ? 2 : 1;
    const order = [0, 1, 2];
    for (let i = order.length - 1; i > 0; i--) {
      const j = rnd.int(0, i);
      [order[i], order[j]] = [order[j], order[i]];
    }
    return { closed: order.slice(0, shut).sort(), span: rnd.int(2, 4) };
  }


  /**
   * ---- THE PLACEMENT RULE, AND IT IS ONE SENTENCE LONG --------------------
   *
   * A BOTTLE STANDS BEHIND AN OBSTACLE, IN THAT OBSTACLE'S OWN LANE, AT A GATE
   * THAT ALSO OFFERS A LANE THROUGH FOR NOTHING.
   *
   * Every road item is laid AID_SETBACK past the rear face of a JUMP block or a
   * DUCK bar, in the same lane as that hazard, and only at a gate that leaves
   * some other lane CLEAR and leaves the aid lane open at the gate after. So
   * the only way to the bottle is over or under the thing standing in front of
   * it; declining is always free, because the empty lane is right there to be
   * taken instead; and paying once buys the item outright, because the gate
   * ahead is never allowed to shut the lane you just bought your way into.
   *
   * The owner's instruction: "Ensure waters and bananas are strategically
   * placed so that they have to go around an obstacle to get it."
   *
   * ---- WHAT WAS THERE BEFORE, AND WHY IT DID NOT DO THAT ------------------
   *
   * The old rule scored the open lanes and took the hardest one. That is a
   * RELATIVE test, and a relative test buys nothing when every candidate is
   * equally easy: at a gate whose three lanes are all clear it picks one at
   * random and the item is free. Half the pool was then scored the other way up
   * on purpose, into the EASIEST lane, which is free by construction. And the
   * item sat in the middle of the gap, 30 units of open road from anything, so
   * even a hard placement could be taken by dipping into the lane and coming
   * straight back out without clearing a thing.
   *
   * Measured on the shipped course by tools/aid.js, over 365 days, three ways:
   * 56% of items cost NOTHING at all over and above the cheapest line through
   * the course, and only 1% cost an extra action; four natural-line bots that
   * cannot see aid at all collected 64% of it between them; and a bot that
   * simply went and got everything finished in exactly the same time, with
   * exactly the same zero contacts, as one that ignored the lot. Aid was not a
   * decision. It was scenery that happened to pay.
   *
   * ---- WHY THE SETBACK IS SMALL, WHICH IS THE WHOLE MECHANISM -------------
   *
   * player.resolveAid is a LANE MATCH AT A POINT, and player.changeLane moves
   * `lane` on the same frame the input is served -- so any patch of road can be
   * reached by a swerve, and no placement can charge for anything if the player
   * has room to swerve into it. The only ground a hazard genuinely guards is
   * the ground DIRECTLY BEHIND ITSELF, because reaching that means being in the
   * lane at the gate line a moment earlier, which is where resolveGates fires.
   *
   * So the item is pushed right up against the back of the obstacle: the rear
   * face plus AID_SETBACK, which is 1.39 units behind a JUMP block and 0.95
   * behind a DUCK bar. At the fastest the runner ever goes that is 52 and 36
   * milliseconds -- two or three frames -- against the 0.075 s player.handle
   * makes a player wait between lane changes. The gap between two gates is
   * never less than 25.35 units, so the old placement had four hundred times
   * that much room to cut in over.
   *
   * This is measured rather than argued. tools/aid.js drives the real state
   * machine with a bot that takes the free lane at the gate and then swerves
   * for the bottle as fast as the input queue will serve it; on the old course
   * it collected 13 of 14 items for half a contact.
   *
   * AID_SETBACK is NOT a taste number and must not be tuned down to zero: the
   * bottle is 1.41 units tall and the DUCK bar's underside is at 1.41, so an
   * item laid inside a bar's own depth would interpenetrate the art. It is the
   * smallest offset that keeps the pickup clear of the geometry it stands
   * behind, and the frames it costs are the price of that.
   *
   * ---- THE RESCUE ARGUMENT, WHICH THIS RULE ANSWERS RATHER THAN DROPS -----
   *
   * The pool used to be split half hard and half easy, and the reason was real:
   * scoring every item for maximum difficulty produced a rescue mechanic only a
   * player who did not need rescuing could reach. 71% of items demanded an
   * action at the gate on BOTH sides, so aid was gated behind two consecutive
   * clean clears plus a lane change, asked of the one player whose defining
   * problem is that they cannot string two clean clears together.
   *
   * The fix for that was never "make half of it free". It was to stop asking
   * for a CHAIN. This rule charges exactly ONE action, at exactly ONE gate, and
   * explicitly forbids the gate ahead from asking for another -- so there is a
   * price and there is no compounding. A run fluffing 30% of the actions it
   * attempts still collects three quarters of the aid on the course; the table
   * is in tools/aid.js.
   *
   * ---- AND IT DOES NOT FIGHT THE ROOF ------------------------------------
   *
   * Roof aid, below, is the same rule one step further out: the price is the
   * mount rather than a jump, and the free lane is the road either side. It is
   * generated from its own stream and this loop never touches it.
   *
   * Nothing here can affect Course.solvable(). Aid reads the gate table and
   * writes nothing back, so the clean path of a player who ignores every bottle
   * on the course is the one the BFS proved, untouched.
   *
   * One item per aid point, never a cluster. An earlier version put out a
   * table of 3-5 bottles, which fired five pickups inside a second and a half
   * and read as a single smear rather than as a decision.
   *
   * Sparse early and dense late, with fruit getting commoner as the race goes
   * on. A run is rarely broken in the first mile; the back half is where the
   * wall is, where the streak is worth most, and where a rescue is worth
   * having.
   */
  const AID_SETBACK = 0.35;
  // How far the placement may hunt forward for a gate of the right shape before
  // giving the point up. Bounded so aid cannot migrate far from where the
  // density curve wanted it, and so a stretch with no qualifying gate cannot
  // silently swallow every item behind it. Eight gates is about 250 units.
  const AID_WALK = 8;

  /**
   * The lane an item may stand in behind gate `gi`, or -1 if this gate is the
   * wrong shape.
   *
   * Three conditions, and each one is a clause of the rule above:
   *
   *   the gate leaves some lane CLEAR   -- or nothing is being given up, and a
   *                                        full-width gate demands an action in
   *                                        every lane anyway, so the aid lane
   *                                        would cost exactly nothing extra
   *   the aid lane holds a JUMP or DUCK -- the obstacle the bottle stands behind
   *   the next gate does not BLOCK it   -- paying once buys it outright, and the
   *                                        player is never trapped in the lane
   *                                        they bought
   *
   * A BLOCK can never be the obstacle: it is impassable, so an item behind one
   * is aid dangled somewhere the player is not allowed to go. That is the same
   * exclusion the old `open` test made, stated as a consequence of the rule
   * rather than as a separate guard.
   */
  function aidLaneAt(gates, gi, rnd) {
    const g = gates[gi];
    if (!g.lanes.some(function (l) { return l === K.CLEAR; })) return -1;
    const next = gi + 1 < gates.length ? gates[gi + 1].lanes : [K.CLEAR, K.CLEAR, K.CLEAR];
    const cands = [];
    for (let l = 0; l < 3; l++) {
      if (g.lanes[l] !== K.JUMP && g.lanes[l] !== K.DUCK) continue;
      if (next[l] === K.BLOCK) continue;
      cands.push(l);
    }
    if (!cands.length) return -1;
    // Prefer a lane that is CLEAR on the way out over one that merely is not
    // BLOCK, so "paying once buys it outright" holds wherever the course can
    // afford it. Ties break from the seeded stream, so a course still varies.
    let lane = cands[0], best = -Infinity;
    for (const l of cands) {
      const score = (next[l] === K.CLEAR ? 2 : 0) + rnd.next();
      if (score > best) { best = score; lane = l; }
    }
    return lane;
  }

  function generateAid(key, gates, ramps) {
    // v4: the placement rule changed, so the stream is renamed rather than
    // silently reused. tools/mechanics.js hashes gates and aid SEPARATELY now
    // for exactly this reason -- the gate stream is untouched and stays
    // bit-identical, and only the aid baseline moves.
    const rnd = MR.rng.stream(key, 'aid/v4');
    const items = [];
    if (!gates.length) return items;

    /**
     * ---- WHY THERE IS ANYTHING ON THE ROOF AT ALL --------------------------
     *
     * Without this the ramp is STRICTLY DOMINATED and the whole mechanic is
     * dead, which is a thing measurement said and intuition did not.
     *
     * Riding a roof pays the same one clean gate that going round the lorry
     * pays -- the streak does not care which way you got past it -- and it
     * charges a real price on top: you cannot change lane for the length of the
     * vehicle, leaving sideways costs the streak, and 10% of ramps put a BLOCK
     * in the lane you fall back into. A rational player would never take it.
     * The reference frame says the same thing in pictures: the gold bars along
     * the top of the bin lorry are not decoration, they are the reason to be up
     * there.
     *
     * So the roof carries aid, and aid is exactly the right currency for it.
     * The mechanic it plugs into is already built as a trade -- see the long
     * note in the placement loop below: half the pool is scored into the
     * HARDEST legal lane so a strong run has something to go and get, and half
     * is scored into the easiest so a broken run has a road back. A roof is the
     * hardest legal lane there is. It also makes the ramp worthless to a
     * perfect run, which is correct and is the same shape as AID_CEILING: a
     * flawless line is already above the ceiling and gains nothing from a
     * bottle, so the ramp becomes what aid is -- the way back into a race you
     * are losing, not a faster way to win one.
     *
     * Its own seeded stream, so switching the ramp on cannot shift a single
     * road-level item; and skipped entirely when there are no ramps, so at
     * RAMP = 0 no number is drawn at all.
     */
    if (ramps && ramps.length) {
      const rr = MR.rng.stream(key, 'aid/roof/v1');
      for (const r of ramps) {
        // The middle of the FLAT roof, never on the tailgate: an item on the
        // slope would be collected on the way up whatever the player decided,
        // which is not a trade.
        const flat0 = r.z0 + r.run;
        const z = flat0 + (r.z1 - flat0) * 0.5;
        const fruit = rr.chance(0.55);
        // `y` IS THE INTERFACE TO THE ART, and it is carried on the item rather
        // than recomputed by the renderer. A roof pickup drawn at road level is
        // drawn INSIDE the lorry -- which is what shipped, and is invisible in a
        // diff because nothing in course space was wrong. It is height above the
        // LOCAL ROAD, the same quantity player.surface and camera.dk are, so
        // world.js adds it exactly where it already adds elevation.at(z).
        //
        // Only roof items carry it: adding a y: 0 to every road item would
        // change the aid JSON and break the identity hash for no gain.
        const roof = { z, lane: r.lane, y: DECK_Y, guarded: true, roof: true };
        items.push(fruit
          ? Object.assign(roof, { kind: 'banana', gain: K.AID_BANANA })
          : Object.assign(roof, { kind: 'water', gain: K.AID_WATER }));
      }
    }

    let gi = 0;
    let lastHg = -1;   // the gate the previous item hung off
    let z = START_GRACE + rnd.range(200, 340);
    const end = K.TOTAL_UNITS - FINISH_GRACE - 60;
    let guard = 0;

    while (z < end && guard++ < 4000) {
      while (gi < gates.length - 1 && gates[gi + 1].z < z) gi++;

      // Hunt forward from here for a gate of the right shape. The density curve
      // below decides ROUGHLY where an aid point goes; the rule decides exactly
      // which gate it hangs off, and a point with no qualifying gate within
      // AID_WALK is given up rather than dropped somewhere free.
      //
      // ---- THREE BOUNDS, AND ALL THREE WERE MISSING FIRST TIME ------------
      //
      // NEVER BEFORE THE PREVIOUS ITEM'S GATE. The hunt starts at the gate
      // BEHIND the target z, so the placement can pull an item backwards by up
      // to one gap. Left alone that can order two items the wrong way round or
      // stack them on one gate. Starting at lastHg + 1 makes the gate index
      // strictly increasing, so z is too, and the sort at the end has nothing
      // left to do.
      //
      // NEVER PAST THE END. `end` bounds where an aid POINT may be asked for,
      // and the hunt can carry the item eight gates -- about 250 units -- past
      // wherever that was. On the last point of the course that walks straight
      // through the tape. The exact class of defect the ramp's run-in had, and
      // the exact reason this file's sweeps run at 365 days.
      let hg = -1, lane = -1;
      for (let k = Math.max(gi, lastHg + 1); k < gates.length - 1 && k < gi + AID_WALK; k++) {
        if (gates[k].z > end) break;
        const l = aidLaneAt(gates, k, rnd);
        if (l >= 0) { hg = k; lane = l; break; }
      }
      if (hg >= 0) {
        const g = gates[hg];
        // Behind the obstacle: its rear face, from the SAME nose-anchored
        // expression reachOf, buildSpans and world.js's gateBoxes all use, so
        // the bottle can never end up inside the thing it stands behind.
        //
        // ASSIGNED, NOT MAXED. This was Math.max(z, ...) so that an item could
        // never move backwards, and the cost of that was the whole rule: where
        // the target z already sat past the gate the item simply stayed there,
        // 46 units downstream, behind nothing at all. Monotonicity is the
        // hunt's job now, above, and the placement's only job is to be behind
        // the obstacle.
        lastHg = hg;
        z = g.z + 2 * HAZARD_HALF_Z[g.lanes[lane]] + AID_SETBACK;
        const f2 = z / K.TOTAL_UNITS;
        const fruit = rnd.chance(0.12 + 0.46 * f2 * f2);
        // `gate` IS THE INTERFACE TO THE COLLECTION TEST, and it is carried on
        // the item for the same reason the roof item carries `y`: the rule has
        // to travel with the thing it governs, or the renderer and the player
        // are left to rediscover it. player.resolveAid pays a guarded item out
        // to a runner who was in `lane` when gate `gate` resolved, cleanly or
        // not -- see the long note there for why a lane match at a point cannot
        // do this job.
        //
        // Every road item is guarded now: that is the rule, so the flag is a
        // constant rather than a score. It is kept because the roof items carry
        // it and the two should describe themselves the same way.
        items.push(fruit
          ? { z, lane, gate: hg, kind: 'banana', gain: K.AID_BANANA, guarded: true }
          : { z, lane, gate: hg, kind: 'water', gain: K.AID_WATER, guarded: true });
      }

      // Sparse early, dense late. Aid exists to rescue a broken run, and a run
      // is rarely broken in the first mile, so the opening stays clean and the
      // back half -- where the wall is and where the streak is worth most --
      // carries most of the help.
      //
      // Read off z AFTER the placement has moved it, not before: the hunt above
      // can carry a point forward by up to AID_WALK gates, and pacing the next
      // one off where this one was WANTED rather than where it LANDED would let
      // two items stack up behind a single dense stretch.
      const spacing = 620 - 400 * (z / K.TOTAL_UNITS);
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
      // L = 280 is chosen to match the spike rather than to look good: the
      // Gaussian has sigma 0.055, so the wall band is roughly z 4460-5140 and a
      // hill of this half-length spans 4521-5081. The climb and the density
      // peak arrive together and the descent lands exactly as the gates thin.
      mandate: [{ z: 0.763 * K.TOTAL_UNITS, L: 280 }],
    };
  }

  function generate(key) {
    // ELEVATION FIRST, AND THE ORDER IS THE POINT. actionWindowAt() reads the
    // profile, spacingAt() and solvable() both read actionWindowAt(), and the
    // generator calls both on every gate -- so the ground has to exist before
    // the first gate is placed. Elevation reads nothing back from the course.
    const elevation = MR.Elevation.create(key, elevationPlan());
    // ...and the surge zones for the same reason and in the same breath. Both
    // are statements about the ROAD that the gates then have to answer to, and
    // both are drawn from their own seeded stream so that at EFFORT = 0 (where
    // planSurge returns an empty list without drawing a number) the course
    // stream stays in phase and every gate is bit-identical.
    const surges = planSurge(key);

    const rnd = MR.rng.stream(key, 'course/v1');
    const gates = [];

    // trainUntil[lane] = gate index (exclusive) that lane stays blocked to.
    const trainUntil = [-1, -1, -1];

    let z = START_GRACE;
    const end = K.TOTAL_UNITS - FINISH_GRACE;
    let guard = 0;

    // Instrumentation the generator has never kept, and the reason it is here
    // is rule 3 rather than curiosity. generate() CANNOT return an unsolvable
    // course: when 24 attempts fail it degrades to an all-clear gate. So
    // "solvable on all 365 days" is true by construction and proves nothing
    // about whether a new mechanic damaged the course -- the damage would show
    // up as the generator giving up more often, and nothing counted that.
    const tally = { degraded: 0, attempts: 0, narrowings: 0, narrowAbandoned: 0 };

    // A closure in flight: the lanes it holds shut, and the gate index it runs
    // to. Deliberately the same shape as trainUntil, because it is the same
    // thing -- see the note on narrowPlan.
    let narrowClosed = null;
    let narrowUntil = -1;
    const ramps = [];

    while (z < end && guard++ < 20000) {
      const f = z / K.TOTAL_UNITS;
      const idx = gates.length;

      if (idx >= narrowUntil) narrowClosed = null;
      // Open a closure. Never on top of a train -- a train already owns a lane
      // for a span, and stacking the two is how all three lanes get shut.
      if (NARROW > 0 && !narrowClosed && trainUntil.every((t) => idx >= t)
          && rnd.chance(narrowRate(f))) {
        const plan = narrowPlan(rnd);
        narrowClosed = plan.closed;
        narrowUntil = idx + plan.span;
        tally.narrowings++;
      }

      let lanes = null;
      // Retry until this gate keeps the course solvable.
      //
      // The closure is applied INSIDE the retry and is the first thing dropped
      // when the retry fails, so it can never be the reason a gate degrades.
      for (let pass = 0; pass < 2 && !lanes; pass++) {
        // pass 0 honours the closure; pass 1 runs only if the closure could not
        // be made to work, and abandons it.
        const closed = pass === 0 ? narrowClosed : null;
        if (pass === 1 && narrowClosed) { narrowClosed = null; tally.narrowAbandoned++; }
        for (let attempt = 0; attempt < 24; attempt++) {
          const cand = makeGate(rnd, f);

          // Carry active trains through.
          for (let l = 0; l < 3; l++) if (idx < trainUntil[l]) cand[l] = K.BLOCK;
          // Then the closure, which outranks the roll: the lanes it shuts are
          // shut, and the lanes it leaves open may not be BLOCK, or the gate
          // would have no way through at all.
          if (closed) {
            for (const l of closed) cand[l] = K.BLOCK;
            for (let l = 0; l < 3; l++) {
              if (closed.indexOf(l) < 0 && cand[l] === K.BLOCK) cand[l] = K.CLEAR;
            }
          }
          // ---- THE MARKED LANE IS NEVER A WALL ---------------------------
          //
          // Last, so it outranks the roll, the carried train and the closure
          // alike. A surge is elected by taking the marked lane, and the one
          // thing that must never happen is a player who bought a surge, and
          // could not see inside it, meeting a lorry they are not allowed to
          // pass -- that is not risk, it is the game taking a run for a fact it
          // hid. So the marked lane holds a JUMP or a DUCK instead, drawn from
          // the same weighted roll every other lane uses with BLOCK off the
          // table. It stays DEMANDING; it stops being IMPASSABLE. What the
          // player is buying is the obligation to act rather than dodge.
          //
          // Forcing it open can only ADD a lane path, so it cannot cost
          // solvable() a proof, and it makes the all-BLOCK guard below
          // unreachable for an in-zone gate rather than merely unlikely.
          const zn = zoneBody(surges, z);
          if (zn && cand[zn.lane] === K.BLOCK) cand[zn.lane] = rollHazard(rnd, difficulty(f), false);
          if (cand.every((l) => l === K.BLOCK)) continue;

          tally.attempts++;
          const trial = gates.concat([{ z, lanes: cand, f }]);
          if (solvable(trial, elevation, surges)) { lanes = cand; break; }
        }
        if (!closed) break;   // pass 0 had no closure to drop, so pass 1 is moot
      }
      if (!lanes) {
        // Degrade to a guaranteed-safe gate rather than emit something unfair.
        lanes = [K.CLEAR, K.CLEAR, K.CLEAR];
        for (let l = 0; l < 3; l++) if (idx < trainUntil[l]) lanes[l] = K.BLOCK;
        // The degrade path owes the marked lane the same promise the retry
        // does, and CLEAR is the right answer here rather than a rolled hazard:
        // this gate exists because the generator gave up, and a gate it gave up
        // on should not also be the one that asks the most.
        const zd = zoneBody(surges, z);
        if (zd) lanes[zd.lane] = K.CLEAR;
        tally.degraded++;
      }

      let span = maybeTrain(rnd, f, lanes);
      let rampLane = -1;
      if (span) {
        for (let l = 0; l < 3; l++) {
          if (lanes[l] === K.BLOCK && trainUntil[l] <= idx) {
            // NO TRAIN CHECK IS NEEDED HERE, and that is worth saying so
            // nobody adds one back. maybeTrain only offers a lane that is
            // already BLOCK, and the marked-lane clause in the retry above has
            // made the marked lane non-BLOCK for every gate within SURGE_BODY
            // of a zone -- which is the deepest vehicle the game can build. So
            // a train can no more start under the paint than a standing taxi
            // can, and both facts come from ONE rule rather than two that have
            // to be kept in step.
            // Only extend if some other lane survives the whole span.
            const others = [0, 1, 2].filter((x) => x !== l);
            if (others.some((o) => idx >= trainUntil[o])) {
              // ---- THE RIDEABLE ROOF -------------------------------------
              //
              // Marked here and nowhere else, and the placement is the whole
              // safety argument: this line runs only inside the branch that has
              // ALREADY established a BLOCK train is legal in this lane with
              // another lane surviving its whole span. So a ramp is never the
              // reason a lane is blocked. It is a second way through a wall the
              // course was going to build anyway, which is why solvable() is
              // sound without being touched.
              //
              // Not inside a closure: a closure is already a corridor, and
              // putting the one way through on a roof would make the roof
              // compulsory rather than optional. That is the difference between
              // an option and a tax.
              // ---- AND NOT IN THE RUN-IN, WHICH THE CALENDAR HAD TO SAY ----
              //
              // The same window narrowRate uses, and it is here because a
              // 365-day sweep failed and a 90-day one did not. On 2026-12-02 a
              // ramp was generated at f = 0.991, so its roof ran to within 3.0
              // units of the tape: the runner would have crossed the finish
              // line mid-fall, through the run-in that world.js's finale spends
              // on a clear-tarmac camera move, with no gate after it for the
              // fall to be measured against at all. The opening is excluded for
              // the reason START_GRACE exists, and the closing half-mile
              // because the last question of a race should not be a novelty.
              if (RAMP > 0 && !narrowClosed && f > 0.12 && f < 0.90
                  && rnd.chance(0.34 * RAMP)) {
                span = rnd.int(RAMP_SPAN_MIN, RAMP_SPAN_MAX);
                rampLane = l;
              }
              // ---- SPAN MEANS TWO DIFFERENT THINGS, AND A RAMP SPLITS THEM --
              //
              // `train` is a DEPTH multiplier -- reachOf and world.js's
              // gateBoxes both read it as 2 * halfZ * (1 + 0.9 * span), so
              // span 4 is 17.9 units of vehicle. `trainUntil` is a COUNT OF
              // GATES the lane stays shut for, and at a spacing floor of 43
              // units that same span 4 shuts the lane for about 150. The two
              // numbers have never been the same quantity; for an ordinary
              // train that is harmless, because it just means a long vehicle
              // followed by a short convoy.
              //
              // For a ramp it is fatal, and the frame says so before the
              // arithmetic does: the roof ends at the train's far face, the
              // player falls back to the road -- and lands in the next BLOCK
              // that trainUntil is still holding in that lane. The reward for
              // taking the ramp would be a wall.
              //
              // So a rideable train buys its DEPTH and does not buy the
              // following gates. The lane is shut at this gate, by this gate's
              // own BLOCK, and is clear the moment the vehicle ends. That is
              // strictly fewer blocked lane-slots than the generator would
              // otherwise have laid down, so it cannot cost solvable() a path.
              if (rampLane < 0) trainUntil[l] = idx + span;
            }
            break;
          }
        }
      }

      const gate = { z, lanes, f, train: span };
      if (narrowClosed) gate.narrow = narrowClosed.slice();
      if (rampLane >= 0) {
        gate.ramp = rampLane;
        ramps.push({
          lane: rampLane,
          z0: z,
          // The far face of the train, from the SAME expression reachOf and
          // world.js's gateBoxes use. Written once here rather than restated,
          // because a roof that ends somewhere other than where the box ends is
          // a runner standing on air or inside a lorry.
          z1: z + 2 * HAZARD_HALF_Z[K.BLOCK] * (1 + span * 0.9),
          run: RAMP_RUN,
          deck: DECK_Y,
        });
      }
      gates.push(gate);
      // The LANES and the span both go in because the gap after a gate is owed
      // by the geometry of THAT gate: which kinds it actually stands in the road
      // decides how deep its deepest lane is, and a train's rear face is a long
      // way further forward than its gate line says.
      z += spacingAt(f, rnd, z, elevation, lanes, span, surges);
    }

    const mileMarkers = [];
    for (let m = 1; m <= 26; m++) mileMarkers.push({ mile: m, z: m * K.UNITS_PER_MILE });
    mileMarkers.push({ mile: K.MARATHON_MILES, z: K.TOTAL_UNITS, finish: true });

    const aid = generateAid(key, gates, ramps);
    const spans = buildSpans(gates, ramps);
    const course = { key, gates, aid, mileMarkers, biomes: BIOMES, length: K.TOTAL_UNITS,
                     elevation, ramps, spans, surges, tally };

    /**
     * The zone the runner is in, or null. Read by the renderer to lay the
     * marking, by the HUD to say a zone is coming, and by main.js every frame
     * to decide whether the runner has elected the surge.
     */
    course.surgeZoneAt = function (z) { return zoneAt(surges, z); };

    /**
     * THE ELECTION, AND IT IS ONE LINE. A surge is on when the runner is inside
     * a zone AND in its marked lane. There is no button, no hold and no new
     * verb: the swipe the player already knows is the whole commitment, which
     * is why a new control was refused -- every control in this game is a swipe
     * anywhere on the canvas, so a button sits exactly where a mis-started
     * swipe lands.
     *
     * Not on a roof: a rideable train is a different running surface and the
     * marking is painted on the road. Trains are kept out of marked lanes at
     * generation (see the TRAIN_LOOK clause) so this is belt and braces.
     */
    course.surgeAt = function (z, lane, onDeck) {
      if (onDeck) return null;
      const s = zoneAt(surges, z);
      return s && s.lane === lane ? s : null;
    };

    /**
     * The vehicle standing in (z, lane), or null.
     *
     * THE ONE ANSWER TO "is this lane occupied here", read by the collision
     * test, the bot and the instrument. Every BLOCK is in here, rideable or
     * not -- a lane closed by a standing taxi is as solid as one closed by a
     * lorry, and the game used to guard neither past its gate line.
     */
    course.occupiedAt = function (z, lane) { return spanAt(spans, z, lane); };

    /**
     * The height of the running surface at (z, lane): 0 on the road, DECK_Y on
     * a roof, and the slope in between.
     *
     * This is the whole of the ramp's world model and it is deliberately a pure
     * function of the course rather than a property of a mesh. The runner, the
     * camera, the collision test and the instrument all read THIS, so there is
     * exactly one answer to "how high is the ground here" and art cannot
     * disagree with it. Same contract as MR.Collision.BOX, same reason.
     *
     * Zero over a vehicle that is NOT rideable, and that distinction is the
     * whole difference between a roof and a wall: occupiedAt says the lane is
     * solid, deckAt says whether anything up there can be stood on.
     *
     * Flat and constant-zero when no ramp was generated, which is every course
     * at RAMP = 0 -- so nothing downstream needs a null check and nothing
     * downstream changes behaviour.
     */
    course.deckAt = function (z, lane) {
      const s = spanAt(spans, z, lane);
      if (!s || !s.ride) return 0;
      const up = z - s.ride.z0;
      return up < s.ride.run ? s.ride.deck * (up / s.ride.run) : s.ride.deck;
    };

    /**
     * The ramp covering (z, lane), or null. The player needs the OBJECT and not
     * just the height, because the two ways of leaving a roof are not the same
     * event -- running off the front is a dismount and swerving off the side is
     * a fall -- and telling them apart means knowing where the front is.
     */
    course.rampAt = function (z, lane) {
      const s = spanAt(spans, z, lane);
      return s ? s.ride : null;
    };

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
  function solvable(gates, elev, surges) {
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
            && g.z - s.z < actionWindowAt(s.z, elev, surges)) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < actionWindowAt(az, elev, surges) ? 1 : 0);
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
    const surges = course.surges;
    for (let i = 0; i < g.length; i++) {
      if (g[i].lanes.every((l) => l === K.BLOCK)) errors.push(`gate ${i}: all lanes blocked`);
      if (i > 0 && g[i].z <= g[i - 1].z) errors.push(`gate ${i}: not ordered in z`);
      if (i > 0 && g[i].z - g[i - 1].z < 18) errors.push(`gate ${i}: spacing ${(g[i].z - g[i - 1].z).toFixed(1)} too tight`);
      // THE SIGHTLINE FLOOR, PROVED RATHER THAN TRUSTED.
      //
      // spacingAt() enforces this when it lays the gates down; this checks the
      // finished course, so course-test.js re-proves it on 90 days of real
      // courses every run rather than leaving it to the seven frames
      // tools/shoot.js happens to capture. Same bargain as solvable(): the
      // generator makes it true, validate() refuses to ship a course where it
      // is not. See readWindowAt for why the number is what it is.
      //
      // The epsilon is float slop only -- spacingAt returns this quantity
      // exactly when the floor binds, which late in a course is most gates.
      if (i > 0) {
        const need = readWindowAt(g[i - 1].z, elev, surges) + reachOf(g[i - 1].lanes, g[i - 1].train);
        if (g[i].z - g[i - 1].z < need - 1e-9) {
          errors.push(`gate ${i}: ${(g[i].z - g[i - 1].z).toFixed(2)} behind gate ${i - 1} `
            + `needs ${need.toFixed(2)} to stay readable past it`);
        }
        // ---- THE FLANK IS SOLID, SO THE PROOF OWES ONE MORE THING --------
        //
        // solvable() proves a sequence of LANES AT GATE LINES and says nothing
        // about the ground between them, which was fine while a lane was only
        // guarded where the plane was. It is not fine now. Two facts have to
        // hold for every BFS edge to stay physically walkable:
        //
        //   1. No vehicle reaches the next gate line, or a lane the proof
        //      called free at that gate has a lorry standing in it. This is
        //      strictly implied by the sightline floor above -- readWindowAt is
        //      positive -- but it is the assumption solvable() rests on and it
        //      is worth failing loudly rather than by implication.
        //   2. There is room to CROSS an occupied lane after its vehicle ends:
        //      going from lane 0 to lane 2 passes through lane 1, and lane 1 is
        //      solid for reachOf units past the gate. LANE_TRANSIT is the
        //      ground two lane changes cover at the pace floor, derived from
        //      K.LANE_CHANGE_TIME and changeLane's own 0.55 re-arm rather than
        //      typed, so a retune of either moves this with it.
        //
        // This is the assertion that fails first if anyone lowers the sightline
        // floor, the jump arc or the pace floor, because readWindowAt is
        // derived from all three and this is what is left of it.
        const clear = g[i].z - (g[i - 1].z + reachOf(g[i - 1].lanes, g[i - 1].train));
        if (clear < LANE_TRANSIT - 1e-9) {
          errors.push(`gate ${i - 1}: only ${clear.toFixed(2)} of clear road past its deepest `
            + `vehicle before gate ${i}, and crossing an occupied lane needs ${LANE_TRANSIT.toFixed(2)}`);
        }
      }
    }
    // ---- THE SURGE CONTRACT, PROVED RATHER THAN COMMENTED -----------------
    //
    // Three claims are made about a zone in prose above, and prose is what
    // rule 3 of CLAUDE.md is about. Each is checked here on every course, so
    // course-test.js at 365 days and calendar.js re-prove them on every run
    // instead of leaving them to the four days a policy sweep happens to use.
    //
    //   1. THE MARKED LANE IS PASSABLE AT EVERY GATE IN THE ZONE. A player who
    //      bought a surge they could not see inside must never meet a wall in
    //      the lane they bought.
    //   2. NO VEHICLE STANDS IN IT ANYWHERE IN THE ZONE, gate line or not.
    //      Claim 1 is about gate lines; occupiedAt is about the 3.9 to 17.9
    //      units of solid a BLOCK really is, and the flank is contact now.
    //   3. THE ENTRY IS READABLE. SURGE_SIGHT units of road before z0, inside
    //      the course, so the marking has somewhere to be seen from.
    if (surges && surges.length) {
      const spans = course.spans;
      for (const s of surges) {
        if (s.z0 < SURGE_SIGHT) {
          errors.push(`surge ${s.n}: starts at ${s.z0.toFixed(0)}, inside its own `
            + `${SURGE_SIGHT}u sighting distance`);
        }
        for (let i = 0; i < g.length; i++) {
          if (g[i].z < s.z0 || g[i].z >= s.z1) continue;
          if (g[i].lanes[s.lane] === K.BLOCK) {
            errors.push(`surge ${s.n}: gate ${i} blocks the marked lane ${s.lane}`);
          }
        }
        if (spans) {
          for (const sp of (spans[s.lane] || [])) {
            if (sp.z1 > s.z0 && sp.z0 < s.z1) {
              errors.push(`surge ${s.n}: a vehicle occupies the marked lane from `
                + `${sp.z0.toFixed(1)} to ${sp.z1.toFixed(1)}`);
            }
          }
        }
      }
      for (let i = 1; i < surges.length; i++) {
        if (surges[i].z0 - surges[i - 1].z1 < SURGE_SIGHT) {
          errors.push(`surge ${surges[i].n}: only `
            + `${(surges[i].z0 - surges[i - 1].z1).toFixed(0)}u after surge ${surges[i - 1].n}`);
        }
      }
    }
    if (!solvable(g, elev, surges)) errors.push('course has no solvable lane path');
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

  const api = { generate, generateAid, validate, solvable, biomeAt, difficulty,
           BIOMES, SETTINGS, pickSettings, ACTION_WINDOW, actionWindowAt,
           // Exported so tools/shoot.js reads the read window from the file
           // that enforces it instead of recomputing the same sum. The two
           // cannot drift, which is the whole point of the invariant.
           READ_NEAR: ACTION_WINDOW + K.CAM_BASE_BACK, readWindowAt,
           HAZARD_HALF_Z, reachOf,
           DECK_Y, RAMP_RUN, LANE_TRANSIT,
           // The surge-zone contract, exported so the renderer and the tools
           // read the numbers from the file that enforces them rather than
           // restating them. SURGE_SIGHT is the one the art has to build to.
           SURGE_SIGHT, SURGE_LEN_MIN, SURGE_LEN_MAX, planSurge, windowExtraAt,
           elevationPlan };

  // Accessors rather than plain fields, so a nonsense value cannot be written
  // and the clamp lives with the flag. Same shape as MR.Runner.POLISH.
  Object.defineProperty(api, 'NARROW', {
    get: function () { return NARROW; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) NARROW = Math.max(0, Math.min(1, n)); },
  });
  Object.defineProperty(api, 'RAMP', {
    get: function () { return RAMP; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) RAMP = Math.max(0, Math.min(1, n)); },
  });

  return api;
})();
