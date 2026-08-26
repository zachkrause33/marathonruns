# One city a day — recommendation

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Nothing in this memo
licenses a half-built anything; any content top-up it proposes is fully-built
objects on all sides, per the standing rule.

**Diagnosis only. No file under `src/` was edited to produce any number here.
Nothing ships from this pass.**

The owner's question, verbatim:

> *"Consult with agents and determine if it makes sense to only run one
> location a day. It doesn't make sense to me that we go to 3-4 locations. I
> think this would help with the daily game occurrence."*

## 0. The answer in six lines

1. **Recommended: one city per day, dealt from a shuffled bag of the twelve.**
   The owner's instinct survives measurement. The costs are real but smaller
   than they look, and the one thing the criterion names — the daily ritual —
   is the thing the current draw is measurably weakest at.
2. **Today's routes blur into each other.** 73.6% of consecutive days share at
   least one city, a given city returns after a median of **2–3 days**, and a
   player has seen all twelve inside a median of **10 days**. "Today is the
   Rome course" is currently never true and never said.
3. **The seams are not carrying what they were assumed to carry.** A seam moves
   the palette by a mean ΔE of **9.7**; THE WALL's biome pull moves it **17.7**
   and THE BRIDGE **13.7**, in every run, in any city. The two biggest visual
   beats of a run belong to the biome arc, which one-city keeps in full.
4. **The first seam lands too late to fix the known trough anyway.** The
   staleness work put the boredom trough at miles 3–7 (~27–63 s); the first
   seam arrives at a mean of **69 s**.
5. **The real cost is content variety, measured:** distinct landmark kinds per
   course drop from ~14 to ~8, city-unique kinds from ~5.8 to ~2.2, and one
   terrace/tree/street vocabulary holds the frame for four minutes. In
   exchange each appearance of a city shows **100% of its landmark beats
   instead of 40%**.
6. **The core change is nearly free and provably identity-safe.** The settings
   draw is its own RNG stream (`settings/v1`), taken *after* the gates exist;
   `mechanics.js --identity` hashes gates and aid only. Gate and aid hashes
   cannot move. The work is in world.js dormant paths, the start panel, one
   end-card feature, and tooling assumptions.

---

## 1. What exists today, verified against source

- `src/core/course.js` `pickSettings` draws **3 or 4 of twelve** settings
  (`rnd.chance(0.5)`), without replacement, on stream `'settings/v1'`, and
  splits the course evenly with ±35% jitter, floored at 60% of an even share.
  Assigned at `course.settings = pickSettings(key)` **after** generation; no
  gate, aid, tempo or elevation code reads it.
- `src/render/world.js` `SETTING_LOOK` holds the twelve palettes, terraces,
  trees, per-biome landmark lists and per-city bridges. Seams cross-fade over
  `SET_FADE = 190` units (~7 s), content dithered across the band
  (`settingIndexAt`). Landmark pools are built lazily per (setting, kind).
- Six biome legs at fixed fractions are orthogonal to settings; `BIOME_MOD`
  pulls whatever palette the setting supplied (THE WALL's pull is "the
  strongest in the table by a distance" — confirmed by measurement below).
- `src/ui/hud.js` shows "VALENCIA → ROME → CHICAGO" on the start panel, draws
  seams and names on the rail, and computes the end-card "city that carried
  the run" (`chapterCosts` / `decisiveChapter` — guarded to require ≥2
  settings).
- The game's identity is one shared date-seeded course per day; hud.js's own
  comment: *"The route is the only thing on this panel that is visibly
  different tomorrow… the one line that earns a daily habit."*

## 2. The instruments, and their limits this pass

The working tree currently carries another agent's in-flight world.js edit
(road debris; the data tables above are untouched by it), so the
browser-driven instruments (`staleness.js`, `calendar.js`) would have measured
a half-built page — and `staleness.js` says itself that it censuses hazards,
not scenery, and that "a conclusion about whether the WORLD gets stale cannot
be drawn from it."

Everything below was therefore measured headless against the committed core,
with the exact harness `tools/course-test.js` uses (vm over `src/core/*.js`,
calling the real `Course.pickSettings` for 365 days from 2026-01-01), and the
`SETTING_LOOK` / `BIOME_MOD` tables evaluated out of world.js source rather
than re-typed. Two self-checks passed: the measured minimum segment (35.8 s)
is exactly the generator's own floor (0.60 × ¼ × 239 s), and total city-slots
(1267) equals 365 × the measured 3.47 cities/day. Seconds use the 239 s
flawless run (`RECORD_SECONDS / TIME_SCALE`). Palette distance is CIE76 ΔE
averaged over the seven palette fields a setting owes (sky×2, fog, ground,
road, water, edge).

## 3. The numbers

**Status quo (365 days):** 193 three-city days, 172 four-city; **2.47 seams
per run**; seconds per setting mean **68.9** (p10 45.2, min 35.8, max 134.6);
first seam at mean **69 s**. A given city appears on 22–33% of days (ROME is
this year's low outlier at 79/365 — sampling variance of the seeds, the draw
is uniform and inclusive; verified in `rng.js`). Same-city gap: **median 2–3
days, p90 7, worst 24**. All twelve seen in median **10 days** (p90 16, max
24). **73.6% of consecutive days share a city** (mean 1.02 shared). Mean 8.47
(setting,biome) pairs per day; all 72 pairs covered by day 29 — agreeing with
calendar.js's documented 32-day saturation.

**One city per day, two ways of dealing it:**

| model | same-city gap median | p90 | max | all 12 seen |
|---|---|---|---|---|
| status quo (3–4/day) | 2–3 days | 7 | 24 | median 10 days |
| C1: uniform draw of 1 | 8 | 26 | **65** | median 37, p90 52 |
| C2: shuffled bag of 12 | 12 | 19 | 23 | **exactly 12 days** |
| H2: two cities/day | 4 | 13 | 35 | ~18 days |

C1 (independent uniform) is disqualified on its own numbers: 36 back-to-back
same-city days per year and a worst gap of 65 days. **The bag is the only
deal worth shipping**: every city exactly once per 12-day cycle, worst gap 23
days, and all 72 (setting,biome) pairs exercised in 12 days — which makes the
fairness calendar *cheaper* to cover, not dearer.

**Palette: what the seams actually carry.** Seam ΔE mean **9.7** (median 8.3,
p10 5.1, max 18.9). Biome pulls, averaged over the twelve settings: THE WALL
**17.7**, THE BRIDGE **13.7**, FINAL MILE **9.5**, PARKLAND 1.9, RIVERSIDE
0.3. City palettes pairwise differ by median 8.9 ΔE. So the two largest
palette events in every run are biome beats that one-city keeps unchanged; a
typical seam is a mid-sized beat, and the smallest seams (p10 = 5.1) are
barely above the parkland pull. What a seam carries that ΔE does *not*
capture is **architecture**: the terrace style, tree species, street
furniture and skyline all swap at a seam, and that swap is what one-city
gives up mid-run.

**Landmarks.** Distinct (city, landmark) kinds per course: status quo mean
**14.3** (12.3 counting an oak as an oak anywhere) against **7.8** for a
one-city course (min 6 — VALENCIA; max 9). City-unique kinds per course: 5.8
→ 2.2. The other side of the ledger: today an appearance of a city shows a
mean **40%** of its landmark beats; a one-city day shows **100%** — all of
Rome's pieces in one course instead of split across days, which is exactly
the owner's "landmark density per city could rise", confirmed.

## 4. What cannot be measured, said plainly

Ritual strength has no instrument in this repo, and this memo will not dress
taste as data. The design argument, for what it is: a marathon happens in one
city, so "today is the Rome course" is a *nameable* daily identity — one word
a player can hold, say, and compare, the way Wordle's single puzzle is. The
measured facts that make the argument credible are the blur numbers above
(73.6% day-to-day overlap; a city back every 2–3 days) — under the status quo
there is nothing scarce enough about any city for its appearance to feel like
an event. Under a 12-day bag a city day is genuinely uncommon (roughly a
30-appearance year becomes exactly 30, but spread, never doubled, never
blurred), and the start panel's one visibly-different line becomes a
headline. Against: within-run novelty measurably drops (§3), and a player who
dislikes today's city owns it for the whole day. Both sides of that are
design judgement; the recommendation weighs them under the owner's stated
criterion — the daily ritual — not under purity.

## 5. Options, ranked

**1. ONE CITY PER DAY, dealt from a shuffled bag — recommended.**
Strongest daily identity; bounded repeat cadence (worst gap 23 days, all
twelve in 12); full landmark identity per course; keeps the entire biome arc,
which measurement shows carries the run's biggest visual beats already;
identity-hash-safe; simplifies the start panel's promise. Costs: within-run
architectural variety and ~6 landmark kinds per course (§3), the end-card
"city that carried the run" line (§6), and thin cities now carry whole days
(§6, risks).

**2. TWO CITIES PER DAY (H2) — the conservative fallback.**
One seam per run (~120 s per city), same-city gap median 4 days, still a
readable "ROME → PARIS" promise, `decisiveChapter` survives. But it is half a
decision: the daily identity is still two words, the blur only halves, and
every dormant-path cost in §6 is paid anyway. Take it only if play-testing
the winner shows the four-minute single palette genuinely failing.

**3. STATUS QUO.** Keeps maximum within-run variety and costs nothing. But it
is the arrangement the owner is reacting against, and the cadence numbers
back the reaction: no city is ever scarce, so no day is ever *about*
anywhere.

**Rejected hybrids, with reasons:**
- *Headline city + subdued transit legs*: invents a thirteenth content class
  (the "transit" look) or demotes real cities to anonymous filler; all the
  cost of one-city plus new art. The biome arc already is the subdued
  structure a headline city sits on.
- *Weekdays one-city, weekends world tour*: two vocabularies for one game;
  the daily ritual is the criterion and a rule you must remember ("is it a
  tour day?") taxes exactly that. Nothing under `src/` reads a day of week
  today, and that property is worth keeping.

## 6. What implementing the winner touches

- **`src/core/course.js`** — `pickSettings` becomes a bag deal: cycle index =
  day number derived from the *passed* date key (no wall-clock read; the
  determinism rule holds), bag shuffled on a per-cycle stream, one entry,
  `from: 0, to: 1`. Retire `'settings/v1'` in favour of `'settings/v2'` —
  never reuse a stream name for a different draw. **Gate and aid identity
  hashes do not move**: settings are drawn after generation on their own
  stream, and `mechanics.js --identity` hashes `c.gates` and `c.aid` only
  (verified in source). `calendar.js`'s 72-pair proof becomes "all 72 pairs
  in any 12-day window".
- **`src/render/world.js`** — works unmodified with `SETS.length === 1`
  (`setIndexAt` returns 0, `setFadeAt` returns 1, the LEGACY path already
  proves single-setting rendering). `SET_FADE`, `settingIndexAt`'s dither and
  the seam cross-fade go dormant: **keep them, do not delete** — H2 and any
  future "world tour" special need them, and dormant-but-proven is this
  project's cheapest asset (see NARROW's history). Lazy landmark pools warm
  one city instead of 3–4: less start-up merging.
- **`src/ui/hud.js`** — `startRoute` degrades gracefully to one name but
  *should not*: the one-word identity deserves a headline treatment, not a
  one-stop route string. `drawRoute` draws no cuts (fine); the rail's city
  names row becomes one label. **`decisiveChapter` dies silently** (guarded on
  `set.length < 2`) — the end card loses "ROME carried the run". Cheap
  replacement: cut by biome leg instead of by city ("THE WALL carried the
  run"); `chapterCosts` already works off arbitrary z-cuts.
- **Tools** — `calendar.js`'s comment block and default prefix (32 days sized
  on pair saturation) should be re-measured (expected: 12); `staleness.js`'s
  legs section prints settings-per-run; `shoot.js` per-day coverage of a
  city's set pieces goes from ~40% of its beats to 100%, so a single `--date`
  now exercises a whole city — the Chicago-crane class of miss gets harder to
  ship, not easier.
- **Docs** — every brief that says "3–4 settings" (calendar.js header,
  staleness docs, this repo's habit) needs the number corrected when it
  changes for real.

**Risks, honestly:**
- *Thin cities carry whole days.* VALENCIA (6 kinds), AMSTERDAM and CAPETOWN
  (7) each hold four minutes alone. A content top-up for the bottom three —
  one or two new fully-built, all-angles set pieces each — should ride along
  or precede the switch. ROME's tables lean on two signature pieces; a Rome
  day is strong anyway (Colosseum + aqueduct), but the audit is per city, on
  the frame, not from this table.
- *The four-minute palette.* Biome pulls keep the arc (measured, §3), but the
  terrace/tree/street vocabulary is constant for a whole run. If play shows
  it flat, H2 is the pre-measured retreat and the dormant seam machinery is
  the road back.
- *A "bad city day" is unskippable.* One shared course per day means a player
  who dislikes a city owns it for 24 h. That is also what makes it an event;
  it is listed because it will be felt.
- *Fairness surface unchanged in kind, shifted in exposure.* Whole-course
  single-city days concentrate each city's corridor/contrast risks on its own
  day; `shoot.js` gates are unchanged and coverage per city-day improves.

## 7. Method appendix

Harness: vm context over `src/core/{rng,constants,elevation,pace,course}.js`
(identical to course-test.js), `Course.pickSettings(rng.dateKey(d))` for 365
days from 2026-01-01; counterfactuals drawn with the same `rng.stream`
machinery (C1 per-date, C2 per-cycle shuffle, H2 n=2 splice). Palette tables
evaluated from world.js source by brace-matching `SETTING_LOOK` / `BIOME_MOD`
literals; ΔE is CIE76 in Lab from sRGB, biome pulls applied exactly as
`applyMod` does (lerp toward target by amount, `groundWater` swap included).
Landmark exposure counts a (setting,biome) mark list as shown when the
setting's segment overlaps the biome leg, bridges only when the segment
overlaps THE BRIDGE (0.33–0.50). The measurement script is disposable by
design — everything it computed is stated here with its method, and anything
worth keeping belongs in a tool with its own audit section, per rule 3.
