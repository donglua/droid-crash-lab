import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { z } from "zod";

import type { ApkInfo } from "../../shared/contracts.js";
import { apkTokenSchema } from "../../shared/schemas.js";
import type { ApkToken, DeviceSerial } from "../../shared/schemas.js";
import { runProcess } from "../adb/process-runner.js";
import type { ProcessResult } from "../adb/process-runner.js";

const applicationIdSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u);
const versionNameSchema = z.string().min(1).max(255).regex(/^[^\r\n]+$/u);
const versionCodeSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);
const launcherComponentSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+\/(?:\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*|[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)$/u,
);

type MetadataField = "application-id" | "version-name" | "version-code";
type SuccessfulProcessResult = Extract<ProcessResult, { readonly kind: "exited" }>;
export type ApkServiceOptions = {
  readonly dataRoot: string;
  readonly adbExecutable: string;
  readonly apkanalyzerExecutable: string;
};
type InspectionCode = "TOOL_FAILED" | "INVALID_OUTPUT";
type LauncherResolutionCode = "RESOLUTION_FAILED" | "INVALID_LAUNCHER_COMPONENT";

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

    const token = apkTokenSchema.parse(randomUUID());
    const uploadsRoot = join(this.options.dataRoot, "uploads");
    const storedPath = join(uploadsRoot, `${token}.apk`);
    await mkdir(uploadsRoot, { recursive: true });
    if (content instanceof Readable) {
      await pipeline(content, createWriteStream(storedPath, { flags: "wx" }));
    } else {
      await writeFile(storedPath, content);
    }

    try {
      const applicationId = await this.inspectField(
        "application-id",
        storedPath,
        applicationIdSchema,
      );
      const versionName = await this.inspectField(
        "version-name",
        storedPath,
        versionNameSchema,
      );
      const versionCode = await this.inspectField(
        "version-code",
        storedPath,
        versionCodeSchema,
      );
      const apk: ApkInfo = {
        token,
        applicationId,
        versionName,
        versionCode,
        storedPath,
      };
      this.apks.set(token, apk);
      return apk;
    } catch (error) {
      await rm(storedPath, { force: true });
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
    return { apk, process };
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
    const component = launcherComponentSchema.safeParse(resolutionProcess.stdout.trim());
    if (!component.success) {
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
      component.data,
    ]);
    if (process.kind !== "exited" || process.exitCode !== 0) {
      throw new AppLaunchError(component.data, process);
    }
    return {
      apk,
      component: component.data,
      resolutionProcess,
      process,
    };
  }

  private requireApk(token: ApkToken): ApkInfo {
    const apk = this.apks.get(token);
    if (apk === undefined) {
      throw new ApkNotFoundError(token);
    }
    return apk;
  }

  private async inspectField(
    field: MetadataField,
    apkPath: string,
    schema: z.ZodType<string>,
  ): Promise<string> {
    const process = await runProcess(this.options.apkanalyzerExecutable, [
      "manifest",
      field,
      apkPath,
    ]);
    if (process.kind !== "exited" || process.exitCode !== 0) {
      throw new ApkInspectionError("TOOL_FAILED", field, process);
    }
    const value = schema.safeParse(process.stdout.trim());
    if (!value.success) {
      throw new ApkInspectionError("INVALID_OUTPUT", field, process);
    }
    return value.data;
  }
}
