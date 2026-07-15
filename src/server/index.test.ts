import { afterEach, describe, expect, it } from "vitest";
import { buildProductionApp } from "./index.js";

const shutdowns: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(shutdowns.splice(0).map((shutdown) => shutdown())));

describe("production dependency assembly", () => {
  it("starts health and capability routes when Android tools are unavailable", async () => {
    const { app, shutdown } = await buildProductionApp({ PATH: "" });
    shutdowns.push(shutdown);

    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/api/environment" })).json()).toMatchObject({
      adb: { available: false },
      apkanalyzer: { available: false },
    });
  });
});
