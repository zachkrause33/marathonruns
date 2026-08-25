#!/usr/bin/env node
/**
 * THE BLIND IDENTIFICATION HARNESS. Unlabelled crops, a reader with no
 * context, and one question: what is this, and must a runner go over, under or
 * around it?
 *
 *   node tools/blindread.js                     every variant at 8, 12 and 25
 *   node tools/blindread.js --kind BLOCK        one kind
 *   node tools/blindread.js --dist 25           one distance
 *   node tools/blindread.js --sample 12         a dozen panels, drawn at random
 *   node tools/blindread.js --out /some/where   somewhere else outside the repo
 *
 * ---- WHY THIS FILE EXISTS -------------------------------------------------
 *
 * This is the acceptance test for the owner's complaint that they "can't even
 * tell what they are". Nothing else in the harness answers it. kindread.js
 * measures whether the three KINDS separate as silhouette profiles, and
 * shoot.js fails builds on contrast and occlusion -- both are statements about
 * a number, and neither of them can tell you that a thing a player is meant to
 * read as a skip full of rubble reads as a birthday cake.
 *
 * The test has been run several times by hand: stage some crops, show them to
 * a reader with no context, write down what they said. It has driven real
 * passes over the art. It also had two defects, and both of them flattered the
 * result -- which is rule 3's whole subject, applied to the one instrument in
 * this project whose readings are sentences rather than numbers.
 *
 * ---- DEFECT 1: THE READER IS CONTAMINATED, AND THIS FILE CANNOT FIX IT ----
 *
 * Every reader run as an agent in this repository gets CLAUDE.md injected into
 * its context before it sees a single pixel. That file is the project's
 * standing rules, and it is not neutral about the answer. In its own words it
 * hands the reader:
 *
 *     obstacle, hazard, vehicle, barrier, sign, banner, plinth, gantry,
 *     finish arch, marshal, crowd, walker, ghost, runner, chase camera,
 *     lane change, telegraph mat, road paint, hill, crest, dip
 *
 * and the framing facts that this is a running game seen from a chase camera,
 * that the things in it are hazards a runner passes at arm's length, and that
 * one contact ends a run. Every reader so far has reported this unprompted,
 * which is to their credit and is also the evidence that it happens every time.
 *
 * THIS TOOL CANNOT STOP IT. The injection is a property of the harness the
 * reader runs in, not of the images. So it is documented here instead, with
 * the line between the conclusions it spoils and the conclusions it does not:
 *
 *   IT DOES NOT INVALIDATE A FAILURE TO READ. A reader who has been handed the
 *   word "marshal" and still writes "I cannot tell what kind of person this
 *   is" has failed with the answer in front of them. That is a strictly
 *   HARDER test than a clean one, and every negative finding this test has
 *   ever produced is of that shape. Those findings stand, and stand more
 *   firmly than they would have from an uncontaminated reader.
 *
 *   IT DOES INVALIDATE A NAMING SUCCESS THAT USES A WORD THE FILE SUPPLIED.
 *   A reader who writes "a barrier" or "a hazard" or "a vehicle" may be
 *   reading the image or may be completing the sentence CLAUDE.md started. A
 *   reader who writes "a stack of sandbags", "a road sweeper" or "a bin lorry"
 *   is not: none of those words appear in the file, and a specific noun cannot
 *   be got from a general one. So SPECIFIC nouns count and GENERIC nouns from
 *   the leaked vocabulary do not, and the prompt below asks for the most
 *   specific name the reader can give in order to force that distinction.
 *
 *   IT DOES NOT INVALIDATE THE OVER / UNDER / AROUND ANSWER, because the
 *   leaked vocabulary contains no mapping from any object to any of the three.
 *   Knowing the word "hazard" does not tell you whether to jump a thing. What
 *   it does mean is that the reader knows the three answers are the answers,
 *   so the over/under/around question is a forced choice among three rather
 *   than an open one -- score it as three-way, and treat 33% as the floor
 *   rather than zero.
 *
 *   AN UNCONTAMINATED READER IS STILL WORTH MORE. If one can be got -- a
 *   person, or an agent run outside this repository with the panel directory
 *   and PROMPT.txt and nothing else -- use them. Everything this tool writes
 *   is portable on purpose, which is what the next defect is about.
 *
 * ---- DEFECT 2: THE PANELS LEFT OUT THE ANSWER --------------------------
 *
 * The single-object panels used for previous passes were built from
 * api.variantObject, which returns assembleVariant: body, caution face, one
 * moving part. That is not what the game puts on the road. The road gets a
 * POOLED group, and the pool builder adds one more child that assembleVariant
 * never sees -- the telegraph mat, 16 units of coloured, iconised paint laid
 * on the tarmac in front of the hazard, whose entire job is to say OVER,
 * UNDER or AROUND before the shape resolves. world.js states the split
 * outright: the mat says WHAT TO DO, the object says WHAT IT IS.
 *
 * So the harness that was asked "what is this and must a runner go over,
 * under or around it" was answering the first half with the game's art and the
 * second half with the game's art MINUS the channel built to carry it. At
 * least one recorded conclusion -- that a reader could not tell over from
 * under on a particular object -- was partly an artefact of that, because the
 * mat that says so was cropped out by construction.
 *
 * WHAT GOING THROUGH THE POOL COST. The mat exists only on a pooled group and
 * there is no api that builds one, so this tool BORROWS a live hazard off the
 * road: it finds the pooled groups in the world, identifies each one's kind by
 * its variant offset against MR.Collision.BOX halfZ, re-points one per kind at
 * the target distance, and switches the variant on. Three costs, all real:
 *
 *   1. It depends on the CLAIM SITE's contract, not just on a constructor.
 *      A pooled group recycles, so every claim rewrites variant visibility,
 *      the rideable tail, the caution board and a BLOCK's body scale. This
 *      tool has to write the same fields or it photographs the last tenant's
 *      state -- a tram with a ramp down, or a train stretched to nine cars.
 *      That list is duplicated here and will go stale if the claim site grows
 *      a field. The teardown restores every one of them.
 *   2. It can only photograph kinds that are LIVE. Pool.release removes the
 *      object from the scene graph, so a kind with nothing on the road nearby
 *      cannot be borrowed. The tool says so and fails rather than silently
 *      dropping a kind.
 *   3. It cannot photograph a variant the road is not wearing... except that
 *      it can: every variant is built and parented at pool construction and
 *      switched by visibility, so all 23 are reachable on any borrowed group.
 *      That is the one place the pool's design paid this tool back.
 *
 * The control that keeps this honest is MATCHECK. Every panel is rendered
 * twice, once with the mat visible and once with it hidden, and the pixels
 * that differ inside the crop are counted. A panel with zero mat pixels fails
 * the run. A harness that silently omits the thing it was built to include is
 * the exact defect being fixed, and it is not allowed to happen quietly twice.
 *
 * ---- DEFECT 3: A ZERO THAT MEANT NOTHING ---------------------------------
 *
 * MATCHECK reads "no pixels moved when the mat was hidden" as MATLOST -- the
 * game drew no mat -- and printed it as a finding about src/render/world.js.
 * It could not tell that from THIS TOOL HAVING STAGED NOTHING, and on a
 * sixty-nine panel run it reported sixteen MATLOST panels against a build
 * whose mats were fine. The panels were bare tarmac: no mat, and no object
 * either.
 *
 * THE RACE DOES NOT STOP. Freezing performance.now above stops the wind, the
 * crowd and the sky, and it does not stop the runner: main.js drives its frame
 * from the requestAnimationFrame timestamp, not from performance.now. So the
 * race advances through a run, and Pool.release does parent.remove(o) as the
 * runner passes the gate a group was borrowed from. A released group is out of
 * the scene graph and visible = true renders nothing.
 *
 * Both halves are fixed, because either alone leaves the hole open. The claim
 * re-adds a released group and takes it back out at teardown; and every zero
 * mat reading is now checked against an OBJECT-presence render before it is
 * allowed to be called MATLOST. An empty panel is STAGEFAIL and fails the run,
 * which is where a harness defect belongs.
 *
 * THE LESSON IS THE ONE THIS FILE ALREADY TEACHES TWICE. Both earlier defects
 * flattered the result; this one did the opposite and manufactured a defect in
 * somebody else's file. A control that cannot fail in its own favour is not
 * therefore trustworthy -- it just fails in the other direction.
 *
 * ---- DEFECT 4: THE FILENAME WAS A HINT ------------------------------------
 *
 * A previous reader named tools/aid.png as the reason the word "cup" came to
 * mind. So panels are written OUTSIDE the repository, under random hex names,
 * in a shuffled order, with the key in a separate directory the reader is
 * never pointed at. The panel directory contains images and PROMPT.txt and
 * nothing else -- no kind, no variant number, no distance, no ordering.
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

const SKIP = String(arg('skip', '150'));
const DATE = arg('date', null);
const W = parseInt(arg('w', 390), 10);
const H = parseInt(arg('h', 844), 10);
// 8, 12 and 25. The near end of the read, the middle, and READ_NEAR -- the
// distance the lane is actually chosen at, which every identification claim
// in this project has had to be re-made at.
const DISTS = String(arg('dist', '8,12,25')).split(',').map(Number);
const ONLY_KIND = arg('kind', null);
const ONLY_VAR = arg('variant', null);
const SAMPLE = parseInt(arg('sample', 0), 10);
/**
 * --nomat renders the panel with the telegraph mat HIDDEN.
 *
 * The mat is the game's primary WHAT-TO-DO channel and this tool exists partly
 * because an earlier version omitted it by accident. Dropping it ON PURPOSE is
 * the only way to ask what it is worth, and the two uses must not be confused:
 * a run without this flag is the game, and a run with it is a counterfactual.
 * Every key file records which it was, and the panel note says so too.
 */
const NOMAT = !!arg('nomat', false);
/**
 * --art WIDENS THE CROP TO CONTAIN THE OBJECT, and it exists because the
 * default does not.
 *
 * The window below is taken from MR.Collision.BOX, on the stated grounds that
 * the box is the contract. For a JUMP (yMax 0.80) and a BLOCK (2.80) the box
 * and the art are nearly the same thing. FOR A DUCK THEY ARE NOT: the box is
 * y 1.41 to 1.83 and the art runs to between 3.10 and 3.58, so more than four
 * box-heights of the object sit above the crop and only the 14% margin lets
 * any of it in. Everything this kind is differentiated BY lives up there --
 * duckScaffoldGeo's header says so in as many words, that the whole budget is
 * what the standards are made of, what is bolted to them between 1.9 and 3.6,
 * and how they TERMINATE.
 *
 * So every DUCK naming this instrument has ever taken was of a crop with the
 * differentiators cut off, and the giveaway was in the key all along: eight
 * variants whose art ranges 3.10 to 3.58 tall all report objectPx 187x202 at
 * 8 units, to the pixel, because the rectangle reported is the box.
 *
 * IT IS NOT THE DEFAULT AND SHOULD NOT BECOME ONE. The route question --
 * over, under or around -- is a question about the box, the default crop is
 * the right frame for it, and it is the crop every published route score was
 * taken at. This flag is for the OTHER question the prompt asks, "what is
 * it", which is a question about the object.
 */
const ART = !!arg('art', false);
const SEED = parseInt(arg('seed', String(Date.now() % 2147483647)), 10);
const OUT = path.resolve(String(arg('out', path.join(os.tmpdir(), 'mr-blindread'))));

/**
 * THE PANELS MUST NOT LAND IN THE REPOSITORY, and that is checked rather than
 * intended. A path inside the tree is one git status away from being a label,
 * and it is also how a crop ends up committed next to the source that made it.
 */
if (OUT === ROOT || OUT.startsWith(ROOT + path.sep)) {
  console.log('REFUSED: --out is inside the repository (' + OUT + ').');
  console.log('Panels carry no labels; a path inside the tree is a label.');
  process.exit(1);
}

// A seeded shuffle, so a run is reproducible from its key and the order is
// still nothing a reader can read anything out of.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * THE READER PROMPT, and every word in it is load-bearing.
 *
 * The three words over, under and around cannot be avoided -- they are the
 * question. Nothing else about the game appears: no hazard, no obstacle, no
 * lane, no kind, no colour, no mention that the images come from a game at
 * all. "A person running along the road" is the least that makes the second
 * question answerable.
 *
 * It asks for the MOST SPECIFIC name deliberately. See the contamination note
 * at the top: a generic noun may be the leaked vocabulary talking, and only a
 * specific one is evidence that the image was read.
 */
const PROMPT = [
  'Here are some images. Look at each one on its own.',
  '',
  'For each image, answer three things:',
  '',
  '  1. WHAT IS IT? Name the main object as specifically as you can.',
  '     "A green van" is a better answer than "a vehicle". If you genuinely',
  '     cannot tell, write "cannot tell" -- that is a real answer and it is',
  '     more useful than a guess dressed up as one.',
  '  2. OVER, UNDER, or AROUND? A person is running along the road toward',
  '     this object. Must they go over it, under it, or around it?',
  '  3. HOW SURE ARE YOU, on each of the two answers: sure, fairly sure, or',
  '     guessing.',
  '',
  'Answer the images independently. Do not assume they are the same object,',
  'and do not let one answer set up the next. Give your answer for every',
  'image, by filename.',
  '',
];

// ---------------------------------------------------------------------------
// IN-PAGE: setup, one shot per panel, teardown.
// ---------------------------------------------------------------------------

function setup(o) {
  const g = MR.game, THREE = window.THREE, K = MR.K, B = MR.Collision.BOX;

  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position);
  cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect;
  cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  // ---- find one pooled hazard group per kind ------------------------------
  //
  // Identified by the variant offset the pool builder writes -- vg.position.z
  // is MR.Collision.BOX[kind].halfZ, and the three are 0.52, 0.30 and 1.95.
  // A SCHEMA GUARD, because this is a fact about another file: if two kinds
  // ever share a halfZ the identification is ambiguous and this tool must stop
  // rather than photograph a DUCK and call it a JUMP.
  const KINDS = [['JUMP', K.JUMP], ['DUCK', K.DUCK], ['BLOCK', K.BLOCK]];
  const byHalfZ = {};
  for (const kv of KINDS) {
    const hz = B[kv[1]].halfZ;
    if (byHalfZ[hz]) return { err: 'two kinds share halfZ ' + hz + ' -- blindread cannot identify a pool by it' };
    byHalfZ[hz] = kv[0];
  }

  const groups = {};
  const pooled = [];
  g.world.group.traverse(function (n) {
    if (!n.userData || !n.userData.variants || !n.userData.notScenery) return;
    pooled.push(n);
  });
  for (const n of pooled) {
    const vs = n.userData.variants;
    if (!vs.length) continue;
    const kname = byHalfZ[+vs[0].position.z.toFixed(4)];
    if (!kname || groups[kname]) continue;
    // The mat: the pool builder's one non-variant child. Named by what it is
    // rather than by its index, so a new sibling breaks this loudly instead of
    // being photographed as the mat.
    let mat = null, extras = 0;
    for (const c of n.children) {
      if (vs.indexOf(c) >= 0) continue;
      extras++;
      if (c.isMesh) mat = c;
    }
    groups[kname] = { grp: n, mat: mat, extras: extras };
  }
  const missing = KINDS.map(function (kv) { return kv[0]; }).filter(function (k) { return !groups[k]; });
  if (missing.length) {
    return { err: 'no live hazard on the road to borrow for: ' + missing.join(', ')
      + ' -- try another --skip. Pool.release removes an object from the scene, '
      + 'so only kinds currently cast can be borrowed.' };
  }
  /**
   * ---- THE TELEGRAPH MAT IS GONE AND THIS ASSERTION IS WHAT NOTICED -----
   *
   * This demanded exactly ONE non-variant child, and named it: the telegraph
   * mat, 16 units of iconised paint the pool builder laid in front of every
   * hazard. The owner removed the whole language -- "Remove all telegraph
   * mats. Mats should all be there to increase or decrease speed" -- so the
   * expected count is now ZERO and every mat-shaped thing below has nothing to
   * measure.
   *
   * The assertion is kept rather than deleted, with both counts legal, because
   * its real job was never the number: it was to fail LOUDLY if the pooled
   * group grew a sibling this tool would otherwise photograph as the mat. Two
   * or more children still means somebody added something and blindread has to
   * be looked at.
   *
   * WHAT THIS DOES NOT WEAKEN, and it is the half worth keeping: the
   * OBJECT-presence render below. That is the control that turns an empty
   * panel into a STAGEFAIL instead of a quiet zero, and it is independent of
   * whether any paint exists.
   */
  for (const k in groups) {
    if (groups[k].extras > 1) {
      return { err: k + ' pool group has ' + groups[k].extras + ' non-variant children, '
        + 'expected 0 (the telegraph mat was removed) or 1 -- blindread needs updating' };
    }
  }

  // ---- snapshot everything this tool is about to write --------------------
  const restore = [];
  for (const k in groups) {
    const n = groups[k].grp;
    restore.push({ o: n, pos: n.position.clone(), rot: n.rotation.clone(), vis: n.visible, parent: n.parent });
    if (groups[k].mat) restore.push({ o: groups[k].mat, vis: groups[k].mat.visible });
    for (const vg of n.userData.variants) {
      const rec = { o: vg, vis: vg.visible };
      const u = vg.userData;
      if (u.body) { rec.bodySZ = u.body.scale.z; rec.bodyPZ = u.body.position.z; rec.body = u.body; }
      if (u.face) { rec.face = u.face; rec.faceVis = u.face.visible; }
      if (u.ride) { rec.ride = u.ride; rec.rideVis = u.ride.visible; }
      restore.push(rec);
    }
  }

  // Everything else that is a hazard comes off the road, so the panel has one
  // object in it. The runner and the ghost come off too: neither is the object
  // under test, and a pair of shoulders in the bottom of a crop tells a reader
  // what kind of picture they are looking at.
  const hidden = [];
  for (const n of pooled) {
    if (n === groups.JUMP.grp || n === groups.DUCK.grp || n === groups.BLOCK.grp) continue;
    if (!n.visible) continue;
    hidden.push([n, n.visible]); n.visible = false;
  }
  for (const r of [g.runner && g.runner.group, g.ghost && g.ghost.group]) {
    if (r && r.visible) { hidden.push([r, r.visible]); r.visible = false; }
  }
  for (const k in groups) groups[k].grp.visible = false;

  const rt = new THREE.WebGLRenderTarget(o.w, o.h);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;

  /**
   * THE CLOCK IS STOPPED, AND MATCHECK IS THE REASON.
   *
   * MATCHECK is a difference between two renders of the same scene, one with
   * the mat and one without. That is only a measurement of the mat if nothing
   * else changed between them -- and this game animates from performance.now()
   * inside onBeforeRender, so the wind on every tree, the crowd wave and the
   * sky all move in the milliseconds between the two calls to render().
   *
   * The first version of this control did not stop the clock. It reported
   * 38,594 differing pixels on a DUCK panel and a difference bounding box of
   * the ENTIRE FRAME, which is not a 1.95-unit strip of paint on the road; it
   * was measuring the weather. Worse, it was measuring it in the flattering
   * direction: animation noise inside the crop would have counted as mat
   * pixels and passed a panel with no mat in it at all. tools/motion.js paid
   * for this same lesson in its own header and this file did not read it
   * closely enough the first time.
   *
   * Frozen here rather than around each render, so every panel in a run is
   * also photographed at the same instant of wind and the same frame of the
   * crowd -- the panels become comparable to each other as a side effect.
   */
  const realNow = performance.now.bind(performance);
  const frozen = realNow();
  performance.now = function () { return frozen; };

  window.__BR = {
    cam: cam, groups: groups, restore: restore, hidden: hidden, rt: rt,
    // Groups this tool put back into the scene after the pool released them.
    // Taken out again at teardown, or the pool's free list would hold objects
    // that are still parented and its next claim would double-add them.
    readded: [],
    realNow: realNow,
    buf: new Uint8Array(o.w * o.h * 4),
    prevRT: g.renderer.getRenderTarget(),
    w: o.w, h: o.h,
    // See the crop window: --art widens it to contain the ART as well as the
    // collision box.
    art: !!o.art,
  };

  const counts = {};
  for (const kv of KINDS) {
    let i = 0;
    while (g.world.variantObject(kv[1], i)) i++;
    counts[kv[0]] = i;
  }
  return {
    counts: counts,
    lane: g.player.lane,
    runnerZ: g.pace.units,
    fov: +cam.fov.toFixed(2), near: cam.near,
  };
}

function shoot(job) {
  const g = MR.game, THREE = window.THREE, K = MR.K, B = MR.Collision.BOX;
  const S = window.__BR;
  const KID = { JUMP: K.JUMP, DUCK: K.DUCK, BLOCK: K.BLOCK }[job.kind];
  const rec = S.groups[job.kind];
  const grp = rec.grp, mat = rec.mat;
  const box = B[KID];
  const EL = (g.course && g.course.elevation) || MR.Elevation.FLAT;

  const z = job.runnerZ + job.dist;
  const yBase = EL.at(z);
  const laneX = K.LANE_X[job.lane];

  // ---- place it exactly as the claim site places one ---------------------
  //
  // BACK INTO THE SCENE FIRST. The race is still running between panels -- see
  // the object-presence control below for why performance.now does not stop it
  // -- and Pool.release does parent.remove(o) once the runner is past the gate
  // this group was borrowed from. A group that has been released is no longer
  // in the scene graph at all, so visible = true renders nothing.
  if (!grp.parent) { g.world.group.add(grp); S.readded.push(grp); }
  grp.visible = true;
  grp.position.set(laneX, yBase, z);
  grp.rotation.x = -Math.atan(EL.slope(z));

  // ---- and dress it exactly as the claim site dresses one ----------------
  //
  // Every field the pool recycles, written on this claim, for the reason the
  // claim site gives: a hazard inheriting the previous tenant's body, open
  // tail or stretched scale is a photograph of something the road never wore.
  const vs = grp.userData.variants;
  for (let i = 0; i < vs.length; i++) vs[i].visible = (i === job.variant);
  const vg = vs[job.variant];
  // Not rideable and not a train: the state the overwhelming majority of casts
  // are in, and the state world.js says the audits should be measuring.
  if (vg.userData.ride) vg.userData.ride.visible = false;
  if (vg.userData.face) vg.userData.face.visible = true;
  if (vg.userData.body) { vg.userData.body.scale.z = 1; vg.userData.body.position.z = 0; }

  // ---- the crop window ----------------------------------------------------
  //
  // Taken from the COLLISION box and the near run of the mat, not from the
  // art's bounding box: the collision box is the contract, and the mat is the
  // thing this harness exists to stop losing.
  //
  // IT IS NOT SQUARE, AND MATCHECK IS WHY. The first version squared the crop
  // up so that no panel's aspect could say anything about its kind, and capped
  // the side at the SHORT side of the viewport. A BLOCK is 2.80 tall and its
  // mat runs six units of road toward the lens, so at 8 units that union is
  // far taller than 390 px; the square clamped to 390, centred, and cut the
  // mat clean off. MATCHECK failed 2 of 4 panels on the very first run --
  // which is the defect this harness exists to fix, reappearing in the harness
  // itself, caught by the control instead of by a reader. The window is now
  // the union rect, clamped per axis, and the aspect of a crop is allowed to
  // be what the object makes it.
  //
  // NOT RESAMPLED. A crop is 1:1 with the frame, so a panel at 25 units is
  // small and a panel at 8 units is large, which is the truth of the read. An
  // upscaled 25-unit crop would be a picture of a read the player never gets.
  const P = new THREE.Vector3();
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  function mark(wx, wy, wz) {
    P.set(wx, wy, wz).project(S.cam);
    const px = (P.x * 0.5 + 0.5) * S.w, py = (1 - (P.y * 0.5 + 0.5)) * S.h;
    if (!isFinite(px) || !isFinite(py)) return;
    sx0 = Math.min(sx0, px); sx1 = Math.max(sx1, px);
    sy0 = Math.min(sy0, py); sy1 = Math.max(sy1, py);
  }
  for (let i = 0; i < 8; i++) {
    mark(laneX + (i & 1 ? box.halfX : -box.halfX),
         yBase + (i & 2 ? box.yMax : box.yMin),
         z + (i & 4 ? 2 * box.halfZ : 0));
  }
  // THE ART, under --art only. Box3 walks bounding boxes and so overstates a
  // rotated part, which is the wrong error for a measurement and the right one
  // for a crop: a window that is slightly too generous shows the whole object,
  // and a window that is slightly too tight is the defect this flag exists for.
  if (S.art) {
    const ab = new THREE.Box3().setFromObject(vg);
    for (let i = 0; i < 8; i++) {
      mark(i & 1 ? ab.max.x : ab.min.x, i & 2 ? ab.max.y : ab.min.y, i & 4 ? ab.max.z : ab.min.z);
    }
  }
  // The mat's near run-up. Six units of it, which is the strong end of its
  // alpha ramp; the far end fades to nothing and pulling the crop out to 16
  // units would shrink the object to a speck for no information.
  for (let i = 0; i < 4; i++) {
    const mz = z - (i & 2 ? 6 : 0);
    mark(laneX + (i & 1 ? box.halfX : -box.halfX), EL.at(mz) + 0.02, mz);
  }
  const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
  const cw = Math.round(Math.max(48, Math.min((sx1 - sx0) * 1.14, S.w)));
  const ch = Math.round(Math.max(48, Math.min((sy1 - sy0) * 1.14, S.h)));
  let x0 = Math.round(cx - cw / 2), y0 = Math.round(cy - ch / 2);
  x0 = Math.max(0, Math.min(x0, S.w - cw));
  y0 = Math.max(0, Math.min(y0, S.h - ch));
  // Whether the window the object and its mat asked for had to be cut to fit
  // the frame. Reported per panel: a lost mat is diagnosable from the key
  // rather than from re-running the tool with print statements in it.
  const clipped = (sx1 - sx0) * 1.14 > S.w || (sy1 - sy0) * 1.14 > S.h;

  function frame() {
    g.renderer.setRenderTarget(S.rt);
    g.renderer.render(g.scene, S.cam);
    g.renderer.readRenderTargetPixels(S.rt, 0, 0, S.w, S.h, S.buf);
    return new Uint8Array(S.buf);
  }

  /**
   * WHERE THE MAT GOES UNDER THE ROAD, measured before anything is rendered.
   *
   * The mat is one rigid 16-unit plane, lifted 0.012 above the road and
   * pitched by the road's slope AT THE GATE. The road is not a plane: it
   * follows the elevation profile, and behind a gate standing on any curved
   * part of that profile the road climbs away from the mat's tangent. The lift
   * is 12 millimetres of world and it does not last.
   *
   * This is measured here so that a panel with no mat in it can be told apart
   * from a panel whose mat was cropped out -- see MATCHECK below. It is a
   * statement about the game, not about this tool, and it must not be reported
   * as if it were the tool's fault.
   */
  let sinkAt = null, sinkMax = 0;
  {
    const pitch = -Math.atan(EL.slope(z));
    const cy = Math.cos(pitch), sy = Math.sin(pitch);
    for (let back = 0; back <= 15.2; back += 0.25) {
      const matY = yBase + (0.012 * cy + back * sy);
      const gap = matY - EL.at(z - back);
      if (gap < 0 && sinkAt === null) sinkAt = +back.toFixed(2);
      if (gap < sinkMax) sinkMax = gap;
    }
  }

  // MATCHECK: the same frame without the paint, so the pixels that move are
  // the mat's. With the telegraph mat removed there is no paint to hide, the
  // two renders are the same render, and every count below is a legitimate
  // zero rather than the meaningless one DEFECT 3 is about.
  if (mat) mat.visible = true;
  const withMat = frame();
  if (mat) mat.visible = false;
  const noMat = mat ? frame() : withMat;
  if (mat) mat.visible = true;

  // Counted inside the crop AND over the whole frame, with the frame-wide
  // bounding box of the difference. A mat that is drawn but landed outside the
  // window and a mat that was never drawn are two different defects with the
  // same symptom, and the first version of this control could not tell them
  // apart -- it reported zero for both and left the diagnosis to guesswork.
  let matPx = 0, matAll = 0;
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  function pixDiffers(a, b, q) {
    return Math.abs(a[q] - b[q]) > 6
        || Math.abs(a[q + 1] - b[q + 1]) > 6
        || Math.abs(a[q + 2] - b[q + 2]) > 6;
  }
  function differs(q) { return pixDiffers(withMat, noMat, q); }
  for (let Y = 0; Y < S.h; Y++) {
    const flip = S.h - 1 - Y;
    for (let X = 0; X < S.w; X++) {
      if (!differs((flip * S.w + X) * 4)) continue;
      matAll++;
      if (X < bx0) bx0 = X; if (X > bx1) bx1 = X;
      if (Y < by0) by0 = Y; if (Y > by1) by1 = Y;
      if (X >= x0 && X < x0 + cw && Y >= y0 && Y < y0 + ch) matPx++;
    }
  }

  /**
   * IS THERE ANYTHING IN THE PANEL AT ALL?
   *
   * MATCHECK counts the pixels that move when the mat is hidden, and reads a
   * zero as "the game drew no mat". It cannot tell that from "this tool drew
   * NOTHING", and the difference is the whole value of the reading: the first
   * is a finding about the game and the second is a photograph of empty road.
   *
   * It happened, and it was reported as the game's fault. A borrowed pool
   * group is a LIVE hazard on a road the race is still moving along, and
   * Pool.release does parent.remove(o) as the runner passes it. The race does
   * keep moving: main.js drives its frame from the requestAnimationFrame
   * timestamp, not from performance.now, so freezing performance.now above
   * stops the wind and the crowd and does not stop the runner. Over a
   * sixty-nine panel run the borrowed groups were released out from under this
   * tool one by one, and sixteen panels of bare tarmac were counted, printed
   * and believed as MATLOST -- against a build whose mats were fine.
   *
   * Two changes, because either alone leaves a hole. The claim above re-adds a
   * released group so it cannot happen; this control proves it did not, and
   * fails the run if it ever does again. Taken only when the mat measured
   * zero, which is the only reading this tool turns into a claim about the
   * game, so the common path still costs two renders and not three.
   */
  let objAll = null;
  if (!matAll) {
    grp.visible = false;
    const noObj = frame();
    grp.visible = true;
    objAll = 0;
    for (let q = 0; q < withMat.length; q += 4) if (pixDiffers(withMat, noObj, q)) objAll++;
  }

  /**
   * WHICH OF THE TWO RENDERS BECOMES THE PANEL.
   *
   * --nomat writes the SECOND render -- the identical frame with the mat
   * hidden -- so a no-mat panel and its with-mat twin differ in the paint and
   * in nothing else: same course, same date, same gate, same gradient, same
   * light, same backdrop, same crop rectangle. That matters more here than
   * anywhere else this tool is used, because the question is whether removing
   * the mat changes a reading, and any second difference between the two shots
   * is a rival explanation for whatever the readers say.
   *
   * MATCHECK IS NOT RELAXED IN THIS MODE, IT IS REPURPOSED. It still requires
   * that the game DREW a mat inside the crop. With the mat kept, that proves
   * the panel contains the channel. With the mat dropped, it proves the panel
   * is genuinely MISSING something -- a no-mat panel shot where no mat existed
   * anyway is not a treatment, it is the control photographed twice, and it
   * would silently turn a two-arm experiment into a one-arm one.
   */
  const panelBuf = job.nomat ? noMat : withMat;
  // Whether this build HAS a telegraph mat at all, so a zero below can be told
  // from a mat the game failed to draw. The two look identical in the pixels
  // and only this flag separates them -- which is DEFECT 3 in this file's own
  // header, arriving a second time by a different route.
  const noMats = !mat;

  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const cg = cv.getContext('2d');
  const img = cg.createImageData(cw, ch);
  for (let Y = 0; Y < ch; Y++) {
    const flip = S.h - 1 - (y0 + Y);
    const src = (flip * S.w + x0) * 4;
    img.data.set(panelBuf.subarray(src, src + cw * 4), Y * cw * 4);
  }
  cg.putImageData(img, 0, 0);
  const png = cv.toDataURL('image/png');

  grp.visible = false;
  g.renderer.setRenderTarget(S.prevRT);
  return {
    png: png, crop: [x0, y0, cw, ch], matPx: matPx, clipped: clipped, noMats: noMats,
    matAll: matAll, objAll: objAll,
    matBox: matAll ? [bx0, by0, bx1, by1] : null,
    slope: +EL.slope(z).toFixed(5),
    matSinksAt: sinkAt, matSinksBy: +sinkMax.toFixed(4),
    matShare: +(matPx / (cw * ch)).toFixed(4),
    boxPx: [+(sx1 - sx0).toFixed(1), +(sy1 - sy0).toFixed(1)],
  };
}

function teardown() {
  const S = window.__BR;
  if (!S) return true;
  for (const r of S.restore) {
    if (r.pos) { r.o.position.copy(r.pos); r.o.rotation.copy(r.rot); }
    if (r.vis !== undefined) r.o.visible = r.vis;
    if (r.body) { r.body.scale.z = r.bodySZ; r.body.position.z = r.bodyPZ; }
    if (r.face) r.face.visible = r.faceVis;
    if (r.ride) r.ride.visible = r.rideVis;
  }
  for (const h of S.hidden) h[0].visible = h[1];
  for (const o of S.readded) if (o.parent) o.parent.remove(o);
  if (S.realNow) performance.now = S.realNow;
  MR.game.renderer.setRenderTarget(S.prevRT);
  S.rt.dispose();
  delete window.__BR;
  return true;
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
  await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&skip=' + SKIP
    + (DATE ? '&date=' + DATE : ''));
  await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
  await page.waitForTimeout(2600);

  const info = await page.evaluate(setup, { w: W, h: H, art: ART });
  if (info.err) {
    console.log('FAILED: ' + info.err);
    await browser.close();
    process.exit(1);
  }

  // ---- the plan ------------------------------------------------------------
  const plan = [];
  for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
    if (ONLY_KIND && String(ONLY_KIND).toUpperCase() !== kind) continue;
    for (let v = 0; v < info.counts[kind]; v++) {
      if (ONLY_VAR !== null && parseInt(ONLY_VAR, 10) !== v) continue;
      for (const d of DISTS) {
        plan.push({ kind, variant: v, dist: d, lane: info.lane, runnerZ: info.runnerZ, nomat: NOMAT });
      }
    }
  }
  const rnd = mulberry32(SEED);
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = plan[i]; plan[i] = plan[j]; plan[j] = t;
  }
  const chosen = SAMPLE > 0 ? plan.slice(0, SAMPLE) : plan;

  const runid = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + SEED.toString(36);
  const panelDir = path.join(OUT, 'panels', runid);
  const keyDir = path.join(OUT, 'keys');
  fs.mkdirSync(panelDir, { recursive: true });
  fs.mkdirSync(keyDir, { recursive: true });

  const key = [];
  const matCrop = [];
  const matLost = [];
  const stageFail = [];
  for (const job of chosen) {
    const r = await page.evaluate(shoot, job);
    // Neutral name: eight hex digits off the shuffle stream. It carries no
    // kind, no index and no order, and it sorts to nothing.
    let name = '';
    for (let i = 0; i < 8; i++) name += '0123456789abcdef'[Math.floor(rnd() * 16)];
    const file = name + '.png';
    fs.writeFileSync(path.join(panelDir, file),
      Buffer.from(r.png.split(',')[1], 'base64'));
    /**
     * THE THREE STATES, AND THEY ARE NOT THE SAME FAILURE.
     *
     *   ok       the mat is drawn and it is inside the crop.
     *   MATCROP  the mat is drawn SOMEWHERE IN THE FRAME and this tool's crop
     *            window missed it. That is the harness omitting the thing it
     *            was built to include, which is the defect being fixed here,
     *            and it fails the run.
     *   MATLOST  the game drew no mat anywhere in the frame. Nothing this tool
     *            can crop differently will produce one. It is a finding about
     *            the game and it is reported as one -- calling it a harness
     *            failure would bury it.
     */
    // STAGEFAIL is tested FIRST now. It used to be reached only after the two
    // mat verdicts, which was correct while every panel was supposed to carry
    // paint; with the telegraph mat removed, a zero mat count is the expected
    // reading and an empty panel is the only real defect left in this column.
    const state = r.objAll === 0 ? 'STAGEFAIL'
      : r.matPx ? 'ok'
      : r.matAll ? 'MATCROP'
      : r.noMats ? 'no mat (removed)'
      : 'MATLOST';
    if (state === 'MATCROP') matCrop.push({ file, job });
    if (state === 'STAGEFAIL') stageFail.push({ file, job });
    if (state === 'MATLOST') matLost.push({ file, job, slope: r.slope, sinkAt: r.matSinksAt, sinkBy: r.matSinksBy });
    key.push({
      file, kind: job.kind, variant: job.variant, dist: job.dist, lane: job.lane,
      cropPx: [r.crop[2], r.crop[3]], objectPx: r.boxPx, clipped: r.clipped,
      crop: r.crop, matPx: r.matPx, matShare: r.matShare, mat: state,
      matAllPx: r.matAll, objAllPx: r.objAll, matBoxOnFrame: r.matBox,
      slope: r.slope, matSinksAt: r.matSinksAt, matSinksBy: r.matSinksBy,
    });
  }

  await page.evaluate(teardown);
  await browser.close();

  fs.writeFileSync(path.join(panelDir, 'PROMPT.txt'), PROMPT.join('\n'));
  fs.writeFileSync(path.join(keyDir, runid + '.json'), JSON.stringify({
    runid, seed: SEED, skip: SKIP, date: DATE, viewport: [W, H],
    fov: info.fov, lane: info.lane, dists: DISTS,
    arm: NOMAT ? 'NOMAT -- telegraph mat hidden, NOT the shipped game' : 'SHIPPED -- mat as the game draws it',
    nomat: NOMAT,
    panelDir, panels: key,
    note: (NOMAT
        ? 'THE MAT WAS DELIBERATELY HIDDEN IN THESE PANELS. They are a '
          + 'counterfactual, not the game. matPx below is the paint that was '
          + 'REMOVED from each panel, measured on the with-mat twin of the same '
          + 'frame. '
        : '')
        + 'Panels include the telegraph mat, which api.variantObject omits. '
        + 'Readers run inside this repository receive CLAUDE.md; see the header '
        + 'of tools/blindread.js for what that leaks and what it invalidates.',
  }, null, 1));

  console.log('BLINDREAD ' + runid + (NOMAT ? '   *** NOMAT ARM -- the mat is hidden ***' : ''));
  if (NOMAT) {
    console.log('  These panels are NOT the shipped game. The telegraph mat has been hidden');
    console.log('  on purpose so the reading can be compared against a with-mat arm shot on');
    console.log('  the same build, the same date, the same gate and the same crop.');
  }
  console.log('  panels   ' + panelDir + '  (' + key.length + ' images + PROMPT.txt)');
  console.log('  key      ' + path.join(keyDir, runid + '.json') + '   <- do not show the reader');
  console.log('  frame    ' + W + 'x' + H + ', fov ' + info.fov + ', lane ' + info.lane
    + ', skip ' + SKIP + (DATE ? ', date ' + DATE : ''));
  console.log('');
  console.log(NOMAT
    ? '  MATCHECK -- pixels the telegraph mat WOULD have contributed, i.e. what'
      + '\n  each panel is missing. A zero here would mean the arm removed nothing.'
    : '  MATCHECK -- pixels the telegraph mat contributes inside each crop');
  const byDist = {};
  for (const k of key) (byDist[k.dist] || (byDist[k.dist] = [])).push(k);
  for (const d of Object.keys(byDist).sort((a, b) => a - b)) {
    const rows = byDist[d];
    const ok = rows.filter((r) => r.mat === 'ok');
    const hi = ok.reduce((s, r) => Math.max(s, r.matShare), 0);
    const lo = ok.length ? ok.reduce((s, r) => Math.min(s, r.matShare), 1) : 0;
    console.log('    ' + (d + 'u').padEnd(5) + String(rows.length).padStart(3) + ' panels: '
      + ok.length + ' carry the mat'
      + (ok.length ? ' (' + (100 * lo).toFixed(1) + '% to ' + (100 * hi).toFixed(1) + '% of the crop)' : '')
      + (rows.filter((r) => r.mat === 'MATCROP').length ? ', ' + rows.filter((r) => r.mat === 'MATCROP').length + ' CROPPED OUT' : '')
      + (rows.filter((r) => r.mat === 'MATLOST').length ? ', ' + rows.filter((r) => r.mat === 'MATLOST').length + ' NOT DRAWN BY THE GAME' : '')
      + (rows.filter((r) => r.mat === 'STAGEFAIL').length ? ', ' + rows.filter((r) => r.mat === 'STAGEFAIL').length + ' EMPTY PANELS' : ''));
  }
  console.log('');
  if (stageFail.length) {
    console.log('  STAGEFAIL -- ' + stageFail.length + ' of ' + key.length + ' panels contain no object');
    console.log('    at all: hiding the whole hazard changed nothing, so there was nothing');
    console.log('    staged to photograph and the mat reading is meaningless rather than zero.');
    console.log('    This is the harness, not the game. See the object-presence control.');
    console.log('');
  }
  if (matLost.length) {
    // A FINDING, NOT A FAILURE, and the number that makes it one is printed
    // beside it. See the sink measurement in shoot().
    const worst = matLost.reduce((a, b) => (b.sinkBy < a.sinkBy ? b : a));
    console.log('  MATLOST -- the game drew no telegraph mat at all on ' + matLost.length
      + ' of ' + key.length + ' panels.');
    console.log('    The mat is one rigid 16-unit plane lifted 0.012 above the road and pitched');
    console.log('    by the slope AT THE GATE; the road profile curves away behind it, so the');
    console.log('    run-up submerges. Steepest case here: slope ' + worst.slope
      + ', under the road from ' + worst.sinkAt + 'u behind the gate, ' + (-worst.sinkBy).toFixed(3) + 'u deep.');
    console.log('    That is the primary WHAT TO DO channel going missing at the distance the');
    console.log('    lane is chosen. It is in src/render/world.js, not in this tool.');
    console.log('');
  }
  console.log('  ---- THE READER PROMPT (also written as PROMPT.txt) ----');
  for (const line of PROMPT) console.log('  | ' + line);

  if (errs.length) console.log('\n  PAGE ERRORS: ' + errs.slice(0, 4).join(' | '));
  if (stageFail.length) {
    console.log('\nFAIL MATCHECK: ' + stageFail.length + ' of ' + key.length
      + ' panels were empty -- this tool staged nothing and photographed the road.');
    console.log('A zero mat reading off an empty panel is not a finding about the game.');
    for (const m of stageFail.slice(0, 6)) {
      console.log('  ' + m.file + '  ' + m.job.kind + ' v' + m.job.variant + ' at ' + m.job.dist + 'u');
    }
    process.exit(1);
  }
  if (matCrop.length) {
    console.log('\nFAIL MATCHECK: ' + matCrop.length + ' of ' + key.length
      + ' panels cropped out a mat the game DID draw. That is this harness omitting');
    console.log('the thing it was built to include, which is the defect it exists to fix.');
    for (const m of matCrop.slice(0, 6)) {
      console.log('  ' + m.file + '  ' + m.job.kind + ' v' + m.job.variant + ' at ' + m.job.dist + 'u');
    }
    process.exit(1);
  }
  if (errs.length) process.exit(1);
  if (NOMAT) {
    console.log('OK: every panel had a mat to lose and lost it, so this arm really is the');
    console.log('with-mat arm minus the paint, and nothing in the panel directory names');
    console.log('the answer' + (matLost.length ? ' -- but see MATLOST above' : '') + '.');
    return;
  }
  console.log('OK: every panel the game drew a mat for carries it, and nothing in the panel');
  console.log('directory names the answer'
    + (matLost.length ? ' -- but see MATLOST above before drawing any over/under conclusion' : ''));
})();
