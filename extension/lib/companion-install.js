import { el } from './dom.js';

export async function companionInstaller({ fetchImpl = fetch, runtime = chrome.runtime } = {}) {
  const root = el('div', { class: 'companion-install' });
  const status = el('p', { class: 'description', role: 'status' }, '正在读取内置安装包…');
  root.append(status);
  try {
    const response = await fetchImpl(runtime.getURL('installers/manifest.json'));
    if (!response.ok) throw new Error('安装包清单缺失。');
    const item = await response.json();
    if (item.blocked === true) {
      status.textContent =
        '此预览包未附带本地程序，请加载包含 Windows 本地应用的完整插件包。';
      status.className = 'error-text';
      return root;
    }
    if (
      item.format !== 'pkm-nexus-installer' ||
      item.schemaVersion !== 1 ||
      item.platform !== 'windows-x64' ||
      !/^\d+\.\d+\.\d+$/.test(item.version) ||
      item.archive !== `PKM-Nexus-Companion-${item.version}-windows-x64.zip` ||
      !Number.isSafeInteger(item.sizeBytes) ||
      item.sizeBytes < 22 ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error('安装包清单无效。');
    const link = el(
      'a',
      {
        id: 'download-companion',
        class: 'button primary',
        href: runtime.getURL(`installers/${item.archive}`),
        download: item.archive,
        onclick: () => {
          status.textContent =
            '下载已开始。完成后将 ZIP 解压到固定目录，双击 PKM-Nexus.exe，保留同目录的 runtime 和 app 文件夹。';
        },
      },
      '下载 Windows 本地应用',
    );
    status.textContent = `内置版本 ${item.version} · Windows 10/11 x64 · ${(item.sizeBytes / 1024 / 1024).toFixed(1)} MiB。无需联网下载安装包。`;
    root.replaceChildren(link, status);
  } catch {
    status.textContent =
      '当前插件包缺少本地应用安装文件，请使用完整插件包重新加载。浏览器中的资料仍保留。';
    status.className = 'error-text';
    return root;
  }
  root.append(
    el(
      'ol',
      { class: 'companion-install-steps' },
      el('li', {}, '点击上方按钮，将内置安装包保存到电脑。'),
      el(
        'li',
        {},
        '将 ZIP 解压到固定目录，双击 PKM-Nexus.exe，保留 runtime 和 app 文件夹；关闭或最小化小窗口会收进右下角托盘。',
      ),
      el(
        'li',
        {},
        '在小窗口点击“设置与资料管理”，进入“连接浏览器扩展”，填写下方扩展 ID 并点击“连接此扩展”。',
      ),
      el('li', {}, '返回这里点击“连接并启用本地资料库”，再在同步助手登录自己的 Google 账号。'),
    ),
  );
  return root;
}
