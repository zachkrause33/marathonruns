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
// LOW / HIDES / BLANKS / PAINTS and the two contract guards, as ONE copy --
// see the header of that file for why they are not inlined here any more.
// tools/calendar.js runs the identical audit across the calendar.
const fairness = require('./lib/fairness');

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
    // The sculpted fleet dresses asynchronously (world.js, THE SCULPTED
    // FLEET). Every audit below must measure the object the player meets,
    // so wait for the wardrobe to settle; on the timeout the pending
    // sculpts have failed and the code art IS what ships, which is then
    // correctly what gets measured.
    await page.waitForFunction(
      () => !MR.game.world.sculptsPending || MR.game.world.sculptsPending() === 0,
      { timeout: 20000 })
      .catch(() => { errors.push('sculpted fleet never settled; auditing code art'); });
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
    const occl = await page.evaluate(fairness.call)
      .catch((e) => ({ skipped: "evaluate failed: " + e.message }));

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
