# Test Spec: DroidCrashLab V1

## Verification strategy

验证分为四层：纯函数单元测试、假的 Android SDK 工具集成测试、真实浏览器端到端测试、真实 Android 设备验收。任何一层都不能以另一层通过为由跳过。

## Test environment

- macOS，Node.js 26.x，npm 11.x。
- Android SDK：`/Users/donglua/Library/Android/sdk`。
- ADB：`/Users/donglua/Library/Android/sdk/platform-tools/adb`。
- 真实设备：USB 调试已授权的 Android 测试机。
- 真实应用：JZStock `6.187.04-beta` 或更新的待发版本。
- 测试账号不得绑定真实交易、券商或支付能力。

## Required commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

所有命令必须退出码为 `0`。真机验收在自动化命令通过后执行。

## Fixtures

在 `tests/fixtures/logcat/` 保存以下去敏日志样本：

- `java-crash.txt`：包含 `FATAL EXCEPTION`、进程、异常类、`Caused by` 和第一条应用帧。
- `di-crash.txt`：包含 `Unknown model class` 和 `No injector factory bound`。
- `anr.txt`：包含 `ANR in <package>` 和 `Input dispatching timed out`。
- `native-crash.txt`：包含 `Fatal signal`、进程和 tombstone 摘要。
- `oom.txt`：包含 `OutOfMemoryError` 和 Java 堆栈。
- `interleaved.txt`：无关日志与崩溃块交错。
- `chunked-java-crash.txt`：同一崩溃被拆成多个输入 chunk。
- `duplicate-java-crash.txt`：同一异常出现两次。

在 `tests/fixtures/fake-sdk/` 提供可执行脚本：

- `adb`：按环境变量返回设备、安装、启动、logcat 和 Monkey 输出。
- `apkanalyzer`：返回固定应用 ID `cn.jingzhuan.stock`、版本名和版本号。

## Unit tests

### T1: Tool locator

文件：`src/server/adb/tool-locator.test.ts`

- `PATH` 中存在工具时返回规范化绝对路径。
- `PATH` 缺失时从 `ANDROID_HOME` 查找 ADB。
- `ANDROID_SDK_ROOT` 可作为替代 SDK 根目录。
- 工具不存在时返回包含已检查位置的结构化错误。

### T2: Device parser

文件：`src/server/devices/device-service.test.ts`

- 解析 `device`、`offline`、`unauthorized`。
- 提取序列号、`model`、`product` 和 `transport_id`。
- 单个可用设备自动选中。
- 多个可用设备不自动覆盖现有选择。
- 已选设备消失时返回断开事件。

### T3: APK service

文件：`src/server/apks/apk-service.test.ts`

- 只接受 `.apk` 文件。
- 使用生成文件名保存上传内容，不信任原文件名。
- 正确读取应用 ID、版本名和版本号。
- `apkanalyzer` 失败时不调用安装命令。
- 安装使用参数数组 `['-s', serial, 'install', '-r', apkPath]`。
- Launcher Activity 解析失败时返回结构化错误。

### T4: Monkey arguments

文件：`src/server/runs/monkey-command.test.ts`

- 默认事件数为 `10000`，节流为 `350`。
- 参数包含包限制、忽略崩溃、忽略超时和 Native Crash 监控。
- 系统按键和应用切换比例为 `0`。
- 拒绝小于 `1` 或超过 `1000000` 的事件数。
- 拒绝小于 `0` 或超过 `10000` 的节流时间。
- 随机种子必须是 32 位有符号整数。

### T5: Log line framing

文件：`src/server/logcat/log-framer.test.ts`

- 单个 chunk 中多行能按顺序输出。
- 跨 chunk 的半行只在换行到达后输出。
- 流结束时刷新最后一个无换行内容。
- 原始行号严格递增。

### T6: Crash parser

文件：`src/server/logcat/crash-parser.test.ts`

- Java Crash 提取异常类、线程、进程和第一条应用帧。
- DI Crash 保持 `java` 类型并增加 `di` 标签。
- ANR 提取包名和原因。
- Native Crash 提取信号和进程。
- OOM 归类为 `oom`，同时保留 Java 原始堆栈。
- 解析器遇到不完整日志时不抛出到采集循环。

### T7: Issue collector

文件：`src/server/logcat/issue-collector.test.ts`

- 相同 fingerprint 合并并增加 `occurrenceCount`。
- 不同应用帧不得合并。
- 所有出现时间均被保存。
- `rawLogStartLine` 和 `rawLogEndLine` 指向原始文件范围。

### T8: Run state machine

文件：`src/server/runs/run-state.test.ts`

- 只允许设计规格定义的状态转换。
- `running` 可以进入 `stopping` 或 `interrupted`。
- `completed`、`failed` 和 `interrupted` 为终止状态。
- 非法转换返回错误且不修改当前状态。

### T9: Run repository

文件：`src/server/runs/run-repository.test.ts`

- 创建运行目录和全部基础文件。
- JSON 写入采用临时文件加原子重命名。
- 服务重启后可以加载历史记录。
- 损坏的单个历史目录被标记为不可读，不影响其他记录。
- ZIP 归档只包含该轮测试文件。

## Service integration tests

### T10: Environment and devices API

文件：`src/server/api/environment-routes.test.ts`

- `GET /api/environment` 返回工具状态。
- `GET /api/devices` 返回假的 ADB 设备。
- 缺少 ADB 时 HTTP 状态仍为 `200`，响应中的 capability 为不可用。

### T11: APK API

文件：`src/server/api/apk-routes.test.ts`

- 上传 APK 后返回元数据和服务生成的 token。
- 非 APK 返回 `400`。
- 安装失败返回 `422` 并包含保存日志的位置。
- 浏览器不能提交任意 APK 文件系统路径。

### T12: Manual run integration

文件：`src/server/runs/run-coordinator.integration.test.ts`

- 启动人工巡检时先清空日志，再启动 logcat。
- 假日志中的 Crash 被写入 `issues.json` 并发出 SSE 事件。
- 停止后等待 logcat 退出并将状态写为 `completed`。
- 设备断开时状态写为 `interrupted`。

### T13: Monkey run integration

文件：`src/server/runs/monkey-run.integration.test.ts`

- logcat 在 Monkey 之前启动。
- Monkey 进度更新到运行摘要。
- Monkey 正常退出后自动完成测试。
- 主动停止按 Monkey、logcat 的顺序结束子进程。
- 子进程非零退出不会丢失已有日志。

### T14: SSE behavior

文件：`src/server/api/run-events.test.ts`

- 新连接立即收到当前状态快照。
- 状态、进度、日志和 issue 事件顺序正确。
- `Last-Event-ID` 重连后补发状态事件，不重放全部原始日志。
- 客户端断开不会停止测试。

## Frontend tests

### T15: Application shell

文件：`src/web/App.test.tsx`

- 显示工具状态和设备选择器。
- 无设备时禁用 APK 安装和开始测试。
- 多设备时显示显式选择提示。

### T16: Test controls

文件：`src/web/features/current-run/RunSetup.test.tsx`

- APK 上传后显示包名和版本。
- 人工模式不显示 Monkey 参数。
- Monkey 模式显示事件数、节流和随机种子。
- 运行中禁用配置并显示「停止并保存」。

### T17: Issue list and log console

文件：`src/web/features/current-run/IssueList.test.tsx`、`LogConsole.test.tsx`

- 新 issue 事件实时增加计数。
- 重复 issue 显示出现次数。
- 日志支持暂停自动滚动、级别筛选和文本搜索。
- 选中问题后显示完整原始日志范围。

### T18: Run history

文件：`src/web/features/history/RunHistory.test.tsx`

- 按时间倒序显示历史测试。
- 显示状态、应用、设备、耗时和问题数量。
- 下载按钮使用正确归档 URL。

## Browser end-to-end tests

文件：`tests/e2e/droid-crash-lab.spec.ts`

使用假的 Android SDK 启动真实服务和浏览器：

1. 页面加载后显示一台可用设备。
2. 上传 fixture APK，显示 `cn.jingzhuan.stock`。
3. 执行覆盖安装并显示安装完成。
4. 启动人工巡检，接收假的 Java Crash，问题计数变为 `1`。
5. 停止后历史记录出现该测试。
6. 启动 Monkey，观察进度并主动停止。
7. 下载归档并验证 ZIP 文件名。
8. 在 `375x812`、`768x1024` 和 `1280x800` 视口检查文本和控件不重叠。

## Real-device acceptance

### A1: Environment

```bash
adb devices -l
```

预期：目标设备状态为 `device`，没有 `unauthorized` 或 `offline`。

### A2: Install and launch

- 选择 JZStock beta APK。
- 确认应用 ID、版本名和版本号正确。
- 覆盖安装并启动 `WelcomeActivity`。
- 确认登录态和本地数据未被清除。

### A3: Manual crash capture

- 启动人工巡检。
- 打开 `jz://app/debug`。
- 在调试页触发已有测试崩溃。
- 预期 2 秒内显示 Java Crash，摘要、异常类和原始上下文完整。
- 停止测试后检查 `logcat.txt` 和 `issues.json`。

### A4: Short Monkey

- 使用 `500` 个事件、`200 ms` 节流和固定种子运行。
- 预期进度持续更新，停止操作有效。
- Monkey 输出、logcat 和问题列表均保存。

### A5: Process cleanup

停止服务后执行：

```bash
ps aux | rg 'droid-crash-lab|adb logcat|shell monkey'
```

预期：不存在由 DroidCrashLab 创建的活跃测试子进程。

## Release gate

- 所有必需命令退出码为 `0`。
- 单元和集成测试没有跳过项。
- Playwright 三个视口通过。
- A1 至 A5 全部通过。
- `git status --short` 只包含预期提交内容。
- README 记录启动方式、依赖条件、测试账号警告和结果目录。

## Known exclusions

- 不验证截图、录屏、UI 自动爬取和页面覆盖率。
- 不验证远程访问和多用户并发。
- 不验证 R8 反混淆和 Native 符号化。

