import { readFile, writeFile, mkdir } from 'node:fs/promises';
const spec = JSON.parse(await readFile('tests/fixtures/demo-cases.json', 'utf8'));
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
async function result(name) {
  try {
    return JSON.parse(await readFile(`docs/demo-results/${name}.json`, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const offline = await result('offline'),
  live = await result('live'),
  guide = await result('guide'),
  session = await result('session');
const labels = { passed: '通过', failed: '失败', blocked: '阻塞', not_run: '未执行' };
const lines = [
  '# PKM Nexus 使用说明书',
  '',
  `扩展版本：${manifest.version}。本说明书由固定测试用例与本轮实际截图生成。`,
  '',
  ...(session
    ? [
        `> 上次完整演示尚未完成全部验收：${session.reason}。下文保留 0.5.2 演示的实际状态；新增功能有独立验证记录，未执行项目仍不算通过。`,
        '',
      ]
    : []),
  '> 普通网页捕获保存标题、链接和你选择的文字；未选字时不会抓取整篇正文。网页快照保存当前可见区域的 PNG，不是完整网页归档，也不保存视频本体。',
  '',
  '## 1. 从哪里开始',
  '',
  '1. 在 chrome://extensions 重新加载扩展，保持原加载目录；关闭旧侧栏再重新打开。不要先卸载，以免丢失浏览器内部记录。',
  '2. 点击工具栏企鹅图标打开侧栏，普通记录、网页快照、清单、网页组是四个直接入口。',
  '3. 新记录先进入收件箱。点击整理页可搜索、添加标签、管理项目树与关系图、批量整理和备份。',
  '4. 侧栏底部问号和整理页左下角使用说明书都能打开本文；图文随扩展保存，断网也能读。',
  '',
  `收件箱内置六条示例，展示网页链接、文字、录音、多媒体笔记及真实 Wiki / CHETNA 快照。侧栏底部点击“查看 6 条内置示例”可直接到达；已有个人记录时也默认展开。录音标明虚拟麦克风。底部显示当前版本 ${manifest.version}。`,
  '',
  '示例预览不计入个人记录数，也不参与同步。点击“保存到我的收件箱”加入单条，或点击示例区末尾“全部加入我的收件箱”整批加入。加入后成为可编辑的普通记录并使用当前同步设置；重复加入不会覆盖你的修改或恢复已删除记录。隐藏后可从底部示例入口或设置恢复。',
  '',
  '下图来自交互回归的独立测试浏览器，展示侧栏底部的版本和示例入口。',
  '',
  '![侧栏底部的示例入口与版本](images/ui-interactions-footer.png)',
  '',
  '保存或清空后保留当前收集类型，清单继续原 ID 与 Todo / Idea 模式。网页组选择列表的“加入所选网页”固定在顶部。',
  '',
  '多次右键收集文字、链接或图片，会在当前笔记的 `## collected:` 区域每次追加一个 bullet，保留正文与来源。图片可读取时复制为本机附件，受限时在 Markdown 中嵌入原图在线地址。导出 Markdown 会把笔记和本机图片一起打包为 ZIP；侧栏关闭期间也会排队保存。',
  '',
  '标签是单层多选分类，拖动标签块到记录上追加。项目支持子项目与多项目归属；拖动记录到项目文件夹。点击记录先预览，再选择简单或完整修改。喜爱独立归类，关键词功能已停用。项目关系图支持全屏、拖动、预览、交互连线与子项目节点。',
  '',
  '## 本地资料库与 Google Drive 同步',
  '',
  '打开扩展设置，点击“下载 Windows 本地应用”，直接保存内置的 Companion 0.4.1 ZIP。先退出旧程序，将 ZIP 解压到固定目录，双击 PKM-Nexus.exe，保留 runtime 和 app 文件夹。小窗口正常运行不弹终端，关闭或最小化会收进右下角托盘，双击图标恢复。新版采用原厂签名运行时和可读源码，构建检查实际扫描结果及 SHA-256；旧 0.4.0 包继续停用。',
  '',
  '在小窗口点击“设置与资料管理”，登记扩展设置页显示的扩展 ID，再回到扩展点击“连接并启用本地资料库”。连接后已保存内容自动交接；Chrome 后台每分钟重试，不要求侧栏保持打开。',
  '',
  '点击“登录自己的 Google 账号”，在系统浏览器选择自己的账号并授权。每位用户各自使用自己的 Drive，PKM Nexus 的 OAuth 客户端只标识应用。新版已内置应用客户端配置，普通用户无需创建 Google Cloud 项目或导入 JSON；应用中显示的当前账号才是实际同步的 Drive 归属。',
  '',
  '登录后，第一台创建自己拥有的 Drive 资料库，另一台使用同一账号选择相同资料库。界面显示当前账号，换号后停止原资料库的云端读写。立即同步或启用每小时任务后执行云同步。浏览器保存、本地资料库写入和 Drive 同步状态分别显示。',
  '',
  'Drive 失败保留本地数据；冲突版本在本地管理程序处理。关闭 Chrome 后仍可同步已交接内容；尚留在浏览器的修改需等待 Chrome 再次运行。扩展设置不需要仓库或访问令牌。',
  '',
  '## 主题、清单与项目图',
  '',
  '点击记录先预览，再选择 Markdown 简单修改或完整修改。标签拖到记录上，记录拖到项目上；网页组内删除网页会划线保留，可恢复。鼠标进入整理页整个左侧导航栏，或进入插件侧栏任意位置时，企鹅平滑放大；离开后平滑恢复。侧栏四个收集入口保持一排。',
  '',
  '清单直接输入 task1 并按 Enter：Todo 自动生成复选框，Idea 生成条目。输入 --- 并按 Enter 生成分隔线。底层保存 Markdown，点开 Markdown 源码可直接修改；尚未提交的一行也会保存为草稿。',
  '',
  '整理页左下角、侧栏底部 ◐ 或设置中打开主题与字体。可选择纸张、明亮、深色或跟随系统，调整六种颜色，以及不同区域的字号和字体。即时预览，保存后应用到本机各扩展页面；取消恢复之前的设置。',
  '',
  '![主题与字体设置](images/theme-settings-061.png)',
  '',
  '右键标签或点击标签区齿轮，直接点选标签，可修改名称和颜色；标签不带图标，并使用紧凑高度。颜色可用可见色块、预设或十六进制输入。项目提供基础图标选择，导航显示项目树连接线。普通导航图标为 20px，回收站为 22px，与文字居中对齐。',
  '',
  '![标签编辑](images/tag-editor-061.png)',
  '',
  '项目图支持全屏、拖动、指针位置的滚轮缩放、预览和交互连线。记录节点直接编辑人工总结，子项目节点直接编辑描述，输入后自动保存；右侧预览点编辑记录可进入完整编辑器。保存、取消、关闭或按 Escape 后都返回原关系图，保留当前项目层级、缩放、全屏、选中卡片和未提交的关系说明，并更新预览。编辑子项目同样返回原图。子项目是一个节点，项目描述显示在标题下。',
  '',
  '![项目关系图](images/project-graph.png)',
  '',
  '![编辑记录后返回当前子项目关系图](images/graph-edit-return-062.png)',
  '',
  '![紧凑标签与对齐的导航图标](images/compact-navbar-062.png)',
  '',
  '![可读的侧栏](images/sidebar-readable.png)',
  '',
  '## 2. 权限与数据保存',
  '',
  '捕获提示需要授权时，点击允许访问此网站并重试，在 Chrome 确认。跨网站使用可在设置与数据管理 → 网页访问权限主动允许所有网站。截图需要所有网站权限，或先回到网页点击工具栏扩展图标，取得当前页临时权限后重试。不要在 Chrome 内部页面上截图。',
  '',
  '网页组手动加入或拖入 Bilibili 等链接时，不需要先授权读取网页。已有标签页或拖拽文字会用作标题；未授权且没有标题时显示网站域名，原链接仍可保存。需要更具体的标题可手动填写。下图是无 Bilibili 网站授权时添加两条链接的实际结果，测试确认未发网页请求、未产生 CORS 错误。',
  '',
  '![0.5.4 无网站授权仍可添加和保存 Bilibili 链接](images/fix054-links-no-permission.png)',
  '',
  '点击开始录音时申请麦克风，停止后生成音频附件。添加图片支持按钮选择文件及正文粘贴。保存记录前媒体只附在当前草稿；保存后原文件单独存储，Markdown 保留相对路径。',
  '',
  '浏览器本地保存、浏览器交接到配套程序、配套程序上传 Google Drive 是三个不同状态。保存到本地会下载完整 ZIP，不能用它代替上传同步。',
  '',
  '## 3. 本轮验证范围',
  '',
  `固定回归：${offline ? `${offline.startedAt}，${offline.browserVersion}，通过 ${offline.summary.passed} / 失败 ${offline.summary.failed} / 阻塞 ${offline.summary.blocked}` : '尚未执行。'}`,
  '',
  `真实网站：${live ? `${live.startedAt}，通过 ${live.summary.passed} / 失败 ${live.summary.failed} / 阻塞 ${live.summary.blocked}` : '尚未执行；下列离线样例不能替代真实网站验收。'}`,
  '',
  '> 自动化录音使用虚拟麦克风；离线样例页面有显著标识；同步使用 MockDrive 与测试传输桥，不访问 Google、不更改 Native Messaging 注册、不创建 Windows 任务。真实 Google OAuth 与每小时同步需要用户完成后续验收。',
  '',
  '截图按操作后的实际界面生成。点击内置说明书中的截图可打开原图；失败或阻塞会保留实际状态，不改写成成功。',
  '',
];
let group = '';
for (const item of spec.cases) {
  if (item.group !== group) {
    group = item.group;
    lines.push(`## ${group}`, '');
  }
  lines.push(
    `### ${item.id} · ${item.title}`,
    '',
    ...item.steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `验收条件：${item.expected}`,
    '',
  );
  const reports = item.id === 'H01' ? [guide].filter(Boolean) : [offline, live].filter(Boolean);
  let found = false;
  for (const report of reports) {
    const entry = report.cases?.find((c) => c.id === item.id);
    if (!entry) continue;
    found = true;
    lines.push(
      `本轮${report.mode === 'live' ? '真实网站' : report.mode === 'guide' ? '内置帮助' : '固定样例'}结果：**${labels[entry.status] || entry.status}**${entry.reason ? `。${entry.reason.split('\n')[0]}` : '。'}`,
      '',
    );
    if (item.id === 'T03' && session?.harnessFinding)
      lines.push(`测试脚本说明：${session.harnessFinding}`, '');
    for (const [index, step] of entry.steps.entries()) {
      lines.push(
        `操作 ${index + 1}：${step.action}`,
        '',
        `预期：${step.expected}`,
        '',
        `实际：${step.actual.split('\nCall log:')[0].trim()}（${labels[step.status] || step.status}）`,
        '',
        item.id === 'T03' && step.status === 'failed'
          ? '此步未取得对应清单失败界面的截图；原日志误取了仍打开的来源页，不能把它作为清单失败证据。'
          : `![${item.id} ${index + 1} · ${step.action}](${step.image})`,
        '',
      );
    }
  }
  if (!found) lines.push('本轮结果：未执行，不能判为通过。', '');
}
lines.push(
  '## 常见问题',
  '',
  '• 捕获后正文为空：先在网页选中文字再捕获，或手动添加正文；只保存链接也是正常用法。',
  '• 没看到内置示例：点击侧栏底部的查看 6 条内置示例；要作为真实个人记录显示，点击示例区末尾全部加入我的收件箱。刷新不会自动把预览写入个人资料库。',
  '• 仍看到旧 CORS 错误：Chrome 扩展错误页保留历史日志。确认当前加载目录已更新，重新加载后关闭旧侧栏再打开，清除历史错误后重新添加链接，观察是否有新增错误。',
  '• 看到重复提示：查看重复提示后选择追加、另存或取消，系统不会自动合并。',
  '• Todo / Idea 如何分主题：当前只有一份清单，使用主题前缀和分割线；Todo 的完成状态与 Idea 的 bullet 独立保留。',
  '• Bilibili 风控或地图空白：等待真实页面就绪；风控、登录或图层错误不算完成了网站快照验收，不绕过验证。',
  '• 录音没有人的声音：本轮自动化使用虚拟麦克风，请用真人声音另做一次 N03 / N04。',
  '• Google Drive 无法同步：先在本地程序设置桌面 OAuth，完成用户授权，再绑定专用资料库。两台电脑使用同一 OAuth 应用、账号和资料库 ID；无需 Drive 桌面客户端。',
  '• 每小时同步：只在用户明确开启后注册 Windows 任务；电脑休眠或关机不执行，登录后补运行。真实授权与任务验收见 D06 / D07。',
  '',
  '## 测试与资料来源',
  '',
  '重复测试命令、环境准备和判定规则可在左侧可重复测试流程中阅读。仓库固定用例：tests/fixtures/demo-cases.json；结果：docs/demo-results；每次运行原始证据：test-results/demo-runs。',
  '',
  `[Wiki 样例](${spec.sites.wiki}) · [Bilibili 样例](${spec.sites.bilibili}) · [CHETNA](${spec.sites.chetna})`,
  '',
  '[Chrome 可选权限](https://developer.chrome.com/docs/extensions/reference/api/permissions) · [Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)',
  '',
);
const markdown = lines.join('\n');
await mkdir('extension/guide', { recursive: true });
await writeFile('extension/guide/使用说明书.md', markdown);
await writeFile('使用说明书.md', markdown.replaceAll('](images/', '](extension/guide/images/'));
await writeFile('extension/guide/测试流程.md', await readFile('docs/DEMO-TEST-PLAN.md'));
console.log('Generated 使用说明书.md and bundled guide with actual test screenshots.');
