import type {
  ApkInfo,
  DeviceInfo,
  Issue,
  RunConfig,
  RunEvent,
  RunSummary,
} from "../../shared/contracts.js";
import type { DeviceSerial, RunId } from "../../shared/schemas.js";
import type {
  ProcessResult,
  StreamProcessOptions,
  StreamingProcess,
} from "../adb/process-runner.js";
import type { RunEventBus } from "../events/event-bus.js";

export type CoordinatorRepository = {
  readonly create: (summary: Omit<RunSummary, "id">) => Promise<RunSummary>;
  readonly writeMetadata: (summary: RunSummary) => Promise<void>;
  readonly writeIssues: (runId: RunId, issues: readonly Issue[]) => Promise<void>;
  readonly appendEvent: (runId: RunId, event: RunEvent) => Promise<void>;
  readonly appendLogcat: (runId: RunId, content: string | Uint8Array) => Promise<void>;
  readonly appendMonkey: (runId: RunId, content: string | Uint8Array) => Promise<void>;
  readonly appendInstall: (runId: RunId, content: string | Uint8Array) => Promise<void>;
};

export type RunPreparation = {
  readonly install: (apk: ApkInfo, device: DeviceInfo) => Promise<string>;
  readonly launch: (apk: ApkInfo, device: DeviceInfo) => Promise<string>;
};

export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  options?: { readonly signal?: AbortSignal },
) => Promise<ProcessResult>;

export type ProcessStreamer = (
  executable: string,
  args: readonly string[],
  options?: StreamProcessOptions,
) => StreamingProcess;

export type StartRunInput = {
  readonly device: DeviceInfo;
  readonly apk: ApkInfo;
  readonly config: RunConfig;
};

export type RunCoordinatorOptions = {
  readonly adbExecutable: string;
  readonly repository: CoordinatorRepository;
  readonly preparation: RunPreparation;
  readonly eventBus: RunEventBus;
  readonly runProcess?: ProcessRunner;
  readonly streamProcess?: ProcessStreamer;
  readonly now?: () => string;
};

export class ActiveRunError extends Error {
  override readonly name = "ActiveRunError";

  constructor(readonly runId: RunId | undefined) {
    super(runId === undefined ? "A run is already starting" : `Run ${runId} is already active`);
  }
}

export class RunPreparationError extends Error {
  override readonly name = "RunPreparationError";

  constructor(readonly stage: "clear_logcat", readonly result: ProcessResult) {
    super(`Run preparation failed during ${stage}`);
  }
}

export type SelectedDeviceSerial = DeviceSerial;
