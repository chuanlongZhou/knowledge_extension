# GitHub Pages 与 Google 应用发布

GitHub Pages 用于公开应用介绍及隐私政策，资料同步仍是扩展、本地应用与用户自己的 Google Drive。安装包继续内置在插件中，GitHub Releases 可用于分发完整插件包。

已准备 `docs/index.html`、Markdown 源文件 `docs/privacy.md`、Jekyll 页面布局 `docs/_layouts/privacy.html` 和 `docs/site.css`。GitHub Pages 会把 Markdown 渲染为 `privacy.html`；不要添加 `.nojekyll`，否则不会进行 Markdown 渲染。目前这些修改只在 PR 分支，尚未合并到 Pages 发布分支，也未确认 Pages 或 Google 应用已发布。

1. 将审核后的项目推送到计划发布的 GitHub 仓库，不提交 `companion/google-oauth.json`、用户凭证或 test-results。桌面应用客户端配置由本地构建带入安装包；用户的授权令牌绝不带入。
2. 在仓库 Settings → Pages 中，选择 Deploy from a branch、实际发布分支（例如 main）和 `/docs` 目录。
3. 等待部署成功，使用 GitHub 显示的实际 Pages 地址。在当前仓库名不变时，预期主页为 `https://chuanlongzhou.github.io/knowledge_extension/`，隐私页为其下 `privacy.html`；其源文件是 `docs/privacy.md`。这是部署后的预期地址，尚未确认已经上线。
4. 确认两页无需登录即可访问，主页能打开同站隐私政策。Google 要求验证所有权时，在 Google Search Console 为实际站点完成验证，再将相应域名登记到 OAuth 授权域名中；不要把不属于自己的整个 `github.com` 或 `github.io` 填成自有域名。
5. Google Cloud 项目 `pkm-nexus` → Google Auth Platform → Branding，填写真实主页和隐私政策链接，保留已确认的支持及开发者联系邮箱。按控制台要求完成品牌核验，再在 Audience 发布应用。
6. 应用仍处 Testing 时只有列入的测试账号可授权；当前用户选择暂不添加测试用户，因此没有执行真实 Drive 授权联调。只有 Google 显示正式开放后，才能说明所有 Google 用户可以使用；Workspace 管理策略仍可能限制个别组织账号。

首次真实验证时：在本地应用登录自己的账号并授权，创建自己的资料库，测试手动同步；第二台电脑登录同一账号并选择相同资料库。不同用户分别登录各自账号，不共用开发者的 Drive。Google 账号授权应由用户自己完成。

参考：[GitHub Pages 快速开始](https://docs.github.com/en/pages/quickstart)、[Google 应用主页要求](https://support.google.com/cloud/answer/13807376)、[Google 品牌信息配置](https://support.google.com/cloud/answer/15549049)。
