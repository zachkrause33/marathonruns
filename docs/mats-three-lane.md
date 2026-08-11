# Does the telegraph mat help you choose a lane?

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object in this game
is modelled on all sides, fully, always — every obstacle and vehicle of any
kind, every building, bridge, tree, crowd, sign and prop, and the runner. The
one thing that is not an exception but looks like one: **a marking painted on a
surface has no back, because it is not an object.** The telegraph mat is
exactly that, and this whole document is about it — but nothing here licenses a
half-built anything.

**Diagnosis only. No file under `src/` was read for an answer and none was
edited.** Everything below is a measurement.

**Measured against `388bb8c`**, in a detached worktree pinned to that commit,
because another agent is committing to `src/` while this runs and two arms
rendered against different builds would not be two arms.

The `index.html` committed at that pin was **stale** — 2,511,534 bytes on disk
against a 2,580,533-byte fresh build — and `shoot.js` run against it reported
**23 hazard variants for a fleet of 26**, which is the build from before the
three new DUCKs. It was rebuilt inside the pinned worktree and every panel here
was shot against that rebuild. It has since been rebuilt and committed properly
as `b5d3b43`, and **the artifact this pass photographed is byte-identical to
it**, blob `b815503`. So the panels are the shipped game and not a local
variant, and that is checked rather than assumed.

---

## 0. The answer

**The mat changed no answer, at either distance, on any kind.** Four
uncontaminated readers, 64 panels, **132 occupied-lane judgements split exactly
66/66 between the arms and 33/33 between the distances**:

| | 25.35 u | 32 u | pooled |
|---|---|---|---|
| **mat ON** | 30/33 (91%) | 30/33 (91%) | **60/66 (91%)** |
| **mat OFF** | 31/33 (94%) | 31/33 (94%) | **62/66 (94%)** |

**The mat arm is the worse arm, by the same margin, at both distances.** There
is no distance at which the paint bought anything and no sign of the effect
growing with distance that the fade question was asked to find. The 2-cell gap
is one reader, and it runs against the mat.

**DUCK is 52/52 and BLOCK is 28/28 — every variant of both, perfect in both
arms at both distances.** CLEAR lanes are 60/60. **Lane choice is 64/64 viable:
nobody, in either arm, ever picked a lane that would end a record attempt.**
Every error in the entire test is a JUMP read as AROUND, and all ten belong to
one reader.

**But "the mat does nothing" is the wrong reading of that, and the readers say
why in their own words.** Two of the four decoded the mat's colour code
correctly from the pictures alone, with nobody telling them. One then used it
to settle *which low objects are jumpable* and carried that to the unpainted
panels. The one who refused it went on to read jumpable hurdles as walls ten
times — **naming the gold paint in the same sentence in which it contradicted
that paint.** So the mat's demonstrated job is **teaching the object, once**,
not answering the question at every gate.

**On the fade, the honest recommendation is: fade OUT on approach — but for a
reason the proposal did not give, and only down to the decision distance.**

- The far mat is **not too faint to matter**: at 32 units readers described it
  unprompted — *"two gold strips side by side"*, *"which glows cyan"*. It is
  read. It just changes nothing for a reader who already reads the object.
- At `READ_NEAR` the mat is 1,710 px per lane and fully legible; at 8 units it
  is **17.45× heavier**, and by 8 units the lane was chosen long ago.
- So the paint that can be spent is the paint **inside 25 units**. Put
  precisely: of the mat pixels drawn for one lane at 8 u and at `READ_NEAR`
  together, **94.6% of them are drawn at 8 u** (29,830 of 31,540) — and that is
  the share that buys the least, because the lane was chosen at `READ_NEAR`.

**What the evidence does not support is removing or thinning the mat at the
decision distance or beyond it**, because that is where the teaching happens
and because both known artefacts of this design (§3.3, §3.5b) push the measured
mat effect toward zero. **The owner's instinct — faint far, clear near — is the
one option this test argues against**, since near is precisely where the mat is
already redundant.

*(All four readers landed. The Latin square is complete: every reader saw 4
panels in each of the 4 conditions, every gate appeared once in every
condition, and no reader saw the same gate twice.)*

---

## 1. The question this pass exists to close

`docs/staleness-and-mats.md` found that with every mat hidden, four readers got
**92 of 92 route judgements correct**. It then wrote down, in its own list of
what is not settled, the two limits that stop that being the whole answer:

> **The panels are single hazards on empty road.** The game presents up to
> three lanes at once with a hazard in each. A mat may be doing work in
> disambiguating *which lane wants what* that a one-object panel cannot show.

> **One distance only, and it is the friendliest one for this conclusion.**

Judging one isolated object is not the player's task. The task is to **scan
three lanes and pick one**, and the mat's own job description — the mat says
WHAT TO DO, the object says WHAT IT IS — is a claim about a decision, not about
an identification.

The decision in front of the owner is which way a distance fade should run. A
mat is heaviest close in, where the decision is already made; the proposal is
to fade mats **out** on approach, and the owner's counter-intuition is the
opposite. **If the far mat measurably helps a three-lane choice, the fade runs
out. If it does not, the owner's instinct is free.**

---

## 2. The instrument

| tool | what it does |
|------|--------------|
| `tools/lanechoice.js` | shoots real three-lane gates at a chosen read distance, both arms as twins |
| `tools/lanechoice-sets.js` | builds the counterbalanced reader sets and asserts the design |
| `tools/lanechoice-score.js` | scores demand, choice and confidence separately, verbatim beside every cell |

### 2.1 A panel is a gate the course dealt

Nothing about the cast is written by the tool: the occupied lanes, the kind in
each lane, the variant, a train's span and a ramp's tail are all the course's
and the bag's. The tool reads the staged gate back out of the scene graph and
**checks it against `api.liveCast()` before a pixel is written**. A gate that
does not match what the game says is on the road fails the run. 16 of 16
agreed, with zero recorded failures.

The one thing the tool moves is the gate's **distance**, rigidly, re-seating on
the elevation and re-pitching by the slope at the new z — the claim site's own
two placement lines. Read distance is one of the two variables under test, so
it cannot be left to wherever the sampling happened to land.

### 2.2 Gates are chosen by a rule, not by eye

> for each skip in an evenly spaced sweep through the race, take the **first
> live gate strictly ahead of the runner**.

No filter on how many lanes are occupied, on which kinds appear, or on whether
the picture is interesting. **And the skip is in race seconds, not units** —
the unit `matshare.js` got wrong, putting nine of ten samples past the tape.

What the sweep produced, over 16 gates at each distance:

| | |
|---|---|
| gates with 1 / 2 / 3 occupied lanes | 2 / 11 / 3 |
| occupied lanes | 33 |
| JUMP / DUCK / BLOCK | 13 / 13 / 7 |
| CLEAR lanes | 15 |
| BLOCK trains | 2 |

**The three new DUCKs are in it, and they were not put there by hand.** The
mechanical draw gave `DUCK v5` ×2, `v6` ×2 and `v7` ×1 — five of the thirteen
DUCK sightings. This matters because the previous pass pinned `b9b2170`, which
is *older than* `a668100`, the commit that built them: **no panel that pass
photographed could have contained a v5, v6 or v7.**

### 2.3 The two defects the previous pass found, and kept

**The crop was drawn from a guess at where the mat is** — object collision
boxes plus a run-up guessed at six units back — and the guess cut roughly two
thirds of the paint out of the ON arm while the OFF arm lost nothing. That
understated the mat, **which is the flattering direction for the conclusion
that the mat does nothing.** The crop is now the union of the object box with
the mat's *measured* box, and every panel asserts `matFullyInside` (32 of 32).

**The two arms were shot as separate runs, on different gates.** This tool
picks its gate by "the first gate ahead of the runner", and the runner's
position is not reproducible across page loads — four loads at the same skip
put it at 451.632, 451.056, 452.043 and 451.466, and two runs at the same seed
selected the gate at z 460.4 and the gate at z 500.4. Both buffers now come out
of **one page evaluation**.

The same fix in `blindread.js` is `--art`: **cropping a DUCK panel to the
collision box cuts the object off**, because a DUCK terminates between 3.10 and
3.58 while the tallest collision box is 2.80. That had been quietly weakening
every duck read taken before it. It is kept and it is still right.

### 2.4 What I checked before believing any of it

| control | result |
|---|---|
| staged gate vs `api.liveCast()` | 16 of 16 agree, kind and variant; 0 recorded failures |
| per-lane MATCHECK — every occupied lane must lose paint | **33 of 33 lanes at both distances** |
| mat's own bounding box inside the crop | 32 of 32 panels |
| all three lane centres inside the crop | 32 of 32 panels |
| per-lane mat masks partition the whole-panel mask | exact, gap 0 on every panel |
| cast unchanged between the two distance shots | 0 of 16 re-tenanted, runnerZ drift 0.0000 |
| **twins on disk differ by exactly the recorded mat count** | **32 of 32 pairs, deviation 0 px** |
| design re-derived from the master key, not taken on assertion | no problems |
| composition identical across the four conditions | see below |

Every condition contains **exactly 16 gates, 33 occupied lanes, 13 JUMP, 13
DUCK, 7 BLOCK, 15 clear lanes and 2 trains** — identical, not merely balanced.

### 2.5 THE HEADLINE CONTROL WAS THE HARNESS CHECKED WITH ITS OWN RULER

The twin-pair check above is the end-to-end one: the written PNG files are
decoded and diffed, and every pair differs by exactly the mat pixel count the
harness recorded. I reproduced it independently — a different decoder, a
browser this audit opened itself, numbers recomputed from pixels — and got 32
of 32, deviation 0 px.

**But that check passes at the harness's own threshold, and the harness picks
the threshold.** `lanechoice.js` calls two pixels different when a channel
differs by more than 6. Diffing the same files at threshold 0:

    changed pixels the harness records        89,738
    changed pixels actually on disk          118,201     +24.1%

So the arms differ in **28,463 pixels the control was blind to**. That residue
is either the mat's own soft edge, which is harmless, or something else moving
between the arms, which would wreck the experiment. It is decided by geometry,
with a Chebyshev distance transform from the supra-threshold mask:

| distance from the nearest mat pixel | residue pixels | cumulative |
|---|---|---|
| 1 px | 16,272 | 57.2% |
| 2 px | 6,910 | 81.5% |
| 3 px | 2,749 | 91.1% |
| 4 px | 1,321 | 95.8% |
| 5–7 px | 1,101 | 99.6% |
| 8 px | 110 | **100.0%** |

**Every one of the 28,463 pixels is within 8 px of a mat pixel, the count
decays monotonically with distance, the peak amplitude is 6/255 on a channel,
and there is no orphan region in any of the 32 panels.** That is an antialiased
edge and it is nothing else. Hiding the mat changes the mat and changes nothing
else — now for a reason rather than by assertion.

### 2.6 A FRAMING DEFECT NOBODY HAD CHECKED, AND WHAT IT CAN AND CANNOT DO

The crop is the union of the object boxes and the measured mat boxes, so it is
drawn **around the paint, not around the road**. Measured as the position of
the three lane centres within the crop:

| | |
|---|---|
| width of the three-lane span, as a fraction of the picture | 0.332 to 0.539 |
| panels where one side is padded more than twice the other | **23 of 32** |
| extremes | left pad 0.162 / right pad 0.492, and 0.491 / 0.163 |

On the worst panels the carriageway sits in half the frame and the rest is
kerb, pavement, railings or water. The reader is told the picture shows three
lanes side by side; on those panels finding them is a real task.

**This cannot bias the mat contrast, because the crop rectangle is identical in
both arms** — it is computed once per gate and both buffers come out of one
evaluation. What it can do is add noise, and it has a specific signature: a
reader who took the kerb for a lane would return **the truth rotated by one
place**, which scores as three wrong demands and reads as a legibility failure
when it is a framing failure. So two things were done rather than one:

1. `PROMPT.txt` now anchors lane-finding — the road has exactly three lanes,
   divided by broken lane lines, and anything beyond the kerb is not one of
   them. **This is arm-neutral: the lane dashes are separate quads from the
   mats and survive in the NOMAT arm**, confirmed on the twin pairs.
2. Rotations are counted separately in the scoring, so a framing failure cannot
   be banked as a mat result.

### 2.7 A LEAK CHANNEL NOBODY HAD CHECKED

A MAT-arm PNG compresses worse than its twin. Across all 32 pairs the MAT file
is the larger one **32 times out of 32** — mean 26,248 bytes against 19,204.
An agent reader can run `ls`.

It is contained, and by two facts rather than one hope. Twins are never in the
same reader's set, so the pairwise comparison is unavailable. And within each
reader's own 16 panels, bytes per crop pixel:

| reader | mat arm | nomat arm | separable? |
|---|---|---|---|
| a | 1.129–1.764 | 0.873–1.389 | no, ranges overlap |
| b | 1.095–1.719 | 0.957–1.391 | no, ranges overlap |
| c | 1.227–1.768 | 0.828–1.337 | no, ranges overlap |
| d | 1.280–1.775 | 0.843–1.455 | no, ranges overlap |

No threshold on file size separates the arms inside any reader's set.

### 2.8 The counterbalancing, which is what killed the last pass's result

The previous pass's confidence table appeared to say JUMP needs its mat and
BLOCK is hurt by one. Both halves were an artefact of reading the two arms with
two *different* readers, and only a within-reader re-run killed it.

So the design is a **Latin square over four conditions** — near+mat,
near+nomat, far+mat, far+nomat — with reader *r* seeing gate *i* in condition
`(i + r) mod 4`. Re-derived from the master key rather than taken from the
tool's own assertion:

1. **Every reader sees both arms and both distances in equal number** — 4
   panels in each of the 4 conditions. The mat contrast lives *inside* each
   reader, so temperament cancels.
2. **Every gate is seen once in every condition** across the four readers, so
   no condition carries an easier set of gates.
3. **No reader sees the same gate twice.** A reader shown the same road at
   25.35 and again at 32 is not making an independent second judgement, and if
   the two looks straddled the arms they would be being shown the same road
   with and without paint.

Readers are **uncontaminated** — four sessions created against parentless
branches holding 16 panels and `PROMPT.txt` and nothing else. Verified: each
commit has **0 parents** and each tree has **17 entries**. No source, no
`CLAUDE.md`, no repository to leak vocabulary from. Recipe from roadmap entry
63, implemented as `lanechoice-sets.js --push`.

    lc3-reader-a  8c7f29d69f3485516549f22179290fc6c1d0e359
    lc3-reader-b  33e5b956fa39954a8116fb1f5d3dad80dd40d79f
    lc3-reader-c  af73a02a8ae9a8f511aa33c55aea7ffd524827f6
    lc3-reader-d  447e90211aa6e31cc04c19eb404dccb5d680f830

**Never merge them.**

### 2.9 The question the readers were asked

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

## 2.10 The mat is a complete colour code for the answer

This is the fact that decides what a null result would *mean*. Measured on the
mat masks themselves at `READ_NEAR`:

| kind | demand | lanes | mat px | mean RGB as drawn |
|---|---|---|---|---|
| JUMP | OVER | 13 | 21,549 | 125, 112, 87 — warm |
| DUCK | UNDER | 13 | 23,193 | 87, 117, 132 — cyan |
| BLOCK | AROUND | 7 | 14,423 | 124, 82, 103 — magenta |

Three cleanly separated hues, distinguished by channel ordering rather than by
brightness. **The mat, on its own, is a sufficient answer to question 2.** So
if the arms score the same, the finding is not that the mat is uninformative —
it is that **the object carries the same information, redundantly, and gets
there first.**

---

## 3. The result

*(readers A and C in; B and D pending. Numbers below are two of four readers.)*

### 3.1 Accuracy, per arm

| reader | mat ON | mat OFF | total | panels fully correct |
|---|---|---|---|---|
| A | 15/15 | 18/18 | **33/33** | 16/16 |
| B | 18/18 | 15/15 | **33/33** | 16/16 |
| C | 9/15 | 14/18 | 23/33 | 7/16 |
| D | 18/18 | 15/15 | **33/33** | 16/16 |
| **pooled** | **60/66 (91%)** | **62/66 (94%)** | 122/132 | 55/64 |

And split by distance, which is the other half of the question:

| arm | 25.35 u | 32 u |
|---|---|---|
| mat ON | 30/33 (91%) | 30/33 (91%) |
| mat OFF | 31/33 (94%) | 31/33 (94%) |

**Three of the four readers are perfect in both arms** — 33 of 33 occupied
lanes, 16 of 16 panels, with and without paint, near and far. Reader C is 23
of 33 and its **mat arm is the worse one**, 60% against 78%.

The arm totals are exactly balanced by construction — 66 cells each, 33 at
each distance — so the 91% against 94% is a like-for-like comparison and not an
artefact of one arm drawing easier gates. §2.4 records that the four conditions
hold identical composition down to the variant count.

CLEAR lanes are **60/60**, 100% in both arms: nobody ever hallucinated a hazard
into an empty lane.

**Lane choice is 64 of 64 viable — 16/16 in every one of the four conditions.**
This is the only column that corresponds to a lost run under rule 4, and it is
perfect everywhere, with and without paint, near and far.

### 3.2 Every one of reader C's errors is the same error

| truth → said | count | where |
|---|---|---|
| OVER → AROUND | **10 of 10** | JUMP v0, v1 ×2, v2 ×3, v4 ×3, v5 — both distances |

Ten errors, one shape, one kind. Reader C read jumpable hurdles as walls.
**Six of the ten had the mat ON**, and the JUMP mat is gold and means OVER. The
paint was present, it was correct, and it was overruled.

### 3.3 WHY IT WAS OVERRULED, WHICH IS AN ARTEFACT OF THIS EXPERIMENT

Reader C derived the code correctly and then threw it away. Verbatim:

> *"Several images also have a coloured 'wash' laid over a lane's tarmac —
> cyan, gold or pink. I initially took these for signage (cyan = duck, gold =
> jump) and it fits the first few images, but it breaks down: `9d2f0312` has a
> gold wash ending in cones and a pink one ending in a truck, and `0f0acb83`
> and `5500c318` have no wash at all next to perfectly ordinary obstacles. So I
> treated the washes as lighting that merely flags 'something is in this lane'
> and made every actual call from the object itself."*

**`0f0acb83` and `5500c318` are NOMAT panels.** They are the treatment. A
reader cannot know an arm exists, so a set in which half the hazards have paint
and half do not is a set that teaches the reader **the paint is unreliable**,
and this reader duly stopped using it.

That is a cost of the within-reader counterbalancing — which was itself the fix
for the previous pass's between-reader temperament confound. **The mat-ON arm
in a counterbalanced set is read by somebody who has learned to distrust
paint.** The previous design, all-mats-hidden, did not have this problem and
had the temperament confound instead. There is no design here that has neither,
and that should be said out loud rather than discovered again next pass.

Reader A hit the same fork and went the other way, which is why the pair is
worth having. Verbatim:

> *"I did not rely on this alone; I identified each object on its own merits
> first and used the glow as a cross-check. Where they were both present they
> always agreed."*

Both readers, independently, **decoded the colour code correctly from the
pictures alone** — gold over, cyan under, magenta around. Neither needed to be
told. And both then made the call from the object.

### 3.4 The far mat is seen and used, and changes nothing

Reader A's four `far+mat` panels at 32 units were all described in terms of the
paint — *"two gold strips side by side"*, *"which glows cyan"*, *"a magenta
strip"*, *"cyan strip and gantry over the left lane"*. So at 32 units the mat
is **not too faint to read**; it is read, and the answer is the same either way.

### 3.5 Confidence — a one-reader effect that did not survive the second reader

Reader A looked like a result: **8 of 8 "sure" with the mat, 4 of 8 without**,
and all four of its hedged answers were NOMAT panels.

**Reader B runs the other way.** It hedged five, and **four of the five are MAT
panels**. And with all four readers in, the split is exact:

| reader | sure, mat ON | sure, mat OFF | direction |
|---|---|---|---|
| A | 8/8 | 4/8 | mat makes it surer |
| C | 8/8 | 5/8 | mat makes it surer |
| B | 4/8 | 7/8 | mat makes it *less* sure |
| D | 4/8 | 7/8 | mat makes it *less* sure |
| **pooled** | **24/32** | **23/32** | **nothing** |

**Two readers each way, and one cell of difference in 64.** Confidence is
temperament, exactly as the previous pass found, and the lesson repeats with a
sharper edge: **had this pass stopped at reader A it would have reported "the
mat makes players surer" — the previous pass's exact error — and had it stopped
at reader B it would have reported the opposite with equal conviction.** The
within-reader design is not what rescued this; only the *fourth* reader made
the split unambiguous.

### 3.5b THE MAT TEACHES THE OBJECT, AND THAT IS THE ONE THING IT DEMONSTRABLY DOES

Reader B, unprompted:

> *"I did not use the tint to decide anything on its own; I read the objects
> first and used the tint only as a cross-check. It agreed every time. It was,
> however, genuinely useful for one thing: it settled the blue plastic barriers
> and the red/white trestle barrier as **jumpable rather than dead ends**,
> because both of those exact sprites appear gold-tinted in `f8123696` and
> `ce3eb8d9` respectively. That let me classify the same sprites consistently
> in the untinted pictures (`191bb0ff`, `bc22e0f5`, `7f0cce4f`)."*

`f8123696` and `ce3eb8d9` are **MAT** panels. `191bb0ff`, `bc22e0f5` and
`7f0cce4f` are **NOMAT** panels. And on one of them B wrote that its readings
*"rest on the sprite match and on their height rather than on anything the
image states."*

**Those are the same sprites reader C read as walls, ten times over.** B took
the mat's teaching and scored them; C refused the teaching and lost them. So
the mat is not decoration — but the job it is doing is **teaching which low
object is jumpable**, once, rather than answering a question at every
encounter. After the association is made the object carries it alone.

This is also a **second artefact of the within-reader design, running opposite
to reader C's.** C's arm-mixing destroyed trust in the mat and depressed the
MAT arm; B's arm-mixing let the mat tutor the NOMAT arm and inflated it.
**Both known artefacts of this design bias toward the conclusion that the mat
does nothing** — which is the direction a null result must be discounted
against.

### 3.5c The framing defect did not bite — measured, not hoped

Nine panels came back not exactly right across all four readers and 64 panels,
and **zero of them are a one-lane rotation of the truth**. Every miss is a single lane called
wrong in place, never the whole triple shifted. So the §2.6 crop problem — the
one real nuisance in the design — **did not manifest**, and the lane anchor
added to `PROMPT.txt` did its job. Readers described finding the lanes exactly
as intended: *"Edge line, two broken purple lines, edge line: three lanes, with
grass banks and railings outside them."*

### 3.6 By kind, and the three new DUCKs

| kind | mat ON | mat OFF | total |
|---|---|---|---|
| DUCK | 26/26 | 26/26 | **52/52 — 100%** |
| BLOCK | 14/14 | 14/14 | **28/28 — 100%** |
| JUMP | 20/26 | 22/26 | 42/52 |

**DUCK and BLOCK are at ceiling in both arms at both distances — 13/13 and 7/7
in every single cell of the arm × distance grid. Every error in the entire test
is a JUMP.**

Per variant, and this is what the pass was asked to check:

| DUCK | mat ON | mat OFF | total |
|---|---|---|---|
| v0 | 4/4 | 4/4 | 8/8 |
| v1 | 6/6 | 6/6 | 12/12 |
| v3 | 2/2 | 2/2 | 4/4 |
| v4 | 4/4 | 4/4 | 8/8 |
| **v5 access gantry** | 4/4 | 4/4 | **8/8** |
| **v6 floodlight gantry** | 4/4 | 4/4 | **8/8** |
| **v7 girder underbridge** | 2/2 | 2/2 | **4/4** |
| established v0–v4 | 16/16 | 16/16 | **32/32** |
| **new v5–v7** | **10/10** | **10/10** | **20/20** |

| BLOCK | mat ON | mat OFF | total |
|---|---|---|---|
| v0 | 4/4 | 4/4 | 8/8 |
| v3 | 4/4 | 4/4 | 8/8 |
| v5 | 2/2 | 2/2 | 4/4 |
| v7 | 2/2 | 2/2 | 4/4 |
| **v9, the low moped** | 2/2 | 2/2 | **4/4** |

**`BLOCK v3` — the variant entry 61 caught reading OVER and entry 63 could not
reproduce — is 8 of 8 here**, in a three-lane gate, in both arms, at both
distances. It did not reappear.

**The three new DUCKs read exactly as well as the five they joined** — not one
error by any reader, in either arm, at either distance. **This is the first
test that has ever contained them**, because the previous pass pinned a commit
older than the one that built them. Nothing here asks for a fourth pass on
DUCK.

**BLOCK is at ceiling, including `v9`, the moped** — the low one, the 1-of-26
`kindread` miss, the variant with daylight under it. The height failure in this
test runs the *other* way: not a low BLOCK mistaken for passable, but a JUMP
mistaken for impassable.

### 3.7 WHAT THE JUMP FAILURE ACTUALLY IS, LOOKED AT RATHER THAN INFERRED

`a3d19dc1` is the panel where reader C lost two cells at once. At 32 units the
middle lane holds a blue water-filled barrier and the right a red trestle, both
sitting flush on the road, and **both under plainly visible gold paint that
correctly says OVER**. The reader's own words:

> *"Both are solid to the ground, neither has any clearance. The left lane is
> the unlit one and it is empty, so it is the only lane I can actually run."*

**That description is accurate. The inference is what fails.** A JUMP *is*
solid to the ground — the thing that separates it from a BLOCK is not clearance
underneath but **height**, and reader C was applying a rule it stated up front,
that an obstacle "too tall to clear at running speed" must be gone around. It
put the threshold in the wrong place and lost ten cells to it.

So the one place in this entire test where the mat could have changed an
answer, **it was present, it was correct, and it was disregarded** — because
this experiment's own counterbalancing had taught that reader to disregard it.
That is the strongest caveat on the recommendation below and it is stated
before the recommendation rather than after.

**And it is disregarded out loud.** Reader C names the gold paint in the very
sentence in which it contradicts it, over and over:

> *"Two gold-lit strips fall in the middle and right lanes and both end in
> something solid... **Neither can be jumped or ducked.**"*

> *"The middle lane has a gold strip ending in a group of four orange and white
> cones spread across it, **which closes it**."*

> *"The right strip ends in a solid blue block with a pink and white striped
> skirt at road level, **chest high with no opening at all, so that lane is
> out**."*

### 3.8 THE ONE REAL LEGIBILITY PROBLEM THIS TEST FOUND IS JUMP HEIGHT

Strip the mat question away and a finding is left over that nobody asked for.
Reader C's language is consistent across all ten misses — *"chest high"*,
*"well above waist height"*, *"waist to chest high and packed solid"*, *"solid
to the ground"*. **It is reading JUMP obstacles as chest-high walls**, and it
does so for cones, trestles, blue barrier blocks, pipe stacks and rubble heaps
alike, at both distances, with and without paint.

`MR.Collision.BOX` is the contract and art never decides clearance — but art is
all a player has to judge by, and **one reader in four judged the art of a
JUMP to be impassable**, on 10 of the 52 JUMP cells in the test. That is a
hazard-legibility problem in its own right, it is the only one this pass found,
and it belongs to whoever owns the JUMP fleet rather than to the mat question.

The variants it lost are spread across the kind rather than concentrated in
one: **`JUMP v0` 3/4, `v1` 6/8, `v2` 9/12, `v4` 9/12, `v5` 3/4** — and `v3`
alone is **12/12**, untouched by any reader. So this is not one bad object; it
is a threshold one reader put in the wrong place, and `v3` is the shape that
never triggered it.

**It never cost a run.** Every single one of reader C's ten errors is recorded
`viable true`: reading a JUMP as a wall makes you *avoid* a lane you could have
taken, which costs an action, not an attempt. Across all four readers,
**lane choice is 64 of 64 viable — 16/16 in every one of the four
conditions**, and nobody ever picked a lane that ends a record attempt.

---

## 4. How much paint there is, by distance — re-measured on the fleet of 26

The fade decision rests on a ratio, so the ratio was re-measured independently,
frame-wide and crop-independent, over 8 gates and 19 occupied lanes at five
distances:

| distance | mat px per occupied lane | vs `READ_NEAR` | whole gate |
|---|---|---|---|
| 8 u | **29,830** | **17.45×** | 70,846 |
| 12 u | 20,757 | 12.14× | 49,299 |
| **25.35 u (`READ_NEAR`)** | **1,710** | **1.00×** | 4,061 |
| 32 u | 812 | 0.47× | 1,928 |
| 40 u | 415 | 0.24× | 986 |

**The published 18× figure is confirmed at 17.45×**, and the mat is **71.8×
heavier at 8 u than at 40 u**. The `READ_NEAR` figure of 1,710 px per lane
reproduces to the pixel against the previous pass, which measured it on a
*different build* (`b9b2170`, before the three new DUCKs) and a *different gate
sample*. The absolute counts in `docs/staleness-and-mats.md` (648 px at 25 u)
remain low by roughly 3×, because they were counted inside a crop that cut the
mat off.

---

## 5. What is not settled

**THE READERS ARE MORE DELIBERATE THAN A PLAYER, AND THIS IS THE LIMIT THAT
MATTERS MOST.** Every one of the four cropped panels apart, upscaled them and
examined lanes individually — one was reading `4e43dee0_L.png`, a single lane
of a single gate, enlarged. A player at `READ_NEAR` has a fraction of a second
and no zoom. Unlimited time pushes **both** arms toward ceiling and therefore
**compresses any mat effect toward zero**, so this design is systematically
biased against finding that the mat helps. A null result here bounds how much
the mat can be worth to a careful reader; it cannot prove the mat is worthless
to a glancing one. That asymmetry runs against the conclusion and it is the
first thing a future pass should attack — the obvious attack is an exposure
limit, which this harness cannot currently impose.

**The panel is not the frame.** Other gates, the runner and the ghost are taken
off the road. That isolates the gate under test, and it removes help that is
*not* the mat — roadmap entry 63 recorded a BLOCK whose correct answer came
entirely from a lorry parked in an adjacent gate. So it makes the mat's job
easier to see, not harder. But it also removes the runner, which is the
player's own anchor for which lane he is in, and that interacts with the
framing defect in §2.6.

**The crop is drawn around the paint, not the road.** §2.6 measures it and
§2.6 states why it cannot bias the arm contrast, but it is still the largest
uncontrolled nuisance in the design, and the right fix is a crop cut to the
carriageway rather than to the union of the object and its mat.

**Sixteen gates is a sample of one course on one date.** The gates are drawn
mechanically, which removes selection bias but not sampling variance, and
`BLOCK` is the thinnest kind here at 7 occupied lanes per condition.

**Readers are agents reading PNGs, not people playing.** They can and did
inspect pixel values numerically. For the mat that cuts against a null result
rather than for it — a reader who samples colour numerically has *more* access
to the mat's colour code than a player does, so if such a reader gains nothing
from the paint, a player gains no more.

**THE SCORER'S PAINT-MENTION COUNTER DOES NOT MEASURE WHAT IT CLAIMS, AND ITS
NUMBER SHOULD NOT BE QUOTED.** `lanechoice-score.js` counts answers containing
paint-like words and reports **11/24 with the mat against 12/24 without** — an
apparently perfect null. It is an artefact of the word list. `stripe` and
`striped` describe the *barricades* (*"a red-and-white striped board"*), and
`marking`/`markings` describe the **lane dashes**, which are present in both
arms by design. So the counter fires just as often on NOMAT panels, and it
cannot distinguish a reader talking about the mat from one talking about a
barrier's paintwork. The qualitative reading of the notes in §3.3 and §3.5b is
doing all the work that this column pretends to; the column should be re-cut
against the mat's own colour vocabulary or dropped.

**Nothing here tests the mat's other jobs.** The mat may be doing work this
test does not ask about — reading the road's *speed*, marking where a gate
begins for timing rather than for choice, or simply looking like a road that
has been prepared for a race. This pass measured the decision only.
