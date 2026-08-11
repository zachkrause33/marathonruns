# The near-band colour gap: what it is, what causes it, and what a fix costs

**BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT.** Every object is modelled
on all sides, fully, always. A marking PAINTED on a surface is the one
exception, because it is not an object. This brief is about markings and about
the road they lie on, so the exception is the subject — but nothing below
licenses a half-built anything.

Diagnosis only. No file under `src/` was edited to produce any number here.

---

## 0. The answer in five lines

1. **The gap is real, and it is bigger than the figure on record.** Near-band
   saturation is **46% below** Subway Surfers, not 33%; measured in chroma
   rather than HSV it is **68% below**, and in *area of vivid pixels* it is
   **93% below**.
2. **It lives in the near band and almost nowhere else,** and inside the near
   band it lives in the **play surface**: the road and its markings win **90.4%
   of the bottom third of the frame**.
3. **The cause is the authored palette, not any lighting stage.** Replacing the
   entire lit pipeline with unlit albedo — no toon ramp, no hemisphere, no fog,
   no ink — moves near-band chroma from 0.066 to **0.076**. The whole of the
   shading is worth 0.010 of a 0.217 shortfall. The toon ramp, the hemisphere
   fill, the fog and the ink outlines are all **ruled out by experiment**.
4. **The road itself cannot be the fix.** Its chroma is capped by the fairness
   gate: **two hazard variants fail the build** before it reaches half the
   reference's chroma.
5. **The road MARKINGS are a free lever and nobody has pulled it.** They are
   34% of the near band, every one of their seven authored tones is a grey, and
   they are **not in the patch the fairness gate measures** — so their chroma
   can be raised with the gate margins unchanged **to three decimal places**.

---

## 1. How this was measured, and what it is measured against

Every frame is the **live page** (`index.html` at `?bot=1&date=2026-08-10&skip=N`),
never a build artefact, at **620x1344 with the HUD hidden** — the framing
`tools/shoot.js` calls *"the shape the game is actually played in"* and the one
every clarity figure on record was taken at. The date is **pinned**, because the
course regenerates daily and an unpinned comparison is between different legs.

`?skip=` is race SECONDS and the leg it lands on depends on the day AND the boot
flags, so **every tool written for this pass prints the leg it measured**, read
out of `MR.Course.biomeAt()` after boot. That is the fix `docs/roadmap.md` asked
for after an hour was lost to hand-attached leg labels, and it is why the tables
below can be checked.

Measurement was taken in a **detached worktree at HEAD (5f9bb3a)**, not in the
shared tree, because two other agents are editing `world.js` and `main.js` right
now and a half-applied edit is not the build. `node tools/build.js --check`
reports `up to date` there, and no page threw in any of the ~60 loads below.

| leg | skip | mile | draws | tris |
|---|---|---|---|---|
| CITY START | 25 | 2.38 | 186 | 246,285 |
| RIVERSIDE | 60 | 6.13 | 208 | 224,302 |
| THE BRIDGE | 95 / 110 | 10.06 / 11.74 | 168 / 166 | 206k |
| PARKLAND | 140 | 15.15 | 217 | 268,265 |
| THE WALL | 178 / 200 | 19.47 / 22.05 | 243 / 209 | 244k / 198k |
| FINAL MILE | 230 | 25.52 | 189 | 259,413 |

### The instruments, and the defects found in them

Four tools were written. All four are in `tools/` and all four were attacked
before they were believed.

- **`tools/chroma.js`** — screenshot colour, four metrics, by screen band.
  `--audit` runs a self-test against synthetic frames whose answer is known by
  construction. It passes, and it **exposes a confound in `clarity.js`**: a
  1-pixel red/cyan stripe field measures chroma 1.000 natively and **0.000**
  after `clarity.js`'s resample to 520px. The resample averages complementary
  neighbours into grey. Our frames are 620 wide (0.84x, mild); Tom Gold Run's
  are 1206 wide (0.43x, heavy). **The resample therefore penalises the
  reference, not us** — the direction that does *not* flatter this build, so
  the gap below is if anything understated.
- **`tools/chromashot.js`** — capture, HUD off, leg printed, date pinned.
- **`tools/chromadepth.js`** — depth bands, per-system attribution and the
  lighting-stage ablations, through the game's own renderer. It ships a
  **`control` mode that runs the whole ablation plumbing and changes nothing**;
  it reproduces `shipped` to within 0.002 on every figure, which is what makes
  the other rows admissible.
- **`tools/roadchroma.js`** — the candidate fix against the fairness gate, both
  sides in one table. **Its first version was wrong in this project's signature
  way and was caught before it was trusted**: it swept the road markings by
  scaling `mats.paint.color`, which is `0xffffff` with vertex colours on. Every
  actual tone lives in the geometry's colour attribute, so scaling white toward
  its own grey returned white and the tool printed **six identical rows** — a
  no-op that would have read as "repainting the markings changes nothing". Same
  family as counting a source hex 43 times. It now scales the attribute. A
  second defect: its paint-finder tested absolute height and found **zero**
  paint meshes, because `elevation.js` puts the carriageway wherever the hill
  is — at skip 25 the road sits at y 1.49–2.82, not at zero.

All four reconcile with `clarity.js`, the instrument on record: near-band
saturation agrees to three decimal places on every frame.

---

## 2. The gap is real, and it is bigger than 33%

Near band = bottom third, HUD off. Ours is eight legs on the pinned course;
the reference is **every** Subway Surfers frame in `reference/`, printed
individually. `chroma.js` prints min/median/max and never a mean of a subset,
because *"every reference sits at 0.73–1.28"* was a seven-image subset of a real
range and had to be withdrawn.

| leg | near S | near chroma | near LCh C* | near vivid% |
|---|---|---|---|---|
| CITY START | 0.183 | 0.066 | 9.6 | 1.8 |
| RIVERSIDE | 0.242 | 0.094 | 12.1 | 6.4 |
| THE BRIDGE 95 | 0.263 | 0.093 | 12.0 | 1.7 |
| THE BRIDGE 110 | 0.357 | 0.214 | 19.4 | 30.4 |
| PARKLAND | 0.171 | 0.062 | 8.9 | 1.9 |
| THE WALL 178 | 0.295 | 0.126 | 15.5 | 12.6 |
| THE WALL 200 | 0.161 | 0.055 | 8.7 | 0.1 |
| FINAL MILE | 0.294 | 0.125 | 17.5 | 8.6 |
| **ours, median** | **0.253** | **0.093** | **12.1** | **4.2** |
| `ss-run-01` | 0.490 | 0.335 | 34.7 | 53.2 |
| `ss-run-02` | 0.413 | 0.274 | 29.7 | 51.5 |
| `ss-run-03` | 0.492 | 0.293 | 33.8 | 66.4 |
| `ss-jump-01` | 0.430 | 0.263 | 35.2 | 59.4 |
| **Subway, median** | **0.460** | **0.283** | **34.3** | **56.3** |
| **shortfall** | **−45%** | **−67%** | **−65%** | **−93%** |

Medians are the true median of the values listed. `chroma.js`'s family summary
prints the upper median for even counts, so its `BY FAMILY` line reads 0.263 /
0.490 where the table above reads 0.253 / 0.460; both are in the output and
neither changes a verdict. Section 2 reads the PNGs; sections 3-5 read the GL
buffer directly, which is why the same frame can differ by 0.003 between them.

On the metric the figure on record uses — mean near-band HSV S — ours is
**0.245** against Subway Surfers' **0.456**: **46% below**, worse than the 33%
last written down. Whole-frame: 0.290 against 0.442, **34% below**.

**The gap survives all four metrics, so it is not an artefact of any one of
them.** It is largest on `vivid%` — the share of pixels that are both colourful
and bright — which matters, because roadmap entry 30 established that *area of
saturated bright* is the only lever that has ever moved the hazard gate. It is
also the metric on which we are 93% short.

Three notes on what the reference numbers are and are not:

- **Sonic is not a band.** Two frames, 0.254 and 0.638 near S. Quoting a Sonic
  "band" from two frames that far apart would be the 0.73–1.28 error again.
- **Temple Run is not a target** (framing only, per `MEASUREMENTS.md`), and its
  high near S (0.60–0.87) is an artefact of HSV on a very dark frame — its
  *chroma* is 0.242–0.316, no better than Subway Surfers.
- **The Tom Gold Run and Gold Run near-band figures in the family summary are
  contaminated and should not be quoted.** `tgr-city` carries pure-white padding
  rows (chroma 0.000, L 0.988–1.000) at the top and bottom of the image, and
  five `ttgr-*` frames return a 90th-percentile chroma of exactly 0.122 — the
  "a sweep that returns suspiciously consistent numbers is repeating, not
  converging" signature. **The Subway Surfers set is the one this finding rests
  on, and it is uncontaminated: cropped to the game viewport at 520px, no
  padding, HUD at the top and therefore outside the near band.**

---

## 3. Where it lives: the play surface, and only the play surface

By depth, at CITY START (the cuts `docs/clarity-pass.md` used):

| band | pix% | S | chroma | L | vivid% |
|---|---|---|---|---|---|
| <8u foreground | 32.1 | 0.201 | 0.076 | 0.311 | 4.0 |
| 8–30u immediate obstacles | 24.6 | 0.220 | 0.075 | 0.332 | 4.0 |
| **30–90u read window** | 10.8 | **0.429** | **0.177** | 0.327 | 14.1 |
| 90–235u environment | 4.3 | 0.102 | 0.061 | 0.654 | 1.7 |
| >235u distant / sky | 28.3 | 0.221 | 0.173 | 0.691 | 21.6 |

**The read window is the most colourful band in the frame.** That is the band
hazards are committed to in, and it is doing its job — this is not a hazard
problem. The 90–235u environment band is the one the fog genuinely flattens
(S 0.102), and it is **4.3% of the frame**.

Inside the near screen band, by system (geometry cluster, correct occlusion,
percentages of the whole frame; the near band is 33.3%):

| pix% | S | chroma | L | vivid% | meshes | what it is |
|---|---|---|---|---|---|---|
| **18.88** | 0.125 | **0.042** | 0.308 | 0.0 | 11 | **the tarmac** — `mats.road`, `#65636d` + vertex lane bands |
| **11.21** | 0.207 | **0.074** | 0.315 | 0.0 | 11 | **the markings** — `paintGeo`, `mats.paint` |
| 3.2 (role) | 0.471 | 0.178 | 0.288 | 17.7 | — | the runner |

**Two clusters are 90.4% of the near band and both render at essentially zero
vivid pixels.** The runner is the only colourful thing down there and he is 3.2%
of it. Subway Surfers' near band is a crimson train roof at chroma **0.424** —
their play surface *is* the colour. Ours is a grey one with the character on it.

The pixel histogram states it without any modelling: **93.4% of our near band at
CITY START has chroma below 0.1**, against **22.0%** for `ss-run-01`, which puts
24.8% of its near band above chroma 0.6.

---

## 4. The cause: it is the palette, and the lighting is exonerated by experiment

Same frozen frame, one stage removed at a time, a fresh page load per mode so no
undo can leak. Near band, CITY START:

| mode | near S | near chroma | vs shipped |
|---|---|---|---|
| **shipped** | 0.186 | **0.066** | — |
| control (plumbing, no change) | 0.184 | 0.066 | 0.000 |
| **albedo — every lit material unlit, authored colours drawn flat** | 0.180 | **0.076** | **+0.010** |
| `nofog` | 0.184 | 0.066 | **0.000** |
| `noink` | 0.182 | 0.066 | **0.000** |
| `whitelight` (all light colours forced white) | 0.180 | 0.073 | +0.007 |
| `rampwhite` (flat ramp, plain lambert) | 0.181 | 0.071 | +0.005 |
| `rampfloor` 0.31 → 0.60 | 0.184 | 0.067 | **+0.001** |
| `nohemi` | 0.164 | 0.053 | **−0.013** |
| `nobounce` | 0.156 | 0.052 | **−0.014** |
| `keyonly` | 0.157 | 0.047 | **−0.019** |

Read down that column:

- **The entire lighting pipeline costs the near band 0.010 of chroma.** Take the
  lights out completely and you get 0.076 against a reference 0.284. **The
  authored palette is the ceiling, and the ceiling is already the floor.**
- **The fog is exactly zero here, and that is not a surprise — it is a
  prediction that came true.** `FOG_NEAR` is 60 units and the near band's mean
  depth is **5.6 units**. A linear fog contributes nothing below `near`. This is
  the strongest kind of ablation: one that *must* move nothing, and does not. It
  also disposes of the standing suspicion — the fog is a real effect in the
  90–235u band (4.3% of pixels) and it is not the near-band defect.
- **The ink outlines cost zero.** `INK.prop`, `.scenery` and `.banner` are
  already 0; nothing in the near band carries a shell except the runner.
- **The hemisphere fill and the cool bounce are ADDING chroma, not eating it.**
  Removing them makes the near band worse by 0.013 and 0.014. The suspicion was
  not merely unsupported, it was backwards — same shape as the character-to-
  ground claim `clarity-pass.md` §8 had to retract.
- **Raising the toon ramp's floor, the fix `shading.js` signposts in its own
  header, buys +0.001.** That header's reasoning is sound for the objects it was
  written about (a hazard's read face at 40–90 units, in the read window). It is
  not a lever on the near band, because the near band is a horizontal surface
  taking the full key and the full sky fill — it is already at the top of the
  ramp.

**So the stage that is eating the saturation is the one before the renderer.**

### The palette, named

`mats.road`'s colour is the setting's `road` hex. Every one of the eighteen city
settings and six biome fallbacks:

| set | chroma range | luminance range |
|---|---|---|
| `BIOME_LOOK` fallbacks (`world.js:225–256`) | 0.102 – 0.161 | 0.392 – 0.393 |
| **`SETTING_LOOK`, what every real frame uses** (`world.js:599–820`) | **0.039 – 0.086** | **0.391 – 0.393** |

Two things fall straight out of that table.

**Every road in the game sits at luminance 0.391–0.393, to three decimal
places.** This palette was authored against a luminance target, and the header
above it says so at length and correctly: the play surface has to stay the
lightest large mass in frame or the eye goes to the grass banks. That work was
done and it holds.

**The same header says the roads were "given chroma per biome", and the set that
superseded it has half the chroma of the set it replaced.** When `BIOME_LOOK`'s
role narrowed to "the fallback for a course with no settings on it" and
`SETTING_LOOK` took over, road chroma went from a 0.126 mean to a **0.067**
mean, and nobody re-measured. Today's CITY START road is `#65636d` — chroma
**0.039**, which is a grey with a rounding error in it.

The markings are worse, and they are worse in a way that is easier to fix.
`paintGeo` is 62.4 flat square units per tile in **seven** authored tones:

| area | tone | hue | chroma | luminance |
|---|---|---|---|---|
| 27.0% | `#313040` | 243.8° | 0.063 | 0.194 |
| 20.0% | `#b3b4bc` | 233.3° | 0.035 | 0.707 |
| 16.9% | `#504d61` | 249.0° | 0.078 | 0.310 |
| 14.4% | `#272636` | 243.8° | 0.063 | 0.154 |
| 11.5% | `#807c97` | 248.9° | 0.106 | 0.497 |
| 6.6% | `#69696f` | 240.0° | 0.024 | 0.413 |
| 3.5% | `#9d9885` | 47.5° | 0.094 | 0.595 |

**Not one authored tone in the near-band play surface exceeds chroma 0.106.**
The reference's play surface is 0.424. That is the finding.

---

## 5. What a fix costs, and what it would break

### The road is capped by the fairness gate — measured, not argued

`tools/roadchroma.js` scales the road's distance from its own luminance-grey by
k, which **preserves luminance exactly** (the luminance of `rgb − grey` is zero
by construction), and runs the game's own `api.contrastAudit` against the live
`mats.road` at every step — the same numbers `tools/shoot.js` gates on.

CITY START:

| k | road hex | authored chroma | near chroma | build failures | short of target |
|---|---|---|---|---|---|
| 1 (shipped) | `#65636d` | 0.039 | 0.066 | 0 | 5 |
| 1.5 | `#656271` | 0.059 | 0.073 | 0 | 5 |
| 2 | `#666276` | 0.078 | 0.081 | 0 | 8 |
| 2.5 | `#66617a` | 0.098 | 0.089 | 0 | 10 |
| **3** | `#67617f` | 0.118 | 0.097 | **2** | 10 |
| **4** | `#686088` | 0.157 | 0.114 | **6** | 17 |

THE WALL is tighter still: **k = 2 already fails one variant.**

The mechanism is exact and worth recording. The gate is
`max(L-ratio/1.25 − 1, dS/0.22 − 1)`, so a hazard passes on **either** value or
chroma. JUMP v5 sits at an L-ratio of **1.02** against the centre lane and has
always passed purely on `dS`. Lifting the centre lane's S from 0.095 to 0.174
cuts its `dS` from 0.267 to 0.201 and it fails. The centre lane is the binding
one — it wears the biome colour neat, so it has the *lowest* saturation of the
three (0.095 against lane 0's 0.236) and the least room.

**So the road can be given back roughly the chroma the `BIOME_LOOK` set had
(k ≈ 1.5, chroma 0.059–0.082) and no more. That is worth +0.007 to +0.010 of
near-band chroma. It is real, it is free, and it is nowhere near enough.**

### The markings are free, and that is the finding

The gate's road patch is built from `laneBand()` on `mats.road` — **tarmac
only.** `paintGeo` is not in it. Sweeping the markings' chroma at CITY START,
THE WALL and the FINAL MILE:

| paint k | near S | near chroma | near L | near vivid% | build failures | short of target | tightest variant |
|---|---|---|---|---|---|---|---|
| 1 (shipped) | 0.186 | 0.066 | 0.309 | 1.7 | 0 | 5 | JUMP v2 **+0.087** |
| 2 | 0.220 | 0.085 | — | 1.7 | 0 | 5 | JUMP v2 **+0.087** |
| 3 | 0.249 | 0.104 | 0.307 | 11.9 | 0 | 5 | JUMP v2 **+0.087** |
| 4 | 0.277 | 0.124 | 0.306 | 12.3 | 0 | 5 | JUMP v2 **+0.087** |
| 6 | 0.305 | 0.152 | 0.304 | 29.9 | 0 | 5 | JUMP v2 **+0.087** |

**Every hazard margin is identical to three decimal places at every k, at every
leg.** Not "within tolerance" — identical, because the quantity is structurally
independent of the markings. Twelve variants, three legs, six steps.

And the luminance is preserved by construction: near-band L moves 0.309 → 0.304
(1.6%, all of it clamping). Which means **the edge density barely moves either**
— `clarity.js` Sobels on luminance. Measured on the same frames: near-band edge%
**7.2 → 7.7**, i.e. it drifts *toward* the Subway Surfers band of 9.3–12.7
rather than away from it.

**More colour, the same edges, the same luminance architecture, zero draw calls,
zero triangles, and the fairness gate does not move.** That is the outcome the
"clarity over complexity" tie-breaker was supposed to produce, and this is the
first lever found that produces it without a trade.

### What it WOULD break, and the guard that stops it

A blind chroma multiplier breaks the one rule `world.js` states about this
surface, and the render proves it rather than the argument doing so. At k = 4
the 3.5% tone `#9d9885` — hue **47.5°** — becomes a saturated gold lane dash.
The JUMP telegraph mat is `#ffc23a`, hue **41.4°**. **Six degrees apart.** The
lane dashes start looking like the device a race is lost by misreading, and
`world.js` says so in advance: *"the mats own amber, cyan and pink at full
saturation and they are the device a race is lost by misreading... these are
tints of the road's own hue and must never be mistaken for a fourth colour
language."* This project has already had to move a road marking off a hue for
exactly this reason — the racing line collided with the aid pickups at ten
degrees and a blind reader could not tell them apart.

The hues the game already speaks with, measured off the shipped materials:

| language | source | hue |
|---|---|---|
| JUMP telegraph | `#ffc23a` (`world.js:6760`) | 41.4° |
| HUD accent / world gold | `#ffe45e` | 49.9° |
| aid pickup family | `#86eec0` / `#2fd39a` | 153.5° / 159.1° |
| DUCK telegraph | `#4fdcff` (`:6761`) | 191.9° |
| BLOCK telegraph | `#ff4f78` (`:6762`) | 346.0° |

**Six of the seven paint tones — 96.5% of the painted area — sit at hue
233°–250°, blue-violet, which no language owns.** The racing line that used to
own violet was deleted (`c14b3c8`, `5bd7cf8`), so that hue is genuinely free.
Only the 3.5% warm tone collides.

`tools/roadchroma.js --guard 25` refuses chroma to any tone within 25° of a
spoken hue. It costs almost nothing, because the offending tone is 3.5% of the
area: at k = 4, guarded near chroma is **0.118** against an unguarded 0.124.

| guarded paint k | near S | near chroma | near vivid% | build failures | short of target |
|---|---|---|---|---|---|
| 1 (shipped) | 0.186 | 0.066 | 1.7 | 0 | 5 |
| **3** | **0.252** | **0.102** | 10.0 | **0** | **5** |
| 4 | 0.273 | 0.118 | 10.4 | 0 | 5 |
| **5** | **0.291** | **0.133** | 21.7 | **0** | **5** |
| 6 | 0.304 | 0.147 | 29.7 | 0 | 5 |

---

## 6. The prescription

Assume you were not here. Everything below is a change to authored hex; there is
no geometry, no material, no shader and no light in it.

### P1 — repaint `paintGeo`'s seven tones. The whole of the fix that is free.

`src/render/world.js`, the paint ladder around **`:5490`–`:5520`** and the tone
constants it feeds (`ROAD_MARGIN` at `:5502` and the longitudinal-mark block
below it). Find the seven authored tones by their current hexes; they are the
only seven in the merged `paintGeo` colour attribute, verifiable with
`node tools/roadchroma.js --skip 25 --paint 1` which prints the mesh and
geometry counts it found.

Take **k = 3** (conservative, ships the look nearly unchanged) or **k = 5**
(closes 43% of the gap on the worst leg). The exact replacements, computed in
linear space and re-encoded, hue-guarded at 25°:

| area | now | **k = 3** | **k = 5** | note |
|---|---|---|---|---|
| 27.0% | `#313040` | `#302d55` | `#2f2965` | expansion-joint groove |
| 20.0% | `#b3b4bc` | `#b0b3ca` | `#adb2d7` | the bright lane/edge line |
| 16.9% | `#504d61` | `#51487c` | `#534391` | |
| 14.4% | `#272636` | `#26234a` | `#251f5a` | |
| 11.5% | `#807c97` | `#8276bc` | `#846fda` | joint lip |
| 6.6% | `#69696f` | `#686879` | `#676782` | |
| 3.5% | `#9d9885` | **`#9d9885` — HOLD** | **`#9d9885` — HOLD** | **hue 47.5°, six degrees from the JUMP mat. Do not saturate this one.** |

Every replacement preserves the tone's linear luminance exactly, so **the paint
ladder's stated ratios to the tarmac are unchanged and nothing in that long
comment has to be re-derived.** That is the reason for doing it this way rather
than by eye.

**Expected effect**, measured, CITY START near band: S 0.186 → **0.252** (k=3)
or **0.291** (k=5); chroma 0.066 → **0.102** / **0.133**; vivid 1.7% → 10.0% /
21.7%. THE WALL and the FINAL MILE move by a similar amount. **Cost: 0 draw
calls, 0 triangles.** Fairness gate: **unchanged to three decimals.**

### P2 — put the road's chroma back where `BIOME_LOOK` had it, and no further.

`src/render/world.js`, the `road:` entry of each `SETTING_LOOK` block at
**`:599, 619, 639, 659, 679, 700, 720, 740, 760, 780, 800, 820`** (and the
remaining city settings on the same pattern). Apply k = 1.5 about each hex's own
luminance-grey — e.g. `#65636d` → `#656271`, `#655f6d` → `#675e73`,
`#66656f` → `#666574`. This restores roughly the chroma the `BIOME_LOOK`
fallbacks still carry and returns these roads to being a palette rather than a
value ramp.

**Do not go past k = 1.5 without re-running the gate per leg.** At k = 2 THE
WALL already fails, and at k = 3 CITY START fails two variants. Worth
**+0.007 to +0.010** of near-band chroma. **Cost: 0 draw calls.** Optional; P1
is worth ten times as much.

### P3 — do not touch `shading.js`.

The ramp floor, the hemisphere, the bounce, the ambient, the fog range and the
ink weights were all ablated and none of them is the defect. Two of them are
*helping*. The 0.31 ramp floor is correct for the argument its header makes,
which is about the read window, not the near band. **Any future brief proposing
a lighting change to fix near-band saturation should be sent back with this
table.**

### What to re-measure, and the exact commands

```
node tools/build.js && node tools/shoot.js && node tools/course-test.js && node tools/simulate.js
node tools/chromashot.js --dir tools/tmp/after
node tools/chroma.js tools/tmp/after/*.png reference/ss-run-01.png reference/ss-run-02.png reference/ss-run-03.png reference/ss-jump-01.png
node tools/roadchroma.js --skip 25  --paint 1 --guard 25
node tools/roadchroma.js --skip 178 --paint 1 --guard 25
node tools/clarity.js tools/tmp/after/*.png
```

Accept the change only if **all** of these hold:

1. `shoot.js` reports **0 contrast failures** and the "short of target" list is
   no longer than the five / four / six it is today at skips 25 / 178 / 230.
2. Near-band edge% has not risen past the Subway Surfers band of 9.3–12.7 on
   any leg (it should move about +0.5, from 7.2 toward 7.7 at CITY START).
3. Near-band mean L is within 2% of today's per leg — if it is not, the
   luminance-preserving construction was not followed and the paint ladder's
   ratios have moved.
4. Near-band chroma has risen on **every** leg, and no leg has fallen.

### What is left after this, stated honestly

P1 at k = 5 plus P2 gets CITY START's near-band saturation from 0.186 to about
**0.31** against a Subway Surfers median of **0.460**. **It closes a bit under
half the gap.** The rest is not in the palette of the surfaces we have — it is
in the fact that their play surface is a crimson train and ours is a road, and
40% of our near band is tarmac that the fairness gate will not let us colour.
Closing the remainder means putting **more saturated non-road area into the
bottom third of the frame**, which is a content change with a draw-call price,
and it should be argued for separately and on its own evidence. It should not be
attempted before P1, because P1 is free and moves the number twice as far as
anything the road can do.

---

## 7. For `docs/roadmap.md`

Not appended here: another agent has `docs/roadmap.md` open. The entry, when
someone lands it:

**The near-band saturation gap was measured five times and diagnosed zero
times, and every candidate cause in the brief was wrong.** The toon ramp, the
hemisphere fill, the fog and the ink outlines were all ruled out by ablation:
unlighting the entire frame moves near-band chroma by 0.010 of a 0.227
shortfall, and the fog's contribution to the near band is exactly zero because
`FOG_NEAR` is 60 units and the near band's mean depth is 5.6. The cause was the
authored palette of the play surface, which is 90.3% of the band: seven road-
marking tones with a maximum chroma of 0.106 and eighteen road colours with a
maximum of 0.086, every one of them sitting at luminance 0.391–0.393 — a palette
tuned on one axis with the other never given a target. **The general form: when
a palette's whole set agrees to three decimal places on one axis, that is the
axis somebody measured, and the silent one is where the defect is.**

And the lever nobody had looked for was free the whole time: the fairness gate
measures hazards against a tarmac patch that **does not contain the road
markings**, so the markings' chroma is structurally independent of it — twelve
variants, three legs, six steps, margins identical to three decimals.

---

## 8. The remainder, censused: there is nothing else down there

Section 6 ended by saying the rest of the gap "is not in the palette of the
surfaces we have" and that closing it "means putting more saturated non-road
area into the bottom third of the frame". That was an inference. This section
measures it, and the inference turns out to have been understated: it is not
that the other things in the near band are near-neutral. **They are not there.**

Diagnosis only. No file under `src/` was edited to produce any number here, and
none was edited as a result of them.

### The instrument, and the three defects it had first

`tools/nearband.js`. It takes `chromadepth.js`'s readback verbatim -- the same
default-framebuffer colour read, the same ink-aware id and depth passes, so the
two reconcile exactly -- and adds a **world-space fingerprint** per cluster:
a `Box3` over the cluster's meshes after an explicit `updateMatrixWorld(true)`,
reported as lateral half-extent in LANES about the runner and base height over
his feet. Shares are quoted **as a share of the near band**, not of the frame.

Its own `--audit` found three defects before any output was used, and all three
flattered the answer:

- the cluster stat had lost the `y < third` restriction, so it measured
  whole-frame area against a near-band denominator and shares summed to **300%**.
- colour was read from a plain `WebGLRenderTarget`, which is **linear**, where
  `chromadepth` reads the sRGB default framebuffer. It printed near L **0.092**
  against a true 0.308 -- every dark surface darker than it is.
- **the frame was not frozen.** `main.js` calls `requestAnimationFrame` at the
  TOP of `frame()`, so overriding rAF still lets one queued frame run, and
  `onBeforeRender` hooks read `performance.now()` directly. Every one of the
  three renders a census performs advanced anything driven by wall time.
  **Pinning the clock is what makes the band aggregate reconcile with
  `chromadepth` exactly** -- 0.252 / 0.101 / 0.308 / 9.1 on both, where before
  it was 0.004 out. `chromadepth` overrides rAF inside its own measure call and
  so carries the same one-frame ambiguity; that is the size of its noise floor.

Repeatability is asserted at 1pp on the world clusters and the measured drift is
printed on every run. Five of six legs return **exactly 0.0000**; CITY START
returns 0.22pp, because the world holds animated crowd whose integrators step
per render. The run-to-run floor on the whole pipeline is discrete rather than
continuous: CITY START near S comes back as either **0.243 or 0.252** depending
on which step the runner's rig lands on.

### The near band is the carriageway, and it is smaller than the road

Every near-band pixel unprojected through the shipped camera at its own measured
depth. The band is not a region of the world anyone chose; it is what the bottom
third of a 620x1344 portrait frame reaches at a mean depth of 5.2 units:

| leg | skip | footprint on the ground | half-width about the runner |
|---|---|---|---|
| CITY START | 25 | x -2.5..2.5, z 570.9..575.7 | 1.47 lanes |
| RIVERSIDE | 60 | x -3.9..0.5, z 1472.1..1476.9 | 1.28 lanes |
| THE BRIDGE | 95 | x -2.6..2.6, z 2414.5..2419.2 | 1.52 lanes |
| THE BRIDGE | 110 | x -1.1..4.2, z 2820.7..2825.8 | 1.64 lanes |
| PARKLAND | 140 | x -2.6..2.6, z 3637.5..3642.1 | 1.53 lanes |
| THE WALL | 178 | x -2.6..2.6, z 4676.6..4681.2 | 1.52 lanes |

**About five units wide and under five units deep.** The carriageway's own
half-extent is 2.2 lanes. **The near band does not even span the road it lies
on** -- it is the middle of the carriageway, directly under the runner, and the
kerb line sits roughly 50% further out than the band's widest edge ever reaches.

### What is in it, with correct occlusion

Shares are % of the near band. One run, all six legs, so the rows are comparable.

| leg | tarmac | paint | telegraph mats | runner | hazard | **other world scenery** | near S | vivid% |
|---|---|---|---|---|---|---|---|---|
| CITY START 25 | 56.1 | 33.6 | 0.0 | 10.3 | 0.0 | **0.0** | 0.252 | 9.1 |
| RIVERSIDE 60 | 35.5 | 21.8 | 10.2 | 10.6 | 9.7 | **12.1** | 0.298 | 15.4 |
| THE BRIDGE 95 | 26.2 | 22.0 | 36.7 | 15.0 | 0.0 | **0.0** | 0.249 | 9.1 |
| THE BRIDGE 110 | 37.2 | 24.9 | 23.3 | 14.7 | 0.0 | **0.0** | 0.297 | 9.2 |
| PARKLAND 140 | 54.2 | 31.3 | 0.0 | 14.5 | 0.0 | **0.0** | 0.282 | 9.9 |
| THE WALL 178 | 31.8 | 23.9 | 31.4 | 9.7 | 3.2 | **0.0** | 0.362 | 26.7 |

**On five of six legs, not one pixel of the near band belongs to anything that
is not the play surface, the runner, or a hazard.** No kerb, no shoulder, no
barrier, no railing, no street furniture, no verge, no building, no wall, no
vehicle, no crowd member. Not near-neutral -- **absent**.

On the sixth, RIVERSIDE, the single exception is one 144-triangle unlit quad at
12.1% -- **the river**, which the band catches because `bank` cuts the shoulder
away there and the runner was in an outer lane so the band spilled off the road
edge. It is already at **S 0.355, C 0.187**: more colourful than the tarmac it
sits beside, and the one piece of scenery the band can see is already doing
better than the band average.

The third thing in the band is the one nobody had named: **the telegraph mats.**
Identified by construction rather than inference -- 1.4 x 16.0 quads at lane
x = -1.70 / 0 / +1.70, renderOrder 5, a 128px map, `matMat[K.JUMP|DUCK|BLOCK]`
at `world.js:6876`. They are **0% to 36.7%** of the band depending on whether a
hazard happens to be telegraphing, and they are the single reason THE WALL sits
at 0.362 while PARKLAND sits at 0.282. **The most colourful large thing that
ever enters the near band is a gameplay signal, and it is already at full
saturation.**

### The experiment, because a table is an argument

Saturating every world object that is **not** the play surface, about its own
luminance-grey so linear luminance is preserved exactly, at k = 6:

| leg | mode | what was touched | near S | near C | vivid% |
|---|---|---|---|---|---|
| CITY START | shipped | -- | **0.252** | 0.101 | 9.1 |
| CITY START | **scenery** | 15 materials, 22 colour attributes, **31 texture maps** | **0.252** | 0.101 | 9.1 |
| CITY START | all (control) | 19 materials, 33 colour attributes, 51 texture maps | **0.810** | 0.468 | 83.4 |
| RIVERSIDE | shipped | -- | 0.298 | 0.136 | 15.4 |
| RIVERSIDE | **scenery** | 18 materials, 28 colour attributes, 39 texture maps | **0.293** | 0.136 | 14.9 |
| RIVERSIDE | all (control) | 23 materials, 41 colour attributes, 62 texture maps | **0.780** | 0.396 | 60.0 |

**Repainting every piece of scenery in the world leaves the near band
bit-identical**, while the same operation including the play surface moves it
by 0.558. This is the strongest kind of ablation -- one that *must* move
nothing, and does not -- and it is the same shape as the fog result in section 4.

**The control is not decoration, and this tool needed it.** Its first version
scaled `material.color` only, and reported the same zero for the wrong reason:
the RIVERSIDE water is `0xffffff` with its tone in a **map**, so scaling white
about its own grey returns white. **That is the `roadchroma` defect a third
time** -- six identical rows that would have read as proof. Textured objects are
now boosted through their texels, and the count of white-with-a-map materials is
printed beside every result so a zero can never be read without it.

### What closing the rest would cost

Near-band S is an area-weighted mean of its clusters, so this is arithmetic
rather than a model. To reach the Subway Surfers median of 0.460 by adding new
saturated geometry to the band:

| leg | new geometry at S 0.80 | at S 0.60 | at S 0.50 | vivid-area, at 100% vivid |
|---|---|---|---|---|
| CITY START | **38.0%** of the band | 59.8% | 83.9% | **51.9%** |
| THE WALL | 21.5% | 39.9% | 69.9% | 40.2% |

**Between a fifth and half of the carriageway directly under the runner would
have to be covered in fully saturated material** -- inside a footprint of five
units by five, on the surface the fairness gate protects.

And the game already contains the object that would do it. A telegraph mat is
S 0.507 in the band; three of them, one per lane, is roughly the 38%. **That
change is unavailable for a reason no budget can fix: a mat means a hazard is
coming, and a play surface that is permanently mat-coloured is precisely what
the mat's meaning depends on it not being.** The colour and the signal are the
same resource, and the signal has the prior claim.

### The finding

**The near band is the carriageway. There is nothing else down there to colour.**

The candidates the brief for this pass listed -- kerbs and shoulders, barriers
and railings, street furniture, buildings and walls, the verge, the vehicles,
the crowd -- are not near-neutral contributors to the near band. **They
contribute exactly zero, because none of them is in it on any leg measured.**
Repainting them is not a small win; it is not a win at all, and the ablation
says so to three decimal places.

So the honest position is the one entry 57 reached from the other direction, now
with a number under it: **k = 3 on the markings closed 24% of the gap and that
is as far as this goes without new geometry ON the play surface.** The remaining
76% is not recoverable from the palette of the things we have, because the
things we have are not there. It is recoverable only by changing what the play
surface *is* -- which is the difference between a crimson train roof and a road,
and that is a design question about the game, not a colour question about it.
