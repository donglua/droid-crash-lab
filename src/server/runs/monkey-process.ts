import type { RunSummary } from "../../shared/contracts.js";
import type { StreamingProcess } from "../adb/process-runner.js";
import type { RunEventBus } from "../events/event-bus.js";
import { buildMonkeyArgs } from "./monkey-command.js";
import type {
  CoordinatorRepository,
  ProcessStreamer,
  StartRunInput,
} from "./run-coordinator-types.js";

export type MonkeyProcessState = {
  readonly process: StreamingProcess;
  readonly writes: () => Promise<void>;
};

export function startMonkeyProcess(
  adbExecutable: string,
  input: StartRunInput & { readonly config: Extract<StartRunInput["config"], { mode: "monkey" }> },
  currentSummary: () => RunSummary,
  updateSummary: (summary: RunSummary) => void,
  repository: CoordinatorRepository,
  eventBus: RunEventBus,
  streamProcess: ProcessStreamer,
): MonkeyProcessState {
  let writes = Promise.resolve();
  const onOutput = (chunk: string): void => {
    writes = writes.then(async () => {
      const summary = currentSummary();
      await repository.appendMonkey(summary.id, chunk);
      const completedEvents = parseMonkeyProgress(chunk);
      if (completedEvents === undefined) return;
      const progress = { completedEvents, totalEvents: input.config.eventCount };
      const next = { ...summary, monkeyProgress: progress };
      updateSummary(next);
      await repository.writeMetadata(next);
      const event = eventBus.publish({ type: "progress", progress });
      await repository.appendEvent(next.id, event);
    });
  };
  return {
    process: streamProcess(
      adbExecutable,
      ["-s", input.device.serial, ...buildMonkeyArgs(input.apk.applicationId, input.config)],
      { onStdout: onOutput, onStderr: onOutput },
    ),
    writes: () => writes,
  };
}

function parseMonkeyProgress(chunk: string): number | undefined {
  const match = /Events injected:\s*(\d+)/u.exec(chunk);
  if (match?.[1] === undefined) return undefined;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) ? count : undefined;
}
