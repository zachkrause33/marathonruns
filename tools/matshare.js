#!/usr/bin/env node
/**
 * WHAT THE TELEGRAPH MATS ARE WORTH TO THE LOOK OF THE ROAD.
 *
 *   node tools/matshare.js                       12 samples across a race
 *   node tools/matshare.js --samples 24
 *   node tools/matshare.js --date 2026-08-11
 *   node tools/matshare.js --png /some/dir       also write the frames out
 *
 * BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT. Every object in this game
 * is modelled on all sides, always. A marking PAINTED on a surface is the one
 * thing that is not an object and correctly has no back -- and the telegraph
 * mat is exactly that, so it is the subject here. Nothing this tool prints
 * licenses a half-built anything.
 *
 * ---- THE QUESTION -------------------------------------------------------
 *
 * The owner has proposed dropping the mat from BLOCK hazards and keeping it on
 * JUMP and DUCK. Whether a BLOCK still READS without its mat is a question for
 * tools/blindread.js and a human reader. This file answers the other half: how
 * much of the picture goes away if a third of the paint does.
 *
 * Three conditions, rendered from ONE frozen frame of ONE live race:
 *
 *   SHIPPED     every mat as the game draws it
 *   NO-BLOCK    BLOCK mats hidden, JUMP and DUCK mats kept -- the proposal
 *   NO-MAT      every mat hidden -- the floor, for scale
 *
 * ---- HOW THIS COULD HAVE BEEN WRONG -------------------------------------
 *
 * Rule 3, and this project's instruments have all been wrong first.
 *
 *  1. MEASURING THE WEATHER. A difference between two renders is a measurement
 *     of the mat only if nothing else moved. The game animates trees, crowd
 *     and sky from performance.now() inside onBeforeRender, and blindread.js
 *     records what that cost: 38,594 differing pixels and a difference box the
 *     size of the whole frame, from a change to a strip of road paint. The
 *     clock is frozen here and the three renders happen inside ONE evaluate
 *     with no game update between them, so they are the same instant.
 *
 *  2. SAMPLING WHERE THE MATS ARE. A tool that picks its own vantage points
 *     can pick flattering ones. Samples are spaced EVENLY over the race by
 *     skip distance and every sample is reported, not just the mean; the
 *     spread is printed because a mat's share swings with how many gates
 *     happen to be in shot and the mean alone hides that.
 *
 *  3. QUOTING A SHARE OF THE FRAME. The near band is a third of the frame, so
 *     a frame-share invites the reader to divide by three in their head, and
 *     docs/near-band-colour.md records that this project has already shipped
 *     one number that was a third of what a reader took it for. Every share
 *     here is quoted as a share of THE NEAR BAND and the band is named.
 *
 *  4. COUNTING PIXELS AND CALLING IT COLOUR. Area is not chroma: a mat could
 *     be 30% of the band and change its colour not at all if it were grey.
 *     So the frames are also written as PNGs for tools/chroma.js, which is an
 *     audited instrument this file does not attempt to reimplement.
 *
 *  5. THE HUD. It is not the road and it does not move when a mat is hidden,
 *     so it would sit in the denominator diluting every share. Hidden.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}
const SAMPLES = parseInt(arg('samples', '12'), 10);
const DATE = arg('date', '2026-08-11');
const PNGDIR = arg('png', null);
const W = parseInt(arg('w', 620), 10);
const H = parseInt(arg('h', 1344), 10);

/**
 * In the page: freeze, render the three conditions, count what moved.
 *
 * Mats are found the same way blindread.js finds them -- the pool builder's
 * one non-variant mesh child of a group carrying userData.variants -- and the
 * same schema guard applies: if a group ever grows a second non-variant child
 * this tool must stop rather than photograph the wrong mesh and call it paint.
 */
function measure(o) {
  const g = MR.game, THREE = window.THREE, K = MR.K, B = MR.Collision.BOX;

  const byHalfZ = {};
  const pairs = [['JUMP', K.JUMP], ['DUCK', K.DUCK], ['BLOCK', K.BLOCK]];
  for (const kv of pairs) {
    const hz = +B[kv[1]].halfZ.toFixed(4);
    if (byHalfZ[hz]) return { err: 'two kinds share halfZ ' + hz };
    byHalfZ[hz] = kv[0];
  }

  const mats = { JUMP: [], DUCK: [], BLOCK: [] };
  let bad = 0;
  g.world.group.traverse(function (n) {
    if (!n.userData || !n.userData.variants || !n.userData.notScenery) return;
    const vs = n.userData.variants;
    if (!vs.length) return;
    const kn = byHalfZ[+vs[0].position.z.toFixed(4)];
    if (!kn) return;
    let mat = null, extras = 0;
    for (const c of n.children) {
      if (vs.indexOf(c) >= 0) continue;
      extras++;
      if (c.isMesh) mat = c;
    }
    if (extras !== 1) { bad++; return; }
    if (mat && n.visible) mats[kn].push(mat);
  });
  if (bad) return { err: bad + ' pool groups have more than one non-variant child -- matshare needs updating' };
  const live = mats.JUMP.length + mats.DUCK.length + mats.BLOCK.length;
  if (!live) return { err: 'no live hazard on the road at this skip' };

  // The HUD is not the road. See defect 5 in the header.
  const hud = document.querySelector('#hud') || document.querySelector('.hud');
  const hudPrev = hud ? hud.style.display : null;
  if (hud) hud.style.display = 'none';

  // FREEZE. See defect 1.
  const realNow = performance.now.bind(performance);
  const frozen = realNow();
  performance.now = function () { return frozen; };

  const cam = g.cam.camera;
  const rt = new THREE.WebGLRenderTarget(o.w, o.h);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const prevRT = g.renderer.getRenderTarget();
  const buf = new Uint8Array(o.w * o.h * 4);

  function frame() {
    g.renderer.setRenderTarget(rt);
    g.renderer.render(g.scene, cam);
    g.renderer.readRenderTargetPixels(rt, 0, 0, o.w, o.h, buf);
    return buf.slice();
  }
  function setVis(kinds, v) {
    for (const k of kinds) for (const m of mats[k]) m.visible = v;
  }

  const prev = {};
  for (const k in mats) prev[k] = mats[k].map(function (m) { return m.visible; });

  setVis(['JUMP', 'DUCK', 'BLOCK'], true);
  const shipped = frame();
  setVis(['BLOCK'], false);
  const noBlock = frame();
  setVis(['JUMP', 'DUCK'], false);
  const noMat = frame();

  // restore
  for (const k in mats) for (let i = 0; i < mats[k].length; i++) mats[k][i].visible = prev[k][i];
  performance.now = realNow;
  g.renderer.setRenderTarget(prevRT);
  rt.dispose();
  if (hud) hud.style.display = hudPrev;

  /**
   * readRenderTargetPixels is BOTTOM-UP: row 0 is the BOTTOM of the screen.
   * The near band is therefore rows [0, h/3), NOT the last third of the
   * buffer. nearband.js and chromadepth.js both assert this because getting it
   * backwards silently inverts every finding -- it would measure the sky and
   * report it as the road.
   */
  const bandH = Math.floor(o.h / 3);
  function diff(a, b) {
    let band = 0, all = 0;
    for (let y = 0; y < o.h; y++) {
      for (let x = 0; x < o.w; x++) {
        const q = (y * o.w + x) * 4;
        if (Math.abs(a[q] - b[q]) > 6 || Math.abs(a[q + 1] - b[q + 1]) > 6
            || Math.abs(a[q + 2] - b[q + 2]) > 6) {
          all++;
          if (y < bandH) band++;
        }
      }
    }
    return { band: band, all: all };
  }

  function toPng(bufr) {
    const cv = document.createElement('canvas');
    cv.width = o.w; cv.height = o.h;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(o.w, o.h);
    for (let y = 0; y < o.h; y++) {
      const flip = o.h - 1 - y;
      img.data.set(bufr.subarray(flip * o.w * 4, (flip + 1) * o.w * 4), y * o.w * 4);
    }
    cg.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  const blockOnly = diff(shipped, noBlock);
  const allMat = diff(shipped, noMat);
  const jdMat = diff(noBlock, noMat);

  return {
    z: g.pace ? g.pace.units : null,
    live: { JUMP: mats.JUMP.length, DUCK: mats.DUCK.length, BLOCK: mats.BLOCK.length },
    bandPx: bandH * o.w,
    framePx: o.w * o.h,
    blockOnly: blockOnly, allMat: allMat, jdMat: jdMat,
    png: o.png ? { shipped: toPng(shipped), noBlock: toPng(noBlock), noMat: toPng(noMat) } : null,
  };
}

(async () => {
  try {
    const chk = execFileSync('node', [path.join(ROOT, 'tools/build.js'), '--check'],
      { cwd: ROOT, encoding: 'utf8' });
    if (!/up to date/.test(chk)) { console.log('FAILED build.js --check:\n' + chk); process.exit(1); }
  } catch (e) { console.log('FAILED build.js --check: ' + (e.stdout || e.message)); process.exit(1); }

  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });

  console.log('=========== WHAT THE MATS ARE WORTH TO THE ROAD ===========');
  console.log('date ' + DATE + ', ' + W + 'x' + H + ', HUD hidden, near band = bottom third');
  console.log('');
  /**
   * THE FRAME-WIDE COLUMN EXISTS TO STOP ONE MISREADING.
   *
   * A near-band share of 0.00% has two completely different causes: the game
   * drew no mat, or the game drew one and it is further up the frame than the
   * bottom third. blindread.js learned this exact lesson as MATCROP vs
   * MATLOST and had to be fixed for it; a tool that prints only the band would
   * report "the mats contribute nothing here" when what is true is "the
   * nearest gate is not close yet". They are printed side by side.
   */
  console.log('  skip   live mats J/D/B   BLOCK mat %   all mat %    all mat %    BLOCK share');
  console.log('                           of NEAR BAND  of NEAR BAND of FRAME     of mat px');

  const rows = [];
  if (PNGDIR) fs.mkdirSync(PNGDIR, { recursive: true });
  for (let i = 0; i < SAMPLES; i++) {
    /**
     * ?skip= IS IN RACE SECONDS, NOT IN UNITS, and the first version of this
     * loop spaced its samples 0 to 6100 as though it were units -- the course
     * length. A clean race is 236 seconds, so nine of ten samples were past
     * the tape, the road was empty, and the tool printed "no live hazard" nine
     * times and a confident mean off the ONE sample that landed inside the
     * race. It failed loudly, which is the only reason it was caught; had the
     * clamp been silent it would have reported ten copies of one frame.
     *
     * 20 s to 225 s: inside the race at both ends, and past START_GRACE.
     */
    const skip = Math.round(20 + i * (225 - 20) / Math.max(1, SAMPLES - 1));
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(e.message.split('\n')[0]); });
    await page.goto('file://' + path.join(ROOT, 'index.html') + '?bot=1&date=' + DATE + '&skip=' + skip);
    await page.waitForFunction(function () { return window.MR && MR.game && MR.game.ready; }, { timeout: 40000 });
    await page.waitForTimeout(2000);
    const r = await page.evaluate(measure, { w: W, h: H, png: !!PNGDIR });
    if (errs.length) { console.log('FAILED: page threw at skip ' + skip + ': ' + errs[0]); await browser.close(); process.exit(1); }
    if (r.err) { console.log('  ' + String(skip).padStart(5) + '   ' + r.err); await ctx.close(); continue; }
    rows.push(r);
    if (PNGDIR && r.png) {
      for (const cond of ['shipped', 'noBlock', 'noMat']) {
        fs.writeFileSync(path.join(PNGDIR, 'skip' + skip + '-' + cond + '.png'),
          Buffer.from(r.png[cond].split(',')[1], 'base64'));
      }
    }
    console.log('  ' + String(skip).padStart(5) + '   '
      + String(r.live.JUMP + '/' + r.live.DUCK + '/' + r.live.BLOCK).padEnd(15)
      + String((100 * r.blockOnly.band / r.bandPx).toFixed(2) + '%').padStart(10)
      + String((100 * r.allMat.band / r.bandPx).toFixed(2) + '%').padStart(13)
      + String((100 * r.allMat.all / r.framePx).toFixed(2) + '%').padStart(13)
      + String(r.allMat.band ? (100 * r.blockOnly.band / r.allMat.band).toFixed(0) + '%'
        : (r.allMat.all ? 'up-frame' : 'NO MAT')).padStart(13));
    await ctx.close();
  }
  await browser.close();

  if (!rows.length) { console.log('no samples'); process.exit(1); }
  function mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }
  const bandAll = rows.map(function (r) { return 100 * r.allMat.band / r.bandPx; });
  const bandBlk = rows.map(function (r) { return 100 * r.blockOnly.band / r.bandPx; });
  const shareBlk = rows.filter(function (r) { return r.allMat.band > 0; })
    .map(function (r) { return 100 * r.blockOnly.band / r.allMat.band; });
  console.log('');
  console.log('ALL MATS       ' + mean(bandAll).toFixed(2) + '% of the near band on average, '
    + Math.min.apply(null, bandAll).toFixed(2) + '% to ' + Math.max.apply(null, bandAll).toFixed(2) + '%');
  console.log('BLOCK MATS     ' + mean(bandBlk).toFixed(2) + '% of the near band on average, '
    + Math.min.apply(null, bandBlk).toFixed(2) + '% to ' + Math.max.apply(null, bandBlk).toFixed(2) + '%');
  /**
   * POOLED, NOT A MEAN OF RATIOS.
   *
   * Most samples have no BLOCK mat in the near band at all, so the per-sample
   * ratio is zero in most rows and a mean over those rows is dragged to a
   * number that describes the ZEROS rather than the paint. The pooled figure
   * -- all BLOCK mat pixels over all mat pixels, summed across the sweep --
   * is what "a third of the mats" should be checked against. Both are printed
   * because they answer different questions and the gap between them is large
   * enough to change a decision.
   */
  const sumBlk = rows.reduce(function (a, r) { return a + r.blockOnly.band; }, 0);
  const sumAll = rows.reduce(function (a, r) { return a + r.allMat.band; }, 0);
  const sumBlkF = rows.reduce(function (a, r) { return a + r.blockOnly.all; }, 0);
  const sumAllF = rows.reduce(function (a, r) { return a + r.allMat.all; }, 0);
  console.log('BLOCK SHARE    mean of per-sample ratios ' + mean(shareBlk).toFixed(0) + '%  '
    + '(most samples have no BLOCK mat in the band, so this describes the zeros)');
  console.log('               POOLED over the sweep: ' + (100 * sumBlk / sumAll).toFixed(1)
    + '% of near-band mat pixels are on BLOCKs,');
  console.log('               and ' + (100 * sumBlkF / sumAllF).toFixed(1) + '% of mat pixels frame-wide.');
  console.log('');
  console.log('The proposal removes the BLOCK row and keeps the rest. AREA IS NOT COLOUR:');
  console.log('run tools/chroma.js over the PNGs from --png to see what the near band does');
  console.log('in chroma, which is the number docs/near-band-colour.md is actually about.');
})();
