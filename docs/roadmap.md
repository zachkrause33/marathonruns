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

### R2 · Stacked obstacles hide the road ahead — **DIAGNOSED, OPEN**

> *"When there are so many obstacles back to back it makes it a tad tough to
> see what's ahead of you. What can we do to unclutter that? Is it changing
> colors? Moving the camera angle up slightly? Or maybe it's more crisp
> animation."*

**The first diagnosis in this file was wrong and is kept here as the reason to
measure.** It said the telegraph mats were the largest painted area and that
two adjacent mats cover most of the carriageway. They cannot be adjacent:
`ACTION_WINDOW` puts a floor of 21 units under gate spacing and a mat is 16
long, so across five real courses **0% of gaps are short enough for two mats to
overlap.** 53% of the road carries a mat, always exactly one, 28% of the lane
band. The mats are not the defect.

Two things are, both measured against the shipped camera and the shipped
collision envelopes (`tools/` scratch, reproduced in the R2 brief):

**THIRD DIAGNOSIS. The first two are kept below because the pattern is the
point: both reasoned from bounding boxes and aggregate geometry, and both were
confidently wrong. The third asked the running scene.**

### What the scene says

Raycasting from the real camera to the real road surface, 25 → 90 units
(`SIGHT_MIN`), three lanes, four points in the race:

| | road hidden | hazards | crest |
|---|---|---|---|
| mile 2.4 | 35% | 26% | 9% |
| mile 11.8 | 58% | 51% | 7% |
| mile 20.3 | 59% | 48% | 11% |
| mile 25.0 | 89% | 89% | 0% |

Hazards are the occluder. Not mats, not scenery, not terrain.

But hidden *tarmac* is the wrong measure — a player needs to see the next
hazard, which stands 0.8–2.8 above the road and can be visible over road that
is not. Sampling each upcoming gate's own collision box:

```
mile 11.8    18.2u JUMP L0 100%   18.2u BLOCK L1 100%
             46.0u JUMP L0   0%   46.0u DUCK  L1  40%   46.0u DUCK L2 100%
             79.1u BLOCK L1  44%  79.1u BLOCK L2  60%
mile 25.0    19.1u DUCK L0 100%   19.1u DUCK  L1 100%   19.1u JUMP L2 100%
             43.0u JUMP L0  20%   43.0u DUCK  L1  60%   43.0u DUCK L2 100%
             64.4u JUMP L0  20%   64.4u BLOCK L1  28%
```

**The first gate ahead is always fully visible. The second is routinely 0–60%,
and the thing hiding it is the first.** That is the complaint in numbers.

The mechanism: a hazard at 12 units has a screen half-width of 0.144 NDC
against 0.114 for the *entire three-lane band* at 45 units. One near hazard
covers all three far lanes, and gates are 21–48 apart, so there is always a
near gate doing this to the next one at the moment its lane must be chosen.

**And `shoot.js` never tested for it.** Its `HIDES` assertion walks
`world.crossings()` — overhead scenery only — against the hazards behind it.
Hazard-occludes-hazard, the dominant occluder in the game, has gone unmeasured
since the assertion was written. Closing that hole comes before any fix.

### The two wrong diagnoses, kept

**Wrong #1: the mats.** Claimed to be the largest painted surface, with two
adjacent ones covering most of the carriageway. They can never be adjacent:
`ACTION_WINDOW` floors gate spacing at 21 and a mat is 16 long, so across five
real courses **0%** of gaps allow an overlap. 53% of the road carries a mat,
always exactly one, 28% of the lane band.

**Wrong #2: the DUCK as a 3.52-unit wall.** `world.fleetSheet()` does report
these art tops against a collision bar of 1.41–1.83 — but above the bar a DUCK
is two 0.26 standards out at the edges, which `world.js` states in a comment
the bounding box could not read. Heights are still worth recording:

| | art top | sightline |
|---|---|---|
| JUMP v0–v3 | 0.79–0.80 | clear past 1.44× the hazard's distance |
| **DUCK v0–v2** | **3.48–3.56** | **opaque to the horizon** |
| BLOCK v1 hoarding, v2 trike, v4 bus, v7 refuse truck | 2.72–3.09 | **opaque to the horizon** |
| BLOCK v0 tram, v3 marshals, v5 taxi, v6 van, v8 cyclists, v9 moped | 2.32–2.59 | clear past 8.7×–87× — opaque in practice |

Seven of seventeen stand at or above the 2.62 eye. The "opaque to the horizon"
column is true of the bounding box and only partly true of the object — but
the raycast above says the effect is real however it is built.

### Standing measurement: the future lives in 5% of the frame

Road from 25u to 150u — everything still undecided — occupies 0.108 of NDC
height. Road nearer than 25u, all of it already committed, gets 1.037, i.e.
**half the screen**. The middle of the screen is looking at road 18.5 units
ahead.

Re-pointing the frame is real but modest: eye 3.10 / look 1.16 / ahead 11.0
costs almost nothing in runner size (NDC height 0.504 → 0.491) and improves
foot position (−0.583 → −0.696), but buys only 1.18× on the far band. Worth
doing, not sufficient on its own.

### R3 · Mile markers unreadable; the road is over-covered — **DIAGNOSED, OPEN**

> *"Review the mile markers. Still tough to read at the top. You should be able
> to clearly see that. Take out some of the wires, poles, and bars. The road
> does not always need to be covered like Subway Surfers. It can be open."*

`MILE 24` sits behind a gantry lattice in the playtest frame. This is a
deliberate correction to an earlier instruction of mine — overhead structure
was added for depth and rhythm and has been overdone. Open sky is a legitimate
and cheaper look.

**R3 is NOT R2 seen from above, and the claim that it was is retracted.** That
framing said overhead structure was stealing the pixels the far road needs, and
that the two should be one pass. The raycast puts overhead structure at **0%**
of blocked road — and it cannot be anything else: the eye is at 2.62 and looks
*down* at the tarmac, so nothing above eye height can ever lie between the eye
and the road. The bucket was unreachable by construction, which is the third
time on this pair of items that a plausible geometric argument has turned out
to be measuring nothing.

What R3 does affect is everything above the horizon: the mile banners, the
ghost's `RECORD 1:59:30` marker, the skyline, and whether the frame feels like
a tunnel. A gantry beam at y 5.4 projects to NDC 0.317 at 25u and 0.217 at 90u,
against a far-road line at 0.145 — so it sits in the band *just above* the road
rather than over it. `shoot.js` counts 13–32 live crossings per frame; 31 in
02-early and 32 in 04-wall. That is a tunnel, and `shots/04-wall.png` is the
owner's screenshot reproduced exactly. Separate task, separate pass.

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
6. **Three consecutive diagnoses of R2**, each confident, the first two false:
   the telegraph mats (they cannot overlap), the DUCK as a solid 3.52-unit wall
   (above the bar it is two 0.26 posts, said so in a comment), and overhead
   structure occluding the road (impossible — the camera looks down). All three
   reasoned from bounding boxes and aggregate geometry. The fourth asked the
   scene with a raycast and got a different answer in ten minutes.

   The lesson is narrower than "measure things", because all three of those
   *were* measurements. It is: **measure the thing the player experiences, not
   a proxy you can compute from constants.** A bounding box is not a
   silhouette, a z-overlap is not a screen overlap, and a category you defined
   can be unreachable by construction without ever saying so.
7. **The `git add -A` ban was the wrong rule** and cost four sweeps before
   anyone noticed, plus a fifth after. `git add <file> && git commit` is not
   file-scoped either: `git commit` writes whatever is already staged, so one
   agent's `git add` lands in the next agent's commit. The rule is pathspecs on
   the commit — `git commit -m "..." -- <files>`.
