import type { Issue, RunEvent } from "../../shared/contracts.js";
import type { RunId } from "../../shared/schemas.js";
import { RunEventBus } from "../events/event-bus.js";
import { CrashParser } from "../logcat/crash-parser.js";
import { IssueCollector } from "../logcat/issue-collector.js";
import { LogFramer, type RawLogLine } from "../logcat/log-framer.js";

export type RunLogRepository = {
  readonly appendLogcat: (runId: RunId, content: string | Uint8Array) => Promise<void>;
  readonly appendEvent: (runId: RunId, event: RunEvent) => Promise<void>;
};

/** Serializes raw persistence before framing, parsing, deduplication, and event delivery. */
export class RunLogPipeline {
  private readonly framer = new LogFramer();
  private readonly parser: CrashParser;
  private readonly collector = new IssueCollector();
  private pending = Promise.resolve();

  constructor(
    private readonly runId: RunId,
    applicationId: string,
    private readonly repository: RunLogRepository,
    private readonly eventBus: RunEventBus,
  ) {
    this.parser = new CrashParser({ applicationPackage: applicationId });
  }

  push(chunk: string | Uint8Array): void {
    this.pending = this.pending.then(async () => {
      await this.repository.appendLogcat(this.runId, chunk);
      for (const line of this.framer.push(chunk)) await this.consume(line);
    });
  }

  async flush(): Promise<readonly Issue[]> {
    await this.pending;
    for (const line of this.framer.flush()) await this.consume(line);
    await this.consumeBatch(this.parser.flush());
    return this.collector.list();
  }

  private async consume(line: RawLogLine): Promise<void> {
    await this.publish({
      type: "log",
      lineNumber: line.lineNumber,
      level: inferLogLevel(line.raw),
      line: line.raw,
    });
    await this.consumeBatch(this.parser.push(line));
  }

  private async consumeBatch(batch: ReturnType<CrashParser["push"]>): Promise<void> {
    for (const parsed of batch.issues) {
      await this.publish({ type: "issue", issue: this.collector.add(parsed.issue) });
    }
    for (const warning of batch.warnings) {
      await this.publish({
        type: "error",
        code: warning.code,
        message: `Log line ${warning.lineNumber}: ${warning.message}`,
      });
    }
  }

  private async publish(pending: Parameters<RunEventBus["publish"]>[0]): Promise<void> {
    const event = this.eventBus.publish(pending);
    await this.repository.appendEvent(this.runId, event);
  }
}

function inferLogLevel(line: string): Extract<RunEvent, { readonly type: "log" }>["level"] {
  const match = /\s([VDIWEF])\s[^:]+:/u.exec(line);
  switch (match?.[1]) {
    case "V":
      return "verbose";
    case "D":
      return "debug";
    case "W":
      return "warn";
    case "E":
      return "error";
    case "F":
      return "fatal";
    case "I":
    default:
      return "info";
  }
}
