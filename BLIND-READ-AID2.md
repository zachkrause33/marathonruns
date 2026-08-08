# Blind read: docs/people/after2/aid.png

## 0. What the harness told me before you asked (so you can discount it)

I was not clean going in. Before your request arrived, the harness put a
project instructions file (CLAUDE.md) in front of me in full, plus some
environment context. Exactly what I learned from it, so you can discount it:

- The repo is called **marathonruns** and the working directory is
  `/home/user/marathonruns`. The branch I was told to push to is
  `blind-read-aid2`, and the image path itself is `docs/people/after2/aid.png`
  — so the words "marathon", "runs", "people", "after2" and "aid" were all
  handed to me before I looked.
- It is a **game**, rendered in a browser, built into an `index.html`.
- It has a **chase camera** behind a **runner**, obstacles, vehicles,
  background traffic, hills, a start, a finish and a replay framing.
- It has a lane system with lane changes, and the camera "banks and swings
  through every lane change" and "rolls on impact". A hazard in an adjacent
  lane passes "1.70 units to the side of a camera 4.35 units back", field of
  view 61–72 degrees. So I knew before looking that "u" is a distance unit in
  this world and that the camera sits a few u behind the runner.
- **One contact ends a record attempt.** Hazards must be visible; there is a
  fairness gate that fails the build on hazard contrast below 1.25x luminance
  or 0.22 saturation against the local road, and on failure codes named LOW,
  HIDES, BLANKS and PAINTS.
- Named world content included: buildings, towers, terraces, street walls,
  bridges, gantries, arches, trees, hedges, **crowds, marshals, walkers and a
  ghost**, signs, banners, plinths, a **mile gantry** and a **finish arch**.
- Named road markings, explicitly called out as flat single quads with no
  back: **lane dashes, road paint, telegraph mats, the finish carpet, water
  and its ripples.**
- Tooling: `tools/shoot.js`, `tools/course-test.js`, `tools/simulate.js`,
  `tools/stride.js`, `tools/clarity.js` (a clarity measurement cut by depth
  band), `docs/roadmap.md`.

How that has probably contaminated the answers below: the word **"aid"** in
the filename plus "marathon" is a strong prompt for *aid station*, and an aid
station means drink and food handed to runners. I cannot honestly claim I
would have landed on "water bottle" and "banana" as fast as I did without
that. The shapes and colours do support both readings on their own, and I say
below what the raw shape looks like independent of the label — but treat the
naming as assisted, not blind. Likewise "telegraph mats" and "water and its
ripples" were in my head before I saw the road, which is directly relevant to
(b), and I flag it there. The one thing I did *not* have is any statement
about what this particular image was made to show or which version is
"after2" better than.

Everything below comes only from looking at the one PNG. I opened no other
file.

## What the sheet is, physically

Six render panels on a near-black background, two rows of three. The top row
carries the column captions **8u**, **12u**, **25u**. Each panel has a small
grey pixel dimension printed under its bottom-left corner: top row
**95x89px**, **70x66px**, **38x36px**; bottom row **104x76px**, **78x55px**,
**43x29px**. Both rows are labelled **1** in the left margin. I read those
numbers as the on-screen pixel footprint of the hovering object in that panel,
since they shrink with distance in exactly the way that object does — but
that is an inference, not something the sheet states.

The scene in every panel is the same first-person-ish chase view straight down
a dark grey street toward a blown-out white vanishing point. Multi-lane road
with pale lane lines, kerbs and pavements both sides, a red-and-white barrier
rail along the right, a forest of thin black poles and lamp arms overhead,
building fronts with scaffold-like gantries, and small standing figures in
pink, purple and yellow on the right pavement. Bottom centre of each panel is
a red dome with a gold band and dark hair under it — the top of a head seen
from behind, very close to camera. The two rows are not the same street
dressing: the bottom row's street is denser, has figures on both sides and a
paler ground plane, and the sky is a flat blue-white band rather than the top
row's harder white blowout.

## (a) The small hovering object

**Top row: a drink bottle.** A small upright cylinder in pale mint/teal with a
white or very pale cap and a narrower neck, sitting a little above the road
surface. What makes me say bottle: the silhouette is a tall-ish body that
steps in near the top and then out again for a cap — a neck-and-cap profile,
not a plain can or box — and the body is a translucent-looking cool green
against an opaque white top, which is how a part-full plastic bottle reads.
At 8u I can see the step; at 25u I mostly cannot, and if the 25u panel were
all I had I would only be able to say "small pale-green upright thing".

**Bottom row: a banana.** A yellow crescent, thicker in the middle, tapering
and darkening slightly at both tips, lying at an angle rather than upright.
What makes me say banana: the curve plus the taper plus that particular
saturated yellow. Nothing else in the frame is that hue. At 25u it survives as
a small yellow hook — the shape is degraded but the colour still reads.

So the row difference is drink versus food, which is what makes "aid station
hand-out" the obvious reading — with the caveat in section 0 that the filename
gave me that word.

## (b) The coloured markings on the road

I can see four distinct kinds. Confidence varies a lot between them.

**1. A glowing green-white ellipse directly under the hovering object.**
A flat oval lying on the road, brightest in the centre, with a green rim
fading outward, and in the 8u and 12u panels a visible soft halo. It tracks
the item — it is always beneath it, in the same lane. I read this as a
**pickup marker / ground decal telling you where the item is in lane and how
far ahead**, i.e. the flat shadow-substitute that makes a hovering object's
road position legible. It is the one marking I feel confident about, because
its coupling to the item is unambiguous across all six panels. Competing
reading I can't rule out: it could be a landing/step target rather than a
marker for the item itself.

**2. Long purple-violet translucent streaks lying flat on the road.**
These are the most numerous marking. They are elongated along the direction of
travel, soft-edged, semi-transparent (the road texture and the lane lines show
through them), and they appear in several lanes at once and at several depths,
including well ahead of the item and behind it. In the bottom row there are
more of them and they run further down the frame. **I cannot identify these
with confidence.** My competing readings, in the order I'd bet on them:
(i) *shadows* — cast by the poles, lamp arms and gantries overhead, tinted
violet by whatever ambient/sky colour the scene uses, which would explain why
they are soft, translucent, roughly parallel and scattered at many depths;
(ii) *a hazard or surface-condition decal* — a slick, wet patch or spill
painted on the road, which would explain the saturation, but not why there are
so many of them so evenly spread; (iii) a light-shaft or god-ray effect landing
on the road. I lean fairly hard to (i) shadows, because their spacing echoes
the pole spacing at the kerb and because a hazard that common would make the
road unreadable. But I am guessing, and if these are meant to be read as
hazards then the answer to (c) matters even more.

**3. Pale grey-white lane lines and a broad light band.** Continuous thin
lines separating the lanes, converging on the vanishing point, plus a wider
pale grey strip on the left side of the road. Ordinary road paint / lane
division. In the bottom row the left-hand pale band is wider and brighter.

**4. Short tan-khaki dashes in the left lane.** A row of small warm-beige
rectangles, evenly spaced, running away from camera in the leftmost lane only,
visible in all three top-row panels and faintly in the bottom row. These are a
distinctly warmer colour than the white lane paint, so they are a separate
marking, not the same paint seen dimmer. I do not know what they are. Readings:
a dashed centre/edge line in a different material; a repeating course marking
(distance ticks, or a route line); or mats or plates laid on the road. I lean
to "a dashed lane marking in a warm-toned paint" purely on regularity.

There is also a red-and-white striped element, but that is the vertical barrier
rail at the kerb, not a road-surface marking, so I'm not counting it in (b) —
though it matters in (c).

## (c) The 25u panels — where the eye goes, and does the road out-shout the item

Both 25u panels are on the right-hand end of each row. Taking them one at a
time, honestly, as first-glance order:

**Top-right (25u, bottle, 38x36px):**
1. The **blown-out white sky at the vanishing point** — it is the brightest
   thing in the frame by a wide margin and it sits almost dead centre, exactly
   where the perspective funnels your eye. It wins instantly and it is not close.
2. The **red dome of the head** at the bottom edge — big, saturated red,
   high contrast against dark road.
3. The **red-and-white barrier rail** down the right side, which is a long
   high-frequency stripe of the same red.
4. The **purple streaks on the road** — several of them, each of them larger in
   screen area than the item, and the pair in the lower-left quadrant are the
   first thing on the road surface itself that I notice.
5. The **green ellipse**.
6. The **bottle**. Last. It is small, it is a low-saturation pale mint, and it
   sits high in the frame close to where the road meets the bright haze, so it
   is a pale object on a pale background. I had to go looking for it. If you
   had not told me an object was there, I am not confident I would have picked
   it out of the pole clutter on the first pass.

**Bottom-right (25u, banana, 43x29px):**
1. The **red dome** at bottom centre — in this panel it's larger and closer to
   the frame edge, and it takes the first look before the sky does.
2. The **sky band**, softer here, still bright.
3. The **purple streaks**, which are longer and more numerous in this row and
   sweep down the left half of the road.
4. The **banana** — its yellow is unique in the frame and that rescues it.
5. The **green ellipse**, which at this distance has collapsed to a small
   pale-green smudge and is barely separable from the banana above it.
6. The barrier rail and pole clutter.

**Plain answer to the question you actually asked: yes.** In both 25u panels
something on the road surface out-shouts the hovering item, and in the top one
it is not marginal. The purple streaks are the offender. At 25u the bottle is
about 38x36 pixels of low-saturation pale green sitting against a pale hazy
background, while a single purple streak is several times that in screen area,
sits on dark road so its edge contrast is higher, and there are four or five of
them. My eye lands on the streaks before the item every time in the top-right
panel — call it a clear win for the streaks, not a tie. The green ellipse is
also being beaten by the streaks at 25u: it has shrunk to a faint smudge while
the streaks barely shrink at all, because they are elongated along the view
direction and perspective foreshortening costs them much less area than it
costs a small compact object.

The bottom row is meaningfully better but still not clean. The banana's yellow
is the only saturated warm hue in the frame, so it holds its own on colour even
at 43x29 pixels, and I'd put it ahead of the ellipse and roughly level with the
streaks rather than behind them. Call it a near-tie there instead of a loss.

Two more honest caveats on (c). First, the red head at the bottom of frame is a
constant loud distractor in every panel and it is closer to the item's part of
the frame in the bottom row than in the top. Second, if my reading (i) in
section (b) is right and the purple streaks are just shadows, then what I am
reporting is "the item loses to the scene's own shadowing", which is a
different problem from "the item loses to another decal" — but from the
player's eye it is the same failure either way, because at 25u the thing you
must react to is not the thing you look at first.

## What I cannot tell from this sheet

- Whether either hovering object is a thing to collect or a thing to avoid.
  Nothing in the image says.
- Whether the two rows differ only in the item, or also in the street dressing
  and lighting — they clearly differ in dressing, so I cannot attribute the
  legibility difference at 25u purely to bottle-versus-banana.
- What the "1" in the left margin of each row means.
- Whether the pixel dimensions under each panel measure the item, the ellipse,
  or the pair. I assumed the item.
- Whether the purple streaks are shadows, decals or lighting, as above.
- Whether this is "after" some change and what the "before" looked like. The
  image contains no comparison.
