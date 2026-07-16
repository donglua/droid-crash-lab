import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProductionApp } from "./production-app.js";

const shutdowns: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(shutdowns.splice(0).map((shutdown) => shutdown())));

describe("production dependency assembly", () => {
  it("starts health and capability routes when Android tools are unavailable", async () => {
    const { app, shutdown } = await buildProductionApp({ environment: { PATH: "" } });
    shutdowns.push(shutdown);

    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/api/environment" })).json()).toMatchObject({
      adb: { available: false },
      apkanalyzer: { available: false },
    });
  });

  it("serves the configured web build when embedded by a desktop host", async () => {
    const webRoot = await mkdtemp(join(tmpdir(), "droid-crash-lab-desktop-"));
    await mkdir(join(webRoot, "assets"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Desktop build</title>");
    const { app, shutdown } = await buildProductionApp({
      environment: { PATH: "" },
      webRoot,
    });
    shutdowns.push(shutdown);

    const response = await app.inject({ method: "GET", url: "/history" });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Desktop build");
  });
});
