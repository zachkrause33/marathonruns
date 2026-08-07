#!/usr/bin/env node
/**
 * The run cycle, measured and photographed.
 *
 * The character animation is procedural: one normalised `phase`, and every
 * joint a closed-form function of it (see the header of src/render/runner.js).
 * That makes it cheap to change and very easy to change in the wrong
 * direction, because "does it look alive" is not a thing a diff can answer.
 * This is the instrument for that question, and it does three jobs:
 *
 *   SKATE   The runner never moves; the world scrolls past. So a foot that is
 *           genuinely planted must travel BACKWARD through the rig at exactly
 *           the ground speed for as long as it is down. A foot that holds
 *           still in rig space is sliding along the road at 100% of race pace,
 *           which is the single most common tell of a procedural run cycle and
 *           the thing the owner named as important. Reported as a percentage
 *           of ground speed, where 0% is a perfect plant.
 *
 *   TRAVEL  How far each joint actually moves across a stride. A run cycle
 *           that reads as mechanical is usually one where the limbs travel and
 *           the body does not, so this prints the whole hierarchy -- pelvis,
 *           spine, chest, head, hands, feet -- and lets "the torso doesn't
 *           participate" be a number rather than an impression.
 *
 *   SHEET   A contact sheet: the cycle sampled at N phases, from behind (the
 *           camera the game actually uses) and from the side (where a run pose
 *           is legible). One PNG per view, so before and after can be laid
 *           side by side.
 *
 * Usage:
 *   node tools/stride.js                       measure + sheets at race pace
 *   node tools/stride.js --speed lo|hi         at the slow or fast end
 *   node tools/stride.js --tag before          name the artefacts
 *   node tools/stride.js --dir /tmp/x          where to write them
 *   node tools/stride.js --polish 0            with the polish terms disabled
 *
 * `--polish` is the A/B. Every term added by the animation-polish work is
 * scaled by MR.Runner.POLISH, so one build renders both the old cycle and the
 * new one and the comparison cannot drift out of date the way a checked-in
 * "before" screenshot does.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

const TAG = arg('tag', 'now');
const DIR = path.resolve(arg('dir', path.join(ROOT, 'shots', 'stride')));
const SPEED = arg('speed', 'mid');
const POLISH = arg('polish', null);
const N = parseInt(arg('n', 12), 10);          // frames across one full stride
const FILE = arg('file', path.join(ROOT, 'index.html'));

fs.mkdirSync(DIR, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 520 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() !== 'log' && !/deprecated|AudioContext/i.test(m.text())) {
      errs.push(m.type() + ' ' + m.text().slice(0, 140));
    }
  });

  await page.goto('file://' + FILE + '?bot=1&skip=60');
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(600);

  // Freeze the game loop so the rig is ours alone. Everything after this point
  // poses and renders explicitly, which is what makes a phase sweep possible
  // at all -- otherwise the next animation frame overwrites the pose before
  // the screenshot lands.
  await page.evaluate(() => { window.requestAnimationFrame = function () { return 0; }; });

  const setup = await page.evaluate((polish) => {
    if (polish !== null && MR.Runner && 'POLISH' in MR.Runner) MR.Runner.POLISH = parseFloat(polish);
    return {
      polish: MR.Runner && 'POLISH' in MR.Runner ? MR.Runner.POLISH : null,
      lo: (MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.START_PACE,
      hi: (MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.FLOOR_PACE,
    };
  }, POLISH);
  const speed = SPEED === 'lo' ? setup.lo : SPEED === 'hi' ? setup.hi : (setup.lo + setup.hi) / 2;

  // ---- measurement -------------------------------------------------------
  const m = await page.evaluate(({ speed, N }) => {
    const g = MR.game, r = g.runner;
    const rig = r.parts;
    const root = r.group;

    // Sub-stepping matters: the skate figure is a derivative, and sampling it
    // at the 12 phases of the contact sheet would alias a fast contact event
    // into a slow one.
    const STEPS = 720;
    const dt = 1 / 240;

    // Track the two feet by their ankle pivots and, separately, by the lowest
    // point of the shoe mesh -- the ankle is where the joint is, the sole is
    // what touches the road.
    const feet = r.parts.legs.map((L) => L.ankle);
    // The MITT, not the elbow pivot. A pivot is a child of the joint above it,
    // so the elbow pivot is moved by the shoulder and by nothing the elbow
    // does -- every "hand" figure this tool printed was a shoulder figure,
    // including one quoted to the owner as evidence for arm work. Same class
    // as tracking the head at the neck pivot. -0.258 is the mitt's own centre
    // in elbow space, read from runner.js.
    const hands = r.parts.arms.map(function (A) {
      const m = new THREE.Object3D();
      m.position.set(0, -0.258, 0);
      A.elbow.add(m);
      return m;
    });

    // The sole, not the ankle. The ankle pivot sits ~0.15 above the bottom of
    // the shoe, so reporting the pivot as "lowest sole" overstates the gap to
    // the road by most of a shoe -- which it did, on the first run of this.
    const _box = new THREE.Box3();
    const soleY = (ankle) => { _box.setFromObject(ankle); return _box.min.y; };

    const v = new THREE.Vector3();
    const world = (o) => { o.updateWorldMatrix(true, false); return v.setFromMatrixPosition(o.matrixWorld).clone(); };

    // Run the cycle forward from a known phase so the sweep is reproducible.
    r.phase = 0;
    // SETTLE BEFORE MEASURING, for the same reason the contact sheets settle.
    //
    // The page runs ~600ms of real game at whatever ?skip= produces before
    // this tool re-poses the rig at lo/mid/hi. Any filter driven by the
    // HISTORY of a value -- not by the posed value itself -- then sees that
    // jump as a real event and reports its transient as the steady state. It
    // was harmless while every filter was seeded lazily off its own pose;
    // it stopped being harmless the moment a term was driven by the
    // derivative of `speed`, which reads the re-pose as an acceleration.
    //
    // Measured: chest fore/aft inflated 3.3x cold against settled (0.0264 vs
    // 0.0080), hand vertical +0.0508 at top pace. Sixth defect found in this
    // file by an agent rather than by me, and the sixth to flatter the work.
    for (let k = 0; k < 300; k++) r.update(1 / 120, { speed });
    r.update(0, { speed });
    root.updateWorldMatrix(true, true);

    // Track the joints that HANG OFF the trunk pivots, not the pivots
    // themselves. `hips` and `chest` rotate about their own origins, so their
    // positions only ever report the bob however hard the pelvis is working --
    // the first version of this table printed 0.0000 lateral for the pelvis on
    // a rig that does rotate it, which is a measurement saying nothing.
    // A hip socket 0.11 out from the spine is what pelvis rotation actually
    // moves, and it is also what the eye reads.
    // `parts.head` is a pivot whose local position is (0,0,0) in the run, so
    // its world position IS the neck joint and tracking it reports the neck.
    // A marker parented into head space at the skull centre reports the skull.
    const skull = new THREE.Object3D();
    skull.position.set(0, 0.36, 0);
    rig.head.add(skull);

    const track = {
      pelvis: rig.hips, hipL: r.parts.legs[0].hip, shoulderL: r.parts.arms[0].shoulder,
      chest: rig.chest, head: skull,
      handL: hands[0], handR: hands[1], footL: feet[0], footR: feet[1],
    };
    const box = {};
    for (const k in track) box[k] = { min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9) };

    let prev = {}, first = true;
    const skate = [];      // one entry per sample where a foot is in contact
    let minFootY = 1e9;
    const phases = [];

    for (let i = 0; i <= STEPS; i++) {
      r.update(dt, { speed });
      root.updateWorldMatrix(true, true);
      const now = {};
      for (const k in track) {
        now[k] = world(track[k]);
        box[k].min.min(now[k]); box[k].max.max(now[k]);
      }
      // Which foot is down: the lower ankle, and only while it is within a
      // whisker of its own lowest reach across the cycle.
      const lo = now.footL.y < now.footR.y ? 'footL' : 'footR';
      // Height above the ROAD, not above world zero -- the road moves now that
      // there are hills, and an absolute y would report the terrain.
      const roadY = root.position.y;
      minFootY = Math.min(minFootY, soleY(lo === 'footL' ? feet[0] : feet[1]) - roadY);
      if (!first) {
        // Rig-space z velocity of the planted ankle. The runner never
        // translates -- the world scrolls past -- so a foot in real contact
        // with the road must travel BACKWARD through the rig at the ground
        // speed. Forward motion while down is the moonwalk tell.
        const vz = (now[lo].z - prev[lo].z) / dt;
        skate.push({ y: now[lo].y - roadY, vz, phase: r.phase });
      }
      prev = now; first = false;
      phases.push(r.phase);
    }

    // Contact = the lowest 25% of the foot's vertical range. Wider than a real
    // footstrike on purpose: a cycle that only plants for an instant is itself
    // the defect, and a narrow window would hide it.
    const ys = skate.map((s) => s.y);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const cut = yMin + (yMax - yMin) * 0.25;
    const down = skate.filter((s) => s.y <= cut);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const skatePct = mean(down.map((s) => Math.abs(s.vz + speed) / speed * 100));
    const worstPct = Math.max(...down.map((s) => Math.abs(s.vz + speed) / speed * 100));
    // The mean rig velocity of the planted foot, signed, which is the number a
    // change to the cycle can actually move. Negative is backward, i.e. the
    // foot pushing against the road.
    const plantVz = mean(down.map((s) => s.vz));
    // And the ceiling, so nobody chases an impossible target. The foot can
    // only travel as far as the rig lets it in the time contact lasts, so the
    // fastest backward plant this cycle can produce is its fore/aft foot range
    // divided by the contact duration.
    const zs = skate.map((s) => s.z || 0);
    const period = 1 / (2.55 * Math.pow(speed / ((MR.K.UNITS_PER_MILE * MR.K.TIME_SCALE) / MR.K.START_PACE), 0.72));
    // Halved, and the halving is the point. `down` is sampled from whichever
    // foot is lower, so it spans BOTH feet's contacts within one period, while
    // travel.footL.z is ONE foot's range. Dividing one by the other made the
    // ceiling twice as pessimistic as the rig really is -- it reported a floor
    // of 81% skate that stage 1 then beat, at 73.1%, without exaggerating
    // anything. A bound nobody checked is worse than no bound.
    const contactSec = period * (down.length / skate.length) / 2;

    const travel = {};
    for (const k in box) {
      travel[k] = {
        x: +(box[k].max.x - box[k].min.x).toFixed(4),
        y: +(box[k].max.y - box[k].min.y).toFixed(4),
        z: +(box[k].max.z - box[k].min.z).toFixed(4),
      };
    }
    return {
      speed: +speed.toFixed(2),
      contactFrac: +(down.length / skate.length).toFixed(3),
      contactSec: +contactSec.toFixed(4),
      skatePct: +skatePct.toFixed(1),
      worstPct: +worstPct.toFixed(1),
      plantVz: +plantVz.toFixed(3),
      // What the rig could manage if the whole fore/aft foot range were spent
      // moving backward over the contact window.
      bestVz: +(-travel.footL.z / contactSec).toFixed(3),
      minFootY: +minFootY.toFixed(4),
      travel,
    };
  }, { speed, N });

  // ---- contact sheets ----------------------------------------------------
  // Two views. BEHIND is the camera the game ships; SIDE is where a run pose
  // can actually be read, and is the one an animator would ask for.
  const VIEWS = {
    behind: { pos: [0, 1.15, -3.1], look: [0, 0.85, 0] },
    side: { pos: [3.2, 1.05, 0.1], look: [0, 0.85, 0] },
  };
  //
  // All N poses go into ONE canvas via scissored viewports and one screenshot,
  // rather than N screenshots stitched afterwards. That removes an ImageMagick
  // dependency the container does not have, and it also removes the class of
  // bug where the tiles come from different frames.
  const TW = 200, TH = 300;
  const sheets = [];
  // The page viewport has to be at least as large as the sheet: a screenshot
  // clip outside the viewport comes back cropped, which silently produced a
  // two-tile "twelve-frame" sheet the first time this ran.
  //
  // And the resize must be allowed to SETTLE before the first sheet is drawn.
  // setViewportSize fires a resize event, the game's own handler repaints the
  // whole canvas, and that repaint lands on top of whichever view is rendered
  // first -- so the first sheet came out as a single wide panorama of the game
  // rather than twelve tiles, every time, while the second was correct. It was
  // committed to reference/ and described as a contact sheet before anyone
  // opened it.
  await page.setViewportSize({ width: TW * N, height: TH });
  await page.waitForTimeout(400);
  for (const view of Object.keys(VIEWS)) {
    await page.evaluate(({ view, N, speed, V, TW, TH }) => {
      const g = MR.game, r = g.runner;
      const el = g.renderer.domElement;
      el.style.position = 'fixed';
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.zIndex = '99999';
      g.renderer.setSize(TW * N, TH, false);
      el.style.width = (TW * N) + 'px';
      el.style.height = TH + 'px';
      g.renderer.setScissorTest(true);
      g.renderer.clear();
      // Advance the rig in REAL TIME to each phase rather than teleporting
      // `phase` and posing with dt = 0.
      //
      // dt = 0 means the secondary-motion integrator steps by zero, so every
      // spring in the file holds whatever value it happened to carry -- the
      // hood read an identical -0.010023 in all twelve tiles. Secondary motion
      // has never once appeared in a contact sheet produced by this tool, and
      // could not have, which means "look at the sheets" was incapable of
      // judging the stage of this work that is entirely about springs.
      //
      // Settle first so the springs are on their limit cycle rather than
      // showing their start-up transient in tile 0.
      const SDT = 1 / 120;
      for (let k = 0; k < 240; k++) r.update(SDT, { speed });
      for (let i = 0; i < N; i++) {
        const target = i / N;
        // Step until the phase reaches this tile's target, wrapping once.
        for (let k = 0; k < 4000; k++) {
          const before = r.phase;
          r.update(SDT, { speed });
          if (r.phase >= target && (before < target || r.phase < before)) break;
        }
        const cam = new THREE.PerspectiveCamera(34, TW / TH, 0.1, 60);
        const o = r.group.position;
        cam.position.set(o.x + V[view].pos[0], o.y + V[view].pos[1], o.z + V[view].pos[2]);
        cam.lookAt(o.x + V[view].look[0], o.y + V[view].look[1], o.z + V[view].look[2]);
        g.renderer.setViewport(i * TW, 0, TW, TH);
        g.renderer.setScissor(i * TW, 0, TW, TH);
        g.renderer.render(g.scene, cam);
      }
      g.renderer.setScissorTest(false);
    }, { view, N, speed, V: VIEWS, TW, TH });
    const out = path.join(DIR, `${TAG}-${view}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: TW * N, height: TH } });
    sheets.push(out);
  }
  if (errs.length) console.log(errs.slice(0, 4).join('\n'));
  await browser.close();

  // ---- report ------------------------------------------------------------
  const t = m.travel;
  console.log('');
  console.log(`run cycle  tag=${TAG}  polish=${setup.polish === null ? '(no A/B hook)' : setup.polish}  speed=${m.speed} u/s (${SPEED})`);
  console.log('');
  console.log('FOOT PLANT');
  console.log(`  contact window      ${(m.contactFrac * 100).toFixed(0)}% of the stride = ${(m.contactSec * 1000).toFixed(0)} ms`);
  console.log(`  planted foot moves  ${m.plantVz > 0 ? '+' : ''}${m.plantVz} u/s in rig space   (the road passes at -${m.speed})`);
  console.log(`                      ${m.plantVz > 0 ? 'FORWARD -- the moonwalk tell' : 'backward, pushing against the road'}`);
  console.log(`  skate               ${m.skatePct}% of ground speed, worst sample ${m.worstPct}%`);
  console.log(`  what the rig allows ${m.bestVz} u/s if the whole fore/aft foot range went backward over the contact`);
  console.log(`                      -- so ${(100 * (1 - Math.abs(m.bestVz) / m.speed)).toFixed(0)}% skate is this rig's FLOOR at this world speed.`);
  console.log(`                      The world moves ${(m.speed / 1.60).toFixed(1)} body-heights a second; a real runner does about 5.`);
  console.log(`  lowest sole         y ${m.minFootY} relative to the road (0 = touching, negative = through it)`);
  console.log('');
  console.log('TRAVEL ACROSS ONE STRIDE, world units');
  console.log('  joint      lateral      vertical     fore/aft');
  for (const k of ['pelvis', 'hipL', 'chest', 'shoulderL', 'head', 'handL', 'footL']) {
    console.log(`  ${k.padEnd(9)}  ${t[k].x.toFixed(4).padStart(8)}  ${t[k].y.toFixed(4).padStart(12)}  ${t[k].z.toFixed(4).padStart(12)}`);
  }
  console.log('');
  for (const f of sheets) console.log('  ' + path.relative(ROOT, f));
})();
