/**
 * The runner: a procedural toy-proportioned character with a hand-authored
 * run cycle. No rig file, no art assets -- every part is a primitive under a
 * pivot hierarchy, and the cycle is driven by phase rather than keyframes so
 * it stays locked to ground speed at any pace.
 *
 * Proportions are deliberately cartoon: head is roughly a quarter of total
 * height, limbs are short and thick, hands and feet are oversized. That is
 * what reads as "toy" at a low tight camera rather than "small human".
 *
 * Pivot layout (all rotations are local X unless noted):
 *   root -> body -> hips -> thigh -> shin -> foot
 *                -> spine -> chest -> neck -> head
 *                                  -> shoulder -> upperArm -> forearm -> hand
 */
MR.Runner = (function () {
  const S = MR.shading;
  const P = S.PALETTE;

  const HEIGHT = 1.78;
  const OUTLINE = MR.shading.INK.character;

  function part(geo, color, steps) {
    return S.outlined(geo, S.toon(color, steps || 3), OUTLINE);
  }

  function pivot(parent, x, y, z) {
    const p = new THREE.Object3D();
    p.position.set(x || 0, y || 0, z || 0);
    parent.add(p);
    return p;
  }

  function create() {
    const root = new THREE.Group();
    const body = pivot(root, 0, 0, 0);

    // ---- torso ----------------------------------------------------------
    const hips = pivot(body, 0, 0.80, 0);
    const spine = pivot(hips, 0, 0, 0);

    const pelvis = part(new THREE.CapsuleGeometry(0.20, 0.10, 3, 12), P.runnerShort);
    pelvis.rotation.z = Math.PI / 2;
    spine.add(pelvis);

    const chest = pivot(spine, 0, 0.30, 0);
    const chestMesh = part(new THREE.CapsuleGeometry(0.245, 0.20, 3, 14), P.runnerVest);
    chestMesh.position.y = 0.04;
    chest.add(chestMesh);

    // Race bib -- tiny detail, but it is what says "marathon" instead of
    // "generic runner" at a glance.
    const bib = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), S.flat(0xfffdf5));
    bib.position.set(0, 0.0, 0.247);
    chest.add(bib);

    // ---- head -----------------------------------------------------------
    const neck = pivot(chest, 0, 0.30, 0);
    const head = pivot(neck, 0, 0, 0);
    const skull = part(new THREE.SphereGeometry(0.275, 18, 14), P.runnerSkin);
    skull.scale.set(1, 1.04, 0.96);
    head.add(skull);

    const hair = part(new THREE.SphereGeometry(0.285, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), P.runnerHair);
    hair.position.y = 0.02;
    head.add(hair);

    // Eyes are flat unlit discs so they never band or catch a highlight.
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.052, 12), S.flat(P.ink));
      eye.position.set(sx * 0.098, 0.015, 0.258);
      head.add(eye);
    }

    // ---- limbs ----------------------------------------------------------
    const legs = [];
    const arms = [];

    for (const side of [-1, 1]) {
      // leg
      const hip = pivot(hips, side * 0.125, -0.06, 0);
      const thigh = part(new THREE.CapsuleGeometry(0.105, 0.26, 3, 10), P.runnerSkin);
      thigh.position.y = -0.20;
      hip.add(thigh);

      const knee = pivot(hip, 0, -0.40, 0);
      const shin = part(new THREE.CapsuleGeometry(0.088, 0.24, 3, 10), P.runnerSkin);
      shin.position.y = -0.18;
      knee.add(shin);

      const ankle = pivot(knee, 0, -0.34, 0);
      const foot = part(new THREE.BoxGeometry(0.15, 0.10, 0.30), P.runnerShoe, 2);
      foot.position.set(0, -0.04, 0.06);
      ankle.add(foot);

      legs.push({ side, hip, knee, ankle });

      // arm
      const shoulder = pivot(chest, side * 0.275, 0.11, 0);
      const upper = part(new THREE.CapsuleGeometry(0.075, 0.20, 3, 10), P.runnerSkin);
      upper.position.y = -0.16;
      shoulder.add(upper);

      const elbow = pivot(shoulder, 0, -0.31, 0);
      const fore = part(new THREE.CapsuleGeometry(0.065, 0.18, 3, 10), P.runnerSkin);
      fore.position.y = -0.14;
      elbow.add(fore);

      const hand = part(new THREE.SphereGeometry(0.082, 10, 8), P.runnerSkin);
      hand.position.y = -0.27;
      elbow.add(hand);

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
      if (air < 0.5) api.phase = (api.phase + dt * cadence) % 1;

      const p = api.phase * Math.PI * 2;
      const swing = 0.92 + 0.12 * (speed / 26);

      // ---- legs: contralateral swing with a knee tuck on the recovery leg
      for (let i = 0; i < legs.length; i++) {
        const L = legs[i];
        const ph = p + (i === 0 ? 0 : Math.PI);
        const s = Math.sin(ph);
        const c = Math.cos(ph);

        // Airborne: tuck both legs, front one higher.
        const tuck = air * (i === 0 ? 1.25 : 0.75);

        L.hip.rotation.x = -s * swing * 0.62 + tuck * 0.55 - duck * 0.35;
        // Knee only bends one way; bias so it flexes hardest on recovery.
        const bend = Math.max(0, -c * 0.5 + 0.5);
        L.knee.rotation.x = (0.25 + bend * 1.05) * (1 - air * 0.2) + tuck * 0.95 + duck * 0.7;
        L.ankle.rotation.x = -0.18 + s * 0.28 - tuck * 0.5;
      }

      // ---- arms: opposite the legs, elbows locked high like a racer
      for (let i = 0; i < arms.length; i++) {
        const A = arms[i];
        const ph = p + (i === 0 ? Math.PI : 0);
        const s = Math.sin(ph);

        A.shoulder.rotation.x = s * swing * 0.72 - air * 0.55 - duck * 0.5;
        A.shoulder.rotation.z = A.side * (0.14 + duck * 0.1);
        A.elbow.rotation.x = -1.05 - Math.max(0, s) * 0.42 - air * 0.3;
      }

      // ---- torso: forward lean, vertical bob, and a lateral bank on turns
      const bob = Math.abs(Math.sin(p)) * 0.055 * (1 - air);
      const lift = air * 0.10;
      body.position.y = bob + lift;

      const leanFwd = 0.13 + 0.08 * (speed / 26) + duck * 0.62 + stumble * 0.5;
      spine.rotation.x = leanFwd;
      spine.rotation.z = -lean * 0.30;
      spine.rotation.y = lean * 0.16;

      // Counter-rotate the shoulders against the hips -- the single cue that
      // most separates a run cycle from a march.
      chest.rotation.y = Math.sin(p) * 0.17;
      hips.rotation.y = -Math.sin(p) * 0.11;

      // Head stays level: cancel most of the spine lean, add a small lag.
      neck.rotation.x = -leanFwd * 0.72 + Math.sin(p * 2) * 0.03;
      neck.rotation.z = lean * 0.14;

      // Whole-body bank into a lane change reads as weight, not a slide.
      root.rotation.z = -lean * 0.13;

      // Ducking drops the whole body rather than only folding the spine, so
      // the collision capsule and the silhouette agree.
      body.position.y -= duck * 0.42;
      api.duckDrop = duck * 0.42;
    };

    api.update(0, {});
    return api;
  }

  return { create, HEIGHT };
})();
