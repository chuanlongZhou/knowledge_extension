---
layout: privacy
title: 隐私政策 · GUGA Knowledge
updated: '2026-10-19'
---

# 隐私政策

本政策说明 GUGA Knowledge Chrome 扩展如何处理网页内容、浏览器离线资料和 Google Drive 数据。开发者不运营接收知识内容的应用服务器。

## 扩展处理的内容

扩展在用户主动收集时读取网页标题、链接、选中文字或可见区域截图；主动录音时使用麦克风。内容、草稿、图片和录音先保存在本机浏览器存储。网站权限按功能向用户请求。

用户使用网页组功能时，扩展读取当前窗口中打开的标签页标题和网址，供用户选择保存；不会持续记录完整浏览历史。

## 浏览器保存与备份

已保存内容、Dock 常用网站与附件保存在当前扩展的浏览器数据库中，用于离线查看、搜索、编辑和冲突处理。用户可以导出包含记录、常用网站、图片、音频和草稿的完整 ZIP。

本版本不需要本地配套程序，也不执行本地文件夹同步。Google Drive 传输由用户主动点击同步下载或同步上传触发；Dock 常用网站随资料同步。

## Google 登录与数据用途

每位用户在 Google 页面登录自己的账号并授权。应用 OAuth 客户端只标识 GUGA Knowledge，不能代替用户授权。资料同步到实际授权用户自己拥有的专用 Drive 文件夹，不会集中上传到开发者的 Drive。

应用请求 `drive.file` 权限，仅用于本应用创建或用户明确授权的资料文件。上传新增或修改的记录和相关附件，下载云端记录与附件。Google 账号名称、邮箱和 Drive 用户标识用于显示当前账号及防止错误账号同步。

Google API 数据仅用于用户请求的资料管理和同步，遵守 [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) 及 Limited Use 要求。不会将这些数据用于广告、出售或自动发送给 AI 服务。

通过 Chrome 与 Google API 获得的用户数据，仅用于本扩展已告知的个人资料收集、整理和同步功能。其使用遵守 [Chrome Web Store User Data Policy（包括 Limited Use 要求）](https://developer.chrome.com/docs/webstore/program-policies/limited-use)；不会用于个性化广告、出售给第三方或供开发者日常人工查看。

## 凭证与安全

授权通过 Chrome Identity 和 Google 登录页面进行，应用不收集 Google 密码。授权令牌由 Chrome 管理，扩展在请求期间使用访问令牌，不将其写入 JSON、Markdown、同步文件或备份。账号不匹配时停止原文件夹的读写。

知识内容本身使用本机和 Google Drive 的存储保护，并非应用级端到端加密。请妥善保护电脑、Google 账号和导出的备份。

## 第三方与追踪

本应用没有遥测、广告或自动 AI 调用。用户授权同步时使用 Google Drive；Google 按自己的条款处理托管数据。用户自行打开外部网站、向其他工具提供文件或将资料交给 LLM 时，应另行了解对应服务的隐私处理。

本介绍网站可部署在 GitHub Pages；GitHub 作为网页托管方按其[隐私声明](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)处理网站访问。本网页不包含额外的分析脚本或追踪器。

## 关闭、撤销与删除

用户可以退出 Google 登录，或在 Google 账号的第三方连接页面撤销授权。退出登录保留浏览器记录与文件夹绑定。卸载扩展会移除该扩展的浏览器内部数据，卸载前应导出备份。

删除记录、同步删除状态、远程副本和独立备份是不同操作。冲突会保留双方版本，不承诺删除当前记录后所有副本立即消失。完整移除资料时，请分别处理浏览器存储、个人 Drive 文件夹、其他设备及备份；删除远程同步文件前应先备份。

## 问题反馈与政策更新

通过[项目问题页面](https://github.com/chuanlongZhou/knowledge_extension/issues)联系维护者，授权相关问题也可使用 Google 授权页列出的支持邮箱。提交公开问题时请避免附带访问令牌、私人资料或完整凭证文件。

功能或数据处理方式改变时会更新本政策与应用内说明，页面顶部标明更新日期。
