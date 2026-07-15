import { z } from "zod";
import { DEVICE_STATES, RUN_STATES, type Issue, type RunSummary } from "../../shared/contracts.js";
import {
  apkTokenSchema,
  deviceSerialSchema,
  runConfigSchema,
  runIdSchema,
} from "../../shared/schemas.js";

const progressSchema = z.strictObject({
  completedEvents: z.number().int().nonnegative(),
  totalEvents: z.number().int().nonnegative(),
});
const runSummarySchema = z.strictObject({
  id: runIdSchema,
  state: z.enum(RUN_STATES),
  config: runConfigSchema,
  device: z.strictObject({
    serial: deviceSerialSchema,
    state: z.enum(DEVICE_STATES),
    model: z.string().optional(),
    product: z.string().optional(),
    transportId: z.string().optional(),
  }),
  apk: z.strictObject({
    token: apkTokenSchema,
    applicationId: z.string(),
    versionName: z.string(),
    versionCode: z.string(),
    storedPath: z.string(),
  }),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  issueCount: z.number().int().nonnegative(),
  monkeyProgress: progressSchema.optional(),
});
const issueBaseSchema = z.strictObject({
  id: z.string(),
  timestamp: z.string(),
  processName: z.string(),
  threadName: z.string().optional(),
  summary: z.string(),
  exceptionClass: z.string().optional(),
  topApplicationFrame: z.string().optional(),
  fingerprint: z.string(),
  occurrenceCount: z.number().int().positive(),
  occurrenceTimestamps: z.array(z.string()),
  rawLogStartLine: z.number().int().nonnegative(),
  rawLogEndLine: z.number().int().nonnegative(),
  monkeyProgress: progressSchema.optional(),
});
const issueSchema = z.discriminatedUnion("type", [
  issueBaseSchema.extend({ type: z.literal("java"), labels: z.array(z.literal("di")).optional() }),
  issueBaseSchema.extend({ type: z.enum(["anr", "native", "oom"]) }),
]);

export function parseRunSummary(value: unknown): RunSummary {
  const parsed = runSummarySchema.parse(value);
  return {
    id: parsed.id,
    state: parsed.state,
    config: parsed.config,
    device: {
      serial: parsed.device.serial,
      state: parsed.device.state,
      ...(parsed.device.model === undefined ? {} : { model: parsed.device.model }),
      ...(parsed.device.product === undefined ? {} : { product: parsed.device.product }),
      ...(parsed.device.transportId === undefined ? {} : { transportId: parsed.device.transportId }),
    },
    apk: parsed.apk,
    startedAt: parsed.startedAt,
    issueCount: parsed.issueCount,
    ...(parsed.completedAt === undefined ? {} : { completedAt: parsed.completedAt }),
    ...(parsed.monkeyProgress === undefined ? {} : { monkeyProgress: parsed.monkeyProgress }),
  };
}

export function parseIssues(value: unknown): readonly Issue[] {
  return z.array(issueSchema).parse(value).map((issue) => {
    const base = {
      id: issue.id,
      timestamp: issue.timestamp,
      processName: issue.processName,
      summary: issue.summary,
      fingerprint: issue.fingerprint,
      occurrenceCount: issue.occurrenceCount,
      occurrenceTimestamps: issue.occurrenceTimestamps,
      rawLogStartLine: issue.rawLogStartLine,
      rawLogEndLine: issue.rawLogEndLine,
      ...(issue.threadName === undefined ? {} : { threadName: issue.threadName }),
      ...(issue.exceptionClass === undefined ? {} : { exceptionClass: issue.exceptionClass }),
      ...(issue.topApplicationFrame === undefined ? {} : { topApplicationFrame: issue.topApplicationFrame }),
      ...(issue.monkeyProgress === undefined ? {} : { monkeyProgress: issue.monkeyProgress }),
    };
    return issue.type === "java"
      ? { ...base, type: "java", ...(issue.labels === undefined ? {} : { labels: issue.labels }) }
      : { ...base, type: issue.type };
  });
}

export function isInvalidMetadataError(error: unknown): boolean {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return true;
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
