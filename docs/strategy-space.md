# The strategy space

*Proposal only. Nothing here is implemented, and nothing should be until the
owner confirms. Every number below was measured against the shipped modules
(`tools/simulate.js` and a scratch harness over `src/core/`), not estimated.*

> **Standing rule 1 carries into every brief that comes out of this document.**
> Every object is modelled on all sides, fully, always. No LOD-by-angle, no
> detail spent on "the face the camera sees". If it is a thing that occupies
> space — obstacle, vehicle, gantry, sign, pickup, runner — it is built on all
> sides. A marking painted on a surface is not an object and has no back.

---

## The budget, first

Any strategy layer has to fit inside numbers that already exist.

| | |
|---|---|
| Flawless run | **1:58:03**, i.e. **86.2 s** inside the record |
| Gates per course | 182–186 |
| Cost of one contact | **+31 s** at 2% of the race, **+67 s** at 15%, **+58 s** at halfway, **+7.8 s** at 97% |
| Value of one clean gate | 5.19 s/mi at streak 0 → **0.039 s/mi at streak 180** |
| Reaction time | 963 ms at 5:30/mi, 798 ms at record pace, **741 ms at the 4:14 floor** |
| Aid on course | 17 placed, ~13.8 collectible on one line; worth up to 84 s to a broken run and **exactly 0 s to a clean one** |
| Price of aid | **100% of items cost at least one extra action.** None is free, and no natural-line bot collects any of it by accident (`tools/aid.js`, 365 days, 6409 items) |

Three consequences, and they shape everything after.

**The whole strategic purse is 86 seconds and a single mistake spends most of
it.** A choice worth less than about 5 s is noise the player cannot feel. A
choice worth more than about 60 s replaces skill outright. The playable band is
roughly 5–30 s per decision, with several decisions per run.

**The back half of a clean run is strategically dead.** By streak 180 a clean
gate buys 0.039 s/mi — a fortieth of what it bought at the gun. The player is
executing perfectly for ninety seconds in exchange for nothing. That dead zone
is free real estate: a strategy layer can operate there without touching the
record's calibration at all.

**Speed already costs reaction time, and nobody chose it.** Going from the start
pace to the floor cuts the window from 963 ms to 741 ms — the game gets 23%
harder as it gets faster, which is exactly the pressure the owner is describing.
It just is not a decision. Which brings us to the diagnosis.

---

## Why there is no strategy today

Not because the mechanics are thin. Because **the player has no decision
variable.** Speed is an output: `target(streak)`, and streak is a pure function
of the history of one binary skill event. There is nothing to allocate, nothing
to spend, nothing to decline. The only input is "hit or don't hit", and not
hitting is never wrong. A system with one input and a monotone reward has one
optimal policy, and that policy is the game we have.

So the requirement is not "more mechanics". It is **one currency the player can
spend in more than one place, where the places disagree about when they are
worth the most.**

---

## Part 1 — what comparable games do, and what survives here

| Mechanism | Survives? | Why |
|---|---|---|
| **Resource curve that can be over-spent** | **Yes** — the only one that survives cleanly | Pickups are course data, so determinism is untouched. Aid already writes nothing back to the BFS: `generateAid` reads the gate table and returns items, so the proved path of a player who ignores every bottle is the proved path. A tank is that, with a second use. |
| **Risk lanes that pay** | **Yes, and half-built** | Roof aid already scores items into "the hardest legal lane there is". The constraint is that the payout must be in the new currency, never in pace directly. |
| **Route choice inside a fixed course** | **Yes, cheaply** | Most gates already leave more than one lane legal. Making those lanes differ *in kind* — this one carries tank, that one is safe — creates a route with no new geometry and no new proof. |
| **Committed choices at forks** | **Yes, expensively** | `solvable()` and `validate()` take a list of gates, so a fork is two lists, each proved independently — the proof scales fine. The cost is real elsewhere: draw calls are the binding constraint (~300 against ~400) and a fork renders both corridors at once, and `tools/shoot.js` must frame both branches for fairness. |
| **Multipliers that decay** | **Already have one; do not add a second** | The streak *is* a decaying multiplier — contact keeps 40% of it and the pace bleeds back over several seconds. A second decaying meter would duplicate the first and put a fifth number on a HUD that R1 cut from four readouts to one. |
| **Powerups with a downside** | **Only if the downside is intrinsic** | A magnet or a jetpack deletes gates, and gates are the sole source of speed — the powerup would slow you down while feeling like a reward. A powerup whose downside is bolted on ("it makes you faster but the screen shakes") is not a decision. The surge below has an intrinsic downside: it shortens the window. |
| **Scoring that rewards style rather than survival** | **No** | Three reasons and each is sufficient. The win condition is a time against a fixed record: a style score either converts to seconds, in which case it is a pace bonus wearing a hat, or it does not, in which case anyone chasing the record ignores it. It is a fifth readout on a HUD the owner personally asked to thin. And it changes what the game is about. |
| **Difficulty or loadout selection** | **No** | "One course a day, the same for everyone" is the comparability contract. Two players' 1:59:29 must mean the same thing. |
| **Anything with randomness in it** | **No** | `tools/course-test.js` proves 365 days byte-identical run to run. Determinism is load-bearing. |

---

## Part 2 — can speed be *too much*?

**The owner's intuition survives. The literal mechanism does not.**

The literal reading — go faster, crash, crashing slows you — collapses exactly
as feared. With one speed scalar and a crash that costs speed, the system has a
fixed point: run as fast as you can control. That is today's game with extra
jitter, and the "strategy" is just execution variance.

It collapses because the punishment is **self-correcting and revocable**. Three
conditions break the fixed point, and all three are needed:

1. **Speed must be chosen, not derived.** Today it is derived. This is the
   whole gap.
2. **Chosen before the information that would let you regret it.** If you can
   ease off the instant a hazard appears, speed is a free option and the answer
   is always "maximum". The commitment must be made at a mile gantry or a gate
   line and hold for a stretch.
3. **Paid for out of something that had another job.** This is the part that
   stops the collapse. If over-spending shows up as a *shortfall later* rather
   than a *crash now*, nothing self-corrects — you cannot un-spend it.

So the honest form of "you went too fast" is not *you crashed because you were
fast*. It is **you spent your safety on speed, and then you needed it.** That is
also, read closely, what the owner actually said: *health and speed* out of one
pot.

### And the engine can host it, because it already does

Two facts from the source that make this cheap rather than speculative.

**The action window is already a function of position, precisely to pay for
locally higher speed.** On a 4% descent the runner hits 3:54/mi and the airborne
span goes to 21.5 units against a 21-unit window — negative margin.
`Elevation.windowExtra(z)` widens the window there, generation runs elevation
*before* gates so the spacing answers to it, and the BFS proof holds by
construction. **A surge zone is that same machinery with a different cause.**
The game already contains an over-speed band; it is just free and unchosen.

**There is a hard ceiling and it is 4:00/mi.** At 4:00 the jump span reaches
exactly 21 units and the invariant that stops the course demanding a jump and a
slide at once is gone. From the 4:14 floor that is **14 s/mi of headroom** — and
consuming it consumes the whole 1.16-unit margin the project deliberately keeps,
so a shipped surge must widen the window rather than eat the margin. A zone
spaced for 4:00/mi carries about **6% fewer gates**.

That last line is not a cost to be minimised; it is the price mechanism.
**Surging trades gates for pace**, and because a clean gate is worth 5.19 s/mi
early and 0.039 s/mi late, the trade is ruinous early and nearly free late.

### The one number that makes it a real decision

- **Armour is worth most early**: a contact costs 67 s at 15% of the race and
  7.8 s at 97%.
- **Surge is worth most late**: the gates it costs you are worth 5.19 s/mi at
  the gun and 0.039 s/mi at the end.

**Opposite time preferences, out of the shipped model, with no new tuning.** One
pool, two uses, and the player must decide in the first third whether to hold
reserve as insurance through the expensive miles or bank it for a late push.
They cannot do both. That is a strategy.

And the crash the owner wants is still there, honestly: a surge zone runs at a
683 ms window instead of 741 ms, an 8% cut, and it is where you chose to be. The
course is proved solvable at that speed and every hazard passes `shoot.js`, so
rule 4 is intact — the player was shown everything and elected to give
themselves less time to use it.

---

## Part 3 — more than one way, on a fixed course

Two policies that both finish 1:59:29 are only interesting if they differ in
kind. Three axes can do that here, and the first one **already exists**:

- **Accuracy vs. collection.** Perfect and ignoring every bottle finishes
  1:58:03. Three mistakes and taking all the aid finishes 1:59:13. Both beat the
  record, by genuinely different routes. And the detour is **already** priced in
  risk, not just in effort: `tools/aid.js` measures a 6%-fluff bot going 4.0 →
  **4.8 contacts** when it leaves the natural line to collect, while a flawless
  bot pays 0 extra contacts for the same detour. The axis is nearer than it
  looks. The reason it does not yet read as strategy is that one end is not a
  *choice* — nobody elects to be inaccurate. Give the currency a use for a clean
  run and both ends become choices.
- **Insurance vs. investment.** Armour early against surge late, above.
- **Gate count vs. gate speed.** The dense technical line banks streak; the
  sparse fast line banks seconds. The exchange rate is measurable and it moves
  across the race.

---

## The structures, ranked

### 1. The Effort tank — one pool, two rival uses  *(recommended)*

**The rule the player learns:** *bottles are not a rescue any more, they are a
budget — and you cannot armour the first half and sprint the last one.* Pickups
fill a small tank, capacity around three. Two units buys **guard**, which
absorbs one contact whole: streak kept, no time penalty. One unit buys
**surge**, a half-mile above the pace floor, legal only in the zones the
generator marked and spaced for it. The tank is small so it must be spent to
keep collecting, and the two uses peak at opposite ends of the race.

**What it demands:** a currency and a cap; `actionWindowAt` extended to read a
surge class the way it reads elevation; surge zones placed late where the gates
they cost are cheap; the risk lanes that fill the tank. Solvability is untouched
in structure — the BFS gains no states, only a wider window in marked zones, and
generation already orders that dependency correctly.

**What it breaks — say this out loud:** *"only an unbroken clean line makes you
faster"*, the most defended sentence in the codebase. A tank that buys speed is
a second source of speed. There is no way to give the owner a second axis
without touching it, because that rule is exactly what guarantees one optimal
policy. It also ends "aid is worth exactly zero to a perfect run", which was a
deliberate property. Both are worth trading; neither should be traded quietly.

**A/B:** yes, behind a scalar on the `NARROW`/`RAMP` pattern. With one caveat
that must be stated: surge zones change gate spacing, so at scalar > 0 the
course is **not** bit-identical and `tools/mechanics.js --identity` will
correctly say so. The A/B is between two different courses, both deterministic.
The record needs re-checking against the ~6% gate loss in surge zones.

### 2. Declared miles — commit your gear at the gantry

**The rule:** *at each mile gantry you declare the next mile, and you cannot
take it back.* Declaring PUSH lowers the pace **floor** for that mile — it does
not make you faster, it raises what an unbroken line is *worth*, so speed still
has exactly one source and rule-1-of-the-pace-model survives intact. A broken
run gains nothing from declaring, because it is nowhere near the floor; a clean
run gains up to 14 s/mi. The mile is spaced for the faster speed, so the window
shrinks for its whole length and the declaration is made before you see it.

**What it demands:** far less than #1 — no currency, no pickup economy, one
spacing class per mile, one input at the gantry.

**What it breaks:** on its own, it collapses. Pushing a mile pays 14 s and costs
maybe 6 points of hit probability against a contact worth 59 s, so pushing is
worth it nearly everywhere and the answer is "push all 26". **It needs a budget,
and the cleanest budget is the tank** — which makes this the delivery mechanism
for #1 rather than a rival to it. Shippable alone only with a flat allowance
(say six miles of 26), which is a weaker, more arbitrary design.

**A/B:** yes, and cleanly — a flat allowance version touches no pickup stream at
all.

### 3. The fast line — risk lanes that pay

**The rule:** *at most gates one lane is harder than it needs to be, and that is
the one that pays.* Extends what roof aid already does to the road: the hardest
legal lane at a qualifying gate carries tank. The player is making a small risk
decision several times a mile instead of a large one four times a race.

**What it demands:** almost nothing new — `aidLaneAt` already scores lanes and
already refuses to charge a chain of two actions for one item. Determinism and
solvability are untouched by construction.

**What it breaks:** nothing. Which is also the problem — alone it is a texture,
not a strategy, because there is still only one thing to do with what you
collect. It is the **filling mechanism for #1** and should be judged as part of
it.

**A/B:** yes, trivially, on its own seeded stream.

### 4. Committed forks — two proved corridors

**The rule:** *the road splits, you choose with your lane, and you live with
it.* At a handful of points the course divides into two multi-gate corridors —
one dense and technical, one sparse and fast — signed far enough out to be read,
uncrossable once entered. This is the most literal answer to "more than one way
to beat the record": the run becomes a route string, and because the course
repeats all day and the store already tracks best-of-day across repeat attempts,
**learning the day's fork table is itself the strategy.** That is a Wordle-shaped
loop and it fits this game's daily frame better than anything else here.

**What it demands:** the most of any option. Both branches generated and proved
independently; `validate` extended to walk a graph rather than a list; the
sightline and spacing floors enforced *through* the split; `shoot.js` framing
both branches, because a hazard the player could not see is a build failure on
the road not taken as well.

**What it breaks:** the draw-call budget is the live risk — ~300 against ~400,
and a fork shows two corridors at once. Cost it before committing.

**A/B:** yes, but it is the most expensive thing here to build and the hardest
to withdraw. Recommend it *after* #1 has proved that players want to make
choices at all.

### 5. Rejected — open throttle

**The rule that would be:** *hold to accelerate; overcook it and you crash.* A
continuous, revocable speed control with crash risk attached.

**Why it is refused.** It is the mechanism the owner's words most directly
describe, and it does not work. The punishment is self-correcting — crashing
costs speed, so the system settles at "as fast as you can control", which is a
skill-expression knob and not a decision. Nothing is ever *allocated*, so no run
can be over-committed and there is no second way to be right. It is also the
only proposal here that cannot be made provably fair: a freely-variable speed
means the reaction window is set by the player frame to frame, so either the
course is spaced for the maximum — in which case the whole course is
over-spaced, easy, and the throttle is free — or it is not, and a player at full
throttle meets a gate they could not act on, which is a build failure under rule
4 rather than a difficulty choice. **The feeling the owner wants is real; a
throttle is not how to deliver it.** #1 and #2 deliver it by making speed a
purchase.

---

## What I would measure before building anything

1. **Extend `tools/simulate.js` with a policy sweep**, not a skill sweep. Ten
   spend policies against the same four dates: guard-early, surge-late,
   split, never-spend. If two distinct policies do not land within about 15 s of
   each other, the tank is not balanced and no amount of art will hide it.
2. **Re-derive the record.** A 6% gate loss in surge zones moves the flawless
   finish. The 86.2 s margin and the "survives exactly one mistake" contract are
   the game's advertised wager and must be re-proved, not assumed.
3. **Measure the window cost honestly.** 741 ms → 683 ms is a geometry claim,
   not a difficulty claim. What it does to real hit rates is an unmeasured
   number, and rule 3 says an unmeasured number is worse than none.
