import { afterEach, describe, expect, it } from "vitest";
import { buildProductionApp } from "./production-app.js";
import { listenProductionApp } from "./production-server.js";

const shutdowns: Array<() => Promise<void>> = [];
afterEach(async () => Promise.all(shutdowns.splice(0).map((shutdown) => shutdown())));

describe("production server listener", () => {
  it("returns the assigned loopback URL when port zero is requested", async () => {
    const { app, shutdown } = await buildProductionApp({ environment: { PATH: "" } });
    shutdowns.push(shutdown);

    const url = await listenProductionApp({ app, host: "127.0.0.1", port: 0 });

    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ status: "ok" });
  });
});
