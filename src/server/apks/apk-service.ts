import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import type { ApkInfo } from "../../shared/contracts.js";
import { apkTokenSchema } from "../../shared/schemas.js";
import type { ApkToken, DeviceSerial } from "../../shared/schemas.js";
import { runProcess } from "../adb/process-runner.js";
import type { ProcessResult } from "../adb/process-runner.js";
import { parseLauncherComponent } from "./apk-boundaries.js";
import {
  ApkFileTypeError,
  ApkInstallError,
  ApkNotFoundError,
  AppLaunchError,
  LauncherResolutionError,
} from "./apk-errors.js";
import { inspectApkMetadata } from "./apk-metadata-inspector.js";
import { writeOwnedUpload } from "./apk-upload.js";

export {
  ApkFileTypeError,
  ApkInspectionError,
  ApkInstallError,
  ApkNotFoundError,
  AppLaunchError,
  LauncherResolutionError,
} from "./apk-errors.js";
export type {
  InspectionCode,
  LauncherResolutionCode,
  MetadataField,
} from "./apk-errors.js";

type SuccessfulProcessResult = Extract<ProcessResult, { readonly kind: "exited" }>;
export type ApkServiceOptions = {
  readonly dataRoot: string;
  readonly adbExecutable: string;
  readonly apkanalyzerExecutable: string;
  readonly aapt2Executable?: string;
  readonly tokenFactory?: () => string;
};

export type ApkInstallResult = {
  readonly apk: ApkInfo;
  readonly process: SuccessfulProcessResult;
};

export type AppLaunchResult = {
  readonly apk: ApkInfo;
  readonly component: string;
  readonly resolutionProcess: SuccessfulProcessResult;
  readonly process: SuccessfulProcessResult;
};

export function defaultApkDataRoot(): string {
  return join(homedir(), ".droid-crash-lab");
}

export class ApkService {
  private readonly apks = new Map<ApkToken, ApkInfo>();

  constructor(private readonly options: ApkServiceOptions) {}

  async inspectUpload(
    originalFilename: string,
    content: Uint8Array | Readable,
  ): Promise<ApkInfo> {
    if (extname(originalFilename).toLowerCase() !== ".apk") {
      throw new ApkFileTypeError(originalFilename);
    }

    const token = apkTokenSchema.parse(
      this.options.tokenFactory?.() ?? randomUUID(),
    );
    const uploadsRoot = join(this.options.dataRoot, "uploads");
    const storedPath = join(uploadsRoot, `${token}.apk`);
    let ownsStoredPath = false;

    try {
      await mkdir(uploadsRoot, { recursive: true });
      await writeOwnedUpload(storedPath, content);
      ownsStoredPath = true;
      const metadata = await inspectApkMetadata(this.options, storedPath);
      const canonicalApk: ApkInfo = Object.freeze({
        token,
        ...metadata,
        storedPath,
      });
      this.apks.set(token, canonicalApk);
      return this.snapshotApk(canonicalApk);
    } catch (error) {
      if (!ownsStoredPath) {
        throw error;
      }
      try {
        await rm(storedPath, { force: true });
      } catch (cleanupError) {
        throw new SuppressedError(
          cleanupError,
          error,
          "APK upload failed and partial-file cleanup also failed",
        );
      }
      throw error;
    }
  }

  async install(token: ApkToken, serial: DeviceSerial): Promise<ApkInstallResult> {
    const apk = this.requireApk(token);
    const process = await runProcess(this.options.adbExecutable, [
      "-s",
      serial,
      "install",
      "-r",
      apk.storedPath,
    ]);
    if (process.kind !== "exited" || process.exitCode !== 0) {
      throw new ApkInstallError(process);
    }
    return Object.freeze({
      apk: this.snapshotApk(apk),
      process: Object.freeze({ ...process }),
    });
  }

  async launch(token: ApkToken, serial: DeviceSerial): Promise<AppLaunchResult> {
    const apk = this.requireApk(token);
    const resolutionProcess = await runProcess(this.options.adbExecutable, [
      "-s",
      serial,
      "shell",
      "cmd",
      "package",
      "resolve-activity",
      "--brief",
      apk.applicationId,
    ]);
    if (resolutionProcess.kind !== "exited" || resolutionProcess.exitCode !== 0) {
      throw new LauncherResolutionError(
        "RESOLUTION_FAILED",
        apk.applicationId,
        resolutionProcess,
      );
    }
    const component = parseLauncherComponent(resolutionProcess.stdout);
    if (component === undefined) {
      throw new LauncherResolutionError(
        "INVALID_LAUNCHER_COMPONENT",
        apk.applicationId,
        resolutionProcess,
      );
    }
    const process = await runProcess(this.options.adbExecutable, [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      component,
    ]);
    if (process.kind !== "exited" || process.exitCode !== 0) {
      throw new AppLaunchError(component, process);
    }
    return Object.freeze({
      apk: this.snapshotApk(apk),
      component,
      resolutionProcess: Object.freeze({ ...resolutionProcess }),
      process: Object.freeze({ ...process }),
    });
  }

  get(token: ApkToken): ApkInfo {
    return this.snapshotApk(this.requireApk(token));
  }

  private requireApk(token: ApkToken): ApkInfo {
    const apk = this.apks.get(token);
    if (apk === undefined) {
      throw new ApkNotFoundError(token);
    }
    return apk;
  }

  private snapshotApk(apk: ApkInfo): ApkInfo {
    return Object.freeze({ ...apk });
  }

}
