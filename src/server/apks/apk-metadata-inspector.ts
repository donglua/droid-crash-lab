import { runProcess } from "../adb/process-runner.js";
import { parseBadgingMetadata, parseMetadataOutput } from "./apk-boundaries.js";
import type { ApkMetadata } from "./apk-boundaries.js";
import { ApkInspectionError } from "./apk-errors.js";
import type { MetadataField } from "./apk-errors.js";

export type ApkMetadataInspectorOptions = {
  readonly apkanalyzerExecutable: string;
  readonly aapt2Executable?: string;
};

export async function inspectApkMetadata(
  options: ApkMetadataInspectorOptions,
  apkPath: string,
): Promise<ApkMetadata> {
  try {
    const applicationId = await inspectField(
      options.apkanalyzerExecutable,
      "application-id",
      apkPath,
    );
    const versionName = await inspectField(
      options.apkanalyzerExecutable,
      "version-name",
      apkPath,
    );
    const versionCode = await inspectField(
      options.apkanalyzerExecutable,
      "version-code",
      apkPath,
    );
    return { applicationId, versionName, versionCode };
  } catch (error) {
    if (!(error instanceof ApkInspectionError) || options.aapt2Executable === undefined) {
      throw error;
    }
    return inspectWithAapt2(options.aapt2Executable, apkPath);
  }
}

async function inspectField(
  executable: string,
  field: MetadataField,
  apkPath: string,
): Promise<string> {
  const process = await runProcess(executable, ["manifest", field, apkPath]);
  if (process.kind !== "exited" || process.exitCode !== 0) {
    throw new ApkInspectionError("TOOL_FAILED", field, process);
  }
  const value = parseMetadataOutput(field, process.stdout);
  if (value === undefined) {
    throw new ApkInspectionError("INVALID_OUTPUT", field, process);
  }
  return value;
}

async function inspectWithAapt2(executable: string, apkPath: string): Promise<ApkMetadata> {
  const process = await runProcess(executable, ["dump", "badging", apkPath]);
  if (process.kind !== "exited" || process.exitCode !== 0) {
    throw new ApkInspectionError("TOOL_FAILED", "application-id", process);
  }
  const metadata = parseBadgingMetadata(process.stdout);
  if (metadata === undefined) {
    throw new ApkInspectionError("INVALID_OUTPUT", "application-id", process);
  }
  return metadata;
}
