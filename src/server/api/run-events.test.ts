import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { RunEventBus } from "../events/event-bus.js";
import type { RunSummary } from "../../shared/contracts.js";
import { apkTokenSchema, deviceSerialSchema, runIdSchema } from "../../shared/schemas.js";
import { dependencies } from "./environment-routes.test.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("run routes and SSE", () => {
  it("exposes run creation, stop, history, details, and archive", async () => {
    const deps = dependencies();
    const app = await buildApp({
      ...deps,
      runs: {
        ...deps.runs,
        start: async () => run("running"),
        stop: async () => run("completed"),
        list: async () => [run("completed")],
        details: async () => ({ run: run("completed"), issues: [] }),
        logRange: async () => ({
          startLine: 10,
          endLine: 11,
          lines: [
            { lineNumber: 10, line: "FATAL EXCEPTION: main" },
            { lineNumber: 11, line: "java.lang.IllegalStateException" },
          ],
        }),
        archive: async () => Readable.from([Buffer.from("zip")]),
      },
    });
    apps.push(app);

    expect((await app.inject({ method: "POST", url: "/api/runs", payload: request() })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/runs/20260715T020304Z-a1b2c3/stop" })).json()).toMatchObject({ run: { state: "completed" } });
    expect((await app.inject({ method: "GET", url: "/api/runs" })).json()).toMatchObject({ runs: [{ state: "completed" }] });
    expect((await app.inject({ method: "GET", url: "/api/runs/20260715T020304Z-a1b2c3" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/runs/20260715T020304Z-a1b2c3/logs?startLine=10&endLine=11" })).json()).toEqual({
      startLine: 10,
      endLine: 11,
      lines: [
        { lineNumber: 10, line: "FATAL EXCEPTION: main" },
        { lineNumber: 11, line: "java.lang.IllegalStateException" },
      ],
    });
    expect((await app.inject({ method: "GET", url: "/api/runs/20260715T020304Z-a1b2c3/archive" })).headers["content-type"]).toContain("application/zip");
  });

  it("rejects invalid raw log ranges at the HTTP boundary", async () => {
    const app = await buildApp(dependencies());
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/runs/20260715T020304Z-a1b2c3/logs?startLine=20&endLine=10",
    });

    expect(response.statusCode).toBe(400);
  });

  it("streams an immediate state snapshot and browser disconnect does not stop the run", async () => {
    const bus = new RunEventBus({ replayLimit: 8, now: () => "2026-07-15T02:03:04.000Z" });
    bus.publish({ type: "state", state: "running" });
    let stopCalls = 0;
    const deps = dependencies();
    const app = await buildApp({
      ...deps,
      runs: {
        ...deps.runs,
        stop: async () => { stopCalls += 1; return run("completed"); },
        events: (listener, afterId) => bus.subscribe(listener, afterId),
      },
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new TypeError("Expected TCP address");
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs/20260715T020304Z-a1b2c3/events`, {
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new TypeError("Expected SSE body");
    const first = await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
    await new Promise((resolve) => setImmediate(resolve));

    expect(new TextDecoder().decode(first.value)).toContain("event: state");
    expect(stopCalls).toBe(0);
  });

  it("replays stateful events after Last-Event-ID without replaying raw logs", async () => {
    const bus = new RunEventBus({ replayLimit: 8, now: () => "2026-07-15T02:03:04.000Z" });
    bus.publish({ type: "state", state: "running" });
    bus.publish({ type: "log", lineNumber: 1, level: "error", line: "secret raw log" });
    bus.publish({ type: "progress", progress: { completedEvents: 2, totalEvents: 10 } });
    const deps = dependencies();
    const app = await buildApp({
      ...deps,
      runs: { ...deps.runs, events: (listener, afterId) => bus.subscribe(listener, afterId) },
    });
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === "string") throw new TypeError("Expected TCP address");
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/runs/20260715T020304Z-a1b2c3/events`, {
      headers: { "last-event-id": "1" },
      signal: controller.signal,
    });
    const reader = response.body?.getReader();
    if (reader === undefined) throw new TypeError("Expected SSE body");
    let payload = "";
    for (let index = 0; index < 4 && !payload.includes("event: progress"); index += 1) {
      const chunk = await reader.read();
      payload += new TextDecoder().decode(chunk.value);
    }
    controller.abort();
    await reader.cancel().catch(() => undefined);
    expect(payload).toContain("event: state");
    expect(payload).toContain("event: progress");
    expect(payload).not.toContain("secret raw log");
  });
});

function request() {
  return {
    apkToken: "123e4567-e89b-42d3-a456-426614174000",
    deviceSerial: "emulator-5554",
    config: { mode: "manual" },
  };
}

function run(state: "running" | "completed"): RunSummary {
  return {
    id: runIdSchema.parse("20260715T020304Z-a1b2c3"),
    state,
    config: { mode: "manual" as const },
    device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" },
    apk: {
      token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
      applicationId: "cn.example.app",
      versionName: "1",
      versionCode: "1",
      storedPath: "/tmp/app.apk",
    },
    startedAt: "2026-07-15T02:03:04.000Z",
    issueCount: 0,
    ...(state === "completed" ? { completedAt: "2026-07-15T02:04:04.000Z" } : {}),
  };
}
