# GUGA Knowledge 小文件同步与可读 ZIP（0.8.4 已实现）

云端使用稳定 ID 的独立小文件；本地导出使用项目 / 记录原名。两种布局服务不同用途，不把可读文件名作为同步身份。

```text
Google Drive 数据文件夹/
  records/<record-id>.json
  metadata/tags.json
  assets/images/<sha256>.png
  assets/audio/<sha256>.webm
```

新版兼容原来的根目录平铺文件，也读取带有本应用目录标记的分类目录；用途未知的文件夹不会被递归扫描。新文件直接进入分类目录。已有文件可在设置 → Google Drive → 整理云端目录中先预览，再移动；文件 ID 和内容保留，失败后重新预览剩余项继续。所有设备先更新到 0.8.4，再上传新文件或整理目录；旧客户端只读平铺目录。

每次同步仍列出目录中的文件元数据。Drive version 与缓存版本一致时，复用已校验的 JSON；新增 / 变化文件才稳定读取正文，缺少版本或缓存损坏会重新读取。记录读取与缺少附件下载均最多四路并行，失败时等待在途请求结束。缓存放在独立 IndexedDB driveCache，不与原始记录混合、不导出，也不替代同步基线；哈希、ETag 条件更新、冲突选择和记录批次原子提交继续保留。

缓存版本取自与正文配对的稳定读取，而不是更早的列表响应。移动目录会改变版本，下一次可能重新读取一次；缓存缺失可以从云端重新建立。首次下载仍需读取全部资料；目前没有使用变化游标跳过整个元数据列表。

导出前可选择按项目、按标签或不分类，完整 ZIP 和 Markdown ZIP 共用可读布局：

```text
完整 ZIP/
  backup.json
  records/<record-id>.json
  notes/项目/研究计划/参考资料/阅读笔记.md
  notes/项目/研究计划/研究计划.md
  notes/未归入项目/随手记.md
  assets/<sha256>.png
  export-index.json

按标签时/
  notes/标签/阅读/阅读笔记.md
  notes/标签/工作/阅读笔记.md
  notes/未打标签/随手记.md
```

Markdown 采用原标题；Windows 不支持的字符会替换，重名使用稳定短 ID 区分。项目树保留父子层级，过长路径收拢到项目根目录，完整关系仍保存在 JSON。标签描述也提供可读文档，回收站单独归档。同一记录属于多个项目 / 标签时，各目录提供阅读副本；附件只保存一次，每份 Markdown 的相对链接按深度生成。export-index.json 映射唯一记录 ID 与阅读路径。

完整恢复以 backup.json 和附件为准，records 中每个 ID 仍只保存一份，导入不会因多个 Markdown 副本而重复生成记录。外部编辑 Markdown 不会替代备份中的 JSON；Markdown ZIP 用于阅读而非完整恢复。Google 凭证、浏览器账号绑定和同步缓存不进入备份。

手动移除云端文件仍不等于应用内删除。缺失 JSON 不自动删除浏览器副本，也不盲目重建；缺少被引用附件或必要父项目可能阻止新设备下载。当前未实现自动修复入口，可优先从 Drive 回收站恢复。

依据：[Drive v3 文件版本](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)、[v2 ETag 与版本](https://developers.google.com/workspace/drive/api/reference/rest/v2/files)、[目录移动](https://developers.google.com/workspace/drive/api/guides/folder)、[请求性能与批量限制](https://developers.google.com/workspace/drive/api/guides/performance)。
