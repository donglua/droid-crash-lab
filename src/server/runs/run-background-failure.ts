import type { RunSummary } from "../../shared/contracts.js";
import type { RunEventBus } from "../events/event-bus.js";
import type { CoordinatorRepository } from "./run-coordinator-types.js";

export async function publishRunBackgroundFailure(
  summary: RunSummary,
  error: unknown,
  eventBus: RunEventBus,
  repository: CoordinatorRepository,
): Promise<void> {
  const event = eventBus.publish({
    type: "error",
    code: "run_cleanup_failed",
    message: error instanceof Error ? error.message : String(error),
  });
  await repository.appendEvent(summary.id, event);
}
