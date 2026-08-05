/**
 * The track and everything beside it.
 *
 * A marathon course is 6,293 world units long; instantiating it would mean
 * tens of thousands of meshes. Everything here is therefore pooled and
 * recycled around a moving window: road tiles, hazards, scenery and mile
 * banners are claimed as they enter VIEW ahead and released as they fall
 * behind BEHIND. Pool objects are reused in place, so steady-state allocation
 * is zero and the frame time does not sawtooth.
 *
 * Biomes recolour the shared materials rather than swapping meshes, which is
 * what lets the palette cross-fade over a mile instead of popping at a seam.
 */
MR.World = (function () {
  const K = MR.K;
  const S = MR.shading;
  const P = S.PALETTE;

  const VIEW = 210;      // spawn distance ahead of the runner
  const BEHIND = 34;     // release distance behind
  const TILE = 24;       // road tile length

  // ---- biome palettes ---------------------------------------------------
  const BIOME_LOOK = {
    'CITY START': { sky: [0x2b3fa8, 0x9fdcff], ground: 0x63c96b, road: 0x50557d, fog: 0x9fdcff },
    'RIVERSIDE': { sky: [0x1f6fb8, 0xbdf0ff], ground: 0x57c7a8, road: 0x4d5a80, fog: 0xbdf0ff },
    'THE BRIDGE': { sky: [0x3a4fc0, 0xffd9a8], ground: 0x4fa8c9, road: 0x5b5f88, fog: 0xffd9a8 },
    'PARKLAND': { sky: [0x2e8fd0, 0xcdf5c0], ground: 0x6fd46a, road: 0x53587f, fog: 0xcdf5c0 },
    'THE WALL': { sky: [0x8a3a6b, 0xffb27a], ground: 0x8f9a5e, road: 0x5a4f66, fog: 0xffb27a },
    'FINAL MILE': { sky: [0x24306e, 0xffcf6b], ground: 0x5cb46a, road: 0x4a4f78, fog: 0xffcf6b },
  };

  function lerpColor(a, b, t) {
    const c = new THREE.Color(a);
    return c.lerp(new THREE.Color(b), t);
  }

  /** Canvas-drawn label texture. Generated at runtime -- still no assets. */
  function labelTexture(text, bg, fg, w, h) {
    const c = document.createElement('canvas');
    c.width = w || 256; c.height = h || 128;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = fg;
    g.font = `900 ${Math.floor(c.height * 0.62)}px ui-sans-serif, system-ui, -apple-system, Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2 + c.height * 0.03);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
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
    const rnd = MR.rng.stream(course.key, 'scenery/v1');

    // Shared materials: recoloured per biome, never reallocated.
    const mats = {
      road: S.toon(P.road, 2),
      shoulder: S.toon(P.ground, 2),
      line: S.flat(P.laneLine),
      edge: S.flat(P.roadEdge),
    };

    // ---- sky + fog ------------------------------------------------------
    const sky = S.skyDome(900, P.skyTop, P.skyBot);
    group.add(sky);

    // Ground plane. The pooled shoulders are only 30 units wide, so without
    // this the terrain simply stopped and the sky dome showed through as a
    // hard band across the middle of the frame. It rides with the runner so a
    // finite plane can stand in for an infinite one, and it sits below the
    // road surface so the road always wins the depth test.
    const groundMat = S.toon(P.ground, 2);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.34;
    ground.renderOrder = -500;
    group.add(ground);
    mats.ground = groundMat;

    // ---- road tiles -----------------------------------------------------
    const roadGeo = new THREE.BoxGeometry(K.TRACK_HALF_WIDTH * 2, 0.5, TILE);
    const shoulderGeo = new THREE.BoxGeometry(30, 0.42, TILE);
    const lineGeo = new THREE.PlaneGeometry(0.14, TILE * 0.52);
    const edgeGeo = new THREE.PlaneGeometry(0.22, TILE);

    const roadPool = Pool(function () {
      const t = new THREE.Group();
      const road = new THREE.Mesh(roadGeo, mats.road);
      road.position.y = -0.25;
      t.add(road);

      for (const sx of [-1, 1]) {
        const sh = new THREE.Mesh(shoulderGeo, mats.shoulder);
        sh.position.set(sx * (K.TRACK_HALF_WIDTH + 15), -0.30, 0);
        t.add(sh);

        const ed = new THREE.Mesh(edgeGeo, mats.edge);
        ed.rotation.x = -Math.PI / 2;
        ed.position.set(sx * (K.TRACK_HALF_WIDTH - 0.14), 0.003, 0);
        t.add(ed);
      }
      // Dashed lane dividers.
      for (const lx of [-1.175, 1.175]) {
        const ln = new THREE.Mesh(lineGeo, mats.line);
        ln.rotation.x = -Math.PI / 2;
        ln.position.set(lx, 0.004, 0);
        t.add(ln);
      }
      return t;
    }, group);

    // ---- hazards --------------------------------------------------------
    const hazGeo = {
      jump: new THREE.BoxGeometry(1.95, 0.80, 1.05),
      duckBar: new THREE.BoxGeometry(2.30, 0.42, 0.60),
      duckPost: new THREE.BoxGeometry(0.16, 2.35, 0.20),
      block: new THREE.BoxGeometry(2.10, 2.80, 1.30),
    };
    const hazMat = {
      jump: S.toon(P.jump, 3),
      duck: S.toon(P.duck, 3),
      block: S.toon(P.block, 3),
      dark: S.toon(0x2b2f52, 2),
    };

    const jumpPool = Pool(function () {
      const g = new THREE.Group();
      const b = S.outlined(hazGeo.jump, hazMat.jump, S.INK.hazard);
      b.position.y = 0.40;
      g.add(b);
      // Chevron stripe so the "go over" read is instant.
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 0.20), S.flat(0x2b2f52));
      stripe.position.set(0, 0.58, 0.531);
      g.add(stripe);
      return g;
    }, group);

    const duckPool = Pool(function () {
      const g = new THREE.Group();
      const bar = S.outlined(hazGeo.duckBar, hazMat.duck, S.INK.hazard);
      bar.position.y = 1.62;
      g.add(bar);
      for (const sx of [-1, 1]) {
        const post = S.outlined(hazGeo.duckPost, hazMat.dark, S.INK.prop);
        post.position.set(sx * 1.10, 1.17, 0);
        g.add(post);
      }
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.12), S.flat(0x0d2b36));
      stripe.position.set(0, 1.62, 0.301);
      g.add(stripe);
      return g;
    }, group);

    const blockPool = Pool(function () {
      const g = new THREE.Group();
      const b = S.outlined(hazGeo.block, hazMat.block, S.INK.hazard);
      b.position.y = 1.40;
      g.add(b);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.30), S.flat(0xfff2e0));
      stripe.position.set(0, 2.15, 0.651);
      g.add(stripe);
      g.userData.body = b;
      return g;
    }, group);

    // ---- scenery --------------------------------------------------------
    const bldGeo = new THREE.BoxGeometry(1, 1, 1);
    const treeTrunk = new THREE.CylinderGeometry(0.16, 0.22, 1.1, 7);
    const treeTop = new THREE.ConeGeometry(1.05, 2.2, 8);

    const buildingPool = Pool(function () {
      const g = new THREE.Group();
      const b = S.outlined(bldGeo, S.toon(0xffffff, 2), S.INK.scenery);
      g.add(b);
      g.userData.body = b;
      return g;
    }, group);

    const treePool = Pool(function () {
      const g = new THREE.Group();
      const t = S.outlined(treeTrunk, S.toon(0x8a5a3c, 2), S.INK.prop);
      t.position.y = 0.55;
      const c = S.outlined(treeTop, S.toon(0x3fbf63, 2), S.INK.prop);
      c.position.y = 2.0;
      g.add(t, c);
      g.userData.crown = c;
      return g;
    }, group);

    // Crowd: capsule spectators in bright colours. Cheap, but the motion of a
    // lined course is most of what sells "race" over "obstacle corridor".
    const crowdGeo = new THREE.CapsuleGeometry(0.20, 0.44, 3, 7);
    const crowdPool = Pool(function () {
      const g = new THREE.Group();
      const m = S.outlined(crowdGeo, S.toon(0xffffff, 2), S.INK.prop);
      m.position.y = 0.52;
      g.add(m);
      g.userData.body = m;
      return g;
    }, group);

    // ---- mile banners ---------------------------------------------------
    const bannerPool = Pool(function () {
      const g = new THREE.Group();
      for (const sx of [-1, 1]) {
        const post = S.outlined(new THREE.BoxGeometry(0.24, 5.4, 0.24), S.toon(0x2b2f52, 2), S.INK.banner);
        post.position.set(sx * 5.0, 2.7, 0);
        g.add(post);
      }
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.5), S.flat(0xffffff));
      panel.position.y = 4.75;
      g.add(panel);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.5), S.flat(0xffffff));
      back.position.y = 4.75; back.rotation.y = Math.PI;
      g.add(back);
      g.userData.panel = panel;
      g.userData.back = back;
      return g;
    }, group);

    // ---------------------------------------------------------------------
    // Scenery layout is drawn once from the seeded stream so it is identical
    // for every player, then indexed by z for windowed spawning.
    const scenery = [];
    {
      let z = -60;
      while (z < K.TOTAL_UNITS + 120) {
        const side = rnd.chance(0.5) ? -1 : 1;
        const kind = rnd.weighted(['building', 'tree', 'crowd'], [1.0, 1.35, 2.2]);
        scenery.push({
          z, side, kind,
          x: side * rnd.range(7.5, 26),
          a: rnd.next(), b: rnd.next(), c: rnd.next(),
        });
        z += rnd.range(3.2, 9.0);
      }
      scenery.sort((p, q) => p.z - q.z);
    }

    const banners = course.mileMarkers.map((m) => ({ m, tex: null }));

    // ---- windowed spawn bookkeeping -------------------------------------
    const state = {
      roadFrom: 0,
      gateIdx: 0,
      sceneIdx: 0,
      bannerIdx: 0,
      biome: null,
      look: BIOME_LOOK['CITY START'],
    };

    const activeGates = [];   // { gate, objs:[] }
    const activeScene = [];   // { s, obj }
    const activeBanner = [];  // { b, obj }
    const activeRoad = [];    // { z, obj }

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

    const api = { group, sky, mats, course };

    /** Recolour shared materials for the biome at progress f. */
    api.applyBiome = function (f) {
      const b = MR.Course.biomeAt(f);
      const look = BIOME_LOOK[b.name] || BIOME_LOOK['CITY START'];

      // Cross-fade over the first 0.03 of a biome instead of popping.
      const idx = MR.Course.BIOMES.indexOf(b);
      const prev = idx > 0 ? BIOME_LOOK[MR.Course.BIOMES[idx - 1].name] : look;
      const t = Math.min(1, (f - b.from) / 0.03);

      mats.road.color.copy(lerpColor(prev.road, look.road, t));
      mats.shoulder.color.copy(lerpColor(prev.ground, look.ground, t));
      if (mats.ground) mats.ground.color.copy(mats.shoulder.color);
      sky.material.uniforms.top.value.copy(lerpColor(prev.sky[0], look.sky[0], t));
      sky.material.uniforms.bottom.value.copy(lerpColor(prev.sky[1], look.sky[1], t));

      state.biome = b;
      state.look = look;
      api.fogColor = lerpColor(prev.fog, look.fog, t);
      return b;
    };

    /**
     * Advance the spawn window. `z` is the runner's distance along the course
     * in world units; the world itself does not move, the camera does.
     */
    api.update = function (z) {
      const ahead = z + VIEW;
      const back = z - BEHIND;

      // Keep the ground under the runner; the sky dome likewise, so the
      // gradient never slides off as the race progresses.
      ground.position.z = z;
      sky.position.z = z;

      // road
      while (state.roadFrom * TILE < ahead) {
        const tz = state.roadFrom * TILE;
        const obj = roadPool.claim();
        obj.position.z = tz;
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
          if (kind === K.BLOCK && gate.train) {
            // Stretch a train along z rather than repeating blocks.
            const span = 1 + gate.train * 0.9;
            o.userData.body.scale.z = span;
            o.position.z = gate.z + (span - 1) * 0.65;
          } else if (kind === K.BLOCK) {
            o.userData.body.scale.z = 1;
          }
          objs.push(o);
        }
        activeGates.push({ gate, objs });
      }
      while (activeGates.length && activeGates[0].gate.z < back) {
        const g = activeGates.shift();
        for (let l = 0; l < 3; l++) if (g.objs[l]) releaseHazard(g.gate.lanes[l], g.objs[l]);
      }

      // scenery
      while (state.sceneIdx < scenery.length && scenery[state.sceneIdx].z < ahead) {
        const s = scenery[state.sceneIdx++];
        let obj;
        if (s.kind === 'building') {
          obj = buildingPool.claim();
          const w = 4 + s.a * 9, h = 6 + s.b * 26, d = 4 + s.c * 8;
          obj.userData.body.scale.set(w, h, d);
          obj.userData.body.userData.fill.material = obj.userData.body.userData.fill.material;
          obj.userData.body.userData.fill.material.color.set(P.building[Math.floor(s.a * P.building.length)]);
          obj.position.set(s.x + s.side * 14, h / 2, s.z);
        } else if (s.kind === 'tree') {
          obj = treePool.claim();
          const k = 0.75 + s.a * 0.7;
          obj.scale.setScalar(k);
          obj.userData.crown.userData.fill.material.color.set(s.b > 0.5 ? 0x3fbf63 : 0x59d47a);
          obj.position.set(s.x, 0, s.z);
        } else {
          obj = crowdPool.claim();
          obj.userData.body.userData.fill.material.color.setHSL(s.a, 0.72, 0.62);
          obj.position.set(s.side * (K.TRACK_HALF_WIDTH + 0.9 + s.b * 1.6), 0, s.z);
          obj.userData.bounce = s.c;
        }
        activeScene.push({ s, obj });
      }
      while (activeScene.length && activeScene[0].s.z < back) {
        const e = activeScene.shift();
        if (e.s.kind === 'building') buildingPool.release(e.obj);
        else if (e.s.kind === 'tree') treePool.release(e.obj);
        else crowdPool.release(e.obj);
      }

      // mile banners
      while (state.bannerIdx < banners.length && banners[state.bannerIdx].m.z < ahead) {
        const b = banners[state.bannerIdx++];
        if (!b.tex) {
          const finish = b.m.finish;
          b.tex = labelTexture(
            finish ? 'FINISH' : `MILE ${b.m.mile}`,
            finish ? '#ff3b6b' : '#1b1633',
            finish ? '#fffdf5' : '#ffe45e',
            512, 120
          );
        }
        const obj = bannerPool.claim();
        obj.position.z = b.m.z;
        obj.userData.panel.material.map = b.tex;
        obj.userData.panel.material.color.set(0xffffff);
        obj.userData.panel.material.needsUpdate = true;
        obj.userData.back.material = obj.userData.panel.material;
        activeBanner.push({ b, obj });
      }
      while (activeBanner.length && activeBanner[0].b.m.z < back) {
        bannerPool.release(activeBanner.shift().obj);
      }

      // Crowd idle: a cheap bob keeps the roadside alive without animation data.
      const t = performance.now() * 0.004;
      for (const e of activeScene) {
        if (e.s.kind !== 'crowd') continue;
        e.obj.position.y = Math.abs(Math.sin(t + e.obj.userData.bounce * 6.3)) * 0.16;
      }

      api.applyBiome(Math.min(1, z / K.TOTAL_UNITS));
    };

    api.reset = function () {
      roadPool.releaseAll(); jumpPool.releaseAll(); duckPool.releaseAll();
      blockPool.releaseAll(); buildingPool.releaseAll(); treePool.releaseAll();
      crowdPool.releaseAll(); bannerPool.releaseAll();
      activeGates.length = 0; activeScene.length = 0;
      activeBanner.length = 0; activeRoad.length = 0;
      state.roadFrom = 0; state.gateIdx = 0; state.sceneIdx = 0; state.bannerIdx = 0;
    };

    api.stats = function () {
      return {
        gates: activeGates.length,
        scenery: activeScene.length,
        road: activeRoad.length,
      };
    };

    return api;
  }

  return { create, VIEW, BEHIND, BIOME_LOOK };
})();
