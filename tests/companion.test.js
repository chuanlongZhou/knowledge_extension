import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createHash } from 'node:crypto';
import { setSchedule, desktopExecutable } from '../companion/windows.mjs';
import { platformCall } from '../companion/platform.mjs';
import { Vault } from '../companion/vault.mjs';
import { Settings } from '../companion/settings.mjs';
import { SecretStore } from '../companion/secrets.mjs';
import { GoogleAuth, DRIVE_SCOPE } from '../companion/oauth.mjs';
import { googleClient } from '../companion/google-client.mjs';
import { Service } from '../companion/service.mjs';
import { nativeHost } from '../companion/native.mjs';
import { managementServer } from '../companion/server.mjs';
import { newRecord } from '../extension/lib/model.js';
import { Database } from '../extension/lib/db.js';
import { handoffCompanion } from '../extension/lib/companion.js';
const output = path.resolve('test-results');
const resources = new Map();
test(
  'Windows hourly schedule is user-owned, runs without Chrome and is removable',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const settings = new Settings(await root(t)),
      taskName = `PKM Nexus Validation ${crypto.randomUUID()}`;
    try {
      await setSchedule(settings, true, { taskName });
      const definition = platformCall('schedule.get', { taskName });
      assert.equal(definition.execute.toLowerCase(), desktopExecutable().toLowerCase());
      assert.equal(definition.arguments, '--sync --scheduled');
      assert.equal(definition.triggers, 2);
      assert.ok(definition.intervals.includes('PT1H'));
      assert.equal(definition.catchUp, true);
      assert.equal(definition.runLevel, 'Limited');
      assert.equal((await settings.read()).autoSync, true);
    } finally {
      await setSchedule(settings, false, { taskName });
    }
    assert.equal((await settings.read()).autoSync, false);
  },
);
class MemorySecrets {
  constructor() {
    this.value = {};
  }
  async read() {
    return structuredClone(this.value);
  }
  async write(value) {
    this.value = structuredClone(value);
  }
}
async function root(t) {
  await mkdir(output, { recursive: true });
  const dir = await mkdtemp(path.join(output, 'companion-test-'));
  resources.set(dir, []);
  t.after(async () => {
    for (const resource of resources.get(dir)) await resource.close();
    resources.delete(dir);
    if (!dir.startsWith(output + path.sep)) throw new Error('Unexpected cleanup');
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  return dir;
}
async function vault(t) {
  const dir = await root(t),
    v = await new Vault(dir).open();
  resources.get(dir).push(v);
  return v;
}
async function service(t) {
  const dir = await root(t),
    settings = new Settings(dir),
    auth = { status: async () => ({ configured: false, connected: false }), cancel() {} };
  const s = await new Service({ settings, auth }).open();
  resources.get(dir).push(s);
  return s;
}
test('disconnect removes only integration and scheduling while retaining the library', async (t) => {
  const s = await service(t),
    events = [],
    note = newRecord({ title: 'Keep my knowledge' });
  await s.vault.put(note);
  s.windows = {
    async setSchedule(settings, enabled) {
      events.push('schedule');
      assert.equal(enabled, false);
      await settings.update({ autoSync: false });
    },
    async removeNativeRegistration(settings) {
      events.push('native');
      await settings.update({ allowedOrigins: [] });
    },
  };
  await s.settings.update({
    autoSync: true,
    allowedOrigins: [`chrome-extension://${'a'.repeat(32)}/`],
  });
  assert.deepEqual(await s.handle('system.disconnect'), { disconnected: true });
  assert.deepEqual(events, ['schedule', 'native']);
  assert.equal((await s.settings.read()).autoSync, false);
  assert.deepEqual((await s.settings.read()).allowedOrigins, []);
  assert.equal(s.vault.get(note.id).record.title, note.title);
});
test('vault persists readable data, stable IDs and metadata-only pagination', async (t) => {
  const v = await vault(t);
  for (let i = 0; i < 35; i++)
    await v.put(newRecord({ title: `Note ${i}`, content: `Body-only keyword ${i}` }));
  const page = v.list({ limit: 10 });
  assert.equal(page.items.length, 10);
  assert.equal(page.total, 35);
  assert.equal(page.hasMore, true);
  assert.equal(page.items[0].content, undefined);
  assert.equal(v.list({ query: 'keyword 17' }).total, 1);
  const id = page.items[0].id,
    record = v.get(id).record;
  assert.deepEqual(
    JSON.parse(await readFile(path.join(v.root, 'records', id.slice(0, 2), `${id}.json`), 'utf8')),
    record,
  );
  assert.match(await readFile(path.join(v.root, 'readable', `${id}.md`), 'utf8'), /Body-only/);
});
test('revision graph converges with descendants arriving before ancestors and resolves deletion conflicts', async (t) => {
  const a = await vault(t),
    b = await vault(t),
    note = newRecord({ title: 'Graph' }),
    base = await a.put(note),
    next = await a.put({ ...note, content: 'next' }, { parentRevision: base.revision });
  await b.apply(a.envelope(next.revision), { uploaded: true });
  await b.apply(a.envelope(base.revision), { uploaded: true });
  assert.deepEqual(b.heads(note.id), [next.revision]);
  const removed = await a.put(
    { ...note, deleted_at: new Date().toISOString() },
    { parentRevision: base.revision },
  );
  await b.apply(a.envelope(removed.acceptedRevision), { uploaded: true });
  assert.equal(b.heads(note.id).length, 2);
  await b.put({ ...note, content: 'resolved' }, { resolveParents: b.heads(note.id) });
  assert.equal(b.heads(note.id).length, 1);
});
test('crash journal restores materialized files and index can rebuild without content loss', async (t) => {
  const v = await vault(t),
    note = newRecord({ title: 'Recovery' }),
    saved = await v.put(note),
    envelope = v.envelope(saved.revision);
  await writeFile(
    path.join(v.root, '.nexus/journal', `${saved.revision}.json`),
    JSON.stringify({ envelope, uploaded: false }),
  );
  await unlink(path.join(v.root, 'records', note.id.slice(0, 2), `${note.id}.json`));
  v.close();
  await v.open();
  assert.equal(v.get(note.id).record.title, 'Recovery');
  assert.ok(await readFile(path.join(v.root, 'records', note.id.slice(0, 2), `${note.id}.json`)));
  v.close();
  await unlink(path.join(v.root, '.nexus/index.sqlite'));
  await v.open();
  assert.equal(v.get(note.id).record.title, 'Recovery');
});
test('external JSON edits are validated and derived Markdown never becomes another authority', async (t) => {
  const v = await vault(t),
    note = newRecord({ title: 'External', content: 'before' });
  await v.put(note);
  const file = path.join(v.root, 'records', note.id.slice(0, 2), `${note.id}.json`);
  await writeFile(file, JSON.stringify({ ...note, content: 'after' }));
  assert.equal(await v.externalEdits(), 1);
  assert.equal(v.get(note.id).record.content, 'after');
  await writeFile(file, JSON.stringify({ ...note, id: '../escape' }));
  await assert.rejects(v.externalEdits(), /ID|版本/);
});
test('browser handoff preserves local edits and exposes stale-copy conflicts using explicit parent revisions', async (t) => {
  const s = await service(t),
    db = new Database(`bridge-${crypto.randomUUID()}`, { broadcast: false });
  t.after(() => db.close());
  const client = () => ({ call: (command, payload) => s.handle(command, payload), close() {} }),
    note = newRecord({ title: 'Browser', content: 'base' });
  await db.save(note);
  await handoffCompanion(db, { client: client(), locks: null });
  const base = s.vault.get(note.id);
  await s.vault.put({ ...note, content: 'desktop' }, { parentRevision: base.revision });
  await handoffCompanion(db, { client: client(), locks: null });
  assert.equal((await db.get(note.id)).record.content, 'desktop');
  assert.equal(await db.getState('repoKey'), null);
  const desktop = s.vault.get(note.id);
  await s.vault.put({ ...note, content: 'new desktop' }, { parentRevision: desktop.revision });
  await db.mutate(note.id, (r) => ({ ...r, content: 'offline browser' }));
  const result = await handoffCompanion(db, { client: client(), locks: null });
  assert.equal(result.conflicts, 1);
  assert.equal((await db.get(note.id)).record.content, 'offline browser');
  assert.equal(s.vault.heads(note.id).length, 2);
});
test('native protocol chunks large responses and rejects unknown origin and privileged commands', async (t) => {
  const s = await service(t),
    origin = `chrome-extension://${'a'.repeat(32)}/`;
  await s.settings.update({ allowedOrigins: [origin] });
  const note = newRecord({ content: '资料'.repeat(200000) });
  await s.vault.put(note);
  const input = new PassThrough(),
    outputStream = new PassThrough(),
    chunks = [];
  outputStream.on('data', (c) => chunks.push(c));
  const running = nativeHost(s, { input, output: outputStream, origin });
  const request = JSON.stringify({ command: 'records.get', payload: { id: note.id } }),
    frame = Buffer.from(
      JSON.stringify({ type: 'request', id: 'test', index: 0, total: 1, data: request }),
    ),
    header = Buffer.alloc(4);
  header.writeUInt32LE(frame.length);
  input.write(header.subarray(0, 2));
  input.write(Buffer.concat([header.subarray(2), frame]));
  input.end();
  await running;
  let bytes = Buffer.concat(chunks),
    parts = [];
  while (bytes.length) {
    const n = bytes.readUInt32LE(0);
    assert.ok(n < 1024 * 1024);
    parts.push(JSON.parse(bytes.subarray(4, 4 + n).toString()).data);
    bytes = bytes.subarray(4 + n);
  }
  assert.ok(parts.length > 1);
  assert.equal(JSON.parse(parts.join('')).result.record.content, note.content);
  for (const command of [
    'system.disconnect',
    'native.register',
    'schedule.set',
    'google.configure',
  ]) {
    const privilegedInput = new PassThrough(),
      privilegedOutput = new PassThrough(),
      replies = [];
    privilegedOutput.on('data', (chunk) => replies.push(chunk));
    const task = nativeHost(s, { input: privilegedInput, output: privilegedOutput, origin });
    const body = Buffer.from(
      JSON.stringify({
        type: 'request',
        id: 'denied',
        index: 0,
        total: 1,
        data: JSON.stringify({ command, payload: {} }),
      }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(body.length);
    privilegedInput.end(Buffer.concat([prefix, body]));
    await task;
    const response = JSON.parse(Buffer.concat(replies).subarray(4).toString());
    const result = JSON.parse(response.data);
    assert.equal(result.ok, false);
    assert.match(result.error, /only available in the companion management window/);
  }
  await assert.rejects(
    nativeHost(s, {
      input: new PassThrough(),
      output: outputStream,
      origin: 'chrome-extension://unregistered/',
    }),
    /not registered/,
  );
});
test('management API requires a one-time bootstrap, HttpOnly session and matching Origin', async (t) => {
  const s = await service(t),
    ui = await managementServer(s);
  t.after(() => ui.close());
  const u = new URL(ui.url),
    origin = u.origin,
    bootstrap = u.hash.slice(1);
  assert.equal(
    (
      await fetch(`${origin}/api`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  const login = await fetch(`${origin}/session`, {
    method: 'POST',
    headers: { Origin: origin, 'X-PKM-Bootstrap': bootstrap },
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await fetch(`${origin}/session`, {
        method: 'POST',
        headers: { Origin: origin, 'X-PKM-Bootstrap': bootstrap },
      })
    ).status,
    403,
  );
  const response = await fetch(`${origin}/api`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'status' }),
  });
  assert.equal((await response.json()).result.google.connected, false);
  const browserSession = await fetch(`${origin}/api`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'app.browser-session', payload: { settings: true } }),
  });
  const browserUrl = new URL((await browserSession.json()).result.url);
  assert.equal(browserUrl.searchParams.get('settings'), '1');
  assert.notEqual(browserUrl.hash.slice(1), bootstrap);
  const browserHeaders = { Origin: origin, 'X-PKM-Bootstrap': browserUrl.hash.slice(1) };
  assert.equal(
    (await fetch(`${origin}/session`, { method: 'POST', headers: browserHeaders })).status,
    200,
  );
  assert.equal(
    (await fetch(`${origin}/session`, { method: 'POST', headers: browserHeaders })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${origin}/api`, {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command: 'status' }),
      })
    ).status,
    403,
  );
});
test('desktop OAuth uses PKCE, validates state and refreshes without returning tokens to UI', async (t) => {
  const secrets = new MemorySecrets(),
    requests = [];
  const auth = new GoogleAuth(secrets, {
    fetchImpl: async (url, options) => {
      if (url.startsWith('https://www.googleapis.com/drive/v3/about'))
        return Response.json({
          user: { permissionId: 'personal-a', emailAddress: 'a@example.invalid', displayName: 'A' },
        });
      requests.push({ url, body: new URLSearchParams(options.body) });
      return Response.json({
        access_token: 'fake-access',
        expires_in: 3600,
        refresh_token: 'fake-refresh',
      });
    },
  });
  t.after(() => auth.cancel());
  await auth.configure({
    installed: {
      client_id: '123-test.apps.googleusercontent.com',
      client_secret: 'desktop-config',
    },
  });
  assert.equal(requests.length, 0);
  const { url } = await auth.begin(),
    authorization = new URL(url);
  assert.equal(authorization.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authorization.searchParams.get('prompt'), /select_account/);
  const callback = new URL(authorization.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', 'bad');
  callback.searchParams.set('code', 'fake-code');
  assert.equal((await fetch(callback)).status, 400);
  assert.equal((await auth.status()).connected, false);
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  assert.equal((await auth.status()).connected, true);
  assert.equal((await auth.status()).account.email, 'a@example.invalid');
  assert.equal(JSON.stringify(await auth.status()).includes('fake-refresh'), false);
  assert.equal(
    createHash('sha256').update(requests[0].body.get('code_verifier')).digest('base64url'),
    authorization.searchParams.get('code_challenge'),
  );
  auth.access = null;
  assert.equal(await auth.token(), 'fake-access');
  assert.equal(requests[1].body.get('grant_type'), 'refresh_token');
});

test('one application client signs different users into independent personal accounts without importing JSON', async (t) => {
  const client = {
      client_id: 'shared-app.apps.googleusercontent.com',
      client_secret: 'public-desktop-client',
    },
    stores = [new MemorySecrets(), new MemorySecrets()];
  const auths = stores.map(
    (secrets) =>
      new GoogleAuth(secrets, {
        loadClient: async () => client,
        fetchImpl: async (url, options) => {
          if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
            const who = new Headers(options.headers).get('authorization').endsWith('access-a')
              ? 'a'
              : 'b';
            return Response.json({
              user: { permissionId: who, emailAddress: `${who}@example.invalid` },
            });
          }
          const body = new URLSearchParams(options.body),
            who = body.get('code') || body.get('refresh_token')?.slice(-1);
          return Response.json({
            access_token: `access-${who}`,
            refresh_token: `refresh-${who}`,
            expires_in: 3600,
          });
        },
      }),
  );
  t.after(() => auths.forEach((auth) => auth.cancel()));
  for (const [index, auth] of auths.entries()) {
    assert.equal((await auth.status()).configurationSource, 'application');
    assert.equal((await auth.status()).connected, false);
    const { url } = await auth.begin(),
      authorization = new URL(url),
      callback = new URL(authorization.searchParams.get('redirect_uri'));
    assert.equal(authorization.searchParams.get('client_id'), client.client_id);
    callback.searchParams.set('state', authorization.searchParams.get('state'));
    callback.searchParams.set('code', index ? 'b' : 'a');
    assert.equal((await fetch(callback)).status, 200);
  }
  assert.equal((await auths[0].status()).account.email, 'a@example.invalid');
  assert.equal((await auths[1].status()).account.email, 'b@example.invalid');
  assert.equal((await stores[0].read()).refresh_token, 'refresh-a');
  assert.equal((await stores[1].read()).refresh_token, 'refresh-b');
  await assert.rejects(auths[0].token({ expectedAccountId: 'b' }), /账号已变化/);
  assert.equal(await auths[0].token({ expectedAccountId: 'a' }), 'access-a');
  // Another process can sign into B while this process still caches A.
  await stores[0].write(await stores[1].read());
  await assert.rejects(auths[0].token({ expectedAccountId: 'a' }), /账号已变化/);
  assert.equal(await auths[0].token({ expectedAccountId: 'b' }), 'access-b');
  // A cached access token must not survive another process disconnecting.
  await stores[0].write({ client });
  await assert.rejects(auths[0].token(), /先连接/);
  assert.equal(await auths[1].token(), 'access-b');
});

test('application OAuth packaging rejects user tokens, service accounts and web clients', () => {
  const client_id = 'app.apps.googleusercontent.com';
  assert.throws(() => googleClient({ client_id, refresh_token: 'private-user-token' }), /用户令牌/);
  assert.throws(
    () => googleClient({ installed: { client_id, access_token: 'private-user-token' } }),
    /用户令牌/,
  );
  assert.throws(
    () => googleClient({ type: 'service_account', private_key: 'private-key' }),
    /服务账号/,
  );
  assert.throws(() => googleClient({ web: { client_id } }), /桌面应用/);
});
test(
  'Windows credentials are DPAPI encrypted outside the vault',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = await root(t),
      secrets = new SecretStore(dir);
    await secrets.write({ refresh_token: 'fake-secret-never-plaintext' });
    assert.doesNotMatch(await readFile(secrets.file, 'utf8'), /fake-secret/);
    assert.equal((await secrets.read()).refresh_token, 'fake-secret-never-plaintext');
    await secrets.clear();
    assert.deepEqual(await secrets.read(), {});
  },
);

test('unimported external edits survive incoming revisions in a recovery file', async (t) => {
  const v = await vault(t),
    note = newRecord({ title: 'External recovery', content: 'base' }),
    base = await v.put(note);
  const file = path.join(v.root, 'records', note.id.slice(0, 2), note.id + '.json');
  await writeFile(file, JSON.stringify({ ...note, content: 'LLM edit not imported yet' }));
  await v.put({ ...note, content: 'other device update' }, { parentRevision: base.revision });
  const copies = v.getState('external:recovery');
  assert.equal(copies.length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(v.root, copies[0].file), 'utf8')).content,
    'LLM edit not imported yet',
  );
  assert.equal(v.get(note.id).record.content, 'other device update');
});

test('attachment chunk reads verify the file once and release bounded cache after completion', async (t) => {
  const s = await service(t),
    bytes = Buffer.alloc(600000, 41),
    id = createHash('sha256').update(bytes).digest('hex'),
    descriptor = {
      id,
      sha256: id,
      kind: 'image',
      name: 'cached.png',
      mime_type: 'image/png',
      size_bytes: bytes.length,
      path: 'assets/' + id + '.png',
      created_at: new Date().toISOString(),
      duration_ms: null,
    };
  let reads = 0;
  s.sync.asset = async () => {
    reads++;
    return bytes;
  };
  let offset = 0;
  do {
    const chunk = await s.handle('assets.read', { descriptor, offset });
    offset = chunk.offset;
    if (chunk.done) break;
  } while (offset < bytes.length);
  assert.equal(reads, 1);
  assert.equal(s.assetReads.size, 0);
});
