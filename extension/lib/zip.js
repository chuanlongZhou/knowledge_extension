// Small ZIP reader/writer. Store binary assets directly, without a runtime library.
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = (c >>> 8) ^ crcTable[(c ^ b) & 255];
  return (c ^ 0xffffffff) >>> 0;
}
const bytesOf = async (value) =>
  typeof value === 'string'
    ? encoder.encode(value)
    : value instanceof Blob
      ? new Uint8Array(await value.arrayBuffer())
      : value;
export async function writeZip(files) {
  if (files.size > 60000) throw new Error('打包文件数量过多。');
  const local = [],
    central = [];
  let offset = 0;
  const now = new Date(),
    year = Math.min(2107, Math.max(1980, now.getFullYear())),
    dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const [path, value] of files) {
    if (!validZipPath(path)) throw new Error('打包路径不正确。');
    const name = encoder.encode(path),
      data = await bytesOf(value);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length),
      v = new DataView(header.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(10, dosTime, true);
    v.setUint16(12, dosDate, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    header.set(name, 30);
    local.push(header, data);
    const directory = new Uint8Array(46 + name.length),
      d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x800, true);
    d.setUint16(12, dosTime, true);
    d.setUint16(14, dosDate, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += header.length + data.length;
    if (offset > 512 * 1024 * 1024) throw new Error('本地打包超过 512 MB，请分批导出。');
  }
  const size = central.reduce((sum, b) => sum + b.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.size, true);
  e.setUint16(10, files.size, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
export function validZipPath(path) {
  return (
    typeof path === 'string' &&
    path.length < 1000 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((p) => !p || p === '.' || p === '..') &&
    !path.includes(':')
  );
}
export async function readZip(blob, { maxEntryBytes = 32 * 1024 * 1024 } = {}) {
  // Build verification opts in to larger bundled installers. User imports keep
  // the existing 32 MiB limit per entry.
  if (
    !Number.isSafeInteger(maxEntryBytes) ||
    maxEntryBytes < 0 ||
    maxEntryBytes > 512 * 1024 * 1024
  )
    throw new Error('ZIP 文件大小限制无效。');
  if (blob.size > 512 * 1024 * 1024) throw new Error('ZIP 超过 512 MB。');
  const data = new Uint8Array(await blob.arrayBuffer()),
    view = new DataView(data.buffer);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('不是完整的 ZIP 文件。');
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true),
    files = new Map();
  let cursor = offset,
    total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.length || view.getUint32(cursor, true) !== 0x02014b50)
      throw new Error('ZIP 目录损坏。');
    const flags = view.getUint16(cursor + 8, true),
      method = view.getUint16(cursor + 10, true),
      crc = view.getUint32(cursor + 16, true),
      compressed = view.getUint32(cursor + 20, true),
      size = view.getUint32(cursor + 24, true),
      length = view.getUint16(cursor + 28, true),
      extra = view.getUint16(cursor + 30, true),
      comment = view.getUint16(cursor + 32, true),
      localOffset = view.getUint32(cursor + 42, true),
      name = decoder.decode(data.subarray(cursor + 46, cursor + 46 + length));
    cursor += 46 + length + extra + comment;
    if (
      !validZipPath(name) ||
      files.has(name) ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      size > maxEntryBytes ||
      localOffset + 30 > data.length ||
      view.getUint32(localOffset, true) !== 0x04034b50
    )
      throw new Error('ZIP 包含不支持的路径、加密或超大文件。');
    const start =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (start + compressed > data.length) throw new Error('ZIP 文件不完整。');
    let bytes = data.slice(start, start + compressed);
    if (method === 8)
      bytes = new Uint8Array(
        await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
        ).arrayBuffer(),
      );
    total += bytes.length;
    if (bytes.length !== size || crc32(bytes) !== crc || total > 512 * 1024 * 1024)
      throw new Error('ZIP 校验失败或解压内容过大。');
    files.set(name, bytes);
  }
  return files;
}
