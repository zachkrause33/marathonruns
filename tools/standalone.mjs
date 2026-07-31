// Build a single self-contained playable HTML file.
//
// The shipped index.html pulls three.js from jsDelivr via an import map, which
// is right for the real site but useless anywhere the page cannot reach a CDN —
// an offline machine, a file:// open, or a sandboxed embed with a strict CSP.
// This inlines three and every addon into one <script type="module"> and drops
// the import map, so the result is one file with zero external requests.
//
// Requires a local three checkout resolvable as `three` (node_modules/three).
//
// With --body, emits only <title>/<style>/markup/<script> instead of a whole
// document, for hosts that supply their own document skeleton and strip any
// <html>/<head>/<body> tags they are given.
//
// Usage: node tools/standalone.mjs [out.html] [--body]
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const out = process.argv[2] || path.join(root, 'dist', 'marathon-rush.html');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// pull out the game's module script and the import map that feeds it
const scriptRe = /<script type="module">([\s\S]*?)<\/script>/;
const m = html.match(scriptRe);
if (!m) throw new Error('no module script found in index.html');

const tmp = path.join(root, '.mr-entry.mjs');
fs.writeFileSync(tmp, m[1]);
try {
  const res = await esbuild.build({
    entryPoints: [tmp],
    bundle: true,
    format: 'esm',
    minify: true,
    // three targets modern browsers; matching that keeps the bundle small and
    // avoids esbuild lowering syntax the game already relies on
    target: ['es2020'],
    write: false,
    logLevel: 'warning',
  });
  const bundle = res.outputFiles[0].text;

  let standalone = html
    // the import map only existed to point at the CDN
    .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
    // `$` sequences are special in String.replace patterns, so use a function
    .replace(scriptRe, () => `<script type="module">\n${bundle}\n</script>`);

  if (process.argv.includes('--body')){
    // Keep the <style>, the UI markup and the script; drop the document
    // skeleton. The game's `html,body{...}` rules still apply from a <style>
    // anywhere in the document, and the canvas is position:fixed, so it fills
    // whatever box the host gives it.
    const style = standalone.match(/<style>[\s\S]*?<\/style>/)[0];
    const ui    = standalone.match(/<div id="ui">[\s\S]*?\n<\/div>/)[0];
    const js    = standalone.match(scriptRe)[0];
    standalone = `<title>MARATHON RUSH</title>\n${style}\n${ui}\n${js}\n`;
  }

  if (/cdn\.jsdelivr|importmap/.test(standalone)) throw new Error('CDN reference survived');

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, standalone);
  const kb = n => (n / 1024).toFixed(0) + ' KB';
  console.log(`${out}\n  bundle ${kb(bundle.length)} -> page ${kb(standalone.length)}`);
} finally {
  fs.unlinkSync(tmp);
}
