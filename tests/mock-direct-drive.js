const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const folderMime = 'application/vnd.google-apps.folder';
const findBytes = (bytes, text, from = 0) => {
  const target = encoder.encode(text);
  outer: for (let i = from; i <= bytes.length - target.length; i++) {
    for (let j = 0; j < target.length; j++) if (bytes[i + j] !== target[j]) continue outer;
    return i;
  }
  return -1;
};
export class MockDirectDrive {
  constructor() {
    this.items = new Map();
    this.serial = 0;
    this.calls = [];
    this.race = null;
    this.loseResponse = false;
  }
  async fetch(url, options = {}) {
    const target = new URL(url),
      headers = new Headers(options.headers),
      method = options.method || 'GET';
    const accountId = (headers.get('Authorization') || '').replace('Bearer ', '');
    this.calls.push({ method, path: target.pathname, query: target.search });
    const json = (value, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    const meta = (file) => ({
      ...file,
      bytes: undefined,
      etag: `"v${file.revision}"`,
      version: String(file.revision),
      ownedByMe: file.owner === accountId,
    });
    if (!accountId) return json({}, 401);
    if (target.pathname.endsWith('/about'))
      return json({
        user: {
          permissionId: accountId,
          emailAddress: `${accountId}@example.test`,
          displayName: accountId,
        },
      });
    if (target.pathname.endsWith('/generateIds')) return json({ ids: [`file_${++this.serial}`] });
    const match = target.pathname.match(/\/files\/([^/]+)$/);
    if (match) {
      const file = this.items.get(match[1]);
      if (!file || file.owner !== accountId) return json({}, 404);
      if (method === 'PATCH') {
        const remove = new Set((target.searchParams.get('removeParents') || '').split(','));
        const add = target.searchParams.get('addParents');
        file.parents = [
          ...new Set([
            ...(file.parents || []).filter((id) => !remove.has(id)),
            ...(add ? [add] : []),
          ]),
        ];
        file.revision++;
        return json(meta(file));
      }
      if (method === 'PUT') {
        if (this.race) {
          const action = this.race;
          this.race = null;
          await action(file);
        }
        if (headers.get('If-Match') !== `"v${file.revision}"`) return json({}, 412);
        file.bytes = new Uint8Array(await options.body.arrayBuffer());
        file.revision++;
        if (this.loseResponse) {
          this.loseResponse = false;
          throw new Error('Simulated lost response');
        }
        return json(meta(file));
      }
      if (target.searchParams.get('alt') === 'media') return new Response(file.bytes);
      return json(meta(file));
    }
    if (method === 'GET') {
      const q = target.searchParams.get('q') || '',
        parent = q.match(/^'([^']+)' in parents/);
      let files = [...this.items.values()].filter((f) => f.owner === accountId && !f.trashed);
      files = parent
        ? files.filter((f) => f.parents?.includes(parent[1]))
        : files.filter(
            (f) => f.mimeType === folderMime && f.appProperties?.pkm_format === 'direct-v1',
          );
      return json({ files: files.map(meta) });
    }
    let metadata,
      bytes = new Uint8Array();
    if (target.pathname.startsWith('/upload/')) {
      const boundary = headers.get('Content-Type').split('boundary=')[1],
        all = new Uint8Array(await options.body.arrayBuffer());
      const start = findBytes(all, '\r\n\r\n') + 4,
        divider = findBytes(all, `\r\n--${boundary}`, start);
      metadata = JSON.parse(decoder.decode(all.slice(start, divider)));
      const content = findBytes(all, '\r\n\r\n', divider) + 4,
        end = findBytes(all, `\r\n--${boundary}--`, content);
      bytes = all.slice(content, end);
    } else metadata = JSON.parse(options.body);
    if (this.items.has(metadata.id)) return json({}, 409);
    const file = {
      ...metadata,
      id: metadata.id || `file_${++this.serial}`,
      revision: 1,
      owner: accountId,
      bytes,
      trashed: false,
    };
    this.items.set(file.id, file);
    if (this.loseResponse && file.appProperties?.pkm_role === 'record') {
      this.loseResponse = false;
      throw new Error('Simulated lost response');
    }
    return json(meta(file));
  }
}
