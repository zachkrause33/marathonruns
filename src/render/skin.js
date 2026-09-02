/**
 * The sculpted Miles: skin a modelled GLB onto the code rig.
 *
 * The owner generated a sculpted character from the concept render (Meshy),
 * and a sculpted mesh is the one thing primitives cannot become -- a single
 * continuous surface that BENDS at the joints. This module is the bridge:
 * it takes the embedded GLB (MR.EMBED.miles, base64 -- see tools/build.js),
 * builds a THREE.Skeleton whose topology mirrors runner.js's driver pivots,
 * computes per-vertex skin weights procedurally, and each frame copies the
 * driver rig's joint rotations onto the bones.
 *
 * THE DRIVER RIG STAYS. Every behaviour this project has measured and tuned
 * -- the run cycle, the foot-plant solve, the slide and jump silhouettes,
 * the ritual, the celebration, the lane-change chain, the landing squash --
 * lives in runner.js posing its invisible pivots exactly as before. The
 * skinned mesh is a COSTUME over that skeleton: remove the model from
 * assets/ and the code-built body is still there underneath, byte for byte.
 *
 * The standing rule holds by construction: the model is a closed sculpted
 * solid, built on all sides by its nature.
 *
 * What v1 does not do, said here rather than discovered: the face is the
 * model's painted texture -- no blink, no gaze, no brow acting (those pose
 * empty pivots until a facial rig exists); and the mesh-measuring tools
 * (envelope, footroom, deckdrop) read raw geometry, which for a SkinnedMesh
 * is the REST pose -- their readings describe the driver rig, not the
 * costume, until they learn boneTransform().
 */
MR.Skin = (function () {
  'use strict';

  // Joint rest positions, in world units on the NORMALISED model (feet at
  // y=0, crown at CROWN, centred in x/z, facing +z like the runner). These
  // are the sculpt's own anatomy -- longer legs, higher chest than the code
  // ladder -- expressed as tunable numbers because they were placed by eye
  // against shots/meshy-close.png and iterated from pose screenshots.
  // Driver ROTATIONS applied at these positions read correctly regardless
  // of the ladder mismatch: an angle is an angle.
  const CROWN = 1.545;      // rest crown; the +0.04 bob top stays under 1.60
  // Fallback joints, used only if measurement fails. The first rig ran on
  // these eyeballed numbers alone and the run cycle SHREDDED the mesh --
  // rotations pivoted flesh around centres that were not the sculpt's own
  // joints. measureJoints() below derives them from the geometry instead.
  const J = {
    hipsY: 0.700, hipX: 0.100, kneeY: 0.385, ankleY: 0.095, footZ: 0.150,
    chestY: 0.960, neckY: 1.130, headY: 1.240,
    shoulderX: 0.200, shoulderY: 1.080, elbowY: 0.850, wristY: 0.640,
    handY: 0.540,
  };

  /**
   * Measure the sculpt's own joints from its geometry, in place of the
   * guesses above. The method is cross-sections: a knee is where a leg is
   * thinnest between hip and ankle, an elbow where an arm narrows between
   * deltoid and fist, the crotch is the lowest point of the inner-thigh
   * gap. Every number is logged so a bad read is visible, and any read
   * that lands outside sane bounds keeps the fallback.
   */
  function measureJoints(pos, n) {
    const BIN = 0.02;
    const bins = Math.ceil(CROWN / BIN) + 1;
    // z-extent per y-bin for three vertex classes: leg, arm, torso
    const mk = () => ({ lo: new Float32Array(bins).fill(1e9),
      hi: new Float32Array(bins).fill(-1e9), cnt: new Uint32Array(bins),
      xs: new Float32Array(bins) });
    const leg = mk(), arm = mk();
    let crotch = 1e9;
    for (let v = 0; v < n; v++) {
      const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
      if (y < 0 || y > CROWN) continue;
      const b = Math.floor(y / BIN);
      const ax = Math.abs(x);
      if (y < 0.80 && ax > 0.02 && ax < 0.17) {
        if (z < leg.lo[b]) leg.lo[b] = z;
        if (z > leg.hi[b]) leg.hi[b] = z;
        leg.cnt[b]++; leg.xs[b] += ax;
      }
      if (ax > 0.15 && y > 0.30 && y < 1.15) {
        if (z < arm.lo[b]) arm.lo[b] = z;
        if (z > arm.hi[b]) arm.hi[b] = z;
        arm.cnt[b]++; arm.xs[b] += ax;
      }
      // inner-thigh gap: central verts below the waist
      if (ax < 0.025 && y > 0.25 && y < 0.85 && y < crotch) crotch = y;
    }
    const width = (m, b) => (m.cnt[b] > 3 ? m.hi[b] - m.lo[b] : 1e9);
    const minIn = (m, y0, y1) => {
      let bb = -1, bw = 1e9;
      for (let b = Math.floor(y0 / BIN); b <= Math.floor(y1 / BIN); b++) {
        const w = width(m, b);
        if (w < bw) { bw = w; bb = b; }
      }
      return bb < 0 ? null : { y: (bb + 0.5) * BIN, w: bw };
    };
    const maxTopOf = (m) => {
      for (let b = bins - 1; b >= 0; b--) if (m.cnt[b] > 3) return (b + 0.5) * BIN;
      return null;
    };
    const out = {};
    if (crotch < 1) out.hipsY = crotch + 0.045;
    const knee = minIn(leg, 0.22, Math.min(0.60, (out.hipsY || J.hipsY) - 0.10));
    if (knee) out.kneeY = knee.y;
    const ankle = minIn(leg, 0.06, (out.kneeY || J.kneeY) - 0.08);
    if (ankle) out.ankleY = ankle.y;
    const armTop = maxTopOf(arm);
    if (armTop) out.shoulderY = armTop - 0.055;
    const elbow = minIn(arm, 0.55, (out.shoulderY || J.shoulderY) - 0.06);
    if (elbow) out.elbowY = elbow.y;
    const wrist = minIn(arm, 0.42, (out.elbowY || J.elbowY) - 0.05);
    if (wrist) out.wristY = wrist.y;
    // lateral centres at the measured heights
    const bAt = (y) => Math.max(0, Math.min(bins - 1, Math.floor(y / BIN)));
    const kb = bAt(out.kneeY || J.kneeY);
    if (leg.cnt[kb] > 3) out.hipX = leg.xs[kb] / leg.cnt[kb];
    const eb = bAt(out.elbowY || J.elbowY);
    if (arm.cnt[eb] > 3) out.shoulderX = arm.xs[eb] / arm.cnt[eb];
    if (out.hipsY) out.chestY = out.hipsY + 0.26;
    // sanity gates: a read outside these keeps the fallback for that key
    const sane = {
      hipsY: [0.50, 0.85], kneeY: [0.20, 0.55], ankleY: [0.05, 0.22],
      shoulderY: [0.90, 1.25], elbowY: [0.60, 1.00], wristY: [0.45, 0.85],
      hipX: [0.05, 0.16], shoulderX: [0.15, 0.30], chestY: [0.80, 1.10],
    };
    for (const k of Object.keys(out)) {
      const s = sane[k];
      if (s && (out[k] < s[0] || out[k] > s[1])) delete out[k];
    }
    console.log('MR.Skin joints measured:', JSON.stringify(out));
    return Object.assign({}, J, out);
  }

  /** Decode the embed and hand the parsed scene to cb(gltf). */
  function load(b64, cb, err) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf, '', cb, err);
  }

  /**
   * Merge the model into one normalised geometry: node transforms baked,
   * feet at y=0, centred, scaled so the crown sits at CROWN.
   */
  function normalise(scene) {
    let geom = null, material = null;
    scene.updateMatrixWorld(true);
    scene.traverse(function (o) {
      if (!o.isMesh || geom) return;   // Meshy exports a single mesh
      geom = o.geometry.clone();
      geom.applyMatrix4(o.matrixWorld);
      material = o.material;
    });
    if (!geom.index) {
      // The whole weight pass walks the edge graph; a non-indexed mesh has
      // no shared vertices to walk. Our shrink pipeline welds, so this only
      // fires on a hand-dropped raw export -- fail into the code body.
      throw new Error('model is non-indexed; run it through the weld/shrink pipeline');
    }
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const h = bb.max.y - bb.min.y;
    const s = CROWN / h;
    const m = new THREE.Matrix4()
      .makeScale(s, s, s)
      .multiply(new THREE.Matrix4().makeTranslation(
        -(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
    geom.applyMatrix4(m);
    geom.computeVertexNormals();
    return { geom: geom, material: material };
  }

  /** Distance from point p to segment a-b (all {x,y,z}-ish arrays). */
  function segDist(px, py, pz, a, b) {
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
    const len2 = abx * abx + aby * aby + abz * abz;
    let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Build bones + weights + SkinnedMesh and wire it to the driver.
   * parts: runner.js's { body, hips, spine, chest, neck, head, legs, arms }.
   * Returns { sync, low } -- sync() mirrors the driver each frame, low()
   * reports the lowest limb tip for the road clamp.
   */
  function rig(norm, parts) {
    // Shadow the module fallback with the sculpt's own measured joints:
    // every J.* below reads the measured table.
    const J = measureJoints(norm.geom.attributes.position,
      norm.geom.attributes.position.count);
    const B = function (x, y, z) {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      return b;
    };

    // ---- skeleton, driver topology at the sculpt's own joints ----------
    const rootB = B(0, 0, 0);
    const hipsB = B(0, J.hipsY, 0); rootB.add(hipsB);
    const spineB = B(0, 0, 0); hipsB.add(spineB);
    const chestB = B(0, J.chestY - J.hipsY, 0); spineB.add(chestB);
    const neckB = B(0, J.neckY - J.chestY, 0); chestB.add(neckB);
    const headB = B(0, J.headY - J.neckY, 0); neckB.add(headB);

    const sides = {};
    for (const side of [-1, 1]) {
      const thigh = B(side * J.hipX, -0.02, 0); hipsB.add(thigh);
      const shin = B(0, -(J.hipsY - 0.02 - J.kneeY), 0); thigh.add(shin);
      const foot = B(0, -(J.kneeY - J.ankleY), 0.01); shin.add(foot);
      const shoulder = B(side * J.shoulderX, J.shoulderY - J.chestY, 0); chestB.add(shoulder);
      const elbow = B(side * 0.012, -(J.shoulderY - J.elbowY), 0); shoulder.add(elbow);
      sides[side] = { thigh: thigh, shin: shin, foot: foot, shoulder: shoulder, elbow: elbow };
    }

    const bones = [rootB, hipsB, spineB, chestB, neckB, headB];
    for (const s of [-1, 1]) {
      bones.push(sides[s].thigh, sides[s].shin, sides[s].foot,
        sides[s].shoulder, sides[s].elbow);
    }
    const bi = new Map(bones.map(function (b, i) { return [b, i]; }));

    // ---- weights: capsule segments, best-two blend ---------------------
    // Each entry: bone, segment endpoints, and a side gate (0 = both).
    const segs = [];
    function seg(bone, a, b, side, boost) {
      segs.push({ i: bi.get(bone), a: a, b: b, side: side || 0, boost: boost || 1 });
    }
    seg(hipsB, [0, J.hipsY - 0.10, 0], [0, J.hipsY + 0.06, 0]);
    seg(chestB, [0, J.hipsY + 0.10, 0], [0, J.neckY - 0.02, 0]);
    seg(neckB, [0, J.neckY - 0.01, 0], [0, J.headY - 0.05, 0]);
    seg(headB, [0, J.headY, 0], [0, CROWN, 0], 0, 1.6);
    for (const s of [-1, 1]) {
      seg(sides[s].thigh, [s * J.hipX, J.hipsY - 0.03, 0], [s * J.hipX, J.kneeY, 0], s);
      seg(sides[s].shin, [s * J.hipX, J.kneeY, 0], [s * J.hipX, J.ankleY, 0], s);
      seg(sides[s].foot, [s * J.hipX, J.ankleY - 0.02, 0], [s * J.hipX, 0.03, J.footZ], s, 1.4);
      seg(sides[s].shoulder, [s * J.shoulderX, J.shoulderY, 0],
        [s * (J.shoulderX + 0.012), J.elbowY, 0], s);
      seg(sides[s].elbow, [s * (J.shoulderX + 0.012), J.elbowY, 0],
        [s * (J.shoulderX + 0.02), J.handY - 0.06, 0], s, 1.3);
    }

    // ---- assignment is GEODESIC, and that is the whole lesson ----------
    // Two euclidean passes failed the same way: the sculpt's arms hang AT
    // the body's sides, so the forearm segment passes nearer to the hip
    // pouches than the thigh does, and nearer to the wristband than the
    // wrist is to anything else -- distance through SPACE cannot tell an
    // arm from the torso it is touching. Distance through the SURFACE can:
    // a hip vertex only reaches the forearm's seed by walking up the arm
    // through the shoulder. So: seed each bone with the vertices its
    // segment unambiguously owns, then multi-source Dijkstra over the mesh
    // edges assigns every vertex to the seed region it is geodesically
    // nearest. Blending happens after, and only across each bone's own
    // parent joint.
    const pos = norm.geom.attributes.position;
    const n = pos.count;

    // vertex adjacency from the (welded) index
    const nbr = new Array(n);
    for (let i = 0; i < n; i++) nbr[i] = [];
    const idx = norm.geom.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b);
    }

    const assign = new Int16Array(n).fill(-1);
    const dist = new Float32Array(n).fill(1e9);
    // seeds: close to a segment AND inside that segment's own region gate
    const armX = 0.155;    // inboard of this cannot seed an arm
    const seedQ = [];
    for (let v = 0; v < n; v++) {
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      if (py > J.neckY + 0.05) { assign[v] = bi.get(headB); dist[v] = 0; seedQ.push(v); continue; }
      let best = -1, bd = 1e9;
      for (let k = 0; k < segs.length; k++) {
        const g = segs[k];
        if (g.side !== 0 && px * g.side < -0.02) continue;
        const isArm = g.i === bi.get(sides[-1].shoulder) || g.i === bi.get(sides[1].shoulder)
          || g.i === bi.get(sides[-1].elbow) || g.i === bi.get(sides[1].elbow);
        if (isArm && Math.abs(px) < armX) continue;
        const isCore = g.i === bi.get(hipsB) || g.i === bi.get(chestB) || g.i === bi.get(neckB);
        if (isCore && Math.abs(px) > 0.17) continue;
        const d = segDist(px, py, pz, g.a, g.b) / g.boost;
        if (d < bd) { bd = d; best = g.i; }
      }
      if (best >= 0 && bd < 0.055) { assign[v] = best; dist[v] = 0; seedQ.push(v); }
    }

    // multi-source Dijkstra over the edge graph, on a small binary heap
    const hp = [];
    function hpush(d, v) {
      hp.push([d, v]); let i = hp.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (hp[p][0] <= hp[i][0]) break;
        const t = hp[p]; hp[p] = hp[i]; hp[i] = t; i = p; }
    }
    function hpop() {
      const top = hp[0], last = hp.pop();
      if (hp.length) { hp[0] = last; let i = 0;
        for (;;) { const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < hp.length && hp[l][0] < hp[m][0]) m = l;
          if (r < hp.length && hp[r][0] < hp[m][0]) m = r;
          if (m === i) break; const t = hp[m]; hp[m] = hp[i]; hp[i] = t; i = m; } }
      return top;
    }
    for (const v of seedQ) hpush(0, v);
    // Edge cost, with CONTACT-ZONE penalties. The sculpt's arms touch its
    // flanks and its thighs touch each other, and the shrink pipeline's
    // weld fused those contacts -- so the edge graph has bridges where the
    // bodies merely lean together, and the geodesic flood leaks a strip of
    // ribs onto the forearm through them. An edge whose midpoint lies in a
    // contact shadow costs 8x, which keeps the flood on the limb it
    // started on without forbidding anything outright.
    const _pen = function (x, y, z) {
      // arm-against-flank band, both sides
      if (Math.abs(x) > 0.125 && Math.abs(x) < 0.20 && y > 0.52 && y < 1.06
        && Math.abs(z) < 0.13) return 8;
      // thigh-against-thigh, the inner crotch line
      if (Math.abs(x) < 0.055 && y > 0.42 && y < 0.68) return 8;
      return 1;
    };
    const _dx = function (a, b) {
      const x = pos.getX(a) - pos.getX(b), y = pos.getY(a) - pos.getY(b),
        z = pos.getZ(a) - pos.getZ(b);
      const mx = (pos.getX(a) + pos.getX(b)) / 2, my = (pos.getY(a) + pos.getY(b)) / 2,
        mz = (pos.getZ(a) + pos.getZ(b)) / 2;
      return Math.sqrt(x * x + y * y + z * z) * _pen(mx, my, mz);
    };
    while (hp.length) {
      const top = hpop();
      const d = top[0], v = top[1];
      if (d > dist[v]) continue;
      const ns = nbr[v];
      for (let k = 0; k < ns.length; k++) {
        const u = ns[k];
        const nd = d + _dx(v, u);
        if (nd < dist[u]) { dist[u] = nd; assign[u] = assign[v]; hpush(nd, u); }
      }
    }
    // decimation can leave tiny disconnected islands: euclidean fallback
    for (let v = 0; v < n; v++) {
      if (assign[v] >= 0) continue;
      const px = pos.getX(v), py = pos.getY(v), pz = pos.getZ(v);
      let best = bi.get(chestB), bd = 1e9;
      for (let k = 0; k < segs.length; k++) {
        const g = segs[k];
        if (g.side !== 0 && px * g.side < -0.02) continue;
        const d = segDist(px, py, pz, g.a, g.b);
        if (d < bd) { bd = d; best = g.i; }
      }
      assign[v] = best;
    }

    // ---- blend across each bone's own parent joint ---------------------
    // Hard regions bend like armour; a strip of shared weight around the
    // joint the region actually hinges on is what makes it flesh. Width
    // 0.09 -- roughly a knee's worth of skin on this sculpt.
    const jointOf = new Map();   // bone index -> [joint rest pos, parent index]
    function joint(bone, p) {
      // The joint is the bone's own origin: sum rest offsets up the chain.
      let x = 0, y = 0, z = 0;
      for (let b2 = bone; b2; b2 = (b2.parent && b2.parent.isBone) ? b2.parent : null) {
        x += b2.position.x; y += b2.position.y; z += b2.position.z;
      }
      jointOf.set(bi.get(bone), [[x, y, z], bi.get(p)]);
    }
    for (const s of [-1, 1]) {
      joint(sides[s].thigh, hipsB); joint(sides[s].shin, sides[s].thigh);
      joint(sides[s].foot, sides[s].shin);
      joint(sides[s].shoulder, chestB); joint(sides[s].elbow, sides[s].shoulder);
    }
    joint(chestB, hipsB); joint(neckB, chestB); joint(headB, neckB);

    // Blend radius PER JOINT: the shoulder is where the sleeve, the armpit
    // and the flank all meet -- a 0.09 sphere left the sleeve hem tearing
    // off the shirt at the stance's abduction -- so it blends over nearly
    // twice the reach; the hip likewise. Fingers-to-forearm and the ankle
    // stay tight or the blend turns the wrist to rubber.
    const BR_OF = {};
    for (const s of [-1, 1]) {
      BR_OF[bi.get(sides[s].shoulder)] = 0.17;
      BR_OF[bi.get(sides[s].elbow)] = 0.08;
      BR_OF[bi.get(sides[s].thigh)] = 0.13;
      BR_OF[bi.get(sides[s].shin)] = 0.09;
      BR_OF[bi.get(sides[s].foot)] = 0.07;
    }
    const BR = 0.09;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      const a = assign[v];
      let w2 = 0, b2i = 0;
      const j = jointOf.get(a);
      if (j) {
        const px = pos.getX(v) - j[0][0], py = pos.getY(v) - j[0][1],
          pz = pos.getZ(v) - j[0][2];
        const e = Math.sqrt(px * px + py * py + pz * pz);
        const br = BR_OF[a] || BR;
        if (e < br) { w2 = 0.5 * (1 - e / br); b2i = j[1]; }
      }
      skinIndex[v * 4] = a; skinWeight[v * 4] = 1 - w2;
      skinIndex[v * 4 + 1] = b2i; skinWeight[v * 4 + 1] = w2;
    }
    norm.geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    norm.geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

    // ---- the mesh, bound under the driver's own body pivot -------------
    // Parent the skeleton root under `body` so the bob, the duck drop, the
    // landing squash and the road clamp all flow into the costume through
    // the same pivot the code body used.
    const mat = norm.material;
    mat.roughness = 0.95; mat.metalness = 0;
    const sm = new THREE.SkinnedMesh(norm.geom, mat);
    sm.frustumCulled = false;   // bones can carry it outside the rest bounds
    parts.body.add(rootB);
    parts.body.add(sm);
    parts.body.updateMatrixWorld(true);
    sm.bind(new THREE.Skeleton(bones));

    // ---- the bib rides the sculpt's own chest --------------------------
    // The 26.2 panel survives the swap (runner.js keeps it), but it was
    // hung on the DRIVER chest -- 0.19 lower than the sculpt's chest and
    // radiused for the code torso, so it floated off the model's back.
    // Re-parent it to the chest BONE and fit it to the sculpt: down its
    // local y to the mid-back, squeezed in z to the model's shallower
    // torso. The flutter machinery writes the geometry buffer and never
    // asks who the parent is.
    parts.chest.children.slice().forEach(function (o) {
      if (o.userData && o.userData.keep) {
        chestB.add(o);
        o.position.set(0, -0.145, 0.012);
        o.scale.set(0.86, 0.92, 0.62);
      }
    });

    // ---- the driver map ------------------------------------------------
    const map = [
      [parts.hips, hipsB], [parts.spine, spineB], [parts.chest, chestB],
      [parts.neck, neckB], [parts.head, headB],
    ];
    for (const L of parts.legs) {
      const S = sides[L.side];
      map.push([L.hip, S.thigh], [L.knee, S.shin], [L.ankle, S.foot]);
    }
    for (const A of parts.arms) {
      const S = sides[A.side];
      map.push([A.shoulder, S.shoulder], [A.elbow, S.elbow]);
    }
    // Driver pivots whose POSITIONS animate, with their rest constants
    // (from runner.js's create) so the delta can be re-applied at the
    // bone's own rest. Everything else translates only through `body`.
    const shoulderRestX = 0.222;
    const spineRest = spineB.position.clone();
    const shoulderRest = { '-1': sides[-1].shoulder.position.clone(),
      '1': sides[1].shoulder.position.clone() };

    function sync() {
      for (let i = 0; i < map.length; i++) {
        map[i][1].quaternion.copy(map[i][0].quaternion);
      }
      // spine compression / slide shift, as deltas off the driver's rest 0.
      spineB.position.set(spineRest.x + parts.spine.position.x,
        spineRest.y + parts.spine.position.y,
        spineRest.z + parts.spine.position.z);
      for (const A of parts.arms) {
        const r = shoulderRest[String(A.side)];
        sides[A.side].shoulder.position.set(
          r.x + (A.shoulder.position.x - A.side * shoulderRestX),
          r.y + (A.shoulder.position.y - -0.004),
          r.z + A.shoulder.position.z);
      }
    }

    // Lowest limb tip, world y, for the road clamp: with a SkinnedMesh the
    // geometry's own bounds are the rest pose, so the clamp reads the BONES.
    const _v = new THREE.Vector3();
    const tips = [sides[-1].foot, sides[1].foot, sides[-1].elbow, sides[1].elbow, headB];
    const TIP_R = 0.10;   // a tip is a joint; the flesh around it is ~this
    function low() {
      let min = 1e9;
      for (const t of tips) {
        t.getWorldPosition(_v);
        if (_v.y < min) min = _v.y;
      }
      return min - TIP_R;
    }

    return { sync: sync, low: low, mesh: sm };
  }

  /**
   * A model that arrives ALREADY RIGGED (Meshy's auto-rig, Mixamo, any
   * humanoid skeleton) uses its own professional skin weights, and this
   * maps the driver onto its bones. Two problems the procedural path
   * never had:
   *
   *   NAMES. Their bones are found by pattern (mixamorig:LeftUpLeg,
   *   Hips, Spine2...), our sides by sign: driver side -1 sits at -x,
   *   which on a character facing +z is HIS RIGHT.
   *
   *   REST POSE. Their rest is a T- or A-pose with bone axes pointing
   *   along the limbs; the driver's rest is arms-down with identity
   *   orientations. So rotations cannot be copied -- they are TRANSPLANTED
   *   as world-space deltas: the bone's world rotation (relative to the
   *   shared body pivot) is moved off its rest by exactly the delta the
   *   driver pivot has moved off its own rest, computed top-down so each
   *   bone's local is solved against its parent's already-solved world.
   */
  function rigFromSkeleton(gltf, parts) {
    let sm = null;
    gltf.scene.traverse(function (o) { if (o.isSkinnedMesh && !sm) sm = o; });
    if (!sm) return null;

    // Normalise the whole scene: feet to y=0, height to CROWN.
    gltf.scene.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(gltf.scene);
    const s = CROWN / (bb.max.y - bb.min.y);
    gltf.scene.scale.setScalar(s);
    gltf.scene.position.set(0, 0, 0);
    gltf.scene.updateMatrixWorld(true);
    const bb2 = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.set(-(bb2.min.x + bb2.max.x) / 2, -bb2.min.y,
      -(bb2.min.z + bb2.max.z) / 2);

    // Find their bones by name pattern.
    const boneByName = {};
    gltf.scene.traverse(function (o) {
      if (o.isBone) boneByName[o.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = o;
    });
    function find() {
      for (let i = 0; i < arguments.length; i++) {
        const want = arguments[i];
        for (const k of Object.keys(boneByName)) {
          if (k.indexOf(want) >= 0) return boneByName[k];
        }
      }
      return null;
    }
    const M = {
      hips: find('hips', 'pelvis'),
      spine: find('spine1', 'spine'),
      chest: find('spine2', 'chest', 'spine1'),
      neck: find('neck'),
      head: find('head'),
    };
    const sideMap = { '-1': 'right', '1': 'left' };
    for (const L of parts.legs) {
      const sn = sideMap[String(L.side)];
      M['thigh' + L.side] = find(sn + 'upleg', sn + 'upperleg', sn + 'thigh');
      M['shin' + L.side] = find(sn + 'leg', sn + 'lowerleg', sn + 'shin', sn + 'calf');
      M['foot' + L.side] = find(sn + 'foot');
    }
    for (const A of parts.arms) {
      const sn = sideMap[String(A.side)];
      M['upper' + A.side] = find(sn + 'arm', sn + 'upperarm');
      M['fore' + A.side] = find(sn + 'forearm', sn + 'lowerarm');
    }
    if (!M.hips || !M.head || !M['thigh-1'] || !M['upper-1']) {
      console.error('MR.Skin: rigged model missing expected bones',
        Object.keys(boneByName).join(','));
      return null;
    }

    // Driver pairs. Chest carries the shoulder-adjacent spine bone; the
    // driver's shoulder maps to their upper arm, elbow to forearm.
    const pairs = [];
    const add = function (pivot, bone) { if (pivot && bone) pairs.push([pivot, bone]); };
    add(parts.hips, M.hips);
    if (M.spine && M.spine !== M.hips) add(parts.spine, M.spine);
    if (M.chest && M.chest !== M.spine) add(parts.chest, M.chest);
    add(parts.neck, M.neck);
    add(parts.head, M.head);
    for (const L of parts.legs) {
      add(L.hip, M['thigh' + L.side]);
      add(L.knee, M['shin' + L.side]);
      add(L.ankle, M['foot' + L.side]);
    }
    for (const A of parts.arms) {
      add(A.shoulder, M['upper' + A.side]);
      add(A.elbow, M['fore' + A.side]);
    }

    parts.body.add(gltf.scene);
    parts.body.updateMatrixWorld(true);

    // Rest snapshot, all relative to the body pivot so everything the
    // driver does above body (yaw, bob, squash) cancels out of the math.
    const bodyInv = new THREE.Quaternion();
    parts.body.getWorldQuaternion(bodyInv).invert();
    const rest = new Map();   // bone -> { local: Q, worldRel: Q }
    const _q = new THREE.Quaternion();
    // include every ancestor bone of mapped bones so parents resolve
    const all = new Set();
    for (const pr of pairs) {
      for (let b = pr[1]; b && (b.isBone || b === gltf.scene); b = b.parent) all.add(b);
    }
    for (const b of all) {
      b.getWorldQuaternion(_q);
      rest.set(b, {
        local: b.quaternion.clone(),
        worldRel: bodyInv.clone().multiply(_q).normalize(),
      });
    }
    const driverOf = new Map(pairs.map(function (pr) { return [pr[1], pr[0]]; }));

    const _pw = new THREE.Quaternion(), _delta = new THREE.Quaternion(),
      _target = new THREE.Quaternion(), _parentW = new THREE.Quaternion(),
      _bw = new THREE.Quaternion();
    // solved world-relative rotations for this frame
    const solved = new Map();
    function worldRelOf(b) {
      if (solved.has(b)) return solved.get(b);
      const r0 = rest.get(b);
      let q;
      if (!r0) {
        // outside the snapshot: treat as rigid at rest
        q = new THREE.Quaternion();
        b.getWorldQuaternion(q).premultiply(bodyInv);
      } else {
        const parent = b.parent && (b.parent.isBone || b.parent === gltf.scene)
          ? worldRelOf(b.parent) : new THREE.Quaternion();
        q = parent.clone().multiply(b.quaternion);
      }
      solved.set(b, q);
      return q;
    }
    function sync() {
      solved.clear();
      // top-down: order pairs so parents come first (pairs were added
      // roughly top-down already; resolve via recursion regardless).
      for (const pr of pairs) {
        const pivot = pr[0], bone = pr[1];
        const r0 = rest.get(bone);
        // driver delta relative to body: pivot world rel = product of
        // pivot-chain quaternions below body (all rest-identity), so the
        // chain product IS the delta.
        _delta.identity();
        const chain = [];
        for (let p2 = pivot; p2 && p2 !== parts.body; p2 = p2.parent) chain.push(p2);
        for (let i = chain.length - 1; i >= 0; i--) _delta.multiply(chain[i].quaternion);
        // target world-rel = delta * restWorldRel
        _target.copy(_delta).multiply(r0.worldRel);
        // parent's world-rel (already solved or rigid)
        const parent = bone.parent;
        const pq = (parent && (parent.isBone || parent === gltf.scene))
          ? worldRelOf(parent) : new THREE.Quaternion();
        _parentW.copy(pq).invert();
        bone.quaternion.copy(_parentW.multiply(_target));
        solved.set(bone, _target.clone());
      }
    }

    const _v = new THREE.Vector3();
    const tips = [M['foot-1'], M['foot1'], M['fore-1'], M['fore1'], M.head]
      .filter(Boolean);
    function low() {
      let min = 1e9;
      for (const t of tips) {
        t.getWorldPosition(_v);
        if (_v.y < min) min = _v.y;
      }
      return min - 0.10;
    }

    console.log('MR.Skin: using the model\'s own rig (' + pairs.length + ' joints mapped)');
    return { sync: sync, low: low, mesh: sm };
  }

  /**
   * Entry point. Called by runner.js's create() when a model is embedded.
   * Async: the code body runs until the parse lands, then the costume
   * replaces it between two frames. A rigged model uses its own skeleton
   * and weights; an unrigged one gets the procedural rig.
   */
  function attach(parts, onRigged) {
    if (!MR.EMBED || !MR.EMBED.miles || !THREE.GLTFLoader) return;
    load(MR.EMBED.miles, function (gltf) {
      try {
        const own = rigFromSkeleton(gltf, parts);
        if (own) return onRigged(own);
        const norm = normalise(gltf.scene);
        const r = rig(norm, parts);
        onRigged(r);
      } catch (e) {
        // A bad model must never take the game down: the code body simply
        // stays on. Reported, not thrown.
        console.error('MR.Skin: attach failed, keeping the code body', e);
      }
    }, function (e) {
      console.error('MR.Skin: GLB parse failed, keeping the code body', e);
    });
  }

  return { attach: attach };
})();
