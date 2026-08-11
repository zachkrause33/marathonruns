# Notes

## How I read these pictures

The images are small (roughly 110–220 px wide), so I upscaled every one and then
cropped and re-zoomed the parts that mattered. Eyeballing perspective at that size
is unreliable, so I also did it numerically: I detected the purple/lavender broken
lane lines in each image, fitted a straight line to each of the two of them, and
then derived the outer road edges by stepping one lane-width outward at each row.
That gives me, for any row in the picture, the x-range of the left, middle and
right lanes. I then checked each obstacle's horizontal extent at the row where its
base touches the road. In nearly every image the derived outer edges landed right
on the painted white edge lines, which is a good sign the fit was correct.

The extra stuff outside those edges — kerbs, pavements, railings, the second darker
carriageway on the far left of some shots, the water on the bridge shots, bollards,
street furniture, pedestrians — I ignored, as instructed.

## The road's own colour code

Several images paint a glowing hatched strip down a lane when the obstacle is close
enough. Comparing across images, the code is consistent:

- **gold/amber strip** — low obstacle you clear: scooters, bicycles, blue barrier
  units, striped trestles, traffic cones.
- **cyan/teal strip** — a gantry overhead: you duck.
- **magenta/pink strip** — a stopped vehicle filling the lane: you cannot pass.
- **no strip** — nothing there.

I did not rely on this alone; I identified each object on its own merits first and
used the glow as a cross-check. Where they were both present they always agreed.
In the images where obstacles are further away there is no glow at all, and there
I had to judge from the object itself — that is where my confidence drops.

One rough rule I derived from the glowing images and applied to the unglowing ones:
things marked gold measure about 0.4–0.5 of a lane-width tall; things marked magenta
measure about 1.4–1.5 lane-widths. That gap is wide enough to be useful.

I also concluded the green drinks bottles are pickups rather than obstacles. This
is a running game, they look like aid-station bottles, and in one image the same
bottle sprite sits out on the pavement where no obstacle would be.

## Per image

**2bd4c77e.png** — Dual carriageway between grass verges. The fitted edges land on
the two white lines, and the two broken lines divide the tarmac cleanly into three.
The only object is a red-and-white striped trestle barrier on short wooden legs,
sitting wholly to the right of the second broken line. Same sprite that glows gold
in b242e062 and 7a103c3c. Left and middle are bare. Took middle. **left CLEAR /
middle CLEAR / right OVER.**

**544f9e3e.png** — City street. The measured lane boundaries at the obstacle row
put the striped barricade in the middle lane (x≈51–86 against a middle lane of
53–90) and the green refuse lorry in the right lane (x≈90–130 against a right lane
of 90–128). Zooming into the middle lane shows more than a barrier: a portable
striped panel on legs, a cone at its foot, a large red no-entry sign, and two
workmen standing on the road immediately behind the panel. The panel by itself is
about 0.7 lane-widths — taller than the things marked gold, shorter than the things
marked magenta — but a closed-lane sign plus people standing in the lane is not
something you hurdle. I called it AROUND. The lorry is plainly impassable. Zooming
into the left lane shows completely empty tarmac; the only cone near it sits on the
middle-lane side of the broken line. **left CLEAR / middle AROUND / right AROUND.**

**65c2d675.png** — Street with railings. Gold strip down the right lane with a teal
kick-scooter across it. The big green-capped bottle sits past the right white edge
line on the kerb, so it is not in a lane at all. Left and middle empty. Took middle.
**left CLEAR / middle CLEAR / right OVER.**

**6ca383f2.png** — Bridge over water. Blue crash-barrier blocks measured at x≈48–89
against a middle lane of 50–86, so they are the middle lane. The gantry legs measured
at x≈83 and x≈121 against a right lane of 86–121, so the beam spans the right lane
with clear road beneath. Left lane bare. Took left. **left CLEAR / middle OVER /
right UNDER.**

**7281d1c5.png** — Bridge at dusk. Two gold strips side by side: a green scooter in
the middle lane, a blue barrier unit in the right. Both low. Left lane dark and
empty. Took left. **left CLEAR / middle OVER / right OVER.**

**7a103c3c.png** — Underpass. The gantry legs (x≈200 and 360 in my upscaled frame)
match the middle lane's computed span (212–354), and the middle lane glows cyan.
The striped trestle sits in the right lane on gold. Left lane clean. Took left.
**left CLEAR / middle UNDER / right OVER.**

**85424f29.png** — Tall crop. Gantry legs land on the left edge line and the first
broken line, so its beam covers the left lane, which glows cyan; the green bottle
under it I read as a pickup. Three cones in the middle lane on gold. Right lane
plain dark tarmac. Took right. **left UNDER / middle OVER / right CLEAR.**

**856f4eb5.png** — Two separate gantries here, not one. Their legs measure at
x≈45/74 and x≈98/128, against computed lane boundaries of 45 / 72.5 / 100 / 127.5 —
so one bay is exactly the left lane and the other exactly the right lane, with a
gap of open sky over the middle. In that gap sits a low scattered heap of orange
and tan objects, about 0.48 lane-widths tall, which puts it in the jump class.
I could not tell what the heap actually is — logs, sacks, or produce. All three
lanes go, and I took the left gantry bay because open road under a beam is a
cleaner line than a loose heap. **left UNDER / middle OVER / right UNDER.**

**9aec9b26.png** — Tree-lined road. Yellow works lorry across the left lane over a
magenta strip. Cones plus some spilled yellow material in the middle lane on gold.
Right lane unlit and empty. Took right. **left AROUND / middle OVER / right CLEAR.**

**a90f61e8.png** — The left lane holds the back of a tall bus that runs off the top
of the frame; measured at x≈110–345 against a left lane of 94–342. The gantry legs
at x≈350 and x≈590 match the middle lane's 342–591. Right lane empty. Took right.
**left AROUND / middle UNDER / right CLEAR.**

**b242e062.png** — Blue barrier in the middle, striped trestle in the right, both on
gold strips, both low. Left lane bare with no glow. Took left. **left CLEAR /
middle OVER / right OVER.**

**baf0f97f.png** — Blue bus stopped dead in the middle lane (measured x≈37–66
against a middle lane of 38–69), tail lights facing me, far too tall to pass.
Gantry to its right straddling the right lane. Left lane empty. This was the one
image where my line fit was least well behaved — the left broken line is almost
vertical in frame — so I re-measured the dividers row by row instead of trusting
the fit, and the assignment held. Took left. **left CLEAR / middle AROUND /
right UNDER.**

**e49e2a2c.png** — The yellow structure is a two-bay gantry with three legs, and
the legs measure at x≈12, 40.5, 69 against computed lane boundaries of 13.7, 40.9,
68.1 — an almost exact match, so the beams cover the left and middle lanes with
open road under both. The right lane is the same worksite tableau as 544f9e3e:
striped barricade, red no-entry sign, workmen on the tarmac, a cone, and a works
vehicle behind. Called AROUND for the same reason. Took the middle bay.
**left UNDER / middle UNDER / right AROUND.** The right lane is the call I am least
sure of — the barricade panel alone might be jumpable, but not with people standing
behind it.

**e634c75b.png** — The clearest example of the colour code: cyan strip down the left
lane with the gantry legs on its boundaries, magenta strip down the middle with a
tall red vehicle in it, and an unmarked empty right lane. Took right.
**left UNDER / middle AROUND / right CLEAR.**

**f178f8f9.png** — Another two-bay gantry: legs at x≈17.5, 54, 90 against boundaries
of 16, 52, 88, so left and middle both duck. The right lane holds a stacked bundle
of pipes or logs, two rows high, measuring about 0.5 lane-widths — the same
proportion as the objects that glow gold elsewhere — so I called it OVER. Nothing
in this picture actually marks it, so that is an inference, and it is the weakest
one in the set. Took the middle bay. **left UNDER / middle UNDER / right OVER.**

**f236c433.png** — Cyan strip and gantry over the left lane, gold strip and a teal
bicycle in the right lane, middle lane unmarked and empty. Took middle.
**left UNDER / middle CLEAR / right OVER.**

## Where I'd want a second look

- The two roadworks tableaux (544f9e3e middle, e49e2a2c right). I read the no-entry
  sign and the workmen standing in the lane as making it a lane you must not enter.
  If the game only counts the striped panel, those would be OVER instead.
- The heap in 856f4eb5's middle lane and the pipe stack in f178f8f9's right lane.
  Both are unlit, so I judged them purely on height against lane width. Both fall
  in the jump range, but neither is confirmed by the road's own markings.
