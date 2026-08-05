/**
 * Chase camera: low, tight, and behind the shoulder.
 *
 * The reference framing (Subway Surfers, Temple Run) puts the character at
 * roughly a third of frame height with the road opening out above them --
 * close enough that a lane change is body movement, high enough that the next
 * two gates still read. The first pass sat at 3.0 up / 6.55 back and the
 * runner was a distant sprite at a quarter of frame height; this sits at
 * 2.02 / 4.35 and fills about a third, dropping to 1.68 / 3.73 at full pace.
 *
 * Perceived speed is the hard problem and this file owns all of it. Ground
 * speed only moves 21.8 -> 27.7 units/sec across the whole race, because
 * 5:30/mi to 4:20/mi really is only 21%, and the distance maths is not
 * negotiable. So the camera multiplies that 21% instead of faking it:
 *
 *   - a widen-and-close (FOV out, camera in) as pace rises. Peripheral
 *     geometry sweeps far faster while the runner stays the same size on
 *     screen, which is the strongest speed cue available without touching
 *     the simulation.
 *   - the camera drops toward the road at pace, so nearby tarmac is closer
 *     to the lens and its angular rate climbs much faster than 21%.
 *   - a stride bob locked to the same cadence formula the runner uses, so
 *     the whole frame quickens with the footfalls.
 *   - a top-gear band: the last quarter of the pace range gets extra FOV and
 *     a permanent low rumble, so "finding another gear" is a state change and
 *     not just a slightly bigger number.
 *   - surge, from the derivative of pace. Streak-driven acceleration is up to
 *     ~4 u/s^2, which is very legible even though the speed change is not:
 *     the camera trails and widens while you are gaining, and closes in and
 *     narrows while a hit bleeds the pace away.
 *
 * Every effect is bounded so it can never hide the next gate: shake is a
 * damped oscillation rather than per-frame noise (noise reads as static and
 * makes obstacles unreadable), the punish state *narrows* FOV, and the mile
 * and gear flourishes only ever show more of the road, never less.
 */
MR.Camera = (function () {
  const K = MR.K;

  // ---- framing ----------------------------------------------------------
  // The FOV *swing* is the cue, not the absolute value: past about 74 degrees
  // vertical the far road collapses into a band and gates stop being readable
  // early enough to react to, which is a bug however fast it feels. So the
  // steady range is 58 -> 71 and the clamp exists only to stop stacked
  // transients (gear + duck + landing kick) from ever getting there.
  const BASE_FOV = 58;
  const SPEED_FOV = 10.5;        // widening across the honest pace band
  const GEAR_FOV = 2.5;          // extra, only in the top of the band
  const FOV_MIN = 48, FOV_MAX = 76;

  const BASE_Y = 2.05;
  const BASE_BACK = 4.35;
  const LOOK_Y = 1.16;
  const LOOK_AHEAD = 8.0;

  // The honest band, in world units/sec. Derived rather than typed in, so a
  // pace retune moves the camera response with it.
  const SPEED_LO = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE;
  const SPEED_HI = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

  // Two incommensurate sines: shake that is smooth in time. Per-frame
  // Math.random() jitter looks like video static at 60fps and genuinely hides
  // obstacles; a wobble of the same amplitude reads twice as heavy and stays
  // readable because the eye can track it.
  function wobble(t, seed) {
    return Math.sin(t * 33.7 + seed) * 0.62 + Math.sin(t * 18.3 + seed * 2.7) * 0.38;
  }

  /**
   * Framing is aspect-dependent because three's FOV is vertical: a phone in
   * portrait sees barely a third of the horizontal angle a laptop does. The
   * lateral lag that reads as weight on a wide screen throws the runner onto
   * the edge of a portrait frame, so narrow screens follow harder, sit further
   * back, and bank less.
   */
  function frameFor(aspect) {
    const wide = clamp01((aspect - 0.55) / 0.80);   // 0 = phone portrait, 1 = desktop
    return {
      follow: 0.95 - 0.17 * wide,
      lookX: 0.85 - 0.30 * wide,
      back: 1.18 - 0.18 * wide,
      roll: 0.70 + 0.30 * wide,
    };
  }

  function create(aspect) {
    const cam = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 1200);
    const look = new THREE.Vector3();   // hoisted: this runs 60x a second

    const s = {
      camera: cam,
      fr: frameFor(aspect),
      x: 0, vx: 0,     // lateral follow, sprung so a lane change whips
      roll: 0,
      fov: BASE_FOV,

      t: 0,            // clock for the wobble functions
      stride: 0,       // stride phase, mirrors the runner's cadence
      primed: false,   // first frame snaps the speed filter
      sp: SPEED_LO,    // smoothed ground speed
      drive: 0,        // 0..1 pace within the honest band, shaped
      accel: 0,        // smoothed d(speed)/dt -- the surge signal

      shake: 0,        // trauma, 0..1
      punch: 0,        // one-shot impact roll
      lurch: 0,        // one-shot impact sidestep
      winded: 0,       // long tail after a hit: the camera loses its nerve
      dip: 0, dipV: 0, // sprung landing compression
      kick: 0,         // short FOV punch (landing)

      mile: -1,        // last whole mile crossed
      mileT: 0,
      gearT: 0, gearArmed: true,
      finish: 0,
    };

    /**
     * @param dt  real seconds
     * @param p   { z, x, y, speed, lean, duck01 }
     */
    s.update = function (dt, p) {
      // A long frame must not be allowed to detonate the springs -- and the
      // first frame can arrive with a *negative* dt, because the rAF timestamp
      // is the moment the frame began, which on a slow boot is earlier than
      // the clock main.js took when it started. Integrating a spring backwards
      // through 1.5 seconds throws the camera tens of units sideways, and the
      // recovery is slow enough to be caught by a screenshot.
      const d = dt > 0 ? Math.min(dt, 1 / 25) : 0;
      s.t += d;

      // ---- speed signals -------------------------------------------------
      // Smoothing is deliberately slow: pace itself eases, and an unsmoothed
      // derivative would make the camera twitch on every pace step.
      // The first frame snaps instead of easing, or ?skip= would start every
      // deep-race screenshot with a phantom 6 u/s surge that never happens in
      // a real run.
      const first = !s.primed;
      if (first) { s.primed = true; s.sp = p.speed; }
      const prev = s.sp;
      s.sp += (p.speed - s.sp) * (1 - Math.pow(0.02, d));
      const rawAccel = d > 0 ? (s.sp - prev) / d : 0;
      s.accel += (rawAccel - s.accel) * (1 - Math.pow(0.05, d));

      const sp01 = clamp01((s.sp - SPEED_LO) / (SPEED_HI - SPEED_LO));
      // Most of a good run is spent in the upper half of the band, so bias the
      // response there: the difference the player should feel is between
      // "quick" and "flat out", not between the start line and mile 3.
      const drive = Math.pow(sp01, 0.85);
      const gear = smoothstep(0.70, 0.99, sp01);      // the top-gear state
      // Kept for impact(): pace *is* the streak, so how fast the runner was
      // going when they hit something is an honest measure of how much the
      // hit just cost them. See impact().
      s.drive = drive;
      // +/- 1 over the range the pace ease can actually produce.
      const surge = Math.max(-1, Math.min(1, s.accel / 3.2));

      // ---- one-shot beats ------------------------------------------------
      // Mile marker: a short lift and pull-back, so the milestone is a breath
      // in the camera and not only a line of HUD text.
      const mileNow = Math.floor(p.z / K.UNITS_PER_MILE);
      if (s.mile < 0) s.mile = mileNow;                // fresh start or ?skip=
      else if (mileNow > s.mile) { s.mile = mileNow; s.mileT = 1; }
      s.mileT = Math.max(0, s.mileT - d * 0.95);

      // Top gear: fire once when the pace floor is essentially reached, and
      // re-arm only if a hit drags the run back out of it. This is the moment
      // the 21% is supposed to feel like a different race.
      if (first) s.gearArmed = sp01 < 0.93;             // no flourish for ?skip=
      else if (s.gearArmed && sp01 > 0.93) { s.gearArmed = false; s.gearT = 1; }
      if (!s.gearArmed && sp01 < 0.72) s.gearArmed = true;
      s.gearT = Math.max(0, s.gearT - d * 1.15);

      // Finish: the only place the camera is allowed to abandon the chase.
      if (p.z >= K.TOTAL_UNITS - 0.25) s.finish = Math.min(1, s.finish + d / 1.5);
      const fin = s.finish * s.finish * (3 - 2 * s.finish);

      // ---- decays ---------------------------------------------------------
      s.shake = Math.max(0, s.shake - d * 2.1);
      s.punch = Math.max(0, s.punch - d * 3.4);
      s.winded = Math.max(0, s.winded - d * 0.45);
      s.kick = Math.max(0, s.kick - d * 4.2);

      // Landing compression, as a spring rather than a decay so it rebounds.
      s.dipV += (-s.dip * 340 - s.dipV * 24) * d;
      s.dip += s.dipV * d;

      // ---- lateral --------------------------------------------------------
      // Underdamped on purpose (zeta ~0.6): the camera arrives at the new lane
      // slightly late and overshoots a hair, which is the weight the old
      // exponential follow was missing.
      const tgtX = p.x * s.fr.follow + s.lurch;
      if (first) s.x = tgtX;        // a real race starts centred; ?skip= may not
      s.vx += ((tgtX - s.x) * 200 - s.vx * 17) * d;
      s.x += s.vx * d;
      s.lurch -= s.lurch * Math.min(1, d * 5.0);

      // ---- stride ---------------------------------------------------------
      // Same cadence curve as the runner so the bob lands on the footfalls.
      // Cadence rises ~16% across the band; on its own that is nothing, but
      // under a camera that is also lower and wider it is the difference
      // between a jog and a hunt.
      const air = clamp01((p.y || 0) / 1.2);
      const cadence = 2.55 * Math.pow(s.sp / 22, 0.72);
      s.stride = (s.stride + d * cadence) % 1;
      const ph = s.stride * Math.PI * 2;
      const bobAmp = (0.020 + 0.026 * drive) * (1 - air) * (1 - fin);
      const bobY = -Math.abs(Math.sin(ph)) * bobAmp;        // fall on footfall
      const bobX = Math.sin(ph) * bobAmp * 0.55;
      // A footfall also eats a little of the gap: the camera surges in on the
      // drive phase and drifts back on the float. Tiny, but it turns a smooth
      // dolly into something being pushed by legs.
      const bobZ = Math.sin(ph * 2) * (0.014 + 0.030 * drive) * (1 - air) * (1 - fin);

      // ---- shake ----------------------------------------------------------
      // Trauma squared, plus a permanent tremble at top gear: at the pace
      // floor the frame should never be completely still.
      const tr = s.shake * s.shake;
      const rumble = gear * 0.045 * (1 - fin);
      const shX = wobble(s.t, 0.0) * (tr * 0.20 + rumble);
      const shY = wobble(s.t, 1.7) * (tr * 0.16 + rumble * 0.7);
      const shR = wobble(s.t, 3.1) * (tr * 0.030 + rumble * 0.10);

      // ---- placement ------------------------------------------------------
      const duck = p.duck01 || 0;

      // Closer and lower with pace; the ground is what sells it, so the drop
      // is worth more than the pull-in. Surge trails the camera while the
      // streak is buying speed and reels it in while a hit bleeds it away.
      const back = BASE_BACK * s.fr.back
        - drive * 0.62
        + surge * 0.30
        - duck * 0.22
        - s.gearT * s.gearT * 0.45
        + s.mileT * 0.45
        + s.winded * 0.28
        + bobZ
        + fin * 3.4;

      const hgt = BASE_Y
        - drive * 0.41
        - duck * 0.34
        + (p.y || 0) * 0.30            // keeps a third of the arc -- see aim
        + s.dip
        + s.mileT * 0.24
        + s.winded * 0.12
        + bobY + shY
        + fin * 1.7;

      cam.position.set(s.x + bobX + shX, hgt, p.z - back);

      // ---- aim ------------------------------------------------------------
      // The look point follows the jump arc *more* than the camera does, so
      // the camera pitches up as the runner rises: the road falls away in
      // frame, which is what leaving the ground actually looks like. The old
      // 0.42/0.30 split had the camera chasing the arc and cancelled it.
      look.set(
        s.x * s.fr.lookX,
        LOOK_Y + (p.y || 0) * 0.50 - duck * 0.26 - drive * 0.22 + fin * 0.55,
        p.z + LOOK_AHEAD + (p.y || 0) * 1.1 - drive * 0.5
      );
      cam.lookAt(look);

      // Roll: the lean term is the body, the camera's own lateral velocity is
      // the whip that outlasts it. Old value was 0.055 * lean -- barely two
      // degrees, below the threshold of being felt at all. This peaks around
      // seven, which is a bank; the response is fast because a lane change is
      // over in 0.16s and a slow filter would smooth the whole event away.
      const whip = Math.max(-1, Math.min(1, s.vx / 20));
      const rollTgt = -((p.lean || 0) * 0.16 + whip * 0.07) * s.fr.roll * (1 - fin);
      s.roll += (rollTgt - s.roll) * (1 - Math.pow(0.00002, d));
      cam.rotation.z += s.roll + shR - s.punch * 0.055;

      // ---- fov ------------------------------------------------------------
      // Widening while pulling in keeps the runner the same size on screen and
      // accelerates everything around them. The winded term narrows instead,
      // so a hit reads as the world closing in -- and, importantly, a punished
      // player can still see the gate they have to make.
      const targetFov = BASE_FOV
        + SPEED_FOV * drive
        + GEAR_FOV * gear
        + s.gearT * 5.0
        + surge * 3.5
        + duck * 2.5
        + air * 1.6
        + s.kick * 6
        - s.winded * 5.0
        - s.mileT * 1.5
        - fin * 9.0;
      // Fast toward a wider frame, slower back: gaining speed should feel
      // immediate, losing it should feel like it is being taken away.
      const fovRate = targetFov > s.fov ? 0.02 : 0.12;
      const fovGoal = Math.max(FOV_MIN, Math.min(FOV_MAX, targetFov));
      if (first) s.fov = fovGoal;                       // ?skip= starts settled
      else s.fov += (fovGoal - s.fov) * (1 - Math.pow(fovRate, d));

      if (Math.abs(cam.fov - s.fov) > 0.01) {
        cam.fov = s.fov;
        cam.updateProjectionMatrix();
      }
    };

    /**
     * Contact. This costs the player their record, so it gets the whole
     * vocabulary: a lurch, heavy damped shake, and a two-second winded tail
     * where the camera sits back, lifts, and narrows while the pace bleeds.
     *
     * Weighted by current pace, which is the only honest read on streak length
     * the camera has: 4:20/mi means ~170 clean gates in a row, and losing that
     * should not land the same as clipping the second gate of the race.
     */
    s.impact = function (amount) {
      const a = (amount === undefined ? 1 : amount) * (0.6 + 0.7 * s.drive);
      s.shake = Math.min(1.5, s.shake + 1.15 * a);
      s.punch = Math.min(1.2, s.punch + 0.9 * a);
      s.winded = Math.min(1, s.winded + 0.85 * a);
      s.dipV -= 5.5 * a;
      s.kick = Math.min(1, s.kick + 0.3 * a);
      // Knocked off the racing line. The side alternates with the clock so a
      // player who hits three gates in a mile does not see the same canned
      // stagger three times.
      s.lurch = (Math.sin(s.t * 12.9) >= 0 ? 1 : -1) * 0.42 * a;
    };

    /** Landing: compression into the road, then a rebound. Heavier at pace. */
    s.land = function () {
      const w = 0.8 + 0.4 * s.drive;
      s.dipV -= 3.6 * w;
      s.shake = Math.min(1.5, s.shake + 0.30 * w);
      s.kick = Math.min(1, s.kick + 0.35);
    };

    s.resize = function (aspect) {
      cam.aspect = aspect;
      s.fr = frameFor(aspect);
      cam.updateProjectionMatrix();
    };

    s.reset = function () {
      s.x = 0; s.vx = 0; s.roll = 0; s.fov = BASE_FOV;
      s.t = 0; s.stride = 0; s.primed = false;
      s.sp = SPEED_LO; s.drive = 0; s.accel = 0;
      s.shake = 0; s.punch = 0; s.lurch = 0; s.winded = 0;
      s.dip = 0; s.dipV = 0; s.kick = 0;
      s.mile = -1; s.mileT = 0; s.gearT = 0; s.gearArmed = true; s.finish = 0;
      cam.fov = BASE_FOV;
      cam.updateProjectionMatrix();
    };

    return s;
  }

  return { create, BASE_FOV };
})();
