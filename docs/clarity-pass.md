# The clarity pass: where our edges are, and what is actually washing out

Brief: *"Prioritize clarity over complexity. If you have to choose between
adding more polygons/details and making existing objects cleaner and sharper,
choose cleaner and sharper."* — and underneath it, that our hierarchy reads
`character → cars → bridge → distant world` where the references read
`character → immediate obstacles → environment → distant scenery, with each
layer remaining visually distinct`.

Measured against the live page at `?bot=1&skip=N`, never a build artefact, at
four points in a race (skip 25 / 110 / 178 / 185). The instrument is
`tools/inkbudget.js`, added by this pass.

---

## 1. The finding, first, because it explains the owner's exact words

**The brightest object in the gameplay band is road marking, not the character.
This is true by material choice rather than by intent.**

| object | material | mean L | p05 / p50 / p95 |
|---|---|---|---|
| `paintGeo` road paint | **`MeshBasicMaterial`** — unlit | **0.55** | peaks near-white (`0xf2f4ff`) |
| the player | **`MeshToon`** — lit, ramped | 0.34 | **0.09 / 0.34 / 0.65** |
| `roadSurfaceTexture` tarmac | `MeshToon` | 0.25 | — |
| telegraph mats | `MeshBasic` | 0.40 | — |

`world.js:3494` — `paint: new THREE.MeshBasicMaterial({ vertexColors: true })`.

Because the paint is unlit it draws at its **authored** value. Because the
character is lit it is **ramped down** by the toon step and the hemisphere
fill. So the road markings render at up to 0.93 while the character — whose
shoes are authored at `0xfff2e0`, nearly the same white — tops out at 0.65.

The focal point is out-valued by the surface it runs on, and nothing in the
art direction asked for that. It is a side effect of one material being lit and
the other not. **This is the mechanical cause of "washed hierarchy", and it is
worth more than any edge count because it says why.**

The fix is cheap and does not touch the art direction: bring the paint's
authored values down toward the tarmac, or put the paint on the same lit
material as the road so it takes the same ramp. Costs **zero draw calls** —
`paintGeo` is already one merged mesh per tile.

---

## 2. The sequencing conclusion, which a builder cannot get wrong

**Outlines stay. They become optional the moment the character's fill clears
its ground by ~0.30 luminance. Doing it in the other order makes the focal
point harder to see.**

Today the player's fill sits at median L 0.34 on tarmac at L 0.25 — it clears
its ground by **0.09**. The player's ink shell is at **L 0.13**. That dark rim
is not decoration laid over a value step; **it is the value step.** It carries
**11.4% of all near-band edges at a density ratio of 9.10**, the densest thing
per unit area in the frame, which is exactly what a rim should be.

Remove it before fixing the fill and the character loses the only separation it
has from the road. Fix the fill first and removing the player shell returns
**~15 draw calls and ~27,000 triangles** safely.

Hazard ink is a separate case and is not negotiable at any point: 1.79% of
frame edges, and `shoot.js` fails the build on hazard contrast below
1.25×/0.22 with the tightest variant today at BLOCK v3 **1.35× / 0.057 S**.
There is no margin there to spend.

---

## 3. Corrections to the brief I was given

**(a) The premise that `S.outlined()` inks "nearly everything" is obsolete, and
should not be re-proposed.** `INK.prop`, `INK.scenery` and `INK.banner` are
**already 0** in `shading.js`; only `character` (0.014) and `hazard` (0.025)
survive, both already lightened from 0.021 / 0.036. That pass has been done.
There is no shell on props, scenery or banners left to remove, and a future
reader of the old note should not go looking for one.

**(b) "We are busy" does not hold against the stated art target.** See §4 — the
near-band edge gap to Subway Surfers is substantially our own HUD, and once it
is discounted we are inside their range in every band.

---

## 4. The edge premise does not survive its own confound

`clarity.js` measures screenshots. Our HUD is **DOM, not canvas**, and the
`RECORD GHOST` rail sits at the bottom of the frame — inside the "near third"
that the edge finding rests on. Subway Surfers and Talking Tom put their HUD at
the **top**.

Same frame, `#ui` shown vs `display:none`:

| frame | near edge% HUD on | HUD off | HUD's share of the near band |
|---|---|---|---|
| skip 25 | 12.6 | 9.6 | 24% |
| skip 110 | 12.6 | 11.2 | 11% |
| skip 178 | 15.2 | 12.9 | 15% |
| skip 185 | 13.0 | 11.6 | 11% |

World-only, against the references:

| | near edge% |
|---|---|
| **ours, HUD off** | **9.6 · 11.2 · 11.6 · 12.9** |
| `ss-run-01/02/03` | 11.6 · 12.7 · 9.3 |
| `tgr-city / boulevard / taxi-street` | 5.9 · 1.6 · 1.4 |

Whole-frame HUD-off we run 13.1–18.5 against Subway Surfers' 14.5–19.1 —
*below* them on average.

The 10× gap to Talking Tom is a composition difference, not a quality one:
`tgr-boulevard`'s near third is 40% empty tarmac with two dashed lines, no
character-scale detail near the camera and no lane telegraph. Matching that
number means deleting the gameplay layer. **It is not a target.**

---

## 5. The per-layer edge budget

### By depth, from the depth buffer

Whole-frame edge share:

| band | skip 25 | skip 110 | skip 178 | skip 185 |
|---|---|---|---|---|
| <8u foreground | 16.8 | 20.5 | 21.8 | 24.1 |
| 8–30u immediate obstacles | 40.9 | 49.0 | 54.2 | 42.6 |
| 30–90u read window | 32.0 | 22.3 | 16.1 | 23.8 |
| 90–235u environment | 7.3 | 4.9 | 6.1 | 4.2 |
| >235u distant / sky | 3.0 | 3.3 | 1.8 | 5.2 |

With value, skip 178:

| layer | pix% | edge% | edge ratio | mean L | sat |
|---|---|---|---|---|---|
| foreground (<8u) | 32.5 | 21.8 | 0.67 | **0.366** | 0.227 |
| immediate obstacles (8–30u) | 36.9 | 54.2 | 1.47 | **0.385** | 0.389 |
| read window (30–90u) | 9.5 | 16.1 | 1.69 | **0.333** | 0.300 |
| environment (90–235u) | 3.4 | 6.1 | 1.79 | 0.592 | 0.168 |
| distant / sky (>235u) | 17.7 | 1.8 | 0.10 | 0.751 | 0.107 |

Two things to read off it.

**Detail density rises with distance** — 0.67 → 1.47 → 1.69 → 1.79. Per unit of
screen area our environment band is 2.7× busier than our foreground. In a
hierarchy that reads, detail per unit area should *fall* with distance. This
does not contradict the correction that the far *screen* band is fine: the top
third is mostly sky, which dilutes it. Both are true.

**The first three depth layers are close to one value block.** Their three mean
luminances span, across the four race points:

| | skip 25 | skip 110 | skip 178 | skip 185 |
|---|---|---|---|---|
| span of the three foreground layer means | **0.021** | **0.059** | **0.052** | **0.131** |
| the single step read window → environment | +0.266 | +0.244 | +0.264 | +0.303 |

**Three layers holding 79% of the frame share less value between them than the
one step into the fog does on its own — four times less, at three of the four
points.** Their p10–p90 spreads are near-identical too (0.15–0.60, 0.18–0.67,
0.18–0.63 at skip 178). Separation appears at 90 units and is produced by the
fog, i.e. by the atmosphere rather than by art direction. Skip 185 is the least
bad at 0.131 and is still half the fog step.

I could not measure this on the references — a screenshot cannot be
depth-segmented — so this is a description of our frame and its fit to the
owner's complaint, **not a measured gap**. See §8 for what happened when I
tried to turn it into one.

### The near band (bottom third), skip 178 — this accounts for ~100% of it

| system | near pix% | near edge% | near ratio |
|---|---|---|---|
| `paintGeo` road paint | 28.98 | **38.86** | 1.34 |
| telegraph mats | 20.80 | 22.22 | **1.07** |
| player fill + ink | 9.91 | **34.38** | 3.47 |
| `roadSurfaceTexture` tarmac | 40.01 | 3.75 | **0.09** |

---

## 6. Named offenders, ranked and costed

Instance counts are meshes submitted — an upper bound on draw calls, since
frustum culling removes some. Budget context: ~262 draws against a working
ceiling near 400; ~182k triangles against 500k. **Triangles are not the
constraint; draw calls are.**

### 1. `paintGeo` expansion joints — the one real over-decoration in the near band

`world.js` ~3798. One merged mesh per road tile — **11 visible, 11 draws, 1,584
tri**. It carries the edge lines, the lane seams and the Egypt beads, plus
`nJ = TILE / ROAD_SLAB = 20` **expansion joints per 24-unit tile**, each drawn
as a *pair* of quads (dark groove `0x272636`/`0x313040` plus a lit lip
`0x73727b`/`0x7b7a81`), spanning the **full carriageway width**, every 1.2
units, unoccluded, directly under the character.

Measured: `paintGeo` is **37–51% of all near-band edges** across the four race
points (38.9 / 39.7 / 43.4 / 51.4) on 27–34% of near pixels. Edge orientation
splits it — **53–60% of its near edges are horizontal-dominant**, i.e. the
transverse joints rather than the longitudinal lines. **The joints alone are
roughly 20–26% of every near-band edge in the game.**

**What it costs in gameplay, stated rather than waved at.** The joints are the
speed cue, modelled in the header on Subway Surfers' sleepers. At record pace
ground speed is `(240 × 30) / 273.7` = **26.3 u/s**, and top speed
`7200 / 254` = **28.3 u/s**. So:

| feature | period | strobe rate at race pace |
|---|---|---|
| light joint | 1.2 u | **~22 Hz** |
| heavy joint (every 4th) | 4.8 u | **~5.5 Hz** |
| lane seam beads (`PAVE_JOINT`) | 2.0 u | ~13 Hz |

At 60 fps a light joint advances 0.44 units per frame — **37% of its own period
per frame**. At ~22 Hz individual joints are not resolvable as discrete events;
they read as shimmer, and they are within 8 Hz of the Nyquist limit of the
frame rate. **The perceptible speed beat is the 4.8-unit heavy joint at ~5.5
Hz, not the 1.2-unit strobe.** That is the argument that the cut is affordable,
and it is a measurement rather than a preference.

**Proposals, increasing boldness:**

- **(a) Drop the lit lip from the light joints; keep it on the heavy ones.**
  Halves the edge count of 3 joints in 4 while keeping the "cut in a surface
  with a thickness" read at the frequency the eye actually resolves.
  **Cost: 0 draw calls** (same merged mesh), −30 tri/tile.
  **Risk:** the header argues the dark-then-light pair is what stops a lone
  dark line reading as a stain. That risk is real at the 4.8u rhythm and is why
  the lip stays there.
- **(b) Gap the joints across the centre of the carriageway for the nearest
  ~10 units**, so the character stands on clean tarmac. Directly serves "the
  character stays the focal point". **Cost: 0 draws, a few tri.**
  **Risk:** an asymmetric road if done per-lane; it must be a symmetric gap
  about the centreline or it will read as a lane marking and compete with the
  mats.
- **(c) Bring the lip's value down toward the tarmac** — `0x7b7a81` on a road
  of `0x50557d` is the second-brightest thing in the near band. **Cost: a
  constant.** This is §1's fix applied to the joints specifically.

**Do not delete the joints.** They are a real speed cue and the near band is
the only place a speed cue can live. The lane dashes cannot replace them: they
are **longitudinal**, so they supply lane identity and convergence, not the
transverse beat that reads as ground speed. Anything that removes the beat
entirely has to put a transverse element back at ~5 Hz.

### 2. The CITY START terraces — the `02-early` far-band outlier, named

Skip 25, top cluster: 11 instances, **12,936 tri, 11 draws**, `MeshToon`
`#fbf8ed`, mean seen-distance **33 u**. **12.60% of frame pixels and 37.55% of
all frame edges — ratio 2.98.** Near-band contribution ~0.9%.

The same class of object at the other race points runs at ratio 1.37 / 1.53 /
2.96, so it is not the terraces as such — it is the **CITY START palette**,
where cream facades carry dark navy window grids at maximum value contrast.
Orientation `H32%` says the cost is mostly *vertical*: window mullions and bay
columns.

This is the whole of the `02-early` far-band anomaly (35.6 against 9.0–24.9
elsewhere). Note it is a **mid-band** object at 33 u — inside the read window
where lane choices are made — not distant scenery.

**What I would do:** reduce the window grid's value contrast on the *pale*
building tints only (`vTerrace` rows, `windowTexture`'s glass step) and let hue
carry the facades. **Cost: 0 draws, 0 tri** — texture and colour only.
**Risk:** buildings flatten into slabs, which the palette comment records as
the failure mode of an earlier pass. Mitigate by keeping full contrast on the
roofline and the ground-floor shopfront band — that is where the silhouette
actually is — and dropping it only on the repeated upper rows.

### 3. Telegraph poles and overhead wires — real, moderate, mid-band

Skip 25 and skip 185: 1 instance, **1,068 tri, 1 draw**, seen at 54–60 u.
**2.76–3.32% of pixels, 4.99–6.28% of frame edges, ratio 1.81–1.89**, with
`H69–77%` — the horizontal-dominant share is the catenary wires, the thinnest
highest-contrast lines it is possible to draw.

One draw call buying 6% of the frame's edges is the best edges-per-triangle
bargain in the game, which is precisely the problem.

**What I would do:** thin the *number* of catenary spans, not the poles — half
the wires at slightly more weight reads as more deliberate. **Cost: 0 draws**
(merged), fewer tri. **Risk:** R3 added these deliberately and they carry the
street read; this is a trim, not a removal. **No fairness cost** — they are
above `OVERHEAD_Y` and the camera looks down, so they cannot occlude a hazard.

### 4. Aid and mile signage — high ratio, load-bearing, leave alone

The `WATER` aid banner (`labelTexture` 512×128, **2 tri, 1 draw**) is 1.03% of
pixels and **3.86% of frame edges, ratio 3.76**. The `MILE 20` plate
(`mileTexture` 768×240) is ratio 4.89. The hazard caution stripes
(`stripeTexture` 128×64) run **ratio 6.17–6.29**, the highest in the frame.

Text *is* edges; that is what makes it legible. R3 closed mile-marker
readability as a defect, and the caution stripes are on the face a hazard turns
toward the player. **All three earn their edges.**

---

## 7. What NOT to change

- **The road surface.** `roadSurfaceTexture` is **40% of near-band pixels and
  3.75% of near-band edges — near ratio 0.09** (0.09–0.19 across race points),
  the cleanest large surface in the frame and cleaner than anything in the
  references' near bands. The "slab seams look busy" hypothesis is wrong. The
  ladder visible in `08-level` is the telegraph mats and `paintGeo`, not this.
- **The telegraph mats.** 21–23% of near pixels at **near ratio 0.87–1.07** —
  at or *below* frame-average density. They are large, not busy, and they are
  how a lane is read at 14 units of run-up, which `shoot.js` fails builds over.
  Cutting them would improve `clarity.js`'s headline number and damage the
  game. **Already at reference quality per unit area.**
- **All ink outlines**, per §2, until the character's fill clears its ground.
- **The character's near-band concentration.** Player fill + ink is **34% of
  near-band edges on 9.9% of near pixels**. That is the focal point working
  correctly and is the part of the hierarchy that already matches the
  references. Every proposal above is partly in service of protecting it.
- **The sky dome** (ratio 0.10) and **the ground planes** (ratio 0.48). Nothing
  to win.
- **Screen-band value layering.** Ours spreads 0.042 / 0.230 / 0.309 / 0.411
  across the three screen thirds against the references' 0.016–0.369. We are
  inside the range; skip 25 has the widest spread in the whole set. Not a
  defect.

---

## 8. What I threw out, and why

Two claims were in the first draft of this document and did not survive
checking. Both were flattering to the argument I was building, which is the
usual direction.

**(a) "The references separate the character from its ground by dL 0.44–0.57;
ours is 0.09."** I got 0.438 / 0.461 / 0.573 from single hand-placed patches —
and the patches were cherry-picked without my noticing. `ss-run-01`'s patch
landed on Jake's white top; `ss-run-03`'s landed on the character's dark hair,
not the body. Comparing a reference *patch* against our character's *mean* is
not like-for-like: a mean is always nearer the middle than a patch is.

Re-measured with tight boxes over the whole character and the same percentile
statistic, character median vs the ground beneath:

| | dL (character p50 − ground) |
|---|---|
| `ss-run-01` | −0.013 |
| `ss-run-03` | −0.203 |
| `sonic-dash-downhill` | +0.019 |
| `tgr-city` | +0.057 |
| **ours** | **+0.09** |

**Our character-to-ground separation is better than three of the four
references.** The claim was not merely unsupported, it was backwards. What is
genuinely different is narrower: our character's **p95 is 0.65** against
0.65 / 0.90 / 0.96 / 0.99 — three of four references put a near-white extreme
on the character and we do not. That is the surviving, much more modest
version, and it is the same ramp effect as §1.

**(b) "Our layers are one value block, the references separate theirs by
0.18–0.58."** The first half is measured and stands. The second half was
derived by taking successive differences between my hand-placed reference
patches — but the *order* of those patches was my own arbitrary layer ordering,
so "adjacent" meant nothing, and two of the five steps were 0.08 anyway. A
screenshot cannot be depth-segmented, so there is no honest reference number
here. §5 now states the measurement about our frame and stops.

**And three defects in the instrument itself**, all flattering, documented in
`tools/inkbudget.js`:

1. **The ID pass rendered ink shells unextruded.** `OUTLINE_VS` extrudes every
   vertex along its view-space normal and *the extrusion is the visible
   object* — the shell is otherwise coincident with its fill. Unextruded it
   lost the z-fight, won ~40 pixels, and the tool reported **outlines cost
   0.00% of frame edges**. I nearly shipped that as the answer to the outline
   question. The `--noink` A/B disagreed (−7.3%), which is what exposed it.
2. **A single shared depth material ignored per-mesh `side`.** The sky dome is
   `BackSide`; with a `FrontSide` depth material it was binned as foreground,
   putting 18% of the frame in the wrong depth layer.
3. **`ownerOf()` tested ink weight before scene-graph root.** The player's limbs
   are wrapped in `outlined()` groups carrying `INK.character`, so **the player
   was filed as a rival** — the focal point of the game in the wrong row of the
   budget.

The standing lesson holds: an instrument nobody audits is a preference with
decimal places, and the reviewer's own tools need a reviewer.

Absolute edge percentages here run below `clarity.js`'s because `clarity.js`
resamples to 520px wide, which concentrates edges. **Shares are comparable,
absolutes are not**, and nothing above rests on an absolute.

---

## 9. Boundaries, so three agents do not collide

- **The value work in §1 touches `shading.js`.** What is mine to state is the
  target: *the character's fill must clear the road it stands on by ~0.30
  luminance, and the road paint must stop out-valuing it.* How that is spent —
  darker tarmac, a lighter or less-ramped character, a stronger contact shadow —
  is the shading agent's call. Flagging rather than deciding.
- **The paint's own values and the joint geometry are in `world.js`**, even
  though they are a value problem. Offenders 1–3 are all `world.js`.
- **Saturation is not mine** and is unchanged: ours 0.25–0.32 against Subway
  Surfers' 0.41–0.51, still the largest single difference in the set.

## 10. The tool

`tools/inkbudget.js` renders one frozen frame three times and reads all three
back: the shipped antialiased **colour** frame (Sobel at `clarity.js`'s 0.35
threshold); an **ID** pass, every mesh flat-filled with a unique colour into an
MSAA-**off** target, giving per-pixel identity *with correct occlusion*; and a
packed linear **depth** pass. Edges are credited to the **nearest** surface in a
3×3 neighbourhood, because a silhouette belongs to the object in front of it.

Meshes cluster by geometry UUID — everything pooled shares one geometry, so
that is system identity for free and does not depend on my reading of
`world.js` being right. `--mask` paints one cluster's won pixels straight from
the ID buffer, which is how `paintGeo` was identified after an isolation render
misled me twice; `--noink`, `--iso`, `--hide` are the A/Bs.

```
node tools/inkbudget.js --skip 178 --w 620 --h 1344
node tools/inkbudget.js --skip 178 --noink
node tools/inkbudget.js --skip 178 --mask "#1"
```
