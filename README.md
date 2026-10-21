# GUGA Knowledge 0.9.2 · Google Drive 简化版

浏览器负责离线收集与整理，扩展直接连接用户自己的 Google Drive。仅在点击“同步下载”或“同步上传”时传输数据；ZIP 导出是独立备份。

## 开始使用

1. 原版用户先导出完整 ZIP，再在 chrome://extensions 加载简化版 dist/pkm-nexus。简化版使用新固定 ID，与原版的浏览器数据独立；导入 ZIP 后可继续使用。后续更新保持相同公钥并重新加载，不先卸载。
2. 设置 → Google Drive → 登录 Google Drive，使用自己的 Google 账号。
3. 全新用户“新建并使用文件夹”；新设备“选择已有文件夹”，选择同一账号下由本简化版创建的文件夹。
4. 新设备先“同步下载”，把云端记录和图片、音频下载到浏览器。
5. 编辑后“同步上传”，只上传新增及修改记录，更新对应云端文件。
6. “导出备份”前选择按项目、按标签或不分类。Markdown 使用原名称，项目按父子层级归档；多项目 / 标签提供阅读副本，恢复数据与附件仍只保存一份。可在设置中预览并导入完整 ZIP。

文件夹只显示同一应用创建且当前账号拥有的简化版数据文件夹。Drive 的 drive.file 权限不能浏览所有私人文件；旧版数据先导出完整 ZIP，再导入本简化版的新文件夹。

所有设备请先更新到 0.8.4，再上传新文件或整理目录：旧客户端只读平铺目录。新版兼容旧文件及新分类目录，新文件进入 records、metadata、assets/images 或 assets/audio；已有文件可以在设置 → Google Drive → 整理云端目录中预览并移动，保留文件 ID，失败后可重新整理剩余文件。不会整理用途未知的用户文件。

## 启动页与列表排序

安装并启用后，GUGA 启动页通过 Chrome 官方 URL Overrides 成为浏览器的新标签页；点击“+”或按 Ctrl+T 即可打开。设置与数据管理 → 启动页显示当前状态，并可调整卡片数量和常用网站。旧版 enabled / decided 偏好不再控制替换。

启动页分别显示可滚动的完整 Todo / Idea 清单，支持添加、编辑、勾选、直接删除，输入 `---` 可添加分隔线；沿用原来的唯一清单并参与正常同步。记录可在整理页或启动页预览中置顶，置顶区位于喜爱网页之前。喜爱网页默认显示最近更新的 8 张卡片，可改为 5 或 10 张；待浏览网页组显示未读链接。项目卡片显示名称、描述和成员数，点击打开成员与子项目对话框，再进入记录预览或原编辑器。底部 Dock 可添加、编辑、排序与移除常用网站，最多 12 个；点击同步上传 / 下载时，Dock 网站也随资料在个人 Google Drive 间同步，完整 ZIP 备份包含它们。喜爱卡片数量仍是当前浏览器的偏好。

整理页可按创建时间、最近修改时间、标签、项目或标题排序，并切换方向。编辑期间保留当前卡片和分页位置；下次进入、刷新页面或点击“重新排序”时应用变化。切换筛选或排序模式会重新计算顺序，清单与置顶记录继续优先显示。

设置与数据管理 → 语言：支持 English、中文、Français、日本語，默认保留中文。选择后点击“应用语言”，当前页面重新加载；从侧栏打开设置前会保存草稿，其他已打开页面刷新后生效。界面、日期、启动页、常用操作、Google Drive 提示及使用说明随语言变化；自己的记录、标签、项目和 Dock 名称保持原文。语言是本机偏好，不同步到 Drive 或数据备份。

## 文件与冲突

- 每条普通记录、快照、清单、网页组、项目分别使用一个稳定 ID 的 JSON 文件；附件按 SHA-256 单独保存并复用。文件标题修改不会产生另一条记录。
- 项目描述、外观、父子层级、成员及关系图随项目 / 内容记录同步。标签定义使用独立的 tags.json，同步空标签、颜色和描述；标签描述在标签外观中编辑，选择标签后显示。标签定义也进入 JSON / 完整 ZIP 备份；同名定义导入时默认保留本机，勾选更新后使用备份。
- 下载只读取云端，上传只写入云端；两者不会自动执行另一个方向。下载不清空浏览器独有记录。
- 下载先比较 Drive 文件版本，复用已校验的持久缓存，只读取新增或版本变化的 JSON。记录及缺少的附件分别最多四路并发；仍保留哈希验证、同步基线、原子提交及冲突选择。缺少版本或缓存损坏时重新读取，缓存不作为唯一数据源，也不进入备份。
- 删除通过记录的删除状态和删除标记传播；不会因为文件列表暂时缺项就删除浏览器记录，也不会永久删除 Drive 中的其他文件。
- 手动从 Drive 移除 JSON 不会删除浏览器副本；该记录有修改时会跳过上传并报告缺项。删除仍被引用的附件可能阻止缺少本地附件的设备下载；删除子项目所需的父项目或关系图节点，可能因关系不完整而阻止新设备下载；删除整个文件夹会中断连接。优先从 Drive 回收站恢复；尚无自动修复 / 重建云端缺项的入口。
- 上传比较上次同步基线与云端版本，使用 Drive 资源 ETag 进行条件更新。两台设备同时修改同一记录时，保留版本并提示选择。选择后先同步下载应用选择；选择浏览器版本后再同步上传。不同记录不会整体覆盖。
- 项目、子项目和关系图引用其他记录；下载在一个 IndexedDB 事务内验证这些关联。关联冲突未解决时，不会部分写入有问题的关系图。
- 一台浏览器固定绑定一个账号和文件夹。退出登录保留浏览器记录与绑定信息；需要使用另一份资料时，在新的 Chrome 配置中连接，防止串用。
- 备份不包含 Google 令牌、登录状态或同步绑定；导入不会替换 Google 身份。

## 收集与外观

支持 Markdown、网页链接与选中文字、PNG 可见区域快照、Todo/Idea 清单、网页组、主动录音、粘贴图片、标签、多项目归属、项目树和关系图。网页与麦克风访问按需授权。

标签仅显示名称；“已整理”可筛选已在项目、未在项目，并与搜索、标签和类型组合。已删除项目不计入归属。

网页组内的 ⠿ 或网页标题可拖到另一个组，只移动单个网页并保留已读状态；相同网址合并。卡片标题、空白处或“⠿ 整组”可把整个网页组加入项目 / 标签，或将全部有效网页并入另一组。并入后来源组的文字、标签、项目关系及已删除网页仍保留。点击单网页的 ⠿ 也可选择目标组；完整预览显示全部网页。

图片上传 / 粘贴写入期间点击保存会等待附件完成，本地已保存的图片自动预览。网页原图未取得时会明确提示只保存了链接；可复制图片后粘贴，或使用“添加图片”保存原文件。

设置页按同步、备份、外观和权限分区，支持窄窗口与内容区独立滚动；选择云端文件夹后可点击“打开 Google Drive 目录”在新标签页查看。页面企鹅与伙伴支持固定、随机、循环，使用原版企鹅及五张透明图片，可选 10 秒、30 秒、1 分钟、5 分钟间隔，偏好在整理页和侧栏生效。

主题与字体提供六套配色：Vintage Vinyl、Hawaiian Surf、French Vintage、Spiced Chai、Ocean Mist、Matcha Forest；保存后跨整理页、侧栏和帮助页应用。

## 开发者一次性 Google 配置

普通用户只需登录自己的账号；扩展发布者需要先完成：

1. 在 Google Cloud 启用 Drive API，并配置 OAuth 同意屏幕。Testing 阶段须为真实验收账号添加测试用户。
2. 创建或更新类型为“Chrome 扩展程序”的 OAuth 客户端，绑定简化版固定 ID `jjpdanoikikedmildkmhndmbjnajjaho`。原版 ID 为 ihmbeohbhfkaonhdpgdgbmemengmjken，两者不同。
3. 运行 `node scripts/configure-google.mjs CLIENT_ID.apps.googleusercontent.com`，再重新加载同一目录。这里使用公开客户端 ID，不使用客户端密钥，不沿用桌面应用客户端。
4. 每台设备必须使用同一应用注册和 Drive 权限范围。不要为每位用户创建客户端。
5. 使用两个隔离 Chrome 配置验收真实登录、创建文件夹、新设备下载、上传覆盖、同记录并发修改和登出。本地自动化模拟不等于真实 Google 验收。

本分支已配置用户提供的客户端 ID `464495637351-vaslclbq0t7oa5ratt3dchdv3t626dhu.apps.googleusercontent.com`，并保留固定 manifest.key。Google 端该客户端应绑定上述简化版扩展 ID；用户已反馈真实账号可登录，后续真实 Drive 读写仍需验收。

能登录但 Drive 请求返回 403 时，查看界面的具体 Google 原因码：`SERVICE_DISABLED` / `accessNotConfigured` 表示须在**该 OAuth 客户端所属项目**启用 Google Drive API；当前客户端项目编号为 `464495637351`，可打开 [Drive API 配置](https://console.cloud.google.com/apis/library/drive.googleapis.com?project=464495637351) 检查。`ACCESS_TOKEN_SCOPE_INSUFFICIENT` / `insufficientPermissions` 要求重新登录授权；`rateLimitExceeded` / `userRateLimitExceeded` 会自动退避重试，仍失败时稍后再试。其他 403 会显示 Google 返回的原因，不再统一当作限流。参考 [Google Drive 错误处理](https://developers.google.com/workspace/drive/api/guides/handle-errors)。

跨设备解压加载时保持仓库中的 manifest.key。`node scripts/extension-identity.mjs` 会显示当前固定 ID，有 key 时不会重新生成；有另一扩展公钥时可将公钥作为 `configure-google.mjs` 的第三个参数。改变身份会使用另一浏览器数据空间，不要在保留现有数据的原目录中随意替换公钥。日后通过 Chrome Web Store 发布时须以商店实际分配的身份重新核对 OAuth 绑定。

界面名称已改为 GUGA Knowledge；数据库名、记录 ID、备份格式标识和 OAuth 客户端继续兼容原版本。Google 登录授权页的应用名称由 Google Cloud 管理，需在 Google Auth Platform → Branding → App name 改为 GUGA Knowledge，无需更换客户端 ID，见 [官方配置步骤](https://developers.google.com/workspace/guides/configure-oauth-consent)。

云端同步保持稳定 ID 文件名；可读名称与按项目 / 标签归档用于备份中的 Markdown。已实现的新目录、兼容整理和下载缓存详见 [目录与备份说明](docs/drive-layout-proposal.md)。

官方参考：[Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity)、[Drive 文件权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Drive v2 文件 ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)。

## 构建与验证

Node 22+：`npm ci`、`npm run lint`、`npm test`、`npx playwright install chromium`、`npm run test:drive-browser`、`npm run build`。

输出 dist/pkm-nexus 和 dist/GUGA-Knowledge-0.9.2-direct-drive.zip。商店上传 ZIP 的 manifest.json 位于根目录，打包时移除 `key` 字段；本地解压加载目录保留商店公钥，因此本地与商店扩展 ID 均为 `hmlcjcejioggaegkahdnbgpnajchhlbl`。OAuth 客户端须在 Google Cloud 中作为 Chrome 扩展程序绑定此 ID。此 ZIP 应上传为该商店条目的更新。旧开发版扩展 ID 不同；若其中已有本地数据，先导出完整 ZIP，再在新 ID 的扩展中导入。`npm run test:start-browser` 验证欢迎页与设置入口、真实空白新标签页由官方接口打开启动页、启动页交互、窄屏及编辑后的稳定排序；`npm run test:language-browser` 验证四种语言、原始内容不变、草稿恢复和 360px 排版。

分支 codex/ui-themes-companion 保存 0.7.3 的完整功能；codex/direct-google-drive 为本简化版。旧版本代码与历史测试留作迁移参考，不进入简化版发行包的运行流程。
