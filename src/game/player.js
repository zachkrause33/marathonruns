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
      // The occupancy span whose contact is already spent, or null. Holds the
      // SPAN rather than a flag so a bounce out of one lorry and into the next
      // is two incidents and not one -- see resolveDeck.
      flanked: null,
      gateIdx: 0,
      aidIdx: 0,
      lastResult: null,  // 'clean' | 'hit'
      lastResultAt: -99,
      // The last gate resolved: { idx, lane, clean }. The receipt a guarded aid
      // item is bought with -- see resolveGates and resolveAid.
      lastGate: null,
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
      s.surface = 0; s.ramp = null; s.falling = 0; s.fallFrom = 0; s.flanked = null;
      s.gateIdx = 0; s.aidIdx = 0;
      s.lastResult = null; s.lastGate = null; s.events.length = 0;
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
     * The solid a lane is standing in: mount a ramp, ride a roof, leave one --
     * and run into the flank of anything you did not.
     *
     * ---- WHY THIS IS CONTINUOUS WHEN EVERYTHING ELSE IS A PLANE ----------
     *
     * Every other contact in this game is a single-plane test at gate.z, and
     * that was always defended on the grounds that a hazard's relationship to
     * the player does not change between gate lines: you were in its lane or
     * you were not.
     *
     * That defence was false for the one hazard it mattered for. A BLOCK train
     * is ONE gate carrying up to 17.9 units of vehicle, so a player who was in
     * a clear lane at the gate line and swerved a moment later ran the entire
     * length of a bus with nothing to touch. Measured on the shipped generator
     * by tools/mechanics.js: 4895 of 4895 trains over 365 days recorded no
     * contact at all. You could run through the side of a tram.
     *
     * The owner was shown that, told plainly that closing it makes the game
     * harder, and chose to close it -- "a vehicle you can see is a vehicle you
     * can hit." So this function is now the flank test for EVERY vehicle, not
     * only for the rideable ones, and it reads MR.Course.occupiedAt, which is
     * the one place a lane's occupancy is stated.
     *
     * ---- THE NEAR FACE BELONGS TO THE GATE LINE, AND THAT IS THE WHOLE OF
     *      HOW TWO CONTACT PATHS SHARE ONE SOLID ----------------------------
     *
     * resolveGates already charges for a BLOCK taken head-on, and it does more
     * than charge: it throws the runner out of the lane and it decides whether
     * the gate was clean. If this function also fired on the step that crosses
     * the gate line, one wall would cost two contacts -- or worse, would bounce
     * the runner into a free lane BEFORE resolveGates looked, turning a wall
     * into one flank contact plus a free clean gate.
     *
     * The test that divides them is physical rather than procedural, so it does
     * not depend on which resolver main.js calls first: a span's near face IS
     * its gate line, so `unitsBefore < span.z0` means the runner arrived
     * head-on and resolveGates owns it, and `unitsBefore >= span.z0` means the
     * runner was already past the face and came in from the side. A mount is
     * the one exception and has to be, because it is entered head-on and must
     * be established before resolveGates asks the BLOCK whether it was cleared.
     *
     * @returns null, or { hit, z, why } when contact was made
     */
    s.resolveDeck = function (course, unitsBefore, unitsNow) {
      if (!course || !course.occupiedAt) return null;
      const span = course.occupiedAt(unitsNow, s.lane);
      // The latch holds the SPAN, not a boolean. Over open road, or over a
      // different vehicle, this incident is a fresh one -- and a boolean could
      // not tell the second lorry from the first when a bounce puts the runner
      // straight into it. Cleared here rather than at the bounce, because the
      // bounce does not always succeed; see the note on it below.
      if (s.flanked && s.flanked !== span) s.flanked = null;

      if (s.ramp) {
        // Still on the same vehicle: the roof IS the ground.
        if (span && span.ride === s.ramp) {
          s.surface = course.deckAt(unitsNow, s.lane);
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

      if (!span) return null;

      // A rideable train entered over its tailgate is a mount, whichever
      // direction the runner came from -- head-on off the road, or sideways
      // onto the low end of the slope. Established BEFORE the near-face test
      // below, because the mount is the one head-on entry resolveGates must see
      // already resolved: Collision.clears(BLOCK) asks `onDeck`, and a mount
      // settled one step late records the runner colliding with the lorry he is
      // visibly running up.
      if (span.ride && unitsBefore <= span.ride.z0 + span.ride.run && s.falling <= 0) {
        s.ramp = span.ride;
        s.surface = course.deckAt(unitsNow, s.lane);
        s.events.push('mount');
        return null;
      }

      // Head-on. The runner crossed the near face this step, which is the gate
      // line, so this is resolveGates' contact and not ours. See the note above.
      if (unitsBefore < span.z0) return null;

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
      // the player somewhere they cannot recover from. Free is now asked of
      // occupiedAt rather than of deckAt, which only ever answered for roofs --
      // the old test would happily bounce the runner into the side of a taxi.
      const cands = [];
      for (const d of [-1, 1]) {
        const t = s.lane + d;
        if (t < 0 || t > 2) continue;
        if (course.occupiedAt(unitsNow, t)) continue;
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
      // when two vehicles stand either side. A latch cannot be defeated by
      // geometry; it clears the moment the runner is over open road again.
      if (s.flanked === span) return null;
      s.flanked = span;
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
        // ---- THE RECEIPT FOR THE GATE JUST PASSED --------------------------
        //
        // Which gate, in which lane, and whether it was cleared. resolveAid
        // reads this and nothing else to decide whether a guarded item has been
        // earned -- see the note there. Written BEFORE the BLOCK bounce below,
        // because the bounce moves s.lane and the receipt has to say the lane
        // the runner was actually IN when the gate resolved, not the one they
        // were thrown into by it.
        //
        // Index rather than object identity: course.gates is regenerated from
        // the date seed in several places (the replay path builds its own), and
        // an item that remembers a gate by pointer would silently never match.
        s.lastGate = { idx: s.gateIdx - 1, lane: s.lane, clean };
        if (!clean) {
          // Contact is not one thing. Running into a wall and clipping a kerb
          // used to produce the identical result -- pass straight through,
          // lose the streak -- which is why a hit read as the game glitching
          // rather than as the runner hitting something.
          if (kind === K.BLOCK) {
            // ---- SPEND THIS VEHICLE'S CONTACT -----------------------------
            //
            // The wall the runner just hit is 3.9 to 17.9 units deep and its
            // flank is now solid, so without this the bounce is charged once
            // here and then again by resolveDeck on the next step whenever the
            // knock had nowhere to go -- two contacts for one lorry, in a game
            // where one contact ends a record attempt. Latching the SPAN means
            // whichever path fires first, the vehicle is spent until the runner
            // is clear of it. Guarded so a course without occupancy (none now,
            // but the headless tools construct partial ones) still resolves.
            if (course.occupiedAt) s.flanked = course.occupiedAt(gate.z, s.lane) || null;
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
     * NO ACTION IS REQUIRED AND THERE IS NO VERTICAL TEST. Aid is a reward for
     * choosing a line, not a fourth thing to time, and a bottle you can miss by
     * being mid-jump would make the aid lane a trap in a game where the aid
     * lane is supposed to be the merciful option. That has not changed and must
     * not: a runner who ploughs straight into the block still takes the bottle
     * behind it, having paid for it with the streak.
     *
     * ---- WHAT A GUARDED ITEM IS BOUGHT WITH, AND WHY IT IS NOT THE LANE ----
     *
     * Every road item is now laid directly behind a JUMP or a DUCK, in that
     * hazard's own lane, at a gate that also offers a lane through for nothing
     * (see the placement rule in course.js). The point of that is that reaching
     * the bottle should mean answering the obstacle in front of it.
     *
     * A LANE MATCH AT A POINT CANNOT ENFORCE THAT, and measurement is why this
     * is here rather than a paragraph claiming it does. player.changeLane moves
     * `lane` on the same frame the input is served, so any patch of road can be
     * reached by a swerve -- and a bot in tools/aid.js that took the free lane
     * at the gate and then cut in behind it collected 61% of the course's aid
     * for a third of a contact. Pushing the item closer to the gate only makes
     * the window smaller; it never closes it, and it makes the answer depend on
     * the frame rate, which is not a thing fairness may depend on.
     *
     * So a guarded item carries the INDEX OF THE GATE IT STANDS BEHIND, and is
     * bought at that gate rather than on the road: the runner has to have been
     * in the item's lane when the gate resolved. Cleanly or not -- see above.
     *
     * This is not a new kind of rule. It is exactly the shape the roof already
     * had, one step down: a roof item is collected only by a runner standing on
     * the ramp that carries it, and a guarded item only by one who came through
     * the obstacle that guards it. Both say the same thing -- the reward is
     * paid for by where you chose to be, and the pickup is the receipt.
     *
     * The instantaneous lane test is DROPPED for a guarded item, deliberately.
     * Keeping both would mean a player who paid at the gate and then swerved
     * inside the two units before the bottle paid and got nothing, which is a
     * trap measured in frames. The gate receipt is the whole test.
     *
     * ---- ONE PLACE STILL DESCRIBES THE OLD RULE, AND IT IS NOT THIS FILE ---
     *
     * world.js decides when to POP a pickup -- the little punch-out that says
     * you got it -- with its own copy of the test, and its copy is the one this
     * function used to have:
     *
     *     e.it.lane === playerLane && e.it.z <= z && z - e.it.z < 6
     *
     * That is a lane match at a point, so it and this function now answer
     * differently in exactly the case the guard exists for: a runner who takes
     * the free lane at the gate and cuts into the aid lane a unit later gets the
     * animation and no gain, and one who pays at the gate and immediately
     * swerves out gets the gain and no animation. Both windows are under two
     * units -- three frames -- so neither is reachable except on purpose, which
     * is why this is a note rather than a fix landed here: world.js belongs to
     * another pass and a renderer edit made blind from this file is how two
     * copies of a rule become three.
     *
     * The hook it needs is already on the state: `s.lastGate` is the receipt,
     * and popping off THAT rather than off the lane deletes the second copy of
     * the rule instead of correcting it. Recorded in docs/roadmap.md.
     *
     * ---- A ROOF ITEM IS NOT A ROAD ITEM AT A DIFFERENT HEIGHT --------------
     *
     * Lane match alone was the whole test, and with roof pickups on the course
     * that made the ramp FREE: the item sits in the ramp's lane, so a runner at
     * road level in that lane collected it -- from inside the lorry, without
     * ever mounting. That is the exact opposite of the trade the roof exists to
     * be. The reward has to be paid for by being up there, so a roof item is
     * collected only while standing on the ramp that carries it, and a road
     * item is not collected from a roof at all.
     *
     * The second half is belt and braces rather than a fix: generateAid only
     * ever places road items in lanes that are passable at the gates either
     * side, and a rideable train's lane is BLOCK at its gate, so no road item
     * has ever been inside a vehicle. tools/mechanics.js checks that is still
     * true instead of leaving it to this sentence.
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
        if (item.gate != null) {
          // Bought at the gate, not on the road. Never from a roof, for the
          // same reason a road item never was: a runner up there did not come
          // through anything.
          const r = s.lastGate;
          if (s.onDeck || !r || r.idx !== item.gate || r.lane !== item.lane) continue;
        } else {
          if (item.lane !== s.lane) continue;
          // The ramp under the ITEM, not under the runner: they are the same
          // vehicle whenever this can pay out, and asking about the item is what
          // makes the test independent of where in the step the z landed.
          const carrier = item.roof && course.rampAt ? course.rampAt(item.z, item.lane) : null;
          if (item.roof ? s.ramp !== carrier || carrier === null : s.onDeck) continue;
        }
        out.push(item);
        s.events.push('aid');
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
