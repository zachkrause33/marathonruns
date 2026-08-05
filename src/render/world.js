/**
 * The track and everything beside it.
 *
 * A marathon course is 6,293 world units long; instantiating it would mean
 * tens of thousands of meshes. Everything here is therefore pooled and
 * recycled around a moving window: road tiles, hazards, scenery, structures
 * and mile banners are claimed as they enter VIEW ahead and released as they
 * fall behind BEHIND. Pool objects are reused in place, so steady-state
 * allocation is zero and the frame time does not sawtooth.
 *
 * Two things drive almost every decision below.
 *
 *  1. READABILITY. One hit ends the record attempt, so a gate has to be
 *     solved with the eyes at 60+ units, not reacted to at 15. Every hazard
 *     therefore paints its lane: a coloured, iconised mat lies on the road in
 *     front of it, sized so it is still several pixels tall when the hazard
 *     itself is a speck. Shape carries the action (triangles = jump, rungs =
 *     duck, crosses = impassable) so the read survives colour-blindness and
 *     the fog, which is fully opaque by 235 units.
 *
 *  2. DRAW CALLS, not triangles. SwiftShader at 1100x700 dies on draw count.
 *     Props are therefore merged into single vertex-coloured meshes -- a knot
 *     of eight spectators, a bridge tower with its cables, a whole 24-unit run
 *     of crowd barrier -- so richness costs geometry, which is free, instead
 *     of submissions, which are not.
 *
 * Biomes recolour the shared materials rather than swapping meshes, which is
 * what lets the palette cross-fade over a mile instead of popping at a seam.
 * But palette alone never made a place: each biome also picks the roadside
 * furniture the road tiles wear and the set pieces that get spawned beside it,
 * so THE BRIDGE actually has a bridge and RIVERSIDE actually has water.
 *
 *  3. THE CORRIDOR IS SACRED. Nothing that is not a hazard may occupy the
 *     three lanes or the air above them below OVERHEAD_Y, and nothing may
 *     stand between the camera and the next gate. That rule is what allows
 *     the landmarks at the bottom of this file to be as big as they are: they
 *     can crop the frame edge precisely because they are nowhere near the
 *     road. It is also why the rival runners are gone -- see the note where
 *     they used to be.
 */
MR.World = (function () {
  const K = MR.K;
  const S = MR.shading;
  const P = S.PALETTE;

  const VIEW = 210;      // spawn distance ahead of the runner
  const BEHIND = 34;     // release distance behind
  const TILE = 24;       // road tile length

  // ---- lane fit ---------------------------------------------------------
  // Every hazard below was drawn to fill a lane, and was authored against the
  // 2.35-unit lane the track used to have. LANE_FIT rescales those numbers to
  // whatever K.LANE_W is now, so a hazard stays exactly as wide *relative to
  // its lane* as it was drawn and a track retune can never leave one hanging
  // over its neighbour.
  //
  // It touches x ONLY. The y and z extents are what MR.Collision.BOX records
  // and audits against the jump arc and the duck pose; moving either would
  // break an agreement this file cannot see. Nothing here may change a height.
  //
  // Math.abs is LOad-BEARING, and it is what made every BLOCK render as a
  // near-black slab for as long as the flipped lane order has existed.
  // K.LANE_X is [+LANE_W, 0, -LANE_W] -- DESCENDING, because lane 0 is the
  // lane the player sees on the LEFT and screen-left is world +x for a camera
  // looking down +z (see the note in constants.js). So LANE_X[1] - LANE_X[0]
  // is -LANE_W, and every `w * LANE_FIT` below became a NEGATIVE width.
  //
  // A BoxGeometry or PlaneGeometry built with a negative width is not merely
  // the same box: it is the box MIRRORED through x = 0, which reverses the
  // winding of every triangle while leaving the authored normals alone. The
  // consequences were all invisible in a diff and all very visible on screen:
  //
  //   - the toon fill (FrontSide) drew each hazard's FAR faces and the ink
  //     shell (BackSide) drew its NEAR ones, so the shell painted the whole
  //     silhouette in 0x1b1633 ink AND depth-occluded the fill. A BLOCK, whose
  //     entire mass is hbx(), came out solid near-black -- worst of all as a
  //     train, where the slab is 6 units long and fills a third of the frame.
  //   - the caution-stripe faces (hplane) and the lane telegraph mats
  //     (1.95 * LANE_FIT) faced DOWN through the road and were culled, which
  //     is why the readability device this file is built around never drew.
  //   - the carriageway edge lines sat at 2.42 instead of 2.68.
  //
  // The magnitude was right all along, which is why the hazards were the
  // correct SIZE and only the wrong colour. Sign only.
  const LANE = Math.abs(K.LANE_X[1] - K.LANE_X[0]);
  const LANE_FIT = LANE / 2.35;

  // The widest point of any hazard, measured from its lane centre: the DUCK
  // frame's foot, 0.50 wide at 1.20 out. Anything that has to stand clear of
  // the lanes -- an aid table, a set piece -- starts from here rather than
  // from a literal that goes stale the next time the track is retuned.
  const HAZARD_HALF = 1.20 * LANE_FIT + 0.25;

  // ---- the play corridor, and the one rule about it ---------------------
  // CORRIDOR_HALF is the outermost point anything the player can collide with
  // reaches: the outer lane centre plus the widest hazard. Nothing may stand
  // inside it that is not a hazard, and no set piece may put geometry between
  // the camera and the next gate -- one contact costs the record, so an
  // "atmospheric" prop that clips the runner is a bug, not decoration.
  //
  // The big cropped-by-the-frame-edge landmarks below therefore start at
  // LANDMARK_IN, which is derived from the corridor rather than typed in, and
  // anything that reaches back over the road does so above OVERHEAD_Y. That
  // height is not a guess either: the chase camera trails 4.35 units and
  // carries part of the jump arc, sweeping to about y = 3.1 through a gate,
  // and the WALL overpass has spanned the road at 8.0 since it was added.
  const CORRIDOR_HALF = Math.max(K.TRACK_HALF_WIDTH, LANE + HAZARD_HALF);
  const LANDMARK_IN = CORRIDOR_HALF + 8.0;
  const OVERHEAD_Y = 9.0;

  // ---- biome palettes ---------------------------------------------------
  // `edge` names the roadside furniture the road tile wears; `mix` weights the
  // roadside prop lottery. Together they are what distinguishes a biome, the
  // colours only agree with it.
  // ROAD VALUE, and why these are so much lighter than tarmac.
  //
  // Measured against the reference frames: in both Subway Surfers shots the
  // surface the player runs on (crimson train roof, mint train roof) is among
  // the LIGHTEST and most saturated large masses in frame, and the eye lands
  // on it first. Ours was 0x4a4f78-0x5b5f88 slate -- the darkest, least
  // saturated large mass, and also the biggest single area on screen -- so the
  // eye went to the grass banks and the sky instead of to the road the player
  // has to read. Realistic asphalt was losing the game a readability fight it
  // did not need to be in.
  //
  // These are lifted several stops and given chroma per biome. Lane paint and
  // the hazard telegraph mats still have to sit on top of them, so nothing
  // here goes near white.
  const BIOME_LOOK = {
    'CITY START': {
      sky: [0x2b3fa8, 0x9fdcff], ground: 0x63c96b, road: 0x9aa0d8, fog: 0x9fdcff,
      edge: 'barrier',
      mix: { building: 2.6, tree: 1.1, grove: 0.3, crowd: 2.3 },
    },
    // `bank` cuts the shoulder back on one side so the water can come right up
    // to the road; at full shoulder width the river sat 35 units out and read
    // as a smear on the horizon.
    'RIVERSIDE': {
      sky: [0x1f6fb8, 0xbdf0ff], ground: 0x57c7a8, road: 0x8fb4dc, fog: 0xbdf0ff,
      edge: 'hedge', bank: -1,
      mix: { building: 0.45, tree: 2.0, grove: 2.0, crowd: 1.0 },
    },
    // Nothing stands beside a bridge deck -- the emptiness is the point, and a
    // spectator out there would be standing on the river. What the leg gets
    // instead is the towers and a ship on the water, both set pieces.
    'THE BRIDGE': {
      sky: [0x3a4fc0, 0xffd9a8], ground: 0x2f8fc4, road: 0xb9a8e0, fog: 0xffd9a8,
      edge: 'rail',
      mix: {},
    },
    'PARKLAND': {
      sky: [0x2e8fd0, 0xcdf5c0], ground: 0x6fd46a, road: 0xa8b6e2, fog: 0xcdf5c0,
      edge: 'hedge',
      mix: { building: 0.12, tree: 2.6, grove: 3.6, crowd: 1.1 },
    },
    'THE WALL': {
      sky: [0x8a3a6b, 0xffb27a], ground: 0x8f9a5e, road: 0xc79ab0, fog: 0xffb27a,
      edge: 'wall',
      mix: { building: 2.0, tree: 0.25, crowd: 0.35 },
    },
    'FINAL MILE': {
      sky: [0x24306e, 0xffcf6b], ground: 0x5cb46a, road: 0xa9a2e4, fog: 0xffcf6b,
      edge: 'barrier',
      mix: { building: 1.1, tree: 0.7, crowd: 3.4 },
    },
  };

  const PROP_KINDS = ['building', 'tree', 'grove', 'crowd'];

  // Scratch colours: applyBiome runs every frame and must not allocate.
  const _cA = new THREE.Color();
  const _cB = new THREE.Color();
  function lerpInto(out, a, b, t) {
    _cA.set(a); _cB.set(b);
    return out.copy(_cA).lerp(_cB, t);
  }

  // ---- canvas textures --------------------------------------------------
  // Generated at runtime -- still no assets.

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function texture(c, repeat) {
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  /** Canvas-drawn label texture, used by the mile banners. */
  function labelTexture(text, bg, fg, w, h, sub) {
    const c = canvas(w || 512, h || 128);
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    // A bright inner keyline stops the panel reading as a floating rectangle
    // at distance -- it is the frame that says "sign", not the text.
    g.strokeStyle = fg; g.lineWidth = Math.max(3, c.height * 0.045);
    g.strokeRect(c.height * 0.07, c.height * 0.07, c.width - c.height * 0.14, c.height - c.height * 0.14);
    g.fillStyle = fg;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fam = 'ui-sans-serif, system-ui, -apple-system, Arial, sans-serif';
    if (sub) {
      g.font = `900 ${Math.floor(c.height * 0.46)}px ${fam}`;
      g.fillText(text, c.width / 2, c.height * 0.40);
      g.font = `800 ${Math.floor(c.height * 0.20)}px ${fam}`;
      g.fillText(sub, c.width / 2, c.height * 0.76);
    } else {
      g.font = `900 ${Math.floor(c.height * 0.60)}px ${fam}`;
      g.fillText(text, c.width / 2, c.height / 2 + c.height * 0.03);
    }
    return texture(c);
  }

  /**
   * The lane telegraph that lies on the road ahead of a hazard.
   *
   * The icon is a SHAPE first and a colour second: solid up-triangles for
   * JUMP, stacked rungs for DUCK, crosses for BLOCK. At 90 units the mat is
   * about a dozen pixels tall, which is enough for shape but not for reading
   * a small hazard mesh -- which is exactly the distance the lane choice has
   * to be made at.
   */
  function matTexture(kind, tint, wash) {
    const c = canvas(128, 256);
    const g = c.getContext('2d');
    // A wash under the icons: the road is mid-value, the icons are bright, and
    // without this the edges of the mat vanish into it. The wash is a dark
    // version of the hazard's own hue, not neutral -- at the faded near end a
    // neutral wash read as a dirty grey smear on the tarmac.
    g.fillStyle = wash;
    g.fillRect(0, 0, 128, 256);
    g.fillStyle = tint;
    g.fillRect(0, 0, 8, 256); g.fillRect(120, 0, 8, 256);

    for (let i = 0; i < 3; i++) {
      const cy = 42 + i * 86;
      if (kind === K.JUMP) {
        // Apex points down-canvas, which after the -90deg lay-down points
        // AWAY from the runner: a ramp read, not a "stop" read.
        g.beginPath();
        g.moveTo(64, cy + 30); g.lineTo(108, cy - 28); g.lineTo(20, cy - 28);
        g.closePath(); g.fill();
      } else if (kind === K.DUCK) {
        g.fillRect(20, cy - 30, 88, 15);
        g.fillRect(20, cy - 4, 88, 15);
        g.fillRect(20, cy + 22, 88, 15);
      } else {
        g.lineWidth = 17; g.strokeStyle = tint; g.lineCap = 'butt';
        g.beginPath();
        g.moveTo(24, cy - 30); g.lineTo(104, cy + 30);
        g.moveTo(104, cy - 30); g.lineTo(24, cy + 30);
        g.stroke();
      }
    }
    const t = texture(c, true);
    t.repeat.set(1, 5);
    return t;
  }

  /** Diagonal caution stripes for the face a hazard turns toward the player. */
  function stripeTexture(a, b) {
    const c = canvas(128, 64);
    const g = c.getContext('2d');
    g.fillStyle = a; g.fillRect(0, 0, 128, 64);
    g.fillStyle = b;
    for (let x = -64; x < 160; x += 32) {
      g.beginPath();
      g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 16 + 64, 64); g.lineTo(x + 64, 64);
      g.closePath(); g.fill();
    }
    const t = texture(c, true);
    t.repeat.set(2, 1);
    return t;
  }

  /** Window grid for buildings. Repeat is set per instance so windows keep a
   *  constant world size no matter how the box is scaled. */
  function windowTexture() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    const lit = ['#ffe9a8', '#cfe4ff', '#8fa6cc', '#6f86b4'];
    for (let ry = 0; ry < 2; ry++) {
      for (let rx = 0; rx < 2; rx++) {
        g.fillStyle = lit[(rx * 2 + ry * 3) % lit.length];
        g.fillRect(rx * 32 + 7, ry * 32 + 8, 18, 15);
        g.fillStyle = 'rgba(30,25,60,0.30)';
        g.fillRect(rx * 32 + 7, ry * 32 + 8, 18, 4);
      }
    }
    return texture(c, true);
  }

  /** Pale banded ripples, laid over the water plane on the bridge. */
  function rippleTexture() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = 'rgba(255,255,255,0.30)';
    for (let i = 0; i < 7; i++) {
      const y = 8 + i * 17, w = 24 + ((i * 37) % 60);
      g.fillRect(((i * 53) % 100), y, w, 4);
      g.fillRect(((i * 29) % 90) + 20, y + 7, w * 0.6, 3);
    }
    return texture(c, true);
  }

  /**
   * Faint irregular patchwork for the ground and the verges. A single flat
   * colour over a 1,400-unit plane reads as coloured paper; a few percent of
   * banded variation is enough to give the eye somewhere to land without
   * breaking the cel-shaded flatness.
   */
  function groundTexture() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    const shades = ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.07)', 'rgba(0,0,0,0.025)'];
    let s = 1337;
    const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    for (let i = 0; i < 14; i++) {
      g.fillStyle = shades[Math.floor(r() * shades.length)];
      g.fillRect(r() * 64 - 8, r() * 64 - 8, 10 + r() * 26, 8 + r() * 20);
    }
    return texture(c, true);
  }

  /** Checker band for the finish gantry. */
  function checkerTexture() {
    const c = canvas(128, 32);
    const g = c.getContext('2d');
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = ((x + y) & 1) ? '#1b1633' : '#fffdf5';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const t = texture(c, true);
    t.repeat.set(6, 1);
    return t;
  }

  // ---- geometry merging -------------------------------------------------
  /**
   * Fold a list of transformed primitives into one vertex-coloured geometry.
   *
   * A spectator built from seven boxes as seven meshes costs seven draws and
   * there can be a hundred of them beside the road. Baking colour into the
   * vertices means a whole knot of them, or a bridge tower with its cables,
   * ships as one mesh under one shared material.
   */
  function merge(parts) {
    let n = 0;
    const prepared = [];
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      prepared.push({ g, color: p.color });
      n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let o = 0;
    for (const item of prepared) {
      const g = item.g;
      const count = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      _cA.set(item.color === undefined ? 0xffffff : item.color);
      for (let i = 0; i < count; i++) {
        col[(o + i) * 3] = _cA.r;
        col[(o + i) * 3 + 1] = _cA.g;
        col[(o + i) * 3 + 2] = _cA.b;
      }
      o += count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  const _euler = new THREE.Euler();
  function part(geo, color, x, y, z, rx, ry, rz) {
    const m = new THREE.Matrix4();
    if (rx || ry || rz) m.makeRotationFromEuler(_euler.set(rx || 0, ry || 0, rz || 0));
    m.setPosition(x || 0, y || 0, z || 0);
    return { geo, color, matrix: m };
  }
  function bx(w, h, d, x, y, z, color, rx, ry, rz) {
    return part(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }
  function cyl(rt, rb, h, seg, x, y, z, color, rx, ry, rz) {
    return part(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
  }
  function cone(r, h, seg, x, y, z, color) {
    return part(new THREE.ConeGeometry(r, h, seg), color, x, y, z);
  }
  /** Low-poly blob, for canopies and anything that must not read as a box. */
  function sph(r, seg, x, y, z, color) {
    return part(new THREE.SphereGeometry(r, seg || 7, Math.max(3, (seg || 7) - 2)), color, x, y, z);
  }

  /**
   * bx() for hazard parts. Width and lateral offset follow the lane; height
   * and depth are passed straight through, because those are the numbers
   * MR.Collision.BOX mirrors and this file is not allowed to move them.
   */
  function hbx(w, h, d, x, y, z, color, rx, ry, rz) {
    return bx(w * LANE_FIT, h, d, (x || 0) * LANE_FIT, y, z, color, rx, ry, rz);
  }
  /** Flat quad sized to the lane, for the striped faces hazards turn forward. */
  function hplane(w, h) {
    return new THREE.PlaneGeometry(w * LANE_FIT, h);
  }
  /**
   * A hazard part that keeps its own size and only moves with the lane. For
   * the furniture -- posts, feet, lamps -- which are objects standing at a
   * place rather than spans across it, and which read worse the thinner they
   * get.
   */
  function bxAt(w, h, d, x, y, z, color, rx, ry, rz) {
    return bx(w, h, d, (x || 0) * LANE_FIT, y, z, color, rx, ry, rz);
  }

  /** Vertex-coloured toon material -- the workhorse for merged props. */
  function vtoon(steps) {
    const m = S.toon(0xffffff, steps || 2);
    m.vertexColors = true;
    return m;
  }

  // ---- generic pool -----------------------------------------------------
  function Pool(factory, parent) {
    const free = [];
    const live = [];
    return {
      live,
      claim() {
        const o = free.pop() || factory();
        o.visible = true;
        parent.add(o);
        live.push(o);
        return o;
      },
      release(o) {
        const i = live.indexOf(o);
        if (i >= 0) live.splice(i, 1);
        o.visible = false;
        parent.remove(o);
        free.push(o);
      },
      releaseAll() {
        while (live.length) this.release(live[live.length - 1]);
      },
    };
  }

  /**
   * The racing line: one concrete lane path that survives the whole course.
   *
   * course.js already proves a path EXISTS -- generate() retries a gate until
   * `solvable()` still says yes. This walks the identical state space, keeps
   * the cheapest survivor instead of the first, and hands back the lane to be
   * in at every gate. Identical rules means the line drawn on the road is a
   * line the player can actually hold, not a suggestion that runs into a train
   * two gates later.
   *
   * Cost is lane changes first and actions second, which is the line a runner
   * would pick rather than merely a legal one: hold what you have, move only
   * when the gate makes you, and prefer the lane you can run straight through.
   *
   * It is a property of the course, so it is the same for every player on the
   * same day -- exactly like the course itself.
   */
  function racingLine(gates, startLane, startIdx) {
    if (!gates.length) return null;
    const AW = MR.Course.ACTION_WINDOW;
    const from = startIdx || 0;
    // Same state collapse as Course.solvable: lane, the action still committed
    // to, and whether that action is recent enough to conflict.
    //
    // Seeded from where the player ACTUALLY is, not from a fixed lane 1. A line
    // planned from lane 1 is always survivable, but it will happily ask a
    // player sitting in a clear lane to move for no reason, and a hint you
    // learn to ignore is worse than no hint.
    let states = [{ lane: startLane === undefined ? 1 : startLane, act: K.CLEAR, z: -1e9, cost: 0, prev: null }];

    for (let i = from; i < gates.length; i++) {
      const g = gates[i];
      const next = new Map();
      for (const s of states) {
        for (let l = 0; l < 3; l++) {
          const h = g.lanes[l];
          if (h === K.BLOCK) continue;
          if (h !== K.CLEAR && s.act !== K.CLEAR && h !== s.act && g.z - s.z < AW) continue;
          const act = h === K.CLEAR ? s.act : h;
          const az = h === K.CLEAR ? s.z : g.z;
          const tag = l + ':' + act + ':' + (g.z - az < AW ? 1 : 0);
          // Lane changes dominate; an action is a small tax; and sitting in an
          // outer lane costs a little every gate, so once a hazard has pushed
          // the line wide it drifts back to the middle instead of camping out
          // there. The middle is where a line has an escape on both sides, and
          // a hint that keeps sending the player to the edge of the road for no
          // reason is a hint they stop believing.
          const cost = s.cost + Math.abs(l - s.lane) * 12 + (h === K.CLEAR ? 0 : 1) + (l === 1 ? 0 : 2);
          const cur = next.get(tag);
          if (!cur || cost < cur.cost) next.set(tag, { lane: l, act, z: az, cost, prev: s });
        }
      }
      // Unreachable: generate() would have rejected the gate. Fail soft rather
      // than throw -- a missing line is a missing hint, not a broken race.
      if (!next.size) return null;
      states = Array.from(next.values());
    }

    let best = states[0];
    for (const s of states) if (s.cost < best.cost) best = s;

    // Backtrack only over the range actually solved. The chain is `from` links
    // long, not gates.length, so walking to index 0 dereferences null the
    // moment a replan starts mid-course. Gates already behind the player keep
    // the start lane, which costs nothing -- the ribbon is only drawn ahead.
    const lanes = new Array(gates.length);
    for (let i = gates.length - 1; i >= from; i--) { lanes[i] = best.lane; best = best.prev; }
    for (let i = 0; i < from; i++) lanes[i] = lanes[from] !== undefined ? lanes[from] : 1;
    return lanes;
  }

  /**
   * The stripe the racing line is painted with: soft-edged, with a pulse
   * running along it.
   *
   * Deliberately paint and not floating pickups. Anything hovering in a lane at
   * this camera height has to be read and then ruled out as a hazard, and the
   * entire point of the hint is to reduce what the player has to parse, not to
   * add a fifth thing on the road that looks like the other four.
   */
  let routeTex = null;
  function routeTexture() {
    if (routeTex) return routeTex;
    const c = canvas(32, 128);
    const g = c.getContext('2d');
    const img = g.createImageData(32, 128);
    for (let y = 0; y < 128; y++) {
      // Two pulses per tile and never fully dark: a line that breaks stops
      // reading as a path and starts reading as a row of objects.
      const v = y / 128;
      const flow = 0.54 + 0.46 * Math.pow(0.5 + 0.5 * Math.sin(v * Math.PI * 4 - 1.6), 2.4);
      for (let x = 0; x < 32; x++) {
        // Soft shoulders. A hard-edged stripe aliases into a dotted line at the
        // far end of the run-up, which is the end that has to carry the read.
        const u = Math.abs(x - 15.5) / 15.5;
        const core = Math.max(0, 1 - Math.pow(u, 2.6));
        const i = (y * 32 + x) * 4;
        img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * core * flow);
      }
    }
    g.putImageData(img, 0, 0);
    routeTex = texture(c, true);
    return routeTex;
  }

  /**
   * A ring, for the floating half of the route hint.
   *
   * The hard stroke is under a pixel wide by 90 units, so it carries a much
   * softer halo underneath it -- that is what is actually still visible at the
   * far end of the trail, where the hint has to do its work.
   */
  let ringTex = null;
  function ringTexture() {
    if (ringTex) return ringTex;
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.strokeStyle = '#ffffff';
    g.globalAlpha = 0.34;
    g.lineWidth = 22;
    g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 9;
    g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.stroke();
    ringTex = texture(c);
    return ringTex;
  }

  function create(course) {
    const group = new THREE.Group();
    // v3: the prop lottery lost its rival and station entries, which moves
    // every draw after the first and so re-rolls the whole layout. Naming that
    // is cheaper than wondering later why a day's scenery moved.
    const rnd = MR.rng.stream(course.key, 'scenery/v3');

    // Biome spans in world units, so road tiles and set pieces can ask "where
    // am I" without reconstructing the fraction every time.
    const BI = MR.Course.BIOMES.map((b, i) => ({
      name: b.name,
      from: b.from * K.TOTAL_UNITS,
      to: (i + 1 < MR.Course.BIOMES.length ? MR.Course.BIOMES[i + 1].from : 1) * K.TOTAL_UNITS,
      look: BIOME_LOOK[b.name],
    }));
    function lookAtZ(z) {
      let b = BI[0];
      for (const x of BI) if (z >= x.from) b = x;
      return b;
    }
    const BRIDGE = BI.find((b) => b.name === 'THE BRIDGE');

    // The deck is inset from the biome boundary so the abutments have room to
    // cap the ends; the water sinks over a 190-unit ramp on each side, which
    // is long enough that the ground never visibly pops down.
    const DECK_FROM = BRIDGE.from + 40;
    const DECK_TO = BRIDGE.to - 40;
    const WATER_DROP = 2.3;
    function deckLift(z) {
      if (z < DECK_FROM) return Math.max(0, 1 - (DECK_FROM - z) / 190);
      if (z > DECK_TO) return Math.max(0, 1 - (z - DECK_TO) / 190);
      return 1;
    }

    // Shared materials: recoloured per biome, never reallocated.
    const groundTex = groundTexture();
    groundTex.repeat.set(48, 48);
    const vergeTex = groundTex.clone();
    vergeTex.repeat.set(5, 4);
    vergeTex.needsUpdate = true;
    const roadTex = groundTex.clone();
    roadTex.repeat.set(3, 3);
    roadTex.needsUpdate = true;

    const mats = {
      road: S.toon(P.road, 2),
      shoulder: S.toon(P.ground, 2),
      paint: new THREE.MeshBasicMaterial({ vertexColors: true }),
      prop: vtoon(2),
      propLit: vtoon(3),
      water: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    };

    // ---- sky + fog ------------------------------------------------------
    const sky = S.skyDome(900, P.skyTop, P.skyBot);
    group.add(sky);

    // Ground plane. The pooled shoulders are only 30 units wide, so without
    // this the terrain simply stopped and the sky dome showed through as a
    // hard band across the middle of the frame. It rides with the runner so a
    // finite plane can stand in for an infinite one, and it sits below the
    // road surface so the road always wins the depth test. On the bridge it
    // drops away and becomes the river.
    const groundMat = S.toon(P.ground, 2);
    groundMat.map = groundTex;
    mats.shoulder.map = vergeTex;
    mats.road.map = roadTex;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.34;
    ground.renderOrder = -500;
    group.add(ground);
    mats.ground = groundMat;

    /**
     * A ring of distant hills, riding with the runner like the ground does.
     *
     * They sit at 200 units, just inside the fog's far plane, so they arrive
     * about three-quarters dissolved -- which is exactly the read wanted: a
     * suggestion of land beyond the course rather than scenery you can
     * inspect. The forward 60 degrees is left open so nothing ever appears to
     * stand across the road at the vanishing point.
     */
    const hillsGeo = (function () {
      const parts = [];
      let s = 4242;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2;
        const forward = Math.abs(((a + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (forward < 0.52) continue;                      // keep the road open
        const rad = 190 + r() * 60;
        const h = 12 + r() * 26;
        // Baked shading: the far side of each hill is a band darker, which is
        // all a fully-fogged silhouette needs to stop reading as a flat cutout.
        parts.push(cone(24 + r() * 26, h, 5, Math.sin(a) * rad, h / 2 - 4, Math.cos(a) * rad,
          r() > 0.5 ? 0xd0d0d0 : 0xa8a8a8));
      }
      return merge(parts);
    })();
    const hillsMat = vtoon(2);
    const hills = new THREE.Mesh(hillsGeo, hillsMat);
    hills.renderOrder = -490;
    hills.frustumCulled = false;
    group.add(hills);

    // Ripples ride just above the water surface and are only shown when the
    // ground is acting as a river, so still terrain never shimmers.
    const rippleTex = rippleTexture();
    rippleTex.repeat.set(26, 26);
    const ripples = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({
      map: rippleTex, transparent: true, depthWrite: false,
    }));
    ripples.rotation.x = -Math.PI / 2;
    ripples.renderOrder = -480;
    ripples.visible = false;
    group.add(ripples);

    // ---- road tiles -----------------------------------------------------
    const roadGeo = new THREE.BoxGeometry(K.TRACK_HALF_WIDTH * 2, 0.5, TILE);
    const shoulderGeo = new THREE.BoxGeometry(30, 0.42, TILE);

    // All the road paint in one merged mesh: two solid edge lines and two
    // dashed lane dividers were four draws per tile for four flat quads.
    const paintGeo = (function () {
      const parts = [];
      const flat = -Math.PI / 2;
      // Carriageway edge lines, on the outer lane boundary rather than at the
      // tarmac edge. The shoulder beyond them carries the kerb and the aid
      // tables; painting it as road instead of as shoulder is what made three
      // lanes read as one enormous one.
      for (const sx of [-1, 1]) {
        parts.push(part(new THREE.PlaneGeometry(0.26, TILE), 0xf2f4ff,
          sx * (LANE * 1.5 + 0.13), 0.006, 0, flat));
      }
      // Dividers sit on the lane boundaries, so they move with LANE_W. The
      // stripe itself does not scale -- road paint is road paint whatever the
      // lane is, and a hairline dash stops reading at 60 units.
      for (const lx of [-LANE / 2, LANE / 2]) {
        parts.push(part(new THREE.PlaneGeometry(0.16, TILE * 0.52), 0xfff6d8, lx, 0.006, 0, flat));
      }
      return merge(parts);
    })();

    /** Kerb + pavement: without it the tarmac sits straight on grass. */
    function pavement(parts, sx, top, kerb) {
      const x = sx * (K.TRACK_HALF_WIDTH + 4.0);
      parts.push(bx(8.0, 0.30, TILE, x, -0.16, 0, top));
      parts.push(bx(0.34, 0.34, TILE, sx * (K.TRACK_HALF_WIDTH + 0.17), 0.0, 0, kerb));
    }

    /**
     * Crowd-control barrier: the single strongest "this is a road race" cue.
     * The lamp standards are what give the city legs a vertical rhythm at the
     * distance where individual props have already fogged out.
     */
    const barrierGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 0.85);
        pavement(parts, sx, 0xb9bdd6, 0xe8ecff);
        parts.push(bx(0.10, 0.09, TILE, x, 0.92, 0, 0xf2f4ff));
        parts.push(bx(0.09, 0.07, TILE, x, 0.60, 0, 0xdfe6ff));
        for (let i = 0; i < 8; i++) {
          const z = -TILE / 2 + 1.5 + i * 3;
          parts.push(bx(0.13, 1.0, 0.13, x, 0.5, z, 0x2b2f52));
          // Sponsor-ish colour panel between posts: reads as printed hoarding.
          if (i % 2 === 0) parts.push(bx(0.06, 0.30, 2.6, x - sx * 0.03, 0.74, z + 1.5, 0xff3b6b));
        }
        for (const lz of [-TILE / 4, TILE / 4]) {
          const lx = sx * (K.TRACK_HALF_WIDTH + 2.2);
          parts.push(bx(0.22, 6.4, 0.22, lx, 3.2, lz, 0x2b2f52));
          parts.push(bx(1.9, 0.20, 0.20, lx - sx * 0.85, 6.3, lz, 0x2b2f52));
          parts.push(bx(0.8, 0.26, 0.44, lx - sx * 1.7, 6.1, lz, 0xffe45e));
          parts.push(bx(0.9, 1.1, 0.10, lx, 4.6, lz, sx > 0 ? 0x37d6ff : 0xff9ad5));
        }
      }
      return merge(parts);
    })();

    /** Park/river edge: a clipped hedge, a gravel path and the odd bench. */
    const hedgeGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 1.6);
        pavement(parts, sx, 0xd8c9a0, 0xefe3c2);
        parts.push(bx(1.5, 0.78, TILE, x, 0.28, 0, 0x2f9f52));
        parts.push(bx(1.62, 0.16, TILE, x, 0.68, 0, 0x49c96b));
        for (let i = 0; i < 4; i++) {
          parts.push(cyl(0.10, 0.12, 0.7, 6, sx * (K.TRACK_HALF_WIDTH + 0.4), 0.35,
            -TILE / 2 + 3 + i * 6, 0xfff2e0));
        }
        const bz = sx > 0 ? -4 : 6;
        const bx0 = sx * (K.TRACK_HALF_WIDTH + 5.6);
        parts.push(bx(0.9, 0.14, 2.4, bx0, 0.46, bz, 0x8a5a3c));
        parts.push(bx(0.16, 0.62, 2.4, bx0 + sx * 0.4, 0.72, bz, 0x8a5a3c));
        parts.push(bx(0.2, 0.42, 0.2, bx0, 0.21, bz - 0.9, 0x2b2f52));
        parts.push(bx(0.2, 0.42, 0.2, bx0, 0.21, bz + 0.9, 0x2b2f52));
        // An avenue, planted on the tile so it costs no extra draw. Scattered
        // single trees never made PARKLAND feel like parkland -- a regular
        // line right at the verge does, and it is what a park boulevard is.
        for (let i = 0; i < 2; i++) {
          const tz = -TILE / 2 + 5 + i * 12 + (sx > 0 ? 3 : 0);
          const k = i ? 1.15 : 0.92;
          const tx = sx * (K.TRACK_HALF_WIDTH + 3.4);
          parts.push(cyl(0.20 * k, 0.32 * k, 1.9 * k, 6, tx, 0.95 * k, tz, 0x8a5a3c));
          parts.push(cone(1.55 * k, 2.1 * k, 8, tx, 2.6 * k, tz, 0x2f9f52));
          parts.push(cone(1.20 * k, 1.7 * k, 8, tx, 3.6 * k, tz, 0x3fbf63));
          parts.push(cone(0.82 * k, 1.4 * k, 8, tx, 4.6 * k, tz, 0x59d47a));
        }
      }
      return merge(parts);
    })();

    /**
     * THE WALL: concrete jersey barrier and a graffitied site hoarding. The leg
     * is meant to feel enclosed and joyless, so the roadside closes in rather
     * than opening onto crowd.
     *
     * TWO STOREYS, and the split is the whole design of this piece.
     *
     * The hoarding used to be one unbroken 6.5-unit slab running the full tile
     * at x = 11.35, on both sides, for the entire leg. That did make the road
     * feel like a trench, but it cost more than it bought: LANDMARK_IN is
     * 11.75, so every set piece and every building on this leg stood 0.4 units
     * BEHIND a wall taller than they were wide on screen. The sightline over a
     * 6.5 wall at 11.35 clears y = 6.9 at x = 12.6 and y = 9.6 at x = 20 --
     * so the mile-20 hoardings showed a strip of poster with no legs under it
     * and the skyline showed roofs with no buildings under them. Slivers, not
     * masses, on the one leg that most needs somewhere to look.
     *
     * So the boarding below stays CONTINUOUS and the storey above it goes to a
     * rhythm of bays:
     *
     *   lower  0 -> 3.4, unbroken, both sides, the whole leg. The chase camera
     *          sits at y ~2.7, so this is above eye level: the ground beyond is
     *          never visible and the corridor never actually opens. This is the
     *          part that does the boxing in, and none of it is given up.
     *   upper  3.4 -> 6.5, in 8-unit panels with a 4-unit open scaffold bay
     *          between them, staggered a half-period between the two sides so
     *          the road is never open on both flanks at once.
     *
     * What comes back through the bays is everything from y ~3.5 up: the
     * hoarding legs and the lower two thirds of their boards, the bases of the
     * blocks behind. And the broken top line is worth as much as the gaps --
     * a dead straight edge running to the vanishing point on both sides gave
     * the leg no rhythm at all, and rhythm is what a wall of this length needs
     * to keep reading as oppressive instead of merely as grey.
     */
    const wallGeo = (function () {
      const parts = [];
      // Solid upper bays, as [zFrom, zTo] within the tile. The two arrays are
      // the same pattern a half-period apart, and each tiles seamlessly with
      // its own repeat: the gap that ends at +12 is continued by the gap that
      // starts the next tile at -12.
      const BAYS = [
        [[-TILE / 2, -4], [0, 8]],           // sx = -1
        [[-8, 0], [4, TILE / 2]],            // sx = +1
      ];
      // Centres of the 4-unit openings left between them, in tile coordinates.
      const GAPS = [[-2, 10], [-10, 2]];
      for (const sx of [-1, 1]) {
        pavement(parts, sx, 0x8c8a96, 0xb0aeba);
        const x = sx * (K.TRACK_HALF_WIDTH + 0.9);
        parts.push(bx(1.0, 0.55, TILE, x, 0.27, 0, 0xc8c4cc));
        parts.push(bx(0.62, 0.55, TILE, x, 0.80, 0, 0xdedae2));
        parts.push(bx(0.70, 0.12, TILE, x, 1.10, 0, 0xffb020));

        const wx = sx * (K.TRACK_HALF_WIDTH + 7.6);
        // Lower boarding, plus the string course that reads as the joint
        // between the boarding and the scaffold standing on it.
        parts.push(bx(0.7, 3.4, TILE, wx, 1.70, 0, 0x5f5866));
        parts.push(bx(0.86, 0.22, TILE, wx, 3.51, 0, 0x453f4e));

        const bays = BAYS[sx > 0 ? 1 : 0];
        for (const [z0, z1] of bays) {
          const len = z1 - z0, cz = (z0 + z1) / 2;
          parts.push(bx(0.7, 2.85, len, wx, 5.05, cz, 0x5f5866));
          parts.push(bx(0.9, 0.4, len + 0.5, wx, 6.30, cz, 0x453f4e));
          // Fly-posted panels: the only colour on this leg, and deliberately
          // grim. One high on the panel, one on the boarding under it, so the
          // colour is spread over both storeys instead of banding.
          const tags = [0x7a1030, 0x2b6e6a, 0x6a4f8a, 0x8a6a1f];
          const t0 = (sx > 0 ? 1 : 0) + (z0 < 0 ? 0 : 2);
          parts.push(bx(0.12, 1.9, len * 0.55, wx - sx * 0.4, 5.1, cz - len * 0.12,
            tags[t0 % 4]));
          parts.push(bx(0.12, 2.2, len * 0.42, wx - sx * 0.4, 1.7, cz + len * 0.22,
            tags[(t0 + 1) % 4]));
        }
        // The open bays are not empty: scaffold standards at each panel end and
        // a lift rail across, so the line of the hoarding is still drawn at
        // full height and the gap reads as unfinished works rather than as a
        // hole somebody forgot to fill.
        for (const [z0, z1] of bays) {
          for (const pz of [z0, z1]) {
            parts.push(bx(0.30, 3.1, 0.30, wx, 5.05, pz, 0x3d3846));
          }
        }
        for (const gz of GAPS[sx > 0 ? 1 : 0]) {
          parts.push(bx(0.22, 0.22, 4.4, wx, 6.15, gz, 0x3d3846));
          parts.push(bx(0.22, 0.22, 4.4, wx, 4.55, gz, 0x3d3846));
        }
      }
      return merge(parts);
    })();

    /** Bridge deck edge: fascia, balusters, top rail, lamp standards. */
    const railGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * (K.TRACK_HALF_WIDTH + 0.55);
        parts.push(bx(1.3, 0.55, TILE, sx * (K.TRACK_HALF_WIDTH + 0.35), -0.45, 0, 0x3a4570));
        parts.push(bx(0.16, 0.16, TILE, x, 1.30, 0, 0xf2f4ff));
        parts.push(bx(0.12, 0.10, TILE, x, 0.78, 0, 0xc9d4ff));
        for (let i = 0; i < 12; i++) {
          parts.push(bx(0.09, 1.3, 0.09, x, 0.65, -TILE / 2 + 1 + i * 2, 0xdfe6ff));
        }
        for (let i = 0; i < 2; i++) {
          const z = -TILE / 2 + 6 + i * 12;
          parts.push(bx(0.16, 3.4, 0.16, x, 1.7, z, 0x2b2f52));
          parts.push(bx(0.5, 0.24, 0.5, x, 3.5, z, 0xffe45e));
        }
      }
      return merge(parts);
    })();

    const roadPool = Pool(function () {
      const t = new THREE.Group();
      const road = new THREE.Mesh(roadGeo, mats.road);
      road.position.y = -0.25;
      t.add(road);

      const shoulders = [];
      for (const sx of [-1, 1]) {
        const sh = new THREE.Mesh(shoulderGeo, mats.shoulder);
        sh.position.set(sx * (K.TRACK_HALF_WIDTH + 15), -0.30, 0);
        t.add(sh);
        shoulders.push(sh);
      }
      const paint = new THREE.Mesh(paintGeo, mats.paint);
      t.add(paint);

      // One of these is shown at a time; keeping all three built means a
      // biome change is a visibility flip rather than a rebuild.
      const edges = {
        barrier: S.outlined(barrierGeo, mats.prop, S.INK.prop),
        hedge: S.outlined(hedgeGeo, mats.prop, S.INK.prop),
        rail: S.outlined(railGeo, mats.prop, S.INK.prop),
        wall: S.outlined(wallGeo, mats.prop, S.INK.prop),
      };
      for (const k in edges) { edges[k].visible = false; t.add(edges[k]); }
      t.userData.shoulders = shoulders;
      t.userData.edges = edges;
      return t;
    }, group);

    // ---- the racing line ------------------------------------------------
    /**
     * A blue line, painted on the road, showing the lane the next few gates
     * have to be taken in.
     *
     * The whole mechanic here is holding one unbroken clean line, and until now
     * the game gave the player no forward read of where that line was: every
     * gate was solved on its own, on sight, with no way to see that the lane
     * you are about to take is the one that runs into a train two gates later.
     * Both reference runners telegraph the route several gates out with a coin
     * or ring trail. A marathon already has the perfect version of that idea --
     * real courses paint the measured shortest route on the tarmac -- so this
     * is a borrow that costs the game nothing in tone.
     *
     * Cost is one draw call, and a second for the rings below. Each is a single
     * mesh whose vertices are rewritten in place every frame as the route
     * scrolls past, so neither allocates and neither grows with the length of
     * the course.
     *
     * It hints the LANE and nothing else: which action a gate wants, and when
     * to commit to it, are still entirely the player's read.
     */
    const ROUTE_NEAR = 5;      // starts clear of the runner's own feet
    const ROUTE_FAR = 124;     // three to five gates -- as far as the fog allows
    const ROUTE_SEGS = 44;
    const ROUTE_W = 0.17;      // half-width
    const ROUTE_UV = 1 / 14;   // one texture tile per 14 units of road

    // Replanned whenever the player changes lane; the solve is ~174 gates x 3
    // states, far too cheap to be worth caching harder than this.
    let routeLane = racingLine(course.gates, 1, 0);
    let routePlannedLane = 1;
    const routeGeo = new THREE.BufferGeometry();
    const routePos = new Float32Array(ROUTE_SEGS * 6 * 3);
    const routeUvs = new Float32Array(ROUTE_SEGS * 6 * 2);
    routeGeo.setAttribute('position', new THREE.BufferAttribute(routePos, 3));
    routeGeo.setAttribute('uv', new THREE.BufferAttribute(routeUvs, 2));
    const routeMesh = new THREE.Mesh(routeGeo, new THREE.MeshBasicMaterial({
      map: routeTexture(),
      color: 0x5ff0a6,          // the one hue no hazard owns; amber, cyan and
      transparent: true,        // red are all spoken for, and green reads "go"
      // Held under the rings: the paint is the connective tissue, the rings are
      // what the eye is meant to land on. At full strength the line reads as a
      // beam being fired down the road rather than as a marking on it.
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,   // the ribbon is rebuilt every frame; not
    }));                        // depending on winding is one less way to fail
    // Below the hazard telegraph mats (5) and the finish checker (4): where the
    // line runs across a gate's own mat, the hazard has to win.
    routeMesh.renderOrder = 3;
    routeMesh.frustumCulled = false;   // its bounds change every frame
    routeMesh.visible = !!routeLane;
    group.add(routeMesh);

    /**
     * The floating half of the hint: a trail of rings riding the same line.
     *
     * Paint alone cannot do this job. The chase camera sits low and directly
     * behind, so the runner's own body covers the centre of the road from about
     * 35 units out all the way to the horizon -- a line painted in the lane the
     * player is already in is invisible exactly where the forward read has to
     * happen. Rings sit high enough off the tarmac to clear the head in frame,
     * which is the same answer both reference games arrived at.
     *
     * A ring is a hollow circle and nothing else in this game is round, so it
     * cannot be mistaken for a fifth kind of obstacle. It marks the LANE only:
     * which action a gate wants, and when to commit, are still the player's.
     *
     * Evenly spaced along the line and anchored to a world grid rather than
     * hung off the gates: a trail has to be a trail. Gate spacing runs 46 units
     * early and 24 late, so per-gate clusters would have left the opening miles
     * with three rings and a long nothing, which reads as a row of separate
     * markers rather than a path.
     */
    const RING_SPACE = 11;
    const RING_FROM = 10;
    // Two slots more than the fade can reach, so the far end of the trail is
    // always already at zero when the world grid shifts a new ring into it.
    // Sized to the window rather than to the fade and a ring would wink into
    // existence at a third opacity, 120 units out, every few seconds.
    const RING_N = 14;
    const RING_FADE = 122;
    // 1.30 is the one height that works: above a JUMP kerb (0.80) and clear
    // below a DUCK bar (1.41), so a ring never floats at bar height where it
    // would read as "through here". The radius is chosen the same way -- 0.36
    // is 42% of a lane, big enough to survive the fog and small enough that the
    // trail never looks like something in the way.
    const RING_Y = 1.30;
    const RING_R = 0.36;

    const ringGeo = new THREE.BufferGeometry();
    const ringPos = new Float32Array(RING_N * 6 * 3);
    const ringUvs = new Float32Array(RING_N * 6 * 2);
    const ringCol = new Float32Array(RING_N * 6 * 4);
    for (let i = 0; i < RING_N; i++) {
      // UVs and RGB never change; only the corners and the alpha do.
      const u = i * 12, c = i * 24;
      const uvq = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
      for (let k = 0; k < 12; k++) ringUvs[u + k] = uvq[k];
      for (let k = 0; k < 6; k++) { ringCol[c + k * 4] = 1; ringCol[c + k * 4 + 1] = 1; ringCol[c + k * 4 + 2] = 1; }
    }
    ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
    ringGeo.setAttribute('uv', new THREE.BufferAttribute(ringUvs, 2));
    ringGeo.setAttribute('color', new THREE.BufferAttribute(ringCol, 4));
    const ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      map: ringTexture(), color: 0x5ff0a6, transparent: true, depthWrite: false,
      vertexColors: true, side: THREE.DoubleSide,
      // The only thing in the scene exempt from aerial perspective. Its job is
      // to be legible at 100 units, which is exactly where the fog is taking
      // half the contrast out of everything else; the trail carries its own
      // distance cue in the alpha ramp below instead.
      fog: false,
    }));
    ringMesh.renderOrder = 6;   // over the telegraph mats, never under them
    ringMesh.frustumCulled = false;
    // The floating ring trail is deliberately NOT added to the scene.
    //
    // Playtest verdict: a constant line of markers hovering at head height for
    // 26 miles reads as something you are obliged to collect, and it sat in the
    // one part of the frame the player is trying to read hazards through. The
    // painted racing ribbon on the road carries the same information without
    // occupying the air. The geometry is kept so a future pass can bring it
    // back as an occasional beacon (say, only where the line must change lane)
    // rather than as a continuous chain.
    ringMesh.visible = false;

    // Sampling walks z forwards, so the gate lookup is a cursor rather than a
    // search. It rewinds at the start of each frame and costs nothing after.
    let routeCursor = 0;
    function routeX(zz) {
      const gates = course.gates;
      while (routeCursor > 0 && gates[routeCursor - 1].z >= zz) routeCursor--;
      while (routeCursor < gates.length && gates[routeCursor].z < zz) routeCursor++;
      const i = routeCursor;
      if (i >= gates.length) return K.LANE_X[routeLane[gates.length - 1]];
      const to = K.LANE_X[routeLane[i]];
      const from = i > 0 ? K.LANE_X[routeLane[i - 1]] : to;
      const gz = gates[i].z;
      const pz = i > 0 ? gates[i - 1].z : gz - 40;
      // Cross over into the new lane before the gate, never across it: by the
      // gate line the paint is already where the player has to be.
      const cross = Math.min(18, Math.max(8, (gz - pz) * 0.55));
      const t = Math.max(0, Math.min(1, (zz - (gz - cross)) / cross));
      return from + (to - from) * t * t * (3 - 2 * t);
    }

    function updateRoute(z, now) {
      if (!routeLane) return;
      const step = (ROUTE_FAR - ROUTE_NEAR) / ROUTE_SEGS;
      let z0 = z + ROUTE_NEAR;
      let x0 = routeX(z0);
      for (let i = 0; i < ROUTE_SEGS; i++) {
        const z1 = z + ROUTE_NEAR + (i + 1) * step;
        const x1 = routeX(z1);
        // Taper away with distance, so the far end thins into the fog rather
        // than stopping on a cut edge in the middle of the road.
        const w0 = ROUTE_W * (1 - 0.5 * (i / ROUTE_SEGS));
        const w1 = ROUTE_W * (1 - 0.5 * ((i + 1) / ROUTE_SEGS));
        const v0 = z0 * ROUTE_UV, v1 = z1 * ROUTE_UV;
        const p = i * 18, u = i * 12;
        // l0, r1, r0 -- then l0, l1, r1.
        routePos[p] = x0 - w0; routePos[p + 1] = 0.010; routePos[p + 2] = z0;
        routePos[p + 3] = x1 + w1; routePos[p + 4] = 0.010; routePos[p + 5] = z1;
        routePos[p + 6] = x0 + w0; routePos[p + 7] = 0.010; routePos[p + 8] = z0;
        routePos[p + 9] = x0 - w0; routePos[p + 10] = 0.010; routePos[p + 11] = z0;
        routePos[p + 12] = x1 - w1; routePos[p + 13] = 0.010; routePos[p + 14] = z1;
        routePos[p + 15] = x1 + w1; routePos[p + 16] = 0.010; routePos[p + 17] = z1;
        routeUvs[u] = 0; routeUvs[u + 1] = v0;
        routeUvs[u + 2] = 1; routeUvs[u + 3] = v1;
        routeUvs[u + 4] = 1; routeUvs[u + 5] = v0;
        routeUvs[u + 6] = 0; routeUvs[u + 7] = v0;
        routeUvs[u + 8] = 0; routeUvs[u + 9] = v1;
        routeUvs[u + 10] = 1; routeUvs[u + 11] = v1;
        z0 = z1; x0 = x1;
      }
      routeGeo.attributes.position.needsUpdate = true;
      routeGeo.attributes.uv.needsUpdate = true;
      // The pulse runs forward, away from the runner, so the line leads the eye
      // down the course instead of washing back over it.
      routeTexture().offset.y = -(now * 0.45) % 1;

      // ---- rings -------------------------------------------------------
      // Anchored to a world grid, so a ring holds still on the road and slides
      // toward the runner instead of the whole trail crawling forward with the
      // camera. New ones therefore only ever appear at the far end, where the
      // alpha ramp has already faded them to nothing.
      let cz = Math.ceil((z + RING_FROM) / RING_SPACE) * RING_SPACE;
      for (let n = 0; n < RING_N; n++, cz += RING_SPACE) {
        const p = n * 18, c = n * 24;
        // Alpha falls away down the trail, so the eye is pulled to the next
        // gate first and the far end stays a suggestion, not a second read.
        const a = 0.95 * Math.max(0, 1 - Math.pow(Math.min(1, (cz - z) / RING_FADE), 2.2));
        if (a <= 0.01) { for (let v = 0; v < 18; v++) ringPos[p + v] = 0; continue; }
        const cx = routeX(cz);
        const cy = RING_Y + Math.sin(now * 1.9 + n * 1.1) * 0.045;
        routeQuad(ringPos, p, cx - RING_R, cy - RING_R, cx + RING_R, cy + RING_R, cz);
        for (let v = 0; v < 6; v++) ringCol[c + v * 4 + 3] = a;
      }
      ringGeo.attributes.position.needsUpdate = true;
      ringGeo.attributes.color.needsUpdate = true;
    }

    /** Two triangles of an axis-aligned quad in the XY plane at depth `zz`. */
    function routeQuad(arr, p, l, b, r, t, zz) {
      arr[p] = l; arr[p + 1] = b; arr[p + 2] = zz;
      arr[p + 3] = r; arr[p + 4] = b; arr[p + 5] = zz;
      arr[p + 6] = r; arr[p + 7] = t; arr[p + 8] = zz;
      arr[p + 9] = l; arr[p + 10] = b; arr[p + 11] = zz;
      arr[p + 12] = r; arr[p + 13] = t; arr[p + 14] = zz;
      arr[p + 15] = l; arr[p + 16] = t; arr[p + 17] = zz;
    }

    // ---- hazards --------------------------------------------------------
    // Visual extents are pinned to MR.Collision.BOX: JUMP tops out at 0.80,
    // the DUCK bar spans 1.41-1.83, BLOCK is 2.80 tall and 1.30 deep. Anything
    // added for readability lives outside the runner's corridor or above the
    // top of a full jump (2.05 + 1.78 = 3.83), so nothing here can make the
    // player clip something they legitimately cleared.

    const stripeTex = {
      jump: stripeTexture('#ffb020', '#2b2f52'),
      duck: stripeTexture('#37d6ff', '#0d2b36'),
      block: stripeTexture('#ff3b6b', '#fff2e0'),
    };
    const faceMat = {
      jump: new THREE.MeshBasicMaterial({ map: stripeTex.jump }),
      duck: new THREE.MeshBasicMaterial({ map: stripeTex.duck }),
      block: new THREE.MeshBasicMaterial({ map: stripeTex.block }),
    };

    // Lane telegraph mats. Transparent, unlit, and laid a hair above the road
    // paint so they never z-fight with the lane dashes.
    /**
     * The telegraph mat: 14 units of run-up, because the lane choice has to be
     * made 3-4 gate-lengths out, not 1.
     *
     * The end nearest the player fades to nothing through a per-vertex alpha
     * ramp. Without it the mat is informative at 60 units and then swells into
     * a screen-filling slab of saturated colour in the last quarter-second,
     * which is precisely when the player needs to see the hazard instead.
     */
    const matGeo = (function () {
      const g = new THREE.PlaneGeometry(1.95 * LANE_FIT, 16, 1, 16);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        // Local +Y lays down toward -Z, i.e. toward the approaching runner, so
        // the ramp runs over most of the mat's length and only the last few
        // units before the hazard reach full strength.
        const t = Math.max(0, Math.min(1, (8.0 - pos.getY(i)) / 11.0));
        const a = Math.pow(t, 1.5);
        col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = a;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 4));
      return g;
    })();
    const matMat = {};
    matMat[K.JUMP] = new THREE.MeshBasicMaterial({ map: matTexture(K.JUMP, '#ffc23a', 'rgba(58,34,0,0.40)'), transparent: true, depthWrite: false, vertexColors: true });
    matMat[K.DUCK] = new THREE.MeshBasicMaterial({ map: matTexture(K.DUCK, '#4fdcff', 'rgba(0,36,54,0.40)'), transparent: true, depthWrite: false, vertexColors: true });
    matMat[K.BLOCK] = new THREE.MeshBasicMaterial({ map: matTexture(K.BLOCK, '#ff4f78', 'rgba(62,0,22,0.44)'), transparent: true, depthWrite: false, vertexColors: true });

    function telegraph(kind) {
      const m = new THREE.Mesh(matGeo, matMat[kind]);
      m.rotation.x = -Math.PI / 2;
      // Runs a little past the gate line so the paint shows through the open
      // gap under a DUCK bar -- colour at the exact spot of the hazard.
      m.position.set(0, 0.012, -7.2);
      m.renderOrder = 5;
      return m;
    }

    // JUMP: a wide amber kerb with a cream cap. The cap is what survives the
    // fog -- a light band on a dark road at 100 units is still a light band.
    // Nothing here rises past 0.80 or reaches past halfZ 0.52.
    const jumpGeo = merge([
      hbx(2.24, 0.66, 1.04, 0, 0.33, 0, 0xffb020),
      hbx(2.34, 0.14, 1.04, 0, 0.73, 0, 0xfff2e0),
      hbx(0.30, 0.80, 1.04, -1.16, 0.40, 0, 0xe07f12),
      hbx(0.30, 0.80, 1.04, 1.16, 0.40, 0, 0xe07f12),
    ]);

    const jumpPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(jumpGeo, mats.propLit, S.INK.hazard));
      const face = new THREE.Mesh(hplane(2.2, 0.62), faceMat.jump);
      face.position.set(0, 0.36, -0.531);
      face.rotation.y = Math.PI;
      g.add(face);
      g.add(telegraph(K.JUMP));
      return g;
    }, group);

    /**
     * DUCK: the bar is only 0.42 tall, which is nothing at distance, so the
     * height comes from tall cyan standards rather than from anything spanning
     * the lane.
     *
     * That distinction is not cosmetic. The chase camera trails 5.1 units and
     * carries 42% of the jump arc, so it sweeps y = 1.76 to 3.14 right through
     * a gate's lane. An earlier version had a header board at 2.44 and the
     * camera flew straight into it -- one frame of full-screen cyan stripes.
     * Above the bar only thin members are allowed, so the worst a clip can
     * ever be is a sliver of post.
     */
    const duckGeo = merge([
      hbx(2.30, 0.30, 0.60, 0, 1.56, 0, 0x37d6ff),
      hbx(2.36, 0.12, 0.62, 0, 1.77, 0, 0xd8f8ff),
      // The standards keep their own thickness -- only where they stand moves.
      // Scaling a 0.26 post down with the lane would have left the tall cyan
      // verticals, which are the whole distance read on a DUCK, as hairlines.
      bxAt(0.26, 3.30, 0.30, -1.20, 1.65, 0, 0x37d6ff),
      bxAt(0.26, 3.30, 0.30, 1.20, 1.65, 0, 0x37d6ff),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.35, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.35, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, -1.20, 2.90, 0, 0x0d2b36),
      bxAt(0.30, 0.26, 0.34, 1.20, 2.90, 0, 0x0d2b36),
      bxAt(0.40, 0.22, 0.40, -1.20, 3.41, 0, 0xd8f8ff),
      bxAt(0.40, 0.22, 0.40, 1.20, 3.41, 0, 0xd8f8ff),
      bxAt(0.50, 0.22, 0.50, -1.20, 0.11, 0, 0x2b2f52),
      bxAt(0.50, 0.22, 0.50, 1.20, 0.11, 0, 0x2b2f52),
    ]);

    const duckPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(duckGeo, mats.propLit, S.INK.hazard));
      const face = new THREE.Mesh(hplane(2.26, 0.40), faceMat.duck);
      face.position.set(0, 1.62, -0.302);
      face.rotation.y = Math.PI;
      g.add(face);
      g.add(telegraph(K.DUCK));
      return g;
    }, group);

    // BLOCK: a barricaded works truck. Trains scale it along z, so every baked
    // feature is either a horizontal band or sits at the front face, which the
    // scale leaves in place.
    const blockGeo = merge([
      hbx(2.10, 2.30, 1.30, 0, 1.50, 0, 0xff3b6b),
      hbx(2.20, 0.44, 1.30, 0, 0.22, 0, 0x2b2f52),
      hbx(2.24, 0.26, 1.34, 0, 2.24, 0, 0xfff2e0),
      hbx(2.20, 0.20, 1.34, 0, 2.70, 0, 0xd42a55),
      bxAt(0.34, 0.34, 0.34, -0.72, 2.92, 0, 0xffe45e),
      bxAt(0.34, 0.34, 0.34, 0.72, 2.92, 0, 0xffe45e),
    ]);

    const blockPool = Pool(function () {
      const g = new THREE.Group();
      const body = S.outlined(blockGeo, mats.propLit, S.INK.hazard);
      g.add(body);
      const face = new THREE.Mesh(hplane(2.06, 1.9), faceMat.block);
      face.position.set(0, 1.42, -0.661);
      face.rotation.y = Math.PI;
      g.add(face);
      const tel = telegraph(K.BLOCK);
      g.add(tel);
      g.userData.body = body;
      return g;
    }, group);

    // ---- scenery --------------------------------------------------------

    const winTex = windowTexture();
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    const buildingPool = Pool(function () {
      const g = new THREE.Group();
      // Each building owns its texture so `repeat` can hold the window size
      // constant while the box is scaled to any height -- one shared texture
      // would smear a 30-unit tower's windows into stripes.
      const tex = winTex.clone();
      tex.needsUpdate = true;
      const mat = S.toon(0xffffff, 2);
      mat.map = tex;
      const body = new THREE.Mesh(unitBox, mat);
      const line = new THREE.Mesh(unitBox, S.outlineMaterial(S.INK.scenery));
      line.renderOrder = -1;
      const capMat = S.toon(0xffffff, 2);
      const parapet = S.outlined(unitBox, capMat, S.INK.banner);
      g.add(line, body, parapet);
      g.userData.body = body;
      g.userData.line = line;
      g.userData.tex = tex;
      g.userData.mat = mat;
      g.userData.capMat = capMat;
      g.userData.parapet = parapet;
      return g;
    }, group);

    // Trees: three stacked cones and a trunk in one mesh.
    const treeGeo = merge([
      cyl(0.17, 0.26, 1.3, 6, 0, 0.65, 0, 0x8a5a3c),
      cone(1.30, 1.7, 8, 0, 2.0, 0, 0x35a855),
      cone(1.05, 1.5, 8, 0, 2.9, 0, 0x3fbf63),
      cone(0.75, 1.2, 8, 0, 3.7, 0, 0x59d47a),
    ]);
    const treePool = Pool(function () {
      const g = S.outlined(treeGeo, mats.prop, S.INK.prop);
      return g;
    }, group);

    /**
     * A grove: five trees and undergrowth in one mesh. Single trees at the
     * density the seeded stream can afford left PARKLAND reading as a mown
     * field; a clump costs the same draw and fills the middle distance.
     */
    function groveGeo(seed) {
      const parts = [];
      let s = seed;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const greens = [0x2f9f52, 0x35a855, 0x3fbf63, 0x59d47a, 0x2b8f6a];
      for (let i = 0; i < 5; i++) {
        const x = -5 + r() * 10, z = -6 + r() * 12;
        const k = 0.75 + r() * 0.85;
        const g0 = greens[Math.floor(r() * greens.length)];
        parts.push(cyl(0.17 * k, 0.28 * k, 1.4 * k, 6, x, 0.7 * k, z, 0x8a5a3c));
        parts.push(cone(1.45 * k, 1.9 * k, 8, x, 2.1 * k, z, g0));
        parts.push(cone(1.15 * k, 1.6 * k, 8, x, 3.0 * k, z, g0));
        parts.push(cone(0.80 * k, 1.3 * k, 8, x, 3.9 * k, z, 0x59d47a));
      }
      for (let i = 0; i < 6; i++) {
        parts.push(cone(0.8 + r() * 0.5, 1.0 + r() * 0.6, 6, -6 + r() * 12, 0.4, -7 + r() * 14,
          greens[Math.floor(r() * greens.length)]));
      }
      return merge(parts);
    }
    const groveGeos = [groveGeo(5), groveGeo(29), groveGeo(97)];
    const grovePool = groveGeos.map((geo) => Pool(function () {
      return S.outlined(geo, mats.prop, S.INK.prop);
    }, group));

    /**
     * A knot of spectators, merged. Individual capsules read as pills and cost
     * a draw each; eight little figures with legs, raised arms and different
     * shirts cost the same one draw and read as a crowd.
     */
    function crowdGeo(seed) {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xfff2e0, 0xffb020, 0x9a7bff];
      const skins = [0xffc79a, 0xe0a173, 0xb87a4e, 0x8a5a3c];
      let s = seed * 9301 + 49297;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      const signs = [0xffe45e, 0xfffdf5, 0x37d6ff, 0xff9ad5];
      for (let i = 0; i < 9; i++) {
        const x = -1.5 + (i % 3) * 1.15 + r() * 0.35;
        const z = -2.6 + Math.floor(i / 3) * 2.4 + r() * 0.9;
        const h = 1.02 + r() * 0.26;
        const shirt = shirts[Math.floor(r() * shirts.length)];
        const skin = skins[Math.floor(r() * skins.length)];
        parts.push(bx(0.32, 0.60 * h, 0.24, x, 0.30 * h, z, 0x2b2f52));
        parts.push(bx(0.46, 0.62 * h, 0.32, x, 0.92 * h, z, shirt));
        parts.push(bx(0.28, 0.28, 0.26, x, 1.38 * h, z, skin));
        parts.push(bx(0.30, 0.10, 0.28, x, 1.52 * h, z, 0x3a2b46));
        // Arms up, or holding a placard -- a still crowd looks dead, and the
        // placards are what read as "spectators" at the distance the figures
        // themselves have collapsed to two pixels.
        if (i % 3 === 0) {
          parts.push(bx(0.12, 0.56, 0.12, x - 0.30, 1.22 * h, z, skin, 0, 0, 0.32));
          parts.push(bx(0.12, 0.56, 0.12, x + 0.30, 1.22 * h, z, skin, 0, 0, -0.32));
        } else if (i % 4 === 1) {
          parts.push(bx(0.12, 0.70, 0.12, x + 0.26, 1.35 * h, z, skin));
          parts.push(bx(0.10, 0.9, 0.10, x + 0.26, 1.9 * h, z, 0x8a5a3c));
          parts.push(bx(0.86, 0.62, 0.08, x + 0.26, 2.45 * h, z, signs[Math.floor(r() * signs.length)]));
        } else {
          parts.push(bx(0.12, 0.46, 0.12, x - 0.28, 0.92 * h, z, shirt));
          parts.push(bx(0.12, 0.46, 0.12, x + 0.28, 0.92 * h, z, shirt));
        }
      }
      return merge(parts);
    }
    const crowdGeos = [crowdGeo(3), crowdGeo(17), crowdGeo(41), crowdGeo(88)];
    const crowdPool = crowdGeos.map((geo) => Pool(function () {
      return S.outlined(geo, mats.prop, S.INK.prop);
    }, group));

    // Rival runners used to live here, on the shoulder, drifting forward and
    // yielding as the player came past. They are gone, and not only because the
    // playtester called them unnecessary.
    //
    // This game's entire skill is parsing objects on the play surface: three
    // lanes, one contact, no second chance. Putting non-interactive human
    // figures on that surface teaches exactly the wrong reflex -- that some of
    // the traffic on the road can be ignored -- and the frames prove the cost:
    // a yielding rival at the closest approach filled a third of the frame
    // beside the runner at the moment the next gate had to be read. The record
    // ghost is the only figure allowed on the road, because it is the only one
    // that means something.
    //
    // The geometry is not kept. A future pass that wants a field of runners
    // wants them OFF the course -- a start-line pack behind the barriers -- and
    // that is a single merged static knot in the shape of crowdGeo below, not a
    // pool of individually animated movers. See git history for the old code.
    //
    // Removing them also freed the shoulder, which is what the oversized
    // landmarks further down now stand on.

    // ---- aid -------------------------------------------------------------
    /**
     * Water and fruit: the only things on the road that are good to hit.
     *
     * Everything about them is built to be the OPPOSITE of a hazard, because
     * the player loses the race by misreading road objects and aid is supposed
     * to be the merciful option:
     *
     *   HAZARD                          AID
     *   fills its lane                  small, a fifth of a lane wide
     *   sits on the road, or overhead   hovers at hip height, between the two
     *   saturated amber/cyan/pink       white and mint, the "go" family
     *   hard-edged icon mat, 14 units   a soft pale pool of light, 1 unit
     *   dead still                      turning
     *
     * The turn is doing more work than it looks like. Nothing else in this
     * world rotates -- hazards, props and scenery are all rigidly static -- so
     * a slowly spinning object is unambiguous at any distance, and it is the
     * genre's universal "pick me up" besides.
     *
     * Collection is lane-match only, with no vertical test and no action (see
     * player.js), so nothing here is allowed to imply otherwise: the item never
     * rises above 1.2, never spans the lane, and the pool of light beneath it
     * says that being in the lane is the whole requirement.
     */
    const AID_Y = 0.95;   // hip height: not the ground (jump), not overhead (duck)
    const AID_POP_TIME = 0.42;
    // Released much sooner than BEHIND, because an uncollected bottle sitting
    // in the next lane back is only clutter -- and the pop needs the slot.
    const AID_BEHIND = 14;
    const aidItems = course.aid || [];

    /**
     * The pool of light under an item, as GEOMETRY rather than as a soft
     * transparent sprite. A glow sprite is the obvious way to draw this and it
     * is the wrong one here: large transparent surfaces are the single most
     * expensive thing this renderer does. Two flat opaque discs of a pale mint
     * cost nothing and read the same at the distance that matters.
     *
     * Both discs are rotationally symmetric on purpose -- the whole item is one
     * mesh and one draw, so the spin below turns the pickup while leaving the
     * pool looking planted on the road.
     */
    function aidPool(r) {
      return [
        cyl(r, r, 0.04, 14, 0, 0.03, 0, 0x86eec0),
        cyl(r * 0.58, r * 0.58, 0.04, 14, 0, 0.06, 0, 0xf0fff8),
      ];
    }

    /**
     * A BOTTLE, and it has to actually look like one. Aid arrives alone now --
     * one item per point, roughly fourteen in a whole marathon -- so each one
     * gets the frame to itself for a second and has to say what it is on its
     * own. The old chunky box did not: it read as "small pale cube", which is
     * a shape this game otherwise only uses for things you must not touch.
     *
     * The identity is entirely in the SILHOUETTE, because at the 20-40 units
     * where the lane is chosen the whole item is about twenty pixels across and
     * nothing else survives. So: a wide base, a shoulder that steps in, a
     * distinctly narrow neck, and a cap wider than the neck in a contrasting
     * mint. Four steps is what turns a rectangle into a bottle; three is a
     * bottle with the cap missing.
     *
     * Still square in section rather than turned, and that is not laziness: a
     * body of revolution is its own axis of rotation, so the spin -- the one
     * signal in this world that says "pickup, not obstacle" -- would be
     * invisible on it. A 0.34 x 0.26 section swings visibly.
     */
    const waterGeo = merge(aidPool(0.54).concat([
      bx(0.34, 0.42, 0.26, 0, 0.85, 0, 0xf6fffb),   // body, 0.64 -> 1.06
      bx(0.36, 0.14, 0.28, 0, 0.82, 0, 0x2fd39a),   // label band
      bx(0.24, 0.12, 0.19, 0, 1.12, 0, 0xf6fffb),   // shoulder
      bx(0.14, 0.10, 0.12, 0, 1.23, 0, 0xf6fffb),   // neck
      bx(0.20, 0.13, 0.17, 0, 1.345, 0, 0x2fd39a),  // cap, proud of the neck
    ]));

    /**
     * A BANANA, and the curve is the whole identity -- a yellow box is a
     * yellow box. It is built as a real circular arc: five short segments laid
     * on a radius 0.42 circle over +/-1.0 radians, each turned to the tangent
     * at its own station, fat in the middle and tapering to the ends the way
     * the fruit does. Five is the fewest that reads as a curve rather than as a
     * chevron at the distance this is seen from.
     *
     * The crescent lies in the vertical plane, which is the only orientation
     * that survives this camera: the eye sits at y ~2.7 and the item at ~1.0
     * some 30 units out, so the view is within a few degrees of level and a
     * crescent laid flat would read as a bar. It does go edge-on twice per
     * turn; the asymmetric ends are what carry it through those frames, which
     * is also why there is a dark blossom tip at one end and a stem at the
     * other rather than the old matching pair.
     *
     * Fruit is the rare one and worth more than twice a bottle, so it is bigger
     * and sits in a wider pool. Lemon yellow rather than the JUMP amber, and on
     * a mint pool it never joins that family.
     */
    const bananaGeo = (function () {
      const parts = aidPool(0.70);
      const R = 0.42, SPAN = 1.0, N = 5;
      // Centre of curvature above, so the arc hangs as a smile with the tips
      // lifted. The lowest point sits just under AID_Y.
      const yc = AID_Y - 0.10 + R;
      const pt = (a) => [R * Math.sin(a), yc - R * Math.cos(a)];
      for (let i = 0; i < N; i++) {
        const a = -SPAN + (i + 0.5) * (2 * SPAN / N);
        const p = pt(a);
        // Taper: 0.21 through the belly down to 0.155 at the ends.
        const th = 0.21 - 0.055 * Math.abs(a) / SPAN;
        // Segment length overshoots the arc step so the joints never gap, and
        // the section is turned 45 degrees about its own long axis. That is a
        // LIGHTING decision as much as a shape one: an upright box shows the
        // camera one flat vertical face, which lands in the toon ramp's dark
        // band and turned a lemon banana olive. Cornered, the two facets it
        // shows both carry normal.y = 0.7, take most of the sky hemisphere, and
        // the fruit comes back to yellow -- and a ridged section is what a
        // banana has anyway.
        parts.push(bx(0.20, th, th * 0.92, p[0], p[1], 0, 0xffe45e, Math.PI / 4, 0, a));
        // The crease along the outer edge, in a paler yellow, sitting on the
        // corner the turned section presents. At 30 units, where the whole
        // fruit is eight pixels, this pale line is the part that still reads.
        const d = th * 0.66;
        parts.push(bx(0.20, 0.075, 0.075,
          p[0] - Math.sin(a) * d, p[1] + Math.cos(a) * d, 0,
          0xfff2a8, Math.PI / 4, 0, a));
      }
      // The ends are deliberately NOT a matching pair: a dark blossom tip at
      // one end and a green stem with a stub at the other. The asymmetry is
      // what still says "banana" in the two frames per turn where the crescent
      // is edge-on to the camera and its curve has nothing to show.
      const tip = pt(SPAN), stem = pt(-SPAN);
      parts.push(bx(0.13, 0.12, 0.12, tip[0], tip[1], 0, 0x4a3418, Math.PI / 4, 0, SPAN));
      parts.push(bx(0.11, 0.13, 0.13, stem[0], stem[1] + 0.01, 0, 0x8fbf3f, Math.PI / 4, 0, -SPAN));
      parts.push(bx(0.09, 0.10, 0.09, stem[0] - 0.055, stem[1] + 0.09, 0, 0x6b4f1f));
      return merge(parts);
    })();

    const waterPool = Pool(function () {
      return S.outlined(waterGeo, mats.propLit, S.INK.prop);
    }, group);
    const bananaPool = Pool(function () {
      return S.outlined(bananaGeo, mats.propLit, S.INK.prop);
    }, group);

    /**
     * The water table itself: trestle, cloth, cups, volunteers, and a sign.
     *
     * This is what says the floating bottle is aid and not another thing to
     * dodge -- one station per water point, on the shoulder outside
     * CORRIDOR_HALF, on whichever side the served lane is nearest, and built
     * with the road toward local -x so one geometry serves both sides under a
     * half-turn.
     *
     * Subway-Surfers chunky: few, large, saturated shapes. The volunteer
     * holding a cup out over the kerb is the whole story of the prop in one
     * silhouette.
     */
    const aidTableGeo = (function () {
      const parts = [];
      const CLOTH = 0x2fd39a, LINEN = 0xf6fffb;
      parts.push(bx(1.20, 0.16, 5.4, 0, 0.94, 0, LINEN));       // table top
      parts.push(bx(1.24, 0.50, 5.46, 0, 0.62, 0, CLOTH));      // skirt
      parts.push(bx(1.28, 0.12, 5.5, 0, 0.86, 0, LINEN));       // trim
      for (const z of [-2.4, 0, 2.4]) {
        parts.push(bx(0.14, 0.86, 0.14, -0.42, 0.43, z, 0x2b2f52));
        parts.push(bx(0.14, 0.86, 0.14, 0.42, 0.43, z, 0x2b2f52));
      }
      // Cups, in two rows down the table. Small, but a dozen white dots on a
      // mint cloth is the read even once the cups themselves are one pixel.
      for (let i = 0; i < 14; i++) {
        parts.push(cyl(0.10, 0.08, 0.20, 6, -0.26 + (i % 2) * 0.5, 1.12,
          -2.4 + Math.floor(i / 2) * 0.72, 0xfffdf5));
      }
      // Crates of stock under and behind the table.
      parts.push(bx(0.9, 0.7, 1.1, 0.9, 0.35, -1.6, 0x1f9f78));
      parts.push(bx(0.9, 0.7, 1.1, 0.9, 0.35, 1.9, 0x1f9f78));
      parts.push(bx(0.94, 0.14, 1.14, 0.9, 0.76, 1.9, 0x86eec0));
      // Two volunteers on the road side, the near one reaching out with a cup.
      const vol = [
        { z: -1.5, skin: 0xffc79a, reach: 1 },
        { z: 1.7, skin: 0xb87a4e, reach: 0 },
      ];
      for (const v of vol) {
        parts.push(bx(0.34, 0.66, 0.26, -0.85, 0.33, v.z, 0x2b2f52));
        parts.push(bx(0.52, 0.66, 0.34, -0.85, 0.99, v.z, CLOTH));
        parts.push(bx(0.30, 0.30, 0.28, -0.85, 1.47, v.z, v.skin));
        parts.push(bx(0.34, 0.12, 0.32, -0.85, 1.64, v.z, 0xfffdf5));
        if (v.reach) {
          parts.push(bx(0.60, 0.14, 0.14, -1.25, 1.22, v.z, v.skin, 0, 0, 0.25));
          parts.push(cyl(0.11, 0.09, 0.22, 6, -1.58, 1.34, v.z, 0xfffdf5));
        } else {
          parts.push(bx(0.14, 0.50, 0.14, -1.10, 1.10, v.z, v.skin));
        }
      }
      // The sign: a post on the road side of the table carrying a board that
      // faces back down the course. It is the only part of the prop the player
      // sees before they are level with it, so it carries the whole distance
      // read -- see aidSignTex.
      parts.push(bx(0.20, 3.4, 0.20, -1.0, 1.7, -2.9, 0x1f7f62));
      parts.push(bx(0.20, 3.4, 0.20, -1.0, 1.7, 2.9, 0x1f7f62));
      parts.push(bx(0.24, 0.24, 6.2, -1.0, 3.5, 0, 0x1f7f62));
      // A pennant above the sign: movement-free, but tall and mint, and the
      // first thing over the crowd line.
      parts.push(bx(0.14, 1.6, 0.14, -1.0, 4.4, -2.9, 0x1f7f62));
      parts.push(bx(0.10, 0.7, 1.3, -1.0, 4.9, -2.2, 0x86eec0));
      return merge(parts);
    })();

    // One texture and one material for every table -- only the mesh is per
    // instance. A word beats any icon at 90 units, and no hazard in this game
    // carries text, so the sign is unambiguous before the cups resolve at all.
    const aidSignTex = labelTexture('WATER', '#0f5c46', '#eafff8', 512, 128);
    const aidSignMat = new THREE.MeshBasicMaterial({ map: aidSignTex });
    const aidSignGeo = new THREE.PlaneGeometry(4.6, 1.15);

    const aidTablePool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(aidTableGeo, mats.prop, S.INK.prop));
      const sign = new THREE.Mesh(aidSignGeo, aidSignMat);
      // Hung under the rail and turned back down the course, canted toward the
      // road so it is square-on to a runner still 60 units away.
      sign.position.set(-1.06, 2.80, -3.06);
      sign.rotation.y = Math.PI + 0.45;
      g.add(sign);
      return g;
    }, group);

    // ---- biome set pieces -------------------------------------------------

    /** Suspension tower with its main cables, straddling the deck. */
    const towerGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        const x = sx * 9.6;
        parts.push(bx(2.4, 30, 2.4, x, 12.5, 0, 0xff6a5e));
        parts.push(bx(2.9, 1.0, 2.9, x, 27.0, 0, 0xd8455e));
        parts.push(bx(2.9, 1.0, 2.9, x, 16.0, 0, 0xd8455e));
        parts.push(bx(3.1, 1.2, 3.1, x, -1.0, 0, 0x3a4570));
        // Catenary, approximated in straight segments either side of the tower.
        for (let i = 0; i < 8; i++) {
          const z0 = i * 13, z1 = (i + 1) * 13;
          const y0 = 26 - Math.pow(i / 8, 1.7) * 22;
          const y1 = 26 - Math.pow((i + 1) / 8, 1.7) * 22;
          const len = Math.hypot(z1 - z0, y1 - y0);
          const ang = Math.atan2(y1 - y0, z1 - z0);
          for (const sz of [-1, 1]) {
            parts.push(bx(0.34, 0.34, len, x, (y0 + y1) / 2, sz * (z0 + z1) / 2, 0xffe45e, -sz * ang));
          }
        }
      }
      parts.push(bx(21, 1.6, 2.0, 0, 26.4, 0, 0xff6a5e));
      parts.push(bx(21, 1.0, 1.6, 0, 21.0, 0, 0xd8455e));
      return merge(parts);
    })();
    const towerPool = Pool(function () {
      return S.outlined(towerGeo, mats.prop, S.INK.scenery);
    }, group);

    /** Abutment: caps the end of the deck so the water does not just stop. */
    const abutGeo = merge([
      bx(46, 4.0, 9, 0, -2.0, 0, 0x6f7aa8),
      bx(48, 0.7, 10, 0, 0.1, 0, 0x8e99c6),
      bx(3.0, 2.6, 9.4, -13, 1.2, 0, 0x8e99c6),
      bx(3.0, 2.6, 9.4, 13, 1.2, 0, 0x8e99c6),
    ]);
    const abutPool = Pool(function () {
      return S.outlined(abutGeo, mats.prop, S.INK.scenery);
    }, group);

    /**
     * The river itself, on the left bank of the RIVERSIDE leg. It starts just
     * beyond the pooled shoulders (which reach TRACK_HALF_WIDTH + 30, so a
     * little under |x| = 34) and so the two never fight over the same ground.
     */
    const riverGeo = merge([
      part(new THREE.PlaneGeometry(94, 58), 0x2f8fc4, -60, -0.12, 0, -Math.PI / 2),
      bx(2.4, 0.34, 58, -12.6, -0.12, 0, 0xe6d9a8),
      bx(1.4, 0.5, 12, -16.5, 0.10, -14, 0x8a5a3c),
      bx(7.5, 0.5, 1.6, -20, 0.10, -19.5, 0x8a5a3c),
      bx(0.24, 1.1, 0.24, -23.5, 0.4, -19.5, 0x8a5a3c),
      bx(2.2, 0.8, 5.4, -21, 0.14, 6, 0xfff2e0),
      bx(0.32, 3.4, 0.32, -21, 1.9, 6, 0xfff2e0),
      bx(2.0, 2.4, 0.12, -20.0, 2.4, 6, 0xff4d5e),
      bx(2.2, 0.8, 5.4, -31, 0.14, 24, 0xffe45e),
      bx(0.32, 3.0, 0.32, -31, 1.7, 24, 0xfff2e0),
      bx(1.8, 2.0, 0.12, -30.1, 2.1, 24, 0x37d6ff),
    ]);
    const riverPool = Pool(function () {
      return S.outlined(riverGeo, mats.prop, S.INK.prop);
    }, group);

    /** Overpass: THE WALL runs under a string of these, so the light drops. */
    const overpassGeo = merge([
      bx(3.4, 8.2, 5.0, -10.5, 4.1, 0, 0x6f6580),
      bx(3.4, 8.2, 5.0, 10.5, 4.1, 0, 0x6f6580),
      bx(26, 1.9, 6.0, 0, 9.0, 0, 0x8b7f9c),
      bx(27, 0.7, 6.4, 0, 10.2, 0, 0x5a4f66),
      bx(26, 0.5, 0.4, 0, 8.0, -3.0, 0x2b2f52),
      bx(26, 0.5, 0.4, 0, 8.0, 3.0, 0x2b2f52),
      bx(27, 1.0, 0.35, 0, 11.0, -3.2, 0xffb020),
      bx(27, 1.0, 0.35, 0, 11.0, 3.2, 0xffb020),
    ]);
    const overpassPool = Pool(function () {
      return S.outlined(overpassGeo, mats.prop, S.INK.scenery);
    }, group);

    /**
     * Grandstand: stepped seating packed with spectators, for FINAL MILE.
     * Built on +x and rotated a half-turn for the other side rather than
     * mirrored with a negative scale, which would invert its normals.
     */
    const standGeo = (function () {
      const parts = [];
      const shirts = [0xff4d5e, 0x37d6ff, 0xffe45e, 0x59d47a, 0xff9ad5, 0xffb020];
      let s = 7717;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let row = 0; row < 5; row++) {
        const y = row * 0.74;
        const x = 0.9 + row * 1.10;
        parts.push(bx(1.10, 0.74, TILE, x, y + 0.37, 0, row % 2 ? 0x8e99c6 : 0x6f7aa8));
        for (let i = 0; i < 11; i++) {
          const z = -TILE / 2 + 1.2 + i * 2.15 + r() * 0.5;
          parts.push(bx(0.40, 0.48, 0.28, x - 0.1, y + 0.98, z, shirts[Math.floor(r() * shirts.length)]));
          parts.push(bx(0.22, 0.22, 0.20, x - 0.1, y + 1.33, z, 0xffc79a));
        }
      }
      for (const z of [-TILE / 2 + 1, TILE / 2 - 1]) {
        parts.push(bx(0.28, 7.2, 0.28, 0.2, 3.6, z, 0x2b2f52));
        parts.push(bx(0.14, 1.7, 2.3, 0.2, 6.4, z, z < 0 ? 0xff3b6b : 0x37d6ff));
      }
      return merge(parts);
    })();
    const standPool = Pool(function () {
      return S.outlined(standGeo, mats.prop, S.INK.scenery);
    }, group);

    // ---- landmarks --------------------------------------------------------
    /**
     * The oversized set dressing: things too big to fit in frame.
     *
     * This is the layer the reference frames have and this game did not.
     * Subway Surfers runs a giant sushi chef and a stacked burger straight
     * through the frame edge; Sonic gives you the loop and the Golden Gate to
     * aim at. What they buy is not detail, it is SPEED -- a 30-unit object
     * sweeping past the edge of the lens is the only thing in a runner that
     * conveys how fast the ground is moving, because the road itself is a
     * repeating texture and the horizon does not move at all.
     *
     * Everything here is built to one convention so a single geometry can serve
     * both sides of the road: local -x is the road, and a landmark on the far
     * side is the same mesh turned a half-turn. They stand at LANDMARK_IN or
     * beyond -- outside the corridor, outside the crowd line, outside the
     * grandstands -- and where one reaches back over the road it does so above
     * OVERHEAD_Y. Nothing here may ever be between the camera and the next gate.
     *
     * One draw each: they are merged, and scenery ink is off, so a 4,000
     * triangle clock tower costs exactly what a tree does.
     */

    /**
     * Railway viaduct, CITY START. The road runs through the arch, so it is a
     * landmark you aim at for twenty seconds and then pass under -- the single
     * most effective shape in the reference set. The arch springs at 9.5 and
     * the deck sits at 13, which is well above the overpass clearance the
     * camera has never reached.
     */
    const viaductGeo = (function () {
      const parts = [];
      const BRICK = 0xb4705a, BRICK2 = 0x8f5546, CAP = 0xd9a48a;
      for (const sx of [-1, 1]) {
        parts.push(bx(5.0, 13.0, 8.4, sx * 13.5, 6.5, 0, BRICK));
        parts.push(bx(5.6, 0.8, 9.0, sx * 13.5, 12.2, 0, BRICK2));
        parts.push(bx(5.0, 11.0, 8.4, sx * 24.0, 5.5, 0, BRICK2));
      }
      // Segmental arch over the road, in stone-sized voussoirs.
      const N = 7;
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI, a1 = ((i + 1) / N) * Math.PI;
        const x0 = -11.5 * Math.cos(a0), y0 = 10.0 + 3.0 * Math.sin(a0);
        const x1 = -11.5 * Math.cos(a1), y1 = 10.0 + 3.0 * Math.sin(a1);
        parts.push(bx(Math.hypot(x1 - x0, y1 - y0) + 0.35, 1.1, 8.6,
          (x0 + x1) / 2, (y0 + y1) / 2, 0, i % 2 ? BRICK : CAP,
          0, 0, Math.atan2(y1 - y0, x1 - x0)));
      }
      parts.push(bx(62, 2.2, 8.6, 0, 14.1, 0, BRICK2));
      parts.push(bx(63, 0.9, 9.4, 0, 15.5, 0, CAP));
      for (const sz of [-1, 1]) {
        parts.push(bx(63, 1.1, 0.6, 0, 16.4, sz * 4.4, CAP));
      }
      // A train standing on it, because a bridge with nothing on it is a wall.
      const cars = [0x37d6ff, 0xf0f4ff, 0x37d6ff];
      for (let i = 0; i < 3; i++) {
        const x = -11 + i * 11;
        parts.push(bx(10.2, 2.8, 3.2, x, 18.3, 0, cars[i]));
        parts.push(bx(10.4, 0.9, 3.3, x, 19.1, 0, 0x1b3350));
        parts.push(bx(9.4, 0.4, 3.0, x, 19.9, 0, 0xd8dcf0));
      }
      return merge(parts);
    })();

    /**
     * Clock tower, CITY START and FINAL MILE. A race is a clock, so the city's
     * clock is the landmark that means something here rather than merely being
     * tall. It stands close enough to be cropped by the top and the side of the
     * frame at the same time, which is the reference framing exactly.
     */
    const clockGeo = (function () {
      const parts = [];
      const STONE = 0xe3d3b6, STONE2 = 0xc3ae8e;
      parts.push(bx(7.4, 1.2, 7.4, 0, 0.6, 0, STONE2));
      parts.push(bx(6.4, 21, 6.4, 0, 11.0, 0, STONE));
      // Window slots, on the two faces that can be seen from the road.
      for (let i = 0; i < 4; i++) {
        const y = 4.5 + i * 4.2;
        parts.push(bx(0.3, 2.6, 1.5, -3.25, y, 0, 0x4a4664));
        parts.push(bx(1.5, 2.6, 0.3, 0, y, -3.25, 0x4a4664));
      }
      parts.push(bx(7.2, 1.0, 7.2, 0, 22.0, 0, STONE2));
      parts.push(bx(5.8, 4.8, 5.8, 0, 24.8, 0, STONE));
      for (const f of [[-3.0, 0, 0.34, 3.3], [0, -3.0, 3.3, 0.34]]) {
        parts.push(bx(f[2], 3.3, f[3], f[0], 24.8, f[1], 0xfffdf5));
      }
      parts.push(bx(0.30, 1.4, 0.16, -3.2, 25.4, 0, 0x2b2f52));
      parts.push(bx(0.16, 0.30, 1.1, -3.2, 24.8, 0.4, 0x2b2f52));
      parts.push(bx(0.16, 1.4, 0.30, 0, 25.4, -3.2, 0x2b2f52));
      parts.push(bx(1.1, 0.30, 0.16, 0.4, 24.8, -3.2, 0x2b2f52));
      parts.push(bx(6.6, 0.8, 6.6, 0, 27.4, 0, STONE2));
      parts.push(cone(4.6, 6.4, 4, 0, 31.0, 0, 0x2f9f8a));
      parts.push(bx(0.30, 2.4, 0.30, 0, 35.2, 0, 0xffe45e));
      return merge(parts);
    })();

    /**
     * Quayside crane, RIVERSIDE. Built with the jib toward local +x so it
     * reaches out over the water, away from the road.
     */
    const craneGeo = (function () {
      const parts = [];
      const RUST = 0xe8543f, DARK = 0x2b2f52;
      for (const sz of [-1, 1]) {
        parts.push(bx(9.6, 1.0, 1.4, 0, 0.5, sz * 3.2, DARK));
        parts.push(bx(1.0, 18, 1.0, -3.4, 9.0, sz * 3.2, RUST, 0, 0, 0.13));
        parts.push(bx(1.0, 18, 1.0, 3.4, 9.0, sz * 3.2, RUST, 0, 0, -0.13));
        parts.push(bx(9.0, 0.7, 0.7, 0, 10.0, sz * 3.2, RUST));
      }
      parts.push(bx(7.4, 3.8, 7.4, 0, 19.8, 0, RUST));
      parts.push(bx(7.8, 0.8, 7.8, 0, 22.0, 0, DARK));
      parts.push(bx(2.2, 2.2, 2.4, -3.2, 18.4, 0, 0xf0f4ff));
      parts.push(bx(24, 1.2, 1.8, 12.5, 23.4, 0, RUST, 0, 0, -0.09));
      parts.push(bx(9.0, 1.0, 1.6, -7.0, 22.6, 0, RUST));
      parts.push(bx(3.4, 2.4, 3.4, -10.5, 22.2, 0, DARK));
      parts.push(bx(0.22, 9.0, 0.22, 18.0, 17.6, 0, DARK));
      parts.push(bx(1.6, 1.2, 1.6, 18.0, 12.6, 0, 0xffe45e));
      // Containers on the quay, which is what makes it a quay.
      const box = [0x37d6ff, 0xff9ad5, 0x59d47a];
      for (let i = 0; i < 3; i++) {
        parts.push(bx(6.4, 2.7, 2.7, -8 + (i % 2) * 3, 1.35 + Math.floor(i / 2) * 2.8,
          -8 - i * 0.6, box[i]));
      }
      return merge(parts);
    })();

    /**
     * A ship. On the river in RIVERSIDE, and out on the open water under THE
     * BRIDGE, where it is the only thing that gives the drop below the deck a
     * scale. Waterline is local y = 0, so the caller sets the height from
     * whatever the water is doing at that z.
     */
    const shipGeo = (function () {
      const parts = [];
      const HULL = 0x1f3f6e, TOP = 0xd8552f, WHITE = 0xf0f4ff;
      parts.push(bx(9.0, 3.6, 34, 0, -1.0, 0, HULL));
      parts.push(bx(9.3, 0.6, 34, 0, 1.0, 0, TOP));
      // Bow, faked with two canted plates rather than a taper.
      parts.push(bx(6.0, 3.6, 6.0, 0, -1.0, 18.0, HULL, 0, 0.5));
      parts.push(bx(6.0, 3.6, 6.0, 0, -1.0, 18.0, HULL, 0, -0.5));
      parts.push(bx(7.6, 4.4, 7.0, 0, 3.4, -12.0, WHITE));
      parts.push(bx(7.8, 1.0, 7.2, 0, 4.6, -12.0, 0x2b3350));
      parts.push(bx(6.6, 0.6, 6.2, 0, 5.9, -12.0, TOP));
      parts.push(cyl(1.5, 1.7, 3.6, 8, 0, 7.6, -14.0, TOP));
      parts.push(cyl(1.6, 1.6, 0.8, 8, 0, 8.6, -14.0, 0x2b2f52));
      parts.push(bx(0.30, 7.0, 0.30, 0, 9.4, -8.0, WHITE));
      const box = [0x37d6ff, 0xff4d5e, 0x59d47a, 0xffe45e, 0x9a7bff];
      for (let i = 0; i < 12; i++) {
        parts.push(bx(7.4, 2.5, 5.4, 0, 2.55 + Math.floor(i / 4) * 2.6,
          -2 + (i % 4) * 6.0, box[i % box.length]));
      }
      return merge(parts);
    })();

    /**
     * A single enormous tree, PARKLAND. The groves fill the middle distance;
     * this is the one that fills the frame. Its canopy reaches back toward the
     * road (local -x) and is cropped by the top of the lens as you pass it, but
     * it stops short of the corridor by a wide margin.
     */
    const oakGeo = (function () {
      const parts = [];
      const BARK = 0x7a5236, BARK2 = 0x6a452c;
      parts.push(cyl(2.2, 3.6, 1.6, 8, 0, 0.6, 0, BARK2));
      parts.push(cyl(1.1, 2.1, 11.0, 8, 0, 6.0, 0, BARK));
      parts.push(bx(0.9, 6.0, 0.9, -2.6, 11.0, 0, BARK, 0, 0, 0.7));
      parts.push(bx(0.8, 5.0, 0.8, 2.4, 11.6, 1.0, BARK, 0, 0, -0.6));
      const green = [0x2f9f52, 0x35a855, 0x3fbf63, 0x59d47a];
      // The inner reach is the number that matters. The furthest any blob gets
      // toward the road is centre minus radius = -10.4, and an oak is never
      // placed nearer than 15, so the canopy stops at world x = 4.6 -- outside
      // CORRIDOR_HALF with room to spare, and at that extremity it is 14 units
      // up regardless.
      const blobs = [
        [-6.0, 14.0, 0.5, 4.4], [-3.0, 15.6, -2.0, 5.2], [0.5, 16.8, 1.2, 5.6],
        [4.2, 15.2, -1.4, 4.8], [6.6, 12.8, 1.8, 4.0], [-1.0, 12.6, 3.6, 4.2],
        [1.6, 13.0, -4.2, 4.4],
      ];
      for (let i = 0; i < blobs.length; i++) {
        const b = blobs[i];
        parts.push(sph(b[3], 7, b[0], b[1], b[2], green[i % green.length]));
      }
      return merge(parts);
    })();

    /**
     * A boating lake, PARKLAND. The player asked for water and RIVERSIDE was
     * the only leg that had any. Opaque, deliberately: a transparent 26x30
     * sheet is the most expensive surface this renderer could be asked to draw
     * and it would buy nothing a flat toy-blue does not already say.
     */
    const pondGeo = (function () {
      const parts = [];
      parts.push(bx(26, 0.30, 30, 0, -0.17, 0, 0x37a8d8));
      // A stone rim, so the water does not simply stop against the grass.
      for (const sz of [-1, 1]) {
        parts.push(bx(27.6, 0.34, 0.9, 0, 0.02, sz * 15.2, 0xcfc6ae));
        parts.push(bx(0.9, 0.34, 30.8, sz * 13.2, 0.02, 0, 0xcfc6ae));
      }
      // Reeds, a jetty, a rowing boat and two ducks: the props are what make a
      // blue rectangle read as a lake.
      let s = 991;
      const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      for (let i = 0; i < 14; i++) {
        const a = r() * 6.3, rad = 11.5 + r() * 2.4;
        parts.push(cone(0.55 + r() * 0.4, 1.5 + r() * 1.2, 5,
          Math.cos(a) * rad, 0.6, Math.sin(a) * rad, r() > 0.5 ? 0x2f9f52 : 0x8f9a3e));
      }
      parts.push(bx(2.0, 0.26, 7.0, -11.5, 0.35, 4.0, 0x8a5a3c));
      parts.push(bx(0.22, 0.8, 0.22, -10.7, 0.7, 7.0, 0x8a5a3c));
      parts.push(bx(0.22, 0.8, 0.22, -12.3, 0.7, 7.0, 0x8a5a3c));
      parts.push(bx(1.5, 0.5, 4.2, -6.0, 0.15, -2.0, 0xfff2e0, 0, 0.25));
      parts.push(bx(1.2, 0.2, 3.4, -6.0, 0.38, -2.0, 0xff4d5e, 0, 0.25));
      for (const d of [[3.0, 6.0], [4.4, 7.2]]) {
        parts.push(bx(0.5, 0.34, 0.8, d[0], 0.12, d[1], 0xfffdf5));
        parts.push(bx(0.3, 0.4, 0.3, d[0], 0.34, d[1] + 0.4, 0xfffdf5));
        parts.push(bx(0.2, 0.16, 0.3, d[0], 0.34, d[1] + 0.65, 0xffb020));
      }
      return merge(parts);
    })();

    /**
     * Roadside hoarding, THE WALL and CITY START. Sixteen units of billboard on
     * two legs, canted toward the road by the caller. It is the cheapest way to
     * get one enormous saturated shape into the frame edge, and on THE WALL --
     * a leg with no crowd and no colour -- it is the only bright thing there is.
     */
    const hoardingGeo = (function () {
      const parts = [];
      for (const sz of [-1, 1]) {
        parts.push(bx(1.0, 9.0, 1.0, 0.2, 4.5, sz * 5.0, 0x2b2f52));
        parts.push(bx(0.6, 0.6, 9.0, 0.2, 7.5, 0, 0x2b2f52));
      }
      parts.push(bx(0.7, 7.2, 16.4, -0.5, 11.6, 0, 0xf6f2e8));
      parts.push(bx(0.9, 0.6, 17.0, -0.5, 15.4, 0, 0x2b2f52));
      parts.push(bx(0.9, 0.6, 17.0, -0.5, 7.9, 0, 0x2b2f52));
      // Poster, in flat blocks: a disc, a bar and a wedge read as graphic
      // design at any distance and never as an object standing in the road.
      parts.push(cyl(2.8, 2.8, 0.24, 14, -0.95, 12.6, -4.2, 0xff3b6b, 0, 0, Math.PI / 2));
      parts.push(bx(0.24, 1.5, 9.6, -0.95, 9.6, 2.2, 0x2b2f52));
      parts.push(bx(0.24, 1.0, 6.4, -0.95, 11.4, 3.4, 0xffb020));
      parts.push(bx(0.24, 4.4, 4.4, -0.95, 13.6, 3.6, 0x37d6ff, Math.PI / 4));
      // Floodlights on the top rail.
      for (const z of [-5.5, 0, 5.5]) {
        parts.push(bx(0.7, 0.5, 1.4, -1.1, 16.0, z, 0xffe45e));
      }
      return merge(parts);
    })();

    /**
     * Big screen on a truss, FINAL MILE. The last mile of a real marathon is
     * lined with them, and it gives the closing leg a vertical landmark to run
     * at that the grandstands -- which are long and low -- cannot provide.
     */
    const jumboGeo = (function () {
      const parts = [];
      const DARK = 0x1b1633;
      for (const sz of [-1, 1]) {
        parts.push(bx(1.2, 13.0, 1.2, 0.6, 6.5, sz * 5.0, DARK));
        parts.push(bx(1.6, 1.0, 1.6, 0.6, 0.5, sz * 5.0, 0x2b2f52));
      }
      for (let i = 0; i < 3; i++) {
        parts.push(bx(0.5, 0.5, 10.6, 0.6, 3.0 + i * 3.6, 0, 0x2b2f52, 0.36));
      }
      parts.push(bx(1.4, 7.6, 13.4, 0, 15.4, 0, 0x2b2f52));
      parts.push(bx(0.5, 6.6, 12.4, -0.8, 15.4, 0, 0x0d1030));
      // What is on the screen: the race, in blocks. Bright, because a dark
      // rectangle at this size just reads as a hole in the sky.
      parts.push(bx(0.24, 3.4, 12.0, -1.08, 16.6, 0, 0x37d6ff));
      parts.push(bx(0.24, 2.2, 5.4, -1.10, 14.2, -3.0, 0xff4d5e));
      parts.push(bx(0.24, 1.0, 5.0, -1.10, 13.0, 3.0, 0xffe45e));
      parts.push(bx(0.24, 1.6, 1.6, -1.10, 16.9, -4.2, 0xfffdf5));
      // Speaker stacks and a pair of flags, so the truss has a base and a top.
      for (const sz of [-1, 1]) {
        parts.push(bx(2.2, 2.6, 2.2, 0.6, 11.0, sz * 7.2, DARK));
        parts.push(bx(0.24, 3.2, 0.24, 0.6, 20.8, sz * 5.0, 0x2b2f52));
        parts.push(bx(0.12, 1.3, 2.0, 0.6, 21.6, sz * 5.0 + (sz > 0 ? 1.0 : -1.0),
          sz > 0 ? 0xff3b6b : 0x37d6ff));
      }
      return merge(parts);
    })();

    const landmarkPools = {
      viaduct: Pool(function () { return S.outlined(viaductGeo, mats.prop, S.INK.scenery); }, group),
      clock: Pool(function () { return S.outlined(clockGeo, mats.prop, S.INK.scenery); }, group),
      crane: Pool(function () { return S.outlined(craneGeo, mats.prop, S.INK.scenery); }, group),
      ship: Pool(function () { return S.outlined(shipGeo, mats.prop, S.INK.scenery); }, group),
      oak: Pool(function () { return S.outlined(oakGeo, mats.prop, S.INK.scenery); }, group),
      pond: Pool(function () { return S.outlined(pondGeo, mats.prop, S.INK.scenery); }, group),
      hoarding: Pool(function () { return S.outlined(hoardingGeo, mats.prop, S.INK.scenery); }, group),
      jumbo: Pool(function () { return S.outlined(jumboGeo, mats.prop, S.INK.scenery); }, group),
    };

    // ---- mile banners ---------------------------------------------------
    // A banner is a gantry, not a floating card: legs, a truss, a lit header
    // and a stripe painted across the road so the moment of passing it is
    // marked on the ground as well as overhead.
    // A gantry straddles the road, so its legs are pinned a fixed step outside
    // the kerb rather than to a literal. Narrow the track and the banner comes
    // in with it, instead of being left standing out among the spectators.
    const GANTRY = K.TRACK_HALF_WIDTH + 1.2;
    const bannerFrameGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        parts.push(bx(0.42, 6.0, 0.42, sx * GANTRY, 3.0, 0, 0x2b2f52));
        parts.push(bx(0.90, 0.30, 0.90, sx * GANTRY, 0.15, 0, 0x1b1633));
        parts.push(bx(0.30, 0.30, 1.8, sx * GANTRY, 5.4, 0, 0x2b2f52, 0, 0, 0));
      }
      parts.push(bx(GANTRY * 2 + 0.4, 0.40, 0.40, 0, 5.95, 0, 0x2b2f52));
      parts.push(bx(GANTRY * 2 + 0.4, 0.30, 0.30, 0, 3.65, 0, 0x2b2f52));
      for (let i = -4; i <= 4; i++) {
        parts.push(bx(0.16, 2.4, 0.16, i * (GANTRY - 0.6) / 4, 4.8, 0, 0x3a4570, 0, 0, i % 2 ? 0.45 : -0.45));
      }
      parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 0.7), 0xfffdf5, 0, 0.011, 0, -Math.PI / 2));
      return merge(parts);
    })();

    const bannerPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(bannerFrameGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, 2.1), mat);
      panel.position.y = 4.78; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(GANTRY * 2 - 0.6, 2.1), mat);
      back.position.y = 4.78;
      g.add(back);
      g.userData.panel = panel;
      g.userData.mat = mat;
      return g;
    }, group);

    // Start and finish get a heavier arch with a checker band.
    const checkTex = checkerTexture();
    const ARCH = K.TRACK_HALF_WIDTH + 3.0;   // heavier gantry, set further back
    const archGeo = merge([
      bx(1.5, 9.0, 1.5, -ARCH, 4.5, 0, 0xff3b6b),
      bx(1.5, 9.0, 1.5, ARCH, 4.5, 0, 0xff3b6b),
      bx(2.3, 0.6, 2.3, -ARCH, 0.3, 0, 0x1b1633),
      bx(2.3, 0.6, 2.3, ARCH, 0.3, 0, 0x1b1633),
      bx(ARCH * 2 + 2.4, 1.3, 1.6, 0, 8.7, 0, 0xff3b6b),
      bx(ARCH * 2 + 2.4, 0.5, 1.2, 0, 6.2, 0, 0xd42a55),
      bx(0.9, 4.2, 0.9, -(ARCH - 1.2), 10.9, 0, 0x2b2f52),
      bx(0.9, 4.2, 0.9, ARCH - 1.2, 10.9, 0, 0x2b2f52),
      bx(2.6, 1.8, 0.12, -(ARCH - 2.4), 12.4, 0, 0xffe45e),
      bx(2.6, 1.8, 0.12, ARCH - 2.4, 12.4, 0, 0xffe45e),
    ]);
    const archPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(archGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 2.4), mat);
      panel.position.y = 7.45; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 2.4), mat);
      back.position.y = 7.45;
      g.add(back);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(ARCH * 2 + 0.6, 0.55), new THREE.MeshBasicMaterial({ map: checkTex }));
      band.position.set(0, 5.95, 0.1); band.rotation.y = Math.PI;
      g.add(band);
      // Checker laid across the road: the line you actually cross.
      const line = new THREE.Mesh(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 1.2),
        new THREE.MeshBasicMaterial({ map: checkTex }));
      line.rotation.x = -Math.PI / 2;
      line.position.y = 0.013;
      line.renderOrder = 4;
      g.add(line);
      g.userData.panel = panel;
      g.userData.mat = mat;
      return g;
    }, group);

    // ---------------------------------------------------------------------
    // Layout is drawn once from the seeded stream so it is identical for every
    // player, then indexed by z for windowed spawning.
    const scenery = [];
    {
      let z = -60;
      while (z < K.TOTAL_UNITS + 120) {
        const look = lookAtZ(Math.max(0, z)).look;
        const w = PROP_KINDS.map((k) => look.mix[k] || 0);
        const total = w.reduce((a, b) => a + b, 0);
        let side = rnd.chance(0.5) ? -1 : 1;
        let kind = total > 0 ? rnd.weighted(PROP_KINDS, w) : null;
        // Anything with foundations goes on the dry side of a river leg.
        if (look.bank === side && kind !== 'crowd') side = -side;
        // A zero-weighted kind must never slip through the fallback branch of
        // weighted(); a building standing in the middle of the river is the
        // kind of thing nobody notices until a screenshot.
        if (kind && !look.mix[kind]) kind = null;
        if (kind) {
          scenery.push({
            z, side, kind,
            x: side * rnd.range(7.5, 26),
            a: rnd.next(), b: rnd.next(), c: rnd.next(),
          });
        }
        z += rnd.range(3.4, 9.5);
      }
      scenery.sort((p, q) => p.z - q.z);
    }

    // Set pieces: deterministic, biome-specific, and placed by hand rather
    // than rolled, because a bridge tower in the wrong place is not a bridge.
    const structures = [];
    // Far enough out that the player runs through it rather than starting
    // underneath it, which is where the camera would never see it at all.
    structures.push({ z: 30, kind: 'arch', label: 'START', sub: course.key, bg: '#1b1633', fg: '#ffe45e' });
    for (let z = BRIDGE.from + 140; z < BRIDGE.to - 120; z += 235) {
      structures.push({ z, kind: 'tower' });
    }
    structures.push({ z: DECK_FROM - 5, kind: 'abut' });
    structures.push({ z: DECK_TO + 5, kind: 'abut' });
    for (const b of BI) {
      if (b.name === 'RIVERSIDE') {
        for (let z = b.from; z < b.to; z += 58) structures.push({ z, kind: 'river', side: -1 });
      }
      if (b.name === 'THE WALL') {
        for (let z = b.from + 90; z < b.to - 40; z += 168) structures.push({ z, kind: 'overpass' });
        // One placed by hand: you go under it and the mile 20 gantry is
        // waiting on the far side. Mile 20 is where a marathon breaks people,
        // and the course should stage it rather than merely label it.
        structures.push({ z: 20 * K.UNITS_PER_MILE - 34, kind: 'overpass' });
      }
      if (b.name === 'FINAL MILE') {
        for (let z = b.from; z < K.TOTAL_UNITS + 30; z += TILE) {
          structures.push({ z, kind: 'stand', side: -1 });
          structures.push({ z, kind: 'stand', side: 1 });
        }
      }
    }

    /**
     * Place one landmark. `x` is the distance out from the centre line and is
     * always positive; `side` decides which shoulder it stands on and turns the
     * mesh a half-turn so its road-facing side (local -x, by convention above)
     * still faces the road. Nothing may be placed inside LANDMARK_IN.
     */
    function landmark(z, kind, side, x, y, rz) {
      structures.push({
        z, kind, side,
        x: side * Math.max(x, LANDMARK_IN),
        y: y || 0,
        ry: side < 0 ? Math.PI : 0,
        rz: (rz || 0) * side,
      });
    }
    // Spanning pieces are symmetric and sit on the centre line.
    function landmarkOver(z, kind) {
      structures.push({ z, kind, side: 1, x: 0, y: 0, ry: 0, rz: 0 });
    }

    // Hand-placed, one biome at a time, and spaced so at most two are ever in
    // the 210-unit spawn window at once. They are the most expensive thing in
    // the frame in fill terms, and a skyline of them would read as clutter
    // rather than as landmarks anyway.
    landmark(180, 'hoarding', -1, 13.0, 0, -0.13);
    landmark(300, 'clock', 1, 14.5);
    landmarkOver(560, 'viaduct');
    landmark(700, 'hoarding', 1, 13.0, 0, -0.13);
    landmark(880, 'clock', -1, 15.0);
    landmarkOver(1010, 'viaduct');

    landmark(1150, 'ship', -1, 34.0, -0.12);
    landmark(1230, 'crane', -1, 13.0);
    landmark(1380, 'oak', 1, 15.0);
    landmark(1520, 'pond', 1, 27.0);
    landmark(1640, 'ship', -1, 38.0, -0.12);
    landmark(1880, 'crane', -1, 13.0);
    landmark(2000, 'oak', 1, 15.0);

    // Under the bridge the water is WATER_DROP below the road, so the ships sit
    // there rather than at zero -- and being able to see how far down that is,
    // on an object of known size, is the whole reason they are out there. They
    // are also the only objects on this leg: with the shoulders gone the deck
    // is a ribbon over an empty plane, and a ribbon over nothing has no speed.
    for (let i = 0; i < 6; i++) {
      const sd = i % 2 ? 1 : -1;
      landmark(2200 + i * 155, 'ship', sd, 24 + (i % 3) * 8, -0.34 - WATER_DROP);
    }

    landmark(3160, 'oak', -1, 15.0);
    landmark(3280, 'oak', 1, 15.0);
    // The lake has to stand off further than anything else: its stone rim is
    // 13.8 out from its own centre, and the PARKLAND verge carries eight units
    // of pavement to x = 11.75 that it may not cut through.
    landmark(3480, 'pond', -1, 27.0);
    landmark(3620, 'oak', 1, 16.0);
    landmark(3900, 'oak', -1, 15.0);
    landmark(4060, 'oak', 1, 15.0);
    landmark(4200, 'pond', 1, 27.0);
    landmark(4400, 'oak', -1, 15.0);

    // Closer in than the rest: THE WALL boxes the road in with a 6.5-unit
    // hoarding at 11.35, so anything standing further out only shows its top.
    // These are meant to loom over that wall, which is also the only relief the
    // leg gets.
    landmark(4700, 'hoarding', 1, 12.6, 0, -0.16);
    landmark(4930, 'hoarding', -1, 12.6, 0, -0.16);
    landmark(5150, 'hoarding', 1, 12.6, 0, -0.16);
    landmark(5380, 'hoarding', -1, 12.6, 0, -0.16);
    landmark(5620, 'hoarding', 1, 12.6, 0, -0.16);

    landmark(5860, 'jumbo', 1, 13.5);
    landmark(6020, 'jumbo', -1, 13.5);
    landmark(6180, 'clock', 1, 15.5);

    /**
     * Water tables, derived from the aid the course generated rather than
     * placed independently -- the props and the pickups have to be telling the
     * same story.
     *
     * That story changed. course.js used to emit a table as a run of three to
     * five consecutive water items in one lane, and this loop grouped the run
     * back up into one table; aid is now ONE item per point, spaced 620 units
     * early to 220 late, about fourteen in a marathon. So a table is no longer
     * a stand serving a stretch of road -- it is a single station beside a
     * single bottle, and it is keyed straight off that bottle. There are eight
     * or nine of them in a whole race, which is about right for a marathon and
     * far enough apart that each one is an event.
     *
     * Fruit gets no prop. Every water point having a stand and every fruit
     * point having nothing is what tells the two apart before either is close
     * enough to identify by shape.
     */
    for (const a of (course.aid || [])) {
      if (a.kind !== 'water') continue;
      // The nearer shoulder to the lane being served. A centre-lane item has
      // no nearer side, so the course's own z picks one -- still identical for
      // every player, which is the only property that matters.
      const lx = K.LANE_X[a.lane];
      const side = lx > 0.05 ? 1 : lx < -0.05 ? -1 : ((Math.round(a.z) & 1) ? 1 : -1);
      structures.push({
        z: a.z, kind: 'aidTable', side,
        x: side * (K.TRACK_HALF_WIDTH + 3.4), y: 0,
        ry: side < 0 ? Math.PI : 0, rz: 0,
      });
    }

    structures.sort((p, q) => p.z - q.z);

    const banners = course.mileMarkers.map((m) => ({ m, tex: null }));

    // ---- windowed spawn bookkeeping -------------------------------------
    const state = {
      roadFrom: 0,
      gateIdx: 0,
      sceneIdx: 0,
      structIdx: 0,
      bannerIdx: 0,
      aidIdx: 0,
      biome: null,
      look: BIOME_LOOK['CITY START'],
    };

    const activeGates = [];   // { gate, objs:[] }
    const activeScene = [];   // { s, obj }
    const activeStruct = [];  // { st, obj }
    const activeBanner = [];  // { b, obj }
    const activeRoad = [];    // { z, obj }
    const activeAid = [];     // { it, obj, pool, pop }

    function hazardObject(kind) {
      if (kind === K.JUMP) return jumpPool.claim();
      if (kind === K.DUCK) return duckPool.claim();
      if (kind === K.BLOCK) return blockPool.claim();
      return null;
    }
    function releaseHazard(kind, obj) {
      if (kind === K.JUMP) jumpPool.release(obj);
      else if (kind === K.DUCK) duckPool.release(obj);
      else if (kind === K.BLOCK) blockPool.release(obj);
    }

    function sceneryPool(s) {
      if (s.kind === 'building') return buildingPool;
      if (s.kind === 'tree') return treePool;
      if (s.kind === 'grove') return grovePool[Math.floor(s.b * grovePool.length) % grovePool.length];
      if (s.kind === 'crowd') return crowdPool[Math.floor(s.a * crowdPool.length) % crowdPool.length];
      return null;
    }
    function structPool(kind) {
      if (kind === 'tower') return towerPool;
      if (kind === 'abut') return abutPool;
      if (kind === 'river') return riverPool;
      if (kind === 'overpass') return overpassPool;
      if (kind === 'stand') return standPool;
      if (kind === 'arch') return archPool;
      if (kind === 'aidTable') return aidTablePool;
      return landmarkPools[kind] || null;
    }

    // routeLane is exposed so it can be asserted against the course rather than
    // taken on trust: the lane it names at every gate must never be a BLOCK.
    const api = { group, sky, mats, course };
    Object.defineProperty(api, 'routeLane', { get: function () { return routeLane; } });

    /** Recolour shared materials for the biome at progress f. */
    api.fogColor = new THREE.Color(BIOME_LOOK['CITY START'].fog);
    const _road = new THREE.Color(), _shoulder = new THREE.Color();
    const _skyTop = new THREE.Color(), _skyBot = new THREE.Color();

    api.applyBiome = function (f) {
      const b = MR.Course.biomeAt(f);
      const look = BIOME_LOOK[b.name] || BIOME_LOOK['CITY START'];
      const idx = MR.Course.BIOMES.indexOf(b);
      const prev = idx > 0 ? BIOME_LOOK[MR.Course.BIOMES[idx - 1].name] : look;

      // Cross-fade over the first 0.03 of a biome instead of popping.
      const t = Math.min(1, (f - b.from) / 0.03);

      mats.road.color.copy(lerpInto(_road, prev.road, look.road, t));
      mats.shoulder.color.copy(lerpInto(_shoulder, prev.ground, look.ground, t));
      if (mats.ground) mats.ground.color.copy(mats.shoulder.color);
      sky.material.uniforms.top.value.copy(lerpInto(_skyTop, prev.sky[0], look.sky[0], t));
      sky.material.uniforms.bottom.value.copy(lerpInto(_skyBot, prev.sky[1], look.sky[1], t));

      state.biome = b;
      state.look = look;
      lerpInto(api.fogColor, prev.fog, look.fog, t);
      // Hills take the ground hue knocked back toward the fog, so they read as
      // the same land seen through a great deal of air.
      hillsMat.color.copy(mats.shoulder.color).lerp(api.fogColor, 0.45);
      return b;
    };

    /**
     * Advance the spawn window. `z` is the runner's distance along the course
     * in world units; the world itself does not move, the camera does.
     */
    api.update = function (z, playerLane) {
      if (playerLane !== undefined && playerLane !== routePlannedLane) {
        routePlannedLane = playerLane;
        // Replan from the next gate the player has not yet resolved, so the
        // line starts where they are rather than where they began.
        let gi = 0;
        while (gi < course.gates.length && course.gates[gi].z < z) gi++;
        const re = racingLine(course.gates, playerLane, gi);
        if (re) routeLane = re;
      }
      const ahead = z + VIEW;
      const back = z - BEHIND;
      const now = performance.now() * 0.001;

      // Keep the ground under the runner; the sky dome likewise, so the
      // gradient never slides off as the race progresses.
      const lift = deckLift(z);
      ground.position.z = z;
      ground.position.y = -0.34 - WATER_DROP * lift;
      sky.position.z = z;
      hills.position.z = z;
      // On the bridge there is no land to see, only water to the horizon.
      hills.visible = lift < 0.6;
      ripples.visible = lift > 0.02;
      if (ripples.visible) {
        ripples.position.set(0, ground.position.y + 0.05, z);
        ripples.material.opacity = 0.9 * lift;
        // A slow crawl is all a flat plane needs to stop reading as lino.
        rippleTex.offset.y = (now * 0.014) % 1;
      }

      // road
      while (state.roadFrom * TILE < ahead) {
        const tz = state.roadFrom * TILE;
        const obj = roadPool.claim();
        obj.position.z = tz;
        const edge = lookAtZ(tz).look.edge;
        for (const k in obj.userData.edges) obj.userData.edges[k].visible = (k === edge);
        // On the deck the shoulders come off and the road becomes a ribbon
        // over water. Tiles are claimed 210 units out, so the swap always
        // happens well beyond anything the player can see change.
        const deck = deckLift(tz + TILE / 2) > 0.55;
        const bank = lookAtZ(tz).look.bank || 0;
        for (let i = 0; i < 2; i++) {
          const sh = obj.userData.shoulders[i];
          const sx = i === 0 ? -1 : 1;
          sh.visible = !deck;
          // Cut the shoulder back to a 9-unit verge where a river runs, so the
          // water starts at x = 13 instead of past the 34-unit shoulder edge.
          const cut = (bank === sx);
          sh.scale.x = cut ? 0.30 : 1;
          sh.position.x = sx * (cut ? 8.9 : K.TRACK_HALF_WIDTH + 15);
        }
        activeRoad.push({ z: tz, obj });
        state.roadFrom++;
      }
      while (activeRoad.length && activeRoad[0].z + TILE < back) {
        roadPool.release(activeRoad.shift().obj);
      }

      // hazards
      while (state.gateIdx < course.gates.length && course.gates[state.gateIdx].z < ahead) {
        const gate = course.gates[state.gateIdx++];
        const objs = [];
        for (let l = 0; l < 3; l++) {
          const kind = gate.lanes[l];
          if (kind === K.CLEAR) { objs.push(null); continue; }
          const o = hazardObject(kind);
          o.position.set(K.LANE_X[l], 0, gate.z);
          if (kind === K.BLOCK) {
            // Stretch a train backwards along z rather than repeating blocks;
            // the front face and the telegraph stay put on the gate line.
            const span = gate.train ? 1 + gate.train * 0.9 : 1;
            o.userData.body.scale.z = span;
            o.userData.body.position.z = (span - 1) * 0.65;
          }
          objs.push(o);
        }
        activeGates.push({ gate, objs });
      }
      while (activeGates.length && activeGates[0].gate.z < back) {
        const g = activeGates.shift();
        for (let l = 0; l < 3; l++) if (g.objs[l]) releaseHazard(g.gate.lanes[l], g.objs[l]);
      }

      // roadside props
      while (state.sceneIdx < scenery.length && scenery[state.sceneIdx].z < ahead) {
        const s = scenery[state.sceneIdx++];
        const pool = sceneryPool(s);
        if (!pool) continue;
        const obj = pool.claim();
        if (s.kind === 'building') {
          const w = 5 + s.a * 10, h = 7 + s.b * 26, d = 5 + s.c * 8;
          obj.userData.body.scale.set(w, h, d);
          obj.userData.line.scale.set(w, h, d);
          const tint = P.building[Math.floor(s.a * P.building.length)];
          obj.userData.mat.color.set(tint);
          obj.userData.capMat.color.set(tint);
          // Windows keep a constant world size whatever the box is scaled to.
          obj.userData.tex.repeat.set(Math.max(1, Math.round(w / 4.5)), Math.max(1, Math.round(h / 4.5)));
          obj.userData.parapet.scale.set(w + 0.7, 0.6 + s.c * 0.8, d + 0.7);
          obj.userData.parapet.position.y = h / 2 + 0.3;
          obj.position.set(s.x + s.side * 13, h / 2, s.z);
        } else if (s.kind === 'tree') {
          obj.scale.setScalar(0.7 + s.a * 0.75);
          obj.position.set(s.x, 0, s.z);
          obj.rotation.y = s.b * 6.3;
        } else if (s.kind === 'grove') {
          obj.position.set(s.x + s.side * 10, 0, s.z);
          obj.rotation.y = s.a * 6.3;
        } else {
          // Crowd packs against the barrier line; the far side of a wide road
          // is where a real course puts the overflow.
          obj.position.set(s.side * (K.TRACK_HALF_WIDTH + 1.9 + s.b * 3.4), 0, s.z);
          obj.rotation.y = s.side > 0 ? Math.PI : 0;
          obj.userData.bounce = s.c;
        }
        activeScene.push({ s, obj, pool });
      }
      while (activeScene.length && activeScene[0].s.z < back) {
        const e = activeScene.shift();
        e.pool.release(e.obj);
      }

      // ---- aid ----------------------------------------------------------
      // Spawned on the same windowed cursor as everything else; the pop is
      // driven from here rather than plumbed in from main.js, because the rule
      // that decides it is one line and duplicating it is cheaper than a new
      // callback the renderer would have to be trusted to fire.
      while (state.aidIdx < aidItems.length && aidItems[state.aidIdx].z < ahead) {
        const it = aidItems[state.aidIdx++];
        const pool = it.kind === 'banana' ? bananaPool : waterPool;
        const obj = pool.claim();
        obj.position.set(K.LANE_X[it.lane], 0, it.z);
        obj.scale.setScalar(1);
        activeAid.push({ it, obj, pool, pop: -1 });
      }
      for (let i = activeAid.length - 1; i >= 0; i--) {
        const e = activeAid[i];
        if (e.pop < 0) {
          // Lane match only -- exactly what player.js resolves on, so the pop
          // can never disagree with the streak the player was just granted.
          // The 6-unit gate is what stops an item popping long after the fact
          // when a ?skip= jump spawns one that is already behind the runner.
          if (playerLane !== undefined && e.it.lane === playerLane
            && e.it.z <= z && z - e.it.z < 6) {
            e.pop = now;
          } else if (e.it.z < z - AID_BEHIND) {
            e.pool.release(e.obj);
            activeAid.splice(i, 1);
            continue;
          } else {
            // The turn, and it now carries more than it used to: aid arrives
            // alone rather than in runs of five, so a solo item has none of the
            // presence a row had and the spin is most of what distinguishes it
            // from the static world. A little quicker than the old 1.5 for the
            // same reason -- fast enough to be seen turning in the second or so
            // it is on screen, slow enough not to read as a spinning trap.
            // Phase still comes off the item's own z, which keeps two items in
            // sight of each other out of step and costs nothing.
            e.obj.rotation.y = now * 2.0 + e.it.z * 0.9;
          }
        }
        if (e.pop >= 0) {
          const t = (now - e.pop) / AID_POP_TIME;
          if (t >= 1) {
            e.pool.release(e.obj);
            activeAid.splice(i, 1);
            continue;
          }
          // Punch out, then away. Scale and lift only: a fade would need a
          // material per item, and transparent surfaces are the one thing this
          // renderer genuinely cannot spare.
          //
          // It climbs, and climbs fast. Collection happens at the runner's own
          // z with the camera four units behind, so the pop goes off almost at
          // the lens: a burst that swelled in place would sit across the road
          // the player is reading. Lifting it out of the road read in the first
          // tenth is what makes it a flourish instead of a blindfold -- and the
          // swell is kept to 1.35, which is noticed rather than looked at.
          const s = (1 + 0.55 * Math.sin(Math.PI * t)) * (1 - t * t);
          e.obj.scale.setScalar(Math.max(0.001, s));
          e.obj.position.y = 3.4 * Math.sqrt(t);
          e.obj.rotation.y += 0.3;
        }
      }

      // biome set pieces
      while (state.structIdx < structures.length && structures[state.structIdx].z < ahead) {
        const st = structures[state.structIdx++];
        const pool = structPool(st.kind);
        if (!pool) continue;
        const obj = pool.claim();
        // Pooled, so every transform a set piece can carry has to be written
        // on every claim -- a landmark inheriting the previous tenant's cant is
        // the kind of thing that only shows up in one screenshot in twenty.
        obj.position.set(st.x || 0, st.y || 0, st.z);
        obj.rotation.set(0, st.ry || 0, st.rz || 0);
        if (st.kind === 'stand') {
          obj.position.x = st.side * (K.TRACK_HALF_WIDTH + 1.3);
          obj.rotation.y = st.side < 0 ? Math.PI : 0;
        }
        if (st.kind === 'arch' && obj.userData.mat) {
          if (!st.tex) st.tex = labelTexture(st.label, st.bg, st.fg, 768, 128, st.sub);
          obj.userData.mat.map = st.tex;
          obj.userData.mat.needsUpdate = true;
        }
        activeStruct.push({ st, obj, pool });
      }
      while (activeStruct.length && activeStruct[0].st.z < back - 60) {
        const e = activeStruct.shift();
        e.pool.release(e.obj);
      }

      // mile banners
      while (state.bannerIdx < banners.length && banners[state.bannerIdx].m.z < ahead) {
        const b = banners[state.bannerIdx++];
        const finish = b.m.finish;
        const wall = b.m.mile === 20;
        if (!b.tex) {
          b.tex = finish
            ? labelTexture('FINISH', '#ff3b6b', '#fffdf5', 768, 128)
            : wall
              ? labelTexture('MILE 20', '#7a1030', '#ff9ab0', 768, 128, 'THE WALL')
              : labelTexture(`MILE ${b.m.mile}`, '#1b1633', '#ffe45e', 768, 128);
        }
        const pool = finish ? archPool : bannerPool;
        const obj = pool.claim();
        obj.position.set(0, 0, b.m.z);
        obj.userData.mat.map = b.tex;
        obj.userData.mat.color.set(0xffffff);
        obj.userData.mat.needsUpdate = true;
        activeBanner.push({ b, obj, pool });
      }
      while (activeBanner.length && activeBanner[0].b.m.z < back) {
        const e = activeBanner.shift();
        e.pool.release(e.obj);
      }

      // Crowd idle: a cheap bob keeps the roadside alive without animation data.
      for (const e of activeScene) {
        if (e.s.kind !== 'crowd') continue;
        e.obj.position.y = Math.abs(Math.sin(now * 4 + e.obj.userData.bounce * 6.3)) * 0.13;
      }

      updateRoute(z, now);

      api.applyBiome(Math.min(1, z / K.TOTAL_UNITS));
    };

    api.reset = function () {
      roadPool.releaseAll(); jumpPool.releaseAll(); duckPool.releaseAll();
      blockPool.releaseAll(); buildingPool.releaseAll(); treePool.releaseAll();
      aidTablePool.releaseAll(); bannerPool.releaseAll(); archPool.releaseAll();
      towerPool.releaseAll(); abutPool.releaseAll(); riverPool.releaseAll();
      overpassPool.releaseAll(); standPool.releaseAll();
      waterPool.releaseAll(); bananaPool.releaseAll();
      for (const k in landmarkPools) landmarkPools[k].releaseAll();
      for (const p of crowdPool) p.releaseAll();
      for (const p of grovePool) p.releaseAll();
      activeGates.length = 0; activeScene.length = 0; activeStruct.length = 0;
      activeBanner.length = 0; activeRoad.length = 0; activeAid.length = 0;
      state.roadFrom = 0; state.gateIdx = 0; state.sceneIdx = 0;
      state.structIdx = 0; state.bannerIdx = 0; state.aidIdx = 0;
    };

    api.stats = function () {
      return {
        gates: activeGates.length,
        scenery: activeScene.length,
        structures: activeStruct.length,
        aid: activeAid.length,
        road: activeRoad.length,
      };
    };

    return api;
  }

  return { create, VIEW, BEHIND, BIOME_LOOK };
})();
