import type { DeviceInfo } from "../../shared/contracts.js";
import { deviceSerialSchema } from "../../shared/schemas.js";
import type { ProcessResult, StreamProcessOptions } from "../adb/process-runner.js";

export type DeviceProcessRunner = (
  executable: string,
  args: readonly string[],
  options?: Pick<StreamProcessOptions, "signal">,
) => Promise<ProcessResult>;

export class DeviceDiscoveryError extends Error {
  override readonly name = "DeviceDiscoveryError";

  constructor(readonly result: ProcessResult) {
    super("ADB device discovery failed");
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
