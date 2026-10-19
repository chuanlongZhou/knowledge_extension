# GUGA Knowledge · 上架素材

这份文件夹存放 0.9.1 的商店文案、品牌图片和实际界面截图。打开 **preview.html** 可浏览素材并切换截图语言；**preview.png** 是静态总览。

视觉方向：米白与青绿，带一点卡其色；沿用项目最早的灰色企鹅标识，配合笔记卡片和轻量连接线，表达“把收集的内容变成自己的知识”。品牌名为 GUGA Knowledge，标语为 YOUR KNOWLEDGE, GUGUGAGA。

## 文案

- copy/zh-CN.md、en.md、fr.md、ja.md：名称、简短描述、宣传标题、详细介绍和五张截图的说明。
- copy/*-description.txt：可直接粘贴到商店的详细介绍纯文本。
- listing-fields.json：四种语言的结构化字段，简短描述均不超过 132 字符。
- reviewer-notes.md：单一用途、权限用途、数据流及需要填写的发布信息。

中文主标题：**把值得留下的，变成自己的知识。**

## 图片

| 文件 / 目录                             | 规格                               | 用途                                   |
| --------------------------------------- | ---------------------------------- | -------------------------------------- |
| assets/icons/current-icon-128.png       | 128 × 128，透明 PNG                | 当前版本的商店图标，与插件一致         |
| assets/icons/current-icon-16/32/48.png  | 对应像素，透明 PNG                 | 当前图标的配套尺寸                     |
| assets/promotional/small-440x280.png    | 440 × 280，RGB PNG                 | 商店通用小宣传图                       |
| assets/promotional/marquee-1400x560.png | 1400 × 560，RGB PNG                | 商店通用品牌横幅                       |
| assets/screenshots/zh-CN、en、fr、ja    | 每种语言 5 张，1280 × 800，RGB PNG | 各语言商店截图                         |
| source/raw/*/sidebar-reference.png      | 380 × 900                          | 额外的真实侧栏参考图，不作商店标准截图 |
| source/illustrations/penguin.png        | 原始透明 PNG                       | 项目最早的灰色企鹅，原样复用           |

截图顺序：

1. **01-start-page**：计划、灵感、喜爱网页与常用网站。
2. **02-organize**：记录、网页组、标签、项目和排序。
3. **03-project-graph**：关联项目内的资料。
4. **04-record-preview**：真实图文预览。
5. **05-export-backup**：按项目或标签导出备份。

所有截图均由当前插件在隔离浏览器中录制，使用自写的本地示例资料。没有读取个人浏览器、连接真实 Google 账号，或伪造同步成功提示。截图没有改写插件界面。企鹅标识沿用项目原有素材。

## 源文件与重新生成

- source/design.html：宣传图的 HTML / CSS 排版。
- source/illustrations/provenance.json：原始企鹅与图标的来源路径，素材未重绘或改色。
- source/demo-data.mjs：四语示例内容。
- source/capture.mjs：在隔离 Chromium 中重新录制截图。
- source/render-artwork.mjs：导出宣传图、结构化文案和预览页。
- source/validate.mjs：检查尺寸、PNG 通道、文案长度、文件完整性，生成清单与素材 ZIP。

在仓库根目录安装现有 Node 依赖并准备 Playwright Chromium 后运行：

```powershell
node store-listing/source/capture.mjs
node store-listing/source/render-artwork.mjs
node store-listing/source/validate.mjs
```

运行会重建本目录的示例截图和排版导出，不操作用户的浏览器配置或 Google Drive。插件发行包仍由项目的 build 脚本单独生成。

## 使用时的对应关系

小宣传图与横幅在商店中共用，不需要按语言重复上传。每种语言可上传对应的五张截图与介绍。插件界面、安装包、商店图标及宣传图统一使用最早的灰色企鹅；current-icon 是插件现有图标的直接副本。

四语界面已实现；商店后台的四语条目还需要正式安装包声明对应 _locales 元数据。隐私政策公开地址、开发者名称与支持联系方式需要填入实际信息，详见 reviewer-notes.md。

## 规格来源

尺寸、本地化和图片格式按 2026-10-18 查阅的官方资料准备：

- [Chrome Web Store 图片规范](https://developer.chrome.com/docs/webstore/images)：图标、小宣传图、横幅、截图及其语言范围。
- [填写商店信息与本地化](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)：介绍与截图按语言填写，宣传图共用。
- [Manifest 简短描述](https://developer.chrome.com/docs/extensions/reference/manifest/description)：最多 132 字符。

校验结果见 validation.json，文件尺寸与 SHA-256 见 asset-manifest.json。素材归档为 dist/GUGA-Knowledge-store-assets-0.9.1.zip。
