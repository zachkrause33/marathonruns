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
  // TEMPO: the directional mats. See the long note above planTempo.
  let TEMPO = 1;
  // ROOF: cones on a rideable deck, and two decks side by side to cross
  // between. See the note above rollRoof.
  let ROOF = 1;

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
   * runs to MR.Pace.EFFORT_CFG.FLOOR_SURGE instead of FLOOR_BASE. That is a locally
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
  /**
   * How far BEFORE a mark's near edge the lift is already counted. It was
   * SURGE_PAD and it belonged to the surge; the surge is gone and the reason
   * survives it unchanged -- a jump committed just short of a marking lands
   * inside it, so the window has to be widened for ground the runner is not
   * standing on yet, and the pad costs a few units and removes the need to
   * reason about the boundary at all. Same constant elevation looks forward by.
   */
  const TEMPO_PAD = 28;

  /**
   * ---- THE ONE QUESTION THE WINDOW ACTUALLY ASKS -------------------------
   *
   * How many seconds per mile faster than the ordinary road may the runner be
   * at z, because of something the ROAD said rather than something they ran?
   *
   * There are two such things now and they are the same shape, so they are one
   * function rather than two clauses that have to be kept in step:
   *
   *   a SURGE ZONE  lifts the floor by FLOOR_BASE - FLOOR_SURGE = 17 s/mi
   *   a LIFT MAT    lifts the TARGET by FLOOR_BASE - K.FLOOR_PACE = 7 s/mi
   *
   * The MAX is taken rather than the sum, and that is not an approximation: a
   * lift mat is never generated inside a zone or within SURGE_SIGHT of one (see
   * planTempo), and Pace.tempoTarget clamps a lift at K.FLOOR_PACE so it can
   * never compound with a surge even if one were somehow laid there. The
   * fastest the game can go is still exactly FLOOR_SURGE.
   *
   * SURGE_PAD applies to both for the same reason: a jump committed just short
   * of a marking lands inside it.
   */
  function liftAt(z, tempo) {
    let lift = 0;
    if (tempo && tempo.length) {
      for (let i = 0; i < tempo.length; i++) {
        const t = tempo[i];
        if (t.dir > 0 && z >= t.z0 - TEMPO_PAD && z < t.z1) {
          // READ, NOT RE-DERIVED. This computed FLOOR_BASE - K.FLOOR_PACE for
          // itself while pace.js computed the same expression for TEMPO.LIFT,
          // so the size of a lift was written down twice. One number, one place.
          const l = MR.Pace.TEMPO.LIFT;
          if (l > lift) lift = l;
        }
      }
    }
    return lift;
  }


  function windowExtraAt(z, elev, tempo) {
    const base = elev ? elev.windowExtra(z) : 0;
    const lift = liftAt(z, tempo);
    if (!lift) return base;
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
    const surged = pace - lift;
    return Math.max(base, SPAN_NUM / surged - FLAT_SPAN);
  }

  function actionWindowAt(z, elev, tempo) {
    return ACTION_WINDOW + windowExtraAt(z, elev, tempo);
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
  function readWindowAt(z, elev, tempo) {
    return actionWindowAt(z, elev, tempo) + K.CAM_BASE_BACK;
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
  /**
   * ---- THE SURGE ZONE WAS PLANNED HERE, AND THE MECHANIC IS GONE --------
   *
   * planSurge drew 6 to 7 zones a course, 300 to 380 units each, one marked
   * lane apiece; running that lane spent the pool and dropped the pace floor
   * from FLOOR_BASE to FLOOR_SURGE. The owner removed it: "One speed system.
   * Remove the surge I think it's too confusing."
   *
   * WHAT WENT WITH IT, listed because each one was load-bearing somewhere:
   * SURGE_SIGHT (the 90 units the entry marking had to be legible from, and
   * the number spanning scenery was nudged off), the zone length and count
   * bands, the mandated early zone, zoneAt / zoneBody / surgeExtraAt, the
   * marked-lane promises inside makeGate, and every surge clause in validate().
   *
   * WHAT DID NOT GO, AND IS THE REASON THE REMOVAL IS CHEAP: the widening
   * arithmetic. windowExtraAt asks one question -- how many s/mi faster than
   * the ordinary road may the runner be here, because of something the road
   * said -- and a zone was only ever one of two answers. With the zone gone
   * the question is unchanged and only the tempo mat answers it.
   */

  /**
   * ---- DIRECTIONAL MATS: A SECOND MARK, NOT A SECOND MEANING -------------
   *
   * The owner: *"The Matts either go forward or backwards. Forward speed you up
   * briefly and backwards slow you down briefly. If there is a backwards one,
   * there needs to be an opening for the running to go through one of the
   * other lanes."*
   *
   * THE FIRST DECISION IS WHETHER THIS RIDES ON THE TELEGRAPH MAT, AND IT DOES
   * NOT. Three measurements say so and none of them is taste:
   *
   *  1. THE TELEGRAPH MAT'S COLOUR CODE IS ALREADY FULL. docs/mats-three-lane.md
   *     §2.10 measured the mat masks at READ_NEAR: JUMP 125,112,87 warm; DUCK
   *     87,117,132 cyan; BLOCK 124,82,103 magenta -- "three cleanly separated
   *     hues, distinguished by channel ordering rather than by brightness", and
   *     "the mat, on its own, is a sufficient answer" to what the lane demands.
   *     A direction on the same object doubles that code to six. The ONLY error
   *     mode the four-reader test found was a JUMP read as AROUND -- ten of
   *     them, all one reader -- which is a hue confusion. Doubling the palette
   *     attacks precisely the axis that already fails.
   *
   *  2. A TELEGRAPH MAT IS ON EVERY HAZARD LANE OF EVERY GATE. That is ~370 of
   *     them on a course. The owner asked for an effect that lasts BRIEFLY; a
   *     direction on every one of those is not a brief effect, it is a
   *     continuous speed field with the road as its argument.
   *
   *  3. A TELEGRAPH MAT STANDS IN A LANE THAT ALREADY COSTS AN ACTION. Slowing
   *     that lane as well is charging twice for one obstacle, which is a
   *     punishment rather than a choice -- and the whole point of the backward
   *     mat is to create a decision.
   *
   * So a tempo mat is its OWN painted mark, on open road, between gates, and it
   * has one job: this lane is faster / this lane is slower. The telegraph mat
   * keeps its single meaning and its measured one demonstrated job (teaching
   * which low object is jumpable, §3.5b). Two marks, two vocabularies, neither
   * overloaded.
   *
   * ---- THE LIFT IS A DERIVED NUMBER AND THAT IS WHAT MAKES IT FAIR --------
   *
   * FLOOR_BASE (261) is the pace an unsurged runner runs toward under EFFORT.
   * K.FLOOR_PACE (254) is the pace ACTION_WINDOW, LANE_TRANSIT and every gate
   * spacing in this file have been cut against since the generator was written.
   * A LIFT MAT closes exactly that gap and not one second more:
   *
   *     LIFT = FLOOR_BASE - K.FLOOR_PACE = 7 s/mi
   *
   * ...and then, because the surge pass established the standard and it is the
   * right one, the window is WIDENED for it anyway. What the player is owed is
   * not a span in the generator's units, it is TIME, and the time they are owed
   * is the time the ordinary road gives them: 761 ms. liftAt() therefore
   * reports a lift mat exactly as it reports a zone, spacingAt and solvable()
   * both read it, and a lifted stretch is spaced 0.56 units wider so the
   * guaranteed decide window inside one is the same 761 ms as outside it. A
   * lift buys speed. It does not buy reaction time and it does not cost any.
   *
   * A DRAG MAT ONLY EVER MAKES THE RUNNER SLOWER, so it widens nothing and can
   * cost the fairness proof nothing. Its whole risk is a different one, below.
   *
   * ---- PLANNED IN Z BEFORE THE GATES, ASSIGNED A LANE AFTER --------------
   *
   * Same reason surge zones are: actionWindowAt reads the marks, spacingAt and
   * solvable() read actionWindowAt, and the generator calls both on every gate.
   * The ground has to exist before the road does.
   *
   * But a mat's LANE cannot be planned in z space, because the rules that make
   * it fair are statements about gates -- a lift must be earned, a drag must
   * leave an opening -- and no gate exists yet. So planning and assignment are
   * split: planTempo draws the z ranges and the direction from the seed,
   * assignTempo picks the lane once the gate table and the occupancy spans are
   * built, and a mark that cannot be placed legally is DROPPED. Dropping is
   * safe in the one direction that matters: the window was widened for a lift
   * that then did not appear, which is spacing the course paid for and did not
   * use.
   *
   * THE NUMBERS.
   *
   *   COUNT      TEMPO_N_MIN to TEMPO_N_MAX planned a course, about half of
   *              which find a legal lane and a site worth weighting.
   *   LENGTH     46 to 88 units. At the base floor that is 1.6 to 3.0 real
   *              seconds -- "briefly", and long enough that PACE_EASE (2.2 s/mi
   *              per race-second, so 66 s/mi per REAL second) has settled the
   *              new pace inside the first tenth of the mark.
   *   WORTH      a lift over the median 67-unit mark is 67/240 * 7 = 1.95 race
   *              seconds; a drag over the same is 5.86. Both are measured end
   *              to end by tools/tempo.js rather than taken from this sum.
   *   SEPARATION no two marks within TEMPO_GAP, and never within SURGE_SIGHT of
   *              a surge zone, so no marking is ever read against another.
   *   f RANGE    0.10 to 0.94, the same window narrowRate and the ramp use.
   */
  const TEMPO_LEN_MIN = 46, TEMPO_LEN_MAX = 88;
  // RAISED WITH THE STEP LOWERED, and the two are one change. A mat is now
  // worth roughly a quarter of what it was, so the same total effect on a race
  // buys about four times as many of them -- and strategic placement needs
  // sites: at the shipped count a whole course carried SIX mats against ~180
  // gates and ~21 aid items, so all but a handful of the decisions the owner
  // asked to weight had no paint anywhere near them. The yield is about a half
  // (tools/tempo.js --section place), so this asks for roughly double what it
  // expects to land, which is the same arithmetic the shipped pair used.
  /**
   * ---- HOW MANY, AND THE SURGE'S ROAD IS WHAT PAYS FOR IT --------------
   *
   * 13 to 17 while the surge existed, which yielded SIX placed marks on the
   * day tools/playthrough.js walked -- because zones plus their sight
   * exclusion closed better than half the course to marks before one was
   * drawn. The surge is gone and all of that road is free.
   *
   * It has to be spent, not banked. simulate.js measured a policy spread of
   * 5.7 s against a 15 s floor with a dozen small mats on the road: a mat is
   * now the only thing separating one line from another, and a dozen of them
   * cannot separate anything. What makes a LOCAL, REPEATED decision add up to
   * a strategy is that it recurs -- so the count is what carries the axis the
   * surge's allocation used to carry, and this asks for roughly double what
   * the yield will land.
   */
  const TEMPO_N_MIN = 60, TEMPO_N_MAX = 76;
  // FROM 0.05, WHICH IS EARLIER THAN ANY OTHER MECHANIC IN THIS FILE OPENS,
  // and the reason is the opening rather than the mat. A mat is the only
  // decision this game has that costs NOTHING TO OWN -- no pool, no fuel, no
  // collected item -- so it is the one thing that can put a real choice in
  // front of a player who has nothing yet. 0.05 of the course is 315 units,
  // twice START_GRACE, so the clean runway the opening reads calmly on is
  // untouched.
  const TEMPO_F0 = 0.05, TEMPO_F1 = 0.94;
  /**
   * The separation between two marks, and it was SURGE_SIGHT because a mark
   * used to be up to 88 units of paint carrying an effect worth five race
   * seconds -- something to be read on its own, from a long way out.
   *
   * A mark is now at most TEMPO_PAINT_MAX of paint carrying a fraction of an
   * action, so what it has to be read against is smaller and what it costs to
   * misread is smaller with it. What the gap has to guarantee is that the next
   * mark is not already in the read window while the last one is still under
   * the runner's feet -- READ_NEAR is 25.35, so 50 clears it by nearly a
   * factor of two and roughly doubles how many marks the road can carry.
   */
  const TEMPO_GAP = 30;
  // The share of marks that are BACKWARD. Under a half on purpose: the drag is
  // the expensive half and the one that pushes the player out of a lane, and a
  // road where most marks are punishments reads as a penalty box rather than as
  // a set of choices.
  //
  // 0.52 -> 0.55 WITH THE DENSITY PASS, and the number is about what LANDS,
  // not what is planned. This share is applied at plan time, but a forward mat
  // must be EARNED (an action in its lane) and a drag needs its lane CLEAR at
  // every gate inside -- so a denser road converts more planned lifts into
  // placed ones and kills more planned drags. Measured at 0.52 over 60 days:
  // landed mats went fwd 19.6 / bwd 9.7 before the density change to
  // fwd 20.5 / bwd 8.5 after it, which handed the mat-chasing line about two
  // free seconds and moved the first-attempt column of the policy sweep off
  // its 20% bar. 0.55 restored the landed forward count exactly (19.67
  // against 19.60) and brought first-attempt to 7 of 30 -- one cell over, the
  // green-chasing line still a second inside the record at 0.995 -- and 0.57
  // is the notch that puts the landed drags back too and the column back on
  // 6 of 30. Measured at each step, not derived.
  const TEMPO_DRAG_SHARE = 0.57;
  /**
   * How far short of the gate that ENDS it a mark must stop.
   *
   * IT WAS 14 AND ITS DERIVATION HAS BEEN DELETED. 14 was the telegraph mat's
   * own run-up -- world.js laid 14 units of coloured paint on the road in
   * front of every hazard -- so it was the distance at which tempo paint would
   * start being read on top of gate paint. The owner removed the telegraph
   * mats entirely, so there is no gate paint left to run into and the number
   * has nothing behind it any more.
   *
   * What is left to clear is the HAZARD ITSELF, and the new number is that:
   * enough that a mark's end edge does not touch the near face of the object
   * standing at the gate it stops at. HAZARD_HALF_Z is the deepest half-depth
   * the fleet carries; 4 is comfortably outside it and small enough that a
   * mark now reaches the decision it was laid to weight instead of stopping
   * fourteen units short of it -- which is most of the strategic placement
   * this pass is for, bought by a deletion rather than by new code.
   */
  const TEMPO_TAIL = 4;
  // The longest run of PAINT, as against the longest planned RANGE. The plan
  // still draws a long range because spacingAt reserved the action window over
  // it before any gate existed and that reservation cannot be revisited; the
  // paint is a short mark placed inside that budget, on the decision. Every
  // unit of a shipped mark is inside its planned range, so the widening the
  // course already paid for covers it and nothing has to be re-validated.
  const TEMPO_PAINT_MAX = 64;
  // The shortest mark worth painting. LANE_TRANSIT is the ground two lane
  // changes cover, so anything at or under it is a mark the runner could be
  // through before the swerve that answers it has finished -- an instruction
  // with no time to obey. Three of those is 18 units, half a real second, and
  // it is a floor rather than a target: the median mark is 60.
  // A function, not a const, because LANE_TRANSIT is declared further down this
  // file -- the same temporal-dead-zone reason surgeBody() is a function.
  function tempoMinRun() { return 3 * LANE_TRANSIT; }

  function planTempo(key) {
    if (!(TEMPO > 0) || !(MR.Pace.EFFORT > 0)) return [];
    const rnd = MR.rng.stream(key, 'tempo/v1');
    const total = K.TOTAL_UNITS;
    const lo = TEMPO_F0 * total, hi = TEMPO_F1 * total;
    const marks = [];
    const want = rnd.int(TEMPO_N_MIN, TEMPO_N_MAX);
    let guard = 0;
    // ---- THE FIRST MARK IS MANDATED, AND IT IS A FORWARD ONE -------------
    //
    // Same reason the first surge zone is mandated: a uniform draw put the
    // first mat at mile 3.58 on average, which is inside the boredom trough
    // rather than in front of it. Mandating it lands one between mile 1.3 and
    // mile 2.9 every day.
    //
    // FORWARD, always, and that is a teaching decision rather than a balance
    // one. The first time a player meets this vocabulary it should PAY, so the
    // association is "the paint means speed" -- and then the first backward mat
    // is read against an association that already exists rather than being the
    // thing that has to establish it. A mechanic whose first appearance is a
    // punishment teaches avoidance of the paint, not reading of it.
    {
      // ---- THE SEPARATION CLAUSE THAT STOOD HERE WAS A REAL DEFECT ------
      //
      // The ordinary draw below refused any mark within SURGE_SIGHT of a surge
      // zone, and this mandated one was pushed with no clash test at all --
      // while the first zone was mandated too, into an overlapping stretch of
      // the opening. So the one mark every player was guaranteed to meet was
      // the one mark allowed to sit under a zone's gantry, and a chase frame
      // of exactly that collision is what turned it up. No headless number in
      // this file was watching for it.
      //
      // The surge is gone, so the clash it could have with is gone, and the
      // draw is one line again. The defect is recorded rather than deleted
      // because the shape of it will recur: a MANDATED thing skipping the
      // constraint every ORDINARY thing is held to.
      const len = rnd.range(TEMPO_LEN_MIN, TEMPO_LEN_MAX);
      const z0 = rnd.range(0.05 * total, 0.11 * total);
      marks.push({ z0, z1: z0 + len, dir: 1, first: true });
    }
    while (marks.length < want && guard++ < 900) {
      const len = rnd.range(TEMPO_LEN_MIN, TEMPO_LEN_MAX);
      const z0 = rnd.range(lo, hi - len);
      const z1 = z0 + len;
      let clash = false;
      for (const m of marks) if (z1 + TEMPO_GAP > m.z0 && z0 - TEMPO_GAP < m.z1) { clash = true; break; }
      // A second clause stood here and went with the surge: no mark inside or
      // within SURGE_SIGHT of a zone, because the zone's entry marking had to
      // be read from 90 units out and nothing could compete with it there.
      // With one speed system there is nothing left for a mark to compete
      // with, and the road that clause reserved -- better than half the course
      // once the exclusion bands were counted -- is now available to marks.
      if (clash) continue;
      marks.push({ z0, z1, dir: rnd.chance(TEMPO_DRAG_SHARE) ? -1 : 1 });
    }
    marks.sort(function (a, b) { return a.z0 - b.z0; });
    for (let i = 0; i < marks.length; i++) marks[i].n = i + 1;
    return marks;
  }

  /** The zone covering z, or null. Zones never overlap, so a scan is exact. */

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
        if ((g.ramp === l || g.ramp2 === l) && ramps) {
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

  /** True when no vehicle stands anywhere in `lane` between z0 and z1. */
  function laneFree(spans, lane, z0, z1) {
    const list = spans[lane];
    if (!list) return true;
    for (let i = 0; i < list.length; i++) {
      if (list[i].z1 > z0 && list[i].z0 < z1) return false;
    }
    return true;
  }

  /**
   * ---- WHERE A TEMPO MAT MAY LIE, AND THE OPEN-LANE GUARANTEE ------------
   *
   * This is the whole of the fairness argument for the backward mat, and every
   * clause of it is a condition that is CHECKED HERE at generation and CHECKED
   * AGAIN in validate() on the finished course. Neither is a comment.
   *
   * BOTH DIRECTIONS OWE THE SAME TWO THINGS:
   *
   *   READABLE   no vehicle stands in the mat's own lane from readWindowAt
   *              behind its near edge to its far edge. The paint is on the
   *              road, so the only thing that can hide it is a solid in the
   *              same lane -- and a full read window of clear sightline is the
   *              same standard readWindowAt already holds every gate to. A
   *              player who could not see which mat this is has been handed a
   *              speed change outside their control, which is rule 4.
   *   STANDABLE  the same clause does this for free: with no vehicle in the
   *              lane over the mark, a runner who elects the lane can hold it.
   *
   * A FORWARD MAT MUST BE EARNED. At least one gate inside the mark demands a
   * JUMP or a DUCK in the mat's own lane. Without that clause a lift is a free
   * 2 seconds for running in a straight line, and the owner asked for more
   * reward for NAVIGATING obstacles, not more reward for existing. A mark with
   * no gate inside it, or none that asks anything of the marked lane, is
   * dropped rather than placed free.
   *
   * A BACKWARD MAT MUST HAVE AN OPENING, AND THE OPENING IS CONSTRUCTED --
   * this is the owner's own constraint and it is the reason the drag is the
   * interesting half. Three clauses:
   *
   *   1. THE DRAGGED LANE IS CLEAR AT EVERY GATE INSIDE THE MARK. The drag is
   *      the ONLY price of that lane. Laying it on top of a hurdle would charge
   *      twice for one obstacle and give the player nothing to weigh.
   *   2. SOME OTHER LANE IS OPEN FOR THE WHOLE MARK -- not BLOCK at any gate
   *      inside it, and with no vehicle in it from LANE_TRANSIT before the near
   *      edge (the ground two lane changes cover) to the far edge. So there is
   *      always somewhere to go and always room to get there.
   *   3. THAT LANE IS RESERVED. No later mark may drag it over the same
   *      stretch. Without this the guarantee is order-dependent -- mark 7 could
   *      quietly poison mark 4's escape -- and a guarantee that depends on the
   *      order marks were placed in is not a guarantee.
   *
   * WHAT THE OPENING IS NOT PROMISED TO BE: empty. It may hold a JUMP or a
   * DUCK, and that is the trade the mechanic exists to create -- eat five
   * seconds in the slow lane, or pay one action to be in the fast one. It is
   * the same bargain a one-lane closure already makes, and makeGate never
   * allows a BLOCK to take the last open lane, so whatever stands in the
   * opening is passable with the right action. tools/tempo.js reports what
   * share of openings are CLEAR and what share demand an action, because that
   * split is the mechanic and it should be a number rather than a hope.
   */
  /**
   * ---- STRATEGIC PLACEMENT: A MAT WEIGHTS A DECISION, IT IS NOT ONE -------
   *
   * The owner: *"Placed strategically so that players need to make decisions.
   * Around obstacles, on top of vehicles, around water and bananas."* And the
   * intent handed down with it, which is the sentence to judge this code by:
   * A MAT SHOULD NEVER BE THE DECISION -- IT SHOULD CHANGE THE PRICE OF A
   * DECISION THE PLAYER WAS ALREADY MAKING.
   *
   * ---- WHY THE PLAN STILL DRAWS RANDOM RANGES, AND MUST -----------------
   *
   * There is a circularity here and it is worth stating because the obvious
   * design walks straight into it. Strategic placement wants to know where the
   * gates and the bottles are; but spacingAt() consults the tempo plan while
   * it is LAYING those gates, because a lift widens the action window and a
   * gate spaced for the unlifted pace would owe the player reaction time it
   * did not give. So the plan cannot wait for the gates and the gates cannot
   * wait for the plan.
   *
   * The way through is that the plan is a BUDGET rather than a placement. It
   * draws a long range, spacingAt widens the window across all of it, and this
   * function then paints a SHORT mark somewhere inside that range, on the
   * decision. Every unit of painted road is inside a range the course already
   * widened for, so the fairness arithmetic covers it with room to spare and
   * nothing has to be re-derived. The slack the trim does not use is spacing
   * the course paid for and did not spend -- the safe direction, and the same
   * bargain the trim rule already documents below.
   *
   * ---- WHAT COUNTS AS A SITE -------------------------------------------
   *
   *   AN AID ITEM in the mark's own lane is the strongest, and it is the case
   *   the owner named last and described most precisely. A bottle already sits
   *   behind an obstacle in that obstacle's lane, so collecting it is already
   *   a priced detour; a green mat makes that detour cheaper and a red one
   *   makes it dear. The SAME pickup becomes a different decision depending on
   *   what is painted around it, which is the whole ask in one object.
   *
   *   AN OBSTACLE in the mark's own lane is next, and for a lift it is not
   *   merely preferred, it is REQUIRED and always was -- clause 3, "a forward
   *   mat is earned". What changes here is that the paint is now positioned to
   *   ARRIVE at that obstacle with a full read window in hand, instead of
   *   starting wherever the plan's range happened to open.
   *
   *   A GATE WHERE THE LANES DIFFER is the weakest site and still a real one:
   *   somewhere a player is choosing between lanes at all.
   *
   * Ground with none of these is not painted. That is the difference between
   * this and the random draw it replaces, and it is why the yield is allowed
   * to fall: a mark that lands on nothing is decoration, and decoration is
   * what the near-band paint budget cannot afford.
   *
   * ---- WHAT IS NOT DONE, SAID HERE RATHER THAN DISCOVERED --------------
   *
   * ON TOP OF VEHICLES IS NOT BUILT. A deck is a different running surface at
   * DECK_Y, so a roof mat is not this mark moved upward: tempoAt would have to
   * answer for a lane the runner is riding rather than standing in, the strip
   * would have to be laid on the deck instead of on roadSurfaceY, and the lift
   * would have to enter spacingAt through ramps, which are created DURING gate
   * generation and so land on the far side of the same circularity described
   * above. It is a pass of its own and it is listed in the roadmap rather than
   * half-built here.
   */
  function assignTempo(key, marks, gates, spans, elev, aid) {
    if (!marks || !marks.length) return [];
    const rnd = MR.rng.stream(key, 'tempo/lane/v1');
    // Aid by lane, sorted, so a site test is a scan of a short list rather
    // than of the whole table. Roof items are excluded: a mat is painted on
    // the road and a bottle on a deck is not a decision this mark can price.
    //
    // RECEIPT ITEMS ONLY, since the abundance pass. A trail pickup is a
    // twenty-fourth of a segment lying in a free lane -- with hundreds of
    // them on the road, "there is a pickup here" stopped being a decision a
    // mat could price, and anchoring on one would put paint nearly
    // everywhere the seeded draw looked. An ARC (it.gate != null) is still
    // the old object: a string bought with an action at one gate, which is
    // exactly the priced detour the mat-site rule was written for.
    const aidLane = [[], [], []];
    for (const it of (aid || [])) {
      if (it && !it.roof && it.gate != null && it.lane >= 0 && it.lane < 3) aidLane[it.lane].push(it.z);
    }
    for (const l of aidLane) l.sort(function (a, b) { return a - b; });
    function aidIn(lane, z0, z1) {
      for (const z of aidLane[lane]) if (z >= z0 && z < z1) return z;
      return -1;
    }
    const out = [];
    // Per lane: stretches already spoken for, either by a mat or reserved as
    // some drag's guaranteed opening.
    const taken = [[], [], []];
    function busy(lane, z0, z1) {
      for (const t of taken[lane]) if (t.z1 > z0 && t.z0 < z1) return true;
      return false;
    }
    for (const m of marks) {
      const read = readWindowAt(m.z0, elev, marks);
      // The gates the mark spans, and the gate that owns its far edge -- the
      // mat must stop TEMPO_TAIL short of the next gate line so its paint never
      // runs into that gate's telegraph run-up.
      const inside = [];
      let nextZ = K.TOTAL_UNITS;
      for (let i = 0; i < gates.length; i++) {
        if (gates[i].z >= m.z0 && gates[i].z < m.z1) inside.push(i);
        else if (gates[i].z >= m.z1) { nextZ = gates[i].z; break; }
      }
      if (!inside.length) continue;            // nothing to earn, nothing to price
      const zCap = Math.min(m.z1, nextZ - TEMPO_TAIL);
      if (zCap - m.z0 < tempoMinRun()) continue;

      // ---- A MARK IS TRIMMED TO WHERE IT IS LEGAL, NOT DROPPED ------------
      //
      // The first version tested every gate the planned range covered and threw
      // the whole mark away on the first failure. That is the wrong answer to
      // the wrong question: the plan drew a range in Z SPACE before a single
      // gate existed, so where it happens to end has no meaning, and the rules
      // are all statements about a PREFIX of gates -- a lane that is CLEAR at
      // the first gate and a hurdle at the second is a perfectly good backward
      // mat that stops at the first gate.
      //
      // Measured: dropping cost 82% of the backward mats and left one a course,
      // which is not a mechanic. Trimming lands 4.3 with every clause intact.
      // The widening was planned for the longer range and the trim does not
      // give it back -- that is spacing the course paid for and did not use,
      // which is the safe direction and the only one available, since spacingAt
      // ran before any of this was known.
      let lane = -1, z0 = m.z0, z1 = zCap, best = -Infinity;
      for (let l = 0; l < 3; l++) {
        let k = 0, earns = -1;
        for (; k < inside.length; k++) {
          const h = gates[inside[k]].lanes[l];
          if (m.dir > 0 ? h === K.BLOCK : h !== K.CLEAR) break;
          if (earns < 0 && (h === K.JUMP || h === K.DUCK)) earns = gates[inside[k]].z;
        }
        if (!k || (m.dir > 0 && earns < 0)) continue;
        const cut = k < inside.length ? gates[inside[k]].z - TEMPO_TAIL : zCap;
        if (cut - m.z0 < tempoMinRun()) continue;

        // ---- THE ANCHOR: THE THING THIS MARK IS HERE TO PRICE ------------
        //
        // Ordered by how much of a decision it is, and a mark with no anchor
        // at all is not painted. A bottle first, then the obstacle a lift is
        // earned by, then the last gate the mark can reach -- which for a drag
        // is the gate that ends it, i.e. the moment the player has to be out
        // of this lane anyway.
        let anchor = aidIn(l, m.z0, cut), site = 3;
        // ---- A LIFT MUST STILL COVER THE THING IT IS EARNED BY -----------
        //
        // Clause 3 is that a forward mat has some gate inside it demanding an
        // action of the marked lane, and validate() re-derives it from the
        // SHIPPED mark. Anchoring on a bottle can slide the paint clear of the
        // hurdle that earned it -- 1 course in 90 did exactly that -- so an
        // aid anchor is only taken for a lift when the earning gate is still
        // inside the run the anchor would produce. Otherwise the obstacle wins
        // the anchor, which is the placement the owner asked for anyway.
        if (anchor >= 0 && m.dir > 0) {
          const t0 = Math.max(m.z0, Math.min(anchor - read, cut - tempoMinRun()));
          const t1 = Math.min(cut, t0 + TEMPO_PAINT_MAX);
          if (!(earns >= t0 && earns < t1)) anchor = -1;
        }
        if (anchor < 0 && earns >= 0 && earns < cut) { anchor = earns; site = 2; }
        if (anchor < 0 && m.dir > 0) continue;
        if (anchor < 0) {
          // A gate inside the reachable span where the lanes are not all the
          // same: somewhere a player is choosing at all.
          for (let j = 0; j < k; j++) {
            const gl = gates[inside[j]].lanes;
            if (gates[inside[j]].z >= cut) break;
            if (gl[0] !== gl[1] || gl[1] !== gl[2]) { anchor = gates[inside[j]].z; site = 1; break; }
          }
        }
        if (anchor < 0) continue;

        // Start a full read window before the anchor so the paint is on screen
        // with time to act on it, and never before the plan's own range began.
        // Then cap the run: the paint is short and the anchor is inside it.
        const a0 = Math.max(m.z0, Math.min(anchor - read, cut - tempoMinRun()));
        let a1 = Math.min(cut, a0 + TEMPO_PAINT_MAX);
        // ---- AND THE END IS SNAPPED CLEAR OF A GATE ----------------------
        //
        // The cap can land the far edge a metre or two short of a gate the
        // mark was perfectly entitled to cover, which validate() reads as the
        // paint stopping inside that gate's clearance -- and it is right to:
        // a mark that peters out just before an obstacle looks like the paint
        // giving up rather than like a mark that ends. Every gate up to `cut`
        // has already passed this lane's clause, so the answer is to reach
        // PAST it rather than to stop shorter. 24 of 60 courses failed
        // validate() before this, all of them for a few tenths of a unit.
        // The forbidden band is (gz - TEMPO_TAIL, gz] for every gate the mark
        // can reach: land there and the paint stops inside that gate's
        // clearance. Prefer to step PAST the gate -- it has already passed
        // this lane's clause, so covering it is legal and reads as a mark that
        // ends rather than one that gives up -- and retreat only when there is
        // no room ahead. Gates are at least 25 units apart and the band is 4,
        // so one pass settles it.
        for (let j = 0; j < k; j++) {
          const gz = gates[inside[j]].z;
          if (a1 > gz - TEMPO_TAIL && a1 <= gz) {
            const fwd = gz + TEMPO_TAIL;
            a1 = fwd <= cut ? fwd : gz - TEMPO_TAIL;
          }
        }
        if (a1 - a0 < tempoMinRun() || a1 <= anchor) continue;
        if (busy(l, a0, a1)) continue;
        if (!laneFree(spans, l, a0 - read, a1)) continue;
        // The SITE decides, not the length. More paint is no longer more of
        // the effect the plan asked for -- the effect is capped -- so what a
        // candidate is worth is how much of a decision it is standing on.
        // Ties break from the seeded stream so a course still varies.
        const score = site * 4 + rnd.next();
        if (score > best) { best = score; lane = l; z0 = a0; z1 = a1; }
      }
      if (lane < 0) continue;

      let open = -1;
      if (m.dir < 0) {
        const opens = [];
        for (let l = 0; l < 3; l++) {
          if (l === lane || busy(l, z0, z1)) continue;
          if (!laneFree(spans, l, z0 - LANE_TRANSIT, z1)) continue;
          let ok = true;
          for (const gi of inside) {
            if (gates[gi].z >= z1) break;
            if (gates[gi].z < z0) continue;
            if (gates[gi].lanes[l] === K.BLOCK) { ok = false; break; }
          }
          if (ok) opens.push(l);
        }
        if (!opens.length) continue;
        // Prefer an opening that is CLEAR the whole way through, so the escape
        // is free wherever the course can afford it, and fall back to one that
        // costs an action. Ties break from the seeded stream.
        let best = -Infinity;
        for (const l of opens) {
          let free = 1;
          for (const gi of inside) {
            if (gates[gi].z < z0 || gates[gi].z >= z1) continue;
            if (gates[gi].lanes[l] !== K.CLEAR) { free = 0; break; }
          }
          const score = free * 2 + rnd.next();
          if (score > best) { best = score; open = l; }
        }
        taken[open].push({ z0, z1 });
      }
      // TRIMMED WITH THE MARK, and the instrument is what said so. `inside` is
      // the gates the PLANNED range covered; the mark may have been cut short
      // of some of them, and a mat that publishes gates it does not cover made
      // tools/tempo.js re-derive the open-lane guarantee over ground the
      // generator had never claimed -- three false failures on 60 days. The
      // field a downstream reader trusts has to describe the object that
      // shipped, not the one that was asked for.
      const mat = { z0, z1, dir: m.dir, lane, open, n: out.length + 1,
                    gates: inside.filter(function (gi) {
                      return gates[gi].z >= z0 && gates[gi].z < z1;
                    }) };
      taken[lane].push({ z0, z1 });
      out.push(mat);
    }
    return out;
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

  /**
   * ---- CONES ON THE DECK, AND WHY A CONE IS THE ONLY LEGAL ROOF HAZARD ----
   *
   * The owner: *"Only obstacle on the roof can be cones."* Taken as a hard
   * constraint, and it is also the right one, for a reason worth writing down
   * so nobody adds a second kind later.
   *
   * A DECK HAS NO SIDEWAYS. It is one lane wide and the runner is committed
   * from the mouth to the dismount -- leaving sideways is a fall and costs the
   * streak. A DUCK up there is a demand with no alternative, and a BLOCK is a
   * wall with no alternative, which is not a decision at all and is arguably
   * the rule 4 failure this project fails builds for. A cone is low, needs no
   * overhead clearance, and asks for a jump the player can time. It is the only
   * one of the three verbs that works on a surface with no escape.
   *
   * ---- THE DECK LAYOUT IS DERIVED, EVERY NUMBER OF IT --------------------
   *
   *   z0                      the gate line, the foot of the tailgate
   *   z0 + RAMP_RUN           the top of the tailgate; deck at DECK_Y
   *   + CONE_APPROACH         a FULL action window of flat deck before the cone
   *   the cone                Collision.BOX[JUMP], resolved against the DECK
   *   + CONE_LAND             the whole airborne span, so the arc finishes on
   *                           the deck rather than in mid-air over the road
   *   z1                      the far face; dismount
   *
   * CONE_APPROACH is actionWindowAt, not a chosen number: it is the same window
   * every gate on the road owes the player, and the deck owes it too. The cone
   * itself is visible long before the mount -- it stands at 2.80 to 3.60, above
   * K.CAM_BASE_Y at 2.62, so no vehicle can occlude it and the read is made
   * from the road. What the deck has to supply is the room to ACT.
   *
   * CONE_LAND is JUMP_TIME * MAX_SPEED, the airborne span, and it is the clause
   * that stops the mechanic handing out free clears: a runner still airborne at
   * the dismount arrives at the next road gate with `surface` above the DUCK
   * bar and `y` above the JUMP block, which clears both for nothing. That is
   * the exact exploit player.js's FALL_TIME note is about, one storey up.
   *
   * So a coned deck needs RAMP_RUN + ACTION_WINDOW + CONE_LAND = 46.84 units of
   * depth, against 42.5 for the longest ramp the game ships. The span therefore
   * goes to 13-16 (49.5 to 60.1 units) when a cone is on it, which is the honest
   * cost of the mechanic and is charged to the course through reachOf exactly
   * as every other vehicle length is.
   */
  const CONE_LAND = K.JUMP_TIME * MAX_SPEED;
  const ROOF_SPAN_MIN = 13, ROOF_SPAN_MAX = 16;
  // RAMP_SPAN_MAX is read by surgeBody(), which decides how far in front of a
  // zone the marked lane is forced open. A longer rideable train means a longer
  // body, and getting that from ONE place is what stops the two disagreeing.
  // At ROOF = 0 it is the shipped 11 and the course is untouched.
  function rampSpanMax() { return ROOF > 0 ? ROOF_SPAN_MAX : RAMP_SPAN_MAX; }

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
   * game should be run somewhere you have heard of. ONE of them hosts each
   * day's race -- see pickSettings. Each is a real marathon city with
   * landmarks that can be modelled in this game's own flat-shaded style -- no
   * photography, no licensed imagery, nothing fetched at runtime.
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
    { tag: 'VALENCIA',  name: 'VALENCIA',      hint: 'the City of Arts and Sciences, the Serranos gate, palms, orange groves, white stone' },
    { tag: 'AMSTERDAM', name: 'AMSTERDAM',     hint: 'canals, gabled houses, bicycle racks, humpback bridges, a smock windmill' },
    { tag: 'ROME',      name: 'ROME',          hint: 'the Colosseum, an aqueduct, umbrella pines, ochre walls' },
    { tag: 'CAPETOWN',  name: 'CAPE TOWN',     hint: 'Table Mountain, the coast road, the Green Point lighthouse, the stadium, fynbos' },
  ];

  /**
   * Pick this date's course setting: ONE city, dealt from a shuffled bag of
   * the twelve. The owner's decision, docs/one-city-a-day.md (roadmap 73).
   *
   * It was three or four per run, jitter-split down the course, on stream
   * 'settings/v1'. Measured over a year that draw made every day blur into
   * the last -- 73.6% of consecutive days shared a city, a given city came
   * back after a median of 2-3 days -- so no day was ever ABOUT anywhere.
   * One city makes the day nameable ("today is the Rome course"), and the
   * bag is the only deal worth shipping: an independent uniform draw of one
   * has a worst same-city gap of 65 days and 36 back-to-back repeats a year.
   *
   * THE BAG. Day N of a 12-day cycle deals entry N of that CYCLE's shuffle,
   * so every city appears exactly once per cycle and the worst repeat gap is
   * 23 days (last of one cycle, first of the next, both drawn fairly).
   *
   *   day    = the UTC epoch-day of the PASSED key -- never the wall clock;
   *            the determinism rule at the top of this file holds. Date.UTC
   *            of a calendar midnight is an exact multiple of 86400000 (Unix
   *            time has no leap seconds), and epoch days count straight
   *            through month and year boundaries, so a cycle that starts on
   *            December 27th ends on January 7th with no seam and no reset.
   *            Every client agrees on the cycle for any date, past or future
   *            (Math.floor keeps cycle/pos consistent even pre-1970).
   *   cycle  = floor(day / 12); pos = day - cycle * 12, always in 0..11.
   *   deal   = Fisher-Yates over the twelve on a stream keyed by the CYCLE,
   *            not the date -- all twelve days of a cycle deal from the SAME
   *            shuffle, which is what makes it a bag rather than twelve
   *            independent draws.
   *
   * The stream salt is 'settings/v2', retiring 'settings/v1' with the draw it
   * described: a stream name is never reused for a different draw.
   *
   * IDENTITY-SAFE, and checked rather than claimed: settings are drawn on
   * their own stream, assigned after generate() has finished the gates and
   * the aid, and nothing in generation reads them -- so tools/mechanics.js
   * --identity (gate and aid hashes over 365 days) must not move under this
   * change. If it moves, this function has been made to touch something it
   * must not.
   */
  function pickSettings(key) {
    const p = key.split('-');
    const day = Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
    const cycle = Math.floor(day / SETTINGS.length);
    const pos = day - cycle * SETTINGS.length;

    const rnd = MR.rng.stream('cycle:' + cycle, 'settings/v2');
    const bag = SETTINGS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rnd.int(0, i);
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }

    const s = bag[pos];
    return [{
      tag: s.tag, name: s.name, hint: s.hint,
      from: 0, to: 1, first: true, last: true,
    }];
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

  function spacingAt(f, rnd, z, elev, lanes, train, tempo) {
    const d = difficulty(f);
    // 44 units early, tightening as difficulty rises. The floor is
    // ACTION_WINDOW itself rather than a number chosen to sit near it: the
    // solver rejects anything that would demand two conflicting actions inside
    // that distance, so the generator can be pushed right to the edge of the
    // rule and let the proof hold the line. Tying the two together means a
    // retune of the jump arc or the pace floor moves both ends of the same
    // constraint at once, instead of moving one and leaving the other stale.
    // ---- TRIED FOR THE DENSITY PASS AND PUT BACK, WITH THE NUMBER -------
    //
    // The density pass tried 40.5 - 22 * d here, on the argument that density
    // has two factors and gates per mile should carry part of the lift. The
    // sweep refused it: ten extra gates a course made a CLEAN run ~20 s
    // faster, because pace follows the streak and the streak is a count of
    // CLEARED GATES -- so gates per mile is a speed dial before it is a
    // density dial, and the record is an absolute 1:59:30. First-attempt
    // cells beating the record went 20% to 80%, at PERFECT skill, where no
    // amount of extra hazard demand can claw it back. This is the measured
    // form of what roadmap 58 said in passing: spacing is not the density
    // lever. Density comes from nHaz and `full` above, which add hazards
    // without adding streak.
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
    //
    // A TEMPO MARK IS A STEP FOR EXACTLY THE SAME REASON A ZONE IS, so it goes
    // through the same forward look and not through a wider pad. The look is
    // taken when there are zones OR marks, and skipped when there are neither
    // -- which is what keeps the expression character-for-character the old one
    // at EFFORT = 0, where both lists are empty.
    const reach = reachOf(lanes, train);
    const first = Math.max(readWindowAt(z, elev, tempo) + reach,
                           mean * rnd.range(0.84, 1.16));
    const stepped = tempo && tempo.length;
    if (!stepped) return first;
    return Math.max(first, readWindowAt(z + first, elev, tempo) + reach);
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
    // ---- RAISED FOR THE DENSITY PASS, AND THE BAR WAS RE-MEASURED --------
    //
    // The owner, across weeks: more obstacles, lots more. The bag went 26 to
    // 37 variants first, deliberately, because freshness cannot exceed
    // objects / density -- and with the bag enlarged this is the density half
    // of that sequence. Two dials move together here: this table (three-lane
    // gates, which FORCE an action) and the mid-band chance on nHaz below.
    // 7b0a1d2 left `full` alone on the argument that forced actions are a
    // harsher change needing their own evidence; the evidence now exists --
    // the difficulty bar is measured (tools/simulate.js policy x skill sweep,
    // ~20% of first-attempt cells beat 1:59:30, held through two retunes) and
    // the sweep was re-run either side of this change to hold it.
    // ---- RAISED AGAIN FOR THE 5% PASS ------------------------------------
    //
    // The owner: "Make the game tougher. Only 5% of first runs should result
    // in a win. This should mean more obstacles and paths." Roadmap 72's
    // finding stands -- gates per mile is a speed dial before it is a
    // density dial -- so the lift is again hazards PER gate, which adds
    // demand without adding streak: this table (+0.06 a band) and the
    // mid-band slope below. Measured either side with the policy x skill
    // sweep; numbers in roadmap 73.
    const full = d < 0.14 ? 0
      : d < 0.34 ? 0.22
      : d < 0.58 ? 0.46
      : d < 0.80 ? 0.64
      : 0.76;
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
    // ---- THE MIDDLE BAND: A COIN FLIP BECAME A DIAL ----------------------
    //
    // rnd.int(1, 2) held the second hazard at a flat 50% from mile 0.7 to
    // mile 8.2, and that flat line is the trough of boredom: measured over 60
    // days, miles 3-7 carried 11.68 hazards/mi against 17.21 on the rest of
    // the race. The chance now rises with difficulty, continuous with the old
    // value at the band's floor -- at d = 0.09 it is exactly the 0.50 the
    // coin gave, so the opening two thirds of a mile and the learning stretch
    // just after it are untouched -- and reaches ~0.96 where the band hands
    // over to the always-2 rule, so there is no seam there either. One draw
    // either way, same as the coin it replaces.
    // 1.40 -> 1.70 with the 5% pass: the second hazard arrives still earlier
    // through the mid-band. Continuous with the 0.50 coin at d = 0.09 as
    // before, so the opening two thirds of a mile and the learning stretch
    // stay untouched; the chance saturates near d = 0.38 instead of 0.42.
    const nHaz = rnd.chance(full) ? 3
      : d < 0.09 ? 1
      : d < 0.42 ? (rnd.chance(0.50 + 1.70 * (d - 0.09)) ? 2 : 1)
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
    // 0.06 -> 0.08 with the 5% pass. "More paths" in the owner's brief, and
    // the cheap version that survives every constraint (docs/strategy-space.md
    // ranks the full geometric fork out of scope): a closure is a committed
    // route choice -- the road tapers, the survivor lane is chosen from what
    // can be read, and the choice holds for 2-4 gates. Still a punctuation
    // mark, not a texture: ~5 a course against ~3.7.
    return 0.08 * NARROW;
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
   * ---- AID IS ABUNDANT NOW, AND THE OLD RULE IS RETIRED ON PURPOSE --------
   *
   * The owner: *"Adjust the water and bananas. We need countless of them
   * similar to these other games that have coins. That keeps players
   * engaged."* So aid stops being ~16 scarce items, each a whole guard
   * segment, each a priced decision behind an obstacle -- and becomes
   * hundreds of small pickups laid the way the reference game strews coins:
   * TRAILS down open lanes, ARCS behind the obstacles that earn them,
   * CLUSTERS after the hard sections, RUNS along the roofs. A pickup is a
   * bite of a segment (Pace.EFFORT_CFG.PER_SEG of them fill one), so the
   * pool economy stays near the old one while the road reads collect,
   * collect, collect.
   *
   * ---- WHAT IS RETIRED, RECORDED HONESTLY --------------------------------
   *
   * Roadmap 50's rule -- "a bottle stands behind an obstacle, in that
   * obstacle's own lane, at a gate that also offers a lane through for
   * nothing" -- is deliberately retired for the TRAIL and CLUSTER items.
   * That rule solved a real defect: when a bottle was a whole segment, a
   * free bottle was free insurance and tools/aid.js measured 56% of them
   * costing nothing. Abundance is a different design: one pickup is worth a
   * twenty-fourth of a segment, so a free one is a twenty-fourth of the
   * problem, and the owner has chosen engagement over scarcity with the item
   * count. What survives of the old rule is its POINT, moved up a level:
   * the guard economy as a whole must still be priced, which is now done by
   * the denomination (PER_SEG), by the guarded share below, and by the
   * guard's own residual cost (Pace.EFFORT_CFG.GUARD_TIME). tools/aid.js
   * measures collectable segments per race and fails the build when the
   * economy inflates.
   *
   * ---- WHAT IS NOT FREE, AND WHY THOSE ITEMS STILL CARRY A RECEIPT -------
   *
   * An ARC stands behind a JUMP or a DUCK, in that hazard's own lane, and is
   * bought AT THAT GATE exactly as the old bottles were -- the gate-receipt
   * machinery in player.resolveAid is unchanged, because the reason it
   * exists (a lane match at a point can be cheated by a swerve, measured at
   * 13 of 14 items in roadmap 50) is as true for five pickups as it was for
   * one. So the richest features on the road still reward the action that
   * earns them, mid-jump over the block or flat under the bar, and a line
   * that never takes an obstacle collects only the trail share. Collection
   * still correlates with skill; it just stops being all-or-nothing.
   *
   * Nothing here can affect Course.solvable(). Aid reads the gate table and
   * writes nothing back, so the clean path of a player who ignores every
   * pickup on the course is the one the BFS proved, untouched.
   *
   * ---- THE FOUR SHAPES, AND WHAT EACH ONE PAYS FOR -----------------------
   *
   *   TRAIL     a run of pickups down a lane that is CLEAR at the gate it
   *             starts behind and holds no vehicle over its whole length.
   *             Free to collect by design -- the flow the owner asked for --
   *             and worth the least per unit of attention: each item is one
   *             PER_SEG-th of a segment. Ends short of the next gate line so
   *             it never leads the eye into a hazard read.
   *   ARC       pickups behind a JUMP or a DUCK, in that hazard's lane,
   *             receipt-guarded at that gate. Behind a JUMP they hang on the
   *             falling half of the jump arc (`y` above the local road, the
   *             same field roof items already carry); behind a DUCK they lie
   *             low where the slide comes out. One action buys the whole
   *             string, which keeps "collection correlates with skill".
   *   CLUSTER   a burst after a BLOCK train or a full-width gate, in a lane
   *             that is open there -- the reward for coming through a hard
   *             section still moving.
   *   ROOF RUN  the deck carries a line of pickups instead of one bottle.
   *             Collection still requires standing on the ramp; roof trails
   *             stay roof-only.
   *
   * AID_SETBACK survives from the old rule and for the old reason: an item
   * laid inside a DUCK bar's own depth would interpenetrate the art, so the
   * first item of an ARC sits the rear face plus this behind its obstacle.
   */
  const AID_SETBACK = 0.35;
  // Trail items every this many units -- close enough to read as a line from
  // READ_NEAR, far enough apart that each one registers as taken.
  const AID_STEP = 6.0;
  // Where an arc's items sit behind a JUMP, along the falling half of the
  // jump arc. Heights are above the LOCAL ROAD, the exact field (`y`) roof
  // items carry, and they stay under the duck bar's 1.41 underside so an
  // elevated pickup can never read as overhead furniture.
  const ARC_DZ = [0.0, 2.4, 4.8, 7.2, 9.6];
  const ARC_Y  = [1.30, 1.00, 0.66, 0.32, 0.0];

  /**
   * The lane an ARC may stand in behind gate `gi`, or -1 if this gate is the
   * wrong shape. The clauses are roadmap 50's, kept for the one item class
   * that is still priced:
   *
   *   the gate leaves some lane CLEAR   -- declining is free
   *   the aid lane holds a JUMP or DUCK -- the obstacle the arc hangs off
   *   the next gate does not BLOCK it   -- paying once buys it outright
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

  function generateAid(key, gates, ramps, spans) {
    // v5: the ECONOMY changed -- countless small pickups instead of ~16
    // whole-segment bottles -- so the stream is renamed rather than silently
    // reused, exactly as v4 was when the placement rule changed. The gate
    // stream is untouched by this function; only the aid identity baseline
    // moves, and tools/mechanics.js hashes the two separately for exactly
    // this moment.
    const rnd = MR.rng.stream(key, 'aid/v5');
    const items = [];
    if (!gates.length) return items;

    /**
     * ---- THE ROOF RUN ----------------------------------------------------
     *
     * The reason there is anything up there is unchanged (a ramp with no
     * reward is strictly dominated -- see roadmap 63); what changed is the
     * denomination. One bottle was one segment; one bottle is now a sip, so
     * a single item would make the roof a rounding error. The deck carries a
     * LINE of pickups instead -- the reference game's gold bars along the
     * bin lorry's roof, literally -- spaced like a road trail, never on the
     * tailgate, and behind the cone where the deck carries one so the jump
     * up there is still what the string is bought with.
     *
     * Its own seeded stream, so the road items cannot shift when RAMP moves;
     * skipped entirely when there are no ramps, so at RAMP = 0 no number is
     * drawn at all. `y` is height above the LOCAL ROAD, the interface the
     * renderer draws from; collection still requires standing on the ramp
     * (player.resolveAid), so roof trails stay roof-only.
     */
    if (ramps && ramps.length) {
      const rr = MR.rng.stream(key, 'aid/roof/v2');
      for (const r of ramps) {
        const flat0 = r.cone ? r.cone + 2 * HAZARD_HALF_Z[K.JUMP] : r.z0 + r.run;
        const flat1 = r.z1 - 1.5;
        const room = flat1 - flat0;
        if (room < 2 * AID_STEP) continue;
        const n = Math.min(5, Math.max(3, Math.floor(room / AID_STEP)));
        const step = room / n;
        for (let i = 0; i < n; i++) {
          const fruit = rr.chance(0.3);
          items.push({
            z: flat0 + step * (i + 0.5), lane: r.lane, y: DECK_Y,
            roof: true, guarded: true,
            kind: fruit ? 'banana' : 'water',
            gain: fruit ? K.AID_BANANA : K.AID_WATER,
          });
        }
      }
    }

    /**
     * ---- THE ROAD: ONE FEATURE PER GATE, DRAWN IN GATE ORDER -------------
     *
     * The walk is over GATES rather than over a z cursor, because every
     * feature hangs off a gate's shape: a cluster off a hard gate, an arc
     * off an obstacle, a trail off the gap to the next gate. One feature per
     * gate is the density governor -- it caps the road at a readable
     * collect-line per screen rather than a carpet -- and the draw order is
     * the gate order, so the stream is deterministic by construction.
     */
    const end = K.TOTAL_UNITS - FINISH_GRACE - 30;
    const first = START_GRACE + 40;

    for (let gi = 0; gi < gates.length; gi++) {
      const g = gates[gi];
      if (g.z < first || g.z > end) continue;
      const next = gi + 1 < gates.length ? gates[gi + 1] : null;
      const nextZ = next ? next.z : K.TOTAL_UNITS;
      const nextLanes = next ? next.lanes : [K.CLEAR, K.CLEAR, K.CLEAR];

      // ---- CLUSTER: the burst after a hard section -----------------------
      //
      // A BLOCK train or a full-width gate is the course asking its hardest
      // question, so the road just past it pays a handful at once -- the
      // reward for coming through still moving, and the refill point for a
      // pool that guard has just been drawing down. Laid past the deepest
      // box the gate stands in the road (reachOf), in a lane with no vehicle
      // over the whole burst and no wall at the next gate, so collecting it
      // never leads anywhere the player cannot leave.
      const hard = g.train > 0 || g.lanes.every(function (l) { return l !== K.CLEAR; });
      if (hard && rnd.chance(0.62)) {
        const z0 = g.z + reachOf(g.lanes, g.train) + 3;
        // Three caps, and the third was missing first time: the burst is
        // short, it stops before the next gate, and it stops before the
        // tape's clear run-in -- a gate can stand as late as `end` and a
        // train's reach carries the burst up to 33 units past it, which
        // walked one item into FINISH_GRACE on day 44 of a 60-day sweep.
        // The exact class of defect the ramp's run-in had (roadmap 63), and
        // the reason tools/aid.js asserts the tape line on every item.
        const z1 = Math.min(z0 + 12, nextZ - 6, K.TOTAL_UNITS - FINISH_GRACE - 2);
        if (z1 - z0 >= 8) {
          const cands = [];
          for (let l = 0; l < 3; l++) {
            if (nextLanes[l] === K.BLOCK) continue;
            if (spans && !laneFree(spans, l, z0, z1)) continue;
            cands.push(l);
          }
          if (cands.length) {
            const c = cands[rnd.int(0, cands.length - 1)];
            // A diamond: a line up the chosen lane with the middle widened
            // into the free neighbours -- the reference game's cluster shape,
            // as near as three discrete lanes can spell it.
            const mid = (z0 + z1) / 2;
            const put = function (lane, z) {
              const fruit = rnd.chance(0.35);
              items.push({ z, lane,
                kind: fruit ? 'banana' : 'water',
                gain: fruit ? K.AID_BANANA : K.AID_WATER });
            };
            put(c, z0);
            put(c, mid - 2.2); put(c, mid + 2.2);
            for (const d of [-1, 1]) {
              const l = c + d;
              if (l < 0 || l > 2 || cands.indexOf(l) < 0) continue;
              put(l, mid);
            }
            put(c, z1);
            continue;
          }
        }
      }

      // ---- ARC: the string an action buys --------------------------------
      //
      // Behind a JUMP the items hang on the falling half of the jump arc,
      // collectable mid-flight; behind a DUCK they lie flat where the slide
      // comes out. Receipt-guarded at this gate -- the roadmap 50 machinery,
      // unchanged -- so the whole string is bought by being in the hazard's
      // lane when the gate resolves, and a cut-in swerve still buys nothing.
      const arcLane = aidLaneAt(gates, gi, rnd);
      if (arcLane >= 0 && rnd.chance(0.52)) {
        const kind = g.lanes[arcLane];
        const base = g.z + 2 * HAZARD_HALF_Z[kind] + AID_SETBACK;
        const n = kind === K.JUMP ? ARC_DZ.length : 4;
        const fruitAt = rnd.int(1, n - 2);
        for (let i = 0; i < n; i++) {
          const it = {
            z: base + ARC_DZ[i], lane: arcLane, gate: gi, guarded: true,
            kind: i === fruitAt ? 'banana' : 'water',
            gain: i === fruitAt ? K.AID_BANANA : K.AID_WATER,
          };
          // Elevated only behind a JUMP: the falling half of the arc. The
          // heights stay under the DUCK bar's 1.41 underside, so a lifted
          // pickup can never read as overhead furniture.
          if (kind === K.JUMP && ARC_Y[i] > 0) it.y = ARC_Y[i];
          items.push(it);
        }
        continue;
      }

      // ---- TRAIL: the line down the open lane ----------------------------
      //
      // The collect-collect-collect of the reference game, free by design --
      // see the retirement note above. In a lane that asks nothing at this
      // gate, holds no vehicle over the run, and is not walled at the next,
      // ending well short of the next gate line so the line of pickups never
      // leads the eye into a hazard read.
      if (next && nextZ - g.z >= 30 && rnd.chance(0.55)) {
        const cands = [];
        for (let l = 0; l < 3; l++) {
          if (g.lanes[l] !== K.CLEAR || nextLanes[l] === K.BLOCK) continue;
          if (spans && !laneFree(spans, l, g.z, nextZ)) continue;
          cands.push(l);
        }
        if (cands.length) {
          const l = cands[rnd.int(0, cands.length - 1)];
          const t0 = g.z + 3;
          const t1 = nextZ - 8;
          const n = Math.min(8, Math.floor((t1 - t0) / AID_STEP) + 1);
          if (n >= 3) {
            const step = (t1 - t0) / (n - 1);
            for (let i = 0; i < n; i++) {
              const fruit = rnd.chance(0.1);
              items.push({ z: t0 + i * step, lane: l,
                kind: fruit ? 'banana' : 'water',
                gain: fruit ? K.AID_BANANA : K.AID_WATER });
            }
          }
        }
      }
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
    // ...and the tempo marks in the same breath and for the same reason: a LIFT
    // mark widens the action window over its own stretch, spacingAt and
    // solvable() both read that window, and both are called on every gate. Only
    // the Z RANGES and the DIRECTIONS are decided here; the LANE is assigned
    // once gates and occupancy exist. See planTempo and assignTempo.
    const tempoPlan = planTempo(key);

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
          if (cand.every((l) => l === K.BLOCK)) continue;

          tally.attempts++;
          const trial = gates.concat([{ z, lanes: cand, f }]);
          if (solvable(trial, elevation, tempoPlan)) { lanes = cand; break; }
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
        tally.degraded++;
      }

      let span = maybeTrain(rnd, f, lanes);
      let rampLane = -1;
      let ramp2Lane = -1;
      let coneAt = 0;
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
                // ---- A CONE ON THE DECK ------------------------------------
                //
                // The vehicle grows to carry it, because the layout above is
                // derived and does not fit inside 42.5 units. Rolled BEFORE the
                // pair below so both vehicles of a pair are the same length --
                // gate.train is one number and buildSpans applies it to every
                // BLOCK lane in the gate, so two paired decks abut laterally
                // over their whole run by construction rather than by care.
                if (ROOF > 0 && rnd.chance(0.55)) {
                  span = rnd.int(ROOF_SPAN_MIN, ROOF_SPAN_MAX);
                  const depth = 2 * HAZARD_HALF_Z[K.BLOCK] * (1 + span * 0.9);
                  const cz = z + RAMP_RUN + actionWindowAt(z, elevation, tempoPlan);
                  // The arc has to finish on the deck. If it does not, there is
                  // no cone -- never a cone with a short landing, because a
                  // runner still airborne at the dismount clears the next road
                  // gate for nothing whatever kind it is.
                  if (cz + CONE_LAND <= z + depth) coneAt = cz;
                }
                // ---- TWO DECKS SIDE BY SIDE --------------------------------
                //
                // The owner: *"You can add two vehicles with ramps together so
                // they can cross on them."* Adjacent lanes rather than in
                // series, and that is a measurement rather than a preference --
                // see the note on ROOF above the flag.
                //
                // It adds NO new lane state and no new spacing: both vehicles
                // are BLOCK lanes this gate already had, both carry the same
                // train span, so reachOf is unchanged and solvable() sees the
                // gate it already proved. What is new is only that the second
                // roof can be stood on.
                if (ROOF > 0 && rnd.chance(0.55)) {
                  for (let l2 = 0; l2 < 3; l2++) {
                    if (l2 === l || lanes[l2] !== K.BLOCK || trainUntil[l2] > idx) continue;
                    // Never the only way through: some third lane must still be
                    // passable at this gate. makeGate's all-BLOCK guard already
                    // guarantees it, and this says so rather than trusting it.
                    const rest = [0, 1, 2].filter((x) => x !== l && x !== l2);
                    if (!rest.some((o) => lanes[o] !== K.BLOCK)) continue;
                    ramp2Lane = l2;
                    break;
                  }
                  // ---- AND IF THE GATE HAS ONLY ONE WALL, BUILD THE SECOND --
                  //
                  // Waiting for a gate that happened to roll two BLOCKs with a
                  // ramp on one of them produced 0.13 pairs a course, which is
                  // a mechanic nobody meets. So the second wall is MADE, and
                  // the safety comes from the one place safety comes from in
                  // this file: the converted gate goes through solvable()
                  // exactly as the roll did, and is abandoned if the proof does
                  // not survive it.
                  //
                  // This is the ONE place ROOF adds a BLOCK the generator did
                  // not ask for, so it is the one place it can make a gate
                  // harder. It cannot make one unsolvable, and it cannot take
                  // the last lane -- the third lane is required to be passable
                  // before the trial is even built.
                  if (ramp2Lane < 0) {
                    for (let l2 = 0; l2 < 3; l2++) {
                      if (l2 === l || lanes[l2] === K.BLOCK || trainUntil[l2] > idx) continue;
                      const rest = [0, 1, 2].filter((x) => x !== l && x !== l2);
                      if (!rest.some((o) => lanes[o] !== K.BLOCK)) continue;
                      const cand = lanes.slice();
                      cand[l2] = K.BLOCK;
                      const trial = gates.concat([{ z, lanes: cand, f }]);
                      if (!solvable(trial, elevation, tempoPlan)) continue;
                      lanes[l2] = K.BLOCK;
                      ramp2Lane = l2;
                      break;
                    }
                  }
                }
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
        if (ramp2Lane >= 0) gate.ramp2 = ramp2Lane;
        const rideLanes = ramp2Lane >= 0 ? [rampLane, ramp2Lane] : [rampLane];
        for (const rl of rideLanes) ramps.push({
          lane: rl,
          z0: z,
          // The far face of the train, from the SAME expression reachOf and
          // world.js's gateBoxes use. Written once here rather than restated,
          // because a roof that ends somewhere other than where the box ends is
          // a runner standing on air or inside a lorry.
          z1: z + 2 * HAZARD_HALF_Z[K.BLOCK] * (1 + span * 0.9),
          run: RAMP_RUN,
          deck: DECK_Y,
          // The cone stands on the PRIMARY deck only. That is the whole of what
          // makes a pair a decision rather than a corridor: one roof asks for a
          // jump, the other does not, and the crossing between them is free and
          // level because both decks are DECK_Y. A pair with a cone on each
          // would be two corridors side by side.
          cone: rl === rampLane ? coneAt : 0,
          pairs: ramp2Lane >= 0,
        });
      }
      gates.push(gate);
      // The LANES and the span both go in because the gap after a gate is owed
      // by the geometry of THAT gate: which kinds it actually stands in the road
      // decides how deep its deepest lane is, and a train's rear face is a long
      // way further forward than its gate line says.
      z += spacingAt(f, rnd, z, elevation, lanes, span, tempoPlan);
    }

    const mileMarkers = [];
    for (let m = 1; m <= 26; m++) mileMarkers.push({ mile: m, z: m * K.UNITS_PER_MILE });
    mileMarkers.push({ mile: K.MARATHON_MILES, z: K.TOTAL_UNITS, finish: true });

    // Spans FIRST, and the reordering is load-bearing: generateAid's trails
    // and clusters refuse any lane a vehicle stands in, and the spans are the
    // one statement of where vehicles stand. buildSpans reads gates and ramps
    // only, draws nothing from the seeded stream, and never read aid -- so
    // moving it up cannot change a single gate or ramp.
    const spans = buildSpans(gates, ramps);
    const aid = generateAid(key, gates, ramps, spans);
    // The lane, last, because every rule that makes a mat fair is a statement
    // about gates and about where the vehicles ended up.
    const tempo = assignTempo(key, tempoPlan, gates, spans, elevation, aid);
    const tempoLanes = [[], [], []];
    for (const m of tempo) tempoLanes[m.lane].push(m);
    const course = { key, gates, aid, mileMarkers, biomes: BIOMES, length: K.TOTAL_UNITS,
                     elevation, ramps, spans, tempo, tempoPlan, tally };

    /**
     * The zone the runner is in, or null. Read by the renderer to lay the
     * marking, by the HUD to say a zone is coming, and by main.js every frame
     * to decide whether the runner has elected the surge.
     */

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
     * The tempo mat under (z, lane), or null.
     *
     * Mats never overlap within a lane -- assignTempo's `taken` list is what
     * makes that true -- so the same binary search occupancy uses is exact
     * here. Read by player.resolveTempo every frame, by the renderer to lay the
     * paint, and by the HUD to name what the runner is standing on.
     */
    course.tempoAt = function (z, lane) { return spanAt(tempoLanes, z, lane); };

    /**
     * The next mat ahead of z in ANY lane, or null. What the HUD announces, in
     * the same shape the surge nag already uses -- the player is owed a warning
     * that a lane is about to become slow, and the paint is the primary channel
     * for that but not the only one.
     */
    course.tempoAhead = function (z, look) {
      let best = null;
      for (const m of tempo) {
        if (m.z0 <= z || m.z0 > z + look) continue;
        if (!best || m.z0 < best.z0) best = m;
      }
      return best;
    };

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

    // This date's place -- ONE city since the one-city-a-day decision, still
    // carried as a list because every consumer walks a list and the seam
    // machinery downstream stays dormant rather than deleted. Carried
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
  function solvable(gates, elev, tempo) {
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
            && g.z - s.z < actionWindowAt(s.z, elev, tempo)) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < actionWindowAt(az, elev, tempo) ? 1 : 0);
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
    // The PLAN, not the placed mats: the window was widened for every planned
    // lift, whether or not a lane could be found for it, so the spacing floor
    // this loop re-proves has to be evaluated against the same list spacingAt
    // used. Checking against the placed list would look for a floor the
    // generator never claimed and fail on every dropped mark.
    const tempoPlan = course.tempoPlan;
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
        const need = readWindowAt(g[i - 1].z, elev, tempoPlan) + reachOf(g[i - 1].lanes, g[i - 1].train);
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
    // ---- THE TEMPO CONTRACT, PROVED RATHER THAN COMMENTED -----------------
    //
    // Five claims are made in prose above assignTempo. Every one of them is
    // re-derived here from the FINISHED course, so course-test at 365 days and
    // calendar at 32 re-prove them on every run. The generator makes them true;
    // this refuses to ship a course where they are not.
    //
    //   1. READABLE. No vehicle in the mat's own lane from readWindowAt behind
    //      its near edge to its far edge. This is the rule 4 clause: a speed
    //      change the player could not see coming is a run taken for something
    //      outside their control.
    //   2. THE MAT ENDS BEFORE THE NEXT GATE'S TELEGRAPH RUN-UP.
    //   3. A FORWARD MAT IS EARNED -- some gate inside it demands an action of
    //      the marked lane.
    //   4. A BACKWARD MAT HAS AN OPENING -- a named other lane, not BLOCK at any
    //      gate inside the mark, with no vehicle in it from LANE_TRANSIT before
    //      the near edge, and the dragged lane itself CLEAR throughout so the
    //      drag is the only price.
    //   5. NO TWO MATS SHARE A LANE OVER THE SAME GROUND, and no drag's opening
    //      is dragged by another mat. Without 5 the guarantee in 4 would depend
    //      on the order the marks were placed in.
    const mats = course.tempo;
    if (mats && mats.length) {
      const spans = course.spans;
      for (const m of mats) {
        const read = readWindowAt(m.z0, elev, tempoPlan);
        if (spans && !laneFree(spans, m.lane, m.z0 - read, m.z1)) {
          errors.push(`tempo ${m.n}: a vehicle stands in lane ${m.lane} inside the `
            + `${read.toFixed(1)}u read window of its own paint`);
        }
        let earns = false, dirty = false;
        for (let i = 0; i < g.length; i++) {
          if (g[i].z < m.z0 || g[i].z >= m.z1) continue;
          const h = g[i].lanes[m.lane];
          if (h === K.JUMP || h === K.DUCK) earns = true;
          if (h !== K.CLEAR) dirty = true;
          if (h === K.BLOCK) errors.push(`tempo ${m.n}: gate ${i} blocks its own lane ${m.lane}`);
          if (m.dir < 0 && m.open >= 0 && g[i].lanes[m.open] === K.BLOCK) {
            errors.push(`tempo ${m.n}: gate ${i} blocks the opening lane ${m.open}`);
          }
        }
        for (let i = 0; i < g.length; i++) {
          if (g[i].z >= m.z1 && g[i].z < m.z1 + TEMPO_TAIL - 1e-9) {
            errors.push(`tempo ${m.n}: ends ${(g[i].z - m.z1).toFixed(1)}u short of gate ${i}, `
              + `inside its ${TEMPO_TAIL}u telegraph run-up`);
          }
        }
        if (m.dir > 0 && !earns) errors.push(`tempo ${m.n}: a forward mat nothing has to be cleared for`);
        if (m.dir < 0) {
          if (m.open < 0 || m.open === m.lane) {
            errors.push(`tempo ${m.n}: a backward mat with no opening`);
          } else if (spans && !laneFree(spans, m.open, m.z0 - LANE_TRANSIT, m.z1)) {
            errors.push(`tempo ${m.n}: a vehicle stands in its opening lane ${m.open}`);
          }
          if (dirty) errors.push(`tempo ${m.n}: a backward mat on a lane that already costs an action`);
        }
        for (const o of mats) {
          if (o === m || o.z1 <= m.z0 || o.z0 >= m.z1) continue;
          if (o.lane === m.lane) {
            errors.push(`tempo ${m.n}: shares lane ${m.lane} with tempo ${o.n} over the same ground`);
          }
          if (m.dir < 0 && o.lane === m.open) {
            errors.push(`tempo ${m.n}: tempo ${o.n} sits in its opening lane ${m.open}`);
          }
        }
      }
    }
    // ---- AND THE ROOF CONTRACT, THE SAME WAY ------------------------------
    //
    // A cone is the one hazard in this game with no lane to dodge into, so the
    // deck owes it the two things a road gate owes a hazard: a full action
    // window to answer it in, and somewhere to land. Both are geometry, and
    // both are checked here rather than trusted to the generator that made
    // them.
    if (course.ramps) {
      for (const r of course.ramps) {
        if (!r.cone) continue;
        const need = r.z0 + r.run + actionWindowAt(r.z0, elev, tempoPlan);
        if (r.cone < need - 1e-9) {
          errors.push(`ramp at ${r.z0.toFixed(0)}: cone ${(need - r.cone).toFixed(2)}u inside `
            + 'the action window past the top of its tailgate');
        }
        if (r.cone + CONE_LAND > r.z1 + 1e-9) {
          errors.push(`ramp at ${r.z0.toFixed(0)}: a jump over its cone lands `
            + `${(r.cone + CONE_LAND - r.z1).toFixed(2)}u past the far face`);
        }
      }
    }
    if (!solvable(g, elev, tempoPlan)) errors.push('course has no solvable lane path');
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
           windowExtraAt,
           // The tempo contract, exported for the same reason: the renderer has
           // to know how long a mat is and which way it points, and the tools
           // have to read the lift out of the file that enforces it.
           TEMPO_LEN_MIN, TEMPO_LEN_MAX, TEMPO_TAIL, planTempo, liftAt,
           // The roof contract. CONE_LAND is the one the art has to respect:
           // nothing may stand on a deck inside it.
           CONE_LAND, ROOF_SPAN_MIN, ROOF_SPAN_MAX, rampSpanMax,
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
  Object.defineProperty(api, 'TEMPO', {
    get: function () { return TEMPO; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) TEMPO = Math.max(0, Math.min(1, n)); },
  });
  Object.defineProperty(api, 'ROOF', {
    get: function () { return ROOF; },
    set: function (v) { const n = parseFloat(v); if (isFinite(n)) ROOF = Math.max(0, Math.min(1, n)); },
  });

  return api;
})();
