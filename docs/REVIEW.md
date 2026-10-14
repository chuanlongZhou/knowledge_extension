# PKM Nexus 0.4.0 项目评审

评审日期：2026-10-14 · 评审对象：`main` 初始提交 `08fe22b`（PKM Nexus 0.4.0）
配套待办清单：[TODO.md](TODO.md)

评审方式：通读全部运行代码（约 190 KB JS）、三份文档和测试；在本机运行 `npm test`（48/48 通过）；用 Playwright + 本地 Chromium 编写独立脚本复现了下文标为“已复现”的问题。仓库自带的浏览器测试因写死 `channel: 'chromium'`、本环境 Playwright 浏览器版本不匹配而未能直接运行（见 TODO P2）。

---

## 1. 总评

| 维度 | 评价 | 一句话 |
| --- | --- | --- |
| 理念 | ★★★★☆ | 本地优先、数据自持、无服务器、手动同步，边界清楚；但“开放格式”只做到一半 |
| 架构设计 | ★★★★☆ | 同步的数据一致性设计明显高于同类个人项目；规模化与 GitHub 限流考虑不足 |
| 代码正确性 | ★★★☆☆ | 关键路径严谨，有测试；但存在可复现的界面崩溃和若干边界 bug |
| 可维护性 | ★★☆☆☆ | 代码近似“手写压缩”风格，单行数百字符，无 lint / 类型 / CI，这是最大风险 |
| 产品完成度 | ★★★☆☆ | “收集”环节完整，“整理 / 提炼 / 复用”环节薄弱；功能面在向待办和标签页管理扩散 |

结论：**作为个人工具已经可用，数据安全底线做得好；下一阶段最应该投入的不是新功能，而是 (1) 修复已确认 bug，(2) 让同步能撑过 GitHub 限流和数千条记录，(3) 让代码可读、可审查。**

---

## 2. 理念评价

### 2.1 做得对的地方

- **本地优先 + 用户自有仓库**：IndexedDB 为主副本，GitHub 私有仓库只做同步与历史，没有自建服务器、遥测和 AI 调用。这种方案接近 Ink & Switch 提出的 local-first 软件七条理想（离线可用、数据归用户、长期可读等），对个人知识库是正确的出发点。
- **“同步时机由用户决定”**：所有写操作只落本地，点击才同步。行为可预期，便于审计，也避免后台静默覆盖。
- **不静默丢弃**：重复内容进入“待处理收集”，冲突保留双方，删除使用 tombstone 防止旧设备复活；“移除正文 ≠ 抹去 Git 历史”这类说明写得很诚实。
- **边界自觉**：v0.2 设计文档明确列出“后置”项，没有追求 AI、图谱、协同等大而全的功能。

### 2.2 值得质疑的地方

1. **“开放格式”只做到一半。** 仓库里每条记录是 canonical JSON（正文放在 `content` 字段里），不是 Markdown 文件。好处是 schema 严格、可以用哈希校验；代价是 Obsidian、Logseq、VS Code、GitHub 网页等工具无法直接阅读和编辑。“数据属于用户”在法律和物理意义上成立，在**可用性**意义上偏弱：离开这个插件，用户手里是一堆 JSON。Markdown 只出现在本地 ZIP 备份里，没有进入仓库。
2. **手动同步与“单例清单”互相冲突。** 手动同步拉长了两次同步的间隔，冲突概率随之上升；而全局唯一的 `nexus-list` 是编辑最频繁的记录（勾选待办）。两台电脑各勾一项就是一次整条记录级冲突，用户需要在原始 JSON 里手动合并最多 5,000 项。清单项和网页组的网址都有稳定 ID，本可以按项目做三方合并，现有设计没有利用这一点。
3. **用 Git 当数据库的代价被低估。** Git 提供了版本历史和免费托管，但它不擅长：大量小文件的逐个读取（REST API 限流）、二进制媒体（历史无法瘦身，仓库建议 < 1 GB）、频繁整体重写的大文件（全局索引每次同步重写一次）。这些问题在几百条记录时不可见，在几千条时会集中出现（见 §3.2）。
4. **产品重心在扩散。** 四种类型里，“唯一清单”是待办应用，“网页组”是 OneTab 类标签页管理，再加上截图和录音。每一项都实现得很细，例如标签页关闭前多次校验导航状态，但它们都在“收集”环节加深，而知识管理的长期价值主要来自“整理和复用”。
   - GTD（David Allen）把收件箱看作“清空”的起点，强调定期处理；
   - CODE / PARA（Tiago Forte）要求 Capture 之后还有 Organize → Distill → Express；
   - Zettelkasten（Luhmann，及 Sönke Ahrens《How to Take Smart Notes》）更激进地认为未经加工的摘录几乎没有价值，并警惕“收藏者谬误”（collector's fallacy）。
   不论采用哪一派，本项目目前只覆盖 Capture 和一点点 Organize（标签、关键词规则、已整理开关）；检索只有子串匹配、按更新时间排序，没有双链、回顾、摘要提炼和导出到写作工具的路径。
5. **没有移动端和自动更新。** 插件以未打包方式加载，没有商店分发，因此不会自动更新；而数据校验对未知字段“遇到即停止”（见 §4 P1-6），版本不一致的两台电脑会直接卡住同步。README 要求“所有电脑使用同一版本”，靠用户自律保证。

---

## 3. 设计评价

### 3.1 亮点（值得保留）

- **三方版本判定**：`classifyVersion(localHash, baseHash, remoteHash)`（`extension/lib/sync.js:3`）基于内容哈希而非时间戳，不受时钟漂移影响。
- **单次提交原子性**：记录、附件、索引通过 Git Data API 放进同一 commit；`PATCH refs` 使用 `force:false`；响应丢失后重新读 ref 核对（`extension/lib/github.js:146` 起）。
- **暂存后事务落库**：拉取内容先写入 `staging`，最后在单个 IndexedDB 事务中按 `rev` 核对应用（`db.js:273`），同步期间用户的新编辑不会被覆盖。
- **远程完整性校验**：读取的记录必须与索引哈希一致，附件校验 SHA-256 和大小；远程缺失曾经同步过的记录时停止，而不是当作删除。
- **附件按内容寻址**（`assets/<sha256>.<ext>`）、按需下载，并记录 `remote_commit`，即使远程已删除附件也能从历史提交取回。
- **安全细节**：Token 用 `setAccessLevel(TRUSTED_CONTEXTS)` 隔离；请求路径限制在目标仓库；`redirect:'error'`；渲染全部走 `textContent`，URL 经 `safeUrl` 过滤；外部网页标题请求 `credentials:'omit'`，有 512 KiB 和 6 秒上限。
- **测试设计**：fake-indexeddb + 模拟 Git API，覆盖双设备、竞争提交、响应丢失、同步中编辑、导入回滚等难测场景。

### 3.2 结构性问题

| # | 问题 | 位置 | 影响 |
| --- | --- | --- | --- |
| D1 | **新设备首次同步逐条请求**：每条远程记录一次 contents API 请求，串行执行 | `sync.js:32`、`github.js:readRecord` | N 条记录需要 N 次请求。个人 Token 的主限流约 5,000 次/小时（据 GitHub REST 官方文档；评审时未联网复核具体数值），超过数千条就会中途 403；而且每次同步开始都会 `clearStaging()`，已拉取的进度作废 |
| D2 | **每条变更单独创建 blob**：`POST /git/blobs` 逐条调用 | `github.js:123,129,139` | 创建 blob 属于“内容生成类请求”。GitHub 文档给出的二级限流约为每分钟 80 次、每小时 500 次（同上，需以最新文档为准）。导入备份后首次同步、批量打标签或应用关键词规则后，变更数很容易超过 500。文本记录可以改用 `POST /git/trees` 的 `tree[].content` 内联提交，整次同步只需几次请求 |
| D3 | **全局索引每次整体重写**，且包含 `sources`、`attachments`、`list_preview`、`url_preview`、正文前 160 字 | `model.js:metadata`、`github.js:136` | 索引体积约等于 O(记录数)，每次同步都要整份下载和上传，并在 Git 历史中留下一份新 blob。建议按月或按 ID 前缀分片，索引只保留 `id/path/hash/updated_at` |
| D4 | **任何一条冲突都会阻塞整次同步**：发现冲突后直接返回，不推送、也不应用其他远程变更 | `sync.js:36` | 一条清单冲突就让其他几百条正常变更全部暂停。可以先提交无冲突部分，冲突记录保持 dirty |
| D5 | **冲突只能整条记录二选一或手写 JSON** | `app.js:openConflict` | 对非开发者不友好。仓库本身就是 Git，可以按 `baseHash` 从上次同步的提交取回共同祖先，做字段级或清单项级三方合并 |
| D6 | **单个请求 25 秒超时同样作用于 20 MiB 附件** | `github.js:24` | Base64 编码后约 27 MB 的上传需要约 9 Mbps 以上的上行带宽才能在 25 秒内完成，上行慢的网络会稳定失败。超时应按请求体大小调整 |
| D7 | **扫描重建**同样逐文件请求，并受 `tree.truncated` 限制 | `github.js:readRemote` | 与 D1 相同；可改用 `zipball/{sha}` 一次下载（需要允许跳转到 codeload），或用 GraphQL 批量读取 blob |
| D8 | **每次草稿自动保存都会广播一次全量刷新**：`setState` → `changed()` → BroadcastChannel → 所有打开的窗口执行 `refresh()`，即 `allCatalog()` + `duplicateIds()` + 重建全部卡片 | `db.js:48`、`app.js:refresh` | 打字期间每 300 ms，侧栏和整理页都会读取整个目录。数据量上万时会卡顿，也与“列表只读一页元数据”的说法不一致 |
| D9 | **本地附件永不回收**：`assets` 表没有删除路径；完整备份会打包 `asset_catalog` 中的全部描述，包括已经不被引用的附件 | `db.js`、`backup.js:descriptorsOf` | 浏览器存储只增不减；离线时只要有一个孤儿附件没缓存，备份就会失败 |
| D10 | **权限面偏大**：`<all_urls>` + `tabs` + `scripting`，CSP `connect-src https: http:` | `manifest.json` | 若要上架 Chrome 商店，审核阻力大。可以把网页标题抓取改为 `optional_host_permissions` 运行时申请 |
| D11 | **schema 迁移靠零散条件判断**：v1–v4 的升级逻辑分散在 `normalizeRecord` / `upgradeRecord` / `migrateTodos` 和 IndexedDB 升级回调里，`scope:'local'` 等已废弃概念仍残留在约 30 处代码 | 多处 | 每加一个版本，组合复杂度都会上升 |

---

## 4. 代码问题清单

严重度：**P0** 已确认 bug，会导致界面不可用或数据错误；**P1** 实际使用中会遇到的正确性或健壮性问题；**P2** 质量和维护问题。

### P0

1. **回收站视图崩溃：`TASK_STATUSES` 未导入**（已复现）
   `extension/app.js:147` 使用了 `TASK_STATUSES[m.task_status]`，但 `app.js` 的 import 列表里没有它。`migrateTodos` 只迁移**未删除**的旧待办，所以回收站里的 v1/v2 `todo` 会一直保留 `task_status`。打开回收站时 `renderCards` 抛出 `ReferenceError`：计数显示“1 条记录”，列表为空，并弹出错误提示。修复只需补一行 import。
2. **恢复的录音时长错误**（已复现）
   `db.js:78` 中 `finishRecording` 的时长按 `Date.now() - created_at` 计算。从设置页“恢复中断录音”时，这个值等于录音开始到恢复之间经过的时间：3 天前中断的录音会记成 72 小时，并永久写入记录、同步到仓库。应改为累计片段时长，或者在中途保存 `ended_at`。

### P1

3. **D1 / D2 / D6 的限流与超时问题**（见 §3.2）是当前最可能导致“同步失败、用户不知道原因”的来源，按 P1 处理。
4. **多窗口同时启动时 `migrateTodos` 竞争**：`initialize()` 中每个页面（侧栏和整理页）都执行 `migrateTodos(db)`（`app.js:331`）。存在旧待办时，两个页面并发保存同一条清单，后者会抛出 `StaleEditError`，`initialize` 失败并显示“无法打开本地数据库”。应该用 `navigator.locks` 包裹，或改在 Service Worker 中执行一次。
5. **右键菜单收集丢失换行**：右键入口使用 `info.selectionText`（`background.js:48`）。Chrome 提供的这个字段会压缩空白（社区普遍反映的已知行为，建议实测确认），代码片段和多段文字会挤成一行；快捷键入口用 `getSelection()` 则没有这个问题。两条入口应统一走 `executeScript`。
6. **前向兼容性：未知字段直接停止同步**：`model.js:42` 遇到未知字段就抛错。未来 v5 设备写入一个新字段后，所有 v4 设备的同步都会停住，而插件没有自动更新。建议：(a) `schema_version` 高于本机支持版本时给出明确的“请升级插件”提示；(b) 同一版本内的未知字段原样保留（pass-through），不做丢弃也不报错。
7. **“待同步”计数口径不一致**：状态栏统计所有 `dirty`（`app.js:104`），左侧“待同步记录”计数和列表都排除了回收站。用户删除记录后会看到“1 项待同步”，但待同步列表为空。
8. **ZIP 的 CRC32 逐位计算，并在 UI 线程运行**：`zip.js:3`。实测 50 MB 需要 3.2 秒，按此推算，512 MB 上限约 33 秒，期间页面无响应。改用查表实现可以快约 8 倍，也可以放进 Worker 或使用 `CompressionStream`。
9. **IndexedDB `onblocked` 后 Promise 被缓存为 rejected**（`db.js:39`）：当前页面之后所有数据库操作都会失败，只能刷新页面恢复。
10. **ZIP 条目时间戳为 0**：解压工具会把文件日期显示为 1980-01-01。影响很小，顺手修即可。

### P2（可维护性）

11. **代码风格接近压缩产物**：`app.js` 47 KB 只有 338 行，全仓库有 106 行超过 300 字符，`editor.js` 单行最长数千字符。人工审查、`git diff` 和定位 bug 都很困难。这是本项目最大的长期风险，它让 §3.1 中那些严谨的设计无法被他人验证。
12. **无格式化、lint、类型检查和 CI**：没有 `.github/workflows`、ESLint 或 Prettier。上面的 P0-1 是典型的“未定义变量”错误，任何 lint 都能在提交前发现。
13. **死代码与历史残留**：`Database.reconcile()` 无调用；`save()` / `captureInto()` 的 `scope` 参数已被忽略；`sync.js` 的 `scope === 'local'` 分支已不可达；`media.preview(text)` 的参数未使用。
14. **`app.js` 是单体脚本**：全局 `state`，每次刷新都 `replaceChildren` 重建全部卡片（卡片内 Todo/Idea 的切换状态因此被重置）。不必引入框架，但应按视图拆成模块。
15. **文档与实现不一致**：
    - `VALIDATION.md` 写着会产出 `dist/PKM-Nexus-0.4.0.zip`，但 `scripts/build.mjs` 不生成 zip；
    - 引用的 `test-results/*` 被 `.gitignore` 排除，证据不在仓库里；
    - README 只写了 Windows 命令（`npm.cmd`）；
    - 浏览器测试写死 `channel: 'chromium'`，无法复用预装的 Chromium。
16. **没有 LICENSE**；`PKM-Nexus-design-v0.2.md` 与 `DATA-SCHEMA.md` 有大段重叠，历史文档可以移入 `docs/history/`。

---

## 5. 还需要完成什么

按优先级整理为 [TODO.md](TODO.md)。概括如下：

1. **立即**：修复两个 P0；接入 ESLint、Prettier 和 GitHub Actions（`npm test`）。
2. **同步健壮性（下一版本的核心）**：用内联 tree 提交减少请求数，并对首次拉取批量下载，以避开限流；附件超时按大小调整；冲突不阻塞其他记录；用 Git 历史取回 base 版本，对清单和网页组做项目级三方合并。
3. **规模化**：索引分片并瘦身；草稿保存不触发全量刷新；附件回收；CRC 提速。
4. **兼容与发布**：确立前向兼容策略；提供版本不一致提示；选择分发方式（商店或自托管 `update_url`）；收紧权限。
5. **产品**：在仓库中同时生成 Markdown 镜像（或改为 Markdown + front-matter 存储），打通 Obsidian 等工具；补齐“整理 / 复用”环节（定期回顾、收件箱清空流程、双链或相关推荐）；重新评估清单和网页组是否属于核心范围。
