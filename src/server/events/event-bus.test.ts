import { describe, expect, it } from "vitest";
import type { RunEvent } from "../../shared/contracts.js";
import { eventIdSchema } from "../../shared/schemas.js";
import { RunEventBus } from "./event-bus.js";

describe("RunEventBus", () => {
  it("assigns monotonically increasing IDs and publishes in order", () => {
    const bus = new RunEventBus({ replayLimit: 8, now: () => "2026-07-15T02:03:04.000Z" });
    const received: RunEvent[] = [];
    bus.subscribe((event) => received.push(event));

    const running = bus.publish({ type: "state", state: "running" });
    const progress = bus.publish({ type: "progress", progress: { completedEvents: 3, totalEvents: 10 } });

    expect(running.id).toBe(1);
    expect(progress.id).toBe(2);
    expect(received.slice(-2)).toEqual([running, progress]);
  });

  it("sends the current state snapshot immediately to new subscribers", () => {
    const bus = new RunEventBus({ replayLimit: 8, now: () => "2026-07-15T02:03:04.000Z" });
    bus.publish({ type: "state", state: "running" });
    const received: RunEvent[] = [];

    const unsubscribe = bus.subscribe((event) => received.push(event));

    expect(received).toEqual([
      {
        id: eventIdSchema.parse(1),
        type: "state",
        timestamp: "2026-07-15T02:03:04.000Z",
        state: "running",
      },
    ]);
    unsubscribe();
    bus.publish({ type: "state", state: "stopping" });
    expect(received).toHaveLength(1);
  });

  it("replays bounded non-log events after Last-Event-ID without replaying raw logs", () => {
    const bus = new RunEventBus({ replayLimit: 2, now: () => "2026-07-15T02:03:04.000Z" });
    bus.publish({ type: "state", state: "running" });
    bus.publish({ type: "log", lineNumber: 1, level: "info", line: "raw one" });
    bus.publish({ type: "progress", progress: { completedEvents: 1, totalEvents: 10 } });
    bus.publish({ type: "issue", issue: issueFixture() });
    bus.publish({ type: "device", device: null });
    const received: RunEvent[] = [];

    bus.subscribe((event) => received.push(event), eventIdSchema.parse(1));

    expect(received.map((event) => event.type)).toEqual(["state", "issue", "device"]);
    expect(received.some((event) => event.type === "log")).toBe(false);
  });
});

function issueFixture(): Extract<RunEvent, { readonly type: "issue" }>["issue"] {
  return {
    id: "parsed-2",
    type: "java",
    timestamp: "07-15 10:00:00.000",
    processName: "cn.example.app",
    summary: "java.lang.IllegalStateException",
    fingerprint: "java|java.lang.IllegalStateException|unknown",
    occurrenceCount: 1,
    occurrenceTimestamps: ["07-15 10:00:00.000"],
    rawLogStartLine: 2,
    rawLogEndLine: 8,
  };
}
