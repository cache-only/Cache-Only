// TEMPORARY, for the Nearby test (src/games/nearby/). Passes connection details between the
// devices that open that page until they link up directly (their traffic never comes through
// here), and prints what each device reports, so a test can be read from this terminal.
// Delete it with src/games/nearby/ and its registry entry once the experiment is over.
//
//   node scripts/nearby-relay.mjs
//
// Phones reach it at https://<mac>.local:8444 with the certificate `npm run lan` keeps in .lan/
// (run that too: it serves the page), and this Mac's browser at http://127.0.0.1:8082.
// It runs beside `npm run lan` and never touches it. It also serves dist/ itself, so the page can
// be opened at an IP address: NEARBY_CERTS=<dir> takes server.key/server.crt from another folder
// (a certificate from the same CA that names that IP).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle as serveFile } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERTS = process.env.NEARBY_CERTS || path.join(ROOT, '.lan');
const PORT = 8444;
const LOCAL_PORT = 8082;
const GONE_MS = 4000; // a device that hasn't polled for this long has left
const INBOX_MAX = 50;

const peers = new Map(); // id -> { name, ip, seen, inbox: [{ from, msg }] }

const time = () => new Date().toLocaleTimeString('en-GB', { hour12: false });
const say = (line) => console.log(`${time()}  ${line}`);
const ipOf = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

setInterval(() => {
  const now = Date.now();
  for (const [id, p] of peers) {
    if (now - p.seen > GONE_MS) {
      peers.delete(id);
      say(`- ${p.name} left`);
    }
  }
}, 1000).unref();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error('too big'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const send = (status, body) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  if (req.method === 'OPTIONS') return send(204);
  const route = new URL(req.url, 'http://localhost').pathname;
  // Open this in a phone's browser to check it trusts the certificate.
  if (req.method === 'GET' && route === '/relay') {
    return send(200, { relay: 'nearby', devices: [...peers.values()].map((p) => p.name) });
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveFile(req, res);
  if (req.method !== 'POST') return send(405, { error: 'POST only' });

  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(400, { error: 'bad body' });
  }
  const id = typeof body.id === 'string' ? body.id.slice(0, 32) : '';
  if (!id) return send(400, { error: 'no id' });

  if (route === '/poll') {
    let p = peers.get(id);
    if (!p) {
      p = { name: String(body.name || id).slice(0, 60), ip: ipOf(req), seen: 0, inbox: [] };
      peers.set(id, p);
      say(`+ ${p.name} joined from ${p.ip}`);
    }
    p.seen = Date.now();
    p.ip = ipOf(req);
    p.lead = body.lead === true;
    for (const line of Array.isArray(body.log) ? body.log.slice(0, 200) : []) {
      say(`  ${p.name}: ${String(line).slice(0, 600)}`);
    }
    const inbox = p.inbox;
    p.inbox = [];
    const others = [...peers].filter(([k]) => k !== id).map(([k, q]) => ({ id: k, name: q.name, ip: q.ip, lead: q.lead }));
    return send(200, { you: p.ip, peers: others, inbox });
  }
  if (route === '/send') {
    const to = peers.get(String(body.to));
    if (!to) return send(404, { error: 'no such device' });
    if (to.inbox.length >= INBOX_MAX) to.inbox.shift();
    to.inbox.push({ from: id, msg: body.msg });
    say(`  ${peers.get(id)?.name ?? id} -> ${to.name}: ${body.msg?.type}`);
    return send(200, { ok: true });
  }
  if (route === '/leave') {
    const p = peers.get(id);
    if (p) {
      peers.delete(id);
      say(`- ${p.name} left (closed the page)`);
    }
    return send(200, { ok: true });
  }
  send(404, { error: 'not found' });
}

function hostName() {
  let name = os.hostname().replace(/\.local$/i, '');
  if (process.platform === 'darwin') {
    try {
      name = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim() || name;
    } catch {}
  }
  return `${name.toLowerCase()}.local`;
}

function listen(server, port, host) {
  return new Promise((resolve) => {
    server.on('error', (err) => {
      console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the relay running already?` : err);
      process.exit(1);
    });
    server.listen(port, host, resolve);
  });
}

if (!existsSync(path.join(CERTS, 'server.key'))) {
  console.error('No certificate in .lan/ yet. Run `npm run lan` once first.');
  process.exit(1);
}
const secure = https.createServer({
  key: readFileSync(path.join(CERTS, 'server.key')),
  cert: readFileSync(path.join(CERTS, 'server.crt')),
}, handle);
const local = http.createServer(handle);
await Promise.all([listen(secure, PORT, '0.0.0.0'), listen(local, LOCAL_PORT, '127.0.0.1')]);

console.log(`
  Nearby relay (temporary)
  Phones   https://${hostName()}:${PORT}/
  Local    http://127.0.0.1:${LOCAL_PORT}/
  Ctrl-C stops it. Devices already linked stay linked.
`);

const stop = () => {
  secure.close();
  local.close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
