export const DRIVE_DIRECTORIES = [
  { key: 'records', parent: '', name: 'records' },
  { key: 'metadata', parent: '', name: 'metadata' },
  { key: 'assets', parent: '', name: 'assets' },
  { key: 'assets/images', parent: 'assets', name: 'images' },
  { key: 'assets/audio', parent: 'assets', name: 'audio' },
];
export function libraryDirectory(file, rootId, parentKey) {
  return (
    file.mimeType === 'application/vnd.google-apps.folder' &&
    file.appProperties?.pkm_role === 'directory' &&
    file.appProperties.pkm_root === rootId &&
    DRIVE_DIRECTORIES.some(
      (dir) => dir.key === file.appProperties.pkm_directory && dir.parent === parentKey,
    )
  );
}
export function directoryIds(rootId, files) {
  const ids = new Map([['', rootId]]);
  for (const dir of DRIVE_DIRECTORIES) {
    const found = files
      .filter(
        (file) =>
          libraryDirectory(file, rootId, dir.parent) &&
          file.appProperties.pkm_directory === dir.key &&
          file.parents?.includes(ids.get(dir.parent)),
      )
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (found) ids.set(dir.key, found.id);
  }
  return ids;
}
export function fileDirectory(file) {
  const role = file.appProperties?.pkm_role;
  if (role === 'record') return 'records';
  if (role === 'tag_library' || role === 'shortcut_library') return 'metadata';
  if (role === 'asset')
    return file.mimeType?.startsWith('image/')
      ? 'assets/images'
      : file.mimeType?.startsWith('audio/')
        ? 'assets/audio'
        : 'assets';
  return null;
}
export async function ensureDriveLayout(drive, rootId, files) {
  const ids = directoryIds(rootId, files);
  for (const dir of DRIVE_DIRECTORIES) {
    if (ids.has(dir.key)) continue;
    const folder = await drive.createDirectory(rootId, ids.get(dir.parent), dir);
    files.push(folder);
    ids.set(dir.key, folder.id);
  }
  return ids;
}
export function driveLayoutPlan(rootId, files) {
  const ids = directoryIds(rootId, files);
  return files.flatMap((file) => {
    const path = fileDirectory(file);
    return path && !file.parents?.includes(ids.get(path))
      ? [{ id: file.id, name: file.name, path }]
      : [];
  });
}
