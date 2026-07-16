import { expect, test, _electron as electron } from "@playwright/test";

test("opens the existing React application from an ephemeral local service", async () => {
  const application = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      PATH: `${process.cwd()}/tests/fixtures/fake-sdk:${process.env["PATH"] ?? ""}`,
      DROID_CRASH_LAB_DATA_ROOT: `${process.cwd()}/.tmp/electron-data`,
    },
  });

  try {
    const window = await application.firstWindow();

    await expect(window).toHaveTitle("DroidCrashLab");
    expect(new URL(window.url()).hostname).toBe("127.0.0.1");
    await expect(window.getByRole("heading", { name: "DroidCrashLab" })).toBeVisible();
  } finally {
    await application.close();
  }
});
