import type { DevicesResponse, EnvironmentResponse } from "../../shared/contracts.js";
import {
  devicesResponseSchema,
  environmentResponseSchema,
} from "../../shared/schemas.js";

export type ApiClient = {
  readonly environment: () => Promise<EnvironmentResponse>;
  readonly devices: () => Promise<DevicesResponse>;
  readonly runs: () => Promise<{ readonly runs: readonly [] }>;
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new HttpResponseError(response.status, url);
  return response.json();
}

export class HttpResponseError extends Error {
  override readonly name = "HttpResponseError";

  constructor(readonly status: number, readonly url: string) {
    super(`HTTP ${status} from ${url}`);
  }
}

export const apiClient: ApiClient = {
  environment: async () => parseEnvironment(await getJson("/api/environment")),
  devices: async () => parseDevices(await getJson("/api/devices")),
  runs: async () => ({ runs: [] }),
};

function parseEnvironment(value: unknown): EnvironmentResponse {
  const parsed = environmentResponseSchema.parse(value);
  return {
    adb: toolStatus(parsed.adb),
    apkanalyzer: toolStatus(parsed.apkanalyzer),
  };
}

function parseDevices(value: unknown): DevicesResponse {
  const parsed = devicesResponseSchema.parse(value);
  return {
    devices: parsed.devices.map((device) => ({
      serial: device.serial,
      state: device.state,
      ...(device.model === undefined ? {} : { model: device.model }),
      ...(device.product === undefined ? {} : { product: device.product }),
      ...(device.transportId === undefined ? {} : { transportId: device.transportId }),
    })),
    ...(parsed.selectedSerial === undefined ? {} : { selectedSerial: parsed.selectedSerial }),
  };
}

function toolStatus(value: {
  readonly available: boolean;
  readonly path?: string | undefined;
  readonly checkedLocations: readonly string[];
}) {
  return {
    available: value.available,
    checkedLocations: value.checkedLocations,
    ...(value.path === undefined ? {} : { path: value.path }),
  };
}
