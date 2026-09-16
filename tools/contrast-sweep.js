#!/usr/bin/env node
/**
 * CONTRAST, SWEPT ACROSS EVERY CITY -- the audit the calendar kept running
 * for us, moved ahead of the calendar.
 *
 * Twice now a hazard coat has failed "on a timer": it cleared the gate on
 * the day it was tuned and failed six days later with no code change,
 * because the rotating city dealt a road palette the coat had never been
 * measured against (dumpster, 0.003 S margin; crateload, 0.005 -- see
 * docs/roadmap.md). The road palette is PER CITY, not per date, so the
 * whole exposure is enumerable: every city x every hazard variant x every
 * lane surface. This tool enumerates it -- one page load per city, the
 * same in-page world.contrastAudit() the shoot gate trusts, the same GATE
 * thresholds -- and fails when any pairing anywhere is under the gate, or
 * lists the thin ones (margin under WARN) so a coat one repaint from
 * failure is named before the calendar names it.
 *
 * Not part of the standard four-command gate (seventeen loads is minutes,
 * and the daily gate already measures the day being shipped); run it when
 * a hazard coat, a road palette, or a city is added or retuned:
 *
 *   NODE_PATH=... node tools/contrast-sweep.js            # all cities
 *   NODE_PATH=... node tools/contrast-sweep.js BERLIN ... # a subset
 */
'use strict';

const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WARN = 0.05;   // gate margin under this is one repaint from failure

(async () => {
  // The city list comes from the build itself, not a copy in this file: a
  // tool with its own roster goes stale the day city 18 lands.
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--disable-dev-shm-usage', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 560 } });

  const boot = async (query) => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html') + query);
    await page.waitForFunction(() => window.MR && MR.game && MR.game.ready,
      null, { timeout: 120000 });
    return { page, errors };
  };

  const first = await boot('?bot=1&nosave=1&nocount=1&skip=30');
  const pool = await first.page.evaluate(() =>
    (MR.Course.SETTINGS || []).map((s) => s.tag));
  await first.page.close();

  const asked = process.argv.slice(2).map((t) => t.toUpperCase());
  const tags = asked.length ? pool.filter((t) => asked.includes(t)) : pool;
  console.log('CONTRAST SWEEP over ' + tags.length + ' cities');

  let failed = false;
  const thin = [];
  for (const tag of tags) {
    const { page, errors } = await boot('?bot=1&nosave=1&nocount=1&skip=30&city=' + tag);
    await page.waitForFunction(
      () => !MR.game.world.sculptsPending || MR.game.world.sculptsPending() === 0,
      null, { timeout: 90000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const g = MR.game, w = g.world;
      if (!w.contrastAudit) return { skipped: 'no contrastAudit' };
      const a = w.contrastAudit(g.renderer, g.scene);
      const G_L = 1.25, G_S = 0.22;
      const rows = [];
      for (const h of a.hazards) {
        let hardest = null;
        for (const rd of a.roads) {
          const ratio = Math.max(h.L, rd.L) / Math.max(1e-6, Math.min(h.L, rd.L));
          const dS = Math.abs(h.S - rd.S);
          const gm = Math.max(ratio / G_L - 1, dS / G_S - 1);
          if (!hardest || gm < hardest.gate) {
            hardest = { name: h.name, lane: rd.lane, gate: +gm.toFixed(3),
              ratio: +ratio.toFixed(2), dS: +dS.toFixed(3) };
          }
        }
        rows.push(hardest);
      }
      rows.sort((x, y) => x.gate - y.gate);
      return { rows };
    }).catch((e) => ({ skipped: e.message }));
    await page.close();

    if (errors.length) { failed = true; console.log('  ' + tag + '  PAGE ERROR: ' + errors[0]); continue; }
    if (r.skipped) { failed = true; console.log('  ' + tag + '  SKIPPED: ' + r.skipped); continue; }
    const bad = r.rows.filter((x) => x.gate < 0);
    const close = r.rows.filter((x) => x.gate >= 0 && x.gate < WARN);
    const t = r.rows[0];
    console.log('  ' + tag.padEnd(12) + ' tightest ' + t.name + ' vs ' + t.lane
      + '  gate ' + (t.gate >= 0 ? '+' : '') + t.gate
      + (bad.length ? '  FAIL x' + bad.length : close.length ? '  thin x' + close.length : ''));
    if (bad.length) failed = true;
    for (const b of bad) console.log('    UNDER GATE  ' + b.name + ' vs ' + b.lane + '  ' + b.ratio + 'xL ' + b.dS + 'S');
    for (const c of close) thin.push(tag + ' ' + c.name + ' vs ' + c.lane + ' gate +' + c.gate);
  }

  if (thin.length) {
    console.log('\nthin (gate margin < ' + WARN + ') -- one repaint from failure:');
    for (const t of thin) console.log('  ' + t);
  }
  console.log('\n' + (failed ? 'FAIL: a hazard is under the legibility gate somewhere on the tour'
    : 'OK: every hazard clears the gate in every city'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
