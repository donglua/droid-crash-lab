import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LogConsole } from "./LogConsole.js";

describe("LogConsole", () => {
  it("filters, searches, and pauses automatic scrolling", async () => {
    const user = userEvent.setup();
    render(
      <LogConsole
        lines={[
          { lineNumber: 1, level: "info", line: "Activity started" },
          { lineNumber: 2, level: "error", line: "FATAL EXCEPTION: main" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "错误" }));
    expect(screen.queryByText("Activity started")).not.toBeInTheDocument();
    expect(screen.getByText("FATAL EXCEPTION: main")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索日志"), "missing");
    expect(screen.getByText("没有匹配的日志")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "暂停滚动" }));
    expect(screen.getByRole("button", { name: "恢复滚动" })).toBeInTheDocument();
  });
});
