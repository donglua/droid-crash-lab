import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";

vi.mock("./api/client", () => ({
  apiClient: {
    environment: vi.fn(async () => ({
      adb: { available: true, path: "/sdk/adb", checkedLocations: [] },
      apkanalyzer: { available: true, path: "/sdk/apkanalyzer", checkedLocations: [] },
    })),
    devices: vi.fn(async () => ({ devices: [] })),
    runs: vi.fn(async () => ({ runs: [] })),
  },
}));

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
});
