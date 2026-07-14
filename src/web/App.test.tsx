import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("shows the disconnected application shell", () => {
    // Given the application is starting without a connected device

    // When the shell is rendered
    render(<App />);

    // Then the product identity and device state are visible
    expect(screen.getByRole("heading", { name: "DroidCrashLab" })).toBeInTheDocument();
    expect(screen.getByText("未连接设备")).toBeInTheDocument();
  });
});
