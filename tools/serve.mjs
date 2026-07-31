// Static server for the tools. Optionally rewrites the CDN import map to a local
// three.js checkout, so the harness works on machines (or CI sandboxes) with no
// outbound network. Pass --three=/path/to/three-package to enable.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.png':'image/png', '.css':'text/css',
};
const CDN_BUILD = 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js';
const CDN_ADDONS = 'https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/';

export function threeDirFromArgv(argv = process.argv) {
  const a = argv.find(x => x.startsWith('--three='));
  return a ? a.slice('--three='.length) : null;
}

export async function serve({ root, port = 8099, threeDir = null }) {
  const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0]);

    if (threeDir && url.startsWith('/three/')) {
      const f = path.join(threeDir, url.slice('/three/'.length));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }

    const f = path.join(root, url === '/' ? 'index.html' : url);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }

    if (threeDir && f.endsWith('.html')) {
      const html = fs.readFileSync(f, 'utf8')
        .replace(CDN_BUILD, '/three/build/three.module.js')
        .replace(CDN_ADDONS, '/three/examples/jsm/');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(port, r));
  return { server, url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export async function launch(chromium) {
  return chromium.launch({
    executablePath: process.env.MR_CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

export const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
