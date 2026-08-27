#!/usr/bin/env node
/**
 * RIDEHOLD -- is the lorry still on the road for every unit of its deck?
 *
 * ---- WHY THIS IS NOT ALREADY tools/deckdrop.js ---------------------------
 *
 * deckdrop stubs player.resolveDeck and WRITES player.surface, so the deck it
 * measures is imposed: there is no vehicle mesh under the runner and the file
 * says so plainly ("THE WORLD DOES NOT KNOW"). That is the right instrument
 * for its subject -- camera framing through a dismount -- and exactly the
 * wrong one for this subject, which is whether the world keeps the vehicle
 * ITSELF alive for as long as someone can be standing on it.
 *
 * Nothing did. The pool-release loop in world.js compared the gate LINE
 * against the reclaim threshold (z - BEHIND, BEHIND = 34), and a train is one
 * gate carrying up to 60.1 units of vehicle nose-anchored FORWARD of that
 * line (2 * halfZ * (1 + span*0.9), ROOF_SPAN_MAX = 16). So the deeper decks
 * had up to 26 units of ride past the point where the pool had already taken
 * the lorry back: the runner ran on the invisible-but-solid course data until
 * the dismount. Every gate passed -- deckdrop 24/24, shoot clean, playthrough
 * green -- because every gate was aimed elsewhere. The owner found it on a
 * phone, mid-ride.
 *
 * ---- WHAT IS MEASURED ----------------------------------------------------
 *
 * The real page is booted, the rAF pump is taken so the game loop is frozen,
 * and the REAL world.update(z, lane) is hand-driven monotonically down the
 * whole course in half-unit steps. At every step, for every train gate whose
 * deck the runner could be standing on (gate.z <= z <= gate.z + depth), the
 * gate must still be present in liveCast() with a visible variant. It causes
 * the observation instead of waiting for a bot to ride a ramp -- the first
 * draft of this probe did wait, and collected zero deck samples.
 *
 * Audited before it was believed, per the standing rule about instruments:
 * against the pre-fix build it reports 128 vanished-underfoot samples of 796,
 * the first at 34.1 units into a 53-unit deck -- the BEHIND line to the
 * sample. Against the fixed build, 0 of 796.
 *
 *   node tools/ridehold.js               today's course
 *   node tools/ridehold.js --file x.html against an alternate build
 *   node tools/ridehold.js --json        machine-readable
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}
const FILE = arg('file', null);
const JSON_OUT = !!arg('json', false);

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const html = FILE ? path.resolve(String(FILE)) : path.join(ROOT, 'index.html');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + html + '?bot=1&nosave=1&debug=1', { waitUntil: 'load' });
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, null, { timeout: 60000 });
  await page.waitForTimeout(600);

  // Freeze the loop the way deckdrop does: capture the pump, never fire it.
  // The wait below is on a TIMER, not a frame -- waitForFunction polls through
  // the requestAnimationFrame this harness has just replaced.
  await page.evaluate(() => {
    window.__rh = { pump: null };
    window.requestAnimationFrame = function (cb) { window.__rh.pump = cb; return 1; };
  });
  let handed = false;
  for (let i = 0; i < 60 && !handed; i++) {
    handed = await page.evaluate(() => !!(window.__rh && window.__rh.pump));
    if (!handed) await page.waitForTimeout(100);
  }
  if (!handed) {
    console.log('RIDEHOLD  FAIL: the game loop never handed over a frame');
    await browser.close(); process.exit(1);
  }

  const out = await page.evaluate(() => {
    const g = MR.game, K = MR.K;
    const halfZ = MR.Collision.BOX[K.BLOCK].halfZ;
    const trains = g.course.gates
      .filter((gt) => gt.train)
      .map((gt) => ({ z: gt.z, depth: 2 * halfZ * (1 + gt.train * 0.9) }));
    if (!trains.length) return { error: 'no train gates on this course -- nothing measured' };
    const end = g.course.gates[g.course.gates.length - 1].z + 60;
    const holes = [];
    let deckSamples = 0;
    for (let z = 0; z <= end; z += 0.5) {
      g.world.update(z, 1);
      const live = g.world.liveCast();
      for (const t of trains) {
        if (z < t.z || z > t.z + t.depth) continue;   // runner not on this deck
        deckSamples++;
        const row = live.find((c) => Math.abs(c.z - t.z) < 0.01 && c.kind === K.BLOCK);
        if (!row || row.variant < 0) {
          holes.push({
            gateZ: +t.z.toFixed(1), depth: +t.depth.toFixed(1),
            into: +(z - t.z).toFixed(1), present: !!row,
          });
        }
      }
    }
    return {
      trains: trains.length, deckSamples, holes,
      deepest: +Math.max.apply(null, trains.map((t) => t.depth)).toFixed(1),
    };
  });
  await browser.close();

  const failed = !!(out.error || (out.holes && out.holes.length) || errs.length);
  if (JSON_OUT) {
    console.log(JSON.stringify({ ...out, pageErrors: errs, ok: !failed }, null, 1));
    process.exit(failed ? 1 : 0);
  }
  console.log('');
  console.log('RIDEHOLD -- every train gate must stay cast while a rider can stand on it');
  if (out.error) {
    console.log('  ! ' + out.error);
  } else {
    console.log('  ' + out.trains + ' train gates, deepest ' + out.deepest
      + ' units, ' + out.deckSamples + ' on-deck half-unit samples');
    console.log('  vanished underfoot: ' + out.holes.length);
    if (out.holes.length) {
      const worst = out.holes.reduce((a, c) => (c.into > a.into ? c : a), out.holes[0]);
      console.log('  first: gate z ' + out.holes[0].gateZ + ', gone at '
        + out.holes[0].into + ' of ' + out.holes[0].depth + ' units');
      console.log('  worst: ' + worst.into + ' of ' + worst.depth + ' units');
    }
  }
  for (const e of errs) console.log('  ! pageerror: ' + e);
  console.log('  ' + (failed ? 'FAIL' : 'PASS'));
  process.exit(failed ? 1 : 0);
})();
