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

**1. Almost every hazard is opaque to the horizon, and the DUCK is the worst
of them.** The camera eye is `BASE_Y` 2.62. Anything reaching that high hides
everything behind it at every range, because the sightline over its top edge
never comes back down to the road. Measured art heights, from
`world.fleetSheet()` — not from the collision box, which is a ceiling and not a
description:

| | art top | sightline |
|---|---|---|
| JUMP v0–v3 | 0.79–0.80 | clear past 1.44× the hazard's distance |
| **DUCK v0–v2** | **3.48–3.56** | **opaque to the horizon** |
| BLOCK v1 hoarding, v2 trike, v4 bus, v7 refuse truck | 2.72–3.09 | **opaque to the horizon** |
| BLOCK v0 tram, v3 marshals, v5 taxi, v6 van, v8 cyclists, v9 moped | 2.32–2.59 | clear past 8.7×–87× — opaque in practice |

Seven of seventeen variants stand at or above the eye. Only the four JUMPs let
a player see past them at a useful range.

The DUCK is the finding. `BOX[DUCK]` is a bar from 1.41 to 1.83 — but the art
carries a superstructure up to **3.52**, nearly twice the height of anything the
player interacts with, sitting directly in the band the far road projects into.
An earlier draft of this entry said a DUCK "has daylight under it and only
loses a band further out". That is true of the *bar* and false of the *object*,
and DUCKs are a third of all gates.

And any hazard at 12 units covers **all three lanes** of the road at 45 units
in screen width — 0.144 NDC half-width against a 0.114 lane band. Since gates
are 21–48 units apart, there is always a near gate doing this to the next one
at exactly the moment its lane has to be chosen.

**2. The future lives in 5% of the frame.** Road from 25u to 150u — everything
still undecided — occupies 0.108 of NDC height. Road nearer than 25u, all of it
already committed, gets 1.037, i.e. **half the screen**. The middle of the
screen is looking at road 18.5 units ahead.

Re-pointing the frame is real but modest: eye 3.10 / look 1.16 / ahead 11.0
clears the wall (sightline out to 213u) and costs almost nothing in runner size
(NDC height 0.504 → 0.491), but only buys 1.18× on the far band. The camera
alone will not fix this. The wall has to stop being a wall above the eye line.

### R3 · Mile markers unreadable; the road is over-covered — **DIAGNOSED, OPEN**

> *"Review the mile markers. Still tough to read at the top. You should be able
> to clearly see that. Take out some of the wires, poles, and bars. The road
> does not always need to be covered like Subway Surfers. It can be open."*

`MILE 24` sits behind a gantry lattice in the playtest frame. This is a
deliberate correction to an earlier instruction of mine — overhead structure
was added for depth and rhythm and has been overdone. Open sky is a legitimate
and cheaper look.

**R3 is R2 seen from above, and they should be one pass.** The far road line
sits at NDC y 0.145; a gantry beam at y 5.4 sits at 0.217 (90u) to 0.317 (25u).
Overhead structure occupies the band *immediately above* the sliver that
carries the entire future of the run, and the HUD occupies the band above that.
The mile marker has to be read in the same few percent of frame height that the
next three gates are competing for. Clearing the sky is not decoration; it is
the cheapest way to give R2's 0.108 of NDC height somewhere to breathe.

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
