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
 *      Top to bottom it runs dark hair / bright headband / dark hair /
 *      light neck / red vest / white race bib. Hair on the crown with a
 *      bare nape put light on light and the head merged again; the dark
 *      mass has to sit directly above the lit neck for the pinch to read.
 *   3. Motion has to break the outline. Arm swing is almost entirely along
 *      the camera axis from here, so the cycle drives the elbows sideways
 *      and lets the pale shoes, gloves and wristbands flash against the
 *      road; those are the parts the eye can actually track from behind.
 *   4. State has to read as SILHOUETTE, not as pose detail, and no two states
 *      may differ on the SAME axis. Measured in world units on the rig's own
 *      bounding box, against the run, on a 390x844 phone in portrait:
 *
 *        run    half-width 0.42  (1.00x)   crown 1.57  (1.00x)
 *        jump   half-width 0.92  (2.2x)    -- a horizontal bar, airborne
 *        slide  half-width 0.59  (1.4x)    crown 1.32  (0.84x)
 *
 *      Width alone separates the jump from both others -- it is still half as
 *      wide again as the slide -- and height alone separates the slide from
 *      the run. Neither test can return the wrong answer for the other state.
 *      The slide is wider than the 1.26x it used to be and that is bought
 *      deliberately: see SLIDE_YAW, which spends width to get an axis the back
 *      view can actually measure. It is paid for out of leg splay, and the
 *      crown came DOWN in the same change (0.90x -> 0.84x), so the height test
 *      that actually carries this state got stronger rather than weaker. The
 *      crown matters twice over: collision.js sets the DUCK bar at 1.41, and
 *      1.32 is 0.09 of real daylight where the previous pose left 0.03.
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
 *
 * Pivot layout (all rotations are local X unless noted):
 *   root -> body -> hips -> thigh -> shin -> foot
 *                -> spine -> chest -> neck -> head
 *                                  -> shoulder -> upperArm -> forearm+hand
 *        -> shadowPivot -> contact shadow   (cancels the jump and the bank)
 *        -> fxPivot     -> skid ribbon, dust   (cancels root ENTIRELY, so its
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

  const OUTLINE = MR.shading.INK.character;

  // Accent that ties the silhouette together: headband, wristbands, shoe
  // midsoles -- top, middle and bottom of the figure. Repeating one bright
  // colour on a rhythm is what makes a pile of primitives look like a
  // designed character instead of assorted parts. A fourth hit on the vest
  // hem put three yellows at the same height and just read as clutter.
  const TRIM = P.accent;
  const GLOVE = P.runnerShoe;

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
   * pieces that never move relative to each other -- skull + hair + band +
   * ears + neck, vest + shoulders, shoe + soles -- is what pays for the extra
   * detail this silhouette needs while staying inside the budget. The whole
   * character is 28 draws plus one for the shadow.
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

  function part(geo, color, steps) {
    return S.outlined(geo, S.toon(color, steps || 3), OUTLINE);
  }

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
    ]);
    chest.add(trunk);

    // Curved panel rather than a flat card so it hugs the vest at this size,
    // and high on the back so it never straddles the shorts line.
    const bib = new THREE.Mesh(
      // Cone, not cylinder: matched to the vest's taper. A constant-radius
      // panel let the wider top of the vest poke through the number.
      new THREE.CylinderGeometry(0.266, 0.256, 0.16, 10, 1, true, Math.PI - 0.52, 1.04),
      S.toon(0xffffff, 3)
    );
    bib.material.map = raceBib();
    bib.position.y = -0.020;
    bib.scale.z = 0.78;
    chest.add(bib);

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
      // Crown cap for the top of the skull...
      { g: new THREE.SphereGeometry(0.280, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), c: P.runnerHair, y: HY },
      // ...and a rear-only shell that carries the hair down to the nape but
      // leaves the face clear. Restricting phi to the back 210 degrees is
      // what lets one primitive do a haircut.
      { g: new THREE.SphereGeometry(0.286, 14, 8, Math.PI * 1.5 - 1.83, 3.66, Math.PI * 0.33, Math.PI * 0.44), c: P.runnerHair, y: HY },
      // Headband sits above the eye line -- lower and it reads as goggles.
      // Radius has to clear the hair everywhere: shells this close together
      // interpenetrate on their facets and the crown grew a row of teeth.
      { g: new THREE.CylinderGeometry(0.294, 0.294, 0.074, 14), c: TRIM, y: HY + 0.060 },
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
      const thigh = part(new THREE.CapsuleGeometry(0.114, 0.100, 3, 10), P.runnerSkin);
      thigh.position.y = -0.108;
      hip.add(thigh);

      const knee = pivot(hip, 0, -0.215, 0);
      // Sock welded onto the shin: a pale band low on the leg makes the
      // scissor of the run cycle legible from directly behind.
      const shin = multi([
        { g: new THREE.CapsuleGeometry(0.096, 0.050, 3, 10), c: P.runnerSkin, y: -0.076 },
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
      const upper = part(new THREE.CapsuleGeometry(0.086, 0.095, 3, 10), P.runnerSkin);
      upper.position.y = -0.122;
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
        { g: new THREE.CylinderGeometry(0.088, 0.088, 0.048, 10), c: TRIM, y: -0.188 },
        { g: new THREE.SphereGeometry(0.118, 10, 8), c: GLOVE, y: -0.258, sx: 0.90, sz: 1.06 },
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
      shadowPivot.position.y = -h;
      shadowPivot.rotation.z = -root.rotation.z;
      shadow.scale.set(shadowW * k, 1, shadowD * k);
      shadowMat.opacity = BASE_ALPHA * shadowA * (1 - t * 0.80);
      shadowPivot.updateMatrixWorld(true);
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

    // Deterministic noise. Math.random here would make two screenshots of the
    // same frame differ, and the review loop is screenshots.
    let fxSeed = 1;
    function rnd() {
      fxSeed = (fxSeed * 1664525 + 1013904223) & 0x7fffffff;
      return fxSeed / 0x7fffffff;
    }

    let fxDt = 0, fxSlid = 0, fxLive = 0, fxEmit = 0, fxBurst = 0;
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
    };

    // ---------------------------------------------------------------------

    const api = {
      group: root,
      height: HEIGHT,
      shadow,
      parts: { body, hips, spine, chest, neck, head, legs, arms },
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
        L.hip.rotation.x = -s * swing * 0.86 * cyc + tuck * 0.70
          - slid * (lead ? 1.80 : 1.42);
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

        // 2.78 is measured against the RECLINED chest, not the world, and the
        // size of it is the fix for the most expensive defect this pose had.
        // The spine reclines to -1.10, so an arm needs 1.10 + 1.57 simply to
        // reach world-horizontal. At the old 1.46 it hung 1.2rad short of that
        // and drove the gloves through the tarmac -- and the road clamp below
        // then dutifully lifted the WHOLE BODY back out again to fix it.
        // Measured on the previous build: clamp lift 0.364 against a duck drop
        // of 0.42. The arms were silently cancelling 87% of the drop, so the
        // committed "slide" sat at very nearly running height and cleared the
        // 1.41 DUCK bar by 0.03.
        //
        // At 2.78 the arm trails a hair above world-horizontal and stops being
        // the limiting part; the lift falls to 0.25 (now set by the legs, not
        // the arms) and the crown to 1.32, which is 0.09 of real daylight. It
        // is also the right pose: a slider's arms go out behind them, not down
        // through the surface they are sliding on.
        A.shoulder.rotation.x = s * swing * 0.95 * cycD - spread * 0.26 + slid * 2.78;
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
        - slid * 1.12;
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

      // Head stays level: cancel most of the spine lean, add a small lag. The
      // cancel is what the slide needs too, and for once it needs it at full
      // strength -- the recline is nearly 45 degrees, and a head left in line
      // with it stares at the sky and reads as falling over backwards. Level
      // keeps the eyeline down the road and, incidentally, presents the hair
      // and headband to the camera instead of the underside of a chin.
      neck.rotation.x = -leanFwd * 0.86 + Math.sin(p * 2) * 0.035 * (1 - slid * 0.9);
      neck.rotation.z = lean * 0.14;
      // Unwind most of SLIDE_YAW at the neck. A slider keeps their eyes on the
      // bag; leaving the head square to a body turned 26 degrees would point
      // the face off into the barrier. It also pays twice over from behind --
      // a head counter-turned against the shoulders is the clearest possible
      // statement that the shoulders are turned at all, and it keeps the hair
      // and headband presented flat to the camera where the pinch reads.
      neck.rotation.y = -Math.sin(p) * 0.10 - slid * SLIDE_YAW * 0.70;

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
      // 0.42 is now the smaller half of the truth, though, and worth knowing:
      // the recline tips the crown down again on top of the drop, so at the
      // DUCK_CLEAR threshold the head measures 1.15 where audit() computes
      // 1.60 - 0.42*0.90 = 1.22 against a bar at 1.41. The error is 0.07 in
      // the only direction it is allowed to point -- the real head is LOWER
      // than collision.js believes, never higher -- so the audit stays honest
      // while understating the daylight it is buying.
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
      fxPivot.visible = fxLive > 0.01;
      skidMat.opacity = 0.72 * fxLive;
      dustMat.opacity = fxLive;
    };

    api.update(0, {});
    return api;
  }

  return { create, HEIGHT };
})();
