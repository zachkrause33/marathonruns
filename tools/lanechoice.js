#!/usr/bin/env node
/**
 * THE THREE-LANE CHOICE HARNESS. A real gate, as the course cast it, shot at
 * the distance the lane is chosen at -- and the same gate again with every
 * telegraph mat hidden.
 *
 *   node tools/lanechoice.js                    the default sweep, both arms
 *   node tools/lanechoice.js --gates 16         how many gates to stage
 *   node tools/lanechoice.js --dist 25.35,32    the read distances
 *   node tools/lanechoice.js --out /somewhere   outside the repository
 *
 * ---- WHY THIS FILE EXISTS, AND WHY blindread.js DOES NOT ANSWER IT --------
 *
 * blindread.js put ONE object on an empty road and asked a reader what it was
 * and whether to go over, under or around it. With every mat hidden, four
 * readers got 92 of 92 route judgements right, including 20 of 20 BLOCKs with
 * no paint at all. docs/staleness-and-mats.md draws the obvious conclusion and
 * then, to its credit, writes down the limit that stops it being the whole
 * conclusion:
 *
 *     "The panels are single hazards on empty road. The game presents up to
 *      three lanes at once with a hazard in each. A mat may be doing work in
 *      disambiguating WHICH LANE WANTS WHAT that a one-object panel cannot
 *      show."
 *
 * and
 *
 *     "One distance only, and it is the friendliest one for this conclusion."
 *
 * Judging one isolated object is not the task. The task is to scan three lanes
 * and pick one, and the mat's own job description in world.js -- the mat says
 * WHAT TO DO, the object says WHAT IT IS -- is a claim about a decision, not
 * about an identification. This file asks the decision question.
 *
 * It exists because a specific choice is in front of the owner. A mat is 648
 * screen pixels at 25 units and 11,744 at 8 -- eighteen times heavier where it
 * is least needed, since the lane is chosen at READ_NEAR = 25.35. The proposal
 * is to fade mats OUT on approach. The owner's counter-intuition is the
 * opposite. If the far mat measurably helps a three-lane choice, the fade runs
 * out; if it does not, the mats are decoration at every distance.
 *
 * ---- WHAT A PANEL IS, AND THE ONE THING THAT MAKES IT REAL ---------------
 *
 * A panel is a GATE THE COURSE DEALT, not a gate this tool invented. Nothing
 * about the cast is written by this file:
 *
 *   - the lanes that are occupied, and which are CLEAR, are the course's
 *   - the kind in each lane is the course's
 *   - the VARIANT in each lane is the bag's, dealt before the gun
 *   - a train's span and a ramp's tail are whatever the claim site wrote
 *
 * blindread.js had to re-dress its borrowed group because it was photographing
 * a variant the road was not wearing. This tool photographs the road, so it
 * writes NONE of those fields -- and the audit below proves it, by reading the
 * staged gate back out of the scene graph and comparing it against
 * api.liveCast() before a single pixel is written. A gate that does not match
 * what the game says is on the road at that z fails the run.
 *
 * THE ONE THING THIS TOOL DOES MOVE is the gate's distance. A gate sits where
 * the course put it, which is never exactly READ_NEAR from the runner, so the
 * three groups are translated RIGIDLY down the road together -- same lanes,
 * same spacing, same objects -- and re-seated on the elevation and re-pitched
 * by the slope at the new z, which is exactly the two lines the claim site
 * itself writes. That is the only alternative to letting the read distance be
 * whatever the sampling happened to land on, and read distance is one of the
 * two variables under test.
 *
 * ---- HOW THE GATES ARE CHOSEN, WHICH IS WHERE THE LAST PASS WENT WRONG ---
 *
 * The previous pass caught itself "choosing the chroma samples by eye ... which
 * is selection bias, in the flattering direction". So no gate here is chosen by
 * anybody. The rule is stated, mechanical, and printed with the results:
 *
 *     for each skip in an evenly spaced sweep through the race,
 *       take the FIRST live gate strictly ahead of the runner.
 *
 * There is no filter on how many lanes are occupied, on which kinds appear, or
 * on whether the resulting picture is interesting. A gate with one hazard and
 * two clear lanes is a gate the player meets, and it is recorded as what it
 * actually contained.
 *
 * AND THE SKIP IS IN RACE SECONDS, NOT UNITS. tools/matshare.js spent its first
 * sweep spacing samples 80 to 6100 as though skip were the course length, put
 * nine of ten samples past the tape, and printed a confident mean off the one
 * that landed inside the race. The sweep here is in seconds, and every skip is
 * checked for a live gate ahead before it is used -- a skip past the tape has
 * none, and says so.
 *
 * ---- MATCHECK, PER LANE, BECAUSE A GATE HAS THREE OF THEM ----------------
 *
 * blindread.js proved a panel had a mat to lose. In a three-lane panel that is
 * not enough: a whole-panel mat count of "some" is satisfied by ONE lane's mat,
 * and an OFF arm in which two lanes lost their paint and the third never had
 * any is not the treatment it claims to be -- it is the control photographed in
 * two of three lanes.
 *
 * So the mat is toggled ONE LANE AT A TIME and counted inside the crop
 * separately for each. Every occupied lane must contribute pixels or the panel
 * fails. That costs one extra render per occupied lane and it is the only way
 * the OFF arm means what it says.
 *
 * ---- WHAT IS PHOTOGRAPHED, AND WHAT IS TAKEN OFF THE ROAD ----------------
 *
 * Other gates, the runner and the ghost come off, exactly as in blindread.js.
 * This is a real limit and it is stated rather than buried: roadmap entry 63
 * recorded a BLOCK whose correct answer came entirely from a lorry parked
 * behind it in an adjacent gate, which is information the course does not
 * guarantee. Leaving other gates in would make every panel a different and
 * uncontrolled amount of easier. Taking them out isolates the gate under test,
 * and it removes a source of help that is NOT the mat -- so it makes the mat's
 * job easier to see, not harder.
 *
 * ---- THE CLOCK IS STOPPED, FOR MATCHECK'S SAKE ---------------------------
 *
 * Same reason as blindread.js, and the same defect if it is not: MATCHECK is a
 * difference between two renders, and this game animates from performance.now()
 * inside onBeforeRender. An unfrozen clock measures the weather and counts it as
 * paint, which passes a panel that has no mat in it. Frozen once for the whole
 * run, so every panel is also shot at the same instant of wind.
 *
 * Freezing performance.now does NOT stop the race -- main.js drives its frame
 * from the requestAnimationFrame timestamp -- so a borrowed group can still be
 * released out from under this tool. Every staged group is re-added if the pool
 * has dropped it, and taken back out at teardown.
 *
 * ---- BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT. -------------------
 *
 * Every object in this game is modelled on all sides, fully, always -- every
 * obstacle and vehicle of any kind, every building, bridge, tree, crowd, sign
 * and prop, and the runner. The one thing that is not an exception but looks
 * like one: a marking painted on a surface has no back, because it is not an
 * object. The telegraph mat is exactly that, which is why this file can hide it
 * with one visible flag and photograph an otherwise identical frame. Nothing
 * here licenses a half-built anything.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}

const DATE = arg('date', '2026-08-11');
const W = parseInt(arg('w', 390), 10);
const H = parseInt(arg('h', 844), 10);
// READ_NEAR is 25.35 -- the distance the lane is actually chosen at -- and 32
// is the longer read, where the object is smaller and the paint is
// proportionally larger. Those are the two ends of the question.
const DISTS = String(arg('dist', '25.35,32')).split(',').map(Number);
const NGATES = parseInt(arg('gates', 12), 10);
const SEED = parseInt(arg('seed', '20260811'), 10);
// The sweep, in RACE SECONDS. See the header: this unit has been got wrong
// once already in this repository and it cost a whole measurement.
const SKIP_FROM = parseFloat(arg('from', 20));
const SKIP_TO = parseFloat(arg('to', 220));
const OUT = path.resolve(String(arg('out', path.join(os.tmpdir(), 'mr-lanechoice'))));

if (OUT === ROOT || OUT.startsWith(ROOT + path.sep)) {
  console.log('REFUSED: --out is inside the repository (' + OUT + ').');
  console.log('Panels carry no labels; a path inside the tree is a label.');
  process.exit(1);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * THE READER PROMPT.
 *
 * It asks the PLAYER'S question, not the identification question. blindread.js
 * asked "what is it, and must a runner go over, under or around it" of one
 * object; that is a naming task with a route attached. This asks for a
 * DECISION over three lanes, which is what a player at READ_NEAR is doing, and
 * it asks for the per-lane demand as well so the decision can be scored
 * against what each lane actually held.
 *
 * The three words over, under and around cannot be avoided -- they are the
 * question. Nothing else about the game appears: no hazard, no obstacle, no
 * kind, no colour, no mat, no paint, no mention that these are renders. The
 * final question -- what did you use to decide -- is the one that can catch the
 * mat doing work the accuracy columns cannot see, and it is deliberately open
 * so that a reader who used the paint says so in their own words rather than
 * ticking a box this file wrote.
 */
const PROMPT = [
  'Here are some images. Each one shows a road ahead of you, with three lanes',
  'side by side: LEFT, MIDDLE and RIGHT as you see them in the picture.',
  '',
  'You are running down this road at speed and you must pick a lane.',
  '',
  'For each image, answer four things:',
  '',
  '  1. WHICH LANE do you take -- left, middle or right?',
  '  2. WHAT DOES EACH LANE DEMAND? For each of the three lanes say one of:',
  '     OVER (you must go over the thing in it), UNDER (you must go under it),',
  '     AROUND (you cannot get over or under it, you must not be in that lane),',
  '     or CLEAR (there is nothing in that lane).',
  '  3. HOW SURE ARE YOU of your lane choice: sure, fairly sure, or guessing.',
  '  4. WHAT DID YOU USE TO DECIDE? Say in your own words what in the picture',
  '     told you. If something was unclear, say what.',
  '',
  'If you genuinely cannot tell what a lane demands, write "cannot tell" for',
  'that lane -- that is a real answer and it is more useful than a guess',
  'dressed up as one.',
  '',
  'Answer the images independently. Do not assume they are the same road, and',
  'do not let one answer set up the next. Give your answer for every image, by',
  'filename.',
  '',
];

// ---------------------------------------------------------------------------
// IN-PAGE
// ---------------------------------------------------------------------------

/**
 * Find the first live gate strictly ahead of the runner, and everything about
 * it this tool will need. Runs once per skip, on a freshly loaded page.
 *
 * A gate is recovered from the SCENE GRAPH -- pooled hazard groups sharing a z
 * -- because activeGates lives in a closure and no api hands out the objects.
 * The kind of each group is read from the variant offset the pool builder
 * wrote, with the same schema guard blindread.js uses: if two kinds ever share
 * a halfZ the identification is ambiguous and this tool must stop rather than
 * photograph a DUCK and call it a JUMP.
 */
function findGate(o) {
  const g = MR.game, K = MR.K, B = MR.Collision.BOX;

  const KINDS = [['JUMP', K.JUMP], ['DUCK', K.DUCK], ['BLOCK', K.BLOCK]];
  const byHalfZ = {};
  for (const kv of KINDS) {
    const hz = +B[kv[1]].halfZ.toFixed(4);
    if (byHalfZ[hz]) return { err: 'two kinds share halfZ ' + hz + ' -- lanechoice cannot identify a pool by it' };
    byHalfZ[hz] = kv[0];
  }
  const kindId = { JUMP: K.JUMP, DUCK: K.DUCK, BLOCK: K.BLOCK };

  const pooled = [];
  g.world.group.traverse(function (n) {
    if (!n.userData || !n.userData.variants || !n.userData.notScenery) return;
    pooled.push(n);
  });

  const runnerZ = g.pace.units;
  // Strictly ahead, and far enough ahead that the pool will not release it
  // while this tool is working. A gate the runner is already on top of is also
  // not a gate anybody is still choosing a lane for.
  const byZ = {};
  for (const n of pooled) {
    if (!n.parent || !n.visible) continue;
    if (n.position.z <= runnerZ + 6) continue;
    const z = n.position.z.toFixed(3);
    (byZ[z] || (byZ[z] = [])).push(n);
  }
  const zs = Object.keys(byZ).map(Number).sort(function (a, b) { return a - b; });
  if (!zs.length) return { err: 'no live gate ahead of the runner at this skip (past the tape?)' };
  const gz = zs[0];
  const members = byZ[gz.toFixed(3)];

  // Lane index from x. LANE_X is [1.7, 0, -1.7], so lane 0 is NOT the left
  // lane on screen; the screen order is worked out by projection below and
  // never assumed.
  const lanes = [null, null, null];
  for (const n of members) {
    let li = -1, best = 1e9;
    for (let l = 0; l < 3; l++) {
      const d = Math.abs(n.position.x - K.LANE_X[l]);
      if (d < best) { best = d; li = l; }
    }
    if (best > 0.05) return { err: 'a staged hazard is not on a lane centre: x ' + n.position.x };
    if (lanes[li]) return { err: 'two hazards in lane ' + li + ' at z ' + gz };
    const kname = byHalfZ[+n.userData.variants[0].position.z.toFixed(4)];
    if (!kname) return { err: 'unidentifiable pool at z ' + gz + ' -- variant offset ' + n.userData.variants[0].position.z };
    const vi = n.userData.variants.findIndex(function (v) { return v.visible; });
    lanes[li] = {
      kind: kname, kindId: kindId[kname], variant: vi,
      bodyScaleZ: n.userData.body ? +n.userData.body.scale.z.toFixed(4) : null,
      // A train is a BLOCK stretched along z; a ramp is a visible rideable
      // tail. Both are the claim site's writing and this tool photographs
      // whatever it wrote -- but a panel containing a nine-car train is not the
      // same panel as one containing a van and the key must say which.
      train: n.userData.body ? (+n.userData.body.scale.z.toFixed(4) > 1.0001) : false,
      ramp: !!(n.userData.variants[vi] && n.userData.variants[vi].userData.ride
               && n.userData.variants[vi].userData.ride.visible),
    };
  }

  /**
   * AUDIT: IS THIS GATE WHAT THE GAME SAYS IS ON THE ROAD?
   *
   * The lanes above were read off the scene graph by geometry -- a variant
   * offset and an x -- which is this tool's own inference. api.liveCast() is
   * the game's own statement of what each claimed hazard is wearing. They must
   * agree, kind for kind and variant for variant, or the panel is a photograph
   * of something this file misread. Same shape as the A1 audit in
   * tools/staleness.js, and for the same reason: an instrument that infers the
   * thing it is measuring has to be checked against the thing itself.
   */
  const cast = g.world.liveCast().filter(function (c) { return Math.abs(c.z - gz) < 0.01; });
  const mismatch = [];
  for (const c of cast) {
    const mine = lanes[c.lane];
    if (!mine) { mismatch.push('lane ' + c.lane + ' cast ' + c.kind + ' v' + c.variant + ', graph empty'); continue; }
    if (mine.kindId !== c.kind) mismatch.push('lane ' + c.lane + ' cast kind ' + c.kind + ', graph ' + mine.kindId);
    if (mine.variant !== c.variant) mismatch.push('lane ' + c.lane + ' cast v' + c.variant + ', graph v' + mine.variant);
  }
  for (let l = 0; l < 3; l++) {
    if (lanes[l] && !cast.some(function (c) { return c.lane === l; })) {
      mismatch.push('lane ' + l + ' in graph but not in liveCast');
    }
  }

  return {
    gz: gz, runnerZ: runnerZ, lanes: lanes, playerLane: g.player.lane,
    castMismatch: mismatch,
    occupied: lanes.filter(Boolean).length,
  };
}

/**
 * Stage the gate found above at a given distance and photograph it.
 * Everything is set up, shot and torn down inside one page evaluate so the
 * scene is never left dressed between calls.
 */
function shootGate(job) {
  const g = MR.game, THREE = window.THREE, K = MR.K, B = MR.Collision.BOX;
  const EL = (g.course && g.course.elevation) || MR.Elevation.FLAT;

  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position);
  cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect;
  cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  const pooled = [];
  g.world.group.traverse(function (n) {
    if (!n.userData || !n.userData.variants || !n.userData.notScenery) return;
    pooled.push(n);
  });

  const runnerZ = g.pace.units;
  const gz = job.gz;
  const members = pooled.filter(function (n) {
    return n.parent && n.visible && Math.abs(n.position.z - gz) < 0.01;
  });
  if (members.length !== job.occupied) {
    return { err: 'the gate at z ' + gz + ' has ' + members.length + ' live members, expected '
      + job.occupied + ' -- the pool moved under this tool' };
  }

  /**
   * IS THIS STILL THE SAME GATE IT WAS WHEN findGate LOOKED AT IT?
   *
   * findGate runs once and this runs once per distance, so there are two page
   * evaluations between the audit and the photograph. The race does not stop
   * between them -- main.js drives its frame from the requestAnimationFrame
   * timestamp -- so in principle Pool.release could hand one of these groups to
   * a different gate, and the panel would be scored against a cast that is no
   * longer on it. That is the same class of defect as blindread.js photographing
   * the last tenant's state, and the same answer: check, do not assume.
   *
   * Measured on the run this file was written for, the drift between the two
   * evaluations was 0.00 units and 0 of 16 gates changed cast. The check stays
   * because "it did not happen once" is not a property.
   */
  for (const n of members) {
    let li = -1, best = 1e9;
    for (let l = 0; l < 3; l++) {
      const d = Math.abs(n.position.x - K.LANE_X[l]);
      if (d < best) { best = d; li = l; }
    }
    const want = job.lanes[li];
    if (!want) return { err: 'lane ' + li + ' at z ' + gz + ' is occupied now and was clear at audit time' };
    const vi = n.userData.variants.findIndex(function (v) { return v.visible; });
    if (vi !== want.variant) {
      return { err: 'lane ' + li + ' at z ' + gz + ' was cast v' + want.variant
        + ' at audit time and is wearing v' + vi + ' now -- the pool re-tenanted it' };
    }
  }

  // ---- snapshot before anything is written --------------------------------
  const restore = [];
  const readded = [];
  const mats = {};
  for (const n of members) {
    restore.push({ o: n, pos: n.position.clone(), rot: n.rotation.clone(), vis: n.visible, hadParent: !!n.parent });
    // The mat: the pool builder's one non-variant child. Named by what it is
    // rather than by its index, so a new sibling breaks this loudly instead of
    // being photographed as the mat.
    const vs = n.userData.variants;
    let mat = null, extras = 0;
    for (const c of n.children) {
      if (vs.indexOf(c) >= 0) continue;
      extras++;
      if (c.isMesh) mat = c;
    }
    if (extras !== 1 || !mat) {
      return { err: 'a pool group has ' + extras + ' non-variant children, expected 1 (the telegraph mat) -- lanechoice needs updating' };
    }
    let li = -1, best = 1e9;
    for (let l = 0; l < 3; l++) {
      const d = Math.abs(n.position.x - K.LANE_X[l]);
      if (d < best) { best = d; li = l; }
    }
    mats[li] = mat;
    restore.push({ o: mat, vis: mat.visible });
  }

  // Everything else that is a hazard comes off the road. The runner and the
  // ghost come off too: neither is in the gate, and a pair of shoulders in the
  // bottom of a crop tells a reader what kind of picture they are looking at.
  const hidden = [];
  for (const n of pooled) {
    if (members.indexOf(n) >= 0) continue;
    if (!n.visible) continue;
    hidden.push([n, n.visible]); n.visible = false;
  }
  for (const r of [g.runner && g.runner.group, g.ghost && g.ghost.group]) {
    if (r && r.visible) { hidden.push([r, r.visible]); r.visible = false; }
  }

  // ---- move the gate, rigidly, and nothing else ---------------------------
  //
  // The two lines below are the claim site's own placement lines. Nothing about
  // the cast is rewritten: not variant visibility, not the rideable tail, not
  // the caution board, not a train's body scale. This tool photographs the
  // road, so the road's dressing is the panel's dressing.
  const targetZ = runnerZ + job.dist;
  const yBase = EL.at(targetZ);
  const pitch = -Math.atan(EL.slope(targetZ));
  for (const n of members) {
    if (!n.parent) { g.world.group.add(n); readded.push(n); }
    n.position.z = targetZ;
    n.position.y = yBase;
    n.rotation.x = pitch;
  }

  const realNow = performance.now.bind(performance);
  const frozen = realNow();
  performance.now = function () { return frozen; };

  const rt = new THREE.WebGLRenderTarget(job.w, job.h);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(job.w * job.h * 4);
  const prevRT = g.renderer.getRenderTarget();

  function frame() {
    g.renderer.setRenderTarget(rt);
    g.renderer.render(g.scene, cam);
    g.renderer.readRenderTargetPixels(rt, 0, 0, job.w, job.h, buf);
    return new Uint8Array(buf);
  }

  // ---- the OBJECT half of the crop window ---------------------------------
  //
  // Taken from MR.Collision.BOX and not from the art's bounding box: the
  // collision box is the contract. The mat half of the window is NOT projected
  // here -- see the correction below.
  //
  // WIDTH IS FORCED TO ALL THREE LANES even when a lane is CLEAR. A crop drawn
  // only around the occupied lanes would be narrower on a one-hazard gate than
  // on a three-hazard one, and the WIDTH OF THE PICTURE would then be a cue to
  // how many lanes are occupied -- which is part of the answer. Every panel
  // spans lane -1 to lane +1 at full width whatever is standing in them.
  //
  // NOT RESAMPLED. A crop is 1:1 with the frame, so the panel at 32 units is
  // smaller than the one at 25.35, which is the truth of the read. An upscaled
  // crop is a picture of a read the player never gets.
  const P = new THREE.Vector3();
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  function mark(wx, wy, wz) {
    P.set(wx, wy, wz).project(cam);
    const px = (P.x * 0.5 + 0.5) * job.w, py = (1 - (P.y * 0.5 + 0.5)) * job.h;
    if (!isFinite(px) || !isFinite(py)) return;
    sx0 = Math.min(sx0, px); sx1 = Math.max(sx1, px);
    sy0 = Math.min(sy0, py); sy1 = Math.max(sy1, py);
  }
  // The widest envelope in the game, applied at every lane centre, so the frame
  // is the same shape whatever the gate holds.
  let wideX = 0, tallY = 0;
  for (const kv of [K.JUMP, K.DUCK, K.BLOCK]) {
    wideX = Math.max(wideX, B[kv].halfX);
    tallY = Math.max(tallY, B[kv].yMax);
  }
  for (let l = 0; l < 3; l++) {
    const lx = K.LANE_X[l];
    for (let i = 0; i < 4; i++) {
      mark(lx + (i & 1 ? wideX : -wideX), yBase + (i & 2 ? tallY : 0), targetZ);
    }
  }
  // Every occupied lane's own box, in case something is deeper than the widest
  // envelope allows for. A train is stretched along z and its far end is part
  // of what the reader is looking at.
  for (let l = 0; l < 3; l++) {
    if (!job.lanes[l]) continue;
    const box = B[job.lanes[l].kindId];
    const lx = K.LANE_X[l];
    const depth = 2 * box.halfZ * (job.lanes[l].bodyScaleZ || 1);
    for (let i = 0; i < 8; i++) {
      mark(lx + (i & 1 ? box.halfX : -box.halfX),
           yBase + (i & 2 ? box.yMax : box.yMin),
           targetZ + (i & 4 ? depth : 0));
    }
  }
  const objBox = [sx0, sy0, sx1, sy1];

  // ---- which lane is on the left of the SCREEN ----------------------------
  //
  // LANE_X is [1.7, 0, -1.7], so the lane INDEX order is not the screen order,
  // and the reader is asked about left, middle and right as they see them. This
  // is projected rather than reasoned about, because a sign error here silently
  // marks every correct answer wrong -- in the flattering direction for the
  // "mats do nothing" conclusion, since it would flatten both arms to noise.
  const laneScreenX = [];
  for (let l = 0; l < 3; l++) {
    P.set(K.LANE_X[l], yBase, targetZ).project(cam);
    laneScreenX.push(+((P.x * 0.5 + 0.5) * job.w).toFixed(2));
  }
  const screenOrder = [0, 1, 2].sort(function (a, b) { return laneScreenX[a] - laneScreenX[b]; });

  // ---- MATCHECK, per lane, AND THE CROP THAT DEPENDS ON IT ----------------
  //
  // ---- THE DEFECT THIS REPLACES, WHICH FLATTERED THE ANSWER --------------
  //
  // The first version of this file drew its crop from geometry alone: the
  // collision boxes, plus the mat's near run-up guessed at six units back and
  // as wide as the collision box. That guess was wrong in both directions. The
  // mat is wider than the envelope it sits under and it runs further toward
  // the lens than six units at the alpha this render actually resolves, so the
  // measured mat bounding box came out at x 204 to 345 against a crop that
  // ended at x 308, and the bottom of every mat fell below the crop as well.
  //
  // THE ON ARM WAS THEREFORE SHOWING LESS PAINT THAN THE GAME DRAWS, while the
  // OFF arm lost nothing it was not already missing -- so the experiment would
  // have understated the mat, which is the flattering direction for the
  // conclusion that the mat does nothing. Rule 3's whole point is that every
  // instrument in this project was wrong first and every error flattered the
  // thing being measured, so this one is fixed rather than noted.
  //
  // The fix is to stop guessing. The mat's extent is MEASURED -- it is exactly
  // the pixels that move when the mat is hidden -- so the diffs are taken
  // first, and the crop is the union of the object box with the mat's real
  // bounding box. The paint the reader sees is then all of the paint.
  function pixDiffers(a, b, q) {
    return Math.abs(a[q] - b[q]) > 6
        || Math.abs(a[q + 1] - b[q + 1]) > 6
        || Math.abs(a[q + 2] - b[q + 2]) > 6;
  }
  // A mask rather than a count, because the count cannot be taken until the
  // crop is known and the crop cannot be taken until the mask is.
  function diffMask(a, b) {
    const m = new Uint8Array(job.w * job.h);
    let all = 0, bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
    for (let Y = 0; Y < job.h; Y++) {
      const flip = job.h - 1 - Y;
      for (let X = 0; X < job.w; X++) {
        if (!pixDiffers(a, b, (flip * job.w + X) * 4)) continue;
        m[Y * job.w + X] = 1;
        all++;
        if (X < bx0) bx0 = X; if (X > bx1) bx1 = X;
        if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
      }
    }
    return { mask: m, all: all, box: all ? [bx0, by0, bx1, by1] : null };
  }

  for (const l in mats) mats[l].visible = true;
  const withMat = frame();

  // One lane at a time. A whole-panel count of "some" is satisfied by one
  // lane's paint, and an OFF arm where only one of three lanes lost anything is
  // not the treatment it claims to be.
  const perLane = {};
  for (const l in mats) {
    mats[l].visible = false;
    const one = frame();
    mats[l].visible = true;
    perLane[l] = diffMask(withMat, one);
  }

  for (const l in mats) mats[l].visible = false;
  const noMat = frame();
  const allMat = diffMask(withMat, noMat);
  for (const l in mats) mats[l].visible = true;

  // ---- the crop window, now that the paint has been measured --------------
  if (allMat.box) {
    sx0 = Math.min(sx0, allMat.box[0]); sy0 = Math.min(sy0, allMat.box[1]);
    sx1 = Math.max(sx1, allMat.box[2]); sy1 = Math.max(sy1, allMat.box[3]);
  }
  const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
  const cw = Math.round(Math.max(48, Math.min((sx1 - sx0) * 1.10, job.w)));
  const ch = Math.round(Math.max(48, Math.min((sy1 - sy0) * 1.10, job.h)));
  let x0 = Math.round(cx - cw / 2), y0 = Math.round(cy - ch / 2);
  x0 = Math.max(0, Math.min(x0, job.w - cw));
  y0 = Math.max(0, Math.min(y0, job.h - ch));
  const clipped = (sx1 - sx0) * 1.10 > job.w || (sy1 - sy0) * 1.10 > job.h;

  function inCrop(d) {
    let n = 0;
    for (let Y = y0; Y < y0 + ch; Y++) {
      const row = Y * job.w;
      for (let X = x0; X < x0 + cw; X++) if (d.mask[row + X]) n++;
    }
    return n;
  }
  const perLaneCount = {};
  for (const l in perLane) {
    perLaneCount[l] = { inCrop: inCrop(perLane[l]), all: perLane[l].all, box: perLane[l].box };
  }
  const allMatCount = { inCrop: inCrop(allMat), all: allMat.all, box: allMat.box };

  /**
   * IS THE WHOLE OF THE PAINT INSIDE THE PANEL?
   *
   * The reason this file grew a measured crop. If the mat's own bounding box
   * does not fit, the ON arm is showing the reader less paint than the game
   * draws and the two arms differ by less than they claim to.
   */
  const matFullyInside = !allMat.box || (allMat.box[0] >= x0 && allMat.box[2] < x0 + cw
    && allMat.box[1] >= y0 && allMat.box[3] < y0 + ch);

  /**
   * ARE ALL THREE LANES IN THE PICTURE?
   *
   * The reader is asked what each of three lanes demands. A crop that has cut
   * a lane centre off is asking about a lane that is not there, and every
   * answer for it would be scored against a truth the reader could not see --
   * silently, and in whichever direction the missing lane happened to fall.
   */
  const lanesInCrop = laneScreenX.every(function (px) { return px >= x0 && px < x0 + cw; });

  // ---- is there anything in the panel at all? -----------------------------
  //
  // A zero mat reading is either a finding about the game or this tool having
  // staged nothing, and those are not the same failure. blindread.js reported
  // sixteen panels of bare tarmac as a defect in somebody else's file before it
  // learned to tell them apart.
  let objAll = 0;
  {
    const wasVis = members.map(function (n) { return n.visible; });
    for (const n of members) n.visible = false;
    const noObj = frame();
    for (let i = 0; i < members.length; i++) members[i].visible = wasVis[i];
    for (let q = 0; q < withMat.length; q += 4) if (pixDiffers(withMat, noObj, q)) objAll++;
  }

  /**
   * BOTH ARMS COME OUT OF THIS ONE CALL, AND THAT IS NOT A CONVENIENCE.
   *
   * ---- THE DEFECT THIS REPLACES ------------------------------------------
   *
   * The first version of this file took a --nomat flag and shot the two arms
   * as two separate runs, the way blindread.js does. blindread.js can get away
   * with that because it MOVES a borrowed object to an exact distance and the
   * panel does not depend on where the runner happens to be. This tool picks
   * its gate by "the first live gate ahead of the runner", so the panel depends
   * on the runner's position entirely -- and the runner's position is not
   * reproducible across page loads.
   *
   * Measured, four loads at the same skip and the same date:
   *
   *     runnerZ  451.632   451.056   452.043   451.466
   *
   * The race is driven from the requestAnimationFrame timestamp, so the ~2.4
   * seconds of settling before the scene is read is real time and it varies
   * with machine load. A spread of one unit is enough to move the "first gate
   * ahead" cut past a gate, and it did: two runs at the same seed and the same
   * skip selected the gate at z 460.4 and the gate at z 500.4, which are
   * different gates holding different hazards.
   *
   * TWO ARMS SHOT ON DIFFERENT GATES ARE NOT TWO ARMS. Every difference the
   * readers reported would have had the gate as a rival explanation, and the
   * experiment would have been unable to tell the mat from the cast. The two
   * buffers below are the same frame of the same scene with one visible flag
   * between them, so the arms differ in the paint and in nothing else -- same
   * course, same date, same gate, same lanes, same variants, same gradient,
   * same light, same backdrop, same crop rectangle, same instant of wind.
   */
  function crop(buf) {
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(cw, ch);
    for (let Y = 0; Y < ch; Y++) {
      const flip = job.h - 1 - (y0 + Y);
      const src = (flip * job.w + x0) * 4;
      img.data.set(buf.subarray(src, src + cw * 4), Y * cw * 4);
    }
    cg.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }
  const pngMat = crop(withMat);
  const pngNomat = crop(noMat);

  // ---- teardown -----------------------------------------------------------
  for (const r of restore) {
    if (r.pos) { r.o.position.copy(r.pos); r.o.rotation.copy(r.rot); }
    if (r.vis !== undefined) r.o.visible = r.vis;
  }
  for (const h of hidden) h[0].visible = h[1];
  for (const n of readded) if (n.parent) n.parent.remove(n);
  performance.now = realNow;
  g.renderer.setRenderTarget(prevRT);
  rt.dispose();

  return {
    pngMat: pngMat, pngNomat: pngNomat, crop: [x0, y0, cw, ch], clipped: clipped,
    targetZ: +targetZ.toFixed(3), yBase: +yBase.toFixed(4),
    slope: +EL.slope(targetZ).toFixed(5),
    perLane: perLaneCount, allMat: allMatCount, objAll: objAll,
    objBox: objBox.map(function (v) { return +v.toFixed(1); }),
    matFullyInside: matFullyInside, lanesInCrop: lanesInCrop,
    // The per-lane masks should very nearly partition the all-lanes mask: the
    // mats lie in different lanes and barely overlap. A large gap between the
    // two would mean one mat is occluding another, or that hiding all three at
    // once changes something hiding them one at a time does not -- either of
    // which would make the per-lane figures a different measurement from the
    // whole-panel one.
    matPerLaneSum: Object.keys(perLaneCount).reduce(function (s, l) { return s + perLaneCount[l].all; }, 0),
    laneScreenX: laneScreenX, screenOrder: screenOrder,
    boxPx: [+(sx1 - sx0).toFixed(1), +(sy1 - sy0).toFixed(1)],
  };
}

// ---------------------------------------------------------------------------

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));

  const runid = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + SEED.toString(36);

  const panelDir = path.join(OUT, 'panels', runid);
  const keyDir = path.join(OUT, 'keys');
  fs.mkdirSync(panelDir, { recursive: true });
  fs.mkdirSync(keyDir, { recursive: true });

  const rnd = mulberry32(SEED);
  const key = [];
  const failures = [];
  const skips = [];
  for (let i = 0; i < NGATES; i++) {
    skips.push(+(SKIP_FROM + (SKIP_TO - SKIP_FROM) * (i / Math.max(1, NGATES - 1))).toFixed(2));
  }

  console.log('LANECHOICE ' + runid + '   both arms, shot as twins from one frame');
  console.log('  date ' + DATE + ', frame ' + W + 'x' + H + ', dists ' + DISTS.join(', '));
  console.log('  skips (RACE SECONDS): ' + skips.join(' '));
  console.log('');

  for (const skip of skips) {
    await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&skip=' + skip + '&date=' + DATE);
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(2400);

    const found = await page.evaluate(findGate, {});
    if (found.err) {
      failures.push({ skip, err: found.err });
      console.log('  skip ' + skip + '  SKIPPED: ' + found.err);
      continue;
    }
    if (found.castMismatch.length) {
      failures.push({ skip, err: 'CAST MISMATCH: ' + found.castMismatch.join('; ') });
      console.log('  skip ' + skip + '  CAST MISMATCH: ' + found.castMismatch.join('; '));
      continue;
    }

    for (const dist of DISTS) {
      const r = await page.evaluate(shootGate, {
        gz: found.gz, dist: dist, occupied: found.occupied, lanes: found.lanes,
        w: W, h: H,
      });
      if (r.err) {
        failures.push({ skip, dist, err: r.err });
        console.log('  skip ' + skip + ' @' + dist + 'u  FAILED: ' + r.err);
        continue;
      }

      // Two independent neutral names off the shuffle stream, one per arm.
      // Eight hex digits each: no kind, no lane, no distance, no arm, no
      // ordering, and nothing that pairs a panel with its twin. A reader who
      // could tell that two files were the same gate would be able to tell
      // which of them had lost something.
      function hex() {
        let s = '';
        for (let i = 0; i < 8; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16)];
        return s + '.png';
      }
      const fileMat = hex(), fileNomat = hex();
      fs.writeFileSync(path.join(panelDir, fileMat), Buffer.from(r.pngMat.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(panelDir, fileNomat), Buffer.from(r.pngNomat.split(',')[1], 'base64'));

      /**
       * PER-LANE MATCHECK STATES. Same three states blindread.js pays for, one
       * per occupied lane, plus the whole-panel STAGEFAIL.
       */
      const laneStates = {};
      let worst = 'ok';
      for (let l = 0; l < 3; l++) {
        if (!found.lanes[l]) continue;
        const pl = r.perLane[l];
        const st = !pl ? 'NOLANE'
          : pl.inCrop ? 'ok'
          : pl.all ? 'MATCROP'
          : r.objAll === 0 ? 'STAGEFAIL'
          : 'MATLOST';
        laneStates[l] = st;
        if (st !== 'ok') worst = st;
      }
      // Three whole-panel conditions, each of which would make the two arms
      // something other than twins that differ only in paint.
      if (worst === 'ok' && !r.matFullyInside) worst = 'MATCLIPPED';
      if (worst === 'ok' && !r.lanesInCrop) worst = 'LANEOUT';
      // The per-lane masks should nearly partition the whole-panel mask. A
      // tenth of a percent of edge pixels can legitimately differ; a large gap
      // means the per-lane figures are measuring something else.
      const sumGap = r.allMat.all ? Math.abs(r.matPerLaneSum - r.allMat.all) / r.allMat.all : 0;
      if (worst === 'ok' && sumGap > 0.05) worst = 'MATSPLIT';

      // Screen order, left to right, as the reader will see them.
      const ltr = r.screenOrder;
      const demand = { JUMP: 'OVER', DUCK: 'UNDER', BLOCK: 'AROUND' };
      const truthLtr = ltr.map(function (l) {
        return found.lanes[l] ? demand[found.lanes[l].kind] : 'CLEAR';
      });

      key.push({
        fileMat, fileNomat, skip, dist,
        gateZ: found.gz, runnerZ: +found.runnerZ.toFixed(3), stagedZ: r.targetZ,
        playerLane: found.playerLane,
        laneIndexOrderLeftToRight: ltr,
        laneScreenX: r.laneScreenX,
        // The answer, written the way the reader is asked for it.
        truthLeftToRight: truthLtr,
        lanes: [0, 1, 2].map(function (l) {
          return found.lanes[l] ? {
            laneIndex: l, kind: found.lanes[l].kind, variant: found.lanes[l].variant,
            demand: demand[found.lanes[l].kind],
            train: found.lanes[l].train, ramp: found.lanes[l].ramp,
            bodyScaleZ: found.lanes[l].bodyScaleZ,
            matPxInCrop: r.perLane[l] ? r.perLane[l].inCrop : 0,
            matPxOnFrame: r.perLane[l] ? r.perLane[l].all : 0,
            matState: laneStates[l],
          } : { laneIndex: l, kind: 'CLEAR', demand: 'CLEAR' };
        }),
        occupied: found.occupied,
        clearLanes: [0, 1, 2].filter(function (l) { return !found.lanes[l]; }),
        cropPx: [r.crop[2], r.crop[3]], crop: r.crop, clipped: r.clipped,
        matPxAllInCrop: r.allMat.inCrop, matPxAllOnFrame: r.allMat.all,
        matBoxOnFrame: r.allMat.box,
        matShareOfCrop: +(r.allMat.inCrop / (r.crop[2] * r.crop[3])).toFixed(4),
        objAllPx: r.objAll,
        objBoxOnFrame: r.objBox,
        matFullyInside: r.matFullyInside,
        lanesInCrop: r.lanesInCrop,
        matPerLaneSum: r.matPerLaneSum,
        matPerLaneSumGap: +sumGap.toFixed(4),
        slope: r.slope,
        matcheck: worst,
      });
    }
    const row = key.filter(function (k) { return k.skip === skip; });
    if (row.length) {
      const k0 = row[0];
      console.log('  skip ' + String(skip).padStart(6) + '  gate z ' + k0.gateZ.toFixed(1)
        + '  lanes L-M-R ' + k0.truthLeftToRight.join('/')
        + '  ' + row.map(function (k) {
            return k.dist + 'u:' + k.cropPx.join('x') + ' mat ' + (100 * k.matShareOfCrop).toFixed(1) + '%';
          }).join('  '));
    }
  }

  await browser.close();

  // ---- shuffle the panel order --------------------------------------------
  // The key is written in course order because it is read by a person; the
  // FILENAMES are eight hex digits off the shuffle stream and sort to nothing,
  // so the directory listing carries no ordering a reader could use.
  fs.writeFileSync(path.join(panelDir, 'PROMPT.txt'), PROMPT.join('\n'));
  fs.writeFileSync(path.join(keyDir, runid + '.json'), JSON.stringify({
    runid, seed: SEED, date: DATE, viewport: [W, H], dists: DISTS,
    skipsRaceSeconds: skips,
    arms: { fileMat: 'SHIPPED -- mats as the game draws them',
            fileNomat: 'NOMAT -- every telegraph mat hidden, NOT the shipped game' },
    panelDir, panels: key, failures,
    note: 'Each entry is ONE gate shot TWICE from the same frame: fileMat is the '
        + 'shipped picture, fileNomat is the identical frame with every telegraph '
        + 'mat hidden. The nomat panel is a counterfactual, not the game, and the '
        + 'per-lane matPx figures are the paint it is missing. '
        + 'Gates are real: lanes, kinds and variants are the course cast, '
        + 'checked against api.liveCast before shooting. Only the gate distance '
        + 'is set by this tool. Other gates, the runner and the ghost are hidden.',
  }, null, 1));

  // ---- report --------------------------------------------------------------
  console.log('');
  console.log('  panels   ' + panelDir + '  (' + key.length + ' images + PROMPT.txt)');
  console.log('  key      ' + path.join(keyDir, runid + '.json') + '   <- do not show the reader');
  console.log('');

  const byDist = {};
  for (const k of key) (byDist[k.dist] || (byDist[k.dist] = [])).push(k);
  console.log('  MATCHECK -- telegraph mat pixels, per lane, inside the crop');
  for (const d of Object.keys(byDist).sort(function (a, b) { return a - b; })) {
    const rows = byDist[d];
    let laneCells = 0, okCells = 0, px = [];
    for (const k of rows) {
      for (const l of k.lanes) {
        if (l.kind === 'CLEAR') continue;
        laneCells++;
        if (l.matState === 'ok') { okCells++; px.push(l.matPxInCrop); }
      }
    }
    px.sort(function (a, b) { return a - b; });
    const mean = px.length ? px.reduce(function (s, v) { return s + v; }, 0) / px.length : 0;
    console.log('    ' + (d + 'u').padEnd(7) + String(rows.length).padStart(3) + ' panels, '
      + laneCells + ' occupied lanes: ' + okCells + ' carry a mat'
      + (px.length ? '  (' + px[0] + ' to ' + px[px.length - 1] + ' px, mean '
         + mean.toFixed(0) + ')' : ''));
  }
  console.log('');

  const bad = key.filter(function (k) { return k.matcheck !== 'ok'; });
  const occ = { 1: 0, 2: 0, 3: 0 };
  const kinds = { JUMP: 0, DUCK: 0, BLOCK: 0 };
  for (const k of byDist[DISTS[0]] || []) {
    occ[k.occupied] = (occ[k.occupied] || 0) + 1;
    for (const l of k.lanes) if (l.kind !== 'CLEAR') kinds[l.kind]++;
  }
  console.log('  WHAT THE PANELS ACTUALLY CONTAIN (per distance)');
  console.log('    gates with 1 / 2 / 3 occupied lanes: ' + (occ[1] || 0) + ' / ' + (occ[2] || 0) + ' / ' + (occ[3] || 0));
  console.log('    hazards by kind: JUMP ' + kinds.JUMP + ', DUCK ' + kinds.DUCK + ', BLOCK ' + kinds.BLOCK);
  console.log('');
  console.log('  ---- THE READER PROMPT (also written as PROMPT.txt) ----');
  for (const line of PROMPT) console.log('  | ' + line);

  if (errs.length) console.log('\n  PAGE ERRORS: ' + errs.slice(0, 4).join(' | '));
  if (failures.length) {
    console.log('\n  ' + failures.length + ' skip/distance combinations produced no panel:');
    for (const f of failures.slice(0, 8)) console.log('    skip ' + f.skip + ': ' + f.err);
  }
  if (bad.length) {
    console.log('\nFAIL MATCHECK: ' + bad.length + ' of ' + key.length + ' panels have an occupied');
    console.log('lane whose telegraph mat is not inside the crop. In the NOMAT arm that lane');
    console.log('lost nothing, so the panel is the control photographed in that lane and the');
    console.log('two arms are not twins.');
    for (const m of bad.slice(0, 8)) {
      console.log('  ' + m.fileMat + '  skip ' + m.skip + ' @' + m.dist + 'u  ' + m.matcheck);
    }
    process.exit(1);
  }
  if (errs.length) process.exit(1);
  console.log('\nOK: every occupied lane in every panel carries its telegraph mat inside the');
  console.log('crop, so the NOMAT arm removes paint from every lane it claims to. Nothing in');
  console.log('the panel directory names the answer.');
})();
