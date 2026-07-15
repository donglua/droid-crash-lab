import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppDependencies } from "../app.js";
import { deviceSerialSchema } from "../../shared/schemas.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("environment routes", () => {
  it("returns health, environment capability, and devices", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ method: "GET", url: "/api/environment" })).json()).toEqual({
      adb: { available: false, checkedLocations: ["/missing/adb"] },
      apkanalyzer: { available: true, path: "/sdk/apkanalyzer", checkedLocations: [] },
    });
    expect((await app.inject({ method: "GET", url: "/api/devices" })).json()).toEqual({
      devices: [{ serial: "emulator-5554", state: "device", model: "Pixel_9" }],
      selectedSerial: "emulator-5554",
    });
  });
});

export function dependencies(): AppDependencies {
  return {
    environment: async () => ({
      adb: { available: false, checkedLocations: ["/missing/adb"] },
      apkanalyzer: { available: true, path: "/sdk/apkanalyzer", checkedLocations: [] },
    }),
    devices: async () => ({
      devices: [
        { serial: deviceSerialSchema.parse("emulator-5554"), state: "device", model: "Pixel_9" },
      ],
      selectedSerial: deviceSerialSchema.parse("emulator-5554"),
    }),
    apks: {
      inspect: async () => { throw new Error("unused"); },
      install: async () => { throw new Error("unused"); },
      launch: async () => { throw new Error("unused"); },
    },
    runs: {
      start: async () => { throw new Error("unused"); },
      stop: async () => { throw new Error("unused"); },
      list: async () => [],
      details: async () => undefined,
      logRange: async () => { throw new Error("unused"); },
      archive: async () => { throw new Error("unused"); },
      events: () => () => undefined,
    },
  };
}
