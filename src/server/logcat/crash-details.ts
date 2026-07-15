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
  for (const message of messages) {
    const matchedClass = EXCEPTION.exec(message.trim())?.[1];
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
  const frame = findMatch(messages, /^(?:tombstone:\s*)?(#\d+\s+pc\s+.+)$/);
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(frame === undefined ? {} : { frame }),
  };
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
