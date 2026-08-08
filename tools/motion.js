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
    await page.goto('file://' + FILE + '?bot=1&skip=' + SKIP);
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
      const runnerRoot = (g.runner && g.runner.group) || null;
      const ghostRoot = (g.ghost && g.ghost.group) || null;
      const V = new THREE.Vector3();
      const BB = new THREE.Box3();
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
          // wave, and anything else riding vwave(), displaces vertices in the
          // VERTEX SHADER -- geometry.boundingBox never changes, so a census
          // like this one reports a stand full of jumping spectators as
          // perfectly still. Where a geometry carries aWave, the box is grown
          // by the largest amplitude baked into it, so the CORRIDOR assertion
          // is testing the swept volume the shader can actually reach rather
          // than the rest pose. See WAVE_CHUNK in world.js for the terms; the
          // largest is 0.30*exc + 0.31*|b| with exc capped at 1.55, so 0.79
          // times amplitude vertically, and 0.085*exc laterally.
          const aw = o.geometry.attributes.aWave;
          if (aw) {
            let amp = 0;
            for (let i = 0; i < aw.count; i++) amp = Math.max(amp, aw.getY(i));
            if (amp > 0) {
              BB.min.y -= amp * 0.79; BB.max.y += amp * 0.79;
              BB.min.x -= amp * 0.14; BB.max.x += amp * 0.14;
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
          m.set(o.uuid, {
            // Named so the report says what a thing IS. The pinned backdrop --
            // sky, hills, ground, ripples -- is the single most interesting
            // row in this tool's output, because it is the zero-parallax
            // layer, and calling it "unnamed" hid that.
            name: name || o.name || (exempt ? 'backdrop / pinned' : 'unnamed'),
            min: BB.min.toArray(), max: BB.max.toArray(),
            uuid: o.uuid,
            exempt,
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

      // ---- the assertions -------------------------------------------------
      const CH = g.world.CORRIDOR_HALF, OY = g.world.OVERHEAD_Y;
      const cam = g.cam.camera;
      cam.updateMatrixWorld(true);
      const camZ = cam.position.z;
      const READ_NEAR = 25.35;
      const SIGHT_MIN = 90;

      const corridor = [];
      for (const m of movers) {
        if (m.exempt || hazardish(m.name)) continue;
        // Overlaps the corridor in x AND reaches below the overhead ceiling.
        if (m.min[0] < CH && m.max[0] > -CH && m.min[1] < OY) {
          corridor.push({ name: m.name, x: [+m.min[0].toFixed(2), +m.max[0].toFixed(2)],
                          yMin: +m.min[1].toFixed(2) });
        }
      }

      // Screen rects.
      function rect(min, max) {
        let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, anyFront = false;
        for (let i = 0; i < 8; i++) {
          V.set(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]);
          const wz = V.clone().applyMatrix4(cam.matrixWorldInverse).z;
          if (wz > -0.1) continue;              // behind the lens
          anyFront = true;
          V.project(cam);
          x0 = Math.min(x0, V.x); x1 = Math.max(x1, V.x);
          y0 = Math.min(y0, V.y); y1 = Math.max(y1, V.y);
        }
        return anyFront ? { x0, x1, y0, y1 } : null;
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
      const readBand = [];
      for (const gt of gates) {
        const d = gt.z - camZ;
        if (d < READ_NEAR || d > SIGHT_MIN) continue;
        const gr = rect([gt.x - gt.halfX, gt.yMin, gt.z0], [gt.x + gt.halfX, gt.yMax, gt.z1]);
        if (!gr) continue;
        for (const m of movers) {
          if (m.exempt || hazardish(m.name)) continue;
          const mr = rect(m.min, m.max);
          if (!mr) continue;
          if (mr.x1 < gr.x0 || mr.x0 > gr.x1 || mr.y1 < gr.y0 || mr.y0 > gr.y1) continue;
          // Only counts if the mover is actually IN FRONT of the gate; a car
          // behind a hazard is occluded by it and cannot distract from it.
          const mz = (m.min[2] + m.max[2]) / 2;
          if (mz > gt.z) continue;
          readBand.push({ mover: m.name, gate: 'kind ' + gt.kind + ' lane ' + gt.lane + ' at ' + d.toFixed(1) + 'u',
                          moverNdc: [+mr.x0.toFixed(2), +mr.x1.toFixed(2)],
                          gateNdc: [+gr.x0.toFixed(2), +gr.x1.toFixed(2)] });
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
               corridor, readBand, hue, report,
               reclaims: Array.from(new Set(reclaims)),
               gates: gates.length };
    }, { FRAMES });

    const tag = 'skip ' + String(SKIP).padStart(3);
    if (out.err) { console.log(tag, 'ERR', out.err); failures++; await page.close(); continue; }
    console.log('=== ' + tag + ' === ' + out.movers + ' movers over ' + out.dt.toFixed(2)
      + 's, lens travelled ' + out.camDZ + 'u, ' + out.gates + ' live gates');
    if (out.reclaims.length) console.log('    (pool re-claims ignored: ' + out.reclaims.join(', ') + ')');
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
