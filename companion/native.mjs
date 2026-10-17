import { HOST_NAME } from './util.mjs';
const MAX_FRAME = 256 * 1024,
  MAX_REQUEST = 8 * 1024 * 1024,
  CHUNK = 48 * 1024;
const NATIVE_COMMANDS = new Set([
  'status',
  'records.put',
  'records.changes',
  'records.get',
  'assets.has',
  'assets.begin',
  'assets.chunk',
  'assets.finish',
  'assets.read',
  'ui.open',
  'drive.sync',
]);
export async function nativeHost(
  service,
  {
    input = process.stdin,
    output = process.stdout,
    origin = process.argv.find((arg) => arg.startsWith('chrome-extension://')),
  } = {},
) {
  const settings = await service.settings.read();
  if (!origin || !settings.allowedOrigins.includes(origin))
    throw new Error(`${HOST_NAME}: extension origin is not registered.`);
  let buffer = Buffer.alloc(0),
    pending = null,
    work = Promise.resolve();
  function write(message) {
    const bytes = Buffer.from(JSON.stringify(message));
    if (bytes.length > MAX_FRAME) throw new Error('Native response frame is too large.');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bytes.length);
    output.write(Buffer.concat([header, bytes]));
  }
  async function respond(id, value) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_REQUEST) throw new Error('Native response is too large.');
    const total = Math.ceil(text.length / CHUNK) || 1;
    for (let index = 0; index < total; index++)
      write({
        type: 'response',
        id,
        index,
        total,
        data: text.slice(index * CHUNK, (index + 1) * CHUNK),
      });
  }
  async function accept(frame) {
    const id = frame.id;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id))
      throw new Error('Invalid native request ID.');
    if (
      frame.type !== 'request' ||
      !Number.isInteger(frame.index) ||
      !Number.isInteger(frame.total) ||
      frame.total < 1 ||
      frame.total > 200 ||
      typeof frame.data !== 'string' ||
      frame.data.length > CHUNK
    )
      throw new Error('Invalid native request frame.');
    if (frame.index === 0) {
      if (pending) throw new Error('Overlapping native requests are not allowed.');
      pending = { id, total: frame.total, parts: [], size: 0 };
    }
    if (
      !pending ||
      pending.id !== id ||
      pending.total !== frame.total ||
      frame.index !== pending.parts.length
    )
      throw new Error('Native request chunk order mismatch.');
    pending.size += Buffer.byteLength(frame.data);
    if (pending.size > MAX_REQUEST) throw new Error('Native request is too large.');
    pending.parts.push(frame.data);
    if (pending.parts.length !== pending.total) return;
    const text = pending.parts.join('');
    pending = null;
    try {
      const request = JSON.parse(text);
      if (!NATIVE_COMMANDS.has(request.command))
        throw new Error('This operation is only available in the companion management window.');
      const result = await service.handle(request.command, request.payload);
      await respond(id, { ok: true, result });
    } catch (error) {
      await respond(id, { ok: false, error: error.message });
    }
  }
  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length > MAX_FRAME || length === 0) {
        input.destroy(new Error('Invalid native frame length.'));
        return;
      }
      if (buffer.length < 4 + length) break;
      const bytes = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      work = work
        .then(() => accept(JSON.parse(bytes.toString('utf8'))))
        .catch((error) => {
          process.stderr.write(error.message + '\n');
          input.destroy(error);
        });
    }
  });
  await new Promise((resolve, reject) => {
    input.once('end', () => work.then(resolve, reject));
    input.once('error', reject);
  });
  if (buffer.length || pending) throw new Error('Incomplete native message.');
}
