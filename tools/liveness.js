#!/usr/bin/env node
/**
 * LIVENESS: what moves in the environment, how far in PIXELS, and what is dead.
 *
 *   node tools/liveness.js                     the default sweep
 *   node tools/liveness.js --skip 110          one point in the race
 *   node tools/liveness.js --date 2026-03-14   a named day (see --date below)
 *   node tools/liveness.js --list              every measured unit, not just the table
 *   node tools/liveness.js --top 30            how many dead units to rank
 *
 * ---- WHY THIS FILE EXISTS -------------------------------------------------
 *
 * tools/motion.js asks whether a mover is ALLOWED (corridor, read band, hue).
 * It is an assertion about fairness and it answers "is this legal". Nothing
 * asked the other question -- "is this THERE" -- and that is the question the
 * owner's brief is about: an environment can pass every fairness gate in the
 * game while being perceptually a photograph.
 *
 * The distinction is not academic. docs/roadmap.md records the wind shipping
 * once already at an amplitude that measured 0.55% of pixels changing over a
 * HUNDRED SECONDS -- about one pixel of travel -- and being caught only
 * because somebody thought to measure it. "Technically animated, perceptually
 * still" is the defect class, and a boolean "has an aWave attribute" cannot
 * see it. The unit of this file is therefore the PIXEL, at the framing the
 * chase camera actually uses, and never the world unit.
 *
 * ---- HOW IT MEASURES ------------------------------------------------------
 *
 * IT DOES NOT TRANSCRIBE THE SHADER. The obvious implementation replicates
 * WAVE_BODY and windBody() in JavaScript and projects the displaced vertices.
 * That was rejected: a transcription is a SECOND copy of the animation that
 * drifts from the first, and this project has already paid for exactly that
 * class of bug -- tools/motion.js grew its boxes by a hand-copied 0.79 when
 * the real envelope was 0.918, because somebody read (0.05 + 0.26*exc) and
 * did not evaluate it at the cap. Every number below comes off the GPU
 * running the shipped shader.
 *
 * So:
 *
 *   1. The page is booted at a skip, and rAF and performance.now are taken
 *      the way tools/motion.js takes them. The game is then NOT pumped. The
 *      world is frozen: the runner does not move, no tile is claimed or
 *      released, and performance.now returns a constant -- which matters,
 *      because the sky dome writes its own time uniform from performance.now
 *      inside onBeforeRender, so an unstubbed clock would drift the clouds
 *      under the measurement and every object would appear to move.
 *
 *   2. The ONLY thing advanced is world.waveClock -- the shared uT that both
 *      the crowd wave and the wind read. So a pixel that changes between two
 *      renders changed because of vertex animation and because of nothing
 *      else. This is the same isolation bd3eb03 had to invent when its first
 *      attempt pumped the game, pinned the runner, and reported 96% of the
 *      near band changing -- because pinning the runner does not pin the
 *      world.
 *
 *   3. Every drawable unit is isolated in turn (all others hidden), rendered
 *      at N phases, and read back INSIDE ITS OWN SCREEN BOX. From the phase
 *      stack it gets:
 *
 *        area    union of covered pixels -- how much of the frame it owns
 *        travel  peak-to-peak silhouette displacement in px, taken per row
 *                on the left and right edges and per column on the top edge,
 *                reported at the 90th percentile over edge samples
 *
 *      Silhouette edges rather than a centroid, and this is the one choice
 *      that decides whether the tool is honest. A centroid AVERAGES: a tree
 *      whose crown swings four pixels over a trunk that cannot move reports
 *      about one, because the rigid half of the object is in the mean. Since
 *      every wind amplitude in this game is cantilevered off part height --
 *      trunks, masts, posts and bunting wire are deliberately amplitude 0 --
 *      a centroid metric would have understated EVERY moving object in the
 *      game in proportion to how correctly it was authored.
 *
 *   4. A whole-frame diff across the same phases, for the headline figure
 *      that is comparable to the 0.55% the roadmap records.
 *
 * ---- WHAT COUNTS AS A UNIT ------------------------------------------------
 *
 * shading.js outlined() returns a Group holding a fill mesh and a back-face
 * ink shell over the SAME geometry, so every object in this game is two
 * meshes. A census that counted meshes would double every object and halve
 * every per-object area. Units are therefore those Groups, plus any bare mesh
 * that is not part of one.
 *
 * ---- DEFECTS IN THIS INSTRUMENT, KNOWN --------------------------------
 *
 * Stated because this project's rule is that the instrument gets the same
 * scrutiny as the work, and because every measuring tool written here so far
 * has been wrong first IN THE DIRECTION THAT FLATTERED ITS SUBJECT. Three of
 * these four understate motion and one overstates area; the bias of the file
 * as a whole is therefore AGAINST claiming things are alive, which is the
 * safe direction for its purpose.
 *
 *   1. ISOLATION REMOVES OCCLUSION.  A unit is rendered alone, so a crown
 *      that the street wall eats still reports its full area and travel. This
 *      OVERSTATES how much of a moving thing the player sees, and it is the
 *      one defect here biased toward flattery. It is deliberate: the same
 *      choice lets the tool distinguish "does not move" from "moves where
 *      nobody can see it", which are different bugs with different fixes.
 *      tools/canopy.js already measures the occlusion half for trees, and the
 *      whole-frame diff in step 4 is the un-isolated control -- if isolated
 *      travel is large and the frame diff is nil, occlusion is the story.
 *
 *   2. PHASE SAMPLING ALIASES, and always downward. Peak-to-peak from N
 *      samples of a sinusoid can only ever miss the true peak, never exceed
 *      it. The window and sample count are chosen PER MATERIAL off the
 *      frequency in its own vertexChunk key, so cloth at 1.80 Hz is not
 *      sampled on the tree's 0.45 Hz grid; worst case at the shipped rates is
 *      about 5% understated.
 *
 *   3. THE 90TH PERCENTILE HIDES A SMALL FAST PART. An object whose only
 *      moving element is 5% of its silhouette -- one flag on a mast -- has
 *      that motion sitting above the 90th percentile and reports near zero at
 *      p90. The max column is printed alongside for exactly this reason and
 *      the two should be read together; a large gap between them IS the
 *      signature of a mostly-rigid object with one moving part.
 *
 *   6. IT IS BLIND TO CPU TRANSFORM ANIMATION, for the same reason: the game
 *      is never pumped, so anything world.js moves by writing a position or a
 *      rotation inside api.update stands still here. That is the walkers
 *      (their lateral drift and bob), the hazard variants that pedal, wave,
 *      sway and lift, and the trains on the L. tools/motion.js is exactly the
 *      complement -- it pumps frames and discovers movers by bounding box, so
 *      it sees that class and is blind to this one. NEITHER TOOL ALONE
 *      ANSWERS "what moves". Before calling a leg dead, check both, and check
 *      userData.people for a live 'walkers' group.
 *
 *   5. IT SEES VERTEX ANIMATION AND NOTHING ELSE, and this is the biggest
 *      limit on the file. Freezing performance.now is what makes the
 *      measurement clean, and it also switches off every animation in the
 *      game that is driven by a scrolling texture rather than by a displaced
 *      vertex:
 *
 *        the cloud sheets    shading.js, written in the sky's onBeforeRender
 *        the river ripples   world.js rippleTex.offset, 1.90 units/s across
 *                            the deck, written inside api.update -- which a
 *                            frozen world never calls
 *        the road strip      stripTex.offset.y, the telegraph mat
 *
 *      So a leg reported at "0.00% frame-changed" has NO MOVING OBJECT in it;
 *      it does not follow that the frame is motionless, and on THE BRIDGE it
 *      demonstrably is not -- the water under it is scrolling the whole time.
 *      Read this file's figures as "how much of the scenery moves", never as
 *      "how much of the frame moves". Measuring the scroll layer needs a
 *      second instrument that advances performance.now while holding the
 *      simulation, and that is not this one.
 *
 *   4. SUB-PIXEL MOTION READS AS ZERO, but not quite: the silhouette edge is
 *      taken off an anti-aliased coverage threshold, so a half-pixel sway
 *      shows up as a fractional travel rather than nothing. It is still the
 *      floor of the instrument, and travel under ~0.3 px should be read as
 *      "no", not as a small number.
 *
 * ---- AND ONE DEFECT THAT WAS FOUND BY TRYING TO BREAK IT ------------------
 *
 * The static control. Every unit whose material carries no vertexChunk MUST
 * measure travel 0.00, because nothing in the frozen world can move it. That
 * is asserted, not assumed, and it is what catches the failure mode where the
 * tool itself is the source of the motion -- an unstubbed clock, a drifting
 * sky, a renderer with temporal dithering. The first run of this file failed
 * that control on every unit, which is how the performance.now stub above
 * came to be there: the sky's onBeforeRender was still reading the real
 * clock, and every "measurement" up to that point was of the clouds.
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
const W = parseInt(arg('w', 420), 10);
const H = parseInt(arg('h', 860), 10);
const LIST = has('list');
const TOP = parseInt(arg('top', 22), 10);
/**
 * --date, for the same reason tools/motion.js grew one: a setting only draws
 * on the days the course places it, so a tool pinned to the default day
 * asserts nothing about the legs that day does not visit.
 */
const DATE = arg('date', null);
// One point per biome the course draws, matching motion.js's sweep so the two
// tools are talking about the same eight places in the race.
const SKIPS = arg('skip', null) !== null
  ? [parseInt(arg('skip', 60), 10)]
  : [25, 60, 95, 110, 140, 178, 200, 230];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const all = [];
  let controlFailures = 0;
  let pageErrors = 0;

  for (const SKIP of SKIPS) {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    const errs = [];
    page.on('pageerror', (e) => errs.push('ERR ' + e.message.split('\n')[0]));
    await page.goto('file://' + FILE + '?bot=1&skip=' + SKIP + (DATE ? '&date=' + DATE : ''));
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(400);

    const out = await page.evaluate(async () => {
      const g = MR.game;
      const renderer = g.renderer;
      const scene = g.scene;
      const camera = g.cam.camera;

      // ---- take every clock ------------------------------------------------
      let clockMs = performance.now();
      const realRAF = window.requestAnimationFrame.bind(window);
      let captured = null;
      window.requestAnimationFrame = function (cb) { captured = cb; return 1; };
      for (let t = 0; t < 60 && !captured; t++) {
        await new Promise((r) => realRAF(() => r()));
        await new Promise((r) => setTimeout(r, 16));
      }
      if (!captured) return { err: 'never captured the frame callback' };
      // Let the world settle into a real frame, then freeze it. From here the
      // game is never pumped again: only waveClock moves.
      clockMs += 16; captured(clockMs);
      performance.now = function () { return clockMs; };

      const waveClock = g.world.waveClock;
      if (!waveClock || typeof waveClock.value !== 'number') {
        return { err: 'world.waveClock is not a uniform -- liveness.js needs updating' };
      }

      // ---- the unit census -------------------------------------------------
      // A unit is an outlined() Group (fill + ink over one geometry) or a bare
      // visible mesh that is not inside one.
      const units = [];
      (function walk(o, inUnit) {
        if (o.visible === false) return;
        const isUnit = !inUnit && o.isGroup && o.userData && o.userData.fill;
        if (isUnit) {
          units.push(o);
          for (const c of o.children) walk(c, true);
          return;
        }
        if (!inUnit && o.isMesh) { units.push(o); return; }
        for (const c of o.children) walk(c, inUnit);
      })(g.world.group, false);

      // Describe each unit: material animation contract, baked amplitude, and
      // the screen box of its projected vertices.
      const V = new THREE.Vector3();
      const info = units.map(function (u, idx) {
        const fill = u.userData && u.userData.fill ? u.userData.fill : u;
        const geo = fill.geometry;
        const mat = fill.material;
        const chunk = mat && mat.userData && mat.userData.vertexChunk;
        const aw = geo && geo.attributes && geo.attributes.aWave;
        let ampMax = 0, ampNz = 0, n = 0;
        if (aw) {
          n = aw.count;
          for (let i = 0; i < n; i++) {
            const a = aw.getY(i);
            if (a > ampMax) ampMax = a;
            if (a > 0) ampNz++;
          }
        }
        // Screen box off real projected vertices, not off the bounding box:
        // a bounding box projects to a rectangle that is never the silhouette.
        u.updateWorldMatrix(true, false);
        fill.updateWorldMatrix(true, false);
        const pos = geo && geo.attributes && geo.attributes.position;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, anyFront = false;
        if (pos) {
          const step = Math.max(1, Math.floor(pos.count / 400));
          for (let i = 0; i < pos.count; i += step) {
            V.fromBufferAttribute(pos, i).applyMatrix4(fill.matrixWorld).project(camera);
            if (V.z > 1 || V.z < -1) continue;
            anyFront = true;
            const sx = (V.x * 0.5 + 0.5) * innerWidth;
            const sy = (-V.y * 0.5 + 0.5) * innerHeight;
            if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
            if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
          }
        }
        // World-space identity, so a unit can be matched back to the builder
        // that made it without a name: nothing in this file is named, so size
        // + vertex count + distance is the only handle there is.
        if (!geo.boundingBox) geo.computeBoundingBox();
        const bb = geo.boundingBox.clone().applyMatrix4(fill.matrixWorld);
        const sz = bb.getSize(new THREE.Vector3());
        const ctr = bb.getCenter(new THREE.Vector3());
        const camPos = camera.getWorldPosition(new THREE.Vector3());
        return {
          idx,
          chunk: chunk ? chunk.key : null,
          ampMax, ampNzFrac: n ? ampNz / n : 0,
          verts: pos ? pos.count : 0,
          notScenery: !!(u.userData && u.userData.notScenery)
            || !!(fill.userData && fill.userData.notScenery),
          size: [+sz.x.toFixed(1), +sz.y.toFixed(1), +sz.z.toFixed(1)],
          ctr: [+ctr.x.toFixed(1), +ctr.y.toFixed(1), +ctr.z.toFixed(1)],
          dist: +ctr.distanceTo(camPos).toFixed(1),
          onScreen: anyFront && x1 > 0 && x0 < innerWidth && y1 > 0 && y0 < innerHeight,
          box: [x0, y0, x1, y1],
        };
      });

      // ---- phase plan, taken from the material's own key -------------------
      // Sampling grid is chosen off the frequency the material advertises, so
      // cloth is not sampled on the tree's grid. See defect 2 in the header.
      function planFor(key) {
        if (!key) return { span: 2.0, n: 2 };            // static control
        const m = /^wind\/([\d.]+)\//.exec(key || '');
        if (m) {
          const f = parseFloat(m[1]);                     // rad/s of the sway
          const period = 2 * Math.PI / f;
          return { span: period * 1.05, n: 20 };
        }
        // crowdwave: rates run 4.1 to 7.5 rad/s with per-figure jitter, so the
        // slowest period present is 2*pi/4.1 = 1.53 s.
        return { span: 1.60, n: 20 };
      }

      // ---- isolation ------------------------------------------------------
      const prevVis = units.map((u) => u.visible);
      const otherRoots = [];
      scene.traverse(function (o) {
        if (o === g.world.group) return;
      });
      const runnerG = g.runner && g.runner.group;
      const ghostG = g.ghost && g.ghost.group;
      const rVis = runnerG ? runnerG.visible : null;
      const gVis = ghostG ? ghostG.visible : null;

      function setAll(v) { for (const u of units) u.visible = v; }

      const gl = renderer.getContext();

      /**
       * COVERAGE HAS TO BE MADE MEASURABLE BEFORE IT CAN BE MEASURED.
       *
       * The first version thresholded the alpha channel of the readback and
       * reported every unit as covering its entire screen box, because the
       * page clears opaque: alpha came back 255 on background pixels too, so
       * "covered" was true everywhere and every area figure was the area of
       * the crop. It flattered every object in the frame by turning it into a
       * full-screen one.
       *
       * So the background is made genuinely empty for the duration: the scene
       * background is detached and the clear is set fully transparent. Both
       * are restored afterwards. And it is ASSERTED rather than assumed --
       * see the emptiness guard below, which renders nothing and requires the
       * frame to come back completely uncovered.
       */
      const prevBg = scene.background;
      const prevClear = renderer.getClearColor(new THREE.Color());
      const prevClearAlpha = renderer.getClearAlpha();
      scene.background = null;
      renderer.setClearColor(0x000000, 0);
      const restoreClear = function () {
        scene.background = prevBg;
        renderer.setClearColor(prevClear, prevClearAlpha);
      };

      // Read back a crop of the drawing buffer. WebGL's origin is bottom-left.
      function readCrop(bx, by, bw, bh) {
        const px = new Uint8Array(bw * bh * 4);
        gl.readPixels(bx, by, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      }

      const dpr = renderer.getPixelRatio();

      /**
       * Silhouette travel for one unit, in CSS pixels.
       *
       * Coverage is taken off the alpha channel of the isolated render, which
       * is exact: the clear is transparent, so any pixel the unit drew has
       * alpha above the threshold and nothing else does.
       */
      function measure(u, plan) {
        const inf = info[units.indexOf(u)];
        const b = inf.box;
        // Pad the box by the largest displacement any shipped chunk can
        // produce, projected generously, so a unit cannot sway out of its own
        // read window and report a clipped travel.
        const PAD = 24;
        const bx = Math.max(0, Math.floor((b[0] - PAD) * dpr));
        const by0 = Math.max(0, Math.floor((b[1] - PAD) * dpr));
        const bx1 = Math.min(gl.drawingBufferWidth, Math.ceil((b[2] + PAD) * dpr));
        const by1 = Math.min(gl.drawingBufferHeight, Math.ceil((b[3] + PAD) * dpr));
        const bw = bx1 - bx, bh = by1 - by0;
        if (bw <= 0 || bh <= 0) return null;
        // GL y is measured from the bottom.
        const glY = gl.drawingBufferHeight - by1;

        const covers = [];
        const t0 = waveClock.value;
        // Mean rendered colour of the covered pixels, taken at the first
        // phase. It is the colour AS SHIPPED -- after the toon ramp, the fog
        // and the setting tint -- which is the only colour a player can be
        // confused by. Authored hex is not that colour and comparing authored
        // hex is how a palette collision hides.
        let cr = 0, cg = 0, cb = 0, cn = 0;
        for (let i = 0; i < plan.n; i++) {
          waveClock.value = t0 + (i / plan.n) * plan.span;
          renderer.render(scene, camera);
          const px = readCrop(bx, glY, bw, bh);
          const cov = new Uint8Array(bw * bh);
          for (let k = 0; k < bw * bh; k++) {
            const on = px[k * 4 + 3] > 96 ? 1 : 0;
            cov[k] = on;
            if (on && i === 0) { cr += px[k * 4]; cg += px[k * 4 + 1]; cb += px[k * 4 + 2]; cn++; }
          }
          covers.push(cov);
        }
        waveClock.value = t0;
        const rgb = cn ? [Math.round(cr / cn), Math.round(cg / cn), Math.round(cb / cn)] : null;

        // Union area.
        let area = 0;
        for (let k = 0; k < bw * bh; k++) {
          for (let i = 0; i < covers.length; i++) {
            if (covers[i][k]) { area++; break; }
          }
        }
        if (!area) return { area: 0, p90: 0, max: 0, rgb: rgb };

        // Silhouette edges. Rows give the left and right edge; columns give
        // the top edge. Only samples where the edge exists in EVERY phase are
        // used -- an edge that appears and disappears is a coverage change,
        // not a displacement, and mixing the two inflates travel.
        const spread = [];
        for (let r = 0; r < bh; r++) {
          let okL = true, mnL = 1e9, mxL = -1e9, okR = true, mnR = 1e9, mxR = -1e9;
          for (let i = 0; i < covers.length; i++) {
            const row = covers[i];
            let l = -1, rr = -1;
            for (let c = 0; c < bw; c++) if (row[r * bw + c]) { l = c; break; }
            for (let c = bw - 1; c >= 0; c--) if (row[r * bw + c]) { rr = c; break; }
            if (l < 0) { okL = okR = false; break; }
            if (l < mnL) mnL = l; if (l > mxL) mxL = l;
            if (rr < mnR) mnR = rr; if (rr > mxR) mxR = rr;
          }
          if (okL) spread.push((mxL - mnL) / dpr);
          if (okR) spread.push((mxR - mnR) / dpr);
        }
        for (let c = 0; c < bw; c++) {
          let ok = true, mn = 1e9, mx = -1e9;
          for (let i = 0; i < covers.length; i++) {
            const col = covers[i];
            let t = -1;
            for (let r = 0; r < bh; r++) if (col[r * bw + c]) { t = r; break; }
            if (t < 0) { ok = false; break; }
            if (t < mn) mn = t; if (t > mx) mx = t;
          }
          if (ok) spread.push((mx - mn) / dpr);
        }
        spread.sort((a, c2) => a - c2);
        const p90 = spread.length ? spread[Math.floor(spread.length * 0.90)] : 0;
        const max = spread.length ? spread[spread.length - 1] : 0;
        return { area: area / (dpr * dpr), p90, max, rgb: rgb };
      }

      // ---- the emptiness guard --------------------------------------------
      // Hide everything and require the frame back completely uncovered. If a
      // background pixel reads as covered, "area" means nothing and every
      // figure below is the size of its own crop rather than of its object.
      // This is the assertion the first version of this file did not have.
      setAll(false);
      if (runnerG) runnerG.visible = false;
      if (ghostG) ghostG.visible = false;
      {
        renderer.render(scene, camera);
        const fw = gl.drawingBufferWidth, fh = gl.drawingBufferHeight;
        const px = readCrop(0, 0, fw, fh);
        let covered = 0;
        for (let k = 0; k < fw * fh; k++) if (px[k * 4 + 3] > 96) covered++;
        if (covered > 0) {
          restoreClear();
          return { err: 'emptiness guard failed: ' + covered + ' of ' + (fw * fh)
            + ' background pixels read as covered -- coverage is not measurable on this page' };
        }
      }

      // ---- whole-frame control --------------------------------------------
      setAll(true);
      if (runnerG) runnerG.visible = rVis;
      if (ghostG) ghostG.visible = gVis;
      const framePlan = { span: 9.7, n: 16 };  // one full gust period
      let framePx = 0, frameTot = 0;
      {
        const fw = gl.drawingBufferWidth, fh = gl.drawingBufferHeight;
        const t0 = waveClock.value;
        let base = null;
        const changed = new Uint8Array(fw * fh);
        for (let i = 0; i < framePlan.n; i++) {
          waveClock.value = t0 + (i / framePlan.n) * framePlan.span;
          renderer.render(scene, camera);
          const px = readCrop(0, 0, fw, fh);
          if (!base) { base = px; continue; }
          for (let k = 0; k < fw * fh; k++) {
            const d = Math.abs(px[k * 4] - base[k * 4])
                    + Math.abs(px[k * 4 + 1] - base[k * 4 + 1])
                    + Math.abs(px[k * 4 + 2] - base[k * 4 + 2]);
            if (d > 12) changed[k] = 1;
          }
        }
        waveClock.value = t0;
        for (let k = 0; k < fw * fh; k++) if (changed[k]) framePx++;
        frameTot = fw * fh;
      }

      // ---- per-unit -------------------------------------------------------
      if (runnerG) runnerG.visible = false;
      if (ghostG) ghostG.visible = false;
      const rows = [];
      for (let i = 0; i < units.length; i++) {
        const inf = info[i];
        if (!inf.onScreen) continue;
        setAll(false);
        units[i].visible = true;
        const plan = planFor(inf.chunk);
        const m = measure(units[i], plan);
        if (!m) continue;
        rows.push({
          chunk: inf.chunk, ampMax: inf.ampMax, ampNzFrac: inf.ampNzFrac,
          verts: inf.verts, area: m.area, p90: m.p90, max: m.max,
          box: inf.box, size: inf.size, ctr: inf.ctr, dist: inf.dist, rgb: m.rgb,
          notScenery: inf.notScenery,
        });
      }
      setAll(true);
      for (let i = 0; i < units.length; i++) units[i].visible = prevVis[i];
      if (runnerG) runnerG.visible = rVis;
      if (ghostG) ghostG.visible = gVis;
      restoreClear();

      return {
        rows,
        units: units.length,
        framePct: frameTot ? (framePx / frameTot) * 100 : 0,
      };
    });

    if (out && out.err) {
      console.log('skip ' + SKIP + ': ' + out.err);
      pageErrors++;
      await page.close();
      continue;
    }
    if (errs.length) { pageErrors += errs.length; for (const e of errs.slice(0, 3)) console.log('  ' + e); }

    // ---- the static control ----------------------------------------------
    // Nothing without a vertexChunk may move. If one does, this tool is the
    // thing that is moving and every number it printed is suspect.
    const bad = out.rows.filter((r) => !r.chunk && r.max > 0.25);
    if (bad.length) {
      controlFailures += bad.length;
      console.log('  CONTROL FAILED at skip ' + SKIP + ': ' + bad.length
        + ' static units reported travel (max ' + Math.max(...bad.map((b) => b.max)).toFixed(2) + ' px)');
    }

    const live = out.rows.filter((r) => r.chunk);
    const dead = out.rows.filter((r) => !r.chunk);
    const areaLive = live.reduce((a, r) => a + r.area, 0);
    const areaDead = dead.reduce((a, r) => a + r.area, 0);
    // "Moving" is a claim about pixels, not about attributes: a unit with a
    // wave material whose silhouette travels under a third of a pixel is the
    // defect this file exists to name, so it is counted with the dead.
    const moving = live.filter((r) => r.p90 >= 0.30 || r.max >= 1.0);
    const inert = live.filter((r) => !(r.p90 >= 0.30 || r.max >= 1.0));

    console.log('skip ' + (String(SKIP).padStart(3)) + '  units ' + String(out.units).padStart(3)
      + '  onscreen ' + String(out.rows.length).padStart(3)
      + '  frame-changed ' + out.framePct.toFixed(2) + '%'
      + '  |  animated-material ' + String(live.length).padStart(2)
      + ' (moving ' + moving.length + ', inert ' + inert.length + ')'
      + '  static ' + String(dead.length).padStart(3)
      + '  |  px-area live ' + (areaLive / (areaLive + areaDead) * 100).toFixed(1) + '%');

    if (LIST) {
      const fmt = (r) => '    ' + String(r.chunk || 'static').padEnd(16)
        + ' amp ' + r.ampMax.toFixed(2)
        + '  area ' + String(Math.round(r.area)).padStart(6) + 'px'
        + '  travel p90 ' + r.p90.toFixed(2).padStart(5) + ' max ' + r.max.toFixed(2).padStart(6)
        + '  size ' + r.size.join('x').padEnd(18)
        + ' d ' + String(r.dist).padStart(6)
        + (r.rgb ? '  rgb ' + r.rgb.map((v) => String(v).padStart(3)).join(',') : '')
        + (r.notScenery ? '  [terrain]' : '');
      console.log('  -- animated material --');
      for (const r of live.sort((a, b) => b.area - a.area)) console.log(fmt(r));
      console.log('  -- largest static units --');
      for (const r of dead.sort((a, b) => b.area - a.area).slice(0, TOP)) console.log(fmt(r));
    }

    all.push({ SKIP, out });
    await page.close();
  }

  await browser.close();

  // ---- the roll-up --------------------------------------------------------
  const rows = all.flatMap((a) => a.out.rows);
  const live = rows.filter((r) => r.chunk);
  const dead = rows.filter((r) => !r.chunk);
  const areaLive = live.reduce((a, r) => a + r.area, 0);
  const areaDead = dead.reduce((a, r) => a + r.area, 0);
  const moving = live.filter((r) => r.p90 >= 0.30 || r.max >= 1.0);
  console.log('');
  console.log('ACROSS ' + all.length + ' POINTS IN THE RACE');
  console.log('  on-screen units          ' + rows.length);
  console.log('  carrying a wave material ' + live.length
    + '  (' + (live.length / rows.length * 100).toFixed(1) + '%)');
  console.log('  of those, actually moving ' + moving.length
    + '  (' + (moving.length / Math.max(1, live.length) * 100).toFixed(1) + '% of animated, '
    + (moving.length / rows.length * 100).toFixed(1) + '% of all units)');
  console.log('  screen area on animated  ' + (areaLive / (areaLive + areaDead) * 100).toFixed(1) + '%');
  // The same share with the sky dome and the ground plane taken out. They are
  // 60-75% of every frame's covered pixels and neither can ever move, so
  // leaving them in the denominator answers "how much of the SCREEN moves"
  // when the question asked is "how much of the SCENERY moves". Both are
  // printed because both are true and they differ by a factor of three.
  const liveNT = live.filter((r) => !r.notScenery);
  const deadNT = dead.filter((r) => !r.notScenery);
  const aL = liveNT.reduce((a, r) => a + r.area, 0);
  const aD = deadNT.reduce((a, r) => a + r.area, 0);
  console.log('  ... excluding sky+ground  ' + (aL / (aL + aD) * 100).toFixed(1) + '%'
    + '   (' + liveNT.length + ' animated units against ' + deadNT.length + ' static)');
  console.log('  mean frame-changed       '
    + (all.reduce((a, x) => a + x.out.framePct, 0) / all.length).toFixed(2) + '%');
  console.log('  static control           ' + (controlFailures ? controlFailures + ' FAILURES' : 'clean'));
  if (pageErrors) console.log('  page errors              ' + pageErrors);
  process.exit(controlFailures ? 1 : 0);
})();
