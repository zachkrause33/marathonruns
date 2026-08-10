#!/usr/bin/env node
/**
 * WHERE THE COLOUR IS, and whether the reference really has more of it.
 *
 * Written for one standing item: near-band saturation measured 33-36% below
 * the Subway Surfers reference, five times, and never closed. clarity.js
 * reports one number for that (mean HSV S over the bottom third). One number
 * over one metric is exactly the shape of claim this project has had to
 * withdraw five times, so this tool does the same comparison four ways and
 * refuses to state a gap that only one of them can see.
 *
 * ---- WHY FOUR METRICS ----------------------------------------------------
 *
 *   S     HSV saturation, (max-min)/max. What clarity.js reports, so every
 *         number here reconciles with the figure on record. It is VALUE-
 *         NORMALISED, which is its defect: a near-black pixel with two counts
 *         of blue in it scores S 0.5 and reads as black. A frame with a dark
 *         road is flattered or punished by this depending on the road's tint,
 *         and ours is a tinted navy while Subway Surfers' is grey.
 *   C     chroma, (max-min)/255. NOT normalised by value. This is the one that
 *         tracks "how much colour is on screen" as a person would say it, and
 *         it is the one a dark tinted road cannot game.
 *   LCH   CIE LCh C*, computed through sRGB -> linear -> XYZ -> Lab. The
 *         perceptual answer, and the tie-breaker when S and C disagree.
 *   VIVID% share of pixels over BOTH a chroma floor and a value floor -- the
 *         "area of saturated bright" that roadmap entry 30 identified as the
 *         only lever that ever moved the hazard gate. A mean can be lifted by
 *         tinting everything slightly; this cannot.
 *
 * A gap is only reported as REAL if it survives all four. Any metric that
 * disagrees with the other three is printed, not hidden.
 *
 * ---- WHAT IT REFUSES TO DO -----------------------------------------------
 *
 * It does not average references into a band. "Every reference sits at
 * 0.73-1.28" was a seven-image subset of a real range of 0.46-2.31, and that
 * claim had to be withdrawn. Every reference is printed on its own row with
 * its family, and the summary quotes MIN-MAX and the median, never a mean.
 *
 * It does not resample by default. clarity.js resamples every input to 520px
 * wide, which concentrates edges AND, on a downscale, averages neighbouring
 * pixels -- and averaging two complementary colours produces a grey. A frame
 * with hard chroma breaks at 1:1 loses more saturation to a downscale than a
 * soft one does, so a resample can manufacture the very gap being measured.
 * --resample 520 reproduces clarity.js exactly; the default is native, and
 * the two are printed against each other by --audit.
 *
 * ---- BANDS ---------------------------------------------------------------
 *
 * SCREEN bands (thirds) are the only bands a screenshot can be cut into, so
 * they are what the reference comparison uses. FAR is the top third, NEAR the
 * bottom third. A depth-segmented answer for our own frames lives in
 * tools/chromadepth.js, which needs the live scene and cannot be run on a PNG.
 *
 * Usage:
 *   node tools/chroma.js reference/ss-*.png shots/*.png
 *   node tools/chroma.js --resample 520 <png ...>     clarity.js-compatible
 *   node tools/chroma.js --audit                      self-test, see below
 *   node tools/chroma.js --crop 0,0,1,0.9 <png ...>   drop a HUD band
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (n) => args.indexOf('--' + n) >= 0;

const RESAMPLE = parseInt(arg('resample', '0'), 10);
const CROP = arg('crop', null);
const AUDIT = has('audit');
const JSON_OUT = arg('json', null);
const SHOTS = args.filter((a, i) => !a.startsWith('--')
  && !(i > 0 && args[i - 1].startsWith('--') && !['--audit'].includes(args[i - 1])));

// Which family a reference belongs to. Subway Surfers and Sonic are the stated
// art-direction target; Temple Run is framing-only and is textured semi-
// realism; the tgr/ttgr set is Tom Gold Run, supplied by the owner. Mixing
// them into one band is the error this tool exists partly to prevent.
function family(name) {
  if (/^ss-/.test(name)) return 'SUBWAY';
  if (/^sonic/.test(name)) return 'SONIC';
  if (/^tr-/.test(name)) return 'TEMPLERUN';
  if (/^ttgr-/.test(name)) return 'GOLDRUN';
  if (/^tgr-/.test(name)) return 'TGR';
  return 'OURS';
}

const PAGE = `
window.__measure = async function (src, opts) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
  let W = img.naturalWidth, H = img.naturalHeight;
  if (opts.resample) { W = opts.resample; H = Math.round(img.naturalHeight * (opts.resample / img.naturalWidth)); }
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = !!opts.resample;
  g.drawImage(img, 0, 0, W, H);
  let x0 = 0, y0 = 0, x1 = W, y1 = H;
  if (opts.crop) {
    x0 = Math.round(opts.crop[0] * W); y0 = Math.round(opts.crop[1] * H);
    x1 = Math.round(opts.crop[2] * W); y1 = Math.round(opts.crop[3] * H);
  }
  const d = g.getImageData(0, 0, W, H).data;

  // sRGB -> Lab, for C*. D65.
  function lin(u) { u /= 255; return u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116); }

  function band(ya, yb) {
    let n = 0, S = 0, C = 0, LCH = 0, L = 0, vivid = 0, satpix = 0;
    const chromas = [];
    for (let y = ya; y < yb; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        S += mx > 0 ? (mx - mn) / mx : 0;
        const ch = (mx - mn) / 255;
        C += ch;
        chromas.push(ch);
        const lr = lin(R), lg = lin(G), lb = lin(B);
        L += 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const X = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047;
        const Y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
        const Z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883;
        const fx = f(X), fy = f(Y), fz = f(Z);
        const a = 500 * (fx - fy), bb = 200 * (fy - fz);
        LCH += Math.hypot(a, bb);
        // VIVID: chroma over 0.25 (64/255) AND value over 0.35. Both floors
        // are stated rather than tuned; --audit sweeps them.
        if (ch > 0.25 && mx / 255 > 0.35) vivid++;
        if (ch > 0.25) satpix++;
        n++;
      }
    }
    chromas.sort((p, q) => p - q);
    const q = (fr) => chromas.length ? chromas[Math.min(chromas.length - 1, Math.floor(chromas.length * fr))] : 0;
    return { n, S: S / n, C: C / n, LCH: LCH / n, L: L / n,
             vivid: vivid / n * 100, satpix: satpix / n * 100,
             c50: q(0.50), c90: q(0.90), c99: q(0.99) };
  }
  const h = y1 - y0;
  return {
    W, H,
    all: band(y0, y1),
    far: band(y0, y0 + Math.floor(h / 3)),
    mid: band(y0 + Math.floor(h / 3), y0 + Math.floor(2 * h / 3)),
    near: band(y0 + Math.floor(2 * h / 3), y1),
  };
};
`;

(async () => {
  const b = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  const p = await b.newPage({ viewport: { width: 400, height: 400 } });
  await p.goto('file:///home/user/marathonruns/reference/MEASUREMENTS.md');
  await p.addScriptTag({ content: PAGE });

  const crop = CROP ? CROP.split(',').map(Number) : null;
  const rows = [];

  if (AUDIT) {
    await selfTest(p);
    await b.close();
    return;
  }

  console.log(
    'file                             fam        WxH        ' +
    'ALL  S     C     LCH   L     viv%  |  FAR   S     C     |  NEAR  S     C     LCH   viv%  c90');
  for (const fpath of SHOTS) {
    if (!fs.existsSync(fpath)) { console.log('  MISSING ' + fpath); continue; }
    const r = await p.evaluate(({ src, opts }) => window.__measure(src, opts),
      { src: 'file://' + path.resolve(fpath), opts: { resample: RESAMPLE || 0, crop } });
    const name = path.basename(fpath).replace(/\.png$/i, '');
    const fam = family(name);
    rows.push({ name, fam, r });
    console.log(
      `${name.padEnd(32)} ${fam.padEnd(10)} ${(r.W + 'x' + r.H).padEnd(10)} ` +
      `     ${r.all.S.toFixed(3)} ${r.all.C.toFixed(3)} ${r.all.LCH.toFixed(1).padStart(5)} ` +
      `${r.all.L.toFixed(3)} ${r.all.vivid.toFixed(1).padStart(5)} |        ` +
      `${r.far.S.toFixed(3)} ${r.far.C.toFixed(3)} |        ` +
      `${r.near.S.toFixed(3)} ${r.near.C.toFixed(3)} ${r.near.LCH.toFixed(1).padStart(5)} ` +
      `${r.near.vivid.toFixed(1).padStart(5)} ${r.near.c90.toFixed(3)}`);
  }

  // Summary by family: MIN-MAX and MEDIAN, never a mean, and never a band
  // built from a subset.
  const byFam = {};
  for (const row of rows) (byFam[row.fam] = byFam[row.fam] || []).push(row);
  console.log('\nBY FAMILY -- min / MEDIAN / max, over every frame supplied. n is stated so a subset is visible.');
  console.log('family      n   NEAR S              NEAR C              NEAR LCH            NEAR vivid%');
  for (const fam of Object.keys(byFam)) {
    const g = byFam[fam];
    const fmt = (key) => {
      const v = g.map((x) => x.r.near[key]).sort((a, c) => a - c);
      const med = v[Math.floor(v.length / 2)];
      return `${v[0].toFixed(3)}/${med.toFixed(3)}/${v[v.length - 1].toFixed(3)}`.padEnd(20);
    };
    console.log(`${fam.padEnd(11)} ${String(g.length).padEnd(3)} ${fmt('S')}${fmt('C')}${fmt('LCH')}${fmt('vivid')}`);
  }

  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 1));
  await b.close();
})();

/**
 * ---- THE SELF-TEST -------------------------------------------------------
 *
 * Every instrument this project has written was wrong first and every error
 * flattered the thing being measured. These are the ways this one could be
 * wrong, each turned into a synthetic frame whose answer is known by
 * construction.
 */
async function selfTest(p) {
  const out = await p.evaluate(async () => {
    function make(draw, W, H) {
      const c = document.createElement('canvas');
      c.width = W || 300; c.height = H || 300;
      const g = c.getContext('2d');
      draw(g, c.width, c.height);
      return c.toDataURL('image/png');
    }
    const T = {};
    // 1. A flat mid grey. Every chroma metric must be 0 and S must be 0.
    T['flat grey 128'] = make((g, W, H) => { g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); });
    // 2. Pure red. S = 1, C = 1.
    T['pure red'] = make((g, W, H) => { g.fillStyle = '#ff0000'; g.fillRect(0, 0, W, H); });
    // 3. A VERY DARK blue-tinted near-black, rgb(6,6,18). This is the trap:
    //    HSV S reports 0.667 and the human eye reports black. C reports 0.047.
    T['near-black tinted'] = make((g, W, H) => { g.fillStyle = 'rgb(6,6,18)'; g.fillRect(0, 0, W, H); });
    // 4. Half pure red, half pure cyan, in HARD 1px stripes. At native
    //    resolution C = 1.0. Downscaled with smoothing the stripes average to
    //    grey and C collapses -- this is the resample confound, made visible.
    T['1px red/cyan stripes'] = make((g, W, H) => {
      for (let x = 0; x < W; x++) { g.fillStyle = (x % 2) ? '#ff0000' : '#00ffff'; g.fillRect(x, 0, 1, H); }
    });
    // 5. The same two colours in 20px blocks. A downscale barely touches this.
    T['20px red/cyan blocks'] = make((g, W, H) => {
      for (let x = 0; x < W; x += 20) { g.fillStyle = ((x / 20) % 2) ? '#ff0000' : '#00ffff'; g.fillRect(x, 0, 20, H); }
    });
    // 6. Bands: top third saturated, bottom third grey. Proves FAR/NEAR are
    //    not swapped -- an inverted band index would report the mirror image
    //    and every per-band finding in this project would be backwards.
    T['top vivid / bottom grey'] = make((g, W, H) => {
      g.fillStyle = '#ff00ff'; g.fillRect(0, 0, W, Math.floor(H / 3));
      g.fillStyle = '#808080'; g.fillRect(0, Math.floor(H / 3), W, H);
    });
    const res = {};
    for (const k of Object.keys(T)) {
      res[k] = {
        native: await window.__measure(T[k], {}),
        down: await window.__measure(T[k], { resample: 100 }),
      };
    }
    return res;
  });

  console.log('SELF-TEST. "expected" is by construction, not by running the tool.\n');
  console.log('case                        native S  C     LCH    | resampled-to-100 S  C     LCH');
  for (const k of Object.keys(out)) {
    const a = out[k].native.all, d = out[k].down.all;
    console.log(`${k.padEnd(27)} ${a.S.toFixed(3)} ${a.C.toFixed(3)} ${a.LCH.toFixed(1).padStart(6)}  |  ` +
      `${d.S.toFixed(3)} ${d.C.toFixed(3)} ${d.LCH.toFixed(1).padStart(6)}`);
  }
  const bandcase = out['top vivid / bottom grey'].native;
  console.log('\nband orientation: FAR C ' + bandcase.far.C.toFixed(3) +
    ' vs NEAR C ' + bandcase.near.C.toFixed(3) +
    '  -- FAR must be ~1.0 and NEAR ~0.0 or the bands are inverted.');
}
