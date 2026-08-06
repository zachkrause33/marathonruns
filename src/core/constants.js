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

  // Pace ramp. See the STREAK_FAST / STREAK_SLOW block below for the
  // derivation; these live out here because AID_CEILING has to solve against
  // the same curve and must not be able to drift from it.
  const FLOOR_PACE = 254;                 // 4:14 /mi
  const START = 330;
  const FAST_SHARE = 0.685;
  const K_FAST = 10, K_SLOW = 100;

  function targetPaceAt(streak) {
    const gap = START - FLOOR_PACE;
    return FLOOR_PACE
      + gap * FAST_SHARE * Math.exp(-streak / K_FAST)
      + gap * (1 - FAST_SHARE) * Math.exp(-streak / K_SLOW);
  }

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
    FLOOR_PACE,                     // 4:14 /mi -- the ceiling on a perfect line

    // THE RAMP HAS TWO TIME CONSTANTS, AND THAT IS THE WHOLE POINT.
    //
    // It used to be a single exponential with K=20 against a course of 189
    // gates, and that made the race a sprint with a three-minute tail. The
    // numbers, measured on this model:
    //
    //   one mistake at  5% of the race cost  69s
    //                  15%                  105s   <- peak
    //                  50%                   54s
    //                  97%                   10s
    //
    // An eleven-fold swing. The exponential was 90% spent by streak 46, so by
    // mile 13 -- two minutes in -- the next clean gate bought 0.06 s/mi and
    // the last hundred gates bought essentially nothing. The second half of a
    // good run had no reward left and a shrinking penalty: nothing to win and
    // progressively less to lose.
    //
    // Simply slowing the ramp does not fix it. Total time is an integral, so a
    // curve that keeps you slower for longer costs finish time, and holding
    // FLOOR_PACE at 4:20 made the record unbeatable above K=25. Slowing it also
    // makes things WORSE for a weak player: at K=45 a streak-20 runner is
    // slower than they are today, and a 90%-accuracy player already never sees
    // the speed system work at all.
    //
    // Two terms solve both at once. The fast term pays out early, so a player
    // who is not near-perfect still feels the engine -- a streak-20 runner is
    // now 4.4 s/mi faster than under the old curve. The slow term is a tail
    // that is still unwinding at the finish, so the last gates keep buying
    // real time and a late mistake still costs something.
    //
    //   target(s) = FLOOR + A*exp(-s/10) + B*exp(-s/100)
    //
    // Paid for with six seconds a mile of top gear: 4:20 -> 4:14. That is the
    // whole cost. The flawless finish is unchanged at 1:58:03, the record still
    // survives exactly one mistake, and the swing drops from 10.9x to 5.0x.
    STREAK_FAST: 10,
    STREAK_SLOW: 100,
    // Share of the 5:30 -> 4:14 gap carried by the fast term.
    STREAK_FAST_SHARE: FAST_SHARE,

    // Penalties. A hit keeps this much of the streak and costs race seconds.
    //
    // 0.40, not the old 0.25. This is the one dial that changes the modal
    // player's experience without touching a flawless run at all: a perfect
    // line never calls onHit, so the finish is bit-identical at every value --
    // 1:57:50 at 0.25, 0.40 and 0.45 alike. What it moves is everyone else.
    // At 0.90 accuracy the average pace goes 5:06 -> 5:00/mi and the best
    // streak 11 -> 14; at 0.95, 4:51 -> 4:45 and 25 -> 31. That matters
    // because speed is the entire sensory pleasure of a runner game, and a
    // normal player was spending four minutes at roughly starting pace,
    // holding a goal but never getting the feeling.
    //
    // 0.45 was measured and rejected. It is better still for a weak player,
    // but it lets the record survive TWO mistakes with no aid, and the start
    // panel's wager -- "survives one mistake in 196" -- is the tension the
    // whole design is sold on. 0.40 keeps that contract exactly.
    HIT_STREAK_KEEP: 0.40,
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
    // LANE_X IS DESCENDING. Differencing it gives a NEGATIVE number, and that
    // has already cost this project one expensive bug: world.js derived its
    // hazard scale as `LANE_X[1] - LANE_X[0]`, got -1.70, and built every
    // hazard with a negative width -- which mirrors the geometry and reverses
    // the winding of every triangle, so each hazard's ink shell swallowed its
    // own fill and rendered as a black slab. It also silently culled the lane
    // telegraph mats, the single most important readability device in the
    // game, for the entire race.
    //
    // Use LANE_W for any width or spacing. Never difference LANE_X.
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
    // Airborne long enough to be humanly timeable, but still shorter than
    // Course.ACTION_WINDOW, so a jump can never still be in the air at a gate
    // demanding a slide.
    //
    // That comparison has to be made at the FASTEST the runner ever moves, not
    // at record pace. This comment used to read "0.70s * 26.3 u/s = 18.4
    // units" -- 26.3 is record pace, and the runner spends most of a good race
    // faster than that. At the pace floor it is 28.35 u/s and the span is
    // 19.84 units. course.js now derives ACTION_WINDOW from this number rather
    // than restating a stale product of it.
    JUMP_TIME: 0.70,
    DUCK_TIME: 0.78,
    INPUT_BUFFER: 0.20,             // late/early press forgiveness

    // How fast the slide commits and releases. The ramp-in rate is the number
    // that mattered: at 16 the slide did not reach DUCK_CLEAR until 0.138s
    // after the swipe, so the first seventh of a second of every slide was
    // dead time in which the player was already committed and still counted
    // as standing.
    DUCK_IN_RATE: 34,
    DUCK_OUT_RATE: 9,

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
    // Solved against the real curve rather than restated as a formula. The old
    // line hard-coded 20, 260, 330 and 7170 -- four duplicates of constants
    // defined a few lines above it -- so retuning the ramp would have left the
    // ceiling silently describing a curve that no longer existed.
    //
    // It also aimed at exactly record pace, which measured badly in play: it
    // put the ceiling at streak 33, and on a three-mistake run the streak was
    // already 40, 40 and 59 at the moments aid was collected. The intended
    // road back was inert at every one of them -- the mechanic documented as
    // "a lifeline to a broken run" did nothing for most of the race.
    //
    // Now it aims halfway between record pace and the floor. Aid can carry a
    // broken run back through half of what remains; the other half is still
    // only buyable with an unbroken line, so the top gear is still earned.
    AID_CEILING: (function () {
      const aim = (RECORD_PACE + FLOOR_PACE) / 2;
      for (let s = 0; s <= 400; s++) if (targetPaceAt(s) <= aim) return s;
      return 400;
    })(),

    // Hazard kinds
    CLEAR: 0,
    JUMP: 1,                        // low block -- clear it by jumping
    DUCK: 2,                        // overhead bar -- clear it by ducking
    BLOCK: 3,                       // impassable -- must not be in this lane
  };
})();
