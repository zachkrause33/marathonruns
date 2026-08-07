# Reference measurements

> ## THE TRIANGLE BUDGET IN THIS DOCUMENT IS WRONG
>
> Sections written before this note cost their recommendations against a
> **75,000** or **150,000** triangle ceiling, and several decline detail on
> that basis. **Both numbers were invented.** Every frame-rate figure in this
> project came from SwiftShader software rendering, 50-100x slower than a real
> GPU, and a ceiling was built on top of it and then defended across three
> passes.
>
> Measured properly, the game runs at **108k-192k triangles and 157-294 draw
> calls**, and the owner has confirmed it runs without issue on their phone.
> **The working ceiling is 500,000 triangles.** Peak is currently 38% of it.
>
> **Draw calls are the real constraint, not geometry** -- each submission
> carries CPU cost, and that is what bites first in Three.js. Keep the peak
> under about 400. Merging and instancing are still the right tools; they are
> tools for draw calls, not for triangles.
>
> Where an older section says "this costs too much", read it as "this costs
> N", and decide again. Three separate agents declined detail they had
> correctly measured as affordable because a brief told them geometry was
> scarce.


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

---

# Tom Gold Run — the new quality bar

Three frames supplied by the user and named as the target for road, obstacles
and setting.

| File | Shows |
|---|---|
| `tgr-city.png` | city street: tram + parked car as obstacles, curved lamps arcing over the road, kerb railings, hazy skyline |
| `tgr-sunset-ramp.png` | beach town at sunset: wooden **ramp with a chevron**, guard rail, bin, palms, big sun |
| `tgr-egypt.png` | Egypt: tiled runway flanked by grass, sarcophagus + obelisk, pyramids in haze, market awnings |

## The measurement is exact this time

The game card inside each screenshot is **x 114–1090, y 375–2492 = 977 x 2118
px, aspect 0.46128**. Our portrait shoot at 620 x 1344 is **0.46131**. To five
figures the two viewports are the same shape, so unlike the Subway Surfers
comparison every fraction-of-frame number below IS directly comparable and
nothing has to be marked aspect-independent.

Frames of ours: `node tools/build.js --out /tmp/dm.html` then
`node tools/shoot.js --file /tmp/dm.html --dir /tmp/adp --out pN --q
"bot=1&skip=N" --w 620 --h 1344`, at skip 10 / 60 / 120 / 190 / 235.

Luminance below is `0.2126R + 0.7152G + 0.0722B` on the sRGB byte values, on
both sides, so the ratios are consistent even though the absolute figures are
not photometric.

---

# 1. The road

## The four beliefs, checked

**"Their road is not a flat colour — lighter down the centre, darker toward the
kerbs." CONFIRMED, and it is the strongest single fact in the frames.**

`tgr-city.png`, luminance sampled across the carriageway at four depths, as a
fraction of the road's own width:

| screen y | road span (px) | 8% in | 20% | 35% | 50% | 65% | 80% | 92% | edge ÷ centre |
|---|---|---|---|---|---|---|---|---|---|
| 1150 (far) | 507–696 | 93.4 | 91.0 | 98.0 | **101.5** | 95.4 | 80.2 | 74.2 | **0.73** |
| 1250 | 487–725 | 76.3 | 78.5 | 89.4 | **94.2** | 87.9 | 74.5 | 72.0 | **0.76** |
| 1400 | 452–764 | 73.2 | 74.9 | 88.9 | **95.2** | 88.1 | 77.9 | 73.0 | **0.77** |
| 2440 (near) | 137–1067 | 51.6 | 56.9 | 68.6 | **75.7** | 72.9 | 55.6 | 51.2 | **0.68** |

`tgr-sunset-ramp.png` is the control and it agrees: base tarmac is
`rgb(88,56,42)` L=61.8 at both kerbs at y=2250 and y=2450, rising to L=82.4 at
the crown. **Edge ÷ centre = 0.75, at two depths, to within 0.5 of a level.**

So the shape is a **smooth continuous dome across the whole carriageway,
peaking at the crown, edge at 0.68–0.77 of centre**. It is not a step, it does
not key to lane boundaries, and its amplitude *decreases* with distance
(0.68 near, 0.77 far) because haze compresses contrast.

**"A second gradient in depth." CONFIRMED, but the sign is the opposite of the
obvious guess.** The city road's crown runs L=75.7 at the bottom of the frame
to L=101.5 near the vanishing point: **the road gets 34% LIGHTER with
distance**, not darker. The kerb line lifts harder still, 51.6 to 74.2, +44%.
Both are running toward the fog value.

**"Lane markings read all the way to the vanishing point." PARTLY WRONG, and
this is a place where we are already better than the reference.** Marking
contrast against the local road, city frame:

| screen y | fraction of road depth from the bottom | brightest paint | local road | ΔL | ratio |
|---|---|---|---|---|---|
| 1750 | 54% | 250 | 88 | 162 | 2.8 |
| 1700 | 58% | 227 | 69 | 158 | 3.3 |
| 1560 | 68% | 93 | 76 | **17** | 1.23 |
| 1420 | 78% | 96 | 83 | **14** | 1.16 |
| 1240 | 91% | 96 | 90 | **6** | 1.07 |
| 1180 | 96% | 99 | 96 | **3** | 1.04 |

Near-field contrast is enormous (ΔL 155–180, ratio 3.3–3.9 — the sunset frame's
white lines are `rgb(250,241,217)` L=241 on a road of L=61.8, **ratio 3.90**).
But by 68% of the way to the vanishing point the markings are down to ΔL 17 and
by 90% they are gone. **The far third of their road is featureless haze.** Ours
carries its seams into the fog. Do not "fix" this.

**"The Egypt runway is a strongly patterned repeating tile band with a hard
colour break against green either side." CONFIRMED — but the break is a HUE
break, not a value break, and that distinction is the whole reason it is worth
copying into a banded-toon renderer.**

Egypt cross-section at y=2400, kerb outward:

| band | rgb | L | S |
|---|---|---|---|
| grass | 114,203,85 | 175.6 | 0.58 |
| gold rail | 229,199,85 | 197.1 | **0.63** |
| blue tile on the rail | 120,160,209 | 155.0 | 0.43 |
| cream deck (the running surface) | 249,232,180 | **231.9** | 0.28 |

- grass → gold rail: **ΔL = 22 (11%)** but ΔR = **115**. Nearly no value step at
  all. The edge of the runway is drawn almost entirely in hue.
- gold rail → cream deck: ΔL = 35 (18%), **ΔS = 0.35**. A saturation step.
- blue tile on gold: ΔL = 42, but ΔB = **124**. Chroma again.

Tile period. Five consecutive tiles on the left rail have centres at screen
y = 2390.5, 2248.5, 2138.0, 2046.5, 1978.0. Against a horizon fitted from the
rail-to-rail width (which is beautifully linear in y: slopes 0.641 / 0.639 /
0.632 over three intervals, giving y_vp = 1283), the reciprocal depths step by
1.328, 1.339, 1.401, 1.291 x10^-4 — **uniform in world depth to within 4%**.

- period ÷ depth-of-nearest-tile = **0.148**
- period ÷ runway width = **0.40** (bounded 0.35–0.48 across a 50–65° vertical
  FOV; this ratio is the one quantity here that is not FOV-free, so it is
  quoted as a range and the midpoint used)
- ~**33 periods** are individually resolvable from the near edge out to where
  the period falls below 4 px.

On our 5.10-unit carriageway that is a **2.0-unit period** — which is already
exactly `PAVE_JOINT`, the kerb-notch spacing.

The structural point is more useful than the number: the Egypt pattern is a
**longitudinal rail carrying perpendicular beads**. The rail converges on the
vanishing point, so perspective *lengthens* it in screen space and it survives
to depth; the beads ride it and supply the beat. Our expansion joints are
full-width perpendicular stripes with no rail — `world.js` already concedes
they are sub-pixel past forty units — and our lane seams are rails with no
beads. Neither half is doing the Egypt job on its own.

**"Soft contact shading under every object that touches the road." CONFIRMED,
and it is a clean multiply.**

| object | shadow rgb | road rgb | per-channel ratio |
|---|---|---|---|
| parked car, city | 47,48,63 | 83,85,112 | 0.57 / 0.56 / 0.56 |
| runner, Egypt | 186,172,135 | 249,232,180 | 0.747 / 0.741 / 0.750 |
| tram spill, city | 78,83,104 | 91,96,122 | 0.857 / 0.865 / 0.852 |

Every one is the same number on all three channels to within 0.01. **They are
not painting a grey shape, they are multiplying the surface.** Depth runs
0.57 for a hard contact under a car to 0.86 for the ambient-occlusion spill
several units out from a tram.

## What was missed, and it is the big one

**Their road is dark. Ours is not.**

| surface | luminance | as a fraction of white |
|---|---|---|
| TGR sunset tarmac | **62–82** | 0.24–0.32 |
| TGR city tarmac | **51–101** | 0.20–0.40 |
| Subway Surfers track bed (`ss-run-01`, y = 88% down the frame) | **87** | 0.34 |
| ours, THE BRIDGE centre lane | 166–167 | 0.65 |
| ours, THE WALL centre lane | 163 | 0.64 |
| ours, CITY START centre lane | **188–190** | **0.75** |

Our road is **1.8x to 2.6x** the value of every reference surface a runner
actually runs on. This is the largest continuous area on screen, so it sets the
contrast ceiling for everything standing on it.

This is not drift, it is a decision, and `world.js` lines 115–138 records it:
the road was deliberately lifted because "in both Subway Surfers shots the
surface the player runs on (crimson train roof, mint train roof) is among the
LIGHTEST and most saturated large masses in frame". **That reading was of the
train roofs, not of the ground.** Measured on the same frames, the ballast
between the rails — the surface the player is on for most of a run — is L=87.
The three references agree on 62–87. The lift over-corrected by about a factor
of two.

Everything else in the road section falls out of this one number:

- our lane paint is `0xfff6d8` L=245.7 on a road of 166–190, ΔL 56–80,
  **ratio 1.29–1.48**. TGR's is ratio **3.3–3.9**. Darken the road to L≈100 and
  the same unchanged paint lands at ratio 2.46, ΔL 146.
- our carriageway edge line `0xf2f4ff` L=244.4 behaves the same way.
- our expansion joints swing L=93.9 (groove) to L=217.9 (lip) around a slab of
  166 — a **±40% swing every 1.2 units**. On a light road that reads as a cattle
  grid. On a dark road the same quads read as cuts in tarmac.

## Our cross-width profile, measured

The three lane bands ARE reaching the screen and they are exact. Corrected
reading (the two `L=245.7` lines are the lane SEAMS `0xfff6d8`; the outer
`L=244.4` lines are the carriageway edge `0xf2f4ff` — confusing them is what
made a first pass conclude the tinting was dead):

| frame | lane 0 (screen left) | lane 1 (centre) | lane 2 (screen right) | ratios |
|---|---|---|---|---|
| p120, y=1060 | 128.1 | 166.0 | 146.1 | 0.771 / 1.000 / 0.880 |
| p10, y=1060 | 147.0 | 190.0 | (off-frame) | 0.774 / 1.000 / — |
| p235, y=1000 | 181.0 | 159.0 | 152.0 | — |

Predicted from `LANE_BAND = [0xbac7de, 0xffffff, 0xe8e0d4]`: 0.776 / 1.000 /
0.881. **Delivered to within 0.006.** The system works exactly as documented.

Side by side:

| | TGR | ours |
|---|---|---|
| shape across the width | smooth dome, one continuous surface | **3-step staircase locked to lane boundaries** |
| edge ÷ crown | 0.68 near, 0.77 far | 0.77 (lane 0) — but flat *within* each lane |
| symmetric? | yes | **no, deliberately** (0.77 vs 0.88, so the two outer lanes differ from each other) |
| absolute crown value | 62–101 | 166–190 |
| depth gradient on the crown | +34% toward the VP | flat, then a sudden fog wash |
| ground frequency | **none at all** on the city and sunset roads | a joint every 1.2u, heavy every 4.8u |

Read that last row twice. **Tom Gold Run's road has no high-frequency detail
whatsoever.** Its speed comes from the gold-bar trail, the props and the
overhead lamps. We have an order of magnitude more ground detail than the
reference we are being asked to match.

## Spec: what the road becomes

**R1. Drop the biome road values.** Target centre-lane luminance **L = 100 ± 8**
in every biome, from the present 146–190. That is deliberately *above* all
three references (62–87) rather than at them: it keeps the earlier decision's
instinct that the play surface should be the lit mass and stops it being 2.6x
too light. `BIOME_LOOK.road` only; the lane bands multiply down from it, so the
staircase and the ramp cross-fade follow for free. **Cost: zero.** No geometry,
no draws, no triangles.

Second-order consequences to expect and not to "fix": the joint pair
(93.9 / 217.9) will read much harder against L=100 — knock the lip from
`0xeae7f6`/`0xdbd8ea` to about 70% of its present value so the joint stays a cut
and does not become a second set of markings.

**R2. Camber the carriageway.** Add a continuous dome ON TOP of the existing
lane staircase, keyed to |x| and not to lane index, so three lanes read as one
cambered surface with lanes drawn on it:

    camber(x) = 1 - 0.22 * (|x| / K.TRACK_HALF_WIDTH)^2

giving 1.00 at the crown and 0.78 at the tarmac edge. Combined with the lane
staircase the outer edge of lane 0 lands at 0.78 x 0.78 = **0.61 of the crown**,
against TGR's measured 0.68 — slightly stronger, which is right because we are
translating a smooth gradient into a banded renderer and need the extra step to
survive quantisation.

Implementation: `merge()` paints one flat colour per part, so do not try to
put a per-vertex ramp through it. Split each `laneBand` into **5 constant-colour
strips of width LANE/5**, each tinted `LANE_BAND[l] * camber(strip centre)`.
15 strips per tile instead of 3 quads. **Cost: 30 triangles per road tile
instead of 6, i.e. +24 triangles/tile, and zero extra draw calls** — they merge
into `roadGeo` exactly as the bands do now. At ~10 live tiles that is +240
triangles against a 26k–105k budget: **0.2–0.9%.**

This is a **translation, not a copy**. TGR's dome is partly a screen-space
vignette; we cannot have one without a post pass, so it is baked in world space
across the carriageway. At the bottom of a portrait frame the outer lanes *are*
the frame corners, so the two produce nearly the same read there, which is where
it matters most.

**R3. Bead the seams — the Egypt device, translated.** Keep the two lane seams
and the two carriageway edge lines exactly where they are; they are the
converging rail. Add a **0.30 x 0.30 bead every 2.0 world units** centred on each
of the four lines. Period 2.0 is the measured Egypt period scaled to our
carriageway (0.40 x 5.10 = 2.04) and is already the `PAVE_JOINT` spacing, so the
kerb notches and the road beads beat together.

**Divergence, stated:** Egypt's beads are a chroma break (blue on gold at
ΔL 42 / ΔB 124). Ours must be a **value** break, because the telegraph mats own
amber, cyan and pink at full saturation and nothing on the road may compete with
them — that rule is older than this document and is right. So: seam base drops
to about `0x8e8aa8` (L≈140) and the bead keeps `0xfff6d8` (L=245.7), turning
each seam into a bright-beaded dark rail. Against the new L=100 road the rail is
1.4x and the bead 2.5x, which is the same three-level ladder Egypt has, drawn in
value instead of hue.

**Cost: 4 lines x 12 beads per 24-unit tile = 48 quads = 96 triangles per road
tile, merged into `paintGeo`, zero extra draw calls.** ~+960 triangles live:
**0.9–3.7%.**

**R4. Contact shading under everything that touches the road.** Measured target
is a **multiply of 0.60 ± 0.03 directly under a hazard's footprint, easing to
0.85 at the rim**, matching the car (0.57) and the tram spill (0.86). A flat
opaque quad cannot multiply, and a per-hazard blended material would cost a draw
each. Put every live hazard's contact quad into **one pooled overlay mesh**
sharing the material the telegraph mats already use (y = 0.012, `depthWrite`
off): **+1 draw call total, 2 triangles per hazard.**

Ours currently manages 0.852 under the runner (p120, y=1060: floor 141.4 on a
road of 166.0) and nothing measurable under hazards. `MEASUREMENTS.md` finding 3
called for the runner's shadow and it landed; the hazards never got one.

**R5. Do not add ground frequency.** We already exceed the reference. If
anything, once R1 lands, re-measure whether the 1.2-unit joint is still earning
its place or whether the 4.8-unit heavy joint alone reads better on a dark road.

---

# 2. Obstacles

## Why theirs read, measured

| object | own L | local road L | ratio | own S | road S |
|---|---|---|---|---|---|
| sunset guard rail | 186.7 | 73.0 | **2.56** | 0.20 | 0.47 |
| sunset ramp deck | 181.6 | 73.0 | **2.49** | 0.56 | 0.47 |
| city tram roof | 163.5 | 78.0 | **2.10** | 0.28 | 0.22 |
| city parked car body | 76.4 | 78.0 | **0.98** | **0.60** | **0.22** |
| sunset trash can | 73.7 | 73.0 | **1.01** | **0.25** | **0.47** |

The first three are pure value. **The last two are the interesting ones: the
blue car and the grey bin are the same luminance as the road they stand on, to
within 2%, and are still instantly legible.** The car is legible because its
saturation is 2.7x the road's; the bin because its saturation is *half* the
road's. Either direction works. What never happens is an object that matches the
road on both axes.

So the rule is not "value contrast is the whole game". It is:

> **Every hazard's area-weighted mean must differ from the local road by a
> factor of ≥ 1.6 in luminance, OR by ≥ 0.30 in saturation at similar
> luminance.** One or the other, measured, no exceptions.

## Ours fails that test today

The JUMP chevron block in `p10`: stripes alternate **L=120 and L=216** on a road
of **L=189**. Area-weighted mean **168 = 0.89x the road** — the object's average
is *darker than the tarmac by 11%*, and its bright stripe is only **+14%** above
it. At the distance where the stripes alias together, which on a 620-px-wide
portrait frame is about forty units, the hazard's mean converges on the road's
and the silhouette stops existing. The stripes are doing all the work and they
are a near-field-only device.

This is the same finding as R1 from the other end. **Darkening the road to
L=100 moves that same unchanged block from 0.89x to 1.68x and it passes the test
with nothing else touched.** That is why R1 is first.

## Spec: the vocabulary

Hazard heights, half-depths and clearance thresholds are fixed by
`collision.js` and `constants.js` and none of the below moves any of them. All
of it is silhouette, value and dressing.

**JUMP — a low block you clear.** The player's only question is *where is the
top edge*. So: a dead-flat horizontal cap spanning the full lane, cap in the
frame's brightest neutral at **≥ 2.2x the road**, body at **≤ 0.75x the road**,
and the cap at least 12% of the object's height so it survives to sixty units as
more than a line.

Real objects: a **builder's skip** with a cream lip; a **stack of market crates**
under a tarpaulin; a **low concrete works barrier** with a lit reflective top
rail; a **kerbside sandbag line** with a white-taped top course. All of them are
things that *sit* on a road, all of them naturally have a bright top and a dark
body, and none of them can be confused for something you could pass through.

**DUCK — an overhead bar you slide under.** The read is not the bar, it is the
**void**. Two rules that follow: the brightest edge in the object must be the
**underside** of the bar (it is the boundary of the gap), and the two standards
must not be the brightest thing — right now they are the tall vertical accents
and a tall bright vertical is the silhouette of a BLOCK. Second: **the gap must
always frame lit road**, never a solid, so the player sees through it from the
moment it enters the read window.

Real objects: a **scaffold tower** crossing the pavement with a lit soffit; a
**shop awning** overhanging the road on two poles; a **race banner** slung
between two lamp posts; a **level-crossing barrier**. The awning is the strongest
— TGR uses exactly it in the Egypt frame's market — because a fabric soffit is a
big pale plane that is *only* visible from underneath, which is the sightline a
sliding player has.

**BLOCK — impassable, change lane.** The read is "solid, all the way up, in one
glance". So the silhouette must be a single unbroken mass from road to top with
**every internal detail held inside a 0.3 value range**, so that nothing inside
it can be mistaken for a gap under a bar. No flat horizontal top edge anywhere
in the jump band. No bright horizontal band across the middle.

Real objects: a **tram** (TGR's own choice, and the right one — long, tall,
unmissable, and its length sells speed as it passes); a **delivery van with its
back doors open** so the dark interior reads as depth rather than as a hole you
could pass through; a **skip lorry**; a **ROAD CLOSED barrier with two
marshals**. We already have inhabited hazards — the cargo trike with a rider,
the marshals at a barrier — and they are the best things in the current set.
Extend that, do not replace it: TGR's obstacles are uninhabited and ours are
better for having people in them.

## The ramp in `tgr-sunset-ramp.png`

Measured, because a later mechanic will be built against this.

- **Deck** L=137–195 against a road of L=62–73: **2.2x to 2.9x**. It is the
  brightest large mass in the lower half of the frame.
- **The toe is two steps, not one.** Scanning up the centreline at x=600:
  road L=66.4 → **front face L=117 (1.76x)** → deck L=185 (2.80x). The
  intermediate face is what makes it read as a wedge with a thickness instead of
  as paint on the road.
- **A hard bright rim at the very lip**: L=238.6 for about 4 px, above the
  deck's own 180. A specular line marking exactly where the ramp begins.
- **Black-and-gold diagonal hazard chevrons down both flanks**, full length.
  These are the taper indicator — they converge with the ramp's sides, so the
  rate at which they close is the rate at which the ramp narrows, read
  peripherally without looking at it.
- **The white chevron arrow**: L=237 on a deck of L=153, **ratio 1.55, ΔL 84**,
  sitting about 55% up the visible deck, pointing up-ramp. It is not at the
  bottom and not at the crest.
- **The deck's value dips along its length** — 195 near, 137 at mid, 225 at the
  crest. That trough is the tilt cue: it is the part of the surface turned
  furthest from the light.
- **The gold-bar trail leaves the crest and arcs UP into the air**, rising about
  130 px above the lip before falling away. The trajectory is drawn in 3D, in
  the world, before the player commits. This is `MEASUREMENTS.md` finding 6 and
  the Subway Surfers "coins arc vertically through the air" note, and it is the
  single most important thing in this frame: **the ramp is not a jump prompt, it
  is a jump plus a visible landing point.**
- **Width ≈ 0.67 of the kerb-to-kerb road**, i.e. about two of our lanes.
  **Do not copy that.** Ours must be exactly one lane wide or the lane-change
  contract stops being honest. Explicit divergence.

---

# 3. Setting around the track

## Atmospheric perspective, measured

Connected-component analysis of the city frame's foliage (same object class at
many depths; apparent size sqrt(area) is the depth proxy, HUD text excluded):

| apparent size (px) | saturation | luminance |
|---|---|---|
| 228 (nearest) | 0.544 | 140 |
| 102 | 0.554 | 152 |
| 84 | 0.319 | 164 |
| 47 | 0.380 | 144 |
| 31 | 0.162 | 165 |
| 26 | 0.199 | 197 |
| 8.5 (farthest) | **0.116** | **202** |

Egypt confirms the same curve on grass: near S=0.578 L=165 → far S=0.317 L=154 →
the pyramid at the far plane **S=0.073 L=232**, which is the sky.

**The falloff curve, and the important part is that the two axes do not track:**

- **Saturation collapses fast.** From 0.55 to 0.16 over a 9x depth increase.
  Fitting an exponential, saturation e-folds over about **6.5x the near-prop
  depth**. At the far plane it is **0.07–0.12**, essentially achromatic.
- **Value lifts slowly.** 140 → 202 over the same 9x, which is only **44% of the
  way** to the fog value (skyline 217, sky 168).

So the reference desaturates about **three times faster than it lightens**.

## Our fog is the wrong shape, and its far plane never completes

Measured live: `THREE.Fog`, linear, **near 60, far 300, colour `0xdff0ff`**
(L=237, S=0.13). `VIEW = 210`, so nothing is ever spawned past 210.

Two problems.

1. **Linear fog mixes toward the fog colour, so it lifts value and kills
   saturation at exactly the same rate.** That is the one thing the reference
   demonstrably does not do.
2. **The far plane never resolves.** At the spawn distance of 210 the fog factor
   is (210−60)/(300−60) = **0.625**. The most distant object on screen still
   carries **37.5% of its own colour and chroma**, so props arrive with visible
   contrast instead of condensing out of haze. TGR's far plane is fully
   dissolved (pyramid S=0.073).

**S1. Pull `far` from 300 to 215.** Then a prop at the spawn distance arrives at
fog factor 0.95 and pops in at near-zero contrast. Keep `near` at 60 — gates are
read at 40–90 units and a gate at 90 sits at fog factor 0.19, which is a useful
depth cue and not a legibility cost. **Cost: one number, zero runtime.**

**S2. Bake the saturation collapse; let the fog carry only the value lift.**
Any prop whose spawn distance exceeds 120 units gets its vertex colours
pre-mixed **45% toward the fog colour at bake time**, so the runtime fog only
has to carry the remaining 55%. The distant hills already do a crude version of
this (flat `0xd0d0d0` / `0xa8a8a8` cones at 190–250 units). **Cost: zero at
runtime** — it is a colour change in the bake, and the meshes are already merged
and vertex-coloured.

**Stated as a translation, not a copy.** TGR gets the decoupling with a genuine
depth-dependent desaturation in its shader. We cannot add a term to
`MeshToonMaterial` without losing the banded gradient map, which is the art
direction and is not negotiable. Two pre-baked colour sets get the same read for
nothing.

## Overhead rhythm: the curved lamps

`tgr-city.png`. Right-side posts sit at original (952, 1050) and (839, 1005).
Fitting a common horizon through both puts lamp B at **1.48x lamp A's depth**,
so **spacing ≈ 0.48 x the near lamp's distance**. Post A runs from screen
y=635 (head) to y=1050 (base) = **548 px**, against a carriageway width of about
310 px at that depth: **head height ≈ 1.77 x the carriageway width**. Two to
three arcs are readable per side at once, and the arms cross well over the road.

These are enormously exaggerated — a real street lamp is nothing like 1.8 road
widths tall — and that exaggeration is exactly why they fill the top of a
portrait frame instead of hugging the kerb. We have almost nothing in this layer
(`MEASUREMENTS.md` already flagged it as priority 3); mile gantries every 240
units is not a rhythm.

**S3. Lamp arcs, with a fairness guarantee built in.**

- Our tarmac is 7.50 units wide. 1.77 x 7.50 = **head at y = 13.3**.
- **Post at x = ±5.4, rising to y = 9.6.** That is outside `CORRIDOR_HALF` (3.75)
  and inside `LANDMARK_IN` (11.75), i.e. it is roadside furniture, in the same
  band as the kerb and the aid tables.
- **Arm: a quarter-ellipse from (±5.4, 9.6) to the head at (±1.6, 13.3),** so
  every point of the arm with |x| < `CORRIDOR_HALF` sits at **y ≥ 11.0**.
  `OVERHEAD_Y` is 9.0, so the minimum clearance over the corridor is **2.0
  units**. Nothing about the arc can ever intersect a hazard or the jump arc.
- **Period: one lamp per road tile, alternating sides.** `TILE = 24`, so 24
  units per side and an arc crossing the frame every 24 units — **1.0 s at race
  pace (21.8–26.9 u/s)**. Measured against the reference's ~0.48 x near-distance
  spacing this is in the same family and errs sparse, which is the right way to
  err.
- **Cost: it rides the per-tile roadside furniture merge, so zero extra draw
  calls.** Post 6 tris + a 4-segment extruded arm 12 tris + head 4 tris ≈ **22
  triangles per tile**. Ten live tiles: **+220 triangles, 0.2–0.8%.**

**S4. Occlusion of a hazard by scenery must be an assertion, not a hope.**
The corridor rule in `world.js` guarantees no scenery *intersects* the play
space. It does not guarantee no scenery *projects in front of* a hazard, which
is the fairness bug that matters. With the camera at BASE_Y 2.62 looking at
LOOK_Y 1.16 with LOOK_AHEAD 8.0 and BASE_FOV 58 (FOV_MAX 76), an arm at y ≥ 11
lands in the top ~20% of a portrait frame while a gate at 40–90 units lands in
the middle third, so the bands do not overlap for any gate inside its read
window. That holds for every gate at **d ≥ 26 units**, which is well inside the
earliest a gate is committed to.

**But the mile gantries already violate the spirit of it.** In `p190` the MILE
21 sign crosses directly behind the runner's head at the height a hazard would
occupy, and the `WALL` overpass has spanned the road at y = 8.0 — *below*
`OVERHEAD_Y` — since it was added. Add a check to `tools/shoot.js` that
projects, for every live overhead element and every live gate at greater depth,
the element's lowest screen y and the gate's highest, and **fails the run** if
they overlap. Occlusion of a hazard is a correctness bug and should fail the
build the way a page error does.

---

# What we already do better, and what is style rather than technique

Being honest about this matters more than the spec above, because most of the
work below would be wasted.

- **Ground frequency.** TGR's city and sunset roads have *no* high-frequency
  surface detail at all. Ours has a joint every 1.2 units and a heavy joint every
  4.8. We are an order of magnitude ahead of the reference on the axis the last
  review said we were behind on.
- **Marking reach.** Their paint dies at 68% of the way to the vanishing point
  (ΔL 17). Ours runs into the fog. This was a stated belief and it is wrong.
- **Lane identity.** TGR does not tint its lanes at all — it does not need to,
  because it is not a game about holding a line. Our 0.774 / 1.000 / 0.880
  staircase, deliberately asymmetric so the two outer lanes differ from each
  other, is a real advantage for this specific game and should be kept through
  every change above.
- **The corridor rule.** We have a stated, derived, enforced guarantee that
  nothing that is not a hazard occupies the play space. TGR has no visible
  equivalent.
- **Inhabited obstacles.** Ours have riders and marshals. Theirs do not.

And plainly: **a large fraction of Tom Gold Run's advantage is art style, not
technique.** It is smooth-shaded and glossy — soft gradients across every
surface, painted rim light, specular highlights on the car and the ramp lip,
foliage that reads as translucent. None of that is available to a banded-toon
renderer with normal-extruded ink outlines, and specifying a move toward it
would be specifying a different game. **The transferable part is the value
architecture** — a dark road, props at 1.6x–2.8x the road, hard chroma breaks at
material boundaries, multiplied contact shadows, and an aerial perspective that
kills saturation three times faster than it lifts value. Every one of those
survives banding perfectly, and every one of them is a number rather than a
technique.

# Findings, in priority order

1. **Darken the biome road values from 146–190 to L≈100.** One constant per
   biome, zero cost, no geometry. It triples lane-paint contrast (1.29–1.48 →
   2.46), moves the existing chevron hazard from 0.89x the road to 1.68x, makes
   the expansion joints read as cuts rather than as a cattle grid, and fixes the
   largest surface on screen. **If only one change is made, make this one.**
2. **Contact shadows under every hazard**, multiply 0.60 at the footprint easing
   to 0.85 at the rim, all in one pooled overlay mesh. +1 draw, 2 tris/hazard.
3. **The hazard contrast rule** — ≥1.6x in luminance or ≥0.30 in saturation —
   applied as a test, plus the JUMP / DUCK / BLOCK silhouette rules above.
4. **Camber the carriageway** with 5 strips per lane. +24 tris/tile, no draws.
5. **Seam beads at 2.0 units** on all four longitudinal lines. +96 tris/tile,
   no draws.
6. **Lamp arcs, one per tile alternating sides**, head at y=13.3, minimum
   corridor clearance 2.0 units. +22 tris/tile, no draws.
7. **Fog `far` 300 → 215**, and pre-bake 45% of the desaturation into props
   spawning beyond 120 units. Zero cost.
8. **Make hazard occlusion a failing assertion in `tools/shoot.js`,** and fix
   the `WALL` overpass at y=8.0, which sits below `OVERHEAD_Y`.

# Deliberately not copied

- **Smooth shading, gloss and rim light.** The reference's entire surface
  quality. Not available under `MeshToonMaterial` with banded gradient maps and
  not worth abandoning the art direction for.
- **More ground frequency.** We already exceed them. See above.
- **A two-lane-wide ramp.** Measured at 0.67 of the kerb-to-kerb road. Ours must
  be one lane or the lane-change contract is a lie.
- **Chroma breaks on the road surface.** Egypt's runway edge is drawn almost
  entirely in hue (ΔL 22, ΔR 115). We cannot have that on the road because the
  telegraph mats own saturated colour and are the device a race is lost by
  misreading. The Egypt structure is borrowed; its colour channel is not.
- **Uninhabited obstacles.** Theirs are empty props. Keep the riders and the
  marshals.

---

# 4. The road vehicles

Added when the owner asked for "the cars, bikes and other moving obstacles" to
be more realistic and offered to send photographs of real ones. The photographs
were declined, and the reason is the same one in *Deliberately not copied*:
this renderer is flat `MeshToonMaterial` with banded gradient maps and
normal-extruded ink, so a photograph would push the work toward gloss,
reflection and surface texture, none of which exist here. **What a vehicle's
read is actually made of, and all of which are free flat-shaded, is roofline
height, where the window band sits, greenhouse taper, ride height and the gap
between body and road.** `tgr-city.png` has a tram, a bus and a parked car in
exactly our idiom and was the only reference used.

## Measured off `tgr-city.png`

| | own L | body L | ratio |
|---|---|---|---|
| parked car body (shaded flank) | 76.4 | — | — |
| parked car glass | 92 | 76.4 | **1.20 — the glass is LIGHTER than the paint** |
| tram roof | 163.5 | — | 2.10x its road |
| tram window band | 61 | 163.5 | 0.37 |

The car's glass being lighter than its own body looks wrong written down and is
what the frame shows: paint is a shaded surface and glass is a mirror pointed at
the sky. Our glazing is `0x6577b2` because of this line, and it is most of what
made these vehicles pass the contrast gate.

## The finding that cost the most time: BLOCK pink is DARKER than the road

The chase camera only ever sees a hazard's rear faces, which are the shaded band
of the toon ramp. Measured off `api.contrastAudit`'s own swatches, a shaded face
returns at `(0.639R, 0.723G, 0.826B)` of its authored colour, so its luminance is


> **CORRECTION (measured during the build pass).** The two statements of the
> shaded response in this section disagree with each other: `(0.639R, 0.723G,
> 0.826B)` and `L = 0.136R + 0.517G + 0.060B` imply different factors, and only
> the second fits the swatch table above. Neither is right. Forty-six flat
> swatches rendered through the audit's own camera give the real response as
> **`(0.660R, 0.732G, 0.828B)`, i.e. `L = 0.197R + 0.430G + 0.094B`**. Checks:
> cream predicts 175.4 and measures 175.5; BLOCK pink predicts 85.7 and
> measures 85.4. The formula as originally written puts pink at 71.6, which is
> 17% low. `world.js` now carries this as `shadedL()` so nothing has to restate
> it. Every colour chosen in the build was picked against the measured map.

```
L = 0.136 R + 0.517 G + 0.060 B          (green is 76% of it)
```

Checked against the audit: cream `0xfff2e0` predicts 173.2 and measures 173;
pink `0xff3b6b` predicts 71.6 and measures 70; navy `0x2b2f52` predicts 35.0 and
measures 32. Which puts the palette in an order nobody would guess from the hex:

| authored | role | shaded L |
|---|---|---|
| `0xfff2e0` | cream | **173** |
| `0xffe45e` | amber | 157 |
| `0xffc79a` | skin | 147 |
| `0x6577b2` | glazing | 86 |
| `0xff3b6b` | **BLOCK pink** | **72** |
| `0xd42a55` | deep pink | 55 |
| `0x2b2f52` | navy | 35 |
| `0x1e2140` | tyre | 22 |

The centre lane's tarmac measures **L 88.4 to 92.6** across the six sweep
frames. **So the hazard hue this game signals "impassable" with is darker, seen
from behind, than the road it stands on.** A vehicle built the obvious way --
pink body, dark glass, black tyres -- measures 1.15x to 1.24x the centre lane
and fails the 1.25x gate on five variants at once. Every hazard in this game
that passes, including the ones that predate this work, passes on cream.

Measured, first pass then final, worst lane in each case:

| | first pass | final | what changed |
|---|---|---|---|
| tram | 92.9 (1.03x) | 122.6 (1.36x) | pale destination panel, glazing |
| city bus | 105.5 (1.17x) | 125.9 (1.39x) | cream livery band, glazing |
| taxi | 110.3 (1.22x) | 124.1 (1.37x) | chequer band, glazing |
| delivery van | 106.3 (1.18x) | 129.2 (1.43x) | lit load space, shutter valance |
| refuse truck | 114.6 (1.27x) | 124.0 (1.37x) | cream packer body, reflective band |
| road bike ×2 | 111.7 (1.24x) | 124.4 (1.38x) | hi-vis sleeves, mixed kit |
| moped | 127.8 (1.41x) | 121.9 (1.35x) | — |

Every one of those lifts is a piece of livery the real vehicle wears, which is
the only reason it was honest to reach for them to pass a measurement.

## What separates them at gameplay scale

Checked at 22 units in portrait 390x844, which is about 30 px per world unit --
a BLOCK is then 50 px wide and 84 px tall, and at the 40 units a lane is
actually chosen at it is 27 x 46. At that size nothing survives but gross
proportion, so each vehicle is given exactly one thing no other has:

| vehicle | glazing band | roof | the tell |
|---|---|---|---|
| tram | 1.18–1.72 | 2.44 + pantograph to 2.77 | **no wheel gap** — skirt to the road |
| city bus | **1.84–2.48**, top third | 2.78 | tallest thing on the road |
| taxi | 1.10–1.52, and **narrower than the body** | 1.62 + rank sign to 2.28 | the only low one |
| delivery van | none on the tail | 2.60 | open back, lit load, doors flat to the flanks |
| refuse truck | none | hopper 2.06 **/ body 2.64** | the only two-height roofline |
| road bike ×2 | — | 2.40, raised signal arm 2.55 | two figures, not one mass |
| moped | — | helmet 2.52 | mirrors at ±0.67, wider than its own cube |

Three things were rebuilt after looking at them at that size rather than
magnified, and all three are the same lesson the character work produced:

- **The taxi's roof rack was a stack of boxes.** A sign at the front of the roof
  plus two strapped cases behind it read as luggage with a car underneath, and
  the sign was completely hidden behind the cases from the only angle the game
  has. One illuminated rank panel, narrower than the roof, is one shape.
- **The refuse truck's step was a height step, not a value step.** Both halves
  were pink, and two pink faces in the same lane read as one wall however far
  apart their tops are. The packer body is cream now.
- **The cyclists' bikes were invisible and their arms had welded to their
  torsos.** Navy wheels sit inside the hazard's own multiplied contact shadow
  and disappear; cream sleeves on a cream jersey lose the figure its arms. Mid
  grey wheels, and one band across each jersey.

## Divergences, stated

- **A flat horizontal top edge in the jump band.** `Spec: the vocabulary` above
  forbids it for BLOCK, and a saloon roof at 1.60 against a 2.05 jump apex is
  exactly that. It is answered the way the cargo trike answered the same
  objection -- with something real above it, here a rank sign to 2.28 -- rather
  than by not having a low car.
- **"No bright horizontal band across the middle."** The bus wears a cream
  livery band and the tram a pale destination panel. The rule exists so nothing
  inside a BLOCK can be mistaken for a gap under a bar; a *bright* band is not a
  gap, and the ROAD CLOSED hoarding has shipped with three of them since it was
  added. What is still enforced is that no part of a BLOCK ever frames road.
- **The van's dark load space** is the one thing here that could read as a void,
  and is drawn lit rather than black, with parcels filling 73% of the opening's
  height and a shutter valance across its top.

---

# 5. The vehicle pass, torn down

Five new Tom Gold Run frames, at the range the chase camera actually works at,
supplied after the vehicle pass shipped and was rejected: *"Vehicles not good
enough. Review gold run for vehicle description and depth. Also see detail on
trees and buildings."*

| File | Shows |
|---|---|
| `tgr-taxi-street.png` | yellow taxi in-lane, close; a boulevard of lobed trees |
| `tgr-bus-front.png` | teal bus filling a third of the frame |
| `tgr-traffic.png` | several vehicles at once, street trees, bunting |
| `tgr-boulevard.png` | trees, trunks, kerb and bollards |
| `tgr-shopfronts.png` | shopfront street, awnings, balconies, signage, red car, bus |

All five are 1206 x 2622 full-bleed, the same 0.46 aspect as the earlier three,
so every fraction below is directly comparable to section 1-3 and to our own
620 x 1344 portrait shots.

Our side is measured live, not estimated: `api.contrastAudit(renderer, scene,
{images: true})` returns a rendered rear elevation per hazard variant plus its
area-weighted mean. Frames at skip 17 / 31.7 / 39.5 / 50.6 / 97.9 / 194.4,
found by running the pace model headlessly against `Course.generate('2026-08-07')`
and solving for the race-second at which a BLOCK gate sits ~15 units ahead.

## The finding that answers the complaint

**We do not have a fleet. We have ten silhouettes of one colour.** The audit's
own area means, all ten BLOCK variants, one frame:

| variant | mean rgb | L | S |
|---|---|---|---|
| v0 tram | (144,108,139) | 122.6 | 0.248 |
| v1 hoarding | (173,128,146) | 143.7 | 0.258 |
| v2 trike | (178,143,160) | 155.6 | 0.199 |
| v3 marshals | (141,110,134) | 122.1 | 0.214 |
| v4 bus | (146,113,140) | 125.9 | 0.221 |
| v5 taxi | (143,112,138) | 124.1 | 0.222 |
| v6 van | (154,117,140) | 130.9 | 0.240 |
| v7 refuse | (155,109,130) | 125.1 | 0.299 |
| v8 cyclists | (149,110,132) | 124.4 | 0.258 |
| v9 moped | (158,102,128) | 121.9 | 0.351 |

Ten different vehicles inside a **12-luminance band and a 0.15 saturation band,
every one of them the same desaturated mauve.** No two of them differ by as
much as one toon band. Against that, the reference's four vehicles:

| | body rgb | L | S | road L | road S |
|---|---|---|---|---|---|
| taxi, `tgr-taxi-street` | (255,221,0) | 212.3 | **1.000** | 72.8 | 0.292 |
| bus, `tgr-bus-front` | (41,114,94) | 97.3 | **0.638** | 89.7 | 0.255 |
| car, `tgr-shopfronts` | (204,25,54) | 65.3 | **0.878** | 86.7 | 0.164 |
| bus, `tgr-shopfronts` (far) | (118,63,70) | 75.8 | 0.461 | 96.2 | 0.232 |

Four vehicles, four hues, S 0.46-1.00. Ours, ten vehicles, one hue, S 0.20-0.35.
**That is the whole of "not good enough" and it is a colour finding, not a
geometry one.** The previous brief's "silhouette and proportion" was not wrong;
it was half the answer, and the half that was missing costs nothing to fix.

## Why our fleet is mauve, mechanically

The swatch pixels, quantised, give the exact composition. Every colour below is
the authored hex through the shaded band `(0.639R, 0.723G, 0.826B)`:

| authored | shaded rgb | L | S | share of v4 bus | share of v5 taxi | share of v7 refuse |
|---|---|---|---|---|---|---|
| `0xfff2e0` cream | (163,175,185) | 173.1 | **0.119** | **32.6%** | **32.5%** | **32.0%** |
| `0xff3b6b` pink | (163,43,88) | 71.5 | 0.738 | 21.4% | 12.7% | 23.9% |
| `0x6577b2` glass | (65,86,147) | 85.9 | 0.561 | 18.2% | 15.3% | — |
| `0xd42a55` deep pink | (135,30,70) | 55.6 | 0.776 | 5.8% | 11.4% | 9.0% |
| `0x2b2f52` navy | (27,34,68) | 35.0 | 0.594 | — | — | 7.5% |
| `0x1e2140` tyre | (17,25,55) | 25.0 | 0.738 | 5.9% | 7.1% | 4.9% |

**The largest single area on every vehicle is cream, and cream is the least
saturated colour in the palette.** It is there because section 4 reached for it
to pass the luminance gate, and it worked -- but chroma is measured on the AREA
MEAN, not on the mean of the chromas, so a warm saturated pink averaged against
a cool near-neutral cream lands on the neutral axis. Modelled:

    taxi, saturated yellow body, no cream      L 134.4 (1.48x)   dS +0.266
    same taxi with a 15% cream livery band     L 137.8 (1.52x)   dS +0.032

**A 15% cream band buys 0.04x of luminance and destroys 88% of the object's
chroma.** That single line is why nine of ten variants sit inside 0.15 of each
other on saturation, and it is the mechanism behind the complaint.

The prediction model used throughout below is the area-weighted mean of the
shaded hexes, calibrated against the live audit on four variants:

| variant | model L | measured L | offset | model S | measured S |
|---|---|---|---|---|---|
| v0 tram | 108.2 | 122.6 | +14.4 | 0.258 | 0.248 |
| v4 bus | 108.8 | 125.9 | +17.1 | 0.256 | 0.221 |
| v5 taxi | 108.6 | 124.1 | +15.5 | 0.245 | 0.222 |
| v7 refuse | 108.2 | 125.1 | +16.9 | 0.295 | 0.299 |

**Offset +16.0 L, S accurate to 0.035.** The offset is the lit top faces the
audit camera catches and the flat-shaded model does not. Every predicted figure
below carries it.

## What the reference vehicle actually is, measured

Four elements and nothing else. Verified on the bus at 15 units
(`tgr-bus-front`, front face x 805-1095, y 600-1105) and on the bus at gameplay
distance (`tgr-shopfronts`, face x 512-648, y 575-775):

| band | fraction of face height | bus @15u | bus @gameplay | red car |
|---|---|---|---|---|
| roof / header | 11% | | | |
| upper glass band | 18.4% | | | |
| **windscreen** | **37.6%** | | | |
| body with lamps and grille | 17.8% | | | |
| **dark bumper** | **13.9%** | 10% | 15% | |
| **glass area ÷ elevation bbox** | | **34.8%** (51.9% with the upper band) | **42.6%** | **40.4%** |

Ours, from the audit swatches: **bus 18.2%, taxi 15.3%, tram 19.9%, van 0%,
refuse truck 0%.** The reference carries **2.3x our glass**, and two of our
eight vehicles show none at all from behind.

The other three elements:

- **The glass is not one flat colour, it ramps.** Bus windscreen L 82.2 at the
  top, 66.5 mid, 51.1 at the bottom; taxi 151.6 / 130.7 / 105.9; red car 110.8 /
  83.9. **Top ÷ bottom = 1.61, 1.43, 1.32 -- mean 1.45, and 1.61 on the largest
  sample.** The break sits about 55% up the glass.
- **The bumper is a dark neutral at the very bottom, full width.** Bus (51,34,51)
  L 38.8 on a road of 63.5 = **0.61x**; taxi (77,86,62) L 82.7 on 72.8 = 1.14x
  but S 0.27 against a body at S 1.00; red car grille (67,51,56) L 54.9 and
  bumper (68,57,68) L 60.8 on a road of 86.7 = **0.63x / 0.70x**. It always
  carries a pale number plate: bus (136,102,119) L 110.5, red car (164,125,170)
  L 137.0 -- **1.7x to 2.8x the bumper it sits on**, and it is the lowest bright
  thing on the vehicle.
- **Lights are small, round and the brightest thing in frame.** Far bus headlamps
  measure **(255,255,255) L 255.0** on a body of L 75.8 -- **3.4x**, diameter 22px
  on a 136px face = **16% of the face width**. Bus at 15 units, (94,128,179)
  L 125.1 on a body of 97.3 = 1.29x, diameter 30px on 290px = 10%.
- **The wheel breaks the lower outline.** `tgr-shopfronts` red car: the dark mass
  from y 1005 to 1080 is 32% of the face height and the tyres sit at its outer
  corners with a hard black contact line under each. `tgr-city`'s teal car has a
  visible arch cut with the wheel inside it.

## Where we already agree, and what must not be walked back

- **Lamp size and contrast are already right.** `0xffe45e` shaded is L 158.1 on a
  pink body of 71.5 = **2.2x**, and the lamp boxes are 0.26-0.28 authored on a
  2.20 body = 12-13% of the width. The reference is 1.3x-3.4x at 10-16%. We are
  inside the band. What is wrong is that every lamp on every vehicle is the same
  amber, so a free identity axis is spent on nothing.
- **Roofline height, window-band height and greenhouse taper** were the last
  pass's thesis and they hold. The reference's greenhouse is 0.75-0.91 of the
  body width (bus 264/290, car 190/235, far bus 102/136); our taxi's 1.50/2.18 =
  0.69 is if anything over-tapered. **Glass width is not the problem. Glass
  HEIGHT is.**
- **Inhabited hazards.** Every reference vehicle is empty. Ours have riders and
  marshals and they are better for it. Unchanged.
- **The 1.6x / 0.30 rule and the 1.25x / 0.22 gate.** Unchanged, and the spec
  below is written to them.

## Divergences that are style, not technique -- do not attempt

- **The gloss.** Every reference vehicle has a specular sweep across the roof and
  a highlight on each headlamp lens. The glass ramp above is the transferable
  part of it and it is drawn as two constant bands, not as a gradient.
- **Smooth-shaded body panels.** The reference's shoulder line is a soft
  gradient over a curved surface. Under `MeshToonMaterial` with a banded ramp
  the same shoulder must be a step between two authored colours or it is
  nothing. Specified below as a step.
- **The novelty vehicles.** `tgr-traffic`'s giant hot dog on a truck and the
  gift-wrapped buses are a live-ops event skin, not art direction. Copying them
  would put a second decorative colour system on top of a hazard whose hue is
  already a gameplay signal.
- **Reflections and the sky in the glass.** The reference's windscreen is a
  mirror; ours is a coloured panel. The two-band ramp below is the translation.

## The budget, corrected

An earlier draft of this section trimmed the spec to fit a 75k working ceiling
and specified a triangle cut for every addition. **That ceiling was not real.**
Every fps figure in this project was taken under SwiftShader software rendering
at 1-8 fps, which is evidence of nothing, and the owner reports the game running
without issue on their phone at the present 75-83k. **Work to 150k.** Cost is
still stated for everything below, because it should be known, but it is no
longer a veto and nothing here is sized down to pay for something else.

Where the weight actually is, measured at mile ~16: the whole frame is 74,619
triangles and **the runner is 14,128 of it while the record ghost is another
14,128 -- 38% of the frame in two character rigs**, the second of which is a
full copy of the first drawn translucent and never in focus. If a reduction is
ever wanted, that is where it is, not in the crowd and not in the fleet. It is
not needed to fund anything in this document.

## Spec: the fleet

Widths are authored (x is scaled by `LANE_FIT`); y and z are world and none of
them moves. `MR.Collision.BOX[BLOCK]` stays yMin 0, yMax 2.80, halfZ 0.65, and
every rear fitting keeps its rear plane at exactly -0.65 so a train still works.

**V1. Per-vehicle liveries, in two families. Zero triangles.**

The audit measures an area mean, so **a vehicle's body and its glass must not
straddle the neutral axis.** That splits the fleet cleanly and it is why the
proposal has two rules rather than one:

- **Cool-bodied vehicles pass on saturation.** Teal, cyan, green body with the
  cool glass. dS lands at 0.43-0.54 -- over the 0.30 target with room.
- **Warm-bodied vehicles pass on luminance**, because warm high-green hues are
  the only ones that reach L 145 through `L = 0.136R + 0.517G + 0.060B`. Their
  glass must be held to ~26% of the elevation rather than 34%, or the blue drags
  the mean back to neutral.
- **No cream on a warm body, anywhere.** The pale element on a warm vehicle is
  the number plate and the lamp cores and nothing else. Cream on a *cool* body
  costs only 0.12 of dS and buys 8 L, so the bus and tram may keep a band.

| variant | body | dark bottom | trim | predicted L | vs road | S | dS | verdict | today |
|---|---|---|---|---|---|---|---|---|---|
| v5 taxi | `0xffd42b` | `0x2e2412` | `0x1a1608` chequer | 134.4 | **1.48x** | 0.369 | +0.266 | gate both axes | 1.37x / +0.119 |
| v4 bus | `0x2fc79a` | `0x0e2a26` | `0xd8f24a` | 124.8 | 1.37x | 0.571 | **+0.468** | **TARGET** | 1.39x / +0.118 |
| v0 tram | `0x35c2e8` | `0x0c2436` | `0xd8f24a` | 125.8 | 1.38x | 0.641 | **+0.538** | **TARGET** | 1.35x / +0.145 |
| v6 van | `0xffb02e` | `0x35220a` | `0xff6f2b` | 131.8 | 1.45x | 0.312 | +0.209 | gate | 1.44x / +0.137 |
| v7 refuse | `0xd8f24a` | `0x22300a` | `0xff6f2b` | 137.1 | **1.51x** | 0.422 | **+0.319** | **TARGET** | 1.38x / +0.196 |
| v8 cyclists | `0xff6f2b` kit | `0x2a0c16` | `0xffd42b` | 122.5 | 1.35x | 0.537 | **+0.434** | **TARGET** | 1.37x / +0.155 |
| v9 moped | `0xff3b6b` | `0x2a0c16` | `0xffd42b` | 112.8 | 1.24x | 0.477 | **+0.374** | **TARGET** | 1.34x / +0.248 |

Five of seven reach the 1.6x/0.30 target for the first time; the other two clear
the gate on both axes where today they clear it on one. **The moped drops below
1.25x on luminance and is carried entirely by dS +0.374 -- which is exactly the
configuration of `tgr-city`'s parked blue car (0.98x luminance, dS +0.38) and is
allowed by the rule. It is also the first thing that will fail at distance,
because saturation e-folds three times faster than value (section 3). If only
one variant is allowed to sit there, it should be the smallest one, and the
moped is it.**

The dark bottoms are dark versions of each body's own hue rather than a shared
neutral, for the same area-mean reason: a shared grey bumper on seven vehicles
would put 13% of neutral back into every one of them.

BLOCK pink as the kind signal is not abandoned. It moves from "the mass that
carries the silhouette" to **a fixed pink element in a fixed place on every
BLOCK** -- the rear bumper chevron face each variant already carries, plus the
roof cap. Kind is also already signalled at full strength by the telegraph mat
on the road in front, which is the channel the race is actually lost by
misreading; the body was a redundant second copy of that signal and it was
costing the entire vehicle-colour axis.

**V2. Glass: 1.7-2.3x the area, in two bands. +24 rendered triangles/vehicle.**

- Glass area **34% of the rear elevation bbox on cool bodies, 26% on warm ones**
  (from 15-20% today). This is a resize of the existing `hbx`, so the area is
  free; only the split costs.
- **Two constant bands, upper ÷ lower luminance = 1.62**, break at 55% of the
  glass height. `0x8ec0ea` (shaded L 132.5) over `0x4f74bc` (shaded L 81.9)
  gives 1.618, matching the bus's measured 1.61 to three figures.
- Hue stays in the 200-225 degree band on every vehicle regardless of body hue.
  This is the one thing the reference never varies.
- **The van and the refuse truck must gain a rear window.** Two of eight vehicles
  showing no glass at all from the only angle the game has is the largest single
  reason the fleet reads as boxes. The van's open load space keeps its parcels
  and its valance; the glass goes in the two door leaves.

**V3. A dark bumper at the bottom. Zero triangles.**

The rear bumper bar exists on the bus, taxi and van already. Move it, resize it,
recolour it:

- **Full body width, 13% of the elevation height, bottom edge at the sill**, not
  at 29% up the body where the bus's sits today.
- Value **0.28-0.35x the centre lane** (reference 0.61-0.70x of a road that is
  itself darker than ours; our shaded darks land at L 24-30 against a road of
  90.9, which is 0.26-0.33x -- close enough and on the right side).
- **A number plate on it**, `0xe8ecf4`, shaded L 168.1 -- **6.5x the bumper it
  sits on.** +12 authored / +24 rendered. This is the reference's lowest bright
  element and it is what tells the eye where the vehicle's bottom edge is when
  the contact shadow has washed out.

**V4. Round wheels in real arch openings, with a shadow gap under the sill.
+160 rendered triangles per wheeled vehicle.**

This is the item the imaginary ceiling cut down to a flat dark rectangle. Built
properly:

- **The tyre is a cylinder, axis along x**, so what the chase camera sees is the
  curved rear tread and the bottom of the wheel is round.
  `cyl(0.30, 0.30, 0.34, 10, ±0.96*LANE_FIT, 0.30, -0.06, tyre, 0, 0, PI/2)`.
  40 authored / 80 rendered each. At 15 units a 0.19-world tyre is ~15px, which
  resolves roundness; by 30 units it does not, and that is fine -- the arch above
  it is what carries the read at distance.
- **The arch is a real opening, not a painted one.** Split the lower body box in
  three -- left flank, a centre section spanning above both arches, right flank --
  so the tyre is seen through a genuine gap in the mesh and the body's lower
  outline is notched. +24 authored / +48 rendered.
- **An arch lip** over each wheel, one step darker than the body and standing
  0.02 proud, following the top of the opening. +24 authored / +48 rendered.
- **Delete the two front wheels.** They sit at z = +0.36 to +0.44, inside a body
  1.16-1.30 deep whose rear plane is at -0.65: **occluded by their own body from
  a chase camera at every distance.** -24 authored / -48 rendered. This is a
  correctness cut, not a budget one, and it stands whatever the ceiling is.
- **The shadow gap.** The body's underside stops at 0.34 and nothing fills the
  span between the two wheels, so lit road shows under the sill exactly as it
  does under every reference vehicle. The pooled contact quad from R4 already
  multiplies that road to 0.60; the reference measures its own underbody at
  **0.67x the local road** (red car, L 58.1 on 86.7), so R4's existing number is
  right and no new geometry is needed for the shadow itself.

**Divergence, stated:** the reference's arch is a smooth curve cut into a
smooth-shaded panel with the wheel's shadow softening into it. Ours is a
straight-sided opening with a hard lip. The transferable part is that the tyre
**breaks the body's lower outline**, which is a silhouette fact rather than a
shading one and survives banding intact.

**V5. Round two-part lamps. +232 rendered triangles per vehicle.**

A red tail lamp cannot be drawn in red: `0xff2b3c` shaded is L 60.5, **darker
than the road**. So it is drawn as the reference draws a headlamp -- value in the
core, hue in the surround -- and now that geometry is affordable, both parts are
discs facing the lens rather than boxes:

    surround  cyl(0.17, 0.17, 0.10, 8, ±0.94*LANE_FIT, 0.86, -0.60, 0xff2b3c)  L  60.5
    core      cyl(0.09, 0.09, 0.11, 8, ±0.94*LANE_FIT, 0.86, -0.61, 0xfff6e2)  L 175.3

Core ÷ surround = 2.9x, against the reference's headlamp-to-body 1.3x-3.4x.
Lamp diameter 0.34 authored on a 2.20 body = 15% of the width, against the
reference's measured 10-16%. 128 authored / 256 rendered for the four discs,
less the 24 rendered the two boxes cost today.

Amber stays only on the refuse truck's beacon and the bin-lift arms, where it
means something. **If the taxi is turned to face the camera (V6) its lamps
become headlamps and the core goes to `0xfffdf2`, L 179.9 -- the reference's
far-bus headlamp measures a flat (255,255,255) and is the brightest thing in the
frame, so this is the one place a near-white is correct on a vehicle.**

**V5b. The body is not a box. +60 authored / +120 rendered per vehicle.**

Three separate devices, all of which the reference has and none of which we do:

- **A shoulder line.** The lower body is 0.06 wider than the upper, with a
  crease box between them one step darker than either. The reference draws this
  as a gradient over a curved flank; **under a banded ramp it has to be a step
  between two authored colours or it is nothing**, so it is one box. +12/+24.
- **An inset greenhouse.** Our bus's glazing is `hbx(2.22, ...)` on a body of
  2.20 -- **wider than the vehicle it is set into.** The reference's is 0.75-0.91
  of the body width with visible pillars either side (bus 264/290, car 190/235,
  far bus 102/136). Take the bus's glass to 2.00 on 2.24 and recess it 0.02 in z,
  then add two body-coloured pillar boxes at the glass's outer edges. +24/+48.
- **A rounded roof.** Two chamfer boxes above the header, each narrower and
  shallower than the last, so the roofline steps in twice instead of ending in a
  square corner. The tram already does this with its "chamfered crown" and it is
  the best-looking thing in the current fleet. +24/+48.

**V6. One vehicle turned to face the camera. Zero triangles. Optional, and the
argument is not one-sided.**

Every device measured above -- windscreen, round lamps, grille, bumper, number
plate -- lives on a vehicle's FRONT, and the reference gets all of them because
its traffic is oncoming. Our chase camera sees rears, which is why the fleet is
short of vocabulary before it is short of anything else. A vehicle turned in the
road at a closure is entirely plausible and costs a `rotation.y`.

Against it: a hazard facing the player reads as oncoming, and every hazard in
this game is static; and the tram cannot do it (train scaling pins fittings to
z = -0.65), nor the refuse truck (its tailgate is its tell), nor the van (its
open doors are). **Recommend it for the taxi only, and measure the read before
extending it.** A taxi turned around at a road closure is the most natural
instance and the taxi is the variant with the least to lose.

## Cost

Hazards carry `INK.hazard` 0.025 so every hazard triangle is drawn twice.
Scenery carries `INK.prop`/`INK.scenery` = 0, so scenery triangles count once.

| item | authored | rendered | per |
|---|---|---|---|
| V1 liveries | 0 | 0 | — |
| V2 glass area | 0 | 0 | — |
| V2 glass split into two bands | +12 | +24 | vehicle |
| V3 bumper move and recolour | 0 | 0 | — |
| V3 number plate | +12 | +24 | vehicle |
| V4 round tyres (2, 10-seg) | +80 | +160 | wheeled vehicle |
| V4 wheel boxes they replace | -24 | -48 | wheeled vehicle |
| V4 lower body split for arch openings | +24 | +48 | wheeled vehicle |
| V4 arch lips | +24 | +48 | wheeled vehicle |
| V4 front wheels deleted | -24 | -48 | wheeled vehicle |
| V5 round two-part lamps (4 discs) | +128 | +256 | vehicle |
| V5 lamp boxes they replace | -24 | -48 | vehicle |
| V5b shoulder crease | +12 | +24 | vehicle |
| V5b inset greenhouse pillars | +24 | +48 | vehicle |
| V5b roof chamfer | +24 | +48 | vehicle |
| **net** | **+268** | **+536** | **wheeled vehicle** |
| **net** | **+188** | **+376** | **two-wheeler / cyclists** |

A BLOCK variant is 144-252 authored triangles today (288-504 rendered), so this
roughly **doubles the fleet's geometry** -- bus 204 -> 472 authored, 408 -> 944
rendered.

Whole-frame effect. Measured live in portrait 620 x 1344, the heaviest frames run
**90,977** (skip 17), 87,063 (skip 50), 85,881 (skip 50.6). A heavy frame carries
roughly eight live BLOCKs, of which six or so are wheeled:

| | added rendered triangles |
|---|---|
| fleet, section 5 | **+4,300** |
| trees, section 6 | **+3,100** |
| buildings, section 7 | **+3,000** |
| **total** | **+10,400** |

**91k -> ~101k against a 150k ceiling: 33% of headroom still unused.** Nothing in
this document needs to be cut to fit and nothing needs to be cut to pay for it.

If a reduction is ever wanted anyway, it is not here. The runner and the record
ghost are 14,128 triangles each -- **38% of a 74,619-triangle frame in two
character rigs**, the ghost being a full copy of the runner drawn translucent and
never in focus. A reduced ghost rig would return more than everything specified
above costs. The three heaviest scenery geometries in a skip-17 frame are
8,316-vertex meshes drawn three and four times at 11,088 triangles each; the
fleet, even doubled, is a rounding error beside either.

---

# 6. Trees

## Measured

`tgr-boulevard.png`, nearest foliage, and `tgr-taxi-street.png` as the control.

| | reference | ours (authored) | ours (on screen, `w50.6`) |
|---|---|---|---|
| lit crown | (174,222,54) L 200-209 | `0x62c470` L 169.1 | L 145.1 |
| mid | (126,174,54) L 155-188 | `0x4faf5f` L 148.9 | L 97.1 |
| shaded underside | (102,138,42) L 112-123 | `0x3f9a52` L 129.4 | L 73.1 |
| **lit ÷ shaded** | **1.70** | **1.31** | 1.99 |
| saturation | **0.67-0.76** | 0.50-0.59 | 0.64-0.77 |
| **R ÷ G (hue)** | **0.75-0.78** | **0.41-0.50** | 0.23-0.36 |
| trunk lit | (174,102,54) L 113.8 **S 0.69** | `0x8a5a3c` L 98.0 S 0.565 | |
| trunk shaded | (114,66,30) L 73.6 **S 0.74** | — | |
| bare trunk ÷ tree height | 23-36% | 32% | |
| lobes per crown | 3-5 | 4 | |

**Three of these are already right and one is badly wrong.** The lobe count, the
lobe size spread and the bare-trunk fraction all sit inside the reference band;
the brief's "rounded masses on a visible trunk with clustered sizes" is a
description of what `vTree`'s `'round'` branch already builds.

**The hue is the wrong one.** The reference's foliage is a chartreuse with red
at 0.75-0.78 of green; ours is a true green at 0.41-0.50. In a renderer whose
shaded luminance is `0.136R + 0.517G + 0.060B`, lifting red at constant green is
free luminance and free warmth, and it is the difference between foliage that
reads as a lit mass and foliage that reads as a dark hole beside a bright road.

**The value ladder is too flat and the lobes are mapped to it backwards.**
`vTree` gives `c[0]` -- the darkest colour in every palette -- to the biggest,
highest-volume central sphere at y 4.4, and `c[c.length-1]` -- the lightest -- to
a *low* side lobe at y 3.9. So on a three-colour palette the darkest mass sits in
the middle and the lightest sits underneath, which is the opposite of a canopy.

## Spec

**T1. Reverse the lobe-to-value mapping so value tracks height.** Sort the
palette light-to-dark and assign by the lobe's y: the crown lobe at 5.7 takes the
lightest, the main mass at 4.4 the middle, the two side lobes at 3.7 and 3.9 the
darkest. **Zero triangles, zero draws, four lines.**

**T2. Widen the ladder to 1.70 and warm the hue to R = 0.76G.** Per palette,
three colours whose shaded luminances stand in 1.00 : 1.30 : 1.70 and whose red
channel is 0.75-0.78 of green. For the generic city green that is roughly
`0x6f9a34` / `0x93c245` / `0xb4e256` in place of `0x3f9a52` / `0x4faf5f` /
`0x62c470`. **Zero triangles.**

**T3. Saturate the trunk and warm it.** `0x8a5a3c` S 0.565 becomes about
`0xb0662e`, S 0.74, matching the reference's (174,102,54). The plane-tree grey
`0x9a9a86` stays -- a London plane really is grey and it is the one that reads as
London. **Zero triangles.**

**T4. Six lobes, not four, and a forked trunk. +104 triangles per round tree.**

An earlier draft of this section proposed cutting the crown from seg 8/7 to
seg 6 to pay for section 5. With a real ceiling that is the wrong direction.

- **Six lobes rather than four**, sizes 2.0 / 1.6 / 1.5 / 1.4 / 1.2 / 0.9 --
  ratio 2.2:1, against the reference's visibly clustered 3-5 per crown. The two
  extra lobes go low and outboard where they break the crown's outline against
  the sky, which is the only place a lobe earns anything. `sph(r, seg)` builds
  `SphereGeometry(r, seg, seg-2)`, so a seg-7 lobe is 56 triangles: **+112**.
- **A forked trunk.** Every reference trunk splits into two or three branches
  before it enters the crown -- clearly visible in both `tgr-taxi-street` and
  `tgr-boulevard`, and it is what stops the trunk reading as a post. Two leaning
  6-segment cylinders off the top of the trunk, 24 triangles each: **+48**.
- **Drop one existing lobe's overlap** so the six do not read as a sphere: net
  **+104 per tree, 272 -> 376, scenery so counted once.**

At 30 live trees that is +3,100 triangles, 3% of a 91k frame.

**Not copied:** the reference's crowns are smooth-shaded with a soft gradient
running across each lobe and a translucent edge where the sun comes through.
Adding lobes does not buy that and is not meant to -- lobes buy **outline**,
which is the part that survives a banded ramp. **The gradient's transferable
substitute is the 1.70 value ladder in T2, and the ordering in T1 is what makes
the ladder read as a canopy rather than as noise. Both are free, and both matter
more than the extra lobes.**

---

# 7. Buildings

## The brief's premise is wrong and it is worth correcting

`vTerrace` already builds, per bay: a stone base course and a string course, a
door, an optional stoop, windows standing proud of the facade with a lintel over
each, balconies with a slab and seven railing bars, fire escapes, a rack of
hanging signboards, five kinds of roof, chimneys and a rooftop water tank. That
is not "flat colour blocks with window rectangles" and it is already richer per
bay than `tgr-shopfronts` is.

At 60 units a 4.6-unit bay is 93px in a 1344-tall portrait and a 1.15-tall window
is 23px; at 120 units, 46px and 12px. **Window detail resolves. More of it will
not help.**

## What the reference has that we do not

| | TGR shopfronts | ours |
|---|---|---|
| ground floor differs from upper floors | **pale cream + full-bay blue glazing** | stone base course + a door |
| awning over the shopfront | **striped, projecting, on every bay** | none |
| balconies | slab + black railing | slab + 7 railing bars |
| window frames | 2-colour, frame + glass | proud box + lintel |
| hanging signage over the pavement | shaped 3D signs on brackets | Tokyo only (`t.neon`) |
| bunting across the street | yes | **yes, already** |
| facade saturation (dominant mass) | **0.39-0.69** | **0.07-0.24** |

Measured facades, `tgr-shopfronts` right-hand block: (133,105,189) S 0.444,
(203,175,63) S 0.690, (133,147,217) S 0.387, (77,133,189) S 0.593. Ours, from
`w31.7`: the dominant building mass is (161,175,189) L 173.0 **S 0.148**, 25% of
the building area, with (21,21,49) navy windows at 28%.

## Spec

**B1. The awning. +24 triangles per bay, 120 per five-bay terrace.**

Two boxes: a canopy sloping out from the facade at the top of the ground floor,
and a fascia hanging off its front edge. It is the strongest single "this is a
shop, not a wall" cue in the reference, it sits at 3-4 world units which is
exactly the band the camera looks through, and because it is a horizontal
projecting plane it catches a different toon band from the wall behind it -- so
it reads as depth rather than as paint, which is the whole reason it earns its
cost in this renderer rather than only in the reference's.

**Divergence:** the reference's awnings are striped, and stripes on a 93px-wide
bay at 60 units alias into a flat mean by 100 units -- the same failure the JUMP
chevron block was measured at in section 2. **One colour per awning, drawn from
the setting's accent list, with the fascia one step darker than the canopy.**

**B2. The shopfront glazing band. +24 triangles per bay.**

Replace the ground floor's stone base with base + a full-bay glazing band about
2.0 tall in a cool pale colour + a stall riser under it. This is the reference's
single largest ground-floor mass and ours is currently solid trim. It also gives
the street a light band at eye level that the crowd barrier reads against.

**B3. One hanging sign per three bays. +24 triangles per sign, ~40 per terrace.**

A bracket and a board hung perpendicular to the facade at awning height. This is
the pizza-slice device and it is the only item here that buys *depth* rather than
detail: because the board is perpendicular, it crosses in front of the next
building along and gives the street wall a parallax it does not currently have.

**B4. Two-colour windows. +96 triangles per bay, 480 per five-bay terrace.**

Every window in the reference is a coloured glass panel inside a surround in a
*different* colour -- blue glass in a pink frame on the yellow facade, blue in
white on the green. Ours is a proud box in `t.win` with a lintel over it, which
gives the top edge but not the frame.

One surround box per window, 0.06 larger in both directions and 0.04 shallower,
in `t.trim` on pale facades and one step lighter than the wall on dark ones. At
eight windows a bay that is +96 triangles per bay -- the largest single line in
this section, and at 60 units a window is 23px so the frame is 1-2px, which is
exactly the size at which a hard value edge still separates two masses. **At 120
units it stops resolving and merges into the window's mean, which is the correct
failure mode: the window gets slightly lighter with distance and nothing else
happens.**

**B5. Balconies on more of the fleet of settings.** `t.balcony` exists and is
switched on for Berlin only. **CORRECTION: `t.balcony` was already on for Berlin, Sydney, Paris, Valencia and Rome before this pass began.** The reference has one on nearly every upper floor,
and a projecting slab with a railing is the strongest depth cue on a facade
because it is the only part that casts its own outline against the wall behind.
Turning it on for the two or three other settings whose architecture supports it
costs what it already costs -- slab 12 + seven bars 84 + handrail 12 = **108
triangles per balconied floor** -- and adds nothing new to build.

**B6. Do not raise facade saturation to match.** The reference is a candy town.
Ours is twelve named cities whose palettes are deliberately real -- London
stucco, Boston brownstone, Chicago limestone -- and Bo-Kaap already exists in the
table as the saturated one, with a comment saying exactly why it is the
exception. Turning London magenta to score 0.5 on a saturation metric would trade
a genuine asset for a look we do not want and cannot justify. **Facade colour is
the one place in this whole teardown where the reference should be ignored.**

**B7. Still not worth building, and now on resolution grounds alone.** Glazing
bars inside a window, per-floor cornice mouldings, balcony planting, door
furniture, and any per-bay variation smaller than about 0.25 world units. At 60
units 0.25 world is 5px and at 120 units it is 2px, so all of it converges on the
facade's mean before it is ever read. **This is the one veto in the document that
does not move when the ceiling moves** -- it was never a budget argument, and
under-a-pixel detail costs triangles to produce nothing at any ceiling.

Section total: awning 24 + shopfront 24 + hanging sign ~8 + window surrounds 96 =
**152 triangles per bay, ~760 per five-bay terrace**, scenery so counted once.
With three or four terraces in frame that is **+3,000**, 3% of a 91k frame.

---

# Findings, in priority order

Ordered by perceived-quality gain, with cost stated. Cost is a fact here, not a
tie-breaker: the whole spec is +10,400 rendered triangles on a 91k peak against a
150k ceiling, so nothing on this list competes with anything else on it and the
correct plan is to build all of it.

1. **Give each vehicle its own saturated livery and take the cream off the warm
   ones. Zero triangles.** Ten variants inside a 12-luminance, 0.15-saturation
   band all measuring the same mauve is the complaint, stated numerically. Five
   of seven variants reach the 1.6x/0.30 target for the first time in the game's
   history. **If only one change is made, make this one** -- and it is first on
   quality, not on thrift: no amount of geometry fixes ten objects that are the
   same colour, and every item below reads better on a body that is not mauve.
2. **Glass to 26-34% of the rear elevation, split into a 1.62:1 two-band ramp,
   and put a rear window on the van and the refuse truck.** +24 rendered per
   vehicle; the 2.3x area increase itself is free. Two of eight vehicles showing
   no glass at all from the only angle the game has is the second-largest reason
   the fleet reads as boxes.
3. **Round wheels in real arch openings, with lit road showing under the sill.**
   +160 rendered per wheeled vehicle net. This is the item the false ceiling
   reduced to a painted rectangle; built properly it is the one change that makes
   a vehicle stop being a box that ends at the road.
4. **Dark bumper full-width at the bottom, 13% of the elevation, with a pale
   number plate on it.** +24 rendered; the bumper move is free. The plate is 6.5x
   the bumper it sits on and is the lowest bright element on the vehicle.
5. **Trees: reverse the lobe-to-value mapping, widen the ladder to 1.70, warm the
   hue to R = 0.76G, saturate the trunk.** Zero triangles, and per unit of effort
   it is the largest perceptual change in the document after item 1.
6. **Round two-part lamps -- near-white core inside a red surround.** +232
   rendered per vehicle. Red alone is darker than the road and cannot be used
   unsupported.
7. **The body stops being a box: shoulder crease, inset greenhouse with pillars,
   two-step roof chamfer.** +120 rendered per vehicle.
8. **Trees: six lobes and a forked trunk.** +104 per tree, +3,100 in a heavy
   frame.
9. **Buildings: awning, shopfront glazing band, two-colour window surrounds,
   hanging signs, balconies on more settings.** ~760 per five-bay terrace,
   +3,000 in a heavy frame.
10. **Turn the taxi to face the camera.** Zero triangles, real read risk, measure
    before extending it to anything else.

# Deliberately not copied, this pass

- **Gloss, specular sweeps and lens highlights.** Section 3 established this and
  nothing here contradicts it. The glass ramp is the transferable part and it is
  two flat bands, not a gradient.
- **Smooth-shaded curvature.** The reference's shoulder line, wheel arch and roof
  dome are all gradients over curved panels. All three are specified above as
  **steps between authored colours**, because a banded ramp renders a gradient as
  a step anyway and it is better to place the step deliberately.
- **The novelty vehicles.** Event skins, not art direction, and they would put a
  second decorative colour system on top of a hazard hue that is a gameplay
  signal.
- **Striped awnings.** They alias to their mean by 100 units, which is the same
  failure the chevron block was measured at.
- **Saturated facades.** Twelve real city palettes are worth more than a metric.
- **Sub-pixel building detail** -- glazing bars, cornice mouldings, door
  furniture. A resolution argument, not a budget one, and the only veto in this
  document that does not move when the ceiling does.

# What was withdrawn when the ceiling turned out to be imaginary

Recorded so the reasoning is auditable. An earlier draft of sections 5-7 was
written to a 75k working ceiling and specified three cuts to pay for itself:
crown spheres from seg 8/7 down to seg 6 (-104 per tree), wheel arches as flat
painted rectangles instead of real openings, and box lamps instead of discs. All
three are withdrawn. **Only one cut survives, and on its own merits: the two
front wheels on every wheeled variant are occluded by their own body from a chase
camera at every distance, and geometry that can never be seen should not be
built at any ceiling.**
