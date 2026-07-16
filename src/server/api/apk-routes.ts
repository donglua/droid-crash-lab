import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { ApkFileTypeError, ApkInspectionError, ApkInstallError } from "../apks/apk-service.js";
import { installApkRequestSchema, launchAppRequestSchema } from "../../shared/schemas.js";
import type { AppDependencies } from "./api-types.js";

export function registerApkRoutes(app: FastifyInstance, dependencies: AppDependencies): void {
  app.post("/api/apks/inspect", async (request, reply) => {
    const part = await request.file();
    if (part === undefined || !part.filename.toLowerCase().endsWith(".apk")) {
      return reply.code(400).send(apiError("INVALID_APK", "An APK upload is required"));
    }
    try {
      const apk = await dependencies.apks.inspect(basename(part.filename), await part.toBuffer());
      return { apk };
    } catch (error) {
      if (error instanceof ApkFileTypeError) {
        return reply.code(400).send(apiError("INVALID_APK", error.message));
      }
      if (error instanceof ApkInspectionError) {
        return reply.code(422).send(apiError(
          "APK_INSPECTION_FAILED",
          "Unable to read APK metadata with the installed Android SDK tools",
        ));
      }
      throw error;
    }
  });

  app.post("/api/apks/install", async (request, reply) => {
    const parsed = installApkRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("INVALID_REQUEST", "Invalid install request"));
    try {
      await dependencies.apks.install(parsed.data.apkToken, parsed.data.deviceSerial);
      return { installed: true, ...parsed.data };
    } catch (error) {
      if (error instanceof ApkInstallError) {
        return reply.code(422).send({
          error: {
            code: "APK_INSTALL_FAILED",
            message: "APK installation failed",
            logPath: "install.txt",
          },
        });
      }
      throw error;
    }
  });

  app.post("/api/apps/launch", async (request, reply) => {
    const parsed = launchAppRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("INVALID_REQUEST", "Invalid launch request"));
    const apk = await dependencies.apks.launch(parsed.data.apkToken, parsed.data.deviceSerial);
    return { launched: true, applicationId: apk.applicationId, deviceSerial: parsed.data.deviceSerial };
  });
}

function apiError(code: string, message: string): { readonly error: { readonly code: string; readonly message: string } } {
  return { error: { code, message } };
}
