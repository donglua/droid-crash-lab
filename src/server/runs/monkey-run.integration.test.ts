import { describe, expect, it } from "vitest";
import { RunEventBus } from "../events/event-bus.js";
import { apkTokenSchema, deviceSerialSchema, runIdSchema } from "../../shared/schemas.js";
import type { RunSummary } from "../../shared/contracts.js";
import type { ProcessResult, StreamingProcess } from "../adb/process-runner.js";
import { RunCoordinator, type CoordinatorRepository, type ProcessStreamer } from "./run-coordinator.js";

describe("RunCoordinator Monkey integration", () => {
  it("starts logcat before Monkey and auto-completes after normal Monkey exit", async () => {
    const order: string[] = [];
    const processes: Array<
      StreamingProcess & {
        readonly emitStdout: (chunk: string) => void;
        readonly resolve: (result: ProcessResult) => void;
      }
    > = [];
    const stream: ProcessStreamer = (_executable, args, options = {}) => {
      const label = args.includes("monkey") ? "monkey" : "logcat";
      order.push(label);
      let complete: (result: ProcessResult) => void = () => undefined;
      const process = {
        pid: processes.length + 1,
        completion: new Promise<ProcessResult>((resolve) => {
          complete = resolve;
        }),
        stop: () => {
          order.push(`stop:${label}`);
          return true;
        },
        emitStdout: (chunk: string) => options.onStdout?.(chunk),
        resolve: complete,
      };
      processes.push(process);
      return process;
    };
    const repository = new SilentRepository();
    const coordinator = new RunCoordinator({
      adbExecutable: "adb",
      repository,
      preparation: { install: async () => "", launch: async () => "" },
      runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
      streamProcess: stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });

    await coordinator.start({
      device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" },
      apk: {
        token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
        applicationId: "cn.example.app",
        versionName: "1",
        versionCode: "1",
        storedPath: "/tmp/app.apk",
      },
      config: { mode: "monkey", eventCount: 500, throttleMs: 200, seed: 42 },
    });

    expect(order).toEqual(["logcat", "monkey"]);
    processes[1]?.emitStdout("Events injected: 125\n");
    processes[1]?.resolve({ kind: "exited", exitCode: 0, stdout: "", stderr: "" });
    processes[0]?.resolve({ kind: "aborted", stdout: "", stderr: "" });
    const completed = await coordinator.waitForIdle();
    expect(completed?.state).toBe("completed");
    expect(completed?.monkeyProgress).toEqual({ completedEvents: 125, totalEvents: 500 });
    expect(repository.monkey).toContain("Events injected: 125");
    expect(order.indexOf("stop:monkey")).toBeLessThan(order.indexOf("stop:logcat"));
  });

  it("preserves Monkey output and interrupts after a non-zero exit", async () => {
    const processes: Array<
      StreamingProcess & {
        readonly emitStderr: (chunk: string) => void;
        readonly resolve: (result: ProcessResult) => void;
      }
    > = [];
    const stream: ProcessStreamer = (_executable, _args, options = {}) => {
      let complete: (result: ProcessResult) => void = () => undefined;
      const process = {
        pid: processes.length + 1,
        completion: new Promise<ProcessResult>((resolve) => {
          complete = resolve;
        }),
        stop: () => true,
        emitStderr: (chunk: string) => options.onStderr?.(chunk),
        resolve: complete,
      };
      processes.push(process);
      return process;
    };
    const repository = new SilentRepository();
    const coordinator = createMonkeyCoordinator(repository, stream);

    await coordinator.start(monkeyInput());
    processes[1]?.emitStderr("** SecurityException **\n");
    processes[1]?.resolve({ kind: "exited", exitCode: 1, stdout: "", stderr: "" });
    processes[0]?.resolve({ kind: "aborted", stdout: "", stderr: "" });

    expect((await coordinator.waitForIdle())?.state).toBe("interrupted");
    expect(repository.monkey).toContain("SecurityException");
  });
});

class SilentRepository implements CoordinatorRepository {
  private summary: RunSummary | undefined;
  monkey = "";

  async create(input: Omit<RunSummary, "id">): Promise<RunSummary> {
    this.summary = { ...input, id: runIdSchema.parse("20260715T020304Z-a1b2c3") };
    return this.summary;
  }

  async writeMetadata(summary: RunSummary): Promise<void> {
    this.summary = summary;
  }

  async writeIssues(): Promise<void> {}
  async appendEvent(): Promise<void> {}
  async appendLogcat(): Promise<void> {}
  async appendMonkey(_runId: RunSummary["id"], content: string | Uint8Array): Promise<void> {
    this.monkey += typeof content === "string" ? content : new TextDecoder().decode(content);
  }
  async appendInstall(): Promise<void> {}
}

function monkeyInput() {
  return {
    device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" as const },
    apk: {
      token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
      applicationId: "cn.example.app",
      versionName: "1",
      versionCode: "1",
      storedPath: "/tmp/app.apk",
    },
    config: { mode: "monkey" as const, eventCount: 500, throttleMs: 200, seed: 42 },
  };
}

function createMonkeyCoordinator(repository: SilentRepository, stream: ProcessStreamer): RunCoordinator {
  return new RunCoordinator({
    adbExecutable: "adb",
    repository,
    preparation: { install: async () => "", launch: async () => "" },
    runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
    streamProcess: stream,
    eventBus: new RunEventBus({ replayLimit: 16 }),
  });
}
