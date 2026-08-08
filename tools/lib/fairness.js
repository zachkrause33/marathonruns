/**
 * THE FAIRNESS AUDIT, AS ONE COPY.
 *
 * LOW, HIDES, BLANKS, PAINTS, the constant-drift guard and the collision-box
 * envelope guard, in the form they run inside the page. It lived inside a
 * single page.evaluate() in tools/shoot.js, which was fine while shoot.js was
 * the only caller and stopped being fine the moment a second tool needed the
 * same assertions on a second date.
 *
 * IT IS A FILE RATHER THAN A COPY-PASTE FOR THE REASON docs/roadmap.md KEEPS
 * RECORDING. Four of the corrections in that list start with a constant held
 * in two places and checked in neither; a six-hundred-line ASSERTION held in
 * two places is the same defect with more surface. The audit that fails the
 * build and the audit that sweeps the calendar have to be the same audit, or
 * the sweep is measuring a fork of the gate and reporting it as the gate.
 *
 * The function is shipped as SOURCE and evaluated in the page, because it uses
 * THREE, MR and document and closes over nothing. Callers do:
 *
 *   const fairness = require('./lib/fairness');
 *   const occl = await page.evaluate(fairness.call).catch(...)
 *
 * Everything it needs is read off window.MR at call time, so it is safe to run
 * repeatedly on one page as the race advances -- which is what
 * tools/calendar.js does, and what shoot.js does once per shot.
 */
function fairnessAudit() {
      const g = window.MR && MR.game;
      if (!g || !g.world || !g.world.crossings) return { skipped: 'world exposes no crossings()' };
      const cam = g.cam.camera;
      const camZ = cam.position.z;
      const OY = g.world.OVERHEAD_Y;
      cam.updateMatrixWorld();
      const CH = g.world.CORRIDOR_HALF;

      // Everything the runner can still see ahead. VIEW is 210; a little past
      // it costs nothing and catches a set piece straddling the spawn edge.
      const els = g.world.crossings(camZ + 0.5, camZ + 240);
      const gates = g.world.gateBoxes();

      // ---- THE READ WINDOW, DERIVED AT BOTH ENDS ------------------------
      //
      // Both assertions below read the same band of road, because both are
      // asking the same question about it: can the player see the thing they
      // are about to have to answer?
      //
      // NEAR is the commit point, seen from the LENS. The player's last chance
      // to change lane or start an action is Course.ACTION_WINDOW ahead of the
      // RUNNER, and the chase camera sits K.CAM_BASE_BACK behind him, so the
      // commit point is ACTION_WINDOW + CAM_BASE_BACK = 25.35 units in front of
      // the eye. Nearer than that the gate is already answered, and hiding it
      // costs the player nothing they could still have used.
      //
      // This is not a new number. It is the 26 that was written here as a
      // literal, now saying where it came from -- and it moves if the jump arc
      // or the chase distance moves, which the literal did not.
      //
      // FAR is MR.Elevation.SIGHT_MIN, the same 90 units the hill-shape cap is
      // derived from and that Elevation.validate() ray-marches every course
      // against. The terrain proof says the road stays visible for 90 units; a
      // hazard stands 0.8-2.8 units above that road, so anything the proof
      // covers this test can legitimately demand. See the far-end note in the
      // crossing loop for what bounding it gives up and why it must be bounded.
      const READ_NEAR = MR.Course.READ_NEAR;
      const READ_FAR = (MR.Elevation && MR.Elevation.SIGHT_MIN) || 90;

      // course.js has to hold its own copy of every hazard half-depth --
      // collision.js loads after it, and generation also runs headless in
      // course-test.js and simulate.js where collision.js is not loaded at all.
      // A duplicated constant nobody checks is how four of the five corrections
      // in docs/roadmap.md started, so it is checked here, where both files are
      // live in the same page.
      //
      // EVERY KIND, not just BLOCK. This guard used to compare one scalar and
      // the spacing floor used one scalar, so the JUMP and DUCK depths were
      // free to drift with nothing watching them. They are load-bearing now:
      // reachOf charges a gate for its own deepest lane, so a stale DUCK depth
      // silently under-spaces every DUCK-only gate on the course.
      const drift = (function () {
        const NAME = { [MR.K.JUMP]: 'JUMP', [MR.K.DUCK]: 'DUCK', [MR.K.BLOCK]: 'BLOCK' };
        const bad = [];
        for (const kind of [MR.K.JUMP, MR.K.DUCK, MR.K.BLOCK]) {
          const mine = MR.Course.HAZARD_HALF_Z[kind];
          const real = MR.Collision.BOX[kind].halfZ;
          if (mine !== real) {
            bad.push(`course.js HAZARD_HALF_Z[${NAME[kind]}] is ${mine} but `
              + `Collision.BOX[${NAME[kind]}].halfZ is ${real}`);
          }
        }
        // world.js keeps its own copy of halfX for the same reason course.js
        // keeps its own copy of halfZ -- collision.js loads after both -- and
        // it is load-bearing for far more than spacing: CORRIDOR_HALF, the
        // landmark stand-off and every aid clearance in the game are cut from
        // it. A stale copy walks props into the play corridor.
        const hx = g.world.HAZARD_HALF;
        const boxHx = MR.Collision.BOX[MR.K.BLOCK].halfX;
        if (hx !== undefined && Math.abs(hx - boxHx) > 1e-9) {
          bad.push(`world.js HAZARD_HALF is ${hx} but Collision.BOX.halfX is ${boxHx}`);
        }
        return bad.length
          ? bad.join('; ') + ' -- a clearance is being derived from the wrong box'
          : null;
      })();

      /**
       * ART MAY NOT LEAVE ITS OWN COLLISION BOX.
       *
       * `MR.Collision.BOX` is the contract, and until this pass nothing
       * anywhere compared it with the geometry it stands for. Two holes at
       * once: the box had no halfX at all -- world.js was writing the audited
       * width itself, as LANE * 0.5 -- and no axis of any variant had ever
       * been measured against the envelope it is allowed.
       *
       * WHY THIS IS A BUILD FAILURE AND NOT A NOTE. Everything downstream of
       * the box assumes the box contains the art. `BLANKS` casts rays at these
       * boxes to decide what a gate hides; a variant wider or deeper than its
       * box hides more road than the audit believes, so the audit clears a
       * gate the player genuinely cannot read. That is the exact defect in the
       * corrections list, and it is the one direction that costs a run.
       *
       * The other direction is safe and is only reported: art SHORTER than its
       * box makes the audit over-count occlusion, which errs toward calling a
       * readable gate unreadable, and the fleet is deliberately full of it --
       * 3.90 is a ceiling, not a target, and a moped is not 3.90 long.
       *
       * Measured on the SWEPT geometry, not the rest pose: a pantograph or a
       * stop paddle that fits until the anim runs does not fit. y is reported
       * and not failed, because two variants have overhung it since long
       * before this check existed and closing that is a separate argument with
       * its own measurements -- see the note in docs/roadmap.md.
       */
      const envelope = (function () {
        if (!g.world.fleetExtents) return { bad: [], slack: [], skipped: true };
        const bad = [], slack = [];
        for (const e of g.world.fleetExtents()) {
          if (!e.boxHalfZ) continue;
          if (e.halfX > e.boxHalfX + 1e-6) {
            bad.push(`${e.name} reaches halfX ${e.halfX} against box ${e.boxHalfX}`);
          }
          if (e.halfZ > e.boxHalfZ + 1e-6) {
            bad.push(`${e.name} reaches halfZ ${e.halfZ} against box ${e.boxHalfZ}`);
          }
          // y IS FAILED FOR JUMP AND BLOCK AND ONLY REPORTED FOR DUCK, and the
          // asymmetry is a statement about what those boxes mean rather than a
          // convenience. A JUMP box and a BLOCK box are the whole object: the
          // hazard stands on the road and the box is what it occupies. The
          // DUCK box is the BAR ALONE -- 1.41 to 1.83 -- and the frame that
          // carries it goes on up to 3.5 as two 0.26 posts, deliberately, so
          // that clearance is decided by the thing the player ducks under and
          // not by the gantry holding it. Failing y there would be demanding
          // the box grow into a solid wall the DUCK has already been measured
          // not to be. It is printed on every run so the choice stays visible.
          if (e.kind !== MR.K.DUCK && e.yMax > e.boxYMax + 1e-6) {
            bad.push(`${e.name} reaches y ${e.yMax} against box top ${e.boxYMax}`);
          }
          slack.push({
            name: e.name, halfX: e.halfX, boxHalfX: e.boxHalfX,
            halfZ: e.halfZ, boxHalfZ: e.boxHalfZ,
            yMax: e.yMax, boxYMax: e.boxYMax,
            overY: +(e.yMax - e.boxYMax).toFixed(2),
          });
        }
        return { bad, slack };
      })();

      const v = new THREE.Vector3();
      const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
                     [0, 4], [1, 5], [2, 6], [3, 7]];
      /**
       * The rows a world-space box occupies, as fractions down the frame.
       *
       * Corners are not enough. A road tile is a 24-unit span and the runner is
       * usually standing inside one, so the near face of its overhead geometry
       * is routinely BEHIND the lens -- and a point behind the camera has
       * negative w, which flips its projection and reports the top of the frame
       * as the bottom. That produced a confident "the scaffold is hiding six
       * hazards" on a frame where it plainly was not. So the twelve edges are
       * walked instead and every sample behind the near plane is dropped: what
       * comes back is the band the box actually covers ON SCREEN.
       */
      function band(x0, x1, y0, y1, z0, z1) {
        let lo = Infinity, hi = -Infinity;
        const C = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
                   [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
        for (const e of EDGES) {
          const a = C[e[0]], b = C[e[1]];
          for (let s = 0; s <= 12; s++) {
            const t = s / 12;
            v.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
            v.applyMatrix4(cam.matrixWorldInverse);
            if (-v.z < 0.5) continue;
            v.applyMatrix4(cam.projectionMatrix);
            const py = (1 - v.y) * 0.5;
            if (py < lo) lo = py;
            if (py > hi) hi = py;
          }
        }
        return lo === Infinity ? null : { top: lo, bottom: hi };
      }

      const low = [], hide = [];
      // 1. The corridor rule itself, in world space. world.js promises that
      //    anything reaching back over the carriageway does so above
      //    OVERHEAD_Y. This is that sentence, executable -- and it is the
      //    load-bearing half: eye height is 2.62 and OVERHEAD_Y is 9.0, so
      //    anything obeying it projects above the horizon while every hazard
      //    (top 2.80) projects at or below it, and the screen test below can
      //    then never fire. Breaking the rule is what makes occlusion possible
      //    in the first place.
      // yMinLocal, not yMin. With hills the road is no longer at y = 0, so the
      // corridor rule ("nothing reaches back over the carriageway below
      // OVERHEAD_Y") is a height above the ROAD and world y is not it: a gantry
      // correctly clearing a 6.5-unit crest sits at world y 15.5 and the road
      // tile under it sits at 6.5. world.js measures both -- yMin/yMax in world
      // space because the screen test below has to project them, yMinLocal
      // against the road directly underneath, which is what the rule says.
      for (const e of els) if (e.yMinLocal < OY) low.push(e);

      // 2. The screen test, as the backstop. Sliced in depth: a single box
      //    around a 24-unit tile spans half the frame and would overlap
      //    everything, so each element is cut into short depth slices and only
      //    slices wholly in front of a gate are tested against it.
      const SLICES = 8;
      for (const e of els) {
        const near = Math.max(e.z0, camZ + 0.2);
        if (e.z1 <= near) continue;
        const step = (e.z1 - near) / SLICES;
        for (let s = 0; s < SLICES; s++) {
          const za = near + step * s, zb = za + step;
          const eb = band(-CH, CH, e.yMin, e.yMax, za, zb);
          if (!eb) continue;
          for (const gt of gates) {
            // Only scenery strictly IN FRONT of a gate can hide it.
            if (gt.z0 <= zb) continue;
            // THE READ WINDOW, AND IT NOW HAS BOTH ENDS.
            //
            // The near end is unchanged: a gate closer than 26 units is already
            // committed to, so hiding it costs the player nothing they could
            // have used.
            //
            // The far end is new, and it is a deliberate loosening. Until now
            // the band ran from 26 units to the spawn distance -- 240 -- and on
            // flat ground that openness was free, because nothing on a flat
            // road can project onto a hazard 157 units away. Terrain can.
            // Standing behind a rise you cannot see the dip beyond it: that is
            // what a hill IS, and an unbounded far end makes this assertion
            // UNPASSABLE BY CONSTRUCTION for any course with a crest in it. A
            // test no correct implementation can pass is not a safety net, and
            // this project has already had to retract one of those.
            //
            // So the band is bounded, and the bound is not a new number. It is
            // MR.Elevation.SIGHT_MIN, the same 90 units the hill shape cap is
            // derived from and that Elevation.validate() ray-marches every
            // course against -- the two assertions become one constraint seen
            // from both ends, which is the pattern ACTION_WINDOW and
            // spacingAt() already use in course.js. The terrain proof says the
            // road surface stays visible for 90 units; a hazard stands 0.8-2.8
            // units ABOVE that road, so anything the proof covers this test can
            // legitimately demand. Measuring from camZ rather than from the
            // runner makes it 4.35 units stricter still.
            //
            // What it gives up: a prop that occludes a hazard ONLY beyond 90
            // units and never inside it. Such a hazard is in clear view for at
            // least 69 units before the 21-unit action window opens, and its
            // telegraph mat is 16 units long. No player is harmed by that, and
            // nothing in the current prop set does it -- the sweep passed with
            // the unbounded form on flat ground, so nothing measured is being
            // waved through.
            //
            // The number NOT chosen: 60, which was proposed and is looser than
            // the 90 this codebase has already proved. Do not relax it further
            // without moving SIGHT_MIN, which would move the hill cap with it.
            const gd = gt.z - camZ;
            if (gd < READ_NEAR || gd > READ_FAR) continue;
            const gb = band(gt.x - gt.halfX, gt.x + gt.halfX, gt.yMin, gt.yMax, gt.z0, gt.z1);
            if (!gb) continue;
            // A genuine interval overlap, both ends. The one-sided form the
            // spec sketched assumes the scenery is overhead; a long low object
            // like a bridge abutment sits BELOW every distant gate on screen
            // and a one-sided test calls that an occlusion.
            if (eb.bottom > gb.top && eb.top < gb.bottom) {
              hide.push({
                el: e.name, elY: +e.yMin.toFixed(2), elZ: +zb.toFixed(1),
                gateZ: +gt.z.toFixed(1), lane: gt.lane, kind: gt.kind,
                d: +(gt.z - camZ).toFixed(1),
                // Fractions down the frame, so a failure can be checked by eye
                // against the .png sitting next to it.
                elBottom: +eb.bottom.toFixed(3), gateTop: +gb.top.toFixed(3),
              });
            }
          }
        }
      }
      // ---- 3a. PAINTS: the screen-space overlays, which nothing has audited -
      //
      // LOW, HIDES and BLANKS all start from world geometry -- crossings() for
      // the first two, gateBoxes() for the third. An object that switches
      // depthTest OFF is in neither list and is in front of everything by
      // construction, so the one class of object that CANNOT be occluded was
      // also the one class nothing checked. That is the same shape of hole
      // BLANKS was written to close, one level up: an assertion that walks a
      // list tells you about the things in the list.
      //
      // So this walks the live scene instead of a list, and the test is the
      // property rather than the object: any material with depthTest === false
      // paints over whatever is behind it, whatever it is and whoever added it.
      //
      // WHAT COUNTS AS PAINTING OVER. Three's renderer draws opaque objects,
      // then transparent ones, each pass sorted by renderOrder. Hazards are
      // opaque world meshes at renderOrder 0, so a depthTest:false object lands
      // in front of them if it is transparent (a later pass) or opaque with a
      // renderOrder at or above theirs. A depthTest:false object that is opaque
      // AND sorts below zero draws first and the world paints over it -- the
      // backdrop's own trick -- so it is exempt and says so here rather than by
      // not being looked at.
      //
      // ALPHA, NOT THE QUAD. A sprite's quad is mostly empty: the RECORD plate
      // is 148 of 208 texture rows and the rest is a chevron and clear margin.
      // Failing on the quad would be conservative but would also demand a fix
      // that moves transparent pixels, so the texture's own alpha channel is
      // read back and sampled per ray. The line is alpha >= 0.5 -- more than
      // half the light reaching the eye from that point is the overlay's rather
      // than the hazard's. That is the one judgement here, and it is not
      // load-bearing: swept over the whole race at 0.30, 0.50 and 0.85 the
      // coverage figures are identical on every gate but one, because the plate
      // is drawn at 0.88 and its border at 0.22 with nothing in between.
      const overlays = [];
      {
        const wp = new THREE.Vector3(), ws = new THREE.Vector3(), mv = new THREE.Vector3();
        const P = cam.projectionMatrix.elements;
        const masks = new Map();
        // The alpha channel, read back once per texture. A texture the page
        // will not hand back (cross-origin, compressed, not yet decoded) falls
        // through to the whole quad, which is the conservative direction.
        function maskOf(tex) {
          if (!tex || !tex.image || !tex.image.width) return null;
          if (masks.has(tex.uuid)) return masks.get(tex.uuid);
          let m = null;
          try {
            const im = tex.image;
            const c = document.createElement('canvas');
            c.width = im.width; c.height = im.height;
            const x2 = c.getContext('2d');
            x2.drawImage(im, 0, 0);
            const d = x2.getImageData(0, 0, c.width, c.height).data;
            const a = new Uint8Array(c.width * c.height);
            for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
            // three uploads with flipY by default, so uv v=0 is the LAST image
            // row. Getting this backwards reads the chevron for the plate.
            m = { w: c.width, h: c.height, a, flipY: tex.flipY !== false };
          } catch (err) { m = null; }
          masks.set(tex.uuid, m);
          return m;
        }
        g.scene.traverseVisible(function (o) {
          if (!o.material || !(o.isSprite || o.isMesh || o.isLine || o.isPoints)) return;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          const m = ms.find((x) => x && x.depthTest === false);
          if (!m) return;
          if (!m.transparent && o.renderOrder < 0) return;   // drawn under the world
          o.getWorldPosition(wp); o.getWorldScale(ws);
          mv.copy(wp).applyMatrix4(cam.matrixWorldInverse);
          if (-mv.z < 0.05) return;                          // behind the lens
          const op = m.opacity === undefined ? 1 : m.opacity;
          if (op <= 0.02) return;
          const rec = { name: (o.name || o.type) + '#' + o.id, op, d: wp.z - camZ, mask: null };
          if (o.isSprite) {
            // With sizeAttenuation off three multiplies the sprite's scale by
            // the view depth, which cancels the perspective divide -- so the
            // NDC half-extent is scale * P[0] / 2 with no depth in it at all,
            // which is why the plate is the same size at 3 units and at 190.
            // With it on, the depth comes back.
            const k = m.sizeAttenuation ? 1 / (-mv.z) : 1;
            rec.hw = 0.5 * ws.x * P[0] * k;
            rec.hh = 0.5 * ws.y * P[5] * k;
            const rot = m.rotation || 0;
            // Sprite.center is the anchor the quad hangs from, default (0.5,
            // 0.5) = centred. Off-centre, the quad's middle is displaced by
            // (0.5 - center) of its own size, which is what three's
            // alignedPosition does before the billboard turn.
            const ax = (0.5 - (o.center ? o.center.x : 0.5)) * 2 * rec.hw;
            const ay = (0.5 - (o.center ? o.center.y : 0.5)) * 2 * rec.hh;
            if (rot) {
              // A rotated plate is bounded by its circumscribed rect and its uv
              // lookup would need the inverse turn; nothing rotates today, so
              // this stays conservative rather than growing untested arithmetic.
              const s = Math.abs(Math.sin(rot)), c2 = Math.abs(Math.cos(rot));
              const hw = rec.hw * c2 + rec.hh * s, hh = rec.hw * s + rec.hh * c2;
              rec.hw = hw; rec.hh = hh;
            } else {
              // The uv transform has to be the identity for a straight texel
              // lookup. It is not Texture.center that decides that -- that
              // defaults to (0,0) and is only consulted when rotation is set --
              // so the test is on the transform's own terms. Getting this
              // backwards is how the first draft of this check read no alpha at
              // all and silently fell back to the whole quad, which passed.
              const t = m.map;
              const plain = t && (!t.rotation)
                && (!t.offset || (t.offset.x === 0 && t.offset.y === 0))
                && (!t.repeat || (t.repeat.x === 1 && t.repeat.y === 1));
              if (plain) rec.mask = maskOf(t);
            }
            rec.ax = ax; rec.ay = ay;
          } else {
            // Anything that is not a sprite is bounded by its projected world
            // box. No alpha, so the whole box counts -- conservative, and the
            // day something like that appears is the day to do better.
            if (!o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox;
            let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
            for (let i = 0; i < 8; i++) {
              v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y,
                    i & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
              v.applyMatrix4(cam.matrixWorldInverse);
              if (-v.z < 0.05) return;
              v.applyMatrix4(cam.projectionMatrix);
              if (v.x < lo0) lo0 = v.x; if (v.x > hi0) hi0 = v.x;
              if (v.y < lo1) lo1 = v.y; if (v.y > hi1) hi1 = v.y;
            }
            rec.cx = (lo0 + hi0) / 2; rec.cy = (lo1 + hi1) / 2;
            rec.hw = (hi0 - lo0) / 2; rec.hh = (hi1 - lo1) / 2;
            overlays.push(rec);
            return;
          }
          v.copy(wp).project(cam);
          rec.cx = v.x + (rec.ax || 0); rec.cy = v.y + (rec.ay || 0);
          overlays.push(rec);
        });
      }
      const PAINT_ALPHA = 0.5;
      /** The overlay painting over this world point, or '' if none is. */
      function paintedAt(x, y, z) {
        if (!overlays.length) return '';
        v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
        if (-v.z < 0.05) return '';
        v.applyMatrix4(cam.projectionMatrix);
        for (const o of overlays) {
          const dx = v.x - o.cx, dy = v.y - o.cy;
          if (Math.abs(dx) > o.hw || Math.abs(dy) > o.hh) continue;
          let a = 1;
          if (o.mask) {
            const u = 0.5 + dx / (2 * o.hw), t = 0.5 + dy / (2 * o.hh);
            const col = Math.min(o.mask.w - 1, Math.max(0, Math.floor(u * o.mask.w)));
            const row = Math.min(o.mask.h - 1, Math.max(0,
              Math.floor((o.mask.flipY ? 1 - t : t) * o.mask.h)));
            a = o.mask.a[row * o.mask.w + col] / 255;
          }
          if (a * o.op >= PAINT_ALPHA) return o.name;
        }
        return '';
      }

      // ---- 3. BLANKS: a hazard hidden by another hazard ------------------
      //
      // The dominant occluder in this game, and the one the two assertions
      // above cannot reach. Measured on real courses, the first gate ahead is
      // essentially always whole and the SECOND is routinely 0-60% visible,
      // with the first gate doing it: one hazard at 12 units has a screen
      // half-width of 0.144 NDC against 0.114 for the entire three-lane band at
      // 45, so a near hazard covers all three far lanes. Gates are 21-48 apart,
      // so there is always a near one doing this to the next at the moment its
      // lane has to be chosen.
      //
      // WHY A PERCENTAGE, AND NOT THE INTERVAL OVERLAP USED ABOVE.
      //
      // Overhead scenery is a beam: it either crosses a hazard's screen rows or
      // it does not, and a beam that clips one row off the top of a bus has not
      // hidden the bus. Between two hazards the geometry is the opposite -- they
      // stand in the same band and overlap constantly -- so an interval test
      // would fire on every gate in the game and mean nothing. What matters is
      // how much is left, so this casts rays and counts.
      //
      // Sampling is the hazard's own collision box, from MR.Collision.BOX via
      // world.gateBoxes(). NOT the art: the art is world.js's business and the
      // envelope is the contract. A 5x5 grid over the face nearest the lens, so
      // one sample is 4% and the numbers below are readable as counts.
      //
      // ---- THE THRESHOLD, AND WHERE EACH HALF OF IT COMES FROM -----------
      //
      // Two conditions, and a gate has to fail both to fail the build.
      //
      // (1) THE OCCLUDER MUST NOT SELF-CLEAR. A hazard hidden now may be in
      //     plain view in a second, because the thing hiding it is nearer than
      //     it is and will go past first. That is not a defect, it is
      //     parallax, and a test that fails on it is a test no course can pass.
      //     The line is exact rather than judged: the occluder leaves the lens
      //     after the eye has travelled its own distance, and at that instant
      //     the hidden gate is (z_gate - z_occluder) in front of the lens. The
      //     player is owed a full action window from there, and the commit
      //     point measured from the lens is READ_NEAR -- so the pair is fair,
      //     whatever it looks like right now, when
      //
      //         z_gate - z_occluder >= READ_NEAR
      //
      //     and only a TIGHTER pair than that can be unfair. Note what this
      //     picks out: gate spacing floors at ACTION_WINDOW = 21 and READ_NEAR
      //     is 25.35, so the pairs this admits are consecutive gates at the
      //     tightest spacings the generator produces. "So many obstacles back
      //     to back", in the owner's words, is literally the set this selects.
      //
      // (2) WHAT IS LEFT MUST STILL BE READABLE, and this is where the one
      //     judgement in the assertion lives, so it is stated rather than
      //     buried. Both ENDS are derived:
      //
      //       at READ_NEAR the gate is being committed to this instant and
      //       there is no later read, so the player is owed all of it: 100%.
      //
      //       at READ_FAR = SIGHT_MIN the gate has 64.65 units of approach
      //       still to run before that moment, so it is owed the share of its
      //       approach already spent: READ_NEAR / READ_FAR = 28%.
      //
      //     Between them it interpolates as READ_NEAR / d, which is that same
      //     sentence at every distance -- "you are owed as much of this gate as
      //     you have already spent of its approach". The SHAPE is the judgement;
      //     the two endpoints are not, and margins are printed for every gate
      //     so the shape can be argued with against numbers.
      //
      // WHAT THIS DELIBERATELY DOES NOT ASSERT: that the KIND is legible. It
      // does not need to. An occluder stands on the road, so it eats a hidden
      // gate from the BOTTOM UP, and BOX makes the three kinds separable by
      // their top edge alone -- JUMP tops at 0.80, the DUCK bar at 1.83, BLOCK
      // at 2.80, no two overlapping. The part that survives bottom-up occlusion
      // is exactly the part that names the hazard, so the binding requirement
      // is that enough of it be SEEN, which is what is measured here.
      const blank = [], seenBox = [];
      {
        const N = 5;                       // 25 rays per gate; one sample = 4%
        const O = [0, 0, 0], D = [0, 0, 0];
        // Slab test against an axis-aligned box, in world space. Cheaper and
        // more honest than projecting: occlusion from a point does not depend
        // on where the camera is AIMED, only on where its eye is, so this needs
        // no projection matrix and cannot be flipped by a sample behind the
        // near plane -- the failure mode band() above exists to work around.
        function blocks(b, tmax) {
          let t0 = 1e-4, t1 = tmax;
          const lo = [b.x - b.halfX, b.yMin, b.z0], hi = [b.x + b.halfX, b.yMax, b.z1];
          for (let a = 0; a < 3; a++) {
            if (Math.abs(D[a]) < 1e-9) { if (O[a] < lo[a] || O[a] > hi[a]) return false; continue; }
            let ta = (lo[a] - O[a]) / D[a], tb = (hi[a] - O[a]) / D[a];
            if (ta > tb) { const s = ta; ta = tb; tb = s; }
            if (ta > t0) t0 = ta;
            if (tb < t1) t1 = tb;
            if (t0 > t1) return false;
          }
          return true;
        }
        const eye = cam.position;
        for (const gt of gates) {
          const d = gt.z - camZ;
          if (d < READ_NEAR || d > READ_FAR) continue;
          let seenN = 0, tight = 0, tot = 0, over = 0, tightBy = -Infinity;
          const blame = {}, blameOver = {};
          for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
              const px = gt.x - gt.halfX + 2 * gt.halfX * (i + 0.5) / N;
              const py = gt.yMin + (gt.yMax - gt.yMin) * (j + 0.5) / N;
              O[0] = eye.x; O[1] = eye.y; O[2] = eye.z;
              D[0] = px - eye.x; D[1] = py - eye.y; D[2] = gt.z0 - eye.z;
              const len = Math.sqrt(D[0] * D[0] + D[1] * D[1] + D[2] * D[2]);
              D[0] /= len; D[1] /= len; D[2] /= len;
              let hit = null;
              for (const o of gates) {
                // Strictly in front, and never the gate itself.
                if (o === gt || o.z1 >= gt.z0) continue;
                if (blocks(o, len - 1e-3)) { hit = o; break; }
              }
              // The overlay pass. A ray can reach the box and STILL not be
              // seen, because something with no depth test was drawn on top of
              // where it lands -- so this is asked of the ray's endpoint on
              // screen, not of the world between here and there. That is the
              // whole reason it needs its own test: there is nothing in the way.
              const paint = paintedAt(px, py, gt.z0);
              tot++;
              if (!hit && !paint) seenN++;
              // A sample blocked by something that will be past in time is not
              // held against the gate -- condition (1) above, applied per ray
              // rather than per gate, so a mixed pair is judged on the half
              // that actually bites.
              //
              // hit.z1, NOT hit.z. The occluder is a box and it is out of the
              // shot when its REAR face passes the lens, which for a BLOCK train
              // is 5.33 units past its own gate line. Measuring from the gate
              // line credits the longest occluder in the game with clearing the
              // view 21% of a read window early, and the first draft of this
              // assertion did exactly that -- and passed.
              if (hit && gt.z - hit.z1 < READ_NEAR) {
                tight++;
                const k = ['-', 'JUMP', 'DUCK', 'BLOCK'][hit.kind] + ' lane ' + hit.lane
                  + ' at ' + (hit.z - camZ).toFixed(0) + 'u';
                blame[k] = (blame[k] || 0) + 1;
                // HOW FAR INSIDE THE LINE, KEPT BECAUSE THE ANSWER IS OFTEN
                // ZERO -- and a verdict that turns on the last bit of a double
                // is a verdict about the arithmetic, not about the game.
                //
                // course.js's spacingAt() floors gate spacing at
                // readWindowAt(z) + reachOf(lanes), and readWindowAt on flat
                // ground IS READ_NEAR. So every pair where that floor binds
                // has gt.z - hit.z1 == READ_NEAR EXACTLY in real arithmetic,
                // and which side of the strict < it lands on is decided by
                // rounding a subtraction of two coordinates near 4,000. On one
                // measured course, 47 of 186 consecutive pairs are that tie
                // and 13 of them fell on the failing side.
                //
                // This is REPORTED AND NOT ACTED ON. The comparison above is
                // the shipped rule and stays exactly as it is: relaxing a
                // fairness threshold so a sweep goes green is the move
                // docs/roadmap.md records as an occlusion test that passed by
                // measuring from the wrong face. What the number does is let
                // a reader tell a knife-edge tie from a real deficit without
                // having to re-derive it.
                const inside = READ_NEAR - (gt.z - hit.z1);
                if (inside > tightBy) tightBy = inside;
              } else if (paint) {
                // NO SELF-CLEARING CREDIT, AND THIS IS MEASURED RATHER THAN
                // ASSUMED. Condition (1) forgives a world occluder because the
                // eye passes it and the read comes back with an action window
                // to spare. An overlay pinned to a moving marker does not
                // behave that way: swept at 2-frame resolution over miles
                // 18-21, the DUCK at z=4770 was 100% painted over at 96 units
                // AND STILL 100% at 45 units, and only came clear at 17 -- eight
                // units INSIDE the commit point, with the lane already chosen.
                // Its coverage is a band of DISTANCE that slides forward with
                // the player, so it never leaves the shot the way a box does.
                over++;
                tight++;
                blameOver[paint] = (blameOver[paint] || 0) + 1;
              }
            }
          }
          // TWO NUMBERS, AND REPORTING BOTH IS NOT PADDING.
          //
          // `raw` is what the player can see: rays that reached the box. It
          // answers the owner's question and it is the before/after this task
          // is judged on.
          //
          // `vis` is what the player is FAIRLY OWED: everything not blocked by
          // a tight occluder is credited, because a gate hidden by something
          // that will be past in time is not a defect. That is what the build
          // gate compares against `need`.
          //
          // They are different numbers and collapsing them would let a fix that
          // merely moved occluders further away read as a fix that removed them.
          const raw = seenN / tot;
          const vis = (tot - tight) / tot;
          const need = READ_NEAR / d;
          const row = {
            d: +d.toFixed(1), lane: gt.lane, kind: gt.kind,
            raw: +raw.toFixed(2), vis: +vis.toFixed(2), need: +need.toFixed(2),
            // See the note where this is computed. Positive is inside the
            // line; 0 (or a value at the 1e-13 scale) is the exact tie
            // course.js's spacing floor produces by construction.
            tightBy: tightBy === -Infinity ? null : +tightBy.toPrecision(3),
            by: Object.keys(blame).sort((a, b) => blame[b] - blame[a])[0] || '',
            over: +(over / tot).toFixed(2),
            byOver: Object.keys(blameOver).sort((a, b) => blameOver[b] - blameOver[a])[0] || '',
          };
          seenBox.push(row);
          if (tight && vis < need) blank.push(row);
        }
      }

      // One line per offender, not one per (offender, gate) pair.
      const seen = new Set();
      const uniqLow = low.filter((e) => {
        const k = e.name + '@' + e.yMinLocal.toFixed(2);
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      const seen2 = new Set();
      const uniqHide = hide.filter((h) => {
        const k = h.el + '@' + h.gateZ;
        if (seen2.has(k)) return false; seen2.add(k); return true;
      });
      seenBox.sort((a, b) => a.d - b.d);
      return {
        elements: els.length, gates: gates.length,
        low: uniqLow.map((e) => ({ name: e.name, yMin: +e.yMinLocal.toFixed(2), z0: +e.z0.toFixed(1) })),
        hide: uniqHide,
        blank, gateVis: seenBox, readNear: +READ_NEAR.toFixed(2), readFar: READ_FAR,
        // Printed on every shot, pass or fail. A census is how a NEW overlay
        // gets noticed on the day it is added rather than the day it lands on
        // a hazard, which is the whole complaint against the assertions that
        // walked a fixed list.
        overlays: overlays.map((o) => ({
          name: o.name, d: +o.d.toFixed(1), op: +o.op.toFixed(2), mask: !!o.mask,
          x: +o.cx.toFixed(2), y: +o.cy.toFixed(2),
          w: +(o.hw * 2).toFixed(3), h: +(o.hh * 2).toFixed(3),
        })),
        drift,
        envelope,
      };
}

/**
 * THE CORRIDOR RULE ALONE, WALKED OVER A WHOLE COURSE.
 *
 * fairnessAudit above answers four questions about ONE INSTANT: it needs the
 * live camera, so it can only ever be asked about a frame somebody arranged to
 * be at. LOW is the one of the four that does not: "nothing reaches back over
 * the carriageway below OVERHEAD_Y" is a statement in WORLD space about the
 * scenery, with no lens in it at all. That is why it is cheap, and it is why
 * it can be asked about all 6,293 units of road instead of about a frame.
 *
 * So this streams the world forward with the draw stubbed out and asks
 * crossings() at every step, from the gun to the tape. Nothing is rendered and
 * nothing is simulated -- world.update(z) is the streaming call the frame loop
 * makes, and it is the whole cost.
 *
 * THE PREDICATE IS THE SAME ONE, DELIBERATELY IDENTICAL, and the two are in
 * one file so that stays true. shoot.js's LOW is
 *
 *     for (const e of els) if (e.yMinLocal < OY) low.push(e);
 *
 * and so is this. A sweep that tested a slightly different rule from the gate
 * would be reporting on a fork of the gate, which is the failure mode this
 * file exists to prevent.
 *
 * STEP, AND WHY IT IS 150. world.js spawns at VIEW = 210 ahead and releases at
 * BEHIND = 34, so everything within 210 units of the sample point is standing
 * when crossings() is called, and crossings() with no z bounds walks all of
 * it. Any step at or under 210 therefore visits every object at least once;
 * 150 leaves a 60-unit overlap so that an object straddling a sample boundary
 * is seen whole rather than in two halves, which matters because the z filter
 * inside crossings() is applied PER TRIANGLE and a half-seen object reports the
 * lowest point of its half.
 *
 * WHAT IT DOES NOT SEE, said here rather than by not being looked at: this is
 * a REST POSE. A part that only enters the corridor once its animation runs --
 * a swinging jib, a train, a stop paddle -- is tools/motion.js's subject, and
 * that file takes --date for the same reason this one exists.
 */
function corridorWalk(step, wantCensus) {
  const g = window.MR && MR.game;
  if (!g || !g.world || !g.world.crossings) return { skipped: 'world exposes no crossings()' };

  // Stop the page drawing and stop it animating. main.js re-registers its own
  // rAF from inside frame(), so replacing the function is enough to stop the
  // loop after the frame already in flight -- and that frame will find the
  // draw stubbed, so nothing rasterises. See tools/footroom.js, which uses the
  // same trick for the same reason: under swiftshader the draw is the cost and
  // the transforms are not.
  g.renderer.render = function () { };
  window.requestAnimationFrame = function () { return 1; };
  // The autopilot must not resolve gates while we are teleporting the world
  // down the course; nothing here reads pace, but a contact would fire audio
  // and the HUD for a run that is not happening.
  if (g.player) {
    g.player.handle = function () { };
    g.player.resolveGates = function () { return []; };
    g.player.resolveAid = function () { return []; };
  }

  const OY = g.world.OVERHEAD_Y;
  const TOTAL = MR.K.TOTAL_UNITS;
  const S = step || 150;
  // THE COVERAGE CLAIM, ASSERTED RATHER THAN COMMENTED.
  //
  // The walk only sees an object if the object is standing when crossings()
  // is called, and world.js spawns at VIEW ahead. A step wider than VIEW
  // therefore steps OVER stretches of road -- silently, and in the direction
  // that makes the sweep look clean. docs/roadmap.md's whole corrections list
  // is numbers nobody checked, so this one refuses to run rather than assume.
  const VIEW = MR.World && MR.World.VIEW;
  if (!VIEW) return { skipped: 'MR.World exposes no VIEW -- cannot prove the step covers the road' };
  if (S > VIEW) {
    return { skipped: 'step ' + S + ' is wider than the ' + VIEW + '-unit spawn distance, '
      + 'so the walk would step over road it never built' };
  }
  const low = [], seen = {};
  const census = {};
  let samples = 0, elements = 0;

  for (let z = 0; z <= TOTAL + MR.K.LANE; z += S) {
    // Lane 1 throughout. The racing line is the only thing world.update reads
    // the lane for, and the racing line is paint on the road -- it is exempt
    // from crossings() by userData.notScenery, so it cannot change the answer.
    g.world.update(z, 1);
    // The census is a traverse of the LIVE graph, not of the crossings list.
    // crossings() only names things that reach over the road, so a census
    // built from it would say the sweep had covered the game when what it had
    // covered was the game's gantries. The quayside crane that started all
    // this stood BESIDE the road at x 1.80-8.20 -- in the corridor, but a
    // census of overhead structure would still have listed it either way, and
    // a prop that never crosses at all would have been invisible to it.
    if (wantCensus) {
      g.scene.traverseVisible(function (o) {
        const n = o.userData && o.userData.auditName;
        if (n) census[n] = (census[n] || 0) + 1;
      });
    }
    const els = g.world.crossings();
    samples++;
    elements += els.length;
    for (const e of els) {
      if (e.yMinLocal >= OY) continue;
      // One row per offender per place on the course. The same pooled mesh
      // reappears every time it is claimed, so keying on the name alone would
      // report a repeated prop once and hide how much of the road it spoils.
      const k = e.name + '@' + Math.round(e.z0 / 24);
      if (seen[k]) continue;
      seen[k] = 1;
      low.push({
        name: e.name, yMin: +e.yMinLocal.toFixed(2), yMax: +e.yMaxLocal.toFixed(2),
        z0: +e.z0.toFixed(1), z1: +e.z1.toFixed(1), tris: e.tris,
        mile: +(e.z0 / MR.K.TOTAL_UNITS * MR.K.MARATHON_MILES).toFixed(2),
        setting: g.course.settingAt(Math.min(0.99999, e.z0 / MR.K.TOTAL_UNITS)).tag,
      });
    }
  }
  return { low, samples, elements, census, step: S, overheadY: OY, total: TOTAL, view: VIEW };
}

/**
 * Everything the world has a name for, at this instant. Not an assertion --
 * a coverage report, and the thing the day sample is actually sized against.
 *
 * The sample cannot be justified by "days" (a date is nothing but an RNG seed
 * here -- the calendar has no structure at all, nothing in src reads a month)
 * and it cannot be justified by settings alone (twelve of those, but what a
 * setting DRAWS depends on which biome leg it lands on). What it can be
 * justified against is the set of named objects the sweep has actually stood
 * in front of, which is what this collects.
 */
function sceneCensus() {
  const g = window.MR && MR.game;
  if (!g || !g.scene) return {};
  const out = {};
  g.scene.traverseVisible(function (o) {
    const n = o.userData && o.userData.auditName;
    if (n) out[n] = (out[n] || 0) + 1;
  });
  return out;
}

module.exports = {
  /** The audit, as source, for page.evaluate. */
  source: fairnessAudit.toString(),
  /** An expression string that runs it in the page and returns its report. */
  call: "(" + fairnessAudit.toString() + ")()",
  /** The world-space corridor rule over a whole course. See above. */
  corridorSource: corridorWalk.toString(),
  corridorCall: function (step, census) {
    return "(" + corridorWalk.toString() + ")(" + (step || 150) + "," + (census ? 'true' : 'false') + ")";
  },
  censusCall: "(" + sceneCensus.toString() + ")()",
};
