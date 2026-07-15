import type { DeviceInfo, DevicesResponse } from "../../shared/contracts.js";
import { deviceSerialSchema } from "../../shared/schemas.js";
import type { DeviceSerial } from "../../shared/schemas.js";
import { runProcess } from "../adb/process-runner.js";
import { DeviceDiscoveryError, parseAdbDevices } from "./device-discovery.js";
import type { DeviceProcessRunner } from "./device-discovery.js";

export { DeviceDiscoveryError, parseAdbDevices } from "./device-discovery.js";
export type { DeviceProcessRunner } from "./device-discovery.js";

export type DeviceServiceErrorSink = (error: unknown) => void;

export type DeviceServiceEvent =
  | ({ readonly type: "change" } & DevicesResponse)
  | ({ readonly type: "disconnect"; readonly serial: DeviceSerial } &
      DevicesResponse)
  | { readonly type: "error"; readonly error: DeviceDiscoveryError };

export type DeviceServiceListener = (event: DeviceServiceEvent) => void;

type PollingRefreshContext = {
  readonly kind: "polling";
  readonly controller: AbortController;
  readonly generation: number;
  manualConsumer: boolean;
};

type RefreshContext = { readonly kind: "manual" } | PollingRefreshContext;

type ActiveRefresh = {
  readonly context: RefreshContext;
  readonly promise: Promise<DevicesResponse>;
};

export class DeviceSelectionError extends Error {
  override readonly name = "DeviceSelectionError";

  constructor(readonly serial: string) {
    super(`Device ${serial} is not available for selection`);
  }
}

export class DeviceService {
  private devices: readonly DeviceInfo[] = [];
  private selectedSerial: DeviceSerial | undefined;
  private readonly listeners = new Set<DeviceServiceListener>();
  private activeRefresh: ActiveRefresh | undefined;
  private pollingTimer: NodeJS.Timeout | undefined;
  private pollingGeneration = 0;

  constructor(
    private readonly adbExecutable: string,
    private readonly processRunner: DeviceProcessRunner = runProcess,
    private readonly errorSink: DeviceServiceErrorSink = () => undefined,
  ) {}

  refresh(): Promise<DevicesResponse> {
    if (this.activeRefresh !== undefined) {
      const { context, promise } = this.activeRefresh;
      if (context.kind === "manual") {
        return promise;
      }
      if (!context.controller.signal.aborted) {
        context.manualConsumer = true;
        return promise;
      }
      return promise.then(
        () => this.refresh(),
        () => this.refresh(),
      );
    }
    return this.beginRefresh({ kind: "manual" });
  }

  private beginRefresh(context: RefreshContext): Promise<DevicesResponse> {
    const request = this.discover(context);
    const activeRefresh = { context, promise: request };
    this.activeRefresh = activeRefresh;
    const clearRequest = (): void => {
      if (this.activeRefresh === activeRefresh) {
        this.activeRefresh = undefined;
      }
    };
    request.then(clearRequest, clearRequest);
    return request;
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      if (this.activeRefresh !== undefined) {
        return;
      }
      const context: PollingRefreshContext = {
        kind: "polling",
        controller: new AbortController(),
        generation: this.pollingGeneration,
        manualConsumer: false,
      };
      void this.beginRefresh(context).catch((error: unknown) => {
        if (!this.shouldApply(context)) {
          return;
        }
        if (error instanceof DeviceDiscoveryError) {
          this.emit({ type: "error", error });
        } else {
          this.reportError(error);
        }
      });
    }, intervalMs);
    this.pollingTimer.unref();
  }

  stopPolling(): void {
    this.pollingGeneration += 1;
    if (this.pollingTimer !== undefined) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    const context = this.activeRefresh?.context;
    if (context?.kind === "polling" && !context.manualConsumer) {
      context.controller.abort();
    }
  }

  select(serialValue: string): DevicesResponse {
    const serial = deviceSerialSchema.safeParse(serialValue);
    const device = serial.success
      ? this.devices.find(
          (candidate) =>
            candidate.serial === serial.data && candidate.state === "device",
        )
      : undefined;
    if (device === undefined) {
      throw new DeviceSelectionError(serialValue);
    }
    this.selectedSerial = device.serial;
    const snapshot = this.snapshot();
    this.emit({ type: "change", ...snapshot });
    return snapshot;
  }

  onChange(listener: DeviceServiceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current(): DevicesResponse {
    return this.snapshot();
  }

  private async discover(context: RefreshContext): Promise<DevicesResponse> {
    const signal = context.kind === "polling" ? context.controller.signal : undefined;
    const result = await this.processRunner(
      this.adbExecutable,
      ["devices", "-l"],
      signal === undefined ? {} : { signal },
    );
    if (!this.shouldApply(context)) {
      return this.snapshot();
    }
    if (result.kind !== "exited" || result.exitCode !== 0) {
      throw new DeviceDiscoveryError(result);
    }

    const previousSelection = this.selectedSerial;
    this.devices = parseAdbDevices(result.stdout);
    const available = this.devices.filter((device) => device.state === "device");
    const selectionRemains = available.some(
      (device) => device.serial === previousSelection,
    );
    if (previousSelection !== undefined && !selectionRemains) {
      this.selectedSerial = undefined;
    }
    if (this.selectedSerial === undefined && available.length === 1) {
      this.selectedSerial = available[0]?.serial;
    }

    const snapshot = this.snapshot();
    if (previousSelection !== undefined && !selectionRemains) {
      this.emit({
        type: "disconnect",
        serial: previousSelection,
        ...snapshot,
      });
    }
    this.emit({ type: "change", ...snapshot });
    return snapshot;
  }

  private snapshot(): DevicesResponse {
    return {
      devices: [...this.devices],
      ...(this.selectedSerial === undefined
        ? {}
        : { selectedSerial: this.selectedSerial }),
    };
  }

  private emit(event: DeviceServiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.reportError(error instanceof Error ? error : String(error));
      }
    }
  }

  private shouldApply(context: RefreshContext): boolean {
    return (
      context.kind === "manual" ||
      context.manualConsumer ||
      context.generation === this.pollingGeneration
    );
  }

  private reportError(error: unknown): void {
    try {
      this.errorSink(error);
    } catch (sinkError) {
      process.emitWarning(
        sinkError instanceof Error ? sinkError : String(sinkError),
      );
    }
  }
}
