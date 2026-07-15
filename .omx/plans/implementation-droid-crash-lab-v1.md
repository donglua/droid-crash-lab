# DroidCrashLab V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个只监听本机、可安装 Android APK、运行人工或 Monkey 真机测试并实时归类崩溃日志的 Web 工具。

**Architecture:** 单一 npm 项目包含 React/Vite 前端、Fastify 本地服务和共享 TypeScript 契约。服务端独占 ADB 子进程与运行状态，通过 HTTP 和 SSE 向浏览器提供能力，测试结果以 JSON、JSONL 和原始文本保存在 `~/.droid-crash-lab/`。

**Tech Stack:** Node.js 26、npm 11、TypeScript strict、React、Vite、Fastify、Zod、Vitest、Testing Library、Playwright、Lucide React、原生 `node:child_process`。

---

## Execution rules

- 从 `/Users/donglua/proj/opensource/droid-crash-lab` 执行全部命令。
- 以 `docs/superpowers/specs/2026-07-14-droid-crash-lab-design.md`、`.omx/plans/prd-droid-crash-lab-v1.md` 和 `.omx/plans/test-spec-droid-crash-lab-v1.md` 为需求来源。
- 每个任务先写失败测试，再实现最小代码，再运行任务级验证，再提交。
- 不添加截图、UI 自动爬取、远程访问、数据库、Tauri 或任意 Shell 输入。
- 不修改 `.omx/state`、`.omx/logs` 或 `.omx/metrics.json`。
- 提交信息遵循 Conventional Commits。

## Planned file structure

```text
package.json
package-lock.json
index.html
tsconfig.base.json
tsconfig.server.json
tsconfig.web.json
vite.config.ts
vitest.config.ts
playwright.config.ts
eslint.config.js
src/
  shared/
    contracts.ts
    schemas.ts
  server/
    index.ts
    app.ts
    config.ts
    adb/
      process-runner.ts
      tool-locator.ts
    devices/
      device-service.ts
    apks/
      apk-service.ts
    logcat/
      log-framer.ts
      crash-parser.ts
      issue-collector.ts
    runs/
      monkey-command.ts
      run-state.ts
      run-repository.ts
      run-coordinator.ts
    events/
      event-bus.ts
    api/
      environment-routes.ts
      apk-routes.ts
      run-routes.ts
  web/
    main.tsx
    App.tsx
    styles.css
    api/client.ts
    hooks/use-run-events.ts
    components/AppShell.tsx
    features/current-run/
      RunSetup.tsx
      StatusMetrics.tsx
      IssueList.tsx
      LogConsole.tsx
    features/history/
      RunHistory.tsx
tests/
  fixtures/
    fake-sdk/
    logcat/
  e2e/droid-crash-lab.spec.ts
README.md
```

### Task 1: Bootstrap the strict TypeScript application

**Files:**
- Create: `package.json`
- Create: `index.html`
- Create: `tsconfig.base.json`
- Create: `tsconfig.server.json`
- Create: `tsconfig.web.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `eslint.config.js`
- Create: `src/web/main.tsx`
- Create: `src/web/App.tsx`
- Test: `src/web/App.test.tsx`

- [ ] **Step 1: Initialize npm and install the approved dependencies**

```bash
npm init -y
npm install fastify @fastify/multipart @fastify/static archiver zod react react-dom react-router-dom lucide-react
npm install -D typescript tsx vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test eslint @eslint/js typescript-eslint @types/node @types/react @types/react-dom @types/archiver concurrently
```

Expected: `package-lock.json` exists and `npm audit` reports no unresolved critical vulnerability used by production code.

- [ ] **Step 2: Add strict scripts and TypeScript configuration**

Set `package.json` scripts to:

```json
{
  "scripts": {
    "dev": "concurrently -k \"npm:dev:server\" \"npm:dev:web\"",
    "dev:server": "tsx watch src/server/index.ts",
    "dev:web": "vite",
    "build": "npm run build:web && npm run build:server",
    "build:web": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test"
  }
}
```

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride` and `useUnknownInCatchVariables` in `tsconfig.base.json`.

- [ ] **Step 3: Write the failing application-shell test**

```tsx
it('renders the product name and disconnected device state', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'DroidCrashLab' })).toBeInTheDocument()
  expect(screen.getByText('未连接设备')).toBeInTheDocument()
})
```

- [ ] **Step 4: Run the test and verify the failure**

```bash
npm test -- src/web/App.test.tsx
```

Expected: FAIL because the application shell has not been implemented.

- [ ] **Step 5: Implement the minimal React entry and shell**

Create an `App` that renders the product heading and disconnected state. Keep styling minimal until Task 11.

- [ ] **Step 6: Run bootstrap verification**

```bash
npm run typecheck
npm test -- src/web/App.test.tsx
npm run build:web
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json index.html tsconfig*.json vite.config.ts vitest.config.ts playwright.config.ts eslint.config.js src/web
git commit -m "chore: bootstrap DroidCrashLab application"
```

### Task 2: Define shared contracts and validation schemas

**Files:**
- Create: `src/shared/contracts.ts`
- Create: `src/shared/schemas.ts`
- Test: `src/shared/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Test valid and invalid `RunConfig`, including Monkey event and throttle bounds.

```ts
expect(runConfigSchema.parse({ mode: 'monkey', eventCount: 500, throttleMs: 200, seed: 42 })).toMatchObject({ mode: 'monkey' })
expect(() => runConfigSchema.parse({ mode: 'monkey', eventCount: 0, throttleMs: 200, seed: 42 })).toThrow()
```

- [ ] **Step 2: Run the test and verify the failure**

```bash
npm test -- src/shared/schemas.test.ts
```

Expected: FAIL because contracts do not exist.

- [ ] **Step 3: Define the exact shared domain types**

```ts
export type DeviceState = 'device' | 'offline' | 'unauthorized'
export type RunMode = 'manual' | 'monkey'
export type RunState = 'idle' | 'preparing' | 'installing' | 'launching' | 'running' | 'stopping' | 'completed' | 'failed' | 'interrupted'
export type IssueType = 'java' | 'anr' | 'native' | 'oom'

export interface DeviceInfo {
  serial: string
  state: DeviceState
  model?: string
  product?: string
  transportId?: string
}

export interface ApkInfo {
  token: string
  applicationId: string
  versionName: string
  versionCode: string
  storedPath: string
}
```

Add `RunConfig`, `RunSummary`, `Issue`, `RunEvent` and API response types matching the PRD. Define Zod schemas for all browser-supplied payloads.

- [ ] **Step 4: Run tests and typecheck**

```bash
npm test -- src/shared/schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared
git commit -m "feat(core): define test run contracts"
```

### Task 3: Implement safe process execution and Android tool discovery

**Files:**
- Create: `src/server/adb/process-runner.ts`
- Create: `src/server/adb/tool-locator.ts`
- Test: `src/server/adb/process-runner.test.ts`
- Test: `src/server/adb/tool-locator.test.ts`

- [ ] **Step 1: Write failing locator and process tests**

Cover PATH lookup, SDK-root fallback, missing-tool diagnostics, argument-array preservation, stdout/stderr capture and abort-signal termination.

- [ ] **Step 2: Run the tests and verify the failure**

```bash
npm test -- src/server/adb/process-runner.test.ts src/server/adb/tool-locator.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement a no-shell process boundary**

Use `spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`. Expose one-shot execution and streaming execution as separate functions. The streaming handle must expose `pid`, `completion` and idempotent `stop()`.

- [ ] **Step 4: Implement deterministic tool lookup**

Check `PATH`, then `${ANDROID_HOME}/platform-tools/adb`, `${ANDROID_SDK_ROOT}/platform-tools/adb`, and the SDK command-line-tools directories for `apkanalyzer`. Return checked paths with failures.

- [ ] **Step 5: Run verification**

```bash
npm test -- src/server/adb/process-runner.test.ts src/server/adb/tool-locator.test.ts
npm run typecheck
```

Expected: PASS and no `shell: true` usage.

- [ ] **Step 6: Commit**

```bash
git add src/server/adb
git commit -m "feat(adb): add safe process and tool discovery"
```

### Task 4: Implement device discovery and selection

**Files:**
- Create: `src/server/devices/device-service.ts`
- Test: `src/server/devices/device-service.test.ts`

- [ ] **Step 1: Write failing parser and selection tests**

Use fixture output containing one `device`, one `offline` and one `unauthorized` entry. Assert metadata parsing and selection behavior from T2.

- [ ] **Step 2: Run the test and verify the failure**

```bash
npm test -- src/server/devices/device-service.test.ts
```

- [ ] **Step 3: Implement device polling without overlapping requests**

Expose `refresh()`, `startPolling(intervalMs)`, `stopPolling()`, `select(serial)` and `onChange(listener)`. Skip a tick while the previous ADB request is still active.

- [ ] **Step 4: Verify**

```bash
npm test -- src/server/devices/device-service.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/server/devices
git commit -m "feat(devices): discover and select Android devices"
```

### Task 5: Implement APK inspection, installation and launch

**Files:**
- Create: `src/server/apks/apk-service.ts`
- Test: `src/server/apks/apk-service.test.ts`
- Create: `tests/fixtures/fake-sdk/apkanalyzer`
- Create: `tests/fixtures/fake-sdk/adb`

- [ ] **Step 1: Create executable fake SDK tools**

The fake `apkanalyzer` must return `cn.jingzhuan.stock`, `6.187.04-beta` and `61870400`. The fake `adb` must append received arguments to a path supplied by `FAKE_ADB_CALLS` and emit configurable exit codes.

- [ ] **Step 2: Write failing APK tests**

Assert extension validation, generated upload names, metadata extraction, exact install arguments, Launcher resolution and launch arguments.

- [ ] **Step 3: Run the test and verify the failure**

```bash
npm test -- src/server/apks/apk-service.test.ts
```

- [ ] **Step 4: Implement APK operations**

Store uploads under `~/.droid-crash-lab/uploads/<uuid>.apk`. Use `apkanalyzer manifest application-id`, `manifest version-name` and `manifest version-code`. Install with `adb -s <serial> install -r <path>`, resolve with `cmd package resolve-activity --brief`, then launch with `am start -W -n <component>`.

- [ ] **Step 5: Verify**

```bash
npm test -- src/server/apks/apk-service.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/apks tests/fixtures/fake-sdk
git commit -m "feat(apk): inspect install and launch packages"
```

### Task 6: Implement log framing and crash parsing

**Files:**
- Create: `src/server/logcat/log-framer.ts`
- Create: `src/server/logcat/crash-parser.ts`
- Test: `src/server/logcat/log-framer.test.ts`
- Test: `src/server/logcat/crash-parser.test.ts`
- Create: `tests/fixtures/logcat/*.txt`

- [ ] **Step 1: Add all log fixtures from the test specification**

Keep samples minimal and remove user IDs, device IDs, tokens, phone numbers and private URLs.

- [ ] **Step 2: Write failing framing tests**

Verify complete lines, chunk boundaries, end-of-stream flushing and monotonically increasing raw line numbers.

- [ ] **Step 3: Implement `LogFramer` and verify it**

```bash
npm test -- src/server/logcat/log-framer.test.ts
```

- [ ] **Step 4: Write failing crash-parser tests**

Assert all cases from T6 and require the parser to return structured parse warnings instead of throwing.

- [ ] **Step 5: Implement the bounded parser**

Maintain a bounded candidate block. Start a Java block on `FATAL EXCEPTION`, an ANR block on `ANR in`, and a Native block on `Fatal signal`. Finalize on a new timestamped unrelated record or a maximum of 400 lines. Preserve raw line ranges.

- [ ] **Step 6: Verify parser behavior**

```bash
npm test -- src/server/logcat/log-framer.test.ts src/server/logcat/crash-parser.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/server/logcat tests/fixtures/logcat
git commit -m "feat(logcat): parse Android crash records"
```

### Task 7: Implement issue deduplication and run persistence

**Files:**
- Create: `src/server/logcat/issue-collector.ts`
- Create: `src/server/runs/run-repository.ts`
- Test: `src/server/logcat/issue-collector.test.ts`
- Test: `src/server/runs/run-repository.test.ts`

- [ ] **Step 1: Write failing issue fingerprint tests**

Fingerprint Java issues with exception class and first application frame, ANR with process and reason, Native with signal and first stable frame. Assert occurrence counts and timestamps.

- [ ] **Step 2: Write failing repository tests**

Use a temporary data root. Verify run creation, atomic JSON replacement, JSONL append, history reload, damaged-directory isolation and ZIP contents.

- [ ] **Step 3: Implement the collector and repository**

Write JSON through `<name>.tmp` followed by `rename`. Append events with one JSON object per line. Generate run IDs from UTC compact time plus six random hexadecimal characters.

- [ ] **Step 4: Verify**

```bash
npm test -- src/server/logcat/issue-collector.test.ts src/server/runs/run-repository.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/server/logcat/issue-collector* src/server/runs/run-repository*
git commit -m "feat(runs): persist and group crash reports"
```

### Task 8: Implement the run state machine and event bus

**Files:**
- Create: `src/server/runs/run-state.ts`
- Create: `src/server/events/event-bus.ts`
- Test: `src/server/runs/run-state.test.ts`
- Test: `src/server/events/event-bus.test.ts`

- [ ] **Step 1: Write failing transition tests**

Encode the exact transitions from the design specification. Assert that terminal states reject further transitions.

- [ ] **Step 2: Write failing event replay tests**

Require monotonically increasing event IDs, current-state snapshot and bounded replay of non-log events after `Last-Event-ID`.

- [ ] **Step 3: Implement state and event units**

Keep both units independent of Fastify and ADB so they can be tested as pure TypeScript.

- [ ] **Step 4: Verify**

```bash
npm test -- src/server/runs/run-state.test.ts src/server/events/event-bus.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/server/runs/run-state* src/server/events
git commit -m "feat(runs): add lifecycle and event stream"
```

### Task 9: Implement manual and Monkey run coordination

**Files:**
- Create: `src/server/runs/monkey-command.ts`
- Create: `src/server/runs/run-coordinator.ts`
- Test: `src/server/runs/monkey-command.test.ts`
- Test: `src/server/runs/run-coordinator.integration.test.ts`
- Test: `src/server/runs/monkey-run.integration.test.ts`

- [ ] **Step 1: Write failing Monkey command tests**

Assert the exact default arguments and validation bounds from T4. The builder returns an argument array, never a command string.

- [ ] **Step 2: Implement and verify the command builder**

```bash
npm test -- src/server/runs/monkey-command.test.ts
```

- [ ] **Step 3: Write failing coordinator integration tests**

Inject fake process runner, repository, parser and event bus. Verify logcat starts before Monkey, only one run can be active, manual stop, automatic Monkey completion, device disconnect and idempotent cleanup.

- [ ] **Step 4: Implement `RunCoordinator`**

Use an `AbortController` owned by each run. Start logcat with `-v threadtime -b main -b system -b crash`. Pipe every byte to disk before parsing. Stop Monkey first, then logcat, and await both completions before final state.

- [ ] **Step 5: Verify**

```bash
npm test -- src/server/runs/monkey-command.test.ts src/server/runs/run-coordinator.integration.test.ts src/server/runs/monkey-run.integration.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/runs
git commit -m "feat(runs): coordinate manual and Monkey tests"
```

### Task 10: Expose the local HTTP and SSE API

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/app.ts`
- Create: `src/server/index.ts`
- Create: `src/server/api/environment-routes.ts`
- Create: `src/server/api/apk-routes.ts`
- Create: `src/server/api/run-routes.ts`
- Test: `src/server/api/environment-routes.test.ts`
- Test: `src/server/api/apk-routes.test.ts`
- Test: `src/server/api/run-events.test.ts`

- [ ] **Step 1: Write failing Fastify injection tests**

Cover health, environment, devices, multipart APK inspection, install failure, run creation, run stop, history, archive and SSE snapshot.

- [ ] **Step 2: Run tests and verify the failure**

```bash
npm test -- src/server/api
```

- [ ] **Step 3: Implement dependency-injected route registration**

`buildApp(dependencies)` must return a Fastify instance without binding a port. `index.ts` constructs real dependencies and listens on `127.0.0.1:4319`. Configure multipart limits explicitly and reject non-APK uploads.

- [ ] **Step 4: Implement SSE framing**

Send `id`, `event` and JSON `data` fields, heartbeat comments every 15 seconds, and close listeners when the browser disconnects. Browser disconnect must not call `RunCoordinator.stop()`.

- [ ] **Step 5: Verify**

```bash
npm test -- src/server/api
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/server/config.ts src/server/app.ts src/server/index.ts src/server/api
git commit -m "feat(api): expose local crash testing endpoints"
```

### Task 11: Build the operational Web interface

**Files:**
- Create: `src/web/styles.css`
- Create: `src/web/api/client.ts`
- Create: `src/web/hooks/use-run-events.ts`
- Create: `src/web/components/AppShell.tsx`
- Modify: `src/web/App.tsx`
- Test: `src/web/App.test.tsx`

- [ ] **Step 1: Write failing shell interaction tests**

Mock the API and assert device state, navigation labels, current-run metrics and disabled controls when no device is selected.

- [ ] **Step 2: Implement design tokens and the shell**

Use a neutral operational palette with distinct success, warning and error colors. Use Lucide icons for navigation and commands. Use 8 px or smaller radii, fixed-height status metrics, responsive grid tracks and zero negative letter spacing. Do not add gradients, decorative blobs, marketing content or nested cards.

- [ ] **Step 3: Implement typed API and SSE clients**

All HTTP responses must parse through shared Zod schemas. `useRunEvents` reconnects with `Last-Event-ID`, updates state idempotently and exposes connection status.

- [ ] **Step 4: Verify component and responsive behavior**

```bash
npm test -- src/web/App.test.tsx
npm run typecheck
npm run build:web
```

- [ ] **Step 5: Commit**

```bash
git add src/web
git commit -m "feat(web): add operational test console"
```

### Task 12: Implement current-run controls, issues and logs

**Files:**
- Create: `src/web/features/current-run/RunSetup.tsx`
- Create: `src/web/features/current-run/StatusMetrics.tsx`
- Create: `src/web/features/current-run/IssueList.tsx`
- Create: `src/web/features/current-run/LogConsole.tsx`
- Test: matching `*.test.tsx` files

- [ ] **Step 1: Write failing user-flow tests**

Cover APK selection, metadata display, manual/Monkey segmented control, bounded numeric inputs, start/stop states, issue count updates, duplicate occurrence display, log pause, filter and search.

- [ ] **Step 2: Implement `RunSetup` and metrics**

Use a file input for APK, segmented control for mode, numeric controls for Monkey settings and explicit action buttons for install, launch, start and stop. Disable invalid or unsafe transitions from the UI while retaining server validation.

- [ ] **Step 3: Implement issues and log console**

Keep at most 5000 rendered log lines in browser memory while the raw server file remains complete. Provide All, Error, Warning and Info filters. Selecting an issue fetches and displays its raw log range.

- [ ] **Step 4: Verify**

```bash
npm test -- src/web/features/current-run
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/web/features/current-run
git commit -m "feat(web): control runs and inspect crashes"
```

### Task 13: Implement run history and production serving

**Files:**
- Create: `src/web/features/history/RunHistory.tsx`
- Test: `src/web/features/history/RunHistory.test.tsx`
- Modify: `src/server/app.ts`
- Modify: `vite.config.ts`
- Test: `src/server/app.production.test.ts`

- [ ] **Step 1: Write failing history and production tests**

Assert descending run order, summary fields, archive link, not-found handling and production static-file fallback without intercepting `/api/*`.

- [ ] **Step 2: Implement history UI**

Display status, application ID, version, device, mode, duration, issue count and archive command. Empty history is an unframed state, not a promotional card.

- [ ] **Step 3: Serve the Vite production build**

Register `@fastify/static` only when the built web directory exists. API routes take precedence. Unknown browser routes return `index.html`; unknown API routes return JSON `404`.

- [ ] **Step 4: Verify**

```bash
npm test -- src/web/features/history src/server/app.production.test.ts
npm run build
npm start
```

Expected: production server starts on `http://127.0.0.1:4319` and serves the Web UI.

- [ ] **Step 5: Commit**

```bash
git add src/web/features/history src/server/app.ts vite.config.ts
git commit -m "feat(history): browse and export test runs"
```

### Task 14: Add browser tests, documentation and real-device verification

**Files:**
- Create: `tests/e2e/droid-crash-lab.spec.ts`
- Create: `README.md`
- Modify: `.gitignore`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the Playwright test against fake SDK tools**

Implement the eight browser steps from the test specification. Configure Playwright to start the real server with fake tool paths and use desktop plus mobile viewports.

- [ ] **Step 2: Run browser tests and fix product defects**

```bash
npm run build
npm run test:e2e
```

Expected: all tests pass at `375x812`, `768x1024` and `1280x800` with no console errors.

- [ ] **Step 3: Write README operating instructions**

Document prerequisites, install, development, production start, data directory, manual mode, Monkey mode, crash categories, test-account warning, result export and troubleshooting for missing ADB, unauthorized devices and missing `apkanalyzer`.

- [ ] **Step 4: Run the complete automated gate**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: every command exits `0`.

- [ ] **Step 5: Run real-device acceptance A1 through A5**

Use the connected JZStock test device. Install the beta APK, start manual collection, trigger the existing debug crash through `jz://app/debug`, verify the UI issue within 2 seconds, run a 500-event Monkey pass, stop the service and check child-process cleanup.

- [ ] **Step 6: Record verification evidence in README**

Add a dated verification section containing commands, device model, APK version, automated test counts, manual Crash result, Monkey result and any unavailable check. Do not include user IDs, device IDs, tokens, private URLs or full crash logs.

- [ ] **Step 7: Commit**

```bash
git add README.md .gitignore playwright.config.ts tests/e2e
git commit -m "test: verify DroidCrashLab end to end"
```

## Final completion check

- [ ] Re-read the PRD and design specification against implemented behavior.
- [ ] Confirm all 14 tasks have commits and no task checkbox was skipped silently.
- [ ] Run `git status --short` and account for every remaining file.
- [ ] Run the complete automated gate again from a clean process state.
- [ ] Start the production server and manually use APK inspection, install, launch, manual run, Monkey run, issue inspection, history and archive download.
- [ ] Confirm no known errors remain and no test child process is running.
