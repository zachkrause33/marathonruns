# Notes — reading the lanes

## How I looked at these

Every image is tiny (roughly 130–220 px across), so I upscaled each one and also
worked from raw pixel rows, because at native size the lane lines and the object
bases are only two or three pixels wide and it is very easy to mis-assign an
object to the wrong lane.

For each picture I did the same three things:

1. **Find the four longitudinal markings.** In all sixteen pictures the road is
   bounded by a pale/white edge line on each side with two broken violet lane
   lines between them. I located each of the four by scanning pixel rows at
   several depths, then checked that the three gaps came out roughly equal at a
   given row. Where the road bends the vanishing point is off to one side and
   the near lanes look unequal in width (7aba53af is the clearest case); that is
   expected and I checked it by projecting all four lines back to a common
   vanishing point instead of assuming equal on-screen widths.
2. **Sanity-check by overlay.** For the two pictures where the lane assignment
   was least obvious (142fef1c, 19281ab6) I drew my computed boundaries back
   onto the image and confirmed they land on the painted lines.
3. **Place each object by the x-range of its feet, not its top.** Several
   objects lean or overhang, so I used where they touch the tarmac.

## How I decided OVER vs AROUND

This was the one real judgement call, so I set a yardstick rather than guessing
each time. Measuring object height against the width of the lane it stands in
at the same depth, the objects in this set fall into two clean groups with
nothing in between:

- **~37–52 % of a lane width**: traffic cones, stacked timber, stacked pipes,
  blue crates, kick-scooters, and the open two-rail red/white striped barricade.
  The traffic cones in 7aba53af and c064db22 measure in this band, which is what
  anchors it — a cone is unambiguously something you clear, so everything at
  cone height is **OVER**.
- **~73 % to over 150 %**: the solid framed red/white barricade panels that come
  with a no-entry sign and workmen, the lorry, the bus, the tall hoarding, the
  loaded motorbike. Roughly double cone height or more, solid, lane-filling.
  These are **AROUND**.

Yellow gantries are a separate case: legs on the lane lines, hatched crossbeam
high overhead, clear road beneath — always **UNDER**.

I want to be explicit that this is an inference from a consistent height
grouping, not something the pictures label. The two red/white striped things are
genuinely different assets — the open two-rail barricade on legs (142fef1c,
b1cc1705, b598b487) is cone height and see-through, while the solid hatched
panel in a grey frame (19281ab6, 38eeeae0) is about twice that and opaque — and
I have treated them differently on that basis.

---

## Per image

### 142fef1c.png — left
Edge line at x≈5 at the bottom, violet lines at ≈58 and ≈111, right edge line
running off the bottom-right corner: three equal lanes. The yellow gantry's two
feet land at x≈44 and x≈74 at their depth, which is exactly on the two violet
lines, so it arches the **middle** lane; the beam is about 2/3 of a lane width
above the road, easily run under. The **right** lane holds the open red/white
striped barricade with brown boards, ~47 % of lane width — cone height, so a
jump. The **left** lane is empty asphalt. Took the left: nothing to do at all.

### 19281ab6.png — left
The trap here is the pink surfacing. The pink strip is only *two* lanes wide.
Measuring kerb-to-kerb (light kerb at x≈2–9 at y=90, violet lines at ≈58.5 and
≈108.5, kerb again at ≈159) gives three lanes of ~50 px each, so the third lane
is the plain dark-grey one on the left that simply has no pink surfacing.
Middle: solid hatched barricade panel in a grey frame, ~2× cone height, plus a
round red no-entry sign and two hi-vis workmen — AROUND. Right: the back of a
green lorry — AROUND. Left: entirely empty, with just one orange cone sitting on
the line between it and the middle. Took the left.

### 25810117.png — left
Lanes are glow-coded teal / tan / teal. **Two** gantries, not one: left feet at
x≈47 and ≈73 (left edge line and first violet line), right feet at ≈100 and
≈127 (second violet line and right edge line). So both side lanes are
duck-throughs and the middle carries a heap of stacked timber planks at ~43 % of
lane width. All three lanes demand something. Left and right are genuinely
interchangeable; I picked left only because the plank heap spills a little
further into the right lane. That is why the confidence is "fairly sure" — it is
the lane *pick* I am hedging on, not the three demands.

### 27251ac0.png — left
Three lanes confirmed from the edge line at x≈6.5, violet lines at ≈43 and ≈77,
edge line at ≈112 (row y=60). The only object is a pair of teal kick-scooters
standing side by side in the right lane, ~48 % of lane width — a hurdle. Left
and middle are both bare. Picked left as the further of the two from the
scooters; the middle is equally valid. The black bollards and red/white railings
on the right are on the pavement past the edge line, and the green
bottle-shaped object at the bottom-right corner is on the kerb, not the road.

### 38eeeae0.png — left
This is a single wide gantry with **three** legs (x≈12.5, ≈41, ≈70 at their
base), which lands them on the left edge line and both violet lines — so one
hatched beam covers the left *and* middle lanes together. Both are UNDER, both
clear underneath. The right lane (pink surfacing) is closed by the tall solid
hatched barricade panel with a sign and a workman above it and an orange cone at
its foot — ~73 % of lane width, opaque, lane-filling: AROUND. Took the left,
being furthest from the closure; the middle is equivalent.

### 69697751.png — left
Again a single three-legged gantry over the left and middle lanes (legs at
≈20.5, ≈55.5, ≈91 against boundaries at ≈18.6, ≈54.9, ≈89.9). The right lane
holds a stack of large pipes, two rows deep, open ends facing the camera, ~37 %
of lane width — a heap to jump. Took the left; middle is equally good.

### 6d91c6c7.png — left
Boundaries at y=100 come out at 4 / 59.5 / 115 / 170.5 — three lanes of ~55 px,
with the measured white edge lines at x≈0–4 and x≈170–177 matching the predicted
outer boundaries almost exactly, which is a good check. Middle: three blue
crates on a pale pallet, ~44 % — OVER. Right: gantry with feet on the second
violet line and the right edge line — UNDER. Left: bare asphalt, took it. The
railings and green water on the right are off the road (this looks like a
bridge).

### 7aba53af.png — right
The awkward one geometrically: the road bends right, the vanishing point sits at
about (162, 15), and the on-screen lane widths at y=100 are 70 / 57 / 45 px
left-to-right. That is not a mis-read — with the vanishing point that far right,
the leftmost lane genuinely subtends the widest angle, and projecting all four
lines back to the one point confirms it. A yellow works van fills the left lane
(overhanging the first violet line): AROUND. Three orange cones cross the middle
lane, the last just clipping the second violet line: OVER. The right lane is
open. Took the right.

### 8eb178fd.png — right
Boundaries at y=70: 11 / 50.5 / 85.5 / 123, so three lanes of ~37 px. Left
(pink) holds a tall grey-and-blue hoarding with red side blocks, about 60 px
tall against a 38 px lane — over 1.5 lane widths, far and away the tallest thing
in the set: AROUND. Middle (teal): gantry, feet on the two violet lines, UNDER.
Right: empty tarmac out to the edge line, with the kerb, orange handrail and
crowd beyond. Took the right.

### 9715cc94.png — left
Boundaries at y=70: 10.5 / 53 / 92.5 / 135.5. Middle holds two teal kick-scooters
(~45 %), right holds three blue crates on a pallet (~42 %) — both jumps. Left is
completely empty, so I take it and stay on the ground. Bridge railings and sea on
the right are outside the road.

### a578b115.png — left
Boundaries at y=60: 6 / 37.5 / 69 / 100.5, and the white edge lines measured at
x≈0–8 and x≈101–105 match the outer two. The back of a blue bus fills the middle
(pink) lane and is far taller than the lane is wide: AROUND. A gantry spans the
right (teal) lane, legs on the second violet line and the right edge line:
UNDER. Left is bare asphalt apart from a painted white dash lying flat on the
surface. Took the left.

### b1cc1705.png — right lane blocked, took left
Vanishing point at about (55, 6); lane width 34 px at y=60 with the edge lines
measured at x≈3 and x≈108, matching the predicted 5 and 107. The only object is
the open red/white striped barricade in the right (gold-glowing) lane — two
striped rails on short legs, 14.5 px against a 29.6 px lane, i.e. ~49 %, and you
can see straight through the frame. OVER. Left and middle are both bare; I took
the left as the further from it, so the lane pick is a preference.

### b598b487.png — left
Boundaries at y≈52.6: 6 / 34.2 / 67.2 / 97. Middle holds three blue crates on a
pallet (13.9 px, ~42 %), right holds the open striped barricade (13.6 px, ~46 %)
— both jumps, sitting shoulder to shoulder. Left is untouched all the way to the
haze. Took the left.

### b70bfbb4.png — middle
Boundaries at y=90: 21.5 / 76.5 / 126 / 183.5, three lanes of ~54 px. Gantry over
the **left** lane (legs at ≈50 and ≈85.5, matching the left edge line and the
first violet line). Two teal kick-scooters in the right lane — this is the
clearest view of that asset in the whole set, handlebars, stems, decks and wheels
all readable, which is what let me identify the same object in 27251ac0 and
9715cc94. ~49 % of lane width, so OVER; the outer scooter stands partly on the
edge line. The middle lane is bare for its whole length, so I take it and neither
jump nor duck.

### c064db22.png — right
Boundaries at y=70: 12.5 / 54.5 / 93.5 / 133.5, three lanes of ~40 px. Gantry
over the left lane (feet at ≈17 and ≈55). Three orange cones across the middle
lane, the rightmost stopping right at the second violet line, so all three are in
the middle: OVER. Right lane clear.
**What I could not read:** under the gantry, further up the left lane, there are
two small flat teal-green shapes — a green rectangle at about (32–39, 37–40) with
a pale blue patch under it, and a low mint/white/blue bar at about (27–45, 51–53).
They are only a couple of pixels tall and read as flat paint or a distant sign
lying on the surface rather than anything standing up, so I have not counted them
as an obstacle. If they are meant to be an object, the left lane would demand
more than just UNDER.

### dd2deb09.png — right
Boundaries at y=65: 27.5 / 67 / 103.5 / 144.5. Gantry over the left lane (legs at
≈48 and ≈77). The middle lane holds a red delivery motorbike carrying a tall
stack of red crates topped by a helmet-shaped box — 42.5 px tall against a ~30 px
lane, about 1.5 lane widths, and it fills the lane: AROUND. The right lane is
empty road into the haze. Took the right.

---

## Things worth flagging

- **Several images carry a thin horizontal white line straight across the whole
  frame** (25810117, 27251ac0, 69697751 among others). It is perfectly
  horizontal and spans the entire picture including the buildings and sky, so it
  is an overlay artefact, not road paint. I ignored it.
- **Coloured lane glows** (teal / tan / pink) appear in some images and not
  others. Where they appear they line up exactly with the lanes I derived from
  the painted lines, which was a useful independent check. But in 19281ab6 the
  pink surfacing covers only two of the three lanes, so the colouring must not be
  used to count lanes.
- **The tie-break cases.** In 25810117, 38eeeae0, 69697751, 27251ac0 and
  b1cc1705 two lanes are equally good and my named lane is a preference, not a
  forced choice. Those are the five marked "fairly sure", and in every one of
  them the hedge is about *which* lane, not about what the lanes demand.
