import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { ApkInstallError } from "../apks/apk-service.js";
import { apkTokenSchema } from "../../shared/schemas.js";
import { dependencies } from "./environment-routes.test.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("APK routes", () => {
  it("inspects a multipart APK without accepting a browser file path", async () => {
    let receivedFilename = "";
    let receivedContent = "";
    const deps = dependencies();
    const app = await buildApp({
      ...deps,
      apks: {
        ...deps.apks,
        inspect: async (filename, content) => {
          receivedFilename = filename;
          receivedContent = new TextDecoder().decode(content);
          return {
            token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
            applicationId: "cn.example.app",
            versionName: "1.0",
            versionCode: "1",
            storedPath: "/generated/upload.apk",
          };
        },
      },
    });
    apps.push(app);
    const boundary = "----droid-crash-lab";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="apk"; filename="../../private.apk"',
      "Content-Type: application/vnd.android.package-archive",
      "",
      "apk-bytes",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/apks/inspect",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ apk: { applicationId: "cn.example.app" } });
    expect(receivedFilename).toBe("private.apk");
    expect(receivedContent).toBe("apk-bytes");
  });

  it("rejects non-APK uploads", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/apks/inspect",
      payload: { filename: "/tmp/app.apk" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("maps installation failure to 422 and includes the saved install log path", async () => {
    const deps = dependencies();
    const app = await buildApp({
      ...deps,
      apks: {
        ...deps.apks,
        install: async () => {
          throw new ApkInstallError({ kind: "exited", exitCode: 1, stdout: "", stderr: "failed" });
        },
      },
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/apks/install",
      payload: {
        apkToken: "123e4567-e89b-42d3-a456-426614174000",
        deviceSerial: "emulator-5554",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: {
        code: "APK_INSTALL_FAILED",
        message: "APK installation failed",
        logPath: "install.txt",
      },
    });
  });
});
