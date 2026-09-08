# Android 发布签名

从 v0.4.2 起，心语表情库的 Android 发布 APK 只使用一份固定的 release 签名。私钥不提交到仓库，也不会在 GitHub Actions 中临时生成；缺少配置时，Actions 会跳过 APK 产物，避免用户下载到每次签名都不同的安装包。

## GitHub Actions 配置

在仓库的 **Settings → Secrets and variables → Actions → New repository secret** 中一次性设置下面四项：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | release keystore 的单行 Base64 内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名别名，例如 `xinyu-release` |
| `ANDROID_KEY_PASSWORD` | key 密码 |

配置完成后，`main` 的后续 Android APK 工作流会恢复同一把 keystore，并在上传前执行 `apksigner verify`。不要把 keystore、密码、Base64 文本或 `signing.properties` 提交到 GitHub。

## 本地构建

在受信任的电脑上，将同样的四个值作为环境变量传入后执行：

```powershell
$env:PUFF_ANDROID_KEYSTORE = "D:\\private\\xinyu-release.jks"
$env:PUFF_ANDROID_KEYSTORE_PASSWORD = "你的-keystore-密码"
$env:PUFF_ANDROID_KEY_ALIAS = "xinyu-release"
$env:PUFF_ANDROID_KEY_PASSWORD = "你的-key-密码"
npm run android:build
```

仅用于本机调试时，才可显式设置 `PUFF_ANDROID_ALLOW_DEBUG_SIGNING=1` 使用 `~/.android/debug.keystore`。这个调试签名不能用于分发。

## 首次迁移提醒

v0.4.1 及更早的 GitHub APK 使用的是每次构建临时生成的 debug 私钥，无法取回。因此升级到首次固定签名的 v0.4.2 时，Android 会要求先卸载旧版。**请先在旧版中执行“完整备份导出”，卸载后安装新版，再执行恢复备份。**

完成这一次迁移后，只要持续使用同一份 release keystore，之后的版本都可以直接覆盖安装，图片库数据也会保留。
