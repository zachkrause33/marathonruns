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
 *
 * Both are geometric, so a new prop is audited the day it is added rather than
 * the day somebody notices. Hazards, aid and the sky/ground/hills backdrop are
 * exempt and world.js says why at each exemption.
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
            const READ_FAR = (window.MR.Elevation && MR.Elevation.SIGHT_MIN) || 90;
            const gd = gt.z - camZ;
            if (gd < 26 || gd > READ_FAR) continue;
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
      return {
        elements: els.length, gates: gates.length,
        low: uniqLow.map((e) => ({ name: e.name, yMin: +e.yMinLocal.toFixed(2), z0: +e.z0.toFixed(1) })),
        hide: uniqHide,
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
    if (occl && !occl.skipped && (occl.low.length || occl.hide.length)) failed = true;
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
      for (const e of o.low.slice(0, 6)) {
        console.log(`  ! LOW: ${e.name} crosses the corridor at y=${e.yMin} (below OVERHEAD_Y)`);
      }
      for (const h of o.hide.slice(0, 6)) {
        console.log(`  ! HIDES: ${h.el} (y>=${h.elY}, z<=${h.elZ}) projects onto the `
          + `${['-', 'JUMP', 'DUCK', 'BLOCK'][h.kind]} in lane ${h.lane} at z=${h.gateZ} (${h.d}u ahead)`
          + ` -- scenery reaches ${h.elBottom} down the frame, hazard tops out at ${h.gateTop}`);
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

  console.log('\n' + (failed ? 'FAIL: page errors, missing state, a hazard the player cannot see, or one they cannot tell from the road' : 'OK: all shots clean'));
  process.exit(failed ? 1 : 0);
})();
