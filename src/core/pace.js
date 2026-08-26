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

  /**
   * The EFFORT configuration. It was called SURGE and held the surge's second
   * floor, the pool cap, the guard cost and the burn rate; the surge is gone
   * and three of those four survive it, so the name is wrong and a wrong name
   * on an exported object is a trap for whoever reads it next. Renamed rather
   * than left as a fossil.
   */
  const EFFORT_CFG = {
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
    // ---- LOWERED WITH THE SURGE'S REMOVAL, AND THE ARITHMETIC IS FLAT --
    //
    // 261 was "the pace an UNSURGED runner runs toward". The whole reason it
    // sat 7 s/mi slower than the datum every gate spacing is cut against was
    // that the surge existed to buy the difference back. Remove the surge and
    // the ordinary runner is permanently slow for no reason, and the record
    // becomes unreachable: tools/simulate.js measured 0 of 40 cells beating
    // 1:59:30 with the best line 41 seconds short, because surge had been
    // worth about 131 race seconds a race and mats replace a fraction of it.
    //
    // 259 gives that back at 2 s/mi over 26.2 miles, which is 52 seconds -- so
    // an ordinary line lands just OUTSIDE the record and a line that reads the
    // paint lands just inside it. That is the difficulty bar the owner set
    // ("if people get it on the first try everytime they will not always
    // play") expressed as the two numbers it has always been expressed as, and
    // simulate.js is what chose it rather than this comment.
    //
    // ---- 259.0 -> 259.7 FOR THE 5% PASS ---------------------------------
    //
    // The owner moved the bar: "Only 5% of first runs should result in a
    // win." At 259.0 the sweep's first-attempt column sat at 20-27% through
    // the abundance retune, and the floor is the one dial that moves the
    // PERFECT rows -- demand density cannot touch a runner who never misses,
    // and with guard now abundant the sub-perfect rows follow the perfect
    // ones closely. 0.7 s/mi is 14.5 s on a race, which prices the record at
    // "a flawless line that reads the road, and nearly nothing else".
    // Swept, not picked; the grid is in roadmap 73.
    FLOOR_BASE: 259.7,        // 4:20 /mi, a hair under
    // FLOOR_SURGE STOOD HERE AT 244 (4:04/mi) and was the second floor an
    // elected surge ran toward. It is gone with the mechanic. The reasoning
    // that set it is worth keeping because it constrains any future second
    // floor: NOT 240, because at 4:00/mi the airborne span reaches exactly
    // ACTION_WINDOW and the invariant that stops a course demanding a jump and
    // a slide at once is gone (docs/strategy-space.md).
    // Segments. FOUR, and with one spend left the cap is what stops aid being
    // hoarded into irrelevance: a small tank has to be SPENT to keep
    // collecting, which is the property docs/strategy-space.md asked of it.
    //
    // ---- BURN_UNITS IS GONE, AND IT WAS THE DIFFICULTY LEVER -------------
    //
    // A segment bought BURN_UNITS of surged road, so POOL_MAX x BURN_UNITS was
    // how much road a full tank could buy, and roadmap 68 tuned the whole
    // difficulty contract on it -- 140/560 gave 42% of cells and 25% on a
    // first attempt, 130/520 gave 32% and 20%, 120/480 gave 10% first-attempt.
    // With the surge removed there is nothing to burn: the pool buys guard and
    // guard only, at GUARD_COST a contact.
    //
    // THAT LEVER IS THEREFORE UNAVAILABLE and whatever holds the difficulty
    // bar now has to be a different number. Say which one moved and why in the
    // roadmap rather than reaching for this one, because it is not here.
    POOL_MAX: 4,
    GUARD_COST: 1,
    /**
     * ---- THE POOL IS FILLED IN SIPS NOW, AND THIS IS THE DENOMINATION ----
     *
     * The owner: "Adjust the water and bananas. We need countless of them
     * similar to these other games that have coins. That keeps players
     * engaged." So aid went from ~16 scarce items, each a whole segment, to
     * hundreds of small pickups laid in trails, arcs and clusters -- see
     * generateAid in course.js. A pickup is a BITE of a segment, not a
     * segment: PER_SEG of them fill one, and the pool is fractional between
     * whole segments so the gauge can fill visibly as they accumulate.
     *
     * THE NUMBER IS THE ECONOMY. Total pickups on a course divided by this is
     * the total guard the road can pay, and the tuning target is that a real
     * line's collectable segments stay near the old economy (~13-16 a race)
     * rather than inflating with the item count -- endless aid at the old
     * value would make contacts free and hand the record to a first attempt,
     * which is the exact opposite of what the same owner asked for in the
     * same breath. tools/aid.js measures collectable segments per race and
     * fails the build outside its band; tools/simulate.js holds the
     * difficulty bar. GUARD_COST stays 1: only a WHOLE segment guards.
     */
    PER_SEG: 24,
    /**
     * ---- A GUARDED CONTACT KEEPS THE STREAK, NOT THE STUMBLE -------------
     *
     * Under scarce aid a guard was total absolution: streak kept, no seconds.
     * That was affordable when a segment cost an action to collect. With
     * pickups abundant and mostly free to gather, total absolution makes
     * skill irrelevant anywhere the pool is topped up -- measured on the
     * policy sweep, every collecting policy's five skill columns collapsed to
     * within a few seconds of its perfect one, and the first-attempt bar
     * cannot be held by any pace number when 0.96 plays like 1.0.
     *
     * So a guard now buys the STREAK -- which is tens of seconds and the
     * whole run -- and the physical stumble still costs its seconds, same
     * count as an unguarded hit's time term. player.js already plays the
     * bounce and the trip either way; this makes the picture and the clock
     * agree. The streak is the thing that was worth insuring, and it still is.
     */
    GUARD_TIME: 1.5,
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
  /**
   * ---- BOTH STEPS HALVED, AND THE HALVING IS DERIVED ---------------------
   *
   * The owner: "Small speed increase and small speed decrease. Placed
   * strategically so that players need to make decisions."
   *
   * The second sentence is what sizes the first. A mat is now laid ON a
   * decision the player was already making -- a lane that costs an action
   * against one that does not, a bottle behind a hurdle -- and the design
   * intent handed down with it is that A MAT MUST CHANGE THE PRICE OF A
   * DECISION AND NEVER BE THE DECISION. That is a statement about a ratio, so
   * it can be measured against a number this project already owns:
   *
   *   AN ACTION COSTS 2 TO 4 RACE SECONDS. It is P(fluff) x a contact, and it
   *   is the number roadmap 68 used to set the autopilot's own mat weights.
   *
   * At the shipped size a mat was worth -1.75 s forward and +4.75 s backward
   * over a 58-unit mark (tools/tempo.js --section worth, 60 days). The
   * BACKWARD one was therefore worth MORE than the action that avoids it, and
   * a mat worth more than the action it modifies is not modifying anything --
   * it is making the decision, and the correct play is simply to always
   * swerve. That is the mechanic the owner is asking to shrink.
   *
   *   LIFT = (FLOOR_BASE - K.FLOOR_PACE) / 2 = 3.5 s/mi
   *
   * The whole quantity is the gap between the pace an unsurged runner runs
   * toward and the pace every gate spacing in course.js is cut against -- the
   * most a mat could give without carrying the runner past the course's own
   * spacing datum. HALF of it is a mat that moves you toward that datum
   * without reaching it, which is exactly the difference between a nudge and a
   * mode change. Nothing is picked: the quantity is the same one the shipped
   * number was derived from and the fraction is the one that keeps the mat
   * under the thing it modifies.
   *
   * DRAG holds the authored 3:1 against it. The ratio is what makes a backward
   * mat cost about three times what a forward one pays over the same ground --
   * a mat you can ignore is worth less than a mat you must leave -- and it is
   * unchanged so that only ONE number moves in this pass.
   *
   * MEASURED AFTER THE CHANGE, not predicted: see the roadmap entry. Halving
   * the steps and capping the painted length together take a mat to well under
   * an action's cost in both directions, which is the point.
   */
  const TEMPO = {
    /**
     * ---- THE LIFT IS THE WHOLE GAP AGAIN, AND THE HALVING IS WHY ---------
     *
     * It was halved to 3.5 in this same pass, derived against the cost of an
     * ACTION, on the design intent that a mat must change the price of a
     * decision and never be the decision. That derivation was correct and its
     * premise was deleted underneath it: at the time the SURGE still supplied
     * the race's speed and the mat only had to nudge a lane choice.
     *
     * With one speed system the mat has to carry the race, and
     * tools/simulate.js measured what the halved step left behind: NO POLICY
     * AT ANY SKILL BEAT THE RECORD, 0 of 40 cells, and the spread across
     * policies collapsed to 5.7 s against a 15 s floor. Surge had been worth
     * about 131 race seconds a race (1848 units run at 17 s/mi); the halved
     * mats were worth about 4. That is not a tuning error, it is a mechanic
     * with no room in it.
     *
     * FLOOR_BASE - K.FLOOR_PACE is the whole room there is. It is the gap
     * between the pace an unsurged runner runs toward and the pace every gate
     * spacing in course.js is cut against, and tempoTarget clamps a lift at
     * K.FLOOR_PACE so it can never go past it. Taking the whole gap is
     * therefore not a choice about size, it is the statement that green means
     * "as fast as this course is spaced for" and nothing beyond.
     *
     * AND IT IS STILL SMALL BY THE ONLY COMPARISON THAT EXISTS. The largest
     * step this game ever had was the surge's 17 s/mi. 7 is 41% of it, it is
     * the only step left, and a mat is 46 units long against a zone's 500.
     */
    LIFT: 7,                                        // s/mi: 4:19 -> 4:12
    /**
     * The drag stays HALVED, at one and a half lifts rather than the three it
     * shipped at. The asymmetry is real -- a drag holds you on itself longer,
     * so the same s/mi is worth more going backwards -- and 21 made eating one
     * cost more than clearing a hurdle, which is the mat being the decision
     * rather than pricing it. At 10.5 a drag over the median 46-unit mark
     * costs about two race seconds against an action's two to four: enough to
     * decide a close call, never enough to decide an open-and-shut one.
     */
    DRAG: 10.5,                                     // s/mi: 4:19 -> 4:29
  };

  /**
   * The target pace, shifted by whatever the runner is standing on.
   * @param tempo  +1 forward mat, -1 backward mat, 0 for open road.
   */
  function tempoTarget(base, tempo) {
    if (EFFORT <= 0 || !tempo) return base;
    // ---- THE CLAMP WAS AT K.FLOOR_PACE AND HAD ONE JOB -----------------
    //
    // It stopped a lift compounding with a SURGE: a runner already at the
    // surge floor could not be taken further by standing on a mat, so the
    // fastest the game could run was exactly FLOOR_SURGE whatever combination
    // of streak, hill and paint applied. The surge is gone and that job with
    // it, and holding the clamp at K.FLOOR_PACE would mean a lift did nothing
    // at all once FLOOR_BASE came down to meet it.
    //
    // So a lift now takes the runner BELOW the spacing datum, exactly as the
    // surge used to, and it is paid for the same way: course.js widens the
    // action window by precisely the lift (windowExtraAt), and
    // tools/tempo.js --section fair measures the guaranteed decide window on a
    // mat against the road either side of it and fails the build on a deficit.
    // The clamp stays as a STATED hard floor rather than an active one -- the
    // fastest pace this game can produce is FLOOR_BASE - LIFT and it is
    // written down here rather than inferred.
    return tempo > 0
      ? Math.max(EFFORT_CFG.FLOOR_BASE - TEMPO.LIFT, base - TEMPO.LIFT)
      : base + TEMPO.DRAG;
  }

  /**
   * The floor this runner is running toward right now.
   *
   * IT USED TO TAKE AN ARGUMENT. `floorPace(surging)` returned FLOOR_SURGE for
   * a runner inside a surge zone's marked lane and FLOOR_BASE otherwise, which
   * was the whole of the surge: an elected, pool-burning second floor. With
   * one speed system there is one floor, and the mats move the TARGET above it
   * rather than moving the floor itself -- see tempoTarget, and the clamp in
   * it that keeps K.FLOOR_PACE the fastest anything can ever run.
   */
  function floorPace() {
    return EFFORT <= 0 ? K.FLOOR_PACE : EFFORT_CFG.FLOOR_BASE;
  }

  /** The fastest pace ANY line can reach, which is what a bound must use. */
  function bestFloor() {
    return EFFORT > 0 ? EFFORT_CFG.FLOOR_BASE - TEMPO.LIFT : K.FLOOR_PACE;
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
      // ONE SPEND, and it used to be two. A segment bought either a GUARD or
      // a stretch of surge, and the tension between them -- guard worth most
      // early, surge worth most late -- was the whole strategic axis roadmap
      // 66 built. The surge is gone, so the pool buys guard and nothing else;
      // what replaces the axis is the LINE, a per-gate choice weighed against
      // what the mats pay. docs/risk-reward.md is the warning that has to be
      // answered with a number: with one spend, aid risks being free insurance
      // again, which is exactly the defect that started all of this.
      pool: 0,           // segments in hand
      guards: 0,         // contacts a segment absorbed
      wasted: 0,         // items collected into a full pool
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
      const tgt = tempoTarget(targetPace(s.streak, floorPace()), s.tempo);
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

      // Ground run under each mat, for the report and for tools/tempo.js. Not a
      // cost: a mat charges nothing and is free to run on. What it charges is
      // the lane it asks you to be in.
      //
      // THE BURN STOOD HERE. A surge drained the pool over GROUND rather than
      // over time, so it cost the same whatever the hill was doing; draining
      // it ended the surge on the spot. It is gone with the mechanic, and with
      // it BURN_UNITS -- the lever roadmap 68 tuned the difficulty on.
      if (EFFORT > 0 && s.tempo && dUnits > 0) {
        if (s.tempo > 0) s.liftUnits += dUnits; else s.dragUnits += dUnits;
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
      // The epsilon is float slop only: the pool is a sum of 1/PER_SEG steps
      // and PER_SEG of them can land a hair under 1.0 in binary. Same slop,
      // same reason, in s.segments().
      if (EFFORT > 0 && s.pool >= EFFORT_CFG.GUARD_COST - 1e-9) {
        s.pool -= EFFORT_CFG.GUARD_COST;
        s.guards++;
        if (s.pool <= 0) s.pool = 0;
        // The stumble's seconds are still paid -- what the segment buys is
        // the streak. See the GUARD_TIME note in EFFORT_CFG for why total
        // absolution stopped being affordable when aid became abundant.
        s.raceTime += EFFORT_CFG.GUARD_TIME;
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
      // `gain` is deliberately ignored: a pickup is a pickup, so the gauge
      // can be counted rather than read. What water and fruit still differ in
      // is where the course puts them, which generateAid already decides.
      //
      // A SIP, NOT A SEGMENT. PER_SEG pickups fill one guard segment, and the
      // pool holds the fraction between whole ones so the gauge fills as they
      // come in. Only whole segments spend -- see s.segments() and onHit.
      if (EFFORT > 0) {
        s.aid++;
        if (s.pool >= EFFORT_CFG.POOL_MAX) { s.wasted++; return; }
        s.pool = Math.min(EFFORT_CFG.POOL_MAX, s.pool + 1 / EFFORT_CFG.PER_SEG);
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

    s.targetPace = () => tempoTarget(targetPace(s.streak, floorPace()), s.tempo);

    /** Whole segments in hand -- what the gauge counts and guard spends. */
    s.segments = function () { return Math.floor(s.pool + 1e-9); };

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

  const api = { create, targetPace, clock, pace, delta, EFFORT_CFG, TEMPO, tempoTarget,
                floorPace, bestFloor };

  // Accessor rather than a plain field, so a nonsense value cannot be written
  // and the clamp lives with the flag. Same shape as MR.Course.RAMP.
  Object.defineProperty(api, 'EFFORT', {
    get: function () { return EFFORT; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) EFFORT = Math.max(0, Math.min(1, n)); },
  });

  return api;
})();
