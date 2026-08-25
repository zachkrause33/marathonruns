#!/usr/bin/env node
/**
 * ROADREAD -- the blind acceptance test for road MARKINGS, as opposed to
 * blindread.js which is the blind acceptance test for hazard OBJECTS.
 *
 * ---- WHY THIS FILE EXISTS -------------------------------------------------
 *
 * THE SURGE ZONE THIS FILE WAS BUILT FOR HAS BEEN REMOVED, and the reason it
 * was removed is the reason this file exists. A previous pass painted it and
 * then checked it with a machine:
 * it projected the three lane centrelines through the real camera and took the
 * argmax of marking-hue pixels on the entry line. It scored 36 OF 36 and the
 * marking was, in fact, illegible. A blind reader shown twenty frames -- 14 of
 * them zone approaches at 88-90 units -- never once mentioned green paint, a
 * countdown or an arrow, and on a centre-lane entry at 90 units wrote:
 *
 *     "At normal size this is a bare road."
 *
 * AN ARGMAX OVER THREE FAINT VALUES RESOLVES CLEANLY ON A TINT NO HUMAN CAN
 * SEE. The machine test measured RECOVERABILITY -- is the answer present in
 * the pixels at all -- and reported it as LEGIBILITY. Those are different
 * questions and only the second one is the player's. This tool cannot ask the
 * second question either; only a reader can. What it does is stage the frames
 * so a reader CAN be asked, and keep the answer away from them while they are.
 *
 * ---- WHAT IT STAGES -------------------------------------------------------
 *
 *   tempo    a chase frame at a chosen distance before a tempo mat. Asks:
 *            which lane is marked and does it make you FASTER or SLOWER.
 *   gate     a chase frame at READ_NEAR before a three-lane gate. Asks which
 *            lane you take and what each one demands. This is the ROUTING
 *            control for removing the telegraph mats -- the question is
 *            whether a player can still pick a lane with no paint in front of
 *            any hazard, and it is the one that matters most.
 *   control  road with no zone within 260 units and no mat within 120. A
 *            reader who says "nothing here" on these is a reader whose
 *            SILENCES mean something, which is the whole reason they exist.
 *
 * ---- THE THREE DEFECTS INHERITED FROM blindread.js, KEPT FIXED -------------
 *
 * 1. THE FILENAME WAS A HINT. Panels are written OUTSIDE the repository under
 *    random hex names in a shuffled order, with the key in a separate
 *    directory the reader is never pointed at. The panel directory holds
 *    images and PROMPT.txt and nothing else -- no kind, no lane, no distance,
 *    no ordering.
 *
 * 2. THE READER IS CONTAMINATED AND THIS FILE CANNOT FIX IT. An agent reader
 *    run inside this repository gets CLAUDE.md injected before it sees a
 *    pixel. blindread.js documents the line that draws, and it is worth
 *    re-drawing for THIS pass because the leak is unusually favourable here:
 *    CLAUDE.md hands a reader the words obstacle, hazard, vehicle, barrier,
 *    sign, gantry, banner, lane change, road paint, telegraph mat, hill, chase
 *    camera. It does NOT contain the words surge, zone, countdown, tempo,
 *    faster, slower, green or red, and it contains no mapping from any colour
 *    to any effect. So a reader who names a green lane, a counted-down
 *    approach, or a fast-versus-slow marking is reading pixels; a reader who
 *    says "hazard" may be completing a sentence CLAUDE.md started.
 *
 *    The clean form is a reader run OUTSIDE this repository against a
 *    parentless branch holding the panels and PROMPT.txt only -- roadmap entry
 *    63's recipe, implemented in lanechoice-sets.js --push and reused here by
 *    --push. Use it when a session can be spawned; fall back to the
 *    contaminated form only for the questions the leak cannot reach.
 *
 * 3. THE RACE DOES NOT STOP. main.js drives its frame from the rAF timestamp,
 *    so freezing performance.now does not stop the runner and pooled objects
 *    are released out from under a staging tool. rAF is stubbed out here
 *    before anything is posed.
 *
 * ---- THE ONE DEFECT THIS FILE ADDED, AND WHAT IT COST ---------------------
 *
 * THE WINDOWED SPAWN IS MONOTONIC. state.roadFrom and state.structIdx only
 * ever go forward, so a harness that seeks BACKWARDS down the course
 * photographs a world with no road in it. The first version of this shot every
 * zone and then every mat, which is descending z half way through, and
 * produced frames of bare grass that looked exactly like a rendering bug in
 * somebody else's file. Shots are sorted by z and taken in one ascending
 * sweep, and the sweep asserts it.
 *
 *   node tools/roadread.js --out /tmp/rr --dates 2026-08-11,2026-08-12
 *   node tools/roadread.js --push /tmp/rr/panels --branch roadread-a
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}

const PUSH = arg('push', null);
const BRANCH = arg('branch', null);
const OUT = path.resolve(String(arg('out', path.join(os.tmpdir(), 'mr-roadread'))));
const DATES = String(arg('dates', '2026-08-11,2026-08-12,2026-08-13')).split(',');
const W = parseInt(arg('w', 390), 10);
const H = parseInt(arg('h', 844), 10);
const SEED = parseInt(arg('seed', String(Date.now() % 2147483647)), 10);

/**
 * The push half: git hash-object, git mktree, git commit-tree with NO PARENT,
 * git push. A reader session pointed at that branch has the panels and the
 * prompt and no repository to leak vocabulary from. Lifted from
 * lanechoice-sets.js, which is roadmap entry 63's recipe.
 */
if (PUSH) {
  if (!BRANCH) { console.log('--push needs --branch'); process.exit(1); }
  const dir = path.resolve(String(PUSH));
  const files = fs.readdirSync(dir).sort();
  const lines = [];
  for (const f of files) {
    const sha = execFileSync('git', ['hash-object', '-w', path.join(dir, f)], { cwd: ROOT })
      .toString().trim();
    lines.push('100644 blob ' + sha + '\t' + f);
  }
  const tree = execFileSync('git', ['mktree'], { cwd: ROOT, input: lines.join('\n') + '\n' })
    .toString().trim();
  const commit = execFileSync('git', ['commit-tree', tree, '-m',
    'roadread reader set: panels and PROMPT.txt only, parentless on purpose. Never merge.'],
    { cwd: ROOT }).toString().trim();
  execFileSync('git', ['push', '-f', 'origin', commit + ':refs/heads/' + BRANCH], { cwd: ROOT });
  console.log('pushed ' + files.length + ' files to ' + BRANCH + ' at ' + commit);
  process.exit(0);
}

// A tiny seeded shuffle, so a run is reproducible from its printed seed.
function rng(s) {
  let x = s >>> 0 || 1;
  return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

const PROMPT = `You are looking at still frames from a running game. The camera is
behind a runner on a three-lane road. You have never seen this game before and
nothing has been explained to you.

THE ROAD HAS EXACTLY THREE LANES, divided by broken lane lines. Anything beyond
the kerb -- pavement, grass, railings, water, crowds -- is not one of them. Call
them LEFT, MIDDLE and RIGHT as you see them.

Look at each image at its NORMAL SIZE first and answer from that. You may then
zoom in, but if something is only visible when enlarged, SAY SO -- that is the
single most useful thing you can tell us.

For EVERY image, answer these, and say plainly when the answer is "nothing":

  1. Is anything coming up that you would need to react to? What?
  2. Does anything in the picture single out ONE of the three lanes? Which lane,
     and what made you say so?
  3. Is there anything telling you HOW FAR AWAY something is? What, and how far?
  4. Is any lane marked in a way that suggests it would make you FASTER, or
     SLOWER? Which lane, and which effect?
  5. If you had to pick a lane to run in RIGHT NOW, which, and why?

Some of these images have nothing in them at all. Saying "nothing here" is a
correct and useful answer -- do not invent something to report.

Answer image by image, using the filename as the label. Be concrete about what
you actually see rather than what you think a running game would contain.
`;

(async () => {
  fs.mkdirSync(path.join(OUT, 'panels'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'key'), { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const rand = rng(SEED);
  const key = [];

  for (const date of DATES) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html') + '?date=' + date + '&skip=1&debug=1',
      { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(300);

    const plan = await page.evaluate(() => {
      window.requestAnimationFrame = function () { return 0; };
      // Strip everything that is not the canvas: the HUD names the mechanic in
      // words and a reader must not be handed the answer in a caption.
      for (const el of document.querySelectorAll('body > *')) {
        if (el.tagName !== 'CANVAS') el.style.display = 'none';
      }
      const g = MR.game, K = MR.K;
      const shots = [];
      const tempo = (g.course.tempo || []);
      const near = function (z) {
        for (const m of tempo) if (z > m.z0 - 100 && z < m.z1 + 30) return true;
        return false;
      };
      for (const m of tempo) {
        // 40, READ_NEAR and 12: past the decision point, AT it, and close
        // enough that a reader who can only see the paint late still says so.
        for (const d of [40, 25.35, 12]) {
          shots.push({ kind: 'tempo', z: m.z0 - d, dist: d, lane: m.lane, lanes: null, dir: m.dir });
        }
      }
      // Gates: every eighth live gate with at least one hazard, at READ_NEAR.
      const RN = 25.35;
      let n = 0;
      for (const gt of g.course.gates) {
        const occ = gt.lanes.filter(function (x) { return x !== K.CLEAR; }).length;
        if (!occ) continue;
        if ((n++ % 8) !== 0) continue;
        shots.push({ kind: 'gate', z: gt.z - RN, dist: RN, lane: -1,
          lanes: gt.lanes.slice(), dir: 0 });
      }
      // Controls: empty road, well clear of any marking.
      let ctrl = 0;
      for (let z = 420; z < K.TOTAL_UNITS - 400 && ctrl < 6; z += 97) {
        if (!near(z)) { shots.push({ kind: 'control', z, dist: 0, lane: -1, lanes: null, dir: 0 }); ctrl++; }
      }
      shots.sort(function (a, b) { return a.z - b.z; });
      return shots;
    });

    let last = -1e9;
    for (const sh of plan) {
      if (sh.z < last) throw new Error('shot list is not ascending -- see the header');
      last = sh.z;
      // Lane the runner is in. A gate panel is shot from the middle so no lane
      // is privileged by the runner's own position; the others too, for the
      // same reason.
      const pose = await page.evaluate(({ z }) => {
        const g = MR.game, K = MR.K;
        g.pace.units = z; g.pace.miles = z / K.TOTAL_UNITS * 26.2;
        g.world.update(z, 1);
        /**
         * ---- SEAT THE RUNNER ON THE ROAD, NOT AT ZERO --------------------
         *
         * This posed him at y = 0 and the road is a hill: at z where the
         * elevation is four units the runner was four units UNDER the tarmac.
         * A reader spotted it before I did, unprompted -- "the runner is
         * nearly gone: only the top of his red cap shows, flush with the road
         * surface" -- which is exactly the kind of thing a staging harness
         * puts in a panel and then attributes to the game.
         *
         * It does not touch the markings, which are drawn by world.update from
         * the course table and know nothing about the runner. But a panel with
         * a defect in it spends the reader's attention on the defect, and a
         * reader who reports it is a reader not answering the question.
         */
        const y = g.course.elevation ? g.course.elevation.at(z) : 0;
        g.runner.group.position.set(K.LANE_X[1], y, z);
        /**
         * ---- THE CAMERA HAS TO CONVERGE, AND EIGHT STEPS DID NOT ----------
         *
         * camera.js smooths toward the runner, so posing the runner does not
         * pose the camera: it walks there. Eight updates left it TENS OF UNITS
         * short, and on one panel that put the lens INSIDE a rideable vehicle
         * -- the frame came back with a flat cream slab over the near road,
         * which is the truck's own roof at DECK_Y seen from a lens sitting on
         * it. A reader called it, unprompted and correctly, "a rendering fault
         * rather than a designed obstacle".
         *
         * It was a staging fault. So the camera is stepped until it stops
         * moving, and then the result is ASSERTED rather than trusted -- an
         * instrument that can silently photograph the wrong place is the same
         * class of defect as one that measures the wrong thing.
         */
        let last = 1e9, cz = 0;
        for (let i = 0; i < 200; i++) {
          g.cam.update(0.5, { z, x: K.LANE_X[1], y, speed: 27.6, lean: 0, duck01: 0 });
          cz = g.cam.camera.position.z;
          if (Math.abs(cz - last) < 1e-4) break;
          last = cz;
        }
        g.renderer.render(g.scene, g.cam.camera);
        return { camZ: cz, want: z };
      }, { z: sh.z });
      // CAM_BASE_BACK is 4.35 and the camera banks and eases, so the tolerance
      // is generous -- what it is catching is a lens tens of units adrift, not
      // a centimetre of lag.
      const drift = Math.abs((sh.z - pose.camZ) - 4.35);
      if (drift > 3.0) {
        throw new Error('camera did not converge: wanted z ' + sh.z.toFixed(1)
          + ', lens landed at ' + pose.camZ.toFixed(1) + ' (drift ' + drift.toFixed(1) + 'u)');
      }
      const name = crypto.createHash('sha1')
        .update(date + ':' + sh.kind + ':' + sh.z + ':' + SEED).digest('hex').slice(0, 8);
      await page.screenshot({ path: path.join(OUT, 'panels', name + '.png') });
      key.push(Object.assign({ file: name + '.png', date, sort: rand() }, sh));
    }
    if (errs.length) console.log('PAGE ERRORS on ' + date + ': ' + errs.join(' | '));
    await ctx.close();
  }
  await browser.close();

  key.sort(function (a, b) { return a.sort - b.sort; });
  fs.writeFileSync(path.join(OUT, 'panels', 'PROMPT.txt'), PROMPT);
  fs.writeFileSync(path.join(OUT, 'key', 'key.json'), JSON.stringify(key, null, 1));
  const by = {};
  for (const k of key) by[k.kind] = (by[k.kind] || 0) + 1;
  console.log('seed ' + SEED);
  console.log('panels ' + key.length + ' in ' + path.join(OUT, 'panels'));
  console.log('  ' + Object.keys(by).map((k) => k + ' ' + by[k]).join('   '));
  console.log('key  ' + path.join(OUT, 'key', 'key.json') + '  (do not show a reader)');
})();
