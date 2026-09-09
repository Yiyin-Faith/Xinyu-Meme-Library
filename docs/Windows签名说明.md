# Windows 发布签名

从 v0.4.3 起，Windows 主程序和 NSIS 安装器使用同一份固定的自签名代码签名证书，并写入心语表情库的产品信息、版本和图标。

自签名证书可以校验文件完整性，但不是公开受信任证书，Windows SmartScreen 仍可能显示“Windows 已保护你的电脑”。消除该提示需要购买并通过身份验证的代码签名证书或签名服务，且新证书需要积累信誉。不要为了安装程序关闭 SmartScreen，也不要把自签名证书导入系统受信任根证书库。

原仓库已配置 `WINDOWS_PFX_BASE64` 和 `WINDOWS_PFX_PASSWORD` 两项 Actions Secrets。打开 [Actions → Windows installer](https://github.com/Yiyin-Faith/Xinyu-Meme-Library/actions/workflows/windows-release.yml)，点击 **Run workflow**；推送 `main` 也会自动构建。成功后从 Artifacts 下载 `Xinyu-Meme-Library-Windows-Installer`。工作流要求写入权限，不会把私钥写入仓库。

本地正式构建需要维护者私下提供同一份 PFX 和密码，设置 `WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD` 后运行 `npm run desktop:release`。日常开发仍使用 `npm run desktop` 或 `npm run desktop:dist`。

公开证书见 [windows-signing-certificate.cer](windows-signing-certificate.cer)，可运行 `pwsh -File scripts/verify-windows-signatures.ps1` 核对签名。
