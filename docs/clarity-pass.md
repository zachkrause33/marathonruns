# The clarity pass: where our edges are, and what is actually washing out

Brief: *"Prioritize clarity over complexity. If you have to choose between
adding more polygons/details and making existing objects cleaner and sharper,
choose cleaner and sharper."* — and, underneath it, that our hierarchy reads
`character → cars → bridge → distant world` where the references read
`character → immediate obstacles → environment → distant scenery, with each
layer remaining visually distinct`.

This document answers: **which objects spend edges without earning them, and
what would make each layer read as its own layer.**

The instrument is `tools/inkbudget.js`, added by this pass. Everything below is
measured against the live page at `?bot=1&skip=N`, never against a build
artefact, at four points in a race (skip 25 / 110 / 178 / 185).

---

## Summary, in the order the evidence forced

1. **The edge premise does not survive its own confound.** Our near band is
   measured on a screenshot that includes our DOM HUD; the references' near
   bands contain no HUD. Hide our HUD and our near-band edge density is
   **9.6 / 11.2 / 11.6 / 12.9** against Subway Surfers' **9.3 / 11.6 / 12.7**.
   We match them. There is no near-band edge surplus against Subway Surfers.
2. **The real defect is not edge count, it is value separation, and no edge
   statistic can see it.** Our first three depth layers — character, immediate
   obstacles, and the read window — sit within **dL 0.055** of each other and
   cover **79% of the frame**. The references separate adjacent layers by
   **0.18–0.58**.
3. **The worst instance is the character against the road it stands on:
   dL 0.06–0.09. The references: 0.44 / 0.46 / 0.57.** A 5–9× shortfall, and
   the single largest measured gap in this review.
4. **The ink outline is currently the only thing separating the character from
   the road.** It is 11.7% of near-band edges at a density ratio of 9.15.
   **Removing outlines is wrong** until (3) is fixed. This inverts the
   hypothesis I was asked to test, and the test is what inverted it.
5. Real over-decoration does exist and is secondary: `paintGeo`'s transverse
   expansion joints, and the CITY START terraces.

---

## The instrument, and the two defects it caught in itself

`tools/inkbudget.js` renders one frozen frame three times and reads all three
back:

- **COLOUR** — the shipped antialiased frame; Sobel at the same 0.35 threshold
  `clarity.js` uses.
- **ID** — every visible mesh flat-filled with a unique colour into an
  MSAA-**off** render target. Per-pixel object identity *with correct
  occlusion*. An isolation render cannot do this: it shows pixels the object
  does not win.
- **DEPTH** — linear view depth, packed to 24 bits.

Edges are credited to the **nearest** surface in a 3×3 neighbourhood, because a
silhouette belongs to the object in front of it.

Meshes cluster by geometry UUID, which is system identity for free — everything
pooled shares one geometry. Nothing in this scene graph is named, so this is the
only classification that does not depend on my reading of `world.js` being
right.

Per the standing rule that the reviewer's own tools need a reviewer, two
defects it had, both flattering, both caught by a cross-check:

1. **The ID pass rendered ink shells unextruded.** `shading.js` `OUTLINE_VS`
   extrudes every vertex along its view-space normal, and *the extrusion is the
   visible object* — the shell is otherwise coincident with the fill it wraps.
   Rendering it unextruded made it lose the z-fight and win ~40 pixels, and the
   tool reported **outlines cost 0.00% of frame edges**. I nearly shipped that
   as the answer to question 3. The `--noink` A/B disagreed (−7.3% of frame
   edges), which is what exposed it. The ID shader now mirrors `OUTLINE_VS`.
2. **A single shared depth material ignored per-mesh `side`.** The sky dome is
   `BackSide`; with a `FrontSide` depth material it was binned as foreground and
   put 18% of the frame in the wrong depth layer.

A third, in the labelling rather than the render: `ownerOf()` tested ink weight
before scene-graph root, and since the player's limbs are wrapped in
`outlined()` groups carrying `INK.character`, **the player was being filed as a
rival** — the focal point of the game in the wrong row of the budget.

Absolute edge percentages here run below `clarity.js`'s because `clarity.js`
resamples to 520px wide, which concentrates edges. **Shares are comparable;
absolute values are not.** Nothing below rests on an absolute.

---

## Finding 1 — the near-band edge gap is substantially our own HUD

`clarity.js` measures screenshots. Our HUD is DOM, not canvas, and our
`RECORD GHOST` rail sits at the bottom of the frame — inside the "near third"
the correction identified as the finding. Subway Surfers and Talking Tom put
their HUD at the **top**.

Measured, same frame, `#ui` shown vs `display:none`:

| frame | near edge% HUD on | near edge% HUD off | HUD's share of the near band |
|---|---|---|---|
| skip 25 | 12.6 | 9.6 | 24% |
| skip 110 | 12.6 | 11.2 | 11% |
| skip 178 | 15.2 | 12.9 | 15% |
| skip 185 | 13.0 | 11.6 | 11% |

Against the references, world-only:

| | near edge% |
|---|---|
| ours, HUD off | 9.6 · 11.2 · 11.6 · 12.9 |
| `ss-run-01/02/03` | 11.6 · 12.7 · 9.3 |
| `tgr-city / boulevard / taxi-street` | 5.9 · 1.6 · 1.4 |

**We are inside Subway Surfers' range in every band.** Whole-frame HUD-off we
are 13.1–18.5 against Subway Surfers' 14.5–19.1 — *below* them on average.

The 10× gap to Talking Tom is real but is a composition difference, not a
quality one: `tgr-boulevard`'s near third is 40% empty tarmac with two dashed
lines, no character-scale detail near the camera and no lane telegraph. Copying
that number means deleting the gameplay layer. It is not a target.

**So: "we are busy" is not supported against the stated art target.** The
owner's complaint is real; edge density is not what it is made of.

---

## Finding 2 — the layers are not separated by value, which is what "washed" means

Per-depth-band mean luminance, skip 178, from the depth buffer:

| layer | pix% | edge% | edge ratio | mean L | sat | L p10–p90 |
|---|---|---|---|---|---|---|
| character / foreground (<8u) | 32.5 | 21.8 | 0.67 | **0.366** | 0.227 | 0.15–0.60 |
| immediate obstacles (8–30u) | 36.9 | 54.2 | 1.47 | **0.385** | 0.389 | 0.18–0.67 |
| the read window (30–90u) | 9.5 | 16.1 | 1.69 | **0.333** | 0.300 | 0.18–0.63 |
| environment (90–235u, into fog) | 3.4 | 6.1 | 1.79 | 0.592 | 0.168 | 0.42–0.79 |
| distant / sky (>235u) | 17.7 | 1.8 | 0.10 | 0.751 | 0.107 | 0.53–0.98 |

Adjacent-layer separation, skip 178 / skip 25:

```
foreground -> immediate obstacles   dL +0.021 / +0.021
immediate obstacles -> read window  dL -0.055 / -0.012
read window -> environment          dL +0.264 / +0.266
environment -> distant              dL +0.154 / +0.245
```

**The first three layers are one value block.** They hold 79% of the frame's
pixels and span 0.055 of luminance between them, and their p10–p90 ranges are
near-identical (0.15–0.60, 0.18–0.67, 0.18–0.63). Separation only appears at
90 units, and it is produced entirely by the fog — i.e. by the atmosphere, not
by art direction.

That is the owner's sentence in numbers. `character → cars → bridge` is washed
because character, cars and bridge are all L ≈ 0.33–0.39.

The references, hand-placed patches on full-bleed frames (coordinates are in
the scratch tool; placement is arguable, the magnitude is not):

| | near surface | character | dL |
|---|---|---|---|
| `ss-run-01` | train roof L 0.311 | L 0.749 | **+0.438** |
| `ss-run-03` | surface L 0.553 | L 0.092 | **−0.461** |
| `sonic-dash-downhill` | road L 0.759 | L 0.186 | **−0.573** |

All three put the character 0.44–0.57 away from the surface it stands on, and
the direction alternates — it is a deliberate maximal value split, not a
palette accident.

### Ours

| object | mean L | sat |
|---|---|---|
| road surface (`roadSurfaceTexture`) | **0.25** | 0.21 |
| the player | **0.34** | 0.50 |
| road paint (`paintGeo`) | **0.57** | 0.16 |
| telegraph mats | 0.40 | 0.24 |
| player's ink outline | 0.13 | 0.51 |

**The character is 0.09 from the tarmac. The road paint is 0.23 brighter than
the character.** The value hierarchy in the gameplay band is inverted: the
brightest thing near the player is road markings. In Subway Surfers the
character is the brightest thing in its neighbourhood.

This is the finding. It is also partly the shading agent's territory — see
*Boundaries* at the end.

---

## Finding 3 — the outline experiment, which came out the other way

`--noink` switches off every ink shell in the live scene and re-measures.

| | edges | near edges | draws | tris |
|---|---|---|---|---|
| baseline (skip 178) | 113,133 | 25,206 | 261 | 160,613 |
| `--noink` | 104,926 | 21,469 | 206 | 100,781 |
| delta | **−7.3%** | **−14.8%** | **−55** | **−59,832** |

Per-owner, with the corrected ID pass:

| owner | pix% | edge% | ratio | near edge% | near ratio | mean L |
|---|---|---|---|---|---|---|
| player fill | 3.49 | 5.65 | 1.62 | 22.68 | 2.63 | 0.338 |
| **player ink** | 0.49 | 2.83 | 5.78 | **11.70** | **9.15** | 0.133 |
| hazard fill | 1.47 | 4.65 | 3.17 | — | — | 0.463 |
| hazard ink | 0.27 | 1.84 | 6.92 | — | — | 0.174 |
| ghost ink | 0.04 | 0.32 | 7.40 | — | — | 0.685 |

Ink is **4.98% of frame edges on 0.79% of pixels** — by far the densest thing
per unit area in the frame, exactly as a rim should be. It is also **60 of 262
draw calls (23%) and 60,392 of 160,613 triangles (37%)**, which is a genuine
cost against a ~400 draw ceiling.

**And it should stay.** The player's ink is L 0.133 against a tarmac of L 0.25
and a player fill of L 0.34. With the fill only 0.09 from the road, *the dark
rim is the character's separation from the ground*. Delete it and the focal
point loses the only value step it has. The references do not need outlines
because they already have dL 0.44–0.57; we have not earned the right to drop
them.

**Sequencing, therefore: fix the value separation first. Outlines become
optional the moment the character clears ~0.30 from the road, and dropping them
then returns ~30 draw calls and ~27k triangles.** Proposing it before that is
proposing to make the character harder to see.

Hazard ink: same argument, stronger. `shoot.js` fails the build on hazard
contrast under 1.25×/0.22 and the tightest variant today is BLOCK v3 at
1.35×/0.057S. Hazard ink is cheap (1.84% of edges) and is propping up a
fairness contract. **Do not touch it.**

---

## The per-layer edge budget

Whole-frame edge share by depth band, four race points:

| band | skip 25 | skip 110 | skip 178 | skip 185 |
|---|---|---|---|---|
| <8u foreground | 16.8 | 20.5 | 21.8 | 24.1 |
| 8–30u immediate obstacles | 40.9 | 49.0 | 54.2 | 42.6 |
| 30–90u read window | 32.0 | 22.3 | 16.1 | 23.8 |
| 90–235u environment | 7.3 | 4.9 | 6.1 | 4.2 |
| >235u distant / sky | 3.0 | 3.3 | 1.8 | 5.2 |

Edge **density** ratio (edge% ÷ pix%) rises with distance at every race point —
0.67 → 1.47 → 1.69 → 1.79 at skip 178. Per unit of screen area our environment
band is 2.7× busier than our foreground. In a hierarchy that reads, detail per
unit area should *fall* with distance. This does not contradict the correction
that the far *screen* band is fine: the top third is mostly sky, which dilutes
it. Both are true.

Near-band (bottom third) budget, skip 178 — this accounts for ~100% of it:

| system | near pix% | near edge% | near ratio |
|---|---|---|---|
| `paintGeo` road paint | 28.98 | **38.86** | 1.34 |
| telegraph mats | 20.80 | 22.22 | **1.07** |
| player fill + ink | 9.91 | **34.38** | 3.47 |
| `roadSurfaceTexture` tarmac | 40.01 | 3.75 | **0.09** |

---

## Named offenders, ranked, with costs

Instance counts are meshes submitted — an upper bound on draw calls, since
frustum culling removes some.

### 1. `paintGeo` expansion joints — the one real over-decoration in the near band

`world.js` ~3798. One merged mesh per road tile (11 visible, **11 draws, 1584
tri**). It carries the edge lines, the lane seams, the Egypt beads — and
`nJ = TILE / ROAD_SLAB = 20` **expansion joints per 24-unit tile**, each drawn
as a *pair* of quads (a dark groove `0x272636/0x313040` plus a lit lip
`0x73727b/0x7b7a81`), spanning the **full carriageway width**, every 1.2 units.

Measured: `paintGeo` is **37–51% of all near-band edges** across the four race
points (38.9 / 39.7 / 43.4 / 51.4), on 27–34% of near pixels. Edge orientation
splits it: **53–60% of its near edges are horizontal-dominant**, i.e. the
transverse joints rather than the longitudinal lines. So the joints alone are
roughly **20–26% of every near-band edge in the game**, and they are painted
directly under and around the character.

The header argues they are the speed cue, modelled on Subway Surfers' sleepers.
The model is not quite right: Subway Surfers' sleepers are mostly *covered by
the train the player runs on*, and where visible they are low-contrast
grey-on-grey. Ours are unoccluded, full-width, and deliberately a two-value
pair — which by construction doubles the edge count per joint.

**What I would do**, in increasing order of boldness:

- **(a) Drop the lit lip on the light joints, keep it on the heavy 4.8u ones.**
  Halves the edge count of 3 joints in every 4 while keeping the "cut in a
  surface" read at the rhythm that survives to distance. Cost: **0 draw calls**
  (same merged mesh), **−30 tri/tile**. Risk: the header's claim that the pair
  is what sells it — but it only needs to sell at the frequency the eye
  resolves, and the 4.8u rhythm is that frequency.
- **(b) Stop the joints at the lane band the player occupies.** Fade or gap the
  joint quads across the centre lane's width for the nearest ~10 units so the
  character stands on clean tarmac. Directly serves "the character stays the
  focal point". Cost: 0 draws, a few tri. Risk: an asymmetric road if done
  crudely; must be a symmetric gap, not a per-lane one.
- **(c) Lower the lip's value toward the tarmac.** The lip at `0x7b7a81` on a
  road of `0x50557d` is the second-brightest thing in the near band. Cost: a
  constant. Risk: overlaps the shading agent — coordinate.

**Do not delete the joints.** They are a real speed cue and the near band is
where a speed cue has to live.

### 2. The CITY START terraces — the `02-early` far-band outlier, named

Skip 25, cluster #0: 11 instances, **12,936 tri, 11 draws**, `MeshToon`
`#fbf8ed`, seen at 33u. **12.60% of frame pixels and 37.55% of all frame
edges — ratio 2.98.** Near-band contribution ~0.9%.

The same class of object at the other race points runs at ratio 1.37 / 1.53 /
2.96. So it is not the terraces as such; it is the **CITY START palette**, where
cream facades (`#fbf8ed`) carry dark navy window grids at maximum value
contrast. Edge orientation `H32%` says the cost is mostly *vertical* — window
mullions and bay columns.

This is the whole of the `02-early` far-band anomaly the correction flagged
(35.6 against 9.0–24.9 elsewhere). It is a mid-band object, not a distant one:
mean seen-distance 33u, squarely in the read window where hazards are chosen.

**What I would do:** reduce the window grid's value contrast on the *pale*
building tints only (`vTerrace` `rows`, and `windowTexture`'s glass step), and
let hue carry the facades instead. Cost: **0 draws, 0 tri** — it is a texture
and colour change. Risk: buildings flatten into slabs, which the palette
comment says was the failure mode of an earlier pass. Mitigate by keeping full
contrast on the roofline and the ground-floor shopfront band, which is where
the silhouette actually is, and dropping it only on the repeated upper rows.

### 3. The telegraph poles and overhead wires — real, moderate, and mid-band

Skip 25 cluster #3 and skip 185 cluster #3: 1 instance, **1,068 tri, 1 draw**,
seen at 54–60u. **2.76–3.32% of pixels, 4.99–6.28% of frame edges, ratio
1.81–1.89**, and `H69–77%` — the horizontal-dominant share is the catenary
wires, which are the thinnest, highest-contrast lines it is possible to draw
(dark cable against pale sky, one pixel wide, crossing the whole upper frame).

They are the single best edges-per-triangle bargain in the game, which is the
problem: 1 draw call buys 6% of the frame's edges.

**What I would do:** thin the *number* of catenary spans, not the poles. Half
the wires at twice the visual weight reads as more deliberate and costs fewer
edges. Cost: **0 draws** (merged), fewer tri. Risk: R3 added these
deliberately and they are part of the street read; this is a trim, not a
removal. **They cannot occlude a hazard** — they are above `OVERHEAD_Y` and the
camera looks down — so there is no fairness cost.

### 4. Aid and mile signage — high ratio, load-bearing, leave alone

The `WATER` aid banner (`labelTexture`, 512×128, **2 tri, 1 draw**) is 1.03% of
pixels and **3.86% of frame edges, ratio 3.76**. The `MILE 20` plate
(`mileTexture`, 768×240, 2 tri) is ratio 4.89. The hazard caution stripes
(`stripeTexture`, 128×64, 2 tri) run **ratio 6.17–6.29**, the highest in the
frame.

These are text and warning chevrons. Text *is* edges; that is what makes it
legible. R3 closed mile-marker readability as a defect and the caution stripes
are on the face a hazard turns toward the player. **All three are earning their
edges. Do not touch.**

---

## What NOT to change

- **The road surface.** `roadSurfaceTexture` is **40% of near-band pixels and
  3.75% of near-band edges — ratio 0.09**, the cleanest large surface in the
  frame and cleaner than anything in the references' near bands. The "slab
  seams look busy" hypothesis is wrong; the texture is nearly invisible as
  edges. The ladder in `08-level` is the telegraph mats and `paintGeo`, not
  this.
- **The telegraph mats.** 21–23% of near pixels but **near ratio 0.87–1.07** —
  at or *below* frame-average density. They are large, not busy. They are also
  how a lane is read at 14 units of run-up, and `shoot.js` fails builds over
  exactly that. Cutting them would drop `clarity.js`'s edge% nicely and damage
  the game. **The mats are already at reference quality per unit area.**
- **All ink outlines**, for now, for the reasons in Finding 3. Revisit only
  after character/road value separation clears ~0.30.
- **The sky dome.** Ratio 0.10. Nothing to win.
- **The ground planes.** Ratio 0.48. Fine.
- **The character's near-band edge density.** Player fill + ink is **34% of
  near-band edges on 9.9% of near pixels**. That concentration is the focal
  point working correctly and is the one part of the hierarchy that already
  matches the references. Protect it; every proposal above is partly in
  service of it.

---

## Boundaries, so three agents do not collide

- **Value separation between layers is the finding, and executing it touches
  the shading agent's file.** The palette, the toon ramp bands and the fog are
  `shading.js`. What is mine to state is the target: *the character must clear
  the road it stands on by ~0.30 luminance, and adjacent depth layers must
  clear each other by more than 0.055.* How that is spent — darker tarmac,
  lighter character, a stronger contact shadow, an earlier fog ramp — is the
  shading agent's call. Flagging rather than deciding.
- **The road-paint values (`paintGeo` joint and lip colours) are in
  `world.js`** even though they are a value problem. Whoever owns `world.js`
  should take offender 1; the numbers above are the brief.
- **Saturation is not mine** and is unchanged: ours 0.25–0.32 against Subway
  Surfers' 0.41–0.51, still the largest single difference in the set.

## What the brief got wrong, and what I got wrong

- **The brief's premise that `S.outlined()` inks "nearly everything" is
  obsolete.** `INK.prop`, `INK.scenery` and `INK.banner` are all already **0**;
  only character (0.014) and hazard (0.025) survive. That work has been done.
- **"We are busy" does not hold against Subway Surfers** once our own HUD is
  removed from the near-band measurement. It holds against Talking Tom, whose
  frame is not a target.
- **My own instrument reported that outlines cost nothing**, because it rendered
  the outline geometry unextruded. Caught by an A/B that disagreed with it.
  Two further defects in the same tool are documented above. The standing
  lesson holds: an instrument nobody audits is a preference with decimal places.
