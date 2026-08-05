# Reference measurements

Ten frames supplied by the user, cropped to the game viewport and used as the
comparison target.

| File | Game | Shows |
|---|---|---|
| `tr-run-01/02` | Temple Run | running |
| `tr-jump-01/02` | Temple Run | mid-jump |
| `tr-turn-01` | Temple Run | cornering |
| `ss-run-01/02/03` | Subway Surfers | running, hoverboard, wild-west biome |
| `sonic-01/02` | Sonic Forces Speed Battle | loop landmark, Golden Gate track |

**Subway Surfers and Sonic are the art-direction target.** Temple Run is
textured semi-realism and is a strong reference for framing and readability
only. Where they disagree, the toy games win.

## The problem with comparing frame-height fractions

All three references are portrait (~0.45:1); this game is landscape (1.57:1).
"Character is N% of frame height" is not comparable across those — the same
character at the same camera distance scores completely differently just from
aspect. The ratios below marked **aspect-independent** are the actionable ones.

## Measured

| Metric | Temple Run | Subway Surfers | Sonic | This game |
|---|---|---|---|---|
| **Character ÷ lane width** (aspect-independent) | 60% | **37–43%** | ~40% | **33% → 46%** |
| Character centre, fraction down the frame | 77% | 70–75% | 64–78% | **52%** |
| Character ÷ frame height | 14.5% | 21–33% | 18–21% | 36% (not comparable) |
| Ink outlines | none | **none** | **none** | heavy |
| Contact shadow under character | yes | yes | **yes, strong** | **none** |

## Findings, in priority order

1. **The track is ~1.7× too wide relative to the runner.** Target
   character-to-lane of ~40%; we are at 23%. This is a pure geometry ratio,
   invariant to camera distance, so no camera change fixes it. It needs
   `LANE_X` / `TRACK_HALF_WIDTH` narrowed with matching hazard widths — which
   touches the thresholds `src/game/collision.js` audits. (Temple Run's 60% is
   the outlier; the toy games sit near 40%, so 40% is the target, not 60%.)

2. **None of the three reference games use ink outlines.** They read as "toy"
   through saturated flat colour, soft shading, chunky proportions and a
   strong contact shadow — silhouette separation comes from colour contrast,
   not a black line. This game currently leans hard on outlines. That is a
   real divergence from the stated target and needs a deliberate decision
   rather than drift: the defensible middle is to keep a light outline on the
   runner and hazards, where it buys gameplay readability, and drop it from
   scenery, where it is only costing draw calls and flattening depth.

3. **No contact shadow.** Every reference grounds its character with one. Ours
   floats. Cheap to add, disproportionately effective.

4. **The character sits too high in frame.** References place the runner
   64–78% down; we are at 52%, spending the upper half on sky rather than on
   the road the player has to read.

5. **Oversized foreground props cropped by the frame edge.** Subway Surfers
   runs a giant sushi chef and a stacked burger straight through the frame
   edge; Sonic has the loop and the Golden Gate. This is where their sense of
   speed and their "wow" both come from, and we have nothing in that layer.

6. **The route is telegraphed several gates ahead** by coin and ring trails.
   This game's entire mechanic is holding a clean line and it gives the player
   no forward read of where that line is. This is the most direct mechanical
   borrow available.

7. **Rivals are physical characters on the track with floating name labels**
   (Sonic: "Tails", "Shadow", "Knuckles", plus a "4th" position badge). Our
   1:59:30 record ghost exists only as a number on the HUD. Putting it on the
   road as a runner you can see ahead of you — and watch fall behind when you
   pass it around mile 20 — would make the entire record chase physical. This
   is the single strongest idea in the reference set for this specific game.

## Deliberately not copied

- Texture density. Temple Run's photographic stone; Subway Surfers' painted
  detail. This game is flat-shaded by design. The lesson is that flat surfaces
  still need *some* variation to avoid reading as raw primitives.
- The HUD. All three use ornamental game UI; this game's readout is
  deliberately a broadcast race clock and should not converge on them.
- Coins as a score currency. The reward here is pace, not pickups — but see
  finding 6 for the part worth taking.


## Correction to the character-to-lane figure

The 23% originally recorded here was measured on the wrong feature. It is the
width of the vest cone alone (0.524 units), which excludes the deltoids --
and the deltoids are the same colour as the vest and *are* the visual shoulder
line. Measured properly from `src/render/runner.js` geometry, the deltoids are
r=0.134 spheres at x=±0.244, giving a 0.756 static shoulder line and ~0.78
live once chest counter-rotation is included.

On the correct ruler the track change is **33% → 46%**, which lands inside the
37–43% reference band rather than merely approaching it.

Note also that `LANE_W` stopped at 1.70 rather than the 1.38 a literal 1.7x
would give. That is a hard geometric floor, not caution: the runner's gloves
swing to ±0.543 and a DUCK frame's standards sit at 1.20·LANE_FIT ± 0.13 from
their lane centre, so `0.543 + 0.511·L + 0.13 < L` requires L > 1.375 for zero
clearance. Below about 1.68 the runner visibly grazes hazards it legitimately
cleared, which would directly contradict the state-based clearance model in
`src/game/collision.js`.
