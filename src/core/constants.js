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

    // Track geometry
    LANE_X: [-2.35, 0, 2.35],
    LANE_COUNT: 3,
    TRACK_HALF_WIDTH: 4.4,

    // Player motion
    LANE_CHANGE_TIME: 0.16,         // real seconds, snappy on purpose
    JUMP_HEIGHT: 2.05,
    JUMP_TIME: 0.62,
    DUCK_TIME: 0.55,
    INPUT_BUFFER: 0.14,             // late/early press forgiveness

    // Hazard kinds
    CLEAR: 0,
    JUMP: 1,                        // low block -- clear it by jumping
    DUCK: 2,                        // overhead bar -- clear it by ducking
    BLOCK: 3,                       // impassable -- must not be in this lane
  };
})();
