import type { CrashKind } from "./crash-details.js";
import type { RawLogLine } from "./log-framer.js";

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
  const record = parseLogRecord(raw);
  if (record !== null) return detectRecordKind(record);
  const marker = raw.trim();
  if (/^FATAL EXCEPTION(?::|$)/.test(marker)) return "java";
  if (/^ANR in\s+\S+/.test(marker)) return "anr";
  if (/^Fatal signal(?:\s|$)/.test(marker)) return "native";
  return null;
}

export function isRelatedRecord(candidate: CrashCandidate, record: LogRecord): boolean {
  const allowedTag = isAllowedTag(candidate.kind, record.tag);
  const isNativeHelper =
    candidate.kind === "native" && NATIVE_HELPER_TAGS.some((tag) => tag === record.tag);
  return (
    allowedTag &&
    (isNativeHelper || candidate.processId === undefined || candidate.processId === record.processId)
  );
}

function detectRecordKind(record: LogRecord): CrashKind | null {
  if (record.tag === "AndroidRuntime" && /^FATAL EXCEPTION(?::|$)/.test(record.message)) {
    return "java";
  }
  if (
    (record.tag === "ActivityManager" || record.tag === "WindowManager") &&
    /^ANR in\s+\S+/.test(record.message)
  ) {
    return "anr";
  }
  return record.tag === "libc" && /^Fatal signal(?:\s|$)/.test(record.message) ? "native" : null;
}

function isAllowedTag(kind: CrashKind, tag: string): boolean {
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

function assertNever(value: never): never {
  throw new TypeError(`Unexpected crash kind: ${String(value)}`);
}
