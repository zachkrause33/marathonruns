/**
 * Player state machine: lanes, jump arc, duck, stumble, and gate resolution.
 *
 * The jump arc is explicit rather than gravity-integrated. A scripted arc of
 * fixed duration means the airborne window is identical at 5:30 pace and 4:20
 * pace -- with real gravity the faster you ran the less ground a jump would
 * cover in air-time terms, and the same input would stop working late in the
 * race for reasons the player could never see.
 *
 * Gate resolution happens the instant the player's z crosses a gate, using
 * the state at that moment. One resolution per gate, ever: `resolved` guards
 * against a frame-rate spike double-counting a gate and stealing a streak.
 */
MR.Player = (function () {
  const K = MR.K;
  const C = MR.Collision;

  /**
   * ---- HOW LONG IT TAKES TO FALL OFF A LORRY -----------------------------
   *
   * 0.50 s, and the number is set by the road that is GUARANTEED to be there
   * rather than by gravity. A free fall from Course.DECK_Y (2.80) at 9.81 is
   * 0.756 s, and the whole descent has to finish before the next gate -- or the
   * runner arrives at it still 1.4 units up, which clears a JUMP for free and,
   * worse, clears a DUCK for free, because a SURFACE above 1.83 is above the
   * bar (see the DUCK clause in collision.js). A mechanic that hands out free
   * clears is not a mechanic, it is an exploit.
   *
   * What the course guarantees: spacingAt owes the gate after a train
   * readWindowAt + reachOf, and reachOf for a train IS that train's depth. So
   * whatever length the vehicle is, there are at least readWindowAt units of
   * clear road past its far face -- 25.35 on the flat, and MORE on a descent,
   * because actionWindowAt grows with the local top speed. In time that floor
   * is 0.89 s at the pace floor. The physical 0.756 leaves 0.13 s of it; 0.50
   * leaves 0.39.
   *
   * tools/mechanics.js measures the real margin for every ramp on all 365 days
   * rather than trusting this paragraph, and fails when one lands late.
   */
  const FALL_TIME = 0.50;

  function create() {
    const s = {
      lane: 1,
      laneFrom: 1,
      laneT: 1,          // 0..1 through a lane change
      x: 0,
      y: 0,
      airT: 0,           // 0..1 through the jump
      airborne: false,
      duckT: 0,
      ducking: false,
      duck01: 0,
      lean: 0,
      stumble: 0,
      bounce: 0,        // signed lateral knock from a BLOCK, decays
      tripT: 0,         // 0..1 through a trip on a small obstacle
      // ---- the second running surface ------------------------------------
      // `surface` is the height of the GROUND under the runner and `y` stays
      // height above it, which is the same split main.js already uses for
      // hills. All three are zero on a course with no ramps, so nothing here
      // changes for a game that does not use the mechanic.
      surface: 0,       // 0 on the road, Course.DECK_Y on a roof
      ramp: null,       // the ramp being ridden, or null
      falling: 0,       // 0..1 through a fall back to the road
      fallFrom: 0,      // the height the fall started at
      flanked: false,   // latched while inside a vehicle, so one hit is one hit
      gateIdx: 0,
      aidIdx: 0,
      lastResult: null,  // 'clean' | 'hit'
      lastResultAt: -99,
      events: [],        // drained by main for audio/HUD reactions
    };

    // Derived, not stored. collision.js's BLOCK clause asks whether the runner
    // is standing on the thing, and the only true answer is "there is a ramp
    // under him" -- a second boolean kept alongside `ramp` would be one more
    // pair of numbers that can disagree, which is how four of the corrections
    // in docs/roadmap.md start.
    Object.defineProperty(s, 'onDeck', { get: function () { return s.ramp !== null; } });

    s.reset = function () {
      s.lane = 1; s.laneFrom = 1; s.laneT = 1; s.x = 0; s.y = 0;
      s.airT = 0; s.airborne = false; s.duckT = 0; s.ducking = false;
      s.duck01 = 0; s.lean = 0; s.stumble = 0; s.bounce = 0; s.tripT = 0;
      s.surface = 0; s.ramp = null; s.falling = 0; s.fallFrom = 0; s.flanked = false;
      s.gateIdx = 0; s.aidIdx = 0;
      s.lastResult = null; s.events.length = 0;
    };

    function changeLane(dir) {
      const t = Math.max(0, Math.min(2, s.lane + dir));
      if (t === s.lane) return false;
      s.laneFrom = s.lane;
      s.lane = t;
      s.laneT = 0;
      return true;
    }

    /** Serve buffered input. Ducking cancels into a jump; jumping does not
     *  cancel into a duck, which keeps the air window uninterruptible. */
    s.handle = function (controls) {
      // Lane changes are servable whenever the previous one is mostly done.
      if (s.laneT >= 0.55) {
        const a = controls.take((x) => x === 'left' || x === 'right');
        if (a) changeLane(a === 'left' ? -1 : 1);
      }
      if (!s.airborne) {
        const a = controls.take((x) => x === 'jump' || x === 'duck');
        if (a === 'jump') {
          s.airborne = true; s.airT = 0;
          s.ducking = false; s.duckT = 0;
          s.events.push('jump');
        } else if (a === 'duck') {
          s.ducking = true; s.duckT = 0;
          s.events.push('duck');
        }
      }
    };

    s.update = function (dt, dz) {
      // ---- lateral -------------------------------------------------------
      if (s.laneT < 1) {
        s.laneT = Math.min(1, s.laneT + dt / K.LANE_CHANGE_TIME);
      }
      // Smoothstep gives the move a weighted start and a settled landing.
      const t = s.laneT;
      const e = t * t * (3 - 2 * t);
      const from = K.LANE_X[s.laneFrom], to = K.LANE_X[s.lane];
      const prevX = s.x;
      s.x = from + (to - from) * e;

      // Lean is derived from actual lateral velocity, so it is always in
      // sympathy with the movement even if lane timing changes.
      const vx = dt > 0 ? (s.x - prevX) / dt : 0;
      const targetLean = Math.max(-1, Math.min(1, vx / 14));
      s.lean += (targetLean - s.lean) * (1 - Math.pow(0.0008, dt));

      // ---- vertical ------------------------------------------------------
      if (s.airborne) {
        s.airT += dt / K.JUMP_TIME;
        if (s.airT >= 1) {
          s.airT = 0; s.airborne = false; s.y = 0;
          s.events.push('land');
        } else {
          // Asymmetric arc: quick rise, floatier fall. Reads as athletic.
          const a = s.airT;
          // Flatter apex than a ballistic arc. The exponents are the whole
          // point: at 1.7/1.85 the runner spent most of the airtime climbing
          // or falling and only 0.46s above the clearance height. Raising them
          // rushes the take-off and hangs the top of the arc, which buys
          // timing window without changing the height or the duration.
          const shape = a < 0.42
            ? 1 - Math.pow(1 - a / 0.42, 2.6)
            : 1 - Math.pow((a - 0.42) / 0.58, 2.6);
          s.y = K.JUMP_HEIGHT * shape;
        }
      }

      // ---- duck ----------------------------------------------------------
      if (s.ducking) {
        s.duckT += dt / K.DUCK_TIME;
        if (s.duckT >= 1) { s.ducking = false; s.duckT = 0; }
      }
      // Fast in, slower out.
      const target = s.ducking ? 1 : 0;
      const rate = s.ducking ? K.DUCK_IN_RATE : K.DUCK_OUT_RATE;
      s.duck01 += (target - s.duck01) * Math.min(1, rate * dt);

      // ---- falling off a roof --------------------------------------------
      // Driven here rather than in resolveDeck so it keeps running on the
      // frames the runner is over open road with no ramp to ask about.
      if (s.falling > 0) {
        s.falling = Math.min(1, s.falling + dt / FALL_TIME);
        // 1 - t*t: zero vertical speed at the lip, accelerating downward, and
        // exactly zero at t = 1. A linear ramp reads as being lowered on a wire.
        s.surface = s.fallFrom * (1 - s.falling * s.falling);
        if (s.falling >= 1) {
          s.falling = 0; s.surface = 0; s.fallFrom = 0;
          s.events.push('land');
        }
      }

      s.stumble = Math.max(0, s.stumble - dt * 2.2);
      s.bounce -= s.bounce * Math.min(1, dt * 5.5);
      if (Math.abs(s.bounce) < 0.001) s.bounce = 0;
      if (s.tripT > 0) s.tripT = Math.max(0, s.tripT - dt / 0.55);
    };

    /**
     * The second running surface: mount a ramp, ride a roof, leave one.
     *
     * ---- WHY THIS IS CONTINUOUS WHEN EVERYTHING ELSE IS A PLANE ----------
     *
     * Every other contact in this game is a single-plane test at gate.z, and
     * that has always been a defensible simplification because a hazard's
     * relationship to the player does not change between gate lines: you were
     * in its lane or you were not.
     *
     * A roof breaks that, in both directions. You can leave it between gate
     * lines by changing lane, and you can arrive at its flank between gate
     * lines by changing lane. Neither has a gate to fire at.
     *
     * SO IT ALSO EXPOSES SOMETHING THAT WAS ALREADY TRUE AND IS NOT ABOUT THE
     * RAMP AT ALL. resolveGates is the only contact path in this file, it fires
     * only at gate.z, and a BLOCK train is one gate carrying up to eighteen
     * units of vehicle. A player who is in a clear lane at the gate line and
     * then swerves into the trained lane runs the entire length of that vehicle
     * with nothing to touch. That is a hole in the shipped game, it is
     * measurable (tools/mechanics.js --passthrough drives the real Player
     * through it), and this function closes it for rideable trains as a side
     * effect of having to know where the flank is. It does not close it for
     * ordinary ones -- that would be a difficulty change to the shipped game
     * and is not this pass's to make.
     *
     * @returns null, or { hit, z, why } when contact was made
     */
    s.resolveDeck = function (course, unitsBefore, unitsNow) {
      if (!course || !course.deckAt) return null;
      const geo = course.deckAt(unitsNow, s.lane);
      // Over open road: the latch is spent and the next vehicle is a fresh
      // incident. Cleared here rather than at the bounce, because the bounce
      // does not always succeed -- see the note on it below.
      if (geo <= 0) s.flanked = false;

      if (s.ramp) {
        // Still on the same vehicle: the roof IS the ground.
        if (geo > 0 && course.rampAt(unitsNow, s.lane) === s.ramp) {
          s.surface = geo;
          s.falling = 0;
          return null;
        }
        // Off it. The two ways off are not the same event and must not read as
        // the same event: running off the front is a dismount the mechanic is
        // FOR, and leaving sideways is stepping off a lorry at race pace.
        const offFront = unitsNow >= s.ramp.z1;
        s.fallFrom = s.surface;
        s.falling = 1e-6;              // non-zero so update() takes it from here
        s.ramp = null;
        if (offFront) { s.events.push('dismount'); return null; }
        s.tripT = 1;
        s.stumble = 0.9;
        s.events.push('fall');
        s.events.push('hit');
        return { hit: true, z: unitsNow, why: 'fell off the side' };
      }

      if (geo <= 0) return null;

      const r = course.rampAt(unitsNow, s.lane);
      if (!r) return null;

      // There is a vehicle here and the runner is not on top of it. Coming in
      // over the tailgate is a mount; arriving anywhere past it is arriving at
      // the flank, which is a wall.
      if (unitsBefore <= r.z0 + r.run && s.falling <= 0) {
        s.ramp = r;
        s.surface = geo;
        s.events.push('mount');
        return null;
      }

      // ---- ONE CONTACT PER VEHICLE, NOT ONE PER FRAME --------------------
      //
      // The first version of this bounced the runner back to `laneFrom`, which
      // is correct only while a lane change is still in flight. Once laneT has
      // reached 1, laneFrom EQUALS lane, the swap was a no-op, and the runner
      // stayed inside the lorry taking a fresh contact every frame -- seven of
      // them per incident at 60 Hz, in a game where one contact ends a record
      // attempt. tools/mechanics.js found it by tracing the z of every flank
      // hit and seeing them arrive 1.3 units apart; the summary count alone
      // read as a design finding about lane changes and was nothing of the sort.
      //
      // So it does what resolveGates already does for a BLOCK: pick a lane that
      // is actually free at this z, preferring the middle so a knock never puts
      // the player somewhere they cannot recover from.
      const cands = [];
      for (const d of [-1, 1]) {
        const t = s.lane + d;
        if (t < 0 || t > 2) continue;
        if (course.deckAt(unitsNow, t) > 0) continue;
        cands.push(t);
      }
      const to = cands.length
        ? cands.reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a))
        : s.lane;
      if (to !== s.lane) {
        s.bounce = to > s.lane ? 1 : -1;
        s.laneFrom = s.lane;
        s.lane = to;
        s.laneT = 0.35;
      }
      // ...and a latch as well as a bounce, because `to === s.lane` is reachable
      // when two vehicles overlap either side. A latch cannot be defeated by
      // geometry; it clears the moment the runner is over open road again.
      if (s.flanked) return null;
      s.flanked = true;
      s.stumble = 1;
      s.events.push('bounce');
      s.events.push('hit');
      return { hit: true, z: unitsNow, why: 'ran into the flank' };
    };

    /**
     * Resolve every gate the player passed this step.
     * @returns array of { gate, kind, clean }
     */
    s.resolveGates = function (course, unitsBefore, unitsNow) {
      const out = [];
      while (s.gateIdx < course.gates.length && course.gates[s.gateIdx].z <= unitsNow) {
        const gate = course.gates[s.gateIdx];
        if (gate.z < unitsBefore - 1e-6) { s.gateIdx++; continue; }
        s.gateIdx++;

        const kind = gate.lanes[s.lane];
        const clean = C.clears(kind, s);
        if (!clean) {
          // Contact is not one thing. Running into a wall and clipping a kerb
          // used to produce the identical result -- pass straight through,
          // lose the streak -- which is why a hit read as the game glitching
          // rather than as the runner hitting something.
          if (kind === K.BLOCK) {
            // A wall you cannot clear THROWS you out of its lane. Pick the
            // side that is actually open at this gate, preferring the middle
            // so a knock never puts the player somewhere they cannot recover
            // from, and never leaves them still inside the thing they hit.
            const cands = [];
            for (const d of [-1, 1]) {
              const t = s.lane + d;
              if (t < 0 || t > 2) continue;
              if (gate.lanes[t] === K.BLOCK) continue;
              cands.push(t);
            }
            const to = cands.length
              ? cands.reduce((a, b) => (Math.abs(b - 1) < Math.abs(a - 1) ? b : a))
              : s.lane;
            if (to !== s.lane) {
              s.bounce = to > s.lane ? 1 : -1;
              s.laneFrom = s.lane;
              s.lane = to;
              // Snap most of the way across: this is a knock, not a choice.
              s.laneT = 0.35;
            }
            s.stumble = 1;
            // Do NOT clear `airborne` here. `y` is only ever written inside
            // the airborne branch of update(), so dropping the flag mid-jump
            // froze the runner's height at whatever it was -- a wall taken at
            // the apex left them hanging 2.05 units above the road for the
            // REST OF THE RACE. Instead, throw them to the end of the arc so
            // update() flies the last fraction of the descent and fires its
            // own 'land' event: the player is knocked down rather than
            // teleported, and the height always resolves to zero.
            if (s.airborne) s.airT = Math.max(s.airT, 0.86);
            s.ducking = false; s.duckT = 0;
            s.events.push('bounce');
          } else {
            // A kerb or a bar trips you. You keep your lane and you keep
            // going -- the cost is the streak and the seconds, not control.
            s.tripT = 1;
            s.stumble = 0.75;
            s.events.push('trip');
          }
          s.events.push('hit');
        }
        s.lastResult = clean ? 'clean' : 'hit';
        out.push({ gate, kind, clean, lane: s.lane });
      }
      return out;
    };

    /**
     * Collect any aid the player ran through this step.
     *
     * Lane match only -- no action required and no vertical test. Aid is a
     * reward for choosing a line, not a fourth thing to time, and a bottle you
     * can miss by being mid-jump would make the aid lane a trap in a game
     * where the aid lane is supposed to be the merciful option.
     *
     * @returns array of collected items
     */
    s.resolveAid = function (course, unitsBefore, unitsNow) {
      const out = [];
      const aid = course.aid;
      if (!aid) return out;
      while (s.aidIdx < aid.length && aid[s.aidIdx].z <= unitsNow) {
        const item = aid[s.aidIdx];
        if (item.z < unitsBefore - 1e-6) { s.aidIdx++; continue; }
        s.aidIdx++;
        if (item.lane === s.lane) {
          out.push(item);
          s.events.push('aid');
        }
      }
      return out;
    };

    s.drainEvents = function () {
      const e = s.events.slice();
      s.events.length = 0;
      return e;
    };

    return s;
  }

  return { create };
})();
