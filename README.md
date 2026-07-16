# DroidCrashLab

DroidCrashLab 是一个只监听本机的 Android 真机崩溃巡检工具。它通过 Web 界面完成设备选择、APK 元数据检查、覆盖安装、应用启动、人工巡检、Monkey 测试、实时日志查看、崩溃归类和历史结果导出。

## 前置条件

- macOS 与 Node.js 26 或更高版本。
- Android SDK 中可执行的 `adb` 与 `apkanalyzer`。
- 通过 USB 连接并授权的 Android 测试设备。
- 仅使用测试账号，避免真实交易、支付、删除或其他不可逆操作。

工具固定监听 `127.0.0.1:4319`，不提供远程绑定参数，也不执行浏览器传入的命令字符串。

## 安装与运行

```bash
npm install
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

打开 <http://127.0.0.1:4319>。

## macOS 桌面版

桌面版复用同一套 React 页面和 Fastify 服务。Electron 启动服务后，在随机本机端口打开应用窗口，因此不会占用固定的 `4319` 端口。

桌面版不包含 Android SDK。运行前仍需安装 Android SDK。服务依次检查 `PATH`、`ANDROID_HOME`、`ANDROID_SDK_ROOT` 和 macOS 默认目录 `~/Library/Android/sdk`。

本地启动与打包：

```bash
npm run desktop
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac -- --arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:mac -- --x64
```

`.dmg` 和 `.zip` 产物写入 `release/`。GitHub 上发布 `v*` Release 时，Actions 自动构建并上传 arm64 与 x64 两种架构的产物。

首版不包含 Apple 签名与公证。macOS 可能阻止直接打开下载的应用；可在 Finder 中按住 Control 键点按应用并选择「打开」，或前往「系统设置 > 隐私与安全性」确认打开。

## 使用流程

1. 确认顶部显示「ADB 已就绪」和目标设备。
2. 选择单个 `.apk` 文件。服务生成上传文件名，并使用 `apkanalyzer` 读取应用 ID、版本名和版本号。
3. 选择「人工巡检」或「Monkey」。
4. 可先显式执行「覆盖安装」和「启动应用」，确认设备准备状态；「开始测试」仍会按同一安全流程重新完成安装和启动。
5. 启动测试后，服务依次覆盖安装、解析 Launcher、启动应用、清空 logcat 并持续采集 `main`、`system`、`crash` 缓冲区。
6. 停止测试后，等待子进程退出和文件刷新。结果会出现在「测试历史」，「问题报告」可读取选中问题对应的完整原始日志范围。

### 人工巡检

人工在真机上访问业务页面。Web 页面实时显示 Java Crash、ANR、Native Crash、OOM、DI Crash 标签、问题出现次数和原始日志行范围。

### Monkey

- 默认事件数：`10000`
- 默认节流：`350 ms`
- 默认随机种子：当前日期
- 包范围：当前 APK 应用 ID
- 系统按键和应用切换比例固定为 `0`

Monkey 输出单独保存在 `monkey.txt`。主动停止时先结束 Monkey，再结束 logcat。

## 数据目录

默认目录为 `~/.droid-crash-lab/`：

```text
uploads/<uuid>.apk
runs/<run-id>/metadata.json
runs/<run-id>/events.jsonl
runs/<run-id>/logcat.txt
runs/<run-id>/monkey.txt
runs/<run-id>/install.txt
runs/<run-id>/issues.json
```

归档在下载时动态生成，不长期保存重复 ZIP。自动化测试可通过 `DROID_CRASH_LAB_DATA_ROOT` 使用隔离目录。

## 崩溃分类

- Java Crash：异常类与第一条应用代码帧。
- DI Crash：Java Crash 加 `di` 标签，例如 `No injector factory bound`。
- ANR：应用进程与 ANR 原因。
- Native Crash：信号与第一条稳定应用或库帧。
- OOM：`OutOfMemoryError` 及完整 Java 原始堆栈。

同一轮测试按稳定 fingerprint 合并重复问题，保留出现次数、时间和原始日志范围。

## 故障排查

### ADB 不可用

确认 `adb` 在 `PATH`，或设置 `ANDROID_HOME` / `ANDROID_SDK_ROOT`。环境接口会返回已检查位置。

### 设备未授权

执行 `adb devices -l`。若状态为 `unauthorized`，在设备上确认 USB 调试授权后重新连接。

### 缺少 apkanalyzer

通过 Android SDK Command-line Tools 安装，并确认 `apkanalyzer` 位于 `PATH`、`$ANDROID_HOME/tools/bin` 或 `cmdline-tools/*/bin`。

### 安装失败

检查该轮测试的 `install.txt`。工具不会自动使用降级安装、替换签名或猜测包名。

## 测试

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:electron
```

E2E 使用真实 Fastify 服务和 fake Android SDK，覆盖 APK 检查、显式安装与启动、人工 Crash、原始日志范围、问题报告、历史归档、设置、Monkey 进度，以及 `375x812`、`768x1024`、`1280x800` 三个视口。

## 验证记录

### 2026-07-15

- Node.js：`v26.5.0`
- 自动化：Vitest、TypeScript、ESLint、Vite build 通过；Playwright 真实服务流程 `1 passed`。
- 浏览器：三视口无水平溢出、无控件重叠、无控制台错误。
- Lighthouse：desktop/mobile Accessibility `100`、Best Practices `100`；LCP `199 ms`、CLS `0.00`。
- SEO/Agentic 扣分：保留 `robots.txt` 的 `Disallow: /` 与本地非自主访问定位，不为评分开放爬取。
- 真机 A1：`adb devices -l` 检测到 `2304FPN6DC`，状态为 `device`。
- 真机 A2–A5：未执行；本机未找到 JZStock beta APK。未使用其他 APK 替代验收目标。
- 自动化人工 Crash：fake SDK 的 Java Crash 被实时解析并展示，原始日志与 `issues.json` 已保存。
- 自动化 Monkey：500 事件进度保存并显示，主动停止后无测试创建的遗留子进程。
