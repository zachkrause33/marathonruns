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
  'src/core/pace.js',
  'src/core/course.js',
  'src/render/shading.js',
  'src/render/runner.js',
  'src/render/world.js',
  'src/render/camera.js',
  'src/game/controls.js',
  'src/game/collision.js',
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

const shell = read('tools/shell.html');
const css = read('src/ui/style.css');

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

fs.writeFileSync(dest, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`built ${path.relative(ROOT, dest) || dest}  ${kb} KB  (${MODULES.length} modules)`);
