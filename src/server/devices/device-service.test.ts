import { describe, expect, it, vi } from "vitest";

import type { ProcessResult } from "../adb/process-runner.js";
import {
  DeviceService,
  parseAdbDevices,
  type DeviceProcessRunner,
  type DeviceServiceEvent,
} from "./device-service.js";

const THREE_DEVICE_FIXTURE = `List of devices attached
emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
R58M123456F offline product:dreamlte model:SM_G950F transport_id:2
ZX1G22 unauthorized usb:1-1 transport_id:3
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

describe("parseAdbDevices", () => {
  it("parses device states and long-list metadata", () => {
    // Given
    const output = THREE_DEVICE_FIXTURE;

    // When
    const devices = parseAdbDevices(output);

    // Then
    expect(devices).toEqual([
      {
        serial: "emulator-5554",
        state: "device",
        product: "sdk_gphone64_arm64",
        model: "sdk_gphone64_arm64",
        transportId: "1",
      },
      {
        serial: "R58M123456F",
        state: "offline",
        product: "dreamlte",
        model: "SM_G950F",
        transportId: "2",
      },
      {
        serial: "ZX1G22",
        state: "unauthorized",
        transportId: "3",
      },
    ]);
  });
});

describe("DeviceService", () => {
  it("auto-selects the only available device", async () => {
    // Given
    const service = new DeviceService("/sdk/adb", sequenceRunner([THREE_DEVICE_FIXTURE]));

    // When
    const snapshot = await service.refresh();

    // Then
    expect(snapshot.selectedSerial).toBe("emulator-5554");
  });

  it("preserves an existing selection when multiple devices are available", async () => {
    // Given
    const first = `List of devices attached\nfirst device transport_id:1\n`;
    const multiple = `List of devices attached\nfirst device transport_id:1\nsecond device transport_id:2\n`;
    const service = new DeviceService(
      "/sdk/adb",
      sequenceRunner([first, multiple]),
    );
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
      completeRequest?.(exited(THREE_DEVICE_FIXTURE));
      await pendingResult;
      await vi.advanceTimersByTimeAsync(10);
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      service.stopPolling();
      vi.useRealTimers();
    }
  });

  it("aborts a polling request and suppresses its stale completion after stop", async () => {
    // Given
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    let completeRequest: ((result: ProcessResult) => void) | undefined;
    const runner = vi.fn(
      (
        _executable: string,
        _args: readonly string[],
        options?: { readonly signal?: AbortSignal },
      ) => {
        requestSignal = options?.signal;
        return new Promise<ProcessResult>((resolve) => {
          completeRequest = resolve;
        });
      },
    );
    const service = new DeviceService("/sdk/adb", runner);
    const events: DeviceServiceEvent[] = [];
    service.onChange((event) => events.push(event));

    try {
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(10);

      // When
      service.stopPolling();
      completeRequest?.(exited(THREE_DEVICE_FIXTURE));
      await vi.advanceTimersByTimeAsync(0);

      // Then
      expect(requestSignal?.aborted).toBe(true);
      expect(events).toEqual([]);
    } finally {
      service.stopPolling();
      vi.useRealTimers();
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
      vi.useRealTimers();
    }
  });

  it("restarts polling while a stale stopped request remains pending", async () => {
    // Given
    vi.useFakeTimers();
    const runner = vi.fn(
      async (): Promise<ProcessResult> => new Promise(() => undefined),
    );
    const service = new DeviceService("/sdk/adb", runner);
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);
    service.stopPolling();

    try {
      // When
      service.startPolling(10);
      await vi.advanceTimersByTimeAsync(10);

      // Then
      expect(runner).toHaveBeenCalledTimes(2);
    } finally {
      service.stopPolling();
      vi.useRealTimers();
    }
  });

  it("does not abort a manual refresh coalesced with polling", async () => {
    // Given
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    let completeRequest: ((result: ProcessResult) => void) | undefined;
    const runner = vi.fn(
      (
        _executable: string,
        _args: readonly string[],
        options?: { readonly signal?: AbortSignal },
      ) => {
        requestSignal = options?.signal;
        return new Promise<ProcessResult>((resolve) => {
          completeRequest = resolve;
        });
      },
    );
    const service = new DeviceService("/sdk/adb", runner);
    service.startPolling(10);
    await vi.advanceTimersByTimeAsync(10);
    const manualRefresh = service.refresh();

    try {
      // When
      service.stopPolling();
      completeRequest?.(exited(THREE_DEVICE_FIXTURE));
      const snapshot = await manualRefresh;

      // Then
      expect(requestSignal?.aborted).toBe(false);
      expect(snapshot.selectedSerial).toBe("emulator-5554");
    } finally {
      service.stopPolling();
      vi.useRealTimers();
    }
  });

  it("isolates a throwing listener and reports it to the error sink", async () => {
    // Given
    vi.useFakeTimers();
    const reported: unknown[] = [];
    const laterEvents: DeviceServiceEvent[] = [];
    const service = new DeviceService(
      "/sdk/adb",
      sequenceRunner([THREE_DEVICE_FIXTURE]),
      (error) => reported.push(error),
    );
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
      vi.useRealTimers();
    }
  });

  it("stops notifying a listener after unsubscribe", async () => {
    // Given
    const service = new DeviceService(
      "/sdk/adb",
      sequenceRunner([THREE_DEVICE_FIXTURE]),
    );
    const listener = vi.fn();
    const unsubscribe = service.onChange(listener);

    // When
    unsubscribe();
    await service.refresh();

    // Then
    expect(listener).not.toHaveBeenCalled();
  });
});
