#!/usr/bin/env node
/**
 * CANOPY -- is a tree in this frame a TREE, or is it a brown post?
 *
 *   node tools/canopy.js
 *   node tools/canopy.js --skip 25,110,185 --frames 4
 *
 * ---- WHY THIS EXISTS ------------------------------------------------------
 *
 * A blind reader shown a whole gameplay frame, asked only about the PEOPLE in
 * it, volunteered this instead: "a group of tall brown vertical slabs I
 * genuinely cannot identify; they might be people in brown, or wooden posts,
 * or market stall frames." They are tree trunks. docs/roadmap.md entry 23 files
 * it as "a part that is present, correct and worth less than nothing, because
 * it reads as an unidentifiable object."
 *
 * Nothing in this repo could say how often that happens, because every tree
 * instrument measured the tree in isolation. A tree in isolation always has a
 * canopy. What decides whether the PLAYER sees one is the street wall at
 * x 12.20, the crowd barrier, the hoarding on THE WALL, and the top edge of the
 * viewport -- none of which are properties of the tree.
 *
 * ---- ONE THING ABOUT ?skip=, WHICH COST THE FIRST RUN OF THIS TOOL --------
 *
 * ?skip= is race SECONDS and it SATURATES. Measured on the live page: skip 60
 * is mile 6.11, skip 150 is mile 16.26, and skip 240 is mile 26.22 at z 6293 --
 * the finish. Every skip from 240 upward returns that same frame. So a sweep
 * over "150,900,1560,2050" is not four legs of the course, it is one leg and
 * the finish photographed three times, and the agreement between the last
 * three rows is the tool agreeing with itself.
 *
 * tools/people.js still ships those four as its default. tools/shoot.js does
 * not -- its eight shots run 25 to 225 and every one of them lands inside the
 * race. The skips below are chosen the same way.
 *
 * ---- WHAT IT MEASURES -----------------------------------------------------
 *
 * For every tree instance the claim sites have placed in front of the camera,
 * the visible pixel count of its TRUNK and of its CANOPY, separately, in the
 * real frame, after the real occluders.
 *
 * The split is by the authored hex. vTree writes the trunk in one flat colour
 * (o.trunk, per setting) and the canopy in the setting's own 2-3 band colours,
 * and merge() carries those hexes into the vertex colour attribute -- so the
 * two are separable exactly, with no threshold. The tree's material is swapped
 * for an unlit, unfogged, untonemapped vertex-colour material whose only two
 * colours are pure magenta (trunk) and pure green (canopy), and the frame is
 * rendered with EVERYTHING ELSE UNTOUCHED. So the depth buffer is the shipped
 * one and the occlusion is the shipped occlusion; only the tree's shading
 * changes, and the two keys land on the framebuffer as their own bytes.
 *
 * The verdict per tree:
 *
 *   POST    trunk pixels over the floor, canopy pixels at or under it. The
 *           failure the blind reader named: a vertical object with nothing on
 *           top of it to say what it is.
 *   THIN    canopy visible but under 25% of the tree's own visible pixels. A
 *           tree is mostly crown; a sliver of green over a long post is still
 *           read from the post.
 *   TREE    anything else.
 *
 * ---- AUDITING THIS INSTRUMENT ---------------------------------------------
 *
 * The floor is 12 px and it is not arbitrary: it is above the count a single
 * antialiased edge can produce, measured by keying a tree that is fully behind
 * the street wall and confirming it returns 0/0 rather than a rim.
 *
 * It counts what is ON SCREEN, so a tree whose canopy is above the top of the
 * viewport counts as a POST -- which is correct, because the player cannot see
 * it either, and "the canopy exists in world space" is exactly the argument
 * this tool is here to refuse.
 *
 * It does NOT filter by distance. A tree at 200 units with a 3-px canopy is a
 * real part of what the frame looks like, and dropping it because it is small
 * would be choosing the sample to fit the answer. Distance is reported instead.
 */
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}
const VP = String(arg('vp', '390x844')).split('x').map(Number);
const SKIPS = String(arg('skip', '10,25,45,60,90,110,150,178,185,200,225')).split(',');
const FRAMES = parseInt(arg('frames', 3), 10);
const FILE = path.resolve(String(arg('file', path.join(ROOT, 'index.html'))));
const FLOOR = 12;

function pageRun(o) {
  const g = MR.game, THREE = window.THREE;
  const live = g.cam.camera;
  live.updateMatrixWorld(true);
  const cam = live.clone();
  cam.position.copy(live.position); cam.quaternion.copy(live.quaternion);
  cam.fov = live.fov; cam.aspect = live.aspect; cam.near = live.near; cam.far = live.far;
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);

  const trees = [];
  g.scene.traverse(function (n) {
    if (n.visible && n.userData && n.userData.treeAudit) trees.push(n);
  });
  if (!trees.length) return { error: 'no tree instances tagged userData.treeAudit' };

  const W = o.w, H = o.h;
  const rt = new THREE.WebGLRenderTarget(W, H);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  rt.texture.generateMipmaps = false;
  const buf = new Uint8Array(W * H * 4);
  const prevRT = g.renderer.getRenderTarget();

  const rows = [];
  for (const t of trees) {
    const mesh = t.userData.treeAudit;          // the shaded body, not the ink
    const src = mesh.geometry.attributes.color;
    if (!src) continue;
    // Trunk hex vs canopy hex, straight off the authored vertex colours.
    const key = new Float32Array(src.count * 3);
    const c = new THREE.Color();
    let trunkVerts = 0;
    for (let i = 0; i < src.count; i++) {
      c.setRGB(src.getX(i), src.getY(i), src.getZ(i));
      const hex = c.getHex(THREE.SRGBColorSpace);
      const isTrunk = o.trunks.indexOf(hex) >= 0;
      if (isTrunk) trunkVerts++;
      key[i * 3] = isTrunk ? 1 : 0;
      key[i * 3 + 1] = isTrunk ? 0 : 1;
      key[i * 3 + 2] = isTrunk ? 1 : 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', mesh.geometry.attributes.position);
    geo.setAttribute('normal', mesh.geometry.attributes.normal);
    geo.setAttribute('color', new THREE.BufferAttribute(key, 3));
    if (mesh.geometry.index) geo.setIndex(mesh.geometry.index);
    const oldGeo = mesh.geometry, oldMat = mesh.material;
    mesh.geometry = geo;
    mesh.material = new THREE.MeshBasicMaterial({
      vertexColors: true, fog: false, toneMapped: false,
    });

    g.renderer.setRenderTarget(rt);
    g.renderer.render(g.scene, cam);
    g.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    g.renderer.setRenderTarget(prevRT);

    mesh.geometry = oldGeo;
    mesh.material.dispose();
    mesh.material = oldMat;
    geo.dispose();

    let trunk = 0, cnp = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const R = buf[i], G = buf[i + 1], B = buf[i + 2];
      if (R > 200 && G < 60 && B > 200) trunk++;
      else if (G > 200 && R < 60 && B < 60) cnp++;
    }
    if (trunk + cnp === 0) continue;
    t.updateMatrixWorld(true);
    const wp = new THREE.Vector3().setFromMatrixPosition(t.matrixWorld);
    rows.push({
      z: +(wp.z - g.pace.units).toFixed(1), x: +wp.x.toFixed(1),
      scale: +t.scale.x.toFixed(2),
      trunk, canopy: cnp, trunkVerts,
    });
  }
  rt.dispose();
  return { rows };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.split('\n')[0]));

  console.log('');
  console.log('CANOPY -- trunk against crown, per tree, in the frame that ships');
  console.log('  viewport ' + VP[0] + 'x' + VP[1] + ', floor ' + FLOOR + ' px');
  console.log('');
  console.log('  skip   trees  POSTS (trunk only)   THIN (<25% crown)   TREE   worst post');

  let P = 0, T = 0, OK = 0, N = 0;
  const posts = [];
  for (const skip of SKIPS) {
    await page.goto('file://' + FILE + '?bot=1&nocount=1&skip=' + skip, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const buf = await page.evaluate(() => [MR.game.renderer.domElement.width, MR.game.renderer.domElement.height]);
    for (let f = 0; f < FRAMES; f++) {
      if (f) await page.waitForTimeout(340);
      const r = await page.evaluate(pageRun, {
        w: buf[0], h: buf[1],
        // Every trunk hex vTree can write, transcribed from the SETTINGS table
        // and from vTree's own default. A hex missing here would be counted as
        // canopy and would flatter the result, so the tool prints the tally of
        // trunk vertices it matched and a zero there is a finding.
        trunks: [0xb0662e, 0x9a9a86, 0xa8a894, 0xa07a52, 0x8f6a3a, 0xc0a070],
      });
      if (r.error) { console.log('  ' + skip + '  ' + r.error); continue; }
      let p = 0, t = 0, ok = 0, wp = null;
      for (const row of r.rows) {
        N++;
        const vis = row.trunk + row.canopy;
        if (row.trunk > FLOOR && row.canopy <= FLOOR) {
          p++; P++;
          if (!wp || row.trunk > wp.trunk) wp = row;
          posts.push(Object.assign({ skip, f }, row));
        } else if (row.canopy / Math.max(1, vis) < 0.25) { t++; T++; } else { ok++; OK++; }
      }
      console.log('  ' + String(skip).padEnd(6) + String(r.rows.length).padStart(6)
        + String(p).padStart(20) + String(t).padStart(20) + String(ok).padStart(7)
        + (wp ? '   ' + wp.trunk + 'px at ' + wp.z + 'u, x ' + wp.x : ''));
    }
  }
  console.log('');
  console.log('  ' + N + ' tree appearances: ' + P + ' POSTS, ' + T + ' THIN, ' + OK + ' TREE');
  if (posts.length) {
    posts.sort(function (a, b) { return b.trunk - a.trunk; });
    console.log('  biggest posts (trunk px, distance, lateral x, scale):');
    for (const q of posts.slice(0, 8)) {
      console.log('    ' + String(q.trunk).padStart(5) + ' px   ' + String(q.z).padStart(7)
        + 'u   x ' + String(q.x).padStart(6) + '   s' + q.scale + '   skip ' + q.skip);
    }
  }
  for (const e of errs) console.log('  ! ' + e);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})();
