// Static server for dist/ on 127.0.0.1:8080. Node built-ins only.
// No redirects, ever: "/games/x/" serves index.html, "/games/x" is a 404.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function device(ua = '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  if (/curl/i.test(ua)) return 'curl';
  return ua.slice(0, 24) || '-';
}

function log(req, status, bytes, started) {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const who = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const sw = req.headers['service-worker'] ? ' [sw]' : '';
  const ms = Date.now() - started;
  console.log(`${time}  ${status}  ${req.method.padEnd(4)} ${req.url}${sw}  ${bytes}B  ${ms}ms  ${device(req.headers['user-agent'])} ${who}`);
}

async function resolveFile(urlPath) {
  // Reject anything that tries to escape dist/.
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) return null;
  const target = path.normalize(path.join(DIST, decoded));
  if (target !== DIST && !target.startsWith(DIST + path.sep)) return null;

  if (decoded.endsWith('/')) {
    const index = path.join(target, 'index.html');
    const s = await stat(index).catch(() => null);
    return s?.isFile() ? { file: index, size: s.size } : null;
  }
  const s = await stat(target).catch(() => null);
  // A directory without its trailing slash is a 404, not a 301.
  return s?.isFile() ? { file: target, size: s.size } : null;
}

// The request handler, shared with scripts/lan.mjs (the same files over HTTPS on the network).
export async function handle(req, res) {
  const started = Date.now();
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...headers });
    res.end(req.method === 'HEAD' ? undefined : body);
    log(req, status, body.length, started);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
  }

  let urlPath;
  try {
    urlPath = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return send(400, 'Bad request\n');
  }

  let found;
  try {
    found = await resolveFile(urlPath);
  } catch {
    found = null;
  }
  if (!found) return send(404, 'Not found\n');

  const type = MIME[path.extname(found.file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': found.size,
    // no-cache on everything, not just sw.js / index.html / version.json: the files are
    // tiny and unhashed, so a plain browser tab must never mix two versions.
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (req.method === 'HEAD') {
    res.end();
    return log(req, 200, 0, started);
  }
  createReadStream(found.file)
    .on('error', () => res.destroy())
    .on('end', () => log(req, 200, found.size, started))
    .pipe(res);
}

export function createServer() {
  return http.createServer(handle);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await stat(path.join(DIST, 'index.html')).catch(() => null);
  if (!s) {
    console.error('dist/ is empty. Run `npm run build` first.');
    process.exit(1);
  }
  const server = createServer();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is another server running?`);
    else console.error(err);
    process.exit(1);
  });
  server.listen(PORT, HOST, () => {
    console.log(`Serving dist/ on http://${HOST}:${PORT}  (Ctrl-C to stop)`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
