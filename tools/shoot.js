#!/usr/bin/env node
/**
 * Screenshot + instrumentation harness.
 *
 * This is the eyes of the review loop. It drives the real built index.html in
 * Chromium, so anything it captures or reports is true of the shipped file --
 * never of a mock or a builder's description of their own work.
 *
 *   node tools/shoot.js                       default set
 *   node tools/shoot.js --skip 60 --out x.png one frame deep into the race
 *   node tools/shoot.js --probe               console errors + perf + state
 *
 * Exit code is non-zero if the page threw, so a broken build cannot pass
 * review by producing a plausible-looking image.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : def;
}

// `--dir` keeps parallel agents from overwriting each other's frames.
const OUT = path.resolve(String(arg('dir', path.join(ROOT, 'shots'))));
fs.mkdirSync(OUT, { recursive: true });

const W = parseInt(arg('w', 1280), 10);
const H = parseInt(arg('h', 800), 10);
const PROBE = !!arg('probe', false);

// The default sweep: the start line, three points across the race where the
// biome and difficulty differ, and the finish.
const DEFAULT_SHOTS = [
  { name: '01-start', q: 'bot=1&nocount=1', settle: 900 },
  { name: '02-early', q: 'bot=1&skip=25', settle: 700 },
  { name: '03-mid', q: 'bot=1&skip=110', settle: 700 },
  { name: '04-wall', q: 'bot=1&skip=185', settle: 700 },
  { name: '05-final', q: 'bot=1&skip=225', settle: 700 },
  { name: '06-mobile', q: 'bot=1&skip=90', settle: 700, w: 420, h: 860 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.MR_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });

  const single = arg('out', null);
  const shots = single
    ? [{ name: String(single).replace(/\.png$/, ''), q: arg('q', `bot=1&skip=${arg('skip', 30)}`), settle: parseInt(arg('settle', 800), 10) }]
    : DEFAULT_SHOTS;

  let failed = false;
  const report = [];

  for (const sh of shots) {
    const ctx = await browser.newContext({
      viewport: { width: sh.w || W, height: sh.h || H },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();

    // Warnings count as failures, with two known-benign exceptions. The
    // collision audit reports through console.warn, and for a long stretch it
    // was failing unnoticed because ad-hoc check scripts only collected
    // console.error -- the game was waving players through obstacles they were
    // visibly clipping and nothing said so. Anything unexpected fails the run.
    const BENIGN = /deprecated with r150|AudioContext was not allowed/;
    const errors = [];
    page.on('console', (m) => {
      const t = m.text();
      if ((m.type() === 'error' || m.type() === 'warning') && !BENIGN.test(t)) {
        errors.push(`${m.type()}: ${t}`);
      }
    });
    page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); failed = true; });

    // `--file` points at an alternate build so parallel agents can review
    // their own output without touching the shared index.html.
    const target = arg('file', null);
    const html = target ? path.resolve(String(target)) : path.join(ROOT, 'index.html');
    const url = 'file://' + html + '?' + sh.q + '&debug=1';
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready, { timeout: 15000 })
      .catch(() => { errors.push('MR.game never became ready'); failed = true; });
    await page.waitForTimeout(sh.settle);

    const stat = await page.evaluate(() => {
      if (!window.MR || !MR.game) return null;
      const g = MR.game, p = g.pace;
      return {
        state: g.state,
        fps: Math.round(g.fps()),
        draws: g.renderer.info.render.calls,
        tris: g.renderer.info.render.triangles,
        miles: +p.miles.toFixed(3),
        raceTime: Math.round(p.raceTime),
        pace: +p.pace.toFixed(1),
        streak: p.streak,
        hits: p.hits,
        lane: g.player.lane,
        courseValid: g.course.valid.ok,
        gates: g.course.gates.length,
      };
    });

    const file = path.join(OUT, sh.name + '.png');
    await page.screenshot({ path: file });
    report.push({ shot: sh.name, file, stat, errors });

    if (errors.length) failed = true;
    await ctx.close();
  }

  await browser.close();

  for (const r of report) {
    console.log(`\n=== ${r.shot} ===`);
    if (r.stat) {
      const s = r.stat;
      console.log(`  fps ${s.fps}  draws ${s.draws}  tris ${s.tris}`);
      console.log(`  mile ${s.miles}  clock ${s.raceTime}s  pace ${s.pace}s/mi  streak ${s.streak}  hits ${s.hits}`);
      console.log(`  course ${s.gates} gates, valid=${s.courseValid}`);
    } else {
      console.log('  NO STATE -- page did not initialise');
    }
    for (const e of r.errors.slice(0, 8)) console.log('  ! ' + e);
  }

  console.log('\n' + (failed ? 'FAIL: page errors or missing state' : 'OK: all shots clean'));
  process.exit(failed ? 1 : 0);
})();
