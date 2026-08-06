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

## Video reference (added after the first real playtest)

Four screen recordings supplied by the user: two of this game, one of Subway
Surfers and one of Temple Run, all in MOTION rather than as stills. Frames are
pulled with `tools/frames.py`. Three are kept here:

| File | Shows |
|---|---|
| `tr-slide-01/02` | Temple Run's slide, from directly behind |
| `ss-jump-01` | Subway Surfers' jump |

### Why Temple Run's slide reads and ours does not

This is the frame that settles three failed attempts at the slide pose. In
Temple Run the sliding character is **flat on their back with the head out of
the silhouette entirely**. What the camera sees, front to back, is: both legs
laid out fully forward up the path, then the torso, then the top of the
shoulders nearest the lens. Arms are out wide. There is no head-at-top /
feet-at-bottom ambiguity because there is no visible head.

This build does the opposite. `runner.js` deliberately keeps the head level
through the slide -- the neck cancels most of the spine recline "so it
presents hair and headband, not a chin or a crown" -- and the headband is the
brightest thing on the character. So the figure reads as an upright head above
a low body, which is a crouch, and no amount of leg extension fixes it while
the head is still the top of the shape.

The fix direction is therefore the reverse of what was tried: drop the head
INTO the body and let the back become the top of the silhouette, so the legs
are unambiguously the leading edge.

### The forgiveness windows are too tight for a human

The player's own run: race time 5:32 to 7:27, mile 0.99 to 1.33, `CLEAN GATES`
reads **0 in every frame**, with `STREAK CUT / SPEED BLEEDING` showing
throughout and pace never leaving 5:30/mi. They are visibly trying -- one
frame catches a committed jump, arms wide, over a gantry.

`DUCK_CLEAR` is 0.90 and `duck01` ramps at rate 16 and decays after
`DUCK_TIME` 0.55s, so a slide only counts inside roughly a 0.4s window, about
9 world units at race pace. `JUMP_CLEAR_Y` was raised 0.62 -> 0.84 for visual
honesty with the same effect. The autopilot clears these easily because it
acts on exact distances; a human on a phone does not.

The whole game rests on building a clean streak, and on this evidence a human
currently cannot start one.

---

# Evaluation against the video reference

Frame-by-frame, from `tools/frames.py` at 10fps. Strips in `shots/video/`.

## Subway Surfers — what its depth is actually made of

Six distinct layers, and we have three of them.

| # | Layer | Subway Surfers | This game |
|---|---|---|---|
| 1 | Play surface | train roofs, the LIGHTEST, most saturated mass in frame | road, lifted but still the flattest |
| 2 | Track bed | **dense repeating sleepers**, every ~1 unit | lane dashes every ~12 units |
| 3 | Roadside furniture | barriers, crates, traffic lights, chevron signs | barriers, kerbs |
| 4 | Midground | buildings, tents, hoardings with signage | buildings |
| 5 | **Overhead** | catenary wires + gantries crossing the frame CONSTANTLY, at several depths | mile gantries only, every 240 units |
| 6 | Sky | banded | banded |

### The single biggest thing we lack: ground frequency

Subway Surfers' track bed is railway sleepers -- a hard perpendicular stripe
roughly every world unit. At speed that is a strobe streaming under the
player, and it is the dominant speed cue in the game. Our road carries lane
dashes about every 12 units: an order of magnitude less frequent, so most of
the largest surface on screen is flat colour that never changes.

This is the same gap the camera pass reported from the other side -- "the road
carries no motion signal between the dashes" -- and it is a WORLD fix, not a
camera one. The camera has already been pushed to the edge of what framing can
do (it turns an honest +15% ground speed into +37% of screen flow); the
remaining headroom is in the surface itself.

### Overhead is half the parallax

Wires and gantries cross the frame every second or two, at several depths.
Because they pass close to the lens and sweep top-to-bottom fast, they give
vertical parallax that ground detail cannot. We have nothing between mile
markers.

## Subway Surfers — animation

- **Jump: orange radial speed streaks burst from the character**, plus arms
  flung wide. The VFX does as much work as the pose.
- **A hard-edged elliptical drop shadow sits on the surface below** through
  the whole arc. It is a landing reticle: you always know where you will come
  down. Ours has a contact shadow but it is soft and fades in air.
- **Landing fires another burst.**
- **Coins arc vertically through the air** along the jump path, so the route
  is drawn in 3D rather than painted flat on the ground.
- Obstacles are REAL STREET AND RAIL FURNITURE -- traffic lights, red/white
  chevron barriers, crates, train cars -- never abstract coloured blocks.

## Temple Run — the slide, settled

Frames 1-3 sliding, 4-6 recovering. Sliding, the character is FLAT ON THEIR
BACK with the head completely out of the silhouette: legs extended fully
forward up the path, then torso, then arms out wide nearest the lens. The
shape is a low wide X. Recovering, the head appears and the figure becomes an
upright column. The two states cannot be confused for one frame.

Ours keeps the head level and bright (headband) at the top of the figure, so
it reads as a crouch. See the note above: extending the legs can never fix a
shape whose top is a head.

## Priority order for this game

1. **Widen the action forgiveness windows.** A human cannot currently start a
   streak; the whole game rests on it. Blocking.
2. **High-frequency road surface.** Biggest single win for speed and depth.
3. **Overhead structure between mile gantries.**
4. **Drop the head out of the slide silhouette.**
5. **Jump/landing VFX and a hard landing shadow.**
6. **Obstacles as street furniture** -- cones, works signs, detour arrows,
   barriers -- rather than abstract blocks.
7. **Living cross traffic** -- pedestrians on crossings, cyclists -- to sell a
   city closed for a race rather than an empty corridor.
