import type { Issue } from "../../shared/contracts.js";
import type { RawLogLine } from "./log-framer.js";

export const CRASH_KINDS = ["java", "anr", "native"] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];

export type ParseWarningCode =
  | "candidate_truncated"
  | "missing_timestamp"
  | "missing_process"
  | "missing_exception";

export type ParseWarning = {
  readonly code: ParseWarningCode;
  readonly lineNumber: number;
  readonly message: string;
};

export type ParsedCrash = {
  readonly issue: Issue;
  readonly rawLines: readonly string[];
};

export type LogRecord = {
  readonly timestamp: string;
  readonly tag: string;
  readonly message: string;
};

export type CrashCandidate = {
  readonly kind: CrashKind;
  readonly lines: readonly RawLogLine[];
  readonly truncated: boolean;
};

type JavaDetails = {
  readonly type: "java" | "oom";
  readonly exceptionClass?: string;
  readonly summary: string;
  readonly topApplicationFrame?: string;
  readonly isDi: boolean;
};

const THREADTIME_RECORD =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+\d+\s+\d+\s+[VDIWEF]\s+([^:]+):\s?(.*)$/;
const EXCEPTION = /^(?:Caused by:\s*)?([\w.$]+(?:Exception|Error))(?::\s*(.*))?$/;
const APPLICATION_FRAME = /\bat\s+([^\s(]+\([^)]*\))/;

export function parseLogRecord(raw: string): LogRecord | null {
  const match = THREADTIME_RECORD.exec(raw);
  const timestamp = match?.[1];
  const tag = match?.[2];
  const message = match?.[3];
  return timestamp === undefined || tag === undefined || message === undefined
    ? null
    : { timestamp, tag: tag.trim(), message };
}

export function detectCrashKind(raw: string): CrashKind | null {
  if (raw.includes("FATAL EXCEPTION")) return "java";
  if (raw.includes("ANR in ")) return "anr";
  if (raw.includes("Fatal signal")) return "native";
  return null;
}

export function isRelatedRecord(kind: CrashKind, tag: string): boolean {
  switch (kind) {
    case "java":
      return tag === "AndroidRuntime";
    case "anr":
      return tag === "ActivityManager" || tag === "WindowManager";
    case "native":
      return ["libc", "DEBUG", "tombstoned", "crash_dump64", "crash_dump32"].includes(tag);
    default:
      return assertNever(kind);
  }
}

export function parseCrashCandidate(
  candidate: CrashCandidate,
  applicationPackage: string,
): { readonly parsed: ParsedCrash; readonly warnings: readonly ParseWarning[] } {
  const first = candidate.lines[0];
  const last = candidate.lines[candidate.lines.length - 1];
  const startLine = first?.lineNumber ?? 0;
  const endLine = last?.lineNumber ?? startLine;
  const rawLines = candidate.lines.map((line) => line.raw);
  const records = rawLines.map(parseLogRecord);
  const timestamp = records[0]?.timestamp ?? "";
  const messages = rawLines.map((raw, index) => records[index]?.message ?? raw);
  const processName = findProcess(candidate.kind, messages) ?? "unknown";
  const warnings: ParseWarning[] = [];
  if (timestamp.length === 0) warnings.push(warning("missing_timestamp", startLine));
  if (processName === "unknown") warnings.push(warning("missing_process", startLine));
  if (candidate.truncated) warnings.push(warning("candidate_truncated", endLine));

  const issue = buildIssue({
    kind: candidate.kind,
    applicationPackage,
    messages,
    processName,
    startLine,
    endLine,
    timestamp,
    warnings,
  });
  return { parsed: { issue, rawLines }, warnings };
}

type BuildInput = {
  readonly kind: CrashKind;
  readonly applicationPackage: string;
  readonly messages: readonly string[];
  readonly processName: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly timestamp: string;
  readonly warnings: ParseWarning[];
};

function buildIssue(input: BuildInput): Issue {
  switch (input.kind) {
    case "java": {
      const details = parseJava(input.messages, input.applicationPackage);
      if (details.exceptionClass === undefined) {
        input.warnings.push(warning("missing_exception", input.startLine));
      }
      const base = issueBase(input, details);
      if (details.type === "oom") return { ...base, type: "oom" };
      return details.isDi ? { ...base, type: "java", labels: ["di"] } : { ...base, type: "java" };
    }
    case "anr": {
      const summary = input.messages.find((line) => line.includes("Input dispatching timed out"));
      return { ...issueBase(input, { summary: cleanReason(summary) ?? "ANR" }), type: "anr" };
    }
    case "native": {
      const signal = findMatch(input.messages, /Fatal signal \d+ \(([^)]+)\)/) ?? "Fatal signal";
      const frame = findMatch(input.messages, /tombstone:\s*(#\d+\s+pc\s+.+)$/);
      return {
        ...issueBase(input, {
          summary: frame === undefined ? signal : `${signal} at ${frame}`,
          exceptionClass: signal,
          ...(frame === undefined ? {} : { topApplicationFrame: frame }),
        }),
        type: "native",
      };
    }
    default:
      return assertNever(input.kind);
  }
}

type IssueDetails = {
  readonly summary: string;
  readonly exceptionClass?: string;
  readonly topApplicationFrame?: string;
};

function issueBase(input: BuildInput, details: IssueDetails): Omit<Issue, "type" | "labels"> {
  const fingerprint = [
    input.kind,
    details.exceptionClass,
    details.topApplicationFrame,
    details.summary,
  ]
    .filter((part) => part !== undefined)
    .join(":");
  return {
    id: `parsed-${input.startLine}`,
    timestamp: input.timestamp,
    processName: input.processName,
    summary: details.summary,
    fingerprint,
    occurrenceCount: 1,
    occurrenceTimestamps: [input.timestamp],
    rawLogStartLine: input.startLine,
    rawLogEndLine: input.endLine,
    ...(details.exceptionClass === undefined ? {} : { exceptionClass: details.exceptionClass }),
    ...(details.topApplicationFrame === undefined
      ? {}
      : { topApplicationFrame: details.topApplicationFrame }),
    ...threadField(input.messages),
  };
}

function parseJava(messages: readonly string[], applicationPackage: string): JavaDetails {
  let exceptionClass: string | undefined;
  let summary = "Java crash";
  for (const message of messages) {
    const match = EXCEPTION.exec(message.trim());
    const matchedClass = match?.[1];
    if (matchedClass !== undefined && (exceptionClass === undefined || message.includes("Caused by:"))) {
      exceptionClass = matchedClass;
      summary = message.replace(/^Caused by:\s*/, "").trim();
    }
  }
  const framePrefix = applicationPackage.length === 0 ? "cn.jingzhuan" : applicationPackage;
  const topApplicationFrame = messages
    .map((message) => APPLICATION_FRAME.exec(message)?.[1])
    .find((frame) => frame?.startsWith(framePrefix));
  const isDi = messages.some(
    (message) => message.includes("Unknown model class") || message.includes("No injector factory bound"),
  );
  return {
    type: exceptionClass === "java.lang.OutOfMemoryError" ? "oom" : "java",
    summary,
    isDi,
    ...(exceptionClass === undefined ? {} : { exceptionClass }),
    ...(topApplicationFrame === undefined ? {} : { topApplicationFrame }),
  };
}

function threadField(messages: readonly string[]): { readonly threadName?: string } {
  const threadName = findMatch(messages, /FATAL EXCEPTION:\s*(.+)$/);
  return threadName === undefined ? {} : { threadName };
}

function findProcess(kind: CrashKind, messages: readonly string[]): string | undefined {
  switch (kind) {
    case "java":
      return findMatch(messages, /Process:\s*([^,\s]+)/);
    case "anr":
      return findMatch(messages, /ANR in\s+([^\s]+)/);
    case "native":
      return findMatch(messages, /pid \d+ \(([^)]+)\)/) ?? findMatch(messages, /Cmdline:\s*(\S+)/);
    default:
      return assertNever(kind);
  }
}

function findMatch(lines: readonly string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const value = pattern.exec(line)?.[1];
    if (value !== undefined) return value.trim();
  }
  return undefined;
}

function cleanReason(reason: string | undefined): string | undefined {
  return reason?.replace(/^Reason:\s*/, "").trim();
}

function warning(code: ParseWarningCode, lineNumber: number): ParseWarning {
  return { code, lineNumber, message: code.replaceAll("_", " ") };
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected crash kind: ${String(value)}`);
}
