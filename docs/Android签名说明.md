# Android 发布签名

从 v0.4.2 起，心语表情库的 Android 发布 APK 只使用一份固定的 release 签名。私钥不提交到仓库，也不会在 GitHub Actions 中临时生成；缺少配置时，Actions 会跳过 APK 产物，避免用户下载到每次签名都不同的安装包。

## 协作者克隆后如何开发和打包

源码、构建脚本和工作流均已提交。2026-09-09 已在原仓库 `Yiyin-Faith/Xinyu-Meme-Library` 配置四项签名 Secrets，并用它们成功生成 v0.4.2 正式 APK。Secrets 保存在 GitHub 仓库设置中，`git clone` 不会下载私钥或密码。

| 目的 | 操作 | 是否需要正式密钥 |
| --- | --- | --- |
| Windows 开发和打包 | `npm run desktop` / `npm run desktop:dist` | 不需要 Android 密钥 |
| 本地 Android 开发和打包 | `npm run android:debug` | 不需要，Gradle 自动使用本机调试签名 |
| 在原仓库生成正式 Android APK | 运行 `Android APK` 工作流 | 工作流自动读取已配置的 Secrets |
| 在自己的电脑离线生成同一签名的正式 APK | 配置下文四个本地环境变量，再运行 `npm run android:build` | 需要仓库维护者私下交付现有密钥与密码 |

### 本地开发 APK

安装 Node.js 22、JDK 21，以及 Android SDK Platform 36 / Build Tools 36。将 `JAVA_HOME` 指向 JDK 21，将 `ANDROID_HOME` 指向 Android SDK 根目录。Windows 使用 Android Studio 默认 SDK 目录时，可设置 `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"`。

```powershell
git clone https://github.com/Yiyin-Faith/Xinyu-Meme-Library.git
cd Xinyu-Meme-Library
npm ci
npm run android:debug
```

产物为 `release/Android/Xinyu-Meme-Library-版本号-Android-debug.apk`，安装后的名称为“心语表情库（开发版）”，包名为 `com.puff.meme.debug`。开发版与正式版可同时安装，图片库数据独立；正式版包名继续保持 `com.puff.meme`。开发 APK 仅供测试，不上传到正式 Release。CI 会在不注入正式签名的独立任务中运行同一个命令，验证新克隆可构建。

### 在原仓库生成正式 APK

1. 将修改推送到原仓库的分支，或通过 PR 合并到 `main`。
2. 打开 [Actions → Android APK](https://github.com/Yiyin-Faith/Xinyu-Meme-Library/actions/workflows/android-apk.yml)，点击 **Run workflow**，选择要构建的分支并运行；推送到 `main` 也会自动构建。
3. 等待 `Build Android APK` 成功，从该次运行底部的 **Artifacts → Xinyu-Meme-Library-Android-APK** 下载 ZIP，解压得到正式签名 APK。产物保留 14 天。
4. 核对版本后，把 APK 附加到对应版本的 GitHub Release。工作流生成 Artifact，不会自动发布 Release。

手动运行需要对原仓库有写入权限。只克隆或 Fork 不会获得原仓库 Secrets；没有写入权限的贡献者可以本地构建开发版并提交 PR，由维护者在原仓库构建正式版。参见 [GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) 与 [Secrets 说明](https://docs.github.com/en/actions/concepts/security/secrets)。

发布新版本时，同时更新 `package.json` 的 `version`、`android/app/build.gradle` 的 `versionName`，并递增 `versionCode`。继续使用现有 release 密钥，以便用户覆盖升级。

## GitHub Actions 签名配置与恢复

原仓库已配置完成，协作者无需重复设置。迁移仓库或恢复配置时，在 **Settings → Secrets and variables → Actions → New repository secret** 中设置下面四项，值必须来自现有密钥备份：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | release keystore 的单行 Base64 内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 签名别名，例如 `xinyu-release` |
| `ANDROID_KEY_PASSWORD` | key 密码 |

配置完成后，`main` 的后续 Android APK 工作流会恢复同一把 keystore，并在上传前执行 `apksigner verify`。不要把 keystore、密码、Base64 文本或 `signing.properties` 提交到 GitHub。

当前固定发布证书的 SHA-256（公开指纹，不包含私钥）：

```text
cb49ea5e36cf43785b8afe7f33bc97faacd22f42527c1cf70f51acb61e168911
```

原仓库 Secrets 无法通过 `git clone` 或 GitHub 的读取 Secret API 导出明文。需要本地正式构建时，由维护者通过私密渠道交付 `xinyu-release.jks` 及其密码，并单独妥善备份；不要把这些材料放进公开仓库或 Release。

## 本地正式构建

在受信任的电脑上，将同样的四个值作为环境变量传入后执行：

```powershell
$env:PUFF_ANDROID_KEYSTORE = "D:\private\xinyu-release.jks"
$env:PUFF_ANDROID_KEYSTORE_PASSWORD = "你的-keystore-密码"
$env:PUFF_ANDROID_KEY_ALIAS = "xinyu-release"
$env:PUFF_ANDROID_KEY_PASSWORD = "你的-key-密码"
npm run android:build
```

一般开发使用前文的 `npm run android:debug`，不需要配置这些变量。旧的 `PUFF_ANDROID_ALLOW_DEBUG_SIGNING=1` 兼容开关仅供特殊本地测试：它会使用调试密钥签出正式包名，无法与正式版同时安装，不能用于分发。

## 首次迁移提醒

v0.4.1 及更早的 GitHub APK 使用的是每次构建临时生成的 debug 私钥，无法取回。因此升级到首次固定签名的 v0.4.2 时，Android 会要求先卸载旧版。**请先在旧版中执行“完整备份导出”，卸载后安装新版，再执行恢复备份。**

完成这一次迁移后，只要持续使用同一份 release keystore，之后的版本都可以直接覆盖安装，图片库数据也会保留。
