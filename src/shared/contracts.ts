import type {
  ApkToken,
  DeviceSerial,
  EventId,
  RunConfig,
  RunId,
} from "./schemas.js";

export type {
  ApkToken,
  DeviceSerial,
  EventId,
  RunConfig,
  RunId,
} from "./schemas.js";

export const DEVICE_STATES = ["device", "offline", "unauthorized"] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export const RUN_MODES = ["manual", "monkey"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export const RUN_STATES = [
  "idle",
  "preparing",
  "installing",
  "launching",
  "running",
  "stopping",
  "completed",
  "failed",
  "interrupted",
] as const;
export type RunState = (typeof RUN_STATES)[number];

export const ISSUE_TYPES = ["java", "anr", "native", "oom"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_LABELS = ["di"] as const;
export type IssueLabel = (typeof ISSUE_LABELS)[number];

export const LOG_LEVELS = [
  "verbose",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type DeviceInfo = {
  readonly serial: DeviceSerial;
  readonly state: DeviceState;
  readonly model?: string;
  readonly product?: string;
  readonly transportId?: string;
};

export type ApkInfo = {
  readonly token: ApkToken;
  readonly applicationId: string;
  readonly versionName: string;
  readonly versionCode: string;
  readonly storedPath: string;
};

export type ManualRunConfig = Extract<RunConfig, { readonly mode: "manual" }>;
export type MonkeyRunConfig = Extract<RunConfig, { readonly mode: "monkey" }>;

export type MonkeyProgress = {
  readonly completedEvents: number;
  readonly totalEvents: number;
};

export type RunSummary = {
  readonly id: RunId;
  readonly state: RunState;
  readonly config: RunConfig;
  readonly device: DeviceInfo;
  readonly apk: ApkInfo;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly issueCount: number;
  readonly monkeyProgress?: MonkeyProgress;
};

type IssueBase = {
  readonly id: string;
  readonly timestamp: string;
  readonly processName: string;
  readonly threadName?: string;
  readonly summary: string;
  readonly exceptionClass?: string;
  readonly topApplicationFrame?: string;
  readonly fingerprint: string;
  readonly occurrenceCount: number;
  readonly occurrenceTimestamps: readonly string[];
  readonly rawLogStartLine: number;
  readonly rawLogEndLine: number;
  readonly monkeyProgress?: MonkeyProgress;
};

export type Issue = IssueBase &
  (
    | {
        readonly type: "java";
        readonly labels?: readonly IssueLabel[];
      }
    | {
        readonly type: Exclude<IssueType, "java">;
        readonly labels?: never;
      }
  );

type RunEventBase = {
  readonly id: EventId;
  readonly timestamp: string;
};

export type RunEvent =
  | (RunEventBase & {
      readonly type: "state";
      readonly state: RunState;
    })
  | (RunEventBase & {
      readonly type: "progress";
      readonly progress: MonkeyProgress;
    })
  | (RunEventBase & {
      readonly type: "log";
      readonly lineNumber: number;
      readonly level: LogLevel;
      readonly line: string;
    })
  | (RunEventBase & {
      readonly type: "issue";
      readonly issue: Issue;
    })
  | (RunEventBase & {
      readonly type: "device";
      readonly device: DeviceInfo | null;
    })
  | (RunEventBase & {
      readonly type: "error";
      readonly code: string;
      readonly message: string;
    });

export type ToolStatus = {
  readonly available: boolean;
  readonly path?: string;
  readonly checkedLocations: readonly string[];
};

export type HealthResponse = {
  readonly status: "ok";
};

export type EnvironmentResponse = {
  readonly adb: ToolStatus;
  readonly apkanalyzer: ToolStatus;
};

export type DevicesResponse = {
  readonly devices: readonly DeviceInfo[];
  readonly selectedSerial?: DeviceSerial;
};

export type InspectApkResponse = {
  readonly apk: ApkInfo;
};

export type InstallApkResponse = {
  readonly installed: true;
  readonly apkToken: ApkToken;
  readonly deviceSerial: DeviceSerial;
};

export type LaunchAppResponse = {
  readonly launched: true;
  readonly applicationId: string;
  readonly deviceSerial: DeviceSerial;
};

export type StartRunResponse = {
  readonly run: RunSummary;
};

export type StopRunResponse = {
  readonly run: RunSummary;
};

export type RunsResponse = {
  readonly runs: readonly RunSummary[];
};

export type RunDetailsResponse = {
  readonly run: RunSummary;
  readonly issues: readonly Issue[];
};

export type RawLogLine = {
  readonly lineNumber: number;
  readonly line: string;
};

export type RawLogRangeResponse = {
  readonly startLine: number;
  readonly endLine: number;
  readonly lines: readonly RawLogLine[];
};

export type ApiErrorResponse = {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
};
