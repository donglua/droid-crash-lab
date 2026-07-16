import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectApkMetadata } from "./apk-metadata-inspector.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("APK metadata inspector", () => {
  it("falls back to aapt2 when legacy apkanalyzer cannot inspect the APK", async () => {
    // Given
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-metadata-"));
    temporaryDirectories.push(root);
    const apkanalyzer = await executable(root, "apkanalyzer", "process.exitCode = 1;");
    const aapt2 = await executable(
      root,
      "aapt2",
      "process.stdout.write(\"package: name='cn.jingzhuan.stock' versionCode='61870400' versionName='6.187.04-beta'\\n\");",
    );

    // When
    const metadata = await inspectApkMetadata(
      { apkanalyzerExecutable: apkanalyzer, aapt2Executable: aapt2 },
      join(root, "stock.apk"),
    );

    // Then
    expect(metadata).toEqual({
      applicationId: "cn.jingzhuan.stock",
      versionName: "6.187.04-beta",
      versionCode: "61870400",
    });
  });
});

async function executable(root: string, name: string, source: string): Promise<string> {
  const path = join(root, name);
  await writeFile(path, `#!/usr/bin/env node\n${source}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}
