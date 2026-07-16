import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { locateTool } from "./tool-locator.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "droid-crash-lab-tools-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function executable(path: string): Promise<string> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "#!/usr/bin/env node\n", "utf8");
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("locateTool", () => {
  it("finds an executable from PATH and returns its canonical path", async () => {
    // Given
    const root = await temporaryDirectory();
    const target = await executable(join(root, "real-adb"));
    const linked = join(root, "adb");
    await symlink(target, linked);

    // When
    const result = await locateTool("adb", { PATH: root });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "adb",
      executablePath: await realpath(linked),
    });
  });

  it("returns a PATH tool without reading a broken lower-priority SDK", async () => {
    // Given
    const pathRoot = await temporaryDirectory();
    const sdk = await temporaryDirectory();
    const analyzer = await executable(join(pathRoot, "apkanalyzer"));
    const commandLineTools = join(sdk, "cmdline-tools");
    await mkdir(commandLineTools, { recursive: true });
    await chmod(commandLineTools, 0o000);

    try {
      // When
      const result = await locateTool("apkanalyzer", {
        PATH: pathRoot,
        ANDROID_HOME: sdk,
      });

      // Then
      expect(result).toEqual({
        kind: "found",
        tool: "apkanalyzer",
        executablePath: await realpath(analyzer),
      });
    } finally {
      await chmod(commandLineTools, 0o755);
    }
  });

  it("falls back to ANDROID_HOME for adb", async () => {
    // Given
    const sdk = await temporaryDirectory();
    const adb = await executable(join(sdk, "platform-tools", "adb"));

    // When
    const result = await locateTool("adb", { PATH: "", ANDROID_HOME: sdk });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "adb",
      executablePath: await realpath(adb),
    });
  });

  it("falls back to ANDROID_SDK_ROOT for adb", async () => {
    // Given
    const sdk = await temporaryDirectory();
    const adb = await executable(join(sdk, "platform-tools", "adb"));

    // When
    const result = await locateTool("adb", {
      PATH: "",
      ANDROID_SDK_ROOT: sdk,
    });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "adb",
      executablePath: await realpath(adb),
    });
  });

  it("finds the default macOS user SDK when launched outside a shell", async () => {
    // Given
    const home = await temporaryDirectory();
    const adb = await executable(join(home, "Library", "Android", "sdk", "platform-tools", "adb"));

    // When
    const result = await locateTool("adb", { PATH: "", HOME: home });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "adb",
      executablePath: await realpath(adb),
    });
  });

  it("finds apkanalyzer in the legacy SDK tools layout", async () => {
    // Given
    const sdk = await temporaryDirectory();
    const analyzer = await executable(join(sdk, "tools", "bin", "apkanalyzer"));

    // When
    const result = await locateTool("apkanalyzer", {
      PATH: "",
      ANDROID_HOME: sdk,
    });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "apkanalyzer",
      executablePath: await realpath(analyzer),
    });
  });

  it("finds apkanalyzer deterministically in cmdline-tools layouts", async () => {
    // Given
    const sdk = await temporaryDirectory();
    await executable(join(sdk, "cmdline-tools", "11.0", "bin", "apkanalyzer"));
    const preferred = await executable(
      join(sdk, "cmdline-tools", "latest", "bin", "apkanalyzer"),
    );

    // When
    const result = await locateTool("apkanalyzer", {
      PATH: "",
      ANDROID_SDK_ROOT: sdk,
    });

    // Then
    expect(result).toEqual({
      kind: "found",
      tool: "apkanalyzer",
      executablePath: await realpath(preferred),
    });
  });

  it("surfaces operational errors while enumerating command-line tools", async () => {
    // Given
    const sdk = await temporaryDirectory();
    const commandLineTools = join(sdk, "cmdline-tools");
    await mkdir(commandLineTools, { recursive: true });
    await chmod(commandLineTools, 0o000);

    try {
      // When
      const result = locateTool("apkanalyzer", { PATH: "", ANDROID_HOME: sdk });

      // Then
      await expect(result).rejects.toMatchObject({ name: "ToolLookupError" });
    } finally {
      await chmod(commandLineTools, 0o755);
    }
  });

  it("reports deduplicated checked locations when a tool is unavailable", async () => {
    // Given
    const root = await temporaryDirectory();
    const sdk = join(root, "sdk");
    const pathEntry = join(root, "bin");
    await mkdir(join(sdk, "cmdline-tools", "latest"), { recursive: true });

    // When
    const result = await locateTool("apkanalyzer", {
      PATH: [pathEntry, pathEntry].join(delimiter),
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: sdk,
    });

    // Then
    expect(result).toEqual({
      kind: "unavailable",
      tool: "apkanalyzer",
      checkedLocations: [
        join(pathEntry, "apkanalyzer"),
        join(sdk, "tools", "bin", "apkanalyzer"),
        join(sdk, "cmdline-tools", "latest", "bin", "apkanalyzer"),
      ],
    });
  });

  it("does not accept a directory as an executable", async () => {
    // Given
    const root = await temporaryDirectory();
    await mkdir(join(root, "adb"));

    // When
    const result = await locateTool("adb", { PATH: root });

    // Then
    expect(result.kind).toBe("unavailable");
  });
});
