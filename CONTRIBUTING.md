# Contributing

感谢参与心语表情库。提交代码前请确认：

1. 从最新的 `main` 创建功能分支，例如 `feature/android-share` 或 `fix/backup-import`。
2. 修改后运行 `npm test` 和 `npm run build`。
3. 如果修改 Windows 行为，再运行 `node scripts/verify-desktop.mjs`。
4. Pull request 说明问题、行为变化和验证命令。

首次克隆后运行 `npm ci`。Windows 开发运行 `npm run desktop`，安装包运行 `npm run desktop:dist`。Android 开发在配置 JDK 21 和 Android SDK 36 后运行 `npm run android:debug`；Gradle 自动使用本机调试签名，开发版与正式版可同时安装。正式签名已经配置在原仓库 GitHub Actions Secrets 中，有写入权限的协作者可运行 `Android APK` 工作流生成正式 APK。具体操作见 [Android 协作与签名说明](docs/Android签名说明.md)。

不要提交 `node_modules/`、`dist/`、`release/`、`.tools/`、Android 构建目录、验证截图、个人表情图片或 `.puff.zip` 备份。应用数据和备份属于用户私有内容。

数据库和 `.puff.zip` 格式属于兼容面。修改它们之前要说明迁移方案，并补充测试。`com.puff.meme`、`puff-library`、`puffDesktop` 和 `.puff.zip` 是历史兼容标识，除非有迁移计划，不要改名。
