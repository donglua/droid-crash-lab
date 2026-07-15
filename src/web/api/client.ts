import type { DevicesResponse, EnvironmentResponse, RunsResponse, RunSummary } from "../../shared/contracts.js";
import {
  devicesResponseSchema,
  environmentResponseSchema,
  runsResponseSchema,
} from "../../shared/schemas.js";

export type ApiClient = {
  readonly environment: () => Promise<EnvironmentResponse>;
  readonly devices: () => Promise<DevicesResponse>;
  readonly runs: () => Promise<RunsResponse>;
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
  runs: async () => parseRuns(await getJson("/api/runs")),
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

function parseRuns(value: unknown): RunsResponse {
  return { runs: runsResponseSchema.parse(value).runs.map(parseRunSummary) };
}

function parseRunSummary(parsed: ReturnType<typeof runsResponseSchema.parse>["runs"][number]): RunSummary {
  return {
    id: parsed.id,
    state: parsed.state,
    config: parsed.config,
    device: {
      serial: parsed.device.serial,
      state: parsed.device.state,
      ...(parsed.device.model === undefined ? {} : { model: parsed.device.model }),
      ...(parsed.device.product === undefined ? {} : { product: parsed.device.product }),
      ...(parsed.device.transportId === undefined ? {} : { transportId: parsed.device.transportId }),
    },
    apk: parsed.apk,
    startedAt: parsed.startedAt,
    issueCount: parsed.issueCount,
    ...(parsed.completedAt === undefined ? {} : { completedAt: parsed.completedAt }),
    ...(parsed.monkeyProgress === undefined ? {} : { monkeyProgress: parsed.monkeyProgress }),
  };
}
