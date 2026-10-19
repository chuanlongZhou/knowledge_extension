# 审核填写参考

以下根据当前 0.9.1 实现编写，供开发者在上架后台核对与粘贴。功能文案见 copy；公开网站、隐私政策 URL 和支持联系方式需填写实际可访问的地址。本次只准备本地素材。

## Single purpose / 单一用途

English:

GUGA Knowledge helps users capture selected web content and personal notes, organize that material in a browser-local knowledge library with tags and projects, and revisit or export it. Optional user-initiated Google Drive sync keeps that same library available on another device. The start page displays the same library and replaces Chrome’s new-tab page through the URL Overrides API while the extension is enabled.

中文：

GUGA Knowledge 帮助用户收集网页内容与个人笔记，使用标签和项目在浏览器本地整理、回顾及导出同一份知识资料库。用户可主动连接自己的 Google Drive 并手动同步；启动页展示已有资料，扩展启用期间通过 Chrome URL Overrides API 成为浏览器的新标签页。

## 权限用途 · Permission justifications

| 权限                                  | 可粘贴的英文说明                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage                               | Stores interface preferences, draft state, and Google Drive connection metadata locally in the browser.                                                                                                                                                                         |
| unlimitedStorage                      | Keeps user-saved records and image/audio attachments available offline in IndexedDB without the ordinary extension storage quota.                                                                                                                                               |
| tabs                                  | Lists open tabs when the user selects pages for a web group, preserves captured page URLs and titles, closes explicitly selected tabs after a successful save. It does not build a browsing history database. |
| activeTab                             | Gives temporary access to the page the user explicitly captures, including selected text, page information and visible-area screenshots.                                                                                                                                        |
| scripting                             | Reads selected text and page information from a page when the user requests capture; site access is granted through Chrome permissions.                                                                                                                                         |
| contextMenus                          | Provides user-initiated actions to save selected text, the current page, a link, or an image to the knowledge inbox.                                                                                                                                                            |
| sidePanel                             | Provides the capture and editing panel alongside the current webpage.                                                                                                                                                                                                           |
| favicon                               | Shows website icons next to saved links and user-configured Dock shortcuts.                                                                                                                                                                                                     |
| identity                              | Uses Chrome Identity to let users authorize their own Google Drive account.                                                                                                                                                                                                     |
| https://www.googleapis.com/*          | Calls Google Drive APIs for user-requested sign-in information, folder selection, manual download and manual upload of this app’s library files.                                                                                                                                |
| optional_host_permissions: <all_urls> | Requested only when needed for user-triggered capture, visible-page screenshots, or fetching a page/link title or image. Users may grant an individual site or broader access and revoke it in settings. It does not start background website scanning.                         |

麦克风由浏览器在用户主动录音时单独询问；manifest 未声明 audioCapture。不要在后台填写实际未使用的扩展权限。

## 数据流参考

- 本机：用户保存的正文、网址、图片、音频、项目与标签、草稿，以及界面偏好。
- 可选 Google Drive：用户点击上传 / 下载后，在本人选择的应用数据文件夹中传输记录、项目关系、标签定义、Dock 常用网站和附件。Drive 权限为 drive.file。
- Google 账号信息：登录后读取并在本机显示 / 保存应用连接所需的账号标识和账号显示信息。授权令牌由 Chrome Identity 管理，不写入记录 JSON 或备份。
- 网站：用户明确收集图片或读取链接标题时，扩展可访问用户允许的网站。截图中的网址与正文为自写示例，不是浏览器个人资料。
- 产品中没有广告、使用分析或自动 AI 服务。上架图片沿用项目原有的灰色企鹅标识。

数据使用申报应与最终提交版本及公开隐私政策一致。该表说明用途，不代替开发者在后台确认实际的数据类别。

## 本次素材对应的界面

1. 启动页：Todo / Idea、最近喜爱网页和 Dock；作为浏览器的新标签页打开。
2. 已整理：网页组、记录、标签、项目树及排序。
3. 项目关系图：真实节点、连接和预览。
4. 记录预览：实际 Markdown、来源和自制配图。
5. ZIP 导出：按项目 / 标签 / 不分类的真实导出选择对话框，未模拟 Google 登录成功。

## 上传前还需补齐的具体信息

- 开发者显示名称、支持邮箱或支持页面、实际可访问的隐私政策 URL。
- 当前插件的界面语言存于 uiLanguage，尚未使用 manifest 的 _locales 目录。商店后台的本地化条目依赖 _locales；如需同时上传四种语言，应在正式发行打包时加入 en、zh_CN、fr、ja 的 manifest 本地化元数据。copy 与截图已按这四种语言备好。
- assets/icons/current-icon-128.png 与当前插件安装包一致，均沿用最早的灰色企鹅标识。
- 小宣传图与横幅是商店通用素材，不按语言重复上传；截图与介绍可分别本地化。

## 官方资料

- [图片尺寸与图标、宣传图、截图要求](https://developer.chrome.com/docs/webstore/images)
- [上架信息与本地化字段](https://developer.chrome.com/docs/webstore/cws-dashboard-listing)
- [简短描述：最多 132 字符](https://developer.chrome.com/docs/extensions/reference/manifest/description)

核对日期：2026-10-18。
