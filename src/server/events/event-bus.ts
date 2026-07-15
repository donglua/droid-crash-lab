import type { RunEvent } from "../../shared/contracts.js";
import { eventIdSchema, type EventId } from "../../shared/schemas.js";

export type PendingRunEvent = RunEvent extends infer Event
  ? Event extends RunEvent
    ? Omit<Event, "id" | "timestamp">
    : never
  : never;

export type RunEventListener = (event: RunEvent) => void;

export type RunEventBusOptions = {
  readonly replayLimit: number;
  readonly now?: () => string;
};

/** Mutable event stream: listener and replay-buffer mutation are its documented purpose. */
export class RunEventBus {
  private readonly listeners = new Set<RunEventListener>();
  private readonly replay: RunEvent[] = [];
  private readonly now: () => string;
  private readonly replayLimit: number;
  private nextId = 1;
  private currentState: Extract<RunEvent, { readonly type: "state" }> | undefined;

  constructor(options: RunEventBusOptions) {
    if (!Number.isSafeInteger(options.replayLimit) || options.replayLimit < 0) {
      throw new RangeError("replayLimit must be a non-negative safe integer");
    }
    this.replayLimit = options.replayLimit;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  publish(pending: PendingRunEvent): RunEvent {
    const event = this.createEvent(pending);
    if (event.type === "state") this.currentState = event;
    if (event.type !== "log") this.remember(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: RunEventListener, afterId?: EventId): () => void {
    if (this.currentState !== undefined) listener(this.currentState);
    if (afterId !== undefined) {
      for (const event of this.replay) {
        if (event.id > afterId && event.id !== this.currentState?.id) listener(event);
      }
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private createEvent(pending: PendingRunEvent): RunEvent {
    const base = { id: eventIdSchema.parse(this.nextId), timestamp: this.now() };
    this.nextId += 1;
    switch (pending.type) {
      case "state":
        return { ...base, type: "state", state: pending.state };
      case "progress":
        return { ...base, type: "progress", progress: pending.progress };
      case "log":
        return {
          ...base,
          type: "log",
          lineNumber: pending.lineNumber,
          level: pending.level,
          line: pending.line,
        };
      case "issue":
        return { ...base, type: "issue", issue: pending.issue };
      case "device":
        return { ...base, type: "device", device: pending.device };
      case "error":
        return { ...base, type: "error", code: pending.code, message: pending.message };
      default:
        return assertNever(pending);
    }
  }

  private remember(event: RunEvent): void {
    if (this.replayLimit === 0) return;
    this.replay.push(event);
    while (this.replay.length > this.replayLimit) this.replay.shift();
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected run event: ${String(value)}`);
}
