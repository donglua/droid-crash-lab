import type { RunState, RunSummary } from "../../shared/contracts.js";
import type { DeviceSerial } from "../../shared/schemas.js";
import {
  runProcess as defaultRunProcess,
  streamProcess as defaultStreamProcess,
  type StreamingProcess,
} from "../adb/process-runner.js";
import { startMonkeyProcess } from "./monkey-process.js";
import { publishRunBackgroundFailure } from "./run-background-failure.js";
import {
  ActiveRunError,
  type ProcessRunner,
  type ProcessStreamer,
  type RunCoordinatorOptions,
  type StartRunInput,
} from "./run-coordinator-types.js";
import { RunLogPipeline } from "./run-log-pipeline.js";
import { prepareRun } from "./run-preparation.js";
import { RunStateMachine } from "./run-state.js";

export { ActiveRunError, RunPreparationError } from "./run-coordinator-types.js";
export type {
  CoordinatorRepository,
  ProcessRunner,
  ProcessStreamer,
  RunCoordinatorOptions,
  RunPreparation,
  StartRunInput,
} from "./run-coordinator-types.js";

type ActiveRun = {
  readonly machine: RunStateMachine;
  readonly controller: AbortController;
  readonly pipeline: RunLogPipeline;
  logcat: StreamingProcess;
  monkey: StreamingProcess | undefined;
  summary: RunSummary;
  monkeyWrites: () => Promise<void>;
  cleanup: Promise<RunSummary> | undefined;
  readonly finished: Promise<RunSummary>;
  readonly resolveFinished: (summary: RunSummary) => void;
};

export class RunCoordinator {
  private readonly runProcess: ProcessRunner;
  private readonly streamProcess: ProcessStreamer;
  private readonly now: () => string;
  private active: ActiveRun | undefined;
  private lastFinished: RunSummary | undefined;
  private starting = false;

  constructor(private readonly options: RunCoordinatorOptions) {
    this.runProcess = options.runProcess ?? defaultRunProcess;
    this.streamProcess = options.streamProcess ?? defaultStreamProcess;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async start(input: StartRunInput): Promise<RunSummary> {
    if (this.starting || this.active !== undefined) {
      throw new ActiveRunError(this.active?.summary.id);
    }
    this.starting = true;
    const machine = new RunStateMachine();
    machine.transition("preparing");
    let summary = await this.options.repository.create({
      state: "preparing",
      config: input.config,
      device: input.device,
      apk: input.apk,
      startedAt: this.now(),
      issueCount: 0,
    });
    try {
      summary = await prepareRun(machine, summary, input, {
        adbExecutable: this.options.adbExecutable,
        preparation: this.options.preparation,
        repository: this.options.repository,
        runProcess: this.runProcess,
        transition: (stateMachine, current, state) =>
          this.transitionSummary(stateMachine, current, state),
      });
      const pipeline = new RunLogPipeline(
        summary.id,
        input.apk.applicationId,
        this.options.repository,
        this.options.eventBus,
      );
      const logcat = this.startLogcat(input.device.serial, pipeline);
      let resolveFinished: (summary: RunSummary) => void = () => undefined;
      const active: ActiveRun = {
        machine,
        controller: new AbortController(),
        pipeline,
        logcat,
        monkey: undefined,
        summary,
        monkeyWrites: () => Promise.resolve(),
        cleanup: undefined,
        finished: new Promise((resolve) => {
          resolveFinished = resolve;
        }),
        resolveFinished,
      };
      this.active = active;
      active.summary = await this.transition(active, "running");
      if (input.config.mode === "monkey") this.startMonkey(active, input);
      void logcat.completion
        .then(() => this.interruptIfUnexpected(active))
        .catch((error: unknown) => this.reportBackgroundFailure(active, error));
      this.starting = false;
      return active.summary;
    } catch (error) {
      if (machine.current !== "failed") machine.transition("failed");
      const failed = { ...summary, state: "failed" as const, completedAt: this.now() };
      await this.options.repository.writeMetadata(failed);
      const event = this.options.eventBus.publish({ type: "state", state: "failed" });
      await this.options.repository.appendEvent(failed.id, event);
      this.lastFinished = failed;
      this.starting = false;
      throw error;
    }
  }

  stop(): Promise<RunSummary> {
    const active = this.active;
    if (active === undefined) {
      return this.lastFinished === undefined
        ? Promise.reject(new RangeError("No run is active"))
        : Promise.resolve(this.lastFinished);
    }
    return this.finish(active, "completed");
  }

  handleDeviceDisconnect(serial: DeviceSerial): Promise<RunSummary | undefined> {
    const active = this.active;
    return active === undefined || active.summary.device.serial !== serial
      ? Promise.resolve(undefined)
      : this.finish(active, "interrupted");
  }

  async waitForIdle(): Promise<RunSummary | undefined> {
    const active = this.active;
    return active === undefined ? this.lastFinished : active.finished;
  }

  current(): RunSummary | undefined { return this.active?.summary ?? this.lastFinished; }

  private startLogcat(serial: DeviceSerial, pipeline: RunLogPipeline): StreamingProcess {
    return this.streamProcess(
      this.options.adbExecutable,
      ["-s", serial, "logcat", "-v", "threadtime", "-b", "main", "-b", "system", "-b", "crash"],
      { onStdout: (chunk) => pipeline.push(chunk), onStderr: (chunk) => pipeline.push(chunk) },
    );
  }

  private startMonkey(active: ActiveRun, input: StartRunInput): void {
    if (input.config.mode !== "monkey") return;
    const state = startMonkeyProcess(
      this.options.adbExecutable,
      { ...input, config: input.config },
      () => active.summary,
      (summary) => {
        active.summary = summary;
      },
      this.options.repository,
      this.options.eventBus,
      this.streamProcess,
    );
    active.monkey = state.process;
    active.monkeyWrites = state.writes;
    void active.monkey.completion
      .then((result) => {
        if (result.kind === "exited" && result.exitCode === 0) {
          return this.finish(active, "completed");
        }
        return this.finish(active, "interrupted");
      })
      .catch((error: unknown) => this.reportBackgroundFailure(active, error));
  }

  private finish(active: ActiveRun, terminal: "completed" | "interrupted"): Promise<RunSummary> {
    if (active.cleanup !== undefined) return active.cleanup;
    active.cleanup = this.cleanup(active, terminal);
    return active.cleanup;
  }

  private async cleanup(
    active: ActiveRun,
    terminal: "completed" | "interrupted",
  ): Promise<RunSummary> {
    if (active.machine.current === "running") await this.transition(active, "stopping");
    active.controller.abort();
    active.monkey?.stop();
    if (active.monkey !== undefined) await active.monkey.completion;
    await active.monkeyWrites();
    active.logcat.stop();
    await active.logcat.completion;
    const issues = await active.pipeline.flush();
    await this.options.repository.writeIssues(active.summary.id, issues);
    active.summary = {
      ...active.summary,
      issueCount: issues.length,
    };
    active.summary = await this.transition(active, terminal);
    this.active = undefined;
    this.lastFinished = active.summary;
    active.resolveFinished(active.summary);
    return active.summary;
  }

  private async interruptIfUnexpected(active: ActiveRun): Promise<void> {
    if (this.active === active && active.cleanup === undefined) await this.finish(active, "interrupted");
  }

  private async reportBackgroundFailure(active: ActiveRun, error: unknown): Promise<void> {
    if (this.active !== active) return;
    await publishRunBackgroundFailure(
      active.summary,
      error,
      this.options.eventBus,
      this.options.repository,
    );
    if (active.cleanup === undefined) await this.finish(active, "interrupted");
  }

  private async transition(active: ActiveRun, state: RunState): Promise<RunSummary> {
    return this.transitionSummary(active.machine, active.summary, state);
  }

  private async transitionSummary(
    machine: RunStateMachine,
    summary: RunSummary,
    state: RunState,
  ): Promise<RunSummary> {
    const result = machine.transition(state);
    if (!result.ok) throw new TypeError(`Invalid run transition to ${state}`);
    const next = {
      ...summary,
      state,
      ...(state === "completed" || state === "failed" || state === "interrupted"
        ? { completedAt: this.now() }
        : {}),
    };
    await this.options.repository.writeMetadata(next);
    const event = this.options.eventBus.publish({ type: "state", state });
    await this.options.repository.appendEvent(next.id, event);
    return next;
  }
}
