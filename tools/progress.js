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

// Counts drive the summary strip, so it can never disagree with the table.
const tally = status.pieces.reduce((a, p) => { a[p.state] = (a[p.state] || 0) + 1; return a; }, {});
const stat = (n, label, color) => `
  <div class="stat"${color ? ` style="--sc:${color}"` : ''}>
    <div class="sv">${n}</div><div class="sl">${label}</div>
  </div>`;

const html = `<title>Daily Marathon — build progress</title>
<style>
  /* Palette is lifted from the game's own broadcast HUD -- deep race-night
   * navy, warning-tape yellow, and the same ahead/behind green and red the
   * race clock uses -- so this page reads as part of the same object. */
  :root {
    color-scheme: light dark;
    --bg:#0b0e26; --fg:#fffdf5; --dim:#8f98c8; --card:#151a3d;
    --line:#272e5c; --accent:#ffe45e; --ok:#4dfba0; --warn:#ffb020; --bad:#ff6b84;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f3f4fa; --fg:#12163a; --dim:#5a6291; --card:#fff;
            --line:#dcdff0; --accent:#9c7700; --ok:#0f8d54; --warn:#a35f00; --bad:#c0304c; }
  }
  :root[data-theme="dark"] { --bg:#0b0e26; --fg:#fffdf5; --dim:#8f98c8; --card:#151a3d;
    --line:#272e5c; --accent:#ffe45e; --ok:#4dfba0; --warn:#ffb020; --bad:#ff6b84; }
  :root[data-theme="light"] { --bg:#f3f4fa; --fg:#12163a; --dim:#5a6291; --card:#fff;
    --line:#dcdff0; --accent:#9c7700; --ok:#0f8d54; --warn:#a35f00; --bad:#c0304c; }

  * { box-sizing: border-box; }
  body { margin:0; padding:32px 20px 64px; background:var(--bg); color:var(--fg);
         font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .wrap { max-width:1080px; margin:0 auto; display:flex; flex-direction:column; gap:0; }
  .eyebrow { font-size:10px; font-weight:800; letter-spacing:.22em; color:var(--accent);
             text-transform:uppercase; }
  h1 { font-size:clamp(26px,4.4vw,40px); margin:6px 0 4px; letter-spacing:-0.025em;
       text-wrap:balance; line-height:1.02; }
  .sub { color:var(--dim); font-size:13px; font-variant-numeric:tabular-nums; }

  .banner { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--accent);
            padding:15px 18px; margin-top:22px; max-width:72ch; line-height:1.6; }
  .banner b { color:var(--accent); }

  .stats { display:flex; flex-wrap:wrap; gap:10px; margin-top:18px; }
  .stat { background:var(--card); border:1px solid var(--line); border-top:3px solid var(--sc,var(--dim));
          padding:10px 18px 11px; min-width:96px; }
  .sv { font-size:26px; font-weight:800; font-variant-numeric:tabular-nums; line-height:1; }
  .sl { font-size:9.5px; font-weight:800; letter-spacing:.14em; text-transform:uppercase;
        color:var(--dim); margin-top:5px; }

  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.16em; color:var(--dim);
       margin:38px 0 11px; font-weight:800; }
  .tw { overflow-x:auto; border:1px solid var(--line); }
  table { width:100%; border-collapse:collapse; background:var(--card); font-size:13.5px;
          min-width:640px; }
  th,td { text-align:left; padding:10px 13px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:9.5px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); font-weight:800; }
  tr:last-child td { border-bottom:none; }
  .pn { font-weight:700; white-space:nowrap; }
  .num { font-variant-numeric:tabular-nums; text-align:center; width:52px; color:var(--dim); }
  .pill { display:inline-block; padding:2.5px 9px; font-size:10px; font-weight:800;
          text-transform:uppercase; letter-spacing:.07em; background:var(--c); color:#0b0e26;
          white-space:nowrap; }
  .verdict { color:var(--dim); }
  .gap { font-size:12.5px; }

  pre { background:var(--card); border:1px solid var(--line); padding:15px 17px;
        overflow-x:auto; font-size:12px; line-height:1.5; margin:0;
        font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:14px; }
  figure { margin:0; background:var(--card); border:1px solid var(--line); }
  figure img { width:100%; display:block; }
  figcaption { padding:8px 11px; font-size:12px; font-weight:700; display:flex;
               justify-content:space-between; gap:10px; }
  .dim { color:var(--dim); font-weight:400; font-variant-numeric:tabular-nums; }
  .foot { margin-top:40px; color:var(--dim); font-size:12px; border-top:1px solid var(--line);
          padding-top:15px; max-width:72ch; line-height:1.6; }
  code { background:var(--card); padding:1.5px 5px; border:1px solid var(--line); font-size:12.5px;
         font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
</style>
<div class="wrap">
  <div class="eyebrow">Build progress</div>
  <h1>Daily Marathon</h1>
  <div class="sub">${esc(status.updated)} · wave ${status.wave} · <code>${esc(status.branch)}</code></div>

  <div class="banner">${status.headline}</div>

  <div class="stats">
    ${stat(tally.done || 0, 'verified', 'var(--ok)')}
    ${stat(tally.building || 0, 'in build', 'var(--warn)')}
    ${stat(tally.review || 0, 'in review', '#37d6ff')}
    ${stat(tally.queued || 0, 'queued', 'var(--dim)')}
    ${stat(status.pieces.length, 'pieces total', 'var(--accent)')}
  </div>

  <h2>Pieces</h2>
  <div class="tw"><table>
    <tr><th>Piece</th><th>State</th><th>Wave</th><th>Last verdict</th><th>Biggest remaining gap</th></tr>
    ${pieceRows}
  </table></div>

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
