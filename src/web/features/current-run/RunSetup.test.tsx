import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RunSetup } from "./RunSetup.js";

describe("RunSetup", () => {
  it("switches to Monkey mode and enforces bounded numeric inputs", async () => {
    const user = userEvent.setup();
    render(<RunSetup canOperate onInstall={vi.fn()} onLaunch={vi.fn()} onStart={vi.fn()} onStop={vi.fn()} running={false} />);

    await user.click(screen.getByRole("radio", { name: "Monkey" }));
    expect(screen.getByLabelText("事件数")).toHaveAttribute("min", "1");
    expect(screen.getByLabelText("事件数")).toHaveAttribute("max", "1000000");
    expect(screen.getByLabelText("节流毫秒")).toHaveAttribute("max", "10000");
    expect(screen.getByRole("button", { name: "开始测试" })).toBeDisabled();
  });

  it("shows APK metadata and exposes stop while running", async () => {
    render(
      <RunSetup
        canOperate
        apk={{ applicationId: "cn.example.app", versionName: "1.2.3", versionCode: "123" }}
        onInstall={vi.fn()}
        onLaunch={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        running
      />,
    );
    expect(screen.getByText("cn.example.app")).toBeInTheDocument();
    expect(screen.getByText("1.2.3 (123)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止测试" })).toBeEnabled();
  });
});
