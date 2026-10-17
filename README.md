# PKM Nexus 0.7.3 + Windows Companion 0.4.1

0.4.1 使用原厂签名 Node 和可读源码，提供小窗口及右下角托盘，随完整插件内置下载。旧 0.4.0 已停用。打包校验运行时签名、文件 SHA-256 和当前目录的杀毒扫描结果；应用自身的签名状态如实写入 RELEASE.json。Google 应用客户端已创建并内置，当前仍处 Testing；用户选择暂不添加测试账号，待 GitHub Pages 发布及 Google 开放后再实登。详见 [发布步骤](docs/GITHUB-PAGES.md) 和 [安全记录](docs/SECURITY-2026-10-17.md)。

个人知识收件箱与本地资料库。浏览器负责收集、整理和离线保存；Windows 配套程序负责文件资料库、版本冲突和 Google Drive 同步。不运营应用云服务器，没有遥测或自动 AI 调用。

## 安装与连接

1. Chrome 120+ 打开 chrome://extensions，启用开发者模式，加载 extension 或 dist/pkm-nexus 文件夹。更新时保持原加载目录并重新加载，不要先卸载，以免删除浏览器内部数据。
2. 在扩展“设置与数据管理”点击“下载 Windows 本地应用”。下载后将 ZIP 解压到固定目录，双击 PKM-Nexus.exe，保留同目录 runtime 和 app 文件夹；更新前先退出旧版本。无需另装 Node、数据库或 Google Drive 桌面客户端，下载不依赖外部网站。
3. 安装后显示同步助手小窗口；最小化或关闭会收进右下角托盘，双击图标恢复。点击“设置与资料管理”，填入扩展 ID 并连接；返回扩展点击“连接并启用本地资料库”。已有记录与附件会交接。
4. 点击“登录自己的 Google 账号”，在系统浏览器选择自己的账号并授权。0.7.3 已内置 PKM Nexus 的桌面应用 OAuth 客户端，普通用户无需创建 Google Cloud 项目或导入 JSON。授权及远程资料库归属每位用户独立；具体说明见 [COMPANION.md](docs/COMPANION.md)。
5. 第一台电脑创建 Drive 资料库；第二台用同一 Google 账号和 OAuth 应用登录，选择同一个资料库。身份以文件夹 ID 为准。
6. 点击“立即同步”；需要后台同步时，在本地程序中明确启用每小时同步。

尚未连接本地程序时，浏览器仍能离线收集、整理和备份。未配置 Google 时也能使用本地资料库。当前是开发版本，真实账号联调状态见 [VALIDATION.md](VALIDATION.md)。

## 数据流与保存状态

浏览器扩展 ↔ Native Messaging ↔ 本机资料库 ↔ Google Drive API ↔ 另一台电脑。

- “已保存到浏览器”：记录已持久化，尚未确认写入本地程序。
- “已保存到本地资料库”：本地程序已确认写入；待传 Drive 数量单独显示。
- “上次 Drive 同步”：显示这台电脑完成远端同步的时间；其他电脑需要各自同步。
- 网络、权限或授权失败保留本地数据，并显示具体失败状态。冲突保留各版本，在本地管理界面处理，其他记录可继续同步。

Chrome 运行且本地连接已启用时，保存后交接，并每分钟通过浏览器后台任务重试和接收本地更新；不依赖收集页面保持打开。关闭 Chrome 后，Windows 每小时任务仍可同步已交接的数据。关机、睡眠、用户未登录或断网时不承诺执行，恢复后补同步。尚留在浏览器的数据要等 Chrome 再次运行。

## 收集与整理

- 工具栏打开侧栏，Alt+Shift+S 或右键收集选中文字、链接或图片；Alt+Shift+K 打开整理页。快捷键可在 chrome://extensions/shortcuts 调整。
- 普通记录、PNG 可见区域网页快照、唯一 Todo/Idea 清单、网页组共用记录格式；支持 Markdown、粘贴图片及主动录音，单附件最多 20 MiB。
- 连续收集追加到当前笔记的 collected 区域；收集内容先进入编辑器，保存后进入收件箱。
- 标签单层多选；项目支持树形层级、多项目归属及项目内关系图。喜爱、人工总结、清单勾选和网页组状态参与同步。
- 标签仅显示名称，不带记录数。“已整理”可按全部记录、已在项目、未在项目筛选，并与搜索、类型和标签组合；已删除项目不计入项目归属。
- 置顶、空标签组、标签颜色、主题和字体属于本机界面偏好。
- “主题与字体”提供 Vintage Vinyl、Hawaiian Surf、French Vintage、Spiced Chai、Ocean Mist、Matcha Forest 六套色卡。点击预览，保存后应用到整理页、侧栏与帮助页；取消恢复原主题，切换配色保留字体设置。
- 网站访问按需授权；快照使用 captureVisibleTab，受 Chrome 页面权限限制。未授权时可以手动记录。
- 内置六条离线示例，可预览后加入个人收件箱；重复加入不会覆盖编辑或删除状态。

完整图文说明见 [使用说明书.md](使用说明书.md)，应用内也提供离线帮助。

## 资料库与备份

本地资料库保存 records 下的 JSON、assets 下的附件、readable 下的 Markdown 阅读视图，以及 .nexus/revisions 下的不可变修订。SQLite 是本机索引和同步状态，不上传到云端。Markdown 为派生阅读视图，外部 JSON 修改需在本地程序中显式导入。

Drive 存放不可变修订批次和附件；它提供跨设备存储，版本比较与冲突处理由本地程序完成。不要直接编辑或删除 Drive 内的同步批次。

“保存到本地”导出完整 ZIP，含 backup.json、记录、图片、录音、Markdown、草稿及待处理收集；“导出 Markdown（含图片 ZIP）”提供可阅读笔记及附件。未缓存附件按需加载并校验，缺失时停止打包。ZIP 支持最多 512 MiB、60,000 个文件。备份不包含 Google 凭证。

卸载扩展前先导出完整 ZIP。卸载配套程序保留知识资料库；删除当前正文、远端同步副本和独立备份是不同操作。同步不能替代独立备份。

## 开发与验证

需要 Windows x64 和原厂签名 Node 24。运行 npm ci、npm run prepare:companion、npm test、npm run lint。prepare:companion 准备带 SHA-256 清单的目录。使用本机杀毒软件扫描当前程序目录，保留报告和逐文件扫描清单；运行 npm run build:companion 生成程序 ZIP，再用 npm run build 生成含内置下载的完整插件。构建要求扫描覆盖全部 EXE、报告不早于当前构建、原厂运行时签名有效且所有文件与清单相符。普通应用 EXE 尚未签名时如实记录，不因此永久关闭下载。npm run prepare:extension 仅供 CI 无安装包预览。二进制不纳入源代码版本控制。

原生小窗口使用系统自带的 .NET Framework WinForms 与 NotifyIcon；隐藏启动未经改写的官方 Node 和可读源码。独立 Native Messaging 桥只运行固定入口；受限 Windows 辅助程序处理 DPAPI、当前用户注册与任务。没有脚本安装器、二进制注入、签名移除、编码命令或安全软件排除操作。发布时可将桌面 OAuth 客户端 JSON 放在 companion/google-oauth.json（已忽略），或通过 PKM_NEXUS_GOOGLE_CLIENT_FILE 指定；不允许内置用户令牌或服务账号。

- npm run companion:serve：本地管理界面，输出一次性管理链接。
- npm run companion:sync：立即执行一次 Drive 同步。
- npm run test:companion：本地资料库、Native Messaging 协议、OAuth、DPAPI、Windows 任务及 Drive HTTP 适配器测试。
- node --test tests/sync-e2e.test.js：两套 IndexedDB 与两套本地资料库，经真实 Drive 适配器和模拟 Google HTTP 端点验证完整数据链路。
- npm run test:browser / test:media-browser / test:types-browser：隔离 Chromium 界面回归，测试桥替代 Native Messaging 传输，使用正式 Companion 与 Drive 模块。
- npm run test:companion-browser：隔离 Chromium 与打包 EXE 验证真实 Native Messaging，使用独立的测试主机名称与临时资料库，保留用户已有主机注册。
- npm run test:desktop：真实 WinForms 窗口、托盘、隐藏服务、最小化 / 关闭恢复、单实例和退出清理，使用临时资料库。

测试不连接真实云账号。Windows 任务、DPAPI 和回环 HTTP 测试需要正常本机权限，受限沙箱可能禁止执行。真实 Google OAuth、双设备和后台任务验收必须单独记录。

当前规范：[ARCHITECTURE.md](docs/ARCHITECTURE.md)、[DATA-SCHEMA.md](DATA-SCHEMA.md)、[PRIVACY.md](PRIVACY.md)。
