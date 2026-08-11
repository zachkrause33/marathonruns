/**
 * Hazard clearance.
 *
 * Clearance is decided by player *state*, not by intersecting the visual
 * meshes. That is a deliberate choice: mesh intersection makes fairness an
 * emergent property of geometry nobody can see, and produces the classic
 * runner complaint of "I jumped and still hit it". State thresholds are
 * legible, tunable in one place, and can be proved against the jump arc.
 *
 * The visual boxes below are what world.js builds, and MARGINS records how
 * much room the player actually has at each threshold -- so if someone
 * retunes the jump or the bar height, `audit()` says whether the two still
 * agree instead of leaving it to playtesting.
 */
MR.Collision = (function () {
  const K = MR.K;

  // Visual extents, in world units, matching world.js geometry.
  //
  // ---- WHY BLOCK IS 1.95 DEEP AND NOT 0.65 ------------------------------
  //
  // 0.65 made the envelope 1.30 deep against a lane 1.70 wide: every vehicle
  // in the fleet was WIDER THAN IT WAS LONG, seen from above. That is not a
  // stylisation, it is a category error -- and it had a hard consequence the
  // fleet rebuild ran into and could not solve from its own side: the wheels
  // are 0.60-0.72 across, so a second axle left 0.04-0.10 between the front
  // and rear tyre. Every "car" in this game was a tracked vehicle, because
  // two axles did not fit.
  //
  // THE SCALE ARGUMENT, which is what sets the number. This world is roughly
  // one unit to the metre VERTICALLY: the runner is 1.78 tall, and the fleet's
  // own roof heights in MEASUREMENTS.md corroborate it -- bus 2.78 against a
  // real 3.0-3.2, tram 2.44+pantograph 2.77 against 3.2-3.6, saloon roof 1.62
  // against 1.45. Height has always been a real dimension here.
  //
  // WIDTH HAS NOT. Every BLOCK must fill the lane it blocks, so all ten
  // variants are ~1.60 wide by contract -- a bus, a tram and a moped at the
  // same width. Width is a gameplay constant that has been deliberately
  // falsified, and it is the one axis a length must NOT be derived from:
  // scaling length off width propagates the lane compression into the length
  // and hands back a fleet that is all one size again.
  //
  // So length is set on the same scale as height. A saloon is 4.6 m, and at
  // the ~0.85 compression the roof heights already show that is 3.90 -- which
  // is halfZ 1.95, and lands the taxi at 3.90 x 1.60 = 2.44:1 in plan against
  // a real saloon's 2.56:1. Two axles now fit with 1.17 between the tyres
  // instead of 0.07, and the depth is measured from the same ruler the rest of
  // the object already used.
  //
  // WHAT THIS COSTS, measured over 90 days rather than argued: gate count
  // 194.8 -> 188.7, the perfect finish 1:57:52 -> 1:57:54, and the record
  // still survives exactly one mistake unaided. It is nearly free because
  // collision is a PLANE TEST -- see clears() -- so depth reaches only the
  // spacing floor and the occlusion audit, never contact.
  //
  // ONE NUMBER PER KIND, NOT PER VARIANT, AND THAT IS A DECISION. world.js
  // boxes every variant of a kind with this one halfZ (see gateBoxes), and
  // tools/shoot.js's BLANKS assertion casts those boxes. A box SHORTER than
  // the art it stands for makes BLANKS under-count occlusion and pass a gate
  // the art really does hide -- the exact defect already in the corrections
  // list. So this number is a CEILING the whole fleet must fit inside, and a
  // per-variant table would have to be adopted by world.js in the same change
  // or it makes the audit dishonest in the dangerous direction. It is not.
  // The long vehicles get their length from the train span instead, which is
  // what that mechanism is for: see Course.reachOf.
  //
  // ---- WHERE THE BOX SITS RELATIVE TO THE GATE LINE ---------------------
  //
  // AT ITS NEAR FACE, not at its centre, and that changed with the depth.
  //
  // Contact is a single-plane test: resolveGates fires the instant the runner's
  // z passes gate.z, and clears() then asks about player STATE. Nothing about
  // that is wrong -- but a box CENTRED on the gate line puts halfZ of solid
  // geometry BEFORE the plane, so the runner is inside the object for halfZ of
  // travel with the game still calling it clear. At 0.65 that was 25 ms and
  // nobody could see it. At 1.95 it is 74 ms -- 4.4 frames at 60 Hz -- and the
  // runner is buried to the shoulders in a bus before the game admits it.
  //
  // So the box now spans z = [gate.z, gate.z + 2 * halfZ]: the face the runner
  // reaches FIRST is the gate line, and contact fires on touch. `halfZ` keeps
  // its name and its value because it is still half the depth, and because
  // Course.HAZARD_HALF_Z is guarded against it by tools/shoot.js.
  //
  // world.js offsets the art by exactly this halfZ at one place (see
  // hazardPool) rather than re-authoring every variant's z, so a variant is
  // still authored about its own centre and gate-space z is span * (local z +
  // halfZ). The telegraph mat is NOT offset -- it is painted on the road in
  // FRONT of the hazard and its job is to reach the gate line, which it now
  // does exactly instead of running 1.30 units underneath the vehicle.
  //
  // WHAT IT COSTS. The gap a gate owes the next one is measured to its far
  // face (Course.reachOf), and nose-anchoring moves that face from
  // halfZ * (2*span - 1) to 2 * halfZ * span -- +1.95 on a standing BLOCK.
  // Measured over 90 days: gate count 190.4 -> 187.7, and the perfect finish
  // is unchanged to the second, because pace integrates over distance and not
  // over gates.
  //
  // ---- halfX, AND WHY IT HAD TO EXIST -----------------------------------
  //
  // There was no halfX here at all. world.js's gateBoxes -- the boxes the
  // occlusion audit casts against -- wrote `halfX: LANE * 0.5` itself, so the
  // art file was deciding the width of the audited envelope. That is exactly
  // what rule 4 of CLAUDE.md forbids and nothing anywhere was watching it.
  //
  // IT WAS NOT SAFE, WHICH IS WHY IT NEEDED A NUMBER. The brief that
  // commissioned this said the hole was harmless -- "box 1.70 against widest
  // art 1.56". Measured on the swept geometry of all seventeen variants, that
  // is false and always was: fourteen of them reach past 0.85, the widest
  // static art is the DUCK frame at 1.148, and the marshals' stop paddle
  // sweeps to 1.865. LANE * 0.5 would have been the tightest number in the
  // file, understating the occluder every hazard in the game really is, which
  // is the one direction the audit cannot survive: a box narrower than its art
  // makes BLANKS under-count and pass a gate the art hides.
  //
  // 1.12 IS NOT READ OFF THE ART EITHER. It is the number world.js has derived
  // every clearance in the game from since HAZARD_HALF was written -- the play
  // corridor, the landmark stand-off, the aid tables all answer to it -- and
  // it predates this measurement by a long way. What changes is that it is
  // stated in the contract instead of in the art file, and that it is now
  // ENFORCED: three variants were outside it, including one that had a comment
  // beside it claiming it was inside, and the art moved rather than the number.
  // world.js keeps a copy because collision.js loads after it; tools/shoot.js
  // fails the build if the two ever disagree, exactly as it does for
  // Course.HAZARD_HALF_Z.
  const HALF_X = 1.12;
  const BOX = {
    [K.JUMP]: { yMin: 0.00, yMax: 0.80, halfX: HALF_X, halfZ: 0.52 },
    [K.DUCK]: { yMin: 1.41, yMax: 1.83, halfX: HALF_X, halfZ: 0.30 },
    [K.BLOCK]: { yMin: 0.00, yMax: 2.80, halfX: HALF_X, halfZ: 1.95 },
  };

  // State thresholds.
  //
  // Both of these are set BY the audit below rather than by feel, and the
  // first values chosen (0.62 and 0.50) failed it: at 0.62 the feet were
  // still 0.18 below the top of a 0.80 block, and at 0.50 the head sat at
  // 1.57 with the bar starting at 1.41. In both cases the player would have
  // been waved through while visibly passing through the obstacle -- exactly
  // the "I cleared it and still got hit" complaint in reverse, and worse in a
  // game where one contact costs the record. The thresholds now leave real
  // daylight, and audit() is what proves it.
  //
  // The airborne window stays generous: at 0.84 the feet are above the block
  // from t=0.07s to t=0.53s of a 0.62s jump, which is ~12 world units of
  // ground at race pace.
  const JUMP_CLEAR_Y = 0.84;   // feet must be this high at the gate line
  const DUCK_CLEAR = 0.90;     // duck must be all but fully committed

  const PLAYER_STAND_TOP = MR.Runner.HEIGHT;   // 1.78
  const PLAYER_DUCK_DROP = 0.42;

  /**
   * Can the player pass `kind` in their current state?
   * @param st { y, duck01, surface }
   *
   * ---- WHAT `surface` ADDED, AND WHY IT IS INERT UNTIL A RAMP EXISTS ------
   *
   * `st.surface` is the height of the ground the runner is standing on: 0 on
   * the road, and MR.Course.DECK_Y on the roof of a rideable BLOCK train. `st.y`
   * keeps its exact old meaning -- height above THAT surface -- which is the
   * same discipline main.js already applies to hills, where player.y is height
   * above the LOCAL road and elevation is added once, at the very end.
   *
   * Every clause below reduces to the shipped expression at surface = 0, and
   * that is checked rather than asserted: tools/mechanics.js --identity
   * generates the whole calendar with the ramp off and compares a hash.
   *
   *   JUMP   feet at (y + surface). On the road this is y, unchanged.
   * ---- AND clears() IS NO LONGER THE WHOLE OF WHETHER A BLOCK IS HIT -----
   *
   * It is the whole of whether a BLOCK is hit AT ITS GATE LINE, which is a
   * narrower claim than this file used to make. A BLOCK is a solid 3.9 to 17.9
   * units deep and its FLANK is now solid too, on the owner's instruction --
   * "a vehicle you can see is a vehicle you can hit". That test cannot live
   * here, because it is not a question about player state at an instant: it is
   * a question about whether the runner entered a volume from the side, which
   * needs the step he took to get there. It lives in player.resolveDeck and it
   * reads MR.Course.occupiedAt.
   *
   * The division between them is the near face. resolveDeck defers every
   * head-on entry to resolveGates, so one solid charges one contact and the
   * clause below still decides it. See the note above resolveDeck.
   *
   *   BLOCK  cleared if and only if the runner is ON it -- `st.onDeck`, the
   *          player's own answer to "am I standing on this thing", set by
   *          resolveDeck. A HEIGHT comparison was the obvious way to write this
   *          and it is wrong: the tailgate meets the road, so at the foot of
   *          every ramp the surface height is still zero, and `surface >= yMax`
   *          would call the first frame of every mount a collision with the
   *          lorry the runner is visibly running up. Being supported by a thing
   *          is a fact about support, not about altitude. Undefined is false,
   *          so with no ramp on the course this is `return false`, which is
   *          exactly what it was.
   *   DUCK   deliberately reads `surface`, NOT `y + surface`. The jump apex is
   *          2.05 and a DUCK bar's underside is 1.41 with its top at 1.83, so
   *          `y + surface >= yMax` would let a plain jump sail over every duck
   *          bar in the game -- a silent difficulty change worth more than the
   *          whole of this pass, arriving through a clause that looks like
   *          tidying. Only a SURFACE above the bar clears it.
   *
   * The JUMP and DUCK surface terms are both reachable in exactly one state
   * that is not a roof: the half-second fall back to the road, where the runner
   * really is two units up. That is left physically honest rather than special-
   * cased, because it cannot be farmed -- leaving a roof anywhere but off the
   * front already costs the streak -- and because tools/mechanics.js proves no
   * gate ever falls inside a fall on any of the 365 days.
   */
  /**
   * ---- CLEARANCE IS RELATIVE TO THE SURFACE THE HAZARD STANDS ON ---------
   *
   * `clears(kind, st)` asks about a hazard standing on the ROAD, and every
   * expression in it is written against a road at y = 0. A cone on a rideable
   * deck is the same object standing on a floor 2.80 units up, and the shipped
   * expression gets it exactly wrong in the dangerous direction: the runner's
   * own `surface` is 2.80 up there too, so `(y || 0) + surface >= 0.84` is true
   * before he has left the deck at all. Every roof cone would be cleared by
   * standing still.
   *
   * So the general form takes the height of the FLOOR THE HAZARD IS ON, and
   * clears() is that form at floor zero -- literally, by calling it. There is
   * one expression per kind in this file and there will go on being one.
   *
   *   JUMP   the feet, measured from the hazard's own floor. `y` is height above
   *          the runner's surface and the two surfaces are equal on a deck, so
   *          up there this is exactly `y >= JUMP_CLEAR_Y`: the same jump, at the
   *          same threshold, 2.80 units higher.
   *   DUCK   unchanged in form. `surface - floor` is what clears a bar by
   *          standing on something above it, which on the road is the half-second
   *          fall and on a deck would be a second deck -- neither of which the
   *          generator produces over a bar, and both of which stay physically
   *          honest if it ever does.
   *   BLOCK  `onDeck` is a fact about support, not about altitude, so the floor
   *          does not enter it. A BLOCK is never generated on a deck (see the
   *          cone note in course.js: a deck has no sideways, so the only legal
   *          roof hazard is one a jump answers).
   */
  function clearsOn(kind, st, floor) {
    if (kind === K.CLEAR) return true;
    const surface = (st.surface || 0) - (floor || 0);
    if (kind === K.BLOCK) return st.onDeck === true;
    if (kind === K.JUMP) return (st.y || 0) + surface >= JUMP_CLEAR_Y;
    if (kind === K.DUCK) return (st.duck01 || 0) >= DUCK_CLEAR || surface >= BOX[K.DUCK].yMax;
    return true;
  }

  function clears(kind, st) { return clearsOn(kind, st, 0); }

  /**
   * Verify the state thresholds are physically honest against the visuals:
   * clearing a jump must actually put the feet above the block, and a
   * committed duck must actually put the head under the bar.
   */
  function audit() {
    const notes = [];
    const jumpBox = BOX[K.JUMP];
    if (JUMP_CLEAR_Y < jumpBox.yMax) {
      notes.push(
        `jump threshold ${JUMP_CLEAR_Y} is below block top ${jumpBox.yMax} ` +
        `-- player can clear while visually intersecting`
      );
    }
    const duckTop = PLAYER_STAND_TOP - PLAYER_DUCK_DROP * DUCK_CLEAR;
    if (duckTop > BOX[K.DUCK].yMin) {
      notes.push(
        `at the duck threshold the head reaches ${duckTop.toFixed(2)} but the ` +
        `bar starts at ${BOX[K.DUCK].yMin} -- player clears while clipping`
      );
    }
    const fullDuckTop = PLAYER_STAND_TOP - PLAYER_DUCK_DROP;
    if (fullDuckTop > BOX[K.DUCK].yMin) {
      notes.push(`even a full duck (${fullDuckTop.toFixed(2)}) does not fit under ${BOX[K.DUCK].yMin}`);
    }
    if (K.JUMP_HEIGHT <= jumpBox.yMax) {
      notes.push(`jump apex ${K.JUMP_HEIGHT} does not exceed block top ${jumpBox.yMax}`);
    }
    if (K.JUMP_HEIGHT >= BOX[K.BLOCK].yMax) {
      notes.push(`jump apex ${K.JUMP_HEIGHT} clears the impassable block -- BLOCK is not impassable`);
    }
    return { ok: notes.length === 0, notes };
  }

  return {
    BOX, clears, clearsOn, audit,
    JUMP_CLEAR_Y, DUCK_CLEAR,
    PLAYER_STAND_TOP, PLAYER_DUCK_DROP,
  };
})();
