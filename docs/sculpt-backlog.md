# The sculpt backlog

BLOCK is now 14 of 14 sculpted (crossing and tram closed 2026-09-03).

The fleet ledger: what wears a Tripo sculpt, what is waiting on one, and
what was refused with a measurement. The owner (2026-09-02): "Add those
you skipped to the list of next to dos. Outside of the ones that need
fixing all things to swipe left right should be built. I'll move to the
jump and slide ones next."

How a model gets in: one generation per obstacle in Tripo, GLB per
model, uploaded to a GitHub release (props-v2, props-v3, ...). The
shrink pipeline takes it from ~57 MB to ~10k triangles and 400-650 KB;
world.js scales it onto the def geometry's exact bounding box, so
MR.Collision.BOX and every fairness instrument keep describing what the
player sees. Every sculpt must clear the contrast gate (CLAUDE.md rule
4) in all eight city shots before it ships -- three of the refusals
below are that gate doing its job, and the fix is a different texture,
not a smaller standard.

## BLOCK (swipe left/right) -- 14 of 14 sculpted

| v  | obstacle    | status                                             |
|----|-------------|----------------------------------------------------|
| 0  | tram        | shipped (props-v2 sculpt + brightening coat, 2026-09-03; pantograph cut offline 2026-09-03 so the body takes the full 2.80 -- the wire frame was 35% of the scan's height and the fit had parked the roof at 64% of the envelope). The old refusal was measured before the lighting-seam fix moved every sculpt's rendered ceiling; re-measured per rule 3, a hue-swung brightening coat reaches L 150 / S 0.24, +0.256 clear -- the same brighter-than-road route the code tram used. The carriage rake runs on every non-rideable train. A vivid red/yellow regeneration is still welcome and would replace the coat. |
| 1  | signworks   | shipped (props-v2)                                 |
| 2  | lightworks  | shipped (props-v2)                                 |
| 3  | crossing    | shipped (props-v4 construction.workers regeneration, 2026-09-03) -- the full assembly the refusal asked for: two marshals, barrier boards, raised STOP paddle, cones, 1.15x as wide as tall. |
| 4  | bus         | shipped (props-v3, red double-decker, +1.7 lightness coat) |
| 5  | taxi        | shipped (props-v2)                                 |
| 6  | van         | shipped (props-v2)                                 |
| 7  | refusetruck | shipped (props-v2)                                 |
| 8  | crateload   | shipped (props-v3, brightened + saturated coat)    |
| 9  | moped       | shipped (props-v3 scooter + rider, green coat)     |
| 10 | container   | shipped (props-v4 orange regeneration)             |
| 11 | dumpster    | shipped (props-v3)                                 |
| 12 | hatchback   | shipped (props-v3 blue car; ships in orange, gold, green, magenta -- blue itself is under the gate) |
| 13 | police      | shipped (props-v4 battenburg regeneration, +1.18 lightness coat) |

## JUMP (leap over) -- 12 of 12 SCULPTED (props-v4)

Low objects; the sculpt's silhouette matters at knee height. Best Tripo
inputs marked: (photo) = screenshot a real-world photo, (card) = use
the obstacle card rendered from the game (no real-world equivalent).

All twelve shipped. Eight took measured corrective coats (margins at
the dress lines); the e-scooter arrived standing and takes a quarter
roll to lie down; the pipe stack sits at a 29k-triangle fragment floor
and is the first candidate to regenerate if the triangle budget ever
tightens (heaviest frame is 460k of the 500k ceiling).

## DUCK (slide under) -- 5 of 11 sculpted (props-v4)

Overhead spans; the slide-under gap comes from MR.Collision.BOX, never
from the art, so the sculpt is fitted with its underside on the box
line. Wide, span-like generations work; tall or floor-standing ones
will not fit the frame.

| v  | obstacle   | status |
|----|------------|-------|
| 0  | gantry     | shipped |
| 1  | scaffold   | shipped |
| 2  | sign       | TO DO -- the props-v4 sculpt is only the hanging-sign assembly (a third as tall as it is wide, no posts to the ground); the bar-aware fit can only stretch it four-fold, which mangles it. Regenerate FULL-HEIGHT: a roadwork sign gantry with legs. |
| 3  | boom       | shipped |
| 4  | pipe       | shipped |
| 5  | walkway    | shipped |
| 6  | floodlight | TO DO -- not yet generated (photo or card) |
| 7  | bridge     | TO DO -- not yet generated (card) |
| 8  | awning     | TO DO -- not yet generated (photo) |
| 9  | shopsign   | TO DO -- not yet generated (photo or card) |
| 10 | walkboard  | TO DO -- not yet generated (card) |

The DUCK vertical fit is bar-aware: the sculpt's overhead underside is
measured and pinned to MR.Collision.BOX[DUCK].yMin, so the visual gap
is the collision gap. Generate DUCK models full-height, posts to the
ground, like the gantry.

## JUMP v12, the crossing minicar (added 2026-09-03)

Code art, ships without a sculpt (weight 0 -- only the jcross cast
site deals it, so it always arrives crossing). A Tripo generation is
welcome when credits return: ONE small rounded city car, single view,
side profile, bright red body with a cream roof; it will be fitted
side-on into the JUMP box (0.78 tall), so a low, wide, simple shape
survives the shrink best.

## Also waiting

- Grandstand/arena crowds are still box people by design (the roadside
  knots wear the props-v1 sculpts).
- The sculpted Miles has a painted face; a facial rig (blink/gaze/brow)
  is a separate effort.

## New obstacles, and motion (recorded 2026-09-02, to revisit)

NEW VARIANTS are cheap by construction: a def entry plus a bag weight,
zero extra draw calls, sculpt dress line optional. Constraints are
readability, not tech -- a JUMP stays under 0.8, a DUCK hangs its mass
at the bar, a BLOCK fills the lane, and every addition re-runs the
gates. The identity test stands: would a person name it in one second?
Candidates discussed: food truck, horse trailer, cement mixer (BLOCK);
tipped shopping cart, hay bales, luggage pile (JUMP); banner span,
tree branch, cherry-picker arm (DUCK).

MOVING OBSTACLES are two different asks. Motion that never moves the
kill box (animated parts, figures pacing inside their own envelope) is
available today -- the one-moving-part rule per variant could be
loosened deliberately. Motion that MOVES the kill box -- across lanes
or along the road -- is a real project: time-dependent collision, a
telegraph that shows where the hazard WILL be, a solver that models
timing, and new instruments to prove fairness.

THE LANE-SWEEPER IS BUILT (2026-09-02, owner: "I think the game needs
to be harder so if the motion is possible I say lets do it"). It ships
WITHOUT moving the kill box, which is what made it a day's work instead
of the project above: the kill lane is ordinary course data and only
the APPROACH animates -- the vehicle parks in an adjacent clear lane
and drives into its own lane, locked there from twice READ_NEAR out.
See markSweeps in course.js for the fairness argument and the
eligibility census; ~3 a course past mile 6, always wearing a vehicle
sculpt (bus, taxi, van, refuse truck, moped, hatchback, police).
Tightened 2026-09-03 on the owner's "more moving obstacles... closer
to the runner": SWEEP_RATE 0.60, SWEEP_LOCK 1.5x READ_NEAR, SWEEP_START
3x, opening f 0.15 (~mile 3.9) -- about 5.4 sweeps a course. The floor
on the lock is 1x READ_NEAR, where the crossing resolves exactly at the
commit point; the remaining headroom is the last difficulty notch.
The van and the hatchback gained the idle engine shudder in the same
pass (in-envelope motion only).
Oncoming traffic ranks second; it strains the closed-course fiction,
and anything that genuinely moves the kill box is still the full
project with new instruments.

## The rideable ramp trucks (recorded 2026-09-03)

The owner generated a blue cargo truck pair for the rideable decks
(props-v3). The CLOSED one ships as BLOCK v14, four liveries. The RAMP
one as generated could not serve (cab below deck height in the
dismount path; 6.7-9.4x span stretch), so the deck SHIPPED ANOTHER WAY
(2026-09-03, owner: "I think we need the rideable one"): the cab is
cut off the cargo-truck sculpt offline and the cast site lays a rake
of flat-roofed trailers over the deck behind the code ramp mouth --
see roadmap 95. The mouth/ramp stay code art by design. A dedicated
open-mouth trailer generation (cabless, flat roof, single-view input)
would let the mouth go sculpted too; welcome but no longer blocking.

Tripo note for all future generations: feed ONE view of the object.
A multi-view input image comes back as multiple copies baked into one
mesh (the cargo truck held three); vehsplit.js in the scratchpad cuts
them apart, but single-view input avoids the surgery.
