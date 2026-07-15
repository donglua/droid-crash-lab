import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { apkTokenSchema, deviceSerialSchema } from "../../shared/schemas.js";
import {
  ApkFileTypeError,
  ApkInspectionError,
  ApkService,
  LauncherResolutionError,
} from "./apk-service.js";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/fake-sdk",
);
const adbExecutable = join(fixtureRoot, "adb");
const apkanalyzerExecutable = join(fixtureRoot, "apkanalyzer");
const serial = deviceSerialSchema.parse("emulator-5554");
const callsSchema = z.array(z.array(z.string()));
const temporaryDirectories: string[] = [];

type Fixture = {
  readonly service: ApkService;
  readonly dataRoot: string;
  readonly callsPath: string;
};

async function fixture(): Promise<Fixture> {
  const dataRoot = await mkdtemp(join(tmpdir(), "droid-crash-lab-apk-"));
  temporaryDirectories.push(dataRoot);
  const callsPath = join(dataRoot, "adb-calls.jsonl");
  process.env["FAKE_ADB_CALLS"] = callsPath;
  return {
    service: new ApkService({ dataRoot, adbExecutable, apkanalyzerExecutable }),
    dataRoot,
    callsPath,
  };
}

async function adbCalls(path: string): Promise<readonly (readonly string[])[]> {
  const content = await readFile(path, "utf8");
  return callsSchema.parse(
    content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line)),
  );
}

beforeAll(async () => {
  await Promise.all([chmod(adbExecutable, 0o755), chmod(apkanalyzerExecutable, 0o755)]);
});

afterEach(async () => {
  delete process.env["FAKE_ADB_CALLS"];
  delete process.env["FAKE_ADB_RESOLVE_STDOUT"];
  delete process.env["FAKE_APKANALYZER_EXIT_CODE"];
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe.sequential("ApkService", () => {
  it("rejects uploads when the original extension is not .apk", async () => {
    // Given
    const { service } = await fixture();

    // When
    const action = service.inspectUpload("stock.zip", Buffer.from("apk"));

    // Then
    await expect(action).rejects.toBeInstanceOf(ApkFileTypeError);
  });

  it("stores byte uploads under a generated filename", async () => {
    // Given
    const { service, dataRoot } = await fixture();
    const originalName = "../../untrusted-name.apk";
    const bytes = Buffer.from("byte upload");

    // When
    const apk = await service.inspectUpload(originalName, bytes);

    // Then
    expect(apkTokenSchema.safeParse(apk.token).success).toBe(true);
    expect(apk.storedPath).toMatch(
      new RegExp(`^${join(dataRoot, "uploads").replaceAll("/", "\\/")}/[0-9a-f-]+\\.apk$`, "u"),
    );
    expect(apk.storedPath).not.toContain("untrusted-name");
    await expect(readFile(apk.storedPath)).resolves.toEqual(bytes);
  });

  it("stores stream uploads and extracts exact metadata", async () => {
    // Given
    const { service } = await fixture();

    // When
    const apk = await service.inspectUpload(
      "stock.apk",
      Readable.from([Buffer.from("stream "), Buffer.from("upload")]),
    );

    // Then
    expect(await readFile(apk.storedPath, "utf8")).toBe("stream upload");
    expect(apk).toMatchObject({
      applicationId: "cn.jingzhuan.stock",
      versionName: "6.187.04-beta",
      versionCode: "61870400",
    });
  });

  it("does not invoke adb when apkanalyzer fails", async () => {
    // Given
    const { service, callsPath } = await fixture();
    process.env["FAKE_APKANALYZER_EXIT_CODE"] = "9";

    // When
    const action = service.inspectUpload("stock.apk", Buffer.from("invalid"));

    // Then
    await expect(action).rejects.toBeInstanceOf(ApkInspectionError);
    await expect(stat(callsPath)).rejects.toThrow();
  });

  it("installs an inspected APK with exact argument boundaries", async () => {
    // Given
    const { service, callsPath } = await fixture();
    const apk = await service.inspectUpload("stock.apk", Buffer.from("apk"));

    // When
    const result = await service.install(apk.token, serial);

    // Then
    expect(result.process).toMatchObject({ kind: "exited", exitCode: 0 });
    expect(await adbCalls(callsPath)).toEqual([
      ["-s", serial, "install", "-r", apk.storedPath],
    ]);
  });

  it("resolves the launcher with cmd package resolve-activity --brief", async () => {
    // Given
    const { service, callsPath } = await fixture();
    const apk = await service.inspectUpload("stock.apk", Buffer.from("apk"));

    // When
    await service.launch(apk.token, serial);

    // Then
    expect((await adbCalls(callsPath))[0]).toEqual([
      "-s", serial, "shell", "cmd", "package", "resolve-activity", "--brief", apk.applicationId,
    ]);
  });

  it("launches the resolved component with am start -W -n", async () => {
    // Given
    const { service, callsPath } = await fixture();
    const apk = await service.inspectUpload("stock.apk", Buffer.from("apk"));

    // When
    const result = await service.launch(apk.token, serial);

    // Then
    expect(result.component).toBe("cn.jingzhuan.stock/.MainActivity");
    expect((await adbCalls(callsPath))[1]).toEqual([
      "-s", serial, "shell", "am", "start", "-W", "-n", result.component,
    ]);
  });

  it("returns a structured typed error when launcher output cannot be parsed", async () => {
    // Given
    const { service } = await fixture();
    const apk = await service.inspectUpload("stock.apk", Buffer.from("apk"));
    process.env["FAKE_ADB_RESOLVE_STDOUT"] = "No activity found\n";

    // When
    const action = service.launch(apk.token, serial);

    // Then
    await expect(action).rejects.toMatchObject({
      name: "LauncherResolutionError",
      code: "INVALID_LAUNCHER_COMPONENT",
      applicationId: apk.applicationId,
    } satisfies Partial<LauncherResolutionError>);
  });
});
