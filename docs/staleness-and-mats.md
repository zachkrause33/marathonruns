# Staleness, and what the telegraph mats are for

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object in this game
is modelled on all sides, fully, always — every obstacle and vehicle of any
kind, every building, bridge, tree, crowd, sign and prop, and the runner. The
one thing that is not an exception but looks like one: **a marking painted on a
surface has no back, because it is not an object.** The telegraph mat is
exactly that, and half this document is about it — but nothing here licenses a
half-built anything. New objects proposed below are fully-built objects.

**Diagnosis only. No file under `src/` was edited to produce any number here.**
Nothing is implemented. Everything below is a measurement or a costed option.

---

## 0. The answer in nine lines

1. **A run is 236 seconds long and shows 424 hazards. The game owns 23 skins.**
   Every skin is seen, on every date, an average of **18 times in under four
   minutes**. Staleness is not a shortage of variants so much as a surplus of
   sightings.
2. **The median gap between two sightings of the same DUCK is 5.8 seconds**,
   and the tenth-percentile gap is **1.9 seconds**. JUMP is 8.3 s. Those are
   the numbers the owner is feeling.
3. **Density and pool size are one constraint, not two.** Freshness cannot
   exceed skins ÷ sightings-per-window; at mile 23 the DUCK ceiling is **13%**.
   Adding obstacles *per gate* lowers that ceiling. "More obstacles" in the
   sense of *denser* makes the complaint worse.
4. **Where it bites is miles 3–7, not the middle.** By mile 3 novelty is spent
   (19% skin-fresh) while demand is still low (6–33% of gates forcing an
   action). Nothing new and nothing hard, for roughly **27 to 72 seconds** of a
   236-second race.
5. **The macro shape of every run is identical.** The six legs sit at the same
   fractions every single day, and hazards-per-gate varies **1.9× more across
   miles than across dates**. Only the furniture and the backdrop are dealt.
6. **A fully-built, fairness-proven variety mechanic is shipped switched off.**
   `NARROW` (lane closure) is `let NARROW = 0` in `src/core/course.js` and in
   the built `index.html`. Turning it on triples the decisions and costs zero
   generator failures.
7. **The train is the one guaranteed repeat and no number of new skins fixes
   it.** 27.5% of BLOCKs are trains, all forced to variant 0, recurring every
   **3.7 seconds** median.
8. **BLOCKs survive without their mat — and so does everything else.** Four
   uncontaminated readers, 92 route judgements, 46 panels with mats and 46 with
   every mat hidden: **92 of 92 correct**, including **20 of 20 BLOCKs AROUND
   with no paint at all**. In the two counterbalanced within-reader sets there
   is **no cell where the mat improves either the answer or the confidence.**
9. **So the owner's proposal is safe, and cheap: it removes 17.6% of the paint
   and 3.2% of the near band's colour.** Removing *all* mats would cost 22% of
   chroma and 42% of vivid pixels, which is why the mat as a class must stay.
   The one caution runs the *opposite* way to the proposal: every wobble in the
   readings was a **judgement of height** — on JUMPs, and on the one BLOCK read
   at "guessing". If any mat earns its place on readability, it is the one under
   a *low* object.

---

## 1. The instruments, and what is wrong with them

Rule 3: measure before diagnosing, and audit the instrument too. Three tools
produced everything here. Two are new and one was extended.

| tool | what it does | new? |
|------|--------------|------|
| `tools/staleness.js` | casts real courses on the running page, puts a real clock on them, counts sightings and repeat gaps | new |
| `tools/matshare.js` | renders one frozen frame three ways — all mats, no BLOCK mats, no mats — and counts what moved | new |
| `tools/blindread.js --nomat` | renders a panel with the telegraph mat deliberately hidden | extension |

### What each was checked against, rather than believed

**`staleness.js` does not cast the course itself.** The bag deal lives inside a
closure in `world.js`, and a second implementation of it would be a statement
about a function nobody renders. The cast is taken from the running page
through `api.variantPlan`, and **audit A1 checks that plan against
`api.liveCast`** — what the scene graph is actually wearing — before any number
is printed. It agrees 22 of 22 on the live road.

**Its projection re-implements the deal, and is not allowed to speak until it
has reproduced the present.** Asking "what if the bag held twenty more JUMPs"
needs the deal in Node. So the re-implementation is first run at the *real* bag
with the *real* seed and compared against `variantPlan`'s cast hazard for
hazard: **12,730 of 12,730 identical**. A model that cannot reproduce the
present has no standing to describe a future, and if it misses by one the
projection is suppressed.

**It reproduced a published number and thereby corrected my own comment.** The
roadmap quotes JUMP read-window repeats at 7.6%. This tool returns **7.6% of
windows holding two or more JUMPs** and 4.5% of *all* windows. An earlier draft
of the file asserted in a comment that the published figure used the all-windows
denominator; it does not, and every comparison against the roadmap would have
been off by a factor of 1.7.

### Four ways these instruments were wrong first

1. **`matshare.js` sampled in the wrong unit.** `?skip=` is in **race
   seconds**, not world units. The first sweep spaced samples 80 to 6100 as
   though it were the course length, so **nine of ten samples were past the
   tape**, the road was empty, and the tool printed a confident mean off the
   single sample that landed inside the race. It failed loudly, which is the
   only reason it was caught.
2. **A near-band zero meant two different things.** A share of 0.00% is either
   "the game drew no mat" or "the mat is further up the frame than the bottom
   third". `blindread.js` had already paid for this as MATCROP vs MATLOST. The
   frame-wide count is now printed beside the band count.
3. **I chose the chroma samples by eye.** The first colour reading was taken
   over five samples I picked because mats were visible in them — which is
   selection bias, in the flattering direction. Redone over **all 20**.
4. **A mean of ratios described the zeros.** Most samples have no BLOCK mat in
   the near band, so the mean per-sample BLOCK share is 11% and is really a
   statement about how often the ratio is zero. **Pooled over the sweep it is
   17.6%.** Both are printed.

### What is NOT measured here, stated so it is not read as if it were

**Scenery.** Buildings, trees, crowds, traffic, the twelve settings and the six
biome palettes are a large part of what a player looks at, and none of it is
counted. Everything in Part 1 is a census of **hazards**. A conclusion about
whether the *world* gets stale cannot be drawn from it.

---

## 2. Part 1 — what one run actually shows

Measured on the running page (`index.html` sha1 `912d7f058cb5`), 30 dates,
clean-run clock from the real `Pace` model over the real elevation.

### 2.1 The census

| | per run |
|---|---|
| race length | **236.1 s** clean, 284.0 s at mid skill |
| gates | 185.0 (min 178, max 189) |
| hazard sightings | **424.3** (min 407, max 450) |
| — JUMP / DUCK / BLOCK | 193.1 / 158.2 / 73.0 |
| distinct skins seen | **23.00 of 23 built** — minimum 23 |

**Every run shows every object the game owns.** There is no long tail waiting
to be discovered; the pool is exhausted every time, in under four minutes.

| kind | skins | mean sightings per skin per run | busiest |
|------|-------|-------------------------------|---------|
| JUMP | 8 | 24.1 | — |
| DUCK | 5 | **31.6** | — |
| BLOCK | 10 | 7.3 (min 3.2, max 23.4) | **v0 at 23.4** |

### 2.2 How long before you see it again

Gap from one sighting of a skin to the next sighting of *the same* skin, on the
clean-run clock — which is the *fast* clock and therefore the *short* gaps, the
unflattering direction.

| kind | p10 | p25 | median | median in gates | back-to-back |
|------|-----|-----|--------|-----------------|--------------|
| JUMP | 3.0 s | 5.2 s | **8.3 s** | 7 | 1.4% |
| DUCK | 1.9 s | 3.4 s | **5.8 s** | 5 | 4.0% |
| BLOCK | 1.4 s | 4.9 s | 17.8 s | 15 | **16.3%** |

"Back-to-back" is the share of consecutive hazards of a kind wearing the same
skin — the harshest repeat there is, with nothing in between.

**A DUCK repeating every 5.8 seconds and a BLOCK repeating every 3 minutes are
different problems, and the game has the first one.** DUCK is the worst kind on
every measure: fewest skins (5), second-most sightings (158), shortest median
gap, and one DUCK in twenty-five follows an identical DUCK immediately.

### 2.3 The roof, which is the finding that reframes the question

Skin-freshness over a window cannot exceed **skins ÷ sightings-in-window**.
That makes pool size and density a single constraint.

| kind | skins | sightings per 30 s at mile 2 / 13 / 23 | ceiling on 30 s freshness |
|------|-------|--------------------------------------|---------------------------|
| JUMP | 8 | 24.4 / 35.3 / 44.5 | 33% / 23% / **18%** |
| DUCK | 5 | 29.1 / 31.8 / 38.2 | 17% / 16% / **13%** |
| BLOCK | 10 | 17.8 / 31.9 / 28.9 | 56% / 31% / 35% |

By mile 23 the game shows **38 DUCKs every thirty seconds** and owns five of
them. No draw, however clever, can make that feel varied. **This is why "more
obstacles" meaning "denser" is the one answer that is certainly wrong** — it
lowers the ceiling it is trying to raise.

### 2.4 The train, the one guaranteed repeat

A BLOCK train is dealt outside the bag and is always variant 0 — deliberately,
because it is the only body authored to stretch along z.

| | |
|---|---|
| BLOCK sightings per run | 73.0 |
| of which trains, forced to v0 | 20.1 — **27.5% of every BLOCK** |
| wearing v0 for any reason | 23.4 — **32.1%**, where a fair share of ten skins is 10.0% |
| BLOCK back-to-back same skin | **16.3%**, and **5.0%** with trains taken out |
| train to train, same object | median **3.7 s**, p10 **0.0 s**, 19.1 such gaps per run |

**p10 of zero means two trains in the same gate.** This is the single most
repeated object in the game and no number of new BLOCK skins moves it — which
is visible in the projection below as the BLOCK column that stops improving and
then goes backwards.

### 2.5 Is there structure beyond the objects?

**Gate shapes** — a gate with the skins taken off, three lanes each holding
CLEAR, JUMP, DUCK or BLOCK. This is the question the player answers at 25 units,
before any skin resolves.

- 60 distinct shapes exist across 30 days; **one run shows 48.6 of them**
- shape entropy per run **5.26 bits**, against 5.91 for uniform over 60
- the top three shapes cover only **15.0%** of gates

So the *arrangement* is genuinely varied and is not the problem. What is fixed
is everything above it:

**The six legs sit at the same fractions on every single date** — CITY START
0.00, RIVERSIDE 0.17, THE BRIDGE 0.33, PARKLAND 0.50, THE WALL 0.72, FINAL MILE
0.92. Only the 3-or-4 settings drawn from twelve change.

**And the difficulty arc is fixed too.** Hazards per gate climbs 1.33 → 2.68
across the race, and:

> spread of hazards-per-gate **across miles 0.40**, across **dates within a
> mile 0.21** — a ratio of **1.9 : 1**.

Mile 23 is denser than mile 3 on every date, by about four standard deviations
of the day-to-day variation. **The arc of a run is not dealt. Only its contents
are.**

### 2.6 Where staleness bites

Two curves, per mile, over 30 dates. `skin-fresh` is the share of hazards
wearing a skin not seen in the preceding 30 or 60 seconds — **recency, not
first-sighting**, so it does not decay to zero by construction the way a
first-appearance count would. `forced` is the share of gates with no CLEAR
lane, i.e. the player must act.

| mile | haz/gate | forced | skin-fresh 30s | 60s | shape-fresh 30s |
|------|----------|--------|----------------|-----|-----------------|
| 0 | 1.33 | 0% | 100% | 100% | 96% |
| 1 | 1.65 | 9% | 93% | 93% | 76% |
| 2 | 1.71 | 12% | 42% | 42% | 72% |
| **3** | 1.63 | **6%** | **19%** | 16% | 55% |
| **4** | 1.59 | **9%** | **19%** | 13% | 55% |
| **5** | 1.79 | **16%** | **18%** | 11% | 58% |
| **6** | 1.84 | **22%** | **11%** | 7% | 51% |
| **7** | 1.97 | **33%** | **9%** | 3% | 55% |
| 10 | 2.34 | 34% | 7% | 2% | 58% |
| 14 | 2.54 | 54% | 4% | 1% | 44% |
| 19 | 2.65 | 65% | 4% | 1% | 39% |
| 24 | 2.68 | 68% | 4% | 2% | 39% |

**The trough is miles 3 to 7.** Novelty is already spent — by mile 3 only 19%
of hazards wear a skin unseen in the last half-minute — while demand is still
low, 6% to 33% of gates forcing an action against 65% at mile 19. Nothing new
and nothing hard. At roughly 9 seconds a mile that is **about 27 to 72 seconds
into a 236-second race**, which is the second quarter of the experience.

It is *not* the middle miles by intuition. From mile 10 onward novelty is
equally spent, but the course is at least asking questions.

### 2.7 What "more obstacles" should mean, and what each costs

The projection re-deals the same courses with the same seeds and bigger bags.
It reproduces the shipped cast exactly (12,730/12,730) before it is believed. A
new skin holds **one ticket**, which is what a newly built object really is.

| new objects built per kind | total skins J/D/B | JUMP median gap | DUCK median gap | BLOCK median gap | DUCK p10 |
|---|---|---|---|---|---|
| **+0 (today)** | 8/5/10 | 8.3 s | **5.8 s** | 17.8 s | 1.9 s |
| +2 | 10/7/12 | 10.5 s | 8.2 s | 20.8 s | 2.9 s |
| +5 | 13/10/15 | 13.7 s | 11.9 s | 22.5 s | 4.3 s |
| +10 | 18/15/20 | 18.9 s | 18.0 s | 25.1 s | 6.9 s |
| +20 | 28/25/30 | 29.1 s | 29.5 s | 21.0 s | 11.6 s |
| +40 | 48/45/50 | 49.7 s | 51.3 s | **7.3 s** | 19.9 s |

Read the BLOCK column carefully: it improves to +10 and then **goes backwards**,
because once the bag is large enough that non-train BLOCKs stop repeating, the
surviving repeats are all train-to-train — the same object, 3.7 s apart, which
no bag can touch.

**Four readings of "more obstacles", costed:**

**(a) More variants — the expensive half, and it works, linearly.**
Roughly, median gap scales with skins. Buying DUCK a 30-second gap costs
**+20 DUCK skins**, quadrupling that fleet. Every one must be built on all
sides under rule 1. The *cheap* end is real though: **+2 per kind takes DUCK
from 5.8 s to 8.2 s and back-to-back DUCK repeats from 4.0% to 2.1%**, for six
objects. Draw calls: **zero** — variants are built and parented once and
switched by visibility, and a variant's geometry is merged. Triangles: abundant
(182k of a 500k ceiling). **Priority order is not equal: DUCK is worst on every
measure and has the fewest skins. Two new DUCKs are worth more than two new
BLOCKs.**

**(b) More kinds — the only lever that changes what the player does.** There
are three verbs. A fourth would multiply the shape space from 4³=64 to 5³=125
lane patterns *and* cut every existing kind's sighting rate by about a quarter,
raising every freshness ceiling in §2.3 at once. It is the only option that
attacks both terms of the roof. Cost is much the highest: a collision envelope,
a new input, a new mat colour, and — the real risk — the fairness proof in
`solvable()`, which is what stops the game taking a run for something outside
the player's control. Rule 4 makes that a build failure, not a preference.

**(c) Denser gates — measured, and it is the wrong direction.** Density already
climbs to 2.68 hazards per gate and the freshness ceiling falls as it climbs.
More obstacles per gate makes the repeat rate worse, not better. **Cost: negative.**

**(d) More variety in the arrangement — and there is a switch already built.**
Gate shape variety is already good (48.6 of 60 shapes per run). What is flat is
the *macro* structure: six legs at fixed fractions, a fixed difficulty arc.
Against that, `tools/mechanics.js` reports:

> `shipped defaults  NARROW=0 RAMP=1`

**`NARROW`, the lane closure, is switched off in the shipped game** — `let
NARROW = 0` in `src/core/course.js`, and the same line is in the built
`index.html`. It is reachable only by adding `?narrow=1` to the URL. Measured
over 40 days with it on:

| | NARROW=0 | NARROW=1 |
|---|---|---|
| closures planted | 0 | 265 |
| one-lane corridor, share of race | 0.86% | **4.05%** |
| two-or-fewer lanes, share of race | 18.9% | **26.9%** |
| one-lane stretches that are DECISIONS | 59 | **162** |
| generator gave up (degrades) | 0 | **0** |
| courses failing validate() | 0 | **0** |

**This is a fully-built, fairness-proven mechanic that changes the shape of the
road, sitting behind a flag, costing nothing to enable and zero generator
failures.** `RAMP` is on but rare — **3.65 per race** across 185 gates.

**My recommendation on Part 1, for the owner to accept or reject:** the cheapest
real win is (d) then (a)-at-the-low-end — turn `NARROW` on, raise `RAMP`
frequency, and build **two or three new DUCKs first**. That is a handful of
objects and one flag, against +20 skins per kind for the same felt effect. (b)
is the only answer that fixes it properly and it is a project, not a pass.

---

## 3. Part 2 — the mats

### 3.1 The question

The mat is the painted mark under each gate that says OVER, UNDER or AROUND
before the shape resolves. Roadmap entry 61 fixed it to lie flat at every
gradient and immediately got **6 of 6 ducks read UNDER at confidence "sure"**,
closing a defect five passes had chased. Entry 63 then got **35 of 35** across
two readers with every mat present. So the mat is load-bearing *by measurement*,
not by assumption, and that is the thing the owner's proposal has to survive.

The proposal: **no mat on a BLOCK, mats only on JUMP and DUCK.**

### 3.2 The experiment

Two arms, shot as **true twins**: same build, same date (2026-08-11), same
`skip`, same gate, same gradient, same light, same backdrop, same crop
rectangle. They differ in the paint and in nothing else.

- **arm ON** — all 23 variants at 25 units (`READ_NEAR`, the distance the lane
  is actually chosen at), mats as the game draws them
- **arm OFF** — the identical 23 frames with `--nomat`, every mat hidden

`MATCHECK` is not relaxed in the OFF arm, it is **repurposed**: it still
requires that the game drew a mat inside the crop, which proves each OFF panel
is genuinely *missing* something. All 23 OFF panels lost **12.3% to 26.9% of
their crop**. A no-mat panel shot where no mat existed anyway would be the
control photographed twice, silently turning a two-arm experiment into a
one-arm one.

Readers are **uncontaminated** — a session created against a parentless branch
containing only the images and `PROMPT.txt`: no source, no `CLAUDE.md`, no
repository to leak vocabulary from. Protocol from entry 63; three commands, no
checkout, no risk to the shared tree.

### 3.3 The result: BLOCKs survive without their mat

**Route accuracy, 23 panels per arm:**

| kind | mat ON | mat OFF |
|------|--------|---------|
| JUMP | 8 / 8 | **8 / 8** |
| DUCK | 5 / 5 | **5 / 5** |
| BLOCK | **10 / 10** | **10 / 10** |

**Removing every mat in the game cost zero route accuracy at `READ_NEAR`.**

Across all four readers — the two arms plus the two counterbalanced sets in
§3.4 — that is **92 of 92 route judgements correct, 46 of them on panels with
no mat at all**, and **20 of 20 BLOCKs read AROUND unpainted**.

The OFF-arm reader's reasoning is entirely about the object. On `BLOCK v1`,
verbatim:

> *"The shuttered cargo box is a flat closed wall running from the dark bumper
> up beyond the top of the frame, with the wheels and body sealing off the
> ground."*

On `BLOCK v3` — the variant entry 61 caught reading OVER — with **no mat at
all**, verbatim:

> *"The striped barrier panel is a solid face on legs and two people stand
> immediately behind it, so there is nothing to land on if you jump and no
> clearance under the panel — the cones only mark the ends, leaving road on
> either side."*

That is now the **third** consecutive reader to take the two figures behind
`BLOCK v3` as an obstruction rather than as a ruler, and the first to do it
with the paint removed.

### 3.4 The confidence difference between arms was the reader, not the mat

Confidence on the route answer, "sure" counts, between the two arms:

| kind | mat ON (reader 1) | mat OFF (reader 2) |
|------|--------|---------|
| JUMP | 6 / 8 sure | 0 / 8 sure |
| DUCK | 5 / 5 sure | 5 / 5 sure |
| BLOCK | 1 / 10 sure | 8 / 10 sure |

Read naively this says JUMP needs its mat and BLOCK is *hurt* by one. **Both
halves of that are an artefact.** The two arms were read by two *different*
readers, and confidence words are precisely where readers differ most — so the
comparison is confounded with temperament.

**So it was re-run within a single reader.** Two counterbalanced mixed sets:
each reader sees all 23 variants exactly once, about half with mat and half
without, with the assignment flipped between the two sets. Now the with/without
contrast lives *inside* one reader and temperament cancels.

**Reader B, 23 panels, 23 of 23 correct — identical in every cell:**

| kind | mat ON | mat OFF |
|------|--------|---------|
| JUMP | 4/4 correct, **0/4 sure** | 4/4 correct, **0/4 sure** |
| DUCK | 3/3 correct, **3/3 sure** | 2/2 correct, **2/2 sure** |
| BLOCK | 5/5 correct, **4/5 sure** | 5/5 correct, **4/5 sure** |

**Reader A, the complementary assignment, 23 of 23 correct.** Pooling the two
within-reader sets — 46 judgements, every variant seen once with paint and once
without, across two readers:

| kind | mat ON | mat OFF |
|------|--------|---------|
| JUMP | 8/8 correct, 0/8 sure (0%) | 8/8 correct, **2/8 sure (25%)** |
| DUCK | 5/5 correct, 5/5 sure (100%) | 5/5 correct, **5/5 sure (100%)** |
| BLOCK | 10/10 correct, 7/10 sure (70%) | 10/10 correct, **8/10 sure (80%)** |

**There is no cell in which the mat helps.** Within one reader the mat changed
neither the answer nor the confidence for any kind; a reader is uniformly unsure
about JUMPs and uniformly sure about DUCKs *whether or not the paint is there*,
which is a property of the reader and of the objects.

That disposes of both apparent effects in the between-arm table above. It also
means the honest conclusion is **broader than the owner's proposal**: at
`READ_NEAR`, on these panels, **the telegraph mat is not carrying the
over/under/around read for any kind.** The objects are.

**This is the first controlled test of that.** Roadmap entries 61 and 63
established that readers succeed *with* mats — 6/6, then 35/35. Neither removed
the mat, so neither could show the mat *caused* the success. Entry 61's
comparison was submerged-mat against fitted-mat, not mat against no-mat.

### 3.4b The one wobble, and it points the other way to the proposal

Every hesitation in 92 judgements was **a judgement of height**, and where the
paint was gone the reader reached for another ruler. On `JUMP v0` with no mat,
verbatim:

> *"Two or three layers of logs lying flat on the tarmac, **no higher than a
> knee or so relative to the lane markings**, and solid through — so you clear
> it rather than pass through it."*

And the single lowest-confidence answer in the whole experiment — `BLOCK v2`,
mat removed, answered correctly but at **"guessing"**:

> *"**Measured against the traffic-light head behind it**, the barricade's top
> rail is around chest height and the panel is solid to the ground, but **it is
> close enough to hurdle height that I cannot call it confidently.**"*

That is the same failure mode as the JUMPs, and it is the mechanism roadmap
entry 61 identified: **a nearby object supplies a ruler, and the mat is a ruler
the game controls.** `BLOCK v2` is a low barricade — the one BLOCK that is
near hurdle height rather than obviously a wall.

**So if any mat is kept on readability grounds, the rule is not "keep it on
JUMP and DUCK". It is "keep it under things whose HEIGHT is the question"** —
which is every JUMP, and the low BLOCKs, and none of the buses, lorries or
gantries. That is a different cut from the one proposed, and a smaller one.

Worth recording separately: `BLOCK v9`, the moped `kindread.js` scores at
−1.117 against the DUCK centroid, again read AROUND at "sure" — and again the
reason came from **outside the variant**: *"the motorcycle wedged against its
rear closes off the gap under the tailgate"*. That is the third time a reader
has rescued v9 with a second object the course does not guarantee, exactly as
entry 63 warned. **v9 remains the strongest candidate for the next art pass and
this experiment did not clear it.**

### 3.5 What removing BLOCK mats costs the look

`tools/matshare.js`, 20 samples evenly spaced through one race, one frozen
frame rendered three ways, HUD hidden, near band = bottom third.

**Area:**

| | mean share of near band | range |
|---|---|---|
| all mats | **23.30%** | 0.00% – 73.78% |
| BLOCK mats | 4.10% | 0.00% – 36.48% |

Pooled over the sweep, **17.6% of near-band mat pixels are on BLOCKs** (16.5%
frame-wide) — *not* the third the proposal assumes. BLOCK mats are the smallest
of the three (12.4–13.5% of crop at 25 u, against JUMP's 25.4–26.1%) and there
are the fewest BLOCKs.

**Colour**, via `tools/chroma.js` — an audited instrument this pass did not
reimplement — over all 20 samples:

| condition | near-band chroma C | near-band vivid % |
|---|---|---|
| shipped | 0.1565 | 19.86% |
| BLOCK mats dropped | 0.1515 | 18.70% |
| all mats dropped | 0.1217 | 11.56% |

| | chroma | vivid pixels |
|---|---|---|
| **drop BLOCK mats only** | **−3.2%** | **−5.9%** |
| drop all mats | −22.2% | −41.8% |

**So the owner's proposal is cheap in exactly the way they hoped: it removes
17.6% of the paint and 3.2% of the near band's colour.** It also confirms why
the mats as a class must stay — losing all of them would cost the near band
over a fifth of its chroma and two fifths of its vivid pixels, in a game whose
recorded problem is that the near band is 46% less saturated than its
reference.

**And it reframes the trade.** The read survives without any mats at all, so
the mats are not being kept for legibility — they are being kept because they
are, by a distance, the most colourful thing on a road the project has already
measured as too grey. That is a legitimate reason. It is just a different one
from the one on record, and it means the question "which mats can go" is a
question about the *look* and not about *fairness*.

### 3.6 A third option the owner has not named

**The mat's pixels are spent where they are least needed.** A BLOCK's mat,
measured directly:

| distance | mat pixels on screen | share of crop |
|---|---|---|
| 8 u | **11,744** | 21.1% |
| 12 u | 4,178 | 18.1% |
| 25 u (`READ_NEAR`) | **648** | 13.0% |

**Eighteen times as much paint at 8 units as at 25** — and 25 units is where
the lane is chosen. By 8 units the decision is long made and the object is
unmistakable; the mat is then just the largest coloured thing on the road.

That suggests a third option:

> **Fade the mat by distance rather than by kind.** Full strength out at
> `READ_NEAR` where it carries the read, fading out inside ~12 units where the
> object has resolved. It keeps the channel that closed a five-pass defect, on
> *every* kind including the JUMPs that measurably need it, and it frees the
> near band — which is the band the owner is reacting to — without deciding
> that any kind of hazard goes unlabelled.

Two more worth putting up, both weaker:

- **Mat only where the object is ambiguous**, keyed to `kindread.js`'s
  silhouette margin (`BLOCK v9`, the moped, scores −1.117 against the DUCK
  centroid and is the one variant both the instrument and a reader have flagged).
  Principled and measurable — but it teaches the player "paint = tricky", which
  is information the game did not mean to give, and it makes the road
  inconsistent in a way that is hard to learn.
- **Make the mat say something the object cannot.** Today it names a verb the
  object already names — and §3.3 shows that at 25 units the object names it
  perfectly well alone, so the paint is *redundant* information. It could
  instead mark the **take-off point** for a jump, which is a timing cue nothing
  else in the frame carries. That turns the paint from duplication into new
  information and is the only option here that would make the game easier to
  play *well* rather than merely easier to read. It also happens to attack the
  one weakness the readers did show, which was always about height and timing.

**My recommendation on Part 2, for the owner to accept or reject:** the proposal
as stated is safe on readability and worth about 3% of near-band colour, so it
is affordable either way — but it is solving the wrong problem, because the mat
was never the reason BLOCKs read. If the goal is *less painted road*, the
distance fade gets far more of it back (the paint is 18× heavier at 8 u than at
25 u) without giving up any kind's label. If the goal is *the road looking less
uniform*, note that the mats are the near band's main source of colour and
removing them cuts against `docs/near-band-colour.md`. **The cut I would put up
instead of "no mat on BLOCK" is "no mat where height is not the question"** —
which keeps it under every JUMP and the low BLOCKs and drops it from buses,
lorries, trams and gantries.

### 3.7 What is not settled

- **Four readers is four readers.** 92 judgements is enough to say the mat is
  not carrying the read at 25 units; it is not enough to price a 1-in-200 misread,
  and rule 4 says one contact ends a record attempt. A no-mat build should be
  put through `shoot.js` and `kindread.js` before anyone believes this at
  shipping confidence.
- **The readers upscaled the crops.** `blindread.js` deliberately does not
  resample, on the grounds that an upscaled 25-unit crop is a picture of a read
  the player never gets. Both readers zoomed. That gives them **more**
  information than a player has, so it **weakens a pass and strengthens a
  fail** — and since both arms did it, the *difference* between arms largely
  survives while the absolute scores are flattered. Every score above is at
  ceiling, so this matters: 23/23 without mats is a result under
  better-than-play conditions.
- **One distance only, and it is the friendliest one for this conclusion.**
  Every panel is at 25 units. The mat may well matter more at 40 units, where
  the object is smaller and the paint proportionally larger, and that is exactly
  where a distance-keyed fade (§3.6) would be *keeping* the mat. **Nothing here
  licenses removing paint from the far read; it was not tested.**
- **The panels are single hazards on empty road.** The game presents up to
  three lanes at once with a hazard in each. A mat may be doing work in
  disambiguating *which lane wants what* that a one-object panel cannot show.
- **`tools/mechanics.js` reports its identity hashes have moved** — "GATE
  generation has MOVED at NARROW=0 RAMP=0". That is either a stale baseline or
  a real change in `src/core/course.js` by someone else. **Not mine, not
  chased, flagged here** because a stale identity baseline is how a silent
  generator change ships.

---

## 4. Branches pushed

Parentless, on purpose. **Never merge them.**

| branch | contents |
|---|---|
| `blindread-mat-on` | 23 panels, every variant at 25 u, mats as shipped |
| `blindread-mat-off` | the same 23 frames with every mat hidden |
| `blindread-mixed-a` / `-b` | counterbalanced within-reader sets |
| `answers-mat-on` / `answers-mat-off` / `answers-mixed-*` | the readers' verbatim answers |
