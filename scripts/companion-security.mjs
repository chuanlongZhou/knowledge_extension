import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';

export const executableNames = [
  'PKM-Nexus.exe',
  'PKM-Nexus-NativeHost.exe',
  'PKM-Nexus-Platform.exe',
  'runtime/node.exe',
];
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function verifyCandidateScan(root, directory) {
  const reportFile = path.join(root, 'test-results', 'security', `companion-${VERSION}-scan.txt`);
  const scannedFile = path.join(
    root,
    'test-results',
    'security',
    `companion-${VERSION}-scanned.txt`,
  );
  const report = await readFile(reportFile);
  const scanned = (await readFile(scannedFile, 'utf8'))
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const html = report.toString('utf8');
  if (!html.includes('class="result_clean">No harmful items found') || !html.includes(directory))
    throw new Error('需要当前程序目录的无有害项目扫描报告。');
  for (const file of executableNames)
    if (!scanned.includes(path.join(directory, file))) throw new Error(`扫描清单未覆盖 ${file}。`);
  const reportTime = (await stat(reportFile)).mtimeMs;
  if (reportTime < (await stat(path.join(directory, 'candidate.json'))).mtimeMs)
    throw new Error('构建后必须重新扫描当前候选目录，旧扫描不能用于新文件。');
  return {
    product: 'WithSecure Client Security Premium',
    reportSHA256: digest(report),
    scannedItems: scanned.length,
    harmfulItems: 0,
    executableCoverage: [...executableNames],
  };
}
