import { constants } from "node:fs";
import type { Dirent } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

export type ToolName = "adb" | "apkanalyzer";

export class ToolLookupError extends Error {
  override readonly name = "ToolLookupError";

  constructor(
    readonly operation: "read_directory" | "stat" | "access" | "realpath",
    readonly path: string,
    options: ErrorOptions,
  ) {
    super(`Failed to ${operation.replace("_", " ")} at ${path}`, options);
  }
}

export type ToolLocationResult =
  | {
      readonly kind: "found";
      readonly tool: ToolName;
      readonly executablePath: string;
    }
  | {
      readonly kind: "unavailable";
      readonly tool: ToolName;
      readonly checkedLocations: readonly string[];
    };

export async function locateTool(
  tool: ToolName,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ToolLocationResult> {
  const candidates = await candidateLocations(tool, environment);

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return {
        kind: "found",
        tool,
        executablePath: await canonicalPath(candidate),
      };
    }
  }

  return { kind: "unavailable", tool, checkedLocations: candidates };
}

async function candidateLocations(
  tool: ToolName,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<readonly string[]> {
  const pathCandidates = (environment["PATH"] ?? "")
    .split(delimiter)
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry, tool));
  const sdkRoots = [environment["ANDROID_HOME"], environment["ANDROID_SDK_ROOT"]]
    .filter((root): root is string => root !== undefined && root.length > 0)
    .map((root) => resolve(root));
  const sdkCandidates: string[] = [];

  for (const root of sdkRoots) {
    if (tool === "adb") {
      sdkCandidates.push(join(root, "platform-tools", tool));
      continue;
    }

    sdkCandidates.push(join(root, "tools", "bin", tool));
    const cmdlineTools = join(root, "cmdline-tools");
    const entries = await directoryEntries(cmdlineTools);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        sdkCandidates.push(join(cmdlineTools, entry.name, "bin", tool));
      }
    }
  }

  return [...new Set([...pathCandidates, ...sdkCandidates])];
}

async function directoryEntries(path: string): Promise<readonly Dirent<string>[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.sort(compareCommandLineToolEntries);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw new ToolLookupError("read_directory", path, { cause: error });
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw new ToolLookupError("stat", path, { cause: error });
  }
  if (!metadata.isFile()) {
    return false;
  }
  try {
    await access(path, constants.X_OK);
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM" || code === "ENOENT") {
      return false;
    }
    throw new ToolLookupError("access", path, { cause: error });
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new ToolLookupError("realpath", path, { cause: error });
  }
}

function compareCommandLineToolEntries(left: Dirent<string>, right: Dirent<string>): number {
  if (left.name === "latest") {
    return right.name === "latest" ? 0 : -1;
  }
  if (right.name === "latest") {
    return 1;
  }

  const leftVersion = numericVersion(left.name);
  const rightVersion = numericVersion(right.name);
  if (leftVersion !== undefined && rightVersion !== undefined) {
    const segmentCount = Math.max(leftVersion.length, rightVersion.length);
    for (let index = 0; index < segmentCount; index += 1) {
      const difference = (rightVersion[index] ?? 0) - (leftVersion[index] ?? 0);
      if (difference !== 0) {
        return difference;
      }
    }
  } else if (leftVersion !== undefined) {
    return -1;
  } else if (rightVersion !== undefined) {
    return 1;
  }

  if (left.name < right.name) {
    return -1;
  }
  return left.name === right.name ? 0 : 1;
}

function numericVersion(value: string): readonly number[] | undefined {
  if (!/^\d+(?:\.\d+)*$/u.test(value)) {
    return undefined;
  }
  return value.split(".").map(Number);
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}
