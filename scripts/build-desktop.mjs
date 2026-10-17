import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { VERSION } from '../companion/util.mjs';

export async function buildDesktop(root, output, buildDir) {
  const compiler = path.join(
    process.env.WINDIR || 'C:/Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  const images = await Promise.all(
    [32, 16, 128].map((size) => readFile(path.join(root, `extension/icons/icon-${size}.png`))),
  );
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((bytes, i) => {
    const size = [32, 16, 128][i],
      at = 6 + 16 * i;
    header[at] = header[at + 1] = size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  const icon = path.join(buildDir, 'nexus.ico');
  await writeFile(icon, Buffer.concat([header, ...images]));
  const metadata = path.join(buildDir, 'DesktopAssembly.cs');
  await writeFile(
    metadata,
    `using System.Reflection;\n[assembly: AssemblyTitle("PKM Nexus Companion")]\n[assembly: AssemblyProduct("PKM Nexus")]\n[assembly: AssemblyVersion("${VERSION}.0")]\n[assembly: AssemblyFileVersion("${VERSION}.0")]\n`,
  );
  for (const [source, name, resource] of [
    ['Desktop.cs', 'PKM-Nexus.exe', true],
    ['NativeHost.cs', 'PKM-Nexus-NativeHost.exe', false],
    ['Platform.cs', 'PKM-Nexus-Platform.exe', false],
  ]) {
    const result = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/platform:x64',
        '/optimize+',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.Extensions.dll',
        '/reference:System.Security.dll',
        '/reference:Microsoft.CSharp.dll',
        `/win32icon:${icon}`,
        ...(resource ? [`/resource:${icon},nexus.ico`] : []),
        `/out:${path.join(output, name)}`,
        path.join(root, 'companion/desktop', source),
        path.join(root, 'companion/desktop/Runtime.cs'),
        metadata,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    if (result.status !== 0)
      throw new Error(
        result.stdout || result.stderr || 'Could not compile the desktop application.',
      );
  }
}
