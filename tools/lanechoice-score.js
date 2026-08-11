#!/usr/bin/env node
/**
 * SCORE THE THREE-LANE CHOICE EXPERIMENT.
 *
 *   node tools/lanechoice-score.js --master MASTER-KEY.json --answers answers.json
 *
 * ---- WHAT IS SCORED, AND WHY IT IS THREE THINGS AND NOT ONE -------------
 *
 * The reader is asked a decision question, so there are three separable
 * measures and collapsing them would hide exactly the effect the experiment is
 * looking for.
 *
 *   1. DEMAND ACCURACY, per lane. Did the reader say over / under / around /
 *      clear correctly for each of the three lanes? This is the mat's own job
 *      description -- world.js says the mat says WHAT TO DO -- so it is the
 *      measure the mat has to move if it moves anything. Occupied lanes and
 *      CLEAR lanes are counted separately: saying "nothing is in that lane" is
 *      a different judgement from saying what a thing demands, and only the
 *      second is what paint could help with.
 *
 *   2. CHOICE VIABILITY. Did the reader pick a lane they could actually get
 *      through? A lane holding a BLOCK cannot be passed at all, and under rule
 *      4 one contact ends a record attempt -- so choosing a BLOCK lane is the
 *      only answer here that corresponds to losing a run. A JUMP or DUCK lane
 *      is a viable choice; it just costs an action.
 *
 *   3. CONFIDENCE on the choice. Kept apart from accuracy because the previous
 *      pass found its whole confidence signal was reader temperament, and the
 *      only thing that killed it was counterbalancing inside the reader. The
 *      cuts below are therefore always within-reader as well as pooled.
 *
 * ---- THE TRANSCRIPTION IS THE WEAK LINK AND IT IS PRINTED ---------------
 *
 * The readers answer in prose. Somebody has to turn "I would take the middle
 * lane" into middle, and that somebody has an interest in the outcome. So the
 * scorer prints the VERBATIM text beside every scored cell it was derived
 * from, and the answers file carries that text -- a disagreement with the
 * scoring is then visible to anyone re-reading the file rather than buried in
 * a number. Nothing here is scored from a summary.
 *
 * ---- BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT. -----------------
 *
 * Every object in this game is modelled on all sides, fully, always. A marking
 * painted on a surface is the one thing that looks like an exception and is
 * not, because it is not an object.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}
const MASTER = arg('master', null);
const ANSWERS = arg('answers', null);
const VERBOSE = !!arg('verbatim', false);
if (!MASTER || !ANSWERS) {
  console.log('need --master MASTER-KEY.json --answers answers.json');
  process.exit(1);
}

const M = JSON.parse(fs.readFileSync(MASTER, 'utf8'));
const A = JSON.parse(fs.readFileSync(ANSWERS, 'utf8'));

// file -> truth
const truth = {};
for (const set of M.sets) {
  for (const p of set.panels) truth[p.file] = p;
}

const NAMES = ['left', 'middle', 'right'];
function norm(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toUpperCase();
  if (t.startsWith('OVER')) return 'OVER';
  if (t.startsWith('UNDER')) return 'UNDER';
  if (t.startsWith('AROUND')) return 'AROUND';
  if (t.startsWith('CLEAR')) return 'CLEAR';
  if (t.startsWith('CANNOT')) return 'CANNOT TELL';
  return t;
}
function normConf(s) {
  const t = String(s || '').trim().toLowerCase();
  if (t.startsWith('sure')) return 'sure';
  if (t.startsWith('fairly')) return 'fairly sure';
  if (t.startsWith('guess')) return 'guessing';
  return t;
}

// ---- score every cell ------------------------------------------------------
const rows = [];
const missing = [];
for (const file in truth) {
  const t = truth[file];
  const a = A[file];
  if (!a) { missing.push(file); continue; }
  const cells = [];
  for (let i = 0; i < 3; i++) {
    const said = norm(a.demands[NAMES[i]]);
    const want = t.truthLeftToRight[i];
    const lane = t.lanesLeftToRight[i];
    cells.push({
      screen: NAMES[i], said, want, correct: said === want,
      kind: lane.kind, variant: lane.variant, train: lane.train,
      occupied: lane.kind !== 'CLEAR', matPx: lane.matPxInCrop,
    });
  }
  const choiceIx = NAMES.indexOf(String(a.lane || '').trim().toLowerCase());
  const chosen = choiceIx >= 0 ? t.lanesLeftToRight[choiceIx] : null;
  rows.push({
    file, reader: t.reader, mat: t.mat, dist: t.dist, condition: t.condition,
    skip: t.skip, cells,
    choice: choiceIx >= 0 ? NAMES[choiceIx] : null,
    choiceKind: chosen ? chosen.kind : null,
    // A BLOCK lane cannot be passed at all. Under rule 4 one contact ends a
    // record attempt, so this is the only answer that corresponds to a lost run.
    viable: chosen ? chosen.kind !== 'BLOCK' : false,
    // Was there a CLEAR lane, and did they take it? Not a fairness measure --
    // running a JUMP lane is legal, it just costs an action.
    hadClear: t.clearLanesLeftToRight.length > 0,
    tookClear: chosen ? chosen.kind === 'CLEAR' : false,
    conf: normConf(a.confidence),
    reason: a.reason || '',
  });
}
if (missing.length) {
  console.log('MISSING ANSWERS for ' + missing.length + ' panels:');
  for (const f of missing) console.log('  ' + f);
  console.log('');
}

function pct(n, d) { return d ? (100 * n / d).toFixed(0) + '%' : '--'; }
function tally(list, pred) { return list.filter(pred).length; }

function demandCells(list, occupiedOnly) {
  const out = [];
  for (const r of list) for (const c of r.cells) {
    if (occupiedOnly === true && !c.occupied) continue;
    if (occupiedOnly === false && c.occupied) continue;
    out.push({ r, c });
  }
  return out;
}

console.log('LANECHOICE SCORE');
console.log('  master ' + path.basename(MASTER) + ', runid ' + M.runid + ', ' + rows.length + ' panels scored');
console.log('  ' + M.design);
console.log('');

// ---- 1. the headline: demand accuracy on OCCUPIED lanes, by arm ----------
console.log('1. DEMAND ACCURACY ON OCCUPIED LANES  (over / under / around -- the mat\'s own job)');
console.log('');
console.log('   arm        distance   lanes   correct   confident-and-wrong');
for (const mat of [true, false]) {
  for (const d of M.dists) {
    const cells = demandCells(rows.filter((r) => r.mat === mat && r.dist === d), true);
    const ok = tally(cells, (x) => x.c.correct);
    const badSure = tally(cells, (x) => !x.c.correct && x.r.conf === 'sure');
    console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '    ' + String(d).padStart(6)
      + 'u   ' + String(cells.length).padStart(5) + '   ' + (ok + '/' + cells.length).padStart(7)
      + ' ' + pct(ok, cells.length).padStart(5) + '   ' + badSure);
  }
}
console.log('');
console.log('   pooled over distance:');
for (const mat of [true, false]) {
  const cells = demandCells(rows.filter((r) => r.mat === mat), true);
  console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '    all        '
    + String(cells.length).padStart(5) + '   '
    + (tally(cells, (x) => x.c.correct) + '/' + cells.length).padStart(7)
    + ' ' + pct(tally(cells, (x) => x.c.correct), cells.length).padStart(5));
}
console.log('');

// ---- 2. by kind, which is where a difference would live -----------------
console.log('2. DEMAND ACCURACY BY KIND AND ARM');
console.log('');
console.log('   kind     mat ON            mat OFF');
for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
  const on = demandCells(rows.filter((r) => r.mat), true).filter((x) => x.c.kind === kind);
  const off = demandCells(rows.filter((r) => !r.mat), true).filter((x) => x.c.kind === kind);
  console.log('   ' + kind.padEnd(8)
    + (tally(on, (x) => x.c.correct) + '/' + on.length).padEnd(8) + pct(tally(on, (x) => x.c.correct), on.length).padStart(5)
    + '     ' + (tally(off, (x) => x.c.correct) + '/' + off.length).padEnd(8) + pct(tally(off, (x) => x.c.correct), off.length).padStart(5));
}
console.log('');
console.log('   and split by distance:');
for (const kind of ['JUMP', 'DUCK', 'BLOCK']) {
  for (const d of M.dists) {
    const on = demandCells(rows.filter((r) => r.mat && r.dist === d), true).filter((x) => x.c.kind === kind);
    const off = demandCells(rows.filter((r) => !r.mat && r.dist === d), true).filter((x) => x.c.kind === kind);
    console.log('   ' + kind.padEnd(6) + String(d).padStart(6) + 'u   ON '
      + (tally(on, (x) => x.c.correct) + '/' + on.length).padEnd(7)
      + '  OFF ' + (tally(off, (x) => x.c.correct) + '/' + off.length));
  }
}
console.log('');

// ---- 3. CLEAR lanes ------------------------------------------------------
console.log('3. CLEAR LANES -- did the reader see that a lane was empty?');
console.log('');
for (const mat of [true, false]) {
  const cells = demandCells(rows.filter((r) => r.mat === mat), false);
  console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '  '
    + (tally(cells, (x) => x.c.correct) + '/' + cells.length).padStart(7)
    + ' ' + pct(tally(cells, (x) => x.c.correct), cells.length));
}
console.log('');

// ---- 4. the choice -------------------------------------------------------
console.log('4. LANE CHOICE');
console.log('');
console.log('   arm        dist    panels   viable (not a BLOCK)   took a CLEAR lane when one existed');
for (const mat of [true, false]) {
  for (const d of M.dists) {
    const list = rows.filter((r) => r.mat === mat && r.dist === d);
    const withClear = list.filter((r) => r.hadClear);
    console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '   ' + String(d).padStart(6) + 'u'
      + String(list.length).padStart(8) + '   ' + (tally(list, (r) => r.viable) + '/' + list.length).padStart(9)
      + ' ' + pct(tally(list, (r) => r.viable), list.length).padStart(5)
      + '        ' + (tally(withClear, (r) => r.tookClear) + '/' + withClear.length));
  }
}
console.log('');

// ---- 5. confidence -------------------------------------------------------
console.log('5. CONFIDENCE ON THE LANE CHOICE');
console.log('');
console.log('   arm        dist     sure   fairly sure   guessing');
for (const mat of [true, false]) {
  for (const d of M.dists) {
    const list = rows.filter((r) => r.mat === mat && r.dist === d);
    console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '   ' + String(d).padStart(6) + 'u'
      + String(tally(list, (r) => r.conf === 'sure')).padStart(8)
      + String(tally(list, (r) => r.conf === 'fairly sure')).padStart(14)
      + String(tally(list, (r) => r.conf === 'guessing')).padStart(11));
  }
}
console.log('');
console.log('   WITHIN EACH READER (the cut that killed the last pass\'s confidence result):');
console.log('   reader     mat ON sure     mat OFF sure    ON correct      OFF correct');
for (const set of M.sets) {
  const on = rows.filter((r) => r.reader === set.reader && r.mat);
  const off = rows.filter((r) => r.reader === set.reader && !r.mat);
  const onC = demandCells(on, true), offC = demandCells(off, true);
  console.log('   ' + set.reader.padEnd(11)
    + (tally(on, (r) => r.conf === 'sure') + '/' + on.length).padEnd(16)
    + (tally(off, (r) => r.conf === 'sure') + '/' + off.length).padEnd(16)
    + (tally(onC, (x) => x.c.correct) + '/' + onC.length).padEnd(16)
    + (tally(offC, (x) => x.c.correct) + '/' + offC.length));
}
console.log('');

// ---- 6. every error, in full --------------------------------------------
const errs = [];
for (const r of rows) for (const c of r.cells) if (!c.correct) errs.push({ r, c });
console.log('6. EVERY WRONG CELL (' + errs.length + ' of ' + demandCells(rows).length + ')');
console.log('');
if (!errs.length) console.log('   none.');
for (const e of errs) {
  console.log('   ' + e.r.file + '  ' + e.r.reader + '  ' + e.r.condition
    + '  ' + e.c.screen + ' lane: said ' + e.c.said + ', was ' + e.c.want
    + (e.c.occupied ? ' (' + e.c.kind + ' v' + e.c.variant + (e.c.train ? ' TRAIN' : '') + ')' : '')
    + '  conf ' + e.r.conf);
  console.log('      choice ' + e.r.choice + ' (' + e.r.choiceKind + '), viable ' + e.r.viable);
  console.log('      "' + e.r.reason.replace(/\s+/g, ' ').slice(0, 400) + '"');
}
console.log('');

// ---- 7. did anybody mention the paint? ----------------------------------
//
// The accuracy columns cannot see a reader who used the mat and would have got
// there anyway. The free-text answer can. Counted by word rather than judged,
// and the words are printed so the count can be checked.
const PAINTWORDS = /\b(paint|painted|mat|marking|markings|stripe|striped|coloured patch|colour patch|magenta|pink patch|chevron|icon|symbol|arrow|road marking)\b/i;
console.log('7. READERS WHO NAMED THE PAINT IN THEIR REASON');
console.log('');
for (const mat of [true, false]) {
  const list = rows.filter((r) => r.mat === mat);
  const hits = list.filter((r) => PAINTWORDS.test(r.reason));
  console.log('   ' + (mat ? 'mat ON ' : 'mat OFF') + '  ' + hits.length + '/' + list.length + ' answers mention paint-like words');
}
console.log('');
for (const r of rows.filter((x) => PAINTWORDS.test(x.reason))) {
  const m = r.reason.match(PAINTWORDS);
  console.log('   ' + (r.mat ? 'ON ' : 'OFF') + ' ' + r.file + ' ' + r.reader + ' [' + m[0] + ']');
  if (VERBOSE) console.log('      "' + r.reason.replace(/\s+/g, ' ') + '"');
}
console.log('');

if (VERBOSE) {
  console.log('8. EVERY ANSWER, VERBATIM');
  console.log('');
  for (const r of rows) {
    console.log('   ' + r.file + '  ' + r.reader + '  ' + r.condition + '  truth '
      + r.cells.map((c) => c.want).join('/') + '  said ' + r.cells.map((c) => c.said).join('/')
      + '  choice ' + r.choice + '  conf ' + r.conf);
    console.log('      "' + r.reason.replace(/\s+/g, ' ') + '"');
  }
}
