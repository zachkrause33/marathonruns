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
  const BOX = {
    [K.JUMP]: { yMin: 0.00, yMax: 0.80, halfZ: 0.52 },
    [K.DUCK]: { yMin: 1.41, yMax: 1.83, halfZ: 0.30 },
    [K.BLOCK]: { yMin: 0.00, yMax: 2.80, halfZ: 0.65 },
  };

  // State thresholds.
  const JUMP_CLEAR_Y = 0.62;   // feet must be this high at the gate line
  const DUCK_CLEAR = 0.50;     // duck must be at least half committed

  const PLAYER_STAND_TOP = MR.Runner.HEIGHT;   // 1.78
  const PLAYER_DUCK_DROP = 0.42;

  /**
   * Can the player pass `kind` in their current state?
   * @param st { y, duck01 }
   */
  function clears(kind, st) {
    if (kind === K.CLEAR) return true;
    if (kind === K.BLOCK) return false;
    if (kind === K.JUMP) return (st.y || 0) >= JUMP_CLEAR_Y;
    if (kind === K.DUCK) return (st.duck01 || 0) >= DUCK_CLEAR;
    return true;
  }

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
    BOX, clears, audit,
    JUMP_CLEAR_Y, DUCK_CLEAR,
    PLAYER_STAND_TOP, PLAYER_DUCK_DROP,
  };
})();
