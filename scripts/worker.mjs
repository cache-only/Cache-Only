// Deploys the rooms Worker (worker/rooms.js) to Cloudflare as cache-only-rooms, through
// Cloudflare's API with Node built-ins only: no wrangler and no npm install. It needs
// CLOUDFLARE_API_TOKEN (an account token with Workers Scripts: Edit) and CLOUDFLARE_ACCOUNT_ID in
// the environment, kept in ~/.zshrc and never in the repo (KTAN.md, A11).
//
//   npm run worker            deploy, then play a short game of messages against it
//   npm run worker --check    only check: the token, the subdomain, what is deployed, a short game
//
// The Pages workflow never runs this: the Worker is deployed by hand, and the app finds it at
// ROOMS in src/shared/star.js.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Star from '../src/shared/star.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
const NAME = 'cache-only-rooms';
const SUBDOMAIN = 'cache-only'; // claimed only if the account has none
const COMPATIBILITY_DATE = '2026-01-01';
// The Durable Object classes, each added by one migration, in order. A deployed step is never
// edited: a change is a new step.
const MIGRATIONS = [
  { tag: 'v1', new_sqlite_classes: ['Room'] },
  { tag: 'v2', new_sqlite_classes: ['Net'] },
];
const ORIGIN = 'https://cache-only.github.io'; // the smoke test connects as the app does

const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
// npm keeps `npm run worker --check` for itself and hands it over as npm_config_check.
const CHECK_ONLY = process.argv.includes('--check') || process.env.npm_config_check === 'true';

if (!TOKEN || !ACCOUNT) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first (KTAN.md, A11).');
  process.exit(1);
}

class ApiError extends Error {
  constructor(what, status, errors = []) {
    super(`${what}: HTTP ${status}${errors.length ? ` (${errors.map((e) => `${e.code} ${e.message}`).join('; ')})` : ''}`);
    this.codes = errors.map((e) => e.code);
  }
}

async function cf(method, route, body, headers = {}) {
  const res = await fetch(`${API}/accounts/${ACCOUNT}${route}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, ...headers },
    body,
  });
  const json = await res.json().catch(() => null);
  if (!json?.success) throw new ApiError(`${method} ${route}`, res.status, json?.errors);
  return json.result;
}

const json = (value) => [JSON.stringify(value), { 'content-type': 'application/json' }];

async function subdomain() {
  try {
    return (await cf('GET', '/workers/subdomain')).subdomain;
  } catch (err) {
    if (!err.codes?.includes(10007) || CHECK_ONLY) throw err; // 10007: the account has none yet
    console.log(`  The account has no workers.dev subdomain yet: claiming ${SUBDOMAIN}.`);
    return (await cf('PUT', '/workers/subdomain', ...json({ subdomain: SUBDOMAIN }))).subdomain;
  }
}

async function deploy(script) {
  const code = await readFile(path.join(ROOT, 'worker/rooms.js'), 'utf8');
  const metadata = {
    main_module: 'rooms.js',
    compatibility_date: COMPATIBILITY_DATE,
    bindings: [
      { type: 'durable_object_namespace', name: 'ROOMS', class_name: 'Room' },
      { type: 'durable_object_namespace', name: 'NETS', class_name: 'Net' },
    ],
    observability: { enabled: true },
  };
  // Each class is created once: send only the steps after the one already deployed.
  const tag = script?.migration_tag;
  const done = tag ? MIGRATIONS.findIndex((m) => m.tag === tag) : -1;
  if (tag && done < 0) throw new Error(`The deployed migration ${tag} isn't in MIGRATIONS.`);
  const pending = MIGRATIONS.slice(done + 1);
  if (pending.length) {
    metadata.migrations = { new_tag: pending.at(-1).tag, steps: pending.map(({ tag: _, ...step }) => step) };
    if (tag) metadata.migrations.old_tag = tag;
  }
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('rooms.js', new Blob([code], { type: 'application/javascript+module' }), 'rooms.js');
  await cf('PUT', `/workers/scripts/${NAME}`, form);
  await cf('POST', `/workers/scripts/${NAME}/subdomain`, ...json({ enabled: true, previews_enabled: false }));
  console.log(`  Uploaded worker/rooms.js (${(code.length / 1024).toFixed(1)} KB).`);
}

/** Waits for the Worker to answer: a new workers.dev name can take a minute to reach everywhere. */
async function answers(base) {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${base}/`, { cache: 'no-store' });
      if (res.ok && (await res.text()).startsWith('Cache Only rooms')) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * A host and a member, through the real Worker: create, find the room nearby, knock, be let in,
 * a message each way, end.
 */
async function smoke(base) {
  const url = base.replace(/^https/, 'wss');
  class AppSocket extends WebSocket {
    constructor(to) {
      super(to, { headers: { origin: ORIGIN } });
    }
  }
  const appFetch = (to, init = {}) => fetch(to, { ...init, headers: { origin: ORIGIN } });
  const opts = { game: 'test', url, WebSocket: AppSocket };
  const started = performance.now();
  const host = await Star.create({ ...opts, name: 'Deploy host' });
  const near = await Star.nearby({ game: 'test', url, fetch: appFetch });
  if (!near.some((r) => r.code === host.code)) throw new Error(`room ${host.code} isn't listed nearby`);
  const member = await Star.join(host.code, { ...opts, name: 'Deploy member' });
  if (member.admitted) throw new Error('a new seat got in without being let in');
  const admitted = new Promise((resolve) => member.on('admitted', resolve));
  host.admit(member.seat);
  await admitted;
  const heard = (room) => new Promise((resolve) => room.on('message', (from, msg) => resolve({ from, msg })));
  const atHost = heard(host);
  member.send('ping from the member');
  const fromMember = await atHost;
  const atMember = heard(member);
  host.broadcast('ping from the host');
  const fromHost = await atMember;
  const ms = Math.round(performance.now() - started);
  host.end();
  member.close();
  if (fromMember.msg !== 'ping from the member' || fromHost.msg !== 'ping from the host') throw new Error('messages came back wrong');
  console.log(`  Room ${host.code}: created, found nearby, knocked, let in, a message each way and ended in ${ms} ms.`);
}

try {
  const token = await cf('GET', '/tokens/verify');
  console.log(`Token ${token.status}.`);
  const sub = await subdomain();
  const base = `https://${NAME}.${sub}.workers.dev`;
  console.log(`Worker address: ${base}`);
  const scripts = await cf('GET', '/workers/scripts');
  const script = scripts.find((s) => s.id === NAME);
  console.log(script ? `Deployed ${script.modified_on}, migration ${script.migration_tag ?? 'none'}.` : 'Not deployed yet.');

  if (!CHECK_ONLY) {
    console.log('Deploying…');
    await deploy(script);
  }
  if (!script && CHECK_ONLY) process.exit(0);
  if (!(await answers(base))) throw new Error(`${base} doesn't answer yet. Try \`npm run worker --check\` in a minute.`);
  console.log(`  ${base}/ answers.`);
  await smoke(base);
  console.log('Done.');
  process.exit(0);
} catch (err) {
  console.error(`Failed: ${err.message}`);
  process.exit(1);
}
