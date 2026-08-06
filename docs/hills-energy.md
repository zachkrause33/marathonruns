# Hills and energy

A design, not a build. `world.js`, `runner.js`, `ghost.js`, `hud.js`, `style.css`,
`main.js` and `store.js` are owned by other agents; nothing here has been edited.

Everything below was checked against the shipped modules — `tools/simulate.js`'s
loader over `rng/constants/pace/course`, and `tools/shoot.js --probe` against the
real build.

---

## Verdict

1. **Build hills.** They cost zero draw calls and about 230 triangles. They are
   the only content this game can add that changes how the race *feels* without
   adding a thing to react to — which matters, because the race already asks a
   question every 1.16 s with no lull anywhere in the distribution.
2. **Do not build an energy system.** Do build the *fuel read*: the aid ceiling
   made visible, using state that already exists. Zero new simulation state,
   zero new input, zero new proof obligation.
3. **The player-controlled energy action is a blocker on input grounds** — and
   it is also unnecessary, because the control it wants already exists. It is
   the lane. See §4.

There is also a live near-miss in the current code, independent of all of this.
See §1.4.

---

# 1. Hills

## 1.1 Where elevation comes from

A new core module, `MR.Elevation`, seeded from the same date key as everything
else and generated **before** the gates (§1.4 explains why that ordering is
forced).

```
E(z) = Σ  h_i · (1 + cos(π · (z − c_i)/L_i)) / 2      for |z − c_i| ≤ L_i
```

A raised cosine, compactly supported. Grade is `dE/dz`, positive uphill.

Every hill is a **hump**: it starts at zero, rises, and returns to zero. That is
not decoration, it is what makes §1.2's zero-net proof hold for every *prefix*
of the race and not merely for the whole of it. No hill can leave the runner
higher than it found them, so no sequence of hills can compound into a mountain
and no partial race is out of balance.

Placement, per date:

| | |
|---|---|
| count | 4–6, seeded |
| `L` (half-length) | 130–240 units |
| `h` | `cap(L) × rnd.range(0.55, 1.0)` |
| `cap(L)` | `min(0.0255·L, 1.15e-4·L²)` — derived in §1.3 |
| separation | centres ≥ `L_i + L_j` apart, so hills never overlap |
| excluded | `z < START_GRACE + 200` and `z > TOTAL_UNITS − FINISH_GRACE − 200` |

`cap` crosses over at `L = 221`: below that the sightline bound binds, above it
the grade bound does. Worked examples:

| L | cap(L) | binding rule | max grade | crest curvature |
|---|---|---|---|---|
| 130 | 1.94 | sightline | 2.3 % | 5.7e-4 |
| 180 | 3.73 | sightline | 3.3 % | 5.7e-4 |
| 240 | 6.11 | grade | 4.0 % | 3.3e-4 |

A hill is `2L` long: 260–480 units, 10–18 s of wall clock, 1.1–2.0 race miles.
Five of them cover roughly 28 % of the race.

**Scale sanity.** A world unit is ~1 m for objects (the runner is 1.78) and
~6.7 m for distance (240 units/mile). Elevation is authored on the *object*
scale, so a 4 % rendered grade is a 4 % grade to the eye — Boston's Newton hills
are 3–4 %, so this is real-marathon geometry. The pace penalty is a game number
and is deliberately much smaller than the real one (§1.2).

**Two hills are not seeded.**

- **The bridge already is one.** `deckLift(z)` in `world.js` is a ramp-up /
  hold / ramp-down over `DECK_FROM−190 … DECK_TO+190` that today only sinks the
  *water*. Make the deck a real rise and it becomes the honest version of
  something already on screen, for free.
- **The wall gets one, mandated, crest at `f = 0.763`** (`z ≈ 4801`, the centre
  of `difficulty()`'s Gaussian spike). See §5.

## 1.2 Grade → pace

```
paceNow  = pace + GRADE_SPM × grade_percent(z)      clamped to pace ± 20
dMiles   = dRace / paceNow                          // was dRace / pace
```

**Additive in seconds-per-mile, and that form is the whole argument.** Total
race time is `∫ paceNow dm = ∫ pace dm + GRADE_SPM·∫ g dm`, and
`∫ g dm = ∫ (dE/dz) dz / UNITS_PER_MILE = (E_end − E_start)/UNITS_PER_MILE = 0`
exactly, because every hill returns to zero. **The finish time is unchanged from
the flat course, for any sequence of gate outcomes, independent of how the pace
happened to vary along the way.** A multiplicative form (`pace × (1 + k·g)`)
does *not* have this property — it weights each grade by the pace there, and a
hill early would cost more than the same descent late repays. Use the additive
form.

Second-order coupling, stated for honesty: `raceTime` at a given gate does shift
mid-course, and `pace` eases against race-seconds, so the pace at a given gate
moves fractionally. `PACE_EASE` is 2.2 s/mi per race-second against ~35 race
seconds per gate, so easing is fully converged either way. Expect **< 1 s** on
the finish. This is the Stage 0 acceptance test.

**`GRADE_SPM = 5.0` s/mi per 1 % grade.** At the steepest legal grade (4 %) that
is ±20 s/mi against a streak range of 76 s/mi (330 → 254), so the biggest hill
on the course moves the pace by about a quarter of everything a perfect line can
ever buy. Real running economy is 12–15 s/mi per 1 % uphill; this is ~40 % of
that, on purpose, because a physically honest hill would swamp the mechanic the
game is about. **This is the number I am least sure of** — see §7.

Three things must *not* read the grade term:

- `projected()`, `projectClean()`, `needPace()`, `recordPossible()` — all keep
  using `s.pace`. Correct, because the grade term integrates to zero; a
  projection that included it would swing wildly on every crest and be wrong.
  `needPace() > FLOOR_PACE` remains a valid bound on the *average*.
- The speed gauge in `hud.js` — it reads `p.pace` today and must keep doing so.
  It is the engine readout; a descent must not light it up.
- `ghost.js` — untouched. `ghostMiles()` is `raceTime / RECORD_PACE`, and race
  time is grade-neutral. **Zero changes to ghost.js.**

`pace.js` therefore exposes two speeds:

| | drives |
|---|---|
| `speed()` — grade-inclusive | world scroll, runner cadence, camera framing and shake |
| `streakSpeed()` — flat | the camera's **top-gear latch** (`sp01 > 0.93`) and the gauge |

Splitting these is not fussiness: without it, a steep descent fires the top-gear
flourish and the permanent rumble spuriously, which is exactly the kind of thing
that ships as a bug.

## 1.3 Why the hill cap is what it is

Two rules, and the first one is the fairness rule.

**Sightline.** A crest is convex, so it occludes the road beyond it — including
the lane telegraph mats, which lie *on* the road surface and are the readability
device this game is built around. For an eye at height `h` above the road and a
crest of curvature `c`, the road surface stops being visible beyond

```
d_max = sqrt(2h / c)
```

Camera height above the local road at race pace is `BASE_Y − drive·0.20 ≈ 2.42`;
take **`h = 2.30`** to absorb the stride bob and the landing dip. Requiring
`d_max ≥ 90` units — p90 gate spacing is 39, so 90 is comfortably two gates and
usually three — gives `c ≤ 4.6/8100 = 5.68e-4`.

A raised cosine's crest curvature is `hπ²/2L²`, so `h ≤ 1.151e-4 · L²`.
Numerically swept against the real camera offset (4.35 units behind), the
analytic bound is conservative by 5–10 %:

| h | L | grade | curvature | worst sightline (measured) |
|---|---|---|---|---|
| 6.6 | 260 | 4.0 % | 4.8e-4 | 104 units |
| 3.0 | 150 | 3.1 % | 6.6e-4 | 92 units |
| 1.6 | 120 | 2.1 % | 5.5e-4 | 107 units |
| 6.6 | 200 | 5.2 % | 8.1e-4 | **79 units — fails** |

**Grade.** `hπ/2L ≤ 0.04`, so `h ≤ 0.0255 · L`. 4 % is the ceiling because it is
where real marathon hills sit and where `GRADE_SPM` was calibrated.

**And it must be proved, not asserted.** The per-hill cap plus non-overlap makes
the whole-profile curvature equal the per-hill curvature, but `Elevation.validate()`
should still ray-march the summed profile at 1-unit steps over all 6292 units
and report the worst visible distance — ~6300 samples, instant, deterministic,
run at generation exactly like `Course.validate`. A profile whose worst sightline
is under 90 units is a build failure, the same class of failure `shoot.js`
already fails a build for when a prop occludes a hazard.

## 1.4 The one invariant hills break — and it is already nearly broken

`constants.js` requires the airborne span to stay shorter than
`Course.ACTION_WINDOW` (20 units), so a jump can never still be in the air at a
gate demanding a slide. The comment there computes `0.70 s × 26.3 u/s = 18.4
units`, but 26.3 u/s is **record** pace (273 s/mi). The floor is now 254:

```
FLOOR_PACE 254  →  7200/254 = 28.35 u/s  →  0.70 × 28.35 = 19.84 units
ACTION_WINDOW                                                 20
```

**The current margin is 0.16 units — 0.8 %.** The comment is stale by a pace
rebuild and nobody has re-run the arithmetic. That is worth fixing whether or
not hills ship.

It also means downhills cannot be free:

| grade | pace | speed | jump span |
|---|---|---|---|
| flat | 254 | 28.35 | 19.84 |
| −2 % | 244 | 29.51 | 20.66 |
| −4 % | 234 | 30.77 | **21.54** |

The fix is not to slow the descent (2.3 s/mi of headroom kills the mechanic) and
not to shorten `JUMP_TIME` (that retunes the core jump and the clearance
window). It is to make the invariant a function of z:

```
actionWindowAt(z) = max(20, JUMP_TIME × (UNITS_PER_MILE × TIME_SCALE)
                             / (FLOOR_PACE + GRADE_SPM × grade_percent(z)))
```

`solvable()` uses `actionWindowAt(g.z)` in place of the constant, and
`spacingAt()`'s floor of 20 becomes the same call. On the steepest descent the
solver demands 21.6 units between conflicting gates instead of 20 — a ~3 %
loosening of the tightest spacing, invisible in play, and the BFS proof holds
**by construction with one line changed**.

This is what forces elevation to be generated before the gates. Elevation reads
nothing from the course, so there is no cycle.

## 1.5 What hills do *not* touch

`collision.js` tests `st.y >= 0.84` and `duck01 >= 0.90` against a flat zero, and
`player.js` writes `s.y` only inside the airborne branch. Keep the player's `y`
**relative to the local road surface** — add `E(z)` only at render time, in
`main.js`'s `runner.group.position.set(...)` and in the camera — and:

- every clearance threshold is untouched;
- `Collision.audit()` still passes unmodified;
- the BFS solvability proof is untouched apart from §1.4;
- `player.js` needs **no change at all**.

That is the finding the whole design rests on, and it holds.

## 1.6 Runner and camera

**Camera — two terms.**

```
hgt   = ... + E(z_cam)        // z_cam = p.z − back
look.y = ... + E(z_look)      // z_look = p.z + LOOK_AHEAD − ...
```

That is the entire change. On a constant grade the camera pitches with the road
because the two sample points differ; cresting, `E(z_look) < E(z_cam)` and the
camera pitches down the far side; climbing, it pitches up. The camera sits 4.35
units behind, so at a crest it is momentarily below the runner's road level and
the runner rises in frame — which is what cresting a hill looks like.

**Runner — one input, one bone.** Everything else falls out of speed for free:
`camera.js` already derives cadence as `2.55·(sp/22)^0.72` and `runner.js`
takes `speed`, so the stride slows on the climb and quickens on the descent
with nothing added. Add a single normalised `grade` (−1…1) and pitch the trunk:
**+6° forward at max climb, −3° back at max descent.** Guessing on the degrees;
they are one A/B away from being right and nothing depends on them.

**Shadows.** The batched shadow mesh writes quad positions at y ≈ 0.010; those
need `+ E(z)`. One line in the shadow writer.

**Ground plane.** `PlaneGeometry(1400, 1400)` with one segment, following the
runner in z. This is the only place hills cost triangles: left flat it would
slice across the descending road at every crest and hide it. Subdivide it along
z into ~12-unit strips over the fogged-out range (fog is opaque at 235) and
displace the row heights to `E(z)` each frame.

**`hills` (the backdrop silhouette) and `sky`** keep following at `E(z_player)`.
They are distant; nothing else is needed.

## 1.7 Cost

| | |
|---|---|
| draw calls | **+0** |
| triangles | **+230**, all of it the ground plane (2 → 232). Road tiles, hazards, props, aid, landmarks, runner, ghost: **+0 each** |
| per frame | ~234 vertex writes (ground), 5 `E(z)` evaluations (camera ×2, runner, ghost, ground), a bounding-sphere skip |
| per tile claim | 1 `position.y`, 1 `rotation.x`, 1 `atan` — ~1.1 claims/sec at race pace |
| `E(z)` itself | a loop over ≤ 7 hills with one `cos`; ~200 ns |

The road stays **rigid per tile**: set `rotation.x` from the 24-unit chord and
`position.y` to the chord's midpoint, so adjacent tiles meet exactly in y and
only the tangent kinks. At the tightest legal curvature the kink is
`c × TILE = 5.7e-4 × 24 = 0.0137 rad = 0.8°`. In a flat-shaded low-poly game
that is beneath notice, and it is why hills cost no geometry.

**Code footprint:** one new file (`core/elevation.js`, ~90 lines including the
validator); 2 lines in `pace.js`; 2 in `course.js`; 2 in `camera.js`; 1 in
`main.js`; 1 in `runner.js`; and in `world.js`, the y-offset applied at the
**six `activeX.push(...)` claim sites** rather than at the ~30 individual
`position.set` calls — one line each, and a missed site is then impossible.

---

# 2. Energy: the argument

## 2.1 The three framings

**Energy as a gate (low energy decays your pace even while clean).** This is
buildable and provable — it makes nothing unsolvable, only slower, so it needs a
calibration check in `simulate.js` rather than a second BFS. Reject it anyway.
It gives the player a *second way to lose speed that is not a visible mistake*.
This game's entire contract is that a loss is attributable: you hit a thing, the
camera lurches, the gauge bleeds, and you know exactly what you did. A slow decay
with no contact event is an attribution disaster in a game where one mistake
costs the record, and the player's honest reading of it will be "the game slowed
me down for no reason".

**Energy as pure bloat.** Half right. The HUD carries race time, projected
finish, a status chip, clean gates, a speed gauge, pace, need-pace, distance,
to-go, ghost gap, a trend word, the rail and mile toasts. It is at capacity. But
this framing misses that the owner is complaining about something real.

**Energy replacing aid.** This is the right reading of the request, and the
request decodes as a *legibility* complaint rather than a systems one. Look at
the shipped line:

```js
hud.toastAid('FUEL', '+' + item.gain + ' STREAK');
```

The code calls it FUEL and then credits it to a counter labelled CLEAN GATES.
The fiction and the mechanic disagree on screen, in one toast, and the owner
noticed. That is worth fixing. It does not need a new system to fix.

## 2.2 The commit

**Do not build an energy system. Build the fuel read.**

The game already contains a quantity that (a) is topped up by water and bananas,
(b) has a level, and (c) has an exact answer to "do I need one". It is `streak`
seen through `AID_CEILING`. `onAid` is literally:

```js
s.streak = Math.max(s.streak, Math.min(s.streak + gain, s.gatesSeen, K.AID_CEILING));
```

So define, with no new state whatsoever:

```
FUEL = streak / min(gatesSeen, AID_CEILING)          // AID_CEILING = 91
```

This is not an approximation of the aid rule, it *is* the aid rule, re-read on
the axis the player actually asks about. It cannot desync, cannot be gamed, needs
no proof and no simulation state. And it answers all three of the owner's asks:

- *see your energy level* — yes, 0…1.
- *shows when you need water or a banana* — yes, **exactly**: `FUEL < 1` means
  the next bottle is worth `(1 − FUEL) × min(gatesSeen, 91)` streak, and
  `FUEL = 1` means it is worth precisely nothing. Note the pleasing consequence:
  a flawless run reads FULL at every moment of the race, because `streak ==
  gatesSeen`. "You don't need a banana" is true and self-explaining.
- *raise or lower it yourself* — yes: clean gates raise it, contact drops it to a
  quarter, aid tops it up, and going to get the aid is a real choice (§4).

**How to show it without a fourth number.** Not a bar and not a digit.

1. **Nothing in the corner.** Put it on the aid item, in the world: a bottle or
   banana renders **spent/greyed when `streak ≥ min(gatesSeen, AID_CEILING)`**.
   The player learns "that one is not worth leaving the line for" by looking at
   the road, which is where they are already looking. Diegetic, costs no HUD
   real estate, and it is the readability idiom the file already uses.
2. **Make the toast honest.** `'FUEL' / '+22 STREAK'` → `'FUEL' / 'BACK TO 4:26
   PACE'` — what the banana actually bought, in the unit the player cares about.
   Strictly better message, no new system.

Do *not* put a fuel tick on the speed gauge. `AID_CEILING`'s pace (263.6) lands
at 87 % of the gauge and `gaugeRec` already sits at 74 %; two ticks that close
together is worse than none.

## 2.3 What hills owe the same panel

The one HUD change hills need is not a new element either. The pace number shows
`paceNow` (it moves on a hill — that is the point); the gauge stays on `pace`.
When they disagree, draw the difference as a **ghosted second fill on the gauge
that already exists** — one div, no new number, and the hill's cost appears as a
notch taken out of the gear you earned. At 4 % that notch is 26 % of the gauge.
Swap `#paceLab` between `PACE`, `PACE ▲ CLIMB` and `PACE ▼ DESCENT` above 1 %
grade.

---

# 3. Composition: the wall, and the 1.16 s cadence

**The wall.** `difficulty()` puts a Gaussian spike at `f = 0.763` (σ = 0.055, so
roughly `z` 4460–5140). Measured on two dates, that band carries 35–36 gates and
only 2 aid items. Put the mandated hill's **crest at `z ≈ 4801`, `L ≈ 180`**, so
the player *climbs into* the density peak and *descends out of it*. They
reinforce rather than compete: the climb and the hardest gates arrive together,
and the descent is the release that lands exactly as the gates thin.

It composes rather than collides because the grade changes no gate's difficulty
— clearance is measured against the local road — and because of a property that
falls out for free:

> **Uphill buys reaction time; downhill spends it.** At +4 % the gate interval
> goes 1.16 s → 1.24 s; at −4 % it goes 1.16 s → 1.09 s.

So the hardest stretch of the course is also, very slightly, the most forgiving
one to react in — and the reward for cresting it has teeth, because the descent
is where mistakes get made. That is a better wall than the density spike alone,
and it costs nothing.

**The cadence.** A decision every 1.16 s with no lull is precisely why hills are
the right addition and energy is not. A hill adds no decision. It changes the
pace, the camera's whole vocabulary (FOV, height, trail, cadence, rumble — all
of which already key off `speed`), the sightline, and the shape of the horizon,
while asking the player for **nothing they were not already doing**. That is the
only kind of content this game has room for. An energy action, by contrast,
inserts a *new* decision into a distribution that has no gap to put one in.

---

# 4. The controls problem

**Verdict: a new gesture is a blocker. It is also unnecessary.**

Costed against `controls.js` as it stands:

| gesture | cost |
|---|---|
| **tap** | Cleanly separable — a tap is `up()` with `!resolved`, and the swipe recogniser already tracks `resolved`. But it fires on every *aborted* swipe (thumb moved 20 px, threshold is 26). An accidental-fire machine. Tolerable only if the action can never cost anything — and an action that is never costly is not a strategy, it is a button you hold down. |
| **double-tap** | Needs a 250–300 ms recognition window, which is 26 % of a decision interval, and forces either delayed taps or a split meaning. Blocker. |
| **hold** | No swipe conflict (`SWIPE_MAX_TIME` is already 0.6). But it occupies the thumb, so you cannot steer while using it. A mechanic that removes the player's ability to react, in a game whose whole promise is that failure is your fault, is a trap. |
| **two-finger** | Requires two hands; `changedTouches[0]` ignores extras today, so the recogniser becomes stateful across touches. Poor accessibility for a global daily. |
| **swipe-and-hold** | Overloads jump or slide. Blocker. |

And a cost none of them escape: **there is no keyboard analogue.** Space is
already jump. Add a key and the phone and desktop versions of a globally
identical daily race stop being the same game.

**The control already exists, and it is the lane.** `generateAid` deliberately
places aid in the *hardest legal* lane — scored for an action at the gate
before, an action at the gate after, and being off-centre — precisely so that
taking it is a trade rather than a freebie. Choosing to leave the racing line
for a banana, and clearing whatever is guarding it, **is** the player-controlled
energy action. It uses inputs that exist, costs something real, produces
genuinely different strategies (chase every bottle, or run the pure line and
take none), and needs no new gesture and no new state.

The right response to "there should be a way to raise or lower it yourself" is
therefore not a new button. It is §2.2's point 1: make the aid item *visibly*
worth something or not, so the choice the player is already making becomes a
choice they can see themselves making.

---

# 5. Staged plan

**Stage 0 — the profile and its proof. Half a day. No rendering.**
`core/elevation.js` plus `Elevation.validate()` (the §1.3 sightline sweep), then
`tools/simulate.js` over its four reference dates with the grade term wired into
`pace.js`. **Acceptance: finish times move by < 1 s at every skill level.** If
they move more, the maths in §1.2 is wrong and you have spent nothing.

**Stage 1 — the smallest version that proves or disproves the idea. ~1 hour.**
Road tiles, ground strips, camera, runner onto the profile. *Nothing else.*
Props, hazards and landmarks stay at y = 0 and will visibly float and sink;
that is fine and deliberate. Then:

```
node tools/shoot.js --skip <crest of the biggest hill> --out crest.png
```

**Look at that one frame.** If a crest does not read as a hill — if the horizon
does not lift, if the far road does not fall away — stop here. Nothing after
this stage makes it better. This is the disproof.

**Stage 2 — the model.** `GRADE_SPM`, the clamp, `speed()` / `streakSpeed()`,
`actionWindowAt(z)` in `solvable()` and `spacingAt()`, regenerate and revalidate
courses across dates, re-run `simulate.js`. **Fix the stale `JUMP_TIME` comment
in `constants.js` here regardless** (§1.4).

**Stage 3 — the rest of the world.** Y-offset at the six claim sites, shadows,
runner trunk pitch, the deck as a real bridge hill, the mandated wall hill,
`#paceLab` climb/descent, the ghosted gauge fill. Re-run the full
`shoot.js --probe` set; the occlusion audit must still pass at every point.

**Stage 4 — the fuel read. Independent of everything above; ship whenever.**
The honest aid toast and the spent-item render. Two small changes, no new state.

**Not building:** energy as state, energy as a pace gate, any new gesture, any
fourth HUD number.

---

# 6. Where I am guessing

- **`GRADE_SPM = 5.0`** is the one number in this design chosen by judgement
  rather than derived. It is anchored at ~40 % of real running economy and at
  "the biggest hill costs a quarter of what a perfect line can buy", and both of
  those are choices. Tuning range 3.0–7.0. The question that decides it: on a
  240-second clock, does cresting read as *relief*? If a player does not exhale
  at the top, it is too low.
- **The 90-unit sightline requirement.** Derived from gate spacing (p90 = 39,
  so 90 units is two to three gates), but "two to three gates" is my judgement of
  what the player needs, not a measured threshold. It is the number that sets
  `cap(L)`, so it is worth an explicit playtest before it is frozen.
- **Camera eye height 2.30.** Taken as `BASE_Y − drive·0.20` with headroom for
  the bob and the landing dip. If another agent lowers `BASE_Y`, `cap(L)`
  tightens as `h²` and the validator will catch it — but it should be derived
  from `MR.Camera` rather than typed in.
- **Hill count (4–6) and the 130–240 `L` range.** Chosen for ~28 % grade
  coverage and 10–18 s beats. No measurement behind either; they are the first
  numbers I would move after playing Stage 1.
- **The runner's trunk pitch (+6° / −3°).** Pure feel.
- **`FUEL` is not a guess.** It is `min(gatesSeen, AID_CEILING)` read straight
  out of `pace.onAid`, and it is exact.
