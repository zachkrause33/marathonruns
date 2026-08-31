/**
 * The daily loop's memory.
 *
 * The expensive precondition for a daily game -- a globally identical,
 * deterministic, date-seeded course -- was already solved. Nothing remembered
 * it. A player who ran a 2:01 yesterday arrived today with no evidence that
 * yesterday happened, so there was no reason for today to be a different
 * occasion from any other four minutes.
 *
 * Four facts are worth keeping, and only four:
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
 *   hist   one row per finished date: the city, the day's best time, and
 *          whether 1:59:30 fell there. This is the calendar the history tab
 *          reads, the source of the record streak, and the fact the daily
 *          lockout keys off -- a day whose row says rec is a day that is over.
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

  // The fallback is not a stub that throws everything away. Within one page it
  // behaves exactly like the real thing, so a player in private mode still
  // gets "your best today" and "you beat it by 3:16" across their second and
  // third runs -- RUN IT AGAIN never leaves the document. It is lost on
  // reload, which is the most that can honestly be promised there, and it is
  // strictly more than the nothing the alternative offers.
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
      hist: [],     // [{ date, city, time, rec, runs }]   one row per finished date
    };
  }

  // The run history is bounded, because localStorage is not. At one row a day
  // this is over a year of play; the oldest rows fall off first, which is the
  // only honest order for a list whose job is "what have I done lately".
  const HIST_MAX = 400;

  /**
   * The history, sanitised: one row per date, sorted ascending, every field
   * type-guarded so a hand-edited blob yields fewer rows rather than a throw.
   */
  function cleanHist(a) {
    if (!Array.isArray(a)) return [];
    const rows = [];
    for (const e of a) {
      if (!e || isNaN(parseKey(e.date)) || !pos(e.time)) continue;
      rows.push({
        date: e.date,
        city: str(e.city),
        time: pos(e.time),
        rec: e.rec === true,
        runs: Math.max(1, Math.round(num(e.runs, 1))),
      });
    }
    rows.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
    const out = [];
    for (const e of rows) {
      if (out.length && out[out.length - 1].date === e.date) out[out.length - 1] = e;
      else out.push(e);
    }
    return out.slice(-HIST_MAX);
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
    s.hist = cleanHist(o.hist);
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

    // The RECORD streak: consecutive dates on which 1:59:30 fell, counted off
    // the history itself rather than off a second counter that could desync
    // from it. Walked back from today if today already broke it, otherwise
    // from yesterday -- a chain whose last link is two days old is not a
    // streak, it is a streak that used to be one, and a missed day breaks it
    // by construction because a missed day has no row.
    const byDate = {};
    for (const e of s.hist) byDate[e.date] = e;
    const todayRow = byDate[dateKey] || null;
    const doneToday = !!(todayRow && todayRow.rec);
    let recStreak = 0;
    let rk = doneToday ? dateKey : shift(dateKey, -1);
    while (rk && byDate[rk] && byDate[rk].rec) { recStreak++; rk = shift(rk, -1); }

    // THE SET, ALONGSIDE THE LOG.
    //
    // `hist` answers "what have I done lately" and the history tab reads it in
    // date order. The city checklist asks a different question -- "where has
    // the record fallen" -- which is a fact about a PLACE and not about a day,
    // and reconstructing it from the log in the HUD would put a second walk of
    // the same array in a file that should not own the arithmetic.
    //
    // Keyed by the city NAME the run was saved under, because that is the only
    // field of a history row that names a place. Rows with no city (an old save
    // from before the field existed, or a hand-edited blob) are skipped rather
    // than bucketed under the empty string. Derived on every read rather than
    // stored: a stored copy is a second source of truth that can disagree with
    // the history, which is exactly the defect the record streak was rewritten
    // to avoid.
    const cities = {};
    for (const e of s.hist) {
      if (!e.city) continue;
      const c = cities[e.city] || (cities[e.city] = { days: 0, rec: false, best: 0, last: null });
      c.days++;
      if (e.rec) c.rec = true;
      if (!c.best || e.time < c.best) c.best = e.time;
      if (!c.last || e.date > c.last) c.last = e.date;
    }

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
      // Newest first, because every reader of this list is a panel that leads
      // with the most recent day.
      history: s.hist.slice().reverse(),
      // { CITY: { days, rec, best, last } } for every city with a finished
      // day in the save. The checklist panel intersects this with the pool.
      cities: cities,
      done: doneToday,                    // the record fell today: today is over
      doneTime: doneToday ? todayRow.time : 0,
      recordStreak: recStreak,
      recordStreakCounted: doneToday,     // today already counts toward it
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
      // A first-ever run sets every all-time mark by definition, which is not
      // an achievement and must not be announced as one -- a 2:08 disaster
      // wearing an ALL-TIME BEST badge is the screen lying to a beginner.
      firstEver: !before.best,
      allTimeBest: false,
      allTimeStreak: false,
      dayStreak: before.dayStreak,
      dayStreakGained: false,
      recordBroken: false,
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

      // The history row for this date. One per date, best time kept, and
      // `rec` is a latch: a day on which the record fell stays a record day
      // however many slower runs follow -- which is also what locks the day.
      // Whether THIS run broke it is the caller's fact (it owns
      // RECORD_SECONDS); this file only remembers it.
      const rec = !!(run && run.record === true);
      const city = str(run && run.city);
      let h = null;
      for (const e of s.hist) if (e.date === dateKey) { h = e; break; }
      if (!h) {
        h = { date: dateKey, city: city, time: r.time, rec: rec, runs: 1 };
        s.hist.push(h);
        s.hist.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
        if (s.hist.length > HIST_MAX) s.hist = s.hist.slice(-HIST_MAX);
      } else {
        h.runs++;
        if (r.time < h.time) h.time = r.time;
        if (rec) h.rec = true;
        if (city && !h.city) h.city = city;
      }
      out.recordBroken = rec;
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
