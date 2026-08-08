#!/usr/bin/env node
/**
 * Screenshot + instrumentation harness.
 *
 * This is the eyes of the review loop. It drives the real built index.html in
 * Chromium, so anything it captures or reports is true of the shipped file --
 * never of a mock or a builder's description of their own work.
 *
 *   node tools/shoot.js                       default set
 *   node tools/shoot.js --skip 60 --out x.png one frame deep into the race
 *   node tools/shoot.js --probe               console errors + perf + state
 *
 * Exit code is non-zero if the page threw, so a broken build cannot pass
 * review by producing a plausible-looking image.
 *
 * ---- OCCLUSION, and why it is a build failure ----------------------------
 *
 * This game is lost by hitting one thing. A hazard the player could not see
 * because a lamp post, a gantry or an overpass was drawn in front of it is not
 * a difficulty spike, it is the game taking a streak for something outside the
 * player's control -- the same class of defect as a page error, and worth
 * failing the build for.
 *
 * world.js states the rule ("anything reaching back over the carriageway does
 * so above OVERHEAD_Y", "nothing may be between the lens and the next gate")
 * and for a long time only stated it. It was false in two places at once: the
 * WALL overpass carried fascia bars across the road at y = 8.0 against an
 * OVERHEAD_Y of 9.0, and every mile gantry crossed the road at y = 3.5-6.0 --
 * squarely inside the band a BLOCK occupies, reproducible in one frame at
 * ?skip=190 where the MILE 21 sign passes through the runner's head.
 *
 * So the rule is checked here instead, against the live scene graph of the
 * frame that was just captured, in two parts:
 *
 *   LOW    world.crossings() walks every drawn triangle passing over the play
 *          corridor and reports the lowest. Any below OVERHEAD_Y fails.
 *   HIDES  every such crossing is projected through the real camera and
 *          compared with every live hazard BEHIND it, taken from
 *          MR.Collision.BOX rather than from the art. If the crossing's lowest
 *          screen row is below the hazard's highest, it is in front of a
 *          hazard on screen and the run fails.
 *   BLANKS every hazard against the hazards IN FRONT OF IT. See the long
 *          comment on it below; it is the one that was missing, and the thing
 *          it measures is the commonest occluder in the game.
 *   PAINTS  every hazard against the SCREEN-SPACE OVERLAYS. The three above all
 *          start from a list of world objects, so an object that turns
 *          depthTest off -- and is therefore in front of everything by
 *          construction -- appeared in none of them. This one walks the live
 *          scene and tests the property instead of the object.
 *
 * All four are geometric, so a new prop is audited the day it is added rather
 * than the day somebody notices. Aid and the sky/ground/hills backdrop are
 * exempt and world.js says why at each exemption.
 *
 * ---- WHAT THE FIRST TWO MISSED, FOR ELEVEN MONTHS ------------------------
 *
 * LOW and HIDES both walk world.crossings(), which returns OVERHEAD SCENERY.
 * So between them they answered exactly one question -- "is a prop in front of
 * a hazard" -- and never the question a player actually asks, which is "is a
 * HAZARD in front of a hazard". Measured by raycast against the live scene,
 * overhead structure accounts for 0% of the road the player cannot see, and it
 * always will: the camera looks DOWN at the road, so nothing above eye height
 * can ever be between the lens and the tarmac. That bucket was unreachable by
 * construction, and it was the only bucket being counted.
 *
 * What is in the other bucket, sampling the road from the commit point out to
 * SIGHT_MIN across four points in a race: 35% / 58% / 59% / 89% of the road
 * hidden, of which hazards are 26 / 51 / 48 / 89 points. Hazards ARE the
 * occluder, and the assertion had never once looked at them.
 *
 * The playtest note that opened this ("when there are so many obstacles back to
 * back it makes it a tad tough to see what's ahead of you") is that number in
 * words. So BLANKS below is the missing half, and it is deliberately landed
 * failing.
 *
 * ---- CONTRAST, and why that is a build failure too -----------------------
 *
 * The other way to lose a streak to something you could not see is for the
 * hazard to be the same colour as the tarmac. Measured on the reference, five
 * objects on the road they stand on: a guard rail at 2.56x the road's
 * luminance, a ramp deck at 2.49x, a tram roof at 2.10x -- and then a parked
 * car at 0.98x and a bin at 1.01x, both of which are still instantly legible
 * because their SATURATION differs from the road's by 0.38 and 0.22. Either
 * axis works. What never happens is an object matching the road on both.
 *
 *   CONTRAST  every hazard variant's area-weighted mean, measured against the
 *             local road in every lane, on the biome and setting palette live
 *             in that frame.
 *
 * world.js measures both sides (api.contrastAudit) because it owns the numbers
 * on both; this file owns the thresholds and the exit code. Every variant is
 * checked, including the ones that frame did not spawn, so the vocabulary is
 * audited in full on a single shot -- and the six shots between them sweep the
 * biome palettes the day drew.
 *
 * TWO THRESHOLDS, and the second one is why this does not simply fail today.
 *
 *   TARGET  1.6x luminance or 0.30 saturation. This is the spec's rule and it
 *           is reported per variant. It was read off the reference's STRONG
 *           objects -- the ones at 2.1x to 2.56x.
 *   GATE    1.25x or 0.22. This is what actually fails the build, and it is
 *           the WEAKEST object the same reference demonstrates is legible: the
 *           sunset trash can, L 73.7 on a road of 73.0, is 1.01x in luminance
 *           and is carried entirely by a saturation difference of 0.22.
 *
 * The reference's own trash can therefore fails the spec's own rule, which is
 * a real inconsistency in the source document and not a licence to relax
 * anything: the target is still printed for every variant, and four of our ten
 * are short of it. What the gate does is refuse the case the reference never
 * shows -- an object that is neither far enough in value NOR far enough in
 * chroma to be told from the tarmac by any measure. It is not a formality: it
 * fires on the real defect this audit was written and found. THE WALL pulled
 * the road 42% toward a pale dusty PINK while every BLOCK in the game is pink,
 * which put the marshal barrier at 1.11x the centre lane's luminance and 0.06
 * of its saturation. That shipped, and nothing said so.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}

// `--dir` keeps parallel agents from overwriting each other's frames.
const OUT = path.resolve(String(arg('dir', path.join(ROOT, 'shots'))));
fs.mkdirSync(OUT, { recursive: true });

const W = parseInt(arg('w', 1280), 10);
const H = parseInt(arg('h', 800), 10);
const PROBE = !!arg('probe', false);

// The default sweep: the start line, three points across the race where the
// biome and difficulty differ, and the finish.
const DEFAULT_SHOTS = [
  { name: '01-start', q: 'bot=1&nocount=1', settle: 900 },
  { name: '02-early', q: 'bot=1&skip=25', settle: 700 },
  { name: '03-mid', q: 'bot=1&skip=110', settle: 700 },
  { name: '04-wall', q: 'bot=1&skip=185', settle: 700 },
  { name: '05-final', q: 'bot=1&skip=225', settle: 700 },
  { name: '06-mobile', q: 'bot=1&skip=90', settle: 700, w: 420, h: 860 },
  // The owner's complaint frame, in the shape the game is actually played in.
  //
  // Not decoration, and not a duplicate of 04-wall. Occlusion between hazards
  // depends on where the EYE is laterally, and frameFor() ties that to the
  // aspect: a portrait frame follows the runner at 0.95 of his lane offset
  // against a desktop's 0.78, and sits 1.18 back against 1.00. So in portrait
  // the lens sits very nearly IN the player's lane, and a hazard in that lane
  // occludes everything behind it in that lane for the whole approach -- there
  // is no parallax left to open the sightline. 04-wall at 1280x800 reads two
  // gates clean that this frame reads at 20%. The stricter case is also the
  // real one.
  { name: '07-wall-tall', q: 'bot=1&skip=185', settle: 700, w: 620, h: 1344 },
  // The ghost level with the player, which no frame above photographs.
  //
  // ghost.js says the marker is on screen for four fifths of a good race and
  // that the pass is the moment the whole feature exists for -- and the six
  // frames above caught it at gaps of 0.7, 93, 79, 5, -66 and 93, i.e. never
  // once running alongside. That is exactly where its tag hangs lowest in the
  // frame, and PAINTS below has nothing to measure without it. Portrait for the
  // same reason 07 is: the plate is 0.52 of the frame wide there against 0.15
  // on the desktop, because size attenuation is off and the horizontal NDC
  // scale divides by the aspect.
  { name: '08-level', q: 'bot=1&skip=178', settle: 700, w: 620, h: 1344 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const single = arg('out', null);
  const shots = single
    ? [{ name: String(single).replace(/\.png$/, ''), q: arg('q', `bot=1&skip=${arg('skip', 30)}`), settle: parseInt(arg('settle', 800), 10) }]
    : DEFAULT_SHOTS;

  let failed = false;
  const report = [];

  for (const sh of shots) {
    const ctx = await browser.newContext({
      viewport: { width: sh.w || W, height: sh.h || H },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    // Warnings count as failures, with two known-benign exceptions. The
    // collision audit reports through console.warn, and for a long stretch it
    // was failing unnoticed because ad-hoc check scripts only collected
    // console.error -- the game was waving players through obstacles they were
    // visibly clipping and nothing said so. Anything unexpected fails the run.
    const BENIGN = /deprecated with r150|AudioContext was not allowed/;
    const errors = [];
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(t)) {
        errors.push(`${m.type()}: ${t}`);
      }
    });
    page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); failed = true; });

    // `--file` points at an alternate build so parallel agents can review
    // their own output without touching the shared index.html.
    const target = arg('file', null);
    const html = target ? path.resolve(String(target)) : path.join(ROOT, 'index.html');
    const url = 'file://' + html + '?' + sh.q + '&debug=1';
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 15000 })
      .catch(() => { errors.push('MR.game never became ready'); failed = true; });
    await page.waitForTimeout(sh.settle);

    const stat = await page.evaluate(() => {
      if (!window.MR || !MR.game) return null;
      const g = MR.game, p = g.pace;
      return {
        state: g.state,
        fps: Math.round(g.fps()),
        draws: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        miles: +p.miles.toFixed(3),
        raceTime: Math.round(p.raceTime),
        pace: +p.pace.toFixed(1),
        streak: p.streak,
        hits: p.hits,
        lane: g.player.lane,
        courseValid: g.course.valid.ok,
        gates: g.course.gates.length,
      };
    });

    // ---- fairness: nothing may hide a hazard --------------------------
    //
    // See the header comment on OCCLUSION below. Runs against the live scene
    // graph of the frame that was just captured, so what it asserts is true of
    // the image on disk.
    const occl = await page.evaluate(() => {
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
          let seenN = 0, tight = 0, tot = 0, over = 0;
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
    }).catch((e) => ({ skipped: 'evaluate failed: ' + e.message }));

    const file = path.join(OUT, sh.name + '.png');
    await page.screenshot({ path: file });

    // ---- fairness: a hazard must not match the road on both axes ------
    //
    // See the CONTRAST header comment. The measurement lives in world.js
    // (api.contrastAudit), because that file owns the numbers on
    // both sides; the RULE lives here, because a rule that does not fail a
    // build is a comment.
    const contrast = await page.evaluate(() => {
      const g = window.MR && MR.game;
      const w = g && g.world;
      if (!w || !w.contrastAudit) return { skipped: 'world exposes no contrastAudit()' };
      const a = w.contrastAudit(g.renderer, g.scene);
      const tones = a.hazards, roads = a.roads;
      // TARGET is the spec's rule, read off the reference's STRONG objects.
      // GATE is the weakest object the same reference demonstrates is legible:
      // the sunset trash can, L 73.7 on a road of 73.0 -- 1.01x -- carried
      // entirely by a saturation difference of 0.22. See the header.
      const T_L = 1.6, T_S = 0.30;
      const G_L = 1.25, G_S = 0.22;
      const fail = [], worst = [];
      for (const h of tones) {
        let hardest = null;
        for (const r of roads) {
          const ratio = Math.max(h.L, r.L) / Math.max(1e-6, Math.min(h.L, r.L));
          const dS = Math.abs(h.S - r.S);
          // The margin by which the pair clears the easier of the two tests.
          // Negative means it clears neither.
          const m = Math.max(ratio / T_L - 1, dS / T_S - 1);
          const gm = Math.max(ratio / G_L - 1, dS / G_S - 1);
          const row = { name: h.name, lane: r.lane, hL: h.L, rL: r.L, hS: h.S, rS: r.S,
            ratio: +ratio.toFixed(2), dS: +dS.toFixed(3),
            margin: +m.toFixed(3), gate: +gm.toFixed(3) };
          if (!hardest || gm < hardest.gate) hardest = row;
        }
        worst.push(hardest);
        if (hardest.gate < 0) fail.push(hardest);
      }
      worst.sort((a, b) => a.gate - b.gate);
      const short = worst.filter((w) => w.margin < 0);
      return { tones: tones.length, roads, worst, fail, short, T_L, T_S, G_L, G_S };
    }).catch((e) => ({ skipped: 'evaluate failed: ' + e.message }));

    report.push({ shot: sh.name, file, stat, errors, occl, contrast });

    if (errors.length) failed = true;
    if (occl && !occl.skipped
      && (occl.low.length || occl.hide.length || occl.blank.length || occl.drift
          || (occl.envelope && occl.envelope.bad && occl.envelope.bad.length))) failed = true;
    if (contrast && !contrast.skipped && contrast.fail.length) failed = true;
    await ctx.close();
  }

  await browser.close();

  for (const r of report) {
    console.log(`\n=== ${r.shot} ===`);
    if (r.stat) {
      const s = r.stat;
      console.log(`  fps ${s.fps}  draws ${s.draws}  tris ${s.tris}`);
      console.log(`  mile ${s.miles}  clock ${s.raceTime}s  pace ${s.pace}s/mi  streak ${s.streak}  hits ${s.hits}`);
      console.log(`  course ${s.gates} gates, valid=${s.courseValid}`);
    } else {
      console.log('  NO STATE -- page did not initialise');
    }
    for (const e of r.errors.slice(0, 8)) console.log('  ! ' + e);
    const o = r.occl;
    if (o && !o.skipped) {
      console.log(`  overhead ${o.elements} crossings, ${o.gates} live hazards`);
      if (o.drift) console.log('  ! DRIFT: ' + o.drift);
      if (o.envelope && o.envelope.bad) {
        for (const e of o.envelope.bad) console.log('  ! ENVELOPE: ' + e + ' -- art may not leave its own collision box');
      }
      // The whole table once, on the first shot. The fleet is identical in
      // every frame, and a guard that only prints its failures cannot show
      // that the envelope was grown into -- which is the thing this pass was
      // asked for.
      if (o.envelope && o.envelope.slack && r === report[0]) {
        console.log('  envelope, swept art vs MR.Collision.BOX  (halfX/box, halfZ/box, yMax/box)');
        for (const e of o.envelope.slack) {
          console.log(`    ${e.name.padEnd(9)} x ${e.halfX.toFixed(2)}/${e.boxHalfX}`
            + `   z ${e.halfZ.toFixed(2)}/${e.boxHalfZ}`
            + `   y ${e.yMax.toFixed(2)}/${e.boxYMax}${e.overY > 0 ? '  OVER by ' + e.overY : ''}`);
        }
      }
      for (const e of o.low.slice(0, 6)) {
        console.log(`  ! LOW: ${e.name} crosses the corridor at y=${e.yMin} (below OVERHEAD_Y)`);
      }
      for (const h of o.hide.slice(0, 6)) {
        console.log(`  ! HIDES: ${h.el} (y>=${h.elY}, z<=${h.elZ}) projects onto the `
          + `${['-', 'JUMP', 'DUCK', 'BLOCK'][h.kind]} in lane ${h.lane} at z=${h.gateZ} (${h.d}u ahead)`
          + ` -- scenery reaches ${h.elBottom} down the frame, hazard tops out at ${h.gateTop}`);
      }
      // The whole table, pass or fail. The point of this assertion is the
      // before/after, and a build that only prints its failures cannot show one.
      if (o.gateVis && o.gateVis.length) {
        console.log(`  gate sightlines, ${o.readNear}u to ${o.readFar}u  `
          + '(seen% / owed%, and [credited%] when they differ)');
        const byD = {};
        for (const r of o.gateVis) (byD[r.d] = byD[r.d] || []).push(r);
        for (const k of Object.keys(byD).sort((a, b) => a - b)) {
          console.log('    ' + byD[k].map((r) =>
            `${String(r.d).padStart(5)}u ${['-', 'JUMP', 'DUCK', 'BLOCK'][r.kind].padEnd(5)} L${r.lane}`
            + ` ${String(Math.round(r.raw * 100)).padStart(3)}%/${Math.round(r.need * 100)}%`
            + (r.vis > r.raw ? `[${Math.round(r.vis * 100)}%]` : '')).join('  '));
        }
      }
      if (o.overlays) {
        console.log(`  screen-space overlays (depthTest off): ${o.overlays.length}`
          + (o.overlays.length ? '  ' + o.overlays.map((v) =>
              `${v.name} at ${v.d}u, ${v.w}x${v.h} NDC centred ${v.x},${v.y}`
              + `${v.mask ? '' : ' (no alpha -- whole quad counted)'}`).join('; ') : ''));
      }
      for (const b of o.blank.slice(0, 8)) {
        if (b.over > 0) {
          console.log(`  ! PAINTS: the ${['-', 'JUMP', 'DUCK', 'BLOCK'][b.kind]} in lane ${b.lane} `
            + `${b.d}u ahead is ${Math.round(b.vis * 100)}% visible and is owed `
            + `${Math.round(b.need * 100)}% -- ${Math.round(b.over * 100)}% of its face is painted `
            + `over by ${b.byOver}, which has depthTest off, so nothing in the scene can `
            + 'get in front of it and passing it never gives the read back');
        } else {
          console.log(`  ! BLANKS: the ${['-', 'JUMP', 'DUCK', 'BLOCK'][b.kind]} in lane ${b.lane} `
            + `${b.d}u ahead is ${Math.round(b.vis * 100)}% visible and is owed `
            + `${Math.round(b.need * 100)}% -- hidden by the ${b.by}, which is under `
            + `${o.readNear}u in front of it, so passing it does not give the read back in time`);
        }
      }
    } else if (o && o.skipped) {
      console.log('  occlusion audit skipped: ' + o.skipped);
    }
    const c = r.contrast;
    if (c && !c.skipped) {
      const rd = c.roads.map((x) => `L${x.L}/S${x.S}`).join('  ');
      console.log(`  road L/S by lane  ${rd}`);
      const t = c.worst[0];
      console.log(`  hazard contrast ${c.tones} variants, tightest ${t.name} vs lane ${t.lane}: `
        + `${t.ratio}x L, ${t.dS} S  (gate ${t.gate >= 0 ? '+' : ''}${t.gate}, target ${t.margin})`);
      if (c.short.length) {
        console.log(`  short of the ${c.T_L}x / ${c.T_S} target (reported, not fatal): `
          + c.short.map((s) => `${s.name} ${s.ratio}x/${s.dS}S@L${s.lane}`).join(', '));
      }
      for (const f of c.fail.slice(0, 8)) {
        console.log(`  ! CONTRAST: ${f.name} is L=${f.hL} S=${f.hS} on a lane-${f.lane} road of `
          + `L=${f.rL} S=${f.rS} -- ${f.ratio}x luminance (gate ${c.G_L}) and ${f.dS} saturation `
          + `(gate ${c.G_S}). It matches the tarmac on both axes.`);
      }
    } else if (c && c.skipped) {
      console.log('  contrast audit skipped: ' + c.skipped);
    }
  }

  console.log('\n' + (failed ? 'FAIL: page errors, missing state, a hazard the player cannot see (behind scenery or behind another hazard), or one they cannot tell from the road' : 'OK: all shots clean'));
  process.exit(failed ? 1 : 0);
})();
