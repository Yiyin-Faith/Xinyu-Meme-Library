# 心语表情库

心语表情库是一个只面向 Windows 桌面端和 Android 的本地优先表情管理器。图片、标签、备注和收藏夹保存在设备本地，可以通过 `.puff.zip` 在电脑和手机之间迁移。

当前核心入口是底部的「图片库 / 社区 / 我的」：默认打开紧凑视图的空图片库，右上角 `+ 添加图片` 可选填自定义名称、分组和标签，全部留空也能直接入库；标签输入后按回车即加入。点击图片预览并复制/分享，长按图片（桌面端也可点 `…` 或右键）进入管理，删除位于一级操作。

项目不提供独立网页端。`src/` 是 Windows Electron 外壳和 Android Capacitor 外壳共用的界面，`dist/` 只是构建中间产物，不是需要发布的网页站点。

## 功能

- 批量导入图片，按内容去重
- 图片库不再写入默认表情；社区仍提供本地 Mock 预设帖用于演示
- 标题、标签、备注搜索，主页标签点选筛选，收藏夹和最近使用
- Windows 复制到剪贴板，Android 通过系统分享
- 完整备份与恢复，保留图片和元数据；导出会显示读取、打包、保存进度与完成状态
- 社区、账号和每日发布额度目前是本地 Mock，便于先验证交互；数据层预留为可替换实现
- 在线补充入口只在用户主动打开时访问网络
- Windows 托盘驻留、`Ctrl + Shift + P` 快捷呼出，以及可选的窗口置顶悬浮模式

## 目录

```text
src/                  共用 React 界面与本地数据逻辑
electron/             Windows Electron 外壳、托盘和剪贴板 IPC
android/              Capacitor Android 工程
public/samples/       本地 Mock 社区的原创预设帖图片
scripts/              Android 构建和桌面验证脚本
tests/                单元测试
docs/                 使用说明和 GitHub 协作说明
.github/workflows/    GitHub Actions 持续集成
```

`node_modules/`、`dist/`、`release/`、`.tools/`、Android 构建目录和验证截图已经写入 `.gitignore`，不会被上传到 GitHub。发布文件会按平台放在 `release/PC/` 和 `release/Android/`，源码目录仍保留在仓库根目录。

## 使用和构建

需要 Node.js 22 或更高版本。

```powershell
npm ci
npm run desktop:pack       # 生成 release/PC/win-unpacked/，用于 Windows 测试
npm run desktop:dist       # 生成可选择安装目录的 Windows 安装包
npm test                   # 运行单元测试
node scripts/verify-desktop.mjs
```

Android 本地开发需要 JDK 21、Android SDK Platform 36 和 Build Tools 36，配置好 `JAVA_HOME` 与 `ANDROID_HOME` 后执行：

```powershell
npm run android:debug     # 克隆后即可构建开发 APK，无需正式签名密钥
```

开发 APK 写入 `release/Android/Xinyu-Meme-Library-版本号-Android-debug.apk`，使用独立包名 `com.puff.meme.debug` 和“心语表情库（开发版）”名称，可与正式版同时安装。

正式 Android APK 可通过原仓库的 [Actions → Android APK → Run workflow](https://github.com/Yiyin-Faith/Xinyu-Meme-Library/actions/workflows/android-apk.yml) 构建，四项正式签名 Secrets 已配置，协作者无需下载密钥。构建成功后，在本次运行的 Artifacts 中下载 `Xinyu-Meme-Library-Android-APK`。手动运行需要仓库写入权限；推送到 `main` 也会自动构建。

本地生成正式 APK 时，需持有维护者提供的现有密钥并配置签名环境变量，再运行 `npm run android:build`。正式版包名始终为 `com.puff.meme`。完整的克隆、调试、云端打包、本地正式签名及升级说明见 [`docs/Android签名说明.md`](docs/Android签名说明.md)。

完整使用说明见 [`docs/使用说明.md`](docs/使用说明.md)。

贡献代码请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。不要把个人表情图片、备份 ZIP、`node_modules` 或构建产物提交到仓库。

## 参考与许可证

本项目采用 GPL-3.0-only。产品交互可参考 [Rays](https://github.com/SkyD666/Rays-Android) 与 [OhMyMeme](https://github.com/OhMyMeme/OhMyMeme)，两者当前也采用 GPL-3.0；本项目没有复制它们的源码或素材。如后续引入任何代码或资源，必须保留原始版权与许可证声明。
