/**
 * Date-seeded course elevation.
 *
 * The race has been flat since the gun. The measured argument for changing
 * that is not visual: gate cadence is a median 1.16 s with no lull anywhere in
 * the distribution, and a descent is the only content this game can add that
 * gives the player a breath inside four minutes WITHOUT thinning the
 * obstacles. A hill asks for nothing the player was not already doing -- it
 * changes the pace, the camera's whole vocabulary and the shape of the
 * horizon, and adds no decision to a distribution with no gap to put one in.
 *
 * THE PROFILE
 *
 *   E(z) = SUM  h_i * (1 + cos(pi * (z - c_i)/L_i)) / 2     for |z - c_i| <= L_i
 *
 * A raised cosine, compactly supported. Grade is dE/dz, positive uphill.
 *
 * EVERY HILL IS A HUMP. It starts at zero, rises, and returns to zero, and the
 * centres are separated so no two ever overlap. That is not decoration, it is
 * what makes the pace-neutrality proof in pace.js hold for every PREFIX of the
 * race rather than merely for the whole of it: no hill can leave the runner
 * higher than it found them, so no sequence of hills compounds into a mountain
 * and no partial race is out of balance.
 *
 * WHY THIS FILE LOADS BEFORE course.js. The airborne span grows on a descent,
 * so Course.ACTION_WINDOW -- the rule that stops the course demanding a jump
 * and a slide inside one airborne span -- has to become a function of z. The
 * generator therefore needs the profile before it places a single gate. See
 * `windowAt` below and Course.actionWindowAt.
 *
 * WHAT IT IS NOT ALLOWED TO TOUCH. `player.y` stays relative to the LOCAL road
 * surface and elevation is added at render time only, so collision.js keeps
 * testing y >= 0.84 and duck01 >= 0.90 against a flat zero and every clearance
 * threshold in the game is untouched. That is the finding this whole feature
 * rests on and it is why hills are cheap.
 */
MR.Elevation = (function () {
  const K = MR.K;

  // ---- the two caps on hill shape --------------------------------------
  //
  // GRADE. hπ/2L <= MAX_GRADE, so h <= (2/pi) * MAX_GRADE * L. 4% is the
  // ceiling because it is where real marathon hills sit (Boston's Newton hills
  // are 3-4%) and because it is where GRADE_SPM was calibrated: at 4% the pace
  // term is exactly K.GRADE_CLAMP, so the clamp in pace.js is a backstop that
  // provably never fires and the zero-net integral stays exact.
  //
  // SIGHTLINE, and this one is the fairness rule. A crest is convex, so it
  // occludes the road beyond it -- including the lane telegraph mats, which lie
  // ON the road surface and are the readability device this game is built
  // around. For an eye h above the road over a crest of curvature c, the
  // surface stops being visible beyond d = sqrt(2h/c). Requiring d >= SIGHT_MIN
  // at an eye height of K.HILL_EYE_Y gives c <= 2h/d^2, and a raised cosine's
  // crest curvature is h*pi^2/(2L^2), so h <= (2/pi^2) * c_max * L^2.
  //
  // A hazard hidden over a rise is exactly the fairness bug tools/shoot.js
  // fails the build for, so it is not enough to derive the cap and assert it:
  // validate() ray-marches the SUMMED profile and reports the worst visible
  // distance over the whole course.
  const MAX_GRADE = 0.040;
  const SIGHT_MIN = 90;                        // units of road that must stay visible
  // SIGHT_SAFETY, and it is here because the analytic bound is OPTIMISTIC, not
  // conservative. The derivation puts the eye directly over the crest; the real
  // camera is K.HILL_EYE_BACK = 4.35 units behind it and therefore lower down
  // the near flank, so the true eye height above the crest tangent is less than
  // K.HILL_EYE_Y. Swept numerically against the real offset, a single hill sat
  // exactly on the analytic cap measures:
  //
  //     L    130    150    180    200    221    240
  //   d/d_a  1.035  1.013  0.993  0.985  0.979  0.978
  //
  // -- so at the crossover (L = 221, where the two rules meet) the analytic cap
  // overshoots by 2.1%. The design document this was built from records the
  // opposite ("conservative by 5-10%"), and three courses in a 90-day sweep
  // failed validate() at 89.7 units because of it. Designing the cap against
  // SIGHT_MIN / 0.95 puts every measured worst case comfortably clear, and
  // validate() -- not this constant -- remains the authority.
  const SIGHT_SAFETY = 0.95;
  const SIGHT_DESIGN = SIGHT_MIN / SIGHT_SAFETY;
  const CURV_MAX = 2 * K.HILL_EYE_Y / (SIGHT_DESIGN * SIGHT_DESIGN);
  const K_GRADE = (2 / Math.PI) * MAX_GRADE;           // 0.02546 * L
  const K_CURV = (2 / (Math.PI * Math.PI)) * CURV_MAX;  // 1.039e-4 * L^2

  /** The tallest a hill of half-length L may legally be. */
  function cap(L) { return Math.min(K_GRADE * L, K_CURV * L * L); }

  // Placement, and the range is LONGER than the design asked for because of a
  // property that only shows up once the numbers are put in.
  //
  // Under the sightline cap h = K_CURV * L^2, so the maximum grade of a legal
  // hill is h*pi/2L = K_CURV*pi*L/2 -- LINEAR IN L. A longer hill is a STEEPER
  // one, not a gentler one, right up to L = 245 where the 4% grade rule takes
  // over. The design's 130-240 band therefore tops out at 3.9% and averages
  // about 2.6%, and 2.6% was measured on screen as a real but modest read: the
  // horizon moves, the road tilts, and a player would have to be looking for
  // it. At 4% the same frames are unmistakable -- the climb crops the skyline
  // out of the top of the frame and the descent opens the whole city up.
  //
  // So: 200-300, which puts every hill between 2.7% and the 4% ceiling and
  // makes each one 400-600 units -- 15-22 s of wall clock, 1.7-2.5 race miles.
  // Four or five of them cover 35-45% of the race, which is more grade than the
  // design costed and is the right way round: the descent is the breath, and a
  // longer descent is a longer breath.
  const L_MIN = 200, L_MAX = 300;
  // Fewer, because they are bigger and because the bridge is excluded. The
  // placement loop gives up gracefully if a day cannot fit them all.
  const N_MIN = 3, N_MAX = 5;
  // Clear of the start runway and of the run-in to the tape: the opening should
  // read calmly and the last gates should be run on the flat.
  const EDGE_PAD = 200;

  /**
   * How far ahead the airborne span is allowed to look for a steeper descent.
   * A jump taken at a gate is in the air for JUMP_TIME, covering a little over
   * 21 units at the very fastest, so the window has to be sized against the
   * steepest grade anywhere in the span it covers -- not against the grade at
   * the gate line, which on the shoulder of a hill is the gentler end of it.
   */
  const SPAN_LOOK = 28;

  /**
   * @param key   date key, the same seed as the course
   * @param opts  { exclude: [[z0,z1], ...], mandate: [{z, L, h?}] }
   *              Composition lives in course.js -- which stretch of the race is
   *              a bridge, and where the wall's spike is -- so it is passed in
   *              rather than restated here.
   */
  function create(key, opts) {
    opts = opts || {};
    const rnd = MR.rng.stream(key, 'elevation/v1');
    const total = K.TOTAL_UNITS;
    const exclude = opts.exclude || [];
    const hills = [];

    function blocked(c, L) {
      if (c - L < EDGE_PAD * 0.5 || c + L > total - EDGE_PAD * 0.5) return true;
      for (const h of hills) if (Math.abs(c - h.c) < L + h.L) return true;
      for (const e of exclude) if (c + L > e[0] && c - L < e[1]) return true;
      return false;
    }

    // Mandated hills first, so a seeded one can never take their ground.
    // They are still subject to cap(): a composition note may say WHERE a hill
    // goes, never how steep it is allowed to be.
    for (const m of (opts.mandate || [])) {
      const L = Math.max(L_MIN, Math.min(L_MAX, m.L));
      const h = Math.min(cap(L), m.h === undefined ? cap(L) * 0.92 : m.h);
      if (!blocked(m.z, L)) hills.push({ c: m.z, L, h, mandated: true });
    }

    const want = rnd.int(N_MIN, N_MAX);
    let guard = 0;
    while (hills.length < want + (opts.mandate || []).length && guard++ < 400) {
      const L = rnd.range(L_MIN, L_MAX);
      const c = rnd.range(EDGE_PAD + L, total - EDGE_PAD - L);
      if (blocked(c, L)) continue;
      // 0.82 rather than the design's 0.55 floor: at the bottom of that range
      // a hill's grade halves and it stops reading at all, which is a hill
      // that costs the same and delivers nothing.
      hills.push({ c, L, h: cap(L) * rnd.range(0.82, 1.0), mandated: false });
    }
    hills.sort(function (a, b) { return a.c - b.c; });

    // ---- the profile ---------------------------------------------------
    // A loop over <= 7 compactly-supported terms with one cos. Called five
    // times a frame by the renderer and once per metre by the validator, so it
    // is written to be boring rather than clever.
    function at(z) {
      let e = 0;
      for (let i = 0; i < hills.length; i++) {
        const H = hills[i];
        const d = z - H.c;
        if (d <= -H.L || d >= H.L) continue;
        e += H.h * (1 + Math.cos(Math.PI * d / H.L)) * 0.5;
      }
      return e;
    }

    /** dE/dz. Positive uphill. */
    function slope(z) {
      let g = 0;
      for (let i = 0; i < hills.length; i++) {
        const H = hills[i];
        const d = z - H.c;
        if (d <= -H.L || d >= H.L) continue;
        g -= H.h * Math.PI / (2 * H.L) * Math.sin(Math.PI * d / H.L);
      }
      return g;
    }

    /** Grade as a PERCENT, which is the unit GRADE_SPM is quoted in. */
    function gradeAt(z) { return slope(z) * 100; }

    /** -1..1 against the steepest legal grade -- for the runner's trunk. */
    function gradeNorm(z) {
      const g = slope(z) / MAX_GRADE;
      return g < -1 ? -1 : g > 1 ? 1 : g;
    }

    // ---- the action window, as a function of z -------------------------
    //
    // THE ONE INVARIANT HILLS BREAK, and it was already nearly broken before
    // they existed. course.js requires the airborne span to stay shorter than
    // ACTION_WINDOW so a jump can never still be in the air at a gate demanding
    // a slide. At the pace floor that span is 19.84 units against a window of
    // 21 -- a margin of 1.16 units. A descent makes the runner faster, so the
    // span grows: at -4% it is 21.54 and the margin is gone.
    //
    // The fix is not to slow the descent (2.3 s/mi of headroom kills the
    // mechanic) and not to shorten JUMP_TIME (that retunes the core jump and
    // the clearance window). It is to make the invariant a function of z and
    // let the BFS hold the line by construction, with the SAME absolute margin
    // everywhere it holds today:
    //
    //   window(z) = ACTION_WINDOW + (span at the steepest grade in reach - span on the flat)
    //
    // Precomputed at 1-unit resolution with a forward sliding window, so
    // solvable() -- which runs once per generation attempt over every gate
    // placed so far -- pays an array index and nothing else.
    const flatSpeed = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;
    const flatSpan = K.JUMP_TIME * flatSpeed;
    function spanAtGrade(gPct) {
      const p = K.FLOOR_PACE + K.GRADE_SPM * gPct;
      return K.JUMP_TIME * (K.UNITS_PER_MILE * K.TIME_SCALE) / p;
    }

    const N = Math.ceil(total) + SPAN_LOOK + 2;
    const gradeTab = new Float64Array(N);
    for (let i = 0; i < N; i++) gradeTab[i] = gradeAt(i);
    const winTab = new Float64Array(N);
    {
      // Steepest DESCENT (most negative grade) anywhere in [i, i+SPAN_LOOK].
      // A monotone deque would be asymptotically nicer; at 6300 x 28 this is
      // 180k comparisons once per course and not worth the machinery.
      let extra = 0;
      for (let i = 0; i < N; i++) {
        let g = 0;
        const end = Math.min(N - 1, i + SPAN_LOOK);
        for (let j = i; j <= end; j++) if (gradeTab[j] < g) g = gradeTab[j];
        extra = Math.max(0, spanAtGrade(g) - flatSpan);
        winTab[i] = extra;
      }
    }
    /** Extra units of action window owed to the descent at z. Never negative. */
    function windowExtra(z) {
      const i = z <= 0 ? 0 : z >= N - 1 ? N - 1 : Math.floor(z);
      return winTab[i];
    }

    // ---- the proof -----------------------------------------------------
    /**
     * THE SIGHTLINE SWEEP, and it must be proved rather than asserted.
     *
     * The per-hill cap plus non-overlap makes the whole profile's curvature
     * equal the per-hill curvature, so the analytic bound ought to hold. It is
     * ray-marched anyway, at 1-unit steps over all 6293 units, against the real
     * camera offset -- because "a hazard the player could not see" is the one
     * class of defect this project already fails a build for, and a crest is a
     * new way to produce it.
     *
     * From an eye K.HILL_EYE_Y above the road at z - K.HILL_EYE_BACK, walk
     * forward tracking the maximum slope seen so far. A surface point is
     * visible exactly when the line to it clears everything nearer, i.e. when
     * its own slope from the eye is not below that running maximum.
     */
    function validate() {
      const NEAR = K.HILL_EYE_BACK;
      const H = K.HILL_EYE_Y;
      const STEP = 0.5;                  // sample pitch, in units, both loops
      // Precomputed so the sweep is array lookups rather than ~8M cosines.
      // Runs at generation, exactly like the BFS, so it costs once per course.
      const lo = -Math.ceil(NEAR / STEP) - 2;
      const hi = Math.ceil((total + SIGHT_MIN + NEAR) / STEP) + 2;
      const tab = new Float64Array(hi - lo + 1);
      for (let i = lo; i <= hi; i++) tab[i - lo] = at(i * STEP);
      const E = function (i) { return tab[i - lo]; };

      let worst = Infinity, worstZ = 0;
      const REACH = Math.ceil((SIGHT_MIN + NEAR) / STEP);
      for (let zi = 0; zi * STEP <= total; zi++) {
        const ei = zi - Math.round(NEAR / STEP);
        const ey = E(ei) + H;
        let maxSlope = -Infinity;
        let vis = SIGHT_MIN;
        for (let k = 1; k <= REACH; k++) {
          const d = k * STEP;
          const s = (E(ei + k) - ey) / d;
          if (s < maxSlope - 1e-12) { vis = d - NEAR; break; }
          if (s > maxSlope) maxSlope = s;
        }
        if (vis < worst) { worst = vis; worstZ = zi * STEP; }
      }
      const ok = worst >= SIGHT_MIN;
      return {
        ok, worst, worstZ, hills: hills.length,
        errors: ok ? [] : [`sightline ${worst.toFixed(1)}u at z=${worstZ.toFixed(0)}`
          + ` -- under the ${SIGHT_MIN}u minimum`],
      };
    }

    /** Reported by tools, not used by the game. */
    function summary() {
      let up = 0, dn = 0, covered = 0, gmax = 0;
      for (const h of hills) {
        covered += 2 * h.L;
        gmax = Math.max(gmax, h.h * Math.PI / (2 * h.L) * 100);
      }
      for (let z = 0; z < total; z++) {
        const g = gradeTab[z];
        if (g > 0.5) up++; else if (g < -0.5) dn++;
      }
      return {
        hills: hills.map(function (h) {
          return {
            c: +h.c.toFixed(0), L: +h.L.toFixed(0), h: +h.h.toFixed(2),
            grade: +(h.h * Math.PI / (2 * h.L) * 100).toFixed(2),
            mandated: !!h.mandated,
          };
        }),
        maxGrade: +gmax.toFixed(2),
        coverage: +(covered / total).toFixed(3),
        upUnits: up, downUnits: dn,
        netRise: +at(total).toFixed(6),
      };
    }

    return {
      key, hills, at, slope, gradeAt, gradeNorm, windowExtra,
      validate, summary, cap, MAX_GRADE, SIGHT_MIN,
    };
  }

  /**
   * A flat profile. Anything that has to work without a course -- an early
   * frame, a tool that only loaded pace.js -- gets this rather than a null
   * check at every call site.
   */
  const FLAT = {
    key: null, hills: [],
    at: function () { return 0; },
    slope: function () { return 0; },
    gradeAt: function () { return 0; },
    gradeNorm: function () { return 0; },
    windowExtra: function () { return 0; },
    validate: function () { return { ok: true, worst: Infinity, worstZ: 0, hills: 0, errors: [] }; },
    summary: function () { return { hills: [], maxGrade: 0, coverage: 0, upUnits: 0, downUnits: 0, netRise: 0 }; },
    cap, MAX_GRADE, SIGHT_MIN,
  };

  return { create, cap, FLAT, MAX_GRADE, SIGHT_MIN, L_MIN, L_MAX };
})();
