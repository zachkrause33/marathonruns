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
 *      may differ on the SAME axis. Measured in pixels dead astern through
 *      one lens, against the run: a jump is 1.92 wide and its crown sits 1.07
 *      up -- a horizontal bar. A committed slide is 1.06 wide and its crown
 *      sits 0.71 up, over a contact shadow 2.4x deeper than the run's. So
 *      width alone separates the jump from both others, and height alone
 *      separates the slide from the run; neither test can return the wrong
 *      answer for the other state. An arm tuck is not readable at all,
 *      because it points straight down the camera axis where there is
 *      nothing to see -- which is what the old head-first duck relied on.
 *
 * Pivot layout (all rotations are local X unless noted):
 *   root -> body -> hips -> thigh -> shin -> foot
 *                -> spine -> chest -> neck -> head
 *                                  -> shoulder -> upperArm -> forearm+hand
 *        -> shadowPivot -> contact shadow   (cancels the jump and the bank)
 */
MR.Runner = (function () {
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

        // Which leg leads the slide. Both go forward -- a slide with one leg
        // folded under, the way a real baseball slide runs, loses the second
        // shin out of the silhouette entirely from behind -- but the lead leg
        // is straighter and rides higher, and that offset is the difference
        // between a slide and a mannequin tipped onto its back.
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
          - slid * (1.72 + lead * 0.10);
        // Knee only bends one way; bias so it flexes hardest on recovery.
        const bend = Math.max(0, -c * 0.5 + 0.5);
        L.knee.rotation.x = 0.18 + bend * (1.22 + 0.26 * sp01) * cyc + tuck * 1.25
          + slid * (0.04 - lead * 0.02);
        // Dorsiflex through recovery, plantarflex off the toe -- and hard
        // dorsiflexion in the slide, toes up, which is both what a slider
        // actually does and what turns the biggest pale face on the character
        // away from the road and into the light.
        L.ankle.rotation.x = -0.16 + s * 0.34 * cyc - tuck * 0.45
          - slid * (0.12 + lead * 0.18);
        // A little splay keeps the two legs from overlapping into one shape
        // when they pass each other at midstride, and opens further in the
        // air so the tuck reads as two legs rather than as one mass.
        //
        // The slide needs far more of it than either, and this is the single
        // value the whole pose turned on. The chase camera is only about four
        // degrees above the runner, so legs thrown forward along the view axis
        // sit at almost exactly the torso's screen height and vanish behind
        // it -- the first version of this pose had no visible legs at all.
        // Splaying to 0.70 walks the shoes out to x ~0.50 and takes the rig to
        // 0.57 half-width, clear of the 0.38 deltoid line, so the two of them
        // read as shoes flanking the vest rather than as one stump behind it.
        // 0.70 is also the ceiling: MEASUREMENTS.md derives the lane's own
        // limit at 0.70 from the lane centre, so this pose spends the width
        // budget the gloves' 0.543 run swing had already proved is there.
        L.hip.rotation.z = L.side * (0.05 + spread * 0.30 + slid * 0.26);
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

        // 2.06 is measured against the reclined chest, not the world: the
        // torso is already 0.78 back, so this lands the upper arm a little
        // under horizontal in world space with the elbow behind the hip.
        A.shoulder.rotation.x = s * swing * 0.95 * cycD - spread * 0.26 + slid * 2.06;
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
      neck.rotation.y = -Math.sin(p) * 0.10;

      // Whole-body bank into a lane change reads as weight, not a slide.
      root.rotation.z = -lean * 0.13 - knock * 0.16;

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
    };

    api.update(0, {});
    return api;
  }

  return { create, HEIGHT };
})();
