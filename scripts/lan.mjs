// npm run lan: build, then serve dist/ over HTTPS to phones on the same Wi-Fi, for testing
// without deploying. Node built-ins plus the system `openssl`.
//
// Service workers need a secure context, and on a phone http://<mac>:8080 isn't one, so this
// serves https://<mac>.local:8443 with a certificate from a local CA kept in .lan/ (gitignored).
// Each phone trusts that CA once: the setup page on http://<mac>.local:8081 hands it out and
// says how. The CA may only sign .local names, localhost and private IPs (name constraints), so
// its key on this Mac can't be used to impersonate real sites.
//
// The test install is its own origin, separate from https://cache-only.github.io: its saves
// and downloads never touch the real app's.
//
//   npm run lan                # build, then serve
//   npm run lan -- --no-build  # serve the current dist/
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERTS = path.join(ROOT, '.lan');
const PORT = Number(process.env.PORT) || 8443;
const SETUP_PORT = Number(process.env.SETUP_PORT) || 8081;
const CA_NAME = 'Cache Only dev CA';
const CA_FILE = 'cache-only-dev-ca.crt';

function hostName() {
  let name = os.hostname().replace(/\.local$/i, '');
  if (process.platform === 'darwin') {
    try {
      name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim() || name;
    } catch {}
  }
  return `${name.toLowerCase()}.local`;
}

// Private Wi-Fi/Ethernet addresses only: the CA may not sign anything else, and VPN
// interfaces (100.x and the like) aren't reachable from a phone on the same Wi-Fi anyway.
const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && isPrivate(a.address))
    .map((a) => a.address);
}

function openssl(args) {
  const r = spawnSync('openssl', args, { cwd: CERTS, encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') throw new Error('`openssl` was not found on PATH.');
  if (r.status !== 0) throw new Error(`openssl ${args[0]} failed:\n${r.stderr}`);
  return r.stdout;
}

const serial = () => '0x' + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

// The CA is made once. Re-making it means trusting it again on every phone.
function ensureCA() {
  if (existsSync(path.join(CERTS, 'ca.key')) && existsSync(path.join(CERTS, CA_FILE))) return false;
  writeFileSync(path.join(CERTS, 'ca.ext'), [
    'basicConstraints = critical, CA:TRUE, pathlen:0',
    'keyUsage = critical, keyCertSign, cRLSign',
    'subjectKeyIdentifier = hash',
    'nameConstraints = critical, permitted;DNS:local, permitted;DNS:localhost, ' +
      'permitted;IP:10.0.0.0/255.0.0.0, permitted;IP:172.16.0.0/255.240.0.0, ' +
      'permitted;IP:192.168.0.0/255.255.0.0, permitted;IP:127.0.0.0/255.0.0.0',
    '',
  ].join('\n'));
  openssl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', 'ca.key']);
  openssl(['req', '-new', '-key', 'ca.key', '-subj', `/CN=${CA_NAME} (${os.hostname()})`, '-out', 'ca.csr']);
  openssl(['x509', '-req', '-in', 'ca.csr', '-signkey', 'ca.key', '-days', '3650', '-set_serial', serial(),
    '-extfile', 'ca.ext', '-out', CA_FILE]);
  return true;
}

// The server certificate is re-issued whenever the names change (a new IP on another network)
// or it nears expiry. Phones that trust the CA accept the new one without doing anything.
function ensureServerCert(names, ips) {
  const sans = [...names.map((n) => `DNS:${n}`), ...ips.map((ip) => `IP:${ip}`)].join(', ');
  const crt = path.join(CERTS, 'server.crt');
  const current = existsSync(crt) && existsSync(path.join(CERTS, 'server.sans'))
    && readFileSync(path.join(CERTS, 'server.sans'), 'utf8') === sans;
  const fresh = current && spawnSync('openssl', ['x509', '-checkend', String(30 * 86400), '-noout', '-in', crt]).status === 0;
  if (fresh) return;
  writeFileSync(path.join(CERTS, 'server.ext'), [
    'basicConstraints = critical, CA:FALSE',
    'keyUsage = critical, digitalSignature',
    'extendedKeyUsage = serverAuth',
    'subjectKeyIdentifier = hash',
    'authorityKeyIdentifier = keyid',
    `subjectAltName = ${sans}`,
    '',
  ].join('\n'));
  openssl(['genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', 'server.key']);
  openssl(['req', '-new', '-key', 'server.key', '-subj', `/CN=${names[0]}`, '-out', 'server.csr']);
  // Apple rejects server certificates valid for more than 825 days; 397 is safe everywhere.
  openssl(['x509', '-req', '-in', 'server.csr', '-CA', CA_FILE, '-CAkey', 'ca.key', '-days', '397',
    '-set_serial', serial(), '-extfile', 'server.ext', '-out', 'server.crt']);
  writeFileSync(path.join(CERTS, 'server.sans'), sans);
}

function setupPage(appUrl) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cache Only: test on this network</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 17px/1.5 -apple-system, system-ui, sans-serif; margin: 0 auto; max-width: 34rem; padding: 24px 16px 48px; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 2rem; }
  a.button { display: inline-block; padding: 12px 18px; border: 2px solid currentColor; border-radius: 6px; font-weight: 600; text-decoration: none; }
  code { overflow-wrap: anywhere; }
</style></head><body>
<h1>Cache Only, from this Mac</h1>
<p>The app is at <a href="${appUrl}"><code>${appUrl}</code></a>. Before a phone can open it, it has to trust this Mac's
test certificate. Do this once per phone.</p>
<h2>iPhone (in Safari)</h2>
<ol>
  <li><a class="button" href="/${CA_FILE}">Download certificate</a> and tap Allow.</li>
  <li>Settings → General → VPN &amp; Device Management → <b>${CA_NAME}</b> → Install.</li>
  <li>Settings → General → About → Certificate Trust Settings → switch on <b>${CA_NAME}</b>.</li>
  <li>Open <a href="${appUrl}"><code>${appUrl}</code></a> in Safari, tap Share, then Add to Home Screen.</li>
</ol>
<h2>Android</h2>
<ol>
  <li><a class="button" href="/${CA_FILE}">Download certificate</a>.</li>
  <li>Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate, and pick it.</li>
  <li>Open <a href="${appUrl}"><code>${appUrl}</code></a> in Chrome and install the app.</li>
</ol>
<p>To remove it later: delete the profile under VPN &amp; Device Management (iPhone) or the CA under
Trusted credentials → User (Android).</p>
</body></html>
`;
}

function setupServer(appUrl) {
  const page = setupPage(appUrl);
  const ca = readFileSync(path.join(CERTS, CA_FILE));
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost').pathname;
    if (url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(page);
    }
    if (url === `/${CA_FILE}`) {
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': `attachment; filename="${CA_FILE}"`,
        'Cache-Control': 'no-cache',
      });
      console.log(`Certificate downloaded by ${req.socket.remoteAddress}`);
      return res.end(ca);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found\n');
  });
}

function listen(server, port, label) {
  return new Promise((resolve) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') console.error(`Port ${port} (${label}) is already in use. Is another server running?`);
      else console.error(err);
      process.exit(1);
    });
    server.listen(port, '0.0.0.0', resolve);
  });
}

if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(path.join(ROOT, 'dist/index.html'))) {
  console.error('dist/ is empty. Run `npm run build` first.');
  process.exit(1);
}

const host = hostName();
const ips = lanAddresses();
if (!ips.length) console.warn('No network address found. Is Wi-Fi on?');

mkdirSync(CERTS, { recursive: true });
let newCA;
try {
  newCA = ensureCA();
  ensureServerCert([host, 'localhost'], [...ips, '127.0.0.1']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const appUrl = PORT === 443 ? `https://${host}/` : `https://${host}:${PORT}/`;
const setupUrl = `http://${host}:${SETUP_PORT}/`;
const app = https.createServer({
  key: readFileSync(path.join(CERTS, 'server.key')),
  cert: readFileSync(path.join(CERTS, 'server.crt')),
}, handle);
// A phone that doesn't trust the CA never gets as far as a request, so say so here.
app.on('connection', (raw) => raw.remoteAddress); // read now: Node caches it for after the socket closes
app.on('tlsClientError', (err, socket) => {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const hint = /unknown ca|bad certificate|certificate unknown/i.test(err.message)
    ? '  (the device does not trust the CA: see the setup page, step 3)' : '';
  console.log(`${time}  TLS failed from ${socket._parent?.remoteAddress ?? socket.remoteAddress ?? '?'}: ${err.code || err.message}${hint}`);
});
const setup = setupServer(appUrl);
await Promise.all([listen(app, PORT, 'app'), listen(setup, SETUP_PORT, 'setup')]);

console.log(`
  App     ${appUrl}
  Setup   ${setupUrl}   (first time on a phone: open this in Safari)
${ips.map((ip) => `          also https://${ip}:${PORT}/ (a different origin; changes with the network)\n`).join('')}
  The phone must be on the same Wi-Fi. If macOS asks whether node may accept incoming
  connections, allow it.${newCA ? '\n\n  New CA created in .lan/: every phone has to trust it again (see the setup page).' : ''}
  Rebuild with \`npm run build\` in another terminal; the server picks up dist/ as it is.
  Ctrl-C stops it.
`);

const stop = () => {
  app.close();
  setup.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
