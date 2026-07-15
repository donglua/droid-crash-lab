import type { RunState, RunSummary } from "../../shared/contracts.js";
import type {
  CoordinatorRepository,
  ProcessRunner,
  RunCoordinatorOptions,
  StartRunInput,
} from "./run-coordinator-types.js";
import { RunPreparationError } from "./run-coordinator-types.js";
import { RunStateMachine } from "./run-state.js";

type Transition = (
  machine: RunStateMachine,
  summary: RunSummary,
  state: RunState,
) => Promise<RunSummary>;

export async function prepareRun(
  machine: RunStateMachine,
  summary: RunSummary,
  input: StartRunInput,
  dependencies: Pick<RunCoordinatorOptions, "adbExecutable" | "preparation"> & {
    readonly repository: CoordinatorRepository;
    readonly runProcess: ProcessRunner;
    readonly transition: Transition;
  },
): Promise<RunSummary> {
  let next = await dependencies.transition(machine, summary, "installing");
  await dependencies.repository.appendInstall(
    next.id,
    await dependencies.preparation.install(input.apk, input.device),
  );
  next = await dependencies.transition(machine, next, "launching");
  await dependencies.repository.appendInstall(
    next.id,
    await dependencies.preparation.launch(input.apk, input.device),
  );
  const cleared = await dependencies.runProcess(dependencies.adbExecutable, [
    "-s",
    input.device.serial,
    "logcat",
    "-c",
  ]);
  if (cleared.kind !== "exited" || cleared.exitCode !== 0) {
    throw new RunPreparationError("clear_logcat", cleared);
  }
  return next;
}
