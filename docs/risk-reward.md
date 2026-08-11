# There is no risk-reward curve, and here is the number that says why

**Status: measurement and options. Nothing is implemented. Nothing under `src/`
was touched.**

> The owner: *"We need to make it more challenging. It cannot just be 'clear all
> but one obstacle and you win'. There needs to be a strategy where if you don't
> take enough health and speed you cannot get there, but if you take too much
> you go too fast and crash into something. There needs to be more than one way
> to beat the record."*

Everything below is from `node tools/risk.js`, which drives the shipped `Pace`,
`Course`, `Collision` and `Player` rather than a description of them. Reproduce
with `node tools/risk.js --days 20`. The instrument audits itself and exits
non-zero if it cannot.

**And every angle of every object is still built on all sides — rule 1 of
`CLAUDE.md` applies to anything any of these options would add: a throttle
readout, a fork sign, a carried bottle. There is no back of an object.**

---

## The verdict in three lines

1. **Speed is not dangerous, and it structurally cannot be.** A player with a
   450 ms choice-reaction time takes **zero** contacts at every speed the game
   can produce. The first contact appears at **1.25x the pace floor** — a pace
   of 3:23/mi that no streak can ever buy.
2. **Aid is not a trade.** It is worth **0.00 s** to a clean run and up to
   **295 s** to a broken one, and its marginal value *rises* with damage. There
   is no amount of aid that is too much, so there is nothing to decide.
3. **There is exactly one winning line, and it is every line.** Six different
   policies — take all the aid, take none, early only, late only, safe lane,
   shortest line — finish at **1:58:03, all six, spread 0.0 s**, all of them
   86 s inside the record.

The owner's complaint is correct and it is measurable to the second.

---

## 1. The reaction window, in milliseconds

| | at 5:30/mi (slowest) | at 4:33/mi (record) | at 4:14/mi (fastest) |
|---|---|---|---|
| **Decide window** (guaranteed floor) | **963 ms** | 798 ms | **741 ms** |
| Jump timing window | 572 ms | 572 ms | 572 ms |
| Duck timing window | 724 ms | 724 ms | 724 ms |
| Input buffer on top | 200 ms | 200 ms | 200 ms |

Measured across 20 real courses, 2201 gate intervals, on a clean run:

| sighting model | min | 5th | median | 95th |
|---|---|---|---|---|
| guarded (blind until the occluder clears the lens) | 742 ms | 753 ms | 848 ms | 1420 ms |
| open (gate in shot the whole gap) | 922 ms | 945 ms | 1153 ms | 1755 ms |

The window does tighten through the race — median **1458 ms** in the opening
tenth to **753 ms** in the closing tenth, a 48% squeeze. But **speed is only a
fifth of that.** Speed rises 23.40 → 28.16 u/s (+20%); the gap between gates
falls 34.1 → 21.2 units (−38%). The difficulty ramp does the work. Speed is
along for the ride.

**Answering the brief's question directly: the spacing floor is in WORLD UNITS,
not seconds.** So reaction time genuinely does shrink as the runner speeds up —
the mechanic the brief hoped might already exist does exist. It is just far too
small to matter: 963 ms → 741 ms is a 23% shrink, and it lands 240 ms above a
human choice reaction rather than below it.

---

## 2. Why speed cannot be dangerous — the architectural reason

This is the finding that decides which options are even possible.

```
MAX_SPEED     = (UNITS_PER_MILE * TIME_SCALE) / FLOOR_PACE
ACTION_WINDOW = ceil(JUMP_TIME * MAX_SPEED) + 1
spacing floor = ACTION_WINDOW + CAM_BASE_BACK + reachOf(previous gate)
```

The generator is **told the top speed and spaces the gates to preserve the
window**. So the guaranteed reaction window is always `JUMP_TIME` plus a
rounding margin — **≈ 730-740 ms at every speed the game can reach, forever.**
Going faster does not shorten the reaction window. It lengthens the road.

The proof: widen `MAX_SPEED` in a sandbox and re-measure.

| assumed top speed | ACTION_WINDOW | gates/course | window at base pace | window at top speed |
|---|---|---|---|---|
| 1.00x (today) | 21 | 185.2 | 741 ms | **741 ms** |
| 1.20x | 25 | 174.0 | 882 ms | **735 ms** |
| 1.30x | 27 | 168.0 | 953 ms | **733 ms** |
| 1.50x | 31 | 155.3 | 1094 ms | **729 ms** |

The right-hand column is a flat line. That is the whole answer.

**Therefore: the only way to make speed dangerous is to let the player exceed
the speed the generator was told about — by their own choice.** Every other
route is closed by construction.

Headroom before the game breaks on its own terms: the invariant that stops a
jump still being airborne at a gate demanding a duck holds up to
`ACTION_WINDOW / JUMP_TIME` = 30.0 u/s, against a floor speed of 28.35. **Only
5.8% of overdrive is free today.** Anything beyond that has to be bought with
course spacing.

---

## 3. What the streak ramp actually pays

| streak | target pace | next gate buys | share of ramp spent |
|---|---|---|---|
| 5 | 5:08/mi | 3.550 s/mi | 28.5% |
| 20 | 4:41/mi | 0.866 s/mi | 64.9% |
| 50 | 4:29/mi | 0.183 s/mi | 80.4% |
| 100 | 4:23/mi | 0.088 s/mi | 88.4% |
| 185 | 4:18/mi | 0.037 s/mi | 95.0% |

**Gate 5 is worth 19.4x gate 50.** Half the ramp is spent by streak 12, 90% by
streak 115. `AID_CEILING` sits at streak 91 — 87% of the ramp.

What one contact costs, by where it lands, against **86 s of total headroom**:

| at % of race | 2% | 10% | 20% | 35% | 50% | 80% | 99% |
|---|---|---|---|---|---|---|---|
| costs | 33.9 s | 63.9 s | **64.5 s** | 63.8 s | 58.8 s | 33.5 s | 5.3 s |

So real tension *does* exist — a single contact in the first 80% of the race
eats 39-75% of all the headroom there is. But it is a **knife edge, not a
curve**: one mistake and you survive, two and you do not, and there is no
decision anywhere that trades against it.

---

## 4. The aid economy

Read off `pace.js`: aid grants **streak**, bounded by
`min(streak + gain, gatesSeen, AID_CEILING)`. It does not touch race time,
contact, or the clock. There is no health, no fuel and no consumable in this
game. **Aid is exactly one thing: a partial refund on a mistake already made.**

Marginal value of the Nth item, in seconds off the finish:

| run | 1st | 4th | 8th | 12th | 14th | all |
|---|---|---|---|---|---|---|
| 0 mistakes | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | **0.0 s** |
| 1 mistake | 0.00 | 0.00 | 5.89 | 1.33 | 4.63 | 29.9 s |
| 3 mistakes | 0.00 | 5.08 | 11.56 | 5.13 | 4.14 | 84.0 s |
| 6 mistakes | 0.00 | 8.13 | 18.51 | 9.65 | 0.83 | 161.0 s |
| 12 mistakes | 0.00 | 15.00 | 20.69 | 18.32 | 19.12 | **294.8 s** |

The marginal value **increases** with damage. Seeking every bottle does cost
something real — +0.50 contacts at a 6% fluff rate, measured through the real
state machine — but it still finishes 54 s faster. **Aid is net-positive at
every skill level, and worthless at the only one that matters.** It is
insurance with no premium.

The 25%-extra-fumbling crossover from the earlier aid work still holds. It was
never wrong; it was answering a narrower question. Aid is a genuine decision
*about which lane to be in*, and not a decision *about whether to want it*.

---

## 5. Is there more than one winning line?

Six policies, real `Player` + `Collision` + `Course` + `Pace`, 450 ms latency:

**At 0% fluff — the record-chasing case:**

| policy | contacts | aid | finish | vs record |
|---|---|---|---|---|
| take every bottle | 0.00 | 13.8 | 1:58:03 | −86 s |
| take none | 0.00 | 0.0 | 1:58:03 | −86 s |
| early half only | 0.00 | 6.0 | 1:58:03 | −86 s |
| late half only | 0.00 | 7.8 | 1:58:03 | −86 s |
| safe lane (centre) | 0.00 | 0.0 | 1:58:03 | −86 s |
| shortest line | 0.00 | 0.0 | 1:58:03 | −86 s |

**Spread: 0.0 s. Six of six beat the record.**

At 6% fluff the spread opens to 54.3 s — but **zero of six beat the record**.
The aid decision separates policies only among players who have already lost.

That is the owner's complaint, stated numerically: *policy does not exist above
the record line, and does not matter below it.*

---

## 6. Five options, ranked

### 1. OVERDRIVE — a speed the course was not built for ★ build this

> **"Hold it down to run faster than you've earned. The road stops giving you
> time to read it."**

A player-held throttle that pushes pace past `FLOOR_PACE` by up to 1.30x. The
generator is widened to assume the *overdrive* top speed, so:

- a player **not** using it gets a **more forgiving** game than today — 741 ms → **953 ms**;
- a player **using** it runs at **733 ms**, exactly as tight as the game is today;
- the price is **9.3% of the gates** (185.2 → 168.0), courses still valid, **zero degraded gates** across 24 days.

**Nobody loses forgiveness. The tightness becomes something you elect.** And it
is the owner's sentence literally: take too much speed and you crash.

- **Touches:** `pace.js` (an elected multiplier), `controls.js` (one input), `constants.js` (`FLOOR_PACE / OVERDRIVE_MAX` feeding `MAX_SPEED`), HUD, and one built-on-all-sides throttle readout.
- **Breaks:** nothing structural. `Course.solvable()` is a statement about geometry, not speed — untouched and still sound. `shoot.js` passes by construction on *wider* spacing. One contact still ends a record attempt. **The honest cost:** every course changes, so the `tools/mechanics.js --identity` baseline moves and must be re-taken deliberately.
- **A/B:** yes, cleanly — `MR.Pace.OVERDRIVE` as a scalar exactly like `MR.Course.RAMP`, with the generator widening behind the same flag and no roll drawn at 0.

### 2. AID AS A WAGER — a life or a gear, never both

> **"Bottles are either a life or a gear. You cannot spend one twice."**

Aid stops topping up the streak on pickup and is **carried**. The player spends
stock either to cancel one contact, or to buy overdrive fuel. Two exits from
one currency is a decision; one exit is a rebate.

- **Touches:** `pace.js`, a carried store, HUD, one spend input. Course generation, collision and solvability all untouched.
- **Breaks:** **"one contact ends a record attempt" — plainly, yes.** It becomes "one *unprotected* contact ends it." That is the single most load-bearing contract in the game and this option spends it. Worth it only if the owner wants that trade.
- **A/B:** yes, `MR.Pace.WAGER`.
- Composes with Overdrive perfectly: aid becomes the fuel, which converts it from rebate to wager with no second mechanic.

### 3. THE LANE BUDGET — speed costs you the freedom to move

> **"The faster you go, the fewer lane changes you get."**

A crossing budget that tightens as pace approaches the floor. The clean line
still exists; at top speed you may no longer be able to *execute* an arbitrary
one, so you slow down before the wall to buy the crossings.

- **Touches:** `player.js`, `pace.js`, HUD.
- **Breaks:** **`Course.solvable()`, genuinely.** The BFS proves a lane path exists but places no bound on how many crossings it needs. Under a budget the proved path may be unexecutable, so `solvable()` must become a cost-bounded BFS and every fairness claim re-derived. That is the most dangerous line in this document.
- **A/B:** yes, but the solver change cannot be flagged off cheaply.

### 4. THE FORK — pick your line at every mile gantry

> **"Fast road or safe road. Choose 26 times."**

Two parallel bands per mile, one tight and high-paying, one wide and slow.

- **Touches:** `course.js` heavily (two proved courses per mile), `pace.js`, `world.js` (a fork to render and sign, built on all sides), `shoot.js` (audit both bands).
- **Breaks:** nothing structural — `solvable()` runs on both bands. It is simply **far the most expensive**, and it doubles the surface every fairness gate must cover.
- **A/B:** yes, but at a cost that makes the experiment nearly as dear as the feature.

### 5. A HEALTH BAR — the option I think is wrong

> **"Obstacles take a chunk; aid refills it."**

The owner said *"health"*, so this is the tempting literal reading. It is still
the wrong build:

- It **replaces the sharpest stake in the game with a soft one.** One contact ending a record attempt is what makes every gate matter; a meter makes early contacts free and turns the run into attrition.
- It makes aid **more** of a pure rebate, not less — the exact opposite of what was asked.
- It creates **no "too much" state at all**, so it answers only one of the owner's three clauses.
- It invalidates every finish-time number in `simulate.js`, because runs stop ending the same way.

The word "health" in the brief is describing a **resource economy**, not a
hit-point meter — and options 1 and 2 are that economy. Shown here so the shape
of the space is visible.

---

## Recommendation: build Overdrive first

- It is the only option that creates a **"too much"** state. Every other option only creates "not enough."
- **The physics already works** — `tools/risk.js` shows a 450 ms player starting to take contacts at 1.25x the pace floor. The mechanic is not missing; it is *unreachable*. Making it reachable is a smaller change than inventing one.
- It **breaks nothing**: not `solvable()`, not `shoot.js`, not the one-contact contract.
- It is **A/B-able behind a scalar**, exactly as `MR.Course.RAMP` is.
- It makes the game **more forgiving by default** and hands the tightness to the player as a choice, so it cannot make anyone's existing run worse.

Then Option 2 on top, so the bottles become the fuel — and aid stops being
insurance the moment it has somewhere else to go.

---

## What I would not trust yet

- The 450 ms latency is a literature number, not a measurement of *this* game's players. The finding is robust to it — at 250 ms and even at 0 ms the speed band is still contact-free — but the exact breaking point moves with it.
- The speed sweep runs at **constant speed with no hills**, on purpose, to isolate speed from streak history. The grade term is ±20 s/mi locally and the window section measures the real profile with hills in.
- The overdrive costing is **24 days**, not the full calendar. The ramp's run-in defect was invisible at 90 days. Re-run at 365 before committing to the number.
- `tools/simulate.js`, `tools/aid.js` and `tools/mechanics.js` **cannot see this question at all** — `simulate.js` decides outcomes from a counting pattern, and the other two fire actions at a fixed *time before* the gate with zero latency, which rescales perfectly as the runner speeds up. That is not a defect in them; they measure other things. But it does mean "the record survives one mistake" has been read as a difficulty statement when it is only a statement about the pace arithmetic.
