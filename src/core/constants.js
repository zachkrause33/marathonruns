/**
 * Race constants. These are the numbers the whole game is judged against, so
 * they are derived from the real marathon rather than picked for feel.
 *
 * Derivation, in full:
 *   Marathon      42.195 km            = 26.21875 mi
 *   Record chased 1:59:30              = 7170 s
 *   Record pace   7170 / 26.21875      = 273.46 s/mi = 4:33.5 /mi
 *   Player start  5:30 /mi             = 330 s/mi
 *
 * TIME_SCALE compresses race time into wall-clock time. A flawless run holds
 * roughly record pace, so it finishes in RECORD_SECONDS / TIME_SCALE = 239 s,
 * i.e. "about four minutes". A run that never strings anything together
 * averages START_PACE and takes 288 s. Everything else lands between.
 *
 * UNITS_PER_MILE maps race distance onto world geometry. It is chosen so the
 * runner moves at 21.8 - 26.9 world units/sec, which is the speed band where a
 * lane runner reads as fast without becoming unreadable.
 */
MR.K = (function () {
  const MARATHON_MILES = 42.195 / 1.609344;      // 26.21875
  const RECORD_SECONDS = 1 * 3600 + 59 * 60 + 30; // 7170
  const RECORD_PACE = RECORD_SECONDS / MARATHON_MILES;

  const UNITS_PER_MILE = 240;

  // Lateral spacing between lane centres. See the track geometry block below
  // for why this number and not another.
  const LANE_W = 1.70;

  return {
    MARATHON_MILES,
    MARATHON_LABEL: '26.2',
    RECORD_SECONDS,
    RECORD_PACE,                    // 273.463 s/mi
    RECORD_LABEL: '1:59:30',

    // Tuned against real generated courses (~176 gates), not a synthetic
    // spacing estimate. At these values a flawless run finishes 1:58:16, a
    // run with a single mistake squeaks in at 1:59:21, and two mistakes end
    // the record attempt. See tools/simulate.js.
    START_PACE: 330,                // 5:30 /mi
    FLOOR_PACE: 260,                // 4:20 /mi -- the ceiling on a perfect line
    STREAK_K: 20,                   // clean gates to close ~63% of the gap

    // Penalties. A hit keeps a quarter of the streak and costs race seconds.
    HIT_STREAK_KEEP: 0.25,
    HIT_TIME_PENALTY: 1.5,          // race seconds added on contact
    PACE_EASE: 2.2,                 // s/mi per race-second of easing toward target

    TIME_SCALE: 30,
    UNITS_PER_MILE,
    TOTAL_UNITS: MARATHON_MILES * UNITS_PER_MILE,  // 6292.5

    // Track geometry. LANE_W is the seed the whole track is cut from: the lane
    // centres, the tarmac, and every hazard width in world.js derive from it.
    //
    // It is set by the character, not by taste. The runner measures 0.78 world
    // units across the shoulders (deltoid to deltoid, live and posed -- see the
    // trunk in render/runner.js), and the reference runners in Subway Surfers
    // and Sonic occupy roughly 40-50% of their lane. The old 2.35 put ours at
    // 33%, which is why the road read as a six-lane motorway with a small
    // figure lost in the middle of it: at that ratio the lane is not a lane,
    // it is a field the runner happens to be standing in.
    LANE_W,
    // Lane 0 is the lane the player SEES on the left, and it has a POSITIVE
    // world x. That inversion is not a typo, it is the coordinate system:
    // the runner travels toward +z and the chase camera sits behind and looks
    // toward +z as well. A camera facing +z has world +x on its left, so the
    // whole scene is mirrored on screen. With the naive [-LANE_W, 0, LANE_W],
    // pressing left correctly moved the player to -x and the player correctly
    // saw them go right -- swipe and arrow keys both felt inverted, because
    // the world was.
    //
    // Flipping here fixes it for everything at once -- player, hazards,
    // telegraph mats, racing line -- because they all place off LANE_X, so
    // they stay mutually consistent and the course stays exactly as fair. It
    // also leaves the camera and lean maths untouched: "x increasing means
    // moving screen-left" is true before and after, so the bank still leans
    // into the turn the player sees.
    LANE_X: [LANE_W, 0, -LANE_W],
    LANE_COUNT: 3,
    // Three lanes plus a fixed shoulder each side. The shoulder is deliberately
    // NOT a fraction of the lane: what it has to hold -- the kerb, the outermost
    // hazard foot and a rival runner wide enough to be passed safely -- are all
    // real-scale objects that do not shrink when the lane does. 1.2 is the width
    // of one runner plus the hazard overhang, which is exactly its job.
    TRACK_HALF_WIDTH: LANE_W * 1.5 + 1.2,

    // Player motion.
    // Shortened with the lane rather than left alone. A lane change reads as
    // weight through the body lean and the camera bank, and both are driven by
    // lateral SPEED (player.js derives lean from vx, camera.js from its own
    // spring velocity) -- so holding 0.16s over a shorter hop would have
    // quietly turned a whip into a drift. Scaled by the square root, not
    // linearly: full proportionality lands at 0.12s, which is seven frames and
    // starts to read as a teleport rather than a movement.
    LANE_CHANGE_TIME: 0.16 * Math.sqrt(LANE_W / 2.35),
    JUMP_HEIGHT: 2.05,
    JUMP_TIME: 0.62,
    DUCK_TIME: 0.55,
    INPUT_BUFFER: 0.14,             // late/early press forgiveness

    // ---- aid: the way back into a race you are losing --------------------
    //
    // Pickups grant STREAK, never pace directly, and that distinction is the
    // whole design. "Only an unbroken clean line makes you faster" stays
    // literally true -- speed still comes from exactly one place -- but a
    // player who breaks their line now has a road back instead of watching a
    // dead record tick out over twenty miles.
    //
    // The exponential does NOT balance this on its own, which a first pass
    // assumed and simulation disproved: with an uncapped grant, taking every
    // item saved 161s on an already-flawless run and left a run with EIGHT
    // mistakes still beating the record. The value of aid is not in exceeding
    // the pace floor, it is in REACHING it sooner, and the ramp is where the
    // whole race is won.
    //
    // So aid tops the streak up to a ceiling instead of adding to it without
    // limit. AID_CEILING is set at the streak whose target pace is the record
    // pace itself, which makes the rule exactly:
    //
    //   aid can put a broken run back on record pace. It can never buy the
    //   top gear. That still has to be earned with an unbroken line.
    //
    // A player already above the ceiling gets nothing at all from a bottle,
    // so aid is worthless to a perfect run and a lifeline to a broken one --
    // which is the entire point of putting it in the game.
    AID_WATER: 10,
    AID_BANANA: 22,
    AID_CEILING: Math.ceil(
      -20 * Math.log((7170 / (42.195 / 1.609344) - 260) / (330 - 260))
    ),

    // Hazard kinds
    CLEAR: 0,
    JUMP: 1,                        // low block -- clear it by jumping
    DUCK: 2,                        // overhead bar -- clear it by ducking
    BLOCK: 3,                       // impassable -- must not be in this lane
  };
})();
