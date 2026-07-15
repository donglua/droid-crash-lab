import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { deviceSerialSchema } from "../../shared/schemas.js";
import { ApkService } from "./apk-service.js";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/fake-sdk",
);
const adbExecutable = join(fixtureRoot, "adb");
const apkanalyzerExecutable = join(fixtureRoot, "apkanalyzer");
const serial = deviceSerialSchema.parse("emulator-5554");
const temporaryDirectories: string[] = [];

async function inspectedService(adbPath = adbExecutable): Promise<{
  readonly service: ApkService;
  readonly token: Awaited<ReturnType<ApkService["inspectUpload"]>>["token"];
}> {
  const dataRoot = await mkdtemp(join(tmpdir(), "droid-crash-lab-apk-failure-"));
  temporaryDirectories.push(dataRoot);
  const service = new ApkService({
    dataRoot,
    adbExecutable: adbPath,
    apkanalyzerExecutable,
  });
  const apk = await service.inspectUpload("stock.apk", Buffer.from("apk"));
  return { service, token: apk.token };
}

afterEach(async () => {
  delete process.env["FAKE_ADB_INSTALL_EXIT_CODE"];
  delete process.env["FAKE_ADB_INSTALL_STDERR"];
  delete process.env["FAKE_ADB_RESOLVE_EXIT_CODE"];
  delete process.env["FAKE_ADB_RESOLVE_STDERR"];
  delete process.env["FAKE_ADB_LAUNCH_EXIT_CODE"];
  delete process.env["FAKE_ADB_LAUNCH_STDERR"];
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe.sequential("ApkService tool failures", () => {
  it("preserves a nonzero install process result", async () => {
    // Given
    process.env["FAKE_ADB_INSTALL_EXIT_CODE"] = "42";
    process.env["FAKE_ADB_INSTALL_STDERR"] = "install rejected";
    const { service, token } = await inspectedService();

    // When
    const action = service.install(token, serial);

    // Then
    await expect(action).rejects.toMatchObject({
      name: "ApkInstallError",
      process: { kind: "exited", exitCode: 42, stderr: "install rejected" },
    });
  });

  it("preserves an install spawn error result", async () => {
    // Given
    const missingAdb = join(tmpdir(), "droid-crash-lab-missing-adb");
    const { service, token } = await inspectedService(missingAdb);

    // When
    const action = service.install(token, serial);

    // Then
    await expect(action).rejects.toMatchObject({
      name: "ApkInstallError",
      process: { kind: "spawn_error", error: { executable: missingAdb } },
    });
  });

  it("preserves a nonzero launcher-resolution result", async () => {
    // Given
    process.env["FAKE_ADB_RESOLVE_EXIT_CODE"] = "31";
    process.env["FAKE_ADB_RESOLVE_STDERR"] = "resolver failed";
    const { service, token } = await inspectedService();

    // When
    const action = service.launch(token, serial);

    // Then
    await expect(action).rejects.toMatchObject({
      name: "LauncherResolutionError",
      code: "RESOLUTION_FAILED",
      process: { kind: "exited", exitCode: 31, stderr: "resolver failed" },
    });
  });

  it("preserves a nonzero app-launch result", async () => {
    // Given
    process.env["FAKE_ADB_LAUNCH_EXIT_CODE"] = "17";
    process.env["FAKE_ADB_LAUNCH_STDERR"] = "activity failed";
    const { service, token } = await inspectedService();

    // When
    const action = service.launch(token, serial);

    // Then
    await expect(action).rejects.toMatchObject({
      name: "AppLaunchError",
      process: { kind: "exited", exitCode: 17, stderr: "activity failed" },
    });
  });
});
