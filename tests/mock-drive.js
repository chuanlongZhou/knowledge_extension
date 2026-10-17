export class MockDrive {
  constructor() {
    this.files = new Map();
    this.events = [];
    this.sessions = new Map();
    this.counter = 0;
    this.calls = [];
    this.failNext = null;
    this.loseResponse = false;
    this.account = {
      permissionId: 'mock-user',
      emailAddress: 'test@example.invalid',
      displayName: 'Test user',
    };
  }
  id() {
    return `file_${++this.counter}`;
  }
  metadata(file) {
    const { bytes, ...meta } = file;
    return { ...meta, size: String(bytes?.length || 0) };
  }
  save(meta, bytes = Buffer.alloc(0)) {
    const id = meta.id || this.id();
    if (this.files.has(id))
      return Response.json({ error: { message: 'Already exists' } }, { status: 409 });
    const file = { ...meta, id, trashed: false, ownedByMe: true, bytes: Buffer.from(bytes) };
    this.files.set(id, file);
    this.events.push({ fileId: id });
    return Response.json(this.metadata(file));
  }
  async fetch(url, options = {}) {
    const u = new URL(url),
      method = options.method || 'GET',
      headers = new Headers(options.headers);
    this.calls.push({ url, method, headers, body: options.body });
    if (headers.get('authorization') !== 'Bearer fake-drive-token')
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (u.pathname === '/drive/v3/about') return Response.json({ user: this.account });
    if (this.failNext && (!this.failNext.method || this.failNext.method === method)) {
      const fail = this.failNext;
      this.failNext = null;
      return Response.json(
        { error: 'Injected failure' },
        { status: fail.status, headers: fail.headers },
      );
    }
    if (u.pathname === '/drive/v3/files/generateIds') return Response.json({ ids: [this.id()] });
    if (u.pathname === '/drive/v3/changes/startPageToken')
      return Response.json({ startPageToken: String(this.events.length) });
    if (u.pathname === '/drive/v3/changes') {
      const start = Number(u.searchParams.get('pageToken')),
        end = Math.min(this.events.length, start + 100),
        changes = this.events
          .slice(start, end)
          .map((event) =>
            event.removed ? event : { ...event, file: this.metadata(this.files.get(event.fileId)) },
          );
      return Response.json({
        changes,
        ...(end < this.events.length
          ? { nextPageToken: String(end) }
          : { newStartPageToken: String(end) }),
      });
    }
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '',
        parent = /'([\w-]+)' in parents/.exec(q)?.[1],
        role = /value\s*=\s*'(vault|batch)'/.exec(q)?.[1];
      return Response.json({
        files: [...this.files.values()]
          .filter(
            (f) =>
              !f.trashed &&
              (!parent || f.parents?.includes(parent)) &&
              (!role || f.appProperties?.pkm_role === role),
          )
          .map((f) => this.metadata(f)),
      });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST')
      return this.save(JSON.parse(options.body));
    if (u.pathname === '/upload/drive/v3/files') {
      if (method === 'POST' && u.searchParams.get('uploadType') === 'multipart') {
        const boundary = /boundary=(.+)/.exec(headers.get('content-type'))[1],
          data = Buffer.from(options.body),
          first = data.indexOf('\r\n\r\n') + 4,
          divider = data.indexOf(`\r\n--${boundary}`, first),
          meta = JSON.parse(data.subarray(first, divider).toString()),
          start = data.indexOf('\r\n\r\n', divider + 4) + 4,
          end = data.lastIndexOf(`\r\n--${boundary}--`),
          response = this.save(meta, data.subarray(start, end));
        if (this.loseResponse && response.status !== 409) {
          this.loseResponse = false;
          throw new TypeError('Lost upload response');
        }
        return response;
      }
      if (method === 'POST' && u.searchParams.get('uploadType') === 'resumable') {
        const meta = JSON.parse(options.body);
        if (this.files.has(meta.id)) return Response.json({}, { status: 409 });
        const id = this.id();
        this.sessions.set(id, { meta, bytes: Buffer.alloc(0) });
        return new Response(null, {
          status: 200,
          headers: {
            location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}`,
          },
        });
      }
      if (method === 'PUT') {
        const session = this.sessions.get(u.searchParams.get('upload_id'));
        if (!session) return new Response(null, { status: 404 });
        const range = headers.get('content-range');
        if (range.startsWith('bytes */'))
          return new Response(null, {
            status: session.complete ? 200 : 308,
            headers: session.bytes.length ? { range: `bytes=0-${session.bytes.length - 1}` } : {},
          });
        const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(range);
        if (!match || Number(match[1]) !== session.bytes.length)
          return new Response(null, { status: 409 });
        session.bytes = Buffer.concat([session.bytes, Buffer.from(options.body)]);
        if (this.failChunkOnce) {
          this.failChunkOnce = false;
          throw new TypeError('Interrupted upload');
        }
        if (session.bytes.length === Number(match[3])) {
          session.complete = true;
          return this.save(session.meta, session.bytes);
        }
        return new Response(null, {
          status: 308,
          headers: { range: `bytes=0-${session.bytes.length - 1}` },
        });
      }
    }
    const match = /^\/drive\/v3\/files\/([\w-]+)$/.exec(u.pathname);
    if (match) {
      const file = this.files.get(match[1]);
      if (!file || file.trashed) return new Response(null, { status: 404 });
      if (u.searchParams.get('alt') === 'media') return new Response(file.bytes);
      return Response.json(this.metadata(file));
    }
    throw new Error(`Unexpected mock Drive endpoint: ${method} ${url}`);
  }
}
