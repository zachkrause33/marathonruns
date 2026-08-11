# Notes

## How I looked at these

The images are tiny (roughly 100–210 px across), so eyeballing them at native size
was not enough. For each one I upscaled 6–24× with nearest-neighbour so no pixels got
invented, and then, where the lane boundaries mattered, I scanned individual pixel rows
and printed the colour runs. That turned out to be the decisive tool, because the road
markings have consistent, distinct colours across the whole set:

- `#a5a6bb` (pale blue-grey) — the **solid edge line** at each side of the carriageway
- `#786bac` / `#4a4172` (lavender, with darker edging) — the **broken lane lines**
- `#938d7b` (beige) — the dash segments where a lane line catches the light

So on a row scan the road always reads as **edge / lane line / lane line / edge**, four
lines and exactly three lanes, which is what the prompt says to expect. That let me pin
the lane boundaries at any given depth and then check which lane an object actually
falls in — several times the answer was not what my first glance said, because objects
sit far away where the lanes are narrow and shifted from where they are at my feet.

I also used it to rule out the distractors the prompt warns about: kerbs, verges,
railings, hedges, pavements with pedestrians, water beside the bridge decks, and in one
case a second carriageway. None of those sit between the four road lines, so none of
them are lanes.

## The obstacle vocabulary

The same handful of props recur, and once I had measured a few of them the classes were
consistent. I judged height by comparing an object's pixel height against the local lane
width at the same depth, which is a fair comparison in this projection.

**UNDER — the yellow gantry.** Two (sometimes three) yellow legs planted exactly on
lane lines or edge lines, carrying a black-and-yellow hatched cross-bar. The bar always
hangs well above the road with open air beneath it; the clearance measures about
0.75 of a lane width. Two images (`783d01dd`, `7c1fe1b7`) have a *double* gantry — three
legs, one continuous bar — which covers two lanes at once. One image (`b1c7eaee`) has
two *separate* gantries over the two outside lanes. I checked leg positions against the
lane lines in every case rather than trusting the eye.

**OVER — the turquoise hurdle.** Two thin uprights with wide caps, and a solid bar or
box resting on the road between them with clear space above it. The bar measures about
0.2 of a lane width, i.e. knee height. This appears in `1efba3ea`, `372ab574` and
`437dfbdb`.

**AROUND — everything solid.** Vehicles (bus, green truck, yellow works truck,
motorbike), blue barrier blocks with a pink-and-white striped skirt, red-and-white
roadworks trestles, clusters of traffic cones, a stack of concrete pipes, and a heap of
sandbag-like blocks. All of these sit flat on the road with no opening under them, and
all measure roughly 0.4–0.6 of a lane width tall or more — well above the hurdle bar and
too tall to clear at running speed.

Several images also have a coloured "wash" laid over a lane's tarmac — cyan, gold or
pink. I initially took these for signage (cyan = duck, gold = jump) and it fits the
first few images, but it breaks down: `9d2f0312` has a gold wash ending in cones and a
pink one ending in a truck, and `0f0acb83` and `5500c318` have no wash at all next to
perfectly ordinary obstacles. So I treated the washes as lighting that merely flags
"something is in this lane" and made every actual call from the object itself.

---

## Image by image

**0f0acb83.png — take right.** The camera is low and left of centre. Left lane is filled
by a tall grey panel with blue and red blocks, flat on the road, no gap: closed. The
yellow gantry's legs come down on the two lavender lines at x≈37 and x≈64 (row y=56), so
its hatched bar covers the middle lane: duck under. The right lane, from the second
lavender line out to the pale edge line at x≈98, is bare tarmac. Take the right and
avoid the duck entirely.

**1efba3ea.png — take middle.** Row y=70 gives edge at 0–5, lane lines at 42–50 and
82–89, edge at 123–134: three clean lanes. The gold wash and the turquoise hurdle both
sit inside the right lane (90–122). The hurdle's low bar sits on the road with daylight
above it, so it is a jump. Left and middle are both bare. I chose the middle because it
is clear and still leaves an empty lane to my left; the left lane would have been an
equally correct answer.

**21f09ca0.png — take right.** The gantry straddles the left lane with one leg out on the
shoulder (x 14–20 at y=62) and one on the first lane line (x 50–55): duck under. The
middle lane holds three orange-and-white cones at x 56–88, sitting right on the lane
boundaries, about 0.48 of a lane width tall — nothing to get under and too tall to
hurdle, so the lane is shut. The right lane (x 91–121 at that depth, edge line at
122–126) is plain tarmac. The one thing I hesitated on was the gold wash under the cones,
since gold accompanies jumpable hurdles elsewhere; the cones themselves settled it.

**372ab574.png — take middle.** Row y=62 shows the gantry's legs as near-black bases at
x 47–53 and 83–88, sitting on the left edge line and the first lane line, so the bar
covers only the left lane, over a cyan-washed stretch. The right lane has a gold wash
ending in the turquoise hurdle at x 120–158. The middle lane (x 89–115) is empty the
whole way. Easy choice.

**437dfbdb.png — take left.** Bridge deck. Both gold washes are in the middle and right
lanes, confirmed by row y=100 where they land inside 66–112 and 123–173. At the top of
the middle wash is the turquoise hurdle (jump); at the top of the right wash is a blue
block with the pink-and-white striped skirt, about 0.55 of a lane width tall and closed
to the ground (blocked). The left lane is dark and empty, which beats jumping.

**5500c318.png — take middle.** The cleanest picture in the set: four straight lines,
three lanes, nothing at all in the left or middle. The right lane has a roadworks trestle
— red-and-white striped board, red reflector lamps, olive legs, a brown plank low down —
at x 87–127 against a right lane of 93–126 at that depth. Solid to the road, so I keep
out of it. I took the middle over the equally-clear left simply to avoid running tight
against the kerb.

**7095effa.png — take left.** The viewpoint is shifted left but row y=65 lays it out:
edge 10–14, lane line 45–50, cyan wash 51–80, lane line 81–87, gold wash 88–120, edge
124–129. The gantry legs sit on the two lane lines, so the middle lane is the duck-under.
The gold lane ends in a red-and-white roadworks barrier on trestle legs: blocked. The
left lane is untouched, so no duck needed.

**783d01dd.png — take left (fairly sure).** This one caught me out at first. The gantry
has **three** legs, at x 18–23, 53–59 and 89–94 on row y=62, which land on the left edge
line, the first lane line and the second lane line respectively, and the hatched bar runs
unbroken across both bays. So left *and* middle are both duck-unders with the same
clearance — I checked the bar is continuous at high zoom rather than two separate spans.
The right lane has a striped barrier panel on a stand, a cone and a worker with a stop
sign: closed. My "fairly sure" is only about the pick between two identical options; I
took the left to stay away from the people standing in the closed lane.

**7c1fe1b7.png — take left (fairly sure).** Same double-gantry arrangement: legs at
roughly x 9–13, 38–42 and 67–73, matching the left edge line, the first lane line and the
second lane line at that depth, one bar across both bays. Left and middle both duck. The
right lane holds a stack of brown concrete pipe sections, two rows of them with dark open
ends, about 0.41 of a lane width tall and completely solid: blocked. Again the
uncertainty is only the tie between the two under-lanes.

**8773e6f5.png — take left.** The blue bus fills x 49–80 at row y=62, and the middle lane
at that depth is 48–78 — it matches the lane exactly, tail lights, plate and striped
skirt all at road level, so it is a wall. The gantry is over on the right, legs at 81–83
and 111–117, straddling the right lane: duck. The left lane is empty. No need to duck at
all, so left.

**886babc2.png — take left.** Two lanes gone. The middle has a roadworks set — striped
barrier, two workers, a round no-entry sign, cones at both ends. The right has the back
of a dark green truck at x 79–100 against a right lane of 77–104 at row y=55, so it fills
it. The left lane is bare road all the way into the mist. Only one option and it is a
clean one.

**9d2f0312.png — take right.** Row y=105 gives edge 7–17, lane lines 79–89 and 139–149,
edge 198–205. The pink wash lies in the left lane and ends at the back of a yellow works
truck; the gold wash lies in the middle and ends in four cones at x 120–158. Both closed.
The right lane (150–197) is dark, unmarked tarmac. This is the image that killed my
theory that the wash colour encodes the required action, since here gold ends in cones
rather than a hurdle.

**a3d19dc1.png — take left.** Row y=62 puts the gold washes squarely in the middle
(39–67) and right (74–101) lanes. The middle ends in a blue barrier block with the pink
striped base; the right ends in a brown-and-red-and-white trestle. Both are solid to the
ground, neither has any clearance. The left lane is the unlit one and it is empty, so it
is the only lane I can actually run.

**b1c7eaee.png — take left (fairly sure).** Two *separate* gantries, not one wide one:
legs at roughly x 76–82 and 107–113 for the left one, and x 141–147 and 174–180 for the
right one, against lane boundaries of about 77 / 112 / 145 / 179 at that depth. So the
left and right lanes are each their own duck-under with near-identical clearance. The
middle lane holds a heap of orange and tan blocks — sandbags or spilled barriers, I
cannot tell which — reaching about 0.6 of the gantry's clearance, which is too high to
hurdle and has no gap underneath. That heap is the one object in the whole set I am not
confident naming, though its height makes the demand clear enough. There is also a white
transverse stop line across the road at the gantries' feet, which I initially misread as
a break in the tarmac. Either outside lane works; I took the left.

**c8e1250f.png — take left.** Bridge deck again. The blue barrier block sits in the
middle lane (x 39–74 against a middle lane of 44–67 at row y=52), about 0.57 of a lane
width tall with the pink striped base flush to the road: blocked. The gantry legs at
x 67–73 and 97–103 sit on the second lane line and the right edge line, so the right lane
is the duck-under. The left lane is empty, so I take it and stay upright. The railings and
water on the right are outside the carriageway.

**e555cabe.png — take right.** Row y=52 shows the gantry legs as near-black bases at
x 46–50 and 76–80, on the left edge line and the first lane line, so the cyan-washed left
lane is the duck. The pink-washed middle lane has a red motorbike with a tall box on the
back at x 82–105, filling the lane between the lines: blocked. The right lane (110–135,
edge line at 136–140) is bare. Taking the right means no duck and no jump.

---

## Summary

| image | left | middle | right | take | confidence |
|---|---|---|---|---|---|
| 0f0acb83 | AROUND | UNDER | CLEAR | right | sure |
| 1efba3ea | CLEAR | CLEAR | OVER | middle | sure |
| 21f09ca0 | UNDER | AROUND | CLEAR | right | sure |
| 372ab574 | UNDER | CLEAR | OVER | middle | sure |
| 437dfbdb | CLEAR | OVER | AROUND | left | sure |
| 5500c318 | CLEAR | CLEAR | AROUND | middle | sure |
| 7095effa | CLEAR | UNDER | AROUND | left | sure |
| 783d01dd | UNDER | UNDER | AROUND | left | fairly sure |
| 7c1fe1b7 | UNDER | UNDER | AROUND | left | fairly sure |
| 8773e6f5 | CLEAR | AROUND | UNDER | left | sure |
| 886babc2 | CLEAR | AROUND | AROUND | left | sure |
| 9d2f0312 | AROUND | AROUND | CLEAR | right | sure |
| a3d19dc1 | CLEAR | AROUND | AROUND | left | sure |
| b1c7eaee | UNDER | AROUND | UNDER | left | fairly sure |
| c8e1250f | CLEAR | AROUND | UNDER | left | sure |
| e555cabe | UNDER | AROUND | CLEAR | right | sure |

Every image had at least one lane I could actually take, and I never had to write
"cannot tell" for a lane. The three judgement calls I would flag are: the heap in the
middle of `b1c7eaee` (I can see its height but not what it is made of); whether the cone
clusters in `21f09ca0` and `9d2f0312` are meant as "blocked" rather than "jumpable", which
I settled on their height and on cones being a lane-closed marker; and the two ties in
`783d01dd` and `7c1fe1b7`, where the left and middle lanes sit under one continuous bar and
either choice is equally right.
