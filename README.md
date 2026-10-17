# PKM Nexus 0.8.0 · Google Drive 简化版

浏览器负责离线收集与整理，扩展直接连接用户自己的 Google Drive。仅在点击“同步下载”或“同步上传”时传输数据；ZIP 导出是独立备份。

## 开始使用

1. 原版用户先导出完整 ZIP，再在 chrome://extensions 加载简化版 dist/pkm-nexus。简化版使用新固定 ID，与原版的浏览器数据独立；导入 ZIP 后可继续使用。后续更新保持相同公钥并重新加载，不先卸载。
2. 设置 → Google Drive → 登录 Google Drive，使用自己的 Google 账号。
3. 全新用户“新建并使用文件夹”；新设备“选择已有文件夹”，选择同一账号下由本简化版创建的文件夹。
4. 新设备先“同步下载”，把云端记录和图片、音频下载到浏览器。
5. 编辑后“同步上传”，只上传新增及修改记录，更新对应云端文件。
6. 随时“导出备份”，保存含 JSON、Markdown、附件、草稿和项目关系的完整 ZIP；可在设置中预览并导入。

文件夹只显示同一应用创建且当前账号拥有的简化版数据文件夹。Drive 的 drive.file 权限不能浏览所有私人文件；旧版数据先导出完整 ZIP，再导入本简化版的新文件夹。

## 文件与冲突

- 每条普通记录、快照、清单、网页组、项目分别使用一个稳定 ID 的 JSON 文件；附件按 SHA-256 单独保存并复用。文件标题修改不会产生另一条记录。
- 下载只读取云端，上传只写入云端；两者不会自动执行另一个方向。下载不清空浏览器独有记录。
- 删除通过记录的删除状态和删除标记传播；不会因为文件列表暂时缺项就删除浏览器记录，也不会永久删除 Drive 中的其他文件。
- 上传比较上次同步基线与云端版本，使用 Drive 资源 ETag 进行条件更新。两台设备同时修改同一记录时，保留版本并提示选择。选择后先同步下载应用选择；选择浏览器版本后再同步上传。不同记录不会整体覆盖。
- 项目、子项目和关系图引用其他记录；下载在一个 IndexedDB 事务内验证这些关联。关联冲突未解决时，不会部分写入有问题的关系图。
- 一台浏览器固定绑定一个账号和文件夹。退出登录保留浏览器记录与绑定信息；需要使用另一份资料时，在新的 Chrome 配置中连接，防止串用。
- 备份不包含 Google 令牌、登录状态或同步绑定；导入不会替换 Google 身份。

## 收集与外观

支持 Markdown、网页链接与选中文字、PNG 可见区域快照、Todo/Idea 清单、网页组、主动录音、粘贴图片、标签、多项目归属、项目树和关系图。网页与麦克风访问按需授权。

标签仅显示名称；“已整理”可筛选已在项目、未在项目，并与搜索、标签和类型组合。已删除项目不计入归属。

主题与字体提供六套配色：Vintage Vinyl、Hawaiian Surf、French Vintage、Spiced Chai、Ocean Mist、Matcha Forest；保存后跨整理页、侧栏和帮助页应用。

## 开发者一次性 Google 配置

普通用户只需登录自己的账号；扩展发布者需要先完成：

1. 在 Google Cloud 启用 Drive API，并配置 OAuth 同意屏幕。Testing 阶段须为真实验收账号添加测试用户。
2. 创建或更新类型为“Chrome 扩展程序”的 OAuth 客户端，绑定简化版固定 ID `jjpdanoikikedmildkmhndmbjnajjaho`。原版 ID 为 ihmbeohbhfkaonhdpgdgbmemengmjken，两者不同。
3. 运行 `node scripts/configure-google.mjs CLIENT_ID.apps.googleusercontent.com`，再重新加载同一目录。这里使用公开客户端 ID，不使用客户端密钥，不沿用桌面应用客户端。
4. 每台设备必须使用同一应用注册和 Drive 权限范围。不要为每位用户创建客户端。
5. 使用两个隔离 Chrome 配置验收真实登录、创建文件夹、新设备下载、上传覆盖、同记录并发修改和登出。本地自动化模拟不等于真实 Google 验收。

本分支已配置用户提供的客户端 ID `464495637351-1gso1qnr3l9i4orm0q7e2e7lf90fkbs3.apps.googleusercontent.com`，并保存固定 manifest.key。请先将 Google 端客户端绑定更新为上述新 ID，再完成真实账号授权；尚未验证 Google 端实际绑定。

跨设备解压加载时保持仓库中的 manifest.key。`node scripts/extension-identity.mjs` 会显示当前固定 ID，有 key 时不会重新生成；有另一扩展公钥时可将公钥作为 `configure-google.mjs` 的第三个参数。改变身份会使用另一浏览器数据空间，不要在保留现有数据的原目录中随意替换公钥。日后通过 Chrome Web Store 发布时须以商店实际分配的身份重新核对 OAuth 绑定。

官方参考：[Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity)、[Drive 文件权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Drive v2 文件 ETag](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)。

## 构建与验证

Node 22+：`npm ci`、`npm run lint`、`npm test`、`npx playwright install chromium`、`npm run test:drive-browser`、`npm run build`。

输出 dist/pkm-nexus 和 dist/PKM-Nexus-0.8.0-direct-drive.zip。发行包只包含扩展与文档。

分支 codex/ui-themes-companion 保存 0.7.3 的完整功能；codex/direct-google-drive 为本简化版。旧版本代码与历史测试留作迁移参考，不进入简化版发行包的运行流程。
