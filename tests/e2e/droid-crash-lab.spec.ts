import { expect, test } from "@playwright/test";

test("runs manual and Monkey flows through the real local service", async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  const staleStop = page.getByRole("button", { name: "停止测试" });
  if (await staleStop.isVisible()) await staleStop.click();
  await expect(page.getByText("Pixel_9")).toBeVisible();
  await page.getByLabel(/APK 文件/).setInputFiles("tests/e2e/fixture.apk");
  await expect(page.locator(".apk-summary strong", { hasText: "cn.jingzhuan.stock" })).toBeVisible();
  await page.getByRole("button", { name: "覆盖安装" }).click();
  await expect(page.getByText("安装完成")).toBeVisible();
  await page.getByRole("button", { name: "启动应用" }).click();
  await expect(page.getByText("应用已启动")).toBeVisible();
  await page.getByRole("button", { name: "开始测试" }).click();
  await expect(page.getByText("运行中")).toBeVisible();
  await expect(page.getByRole("button", { name: /IllegalStateException: E2E crash/u })).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: /IllegalStateException: E2E crash/u }).click();
  await expect(page.locator(".log-line code").filter({ hasText: "java.lang.IllegalStateException: E2E crash" })).toBeVisible();
  await page.getByRole("button", { name: "停止测试" }).click();
  await expect(page.getByText("已完成")).toBeVisible();
  await page.getByRole("button", { name: "问题报告" }).click();
  await expect(page.getByRole("heading", { name: "问题报告", level: 2 })).toBeVisible();
  await page.getByRole("button", { name: /IllegalStateException: E2E crash/u }).click();
  await expect(page.locator(".log-line code").filter({ hasText: "java.lang.IllegalStateException: E2E crash" })).toBeVisible();
  await page.getByRole("button", { name: "测试历史" }).click();
  await expect(page.locator(".history-main strong", { hasText: "cn.jingzhuan.stock" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "下载归档" }).first()).toHaveAttribute("href", /\/archive$/u);
  await page.getByRole("button", { name: "当前测试" }).click();
  await page.getByRole("radio", { name: "Monkey" }).check();
  await page.getByLabel("事件数").fill("500");
  await page.getByRole("button", { name: "开始测试" }).click();
  await expect(page.getByText("500 / 500")).toBeVisible({ timeout: 5_000 });
  await page.getByRole("button", { name: "停止测试" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
  await expect(page.getByText("127.0.0.1:4319")).toBeVisible();

  await expectNoOverflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("desktop-1280x800.png"), fullPage: true });
  for (const [width, height, name] of [[768, 1024, "tablet-768x1024"], [375, 812, "mobile-375x812"]] as const) {
    const responsive = await browser.newPage({ viewport: { width, height } });
    await responsive.goto("/");
    await expect(responsive.getByRole("heading", { name: "DroidCrashLab" })).toBeVisible();
    await expectNoOverflow(responsive);
    await responsive.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
    await responsive.close();
  }
});

async function expectNoOverflow(page: import("@playwright/test").Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}
