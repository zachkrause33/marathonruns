/**
 * The sculpted Miles: skin a modelled GLB onto the code rig.
 *
 * The owner generated a sculpted character from the concept render (Meshy),
 * and a sculpted mesh is the one thing primitives cannot become -- a single
 * continuous surface that BENDS at the joints. This module is the bridge:
 * it takes the model GLB (embedded as MR.EMBED.miles base64, or fetched
 * from MR.ASSETS.miles in the site flavor -- see tools/build.js),
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

  /** Parse a GLB ArrayBuffer and hand the scene to cb(gltf, buf). */
  function parseBuf(buf, cb, err) {
    new THREE.GLTFLoader().parse(buf, '', function (gltf) { cb(gltf, buf); }, err);
  }

  /** Decode the embed and hand the parsed scene to cb(gltf, buf). */
  function load(b64, cb, err) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    parseBuf(buf, cb, err);
  }

  /**
   * The basecolor texture, extracted from the GLB by hand and decoded
   * through an <img> data URL. The owner's first phone run reported "Miles
   * has no color": GLTFLoader decodes embedded textures through
   * createImageBitmap, which works in the desktop harness and has a long
   * history of quietly failing on iOS Safari -- the material falls back to
   * untextured white. An <img> tag decodes a JPEG on every browser ever
   * shipped, so the texture goes through one. flipY false is the glTF UV
   * convention; sRGB is what a basecolor is.
   */
  function baseColorURL(buf) {
    const dv = new DataView(buf);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
    if (!json.images || !json.images.length) return null;
    const img = json.images[0];   // the shrink pipeline strips all but basecolor
    const view = json.bufferViews[img.bufferView];
    const binStart = 20 + jsonLen + 8;
    const bytes = new Uint8Array(buf, binStart + (view.byteOffset || 0), view.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return 'data:' + (img.mimeType || 'image/jpeg') + ';base64,' + btoa(s);
  }

  function baseColorTexture(buf) {
    const url = baseColorURL(buf);
    if (!url) return null;
    const tex = new THREE.TextureLoader().load(url);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * The basecolor as a decoded <img>, for callers that repaint pixels
   * before making textures (the fleet's paint shop in world.js). Same
   * extraction and the same iOS-proof <img> route as baseColorTexture;
   * err fires on a missing or undecodable image so a caller counting
   * outstanding work can settle.
   */
  function baseColorImage(buf, cb, err) {
    const url = baseColorURL(buf);
    if (!url) return err(new Error('no basecolor image'));
    const img = new Image();
    img.onload = function () { cb(img); };
    img.onerror = function () { err(new Error('basecolor image failed to decode')); };
    img.src = url;
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
  function rigFromSkeleton(gltf, parts, mat) {
    let sm = null;
    gltf.scene.traverse(function (o) { if (o.isSkinnedMesh && !sm) sm = o; });
    if (!sm) return null;
    if (mat) sm.material = mat;

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
      // Exact name first -- substring alone would hand R_Thigh's request
      // to R_ThighTwist01 whenever the key order felt like it.
      for (let i = 0; i < arguments.length; i++) {
        if (boneByName[arguments[i]]) return boneByName[arguments[i]];
      }
      for (let i = 0; i < arguments.length; i++) {
        const want = arguments[i];
        for (const k of Object.keys(boneByName)) {
          if (k.indexOf(want) >= 0 && k.indexOf('twist') < 0) return boneByName[k];
        }
      }
      return null;
    }
    // Candidates cover the two families seen in the wild: Mixamo-style
    // (LeftUpLeg, Spine2) and Tripo's (L_Thigh, R_Calf, Waist, Spine02).
    // Names are normalised to bare lowercase alphanumerics before
    // matching, so L_Thigh is "lthigh". Twist helper bones are never
    // mapped -- unanimated, they simply follow their parents.
    const M = {
      hips: find('hip', 'hips', 'pelvis'),
      spine: find('waist', 'spine01', 'spine1'),
      chest: find('spine02', 'spine2', 'chest', 'spine01', 'spine1', 'spine'),
      neck: find('necktwist01', 'neck'),
      head: find('head'),
    };
    // WHICH SIDE IS LEFT is measured, not assumed. Driver side -1 sits at
    // -x; gltf convention puts a +z-facing character's Left at +x -- but
    // this rig's L_Thigh measured at x=-0.089, so its naming mirrors the
    // convention and the first mapping ran each driver leg into the
    // opposite thigh. Probe the actual bone x and map to whatever is
    // really on that side.
    let leftAtPlusX = true;
    {
      const lt = find('lthigh', 'leftupleg', 'leftthigh', 'lupleg');
      if (lt) {
        const wp = new THREE.Vector3();
        lt.getWorldPosition(wp);
        leftAtPlusX = wp.x >= 0;
        console.log('MR.Skin: left-side bones sit at ' + (leftAtPlusX ? '+x' : '-x'));
      }
    }
    const sideMap = leftAtPlusX
      ? { '-1': ['right', 'r'], '1': ['left', 'l'] }
      : { '-1': ['left', 'l'], '1': ['right', 'r'] };
    const findSide = function (side, tails) {
      for (const sn of sideMap[String(side)]) {
        for (const t of tails) {
          const b = find(sn + t);
          if (b) return b;
        }
      }
      return null;
    };
    for (const L of parts.legs) {
      M['thigh' + L.side] = findSide(L.side, ['upleg', 'upperleg', 'thigh']);
      M['shin' + L.side] = findSide(L.side, ['calf', 'lowerleg', 'shin', 'leg']);
      M['foot' + L.side] = findSide(L.side, ['foot']);
    }
    for (const A of parts.arms) {
      M['upper' + A.side] = findSide(A.side, ['upperarm', 'arm']);
      M['fore' + A.side] = findSide(A.side, ['forearm', 'lowerarm']);
    }
    if (!M.hips || !M.head || !M['thigh-1'] || !M['upper-1']) {
      console.error('MR.Skin: rigged model missing expected bones',
        Object.keys(boneByName).join(','));
      return null;
    }

    // Driver pairs. Chest carries the shoulder-adjacent spine bone; the
    // driver's shoulder maps to their upper arm, elbow to forearm.
    const pairs = [];
    const add = function (pivot, bone, frac, cap) {
      if (pivot && bone) pairs.push([pivot, bone, frac === undefined ? 1 : frac, cap || 0]);
    };
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
      // The clavicle takes a QUARTER of the shoulder's motion. Left at
      // rest it stays behind while the arm flies, and the armpit verts
      // weighted to it stretched into a ribbon from elbow to waist in
      // the jump's full abduction. A real shoulder girdle travels with
      // the arm; a quarter is the classic share.
      // The clavicle takes 0.40 of the shoulder's motion; the shoulder's
      // abduction cap lives in capQ below, where it applies to the WHOLE
      // chain -- the first version capped only the upper-arm pair, the
      // forearm inherited the shoulder's rotation uncapped through the
      // chain walk, and the membrane simply moved to the elbows (the
      // owner's second screenshot showed exactly that).
      add(A.shoulder, M['clav' + A.side] ||
        (M['clav' + A.side] = findSide(A.side, ['clavicle', 'shoulder'])), 0.40);
      add(A.shoulder, M['upper' + A.side]);
      add(A.elbow, M['fore' + A.side]);
    }

    // ---- armpit weight surgery -----------------------------------------
    // The membrane the owner photographed twice: vertices in the armpit
    // whose weights MIX arm and torso stretch into webbing the moment the
    // arm leaves the flank -- capping the arm's travel only moved the
    // stretch to the elbow. So the mix itself goes: inside the armpit
    // region, a vertex snaps to whichever side already owns most of it.
    // A sharp crease where arm meets flank reads as a crease; a membrane
    // reads as a wing.
    {
      const geo = sm.geometry;
      const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
      const posA = geo.getAttribute('position');
      if (si && sw && posA && sm.skeleton) {
        const armIdx = new Set();
        sm.skeleton.bones.forEach(function (b2, i) {
          const nm = b2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (/upperarm|forearm|hand/.test(nm)) armIdx.add(i);
        });
        // region bounds in the mesh's LOCAL space (pre-normalisation): use
        // fractions of its own bbox height so the surgery is scale-free.
        // 0.22..0.80, not the armpit-only 0.45..0.78 of the first draft:
        // edge-stretch measurement in the jump pose put the worst verts at
        // 29-64% of height, co-owned by the HAND and THIGH-TWIST bones --
        // the fists hang touching the thighs at rest and the auto-weights
        // blended them, so the membrane ran fist-to-thigh, below the band.
        geo.computeBoundingBox();
        const bb = geo.boundingBox, H = bb.max.y - bb.min.y;
        const y0 = bb.min.y + H * 0.22, y1 = bb.min.y + H * 0.80;
        // r160 BufferAttribute has no getComponent; go through the four
        // named accessors instead.
        const gets = [function (a, v2) { return a.getX(v2); }, function (a, v2) { return a.getY(v2); },
          function (a, v2) { return a.getZ(v2); }, function (a, v2) { return a.getW(v2); }];
        const sets = [function (a, v2, x) { a.setX(v2, x); }, function (a, v2, x) { a.setY(v2, x); },
          function (a, v2, x) { a.setZ(v2, x); }, function (a, v2, x) { a.setW(v2, x); }];
        let snapped = 0;
        for (let v = 0; v < si.count; v++) {
          const py = posA.getY(v);
          if (py < y0 || py > y1) continue;
          let wArm = 0, wTot = 0;
          for (let k = 0; k < 4; k++) {
            const w = gets[k](sw, v);
            wTot += w;
            if (armIdx.has(gets[k](si, v))) wArm += w;
          }
          if (wTot <= 0) continue;
          const f = wArm / wTot;
          if (f < 0.04 || f > 0.96) continue;   // already owned; leave it
          const keepArm = f >= 0.5;
          let kept = 0;
          for (let k = 0; k < 4; k++) {
            const isArm = armIdx.has(gets[k](si, v));
            if (isArm !== keepArm) sets[k](sw, v, 0);
            else kept += gets[k](sw, v);
          }
          if (kept > 0) {
            for (let k = 0; k < 4; k++) {
              sets[k](sw, v, gets[k](sw, v) / kept);
            }
            snapped++;
          }
        }
        sw.needsUpdate = true;
        console.log('MR.Skin: armpit surgery snapped ' + snapped + ' mixed vertices');

        // ---- the stolen pouch --------------------------------------------
        // The membrane's second body, found in the jump close-up: the hip
        // pouches and a strip of flank are weighted to the FOREARM -- the
        // fists hang touching them at rest, and the auto-rig's weights
        // fused what touches. Limb flesh, by definition, hugs its bone:
        // any arm-owned vertex farther from its arm's bone segments than
        // the measured flesh radius is not arm flesh. It goes back to the
        // body (remaining influences renormalised; wholly arm-owned verts
        // hand themselves to the hips).
        const armBones = [];
        sm.skeleton.bones.forEach(function (b2, i) {
          const nm = b2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (/upperarm|forearm|hand/.test(nm) && !/twist/.test(nm)) armBones.push([i, b2]);
        });
        let hipsIdx = 0;
        sm.skeleton.bones.forEach(function (b2, i) {
          const nm = b2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (nm === 'hip' || nm === 'hips' || nm === 'pelvis') hipsIdx = i;
        });
        gltf.scene.updateMatrixWorld(true);
        const segPts = [];   // [x0,y0,z0, x1,y1,z1] per arm bone, bind space
        const _wv = new THREE.Vector3(), _wv2 = new THREE.Vector3();
        for (const ab of armBones) {
          ab[1].getWorldPosition(_wv);
          // segment end: the bone's first bone child, or 0.2H below
          let end = null;
          for (const c of ab[1].children) if (c.isBone) { end = c; break; }
          if (end) end.getWorldPosition(_wv2);
          else _wv2.set(_wv.x, _wv.y - H * 0.10, _wv.z);
          segPts.push([ab[0], _wv.x, _wv.y, _wv.z, _wv2.x, _wv2.y, _wv2.z]);
        }
        const segD = function (px, py2, pz, s) {
          const ax = s[1], ay = s[2], az = s[3];
          const bx2 = s[4], by = s[5], bz = s[6];
          const abx = bx2 - ax, aby = by - ay, abz = bz - az;
          const l2 = abx * abx + aby * aby + abz * abz;
          let t = l2 > 0 ? ((px - ax) * abx + (py2 - ay) * aby + (pz - az) * abz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const dx = px - ax - abx * t, dy = py2 - ay - aby * t, dz = pz - az - abz * t;
          return Math.sqrt(dx * dx + dy * dy + dz * dz);
        };
        // flesh radius: measured as the median arm-vert distance, not guessed.
        // Ownership counts TWIST bones too (their verts fly with the arm just
        // the same); only the segments come from the main chain.
        const dists = [];
        const armSet = new Set();
        sm.skeleton.bones.forEach(function (b2, i) {
          const nm = b2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (/upperarm|forearm|hand/.test(nm)) armSet.add(i);
        });
        // Vertices live in bind space; the bone segments in world. The
        // first draft compared them raw, measured a 0.385 "flesh radius"
        // and trimmed nothing -- transform each vertex through the mesh's
        // own world matrix before measuring.
        sm.updateWorldMatrix(true, false);
        const _pv = new THREE.Vector3();
        const vWorld = function (v2) {
          return _pv.set(posA.getX(v2), posA.getY(v2), posA.getZ(v2))
            .applyMatrix4(sm.matrixWorld);
        };
        for (let v = 0; v < si.count; v++) {
          let wArm = 0;
          for (let k = 0; k < 4; k++) if (armSet.has(gets[k](si, v))) wArm += gets[k](sw, v);
          if (wArm < 0.5) continue;
          const w2 = vWorld(v);
          let d = 1e9;
          for (const s of segPts) d = Math.min(d, segD(w2.x, w2.y, w2.z, s));
          dists.push(d);
        }
        dists.sort(function (a2, b2) { return a2 - b2; });
        const fleshR = dists.length ? dists[Math.floor(dists.length * 0.5)] * 2.4 : 0;
        console.log('MR.Skin: arm-flesh median ' + (dists.length
          ? dists[Math.floor(dists.length * 0.5)].toFixed(3) : 'n/a'));
        let returned = 0;
        if (fleshR > 0) {
          for (let v = 0; v < si.count; v++) {
            let wArm = 0, wTot = 0;
            for (let k = 0; k < 4; k++) {
              const w = gets[k](sw, v);
              wTot += w;
              if (armSet.has(gets[k](si, v))) wArm += w;
            }
            if (wArm <= 0 || wTot <= 0) continue;
            const w2 = vWorld(v);
            let d = 1e9;
            for (const s of segPts) d = Math.min(d, segD(w2.x, w2.y, w2.z, s));
            if (d <= fleshR) continue;
            let kept = 0;
            for (let k = 0; k < 4; k++) {
              if (armSet.has(gets[k](si, v))) sets[k](sw, v, 0);
              else kept += gets[k](sw, v);
            }
            if (kept > 0) {
              for (let k = 0; k < 4; k++) sets[k](sw, v, gets[k](sw, v) / kept);
            } else {
              sets[0](si, v, hipsIdx); sets[0](sw, v, 1);
              sets[1](sw, v, 0); sets[2](sw, v, 0); sets[3](sw, v, 0);
            }
            returned++;
          }
        }
        console.log('MR.Skin: pouch surgery returned ' + returned
          + ' far verts (flesh radius ' + fleshR.toFixed(3) + ')');

        // ---- cut the fused bridges ---------------------------------------
        // What survives every weight fix is TOPOLOGY: the sculpt's fists are
        // fused to its thighs (they touch, and the shrink weld sealed the
        // contact), so triangles physically span from arm flesh to leg
        // flesh, and a spanning triangle must stretch whoever owns its
        // corners. Those triangles are deleted: the holes sit inside the
        // hand/hip contact shadow, facing each other, and the culled
        // backfaces make them read as the natural gap between a fist and a
        // hip rather than as geometry.
        const legSet = new Set();
        sm.skeleton.bones.forEach(function (b2, i) {
          const nm = b2.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (/thigh|calf|foot|toe/.test(nm)) legSet.add(i);
        });
        const classOf = new Int8Array(si.count);   // 1 arm, 2 leg, 0 other
        for (let v = 0; v < si.count; v++) {
          let wa = 0, wl = 0, wt = 0;
          for (let k = 0; k < 4; k++) {
            const w = gets[k](sw, v), bi2 = gets[k](si, v);
            wt += w;
            if (armSet.has(bi2)) wa += w;
            else if (legSet.has(bi2)) wl += w;
          }
          if (wt > 0 && wa / wt > 0.6) classOf[v] = 1;
          else if (wt > 0 && wl / wt > 0.6) classOf[v] = 2;
        }
        const oldIdx = geo.index.array;
        const kept2 = [];
        let cut = 0;
        for (let t = 0; t < oldIdx.length; t += 3) {
          const c0 = classOf[oldIdx[t]], c1 = classOf[oldIdx[t + 1]], c2 = classOf[oldIdx[t + 2]];
          const hasArm = c0 === 1 || c1 === 1 || c2 === 1;
          const hasLeg = c0 === 2 || c1 === 2 || c2 === 2;
          if (hasArm && hasLeg) { cut++; continue; }
          kept2.push(oldIdx[t], oldIdx[t + 1], oldIdx[t + 2]);
        }
        if (cut > 0) {
          geo.setIndex(new THREE.BufferAttribute(
            (si.count > 65535 ? new Uint32Array(kept2) : new Uint16Array(kept2)), 1));
        }
        console.log('MR.Skin: cut ' + cut + ' arm/leg bridge triangles');
      }
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

    // ---- symmetrise the limb anchors -----------------------------------
    // Tripo rigged the sculpt in its natural stance -- one leg pitched
    // ~13 degrees off the other -- and the transplant anchors each bone on
    // its own rest, so a symmetric driver cycle landed asymmetrically:
    // the owner's phone report, "left leg is good, right leg is not".
    // Each left/right pair's anchors are replaced by their mirror-average
    // (reflection across x=0 maps a quaternion (w,x,y,z) to (w,x,-y,-z)),
    // so both limbs swing off the SAME straightened stance; the few
    // degrees of offset this introduces against the bind pose is a
    // constant the skin absorbs invisibly.
    const mirrorQ = function (q) { return new THREE.Quaternion(q.x, -q.y, -q.z, q.w); };
    for (const key of ['thigh', 'shin', 'foot', 'upper', 'fore', 'clav']) {
      const a = M[key + '-1'], b2 = M[key + '1'];
      if (!a || !b2 || !rest.get(a) || !rest.get(b2)) continue;
      const qa = rest.get(a).worldRel, qb = rest.get(b2).worldRel;
      const mb = mirrorQ(qb);
      if (qa.dot(mb) < 0) mb.set(-mb.x, -mb.y, -mb.z, -mb.w);
      const qs = qa.clone().slerp(mb, 0.5).normalize();
      qa.copy(qs);
      qb.copy(mirrorQ(qs));
    }
    // ...and the ATTACHMENT POINTS: the thigh and arm heads sit at
    // different offsets on each side of the stance-rigged pelvis, so even
    // symmetric anchors swung from asymmetric sockets. The chain heads are
    // mirror-averaged in the body frame; children ride along untouched.
    {
      const bodyInvM = new THREE.Matrix4().copy(parts.body.matrixWorld).invert();
      const rel = function (b2) {
        const v = new THREE.Vector3();
        b2.getWorldPosition(v);
        return v.applyMatrix4(bodyInvM);
      };
      const put = function (b2, p) {
        const w = p.clone().applyMatrix4(parts.body.matrixWorld);
        const inv = new THREE.Matrix4().copy(b2.parent.matrixWorld).invert();
        b2.position.copy(w.applyMatrix4(inv));
      };
      for (const key of ['thigh', 'clav', 'upper']) {
        const a = M[key + '-1'], b2 = M[key + '1'];
        if (!a || !b2) continue;
        const pa = rel(a), pb = rel(b2);
        const ps = new THREE.Vector3((pa.x - pb.x) / 2, (pa.y + pb.y) / 2, (pa.z + pb.z) / 2);
        put(a, ps);
        put(b2, new THREE.Vector3(-ps.x, ps.y, ps.z));
        a.updateMatrixWorld(true);
        b2.updateMatrixWorld(true);
      }
    }

    const _pw = new THREE.Quaternion(), _delta = new THREE.Quaternion(),
      _target = new THREE.Quaternion(), _parentW = new THREE.Quaternion(),
      _bw = new THREE.Quaternion(), _IDENT = new THREE.Quaternion();
    // solved world-relative rotations for this frame
    const solved = new Map();
    // Non-bone ancestors (the Armature node between the scene and the
    // bones) are STATIC but not identity -- this rig carries a transform
    // there, and the first solver treated it as identity while the rest
    // snapshot included it, so every bone's local got the armature's
    // rotation baked in as error: the legs swung diagonally, one side
    // worse than the other. Their world-relative rotation is cached once;
    // they never animate.
    const staticRel = new Map();
    function staticRelOf(node) {
      if (staticRel.has(node)) return staticRel.get(node);
      const q = new THREE.Quaternion();
      node.getWorldQuaternion(q).premultiply(bodyInv).normalize();
      staticRel.set(node, q);
      return q;
    }
    function worldRelOf(b) {
      if (solved.has(b)) return solved.get(b);
      const r0 = rest.get(b);
      let q;
      if (!r0) {
        // outside the snapshot: treat as rigid at rest
        q = new THREE.Quaternion();
        b.getWorldQuaternion(q).premultiply(bodyInv);
      } else {
        const parent = b.parent
          ? (b.parent.isBone ? worldRelOf(b.parent) : staticRelOf(b.parent))
          : new THREE.Quaternion();
        q = parent.clone().multiply(b.quaternion);
      }
      solved.set(b, q);
      return q;
    }
    // The static-ancestor cache is filled NOW, while bodyInv matches the
    // world state it was captured in -- a lazy first call mid-race would
    // fold the portrait yaw of that moment into a "static" rotation.
    for (const pr of pairs) {
      for (let a = pr[1].parent; a && a !== parts.body; a = a.parent) {
        if (!a.isBone) staticRelOf(a);
      }
    }
    // The shoulder cap, applied where it is CONSISTENT: every chain that
    // contains a shoulder pivot -- the upper arm, the clavicle share AND
    // the forearm -- reads the same capped rotation, so the arm bends as
    // one limb held short of the webbing zone instead of a capped upper
    // arm with an uncapped forearm tearing away from it. 1.05rad clears
    // the run's ~0.8 swing untouched; only the jump's 1.56 spread is
    // shortened, and the driver's own silhouette (which gameplay reads)
    // never changes.
    const SHOULDER_CAP = 1.05;
    const capQ = new Map();
    for (const A of parts.arms) capQ.set(A.shoulder, new THREE.Quaternion());
    function sync() {
      solved.clear();
      for (const [pv, q] of capQ) {
        q.copy(pv.quaternion);
        const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
        if (ang > SHOULDER_CAP) q.slerp(_IDENT, 1 - SHOULDER_CAP / ang);
      }
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
        for (let i = chain.length - 1; i >= 0; i--) {
          _delta.multiply(capQ.get(chain[i]) || chain[i].quaternion);
        }
        if (pr[2] < 1) _delta.slerp(_IDENT, 1 - pr[2]);
        // target world-rel = delta * restWorldRel
        _target.copy(_delta).multiply(r0.worldRel);
        // parent's world-rel: solved bone, or the cached static ancestor
        const parent = bone.parent;
        const pq = parent
          ? (parent.isBone ? worldRelOf(parent) : staticRelOf(parent))
          : new THREE.Quaternion();
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
    if (!THREE.GLTFLoader) return;
    const onParsed = function (gltf, buf) {
      try {
        // One material for either path: the game's own toon ramp carrying
        // the sculpt's basecolor, decoded through the iOS-proof route.
        let mat = null;
        const tex = baseColorTexture(buf);
        if (tex) {
          mat = MR.shading.toon(0xffffff, 3);
          mat.map = tex;
        }
        const own = rigFromSkeleton(gltf, parts, mat);
        if (own) return onRigged(own);
        const norm = normalise(gltf.scene);
        if (mat) norm.material = mat;
        const r = rig(norm, parts);
        onRigged(r);
      } catch (e) {
        // A bad model must never take the game down: the code body simply
        // stays on. Reported, not thrown.
        console.error('MR.Skin: attach failed, keeping the code body', e);
      }
    };
    const onErr = function (e) {
      console.error('MR.Skin: GLB parse failed, keeping the code body', e);
    };
    model('miles', onParsed, onErr);
  }

  /**
   * Shared model transport, for any module that dresses code art in a
   * sculpt (the runner's costume here, the hazard fleet in world.js).
   * Resolves a key against MR.EMBED (base64, decoded in place) or
   * MR.ASSETS (the site flavor -- tools/build.js --site -- where the model
   * is a separate file next to the page, cached by the browser
   * independently of the game code), parses through GLTFLoader, and hands
   * back cb(gltf, buf). The fetch promise is shared per key: the player
   * and the ghost both dress at boot, in parallel, and two in-flight
   * requests for the same 2 MB file is one too many. Parsing twice from
   * one buffer is fine -- GLTFLoader only reads it.
   *
   * err fires on any failure -- missing key, failed fetch, bad parse --
   * exactly once, so a caller counting outstanding models can settle.
   * The caller's code art simply stays on; nothing here may throw.
   */
  const fetchPs = {};
  function model(key, cb, err) {
    if (!THREE.GLTFLoader) return err(new Error('no GLTFLoader'));
    if (MR.EMBED && MR.EMBED[key]) {
      load(MR.EMBED[key], cb, err);
    } else if (MR.ASSETS && MR.ASSETS[key] && window.fetch) {
      if (!fetchPs[key]) {
        fetchPs[key] = fetch(MR.ASSETS[key]).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        });
      }
      fetchPs[key]
        .then(function (buf) { parseBuf(buf, cb, err); })
        .catch(err);
    } else {
      err(new Error('no model ' + key));
    }
  }

  return { attach: attach, model: model,
    baseColorTexture: baseColorTexture, baseColorImage: baseColorImage };
})();
