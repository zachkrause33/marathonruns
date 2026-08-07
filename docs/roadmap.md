# Roadmap

Live list. Every item here came from a playtest or a measured review, and each
carries the evidence rather than a preference, so it can be argued with.

Status: **OPEN** / **IN FLIGHT** / **DONE** / **REFUSED** (with the measurement
that refused it).

---

## From the 2026-08-07 playtest (five frames)

### R1 · The readout is still too crowded — **DONE**

> *"I'm not sure we need the pace, clean mile, how many obstacles have cleared
> and how many are left to go. Crowds up the game."*

Four readouts named: `PACE`, the `MILE n` split toast, `n CLEAN`, and
`PB 122 CLEAN · 67 TO GO`. The centred top bar was already removed and the
middle of the frame given back to the road; this is the second pass, on what
survived.

The bar applied was the one the start panel was cut to: *the player cannot
start, or will misread their run, without it*.

Three of the four are gone, each with the measurement that condemned it.
`NEED /MI` travelled 4:32 → 4:27 → 4:29 across the first 200 seconds and then
divided by a distance going to zero, so a RECORD run's last word was
`NEED 24:44/MI`; its one live question is answered twice beside it at the same
instant, the gauge crossing its record tick and `need − pace` crossing zero
both between race-second 90 and 95. `n CLEAN` is the variable the tank is
drawn from. `PB n CLEAN · n TO GO` measured **frozen at 24 from race-second
215 to the tape** while the plate above it retargeted live. The `MILE n` toast
carried four facts already on the frame, including a **second pace in min/mi
sixty pixels under the PACE plate**, unlabelled — and printed its delta pink
on a run whose projection read RECORD ON in green. It survives for aid alone.

**`PACE` was kept, against the owner's list**, on the argument that it is the
only number answering to every frame of play, the only thing that gives the
tick on the tank a name, and the only one stated in the units of the wager.
Flagged to the owner rather than decided silently — *their call, still open.*

390×844: plate coverage 20.45% → **17.05%**, left column 263.8px → **204.6px**,
39 → **29** words, 68 → **60** elements. Landscape left column 70.6% → 53.2%.

### R2 · Stacked obstacles hide the road ahead — **DONE, with one lever left**

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

**FOURTH DIAGNOSIS, counting the one the fix itself corrected. The earlier
ones are kept below because the pattern is the point: each reasoned from
bounding boxes or aggregate geometry, and each was confidently wrong.**

### What shipped

`BLANKS` in `tools/shoot.js` — the assertion first, landed red, before any
fix. For each gate in the read window it casts 25 rays from the real lens at
that gate's own `Collision.BOX` face and counts what survives the boxes in
front of it. It fails only when both hold:

1. **The occluder does not self-clear**: `z_gate − z_occluder < READ_NEAR`.
   Derived, not chosen — the occluder leaves the lens once the eye has
   travelled its own distance, and at that instant the hidden gate is
   `z_gate − z_occluder` ahead with a full action window owed from there.
   `READ_NEAR = ACTION_WINDOW + CAM_BASE_BACK = 25.35`, which is where the
   literal `26` in the old read window came from; it now says so, and moves if
   the jump arc or the chase distance moves. Against a spacing floor of 21
   this selects exactly consecutive gates at the tightest spacings — "obstacles
   back to back", literally.
2. **What survives is under `READ_NEAR / d`** — 100% at the commit point, 28%
   at `SIGHT_MIN`.

The first draft of that assertion **measured occluder separation from the gate
line and passed**, which credits a BLOCK train with leaving the shot 5.33
units early — 21% of the window being checked. Corrected to the rear face,
which made the test harder and forced the generator to pay for it.

**Fixes:** the gate spacing floor now answers to the eye as well as the arm
(`readWindowAt = actionWindowAt + CAM_BASE_BACK`), and `CAM_BASE_Y` went
2.62 → 3.10 with `LOOK_AHEAD` 8.0 → 11.0.

**Result**, 22 frames, 114 gates before / 110 after: mean visible 76.0% →
80.4%, gates under half 29 → 24, **fully blank 13 → 6**. Far-road band 4.75° →
5.64°, +18.7%. Gate count 204.4 → 194.8, finish 1:57:50 → 1:57:52, and the
record still survives exactly one mistake with no aid.

**Rejected:** colour (you cannot recolour past a solid object; the four
variants short of 1.6×/0.30 all still clear the gate and are untouched).
Animation (no evidence found either way). Raising the eye enough to actually
clear a BLOCK — that needs 4.80, and at 4.82 seven of 58 gates were still
under 50%, so camera-only was never the answer.

**The lever left open:** forcing a CLEAR lane in a BLOCK's shadow. Costed at
~14% of lane slots, which would nearly double the CLEAR share — a difficulty
change, not a legibility one, and not one to make unilaterally. Some gates are
still 0% *seen*; they are now 0% seen *fairly*, because passing the occluder
restores the read with a full action window. Making the second gate genuinely
visible rather than merely fair is what this lever buys.

### Three things the diagnosis above got wrong

- **"The first gate ahead is always 100% visible"** holds for the nearest gate
  and not for the first gate *in the read window*: at skip 225 a JUMP at 43.5u
  was 20%.
- **The decisive number is the collision box, not the art.** BLOCK's box tops
  at 2.80 against an eye of 2.62 — that, not the 3.09 hoarding or the 3.52
  DUCK standards, is what made occlusion absolute, and it sits inside the
  envelope that cannot be renegotiated.
- **The framing figures check out**: 0.1008 NDC measured against 0.108 claimed.

And the fix's own author corrected themselves: a first pass reported 75.3% →
86.2% from ten frames; twenty-two give 80.4%. The honest headline is that
fully-blank gates halve, not that the mean transforms.

### The third diagnosis, which was right

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

### R4 · The finish card carries too much — **DONE**

> *"End scorecard. Review and adjust. Only have what is needed. Similar to the
> landing page."*

Was: final time, longest clean, tier chip, best-today, a five-row summary, a
six-row split table, contacts-cost, fastest mile, tomorrow's route.

Four of the five summary rows were arithmetic on numbers already printed —
`AVG PACE` = time/26.2, `FINAL PACE` 4:17 against a split table already
reading 4:17, `CLEAN GATES` 183 = 205 − 22, `CONTACTS` 22 beside a label
reading "22 CONTACTS COST". `AID TAKEN` survives as a note.

The split table was driven over 4 days × 4 skill levels: clean runs print
`4:57 4:30 4:26 4:23 4:16 4:17` **the same to within 2s on every day** — it
shows the pace model's ramp, not the run — and broken runs have a total
six-block spread of 14–23s against contacts costing 462–1064s. Constant on a
good run, noise on a bad one. Also cut: `RECORD BEATEN BY 1:37` above
`-1:37 VS 1:59:30` beside a `RECORD` chip, one number three times in 90px.

390×844, 22-contact run: **88 → 53 words, 61 → 25 elements, 598.9 → 406.9px.**

Found while auditing: **the tier chip had no background below t4.** The ladder
derives eight rungs and the CSS stopped at four, so a 2:14:30 run and a
2:21:33 run — where every bot at or below 0.5 skill lands — both rendered
`rgba(0,0,0,0)`, a bare word on exactly the runs the bottom of the ladder was
added for.

---

## Standing, from measured reviews

- **Accent colour is not a closed set** — `#ffe45e` appears 29 times in
  `world.js` including spectator shirts, and the runner's cap band is the same
  hex. The stylesheet claims colour carries meaning and nothing else. Either
  pull it out of the world or delete the claim. **OPEN**
- **Four hazard variants short of the 1.6x/0.30 contrast target** — all clear
  the 1.25x/0.22 gate. Two are the hoarding and the marshals, whose red-and-
  white chevron is their real livery. **OPEN, may be a REFUSED**
- ~~**Landscape finish card overflows 56px**~~ — **DONE.** Overflow is 0px at
  390×844, 360×780, 320×568, 1280×800 and 844×390, on the fullest card the
  game produces (two badges plus best-today), and the race-report line
  landscape used to hide is back. 320×568 was 62px. 800×360 and 740×360 still
  scroll ~21px, down from ~119px, left to `.canScroll` rather than bought by
  dropping a block.
- ~~**The bot never paths toward aid**~~ — **DONE.** The autopilot's lane
  choice now scores a lane carrying aid above a clear one, on the grounds that
  it handles JUMP and DUCK reliably (the action timing is derived from the arc,
  not hand-tuned) so a detour costs an action rather than a contact. A/B on the
  same build, aid term neutralised in the built file: **4 of 14 items collected
  → 13 of 14, with zero contacts either way.** The comeback mechanic is now
  exercised by an automated run for the first time.
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

- **R2** — the second gate, and the assertion that never tested for it.
- **R3** — open the sky, make the mile marker readable.
- **Animation polish**, stage 1 of 3: the base run cycle. Then secondary
  motion, then speed responsiveness. `?polish=0..1` scales every added term so
  one build renders both versions; `tools/stride.js` measures and photographs
  the cycle.

## Done since this file was written

- **Hills** — the last major unbuilt feature, pace-neutral by construction and
  by measurement: worst flat-vs-hilly finish delta **0.182 s** over 90 dates ×
  5 skill levels, net rise exactly 0 on every date. Five things in its own
  design did not survive contact and are written up in `docs/hills-energy.md`
  §7, including that §1.3's sightline bound was optimistic rather than
  conservative and that the bridge cannot be a hill (piecewise-linear deck
  lift has a corner, so curvature there is infinite).
- **Audio** — verified for the first time, and it was not fine. `clean()` had
  stopped responding at streak 90 of a 205-gate course. `hit` had **81% of its
  energy below 200 Hz**, which is inaudible on a phone. The crowd roar at a
  world record measured **0.3 dB quieter than a mile signpost**. The limiter's
  default 30 dB knee meant compression began at −29 dBFS, below every cue in
  the game, so the thing meant to catch stacked hits was flattening the whole
  mix. The no-Web-Audio stub was missing five methods `main.js` calls, so any
  browser without Web Audio threw on the first tick of the countdown and never
  started.
- **Grade audio** — terrain as acoustic space rather than effort, because the
  model charges nothing for a hill: 1846 Hz climbing against 2903 Hz
  descending. The crest turned out to be **a zero crossing, not a state** — a
  three-state machine produced no UP→DOWN transition at all, because the grade
  sits inside any sensible deadband for up to 1812 units between hills.

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

   **And that rule is still not enough.** A pathspec scopes by FILE, not by
   hunk. `43b8e66 "Hand the road's grade to the mix"` is a one-token change to
   `main.js` — and it also carries the entire autopilot aid-pathing rewrite,
   because that was sitting uncommitted in the same file. Same class of defect
   as the four sweeps, committed by the person who wrote the rule, one hour
   after writing it. The actual discipline is to commit a file when it holds
   one change, and to check `git diff` before every commit rather than trusting
   the pathspec to mean what it looks like it means.
