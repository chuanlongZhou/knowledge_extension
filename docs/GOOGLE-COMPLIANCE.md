# Chrome Web Store 与 Google Drive 接入要求

更新日期：2026-10-17。这是实现约束和发布准备记录，不是 Google 审核通过声明。

## 扩展与配套程序

- 当前完整 MV3 开发包内置 Windows 配套程序 ZIP，设置页由用户主动保存，解压后运行 PKM-Nexus.exe。它是独立便携程序，扩展不加载或执行 ZIP，不静默安装，不捆绑无关产品；公开商店提交仍须针对实际程序接受审核。
- 网站访问为可选权限。普通摘录在用户点击时按单个网站请求，授予后重试；截图因 `captureVisibleTab` 的权限要求，明确说明并请求所有网站访问，或由用户点击扩展图标取得当前页临时权限。设置页可主动授权或撤销，拒绝后仍可手动记录。
- 网页组标题优先使用标签页或拖拽文字；无单站授权则不请求网页，保留链接并显示域名。已授权读取也不跟随重定向，避免向其他未授权域名发请求；不使用代理或 `no-cors` 绕过网站限制。参照 [Chrome 跨域网络请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。
- 网页收集、截图、侧栏编辑和本地备份是扩展自身功能。扩展不是仅用于安装/启动其他程序的空壳。
- 通过官方 Native Messaging API 通信，申请 nativeMessaging 权限，主机 allowed_origins 只允许明确的扩展 ID，拒绝通配来源及未知命令。
- 校验所有消息和路径，不提供任意命令执行、任意文件读取或下载执行代码的接口。扩展代码随包分发，不能从 Drive 加载可执行逻辑。
- 本地管理界面只能绑定回环地址，写操作需要会话认证和来源检查。凭证不返回扩展、网页或管理界面的脚本。
- 便携程序由用户主动解压并连接；明确说明本地目录、定时任务，自动同步由用户单独启用并能关闭。停止使用前从管理页移除扩展连接和任务，退出后删除程序目录，保留资料；删除资料必须单独操作。

## OAuth 与 Drive

- 开发者为应用统一配置 Google Cloud 项目及桌面 OAuth 客户端，构建时内置应用配置，拒绝内置用户令牌、私钥或服务账号。普通用户只需登录自己的账号并授权，无需创建 Cloud 项目或导入 JSON。每位用户的文件保存在自己拥有的 Drive 文件夹。
- 使用系统浏览器、PKCE S256、随机 state、127.0.0.1 随机端口回调和超时；不使用嵌入式登录、废弃的 OOB 复制验证码流程或服务账号代替用户授权。
- 默认只请求 drive.file，管理本应用创建或用户明确授权的文件。选择文件夹不会自动授权其中所有第三方既有文件；恢复必须遵循实际授权范围。
- 使用可见文件夹，不把用户知识藏在 appDataFolder 中。两台电脑使用相同 OAuth 应用和同一 Google 账号，明确选择相同资料库 ID。
- 通过 Drive about.get 显示当前账号，在资料库绑定中保存用户标识；换号阻止旧资料库云端读写，跨进程更新授权时不复用旧缓存令牌。不添加超出 drive.file 的身份权限。
- Refresh token 使用 Windows 当前用户 DPAPI 加密，存储在资料库以外。凭证不写日志、记录、Markdown、同步批次和备份。刷新失败提示重新授权；断开连接可撤销授权并删除本机凭证。
- OAuth 客户端配置不是用户访问令牌；桌面客户端不能被当作能够保守共享秘密的服务器。公开发布前配置品牌、支持联系方式、真实隐私政策及必要的 Google 验证。
- 外部 OAuth 应用处于 Testing 且请求 Drive 权限时，refresh token 通常在 7 天后失效；不能把开发测试模式当作正式长期同步方案。

## 用户披露与审核材料

商店描述、首次引导和隐私政策必须一致说明：收集哪些网页内容；什么留在浏览器和本机；什么在授权同步后传到 Google；同步频率和后台任务；凭证保管；删除/断开/卸载和备份的区别。需要审查的实际安装包、测试方法和有效的支持/隐私政策链接也应随提交提供。

仓库内隐私说明是待发布文档，不能用不存在的网站 URL、虚构的审核状态或占位 OAuth client ID 发布。Chrome Web Store 审核和 Google OAuth 验证是两个流程。代码检查和模拟测试不能替代它们。

## 官方依据

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome 可选权限与用户手势](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [activeTab 临时权限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- [Minimum Functionality](https://developer.chrome.com/docs/webstore/program-policies/minimum-functionality)
- [Manifest V3 要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [OAuth 桌面应用流程](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Drive 最小权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [OAuth token 有效期](https://developers.google.com/identity/protocols/oauth2#expiration)
- [Drive 增量变更](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive 上传和恢复上传](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
