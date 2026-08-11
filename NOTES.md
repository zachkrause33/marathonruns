# Notes — what I actually saw in each picture

## How I worked

The images are tiny (85–132 px tall), so I upscaled every one 7× (both nearest-neighbour
and Lanczos) and cropped and re-enlarged individual objects when I needed to identify them.

Reading "which lane" off eyeballing alone is unreliable in these, because the camera is not
always centred on the road and a lane can run off the bottom edge of the frame. So for each
image I measured the road geometry numerically: I scanned pixel rows and located the two
broken lane lines (a light lavender `(120,107,172)` with olive dashes) and the two solid
white edge lines `(165,166,187)`. Two broken lines plus two solid edges = exactly three
lanes, and that held in all sixteen pictures. Fitting the four lines gave me a vanishing
point for each image, from which I could work out where each lane sits at any height in the
frame, and then check which lane an object's *base* falls in rather than guessing from where
its bulk appears. In several images (041a626e, bf062179, d0fcb50a) this mattered — the lane
you would guess by eye is not the lane the object is standing in.

Anything beyond the outer white lines — kerbs, pavements, crowds, grass verges, bollards,
bridge railings, water, the separate carriageway on the left of 7f0cce4f — I treated as
not part of the three lanes, as instructed.

### Scale check

To judge whether a thing is low enough to go over, I calibrated using perspective: at a given
depth, image height and image width scale the same way, so I compared object heights against
the measured lane width there (taking a lane as roughly 3.2 m). A traffic cone in 05cc80b5
came out at 0.73 m by this method, which is right for a real cone, so I trusted the method.
On that scale the yellow gantry beams sit about 2.5–3 m above the road, the plastic and
trestle barriers about 1.5 m, the block wall in 141e54c6 about 1.3 m, and the tall slab in
041a626e about 6 m.

### A colour cue I noticed, and how much I leaned on it

Eight of the sixteen pictures wash one or more lanes in a rippling coloured tint. Across those
eight the tint is perfectly consistent with the object standing in that lane:

- **pink/magenta** — always a lane blocked by something impassable (the tall slab, a bus, a
  lorry, a manned road-works hoarding)
- **cyan** — always a lane running under a yellow gantry beam
- **gold/amber** — always a lane with a low thing standing on the road (a hollow-block wall,
  a heap of rubble, a trestle barrier, a run of blue barriers)
- **no tint** — always a lane with nothing in it

I did not use the tint to decide anything on its own; I read the objects first and used the
tint only as a cross-check. It agreed every time. It was, however, genuinely useful for one
thing: it settled the blue plastic barriers and the red/white trestle barrier as *jumpable*
rather than dead ends, because both of those exact sprites appear gold-tinted in f8123696 and
ce3eb8d9 respectively. That let me classify the same sprites consistently in the untinted
pictures (191bb0ff, bc22e0f5, 7f0cce4f).

The tinted pictures are 041a626e, 061456d9, 141e54c6, 3da925dd, 4e43dee0, ce3eb8d9, d0fcb50a
and f8123696. The untinted ones, where I had only the objects to go on, are 05cc80b5,
191bb0ff, 32a1aeba, 41906cc6, 7f0cce4f, bc22e0f5, bf062179 and f21f97d1.

### What stayed unclear

Three recurring objects never appear in a tinted lane anywhere, so I am inferring their demand
from their height alone rather than reading it off the picture:

- **traffic cones** (05cc80b5, 41906cc6) — measured about 0.7 m, so I called them OVER
- **the pair of teal kick-scooters** (191bb0ff, 32a1aeba, f21f97d1) — about waist high at the
  handlebars, so I called them OVER
- **the flat white/teal puddle** (05cc80b5, 41906cc6, f21f97d1) — essentially no height at
  all; I never had to make it the deciding factor, because in all three pictures it shares a
  lane with a bigger obstacle

Fortunately none of my lane choices turns on any of these: in every picture containing them
there was a genuinely clear lane elsewhere.

---

## Image by image

### 041a626e.png — take the right lane
A tall grey slab with blue and red chequered edges stands in the left lane, filling it from
edge to edge and rising above the horizon line, so it is about three times my own height —
nothing to be done with it but avoid the lane. The middle lane has a yellow gantry: its two
legs come down exactly on the left/middle and middle/right lane lines, and its yellow hatched
beam is suspended overhead with open road beneath, so that lane is a duck-under. The right
lane, between the right-hand broken line and the solid white line by the kerb where the crowd
is standing, is bare tarmac. The left lane is washed pink and the middle cyan. Note that the
right lane runs off the bottom-right of the frame, so it looks smaller than it is; measuring
the lines is what showed it is a full lane.

### 05cc80b5.png — take the right lane
Tree-lined road. A yellow works truck with a blue cab window and a red/white chevron panel is
parked in the left lane, spanning it completely. The middle lane has three orange cones set
across it with a pale sandbag slumped over the nearest one, and a flat white-and-teal puddle
lying on the tarmac closer to the camera. The truck's right flank just touches the middle
lane line. The right lane is empty tarmac out to the white edge line and the hard shoulder
beyond. I called the middle OVER because everything in it is cone height, but that is the
least certain judgement in this image; it does not affect the choice, since the right lane is
plainly free.

### 061456d9.png — take the left lane
City street with pedestrians and red/white barriers on the pavement to the right, and a
separate lighter road surface off to the left. On my road, the middle lane is shut by a
wheeled red-and-white striped hoarding with two workmen behind it and a round red no-entry
sign; the right lane is filled by the back of a green lorry. Both lanes are washed pink. The
left lane is untinted dark tarmac with a single orange cone sitting on the left/middle line
marking the works. Clean run down the left.

### 141e54c6.png — take the middle lane
A three-legged yellow gantry, legs planted on the left edge line and on both broken lines,
carries a hatched beam across the left and middle lanes; both are washed cyan and both are
duck-unders. The right lane is washed gold and holds a low wall of brown hollow blocks, two
courses high, standing on a khaki strip — about 1.3 m by my measurement, with clear air above
it, so a vault. Nothing here is free. I chose the middle over the left, but they demand
identically the same thing and the pick between them is arbitrary; I preferred ducking a
clear span to clearing a solid block wall at speed.

### 191bb0ff.png — take the left lane
A bridge or causeway, railings and pale water on the right. The middle lane has a pair of
dumped teal kick-scooters lying across it, handlebars up. The right lane has a run of blue
plastic barriers with a light-blue top rail and a pink stripe along the bottom — the same
sprite that appears gold-tinted (jump) in f8123696, which is why I called it OVER here. The
left lane is completely empty tarmac; I cropped and checked it specifically. No tints in this
picture, so the middle and right readings rest on the sprite match and on their height rather
than on anything the image states.

### 32a1aeba.png — take the middle lane
Yellow gantry on the left, legs on the left edge line and the first broken line, so it spans
only the left lane: duck. The right lane has the same pair of teal kick-scooters as in
191bb0ff and f21f97d1. The middle lane is bare tarmac from the bottom of the frame to the
haze — I cropped it to be sure, and there is nothing in it but the road texture and the two
lane lines. Straightforward middle.

### 3da925dd.png — take the left lane
A blue bus is stopped in the middle lane, filling it exactly between the two broken lines
(the lane is pink-washed). The right lane is cyan-washed and runs under a yellow gantry whose
legs sit on the right-hand broken line and the white edge line. The left lane is untinted
plain tarmac. One of the cleanest of the set: pink for the blocked lane, cyan for the duck,
nothing for the free one.

### 41906cc6.png — take the right lane
Yellow gantry over the left lane (legs on the left edge line and the first broken line), with
a big green-and-white drink bottle floating in that lane under the beam and a flat puddle on
the road in front of it. The bottle looks like a pickup rather than an obstacle, but the beam
still makes that lane a duck. The middle lane has three cones set right across it. The right
lane is empty apart from the outermost cone standing on the lane line — I cropped the right
lane to confirm it, and it is clear all the way to the verge.

### 4e43dee0.png — take the middle lane
Wide bridge scene. A three-legged yellow gantry carries two hatched beam sections over the
left and middle lanes, both cyan-washed: two ducks. The right lane is pink-washed and shut by
a red-and-white striped hoarding with a workman standing behind it, a red no-entry sign and a
cone at its foot — the same manned-hoarding sprite as in 061456d9, and quite different from
the small unmanned trestle barrier elsewhere. No free lane, so I duck; middle and left are
interchangeable.

### 7f0cce4f.png — take the left lane
The gantry legs land on both broken lines, so its beam spans the middle lane only: duck. The
right lane holds a low red-and-white striped trestle barrier with a brown board and a cone —
pixel-for-pixel the same object that is gold-tinted (jump) in ce3eb8d9, so I read it as a
vault. The left lane is empty. The blue guardrail and the second carriageway beyond the left
white line are not part of my road and I ignored them.

### bc22e0f5.png — take the left lane
One unbroken line of barriers crosses two lanes: blue plastic barriers over the middle lane
and the red/white trestle barrier over the right lane — the same two sprites that appear
gold-tinted in f8123696 and ce3eb8d9, so both are jumps rather than dead ends. Neither is
higher than about chest level and there is nothing above them. The left lane is wide open.
No tints in this picture, so those two OVER calls come from the sprite match, not from the
image itself.

### bf062179.png — take the right lane
The gantry legs sit on the left edge line and the first broken line, so despite appearing
central in the frame, the beam covers the **left** lane only — this is one where measuring
the lines changed my answer. The middle lane has a pink delivery motorbike with a rider and a
top box riding away ahead of me, which fills the lane and cannot be gone over or under. The
right lane is empty tarmac; I cropped it to confirm.

### ce3eb8d9.png — take the middle lane
Only one lane has anything in it. The right lane is gold-washed and crossed by the low
red-and-white trestle barrier with a brown board: a jump. The left and middle lanes are both
plain empty tarmac. I picked the middle for room on either side, but the left is exactly as
free, so that half of the answer is a coin toss — hence "fairly sure" on the choice even
though I am confident about all three demands.

### d0fcb50a.png — take the left lane
Two separate yellow gantries, not one wide one: the first has legs on the left edge line and
the first broken line, the second on the second broken line and the right edge line. So the
left and right lanes each pass under a beam and are both cyan-washed. The middle lane is
gold-washed and blocked by a low heap of orange and tan rubble or sandbags piled on the road.
Nothing is free. I chose to duck rather than jump — the beams measure around 3 m of clearance
whereas the heap is loose material about 1.4 m high — and took the left; the right lane
demands the same thing.

### f21f97d1.png — take the middle lane
The right lane has the pair of teal kick-scooters lying across it, with a flat green-and-white
puddle on the tarmac nearer to me and a floating drink bottle out over the kerb line. The left
and middle lanes are both empty tarmac. Middle chosen for centrality; the left is equally
free, so again the choice between the two clear lanes is arbitrary. The red-and-white railings
and the pedestrians are on the pavement beyond the right-hand white line.

### f8123696.png — take the left lane
Bridge again. The middle lane is gold-washed and crossed by the run of blue plastic barriers
with the pink base stripe: a jump. The right lane is cyan-washed and runs under a yellow
gantry whose legs sit on the right-hand broken line and the white edge line: a duck. The left
lane is untinted, plain, and completely empty. This picture is the one that pinned down the
blue barrier as a jump-over rather than a dead end, which I then applied to 191bb0ff and
bc22e0f5.
