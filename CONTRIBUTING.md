# Contributing

感谢参与心语表情库。提交代码前请确认：

1. 从最新的 `main` 创建功能分支，例如 `feature/android-share` 或 `fix/backup-import`。
2. 修改后运行 `npm test` 和 `npm run build`。
3. 如果修改 Windows 行为，再运行 `node scripts/verify-desktop.mjs`。
4. Pull request 说明问题、行为变化和验证命令。

不要提交 `node_modules/`、`dist/`、`release/`、`.tools/`、Android 构建目录、验证截图、个人表情图片或 `.puff.zip` 备份。应用数据和备份属于用户私有内容。

数据库和 `.puff.zip` 格式属于兼容面。修改它们之前要说明迁移方案，并补充测试。`com.puff.meme`、`puff-library`、`puffDesktop` 和 `.puff.zip` 是历史兼容标识，除非有迁移计划，不要改名。
