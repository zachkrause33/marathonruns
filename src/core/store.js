/**
 * The daily loop's memory.
 *
 * The expensive precondition for a daily game -- a globally identical,
 * deterministic, date-seeded course -- was already solved. Nothing remembered
 * it. A player who ran a 2:01 yesterday arrived today with no evidence that
 * yesterday happened, so there was no reason for today to be a different
 * occasion from any other four minutes.
 *
 * Three facts are worth keeping, and only three:
 *
 *   day    the best finish and the best clean streak for ONE date. Keyed by
 *          the date, so it expires by itself: tomorrow's first load simply
 *          finds a date that is not today's and rotates it into `prev`.
 *   days   consecutive dates played. This needs the DATE of the last play,
 *          not a count alone -- a counter with no date cannot tell a second
 *          run today from the first run tomorrow, and cannot break correctly.
 *   best   the all-time marks. Finish and streak are tracked separately
 *          because they are different achievements: a player's fastest race
 *          is very often not the race with their longest clean line.
 *
 * ---- why this cannot break the game ----
 *
 * localStorage throws on access in Safari private browsing, is absent in some
 * embeddings, and can throw QuotaExceededError on write at any time. Every
 * entry point here is wrapped, and a failure degrades to an in-memory store
 * that keeps the numbers alive for the length of the tab and forgets them
 * afterwards. The game never sees an exception and never sees a missing API;
 * it sees a summary object with zeroes in it.
 *
 * ---- why a schema change cannot corrupt a save ----
 *
 * The version is in the KEY as well as in the payload. A future v2 build
 * writes to a different key entirely, so it can neither read nor overwrite a
 * v1 blob; and this build re-checks `v` on the way in and discards anything
 * that does not match rather than trusting field names to have kept their
 * meaning. Every value is coerced through a type guard on load, so a
 * hand-edited or half-written blob yields a blank save, never a NaN that
 * propagates into the readout.
 */
MR.Store = (function () {

  const KEY = 'marathonruns/save/v1';
  const V = 1;

  // ---- backing store ----------------------------------------------------

  /**
   * A localStorage that is known to work, or null. Probed with a real
   * write/remove rather than a feature test: Safari's private mode HAS the
   * object and throws only when you use it, so `'localStorage' in window` is
   * not an answer to the question being asked.
   */
  function probe() {
    try {
      const ls = window.localStorage;
      if (!ls) return null;
      const t = '__mr__' + Math.random();
      ls.setItem(t, '1');
      ls.removeItem(t);
      return ls;
    } catch (e) {
      return null;
    }
  }

  const ls = probe();

  // The fallback is not a stub that throws everything away. Within one tab it
  // behaves exactly like the real thing, so a player in private mode still
  // gets "your best today" across their second and third runs -- they only
  // lose it when they close the tab, which is the most that can honestly be
  // promised there.
  let memBlob = null;
  const persistent = !!ls;

  function readRaw() {
    if (!ls) return memBlob;
    try { return ls.getItem(KEY); } catch (e) { return null; }
  }

  function writeRaw(str) {
    memBlob = str;
    if (!ls) return false;
    try { ls.setItem(KEY, str); return true; } catch (e) { return false; }
  }

  // ---- dates ------------------------------------------------------------
  // Course keys are UTC 'YYYY-MM-DD' (see rng.dateKey). They are compared as
  // strings where only ordering matters -- ISO dates sort correctly as text --
  // and parsed to UTC midnight only where a real difference in days is needed.

  function parseKey(k) {
    if (typeof k !== 'string') return NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  /** Whole days from key `a` to key `b`; NaN if either is not a date key. */
  function dayDiff(a, b) {
    const ta = parseKey(a), tb = parseKey(b);
    if (isNaN(ta) || isNaN(tb)) return NaN;
    return Math.round((tb - ta) / 86400000);
  }

  /** The date key `n` days after `k`. */
  function shift(k, n) {
    const t = parseKey(k);
    if (isNaN(t)) return null;
    const d = new Date(t + n * 86400000);
    return d.getUTCFullYear() + '-'
      + String(d.getUTCMonth() + 1).padStart(2, '0') + '-'
      + String(d.getUTCDate()).padStart(2, '0');
  }

  // ---- type guards ------------------------------------------------------

  function num(v, fallback) {
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  }
  function pos(v) {
    const n = num(v, 0);
    return n > 0 ? n : 0;
  }
  function key(v) {
    return isNaN(parseKey(v)) ? null : v;
  }
  function str(v) {
    return typeof v === 'string' && v.length && v.length < 40 ? v : '';
  }

  function blank() {
    return {
      v: V,
      day: null,    // { date, time, streak, tier, runs }  best for that date
      prev: null,   // { date, time, streak, tier }        the previous date played
      days: { count: 0, last: null },
      best: null,   // { time, tier, date, streak, streakDate }
    };
  }

  /** A run record, sanitised. Returns null if it is not a usable result. */
  function cleanRun(r) {
    if (!r) return null;
    const time = pos(r.time);
    if (!time) return null;
    return {
      date: key(r.date),
      time: time,
      streak: Math.max(0, Math.round(num(r.streak, 0))),
      tier: str(r.tier),
    };
  }

  function load() {
    const raw = readRaw();
    if (!raw) return blank();
    let o;
    try { o = JSON.parse(raw); } catch (e) { return blank(); }
    if (!o || typeof o !== 'object' || o.v !== V) return blank();

    const s = blank();

    if (o.day && key(o.day.date) && pos(o.day.time)) {
      s.day = {
        date: o.day.date,
        time: pos(o.day.time),
        streak: Math.max(0, Math.round(num(o.day.streak, 0))),
        tier: str(o.day.tier),
        runs: Math.max(1, Math.round(num(o.day.runs, 1))),
      };
    }
    if (o.prev && key(o.prev.date) && pos(o.prev.time)) {
      s.prev = cleanRun(o.prev);
    }
    if (o.days) {
      s.days.last = key(o.days.last);
      s.days.count = s.days.last ? Math.max(0, Math.round(num(o.days.count, 0))) : 0;
    }
    if (o.best && pos(o.best.time)) {
      s.best = {
        time: pos(o.best.time),
        tier: str(o.best.tier),
        date: key(o.best.date),
        streak: Math.max(0, Math.round(num(o.best.streak, 0))),
        streakDate: key(o.best.streakDate),
      };
    }
    return s;
  }

  function save(s) {
    try { return writeRaw(JSON.stringify(s)); } catch (e) { return false; }
  }

  // ---- reading ----------------------------------------------------------

  /**
   * Everything the panels need for one date, in one object, with every field
   * always present. The caller never has to null-check its way through a
   * chain, which is what keeps a missing save from becoming a missing screen.
   *
   * `dayStreak` is answered AS OF the given date rather than read off the
   * stored counter, because those are different questions. A stored count of
   * 5 whose last play was three days ago is not a streak of 5, it is a streak
   * of 0 that used to be 5 -- and the start panel has to say so before the
   * player presses the button, not after.
   */
  function summary(dateKey) {
    let s;
    try { s = load(); } catch (e) { s = blank(); }

    const today = (s.day && s.day.date === dateKey) ? s.day : null;

    // "Last night's result": the most recent day that is not the one being
    // played. When the stored day IS today, that is `prev`; when the player
    // has not run today yet, the stored day itself is the last result.
    let last = null;
    if (s.day && s.day.date !== dateKey) last = s.day;
    else if (s.prev) last = s.prev;
    if (last && dayDiff(last.date, dateKey) <= 0) last = null;  // never "last" from the future

    const d = s.days.last ? dayDiff(s.days.last, dateKey) : NaN;
    // Alive if the last play was today (already counted) or yesterday (today
    // will extend it). Anything else is a broken chain.
    const alive = d === 0 || d === 1;

    return {
      persistent: persistent,
      dateKey: dateKey,
      today: today,                       // { time, streak, tier, runs } or null
      last: last,                         // { date, time, streak, tier } or null
      dayStreak: alive ? s.days.count : 0,
      dayStreakCounted: d === 0,          // today already counts toward it
      best: s.best,                       // all-time, or null
      pbStreak: Math.max(
        s.best ? s.best.streak : 0,
        today ? today.streak : 0
      ),
    };
  }

  // ---- writing ----------------------------------------------------------

  /**
   * Fold one finished run into the save, and report what it changed.
   *
   * The report is the point. "Did this beat your best today" is a question
   * only the store can answer and only at this instant -- one line later the
   * best IS this run and the comparison is gone -- so it is captured before
   * the mutation and handed back rather than left for the caller to
   * reconstruct.
   *
   * Never throws. A store that cannot write still returns an honest report of
   * what the run was worth, so the finish screen reads correctly even when
   * nothing about it will survive the tab.
   */
  function record(dateKey, run) {
    const r = cleanRun({ date: dateKey, time: run && run.time, streak: run && run.streak, tier: run && run.tier });
    const before = summary(dateKey);
    const out = {
      persistent: persistent,
      saved: false,
      dateKey: dateKey,
      prevToday: before.today,          // what "best today" was BEFORE this run
      beatToday: false,
      beatTodayStreak: false,
      firstToday: !before.today,
      allTimeBest: false,
      allTimeStreak: false,
      dayStreak: before.dayStreak,
      dayStreakGained: false,
      today: before.today,
      best: before.best,
      pbStreak: before.pbStreak,
    };
    if (!r) return out;

    let s;
    try { s = load(); } catch (e) { s = blank(); }

    // Guard the debug path: `?date=` can run an OLDER course than the last one
    // played. Rotating the day record on that would silently throw away the
    // real "today", and moving the streak's last-played date backwards would
    // break a live streak. Old dates may still set all-time marks -- those are
    // date-independent -- but they may not rewrite the calendar.
    const backwards = (s.day && dateKey < s.day.date)
                   || (s.days.last && dateKey < s.days.last);

    if (!backwards) {
      const newDay = !s.day || s.day.date !== dateKey;
      if (newDay) {
        if (s.day) s.prev = { date: s.day.date, time: s.day.time, streak: s.day.streak, tier: s.day.tier };
        s.day = { date: dateKey, time: r.time, streak: r.streak, tier: r.tier, runs: 1 };
        out.beatToday = true;
        out.beatTodayStreak = true;
      } else {
        s.day.runs++;
        if (r.time < s.day.time) { s.day.time = r.time; s.day.tier = r.tier; out.beatToday = true; }
        if (r.streak > s.day.streak) { s.day.streak = r.streak; out.beatTodayStreak = true; }
      }

      // The day streak advances once per DATE, never once per run.
      const d = s.days.last ? dayDiff(s.days.last, dateKey) : NaN;
      if (d !== 0) {
        s.days.count = (d === 1) ? s.days.count + 1 : 1;
        s.days.last = dateKey;
        out.dayStreakGained = true;
      }
      out.dayStreak = s.days.count;
      out.today = s.day;
    }

    if (!s.best) {
      s.best = { time: r.time, tier: r.tier, date: dateKey, streak: r.streak, streakDate: dateKey };
      out.allTimeBest = true;
      out.allTimeStreak = r.streak > 0;
    } else {
      if (r.time < s.best.time) {
        s.best.time = r.time; s.best.tier = r.tier; s.best.date = dateKey;
        out.allTimeBest = true;
      }
      if (r.streak > s.best.streak) {
        s.best.streak = r.streak; s.best.streakDate = dateKey;
        out.allTimeStreak = true;
      }
    }
    out.best = s.best;
    out.pbStreak = Math.max(s.best.streak, s.day ? s.day.streak : 0);

    out.saved = save(s);
    return out;
  }

  /** Wipe the save. Exposed for testing the first-visit path by hand. */
  function clear() {
    memBlob = null;
    if (!ls) return;
    try { ls.removeItem(KEY); } catch (e) { /* nothing to do and nothing to say */ }
  }

  return {
    KEY, VERSION: V, persistent,
    summary, record, clear,
    load, save, blank,
    dayDiff, shift, parseKey,
  };
})();
