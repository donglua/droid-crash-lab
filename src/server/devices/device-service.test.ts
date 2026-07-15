import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessResult } from "../adb/process-runner.js";
import {
  DeviceService,
  type DeviceProcessRunner,
  type DeviceServiceEvent,
} from "./device-service.js";

const AVAILABLE_DEVICE_FIXTURE = `List of devices attached
emulator-5554 device transport_id:1
`;

function exited(stdout: string): ProcessResult {
  return { kind: "exited", exitCode: 0, stdout, stderr: "" };
}

function sequenceRunner(outputs: readonly string[]): DeviceProcessRunner {
  let index = 0;
  return async () => {
    const output = outputs[index];
    if (output === undefined) {
      throw new Error("Fixture output exhausted");
    }
    index += 1;
    return exited(output);
  };
}

class TestListenerError extends Error {
  override readonly name = "TestListenerError";
}

afterEach(() => vi.useRealTimers());

class DeferredDeviceRunner {
  readonly signals: (AbortSignal | undefined)[] = [];
  readonly run: DeviceProcessRunner = (_executable, _args, options) => {
    this.inFlight += 1;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    this.signals.push(options?.signal);
    return new Promise((resolve) => {
      this.completions.push((result) => {
        this.inFlight -= 1;
        resolve(result);
      });
    });
  };
  peakInFlight = 0;
  private inFlight = 0;
  private readonly completions: ((result: ProcessResult) => void)[] = [];

  get requestCount(): number {
    return this.signals.length;
  }

  settle(index: number, result: ProcessResult): void {
    const complete = this.completions[index];
    if (complete === undefined) {
      throw new RangeError(`Deferred request ${index} does not exist`);
    }
    complete(result);
  }
}

describe("DeviceService", () => {
  it("auto-selects the only available device", async () => {
    // Given
    const service = new DeviceService("/sdk/adb", sequenceRunner([AVAILABLE_DEVICE_FIXTURE]));

    // When
    const snapshot = await service.refresh();

    // Then
    expect(snapshot.selectedSerial).toBe("emulator-5554");
  });

  it("preserves an existing selection when multiple devices are available", async () => {
    // Given
    const first = `List of devices attached\nfirst device transport_id:1\n`;
    const multiple = `List of devices attached\nfirst device transport_id:1\nsecond device transport_id:2\n`;
    const service = new DeviceService("/sdk/adb", sequenceRunner([first, multiple]));
    await service.refresh();

    // When
    const snapshot = await service.refresh();

    // Then
    expect(snapshot.selectedSerial).toBe("first");
  });

  it("emits a disconnect event when the selected device disappears", async () => {
    // Given
    const service = new DeviceService(
      "/sdk/adb",
      sequenceRunner([
        `List of devices attached\nfirst device transport_id:1\nsecond device transport_id:2\n`,
        `List of devices attached\nsecond device transport_id:2\n`,
      ]),
    );
    const events: DeviceServiceEvent[] = [];
    service.onChange((event) => events.push(event));
    await service.refresh();
    service.select("first");

    // When
    await service.refresh();

    // Then
    expect(events).toContainEqual(
      expect.objectContaining({ type: "disconnect", serial: "first" }),
    );
  });

  it("skips polling ticks while an ADB request is active", async () => {
    // Given
    vi.useFakeTimers();
    let completeRequest: ((result: ProcessResult) => void) | undefined;
    const pendingResult = new Promise<ProcessResult>((resolve) => {
      completeRequest = resolve;
    });
    const runner = vi.fn<DeviceProcessRunner>(() => pendingResult);
    const service = new DeviceService("/sdk/adb", runner);

    try {
      // When
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(30);

      // Then
      expect(runner).toHaveBeenCalledTimes(1);
      completeRequest?.(exited(AVAILABLE_DEVICE_FIXTURE));
      await pendingResult;
      await vi.advanceTimersByTimeAsync(10);
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      service.stopPolling();
    }
  });

  it("aborts a polling request and suppresses its stale completion after stop", async () => {
    // Given
    vi.useFakeTimers();
    const deferred = new DeferredDeviceRunner();
    const service = new DeviceService("/sdk/adb", deferred.run);
    const events: DeviceServiceEvent[] = [];
    service.onChange((event) => events.push(event));

    try {
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(10);

      // When
      service.stopPolling();
      deferred.settle(0, exited(AVAILABLE_DEVICE_FIXTURE));
      await vi.advanceTimersByTimeAsync(0);

      // Then
      expect(deferred.signals[0]?.aborted).toBe(true);
      expect(events).toEqual([]);
    } finally {
      service.stopPolling();
    }
  });

  it("settles a hung polling request through abort", async () => {
    // Given
    vi.useFakeTimers();
    let requestSettled = false;
    const runner = vi.fn(
      async (
        _executable: string,
        _args: readonly string[],
        options?: { readonly signal?: AbortSignal },
      ): Promise<ProcessResult> =>
        new Promise((resolve) => {
          options?.signal?.addEventListener(
            "abort",
            () => {
              resolve({ kind: "aborted", stdout: "", stderr: "" });
              requestSettled = true;
            },
            { once: true },
          );
        }),
    );
    const service = new DeviceService("/sdk/adb", runner);
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);

    try {
      // When
      service.stopPolling();
      await vi.advanceTimersByTimeAsync(0);

      // Then
      expect(requestSettled).toBe(true);
    } finally {
      service.stopPolling();
    }
  });

  it("waits for a stopped request to retire before restarted polling continues", async () => {
    // Given
    vi.useFakeTimers();
    const deferred = new DeferredDeviceRunner();
    const service = new DeviceService("/sdk/adb", deferred.run);
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);
    service.stopPolling();

    try {
      // When
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(30);

      // Then
      expect(deferred.requestCount).toBe(1);
      expect(deferred.peakInFlight).toBe(1);
      deferred.settle(0, { kind: "aborted", stdout: "", stderr: "" });
      await vi.advanceTimersByTimeAsync(10);
      expect(deferred.requestCount).toBe(2);
      expect(deferred.peakInFlight).toBe(1);
    } finally {
      service.stopPolling();
    }
  });

  it("does not abort a manual refresh coalesced with polling", async () => {
    // Given
    vi.useFakeTimers();
    const deferred = new DeferredDeviceRunner();
    const service = new DeviceService("/sdk/adb", deferred.run);
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);
    const manualRefresh = service.refresh();

    try {
      // When
      service.stopPolling();
      deferred.settle(0, exited(AVAILABLE_DEVICE_FIXTURE));
      const snapshot = await manualRefresh;

      // Then
      expect(deferred.signals[0]?.aborted).toBe(false);
      expect(snapshot.selectedSerial).toBe("emulator-5554");
    } finally {
      service.stopPolling();
    }
  });

  it("coalesces manual refreshes after an aborted polling request retires", async () => {
    // Given
    vi.useFakeTimers();
    const deferred = new DeferredDeviceRunner();
    const service = new DeviceService("/sdk/adb", deferred.run);
    const events: DeviceServiceEvent[] = [];
    service.onChange((event) => events.push(event));
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);
    service.stopPolling();

    try {
      // When
      const firstRefresh = service.refresh();
      const secondRefresh = service.refresh();

      // Then
      expect(deferred.requestCount).toBe(1);
      expect(deferred.signals[0]?.aborted).toBe(true);
      deferred.settle(0, { kind: "aborted", stdout: "", stderr: "" });
      await vi.advanceTimersByTimeAsync(0);
      expect(events).toEqual([]);
      expect(deferred.requestCount).toBe(2);
      expect(deferred.peakInFlight).toBe(1);
      deferred.settle(1, exited(AVAILABLE_DEVICE_FIXTURE));
      const snapshots = await Promise.all([firstRefresh, secondRefresh]);
      expect(snapshots[0]).toEqual(snapshots[1]);
      expect(events).toHaveLength(1);
    } finally {
      service.stopPolling();
    }
  });

  it("isolates a throwing listener and reports it to the error sink", async () => {
    // Given
    vi.useFakeTimers();
    const reported: unknown[] = [];
    const laterEvents: DeviceServiceEvent[] = [];
    const service = new DeviceService("/sdk/adb", sequenceRunner([AVAILABLE_DEVICE_FIXTURE]), (error) => reported.push(error));
    service.onChange(() => {
      throw new TestListenerError();
    });
    service.onChange((event) => laterEvents.push(event));

    try {
      // When
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(10);

      // Then
      expect(reported).toEqual([expect.any(TestListenerError)]);
      expect(laterEvents).toHaveLength(1);
    } finally {
      service.stopPolling();
    }
  });

  it("stops notifying a listener after unsubscribe", async () => {
    // Given
    const service = new DeviceService("/sdk/adb", sequenceRunner([AVAILABLE_DEVICE_FIXTURE]));
    const listener = vi.fn();
    const unsubscribe = service.onChange(listener);

    // When
    unsubscribe();
    await service.refresh();

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});
