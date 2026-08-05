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
 */
MR.World = (function () {
  const K = MR.K;
  const S = MR.shading;
  const P = S.PALETTE;

  const VIEW = 210;      // spawn distance ahead of the runner
  const BEHIND = 34;     // release distance behind
  const TILE = 24;       // road tile length

  // ---- biome palettes ---------------------------------------------------
  // `edge` names the roadside furniture the road tile wears; `mix` weights the
  // roadside prop lottery. Together they are what distinguishes a biome, the
  // colours only agree with it.
  const BIOME_LOOK = {
    'CITY START': {
      sky: [0x2b3fa8, 0x9fdcff], ground: 0x63c96b, road: 0x50557d, fog: 0x9fdcff,
      edge: 'barrier',
      mix: { building: 2.6, tree: 0.55, grove: 0.15, crowd: 2.3, rival: 0.5, station: 0.10 },
    },
    // `bank` cuts the shoulder back on one side so the water can come right up
    // to the road; at full shoulder width the river sat 35 units out and read
    // as a smear on the horizon.
    'RIVERSIDE': {
      sky: [0x1f6fb8, 0xbdf0ff], ground: 0x57c7a8, road: 0x4d5a80, fog: 0xbdf0ff,
      edge: 'hedge', bank: -1,
      mix: { building: 0.45, tree: 1.5, grove: 1.3, crowd: 1.0, rival: 0.45, station: 0.12 },
    },
    // Nothing stands beside a bridge deck -- the emptiness is the point, and a
    // spectator out there would be standing on the river.
    'THE BRIDGE': {
      sky: [0x3a4fc0, 0xffd9a8], ground: 0x2f8fc4, road: 0x5b5f88, fog: 0xffd9a8,
      edge: 'rail',
      mix: { building: 0.0, tree: 0.0, crowd: 0.0, rival: 1.0, station: 0.0 },
    },
    'PARKLAND': {
      sky: [0x2e8fd0, 0xcdf5c0], ground: 0x6fd46a, road: 0x53587f, fog: 0xcdf5c0,
      edge: 'hedge',
      mix: { building: 0.12, tree: 2.2, grove: 3.2, crowd: 1.1, rival: 0.45, station: 0.12 },
    },
    'THE WALL': {
      sky: [0x8a3a6b, 0xffb27a], ground: 0x8f9a5e, road: 0x5a4f66, fog: 0xffb27a,
      edge: 'wall',
      mix: { building: 2.0, tree: 0.25, crowd: 0.35, rival: 0.3, station: 0.18 },
    },
    'FINAL MILE': {
      sky: [0x24306e, 0xffcf6b], ground: 0x5cb46a, road: 0x4a4f78, fog: 0xffcf6b,
      edge: 'barrier',
      mix: { building: 1.1, tree: 0.3, crowd: 3.4, rival: 0.6, station: 0.0 },
    },
  };

  const PROP_KINDS = ['building', 'tree', 'grove', 'crowd', 'rival', 'station'];

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

  function create(course) {
    const group = new THREE.Group();
    const rnd = MR.rng.stream(course.key, 'scenery/v2');

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
      for (const sx of [-1, 1]) {
        parts.push(part(new THREE.PlaneGeometry(0.26, TILE), 0xf2f4ff,
          sx * (K.TRACK_HALF_WIDTH - 0.16), 0.006, 0, flat));
      }
      for (const lx of [-1.175, 1.175]) {
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
      }
      return merge(parts);
    })();

    /**
     * THE WALL: concrete jersey barrier and a graffitied hoarding. The leg is
     * meant to feel enclosed and joyless, so the roadside closes in rather
     * than opening onto crowd.
     */
    const wallGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        pavement(parts, sx, 0x8c8a96, 0xb0aeba);
        const x = sx * (K.TRACK_HALF_WIDTH + 0.9);
        parts.push(bx(1.0, 0.55, TILE, x, 0.27, 0, 0xc8c4cc));
        parts.push(bx(0.62, 0.55, TILE, x, 0.80, 0, 0xdedae2));
        parts.push(bx(0.70, 0.12, TILE, x, 1.10, 0, 0xffb020));
        const wx = sx * (K.TRACK_HALF_WIDTH + 7.6);
        parts.push(bx(0.7, 6.2, TILE, wx, 3.1, 0, 0x5f5866));
        parts.push(bx(0.9, 0.4, TILE, wx, 6.3, 0, 0x453f4e));
        // Fly-posted panels: the only colour on this leg, and deliberately grim.
        const tags = [0x7a1030, 0x2b6e6a, 0x6a4f8a, 0x8a6a1f];
        for (let i = 0; i < 4; i++) {
          parts.push(bx(0.12, 1.6 + (i % 2) * 0.8, 3.4, wx - sx * 0.4,
            1.6 + (i % 3) * 1.1, -TILE / 2 + 3 + i * 6, tags[(i + (sx > 0 ? 1 : 0)) % 4]));
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
      const g = new THREE.PlaneGeometry(1.95, 16, 1, 16);
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
      bx(2.24, 0.66, 1.04, 0, 0.33, 0, 0xffb020),
      bx(2.34, 0.14, 1.04, 0, 0.73, 0, 0xfff2e0),
      bx(0.30, 0.80, 1.04, -1.16, 0.40, 0, 0xe07f12),
      bx(0.30, 0.80, 1.04, 1.16, 0.40, 0, 0xe07f12),
    ]);

    const jumpPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(jumpGeo, mats.propLit, S.INK.hazard));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.62), faceMat.jump);
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
      bx(2.30, 0.30, 0.60, 0, 1.56, 0, 0x37d6ff),
      bx(2.36, 0.12, 0.62, 0, 1.77, 0, 0xd8f8ff),
      bx(0.26, 3.30, 0.30, -1.20, 1.65, 0, 0x37d6ff),
      bx(0.26, 3.30, 0.30, 1.20, 1.65, 0, 0x37d6ff),
      bx(0.30, 0.26, 0.34, -1.20, 2.35, 0, 0x0d2b36),
      bx(0.30, 0.26, 0.34, 1.20, 2.35, 0, 0x0d2b36),
      bx(0.30, 0.26, 0.34, -1.20, 2.90, 0, 0x0d2b36),
      bx(0.30, 0.26, 0.34, 1.20, 2.90, 0, 0x0d2b36),
      bx(0.40, 0.22, 0.40, -1.20, 3.41, 0, 0xd8f8ff),
      bx(0.40, 0.22, 0.40, 1.20, 3.41, 0, 0xd8f8ff),
      bx(0.50, 0.22, 0.50, -1.20, 0.11, 0, 0x2b2f52),
      bx(0.50, 0.22, 0.50, 1.20, 0.11, 0, 0x2b2f52),
    ]);

    const duckPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(duckGeo, mats.propLit, S.INK.hazard));
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.26, 0.40), faceMat.duck);
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
      bx(2.10, 2.30, 1.30, 0, 1.50, 0, 0xff3b6b),
      bx(2.20, 0.44, 1.30, 0, 0.22, 0, 0x2b2f52),
      bx(2.24, 0.26, 1.34, 0, 2.24, 0, 0xfff2e0),
      bx(2.20, 0.20, 1.34, 0, 2.70, 0, 0xd42a55),
      bx(0.34, 0.34, 0.34, -0.72, 2.92, 0, 0xffe45e),
      bx(0.34, 0.34, 0.34, 0.72, 2.92, 0, 0xffe45e),
    ]);

    const blockPool = Pool(function () {
      const g = new THREE.Group();
      const body = S.outlined(blockGeo, mats.propLit, S.INK.hazard);
      g.add(body);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.06, 1.9), faceMat.block);
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

    /**
     * Rival runners. They live on the road but outside the three lanes, so the
     * player can be passing bodies all race without any chance of a phantom
     * collision. They drift forward at a slower pace than the player, which is
     * what makes overtaking read as overtaking rather than as scenery.
     */
    function rivalGeo(vest, skin, shorts) {
      return merge([
        bx(0.24, 0.14, 0.34, -0.16, 0.07, 0.02, 0xfff2e0),
        bx(0.24, 0.14, 0.34, 0.16, 0.07, -0.02, 0xfff2e0),
        bx(0.20, 0.62, 0.20, -0.16, 0.45, 0, skin),
        bx(0.20, 0.62, 0.20, 0.16, 0.45, 0, skin),
        bx(0.50, 0.34, 0.30, 0, 0.90, 0, shorts),
        bx(0.52, 0.52, 0.32, 0, 1.32, 0, vest),
        bx(0.14, 0.50, 0.14, -0.33, 1.28, 0.06, skin, 0.45),
        bx(0.14, 0.50, 0.14, 0.33, 1.28, -0.06, skin, -0.45),
        bx(0.30, 0.30, 0.28, 0, 1.72, 0, skin),
        bx(0.32, 0.14, 0.30, 0, 1.87, 0, 0x3a2b46),
        bx(0.26, 0.16, 0.02, 0, 1.30, 0.17, 0xfffdf5),
      ]);
    }
    const rivalGeos = [
      rivalGeo(0x37d6ff, 0xffc79a, 0x2b2f52),
      rivalGeo(0xffe45e, 0xb87a4e, 0x1b1633),
      rivalGeo(0x59d47a, 0xe0a173, 0x2b2f52),
      rivalGeo(0xff9ad5, 0x8a5a3c, 0x1b1633),
    ];
    const rivalPool = rivalGeos.map((geo) => Pool(function () {
      return S.outlined(geo, mats.propLit, S.INK.character);
    }, group));

    /** Aid station: trestle table, cups, and a volunteer holding one out. */
    const stationGeo = merge([
      bx(2.6, 0.12, 0.9, 0, 0.86, 0, 0xfff2e0),
      bx(0.12, 0.86, 0.12, -1.15, 0.43, -0.32, 0x2b2f52),
      bx(0.12, 0.86, 0.12, 1.15, 0.43, -0.32, 0x2b2f52),
      bx(0.12, 0.86, 0.12, -1.15, 0.43, 0.32, 0x2b2f52),
      bx(0.12, 0.86, 0.12, 1.15, 0.43, 0.32, 0x2b2f52),
      bx(2.7, 0.5, 0.06, 0, 0.55, -0.48, 0x37d6ff),
      cyl(0.09, 0.07, 0.16, 6, -0.9, 1.0, 0.1, 0xfffdf5),
      cyl(0.09, 0.07, 0.16, 6, -0.6, 1.0, -0.1, 0xfffdf5),
      cyl(0.09, 0.07, 0.16, 6, -0.3, 1.0, 0.15, 0xfffdf5),
      cyl(0.09, 0.07, 0.16, 6, 0.05, 1.0, -0.05, 0xfffdf5),
      cyl(0.09, 0.07, 0.16, 6, 0.4, 1.0, 0.12, 0xfffdf5),
      cyl(0.09, 0.07, 0.16, 6, 0.75, 1.0, -0.12, 0xfffdf5),
      bx(0.44, 0.60, 0.28, 0.05, 1.30, -0.85, 0xffe45e),
      bx(0.30, 0.66, 0.22, 0.05, 0.66, -0.85, 0x2b2f52),
      bx(0.26, 0.26, 0.24, 0.05, 1.72, -0.85, 0xffc79a),
      bx(0.12, 0.46, 0.12, -0.24, 1.34, -0.70, 0xffc79a, 0, 0, 0.9),
    ]);
    const stationPool = Pool(function () {
      return S.outlined(stationGeo, mats.prop, S.INK.prop);
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
     * beyond the pooled shoulders (which reach |x| = 34.4) so the two never
     * fight over the same ground.
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

    // ---- mile banners ---------------------------------------------------
    // A banner is a gantry, not a floating card: legs, a truss, a lit header
    // and a stripe painted across the road so the moment of passing it is
    // marked on the ground as well as overhead.
    const bannerFrameGeo = (function () {
      const parts = [];
      for (const sx of [-1, 1]) {
        parts.push(bx(0.42, 6.0, 0.42, sx * 5.6, 3.0, 0, 0x2b2f52));
        parts.push(bx(0.90, 0.30, 0.90, sx * 5.6, 0.15, 0, 0x1b1633));
        parts.push(bx(0.30, 0.30, 1.8, sx * 5.6, 5.4, 0, 0x2b2f52, 0, 0, 0));
      }
      parts.push(bx(11.6, 0.40, 0.40, 0, 5.95, 0, 0x2b2f52));
      parts.push(bx(11.6, 0.30, 0.30, 0, 3.65, 0, 0x2b2f52));
      for (let i = -4; i <= 4; i++) {
        parts.push(bx(0.16, 2.4, 0.16, i * 1.25, 4.8, 0, 0x3a4570, 0, 0, i % 2 ? 0.45 : -0.45));
      }
      parts.push(part(new THREE.PlaneGeometry(K.TRACK_HALF_WIDTH * 2, 0.7), 0xfffdf5, 0, 0.011, 0, -Math.PI / 2));
      return merge(parts);
    })();

    const bannerPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(bannerFrameGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 2.1), mat);
      panel.position.y = 4.78; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(10.6, 2.1), mat);
      back.position.y = 4.78;
      g.add(back);
      g.userData.panel = panel;
      g.userData.mat = mat;
      return g;
    }, group);

    // Start and finish get a heavier arch with a checker band.
    const checkTex = checkerTexture();
    const archGeo = merge([
      bx(1.5, 9.0, 1.5, -7.4, 4.5, 0, 0xff3b6b),
      bx(1.5, 9.0, 1.5, 7.4, 4.5, 0, 0xff3b6b),
      bx(2.3, 0.6, 2.3, -7.4, 0.3, 0, 0x1b1633),
      bx(2.3, 0.6, 2.3, 7.4, 0.3, 0, 0x1b1633),
      bx(17.2, 1.3, 1.6, 0, 8.7, 0, 0xff3b6b),
      bx(17.2, 0.5, 1.2, 0, 6.2, 0, 0xd42a55),
      bx(0.9, 4.2, 0.9, -6.2, 10.9, 0, 0x2b2f52),
      bx(0.9, 4.2, 0.9, 6.2, 10.9, 0, 0x2b2f52),
      bx(2.6, 1.8, 0.12, -5.0, 12.4, 0, 0xffe45e),
      bx(2.6, 1.8, 0.12, 5.0, 12.4, 0, 0xffe45e),
    ]);
    const archPool = Pool(function () {
      const g = new THREE.Group();
      g.add(S.outlined(archGeo, mats.prop, S.INK.banner));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 2.4), mat);
      panel.position.y = 7.45; panel.rotation.y = Math.PI;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 2.4), mat);
      back.position.y = 7.45;
      g.add(back);
      const band = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 0.55), new THREE.MeshBasicMaterial({ map: checkTex }));
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
        if (look.bank === side && kind !== 'crowd' && kind !== 'rival') side = -side;
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
      }
      if (b.name === 'FINAL MILE') {
        for (let z = b.from; z < K.TOTAL_UNITS + 30; z += TILE) {
          structures.push({ z, kind: 'stand', side: -1 });
          structures.push({ z, kind: 'stand', side: 1 });
        }
      }
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
      biome: null,
      look: BIOME_LOOK['CITY START'],
    };

    const activeGates = [];   // { gate, objs:[] }
    const activeScene = [];   // { s, obj }
    const activeStruct = [];  // { st, obj }
    const activeBanner = [];  // { b, obj }
    const activeRoad = [];    // { z, obj }
    const activeRivals = [];  // { obj, z, speed, phase }

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
      if (s.kind === 'station') return stationPool;
      if (s.kind === 'grove') return grovePool[Math.floor(s.b * grovePool.length) % grovePool.length];
      if (s.kind === 'crowd') return crowdPool[Math.floor(s.a * crowdPool.length) % crowdPool.length];
      return null;   // rivals live in their own list
    }
    function structPool(kind) {
      if (kind === 'tower') return towerPool;
      if (kind === 'abut') return abutPool;
      if (kind === 'river') return riverPool;
      if (kind === 'overpass') return overpassPool;
      if (kind === 'stand') return standPool;
      if (kind === 'arch') return archPool;
      return null;
    }

    const api = { group, sky, mats, course };

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
      // Hills take the ground hue knocked back toward the fog, so they read as
      // the same land seen through a lot of air.
      hillsMat.color.copy(mats.shoulder.color).lerp(api.fogColor, 0.45);
      sky.material.uniforms.top.value.copy(lerpInto(_skyTop, prev.sky[0], look.sky[0], t));
      sky.material.uniforms.bottom.value.copy(lerpInto(_skyBot, prev.sky[1], look.sky[1], t));

      state.biome = b;
      state.look = look;
      lerpInto(api.fogColor, prev.fog, look.fog, t);
      return b;
    };

    /**
     * Advance the spawn window. `z` is the runner's distance along the course
     * in world units; the world itself does not move, the camera does.
     */
    api.update = function (z) {
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
        if (s.kind === 'rival') {
          const pool = rivalPool[Math.floor(s.a * rivalPool.length) % rivalPool.length];
          const obj = pool.claim();
          obj.userData.pool = pool;
          // Just outside the outermost lane but still on the tarmac. A hazard
          // in lane 0 or 2 reaches x = 3.47, so 3.9 is the first honest slot.
          obj.position.set(s.side * (3.90 + s.b * 0.40), 0, s.z);
          activeRivals.push({
            obj, z: s.z,
            speed: 15 + s.c * 5,   // slower than the player: they get passed
            phase: s.a * 6.3,
          });
          continue;
        }
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
        } else if (s.kind === 'station') {
          obj.position.set(s.side * (K.TRACK_HALF_WIDTH + 2.4), 0, s.z);
          obj.rotation.y = s.side > 0 ? Math.PI : 0;
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

      // rivals -- they move, so their release test reads the live position
      for (let i = activeRivals.length - 1; i >= 0; i--) {
        const r = activeRivals[i];
        r.z += r.speed * 0.016;
        r.obj.position.z = r.z;
        // Cheap run cycle: a bob and a matching roll sell stride at speed.
        const ph = now * 5.5 + r.phase;
        r.obj.position.y = Math.abs(Math.sin(ph)) * 0.09;
        r.obj.rotation.z = Math.sin(ph * 2) * 0.035;
        r.obj.rotation.x = -0.09;
        if (r.z < back) {
          r.obj.userData.pool.release(r.obj);
          activeRivals.splice(i, 1);
        }
      }

      // biome set pieces
      while (state.structIdx < structures.length && structures[state.structIdx].z < ahead) {
        const st = structures[state.structIdx++];
        const pool = structPool(st.kind);
        if (!pool) continue;
        const obj = pool.claim();
        obj.position.set(0, 0, st.z);
        obj.rotation.y = 0;
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

      api.applyBiome(Math.min(1, z / K.TOTAL_UNITS));
    };

    api.reset = function () {
      roadPool.releaseAll(); jumpPool.releaseAll(); duckPool.releaseAll();
      blockPool.releaseAll(); buildingPool.releaseAll(); treePool.releaseAll();
      stationPool.releaseAll(); bannerPool.releaseAll(); archPool.releaseAll();
      towerPool.releaseAll(); abutPool.releaseAll(); riverPool.releaseAll();
      overpassPool.releaseAll(); standPool.releaseAll();
      for (const p of crowdPool) p.releaseAll();
      for (const p of rivalPool) p.releaseAll();
      for (const p of grovePool) p.releaseAll();
      activeGates.length = 0; activeScene.length = 0; activeStruct.length = 0;
      activeBanner.length = 0; activeRoad.length = 0; activeRivals.length = 0;
      state.roadFrom = 0; state.gateIdx = 0; state.sceneIdx = 0;
      state.structIdx = 0; state.bannerIdx = 0;
    };

    api.stats = function () {
      return {
        gates: activeGates.length,
        scenery: activeScene.length,
        structures: activeStruct.length,
        rivals: activeRivals.length,
        road: activeRoad.length,
      };
    };

    return api;
  }

  return { create, VIEW, BEHIND, BIOME_LOOK };
})();
