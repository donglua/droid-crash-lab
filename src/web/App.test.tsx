import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { apiClient } from "./api/client";
import { HttpResponseError } from "./api/client";
import { apkTokenSchema, deviceSerialSchema, runIdSchema } from "../shared/schemas";

vi.mock("./api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api/client")>();
  return {
    ...actual,
    apiClient: {
    environment: vi.fn(async () => ({
      adb: { available: true, path: "/sdk/adb", checkedLocations: [] },
      apkanalyzer: { available: true, path: "/sdk/apkanalyzer", checkedLocations: [] },
    })),
    devices: vi.fn(async () => ({ devices: [] })),
    runs: vi.fn(async () => ({ runs: [] })),
    inspectApk: vi.fn(async () => ({
      token: "123e4567-e89b-42d3-a456-426614174000",
      applicationId: "cn.example.app",
      versionName: "1.2.3",
      versionCode: "123",
      storedPath: "/tmp/app.apk",
    })),
    installApk: vi.fn(async () => ({ installed: true })),
    launchApp: vi.fn(async () => ({ launched: true })),
    runDetails: vi.fn(async () => ({ run: undefined, issues: [] })),
    logRange: vi.fn(async () => ({
      startLine: 10,
      endLine: 12,
      lines: [
        { lineNumber: 10, line: "FATAL EXCEPTION: main" },
        { lineNumber: 11, line: "java.lang.IllegalStateException: selected crash" },
        { lineNumber: 12, line: "at cn.example.app.MainActivity.open(MainActivity.kt:42)" },
      ],
    })),
    startRun: vi.fn(async () => ({
      id: "20260715T020304Z-a1b2c3",
      state: "running",
      config: { mode: "manual" },
      device: { serial: "emulator-5554", state: "device" },
      apk: { token: "123e4567-e89b-42d3-a456-426614174000", applicationId: "cn.example.app", versionName: "1.2.3", versionCode: "123", storedPath: "/tmp/app.apk" },
      startedAt: "2026-07-15T02:03:04.000Z",
      issueCount: 0,
    })),
    stopRun: vi.fn(async () => ({
      id: "20260715T020304Z-a1b2c3",
      state: "completed",
      config: { mode: "manual" },
      device: { serial: "emulator-5554", state: "device" },
      apk: { token: "123e4567-e89b-42d3-a456-426614174000", applicationId: "cn.example.app", versionName: "1.2.3", versionCode: "123", storedPath: "/tmp/app.apk" },
      startedAt: "2026-07-15T02:03:04.000Z",
      completedAt: "2026-07-15T02:04:04.000Z",
      issueCount: 0,
    })),
    },
  };
});

beforeEach(() => {
  vi.mocked(apiClient.devices).mockResolvedValue({ devices: [] });
  vi.mocked(apiClient.inspectApk).mockResolvedValue({
    token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
    applicationId: "cn.example.app",
    versionName: "1.2.3",
    versionCode: "123",
    storedPath: "/tmp/app.apk",
  });
});

describe("App", () => {
  it("shows the disconnected application shell", () => {
    // Given the application is starting without a connected device

    // When the shell is rendered
    render(<App />);

    // Then the product identity and device state are visible
    expect(screen.getByRole("heading", { name: "DroidCrashLab" })).toBeInTheDocument();
    expect(screen.getByText("未连接设备")).toBeInTheDocument();
  });

  it("renders navigation, current-run metrics, and disabled unsafe actions", async () => {
    render(<App />);

    expect(await screen.findByText("ADB 已就绪")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "当前测试" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "问题报告" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试历史" })).toBeInTheDocument();
    expect(screen.getByText("运行状态")).toBeInTheDocument();
    expect(screen.getByText("问题数量")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始测试" })).toBeDisabled();
  });

  it("inspects an APK and starts then stops a real run flow", async () => {
    vi.mocked(apiClient.devices).mockResolvedValue({
      devices: [{ serial: deviceSerialSchema.parse("emulator-5554"), state: "device", model: "Pixel_9" }],
      selectedSerial: deviceSerialSchema.parse("emulator-5554"),
    });
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText(/APK 文件/);
    await user.upload(input, new File(["apk"], "app.apk", { type: "application/vnd.android.package-archive" }));
    expect(await screen.findByText("cn.example.app")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "覆盖安装" }));
    expect(apiClient.installApk).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "启动应用" }));
    expect(apiClient.launchApp).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "开始测试" }));
    expect(await screen.findByRole("button", { name: "停止测试" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "停止测试" }));
    expect(await screen.findByText("已完成")).toBeInTheDocument();
  });

  it("shows an APK inspection error without claiming the local service stopped", async () => {
    vi.mocked(apiClient.devices).mockResolvedValue({
      devices: [{ serial: deviceSerialSchema.parse("emulator-5554"), state: "device" }],
      selectedSerial: deviceSerialSchema.parse("emulator-5554"),
    });
    vi.mocked(apiClient.inspectApk).mockRejectedValue(
      new HttpResponseError(422, "/api/apks/inspect", "APK_INSPECTION_FAILED"),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.upload(
      await screen.findByLabelText(/APK 文件/),
      new File(["apk"], "stock.apk", { type: "application/vnd.android.package-archive" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("APK 元数据");
    expect(screen.queryByText(/本地服务状态/u)).not.toBeInTheDocument();
  });

  it("opens issue reports and fetches the selected raw log range", async () => {
    vi.mocked(apiClient.devices).mockResolvedValue({
      devices: [{ serial: deviceSerialSchema.parse("emulator-5554"), state: "device", model: "Pixel_9" }],
      selectedSerial: deviceSerialSchema.parse("emulator-5554"),
    });
    vi.mocked(apiClient.runs).mockResolvedValue({
      runs: [{
        id: runIdSchema.parse("20260715T020304Z-a1b2c3"),
        state: "completed",
        config: { mode: "manual" },
        device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" },
        apk: { token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"), applicationId: "cn.example.app", versionName: "1.2.3", versionCode: "123", storedPath: "/tmp/app.apk" },
        startedAt: "2026-07-15T02:03:04.000Z",
        completedAt: "2026-07-15T02:04:04.000Z",
        issueCount: 1,
      }],
    });
    vi.mocked(apiClient.runDetails).mockResolvedValue({
      run: {
        id: runIdSchema.parse("20260715T020304Z-a1b2c3"),
        state: "completed",
        config: { mode: "manual" },
        device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" },
        apk: { token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"), applicationId: "cn.example.app", versionName: "1.2.3", versionCode: "123", storedPath: "/tmp/app.apk" },
        startedAt: "2026-07-15T02:03:04.000Z",
        completedAt: "2026-07-15T02:04:04.000Z",
        issueCount: 1,
      },
      issues: [{
        id: "issue-1",
        type: "java",
        timestamp: "07-15 10:00:00.000",
        processName: "cn.example.app",
        summary: "IllegalStateException: selected crash",
        fingerprint: "fingerprint",
        occurrenceCount: 1,
        occurrenceTimestamps: ["07-15 10:00:00.000"],
        rawLogStartLine: 10,
        rawLogEndLine: 12,
      }],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "问题报告" }));
    await user.click(await screen.findByRole("button", { name: /IllegalStateException: selected crash/u }));

    expect(apiClient.logRange).toHaveBeenCalledWith("20260715T020304Z-a1b2c3", 10, 12);
    expect(await screen.findByText("java.lang.IllegalStateException: selected crash")).toBeInTheDocument();
  });

  it("shows a dedicated settings view instead of the current test dashboard", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "设置" }));

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("本地服务与 Android SDK 能力状态。")) .toBeInTheDocument();
    expect(screen.getByText(window.location.host)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "开始测试" })).not.toBeInTheDocument();
  });
});
