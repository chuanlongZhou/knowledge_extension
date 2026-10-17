import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';
import { assertCompanionReleaseEnabled } from './release-safety.mjs';

// The archive is an offline download resource. It is never loaded as extension
// code, launched, or installed by the extension.
export async function bundleCompanionInstaller(root, extensionDirectory) {
  await assertCompanionReleaseEnabled(root);
  const archive = `PKM-Nexus-Companion-${VERSION}-windows-x64.zip`;
  const source = path.join(root, 'dist', archive);
  let bytes;
  try {
    bytes = await readFile(source);
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new Error('缺少本地应用安装包。请先运行 npm run build:companion，再构建完整插件。');
    throw error;
  }
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw new Error('本地应用安装包不是有效 ZIP，已停止构建。');
  const release = JSON.parse(
    await readFile(path.join(root, 'dist', `PKM-Nexus-Companion-${VERSION}-release.json`), 'utf8'),
  );
  if (
    release.version !== VERSION ||
    release.format !== 'pkm-nexus-portable-release' ||
    release.scan?.harmfulItems !== 0 ||
    release.archiveSHA256 !== createHash('sha256').update(bytes).digest('hex')
  )
    throw new Error('安装包与当前扫描、校验记录不匹配，请重新构建。');
  const manifest = {
    format: 'pkm-nexus-installer',
    schemaVersion: 1,
    platform: 'windows-x64',
    version: VERSION,
    archive,
    sizeBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    googleConfigured: release.googleConfigured,
    packageType: 'portable',
    security: { scanned: true, harmfulItems: 0, runtimeSignature: 'Valid' },
  };
  const destination = path.join(extensionDirectory, 'installers');
  await mkdir(destination, { recursive: true });
  await copyFile(source, path.join(destination, archive));
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  // Keep exactly one installer when rebuilding an existing unpacked extension.
  for (const entry of await readdir(destination, { withFileTypes: true }))
    if (
      entry.isFile() &&
      entry.name !== archive &&
      /^PKM-Nexus-Companion-\d+\.\d+\.\d+-windows-x64\.zip$/.test(entry.name)
    )
      await unlink(path.join(destination, entry.name));
  return manifest;
}
