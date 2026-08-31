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
Flagged rather than decided silently, and **the owner has now confirmed it
stays as-is** — three plates in the left column, ~24% of frame height in
portrait. Closed.

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

### R3 · Mile markers unreadable; the road is over-covered — **DONE**

> *"Review the mile markers. Still tough to read at the top. You should be able
> to clearly see that. Take out some of the wires, poles, and bars. The road
> does not always need to be covered like Subway Surfers. It can be open."*

**R3 is NOT R2 seen from above, and the claim that it was is retracted.** That
framing said overhead structure was stealing the pixels the far road needs, and
that the two should be one pass. The raycast puts overhead structure at **0%**
of blocked road — and it cannot be anything else: the eye looks *down* at the
tarmac, so nothing above eye height can ever lie between the eye and the road.
The bucket was unreachable by construction.

But the correction did not go far enough either. It said what R3 does *not*
touch and left "the frame feels like a tunnel" as a matter of taste. It is not:
overhead structure was standing in front of the SIGNAGE, which lives in the
band just above the road, and that is measurable to three figures.

### The census, before

Per 100 units of road, over thirteen sampled points across the whole course. A
crossing is a cluster in z of triangles passing over the play corridor above
hazard height whose own z-extent is under 4 units — a member that sweeps
top-to-bottom past the lens.

| source | crossings / 100u | what it was |
|---|---|---|
| road tile, city (`barrier`) | 12.5 | 2 catenary portals + 1 lamp arc per 24u tile, 3 contact wires over the lanes, 15 bunting pennants |
| road tile, park (`hedge`) | 12.5 | 2 bunting spans + 1 lamp arc per tile, 22 pennants |
| road tile, bridge (`rail`) | 8.3 | 2 lighting portals per tile, 2 runners over the lanes |
| road tile, THE WALL (`wall`) | 8.3 | scaffold birdcage: 2 portals + 3 tubes over the lanes per tile |
| mile banners | 0.42 | |
| footbridges | 0.30 | |
| WALL overpasses | 0.60 (that leg) | |
| landmark spans | ~0.3 | viaduct, Chicago's L, bridge towers |

**Whole-course mean 14.32 per 100 units — one crossing every 7 units, about
three a second at race pace.** Every 24-unit tile in the game was identical
overhead. `shoot.js` counted 13–15 live crossing elements in every default
shot.

### The measurement that settled it

Not "it feels cluttered". Rays from the real camera to a 13 × 5 grid on the
MILE sign's own panel, at 420 × 860 portrait, binned by distance — plus the
rendered frame with the panel drawn and then hidden, so the pixels that change
are the ones a player can actually see.

| distance | occluded before → after | visible before → after | numeral px before → after |
|---|---|---|---|
| 0–25u | 0.41 → **0.00** | 0.68 → 0.97 | 32.4 → **64.1** |
| 25–50 | 0.54 → **0.02** | 0.55 → 0.95 | 17.2 → **32.2** |
| 50–75 | 0.70 → **0.03** | 0.42 → 0.95 | 9.8 → **19.4** |
| 75–100 | 0.82 → **0.05** | 0.44 → 0.92 | 7.0 → **13.3** |
| 100–125 | 0.89 → **0.03** | 0.36 → 0.87 | 5.3 → **10.7** |
| 125–150 | 0.89 → **0.05** | 0.42 → 0.85 | 4.9 → **8.7** |
| 150–175 | 0.95 → **0.03** | 0.34 → 0.79 | 3.8 → **8.1** |
| 175–200 | 0.92 → **0.15** | 0.37 → 0.77 | 3.7 → **6.9** |
| 200–225 | 1.00 → **0.06** | 0.30 → 0.82 | 3.6 → **5.8** |
| **all** | **0.79 → 0.04** | **0.43 → 0.88** | **9.6 → 18.4** |

**Between 57% and 100% of the sign was behind something at every distance it
could be read at, and the numeral was three to eight pixels tall.** The owner
was not describing a preference.

Three separate causes, and the first is the one nobody would have found by
looking at the diff:

1. **The gantry drew its own lattice across its own sign.** Nine X-braces sat
   at z = 0 rotated about z; the sign panel was a plane at z = 0. The near half
   of every brace was in front of the text, in the same plane, z-fighting with
   it. The finish arch had the same defect — its top chord crossed the top 0.6
   of a 2.4-unit FINISH panel, and its checker band was 0.8 units *behind* the
   panel and more than half of it was never drawn at all.
2. **Nothing was behind the panel but more structure.** The WALL birdcage
   accounted for 59 of 65 blocked rays to MILE 20 at 101 units, 61 at 145, all
   65 at 96.
3. **The numeral was 0.95 world units tall on a 9.3 × 2.1 plate** carrying a
   word and a two-digit number with most of the plate empty.

### What shipped

**The road tile no longer spans the road at all.** It carries a VERGE LINE
instead: a lamp standard and a telegraph pole per side per tile, staggered so a
vertical passes the lens every six units, with three wires running *along* the
verge at `POLE_X` where the contact wires used to run over the lanes. The lamp
arc kept its 13.3-unit head height and its arm was cut back from x = 1.6 to
`POLE_REACH`, outside `CORRIDOR_HALF`. Removed outright: both catenary portals,
both bunting spans, the bridge's lighting portals, and the WALL birdcage. The
WALL's scaffold now goes *up* — a third lift standing on the hoarding line at
|x| = 11.35 with site floodlights — instead of across.

This is `reference/sonic-dash-downhill.png`, which the owner sent mid-task.
Nothing spans the carriageway in that frame; the whole vertical vocabulary is
poles in the verge carrying longitudinal wires, and the Golden Gate fills the
upper third in clear sky. Depth from the verge, not from the ceiling.

**Bunting now exists only in the finish chute.** It ran on every city and park
tile for the whole race, which is why it meant nothing. The first pennants a
player sees in a marathon are the ones over the tape.

**The mile marker was re-set the way a real mile marker is set.** Plate 2.1 →
2.9 units, X-braces deleted and replaced by a header above the plate, panel
moved to z = −0.62 clear of every member of the frame, and the label re-laid as
a small caption beside a huge numeral. Measured on the rasterised canvas, not
assumed from a cap-height constant: **numeral 0.952 → 1.921 world units,
2.02×**, for the same one draw call and the same texture upload. Same fixes
applied to the START/FINISH arch.

**`MILE_SIGHT_BEFORE` / `MILE_SIGHT_AFTER`, a new rule.** No spanning set piece
may stand within 95 units before a mile marker or 26 units after it. The old
rule was symmetric at 32 units and was reasoning about composition; occlusion is
asymmetric, because the camera is always on the low-z side. The hand-placed
mile-20 overpass moves from 34 units before the gantry to 95 — which is the
beat its own comment always described, and was not getting.

### The census, after

**Whole-course mean 1.97 per 100 units, an 86% cut.** The road tile contributes
exactly **zero** — by construction, and `api.crossings()` re-derives it from the
built triangles on every `shoot.js` run. Longitudinal members over the corridor:
2–6 per frame → **0**. `shoot.js`'s own count: 13–15 → **4–6** on every default
shot. Everything remaining is a mile banner, a footbridge, a WALL overpass, a
named landmark, or the finish chute.

The only place the census still runs high is inside the Oberbaum's own 66-unit
arcade (6–9 crossings), and that is left alone deliberately: it is a named
landmark, it happens once per 235 units of bridge, and a landmark is worth more
than a lattice.

**Cost: draw calls unchanged** — 175/195/182/265/233/164/261 against
175/198/182/265/235/164/261, i.e. within ±3 on every shot. Peak triangles
185,000 → 181,904. THE WALL is 876 triangles *heavier* because the third
scaffold lift costs more than the birdcage saved.

### What the brief got wrong

**"Removing structure should help both [triangles and draws] — if your change
doesn't reduce draws you should ask yourself whether you removed anything."**
It cannot reduce draws, and the reason is written in this file: the overhead
layer was *baked into the road tile's merged edge mesh* precisely so that a
mast and fifteen pennants cost triangles instead of submissions. Removing it
gives back triangles and nothing else. Draw calls were never the currency this
change was denominated in. Deleting 12.3 crossings per 100 units of road bought
**zero** draw calls, and that is the correct result rather than evidence the
work was not done.

### Left open, and not mine to close

- **The ghost's `RECORD 1:59:30` marker is a `Sprite` with `depthTest: false`
  and `fog: false`, at `renderOrder` 900** — an instrument, deliberately, and
  it is drawn over everything including hazards. It is not in the world group,
  so `api.crossings()` and therefore `shoot.js` have never audited it. In
  portrait it lands in the same band as the mile banner and, at every distance
  measured, it is more legible than the sign it sits under. That is an R1
  crowding question, in `ghost.js`, and it was left alone.
- **Beyond ~150 units the fog washes the plate**: plate-vs-sky falls to 1.11 at
  200–225u and glyph-vs-plate to 1.02. `fog: false` on the panel would fix it
  and was rejected — the banner spawns at `VIEW` = 210 and fog is what currently
  hides the spawn, so a fog-free plate would pop into an empty sky. The honest
  contract is: **findable from ~180 units, readable from ~110.**

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

## Open, from the visual-polish pass

- ~~**The fleet has not grown into its new envelope**~~ -- **DONE**, with both
  riders, and with one of the brief's own numbers refuted.

  **The art.** Nine of the ten BLOCK variants were 1.30 deep. They are now
  3.82-3.89 for the four full-size road vehicles and the tram, 2.42 for the
  cargo trike, 2.02 for the moped, 1.64 for the pair of cyclists -- so plan
  proportion is a fact about the vehicle again instead of a constant. The taxi
  is 3.87 x 1.58, 2.45:1, against a real saloon's 2.56:1; it was 1.20:1. Two
  axles carry a 1.90 wheelbase with 1.30 between the tyres where the old
  envelope left 0.04, the bicycles and the moped have two wheels each for the
  first time, and the refuse truck's twin tyres are on the rear axle only
  because there is now more than one axle to choose from.

  The wheel arches moved with the length. The old opening was cut in X-Y and
  extruded the full depth, which is exactly right at 1.30 (the rear face IS the
  flank) and at 3.90 is a slot down the whole underbody with lit road showing
  through it. It is cut in Z-Y about each axle now, in the tyre's x band only,
  which is where a car's arches are and which is what the 3.90 flank shows to
  the next lane. Cost: about 50 boxes a vehicle against the old 52.

  **Nose-anchoring landed and cost what it was costed at.** `Collision.BOX`
  spans `[gate.z, gate.z + 2*halfZ]`; `Course.reachOf` charges `2*halfZ*span`
  instead of `halfZ*(2*span-1)`. Gate count 190.4 -> **187.7 (-2.7)**, perfect
  finish 1:57:54 -> **1:57:55 (+1s)**, record still survives exactly one
  mistake unaided. The art is offset by `halfZ` at ONE place (`hazardPool`), on
  the variant group rather than the pooled group, so the telegraph mat keeps
  its own z and now runs up to the bumper instead of 1.30 underneath it.

  **`halfX` exists, and the brief's reason for calling it harmless was wrong.**
  It said "safe today, box 1.70 against widest art 1.56". Measured on the swept
  geometry of all seventeen variants: **fourteen of them reach past 0.85**, the
  widest static art is the DUCK frame's base plate at **1.148**, and the
  marshals' stop paddle swept to **1.865** -- past the middle of the next lane.
  `LANE * 0.5` would have been the tightest number in the file and would have
  under-counted every hazard as an occluder, which is the one direction
  `BLANKS` cannot survive. `halfX` is **1.12**, which is the number `world.js`
  has cut every clearance from since `HAZARD_HALF` was written, moved into the
  contract and now enforced. `shoot.js` fails the build on any variant leaving
  its box in x or z, and on y for JUMP and BLOCK; y is reported and not failed
  for DUCK, because that box is deliberately the bar and not the frame.

  **Six things were outside their own box and nothing had ever looked.**
  The hoarding's beacons at **3.09** against a BLOCK ceiling of 2.80. Every
  JUMP's striped face at 0.531 against a halfZ of 0.52, and every JUMP plinth
  authored at exactly 1.04 = the whole box, leaving the face nowhere legal to
  stand. The DUCK cap at 0.31 against 0.30. `vFront`'s headlamp core standing
  **0.035 proud of the plane its own comment calls "the frontmost it may
  reach"**, on every road vehicle in the fleet. The DUCK base plate above. The
  paddle above. All six fixed by moving the art.

  **And `HAZARD_HALF` itself was stale.** It read `1.20 * LANE_FIT + 0.25` =
  1.118, described as "the widest point of any hazard -- the DUCK frame's foot,
  0.50 wide at 1.20 out". The foot is 0.56 wide and reaches 1.148, so the
  constant that `CORRIDOR_HALF`, `LANDMARK_IN` and every aid clearance is cut
  from sat 0.03 INSIDE the widest thing it was supposed to contain -- and a
  JUMP variant carries a comment citing 1.118 as a limit it had already passed.
  Same class as the triangle budget and the 110px runner.

  **A seventh, in the claim site:** `body.position.z = (span - 1) * 0.65` was
  the OLD BLOCK half-depth, never updated when the envelope was renegotiated,
  so every train in the game had been anchored 1.30 units behind its own gate
  line. It reads `MR.Collision.BOX` now.

  Contrast improved or held on all seventeen (per-variant table in the pass
  report); the four short of the 1.6x/0.30 target are the same four as before
  and all still clear the gate. Draws 163-261 against 162-258 before,
  triangles 132k-183k against 131k-183k: the rebuild is free in the budget
  that binds.
- **Elevated traffic is the one route not refused.** Road traffic was refused
  twice with measurements: no continuous gap in the 0-12.2 band, and 0 of 14
  bridge days with 15-22 clear. **Every blocker found on both routes is at
  ground level.** A raised railway or flyover crossing above `OVERHEAD_Y` is
  untouched by any of it. **OPEN**
- ~~**Variant repetition is DUCK and JUMP, not the fleet**~~ -- **DONE, and
  the diagnosis was half of it.** The premise held: DUCK and JUMP, not the
  fleet. The prescription -- more variants -- was the expensive half, and
  nobody had looked at the DRAW.

  Measured over 30 dates and 12,886 hazards on the 64.65-unit window
  (`READ_NEAR` 25.35 to `SIGHT_MIN` 90, stepped 5), windows containing a
  repeat:

  | | JUMP 4 / DUCK 3 | JUMP 6 / DUCK 5 | JUMP 7 / DUCK 6 |
  |---|---|---|---|
  | hash | 57.2% | 46.9% | 43.4% |
  | shuffled bag | 38.1% | **21.7%** | 17.5% |

  **A dealt bag at the OLD variant count beats an independent hash at three
  more variants than we have.** Two more skins buy 3.5 points; the draw buys
  25. Both compose, so both shipped.

  `variantIndex` was a good hash -- it replaced an arithmetic form that gave
  the ten BLOCK skins 36/25/11/18 -- and a good hash is an INDEPENDENT draw,
  which is the property that produces runs. It is now `castGates`: every
  variant is dealt once before any is dealt twice, shuffled inside each deal,
  the whole course cast up front in gate order so the casting stays a property
  of the course and not of the playback. Trains still force the tram and are
  dealt outside the bag.

  Shipped figures, measured off `api.variantPlan` on the built page with no
  node replica in the loop: **57.2% → 22.1%** of windows, repeated pairs per
  window **1.131 → 0.270**. JUMP 0.518 → 0.089, DUCK 0.524 → 0.101, BLOCK
  0.089 → 0.080.

  Four new variants: JUMP v4 linked water-filled barriers, v5 a cable drum on
  a crossing ramp, DUCK v3 a level-crossing boom (the first asymmetric duck),
  v4 a services pipe crossing. All four inside `MR.Collision.BOX` on every
  axis and all four clear the 1.6×/0.30 **target**, not merely the gate.

  A second effect nobody asked for: **a variant's share is now its authored
  weight to a tenth of a point** -- DUCK 20.0% each, JUMP 16.7% each, BLOCK
  weight-one skins 4.5-4.7% and weight-two 9.0-9.4%. Under the hash the same
  one and two tickets gave BLOCK v1 4.9% and v8 10.9%.

  **The tram is untouched and is now the largest single source of BLOCK
  repetition**, at 29.7% of all repeated pairs on 18% of hazards, because a
  forced draw cannot be spread by a bag. That is structural: a train must be a
  tram. 0.080 pairs/window in absolute terms.

  `api.liveCast` is new and is the assertion the refactor needed -- it reads
  the visible child of every claimed hazard, so the plan can be checked
  against the road. 433 castings repeatable and stable over four loads, every
  live hazard agreeing with the plan.
- **Per-variant hazard depth**, rejected for now rather than refused: right in
  principle and cheap on the course side (the casting is a pure function of
  the course -- see `castGates`), but a box shorter than its art makes
  `BLANKS` under-count and pass a gate the art really hides. Needs box and art
  changed together. **OPEN**

## Decisions waiting on the owner

Both are now settled.

- **Moving hazards — REFUSED, by the owner.** *"Obstacles can sit. I agree with
  that approach."* The queue in the Sonic reference stays a look, not a
  mechanic. Not revisited.
- **Forcing a CLEAR lane in a BLOCK's shadow — REFUSED.** R2's open lever, and
  the owner asked for a recommendation rather than a choice. The
  recommendation, taken:

  **The fairness contract already holds by construction.** `BLANKS` proves that
  when a gate is hidden, passing the occluder restores the read with a full
  action window still owed. Those gates are not unfair; they are unfair-
  LOOKING, and the difference is the whole of R2's finding.

  The lever costs ~14% of lane slots and would nearly double the CLEAR share --
  it buys visibility by removing gameplay, and a large slice of gates would
  stop asking anything. The owner has twice called the game too easy and
  `HIT_STREAK_KEEP` was tightened 0.25 -> 0.40 on that basis; this hands it
  back.

  And the alternative is strictly better: **the measured repetition is DUCK and
  JUMP variant count**, not lane occupancy. Per hazard seen a DUCK repeats 3x
  as often as a BLOCK. Spending the same effort there buys variety at zero
  difficulty cost.

  Reopen only if a playtest says the second gate reads as unfair *in play*,
  which is a different claim from the geometry, and the geometry is settled.

## Standing, from measured reviews

- ~~**Accent colour is not a closed set**~~ — **REFUSED, with the
  measurement, and the item counted the wrong thing.** `#ffe45e` appears 43
  times in `world.js` (29 when the item was written) plus the runner's TRIM
  through `PALETTE.accent`. Counting source hex is the wrong instrument, the
  same way the 110px runner was: an authored colour is not a screen colour.

  Counted on shipped frames at 390×844, canvas alone with the UI hidden,
  pixels equal to the HUD accent: **zero at every gameplay skip** (0 at ±8 for
  skips 40, 120 and 185). Everything the world paints this with is lit — toon
  ramp, hemisphere fill, fog — and the nearest yellow it renders is
  (239,212,87), **16 per channel away**. Masked at ±30 the whole frame holds
  **78 near-accent pixels and every one is the runner's headband and shoe
  midsoles**, 0.02% of the frame against the HUD's own 1.3-5.1%. Not one
  spectator shirt, streetlamp, cable, sign or bunting flag comes that close.

  So the stylesheet's claim survives in the channel that decides it, and
  repainting 43 props would move a number that is already zero.

  **One real collision, recorded rather than removed:** the finish confetti is
  unlit, so it paints (255,228,94) exactly — 1,327 pixels, at the tape and
  nowhere else. Gold confetti at a record *is* what the accent means. The
  thing to watch is that **anything unlit added to this palette lands on the
  hex exactly**, which is the rule the note in `shading.js` now carries.
- ~~**Four hazard variants short of the 1.6x/0.30 contrast target**~~ — **two
  fixed, two REFUSED with numbers, and the list was five.** On the
  finish-carpet shot JUMP v3 sat at 1.59× as well, in the shipped build and at
  baseline; and the item's "the hoarding and the marshals" was stale — the
  hoarding had already cleared and the fourth was the CYCLISTS.

  **Both JUMPs fixed by the fleet's own finding, applied to the vocabulary
  that never got it.** Chroma is the AREA MEAN and cream renders at S 0.092;
  the fleet swapped its cream for LEMON `0xfff23a` and every vehicle moved.
  The JUMP cap is a bigger share of a JUMP than that band ever was of a
  vehicle, because a JUMP is 0.80 tall and the cap is the top of it under an
  elevated camera. Target margin: v0 +0.120→+0.173, **v1 −0.090→+0.298**,
  **v2 −0.132→+0.226**, v3 +0.018→+0.270, v4 +0.060→+0.524, v5
  +0.101→+0.340. The two that were short now clear by the widest margins of
  the six, the light band survives at L 159.9 against a road of 61-90, and
  pairwise silhouette separation at 40 units is unchanged to within a point.
  Second half of the same rule: the works-trench mouth and the cone bases were
  `0x2b2f52`, a near-neutral navy and the largest dark area in the vocabulary.
  Dark amber instead — a hole is a value step, not a hue — and v2's saturation
  went 0.034 → 0.170 on that change alone.

  **Marshals — REFUSED.** Every lever measured: as shipped −0.144; lime tabard
  −0.166; amber −0.196; orange `0xff8c00` −0.217; orange `0xff7a1f` **fails
  the build gate**; navy to dark-of-hue −0.150 to −0.163. Every change is
  worse and the most obvious one — give them a real hi-vis tabard, because
  cream is not a hi-vis colour — **fails the build**. One mechanism: the
  variant passes on luminance, its largest bright area is the cream tabard,
  and every real hi-vis colour is darker than cream. The chroma route is
  closed structurally — its two biggest bright areas are a white barrier band
  and a white tabard, and you cannot saturate white without it ceasing to be
  white. The lime result is worth keeping: it is worse than cream because the
  board is pink and lime is opposite it on the wheel, so the area mean cancels
  to neutral. That is the fleet header's "must not straddle the neutral axis"
  rule showing up on an object nobody had applied it to.

  **Cyclists — REFUSED.** Needs L 97.8, renders 91.3: short by 7%, the closest
  miss in the game. Warming the tyres reaches S 0.51 but costs more luminance
  than it buys (−0.074 to −0.098), and two of the largest remaining areas are
  SKIN, which cannot be saturated and stay skin. Their rims and hubs are now
  the WARM set — they were the last warm two-wheeler wearing the cool one —
  which buys 0.012 of saturation and changes no verdict.

  Both clear the fairness gate, at +0.07-0.12 and +0.195, which is the number
  that decides whether a player can see them.
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
- ~~**Chapter the session by city**~~ — **DONE, and the proposal in it was
  wrong.** The premise holds: 60 dates give 36 three-city and 24 four-city
  runs, a chapter lasting 34.3 to 126.9 real seconds, mean 69.4, and one
  setting covers over 45% of the race on 10 of 60 days. But **the segment
  clock this item asked for measures the course, not the player** — the spread
  is set by where `pickSettings` jittered the boundaries, and a 102-second
  Chicago beside a 52-second Boston says nothing about the run.

  Two further per-chapter verdicts were measured and refused:

  - **The ghost delta per chapter is the pace ramp with a city name on it.**
    On a FLAWLESS run across ten dates chapter one reads +97s to +134s and the
    last reads −51s to −158s, every date, on a run heading for the record.
    That is the six-row split table's first failure exactly, and it would have
    printed a large positive number where a player looks for a verdict.
  - **Elapsed-minus-flawless cancels the ramp exactly** (0.000s in every
    chapter on a clean run over 40 dates) **and still charges the wrong
    city**, because a broken streak is paid off for the rest of the race:
    five contacts in Berlin billed Boston 2:45 and Chicago 0:57 for road they
    ran clean, and on 2026-08-12 it named Sydney the worst chapter of a run
    whose every contact was in Tokyo.

  What survives is the counterfactual — re-run this race with one city's
  contacts erased — because a city run clean scores exactly zero by
  construction. **One line, not a table**, and that is measured too: over 60
  bursty runs the top city holds 87% of the cost at three contacts (60/60 a
  majority), 63% at eight (47/60), 51% at twenty (27/60), while the
  counterfactuals go from 1.2s to 55s adrift of the plate's own total. A table
  would print its worst self on the runs it reads worst, so the line appears
  only when one city genuinely carried the run.

  **No transient, and no live verdict.** Both were refused on the measurement
  above: every honest per-chapter *time* is a finish-time quantity and cannot
  be known until the tape, and the boundary is a deliberate 190-unit (~7s)
  cross-fade, which is the wrong place for a hard card.

  Shipped: the rail's static `0 / 13.1 / 26.2` becomes the day's route on the
  same axis (the setting fractions already ARE that bar's coordinate, since
  `TOTAL_UNITS = MARATHON_MILES * UNITS_PER_MILE`), plus boundary marks on the
  bar; and one finish-card note, `CLEAN THROUGH BOSTON · 1:59:40`. Live HUD at
  390×844: plate coverage 16.35% → **16.03%**, left column 204.6px unchanged,
  words 24 → **24**, elements 60 → **62** (the boundary marks). The end card
  gains one note and five words, and only on runs where it is true.
- **The 110px assumption is wrong everywhere in the source** — **DONE, and
  the 204-211 that replaced it was wrong too.** Measured on the shipped build
  at the shipped camera by the new `tools/figure.js`: **163-208px at 390×844,
  median 179-199 by pace**. So 204-211 quoted the top of the range as though
  it were the figure, and the camera has moved twice since it was written
  (`CAM_BASE_Y` 2.62 → 3.10, `LOOK_AHEAD` 8.0 → 11.0, the FOV floor 58 → 61,
  the swing 10.5 → 8.5). Two things nobody had noticed at all: **pace is worth
  10% of him**, because the lens opens 61 → 70 across the honest band; and
  **in landscape he is 50-67px**, a third of portrait and near the forty-pixel
  silhouette the jump and slide are held to. No comment in `runner.js` had
  ever mentioned that framing exists.

  The number that settles a removal is not his height but **pixels per world
  unit at the part's own depth** — 121-131 portrait, 39-43 landscape — and no
  comment had that either. Every removal argued in this file converted by
  dividing the part by 1.60 and multiplying by a remembered height.

  **All four removals stay out, and only one for the reason recorded.**
  Re-judged with a second new tool, `tools/resolve.js`, which BUILDS each
  candidate, gives it a flat unique colour and COUNTS its pixels in the real
  chase frame across a stride, against a positive control of the same geometry
  held clear of what occludes it.

  - **Lace panel** — recorded as "half a pixel wide"; 0.078 across is nine or
    ten. It never had a size problem: **0 pixels in 48 of 48 frames**, both
    framings, while the same box held clear owns 260. The sock covers
    everything nearer than z 0.099, the toe dome reaches back to 0.106 and
    *over* it, and two 0.014 ink shells close the 0.008 left between them.
    The shin and the toe are unchanged since the panel was written, so **it
    was invisible from the moment it landed**.
  - **Waistband** — recorded as "a 3px band of a near tone"; it is 6-11px in a
    column, 16px of extent, **299 pixels of frame, 7.5× the short cuff kept
    beside it**, and it renders at L 42.5 where that cuff renders at L 42.4.
    They are the same band. It goes anyway for the fault the note was reaching
    for and aimed at the wrong neighbour: it sits within 8% of the **vest hem
    above it**, and cuts the hem-to-shorts value step **1.83× → 1.08×** across
    the 11 columns nothing else overlaps — a 41% cut, under this file's own
    12% floor for a tone that vanishes into its neighbour's band of the ramp.
  - **Three fingers** — 0 pixels in 45 of 48 portrait frames, 48 of 48
    landscape. Curled forward they point down the view axis, which header
    rule 4 already says has nothing to see, and the palm is in front of them.
  - **Base-layer sleeves** — the one original argument that survives, and the
    only one never about size: a triangular **hole in the vest** reads *more*
    clearly as the figure grows. 23px, recorded so nobody rebuilds it.

  The correction in three of the four is one correction: **a dimension is not
  a screen footprint.** Occlusion and foreshortening decide whether a small
  part is drawn and neither is computable from the source.
- ~~**Hedge and grass are true greens** (R/G 0.30-0.36) beside chartreuse
  trees~~ — **DONE.** (This item was in the file **twice**, verbatim; the
  duplicate is removed with it.) The two numbers were exact and they were the
  hedge: body `0x2f9f52` at R/G **0.296** and cap `0x49c96b` at **0.363**,
  against trees on the same tile at 0.72-0.76. The "grass" was the pond reeds,
  half of them the same emerald.

  Both were missed for the reason this file already records for the avenue
  tree, in its own words: they are **baked into the road tile rather than
  pooled per setting**, so nothing that walks the tree palettes ever reaches
  them. The hedge is the largest continuous area of foliage in the game — two
  rows the full length of every PARKLAND and RIVERSIDE tile, nearer the lens
  than any pooled tree.

  A clipped hedge is a dense dark mass, so it takes the bottom of the ladder
  rather than the middle: body a step below the avenue's darkest lobe, cap on
  the avenue's own mid lobe, which is what a sunlit hedge top is. Judged on a
  PARKLAND frame at f 0.698 before and after, not on the hexes. Whole-frame
  saturation across the eight shots moves 0.332 → 0.328, **inside the
  composition confound this file has already been caught by once** — the new
  casting changes which variants stand in each shot, so a whole-frame mean
  cannot be read as a colour change.

## In flight

- **R2** — the second gate, and the assertion that never tested for it.
- **R3** — open the sky, make the mile marker readable.
_Nothing. All four playtest directives and the three animation stages are
done._

## Done since this file was written

- **The record plate no longer paints over hazards.** The ghost's
  `RECORD 1:59:30` marker is a `Sprite` with `depthTest:false` at
  `renderOrder` 900, outside the world group — so `crossings()` never returned
  it and none of `LOW`, `HIDES` or `BLANKS` had ever audited it. A new
  `PAINTS` assertion walks the live scene and tests the *property* rather than
  the object: any material with `depthTest === false` landing after the opaque
  pass has its screen rect projected and its **texture alpha read back**, and
  every ray `BLANKS` already casts at a hazard face is asked whether it lands
  under one. Its first draft passed for two wrong reasons — it read
  `Texture.center` to decide the uv transform was identity, and that defaults
  to `(0,0)` not `(0.5,0.5)`, so the alpha readback never ran; and the default
  shot set never photographs the ghost level with the player, which is why
  `08-level` now exists. Fixed by a floor on `lift` derived from
  `BOX[BLOCK].yMax`, `SIGHT_MIN` and the real camera. Coverage of hazard faces
  goes to zero across the race, at no cost in draws or triangles.

  **Three corrections to the brief that commissioned it.** `shots/04-wall.png`
  does not prove the defect — the truck the plate covers there is 14.7u from
  the lens, inside `READ_NEAR` = 25.35 and already committed to. "Covers
  hazards forty units further down" understates it: the plate's *top* passes
  eye height once the ghost is past ~16u, so its sightline never returns to
  the road and the covered band runs to the horizon. And "raise the floor above
  2.80 world" was the right instinct in the wrong frame — what binds is the
  screen row, and the BLOCK that projects highest is the one at `SIGHT_MIN`.
  It is also only solvable *because* R2 raised the eye to 3.10; at 2.62 no
  plate height clears the band.

  Costs paid and measured: overlap with mile banners rises 36.5% → 44.1%, and
  the tag's height stops carrying the gap below ~85 units. Both traded against
  hazard coverage going 100% → 0%, on the grounds that a banner costs a split
  and a hazard costs the record.

- **A tree crossed the play corridor at y = 7.74** against an `OVERHEAD_Y` of
  9.0, at mile 18.3. Trees roll x over [7.5, 26] — clear of `CORRIDOR_HALF`
  3.75 — and are *then* scaled by up to 1.45, so a large roll at the near end
  reaches back over the road. Each tree now stands off by its own scaled reach,
  measured from its merged bounding box, which fixes the class rather than the
  instance.

  **The finding that matters is about the suite, not the tree.** `shoot.js`
  could have caught this since the corridor rule was written; it never looked
  at mile 18.3. Six shots is a thin sample of a 6,293-unit course, and a green
  suite that has not visited most of the road is a more dangerous object than
  a red one. Verified by a 155-point sweep every 40 units instead: base build
  one violation, fixed build none.

- **`build.js --check`** fails when the committed `index.html` is not what the
  source builds. It had drifted twice in one session, once by 97KB, with every
  harness green — structural, because every tool either rebuilds first or is
  pointed at a scratch build, so the one artifact none of them check is the one
  that ships. And an agent that correctly declines to commit a build artifact
  leaves it stale by doing the right thing.

- **Animation polish, stage 1 — the base run cycle.** The brief's diagnosis
  ("pure sinusoids; contact fast, swing slow") was right and secondary. The
  bigger defect was **phase**, and it was invisible to every measurement taken
  because they all read amplitudes: plotting the foot's rig-space *loop*
  showed it travelling **forward at the bottom of its arc and backward at the
  top** — a bicycle pedalled the wrong way. `bend` peaked half a cycle from
  where a run puts it, so the leg was straight at mid-swing (hence a sole 0.035
  under the road with no weight near it) and folded at both swing extremes.
  Turning the knee's phase by π reverses the loop, and nothing else had to
  move because `bob` is already lowest at both places the feet now plant.

  Planted foot **+4.894 → −6.739 u/s** (the sign flip is the whole tell),
  skate 119.5% → 73.1%, sole penetration halved. Pelvis share of foot travel
  7.7% → 13.5%; shoulder share of hand travel 7.5% → 16.8%. Foot planting was
  *solved* rather than tuned: all three leg joints turn about one axis, so the
  sole is flat when `hip + knee + ankle = 0`, and through stance the ankle is
  solved for that every frame — so depth no longer depends on stride
  amplitude, and stage 3 can raise it without reopening the question.

  `--polish 0` proven bit-identical across 18 transforms × 48 phases × 8
  states, against a same-build control to establish the noise floor.

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

## Done in the visual-polish pass

- **The sky.** The horizon faded to a fixed 42% white; the band just above it
  measured S 0.039 against sonic's 0.511. Worse, the gradient was scaled so the
  deep stop at the top of every biome palette **was never on screen** -- the
  chase eye reaches only 21.8 degrees above centre and the ramp topped out
  before that. It now fades to the live fog colour, which makes the horizon
  seamless by construction in all six biomes rather than in whichever one the
  white was picked against. Sky saturation +42%.
- **The road stopped out-valuing the runner.** `mats.paint` was
  `MeshBasicMaterial` -- unlit, drawing at its authored value -- so the
  brightest object in the gameplay band was road marking at L p95 0.96 against
  a character ramped to 0.66. Paint moved to the lit material and every tone is
  now a **multiple of the tarmac** rather than an absolute. Frame bright extreme
  0.96 -> 0.66. Near-band edges fell on all eight shots and near-band
  saturation rose on seven, which nobody aimed at: near-white paint carries no
  chroma, valued paint does.
- **The fleet, built on all sides.** An orbit sheet found what the chase view
  never could: every vehicle's front was a featureless slab, no BLOCK had side
  glass (a pillar 0.98-1.26 deep was parked over the flank, hiding windows that
  were already built), and wheels were three darks stacked. `MeshToonMaterial`
  has no specular term, so nothing in this game had ever carried a highlight;
  there is now a cel specular opted into **per vertex**, because a glossy tyre
  is worse than no highlight. Draws went **down** 297 -> 281 while the fleet
  gained fittings, because contact shadows were costing two draw calls each --
  three renders a transparent double-sided material in two passes unless told
  otherwise, and for a flat quad the second pass cannot change the image.
- **Hazard depth renegotiated**, 0.65 -> 1.95 half-depth. The ratio could not
  be measured from the mocks and the agent said so rather than dressing up an
  estimate: converting an on-screen length to a lateral one needs the focal
  length, the only in-image bridge is a wheel's circularity, and in a 1206px
  screenshot the tyre's foreshortened edge does not resolve. Derived instead
  from the one exact ruler -- this world is ~1 unit to the metre vertically --
  and checked against the mocks qualitatively. Gates 194.8 -> 190.4, finish
  1:57:52 -> 1:57:54, mistake budget unchanged.
- **One wind for the whole world.** Direction was not a choice: the sky shader
  already committed the clouds to travelling toward world -x. Foliage sways at
  0.45 Hz with amplitude cantilevered off each part's own height; bunting
  flutters at 1.80 Hz with phase running along the span. **Rates were sized in
  pixels, not world units** -- the first attempt measured 0.55% of pixels
  changing over a hundred seconds, about one pixel, and was caught
  reintroducing "perceptually still" inside a commit about adding motion.
- **`tools/motion.js`**, the motion assertion. `shoot.js` fails the build on
  four occlusion tests and on contrast, and **every one runs on a single
  frame**, so the fairness harness was blind to motion by construction.

## Environment liveness and clarity, re-measured 2026-08-09

A measurement pass, no source touched. New instrument: **`tools/liveness.js`**,
whose header carries its own five defects. It freezes the world, advances only
`world.waveClock`, isolates every drawable unit in turn and reads its silhouette
back off the GPU, so every figure below is the shipped shader's own output in
**pixels at the chase framing** rather than a world-unit constant read out of a
comment. Full gate green before and after (`build`, `shoot`, `course-test`,
`simulate`); draws 163-256 against a ~400 ceiling.

### First, the question that prompted this: was the environment-animation half ever done?

**Yes. It was done, deliberately, and the doubt was misplaced.** The evidence is
a four-commit pass on 2026-08-08 between 00:21 and 01:30, with its own
instrument and its own measured rebalance:

| commit | what landed |
|---|---|
| `1e6d22e` 00:21 | checkpoint of the interrupted agent, plus `tools/motion.js` (466 lines, new) |
| `4dbf8a4` 00:41 | one wind for the whole world, direction taken from the cloud shader; three defects found on the way |
| `bd3eb03` 00:56 | the ink shell taught to move with the body it wraps; **amplitude re-sized in pixels** after measuring 0.55% of pixels changing over 100 s |
| `aa5155f` 01:30 | the finish bunting flies on `mats.cloth` |

It is also already written up in this file under *Done in the visual-polish
pass* ("One wind for the whole world", "`tools/motion.js`"). So the pass exists,
it was measured rather than asserted, and it caught itself shipping
"perceptually still" once.

**What is true instead is narrower and more useful: the pass was scoped to the
world as it stood at 01:30 on 2026-08-08, and roughly twenty `world.js` commits
have landed since** -- the hazard rebuilds, the cones, the kerbside furniture,
the tram, the aid ribbon, the one-spectator-builder refactor, the tree
understorey, the hedge and pond-reed recolour. Nothing re-ran the animation
question over that new scenery, and the findings below are almost entirely in
it. This is the same structural failure the colour work already recorded about
itself: *"the avenue is baked into the road tile rather than pooled per setting,
so nothing that walks the tree palettes ever reaches it"* (`world.js:6037`).
The wind pass walked the same pools the palette pass walked, and missed the same
objects for the same reason.

### What actually moves

Eight points in the race, one per leg. `frame-changed` is the share of frame
pixels that change over one full gust period with **only** the wave clock
advancing.

| skip | mile | leg | animated units | moving | frame-changed | live share of scenery px |
|---|---|---|---|---|---|---|
| 25 | 2.4 | CITY START | 11 | 10 | 0.66% | 0.9% |
| 60 | 6.1 | RIVERSIDE | 16 | 16 | 1.90% | 7.5% |
| 95 | 10.0 | THE BRIDGE | **0** | **0** | **0.00%** | 0.0% |
| 110 | 11.7 | THE BRIDGE | **0** | **0** | **0.00%** | 0.0% |
| 140 | 15.1 | PARKLAND | 17 | 17 | 0.38% | 2.2% |
| 178 | 19.5 | THE WALL | 5 | 5 | 0.16% | 0.7% |
| 200 | 22.0 | THE WALL | 5 | 5 | 0.18% | 0.4% |
| 230 | 25.5 | FINAL MILE | 25 | 25 | 7.07% | 6.9% |

Across all eight: **1029 on-screen units, 79 carry a wave material (7.7%), 78 of
those actually move.** The amplitude work is sound -- of everything that was
given a wave material, essentially all of it clears the perceptibility floor.
**The problem is not amplitude. It is coverage.**

**The FINAL MILE is the proof that the system works.** Bunting at 32 px
peak-to-peak at 18.6 units, grandstands at 18 px, 7.1-8.5% of the frame alive (it varies run to run with
what the pools have claimed). That
is what the rest of the race is being measured against, and it is the same
shader everywhere else.

*Instrument caveat, stated because it changes one headline:* `liveness.js` sees
vertex animation only. Freezing `performance.now` is what makes the measurement
clean and it also switches off the cloud sheets, the telegraph strip and
**the river ripples** (`world.js:13973`, 1.90 units/s across the deck, written
inside `api.update`). So THE BRIDGE at 0.00% means **no moving object**, not a
motionless frame -- the water under it is scrolling throughout. Read every
figure here as "how much of the scenery moves".

### Findings, in the order a player meets them

**1. THE BRIDGE has no moving scenery of any kind, and THE WALL has almost
none. Together, ~37% of the race.**
THE BRIDGE (miles 8.7-13.1) and THE WALL (18.9-24.1) are 9.6 of 26.2 miles.

This was checked against BOTH animation systems before being claimed, because
`liveness.js` is blind to CPU transform animation and would have overstated it:

| | vertex movers | crowd knots | walkers | verdict |
|---|---|---|---|---|
| skip 95 THE BRIDGE | 0 | 0 | **0** | nothing moves |
| skip 110 THE BRIDGE | 0 | 0 | **0** | nothing moves |
| skip 178 THE WALL | 5 | 3 | 3 | 0.16% of frame, plus 3 walkers |
| skip 200 THE WALL | 5 | 2 | 2 | 0.18% of frame, plus 2 walkers |

**THE BRIDGE is the strong finding: no swaying object, no crowd and no walker
is live at either sample point.** The only motion in the frame is the river
texture scrolling underneath and the clouds. THE WALL is the weaker one and
should be quoted honestly -- it has two or three walkers drifting across the
pavement, which `liveness.js` cannot see, on top of 0.16-0.18% of the frame.
THE WALL is described in its own source as *"a leg with no crowd and no
colour"* (`world.js:12875`). At record pace this stretch is roughly forty
minutes of a two-hour run. **Cost to fix: 0 draw calls** -- see finding 2, which is
most of the fix for THE WALL, and the bridge wants a moving object of its own
(a boat on the river below, a gull, bunting on the parapet); one merged pooled
object is +1 draw.

**2. The two most-seen pieces of vegetation in the game cannot move.**
`LIT_EDGES.hedge` (`world.js:6138`) bakes both the clipped hedge and **the
avenue** -- four broadleaves per tile at x 7.95 -- into the road tile's own
merged geometry, which is drawn with `mats.edge` (`world.js:6354`), a plain
`vtoon(2)` with no wave chunk. `world.js` says of these exact objects: *"THIS IS
THE TREE THE PLAYER SEES MOST"* (`:6064`) and the hedge is *"the largest
continuous area of foliage in the game -- two rows the full length of every
PARKLAND and RIVERSIDE tile, nearer the lens than any pooled tree"* (`:6039`).
About a hundred avenue trees are live at once, every one nearer the camera than
any tree that does sway, and not one of them can move. This is the single
largest liveness defect in the game and it is why PARKLAND measures 0.38%.

**Cost: 0 draw calls.** The fix is the pattern the file already uses -- swap
`mats.edge` to `vwind(2, undefined, WIND_F_LEAF, WIND_A_LEAF)` and tag only the
hedge cap and the crown lobes with `wv()`; everything untagged carries amplitude
0 and stays rigid, exactly as trunks and masts already do. Same merged geometry,
different ramp -- the precedent is `aa5155f`, which flew the bunting for no
extra draw. One extra shader program and 8 bytes/vertex on tile geometry.
*Corridor check, because the tree pool needed one:* the avenue crown reaches
5.35 from centre against `CORRIDOR_HALF` 3.75, so 0.40 of sway leaves 1.20 of
margin. The hedge body's inner face at 4.60 leaves 0.45 -- tighter, and
`tools/motion.js` CORRIDOR should be re-run against it rather than assumed.

**3. Every flag in the game flutters like a person, not like cloth.**
The grandstand roof flags (`world.js:12061`) and the finish backdrop flags
(`:12426`) are `wv()`-tagged parts on `mats.crowd` -- the **human-body** wave.
They take the crowd's vertical formula (a spectator standing up and bouncing,
`0.30*exc + (0.05 + 0.26*exc)*|sin|`) and its 5.7 rad/s lateral rock, and they
are driven by `uHot` and `uZ`, so a flag's motion depends on **how well the run
is going** and dies away from the runner. `mats.cloth` exists for precisely this
(`WIND_F_CLOTH` 11.30 rad/s, 1.80 Hz) and is used at exactly one site in 15,561
lines, the finish chute (`:12194`). **Cost: 0 draw calls** if the flags are
split into the geometry already merged for cloth, or +1 draw per stand if not;
the honest estimate is 0-2 draws total.

**4. Static vegetation in the landmark pool.** `oak` and `pond`
(`world.js:12937-12938`) are whole trees and fourteen reed clumps
(`:12849`) on `mats.prop`. A named landmark oak that stands dead still
beside pooled scatter trees that sway is worse than either alone, because the
contradiction is visible in one frame. The aid-station pennant is explicitly
authored *"movement-free"* (`:11435`). **Cost: 0 draw calls**, material swap,
same argument as finding 2.

**5. Clarity has regressed on the late legs and improved on the early ones.**
Re-measured HUD-off at 620x1344, **date pinned to 2026-08-07 so the course is
the same one the clarity pass measured** -- without that pin the comparison is
between different legs, since the course regenerates daily.

| near-band edge % | clarity pass | today | vs Subway Surfers 9.3-12.7 |
|---|---|---|---|
| skip 25 CITY START | 9.6 | **7.1** | below band |
| skip 110 | 11.2 | **8.8** | below band |
| skip 178 THE WALL | 12.9 | **19.1** | **50% above band** |
| skip 185 THE WALL | 11.6 | **16.8** | **32% above band** |

The pass brought all four inside the reference band; they have since split apart
in both directions. The two legs that got busier are exactly the legs that
gained the most scenery after 2026-08-08 01:30. *"Clarity over complexity"* is
not being served at 19.1 -- that is past where the original "we are busy"
finding sat. Saturation remains the standing gap: near-band 0.313 mean against
Subway Surfers' 0.465, **33% below**; whole-frame 0.300 against 0.468, 36%
below. Better than the 40-50% on record, still the largest single difference
from the reference.

**6. One navy is doing about twenty-five jobs.** `0x2b2f52` appears **72 times**
in `world.js`, nearly double the next colour (`0xffe45e`, 40). It is worn by
lamp and telegraph posts (`:5994`, `:6311`), the verge line (`:6018`), bench
legs (`:6058`), **spectators' trousers and legs** (`:11004`, `:11082`,
`:11857`, `:11893`), aid-table legs (`:11398`), the overpass soffit (`:11540`),
footbridge parts (`:11590`), grandstand decks and masts (`:12057`), bunting
catenary (`:12170`), the crane (`:12758`), hoarding posts (`:12880`), the jumbo
truss and its flag masts (`:12909`), mile-banner gantry legs (`:13018`) and the
finish arch legs (`:13075`). The file knows: `:12273` says the finish-tape posts
began as *"the same `0x2b2f52` navy the rest of the roadside furniture wears"*
and were changed **because at forty units they were not there at all.**

This is the measured cause of the reported blind-read failures. An independent
blind reader on `origin/blind-read-pass2` recorded, without prompting: *"Rows of
short pale posts with dark blue tops along both verges. Bollards, or the tops of
a low barrier fence"* (`BLIND-READ.md:135`) and *"A tall flat blue slab on the
right, beyond the kerb. Reads as a building face or a hoarding/billboard seen
edge-on. It is featureless"* (`:133`). A spectator at distance is a navy
trouser-block over a shirt; a verge post is a navy block. Same value, same
width, same vertical aspect -- so they are the same object to the eye.
**Cost: 0 draw calls.** Vertex colour on already-merged geometry; the entire
change is authored hex. The rule to apply is the one the tape post already
proved: **furniture and people may not share a value at the same size.**

### What I did not settle

- **The "slate-blue angular slab with a dark navy base on the grass bank"** is
  not identified with confidence. The best candidate is `hoardingGeo`
  (`world.js:12877`), whose poster elements all sit at x <= -0.95 in front of a
  bare `0xf6f2e8` panel whose **rear face carries nothing** -- a rule-1 concern
  worth a frame from behind before anyone acts on it. I did not shoot that
  frame; it should be shot rather than argued about.
- **The scroll layer is unmeasured.** Clouds, ripples and the telegraph strip
  need an instrument that advances `performance.now` while holding the
  simulation. `liveness.js` cannot be that tool without giving up the isolation
  that makes its own numbers trustworthy.

## Environment liveness: what the audit asked for, built and re-measured 2026-08-09

The pass the section above was written to commission. Scope was `world.js` and
`shading.js`; `shading.js` needed no change in the end, which is itself the
finding -- every fix below is a material swap, a `wv()` tag or authored hex.

**Full gate green** (`build`, `shoot`, `course-test`, `simulate`), plus
`calendar.js`, `kindread.js` at 1 of 21 on profile (baseline, not regressed),
`liveness.js` and `motion.js`.

### The headline

| | before | after |
|---|---|---|
| on-screen units carrying a wave material | 81 of 1011 (8.0%) | **159 of 1009 (15.8%)** |
| of those, actually moving | 80 | **137** |
| live share of scenery pixels | 6.1% | **20.5%** |
| mean frame-changed over eight legs | 1.41% | **2.78%** |

Per leg, `frame-changed` -- the whole-frame diff over one gust period with only
the wave clock advancing:

| skip | leg | before | after |
|---|---|---|---|
| 25 | CITY START | 0.63% | **1.31%** |
| 60 | RIVERSIDE | 1.87% | **6.00%** |
| 95 | THE BRIDGE | **0.00%** | **0.71%** |
| 110 | THE BRIDGE | **0.00%** | **0.61%** |
| 140 | PARKLAND | 0.38% | **3.72%** |
| 178 | THE WALL | 0.17% | **0.55%** |
| 200 | THE WALL | 0.17% | **0.72%** |
| 230 | FINAL MILE | 8.10% | **8.67%** |

**Cost: 0 draw calls.** Measured leg for leg at the chase framing, before then
after: 192/205/168/164/227/255/221/208 becomes 192/203/168/162/227/255/220/208
-- inside the run-to-run variation of what the pools have claimed, against a
~400 ceiling. Triangles rise by 0 to 3,900 a frame depending on the leg, and
the heaviest frame in the sweep goes 278,639 -> 281,051 against a 500,000
ceiling. Three extra shader programs: two wind materials for the roadside tiles
and one extra branch in the crowd wave.

That is the whole argument for doing it this way. A half-built mesh and a full
one cost the same draw call, and a rigid material and a waving one cost the
same draw call -- so every item below spends the abundant resource and none of
the scarce one.

### What was built

1. **`mats.edge` split into `edgeLeaf` and `edgeCloth`.** One plain `vtoon(2)`
   was shared by all four roadside tile kinds, which is the single structural
   reason the roadside was rigid. They now split by what moves on them and by
   nothing else, and both take the identical per-setting tint so they stay one
   family of surfaces. `mats.edge` no longer exists.
2. **The avenue and the hedge move** (`edgeLeaf`). The four broadleaves per
   PARKLAND/RIVERSIDE tile take full `WIND_A_LEAF` on the crown lobes with the
   stem and both limbs rigid; the hedge takes 0.45 of it on the CAP ONLY, with
   the body rigid -- a corridor number, not a taste one, since the cap's inner
   face is at 4.54 against `CORRIDOR_HALF` 3.75 and full amplitude would have
   left the tightest margin of any moving thing in the game. This is the single
   biggest item in the pass: PARKLAND 0.38% -> 3.72%, RIVERSIDE 1.87% -> 6.00%.
3. **THE BRIDGE gets deck banners** (`edgeCloth`) on the parapet lamp
   standards, hung outboard. It is the only cloth a bridge is allowed -- NOT
   bunting, which stays reserved for the finish chute -- and it is the leg's
   only colour. 0.00% -> 0.71%/0.61%.
4. **The barrier tile's sponsor banner bellies between its posts, and the
   lamp-post banner swings** (`edgeCloth`). CITY START and the FINAL MILE share
   this tile, which is also why the obvious fix for CITY START -- street trees
   in the verge -- is wrong: the FINAL MILE grandstands stand at x 5.05 and a
   tile-baked tree would be inside them.
5. **THE WALL gets debris netting on the top lift.** One large soft mass, not
   more small tubes: it raises liveness and saturation without raising edge
   density, which is the distinction "clarity over complexity" turns on. It
   deliberately does not cover the open scaffold bays, whose sightline is the
   thing keeping that leg from being a trench.
6. **`CHEER.FLAG`, a sixth behaviour in the crowd wave.** Every flag in the
   game either stood still (the FINAL MILE roof flags, untagged) or flew on the
   crowd's body formula -- which is scaled by `exc`, built from `uHot`, so
   **flags flew harder when the run was going well**. Splitting them onto
   `mats.cloth` costs a draw call per stand and stands are pooled one per tile
   down both shoulders, so the fix went in the shader: `aWave.z = 5` runs the
   cloth rates on the same attribute and the same merged geometry with no
   `exc` term. It does not grow `WAVE_ENVELOPES` -- 0.130 lateral against the
   crowd's 0.132, 0.024 vertical against 0.543, no z term -- so `motion.js`
   needs no re-basing and no envelope was inflated.
7. **Flags are banded, and that is load-bearing.** A merged part carries ONE
   baked amplitude for all its vertices, so a single-box flag translates whole
   and slides along its own mast. Every flag here is three bands sharing a
   phase, with the band on the mast held to 0.30. Same phase deliberately:
   neighbouring bands on different phases reach opposite extremes and open
   daylight at the joint, which is the forearm-comes-off defect again.
8. **The oak and the pond reeds are on `mats.leaf`.** The biggest tree in the
   game stood still beside pooled scatter trees that swayed.
9. **The hoarding has a back.** See below.
10. **The crowd is off the furniture's navy.** See below.

### The hoarding: shot, not argued

The audit left this open and said it needed a frame from behind. It was shot,
four azimuths through the game's own renderer and lights, and the audit's
suspicion was exactly right: **the rear was one unbroken 0xf6f2e8 rectangle,
7.2 x 16.4, 118 square units of blank cream** with every poster element on the
far side. It is now a galvanised skin, two channels and a stiffener, a pair of
raking braces, the maintenance catwalk with its handrail and a ladder up the
near post -- about 240 triangles, no extra draw.

**And the first attempt at it was wrong in the mirror-image way.** Authored in
the works hoarding's own greys, the new rear photographed as one near-black
rectangle: the same featureless-plane defect with the sign flipped. This face
points away from the key light, so it is authored two steps up and its members
separate by VALUE rather than by hue. **A rear elevation has to be authored for
the light it is actually in, and the only way to know is to shoot it.**

### One navy doing twenty-five jobs, ended for the people

`0x2b2f52` stays on the furniture -- lamp posts, gantry legs, parapets, the
crane -- and comes off every person in the game. The rule applied is the one
the finish-tape posts already proved: **furniture and people may not share a
value at the same size.** Through `shadedL`, spectator legs went from 36-52
against furniture at 36, to **71-105**; the walkers' workwear to 66-78; the
marshal's uniform to a blue that is not the post beside it. Three duplicate
trouser palettes became one module-scope `TROUSERS`, because three copies of a
palette drift -- which is exactly how the avenue kept a hard-coded green
through two palette passes. Zero draws, zero triangles, authored hex only.

### Clarity: measured, and the audit's table could not be reproduced

The audit reported near-band edge density split apart -- early legs at 7.1-8.8
below the reference band and THE WALL at **19.1**, "50% above band" -- and
concluded two legs needed more and one needed less. **Re-measured at the same
framing, that is not what the frames say.** Near-band edge %, HUD off, 620x1344:

| leg | measured | Subway Surfers band 9.3-12.7 |
|---|---|---|
| CITY START | 7.5 | below |
| RIVERSIDE | 7.9 | below |
| THE BRIDGE | 7.3 | below |
| PARKLAND | 7.4 | below |
| THE WALL | 6.3 / 7.9 | **lowest in the game** |
| FINAL MILE | 11.7 | in band |

No leg is above the band and THE WALL is the sparsest, not the busiest. Nothing
in this pass reproduced 19.1 under any combination of date, boot flag or build.
**So the decision per leg was: declutter nothing, and add only large soft
masses.** Saturation is the real gap and it is worse in the near band than the
whole-frame figure suggested -- 0.157 at THE WALL against a reference 0.41-0.51
-- so every addition here is a big saturated shape (netting, banners, crowns)
rather than more small hard-edged detail. That is also the reading of
"prioritize clarity over complexity" this pass acted on.

**Re-measured after, and the decision held.** Near-band edge density moved by
at most 0.4 anywhere (7.4/7.4/7.3/7.8/6.3/7.6/11.7 against
7.5/7.9/7.3/7.4/6.3/7.9/11.7), i.e. nothing got busier where the player looks.
The gains landed where the geometry did: THE WALL's far band went 0.244 -> 0.264
and 0.314 -> 0.321 saturation with its edge density FALLING 7.3 -> 7.1 and
6.9 -> 6.4. **More colour and less edge in the same band is the outcome the
"clarity over complexity" tie-breaker was supposed to produce**, and it is the
reason the netting went on the top lift as one sheet rather than into the bays
as more tubes. The near-band saturation gap is untouched by this pass and
remains the largest single difference from the reference.

### THE INSTRUMENT DEFECT THAT COST THE MOST TIME HERE

**`?skip` is SECONDS OF SIMULATED RUNNING, not distance, and the leg it lands
on depends on the day's course AND on the boot flags.** `liveness.js` and
`motion.js` boot with `?bot=1`; a screenshot harness that does not gets a
runner who takes hits, travels less far, and lands on a different leg. On this
build, skip 178 is THE WALL at mile 19.5 with `bot=1` and PARKLAND at mile 16.3
without it. Neither tool prints the leg it measured, so both tables' leg labels
are attached by hand afterwards and cannot be checked.

This cost an hour and produced one wrong conclusion that had to be retracted
mid-pass ("the audit's labels are wrong" -- they were not; mine were). It is
also the likeliest explanation for the 19.1 that could not be reproduced: a
clarity frame shot without `bot=1`, or on a pinned date, is not the leg the
liveness table beside it is talking about.

**The fix, for whoever touches these tools next: print the leg.** Three lines
in each tool -- read `MR.Course.biomeAt(MR.game.pace.units / MR.K.TOTAL_UNITS)`
after boot and put the name in the row. A table that labels itself cannot be
mislabelled, and until it does, every per-leg finding in this file's liveness
sections is one boot flag away from being about a different leg.

### A pre-existing `motion.js` failure, and it is the instrument

`motion.js` reports **1 assertion failure on this build and 1 on the committed
baseline** -- the same one, at the same place:

```
FAIL READBAND  prop / tree ndc x [-71.26,-0.13] overlaps kind 2 lane 0 at 39.7u
```

Checked against `HEAD:index.html` through `--file` before anything was claimed
about it: the baseline gives `ndc x [-97.66,-0.13]` for the same tree at the
same skip. **This pass did not cause it and does not fix it.**

It is an artifact. NDC x is bounded by -1..1 for anything in front of the lens,
so -71 and -97 are what a bounding-box corner BEHIND the near plane projects
to. The tool grows every mover's AABB by its wave envelope and projects the
eight corners without clipping, so any mover that draws alongside the camera --
which a roadside tree does on every pass -- reports a screen rect spanning the
whole frame and overlaps everything in it, including a gate 40 units away that
it is nowhere near on screen.

It is day-dependent, which is why the audit above recorded the gate green: it
fires only when a tree is claimed close enough to come alongside. **The fix is
in `motion.js`, not in `world.js`: clip the box to the near plane before
projecting, or drop any corner with w <= 0 and skip the mover if none survive.**
Left for whoever owns that tool; changing an assertion to make one's own pass
look clean is the thing this file exists to prevent.

### Two further limits of `liveness.js`, found by using it

- **A moving part INSIDE a large merged unit reads as travel 0.00.** The tool
  takes silhouette edges, so the sponsor banner on a road tile and the netting
  under the wall's top scaffold tube -- both interior to their unit's outline
  -- report p90 0.00 AND max 0.00 and are counted "inert". They are not: the
  whole-frame diff at CITY START moved 0.63% -> 1.31% on that banner alone.
  For merged tile geometry, `frame-changed` is the honest number and the
  per-unit travel column is not. This is a sixth defect for the header's list.
- **`px-area live` inflates for tiles.** It credits a unit's whole screen area
  as live when any part of it moves, so a road tile with one moving banner
  counts its entire 33,000 px. Read it as an upper bound.

### Still open

- **The scroll layer is still unmeasured** -- clouds, river ripples, the
  telegraph strip. Unchanged from the audit, and still needs an instrument that
  advances `performance.now` while holding the simulation.
- **THE WALL remains the least alive leg** at 0.55-0.72%, up from 0.17% but
  four to twelve times behind every other leg. It is a leg deliberately built
  with no crowd; whether it should stay that way is an owner decision, not a
  build one.
- **THE BRIDGE at 0.61-0.71% is a floor, not a finish.** The deck banners are
  the only thing out there that can move without inventing a roadside the leg
  is designed not to have. A gull or a boat under the span is the next idea and
  it costs a draw.

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

   **And this correction was itself wrong, which is the part worth keeping.**
   204-211 was the TOP of a range read as though it were the figure, and the
   camera moved twice after it was written. Measured properly he is
   **163-208px at 390×844 and 50-67px in landscape**. So the file's history now
   runs 110 → 204-211 → 163-208, and only the third was ever measured with an
   instrument rather than derived from a frame somebody looked at. A correction
   is not automatically better than what it corrects; `tools/figure.js` exists
   so the next one does not have to be believed either.

   The removals argued on the bad number were re-judged with `tools/resolve.js`
   and **all four stayed out — three of them for reasons entirely different
   from the ones recorded**, which is the same outcome as the triangle budget:
   the conclusion survived and the reasoning did not. `resolve.js` had three
   defects of its own before its output was believed, all flattering: a colour
   tolerance that let the yellow probe match TRIM and the red probe match the
   vest (1084 pixels over a 323×773 box, for a cylinder 0.024 tall); probes
   multiplying across both sides and across the record ghost, 22 meshes where
   6 were asked for; and capped cylinders counting a disc that would be buried
   inside the shorts. The polish-identity harness had a fourth: stepping to a
   target phase lands within one step of it and where inside that step depends
   on the phase the page was at when the loop was frozen, which held the noise
   floor at 3.8e-2 on a shoulder quaternion — coarse enough to have "proved"
   almost anything bit-identical. Pinned, the floor is 3.4e-13.
5. **The LOD justification** — "past a hundred units a spectator is under a
   pixel wide". Projected properly: 4.0px at 60 units, 1.9px at the swap
   distance.
6. **The stride instrument was wrong SIX ways, every one of them flattering.** Its contact
   sheets were not contact sheets — `setViewportSize` fires a resize, the game
   repaints the full canvas, and that repaint lands on whichever view renders
   first, so every "behind" sheet was a single wide panorama. One was committed
   to `reference/` and described to the owner as a contact sheet. Its skate
   floor divided one foot's travel by both feet's contact window and was 2×
   pessimistic, which was then passed to an agent as "a bound you must not
   fight". And it tracked the head at the neck pivot, turning a 1.22× gain into
   a reported 4.2×.

   Then stage 2 found two more. Its contact sheets posed the rig with
   `update(0, …)`, and `dt = 0` means the secondary-motion integrator steps by
   zero — the hood read an identical −0.010023 in all twelve tiles. **No
   contact sheet this tool ever produced could show secondary motion**, which
   is the entire subject of the stage the sheets were meant to judge. And
   `handL` was tracked at the *elbow pivot*, a child of the shoulder that no
   elbow rotation can move: every hand figure this project has printed was a
   shoulder figure, including `0.2533 → 0.3010`, quoted to an agent as
   evidence for the arm work. The mitt's real travel is 0.4031 → 0.4480
   vertical and 0.5474 → 0.6502 fore/aft.

   Then stage 3 found a sixth: the sheet half settles before it renders, the
   *measurement* half did not. The page runs ~600 ms of real game before the
   tool re-poses the rig at lo/mid/hi, and any filter driven by the *history*
   of a value rather than by the posed value reads that jump as a real event.
   Harmless until a term was driven by the derivative of `speed` — then chest
   fore/aft came back **3.3× inflated**, 0.0264 against 0.0080.

   Six defects, found by four different agents, none by me, and every single
   one made the work look better than it was. **An instrument nobody audits is
   not a measurement, it is a preference with decimal places** — and the
   corollary is that the reviewer's own tools need a reviewer.

9. **I briefed a rear-only detail budget for the fleet.** The argument was
   that the chase camera only sees the back of an obstacle. You pass obstacles:
   a hazard in the next lane goes by 1.70 units from a camera 4.35 back at a
   61-72 degree field of view, the camera banks through every lane change, and
   background traffic shows every face within seconds. And the trade did not
   exist -- a rear-only mesh and a fully-built mesh cost the SAME draw calls.
   Now rule 1 of `CLAUDE.md`, and it applies to everything in the game.

10. **My tree stand-off fix was not rotation-invariant.** I used the larger of
   a merged box's x and z extents as the radius, on an object the claim site
   yaws randomly -- up to 41% short. Now the circumscribed radius. Found by
   `motion.js` when it was taught to see shader movers.

11. **The ink shell never moved with what it wrapped.** `outlined()` builds the
   silhouette from a separate material reading `position` directly, so every
   spectator in the game has been inside a rigid ghost of its rest pose since
   the crowd wave shipped -- and because the shell draws exactly at the
   silhouette, it was *masking* the animation.

12. **I told an agent the game had "a far carriageway in some biomes and a
   light-rail track in others".** It has neither. The four edge kinds are
   barrier, hedge, rail and wall; `rail` is the bridge's parapet and `wall` is
   THE WALL's site hoarding. No traffic surface has ever existed here.

13. **Two shipped constants were derived from numbers nobody had measured.**
   `camera.js` normalised its acceleration cue by 3.2, on a header claim that
   streak-driven acceleration reaches "~4 u/s²". Measured on the smoothed
   signal the file actually uses, 7,460 samples of real play: **+0.702**. So
   the cue named "surge" was capped at 0.219 of full scale while a contact
   reached 0.415 — what shipped as an acceleration cue was in practice a hit
   cue. And `runner.js`'s note on arm abduction read as though abduction set
   the run's half-width; asked which vertex is actually widest at top pace,
   the rig answers the chest, then the head. The elbow is inboard of both.

   Both are the same failure as the triangle budget and the 110px runner: a
   number written into a comment, believed, and then built on.

14. **Nothing had ever compared the art with `MR.Collision.BOX`.** The box is
   called the contract in rule 4 and in three file headers, and until the fleet
   rebuild no assertion anywhere measured a variant against it. It had no
   `halfX` at all -- the ART FILE was writing the audited width, as
   `LANE * 0.5` -- and the brief that flagged that hole argued it was harmless
   because "the widest art is 1.56". Measured: fourteen of seventeen variants
   past 0.85, widest static 1.148, a moving part sweeping to 1.865, a hoarding
   0.29 over the height ceiling, four JUMP faces and a DUCK cap outside their
   own half-depths, and a headlamp core 0.035 past the plane its own comment
   called a limit. Six defects, none of them visible in any frame, all of them
   in the direction that makes `BLANKS` under-count occlusion.

   And the number the guard was written against was stale too: `HAZARD_HALF`
   claimed to be "the widest point of any hazard" and was 0.03 inside it.

   The lesson is the one at the top of this list with a new edge on it: **a
   contract with no assertion is a comment, and the file that owns the numbers
   is the last place that will notice.**

18. **A sub-assembly was rotated and its LAYOUT LOOP was not.** `stoneArch`'s
   downstream viaduct ran four arches through the play corridor -- 51
   triangles at road level, `LOW` plus two `HIDES`, on every one of the ~72
   days it drew, in shipped code.

   `vArc` builds its ring in the x-y plane, so a viaduct steps its arches
   along X, the span axis. This stepped `cz`, the extrusion axis. `placeAt`
   then rotated the assembly by PI/2, and **every other member had been
   authored for that rotation and agreed with it** -- the deck is 72 along
   local x, the piers are pushed unrotated to world x -34 and step along world
   z. One loop was on the wrong axis, so its arches marched from world x -64
   to **-0.5** while their own deck and piers stayed at -34.

   Two things worth keeping. **The piers were the proof**: put the centres back
   on x and the arches land at world z ±30, ±10 leaving 2.8 between extrados,
   and the piers are 3.0 deep at exactly those gaps. The geometry had always
   been designed for the correct layout, so the fix was one word and the
   internal evidence for it was already in the file. And **the number it
   produced had been quoted as a budget**: a refusal elsewhere in `world.js`
   cited "stoneArch reaches |x| 67.5" as evidence the bridge flank was full.
   67.5 was not a design reach, it was this defect measured. Same family as
   `HAZARD_HALF` -- a wrong number becoming load-bearing somewhere else before
   anyone checked what produced it.

   It shipped because `shoot.js` photographed one date. The general lesson is
   the one already at entry 8: **an assertion that passes tells you about the
   property it tests and nothing else** -- here, about the day it was run on.

15. **Counting source hex is not measuring colour.** The accent item counted
   `#ffe45e` 43 times in `world.js` and concluded the HUD's semantic accent
   had leaked into the world. Counted in PIXELS instead, on shipped frames
   with the UI hidden, the world puts **zero** accent-coloured pixels on
   screen at every gameplay skip: it is all lit, and lit it renders 16 per
   channel away. The only near-accent pixels in a whole frame are 78 on the
   runner's headband and midsoles.

   Same class as the 110px runner and the triangle budget, with a new edge:
   **the source is not the frame, and a palette is a claim about the frame.**
   The one place the two genuinely collide was invisible to the hex count and
   obvious to the pixel count -- the finish confetti, which is unlit and so
   lands on the hex exactly.

16. **Nobody had looked at the DRAW.** The repetition review measured the
   right thing (64.8% of windows carrying a repeat), correctly identified the
   right kinds (DUCK and JUMP, not the fleet), and prescribed the expensive
   half. `variantIndex` was a good hash and had itself been a correction to a
   worse one -- and a good hash is an INDEPENDENT draw, which is exactly the
   property that produces runs. A dealt bag at the OLD variant count (38.1%)
   beats an independent hash at three more variants than the game has
   (43.4%). Two more skins bought 3.5 points; changing the draw bought 25.

   **The lesson is not "measure things" -- the measurement was right. It is
   that a measurement of a SYMPTOM does not name its mechanism, and the
   mechanism here was one function nobody had questioned because it had
   already been fixed once.**

17. **`collision.js` says the runner is 1.78 and `MR.Runner.HEIGHT` is 1.60.**
   Found while checking whether two DUCK variants whose art hangs 0.02 below
   the box floor could clip a ducking player. On the commented number the head
   at the duck threshold reaches 1.402 against a bar at 1.41 -- 0.008 of
   clearance, and the art would have been inside the player. On the real one
   it reaches **1.222**, so the clearance is 0.188 and the art is fine.

   The suspicion was wrong and the comment is still wrong, in the direction
   that makes the game look **tighter** than it is -- which is the rare
   flattering-in-reverse case, and is why it survived. Not fixed here:
   `collision.js` is not this pass's file. Fourth entry on this list of the
   form "a number written into a comment, believed, and then built on".

7. **Three consecutive diagnoses of R2**, each confident, the first two false:
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
8. **The `git add -A` ban was the wrong rule** and cost four sweeps before
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
8. **"It obeys the corridor rule, so it is free."** Every piece of overhead
   structure in the game cleared `OVERHEAD_Y` and was audited for it on every
   `shoot.js` run, and the audit was *correct*: none of it could ever hide a
   hazard, because the eye is below it and looking down. So it was allowed to
   grow to 14.32 crossings per 100 units of road — one every seven units, three
   a second — while the thing it *was* hiding, the signage that lives in the
   same band, had no assertion at all. 57% to 100% of every MILE sign's own
   panel was behind something and nothing in the toolchain said so.

   The gantry was also drawing its own X-braces across its own sign face:
   braces at z = 0 and a sign plane at z = 0, coplanar, z-fighting, for as long
   as both have existed. Visible in one 4× crop and invisible in every diff.

   The lesson: **an assertion that passes tells you about the property it
   tests and nothing else.** A rule that only ever asks "can this hide a
   hazard" will happily let the frame fill up with everything that cannot.

19. **A brief indicted six objects and the sheet exonerated four of them.**
   The pass that rebuilt the JUMPs and DUCKs was commissioned on the claim
   that "every JUMP is a slab with a striped face on the front and nothing
   anywhere else. v0 is literally a box." Photographed at az 0 / 90 / 180 /
   270 before anything was designed, that is false for five of the six: v1's
   cones, v3's scooters, v4's three moulded modules and v5's drum are
   through-objects and read as themselves from every azimuth, and v4 was the
   best-built hazard in the game from behind. v0 was the one that matched the
   description, and the plinths v1 and v3 share with it.

   The same brief said "two variants are short of the 1.6x / 0.30 target and
   were refused with lever tables last pass; re-measure before assuming
   which." Measured: **none of the eleven JUMPs and DUCKs is short of target**,
   on any shot, and the two that are short are BLOCK v3 and v8. That
   instruction is the only reason the wrong pair was not carried forward, and
   it is worth copying into the next brief that quotes a number it did not
   take.

   What the sheet found instead was **the DUCKs**, and it found it harder than
   the brief did: at az 180, v0, v1 and v2 photograph as ONE object -- a flat
   bar between two flat posts -- because every feature those three own is on
   the face they turn toward the lens at spawn. Same family as the accent-hex
   count at entry 15: **the source is not the frame**, and a claim about what
   an object looks like is a claim about a photograph somebody has to take.

20. **The DUCK is exempt from the y half of the envelope guard, so art above
   the bar has never been policed at all.** `fairness.js` fails `yMax > boxYMax`
   for JUMP and BLOCK and only reports it for DUCK, and the reasoning is sound:
   the DUCK box is the BAR, 1.41 to 1.83, and the frame carrying it legitimately
   reaches 3.5. But the exemption is written against the whole variant's bounding
   box, so it swallows everything -- and `duckPipeGeo` had a comment naming two
   real overhangs it declined to fix, "the same two-hundredths v1 and v2 already
   carry and which nothing in the toolchain reads."

   Measured, there were three: v1's cap ran to 1.85 and its boarding down to
   1.39, and v2's bands ran to 1.86 and 1.39. All are now on the number. The
   HOLE is not closed and cannot be by the assertion in its present shape: a
   single bounding box cannot tell the bar from the gantry. Closing it needs
   the y extent measured over the LANE CORRIDOR only -- art inside the band the
   ducking runner and the chase camera share -- which is a different question
   from the one `fleetExtents` answers today.

   Third time on this list of the form "a comment named a defect and nothing
   failed": the `HAZARD_HALF` drift, the coplanar gantry braces, and now this.
   **A guard with a documented exemption is a guard with a documented blind
   spot, and somebody has to go and look at what grew in it.**

21. **Every instrument the fleet had was an orthographic camera the builder
   chose.** `contrastAudit`, `fleetSheet` and `tools/orbit.js` all photograph a
   variant through an ortho lens at an azimuth, framed so the object fills the
   tile. That is the right instrument for an area mean and the wrong one for
   every question about READING, and the fleet rebuild was verified on it at
   az 0 / 45 / 90 / 135 / 180. At 45-135 the fleet is genuinely good. The game
   never shows those angles. The owner looked at the shipped build and said
   *"I don't see any of these adjusted."*

   **Fourth time on this list of verifying at a framing the game does not
   use** -- after the silhouette sheet that normalised ten variants to one
   rectangle, the stride sheet posed at `dt = 0`, and the runner detail budget
   judged at 110px on a figure that is 163-208px. The fix is a committed tool,
   `tools/framing.js`, which snapshots the LIVE chase camera after its springs
   settle and renders every tile through a clone of it, cropped 1:1 out of the
   real 390x844 frame at 8 / 12 / 20 / 35 units. Scaling a tile to fill its
   cell is the defect it was written to correct and is not an option on it.

   It also counts what the pixels are MADE of, and that is what turned an
   impression into a brief. `merge()` writes one flat colour per authored
   part, so the merged colour attribute is already a part map: re-render with
   those hexes replaced by category colours through the same camera with the
   same depth test, and the counts sum to the real silhouette. What it found:

   - **The five variants the rebuild reached carry 30-42% of their pixels in
     small structure. The five it did not carried 7.7-27%**, and one flat pink
     cube was 57.7% of the moped. The rebuild was organised around growing
     bodies into a new 3.90 envelope, so the five that were correctly SHORT --
     moped, trike, cyclists, marshals, hoarding -- had no growing to do and
     silently kept their pre-rebuild construction.
   - **The cargo trike's three wheels owned 0.0% of its pixels at every
     distance.** All built, all rimmed, all hubbed, and the load box was parked
     between the lens and its own axle for the whole approach. The comment
     above that loop had named the stake exactly -- "if they read as three dark
     smudges the whole vehicle is a floating crate" -- and was wrong about the
     state, because nobody had counted.
   - **The hoarding's beacons were inside its own coping**, 0.21 of their 0.30
     buried, and rebuilding them in place made it worse (1.1% to 0.3%) before
     the number said to move them outboard.

   Same family as entry 15 and entry 19: **the source is not the frame.** The
   new thing here is that a part can be present, correct, expensive and worth
   exactly nothing, and only a census in the shipped projection says so.

22. **A white race number failed the build.** The cyclists got numbers pinned to
   their backs and pale shoes on their pedals -- 7.2% of the object in
   near-neutral `PLATE`. Area mean went L 91.3 / S 0.472 to L 98.7 / S 0.387:
   luminance UP, chroma down 0.085, and `dS` against the middle lane fell
   through the 0.22 gate to 0.209. `shoot.js` failed it.

   That is the fleet header's own cream mechanism arriving by a **third** door,
   after the cream bands and the glass flash, on the one variant with no room
   for it -- and the rule it broke is written four hundred lines above the
   change: the pale element on a warm body is the plate and the lamp cores and
   nothing else. `0xfff23a` is 91% of cream's luminance at eight times its
   chroma and is the substitution the whole fleet already made.

   Worth keeping because the failure was **invisible in the sheet**. The
   numbers read beautifully; only the audit knew.

23. **The owner looked at our people and named different people, and that is a
   measurement.** They asked for the "cops, taxi drivers, and other people who
   appear as obstacles" to be improved. This game has no police and no taxi
   drivers. What it has is race marshals, two road cyclists, a cargo-trike
   rider, a delivery moped rider, spectators and pavement walkers.

   The correction everyone reached for -- "there are no cops, they meant the
   reference game" -- is the wrong one. The owner's reply settles it: *"This
   paragraph above is exactly why this needs to happen. I can't even tell what
   they are."* A misidentification is not a missing-detail report. It is a
   testable failure, and unlike "make them more human" it has a pass mark.

   So the pass was judged by **showing 1:1 crops through the live chase camera
   to a reader with no context at all** -- no source, no docs, not even the
   name of the game -- and asking one question: *there are people in this
   picture, what is each one?* Before, verbatim:

   - v9, the delivery moped: *"a police or official escort motorcyclist, or a
     delivery rider."* **The owner's own misreading, reproduced independently.**
   - v8, two road cyclists: *"Two people on motorcycles, and this one I am
     fairly confident about... escort or outrider motorcyclists."* A bicycle
     read as a motorbike, confidently.
   - v3, the marshals: *"Two figures side by side on a flat trailer...
     Stripped of the props, the two bodies themselves are just banded blocks
     and I could equally believe they were spectators on a viewing stand."*
   - v2, the trike's rider: *"I cannot tell what kind of person it is... a
     stack of blocks... If I had to guess from the vehicle rather than the
     figure, I would say a maintenance cart driver, **but that is the cart
     talking, not the person**."*

   Three things worth keeping from that:

   **The props were carrying every figure that read at all.** Cones, a board, a
   top box, a paddle. Take them away and there was no person left -- and props
   are what the OTHER hazards have too, so they cannot distinguish anything.

   **One 0.44 x 0.08 box was doing more identification work than everything
   else on a rider combined.** The reader named it: *"unlike every other figure
   here, the head is an actual helmet with a black visor band across it. That
   visor is what makes it read as a person on a bike rather than a stack of
   boxes."*

   **Category errors come from the machine, not the paint.** v8 read as
   motorcycles because its wheels were CAR wheels (a rim disc at 0.58 of the
   radius inside a 0.10 tyre), its bars were a straight tube, and its riders
   sat upright. A bicycle wheel is mostly air, a road bicycle has drop bars,
   and a road cyclist is folded over them. None of that is detail; all of it is
   shape, and all of it was cheaper than the paint arguments in the lever
   tables above.

   One thing the sheet found that nobody asked about: the reader also reported
   *"a group of tall brown vertical slabs I genuinely cannot identify; they
   might be people in brown, or wooden posts, or market stall frames."* They
   are TREE TRUNKS, standing behind the aid station with their canopies
   occluded by the street wall. Same family as entry 21 -- a part that is
   present, correct and worth nothing -- except here the part is worth less
   than nothing, because it reads as an unidentifiable object.

24. **The instrument for this one had three defects and every one flattered the
   measurement.** `tools/people.js` was written to answer "how big is a person,
   in pixels, where the game actually puts them", because `framing.js` can
   place a hazard from a claim site and nothing could place a crowd.

   1. `Vector3.project` divides by w and w crosses zero at the camera plane, so
      a head BESIDE the eye came back mirrored and enormous. It reported a
      spectator head of **114,730 px** -- several viewports -- and reported it
      as the BEST CASE, which is the number a decision to build a face would
      have been taken on.
   2. Clustering skin vertices on a 0.34 grid did not measure heads. A
      spectator's raised arms are skin, and so is the placard pole, and the gap
      from a 0.28 head to an arm 0.30 out is 0.10. Head, both arms and a 0.9
      pole fused into one 41.9 px blob.
   3. Tightening the grid to 0.10 returned **1444 heads of size 0.00 x 0.00**.
      A box has no interior vertices: its corners are 0.28 apart, three cells,
      and a 1-neighbour union cannot bridge them. There is no cell size that
      works, because a grid is the wrong primitive. The split is topological
      now -- same triangle, or same position within the same colour run -- and
      recovers each authored box whole at any size with nothing to tune.

   Fourth entry of the form "the instrument was the bug", after `stride.js`'s
   six defects, `clarity.js`'s whole-frame edge density, and the ortho lenses
   at entry 21.

   What it then found is the whole tiering of this pass, and it is blunt: **a
   spectator's face is 1.5 pixels wide and draws 2.3 of them.** Ninety-one head
   pixels a frame, shared between forty visible heads, is the entire budget for
   every face in a roadside knot. There is no eye that can go there. The four
   hazards that are people measure 17 to 27 px of head at 8 units -- and 80 px
   at the closest approach the game can produce -- so they get faces, and
   everything else gets silhouette and motion.

25. **Four parts on the runner had never been drawn, and every one of them
   carried a comment explaining what it was doing.** The character pass -- face,
   eyes, anatomy, hands, cloth, expression -- spent as much of itself deleting
   as building, and the deletions were all found the same way: by
   `tools/resolve.js`, which builds a candidate, gives it a unique flat colour
   and COUNTS its pixels in a real frame.

   - **The thumb**, four passes old, at z +0.056 -- the FRONT of a hand whose
     mitt reaches 0.101. Seven pixels at its best, absent in 36 of 48 frames.
     The brief for this pass said the character had no thumb, and the brief was
     right for the wrong reason: he had one and it was inside his hand.
   - **The knuckle row**, defended by thirty lines of comment, at a **median of
     two pixels**. Its z was right; its y was not. At -0.3055 it sat where the
     mitt's ellipsoid has already curved away to 81% of its section, so three
     balls "0.017 proud" were proud of a surface that was no longer under them.
     *A part is not proud of a shape, it is proud of the shape AT ITS OWN
     HEIGHT* -- the fourth place in that file where the same arithmetic has
     gone wrong, after the coin of scalp, the cap peak and the wristband.
   - **An ear concha**, built during this pass, cut during this pass: 0 pixels
     in 48 of 48 frames through BOTH lenses. Inset in x on an ellipsoid does
     not mean behind it, it means inside it.
   - **A facial muzzle and a three-part jaw**, also built and cut here, for a
     fault that is not about size at all: at this scale every mass resolves as
     its own closed OUTLINE, and the eye counts outlines before it reads form.
     Three masses along the bottom of a round head read as a chin between two
     jowls; one mass that tapers back into the skull before it can have an edge
     reads as a jaw.

   That last one is the general finding and it is worth more than the four
   deletions. **On this character the ink shell is the unit of composition.**
   Every part is drawn twice -- fill, then the same geometry through the
   outline shader -- so a part boundary is a hard black line, and the arm read
   as three capsules for exactly that reason and not because of its shapes. The
   fix was fewer parts spanning the same distance, not more geometry between
   them: the deltoid moved onto the arm and a forearm belly swallowed the
   elbow, and one limb came out with one outline round it.

   **Two instruments were kept this time**, which is the correction to entry 3
   rather than another instance of it. `tools/envelope.js` measures the
   silhouette contract per vertex in all eight states; `tools/pose-diff.js`
   compares every joint the file poses, by name, across two builds at any
   polish setting. Between them they replace four separate hand-written scripts
   that were thrown away after producing the numbers this repo has been quoting
   ever since. Both found a defect in themselves before they found one in the
   work -- walking the rig rather than the body pivot measured the skid ribbon
   and reported a lowest point 1.9 units under the road, and a single control
   at shipped polish cannot tell a change from another draw of the same noise.

   **And the face is not visible in this game.** Not in play (0 px in 48 of 48
   through the chase camera), not at the start panel, which is a DOM dialog over
   the same astern view, and not at the finish, whose camera swings 1.6 units
   off the centreline but stays BEHIND him. It was built anyway, under rule 1,
   and the honest report of where it reads is in the pass's own commits.

26. **Three reference images were filed by filename instead of by upload time,
    and all three were the wrong pictures.** The owner's character-quality brief
    arrived with three attachments. The uploads directory held two batches that
    day; sorting its filenames put the EARLIER batch last, so `99d47b8`
    committed `IMG_8928`, `IMG_8932` and `IMG_8933` as the character
    references. Every one of them was wrong:

    - `reference/ss-character-quality.png` -- the file whose whole purpose was
      to be the outside quality bar -- was **a phone screenshot of our own
      game**, timestamped 5:12, at mile 16.66. The commit message described it
      as the construction bar. The real Subway Surfers key art was
      `IMG_8934`, sitting unread in the same directory.
    - `reference/play-npcs.png` was **byte-identical to
      `play-flatbed-10u.png`** -- same md5, an obstacle frame from a message
      three hours earlier. The NPC brief was pointed at a picture of a lorry.
    - `reference/play-runner-closeup.png` was a full-screen chase frame, not
      the three-panel zoomed contact sheet the owner actually sent.

    The runner agent found it, opened the file, and used `ss-run-01..03.png`
    instead, so no work was misdirected -- **but that is luck, not process.**
    The failure is not the sorting. It is that five image files were copied,
    renamed and committed with descriptive names **without one of them being
    opened**, in a repo whose second standing rule is that the artifact is not
    the evidence. A filename is a claim about a picture's contents; here it was
    a claim nobody checked, and it was wrong five times out of five. All three
    are refiled from the correct batch, and the two displaced frames are kept
    as `play-gates-14mi.png` and `play-gates-17mi.png` -- named for what a
    reader would see in them.

   **Postscript, after the references were refiled.** The character pass was
   built against `ss-run-01..03` because `ss-character-quality.png` turned out
   to be a screenshot of this game. Entry 26 records the refiling; what the
   REAL key art then said is worth adding here, because it overturns one of
   this entry's own conclusions.

   The pass wrote, into the runner's header and into a commit message, that
   *this character has no brow line, and that is what wearing a cap pulled down
   means* -- a limitation dressed up as an intention. Both reference characters
   have heavy dark brows on bare forehead **below the brim**. They wear the same
   hat and have room because the brim sits higher. The geometry claim was
   correct (the band's underside is 0.012 into the top of the eye, so there is
   no forehead at all); the framing was an over-claim of exactly the kind this
   document exists to catch, and it was caught by opening a picture rather than
   by measuring anything.

   Corrected in place, with the number the next pass needs: the band's underside
   must rise 0.042 to open a brow line. That moves the hat, the hat is the
   character's identity, and the brief ruled identity out -- so it is reported
   as the one item on the owner's list that cannot be delivered without a
   decision only they can take.

   The other thing the real art shows and this pass did not build: the raised
   hand has SEPARATED, chunky fingers. Ours is a fist with a knuckle row, which
   is right for a runner's arm swing and is not what an open hand looks like.
   No open-hand pose exists in this game today.

27. **The brim went up, and two correct animation terms turned out to be
   subtracting.** Entry 25's postscript ended with a limitation reported rather
   than built: this character had no forehead, so he could have no brows, and
   opening one meant moving the hat -- which is his identity. The owner was
   asked and chose to move it. Band centre HY + 0.060 -> HY + 0.102.

   Two things came out of building it that generalise.

   **A clearance target derived for the wrong material.** The 0.042 was derived
   to leave "one ink width of clearance over the eye", and what shipped is
   0.0034 at rest and a deliberate OVERLAP under load. Both halves of the target
   were wrong once the z was settled. An ink width is what two SHADED surfaces
   need so their outline shells do not interpenetrate, and the brow is welded
   into a flat unlit mesh that has no ink shell -- there is nothing there to
   grow teeth. And a brow that never touches the eye cannot furrow. Putting the
   brow IN FRONT of the whole eye stack instead of above it took the available
   tilt from about four degrees to nine and replaced the clearance that mattered
   with a different one: 0.0163 to the pupil at maximum excursion.

   **Two terms that were each right, and together wrong.** The pass already
   drove the eye's aperture, because it had been written when there were no
   brows to drive. Adding the brow raised the obvious question -- which channel
   carries it -- and it was answered by isolating each in a patched build and
   counting the pixels that CHANGE between effort 0 and effort 1:

   | | brow alone | aperture alone | both |
   |---|---|---|---|
   | symmetric aperture | 11668 | 3900 | **8585** |
   | closing from below | 10734 | 5282 | **13713** |

   The first row is the finding. Both together read LESS than the brow on its
   own: a symmetric aperture pulls the eye's top edge down and away exactly as
   the brow arrives to meet it, so the brow lands on skin instead of on eye and
   neither mark gets its contrast. Two defensible terms, deleting 3083 pixels of
   each other. The fix was not smaller gains, it was a different EDGE -- the
   aperture now closes from the bottom, the pivot translating by half the height
   it loses so the top edge is pinned -- and the pair went from 3083 pixels
   worse than one channel to 2979 better. A swing of 6062 pixels for one line of
   geometry reasoning, with the gains barely touched.

   **The general rule, which nothing in this repo had written down:** when two
   terms drive the same feature, measure them TOGETHER as well as apart. Every
   instrument here was built to ask "does this part read", and each of these two
   passes that question on its own. "Both are good" is not a measurement.

   What it cost, isolated against the build immediately before it. `low` is
   0.0000 in all eight states, so footroom cannot have moved. Crown is 0.0000 or
   +-0.0001 in seven of eight -- the run, jump and slide crowns the contract
   names are untouched -- and moves only in slide-ENTER, +0.0078. Half-width is
   0.0000 in all five states the contract separates and moves only in lean
   (+0.0085), trip (+0.0158) and bounce (+0.0202), which are the three roll
   states, where a band 0.042 further from the neck pivot swings a little wider.
   Joints at polish 0: exactly 0.000e+0 on every one but the hood spring.

   And the brow is 0 pixels in 48 of 48 frames through the chase camera, like
   every other thing on this face.

28. **The unidentifiable green block was not the aid item, and the brown slabs
   were not the street wall's doing. Both diagnoses were confident, written
   down, and wrong.**

   Entry 23 left three failures from the blind identification test. Two of them
   came with a stated cause, and neither cause survived being measured.

   **THE GREEN BLOCK.** The blind reader flagged, in two of four frames and
   without being asked about props at all, *"a small pale green object I cannot
   identify -- it might be a bottle or a flag furled on a pole; it just looks
   like a green block to me"* and *"a small green block on the road between them
   I cannot make out."* The brief that commissioned this pass believed it was
   the aid bottle, whose white body was dissolving into the pale marshals behind
   it, and asked for that to be audited rather than trusted.

   It is not the bottle. A raycast through the exact pixels -- x 200-207,
   y 163-175 of the v3 tile -- returns a transparent MeshBasicMaterial at hex
   0x5ff0a6, 21 units ahead of the runner, at road level. That is the RACING
   LINE. A control render with the ribbon hidden and everything else untouched
   removes the block and changes nothing else in the frame. The arithmetic said
   so before the raycast did and nobody had done it: the object is 13 px tall,
   and a 0.77-unit bottle at 8 units on a figure scale of 73 px per unit would
   be 56.

   **What that exposed is worse than the misreading.** Measured in HSV:

   | | hue | sat |
   |---|---|---|
   | racing line 0x5ff0a6 | 149.4 | 0.60 |
   | aid pool 0x86eec0 | 153.5 | 0.44 |
   | bottle body 0xf6fffb | 153.3 | 0.04 |
   | bottle label, cap, aid cloth 0x2fd39a | 159.1 | 0.78 |
   | JUMP / DUCK / BLOCK | 38.7 / 192.3 / 345.3 | |

   The three hazards are 33 degrees from their nearest neighbour. The route hint
   and the entire aid family sat inside **ten degrees of each other**. This game
   had one colour meaning "follow this" and "collect this" simultaneously, and
   the only thing separating them was how much of each you could see. The
   reader's guess that the fragment "might be a bottle" is that collision
   showing up in a human read.

   The colour was not chosen carelessly -- it was chosen against the wrong list.
   The comment that picked it reads *"the one hue no hazard owns; amber, cyan
   and red are all spoken for, and green reads go."* Every clause is true. It
   checks the HAZARD palette and never the PICKUP palette. **A palette argument
   that enumerates one family and stops is not an argument.**

   So the line moved to violet and the pickups kept the green, which is the
   right way round twice over: the pickup is a world object the player is scored
   on touching, and the line is an affordance drawn on the road.

   **Two more things the ribbon was carrying, both found by the same tool.** It
   was FOGGED, while the ring trail drawn on top of it is exempt with a
   paragraph explaining that its job is to be legible far up the road where fog
   is taking half the contrast out of everything else. The paragraph applies
   verbatim to the ribbon and the ribbon never inherited it -- the ring was
   simply written second. And its far end faded by TAPERING ITS WIDTH, which
   spends the one dimension that decides whether a strip of paint reads as a
   strip of paint, on top of a perspective that is already halving it every time
   the distance doubles. The fade is in alpha now and the width is constant.

   **THE TREES.** Entry 23 recorded the reader's *"a group of tall brown
   vertical slabs I genuinely cannot identify"* and named the cause: tree trunks
   *"standing behind the aid station with their canopies occluded by the street
   wall."*

   `tools/canopy.js` keys every placed tree's trunk and crown to two pure
   colours and counts them in the real frame with every other object untouched,
   so the occlusion is the shipped occlusion. Over 51 tree appearances at eleven
   skips inside the race: **49 trees, 0 thin, 2 posts**. Then each occluder
   class was hidden in turn, and the class that recovers the crown is not the
   street wall at x 12.20. It is `road tile / hedge` -- **the game's own avenue**,
   the four broadleaves baked into every hedge tile at x 7.95, standing in front
   of everything. The worst tree goes from 55 trunk / 0 crown to 127 / 1700 the
   moment the avenue is hidden.

   That killed both options that had been offered. The avenue is a continuous
   line 12 units apart down both verges, so there is no lateral band behind it
   that is clear: a tree pushed outboard far enough to miss it is off the side
   of a portrait frame long before it clears, and one pushed inboard is in the
   corridor. What was left is that **a trunk seen without its crown should not be
   a bare pole.** Real dense planting has an understorey, and the pixels that
   survive through a gap in the avenue are the ones nearest the ground. Every
   scatter tree now has a shrub mass at its foot, so what shows through the gap
   is foliage. 51 of 51.

   That fixes the class rather than the two instances -- any occluder, any
   distance, any leg, including the ones no skip in the sweep happened to land
   on. It costs no draw call, and the corridor standoff is computed from the
   merged vertices, so the skirt is inside the reach it measures automatically.

29. **`?skip=` saturates, and two shipped tools sweep past the end of the race
   without noticing.**

   `?skip=` is race SECONDS. Measured on the live page: skip 60 is mile 6.11,
   skip 150 is mile 16.26, and **skip 240 is mile 26.22 at z 6293 -- the finish.
   Every skip from 240 upward returns that same frame.**

   `tools/people.js` ships with a default sweep of `150,900,1560,2050`. That is
   not four legs of the course. It is one leg and the finish photographed three
   times, and the agreement between the last three rows is the tool agreeing
   with itself. `tools/shoot.js` does not have the bug -- its eight shots run
   25 to 225 and every one lands inside the race -- so the two tools disagree
   about what a skip means and only one of them is right.

   This cost the first run of `tools/routeread.js`, which inherited people.js's
   defaults and reported that the racing line collapses to a single 12x22 blob
   in most frames. It does not. That was the finish line, three times. Re-run
   inside the race, the ribbon is typically 1500-2000 px in 2-8 parts with a
   biggest component around 19x150 -- a line.

   **The general form, and it is entry 3's shape again: a sweep that returns
   suspiciously consistent numbers is not converging, it is repeating.**

30. **The saturation gate reads the mean COLOUR, not the mean saturation -- so
   two vivid parts on opposite sides of the hue wheel measure as grey.**

   `contrastAudit` runs every hazard variant through `shotMean`, which averages
   the RGB of every covered pixel and then takes `satOf` of that one mean. This
   is stated nowhere and it governs every art decision on the fleet.

   Found by walking into it. BLOCK v9 needed a courier's cargo cube, and the cube
   was drafted in a delivery blue at sat 0.83, val 1.00, on the obvious
   reasoning that a vivid colour cannot cost saturation. It cost all of it: v9
   went from a gate margin of +0.373 to **-0.108, a build failure**, with dS
   collapsing 0.302 to 0.040. Blue at hue 222 against that bike's pink at 345 is
   123 degrees apart, and the mean of the two is a neutral.

   The metric is not wrong -- a confetti object really does read as one grey
   mass once saturation has e-folded down the road, which is the thing the gate
   is about. But it means the lever everyone reaches for is the weak one.
   Sliding the cube's hue from 14 to 4 to 355 moved the gate margin by 0.005 and
   0.032: nothing. What moved it was **area of saturated bright**: getting the
   near-neutrals off the new part (a cream reflective bar at sat 0.12 and lemon
   webbing at sat 0.73 became KIT_B at sat 0.98, +0.041), growing the cube in
   width rather than height so its bright face is a larger share of the object
   without touching the head (+0.068), and lifting the dark-of-hue trim from
   val 0.55 to val 0.82 (+0.050).

   Landed at gate +0.382 and target +0.013, against +0.373 and +0.007 before --
   both margins wider than they started, which is the only acceptable outcome
   when the change was made to win an identification test. Rule 4 does not allow
   one to be bought with the other.

31. **The courier cube failed twice before it worked, and neither failure was
   about colour.**

   Draft one was sized like a real one: 0.80 x 0.76, centred above the shoulder
   line and 0.40 behind it. Through `framing.js` at 8 units it **deleted the
   rider.** The cube is nearer the lens than the head by its whole standoff, and
   from dead astern -- the only view the chase camera has -- it covered the
   helmet, the visor, the shoulders and the hi-vis band together. It would have
   traded away the exact part the blind reader had singled out as the reason
   this variant read as a person at all: *"unlike every other figure here, the
   head is an actual helmet with a black visor band across it. That visor is
   what makes it read as a person on a bike rather than a stack of boxes."*

   Draft two cleared the helmet and became a STACK. The top box is nearer the
   lens than the rider and owns everything below 1.665; the helmet starts at
   2.11. That leaves a band 0.45 units tall as the only part of this object the
   chase camera can see a rider in, and a cube that fills it produces helmet,
   box, box.

   The fix was to stop competing for the band and declare inside it: the cube is
   less than half the top box's width so the two can never merge into one mass,
   and the rear face -- the only face this camera gets -- carries two lemon
   webbing straps and a reflective bar. Bright webbing on a soft bag is not
   something a painted panel does.

   **The general rule: on this camera, anything added BEHIND the rider is added
   IN FRONT of them.** Depth order down the object's own axis is the opposite of
   depth order to the lens, and every part of a two-wheeler mounted aft of the
   seat occludes the person it belongs to.

32. **The blind identification test is contaminated, and it has been all along.**

   Every reader used to prove this pass declared the same thing unprompted, in
   almost the same words. One of them:

   > *"A project instruction file was auto-injected into my context by the
   > harness before your message arrived. I did not go and read it. It appeared
   > on its own... from it I involuntarily learned roughly this: that this is a
   > game; that it has obstacles, vehicles, buildings, trees, crowds, marshals,
   > signs, banners, a ghost and a runner; that there is a chase camera behind
   > the player; that hazards have to be visible against the road."*

   `CLAUDE.md` is injected into any agent started in this repository. It names
   **marshal, runner, ghost, hazard, chase camera, crowd, walkers, banner,
   gantry, finish arch** -- which is most of the answer key for a test whose
   whole question is "what is each one". The reader who spotted it was right to
   say the test still has value, because nothing in that file says which
   specific object is which, but it hands over the vocabulary.

   **The before and after transcripts in `docs/people/` were almost certainly
   taken under the same contamination and do not disclose it.** So the pass mark
   this project judges its people by has an unmeasured advantage baked into it,
   in the flattering direction, exactly like `stride.js`.

   The path names leak too. One reader was given `docs/people/after2/aid.png`
   and said so: *"the word 'aid' was in front of me before I saw the picture...
   'marathon' plus a file named 'aid' makes AID STATION the first thing my mind
   reached for."* Its answer on the top row was "a drink cup, or a small bottle"
   -- and the word cup may have come from the filename rather than the pixels.

   **If this test is going to keep being the acceptance criterion it should be
   run from outside the repository, on neutrally-named files, with the reader
   asked to declare contamination at the top.** The last of those three is free
   and every reader here did it unasked.

33. **The pickup does not survive to READ_NEAR, and the route hint was drowning
   it. The item worth two mistakes is the one that reads worst.**

   `tools/simulate.js` says the record survives 1 mistake with no aid and 3
   taking all of it, so the aid item is the most consequential thing on the road
   to read correctly. It had never been shown to a blind reader. Shown one, at
   8, 12 and 25 units -- 25.35 is `READ_NEAR`, the distance the lane is actually
   chosen at -- the answers were:

   - **The banana passes.** *"Unmistakable... I am as confident about this as I
     am about anything."* At 25u: *"still a recognisably curved yellow sliver...
     I would have said banana and I think I would have been right."*
   - **The bottle passes near and FAILS at range.** At 8u one reader got it
     exactly (*"the give-away is the neck-and-cap silhouette"*) and another got
     *"a drink cup, or a small bottle... about as tall as it is wide, which
     pushes me to cup"*. At 25u, both failed: *"a small pale-green vertical
     smudge and I would not be able to name it from that alone"*, and asked
     directly whether it could be named from the 25u panel alone, *"No, not
     honestly."*

   The comment on `waterGeo` says the identity is entirely in the silhouette
   because at 20-40 units nothing else survives. The silhouette is correct and
   the premise is wrong: at 25 units nothing survives, silhouette included. What
   survives is what survived for the banana -- **a hue nothing else in frame
   owns, on a shape unlike every other shape in frame.** The bottle has neither:
   it is pale, and it shares the mint of its own pool of light, so reader two
   found *"the two merge into one soft blob rather than reading as
   marker-plus-object."*

   **And the marker beats the thing it marks.** *"The green ellipse also beats
   the object it is meant to point at, which is the more awkward of the two: the
   marker is brighter and larger than the thing it marks."*

   Then the part this pass caused. Moving the racing line to violet fixed the
   confusion with the pickups and made it LOUDER, because violet on dark asphalt
   is a bigger value break than the mint it replaced. Asked to rank a 25u frame,
   the reader put the route ribbon **second of six, above the runner**, and the
   pickup **last**:

   > *"yes, things on the road out-shout the hovering object at 25u, clearly and
   > by a lot. The violet streaks beat it decisively -- they are bigger, more
   > saturated, higher contrast against their background, and there are several
   > of them competing against one small item."*

   Two things were tried against that and NEITHER FIXED IT. Restoring the
   ribbon's fog did not shift the ranking. Dropping its opacity from 0.62 to
   0.38 moved the ribbon from second of six to fourth, and cost nothing
   structural -- `tools/routeread.js` still puts the biggest component at skip
   110 at 19x160, elongation 8.4 -- but the re-read is unambiguous that the job
   is not done:

   > *"Plain answer to the question you actually asked: yes. In both 25u panels
   > something on the road surface out-shouts the hovering item, and in the top
   > one it is not marginal... My eye lands on the streaks before the item every
   > time in the top-right panel -- call it a clear win for the streaks, not a
   > tie."*

   **And the same reader supplied the geometry that says opacity was never going
   to be enough:** *"they are elongated along the view direction and perspective
   foreshortening costs them much less area than it costs a small compact
   object."* A ribbon lying along the line of sight loses screen area roughly
   linearly with distance; a pickup loses it quadratically. So the ribbon gains
   on the pickup at every distance, for free, and no amount of dimming changes
   the exponent. Whatever finally settles this has to be structural -- the hint
   ending well short of the item, or breaking into marks that foreshorten like
   objects rather than like a strip -- and it needs a 25u blind read as its pass
   mark. **It is not fixed. It is two steps less bad and measured.**

   **The unfixed part, stated rather than buried: the water bottle still cannot
   be named at READ_NEAR.** Nothing in this pass fixed that, because nothing in
   this pass knew it until the last measurement. It wants the banana's
   treatment -- a colour nothing else owns and a pool that does not share it --
   and it wants a blind read at 25u as its pass mark, not at 8.

34. **A paragraph that is right about one object is not right about the object
   underneath it.**

   The ring trail carries `fog: false` with a paragraph explaining that its job
   is to be legible at 100 units, which is exactly where the fog is taking half
   the contrast out of everything else. That paragraph reads as though it
   applies verbatim to the route ribbon the rings are drawn over, and this pass
   gave the ribbon the exemption on that reading. The blind read above is what
   it cost.

   The reason it does not transfer is a property of the two objects and not of
   the fog: **fourteen small marks that hold their contrast up the road read as
   a trail; 124 unbroken units of paint that hold theirs read as the brightest
   object in the scene.** Exemption from aerial perspective buys attention, and
   attention was the scarce thing.

35. **The two Gold Run mechanics, tested: the ramp is worth building, the lane
   closure is not — and the ramp's real cost is a hole it did not create.**

   The owner sent five Talking Tom Gold Run frames and asked us to *test* two of
   them: running up a ramp onto a vehicle, and closing the road to two lanes or
   one and opening it back out. Both are prototyped behind scalars —
   `MR.Course.RAMP`, `MR.Course.NARROW`, `?ramp=0..1`, `?narrow=0..1` — on the
   `MR.Runner.POLISH` pattern, so one build generates both courses. At zero
   neither draws a random number, so the seeded stream stays in phase and the
   365-day course hash is **bit-identical** to the generator that shipped before
   them. `tools/mechanics.js --identity` is that check and it is meant to be
   brittle.

   **LANE CLOSURE — DO NOT SHIP, and the reason is that it is already shipped.**

   It needs no new mechanism at all: a closure IS a BLOCK in the closed lanes,
   which the spacing rules, `solvable()` and the renderer already agree on. Zero
   new geometry, zero new draw calls, zero degrades over 365 days, and the
   perfect finish moves +3.4s against a 95s margin.

   And measuring the baseline is what settled it. **The shipped game already
   spends 18.48% of the race with two or fewer lanes open and 0.88% with exactly
   one, including a single-lane corridor 145 units long**, produced by accident
   when two BLOCK trains overlap. Nobody designed that and nothing measured it.
   Turning `NARROW` on takes those to 27.56% and 4.27%.

   What it costs is the thing the roadmap already refused once. Correction "the
   lever left open" declined to force a CLEAR lane because *it buys visibility
   by removing gameplay*. A closure is the mirror image and lands in the same
   place from the other side: **it removes the lane decision and keeps the
   risk.** Inside a deliberate corridor 40.0% of gates demand an action, against
   41.4% on open road — so the player is asked the same question with one of the
   two ways of answering it taken away. It is not a rest (they can lose) and not
   a tax (they can win); it is the same difficulty with less agency, and the
   game already reaches that state 18% of the time without being asked.

   The honest counter-argument, recorded because it is not weak: `makeGate`
   deliberately builds full-width gates at 62% of gates at the top of the
   difficulty curve, and a one-lane corridor is a MILDER version of that — one
   thing to read instead of three. So closure is aligned with the design, it is
   simply not *new*. **Reopen only if the owner wants the archway as a set
   piece.** As art it is worth having; as a mechanic it buys nothing that is not
   already on the road.

   **THE RAMP — SHIP IT, AFTER THE ART AND AFTER ONE STRUCTURAL FIX.**

   The reference "ramp" is the bin lorry's own tailgate, one lane wide, so the
   mechanic reduces to something the generator already builds: **a rideable
   BLOCK train.** That reduction carries the whole fairness argument.
   `solvable()` is not changed and does not need to be — a roof is only ever
   marked on a train that was ALREADY legal with another lane surviving its
   whole span, so it only ADDS edges to the BFS. Every path proved before is
   still there.

   Measured over 365 days: 3.70 ramps a day, a 35.5-unit / 1.25 s ride, 2.3
   gates a day given up to the longer train, minimum landing margin 11.0 units
   against the 6.0 two lane changes need, zero falls reaching a gate, zero gates
   inside a vehicle, zero degrades. Cost in the currency that binds: **+1 draw
   call and 44 triangles for the whole course.** Perfect finish +1.1s.

   Four findings the code did not expect:

   - **Without a reward the ramp is strictly dominated, and only measurement
     said so.** Riding pays the same one clean gate as going round, and charges
     a locked lane, a fall, and a BLOCK in the landing lane 11% of the time.
     Aid on the roof is the fix and it is the reference's own answer (the gold
     bars along the top). It also lands in exactly the right currency: a roof is
     the hardest legal lane there is, so it is worthless to a perfect run and a
     road back for a broken one — the same shape `AID_CEILING` already has.

   - **A rideable train is the first object in this game that occupies a lane
     BETWEEN gate lines in a way that matters, and nothing in `Course` models
     it.** A bot planning off the gate table walks into a 43-unit lorry's flank
     **27 times in four races**; taught to sample `deckAt` it still does it 8
     times, against 0 on a course with no ramps. Every lane-reasoning thing in
     this game — the proof, the spacing floor, the telegraph mats, the bot —
     reasons at gate lines. **The ramp needs course-level lane occupancy before
     it ships.** That is the structural fix.

   - **The hole is older than the ramp.** `player.resolveGates` is the only
     contact path and it fires at `gate.z`, while a train is ONE gate carrying
     up to 17.9 units of vehicle. `tools/mechanics.js --passthrough` drives the
     real `MR.Player` into the flank of 13 of 13 trains on a shipped course and
     records **no contact on any of them**. You can run the whole length of a
     bus. Not fixed here — making trains solid along their length is a
     difficulty change to the whole game and is not this pass's to make.

   - **The roof reads BETTER than the road.** The eye goes from 3.10 to 5.90,
     and the project already measured what eye height buys the far road at +0.48
     units. See `shots/mech/ramp-portrait.png`.

   **Three instrument defects, all found and all flattering.** (1) The
   pass-through probe took "the first non-BLOCK lane" as safe, walked into the
   JUMP standing in it, and scored the resulting contact as the train being
   guarded — 8 of 16 reported where the truth is 13 of 13. (2) The flank hit
   re-fired every frame instead of once, so four incidents read as 27 contacts
   and looked like a design finding; the bounce only worked while a lane change
   was still in flight. (3) The landing-margin assertion substituted the FINISH
   LINE for a missing next gate and failed at 3.0 units on 2026-12-02 — right
   that something was wrong, wrong about what. The real fault was a ramp at
   f=0.991 running its roof into the finish run-in, now refused at generation.
   **A 90-day sweep found none of the third; only the full calendar did.**

   **Needs art, specifically.** `world.js` casts BLOCK variants whose measured
   roofs run 2.34–2.79 against a box top of 2.80, so four of ten would leave the
   runner floating up to 0.46 above the roof: a rideable train has to cast a
   full-height variant, or carry its own. The tailgate does not exist —
   `src/render/ramp.js` is a deliberately plain closed solid standing in for it,
   and `shots/mech/ramp-mouth.png` shows a tram drawn inside it. Roof pickups
   are placed in course space and drawn by `world.js` at road level, i.e. inside
   the lorry; they want lifting to `Course.DECK_Y`. Delete `ramp.js` when the
   fleet grows a hopper.

36. **The hue was never telling the three kinds apart, and the rule that said
   it was had stopped being true before this pass touched anything.**

   `world.js` carried the rule in two places, in almost the same words:
   *"COLOUR. Amber JUMP, cyan DUCK, pink BLOCK, always, on the mass that
   carries the silhouette. One contact ends the record attempt; the hue is how
   the kind is known before the shape resolves."* Entry-era notes record the
   three sitting 33 degrees apart. It was the reason the DUCK bar could not be
   the yellow-and-black a real road uses, and the reason JUMP v1's cones could
   not simply be orange.

   `tools/kindread.js` measures it against the channel it was competing with,
   on the same frames, through the live chase camera, at 12, 25.35 and 40
   units. Two features per variant: the mean hue of its own pixels, and a
   PROFILE -- the fraction of the lane width the silhouette covers in each of
   fourteen world bands from the road to 2.80. A nearest-centroid classifier is
   run over each channel alone.

   | channel | misread, of 21 |
   |---|---|
   | hue | **9** |
   | silhouette profile | **2** |

   The protected channel is the weaker one by a factor of four, and it is
   weaker because **the fleet rebuild had already spent it and nobody
   re-measured the rule afterwards.** BLOCK v6 is orange at h 34 and sits
   inside the JUMP cluster; BLOCK v0 and v4 are at h 216 and 196 and sit inside
   the DUCK cluster. Seven of the ten BLOCKs were not pink. The rule was
   describing a game that had not existed for several passes.

   So the hue is spent on the owner's ask instead -- yellow-and-black for the
   thing you go under, red-and-white for the barrier -- and the split that
   makes it safe is that **the telegraph mats keep their abstract kind hues and
   their kind glyphs. The mat says what to DO; the object says what it IS.**
   Collapsing DUCK into the amber family cost the profile channel nothing
   measurable: 2 of 21 before, 2 of 21 after.

   **The general form: a rule that forbids something is worth re-deriving every
   time the thing it protects is rebuilt.** This one survived four rebuilds of
   the objects it was about.

37. **Two defects in the new instrument, both flattering, both found by its own
   audit trail rather than by eye.**

   `tools/stride.js` shipped with six. `tools/kindread.js` was written with the
   memory of that and still shipped two into its first run:

   - **It banded every variant against its OWN collision box.** JUMP yMax is
     0.80, DUCK 1.83, BLOCK 2.80, so band 13 meant y 0.77 on a JUMP and y 2.70
     on a BLOCK, and three different objects would have printed as three
     identical profiles. **That is entry 2's defect, verbatim, in a tool
     written by someone who had just read entry 2.** One ruler now.
   - **The lane column came out inverted and every profile read a clean zero.**
     The chase camera looks down -z, so world +x projects to the SMALLER screen
     x: `sx(-halfX)` returned 227 and `sx(+halfX)` returned 185, the column
     window never opened, and the first run printed `0.00` twenty-one times
     with a perfectly plausible hue column beside it. Nothing threw. **A tool
     that returns zeros looks like a finding.** It was caught because the tool
     records its own column bounds and mask bounding box next to every row.

38. **What the cyclists were sitting on was the caution face, and the wheels
   were never the problem.**

   The owner: *"One bicyclist at the time. The bike needs to be on the road.
   Ours look like it is sitting on something."* Four candidates were named and
   three of them were wrong. Measured, per child mesh, off `api.variantObject`:

   - **The caution face. This is the one.** `face: [1.70, 0.20, 0.32, -0.571]`
     is a 1.23-wide, 0.20-tall striped panel spanning y 0.22 to 0.42 at
     z -0.571 -- **nearer the lens than either rear wheel**, across 72% of the
     lane, straight through both bicycles at hub height. Its hard bottom edge
     at 0.22 cut off the bottom two thirds of all four wheels, so the tyres
     never met the road anywhere the camera could see.
   - **The pedal shudder, second and smaller.** `a.position.y = sin(now *
     15.2 + ph) * 0.030` moves the WHOLE variant group -- machine, wheels and
     contact shadow -- so for half of every 0.41s cycle the bicycle was clear
     of the road. Now 0.008.
   - **CLEARED: the wheels reach the road exactly.** `vBikeWheel` centre 0.33,
     radius 0.33, tyre bottom y 0.000. The merged body's y-min of -0.0583 is
     the ink shell extruding below the surface, not a gap.
   - **CLEARED: there is no plinth.** This variant never had one.

   **The general form, and it is the third time this pass hit it: a bright
   lane-spanning quad at the height of a thing's contact with the ground makes
   that thing look parked on a pallet.** The same panel was the whole front of
   JUMP v1's plinth and had to move up onto the cone bar, and the traffic
   light's first two face positions both photographed as a striped mat lying on
   the road beside the pole. The face is centred on the lane by the pool --
   `f.position.set(0, ...)` -- so it can only ever sit on something centred,
   and every variant has to be built to give it somewhere to sit.

39. **A thin BLOCK is not free, and the profile said so before a frame was
   shot.**

   The brief for this pass suggested a traffic light might IMPROVE the
   occlusion assertions because it is thin, and that the owner's *"the road
   does not always need to be covered"* wanted exactly that. Built as the
   reference draws it -- a grey pole on a two-tier plinth -- it failed twice:

   - **The gate.** L 94.8 / S 0.153 against a lane at L 88.4 / S 0.156: ratio
     1.072 against 1.25, dS 0.003 against 0.22, **margin -0.142 and a failed
     build.** The fleet header had predicted it in words years earlier ("a
     realistic grey van would be a hazard nobody could name in time"); building
     the reference's own grey is how it got proved.
   - **The profile.** The bare post landed nearer the DUCK centroid than its
     own, at **-2.721 -- worse than either people-hazard it was built to
     replace.** A plinth at 60% of the lane with a 0.10 pole above it is a
     DUCK's shape with the mass at the wrong end. "The plinth will carry the
     low bands" was a guess that did not survive being measured.

   Both were fixed by the object standing in the SAME reference frame: the red
   and white works barricade in `ttgr-lightpole-in-lane.png`, at **1.32 tall
   and not 0.90**, because the bands from 0.80 to 1.40 are empty on a DUCK too
   and the middle is where the two kinds differ. It still tops out at 1.35
   against an eye height of 2.62, so the next gate is visible over it -- which
   is the thin-BLOCK benefit the brief wanted, delivered by a short wide object
   rather than a tall thin one.

40. **The unfinished item, stated rather than buried: BLOCK v9, the delivery
   moped, is the last hazard in the game that misreads its own kind.**

   Profile misreads went 2 of 21 to 1 of 21 across this pass -- BLOCK v2 was
   removed with the cargo trike, BLOCK v8 was repaired by giving the lone
   cyclist a crate stack -- and the moped is what is left, nearest the DUCK
   centroid at -1.523. Its profile is `0.06 0.20 0.28 0.30 0.43 0.50 0.50 0.51
   0.50 0.50 0.40 0.24 0.13`: **almost nothing at the road** and a broad soft
   middle, which is a DUCK's shape.

   The owner was asked directly whether the trike and the moped failed as a
   vehicle or as a person and answered **"Both. They either need to be fixed or
   removed."** The trike is removed. The moped is not, and it should get the
   same treatment or the same fate. The measurement to beat is in one line of
   `node tools/kindread.js`.

41. **A thin object cannot honestly fill a lane, and the fifth attempt at the
   cyclist is where that stopped being an opinion.**

   The slot has now been rebuilt five times and has failed four times on the
   same mechanism. Written out, the pattern is the finding:

   | attempt | how it failed |
   |---|---|
   | cargo trike | "one rider is a third of a lane wide... reads as something to hurdle" |
   | two cyclists abreast | a blind reader called them MOTORCYCLISTS; measured nearer the DUCK centroid than its own by -1.5 |
   | one cyclist + a striped board | the board cut the wheels off at hub height -- *"ours look like it is sitting on something"* |
   | one cyclist + crates | *"the cyclist appears to be biking on top of the box you created. There are also brown boxes next to him."* |

   The last one is the important one, because the crates were added BY the pass
   that fixed the board, to do the job the board had been doing. A blind reader
   who had never seen the owner's complaint arrived at the same place
   independently: *"I cannot confidently name this as one real-world thing, and
   that is my answer... the parts are individually legible; the whole is not."*

   **The mechanism, stated so it does not have to be rediscovered a sixth
   time.** A BLOCK must fill a lane and read as impassable. A bicycle is thin
   and mostly air -- that is what a bicycle IS, and `vBikeWheel` was
   deliberately built with the road showing through it. So a bicycle cannot
   fill a lane on its own, and every version has therefore had a prop propped
   beside it to do the filling. **The prop then becomes the thing that reads,
   and the rider becomes something sitting on it.**

   **THE GENERAL FORM: an object that cannot carry its kind alone should not be
   given a helper. Give the kind to the helper, or give up the slot.**

   Here the helper takes the kind. The crates were already doing all the work,
   so the rider is deleted and the slot becomes `blockCrateLoadGeo` -- a loaded
   pallet of delivery crates, which is the object standing on the carriageway
   in two of the five reference frames and is the owner's own vocabulary
   ("basic brown boxes"). Measured on `tools/kindread.js`, the profile at the
   road goes **0.61 to 0.79** and the variant stops being the one the
   classifier argues about.

   **The roadside crates are a different object in a different place and were
   NOT taken away by this.** The owner asked for crates and flower beds "on the
   edge"; it is crates standing in a running lane BESIDE a hazard that was the
   mistake. See entry 44.

42. **The stripe was never the kind channel, so the owner could have it.**

   *"Jump obstacles should be red and white"* collides head-on with the
   red-and-white this file gave BLOCK one pass earlier, and two kinds sharing a
   mark is a player jumping into a wall. It does not collide, and the reason
   was already measured twice from opposite directions:

   - `tools/kindread.js`: a nearest-centroid classifier on **hue alone misreads
     8 of 21** variants; on the **silhouette profile alone, 1 of 21**.
   - A blind reader, unprompted: *"Yellow-and-black chevrons universally mean
     'physical hazard, mind this' -- but that exact striping is used both on
     things you duck under and on things you must not hit at all. **The colour
     tells you the object is dangerous and tells you nothing about which way to
     go.**"*

   So the stripe is freed to say WHAT THE OBJECT IS: **red-and-white is
   construction furniture** (the JUMP boards, and the two BLOCK variants that
   are genuinely furniture rather than traffic), **yellow-and-black is reserved
   to DUCK**, the thing you go under.

   **What this bought, and it was the costliest confusion in the game.** The
   blind read found JUMP v1 and DUCK v2 both reducing at 25 units to *"a short
   horizontal yellow bar floating in the middle of the lane... Those two want
   opposite answers, so mistaking them is the costliest error available in this
   set."* JUMP v1's yellow came from two places -- its cone bar and its amber
   caution face -- and both are now gone. See `shots/jump-v1-cones-after.png`.

43. **The bottom of a DUCK's gap was the most blocked part of it, and the feet
   were platforms nobody had counted.**

   Every DUCK stood each standard on a 0.50 x 0.22 x 0.50 dark block. Two of
   those is 1.00 of a 2.24-wide envelope filled in at the road. `kindread`:

   | band | y | before | after |
   |---|---|---|---|
   | 0 | 0.00-0.20 | 0.38 | **0.21-0.24** |
   | 1 | 0.20-0.40 | 0.35 | **0.25-0.28** |
   | 2-6 | 0.40-1.40 | 0.23-0.26 | 0.25 |

   The gap is now uniformly open from the road to the bar instead of being most
   blocked at the bottom -- and the bottom is exactly where the one surviving
   discriminator lives. The blind reader found it and called it near-invisible:
   *"picture 6 shows road visible underneath the bar and picture 1 does not;
   that is a subtle few-pixel difference at distance."*

   They are also platforms, and the owner banned those in general terms --
   *"Needs to be connected to the road with no platform"* -- said about cones
   and meant about everything. **A standard on a block is the same
   figure-on-a-pedestal read as a cone on a plate, at a different scale.**

44. **"No platform" applied to the cones meant the cone's own base plate, and
   the fix is that a cone is ONE surface.**

   The plinth under JUMP v1 had already gone a pass earlier, but each cone
   still stood on its own 0.40 x 0.40 moulded square weight. Deleting the weight
   and leaving the body hanging would be worse; the answer is that the weight
   and the body are the same moulding. `jumpConeGeo` is now a single revolved
   silhouette sampled at nine heights from a 0.36 skirt lying ON y = 0 to a
   blunt tip at 0.78, at 16 radial segments -- **there is no join and no plate,
   because the plate is the bottom of the cone.**

   Five small cones became **three large** ones (1.8x the base radius), which is
   the owner's "individual large orange", and their skirts meet edge to edge at
   the road so the row still closes the lane at the bottom -- the one job the
   deleted plinth and the deleted bar were each hired for, now done by the
   cones' own size.

   **It carries no caution face at all -- the first `face: null` in the game.**
   A cone has no board on it, and with the bar gone the only thing on the centre
   line is a cone 0.20 wide at that height, so a 1.63-wide quad there would be a
   striped mat hanging in mid-air, which is entry 38's defect exactly. The gate
   survived it: JUMP v1 is not among the tight variants and `shoot.js` passes at
   BLOCK v2's +0.141.

45. **The violet on the road is the route ribbon, and the blind-read panels
   cannot show the thing that would have answered the reader's real complaint.**

   A blind reader flagged, in all six panels: *"The purple-violet smear on the
   road surface... an elongated blotch of saturated violet lying on the tarmac
   just in front of, or directly beneath, the main object... I cannot tell what
   it is."* And closed: *"Nothing painted on the road tells a runner what to do
   about anything in front of them."*

   Identified before being changed, as instructed, and it is **the racing line**
   -- `0xa87bff`, hue 265, a 0.17-half-width ribbon from ROUTE_NEAR 5 to
   ROUTE_FAR 124 at opacity 0.38. Not the telegraph mat: the mats are amber,
   cyan and pink and carry kind glyphs.

   **The second sentence is an instrument artefact, and this is the part worth
   keeping.** `api.variantObject` returns `assembleVariant`, which adds the
   body, the caution face and the one moving part -- **and no telegraph mat.**
   The mat is added by the POOL builder (`g.add(telegraph(kind))`), which a lone
   variant never goes through. So any tool that shoots a single variant --
   `kindread`, `framing`, and the panels this blind read was run on -- renders
   the hazard **with the game's primary "what to do" affordance absent by
   construction.**

   So "nothing painted on the road tells a runner what to do" is a true
   statement about the panels and an unproven one about the game. **A blind read
   is only as good as what the harness put in the frame**, and this harness
   omits the one channel the file's own reasoning leans on ("the mat says what
   to DO; the object says what it IS"). The route ribbon was already dropped to
   0.38 opacity earlier the same day for this exact complaint; nothing further
   is changed here, because the panels exaggerate it -- there is no mat in them
   competing for the same tarmac.

46. **What a runner standing on a rideable roof would actually stand on, and
   the brief's number was measuring the wrong thing.**

   The brief and entry 35 both state "BLOCK variant roofs sit at 2.34-2.79
   against a box top of 2.80, so four of the ten would float the runner". Two
   corrections, both structural:

   - **Only ONE variant can ever be ridden.** `castGates` forces
     `row[l] = 0` for every BLOCK train -- *"A TRAIN IS ALWAYS VARIANT 0 and is
     dealt OUTSIDE the bag"* -- and a ramp is a train. So nine of the ten roofs
     are irrelevant to the mechanic and only **v0, the tram**, matters.
   - **The float is not the problem; COVERAGE is.** A max-vertex height is the
     wrong measure, because the question is "what is under the foot at (x, z)"
     as the runner moves down the roof. Raycast straight down over the
     footprint on a 9x9 grid:

   | variant | footprint covered | roof min | roof max |
   |---|---|---|---|
   | **v0 (tram, the only rideable one)** | **89%** | **2.399** | **2.750** |
   | v2 | 22% | 0.060 | 2.790 |
   | v8 | 32% | 0.617 | 2.750 |
   | v9 | 41% | 0.700 | 2.520 |

   So the tram's roof is **not flat** -- it varies 0.35 across the deck -- and
   **11% of the footprint has nothing under it at all.** A runner placed at
   DECK_Y 2.80 floats between 0.05 and 0.40 depending where they are standing,
   and passes over holes. That is a different defect from "the roof is 0.05 too
   low" and it is not fixed by raising a slab.

   **THE ART IS NOT BUILT. This entry is the measurement and the contract, so
   the next agent starts from numbers instead of from a paragraph.** What a
   rideable body has to provide, all of it derived from the contract rather than
   chosen: deck **flat at y = 2.80** (`Collision.BOX[BLOCK].yMax` =
   `Course.DECK_Y`) across **100%** of x within +/-1.12 and the full stretched
   depth. Tailgate, in the variant's own authoring frame, where the gate line is
   local z = -1.95 (the pool sets `vg.position.z = +halfZ`): **mouth on the road
   at local z = -1.95, y = 0**; **top meeting the deck at local z = +4.05, y =
   2.80** (`RAMP_RUN` 6.0); **one lane wide, x in [-0.85, +0.85]** (LANE 1.70),
   inset inside the body exactly as the reference draws it; **slope 25.0
   degrees** (atan(2.80 / 6.0)). It must NOT be part of the scaled body -- the
   body takes `scale.z = span` -- so it belongs on the un-scaled `moving` child
   or on a variant built for the job.

47. **A vehicle you can see is a vehicle you can hit. The flank is solid now,
   the owner decided it, and it changed the difficulty of the game by nothing
   at all -- which is a measurement and not a hope.**

   The hole was older than the ramp and larger than it looked.
   `player.resolveGates` was the only contact path in the game and it fired at
   one plane, `gate.z`, while a BLOCK train is ONE gate carrying up to 17.9
   units of vehicle. Driving the real `MR.Player` into the flank of every train
   on the calendar: **4895 of 4895 recorded no contact at all.** You could run
   the whole length of a tram, and every lane-reasoning thing in this project --
   `solvable()`, the spacing floor, the telegraph mats, the bot, `tools/shoot.js`
   -- reasoned at gate lines and none of them noticed.

   The owner was shown that, told plainly that closing it makes the game harder,
   and chose to close it. The condition was that the record contract be
   re-measured before it ships. It was, and the answer is the thing worth
   recording:

   **`tools/simulate.js` IS UNCHANGED TO THE SECOND. 1 mistake with no aid, 2
   taking half, 3 taking all of it -- the same table, on the same four dates,
   before and after.** That is not luck and it is not a fudge; it is what the
   instrument measures. simulate.js prices the COST of a mistake, and solid
   flanks do not touch the cost of anything: course generation is
   bit-identical (`--identity` still gives
   `f046dcfc84a59c08a3a7b51c78449853f3bd90f8`), no gate moved, no aid moved, and
   a contact costs what a contact always cost. What solid flanks change is the
   RATE, and **no tool in this project measured a mistake rate.** Reporting
   simulate.js as evidence that nothing got harder would have been true and
   useless. So the rate was measured separately, with the bot, on the shipped
   course with both scalars off:

   - a bot that plans off the GATE TABLE alone -- which is the model the game
     itself had until this pass -- takes **137 contacts in four races and
     finishes 2:08:47 against 1:57:55**. That is the size of the forgiveness
     that was being given away.
   - a bot that will not step sideways into a lane with something in it takes
     **0 contacts and finishes 1:57:55**, which is the number before the change.

   **In plain words for the owner: this costs a player who looks at the road
   nothing whatever. It costs exactly the run that steers into a lorry it can
   see.** The record is as reachable as it was.

   **THE STRUCTURAL FIX, WHICH IS WHAT MADE IT SAFE.** `MR.Course` now states
   lane occupancy ONCE -- `course.occupiedAt(z, lane)`, spans built from the
   same nose-anchored `[gate.z, gate.z + 2 * halfZ * (1 + 0.9 * span)]`
   expression `reachOf`, `world.js`'s `gateBoxes`, `ramp.js` and `shoot.js`
   already use. One solid, five files describing it. `deckAt` and `rampAt` are
   now views on that instead of a private ramp list, so a taxi and a lorry are
   the same kind of fact and only the rideable ones carry a surface.

   **`solvable()` NEEDED NO CHANGE, AND THE REASON IS STRUCTURAL RATHER THAN
   LUCKY.** Every span is contained in one gate interval, guaranteed: `spacingAt`
   owes the next gate `readWindowAt + reachOf`, so a vehicle's far face is at
   least 25.35 units short of the next gate line. "Lane l is free at gate i" and
   "lane l is unoccupied from gate i to gate i+1" are the same statement -- which
   is exactly what the BFS always assumed without being able to say so. What IS
   new is crossing THROUGH an occupied lane, and the room to do it is that same
   25.35 against the 6.0 two lane changes cover. `validate()` now proves both on
   every course, and `tools/mechanics.js --transit` proves them over 28,040
   spans on the calendar: **0 vehicles reach the next gate line, tightest clear
   road 25.3u.** It is the assertion that fails first if anyone retunes the
   sightline floor, the jump arc or the pace floor.

   **TWO CONTACT PATHS OVER ONE SOLID, DIVIDED AT THE NEAR FACE.** `resolveGates`
   already charged for a BLOCK taken head-on AND decided whether the gate was
   clean. Left alone, `resolveDeck` would fire on the same step -- bouncing the
   runner into a free lane BEFORE `resolveGates` looked, turning a wall into one
   flank contact PLUS a free clean gate. The division is physical, not
   procedural, so it does not depend on call order: a span's near face IS its
   gate line, `unitsBefore < span.z0` is a head-on arrival and belongs to the
   gate. A mount is the one exception and has to be, because `clears(BLOCK)`
   asks `onDeck` and a mount settled one step late records the runner colliding
   with the lorry he is visibly running up. The probe that catches this is
   `HEAD`, and it asserts on **clean gates credited: 0**.

   **THE CONTROL IS THE PROBE THAT MATTERS.** Three scenarios, not one: SIDE
   (swerve in mid-vehicle -- exactly one contact, never zero, never the
   per-frame re-fire), HEAD (take it at the gate line -- still exactly one, and
   no stolen streak), and **PAST (stay in the clear lane -- zero)**. Without
   PAST, a fix that made EVERY lane solid would have passed the other two.

   **FAIRNESS (rule 4).** Nothing new is invisible: the vehicle was always drawn
   for its whole length, and what changed is that the game stopped disagreeing
   with the picture. `shoot.js` is clean -- LOW, HIDES, BLANKS, PAINTS, the
   envelope guard and the contrast gate all pass, and the eight shots take 0
   hits. The read is easiest exactly where the mistake is made: at the moment of
   contact the tram fills the right of the frame
   (`shots/flank/flank-1-contact.png`). What a player has to read is PRESENCE,
   not length, and presence is legible from the decision point 30 units out
   (`shots/flank/flank-0-approach.png`).

   **THE INSTRUMENT WAS WRONG, AGAIN, AND AGAIN IT FLATTERED.** Two defects,
   both found by turning the flank solid:

   - `occupied()` in `tools/mechanics.js` -- the helper the previous pass called
     "THIS FUNCTION IS THE FINDING" -- asked `deckAt > 0`, which is the height of
     a RUNNING SURFACE and is **zero over every vehicle that is not rideable**.
     The "flank-aware" column was aware of ramps and blind to the other 27,000
     vehicles on the calendar. It read as correct only because nothing but a
     ramp could be hit. An instrument that is right because the bug it would
     expose does not exist yet is not right.
   - awareness was in the wrong PLACE. Putting it in the plan -- reject any lane
     with a vehicle between here and the gate -- made the table report **13
     gates a race with "no way out"**, every one of them a gate `solvable()` had
     proved passable. A lorry between you and a lane is not a reason to give the
     lane up, it is a reason to WAIT, and the course guarantees the room. Moving
     it into the step took the same bot from 35 contacts to 0. `main.js`'s own
     bot had the identical defect and now holds the step the same way; every
     frame this project photographs is bot-driven, so a bot that drives into
     lorries does not merely score badly, it makes the whole shot library a
     picture of a broken run.

48. **The roof pickup paid out at road level, so the ramp was free -- and the
   camera on the way up, along and down needed nothing.**

   `resolveAid` took lane match alone, deliberately and correctly for a bottle
   on the road. With roof items on the course that made the ramp **strictly
   free**: the item sits in the ramp's lane, so a runner at road level in that
   lane collected it from inside the lorry without ever mounting. Measured
   before the fix: **215 of 215 roof items collectable from the road.** After:
   215 of 215 on the roof, 0 from the road, and 0 road items inside a vehicle
   (that last was already true -- `generateAid` only ever places road items in
   lanes passable at both gates, and a rideable train's lane is BLOCK at its
   gate -- but it is checked now instead of reasoned about).

   The roof item also carries `y: DECK_Y` now. That is the interface to the art
   and it is on the ITEM rather than recomputed by the renderer, because a roof
   pickup drawn at road level is drawn INSIDE the lorry and is invisible in a
   diff -- nothing in course space is wrong. It is height above the LOCAL road,
   the same quantity `player.surface` and `camera.dk` already are, so `world.js`
   adds it exactly where it already adds `elevation.at(z)`. Only roof items
   carry it; a `y: 0` on every road item would change the aid JSON and break the
   identity hash for nothing.

   **THE CAMERA IS FINE AND HERE ARE THE NUMBERS.** Sampled every frame through
   a whole ride on the real page: climbing, the eye trails the ground under the
   runner by at most **1.39u**; falling, it sits at most **1.13u** above it;
   both terms are added to the eye AND the aim, so the PITCH never moves and the
   whole shot simply rides with the ground. It reaches the deck to within 0.02u
   about 28 units into a 35.5-unit ride, so most of the ride is spent settling
   -- which reads as the ground rising into the shot rather than as a cut, and
   the frames say so (`shots/flank/ramp-1-mouth.png` through
   `ramp-6-landed.png`). The landing is legible: mid-fall the next gate, its
   telegraph mat and its cones are all already in frame. **No camera change was
   made, because none was earned.**

   One property of the ramp worth knowing before `RAMP` is switched on, and it
   is not a defect: a bot that INSISTS on every ramp hit the flank on **2 of 13
   approaches**. Both were a ramp two lanes away across an occupied middle
   lane -- it waited for the crossing, arrived past the top of the tailgate, and
   met the flank instead of the mouth. A human abandons the ramp; the bot does
   not, which is what makes the number visible. It is the one way taking a ramp
   can cost a contact that going round it would not.

   **`RAMP` STILL DEFAULTS TO 0, AND THAT IS THE ONLY THING LEFT.** Everything
   structural is done -- occupancy, the flank, the roof reward, the landing
   proof, the camera. What is not done is the art, and `src/render/ramp.js` is
   still the deliberately plain orange placeholder: `shots/flank/ramp-1-mouth.png`
   shows a TRAM drawn inside it, because `world.js` casts its own BLOCK variant
   in that lane and the placeholder is a second solid over the same footprint.
   Correction 46 is the spec for the real tailgate. Flipping the default is one
   line in `course.js` the day that lands.

49. **The face was 0 pixels in every frame the game has ever drawn, and the fix
   was a camera, not a face.**

   The character pass built a face -- two eyes with catchlights, brows heavy
   enough to furrow, an open mouth, a jaw -- measured it at **0 pixels in 48 of
   48 frames of play**, and shipped it anyway under rule 1. It also checked the
   two places that might have saved it and found neither did: the start panel is
   a DOM dialog over the same astern view, and the finish camera drifts 1.6
   units off the centreline and stays **behind** him. Nothing on that face had
   ever been on a player's screen.

   The camera now leaves the chase after the tape and arcs round to
   three-quarter front. Measured on the shipped build at 390x844
   (`tools/celebrate.js`), brow line to chin:

   | | face px | % of frame height | turn to lens |
   |---|---|---|---|
   | in play, every state | **0** | 0 | 180 deg |
   | held shot, 390x844 | **96** | 11.4% | 21 deg |
   | held shot, 320x568 | 65 | 11.4% | 21 deg |
   | held shot, 620x1344 | 154 | 11.5% | 21 deg |
   | held shot, 1280x800 | 91 | 11.4% | 21 deg |

   ...for **3.4 seconds**, from the moment the arc brings him round at t=1.8 to
   the results card at t=4.9. The fraction is the same to a tenth of a percent
   at every size the game is played at, because the framing is set by a lens and
   a radius rather than by pixels.

   It costs **zero draw calls**, and in fact spends fewer: the frame draws 108
   during the astern tape-break and **63** once the camera is round the front,
   because a lens pointed at a runner three units away has most of the chute
   behind it. No geometry was added at all.

   Three things came out of it that outlive the pass.

   **A CLAMPED dt IS THE WRONG CLOCK FOR A PARAMETRIC MOVE.** The first version
   integrated the celebration clock from `camera.update`'s own `d`, which is
   clamped to 1/25 so a long frame cannot detonate the springs. On the 7fps
   SwiftShader harness that plays a 2.6-second move at **28% speed** -- while the
   results card, on a real `setTimeout`, arrives a third of the way through it.
   Springs want the clamp; paths want wall time. `main.js` now owns one
   unclamped celebration clock and hands it to both `camera.js` and `runner.js`,
   and exposes it as a **settable** `MR.game.celT` so a harness can rewind it.

   **A LANDMARK FOUND BY SEARCH CAN FIND THE WRONG THING, AND IT WILL FLATTER
   YOU.** `celebrate.js` locates the chin as the lowest vertex of the head mesh
   on the front centre line. The head mesh is one weld that also contains the
   bare neck cylinder, whose bottom rim is 0.22 below the jaw and passes any
   `|x|` test -- so the first run reported a face of **152 px** where the answer
   is 86. Adding `z > 0.16`, which is forward of every vertex the neck column
   has, fixes it. Fifth instance in this project of an instrument flattering the
   thing it measured, and the first where the defect was in a landmark rather
   than in a formula.

   **THE ENDING HAD NEVER BEEN ASKED WHERE IT WAS IN ABSOLUTE x.** The finish
   drift is `+1.1` to `+1.6`, applied whatever lane the runner finished in. The
   outer lane centre is `+2.50` and the track half-width is `3.75`, so a
   right-lane finish already put the lens **over the shoulder, outside the
   track**, and the new arc would have taken it 3.6 further -- through a
   grandstand at `x = 4.30`. The ending is now mirrored to the side with room
   (`Camera.celSideFor`, which `runner.js` reads too so the head cannot turn
   away from the lens). Worst absolute case over all three finishing lanes:
   **3.63**, inside the track and 0.67 clear of the stands.

   **AND ONE THING LEFT OPEN, WHICH IS THE REAL COST OF THIS PASS.** The hand
   was designed at **26 px** -- three fingers deleted for being 8 px across, a
   knuckle row that drew a median of two pixels, a thumb kept only because it
   breaks the outline -- and every one of those decisions was converted through
   the right quantity at the framing that then existed. The finish comment in
   `runner.js` even says so: *"The finish does NOT help: its camera pulls BACK
   ... and the held shot has him at 52px."* That sentence is now false. At the
   held shot the figure is **588 px** and the hand measures **65 px**, two and a
   half times the largest it had ever been drawn. Nothing was rebuilt for it
   here -- a raised fist is what a runner crossing a line actually makes, so
   nothing is faked in the meantime -- but **four removals argued at 26 px want
   re-judging at 65**, and `tools/resolve.js` is the instrument that already
   knows how to do it. The same applies to the cap band, the wristband and the
   shoe, all of which are now seen from the front for the first time.

   **AND THE REACH IS 0.50, WHICH IS THE OTHER HALF OF THE SAME LESSON.** The
   first draft asked for the two poses everybody pictures at a finish line --
   fists high beside the head, and hands on the crown for the collapse -- and
   neither is reachable: shoulder to hand is 0.50, the shoulder sits at
   (0.222, 0.78) and the crown at 1.55, so hands on the head wants 0.687 of arm
   and hands above it 0.746. An unreachable pose does not fail loudly. It puts
   the arm somewhere else, and where it put them was **directly in front of his
   mouth**, in the one shot the whole pass exists to produce. Both gestures are
   now built from ABDUCTION, which is the axis with the room: 2.36 rad puts the
   fist at (0.575, 1.134), 0.31 clear of the skull. Pose targets on a toy rig
   want checking against the bone lengths before they are checked against a
   reference photograph.

   **TIMING IS A CAMERA QUESTION, NOT AN ANIMATION ONE.** The gesture was first
   written at 0.15-1.45s because that is when a celebration feels like it should
   happen. The camera is astern and high until 0.8s and does not reach the front
   until about 2.0s, so the whole gesture played out at 82-182 px of figure,
   seen from above, and was over before the lens arrived. It now runs 0.80-3.50s
   against a camera that is in front of him from 2.0. Nothing about the pose
   changed; only when it happens.

50. **Aid was scenery that happened to pay. A bottle now stands behind an
   obstacle, and the obstacle is what you buy it with.**

   The owner's instruction: *"Ensure waters and bananas are strategically placed
   so that they have to go around an obstacle to get it."* The generator already
   believed it did this -- it scored the open lanes and took the hardest -- so
   the first job was to find out what aid actually cost. `tools/aid.js` is the
   new instrument and it measured the shipped course three independent ways:

   | | before | after |
   |---|---|---|
   | items costing the cheapest line **nothing at all** | **56.5%** | **0.0%** |
   | items had for a lane change and no action | 42.5% | 0.0% |
   | items costing **at least one more action** | 1.0% | **100%** |
   | collected by four natural-line bots that cannot see aid | **64.4%** | **0.0%** |
   | collected by a bot that cuts in behind the gate | **13.0 of 14** | **0 of 14** |
   | a perfect bot going for everything, vs ignoring it | same time, same 0 contacts | same time, same 0 contacts |

   Three things made it free, and only the first was the one anybody suspected.
   The lane test was **relative** -- "the hardest of the open lanes" buys nothing
   at a gate whose three lanes are all clear, and it picked one at random. Half
   the pool was then scored *inverted*, into the easiest lane, which is free by
   construction; that was a real fix for a real problem (see below) and it
   solved it by giving the mechanic away. And the item sat in the **middle of the
   gap**, thirty units of open road from anything, so even a hard placement could
   be taken by dipping into the lane and coming straight back out.

   **THE RULE, WHICH IS ONE SENTENCE.** A bottle stands behind an obstacle, in
   that obstacle's own lane, at a gate that also offers a lane through for
   nothing. Every road item is laid 0.35 units past the rear face of a JUMP block
   or a DUCK bar, in the same lane as that hazard, and only at a gate that leaves
   some other lane CLEAR and leaves the aid lane open at the gate after. So the
   only way to the bottle is over or under the thing standing in front of it; the
   free lane is always right there to be taken instead; and paying once buys the
   item outright, because the gate ahead is never allowed to shut the lane you
   just bought your way into. Nothing about `solvable()` changes -- aid reads the
   gate table and writes nothing back, so the clean path of a player who ignores
   every bottle is the one the BFS already proved.

   **PLACEMENT ALONE CANNOT ENFORCE IT, AND THAT IS THE FINDING.**
   `player.resolveAid` was a lane match at a point and `changeLane` moves `lane`
   on the frame the input is served, so **any patch of road is reachable by a
   swerve**. Pushing the item up against the obstacle only shrinks the window --
   it never closes it, and it makes the answer depend on the frame rate, which is
   not a thing fairness may depend on. A bot that took the free lane at the gate
   and then cut in collected **13 of 14 items for half a contact** with the item
   mid-gap, and still **8 of 14** with the item 1.4 units behind the block.

   So a guarded item now carries the **index of the gate it stands behind**, and
   is bought at that gate rather than on the road: the runner has to have been in
   the item's lane when the gate resolved. Cleanly or not -- a runner who ploughs
   into the block still takes the bottle behind it, having paid with the streak,
   which is the whole point of a rescue. That is not a new kind of rule; it is
   the shape the **roof already had** one step down, where an item is collected
   only by a runner standing on the ramp that carries it. The cut-in bot now
   collects **zero**.

   **THE RESCUE ARGUMENT IS ANSWERED RATHER THAN DROPPED.** Correction 40's
   finding was real: scoring every item for maximum difficulty produced a rescue
   mechanic only a player who did not need rescuing could reach -- 71% of items
   demanded an action at the gate on *both* sides, so aid was gated behind two
   consecutive clean clears asked of the one player who cannot string two
   together. The fix for that was never "make half of it free". It was to stop
   asking for a **chain**. This rule charges exactly one action at exactly one
   gate and forbids the gate ahead from asking for another. A bot fluffing 30% of
   the actions it attempts still collects **100%** of the aid on the course.

   **IT IS A DECISION AND NOT A TAX, AND SAYING SO NEEDED A THIRD COLUMN.** Run
   the two bots side by side and going for the aid wins at every ability level,
   which read as a tax on declining. It is not, and the reason is that the two
   bots are not taking the same bet: the one that ignores aid jumps only when it
   has to, and the one that goes for a bottle jumps because it **wants** to, in a
   lane it chose against a clear one standing beside it. Holding base ability at
   6% of actions fluffed and adding an extra chance of missing **only the jumps
   taken to reach a bottle**:

   | extra fluff on the aid jump | finish | vs running past every bottle |
   |---|---|---|
   | 0% | 1:59:52 | **-49s** |
   | 25% | 2:01:43 | +63s |
   | 50% | 2:03:52 | +192s |

   **Declining becomes the better call once a player is 25% likelier to fluff the
   jump they took for the bottle than the ones they had to take anyway.** Below
   that, going for it pays. Both calls are live, which is the whole ask.

   **THE RECORD CONTRACT MOVED BY 1.3 SECONDS AND THE HEADLINE MOVED BY A WHOLE
   MISTAKE.** `tools/simulate.js` went from *"1 with no aid, 2 taking half, 3
   taking all of it"* to *"...4 taking all of it"*. Nothing got easier: n = 4
   finished **+0.6s** the wrong side of the record before and **-0.7s** the right
   side after, because aid items moved tens of units along the course and so
   landed their streak top-ups in slightly different places relative to
   evenly-spaced mistakes. An integer cut from a continuous number, reported
   without its margin, is exactly the sort of thing that sends the next reader
   hunting a difficulty change that was never made -- or retuning the pace model
   to put it back. **`simulate.js` now prints how close each of those integers is
   to being a different integer**, and the "all of it" column is labelled as the
   optimistic bound it is: it charges a player nothing for the risk of choosing,
   fourteen times, to jump a thing they could have run straight past.

   **FOUR DEFECTS IN THE INSTRUMENT AND THE WORK, ALL FLATTERING.** Rule 3 held
   again, in both directions. The miss knob in `tools/aid.js` counted fluffs in
   the per-frame action branch instead of once per gate, so the test flipped on
   and off inside a single gate and the frame where it was off fired the jump
   anyway -- **every miss rate reported 0.0 contacts**, which read as "aid is
   free even for a broken run". The DP offered the "be in the lane at the gate
   AHEAD" route unconditionally, which says nothing about being in that lane 27
   units earlier where the bottle is, and so reported items free that no line
   could collect -- flattering the **old** placement, the one direction that would
   have made this pass look unnecessary. In the generator, `Math.max(z, ...)`
   left an item wherever the density curve had wanted it whenever that was
   already past the gate, so items sat up to **46 units** behind nothing at all.
   And the hunt for a qualifying gate was unbounded at the end of the course: it
   could walk eight gates -- 250 units -- past the last legal aid point and lay a
   bottle **through the tape**. That last one is the ramp's run-in defect again,
   and again it needs 365 days to see.

   **ONE THING LEFT OPEN.** `world.js` decides when to pop a pickup with its own
   copy of the collection test, and its copy is the one this pass replaced --
   `e.it.lane === playerLane`. The two now disagree in exactly the case the guard
   exists for: cut in behind the gate and you get the animation and no gain; pay
   at the gate and swerve straight out and you get the gain and no animation.
   Both windows are under two units, so neither is reachable except on purpose.
   The hook is already there -- `player.lastGate` is the receipt -- and popping
   off that **deletes** the second copy of the rule rather than correcting it.
   Related: `main.js` fires `audio.aidMissed()` for every item walked past
   uncollected, which used to be a minority of them and is now nearly all of them
   for a player who declines. Worth a listen before it is called a bug.

   `tools/mechanics.js`'s identity hash covered gates **and** aid in one number,
   so a deliberate change to where the bottles go read as "course generation has
   MOVED" -- indistinguishable from a flag leaking into the gate stream, which is
   the thing the check exists to catch. It is two hashes now. The gate hash is
   `d24862235d30ff68daf8e6142d7162f1f230b6e1` and has **not** moved; the aid hash
   was re-taken once, on purpose, and the split was checked to reproduce the old
   combined `f046dcfc...` exactly rather than being a re-baseline in disguise.

51. **The rideable roof is built, the placeholder is gone, and the route line
   with it -- plus three places the recorded contract was wrong about its own
   file.**

   `MR.Course.RAMP` waited two passes on art. Everything structural was already
   proved (entries 46-48: occupancy, the solid flank, the roof reward, the
   landing, the camera); what did not exist was a vehicle you could stand on.
   It exists now, as BLOCK v0 itself rather than as a prop beside it.

   **THE DECK. Measured before, on a downward raycast over the footprint: the
   tram roof ran 2.340 to 2.551 and varied 0.211, against a `Course.DECK_Y` of
   2.80 that the runner is placed at.** Four slabs tapering 2.24 -> 2.16 ->
   2.02 -> 1.76 and rising 2.10 -> 2.44 -- a good tram roof and not a surface.
   Now: **flat at 2.800, spread 0.000, over 100% of the vehicle's own width and
   the full stretched depth**, as three boxes topping out on one plane, a pale
   walkway between two near-black edge panels. Unchamfered on top, deliberately:
   `hcbx` cuts the top edge DOWNWARD, which would have made the deck flat at
   2.80 only across the middle. The one surface that is stood on is the one
   surface that has to be genuinely planar, so the chamfer moved to the mass
   under it.

   **THE PANTOGRAPH HAD TO GO, AND THAT IS THE DECK'S DOING RATHER THAN A
   PREFERENCE.** Its shoe topped out at 2.77 "against the 2.80 the collision box
   records" -- 0.03 of slack that existed only because the roof under it stopped
   at 2.44. With the roof at 2.80 there is no space above it for anything at
   all. It also sat at local z -0.40, which on a rideable train is halfway up
   the ramp, and a pantograph on a roof you run along is a wall wherever it is
   put. `anim` went with it, and that is required rather than tidy: the sway
   lifts the whole variant by +/-0.012, so a deck authored at exactly 2.80 spends
   half of every cycle at 2.812 -- outside the box -- while the runner, pinned to
   a constant DECK_Y, watches the floor slide through their feet. **A vehicle
   that is stood on cannot shudder.**

   **THE TAILGATE IS THE VEHICLE'S OWN TAIL, OPENED.** An unscaled child at
   local z -1.95 to +4.05, climbing 0 to 2.80 at 25.0 degrees, with two full-
   height tail walls either side so the mouth is a portal rather than a plank
   leaning on a lorry. Measured on the running page against the contract line
   `2.80 * dz / 6.0`: **err 0.000 the whole way, and +0.050 exactly where a
   tread cleat stands proud.** It is drawn ONLY where `gate.ramp` names the
   lane; a ramp down on something you cannot ride would be the game lying about
   an affordance. That is also the read, and it is the reference's: two lorries
   side by side, and the one you can take is the one with its tail open.

   **THE SCALED BODY IS SHORTENED BY EXACTLY THE RAMP.** A train sets
   `body.scale.z = span`; a ramp's 6.0 must come off it or the tram is 6.0
   longer than the collision box that decides whether it was hit. `s = span -
   RUN / (2 * halfZ)` and the body slides forward by RUN, both from the one
   subtraction so they cannot disagree.

   **THREE THINGS THE RECORDED CONTRACT (entry 46) GOT WRONG ABOUT THIS FILE,
   all one root cause -- it was written in lane units and the art is not.**

   - *"one lane wide, x in [-0.85, +0.85] (LANE 1.70) ... inset inside the
     body"*. Those two clauses contradict each other: hazard widths go through
     `LANE_FIT` (= LANE / 2.35 = 0.723), so the tram's authored 2.24 is **1.62
     units on the road** and a 1.70-wide ramp is WIDER than the tram it is cut
     into. Inset is the clause that survives; the ramp is 1.20 across. Nothing
     in the mechanic reads the width -- `deckAt` and `occupiedAt` are indexed by
     LANE, not by x -- so the whole of that number is art.
   - *"deck flat at 2.80 across 100% of x within +/-1.12"*. 1.12 is
     `BOX.halfX`, the collision envelope, and **no vehicle in the fleet is that
     wide**: measured, the twenty-one variants run 0.675 to 1.102, and the tram
     is the narrowest at 0.830. A deck built to 1.12 would be a plank overhanging
     the vehicle by 0.32 a side. The deck is 100% of the VEHICLE.
   - The recorded roof numbers (89% covered, 2.399-2.750) did not reproduce;
     this pass measured 77.8% / 2.340-2.551 on a 9x9 grid. Both are sampling
     artefacts of a coarse grid over a tapered roof and both say the same thing.
     **The number worth keeping is the one neither grid could disagree about:
     the roof was not flat and it was not at 2.80.**

   **THE INSTRUMENT WAS WRONG FIRST, AGAIN (rule 3).** The live probe collected
   the pooled hazard groups and called `intersectObjects(.., true)`. THREE's
   Raycaster **does not test `.visible`** -- and a pooled BLOCK carries all ten
   variant bodies stacked at one place with nine hidden. So it read the roof of
   whichever variant happened to be highest and printed a flat, entirely
   plausible **2.760 over the whole tailgate**: a ramp measured through nine
   other lorries. It collects visible meshes with no hidden ancestor now.

   **AND THE CONTRAST GATE MEASURED A DIFFERENT OBJECT.** Built with the tail
   open by default, BLOCK v0 fell from over 1.6x to **1.30x against a fatal floor
   of 1.25x** -- not because the object got worse but because `assembleVariant`
   had been switched to a state that is 3.70 gates a day out of hundreds. Closed
   by default, every contrast number matches the baseline to the digit. A tool
   that wants the open state asks for it. **The envelope guard is the opposite
   case and gets its own row**: the tail is 6.0 deep against a span-1 box of
   3.90, which is not a violation because it only ever exists on a train of span
   8.2+, so it is checked against the volume the cast site reserves for it --
   `[-halfZ, -halfZ + RAMP_RUN]` -- which also proves the tail and the shortened
   body neither overlap nor leave a gap.

   **WHAT THE FIRST RIDE THROUGH THE CHASE CAMERA CHANGED, AND IT WAS NOT THE
   NUMBERS.** The deck measured perfect and read as a painted path at road
   level: standing on a roof, the vehicle's flanks are hidden BY the roof, and
   mid-blue edge panels were the same value as the canal beside them. A raised
   lip is unavailable at a 2.80 ceiling, so the edge is made of VALUE -- near
   black against the pale walkway. The tail walls went from 0.11 to 0.21 wide
   (the ramp narrowing from 1.40 to 1.20 pays for it) because at the mouth,
   where the whole read is "there is a way INTO this thing", a doorway is made
   of its jambs. Neither was visible in any measurement; both were obvious in
   one frame.

   **THE ROUTE LINE IS GONE.** The owner asked -- *"Players don't need to be
   told where to go"* -- and three separate findings agreed with him: a blind
   reader flagged it unprompted in every picture of two separate sets (*"a
   purple-violet smear... shaped like nothing"*), it was measured out-shouting
   the aid pickup at READ_NEAR (2nd of six against the pickup's last), and
   dimming could not fix that because a ribbon loses area linearly with distance
   and a pickup quadratically. Removed properly: `racingLine`, `routeTexture`,
   `ringTexture`, both meshes, `updateRoute`, `routeX`, `routeQuad` and the
   replan in `api.update`. **It carried no other function** -- `api.routeLane`
   existed "so it can be asserted against the course", and nothing in the repo
   ever asserted it. **`tools/routeread.js` now measures an object that does not
   exist** and should be deleted by whoever next owns tools.

   **THE ARCHWAY IS SCENERY AND CANNOT OCCLUDE A GATE, BY CONSTRUCTION.** Entry
   35 said the lane closure is not worth shipping and the archway is worth
   having as a set piece; this is the set piece. It springs at OVERHEAD_Y + 0.35
   -- the same 9.35 the mile gantry and the finish arch use -- from |x| = 4.95,
   outside CORRIDOR_HALF, and the spandrel above it is **a comb, not a slab with
   a hole**: every column's bottom is generated FROM the arch curve at its own
   x, so no arithmetic error can put masonry below the opening. A subtracted
   hole would have been one sign away from a stone wall across the road. The
   string course at the springing is two pieces for the same reason -- written
   as one band it is a beam through the opening at 9.14. It costs the occlusion
   assertions nothing: LOW, HIDES, BLANKS and PAINTS all clean at 60, 25.35 and
   5 units and through.

   **`src/render/ramp.js` IS DELETED.** `reference/solid-ramp-mouth.png` was a
   picture of the double draw -- a tram inside the orange placeholder, because
   world.js cast its own BLOCK over the same footprint.

   **AND THE PICTURE WAS LYING ABOUT THE AID RULES.** Landed in the same pass
   because it is a `world.js` line and it was live. The aid pass (entry 50)
   replaced the lane-match test with a receipt -- a road item is bought at the
   gate it stands behind -- and `world.js` still decided the POP from its own
   copy of the old test, under a comment asserting the two "can never disagree".
   They disagreed both ways inside a sub-two-unit window: pay at the gate and
   swerve out, and you got the gain with no animation; take the free lane and
   cut in behind it, and you got the animation with no gain. Three frames
   either way, and the worst class of bug this game has -- the picture
   contradicting the rules, in a game where one contact ends a record.

   The second copy is DELETED rather than corrected. `aidTaken` reads
   `item.gate` from the course and `lastGate`, `ramp` and `onDeck` from the
   player, so there is no policy left in the renderer to drift out of step, and
   if resolveAid's terms change this stops popping rather than popping wrongly
   -- the failure direction a renderer should have. **A comment saying two
   things cannot disagree is not a mechanism for stopping them disagreeing**;
   the only reason the old one was ever true is that nobody had changed the rule
   yet. `api.aidState()` exists now so the property can be asserted instead of
   argued: every item that pays pops, and every item that pops has paid.

   **`RAMP` IS ON, AND THE IDENTITY GUARD KEPT ITS GOLDEN NUMBERS.** Flipping
   the default broke `tools/mechanics.js --identity` -- it hashed
   `Course.generate` at whatever the DEFAULTS happened to be and called that
   "flags off", which is true only for as long as both flags ship at zero. The
   day RAMP ships at 1 that sentence goes quietly false and the check reports
   "GATE generation has MOVED", **indistinguishable from the thing it exists to
   catch**: a flag leaking into the seeded stream.

   The fix is not a re-baseline. The invariant being protected was never "the
   defaults are zero", it is "NARROW and RAMP draw no random numbers when OFF",
   so the flags are now SET to zero for the hash rather than assumed to be, and
   the shipped defaults are printed beside it. **Neither baseline moved** --
   gates `d24862235d30ff68daf8e6142d7162f1f230b6e1` and aid
   `e81209a3dd064fbebaf5c7253b4d3ac0c634d39b`, both bit-identical with RAMP
   shipping at 1. That is the check doing exactly what it was built to do: the
   number that must never move has not moved, and it now survives a release
   that turns a mechanic on. A guard that has to be re-based every time a flag
   ships is a guard nobody will believe the third time.

   What shipping it costs, measured: **+1.1s on a perfect run against a 95s
   margin**, 186.3 gates against 186.5, 90 courses still deterministic and
   solvable, and the 32-day calendar clean at 12/12 settings and 72/72
   setting-biome pairs. The bot takes 11 mounts, 11 clean dismounts and **0
   falls off the side**, and 215 of 215 roof pickups are collectable on the
   roof and 0 from the road.

52. **A cue that meant something under one design becomes a nag under the
   next, and it will not announce itself.**

   `main.js` fired `audio.aidMissed()` for every bottle that went past untaken,
   under a comment calling it *"the one event in the run which is pure loss and
   has nothing to mark it"*. That was true of the placement it was written
   against. Correction 50 put the bottle **behind an obstacle in that obstacle's
   own lane, at a gate that always leaves a free lane through** -- so declining
   became the ordinary outcome and usually the correct one. Measured on the
   shipped build, driving the real page through four whole races:

   | | items | declined | old cue would fire | new cue fires |
   |---|---|---|---|---|
   | bot=1, 0 contacts | 15 | 15 | **15** | **0** |
   | bot=0.9, 14 contacts | 15 | 15 | **15** | **1** |
   | bot=0.8, 27 contacts | 15 | 15 | **15** | **1** |
   | bot=0.7, 43 contacts | 15 | 15 | **15** | **1** |

   Fifteen times a race, *including on a flawless run* -- a sound telling the
   best possible player off fifteen times for correctly declining something
   worth nothing to them.

   **THE NEW RULE IS DERIVED, NOT CHOSEN.** `pace.onAid` grants
   `min(streak + gain, gatesSeen, AID_CEILING) - streak`, so a bottle is worth
   exactly zero to a runner whose streak already equals the gates they have
   passed. `main.js` now computes that same expression for the declined item and
   speaks only when it would have paid **at least half its face value** -- which
   is to say, only on a run that has actually come apart, which is the run the
   rescue half of the aid pool exists for. It cannot fire on a clean line at all.

   **AND ONCE, NOT FIFTEEN TIMES.** The informative event is the first one;
   the fifteenth is scolding. It is an edge, fired at the crossing and never
   held, re-armed when the player takes an item -- the same shape `recordLost`
   and the tier cues in the same file already use.

53. **Six obstacles the owner could not name, four that were the same object,
    and a caution board that was the reason for both.** The report was
    *"Idk what an Amber kerb or cable drum is... I had no idea a kick scooter
    was one... All duck obstacles looks exactly the same."*

    **THE JUMP SET SHARED ITS LARGEST ELEMENT AND NOBODY HAD MEASURED IT.**
    `tools/framing.js` census, at the 8 units where identification happens:
    **51.7% of the kerb's pixels and 28.6% of the trench's were the same
    2.2-wide red-and-white caution quad**, and five of the six variants turned
    it at the lens. Whatever else differed between two JUMPs, the biggest thing
    on both was identical. That is what *"make it a different color than the
    rest"* is describing, and no amount of modelling behind the board could fix
    it. Four of the six now decline the face; the two that keep it wear it as a
    low kick band under the sightline rather than as a panel across the middle.

    **A HOLE NEEDS A SIGHTLINE, AND THE SIGHTLINE IS ARITHMETIC.** The trench
    had a full excavation -- rim, floor, walls, two ducts -- built and described
    at length, and a chevron board bolted across the front of it at y 0.40 to
    0.74. The lens is 2.2 above the road and 8 to 25 units back, so a ray to the
    trench floor passes the near lip at y 0.13 at 8 units and 0.055 at 25:
    **nothing above 0.20 at the lip can hide the floor, and nothing below it may
    span the mouth.** The guarding went to 0.50 and 0.71 and the near rim came
    down to 0.07. The first attempt put the rails at 0.40 and 0.645, which
    passes that test and still read as a fence with a shadow under it -- legal
    is not the same as legible, and the open band has to be a large FRACTION of
    the object, not merely unobstructed.

    **THE CONTRAST GATE IS THE REAL CONSTRAINT ON A DARK OBJECT.** An unguarded
    excavation models at L 95 against a lane-1 road of L 91.2 -- 1.04x, a build
    failure under rule 4. The white in the rails and posts is what buys the
    ratio back, so the guarding is load-bearing twice. The same trap caught the
    pipe stack: authored in a true terracotta it measured L 74.0 and a gate
    margin of **+0.042** against the finish carpet, one shading change from
    failing. Nine bores at 0.6 of each pipe's radius are 36% of the end
    elevation and they all face the lens; the dark was never going to be a
    minority of the object. Lifted to a bright clay it sits at +0.211.

    **THE SCOOTER WAS A RENDERING FAILURE, NOT A CONCEPT FAILURE, AND THE
    DIFFERENCE CHANGED THE FIX.** A kerb section and a cable drum fail the
    one-second test as CONCEPTS -- a loose kerb in a traffic lane is not a thing
    that happens, and "cable drum" is site vocabulary a player has no word for
    -- so both were replaced. A scooter is a real object everyone names in life,
    so the failure was measurable and local: 61.1% of the variant's pixels were
    the amber plinth it stood on, its wheels were five pixels across, and every
    part of it was the same amber and lemon as the plinth. Diagnose before
    replacing; the answer was different for the two cases.

    **AND DELETING THE PLINTH COST MASS THAT HAD TO COME BACK AS OBJECT.**
    With the platform gone the scooters read 0.58 / 0.20 / 0.07 / 0.13 on
    `tools/kindread.js` against 0.83 / 0.81 / 0.29 / 0.09 on the slab, and 1,771
    pixels at 8 units against 2,577 to 4,444 for the rest of the kind -- the
    thinnest object in the game. What replaced it is a SECOND upright machine
    and a second fallen one: the object is bigger because there is more object.

    **THE DUCKS LOOK ALIKE BECAUSE FOUR OF THEIR FIVE PARTS ARE FIXED.** The
    bar, the caution face in front of it, the daylight under it and the two tall
    verticals are all contract. Everything above the bar is confined to the
    standard's own x band because the camera sweeps y 1.76 to 3.14 down the lane
    centre. **The first rebuild tried to double the standards and the envelope
    refused it**: a standard sits at x 0.868 with r 0.15 against a box that
    stops at 1.12, so a second tube overlaps the first and its coupler leaves
    the box. *The count of verticals in a DUCK's rear elevation is not available
    as a differentiator at all, on any variant.* What is available is OUTLINE,
    TOP TERMINATION and one big shape on the standard, and all five now spend
    all three. Mean pairwise profile separation over 14 bands went **0.468 to
    0.616**, and the closest pair -- v1 and v2, which photographed as one object
    at 0.130 -- is now **0.380**, the new minimum being v0/v3.

    **TWO VARIANTS WERE IDENTIFIED BY THE SAME DISC.** v2's sign roundel and
    v4's valve wheel were both solid pale circles of r 0.24-0.25 at the same
    height on the same side of the same frame. The wheel is now an annulus with
    road visible through it. **A hole is something a nine-pixel mark can have
    and a hue is not.**

    **THE TRADE, WITH THE NUMBER, BECAUSE THE BRIEF ASKED FOR IT.** v3's rest
    post was cut from 3.20 to 2.30 to make the silhouette genuinely lopsided.
    Bands 11-13 went **0.31 / 0.29 / 0.29 to 0.21 / 0.23 / 0.15**, which is real
    mass removed from the top of the profile where a DUCK is told from a JUMP.
    The classifier is unmoved: **1 of 21 misread on profile, before and after**,
    and the only failure is BLOCK v9, which nothing in this pass touched. Bands
    7-9 -- the bar -- are untouched on every variant, and bands 0-6 are as open
    as they were or slightly more so, because every member added anywhere in the
    kind is above y 1.90 by construction.

    **HUE WENT 8 MISREAD TO 14, AND THAT IS THE POINT.** The JUMP set is now
    sand, orange, red-and-white, teal, blue-and-white and terracotta. The file
    already records that hue is not the kind channel and the profile is; this
    pass spends the hue on saying what each object IS, which is what the owner
    asked for, and the profile classifier is what proves it was safe.

54. **A number nobody re-measured forbade the one thing every DUCK needed. The
    camera stopped flying at 2.05 five passes ago and the rule written against
    it kept ruling.**

    A blind reader shown unlabelled 1:1 crops through the live chase camera at
    8, 12 and 25 units routed every JUMP correctly and answered every one of the
    five DUCKs *"UNDER, low confidence"* with OVER live on all five. Its own
    diagnosis is the most useful sentence in the report: *"Absolute heights of
    anything. This is the biggest gap. Nothing in these images gives me a
    reliable scale reference next to the objects, so every over/under/around
    judgement I made is a judgement about proportion and silhouette, not about
    measured clearance."* And on the mark: *"The yellow-and-black diagonals tell
    me danger... They do NOT tell me over or under."* A DUCK cannot be jumped --
    `collision.js` reads `surface` and deliberately not `y + surface` for
    exactly that reason -- so reading OVER costs the run.

    **THE MECHANISM WAS IN `tools/kindread.js` ALL ALONG, AS ONE LINE OF THE
    TABLE.** A DUCK's occupancy from the road to 1.40 ran 0.22-0.30, and its
    occupancy from 2.00 to 2.80 ran 0.25-0.35. **The top of a DUCK and the
    bottom of a DUCK were the same number.** Two thin posts under a bar and two
    thin posts over it is a shape with no preferred direction in it: whatever
    the open bottom argues for going under, the open top argues equally for
    going over. A hurdle has nothing above its rail; a low bridge has a metre of
    structure above its soffit. Nobody had ever read the profile that way, and
    five differentiation passes had gone by improving what the object was made
    of rather than where its mass sat.

    **WHY NOTHING HAD EVER BEEN PUT UP THERE, AND WHY THE REASON HAD EXPIRED.**
    `world.js` stated it as law over every DUCK in the game: *"The chase camera
    trails 5.1 units and carries 42% of the jump arc, so it sweeps y = 1.76 to
    3.14 right through a gate's lane. An earlier version had a header board at
    2.44 and the camera flew straight into it."* The incident is real. The
    sentence was written when `K.CAM_BASE_Y` was **2.05**, which
    `src/render/camera.js` still notes in passing, and the resting eye has been
    **3.10** for a long time. Nobody re-measured, and a stale number went on
    forbidding the one member the object most needed.

    Measured on the shipped page, over a real bot run pumped at a simulated
    60fps, sampling the live lens every frame and recording its height above the
    road directly under it at the instant it crosses a gate plane:

        lens above the road, whole run           min 2.83   max 5.74
        at a DUCK gate, inside the lane column   min 2.85   median 3.47

    Fifty-five crossings. The lens never came within a unit of the top of the
    bar. The claim that the camera sweeps the lane at 1.76 is wrong by more than
    the whole height of the thing it was used to forbid.

    **SO ALL FIVE DUCKS GOT A CLEARANCE HEADER**, filling the whole span between
    the standards from the top of the bar to 2.22 -- soffit shadow, web with
    ribs, top flange -- so the beam a player reads is 1.41 to 2.22, **0.81 deep
    against the 0.42 it was**, and there is mass above the road where there used
    to be sky. Bands 7-10 went **0.68 / 0.89 / 0.46 / 0.25 to 0.68 / 0.90 / 0.90
    / 0.90**, and bands 0-6 did not move at all: every member is above 1.83,
    which is `MR.Collision.BOX`'s own ceiling for the kind, so the daylight the
    previous pass bought is untouched. `tools/kindread.js` stays at **1 of 21**
    misread on profile and the tightest margin IMPROVED, **-2.235 to -1.247**.

    **THE RULE THAT REPLACES THE OLD ONE IS THE SAME SHAPE, PINNED TO A NUMBER
    THAT WAS ACTUALLY TAKEN.** Nothing across the lane above **2.22** -- 0.63
    below the lowest lens height ever sampled over a DUCK -- and nothing across
    the lane below **1.41**, which is not a camera rule but the collision floor.
    Above 2.22 the old rule stands unchanged: thin members, out at the
    standards. **Re-measured after the change and the minimum is unmoved at
    2.85.**

    **AND THE MAT WAS DRAWING A LADDER.** The DUCK telegraph glyph was three
    stacked rungs, on the channel this file itself calls the one the race is
    lost by misreading. A rung is a thing you climb. **A flat mat cannot draw an
    arrow that means "down"** -- every direction a floor can draw is a direction
    along the road, which is why the JUMP glyph is a ramp profile and not an
    up-arrow -- but it can draw the shape of the hole. It is now an inverted U
    with road showing through the middle, which is the silhouette of the object
    it precedes.

    **WHAT A BLIND READER MEASURES THAT NO INSTRUMENT IN THIS REPO DOES.** The
    panels are built by the same code path as `tools/framing.js` and they OMIT
    THE TELEGRAPH MAT by construction, because `api.variantObject` hands back
    the variant and the mat is its sibling. So every blind read this project has
    ever run has tested the object alone. That is the harder test and worth
    keeping -- but it is not what the player sees, and a pass that "fixes" a
    read by strengthening the mat would not show up in it at all.

    **THE TRENCH WAS BEING SEEN THROUGH A LETTERBOX, AND THE MEASUREMENT IS THE
    APERTURE.** The reader called JUMP v2 *"red-and-white boards on a low bed"*
    against an owner's ask for *"a visible trench"*. What a player sees of an
    excavation is not the depth of the hole, it is the screen slot between the
    top of the near rim and the underside of the near rail -- and through that
    slot the ray from the lens hides everything on the far wall above y 0.27, so
    a 0.50 wall showed **0.11 of itself**. Every pixel in the slot was warm
    mid-tone: duct, coupler, conduit, spoil, and a pale sub-base band across the
    far rim sitting exactly where the void should be. Aperture **0.30 to
    0.425**, far wall visible **0.11 to 0.247**, spoil moved to the side rims,
    ducts dropped 0.02. Deleting a rail was refused with a number: this variant
    is the tightest hazard in the game on the contrast gate and the white in the
    rails is what buys the ratio -- it now sits at **1.32x/+0.053**, which
    passes and is the thinnest margin in the file.

55. **Every driven channel has a floor, and the floor is not the bottom of the
    range. The start line was a state the game had never been able to express.**

    The owner: *"Before the game starts and it counts down from 3-2-1 the player
    is running in place. That's not realistic. Make it so he is standing still
    and then starts running when the time goes off."*

    The obvious build is to damp the run cycle to zero for the three seconds of
    the countdown, and it is wrong for a reason worth keeping: **a held pose is
    not a stopped cycle.** Damped out, this rig sits with its knees at 0.18, its
    ankles at -0.16 and its trunk folded 0.26 rad forward -- a runner mid-stride
    with the clock paused, which is a mannequin holding a run. The standing pose
    is authored instead: knees straighter, feet wider, the trunk up out of the
    racing fold, a breath at 0.24 Hz and a weight shift at 0.11 so the two never
    read as one motion.

    **THE FINDING THAT OUTLIVES THE PASS IS ON THE FACE.** The expression system
    assembles everything out of `effort`, and effort is written
    `0.30 + 0.52*sp01 + 0.85*max(0,grade) + 0.55*surge` -- so its FLOOR is 0.30
    and no input can take it lower. A man standing on a start line is at effort
    **zero**, which is a value nothing in this game had ever asked for, so left
    on the drive he would have waited for the gun wearing the face of someone
    three miles in: mouth open 17% of its travel, lower lid up, brow down. The
    finish had already hit exactly this and overridden the drive; the start line
    hits it again and takes the same answer. **A signal assembled out of
    gameplay terms describes gameplay, and the two seconds either side of a race
    are not gameplay.** Anything else built on `effort`, `sp01` or `surge` should
    be read against that before it is trusted at either end of a run.

    **THE TRANSITION IS THREE THINGS AT THREE RATES, AND THE POSE BLEND IS THE
    SMALLEST OF THEM.** A crossfade from a held pose to a running one is a
    dissolve; a start is an event. `main.js` hands the runner and the camera a
    ground speed that is zero at the line and ramps over 0.34 s, against a 0.72 s
    pose blend. Cadence is a power of speed, so zero speed **freezes** the stride
    phase rather than turning it over under a motionless body, and the phase then
    opens from a standstill instead of resuming wherever the countdown left it.
    And the surge signal in both `runner.js` and `camera.js` -- a smoothed
    derivative of ground speed, built for *"acceleration = temporary stronger
    push-off/lean"* -- **had never seen a step in this game's life**, because
    pace only ever eases. A start hands it 0 to 21.8 u/s. It saturates and drives
    lean, hip extension, knee drive, toe-off and the camera's own trail-back for
    about a second and a half, on constants that were measured for exactly this
    and had never had a moment to fire in.

    **WHAT IT COSTS, STATED.** `pace.js` starts the race at START_PACE on the
    frame the gun goes, so for the length of the stride ramp the world moves
    faster than the legs turn over and the feet skate. No pair of constants
    removes that: a runner who is stationary at t=0 and travelling at 21.8 u/s at
    t=0 skates by construction. The ramp is short for that reason and no other.
    Removing it properly means the pace model accelerating off the line, which is
    a change to the thing every finish time in the save file was measured
    against.

    **AND THE POSE IS MEASURED, NOT EYEBALLED.** `tools/envelope.js` grew two
    rows, `stand` and `stand-half`, because the standing pose has one number that
    no screenshot can show: **low**. The stride plants its foot by solving the
    ankle so hip + knee + ankle sums to zero, and there is no road clamp outside
    a slide, so a stand that got that sum wrong would float or sink and only a
    side elevation would ever catch it. The first draft sat the body at half the
    run's bob amplitude -- reasoning that a frozen phase parks the trunk at the
    bottom of its bob, which is true and beside the point -- and measured
    **+0.0092 above the tarmac** where the run plants at -0.0098. `body` is the
    parent of `hips`: anything written to it lifts the legs with the trunk. The
    breath is on `spine` for the same reason. It now plants at **-0.0108**, and
    the eight play silhouettes came through the whole pass unmoved to five
    decimals.

56. **A pause button on a time attack is an information leak before it is a
    feature, and a resume countdown over a revealed frozen world makes it
    worse.**

    The owner: *"Can we add a pause button into the game."*

    This game is a daily time attack on a deterministic date-seeded course
    against a 1:59:30 ghost, and one contact ends a record attempt -- so the
    resource every decision in it spends is **time to read the road**. A naive
    pause hands that resource out for free: stop on the frame a gate resolves
    into three lanes, study it for as long as you like, resume with the answer.

    The reflex answer is a resume countdown, and **done the obvious way it is a
    bigger gift than the pause it is guarding**: a 3-2-1 over a revealed, frozen
    world is three more seconds of free look. So the countdown runs BEHIND the
    panel, the panel is a solid fill where the other two are `rgba(...,0.9)`, and
    the world reappears on the same frame it starts moving again. Three
    mechanisms, because no one of them closes it alone -- the fill removes the
    information, the countdown removes the ambush, and `controls.enabled` going
    false from the pause until the gun removes the pre-loaded input, since
    `controls.js` DROPS rather than queues while it is false.

    **WHAT IS LEFT IS ON THE RECORD RATHER THAN IN A COMMENT.** A player can
    still think about a frame they had already been shown for as long as they
    like. Taking that back needs the race to resume some distance behind where it
    stopped, and a rewind means unwinding `pace.units`, `player.gateIdx` and
    `player.aidIdx` together or double-counting a gate -- a change to the scoring
    path, which a UI pass should not be making. It is the open item here.

    **THE BUTTON IS IN THE TOP RIGHT, AND THE AWKWARDNESS IS THE POINT.** The
    four game verbs are swipes anywhere on the canvas, so a pause target under a
    thumb is a pause pressed by a mis-started swipe -- and an accidental pause
    during a record attempt is a worse outcome than a deliberate two-handed
    reach. This is the one control in the game that is never used in a hurry.
    Everything along the bottom edge is measured against the runner's shoe by
    `tools/footroom.js`, which the bottom plate already had to give up a whole
    row to pass; the top right is the slot the retired `#dist` plate left empty
    and is measured by nothing, which is why the offsets are `#dist`'s own at
    every breakpoint. 46px at every width, matching `.cta` -- **a control that is
    hard to hit is worse than one that is hard to reach.**

    Two smaller things fell out of building it. A tab going into the background
    already froze this game, because rAF stops -- but it froze it **silently and
    mid-gate** and handed the road back with no warning; `visibilitychange` now
    routes into the same pause, so the player comes back to a panel and a
    countdown. And the count is a full-frame element and so is the panel, so on a
    resume the digit landed across the DISTANCE plate: the panel now empties
    while the count is up, keeping the fill, which is the half of it that is
    load-bearing.

    **ONE THING IS NOT STOPPED, AND IT IS NOT MAIN.JS'S TO STOP.** Every
    integrator in the loop is stepped with 0 while paused -- the springs, the
    stride phase, the hood, the ghost's tag -- and `pace.update` is not called at
    all, so the race clock and the distance are frozen at their source (measured:
    both move by exactly 0.000000 across a paused hold). `world.js` is the
    exception: `api.update` takes `(z, playerLane)` and reads its own
    `performance.now()`, with a comment saying so and inviting whoever next owns
    main.js to pass a dt at both ends. So the crowd wave, the finale clock and the
    background traffic keep running behind the panel and step forward across a
    long pause. Nothing there is collidable -- hazards are gates keyed to z, and
    `course.occupiedAt` is course data -- and nobody can see it through a solid
    fill, so it is a seam rather than a defect. It is the one edit that would make
    the pause total, and it belongs in world.js, which this pass did not own.

    **CLOSED BY THE OWNER, WITH THE LEAK ACCEPTED AS IT STANDS.** The residual
    above -- that a player can still think about a frame they were already
    shown, so pausing the instant a hazard resolves buys unlimited time to plan
    the response -- was scoped for a fix: resume the race slightly behind where
    it stopped, unwinding `pace.units`, `player.gateIdx` and `player.aidIdx`
    together so the player re-earns the read. The owner's decision, verbatim:
    *"Pause button is fine. No further work needed on that."*

    So it is not an open defect and not a deferred one; it is a known limit that
    has been looked at and accepted. **Recorded rather than dropped, because the
    next agent to notice it will otherwise cost a day rediscovering it.** The
    argument against building it is also worth keeping: the rewind is on the
    SCORING path, it has to move three counters in step or a gate is
    double-counted, and `tools/simulate.js` states how many mistakes the record
    survives (1 with no aid, 2 taking half, 3 taking all) -- a rewind that
    desynchronised the ghost or double-counted a gate would be a far worse
    defect than the leak it removes. **A cure that can silently change what a
    run scored is worse than a disclosed limit on a daily time attack.**

57. **The near-band colour gap was in seven authored hexes, and the fairness
    gate had never been able to see them. A palette that agrees to three
    decimal places on one axis is a palette somebody measured on one axis.**

    The bottom third of the frame ran 45% short of the Subway Surfers
    reference on saturation and 93% short on area of vivid pixels, and five
    passes had measured it without once diagnosing it. `docs/near-band-colour.md`
    ablated the renderer stage by stage and exonerated all of it: unlighting the
    ENTIRE frame moves near-band chroma by 0.010 of a 0.217 shortfall, and the
    fog moves it by exactly zero, because `FOG_NEAR` is 60 units and the band's
    mean depth is 5.6. The hemisphere fill and the cool bounce turned out to be
    ADDING chroma -- the suspicion was not merely unsupported, it was backwards.

    The cause was the play surface's authored palette: seven road-marking tones
    with a maximum chroma of 0.106, and eighteen road colours at a maximum of
    0.086, **every one of them sitting at luminance 0.391-0.393.** That last
    figure is the whole tell. **When a palette's entire set agrees to three
    decimal places on one axis, that is the axis somebody had a target for, and
    the silent axis is where the defect is.** The roads were tuned to keep the
    play surface the lightest large mass in frame, that work was done well, and
    chroma was simply never given a number.

    **And the lever was free the whole time, because the gate could not see
    it.** `tools/shoot.js` builds its road patch from `laneBand()` on
    `mats.road`; `paintGeo` is not in it. So the markings' chroma is
    STRUCTURALLY independent of every hazard margin -- verified here rather than
    taken on trust, twelve variants over four steps spanning 25x of paint
    chroma, every margin identical to three decimals, at three legs. The tarmac
    has no such freedom and was left alone: JUMP v5 passes on saturation
    difference at a luminance ratio of 1.02, so lifting the centre lane eats its
    only margin, and at k=2 a variant already fails at THE WALL.

    Six of the seven tones re-saturated about their own luminance-grey, which
    preserves linear luminance by construction, and `overRoad()` then
    re-normalises each to the `shadedL` it always had -- so the paint ladder's
    long list of stated ratios is still true and none of it had to be
    re-derived. Measured on a frozen frame, CITY START near band: S 0.185 to
    0.252, chroma 0.066 to 0.101, vivid 1.7% to 9.1%; THE WALL 0.318 to 0.369,
    0.161 to 0.194, 18.1% to 29.8%. Zero draw calls and zero triangles.

    **THE HEX IN THE PRESCRIPTION WAS NOT THE HEX IN THE FILE, AND A FIND-AND-
    REPLACE WOULD HAVE HALF-WORKED, WHICH IS THE WORST OUTCOME.** The seven
    tones a screenshot measures are OUTPUTS of `overRoad(hex, k)`, which
    re-values an authored colour to k times the reference tarmac. The authored
    hexes are `0x272636, 0x313040, 0x7b7a81, 0xf2f4ff, 0x77728f, 0x8e8aa8,
    0xfff6d8`. Two of the seven -- `0x272636` and `0x313040` -- happen to pass
    through `overRoad` unchanged and so appear in the file as themselves. **So
    replacing the seven measured tones by search would have hit two by
    coincidence and silently missed five**, shipped a build that compiled and
    ran, and moved about a fifth of the intended chroma. The same family as
    counting a source hex 43 times, and as scaling `mats.paint.color` when every
    tone lives in the geometry's colour attribute. **When a prescription gives
    you hexes, find them by what renders them, not by string.**

    **The seventh tone is held, and it is the reason the guard exists.** Pushed
    with the rest, `#9d9885` at hue 47.5 becomes a gold lane dash SIX DEGREES
    from the JUMP telegraph mat's 41.4 -- and this project has already had to
    move a road marking off a hue once, when the racing line collided with the
    aid pickups at ten degrees and a blind reader could not separate them.
    `tools/roadchroma.js --guard 25` refuses chroma to any tone within 25
    degrees of a spoken hue, and it cost 0.006 of near-band chroma to obey,
    because the offending tone is 3.5% of the painted area.

    **AND THEN THE OWNER OVERRULED THE METRIC, WHICH IS THE MOST IMPORTANT LINE
    IN THIS ENTRY.** Two steps were built and measured: k = 5 closed 41% of the
    saturation gap, k = 3 closes 24%. k = 5 passed every gate, broke no hue and
    was better on every number. The owner looked at the frame and refused it,
    on the standing instruction for the whole project -- *"objects that would
    make sense in a road setting."* **Violet lane markings do not.** k = 3
    shipped.

    The reasoning is the part that must not be undone. **Subway Surfers gets its
    near-band colour from the PLAY SURFACE ITSELF -- a crimson train roof -- and
    not from the paint lying on it.** Hitting a saturation target by tinting
    road markings satisfies the NUMBER by a route that does not satisfy the
    THING THE NUMBER STANDS FOR. **This project has now made that mistake three
    times under three names: the triangle budget, the 110-pixel runner, and
    this.** A proxy optimised directly stops being a proxy. The general form:
    **when a measurement is standing in for a quality, ask what would have to be
    true of the WORLD for the number to move, and refuse the routes that move
    the number without it.**

    So: **k = 3 closes 24% of the gap, and the honest remainder is not a bigger
    k.** 40% of the near band is tarmac the fairness gate will not let us
    colour, and closing the rest means putting more saturated NON-ROAD area into
    the bottom third -- a content change with a draw-call price, needing its own
    evidence. **Do not reach for a bigger k instead. That road has been walked to
    the end and the frame at the end of it was rejected by the person this game
    is being built for.**

    One instrument limit, found by testing it rather than by trusting it.
    **Skips 200 and 230 are not controlled measurement points on this course.**
    Re-shot three times on an identical build, FINAL MILE near-band S came back
    0.345 / 0.421 / 0.401 -- the bot lands at mile 25.54 or 25.55 and the finish
    arch and carpet swing the composition harder than any palette change. The
    six legs whose draw AND triangle counts are identical between two builds are
    the ones a before/after may be read from, and that test -- rather than which
    answer looked better -- is what decided which legs are quoted above.

58. **The fairness gate caught the object nobody expected, and the reason was
    the area-mean rule stated three thousand lines away.**

    The owner asked for the kerbside crates and flower pots to be promoted from
    scenery into the hazard rotation. Both were already modelled on every side,
    so the promotion should have been almost free, and the brief predicted the
    tight one would be **brown crates against dark tarmac.** It was not. The
    crates cleared the gate at 1.41x to 1.55x luminance everywhere. **The
    PLANTERS failed**: L 94.1 S 0.341 on a lane-1 road of L 88.4 S 0.156 --
    1.06x against a 1.25x gate and 0.185 against 0.22, matching the tarmac on
    both axes at once.

    The cause was already written down, in the vehicle fleet's header: chroma is
    measured on the AREA MEAN, so a dark near-neutral element averages a
    saturated body straight onto the neutral axis. On the vehicles it was a 15%
    cream band destroying 88% of an object's chroma. Here it was the planter's
    dark foot ring and its near-neutral soil disc -- **the same defect in
    reverse, dark instead of pale**, and compounded because a lane planter is
    scaled to 0.58 and a body of revolution puts much of its surface in the
    lower toon bands. **A rule written about one family of objects was true of a
    different family and nobody had gone looking.**

    Two other things worth keeping. **Art gave way to the box twice, and the
    verge versions fit neither**: a crate stack runs to 1.6 tall and a planter's
    planting to about 1.2 against a JUMP `yMax` of 0.80, so both were scaled
    INTO `MR.Collision.BOX` rather than the box being asked to accommodate
    them. And **the draw bag got better, not worse, which was measured rather
    than assumed**: the `castGates` header warns that adding variants changes
    the deal, so the read-window repeat rate was measured both sides over 30
    dates -- JUMP windows containing a repeat fell from **13.7% to 7.6%** at six
    variants to eight, with DUCK and BLOCK bit-identical. `tools/kindread.js`
    held its profile misclassification at 1, over 23 variants instead of 21.

    **And the opening was measured before it was changed, which is what found
    the real number.** The owner asked for more obstacles at the beginning; the
    first three miles were carrying 4.88 gates and 6.26 hazards a mile against
    the rest of the race at 7.43 and 17.56, and miles 0 and 1 came in at 1.00
    and 1.09 hazards per GATE -- one thing on the road, every gate, for two
    miles. One threshold caused all of it. **The cost is stated rather than
    buried: the record now survives 1 / 2 / 3 mistakes where it survived
    1 / 3 / 4, on the same 17 aid items** -- measured against a worktree at the
    pre-change commit rather than assumed. More obstacles is a less forgiving
    race, and that is the trade the request contains; the owner has consistently
    wanted the game harder, so it was reported as a cost paid rather than
    reopened. **If they ever change their mind, the dial is one number: the
    `d < 0.09` threshold on `nHaz` in `makeGate`. It was 0.18, which lands at
    mile 2.05; 0.09 lands at mile 0.69.** Nothing else has to move with it.

59. **Two instruments were wrong, in opposite directions, and both were wrong
    about the same thing: an axis-aligned box is not an object, and two frames
    taken at different times are not the same scene.**

    `tools/motion.js` failed `READBAND` on a tree at HEAD, and the failure was
    the tool's. Its screen rect came from a world AABB, projected corner by
    corner, with any corner behind the lens **dropped rather than clipped**.
    That is two defects sharing one routine and they push opposite ways.

    **Dropping a corner runs the arithmetic away.** A box straddling the near
    plane keeps only the corners in front of it, and those sit a hair from the
    plane where `ndc = x / (near * tanHalf * aspect)` has no bound. The recorded
    symptom, **ndc x [-97.66, -0.13]**, is that division and nothing else -- a
    point at the edge of the lens reported as a wall across the frame,
    overlapping every gate in the read window. It also errs the FLATTERING way
    in the other axis, because the box's true near-plane cross-section is never
    represented at all and can reach further than any surviving corner.

    **And the box was never the object.** `Box3.applyMatrix4` re-bounds a
    rotated local box, the claim site yaws every tree at random, and the wave
    envelope grows it again in three axes. `reallyInCorridor` already says all
    of this and already pays for the exact test -- CORRIDOR convicts on
    vertices -- but READBAND was still convicting on the inflated box. Measured
    at skip 60: a tree reported ndc x **[-0.71, -0.09]** and clipped a BLOCK
    gate whose entire rect is **[-0.10, -0.02]**, on a **0.01-wide sliver of
    pure inflation.** A false failure is not harmless over-strictness; an
    assertion that cries wolf on correct geometry is one somebody switches off.

    `boxRect` now clips the twelve edges against `cam.near` -- read off the
    camera, not the -0.1 that was guessed -- and `meshRect` convicts on the
    geometry, triangle by triangle, each swept by its own per-vertex envelope.
    **The box proposes, the geometry convicts**, which is the discipline the
    file already applied one assertion over.

    **What makes the remaining green trustworthy is that both halves are tested
    on every run, because neither is exercised by a passing course.** A gate in
    the read window is 25 to 90 units out, so none of its corners is clipped and
    its answer is known: `boxRect` must reproduce the plain projection, and it
    does, to **2.8e-17**. `meshRect` is called once per skip on the widest mover
    in frame whether or not anything proposed -- `prop / grove` box ndc x
    **[-1308.95, -5.46]** against geometry **[-1188.63, -10.98]**, 1.77x tighter
    by area, with the -1309 showing the near-plane case being clipped correctly
    rather than dropped. Without those two, a `meshRect` that returned a speck
    would clear every future proposal and print precisely what a clean run
    prints.

    **The blind-read harness had the mirror-image defect: it was measuring the
    weather.** `tools/blindread.js` proves each panel contains the telegraph mat
    by rendering the frame twice, once with the mat and once without, and
    counting pixels that differ. Its first version did not stop the clock. This
    game animates from `performance.now()` inside `onBeforeRender`, so wind,
    crowd and sky all moved between the two renders: it reported **38,594
    differing pixels** on a DUCK panel with a difference bounding box of the
    **entire frame**, which is not a 1.95-unit strip of paint. That is the
    flattering direction -- animation noise inside the crop counts as mat
    pixels, and a panel with no mat in it passes. `tools/motion.js` had paid for
    this exact lesson in its own header and the new file did not read it closely
    enough.

    **With the clock stopped the control immediately found two more things, one
    its own and one the game's.** Its own: the crop was squared up and capped at
    the SHORT side of the viewport, so a BLOCK at 8 units -- 2.80 tall with six
    units of mat run-up -- was cut to 390 px and lost the mat. MATCHECK failed 2
    of 4 panels on the first run, which is the defect the harness exists to fix
    reappearing inside the harness, caught by the control instead of by a
    reader.

    The game's, and it is the one worth acting on: **at 25 units on sloped
    ground the telegraph mat is not drawn at all.** The mat is one rigid
    16-unit plane lifted **0.012** above the road and pitched by the tangent
    **at the gate**; the road follows a curved profile that climbs away from
    that tangent behind it. At slope 0.0065 the lift is spent by 6 to 9 units
    back and the run-up ends **0.045 below the tarmac.** Measured across
    stretches: flat ones (skips 60, 200) carry the mat at 25 units over 17% of
    the crop, sloped ones (skips 25 and 150, slopes -0.0117 and 0.0023) draw
    **zero mat pixels anywhere in the frame**, and the live gates in that shot
    stand on slope 0.01035. This is the primary WHAT TO DO channel going
    missing at exactly READ_NEAR, the distance the lane is chosen at. It lives
    in `src/render/world.js` and was not touched here.

    So the harness now reports three states rather than one, because they are
    three different facts: `ok`, `MATCROP` (the mat was drawn and this tool
    cropped it out -- the harness's fault, and it fails the run), and `MATLOST`
    (the game drew no mat anywhere -- a finding, printed with the slope and the
    submersion depth, and not to be filed as a tool bug).

    **The other two defects in the blind read were about what the reader knows
    before they look.** The panels came from `api.variantObject`, which is
    `assembleVariant` -- body, caution face, one moving part -- and the road
    gets a POOLED group, which adds the mat. So the test that asks "must a
    runner go over, under or around it" was answering with the art **minus the
    channel world.js built to carry that exact answer**; at least one recorded
    conclusion about over-versus-under was partly an artefact of it. The tool
    now borrows a live pooled hazard off the road, identifies its kind by the
    variant offset against `MR.Collision.BOX` `halfZ`, and rewrites every field
    the claim site rewrites. **What that cost:** a dependency on the claim
    site's contract rather than on a constructor -- variant visibility, the
    rideable tail, the caution board and a BLOCK's body scale are duplicated
    here and will go stale if that site grows a field -- and it can only
    photograph kinds currently cast, since `Pool.release` takes an object out of
    the scene graph. It got one thing back for free: every variant is built and
    parented at pool construction, so all 23 are reachable on any borrowed
    group.

    And **readers inside this repository are handed `CLAUDE.md` before they see
    a pixel** -- obstacle, hazard, barrier, sign, marshal, runner, ghost, chase
    camera, and the fact that this is a running game. No tool can stop that, so
    the header states the line instead. **It does not invalidate a failure to
    read**: a reader given the word "marshal" who still writes "I cannot tell
    what kind of person it is" has failed with the answer in front of them,
    which is a strictly harder test, and every negative finding this method has
    produced is of that shape. **It does invalidate a naming success that uses a
    word the file supplied** -- "a barrier", "a vehicle" -- while a specific
    noun the file never contained cannot be got from a general one and still
    counts. It leaves over/under/around alone, except that the reader knows the
    three answers are the three answers, so score it as a forced choice with a
    33% floor rather than zero. Panels are written outside the repository under
    random hex names with the key in a separate directory, because a previous
    reader named `aid.png` as the reason the word "cup" came to mind.

60. **`footroom` was failing at the SHORT end of the viewport range, and the
    pass was briefed as a tall-viewport defect. The decomposition is three
    terms and only one of them was ever in the camera's hands.**

    The brief reported 18 failing combinations with the shoe 145.9px inside the
    bottom plate at 920x1363. Measured on a pure-HEAD build: **11 failing
    combinations, none of them at 920x1363, and the shoe was never inside the
    plate at all.** Worst case was `320x568 start hit` at **+5.0px** -- clear of
    the panel, but short of the 12px the gate requires. 920x1363 was the most
    comfortable portrait frame in the sweep at +59.6 worst. **The defect was at
    the opposite end of the axis it was described on**, and every failing row
    was at 320x568 (nine) or 390x844 (two).

    The mechanism, which is one line:

        clearance = (1 - f) * H - P

    `f` is the runner's lowest point as a fraction of frame height, `H` is the
    frame, `P` is what the readout takes at the bottom. **`f` is set by
    `frameFor(aspect)` and is height-blind.** Both ramps in it saturate to zero
    below aspect 0.55 and 1.30, so `back` measured **1.180 on every portrait
    frame from 320x568 to 920x1363** and `f` was 0.8937 on all of them alike --
    verified by sweeping `f` against `back` at three portrait heights, where the
    curves agree to four decimal places. So `(1-f)*H` is LINEAR IN H while `P`
    is a pixel constant with two media-query steps in it: clearance falls as the
    frame gets shorter and crosses the gate near 640px of height. **A taller
    viewport cannot surface this defect and never could.**

    **AND ASPECT CANNOT RANK THE VIEWPORTS, WHICH IS WHY IT WAS THE WRONG
    INPUT.** The difficulty of a frame is `(P + margin) / H`. For 320x568 that
    is 0.1338 and for 1280x800 it is 0.1338 -- **the same number to three
    decimal places, at aspects 0.563 and 1.600**, opposite ends of the only axis
    `frameFor` could read. No tuning of an aspect ramp can serve both without
    mis-serving something between them.

    `camera.js` had already written this diagnosis down -- *"ASPECT IS A PROXY
    HERE AND THAT IS WORTH SAYING"* -- and declined the cure because the fix
    needed `main.js`, which that pass did not own. **The bill came in.** The
    ownership boundary was real and the deferral was honest; what it cost was
    that the height-sensitive half went into the stylesheet as media-query steps,
    and a step function cannot track a linear one.

    So the camera is now handed the quantity itself. `hud.bottomClaim()` reports
    the pixels the readout took, as a measurement with no policy in it; `main.js`
    passes it on resize, on orientation change and once when the webfont settles;
    `frameFor` keys a third ramp on `(P + FOOT_MARGIN) / H`. **`BASE_ROOM` is
    0.107 because that is what the base framing supplies** -- at `back` 1.18 the
    winded figure sits at f = 0.8937, so 1 - f = 0.1063 is the room there is --
    and the ramp therefore starts exactly where the framing runs out rather than
    at a round number near it.

    **COMBINED WITH `Math.max`, NOT `+`, AND THAT IS THE ONE PIECE OF CARE IN
    IT.** `deep` already pulls back on wide-and-short frames and was tuned
    against 844x390 and 1280x800. Adding a second pull-back on top would
    double-count exactly the way the 13px of standoff in `style.css`
    double-counted the safe-area inset for two passes. Taking the larger means
    the new term is identically zero wherever the old one already works:
    **1280x800 keeps `back` 1.3633 and 844x390 keeps 1.708, bit for bit**, and
    all 64 rows on the four untouched viewports move by a mean of 0.30px, which
    is the sweep's own noise.

    Result on a build with the baseline course: **96 of 96 combinations pass,
    worst `320x568 mid hit` at +23.6px against a design target of 24.** The
    eleven failing rows gained a uniform +14 to +20px. The cost is stated: the
    runner is **8.9% smaller at 320x568 and 7.6% smaller at 390x844**, 149px to
    136px and 222px to 205px crown-to-sole. **None of it comes out of the middle
    of the frame** -- pulling back shows more road, not less, and the FOV, the
    eye height and the aim point are untouched.

    **THE PLATE-GROWTH SUSPICION WAS CHECKED AND IS CLOSED.** Three `nowrap`
    fixes exist because a growing string once pushed this plate up into the
    runner, so the obvious hypothesis was that it still could. Driven through
    the longest strings the game can print, a 32-character city name and
    deliberate overflow, `#railWrap` measured **51.00 / 75.00 / 81.00 / 54.00px
    at the four viewports and did not move by a hundredth in any case.** The
    fixed row heights and the three nowraps hold. It is worth knowing which
    suspicions are already dead.

    **AND THE INSTRUMENT WAS INVENTING A DEFECT.** `footroom.js` counted
    near-plane-clipped vertices as one number and failed the build on any
    non-zero value -- while its own header documents MARK (the contact shadow,
    the landing reticle, the dust) as *"reported, never gated"*. A decal at the
    runner's feet passes under the camera every few seconds. Attributed per
    group: **all 24 of the clipped-vertex failures were MARK and not one was
    SHOE or BODY.** So the build failed for a shadow going under the lens, on a
    gate whose subject is the feet, at exactly one pace -- which reads like a
    finding about that pace, and someone would have gone looking for it. The
    guard is kept where it protects the answer: a dropped SHOE or BODY vertex
    means the figure's lowest row was computed without a point that might have
    been the lowest, so the gate would UNDER-report, and that still fails.

    The general form, and it is the third time this file has recorded it:
    **when a defect is reported at one end of a range, measure the range before
    believing the end.** The sweep took four minutes and disagreed with the
    brief about which viewports failed, how many failed, by how much, and in
    which direction -- and the fix that follows from "tall frames are cramped"
    would have pulled the camera back on the frames that had 60px to spare.

61. **The telegraph mat was submerged under the road it is painted on, and
    both the surface it was fitted to and the harness that found it were
    wrong.** The mat is the game's primary instruction channel -- the coloured,
    iconised paint that says OVER, UNDER or AROUND before the shape resolves --
    and it was one RIGID 16-unit plane, lifted 0.012 and pitched to the tangent
    at the gate. A rigid plane cannot lie on a curved surface. Where the run-up
    left the road downward the road drew over it, because the material is
    depth-TESTED and only `depthWrite` is off: **a submerged mat is not a faint
    mat, it is no mat.** Measured at the chase camera, mat pixels in a 390x844
    frame on 2026-01-10 at the foot of the hill at z=832:

    |          |    8u |   12u |  25u |
    |----------|-------|-------|------|
    | clear    | 56639 | 35940 | 1861 |
    | -1.5%    |  7572 |  1613 |    0 |
    | +2.1%    |  4027 |     0 |  129 |

    Zero at 25 units is `READ_NEAR`, the distance the lane is chosen at.

    **THE SURFACE IS NOT THE PROFILE, AND FITTING TO THE PROFILE WOULD HAVE
    LEFT THE BUG IN PLACE.** `elevation.js` owns `E(z)`; the road is not `E(z)`.
    `world.js` lays rigid 24-unit tiles pitched to the CHORD of `E` across each
    one, so the tarmac departs from the profile by up to `c*TILE^2/8 = 0.045` --
    **four times the mat's whole lift** -- below `E` at a crest and above it in
    a dip. `blindread.js` measured the submersion against `E(z)` and reported at
    most 0.045; measured against the road as built it reaches **0.094** over a
    32-day sweep, and the panels that actually lose the mat are the ones the
    chord model predicts and not the ones the profile model predicts.

    **THE PREDICTOR IS CURVATURE, NOT GRADE**, which is why five passes of
    "blind readers cannot tell a DUCK from a JUMP" never found it. The steepest
    ground the generator makes, -3.5%, draws the mat in FULL. The mat dies at
    the FEET of a hill, where the raised cosine turns over, curvature is
    maximal and the grade is passing through zero. Across 32 days, 4.6% of
    gates on ground under 0.5% grade lose part of the mat and **the three
    deepest submersions in the entire sweep are all on ground under 0.5%.**
    The brief for this pass said "flat stretches carry it, sloped ones draw
    zero", and had it backwards in both halves.

    The fix fits every vertex to `roadSurfaceY(z)` + the same 0.012, through
    the mesh's own inverse world matrix so no caller has to cooperate. Residual
    is bounded rather than asserted: inside a tile both road and strip are
    linear so the fit is EXACT, and the only lossy case is a segment straddling
    a tile joint, at `dSlope*h/4 = 0.0019` against a lift of 0.012 -- and that
    is swept rather than asserted: over all **5918 gates of a 32-day calendar,
    zero have any part of the strip under the tarmac**, with a gap band of
    0.0104 to 0.0135. Never under the road, never more than 13.5 millimetres
    off it. Result on
    sloped ground, mean mat pixels, and the point is the last column:

    |                  |  8u before |  8u after |  25u before | 25u after |
    |------------------|------------|-----------|-------------|-----------|
    | sunk ground      |       5800 |     56951 |          69 |      2157 |
    | already-clear    |      53430 |     52922 |        2057 |      2020 |

    **A hill now reads exactly as well as the flat.** A flat control run of the
    full blind-read harness measures 21.2%/18.4%/12.5% of crop before and
    21.3%/18.4%/12.5% after -- unchanged -- and the sloped runs, which were
    2.0% and 0.1% at their worst, now sit on the same numbers.

    **THE HOOK WAS ONE FRAME EARLY, AND THAT IS A DEFECT IN EVERY INSTRUMENT
    THIS PROJECT HAS.** The fit was first hung off `onBeforeRender`, which is
    the obvious hook and the wrong one: `WebGLRenderer` uploads a geometry's
    attributes inside `projectObject`, at the top of `render()`, and calls
    `onBeforeRender` later at the draw call -- so an attribute written there is
    marked dirty after the only upload of that frame. Three hazards staged at
    one place and rendered twice: pass 1 gave `JUMP 5426 / DUCK 0 / BLOCK
    57039`, pass 2 gave `56978 / 57399 / 56866`. **That DUCK zero is a tool
    being early and it is indistinguishable by eye from the bug being fixed.**
    Invisible in play, where a hazard is claimed 210 units out and sits for
    hundreds of frames; not invisible to `shoot.js`, `blindread.js`,
    `kindread.js` or `clarity.js`, all of which stage something and photograph
    it once. Moved to `updateMatrixWorld`, which runs in
    `scene.updateMatrixWorld()` before `projectObject` -- **if a geometry has
    to be written per frame, that is the hook, and `onBeforeRender` is a trap.**

    **AND THE HARNESS MANUFACTURED THE DEFECT IT REPORTED.** `blindread.js`
    read "no pixels moved when the mat was hidden" as `MATLOST` -- the game drew
    no mat -- and could not tell it from the tool having staged NOTHING. The
    first run of this pass reported **16 MATLOST panels of 69, on flat ground,
    against a build whose mats were fine**; the panels were bare tarmac, no mat
    and no object. Freezing `performance.now` stops the wind, the crowd and the
    sky and does NOT stop the runner, because `main.js` drives its frame from
    the requestAnimationFrame timestamp -- so the race advances through a run
    and `Pool.release` does `parent.remove(o)` as the runner passes each
    borrowed gate. Fixed at both ends: the claim re-adds a released group, and
    a zero mat reading must now survive an object-presence render before it may
    be called MATLOST. An empty panel is `STAGEFAIL` and fails the run.

    Both of this file's earlier defects flattered the result. This one did the
    opposite and **invented a defect in somebody else's file**, which is the
    same lesson from the other side: a control that cannot fail in its own
    favour is not therefore trustworthy, it just fails the other way. Two of
    the three findings in this entry are about instruments and one is about the
    game, and the game's would not have been provable without fixing the other
    two first.


    **AND THEN THE BLIND READ, WHICH IS WHY ANY OF THIS MATTERED.** Twelve
    unlabelled crops from the FIXED build, taken on the sunk ground itself
    (2026-01-10 at skip 44, where the same panels measured 0.1% of crop before
    this pass), shown to a reader that had **only the panels and PROMPT.txt** --
    a git branch containing no source and no `CLAUDE.md`. That is the first
    UNCONTAMINATED reader this test has had, so for once the specific nouns
    count as evidence too. **10 of 12 correct: DUCK 6/6, JUMP 3/3, BLOCK 1/3.**

    **Every DUCK read UNDER, and every one of them at confidence "sure"** --
    including both panels at 25 units. Verbatim, on a DUCK at `READ_NEAR`:
    *"A yellow portal frame spanning the road with a yellow-and-black diagonally
    striped panel slung under its top beam -- an overhead clearance barrier ...
    UNDER ... What it is: sure. Over/under/around: sure."* And the reason it
    gave: *"the striped panel occupies only the upper part of the opening and
    the tall yellow uprights frame an empty span of road below it."* Five passes
    of "readers cannot tell a DUCK from a JUMP" ends here, and the reader also
    named the JUMP mat as its evidence without being asked -- *"the yellow
    chevrons point directly into its face like a run-up"*, *"the chevron arrows
    on the strip run straight into it, so the only way past is across the top."*

    **THE TWO FAILURES ARE ONE VARIANT AND THEY ARE A NEW FINDING. `BLOCK v3`
    read as OVER at both 12 and 25 units** -- the reader would have hurdled a
    thing it must go around, which is a contact and a lost record. Its reason is
    a measurement, not an impression: *"the barricade's top rail comes up only
    to about waist height on the two people standing directly behind it, and the
    panel is solid from that edge down to a low rail near the ground, leaving
    the top as the only clear line."* **The variant puts two human figures
    behind a barrier and thereby supplies a ruler that says the barrier is
    hurdlable.** BLOCK is 2.80 tall against a 2.05 jump apex, so the envelope is
    correct and the ART is lying about it. Note also that these are the only two
    panels whose reasoning never mentions the mat: where the reader cited the
    paint it was right, and where it read the silhouette alone it was wrong.
    That is the mat/object split working exactly as world.js claims, and the
    place to fix `BLOCK v3` is the figures, not the bar.

    Two further things worth keeping. **A marking painted on a surface is rule
    1's one exception and it still is** -- the mat is single-sided quads with
    no back; what changed is that the strip bends with the thing it is painted
    on. And **another agent rebuilt `index.html` in this shared tree in the
    middle of a measurement sweep**, so numbers were collected from a page that
    did not contain the change under test. Every run afterwards was wrapped in
    a guard that greps the built artefact for the change before and after. Rule
    2 says verify against the running page; the corollary is to prove the
    running page is the one you built.

62. **The runner fell out of the bottom of the frame because the camera was
    still standing on a lorry he had already stepped off.** `footroom.js`
    failed 21 combinations at pace `mid`, on every viewport, with the lowest
    row of his shoe at **-104.1px** -- not near the readout plate, *below the
    picture*. A per-commit bisect put it at `7b0a1d2`, the opening-density
    change, and the reasonable story was that denser gates buy a longer streak,
    a faster pace sooner, and framing that gives way under it.

    **Every part of that story was wrong, and the measurements said so in the
    first ten minutes.** `fast` -- the fastest pace the game has -- was the
    *best* row on the board at +53.7. The pace at `mid` was unchanged by the
    density change to within 0.06%: streak 56 and 267.87 s/mi before,
    57 and 267.71 after. And the FOV band that had been reported as moving
    (68.3-69.3 to 63.9-68.6) was not the camera responding to speed at all --
    it is the *harness* freezing the streak while the runner takes a contact
    the harness cannot see (below).

    What actually happened is that the runner rides a lorry roof and steps off
    the front. `camera.js` smooths the deck height under him into `s.dk` and
    adds it to the eye **and** to the aim, which is deliberate and correct --
    that is what keeps the pitch, and therefore the sightline, unchanged while
    the whole shot rides up with the ground. The consequence nobody had priced
    is that **all of the filter's lag is then spent on exactly one quantity:
    how far down the frame the figure sits.** He stands on `p.surface` while
    the lens is framed for `s.dk`, and every unit of the difference is eye
    height added over his head with nothing anywhere compensating it. Traced at
    390x844: he is back on the road while the eye is still **1.28 units** above
    it, and the shoe lands 104px inside an opaque panel.

    **The smoothing was insuring against a step that had already been removed
    at the source.** The note over `s.dk` said the filter is deliberately a
    little slower than the 0.50s fall, so the eye settles into the landing
    rather than tracking it. There is no cut to settle into: `player.js` eases
    the surface down as `fallFrom * (1 - t*t)`, zero vertical speed at the lip
    and accelerating. The insurance was being paid for with the runner's feet.
    The ease is kept for the upward steps that are real -- a sideways mount
    onto the middle of a ramp sets the surface in one frame -- and the downward
    lag is now bounded. `Math.min`, so it is the shipped line everywhere the
    shipped line already worked, and identically inert on a race that never
    meets a lorry.

    **`DK_LAG` is 0.06 and the first attempt at it was 0.15, which is the part
    worth keeping.** Priced against a *settled* frame the budget looked like
    `(43.3 - FOOT_MARGIN) / 133 = 0.145` -- and 0.15 measured back at 18.4px
    of clearance, not the 24 it was designed for. A settled frame is one stride
    phase; a dismount sweeps all of them. Re-priced against the worst instant
    of the whole event with the lag bounded to zero, the floor is 31.6px at
    390x844 and a unit costs 120px there, so the budget is 0.063. **A constant
    derived from the wrong sample of the right quantity is still a number
    nobody measured.**

    **THE DEFECT IS OLDER THAN THE COMMIT THAT REVEALED IT, AND THE INSTRUMENT
    IS WHY.** The forced dismount measures **-117.6 / -128.2 / -111.3 / -73.4**
    at `1042b5d`, the "known good" baseline the bisect was anchored on -- worse
    at every pace than the build that was eventually reported as broken.
    `footroom` passed it at +43.2 because pace there is set by `?skip=`, which
    is wall-clock seconds, so *which stretch of road each row samples is
    whatever the course generator put there*. The density change moved a
    rideable lorry into the window `?skip=90` lands on, and a defect that had
    been shipping for months surfaced as twenty-one failures that all pointed
    at pace. **A tool whose subject is the runner's feet must not depend on the
    course happening to put a lorry under them.** `tools/deckdrop.js` mounts a
    deck, settles, steps off the front and watches the whole fall -- it cannot
    miss the event because it causes it -- and reports on the same figure, rail
    and projection `footroom` gates on, so the rows read side by side. It fails
    24 of 24 on the pre-fix build and 4 of 4 on `1042b5d`.

    **One instrument gap is left open deliberately, and it should be closed.**
    `footroom` stubs `resolveGates` so that "a contact can only happen where
    this file asks for one" -- and leaves `resolveDeck` live while also stubbing
    `player.handle`. So the runner cannot steer, ploughs into the flank of the
    lorry the density change added, and takes a contact anyway: that is the
    real source of the FOV band shift, and it means the `mid run` rows were
    quietly `hit` rows, which is the exact failure the stub above it was written
    to prevent. It errs harsh, so it is not a false pass. The right home for
    `deckdrop` is a fifth `STATE` inside `footroom` once that file is not being
    edited by two agents at once.

    Frames, live and unforced, at 390x844 stepping off the real lorry at
    `?skip=89.74`: **+9.7px before, +66.4px after**, same instant, same world.
    Through the whole fall the shoe row now holds at 700 within two pixels
    where it used to slide 715 -> 741. Gate after: `footroom` **96/96**, worst
    +25.5; `deckdrop` 24/24, worst +29.2; `shoot`, `course-test`, `calendar`
    (32 days), `envelope` and `kindread` (1 of 23 on profile) all clean; and
    the record still survives **1 / 2 / 3** mistakes, unmoved.

63. **The BLOCK legibility pass was stopped before it changed a line of
    `src/render/world.js` -- and the read it ran first says there was nothing
    to change. Thirty-five panels, two fresh uncontaminated readers, 35 of 35
    correct, and `BLOCK v3` read AROUND at both distances.** The pass was
    briefed to fix the variant entry 61 caught reading OVER and to find the
    second BLOCK that scored against it. **Neither reproduced.** Everything
    below is measurement rather than fix, and the first thing it measures is
    the previous measurement.

    **WHAT THE TWO READERS SAW.** Panels off `2d61123`, the fitted-mat build,
    at the default `skip=150` with no date pinned. Set A is every variant in
    the game at `READ_NEAR`; set B is all ten BLOCKs at 12u plus `JUMP v3`
    close in. Neither reader had source, `CLAUDE.md` or any other panel set.

    | set | panels | route correct |
    |-----|--------|---------------|
    | A, 25u  | 23: 10 BLOCK, 5 DUCK, 8 JUMP | **23 of 23** |
    | B, 12u  | 10 BLOCK, plus `JUMP v3` at 8 and 12 | **12 of 12** |

    Every DUCK UNDER at "sure". Every JUMP OVER. **Every BLOCK AROUND, all
    twenty of them, at both distances.** `BLOCK v3` -- the variant this pass
    existed to fix -- at 25 units, verbatim: *"A red-and-white striped roadwork
    barricade, with a round red 'no entry' sign on a pole and orange traffic
    cones at each end, and two workers in blue standing behind it ... AROUND
    ... sure ... The barrier is a solid panel roughly chest height with no gap
    underneath, and two full-height figures are standing immediately behind it.
    There is nothing to duck under, and clearing it in a jump would put you
    into the workers."*

    **THAT IS THE SAME GEOMETRY, THE SAME TWO FIGURES AND THE OPPOSITE
    CONCLUSION.** Entry 61's reader measured the rail against the pair's waist
    and hurdled it; this one measured the pair as an obstruction standing
    behind the rail and went round. Both are reading the figures. The ruler
    mechanism entry 61 identified is real -- a human figure inside a silhouette
    re-scales everything beside it -- but **which way it points is not fixed by
    the geometry**, and one reader on three panels was not enough to say it
    pointed at OVER.

    **SO THE HONEST STATE OF THE DEFECT IS "UNREPRODUCED", NOT "FIXED" AND NOT
    "IMAGINARY".** Two differences between the runs are uncontrolled and either
    could carry it: entry 61 shot at `skip=44` on `2026-01-10`, deliberately on
    the sunk ground the mat pass was about, and this run shot at the default
    `skip=150` on no particular day -- different light, different gradient,
    different backdrop behind the object. **The next pass on `BLOCK v3` should
    re-shoot entry 61's exact framing before it moves a box**, because a fix
    aimed at an unreproduced reading is a change nobody can score. What is NOT
    in doubt is that on ordinary ground, twice, the variant reads correctly.

    The rest of this entry is what the run found that nobody was looking for.

    **THE UNCONTAMINATED READER IS NOW A CHEAP INSTRUMENT, AND THAT IS THE ONE
    THING HERE THAT IS FINISHED.** Entry 61 got its reader from "a git branch
    containing no source and no CLAUDE.md" and did not say how, which made the
    best instrument this project has a thing somebody re-invents each pass. It
    is three commands and it never touches the working tree, which matters
    because several agents share this one:

        git hash-object -w <panel>          -> a blob per panel
        git mktree < lines                  -> a tree, built by hand
        git commit-tree <tree> -m "..."     -> a parentless commit
        git push origin <sha>:refs/heads/<branch>

    No checkout, no orphan branch, no stash, no risk to anyone else's in-flight
    work. The reader is then a session created against that branch, which
    contains images and `PROMPT.txt` and nothing else -- no source, no
    `CLAUDE.md`, no repository to leak vocabulary out of.

    Three branches are pushed and they are parentless; never merge them.

    | branch                 | contents                                             |
    |------------------------|------------------------------------------------------|
    | `blindread-block-a`    | 23 panels: every variant in the game at `READ_NEAR` 25u |
    | `blindread-block-b`    | 12 panels: all ten BLOCKs at 12u, `JUMP v3` at 8 and 12 |
    | `blindread-block-key`  | the key for both -- **do not show a reader**          |

    All of them are off `2d61123`, the fitted-mat build, and every panel
    carries its mat (MATCHECK 12.4% to 26.9% of crop at 25u, 17.5% to 18.5% at
    12u, nothing lost, nothing cropped).

    **`BLOCK v9`, THE MOPED: THE DEFECT IS ITS FEET AND NOT ITS TOP.** It is
    the 1 of 23 `kindread` misses on profile, and the row says where:

        BLOCK v9   0.10 0.24 0.30 0.28 0.41 0.50 0.50 0.51 0.51 0.50 0.38 0.21 0.13 0.00
        every other BLOCK, band 0        0.59 to 0.86
        every DUCK,        bands 0 to 5  0.20 to 0.36

    The moped's top is thin -- it peaks at 0.51 where a BLOCK sits at 0.75 --
    but that is not what lands it in the DUCK cluster. **Band 0 is 0.10.** At
    road level the object is two tyres 0.13 wide on a single track, and
    everything else on it starts at the floor pan at y 0.44: from astern there
    is daylight under the machine, and daylight under the machine is the
    literal definition of the kind it is being confused with.

    Modelled against the same 23-row table with the same nearest-centroid L1
    the tool uses, **raising the bottom four bands alone flips it**, and the
    top never has to be touched:

    | change to the low four bands (y 0 to 0.80) | v9 margin |
    |--------------------------------------------|-----------|
    | as it ships                                | **-1.117** |
    | to 0.50                                    | +0.619    |
    | to 0.62                                    | +1.066    |
    | 0.55 low, and 0.60 through bands 4 to 9    | +1.712    |

    **Those four numbers are a model of the instrument and not a reading from
    it.** They recompute the centroids off the printed table with v9's row
    edited; they assume the other 22 rows do not move, which is true, and that
    geometry can be built to hit a band figure, which is a guess. Re-run
    `node tools/kindread.js` and believe that instead -- this project has a
    long entry about numbers nobody measured.

    The honest difficulty is that a two-wheeler really is narrow at the road,
    so the mass has to come from something a delivery moped genuinely carries.
    **`BLOCK v8` is the precedent and also the trap**: it is two bicycles, it
    had exactly this defect, and it was fixed by loading the machines with
    crates -- so crates are taken, and a second crate variant would put two of
    the ten BLOCKs on the same idea.

    **AND THE BLIND READ SAYS THE PROFILE NUMBER IS NOT COSMETIC: v9 PASSED AT
    12 UNITS ON A LORRY THAT HAPPENED TO BE PARKED BEHIND IT.** It scored
    AROUND like the other nine, and then gave its reason, verbatim: *"Two
    things stacked in the lane: a red truck ... with a red motorcycle parked
    right behind it, nearer the runner. The motorcycle is the thing the runner
    meets first ... **Even though the motorcycle in front is fairly low**, the
    truck behind it is a solid wall of vehicle, so getting over the bike just
    puts you into the truck's tailgate."*

    **The moped itself was read as low enough to clear.** What supplied the
    AROUND was a second, unrelated hazard further down the road that the crop
    happened to contain -- scenery, not this variant, and not something the
    course guarantees. On an empty stretch that reasoning is not available and
    the reader is left with the object `kindread` scores at -1.117 against the
    DUCK centroid. **This is the one place in the run where the instrument and
    the reader agree, and it is the only BLOCK whose correct answer came from
    outside itself.** It is the strongest candidate for the next pass -- ahead
    of `BLOCK v3`, whose defect did not reproduce.

    A second-order note from the same panel set: at 25u the reader named v9 *"a
    red three-wheeled cargo vehicle -- tuk-tuk / cargo-trike shaped"*. **That is
    the cargo trike the owner had removed from the game.** The route answer was
    right, so this is identity rather than fairness, but a variant that reads
    as the object it replaced is worth knowing about before anyone reworks it.

    **`JUMP v3`, THE SCOOTERS: IT IS NAMED AT 25 UNITS AND UNNAMEABLE AT 8 AND
    12, AND THE THING THAT BREAKS IT IS THE PILE.** This is the finding of the
    run, because it is the reverse of what every brief on this variant has
    assumed. At `READ_NEAR`, unprompted and uncontaminated: ***"Two teal-green
    kick-scooters standing side by side"***, fairly sure, with the reason --
    *"handlebars with dark grips at each end, a thin vertical stem, and a low
    horizontal footboard just off the ground -- a scooter silhouette, twice."*
    **The owner's "I had no idea a kick scooter was one" does not reproduce at
    the distance the lane is chosen at.** No hedging, no bicycle, no "lying on
    its side".

    Close in it collapses, and the other reader said exactly what does it. At
    12u: *"two upright posts at the lane edges, each with a handlebar-like
    crossbar at the top ... with a solid horizontal teal mass bridging the gap
    between them at about half their height. Best single description: a low
    teal barrier or rail spanning the lane"*, identification **guessing**. At
    8u, the same: *"either a pair of parked teal scooters/bicycles with a third
    laid across between them, or as a low barrier rail on wheeled posts."*

    **THE PILE BETWEEN THE UPRIGHTS IS READING AS A RAIL JOINING THEM.** It was
    put there on purpose and for a good measured reason -- the header says so:
    *"The pile is what closes the FOOT of the object across the lane ... road
    showing between separate objects reads as a lane to run down, and two
    uprights 1.32 apart is exactly that."* That argument is still correct and
    the route answer it protects is still correct (OVER, both distances, both
    readers). But at close range the two flat machines merge into one
    horizontal bar spanning post to post, and a scooter with a rail across its
    middle is a barrier. **The two goals are in tension and nobody had seen
    it**: closing the foot costs the name, and it costs it at exactly the range
    where the object is biggest and should be clearest.

    So the next attempt is a shape problem, not a colour or an orientation one:
    keep the foot closed and stop the closure reading as a continuous
    horizontal. Break the pile's top line, or angle it, or let one machine
    overlap an upright rather than span between them. **A yaw to put the side
    profile at the lens was drafted here and then withdrawn** -- the 25u read
    proves the current orientation already names the object, so turning it
    would be a fix aimed at a defect that measurement had just closed.
    Untouched today; profile row 0.50 0.42 0.13 0.26 0.09, the thinnest in its
    kind.

    **`BLOCK v3`, THE MARSHALS: THE READER MEASURED THE OBJECT CORRECTLY.** Its
    top rail is a 0.12 cream cap centred at y 1.30, so it tops out at **1.36**,
    and the pair standing 0.70 behind it put their heads at 2.13 and their caps
    at 2.45. The reader's *"comes up only to about waist height on the two
    people standing directly behind it"* is not an impression, it is a correct
    reading of the geometry, and `MR.Collision.BOX` says 2.80. The art is
    lying and the box is right.

    Three routes are already closed, which is most of the value here:

    - **A portal frame with a panel slung under a top beam is DUCK v0's exact
      silhouette**, and it is the shape that same reader called UNDER six times
      out of six at confidence "sure". Anything that spans the lane on two legs
      with air under it is the strongest UNDER signal in the game.
    - **A solid ROAD CLOSED hoarding is `BLOCK v1`**, already in the fleet.
    - **Colour cannot move.** The lever table in the variant header records
      every chroma and luminance route being tried and every one making it
      worse; it clears the fairness gate on luminance alone at 1.37x to 1.43x
      with dS 0.023 against a road at S 0.157. Cream and its own pink are the
      only bright materials available to build the fix out of.

    So the fix has to put mass across the lane ABOVE the pair's heads, solid to
    the road, in cream and pink, without a top beam on legs. It is a geometry
    problem with three walls already built around it.

    **AND THE FINDING THAT OUTLIVES ALL OF IT: THE TWO INSTRUMENTS CAUGHT
    DIFFERENT VARIANTS, AND EACH WAS BLIND WHERE THE OTHER SAW.**

        BLOCK v3   0.59 0.57 0.41 0.70 0.77 0.78 0.73 0.63 0.65 0.67 0.63 0.61 0.27 0.00
        BLOCK v9   0.10 0.24 0.30 0.28 0.41 0.50 0.50 0.51 0.51 0.50 0.38 0.21 0.13 0.00

    `kindread` passes `v3` comfortably and fails `v9` at -1.117. The blind read
    is the other way round: it passed `v9` -- on a lorry parked behind it -- and
    it was a blind read that once condemned `v3`. **Occupancy is not a scale
    reference**: 14 numbers about where mass sits cannot say whose waist it is
    level with, so no profile row can ever contain the figures-as-ruler effect.
    And a reader is not an envelope: it will happily take its answer from
    something that is not the object, which is what makes a single reader on
    three panels the thin evidence it turned out to be here.

    Neither tool is wrong and neither is sufficient. **What this run adds is
    that the blind read needs n.** Entry 61 drew a fairness defect out of one
    reader seeing one variant twice; twenty BLOCK panels across two readers do
    not reproduce it. The read is still the acceptance test and still the only
    thing that answers the owner's question -- but a single reader's sentence
    is a hypothesis, and this project has a whole section on what happens when
    those get built on.

64. **The near band is the carriageway. The things a brief kept proposing to
    repaint are not near-neutral down there -- they are not down there at all,
    and an ablation says so to three decimal places.**

    Entry 57 closed 24% of the near-band colour gap by repainting the road
    markings, had k = 5 refused by the owner on the frame, and left an honest
    remainder: the rest needs "more saturated NON-ROAD area in the bottom
    third". The obvious next move was to find the near-neutral scenery in that
    band and give it colour -- kerbs and shoulders, barriers and railings,
    street furniture, buildings and walls, the verge, the vehicles, the crowd.

    **There is none. On five of six legs not one pixel of the near band belongs
    to anything that is not the play surface, the runner or a hazard.** The band
    unprojects to a patch of ground about five units by five, 1.28-1.64 lanes
    either side of the runner -- **narrower than the carriageway it lies on**,
    with the kerb line roughly 50% further out than its widest edge ever
    reaches. The sixth leg's single exception is the river at RIVERSIDE, 12.1%,
    which the band catches only because `bank` cuts the shoulder away there and
    the runner was in an outer lane; it is already at S 0.355, more colourful
    than the tarmac beside it. **The one piece of scenery the band can see is
    already beating the band average.**

    **Measured, then proved, because a table is still an argument.** Saturating
    every world object that is not the play surface, at k = 6, about its own
    luminance-grey: CITY START near band **0.252 -> 0.252, bit-identical**. The
    control, the same operation including the play surface, moves it to
    **0.810**. A mode that must move nothing and does not, the same shape as
    the fog result that exonerated the lighting.

    **AND THE CONTROL EARNED ITS KEEP, BECAUSE THE FIRST VERSION RETURNED THE
    RIGHT ANSWER FOR THE WRONG REASON.** It scaled `material.color` only, and
    the RIVERSIDE water is `0xffffff` with its tone in a map -- scaling white
    about its own grey returns white. **That is the roadchroma defect for the
    third time**, and it would have printed the same zero this entry rests on
    while proving nothing whatsoever. Textured objects are now boosted through
    their texels and the count of white-with-a-map materials is printed beside
    every result. **The general form, now seen three times: when a sweep returns
    "no effect", the first question is whether the sweep reached the thing it
    swept, and the only answer that settles it is a control that moves.**

    The third occupant of the band was one nobody had named: **the telegraph
    mats**, 0% to 36.7% depending on whether a hazard is telegraphing, and the
    single reason THE WALL reads 0.362 where PARKLAND reads 0.282. **The most
    colourful large thing that ever enters the near band is a gameplay signal,
    already at full saturation.** Which is also why the remainder is unreachable:
    near-band S is an area-weighted mean, so closing to 0.460 needs **38% of the
    band at S 0.80** (52% for vivid area), and three mats -- one per lane,
    permanently -- is roughly that 38%. **The game already owns the object that
    would close the gap and cannot use it, because a play surface that is
    permanently mat-coloured is exactly what a mat's meaning depends on it not
    being. The colour and the signal are the same resource and the signal has
    the prior claim.**

    So nothing under `src/` was changed, and that is the result rather than a
    failure to find one. **k = 3 on the markings remains the whole of what the
    palette can do; the other 76% is not a colour question about this game but a
    design question about it** -- the difference between a crimson train roof
    and a road.

    `tools/nearband.js` had three defects before a number of its was used, every
    one flattering. Its cluster stat had lost the `y < third` restriction and
    reported shares summing to **300%** against a near-band denominator. It read
    colour from a plain `WebGLRenderTarget`, which is linear where `chromadepth`
    reads the sRGB default framebuffer, printing near L **0.092** against a true
    0.308. And **the frame it called frozen was not**: `main.js` schedules the
    next frame at the TOP of `frame()`, so overriding `requestAnimationFrame`
    still lets one queued frame run, and `onBeforeRender` hooks read
    `performance.now()` directly, so each of the three renders a census performs
    advanced anything driven by wall time. **Pinning the clock is what made the
    band aggregate reconcile with `chromadepth` exactly** -- 0.252 / 0.101 /
    0.308 / 9.1 on both, where before it was 0.004 out. `chromadepth` carries
    that same one-frame ambiguity, and that is the size of its noise floor.

    One tolerance is stated rather than set to zero and quietly loosened when it
    failed. World-cluster repeatability is gated at 1pp, not 0, because the
    world holds animated crowd whose integrators step per render and zero is the
    wrong expectation; five of six legs still return exactly 0.0000 and CITY
    START returns 0.22pp. The drift is printed on every run. **The ratio that
    matters is to an effect worth acting on, and this tool separates 0.000 from
    0.558.**

65. **DUCK had five objects against 146 sightings a run, and the fix for that
    is objects. Three more were built -- an access gantry, a floodlight rig and
    a girder underbridge -- and the median gap between two sightings of the same
    DUCK went 6.4 s to 10.5 s at ZERO extra draw calls.**

    **BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** All three are
    modelled on every side, and the cheap version of each was specifically
    refused: the ladder cage is a closed ring of eight tangent segments and not
    an arc facing the lens, the floodlight has a finned casting behind its lens,
    the bridge parapet is railed on both faces of the deck, and every applique
    on the clearance header is applied to the FRONT face and the REAR face.
    `tools/orbit.js --kind DUCK` is the proof sheet.

    ### The measurement that asked for them, and the one that scored them

    `docs/staleness-and-mats.md` found DUCK worst on every measure -- five
    skins, p10 gap 1.9 s, median 5.8 s, 4.0% back-to-back -- and stated the
    arithmetic that makes it a pool-size problem rather than a drawing problem:
    **freshness over a window cannot exceed skins divided by
    sightings-in-window.** At mile 23 the game shows 38 DUCKs in thirty seconds
    and owned five of them.

    | on the same generator, 30 dates | 5 DUCKs | 8 DUCKs |
    |---|---|---|
    | sightings per skin per run | 29.2 | **18.3** |
    | p10 gap | 1.9 s | **3.8 s** |
    | p25 gap | 3.7 s | **6.4 s** |
    | **median gap** | **6.4 s** | **10.5 s** |
    | median in gates | 5 | **9** |
    | back-to-back same skin | 4.0% | **1.5%** |
    | read windows holding 2+ DUCKs that repeat | 17.6% | **6.6%** |

    ### THE BEFORE NUMBER IN THE DOCUMENT WAS ALREADY STALE, AND QUOTING IT
    WOULD HAVE CREDITED THIS PASS WITH SOMEBODY ELSE'S WORK

    The published DUCK median is 5.8 s. Measured for this entry it is 6.4 s on
    the same tree -- because a second agent landed a course-generator change
    (surge zones, and `NARROW` switched on) between the document and this pass,
    which moved gates per run from 185.0 to 183.5 and BLOCK sightings from 73.0
    to 96.0. **Had the after arm been compared against the printed before, this
    pass would have claimed 5.8 to 10.5 and about a tenth of that would have
    been the other agent's.**

    So both arms were rebuilt minutes apart from one tree differing only in the
    three lines under test, and `tools/staleness.js` gained `--file` so a twin
    is a twin. Rule 3 says audit the instrument; the instrument was fine and
    **the stale thing was the number in the document**, which is the same
    failure one step upstream.

    ### What each object is, and the one-second test

    The budget is unchanged and is set out at `duckScaffoldGeo`: the bar, the
    caution face, the daylight beneath and the two tall verticals are fixed by
    contract, and everything above the bar is confined to a standard's own x
    band because the chase camera flies down the lane centre. So the levers are
    OUTLINE, TOP TERMINATION and one BIG SHAPE on the standard.

    - **v5, an access gantry with a caged ladder.** I-section legs, five rungs
      and three hoops on each, and it terminates in a landing plate and a
      handrail. It is the only REPEATING mark in the kind -- every other
      variant puts one shape on the standard, this one puts a rhythm. Both legs
      carry a ladder because a walkway across a road has to be got off at the
      far end as well as on at the near one.
    - **v6, a site floodlight gantry.** Tapered masts, a control box, and a big
      canted floodlight head on a yoke at the top of each. **Nothing else in the
      game is tilted off the vertical**, and this variant spends its big shape
      and its termination on the same part so it can afford to make it large.
    - **v7, a girder underbridge.** The archetype the clearance header was built
      for. Flared cast capitals that open from r 0.14 to r 0.25, a parapet of
      four balusters and a coping rail on both faces, and two rows of eleven
      rivets along the whole span on the front AND the back of the beam.

    ### A FOURTH LEVER THE FIRST FIVE VARIANTS LEFT ON THE TABLE

    The header web is 0.34 deep in a box of halfZ 0.30, so there is **0.12 of
    free relief in front of it and 0.12 behind it, running the whole span**, in
    the one band where mass across the lane is already permitted. v0 to v4 use
    none of it. v5 puts a walkway toe plate in front and a cable tray with three
    cables behind; v6 three marker lamps in front and the armoured feed on
    saddle clips behind; v7 the rivet rows on both faces. It is the only
    differentiator in this kind that is available ACROSS THE LANE rather than
    out at a standard, and it is most of what the rear elevation gained.

    ### The refusal, with the number attached

    **v7 has no flared base**, and the obvious move was to mirror the capital at
    the road, which is what a real cast column does. A base flare of r 0.24 is
    0.48 across the road per column against the 0.30 base plate every DUCK
    stands on, and by `kindread`'s own band 0 that takes daylight occupancy from
    0.21 back toward 0.33 -- most of the way to the 0.38 that entry 53 measured
    as eating the only cue the kind has. **The daylight is worth more than the
    detail.** Nothing new anywhere in this pass is below 1.90 except the shared
    base plate, which was a constraint of the work and not a happy result.

    ### The cost, measured as a deterministic twin rather than off a bot run

    Shot-to-shot draw counts from `shoot.js` are noisy because the bot stops in
    a different place, so both pages were loaded at the same `skip` and read
    directly:

    | | 5 DUCKs | 8 DUCKs |
    |---|---|---|
    | **draw calls** | **227** | **227** |
    | triangles in that frame | 262,427 | 267,283 |
    | meshes in the scene graph | 766 | **883** |

    **117 more meshes and not one more draw call**, because every variant is
    built and parented once at pool construction and switched by visibility.
    That is the arithmetic the staleness projection promised and it holds.

    ### Gates

    `build`, `shoot`, `course-test`, `simulate`, `calendar` (32 days clean),
    `footroom`, `deckdrop` all pass. `kindread` is **1 of 26** where it was 1 of
    23 -- the same pre-existing `BLOCK v9` miss, and all three new variants
    classify as DUCK on profile alone. Contrast against the local road, gate
    1.25x luminance or 0.22 saturation: **v5 2.31x / 0.329, v6 2.08x / 0.342,
    v7 2.16x / 0.362.** v5 clears the gate by the widest margin of any hazard in
    the game.

    ### AND AN INSTRUMENT FINDING THAT WENT AGAINST THIS PASS FIRST

    Scored on `kindread`'s shipped settings the new variants look like they
    made the kind LESS varied: mean pairwise profile L1 across the five was
    0.748 and across the eight it is 0.643, and **v6 sits 0.110 from v0, the
    closest pair in the kind by a factor of two.**

    That reading is an artefact of the ruler, and the reason is one line of the
    tool: **`CEIL` is 2.80 and the fourteen bands stop there, while every DUCK
    in the game terminates between 3.10 and 3.58.** So the profile channel
    cannot see a single top termination -- not v0's cube, not v1's uneven tube
    ends, not v2's capping plate, not v3's fork, not v4's blind flange, and not
    v6's floodlight head. v6 and v0 are two identical posts below 2.80 and two
    completely different objects above it, and the tool is only shown the half
    they share. Re-run with a ruler that covers the object:

    | | v0 vs v6 | mean pairwise, v0-v4 | mean pairwise, all eight |
    |---|---|---|---|
    | 14 bands to 2.80 (shipped) | 0.110 | 0.748 | 0.643 |
    | 18 bands to 3.60 | **0.400** | 1.122 | **1.072** |

    With the whole object in frame the eight are very nearly as separated as
    the five were, which is the honest statement. **2.80 is the right ceiling
    for the question `kindread` was built to ask** -- it is the tallest
    COLLISION box, and over/under/around is a question about the box -- so this
    is not a defect to fix so much as a boundary to quote, and any future claim
    about DUCK differentiation must say which ceiling it was measured at. Every
    published differentiation figure for this kind, including the 0.468 to
    0.616 the last pass reported, was measured blind to the terminations it was
    partly about.

    One thing fell out of the taller ruler that belongs to somebody else's
    pass: **`BLOCK v9`, the moped, goes from a margin of -1.124 to -0.192**
    against the DUCK centroid when the bands cover its whole height. It is
    still the 1 of 26 miss either way, but whoever takes v9 next should know
    that most of its margin is being lost to a ruler that stops below it.

    ### THE BLIND READ: THE ROUTE IS AT CEILING AND THE NAME IS NOT

    Three uncontaminated readers, created against parentless branches holding
    images and `PROMPT.txt` and nothing else -- no source, no `CLAUDE.md`, no
    repository -- by the three-command recipe entry 63 recorded.

    | reader | set | route correct |
    |---|---|---|
    | C | 22 mixed panels, all three kinds, shipped crop | 21 / 22 |
    | D | 22 mixed panels, all three kinds, shipped crop | 21 / 22 |
    | E | 24 panels, all eight DUCKs at 8 / 12 / 25, `--art` crop | 24 / 24 |

    **The three new variants are 18 of 18 on route across the two independent
    mixed readers, at every distance, and both readers gave route confidence
    "sure" on all nine of their panels.** Sets C and D were deliberately mixed
    with JUMPs and BLOCKs so that UNDER was not free. **Neither miss was a new
    variant**: reader C read `BLOCK v3` as OVER -- the exact defect entry 61
    chased and entry 63 could not reproduce, reappearing at `skip=150` -- and
    reader D read `JUMP v5` as AROUND.

    Verbatim, reader D on `v7` at 25 units, the distance the lane is chosen at:

    > *"Enlarged, the frame resolves clearly into two uprights flanking the blue
    > track with the striped beam raised across the top and nothing filling the
    > gap below it."*

    And reader C on `v5` at 8 units:

    > *"The legs are tall and set at the edges of the lane, and everything below
    > the striped beam is open road with the blue lane marking running straight
    > through."*

    **THE NAMING TEST FAILED, AND IT FAILED FOR ALL EIGHT.** Asked what the
    object IS, reader E called every single DUCK *"a yellow hazard-striped
    barrier gantry"* -- v0 to v4 exactly as much as v5 to v7. Not one reader in
    three named a ladder, a floodlight, a bridge, a scaffold, a level crossing
    or a pipe run. The owner's *"all duck obstacles looks exactly the same"* is
    still true at the level of the NOUN, and this pass did not change that.

    What did resolve is the PARTS, and they resolved differently for every
    variant, which is the differentiation working one level below the name:

    | | reader E, unprompted, at 8 units |
    |---|---|
    | v1 | *"black-banded cylindrical posts (the left one mounted lower than the right)"* |
    | v2 | *"a large round yellow disc in a grey ring on the inner face of each column"* |
    | v3 | *"a signal mast with two round red lamps and a pale-capped yellow box"* |
    | v4 | *"a round pale-green gear/wheel-like disc mounted on the left column"* |
    | **v5** | *"two yellow legs each topped with a tall latticed/ladder-like post"* |
    | **v6** | *"a pale-topped horizontal beam carrying three round pale lamps"* |
    | **v7** | *"two yellow columns with fluted post caps and flared collars"* |

    **So the honest state is: the fixed part of a DUCK is stronger than the
    variable part, by construction.** The bar, the caution face, the two
    verticals and now the shared clearance header are what a reader names, and
    they are the same on all eight because the contract says so. Everything the
    file's differentiation budget buys is seen, described accurately and
    distinctly, and then filed under one noun. **No further DUCK variant will
    change that, and a brief that asks for one should say so** -- the lever that
    would is the contract, not the art.

    **v6 is the weakest of the three and the reason is instructive.** What the
    reader picked out on it was the three marker lamps on the FACE of the
    header, not the canted floodlight heads it spends its whole budget on.
    The 0.12 of relief across the span outreads a termination 3.2 units up, at
    the distances the game is actually read at.

    ### THE SCORER WAS WRONG FIRST, AND IT INVERTED THE ANSWER

    The script that read the answer files took the first of "over", "under" or
    "around" within 900 characters of a filename. Every answer section begins
    *"2. Over / under / around:"*, so it scored the HEADING. It reported reader
    D as answering OVER to all fourteen DUCKs and UNDER to every JUMP and every
    BLOCK -- a perfect inversion, 0 of 22, on a reader who had in fact scored
    21. **It was caught because the result was too bad to believe, which is not
    a control.** Rule 3 is about the instrument and this one was a throwaway;
    the parser now anchors on the section heading and the labelled line, and
    every number above is from that.

66. **The telegraph mat changes no lane judgement in a real three-lane gate --
    60 of 66 with it against 62 of 66 without, identical at 25.35 AND 32
    units -- but the
    reason is not that it is uninformative. Two readers decoded its colour code
    unprompted, one used it to learn WHICH LOW OBJECTS ARE JUMPABLE and carried
    that to the unpainted panels, and the reader who refused it read jumpable
    hurdles as walls ten times while naming the gold paint in the same
    sentence. The mat teaches the object once; it does not answer the question
    at every gate.**

    **BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** The mat is the one
    thing that looks like an exception and is not, because a marking painted on
    a surface is not an object. Nothing here licenses a half-built anything.

    Diagnosis only; no file under `src/` was edited. Pinned to `388bb8c` in a
    detached worktree. 16 real gates chosen by a mechanical rule, two distances,
    two arms shot as twins from one page evaluation, four counterbalanced
    uncontaminated readers on parentless branches.

    ### THE PREVIOUS PASS MEASURED A FLEET THAT DID NOT CONTAIN HALF THE
    OBJECTS IT WAS ASKED ABOUT

    It pinned `b9b2170`, which is **older than `a668100`**, the commit that
    built the access gantry, the floodlight gantry and the girder underbridge.
    **No panel it shot could have contained a `DUCK v5`, `v6` or `v7`.** This
    pass drew five of them mechanically. Answer: **`v5` 6/6, `v6` 6/6, `v7`
    4/4 -- the three new DUCKs read exactly as well as the established five,
    20 of 20 against 32 of 32, and DUCK overall is 52 of 52 in both arms at
    both distances.** `BLOCK` is 28 of 28, every variant including `v9` the low
    moped, and `BLOCK v3` -- the variant entry 61 caught reading OVER -- is 8
    of 8.

    ### THE STALE ARTEFACT, WHICH WOULD HAVE MEASURED THE WRONG FLEET

    `index.html` committed at the pin was 2,511,534 bytes against a 2,580,533
    fresh build, and `shoot.js` run against it reported **23 hazard variants
    for a fleet of 26**. Rebuilt inside the worktree before a panel was shot,
    and that rebuild hashes to blob `b815503`, **byte-identical to the
    `index.html` later committed as `b5d3b43`**. So the panels are the shipped
    game, checked rather than assumed.

    ### THE HEADLINE CONTROL WAS THE HARNESS CHECKED WITH ITS OWN RULER

    The previous pass's end-to-end control -- twins on disk differ by exactly
    the recorded mat count -- reproduces at 32 of 32, deviation 0 px, on an
    independent decode. **But it passes at the harness's own per-channel
    threshold of 6, which the harness chooses.** At threshold 0 the arms differ
    by **24.1% more pixels**, 28,463 of them, which that control cannot see.

    Settled by geometry rather than by argument. A Chebyshev distance transform
    from the supra-threshold mask puts **every one of the 28,463 within 8 px of
    a mat pixel**, decaying monotonically (57.2% at 1 px, 91.1% by 3 px, 100%
    by 8 px), peak amplitude **6/255**, with **no orphan region in any of the
    32 panels**. That is an antialiased edge and nothing else. **A threshold
    that the instrument sets is not a control until something outside the
    instrument says what it is hiding.**

    ### THE CROP IS DRAWN AROUND THE PAINT AND NOT AROUND THE ROAD

    Because the crop is the union of the object boxes and the measured mat
    boxes, the three lanes span only **0.332 to 0.539 of the picture width**,
    and one side is padded more than twice the other in **23 of 32 panels**.
    Arm-identical, so it cannot bias the contrast -- but a reader who took the
    kerb for a lane would return the truth **rotated one place**, scoring three
    wrong demands and reading as a legibility failure.

    Controlled two ways rather than hoped away: the prompt now anchors
    lane-finding on the broken lane lines, which are separate quads from the
    mats and **survive in the NOMAT arm**; and rotations are counted
    separately. Result over all 64 panels: **9 not exactly right, 0 of them
    rotations.** The defect is real and it did not bite.

    ### A LEAK CHANNEL NOBODY HAD CHECKED

    A MAT panel compresses worse than its twin **32 times out of 32**, mean
    26,248 bytes against 19,204, and an agent reader can run `ls`. Contained by
    two facts: twins never share a reader's set, and within every reader's own
    16 panels the bytes-per-crop-pixel ranges **overlap**, so no threshold on
    file size separates the arms.

    ### THE COUNTERBALANCING ITSELF CREATES TWO ARTEFACTS, AND BOTH FLATTER THE
    NULL

    This is the finding that should outlive the fade question. Within-reader
    counterbalancing was the fix for the previous pass's between-reader
    temperament confound. It introduces two new problems, in opposite
    directions, **both of which push the measured mat effect toward zero**:

    - **It teaches the reader that the paint is unreliable.** Reader C derived
      the code correctly -- cyan duck, gold jump -- and then abandoned it
      because two panels had *"no wash at all next to perfectly ordinary
      obstacles"*. Those two panels are NOMAT panels. **A reader cannot know an
      arm exists.** It then lost ten cells to exactly the objects the paint
      would have settled.
    - **It lets the mat arm tutor the nomat arm.** Reader B used the gold tint
      on two MAT panels to settle that the blue barriers and the trestle are
      *"jumpable rather than dead ends"*, and applied that to three NOMAT
      panels. Its nomat score is partly borrowed from the mat.

    **There is no design here that has neither problem**, and the next pass
    should say which one it is buying rather than rediscover this.

    ### THE ONE LEGIBILITY PROBLEM FOUND, AND IT IS NOT THE MAT

    All ten errors in the whole test are **OVER read as AROUND, on JUMP**,
    across five variants, at both distances, from one reader in four. Its language is
    constant -- *"chest high"*, *"well above waist height"*, *"solid to the
    ground"*. `MR.Collision.BOX` is the contract and art never decides
    clearance, but art is all a player judges by, and **one reader in four
    judged the art of a JUMP impassable**, on 10 of the 52 JUMP cells. That belongs to whoever owns the
    JUMP fleet.

    The ten losses are spread across the kind rather than concentrated:
    `v0` 3/4, `v1` 6/8, `v2` 9/12, `v4` 9/12, `v5` 3/4 -- and **`v3` alone is
    12 of 12**, untouched by any reader. So it is a threshold put in the wrong
    place, not one bad object, and `v3` is the shape that never triggered it.

    **It never cost a run.** Reading a JUMP as a wall makes you avoid a lane
    you could have used, so **lane choice is 64 of 64 viable, 16 of 16 in every
    one of the four conditions.** Nobody ever picked a lane that ends a record
    attempt, in either arm, at either distance.

    ### CONFIDENCE, AND THE ONE-READER TRAP SPRUNG AGAIN

    Reader A alone read as a result: **8 of 8 sure with the mat, 4 of 8
    without.** With all four in it splits **two readers each way** -- A and C
    surer with the mat, B and D surer without -- and pools to **24 of 32
    against 23 of 32**, one cell of difference in 64.

    **Stopping at reader A would have reported that mats make players surer,
    which is the previous pass's exact error. Stopping at reader B would have
    reported the opposite with equal conviction.** Within-reader
    counterbalancing did not rescue this on its own; it took the FOURTH reader
    to make the split unambiguous. Two readers is not a control for
    temperament, it is a coin.

    ### THE FADE

    Paint by distance, re-measured frame-wide on the fleet of 26: **29,830 px
    per lane at 8 u, 1,710 at `READ_NEAR` 25.35, 812 at 32, 415 at 40.** The
    published 18x is confirmed at **17.45x**, and 8 u against 40 u is **71.8x**.
    The `READ_NEAR` figure reproduces to the pixel against the previous pass on
    a different build and a different gate sample.

    **Fade OUT on approach, and only inside the decision distance.** The far
    mat is *read* -- readers described it unprompted at 32 units, *"two gold
    strips side by side"*, *"which glows cyan"* -- it simply changes no answer.
    The spendable paint is the 94% that lives inside 25 units, where the lane
    was chosen long ago. **The evidence argues against thinning the mat at or
    beyond the decision distance**, because that is where the teaching happens,
    and it argues hardest against the owner's instinct of faint-far-clear-near,
    since near is exactly where the mat is already redundant.

    ### THE LIMIT THAT MATTERS MOST, WRITTEN DOWN BEFORE THE ANSWERS LANDED

    Every reader cropped panels apart, upscaled them and examined lanes
    individually. **Unlimited time pushes BOTH arms toward ceiling and
    compresses any mat effect toward zero**, so this design is systematically
    biased against finding that the mat helps. A null result bounds what the
    mat is worth to a careful reader; it cannot prove it worthless to a
    glancing one. The attack is an exposure limit, which this harness cannot
    currently impose.

---

## Roadmap 67 · Effort: the pool is playable, and the bots can finally see it

The build the risk-reward measurement asked for, finished. `docs/risk-reward.md`
condemned the shipped game in one number — **six distinct policies all finishing
at 1:58:03, spread 0.0 seconds** — and `docs/strategy-space.md` proposed one
pool with two rival spends. Both had landed in `src/` before this pass. Neither
had ever been *measured playing*.

**Standing rule 1 carries into the handover at the foot of this section.** Every
object is modelled on all sides, fully, always. A marking painted on a surface
is the one exception, because it is not an object — which is exactly what the
surge zone's road paint is, and exactly what its entry signage is **not**.

### The blocker, and it was the whole job

The previous attempt's last words: *"`risk.js` is an honest negative: its six
policies still tie at 0.0s because none of them surge — its bots can't see
zones. The autopilot has the same blindness."*

That is not one bug, it is a **defect class**, and this pass found it in three
places. A surge is elected by *being in the marked lane*. Every bot in this
project scores lanes on CLEAR, aid and ramp. So every bot took a marked lane
only by coincidence, ran the course at the unsurged floor, and reported —
truthfully — that the mechanic changed nothing.

**A blind instrument does not report an error. It agrees with you.**

| where | what it could not see | before → after |
|---|---|---|
| `tools/risk.js` | no lane term, no election | policy spread **0.0 s → 79.4 s** |
| `main.js` autopilot | no lane term | surge **428u → 1272u** of marked road |
| `main.js` `?skip=` | never called `resolveAid` **or** `resolveSurge` | pool always empty, in **every shot in the library** |

The third is the one worth remembering. `?skip=` is how every frame this project
photographs gets taken, and it had quietly run a *different game* from the live
loop since before the pool existed — no aid collected, so under EFFORT no
segments, so no guard and no surge, ever, in any measured frame.

And a fourth, found on the way: the autopilot's **aid term was reading a rule
that went stale when aid became guarded** (R50). It wanted items between the
runner and the gate line — but an item sits at `g.z + 2*halfZ + AID_SETBACK`,
i.e. always *past* its own gate, and is paid out on a receipt for that gate. So
the bot steered for items it could no longer be paid for. **5 of 18 collected
before, 16 of 18 after.** `tools/risk.js` had the right expression
(`aid[ai].gate === gi`) all along, which is why that harness collected and the
game's own bot did not.

### What the fixed instruments say

`tools/risk.js --section policy`, six collection policies plus four spend
policies, real `Player`/`Collision`/`Course`/`Pace`, 450 ms latency, clean run:

| policy | surged | finish | vs record |
|---|---|---|---|
| take every bottle | 36% | 1:59:45 | +16s |
| take none | 0% | 2:00:28 | +59s |
| safe lane (centre) | 0% | 2:00:28 | +59s |
| **+ surge the first two** | 48% | 1:59:32 | **+2s** |
| **+ surge the last two** | 60% | 1:59:15 | **−15s** |
| **+ surge everything** | 64% | 1:59:12 | **−18s** |
| **+ hold one, then all** | 66% | 1:59:09 | **−21s** |

**Spread 0.0 s → 79.4 s. Three of ten beat the record, and all three spend.**
Every non-spending policy misses by 16-59 s. *Surge the first two* misses by 2 s
and *hold one, then all* wins by 21 — **the same pool, the same number of
segments, spent on later road, is worth 23 seconds.** That is the design's
central claim, and it is now measured rather than argued.

`tools/simulate.js`, 10 policies × 5 skills × 8 dates × 14 seeds:

**13 of 50 cells beat 1:59:30 (26%); on a FIRST attempt 5 of 20 (25%).**
Spread across policies at perfect skill: 85.0 s. Against the owner's bar —
*"if people get it on the first try everytime they will not always play"* — a
first-attempt player wins one time in four, and only by spending.

### The rule 4 defects, both found by writing the contract down

Writing the marking contract as numbers is what caught these. Neither was
visible any other way.

**1. The boundary — 50 ms.** `spacingAt` read the action window at the gate
*behind* the gap. Elevation varies smoothly and its own table looks 28 units
ahead, so that was always fine. **A surge zone is a step**, and `SURGE_PAD = 28`
cannot cover gate intervals that run to **70.4 units** (median 31.4). A gate
short of the entry line with the next landing inside was spaced unsurged and
answered surging. The guaranteed decide window inside a zone had a **floor of
712 ms against a 5th percentile of 739** — the whole tail was these boundary
gates, and 712 ms is tighter than anything this game has ever shipped.

Fixed exactly rather than with a bigger pad: space provisionally, ask what the
window is *where that lands*, take the larger. One step, cannot oscillate (a
zone is ≥420 units against a ~70-unit interval, so a gate pushed forward can
enter a zone and never leave one), and taken **only when zones exist**, so
EFFORT = 0 stays bit-identical.

**2. The datum — 22 ms.** The widening bought a **10 s/mi** lift
(`FLOOR_PACE → FLOOR_SURGE`) when the lift the player actually takes is
**17** (`FLOOR_BASE → FLOOR_SURGE`). The generator had paid for four sevenths of
the speed it sold. The old comment defended `K.FLOOR_PACE` as the only datum on
the grounds that `ACTION_WINDOW` and elevation's table are cut against it — the
premise is right and **the conclusion does not follow.** What the player is owed
is not a span in the generator's private units, it is **time**, and the time
they are owed is the time the road either side of the zone gives them.

**761 ms outside, 712 → 739 → 760 ms inside.** A surge now buys no reaction time
and costs none.

### Where this brief was wrong

**The gate price is not 6-9%. It is 0.0%.** The brief and
`docs/strategy-space.md` both predicted a zone would cost roughly 6-9% of its
gates, and treated that as the price mechanism. Measured, it costs nothing.

Getting that number needed a **matched control** — the road of the same length
either side of each zone. The obvious cut, in-zone density against the whole
rest of the course, reported zones as **7.9% DENSER**, i.e. the widening making
the road tighter, which is impossible. The confound is position: gate spacing
tightens monotonically through the race and zones live at 15-82% of it, so "the
rest of the course" is mostly the sparse opening. **The same defect
`tools/clarity.js` had to be re-cut for**, one instrument along, and it is now
two for two — *if a measurement compares a selected region against everything
else, the selection is doing the work.*

Why the price is zero: the spacing floor is **not what binds at most gates**.
The difficulty-driven random term is. A +1.43-unit widening on a 25.35-unit
floor only bites on gates already at that floor. **So the entire price of a
surge is the pool, and only the pool** — which is fine, because the pool binds
hard (2205 units of zone wants 15.7 segments against 13.7 collectible), but it
means every sentence in the earlier docs calling the gate loss "the price
mechanism" is wrong and should not be quoted.

### What is NOT built, and it is the thing a player would notice first

**Nothing in the renderer reads the zone table.** Not `world.js`, not `hud.js`.
The mechanic is mechanically complete and **visually absent**.

Interim, in scope and shipped this pass: the zone is **announced on the toast
that already exists** — no new HUD plate (the owner ruled that out), no new
control (a surge is still elected by the swipe). It fires once per zone at the
zone's own `sight` distance, read off the zone rather than written in `main.js`
so the cue and the paint cannot disagree, and it **names the lane**, which is
the one contracted fact a player cannot infer from anything else on screen.
Verified live in the page: `SURGE 1 / RIGHT` at units 1643 against a zone
starting at 1733, runner takes lane 2, pool drains 2.00 → 1.19.

---

### HANDOVER · the surge zone's marking contract, in numbers

Reproduce every figure with **`node tools/risk.js --section zone`**, which
fails the build if any of the guarantees below stop holding. Measured over 40
days, 181 zones. This is the ramp's deck/tailgate contract for the surge.

**RULE 1 APPLIES TO EVERYTHING THIS CONTRACT ASKS FOR.** The road paint —
lane wash, entry line, chevrons, distance ticks — is a **marking on a surface
and correctly has no back**, exactly as the lane dashes and the telegraph mats
do. Anything that *stands*, and an entry gantry or a lane-flag or a
count-down post would, **is built on all sides, fully, always.** The player
passes it at 1.70 units and the camera banks through every lane change.

**WHERE A ZONE IS**

| | |
|---|---|
| count | 4-5 a course, mean 4.53 |
| length | 420-560 units, median 492 |
| marked road | 35.2% of the course |
| first entry | 15% of the race; last 82% |
| closest two zones | 156 units apart — no entry marking is ever read against another zone's paint |

**WHAT MUST BE LEGIBLE, AND FROM HOW FAR**

| | |
|---|---|
| sight distance | **90 units** |
| in time | **3263 ms** of approach at the unsurged floor (27.59 u/s); 3050 ms if already surging (29.51 u/s) |
| commit point | a lane change takes **136 ms** = **3.8 units**, so the last one that lands by the entry line starts 3.8 units out |
| reading time owed | **3126 ms** before the last moment to act — **23x the act itself**, against a ~400-500 ms choice reaction |

90 is **not a taste number**: it is `Elevation.SIGHT_MIN`, the distance the
terrain sweep already *proves* stays visible over every crest on every course.
A contract written at 90 cannot be broken by a hill, by construction, and
`Elevation.validate()` is the proof. **Do not paint to a shorter distance and
do not assume a longer one.**

**Three facts, all three at 90 units, all three from one look:** that a zone
begins · **which lane is marked** · how far it runs.

**WHAT THE PLAYER CANNOT KNOW AT THE COMMIT POINT — this is the bet**

| | |
|---|---|
| gates in a zone | 15.1 |
| visible at the entry line | 2.7 of them (**18%**) |
| bought blind | **82%** of the road is past the sight line when they commit |

**WHAT THE MARKED LANE IS GUARANTEED TO BE**

| | |
|---|---|
| BLOCK in a marked lane | **0** over 2731 gates — enforced in `generate()` |
| rideable trains in a marked lane | **0** — `surgeAt` also refuses on deck |
| what it is | **20% clear, 80% an action you must perform** |

So the price of the surge is that **you cannot dodge** — you must act at what is
in front of you. An elected surge is always completable, never a wall.

**HOW MUCH OF IT IS A DECISION AT ALL — the number the art needs most**

| | |
|---|---|
| free | **20%** of in-zone gates leave the marked lane clear; the surge costs nothing there |
| contested | **35%** ask the player to give up a clear lane for one that demands an action |
| coincidental election | a bot that never *seeks* a zone still surges **44%** of the marked road; one that seeks reaches **65%** |

**The paint has to work hardest in the contested 35%**, where it is asking the
player to leave a free lane. In the 44% a player would have landed there anyway,
the marking is decoration — and that is the honest bound on what any art can be
credited with.

**FAIRNESS — the assertion that fails the build**

| | |
|---|---|
| outside a zone | floor **761 ms**, 5th 761, median 843 (at 27.6 u/s) |
| inside, surging | floor **760 ms**, 5th 760, median 817 (at 29.5 u/s) |

Difficulty comes from the allocation and from the cost of a mistake. **It must
never come from a reaction window the player cannot act on** — rule 4, and a
build failure. This assertion has caught the mechanic taking 50 ms and then
22 ms; it is why both were found.

**WHAT IT COSTS THE COURSE**

30.2 gates per 1000u beside a zone, 30.2 inside — **0.0%**, against matched
control bands. Course-wide the two fairness fixes moved 184.6 → 183.7 gates.

---

### Gate

`build`, `shoot`, `course-test`, `simulate`, `calendar` (32 days), `mechanics`
(**identity bit-identical at flags off**), `footroom` 96/96, `deckdrop` 24/24,
`kindread` (26 variants, 1 of 26 misclassified on profile alone — unchanged),
`risk`, and `playthrough`. `index.html` is rebuilt and committed separately.

**`tools/playthrough.js` is new** and is the answer to rule 2 for this mechanic:
it plays a whole marathon *in the real page*, per policy, and fails if the bot
elects no surge, collects no aid, or if seeking the marked lane barely beats
ignoring it. Every module-level harness in this project can be — and was —
simultaneously green and blind.

---

## Roadmap 68 · The surge zone, painted: a reserved lane, a gantry and a countdown

Section 67 closed with the one thing a player would notice first: **nothing in
the renderer read the zone table.** The mechanic was measured, gated and live,
and invisible. This is the paint, built to 67's contract rather than to a new
one, and stopped mid-pass when the file was needed elsewhere — so what follows
is what shipped, what it measured, and what is still open.

**Standing rule 1 applies here and the split it makes is the whole layout.**
The wash, the rails and the transverse bars are **markings on a surface and
correctly have no back**. Everything that stands — the gantry, its lane plates
and arrow, three countdown boards, two end posts — is boxes and a cone, built
on every side, because the player passes all of it at 1.70 units with a camera
that banks through every lane change.

### Three facts, three pieces, and the split is about what can hide each

67 owes the player three facts at 90 units. They are carried by three separate
things, and the reason there are three is that **no two of them can be taken
out by the same occluder**:

| fact | carried by | what cannot hide it |
|---|---|---|
| **which lane** | the road paint: a green wash over the marked lane with a bright rail on each boundary, running the whole zone | nothing overhead — the camera looks down, so a gantry can never be between the lens and the tarmac |
| **that a zone begins** | a lane-control gantry at z0: green header band across the chord, three lane plates, a white arrow on the marked one | no hazard — every member is at 9.35 and up, which is why `LOW` and `HIDES` have nothing to say about it |
| **how far away** | three roadside boards counting 3 · 2 · 1 at 90, 60 and 30 units | it is at the verge, not in the lane, and not overhead |

**Why the lane is a longitudinal mark.** This file's own Egypt-device note
already settles it: a transverse mark is foreshortened to nothing by forty
units, and a mark running *along* the road converges on the vanishing point and
keeps a screen-space length however far its far end is. At 90 units a lane is
about twelve pixels wide on a portrait frame. A badge in it would be two pixels
tall. A 500-unit ribbon in it is a wedge running to the horizon.

**Why green, and what it is not allowed to be.** Red-and-white is JUMP,
yellow-and-black is DUCK, orange is works, and amber/cyan/pink are the
telegraph mats. Green at 154 degrees is spoken by nothing here and is 37 degrees
off the DUCK mat's cyan. Two devices were refused outright:

- **Chevrons in the lane**, which 67's handover lists as candidate paint. A
  forward-pointing triangle on the tarmac **is the JUMP telegraph's own glyph**,
  and `paintGeo` already refused one for the expansion joints on that ground.
- **A red X on the unlit plates**, which is what a real lane-control gantry
  draws. The BLOCK mat is a pink X. An unlit plate says "not this one" without
  borrowing a word.

### The contrast decision, and the number that set it

**The marked lane is a surface a hazard stands on, so it is in the fairness
gate.** `api.contrastAudit` gained three roads — the washed lane per lane —
built from the same function the road tile draws, so what is measured is what
is drawn. That is the finish carpet's lesson one surface along, and 35% of the
course being inside a zone is why it is not optional.

**The wash is a DARKENING, and that is a floor rather than a taste.** Every
hazard in this game is a bright object; the dimmest is JUMP v7 at L 88.1. Any
surface at or below **L 70.5** therefore clears the 1.25x gate for all 26
variants on luminance alone, whatever saturation does. The wash is authored at
**0.68x the reference tarmac** and measures **L 61.5 / S 0.802** live — 1.44x on
the dimmest object in the game. Lifting the road toward the hazards is the one
direction that can take a variant under the gate, and the paint ladder's note
says the same thing from the other side.

**The rails moved to the lane boundary, and that was a measurement.** Built
inboard of the lane first, a 0.16 rail at 1.72x fell inside the audit's
`LANE * 0.44` sample window; at two and a half times the wash's brightness it
was a fifth of the area and dominated the mean. The surface came back at
**L 81.3 / S 0.74** and **eighteen** variants dropped into the 1.25-to-1.6 band
that had held six. On the seam at ±0.88 — where the seam rail, its shadow, the
beads and the edge line already live, and where the audit window has excluded
markings since it was written — the surface reports the wash's own tone and
**every tightest margin is identical to the pre-change build** (05-final,
JUMP v2 vs lane 1, gate +0.018 before and after).

An area-weighted mean of a two-tone surface is a poor model of legibility in
the first place — a hazard against dark-with-bright-edges is easier to pick out,
not harder. The answer was not to argue with the instrument.

### What looking at the real frames changed, which arguing did not

Three defects, all found on chase-camera frames at 90 and 60 units and none of
them visible in the source:

1. **The arrow was green on green.** At 60 units a plate is about eleven pixels
   across, and a glyph one step off its own background is a texture rather than
   a shape. The plate keeps the green — that is the blob whose *position*
   answers "which lane" at the far end — and the glyph went white.
2. **The plates touched.** At 1.72 wide against a 1.70 lane pitch, the three
   read as one long board with a green end. 1.50 leaves 0.20 of sky between
   them.
3. **The countdown post was invisible by construction.** A navy mast with green
   bars, standing among lamp standards and utility poles of the same navy in
   front of a wall of trees. It became a **pale board with the count cut into
   it** — inverted against the gantry's dark-plate-and-bright-glyph on purpose,
   because one hangs against sky and the other stands against foliage. Same
   rule the contrast gate applies one surface down.

### The machine read: 36 of 36, after the instrument was corrected

`tools/blindread.js` is the acceptance test and **it could not be run** — this
session had no Agent tool, so no fresh reader could be shown the panels. The
panel set exists and is portable exactly as blindread designs it: twenty
HUD-stripped chase frames (fourteen zone approaches at 90 units across three
dates and all three marked lanes, six controls on road with no zone within 260
units), shuffled, hex-named, with `PROMPT.txt` beside them and the key in a
separate directory. **Running it is the first thing the next pass should do.**

What was run instead is the strictly weaker, strictly checkable question
underneath: **is the answer in the pixels at all, and is it unambiguous?** For
every zone on eight days, a frame at the sight distance, the three lane
centrelines projected through the real camera onto the entry line, and every
pixel carrying the marking's hue assigned to the nearest of them.

**36 of 36 — the marked lane is the argmax every time**, with the marked lane
carrying 0.46 to 0.65 of the marking's pixels against a floor supplied by the
header band, which spans all three lanes because "a zone begins" is a fact about
the road rather than about a lane.

**The first run of this said 35 of 36, and the miss was the instrument.** It
scanned the whole frame, so a teal bicycle eight units in front of the lens was
counted as lane evidence about a line ninety units away. Cutting the scan at the
projected entry line — everything nearer than the entry is not the marking —
fixed it, and the frame that missed now reads its lane correctly. Rule 3, and
the instrument flattered nothing this time only because it happened to fail in
the honest direction.

A pass here is **necessary and not sufficient**. It says the signal is present
and lands on the right lane. It does not say a person reads it as an invitation.

### Where 67 and the brief were wrong

- **"How far away it is" and "how far it runs" are different facts**, and the
  brief and 67's handover each name one of them. This build answers the first
  with the countdown and the second with the end marking; the ambiguity is worth
  resolving before the next pass, because they want different devices.
- **67's candidate paint list includes chevrons**, which this file's own rule
  forbids. See above.
- **40% of zone entries have a mile gantry inside 95 units before them**, over
  40 days, 175 zones; the median gap from the preceding mile marker is 118 units
  and the **minimum is 1.3**. The mile marker cannot move — it is the mile — and
  neither can the entry. Spanning pieces (footbridges, overpasses, archways) now
  nudge off a zone entry as well as off a mile marker, composed rather than
  replacing it, with the mile rule winning a tie. **Mile gantries are not
  handled and cannot be.** In practice a further overhead object projects
  *lower* on screen, so the two rarely overlap — verified on the worst frame
  captured, mile 7 at 52 units in front of an entry at 90, where both read
  cleanly — but a coincidence at a gap of 1.3 units is two gantries in the same
  place and nothing here fixes it. This is why the paint and the boards exist.

### Cost, and the gate

Draw calls: **+10 at the worst frame measured** (07-wall-tall 239 → 249,
08-level 246 → 255, 06-mobile unchanged), peak **255 against ~400**. A tile
inside a zone costs exactly one extra draw — one mesh, one geometry, moved to
the marked lane and scaled in z to land on the zone boundary to the unit — and
the gantry, each board and the end marker are one each. Triangles moved under
0.1%.

`build` · `build --check` · `shoot` (all shots clean, no `LOW`/`HIDES`/`BLANKS`/
`PAINTS`, contrast margins unchanged) · `course-test` 90 days · `simulate`
13/50 · `calendar` 32 days clean, with `surgeGate`, `surgePost` and `surgeEnd`
named on all 26 walked days · `kindread` 1 of 26 on profile, unchanged ·
`footroom` 96/96 · `deckdrop` 24/24 · `mechanics --identity` bit-identical at
flags off, which the marking gets for free because `planSurge` returns nothing
at EFFORT 0 and nothing here draws from the seeded stream · `risk` ·
`playthrough`. `index.html` rebuilt and **left uncommitted**.

### Still open

- **Run the blind read.** The panels are staged and the acceptance test is not
  done until a fresh reader has answered the three questions.
- **How much paint can the road carry?** The directional-mat work coming next
  puts another marking language on the same tarmac, and the honest position
  from this pass is that the road is close to full. The near band is already
  39-54% merged paint mesh by edge density (`tools/inkbudget.js`), the mats own
  three saturated hues at full strength, and this pass added a fourth surface
  colour over a third of the course. **A directional mat should take a shape,
  not a new colour**, and it should take it in a hue already spoken — otherwise
  the fifth language is the one that makes the other four stop reading.

---

## Roadmap 68 · Directional mats, cones on the deck, and an opening with something to decide

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object in this game
is modelled on all sides, fully, always — every obstacle and vehicle of any
kind, every building, bridge, tree, crowd, sign and prop, and the runner. **A
marking painted on a surface is the one exception, because it is not an
object**, and most of this pass is paint: the tempo mat is a marking and has no
back. The cone on the deck is *not* an exception — it is `jumpConeGeo`, the
same fully-revolved three-cone body the road already stands, reused rather than
re-authored precisely so that no half-built roof variant could exist.

The owner, verbatim:

> *"I still think we need more obstacles and more rewards to navigating
> obstacles. A few more waters and bananas. More obstacles. Like on top of the
> cars with ramps. Inventive people to go up and there and under and over.*
>
> *I also want to add an idea. The Matts either go forward or backwards.
> Forward speed you up briefly and backwards slow you down briefly. If there is
> a backwards one, there needs to be an opening for the running to go through
> one of the other lanes."*

…then, in three corrections: **cones and nothing else on a roof**; **two
vehicles with ramps together so they can cross on them**; and *"on adding more
at the beginning — we need to find a way to get people engaged. The first few
miles are boring."*

### 1. The mat is a second mark, not a second meaning

The first decision was whether the direction rides on the telegraph mat. It
does not, and three measurements say so:

| the objection | the number behind it |
|---|---|
| the colour code is already full | `mats-three-lane` §2.10: three cleanly separated hues, and *"the mat, on its own, is a sufficient answer"*. Every error four readers made was a JUMP read as AROUND — ten of them — which is a **hue** confusion. Doubling the palette attacks the axis that already fails. |
| a telegraph mat is on every hazard lane of every gate | ~370 a course. The owner asked for an effect that lasts **briefly**; a direction on all of those is a continuous speed field. |
| a telegraph mat stands in a lane that already costs an action | slowing it as well charges twice for one obstacle, which is a punishment and not a choice — and the choice is the whole point of the backward mat. |

So a **tempo mat** is its own painted mark, on open road, between gates, saying
one thing: this lane is faster / this lane is slower. The telegraph mat keeps
its one meaning and its one measured job (§3.5b: teaching which low object is
jumpable).

### 2. The lift is derived, and it is widened for anyway

`LIFT = FLOOR_BASE − K.FLOOR_PACE = 261 − 254 = 7 s/mi.` That is exactly the
gap between the pace an unsurged runner runs toward and the pace `ACTION_WINDOW`,
`LANE_TRANSIT` and every gate spacing in `course.js` have been cut against
since the generator was written. Nothing was chosen.

It would have been defensible to stop there — the course is already spaced for
254 — and it would have been **wrong by this project's own standard**. The surge
pass established it: *what the player is owed is not a span in the generator's
private units, it is TIME, and the time they are owed is the time the ordinary
road gives them.* Under EFFORT the ordinary road gives 761 ms. At 254 it gives
741 ms. Taking those 20 ms is difficulty coming out of a reaction window rather
than out of the allocation, which rule 4 forbids.

So `surgeExtraAt` became `liftAt`, one function answering one question — *how
many s/mi faster than the ordinary road may the runner be here, because of
something the road said* — and a lift mark widens the window through the same
arithmetic a zone does. Measured, `tools/tempo.js --section fair`:

```
off a mat        floor 761 ms, 5th 761 ms, median 838 ms  (at 27.6 u/s)
on a forward mat floor 761 ms, 5th 761 ms, median 835 ms  (at 28.3 u/s)
verdict          -1 ms
```

And a **clamp** behind the widening, because belt and braces is what a fairness
proof is made of: `tempoTarget` maxes a lift at `K.FLOOR_PACE`, so no
combination of streak, hill and mat can go below it, and the fastest the game
can run is still exactly `FLOOR_SURGE`. Applied to the surge floor a lift
returns 254 — it cannot compound.

### 3. The open-lane guarantee is constructed, not hoped

The owner's one constraint on the backward mat. It is five clauses, enforced in
`assignTempo` and re-derived from the finished course in `validate()`:

1. **Readable** — no vehicle in the mat's own lane from `readWindowAt` behind
   its near edge to its far edge. Same standard every gate is held to.
2. **The mark ends before the next gate's telegraph run-up** (`TEMPO_TAIL = 14`,
   which is world.js's own mat length, not a number chosen here).
3. **A forward mat is earned** — some gate inside it demands an action of the
   marked lane. Without this a lift is two free seconds for running straight.
4. **A backward mat has an opening** — a named other lane, not BLOCK at any gate
   inside the mark, with no vehicle from `LANE_TRANSIT` before the near edge;
   and the dragged lane itself CLEAR throughout, so the drag is the only price.
5. **The opening is reserved** — no later mark may drag it. Without 5 the
   guarantee is order-dependent, and a guarantee that depends on placement order
   is not a guarantee.

`tools/tempo.js --section open` re-derives the opening from the gate table
rather than reading the field the generator wrote, and disagreement fails the
build. **153 of 153 backward mats over 60 days have an opening; the named lane
is open on every one.** 9% of openings are CLEAR the whole way through — swerve
and pay nothing — and **91% ask for at least one action**. That split *is* the
mechanic: eat five seconds, or pay one action to be in the fast lane.

### 4. A mark is trimmed to where it is legal, not dropped

The first version tested every gate the planned range covered and threw the
whole mark away on the first failure. **That cost 82% of the backward mats and
left one a course**, which is not a mechanic. The plan draws a z range before
any gate exists, so where it happens to end has no meaning, and every rule is a
statement about a **prefix** of gates. Trimming lands 2.55 a course with every
clause intact.

The same instrument then caught a second, quieter defect: `mat.gates` published
the gates the **plan** covered rather than the ones the mat ended up over, so
`tempo.js` re-derived the guarantee across ground the generator had never
claimed and reported three failures that were not there. A field a downstream
reader trusts has to describe the object that shipped.

### 5. Cones, and why nothing else may stand on a deck

**A deck has no sideways.** It is one lane wide, the runner is committed from
the mouth to the dismount, and leaving sideways costs the streak. A DUCK up
there is a demand with no alternative and a BLOCK is a wall with no
alternative — neither is a decision, and both are arguably the rule 4 failure
this project fails builds for. A cone is low, needs no overhead clearance, and
asks for a jump the player can time.

The deck layout is derived end to end:

```
z0                       the gate line, the foot of the tailgate
z0 + RAMP_RUN  (6.00)    the top of the tailgate; deck at DECK_Y = 2.80
+ ACTION_WINDOW (21.00)  a FULL action window of flat deck before the cone
the cone                 Collision.BOX[JUMP], resolved against the DECK
+ CONE_LAND    (19.84)   the whole airborne span, so the arc finishes on the
                         deck rather than in mid-air over the road
= 46.84 units            against 42.50 for the longest ramp the game shipped
```

`CONE_LAND` is the clause that stops the mechanic handing out free clears: a
runner still airborne at the dismount arrives at the next road gate with
`surface` above the DUCK bar and `y` above the JUMP block, and clears both for
nothing. So a coned vehicle is span **13–16** (49.5 to 60.1 units), and that
length is charged to the course through `reachOf` exactly as every other
vehicle's is. Measured floors over 60 days: **21.00 units of approach against
21 owed, 1.19 units of landing margin**, both proved in `validate()`.

`clears(kind, st)` is now `clearsOn(kind, st, floor)` at floor zero — literally,
by calling it. The shipped expression was exactly wrong in the dangerous
direction up there: the runner's own `surface` is 2.80 on a deck, so
`(y||0) + surface >= 0.84` is true before he has left the floor at all, and
**every roof cone would have been cleared by standing still**.

### 6. Two decks side by side. In series is not buildable, and here is the number

Both readings were costed rather than chosen.

**Side by side works and is nearly free.** Two rideable BLOCK lanes at one gate,
both carrying the gate's single train span, so the decks are the same length and
both sit at `DECK_Y` — level by construction, with no height term in the
crossing at all. `reachOf` takes the max over lanes, so a pair costs **no extra
spacing**. It puts a lane change at altitude in the game, which is a decision
this game could express nowhere else, and with a cone on one deck and not the
other it is a real choice.

**In series is not buildable**, and the invariant that blocks it is the one this
project will not trade:

```
gap floor     25.35u between one vehicle's far face and the next gate line
jumpable gap  16.17u -- the ground covered while the feet are above JUMP_CLEAR_Y
verdict       16.2 < 25.4
```

Two decks in one lane can neither abut nor be jumped without lowering
`readWindowAt`, which is the number every gate's readability is built on. There
is no version of this that is a tuning question.

Waiting for a gate that happened to roll two BLOCKs with a ramp on one gave
**0.13 pairs a course**. The second wall is made instead, and the safety comes
from where it always comes from here: the converted gate goes through
`solvable()` exactly as the roll did and is abandoned if the proof does not
survive it. **1.30 pairs a course, 78 of 78 keeping a third lane open.**

### 7. The opening: density was the wrong lever

Measured first, because the coordinator was right that the figure may have
drifted:

| mile | gates/mi | haz/gate | forced | aid | pool if perfect |
|---|---|---|---|---|---|
| 0 | 2.80 | 1.26 | 0% | 0.00 | 0.00 |
| 1 | 5.73 | 1.56 | 5% | 0.83 | 0.83 |
| 2 | 6.03 | 1.67 | 9% | 0.17 | 1.00 |
| 3 | 6.32 | 1.72 | 11% | 0.63 | 1.63 |

**`makeGate` was not touched, and the reason is arithmetic rather than taste.**
`staleness-and-mats` establishes that freshness cannot exceed objects divided by
density, so packing the opening buys difficulty by spending novelty — the wrong
trade for a boredom problem, and the opening is where every object is still
being seen for the first time.

The real cause is structural and nobody had written it down: **at the start of a
race the pool is empty, so guard and surge — the entire strategic layer — do not
exist yet.** The first zone landed at mile 5.73 and the first bottle at mile
1.77. The opening is not boring because it is easy. It is boring because it is
the only part of the race with nothing to decide.

Three things move, and none of them is a hazard:

| | before | after |
|---|---|---|
| first bottle | mile 1.77 (2.45 worst) | **mile 1.19** (1.88 worst) |
| road aid | 13.7 items | **15.9** |
| first surge zone | mile 5.73 (3.93 earliest) | **mile 2.33** (1.34 earliest) |
| first tempo mat | — | **mile 2.00** (1.32 earliest) |
| pool by end of mile 1 | 0.83 | **1.00** |

The early zone is **mandated**, it is **short** (300–420 against 420–560), and
it is an **addition** rather than one of the ordinary draws — and that last
word was bought by rule 2. Every headless number said the first version was
fine. Playing the whole race said the last zone had moved from 82% of the
course to 71%, because the mandated zone was counted against the wanted count
and so replaced an ordinary draw, usually a late one:
`playthrough` went from *"surging every zone is worth 46.0 s"* to
*"surging cost 23.4 s"*. With it added instead, the best spend policy finishes
**1:58:32 against 1:58:37 before the pass**.

It is deliberately a *bad* place to spend:
`d(target)/d(FLOOR)` is 0.285 at streak 5 against 0.93 at streak 150, so the same
segment buys a third of what it buys at the wall. The opening now asks its first
real question — take the free speed now or carry it — and the tempting answer is
the wrong one. The first tempo mat is mandated too, and is **forward every
time**: the first meeting with a vocabulary should pay, so the association is
that the paint means speed, and the first backward mat is then read against an
association that already exists.

This also answers the guard the coordinator raised: the first mile is the one
stretch where a contact cannot be absorbed, so the fix had to be *something to
spend*, not more to survive. It now has a segment by the end of mile 1.

### 8. What it cost, and what the instrument had to be told

```
TEMPO=0 ROOF=0   183.9 gates, 17.9 aid, 0 degraded
TEMPO=1 ROOF=0   183.8 gates  (-0.1)
TEMPO=0 ROOF=1   183.1 gates  (-0.8)
TEMPO=1 ROOF=1   182.9 gates, 19.2 aid, 0 degraded  (-1.0)
```

`mechanics --identity`: **the GATE hash did not move** — `e9f8d87f…`, the
baseline taken before EFFORT existed. The **AID hash was re-taken deliberately**,
because the aid curve moved for the opening. Aid reads the gate table and writes
nothing back, so where the bottles go cannot touch the course; that split is why
the two hashes are separate and this is the first time it has paid for itself.

**And the bots had to be told the mats exist.** Roadmap 67's finding was that
every bot here scored CLEAR, aid and ramp and nothing else, so a surge was
elected only by coincidence and `risk.js` reported six policies tying at 0.0 s —
truthfully, about a game its own instrument could not see. A tempo term omitted
from `main.js`'s autopilot and `risk.js`'s policy scorer would have printed
exactly the same honest nothing. **It had to be fixed in three places, and each
one hid the next:**

1. `main.js`'s autopilot and `risk.js`'s lane scorer got a tempo term — and the
   A/B still came back **bit-identical at `--tempo 0` and `--tempo 1`**, because
   `risk.js`'s race loop never applied a mat. *A scorer is where a bot decides;
   the election is where the game answers; a measurement needs both.*
2. The weights were then wrong in the direction that declined the mechanic.
   Set below the clear-lane term on the argument that "a contact is worth tens
   of seconds", which compares a mat to the wrong thing: taking a hurdle lane is
   taking an **action**, not a contact, and an action costs P(fluff) × a contact
   — 2 to 4 race seconds against a drag's measured 5.0. At −72 the bot preferred
   a clear lane *with a drag in it* over a hurdle lane without one, which is
   exactly the coasting decision the backward mat exists to make expensive.
   −150 and +55 are the expected-cost numbers.
3. `simulate.js` — the instrument the record contract is **quoted from** — was
   lane-abstract. Every question it asked was about a *kind*, and the lane index
   died at the end of each gate, so it could not see a mat at all.

With all three fixed, `risk.js --section policy` at `--tempo 1` against
`--tempo 0`, one build and one switch: **every policy is 6–7 s faster and 0 of
40 record cells change.** The mats are a stream of small local decisions; they
do not touch the record contract.

`simulate.js`, which is where the 26% figure comes from:

| | before | after |
|---|---|---|
| beats the record, all cells | 13 of 50 (26%) | **16 of 50 (32%)** |
| on a first attempt | 5 of 20 (25%) | **4 of 20 (20%)** |
| with the course learned | 8 of 30 (27%) | **12 of 30 (40%)** |
| spread at perfect | 85.0 s | **94.1 s** |

**And that landing took a retune, because this pass added on both sides of the
same balance.** Road aid went 13.7 → 15.9 and a sixth zone was mandated in;
more pool *and* more road to spend it on is more buyable speed, and the first
measurement said so — 42% of cells, 53% with the course learned. Over half of
everything winning is the 260 finding in different clothes.

`BURN_UNITS` is the lever that cancels it exactly, because it is denominated in
the same currency as both changes, and `SURGE_LEN_MAX` moves with it so a full
tank stays exactly one maximum-length zone:

| burn / max zone | all cells | first attempt | learned | spread |
|---|---|---|---|---|
| 140 / 560 | 42% | 25% | 53% | 85.0 s |
| **130 / 520** | **32%** | **20%** | **40%** | **94.1 s** |
| 120 / 480 | — | 10% | 20% | 85.9 s |

The column that decided it is **first attempt**: 20% against the 25% the
shipped game had, so a stranger is *less* likely to walk it than before, while
learned rose 27% → 40% and the spread 85.0 → 94.1 s. **Knowing the course is
worth more and guessing is worth less**, which is the owner's *"if people get it
on the first try everytime they will not always play"* expressed as two numbers
moving in opposite directions.

**Two assertions in `playthrough.js` were also wrong, and re-cutting them is
part of this entry rather than a footnote.** Demanding that surging *every*
zone beat never seeking one is the instrument insisting on the one policy the
design exists to make wrong. It is replaced by two tests that are **together
strictly stronger**: the best spend policy must beat never seeking, **and**
which zones must be worth something — which the old single test could not tell
apart from a game where every allocation was identical. And the units ratio was
a coverage test in disguise: coincidental surge scales with painted road, sought
surge is capped by the pool, so the ratio fell from 1.80x to 1.25x purely as
zone coverage went 38.7% → 46.5% with the mechanic untouched. The
pool-denominated form is invariant to that, and the ratio is still printed every
run.

*(A finding worth keeping: coincidental surge is **40–48%**, not the 33% three
lanes would give. The marked lane is guaranteed non-BLOCK inside a zone, so any
bot that prefers a passable lane lands there more often than a coin would. That
is a property of the generator, not an artefact.)*

### 9. What is NOT done, and it is the one thing that gates shipping

**There is no tempo paint.** `world.js` draws nothing for a mat. The
interim channel is the toast the surge zone shipped with, and it announces
**only the backward mats** — a forward mat the player never noticed costs them
nothing, while a backward one they could not see is a slow-down outside their
control. It names the slow lane and the open lane, at
`READ_NEAR + LANE_TRANSIT` out.

**The art commission, in the numbers it has to be built to:**

- **A shape, not a new hue.** The handover from the surge pass measured the road
  at 39–54% paint mesh by edge density in the near band and refused to spend a
  fifth colour. Direction is a shape.
- **Not a chevron and not an X in the lane.** A forward-pointing triangle on the
  tarmac is the JUMP telegraph's own glyph and a red X on a plate is the BLOCK
  mat's; either would make two marks mean two things each.
- **Length**: 18 to 88 units, median 57, one lane wide, laid from `mat.z0` to
  `mat.z1` with `Course.tempoAt(z, lane)` as the only source of truth.
- **Luminance**: a hazard stands on a mat by construction (a forward mat is
  *defined* by having one), so the surface must stay **at or below L 70.5** or a
  variant drops under the 1.25× contrast gate and `shoot.js` fails the build.
- **A direction readable at `READ_NEAR` = 25.35 units**, because that is where
  the lane is chosen, and readable at a glance rather than by decoding.

**A proposal, offered as a starting point and not as a decision.** Direction is
best carried by a **gradient in spacing** rather than by any glyph: a ladder of
transverse bars down the lane whose gaps **widen** forward on a lift and
**close up** forward on a drag. It is the road's own vocabulary — converging
transverse bars are what real carriageways paint to say *slow* — it is a shape
and not a hue, it is orientationally distinct from the longitudinal lane dashes,
and it is neither the JUMP mat's forward triangle nor the BLOCK mat's X. If a
hue is wanted on the lift, the surge zone's green is the one already spoken and
it already means *fast lane*, so confusing the two costs nothing: they say the
same thing.

The mechanic ships at `TEMPO = 1` regardless, because the interim toast covers
the only half with a fairness exposure and the lift half has none. If that is
judged too thin, `?tempo=0` is one query parameter and `MR.Course.TEMPO = 0` is
one line.

Until it lands, both flags are honest A/B scalars and `?tempo=0` returns the
other game whole.

### 10. Where this brief was wrong

- **It said `Course.solvable()` must prove the open-lane guarantee.** It cannot
  and should not: `solvable()` proves lane paths at gate lines, and a mat is a
  statement about ground between them. The guarantee is proved in `validate()`
  and re-derived independently in `tools/tempo.js`, which is the same division
  the surge contract already uses.
- **It framed the roof as needing "a way down that is not only the end of the
  vehicle".** With cones as the only legal roof hazard, the way down that
  matters turned out to be *sideways onto the paired deck*, which is free, level
  and already a lane change — so no new dismount was built and `deckdrop.js`
  needed no extension. It stays 24/24.
- **It asked for more hazards at the start.** Measured, that is the wrong lever
  for the stated problem, and the freshness arithmetic in
  `staleness-and-mats` says why. `makeGate` is untouched.

---

## Roadmap 69 · One speed system: the telegraph mats and the surge both go, and the strategy moves from the tank to the line

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object in this game
is modelled on all sides, fully, always -- every obstacle and vehicle of any
kind, every building, bridge, tree, crowd, sign and prop, and the runner. **A
marking painted on a surface is the one exception, because it is not an
object**, and almost all of this pass is paint: the tempo mat is a marking and
has no back. The one thing built here that stands up -- the advance board that
was added to the surge zone and then deleted with it -- was built on both faces
with its lane diagram correct from each, which is the note worth keeping from a
piece that no longer ships.

This entry covers three owner decisions that arrived in sequence while the work
was in flight, each one superseding part of the last. They are reported in the
order they landed, because the middle states produced measurements that the
final state depends on.

### 0. What the owner asked for, in three messages

> *"Remove all telegraph mats. Mats should all be there to increase or decrease
> speed. Two colors - one speeds you up, one slows you down. Placed randomly.
> Green speeds up, red slows down."*

> *"Make the zones smaller too. Small speed increase and small speed decrease.
> Placed strategically so that players need to make decisions. Around
> obstacles, on top of vehicles, around water and bananas."*

> *"One speed system. Remove the surge I think it's too confusing. Just one type
> a matt that either briefly speeds you up or down based off the color."*

The end state is one marking language on the road: **a tempo mat, green for
faster and red for slower, laid where a decision already exists.** The pool
survives, filled by aid, spending on guard alone.

---

### 1. The surge zone was made legible, and then deleted. The findings survive.

Entry 68 painted the zone and closed owing a blind read. That read is the
reason half of this entry exists, so it is reported even though the object it
judged is gone.

**The instrument that passed the marking was measuring the wrong thing.** It
projected the three lane centrelines through the real camera and took the
argmax of marking-hue pixels: 36 of 36. A blind reader shown twenty frames --
fourteen of them zone approaches at 88-90 units -- never once mentioned green
paint, a countdown or an arrow, and on a centre-lane entry at 90 units wrote:

> *"At normal size this is a bare road."*

**An argmax over three faint values resolves cleanly on a tint no human can
see.** The machine measured RECOVERABILITY -- is the answer present in the
pixels at all -- and reported it as LEGIBILITY. Those are different questions
and only the second one is the player's. This is the correction to keep from
entry 68 and it is why `tools/roadread.js` exists.

**Three defects were then found by looking at frames rather than at source**,
and all three are general:

1. **Everything the marking owned lay AT or BEYOND the entry line.** At the
   sight distance the entry is ninety units away, so the wash, the rails, the
   entry bar and the green block were all compressed into the last few pixels
   before the vanishing point -- while the near half of the frame was three
   telegraph mats at full saturation. The fix was to run the lane's boundary
   rails *back* ninety units into the approach, which is the only ground in the
   picture with screen area on it. One frame before and after settles it: the
   marked lane goes from invisible to a wedge across half the frame.
2. **The countdown boards were fully occluded and nobody had checked.** On the
   first zone approach photographed, BOTH live boards projected inside the near
   leg of an access-gantry DUCK standing eight units in front of the lens. One
   roadside object is one occluder away from nothing. The fix was a board on
   each verge, carrying a three-cell lane diagram as well as the count.
3. **The three plates were told apart by hue and by a glyph, and both channels
   are gone at distance.** At ninety units a plate is eleven pixels and the
   arrow inside it is five, and the atmospheric fade pulls a saturated green
   most of the way to the sky. The fix was SIZE -- the lit plate grew to 2.40
   against its neighbours' 1.50, bottom-aligned so the gantry has an obvious
   odd one out before any colour resolves.

**Then the owner removed the surge.** The art went with it. The three findings
are not about zones -- they are about what survives distance, what one occluder
can take out, and which channel a machine test can fake -- so they are recorded
here rather than deleted with the object.

---

### 2. The telegraph mats: removed, and it was measured before it was done

Three hues of iconised paint in front of every hazard, saying OVER, UNDER or
AROUND. All of it gone: `matTexture`, `matGeo`, `matMat`, `telegraph()`, and
the one non-variant child every pooled hazard carried.

**`docs/mats-three-lane.md` is why this is safe rather than a gamble.** Four
uncontaminated readers, 132 occupied-lane judgements at 25.35 and 32 units,
counterbalanced within reader:

| | mat ON | mat OFF |
|---|---|---|
| occupied lanes correct | 60/66 (91%) | **62/66 (94%)** |
| DUCK | 26/26 | 26/26 |
| BLOCK | 14/14 | 14/14 |
| lane choice VIABLE | 32/32 | 32/32 |

**The painted arm was the worse arm**, and nobody in either arm ever picked a
lane that would end a run.

**WHAT IT COST, stated so it is not rediscovered as a bug.** That same test
found the one job the mat demonstrably did: it **teaches which low object is
jumpable**. Reader B decoded the colour code unaided, used it to settle two
barrier sprites as jumpable, and carried the lesson to three unpainted panels;
reader C refused the code and read those same sprites as walls ten times. So
what is lost is a **learning channel over a player's first runs**, not the
moment-to-moment read. It is deliberately not replaced.

**What did NOT go is the road-fitting machinery.** `roadSurfaceY` and the
`updateMatrixWorld` fit were built for the mat and are the hardest-won code in
`world.js`; the tempo mat lies on the same road over five times the length and
inherits both. The header there records why it hangs off `updateMatrixWorld`
and not `onBeforeRender` -- attributes upload during `projectObject` at the top
of `render()`, so geometry written in `onBeforeRender` reaches the GPU a frame
late and every instrument in this project would photograph the mark before it
existed.

---

### 3. The tempo mat, drawn: green goes, red drags

One mesh per live mark, one draw. A strip of quads lying on the tarmac at
`MAT_LIFT`, fitted per vertex to `roadSurfaceY` -- the piecewise-linear surface
the rigid 24-unit tiles actually make, not the elevation profile they are cut
from. A rigid plane over an 88-unit mark departs from the tarmac by
`c * L^2 / 8 = 0.60 units`, which on a depth-tested material is not a faint
mark but no mark at all.

**The colour is the answer and the shape is the redundancy**, and the shape is
not decoration:

- **Red and green is the one pair a colour-blind player cannot split.**
  Deuteranopia and protanopia between them collapse exactly this axis. A
  mechanic worth two and a half race seconds that can only be read in hue is a
  mechanic those players cannot play.
- **Haze eats hue before it eats shape.** The surge pass measured it: a
  saturated green at ninety units is most of the way to the sky behind it.

So a **lift** carries three stripes ALONG the lane and a **drag** a ladder of
rungs ACROSS it. Longitudinal is the direction of travel; transverse bars at
close pitch are what a real road paints to say slow down. Neither is a chevron
and neither is a cross -- the two glyphs the removed mats owned are now free
and stay unused.

**The tone is a ceiling before it is a colour.** A hazard stands on a lift mat
by construction, so the mat is a surface the contrast gate has to know about.
The dimmest hazard in the game is JUMP v7 at **L 88.1**, so any surface at or
below **L 70.5** clears the 1.25x gate for all 26 variants on luminance alone.
Both mats are therefore a DARKENING carrying bright marks -- wash `0.46x`,
marks `1.50x` over about a fifth of the lane -- and `api.contrastAudit` reports
six more roads, lift and drag on each lane, built from the same function that
draws them. Measured: **lift L 62.3 / S 0.803, drag L 57.8 / S 0.748**, against
a ceiling of 70.5 and beside the finish carpet's own L 56.6.

**AND THE AUDIT WIRING WAS WRITTEN AND NOT CONNECTED.** `tempoLaneParts` was
built for the audit, documented as feeding it, and never called -- this entry
claimed six extra roads while `contrastAudit` returned nine. Caught by grepping
this file's own claim against the code. With it connected the gate tests all 26
variants against both mats on all three lanes and **the tightest pair does not
move**: JUMP v2 vs lane 1 at 1.29-1.33x, the same pair and the same numbers as
before the mats existed.

**A defect found by winding.** The first strip was positioned correctly, fitted
correctly, and drew nothing: the four corners wound `0,1,3 / 0,3,2` give a `-y`
normal, which `mats.paint` backface-culls. It photographed as a correct,
invisible mat -- exactly the shape of failure a position check cannot catch.

---

### 4. Strategic placement: a mat weights a decision, it does not make one

The design intent handed down, and the sentence the code is judged by: **a mat
should never be the decision -- it should change the price of a decision the
player was already making.**

**There is a circularity here and the obvious design walks into it.**
`spacingAt()` consults the tempo plan WHILE laying the gates, because a lift
widens the action window and a gate spaced for the unlifted pace would owe the
player reaction time it did not give. So the plan cannot wait for the gates and
the gates cannot wait for the plan.

The way through is that **the plan is a BUDGET, not a placement**. It draws a
long range, `spacingAt` widens across all of it, and `assignTempo` then paints
a SHORT mark somewhere inside that range, on the decision. Every unit of paint
is inside a range the course already widened for, so the fairness arithmetic
covers it and nothing has to be re-derived.

Sites, in order of how much of a decision they are:

| site | why |
|---|---|
| **an aid item in the mark's own lane** | a bottle already sits behind a hurdle in that hurdle's lane, so collecting it is already a priced detour. Green makes the detour cheap, red makes it dear. **The same pickup becomes a different decision depending on what is painted around it.** |
| **an obstacle in the mark's own lane** | required for a lift and always was (clause 3, "a forward mat is earned"). What changed is that the paint now ARRIVES at that obstacle with a full read window in hand instead of starting wherever the plan opened. |
| **a gate where the lanes differ** | the weakest site and still a real one: somewhere a player is choosing at all. |

Ground with none of these is not painted.

**Two defects this turned up:**

- **A mandated thing skipped a constraint every ordinary thing was held to.**
  The mandated first mark was pushed with no zone-clash test while the first
  zone was mandated into an overlapping stretch of the opening, so the one mark
  every player was guaranteed to meet was the one allowed to sit under a zone's
  gantry. Found on a chase frame; no headless number was watching for it.
- **Anchoring on a bottle can slide a lift clear of the hurdle that earns it.**
  1 course in 90 failed `validate()` on it. An aid anchor is now only taken for
  a lift when the earning gate is still inside the run it produces.

**Not built: mats on vehicle roofs.** A deck is a different running surface at
`DECK_Y`, so a roof mat is not this mark moved upward -- `tempoAt` would have
to answer for a lane the runner is riding rather than standing in, the strip
would have to lie on the deck instead of on `roadSurfaceY`, and the lift would
have to enter `spacingAt` through ramps, which are created DURING gate
generation and so land on the far side of the same circularity. It is a pass of
its own.

---

### 5. The surge, removed entirely

Not flagged off. A dead mechanic behind a scalar is a trap, and this one
reached into the road tile, five pools, the structure table, the contrast
audit, the spawn window, three tools and the pace model.

Gone: `planSurge`, `SURGE_SIGHT`, the zone length and count bands, the mandated
early zone, `zoneAt` / `zoneBody` / `surgeExtraAt`, the marked-lane promises
inside `makeGate`, every surge clause in `validate()`, `resolveSurge`,
`FLOOR_SURGE`, `BURN_UNITS`, the zone HUD nag, and all the zone art. `Pace.SURGE`
was **renamed `Pace.EFFORT_CFG`**, because three of its four fields survive the
mechanic and a wrong name on an exported object is a trap of its own.

**Assertions removed, named as the coordinator asked:**

| where | what it asserted | what replaces it |
|---|---|---|
| `playthrough.js` | the bot elected some surge (the roadmap-67 blindness check) | the bot must run some forward mat |
| `playthrough.js` | coincidental surge, 40-48% of marked road, printed every run | nothing -- a mat is not elected. The question it asked, what share of the paint is decoration, is now the policy spread |
| `playthrough.js` | the best spend policy beats never seeking, AND which zones is worth 10 s | reading the paint must beat ignoring it |
| `risk.js` | `opts.surge`, a spend policy, plus the three-part blindness audit | `opts.line`, a `{lift, drag}` weight pair, and the same three-part audit one mechanic along |
| `simulate.js` | eight surge-allocation policies | eight LINE policies |
| `tempo.js` | a lift stacked on a surge cannot pass the surge floor | the stated hard floor, `FLOOR_BASE - LIFT` |

---

### 6. THE MEASUREMENT THAT MATTERS: does the strategy survive?

`docs/risk-reward.md` is the standing warning. Before the pool had two rival
uses, **six policies finished at 1:58:03 with a spread of 0.0 seconds** -- aid
was insurance with no premium, worth 0.00 s to a clean run, and there was
nothing to decide. The surge gave the tank a second spend whose value peaked at
the opposite end of the race from guard, and that tension WAS the strategy.

**Removing the surge gives the pool one use again.** So the axis had to move,
and the claim is that it moves to the **LINE**: at nearly every gate the player
weighs what a lane costs in ACTIONS against what it pays in TEMPO. That is a
different KIND of decision -- local and repeated rather than global and
allocated -- and it had to be shown, not assumed.

**First measurement, and it failed:**

```
spread across policies at perfect    5.7s   (floor is 15s)
beats the record, all cells          0 of 40
```

**Surge had been worth about 131 race seconds a race** -- 1848 units run at
17 s/mi. The halved mats were worth about **4**. That is not a tuning error; it
is a mechanic with no room in it. Three things had to change and each was
forced by a measurement rather than chosen:

1. **The lift went back to the whole gap.** It had been halved to 3.5 s/mi,
   derived correctly against the cost of an action -- and the derivation's
   premise was deleted underneath it, because at the time the surge still
   supplied the race's speed and the mat only had to nudge a lane choice.
2. **The count went up, because the surge's road paid for it.** Zones plus
   their sight exclusion closed better than half the course to marks. With that
   gone: **7.85 marks a course -> 29.13**.
3. **`FLOOR_BASE` came down, 261 -> 258.8.** It sat 7 s/mi slower than the
   datum every gate spacing is cut against ONLY because the surge existed to
   buy the difference back. Removing the surge left the ordinary runner
   permanently slow for no reason and the record unreachable.

**And the clamp came off.** `tempoTarget` clamped a lift at `K.FLOOR_PACE`, and
that clamp had exactly one job: stop a lift compounding with a surge. With the
surge gone it would only have meant a lift did nothing once `FLOOR_BASE` came
down to meet it. A lift now takes the runner BELOW the spacing datum exactly as
the surge used to, paid for the same way -- `windowExtraAt` widens the action
window by precisely the lift, and `tempo.js --section fair` measures it.

**Where it landed:**

| | before any of this | with surge (entry 68) | now |
|---|---|---|---|
| policy spread at perfect | **0.0 s** | 94.1 s | **18.1 s** |
| beats the record, all cells | -- | 32% | **31%** |
| ...on a FIRST attempt | -- | 20% | **20%** |
| ...with the course learned | -- | 40% | **53%** |

**The difficulty bar is held on the column the last pass said decided it**:
20% on a first attempt, exactly. Knowing the course is worth MORE than it was
(53% against 40%), and the spread is well clear of the 15 s floor although far
below the surge's 94 s. `playthrough.js`, end to end in the real page: reading
the paint is worth **18.2 s** over ignoring it.

**A defect in the sweep's own cost model was hiding part of this.** An action
was charged `skill x penalty`, but `skill` is P(clear) -- so a PERFECT runner
was billed the full price of an action they never fluff, and the sloppiest was
billed the least. `READ ROAD`, the policy that scores both channels in race
seconds and is meant to bound what a perfect reader can do, was **losing to the
naive CHASE GRN**. An instrument that makes the informed line look worse than
the greedy one is measuring its own arithmetic. Fixed to `(1 - skill)`, and the
learned column went from 13% to 53%.

**AND THE HONEST HALF: aid is free insurance again.** `risk.js` on a clean run
-- take every bottle 1:59:21 against take none 1:59:22. **One second.** The pool
has one spend, a clean runner never needs a guard, and `playthrough.js` shows a
bot collecting 19 items and wasting 13 of them. That is precisely the defect
`risk-reward.md` was written about, returning by the front door. It is survived
rather than solved: the strategy is real and it is entirely in the line, not in
the tank. **The bottle is worth something only where a mat makes the detour
cost or pay** -- which is what the aid anchoring in section 4 is for, and it is
the thread to pull if this is to be fixed properly.

---

### 6b. THE BLIND READ, which is the acceptance test

Three uncontaminated readers, run OUTSIDE this repository against parentless
branches holding 22 panels and `PROMPT.txt` and nothing else -- roadmap entry
63's recipe, `tools/roadread.js --push`. No source, no `CLAUDE.md`, no
vocabulary to leak. 36 mat panels at 12, 25.35 and 40 units, 21 three-lane gate
panels at `READ_NEAR`, 9 controls on road clear of any marking.

**QUESTION ONE: do they still route correctly with no telegraph mats
anywhere?** This is the one that matters, because it is the question removing
them risked.

**21 of 21 gate panels: a viable lane chosen. Zero blocked, zero refused** --
with the single exception noted below, which is a panel my own harness broke.
Readers named objects specifically and unaided: *"a red-and-white striped
barricade"*, *"orange sandbags"*, *"a teal bicycle lying flat across the middle
lane"*, *"a blue box truck"*. And they reconstructed the DUCK affordance from
the art alone, with no mat to tell them: *"the middle obstacle is an overhead
beam with clear road beneath, while the left has a bike lying on the tarmac"*.

**QUESTION TWO: can they tell a green mat from a red one at `READ_NEAR`?**

| | lane + colour named, of 12 |
|---|---|
| reader A | **12** |
| reader B | 8 |
| reader C | 9 (7 confident, 2 "only on zoom") |

**Zero colour confusions across all three readers**: whenever a strip was named
at all, its colour was named correctly. The misses are all "I could not see one
here", never "I saw the other one".

**AND ONE READER DERIVED THE WHOLE CODE UNAIDED**, in its own preamble, before
any per-image answer:

> *"The road surface sometimes carries a coloured strip filling exactly one
> lane: dark green with bright green forward-pointing chevrons, or dark red with
> pale backward-looking streaks. Nothing in any image says what these do.
> Green-with-forward-chevrons reads as 'go faster' and red reads as 'slow
> down', but that is me reading the colours, not something the game told me."*

**THE RED MAT'S SHAPE DOES NOT CARRY ITS MEANING, AND THE GREEN ONE'S DOES.**
This is the finding to act on. Reader B derived the lift from its stripes and
could not derive the drag from its rungs:

> *"the LEFT lane's green chevron strip reads as a speed-up. That's an inference
> from the arrows pointing away down the road and the 'go' colour"*

> *"The LEFT lane's red strip is a deliberately marked surface -- but it has
> plain horizontal bands and no arrows, unlike the green strips elsewhere in
> this set, so I genuinely can't say what it does."*

So the redundancy the shape was put there for is **asymmetric**: longitudinal
stripes read as direction, transverse rungs read as "a marked surface" and
nothing more. Two of three readers got "green means faster" from the paint; none
got "red means slower" from the paint -- reader A reached it from the COLOUR
convention (*"the 'bad' colour"*), not from the rungs. For a red-green pair that
is exactly the wrong way round, because red-green is the axis a colour-blind
player cannot use. **The drag glyph needs to say "slow" on its own.**

**A second limitation, in their words: the shape needs enlarging at 25 units.**

> *"I had to zoom to see the streaks; at normal size it reads as a plain
> dark-green patch."*

The COLOUR reads at `READ_NEAR`; the glyph does not. So the mat is a
colour-first mark with a shape that only pays close in, which is the opposite
of what was designed and should be said plainly.

**A third, and it is about the placement:** mats are anchored AT decisions, so
the mat is frequently behind the very obstacle it prices.

> *"There is a green sliver visible far behind the truck's left edge on zoom,
> far too distant and too occluded to act on."*

> *"the crates sit right at the far end of that green strip, so taking the
> [lift] means committing to them"*

The second of those is the mechanic working exactly as intended. The first is
not: at 12 units the near hazard hides the paint. Anchoring a mark on an
obstacle puts the obstacle between the player and the mark.

**THE CONTROLS DID THEIR JOB.** On all 9 panels with no marking, every reader
said so: *"No. No coloured strip on any of the three lanes in this frame."*,
*"All three lane surfaces are plain tarmac."* Nobody hallucinated paint, which
is what makes the silences above meaningful.

**AND A READER CAUGHT A DEFECT IN MY OWN HARNESS**, which is the note this
section most deserves to end on:

> *"This looks to me like a rendering fault rather than a designed obstacle: the
> shape has no outline, no shading, no markings, and the road's dark edges are
> visible converging just above it."*

It was right that the frame was wrong and right about which frame. It was a
staging fault, not a rendering one: `camera.js` SMOOTHS toward the runner, so
posing the runner does not pose the camera -- and eight update steps left the
lens tens of units short, in that panel INSIDE a rideable vehicle, looking out
across its own roof at `DECK_Y`. `roadread.js` now steps the camera until it
stops moving and then ASSERTS where it landed. A second staging defect the same
reader found -- *"only the top of his red cap shows, flush with the road
surface"* -- was the runner posed at y = 0 on a hill; it is seated on the
elevation now. Neither touches the markings, which world.js draws from the
course table and which know nothing about the runner, but a panel with a defect
in it spends the reader's attention on the defect.

### 7. Three instrument corrections, all rule 3

1. **`tempo.js` had a derivation baked in as a constant.** `liftSpeed` read
   `K.FLOOR_PACE`, which was TRUE and a COINCIDENCE: the shipped `LIFT` was
   exactly `FLOOR_BASE - K.FLOOR_PACE`, so the clamp bound exactly. The moment
   the step changed, the line measured the window against a speed no runner
   could reach and reported an 11 ms rule-4 failure against a course that had
   widened correctly. It failed in the HONEST direction -- inventing a problem
   rather than hiding one -- which is the only reason it was caught.
2. **`simulate.js`'s skill term was inverted.** Section 6.
3. **`calendar.js` boxed a hill and called it a wall.** `HIDES` reported
   `set piece / tempoMark (y>=5.48)` occluding a JUMP eighty units ahead. The
   mark is flat paint twelve millimetres above the tarmac; its bounding box is
   5.48 units tall because it is fifty units of strip lying on a HILL. A flat
   mark became a wall because the audit measures extents rather than surfaces.
   Exempted with the road tile's own exemption, structurally.

`blindread.js` also had to be told the mats are gone: it asserted every pooled
hazard carried exactly one non-variant child and named it. The assertion is
kept with both counts legal, because its real job was to fail loudly if the
group grew a sibling it would photograph as the mat.

---

### 8. Where the briefs were wrong

- **The proposal that direction should be a gradient in spacing** -- bars whose
  gaps widen forward on a lift and close forward on a drag -- **cannot work,
  and the arithmetic is flat.** Perspective already compresses transverse
  spacing as `1/d^2`: over a mark running from 25 to 82 units, screen gaps
  shrink by 10.8x on their own. To make gaps merely LOOK equal, world spacing
  must grow as `d^2`; to make them visibly widen, faster than that -- a factor
  over 11 inside a 57-unit mark. Both directions would read as converging,
  differing only in rate. What survives perspective is ORIENTATION, which is
  scale-free and read locally.
- **"A shape, not a new hue" was overtaken.** The constraint was sound when the
  telegraph mats owned three saturated hues; with them removed the road has
  colour to spend, and the owner spent it. Shape is kept as redundancy, for the
  colour-blindness and haze reasons above.
- **"Placed randomly" was withdrawn one message later** and the code never
  implemented it.
- **Zone size and mat count are a direct trade, and neither brief saw it.**
  Raising the zone count to hold the difficulty contract took mats from 11.1 a
  course to 6.9. The exclusion band round a zone was symmetric and only its
  front protected anything; making it 90 ahead and 30 behind gave the road
  back. All of that is moot now, and it is the reason the mat count could
  quadruple the moment the surge left.
- **The suggestion to reach for `BURN_UNITS`** to hold the difficulty was the
  wrong lever twice over: it is denominated in units of ROAD, so shrinking
  zones did not touch it (the real mechanism was OPPORTUNITY -- less marked
  road means less of the pool can be converted), and it does not exist any
  more.

---

### 9. Cost and the gate

Draw calls: peak **244** at 08-level against a ~400 ceiling, down from **265**
shipped -- the surge furniture and the telegraph mats together cost more draws
than the tempo paint does, so the road got cheaper as well as simpler.

`build` - `shoot` (all shots clean, no `LOW`/`HIDES`/`BLANKS`/`PAINTS`;
tightest hazard contrast **JUMP v2 vs lane 1 at 1.29-1.33x**, gate margin
+0.022 to +0.062, the same pair and the same numbers as before this pass) -
`course-test` 90 days - `simulate` - `calendar` **32 days clean** -
`kindread` **profile 1 of 26**, unchanged - `footroom` - `deckdrop` -
`mechanics --identity` **bit-identical at flags off**, gate hash
`e9f8d87f...` and aid hash `a055853a...` against the recorded baselines, which
is the 365-day determinism proof surviving the whole rewrite - `tempo` (`validate()` 40/40, open-lane guarantee
**388/388**, fairness verdict **-1 ms**) - `risk` - `playthrough`.
`index.html` rebuilt and **left uncommitted**.

### 10. Still open

- **Aid is worth one second to a clean run.** Section 6. The pool needs a
  second spend or the bottle needs to be reliably priced by the paint.
- **Mats on vehicle roofs**, the one part of the placement instruction not
  built. Section 4 says what it costs.
- **THE RED MAT'S SHAPE DOES NOT SAY "SLOW".** Section 6b. Two of three blind
  readers derived "green means faster" from the lift's stripes; none derived
  "red means slower" from the drag's rungs. On a red-green pair that is the
  wrong way round, because red-green is the one axis a colour-blind player
  cannot use. The drag needs a glyph that reads as braking on its own.
- **The glyph needs enlarging at `READ_NEAR`.** The colour reads at 25 units and
  the stripes and rungs do not: *"at normal size it reads as a plain dark-green
  patch"*. Either the marks get bolder or the redundancy claim gets narrowed to
  close range.
- **Anchoring a mark on an obstacle hides the mark behind the obstacle.** At 12
  units a reader found the paint *"far too distant and too occluded to act on"*.
  The lead-in is a full read window from the ANCHOR; it may need to be from the
  point the near hazard stops blocking the sightline instead.
- **The learned axis is thin.** `GRN CHAIN`, a policy that looks 300 units
  ahead and picks the lane leading to the most green, does not beat greedy
  `CHASE GRN`. A mat decision is myopically optimal, which is the structural
  difference between a line and an allocation.

## Roadmap 70 · The redraft: soft light, no ink, and the street becomes a canyon

The owner, in order: *"I want my game to look like this game. Buildings, road,
obstacles, cars. It looks more life like."* (reference/citylook-*.jpg, ten
frames) and then, mid-pass and decisively, *"I don't like the 'toon' look."*
The second sentence promoted the shading swap from phase 3 to the headline:
the toon ramp and the ink WERE the look being rejected, so they went first and
the geometry followed under the new light.

**Phase 1 -- the shading swap** (`src/render/shading.js`). `ramp()` returns a
160-sample continuous curve with a soft shoulder at dotNL 0.92 instead of
bands; the floor and the warm-to-cool shadow tint survive, because the
reference shades in temperature, not in grey. Every `INK` weight is 0 --
character and hazard included -- through the existing invisible-shell path, so
a line anywhere is still a one-number restoration. The sky lost its four cel
steps. Measured, not hoped: every hazard-contrast margin WIDENED when the ink
came off (tightest gate margin +0.028 before, +0.235 after, same shot) --
the dark edging had been dragging the area-means down.

- **The envelope did not move.** tools/envelope.js measures fill geometry and
  always excluded the shells (its own header says so); worst drift across all
  ten states was 0.00006. No re-baseline needed, and that finding is recorded
  INSTEAD of a silent skip. footroom 96/96 and deckdrop 24/24 likewise.
- **Shadow maps refused on measurement.** Live A/B at the peak-draw framing:
  blob shadows 182 draws / 2.6 ms, a single 1024 PCF shadow map 314 draws /
  4.6 ms on SwiftShader. +132 draws against a ~400 ceiling with a 244-draw
  peak frame. The pooled blob system stays; it is also what the reference
  draws under its own cars.
- **Ink removal's real price:** peak frame 244 -> 206 draws. The commissioning
  brief predicted "roughly half" -- stale, because scenery/prop/banner ink was
  already 0; only character and hazard shells remained.
- **The ghost still reads as not-solid** (verified frame): its rim is its own
  raw-shader treatment in ghost.js, untouched by the INK weights.

**Phase 2 -- the canyon** (`src/render/world.js`). CITY START gets a new
`canyon` roadside kind: pavement ends at the facade line (8.55 = 1.14
road-widths off centre, the reference's own proportion), the street wall
pulls in from 12.2, density 0.70 -> 0.94, and the pavement carries the
reference's props -- oil drums, trash bags, a portaloo, a coffee A-board, and
deliberately NO crates or planters (the owner's rule: those exist only as
hazards). Crowd knots compress onto the pavement; trees, groves and walkers
skip canyon tiles (their bands are inside the buildings now; skipping the
claim is deterministic because the layout stream was already consumed).
FINAL MILE keeps its grandstands -- they are that leg's canyon -- and the
open legs keep their forms, per citylook-desert-outskirts.jpg: the canyon is
the city's shape, not the game's.

- **The lamps reach over the road again**, deliberately, inside the rules R3
  wrote: head at y 13.0 (4 above OVERHEAD_Y), thin, glowing amber through an
  unlit lens mesh that rides the canyon edge group (one draw per live tile).
  The receding line of lit lamps is the single strongest cue in the
  reference set. LOW/HIDES pass by construction; the mile gantries stay in
  open sky below the arms.
- **The road stopped being track bed.** Light 1.2-unit joints deleted (22 Hz
  -- shimmer, by this file's own earlier arithmetic), heavy joint kept at
  reduced contrast, the Egypt rail-and-bead seams replaced by the
  reference's white dashes (0.38 x 3.0 / 6-unit period, 2.35x tarmac,
  neutral hue -- the mats keep amber/cyan/pink to themselves), lane bands and
  camber halved. The dashes carry lane identity now.
- **The key light swung behind the camera and rose to ~55 degrees**, the
  drawn sun following it out of frame (no citylook frame shows a sun disc).
  Every face the player reads is now in warm light, one flank warmer than
  the other, exactly as the reference lights its street. Ramp floor
  0.31 -> 0.38, cool 0.38 -> 0.30, so the shaded flank stays warm.

**Phase 3 -- the facade language.** Striped awnings (the old one-colour
divergence note is half-expired: its aliasing arithmetic was computed at the
12.2 facade line, and at 8.55 the stripes read for the first third of the
draw distance; past that they fade to their own pastel mean, which is the
reference's own distance behaviour). Signboard fascias, one bay in four
shuttered, mullions, three portrait sashes per bay in reveals with sills,
air-conditioners. Pavement widened to cover the deepest bay step-back.

**Phase 4 -- vehicles and the ramp's invitation.** The cel specular's two
hard thresholds became smooth pow terms (8 / 60) -- under a continuous ramp a
stepped highlight was the last banded thing in the frame, and a pow core
cannot switch a whole flat panel on at once, which was the failure the old
constants' comment records. The rideable tram ramp carries the reference's
gold chevron-stack arrow (citylook-ramp-arrow-container.jpg) as PAINT --
planes on the running surface over a dark backing, rule 1's stated
exception, zero extra draws.

**Runner rules whose reason has expired, recorded so nobody obeys a dead
rule** (the ink went to 0; the runner's geometry is untouched):

- *"THE INK SHELL IS THE UNIT OF COMPOSITION"* (runner.js, the character-pass
  header) and *"the cause is not the shapes. It is the INK"* (the arm weld
  note): part boundaries are no longer hard black lines, so the
  one-outline-per-limb constraint on future part-count decisions is moot.
  The welds themselves stay -- they are good masses -- but a new part no
  longer costs a counted outline.
- The lace-panel post-mortem's third clause ("two 0.014 shells close a 0.008
  gap twice over") describes an occlusion that no longer occurs; the panel
  stays deleted for the other two clauses, which were about geometry.
- Proud-ness margins quoted against the 0.014 ink ("0.022 proud ... clears
  the 0.014 ink") are now just proud-ness; nothing needs to clear a shell.

**Deferred, stated:** citylook-tunnel.jpg (an enclosed bore) is recorded as an
optional set-piece candidate and NOT built -- it is the hardest possible
geometry for LOW/HIDES/BLANKS and nothing in the owner's instruction asks for
it. Nothing in the canyon work made an over-road enclosure cheap; the canyon
is all lateral geometry.

**Side-by-sides**, honest names: reference/redraft-canyon-vs-citylook.png,
reference/redraft-shopfronts-vs-citylook.png,
reference/redraft-ramp-arrow-vs-citylook.png. Blind read of two unlabelled
frames by a fresh session: shots/blind/REDRAFT-ANSWERS.md on branch
blindread-redraft-answers.

**The full gate at the final build:** build --check clean; shoot all shots
clean (peak 206 draws / 324k tris, tightest contrast margin +0.123);
course-test 90; simulate PASS; kindread profile 1 of 26; footroom 96/96;
deckdrop 24/24; mechanics PASS and --identity PASS; tempo PASS; calendar and
playthrough recorded in their own logs at the close of the pass.

### Roadmap 70a · What the blind read said, verbatim, and what it leaves open

A fresh session shown two unlabelled frames (branch
`blindread-redraft-answers`, shots/blind/REDRAFT-ANSWERS.md) and asked only
to describe the street. The words that matter, both ways:

- *"Tall double-headed street lamps arch in from both sides and converge to
  the horizon, which sells the depth of the street better than anything else
  in the frame."*
- *"They read as generic European-city terraces... at this distance the
  repetition reads as 'a street', not as copy-paste."*
- *"Nothing reads as hollow -- the barricade, the traffic light, and the
  barriers all look like objects with sides."* And: *"the pipe stack even
  shows the open ends of the pipes, which is a nice touch of real
  geometry."* Rule 1, confirmed by a stranger.
- *"The street is convincing as a race circuit and less convincing as a
  city."*

Acted on immediately: *"the placards are blank -- solid colour rectangles
with nothing on them, which reads as unfinished"* -- they now carry an inner
panel and two text-weight stripes, both faces.

Open items, recorded rather than half-done:

- **"The greenery is a small blob that reads more like a scoop of guacamole
  than foliage"** -- JUMP v7's planter lobes want the understorey treatment
  the scatter trees already got. Fleet SHAPE is owner-approved, so this is a
  lobe-count change inside the same collision box, with the contrast audit
  re-run.
- **"Even and shadowless light... makes nothing feel anchored to the
  ground."** The hazards carry blob shadows; the READER still wants more
  grounding. The measured answer is not a shadow map (Roadmap 70's A/B:
  +132 draws, refused) -- it is baked contact darkening on the tile under
  barriers and lamps, and possibly a slightly stronger hazard blob. Needs
  its own contrast re-measurement.
- **Window flatness up close** -- *"pure flat colour with no depth, glint, or
  interior"*. A per-window gloss opt-in (aGloss exists) would put the sky's
  glint in facade glass for zero draws; worth a measured pass.
- **The kerb reads "almost knee-high"** -- authored 0.34. A look question,
  not a fairness one; halving it would need the pavement seam re-checked.
- **The jagged tempo-mat chevron edge** the reader saw is the pre-existing
  glyph geometry, already on the open list at Roadmap 69.

## Roadmap 71 · Citylook to the limit: the canyon at reference height, eleven new objects, and four reader loops

The commission, verbatim: *"I want to make the game look better and as close
to the screenshots I sent as possible. I want the cars to look the same, the
obstacles to look the same and the same color. I want the buildings to look
the same. Do not be afraid to make wholesale adjustments and make it utterly
perfect."* Mid-pass the owner added: lots more obstacles -- the gameplay
freeze lifted for VARIANTS only, density explicitly still owned by course.js
and untouched.

**Enclosure, measured not eyeballed.** Instrument: frame-edge column fill and
whole-frame sky fraction, same code on their frames and ours (HUD masked on
theirs, canvas-only shots for ours). The reference's six city frames measure
0.85-1.00 edge fill and 0.163-0.190 sky. Ours before: 0.54-0.88 edge,
0.227-0.276 sky. Ours after: 1.00 edge on every city frame sampled and
0.102-0.132 sky -- now slightly MORE enclosed than the reference; the sky
instrument counts our shaded cloud bellies as non-sky, so the true figure
sits a little above what it prints. What moved it: every setting's terrace
gained 2.5-3.5 units and one to two storeys, the near facade line stayed at
CANYON_FRONT 8.55 (the reference's own 1.14 road-widths, already matched),
and the backdrop towers stepped back.

**The palette was sampled, not guessed** (scratchpad sampler, median of
rects): their lit cream renders #e0d38f, brick #9a5234, olive #867344 under
green cornices #465427; road #586259 -- warm green-grey, shadedL ~94; sky top
#8ac1d2 powder cyan; lamp pole #9e9374 with lens #fdf96d; cars #e84328 /
#5bc13e / #c4973d saturated; police warm black #373326 on cream #d9d2a5;
bus lit teal #75fbfc. Everything below chases those numbers through our own
lighting, verified by re-sampling our shots.

**What changed on the street.** Twelve settings warmed toward the sampled
band (each keeps its hue identity as a tint inside it); green cornice caps
with dentils on half the flat-roof bays; brick quoins one bay in 2.5; window
glass lightened 30% toward the reference's blue-grey and given the cel
specular through aGloss; plaster grunge -- a 64px near-white mottle with
run-off streaks -- multiplies into mats.prop so large wall faces stop being
flat paint for under 3% of any measured colour; roads went from blue-violet
0x61637x to the reference's warm grey at the same shadedL (every paint ratio
holds by construction), then lifted 4.5% toward their L94 -- half the lift
first tried, because the full 9% put lane 1 at L100 and the tram at 1.16x
against a 1.25x gate; pavements went stone grey; the violet lane seam dropped
to a whisper (1.28x -> 1.10x, bead 1.50 -> 1.32); margins warmed; ten
blue-sky cities' horizons mixed 38% toward mint-cyan with fogs following;
cloud coverage opened twice; the key warmed and rose 2.30 -> 2.50 with the
hemisphere eased toward neutral so a shaded flank stays warm paint (ramp
cool 0.30 -> 0.21 -- the reference's shaded cream renders #a8985f, never
blue). The canyon lamp head dropped 13.0 -> 12.55, still above every mile
panel, and the amber signal column -- the reference's second-strongest
vertical -- now stands one per side per canyon tile, arm stopping at x 4.9.
Barrier-tile lamps took the same warm pole and amber head.

**The fleet.** The bus went the reference's teal; the tram brightened
0x1e9cf0 -> 0x3cbcff to clear the lifted road. Eleven new variants, all
objects the frames actually contain, every one inside its collision box by
tools/orbit.js's measured extents and every one through the full gate:

- JUMP v8 the double-bar red-and-white barricade on wooden posts with round
  amber blinkers (weight 2 -- it is the reference's signature obstacle);
  v9 black OIL drums; v10 the single-bar low barricade; v11 a trash pile.
- DUCK v8 a shop awning rigged across the lane (green-white; the kind mark
  stays on the bar and face); v9 a hanging shop signboard; v10 a scaffold
  walk-board span with a davit and bucket.
- BLOCK v10 the rust Cargo container (weight 2); v11 a dumpster with its
  lid thrown open; v12 the green one-box hatchback parked at 0.16 rad of
  yaw (swept extents 1.90/1.04 against 1.95/1.12 -- budgeted, not
  eyeballed); v13 the black-and-white police car.

**Repetition, staleness.js on 30 dates, before -> after:** median same-skin
gap JUMP 9.0s -> 13.7s, DUCK 10.6s -> 14.6s, BLOCK 13.4s -> 17.1s;
back-to-back BLOCK 18.2% -> 16.7% (the train floor is structural and no
skin count moves it). kindread profile: 1 of 37 misclassified, was 1 of 26
-- same lone moped, nothing new misreads; hue-alone stays the known-bad
channel it has always been.

**Four reader loops, all fresh headless readers outside the repo with no
context** (the CCR-sibling route stalled on a permission prompt and was
abandoned for claude -p from a neutral directory -- an uncontaminated
reader, which blindread.js's own header says is worth more):

1. Verb read, 33 panels at 8/12/25: every barricade OVER, every new DUCK
   UNDER sure, container/dumpster/hatchback/police AROUND -- and both dark
   low JUMPs failed as 'solids you go around'.
2. Drums recomposed upright-in-a-row (the cones' composition): failed
   AGAIN. Two readers cannot both be wrong: an upright drum does not
   afford a jump. It now lies side-on with its slick spreading forward --
   the reference's own composition, and the pipe stack's proven horizontal
   silhouette. Trash lowered to 0.62 and widened: OVER at all three.
3. Drums lying: OVER at 8 and 12; at 25 the two symmetric band pairs read
   as 'two striped posts'. One off-centre collar per drum.
4. Drums at 25: OVER, sure ('a speed bump' -- a low over-able road shape,
   which at ten pixels is the honest limit of naming). All eleven variants
   now read their verb at 8, 12 and 25.

**The gap list, iterated to its stopping point.** A fresh reader ranked
ours-vs-theirs differences three times across the pass (plus one inherited
from the M4-M8 arc). By the last iteration the top five tells were: the
runner on screen, course props instead of moving traffic, no floating
coins, course furniture down the road, and the spectator crowd -- every one
of them the game's own identity (traffic is formally refused with
measurement at the top of world.js; the crowd and barriers ARE a marathon).
Below the fold the actionable items were acted on (awnings re-weighted to
their red/blue, warm lamps everywhere, Chicago out of grey, road value,
cloud bank). What remains that our engine cannot express, stated plainly
per the brief's stopping rule: legible per-shop signage text (every prop
shares one vertex-coloured material with one map -- per-sign canvas decals
would cost a mesh and draw call per sign against the ~300/400 draw budget),
their 2D-painted backdrop softness, and texture-resolution weathering
beyond the shared plaster mottle. Those are the honest limit of 'utterly
perfect' in this renderer, and everything short of them has been built.

**The full sweep at the close:** build --check clean; shoot all shots clean
(tightest margin +0.021 after the knife-edge +0.006 was widened on
purpose); course-test 90 PASS; simulate PASS; calendar 32 days clean;
kindread 1 of 37; footroom 96/96; deckdrop 24/24; mechanics --identity
bit-identical; tempo PASS; playthrough PASS. Peak draws unchanged at ~206
against ~400 -- eleven variants cost zero draws by the pool's own
arithmetic (only the visible body is ever submitted), and the signal
columns ride the canyon tile's existing merge.

Side-by-sides, honest names: reference/citylook-vs-ours-street.png,
citylook-vs-ours-street-2.png, citylook-vs-ours-cars.png,
citylook-vs-ours-obstacles.png. Density is owed to course.js and was
deliberately not touched -- the variant bag got deeper, the road did not
get busier.

### Roadmap 71a · Three refinements after the entry closed

- **The drums' one collar** (f421908): at 25 units the lying drums' two
  symmetric band pairs read to a fresh reader as "two striped upright
  posts, around"; one off-centre collar per drum keeps the horizontal
  silhouette unambiguous. Reader iteration five: OVER, sure, at all three
  distances.
- **The barricade's middle post** (fe4c5bd): the reference's double-bar
  carries three posts and three blinkers; ours now does. The diagonal
  stripe experiment was built, photographed, and refused -- at gameplay
  scale the rotated stripe boxes shimmered against the board edges.
- **The transverse joint drops its violet** (d58a836): the M4
  neutralisation caught the longitudinal seam rail and left the heavy
  expansion joint on 0x3c3a56 -- a fresh gap reader ranked the resulting
  blue band a tell, and the pixel hunt confirmed it. Warm asphalt family
  now (0x4a4840 at 0.80), same as the rest of the ladder. Shoot clean
  after each of the three.

71b. **The citylook pass closes: what remains is identity, not deficit.** The
  final reader gap list (verbatim on `blindread-citylook`,
  `shots/blind/citylook/GAPLIST-iter2.md`) ranks fourteen differences between
  our frame and the reference, and the top five are things this game is RIGHT
  to differ on: a visible runner on foot against no character at all; a
  marathon course with static works against lanes of moving traffic (refused
  here three times with measurements); their coins against our aid; their
  bare pavements against our crowd; their open road against our race
  furniture. The reader's own closing line makes the point better than any
  defence: the strongest tells "almost certainly distinguish a
  dodge-traffic runner from a marathon on foot." That is the game telling a
  stranger what it is from one frame, which is what identity means.

  Of the nine quality items below those, the later milestones (M3 grunge and
  warm fill, M8 lamp housings and the stepped-back towers, the warm joint
  and barricade refinements after 71a) acted on the asphalt tone, the lamp
  fixtures, the facade warmth and the weathering. What is left, stated as
  the engine residuals the stopping rule asked for:

  - **Readable signage density.** Their shop fascias carry legible, varied
    text at close range; ours carry pattern. Canvas textures could push
    further, at real draw-call and authoring cost per distinct sign.
  - **Painted-texture richness** -- tire-wear striping on asphalt, per-wall
    weathering variation, poster clutter. A 3D engine with procedural
    surfaces approximates this; matching a hand-painted backdrop
    pixel-for-pixel is the one thing it cannot do.
  - **Sky softness.** Theirs is a painting; ours is a shader. Close, and the
    remaining distance is brushwork.

  Small actionable leftovers, cheap, unclaimed: manhole covers and road
  debris; one or two more pavement prop kinds (their chalkboard cooler);
  distant landscape silhouettes down the vanishing point on open legs.

## Roadmap 72 · Density: the road carries more, the mats pay the bill, and the bar does not move

The commission: **more obstacles, lots more** — the owner's phrase across
weeks. Sequenced deliberately after the citylook variant expansion (26 → 37)
because freshness cannot exceed objects ÷ density: the bag was enlarged
first, and this is the density half of the same lever. Everything below was
measured either side on the same instruments, 60 days headless for density,
30 dates in the running page for repeats (`tools/staleness.js`), and the
policy × skill sweep in `tools/simulate.js` for the bar.

**What moved, in `makeGate` and one mat constant:**

1. **The mid-band second hazard became a dial.** `rnd.int(1, 2)` held the
   second hazard at a flat 50% from mile 0.7 to mile 8.2 — precisely the
   measured trough of boredom at miles 3–7. Now
   `rnd.chance(0.50 + 1.40 * (d - 0.09))`: continuous with the coin at the
   band floor (the opening's learning stretch is untouched), ~0.96 at the
   hand-over to the always-2 band, one draw either way.
2. **`full` (three-lane, forced-action gates) rose** 0.10/0.30/0.48/0.62 →
   0.16/0.40/0.58/0.70. 7b0a1d2 had declined to touch this pending its own
   evidence; the evidence is the sweep, run either side, bar held (below).
3. **`TEMPO_DRAG_SHARE` 0.52 → 0.57**, and the reason is what LANDS, not
   what is planned: a forward mat must be earned by an action in its lane
   and a drag needs its lane clear, so a denser road converts more planned
   lifts into placed ones and kills more drags. At 0.52 the landed mats went
   fwd 19.6/bwd 9.7 → fwd 20.5/bwd 8.5, handing the mat-chasing line ~2
   free seconds and pushing first-attempt to 30%, then 23% at 0.55. 0.57
   restores the landed balance (fwd 18.8/bwd 9.2) and the bar exactly.

**What was tried and refused by the measurement:** `spacingAt`'s mean,
44 − 23d → 40.5 − 22d. Ten extra gates a course made a CLEAN run ~20 s
faster and sent first-attempt cells from 20% to 80% — at PERFECT skill,
where no hazard demand claws it back — because pace follows the streak and
the streak is a count of cleared gates. **Gates per mile is a speed dial
before it is a density dial**, and the record is an absolute 1:59:30. This
is the measured form of what entry 58 said in passing when it named `nHaz`
as the one number. Reverted; recorded at the site in course.js.

**Density, hazards/mi (60 days):**

| band | before | after | |
|---|---|---|---|
| opening 3 miles | 7.53 | **8.41** | +12% |
| miles 3–7 (the trough) | 11.68 | **13.72** | +17% |
| miles 7–13 | 15.78 | 16.88 | +7% |
| miles 13–20 | 18.83 | 19.85 | +5% |
| miles 20–26.2 | 20.31 | 21.12 | +4% |
| whole race | 16.10 | **17.23** | +7% |

Hazards per gate at miles 3–7: 1.82 → 2.16. Hazard sightings per run
422 → 453. Gates per run 182.3 → 184.8 (+1.4 s on a clean run — fewer
BLOCK trains means smaller reach at the spacing floor; absorbed into the
retune). Forced-action share at mile 6: 35% → 50%.

**The repetition line held — the whole point of the sequencing** (30 dates,
skill 1, `staleness.js`):

| kind | median gap before | after | p10 before | after | b2b before | after |
|---|---|---|---|---|---|---|
| JUMP | 13.7 s | 12.5 s | 4.1 s | 3.8 s | 1.6% | 1.8% |
| DUCK | 14.6 s | 13.4 s | 5.1 s | 4.7 s | 0.9% | 0.9% |
| BLOCK | 17.1 s | 18.5 s | 1.3 s | 1.2 s | 16.7% | 16.9% |

DUCK's median was 5.8 s at 5 variants and ~8.2 s at 8; at 11 skins it
absorbs a 17% denser trough and stays at 13.4 s. No kind fell below its
pre-expansion line. BLOCK lengthened (fewer blocks: more full gates, which
never carry one). The b2b BLOCK figure is the train, as ever — with trains
out it is 3.3%. The one real cost: gate SHAPE variety narrowed — top-three
shapes 12.8% → 16.8% of gates, shape entropy 5.43 → 5.27 bits — because
all-action gates crowd out CLEAR combinations. That is what density IS; it
is stated here rather than hidden.

**The difficulty bar, held exactly:**

| | before | after |
|---|---|---|
| beats 1:59:30, all cells | 14/45 (31%) | **15/45 (33%)** |
| ...on a FIRST attempt | 6/30 (20%) | **6/30 (20%)** — same six cells |
| ...with the course learned | 8/15 (53%) | 9/15 (60%) |
| policy spread at perfect | 18.1 s | 18.0 s |

No reaction-time was spent: `spacingAt`'s floor (readWindowAt + reachOf) is
untouched, `shoot.js` clean, calendar 32 days clean, the guaranteed decide
window unchanged. Difficulty moved where rule 4 allows: demand frequency
(forced share up across the mid-race) — and the mats' price structure paid
the difference back.

**Identity re-taken, in its own commit, old and new stated** (the 7b0a1d2
lesson, not repeated): gates e9f8d87f… → 95e55c3cdbae17988b36ca57aa8f0a59f480b618,
aid a055853a… → c40930a11001c3e86039e55dd25e77a3775c0d22 (dependent move
only — the placement rule is untouched, `aid.js` proves it on the new
course: 14/14 items, cut-in bot 0, reach 100% at 30% fluff).

**The full gate on the final state:** build --check, shoot, course-test 90
and 365, simulate, calendar 32 clean, kindread PROFILE 1 of 37, footroom
96/96, deckdrop 24/24, mechanics (re-baselined), tempo 365/365 with
3426/3426 drag openings proved, playthrough end to end 1:59:34.

**Where the brief was wrong, recorded:** it framed spacing as part of the
density lift ("gates/mi" in the record). The streak coupling makes that a
speed change first — the strongest single finding of this pass.

## Roadmap 73 · One city a day: measured, recommended, waiting on the owner — **SHIPPED** (see 75)

The owner: *"Consult with agents and determine if it makes sense to only run
one location a day. It doesn't make sense to me that we go to 3-4 locations. I
think this would help with the daily game occurrence."*

Analysis pass only — nothing under `src/` touched, nothing ships from it. The
full memo is **`docs/one-city-a-day.md`**; the finding in three lines:

- **Recommended: one city per day, dealt from a shuffled bag of the twelve.**
  Today a city returns after a median of 2–3 days and 73.6% of consecutive
  days share a city — no day is ever *about* anywhere. A bag makes every city
  exactly once per 12-day cycle, worst gap 23 days.
- **The seams carry less than assumed**: mean seam ΔE 9.7 against biome pulls
  of 17.7 (THE WALL) and 13.7 (THE BRIDGE), which one-city keeps in full; and
  the first seam lands at mean 69 s, after the miles-3–7 trough it was
  credited with relieving. The real cost is architectural variety and
  landmark kinds per course (14.3 → 7.8), traded for 100% of a city's beats
  per appearance instead of 40%.
- **The core change is identity-safe, verified**: settings are drawn after the
  gates on their own stream, and `mechanics.js --identity` hashes gates and
  aid only. The work is world.js dormant paths (keep the seam machinery, do
  not delete), the start panel headline, a replacement for `decisiveChapter`
  (cut by biome leg instead of city), tool sampling assumptions, and a
  content top-up for the thin cities (VALENCIA 6 kinds, AMSTERDAM/CAPETOWN 7)
  — fully-built, all angles, as everything is.

Fallback if the four-minute single vocabulary fails in play: two cities per
day, pre-measured in the memo (H2), one seam per run, machinery already built.

  Roadmap 73 DECIDED by the owner 2026-08-26: one city per day, via the shuffled bag.
  SHIPPED 2026-08-27 — what actually changed, and where the memo's sketch was wrong, is Roadmap 75.

## Roadmap 74 · Abundance and the 5% bar: countless pickups, one guard economy, and a record only rehearsal walks

The owner's two changes, verbatim, and they pull against each other: *"1.
Make the game tougher. Only 5% of first runs should result in a win. This
should mean more obstacles and paths. 2. Adjust the water and bananas. We
need countless of them similar to these other games that have coins. That
keeps players engaged."* Endless aid feeding the guard pool at the old
per-item value would have made contacts free and pushed the win rate the
wrong way, so the two were tuned together, economy first.

**The economy (item 2).** Aid goes from ~16 scarce bottles -- each a whole
guard segment, each a priced decision behind an obstacle -- to **~580 small
pickups a course** (measured 365 days: 585/course; 434 loose, 137 arc, 13
roof), laid the way the reference game strews coins:

- **TRAILS** down lanes that are CLEAR at their gate, vehicle-free over the
  whole run, never leading into a lane the next gate walls off, ending 8u
  short of the next gate line so the coin line never leads the eye into a
  hazard read.
- **ARCS** behind JUMP and DUCK obstacles, receipt-guarded at their gate
  (the roadmap 50 machinery, unchanged), the JUMP strings hanging on the
  falling half of the jump arc via the same `y` field roof items carry --
  collected mid-flight, one action buys the string.
- **CLUSTERS** after BLOCK trains and full-width gates -- the burst that
  pays for coming through a hard section still moving. (Its first version
  walked one item into FINISH_GRACE on day 44 of 60 -- the ramp run-in
  defect's exact class -- caught by the rewritten aid.js and capped.)
- **ROOF RUNS** of 3-5 along each deck instead of one bottle; collection
  still requires standing on the ramp. Roof trails stay roof-only.

A pickup is a **bite of a segment**: `PER_SEG = 24` fill one, the pool is
fractional between whole segments so the fuel gauge fills visibly (no new
HUD), and `GUARD_COST` stays one whole segment. Measured economy
(tools/aid.js, now the guard of this contract): a flawless seeking line
collects **14.7 segments** against the old ~13.7 collectable; a natural
line collects 8.5 incidentally; the cut-in exploit bot still collects **0.0
of 132** guarded items. Two consequences worth naming:

- **A guarded contact now costs its stumble** (`GUARD_TIME` = 1.5 s, streak
  kept). Total absolution was affordable when a segment cost an action to
  collect; with the pool refilling for free, it made 0.96 play like 1.0 and
  no pace number could hold the first-attempt bar.
- **Roadmap 50's placement rule is retired for the loose classes**, and the
  retirement is recorded at the site in generateAid. That rule solved free
  insurance when a bottle was a whole segment; abundance is a different
  design and the owner chose it for engagement. What survives is the
  rule's point, moved up a level: the denomination, the guarded share and
  the guard's residual cost price the economy as a whole, and aid.js fails
  the build if collectable segments leave the 8-20 band.

**The difficulty (item 1).** Density rose where roadmap 72 says it buys
difficulty without spending reaction time -- hazards per gate, never gates
per mile: makeGate's full-width table +0.06 a band
(0.22/0.46/0.64/0.76), the mid-band second-hazard slope 1.40 -> 1.70, and
closures 0.06 -> 0.08 ("more paths", the cheap version strategy-space
ranks buildable; full geometric forks stay out of scope). The spacing
floor, READ_NEAR and every guaranteed window are untouched; shoot.js,
tempo (2911/2911 openings, 389/389 paired gates), footroom 96/96,
deckdrop 24/24, kindread PROFILE 1 of 37 and calendar 32 all hold on the
final state, and course-test proves 365 days solvable.

**The bar, and the finding under it.** The first tuning landed
first-attempt 2/30 with learned 1/15 -- knowing the course was worth
nothing, and the number exposed a structural fact: **a lane change costs
nothing and every mat covers a gate line, so a flawless stranger equals a
flawless learner**. GRN CHAIN, the policy built on "position early for
mats you know are coming", LOST to the myopic informed line at every
skill; it is retired from the sweep with that finding written on it, and
nothing at flawless execution can separate the two columns spatially.

What separates them honestly is **chained demands** -- the currency the
difficulty brief itself sanctions. A demanded action within 1.5 read
windows of the previous one is a chain: the second read starts while the
first action is still executing. The informed stranger's line meets **78
of them a race** at the new density, and the sweep now clears an
unrehearsed chain at skill x 0.979 (a 2.1% sight-read miss, first attempt
only -- a modelling constant, stated as one); a learned line has run the
day and pays no discount. Every chained gate keeps its full guaranteed
window: what knowledge buys is execution of chains you know are coming,
which is exactly what a daily-course game should reward. With the chain
tax carrying the first-attempt bar, FLOOR_BASE settles at **259.1**
(259.0 -> 259.7 -> 259.1 across the pass; the floor now prices what a
REHEARSED line can do). The sweep also models two smaller honest
asymmetries: strangers read paint and coins to READ_NEAR past the gate
while learned lines know the whole gap, and a stranger switching lanes
for a trail joins it 12u late.

**The final distribution (tools/simulate.js, 8 dates x 14 seeds a cell):**

| | cells | share |
|---|---|---|
| beats 1:59:30, all cells | 8/45 | 18% |
| ...on a FIRST attempt | **2/30** | **6.7%** (the grid's nearest step to 5%) |
| ...with the course learned | **6/15** | **40%** |
| policy spread at perfect | 33.2 s | |

The two first-attempt winners are both flawless-execution bounds (NO AID
and READ ROAD at skill 1.0, by 3-5 s); real first runs sit far below the
cell fraction. The learned winners: PLAN AID at perfect through 0.98,
HARVEST (the deliberate coin line, GRN CHAIN's replacement) at perfect
and 0.995 -- and HARVEST at 0.96 is the best line in the game at 1:59:44,
still 14 s outside the record: the coin economy rescues a broken run
without ever handing it the record. COIN CHASE, the naive newcomer line
the abundance is for, is the most robust low-skill policy and never
wins. Identity re-baselined in its own commit, old and new hashes stated
there and in mechanics.js (gates 95e55c3c... -> dc33748a..., aid
c40930a1... -> 6e39f138...).

**The reader check on the trails** (frames through the live chase camera,
scratch shots at skips 55/120/160/200; the reader was this session
answering from pixels only -- no isolated fresh agent was available, and
that limitation is stated rather than hidden). Asked "what must you react
to": mile 6 -- *"Two vehicles ahead, the green skip and the rust
container; I pick the gap between them. The green discs with white
bottles are pickups running through that gap; I'd follow them. Nothing
else needs an action."* Mile 17 -- *"The red carpet with the red
diamonds is paint saying slow, I'd move off it; the bananas and the
bottle say collect."* Mile 22 -- *"Yellow bar across the left says slide
or move right; the mint discs low behind it say there is pickup under it
after the slide."* Aid read as "collect" in every frame and as an
obstacle in none; the mint disc-and-bottle family sits nowhere near the
amber/cyan/pink hazard vocabulary, and shoot.js's occlusion and contrast
gates stay clean with ~580 items live on the course.

**How the abundant game feels** (playthrough, real page, end to end): the
bot finishes 1:59:37, 0 unguarded hits, 3 cone-trips absorbed by guard,
368 pickups collected, 196 wasted into a full tank, gauge at cap most of
the race. The road reads collect-collect-collect -- a coin line threading
the gap between two lorries at mile 6 is the reference frame's feel on
this game's road -- while the record sits 8 s away from a clean informed
line, which is the two halves of the owner's ask in one run. The 3
cone-trips are the pre-existing bot blindness to deck cones (it rides
ramps but has no cone timing), now visible because guard pays for it;
noted here rather than fixed, since every policy shows exactly 3 and the
mechanic under test is unaffected.

**Where the brief was wrong, recorded:** it asked for abundant pickups
whose "total collectable segments stay near today's ~13-16" AND
first-attempt at 5% -- but with free collection, holding the old segment
count makes guard riskless, which is why the guard now charges its
stumble; the honest statement is "same segment supply, cheaper to gather,
each guard slightly less absolute". It also implied course knowledge
already had somewhere to live; it did not (the GRN CHAIN finding above)
-- the learned axis had to be BUILT, out of chains, and the 40% learned
column is real only under the stated sight-reading model. And its
"~13-16 segments" framing conflated on-course supply (now 24) with
line-collectable (14.7); this entry uses the second, which is the one
that prices anything.

## Roadmap 75 · One city a day, shipped: the bag, the headline, the leg verdict, and the thin cities fattened

Roadmap 73's decision, implemented. The owner: *"one location a day ... would
help with the daily game occurrence"*; the memo (`docs/one-city-a-day.md`)
ranked the shuffled bag first and this pass ships exactly that. Every claim
below was re-verified against today's source rather than taken from the memo,
and the places the memo's sketch was wrong are listed at the end, because
that is what the memo asked for.

**The deal** (`src/core/course.js` `pickSettings`): one city, whole course,
`from 0, to 1`, dealt by Fisher–Yates over the twelve on a stream keyed by
the cycle index — epoch-day / 12, derived from the passed date key, never the
clock — with salt `settings/v2`; `settings/v1` retired with the draw it
described. Epoch days count straight through month and year boundaries, so a
cycle that starts December 27th ends January 7th with no seam. Measured over
730 days from 2026-01-01: every aligned cycle deals 12/12 distinct cities,
same-city gap median 12 / p90 18 / worst 23 days, five back-to-back repeats
in two years (cycle-boundary doubles, inherent to any bag). The next twelve
days from the ship date: TOKYO, NEW YORK, CAPE TOWN, BERLIN, BOSTON, LONDON,
AMSTERDAM, CHICAGO, ROME, VALENCIA, PARIS, CHICAGO.

**Identity, the strongest guard this pass had:** settings are drawn after
generation on their own stream, and `mechanics --identity` came through
bit-identical — gate hash `dc33748a` and aid hash `6e39f138` both unmoved,
re-checked after every course.js edit including the hint strings. The
simulate grid did not move either: first-attempt 2 of 30, spread 33.2s,
PLAN AID still the winning learned line.

**What the player sees** (`src/ui/hud.js`, stylesheet): the start panel's
route line becomes the day's headline — "ROME" at masthead weight under the
wordmark, sized against AMSTERDAM at the 320px floor — because one word now
carries the identity three names used to share. The rail's city row is a
single centred label (`.rcity.solo`); the cut-drawing loops and the whole
seam machinery in world.js stay dormant, not deleted, per the memo. The end
card's "city that carried the run" died with the seams (its guard requires
two settings), and the replacement cuts the same counterfactual by BIOME LEG:
`chapterCosts` now cuts at the six biome boundaries and the card says "CLEAN
THROUGH THE WALL · 1:57:24" — proved by driving the real card with five
synthetic contacts concentrated in THE WALL, and by its correct silence on a
clean run. Floor and majority rule unchanged; six rows make the majority
stricter, so the line prints less often, the safe direction for a verdict.

**The thin cities carry whole days now, so they were fattened** — fully
built, all angles, in each city's own vocabulary: VALENCIA gains the Torres
de Serranos (merlon rings all the way round both towers) and the orange
grove its hint had owed from the start (6 kinds → 8); AMSTERDAM a smock
windmill with lattice sails facing the course (7 → 8); CAPE TOWN the Green
Point lighthouse — bands as stacked drums, so the stripes have no back — and
the stadium the real race finishes at (7 → 9). All five spawn (walk census:
torresSerranos x14, orangeGrove x11, windmill x13, lighthouse x15,
ctStadium x9 on their days) and the three city-days raced end to end clean
through LOW/HIDES/BLANKS/contrast.

**The instrument got the same scrutiny** (`tools/calendar.js`, own commit):
the 32-day default was sized on pair saturation under the 3–4 draw; the
re-measured curve saturates at day 15 (bounded by the 23-day worst gap, not
by 12, because a prefix straddles two shuffles). Default kept at 32 — it
clears the bound from any start date and the surplus is gate-layout
coverage. The run confirms: 32 days clean, 12/12 settings, 72/72 pairs, 100
named objects, 6/6 races to the tape.

**Where the memo's sketch was wrong, recorded:**
- *"all 72 pairs in any 12-day window"* — only ALIGNED windows: the worst
  sliding 12-day window covers 42/72 pairs (tail of one shuffle, head of
  the next). Coverage claims must be stated per aligned cycle or per
  23-day bound.
- *"spread, never doubled"* (§4) — a bag CAN double across a cycle
  boundary; measured ~2.5 back-to-back repeats a year. Small, but not
  never.
- The memo implied 12-day saturation for the fairness calendar; the honest
  number from an arbitrary epoch is "by day 23 at worst, 15 measured from
  2026-01-01".

Full gate on the shipped build: build --check, shoot 8/8, course-test 90
and 365, simulate (grid unmoved), calendar 32 clean, kindread, footroom,
deckdrop, mechanics --identity bit-identical, tempo, playthrough end to
end. Frames in shots/: onecity-panel-tokyo/rome (the headline panel),
onecity-val-* (the thin city, full course), onecity-rome-* (the rich case),
onecity-ams-mill, onecity-cpt-light, onecity-cpt-stad (the new pieces),
onecity-endcard and onecity-endcard-burst (the leg verdict, silent and
speaking).

## Roadmap 76 · Two bugs from the owner's phone: the pop in the lens, the lorry gone underfoot

Both found by the owner playing on a phone, neither by the gate suite, and
the pattern of why is the same both times: every instrument was aimed
elsewhere.

**The pop** ("when you collect the fuel it flies in your face so you can't
see"): the collect animation lifted the item toward the lens with a 1.55x
swell, and its own comment claimed the climb PREVENTED blinding. At the old
economy's density it was rare; at ~585 pickups it was near-permanent. The
rule had outlived its reason -- the fourth recorded instance of that
failure. Replaced with a collapse-and-sink: the item shrinks and drops out
of frame instead of crossing the eye line at maximum angular size. Shipped
in 825eb6a / 8f4d8c7, deployed as label sinking-pop.

**The lorry** ("when on top of of a vehicle, halfway across it the vehicle
disappears before jumping off"): the pool-release loop in world.js compared
the gate LINE against the reclaim threshold, `gate.z < z - BEHIND` with
BEHIND = 34 -- and a train is one gate carrying up to 60.1 units of vehicle
nose-anchored FORWARD of that line (2*halfZ*(1 + span*0.9), ROOF_SPAN_MAX
16). The deeper decks therefore had up to 26 units of ride past the point
where the pool had already reclaimed the mesh: the runner ran on the
invisible-but-solid course data until the dismount. Fixed by making a
train's release wait for its TAIL -- the vehicle's full depth, computed by
the claim site's own arithmetic, is added to the gate line before the
comparison. Non-train gates add nothing and keep their exact timing.

**Why the suite missed it, and the new instrument:** deckdrop imposes its
deck (resolveDeck stubbed, surface written directly -- "THE WORLD DOES NOT
KNOW"), so no gate ever asked whether the world keeps the vehicle itself
alive for as long as someone can stand on it. `tools/ridehold.js` now asks
exactly that: it freezes the game loop, hand-drives the real
world.update(z, lane) down the whole course in half-unit steps, and fails
if any train gate leaves liveCast() while z is within its deck. The first
draft of the probe waited for ?bot=1 to ride a ramp and collected zero deck
samples -- the same aiming defect deckdrop documents -- so the shipped tool
causes the observation instead of hoping for it.

**The instrument audited before it was believed, per the standing rule:**
against the pre-fix build ridehold reports 128 vanished-underfoot samples
of 796 -- the first at 34.1 units into a 53-unit deck, the BEHIND line to
the sample; the worst at 59.9 of 60.1 units, a lorry gone for its last 26
units of deck. Against the fixed build: 0 of 796, same 21 trains, same 796
samples. And the audit corrected this entry's own author once already: the
fix's first comment said "up to sixty units", was "corrected" to 42.5 from
RAMP_SPAN_MAX -- and ridehold's `deepest 60.1` showed the sixty was right,
because roof trains draw from ROOF_SPAN_MAX = 16, not RAMP_SPAN_MAX = 11. A
number nobody measured, again.

**Corrections list, continued:**
27. The release loop treated a nose-anchored 60-unit train as a plane at
    its gate line -- the same box-vs-plane error course.js's reachOf was
    written for, made independently on the render side. The two sides now
    agree: depth is charged everywhere a hazard is compared to a z.

## Roadmap 77 · MARATHON MILES: the name, the record as the stated target, the day that closes, and the pickups that go

Seven owner items in one pass, dispatched to two agents on separate file
sets. Both agents were killed mid-flight by a spend limit -- the second
while writing its own proof script -- so the implementations arrived
complete and entirely unverified, and everything below was measured after
the fact. That is recorded because it is the interesting part: the code was
fine and the proofs were missing, which is the failure mode this project
keeps rediscovering.

**The name.** DAILY MARATHON becomes MARATHON MILES. The owner's brief was
"it needs to include marathon" with the option of naming the character
something starting with M; Miles does both jobs at once -- it is a person's
name and it is the unit the game is counted in, so the wordmark states the
distance without spending a word on it. The runner is Miles, which the
locked panel now uses in the one place a character name earns its keep:
MILES IS DONE FOR TODAY.

**The target says what it is for.** The start panel's target line was a bare
1:59:30. It now reads BREAK THE MARATHON WORLD RECORD over that number.
Reworded in place rather than added as a row, because the owner had three
lines cut from this panel two passes ago and the fix for "it does not say
what this is" is not more text.

**The day closes when the record falls.** Retries were already unlimited and
stay that way; what is new is that breaking 1:59:30 ends the day. begin() is
the single door every start path funnels through -- the button, RUN IT
AGAIN, RESTART THIS RUN -- so the lockout holds one place. It keys off the
same dateKey that seeds the course, so the road and the lock roll over on
the same UTC midnight by construction rather than by agreement.

It is bypassed for ?nosave=, ?bot= and ?skip=. That is not a convenience:
nosave reads and writes nothing, and a bot that broke the record and then
locked the harness out of the course it was measuring would take the entire
gate suite with it on its best run.

**PAST DAYS.** Every finished city, newest first, with the days the record
fell marked, over a record streak, a days-finished count and a records-broken
count. The streak is walked back from the history rather than kept as a
counter, because a stored 5 whose last link is three days old is not a
streak of 5 -- and a missed day then breaks the chain by construction,
because a missed day has no row.

**The end card loses three rows** at the owner's word -- contacts cost, aid
taken, longest clean. Final time, the verdict, the fastest mile and the
biome-leg chapter line stay.

**The pickups.** Two reports one frame apart: "You kind of just run through
them now" and "Take the circle out from under the bottles and banana."
The mint pool-of-light discs are gone from both geometries -- same draw
call either way, since each item is one merged mesh, so the cut is pure
ground clutter removed. The pop is now the third version of that animation
and the history is the argument for its brevity: v1 climbed into the lens
and blinded the player, v2 collapsed and sank over 0.35s and still read as
running through the item, and v3 runs the whole thing in 0.09s starting
INSIDE the contact frame -- the first image after the touch is already
crushed to sixty percent, so the touch itself visibly takes the item.

**The instrument that had to be audited twice** (`tools/aidvanish.js`):
its first draft reported the fix BROKEN, and both reasons were its own.
It identified the item by matching whatever mesh stood near the right lane
and z, and read a steady 1.00 off a piece of scenery; and it owned the rAF
pump but not the clock, while the pop is timed off performance.now()
directly -- so it stepped 24 frames in a few real milliseconds and watched
an animation that had barely started. Both are fixed the same way: the file
that owns the state reports it (aidState() now carries scale, y and footY)
and the harness virtualises performance.now so the world and the animation
run on one clock. This is the seventh instrument in this project to have
flattered or maligned its subject, and the second to do it by inferring
which object it was looking at.

**The states nobody could have reached** (`tools/dailystate.js`): a
four-day streak takes four days, a broken chain takes a missed day, and the
lockout needs the record to actually fall -- which is the same thing as
saying nobody would ever have checked them. It writes the save directly and
reads back what the panels say. Five cases: a fresh save offers a run and
claims no streak; four consecutive record days count; the same four with a
hole two days back give a streak of 1, not 4 (the case a counter gets
wrong); the record falling today removes the button, shows RECORD BROKEN and
makes begin() refuse to change phase; and every harness door stays open
whatever the save holds. A corrupt save still renders a start panel.

**Gates on the shipped build:** build --check, shoot clean, playthrough end
to end, ridehold 0 of 1042 on-deck samples, dailystate 5/5, and
mechanics --identity bit-identical -- gate hash dc33748a, aid hash
6e39f138, both unmoved, which is the guard that says none of this reached
the course.

**Corrections list, continued:**
28. An instrument that infers WHICH OBJECT it is measuring will eventually
    measure the wrong one. aidvanish picked its subject by proximity and
    reported a working animation broken; the fix was to make the owning
    file report the state rather than let the tool guess at it.
29. A harness that takes the frame pump does not thereby own the clock.
    Any animation timed off performance.now() runs on wall time no matter
    how the frames are driven, so a stepped harness sees it frozen.

## Roadmap 79 · The share card, the head it travels with, the city checklist, and the blank page that is no longer blank

Numbered 79 and not 78 on purpose: another agent is landing in this
window and 78 is left for it.

Four owner items, dispatched to one agent on the UI file set. The course
generator was not touched at all, and that is the guard rather than the
claim -- `mechanics --identity` returns gate hash `dc33748a` and aid hash
`6e39f138`, both unmoved, measured against a tree carrying every file in
this pass. (Run in the shared working tree the hashes read `8f2937f2` /
`4781033d`, because a second agent has `src/core/course.js` open; the
identity run for this pass was therefore done against HEAD's course.js
with all of this pass's files copied over it, which is the only way to
attribute a hash in a tree several agents are writing to.)

**THE BLANK PAGE, first, because it was the only thing here that could
lose a player outright.** `src/main.js` created the WebGL renderer with no
try/catch, and there was no window error handler and no context-loss
listener anywhere in `src/`. Measured on the shipped build in Chromium
with WebGL disabled: **`document.body.innerText` was the empty string** and
the canvas sat at its 300x150 default. A visitor on a locked-down browser,
an enterprise-policy device or a low-memory Android got a dark rectangle
and no way to find out why. Three fixes, one family: the constructor is
caught (and a renderer that hands back no context is treated as a
refusal); a last-resort `error` / `unhandledrejection` listener covers any
other boot throw, gated on `MR.game.ready` so a working race is never
covered by an error card; and `webglcontextlost` calls preventDefault --
which is the whole mechanism, not politeness, because without it the
browser is under no obligation to ever restore -- stops the loop, and
pauses the race rather than abandoning it. Before the fix the loop went on
calling rAF and `renderer.render` against a dead context forever.

`tools/failstate.js` is the guard, and it can fail: pointed at a build
with the renderer guard and the error listener neutered (`MR_PAGE=`) it
reports the empty body verbatim. **It also corrected itself twice.** Its
first draft counted `requestAnimationFrame` callbacks and read 0 frames in
300ms on a page that was plainly running -- software-rasterised Chromium
renders this scene at about **0.9 FPS**, so the window was a fifth of one
frame -- and then read 2 frames after the loss, which looked like the loop
refusing to stop and was in fact hud.js scheduling layout callbacks
through the same wrapper. Both readings were flattering to the tool and
damning to the fix. It now counts `renderer.render`, which the whole game
calls from exactly one place, and it counts from the moment the handler
ran rather than from the call, because a frame already in flight is
scheduled and is not the loop refusing to stop. Result: 0 renders in the
3s after the handler, and the loop turns again after `restoreContext`.

**THE SHARE CARD.** The owner: *"Share artifact is important. work on that
and add that"* and *"no leaderboard is needed. individual game. share card
is more important"*. Those are one decision: the comparison happens
outside the game, and what the game owes it is a result that survives
being pasted. Four lines, the fourth only when it is true:

    MARATHON MILES · CAPE TOWN
    SUB-2:02 · 2:01:47 (+2:17)
    [six blocks]
    Day streak: 6

Six blocks, **one per biome leg** -- the same cut `chapterCosts` already
makes, so the tallies are a byproduct rather than new bookkeeping. Green
clean, yellow a contact the pool paid for, red a contact nothing paid for,
worst outcome wins the leg. It describes the RUN and never the road, which
is what keeps it spoiler-free, and `tools/sharecard.js` asserts that as a
property rather than by eye: no lane, no mile, no gate or obstacle
vocabulary, no leg name, no course count may appear in the string.

**One thing had to be added to make it possible**: `hitAt` records only
UNGUARDED contacts, correctly, because a counterfactual that erased a
guarded one would measure zero. The card is not a counterfactual, so
`main.js` now also records `guardAt` -- the same gate-z key, cleared by
the same reset, resolved in the same order in the live loop and the
fast-forward. The yellow block is the first thing in this game that ever
needed that fact.

The blocks on the card are **divs, and the emoji live only in the copied
text**: the embedded face is subset to what this HUD prints (mkfont.py:
digits, latin, twelve marks) and has no block glyph at all, so a rendered
square would have arrived from the system font at three different sizes on
three different phones.

**COPY RESULT**, four paths deep and it may never fail silently: the
native share sheet on `pointer: coarse` only (desktop Chrome has
`navigator.share` and opens a dialog nobody wants), then
`clipboard.writeText` inside the click gesture, then `execCommand` off an
off-screen textarea, then -- and this one cannot be taken away -- the text
shown, selected, with SELECT AND COPY under it. A cancelled share sheet is
answered with silence, not a fallback the player did not ask for.

Proved on the running page, not by building the string: `sharecard.js`
clicks the real button and **pastes the clipboard back out with a real key
press**, comparing what came back. The four literal strings it produced
are in the tool's own output.

**THE HEAD IT TRAVELS WITH.** A share string is wasted on a link that
renders as a bare URL, and the page carried a charset, a viewport, a
theme-color and a title and nothing else -- zero og:, twitter:, favicon,
manifest or apple-touch tags. Added to `tools/shell.html`: a description,
Open Graph and Twitter (`summary_large_image`, with the 1200x630 declared
because several scrapers lay out before the image lands), an inline SVG
favicon, an inline PNG apple-touch-icon drawn edge to edge (iOS masks its
own corners and renders a transparent PNG as a black square), and an
inline web app manifest.

**The manifest was checked rather than assumed**, through
`Page.getAppManifest` on the built page: Chrome does fetch and parse a
`data:` manifest, and the first version's `start_url` and `scope` both
came back *"URL is invalid"* -- relative URLs resolve against the
MANIFEST's URL and a data: URI has no directory. Both were removed;
Chrome then falls back to the document URL, which is what a single-file
game wants, and the manifest parses with zero errors.

**What the owner still has to do, and it is exactly one thing.** An
og:image cannot be a data URI -- the scraper behind Slack, iMessage,
WhatsApp and Twitter fetches it over HTTP from its own servers. So
`tools/ogimage.js` draws the card (1200x630, the game's own typeface, the
wager, and the six blocks) and the owner must host it and replace
`REPLACE-WITH-YOUR-DOMAIN` in the shell. The placeholder is deliberately
an unresolvable name rather than an invented domain: a scraper that cannot
fetch it falls back to the title and description, which is a correct
preview minus a picture, whereas a made-up domain will one day belong to
somebody else and the game would be advertising their image under its own
name. `sharecard.js` prints the outstanding handover on every run.

**THE CITY LIST.** The owner paused the map: *"lets put a pause on the
map. for now, its a list of all available cities and then shows where you
have completed the record."* It sits above PAST DAYS as a companion, not
a replacement, because the two answer different questions: the log is what
happened and can only ever show the days that did; the checklist is the
SET, so the cities not yet drawn are on the screen too, which is the only
way a checklist can be a thing to finish. Three states -- record fallen,
raced without it, not yet drawn -- told apart three ways (left rule,
opacity, typeset mark), because a colour alone collapses for anyone who
cannot see it and an opacity alone reads as a rendering fault.

Derived from `MR.Course.SETTINGS`, never a copy: the count is
`SETTINGS.length` and the order is the table's, so a thirteenth city
appears the day it is added. `store.js` grows one derived field --
`summary().cities`, walked off the history on every read rather than
stored, because a stored copy is a second source of truth that can
disagree with the log, which is the exact defect the record streak was
rewritten to avoid. The grid auto-fills from a 118px minimum: two columns
in the 284px a 320px panel actually has, three at 390, four on a desktop,
with no breakpoint and no column count to revisit.

**Gates on this build:** build, shoot 8/8 clean, playthrough end to end
(1:59:44, 0 hits, 4 guards), dailystate 5/5, failstate 12/12 (and failing
correctly against a neutered build), sharecard 40 checks including the
clipboard paste-back, and `mechanics --identity` bit-identical as above.
Frames in `shots/`: `share-clean`, `share-guarded`, `share-hit`,
`share-record`, `share-copied`, `share-lastresort`, `share-320`,
`share-land`, `cities-some`, `cities-all`, `cities-320`, `cities-land`,
`fail-nowebgl`, `fail-contextlost`, `fail-contextback`, and the hostable
`share-og-1200x630`.

**Two decisions the owner may want to reverse, stated rather than buried:**
- **No date on the share string.** The agreed design has four lines and no
  date, and the city plus the day it is posted identify the course. A
  `2026-08-31` on line one would make a pasted result verifiable weeks
  later, at twelve characters.
- **A history city that is not in the pool is not on the checklist.** If a
  city is ever renamed or retired, a record on it keeps its row in PAST
  DAYS and drops out of the count. The alternative -- appending strays to
  the grid -- makes "4 OF 12" mean two different things.

**Corrections list, continued:**
30. A harness that samples a fixed time window is measuring its own guess
    at the frame rate. failstate read "0 frames in 300ms" off a running
    loop at 0.9 FPS. Wait for a CONDITION, and count something the code
    under test calls from exactly one place.
31. Counting an event from the moment you REQUEST it charges the fix for
    work already scheduled. The loop-stop assertion counts from the
    moment the handler ran, and only then is zero the honest answer.

## Roadmap 80 · The swipe finally gets tested, and it was fine all along

The most-executed piece of player-facing code in this game was the one path
no instrument touched. `src/game/controls.js` holds the real
touchstart/touchmove/touchend listeners, but every tool in the suite --
shoot, course-test, simulate, playthrough, ridehold, dailystate, aidvanish
-- drives the game through `?bot=`, which writes straight into the internal
action queue and never dispatches a DOM event at all. A CSS change, a
viewport quirk, a touch-action or passive-listener conflict could have
broken input entirely on a real phone and every gate would still have
printed green.

That is the same shape as the defect that shipped in roadmap 76: two bugs
found only by the owner playing on a phone, "neither by the gate suite --
every instrument was aimed elsewhere". This entry closes the gap before a
public launch turns a rare failure into a common one.

`tools/touchinput.js` drives the real page with a touch-enabled context and
dispatches genuine touch events, then asserts the game did what the gesture
asked. 29 checks: lane changes left and right from every lane, a swipe into
the wall from an edge lane, jump and duck, both diagonals resolving to the
dominant axis without firing two actions, a swipe under SWIPE_MIN (25px
against the real 26px, read from the page rather than assumed), a swipe held
past SWIPE_MAX_TIME, a tap with no move, the same gestures at 320x568,
430x926 and landscape, the start panel correctly swallowing a swipe that
must not reach the canvas, `touch-action` resolving to `none` on the body and
`pan-y pinch-zoom` on the panel, and the keyboard path that shares the action
queue.

**The result is clean, and that is a real result rather than a shrug**
because the tool was proved able to fail first. `--selftest` dispatches a
10px swipe -- comfortably under the 26px threshold -- and asserts, wrongly
and on purpose, that it changed lane. The checker reports FAIL, as it must.
A test that has never failed has not been tested; this project has shipped
six defects in one instrument that every one of them flattered, and had a
tool call a working fix broken twice in a single day.

**What it does not prove, stated in its own header:** a synthetic touch
event is not a finger, and it cannot catch a defect living in a specific
real device's own gesture handling. It also needed a retry on one diagonal
case (attempt 2 of 3), which is timing sensitivity in the harness rather
than in the game, and is worth watching if that case ever starts costing
more attempts.

**Process note, recorded because it cost real budget:** the agent that wrote
this tool stalled four separate times waiting for a completion notification
for its own backgrounded run, burning over 100 tool calls without
converging. The runs themselves had finished; nothing was going to wake it.
Long verification runs belong in the FOREGROUND with a timeout, where the
result lands in the same turn. The tool it wrote is good; the way it waited
was not.

### 80a · The drain fix that made the instrument worse, reverted

The touchinput tool passed 29 of 29 but needed a second attempt on one
diagonal case, so its author proposed a stronger drain: after confirming the
touchend had been observed, also hold for `K.INPUT_BUFFER + 0.2` of GAME
time, so any action controls.js was still buffering had either been served or
aged out before the next gesture.

The reasoning is sound and the result was worse: **27 ok, 4 FAIL** -- up
swipe to jump, down swipe to duck, the dy-dominant diagonal, and a bare tap
that came back showing lane 0. Four hard failures against one soft retry.

The defect is the oldest one in this document wearing new clothes: the
instrument waits past the window in which the thing it measures exists.
`airborne` and `ducking` are TRANSIENT -- the runner jumps and lands, ducks
and stands -- so a drain that deliberately holds until the input buffer has
aged out is holding until the jump is over, and then reports that no jump
happened. The tap failure is the same clock running the other way: the extra
hold let a straggler from the previous gesture land inside the tap's own
observation window.

Reverted to the committed version, which passes 29 of 29 with retries and
whose --selftest still proves it can fail. The retry on the diagonal is real
mild flakiness in the harness, not in the game, and it is recorded here
rather than fixed, because the fix that was tried costs four true negatives
to buy one flake and the honest trade is to keep the flake.

The general rule, since this is now the third instrument in two days to be
wrong about time: **a tool that waits for a stable state cannot measure a
transient one.** If the drain is attempted again, it must sample the state at
the moment the action resolves and assert on the sample, not on the world
after the wait.

The other cost, measured: the drained version took over 20 minutes against
roughly 5 for the committed one, because it waits on a game clock that
advances at the headless renderer's own 0.9 frames a second.

## Roadmap 78 · The knowledge premium is one constant: what a first attempt actually cannot know, and the day lottery found on the way

**Entry 78. Other agents are taking 79 and 80.**

The owner, on roadmap 74's headline:

> *"The record is concerning especially this line 6.7% first attempt, 40% once
> learned - it is really hard to learn the map. I'd argue you really dont, its
> skill and focus that gets you to the end. you need to be able to do it
> multiple ways"*

He is right, and the measurement says so more strongly than he put it.

### 1. The instrument, and why a new one was needed

`tools/simulate.js` cannot answer this question. Its two columns are separated
by a POLICY FLAG -- a policy is declared `learned: true` and then handed three
discounts -- so "what does knowing the course buy" is answered by the same
table that was written to assert it. Roadmap 74 says as much in its own words:
the learned axis "had to be BUILT, out of chains".

`tools/sightread.js` races ONE line under TWO PERCEPTIONS and subtracts.
Identical skill, identical seed, identical cost model, identical dice; the only
difference is how much road the chooser may read:

- **SIGHT** sees to a horizon and structurally cannot ask past it. Every
  request is routed through a view object that CLIPS to the horizon and counts
  the cut; nothing else can reach the course table.
- **ORACLE** sees the whole course.

It plans rather than grabs -- a receding-horizon DP over the visible gates,
carrying the chain state, so lookahead gets its best shot rather than a greedy
straw man.

**The audit runs first and it is five checks, not an assertion.** SIGHT is cut
off at its horizon 177 times a race and ORACLE zero times (if SIGHT were never
cut off, the horizon would not be a horizon). A BLIND runner is 15 s behind a
sighted one; an infinite-sight runner is never slower than a 210-unit one; the
same config raced twice differs by 0.0e0 s; and configured as `simulate.js`'s
own first-attempt perception it lands within 4 s of that tool's READ ROAD row,
which is the cross-check that says the two instruments are looking at the same
game.

**What it does not capture, said plainly.** It has no hands, no reaction time
and no panic; `skill` is one number standing in for all of that, exactly as in
`simulate.js`. It does not ride ramps. It assumes a lane change is free. None
of that biases the SUBTRACTION, which is the only number this file is for.

### 2. THE KNOWLEDGE PREMIUM IS ZERO, AND WHAT IS LEFT IS A CONSTANT

Over 16 dates x 10 seeds, before any change:

| perception | perfect | 0.995 | 0.99 | 0.98 |
|---|---|---|---|---|
| ORACLE | 1:59:16 | 1:59:21 | 1:59:24 | 1:59:37 |
| SIGHT (210u, chain tax, trail head) | 1:59:27 | 1:59:32 | 1:59:38 | 1:59:52 |
| SIGHT with the chain tax removed | 1:59:16 | 1:59:24 | 1:59:27 | 1:59:41 |
| SIGHT with infinite sight | 1:59:28 | 1:59:33 | 1:59:40 | 2:00:07 |

Decomposed at perfect execution, the 11.1 s premium is **chain tax 11.1 s,
trail head 4.6 s, horizon -0.6 s** (the terms overlap, so they do not sum).

**Seeing the whole course, rather than the 210 units the game draws, is worth
minus six tenths of a second.** That is the finding. Course knowledge has
nowhere to live, and the reason is structural rather than a shortcoming of the
search: a lane change is free, every mat covers a gate line, and pickups lie
between gates -- so the cost of the stretch from gate *i* to gate *i+1* depends
only on the lane chosen AT gate *i*, and the whole problem separates. Roadmap
73 found this and called it "the structural cap on what course knowledge can be
worth here"; roadmap 74 then priced the learned column anyway, out of a
constant.

That constant is `SWEEP_CHAIN_SIGHT = 0.979` in `tools/simulate.js`: a demand
arriving within `CHAIN_NEAR` of the previous one is cleared at `skill x 0.979`
on a first attempt and at `skill` once the day is learned. It is the entire
premium. Remove it and an ORACLE that has memorised the course finishes
**0.0 seconds** ahead of a stranger reading the road, at perfect execution.

### 3. Two defects in the sight model, reported and NOT fixed here

Rule 3 says the instrument gets the same scrutiny as the work, so both are
written down with their numbers.

**`READ_NEAR` is a reaction budget being used as a visibility limit.** It is
`ACTION_WINDOW + CAM_BASE_BACK` = 25.35 units: the distance inside which a
hazard must be DECIDED. `MR.World` spawns geometry at `VIEW` = 210 units and
`MR.shading.FOG_FAR` is 215, so a player looking down the road sees about six
gates. Measured over three dates, **0 of 553 gate gaps fit inside `READ_NEAR`**
(median 31.1 units). The sweep therefore charges a first-attempt player for not
seeing road that is drawn on their screen.

**`CHAIN_NEAR` is wider than the road's own spacing.** It is `1.5 x READ_NEAR`
= 38.0 units against a median gate gap of 31.1, and **446 of 553 consecutive
gate pairs (81%) fall inside it**. A "chain" is not a structure on this road, it
is the ordinary road. Applying a sight-reading discount to 78 of ~110 demanded
gates a race is not modelling a rare back-to-back demand; it is a blanket skill
penalty on strangers wearing a structural name, and it is circular: it defines
the first-attempt player as worse and then reports that they are worse.

**Neither was changed in this pass**, and that is a deliberate call rather than
an oversight. `simulate.js` is the shipped difficulty gate; changing the
instrument and the game in the same pass makes the before/after
uninterpretable, and retuning the instrument until the number improves is the
exact failure rule 3 exists to prevent. What was done instead is to change the
GAME so that the informed stranger's line meets fewer chains -- the tax is
unchanged, the road it is levied on is not.

### 4. Route diversity was already plural. The premise's second half is wrong.

*"you need to be able to do it multiple ways"* -- measured two ways, before any
change:

- **Gate freedom.** Force each lane at each gate, play the sight-read optimum
  everywhere else, ask whether the run still beats 1:59:30. **853 of 1107 gates
  (77%)** had more than one record-viable lane.
- **Route clusters.** Sample 60 plausible lines a day (the per-gate cost with a
  random surcharge of up to 2.5 race seconds, which is the size of the
  decisions being made), keep the winners, and count lines that disagree at a
  quarter of the gates or more. **14.5 distinct routes a day.**

There is no dominant optimal route to be discovered. The honest caveat, which
is why this is not simply good news: much of that freedom is INDIFFERENCE
rather than choice -- most gates carry no mat and no coins, so the lanes are
equivalent and any of them wins. The player is free; the freedom is not always
a decision.

And the metric had a hole in it that turned out to be the real story. On
2026-08-08 the count was **7 of 186 and zero winning samples** -- not because
that day had one route, but because it had none.

### 5. THE DAY LOTTERY, which was not in the brief and mattered more than either

The ORACLE at perfect execution is the fastest line the game can produce on a
date: no dice, no misses, full knowledge. Its spread across dates is exactly
how much the CALENDAR decides. Over 90 dates, before:

- best possible finish **1:58:58 .. 1:59:37**, sd **7.1 s**
- forward mats a course **9 .. 30**, sd **3.53**
- correlation of the two: **-0.89**
- **3 of 90 dates that NO line can win** (2026-09-08, 2026-09-28, 2026-10-01)

Forward paint is the only route currency in this game -- a lift is worth
`TEMPO.LIFT` over its length and there is nothing else on the road a line can
choose to gain seconds from -- and its supply was a coin flipped once per mark:
`dir: rnd.chance(TEMPO_DRAG_SHARE) ? -1 : 1`, about 44 times a course, i.e.
Binomial(44, 0.43), mean 18.8 and sd 3.3. The observed sd was 3.53. It is the
binomial, exactly.

So a third of the difference between an easy day and an impossible one was a
coin. And the day closes when the record falls (roadmap 77), so three days in
ninety could not be closed by anyone, for no reason at all.

### 6. What changed

**`planTempo`: the direction is stratified, not flipped** (`src/core/course.js`).
Marks are packed as before; then the non-mandated ones are shuffled from the
same seeded stream and exactly `round(n x TEMPO_DRAG_SHARE)` of them are made
backward. Same share, same seeded shuffle deciding WHICH, same mandated forward
first mark. The stream is bumped `tempo/v1 -> tempo/v2` because the draw pattern
changed, per the standing convention.

**`makeGate` gains `noFull`, and the call site caps the run of forced gates**
(`FORCED_RUN_MAX = 3`). A gate with no CLEAR lane forces an action; every lane
is answerable, but none can be declined. Before this rule, 57% of gates were
forced and they arrived in runs of up to **twenty-four** -- roughly 750 units,
half a minute of race, with no route decision of any kind. That is the one
structure on this road where "do it multiple ways" is simply false, and it is
also where the sight-reading tax does nearly all of its work, because a run of
forced gates is a chain that never ends. The `chance()` draw is still taken when
`noFull` is set, so the stream walks at the same rate.

The cap was swept over 40 dates:

| cap | forced gates | hazards | longest run | runs over 5 |
|---|---|---|---|---|
| none | 105.7 (57%) | 466 | 24 | 4.7 / course |
| 2 | 83.9 (46%) | 439 | 5 | 0 |
| **3** | **91.8 (50%)** | **447** | **5** | **0** |
| 4 | 96.3 (52%) | 453 | 7 | 0.3 |
| 5 | 99.0 (54%) | 457 | 7 | 0.5 |

Runs still reach five past a cap of three because a carried train or a narrow
closure shuts a lane AFTER `makeGate` has rolled it. The rule bounds what the
generator ASKS for; the course may still hand out a little more, and that is the
honest statement of it.

**`FLOOR_BASE` 259.1 -> 259.0** (`src/core/pace.js`), and it is a refund rather
than a retune. The cap takes 4% of the hazards off the road and widens the
spacing a fraction, and a course with fewer gates is a SLOWER course, because
pace follows a streak that counts cleared gates. The first-attempt column fell
to 1 of 30 at an unchanged floor -- below the band the owner set, for a reason
that has nothing to do with difficulty. Swept at 259.1 / 259.05 / 259.0 /
258.95 / 258.9 / 258.7 / 258.5 through the whole grid; the column is steep
(258.9 gives 10% and 258.7 gives 20%), so 259.0 is a notch and not a range.

### 7. What moved

**The day lottery, one instrument, both trees, 90 dates:**

| | before | after |
|---|---|---|
| best possible finish | 1:58:58 .. 1:59:37, sd 7.1 s | **1:59:06 .. 1:59:24, sd 4.3 s** |
| forward mats a course | 9 .. 30, sd 3.53 | **15 .. 21, sd 1.11** |
| correlation with forward paint | -0.89 | **-0.59** |
| dates NO line can win | **3 of 90** | **0 of 90** |

**Route diversity** (6 dates, the same measurements as section 4): gate freedom
**77% -> 91%**, sampled lines beating the record **24% -> 32%**, distinct routes
a day **14.5 -> 19.3**.

**The premium** (`tools/sightread.js`, 16 dates x 10 seeds, worst standard error
5.9 s): total at perfect **11.1 s -> 9.0 s**, still made almost entirely of the
chain tax (11.1 -> 9.0), with the horizon term still **-0.6 s -> -0.7 s**: zero,
before and after. In `simulate.js`'s own currency, the gap between the best
first-attempt line and the best learned line at perfect execution went from
**15 s to 6 s** (READ ROAD 1:59:29 vs PLAN AID 1:59:14, to READ ROAD 1:59:23 vs
PLAN AID 1:59:17), and the chained demands the informed stranger's line meets
went **78.3 -> 60.6 a race**.

**And the number that answers the owner's question directly: how often does a
sight-reading line actually get under 1:59:30.** Not the cell mean -- the
fraction of INDIVIDUAL RACES under the record, which is what a record is won
by (20 dates x 8 seeds, the same racer either side):

| skill | before | after |
|---|---|---|
| perfect | 85% | **93%** |
| 0.995 | 65% | **78%** |
| 0.99 | 60% | **71%** |
| 0.98 | 47% | **59%** |

The mean at 0.995 is 1:59:34, over the record, while 78% of the races behind
it are under it. That gap between the mean and the fraction is the whole
reason section 9 says this document has been reading the wrong statistic.

**The bar is exactly where roadmap 74 left it**, which is the point -- the axis
moved, the level did not:

| | before | after |
|---|---|---|
| beats 1:59:30, all cells | 8/45 (18%) | 8/45 (18%) |
| ...on a FIRST attempt | 2/30 (6.7%) | **2/30 (6.7%)** |
| ...with the course learned | 6/15 (40%) | 6/15 (40%) |
| policy spread at perfect | 33.2 s | 30.0 s |

**Identity, re-baselined deliberately and stated in both places:** gates
`dc33748a -> 8f2937f2`, aid `6e39f138 -> 4781033d`. The gate hash moved because
both generation changes are real; the aid hash followed because aid hangs off
the gate table and `generateAid` is untouched (still v5, same rule, same
stream). `tools/aid.js` proves the economy on the new course: a seeking line
collects 14.4 segments, inside the 8-20 band.

### 8. Where this pass, and the brief, were wrong

**The brief asked for the knowledge premium to be reduced and it is not
reducible, because it does not exist.** The premium is a modelling constant, and
the only thing the GAME can do about it is give it less road to be levied on --
which is what `FORCED_RUN_MAX` does, and it is worth a quarter of the tax, not
all of it. Saying the learned column fell would be false: it is 6 of 15 before
and after. What fell is the seconds between the best line of each kind, 15 to 6.

**The brief asked for several distinct routes and there already were.** 77% gate
freedom and 14.5 route clusters a day is not "one dominant optimal route". The
finding that justified the biggest change was the one nobody asked for: on 3
days in 90 there were no routes at all.

**Stratifying the mat direction was expected to fix the day lottery on its own
and it did not.** Measured alone it took the per-date spread of the SIGHT line
from 92 s to 60 s, which read as a poor result -- until the per-date measurement
was re-cut on the ORACLE, which has no dice at perfect skill. The SIGHT line at
"perfect" still misses 2.1% of its chained demands, so its per-date spread was
mostly Poisson noise, not the date. **A measurement of how much the calendar
decides must be taken with a runner who cannot miss**, and the first version of
it was not.

**Lowering the full-width table was tried first and refused by the measurement.**
Dropping `full` to 0.14/0.30/0.44/0.56 cut chains from 76 to 49, but it also cut
demanded gates from 146 to 132 and made every sub-perfect skill FASTER -- it
flattens the execution gradient, which is the opposite of what the owner asked
for. Difficulty on this road comes from forced actions; what is wrong with them
is how many arrive in a row, not how many there are. `FORCED_RUN_MAX` keeps 87%
of them and deletes the whole tail.

**A dead helper shipped in the first draft of `sightread.js`** -- a `laneCost`
that computed nothing and returned 0, superseded by `laneCostFor` while the file
was being written. It was never called, and it was removed rather than left; it
is recorded because a function that returns a plausible zero is exactly the kind
of thing that gets called later by accident.

### 9. Still open

**Can a focused player win on sight? Yes, and the qualifier is the instrument's,
not the game's.** With the chain constant applied, the sight-reading line beats
1:59:30 on the mean at perfect execution and loses at 0.995. With it removed --
which the measurement above says is the honest model -- the same line wins at
perfect, 0.995 and 0.99. The thing standing between a focused sight-reader and
the record is a 2.1% modelling penalty applied to 61 gates a race, and whoever
takes 79 or 80 should decide whether that penalty is a claim about humans worth
keeping. If it is kept, it should at least be levied on demands that are
genuinely tighter than the road's own spacing, rather than on 81% of gate pairs.

**Means are the wrong statistic for a record chase and this document has been
using them.** `simulate.js` reports cell means with a worst standard error of
7.2 s against cells 2-5 s apart, so 1/30 against 2/30 is close to a coin. The
per-run win FRACTION is the better number and `sightread.js` prints it: at 0.995
the sight-reading line's mean is over the record while 78% of its individual
runs are under it. A record is won by a run, not by an average.

**Indifference is not choice.** 91% gate freedom counts gates where more than
one lane wins, and most of those are gates where the lanes are identical. A
measure of how many gates hold a real DECISION -- two lanes within a second of
each other, differing in what they demand or pay -- would be a better number
and does not exist yet.

### 10. The gate, and the corrections list

`node tools/build.js && node tools/shoot.js && node tools/course-test.js &&
node tools/simulate.js` all green, plus `course-test 365`, `playthrough`,
`tempo`, `ridehold`, `calendar` (32 days clean), `aid`, `footroom` (96/96),
`deckdrop` (24/24), `mechanics` and `mechanics --identity`, and
`sightread --audit`.

**Corrections list, continued:**

30. **A difficulty split produced by a policy flag is not a measurement of
    difficulty**, and quoting it as one has now misled this project for three
    entries. If two columns differ because a flag says they do, the number
    between them is a design intention, not a finding. Say which it is at the
    site.
31. **Per-date spread was never measured, only per-policy averages**, and it
    hid three unwinnable days in every ninety. An average over dates cannot
    see a date that is impossible; only a per-date minimum can.
32. **A reaction budget is not a visibility limit.** `READ_NEAR` was used as
    both in the sweep's sight model, and the two differ by a factor of eight
    on this road.

## Roadmap 81 · Energy: the pickups stop being insurance and start being the race

The owner, after missing by a second: *"I think the energy is what you need to
run the top speed as it decreases your speed does slightly. so it forces you
to grab as much as possible. maybe once it is below half way you start slowing
down a tad. start the game with full."*

**The defect it fixes was already measured and had been sitting there.** Aid
was INSURANCE, and insurance is worth nothing to a player who does not crash:
`playthrough` recorded a clean run collecting 335 pickups and pouring 141 of
them -- thirty percent -- into a pool that was already full. A third of the
road's content was inert for exactly the players the abundance pass was built
to engage. Roadmap 77 named this and did not fix it.

**The shape.** Energy starts full, drains on race seconds whether you crash or
not, refills from every pickup, and above the knee (half a tank) levies
nothing at all. Below the knee it adds up to ENERGY_MAX_PENALTY seconds a mile
at empty, linearly. A contact costs a bite of it -- the owner's call, asked
and answered: one bar does everything, so the meter that says how fast you can
run is the same meter a crash takes from.

Nothing above the knee is taxed, and that is what kept this from reopening
every difficulty number the project has settled: a well-fuelled runner races
the pace curve that shipped, unmodified.

**Tuned against a stated acceptance criterion, not against taste.** The owner:
*"if you collect everything and do not hit anything you should beat the record
by more than 4 seconds. there needs to be slight room for error."*

| | before | after |
|---|---|---|
| HARVEST (collect all), perfect | 1:59:14 | **1:59:11 -- 19 s under** |
| HARVEST, at 0.960 execution | -- | **1:59:29, still wins** |
| real page, clean bot run | 1:59:36 (+6) | **1:59:21 (-8)** |
| first-attempt cells | 2/30 (7%) | 1/30 (3%) |
| all cells | 8/45 (18%) | 8/45 (18%) |
| spread across policies | 30.0 s | **62.6 s** |
| policy order | flat-ish | HARVEST > COIN CHASE > PLAN AID > NO AID |

The spread doubling is the point: collection now decides the race. HARVEST is
the best line at every skill level, NO AID is near the bottom, and the gap
between them is a minute.

**Four dials, and the first three were wrong twice before they were right.**
The first draft (drain 2400 s, 0.01 a pickup, 14 s/mi) took first-attempt wins
to 0 of 30 and blew the policy spread to 251 s. Softening the penalty did not
recover it, and the reason turned out to be a number nobody had looked up: a
course carries 554 aid items and a realistic line takes 321 of them, a 58 per
cent take rate, not the 100 per cent the tuning had assumed. Setting the
break-even at the take rate a real line achieves put the clean playthrough
back on its pre-energy time to the second, and the field was then restored
with the project's own established dial, FLOOR_BASE 259.0 -> 258.3, at the
measured 20.7 s of finish per s/mi.

**The gauge changes meaning, so it changes colour.** It counted guard segments
and therefore only mattered to a player about to crash. It is energy now,
turns to the behind colour below the knee, and the track carries a notch at
half so the line exists before you cross it -- a bar that only shrinks cannot
say where the trouble starts.

**And a toast had to be retired.** ENERGY FULL / WASTED fired whenever the
guard pool was full. Since a pickup taken on a full pool still fills the tank,
that message became a lie -- and the kind that teaches a player to stop
collecting. It now fires only when both are full, which is rare and true.

**Gates:** shoot clean, course-test 90 deterministic and solvable, playthrough
end to end on the real page, mechanics --identity unmoved (this is all
pace-side; no course stream is touched), dailystate 5/5, tempo PASS.

**Corrections list, continued:**
32. Tuning against an assumed collection rate. Three rounds of dials were
    turned before anyone asked how many pickups a line actually takes; the
    answer, 321 of 554, made the first two rounds meaningless. Look up the
    denominator before turning the dial.
