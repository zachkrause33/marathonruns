#!/usr/bin/env node
/**
 * Builds progress.html from status.json + the latest screenshots.
 *
 * Screenshots are inlined as data URIs so the page can be published as a
 * standalone artifact and still show the real build. Verified numbers are
 * pulled from the actual test tools rather than typed in, so this page cannot
 * drift into claiming something the code does not do.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const status = JSON.parse(fs.readFileSync(path.join(ROOT, 'status.json'), 'utf8'));

function tool(file, args) {
  try {
    return execFileSync('node', [path.join(ROOT, 'tools', file)].concat(args || []),
      { encoding: 'utf8', cwd: ROOT, timeout: 120000 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') || 'tool failed';
  }
}

const simOut = tool('simulate.js');
const courseOut = tool('course-test.js', ['30']);

function shots() {
  const dir = path.join(ROOT, 'shots');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => {
      const b = fs.readFileSync(path.join(dir, f));
      return { name: f.replace(/\.png$/, ''), uri: 'data:image/png;base64,' + b.toString('base64'), kb: Math.round(b.length / 1024) };
    });
}

const STATE_COLOR = {
  done: '#3fbf63', building: '#ffb020', review: '#37d6ff',
  blocked: '#ff3b6b', queued: '#7b83b8',
};

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const pieceRows = status.pieces.map((p) => `
  <tr>
    <td class="pn">${esc(p.name)}</td>
    <td><span class="pill" style="--c:${STATE_COLOR[p.state] || '#7b83b8'}">${esc(p.state)}</span></td>
    <td class="num">${p.wave}</td>
    <td class="verdict">${esc(p.verdict || '—')}</td>
    <td class="gap">${esc(p.gap || '—')}</td>
  </tr>`).join('');

const shotCards = shots().map((s) => `
  <figure>
    <img src="${s.uri}" alt="${esc(s.name)}" loading="lazy">
    <figcaption>${esc(s.name)} <span class="dim">${s.kb} KB</span></figcaption>
  </figure>`).join('');

const html = `<title>Daily Marathon — build progress</title>
<style>
  :root { color-scheme: light dark; --bg:#0e1230; --fg:#fffdf5; --dim:#9aa3d0;
          --card:#171c42; --line:#2a3160; --accent:#ffe45e; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f4f5fb; --fg:#141838; --dim:#5d6590; --card:#fff; --line:#dde0ef; --accent:#c79a00; }
  }
  :root[data-theme="dark"] { --bg:#0e1230; --fg:#fffdf5; --dim:#9aa3d0; --card:#171c42; --line:#2a3160; --accent:#ffe45e; }
  :root[data-theme="light"] { --bg:#f4f5fb; --fg:#141838; --dim:#5d6590; --card:#fff; --line:#dde0ef; --accent:#c79a00; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 20px 60px; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: clamp(24px,4vw,36px); margin:0 0 4px; letter-spacing:-0.02em; }
  .sub { color:var(--dim); margin-bottom:22px; font-size:13px; }
  .banner { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--accent);
            padding:14px 18px; margin-bottom:24px; }
  .banner b { color:var(--accent); }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.12em; color:var(--dim);
       margin:32px 0 10px; font-weight:800; }
  table { width:100%; border-collapse:collapse; background:var(--card);
          border:1px solid var(--line); font-size:13.5px; }
  th,td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:10px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
  tr:last-child td { border-bottom:none; }
  .pn { font-weight:700; white-space:nowrap; }
  .num { font-variant-numeric:tabular-nums; text-align:center; width:52px; }
  .pill { display:inline-block; padding:2px 9px; font-size:11px; font-weight:800;
          text-transform:uppercase; letter-spacing:.06em; background:var(--c); color:#0e1230; }
  .verdict { color:var(--dim); }
  .gap { font-size:12.5px; }
  pre { background:var(--card); border:1px solid var(--line); padding:14px 16px;
        overflow-x:auto; font-size:12px; line-height:1.5; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
  figure { margin:0; background:var(--card); border:1px solid var(--line); }
  figure img { width:100%; display:block; }
  figcaption { padding:7px 10px; font-size:12px; font-weight:700; }
  .dim { color:var(--dim); font-weight:400; }
  .foot { margin-top:36px; color:var(--dim); font-size:12px; border-top:1px solid var(--line); padding-top:14px; }
  code { background:var(--card); padding:1px 5px; border:1px solid var(--line); font-size:12.5px; }
</style>
<div class="wrap">
  <h1>Daily Marathon — build progress</h1>
  <div class="sub">${esc(status.updated)} · wave ${status.wave} · <code>${esc(status.branch)}</code></div>

  <div class="banner">${status.headline}</div>

  <h2>Pieces</h2>
  <table>
    <tr><th>Piece</th><th>State</th><th>Wave</th><th>Last critic verdict</th><th>Biggest remaining gap</th></tr>
    ${pieceRows}
  </table>

  <h2>Verified — pace &amp; record math</h2>
  <pre>${esc(simOut.trim())}</pre>

  <h2>Verified — course generation</h2>
  <pre>${esc(courseOut.trim())}</pre>

  <h2>Latest frames from the built game</h2>
  <div class="grid">${shotCards || '<p class="dim">No screenshots captured yet.</p>'}</div>

  <div class="foot">
    Screenshots are captured from the built <code>index.html</code> in Chromium by
    <code>tools/shoot.js</code>, driven by the in-game autopilot. The numbers above are
    printed by <code>tools/simulate.js</code> and <code>tools/course-test.js</code> at the
    moment this page was generated, not copied in by hand.
  </div>
</div>`;

fs.writeFileSync(path.join(ROOT, 'progress.html'), html);
console.log(`wrote progress.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, ${shots().length} shots)`);
