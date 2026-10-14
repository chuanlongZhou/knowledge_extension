# PKM Nexus 待办清单

来源：[REVIEW.md](REVIEW.md)（2026-10-14 评审）。编号后的 `R§` 指向评审文档中的对应条目。完成后勾选，并在条目末尾注明对应的提交或 PR。

## P0 · 立即修复（已确认 bug）

- [ ] `app.js` 补充 `TASK_STATUSES` 导入，修复回收站中有旧版 todo 时列表渲染崩溃的问题；补一条浏览器回归测试。（R§4-1）
- [ ] 修正恢复录音的 `duration_ms`：改为按实际录音时长计算，例如记录每个片段的时间戳或 `ended_at`，不再使用 `Date.now() - created_at`。（R§4-2）
- [ ] 回收站里的旧版 todo 也执行迁移，或在渲染时容忍 `task_status`，二选一。（R§4-1）

## P0 · 工程底线

- [ ] 接入 ESLint（至少开启 `no-undef`、`no-unused-vars`）和 Prettier，对现有代码做一次纯格式化提交，与逻辑改动分开。（R§4-11、12）
- [ ] 添加 GitHub Actions：在 Node 22 上运行 `npm test` 和 lint；浏览器测试可作为手动触发或夜间任务。（R§4-12）
- [ ] 浏览器测试改为支持环境变量配置 `executablePath` / `channel`，不再写死 `channel: 'chromium'`。（R§4-15）

## P1 · 同步健壮性（下一版本核心）

- [ ] 写入改用 `POST /git/trees` 的 `tree[].content` 内联提交文本记录和索引，避免逐条 `POST /git/blobs` 触发二级限流；附件仍走 blob。（R§3.2-D2）
- [ ] 首次拉取和扫描重建改为批量读取，例如 `zipball/{sha}` 或 GraphQL 批量读取 blob，并加并发上限、限流退避（读取 `Retry-After` / `x-ratelimit-reset`）。（D1、D7）
- [ ] 已暂存的拉取进度在重试之间保留：不要每次同步开始都 `clearStaging()`，或者按远程 commit 校验后复用。（D1）
- [ ] 请求超时按体积调整：附件上传和下载的超时随大小线性增加，或者改为“无进展超时”。（D6）
- [ ] 存在冲突时，仍先提交和应用无冲突部分，冲突记录保持 dirty 并单独处理。（D4）
- [ ] 三方合并：从 `lastSyncCommit` 取回 base 版本：
  - [ ] 清单（`list`）按项目 ID 合并：增、删、勾选状态分别合并；
  - [ ] 网页组（`url_list`）按项目 ID 合并，`read_at` 取较新值；
  - [ ] 普通记录做字段级合并：tags、sources、attachments 取并集，只有一侧修改的字段自动采用。（D5）
- [ ] 冲突界面用字段级 diff 替代原始 JSON 编辑框。（D5）
- [ ] `migrateTodos` 加 `navigator.locks` 互斥，或移到 Service Worker 中执行一次。（R§4-4）
- [ ] 右键收集统一用 `executeScript(getSelection)` 获取文字，保留换行；拿不到时才回退到 `selectionText`。（R§4-5）
- [ ] 修复 `open()` 在 `onblocked` 后缓存 rejected Promise 的问题。（R§4-9）

## P1 · 兼容与发布

- [ ] 前向兼容策略：
  - [ ] `schema_version` 高于本机支持版本时，明确提示“请升级插件”，并列出受影响的记录；
  - [ ] 同版本内的未知字段原样保留（pass-through），参与哈希但不报错。（R§4-6）
- [ ] 在仓库中写入 `meta.json`，记录最低客户端版本，同步前检查。
- [ ] 决定分发方式（Chrome 商店 / 自托管 `update_url` / 继续手动加载），并写进 README。（R§2.2-5）
- [ ] 收紧权限：网页标题抓取改为 `optional_host_permissions` 运行时申请，评估去掉常驻 `<all_urls>` 的可行性。（D10）

## P2 · 规模化与性能

- [ ] 全局索引瘦身，只保留 `id/path/hash/updated_at/type/deleted_at`；预览字段只放在本地 catalog。（D3）
- [ ] 索引分片，例如 `index/YYYY-MM.json` 或按 ID 前缀，同步时只重写变化的分片。（D3）
- [ ] 草稿自动保存不再广播全量刷新：区分 `draft` 与 `records` 两类变更事件；`refresh()` 不再每次 `allCatalog()`，计数改为增量维护。（D8）
- [ ] 本地附件回收：删除不再被任何记录、草稿、待处理收集或冲突引用的附件；完整备份只打包被引用的附件。（D9）
- [ ] CRC32 改为查表实现，并把打包放进 Worker；为备份和导入加进度和取消。（R§4-8）
- [ ] ZIP 条目写入真实的 DOS 时间戳。（R§4-10）
- [ ] 用 10k / 50k 条记录、1 GB 附件的仓库实测首次同步、增量同步和备份的耗时与请求数，写入 VALIDATION。

## P2 · 代码整理

- [ ] 删除死代码：`Database.reconcile()`、`scope` 参数和 `scope === 'local'` 分支、`media.preview(text)` 的无用参数。（R§4-13）
- [ ] 把 `app.js` 拆成模块：`views/list`、`views/settings`、`views/conflict`、`views/import`、`state`。（R§4-14）
- [ ] 卡片局部更新（按 `id` diff），避免整列表重建，同时保留卡片内的 Todo/Idea 切换状态。（R§4-14）
- [ ] 给 `model.js` 的 Record / Attachment / ListItem / WebsiteItem 加 JSDoc 类型，并在 CI 中运行 `tsc --checkJs`。
- [ ] 集中管理 schema 迁移：显式的 `migrations = {1→2, 2→3, 3→4}` 链，配合单元测试。（D11）
- [ ] 统一“待同步”计数口径，回收站中的 dirty 记录也要显示。（R§4-7）

## P2 · 文档

- [ ] 修正 VALIDATION 中关于 `dist/PKM-Nexus-0.4.0.zip` 的描述：要么让 `build.mjs` 生成 zip，要么删除这句。（R§4-15）
- [ ] README 补充 macOS / Linux 命令（`npm` 而不是 `npm.cmd`）。
- [ ] 添加 LICENSE。
- [ ] 把 `PKM-Nexus-design-v0.2.md` 移到 `docs/history/`；README 只指向 `DATA-SCHEMA.md` 作为当前规范。（R§4-16）
- [ ] 添加 CHANGELOG，记录 v1→v4 的数据格式变化和升级注意事项。

## P3 · 产品方向（需要先做决策）

- [ ] **Markdown 互通**：选一种方案并确定是否作为默认：
  - A：仓库内额外生成只读的 `notes/*.md` 镜像（改动小）；
  - B：主存储改为 Markdown + YAML front-matter（改动大，Obsidian 等工具可直接编辑，但需要重新设计哈希和校验）。（R§2.2-1）
- [ ] **整理 / 复用环节**：
  - [ ] 收件箱“处理模式”：逐条决定整理、删除或推迟（GTD 式清空）；
  - [ ] 定期回顾：按时间或随机抽取旧记录；
  - [ ] 记录间链接（`[[id]]` 或标题），以及“相关记录”提示；
  - [ ] 一键导出所选记录为一份 Markdown，方便交给 AI 或写作工具整理（符合“用户主动 AI 整理”的定位）。（R§2.2-4）
- [ ] **范围评估**：清单和网页组是否继续留在核心范围，还是拆成可选模块。（R§2.2-4）
- [ ] **移动端收集**：最小方案是用 iOS 快捷指令或 Android 分享，通过 GitHub API 写入 `inbox/` 目录，下次桌面同步时导入。
- [ ] **大型媒体**：评估把附件放到 Git LFS 或用户自选的对象存储，避免仓库无限膨胀。
