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

  /** 'YYYY-MM-DD' for a Date, in UTC. */
  function dateKey(d) {
    d = d || new Date();
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

  return { hashString, mulberry32, dateKey, stream };
})();
