import { describe, expect, it } from "vitest";
import type { ApkInfo, DeviceInfo, RunSummary } from "../../shared/contracts.js";
import { apkTokenSchema, deviceSerialSchema, runIdSchema } from "../../shared/schemas.js";
import type { ProcessResult, StreamingProcess } from "../adb/process-runner.js";
import { RunEventBus } from "../events/event-bus.js";
import {
  ActiveRunError,
  RunCoordinator,
  type CoordinatorRepository,
  type ProcessStreamer,
  type RunPreparation,
} from "./run-coordinator.js";

type DeferredStream = StreamingProcess & {
  readonly args: readonly string[];
  readonly emitStdout: (chunk: string) => void;
  readonly resolve: (result: ProcessResult) => void;
  readonly stopCalls: () => number;
};

function deferredStreamer(order: string[]): { readonly stream: ProcessStreamer; readonly processes: DeferredStream[] } {
  const processes: DeferredStream[] = [];
  const stream: ProcessStreamer = (_executable, args, options = {}) => {
    order.push(args.includes("monkey") ? "monkey" : "logcat");
    let complete: (result: ProcessResult) => void = () => undefined;
    let stops = 0;
    const process: DeferredStream = {
      args,
      pid: processes.length + 10,
      completion: new Promise((resolve) => {
        complete = resolve;
      }),
      stop: () => {
        stops += 1;
        return stops === 1;
      },
      emitStdout: (chunk) => options.onStdout?.(chunk),
      resolve: complete,
      stopCalls: () => stops,
    };
    processes.push(process);
    return process;
  };
  return { stream, processes };
}

class MemoryRepository implements CoordinatorRepository {
  readonly calls: string[] = [];
  summaries: RunSummary[] = [];
  logcat = "";
  monkey = "";

  async create(input: Omit<RunSummary, "id">): Promise<RunSummary> {
    const summary = { ...input, id: runIdSchema.parse("20260715T020304Z-a1b2c3") };
    this.summaries.push(summary);
    this.calls.push("create");
    return summary;
  }

  async writeMetadata(summary: RunSummary): Promise<void> {
    this.summaries.push(summary);
    this.calls.push(`metadata:${summary.state}`);
  }

  async writeIssues(): Promise<void> {
    this.calls.push("issues");
  }

  async appendEvent(_runId: RunSummary["id"], event: { readonly type: string }): Promise<void> {
    this.calls.push(`event:${event.type}`);
  }

  async appendLogcat(_runId: RunSummary["id"], content: string | Uint8Array): Promise<void> {
    this.logcat += typeof content === "string" ? content : new TextDecoder().decode(content);
    this.calls.push("write:logcat");
  }

  async appendMonkey(_runId: RunSummary["id"], content: string | Uint8Array): Promise<void> {
    this.monkey += typeof content === "string" ? content : new TextDecoder().decode(content);
    this.calls.push("write:monkey");
  }

  async appendInstall(): Promise<void> {
    this.calls.push("install-output");
  }
}

function fixture(): { readonly device: DeviceInfo; readonly apk: ApkInfo } {
  return {
    device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device" },
    apk: {
      token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
      applicationId: "cn.example.app",
      versionName: "1.0",
      versionCode: "1",
      storedPath: "/tmp/app.apk",
    },
  };
}

function preparation(order: string[]): RunPreparation {
  return {
    install: async () => {
      order.push("install");
      return "install ok\n";
    },
    launch: async () => {
      order.push("launch");
      return "launch ok\n";
    },
  };
}

describe("RunCoordinator manual integration", () => {
  it("prepares the run and starts logcat with the exact safe arguments", async () => {
    const order: string[] = [];
    const repository = new MemoryRepository();
    const streams = deferredStreamer(order);
    const coordinator = new RunCoordinator({
      adbExecutable: "/sdk/adb",
      repository,
      preparation: preparation(order),
      runProcess: async (_executable, args) => {
        order.push(args.join(" "));
        return { kind: "exited", exitCode: 0, stdout: "", stderr: "" };
      },
      streamProcess: streams.stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });
    const input = fixture();

    const run = await coordinator.start({ ...input, config: { mode: "manual" } });

    expect(run.state).toBe("running");
    expect(order).toEqual([
      "install",
      "launch",
      "-s emulator-5554 logcat -c",
      "logcat",
    ]);
    expect(streams.processes[0]?.args).toEqual([
      "-s",
      "emulator-5554",
      "logcat",
      "-v",
      "threadtime",
      "-b",
      "main",
      "-b",
      "system",
      "-b",
      "crash",
    ]);
  });

  it("rejects a second active run", async () => {
    const order: string[] = [];
    const coordinator = new RunCoordinator({
      adbExecutable: "adb",
      repository: new MemoryRepository(),
      preparation: preparation(order),
      runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
      streamProcess: deferredStreamer(order).stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });
    const input = fixture();
    await coordinator.start({ ...input, config: { mode: "manual" } });

    await expect(coordinator.start({ ...input, config: { mode: "manual" } })).rejects.toBeInstanceOf(
      ActiveRunError,
    );
  });

  it("rejects a concurrent start while the first run is still preparing", async () => {
    const order: string[] = [];
    let finishInstall: () => void = () => undefined;
    const coordinator = new RunCoordinator({
      adbExecutable: "adb",
      repository: new MemoryRepository(),
      preparation: {
        install: () =>
          new Promise((resolve) => {
            finishInstall = () => resolve("");
          }),
        launch: async () => "",
      },
      runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
      streamProcess: deferredStreamer(order).stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });
    const input = fixture();
    const first = coordinator.start({ ...input, config: { mode: "manual" } });

    await expect(coordinator.start({ ...input, config: { mode: "manual" } })).rejects.toBeInstanceOf(
      ActiveRunError,
    );
    finishInstall();
    await first;
  });

  it("writes every logcat byte before parsing and completes on idempotent manual stop", async () => {
    const order: string[] = [];
    const repository = new MemoryRepository();
    const streams = deferredStreamer(order);
    const coordinator = new RunCoordinator({
      adbExecutable: "adb",
      repository,
      preparation: preparation(order),
      runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
      streamProcess: streams.stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });
    const input = fixture();
    await coordinator.start({ ...input, config: { mode: "manual" } });
    streams.processes[0]?.emitStdout("07-15 10:00:00.000  100  100 E AndroidRuntime: FATAL EXCEPTION: main\n");

    const firstStop = coordinator.stop();
    const secondStop = coordinator.stop();
    streams.processes[0]?.resolve({ kind: "exited", exitCode: 0, stdout: "", stderr: "" });

    expect(secondStop).toBe(firstStop);
    const completed = await firstStop;
    expect(completed.state).toBe("completed");
    expect(streams.processes[0]?.stopCalls()).toBe(1);
    expect(repository.logcat).toContain("FATAL EXCEPTION");
    expect(repository.calls.indexOf("write:logcat")).toBeLessThan(repository.calls.indexOf("issues"));
  });

  it("interrupts the active run when its selected device disconnects", async () => {
    const order: string[] = [];
    const repository = new MemoryRepository();
    const streams = deferredStreamer(order);
    const coordinator = new RunCoordinator({
      adbExecutable: "adb",
      repository,
      preparation: preparation(order),
      runProcess: async () => ({ kind: "exited", exitCode: 0, stdout: "", stderr: "" }),
      streamProcess: streams.stream,
      eventBus: new RunEventBus({ replayLimit: 16 }),
    });
    const input = fixture();
    await coordinator.start({ ...input, config: { mode: "manual" } });

    const interrupted = coordinator.handleDeviceDisconnect(input.device.serial);
    streams.processes[0]?.resolve({ kind: "aborted", stdout: "", stderr: "" });

    expect((await interrupted)?.state).toBe("interrupted");
  });
});
