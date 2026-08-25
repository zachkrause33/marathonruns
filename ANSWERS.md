# Answers

Read PROMPT.txt, then looked at each of the 22 PNGs at normal size (they are all
780x1688, so what the viewer showed me *is* full size), and afterwards enlarged
crops of the far/hazy parts to check what I had missed. Where something only
became visible or only became identifiable after enlarging, I say so explicitly.

Two general notes that apply to nearly every image, so I don't repeat them at
length each time:

* **What "lane" means here.** The road surface carries two broken lavender
  dividing lines and a solid pale line at each kerb. I used those to decide
  LEFT / MIDDLE / RIGHT, and where an object's lane was ambiguous I checked the
  pixel columns of the dividing lines against the object's edges rather than
  guessing. Three images (`8d01f2b0`, `c3ae1f9c`, `d2ce4e0c`) have **no visible
  lane lines at all**, and I say so there.
* **Distance information.** Nothing in any image gives a *numeric distance to an
  object*. The overhead "MILE n" signs say how far into a race you are, not how
  far away anything is. The actual depth cues available are: the broken lane
  dashes and the darker cross-bands on the tarmac (both shrink evenly with
  distance, so they work as a ruler), how high up the frame an object's **base**
  sits, how much haze/desaturation it has, and the shadow ellipses under
  floating items.

---

## 025b6a00.png

**1. Anything to react to?** Yes, three things. Immediately: the flank of a long
blue bus running alongside in the LEFT lane, filling the whole left edge of the
frame — it's the nearest object by far. Further up the road, roughly at the point
where the road narrows to about a fifth of its near width, there is a row of
roadworks: a red-and-white striped barricade, a yellow hazard-striped gantry, and
a pair of teal scooters lying flat on the tarmac.

**2. Does anything single out ONE lane?** Not one — the far row assigns something
different to each lane, and I had to enlarge to separate them. The barricade sits
in the **LEFT** lane (x≈292–347 against a left lane of ≈296–355); the gantry's two
legs stand on the two dividing lines so its striped crossbar spans the **MIDDLE**
lane; the scooters lie in the **RIGHT** lane. The bus is also LEFT. So the middle
is the only lane whose obstacle is an overhead bar rather than something solid on
the ground.

**3. Anything telling you how far away something is?** No numbers. What I have:
the bus is enormous and cut off by the frame edge, so it's at contact range; the
roadworks row sits about half-way up the visible road with heavy haze on the
buildings behind it, so it's several lane-dashes off — call it a few seconds. A
solid white line runs across the whole road much nearer than the roadworks, which
gives a fixed mark to judge closing speed against, but it isn't labelled.

**4. Any lane marked faster or slower?** No. Nothing is painted on the road
surface here. The scooters *could* be something you pick up rather than something
you hit, but nothing in the picture says which, and I'm not going to invent it.

**5. Lane right now?** **MIDDLE.** The left has a bus in it at zero distance,
the right has scooters lying across it, and the middle's only problem is an
overhead crossbar with clear road visible underneath it between the legs.

---

## 09041aef.png

**1. Anything to react to?** Yes, and it's close. A yellow hazard-striped barrier
on three legs, its legs reaching the road at about the point where the runner's
head is. The runner (red cap, bib "26.2") is in the MIDDLE lane and is already
in a slide/crouch. Further off, a red carpet strip, some white station tables and
a teal scooter.

**2. Does anything single out ONE lane?** Yes — the **LEFT** lane, by omission.
The three legs land at x≈285, 496 and ~690; the two dividing lines at that depth
are at x≈285 and 496 and the kerbs at ≈56 and 724. So the two striped panels cover
the MIDDLE and RIGHT lanes exactly, and the LEFT lane has no panel over it at all.

**3. How far?** The "MILE 10" sign, big and crisp at normal size — but that's race
progress, not a range. For actual distance: the barrier legs come down almost to
the runner's own head height in frame, so it's about one second away. Below the
striped panel you can see clear road, so there is a gap to slide through.

**4. Faster or slower?** Nothing marks any lane for speed. No painted arrows or
coloured strips in reach.

**5. Lane right now?** **LEFT** — the only lane with nothing hanging over it.
Staying MIDDLE also survives if the slide is already committed, since there's
clearance under the panel, but LEFT needs no timing at all.

---

## 0a5850a6.png

**1. Anything to react to?** Yes. A big red-and-white striped barricade squarely
ahead with a traffic light standing right behind it, plus stacked barrels beyond
and a yellow barrier off to the right.

**2. Does anything single out ONE lane?** Yes, two different ways.
The barricade and the traffic-light post sit in the **MIDDLE** lane. And the
**LEFT** lane has a dark-green strip painted on the road surface with pale green
chevrons/arrows on it — a deliberate marking that stops at the lane line and does
not cross into the middle (I verified the green pixels run x≈295–342 while the
left lane at that row is ≈288–356). At normal size the green patch is obvious as a
patch of colour; the chevrons on it only resolve when enlarged.

**3. How far?** No number. The barricade's base sits at about half the frame
height, and it is already rendered at full saturation while the bridge behind it
is hazy, so it's mid-range — nearer than the barrel stacks and much nearer than
the overpass. The lane dashes between here and it give roughly two dash-lengths.

**4. Faster or slower?** Yes, arguably: the **LEFT** lane's green chevron strip
reads as a speed-up. That's an inference from the arrows pointing away down the
road and the "go" colour — nothing in the picture spells it out.

**5. Lane right now?** **LEFT.** It avoids the barricade in the middle and it's
the lane carrying the green arrows.

---

## 0bf6d9bd.png

**1. Anything to react to?** Yes, urgently. There is a stalled convoy of vehicles
directly ahead in the MIDDLE lane, stacked one behind the other — a pink/yellow
one filling the bottom of the frame, an orange truck behind it, a pink truck
behind that. Beyond them, a yellow truck and an orange truck.

**2. Does anything single out ONE lane?** The convoy singles out the **MIDDLE**
lane at close range. The two trucks further back split the other way: the yellow
one is in the **LEFT** lane (x≈288–355 against a left lane of ≈277–352) and the
orange one is in the **RIGHT** (x≈416–491 against ≈417–500), leaving the middle
open at *that* depth — with only a low blue crate in it.

**3. How far?** No numeric cue. The nearest vehicle has no visible base — it's cut
off by the bottom of the frame — which means it's at contact range. The yellow and
orange trucks have their rear bumpers at almost identical heights in frame
(y≈800), so those two are the same distance away, a good chunk further back.
"MILE 15" overhead is race progress only.

**4. Faster or slower?** No. No painted markings on the road in this frame at all.

**5. Lane right now?** Either flank — you have to leave the MIDDLE this instant.
I'd take **LEFT**, but honestly it's near-arbitrary: both side lanes are empty
right up to their trucks, and both trucks are the same distance away. The thing
worth knowing is that the middle re-opens just past those two trucks, so it's a
step out and a step back.

---

## 2f7b0e62.png

**1. Anything to react to?** Yes. A wall of stacked wooden crates ahead, with a
red-and-white barricade at its near face, and more crates spilling to the right of
the stack. Beyond it: barrels, more red/white barriers, a yellow gantry and a teal
scooter. The runner's red cap is visible at the bottom, in the MIDDLE lane.

**2. Does anything single out ONE lane?** Yes, and it's a clean split. The crate
wall and the barricade sit in the **MIDDLE** lane (x≈352–435 against dividers at
≈354 and ≈426); a second, lower run of crates blocks the **RIGHT**; and the
**LEFT** lane carries a green painted strip with pale chevrons and nothing solid
on it. So the left is singled out as the open lane and as the marked one.

**3. How far?** No number. The crate wall's base is at about y≈814 while the
runner's cap is at y≈1300, i.e. roughly the top third of the run-up — two or three
cross-bands of tarmac. It's not imminent but it isn't far either.

**4. Faster or slower?** The **LEFT** lane's green chevron strip suggests faster,
same marking as in `0a5850a6`. Inference from the arrows, not a label.

**5. Lane right now?** **LEFT** — clear, and it's the marked lane.

---

## 6aa5a1c1.png

**1. Anything to react to?** Yes, immediately. A full-width yellow barrier with a
hazard-striped panel is right on top of the camera — its legs come down at the very
bottom of the frame. There is clear road visible under the panel, so this is a
duck/slide, not a wall. Beyond it, more roadworks: stacked pipes, crates, a
red/white barricade and another gantry.

**2. Does anything single out ONE lane?** Yes, the **MIDDLE** — as the gap. The
barrier's two legs land at x≈180–235 and x≈540–600, and the lane dividers at that
row are at ≈273 and ≈501 with kerbs at ≈27 and ≈748. So one leg stands in the LEFT
lane and one in the RIGHT, and the middle lane is the clean space between them.
Further up, the **LEFT** lane also has a green chevron strip, but the crates sit at
its far end.

**3. How far?** The barrier is at zero distance — its legs reach the bottom edge.
For the stuff beyond, the tarmac cross-bands give the spacing. And there is a
"MILE 3" sign in the far haze which I **could not read at normal size** — at normal
size it's a pale smudge; the words only became legible when I enlarged that region.
That's the clearest example in this set of information that is effectively
invisible at playing size.

**4. Faster or slower?** The **LEFT** lane's green chevron strip again reads as a
speed-up. Worth noting that in this frame the crates sit right at the far end of
that green strip, so taking the boost lane runs you into them.

**5. Lane right now?** **MIDDLE** — it's the gap between the two barrier legs, and
sliding under the panel there costs nothing.

---

## 6b5576d0.png

**1. Anything to react to?** Yes. A blue truck stopped on the road and, beside it,
a yellow gantry with a hazard-striped crossbar. The runner is in the MIDDLE lane,
already sliding.

**2. Does anything single out ONE lane?** Yes. The blue truck is in the **LEFT**
lane (x≈300–360). The gantry's legs stand on the two dividing lines so its panel
covers the **MIDDLE** lane. The **RIGHT** lane has nothing in it. And — this is
the thing I could not identify at normal size — there is a **water bottle floating
in the MIDDLE lane just under the gantry**, with a shadow ellipse on the road under
it. At normal size it's a two-pixel pale speck; enlarging made it unmistakable.

**3. How far?** No number. The "MILE 16" sign is legible at normal size but that's
race progress. Real cue: the gantry legs meet the road at y≈783 while the runner's
cap starts at y≈1010, so it's mid-range, further off than the barriers in
`09041aef` or `6aa5a1c1`. The bottle's shadow on the tarmac tells you it's sitting
at ground level rather than floating at head height.

**4. Faster or slower?** No lane is *painted* for speed. The nearest thing is the
bottle in the middle lane, which in a running game plausibly restores something —
but that's me reasoning about what a drink does, not something the image states.

**5. Lane right now?** **MIDDLE** — stay put, slide under the bar, take the bottle.
**RIGHT** is the zero-risk alternative if you'd rather not time a slide.

---

## 73d623da.png

**1. Anything to react to?** Yes. Ahead there's a yellow gantry with a
hazard-striped panel and a blue vehicle just past it. There is also a huge yellow
barrier post filling the right edge of the frame, but that one is already
alongside the runner — nothing to be done about it. Orange sandbags at the bottom
left are likewise already level with the camera.

**2. Does anything single out ONE lane?** Yes, the **RIGHT** — by being the only
lane the panel doesn't cover. The gantry's legs land at x≈290–304, 354–366 and
418–429, i.e. on the left kerb line, the left divider and the right divider; the
striped panel spans x≈290–429, covering the LEFT and MIDDLE lanes and stopping at
the right divider.

**3. How far?** The "MILE 14" sign is there but washed out — I could see *a* sign
at normal size and had to enlarge to read the number. The gantry legs meet the road
at about y≈794 against a runner at y≈1010, so it's mid-range. The blue vehicle
sits a little further back again, around the right divider.

**4. Faster or slower?** There is a **small patch of green chevron paint in the
LEFT lane**, just beyond the gantry — but I want to be clear that **I did not see
this at normal size**; it's mostly hidden behind the gantry legs and I only found
it when enlarging. Taken with the other frames, it suggests the left lane is the
speed-up lane here, but it is not usable information at playing size.

**5. Lane right now?** **RIGHT.** It's the one lane with no panel over it. The
trade is the blue vehicle sitting further along near that side, so it's a move
right and then a decision again shortly after.

---

## 7f189105.png

**1. Anything to react to?** Yes — and there is no free lane. A row of three
different obstacles sits across the whole road at the same depth.

**2. Does anything single out ONE lane?** No single lane; all three are taken, one
each. **LEFT**: a stack of pipes/tubes (x≈272–360). **MIDDLE**: a red motorbike
with a red truck behind it (x≈363–416). **RIGHT**: two teal scooters lying flat
(x≈421–502). The dividers at that depth are at ≈359 and ≈420, so the split is
clean, one object per lane.

**3. How far?** No number. All three obstacles have their bases at essentially the
same height (y≈780–820), which is the useful fact: they are the same distance away,
so this is a single decision, not a sequence. There is a "MILE 16" sign in the
distance, but it is very washed out and **I could not read the number at normal
size** — only after enlarging.

**4. Faster or slower?** No painted lane markings. There *is* a red carpet-like
strip in the LEFT lane behind the pipes, with plain horizontal bands and no arrows
on it. It's clearly a deliberately different surface, but unlike the green strips
it carries no directional marking, so I can't tell you whether it helps or hurts.

**5. Lane right now?** **RIGHT.** The scooters are lying flat on the deck — they're
the lowest of the three obstacles, so they're the one most likely to be clearable.
The pipes are stacked two rows high and the motorbike is upright.

---

## 8d01f2b0.png

**1. Anything to react to?** Yes. A yellow gantry with hazard-striped panels ahead,
and teal scooters lying on the road beside it. The sandbag wall at the bottom of
the frame and the big yellow post on the right are already level with the runner.

**2. Does anything single out ONE lane?** **I have to flag a problem here: this
image has no lane lines on it at all.** The road is a plain dark purple surface with
faint horizontal bands and nothing dividing it — I checked the pixels across
several rows to be sure. So I can only infer lanes from the barrier's geometry and
the kerbs: the gantry's three legs land at x≈283, 358 and 424 and its two striped
panels run x≈285–426, which covers roughly the left two-thirds of the road, leaving
the right-hand third free of panel. The scooters lie in that right-hand third. Any
lane naming in this frame is an inference, not something the road tells me.

**3. How far?** This one has the best distance information in the set, and it's
about the race rather than an obstacle: a big clear "MILE 26" overhead **and** a
"FINISH" banner visible beyond it. For the gantry itself, only the usual cues — its
legs meet the road around mid-frame, so mid-range.

**4. Faster or slower?** Nothing. No painted markings anywhere on this road
surface.

**5. Lane right now?** **MIDDLE** (i.e. straight on, under the panel — there's
clear road visible beneath it). The right-hand third is the only part with no panel
overhead, but it's where the scooters are lying, so it's not obviously better.

---

## 94f1fbcb.png

**1. Anything to react to?** Yes. A blue truck stopped ahead, and next to it a
yellow gantry carrying a hazard-striped panel. The runner is mid-slide in the
MIDDLE lane.

**2. Does anything single out ONE lane?** Yes — the **LEFT**, as the one with a
solid obstacle. The blue truck sits at x≈250–345 against a left lane of ≈232–338.
The gantry's legs land at ≈347, ≈437 and ≈530, so its panel covers the **MIDDLE**
and **RIGHT** lanes. So: left is blocked solid, middle and right are duck-unders.

**3. How far?** "MILE 8" overhead — small but readable at normal size, though I
confirmed the digit by enlarging. For range: the truck's rear and the gantry legs
both reach the road at y≈840–850, so they're the same distance, roughly two
lane-dashes ahead of the runner.

**4. Faster or slower?** Nothing marks a lane for speed in this frame.

**5. Lane right now?** **MIDDLE.** The runner is already there and already sliding,
there is clear road under the panel, and changing lane would only move the problem.

---

## 9dac412f.png

**1. Anything to react to?** Yes, and this is the awkward one: **every lane has
something in it at the same depth.** A blue truck, then a run of wooden crates,
then a stack of pipes, side by side across the road.

**2. Does anything single out ONE lane?** No — all three are taken, and I checked
the columns: dividers at that depth are x≈359 and ≈420 with kerbs at ≈294 and ≈485.
Blue truck **LEFT** (≈292–360), crates **MIDDLE** (≈360–410), pipes **RIGHT**
(≈413–488).

**3. How far?** "MILE 16" is big and clear overhead. Better than that, there is a
**solid white line painted right across the road just in front of the obstacle
row** (y≈803) — that's a proper reference mark: when you reach the white line
you're at the obstacles. Their bases are at y≈790 with the runner at y≈1010, so
they're closer than in most of these frames.

**4. Faster or slower?** Nothing.

**5. Lane right now?** **MIDDLE.** The truck (left) is tall and solid, so it's out.
Between the crates and the pipes, the crates are the lower stack of the two, so
the middle is the best jump. Note this is a "clear it" answer, not a "run past it"
answer — there is no free lane here.

---

## a35062ce.png

**1. Anything to react to?** Yes, immediately. A barrier structure with four legs
is right on top of the camera, and a pile of sandbags sits just in front of the
runner. Further ahead: scooters, flower pots, a red/white barricade and a blue bin.

**2. Does anything single out ONE lane?** Yes, the **MIDDLE**, in two conflicting
ways. The barrier's hazard-striped panels cover the LEFT and RIGHT lanes and leave
a clear gap over the middle — but that gap is exactly where the sandbag pile is
sitting. So the middle is the only lane with nothing overhead and the only lane
with something on the ground. Further up, the **RIGHT** lane carries a green
chevron strip (I checked: the green starts at the right-hand divider and runs
right, x≈412–478), with a red/white barricade parked on it.

**3. How far?** "MILE 15" is in the haze and I needed to enlarge to read it. The
barrier legs and the sandbags both reach the road at y≈1050–1060 against a runner
whose cap starts at y≈1010 — so the sandbags are essentially on top of you. The
mid-distance row (scooters / pots / barricade) is a good way further back.

**4. Faster or slower?** The **RIGHT** lane's green chevron strip suggests faster.
Note that unlike the other frames the boost strip is on the right here, not the
left — so it isn't a fixed lane in this game.

**5. Lane right now?** **MIDDLE** — jump the sandbags. It's the only lane with no
panel hanging over it, and the sandbag pile is a low obstacle. Sliding left or
right also works but costs a lane change and a slide.

---

## a398534c.png

**1. Anything to react to?** Yes. On a bridge over water: a yellow gantry with a
hazard-striped panel dead ahead, and a stack of wooden crates beside it. The runner
is in the MIDDLE lane.

**2. Does anything single out ONE lane?** Yes, cleanly, one thing per lane. The
gantry's legs land at x≈333–351 and ≈429–451 — exactly on the two dividers — so its
panel covers the **MIDDLE** lane and only that. The crates are in the **RIGHT**
lane (x≈448–541). The **LEFT** lane has no obstacle at all; it carries a dark red
carpet-like strip.

**3. How far?** "MILE 10" is in the haze and I needed to enlarge to read it
confidently. Real range cue: the gantry legs and the crates both meet the deck at
y≈852, so they're the same distance — about mid-frame, a couple of dashes ahead.

**4. Faster or slower?** The **LEFT** lane's red strip is a deliberately marked
surface — but it has plain horizontal bands and no arrows, unlike the green strips
elsewhere in this set, so I genuinely cannot tell you whether it means faster,
slower, or nothing at all. I'd be making it up if I picked one.

**5. Lane right now?** **LEFT** — the only lane with nothing in it, and no slide
required.

---

## aab3840c.png

**1. Anything to react to?** Yes. A yellow truck stopped ahead, and to its right a
yellow gantry with a hazard-striped panel. Far up the bridge, a small stack of
pipes.

**2. Does anything single out ONE lane?** Yes — the **LEFT**, as the only empty
one. The truck sits in the **MIDDLE** (x≈354–429, between dividers) and the gantry
panel covers the **RIGHT** (x≈422–497). The left lane is completely clear from the
runner all the way to the haze.

**3. How far?** "MILE 11" overhead — small and pale; I could see the sign at normal
size but enlarged to read the number. The truck's rear reaches the deck at y≈802
against a runner at y≈1000, so mid-range. The pipes are far enough back to be
noticeably hazed.

**4. Faster or slower?** Nothing. No painted lane markings in this frame.

**5. Lane right now?** **LEFT** — it's the only lane that needs no jump and no
slide, and it stays clear a long way.

---

## b78c20a2.png

**1. Anything to react to?** Yes. A wide yellow barrier with hazard-striped panels
close ahead, and a group of wooden crates on the road beside it.

**2. Does anything single out ONE lane?** Yes, the **LEFT**, as the lane with the
solid ground obstacle. The barrier legs land at x≈340, 441 and 540 against dividers
at ≈336 and ≈444, so the panels cover the **MIDDLE** and **RIGHT** lanes; the
crates (x≈235–347) sit in the LEFT lane.

**3. How far?** There is a "MILE 18" sign but it is bleached almost into the sky —
**at normal size I could see a pinkish rectangle and nothing more; the number only
appeared when I enlarged it.** For range: the barrier legs and crates both reach
the road at y≈855–858, against a runner cap at y≈1035, so it's close — about one
second.

**4. Faster or slower?** Nothing marks a lane for speed here.

**5. Lane right now?** **MIDDLE.** The runner is already there and already in a
slide, there's clear road under the panel, and the alternative (LEFT) means a lane
change plus a jump over crates.

---

## c12daaa7.png

**1. Anything to react to?** Yes, and it's the most urgent frame in the set. A long
wall of stacked wooden crates runs straight down the road towards the runner, with
a red-and-white barricade on its near face, and that near face is only about a
runner's-height above the runner's cap in frame.

**2. Does anything single out ONE lane?** Yes, the **MIDDLE** — the crate wall runs
down it (the near barricade spans x≈320–465 against a middle lane of ≈325–455). The
**RIGHT** lane is clear and carries a dark red carpet strip; the **LEFT** lane is
clear near-to but has a yellow gantry across it further up.

**3. How far?** No mile sign in this one. The distance cue that matters is
occlusion and size: the barricade's base is at y≈910 with the runner's cap at
y≈1010, i.e. almost no gap — this is a "now" decision. There's also a green
**WATER** sign readable at normal size on the left verge, which marks a water
station rather than a distance.

**4. Faster or slower?** The red carpet strip in the **RIGHT** lane is a marked
surface, but again with no arrows and no legend, so I can't say what it does.

**5. Lane right now?** **RIGHT** — it's clear for the longest stretch. LEFT is also
clear immediately but has that gantry waiting further on, so it buys less time.

---

## c28806d8.png

**1. Anything to react to?** Yes. A yellow gantry with a hazard-striped panel on
one side, an orange truck on the other, and a strip of red carpet between them.
Beyond: traffic cones, a blue crate, crates and another gantry.

**2. Does anything single out ONE lane?** Yes, all three differently. The gantry
panel is over the **LEFT** lane; the red carpet strip runs down the **MIDDLE**
(x≈350–440); the orange truck is in the **RIGHT** (x≈435–570). The interesting
one is the left: **under that gantry there is a glowing mint-green oval pad
painted on the road and a small yellow item (it looks like a banana) floating above
it with a shadow.** At normal size I could see two indistinct pale blobs there and
could not have told you what they were — **it took enlarging to identify them.**

**3. How far?** "MILE 24" is clear at normal size. For range: the truck's rear, the
gantry legs and the near end of the red carpet all reach the road at about
y≈880, so they're all the same distance — one decision. The floating item's shadow
sits at ground level under it, which tells you it's a pickup at running height
rather than something suspended.

**4. Faster or slower?** The green glowing pad in the **LEFT** lane is the
strongest "this does something good to you" marking anywhere in these 22 images —
a lit-up pad plus a floating collectible directly over it. I read that as a
speed-up or power-up. That's an inference from the glow and the collectible, and
it is not visible as such at normal size.

**5. Lane right now?** **MIDDLE** for safety — it has no barrier and no vehicle,
just the carpet. If the green pad is worth having, **LEFT** gets it at the cost of
sliding under the panel to reach it.

---

## c3ae1f9c.png

**1. Anything to react to?** **Effectively nothing that I can act on — because I
can't see the road.** The bottom ~60% of this frame is a completely featureless
pale beige wedge with no texture, no lane lines, no runner and no markings of any
kind. I don't know what it is; the most honest description is a large blank surface
immediately in front of the camera (or a rendering/camera glitch). Everything below
y≈715 is hidden behind it.

**2. Does anything single out ONE lane?** No. There are no lane lines visible
anywhere in this image, so I can't identify a left, middle or right at all.

**3. How far?** Only "MILE 24" on the overhead sign, which is race progress. Behind
the blank wedge, in the far haze, I could make out (only after enlarging) some
yellow gantry structures and a pink arch-like object — but they're too small and
too occluded to place in a lane or to estimate a distance for.

**4. Faster or slower?** Nothing.

**5. Lane right now?** I can't pick one on the evidence in this picture. With the
road hidden, the only sane action is to hold whatever line you're already on. If
that blank surface really is an object in front of the camera, the decision has
already been made for you.

---

## cee14cd4.png

**1. Anything to react to?** Yes — a row across the whole road: a yellow gantry
with a hazard-striped panel, a pair of teal scooters lying flat, and a pile of
sandbags. No runner is visible in this frame.

**2. Does anything single out ONE lane?** All three are occupied, one each.
**LEFT**: the gantry panel (legs at x≈283–297 and ≈349–366, panel spanning
≈288–363) — and the same lane carries a green chevron strip running under it.
**MIDDLE**: the teal scooters (≈363–429). **RIGHT**: the sandbag pile (≈422–500).

**3. How far?** "MILE 23" is big and clear overhead. For range: the whole row's
base sits at y≈805 and there's a solid white line painted across the road right at
that point, which again gives a fixed mark to judge against. The row is at roughly
half the visible road length.

**4. Faster or slower?** Yes — the **LEFT** lane's green chevron strip reads as a
speed-up, and here it is obvious at normal size (a bright green wedge), unlike the
hidden one in `73d623da`.

**5. Lane right now?** **LEFT.** The obstacle there is an overhead panel with clear
road underneath, so it costs a slide rather than a jump, and it's the lane with the
boost paint on it. The other two both need you to clear something lying on the
ground.

---

## d2ce4e0c.png

**1. Anything to react to?** Yes, but there is nothing left to do about it: a
red-and-white striped barrier fills the entire bottom half of the frame at contact
range. The overhead sign reads **"MILE 20 — THE WALL"**, which is the game naming
this obstacle.

**2. Does anything single out ONE lane?** No — and I can't even tell. The barrier
spans the entire visible width, and **no lane lines are visible anywhere in this
image** because the road surface is completely hidden behind it. In the thin band
of road visible above the barrier I can make out yellow gantries with hazard panels
and a stack of pipes, but with no lane lines showing I won't assign them to lanes.

**3. How far?** Zero. The barrier occupies more than half the screen and has no
visible base or edges — that's contact range, not an approach. "MILE 20" is race
progress, not a distance.

**4. Faster or slower?** Nothing.

**5. Lane right now?** Can't pick one — the lanes aren't visible. Hold the middle
line, which is where the camera is pointing.

---

## fc925320.png

**1. Anything to react to?** Yes, at two ranges. Right at the bottom of the frame,
level with the camera: a stack of pipes on the left, three orange traffic cones
spread across the width, and a blue-and-white cooler box on the right — these are
at or past contact, too late to react to. Ahead, at usable range: a yellow gantry
with a hazard-striped panel and a group of wooden crates.

**2. Does anything single out ONE lane?** Yes. The gantry's legs stand on the two
dividers so its panel covers the **MIDDLE** lane (x≈352–429). The crates sit in the
**LEFT** lane (≈285–354). The **RIGHT** lane is completely clear. There is also a
**water bottle standing in the LEFT lane just behind the crates** — at normal size
it's a pale sliver I would not have identified; enlarging made it clear.

**3. How far?** "MILE 22" is large and clear overhead (race progress). There's a
solid white line across the road at y≈839, just in front of the obstacle line,
which is a usable reference mark. The crates and gantry legs meet the road at
y≈790–800, so mid-range. The foreground cones have no visible base at all, which is
what tells you they're already on top of you.

**4. Faster or slower?** No painted speed markings. The bottle in the left lane is
a pickup, but as in `6b5576d0` nothing in the picture says what it does.

**5. Lane right now?** **RIGHT** — the only lane with nothing in it and nothing
over it. **MIDDLE** works too if you slide; **LEFT** needs a jump over the crates
but is the only way to reach the bottle.
