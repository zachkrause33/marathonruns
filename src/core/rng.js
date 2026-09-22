/**
 * Deterministic PRNG + date seeding.
 *
 * Every player on a given UTC date must get a byte-identical course, so the
 * seed comes from the UTC calendar date only -- never from local time, never
 * from Date.now(). mulberry32 is used because it is tiny, has a full 2^32
 * period, and passes well enough for level layout.
 */
MR.rng = (function () {

  /** FNV-1a over a string -> uint32. Stable across engines. */
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** mulberry32: seed uint32 -> function returning [0,1). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 'YYYY-MM-DD' for a Date -- the GAME DAY, which rolls at midnight
   * PACIFIC TIME (owner, 2026-09-22: "needs to reset at midnight PT").
   * One authority: every consumer of "today" -- the course seed, the
   * save's rows, the one-a-day door, the tries cap -- reads this label,
   * so the reset moves everywhere by moving here.
   *
   * Intl carries the DST boundary (PST/PDT), so the roll is honest at
   * 00:00 Pacific all year. The fallback, for a browser with no zoned
   * Intl, is fixed UTC-8 -- an hour late in summer on museum browsers,
   * and consistently so, which beats throwing on boot.
   *
   * DIFFERENCES between keys (streaks, shift) are pure label arithmetic
   * in store.js, untouched by which wall clock mints the labels.
   */
  const DAY_TZ = 'America/Los_Angeles';
  let dayFmt = null;
  try {
    // en-CA formats as YYYY-MM-DD, exactly the key shape.
    dayFmt = new Intl.DateTimeFormat('en-CA',
      { timeZone: DAY_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFmt.format(new Date());   // throw NOW if the zone is unknown
  } catch (e) { dayFmt = null; }
  function dateKey(d) {
    d = d || new Date();
    if (dayFmt) return dayFmt.format(d);
    const t = new Date(d.getTime() - 8 * 3600000);
    const y = t.getUTCFullYear();
    const m = String(t.getUTCMonth() + 1).padStart(2, '0');
    const day = String(t.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Milliseconds until the game day rolls (the next midnight Pacific).
   * Derived from the PT wall clock rather than key arithmetic, so the
   * DST-length days (23h and 25h) count down honestly; the lockout
   * panel re-derives every 30s and self-corrects across the jump.
   */
  function nextResetMs(now) {
    const at = now === undefined ? Date.now() : now;
    try {
      const f = new Intl.DateTimeFormat('en-GB',
        { timeZone: DAY_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      const p = f.format(new Date(at)).split(':').map(Number);
      return ((24 - p[0]) * 3600 - p[1] * 60 - p[2]) * 1000;
    } catch (e) {
      const el = ((at - 8 * 3600000) % 86400000 + 86400000) % 86400000;
      return 86400000 - el;
    }
  }

  /**
   * A seeded stream with the helpers the course generator needs.
   * Namespacing the salt lets independent systems draw from the same date
   * without correlating (course vs. scenery vs. crowd placement).
   */
  function stream(key, salt) {
    const next = mulberry32(hashString(key + '|' + (salt || '')));
    return {
      next,
      /** float in [lo,hi) */
      range: (lo, hi) => lo + next() * (hi - lo),
      /** integer in [lo,hi] inclusive */
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      /** true with probability p */
      chance: (p) => next() < p,
      /** uniform element */
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      /**
       * Weighted pick. `weights` parallel to `arr`; weights need not sum to 1.
       */
      weighted: (arr, weights) => {
        let total = 0;
        for (let i = 0; i < weights.length; i++) total += weights[i];
        let r = next() * total;
        for (let i = 0; i < arr.length; i++) {
          r -= weights[i];
          if (r <= 0) return arr[i];
        }
        return arr[arr.length - 1];
      },
    };
  }

  return { hashString, mulberry32, dateKey, nextResetMs, stream };
})();
