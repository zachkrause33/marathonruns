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
 *   2. The back needs its own value structure, and the order matters.
 *      Top to bottom it runs red cap / bright band / dark brim / dark hair /
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
 *      waistband, short cuff, sock, shoe collar -- and this one was a smooth
 *      cylinder with a number on it. Every hem added here is welded into a
 *      part that already existed, so the whole wardrobe costs two draw calls
 *      (the hood, which has to move on its own) and not one vertex of extra
 *      width: see the note above the colour block, and the hand, which pays
 *      for its fingers out of its own palm.
 *   8. Nothing on a rig where every part is bolted to a joint can arrive late,
 *      and everything real does. Two things here are not bolted to a joint:
 *      the hood, on a pair of underdamped springs, and the bib's hem, on a
 *      travelling wave with its own clock. They are the two largest pieces of
 *      cloth the back view sees, which is not a coincidence -- cloth is the
 *      only thing on a runner that is allowed to lag.
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
  const GLOVE = P.runnerShoe;

  // ---- the wardrobe ------------------------------------------------------
  //
  // What separates the reference characters from a coloured cylinder is that
  // they read as a PERSON WEARING CLOTHES: every garment has an edge, and the
  // edges are where one tone meets a neighbouring one. Subway Surfers' runner
  // from behind is a stack of hems -- cap band, hood roll, jacket collar,
  // jacket hem, waistband, short cuff, sock, shoe collar -- and none of them
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
  const JACKET = 0xd6394e;   // cap brim, vest collar, vest hem, sleeve cuff -- under the vest
  const BASE = 0xb9c4de;     // base-layer tee, seen only as the sleeves
  const WAIST = 0x434a80;    // hood, waistband, short cuff -- one step over the shorts
  const SHOE_DK = 0x5f6796;  // heel counter and lace panel
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

  /**
   * Weld several primitives into one geometry, baking each piece's colour
   * into a vertex-colour attribute.
   *
   * Every part is outlined, so a part costs two draw calls. Welding the
   * pieces that never move relative to each other -- skull + cap + brim +
   * hair + nape + band + ears + neck, vest + shoulders + collar + hem, shoe +
   * sole + heel counter + laces -- is what pays for the extra detail this
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

  // There is no single-primitive part() any more. The last two holdouts were
  // the thigh and the upper arm, and the wardrobe pass gave both of them
  // something welded on -- a hamstring and a sleeve -- so every part on the
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

  // The one thing on the character that says "marathon" rather than
  // "runner", and it belongs on the back where the player can see it.
  // Generated at runtime like world.js's mile banners -- still no assets.
  let bibTex = null;
  function raceBib() {
    if (bibTex) return bibTex;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#fffdf5';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#' + new THREE.Color(P.runnerVest).getHexString();
    g.fillRect(0, 0, c.width, 8);
    g.fillRect(0, c.height - 8, c.width, 8);
    g.fillStyle = '#1b1633';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Fit rather than trust: the first version hard-coded 62px and the
    // string overflowed the canvas on a machine without Helvetica, so the
    // back of the vest read "6." instead of a race number.
    let px = 64;
    do {
      g.font = 'bold ' + px + 'px Helvetica, Arial, sans-serif';
      px -= 2;
    } while (px > 20 && g.measureText('26.2').width > c.width * 0.82);
    g.fillText('26.2', c.width / 2, c.height / 2 + 3);
    bibTex = new THREE.CanvasTexture(c);
    return bibTex;
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
      { g: new THREE.CylinderGeometry(0.228, 0.220, 0.25, 12), c: P.runnerShort, y: -0.020, sz: 0.78 },
      // Waistband. The vest's hem stops at world 0.590 and the shorts run down
      // to 0.407, so this is the only band that can turn one continuous dark
      // mass into "a top tucked over a bottom" -- which is the single cheapest
      // human read on the whole figure, because the eye already expects a
      // person to be two garments. It has to sit BELOW the vest hem to exist
      // at all; anything above 0.586 is inside the vest and invisible.
      { g: new THREE.CylinderGeometry(0.234, 0.232, 0.052, 10), c: WAIST, y: 0.000, sz: 0.79 },
      // ...and the short's own cuff at the leg opening, so the thighs come out
      // of a hem rather than out of a hole. Straddles the shorts' bottom edge
      // on purpose: a band that stops short of it leaves a sliver of the old
      // hard cut still showing under it.
      { g: new THREE.CylinderGeometry(0.236, 0.230, 0.044, 10), c: WAIST, y: -0.126, sz: 0.79 },
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
      // singlet worn over the waistband, so the red reads as one wide squat
      // block the way the reference shirts do rather than as a torso.
      { g: new THREE.CylinderGeometry(0.262, 0.238, 0.28, 12), c: P.runnerVest, y: -0.037, sz: 0.78 },
      // Deltoids. These are what make the shoulder line read wider than the
      // head; without them the trunk cone tapers into the skull. Flattened
      // hard in Y so they widen the shoulders without raising them. Their
      // outer edge is the 0.78 shoulder measurement constants.js cuts the
      // lane width from -- move them and the whole track has to move.
      { g: new THREE.SphereGeometry(0.140, 10, 8), c: P.runnerVest, x: -0.244, y: 0.002, sy: 0.76, sz: 0.84 },
      { g: new THREE.SphereGeometry(0.140, 10, 8), c: P.runnerVest, x: 0.244, y: 0.002, sy: 0.76, sz: 0.84 },
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
      { g: new THREE.CylinderGeometry(0.266, 0.259, 0.026, 12), c: JACKET, y: 0.088, sz: 0.79 },
      // Hem. The vest used to end on a hard cut into the shorts, which is what
      // made the trunk read as one moulded mass from the neck to the knees.
      { g: new THREE.CylinderGeometry(0.244, 0.242, 0.030, 12), c: JACKET, y: -0.166, sz: 0.79 },
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
    // dark against the neck, and it gives WAIST its third hit -- hood,
    // waistband, short cuff -- which is the rhythm TRIM already runs.
    const hoodPivot = pivot(chest, 0, 0.048, -0.045);
    const hood = multi([
      // sz, not sy: weld() composes T*R*S, so the squash lands on the geometry
      // BEFORE it is laid flat, and the tube's axis is still the original z.
      // Squashing y here would flatten the ring instead of the roll.
      { g: new THREE.TorusGeometry(0.180, 0.074, 5, 12, Math.PI * 1.30), c: WAIST,
        rx: -Math.PI / 2, rz: -0.42, sz: 0.76 },
    ]);
    hoodPivot.add(hood);

    // Curved panel rather than a flat card so it hugs the vest at this size,
    // and high on the back so it never straddles the shorts line -- but 0.042
    // lower than it was, and 0.010 shorter, to clear the hood roll above it.
    // The number is the one piece of type on the character and a hood crossing
    // its top edge would read as a printing fault rather than as cloth.
    //
    // Cone, not cylinder: matched to the vest's taper. A constant-radius panel
    // let the wider top of the vest poke through the number.
    const bibGeo = new THREE.CylinderGeometry(0.266, 0.256, 0.150, 10, 1, true, Math.PI - 0.52, 1.04);
    const bib = new THREE.Mesh(bibGeo, S.toon(0xffffff, 3));
    bib.material.map = raceBib();
    bib.position.y = -0.062;
    bib.scale.z = 0.78;
    chest.add(bib);

    // The bib's own flutter, precomputed. It is a paper panel pinned along its
    // top edge and held flat in the middle by the back behind it, so the free
    // CORNERS of the hem are the only part that can lift -- which is also the
    // only part with an edge against the vest for the eye to track. Weight
    // falls off as the square of the height so the top row never moves and the
    // texture cannot shear.
    //
    // 22 vertices, rewritten in place each frame. The rest pose is kept
    // because the deformation has to be absolute rather than incremental: an
    // incremental one accumulates float error over a 2-hour race and the panel
    // slowly inflates off the vest.
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
    const BIB_R = 0.26;

    // Secondary-motion state. Two springs for the hood and a free-running
    // clock for the bib; see the block at the end of update() for why they are
    // integrated rather than driven straight off the stride phase.
    let hoodA = 0, hoodV = 0, hoodZ = 0, hoodZV = 0, lastBob = 0, bibT = 0;

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
      { g: new THREE.CylinderGeometry(0.104, 0.122, 0.32, 10), c: P.runnerSkin, y: HY - 0.300 },
      { g: new THREE.SphereGeometry(0.266, 16, 12), c: P.runnerSkin, y: HY, sy: 1.06, sz: 0.97 },
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
      { g: new THREE.SphereGeometry(0.288, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), c: CAP, y: HY },
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
      { g: new THREE.SphereGeometry(0.286, 14, 8, Math.PI * 1.5 - 1.83, 3.66, Math.PI * 0.40, Math.PI * 0.37), c: P.runnerHair, y: HY },
      // The hairline. The hair shell ends on a clean latitude arc, which is a
      // haircut no human has: what the back view of a real head shows is the
      // hair narrowing to a taper down the middle of the neck. 0.14 across and
      // 0.14 long, standing 0.018 proud of the neck cylinder so it is a shape
      // rather than a decal, and it is the single detail that most turns the
      // head/neck junction from an assembly into an anatomy.
      { g: new THREE.SphereGeometry(0.090, 8, 6), c: P.runnerHair, y: HY - 0.225, z: -0.058, sx: 0.62, sy: 1.05, sz: 0.85 },
      // Cap band, sitting above the eye line -- lower and it reads as goggles.
      // Unchanged: it was the headband and it is now the cap's sweatband, and
      // holding its exact geometry is what keeps the measured value ladder
      // (dark / bright / dark / lit neck) untouched by all of this.
      // Radius has to clear the shells everywhere: two this close together
      // interpenetrate on their facets and the crown grew a row of teeth.
      { g: new THREE.CylinderGeometry(0.294, 0.294, 0.074, 14), c: TRIM, y: HY + 0.060 },
      // The brim, worn backwards -- which is the only way a brim is worth
      // drawing here, because forwards it points down the view axis and is
      // gone. Backwards it points AT the lens, and the chase camera looks down
      // about 18 degrees, so what the player sees is the top face of it: a
      // hard horizontal lozenge cutting across an otherwise perfectly round
      // skull, and a shadow line where it overhangs the hair.
      //
      // Tilted up 0.30rad so the far edge rises to 0.134 -- well under the
      // crown at 0.288, so it adds nothing to HEIGHT, and 0.298 wide against
      // the band's 0.294, so it adds nothing to the half-width either. It is
      // pure value pattern, which is the only currency this camera has.
      //
      // JACKET rather than the crown's own red, and that is the whole of
      // whether it exists. Rendered in the cap colour the brim was invisible:
      // it is a shelf seen from 20 degrees above, so what the player sees is
      // its TOP FACE, and a top face the same colour as the dome behind it is
      // a shape with no edge. One step darker and it separates into a plane.
      //
      // An ELLIPSE, narrow across and long back, and that shape is the whole
      // repair on this part. A round half-disc big enough to overhang put a
      // third shell within 0.015 of the skull's 0.266 and the band's 0.294 --
      // three surfaces inside one outline width -- and the ink shell punched
      // through both in a ring of dark wedges: the same row of teeth the
      // headband note warns about, arrived at from a different direction.
      // Squashed to 0.185 across it is buried inside the skull everywhere
      // except behind it, so the only part that draws at all is the shelf.
      //
      // Held nearly level (0.06rad) rather than cocked up, which is the
      // difference between a brim and a stripe. The camera is only about 20
      // degrees above it, so a point 0.33 nearer the lens draws 0.11 LOWER on
      // screen than one at the same height on the skull -- a brim cocked up
      // 0.34 climbs almost exactly that, the two cancel, and the first version
      // projected as a band across the middle of the cap rather than as a
      // shelf standing off the back of it.
      { g: new THREE.CylinderGeometry(0.250, 0.250, 0.034, 12, 1, false, Math.PI * 0.5, Math.PI), c: JACKET,
        y: HY + 0.030, z: -0.085, rx: 0.06, sx: 0.74, sz: 1.30 },
      { g: new THREE.SphereGeometry(0.080, 8, 6), c: P.runnerSkin, x: -0.254, y: HY - 0.020, z: -0.013, sx: 0.48, sz: 0.82 },
      { g: new THREE.SphereGeometry(0.080, 8, 6), c: P.runnerSkin, x: 0.254, y: HY - 0.020, z: -0.013, sx: 0.48, sz: 0.82 },
    ]);
    head.add(headMesh);

    // Eyes are flat unlit discs so they never band or catch a highlight.
    // Welded into one mesh -- they are a single draw the back view never
    // spends, but the character still needs a face for the finish framing.
    const eyes = new THREE.Mesh(weld([
      { g: new THREE.CircleGeometry(0.056, 12), c: P.ink, x: -0.100, y: HY - 0.016, z: 0.262 },
      { g: new THREE.CircleGeometry(0.056, 12), c: P.ink, x: 0.100, y: HY - 0.016, z: 0.262 },
    ]), S.flat(0xffffff, { vertexColors: true }));
    head.add(eyes);

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
        { g: new THREE.CapsuleGeometry(0.114, 0.100, 3, 10), c: P.runnerSkin },
        { g: new THREE.SphereGeometry(0.120, 8, 6), c: P.runnerSkin, y: 0.052, z: -0.020, sx: 0.93, sy: 1.02 },
      ]);
      thigh.position.y = -0.108;
      hip.add(thigh);

      const knee = pivot(hip, 0, -0.215, 0);
      // Sock welded onto the shin: a pale band low on the leg makes the
      // scissor of the run cycle legible from directly behind.
      const shin = multi([
        { g: new THREE.CapsuleGeometry(0.096, 0.050, 3, 10), c: P.runnerSkin, y: -0.076 },
        // The joint itself, sitting exactly on the pivot. The recovery knee
        // flexes to 1.48rad and at that angle two straight capsules meeting at
        // a point open a visible notch on the outside of the bend -- the leg
        // read as two parts hinged rather than as a leg. A ball on the pivot
        // is always the joint whatever the angle, and it is skin-coloured
        // because a knee is not a garment: it adds FORM for the ramp to catch,
        // not a new value.
        { g: new THREE.SphereGeometry(0.098, 8, 5), c: P.runnerSkin, sz: 0.94 },
        // Calf. The one muscle the back view actually sees, and the reason a
        // straight tube reads as a doll's leg: a human shin is thickest just
        // under the knee and tapers to nothing at the ankle. Kept inside the
        // thigh's radius at rest so it only emerges as the knee bends, which
        // is exactly when a calf should show.
        { g: new THREE.SphereGeometry(0.101, 8, 6), c: P.runnerSkin, y: -0.055, z: -0.012, sx: 0.92, sy: 1.20, sz: 0.94 },
        { g: new THREE.CylinderGeometry(0.110, 0.102, 0.085, 10), c: P.runnerShoe, y: -0.118 },
      ]);
      knee.add(shin);

      const ankle = pivot(knee, 0, -0.150, 0);
      // Oversized trainer, and domed rather than a bare box. A box presents a
      // hard rectangle to the camera the instant the recovery foot rotates
      // sole-on, which is most of what made the old shoe read as a held
      // object; a rounded toe, heel and outsole keep it a shoe from every
      // angle the cycle puts it in. See SOLE for why the underside is the
      // value it is.
      const foot = multi([
        { g: new THREE.BoxGeometry(0.190, 0.110, 0.225), c: P.runnerShoe, y: -0.036, z: 0.036 },
        { g: new THREE.SphereGeometry(0.095, 10, 8), c: P.runnerShoe, y: -0.036, z: 0.150, sy: 0.82, sz: 0.66 },
        { g: new THREE.SphereGeometry(0.092, 8, 6), c: P.runnerShoe, y: -0.026, z: -0.072, sy: 0.86, sz: 0.74 },
        // Heel counter. The best-value detail on the whole character, because
        // the back of a shoe is the ONE face of the runner the chase camera
        // gets square-on for the entire race -- no foreshortening, no angle,
        // both of them, all the time. A real trainer puts a stiffened cup
        // there in a different material and every reference shoe shows it.
        // Narrower in x than the heel dome behind it so the two surfaces cross
        // transversally instead of nesting: a patch fractionally SMALLER than
        // the shell it sits on is the coin-of-scalp bug the hair cap had, and
        // this one is deliberately proud in z and inset in x.
        { g: new THREE.SphereGeometry(0.098, 8, 6), c: SHOE_DK, y: -0.030, z: -0.076, sx: 0.90, sy: 0.72, sz: 0.72 },
        // Lace panel across the instep. Invisible head-on, which is why it is
        // cheap -- but the camera looks DOWN about 18 degrees, so the top face
        // of the planted shoe is in view on every footstrike, and a shoe with
        // nothing on its upper reads as a clog.
        { g: new THREE.BoxGeometry(0.078, 0.030, 0.150), c: SHOE_DK, y: 0.020, z: 0.070 },
        // Thin accent stripe, and thin is the point: it is a crisp bright line
        // from behind and almost nothing from below, which is the opposite of
        // where the accent used to sit.
        { g: new THREE.BoxGeometry(0.196, 0.028, 0.240), c: TRIM, y: -0.100, z: 0.036 },
        // Outsole as a squashed ellipsoid rather than a slab, so the face it
        // turns to the camera on the recovery swing is a rounded oval that
        // still reads as the bottom of a shoe.
        { g: new THREE.SphereGeometry(0.140, 12, 8), c: SOLE, y: -0.122, z: 0.036, sx: 0.70, sy: 0.22, sz: 0.90 },
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
      // The base layer, and the only place it is ever seen. "A race vest over
      // a base layer" is what the reference wears and what a marathon runner
      // wears, but from behind the trunk is entirely vest and entirely bib --
      // there is nowhere on it for a second garment to show. The upper arm is
      // where it can: a sleeve emerging from under the deltoid, ending in its
      // own rolled cuff, turns a bare skin tube into an arm in a shirt. Two
      // hits, symmetric, at the widest part of the figure.
      //
      // The sleeve's top is tucked UNDER the deltoid sphere (which reaches to
      // -0.100 in this frame) so the join is hidden by the shoulder's own
      // curve rather than showing as a ring where the singlet ends.
      const upper = multi([
        { g: new THREE.CapsuleGeometry(0.086, 0.095, 3, 10), c: P.runnerSkin, y: -0.122 },
        { g: new THREE.CylinderGeometry(0.101, 0.096, 0.090, 10), c: BASE, y: -0.108 },
        { g: new THREE.CylinderGeometry(0.100, 0.098, 0.024, 10), c: JACKET, y: -0.160 },
      ]);
      shoulder.add(upper);

      // Arms are the one place the toy proportion is knowingly broken: shoulder
      // to fingertip is 1.1 head-lengths where the reference characters run
      // nearer 0.9, because reach is the ONLY term in the spread jump pose and
      // stubby arms cannot buy enough width to make the airborne state
      // unmistakable. At rest the extra is absorbed by the elbow's flexion and
      // never shows.
      const elbow = pivot(shoulder, 0, -0.262, 0);
      // Forearm ending in a pale mitt over a trim wristband. Arms and thighs
      // are both skin, and from behind they overlap for most of the stride --
      // without a bright break at the wrist the whole lower half of the
      // character reads as one undifferentiated mass. The mitt is 0.21 across
      // against a 0.57 head, near the ratio Sonic's gloves run at, and it is
      // what makes both the arm swing and the spread jump pose land.
      const fore = multi([
        { g: new THREE.CapsuleGeometry(0.078, 0.090, 3, 10), c: P.runnerSkin, y: -0.103 },
        // Elbow, on the pivot, for the reason the knee has one: the flexion
        // reaches 1.78rad at the front of the swing and two capsules meeting
        // at a point open a notch there. This one shows more than the knee
        // does, because the run cycle drives the elbows LATERALLY -- they are
        // the joint the back view was built to watch.
        { g: new THREE.SphereGeometry(0.088, 8, 5), c: P.runnerSkin, y: -0.012, sy: 0.92, sz: 0.96 },
        { g: new THREE.CylinderGeometry(0.088, 0.088, 0.048, 10), c: TRIM, y: -0.188 },
        // The hand. It was a ball, and a ball is the one shape a hand is not.
        // Palm plus three fingers, and the budget for the fingers is taken OUT
        // of the palm -- 0.118 down to 0.112, sitting 0.008 higher -- so the
        // hand ends at -0.361 where the ball ended at -0.376. That matters
        // more than it sounds: the gloves are the outermost thing on the
        // airborne pose, MEASUREMENTS.md puts the runner's lateral budget at
        // 0.70 from the lane centre before it grazes hazards it legitimately
        // cleared, and growing the reach to buy fingers would have spent it.
        //
        // The fingers point forward and down, curled the way a running hand
        // is, so from behind what shows is the knuckle line across the back of
        // the hand and three lobes breaking the bottom of its outline. The
        // capsule CAPS are the knuckles -- one primitive doing both jobs.
        { g: new THREE.SphereGeometry(0.112, 10, 8), c: GLOVE, y: -0.250, sx: 0.88, sz: 1.02 },
        { g: new THREE.CapsuleGeometry(0.030, 0.042, 1, 6), c: GLOVE, x: -0.048, y: -0.318, z: 0.010, rx: 0.60 },
        { g: new THREE.CapsuleGeometry(0.032, 0.046, 1, 6), c: GLOVE, x: 0.000, y: -0.320, z: 0.012, rx: 0.60 },
        { g: new THREE.CapsuleGeometry(0.029, 0.040, 1, 6), c: GLOVE, x: 0.048, y: -0.314, z: 0.008, rx: 0.60 },
        // Thumb, on the inboard face, where it is a silhouette bump against
        // the torso rather than a lump lost on the outside of the arm.
        { g: new THREE.CapsuleGeometry(0.032, 0.036, 1, 6), c: GLOVE, x: -side * 0.086, y: -0.268, z: 0.030, rx: 0.55, rz: side * 0.55 },
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
      const cadence = 2.55 * Math.pow(speed / SPEED_LO, 0.72);
      // Bleed the cycle out over the jump instead of hard-stopping at a
      // threshold -- a frozen scissor at the moment of takeoff was visible.
      api.phase = (api.phase + dt * cadence * (1 - air * 0.92)) % 1;

      const p = api.phase * Math.PI * 2;
      // 0..1 across the honest pace band, used only for the terms that should
      // read as "trying harder": stride length and forward lean.
      const sp01 = Math.max(0, Math.min(1, (speed - SPEED_LO) / (SPEED_HI - SPEED_LO)));
      const swing = 0.94 + 0.20 * sp01;

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

      // ---- legs: contralateral swing with a knee tuck on the recovery leg
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const ph = p + (i === 0 ? 0 : Math.PI);
        const s = Math.sin(ph);
        const c = Math.cos(ph);

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
        L.hip.rotation.x = -s * swing * 0.86 * cyc + tuck * 0.70
          - slid * (lead ? 1.80 : 1.66);
        // Knee only bends one way; bias so it flexes hardest on recovery.
        const bend = Math.max(0, -c * 0.5 + 0.5);
        L.knee.rotation.x = 0.18 + bend * (1.22 + 0.26 * sp01) * cyc + tuck * 1.25
          + slid * (lead ? 0.02 : 0.62);
        // Dorsiflex through recovery, plantarflex off the toe -- and hard
        // dorsiflexion in the slide, toes up, which is both what a slider
        // actually does and what turns the biggest pale face on the character
        // away from the road and into the light.
        L.ankle.rotation.x = -0.16 + s * 0.34 * cyc - tuck * 0.45
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
      for (let i = 0; i < arms.length; i++) {
        const A = arms[i];
        const ph = p + (i === 0 ? Math.PI : 0);
        const s = Math.sin(ph);   // > 0 with the arm swung back
        const fwd = Math.max(0, -s);
        const back = Math.max(0, s);

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
        A.shoulder.rotation.x = s * swing * 0.95 * cycD - spread * 0.26
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
        A.shoulder.rotation.z = A.side * ((0.13 + back * 0.15) * cycD + spread * 1.56 + slid * 0.16);
        A.shoulder.rotation.y = -A.side * (0.16 + fwd * 0.22) * cycD;
        // Ride the whole shoulder outboard in the air as well as rotating it.
        // Worth 0.09 of span for nothing, and it keeps the arm root buried in
        // the deltoid instead of tearing a gap at the seam.
        A.shoulder.position.x = A.side * (0.222 + spread * 0.048);
        // Flexion peaks with the arm forward -- glove up by the chest at the
        // front of the swing, forearm opening out past the hip at the back,
        // which is exactly when the pale glove clears the torso silhouette.
        // A slide straightens it instead, so the whole arm becomes one long
        // brace trailing behind the body -- flat and low against the jump's
        // wide, and neither of them the run.
        A.elbow.rotation.x =
          (-1.32 - fwd * 0.46) * (1 - spread * 0.95) * (1 - slid * 0.86) - slid * 0.10;
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
      const leanFwd = (0.26 + 0.12 * sp01 + stumble * 0.5) * (1 - slid * 0.94)
        - spread * 0.30
        - slid * SLIDE_RECLINE;
      spine.rotation.x = leanFwd + trip * 0.46;
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
      chest.rotation.y = Math.sin(p) * 0.21 * cycD;
      chest.rotation.z = -Math.sin(p) * 0.055 * cycD;
      hips.rotation.y = -Math.sin(p) * 0.14 * cycD;
      // Pelvic drop toward the swinging leg: small, but it stops the hips
      // from reading as a rigid block bolted to the spine.
      hips.rotation.z = Math.sin(p) * 0.055 * cycD;

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
      neck.rotation.y = -Math.sin(p) * 0.10 - slid * SLIDE_YAW * 1.15;
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
      const hdt = Math.min(dt, 1 / 50);
      // The divided difference is clamped before it is used: one long frame
      // after an alt-tab hands this a spike no spring should be asked to
      // follow, and the clamp is cheaper than filtering it.
      const bobV = dt > 1e-4 ? Math.max(-1.6, Math.min(1.6, (bob - lastBob) / dt)) : 0;
      lastBob = bob;
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
      const hoodZRest = -lean * 0.30 - knock * 0.30;
      hoodZV += ((hoodZRest - hoodZ) * 96 - hoodZV * 8.8) * hdt;
      hoodZ += hoodZV * hdt;
      hoodPivot.rotation.z = Math.max(-0.42, Math.min(0.42, hoodZ));

      // The bib's hem. The reference's runner has a printed graphic that is
      // dead still and CLOTH around it that is not, and that contrast is most
      // of why theirs reads as worn and ours read as painted on. The panel is
      // pinned along its top edge and held flat in the middle by the back
      // behind it, so the drive is a travelling wave in theta: the two free
      // bottom corners lift out of phase with each other and the number never
      // moves. 22 vertices, one buffer upload, no draw call.
      //
      // Rate and amplitude both climb with pace, which makes this a speed cue
      // as well as a life cue -- it is the only motion on the character that
      // is not locked to the stride, so it beats against the cadence instead
      // of reinforcing it, and that is what stops the whole figure reading as
      // one clockwork.
      bibT += dt * (5.2 + 6.4 * sp01);
      // 0.036, not the 0.026 this started at: measured off a burst of frames,
      // 0.026 moves a corner about four pixels at gameplay framing and the
      // strip could not resolve it. Past about 0.05 the corner visibly leaves
      // the vest and the panel reads as unstuck rather than as fluttering.
      const bibAmp = (0.036 + 0.016 * sp01) * (1 - slid * 0.55) + spread * 0.018;
      const bp = bibPos.array;
      for (let i = 0; i < bibPos.count; i++) {
        const w = bibWeight[i];
        if (w <= 0) continue;
        const lift = Math.sin(bibT + bibTheta[i] * 3.4) * bibAmp * w;
        // Radial, because the panel is curved: scaling x and z about the
        // vest's own axis lifts the corner off the back, where moving it in a
        // straight line would shear it sideways across the number.
        const k = 1 + lift / BIB_R;
        bp[i * 3] = bibRest[i * 3] * k;
        bp[i * 3 + 2] = bibRest[i * 3 + 2] * k;
        bp[i * 3 + 1] = bibRest[i * 3 + 1] + lift * 0.70;
      }
      bibPos.needsUpdate = true;

      // Whole-body bank into a lane change reads as weight, not a slide.
      // The slide adds its own, tipping onto the hip it is riding on: a body
      // that goes in yawed but stays perfectly level reads as a swivel chair.
      root.rotation.z = -lean * 0.13 - knock * 0.16 - slid * 0.12;
      // Go in at an angle. See SLIDE_YAW -- this is the term that gives the
      // back view something lateral to measure.
      root.rotation.y = slid * SLIDE_YAW;

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

  return { create, HEIGHT };
})();
