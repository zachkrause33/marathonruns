/**
 * Input: swipe, keyboard, and mouse drag, normalised into four buffered
 * actions.
 *
 * Two forgiveness rules do most of the work of making this feel fair:
 *
 *  - Buffering. An action pressed up to INPUT_BUFFER seconds before it can be
 *    served is remembered rather than dropped, so a lane change queued during
 *    another lane change still fires. Without this, fast inputs silently
 *    vanish and the game feels like it is ignoring you.
 *
 *  - Swipe commitment. A touch resolves to a direction as soon as it passes
 *    the threshold, not on release, so a flick registers at the moment the
 *    player's thumb says it should.
 */
MR.Controls = (function () {
  const K = MR.K;

  const LEFT = 'left', RIGHT = 'right', JUMP = 'jump', DUCK = 'duck';

  const SWIPE_MIN = 26;      // px before a drag becomes a swipe
  const SWIPE_MAX_TIME = 0.6;

  function create(target) {
    const el = target || window;

    const s = {
      LEFT, RIGHT, JUMP, DUCK,
      buffer: [],           // { action, t }
      time: 0,
      lastAction: null,
      enabled: true,
      onAny: null,          // called for the first input of a session
    };

    function push(action) {
      if (!s.enabled) return;
      s.buffer.push({ action, t: s.time });
      // Never let a stale queue build up.
      if (s.buffer.length > 3) s.buffer.shift();
      s.lastAction = action;
      if (s.onAny) s.onAny(action);
    }
    s.push = push;

    // ---- keyboard -------------------------------------------------------
    const KEYS = {
      ArrowLeft: LEFT, KeyA: LEFT,
      ArrowRight: RIGHT, KeyD: RIGHT,
      ArrowUp: JUMP, KeyW: JUMP, Space: JUMP,
      ArrowDown: DUCK, KeyS: DUCK,
    };

    function onKey(e) {
      const a = KEYS[e.code];
      if (!a) return;
      e.preventDefault();
      if (e.repeat) return;
      push(a);
    }
    window.addEventListener('keydown', onKey, { passive: false });

    // ---- pointer / touch ------------------------------------------------
    let sx = 0, sy = 0, st = 0, tracking = false, resolved = false;

    function down(x, y) { sx = x; sy = y; st = s.time; tracking = true; resolved = false; }

    function move(x, y) {
      if (!tracking || resolved) return;
      const dx = x - sx, dy = y - sy;
      if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
      if (s.time - st > SWIPE_MAX_TIME) { tracking = false; return; }
      resolved = true;
      if (Math.abs(dx) > Math.abs(dy)) push(dx > 0 ? RIGHT : LEFT);
      else push(dy > 0 ? DUCK : JUMP);
    }

    function up() { tracking = false; }

    const opts = { passive: false };
    el.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      down(t.clientX, t.clientY);
      e.preventDefault();
    }, opts);
    el.addEventListener('touchmove', (e) => {
      const t = e.changedTouches[0];
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, opts);
    el.addEventListener('touchend', (e) => { up(); e.preventDefault(); }, opts);

    el.addEventListener('mousedown', (e) => down(e.clientX, e.clientY));
    el.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    el.addEventListener('mouseup', up);

    // ---- consumption ----------------------------------------------------
    s.tick = function (dt) {
      s.time += dt;
      // Drop anything that aged out of the buffer window.
      while (s.buffer.length && s.time - s.buffer[0].t > K.INPUT_BUFFER) s.buffer.shift();
    };

    /** Take the oldest matching action, or null. */
    s.take = function (match) {
      for (let i = 0; i < s.buffer.length; i++) {
        const b = s.buffer[i];
        if (!match || match(b.action)) {
          s.buffer.splice(i, 1);
          return b.action;
        }
      }
      return null;
    };

    s.clear = function () { s.buffer.length = 0; };

    return s;
  }

  return { create, LEFT, RIGHT, JUMP, DUCK };
})();
