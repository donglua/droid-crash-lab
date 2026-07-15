import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { apkTokenSchema, deviceSerialSchema, runIdSchema } from "../../../shared/schemas.js";
import { RunHistory } from "./RunHistory.js";

describe("RunHistory", () => {
  it("shows runs newest first with summary and archive link", () => {
    render(
      <RunHistory runs={[
        run("20260715T020304Z-a1b2c3", "2026-07-15T02:03:04.000Z"),
        run("20260715T030405Z-d4e5f6", "2026-07-15T03:04:05.000Z"),
      ]} />,
    );
    const rows = screen.getAllByRole("article");
    expect(rows[0]).toHaveTextContent("20260715T030405Z-d4e5f6");
    expect(screen.getAllByText("cn.example.app")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "下载归档" })[0]).toHaveAttribute(
      "href",
      "/api/runs/20260715T030405Z-d4e5f6/archive",
    );
  });

  it("renders an unframed empty history state", () => {
    render(<RunHistory runs={[]} />);
    expect(screen.getByText("还没有测试历史")).toBeInTheDocument();
  });
});

function run(id: string, startedAt: string) {
  return {
    id: runIdSchema.parse(id),
    state: "completed" as const,
    config: { mode: "manual" as const },
    device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" as const, model: "Pixel_9" },
    apk: {
      token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
      applicationId: "cn.example.app",
      versionName: "1.2.3",
      versionCode: "123",
      storedPath: "/tmp/app.apk",
    },
    startedAt,
    completedAt: "2026-07-15T03:14:05.000Z",
    issueCount: 1,
  };
}
