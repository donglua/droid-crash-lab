import type { DeviceInfo, DevicesResponse } from "../../shared/contracts.js";
import { deviceSerialSchema } from "../../shared/schemas.js";
import type { DeviceSerial } from "../../shared/schemas.js";
import { runProcess } from "../adb/process-runner.js";
import type { ProcessResult } from "../adb/process-runner.js";

export type DeviceProcessRunner = (
  executable: string,
  args: readonly string[],
) => Promise<ProcessResult>;

export type DeviceServiceEvent =
  | ({ readonly type: "change" } & DevicesResponse)
  | ({ readonly type: "disconnect"; readonly serial: DeviceSerial } &
      DevicesResponse)
  | { readonly type: "error"; readonly error: DeviceDiscoveryError };

export type DeviceServiceListener = (event: DeviceServiceEvent) => void;

export class DeviceDiscoveryError extends Error {
  override readonly name = "DeviceDiscoveryError";

  constructor(readonly result: ProcessResult) {
    super("ADB device discovery failed");
  }
}

export class DeviceSelectionError extends Error {
  override readonly name = "DeviceSelectionError";

  constructor(readonly serial: string) {
    super(`Device ${serial} is not available for selection`);
  }
}

export function parseAdbDevices(output: string): readonly DeviceInfo[] {
  const devices: DeviceInfo[] = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line === "List of devices attached") {
      continue;
    }
    const [serialValue, stateValue, ...properties] = line.split(/\s+/u);
    if (serialValue === undefined || !isDeviceState(stateValue)) {
      continue;
    }
    const serial = deviceSerialSchema.safeParse(serialValue);
    if (!serial.success) {
      continue;
    }
    const metadata = parseMetadata(properties);
    devices.push({
      serial: serial.data,
      state: stateValue,
      ...(metadata["model"] === undefined
        ? {}
        : { model: metadata["model"] }),
      ...(metadata["product"] === undefined
        ? {}
        : { product: metadata["product"] }),
      ...(metadata["transport_id"] === undefined
        ? {}
        : { transportId: metadata["transport_id"] }),
    });
  }
  return devices;
}

export class DeviceService {
  private devices: readonly DeviceInfo[] = [];
  private selectedSerial: DeviceSerial | undefined;
  private readonly listeners = new Set<DeviceServiceListener>();
  private refreshInFlight: Promise<DevicesResponse> | undefined;
  private pollingTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly adbExecutable: string,
    private readonly processRunner: DeviceProcessRunner = runProcess,
  ) {}

  refresh(): Promise<DevicesResponse> {
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }
    const request = this.discover();
    this.refreshInFlight = request;
    const clearRequest = (): void => {
      if (this.refreshInFlight === request) {
        this.refreshInFlight = undefined;
      }
    };
    request.then(clearRequest, clearRequest);
    return request;
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this.pollingTimer = setInterval(() => {
      if (this.refreshInFlight !== undefined) {
        return;
      }
      void this.refresh().catch((error: unknown) => {
        if (error instanceof DeviceDiscoveryError) {
          this.emit({ type: "error", error });
          return;
        }
        throw error;
      });
    }, intervalMs);
    this.pollingTimer.unref();
  }

  stopPolling(): void {
    if (this.pollingTimer !== undefined) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
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

  private async discover(): Promise<DevicesResponse> {
    const result = await this.processRunner(this.adbExecutable, ["devices", "-l"]);
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
      listener(event);
    }
  }
}

function isDeviceState(
  value: string | undefined,
): value is DeviceInfo["state"] {
  return (
    value === "device" || value === "offline" || value === "unauthorized"
  );
}

function parseMetadata(properties: readonly string[]): Readonly<Record<string, string>> {
  const metadata: Record<string, string> = {};
  for (const property of properties) {
    const separator = property.indexOf(":");
    if (separator > 0) {
      metadata[property.slice(0, separator)] = property.slice(separator + 1);
    }
  }
  return metadata;
}
