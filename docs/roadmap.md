# Roadmap

Live list. Every item here came from a playtest or a measured review, and each
carries the evidence rather than a preference, so it can be argued with.

Status: **OPEN** / **IN FLIGHT** / **DONE** / **REFUSED** (with the measurement
that refused it).

---

## From the 2026-08-07 playtest (five frames)

### R1 · The readout is still too crowded — **IN FLIGHT**

> *"I'm not sure we need the pace, clean mile, how many obstacles have cleared
> and how many are left to go. Crowds up the game."*

Four readouts named: `PACE`, the `MILE n` split toast, `n CLEAN`, and
`PB 122 CLEAN · 67 TO GO`. The centred top bar was already removed and the
middle of the frame given back to the road; this is the second pass, on what
survived.

The bar to apply is the one the start panel was cut to: *the player cannot
start, or will misread their run, without it*. The fuel gauge shows the engine
and the projection shows the verdict; a number that only restates one of those
is furniture.

### R2 · Stacked obstacles hide the road ahead — **OPEN**

> *"When there are so many obstacles back to back it makes it a tad tough to
> see what's ahead of you. What can we do to unclutter that? Is it changing
> colors? Moving the camera angle up slightly? Or maybe it's more crisp
> animation."*

Diagnose before choosing a remedy. The candidates are not equally likely: the
telegraph mats are the largest painted area on the road and two adjacent mats
already cover most of the carriageway, which is a much bigger surface than the
hazards themselves. Camera height was raised once before for exactly this
complaint and is a blunt instrument — it trades the near road for the far one.

### R3 · Mile markers unreadable; the road is over-covered — **OPEN**

> *"Review the mile markers. Still tough to read at the top. You should be able
> to clearly see that. Take out some of the wires, poles, and bars. The road
> does not always need to be covered like Subway Surfers. It can be open."*

`MILE 24` sits behind a gantry lattice in the playtest frame. This is a
deliberate correction to an earlier instruction of mine — overhead structure
was added for depth and rhythm and has been overdone. Open sky is a legitimate
and cheaper look.

### R4 · The finish card carries too much — **IN FLIGHT**

> *"End scorecard. Review and adjust. Only have what is needed. Similar to the
> landing page."*

Currently: final time, longest clean, tier chip, best-today, a five-row
summary, a six-row split table, contacts-cost, fastest mile, tomorrow's route.
Same test as the start panel, which went 109 words to 74.

---

## Standing, from measured reviews

- **Accent colour is not a closed set** — `#ffe45e` appears 29 times in
  `world.js` including spectator shirts, and the runner's cap band is the same
  hex. The stylesheet claims colour carries meaning and nothing else. Either
  pull it out of the world or delete the claim. **OPEN**
- **Four hazard variants short of the 1.6x/0.30 contrast target** — all clear
  the 1.25x/0.22 gate. Two are the hoarding and the marshals, whose red-and-
  white chevron is their real livery. **OPEN, may be a REFUSED**
- **Landscape finish card overflows 56px** — traded deliberately for portrait.
  **OPEN**
- **The bot never paths toward aid**, so a 16-contact run collects 0 of 14 and
  the comeback mechanic has never been exercised by an automated run. **OPEN**
- **Chapter the session by city** — 3-4 named cities per run already exist;
  giving each a segment clock would add resolution points to a four-minute
  session that currently has exactly one. **OPEN**
- **The 110px assumption is wrong everywhere in the source.** The runner
  measures 204-211px in an ordinary chase frame. Detail removed on the old
  figure deserves re-examination — but only the parts cut for size, not the
  base-layer sleeves, which read as holes in the vest and stay out. **OPEN**
- **Hedge and grass are true greens** (R/G 0.30-0.36) beside chartreuse trees.
  Next visible inconsistency in PARKLAND. **OPEN**

## In flight

- **Hills** — the last major unbuilt feature. Pace-neutral by construction.
- **Audio** — a full procedural mix that has never once been verified.

---

## Corrections this project has had to make to itself

Kept because each cost real work, and the pattern is the lesson: **a number
nobody measured is worse than no number at all.**

1. **The triangle budget.** 75,000 invented from software-rendering figures,
   defended across three passes, raised to 150k which was still wrong. Actual
   working ceiling 500,000; the game runs at 192k. Three agents declined detail
   they had correctly measured as affordable.
2. **The silhouette sheet.** Framed each variant at fixed width and per-variant
   height, so ten different vehicles had to print as ten identical rectangles.
   The test was unpassable by construction and a whole brief was built on it.
3. **The shaded-luminance formula** in `MEASUREMENTS.md` was stated two
   incompatible ways and neither was right — it put a colour 17% low, in the
   direction that made a defect look harder to fix than it was.
4. **The 110px runner.** Assumed throughout; he is 204-211px.
5. **The LOD justification** — "past a hundred units a spectator is under a
   pixel wide". Projected properly: 4.0px at 60 units, 1.9px at the swap
   distance.
