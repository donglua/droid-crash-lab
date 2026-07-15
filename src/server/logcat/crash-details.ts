export const CRASH_KINDS = ["java", "anr", "native"] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];

export type JavaDetails = {
  readonly type: "java" | "oom";
  readonly exceptionClass?: string;
  readonly summary: string;
  readonly topApplicationFrame?: string;
  readonly isDi: boolean;
};

export type NativeDetails = {
  readonly signal?: string;
  readonly frame?: string;
};

const EXCEPTION = /^(?:Caused by:\s*)?([\w.$]+(?:Exception|Error))(?::\s*(.*))?$/;
const APPLICATION_FRAME = /\bat\s+([^\s(]+\([^)]*\))/;

export function extractJavaDetails(
  messages: readonly string[],
  applicationPackage: string,
): JavaDetails {
  let exceptionClass: string | undefined;
  let summary = "Java crash";
  let selectedExceptionIndex = -1;
  for (const [index, message] of messages.entries()) {
    const matchedClass = EXCEPTION.exec(message.trim())?.[1];
    if (matchedClass !== undefined && (exceptionClass === undefined || message.includes("Caused by:"))) {
      exceptionClass = matchedClass;
      summary = message.replace(/^Caused by:\s*/, "").trim();
      selectedExceptionIndex = index;
    }
  }
  const framePrefix = applicationPackage.length === 0 ? "cn.jingzhuan" : applicationPackage;
  const followingFrame = findApplicationFrame(messages, selectedExceptionIndex + 1, framePrefix);
  const topApplicationFrame = followingFrame ?? findApplicationFrame(messages, 0, framePrefix);
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

export function extractAnrReason(messages: readonly string[]): string | undefined {
  for (const message of messages) {
    const reason = /^Reason:\s*(.+)$/.exec(message.trim())?.[1]?.trim();
    if (reason !== undefined && reason.length > 0) return reason;
  }
  for (const message of messages) {
    const start = message.indexOf("Input dispatching timed out");
    if (start >= 0) return message.slice(start).trim();
  }
  return undefined;
}

export function extractNativeDetails(messages: readonly string[]): NativeDetails {
  const signal = findMatch(messages, /Fatal signal \d+ \(([^)]+)\)/);
  const frames = messages
    .map((message) => /^(?:tombstone:\s*)?(#\d+\s+pc\s+.+)$/.exec(message.trim())?.[1])
    .filter((frame) => frame !== undefined);
  const frame = frames.find((candidate) => candidate.includes("/data/app/")) ?? frames[0];
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(frame === undefined ? {} : { frame }),
  };
}

function findApplicationFrame(
  messages: readonly string[],
  startIndex: number,
  applicationPackage: string,
): string | undefined {
  for (let index = startIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) continue;
    const frame = APPLICATION_FRAME.exec(message)?.[1];
    if (frame !== undefined && isApplicationFrame(frame, applicationPackage)) return frame;
  }
  return undefined;
}

function isApplicationFrame(frame: string, applicationPackage: string): boolean {
  return frame === applicationPackage || frame.startsWith(`${applicationPackage}.`);
}

export function extractProcess(kind: CrashKind, messages: readonly string[]): string | undefined {
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

export function extractThreadName(messages: readonly string[]): string | undefined {
  return findMatch(messages, /FATAL EXCEPTION:\s*(.+)$/);
}

function findMatch(lines: readonly string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const value = pattern.exec(line.trim())?.[1];
    if (value !== undefined) return value.trim();
  }
  return undefined;
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected crash kind: ${String(value)}`);
}
