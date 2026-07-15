import type { ApkToken } from "../../shared/schemas.js";
import type { ProcessResult } from "../adb/process-runner.js";

export type MetadataField = "application-id" | "version-name" | "version-code";
export type InspectionCode = "TOOL_FAILED" | "INVALID_OUTPUT";
export type LauncherResolutionCode =
  | "RESOLUTION_FAILED"
  | "INVALID_LAUNCHER_COMPONENT";

export class ApkFileTypeError extends Error {
  override readonly name = "ApkFileTypeError";
  readonly code = "INVALID_APK_EXTENSION";

  constructor(readonly originalFilename: string) {
    super("Only .apk uploads are supported");
  }
}

export class ApkInspectionError extends Error {
  override readonly name = "ApkInspectionError";

  constructor(
    readonly code: InspectionCode,
    readonly field: MetadataField,
    readonly process: ProcessResult,
  ) {
    super(`Unable to read APK ${field}`);
  }
}

export class ApkNotFoundError extends Error {
  override readonly name = "ApkNotFoundError";
  readonly code = "APK_NOT_FOUND";

  constructor(readonly token: ApkToken) {
    super(`APK ${token} is not registered`);
  }
}

export class ApkInstallError extends Error {
  override readonly name = "ApkInstallError";
  readonly code = "APK_INSTALL_FAILED";

  constructor(readonly process: ProcessResult) {
    super("APK installation failed");
  }
}

export class LauncherResolutionError extends Error {
  override readonly name = "LauncherResolutionError";

  constructor(
    readonly code: LauncherResolutionCode,
    readonly applicationId: string,
    readonly process: ProcessResult,
  ) {
    super(`Unable to resolve launcher for ${applicationId}`);
  }
}

export class AppLaunchError extends Error {
  override readonly name = "AppLaunchError";
  readonly code = "APP_LAUNCH_FAILED";

  constructor(
    readonly component: string,
    readonly process: ProcessResult,
  ) {
    super(`Unable to launch ${component}`);
  }
}
