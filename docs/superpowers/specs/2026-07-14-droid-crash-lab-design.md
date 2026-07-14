# DroidCrashLab 设计规格

## 1. 目标

DroidCrashLab 是运行在 macOS 本机的 Android 真机崩溃巡检工具。首版通过本地 Web 界面完成设备选择、APK 安装、应用启动、人工巡检、Monkey 测试、实时日志查看和崩溃归类。

工具面向单人使用，只监听 `127.0.0.1`，不提供账号、团队协作或远程访问能力。

### 成功标准

- 能识别已连接的 Android 设备，并在多设备时要求显式选择。
- 能读取本地 APK 的包名和版本，执行覆盖安装并启动应用。
- 能启动人工巡检或 Monkey 测试，并持续保存 `main`、`system`、`crash` 日志缓冲区。
- Java 崩溃、ANR、Native 崩溃和 OOM 能在界面中实时出现，并保留原始日志上下文。
- 测试停止或服务退出后，不遗留 `adb logcat` 或 Monkey 子进程。
- 历史测试记录在服务重启后仍可查看和导出。

## 2. 首版范围

### 包含

- `adb` 环境和设备状态检查。
- 本地 APK 选择、元数据读取、覆盖安装和启动。
- 人工巡检模式：只采集日志，由测试人员操作真机。
- Monkey 模式：配置事件数、节流时间和随机种子。
- 实时测试状态、日志流和问题计数。
- 崩溃归类、重复问题合并、原始上下文查看。
- 本地测试历史和结果下载。

### 不包含

- 截图、录屏和视觉差异比较。
- UI 树自动爬取、页面覆盖率和自动返回。
- 云端服务、局域网共享、账号和权限系统。
- 任意 Shell 命令输入框。
- APK 构建、签名、降级安装和多 APK 安装。
- ProGuard/R8 mapping 反混淆和 Native 符号化。
- 自动提交缺陷或上传日志。

## 3. 技术方案

首版使用全 TypeScript 本地 Web 架构：

- 前端：React、Vite、TypeScript。
- 本地服务：Node.js、TypeScript。
- 实时传输：Server-Sent Events（SSE）。
- 持久化：文件系统中的 JSON、JSONL 和原始文本文件，不引入数据库。
- 测试：Vitest、服务端接口测试、Playwright 浏览器测试。

选择本地 Web 而不是直接使用 Tauri，原因是核心能力都依赖 `adb` 子进程和日志解析，先验证这些能力可以减少桌面打包、签名和升级机制带来的前置工作。服务和前端边界保持清晰，后续可以增加 Tauri 外壳而不重写测试引擎。

## 4. 系统结构

```text
Browser UI
  | HTTP + SSE
  v
Local Node Service (127.0.0.1)
  |-- DeviceService
  |-- ApkService
  |-- RunCoordinator
  |-- AdbProcessRunner
  |-- LogcatParser
  |-- RunRepository
  v
ADB child processes
  v
Selected Android device
```

### 4.1 Browser UI

负责输入测试配置、展示运行状态和查看结果，不直接执行系统命令。

首屏采用安静、紧凑的运维工具布局：

- 顶部：工具名称、ADB 状态和当前设备。
- 左侧：当前测试、问题报告、测试历史、设置。
- 主区顶部：状态、耗时、事件数、Crash 数、ANR 数。
- 主区左侧：APK 信息、测试模式和启动/停止操作。
- 主区右侧：实时发现的问题。
- 主区底部：可暂停滚动和筛选的实时日志。

### 4.2 Local Node Service

服务只绑定 `127.0.0.1`。它拥有所有子进程、文件和状态，是测试运行的唯一事实来源。浏览器刷新或关闭不会终止测试；服务退出会停止所有活跃子进程并将测试标记为中断。

### 4.3 AdbProcessRunner

只允许预定义操作：

- `adb devices -l`
- APK 安装
- 包启动和停止
- `adb logcat`
- `adb shell monkey`
- 必要的包信息查询

所有参数通过参数数组传给子进程，不经 Shell 拼接。首版不提供任意命令执行接口。

## 5. 核心流程

### 5.1 环境和设备

1. 服务启动时查找 `adb`，优先使用 `PATH`，再检查 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT`。
2. 每两秒刷新一次设备列表，也允许手动刷新。
3. 只有一个 `device` 状态的设备时自动选中；多个设备时必须手动选择。
4. `offline`、`unauthorized` 和断开状态显示明确原因，禁止开始测试。

### 5.2 APK 安装和启动

1. 浏览器通过文件选择器上传 APK 到服务的临时目录。
2. `ApkService` 使用 Android SDK 的 `apkanalyzer` 读取应用 ID、版本名和版本号。
3. 元数据读取失败时停止安装，并提示缺少的 SDK 工具，不猜测包名。
4. 使用选定设备执行覆盖安装。
5. 安装成功后解析 Launcher Activity，并通过 `adb shell am start -W` 启动。
6. 安装和启动的完整标准输出、标准错误保存到测试记录。

### 5.3 人工巡检

1. 清空设备日志缓冲区。
2. 启动 `adb logcat -v threadtime -b main -b system -b crash`。
3. 测试人员在真机上操作页面。
4. 日志同时写入磁盘、发送到解析器并通过 SSE 推送到浏览器。
5. 停止时结束日志进程、刷新文件并生成测试摘要。

### 5.4 Monkey 测试

Monkey 默认参数：

- 事件数：`10000`
- 节流：`350 ms`
- 随机种子：当前日期生成，可修改且必须保存
- 包限制：当前 APK 的应用 ID
- 系统按键和应用切换比例：`0`
- 忽略 Crash、Timeout 和 SecurityException，以便继续发现后续问题
- 监控 Native Crash

日志采集先于 Monkey 启动。Monkey 标准输出单独保存，并解析当前事件进度。停止操作同时终止 Monkey 和日志进程。

## 6. 运行状态

系统同一时间只允许一个测试运行。状态如下：

```text
idle -> preparing -> installing -> launching -> running -> stopping -> completed
                                      |             |
                                      v             v
                                    failed       interrupted
```

- `failed`：准备、安装或启动阶段失败，测试没有进入有效运行状态。
- `interrupted`：服务退出、设备断开或子进程意外终止。
- `completed`：人工停止或 Monkey 正常完成，并且所有结果已刷新到磁盘。

每次状态变化写入 `events.jsonl` 并通过 SSE 推送。

## 7. 崩溃解析

解析器从完整 `logcat` 流中识别以下类型：

| 类型 | 主要标识 |
| --- | --- |
| Java Crash | `FATAL EXCEPTION`、应用进程名和异常堆栈 |
| ANR | `ANR in <package>`、`Input dispatching timed out` |
| Native Crash | `Fatal signal`、`DEBUG`、`tombstoned` |
| OOM | `OutOfMemoryError`、相关 `FATAL EXCEPTION` |
| DI Crash | `No injector factory bound`、`Unknown model class`，作为 Java Crash 标签 |

### 7.1 问题记录

每个问题包含：

- `id`
- `type`
- `timestamp`
- `processName`
- `threadName`
- `summary`
- `exceptionClass`
- `topApplicationFrame`
- `fingerprint`
- `occurrenceCount`
- `rawLogStartLine` 和 `rawLogEndLine`
- Monkey 事件进度（如适用）

### 7.2 去重规则

- Java Crash：异常类 + 第一条应用代码堆栈。
- ANR：应用进程 + ANR 原因。
- Native Crash：信号 + 第一条可用应用或库帧。
- 缺少稳定帧时退化为类型 + 规范化摘要。

去重只合并同一次测试中的问题。原始日志不删除，所有出现时间都保留。

## 8. 本地数据

默认数据目录：`~/.droid-crash-lab/`。

```text
~/.droid-crash-lab/
  settings.json
  runs/
    <run-id>/
      metadata.json
      events.jsonl
      logcat.txt
      monkey.txt
      install.txt
      issues.json
```

`run-id` 使用 UTC 时间和短随机后缀。测试历史从目录读取，不维护独立数据库。结果下载时动态生成 ZIP，不长期保存重复压缩文件。

## 9. HTTP 接口

首版接口保持小而明确：

- `GET /api/health`
- `GET /api/environment`
- `GET /api/devices`
- `POST /api/apks/inspect`
- `POST /api/apks/install`
- `POST /api/apps/launch`
- `POST /api/runs`
- `POST /api/runs/:id/stop`
- `GET /api/runs`
- `GET /api/runs/:id`
- `GET /api/runs/:id/events`
- `GET /api/runs/:id/archive`

`events` 使用 SSE，事件类型包括 `state`、`progress`、`log`、`issue`、`device` 和 `error`。

## 10. 错误处理

- ADB 不存在：显示检测过的位置和修复提示，禁止测试。
- 设备未授权：显示设备序列号和「在设备上确认 USB 调试」提示。
- 设备中途断开：终止子进程，将测试标记为 `interrupted`，保留已有日志。
- APK 无效或元数据读取失败：不执行安装。
- 安装失败：保留完整输出，不自动重试或添加降级参数。
- SSE 断开：浏览器自动重连，并从最后事件 ID 补发状态事件；原始日志不补发全部历史内容。
- 服务收到退出信号：按 Monkey、logcat 的顺序停止子进程，等待文件刷新后退出。
- 日志解析失败：记录解析错误但不中断原始日志采集。

## 11. 安全约束

- 服务固定监听 `127.0.0.1`，启动参数不提供公网绑定开关。
- 不执行浏览器传入的命令字符串。
- APK 文件名不参与命令拼接，上传后使用服务生成的文件名。
- 测试界面持续提示使用测试账号，避免真实交易、支付和删除操作。
- Monkey 只允许当前应用 ID，系统按键和应用切换事件比例固定为 `0`。

## 12. 测试策略

### 单元测试

- 使用固定日志样本验证 Java Crash、ANR、Native Crash、OOM 和 DI Crash。
- 验证跨块日志拼接、重复问题合并和不完整堆栈处理。
- 验证 Monkey 参数生成和运行状态转换。

### 服务集成测试

- 使用假的 `adb` 可执行文件覆盖无设备、未授权、多设备、安装失败、设备断开和 Monkey 退出。
- 验证子进程退出和结果文件刷新。
- 验证 SSE 重连和事件顺序。

### 浏览器测试

- 验证设备选择、APK 检查、开始/停止测试、实时问题显示和历史结果下载。
- 验证窄屏下文本、按钮和日志区域不重叠。

### 真机验收

- 使用 JZStock beta APK 验证安装、启动和人工巡检。
- 使用 `jz://app/debug` 进入 JZStock 调试页并触发已有测试崩溃，确认问题在界面实时出现且原始日志完整。
- 运行一轮短 Monkey 测试，验证进度、停止、日志保存和历史记录。
- 服务停止后确认没有遗留 `adb logcat` 或 Monkey 进程。

## 13. 交付边界

首版完成时提供：

- 可运行的本地 Web 服务和前端界面。
- 开发、构建和启动命令。
- macOS 环境检查说明。
- 解析器测试样本和自动化测试。
- 一次真实 Android 设备验收记录。

Tauri 打包、页面自动爬取、截图和团队能力在首版稳定后单独设计，不预留空实现或兼容层。
