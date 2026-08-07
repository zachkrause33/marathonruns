/**
 * "Soft, flat, low-detail" as numbers, ours against the references.
 *
 * Four measures, each chosen because it maps onto one of the owner's words:
 *
 *   RANGE     p99/p1 luminance. "Flat" is a narrow range: a picture whose
 *             darkest and brightest pixels are close together cannot separate
 *             objects by value, which is how the references do it.
 *   EDGE      mean Sobel magnitude, and the share of pixels over a threshold.
 *             "Soft" and "blurry" are few strong edges. This is the closest
 *             thing to an objective sharpness figure on a still.
 *   FAR/NEAR  the same two measures computed on the top third of the frame
 *             against the bottom third. "Mush in the distance" is a far third
 *             whose range and edge density collapse relative to the near.
 *   SAT       mean HSV saturation. "Washed out" is low saturation, and fog
 *             does exactly that: it lerps every colour toward one flat blue.
 *
 * The character is excluded from nothing -- these are whole-frame figures, and
 * the references have their own HUDs, so treat differences under ~10% as noise
 * and look at the direction of the big ones.
 */
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = process.argv.slice(2);
if (!SHOTS.length) {
  console.error('usage: node tools/clarity.js <png> [png ...]\n' +
    '  compare ours against reference/: node tools/clarity.js shots/*.png reference/ss-*.png');
  process.exit(1);
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  const p = await b.newPage({ viewport: { width: 400, height: 400 } });
  // A file:// origin, so the canvas may read file:// images back.
  await p.goto('file:///home/user/marathonruns/reference/MEASUREMENTS.md');
  console.log('file                              range  edge%  satur   FAR sat  NEAR sat  far/near');
  for (const f of SHOTS) {
    const r = await p.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src; });
      const W = 520, H = Math.round(img.height * (520 / img.width));
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H).data;

      const lum = new Float32Array(W * H);
      let sat = 0;
      for (let i = 0; i < W * H; i++) {
        const R = d[i * 4] / 255, G = d[i * 4 + 1] / 255, B = d[i * 4 + 2] / 255;
        lum[i] = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        sat += mx > 0 ? (mx - mn) / mx : 0;
      }
      // Sobel.
      const edge = new Float32Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const gx = -lum[i - W - 1] - 2 * lum[i - 1] - lum[i + W - 1]
                     + lum[i - W + 1] + 2 * lum[i + 1] + lum[i + W + 1];
          const gy = -lum[i - W - 1] - 2 * lum[i - W] - lum[i - W + 1]
                     + lum[i + W - 1] + 2 * lum[i + W] + lum[i + W + 1];
          edge[i] = Math.hypot(gx, gy);
        }
      }
      const band = (y0, y1) => {
        const L = [], E = []; let S = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
          const i = y * W + x;
          L.push(lum[i]); E.push(edge[i]);
          const R = d[i * 4] / 255, G = d[i * 4 + 1] / 255, B = d[i * 4 + 2] / 255;
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          S += mx > 0 ? (mx - mn) / mx : 0; n++;
        }
        L.sort((a, c2) => a - c2);
        const q = (a, f) => a[Math.floor(a.length * f)];
        const strong = E.filter((v) => v > 0.35).length / E.length * 100;
        return { range: q(L, 0.99) / Math.max(0.02, q(L, 0.01)), edge: strong, sat: S / n };
      };
      return {
        all: band(0, H),
        far: band(0, Math.floor(H / 3)),
        near: band(Math.floor(H * 2 / 3), H),
        sat: sat / (W * H),
      };
    }, 'file://' + path.resolve(f));
    const n = path.basename(f).replace('.png', '').replace('.PNG', '');
    console.log(
      `${n.padEnd(30)} ${r.all.range.toFixed(1).padStart(5)}  ${r.all.edge.toFixed(1).padStart(5)}  ` +
      `${r.sat.toFixed(3)}   ${r.far.sat.toFixed(3)}    ${r.near.sat.toFixed(3)}    ` +
      `${(r.far.sat / r.near.sat).toFixed(2)}`);
  }
  await b.close();
})();
