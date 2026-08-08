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
