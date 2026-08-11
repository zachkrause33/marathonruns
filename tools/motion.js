#!/usr/bin/env node
/**
 * THE MOTION ASSERTION. What moves, how fast, and whether it is allowed to.
 *
 *   node tools/motion.js                    the default sweep
 *   node tools/motion.js --skip 110         one point in the race
 *   node tools/motion.js --frames 90        how many frames to pump
 *   node tools/motion.js --list             print every mover it found
 *
 * ---- WHY THIS FILE EXISTS -------------------------------------------------
 *
 * tools/shoot.js fails the build on LOW, HIDES, BLANKS and PAINTS, and on
 * hazard contrast. Every one of those runs on a SINGLE FRAME. So the entire
 * fairness harness of this game is blind to motion by construction, and the
 * moment anything in the periphery starts moving that blindness stops being
 * theoretical: movement in the periphery is exactly what pulls attention off
 * the thing that ends a run, and one contact ends a record attempt.
 *
 * The rule this project already had -- "a hazard the player could not see is
 * the game taking a streak for something outside their control" -- has a
 * second half that nothing was checking: a hazard the player DID see but did
 * not look at, because something moved beside it. This file is the instrument
 * for that half.
 *
 * ---- HOW IT DRIVES THE PAGE ----------------------------------------------
 *
 * A still cannot answer any of this, so the clock is pumped by hand, the same
 * way tools/stride.js poses the rig frame by frame:
 *
 *   1. requestAnimationFrame is replaced with a stub that CAPTURES the game's
 *      own frame callback instead of scheduling it.
 *   2. performance.now is replaced with a function returning our clock. This
 *      matters more than it looks: world.js takes its `now` from
 *      performance.now(), and the sky dome writes its OWN time uniform from
 *      performance.now() inside onBeforeRender -- so a tool that sets the
 *      uniform and then calls render() has the value overwritten under it and
 *      silently measures the same frame twice. That defect cost a whole round
 *      of cloud measurements before it was found, and every number it produced
 *      was flattering.
 *   3. The captured callback is invoked with successive timestamps.
 *
 * Everything below is then read off the LIVE scene graph between pumped
 * frames, so it is true of the shipped build rather than of a description of
 * it.
 *
 * ---- WHAT IT ASSERTS ------------------------------------------------------
 *
 * Movers are DISCOVERED, not declared. Every mesh in the world group is
 * measured in world space on frame N and frame N+1; anything whose bounding
 * box moved by more than MOVE_EPS is a mover. That is deliberate: a list of
 * things this file knows about would go out of date the day somebody animates
 * something new, which is the exact failure mode the roadmap records for the
 * corridor rule ("an assertion that passes tells you about the property it
 * tests and nothing else").
 *
 *   CORRIDOR  no mover may put geometry inside the play corridor below
 *             OVERHEAD_Y. Hazards, aid, the runner and the ghost are exempt
 *             and are meant to be there; everything else is scenery and
 *             scenery in the corridor is the defect LOW already fails on,
 *             checked here across frames instead of on one.
 *
 *   READBAND  no mover's screen rect may overlap the screen rect of a live
 *             hazard inside the read window (READ_NEAR out to SIGHT_MIN). A
 *             moving object at the same screen position as a gate is a worse
 *             problem than a static one at that position, because the eye is
 *             drawn to motion first -- so this is stricter than BLANKS, which
 *             only cares whether the gate is covered.
 *
 *   HUE       no mover may wear the hazard palette at hazard scale. Our
 *             contract is amber JUMP, cyan DUCK, pink BLOCK, carried on the
 *             mass that holds the silhouette. If background movement wears
 *             those hues the colour contract stops meaning anything, and that
 *             contract is what tools/shoot.js fails builds over.
 *
 * ---- WHAT IT REPORTS ------------------------------------------------------
 *
 * Every mover's world speed in units/s and its screen speed in px/s, so the
 * numbers written into comments in world.js and shading.js are checkable
 * rather than remembered. A number nobody re-measures is the thing this
 * project's roadmap is a list of.
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

const FILE = arg('file', path.join(ROOT, 'index.html'));
const FRAMES = parseInt(arg('frames', 60), 10);
const W = parseInt(arg('w', 420), 10);
const H = parseInt(arg('h', 860), 10);
const LIST = has('list');
/**
 * --date, AND IT IS NOT A CONVENIENCE.
 *
 * This file pinned the query string, so every assertion it makes was made
 * against ONE COURSE out of 365 -- the default day. A setting only draws when
 * the day happens to place it, and a mover that belongs to a setting is
 * therefore invisible to this tool on all but the days that draw it.
 *
 * That is not hypothetical. The trains on Chicago's L are the only vehicles in
 * this game that drive, and CHICAGO owns a CITY START or RIVERSIDE leg -- the
 * only legs the viaduct runs on -- on 66 of 365 days. The default day is not
 * one of them, so without this flag the one class of motion the game has is
 * asserted on exactly never. tools/shoot.js has the same blind spot and it hid
 * a real LOW/HIDES failure in the quayside crane on the same legs.
 */
const DATE = arg('date', null);
// The sweep. One point per biome the course actually draws, so a green run
// means every leg was visited rather than the two the default shots land on.
const SKIPS = arg('skip', null) !== null
  ? [parseInt(arg('skip', 60), 10)]
  : [25, 60, 95, 110, 140, 178, 200, 230];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  let failures = 0;
  let pageErrors = 0;

  for (const SKIP of SKIPS) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('ERR ' + e.message.split('\n')[0]));
    page.on('console', (m) => {
      if (m.type() !== 'log' && !/deprecated|AudioContext/i.test(m.text())) {
        errs.push(m.type() + ' ' + m.text().slice(0, 140));
      }
    });
    await page.goto('file://' + FILE + '?bot=1&skip=' + SKIP
      + (DATE ? '&date=' + DATE : ''));
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(500);

    const out = await page.evaluate(async ({ FRAMES }) => {
      const g = MR.game;
      const K = MR.K;

      // ---- take the clock ------------------------------------------------
      let clockMs = performance.now();
      const realNow = performance.now.bind(performance);
      let captured = null;
      const realRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) { captured = cb; return 1; };
      // Let the game's own in-flight rAF land, so it hands us its frame fn.
      // POLLED, not a single guess: a fixed 60 ms wait captured the callback
      // on one skip in eight and reported "never captured" on the other seven,
      // because whether a real frame lands inside the window depends on how
      // busy swiftshader is that second. A tool whose pass rate depends on
      // machine load is not an instrument.
      for (let tries = 0; tries < 60 && !captured; tries++) {
        await new Promise((r) => realRAF(() => r()));
        await new Promise((r) => setTimeout(r, 16));
      }
      if (!captured) return { err: 'never captured the frame callback' };
      performance.now = function () { return clockMs; };

      const STEP = 1000 / 60;
      const pump = () => { clockMs += STEP; captured(clockMs); };

      // ---- world-space census of every drawn mesh ------------------------
      const envOf = new Map();
      const objOf = new Map();
      const runnerRoot = (g.runner && g.runner.group) || null;
      const ghostRoot = (g.ghost && g.ghost.group) || null;
      const V = new THREE.Vector3();
      const BB = new THREE.Box3();
      // A SCHEMA GUARD, for the same reason gateBoxes() has one below. If
      // world.js stops publishing the envelope, this tool must stop rather
      // than quietly fall back to a guess: undefined arithmetic gives NaN,
      // every NaN comparison is false, and a box grown by NaN would disable
      // the CORRIDOR assertion instead of failing it.
      const ENVS = g.world.WAVE_ENVELOPE;
      if (!ENVS || typeof ENVS !== 'object' || !Object.keys(ENVS).length) {
        return { err: 'world.WAVE_ENVELOPE is not a chunk-keyed map -- motion.js needs updating' };
      }
      for (const k in ENVS) {
        for (const f of ['x', 'y', 'z']) {
          if (typeof ENVS[k][f] !== 'number' || !isFinite(ENVS[k][f]) || ENVS[k][f] < 0) {
            return { err: 'WAVE_ENVELOPE.' + k + ' has no finite ' + f + ' -- motion.js needs updating' };
          }
        }
      }
      function census() {
        const m = new Map();
        g.world.group.traverse((o) => {
          if (!o.isMesh || !o.visible) return;
          let p = o, hidden = false;
          while (p) { if (p.visible === false) { hidden = true; break; } p = p.parent; }
          if (hidden) return;
          if (!o.geometry || !o.geometry.attributes.position) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          BB.copy(o.geometry.boundingBox);
          // SHADER MOTION IS INVISIBLE TO A BOUNDING BOX, and this is the one
          // place that can be fixed rather than merely admitted. The crowd
          // wave, and the wind on foliage and cloth, displace vertices in the
          // VERTEX SHADER -- geometry.boundingBox never changes, so a census
          // like this one reports a stand full of jumping spectators, and a
          // whole avenue of swaying trees, as perfectly still. Where a geometry
          // carries aWave, the box is grown by the swept volume, so CORRIDOR is
          // testing where the shader can actually put the vertex rather than
          // the rest pose.
          //
          // THE ENVELOPE IS READ OFF THE PAGE, NOT COPIED INTO THIS FILE, and
          // that change fixed a live defect. This tool shipped with 0.79 for
          // the vertical, derived by hand from WAVE_CHUNK as "0.30*exc +
          // 0.31*|b|" -- but the second coefficient is (0.05 + 0.26*exc), which
          // at the exc cap of 1.55 is 0.453, not 0.31. The real crowd envelope
          // is 0.918. The instrument was growing the box by 86% of the volume
          // it claimed to test, and it erred in the flattering direction, which
          // is the exact failure mode this project's roadmap is a list of. A
          // constant that lives in one file and is re-derived by hand in
          // another will go stale; this one now cannot.
          const aw = o.geometry.attributes.aWave;
          let waveAmp = 0;
          if (aw) {
            // WHICH envelope, not the largest one. The material names the
            // chunk it was built with; a mesh carrying aWave under a material
            // that does not animate is not moving and must not be grown.
            const vc = o.material && o.material.userData && o.material.userData.vertexChunk;
            const env = vc && ENVS[vc.key];
            if (vc && !env) throw new Error('no WAVE_ENVELOPE for chunk ' + vc.key);
            if (env) {
              let amp = 0;
              for (let i = 0; i < aw.count; i++) amp = Math.max(amp, aw.getY(i));
              waveAmp = amp;
              envOf.set(o.uuid, env);
              if (amp > 0) {
                BB.min.y -= amp * env.y; BB.max.y += amp * env.y;
                BB.min.x -= amp * env.x; BB.max.x += amp * env.x;
                BB.min.z -= amp * env.z; BB.max.z += amp * env.z;
              }
            }
          }
          BB.applyMatrix4(o.matrixWorld);
          if (!isFinite(BB.min.x) || !isFinite(BB.max.x)) return;
          let name = null, q = o, exempt = false;
          // THE EXEMPTION HAS TO WALK THE WHOLE CHAIN. A hazard is
          // group > variant > outlined > mesh, and notScenery is on the group,
          // so a check that looked one level up exempted nothing that mattered
          // and the tool failed CORRIDOR and READBAND on the hazards
          // themselves -- the objects the corridor exists FOR.
          while (q) {
            if (q.userData) {
              if (!name && q.userData.auditName) name = q.userData.auditName;
              if (q.userData.notScenery) exempt = true;
            }
            if (q === runnerRoot || q === ghostRoot) { exempt = true; if (!name) name = (q === runnerRoot ? 'the runner' : 'the ghost'); }
            q = q.parent;
          }
          objOf.set(o.uuid, o);
          m.set(o.uuid, {
            // Named so the report says what a thing IS. The pinned backdrop --
            // sky, hills, ground, ripples -- is the single most interesting
            // row in this tool's output, because it is the zero-parallax
            // layer, and calling it "unnamed" hid that.
            name: name || o.name || (exempt ? 'backdrop / pinned' : 'unnamed'),
            min: BB.min.toArray(), max: BB.max.toArray(),
            uuid: o.uuid,
            exempt,
            waveAmp,
          });
        });
        return m;
      }

      // Hazards are meant to be in the corridor and are meant to be looked at.
      // Everything the corridor rule already exempts is exempt here too, and
      // for the same reasons world.js gives at each exemption.
      function hazardish(name) {
        return /hazard|gate|aid|runner|ghost|shadow|road tile|finish|chute|tape|telegraph/i.test(name);
      }

      g.renderer.render(g.scene, g.cam.camera);
      const before = census();
      const camBefore = g.cam.camera.position.clone();
      for (let i = 0; i < FRAMES; i++) pump();
      g.renderer.render(g.scene, g.cam.camera);
      const after = census();
      const camAfter = g.cam.camera.position.clone();

      const dt = FRAMES * STEP / 1000;
      // How far the world scrolled under the player over the sample. Anything
      // that moved by close to this is simply world-fixed scenery seen from a
      // moving lens -- it is NOT a mover, and failing to subtract this is the
      // obvious way to get a tool that reports the whole scene as animated.
      const camDZ = camAfter.z - camBefore.z;

      const MOVE_EPS = 0.02;   // world units over the whole sample
      const movers = [];
      const reclaims = [];
      for (const [uuid, a] of before) {
        const b = after.get(uuid);
        if (!b) continue;                       // released or re-claimed
        if (a.name !== b.name) continue;        // pooled slot changed tenant
        // Centre displacement, with the camera's own travel taken out of z.
        const ax = (a.min[0] + a.max[0]) / 2, ay = (a.min[1] + a.max[1]) / 2, az = (a.min[2] + a.max[2]) / 2;
        const bx = (b.min[0] + b.max[0]) / 2, by = (b.min[1] + b.max[1]) / 2, bz = (b.min[2] + b.max[2]) / 2;
        // Size change means the pool re-scaled it; that is a claim, not motion.
        const sa = (a.max[0] - a.min[0]) + (a.max[1] - a.min[1]) + (a.max[2] - a.min[2]);
        const sb = (b.max[0] - b.min[0]) + (b.max[1] - b.min[1]) + (b.max[2] - b.min[2]);
        if (Math.abs(sa - sb) > 0.05 * Math.max(1, sa)) continue;
        const d = Math.hypot(bx - ax, by - ay, bz - az);
        if (d < MOVE_EPS) continue;
        // A POOLED SLOT HANDED TO A NEW TENANT IS NOT MOTION. Road tiles,
        // props and set pieces are claimed from pools keyed by z, so the same
        // mesh reappears 210 units up the road and a naive census reports it
        // at 288 units/s. Nothing in this game legitimately moves faster than
        // the lens does, so anything past twice the lens travel is a re-claim.
        // They are counted and printed rather than dropped silently -- a
        // filter nobody can see is how an instrument starts lying.
        if (d > Math.max(40, Math.abs(camDZ) * 2)) { reclaims.push(b.name); continue; }
        movers.push({
          name: b.name, uuid,
          dx: bx - ax, dy: by - ay, dz: bz - az,
          speed: d / dt,
          min: b.min, max: b.max,
          exempt: b.exempt,
        });
      }

      /**
       * SHADER MOVERS, which every assertion below was silently blind to.
       *
       * Movers above are discovered by watching a bounding box travel, and
       * vertex-shader animation never moves one -- it moves the vertices
       * inside it. So the crowd wave, from the day it shipped, and the wind on
       * every tree and pennant, were absent from this list entirely: CORRIDOR
       * saw them only because the box is GROWN above, and READBAND and HUE did
       * not see them at all. That is the gap this whole file exists to close,
       * left open in the one class of motion the game had most of.
       *
       * They enter with the SWEPT box, not the rest box, because that is where
       * the eye is drawn and it is what the assertions are about. Speed is not
       * fabricated for them: a peak vertex rate is not the same quantity as a
       * rigid body's speed and printing it in the same column would invite the
       * comparison. The baked amplitude is reported instead.
       */
      const isMover = new Set(movers.map((m) => m.uuid));
      for (const [uuid, b] of after) {
        if (!b.waveAmp || isMover.has(uuid)) continue;
        movers.push({
          name: b.name, uuid, dx: 0, dy: 0, dz: 0, speed: 0,
          min: b.min, max: b.max, exempt: b.exempt, shader: b.waveAmp,
        });
      }

      // ---- the assertions -------------------------------------------------
      const CH = g.world.CORRIDOR_HALF, OY = g.world.OVERHEAD_Y;
      const cam = g.cam.camera;
      cam.updateMatrixWorld(true);
      const camZ = cam.position.z;
      const READ_NEAR = 25.35;
      const SIGHT_MIN = 90;

      /**
       * A BOX TEST TO FIND CANDIDATES, THEN THE VERTICES TO CONVICT.
       *
       * Box3.applyMatrix4 transforms the eight corners of a LOCAL axis-aligned
       * box and re-bounds them, so for anything carrying a rotation the result
       * is the AABB of an AABB and is strictly larger than the object. The
       * claim site turns every tree through a random yaw, and that inflation
       * is worth up to three quarters of a unit: a PARKLAND tree whose nearest
       * vertex genuinely sits at x 4.40 reported a box edge at 3.68 and was
       * convicted of a corridor breach it does not commit.
       *
       * A false CORRIDOR failure is not a harmless over-strictness. This
       * assertion's whole job is to be believed, and one that cries wolf on
       * correct geometry is one somebody eventually switches off -- so the
       * cheap box stays as the filter and the expensive exact test decides.
       * Only candidates pay for it, which in a green run is nobody.
       */
      const P = new THREE.Vector3();
      function reallyInCorridor(m) {
        const o = objOf.get(m.uuid);
        if (!o) return { x: [m.min[0], m.max[0]], yMin: m.min[1] };
        const pos = o.geometry.attributes.position;
        const env = envOf.get(m.uuid);
        const aw = env ? o.geometry.attributes.aWave : null;
        let hit = null;
        for (let i = 0; i < pos.count; i++) {
          P.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
          // The swept interval of THIS vertex, not of the whole object.
          const a = aw ? aw.getY(i) : 0;
          const ex = a * (env ? env.x : 0), ey = a * (env ? env.y : 0);
          if (P.x - ex < CH && P.x + ex > -CH && P.y - ey < OY) {
            if (!hit || P.y - ey < hit.yMin) {
              hit = { x: [P.x - ex, P.x + ex], yMin: P.y - ey };
            }
          }
        }
        return hit;
      }
      const corridor = [];
      for (const m of movers) {
        if (m.exempt || hazardish(m.name)) continue;
        // Overlaps the corridor in x AND reaches below the overhead ceiling.
        if (!(m.min[0] < CH && m.max[0] > -CH && m.min[1] < OY)) continue;
        const hit = reallyInCorridor(m);
        if (!hit) continue;
        corridor.push({ name: m.name, x: [+hit.x[0].toFixed(2), +hit.x[1].toFixed(2)],
                        yMin: +hit.yMin.toFixed(2) });
      }

      /**
       * ---- SCREEN RECTS, AND THE TWO WAYS THIS USED TO BE WRONG ------------
       *
       * The rect this file hands READBAND used to be built like this:
       *
       *     for each of the 8 corners of the world AABB
       *       if its view z is above -0.1, SKIP IT
       *       else project it and grow the rect
       *
       * Both halves of that are defects, and they push in opposite directions,
       * so neither one is safe to leave in.
       *
       * 1. A CORNER DROPPED IS NOT A BOX CLIPPED. A box that straddles the
       *    near plane -- which every roadside prop does for the second or two
       *    it spends alongside the lens -- had its rear corners thrown away and
       *    its rect built from whatever was left. The kept corners sit within a
       *    hair of the near plane, where ndc = x / (near * tanHalf * aspect)
       *    runs away: a corner 0.1 units in front of the lens and 2.4 units to
       *    the side lands at ndc x -97. That is not a thing on screen. It is a
       *    point at the edge of the lens reported as though it were a wall
       *    across the frame, and it overlaps every gate in the read window.
       *    The recorded symptom of this tool -- ndc x [-97.66, -0.13] -- is
       *    that arithmetic and nothing else.
       *
       *    Dropping corners is ALSO flattering in the other axis: the true
       *    near-plane cross-section of the box is not represented at all, so
       *    a box whose clipped section reaches higher or wider than any of its
       *    surviving corners is reported smaller than it is.
       *
       *    The fix is to CLIP rather than to drop. The box is convex, so its
       *    image is the convex hull of the projections of (a) the corners in
       *    front of the near plane and (b) the points where its twelve edges
       *    cross that plane. Every one of those has w >= near, so nothing
       *    divides by a number approaching zero.
       *
       *    The plane is cam.near, read off the camera. -0.1 was a guess that
       *    happened to match a default and would have silently stopped
       *    matching the day the lens was re-cut.
       *
       * 2. AN AABB IS NOT AN OBJECT, and this is the defect that actually
       *    fires on today's course. Box3.applyMatrix4 re-bounds a rotated local
       *    box, so for anything the claim site turns through a random yaw the
       *    result is the AABB of an AABB; the wave envelope then grows it again
       *    in all three axes. reallyInCorridor already says this in full and
       *    already pays for the exact test -- CORRIDOR convicts on vertices --
       *    but READBAND was still convicting on the inflated box. Measured at
       *    skip 60: a PARKLAND tree reported a screen rect of ndc x
       *    [-0.71, -0.09] and clipped a BLOCK gate whose whole rect is
       *    [-0.10, -0.02], on a 0.01-wide sliver of pure inflation.
       *
       *    So the same discipline applies here: THE BOX PROPOSES, THE GEOMETRY
       *    CONVICTS. boxRect is the cheap filter, meshRect is the verdict, and
       *    the count of proposals the geometry threw out is printed rather than
       *    swallowed -- a filter nobody can see is how an instrument starts
       *    lying, which is the same sentence the re-claim filter above earned.
       */
      const _cn = [];
      for (let i = 0; i < 8; i++) _cn.push(new THREE.Vector3());
      const _p4 = new THREE.Vector4();
      const _tmin = [0, 0, 0], _tmax = [0, 0, 0];

      function boxRect(min, max) {
        // The clip plane in VIEW z. A point exactly on it still projects, so
        // the pad only keeps w off the floor of the divide.
        const nz = -(cam.near + 1e-4);
        for (let i = 0; i < 8; i++) {
          _cn[i].set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2])
                .applyMatrix4(cam.matrixWorldInverse);
        }
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, any = false, near = -1e9;
        function take(vx, vy, vz) {
          _p4.set(vx, vy, vz, 1).applyMatrix4(cam.projectionMatrix);
          const nx = _p4.x / _p4.w, ny = _p4.y / _p4.w;
          if (!isFinite(nx) || !isFinite(ny)) return;
          x0 = Math.min(x0, nx); x1 = Math.max(x1, nx);
          y0 = Math.min(y0, ny); y1 = Math.max(y1, ny);
          near = Math.max(near, vz);            // least negative == closest
          any = true;
        }
        for (const c of _cn) if (c.z <= nz) take(c.x, c.y, c.z);
        // The twelve edges, each visited once: flip one bit of a corner index
        // upward. Only edges that CROSS the plane contribute a new point.
        for (let i = 0; i < 8; i++) {
          for (const bit of [1, 2, 4]) {
            const j = i | bit;
            if (j === i) continue;
            const a = _cn[i], b = _cn[j];
            if ((a.z <= nz) === (b.z <= nz)) continue;
            const t = (nz - a.z) / (b.z - a.z);
            take(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, nz);
          }
        }
        return any ? { x0, x1, y0, y1, near: -near } : null;
      }

      /**
       * The same rect, taken off the geometry the game actually draws.
       *
       * Triangle by triangle, each one as the box that contains its three
       * vertices SWEPT by their own wave envelope -- so a shader mover is
       * measured where the shader can put it, exactly as reallyInCorridor
       * measures it, and the near-plane clipping above is inherited for free.
       *
       * A per-triangle box is still an over-estimate of a triangle, so this
       * cannot hide a real overlap; it is simply thousands of times tighter
       * than one box around a whole tree. Only candidates pay for it.
       */
      function meshRect(m) {
        const o = objOf.get(m.uuid);
        if (!o || !o.geometry || !o.geometry.attributes.position) return boxRect(m.min, m.max);
        const pos = o.geometry.attributes.position;
        const idx = o.geometry.index;
        const env = envOf.get(m.uuid) || null;
        const aw = env ? o.geometry.attributes.aWave : null;
        const n = idx ? idx.count : pos.count;
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, any = false, near = 1e9;
        for (let t = 0; t + 2 < n; t += 3) {
          _tmin[0] = _tmin[1] = _tmin[2] = 1e9;
          _tmax[0] = _tmax[1] = _tmax[2] = -1e9;
          for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(t + k) : t + k;
            P.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi)).applyMatrix4(o.matrixWorld);
            const a = aw ? aw.getY(vi) : 0;
            const ex = a * (env ? env.x : 0), ey = a * (env ? env.y : 0), ez = a * (env ? env.z : 0);
            _tmin[0] = Math.min(_tmin[0], P.x - ex); _tmax[0] = Math.max(_tmax[0], P.x + ex);
            _tmin[1] = Math.min(_tmin[1], P.y - ey); _tmax[1] = Math.max(_tmax[1], P.y + ey);
            _tmin[2] = Math.min(_tmin[2], P.z - ez); _tmax[2] = Math.max(_tmax[2], P.z + ez);
          }
          const r = boxRect(_tmin, _tmax);
          if (!r) continue;
          x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1);
          y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1);
          near = Math.min(near, r.near);
          any = true;
        }
        return any ? { x0, x1, y0, y1, near } : null;
      }

      const gates = g.world.gateBoxes ? g.world.gateBoxes() : [];
      // THE FIRST VERSION OF THIS READ gt.hx AND gt.hz, WHICH DO NOT EXIST.
      // gateBoxes() returns halfX, z0 and z1. Undefined arithmetic gives NaN,
      // every NaN comparison is false, and the overlap test below is written
      // as a series of early-outs -- so a missing field did not disable the
      // assertion, it made it fire on EVERY pair. It reported five READBAND
      // failures against walkers and ships that are nowhere near a gate. A
      // schema guard is cheap; silently inverted assertions are not.
      for (const gt of gates) {
        for (const f of ['x', 'halfX', 'yMin', 'yMax', 'z0', 'z1', 'z']) {
          if (typeof gt[f] !== 'number' || !isFinite(gt[f])) {
            throw new Error('gateBoxes() has no numeric ' + f + ' -- motion.js needs updating');
          }
        }
      }
      /**
       * boxRect IS TESTED AGAINST A KNOWN ANSWER, EVERY RUN.
       *
       * READBAND only convicts when a box overlap is proposed, and on a green
       * course nothing proposes -- so a boxRect that returned null, or a
       * degenerate rect, would DISABLE the assertion and print exactly the
       * output a passing run prints. That is the failure mode this project's
       * corrections list is made of, and it would be invisible.
       *
       * A live gate in the read window is 25 to 90 units ahead, so all eight
       * corners of its box are in front of the near plane, no edge is clipped,
       * and the answer is therefore known: it is the plain projection of the
       * eight corners. boxRect must reproduce it exactly. If it cannot do the
       * easy case it is not to be believed on the hard one.
       */
      const bugEarly = [];
      const selfTest = { n: 0, worst: 0 };
      for (const gt of gates) {
        const d = gt.z - camZ;
        if (d < READ_NEAR || d > SIGHT_MIN) continue;
        const mn = [gt.x - gt.halfX, gt.yMin, gt.z0], mx = [gt.x + gt.halfX, gt.yMax, gt.z1];
        let nx0 = 1e9, nx1 = -1e9, ny0 = 1e9, ny1 = -1e9;
        for (let i = 0; i < 8; i++) {
          V.set(i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]).project(cam);
          nx0 = Math.min(nx0, V.x); nx1 = Math.max(nx1, V.x);
          ny0 = Math.min(ny0, V.y); ny1 = Math.max(ny1, V.y);
        }
        const r = boxRect(mn, mx);
        if (!r) { bugEarly.push('boxRect returned null for a gate ' + d.toFixed(1) + 'u ahead'); continue; }
        if (!(r.x1 > r.x0 && r.y1 > r.y0)) {
          bugEarly.push('boxRect returned a degenerate rect for a gate ' + d.toFixed(1) + 'u ahead');
          continue;
        }
        const err = Math.max(Math.abs(r.x0 - nx0), Math.abs(r.x1 - nx1),
                             Math.abs(r.y0 - ny0), Math.abs(r.y1 - ny1));
        selfTest.n++;
        selfTest.worst = Math.max(selfTest.worst, err);
        if (err > 1e-6) {
          bugEarly.push('boxRect disagrees with the plain projection of an unclipped gate box by '
            + err.toExponential(2));
        }
      }

      const readBand = [];
      /**
       * THE AUDIT TRAIL FOR THE TWO-STAGE TEST, and it is not optional.
       *
       * An exact test that quietly returned nothing would clear every proposal
       * and print a green run -- which is the precise shape of every defect in
       * this project's corrections list: the instrument flattering the thing it
       * measures. Two things guard against it and both are printed.
       *
       *   cleared   every proposal the geometry threw out, with BOTH rects, so
       *             the difference between them can be looked at rather than
       *             trusted.
       *   bug       the containment invariant. Each triangle's swept box is a
       *             subset of the object's swept box, and the image of a convex
       *             set under this projection is monotone under containment --
       *             so meshRect MUST lie inside boxRect. It must also exist
       *             whenever boxRect does. A violation is a defect in this
       *             file, not in the game, and it fails the run as loudly as a
       *             real overlap would.
       */
      let proposed = 0;
      const cleared = [];
      const bug = bugEarly;
      for (const gt of gates) {
        const d = gt.z - camZ;
        if (d < READ_NEAR || d > SIGHT_MIN) continue;
        const gr = boxRect([gt.x - gt.halfX, gt.yMin, gt.z0], [gt.x + gt.halfX, gt.yMax, gt.z1]);
        if (!gr) continue;
        for (const m of movers) {
          if (m.exempt || hazardish(m.name)) continue;
          const mr = boxRect(m.min, m.max);
          if (!mr) continue;
          if (mr.x1 < gr.x0 || mr.x0 > gr.x1 || mr.y1 < gr.y0 || mr.y0 > gr.y1) continue;
          // Only counts if the mover is actually IN FRONT of the gate; a car
          // behind a hazard is occluded by it and cannot distract from it.
          const mz = (m.min[2] + m.max[2]) / 2;
          if (mz > gt.z) continue;
          proposed++;
          // THE GEOMETRY CONVICTS. See the note on meshRect: the box around a
          // yawed, wind-swept tree is not the tree, and READBAND spent its
          // whole life failing on the difference.
          const er = meshRect(m);
          if (!er) {
            bug.push(m.name + ': boxRect returned a rect and meshRect returned none');
            continue;
          }
          const EPS = 1e-3;
          if (er.x0 < mr.x0 - EPS || er.x1 > mr.x1 + EPS
              || er.y0 < mr.y0 - EPS || er.y1 > mr.y1 + EPS) {
            bug.push(m.name + ': meshRect ' + [er.x0, er.x1, er.y0, er.y1].map((v) => v.toFixed(2)).join(',')
              + ' escapes boxRect ' + [mr.x0, mr.x1, mr.y0, mr.y1].map((v) => v.toFixed(2)).join(','));
          }
          if (er.x1 < gr.x0 || er.x0 > gr.x1 || er.y1 < gr.y0 || er.y0 > gr.y1) {
            cleared.push({ mover: m.name,
                           gate: 'kind ' + gt.kind + ' lane ' + gt.lane + ' at ' + d.toFixed(1) + 'u',
                           boxNdc: [+mr.x0.toFixed(2), +mr.x1.toFixed(2)],
                           meshNdc: [+er.x0.toFixed(2), +er.x1.toFixed(2)],
                           near: +er.near.toFixed(2) });
            continue;
          }
          readBand.push({ mover: m.name, gate: 'kind ' + gt.kind + ' lane ' + gt.lane + ' at ' + d.toFixed(1) + 'u',
                          moverNdc: [+er.x0.toFixed(2), +er.x1.toFixed(2)],
                          boxNdc: [+mr.x0.toFixed(2), +mr.x1.toFixed(2)],
                          moverNear: +er.near.toFixed(2),
                          gateNdc: [+gr.x0.toFixed(2), +gr.x1.toFixed(2)] });
        }
      }

      /**
       * AND meshRect IS EXERCISED EVERY RUN TOO, on the widest mover in frame.
       *
       * The self-test above proves boxRect. Nothing proves meshRect on a green
       * course, because it only runs on a proposal and a green course makes
       * none -- so a meshRect that returned a speck would clear every future
       * proposal and never be noticed. One call per skip, on the mover with the
       * largest box rect, prints what the geometry does to the box it came
       * from. A shrink of 1.0x forever is a broken exact test; a shrink of many
       * times over is the inflation READBAND used to convict on.
       */
      let tightest = null;
      {
        let widest = null, wa = 0;
        for (const m of movers) {
          if (m.exempt || hazardish(m.name)) continue;
          const r = boxRect(m.min, m.max);
          if (!r) continue;
          const a = (r.x1 - r.x0) * (r.y1 - r.y0);
          if (a > wa) { wa = a; widest = { m, r }; }
        }
        if (widest) {
          const er = meshRect(widest.m);
          if (er) {
            const ea = (er.x1 - er.x0) * (er.y1 - er.y0);
            tightest = { name: widest.m.name,
                         box: [+widest.r.x0.toFixed(2), +widest.r.x1.toFixed(2)],
                         mesh: [+er.x0.toFixed(2), +er.x1.toFixed(2)],
                         shrink: +(wa / Math.max(1e-9, ea)).toFixed(2) };
          } else {
            bugEarly.push(widest.m.name + ': meshRect returned nothing for the widest mover in frame');
          }
        }
      }

      // ---- hue ------------------------------------------------------------
      // The three hazard hues, in HSL degrees, with the tolerance the contrast
      // audit already treats as "the same family".
      const HAZ = [{ n: 'JUMP amber', h: 41 }, { n: 'DUCK cyan', h: 194 }, { n: 'BLOCK pink', h: 342 }];
      const hue = [];
      const seen = new Set();
      for (const m of movers) {
        if (m.exempt || hazardish(m.name)) continue;
        /**
         * HUE IS ABOUT THINGS THAT CAN CLOSE ON YOU, so it asks for a mover
         * that TRANSLATES and skips the shader class.
         *
         * The rule exists because background traffic in hazard colours makes
         * the colour contract meaningless -- the player reads amber, cyan and
         * pink as JUMP, DUCK and BLOCK and must not be made to check. What
         * makes an object mistakable for a gate is that it occupies or
         * approaches the lanes. A shader mover does neither by construction:
         * it oscillates about a fixed anchor outside the corridor, at a fixed
         * z, and CORRIDOR and READBAND above already test its full swept
         * volume for exactly that.
         *
         * The line is drawn deliberately rather than by convenience, and the
         * case that forced it is worth recording: the crowd wears BLOCK pink
         * over 18% of its area and JUMP amber over 7.6%. That is not a defect
         * to fix, it is the crowd -- every reference frame in this project has
         * a stand full of primary colour in it, and draining it to satisfy an
         * assertion would be the assertion driving the art. What the rule must
         * keep catching is a VEHICLE in hazard paint, and it still does.
         */
        if (m.shader) continue;
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        let obj = null;
        g.world.group.traverse((o) => { if (!obj && o.uuid === m.uuid) obj = o; });
        if (!obj) continue;
        // AREA-WEIGHTED, AND THAT IS THE WHOLE DIFFERENCE BETWEEN AN
        // ASSERTION AND A NUISANCE. The first version tested whether ANY
        // sampled vertex sat in a hazard hue, and it failed on a walker --
        // for their skin (h 25-30, which is where every human skin tone
        // lives) and for a 0.26-unit tan handbag at h 36. Neither is a thing
        // a player could mistake for a JUMP kerb.
        //
        // The contract the colour rule actually states is about "the mass
        // that carries the silhouette", so that is what gets measured: the
        // triangle area of every face in a hazard hue as a share of the
        // object's total area. A body panel fails; a bag does not.
        const pos = obj.geometry.attributes.position;
        const col = obj.geometry.attributes.color;
        const hsl = {};
        const c = new THREE.Color();
        const A = new THREE.Vector3(), Bv = new THREE.Vector3(), Cv = new THREE.Vector3();
        const share = new Map();
        let total = 0;
        if (col && pos) {
          for (let t = 0; t + 2 < pos.count; t += 3) {
            A.fromBufferAttribute(pos, t); Bv.fromBufferAttribute(pos, t + 1); Cv.fromBufferAttribute(pos, t + 2);
            Bv.sub(A); Cv.sub(A);
            const area = Bv.cross(Cv).length() * 0.5;
            if (!(area > 0)) continue;
            total += area;
            c.setRGB(col.getX(t), col.getY(t), col.getZ(t));
            c.getHSL(hsl);
            if (hsl.s < 0.45 || hsl.l < 0.25 || hsl.l > 0.80) continue;
            const deg = hsl.h * 360;
            for (const hz of HAZ) {
              let dd = Math.abs(deg - hz.h); if (dd > 180) dd = 360 - dd;
              if (dd < 14) {
                const key = hz.n + ' (' + deg.toFixed(0) + 'deg S' + hsl.s.toFixed(2) + ')';
                share.set(key, (share.get(key) || 0) + area);
              }
            }
          }
        }
        const bad = [];
        // 6% of an object's surface in one hazard family is a panel, not a
        // detail. Below that it cannot carry the silhouette at any distance
        // this game draws a background mover at.
        for (const [k, a] of share) if (total > 0 && a / total > 0.06) bad.push(k + ' ' + (100 * a / total).toFixed(1) + '% of area');
        if (bad.length) hue.push({ mover: m.name, hits: Array.from(new Set(bad)).slice(0, 3) });
      }

      // ---- screen speed, for the report ------------------------------------
      const report = [];
      const byName = new Map();
      for (const m of movers) {
        if (!byName.has(m.name)) byName.set(m.name, []);
        byName.get(m.name).push(m);
      }
      for (const [name, list] of byName) {
        if (list[0].shader) {
          const amp = list.reduce((s, m) => Math.max(s, m.shader), 0);
          report.push({ name, n: list.length, speed: 0, vx: 0, vz: 0,
                        head: 'shader wave, amp ' + amp.toFixed(2) });
          continue;
        }
        const sp = list.reduce((s, m) => s + m.speed, 0) / list.length;
        // MAGNITUDES, NOT SIGNED MEANS. Two ships passing in opposite
        // directions averaged to vz = 0.000 in the first version of this
        // report, i.e. the tool printed "not moving" for the exact case the
        // feature exists to produce. The heading split is printed instead.
        const azv = list.reduce((s, m) => s + Math.abs(m.dz), 0) / list.length / dt;
        const axv = list.reduce((s, m) => s + Math.abs(m.dx), 0) / list.length / dt;
        const fwd = list.filter((m) => m.dz > 0.001).length;
        const back = list.filter((m) => m.dz < -0.001).length;
        report.push({ name, n: list.length, speed: +sp.toFixed(3),
                      vx: +axv.toFixed(3), vz: +azv.toFixed(3),
                      head: fwd + '+/' + back + '-' });
      }
      report.sort((a, b) => b.speed - a.speed);

      performance.now = realNow;
      return { dt, camDZ: +camDZ.toFixed(2), movers: movers.length,
               corridor, readBand, hue, report, proposed, cleared, bug, selfTest, tightest,
               reclaims: Array.from(new Set(reclaims)),
               gates: gates.length };
    }, { FRAMES });

    const tag = 'skip ' + String(SKIP).padStart(3);
    if (out.err) { console.log(tag, 'ERR', out.err); failures++; await page.close(); continue; }
    console.log('=== ' + tag + ' === ' + out.movers + ' movers over ' + out.dt.toFixed(2)
      + 's, lens travelled ' + out.camDZ + 'u, ' + out.gates + ' live gates');
    if (out.reclaims.length) console.log('    (pool re-claims ignored: ' + out.reclaims.join(', ') + ')');
    {
      // PRINTED EVEN AT ZERO. "Nothing proposed" and "everything the box
      // proposed was cleared by the geometry" are different states of this
      // instrument, and a line that only appears in one of them is a line
      // that cannot be read.
      console.log('    (READBAND: ' + out.proposed + ' box overlaps proposed, '
        + out.readBand.length + ' survived the geometry'
        + '; boxRect self-test on ' + out.selfTest.n + ' unclipped gate boxes, worst error '
        + out.selfTest.worst.toExponential(1) + ')');
      if (out.tightest) {
        console.log('      widest mover ' + out.tightest.name + ': box ndc x '
          + JSON.stringify(out.tightest.box) + ' -> geometry ' + JSON.stringify(out.tightest.mesh)
          + ', ' + out.tightest.shrink + 'x tighter by area');
      }
      for (const c of (out.cleared || [])) {
        console.log('      cleared  ' + c.mover.padEnd(20) + ' vs ' + c.gate
          + ': box ndc x ' + JSON.stringify(c.boxNdc)
          + ' -> geometry ' + JSON.stringify(c.meshNdc) + ', nearest ' + c.near + 'u');
      }
    }
    for (const b of (out.bug || [])) {
      console.log('  FAIL INSTRUMENT  ' + b);
      failures++;
    }
    if (LIST || true) {
      for (const r of out.report) {
        console.log('    ' + r.name.padEnd(26) + ' x' + String(r.n).padEnd(3)
          + ' |v| ' + r.speed.toFixed(3).padStart(8) + ' u/s'
          + '   |vx| ' + r.vx.toFixed(3).padStart(7) + '  |vz| ' + r.vz.toFixed(3).padStart(7)
          + '  heading ' + r.head);
      }
    }
    for (const c of out.corridor) {
      console.log('  FAIL CORRIDOR  ' + c.name + ' spans x ' + JSON.stringify(c.x) + ' from y ' + c.yMin);
      failures++;
    }
    for (const r of out.readBand) {
      console.log('  FAIL READBAND  ' + r.mover + ' ndc x ' + JSON.stringify(r.moverNdc)
        + ' (nearest ' + r.moverNear + 'u, box said ' + JSON.stringify(r.boxNdc) + ')'
        + ' overlaps ' + r.gate + ' ndc x ' + JSON.stringify(r.gateNdc));
      failures++;
    }
    for (const h of out.hue) {
      console.log('  FAIL HUE       ' + h.mover + ' wears ' + h.hits.join(', '));
      failures++;
    }
    if (errs.length) { console.log('  PAGE ERRORS: ' + errs.join(' | ')); pageErrors += errs.length; }
    await page.close();
  }

  await browser.close();
  if (failures || pageErrors) {
    console.log('\nMOTION: ' + failures + ' assertion failures, ' + pageErrors + ' page errors');
    process.exit(1);
  }
  console.log('\nOK: nothing that moves enters the corridor, crosses the read window, or wears a hazard hue');
})();
