import type { ApkInfo, DevicesResponse, EnvironmentResponse, Issue, RawLogRangeResponse, RunConfig, RunDetailsResponse, RunsResponse, RunSummary } from "../../shared/contracts.js";
import {
  devicesResponseSchema,
  environmentResponseSchema,
  rawLogRangeResponseSchema,
  runDetailsResponseSchema,
  runsResponseSchema,
  apkInfoSchema,
  runSummarySchema,
} from "../../shared/schemas.js";

export type ApiClient = {
  readonly environment: () => Promise<EnvironmentResponse>;
  readonly devices: () => Promise<DevicesResponse>;
  readonly runs: () => Promise<RunsResponse>;
  readonly inspectApk: (file: File) => Promise<ApkInfo>;
  readonly installApk: (apkToken: ApkInfo["token"], deviceSerial: DevicesResponse["selectedSerial"] & string) => Promise<{ readonly installed: true }>;
  readonly launchApp: (apkToken: ApkInfo["token"], deviceSerial: DevicesResponse["selectedSerial"] & string) => Promise<{ readonly launched: true }>;
  readonly runDetails: (runId: RunSummary["id"]) => Promise<RunDetailsResponse>;
  readonly logRange: (runId: RunSummary["id"], startLine: number, endLine: number) => Promise<RawLogRangeResponse>;
  readonly startRun: (input: { readonly apkToken: ApkInfo["token"]; readonly deviceSerial: DevicesResponse["selectedSerial"] & string; readonly config: RunConfig }) => Promise<RunSummary>;
  readonly stopRun: (runId: RunSummary["id"]) => Promise<RunSummary>;
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw await responseError(response, url);
  return response.json();
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw await responseError(response, url);
  return response.json();
}

export class HttpResponseError extends Error {
  override readonly name = "HttpResponseError";

  constructor(
    readonly status: number,
    readonly url: string,
    readonly code?: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

async function responseError(response: Response, url: string): Promise<HttpResponseError> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return new HttpResponseError(response.status, url);
  }
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return new HttpResponseError(response.status, url);
  }
  const error = value.error;
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? new HttpResponseError(response.status, url, error.code)
    : new HttpResponseError(response.status, url);
}

export const apiClient: ApiClient = {
  environment: async () => parseEnvironment(await getJson("/api/environment")),
  devices: async () => parseDevices(await getJson("/api/devices")),
  runs: async () => parseRuns(await getJson("/api/runs")),
  inspectApk: async (file) => {
    const form = new FormData();
    form.append("apk", file, file.name);
    const value = await requestJson("/api/apks/inspect", { method: "POST", body: form });
    if (typeof value !== "object" || value === null || !("apk" in value)) throw new TypeError("Missing APK response");
    return parseApk(value.apk);
  },
  installApk: async (apkToken, deviceSerial) => {
    const value = await requestJson("/api/apks/install", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apkToken, deviceSerial }) });
    if (typeof value !== "object" || value === null || !("installed" in value) || value.installed !== true) throw new TypeError("Missing install response");
    return { installed: true };
  },
  launchApp: async (apkToken, deviceSerial) => {
    const value = await requestJson("/api/apps/launch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apkToken, deviceSerial }) });
    if (typeof value !== "object" || value === null || !("launched" in value) || value.launched !== true) throw new TypeError("Missing launch response");
    return { launched: true };
  },
  runDetails: async (runId) => parseRunDetails(await getJson(`/api/runs/${runId}`)),
  logRange: async (runId, startLine, endLine) => rawLogRangeResponseSchema.parse(await getJson(`/api/runs/${runId}/logs?startLine=${startLine}&endLine=${endLine}`)),
  startRun: async (input) => parseRunEnvelope(await requestJson("/api/runs", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  })),
  stopRun: async (runId) => parseRunEnvelope(await requestJson(`/api/runs/${runId}/stop`, { method: "POST" })),
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

function parseApk(value: unknown): ApkInfo {
  return apkInfoSchema.parse(value);
}

function parseRunDetails(value: unknown): RunDetailsResponse {
  const parsed = runDetailsResponseSchema.parse(value);
  return { run: parseRunSummary(parsed.run), issues: parsed.issues.map(parseIssue) };
}

function parseIssue(parsed: ReturnType<typeof runDetailsResponseSchema.parse>["issues"][number]): Issue {
  const base = {
    id: parsed.id,
    timestamp: parsed.timestamp,
    processName: parsed.processName,
    summary: parsed.summary,
    fingerprint: parsed.fingerprint,
    occurrenceCount: parsed.occurrenceCount,
    occurrenceTimestamps: parsed.occurrenceTimestamps,
    rawLogStartLine: parsed.rawLogStartLine,
    rawLogEndLine: parsed.rawLogEndLine,
    ...(parsed.threadName === undefined ? {} : { threadName: parsed.threadName }),
    ...(parsed.exceptionClass === undefined ? {} : { exceptionClass: parsed.exceptionClass }),
    ...(parsed.topApplicationFrame === undefined ? {} : { topApplicationFrame: parsed.topApplicationFrame }),
    ...(parsed.monkeyProgress === undefined ? {} : { monkeyProgress: parsed.monkeyProgress }),
  };
  return parsed.type === "java"
    ? { ...base, type: "java", ...(parsed.labels === undefined ? {} : { labels: parsed.labels }) }
    : { ...base, type: parsed.type };
}

function parseRunEnvelope(value: unknown): RunSummary {
  if (typeof value !== "object" || value === null || !("run" in value)) throw new TypeError("Missing run response");
  return parseRunSummary(runSummarySchema.parse(value.run));
}
