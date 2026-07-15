import type { Readable } from "node:stream";
import type {
  ApkInfo,
  DevicesResponse,
  EnvironmentResponse,
  Issue,
  RawLogRangeResponse,
  RunEvent,
  RunSummary,
} from "../../shared/contracts.js";
import type {
  ApkToken,
  DeviceSerial,
  EventId,
  RunConfig,
  RunId,
} from "../../shared/schemas.js";

export type AppDependencies = {
  readonly environment: () => Promise<EnvironmentResponse>;
  readonly devices: () => Promise<DevicesResponse>;
  readonly apks: {
    readonly inspect: (filename: string, content: Uint8Array) => Promise<ApkInfo>;
    readonly install: (token: ApkToken, serial: DeviceSerial) => Promise<void>;
    readonly launch: (token: ApkToken, serial: DeviceSerial) => Promise<ApkInfo>;
  };
  readonly runs: {
    readonly start: (input: {
      readonly apkToken: ApkToken;
      readonly deviceSerial: DeviceSerial;
      readonly config: RunConfig;
    }) => Promise<RunSummary>;
    readonly stop: (runId: RunId) => Promise<RunSummary>;
    readonly list: () => Promise<readonly RunSummary[]>;
    readonly details: (
      runId: RunId,
    ) => Promise<{ readonly run: RunSummary; readonly issues: readonly Issue[] } | undefined>;
    readonly logRange: (runId: RunId, startLine: number, endLine: number) => Promise<RawLogRangeResponse>;
    readonly archive: (runId: RunId) => Promise<Readable>;
    readonly events: (
      listener: (event: RunEvent) => void,
      afterId?: EventId,
    ) => () => void;
  };
};
