#!/usr/bin/env node
/**
 * COUNTERBALANCED READER SETS FOR tools/lanechoice.js, AND THE KEY TO SCORE
 * THEM WITH.
 *
 *   node tools/lanechoice-sets.js --key /path/to/keys/<runid>.json
 *   node tools/lanechoice-sets.js --key ... --readers 4 --out /somewhere
 *
 * ---- WHY THE ASSIGNMENT IS NOT LEFT TO THE PERSON RUNNING THE TEST -------
 *
 * The previous pass on the telegraph mat shot its two arms as two whole sets
 * read by two DIFFERENT readers, and got a confidence table that appeared to
 * say JUMP needs its mat and BLOCK is hurt by one. Both halves were an
 * artefact: confidence words are exactly where readers differ most, so the
 * comparison was confounded with temperament, and it took a re-run inside a
 * single reader to kill it. docs/staleness-and-mats.md records that, and it is
 * the reason this file exists rather than a shell loop.
 *
 * THE DESIGN IS A LATIN SQUARE OVER FOUR CONDITIONS.
 *
 *     0   near, mat        1   near, no mat
 *     2   far,  mat        3   far,  no mat
 *
 * Reader r sees gate i in condition (i + r) mod 4. That gives three properties
 * at once, and all three are asserted below rather than believed:
 *
 *   1. EVERY READER SEES BOTH ARMS AND BOTH DISTANCES, in equal number. The
 *      mat contrast lives INSIDE each reader, so temperament cancels out of it
 *      the way it did not last time.
 *   2. EVERY GATE IS SEEN ONCE IN EVERY CONDITION across the four readers, so
 *      no condition is carrying an easier or harder set of gates. Gate and
 *      condition are orthogonal by construction.
 *   3. NO READER SEES THE SAME GATE TWICE. This is the one the obvious design
 *      gets wrong. If a reader saw a gate at 25.35 and again at 32, the second
 *      look is not an independent judgement of a three-lane choice -- it is a
 *      memory of the first. Worse, if the two looks straddled the arms, the
 *      reader would be being shown the same road with and without paint and
 *      asked to pretend otherwise, which is not a blind test at all.
 *
 * ---- WHAT A READER GETS -------------------------------------------------
 *
 * A flat directory of PNGs under neutral eight-hex-digit names, plus
 * PROMPT.txt. No kind, no lane, no variant, no distance, no arm, no ordering,
 * and no way to pair a panel with its twin -- the twins live in different
 * readers' sets and carry unrelated names. A previous reader named a filename
 * as the reason a word came to mind, which is why the names are what they are.
 *
 * The reader itself must be UNCONTAMINATED, and this file cannot make it so:
 * an agent run inside this repository is handed CLAUDE.md before it sees a
 * pixel, and that file supplies the vocabulary the test is trying to read out
 * of the pictures. The recipe is roadmap entry 63's -- git hash-object, git
 * mktree, git commit-tree, push a PARENTLESS commit, and point a fresh session
 * at that branch. This file prints those commands for each set. Never merge
 * the branches.
 *
 * ---- BUILD EVERY ANGLE. THERE IS NO BACK OF AN OBJECT. ------------------
 *
 * Every object in this game is modelled on all sides, fully, always -- every
 * obstacle and vehicle of any kind, every building, bridge, tree, crowd, sign
 * and prop, and the runner. A marking painted on a surface is the one thing
 * that looks like an exception and is not, because it is not an object.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
function arg(n, d) {
  const i = args.indexOf('--' + n);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : d;
}

const KEYFILE = arg('key', null);
const READERS = parseInt(arg('readers', 4), 10);
const OUT = path.resolve(String(arg('out', path.join(os.tmpdir(), 'mr-lanechoice-sets'))));
const PUSH = arg('push', null);
const BRANCH = arg('branch', null);

/**
 * ---- PUSH A SET AS A PARENTLESS COMMIT, roadmap entry 63's recipe --------
 *
 * git hash-object -w   a blob per file
 * git mktree           a tree, built by hand
 * git commit-tree      a commit with NO PARENT
 * git push             a branch pointing at it
 *
 * No checkout, no orphan branch, no stash, no index, and nothing that touches
 * the working tree -- which matters because several agents share this one and
 * git add -A has swept their in-flight work into unrelated commits six times.
 * The branch contains the panels and PROMPT.txt and NOTHING ELSE: no source,
 * no CLAUDE.md, no repository for a reader to leak vocabulary out of.
 *
 * NEVER MERGE THESE BRANCHES.
 */
if (PUSH) {
  if (!BRANCH) { console.log('--push needs --branch'); process.exit(1); }
  const { execFileSync } = require('child_process');
  const dir = path.resolve(String(PUSH));
  const files = fs.readdirSync(dir).filter(function (f) { return f !== '.' && f !== '..'; }).sort();
  if (!files.length) { console.log('nothing in ' + dir); process.exit(1); }
  const lines = [];
  for (const f of files) {
    const sha = execFileSync('git', ['hash-object', '-w', path.join(dir, f)], { cwd: ROOT })
      .toString().trim();
    lines.push('100644 blob ' + sha + '\t' + f);
  }
  const tree = execFileSync('git', ['mktree'], { cwd: ROOT, input: lines.join('\n') + '\n' })
    .toString().trim();
  const commit = execFileSync('git', ['commit-tree', tree, '-m',
    'lanechoice reader set: panels and PROMPT.txt only, parentless on purpose. Never merge.'],
    { cwd: ROOT }).toString().trim();
  execFileSync('git', ['push', '-f', 'origin', commit + ':refs/heads/' + BRANCH],
    { cwd: ROOT, stdio: 'inherit' });
  console.log('pushed ' + files.length + ' files to ' + BRANCH + ' at ' + commit);
  console.log('PARENTLESS. Never merge it.');
  process.exit(0);
}

if (!KEYFILE) { console.log('need --key /path/to/keys/<runid>.json'); process.exit(1); }
if (OUT === ROOT || OUT.startsWith(ROOT + path.sep)) {
  console.log('REFUSED: --out is inside the repository (' + OUT + ').');
  process.exit(1);
}

const K = JSON.parse(fs.readFileSync(KEYFILE, 'utf8'));
const dists = K.dists.slice().sort((a, b) => a - b);
if (dists.length !== 2) {
  console.log('this file assumes exactly two distances; the key has ' + dists.length + ': ' + dists.join(', '));
  process.exit(1);
}
if (READERS % 4 !== 0) {
  console.log('readers must be a multiple of 4 -- the square has four conditions');
  process.exit(1);
}

// ---- index the panels by gate -------------------------------------------
// A gate is identified by its skip, which is what selected it. Each gate must
// have been shot at both distances, and each shot carries both arms.
const gates = {};
for (const p of K.panels) {
  (gates[p.skip] || (gates[p.skip] = {}))[p.dist] = p;
}
const skips = Object.keys(gates).map(Number).sort((a, b) => a - b);
const usable = skips.filter((s) => gates[s][dists[0]] && gates[s][dists[1]]);
if (usable.length !== skips.length) {
  console.log('WARNING: ' + (skips.length - usable.length) + ' gates were not shot at both distances and are dropped');
}

// condition 0 near+mat, 1 near+nomat, 2 far+mat, 3 far+nomat
const COND = [
  { dist: dists[0], mat: true,  name: 'near+mat' },
  { dist: dists[0], mat: false, name: 'near+nomat' },
  { dist: dists[1], mat: true,  name: 'far+mat' },
  { dist: dists[1], mat: false, name: 'far+nomat' },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const master = [];
const setDirs = [];
for (let r = 0; r < READERS; r++) {
  const name = 'reader-' + String.fromCharCode(97 + r);
  const dir = path.join(OUT, name);
  fs.mkdirSync(dir, { recursive: true });
  setDirs.push({ name, dir });

  const rows = [];
  for (let i = 0; i < usable.length; i++) {
    const c = COND[(i + r) % 4];
    const p = gates[usable[i]][c.dist];
    const file = c.mat ? p.fileMat : p.fileNomat;
    fs.copyFileSync(path.join(K.panelDir, file), path.join(dir, file));
    rows.push({
      reader: name, file, condition: c.name, mat: c.mat, dist: c.dist,
      skip: p.skip, gateZ: p.gateZ,
      truthLeftToRight: p.truthLeftToRight,
      lanesLeftToRight: p.laneIndexOrderLeftToRight.map(function (l) {
        const L = p.lanes[l];
        return { screen: null, laneIndex: l, kind: L.kind, variant: L.variant === undefined ? null : L.variant,
                 demand: L.demand, train: !!L.train, ramp: !!L.ramp,
                 matPxInCrop: L.matPxInCrop || 0 };
      }),
      clearLanesLeftToRight: p.laneIndexOrderLeftToRight
        .map(function (l, ix) { return p.lanes[l].kind === 'CLEAR' ? ['left', 'middle', 'right'][ix] : null; })
        .filter(Boolean),
      cropPx: p.cropPx,
    });
  }
  for (const row of rows) {
    const names = ['left', 'middle', 'right'];
    row.lanesLeftToRight.forEach(function (L, ix) { L.screen = names[ix]; });
  }
  fs.writeFileSync(path.join(dir, 'PROMPT.txt'),
    fs.readFileSync(path.join(K.panelDir, 'PROMPT.txt')));
  master.push({ reader: name, dir, panels: rows });
}

// ---- assert the three properties the design claims -----------------------
const problems = [];
for (const m of master) {
  const byCond = {};
  const seenGates = {};
  for (const p of m.panels) {
    byCond[p.condition] = (byCond[p.condition] || 0) + 1;
    if (seenGates[p.skip]) problems.push(m.reader + ' sees gate at skip ' + p.skip + ' twice');
    seenGates[p.skip] = 1;
  }
  const counts = COND.map((c) => byCond[c.name] || 0);
  if (Math.max.apply(null, counts) - Math.min.apply(null, counts) > 1) {
    problems.push(m.reader + ' is not balanced across conditions: ' + counts.join('/'));
  }
  const nMat = m.panels.filter((p) => p.mat).length;
  const nNo = m.panels.length - nMat;
  if (Math.abs(nMat - nNo) > 1) problems.push(m.reader + ' sees ' + nMat + ' mat and ' + nNo + ' no-mat panels');
}
// Every gate in every condition, across the readers.
const gateCond = {};
for (const m of master) for (const p of m.panels) {
  (gateCond[p.skip] || (gateCond[p.skip] = {}))[p.condition] = (gateCond[p.skip][p.condition] || 0) + 1;
}
for (const s of usable) {
  for (const c of COND) {
    const n = (gateCond[s] || {})[c.name] || 0;
    if (n !== READERS / 4) problems.push('gate at skip ' + s + ' appears ' + n + ' times in ' + c.name + ', expected ' + (READERS / 4));
  }
}
// No panel file may be handed to two readers -- a twin pair split across two
// readers is fine and is the design, the same FILE twice is a duplicate.
const seenFile = {};
for (const m of master) for (const p of m.panels) {
  if (seenFile[p.file]) problems.push('file ' + p.file + ' handed to both ' + seenFile[p.file] + ' and ' + m.reader);
  seenFile[p.file] = m.reader;
}

fs.writeFileSync(path.join(OUT, 'MASTER-KEY.json'), JSON.stringify({
  source: KEYFILE, runid: K.runid, date: K.date, dists: dists, readers: READERS,
  design: 'Latin square: reader r sees gate i in condition (i + r) mod 4 over '
    + '[near+mat, near+nomat, far+mat, far+nomat]. Every reader sees both arms '
    + 'and both distances equally; every gate is seen once in every condition; '
    + 'no reader sees the same gate twice.',
  sets: master,
}, null, 1));

console.log('LANECHOICE READER SETS from ' + K.runid);
console.log('  gates ' + usable.length + ', readers ' + READERS + ', distances ' + dists.join(' and '));
console.log('');
for (const m of master) {
  const c = {};
  for (const p of m.panels) c[p.condition] = (c[p.condition] || 0) + 1;
  console.log('  ' + m.reader + '  ' + m.panels.length + ' panels: '
    + COND.map((x) => x.name + ' ' + (c[x.name] || 0)).join(', '));
  console.log('             ' + m.dir);
}
console.log('');
console.log('  master key  ' + path.join(OUT, 'MASTER-KEY.json') + '   <- do not show a reader');
console.log('');
if (problems.length) {
  console.log('FAIL: the counterbalancing is not what this file claims:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('OK: every reader sees both arms and both distances in equal number, every');
console.log('gate appears once in each of the four conditions, and no reader sees the same');
console.log('gate twice.');
console.log('');
console.log('  ---- TO GET AN UNCONTAMINATED READER (roadmap entry 63) ----');
console.log('  A reader run inside this repository is handed CLAUDE.md before it sees a');
console.log('  pixel. Push each set as a PARENTLESS commit and point a fresh session at it:');
console.log('');
for (const s of setDirs) {
  console.log('    node tools/lanechoice-sets.js --push ' + s.dir + ' --branch lanechoice-' + s.name);
}
console.log('');
console.log('  Never merge those branches.');
