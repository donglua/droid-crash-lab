import type { RawLogLine } from "./log-framer.js";
import {
  detectCrashKind,
  isRelatedRecord,
  parseCrashCandidate,
  parseLogRecord,
  type CrashCandidate,
  type CrashKind,
  type ParsedCrash,
  type ParseWarning,
} from "./crash-record-parser.js";

export type { ParsedCrash, ParseWarning, ParseWarningCode } from "./crash-record-parser.js";

export type CrashParseBatch = {
  readonly issues: readonly ParsedCrash[];
  readonly warnings: readonly ParseWarning[];
};

export type CrashParserOptions = {
  readonly applicationPackage: string;
};

const MAX_CANDIDATE_LINES = 400;
const EMPTY_BATCH: CrashParseBatch = { issues: [], warnings: [] };

/** Bounded line-oriented state machine. Deduplication belongs to the issue collector. */
export class CrashParser {
  private candidate: CrashCandidate | undefined;

  constructor(private readonly options: CrashParserOptions) {}

  push(line: RawLogLine): CrashParseBatch {
    const newKind = detectCrashKind(line.raw);
    if (this.candidate === undefined) {
      if (newKind !== null) this.start(newKind, line);
      return EMPTY_BATCH;
    }

    if (newKind !== null) {
      const completed = this.finalize(false);
      this.start(newKind, line);
      return completed;
    }

    const record = parseLogRecord(line.raw);
    if (record !== null && !isRelatedRecord(this.candidate, record)) {
      return this.finalize(false);
    }

    this.candidate = {
      ...this.candidate,
      lines: [...this.candidate.lines, line],
    };
    return this.candidate.lines.length >= MAX_CANDIDATE_LINES
      ? this.finalize(true)
      : EMPTY_BATCH;
  }

  flush(): CrashParseBatch {
    return this.candidate === undefined ? EMPTY_BATCH : this.finalize(false);
  }

  private start(kind: CrashKind, line: RawLogLine): void {
    const processId = parseLogRecord(line.raw)?.processId;
    this.candidate = {
      kind,
      lines: [line],
      truncated: false,
      ...(processId === undefined ? {} : { processId }),
    };
  }

  private finalize(truncated: boolean): CrashParseBatch {
    const current = this.candidate;
    this.candidate = undefined;
    if (current === undefined) return EMPTY_BATCH;
    const result = parseCrashCandidate({ ...current, truncated }, this.options.applicationPackage);
    return { issues: [result.parsed], warnings: result.warnings };
  }
}
