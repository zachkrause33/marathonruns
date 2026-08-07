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

  function targetPace(streak) {
    // Two time constants. The fast term pays a weak player early; the slow
    // term is still unwinding at the finish, so late gates keep buying time
    // and a late mistake still costs something. See constants.js.
    const gap = K.START_PACE - K.FLOOR_PACE;
    return K.FLOOR_PACE
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
      const tgt = targetPace(s.streak);
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
      return dUnits;
    };

    s.onClean = function () {
      s.streak++;
      s.gatesSeen++;
      if (s.streak > s.bestStreak) s.bestStreak = s.streak;
    };

    s.onHit = function () {
      s.hits++;
      s.gatesSeen++;
      s.streak = Math.floor(s.streak * K.HIT_STREAK_KEEP);
      s.raceTime += K.HIT_TIME_PENALTY;
    };

    /**
     * Aid taken. Grants streak, not pace -- speed still has exactly one
     * source, so the rule the game is built on is untouched. See K.AID_* for
     * why this needs no cap: the streak curve saturates, so aid is worth a
     * great deal to a broken run and almost nothing to a clean one.
     */
    s.onAid = function (gain) {
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
        const tgt = targetPace(streak);
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

    s.recordPossible = function () {
      return s.needPace() > K.FLOOR_PACE;
    };

    /** Where the record ghost is right now, in miles. */
    s.ghostMiles = function () {
      return Math.min(K.MARATHON_MILES, s.raceTime / K.RECORD_PACE);
    };

    s.targetPace = () => targetPace(s.streak);

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

  return { create, targetPace, clock, pace, delta };
})();
