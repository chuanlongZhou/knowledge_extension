# GUGA Knowledge 简化版隐私说明

记录、草稿和已下载附件保存在当前浏览器的 IndexedDB 中。只有主动点击同步下载或同步上传时，扩展才通过 HTTPS 访问用户自己的 Google Drive；不会自动备份到其他位置。

Google 授权通过 Chrome Identity 管理。应用仅请求 drive.file 范围，访问该应用创建或获得授权的文件，不扫描全部私人 Drive。访问令牌由 Chrome 缓存，应用只在请求期间使用；不会写入日志、ZIP 备份或记录 JSON。退出登录清除扩展缓存的授权，保留浏览器内容和账号/文件夹绑定。

图片、音频与记录按文件保存到所选 Drive 文件夹。项目、标签和用户添加的 Dock 常用网站随手动同步进入 Drive；完整 ZIP 备份也包含 Dock 网站。主题、字体、账号信息和文件夹选择不包含在备份中。用户可从 Google 账号撤销应用授权，或在 Google Drive 自行管理云端文件。

网页访问及麦克风按需授权；没有遥测、广告、应用云服务器或自动 AI 调用。文件校验不代表内容加密；Google Drive 账号与浏览器配置的访问者能够读取相应数据。

用户使用网页组功能时，扩展读取当前窗口中打开的标签页标题和网址，供用户选择保存；不会持续记录完整浏览历史。

通过 Chrome 与 Google API 获得的用户数据，仅用于已告知的个人资料收集、整理和同步功能。数据使用遵守 [Chrome Web Store User Data Policy（包括 Limited Use 要求）](https://developer.chrome.com/docs/webstore/program-policies/limited-use)；不会用于个性化广告、出售给第三方或供开发者日常人工查看。

安装并启用后，启动页成为浏览器的新标签页，使用 Chrome 官方 URL Overrides 实现。启动页展示已有资料，Todo / Idea 编辑沿用清单；不会触发自动云端同步。喜爱卡片显示数量和整理页排序为本机偏好，不进入 Drive 或数据备份。

英语、中文、法语、日语的界面翻译随扩展离线提供，不调用在线翻译服务。语言选择仅保存于当前浏览器，不翻译或上传用户内容。
