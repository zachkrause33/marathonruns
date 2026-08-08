#!/usr/bin/env node
/**
 * Build: concatenate vendor/three.min.js + src modules + shell into one
 * self-contained index.html that runs from file:// with no assets.
 *
 * Module contract: every file in MODULES is plain script text that attaches
 * to the global `MR` namespace. No imports, no exports, no bundler. Order in
 * MODULES is load order, so a module may use anything defined above it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Load order. Dependencies flow downward only.
const MODULES = [
  'src/core/rng.js',
  'src/core/constants.js',
  'src/core/elevation.js',
  'src/core/pace.js',
  'src/core/course.js',
  'src/core/store.js',
  'src/render/shading.js',
  'src/render/runner.js',
  'src/render/world.js',
  'src/render/ghost.js',
  'src/render/camera.js',
  'src/game/controls.js',
  'src/game/collision.js',
  // After collision.js: the ramp placeholder generates every vertex from
  // MR.Collision.BOX so art cannot disagree with clearance. Delete this line
  // and the file when world.js grows a real tailgate.
  'src/render/ramp.js',
  'src/game/player.js',
  'src/audio/audio.js',
  'src/ui/hud.js',
  'src/main.js',
];

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    throw new Error(`missing module: ${rel}`);
  }
  return fs.readFileSync(p, 'utf8');
}

function banner(rel) {
  return `\n/* ==================== ${rel} ==================== */\n`;
}

// Vendor code is inlined verbatim. An earlier version tried to strip r160's
// UMD deprecation notice with a regex and silently truncated the bundle into a
// syntax error -- the page rendered a blank canvas and only the screenshot
// harness caught it. The one-line console notice is not worth that risk.
const three = read('vendor/three.min.js');

// `--artifact` swaps in a shell with no document skeleton, for hosts that
// supply their own <head>/<body> and render the page inside a frame.
const shell = read(process.argv.includes('--artifact')
  ? 'tools/shell-artifact.html'
  : 'tools/shell.html');
// The embedded typeface goes first: an @font-face has to be declared before
// the rules that use it, and it is generated rather than hand-edited (see
// tools/mkfont.js), so it lives in its own file instead of being pasted into
// the stylesheet a human reads.
const css = read('src/ui/font.css') + read('src/ui/style.css');

let game = '';
for (const m of MODULES) game += banner(m) + read(m);

const out = shell
  .replace('/*__CSS__*/', () => css)
  .replace('/*__THREE__*/', () => three)
  .replace('/*__GAME__*/', () => game);

// `--out <path>` lets parallel agents each build to their own file instead of
// racing over the shared index.html. The committed deliverable is still
// index.html, produced by a plain `node tools/build.js`.
const outIdx = process.argv.indexOf('--out');
const dest = outIdx >= 0 && process.argv[outIdx + 1]
  ? path.resolve(process.argv[outIdx + 1])
  : path.join(ROOT, 'index.html');

// Syntax-check the concatenated game before writing it. Two separate bugs
// have shipped a bundle that parsed as garbage and rendered a blank canvas:
// a regex that truncated the vendor file, and a backtick inside a GLSL
// comment that closed the JS template literal holding the shader early.
// Neither is visible in a diff. `new Function` parses without executing, so
// this costs nothing and turns a silent blank page into a failed build.
try {
  new Function(game);
} catch (e) {
  console.error(`\nBUILD FAILED: concatenated game is not parseable\n  ${e.message}`);
  console.error('  A backtick inside a GLSL comment or string will do this.\n');
  process.exit(1);
}

/**
 * The stray-backtick lint, and why the syntax check above is not enough.
 *
 * A backtick written inside a comment that is itself inside a template literal
 * does not usually break the parse. It closes the literal early, and what
 * follows -- prose the author wrote as a comment -- is then read as code. Most
 * of the time that prose happens to BE valid JavaScript, so `new Function`
 * passes, the build prints a size, and the page throws at runtime instead.
 *
 * This has now cost this project three separate afternoons:
 *
 *   1. a backtick in a GLSL comment inside a shader string (caught by the
 *      parse check above, which is why that check exists),
 *   2. `CLEAN` quoted in an HTML comment inside hud.js's start panel,
 *   3. `.val.ahead` quoted in an HTML comment inside hud.js's readout panel,
 *      which parsed cleanly and died as
 *      "Cannot read properties of undefined (reading 'ahead')".
 *
 * Only the first was visible to the parser. So this scans for the CAUSE rather
 * than the symptom, and it needs a signature that a legitimate template cannot
 * produce. "A comment inside a template literal" is not one: every GLSL shader
 * in shading.js is a template literal full of honest `//` comments, and the
 * first draft of this lint failed the build on all of them.
 *
 * The signature that does hold: **a template literal that closes while an HTML
 * comment inside it is still open.** An HTML block is written as one literal
 * and its comments are balanced within it, so `<!--` without its `-->` at the
 * closing backtick means the literal ended somewhere its author did not
 * choose -- which is precisely what a stray backtick in the prose does. GLSL
 * has no `<!--`, so shaders cannot trip it.
 */
function strayBackticks(text, rel) {
  const hits = [];
  let i = 0, line = 1;
  // Where the current template literal began, so a report can name it.
  let tplLine = 0;
  let html = 0;                   // <!-- --> nesting inside the current template
  const st = [];                 // template-literal nesting, for ${ } re-entry
  let mode = 'code';
  // A '/' opens a regex rather than a division when the last meaningful token
  // cannot end an expression. Good enough for this codebase, and a wrong guess
  // here can only mis-scan a regex, never a template.
  let prev = '';
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (c === '\n') line++;
    if (mode === 'line') { if (c === '\n') mode = 'code'; i++; continue; }
    if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; }
      i++; continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"')) mode = 'code';
      i++; continue;
    }
    if (mode === 'regex') {
      if (c === '\\') { i += 2; continue; }
      if (c === '[') { // a '/' inside a character class is literal
        while (i < text.length && text[i] !== ']') { if (text[i] === '\\') i++; i++; }
      } else if (c === '/') mode = 'code';
      i++; continue;
    }
    if (mode === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '$' && n === '{') { st.push('tpl'); mode = 'code'; i += 2; continue; }
      if (text.startsWith('<!--', i)) { html++; i += 4; continue; }
      if (text.startsWith('-->', i)) { html--; i += 3; continue; }
      if (c === '`') {
        if (html > 0) {
          // Report the line the comment opened on as well as the backtick: the
          // backtick is where the parser diverged, the open comment is where a
          // human will see why.
          const eol = text.indexOf('\n', i);
          hits.push({ line, tplLine, text: text.slice(text.lastIndexOf('\n', i) + 1,
            eol < 0 ? text.length : eol).trim().slice(0, 76) });
        }
        html = 0;
        mode = st.length ? st.pop() : 'code';
        i++; continue;
      }
      i++; continue;
    }
    // mode === 'code'
    if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
    if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
    if (c === "'") { mode = 'sq'; i++; continue; }
    if (c === '"') { mode = 'dq'; i++; continue; }
    if (c === '`') { mode = 'tpl'; tplLine = line; html = 0; i++; continue; }
    if (c === '}' && st.length) { mode = st.pop(); i++; continue; }
    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(prev)) { mode = 'regex'; i++; continue; }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return hits.map((h) => Object.assign({ file: rel }, h));
}

const stray = [];
for (const m of MODULES) stray.push(...strayBackticks(read(m), m));
if (stray.length) {
  console.error('\nBUILD FAILED: a template literal has swallowed a comment');
  console.error('  Almost always a backtick written inside a comment inside a');
  console.error('  template literal. It closes the literal early and the prose');
  console.error('  after it is read as code -- which often parses, and then');
  console.error('  throws in the browser instead of here.\n');
  for (const h of stray.slice(0, 8)) {
    console.error(`  ${h.file}:${h.line}  (inside the template opened on line ${h.tplLine})`);
    console.error(`    ${h.text}`);
  }
  if (stray.length > 8) console.error(`  ... and ${stray.length - 8} more`);
  console.error('\n  Use plain quotes inside these comments, never backticks.\n');
  process.exit(1);
}

/**
 * `--check` fails instead of writing, when the file on disk is not what this
 * build would produce.
 *
 * index.html IS the deliverable -- the whole premise of the project is that a
 * player opens one self-contained file -- and it is also a build artifact, so
 * it goes stale silently every time work lands in src/ without a rebuild. It
 * has now drifted twice in one session, once by 97KB, and in that state the
 * shipped game was missing an entire body of work while every harness stayed
 * green.
 *
 * That is not an accident of discipline, it is structural: every tool here
 * either rebuilds first or is pointed at a scratch build with --out, so the
 * one artifact none of them look at is the one that ships. And an agent that
 * correctly declines to commit a build artifact -- because rebuilding bakes in
 * whatever another agent has uncommitted -- leaves it stale by doing the right
 * thing.
 *
 * So the check belongs in CI and in any pre-push habit, not in a person's
 * memory.
 */
if (process.argv.includes('--check')) {
  const current = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  if (current && Buffer.compare(current, Buffer.from(out)) === 0) {
    console.log(`up to date  ${path.relative(ROOT, dest) || dest}`);
    process.exit(0);
  }
  console.error(`\nSTALE: ${path.relative(ROOT, dest) || dest} is not what this source builds.`);
  console.error(current
    ? `  on disk ${current.length} bytes, fresh build ${Buffer.byteLength(out)} bytes`
    : '  the file does not exist');
  console.error('  Run: node tools/build.js\n');
  process.exit(1);
}

fs.writeFileSync(dest, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`built ${path.relative(ROOT, dest) || dest}  ${kb} KB  (${MODULES.length} modules)`);
