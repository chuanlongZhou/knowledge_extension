import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { SyncHarness } from './sync-fixture.js';

// Only the native transport is bridged for these browser regressions. The
// Companion, revision storage and Drive adapter are the production modules.
// companion-browser.mjs separately tests the real Windows native transport.
export class BrowserSyncHarness {
  constructor() {
    this.cleanups = [];
    this.cloud = new SyncHarness({ after: (fn) => this.cleanups.push(fn) });
    this.remote = this.cloud.remote;
    this.clients = new Map();
    this.secret = randomUUID();
  }
  async connect(context, worker) {
    if (!this.server) {
      this.server = createServer(async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        const key = req.url?.slice(1),
          device = this.clients.get(key);
        if (!device || req.method !== 'POST') {
          res.writeHead(404);
          res.end();
          return;
        }
        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const { command, payload } = JSON.parse(Buffer.concat(chunks));
          const { client } = await this.cloud.device(device);
          res.end(JSON.stringify({ ok: true, result: await client.call(command, payload) }));
        } catch (error) {
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
      });
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', resolve);
      });
    }
    const key = `${this.secret}-${this.clients.size}`;
    this.clients.set(key, context);
    const endpoint = `http://127.0.0.1:${this.server.address().port}/${key}`;
    function install(endpoint) {
      if (!globalThis.chrome?.runtime) return;
      chrome.runtime.connectNative = () => {
        const listeners = [],
          disconnect = [],
          parts = [];
        let closed = false;
        return {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          onDisconnect: { addListener: (fn) => disconnect.push(fn) },
          disconnect() {
            closed = true;
            disconnect.forEach((fn) => fn());
          },
          postMessage(frame) {
            parts.push(frame.data);
            if (parts.length !== frame.total) return;
            const body = parts.join('');
            parts.length = 0;
            fetch(endpoint, { method: 'POST', body })
              .then((response) => response.text())
              .then((text) => {
                const total = Math.ceil(text.length / (48 * 1024));
                for (let index = 0; !closed && index < total; index++)
                  listeners.forEach((fn) =>
                    fn({
                      type: 'response',
                      id: frame.id,
                      index,
                      total,
                      data: text.slice(index * 48 * 1024, (index + 1) * 48 * 1024),
                    }),
                  );
              })
              .catch(() => {
                if (!closed) disconnect.forEach((fn) => fn());
              });
          },
        };
      };
    }
    await context.addInitScript(install, endpoint);
    await worker.evaluate(install, endpoint);
  }
  async chooseVersion(context, content) {
    const { service } = await this.cloud.device(context);
    const item = service.vault.list({ view: 'conflicts' }).items[0];
    const versions = await service.handle('records.conflicts', { id: item.id });
    const chosen = versions.find((v) => v.record.content === content);
    if (!chosen) throw new Error('Requested conflict version missing');
    return service.handle('records.resolve', {
      record: chosen.record,
      parents: service.vault.heads(item.id),
    });
  }
  async close() {
    if (this.server) await new Promise((resolve) => this.server.close(resolve));
    for (const fn of this.cleanups) await fn();
  }
}

export async function enableLocal(page) {
  await page.locator('#settings').click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: '连接并启用本地资料库', exact: true }).click();
  await dialog.getByText(/已连接：交接/).waitFor();
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
}
