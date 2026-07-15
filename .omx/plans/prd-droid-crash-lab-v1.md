# PRD: DroidCrashLab V1

## Objective

构建一个仅运行在当前 macOS 本机的 Android 真机崩溃巡检工具。工具通过 Web 界面完成设备选择、APK 覆盖安装、应用启动、人工巡检、Monkey 测试、实时日志展示、崩溃归类和历史结果导出。

## Primary user

- Android 开发者或测试人员。
- 本机已安装 Android SDK，并通过 USB 连接一台或多台测试设备。
- 主要目标是在发版前尽量访问业务页面，并快速发现 Java Crash、ANR、Native Crash、OOM 和依赖注入异常。

## Product decisions

1. 项目名为 `DroidCrashLab`。
2. 项目目录为 `/Users/donglua/proj/opensource/droid-crash-lab`。
3. 首版使用本地 Web 架构，服务固定监听 `127.0.0.1`。
4. 前后端统一使用 TypeScript；前端使用 React，服务端使用 Node.js。
5. 首版支持本地 APK 选择、元数据读取、覆盖安装和启动。
6. 自动测试只提供可配置 Monkey，不实现 UI 树自动爬取。
7. 首版不采集截图或录屏，重点保留完整崩溃日志。
8. 同一时间只允许一个测试运行，只操作一台显式选中的设备。
9. 测试历史使用文件系统保存，不引入数据库。

## Functional requirements

### R1: Environment detection

- 启动时定位 `adb` 和 `apkanalyzer`。
- 优先读取 `PATH`，随后检查 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT`。
- 缺少工具时显示检测位置和修复提示，并禁止相关操作。

### R2: Device management

- 每两秒刷新 `adb devices -l`。
- 展示序列号、型号和 `device`、`offline`、`unauthorized` 状态。
- 单个可用设备自动选中；多个可用设备要求手动选择。
- 设备断开后立即停止当前测试并保留已有日志。

### R3: APK inspection

- 浏览器选择 `.apk` 文件并上传到本地服务。
- 使用 `apkanalyzer` 读取应用 ID、版本名和版本号。
- 无法读取元数据时不执行安装，不猜测包名。

### R4: APK installation and launch

- 使用 `adb -s <serial> install -r <apk>` 覆盖安装。
- 保存安装过程的标准输出和标准错误。
- 安装成功后解析 Launcher Activity，并使用 `am start -W` 启动。
- 不提供降级安装、签名替换或多 APK 安装。

### R5: Manual run

- 清空设备日志缓冲区后启动持续 `logcat`。
- 测试人员在真机上手动访问页面。
- 浏览器实时显示运行状态、耗时、问题数量和日志。
- 手动停止后刷新所有文件并生成摘要。

### R6: Monkey run

- 可配置事件数、节流时间和随机种子。
- 默认值为 `10000`、`350 ms` 和当前日期种子。
- Monkey 只能操作当前应用 ID，系统按键和应用切换比例固定为 `0`。
- Monkey 崩溃、超时和安全异常不终止整轮测试，以便继续发现后续问题。
- 保存完整 Monkey 输出和最终事件进度。

### R7: Log collection

- 持续采集 `main`、`system` 和 `crash` 缓冲区。
- 原始日志逐行写入磁盘，解析错误不能中断采集。
- 浏览器断开不终止测试，重新连接后恢复当前状态。

### R8: Issue detection

- 识别 Java Crash、ANR、Native Crash 和 OOM。
- 将 `No injector factory bound`、`Unknown model class` 标记为 DI Crash。
- 同一测试中按稳定 fingerprint 合并重复问题，同时保留出现次数和时间。
- 问题详情必须能查看完整原始日志上下文。

### R9: Run lifecycle

- 状态为 `idle`、`preparing`、`installing`、`launching`、`running`、`stopping`、`completed`、`failed`、`interrupted`。
- 服务退出时按 Monkey、logcat 的顺序停止子进程。
- 停止后不得遗留 DroidCrashLab 创建的 `adb logcat` 或 Monkey 进程。

### R10: Run history

- 数据保存在 `~/.droid-crash-lab/runs/<run-id>/`。
- 每轮保存 `metadata.json`、`events.jsonl`、`logcat.txt`、`monkey.txt`、`install.txt` 和 `issues.json`。
- 服务重启后仍能列出并查看历史测试。
- 支持将一轮测试动态打包为 ZIP 下载。

### R11: Local Web UI

- 顶部显示 ADB 状态和当前设备。
- 左侧提供「当前测试」「问题报告」「测试历史」「设置」。
- 主区显示 APK、测试模式、运行控制、状态指标、问题列表和实时日志。
- 日志区域支持暂停滚动、级别筛选和文本搜索。
- 页面在桌面和窄屏浏览器中不得出现文本或控件重叠。

### R12: Safety

- 服务只监听 `127.0.0.1`，不提供外网绑定参数。
- 服务端只执行预定义 ADB 操作，不接受任意 Shell 字符串。
- 子进程参数使用数组传递，不经过 Shell 拼接。
- 界面持续提示 Monkey 必须使用测试账号，避免真实交易、支付和删除操作。

## Non-goals

- 截图、录屏、视觉比较和页面覆盖率。
- UI 树自动爬取和自动返回。
- 云端服务、局域网共享、账号和权限系统。
- APK 构建、签名、降级安装和 split APK。
- ProGuard/R8 mapping 反混淆和 Native 符号化。
- 自动创建缺陷、发送消息或上传日志。
- 首版 Tauri 打包。

## Delivery slices

1. Foundation：项目骨架、共享契约和环境检测。
2. Device and APK：设备管理、APK 检查、安装和启动。
3. Crash engine：日志采集、解析、去重和文件存储。
4. Run engine：人工巡检、Monkey、状态机和进程清理。
5. Web console：实时控制台、问题列表和历史记录。
6. Release gate：自动化测试、真实设备验证、文档和生产构建。

## Acceptance criteria

- 在当前 Mac 上执行 `npm install && npm run dev` 后可打开本地 Web 界面。
- 连接 JZStock 测试设备后，界面能显示设备和当前安装版本。
- 选择 JZStock beta APK 后能覆盖安装并启动。
- 人工巡检期间触发 JZStock 调试崩溃，问题在 2 秒内出现在界面。
- 短 Monkey 测试能够运行、停止并保存完整结果。
- 重启服务后历史测试仍可查看和下载。
- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 和 Playwright 测试全部通过。
- 服务停止后无遗留子进程。

## Source of truth

- 设计规格：`docs/superpowers/specs/2026-07-14-droid-crash-lab-design.md`
- 测试规格：`.omx/plans/test-spec-droid-crash-lab-v1.md`
- 实现计划：`.omx/plans/implementation-droid-crash-lab-v1.md`

