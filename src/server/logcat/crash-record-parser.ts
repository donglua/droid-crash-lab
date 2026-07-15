import type { Issue } from "../../shared/contracts.js";
import {
  CRASH_KINDS,
  extractAnrReason,
  extractJavaDetails,
  extractNativeDetails,
  extractProcess,
  extractThreadName,
  type CrashKind,
} from "./crash-details.js";
import type { RawLogLine } from "./log-framer.js";

export { CRASH_KINDS };
export type { CrashKind };

export type ParseWarningCode =
  | "candidate_truncated"
  | "missing_timestamp"
  | "missing_process"
  | "missing_exception"
  | "missing_anr_reason"
  | "missing_native_signal"
  | "missing_native_frame";

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
  readonly processId: number;
  readonly tag: string;
  readonly message: string;
};

export type CrashCandidate = {
  readonly kind: CrashKind;
  readonly lines: readonly RawLogLine[];
  readonly truncated: boolean;
  readonly processId?: number;
};

const THREADTIME_RECORD =
  /^(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+\d+\s+[VDIWEF]\s+([^:]+):\s?(.*)$/;
const NATIVE_HELPER_TAGS = ["DEBUG", "tombstoned", "crash_dump64", "crash_dump32"] as const;

export function parseLogRecord(raw: string): LogRecord | null {
  const match = THREADTIME_RECORD.exec(raw);
  const timestamp = match?.[1];
  const processIdText = match?.[2];
  const tag = match?.[3];
  const message = match?.[4];
  if (timestamp === undefined || processIdText === undefined || tag === undefined || message === undefined) {
    return null;
  }
  const processId = Number(processIdText);
  return Number.isSafeInteger(processId) && processId >= 0
    ? { timestamp, processId, tag: tag.trim(), message }
    : null;
}

export function detectCrashKind(raw: string): CrashKind | null {
  if (raw.includes("FATAL EXCEPTION")) return "java";
  if (raw.includes("ANR in ")) return "anr";
  if (raw.includes("Fatal signal")) return "native";
  return null;
}

export function isRelatedRecord(candidate: CrashCandidate, record: LogRecord): boolean {
  let allowedTag: boolean;
  switch (candidate.kind) {
    case "java":
      allowedTag = record.tag === "AndroidRuntime";
      break;
    case "anr":
      allowedTag = record.tag === "ActivityManager" || record.tag === "WindowManager";
      break;
    case "native":
      allowedTag = ["libc", "DEBUG", "tombstoned", "crash_dump64", "crash_dump32"].includes(record.tag);
      break;
    default:
      return assertNever(candidate.kind);
  }
  const isNativeHelper =
    candidate.kind === "native" && NATIVE_HELPER_TAGS.some((tag) => tag === record.tag);
  return (
    allowedTag &&
    (isNativeHelper || candidate.processId === undefined || candidate.processId === record.processId)
  );
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
  const processName = extractProcess(candidate.kind, messages) ?? "unknown";
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
      const details = extractJavaDetails(input.messages, input.applicationPackage);
      if (details.exceptionClass === undefined) {
        input.warnings.push(warning("missing_exception", input.startLine));
      }
      const base = issueBase(input, details);
      if (details.type === "oom") return { ...base, type: "oom" };
      return details.isDi ? { ...base, type: "java", labels: ["di"] } : { ...base, type: "java" };
    }
    case "anr": {
      const reason = extractAnrReason(input.messages);
      if (reason === undefined) input.warnings.push(warning("missing_anr_reason", input.startLine));
      return { ...issueBase(input, { summary: reason ?? "ANR" }), type: "anr" };
    }
    case "native": {
      const details = extractNativeDetails(input.messages);
      if (details.signal === undefined) {
        input.warnings.push(warning("missing_native_signal", input.startLine));
      }
      if (details.frame === undefined) {
        input.warnings.push(warning("missing_native_frame", input.startLine));
      }
      const summary = nativeSummary(details);
      return {
        ...issueBase(input, {
          summary,
          ...(details.signal === undefined ? {} : { exceptionClass: details.signal }),
          ...(details.frame === undefined ? {} : { topApplicationFrame: details.frame }),
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

function threadField(messages: readonly string[]): { readonly threadName?: string } {
  const threadName = extractThreadName(messages);
  return threadName === undefined ? {} : { threadName };
}

function nativeSummary(details: { readonly signal?: string; readonly frame?: string }): string {
  if (details.signal !== undefined && details.frame !== undefined) return `${details.signal} at ${details.frame}`;
  return details.signal ?? details.frame ?? "Native crash";
}

function warning(code: ParseWarningCode, lineNumber: number): ParseWarning {
  return { code, lineNumber, message: code.replaceAll("_", " ") };
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected crash kind: ${String(value)}`);
}
