# PKM Nexus 数据格式 v4

实现版本：0.4.0。用户收集的内容只有四种类型，共用 Record 表。图片与录音是普通记录的附件；`purpose` 已移除。

## 类型与对应界面

| type | 中文入口 | 数据 / 界面 |
| --- | --- | --- |
| `note` | 普通记录 | Markdown、粘贴图片、主动录音、来源链接，可以同时存在于一条记录 |
| `snapshot` | 网页快照 | URL + 当前可见页面的 PNG 图片；编辑器显示图片预览和下载入口 |
| `list` | 清单 | 唯一清单，无名称；Todo / Idea 两个视图，分割线无文字；卡片可直接勾选 |
| `website_group` | 网页组 | 多个网址组成一组，允许多组归类；每个网址可单独标记已读 |

四个收集入口用 tab button 直接显示，不使用“类型”下拉。点击清单入口始终返回同一份清单。已有记录的编辑保持原 ID。

## Record 字段

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `schema_version` | number | 新内容记录为 `4` |
| `id` | string | 普通记录、快照、网页组使用 UUID；清单固定 `nexus-list` |
| `type` | string | `note` / `snapshot` / `list` / `website_group` |
| `title` | string | 标题，最多 500 字符；清单固定空字符串 |
| `content` | string | Markdown 正文 / 备注，最多 1,000,000 字符 |
| `summary` | string | 可选人工摘要，默认空字符串，最多 2,000 字符 |
| `tags` | string[] | 标签，默认 `[]` |
| `project_ids` | string[] | 关联项目 ID，默认 `[]` |
| `organization_state` | string | `inbox` 未分类 / `organized` 已整理 |
| `created_at` | string | ISO 8601 UTC 创建时间，编辑不变 |
| `updated_at` | string | ISO UTC 修改时间 |
| `deleted_at` | string / null | 回收站时间，正常为 `null` |
| `sources` | Source[] | 来源列表，默认 `[]` |
| `attachments` | Attachment[] | 原始文件描述，默认 `[]`，不放二进制或 Base64 |
| `snapshot` | Snapshot / null | 网页快照专用；其他类型为 `null` |
| `list` | ListItem[] | 清单专用；其他类型为 `[]` |
| `url_list` | WebsiteItem[] | 网页组专用；其他类型为 `[]` |

四种 v4 记录包含相同字段；专用字段必须与类型一致。没有 `purpose`、旧 `task_status`、`local_only` 或 `upload_enabled`。已保存记录等待用户主动同步；捕获草稿不会自动进入收件箱或上传。

## Source

`{ url, title, captured_at, kind }`

URL 仅支持不含登录凭证的 HTTP / HTTPS；title 为来源标题；captured_at 为 ISO UTC 收集时间。kind 当前使用 `web_selection`、`web_page`、`manual`，保留旧来源类型。

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

```json
{
  "id": "稳定的项目UUID",
  "kind": "item",
  "text": "下次整理收件箱",
  "is_checkbox": true,
  "checked": false
}
```

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定项目 ID |
| `kind` | `item` 普通项 / `divider` 分割线 |
| `text` | 项目文字，最多 5,000 字符；分割线固定空字符串 |
| `is_checkbox` | true 属于 Todo，false 属于 Idea；分割线也用此字段标记所属视图，但不显示 checkbox |
| `checked` | 待办是否完成；圆点与分割线固定 false |

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

| 字段 | 含义 |
| --- | --- |
| `id` / `sha256` | 原始文件 SHA-256，二者一致 |
| `kind` | `image`（含 PNG 快照） / `audio` / `snapshot`（仅旧版 MHTML） |
| `name` | 显示或下载的文件名 |
| `mime_type` | 如 image/png、audio/webm、application/x-mimearchive（旧版） |
| `size_bytes` | 文件字节数，单附件最多 20 MiB |
| `path` | `assets/<sha256>.<扩展名>`，仓库根目录相对路径 |
| `created_at` | ISO UTC 创建时间 |
| `duration_ms` | 本插件录音时长，毫秒；其他附件为 null |

原文件独立保存在本机附件表 / GitHub assets 目录。图片使用 `![标题](assets/<hash>.png)`；录音使用 `[录音](assets/<hash>.webm)`。编辑器显示图片和播放器。音频文件添加入口已移除；旧备份中的音频继续兼容。

## 标签页收集与关闭

网页组支持手动 URL、多选当前窗口网页，以及将插件“已打开网页”的可拖动行拖入编辑区 / 已有网页组卡片。外部拖放提供正常 URL 时也支持；当前扩展不支持接管浏览器原生标签栏拖动；拖出会由浏览器创建新窗口。插件列表支持多选归组与列表内拖入，界面明确区分这两种来源。

拖入编辑区后点击保存，写入成功才关闭。拖入已有组卡片时，先追加到原组，完成数据库写入，再关闭。可取消“保存后关闭加入的标签页”。写入失败不关闭；关闭前再次检查 ID、当前 URL、导航中的 URL 和固定状态。发生导航或固定的网页保留。

浏览器 tab ID、窗口 ID、待关闭列表只存在于当前编辑会话，不写入 Record，不同步。重新打开草稿后网址仍在，但不会根据旧 tab ID 关闭网页。导入也不执行关闭操作。

## 存储、兼容与备份

```text
data/YYYY/MM/<id>.json       内容记录（含回收站）和既有项目规则配置
assets/<sha256>.<ext>        图片、录音、PNG 页面图片，以及旧版 MHTML 文件
tombstones/<id>.json         最小删除标记
index/global_index.json     可重建的轻量索引
```

项目关键词规则继续作为独立旧版配置协议兼容，不是第五个收集类型。删除标记仅保留 schema_version、id、kind: tombstone、created_at、deleted_at，防止旧设备复活记录。

兼容 v1 / v2 / v3：读取不改变旧哈希，编辑时升级为 v4，ID 与时间保留。旧 purpose 转为正文“旧版备注”。旧独立 todo 在打开、同步或导入后汇入唯一清单，原记录保留为普通记录，文字不丢弃。

列表只读取元数据和有限项目预览；正文、全部项目及附件按操作读取。hash、baseHash、rev、dirty 属于本机同步状态，不属于 Record。Token 单独存储，不进入仓库或备份。

手动同步将记录、附件与索引放入同一 Git 提交。其他电脑先同步描述，用户加载或主动完整备份时才下载原文件。完整 ZIP 包含仓库数据、Markdown、草稿、待处理收集和附件；未完成录音与冲突快照放入 recovery 供人工恢复。缺失或校验失败的附件会停止打包。

升级同一个扩展请点击“重新加载”，不要先卸载；所有同步电脑请更新为 0.4.0。

实现依据：[Chrome pageCapture](https://developer.chrome.com/docs/extensions/reference/api/pageCapture)、[Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)。

## 网页标题和图标

网址数据仍保存完整 URL，但网页组和已打开网页列表只显示图标与单行标题，不展开 URL。标题优先使用已有标签页标题；外部链接在用户添加时请求目标网页，只解析有限的 HTML head，优先 og:title / title。页面拒绝请求时使用拖入链接的文字，没有可用文字则用简短站点名。请求有 6 秒超时、512 KiB 读取上限，不加载网页脚本、视频或其他资源，不附带 GitHub Token。

图标使用 Chrome / Edge 的 favicon 接口，缺少缓存时显示浏览器默认图标；不依赖外部图标服务。

## 麦克风授权

第一次录音打开可见的麦克风授权页。点击允许后请求浏览器授权，成功后关闭授权页并回到编辑器开始录音。已授权时直接录音；拒绝、取消、关闭或离开授权页会明确显示状态。提供独立的“麦克风设置”入口处理已被阻止的权限。只有主动开始录音才请求音频，录音期间显示状态与计时，停止后写入附件；每秒片段保存和中断恢复继续保留。

当前实现依据：[captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)、[favicon 接口](https://developer.chrome.com/docs/extensions/how-to/ui/favicons)、[getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
