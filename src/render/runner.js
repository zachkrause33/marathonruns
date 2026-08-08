/**
 * The runner: a procedural toy-proportioned character with a hand-authored
 * run cycle. No rig file, no art assets -- every part is a primitive under a
 * pivot hierarchy, and the cycle is driven by phase rather than keyframes so
 * it stays locked to ground speed at any pace.
 *
 * Proportions are measured off the Subway Surfers and Sonic frames in
 * reference/, because that is where "toy" is actually defined: the head is a
 * third of the whole figure, the neck is a stub, the legs are barely another
 * third, and the shoes and mitts are far bigger than the limbs carrying them.
 * This one is a shade under three heads tall. Anything nearer human reads as
 * "small person" at a low tight camera no matter how good the shading is.
 *
 * EVERYTHING here is designed for the back view, because that is the only
 * view the player ever gets. The four rules that came out of looking at it
 * in motion:
 *   1. The head must pinch away from the shoulders, and the gap has to GROW
 *      with the head rather than stay fixed. The chase camera looks DOWN, so
 *      a fatter skull hangs more of its own silhouette into the gap before
 *      the neck gets any use of it -- at this head size about 0.05 of it.
 *      Nothing may be added to the back of the head that is not part of the
 *      ladder in rule 2. The cap's peak is at the FRONT for that reason and
 *      not for any reason to do with caps -- see the peak's own note.
 *   2. The back needs its own value structure, and the order matters.
 *      Top to bottom it runs red cap / bright band / dark hair /
 *      light neck / dark hood / red vest / white race bib. Hair on the crown
 *      with a bare nape put light on light and the head merged again; the
 *      dark mass has to sit directly above the lit neck for the pinch to
 *      read. The hood is the same argument applied from below -- the neck is
 *      now pinched from both sides rather than only from above -- and it is
 *      why the hood is navy and not the vest's own red.
 *   3. Motion has to break the outline. Arm swing is almost entirely along
 *      the camera axis from here, so the cycle drives the elbows sideways
 *      and lets the pale shoes, gloves and wristbands flash against the
 *      road; those are the parts the eye can actually track from behind.
 *   4. State has to read as SILHOUETTE, not as pose detail, and no two states
 *      may differ on the SAME axis. Measured in world units on the rig's own
 *      bounding box, against the run, on a 390x844 phone in portrait:
 *
 *        run    half-width 0.40  (1.00x)   crown 1.57  (1.00x)
 *        jump   half-width 0.92  (2.3x)    -- a horizontal bar, airborne
 *        slide  half-width 0.60  (1.5x)    crown 0.72  (0.46x)
 *
 *      Width alone separates the jump from both others -- it is still half as
 *      wide again as the slide -- and height alone separates the slide from
 *      the run. Neither test can return the wrong answer for the other state.
 *      The slide is wider than the 1.26x it used to be and that is bought
 *      deliberately: see SLIDE_YAW, which spends width to get an axis the back
 *      view can actually measure. It is paid for out of leg splay.
 *
 *      The crown is the number that moved most, 1.32 -> 0.72, and it is the
 *      whole of the head fix: the slide's top is now the trunk and the leading
 *      shoe, level with each other, with the tucked head 0.02 under them
 *      instead of 0.6 over. See NECK_SLIDE_X. collision.js sets the DUCK bar at
 *      1.41, so where the old pose left 0.09 of daylight this leaves 0.69.
 *      The wardrobe pass cost 0.010 of that -- measured vertex by vertex
 *      rather than off the bounding box, the run and jump silhouettes came
 *      through it IDENTICAL and the slide's crown rose by the thickness of
 *      the hood roll now lying on the upper back, which is the one new part
 *      that is allowed to be there.
 *
 *      An arm tuck is not readable at all, because it points straight down
 *      the camera axis where there is nothing to see -- which is what the old
 *      head-first duck relied on.
 *   5. Some states cannot be won on silhouette at any price, and the slide is
 *      one of them: it points the legs down the view axis, where a metre of
 *      extension is 0.027 of frame height. Those states have to be told
 *      through what the character does to the WORLD -- see the skid block
 *      below. Marks left on the road travel toward the lens, which is the one
 *      direction perspective is generous in.
 *   6. The moments a player has to TIME are the two ends of the jump, and a
 *      pose cannot mark an instant -- it can only hold one. So both ends fire
 *      VFX (see STREAK_N) and the ground under an airborne runner carries a
 *      hard-edged ellipse for the whole arc, which is a landing reticle in a
 *      shadow's clothing. The soft contact blob is right for a body ON the
 *      road and exactly wrong for one above it.
 *   7. A person reads as a person because they are WEARING something, and a
 *      garment is only ever visible at its EDGES. The reference character from
 *      behind is a stack of hems -- cap band, hood roll, collar, vest hem,
 *      short cuff, sock, shoe collar -- and this one was a smooth cylinder
 *      with a number on it. Every hem added here is welded into a part that
 *      already existed, so the whole wardrobe costs two draw calls (the hood,
 *      which has to move on its own, and the bib, which flutters) and not one
 *      vertex of extra width.
 *
 *      A hem also has to be MEASURED at the size the game ships, and half of
 *      the first wardrobe pass was not. See the list above the colour block for
 *      what came out again and why -- one item was not merely invisible but
 *      actively read as a hole in the vest, which is the failure mode worth
 *      remembering.
 *
 *      That list has since been re-measured end to end, because it was written
 *      against a figure believed to be 110px who is 163-208px in portrait and
 *      50-67px in landscape (tools/figure.js). All four removals hold, but only
 *      one held for the reason recorded, and the three corrections are all the
 *      same correction: A DIMENSION IS NOT A SCREEN FOOTPRINT. Three tests,
 *      in the order they actually decide things:
 *        1. IS IT DRAWN AT ALL? The lace panel was 0 pixels in 48 of 48 frames
 *           -- buried under the sock and the toe dome, whose ink shells close
 *           the gap between them -- and had been since the day it was written.
 *           A restored finger is 0 in 45 of 48, because it points down the view
 *           axis. Neither was ever a question of size.
 *        2. WHAT IS DIRECTLY ABOVE IT? The waistband is 299 pixels, seven and a
 *           half times the short cuff that was kept, so it passes any size test
 *           -- and it still has to go, because it lands within 8% of the vest
 *           hem above it and cuts the biggest value edge on the lower half of
 *           the figure by 41%. A hem is judged against BOTH its neighbours.
 *        3. WHAT SHAPE DOES IT RESOLVE INTO? The base-layer sleeve reads as a
 *           triangular hole whatever its size, which is why it is the one
 *           removal whose original argument survived contact with the truth.
 *      Only after those three does "how many pixels" mean anything, and
 *      tools/resolve.js answers it by building the part and counting.
 *   8. Nothing on a rig where every part is bolted to a joint can arrive late,
 *      and everything real does. Five things here do not arrive with the
 *      skeleton: the hood on a pair of underdamped springs, the bib's hem on a
 *      travelling wave with its own clock, the head on a lag filter at the
 *      neck, and both elbows on lag filters of their own. The first two are the
 *      two largest pieces of cloth the back view sees, which is not a
 *      coincidence -- cloth is the only thing on a runner that is ALLOWED to
 *      lag freely. The other three are body, and they are held to a much
 *      shorter lag for exactly that reason: see stage 2 below.
 *
 *      What is NOT here, and cannot be without changing the character: the
 *      vest hem, the short cuffs and the cap peak. The owner's brief named all
 *      four garments, and three of them are welded into meshes that also carry
 *      the silhouette -- the hem into the torso, the cuffs into the thighs, the
 *      peak into the head. Nothing can lag that is a vertex of the part it
 *      would lag behind, and this is a motion pass, so no geometry was split to
 *      create something to swing. The peak is a special case twice over: it is
 *      measured at ZERO pixels from astern (see its own note), so a peak that
 *      lagged perfectly would still show nothing.
 *
 * ANIMATION POLISH, STAGE 1 -- full-body motion, stride, arms, foot planting
 * and easing. Every term the pass added is scaled by MR.Runner.POLISH, a
 * module-level 0..1 knob wired to ?polish= in main.js and --polish in
 * tools/stride.js, so ONE build renders the cycle before and after and the
 * comparison cannot go stale. At 0 the arithmetic reduces to the pre-pass
 * expressions exactly -- verified joint by joint, not by eye. See the block
 * above `let POLISH` for the rules that keeps true, and the block above the leg
 * loop for the phase error it fixed, which was the largest single defect in the
 * cycle and was invisible to every measurement taken before the foot's rig-space
 * LOOP was plotted rather than its amplitudes.
 *
 * ANIMATION POLISH, STAGE 2 -- secondary motion. Four things, all scaled by the
 * same POLISH knob, and the finding that shaped all four is that the defect was
 * PHASE and not amplitude. Stage 1 gave the trunk real motion; every part
 * hanging off it still arrived on the same frame it did. Measured before this
 * pass, the skull's lateral sweep correlates 0.996 with the trunk at lag
 * 0.000, and so does the hood's -- the largest piece of cloth on the character
 * was welded on every axis this camera can see, because both of its springs
 * were driven by inputs that carry no lateral stride content at all.
 *
 *   - The head, on a lag filter at the neck. 13.1 degrees late.
 *   - Both elbows, on lag filters. The mitt arrives 6.8 degrees late.
 *   - The hood's lateral spring, given a stride drive so it does something
 *     while the runner is going straight, which is all but the whole race.
 *   - The hood's pitch spring, fed the collar's REAL vertical (the bob plus
 *     stage 1's trunk compression) instead of the bob alone.
 *
 * The split those four run on is worth stating once: BODY gets lag filters --
 * chase the posed value, add the error, which is zero at any held pose, so no
 * silhouette and no held pose moves at all. CLOTH gets driven soft springs,
 * which is what lets the hood arrive 140 degrees behind its own drive without
 * that reading as rubber. Applying the cloth treatment to a limb is exactly the
 * floppy failure the brief forbids, and it is one constant away in each case.
 *
 * ANIMATION POLISH, STAGE 3 -- speed responsiveness. Same POLISH knob again.
 * The starting measurement is that the character barely had any: across the
 * WHOLE honest pace band, a 5:30 mile against a 4:14 one, stride amplitude
 * moved 21% and lean moved 0.12 rad, and nothing else in the file read `speed`
 * at all except cadence and the bib. Two halves:
 *
 *   PACE, on `sp01`. Stride amplitude 21% -> 38% across the band, lean 0.12 ->
 *     0.19 rad, elbow flexion on the front swing +0.16, and shoulder abduction
 *     on the back swing +0.18 -- which is derived rather than chosen, being the
 *     largest value that leaves the run's silhouette half-width bit for bit
 *     where it is. The cadence curve is deliberately NOT touched; see its own
 *     note for the audio calibration that depends on it.
 *
 *   ACCELERATION, on `surge`, which did not exist -- nothing here had ever
 *     differentiated anything. A smoothed derivative of ground speed with the
 *     HILL TAKEN BACK OUT, driving lean, hip extension, knee drive and the
 *     toe. Taking the hill out is the whole design: the raw derivative of the
 *     grade-inclusive speed this file is handed is three to four times larger
 *     on terrain than on effort, and at the top of a climb it has the opposite
 *     sign, so it would lean the character hardest exactly where gravity is
 *     doing the work. See SURGE_FULL and the block in update().
 *
 * Stage 3 also has to be read against the instrument. tools/stride.js settles
 * its contact sheets and does NOT settle its measurement sweep, which was
 * harmless while every filter in this file was seeded lazily off its own posed
 * value and is not harmless now that one of them is driven by the HISTORY of
 * `speed`: the page runs at whatever speed ?skip= produces before the tool
 * re-poses the rig at lo/mid/hi, and the step between the two is differentiated
 * as though the runner had accelerated. It inflates the polish-1 travel table
 * by up to 3.3x on the chest and 6% on the head, and it cannot touch polish 0,
 * where every surge term is multiplied by zero.
 *
 *
 * Pivot layout (all rotations are local X unless noted):
 *   root -> body -> hips -> thigh -> shin -> foot
 *                -> spine -> chest -> neck -> head
 *                                  -> shoulder -> upperArm -> forearm+hand
 *                                  -> hoodPivot -> hood   (springs, not posed)
 *        -> shadowPivot -> contact shadow, landing reticle
 *                                              (cancels the jump and the bank)
 *        -> fxPivot     -> skid ribbon, dust, speed streaks
 *                                              (cancels root ENTIRELY, so its
 *                                               children hold world coords)
 */
MR.Runner = (function () {
  // Hoisted: this is measured every frame of a slide and must not allocate.
  const _clampBox = new THREE.Box3();
  const S = MR.shading;
  const P = S.PALETTE;
  const K = MR.K;

  // Ground speed at the two ends of the honest pace band. Derived rather
  // than hard-coded so retuning START_PACE or FLOOR_PACE still lands the
  // full range of stride and lean instead of quietly clipping it.
  const SPEED_LO = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.START_PACE;
  const SPEED_HI = (K.UNITS_PER_MILE * K.TIME_SCALE) / K.FLOOR_PACE;

  // ---- the surge signal, stage 3 -----------------------------------------
  // What follows exists so that "acceleration" means the runner working
  // harder, and never means gravity.
  //
  // The numerator of every speed in this file: pace is seconds per mile, and
  // speed = SPEED_NUM / pace. Named rather than repeated because the surge
  // signal below has to go BACK through it to recover a pace.
  const SPEED_NUM = K.UNITS_PER_MILE * K.TIME_SCALE;
  // The seconds per mile the hill adds at the steepest legal grade, i.e. at
  // st.grade = +/-1. pace.js writes paceNow = pace + GRADE_SPM * gradePercent
  // and main.js hands this file gradeNorm = gradePercent / (MAX_GRADE * 100),
  // so the two constants below are exactly what turns one into the other.
  // Derived from both rather than written as the 20.0 they currently multiply
  // to, so retuning either one follows here instead of silently drifting.
  // (K.GRADE_CLAMP is the same 20.0 and is deliberately NOT used: it is a
  // backstop that provably never fires, and borrowing a safety limit as a
  // calibration is how a constant ends up meaning two things.)
  const GRADE_SPM_FULL = K.GRADE_SPM
    * ((MR.Elevation && MR.Elevation.MAX_GRADE) || 0.040) * 100;
  // Full surge, in u/s^2 of grade-free ground speed after the two filters
  // below. MEASURED, not chosen: 40 whole races -- 10 course seeds x 4 skill
  // levels, 637,653 frames -- put the positive acceleration a clean streak can
  // ever produce at p99 0.420, p99.9 0.435 and a hard maximum of 0.4424. The
  // pace ease is what bounds it: PACE_EASE could move the pace ten times
  // faster than this, but the streak target it is chasing only moves when a
  // gate is passed, so 0.44 is the real ceiling on gaining pace in this game.
  //
  // Deceleration is a different size entirely and is NOT given its own scale:
  // the same 40 races put it at p90 0.758 and a maximum of 1.9861, four and a
  // half times the positive ceiling, because a contact drops the streak in one
  // frame where a clean line rebuilds it over many. So the negative half of the
  // signal saturates almost at once, and it is given a much smaller gain below
  // rather than a larger divisor -- a runner who is losing pace eases off, and
  // the game already has `stumble`, `trip` and `bounce` to say that they were
  // hit. Sizing both halves off one number and letting the clamp do the rest is
  // what keeps a surge from turning into a brake.
  const SURGE_FULL = 0.44;

  // ---- the animation A/B --------------------------------------------------
  // 0 renders the run cycle exactly as it was before the polish pass, 1 renders
  // the polished one, and anything between crossfades. main.js reads ?polish=
  // and tools/stride.js reads --polish, so ONE build renders both and a
  // before/after comparison cannot go stale the way a checked-in screenshot or
  // a side branch does.
  //
  // The rule every term below obeys, and it is the whole reason this works:
  // POLISH scales the DELTA, never the term.  x = old + POLISH * (new - old),
  // so at 0 the arithmetic reduces to the original expression -- not to
  // something that merely rounds to it. Where a factor is added to an existing
  // product the constant stays leftmost inside its own parenthesis
  // (`s * swing * (0.95 + POLISH * 0.10)`), because float multiply is not
  // associative and reordering it would move the last bit. tools/stride.js at
  // --polish 0 is the proof, and it must come back byte-for-byte identical to
  // the pre-pass baseline.
  let POLISH = 1;

  // old -> new with the knob in between. mix(a, b, 0) is `a + (b - a) * 0`,
  // which is exactly `a` for any finite a, so this is safe to wrap a term in
  // without disturbing it at 0.
  const mix = (a, b, t) => a + (b - a) * t;

  // ---- cycle shape --------------------------------------------------------
  // Two shaping functions, and between them they are most of what separates a
  // procedural cycle from an animated one.
  //
  // `sm` is smoothstep on [0,1], used here to round off `Math.max(0, sin)`.
  // A clipped sine is the standard way to say "only while the limb is forward"
  // and it has a CORNER at every crossing: the angle's first derivative jumps,
  // which the eye reads as a tick even at a couple of hundredths of a radian.
  // sm(max(0,x)) has the same peak and the same support with zero slope at both
  // ends, so the term arrives and leaves instead of switching on.
  const sm = (x) => x * x * (3 - 2 * x);

  // `SHARP` is a third harmonic added to the fundamental swing. A real stride
  // is not a sine: the limb crosses the vertical -- which is where the contact
  // is -- much faster than a sine does, and dwells longer at the two extremes.
  // sin(x) + b*sin(3x) is the first step from a sine toward a triangle: it
  // multiplies the rate at the crossing by (1 + 3b) while the peak drops to
  // (1 - b), so dividing by (1 - b) restores the REACH exactly and buys the
  // crossing speed for free. That matters more than it sounds: stride length is
  // the term the owner asked twice not to exaggerate, and this makes the plant
  // faster without lengthening it by a millimetre.
  //
  // Held below 1/9. At b = 1/9 the peak of sin(x) + b*sin(3x) splits in two and
  // the extreme develops a dimple; below it the curve still has a single
  // maximum at x = pi/2 with value exactly (1 - b), which is what the
  // normaliser assumes.
  const SHARP = 0.10;
  const sharpen = (s, s3) => (s + SHARP * s3) / (1 - SHARP);

  // ---- the height ladder -------------------------------------------------
  // Every joint hangs off these, in world units above the road with the body
  // at rest, so a proportion change is one edit rather than a hunt through
  // the file. The stride bobs the whole body over the range [0, BOB].
  //
  // HEIGHT is the crown at the TOP of that bob, not at rest, because
  // MR.Collision.audit() reads it as the worst case a committed duck has to
  // fit under. Quoting the resting height there would let the audit pass on a
  // character that still clips the bar on the up-beat of its own stride.
  //
  // The figure got 10% shorter in the wave-2 pass without getting any
  // narrower: the shoulder line is pinned at 0.78 because constants.js cuts
  // the lane width from it, so height is the only axis left to make the
  // character chunkier on, and the reference characters are chunky mostly by
  // being short. Collision gains by it rather than losing: at the duck
  // threshold the head reaches 1.60 - 0.42*0.90 = 1.22 against a bar starting
  // at 1.41, which is 0.19 of daylight where 1.78 left only 0.01.
  const HIP_Y = 0.552;     // pelvis pivot
  const CHEST_Y = 0.767;   // shoulder girdle pivot
  const NECK_Y = 0.907;    // base of the neck; the head rotates from here
  const HEAD_Y = 1.269;    // centre of the skull
  const BOB = 0.040;
  const HEIGHT = 1.60;

  // ---- the slide's angle of attack ---------------------------------------
  // The one number that makes a feet-first slide readable from directly
  // behind, and it took three passes to find because every earlier attempt
  // tried to solve it with more extension.
  //
  // Measured on this rig at this camera: throwing the feet a full 0.65 ahead
  // of the head raises them 0.027 of frame height. That is the whole return on
  // pose extension, and it is nothing, because the legs point down the view
  // axis where a metre of length is a couple of pixels.
  //
  // Turning the body across the lane spends that same extension on the axis
  // the back view CAN measure. At 0.42rad the 1.6 of body length between the
  // trailing glove and the leading shoe puts 0.65 of itself sideways -- and
  // sideways is free, because the figure is only 0.4 wide, so every unit of it
  // changes the outline instead of hiding behind the torso. It is also simply
  // what a slide is. Nobody goes into a bag square.
  //
  // The ceiling is the lane, not taste: MEASUREMENTS.md puts the runner's
  // budget at 0.70 from the lane centre before it visibly grazes hazards it
  // legitimately cleared. Splay was cut from 0.52 to pay for this, so the
  // committed pose measures 0.59 half-width against the run's 0.42 -- inside
  // the budget, and still barely two thirds of the jump's 0.92, which is the
  // silhouette rule this must not break.
  const SLIDE_YAW = 0.42;

  // How far the trunk lies back in a slide, in radians off vertical. Named
  // because three separate things are measured against it -- the neck's tuck,
  // the arms' trail angle, and how much of the body's length ends up on the
  // lateral axis SLIDE_YAW just bought. Deepened from 1.12: at 1.12 the
  // shoulders sat HIGHER than the hips and the trunk read as a sit-up rather
  // than as a body on its back. 1.34 puts the back down on the road, which is
  // what the reference shows and, once the trail foot stopped digging (see the
  // hip term), what the road clamp is finally free to allow.
  const SLIDE_RECLINE = 1.34;

  // Trunk pitch on a grade, in radians at the steepest legal one (4%). A
  // climber leans into the hill and a descender sits back off it; the descent
  // gets half the angle because it is a controlled fall rather than an effort.
  const GRADE_PITCH_UP = 6 * Math.PI / 180;
  const GRADE_PITCH_DOWN = 3 * Math.PI / 180;

  // ---- the slide's head --------------------------------------------------
  // The other half of the same problem, and the half three passes got exactly
  // backwards. The reference frame is unambiguous: Temple Run's slider is flat
  // on their back with the head COMPLETELY out of the silhouette -- legs up the
  // path, torso, then arms out wide nearest the lens, a low wide X. Nothing
  // stands above the back.
  //
  // This rig used to hold the head level right through the slide, which stands
  // a skull 0.57 across straight up off a body lying at 15 degrees and rings it
  // with the brightest colour on the character. Measured before this change:
  // crown 1.31 with the hips at 0.44 -- two thirds of the figure's standing
  // height, on a pose whose whole job is to be low. That is a crouch, and it is
  // why extending the legs never worked; the top of the shape was a head.
  //
  // Five terms, and every one of them was needed -- the pose was rendered and
  // measured at each step, and each of the first four left a different defect
  // that only the next one fixed:
  //   X  extension PAST the reclined chest. -0.50 against a 1.34 recline lays
  //      the head at -1.84 off vertical: the crown swings back and DOWN toward
  //      the shoulder blades. It stops short of aiming the crown straight at
  //      the lens on purpose. Pole-on, the crown cap's fourteen triangles all
  //      converge on the pixel facing the camera and the toon ramp bands each
  //      one differently -- the head rendered as a dark porthole with a gear in
  //      it. Forty degrees off the pole is enough for the hair to shade as a
  //      surface again.
  //   Z  a turn across the lane. With the trunk reclined, the chest's local Z
  //      is very nearly world UP, so this term is a yaw of the head and not a
  //      roll -- it takes the face off the camera axis, which matters because
  //      a laid-back head points its face up and back into the lens.
  //   sink the neck pivot down the spine, seating the skull between the
  //      deltoids rather than standing it off them.
  //   retract the head mesh down its OWN axis. The sink moves the head along
  //      the spine, and in a slide the spine points at the camera, so the sink
  //      alone mostly moves the head sideways in depth instead of closer in.
  //   squash. This is the one that cannot be argued away: the skull is 0.57
  //      across on a 0.52 trunk, so no rotation and no translation can put it
  //      inside the body -- the geometry does not fit. At 0.58 it does, and
  //      what is left above the vest is a dark cap of hair the size of a
  //      shoulder with the headband reduced to a sliver at its edge. Hiding the
  //      mesh outright was the alternative and it would pop; a scale runs
  //      continuously and reads as a head pulled into the shoulders, which is
  //      what the pose is. Rendered against a head-hidden control frame, the
  //      two silhouettes now differ by about a shoulder's worth of dark.
  // Every one of them is scaled by `slid`, so recovery runs the whole tuck
  // backwards in step with the body coming up and never pops.
  const NECK_SLIDE_X = -0.50;
  const NECK_SLIDE_Z = -0.14;
  const NECK_SLIDE_SINK = 0.15;
  const NECK_SLIDE_RETRACT = 0.20;
  const NECK_SLIDE_SQUASH = 0.42;

  const OUTLINE = MR.shading.INK.character;

  // Accent that ties the silhouette together: headband, wristbands, shoe
  // midsoles -- top, middle and bottom of the figure. Repeating one bright
  // colour on a rhythm is what makes a pile of primitives look like a
  // designed character instead of assorted parts. A fourth hit on the vest
  // hem put three yellows at the same height and just read as clutter.
  const TRIM = P.accent;

  // ---- the wardrobe ------------------------------------------------------
  //
  // What separates the reference characters from a coloured cylinder is that
  // they read as a PERSON WEARING CLOTHES: every garment has an edge, and the
  // edges are where one tone meets a neighbouring one. Subway Surfers' runner
  // from behind is a stack of hems -- cap band, hood roll, jacket collar,
  // jacket hem, short cuff, sock, shoe collar -- and none of them
  // is a strong colour. They are all a step off the garment they trim.
  //
  // So every tone below is deliberately a NEIGHBOUR of the mass it edges,
  // never a contrast to it, for the same reason SOLE is a half-step off the
  // shoe upper: a hem that jumps hue stops being an edge of the garment and
  // becomes a second object stuck to it. The bright accents (TRIM) already
  // carry the character's rhythm and there are only ever three of them.
  //
  // They also have to survive the toon ramp's three bands. A tone less than
  // about 12% off its neighbour lands in the same band on most of the surface
  // and the hem simply is not there; these all sit between 15% and 30% off.
  //
  // ---- HOW BIG HE ACTUALLY IS, and it is not what this file used to say ---
  //
  // Every removal below was argued in pixels, and until now the pixels were
  // guessed. Measured on the shipped build at the shipped camera by
  // tools/figure.js -- every de-duplicated vertex of every visible mesh
  // through the real lens, swept across the stride and across six camera-phase
  // windows, because the FOV swings with pace and the camera's bob clock beats
  // against the runner's:
  //
  //   390x844 portrait   start 189-208   slow 186-208   mid 166-204   fast 163-200
  //   620x1344           start 302-332                                fast 259-318
  //   320x568 smallest   start 128-140                                fast 109-134
  //   1280x800 desktop   start 155-172                                fast 131-162
  //   844x390 LANDSCAPE  start  60-67    slow  59-67    mid  51-63    fast  50-62
  //
  // Three things follow and none of them was known when the list below was
  // written:
  //
  //   THE 110 WAS WRONG and so is the 204-211 that replaced it. On the frame
  //     that ships he is 163-208px, median 179-199 depending on pace -- so the
  //     correction that found 204-211 quoted the TOP of the range as though it
  //     were the figure, and the camera has moved since (CAM_BASE_Y 2.62 to
  //     3.10, LOOK_AHEAD 8.0 to 11.0, the FOV floor 58 to 61, the swing 10.5 to
  //     8.5), which took another 2.4% off him. Anything in this file quoting a
  //     single number for his height is quoting one row of the table above.
  //   PACE IS WORTH 10% OF HIM. The lens opens from 61 to 70 degrees across the
  //     honest pace band, so the same detail is a tenth smaller at a record
  //     pace than at the start -- and a record pace is when the player is
  //     looking hardest.
  //   LANDSCAPE IS THE BINDING CASE, and no comment in this file had ever
  //     mentioned it. At 844x390 he is 50-67px: a THIRD of portrait, and near
  //     the forty-pixel silhouette the jump and the slide are held to. A
  //     detail sized against 200px is being drawn at 55px on the same phone
  //     turned sideways.
  //
  // The number that actually settles a removal is not his height at all, it is
  // PIXELS PER WORLD UNIT at the depth the part lives at, because that is what
  // converts a dimension into pixels. figure.js reports it: 121-131 across at
  // 390x844, 39-43 in landscape. Nothing here should ever again divide a part
  // by 1.60 and multiply by a remembered height.
  //
  // WHAT SURVIVES THE CAMERA, AND WHAT WAS TAKEN OUT AGAIN. Kept, because they
  // were measured to read: the cap band, the vest's red against the shorts'
  // navy, the short cuff, the shoe. Everything below was re-examined against
  // the real figure with tools/resolve.js, which BUILDS each candidate, gives
  // it a flat unique colour and COUNTS its pixels in the real chase frame
  // across a stride -- against a positive control of the same geometry held
  // clear of what occludes it, so a zero can be told from a probe that was
  // never drawn, and against three parts that were kept and are agreed to
  // read. Every one of them stays out, and only ONE of them stays out for the
  // reason originally written down:
  //
  //   BASE-LAYER SLEEVES  a pale blue cylinder under each deltoid, with its
  //     own rolled cuff. THE ORIGINAL REASON STANDS and it was never a size
  //     argument: from the chase camera the sleeve is not a cylinder, it is
  //     the sliver of one that clears the deltoid, so it resolves as a pale
  //     triangle at each shoulder and a pale triangle inside a red mass reads
  //     as a HOLE IN THE VEST. That is a shape fault, and a shape fault does
  //     not improve when the figure gets bigger -- it gets more legible.
  //     Measured anyway, for the record: 23px of frame at 390x844, 0 in most
  //     landscape frames. Its cuff went with it, at 18px; a cuff on a sleeve
  //     that is not there is nothing.
  //   LACE PANEL  the recorded reason -- "0.078 across, half a pixel wide at
  //     gameplay framing" -- IS WRONG TWICE. 0.078 across is nine or ten
  //     pixels, not half of one. And it never had a size problem, because it
  //     was never drawn at all: measured at 0 pixels in 48 of 48 frames in
  //     portrait AND in landscape, while the identical box held clear of the
  //     shoe measures 260. It is buried. See its own note at the shoe for the
  //     two neighbours that bury it -- and note that both of them are the same
  //     geometry they were on the day the panel was written, so the panel was
  //     invisible from the moment it landed and the wardrobe pass removed it
  //     for a reason it did not have.
  //   WAISTBAND  a third navy tone 0.052 tall. The recorded reason -- "a 3px
  //     band of a near tone" -- is wrong on both counts: it measures 6-11px
  //     tall in a column, 16px of screen extent, and 299 pixels of frame,
  //     which is SEVEN AND A HALF TIMES the short cuff that was kept beside
  //     it; and it is not a near tone, it renders at exactly the tone the
  //     short cuff renders at. It stays out regardless, for a fault the note
  //     was reaching for and named against the wrong neighbour. See its own
  //     note at the pelvis.
  //   THREE FINGERS  see the hand. 0 pixels in 45 of 48 portrait frames and 48
  //     of 48 in landscape, because they point down the view axis and sit
  //     behind the palm. That judgement was made at 26px by a pass that had
  //     already measured the figure correctly, and it survives.
  //
  // What the freed budget bought is the hand -- see the mitt below.
  const JACKET = 0xd6394e;   // cap peak, vest collar, vest hem -- under the vest
  const WAIST = 0x434a80;    // hood and short cuff -- one step over the shorts
  const SHOE_DK = 0x5f6796;  // heel counter
  // The cap is the vest's own red rather than a new colour. It puts the
  // brightest garment tone at the top AND the middle of the figure, which is
  // the same "repeat one colour on a rhythm" trick TRIM runs, and it means the
  // slide's tucked head resolves into the trunk instead of standing off it as
  // a differently coloured lump. See the slide note below.
  const CAP = P.runnerVest;

  // The outsole, and the fix for a bug that had been visible in every
  // gameplay screenshot: the whole underside used to be TRIM. The recovery
  // ankle plantarflexes until the sole faces the camera square-on, so the
  // largest flat face on the character was presenting a saturated yellow
  // rectangle bigger than its own head -- and because that foot swings up
  // right beneath the opposite glove, the review read it as a slab held in
  // the runner's left hand.
  //
  // The colour is a half-step off the upper rather than a contrast to it, and
  // that is the actual repair: whatever face the shoe turns to the camera it
  // has to stay ONE object, and a sole that jumps hue or value splits into a
  // second thing hanging off the leg. Going dark instead would have fixed the
  // shout and lost the foot against the road, and the feet are what carry
  // cadence from behind.
  const SOLE = 0xd6cabb;

  // ---- the mitt ----------------------------------------------------------
  //
  // The hand used to be the shoe's own colour, and that is most of why the
  // review found the runner had none. At the back of the arm swing the trailing
  // glove sits at world y~0.30 and the shoe tops sit at 0.25, a few pixels
  // apart on screen -- so the biggest pale mass on the lower half of the figure
  // had a second pale mass of exactly the same tone parked beside it, and the
  // two averaged into one blob. No amount of finger geometry survives that.
  //
  // Cool where the shoe is warm, and a step darker. At gameplay scale the hand
  // is 25-27px across -- 0.208 on the figure against the 121-131 pixels per
  // world unit figure.js measures at 390x844, and it was 14px in this comment
  // for as long as the 110px figure was believed. The conclusion is unchanged
  // and that is worth saying rather than quietly fixing the number: 26px is
  // enough for a shape and ONE value break and nothing else, exactly as 14px
  // was, because what the second break would have to survive is not the hand's
  // width but the toon ramp's three bands. So both are spent on saying "not
  // the shoe": MITT against the
  // shoe's 0xfff2e0 is a 22% value step AND a hue flip, which is the pair of
  // axes MEASUREMENTS.md records the reference using to separate a car from the
  // road it is the same brightness as. It is still far and away the palest
  // thing at that height apart from the shoe, so rule 3 -- the gloves flash
  // against the road -- is untouched.
  // A mid blue rather than the near-white the first attempt used. Measured off
  // the frames: a white shoe's SHADED side lands around 0xc8ccdd under the cool
  // end of the toon ramp, so a near-white cool mitt's LIT side was the same
  // colour as the thing it had to separate from. A step further down clears the
  // shoe at both ends of its own ramp and is still 1.8x the road's luminance,
  // so rule 3 -- the gloves flash against the road -- survives.
  const MITT = 0xa8b6de;
  // The curled fingers. Darker again, and it is the only interior detail the
  // hand gets: at 26px a knuckle line is the difference between a mitt and a
  // ball, and three separate fingers are three 8px lobes in the palm's own
  // colour. The 4px in this line was the 110px figure showing again; doubling
  // it does not rescue them, and measurement says something stronger than the
  // aliasing argument ever did -- the three capsules that were here are drawn
  // at ZERO pixels in 45 of 48 frames, because they point down the view axis
  // and sit behind the palm. See the hand.
  const MITT_DK = 0x6b74a0;

  // ---- the face's four tones ---------------------------------------------
  //
  // No new HUE enters the character here, and that is the constraint the whole
  // face pass was built under: the owner's brief says his colours do not move.
  // SKIN_SH is his own skin one step down in value, which is what the wardrobe
  // note two screens up calls a NEIGHBOUR tone rather than a contrast, and it
  // is used exactly where a form has a hollow in it that the ramp cannot find
  // on its own -- the ear's concha and the shadow under the jaw. MOUTH is the
  // hair's own dark purple-brown warmed and darkened; it is the same family
  // and it is the only tone on the character that could be called new, which
  // is unavoidable because he had no mouth to have a colour.
  //
  // SCLERA is deliberately NOT white. 0xffffff on a figure whose brightest
  // existing tone is the 0xfff2e0 shoe would put the highest value in the
  // frame in two 3-pixel slivers, and the eye goes to the brightest thing --
  // which at gameplay range would be a pair of white specks on the back of a
  // head that has no eyes in view at all. A warm off-white sits under the shoe
  // and does the same job in the views that have a face in them.
  const SKIN_SH = 0xe0a077;
  const MOUTH = 0x46212f;
  const SCLERA = 0xf6ece0;
  // The iris. Dark enough that the assembly still averages to the ink oval it
  // replaces -- see the eye block in create() for why that matters -- and warm
  // enough to separate from the pupil sitting inside it. A brown eye, which is
  // what the reference frames all have and what the skin says he should.
  const IRIS = 0x4a3040;
  const CATCH = 0xfdf7ef;

  /**
   * The face's mass: the four planes a head has, at the size a head this size
   * can hold them.
   *
   * The numbers are all solved against one ellipsoid -- the skull is r 0.266
   * scaled 1.06 in y and 0.97 in z, so its semi-axes are 0.266 / 0.282 / 0.258
   * about (0, HY, 0) -- and each piece's clearance is quoted as how far proud
   * of that surface it emerges at its own centre line. Under one ink width
   * (0.014) two surfaces grow teeth; every clearance here is 0.020 or better.
   */
  function faceMass(HY) {
    return [
      // THE NOSE, and it is a button rather than a wedge. At 163-208 px of
      // whole figure the head is about 70 px and the nose is 5 of them; the
      // only thing that can read at that size is a silhouette break on the
      // profile, which is what 0.029 proud buys, and a bridge would spend
      // three times the geometry to be invisible from everywhere but dead
      // ahead -- which is the one angle this game never uses.
      //
      // It sits on the SKULL and not on a muzzle. The first version of this
      // block put it on a broad lower-face mass on the reasoning that a plane
      // break between the upper face and the lower is what a head has, and
      // that is true of a head and false of THIS head: at 0.108 across the
      // mass read as a snout, and the nose disappeared into it because the
      // muzzle had already spent the 0.03 of relief the nose needed. Three
      // more pieces were cut in the same pass and for versions of the same
      // reason -- see the note under this list.
      { g: new THREE.SphereGeometry(0.046, R_NUB, 12), c: P.runnerSkin,
        y: HY - 0.078, z: 0.240, sx: 0.80, sy: 0.72, sz: 0.80 },
      // THE JAW, and it is ONE piece across the whole lower face rather than a
      // chin plus two jaw angles, which is what the second version of this
      // block had. Rendered, three masses along the bottom of a round head do
      // not read as a jaw; they read as a chin between two jowls, because at
      // this size every one of them is resolved as its own closed outline and
      // the eye counts outlines before it reads form.
      //
      // So: 0.306 across, 0.120 deep, standing 0.024 proud on the centre line
      // and tapering back INTO the skull before x = 0.153. That last property
      // is what makes it a jaw rather than a jaw stuck on a ball -- it has no
      // edge of its own anywhere the lens can find one, and what it leaves is
      // a plane change under the mouth and a break in the profile, which is
      // the whole of what a jaw is from 70 px.
      //
      // SKIN, not SKIN_SH, and that is a reversal within this pass. Under a
      // jaw is the one plane on a head that never faces a light and a tone can
      // say what geometry cannot -- but rendered, a darker patch at the corner
      // of the jaw does not read as shadow, it reads as a BEARD, and a beard
      // is a design change and the brief says his design does not move. Form
      // only; the ramp finds it.
      { g: new THREE.SphereGeometry(0.150, R_LIMB, 14), c: P.runnerSkin,
        y: HY - 0.192, z: 0.108, sx: 1.02, sy: 0.40, sz: 0.70 },
    ];
  }

  /**
   * The eye, outward in. See the block above create()'s eye mesh for the
   * argument; the geometry is here so both eyes are one loop and the z ladder
   * is one list rather than eight numbers scattered down a weld.
   */
  function eyePieces(HY) {
    const out = [];
    const y = HY - 0.016;
    for (const s of [-1, 1]) {
      const x = s * 0.100;
      out.push(
        { g: new THREE.CircleGeometry(0.062, R_TORSO), c: SCLERA, x: x, y: y, z: 0.2610, sy: 0.82 },
        { g: new THREE.CircleGeometry(0.052, R_TORSO), c: IRIS, x: x, y: y - 0.002, z: 0.2630 },
        { g: new THREE.CircleGeometry(0.026, R_NUB), c: P.ink, x: x, y: y - 0.002, z: 0.2650 },
        // Inboard and high. Both catchlights have to be in frame together at
        // the three-quarter views or the near eye reads as alive and the far
        // one as a hole.
        { g: new THREE.CircleGeometry(0.012, R_NUB), c: CATCH, x: x - s * 0.016, y: y + 0.018, z: 0.2670 }
      );
    }
    return out;
  }

  /**
   * The mouth: an open one, because he is running.
   *
   * A closed line would be the safer drawing and the wrong one. This character
   * is at 4:14 mile pace with a fuel bar draining, and the single cheapest
   * thing that says effort on a face is an open mouth -- it is what every
   * reference frame of a running character in reference/ has. It is two
   * pieces: the aperture, and a lower lip in the skin's own shade beneath it
   * so the opening has a floor rather than being a hole punched in the head.
   *
   * Built in its own pivot's space, centred on the origin, so the expression
   * work can scale it open and shut about its own top edge.
   */
  function mouthPieces() {
    return [
      { g: new THREE.CircleGeometry(0.050, R_TORSO), c: MOUTH, y: 0, z: 0.036, sx: 1.30, sy: 0.46 },
      { g: new THREE.CircleGeometry(0.050, R_TORSO), c: SKIN_SH, y: -0.017, z: 0.034, sx: 1.24, sy: 0.34 },
    ];
  }

  // ---- how round a round thing is ----------------------------------------
  //
  // THE BUDGET THIS CHARACTER WAS BUILT AGAINST WAS WRONG BY AN ORDER OF
  // MAGNITUDE, and every segment count in this file was a consequence of it.
  // The 75,000-triangle ceiling (later 150k) was set off frame rates measured
  // under SwiftShader -- software rasterisation, 50-100x slower than any GPU
  // the game actually ships to. Measured properly the frame runs 45k-87k
  // triangles at 160-251 draw calls and the owner's phone runs it without
  // complaint. The working ceiling is 500,000, and the whole runner was 14,128
  // of it -- 2.8%.
  //
  // The cost of that mistake was visible in every frame ever shot: at the
  // 163-208px the shipped 390x844 chase frame actually gives this character, a
  // fourteen-segment cap band is a POLYGON, not a band, and the trunk is a
  // dodecagon with a hard vertical crease down the side of it. (This line said
  // 200px, which was the top of that range read as though it were the middle;
  // see the measured table above the wardrobe. The argument is unaffected --
  // it is stronger at the bottom of the range, not weaker, because a polygon
  // reads as a polygon at every size a facet spans more than a pixel.)
  //
  // So roundness is bought back, and it is bought where the camera looks
  // rather than evenly -- draw calls are the thing worth watching now, and
  // none of this adds one. The tiers, loosely by how many pixels across the
  // part is at the framing that ships:
  //
  //   R_HEAD   the skull, the cap and its band. The chase camera holds these
  //            dead centre for two hours and the finish lifts and holds on
  //            them; the band is the single most conspicuous facet count on
  //            the character.
  //   R_TORSO  the trunk cones and the outsole -- broad surfaces whose
  //            silhouette edge crosses the frame slowly enough to be read.
  //   R_LIMB   bones and terminals: capsules, the sock, the wristband, the
  //            mitt.
  //   R_NUB    the welded-on muscle forms and the small joints. These are
  //            never seen against sky, only against the limb they sit on, so
  //            what they need is enough rings for the toon ramp to curve a
  //            band across rather than enough to hold a clean outline.
  //
  // A POLYGONAL SPHERE IS INSCRIBED IN ITS TRUE RADIUS, so raising a count
  // makes a part very slightly BIGGER. Vertices do not move -- they were
  // always on the radius -- but a count that skips the equator (an odd
  // heightSegments, or a radialSegments that is not a multiple of four) does
  // not have a vertex at the widest point, and giving it one moves the
  // measured half-width outward. Every count below is a multiple of four for
  // the cylinders and even for the spheres so that the change is a single
  // known step rather than a drift, and the per-vertex silhouette was
  // re-measured across all 24 stride phases after it. See the table in the
  // header: run, jump and slide all came through unchanged.
  const R_HEAD = 32;
  const R_TORSO = 24;
  const R_LIMB = 20;
  const R_NUB = 16;

  /**
   * Weld several primitives into one geometry, baking each piece's colour
   * into a vertex-colour attribute.
   *
   * Every part is outlined, so a part costs two draw calls. Welding the
   * pieces that never move relative to each other -- skull + cap + peak +
   * hair + nape + band + ears + neck, vest + shoulders + collar + hem, shoe +
   * sole + heel counter -- is what pays for the extra detail this
   * silhouette needs while staying inside the budget. The whole character is
   * 30 draws plus one for the shadow, and the entire wardrobe pass that took
   * it from a cylinder to a person cost two of those: the hood, which is the
   * only added part that has to move independently of the bone it hangs off.
   *
   * Piece: { g, c, x,y,z, rx,ry,rz, sx,sy,sz }.
   */
  function weld(pieces) {
    const pos = [], nrm = [], col = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const c = new THREE.Color();

    for (const pc of pieces) {
      const g = pc.g.index ? pc.g.toNonIndexed() : pc.g.clone();
      e.set(pc.rx || 0, pc.ry || 0, pc.rz || 0);
      q.setFromEuler(e);
      v.set(pc.x || 0, pc.y || 0, pc.z || 0);
      sc.set(
        pc.sx === undefined ? 1 : pc.sx,
        pc.sy === undefined ? 1 : pc.sy,
        pc.sz === undefined ? 1 : pc.sz
      );
      g.applyMatrix4(m.compose(v, q, sc));

      const gp = g.attributes.position.array;
      const gn = g.attributes.normal.array;
      // THREE.Color already converts a hex through to the working colour
      // space, so these components line up exactly with a material colour.
      c.set(pc.c);
      for (let i = 0; i < gp.length; i += 3) {
        pos.push(gp[i], gp[i + 1], gp[i + 2]);
        nrm.push(gn[i], gn[i + 1], gn[i + 2]);
        col.push(c.r, c.g, c.b);
      }
      g.dispose();
      pc.g.dispose();
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return out;
  }

  /**
   * A box with its twelve edges rounded off to radius `r`.
   *
   * three has no rounded box in core, which is most of why this character had
   * none: under the old triangle ceiling a chamfer was a whole primitive's
   * worth of geometry spent on something nobody could see at 110px, and the
   * shoe -- the only part on the figure whose mass is a box -- kept its hard
   * corners. At the 163-208px the shipped frame actually gives him, and at every
   * angle but dead astern, a trainer with four square corners reads as a brick
   * with a dome glued on each end.
   *
   * Built by EXPLODING a sphere rather than by stitching six faces to twelve
   * edges to eight corners: each vertex is pushed out by (ex, ey, ez) in the
   * direction of the octant it is in, which drags the sphere's eight octants
   * apart and stretches the quads between them into the flat faces. Vertices
   * ON a symmetry plane are left where they are -- hence the epsilon, without
   * which a value like 6e-17 at theta = 90 degrees takes a sign at random and
   * slides one whole face sideways.
   *
   * Two properties matter and both are exact rather than approximate:
   *   - the EXTENTS are untouched. The sphere reaches its full radius on all
   *     three axes (widthSegments a multiple of four, heightSegments even), so
   *     the result measures w x h x d to the float. A chamfer that quietly
   *     grew the shoe would move the slide's half-width, which the outsole
   *     owns by 0.003.
   *   - the NORMALS are the sphere's own, which is what a rounded box wants:
   *     constant across each face, turning through 90 degrees along each edge.
   *     They are not renormalised because nothing here is scaled.
   * The faces come out very slightly domed -- 0.076r at the middle of a span,
   * so 0.002 on the shoe -- which is under a pixel at any size this is drawn
   * and gives the toon ramp something to curve a band across instead of a
   * dead flat plane.
   */
  function roundedBox(w, h, d, r, seg) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));
    const p = g.attributes.position;
    const ex = Math.max(0, w / 2 - r), ey = Math.max(0, h / 2 - r), ez = Math.max(0, d / 2 - r);
    const E = 1e-6;
    const sg = (v) => (v > E ? 1 : v < -E ? -1 : 0);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      p.setXYZ(i, x + sg(x) * ex, y + sg(y) * ey, z + sg(z) * ez);
    }
    return g;
  }

  // There is no single-primitive part() any more. The last two holdouts were
  // the thigh and the upper arm, and the wardrobe pass gave both of them
  // something welded on -- a hamstring and a triceps -- so every part on the
  // character is now a weld. That is the point rather than an accident: a
  // lone primitive is exactly the shape that reads as a raw primitive.
  function multi(pieces, steps) {
    const mat = S.toon(0xffffff, steps || 3);
    mat.vertexColors = true;
    return S.outlined(weld(pieces), mat, OUTLINE);
  }

  function pivot(parent, x, y, z) {
    const p = new THREE.Object3D();
    p.position.set(x || 0, y || 0, z || 0);
    parent.add(p);
    return p;
  }

  // ---- the race bib ------------------------------------------------------
  //
  // The one thing on the character that says "marathon" rather than "runner",
  // and it belongs on the back where the player can see it.
  //
  // It was a canvas texture on an open cylinder segment, and that made it the
  // only thing on the character with no ink line -- a stack of soft grey
  // anti-aliased numerals on an edgeless white card, sitting on the nearest
  // object in the frame while every hazard behind it wore a hard black rim. It
  // read as a sticker because it was built like one.
  //
  // Three things had to change and only one of them is the numerals:
  //
  //   IT NEEDS AN EDGE. `outlined()` extrudes a mesh along its own normals and
  //     draws the shell BACK-face-only, so an OPEN surface gets no line at all
  //     -- its shell faces away from the lens everywhere and is culled. That is
  //     why the panel never had one and why no amount of re-materialling would
  //     have given it one. So it is a closed SLAB now: an outer face, an inner
  //     face 0.014 behind it, and four rims joining them. The inner face and
  //     the rims are never seen; they exist so the silhouette exists.
  //
  //   IT NEEDS TO SHADE. One smooth cylinder segment facing dead astern puts
  //     every normal it owns into the same band of the toon ramp, so the panel
  //     came out as one flat value however the light moved. Twelve facets
  //     across the arc and four rims give the ramp something to break on, and
  //     the rims give the bottom edge a lit lip -- which is what says the panel
  //     is a piece of card lying on cloth and not a decal printed into it.
  //
  //   THE NUMERALS HAVE TO BE GEOMETRY. Not because it makes them legible: it
  //     does not, and that has to be said plainly. The panel is 0.252 wide,
  //     which against the 121-131 pixels per world unit figure.js measures at
  //     390x844 is 30-33px for the whole of "26.2" -- and 10px in landscape.
  //     (This read "17-31px", derived from the figure's height by proportion
  //     off the 110px number; the direct measurement is narrower and higher.)
  //     Across four glyphs at 7 cells each that is under two pixels a stroke in
  //     portrait and well under one in landscape, and NOTHING makes four glyphs
  //     legible in 31px. What geometry buys is that the one pixel is the RIGHT one: a hard
  //     dark stroke at full contrast rather than a minified texel averaged into
  //     grey, so at gameplay scale the bib reads as white card with definite
  //     print on it, and at the finish framing the number is crisp. Which is
  //     what a real race bib does at twenty metres and at two.
  //
  // The numerals are single-sided quads standing 0.0035 off the panel's outer
  // face, and being single-sided is load-bearing twice over: their own outline
  // shell is culled, so the print gets no ink of its own (a 0.014 rim around a
  // 0.015 stroke would swallow it whole), and they cost no closed volume.
  const BIB_A = 0.50;          // half-arc, radians
  const BIB_R0 = 0.268;        // radius at the top edge...
  const BIB_R1 = 0.258;        // ...and at the bottom, matching the vest's taper
  const BIB_H = 0.146;
  const BIB_T = 0.014;         // slab thickness
  const BIB_PROUD = 0.0035;    // how far the print stands off the face
  const BIB_NC = 12, BIB_NR = 3;
  // Nominal radius, so an amplitude in world units can be turned into the
  // radial scale that produces it.
  const BIB_R = 0.263;
  const BIB_PAPER = 0xfffdf5;
  const BIB_BACK = 0xd9d3c2;   // the reverse of the card; only ever edge-on
  const BIB_INK = 0x232046;

  // A 7x9 blocky face with two cells to a stroke. Coarser and "26.2" stops
  // fitting the panel; finer and a stroke stops holding a pixel -- 27 cells
  // across a 30-33px panel is 1.2px a cell, so two cells is a 2.3px stroke in
  // portrait and 0.8px in landscape, and the landscape frame is already the
  // one where this is print-shaped rather than legible.
  const BIB_GLYPH = {
    '2': ['0111110', '1100011', '0000011', '0000110', '0001100', '0011000', '0110000', '1100000', '1111111'],
    '6': ['0011110', '0110000', '1100000', '1111100', '1100110', '1100011', '1100011', '0110110', '0011100'],
    '.': ['000', '000', '000', '000', '000', '000', '000', '011', '011'],
  };
  const BIB_STR = '26.2';
  const BIB_GAP = 1;           // cells between glyphs
  // Where the print sits inside the panel, as fractions across and down it.
  const BIB_TU0 = 0.10, BIB_TU1 = 0.90, BIB_TV0 = 0.17, BIB_TV1 = 0.85;

  /**
   * The slab, its print, and nothing else. Returns a geometry carrying
   * position / normal / colour, ready for outlined() and a vertex-coloured
   * toon material -- the same contract weld() produces, built by hand because
   * no THREE primitive is a closed curved card.
   */
  function bibGeometry() {
    const pos = [], nrm = [], col = [];
    const c = new THREE.Color();

    // (u, v) run across and DOWN the panel; `o` is a radial offset off the
    // mid-surface, so +T/2 is the outer face and -T/2 the inner one.
    // u runs LEFT TO RIGHT AS THE PLAYER SEES IT, which is why the sign is
    // inverted: the panel faces -z, so screen-left is +x and a naive mapping
    // prints the number in mirror writing.
    function pt(u, v, o) {
      const a = (0.5 - u) * 2 * BIB_A;
      const r = BIB_R0 + (BIB_R1 - BIB_R0) * v + o;
      return [r * Math.sin(a), BIB_H * (0.5 - v), -r * Math.cos(a)];
    }
    function out(u) {
      const a = (0.5 - u) * 2 * BIB_A;
      return [Math.sin(a), 0, -Math.cos(a)];
    }
    // Winding is derived rather than reasoned about: the quad is emitted with
    // whichever order makes its geometric normal agree with `ref`. Getting a
    // face inside out here would punch a hole in the outline shell that only
    // shows from one angle, which is exactly the class of bug that is cheapest
    // to make impossible.
    function quad(p0, p1, p2, p3, ref, hex) {
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
      const bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      if (nx * ref[0] + ny * ref[1] + nz * ref[2] < 0) { const t = p1; p1 = p3; p3 = t; }
      const L = Math.sqrt(ref[0] * ref[0] + ref[1] * ref[1] + ref[2] * ref[2]) || 1;
      const n = [ref[0] / L, ref[1] / L, ref[2] / L];
      c.set(hex);
      const tri = [p0, p1, p2, p0, p2, p3];
      for (const p of tri) {
        pos.push(p[0], p[1], p[2]);
        nrm.push(n[0], n[1], n[2]);
        col.push(c.r, c.g, c.b);
      }
    }

    const H = BIB_T / 2;
    // Outer face: the only one anybody sees, and the only one subdivided.
    for (let i = 0; i < BIB_NC; i++) {
      const u0 = i / BIB_NC, u1 = (i + 1) / BIB_NC;
      const ref = out((u0 + u1) / 2);
      for (let j = 0; j < BIB_NR; j++) {
        const v0 = j / BIB_NR, v1 = (j + 1) / BIB_NR;
        quad(pt(u0, v0, H), pt(u1, v0, H), pt(u1, v1, H), pt(u0, v1, H), ref, BIB_PAPER);
      }
    }
    // Inner face, one row deep.
    for (let i = 0; i < BIB_NC; i++) {
      const u0 = i / BIB_NC, u1 = (i + 1) / BIB_NC;
      const o = out((u0 + u1) / 2);
      quad(pt(u0, 0, -H), pt(u1, 0, -H), pt(u1, 1, -H), pt(u0, 1, -H),
        [-o[0], 0, -o[2]], BIB_BACK);
    }
    // Top and bottom rims.
    for (let i = 0; i < BIB_NC; i++) {
      const u0 = i / BIB_NC, u1 = (i + 1) / BIB_NC;
      quad(pt(u0, 0, H), pt(u1, 0, H), pt(u1, 0, -H), pt(u0, 0, -H), [0, 1, 0], BIB_PAPER);
      quad(pt(u0, 1, H), pt(u1, 1, H), pt(u1, 1, -H), pt(u0, 1, -H), [0, -1, 0], BIB_PAPER);
    }
    // Side rims. The normal is the arc's own tangent turned outward.
    for (const [u, sg] of [[0, 1], [1, -1]]) {
      const a = (0.5 - u) * 2 * BIB_A;
      const ref = [sg * Math.cos(a), 0, sg * Math.sin(a)];
      for (let j = 0; j < BIB_NR; j++) {
        const v0 = j / BIB_NR, v1 = (j + 1) / BIB_NR;
        quad(pt(u, v0, H), pt(u, v1, H), pt(u, v1, -H), pt(u, v0, -H), ref, BIB_PAPER);
      }
    }

    // ---- the print -------------------------------------------------------
    // Cells are merged along a row into runs, but never more than three at a
    // time. A long run is a straight chord across an arc the panel underneath
    // is subdivided far more finely than -- and once the hem flutters, a chord
    // spanning a third of the panel dips further than the 0.0035 it stands
    // proud and the number sinks into the card.
    let cols = 0;
    for (let k = 0; k < BIB_STR.length; k++) {
      cols += BIB_GLYPH[BIB_STR[k]][0].length + (k ? BIB_GAP : 0);
    }
    const rows = BIB_GLYPH[BIB_STR[0]].length;
    const uOf = (cx) => BIB_TU0 + (BIB_TU1 - BIB_TU0) * (cx / cols);
    const vOf = (ry) => BIB_TV0 + (BIB_TV1 - BIB_TV0) * (ry / rows);
    let cx0 = 0;
    for (let k = 0; k < BIB_STR.length; k++) {
      const gl = BIB_GLYPH[BIB_STR[k]];
      if (k) cx0 += BIB_GAP;
      for (let r = 0; r < gl.length; r++) {
        const row = gl[r];
        let x = 0;
        while (x < row.length) {
          if (row[x] !== '1') { x++; continue; }
          let n = 0;
          while (n < 3 && row[x + n] === '1') n++;
          const u0 = uOf(cx0 + x), u1 = uOf(cx0 + x + n);
          const v0 = vOf(r), v1 = vOf(r + 1);
          const ref = out((u0 + u1) / 2);
          quad(pt(u0, v0, H + BIB_PROUD), pt(u1, v0, H + BIB_PROUD),
            pt(u1, v1, H + BIB_PROUD), pt(u0, v1, H + BIB_PROUD), ref, BIB_INK);
          x += n;
        }
      }
      cx0 += gl[0].length;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  // ---- contact shadow ----------------------------------------------------
  //
  // Every reference frame grounds its character with one and this one floated.
  // It is a painted blob on a ground quad, never a shadow map: the renderer
  // runs no shadow pass at all, and turning one on for a single character
  // would cost a whole extra render of the scene to get something a hand-drawn
  // gradient does better -- soft, cheap, and free to lie about its own size
  // when the runner leaves the ground.
  //
  // shading.js grew a shared contactShadow() while this was being written.
  // Prefer it, so the player, the record ghost and any prop that takes one all
  // get the same blob; keep the local copy so this file still builds against a
  // shading.js that predates it.
  let blobTex = null;
  function blobTexture() {
    if (blobTex) return blobTex;
    const N = 96;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    // Four stops, not two. A straight linear ramp reads as a grey disc with a
    // visible rim, and the rim is the thing that gives a painted shadow away;
    // holding it near-solid to a third of the radius and then falling off
    // fast is what makes it read as contact rather than as a decal.
    grd.addColorStop(0.00, 'rgba(255,255,255,1)');
    grd.addColorStop(0.34, 'rgba(255,255,255,0.88)');
    grd.addColorStop(0.66, 'rgba(255,255,255,0.30)');
    grd.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);
    blobTex = new THREE.CanvasTexture(cv);
    blobTex.minFilter = blobTex.magFilter = THREE.LinearFilter;
    blobTex.generateMipmaps = false;
    return blobTex;
  }

  // ---- the skid ----------------------------------------------------------
  //
  // Three passes at the slide pose all failed for the same reason, and it is
  // worth writing down because it is a geometry fact and not a matter of
  // taste: a feet-first slide points the legs straight down the view axis.
  // Measured on this rig, at this camera, throwing the feet a full 0.65 ahead
  // of the head moves them 0.027 of frame height up the screen. Every unit of
  // forward extension is worth almost nothing from directly behind, so no pose
  // can win this -- the axis is wrong, not the pose.
  //
  // What the axis is GOOD for is the other direction. Anything the runner
  // leaves BEHIND travels toward the lens, where perspective magnifies it
  // instead of collapsing it: a trail eleven units long fills the bottom third
  // of a portrait frame and widens as it comes. So the slide is sold by what
  // it puts on the road rather than by the silhouette -- a skid ribbon laid
  // down in world space under the hips, and dust thrown up off it.
  //
  // Both are single dynamic meshes with no outline pass, one draw call each,
  // and neither touches the collision silhouette or the pose the audit reads.
  // Both are sized off the chase distance rather than off how long a skid
  // "should" be. The camera sits 4.6 behind the runner in portrait and looks
  // down about 22 degrees, so the road it can see BEHIND him runs from his
  // hips to roughly 1.7-2.5 units back -- past that the mark is under the lens
  // or behind it. A trail eleven units long, which is what a real 0.55s slide
  // would lay down, spends four fifths of itself off camera and reads as
  // nothing. Four units, dense, is the whole visible budget.
  const SKID_N = 16;          // ribbon samples kept
  const SKID_STEP = 0.25;     // world units between samples -- 4.0 of trail
  const DUST_N = 112;
  // Road dust, not sparks. Warm enough to separate from the purple tarmac,
  // desaturated enough that it never reads as fire on the wild-west biome.
  const DUST_COLOR = 0xe8dcc4;
  // Matched to the contact shadow so the mark and the blob under the runner
  // read as one piece of grounding rather than two effects.
  const SCUFF_COLOR = P.contact === undefined ? 0x241d3d : P.contact;

  // The dust needs its own alpha profile, not the contact shadow's. That blob
  // is deliberately soft to the point of having no edge at all, which is right
  // for a shadow and wrong for a puff: thirty overlapping soft gradients
  // average into a flat haze, and haze reads as fog or lens glare rather than
  // as anything being thrown off a road. A near-solid core with a short rim
  // keeps each puff a countable object, which is how the reference games draw
  // dust and why theirs reads at a glance.
  let puffTex = null;
  function puffTexture() {
    if (puffTex) return puffTex;
    const N = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Lumpy rim: a perfect circle thirty times over reads as bubbles.
        const lobe = 1 + 0.10 * Math.sin(Math.atan2(dy, dx) * 3 + x * 0.03);
        const t = r / (0.86 * lobe);
        const a = t < 0.66 ? 1 : t < 1 ? Math.pow(1 - (t - 0.66) / 0.34, 0.7) : 0;
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    puffTex = new THREE.CanvasTexture(cv);
    puffTex.minFilter = puffTex.magFilter = THREE.LinearFilter;
    puffTex.generateMipmaps = false;
    return puffTex;
  }

  // Gradient along the ribbon: dense at the contact point, gone by the tail,
  // with a soft edge across the width so it never shows a rim. The streaks are
  // the difference between a smear and a skid -- a plain gradient reads as a
  // shadow, and grit lines running along the direction of travel are what say
  // the ground is moving under something.
  let skidTex = null;
  function skidTexture() {
    if (skidTex) return skidTex;
    const W = 128, H = 64;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    // Deterministic streaks: a texture that changes between runs would make
    // two screenshots of the same pose impossible to compare.
    const streak = [];
    for (let i = 0; i < 9; i++) streak.push(0.12 + (i * 0.37) % 0.76);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      // Flat across most of the width, feathered only at the very edges. A
      // sin-squared profile puts all its alpha in the middle half, which makes
      // a mark geometrically 1.1 wide read as barely 0.5 of visible scuff.
      const across = Math.pow(Math.sin(Math.PI * v), 0.55);
      let grit = 0;
      for (const s of streak) {
        const d = Math.abs(v - s);
        if (d < 0.038) grit += (1 - d / 0.038) * 1.05;
      }
      for (let x = 0; x < W; x++) {
        // u = 0 at the contact point, 1 at the oldest sample.
        const u = x / (W - 1);
        // Held flat, then dropped. Only the first half of the ribbon is ever
        // on screen -- the rest is under the lens or behind it -- so a falloff
        // that starts at the contact point spends the whole gradient on road
        // the player cannot see and leaves a thin line where the mark is.
        const along = u < 0.45 ? 1 : Math.pow(1 - (u - 0.45) / 0.55, 1.1);
        // Base band low, grit high: the eye should read individual scrape
        // lines being dragged up the road, not a uniform light panel -- a flat
        // pale rectangle on tarmac reads as glare or as a puddle.
        const a = Math.min(1, across * (0.34 + grit) * along);
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    skidTex = new THREE.CanvasTexture(cv);
    skidTex.minFilter = skidTex.magFilter = THREE.LinearFilter;
    skidTex.generateMipmaps = false;
    return skidTex;
  }

  // ---- jump and landing ---------------------------------------------------
  //
  // Subway Surfers spends as much on the VFX of a jump as on the pose, and the
  // frame strip says why: the pose is a wide bar for four frames and then it is
  // gone, while the streaks fire on the exact frame the feet leave the ground
  // and again on the frame they land. They are what make the two ENDS of the
  // arc legible, and the ends are the only parts a player has to time.
  //
  // Radial darts in the camera plane rather than trails in world space: from
  // directly behind, a trail drawn along the direction of travel points into
  // the lens and has no length on screen at all -- the same geometry fact that
  // defeated three passes at the slide. Anything drawn in the plane of the
  // screen keeps every unit of itself.
  const STREAK_N = 14;
  // Warm orange against a purple road, and it stays warm across all six biomes
  // because the roads only ever move between blue-violet and slate. Additive,
  // so it lifts whatever it crosses rather than stamping a colour on it.
  const STREAK_COLOR = 0xff9a2e;
  const STREAK_LIFE = 0.30;

  // A tapered dart: soft along its length, feathered across its width, tip
  // fading to nothing. Drawn once into a texture rather than built out of
  // per-vertex alpha because the taper has to survive a quad only a few pixels
  // wide on a phone, and vertex alpha across four corners cannot do that.
  let streakTex = null;
  function streakTexture() {
    if (streakTex) return streakTex;
    const W = 64, H = 32;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      const across = Math.pow(Math.sin(Math.PI * v), 0.7);
      for (let x = 0; x < W; x++) {
        // u = 0 at the root of the dart, 1 at the tip.
        const u = x / (W - 1);
        // Hot for the first fifth, then a long fade. A dart that is uniform
        // along its length reads as a stick; the fade is what makes it read as
        // something moving away from the character.
        const along = u < 0.18 ? 0.55 + u / 0.18 * 0.45 : Math.pow(1 - (u - 0.18) / 0.82, 1.5);
        const a = Math.max(0, Math.min(1, across * along));
        const i = (y * W + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    streakTex = new THREE.CanvasTexture(cv);
    streakTex.minFilter = streakTex.magFilter = THREE.LinearFilter;
    streakTex.generateMipmaps = false;
    return streakTex;
  }

  // The landing reticle's alpha: solid to the rim, then two pixels of feather.
  // This is the OPPOSITE of blobTexture() on purpose. A soft blob says "there
  // is a body somewhere above here"; a hard ellipse says "the feet come down
  // HERE", and that is the whole reason the reference draws one.
  let discTex = null;
  function discTexture() {
    if (discTex) return discTex;
    const N = 64;
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
        const r = Math.sqrt(dx * dx + dy * dy);
        // Rim slightly stronger than the core, which is what a real contact
        // shadow does under a body with limbs out and, more usefully, what
        // makes the ellipse read as a drawn target rather than as a stain.
        let a = 0;
        if (r < 0.80) a = 0.86;
        else if (r < 0.94) a = 1.0;
        else if (r < 1.00) a = 1.0 - (r - 0.94) / 0.06;
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    discTex = new THREE.CanvasTexture(cv);
    discTex.minFilter = discTex.magFilter = THREE.LinearFilter;
    discTex.generateMipmaps = false;
    return discTex;
  }

  // Sonic's shadow is the strongest of the three references and it is the one
  // to copy: at half strength over this road the blob was there in a still and
  // gone in motion, which buys nothing.
  const SHADOW_R = 0.46;
  const BASE_ALPHA = 0.58;
  function groundShadow() {
    if (typeof S.contactShadow === 'function') {
      return S.contactShadow(SHADOW_R, { opacity: BASE_ALPHA });
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SHADOW_R * 2, SHADOW_R * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: P.contact === undefined ? 0x241d3d : P.contact,
        map: blobTexture(),
        transparent: true,
        opacity: BASE_ALPHA,
        depthWrite: false,     // overlapping blobs blend instead of z-fighting
        side: THREE.DoubleSide,
      })
    );
    mesh.position.y = 0.015;   // clear of the road paint, which sits at 0.006
    mesh.renderOrder = 2;
    return mesh;
  }

  function create() {
    const root = new THREE.Group();
    const body = pivot(root, 0, 0, 0);

    // ---- torso ----------------------------------------------------------
    // The trunk is a truncated cone, not a capsule: a hard flat shoulder line
    // wider than the head is half of what separates the two from behind.
    // Shorts sit inside the vest where they overlap, in both x and z, or the
    // vest's hem shows only at the hips and reads as two yellow pockets.
    const hips = pivot(body, 0, HIP_Y, 0);
    const spine = pivot(hips, 0, 0, 0);

    const pelvis = multi([
      { g: new THREE.CylinderGeometry(0.228, 0.220, 0.25, R_TORSO), c: P.runnerShort, y: -0.020, sz: 0.78 },
      // There is no waistband here any more. It stays out -- but NOT for the
      // reason that was written here, and the difference is worth the space
      // because the old reason would have been overturned by the first agent
      // who measured it.
      //
      // What this note used to say: "at gameplay scale a 3px band of a near
      // tone directly beneath a huge hard edge does not add a garment, it blurs
      // the one that was already there". Both halves of the premise are false.
      // Built and counted by tools/resolve.js on the real chase frame, the band
      // is 6-11px tall in a column, 16px of screen extent, and owns 299 pixels
      // of a 390x844 frame -- SEVEN AND A HALF TIMES the 39 pixels of the short
      // cuff two hundredths of a unit below it, which was kept and is agreed to
      // read. And it is not a near tone: it renders at L 42.5 against shorts at
      // L 25.1, a 1.69x step, and that is EXACTLY the tone the short cuff
      // renders at (L 42.4). The two bands are the same band. One was removed
      // for being invisible and the other kept, and nothing about them differs.
      //
      // The fault is real and it is one neighbour up. The band was aimed at the
      // wrong edge: it does not blur the vest/shorts boundary by being close in
      // value to the SHORTS, it destroys that boundary by being close in value
      // to the VEST HEM directly above it. JACKET and WAIST are 1.20x apart as
      // authored, and after the toon ramp they are nearer still. Rendered and
      // measured across the 11 columns where nothing else overlaps, the value
      // step from the hem to whatever lies under it goes
      //
      //     1.83x  without the band        1.08x  with it
      //
      // -- a 41% cut, landing under the 12% floor this file states two screens
      // up as the point where a tone lands in the same band of the ramp as its
      // neighbour and the hem simply is not there. The largest value edge on
      // the lower half of the character is the one thing the two-garment read
      // is carried by, and the band eats it. So the old conclusion survives its
      // own argument being wrong, which is luck rather than method.
      //
      // A DARKER band would deepen that step instead of filling it, and might
      // well earn its place. That is a new part rather than a restored one and
      // is not attempted here.
      //
      // The short's own cuff at the leg opening stays, and the difference is
      // the whole reason one went and one did not: the cuff's edge is against
      // SKIN, not against more navy, so it is doing what the waistband was
      // only claiming to do. The thighs come out of a hem rather than a hole.
      // Straddles the shorts' bottom edge on purpose: a band that stops short
      // of it leaves a sliver of the old hard cut still showing under it.
      { g: new THREE.CylinderGeometry(0.236, 0.230, 0.044, R_TORSO), c: WAIST, y: -0.126, sz: 0.79 },
    ]);
    spine.add(pelvis);

    // The whole silhouette is built backwards from one measurement: the
    // shoulder line has to stop 0.11 below the skull. See rule 1 in the
    // header -- roughly half of that is spent on the skull's own projected
    // overhang before the neck sees any of it.
    const chest = pivot(spine, 0, CHEST_Y - HIP_Y, 0);
    const trunk = multi([
      // Vest. Nothing on the trunk may reach above the deltoids -- an earlier
      // version had it poking 0.03 higher and the head went straight back to
      // sitting on the shoulders. Short and barely tapered on purpose: a
      // singlet worn over the shorts, so the red reads as one wide squat
      // block the way the reference shirts do rather than as a torso.
      { g: new THREE.CylinderGeometry(0.262, 0.238, 0.28, R_TORSO), c: P.runnerVest, y: -0.037, sz: 0.78 },
      // Deltoids. These are what make the shoulder line read wider than the
      // head; without them the trunk cone tapers into the skull. Flattened
      // hard in Y so they widen the shoulders without raising them. Their
      // outer edge is the 0.78 shoulder measurement constants.js cuts the
      // lane width from -- move them and the whole track has to move.
      { g: new THREE.SphereGeometry(0.140, R_LIMB, 16), c: P.runnerVest, x: -0.244, y: 0.002, sy: 0.76, sz: 0.84 },
      { g: new THREE.SphereGeometry(0.140, R_LIMB, 16), c: P.runnerVest, x: 0.244, y: 0.002, sy: 0.76, sz: 0.84 },
      // No shoulder-blade bumps: the race bib is a panel standing proud of
      // the vest and it covers the entire area they would have shown in.
      //
      // Collar. A bound neckline, not a stand-up collar: it has to stay under
      // the deltoid line (0.108) or the head starts sitting on the shoulders
      // again, and a ring standing proud ABOVE the vest was tried on paper and
      // costs 0.019 of the 0.112 head/shoulder gap, which is a fifth of the
      // pinch the whole silhouette is built around. Dark rather than light for
      // the same reason the hair is: the ladder from the crown down has to run
      // dark / light / dark, and the lit neck needs something dark UNDER it as
      // well as over it or it bleeds into the vest.
      //
      // sz 0.7812 rather than the 0.79 it was, and it is the inscribed-polygon
      // correction rather than a design change. At twelve segments the ring's
      // nearest vertex to the chest's +z sat at theta 0 or 30 degrees; at
      // twenty-four there is one at 15, and in a SLIDE -- where the trunk lies
      // back far enough that the chest's own +z is very nearly world up -- that
      // new vertex became the highest point on the whole character and lifted
      // the slide's crown 0.0022. The squash is taken back out of the FRONT of
      // the collar, which is the one part of this ring no camera in the game
      // ever sees: the chase view reads its back and its sides, and the finish
      // reads it from three-quarters. It still stands 0.0034 proud of the vest
      // in z and the full 0.004 in x, so the value break is untouched.
      { g: new THREE.CylinderGeometry(0.266, 0.259, 0.026, R_TORSO), c: JACKET, y: 0.088, sz: 0.7812 },
      // Hem. The vest used to end on a hard cut into the shorts, which is what
      // made the trunk read as one moulded mass from the neck to the knees.
      { g: new THREE.CylinderGeometry(0.244, 0.242, 0.030, R_TORSO), c: JACKET, y: -0.166, sz: 0.79 },
    ]);
    chest.add(trunk);

    // ---- the hood, and the only part of this character that is not bolted
    // to a bone --------------------------------------------------------------
    //
    // A previous review named secondary motion as the biggest remaining gap in
    // the character, and it is the right call: everything else here is welded
    // rigidly to a joint, so every part of the figure starts and stops on the
    // same frame and the whole thing moves like a marionette. Cloth does not.
    //
    // The hood is the piece that can carry it, because it is the one garment
    // the back view sees in full and it hangs off the collar rather than off a
    // bone. It is a torus arc laid flat around the base of the neck -- a hood
    // pushed down, which is exactly what the reference wears -- rather than a
    // lump on the back, because a lump would cover the race number and the
    // slot between the collar (0.103) and the top of the bib is only 0.09
    // deep. Ring geometry uses that slot end to end instead of fighting it.
    //
    // The arc is rotated in its own plane FIRST (rz) and then laid flat (rx):
    // weld() composes Euler XYZ, so rz is the innermost rotation, and doing it
    // the other way round yaws the finished ring instead of sliding the arc
    // round it. The arc is 234 degrees centred on the spine, so it wraps the
    // neck and dies out under the deltoids.
    // Navy, not the vest's red, and that is a deliberate second try. In JACKET
    // the roll rendered as "the top of the vest": a hood is a separate GARMENT
    // and it has to be a separate colour or it is just a thicker collar. Navy
    // also puts a dark mass directly beneath the lit neck, which is the half of
    // the head/shoulder pinch this figure never had -- the ladder now runs dark
    // hair / lit neck / dark hood / red vest, with the neck pinched from both
    // sides instead of only from above.
    //
    // WAIST rather than the shorts' own darker navy, which was the third try:
    // at the shorts' value the hood, the hair and the shorts made three near-
    // black masses on a figure the references keep light, and the shoulders
    // were the heaviest thing in frame. One step up is still unambiguously
    // dark against the neck, and it pairs WAIST with the short cuff at the
    // other end of the figure, which is the rhythm TRIM already runs.
    const hoodPivot = pivot(chest, 0, 0.048, -0.045);
    const hood = multi([
      // sz, not sy: weld() composes T*R*S, so the squash lands on the geometry
      // BEFORE it is laid flat, and the tube's axis is still the original z.
      // Squashing y here would flatten the ring instead of the roll.
      //
      // 0.0704, not the 0.074 it was, and the change is exactly the inscribed-
      // polygon correction the segment note warns about. The roll used five
      // radial segments, so its highest vertex sat at 0.074*sin(72deg) = 0.0704
      // and the crown of a slide -- the one pose where this roll IS the top of
      // the character -- was measured against that. Ten segments put a vertex
      // on the top of the tube for the first time and the slide's crown rose
      // 0.0022 for free. The tube is shrunk back to what the pentagon actually
      // measured, so the roll is round now at the same size it always was.
      { g: new THREE.TorusGeometry(0.180, 0.0704, 10, 26, Math.PI * 1.30), c: WAIST,
        rx: -Math.PI / 2, rz: -0.42, sz: 0.76 },
    ]);
    hoodPivot.add(hood);

    // Curved rather than a flat card so it hugs the vest at this size, tapered
    // to match the vest's own cone so the wider top of the vest cannot poke
    // through the number, and hung so it clears BOTH neighbours: the hood roll
    // ends around -0.008 in chest space and the vest hem starts at -0.151, so
    // the panel runs 0.000 to -0.146 and touches neither. The number is the one
    // piece of type on the character; a hood crossing its top edge or a hem its
    // bottom would read as a printing fault rather than as cloth.
    //
    // Straddling the vest/shorts line was the other half of the review's
    // finding and it is a symptom, not a cause -- see the flutter below, which
    // used to drive the bottom corners INWARD through the vest on half of every
    // cycle. What showed was the red of the vest cutting across the white card
    // in a wave, which looks exactly like a panel hung crooked over a hem.
    const bibGeo = bibGeometry();
    const bibMat = S.toon(0xffffff, 3);
    bibMat.vertexColors = true;
    const bib = S.outlined(bibGeo, bibMat, OUTLINE);
    bib.position.y = -0.073;
    bib.scale.z = 0.78;
    chest.add(bib);

    // The bib's own flutter, precomputed. It is a paper panel pinned along its
    // top edge and held flat in the middle by the back behind it, so the free
    // CORNERS of the hem are the only part that can lift -- which is also the
    // only part with an edge against the vest for the eye to track. Weight
    // falls off as the square of the height so the top row never moves and the
    // texture cannot shear.
    //
    // Rewritten in place each frame -- fill and ink shell share the buffer, so
    // the outline flutters with the card rather than staying behind on the
    // vest. The rest pose is kept because the deformation has to be absolute
    // rather than incremental: an incremental one accumulates float error over
    // a 2-hour race and the panel slowly inflates off the vest.
    const bibPos = bibGeo.attributes.position;
    const bibRest = new Float32Array(bibPos.array);
    const bibWeight = new Float32Array(bibPos.count);
    const bibTheta = new Float32Array(bibPos.count);
    {
      let yLo = Infinity, yHi = -Infinity;
      for (let i = 0; i < bibPos.count; i++) {
        const y = bibRest[i * 3 + 1];
        if (y < yLo) yLo = y;
        if (y > yHi) yHi = y;
      }
      for (let i = 0; i < bibPos.count; i++) {
        const v = (bibRest[i * 3 + 1] - yLo) / (yHi - yLo);
        // Angle around the panel, zero at its centre line.
        const a = Math.atan2(bibRest[i * 3], -bibRest[i * 3 + 2]);
        bibTheta[i] = a;
        bibWeight[i] = (1 - v) * (1 - v) * Math.min(1, Math.abs(a) / 0.42);
      }
    }
    // Nominal panel radius, so an amplitude in world units can be turned into
    // the radial scale that produces it.
    //
    // The geometry's bounding box and sphere are deliberately never
    // recomputed after a deformation. Box3.setFromObject() caches whatever it
    // finds on the first call, so the road clamp below sees a bib frozen at
    // one flutter phase -- which is what it should see: the clamp has to be a
    // stable function of the POSE, and a limit that jittered with a piece of
    // cloth would make the whole body twitch. The panel is on the upper back
    // and is never the lowest part of anything, so the 0.04 it is out by can
    // never reach the answer.

    // Secondary-motion state. Two springs for the hood and a free-running
    // clock for the bib; see the block at the end of update() for why they are
    // integrated rather than driven straight off the stride phase.
    let hoodA = 0, hoodV = 0, hoodZ = 0, hoodZV = 0, lastBob = 0, bibT = 0;
    // STAGE 2. Three more filters: one per elbow, and one for the head.
    //
    // Seeded lazily rather than at zero. A filter that starts at 0 against an
    // elbow resting at -1.32 spends its first 90 ms hauling itself out of a
    // pose the character never holds, and that transient is not merely ugly on
    // frame one -- tools/stride.js starts its sweep from whatever state it
    // finds, so the transient lands inside the min/max box and shows up as
    // travel the cycle does not have. `null` means "not yet running"; the first
    // frame plants each filter on its own drive.
    let elbF = [null, null], elbV = [0, 0], headRF = null, headRV = 0;
    // STAGE 3. The surge signal's two filters. `accSp` is a smoothed grade-free
    // ground speed and `accA` its smoothed derivative; `accPrimed` is what stops
    // ?skip= from opening a deep-race screenshot on a phantom 6 u/s surge that
    // never happens in a real run. Same three-part shape camera.js uses, and for
    // the same reason -- see SURGE_FULL and the block in update().
    let accSp = 0, accA = 0, accPrimed = false;

    // ---- head -----------------------------------------------------------
    // The neck pivot sits at the top of the trunk so head tilt rotates from
    // the base of the neck; the neck column itself rides with the head.
    const neck = pivot(chest, 0, NECK_Y - CHEST_Y, 0);
    const head = pivot(neck, 0, 0, 0);
    const HY = HEAD_Y - NECK_Y;

    const headMesh = multi([
      // Bare neck: 0.24 across against a 0.78 shoulder line and a 0.57 skull,
      // and lit skin between the dark hair above and the red vest below. The
      // order of those three values is the entire fix. Leaving the nape skin
      // and the hair on the crown gave a light head sitting on a light neck --
      // one continuous mass with no pinch. Dark / light / saturated reads.
      // Long enough to start inside the vest so no gap opens on a head tilt.
      { g: new THREE.CylinderGeometry(0.104, 0.122, 0.32, R_LIMB), c: P.runnerSkin, y: HY - 0.300 },
      // The fillet under the jaw, and it is the answer to "the neck is a plain
      // cylinder the head sits on top of".
      //
      // The corner is real and it is geometric: at HY - 0.244 the skull's own
      // radius is 0.1334 and the neck's is 0.1099, so the head OVERHANGS the
      // neck by 0.024 and the two surfaces meet in a concave crease. No sphere
      // can fill a concave corner -- every mass this file has ever added is
      // convex and would sit inside one -- which is why the junction survived
      // four passes looking like a ball resting on a tube. A torus can, and
      // this is the only torus on the character apart from the hood.
      //
      // It is an ARC of 200 degrees centred on the FRONT, not a ring, and that
      // restriction is rule 1 in this file's header being obeyed rather than
      // worked around: nothing may be added to the back of the head or to the
      // nape, because the whole silhouette is built on the head pinching away
      // from the shoulders and on the value ladder dark hair / lit neck / dark
      // hood running uninterrupted down the back. The crease that reads as a
      // fault is the one under the JAW, which is the half of the junction the
      // start panel and the finish see; the half behind is doing a job.
      //
      // Sized so its outer surface lands on 0.135 against the skull's own
      // 0.1334 -- it fills the corner and does not widen the neck by anything
      // the eye or tools/envelope.js can find.
      // rz then rx, and the ORDER is why the hood's note two hundred lines up
      // spells it out: weld() composes an Euler in XYZ, so rz is the innermost
      // rotation and slides the arc round its own ring, while rx lays the ring
      // flat afterwards. Doing it the other way yaws a finished ring instead.
      // The arc's midpoint sits at half its span from +X, so rz carries that
      // to -Y, which rx = -pi/2 then maps to +Z. Get either wrong and the
      // fillet ends up round the NAPE, which is the one place it may not be.
      { g: new THREE.TorusGeometry(0.111, 0.024, 8, 20, Math.PI * 1.11), c: P.runnerSkin,
        y: HY - 0.244, rx: -Math.PI / 2, rz: Math.PI * 0.945 },
      // The sternocleidomastoids. Two ridges running from behind the ear down
      // to the notch, which are the only muscles a neck shows at this size and
      // the reason a neck is not a dowel. 0.022 proud of the cylinder at their
      // widest and nowhere near its own outline: they reach x 0.083 on a neck
      // whose radius there is 0.114, so they are pure interior form and the
      // ramp is what draws them.
      { g: new THREE.SphereGeometry(0.052, R_NUB, 10), c: P.runnerSkin,
        x: -0.052, y: HY - 0.317, z: 0.078, sx: 0.60, sy: 1.70, sz: 0.55, rz: -0.16 },
      { g: new THREE.SphereGeometry(0.052, R_NUB, 10), c: P.runnerSkin,
        x: 0.052, y: HY - 0.317, z: 0.078, sx: 0.60, sy: 1.70, sz: 0.55, rz: 0.16 },
      { g: new THREE.SphereGeometry(0.266, R_HEAD, 24), c: P.runnerSkin, y: HY, sy: 1.06, sz: 0.97 },
      // The cap. Geometrically this is the same shell that used to be the hair
      // crown -- the fit was already right and the note below is still the
      // reason for every number in it -- but it is now the vest's red, which
      // turns it from "the top of a head" into "a garment on a head". A cap is
      // the single most legible thing the reference puts on its characters
      // from behind, and it costs nothing: no vertex moved.
      //
      // 0.288, not the 0.280 it was: the
      // skull under it is r=0.266 scaled 1.06 in Y, so its pole reached 0.282
      // and punched a coin-sized disc of SCALP through the middle of the hair.
      // It was there in every frame ever shot of this character and only became
      // obvious once the slide started presenting the crown to the camera --
      // the tucked head rendered as a dark cap with a tan rivet in it. Still
      // inside the headband's 0.294, which is the other clearance that matters.
      { g: new THREE.SphereGeometry(0.288, R_HEAD, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), c: CAP, y: HY },
      // ...and a rear-only shell that carries the hair down to the nape but
      // leaves the face clear. Restricting phi to the back 210 degrees is
      // what lets one primitive do a haircut. It now reads as the hair showing
      // BELOW a cap rather than as the whole head of hair, which is why the
      // nape below matters more than it used to.
      //
      // phiStart moved 0.33pi -> 0.40pi, and this is a real bug fix rather
      // than a tidy-up. The hair shell is r=0.286 and the crown shell is
      // r=0.288, so through the whole band they used to overlap 0.002 apart --
      // two surfaces closer together than a float is willing to sort -- and
      // their facets interpenetrated in a ring. That was INVISIBLE while both
      // were the same hair colour and became a row of red-and-black teeth the
      // moment the crown became a cap. Starting the hair at 0.40pi puts its
      // top edge at y=0.088, under the band's 0.097, so the band covers the
      // join and the two shells never share a height again. Same class of
      // error as the crown punching a coin of scalp through the hair; the
      // lesson is that a colour change can expose geometry that was always
      // wrong.
      { g: new THREE.SphereGeometry(0.286, 24, 12, Math.PI * 1.5 - 1.83, 3.66, Math.PI * 0.40, Math.PI * 0.37), c: P.runnerHair, y: HY },
      // The hairline. The hair shell ends on a clean latitude arc, which is a
      // haircut no human has: what the back view of a real head shows is the
      // hair narrowing to a taper down the middle of the neck. 0.14 across and
      // 0.14 long, standing 0.018 proud of the neck cylinder so it is a shape
      // rather than a decal, and it is the single detail that most turns the
      // head/neck junction from an assembly into an anatomy.
      { g: new THREE.SphereGeometry(0.090, R_NUB, 12), c: P.runnerHair, y: HY - 0.225, z: -0.058, sx: 0.62, sy: 1.05, sz: 0.85 },
      // Cap band, sitting above the eye line -- lower and it reads as goggles.
      // Unchanged: it was the headband and it is now the cap's sweatband, and
      // holding its exact geometry is what keeps the measured value ladder
      // (dark / bright / dark / lit neck) untouched by all of this.
      // Radius has to clear the shells everywhere: two this close together
      // interpenetrate on their facets and the crown grew a row of teeth.
      { g: new THREE.CylinderGeometry(0.294, 0.294, 0.074, R_HEAD), c: TRIM, y: HY + 0.060 },
      // The peak, and it is at the FRONT, where a running cap's peak is.
      //
      // It used to be worn backwards, on the argument that a forward peak
      // points down the view axis and is therefore not worth drawing. That
      // argument is sound about what a backward peak BUYS and silent about
      // what it COSTS, and the cost was the defect: a shelf standing 0.12
      // proud of the hair at the back, below the sweatband, drawing as a red
      // block on the black hair in every frame of every race. The chase
      // camera looks at the back of this head for two hours. The one thing
      // that may never be wrong is the back of the head.
      //
      // So the peak is now judged by two tests instead of one:
      //   FRONT   it has to read from the three-quarter and front views, which
      //           are what the start panel and the finish framing show, and
      //           it is the single most legible thing a cap has from there.
      //   ASTERN  it has to be INVISIBLE from behind -- not small, not subtle,
      //           not the same colour as what is behind it. Zero pixels.
      // The second test is measured rather than judged (see the report): the
      // peak's fill is recoloured and counted from dead astern and from the
      // chase angle, and the whole head is diffed against a build with the
      // peak collapsed to a point. Both come back at zero.
      //
      // The geometry is what makes that free. The peak is a half-disc lying
      // in the FRONT half (thetaStart -pi/2), so nothing of it exists behind
      // the skull's equator at all; the crown, the hair shell and the band are
      // then a solid occluder 0.53 across standing between it and the lens.
      //
      // The old note's real lesson is kept, and a second one had to be learned
      // next to it. A round half-disc concentric with the skull is the one
      // shape that CANNOT be used, because it leaves the skull almost
      // tangentially and spends a long arc within one ink width of it -- three
      // surfaces inside 0.014 and the outline punches through both in a row of
      // dark wedges. But TANGENCY, not roundness, is the actual fault, and the
      // first front-facing version reinvented it from the other side: drooped
      // 0.24rad it left the head through the BAND'S FLAT UNDERSIDE at 13
      // degrees, which is a grazing crossing 0.059 wide, and the teeth came
      // straight back.
      //
      // So the plate is sized to the band rather than to the skull. It is
      // 0.022 thick and rides at the band's own mid-height, which leaves 0.024
      // of clear air above it and 0.028 below inside a band 0.074 tall -- both
      // comfortably over one ink width -- and it is held nearly level (0.06rad)
      // so it still has 0.015 of that clearance where it passes out through the
      // band's VERTICAL wall, which a level plate crosses at eighty degrees.
      // Every other surface it meets on the way (the skull, the hair) it meets
      // deep inside the band, where nothing is drawn. Its own flat edge sits
      // 0.025 inside the skull at z=0.08 and is never seen from any angle.
      //
      // Level, not cocked: the original note's argument survives the flip.
      // What a peak has to be from the quarter view is a hard horizontal plane
      // cutting the round skull, and a peak angled down enough to read as
      // "pulled over the eyes" from the front reads as a stripe from anywhere
      // else. Held level it overhangs 0.17 past the face, which is the whole
      // of what makes it a peak.
      //
      // Width is free and is taken. The disc's widest points are its flat
      // edge, buried at z=0.08, so what actually leaves the band is the arc:
      // it emerges 0.48 across at x=+-0.242 and tapers to a point 0.26 further
      // forward, which is the shape of a peak rather than a shelf. Because it
      // emerges ON the band's own cylinder it can never be wider than the band
      // is, so it costs the half-width nothing at all.
      //
      // JACKET rather than the crown's own red, unchanged and for the
      // unchanged reason: the peak is a plane seen against the dome behind it
      // and a plane the same colour as its background is a shape with no edge.
      { g: new THREE.CylinderGeometry(0.250, 0.250, 0.022, R_TORSO, 1, false, -Math.PI * 0.5, Math.PI), c: JACKET,
        y: HY + 0.062, z: 0.080, rx: 0.06, sz: 1.40 },
      { g: new THREE.SphereGeometry(0.080, R_NUB, 12), c: P.runnerSkin, x: -0.254, y: HY - 0.020, z: -0.013, sx: 0.48, sz: 0.82 },
      { g: new THREE.SphereGeometry(0.080, R_NUB, 12), c: P.runnerSkin, x: 0.254, y: HY - 0.020, z: -0.013, sx: 0.48, sz: 0.82 },
      // THERE IS NO CONCHA IN THE EAR, and it is not for want of trying.
      //
      // The ear is a skin nub on a skin skull -- one tone, so the toon ramp
      // gives it one band and from most angles it is a lump rather than an
      // ear. The obvious fix is the one the heel counter won on: an ear is a
      // form with a HOLE in it and the hole is the readable part. So a bowl
      // one value step down was built, inset in x so the ear's outer edge --
      // 0.2924 from the spine, second only to the cap band's 0.294 -- was
      // untouched to the float.
      //
      // tools/resolve.js counted it at ZERO pixels in 48 of 48 frames through
      // BOTH lenses, the chase camera and the face lens. Inset in x on an
      // ellipsoid does not mean behind it, it means INSIDE it: the nub's outer
      // pole is at 0.2924 and every point of the bowl was under that surface.
      // Same class as the lace panel, found the same way, and the arithmetic
      // that would have caught it is not hard -- which is exactly why it has to
      // be measured instead.
      //
      // Nor is it rescuable. A bowl proud enough to clear the nub by one ink
      // width is a bowl standing 0.026 out of the ear, which is a bump and not
      // a hollow; and a flat decal on the ear's outer face has to sit past the
      // pole at 0.2935 to be in front of the surface everywhere, which is
      // 0.0005 inside the cap band and is not a clearance anyone should ship.
      // At the 70 px this head is drawn at, an ear has no interior.
      // ---- the face ------------------------------------------------------
      //
      // The skull was one smooth ovoid with two discs on it, and the owner's
      // word for it was "mannequin". What follows is not more detail: it is
      // the four PLANES a head has, built at the size they are seen at.
      //
      // Where they can go is decided for them, and by the cap. The band is a
      // cylinder 0.074 tall whose underside sits at HY + 0.023, and the eye
      // discs reach HY + 0.040 -- so the top 0.017 of each eye is already
      // behind the band and there is NO BROW LINE on this character to build
      // on. That is not a defect to route around, it is what wearing a cap
      // pulled down is; the band IS his brow, and it is why the expression
      // work later in this file drives the eye's own aperture rather than a
      // pair of brows that would be drawn inside a hat.
      //
      // Everything here is skin, welded into the head, and shaded by the same
      // ramp as the skull. That is the whole reason it is geometry and not a
      // texture: a plane that the light finds is a plane at every angle the
      // orbit puts the head through, and a painted one is a plane at one.
      //
      // Every piece is checked against TWO clearances rather than one:
      //   PROUD    it has to stand more than one ink width (0.014) out of the
      //            skull where it emerges, or the two surfaces spend an arc
      //            within the outline's own thickness and grow the row of dark
      //            teeth this file has now recorded three times -- the hair on
      //            the crown, the cap peak on the band, the wristband on the
      //            mitt. Every clearance below is 0.020 or better.
      //   INSIDE   it has to stay inside the skull's own x extent of 0.266,
      //            because the head's contribution to the figure's half-width
      //            is the cap band's 0.294 and nothing on the face may be
      //            allowed to become the widest thing on the character in a
      //            slide, where the head is yawed and the margin is smallest.
      ...faceMass(HY),
    ]);
    head.add(headMesh);

    // ---- the eyes --------------------------------------------------------
    //
    // Flat and unlit, which is unchanged and is the one thing about them that
    // was already right: an eye that catches the toon ramp's specular reads as
    // a wet marble stuck on the face, and an eye that BANDS across the ramp
    // reads as a crescent moon whenever the head turns.
    //
    // What changed is that there is now an eye inside the eye. It was one ink
    // disc, and one disc is a dot -- the construction a face gets when nobody
    // has decided whether it has eyelids. Four rings now, outward in:
    //
    //   SCLERA     an ALMOND, not a circle: 0.064 across and 0.055 tall. The
    //              aspect is the whole of what separates an eye from a dot,
    //              and it costs nothing because the iris covers the middle of
    //              it -- what shows is a sliver of white at each corner, which
    //              is exactly what the eye reads off.
    //   IRIS       0.048, so it fills three quarters of the opening. That is
    //              deliberate and it is the identity guard: at the 50-67 px
    //              this character is drawn at in landscape the sclera slivers
    //              are under a pixel and the whole assembly averages back to
    //              the dark oval it has always been. He does not become a
    //              different character at distance; he becomes a built one up
    //              close.
    //   PUPIL      ink, 0.024, and it is what the eye POINTS with.
    //   CATCHLIGHT 0.013, off-centre high and inboard. The single highest-value
    //              mark on the whole face: it is the only thing on this
    //              character that says the eye is wet, and every reference
    //              frame in reference/ has one. It is inboard rather than
    //              outboard so that both of them are visible together through
    //              the three-quarter views, which are the ones the start panel
    //              and the finish actually show.
    //
    // Stacked at 0.002 in z rather than being made coplanar. Coplanar rings
    // z-fight, and the depth buffer's precision at the 3.4 units the orbit
    // sheet shoots from is about 1.4e-5, so 0.002 is two orders of margin --
    // while being far too small to read as a stack from any angle.
    //
    // The whole thing stays ONE mesh and therefore one draw, which is the
    // budget line that actually binds on this character.
    const eyes = new THREE.Mesh(weld(eyePieces(HY)), S.flat(0xffffff, { vertexColors: true }));
    head.add(eyes);

    // The mouth is its own flat mesh rather than a weld into the eyes, and the
    // reason is expression: the eyes narrow and the mouth opens, and those are
    // two different scales on two different pivots. One draw, and it is the
    // only one the face pass spends.
    const mouthPivot = pivot(head, 0, HY - 0.150, 0.196);
    const mouth = new THREE.Mesh(weld(mouthPieces()), S.flat(0xffffff, { vertexColors: true }));
    mouthPivot.add(mouth);

    // ---- limbs ----------------------------------------------------------
    // Short bones, oversized terminals. That split is the whole trick in the
    // reference characters: the limbs themselves are unremarkable tubes and
    // it is the mitts and the trainers on the ends of them that carry both
    // the toy read and, from behind, all of the readable motion. Thickening
    // the bones instead just makes a stocky adult.
    const legs = [];
    const arms = [];

    for (const side of [-1, 1]) {
      // leg
      const hip = pivot(hips, side * 0.128, -0.045, 0);
      // Hamstring, the same argument as the calf: from directly behind a leg
      // is two muscles and a tube is neither. It is fatter than the capsule
      // only in z -- 0.026 proud at the back, nothing at the sides -- so it
      // adds form the ramp can shade without touching the width the lane
      // budget is measured on.
      const thigh = multi([
        { g: new THREE.CapsuleGeometry(0.114, 0.100, 6, R_LIMB), c: P.runnerSkin },
        { g: new THREE.SphereGeometry(0.120, R_NUB, 12), c: P.runnerSkin, y: 0.052, z: -0.020, sx: 0.93, sy: 1.02 },
      ]);
      thigh.position.y = -0.108;
      hip.add(thigh);

      const knee = pivot(hip, 0, -0.215, 0);
      // Sock welded onto the shin: a pale band low on the leg makes the
      // scissor of the run cycle legible from directly behind.
      const shin = multi([
        { g: new THREE.CapsuleGeometry(0.096, 0.050, 6, R_LIMB), c: P.runnerSkin, y: -0.076 },
        // The joint itself, sitting exactly on the pivot. The recovery knee
        // flexes to 1.48rad and at that angle two straight capsules meeting at
        // a point open a visible notch on the outside of the bend -- the leg
        // read as two parts hinged rather than as a leg. A ball on the pivot
        // is always the joint whatever the angle, and it is skin-coloured
        // because a knee is not a garment: it adds FORM for the ramp to catch,
        // not a new value.
        { g: new THREE.SphereGeometry(0.098, R_NUB, 12), c: P.runnerSkin, sz: 0.94 },
        // Calf. The one muscle the back view actually sees, and the reason a
        // straight tube reads as a doll's leg: a human shin is thickest just
        // under the knee and tapers to nothing at the ankle. Kept inside the
        // thigh's radius at rest so it only emerges as the knee bends, which
        // is exactly when a calf should show.
        { g: new THREE.SphereGeometry(0.101, R_NUB, 12), c: P.runnerSkin, y: -0.055, z: -0.012, sx: 0.92, sy: 1.20, sz: 0.94 },
        { g: new THREE.CylinderGeometry(0.110, 0.102, 0.085, R_LIMB), c: P.runnerShoe, y: -0.118 },
      ]);
      knee.add(shin);

      const ankle = pivot(knee, 0, -0.150, 0);
      // Oversized trainer, and domed rather than a bare box. A box presents a
      // hard rectangle to the camera the instant the recovery foot rotates
      // sole-on, which is most of what made the old shoe read as a held
      // object; a rounded toe, heel and outsole keep it a shoe from every
      // angle the cycle puts it in. See SOLE for why the underside is the
      // value it is.
      //
      // The MIDFOOT was still a bare box, and it was the last hard corner on
      // the character. Dead astern that never showed -- the heel dome covers
      // it -- but the run cycle swings each foot through the full quarter view
      // twice a stride, and there a 90-degree corner between the instep and
      // the side wall reads as a brick with a dome glued on each end. Chamfered
      // at 0.030, which is a quarter of the shoe's own height: enough to catch
      // its own band off the toon ramp along the edge, not enough to round the
      // trainer into a pebble. The extents are unchanged to the float, so the
      // outsole still owns the slide's half-width by the same 0.003 it did.
      const foot = multi([
        { g: roundedBox(0.190, 0.110, 0.225, 0.030, R_NUB), c: P.runnerShoe, y: -0.036, z: 0.036 },
        { g: new THREE.SphereGeometry(0.095, R_LIMB, 16), c: P.runnerShoe, y: -0.036, z: 0.150, sy: 0.82, sz: 0.66 },
        { g: new THREE.SphereGeometry(0.092, R_NUB, 12), c: P.runnerShoe, y: -0.026, z: -0.072, sy: 0.86, sz: 0.74 },
        // Heel counter. The best-value detail on the whole character, because
        // the back of a shoe is the ONE face of the runner the chase camera
        // gets square-on for the entire race -- no foreshortening, no angle,
        // both of them, all the time. A real trainer puts a stiffened cup
        // there in a different material and every reference shoe shows it.
        // Narrower in x than the heel dome behind it so the two surfaces cross
        // transversally instead of nesting: a patch fractionally SMALLER than
        // the shell it sits on is the coin-of-scalp bug the hair cap had, and
        // this one is deliberately proud in z and inset in x.
        { g: new THREE.SphereGeometry(0.098, R_NUB, 12), c: SHOE_DK, y: -0.030, z: -0.076, sx: 0.90, sy: 0.72, sz: 0.72 },
        // The lace panel that used to sit across the instep is gone, and the
        // reason recorded here was wrong in a way worth keeping. It said the
        // panel was "0.078 across ... measured at gameplay framing it was half
        // a pixel wide". 0.078 across is nine or ten pixels: the conversion was
        // the figure's height divided by 1.60, off the 110px number, and it is
        // out by twenty.
        //
        // The panel had no size problem. It had never been drawn. Built and
        // counted on the real chase frame by tools/resolve.js it owns ZERO
        // pixels in 48 of 48 frames, in portrait and in landscape, while the
        // identical box held clear of the shoe owns 260 -- so the probe works
        // and the panel is simply buried:
        //
        //   THE SOCK. The shin's cylinder is r 0.110 tapering to 0.102 and
        //     lands at ankle-space y -0.011 to 0.075, which is a tube sitting
        //     exactly where the panel is. It covers everything nearer than
        //     z 0.099 at the panel's own top corner.
        //   THE TOE DOME. r 0.095 scaled 0.82 in y and 0.66 in z at z 0.150
        //     reaches back to z 0.106 and up to y 0.042 -- OVER the panel's top
        //     at 0.035.
        //   THE INK. What is left between those two is a gap 0.008 wide, and
        //     both neighbours carry a 0.014 outline shell. Two shells close a
        //     0.008 gap twice over.
        //
        // The shin and the toe are the same geometry today that they were in
        // the commit that added the panel, so it was invisible from the moment
        // it was written -- and the pass that removed it removed the right
        // thing while describing a fault it did not have. The lesson is not
        // "small parts go": it is that a dimension is not a screen footprint,
        // and only one of those two can be measured off the source.
        //
        // The heel counter above is the same idea aimed at the face the camera
        // never stops seeing -- 231 pixels against the panel's zero -- and it
        // is the reason the shoe still reads as a trainer without it.
        //
        // Thin accent stripe, and thin is the point: it is a crisp bright line
        // from behind and almost nothing from below, which is the opposite of
        // where the accent used to sit. NOT chamfered, unlike the midfoot above
        // it, and for two reasons that agree. The whole job of this piece is to
        // be a hard line; at 0.028 tall even a 0.008 chamfer is a third of it,
        // and what came back was a second small dome rather than the edge
        // between the upper and the outsole. And its front corner turns out to
        // be the widest point of the whole character in a SLIDE -- knocking it
        // off pulled the slide's half-width from 0.5609 to 0.5551, which is a
        // silhouette this game distinguishes states by.
        { g: new THREE.BoxGeometry(0.196, 0.028, 0.240), c: TRIM, y: -0.100, z: 0.036 },
        // Outsole as a squashed ellipsoid rather than a slab, so the face it
        // turns to the camera on the recovery swing is a rounded oval that
        // still reads as the bottom of a shoe.
        { g: new THREE.SphereGeometry(0.140, R_TORSO, 16), c: SOLE, y: -0.122, z: 0.036, sx: 0.70, sy: 0.22, sz: 0.90 },
      ], 2);
      ankle.add(foot);

      legs.push({ side, hip, knee, ankle });

      // arm
      const shoulder = pivot(chest, side * 0.222, -0.004, 0);
      // ZXY so the twist happens along the arm before it is swung and then
      // abducted. With the default XYZ the yaw fired after the outward tilt
      // and dragged the whole arm across the back of the vest. It also leaves
      // rotation.z as a clean abduction angle measured from straight down,
      // which is the single number the jump pose steers.
      shoulder.rotation.order = 'ZXY';
      // Bare, and that is a reversal. This carried a base-layer sleeve in a
      // pale blue with its own rolled cuff, on the argument that "a race vest
      // over a base layer" is what a marathon runner wears and the upper arm is
      // the only place from behind where a second garment can show. The
      // argument is true and the result was the worst thing on the character:
      // seen from the chase camera the sleeve is not a cylinder, it is the
      // sliver of one that clears the deltoid, so at gameplay scale it resolved
      // as a pale triangle at each shoulder -- and a pale triangle inside a red
      // mass reads as a HOLE IN THE VEST. Being invisible would have been the
      // better outcome of the two.
      //
      // Re-examined against the real figure rather than the 110px one this
      // file used to assume, because half the wardrobe removals were argued on
      // a number that was out by two. This one is not: the fault is SHAPE, and
      // a shape fault does not go away when the figure turns out to be bigger
      // -- a triangular hole reads as a hole more clearly, not less. Counted
      // anyway, so the next pass does not have to build it to find out: 23
      // pixels of a 390x844 frame at mid pace, and nothing at all in most
      // landscape frames. It stays out on the original argument, which is the
      // only one of the four that came through unchanged.
      //
      // What replaces it is form rather than tone: a triceps swell, in skin,
      // 0.020 proud at the back and nothing at the sides. Same argument as the
      // hamstring and the calf -- it gives the ramp something to shade without
      // introducing a value the silhouette has to pay for, and it keeps this
      // part off the list of lone primitives.
      //
      // ---- AND WHY THE ARM READ AS THREE PIECES ---------------------------
      //
      // The owner's word for this character was "primitive 3D shapes assembled
      // into a human silhouette", and the arm was the clearest case: shoulder,
      // upper arm and forearm each resolved as its own rounded object rather
      // than as one limb. The cause is not the shapes. It is the INK.
      //
      // Every part on this figure is drawn twice -- fill, then the same
      // geometry through the outline shader -- so a part boundary is not a
      // soft join, it is a HARD BLACK LINE, and the eye counts closed outlines
      // before it reads form. Three welds down the arm is three outlines, and
      // three outlines is three objects however well the masses overlap.
      //
      // So the fix is not more geometry between the parts, it is fewer parts
      // spanning the same distance. The deltoid below is welded into the ARM
      // rather than into the trunk, which puts the shoulder mass and the upper
      // arm inside ONE outline; and the forearm belly does the same for the
      // elbow and the forearm. The vest keeps its own red deltoid on the
      // trunk, because that is a garment and a garment is supposed to have an
      // edge -- what it stops being is the only thing between the neck and the
      // elbow with a line round it.
      const upper = multi([
        { g: new THREE.CapsuleGeometry(0.086, 0.095, 6, R_LIMB), c: P.runnerSkin, y: -0.122 },
        // The deltoid, in skin, on the ARM. It emerges from under the vest's
        // own red shoulder 0.051 lower down, which is where a singlet's
        // shoulder seam is and where the muscle would show; and it is 0.022
        // proud of the upper arm's capsule, which clears the 0.014 ink so the
        // two weld cleanly rather than growing teeth.
        //
        // It rotates with the shoulder, which is the one thing about it that
        // had to be measured rather than reasoned: the jump abducts this joint
        // hard and an arm-mounted mass swings outward with it. Reaching x 0.330
        // at rest against the trunk deltoid's 0.384, it stays inside the vest's
        // own shoulder through the whole cycle -- see the envelope table in the
        // report for what it did to the jump's half-width, which is the number
        // the airborne silhouette is separated by.
        { g: new THREE.SphereGeometry(0.108, R_LIMB, 14), c: P.runnerSkin, y: -0.058, sy: 0.86, sz: 0.92 },
        { g: new THREE.SphereGeometry(0.088, R_NUB, 12), c: P.runnerSkin, y: -0.108, z: -0.016, sx: 0.90, sy: 1.15 },
      ]);
      shoulder.add(upper);

      // Arms are the one place the toy proportion is knowingly broken: shoulder
      // to fingertip is 1.1 head-lengths where the reference characters run
      // nearer 0.9, because reach is the ONLY term in the spread jump pose and
      // stubby arms cannot buy enough width to make the airborne state
      // unmistakable. At rest the extra is absorbed by the elbow's flexion and
      // never shows.
      const elbow = pivot(shoulder, 0, -0.262, 0);
      // Forearm ending in a mitt over a trim wristband. Arms and thighs
      // are both skin, and from behind they overlap for most of the stride --
      // without a bright break at the wrist the whole lower half of the
      // character reads as one undifferentiated mass. The mitt is 0.19 across
      // against a 0.57 head, near the ratio Sonic's gloves run at, and it is
      // what makes both the arm swing and the spread jump pose land.
      const fore = multi([
        { g: new THREE.CapsuleGeometry(0.078, 0.090, 6, R_LIMB), c: P.runnerSkin, y: -0.103 },
        // Elbow, on the pivot, for the reason the knee has one: the flexion
        // reaches 1.78rad at the front of the swing and two capsules meeting
        // at a point open a notch there. This one shows more than the knee
        // does, because the run cycle drives the elbows LATERALLY -- they are
        // the joint the back view was built to watch.
        { g: new THREE.SphereGeometry(0.088, R_NUB, 12), c: P.runnerSkin, y: -0.012, sy: 0.92, sz: 0.96 },
        // The forearm's belly, and it is the elbow's other half. A forearm is
        // thickest just under the elbow and tapers to a wrist half its width;
        // this one was a constant 0.078 tube with a ball on the end of it, so
        // the elbow read as a knuckle in the middle of the arm rather than as
        // the widest part of it. Overlapping the elbow ball deliberately: the
        // two are one mass and the taper runs from there to the band.
        //
        // Fatter in z and barely in x -- 0.020 of relief at the back, 0.006 at
        // the side -- which is the hamstring's argument, the calf's and the
        // triceps'. Arm swing is almost entirely along the camera axis from
        // astern, so relief in z is what the ramp can shade; width in x is
        // what the jump's silhouette is measured on and it is not spent here.
        { g: new THREE.SphereGeometry(0.098, R_NUB, 12), c: P.runnerSkin, y: -0.072, sx: 0.86, sy: 1.05 },
        // The wristband, and it is 0.098 where it used to be 0.088. That is a
        // repair, not a flourish: the mitt's old wrist ball was r=0.094 and
        // spanned the band's whole height, so the third of TRIM's three hits on
        // this figure -- headband, wristbands, midsoles -- was a ring buried
        // inside the hand it was meant to break away from, showing as a yellow
        // thread with the ball's ink shell punching black wedges through it.
        // Rounding the pieces made that worse rather than better, because a
        // coarse ball is INSCRIBED and its facets were the only thing letting
        // the band out at all.
        //
        // At 0.098 over a 0.078 forearm it is a sweatband standing 0.020 proud,
        // and it clears the mitt below it by 0.018 -- comfortably over the ink's
        // own 0.014, which is the number that decides whether two welded
        // surfaces cross cleanly or grow teeth.
        { g: new THREE.CylinderGeometry(0.098, 0.098, 0.052, R_LIMB), c: TRIM, y: -0.180 },
        // ---- the hand ------------------------------------------------------
        //
        // Sized to the frame that ships and not to a close-up. This pass took
        // the figure at 200-210px, correcting the 110 an earlier one assumed,
        // and got the hand right: measured directly, 0.208 across against the
        // 121-131 pixels per world unit at 390x844 is 25-27 PIXELS, which is
        // what this note says. The height it reasoned from has since been
        // measured properly and is 163-208px rather than 200-210 -- and 50-67
        // in landscape -- but the hand does not move, because it was converted
        // through the right quantity. The finish does NOT help: its camera
        // pulls BACK to show the arch and both posts, and the held shot has him
        // at 52px. 26px is the largest this hand is ever drawn in play, and it
        // decides everything below:
        //
        //   - Three fingers do not exist at 26px. Each was 0.06 across, under
        //     8px, in the palm's own colour, and the review's verdict on them
        //     was "unarticulated rounded stump". They stay replaced by one
        //     curled roll carrying the whole hand's single value break -- and
        //     the size argument turns out to be the weaker of the two available
        //     ones. Built and counted on the real chase frame, a restored
        //     finger owns ZERO pixels in 45 of 48 portrait frames and 48 of 48
        //     in landscape: curled forward at rx 0.60 it points down the view
        //     axis, which is the axis rule 4 in the header says has nothing to
        //     see, and the palm is in front of it. The knuckle roll that
        //     replaced them is deliberately at the LOWER REAR edge for exactly
        //     that reason.
        //   - A ball reads as a ball at every size, and a box reads as a card.
        //     Both were built and both were looked at: the flat-faced block
        //     shaded into two clean planes close up and, seen from the shallow
        //     angle most of the cycle puts it at, presented its own edge and
        //     read as a paddle held in the hand rather than as the hand. The
        //     mass is a broad flattened ELLIPSOID with the band above it and
        //     the knuckle roll under it -- forearm / band / hand / knuckles,
        //     four stacked shapes in three tones.
        //   - The wrist ball above the palm is GONE, and the band is what
        //     replaces it. Two nested ellipsoids 0.010 apart at the wrist were
        //     never two shapes at any size; they were one lumpy one, and the
        //     inner one's shell was the thing eating the band. One mass, one
        //     ring over it, reads as a hand in a wristband from 26px up.
        //   - The thumb rides high and INBOARD, so it breaks the outline
        //     against the vest and the thigh -- the two dark masses the hand
        //     passes in front of -- rather than against the road, where the
        //     mitt's own edge is already doing the work.
        //
        // The mass is still 0.104 off the arm's axis. What it gave up is REACH:
        // the hand now bottoms out at -0.348 where the old one reached -0.361,
        // and that 0.013 is exactly what paid for moving the knuckle row aft
        // (see below) without the airborne silhouette growing. Measured per
        // vertex across all 24 stride phases, the jump's half-width comes
        // through this rebuild on 0.8749 -- the same figure to four places.
        { g: new THREE.SphereGeometry(0.104, R_LIMB, 16), c: MITT, y: -0.258, z: 0.014, sy: 0.78, sz: 0.84 },
        // The curled fingers: a knuckle row lying across the hand at its LOWER
        // REAR edge. Where the break sits matters far more than what it is, and
        // the old note had the rule right while the geometry had it backwards
        // -- it read "the rear face and the bottom of the outline" and then put
        // the roll at z = +0.016, which on this rig is the FRONT (the heel
        // counter is at -0.076 and the nape at -0.058; -z is what the chase
        // camera sees). Buried under the palm's own belly, it was invisible
        // from every angle the game draws, which is exactly what the reviews
        // meant by "the knuckle break does not resolve". At z = -0.032 it
        // stands 0.017 proud of the mitt's rear surface and hangs 0.008 below
        // its underside, so it breaks the silhouette on the two edges a camera
        // dead astern can rely on seeing.
        //
        // Three overlapping balls rather than one capsule, and this is the
        // detail bought back with the budget rather than the one restored. A
        // capsule's cap ends were the outer knuckles and its middle was a
        // straight tube; three balls put a scallop between each pair. The
        // scallop is 0.007 deep, which is one pixel on a 30px hand: at the 26px
        // the game actually draws the row is still ONE dark roll under the
        // hand, which is the whole of what gameplay scale can hold and the
        // thing the earlier pass was right to refuse to break up. From about
        // 60px of hand it separates into knuckles. It costs the gameplay read
        // nothing and pays at every size above it, which is the only kind of
        // detail this character should be spending on.
        //
        // Uneven on purpose: the middle knuckle is the tallest on a real fist
        // and three equal lobes read as a gear rather than as a hand.
        //
        // ---- AND THEN IT WAS MEASURED ------------------------------------
        //
        // Everything above this line is the reasoning of the pass that built
        // the row, and it is right about where a break should go and wrong
        // about whether this one was there. tools/resolve.js, counting the
        // real chase frame: the row owned a MEDIAN OF 2 PIXELS and was drawn
        // at nothing at all in 18 of 48 frames.
        //
        // The fault is not the z the old note agonised over -- z was correct,
        // -0.032 is the rear. It is the Y. At -0.3055 the row sat 0.048 below
        // the mitt's centre, which on an ellipsoid 0.0811 tall in y is where
        // the section has shrunk to 81% -- so the three balls were 0.017 proud
        // of a surface that had already curved away under them, and the mitt's
        // own belly covered the rest. A part is not proud of a shape, it is
        // proud of the shape AT ITS OWN HEIGHT, and that is the arithmetic
        // this file has now got wrong in four different places.
        //
        // Raised 0.006 and pushed back 0.023. At -0.300 and z -0.055 the row
        // stands 0.036 proud of the mitt's rear rather than 0.017, and its
        // lowest point is 0.006 HIGHER than it was -- so the fix costs the
        // airborne silhouette nothing, which is the constraint that made the
        // old pass shy of moving it in the first place.
        { g: new THREE.SphereGeometry(0.039, R_NUB, 12), c: MITT_DK, x: -0.048, y: -0.2995, z: -0.055 },
        { g: new THREE.SphereGeometry(0.042, R_NUB, 12), c: MITT_DK, x: 0.000, y: -0.3000, z: -0.055 },
        { g: new THREE.SphereGeometry(0.038, R_NUB, 12), c: MITT_DK, x: 0.048, y: -0.2990, z: -0.055 },
        // ---- the thumb ---------------------------------------------------
        //
        // The brief this pass was written against says the hands are mittens
        // with no thumb. There has been a thumb on this character for four
        // passes. It owned SEVEN PIXELS at its best and was drawn at zero in
        // 36 of 48 frames, which is the same thing as not having one, and it
        // is the fourth part on this figure to be argued into place and never
        // counted.
        //
        // It was at z + 0.056, which is the FRONT of the hand, entirely inside
        // a mitt whose front reaches 0.101 -- so like the lace panel it had
        // never been drawn at all, and like the lace panel the note above it
        // described a part doing a job it was not in a position to do.
        //
        // What a thumb has to do at 26 px is exactly one thing: BREAK THE
        // OUTLINE. It cannot be a shape, it cannot be articulated, and it
        // cannot be a value -- it can be a bump on the edge of the fist, and
        // an edge is the only thing that survives that size. So it is moved
        // to the rear and INBOARD, where it reaches x 0.126 against the mitt's
        // own 0.104 and stands 0.020 proud of the rear surface at its own
        // height. Inboard rather than outboard is the old note's argument and
        // it survives intact: the inboard edge passes in front of the vest and
        // the thigh, which are the two dark masses the hand crosses, while the
        // outboard edge is already flashing against the road. It is also the
        // side that costs the figure's half-width NOTHING, because half-width
        // is measured from the spine and inboard is toward it.
        { g: new THREE.CapsuleGeometry(0.041, 0.048, 4, 12), c: MITT,
          x: -side * 0.085, y: -0.230, z: -0.040, rx: 0.30, rz: side * 0.62 },
      ]);
      elbow.add(fore);

      arms.push({ side, shoulder, elbow });
    }

    // ---- contact shadow --------------------------------------------------
    // Its own pivot, a direct child of root, so it can cancel the two things
    // the body does that the road does not: rise on a jump, and bank on a
    // lane change. A blob that tips with the runner gives the trick away in
    // one frame.
    const shadowPivot = pivot(root, 0, 0, 0);
    const shadow = groundShadow();
    const shadowMat = shadow.material;
    shadowPivot.add(shadow);

    let shadowW = 1, shadowD = 1, shadowA = 1;

    // main.js moves the group AFTER calling update(), so update() only ever
    // sees the PREVIOUS frame's jump height -- a whole frame of float at
    // takeoff, which is the one moment the shadow has to be exact. r160 runs
    // onBeforeRender before it reads matrixWorld, so re-seating the quad from
    // here lands on the same frame the runner leaves the ground.
    const LIFT = K.JUMP_HEIGHT;

    // ---- the landing reticle ---------------------------------------------
    //
    // The soft blob above is right for a body ON the road and exactly wrong for
    // one in the air. It shrinks and fades with height, which sells the lift --
    // and throws away the one piece of information the player needs most at
    // that moment, which is WHERE THEY WILL LAND. Subway Surfers keeps a hard
    // elliptical shadow on the surface for the whole arc for that reason: it is
    // a reticle wearing a shadow's clothes.
    //
    // So the two swap over. The blob fades out as the runner rises, the hard
    // ellipse fades in on the same curve, and the total amount of dark under
    // the character stays about constant while its EDGE goes from nothing to
    // definite. The ellipse does not shrink -- a target that shrinks is a
    // target that lies about where the feet arrive.
    const RETICLE_ALPHA = 0.50;
    const reticle = new THREE.Mesh(
      new THREE.PlaneGeometry(SHADOW_R * 2, SHADOW_R * 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: SCUFF_COLOR,
        map: discTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      })
    );
    reticle.position.y = 0.016;   // a hair over the blob, which sits at 0.015
    reticle.renderOrder = 2;
    reticle.visible = false;
    shadowPivot.add(reticle);

    // Both hooks below seat the pivot, because either mesh may be drawn first
    // and the reticle must not be a frame behind the runner it belongs to.
    function seatShadow(h) {
      shadowPivot.position.y = -h;
      shadowPivot.rotation.z = -root.rotation.z;
      shadowPivot.updateMatrixWorld(true);
    }

    shadow.onBeforeRender = function () {
      const h = Math.max(0, root.position.y);
      const t = Math.min(1, h / LIFT);
      // Shrink and fade with height. This is most of what makes a jump read
      // as leaving the ground: the runner's own rise is a few dozen pixels
      // against a road that is already rushing past, but a blob collapsing
      // away underneath him is unambiguous and needs no frame of reference.
      const k = 1 - t * 0.62;
      // Only the lift is cancelled here -- the quad carries its own clearance
      // above the road paint, and adding that in twice floated it.
      seatShadow(h);
      shadow.scale.set(shadowW * k, 1, shadowD * k);
      shadowMat.opacity = BASE_ALPHA * shadowA * (1 - t * 0.80);
    };

    reticle.onBeforeRender = function () {
      const h = Math.max(0, root.position.y);
      // Ramp over the first fifth of the lift so a stumble or a kerb hop, which
      // barely leaves the ground, never flashes a target on the road.
      const t = Math.min(1, h / (LIFT * 0.20));
      seatShadow(h);
      reticle.scale.set(1.16, 1, 0.86);
      reticle.material.opacity = RETICLE_ALPHA * t * t * (3 - 2 * t);
    };

    // ---- skid ribbon and dust --------------------------------------------
    //
    // Everything under this pivot lives in WORLD space, not rig space: the
    // marks a slide leaves have to stay on the road the runner has already
    // gone past. The pivot cancels root's transform outright by inverting its
    // world matrix rather than approximating it the way the shadow does --
    // root banks on a lane change, and a skid that banked with it would be
    // painted on the runner instead of on the tarmac.
    //
    // It is hidden, not merely faded, whenever there is no slide, so the two
    // meshes cost nothing at all for the 99% of a race that is running.
    const fxPivot = pivot(root, 0, 0, 0);
    fxPivot.matrixAutoUpdate = false;
    fxPivot.visible = false;

    // Ribbon: an indexed strip, two vertices per sample. Only the positions
    // move -- the UVs are fixed, so the texture's own gradient does the ageing
    // and no per-vertex alpha is needed.
    const SKID_PTS = SKID_N + 1;                 // + the live contact point
    const skidGeo = new THREE.BufferGeometry();
    const skidPos = new Float32Array(SKID_PTS * 2 * 3);
    const skidUv = new Float32Array(SKID_PTS * 2 * 2);
    const skidIdx = new Uint16Array((SKID_PTS - 1) * 6);
    for (let j = 0; j < SKID_PTS; j++) {
      const u = j / SKID_N;
      skidUv[j * 4 + 0] = u; skidUv[j * 4 + 1] = 0;
      skidUv[j * 4 + 2] = u; skidUv[j * 4 + 3] = 1;
      if (j < SKID_PTS - 1) {
        const a = j * 2, o = j * 6;
        skidIdx[o] = a; skidIdx[o + 1] = a + 1; skidIdx[o + 2] = a + 2;
        skidIdx[o + 3] = a + 1; skidIdx[o + 4] = a + 3; skidIdx[o + 5] = a + 2;
      }
    }
    skidGeo.setAttribute('position', new THREE.BufferAttribute(skidPos, 3));
    skidGeo.setAttribute('uv', new THREE.BufferAttribute(skidUv, 2));
    skidGeo.setIndex(new THREE.BufferAttribute(skidIdx, 1));
    const skidMat = new THREE.MeshBasicMaterial({
      // The mark on the road is DARK and the dust above it is pale, and that
      // pairing is deliberate. A pale smear under pale puffs is one flat wash
      // the eye cannot separate, and on this purple tarmac it reads as glare
      // or standing water rather than as anything scraped. Dark scuff first,
      // light dust over it, is also just what the contact shadow already says
      // about this character -- it is the same blob stretched into a streak.
      color: SCUFF_COLOR,
      map: skidTexture(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const skid = new THREE.Mesh(skidGeo, skidMat);
    skid.frustumCulled = false;   // its bounds are world-spanning and stale
    skid.renderOrder = 3;         // over the road paint and the contact blob
    fxPivot.add(skid);

    // Dust: camera-facing quads, per-vertex alpha so each puff fades on its
    // own clock. One draw for the lot.
    const dustGeo = new THREE.BufferGeometry();
    const dustPos = new Float32Array(DUST_N * 4 * 3);
    const dustCol = new Float32Array(DUST_N * 4 * 4);
    const dustUv = new Float32Array(DUST_N * 4 * 2);
    const dustIdx = new Uint16Array(DUST_N * 6);
    for (let i = 0; i < DUST_N; i++) {
      const v = i * 8, o = i * 6, a = i * 4;
      dustUv[v] = 0; dustUv[v + 1] = 0;
      dustUv[v + 2] = 1; dustUv[v + 3] = 0;
      dustUv[v + 4] = 0; dustUv[v + 5] = 1;
      dustUv[v + 6] = 1; dustUv[v + 7] = 1;
      dustIdx[o] = a; dustIdx[o + 1] = a + 1; dustIdx[o + 2] = a + 2;
      dustIdx[o + 3] = a + 1; dustIdx[o + 4] = a + 3; dustIdx[o + 5] = a + 2;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('uv', new THREE.BufferAttribute(dustUv, 2));
    // itemSize 4: three switches the shader to USE_COLOR_ALPHA on that alone,
    // which is what lets one mesh hold puffs at different ages.
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 4));
    dustGeo.setIndex(new THREE.BufferAttribute(dustIdx, 1));
    const dustMat = new THREE.MeshBasicMaterial({
      color: DUST_COLOR,
      map: puffTexture(),
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    const dust = new THREE.Mesh(dustGeo, dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 4;
    fxPivot.add(dust);

    // Speed streaks. One indexed mesh of STREAK_N tapered quads, rebuilt in the
    // camera's own plane every frame it is alive and hidden the rest of the
    // time, so a jump costs one draw for a third of a second and a run costs
    // nothing. It lives under fxPivot with the dust because both are written in
    // WORLD coordinates -- the burst is anchored to where the runner is, not to
    // how the rig happens to be banked or yawed at the time.
    const streakGeo = new THREE.BufferGeometry();
    const streakPos = new Float32Array(STREAK_N * 4 * 3);
    const streakCol = new Float32Array(STREAK_N * 4 * 4);
    const streakUv = new Float32Array(STREAK_N * 4 * 2);
    const streakIdx = new Uint16Array(STREAK_N * 6);
    for (let i = 0; i < STREAK_N; i++) {
      const v = i * 8, o = i * 6, a = i * 4;
      // u runs along the dart, from root to tip.
      streakUv[v] = 0; streakUv[v + 1] = 0;
      streakUv[v + 2] = 0; streakUv[v + 3] = 1;
      streakUv[v + 4] = 1; streakUv[v + 5] = 0;
      streakUv[v + 6] = 1; streakUv[v + 7] = 1;
      streakIdx[o] = a; streakIdx[o + 1] = a + 1; streakIdx[o + 2] = a + 2;
      streakIdx[o + 3] = a + 1; streakIdx[o + 4] = a + 3; streakIdx[o + 5] = a + 2;
    }
    streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
    streakGeo.setAttribute('uv', new THREE.BufferAttribute(streakUv, 2));
    streakGeo.setAttribute('color', new THREE.BufferAttribute(streakCol, 4));
    streakGeo.setIndex(new THREE.BufferAttribute(streakIdx, 1));
    const streakMat = new THREE.MeshBasicMaterial({
      color: STREAK_COLOR,
      map: streakTexture(),
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // No fog. These live within a metre of the lens for their whole life, and
      // fogging them just desaturates the one thing in frame that is meant to
      // shout.
      fog: false,
    });
    const streaks = new THREE.Mesh(streakGeo, streakMat);
    streaks.frustumCulled = false;
    streaks.renderOrder = 5;      // over the dust, which a burst throws with it
    streaks.visible = false;
    fxPivot.add(streaks);

    // Deterministic noise. Math.random here would make two screenshots of the
    // same frame differ, and the review loop is screenshots.
    let fxSeed = 1;
    function rnd() {
      fxSeed = (fxSeed * 1664525 + 1013904223) & 0x7fffffff;
      return fxSeed / 0x7fffffff;
    }

    let fxDt = 0, fxSlid = 0, fxLive = 0, fxEmit = 0, fxBurst = 0;
    // Jump/landing burst. `bAge < bTtl` is the whole liveness test; `bKick`
    // carries the dust the same burst throws, deferred to the fx hook because
    // that is the only place the runner's position for THIS frame is known.
    let bAge = 1, bTtl = 0, bY = 0, bPow = 1, bKick = 0, bLive = 0, wasFlying = false;
    // Fixed jitter, so two screenshots of the same burst are the same picture.
    const bJit = new Float32Array(STREAK_N);
    const bLen = new Float32Array(STREAK_N);
    for (let i = 0; i < STREAK_N; i++) {
      bJit[i] = ((i * 7) % STREAK_N) / STREAK_N * 0.22 - 0.11;
      // Alternating long and short. A ring of identical darts reads as a gear;
      // uneven ones read as spray.
      bLen[i] = i % 3 === 0 ? 1.34 : (i % 3 === 1 ? 0.78 : 1.05);
    }
    // `skidSeeded` is its own flag rather than a test on skidN, and that is not
    // tidiness: seeding on `skidN === 0` re-anchored the history to the current
    // position on every frame, the step test then measured zero distance every
    // frame, and the ribbon could never take its first sample.
    let skidN = 0, skidSeeded = false, lastX = 0, lastZ = 0;
    const skidX = new Float32Array(SKID_N);
    const skidZ = new Float32Array(SKID_N);

    const dPx = new Float32Array(DUST_N), dPy = new Float32Array(DUST_N), dPz = new Float32Array(DUST_N);
    const dVx = new Float32Array(DUST_N), dVy = new Float32Array(DUST_N), dVz = new Float32Array(DUST_N);
    const dAge = new Float32Array(DUST_N), dTtl = new Float32Array(DUST_N);
    let dCur = 0;

    function fxReset() {
      skidN = 0; skidSeeded = false; fxEmit = 0;
      for (let i = 0; i < DUST_N; i++) dTtl[i] = 0;
    }

    function spawn(cx, cz, power) {
      const i = dCur; dCur = (dCur + 1) % DUST_N;
      // Biased, not even. SLIDE_YAW turns the body so the hips lead toward -x
      // and the shoes swing out to +x, and a body ploughing at an angle throws
      // its spray off the trailing edge rather than symmetrically about its
      // own centreline. A symmetric plume also fights the pose it is meant to
      // support: two matched clouds either side are the same "this figure is
      // square to you" signal the old straddled legs were sending.
      const side = rnd() < 0.70 ? -1 : 1;
      dPx[i] = cx + side * (0.14 + rnd() * 0.46);
      dPy[i] = 0.05 + rnd() * 0.07;
      dPz[i] = cz - rnd() * 0.30;
      // Out and up off the road.
      dVx[i] = side * (0.9 + rnd() * 1.7);
      dVy[i] = (1.7 + rnd() * 2.0) * power;
      // Dragged FORWARD hard, and this term decides whether the effect exists
      // at all. The runner does ~25 u/s and the camera sits 4.6 behind him, so
      // a puff's entire visible life is however long it takes to fall those
      // 4.6 units back. At 2 u/s of carry that is a fifth of a second and the
      // cloud is never seen; at 11 it was still gone by mid-slide, which is
      // exactly what the frames showed -- a fat cloud at entry and bare road
      // four frames later.
      //
      // A third are thrown at very nearly the runner's own ground speed and
      // ride with him for their whole life; the rest fall away into the trail.
      // Without the clinging third the cloud drains backwards faster than it
      // is made, leaving a fat plume three units behind the runner and bare
      // road around him -- which is the one place the player is looking.
      dVz[i] = rnd() < 0.35 ? 23.0 + rnd() * 4.0 : 15.0 + rnd() * 7.0;
      dAge[i] = 0;
      dTtl[i] = 0.40 + rnd() * 0.26;
    }

    // A foot kick rather than a plough: symmetric about the runner, thrown low
    // and wide, and short-lived. The slide's spawn() is deliberately one-sided
    // (see above) and reusing it for a jump put the whole cloud off one hip,
    // which reads as a stumble. Same buffers, same single draw call.
    function kick(cx, cz, power) {
      const i = dCur; dCur = (dCur + 1) % DUST_N;
      const side = rnd() < 0.5 ? -1 : 1;
      dPx[i] = cx + side * (0.10 + rnd() * 0.30);
      dPy[i] = 0.05 + rnd() * 0.05;
      dPz[i] = cz - rnd() * 0.16;
      dVx[i] = side * (1.5 + rnd() * 1.9);
      dVy[i] = (0.8 + rnd() * 1.5) * power;
      dVz[i] = 16.0 + rnd() * 9.0;
      dAge[i] = 0;
      dTtl[i] = 0.26 + rnd() * 0.20;
    }

    // The whole effect is simulated here rather than in update(), because
    // main.js moves the group AFTER calling update() -- the same frame of lag
    // the shadow works around above. A skid mark placed a frame late is placed
    // a whole unit up the road at race pace, and the head of the ribbon would
    // visibly detach from the runner it is supposed to be coming out of.
    skid.onBeforeRender = function (renderer, scene, camera) {
      const dt = fxDt;
      fxPivot.matrix.copy(root.matrixWorld).invert();
      fxPivot.updateMatrixWorld(true);

      // Contact point: under the hips and a hair behind them, which is where
      // the body is actually on the road once the recline has tipped it back.
      const cx = root.position.x, cz = root.position.z - 0.12;
      const live = fxSlid > 0.05;

      if (live && !skidSeeded) { skidSeeded = true; lastX = cx; lastZ = cz; }
      // Sample by DISTANCE, never per frame: at 7fps under SwiftShader and at
      // 60 on a phone the runner covers wildly different ground per frame, and
      // a per-frame history would make the trail eleven units long in one and
      // one unit long in the other.
      for (let guard = 0; live && guard < 8; guard++) {
        const ddx = cx - lastX, ddz = cz - lastZ;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d < SKID_STEP) break;
        const k = SKID_STEP / d;
        lastX += ddx * k; lastZ += ddz * k;
        skidX.copyWithin(1, 0, SKID_N - 1);
        skidZ.copyWithin(1, 0, SKID_N - 1);
        skidX[0] = lastX; skidZ[0] = lastZ;
        if (skidN < SKID_N) skidN++;
      }

      // Head of the ribbon: the live contact point while the body is down, the
      // last sample once it is up, so releasing the slide stops laying rubber
      // instead of stretching the mark forward with the runner.
      const hx = live ? cx : lastX;
      const hz = live ? cz : lastZ;
      const M = skidN + 1;
      for (let j = 0; j < M; j++) {
        const px = j === 0 ? hx : skidX[j - 1];
        const pz = j === 0 ? hz : skidZ[j - 1];
        // Perpendicular to the local direction of travel. The runner is mostly
        // going +z, so this is near enough (1,0,0) except through a lane
        // change, where the mark should and does curve with the body.
        const qx = j + 1 < M ? (j === 0 ? skidX[0] : skidX[j]) : px;
        const qz = j + 1 < M ? (j === 0 ? skidZ[0] : skidZ[j]) : pz;
        let ex = px - qx, ez = pz - qz;
        const el = Math.sqrt(ex * ex + ez * ez) || 1;
        ex /= el; ez /= el;
        // Widens as it ages: a skid does not stay the width of the hip that
        // made it, and a plume opening toward the camera is the single most
        // legible thing in the frame.
        const u = j / SKID_N;
        const half = 0.30 + 0.72 * u;
        const nx = ez * half, nz = -ex * half;
        const o = j * 6;
        skidPos[o] = px + nx; skidPos[o + 1] = 0.022; skidPos[o + 2] = pz + nz;
        skidPos[o + 3] = px - nx; skidPos[o + 4] = 0.022; skidPos[o + 5] = pz - nz;
      }
      skidGeo.setDrawRange(0, Math.max(0, (M - 1) * 6));
      skidGeo.attributes.position.needsUpdate = true;

      // ---- dust ----------------------------------------------------------
      if (fxBurst > 0) { for (let i = 0; i < fxBurst; i++) spawn(cx, cz, 1.55); fxBurst = 0; }
      if (bKick > 0) { for (let i = 0; i < bKick; i++) kick(cx, root.position.z, bPow); bKick = 0; }
      // Clusters, not a smooth stream. A steady emitter at the same total
      // rate produced a thin even haze that read as nothing, while the twelve
      // puffs of the entry burst -- the same particles, all at once -- read
      // instantly as dust. Density in one place is the whole cue, and a slide
      // judders rather than pours, so pulsing is also the honest motion.
      if (live) {
        fxEmit += dt;
        while (fxEmit >= 0.05) {
          fxEmit -= 0.05;
          for (let k = 0; k < 8; k++) spawn(cx, cz, 1.15);
        }
      }

      // Billboard off the lens, so a puff is a puff whatever the camera roll
      // is doing. Reading the basis here is the whole reason the sim lives in
      // onBeforeRender -- update() has no camera.
      const e = camera.matrixWorld.elements;
      const rx = e[0], ry = e[1], rz = e[2];
      const ux = e[4], uy = e[5], uz = e[6];
      const dragK = Math.min(1, dt * 2.4);
      for (let i = 0; i < DUST_N; i++) {
        const o = i * 12, c = i * 16;
        if (dTtl[i] <= 0) {
          // Dead puffs collapse to a point with zero alpha rather than being
          // skipped, so the draw stays one call and one buffer upload.
          for (let k = 0; k < 12; k++) dustPos[o + k] = 0;
          for (let k = 3; k < 16; k += 4) dustCol[c + k] = 0;
          continue;
        }
        dAge[i] += dt;
        if (dAge[i] >= dTtl[i]) { dTtl[i] = 0; continue; }
        dVy[i] -= 6.4 * dt;
        dVx[i] -= dVx[i] * dragK; dVz[i] -= dVz[i] * dragK * 0.85;
        dPx[i] += dVx[i] * dt; dPy[i] += dVy[i] * dt; dPz[i] += dVz[i] * dt;
        if (dPy[i] < 0.04) { dPy[i] = 0.04; dVy[i] = 0; }

        const t = dAge[i] / dTtl[i];
        // Dust expands as it dissipates; a puff that shrinks reads as a spark.
        // Small and hard rather than big and soft. Raising the base radius to
        // 0.26 was tried and merged thirty puffs back into the single flat
        // wash the whole puff texture exists to avoid.
        const s = 0.19 + 0.54 * Math.pow(t, 0.60);
        const a = Math.min(1, t * 7) * Math.pow(1 - t, 1.05);
        const ax = rx * s, ay = ry * s, az = rz * s;
        const bx = ux * s, by = uy * s, bz = uz * s;
        const px = dPx[i], py = dPy[i], pz = dPz[i];
        dustPos[o] = px - ax - bx; dustPos[o + 1] = py - ay - by; dustPos[o + 2] = pz - az - bz;
        dustPos[o + 3] = px + ax - bx; dustPos[o + 4] = py + ay - by; dustPos[o + 5] = pz + az - bz;
        dustPos[o + 6] = px - ax + bx; dustPos[o + 7] = py - ay + by; dustPos[o + 8] = pz - az + bz;
        dustPos[o + 9] = px + ax + bx; dustPos[o + 10] = py + ay + by; dustPos[o + 11] = pz + az + bz;
        for (let k = 0; k < 4; k++) {
          dustCol[c + k * 4] = 1; dustCol[c + k * 4 + 1] = 1; dustCol[c + k * 4 + 2] = 1;
          dustCol[c + k * 4 + 3] = a;
        }
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustGeo.attributes.color.needsUpdate = true;

      // ---- speed streaks -------------------------------------------------
      // Written straight into the camera's plane: `ax/ay/az` is the direction
      // of the dart on screen and `px/py/pz` is across it, both built from the
      // lens basis read above, so a dart is the same shape whatever the camera
      // is doing and none of its length is lost down the view axis.
      if (bAge < bTtl) {
        bAge += dt;
        const u = Math.min(1, bAge / bTtl);
        // Fast attack, long tail: the burst must be at full strength on the
        // frame it fires, because on a 0.70s arc there are only a handful of
        // frames in which it can say anything at all.
        const alpha = (u < 0.10 ? u / 0.10 : Math.pow(1 - (u - 0.10) / 0.90, 1.6)) * bPow;
        const cy = root.position.y + bY;
        const ring = 0.44 + 0.50 * Math.pow(u, 0.55);
        for (let i = 0; i < STREAK_N; i++) {
          const ang = (i / STREAK_N) * Math.PI * 2 + bJit[i];
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const ax = rx * ca + ux * sa, ay = ry * ca + uy * sa, az = rz * ca + uz * sa;
          const nx = -rx * sa + ux * ca, ny = -ry * sa + uy * ca, nz = -rz * sa + uz * ca;
          const r0 = ring;
          const r1 = ring + 0.34 * bLen[i] * (1 - u * 0.45);
          const w0 = 0.052 * (1 - u * 0.30), w1 = w0 * 0.34;
          const o = i * 12, c = i * 16;
          streakPos[o] = cx + ax * r0 + nx * w0; streakPos[o + 1] = cy + ay * r0 + ny * w0; streakPos[o + 2] = root.position.z + az * r0 + nz * w0;
          streakPos[o + 3] = cx + ax * r0 - nx * w0; streakPos[o + 4] = cy + ay * r0 - ny * w0; streakPos[o + 5] = root.position.z + az * r0 - nz * w0;
          streakPos[o + 6] = cx + ax * r1 + nx * w1; streakPos[o + 7] = cy + ay * r1 + ny * w1; streakPos[o + 8] = root.position.z + az * r1 + nz * w1;
          streakPos[o + 9] = cx + ax * r1 - nx * w1; streakPos[o + 10] = cy + ay * r1 - ny * w1; streakPos[o + 11] = root.position.z + az * r1 - nz * w1;
          for (let k = 0; k < 4; k++) {
            streakCol[c + k * 4] = 1; streakCol[c + k * 4 + 1] = 1; streakCol[c + k * 4 + 2] = 1;
            streakCol[c + k * 4 + 3] = alpha;
          }
        }
        streakGeo.attributes.position.needsUpdate = true;
        streakGeo.attributes.color.needsUpdate = true;
        streaks.visible = true;
      } else if (streaks.visible) {
        streaks.visible = false;
      }
    };

    // ---------------------------------------------------------------------

    const api = {
      group: root,
      height: HEIGHT,
      shadow,
      parts: { body, hips, spine, chest, neck, head, hood: hoodPivot, legs, arms },
      phase: 0,
    };

    /**
     * Advance the cycle and pose the skeleton.
     *
     * @param dt     real seconds
     * @param st     { speed, airborne, air01, ducking, duck01, lean, stumble }
     */
    api.update = function (dt, st) {
      st = st || {};
      const speed = st.speed === undefined ? SPEED_LO : st.speed;
      const air = st.air01 || 0;
      const duck = st.duck01 || 0;
      const lean = st.lean || 0;
      const stumble = st.stumble || 0;
      // A trip is a stagger, not a pause: the body pitches forward and the
      // arms fly out to catch it. Kept separate from `stumble` so the wall
      // bounce (which is a lateral throw) and the kerb trip (which is a
      // forward pitch) do not collapse into the same animation.
      const trip = st.trip || 0;
      const knock = st.bounce || 0;
      // The road's grade at the runner, -1..1 against the steepest legal one.
      // It is the ONLY thing hills hand this file: the stride slows on the
      // climb and quickens on the descent for nothing, because cadence already
      // falls out of `speed`, and `speed` is grade-inclusive.
      const grade = st.grade || 0;

      // ghost.js re-materials every mesh under this rig to draw the record
      // runner as one translucent body. That is right for limbs and wrong for
      // a painted shadow -- it would swap the soft blob for a solid quad lying
      // on the road -- so the shadow reclaims its own material here rather
      // than depending on another module to know it should be skipped.
      if (shadow.material !== shadowMat) shadow.material = shadowMat;

      // Stride frequency scales with ground speed so the feet never skate.
      // Start pace is the reference; the exponent keeps cadence rising more
      // slowly than speed, which is how real runners gain pace -- the rest
      // of the gain shows up as stride length and lean below.
      //
      // STAGE 3 DELIBERATELY DID NOT TOUCH THIS CURVE, and the reason is not
      // animation. main.js fires footsteps off api.phase, so the exponent is
      // the tempo of the per-step audio layer as well as of the legs, and the
      // grade-audio work SIZED that layer against it -- 4.7-5.3% slower on a 4%
      // climb, 4.6-6.1% faster on a 4% descent, with the footstep timbre tilted
      // to forefoot climbing and heel-first descending. Move the exponent and
      // those tilts are calibrated against a number that changed. The gain this
      // stage was asked for went into amplitude, lean and push-off instead,
      // which is what the sentence above always said the exponent was shaped
      // for. Across the honest band it already carries cadence 2.55 -> 3.08 Hz,
      // +20.7%, against +29.9% of ground speed.
      const cadence = 2.55 * Math.pow(speed / SPEED_LO, 0.72);
      // Bleed the cycle out over the jump instead of hard-stopping at a
      // threshold -- a frozen scissor at the moment of takeoff was visible.
      api.phase = (api.phase + dt * cadence * (1 - air * 0.92)) % 1;

      const p = api.phase * Math.PI * 2;
      // 0..1 across the honest pace band, used only for the terms that should
      // read as "trying harder": stride length and forward lean.
      const sp01 = Math.max(0, Math.min(1, (speed - SPEED_LO) / (SPEED_HI - SPEED_LO)));
      // STAGE 3. Stride amplitude, and the slope on sp01 is what the stage is
      // mostly made of.
      //
      // Before this pass the whole speed response of the character was 21% of
      // stride amplitude and 0.12 rad of lean across the ENTIRE pace band --
      // the difference between a 5:30 mile and a 4:14 one, which is the whole
      // range the game has. 0.20 -> 0.36 makes that 38%, and it is spent
      // where stage 1 said it could be: because the ankle is now SOLVED for a
      // flat sole through stance rather than tuned, sole depth no longer
      // depends on stride amplitude, so raising it does not reopen foot
      // planting. Measured, it does the opposite of costing anything -- a
      // longer stride at the same cadence carries the planted foot further
      // backward in the time it is down, so skate FALLS as the stride opens.
      //
      // `swing` drives hip flexion and shoulder flexion, both of which are
      // rotations about x. Neither has a lateral component, so this cannot
      // move the run's silhouette half-width, which is the number the jump has
      // to stay legible against. That is why the amplitude is the safe place
      // to put the gain and abduction is not.
      const swing = 0.94 + (0.20 + POLISH * 0.16) * sp01;

      // ---- surge: is the runner GAINING pace, not just holding it ----------
      // STAGE 3, and the owner's third item: "acceleration = temporary stronger
      // push-off/lean". Nothing in this file differentiated anything before
      // this; `st.speed` arrived and was used as a level.
      //
      // THE HILL IS TAKEN BACK OUT FIRST, and that is the whole design of this
      // signal rather than a detail of it. `speed` is grade-inclusive by the
      // time it reaches this file (see `grade` above, and main.js), so the raw
      // derivative of it is dominated by the terrain: measured over a real
      // course, cresting into a descent reads +0.666 u/s^2 where the runner's
      // own effort is +0.181, and starting a climb reads -0.265 where the
      // effort is +0.115 -- three to four times the size and, at the top of a
      // climb, the OPPOSITE SIGN. A surge term fed that would lean the
      // character hardest exactly when gravity is doing the work, and on a
      // descent it would fight `gradePitch` (which sits back, correctly) and
      // win by 3x. It would also be the second grade term this file is not
      // allowed to have, wearing a derivative as a disguise.
      //
      // So the grade is removed the same way camera.js removes it for the
      // top-gear latch, and for the same stated reason: speed you did not earn
      // is not a thing to celebrate. pace.js's grade term is ADDITIVE in
      // seconds per mile, which is what makes the removal exact rather than
      // approximate -- go back through SPEED_NUM to a pace, subtract the grade's
      // own seconds, come forward again. Checked against pace.js's private
      // `pace` over 40 whole races: worst error 0.0145 u/s out of ~22, i.e.
      // 0.07%, and all of it is gradeNorm clipping at +/-1 where the raw slope
      // does not.
      //
      // Clamped at 1/25 rather than at `hdt`'s 1/50. This is not a spring being
      // kept stable, it is a filter that should mean the same thing in real
      // seconds at 7 fps as at 60, and halving its step would double its time
      // constant on a slow frame. Same clamp camera.js uses.
      const accDt = dt > 0 ? (dt < 1 / 25 ? dt : 1 / 25) : 0;
      const flatSpeed = speed > 1
        ? SPEED_NUM / Math.max(1, SPEED_NUM / speed - GRADE_SPM_FULL * grade)
        : speed;
      if (!accPrimed) { accPrimed = true; accSp = flatSpeed; }
      if (accDt > 0) {
        const was = accSp;
        // Two filters, not one. The pace model steps its target on every gate
        // passed, so a single derivative is a train of spikes at gate spacing;
        // smoothing the speed first is what turns that into the thing a player
        // would call "picking it up". Time constants 0.26 s and 0.33 s, the
        // pair camera.js already runs its own surge cue on, so the two cues
        // arrive together instead of beating against each other.
        accSp += (flatSpeed - accSp) * (1 - Math.pow(0.02, accDt));
        // The divided difference is clamped before it is used, for the reason
        // the collar's is fifty lines below: a step in the input that no race
        // can produce should not be treated as an acceleration that no race can
        // produce. Over the same 40 races the worst gap between the raw speed
        // and this filter is 0.976 u/s, which the clamped step turns into at
        // most ~3.5 u/s^2, so +/-4 never touches anything the game does. What
        // it bounds is everything the game does NOT do: a tab returning from
        // the background, and ?skip= landing the page mid-race.
        const raw = (accSp - was) / accDt;
        accA += ((raw < -4 ? -4 : raw > 4 ? 4 : raw) - accA) * (1 - Math.pow(0.05, accDt));
      }
      // +1 is a clean streak gaining pace as fast as this game allows. -1 is
      // reached by any contact worth the name and then some -- see SURGE_FULL.
      const surge = Math.max(-1, Math.min(1, accA / SURGE_FULL));
      // The half of it that means "driving". Kept separate because push-off is
      // a one-sided idea: a runner losing pace does not push BACKWARDS, they
      // simply stop pushing, which is what surge falling to 0 already says.
      const surgeUp = surge > 0 ? surge : 0;
      // ...and the signed form, with the losing half at 40% of the gain of the
      // winning one. Deceleration saturates this signal four and a half times
      // more easily than acceleration does (SURGE_FULL), so equal gains would
      // make every contact a bigger event than every surge -- the opposite of
      // what was asked for, and a job three other inputs already do.
      const surgeLean = surgeUp + (surge - surgeUp) * 0.40;

      // How far into the airborne pose everything is. Smoothstepped rather
      // than linear so the spread snaps open just after takeoff and holds,
      // instead of easing through a half-open shape that looks like neither
      // state -- which is the frame a player would have to read to react.
      const spread = air * air * (3 - 2 * air);
      const cycA = 1 - spread * 0.88;

      // How far into the slide. Smoothstepped for the same reason the jump is:
      // half a slide is a shape the player cannot name, and a DUCK gate gives
      // them one glance to name it. duck01 itself already ramps in fast and out
      // slowly (player.js), so this shapes that ramp rather than replacing it.
      const slid = duck * duck * (3 - 2 * duck);
      // The run cycle has to be damped almost out, not blended with: a scissor
      // still running under a body lying on its back reads as a fall, and the
      // residual 8% is only there to keep the pose from looking frozen.
      const cycD = cycA * (1 - slid * 0.92);

      // The integrator step for every spring in this file, hoisted here because
      // stage 2 puts springs in the arm loop as well as in the secondary block
      // at the bottom. See that block for why it is clamped and not raw dt.
      const hdt = Math.min(dt, 1 / 50);

      // ---- legs: contralateral swing with a knee tuck on the recovery leg
      //
      // THE KNEE RUNS ON ITS OWN PHASE, AND THAT IS THE LARGEST SINGLE THING IN
      // THIS PASS. What follows is measured, not argued -- tools/stride.js and
      // a joint-by-joint sweep of the pre-pass rig, at 25.08 u/s:
      //
      //   phase   ankle y   ankle z (rig)   dz/dt
      //   0.00     0.143      1469.579      +5.3     <- LOWEST point of the foot
      //   0.19     0.234      1469.757      +0.2     <- FURTHEST FORWARD
      //   0.50     0.271      1469.455      -3.5
      //   0.72     0.453      1469.299      -0.8     <- HIGHEST, furthest back
      //
      // Read the loop rather than the rows: the foot travels FORWARD while it
      // is at the bottom of its arc and BACKWARD while it is at the top. That
      // is a bicycle pedalled the wrong way, and it is why the planted foot
      // measured +4.894 u/s -- not "not backward enough", but backward by
      // construction, with no amount of amplitude able to fix it.
      //
      // The cause is one phase. `bend` peaked at ph 0.5 and bottomed at ph 0,
      // where the hip is also passing through vertical -- so the leg was
      // STRAIGHT at mid-swing (which is why the sole reached 0.035 BELOW the
      // road there, with the body's whole weight nowhere near it) and FOLDED at
      // both ends of the swing. A run is the other way round: the knee folds
      // hardest just after toe-off, when the heel comes up under the hip and the
      // thigh is passing forward through vertical, and the leg is at its
      // straightest under the hip at midstance carrying the load.
      //
      // Turning the knee's phase by pi puts midstance at ph 0.5, where the hip
      // is sweeping backward at its fastest, and the loop reverses. Nothing else
      // has to move: `bob` is |cos| and so is already lowest at BOTH ph 0 and
      // ph 0.5, which is where the two feet now plant, and the arms and the
      // shadow pulse are locked to the same p they always were.
      //
      // It is written as a rotation of the phase rather than a swap of the
      // expression so that the A/B is continuous. At POLISH 0 the offset is
      // `ph + 0`, which is ph, so `kc` is the old `c` bit for bit.
      let plantW = 0, pushW = 0;
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const ph = p + (i === 0 ? 0 : Math.PI);
        const s = Math.sin(ph);
        const kc = Math.cos(ph + Math.PI * POLISH);

        // The stride's own event windows, and they cost no trig at all: `kc` is
        // +1 exactly where the corrected knee is straightest, which is
        // midstance, and 0 a quarter-cycle either side -- so it IS the stance
        // window already. Deriving these from the knee rather than from p means
        // they cannot drift out of step with the leg they describe, at any value
        // of the knob.
        //
        // The sign here is worth one line of warning, because getting it
        // backwards is silent: the poses stay legal, the tool still reports a
        // plausible cycle, and the only symptom is the ankle dorsiflexing under
        // the body's weight and driving the HEEL 0.063 into the tarmac at
        // midstance while the toe points at the sky. That is what the first
        // draft of this block did.
        //
        // Smoothstepped for the reason in `sm` above -- these gate the torso's
        // landing compression and the ankle's push-off, and a corner in either
        // of those is a tick on the whole body rather than on one joint.
        const stance = sm(Math.max(0, kc));    // foot down, peak at midstance
        const airW = sm(Math.max(0, -kc));     // foot up, peak at mid-recovery
        const drive = sm(Math.max(0, s));      // thigh swinging forward
        const trail = sm(Math.max(0, -s));     // thigh swinging back
        const land = stance * drive;           // strike -> midstance, absorbing
        const push = stance * trail;           // midstance -> toe-off, driving
        plantW += land;
        pushW += push;

        // The swing itself, shaped. See SHARP: same reach, faster through the
        // vertical, which is the half of the cycle the foot is on the road for.
        const sS = mix(s, sharpen(s, Math.sin(3 * ph)), POLISH);

        // Airborne: tuck both knees under. Deliberately gentler than it was.
        // The arms carry the airborne read now, and a hard double tuck on
        // legs this short balls the whole lower body into one lump that
        // fights the spread above it instead of supporting it.
        const tuck = spread * (i === 0 ? 0.80 : 0.70);
        const cyc = (1 - air * 0.75) * (1 - slid * 0.92);

        // Which leg leads the slide, and it is now a real figure-four rather
        // than the near-symmetric pair this used to be. The old objection to
        // folding the trail leg -- that it loses that shin out of the
        // silhouette from behind -- was true of a body pointing straight down
        // the view axis and stops being true once SLIDE_YAW turns it across
        // the lane: the folded knee then points out into open road where it is
        // the most legible thing on the character. Symmetry is what made the
        // pose nameable as "crouching"; nothing a human does on two feet looks
        // like one leg out and one knee folded under the hip.
        const lead = i === 0 ? 1 : 0;

        // Larger angles than the old rig ran, because the legs are a third
        // shorter and the same rotation covers a third less ground. Angle is
        // what the back view measures, not length.
        //
        // The slide term is NEGATIVE where the old duck's was positive, and
        // that sign is the whole fix: +x at the hip swings the foot toward -z,
        // which is back toward the camera, so the old pose tucked the knees up
        // under a body folding head-first at the bar. -x throws the feet down
        // +z, the way the runner is travelling, and puts the shoes at the
        // obstacle first. Past 1.5rad the thigh is a hair above horizontal,
        // which is what keeps the heels skimming the road instead of buried
        // in it once the body has dropped.
        //
        // The trail leg's 1.42 became 1.66 for a reason that only showed up
        // once the rig was measured part by part: with the thigh at 1.42 the
        // folded shin pointed 40 degrees into the road, the trail SHOE was the
        // deepest thing on the character at -0.29, and the road clamp below was
        // lifting the entire body by 0.29 to get it out again. Two thirds of
        // the duck's 0.42 drop was being spent on one buried foot. At 1.66 the
        // thigh carries the knee a little above the hip, the shin folds behind
        // it instead of through the floor, and the drop reaches the road.
        //
        // The two added terms are the owner's "more extension on the trailing
        // leg" and "forward knee slightly higher", and they are deliberately
        // NOT one bigger amplitude on the fundamental. A larger `swing` would
        // lengthen the stride at both ends and at every phase in between, which
        // is the exaggeration that was ruled out twice; these are one-sided
        // lobes that only reach their full value at the two extremes, so the
        // reach grows 12% and the pass under the hip does not move at all.
        //
        // Both are pulled out as locals because the ankle below has to READ
        // them. Only the cycle's own contribution is wanted there, not the jump
        // tuck or the slide's figure-four, so the split happens here rather than
        // off the finished joint angle.
        // The trailing lobe is the hip's share of push-off, so STAGE 3 opens it
        // with the surge: a runner picking up pace drives the thigh further
        // behind them and gets it back under the hip the same way. One-sided on
        // `trail` for the reason the lobe exists at all -- the pass under the
        // hip does not move, only the extension at the end of it.
        const hipRun = -sS * swing * 0.86
          + POLISH * ((0.11 + 0.10 * surgeUp) * trail - 0.16 * drive);
        // Knee only bends one way; bias so it flexes hardest on recovery.
        const bend = Math.max(0, -kc * 0.5 + 0.5);
        // ...and two corrections on top of the fundamental fold. The knee gives
        // way a little as the weight arrives (`land`) and straightens through
        // the drive off the toe (`push`), which is the difference between a leg
        // that meets the road and a leg that is passing through the place the
        // road happens to be. Both are gated on the stance window above, so
        // neither can fire while the foot is in the air.
        // ...and STAGE 3 straightens it harder off the toe when the runner is
        // gaining pace. `land` is left alone on purpose: absorbing a landing is
        // not something a surge makes you do more of, and softening the knee
        // further under load is the one direction here that would read as
        // sinking rather than as driving.
        const kneeRun = bend * (1.22 + 0.26 * sp01)
          + POLISH * (0.14 * land - (0.22 + 0.18 * surgeUp) * push);
        L.hip.rotation.x = hipRun * cyc + tuck * 0.70
          - slid * (lead ? 1.80 : 1.66);
        L.knee.rotation.x = 0.18 + kneeRun * cyc + tuck * 1.25
          + slid * (lead ? 0.02 : 0.62);
        // Dorsiflex through recovery, plantarflex off the toe -- and hard
        // dorsiflexion in the slide, toes up, which is both what a slider
        // actually does and what turns the biggest pale face on the character
        // away from the road and into the light.
        //
        // FOOT PLANTING, and the thing that makes it work is that all three leg
        // joints turn about the SAME axis, so the shoe's pitch against the world
        // is just hip + knee + ankle. The sole lies flat on the road when that
        // sum is zero, and the ankle is the only one of the three free to be
        // solved for -- so through the stance window it is, every frame, whatever
        // the leg above it happens to be doing.
        //
        // That is worth more than any amount of hand-tuning, because the failure
        // it prevents is one nobody watches for. Raking the thigh back at
        // toe-off rotates the WHOLE foot with it: at the old amplitudes the shoe
        // reached 30 degrees nose-down while its ankle was still at road height,
        // and the toe went 0.06 into the tarmac -- nearly twice the sole
        // penetration this pass started with, produced by a change that never
        // touched the ankle at all. Solve it and the depth stops depending on
        // the stride amplitude, which means stage 3 can raise the amplitude
        // without reopening this.
        //
        // 0.16 and 0.18 are the two constants sitting outside the cycle (the
        // resting dorsiflexion, and the knee's standing flex); everything else
        // in the sum is `hipRun + kneeRun`.
        const ankFlat = 0.16 - (hipRun + kneeRun + 0.18);
        // ...and then the toe is allowed to leave last. `push` rolls the foot
        // over onto the ball through the drive, which is the one moment a
        // planted foot SHOULD be nose-down, and `airW` picks the toe up over the
        // recovery -- the same 0.34 the old sine gave it, moved to the phase
        // where the shoe is actually passing the road. It also keeps the pale
        // outsole turned toward the camera on the swing, which the shoe's own
        // note says is deliberate.
        // STAGE 3 puts the surge into the toe as well. This is the term the
        // owner's "stronger push-off" most literally names, and it is safe to
        // grow for the reason above: `ankFlat` is solved from whatever hipRun
        // and kneeRun turn out to be, INCLUDING their own surge lobes, so the
        // sole is still flat on the road at midstance no matter how hard the
        // ankle is asked to drive a quarter-cycle later.
        const ankDrive = mix(s * 0.34,
          stance * ankFlat + push * (0.30 + 0.26 * surgeUp) - airW * 0.34, POLISH);
        L.ankle.rotation.x = -0.16 + ankDrive * cyc - tuck * 0.45
          - slid * (lead ? 0.30 : 0.04);
        // A little splay keeps the two legs from overlapping into one shape
        // when they pass each other at midstride, and opens further in the
        // air so the tuck reads as two legs rather than as one mass.
        //
        // The slide used to need far more of it than either -- 0.52, walking
        // the shoes out to x ~0.50 -- purely so the legs did not vanish behind
        // the torso when thrown down the view axis. SLIDE_YAW does that job
        // properly now by turning the whole body across the lane, and it does
        // it without spending the width budget on a symmetric straddle that
        // read as squatting. Splay is back to a little more than the run's,
        // which is all it was ever for: keeping the two legs from merging.
        L.hip.rotation.z = L.side * (0.05 + spread * 0.30 + slid * (lead ? 0.10 : 0.26));
      }

      // ---- arms ----------------------------------------------------------
      // Running: fore-and-aft swing points straight down the camera axis and
      // is almost invisible from behind, so the cycle is deliberately built
      // out of the two components the back view CAN see -- how far the elbow
      // travels sideways, and how high the glove rides.
      //
      // Jumping throws that away and goes for width. Temple Run's airborne
      // pose flings both arms out until the figure is more than twice as wide
      // as it runs, and that is the right answer here for a harder reason
      // than style: a mistimed jump costs the player the record, so being
      // airborne has to be legible from a silhouette forty pixels tall at
      // race speed. The old pose tucked, which is NARROWER than the run cycle
      // and from directly behind essentially invisible. Abducting to ~1.55rad
      // puts the arms a hair above horizontal, straightening the elbow adds
      // the forearm and the mitt to the span, and damping the cycle terms out
      // means every jump makes the same shape rather than whichever half of
      // the stride takeoff happened to land on.
      //
      // Sliding sweeps both arms back and in, so the gloves trail behind the
      // hips at road level like a slider bracing. Back is the only place they
      // can go: the shoulders end up barely 0.3 above the road once the body
      // drops and reclines, so an arm left hanging goes through the tarmac,
      // and near-horizontal is the only angle that keeps a 0.64 arm out of it.
      // Swept back they also sit NEARER the camera than anything else on the
      // figure, which is what stops the low pose from reading as small.
      //
      // IN, though, not out -- and that was not the first answer. Arms held
      // wide put the gloves in exactly the screen band the splayed shoes need,
      // and being closer to the lens they win it, which left a slide whose
      // legs were invisible and whose only wide pale objects were its hands.
      // Tucked in they read as one trailing tail and leave the flanks to the
      // feet, which is the half of the pose that has to say "feet first".
      //
      // What the polish pass adds here is almost entirely about the arm being
      // PART OF the body rather than bolted to it. Three things, in descending
      // order of how much the back view gets from them: the shoulder girdle now
      // slides fore and aft with its own arm (a real shoulder protracts; a
      // welded one cannot), the chest it hangs off counter-rotates half again as
      // far as it did, and the abduction band opens on the back swing and closes
      // on the front so the ELBOW travels sideways -- which rule 3 in the header
      // says is the only part of an arm cycle this camera can see at all.
      for (let i = 0; i < arms.length; i++) {
        const A = arms[i];
        const ph = p + (i === 0 ? Math.PI : 0);
        const s = Math.sin(ph);   // > 0 with the arm swung back
        // Smoothed, for the reason in `sm`: these two gate almost every angle
        // on the arm, and their shared corner at the crossing was a tick on the
        // whole limb twice a stride.
        const fwd = mix(Math.max(0, -s), sm(Math.max(0, -s)), POLISH);
        const back = mix(Math.max(0, s), sm(Math.max(0, s)), POLISH);
        // The arms run on exactly the shaping the legs do, so the two cannot
        // drift apart across the cycle -- which is the whole of "counter the
        // legs naturally".
        const sS = mix(s, sharpen(s, Math.sin(3 * ph)), POLISH);

        // This angle is measured against the RECLINED chest, not the world, and
        // the size of it is the fix for the most expensive defect this pose
        // had. An arm needs SLIDE_RECLINE + 1.57 simply to reach world-
        // horizontal. At the old 1.46 it hung more than a radian short of that
        // and drove the gloves through the tarmac -- and the road clamp below
        // then dutifully lifted the WHOLE BODY back out again to fix it.
        // Measured two builds ago: clamp lift 0.364 against a duck drop of
        // 0.42. The arms were silently cancelling 87% of the drop, so the
        // committed "slide" sat at very nearly running height and cleared the
        // 1.41 DUCK bar by 0.03.
        //
        // Trailing a hair above world-horizontal, the arm stops being the
        // limiting part; the lift is now set by the trail shin and the tucked
        // head, both of which ride ON the road rather than through it. It is
        // also the right pose: a slider's arms go out behind them, not down
        // through the surface they are sliding on.
        //
        // Written against SLIDE_RECLINE rather than as a bare 2.78, because
        // that is what it actually means: 1.68 is the angle the arm makes with
        // the WORLD, a hair past horizontal, and the recline is the part of it
        // the chest has already spent. Deepening the recline used to swing the
        // gloves up behind the shoulders by exactly as much as the trunk went
        // down, which is how the pose lost its trailing brace the first time
        // the torso was flattened.
        A.shoulder.rotation.x = sS * swing * (0.95 + POLISH * 0.10) * cycD - spread * 0.26
          + slid * (SLIDE_RECLINE + 1.68);
        // Abduction. The running band is deliberately tighter than it used to
        // be: the mitts got big enough to break the outline on their own, so
        // the elbows no longer have to be held out to do it -- and every
        // degree taken off the run widens the gap the jump has to clear.
        //
        // The slide term reads backwards and is not a typo: rotation.z abducts
        // an arm that hangs DOWN, and the slide has already swung this one
        // past horizontal to point up-and-back, so the sign that opens a
        // running arm outboard closes a sliding one inboard. That is the
        // direction wanted here -- see the note above the loop.
        //
        // The added band is one-sided on purpose. Opening the run's abduction
        // by a flat amount would cost silhouette width for the whole cycle and
        // eat into the gap the jump has to clear; opening it only on the BACK
        // swing and closing it a little on the front spends nothing on the
        // maximum and buys travel, and travel is what the eye tracks. A runner
        // does this anyway -- the elbow goes out and back together and comes
        // through close to the ribs.
        //
        // STAGE 3 opens that band further with PACE, and the size of it is
        // derived rather than chosen -- but the note above had to be corrected
        // first, because it is the reason a smaller number was tried.
        //
        // "Every degree taken off the run widens the gap the jump has to clear"
        // reads as though abduction is what sets the run's half-width. It is
        // not. Asked which vertex is actually the widest one in a running
        // silhouette at top pace, the rig answers the CHEST at 0.4157 before
        // this stage and the HEAD at 0.4208 after it -- the elbow is inboard of
        // both and does not reach the outline at all. So the band was swept
        // until it did: +0.10 and +0.18 of sp01 both leave the run at 0.4184,
        // bit for bit the width it has with no arm term whatever, and +0.26
        // pushes it to 0.4364. 0.18 is where the elbow arrives at the outline
        // without crossing it, which is the most travel this axis can buy for
        // exactly zero silhouette.
        //
        // The first draft did the opposite -- closed the FRONT swing harder,
        // on the theory that travel bought below the maximum is free. It is
        // free, and it is also worth less than nothing here: measured, the mitt
        // LOST 17% of its lateral range, because a deeper front fold and a
        // bigger `swing` both rotate the hand out of the plane the camera reads.
        // Same amplitude, wrong axis. Opening the back instead takes the mitt
        // to 0.1994 against 0.1816 before the stage, and it is the only one of
        // the four arm variants tried that gains on ALL THREE axes at once.
        A.shoulder.rotation.z = A.side * ((0.13 + back * (0.15 + POLISH * (0.11 + 0.18 * sp01))
          - POLISH * 0.05 * fwd) * cycD + spread * 1.56 + slid * 0.16);
        A.shoulder.rotation.y = -A.side * (0.16 + fwd * (0.22 + POLISH * 0.10)) * cycD;
        // Ride the whole shoulder outboard in the air as well as rotating it.
        // Worth 0.09 of span for nothing, and it keeps the arm root buried in
        // the deltoid instead of tearing a gap at the seam.
        A.shoulder.position.x = A.side * (0.222 + spread * 0.048);
        // Protraction: the shoulder GIRDLE travels with the arm instead of the
        // arm pivoting in a socket welded to the ribs. It is worth calling out
        // that this axis is invisible from the shipped camera by itself -- it
        // is pure fore-and-aft -- and it is still the single most valuable term
        // in this loop, because what the camera reads is not the displacement
        // but the fact that the deltoid, the vest seam and the sleeve hem all
        // arrive at the same time as the hand. An arm whose root is nailed down
        // reads as a hinge no matter what the hand does.
        A.shoulder.position.z = -POLISH * s * 0.026 * cycD;
        // Flexion, and it is now held at BOTH ends of the swing rather than
        // only at the front. That is a readability fix, not an anatomy one.
        //
        // Shoulder-to-hand on this rig is 0.623 -- deliberately long, because
        // reach is the only term in the spread jump pose. With flexion easing
        // off as the arm swung back, the trailing hand fell to world y=0.274
        // and the shoe tops sit at 0.25: for a third of every stride the only
        // two pale terminals on the character were four pixels apart, and an
        // art review's verdict on that was that the runner had no hands. No
        // colour or geometry survives two objects landing in the same place.
        //
        // 0.18, and the ceiling on it is not taste. Flexing HARDER swings the
        // trailing forearm further forward, not further back -- the shoulder
        // only opens 0.89 behind vertical, so past about 0.2 of extra flexion
        // the hand climbs to hip height and disappears BEHIND the hips, which
        // are 0.234 wide and 0.19 nearer the lens. Tried at 0.40 it hid the
        // hand for most of the cycle, which is a worse failure than the one it
        // was fixing. At 0.18 the hand lands at y=0.306 with the shoe tops at
        // 0.25: eight pixels of daylight at gameplay framing, low enough to
        // stay outside the hip silhouette, and squarely against open road,
        // which is the background the mitt was toned for.
        //
        // A slide straightens it instead, so the whole arm becomes one long
        // brace trailing behind the body -- flat and low against the jump's
        // wide, and neither of them the run.
        //
        // The polish pass deepens the FORWARD half of that and leaves the back
        // half exactly where the note above pinned it. The asymmetry is the
        // point of the item: an elbow that flexes by the same amount at both
        // ends of the swing is a hinge with a constant angle, and what makes a
        // real arm read is that the joint closes hard as the hand comes through
        // and opens as it goes away. 0.46 -> 0.64 is on the axis the ceiling
        // does not apply to, because the hand is climbing in FRONT of the chest
        // where nothing on this character can hide it.
        //
        // STAGE 3 puts pace on the same axis for the same reason: the ceiling
        // in the note above applies to the BACK term, where a deeper fold hides
        // the hand behind the hips, and not to this one, where the hand is
        // climbing in front of the chest with nothing on the character able to
        // cover it. So the front fold is where a faster runner's arms are
        // allowed to get bigger, and 0.18 -> 0.34 across the band costs no
        // width and no risk of losing the mitt.
        const elbowPosed =
          (-1.32 - fwd * (0.46 + POLISH * (0.18 + 0.16 * sp01)) - back * 0.18) * (1 - spread * 0.95) * (1 - slid * 0.86) - slid * 0.10;
        // ...and the mitt arrives after the elbow does. STAGE 2.
        //
        // This is a LAG FILTER, not a driven spring, and the difference is the
        // whole of why it does not read as a noodle. The spring chases the
        // posed angle, and what is added is the ERROR -- so at any held pose,
        // airborne or sliding or standing, the error is zero and the arm is
        // exactly where the pose says. Nothing static moves; only the arrival
        // does. That is also why the jump's spread silhouette comes through it
        // unchanged to four places rather than approximately.
        //
        // 55 rad/s and zeta 0.60 (k = 3025, c = 2*0.60*55 = 66). The natural
        // frequency has to sit WELL ABOVE the drive or the term stops being a
        // lag and becomes a cancellation -- at cadence 2.8 Hz the ratio is
        // 0.32, which is the whole reason the constant is where it is. Take it
        // below the drive instead and the filter stops following at all, what
        // is left is (F - posed) = -posed, and the arm ends up swinging
        // OPPOSITE its own shoulder. That is the rubber-limb failure the brief
        // forbids, and it is one constant away in the soft direction.
        //
        // Measured on the cycle rather than predicted from the constants: the
        // elbow angle comes out at 1.010x its old amplitude and 16.4 degrees
        // late, 16 ms of a 355 ms stride. What that buys on the axis the camera
        // can see is the MITT arriving 6.8 degrees (6.7 ms) late with 98.7% of
        // its old vertical range -- late, and no bigger.
        //
        // On a TRANSIENT -- a whole jump arc, takeoff through landing -- the
        // follow-through peaks at 0.0774 rad, 4.4 degrees, so the forearm whips
        // out behind the upper arm and checks. Well inside the clamp. On the
        // 7 fps harness the same arc saturates the clamp at 0.22 exactly,
        // because a frame there is 143 ms and the pose has moved most of its
        // range before the filter has integrated 20 ms of it. That is what the
        // clamp is for and it is the reason there is one.
        if (elbF[i] === null) elbF[i] = elbowPosed;
        elbV[i] += ((elbowPosed - elbF[i]) * 3025 - elbV[i] * 66) * hdt;
        elbF[i] += elbV[i] * hdt;
        A.elbow.rotation.x = elbowPosed
          + POLISH * Math.max(-0.22, Math.min(0.22, elbF[i] - elbowPosed));
      }

      // ---- torso: forward lean, vertical bob, and a lateral bank on turns
      // Two bobs per stride, lowest at each footstrike.
      // A body on the ground does not bob -- the bob is the cost of landing on
      // alternate feet, and in a slide neither foot is carrying anything.
      const bob = -Math.abs(Math.cos(p)) * BOB * (1 - air) * (1 - slid * 0.90) + BOB;
      body.position.y = bob + air * 0.09;

      // Straightens up in the air. A runner still folded forward at the apex
      // reads as a stumble, the reference jump is upright with the chest
      // open, and standing up is also what stops the spread arms from being
      // foreshortened back into the body by the lean.
      //
      // The slide term is the other half of the sign fix at the hip. A run
      // leans the chest forward; a slide reclines it BACK toward the camera,
      // over the hips it is sitting on, so the body forms one long diagonal
      // from the trailing shoulders up to the leading feet. Folding forward as
      // well as dropping -- which is what the old duck did -- put the crown of
      // the head at the front of the figure, closest to the thing it was
      // trying to get under, and that is exactly what the playtest read as
      // "diving into it".
      // Hills, one bone. A climber leans into the hill from the ankles and a
      // descender sits back off it, and the two are not symmetrical -- the
      // climb is a whole-body effort and the descent is a controlled fall, so
      // it gets half the angle. +6 degrees at the steepest legal climb, -3 at
      // the steepest descent, and both fold away in a slide with everything
      // else. Pure feel; nothing depends on the numbers.
      const gradePitch = grade > 0 ? grade * GRADE_PITCH_UP : grade * GRADE_PITCH_DOWN;
      //
      // STAGE 3, two terms, and they are the two the owner named: the held lean
      // grows with PACE and takes a temporary extra on top of it when the
      // runner is GAINING pace.
      //
      // 0.12 -> 0.19 across the band. Deliberately short of the amplitude
      // change beside it: lean has more leverage on this rig than its size
      // suggests, because a trunk tipped out of the yaw axis converts the
      // pelvis's yaw into lateral travel -- that is the mechanism stage 2
      // measured, and it is why the head's sideways sweep already grows 32%
      // from the bottom of the band to the top with nothing but lean moving.
      // Past about 0.20 the figure starts reading as bent rather than driving.
      //
      // The surge term is 0.065 at full, ~3.7 degrees, and it is the smaller of
      // this stage's two answers to "acceleration" on purpose. Lean is the cue
      // a player reads from the silhouette and push-off is the cue they read
      // from the legs, and a lean that arrives faster than the legs do is the
      // one failure mode here that looks like the character falling forward.
      const leanFwd = (0.26 + (0.12 + POLISH * 0.07) * sp01 + stumble * 0.5
          + POLISH * 0.065 * surgeLean) * (1 - slid * 0.94)
        - spread * 0.30
        - slid * SLIDE_RECLINE
        + gradePitch * (1 - slid * 0.94) * (1 - spread);
      // ...and a cyclic pitch on top of the held lean, which is the first half
      // of "the torso compresses when the foot lands". `plantW` is the two legs'
      // landing weights summed, so it peaks twice a stride at whichever foot is
      // taking the weight, and it is biased by its own mean (0.156, measured off
      // the curve rather than guessed) so the AVERAGE lean is left exactly where
      // the owner asked it to stay. Amplitude is +/- 0.017rad, one degree: this
      // is not a bow, it is the trunk giving with the impact.
      spine.rotation.x = leanFwd + trip * 0.46
        + POLISH * 0.045 * (plantW - 0.156) * cycD;
      // The second half, and the one the back view actually reads. There is one
      // trunk segment on this rig and no spine chain, so a compression has to be
      // a translation: the whole shoulder girdle, neck and head drop toward the
      // pelvis as the weight arrives, and rise off it through the drive.
      //
      // Written so the expression can never go POSITIVE. `HEIGHT` is quoted to
      // MR.Collision.audit() as the crown at the top of the bob, and a trunk
      // that stretched above its rest length on the push -- which is what a
      // signed term centred on zero would do -- would make that number quietly
      // untrue on the up-beat. `land` and `push` are supported on disjoint
      // quarters of the cycle, so at full push (0.629) plantW is 0 and the
      // bracket reaches exactly 0; everywhere else it is a compression.
      spine.position.y = -POLISH * 0.026 * (plantW - pushW * 0.55 + 0.346) * cycD;
      // Slide the whole torso BACK along the direction of travel, not just
      // recline it.
      //
      // Throwing the legs further forward does not work: hip.rotation.z opens
      // 0.70rad of splay in the slide (without it the legs vanish behind the
      // torso at this camera angle), and that splay converts most of the
      // forward throw into lateral -- pushing the hip term from 1.62 to 2.05
      // moved the feet only 0.06 further ahead of the head while lifting them
      // off the road. Translating the spine pivot is direct: legs hang off
      // `hips` and are untouched, torso and head hang off `spine` and move,
      // so the gap between shoes and crown opens without distorting either.
      spine.position.z = -slid * 0.14;
      spine.rotation.z = -lean * 0.30 - knock * 0.34;
      spine.rotation.y = lean * 0.16;

      // Counter-rotate the shoulders against the hips -- the single cue that
      // most separates a run cycle from a march, and the only thing the back
      // view sees the torso do at all. Damped in the air with the rest of the
      // cycle, so the spread pose stays square to the camera.
      //
      // All four of these are shaped by the same third harmonic the limbs are,
      // so the trunk turns over at the same moments the legs do rather than
      // gliding sinusoidally underneath them. That coupling is most of what the
      // owner meant by "the whole body doesn't participate enough": the terms
      // were already here, they were simply too small to see and running on a
      // curve of their own.
      //
      // The measured case for the amplitudes: the pelvis was contributing 7.7%
      // of the foot's fore/aft travel and the shoulder 7.5% of the hand's -- the
      // trunk was a post the limbs were hung on. Yaw both harder and the sockets
      // themselves start carrying the stride. Neither costs a millimetre of
      // silhouette width: a yaw about the body's own axis pulls a shoulder or a
      // hip socket INBOARD (0.222 * cos), so the run's half-width can only
      // shrink, and the gap to the jump's 0.92 can only grow.
      const sP = mix(Math.sin(p), sharpen(Math.sin(p), Math.sin(3 * p)), POLISH);
      chest.rotation.y = sP * (0.21 + POLISH * 0.13) * cycD;
      chest.rotation.z = -sP * (0.055 + POLISH * 0.028) * cycD;
      // Chest pitch, which did not exist before. The girdle nods forward as the
      // weight lands and opens through the drive, on the same window the spine
      // and the knees use. It is the term that puts the NECK PIVOT in motion --
      // and with it the head, which was travelling 0.0042 fore and aft, a
      // quarter of one percent of body height, on a character supposedly running.
      chest.rotation.x = POLISH * 0.055 * (plantW - 0.156) * cycD;
      hips.rotation.y = -sP * (0.14 + POLISH * 0.12) * cycD;
      // Pelvic drop toward the swinging leg: small, but it stops the hips
      // from reading as a rigid block bolted to the spine.
      hips.rotation.z = sP * (0.055 + POLISH * 0.030) * cycD;

      // Head. Running and airborne it stays level: cancel most of the spine
      // lean, add a small lag, so the eyeline holds down the road and the dark
      // hair sits above the lit neck where the pinch reads.
      //
      // The slide does the OPPOSITE, and this is the correction that settles
      // three failed passes at the pose. The old code kept the level-cancel at
      // full strength through a slide "so it presents hair and headband rather
      // than a chin" -- and measured, that stood a 0.57 skull straight up off a
      // body lying at 15 degrees: crown 1.31 against a hip line at 0.44, with
      // the brightest object on the character (the headband) ringing it. From
      // directly behind that is a head on top of a low mass, which is the
      // definition of a crouch, and no amount of leg extension can outvote it
      // because the legs point down the view axis and the head does not.
      //
      // Temple Run's slide has NO head in the silhouette: legs up the path,
      // then torso, then arms out wide nearest the lens. So the neck here
      // extends INTO the body instead of cancelling -- see NECK_SLIDE_X.
      neck.rotation.x = (-leanFwd * 0.86 + Math.sin(p * 2) * 0.035) * (1 - slid)
        + slid * NECK_SLIDE_X;
      // Roll the crown down onto the trailing shoulder. Pitch alone leaves the
      // skull symmetric about the spine, and a symmetric lump centred on the
      // body reads as a head however low it is; tipped onto one shoulder it
      // reads as part of the shoulder mass. It also turns the headband -- a
      // cylinder around the skull -- from a bright disc facing the lens into a
      // band seen nearly edge-on.
      neck.rotation.z = lean * 0.14 + slid * NECK_SLIDE_Z;
      // Turn the face off the camera axis. With the head laid back, a face left
      // square would point up and back into the lens, which is a fall, not a
      // slide; turned, the camera gets hair and an ear. The term is also what
      // it always was -- a head counter-rotated against shoulders turned by
      // SLIDE_YAW is the clearest possible statement that they are turned.
      // Shaped with the trunk it sits on, and NOT enlarged: the head counters
      // the shoulders by the same angle it always did. The point of leaving this
      // one alone is that the chest under it now turns 0.34 instead of 0.21, so
      // the same 0.10 of counter-yaw reads as a head holding its line against a
      // torso doing more work, which is what it is for.
      neck.rotation.y = -sP * 0.10 - slid * SLIDE_YAW * 1.15;
      // ...and sink it. Rotation gets the crown down; only translation gets it
      // INSIDE. The neck pivot drops along the spine until the skull is seated
      // between the deltoids, so the welded neck column disappears into the
      // vest and what is left above the back is a cap of hair rather than a
      // head on a neck. Nothing else hangs off this pivot, so it costs the
      // pose nothing anywhere else.
      neck.position.y = (NECK_Y - CHEST_Y) - slid * NECK_SLIDE_SINK;
      // ...and retract the skull down its OWN axis on top of that. Sinking the
      // neck pivot moves the head along the spine, which in a slide points at
      // the camera, so on its own it buys far less than it looks like it
      // should. Pulling the head mesh back toward its pivot is the term that
      // actually shortens the distance between the crown and the shoulders,
      // and it is why the head ends up capping the trunk instead of standing
      // off the end of it. Nothing else is parented here, so no other joint
      // moves with it.
      head.position.y = -slid * NECK_SLIDE_RETRACT;
      head.scale.setScalar(1 - slid * NECK_SLIDE_SQUASH);

      // Whole-body bank into a lane change reads as weight, not a slide.
      // The slide adds its own, tipping onto the hip it is riding on: a body
      // that goes in yawed but stays perfectly level reads as a swivel chair.
      //
      // Moved ABOVE the secondary-motion block by stage 2, and it is a pure
      // reordering: nothing between here and where it used to sit reads
      // root.rotation, so no value changes. It has to be set before the head's
      // filter runs, because this bank is part of the roll the head inherits
      // and a filter fed last frame's copy of its own input is 143 ms stale on
      // the 7fps harness.
      root.rotation.z = -lean * 0.13 - knock * 0.16 - slid * 0.12;
      // Go in at an angle. See SLIDE_YAW -- this is the term that gives the
      // back view something lateral to measure.
      root.rotation.y = slid * SLIDE_YAW;

      // ---- secondary motion ------------------------------------------------
      //
      // Everything above this line is welded to a bone, so every part of the
      // figure starts, stops and turns on exactly the frame the skeleton does.
      // That is what makes a procedural character move like a marionette, and
      // a previous review named it as the biggest remaining gap in this one.
      // Two things now lag the body, and both were picked because the camera
      // is dead astern: they are the two largest pieces of CLOTH the back view
      // sees, and cloth is the only thing on a runner that is allowed to
      // arrive late.
      //
      // The hood hangs off the collar, not off a joint, so it is integrated
      // rather than posed: the target is what the body is doing and the hood
      // gets there afterwards. Underdamped at zeta ~0.45, because the
      // overshoot IS the effect -- a critically damped hood is a rigid part
      // with a delay and reads as one.
      //
      // dt is clamped for the integrator alone. This harness runs at 7fps
      // under SwiftShader and a phone runs at 60; a spring stiff enough to be
      // worth having at 60 diverges at 7. Clamping the step makes one set of
      // constants behave at both, at the cost of the hood settling in real
      // seconds rather than in frames -- which is the right way round, since
      // nothing reads its value.
      // (`hdt` is hoisted to the top of update() now that the arm loop springs
      // on it too; the reasoning above is why it is clamped.)
      //
      // What the hood is bolted to is the COLLAR, and the collar is not the
      // bob. Stage 1 gave the trunk its own compression -- the whole girdle
      // drops toward the pelvis as the weight lands and rises through the
      // drive -- and the hood was still being driven by `bob` alone, i.e. by
      // the half of the collar's motion that existed before that pass. Feeding
      // it the sum is stage 2's cheapest item and its most literal reading of
      // the brief: there is now real motion for things to lag behind, and this
      // thing was not being shown it. At POLISH 0 `spine.position.y` is
      // identically zero and the sum is bit-for-bit `bob`, so the A/B is
      // undisturbed.
      const collarY = bob + spine.position.y;
      // The divided difference is clamped before it is used: one long frame
      // after an alt-tab hands this a spike no spring should be asked to
      // follow, and the clamp is cheaper than filtering it.
      const bobV = dt > 1e-4 ? Math.max(-1.6, Math.min(1.6, (collarY - lastBob) / dt)) : 0;
      lastBob = collarY;
      // Body drops, hood swings up the back; jump throws it up; slide presses
      // it flat. The positive clamp is tighter than the negative one because
      // up is toward the head: at +0.30 the roll's far edge rises to 0.167 in
      // chest space, still 0.05 clear of the skull, and anything past that
      // starts filling the head/shoulder pinch the silhouette is built on.
      const hoodRest = spread * 0.34 - slid * 0.30 - bobV * 0.18;
      hoodV += ((hoodRest - hoodA) * 96 - hoodV * 8.8) * hdt;
      hoodA += hoodV * hdt;
      hoodPivot.rotation.x = Math.max(-0.50, Math.min(0.30, hoodA));
      // ...and a second spring across the lane, so a lane change throws the
      // hood sideways and it swings back a beat after the body has settled.
      //
      // STAGE 2 gives that spring something to do while the runner is going
      // STRAIGHT, which is where it spends almost the whole race. Measured on
      // the shipped cycle: the hood's own lateral travel correlates 0.996 with
      // the trunk it hangs off at exactly zero lag -- the largest piece of
      // cloth on the character was welded on every axis the back view can see,
      // because both of its springs were driven by inputs (`bob`, `lean`) that
      // carry no lateral stride content at all.
      //
      // The drive is the stride's own sideways throw. It is not a roll: the
      // trunk's two roll terms very nearly cancel above the chest (hips +0.085,
      // chest -0.083). What actually swings the upper body sideways is the
      // PELVIS YAW acting on a trunk the forward lean has already tipped out
      // of the yaw axis, which is why the head measures 0.167 of lateral travel
      // -- the largest figure on the rig -- with nothing rolling it.
      //
      // Left as a DRIVEN spring rather than a lag filter, and that is the split
      // this file now runs on: limbs and the head get lag filters (chase the
      // pose, add the error, zero at any held pose), cloth gets a driven soft
      // spring. At 9.8 rad/s against a 2.8 Hz stride the hood cannot follow --
      // ratio 1.8 -- and it comes back measured at 140 degrees behind its own
      // drive. On a limb that would be the rubber failure. On a hood it is the
      // point: it arrives visibly off the beat, and because the pitch spring
      // runs at TWICE cadence (the bob does two per stride) the two together
      // trace a small figure-eight instead of a line.
      //
      // 0.20 of drive measures 0.081 rad of roll amplitude on the ring, 0.163
      // peak to peak, moving its ends about 0.015 -- two pixels at gameplay
      // framing. That is the size this is allowed to be: the hood sits in the
      // head/shoulder pinch the whole silhouette is built on (header rule 1),
      // and anything that reads as a swinging object there is reading as a
      // wider neck.
      const hoodZRest = -lean * 0.30 - knock * 0.30 - POLISH * 0.20 * sP * cycD;
      hoodZV += ((hoodZRest - hoodZ) * 96 - hoodZV * 8.8) * hdt;
      hoodZ += hoodZV * hdt;
      hoodPivot.rotation.z = Math.max(-0.42, Math.min(0.42, hoodZ));

      // ---- the head settles -------------------------------------------------
      // STAGE 2, and the item the owner named first.
      //
      // The starting measurement contradicts the brief that asked for it, so it
      // is worth writing down. The head is NOT the least-travelled thing on
      // this rig: it moves 0.167 laterally across a stride, which is more than
      // the foot (0.115) and two and a half times the chest (0.066), and it is
      // the largest lateral figure the rig produces. The 0.033 that made it
      // look weak is its FORE-AND-AFT travel, and fore and aft is the axis this
      // camera cannot see. So the head does not need more amplitude. It needs
      // the amplitude it already has to stop arriving on the same frame as the
      // shoulders: cross-correlated against the trunk, the skull comes back at
      // r = 0.996 and lag 0.000. It is welded, and that is the whole defect.
      //
      // A LAG FILTER, like the elbows and unlike the hood. The filter chases
      // the roll the head inherits and the neck is given the ERROR, so the head
      // ends up wearing the FILTERED trunk instead of the live one. At a held
      // pose the error is zero, so nothing static moves -- no silhouette, no
      // crown height, no contract with collision.js.
      //
      // 40 rad/s, zeta 0.55 (k = 1600, c = 44). Softer than the elbow on
      // purpose: a head is heavier relative to what carries it than a forearm
      // is, so it should arrive later, and the measured 13.1 degrees against
      // the elbow's 16.4 on its own angle is that difference stated. Measured
      // on the skull rather than on the joint: the lateral sweep arrives 13.1
      // degrees (12.9 ms) late at 1.00x its old amplitude, and total lateral
      // travel goes 0.1673 -> 0.1774.
      //
      // ON A LANE CHANGE, and this is the one place the predicted behaviour was
      // wrong and the measurement corrected it. The filter's step response
      // overshoots 12.6% on paper. It does not overshoot in the game, because
      // player.js ramps `lean` through its own first-order filter at tau = 0.14
      // s, which is SLOWER than this one -- so what a lane change actually
      // shows is lag and no overshoot at all. Measured at 60 fps against the
      // same phase sequence with no lean: the head has taken up 30% of the
      // bank's neck roll on the first frame where the bare pose takes 11%, it
      // never goes past the settled value, and it is inside 5% of it by 0.37 s.
      // Overshoot appears only when the input steps faster than the filter can
      // follow, which on the 7 fps harness saturates the 0.11 clamp and lands
      // 34.5% past settled for one frame. Both finite; 60 s of sign-flipping
      // lean, bounce and air at the clamped step stays pinned at the clamps and
      // never winds up.
      //
      // WHY THE VERTICAL AXIS IS NOT DONE, having been tried. The head's bob
      // runs at TWICE cadence, 5.6 Hz or 35 rad/s, and the integrator's step is
      // clamped at 1/50 s, which puts a hard ceiling near 100 rad/s on any
      // spring in this file. A filter that must sit well above 35 to LAG rather
      // than CANCEL has no room left under that ceiling: every tuning tried
      // came back with the filtered value near zero, i.e. a head that stops
      // bobbing. A head that stops bobbing is not secondary motion, it is less
      // motion, and it is one step from a bobblehead. The roll works precisely
      // because it runs at ONE per stride and there is an octave of room.
      //
      // The stride term is the part that is not inherited. See the hood note:
      // almost none of the head's sideways swing comes from anything rolling,
      // so a filter fed only the trunk's roll terms would have had nothing to
      // chase while the runner was going straight.
      //
      // 0.110, and where the line is was found by looking rather than by
      // measuring, because "floppy" is not a quantity. Three builds, rendered
      // as head-and-shoulders sheets at about four times the size the game
      // ships the character at:
      //
      //   0.070  neck roll 0.094 rad p2p (5.4 deg), skull 8.4 deg late.
      //          Reads. Conservative.
      //   0.110  neck roll 0.147 rad p2p (8.4 deg), skull 13.1 deg late.
      //          The cap band's tilt is unmistakable frame to frame and the
      //          neck still reads as carrying the head. TAKEN.
      //   0.180  neck roll 0.220 rad p2p (12.6 deg), skull 20.6 deg late.
      //          The skull visibly overhangs the neck column at the extremes.
      //          This is where it stops being a runner's head rolling with the
      //          stride and starts being a head rocking ON something. Refused.
      //
      // The sign was also found rather than reasoned, and the first one was
      // wrong: with the term negative the skull's lateral sweep came back 7.7
      // degrees EARLY, which is a head that anticipates its own shoulders.
      // Nothing about the arithmetic says which way that goes -- it depends on
      // the phase the filter lands at against a drive it is chasing -- so it is
      // measured, and the measurement is the only reason to believe it.
      const headRoll = hips.rotation.z + spine.rotation.z + chest.rotation.z
        + root.rotation.z + 0.110 * sP * cycD;
      if (headRF === null) headRF = headRoll;
      headRV += ((headRoll - headRF) * 1600 - headRV * 44) * hdt;
      headRF += headRV * hdt;
      // Damped out of the slide entirely. The slide's crown is the trunk and
      // the leading shoe with the head 0.02 under them (see NECK_SLIDE_X), and
      // 0.04 of roll on a 0.29 headband is enough to put the head back on top
      // of a pose whose whole argument is that it is not.
      neck.rotation.z += POLISH * (1 - slid)
        * Math.max(-0.11, Math.min(0.11, headRF - headRoll));

      // The bib's hem. The reference's runner has a printed graphic that is
      // dead still and CLOTH around it that is not, and that contrast is most
      // of why theirs reads as worn and ours read as painted on. The panel is
      // pinned along its top edge and held flat in the middle by the back
      // behind it, so the drive is a travelling wave in theta: the two free
      // bottom corners lift out of phase with each other and the number never
      // moves. One buffer upload, no draw call.
      //
      // Rate and amplitude both climb with pace, which makes this a speed cue
      // as well as a life cue -- it is the only motion on the character that
      // is not locked to the stride, so it beats against the cadence instead
      // of reinforcing it, and that is what stops the whole figure reading as
      // one clockwork.
      //
      // The lift is now ONE-SIDED, and that is a bug fix rather than a taste
      // change. A signed sine put the free corners 0.05 INTO a vest whose
      // surface is only 0.008 behind the panel, so for half of every cycle the
      // vest's red cut a wave across the bottom of the white card -- which the
      // art review read, correctly, as the bib straddling the hem crooked. A
      // panel pinned to a back can lift off it and cannot pass through it, so
      // the drive is biased into [0, 1] and the corners now alternate between
      // lifted and flat instead of between out and in. The amplitude is raised
      // to compensate for losing half the swing.
      bibT += dt * (5.2 + 6.4 * sp01);
      // 0.046, not the 0.036 the two-sided version used: half the range is now
      // spent on the flat side, and measured off a burst of frames a corner has
      // to travel about 0.05 before the strip can resolve it moving at all.
      // Past about 0.08 of outward travel the corner visibly leaves the vest
      // and the panel reads as unstuck rather than as fluttering.
      const bibAmp = (0.046 + 0.020 * sp01) * (1 - slid * 0.55) + spread * 0.018;
      const bp = bibPos.array;
      for (let i = 0; i < bibPos.count; i++) {
        const w = bibWeight[i];
        if (w <= 0) continue;
        const lift = (0.5 + 0.5 * Math.sin(bibT + bibTheta[i] * 3.4)) * bibAmp * w;
        // Radial, because the panel is curved: scaling x and z about the
        // vest's own axis lifts the corner off the back, where moving it in a
        // straight line would shear it sideways across the number.
        const k = 1 + lift / BIB_R;
        bp[i * 3] = bibRest[i * 3] * k;
        bp[i * 3 + 2] = bibRest[i * 3 + 2] * k;
        bp[i * 3 + 1] = bibRest[i * 3 + 1] + lift * 0.70;
      }
      bibPos.needsUpdate = true;

      // Ducking drops the whole body rather than only folding the spine, so
      // the collision capsule and the silhouette agree. The 0.42 matches
      // Collision.PLAYER_DUCK_DROP; changing it here would silently break
      // that module's audit.
      //
      // Deliberately driven by the raw duck01 and not by `slid`, because 0.42
      // is a contract with a module that models the drop as linear in duck01,
      // and a smoothstep here would make collision.js's arithmetic wrong at
      // every value between the ends.
      //
      // 0.42 is now much the smaller half of the truth, and the gap is worth
      // writing down because it is a contract with another module. The recline,
      // the neck tuck and the road clamp all press the crown further down on
      // top of this drop, so at the DUCK_CLEAR threshold of 0.90 the head
      // measures 0.73 where audit() computes 1.60 - 0.42*0.90 = 1.22 against a
      // bar at 1.41. The 0.49 of error points the only way it is allowed to --
      // the real head is LOWER than collision.js believes, never higher -- so
      // the audit stays honest and simply understates the daylight it buys.
      // Net of the clamp the body itself drops 0.26 of the 0.42 (it was 0.13
      // before this pass, when a buried trail foot was eating the rest).
      body.position.y -= duck * 0.42;

      // Road clamp. The slide recline plus the braced arms put the lowest
      // welded limb 0.37 BELOW the tarmac -- limbs were passing through the
      // road, which is most of why the pose read as broken rather than as
      // low. Rather than hand-tune each joint until nothing pokes through
      // (which has to be redone every time the pose changes), measure the rig
      // once per frame and lift the whole body by however much it is buried.
      //
      // Cheap enough to do every frame: the rig is a handful of welded meshes,
      // and it only runs while sliding. `body` is lifted rather than `root` so
      // the contact shadow, which hangs off its own pivot under root, stays on
      // the road where it belongs.
      //
      // It is also a diagnostic, and reading it is what found the last bug in
      // this pose. The lift tells you which single part is deepest, and for
      // three passes that part was the TRAIL SHOE, 0.29 under the road, so the
      // clamp was spending two thirds of the duck's drop hauling one foot out
      // of the tarmac. Fix the foot (see the hip term) and the same 0.42 of
      // drop buys 0.26 of real descent instead of 0.13 -- no constant changed,
      // the body simply stopped fighting itself. The lift now settles on the
      // trail shin and the tucked head, which is a body resting on the road.
      if (duck > 0.01) {
        root.updateMatrixWorld(true);
        _clampBox.setFromObject(body);
        if (_clampBox.min.y < 0) body.position.y -= _clampBox.min.y;
      }
      api.duckDrop = duck * 0.42;

      // Shadow footprint, handed to onBeforeRender above. Wider than deep
      // because the runner is, and it tightens and darkens on each footstrike
      // with the bob -- a blob of constant size under a body that is visibly
      // rising and falling reads as a sticker travelling with it.
      //
      // The slide is where the blob earns its place: the body is flat and
      // pointing away from the camera, so almost none of its length is
      // visible, and the shadow is the only thing in frame that can be long.
      // It goes the opposite way to the old duck's -- narrower and much
      // deeper, roughly the footprint of a body lying down -- and the plant
      // pulse is damped out with the bob that caused it.
      const plant = 1 - Math.abs(Math.cos(p)) * 0.10 * (1 - air) * (1 - slid * 0.90);
      shadowW = (1.30 - slid * 0.18) * plant;
      shadowD = (0.96 + slid * 1.34) * plant;
      shadowA = (1 + slid * 0.48) * (2 - plant);

      // ---- skid ------------------------------------------------------------
      // Only the state lives here; the simulation runs in onBeforeRender where
      // the group's position for THIS frame is finally known. See the hook.
      fxDt = dt;
      fxSlid = slid;
      if (slid > 0.02) {
        // Rising edge. Clear the previous slide's marks -- a trail that
        // survived to the next one would be laid down between two points the
        // runner never travelled between -- and throw the entry burst.
        //
        // The burst is doing as much work as the trail. Entry is the one
        // moment a slide is unambiguous from any angle: the body drops and the
        // road erupts under it. A held frame cannot make that argument, and
        // the pose the player actually has to name is the one they saw arrive.
        if (fxLive <= 0) { fxReset(); fxBurst = 12; }
        fxLive = 1;
      } else {
        fxLive = Math.max(0, fxLive - dt * 1.7);
      }

      // ---- jump and landing --------------------------------------------
      // Edge-detected here rather than in the fx hook because `air` is exact
      // on both ends: main.js passes sin(airT*PI), which is strictly positive
      // for the whole arc and exactly zero the instant the player state says
      // the feet are down. Height would not do -- root.position.y is a frame
      // behind at takeoff, which is the one frame that has to be right.
      const flying = air > 0;
      if (flying !== wasFlying) {
        wasFlying = flying;
        bAge = 0;
        if (flying) {
          // Take-off. Fired from mid-torso and slightly weaker than the
          // landing: the character is on its way up and the streaks read as
          // the push, not the impact.
          bTtl = STREAK_LIFE; bY = 0.86; bPow = 0.95; bKick = 7;
        } else {
          bTtl = STREAK_LIFE * 1.12; bY = 0.30; bPow = 1.15; bKick = 11;
        }
        // The burst throws dust, and dust only simulates while the pivot is
        // live, so give it a life of its own independent of the slide's.
        bLive = 1;
      }
      // The dust from a burst outlives the streaks; hold the pivot open for
      // the longest puff TTL rather than for the burst.
      bLive = Math.max(0, bLive - dt * 1.4);

      // Only lit while there is height to report. A kerb hop never flashes it,
      // and a run never pays for it.
      reticle.visible = flying;

      fxPivot.visible = fxLive > 0.01 || bLive > 0.01;
      skidMat.opacity = 0.72 * fxLive;
      // The slide fades its dust out with the slide; a burst's dust has to
      // stay at full strength for its own short life or it never reads.
      dustMat.opacity = Math.max(fxLive, bLive);
    };

    api.update(0, {});
    return api;
  }

  // POLISH is exposed as an accessor rather than a plain field so that the
  // closure the cycle actually reads is the one the setter writes -- a data
  // property on this object would be a second copy that `api.update` never
  // sees. Clamped and validated here rather than at every call site: main.js
  // hands it a URL parameter and stride.js hands it a command-line argument,
  // and neither should be able to put a NaN into every joint on the character.
  return {
    create,
    HEIGHT,
    get POLISH() { return POLISH; },
    set POLISH(v) {
      const n = parseFloat(v);
      if (isFinite(n)) POLISH = Math.max(0, Math.min(1, n));
    },
  };
})();
