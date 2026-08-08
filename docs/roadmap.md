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
- **Variant repetition is DUCK and JUMP, not the fleet.** Across 8 dates and
  3,612 hazards, 64.8% of visible windows contain a repeat -- but per hazard
  seen, a DUCK produces **3x** the repetition of a BLOCK. BLOCK has ten
  variants, DUCK three, JUMP four. The premise that vehicles were the
  repetitive thing is backwards. **OPEN**
- **Per-variant hazard depth**, rejected for now rather than refused: right in
  principle and cheap on the course side (`variantIndex` is a pure hash), but
  a box shorter than its art makes `BLANKS` under-count and pass a gate the art
  really hides. Needs box and art changed together. **OPEN**

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
