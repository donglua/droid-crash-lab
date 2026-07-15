import type { IssueType } from "../../shared/contracts.js";

export type FingerprintFields = {
  readonly type: IssueType;
  readonly processName: string;
  readonly summary: string;
  readonly exceptionClass?: string;
  readonly topApplicationFrame?: string;
};

export function createCrashFingerprint(fields: FingerprintFields): string {
  switch (fields.type) {
    case "java":
    case "oom":
      return stableFingerprint(
        fields.type,
        [fields.exceptionClass, normalizeJavaFrame(fields.topApplicationFrame)],
        fields.summary,
      );
    case "anr":
      return ["anr", fields.processName, normalizeText(fields.summary)].join(":");
    case "native":
      return stableFingerprint(
        "native",
        [fields.exceptionClass, normalizeNativeFrame(fields.topApplicationFrame)],
        fields.summary,
      );
    default:
      return assertNever(fields.type);
  }
}

function stableFingerprint(
  type: IssueType,
  stableFields: readonly (string | undefined)[],
  fallbackSummary: string,
): string {
  const stable = stableFields.filter((field) => field !== undefined && field.length > 0);
  return stable.length > 0
    ? [type, ...stable].join(":")
    : [type, normalizeText(fallbackSummary)].join(":");
}

function normalizeJavaFrame(frame: string | undefined): string | undefined {
  return frame?.replace(/:\d+(?=\))/g, "");
}

function normalizeNativeFrame(frame: string | undefined): string | undefined {
  return frame
    ?.replace(/^#\d+\s+pc\s+(?:0x)?[0-9a-fA-F]+\s+/, "")
    .replace(/\+[0-9a-fA-Fx]+(?=\))/g, "");
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function assertNever(value: never): never {
  throw new TypeError(`Unexpected issue type: ${String(value)}`);
}
