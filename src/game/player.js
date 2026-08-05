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
      gateIdx: 0,
      aidIdx: 0,
      lastResult: null,  // 'clean' | 'hit'
      lastResultAt: -99,
      events: [],        // drained by main for audio/HUD reactions
    };

    s.reset = function () {
      s.lane = 1; s.laneFrom = 1; s.laneT = 1; s.x = 0; s.y = 0;
      s.airT = 0; s.airborne = false; s.duckT = 0; s.ducking = false;
      s.duck01 = 0; s.lean = 0; s.stumble = 0; s.bounce = 0; s.tripT = 0;
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
          const shape = a < 0.42
            ? 1 - Math.pow(1 - a / 0.42, 1.7)
            : 1 - Math.pow((a - 0.42) / 0.58, 1.85);
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
      const rate = s.ducking ? 16 : 9;
      s.duck01 += (target - s.duck01) * Math.min(1, rate * dt);

      s.stumble = Math.max(0, s.stumble - dt * 2.2);
      s.bounce -= s.bounce * Math.min(1, dt * 5.5);
      if (Math.abs(s.bounce) < 0.001) s.bounce = 0;
      if (s.tripT > 0) s.tripT = Math.max(0, s.tripT - dt / 0.55);
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
            s.airborne = false; s.airT = 0;
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
