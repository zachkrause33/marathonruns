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
 *
 * Pause is the one input here that is not one of those four, and it is
 * deliberately built out of none of this machinery -- not buffered, not
 * gateable, not a swipe. See PAUSE_KEYS. The touch half of it is a DOM button
 * in the HUD rather than a gesture, for a reason that belongs in this file: the
 * pointer listeners below are on the CANVAS, so a tap that lands on a button in
 * #ui never reaches them and can never be read as the start of a lane change.
 * A pause gesture would have had to share the screen with the swipe that ends a
 * record attempt.
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
      // Gates the four buffered VERBS only, never the pause key below. Set
      // false while the game is paused and for the whole of the resume
      // countdown, which is what stops a player queueing the answer to a gate
      // they studied on a frozen frame -- see main.js. Nothing is buffered
      // while it is false, so there is nothing to serve when it comes back.
      enabled: true,
      onAny: null,          // called for the first input of a session
      onPause: null,        // Escape / P, and it fires whatever `enabled` says
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

    // Pause is a change of MODE, not one of the game's four verbs, and it is
    // kept out of KEYS for three separate reasons rather than one: a key in
    // that table becomes a lane change; anything routed through push() is
    // BUFFERED, and a pause that fires up to INPUT_BUFFER seconds after it was
    // pressed is a pause that lands in the wrong place; and push() drops
    // everything while `enabled` is false, which is exactly the state the game
    // is in while it is paused -- so pause would have been the one control that
    // could not un-press itself.
    const PAUSE_KEYS = { Escape: 1, KeyP: 1 };

    function onKey(e) {
      if (PAUSE_KEYS[e.code]) {
        // A narrower focus guard than the one below. That guard exists so Space
        // can activate a focused BUTTON; neither Escape nor P activates
        // anything, and swallowing them near a button would mean that clicking
        // PAUSE with a mouse -- which leaves the pause button focused -- made
        // the key that opened the panel unable to close it.
        const f = e.target;
        if (f && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA' || f.isContentEditable)) return;
        e.preventDefault();
        if (!e.repeat && s.onPause) s.onPause();
        return;
      }
      const a = KEYS[e.code];
      if (!a) return;
      // Leave the focused control alone. This listener is on `window` and used
      // to preventDefault unconditionally, which meant Space -- the canonical
      // key for activating a focused button -- was swallowed before the CTA
      // ever saw it: you could Tab to TOE THE LINE, press Space, and nothing
      // happened. Enter worked, so it looked like a dead key rather than a
      // trapped one. During a run nothing is focused and this never fires.
      const t = e.target;
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'INPUT' ||
                t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
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
