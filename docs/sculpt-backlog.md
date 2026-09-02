# The sculpt backlog

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

## BLOCK (swipe left/right) -- 10 of 14 sculpted

| v  | obstacle    | status                                             |
|----|-------------|----------------------------------------------------|
| 0  | tram        | TO DO -- carriage instancing is BUILT (the rake at the cast site; rideable trains and >4-car trains keep code art), but the props-v2 sculpt was refused by the contrast gate: white-over-navy measures L 96 / S 0.05 against lane 1's L 93 / S 0.18, and the paint shop plateaus at S 0.32. Needs a VIVID regeneration -- a red or yellow tram photo as Tripo input -- then one dress line ships it. |
| 1  | signworks   | shipped (props-v2)                                 |
| 2  | lightworks  | shipped (props-v2)                                 |
| 3  | crossing    | TO DO -- needs a WIDE regeneration: the WAIT-beacon sculpt is a 0.28-wide pole in a 2.17-wide kill box. Generate something full-lane by nature: a pedestrian-crossing barrier assembly, a beacon PAIR on a works trailer, anything shaped like its own collision box. |
| 4  | bus         | shipped (props-v3, red double-decker, +1.7 lightness coat) |
| 5  | taxi        | shipped (props-v2)                                 |
| 6  | van         | shipped (props-v2)                                 |
| 7  | refusetruck | shipped (props-v2)                                 |
| 8  | crateload   | shipped (props-v3, brightened + saturated coat)    |
| 9  | moped       | shipped (props-v3 scooter + rider, green coat)     |
| 10 | container   | TO DO -- needs a LIGHT regeneration: the weathered blue sits inside the finish carpet's tone (L 59 / S 0.53 vs L 56.6 / S 0.507) and no repaint reaches the gate (ceiling L 62.5 under 1.8x lightness). Generate a light one: white, orange or yellow livery. |
| 11 | dumpster    | shipped (props-v3)                                 |
| 12 | hatchback   | shipped (props-v3 blue car; ships in orange, gold, green, magenta -- blue itself is under the gate) |
| 13 | police      | TO DO, MAYBE NEVER -- black-over-white averages to road grey (L 88 / S 0.02 vs lane 1's L 93 / S 0.18) and no tint has a lever. A sculpt only works with a strongly-coloured livery (e.g. a European blue-and-yellow battenburg pattern); classic US black-and-white cannot pass the gate in this palette. |

## JUMP (leap over) -- 0 of 12 sculpted, NEXT UP

Low objects; the sculpt's silhouette matters at knee height. Best Tripo
inputs marked: (photo) = screenshot a real-world photo, (card) = use
the obstacle card rendered from the game (no real-world equivalent).

| v  | obstacle  | input |
|----|-----------|-------|
| 0  | sandbags  | photo |
| 1  | cones     | photo -- three orange traffic cones in a row |
| 2  | trench    | card -- open roadworks trench with edge boards |
| 3  | scooter   | photo -- fallen e-scooter lying on its side |
| 4  | barrier   | photo -- low concrete jersey barrier |
| 5  | pipe      | card -- pipe stack on chocks |
| 6  | planter   | photo -- street planter box |
| 7  | crate     | photo -- single wooden crate |
| 8  | barricade | photo -- red/white works barricade |
| 9  | drum      | photo -- oil drum pair |
| 10 | lowbar    | card -- low crossbar on posts |
| 11 | trash     | photo -- trash bag pile |

## DUCK (slide under) -- 0 of 11 sculpted

Overhead spans; the slide-under gap comes from MR.Collision.BOX, never
from the art, so the sculpt is fitted with its underside on the box
line. Wide, span-like generations work; tall or floor-standing ones
will not fit the frame.

| v  | obstacle   | input |
|----|------------|-------|
| 0  | gantry     | card |
| 1  | scaffold   | photo or card -- scaffolding span |
| 2  | sign       | card -- hanging roadwork sign frame |
| 3  | boom       | photo -- lowered boom barrier arm |
| 4  | pipe       | card -- overhead pipe run |
| 5  | walkway    | card -- elevated pedestrian walkway |
| 6  | floodlight | photo or card -- works floodlight rig |
| 7  | bridge     | card -- low bridge underside |
| 8  | awning     | photo -- shop awning |
| 9  | shopsign   | photo or card -- projecting shop sign |
| 10 | walkboard  | card -- scaffold walkboard span |

## Also waiting

- Grandstand/arena crowds are still box people by design (the roadside
  knots wear the props-v1 sculpts).
- The sculpted Miles has a painted face; a facial rig (blink/gaze/brow)
  is a separate effort.
