/**
 * The race engine: pace, distance, race clock, and the record ghost.
 *
 * The rule the whole game hangs on is "only an unbroken clean line makes you
 * faster". That is expressed as a target pace driven purely by the current
 * clean streak:
 *
 *     target(streak) = FLOOR + (START - FLOOR) * exp(-streak / K)
 *
 * Actual pace eases toward that target instead of snapping, so speed changes
 * are felt rather than teleported. Contact keeps only HIT_STREAK_KEEP of the
 * streak, which pulls the target back up and bleeds the pace away over the
 * next few seconds -- the punishment is a slow slide, not an instant number.
 */
MR.Pace = (function () {
  const K = MR.K;

  /**
   * ---- EFFORT: ONE POOL, TWO SPENDS, OPPOSITE TIME PREFERENCES ------------
   *
   * A/B scalar on the MR.Runner.POLISH / MR.Course.RAMP pattern, and it obeys
   * the same rule they do: AT 0 NOTHING IS TOUCHED. Every branch below sits
   * behind a short-circuiting EFFORT > 0, no seeded stream is drawn from, and
   * course.js reads this flag rather than keeping a second one -- so the whole
   * mechanic is one number and tools/mechanics.js --identity can prove the
   * course is bit-identical at zero.
   *
   * WHY IT EXISTS, in the one number that condemned the shipped game: six
   * distinct policies -- take every bottle, take none, early only, late only,
   * safe lane, shortest line -- all finish at 1:58:03, spread 0.0 seconds
   * (docs/risk-reward.md). There is no strategy because there is no decision:
   * speed is an OUTPUT of one binary skill event, and a system with one input
   * and a monotone reward has exactly one optimal policy.
   *
   * THE SHAPE. Aid stops topping the streak up and fills a small POOL instead.
   * The pool has two exits and they want opposite halves of the race:
   *
   *   GUARD  spent automatically. A contact eats one segment instead of the
   *          streak. Worth 64 s at 20% of the race and 5 s at 99% -- the
   *          measured cost of a contact by position, docs/risk-reward.md.
   *
   *   SURGE  spent by choosing a lane. Inside a marked zone the pace FLOOR
   *          drops from EFFORT_FLOOR to SURGE_FLOOR while the runner is in the
   *          marked lane, and the pool burns while it does.
   *
   * AND THE TIME PREFERENCE FALLS OUT OF THE SHIPPED CURVE RATHER THAN BEING
   * TUNED IN. target(s) = FLOOR + gap*(0.685 e^-s/10 + 0.315 e^-s/100), so
   * d(target)/d(FLOOR) is 0.285 at streak 5, 0.804 at streak 50 and 0.93 at
   * streak 150. LOWERING THE FLOOR BUYS ALMOST NOTHING UNTIL THE RAMP IS
   * SPENT. Measured end to end on real courses: one 600-unit zone is worth
   * 19.6 s at 5% of the race and 37.1 s at 80% of it.
   *
   * So guard is worth most early and surge is worth most late, out of one pool
   * that is too small to do both, and the player must decide which half of the
   * race they are buying. That is the strategy the game did not have.
   *
   * SPEED STILL HAS EXACTLY ONE SOURCE. Surge does not add pace; it lowers the
   * floor an unbroken line is running toward. A broken run is nowhere near the
   * floor and gains almost nothing from surging, which is the same property
   * AID_CEILING was built to have -- the top gear is still only buyable with a
   * clean line.
   */
  // SHIPS AT 1, exactly as MR.Course.RAMP does, and for the reason the owner
  // gave: the game as it stood could be beaten on a first attempt by six
  // different lines that all finished within 0.0 seconds of each other. This IS
  // the game now. ?effort=0 returns the other one, whole, from the same build.
  let EFFORT = 1;

  const SURGE = {
    // The unsurged floor, and it is SLOWER than K.FLOOR_PACE on purpose. The
    // shipped game hands a flawless run 86 seconds of free margin and six
    // policies tie inside it; the 86 seconds have to stop being free before any
    // allocation can matter. At 261 a flawless line that spends NOTHING
    // finishes 2:00:26 -- 56 s the wrong side of the record -- so the record
    // has to be bought rather than merely survived.
    //
    // SWEPT, NOT PICKED. Each 1 s/mi of floor is worth 20.7 s of finish time on
    // real courses, and the three candidates were run through the whole
    // policy x skill grid (10 policies x 5 skills x 8 dates x 14 seeds, worst
    // standard error 7.0 s):
    //
    //   262   3 of 50 cells beat the record ( 6%) -- only a FLAWLESS run that
    //         surged everything got under, so the allocation had one answer and
    //         the record was a lottery on execution.
    //   261  13 of 50 (26%), first-attempt 5 of 20 (25%). Non-spending policies
    //         never get under at any skill; every spending policy is within 30 s
    //         of the line; the worst spending policy (EARLY) is 17 s behind the
    //         best (LATE) at equal skill.
    //   260  28 of 50 (56%), and seven of ten policies beat it at perfect. The
    //         allocation stops being a decision because nearly everything wins.
    //
    // 261 is the value at which BOTH halves of the owner's sentence hold: a
    // stranger does not walk it, and more than one line gets there.
    FLOOR_BASE: 261,          // 4:22 /mi
    // The floor while surging. NOT 240: at 4:00/mi the airborne span reaches
    // exactly ACTION_WINDOW and the invariant that stops a course demanding a
    // jump and a slide at once is gone (docs/strategy-space.md). At 244 the
    // span is 20.66 against a window of 21, and course.js widens the window
    // inside a zone by exactly the difference so the SAME 1.16-unit margin the
    // flat course keeps today holds inside a surge by construction.
    FLOOR_SURGE: 244,         // 4:04 /mi
    // Segments. FOUR, and it is set by the longest zone rather than chosen:
    // SURGE_LEN_MAX is 560 units and BURN_UNITS is 140, so a full tank is
    // exactly one maximum-length zone. A smaller cap would make the longest
    // zones unbuyable however well a player had allocated, which is a cap
    // secretly editing the course.
    POOL_MAX: 4,
    // One segment absorbs one contact whole.
    GUARD_COST: 1,
    // ---- THE ONE NUMBER THAT DECIDES WHETHER THERE IS AN ALLOCATION -------
    //
    // World units of marked-lane running per segment. It is set by making the
    // pool BIND, and the first value it was given did not:
    //
    //   zones on a course      2205 units
    //   collectible road aid   13.7 items, i.e. 13.7 segments
    //
    //   1 per 200u   surging EVERY zone costs 11.0 segments -- a 2.7 surplus,
    //                so the pool never binds, "surge everything" is affordable
    //                AND leaves change for guard, and it dominates every
    //                selective policy. Measured: BLIND beat the record at 4 of
    //                5 skill levels and every learned policy lost. One optimal
    //                policy again, one level up.
    //   1 per 140u   surging every zone costs 15.7 segments against 13.7. You
    //                can afford about seven eighths of the road, and only by
    //                spending the guard. Now WHICH zones you buy is the
    //                decision, and because lowering the floor is worth 0.285x
    //                at streak 5 and 0.93x at streak 150, the late ones are
    //                worth nearly twice the early ones.
    //
    // So 140, and the surplus is deliberately negative. A player cannot buy
    // the whole course and cannot insure the whole course, and the pool is
    // filled by the one thing that already costs an action to reach.
    BURN_UNITS: 140,
  };

  /**
   * ---- THE DIRECTIONAL MATS, AND WHY ONE OF THESE NUMBERS IS DERIVED ------
   *
   * A forward mat lifts the pace briefly; a backward mat drags it. Which mat is
   * where, and the open-lane guarantee that makes a backward one fair, all live
   * in course.js. What lives here is only the size of the two steps.
   *
   * LIFT IS NOT A CHOSEN NUMBER. It is the gap between the floor a runner
   * outside a zone runs toward (FLOOR_BASE, 261) and K.FLOOR_PACE (254), which
   * is the pace ACTION_WINDOW, LANE_TRANSIT and every gate spacing in this game
   * have been cut against since the generator was written. So a lift closes
   * exactly the gap the course has always been ready for and not one second
   * more, and the clamp in tempoTarget makes that a hard ceiling rather than a
   * hope: no combination of streak, hill and mat can put the pace below
   * K.FLOOR_PACE, and only an elected surge goes below it at all.
   *
   * That is belt AND braces, because course.js also widens the action window
   * over a lift mat exactly as it does over a zone -- see liftAt. The clamp is
   * what holds if the paint is ever laid somewhere the widening did not reach.
   *
   * DRAG IS SWEPT, NOT DERIVED, and 21 s/mi is what the sweep chose. It is the
   * one number in this mechanic with a free hand, because a drag only ever
   * makes the runner SLOWER -- it widens the reaction window rather than
   * narrowing it, so no fairness argument bounds it and only the shape of the
   * decision does. What it has to be worth is roughly what avoiding it costs:
   * the escape lane is guaranteed open but it frequently holds a hurdle, so
   * declining a drag costs one action, and one action at a realistic failure
   * rate costs a few seconds of expected time. Over the median 67-unit mark a
   * drag at 21 s/mi costs 5.9 race seconds. Swept at 12 / 21 / 30 over the
   * whole policy grid; the numbers are in docs/roadmap.md entry 68.
   *
   * APPLIED TO THE TARGET, NOT TO THE FLOOR, and that distinction is the whole
   * difference between a mechanic and a decoration. targetPace's own curve
   * gives d(target)/d(FLOOR) = 0.285 at streak 5 and 0.93 at streak 150, so a
   * mat wired to the floor would be worth a third of its face value early and
   * nearly all of it late -- which is right for the surge, where the time
   * preference IS the strategy, and wrong here, where a mat is a local fact
   * about a lane and should cost the same wherever it is met.
   */
  const TEMPO = {
    LIFT: SURGE.FLOOR_BASE - K.FLOOR_PACE,   // 7 s/mi: 4:21 -> 4:14
    DRAG: 21,                                // s/mi: 4:21 -> 4:42
  };

  /**
   * The target pace, shifted by whatever the runner is standing on.
   * @param tempo  +1 forward mat, -1 backward mat, 0 for open road.
   */
  function tempoTarget(base, tempo) {
    if (EFFORT <= 0 || !tempo) return base;
    return tempo > 0 ? Math.max(K.FLOOR_PACE, base - TEMPO.LIFT) : base + TEMPO.DRAG;
  }

  /** The floor this runner is running toward right now. */
  function floorPace(surging) {
    if (EFFORT <= 0) return K.FLOOR_PACE;
    return surging ? SURGE.FLOOR_SURGE : SURGE.FLOOR_BASE;
  }

  /** The fastest pace ANY line can reach, which is what a bound must use. */
  function bestFloor() {
    return EFFORT > 0 ? SURGE.FLOOR_SURGE : K.FLOOR_PACE;
  }

  function targetPace(streak, floor) {
    // Two time constants. The fast term pays a weak player early; the slow
    // term is still unwinding at the finish, so late gates keep buying time
    // and a late mistake still costs something. See constants.js.
    //
    // `floor` is optional and defaults to the shipped constant, so every
    // existing caller -- the HUD, the tools, this file's own projection --
    // reads exactly the curve it read before unless EFFORT is on.
    const F = floor === undefined ? floorPace(false) : floor;
    const gap = K.START_PACE - F;
    return F
      + gap * K.STREAK_FAST_SHARE * Math.exp(-streak / K.STREAK_FAST)
      + gap * (1 - K.STREAK_FAST_SHARE) * Math.exp(-streak / K.STREAK_SLOW);
  }

  /**
   * @param elev  an MR.Elevation profile, or nothing for a flat course.
   *
   * THE GRADE TERM IS ADDITIVE IN SECONDS PER MILE AND THAT IS THE WHOLE
   * ARGUMENT. See K.GRADE_SPM: because every hill returns to zero, the grade
   * contribution to the finish integrates to exactly zero over the race, so a
   * hilly course finishes in the same time as a flat one for any sequence of
   * gate outcomes. Nothing here needs recalibrating and neither does the
   * record.
   *
   * Three things deliberately do NOT read it -- projected(), projectClean() and
   * needPace() all keep using `s.pace`. That is correct rather than an
   * oversight: the grade term integrates to zero, so a projection that included
   * it would swing wildly on every crest and be wrong, and needPace() > FLOOR
   * remains a valid bound on the AVERAGE.
   */
  function create(elev) {
    const E = elev || (MR.Elevation ? MR.Elevation.FLAT : null);
    const s = {
      raceTime: 0,          // seconds of simulated race time
      realTime: 0,          // seconds of wall clock since the gun
      miles: 0,
      units: 0,             // world units travelled
      streak: 0,
      bestStreak: 0,
      pace: K.START_PACE,   // seconds per mile, instantaneous, GRADE-FREE
      // The pace the ground is actually being covered at: `pace` plus the
      // grade term. This is what the world scrolls at and what the HUD's pace
      // number reads; `pace` is the engine, and the speed gauge stays on it so
      // a descent cannot light up the top-gear flourish.
      paceNow: K.START_PACE,
      grade: 0,             // percent, positive uphill, at the runner
      hits: 0,
      gatesSeen: 0,
      aid: 0,
      // ---- the pool, and it is inert at EFFORT = 0 -----------------------
      // Every field below stays at its initial value for the whole race when
      // the flag is off, so the finish time, the streak and the hit count are
      // bit-identical to the shipped game.
      pool: 0,           // segments in hand, fractional while a surge burns
      guards: 0,         // contacts a segment absorbed
      wasted: 0,         // items collected into a full pool
      surging: false,    // set by main.js from the runner's lane, read here
      surgeUnits: 0,     // world units actually run under surge
      // ---- the mats, and they are inert at EFFORT = 0 ---------------------
      tempo: 0,          // +1 on a forward mat, -1 on a backward one, set by main
      liftUnits: 0,      // world units run on forward mats
      dragUnits: 0,      // ...and on backward ones
      finished: false,
      finishTime: 0,
      splits: [],           // race-time at each completed mile
      lastMile: 0,
    };

    /** Advance by dt real seconds. Returns world units travelled this step. */
    s.update = function (dt) {
      if (s.finished) return 0;

      s.realTime += dt;
      const dRace = dt * K.TIME_SCALE;
      s.raceTime += dRace;

      // Ease pace toward the streak's target.
      //
      // THE ONLY LINE THE SURGE CHANGES. It swaps the floor the target is
      // built on, and nothing else: the easing law, the grade term and the
      // integration are untouched, so the pace still moves at PACE_EASE and a
      // surge is felt as a burn rather than as a teleport. At EFFORT = 0
      // floorPace() returns K.FLOOR_PACE and this is the shipped expression.
      //
      // ...and then the mat, which is a step on the TARGET rather than a swap
      // of the floor. A surge and a mat cannot both be live -- course.js never
      // lays a mat inside a zone or within SURGE_SIGHT of one -- and the clamp
      // in tempoTarget means that even if one were laid there, the pace could
      // not go below K.FLOOR_PACE and the fastest the game can run would still
      // be FLOOR_SURGE exactly.
      const tgt = tempoTarget(targetPace(s.streak, floorPace(s.surging)),
                              s.surging ? 0 : s.tempo);
      const d = tgt - s.pace;
      const step = K.PACE_EASE * dRace;
      s.pace += Math.abs(d) <= step ? d : Math.sign(d) * step;

      // The hill. Sampled at the runner's own z, which is s.units.
      s.grade = E ? E.gradeAt(s.units) : 0;
      const gt = K.GRADE_SPM * s.grade;
      s.paceNow = s.pace + (gt < -K.GRADE_CLAMP ? -K.GRADE_CLAMP
        : gt > K.GRADE_CLAMP ? K.GRADE_CLAMP : gt);

      const dMiles = dRace / s.paceNow;
      s.miles += dMiles;

      // Mile splits.
      while (s.lastMile < 26 && s.miles >= s.lastMile + 1) {
        s.lastMile++;
        s.splits.push({ mile: s.lastMile, time: s.raceTime, pace: s.pace });
      }

      if (s.miles >= K.MARATHON_MILES) {
        const over = s.miles - K.MARATHON_MILES;
        s.miles = K.MARATHON_MILES;
        // Trim the overshoot for an exact finish. paceNow, not pace: this
        // undoes distance that was covered at the local pace, and the last
        // hill ends 200 units before the tape so the two are equal anyway.
        s.raceTime -= over * s.paceNow;
        s.finished = true;
        s.finishTime = s.raceTime;
      }

      const dUnits = dMiles * K.UNITS_PER_MILE;
      s.units += dUnits;

      // ---- the burn -------------------------------------------------------
      // Charged over GROUND rather than over time, so a surge costs the same
      // whatever the hill under it is doing and a descent inside a zone cannot
      // be used to buy the same road for less. Draining the pool ends the
      // surge on the spot; the pace then eases back up under the same law,
      // which is the honest and legible failure -- the player is shown the
      // tank empty and feels the gear go.
      // Ground run under each mat, for the report and for tools/tempo.js. Not a
      // cost: a mat charges nothing and is free to run on. What it charges is
      // the lane it asks you to be in.
      if (EFFORT > 0 && s.tempo && !s.surging && dUnits > 0) {
        if (s.tempo > 0) s.liftUnits += dUnits; else s.dragUnits += dUnits;
      }
      if (EFFORT > 0 && s.surging && dUnits > 0) {
        s.pool -= dUnits / SURGE.BURN_UNITS;
        s.surgeUnits += dUnits;
        if (s.pool <= 0) { s.pool = 0; s.surging = false; }
      }
      return dUnits;
    };

    s.onClean = function () {
      s.streak++;
      s.gatesSeen++;
      if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    };

    /**
     * Contact.
     *
     * ---- GUARD IS SPENT HERE AND NOWHERE ELSE, AND IT TAKES NO INPUT ------
     *
     * The safety net cashing itself. If there is a segment in the pool it is
     * spent and the streak is not cut and no seconds are added -- the contact
     * still HAPPENED, and player.js still bounces, trips and stumbles for it,
     * because a guard that also deleted the physical event would read as the
     * collision not registering. What is bought is the consequence, not the
     * moment.
     *
     * It is counted separately rather than folded into `hits`: a guarded
     * contact is a different fact about a run from an unguarded one and the
     * finish card, the tools and the policy sweep all need to tell them apart.
     * `gatesSeen` still advances, because a gate was still seen -- that bound
     * is what stops aid handing a broken run a streak it never ran for.
     *
     * @returns 'guard' when a segment paid for it, otherwise 'hit'.
     */
    s.onHit = function () {
      s.gatesSeen++;
      if (EFFORT > 0 && s.pool >= SURGE.GUARD_COST) {
        s.pool -= SURGE.GUARD_COST;
        s.guards++;
        if (s.pool <= 0) { s.pool = 0; s.surging = false; }
        return 'guard';
      }
      s.hits++;
      s.streak = Math.floor(s.streak * K.HIT_STREAK_KEEP);
      s.raceTime += K.HIT_TIME_PENALTY;
      return 'hit';
    };

    /**
     * Aid taken. Grants streak, not pace -- speed still has exactly one
     * source, so the rule the game is built on is untouched. See K.AID_* for
     * why this needs no cap: the streak curve saturates, so aid is worth a
     * great deal to a broken run and almost nothing to a clean one.
     */
    s.onAid = function (gain) {
      // ---- UNDER EFFORT A BOTTLE IS A SEGMENT, NOT A REBATE ---------------
      //
      // This is the change that ends "aid is worth exactly 0.00 s to a clean
      // run and rises with damage" -- insurance with no premium, and the
      // reason there was nothing to decide. The bottle no longer repairs a
      // streak; it fills a pool with two rival uses, and the pool is capped,
      // so an item collected into a full tank is genuinely thrown away. That
      // waste is the price of holding, and holding is now a choice.
      //
      // `gain` is deliberately ignored: a segment is a segment, so the gauge
      // can be counted rather than read. What water and fruit still differ in
      // is where the course puts them, which generateAid already decides and
      // this pass does not touch.
      if (EFFORT > 0) {
        s.aid++;
        if (s.pool >= SURGE.POOL_MAX) { s.wasted++; return; }
        s.pool = Math.min(SURGE.POOL_MAX, s.pool + 1);
        return;
      }
      // Three bounds, and each one is doing a job.
      //
      //   + gain        a bottle is worth something.
      //   gatesSeen     but never more than a CLEAN run would already have.
      //                 This is what makes aid worth exactly zero to a
      //                 flawless player: their streak already equals the gates
      //                 they have passed, so the min changes nothing. A first
      //                 pass without this bound handed a perfect run 126
      //                 seconds for free by shortcutting the opening ramp.
      //   AID_CEILING   and never past record pace, so the top gear stays
      //                 something only an unbroken line can buy.
      //
      // Math.max on the outside means aid can never take streak AWAY from a
      // player already above the ceiling.
      s.streak = Math.max(
        s.streak,
        Math.min(s.streak + gain, s.gatesSeen, K.AID_CEILING)
      );
      s.aid++;
      if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    };

    /**
     * Gates per mile, measured from what has actually gone past rather than
     * passed in from the course. Courses vary (173-179 gates), and this keeps
     * projectClean() correct without pace.js needing to know about course
     * data or main.js needing to wire it through. Falls back to the long-run
     * average until enough of the race has been seen to measure it.
     */
    s.gatesPerMile = function () {
      return s.miles > 1.5 ? s.gatesSeen / s.miles : 6.7;
    };

    /**
     * World units per real second, INCLUDING the grade. This is the honest
     * ground speed: it drives the world scroll, the runner's cadence and the
     * camera's framing, all of which should quicken on a descent.
     */
    s.speed = function () {
      return (K.UNITS_PER_MILE * K.TIME_SCALE) / s.paceNow;
    };

    /**
     * World units per real second at the STREAK's pace, ignoring the hill.
     *
     * Splitting these is not fussiness. The camera's top-gear latch fires at
     * sp01 > 0.93 and brings a one-shot flourish and a permanent rumble with
     * it, and the HUD's speed gauge is the engine readout. Without this a steep
     * descent would fire both spuriously -- the game would tell the player they
     * had found another gear when all they had done was point downhill, which
     * is exactly the kind of thing that ships as a bug.
     */
    s.streakSpeed = function () {
      return (K.UNITS_PER_MILE * K.TIME_SCALE) / s.pace;
    };

    /**
     * Seconds ahead (-) or behind (+) the record. This is the honest split:
     * where the record holder's clock would read at the distance we've run.
     */
    s.deltaVsRecord = function () {
      return s.raceTime - s.miles * K.RECORD_PACE;
    };

    /** Finish time if the current pace were held to the line. */
    s.projected = function () {
      return s.raceTime + (K.MARATHON_MILES - s.miles) * s.pace;
    };

    /**
     * Finish time if the player holds a clean line from here.
     *
     * `projected()` above is structurally pessimistic during the part of the
     * race that matters most. It assumes the current pace holds, but on a
     * clean run the pace is still falling, so at the gun a flawless player is
     * shown 2:24:12 -- the largest number on screen tells them they are
     * failing while they are in fact heading for 1:58:16. Relocating that
     * number in the HUD does not fix it; the projection itself is wrong.
     *
     * This rolls the real model forward instead: gates keep arriving at the
     * observed rate, every one of them is cleared, the streak grows, and the
     * pace eases toward its target under the same PACE_EASE limit the live
     * simulation uses. Integrating in closed form would ignore that easing lag
     * and land ~70s optimistic, so this steps numerically -- roughly 100 steps
     * for a whole marathon, and the result is cached per call site rather than
     * recomputed per frame.
     *
     * The assumption is stated, not hidden: this is "if you stay clean", which
     * is exactly the question a record chase asks.
     */
    s.projectClean = function (gatesPerMile) {
      const g = gatesPerMile || s.gatesPerMile();
      const STEP = 0.25;                       // miles per integration step

      let t = s.raceTime;
      let m = s.miles;
      let pace = s.pace;
      let streak = s.streak;

      let guard = 0;
      while (m < K.MARATHON_MILES && guard++ < 400) {
        const dm = Math.min(STEP, K.MARATHON_MILES - m);
        // Race seconds spent covering dm at the pace entering this step.
        const dRace = dm * pace;

        // Same easing law as update(), applied over that span.
        //
        // AT THE UNSURGED FLOOR, DELIBERATELY. "If you stay clean" is the
        // question this answers, and staying clean is not the same promise as
        // spending the rest of the pool on surge -- a projection that assumed
        // the surge would print a finish the player has not bought yet, which
        // is the exact defect projected() was replaced for.
        const tgt = targetPace(streak, floorPace(false));
        const d = tgt - pace;
        const step = K.PACE_EASE * dRace;
        pace += Math.abs(d) <= step ? d : Math.sign(d) * step;

        streak += g * dm;
        t += dRace;
        m += dm;
      }
      return t;
    };

    /**
     * The exact question "can the record still be reached at all". FLOOR_PACE
     * is the fastest any streak can ever make the player, so if the pace the
     * remaining distance demands is below the floor, no run of clean gates
     * recovers it. This is a bound, not a heuristic.
     */
    s.needPace = function () {
      const left = K.MARATHON_MILES - s.miles;
      if (left <= 0) return Infinity;
      return (K.RECORD_SECONDS - s.raceTime) / left;
    };

    /**
     * bestFloor(), not K.FLOOR_PACE, and the distinction only exists under
     * EFFORT: the fastest pace any line can reach is the SURGE floor, so a
     * bound built on the unsurged one would call a record dead while the
     * player still had the pool to buy it. A bound may be loose. It may not be
     * wrong in the direction that takes a live run away.
     */
    s.recordPossible = function () {
      return s.needPace() > bestFloor();
    };

    /** Where the record ghost is right now, in miles. */
    s.ghostMiles = function () {
      return Math.min(K.MARATHON_MILES, s.raceTime / K.RECORD_PACE);
    };

    s.targetPace = () => tempoTarget(targetPace(s.streak, floorPace(s.surging)),
                                     s.surging ? 0 : s.tempo);

    /** Whole segments in hand -- what the gauge counts and guard spends. */
    s.segments = function () { return Math.floor(s.pool); };

    return s;
  }

  // ---- formatting -------------------------------------------------------

  /** 7170 -> "1:59:30" */
  function clock(sec) {
    if (!isFinite(sec)) return '--:--';
    const neg = sec < 0;
    sec = Math.abs(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = Math.floor(sec % 60);
    const body = h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      : `${m}:${String(ss).padStart(2, '0')}`;
    return (neg ? '-' : '') + body;
  }

  /** 273.46 -> "4:33" */
  function pace(secPerMile) {
    if (!isFinite(secPerMile) || secPerMile <= 0) return '--:--';
    const m = Math.floor(secPerMile / 60);
    const s = Math.round(secPerMile % 60);
    return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
  }

  /** Signed split for the record delta: -12.4 -> "-0:12.4" */
  function delta(sec) {
    const sign = sec < 0 ? '-' : '+';
    const a = Math.abs(sec);
    const m = Math.floor(a / 60);
    const s = a % 60;
    return `${sign}${m}:${s.toFixed(1).padStart(4, '0')}`;
  }

  const api = { create, targetPace, clock, pace, delta, SURGE, TEMPO, tempoTarget,
                floorPace, bestFloor };

  // Accessor rather than a plain field, so a nonsense value cannot be written
  // and the clamp lives with the flag. Same shape as MR.Course.RAMP.
  Object.defineProperty(api, 'EFFORT', {
    get: function () { return EFFORT; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) EFFORT = Math.max(0, Math.min(1, n)); },
  });

  return api;
})();
