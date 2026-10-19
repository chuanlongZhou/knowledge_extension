# GUGA Knowledge 数据格式 v4

实现版本：0.9.1 简化版。用户收集的内容只有四种类型，共用 Record 表；项目为独立组织记录。图片与录音是普通记录的附件；`purpose` 已移除。

## 类型与对应界面

| type            | 中文入口 | 数据 / 界面                                                          |
| --------------- | -------- | -------------------------------------------------------------------- |
| `note`          | 普通记录 | Markdown、粘贴图片、主动录音、来源链接，可以同时存在于一条记录       |
| `snapshot`      | 网页快照 | URL + 当前可见页面的 PNG 图片；编辑器显示图片预览和下载入口          |
| `list`          | 清单     | 唯一清单，无名称；Todo / Idea 两个视图，分割线无文字；卡片可直接勾选 |
| `website_group` | 网页组   | 多个网址组成一组，允许多组归类；每个网址可单独标记已读               |

四个收集入口用 tab button 直接显示，不使用“类型”下拉。点击清单入口始终返回同一份清单。已有记录的编辑保持原 ID。

## Record 字段

| 字段                 | 类型            | 含义                                                   |
| -------------------- | --------------- | ------------------------------------------------------ |
| `schema_version`     | number          | 普通内容兼容 `4`，新增组织字段使用 `5`                 |
| `id`                 | string          | 普通记录、快照、网页组使用 UUID；清单固定 `nexus-list` |
| `type`               | string          | `note` / `snapshot` / `list` / `website_group`         |
| `title`              | string          | 标题，最多 500 字符；清单固定空字符串                  |
| `content`            | string          | Markdown 正文 / 备注，最多 1,000,000 字符              |
| `summary`            | string          | 可选人工摘要，默认空字符串，最多 2,000 字符            |
| `tags`               | string[]        | 标签，默认 `[]`                                        |
| `project_ids`        | string[]        | 关联项目 ID，默认 `[]`                                 |
| `organization_state` | string          | `inbox` 未分类 / `organized` 已整理                    |
| `created_at`         | string          | ISO 8601 UTC 创建时间，编辑不变                        |
| `updated_at`         | string          | ISO UTC 修改时间                                       |
| `deleted_at`         | string / null   | 回收站时间，正常为 `null`                              |
| `sources`            | Source[]        | 来源列表，默认 `[]`                                    |
| `attachments`        | Attachment[]    | 原始文件描述，默认 `[]`，不放二进制或 Base64           |
| `snapshot`           | Snapshot / null | 网页快照专用；其他类型为 `null`                        |
| `list`               | ListItem[]      | 清单专用；其他类型为 `[]`                              |
| `url_list`           | WebsiteItem[]   | 网页组专用；其他类型为 `[]`                            |

四种 v4 记录包含相同字段；专用字段必须与类型一致。没有 `purpose`、旧 `task_status`、`local_only` 或 `upload_enabled`。记录先保存在浏览器；只有用户点击同步下载或同步上传时才访问 Google Drive。捕获草稿不会自动进入收件箱或上传。

## Source

`{ url, title, captured_at, kind }`

URL 仅支持不含登录凭证的 HTTP / HTTPS；title 为来源标题；captured_at 为 ISO UTC 收集时间。kind 当前使用 `web_selection`、`web_page`、`web_link`、`web_image`、`manual`，保留旧来源类型。链接和图片收集同时保留来源页面及目标 URL。

## Snapshot

```json
{
  "url": "https://example.com/article",
  "title": "原网页标题",
  "captured_at": "2026-10-13T08:00:00.000Z",
  "format": "png",
  "asset_id": "对应附件的64位SHA-256"
}
```

asset_id 对应 attachments 中 MIME 为 image/png、kind 为 image 的文件。Chrome captureVisibleTab 截取当前可见页面，保存 PNG 图片，不再保存完整网页。切换标签页或页面导航会停止本次截图；单文件最多 20 MiB。它是可见区域截图，不是自动滚动的整页长图。

旧版本保存的 MHTML 仍可读取与导出，保留旧文件，界面标为旧版网页文件；新捕获只生成 PNG。

## ListItem：唯一清单的每一项

0.7.0 的清单编辑器在 `content` 写入包含 `## Todo`、`## Idea` 的 Markdown 文本；`list` 是同一内容的稳定 ID 交互投影，保留条目 ID、完成状态及分隔线顺序。输入普通文字并按 Enter 自动形成条目，输入 `---` 并按 Enter 形成分隔线；保存、勾选和迁移旧待办时同时更新 Markdown。旧清单读取保持原哈希，导出时只有正文末尾尚未包含当前条目的完整 Markdown 才从投影补充，保留历史备注并避免重复输出。

```json
{
  "id": "稳定的项目UUID",
  "kind": "item",
  "text": "下次整理收件箱",
  "is_checkbox": true,
  "checked": false
}
```

| 字段          | 含义                                                                             |
| ------------- | -------------------------------------------------------------------------------- |
| `id`          | 稳定项目 ID                                                                      |
| `kind`        | `item` 普通项 / `divider` 分割线                                                 |
| `text`        | 项目文字，最多 5,000 字符；分割线固定空字符串                                    |
| `is_checkbox` | true 属于 Todo，false 属于 Idea；分割线也用此字段标记所属视图，但不显示 checkbox |
| `checked`     | 待办是否完成；圆点与分割线固定 false                                             |

最多 5,000 项。选择 Todo 或 Idea 后添加项目或纯分割线，分别显示两种视图，仍然保存在同一条记录中。整份记录固定 ID 为 `nexus-list`；初始创建时间固定为功能发布日 `2026-10-13T00:00:00.000Z`，让不同电脑首次创建时使用相同文件路径。固定 ID 不允许用于其他类型。

同浏览器重复创建采用版本检查，不能生成第二份。不同电脑同时离线编辑进入正常记录级冲突处理，保留双方，不自动覆盖或拼接。

## WebsiteItem：网页组中的网址

```json
{
  "id": "稳定的网址项目UUID",
  "url": "https://example.com/read-later",
  "title": "以后阅读的文章",
  "added_at": "2026-10-13T08:00:00.000Z",
  "read_at": null
}
```

id 为组内项目 ID；url 为 HTTP / HTTPS 链接，最多 8,000 字符；title 最多 1,000 字符；added_at 为加入时间；read_at 为标记已读的时间，未读为 null，时间采用 ISO UTC。

每组最多 1,000 个网址。同组重复加入复用原项并保留阅读状态，去重忽略 utm 等跟踪参数，保留有意义参数与片段。不同组可保留同一网址。

## Attachment

`{ id, kind, name, mime_type, size_bytes, sha256, path, created_at, duration_ms }`

| 字段            | 含义                                                          |
| --------------- | ------------------------------------------------------------- |
| `id` / `sha256` | 原始文件 SHA-256，二者一致                                    |
| `kind`          | `image`（含 PNG 快照） / `audio` / `snapshot`（仅旧版 MHTML） |
| `name`          | 显示或下载的文件名                                            |
| `mime_type`     | 如 image/png、audio/webm、application/x-mimearchive（旧版）   |
| `size_bytes`    | 文件字节数，单附件最多 20 MiB                                 |
| `path`          | `assets/<sha256>.<扩展名>`，资料库根目录相对路径              |
| `created_at`    | ISO UTC 创建时间                                              |
| `duration_ms`   | 本插件录音时长，毫秒；其他附件为 null                         |

原文件独立保存在浏览器附件表及 Google Drive 的所选文件夹；下载时校验 SHA-256。备份和 Markdown 中图片使用 `![标题](assets/<hash>.png)`；录音使用 `[录音](assets/<hash>.webm)`。编辑器显示图片和播放器。音频文件添加入口已移除；旧备份中的音频继续兼容。

## 标签页收集与关闭

网页组支持手动 URL、多选当前窗口网页，以及将插件“已打开网页”的可拖动行拖入编辑区 / 已有网页组卡片。外部拖放提供正常 URL 时也支持；当前扩展不支持接管浏览器原生标签栏拖动；拖出会由浏览器创建新窗口。插件列表支持多选归组与列表内拖入，界面明确区分这两种来源。

拖入编辑区后点击保存，写入成功才关闭。拖入已有组卡片时，先追加到原组，完成数据库写入，再关闭。可取消“保存后关闭加入的标签页”。写入失败不关闭；关闭前再次检查 ID、当前 URL、导航中的 URL 和固定状态。发生导航或固定的网页保留。

浏览器 tab ID、窗口 ID、待关闭列表只存在于当前编辑会话，不写入 Record，不同步。重新打开草稿后网址仍在，但不会根据旧 tab ID 关闭网页。导入也不执行关闭操作。

## 存储、兼容与备份

```text
Google Drive 所选文件夹/
  records/<id>.json        一条记录、项目或删除标记的 JSON 信封
  metadata/tags.json        标签定义：空标签、颜色与描述
  assets/images/<hash>.*    图片
  assets/audio/<hash>.*     音频；旧 MHTML 等附件放在 assets
  <id>.json 等旧平铺文件   新版兼容读取，显式整理后保留 Drive 文件 ID
浏览器 IndexedDB/          记录、附件、草稿、同步基线及冲突
导出 ZIP/                  backup.json、records、按项目或标签整理的 notes、assets、recovery（如有）
```

项目为 v5 独立组织记录，不是第五个收集入口。旧项目关键词字段只做兼容读取，首次修改项目后移除。删除标记仅保留 schema_version、id、kind: tombstone、created_at、deleted_at，防止旧设备复活记录。

兼容 v1 / v2 / v3：读取不改变旧哈希，编辑时升级为 v4，ID 与时间保留。旧 purpose 转为正文“旧版备注”。旧独立 todo 在打开、同步或导入后汇入唯一清单，原记录保留为普通记录，文字不丢弃。

列表只读取元数据和有限项目预览。hash、rev、dirty、drive:row 同步基线及冲突属于浏览器状态，不属于 Record。Google 访问令牌由 Chrome Identity 缓存，不写入记录或备份。云端 JSON 为 `{ format: 'pkm-direct-record', version: 1, hash, record }`；文件 appProperties 中以 pkm_role、record_id 或 asset_id 标识用途。

扩展先上传附件，再新增或条件更新对应的记录文件。下载读取云端记录与附件，校验哈希，并在一个事务内提交记录、同步基线和冲突；并发编辑导致版本不匹配时回滚，项目关联验证失败时不部分应用。完整 ZIP 包含记录、Markdown、草稿、待处理收集和附件；未完成录音放入 recovery。缺失或校验失败的附件会停止打包。

升级同一个扩展请点击“重新加载”，不要先卸载；所有同步电脑应使用同一简化版及 Chrome OAuth 应用注册。旧版云端结构通过完整 ZIP 导出导入迁移。

实现依据：[Chrome pageCapture](https://developer.chrome.com/docs/extensions/reference/api/pageCapture)、[Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)。

## 网页标题和图标

网址数据仍保存完整 URL，但网页组和已打开网页列表只显示图标与单行标题，不展开 URL。标题优先使用已有标签页标题；外部链接在用户添加时请求目标网页，只解析有限的 HTML head，优先 og:title / title。页面拒绝请求时使用拖入链接的文字，没有可用文字则用简短站点名。请求有 6 秒超时、512 KiB 读取上限，不加载网页脚本、视频或其他资源，不附带 Google 授权凭证。

图标使用 Chrome / Edge 的 favicon 接口，缺少缓存时显示浏览器默认图标；不依赖外部图标服务。

## 麦克风授权

第一次录音打开可见的麦克风授权页。点击允许后请求浏览器授权，成功后关闭授权页并回到编辑器开始录音。已授权时直接录音；拒绝、取消、关闭或离开授权页会明确显示状态。提供独立的“麦克风设置”入口处理已被阻止的权限。只有主动开始录音才请求音频，录音期间显示状态与计时，停止后写入附件；每秒片段保存和中断恢复继续保留。

当前实现依据：[captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)、[favicon 接口](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)、[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。

## v5 项目、关系图与浏览状态（0.7.0）

- 标签为单层 `tags: string[]`；内容记录通过 `project_ids: ID[]` 加入多个项目。
- 项目使用 `schema_version: 5, type: project`，`project_ids: []`；`parent_project_id: ID | null` 表示唯一父项目。禁止自身父级、循环及不存在的父项目。
- 项目描述保存在 `summary`（最多 2000 字），外观为可选 `appearance: {color: '#RRGGBB', icon: string}`，图标最多 16 字符。
- `graph: {edges: [{id,source,target,label}], positions?: {[nodeId]: {x,y}}}`。每项目最多 10000 条边，说明最多 200 字；禁止自连、重复节点对与重复边 ID。坐标必须是有限数且绝对值不超过 100000。
- 图节点由直接成员和直接子项目推导，不另存容易过期的 nodes 数组。子项目作为一个元素，不能连接其内部记录或其他项目记录。
- `favorite?: boolean` 是记录喜爱状态；旧记录未设置时不补写字段，保持原哈希。
- `UrlItem.removed_at?: ISODate | null` 标记网页的划线删除；保留条目、URL 与 ID，可恢复；被划线条目不计入未读，也不用于关闭浏览器标签页。
- `graph.positions`、喜爱、项目描述及外观参与正常同步；从 0.8.3 起空标签、标签颜色及描述通过独立 tags.json 同步。
- 备份与直接同步的记录支持 v1–v5。读取旧记录不改变哈希；新增字段时升级相应记录。
- 移出成员、删除或合并记录会与清理相关边在同一浏览器事务中提交。导入与批量下载校验层级及图端点；不一致时停止并保留原数据。

## 0.7.0 界面偏好与内联总结

所有内容类型已共用 `summary`，图卡片直接编辑此字段（子项目为项目描述），最多 2000 字，参与正常同步。没有新增记录 schema。

`chrome.storage.local.uiTheme` 保存主题模式、六种颜色、七个区域的字体和字号、导航行距；跨扩展页面应用。它属于本机偏好，不进入资料库记录或数据备份。标签外观只使用颜色，旧 `icon` 偏好忽略。标签改名原子更新记录、待处理收集、草稿与本机名称 / 颜色映射；仅修改颜色不改变记录修订。

草稿 UI 可包含 `listEntryTodo`、`listEntryIdea`（未提交的一行输入），备份导入允许这两个字符串字段，仍清除旧浏览器标签页句柄。

## 0.8.3 标签定义同步

标签定义继续兼容 ui:tag-groups / ui:tag-styles，增加 library:tags:revision 保护并发编辑。同步时作为独立元数据单元，不进入内容记录列表或记录计数。云端 tags.json 的信封为 `{format:'guga-tag-library', version:1, hash, record}`，record 为 `{id:'guga-tag-library', type:'tag_library', version:1, title:'标签定义', definitions:[{name,color,description}]}`；appProperties 为 `{pkm_role:'tag_library', record_id:'guga-tag-library'}`。名称最多 100 字，描述最多 2000 字，颜色 #RRGGBB。整份标签定义是一个冲突单位，双方同时修改时保留版本供选择。

下载元数据与记录在同一 IndexedDB 事务内检查修订并提交；沿用哈希、Drive ETag 与条件更新。backup.json 增加可选 tag_library 字段，旧备份缺少该字段时不修改本机标签。导入合并不同名称，同名默认保留本机，显式勾选更新时采用备份定义；不导入 Google 绑定或凭证。旧客户端忽略新的元数据角色，各设备应更新到支持标签同步的版本。

## 0.8.4 增量读取与导出布局

IndexedDB 库版本升为 5，新增独立 driveCache（记录 schema 不变）。缓存包含 folderId、Drive fileId / version、稳定读取时的 ETag 与已校验的信封；列表版本相同才复用，复用前仍验证内容哈希，缓存损坏或缺少版本时重新读取。缓存版本来自与内容配对的稳定读取，不能使用更早的列表版本；缓存不覆盖本机未上传的记录，不代替同步基线，不导出。库升级保持已有 v4 库的记录哈希 / rev / dirty 和同步基线。读取与附件下载的并发上限均为 4，失败时等待在途任务结束再返回。

新目录带有 `{pkm_role:'directory', pkm_root:<rootId>, pkm_directory:<logicalPath>}`；只递归读取已识别的直属 / 子目录。记录及附件仍使用稳定 ID / 哈希文件名，身份和引用不依赖目录名。旧平铺文件与新文件可混合；显式整理只移动已识别的数据文件，不改内容、不复制、不删除未知文件，失败后重新预览剩余项。所有设备先升级后再使用新目录。

导出 groupBy 支持 project / tag / none。notes 使用清理后的原始项目 / 记录名称，重名增加稳定短 ID；project 保留子项目路径，tag 为多个标签输出各自副本，回收站、未归入项目、未打标签单独归档。过长层级收拢到项目根目录，原始关系完整保留在 JSON。相对附件路径按每份 Markdown 的深度重写，附件只保存一次。export-index.json 记录 ID 对应的阅读路径；backup.json 与 records/<id>.json 仍唯一，完整 ZIP 导入不会把阅读副本重复导入，Markdown 文件的外部修改不替代 backup.json。Markdown ZIP 用于阅读，不是完整恢复包。

## 0.9.0 启动页与排序偏好

启动页不增加记录类型或云端格式。Todo / Idea 仍读写 `nexus-list`，通过现有 Markdown / list 投影和修订检查保存，保留另一分区与已有备注。纯展示不会创建或恢复清单；用户明确编辑时才保存。喜爱网页、未读网页组、项目及成员直接读取现有资料库，不存第二份内容。

`chrome.storage.local.startPage` 保留 `{favoritesLimit:8, shortcuts:[]}` 用于旧版迁移与本机显示设置。启动页由 manifest 的 chrome_url_overrides.newtab 固定注册；旧版本的 enabled / decided 字段被忽略。favoritesLimit 限 5 / 8 / 10，仍只存在本机。Dock 网站迁入 IndexedDB `library:shortcuts`，最多 12 项 `{id,name,url}`，名称最多 40 字，网址只允许不含凭证的 HTTP / HTTPS；本机编辑使用修订检查，旧 chrome.storage 内容首次读取或同步前迁移，不覆盖已下载的列表。

手动 Drive 同步将 Dock 整体作为 `metadata/shortcuts.json`：信封为 `{format:'guga-shortcut-library',version:1,hash,record}`，record 为 `{id:'guga-shortcut-library',type:'shortcut_library',version:1,title:'常用网站',shortcuts:[{id,name,url}]}`，appProperties 为 `{pkm_role:'shortcut_library',record_id:'guga-shortcut-library'}`。顺序和删除随列表同步；并发编辑用哈希、修订、Drive ETag 和现有冲突选择保留双方版本。下载与记录在同一 IndexedDB 事务提交。完整备份的可选 `shortcut_library` 字段用于恢复，旧备份缺少时保留本机 Dock。

`chrome.storage.local.recordSort` 保存 `{mode,direction}`，mode 为 updated_at / created_at / tag / project / title，direction 为 asc / desc；同时随每个整理窗口的会话视图保存。时间默认降序，文本默认升序；项目按有效项目路径比较，多标签 / 多项目使用排序后的名称，缺值最后。当前筛选的记录 ID 顺序在内存中冻结，过滤与分页前应用；新增 ID 追加，已删除 ID 移除，编辑只提示有排序变化。重新进入视图、切换筛选 / 排序、刷新或主动重新排序时重建。清单及置顶记录继续优先。排序偏好不改变任何记录时间戳、修订或同步基线。

## 0.9.1 界面语言

`chrome.storage.local.uiLanguage` 保存 en / zh-CN / fr / ja，默认 zh-CN，支持常用地区别名并对未知值回退中文。语言不进入记录、同步或数据备份。页面引导脚本先读取语言，再加载界面模块；Service Worker 同步登记事件，在请求处理前等待偏好初始化，不在模块顶层等待存储。

消息表包含三套翻译，中文原文作为稳定消息键；模板的编号占位符仅插入数据，不再次解析插值。静态界面只翻译显式 data-i18n 标记；用户标题、正文、标签 / 项目名称、网站名称和 Markdown 内容不经过界面翻译。日期与文本排序使用所选 locale。应用语言前保存当前侧栏草稿后重载；其他页面保持编辑状态，用户下次打开或刷新时应用。右键菜单与工具栏标题响应本机偏好变化。

## 上架前修复

startPage 偏好只读取 favoritesLimit 与 shortcuts；旧 enabled / decided 字段被忽略，下次保存时移除。现有 Dock 内容迁入同步元数据，不改变网站名称、地址和顺序。
完整 ZIP 的 backup.json 是聚合清单，导入时可超过 32 MiB；其他成员保持 32 MiB 上限，记录和附件仍执行原有结构、哈希与 20 MB 附件校验。整个 ZIP 及累计解压内容上限为 512 MiB，压缩成员按声明大小逐块校验并在超限时停止。
