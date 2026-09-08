# 心语表情库

心语表情库是一个只面向 Windows 桌面端和 Android 的本地优先表情管理器。图片、标签、备注和收藏夹保存在设备本地，可以通过 `.puff.zip` 在电脑和手机之间迁移。

项目不提供独立网页端。`src/` 是 Windows Electron 外壳和 Android Capacitor 外壳共用的界面，`dist/` 只是构建中间产物，不是需要发布的网页站点。

## 功能

- 批量导入图片，按内容去重
- 标题、标签、备注搜索，收藏夹和最近使用
- Windows 复制到剪贴板，Android 通过系统分享
- 完整备份与恢复，保留图片和元数据
- 在线补充入口只在用户主动打开时访问网络
- Windows 托盘驻留和 `Ctrl + Shift + P` 快捷呼出

## 目录

```text
src/                  共用 React 界面与本地数据逻辑
electron/             Windows Electron 外壳、托盘和剪贴板 IPC
android/              Capacitor Android 工程
public/samples/       内置原创示例图片
scripts/              Android 构建和桌面验证脚本
tests/                单元测试
docs/                 使用说明和 GitHub 协作说明
.github/workflows/    GitHub Actions 持续集成
```

`node_modules/`、`dist/`、`release/`、`.tools/`、Android 构建目录和验证截图已经写入 `.gitignore`，不会被上传到 GitHub。发布 APK 和 Windows 包建议放到 GitHub Releases，而不是提交到源码仓库。

## 使用和构建

需要 Node.js 22 或更高版本。

```powershell
npm install
npm run desktop:pack       # 生成 release/win-unpacked/，用于 Windows 测试
npm run desktop:dist       # 生成 Windows portable 包
npm test                   # 运行单元测试
node scripts/verify-desktop.mjs
```

Android 需要 JDK 21、Android SDK Platform 36 和 Build Tools 36：

```powershell
npm run android:build
```

构建结果会写入 `release/Xinyu-Meme-Library-版本号-Android-debug.apk`。Android 应用的包名 `com.puff.meme` 是历史兼容标识，不能随意修改，否则系统会把它识别为新应用。

完整使用说明见 [`docs/使用说明.md`](docs/使用说明.md)。

## 第一次上传 GitHub（小白版）

### 1. 安装 Git

在 Git 官网安装 Windows 版 Git。安装时一路使用默认选项即可。安装完成后打开 PowerShell，确认命令可用：

```powershell
git --version
```

### 2. 在 GitHub 建仓库

登录 GitHub，点击右上角 `+`，选择 `New repository`。仓库名可以填 `xinyu-meme-library`，选择 Public 或 Private；创建时不要勾选 README、`.gitignore` 或 License，因为本项目已经有这些文件。

### 3. 在项目目录初始化并上传

把下面命令中的路径和仓库地址替换成自己的值：

```powershell
cd "D:\File\Develop\Practice\Test\表情包管理器"
git init -b main
git add .
git status                         # 确认没有 node_modules、dist、release
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/xinyu-meme-library.git
git push -u origin main
```

第一次 `push` 时 GitHub 可能要求浏览器登录或 Personal Access Token。密码输入框不能使用 GitHub 登录密码；按 GitHub 页面提示完成浏览器授权即可。若不想使用命令行，可以安装 GitHub Desktop，选择 `Add an Existing Repository`，选中这个目录，再点击 `Publish repository`。

### 4. 邀请朋友成为 contributor

打开仓库页面，依次点击 `Settings`、`Collaborators`、`Add people`，输入朋友的 GitHub 用户名或邮箱，选择合适的仓库权限并发送邀请。朋友接受邀请后，在本地执行：

```powershell
git clone https://github.com/你的用户名/xinyu-meme-library.git
cd xinyu-meme-library
npm install
git switch -c feature/你的修改
```

朋友修改后执行：

```powershell
git add .
git commit -m "Describe the change"
git push -u origin feature/你的修改
```

然后在 GitHub 点击 `Compare & pull request`，由你检查后合并。日常开始工作前先同步主分支：

```powershell
git switch main
git pull
```

协作约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。不要把个人表情图片、备份 ZIP、`node_modules` 或构建产物提交到仓库。
