# Standing rules

Rules that outlive any one task. Read this before building anything.

---

## 1. Build every angle. There is no back of an object.

**Every object is modelled on all sides, fully, always.** No LOD-by-angle, no
detail budget spent on "the face the camera sees", no flat or hollow rear.

**This applies to everything in the game, without exception by category:**
every obstacle and every vehicle of any kind; buildings, towers, terraces and
street walls; bridges, gantries, arches and every structure; trees, groves,
hedges and vegetation; crowds, marshals, walkers and the ghost; signs, banners,
plinths and every prop; the runner. If it is a thing that occupies space, it is
built on all sides.

The owner's instruction, verbatim: *"Yes everything in the game. All obstacles
and vehicles of any kind. In fact all build must take this approach. Let all
agents know."*

**Every brief written for this project must carry this rule.** It is not
something an agent should have to find.

The one thing that is not an exception but looks like one: **a marking painted
on a surface has no back, because it is not an object.** Lane dashes, road
paint, telegraph mats, the finish carpet, water and its ripples are correctly
single quads lying on the thing they are painted on. The test is whether the
player could ever get to the other side of it. They cannot get under the road.
They can walk past a sign, a hoarding or a banner -- so those are built both
sides, and the mile gantry and finish arch already do exactly that.

This rule exists because it was broken. A brief for the fleet rebuild argued
that the chase camera only ever sees the rear of an obstacle, so the detail
should go on tail lights and rear glass and not on the front or the flank. The
owner's correction, verbatim:

> *"This is not what we want to do. You can see the back as you pass. The
> entire car needs to be built out. Remember this when we make anything and
> everything moving forward. All angles must be built and as you can still see
> them."*

The reasoning that produced the mistake was "where does the camera start",
when the question is "where does the camera go". In this game it goes
everywhere:

- **You pass obstacles at arm's length.** A hazard in an adjacent lane passes
  1.70 units to the side of a camera 4.35 units back, at a field of view of
  61-72 degrees. Its flank fills a large part of the frame at close range, lit
  from the side, and it is the last thing seen before it leaves the shot.
- **The camera banks and swings through every lane change**, and rolls on
  impact, so the viewing angle on anything nearby is never the one it was
  designed against.
- **Background traffic moves relative to the player.** Anything that drives
  will show its front, its flank and its rear within a few seconds, and
  oncoming traffic shows its front for the whole approach.
- **Hills pitch the camera.** A crest looks down on roofs; a dip looks up at
  sills. Neither is the elevation a rear-facing budget was drawn for.
- **The finish, the start and the replay framing are not the chase camera.**

A half-built object is not cheaper in the only currency that is scarce here.
Triangles are abundant -- roughly 182,000 against a working ceiling of 500,000
-- and **draw calls are the binding constraint**, around 300 against ~400. A
rear-only mesh and a fully-built mesh cost the *same* number of draw calls. So
building all angles costs the plentiful resource and saves none of the scarce
one. There is no trade here to be clever about.

If some detail genuinely cannot be seen from any angle the game can produce,
prove it with a frame before removing it -- and expect that proof to fail.

---

## 2. Verify against the running page, never the build.

`node tools/build.js` printing a size proves nothing; a page that throws still
builds. The full gate is:

```
node tools/build.js && node tools/shoot.js && node tools/course-test.js && node tools/simulate.js
```

`node tools/build.js --check` fails when the committed `index.html` is not what
the source builds.

---

## 3. Measure before diagnosing, and audit the instrument too.

`docs/roadmap.md` keeps a running list of corrections this project has had to
make to itself. It is long, and the pattern in it is always the same: **a
number nobody measured is worse than no number at all.**

The instrument gets the same scrutiny as the work. `tools/stride.js` shipped
with six defects, every one of them flattering the thing it measured, and all
six were found by agents rather than by its author. A whole-frame edge-density
comparison in `tools/clarity.js` was confounded by composition and had to be
re-cut by depth band after two agents had been briefed on it.

---

## 4. Fairness is a build failure, not a preference.

One contact ends a record attempt, so a hazard the player could not see is the
game taking a run for something outside their control. `tools/shoot.js` fails
the build on `LOW`, `HIDES`, `BLANKS` and `PAINTS`, and on hazard contrast
below 1.25x luminance or 0.22 saturation against the local road.

`MR.Collision.BOX` is the contract. Art never decides clearance.

---

## 5. Never use backticks inside a comment inside a template literal.

They close the literal early and the prose after it is read as code -- which
usually still parses, so the build passes and the page throws in the browser.
This has cost time in seven separate contexts, including GLSL comments, HTML
comments and shell heredocs. `tools/build.js` lints for the HTML-comment case;
it cannot catch the others.

Not in commit messages either, where they run as shell substitution.

---

## 6. Commit with pathspecs, never `git add -A`.

```
git commit -m "..." -- src/render/world.js
```

Several agents work in this tree at once. `git add -A` has swept other agents'
in-flight work into unrelated commits six times. A pathspec scopes by **file,
not by hunk**, so read `git diff` before committing. `index.html` is a build
artifact: rebuild it, but commit it separately from source.
