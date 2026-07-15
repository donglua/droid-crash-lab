import { constants } from "node:fs";
import type { Dirent } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";

export type ToolName = "adb" | "apkanalyzer";

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
        executablePath: await realpath(candidate),
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
    return entries.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error instanceof Error) {
      return [];
    }
    throw error;
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    const metadata = await stat(path);
    await access(path, constants.X_OK);
    return metadata.isFile();
  } catch (error) {
    if (error instanceof Error) {
      return false;
    }
    throw error;
  }
}
