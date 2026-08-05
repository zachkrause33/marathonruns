/**
 * The runner: a procedural toy-proportioned character with a hand-authored
 * run cycle. No rig file, no art assets -- every part is a primitive under a
 * pivot hierarchy, and the cycle is driven by phase rather than keyframes so
 * it stays locked to ground speed at any pace.
 *
 * Proportions are deliberately cartoon: the head is about 3.4 heads into the
 * total height, limbs are short and thick, hands and feet are oversized. That
 * is what reads as "toy" at a low tight camera rather than "small human".
 *
 * EVERYTHING here is designed for the back view, because that is the only
 * view the player ever gets. The three rules that came out of looking at it
 * in motion:
 *   1. The head must pinch away from the shoulders. A big skull sitting
 *      straight on a big torso is one blob at 200px tall no matter how good
 *      the shading is, so the trunk stops well below the skull and a bare
 *      skin neck bridges the gap.
 *   2. The back needs its own value structure. Reading top to bottom it goes
 *      dark hair / bright headband / light skin / red vest / white race bib
 *      -- five bands, so the character never flattens into one shape.
 *   3. Motion has to break the outline. Elbows swing outside the torso and
 *      the pale shoes and gloves flash against the road; those are the parts
 *      the eye actually tracks from behind.
 *
 * Pivot layout (all rotations are local X unless noted):
 *   root -> body -> hips -> thigh -> shin -> foot
 *                -> spine -> chest -> neck -> head
 *                                  -> shoulder -> upperArm -> forearm+hand
 */
MR.Runner = (function () {
  const S = MR.shading;
  const P = S.PALETTE;

  const HEIGHT = 1.78;
  const OUTLINE = MR.shading.INK.character;

  // Accent that ties the silhouette together: headband, shoe soles, vest hem.
  // Repeating one bright colour in three places is what makes a pile of
  // primitives look like a designed character instead of assorted parts.
  const TRIM = P.accent;
  const GLOVE = P.runnerShoe;

  /**
   * Weld several primitives into one geometry, baking each piece's colour
   * into a vertex-colour attribute.
   *
   * Every part is outlined, so a part costs two draw calls. Welding the
   * pieces that never move relative to each other -- skull + hair + band +
   * ears + neck, vest + shoulders + hem, shoe + sole -- is what pays for the
   * extra detail this silhouette needs while staying inside the budget. The
   * whole character is 28 draws.
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

  function create() {
    const root = new THREE.Group();
    const body = pivot(root, 0, 0, 0);

    // ---- torso ----------------------------------------------------------
    // The trunk is a truncated cone, not a capsule: a hard flat shoulder line
    // wider than the head is half of what separates the two from behind.
    const hips = pivot(body, 0, 0.78, 0);
    const spine = pivot(hips, 0, 0, 0);

    const pelvis = multi([
      { g: new THREE.CylinderGeometry(0.228, 0.220, 0.30, 12), c: P.runnerShort, y: -0.025, sz: 0.82 },
    ]);
    spine.add(pelvis);

    // The whole silhouette is built backwards from one measurement: the
    // shoulder line has to stop 0.15 below the skull. The chase camera looks
    // DOWN on the runner, so a gap smaller than that is swallowed by the
    // head's own projected silhouette and the neck disappears again.
    const chest = pivot(spine, 0, 0.24, 0);
    const trunk = multi([
      // Vest. Top edge at world 1.12. Nothing on the trunk may reach above
      // it -- an earlier deltoid that poked 0.03 higher closed the gap on
      // its own and the head went straight back to sitting on the shoulders.
      // It barely tapers on purpose: a singlet worn over the waistband, so
      // red owns two thirds of the trunk. Tapering it to a narrow hem let the
      // navy shorts read as the biggest single shape on the character.
      { g: new THREE.CylinderGeometry(0.262, 0.236, 0.34, 12), c: P.runnerVest, y: -0.07, sz: 0.72 },
      // Hem stripe -- stops the red mass from running straight into the shorts.
      { g: new THREE.CylinderGeometry(0.240, 0.236, 0.05, 12), c: TRIM, y: -0.216, sz: 0.73 },
      // Deltoids. These are what make the shoulder line read wider than the
      // head; without them the trunk cone tapers into the skull. Flattened
      // hard in Y so they widen the shoulders without raising them.
      { g: new THREE.SphereGeometry(0.130, 10, 8), c: P.runnerVest, x: -0.236, y: -0.015, sy: 0.78, sz: 0.86 },
      { g: new THREE.SphereGeometry(0.130, 10, 8), c: P.runnerVest, x: 0.236, y: -0.015, sy: 0.78, sz: 0.86 },
      // Shoulder blades: a shallow pair of bumps so the back is not a blank
      // curve. Barely visible individually, but they catch the terminator.
      { g: new THREE.SphereGeometry(0.085, 8, 6), c: P.runnerVest, x: -0.105, y: -0.07, z: -0.135, sz: 0.55 },
      { g: new THREE.SphereGeometry(0.085, 8, 6), c: P.runnerVest, x: 0.105, y: -0.07, z: -0.135, sz: 0.55 },
    ]);
    chest.add(trunk);

    // Curved panel rather than a flat card so it hugs the vest at this size,
    // and high on the back so it never straddles the shorts line.
    const bib = new THREE.Mesh(
      new THREE.CylinderGeometry(0.252, 0.252, 0.22, 10, 1, true, Math.PI - 0.62, 1.24),
      S.toon(0xffffff, 3)
    );
    bib.material.map = raceBib();
    bib.position.y = -0.035;
    bib.scale.z = 0.72;
    chest.add(bib);

    // ---- head -----------------------------------------------------------
    // The neck pivot sits at the top of the trunk so head tilt rotates from
    // the base of the neck; the neck column itself rides with the head.
    const neck = pivot(chest, 0, 0.13, 0);
    const head = pivot(neck, 0, 0, 0);

    const headMesh = multi([
      // Bare neck: 0.18 across against a 0.73 shoulder line, and lit skin
      // between the dark hair above and the red vest below. The order of
      // those three values is the entire fix. Leaving the nape skin and the
      // hair on the crown gave a light head sitting on a light neck -- one
      // continuous mass with no pinch. Dark / light / saturated reads.
      { g: new THREE.CylinderGeometry(0.088, 0.100, 0.30, 10), c: P.runnerSkin, y: 0.10 },
      { g: new THREE.SphereGeometry(0.25, 16, 12), c: P.runnerSkin, y: 0.38, sy: 1.02, sz: 0.97 },
      // Crown cap for the top of the skull...
      { g: new THREE.SphereGeometry(0.264, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42), c: P.runnerHair, y: 0.375 },
      // ...and a rear-only shell that carries the hair down to the nape but
      // leaves the face clear. Restricting phi to the back 210 degrees is
      // what lets one primitive do a haircut.
      { g: new THREE.SphereGeometry(0.271, 14, 8, Math.PI * 1.5 - 1.83, 3.66, Math.PI * 0.33, Math.PI * 0.44), c: P.runnerHair, y: 0.375 },
      // Headband sits above the eye line -- lower and it reads as goggles.
      // Radius has to clear the hair everywhere: shells this close together
      // interpenetrate on their facets and the crown grew a row of teeth.
      { g: new THREE.CylinderGeometry(0.279, 0.279, 0.070, 14), c: TRIM, y: 0.436 },
      { g: new THREE.SphereGeometry(0.076, 8, 6), c: P.runnerSkin, x: -0.238, y: 0.360, z: -0.012, sx: 0.48, sz: 0.82 },
      { g: new THREE.SphereGeometry(0.076, 8, 6), c: P.runnerSkin, x: 0.238, y: 0.360, z: -0.012, sx: 0.48, sz: 0.82 },
    ]);
    head.add(headMesh);

    // Eyes are flat unlit discs so they never band or catch a highlight.
    // Welded into one mesh -- they are a single draw the back view never
    // spends, but the character still needs a face for the finish framing.
    const eyes = new THREE.Mesh(weld([
      { g: new THREE.CircleGeometry(0.053, 12), c: P.ink, x: -0.094, y: 0.365, z: 0.243 },
      { g: new THREE.CircleGeometry(0.053, 12), c: P.ink, x: 0.094, y: 0.365, z: 0.243 },
    ]), S.flat(0xffffff, { vertexColors: true }));
    head.add(eyes);

    // ---- limbs ----------------------------------------------------------
    const legs = [];
    const arms = [];

    for (const side of [-1, 1]) {
      // leg
      const hip = pivot(hips, side * 0.135, -0.04, 0);
      const thigh = part(new THREE.CapsuleGeometry(0.125, 0.20, 3, 10), P.runnerSkin);
      thigh.position.y = -0.20;
      hip.add(thigh);

      const knee = pivot(hip, 0, -0.40, 0);
      // Sock welded onto the shin: a pale band low on the leg makes the
      // scissor of the run cycle legible from directly behind.
      const shin = multi([
        { g: new THREE.CapsuleGeometry(0.100, 0.19, 3, 10), c: P.runnerSkin, y: -0.175 },
        { g: new THREE.CylinderGeometry(0.112, 0.105, 0.11, 10), c: P.runnerShoe, y: -0.295 },
      ]);
      knee.add(shin);

      const ankle = pivot(knee, 0, -0.35, 0);
      // Oversized shoe with a trim sole. Two flashing soles are the clearest
      // read the back view gets, both for cadence and for a jump tuck.
      const foot = multi([
        { g: new THREE.BoxGeometry(0.165, 0.105, 0.30), c: P.runnerShoe, y: -0.020, z: 0.050 },
        { g: new THREE.BoxGeometry(0.178, 0.058, 0.315), c: TRIM, y: -0.082, z: 0.055 },
      ], 2);
      ankle.add(foot);

      legs.push({ side, hip, knee, ankle });

      // arm
      const shoulder = pivot(chest, side * 0.236, -0.02, 0);
      // ZXY so the twist happens along the arm before it is swung and then
      // abducted. With the default XYZ the yaw fired after the outward tilt
      // and dragged the whole arm across the back of the vest.
      shoulder.rotation.order = 'ZXY';
      const upper = part(new THREE.CapsuleGeometry(0.088, 0.17, 3, 10), P.runnerSkin);
      upper.position.y = -0.16;
      shoulder.add(upper);

      const elbow = pivot(shoulder, 0, -0.30, 0);
      const fore = multi([
        { g: new THREE.CapsuleGeometry(0.080, 0.15, 3, 10), c: P.runnerSkin, y: -0.13 },
        { g: new THREE.SphereGeometry(0.105, 10, 8), c: GLOVE, y: -0.295, sx: 0.92, sz: 1.06 },
      ]);
      elbow.add(fore);

      arms.push({ side, shoulder, elbow });
    }

    // ---------------------------------------------------------------------

    const api = {
      group: root,
      height: HEIGHT,
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
      const speed = st.speed === undefined ? 22 : st.speed;
      const air = st.air01 || 0;
      const duck = st.duck01 || 0;
      const lean = st.lean || 0;
      const stumble = st.stumble || 0;

      // Stride frequency scales with ground speed so the feet never skate.
      // 22 u/s is the reference; the exponent keeps cadence rising more
      // slowly than speed, which is how real runners gain pace.
      const cadence = 2.55 * Math.pow(speed / 22, 0.72);
      // Bleed the cycle out over the jump instead of hard-stopping at a
      // threshold -- a frozen scissor at the moment of takeoff was visible.
      api.phase = (api.phase + dt * cadence * (1 - air * 0.92)) % 1;

      const p = api.phase * Math.PI * 2;
      // 0..1 across the honest pace band, used only for the terms that should
      // read as "trying harder": stride length and forward lean.
      const sp01 = Math.max(0, Math.min(1, (speed - 20.5) / 7.5));
      const swing = 0.94 + 0.20 * sp01;

      // ---- legs: contralateral swing with a knee tuck on the recovery leg
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const ph = p + (i === 0 ? 0 : Math.PI);
        const s = Math.sin(ph);
        const c = Math.cos(ph);

        // Airborne: tuck both knees so the soles turn toward the camera. The
        // back view cannot see a leg extend, but it can see two bright soles.
        const tuck = air * (i === 0 ? 1.15 : 0.85);

        L.hip.rotation.x = -s * swing * 0.72 + tuck * 0.62 + duck * 0.72;
        // Knee only bends one way; bias so it flexes hardest on recovery.
        const bend = Math.max(0, -c * 0.5 + 0.5);
        L.knee.rotation.x = 0.18 + bend * (1.15 + 0.25 * sp01) + tuck * 1.05 + duck * 1.25;
        // Dorsiflex through recovery, plantarflex off the toe.
        L.ankle.rotation.x = -0.16 + s * 0.34 - tuck * 0.55 + duck * 0.30;
        // A little splay keeps the two legs from overlapping into one shape
        // when they pass each other at midstride.
        L.hip.rotation.z = L.side * 0.05;
      }

      // ---- arms: opposite the legs, elbows out so they break the outline
      for (let i = 0; i < arms.length; i++) {
        const A = arms[i];
        const ph = p + (i === 0 ? Math.PI : 0);
        const s = Math.sin(ph);

        A.shoulder.rotation.x = s * swing * 0.85 - air * 0.95 - duck * 0.30;
        // Elbows ride outside the torso silhouette, wider on the back swing.
        // From behind this is the only limb motion that crosses the outline,
        // so it does most of the work of selling effort.
        A.shoulder.rotation.z = A.side * (0.21 + Math.max(0, -s) * 0.13 + duck * 0.14);
        // Rotating the whole arm inward brings the glove across the chest,
        // which is what a racer's swing looks like from behind.
        A.shoulder.rotation.y = -A.side * 0.20;
        A.elbow.rotation.x = -1.18 - Math.max(0, s) * 0.48 - air * 0.30 - duck * 0.40;
      }

      // ---- torso: forward lean, vertical bob, and a lateral bank on turns
      // Two bobs per stride, lowest at each footstrike.
      const bob = -Math.abs(Math.cos(p)) * 0.050 * (1 - air) + 0.050;
      body.position.y = bob + air * 0.09;

      const leanFwd = 0.20 + 0.10 * sp01 + duck * 0.80 + stumble * 0.5 - air * 0.07;
      spine.rotation.x = leanFwd;
      spine.rotation.z = -lean * 0.30;
      spine.rotation.y = lean * 0.16;

      // Counter-rotate the shoulders against the hips -- the single cue that
      // most separates a run cycle from a march, and the only thing the back
      // view sees the torso do at all.
      chest.rotation.y = Math.sin(p) * 0.21;
      chest.rotation.z = -Math.sin(p) * 0.055;
      hips.rotation.y = -Math.sin(p) * 0.14;
      // Pelvic drop toward the swinging leg: small, but it stops the hips
      // from reading as a rigid block bolted to the spine.
      hips.rotation.z = Math.sin(p) * 0.055;

      // Head stays level: cancel most of the spine lean, add a small lag.
      // Ducking is the exception -- keeping the head up there would defeat
      // the point of the pose, so the cancel fades out as the player folds.
      neck.rotation.x = -leanFwd * 0.86 * (1 - duck * 0.55) + Math.sin(p * 2) * 0.035;
      neck.rotation.z = lean * 0.14;
      neck.rotation.y = -Math.sin(p) * 0.10;

      // Whole-body bank into a lane change reads as weight, not a slide.
      root.rotation.z = -lean * 0.13;

      // Ducking drops the whole body rather than only folding the spine, so
      // the collision capsule and the silhouette agree. The 0.42 matches
      // Collision.PLAYER_DUCK_DROP; changing it here would silently break
      // that module's audit.
      body.position.y -= duck * 0.42;
      api.duckDrop = duck * 0.42;
    };

    api.update(0, {});
    return api;
  }

  return { create, HEIGHT };
})();
