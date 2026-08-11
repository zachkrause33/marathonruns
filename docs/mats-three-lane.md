# Does the telegraph mat help you choose a lane?

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object in this game
is modelled on all sides, fully, always — every obstacle and vehicle of any
kind, every building, bridge, tree, crowd, sign and prop, and the runner. The
one thing that is not an exception but looks like one: **a marking painted on a
surface has no back, because it is not an object.** The telegraph mat is
exactly that, and this whole document is about it — but nothing here licenses a
half-built anything.

**Diagnosis only. No file under `src/` was edited to produce any number here.**
Everything below is a measurement. The three tools are new and live in
`tools/`.

**Measured against `b9b2170`**, in a detached worktree pinned to that commit,
because two other agents were committing to `src/` while this ran and two arms
rendered against different builds would not be two arms. The full gate passes
on that build: `build.js` up to date, `shoot.js` **OK: all shots clean**,
`course-test.js` **PASS 90 courses deterministic and solvable**, `simulate.js`
**PASS pace model satisfies its stated contract**.

---

## 0. The answer

*(filled in below — see §3)*

---

## 1. The question this pass exists to close

`docs/staleness-and-mats.md` found that with every mat hidden, four readers got
**92 of 92 route judgements correct**, including 20 of 20 BLOCKs. It then wrote
down, in its own list of what is not settled, the two limits that stop that
being the whole answer:

> **The panels are single hazards on empty road.** The game presents up to
> three lanes at once with a hazard in each. A mat may be doing work in
> disambiguating *which lane wants what* that a one-object panel cannot show.

> **One distance only, and it is the friendliest one for this conclusion.**

Judging one isolated object is not the player's task. The task is to **scan
three lanes and pick one**, and the mat's own job description in `world.js` —
the mat says WHAT TO DO, the object says WHAT IT IS — is a claim about a
decision, not about an identification.

The decision in front of the owner is which way a distance fade should run. A
mat is heaviest close in, where the decision is already made; the proposal is
to fade mats **out** on approach, and the owner's counter-intuition is the
opposite. **If the far mat measurably helps a three-lane choice, the fade runs
out. If it does not, the mats are decoration at every distance.**

---

## 2. The instrument, and the two ways it was wrong first

| tool | what it does |
|------|--------------|
| `tools/lanechoice.js` | shoots real three-lane gates at a chosen read distance, both arms as twins |
| `tools/lanechoice-sets.js` | builds the counterbalanced reader sets and asserts the design |
| `tools/lanechoice-score.js` | scores demand, choice and confidence separately, verbatim beside every cell |

### 2.1 A panel is a gate the course dealt

Nothing about the cast is written by the tool: the occupied lanes, the kind in
each lane, the variant, a train's span and a ramp's tail are all the course's
and the bag's. The tool reads the staged gate back out of the scene graph and
**checks it against `api.liveCast()` before a pixel is written** — the same
shape as `staleness.js`'s A1 audit, and for the same reason. A gate that does
not match what the game says is on the road fails the run. 16 of 16 agreed.

The one thing the tool moves is the gate's **distance**, rigidly, re-seating on
the elevation and re-pitching by the slope at the new z — the claim site's own
two placement lines. Read distance is one of the two variables under test, so
it cannot be left to wherever the sampling happened to land.

### 2.2 Gates are chosen by a rule, not by eye

The previous pass caught itself choosing chroma samples by eye, "which is
selection bias, in the flattering direction". The rule here is mechanical:

> for each skip in an evenly spaced sweep through the race, take the **first
> live gate strictly ahead of the runner**.

No filter on how many lanes are occupied, on which kinds appear, or on whether
the picture is interesting. **And the skip is in race seconds, not units** —
the unit `matshare.js` got wrong, putting nine of ten samples past the tape.

What the sweep actually produced, over 16 gates:

| | |
|---|---|
| gates with 1 / 2 / 3 occupied lanes | 0 / 12 / 4 |
| occupied lanes | 36 |
| JUMP / DUCK / BLOCK | 15 / 11 / 10 |
| CLEAR lanes | 12 |
| BLOCK trains | 4 |
| BLOCK variants seen | v0 ×5, v3, v5, v8 ×2, v9 |

### 2.3 DEFECT 1: the crop cut two thirds of the paint out of the ON arm

The first version drew its crop from geometry — collision boxes plus the mat's
run-up *guessed* at six units back and as wide as the box. The guess was wrong
in both directions. Measured against the mat's real bounding box, the crop
ended at x 308 while the paint ran to x 345, and the bottom of every mat fell
below the crop as well.

**Mat pixels inside the crop, per lane, at 25.35 units: 600 under the guessed
crop, 1,872 under the measured one.** The ON arm was showing the reader about a
third of the paint the game draws, while the OFF arm lost nothing it was not
already missing — so the experiment would have understated the mat, **which is
the flattering direction for the conclusion that the mat does nothing.**

The fix is to stop guessing. The mat's extent is exactly the pixels that move
when it is hidden, so the diffs are taken first and the crop is the union of
the object box with the mat's **measured** box. Every panel now asserts
`matFullyInside`.

### 2.4 DEFECT 2: the two arms were shot as separate runs, on different gates

`blindread.js` shoots its arms as two runs, and can, because it *moves* a
borrowed object to an exact distance — the panel does not depend on where the
runner is. This tool picks its gate by "the first gate ahead of the runner", so
the panel depends on the runner's position entirely — and **the runner's
position is not reproducible across page loads.** Four loads, same skip, same
date:

    runnerZ   451.632   451.056   452.043   451.466

The race is driven from the `requestAnimationFrame` timestamp, so the settling
time before the scene is read is real time and varies with machine load. One
unit is enough to move the "first gate ahead" cut past a gate, and it did: two
runs at the same seed and the same skip selected **the gate at z 460.4 and the
gate at z 500.4** — different gates, different hazards.

**Two arms shot on different gates are not two arms.** Both buffers now come
out of one page evaluation, so the arms differ in the paint and in nothing
else: same course, date, gate, lanes, variants, gradient, light, backdrop, crop
rectangle and instant of wind.

### 2.5 What was checked before any answer was believed

| control | result |
|---|---|
| staged gate vs `api.liveCast()` | 16 of 16 gates agree, kind and variant |
| per-lane MATCHECK — every occupied lane must lose paint | **36 of 36 lanes at both distances** |
| mat's own bounding box inside the crop | 32 of 32 panels |
| all three lane centres inside the crop | 32 of 32 panels |
| per-lane mat masks partition the whole-panel mask | exact, gap 0 on every panel |
| cast unchanged between the two distance shots | 0 of 16 gates re-tenanted, runnerZ drift 0.00 |
| **twins on disk differ by exactly the recorded mat count** | **32 of 32 pairs, deviation 0 px** |
| stale contact-shadow artefact | 36 px, identical in both arms |
| screen left/right order | projected, not assumed; verified against the pictures |

The last-but-one is the end-to-end one: the written PNG files were decoded and
diffed, and every twin pair differs by **exactly** the mat pixel count the
harness recorded, to the pixel. A whole-panel count of "some" would have been
satisfied by one lane's paint, which is why MATCHECK is per lane here.

**Why the mat is toggled per lane.** An OFF arm in which two lanes lost their
paint and the third never had any is not the treatment it claims to be — it is
the control photographed in two of three lanes.

### 2.6 The counterbalancing, which is what killed the last pass's result

The previous pass's confidence table appeared to say JUMP needs its mat and
BLOCK is hurt by one. Both halves were an artefact of reading the two arms with
two *different* readers, and only a within-reader re-run killed it.

So the design is a **Latin square over four conditions** — near+mat,
near+nomat, far+mat, far+nomat — with reader *r* seeing gate *i* in condition
`(i + r) mod 4`. `lanechoice-sets.js` asserts three properties rather than
claiming them:

1. **Every reader sees both arms and both distances in equal number** — 4
   panels in each of the 4 conditions. The mat contrast lives *inside* each
   reader, so temperament cancels.
2. **Every gate is seen once in every condition** across the four readers, so
   no condition is carrying an easier set of gates. Confirmed by composition:
   all four conditions contain **exactly 36 occupied lanes, 15 JUMP, 11 DUCK,
   10 BLOCK, 12 clear lanes and 4 trains** — identical, not merely balanced.
3. **No reader sees the same gate twice.** This is the one the obvious design
   gets wrong: a reader shown the same road at 25.35 and again at 32 is not
   making an independent second judgement, and if the two looks straddled the
   arms they would be being shown the same road with and without paint.

Readers are **uncontaminated** — a session created against a parentless branch
holding 16 panels and `PROMPT.txt` and nothing else. No source, no `CLAUDE.md`,
no repository to leak vocabulary from. Verified: the branch tree has 17 entries
and the commit has 0 parents. Recipe from roadmap entry 63, now implemented as
`lanechoice-sets.js --push` rather than re-invented each pass.

### 2.7 The question the readers were asked

Not the identification question. The player's question:

> You are running down this road at speed and you must pick a lane.
> 1. WHICH LANE do you take — left, middle or right?
> 2. WHAT DOES EACH LANE DEMAND? OVER, UNDER, AROUND or CLEAR.
> 3. HOW SURE ARE YOU of your lane choice?
> 4. WHAT DID YOU USE TO DECIDE?

Question 4 is the one that can catch the mat doing work the accuracy columns
cannot see, and it is deliberately open so a reader who used the paint says so
in their own words.

---

## 3. The result

*(filled in from the readers)*

---

## 4. How much paint there is, by distance — re-measured

The fade decision rests on a ratio, so the ratio was re-measured
independently, frame-wide (crop-independent), over 8 gates at five distances,
mean mat pixels per occupied lane:

| distance | mat px per lane | vs `READ_NEAR` | whole gate |
|---|---|---|---|
| 8 u | **31,908** | **18.7×** | 71,792 |
| 12 u | 22,579 | 13.2× | 50,804 |
| **25.35 u (`READ_NEAR`)** | **1,710** | **1.00×** | 3,848 |
| 32 u | 787 | 0.46× | 1,771 |
| 40 u | 402 | 0.24× | 905 |

**The published 18× figure is confirmed at 18.7×** on an independent
measurement that counts the whole mat rather than the part that fell inside
`blindread.js`'s crop. The absolute pixel counts in `docs/staleness-and-mats.md`
(648 px at 25 u) are low by roughly 3× for that reason — they were counted
inside a crop window that cut the mat off — **but the ratio the fade proposal
rests on survives, and extends: the mat is 79× heavier at 8 u than at 40 u.**

---

## 5. What is not settled

*(filled in)*
