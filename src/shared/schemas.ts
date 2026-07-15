import { z } from "zod";

const eventCountSchema = z.number().int().min(1).max(1_000_000);
const throttleMsSchema = z.number().int().min(0).max(10_000);
const seedSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/u;

function hasCanonicalUtcTimestamp(value: string): boolean {
  if (!RUN_ID_PATTERN.test(value)) {
    return false;
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(9, 11));
  const minute = Number(value.slice(11, 13));
  const second = Number(value.slice(13, 15));
  const timestamp = new Date(0);

  timestamp.setUTCFullYear(year, month - 1, day);
  timestamp.setUTCHours(hour, minute, second, 0);

  return (
    timestamp.getUTCFullYear() === year &&
    timestamp.getUTCMonth() === month - 1 &&
    timestamp.getUTCDate() === day &&
    timestamp.getUTCHours() === hour &&
    timestamp.getUTCMinutes() === minute &&
    timestamp.getUTCSeconds() === second
  );
}

const manualRunConfigSchema = z.strictObject({
  mode: z.literal("manual"),
});

const monkeyRunConfigSchema = z.strictObject({
  mode: z.literal("monkey"),
  eventCount: eventCountSchema,
  throttleMs: throttleMsSchema,
  seed: seedSchema,
});

export const runConfigSchema = z
  .discriminatedUnion("mode", [manualRunConfigSchema, monkeyRunConfigSchema])
  .readonly();

export type RunConfig = z.output<typeof runConfigSchema>;

export const apkTokenSchema = z.uuid().brand<"ApkToken">();
export type ApkToken = z.output<typeof apkTokenSchema>;

export const deviceSerialSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[!-~]+$/u)
  .brand<"DeviceSerial">();
export type DeviceSerial = z.output<typeof deviceSerialSchema>;

export const runIdSchema = z
  .string()
  .regex(RUN_ID_PATTERN)
  .refine(hasCanonicalUtcTimestamp)
  .brand<"RunId">();
export type RunId = z.output<typeof runIdSchema>;

export const eventIdSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .brand<"EventId">();
export type EventId = z.output<typeof eventIdSchema>;

export const installApkRequestSchema = z
  .strictObject({
    apkToken: apkTokenSchema,
    deviceSerial: deviceSerialSchema,
  })
  .readonly();

export const launchAppRequestSchema = z
  .strictObject({
    apkToken: apkTokenSchema,
    deviceSerial: deviceSerialSchema,
  })
  .readonly();

export const startRunRequestSchema = z
  .strictObject({
    apkToken: apkTokenSchema,
    deviceSerial: deviceSerialSchema,
    config: runConfigSchema,
  })
  .readonly();

export const runIdParamsSchema = z
  .strictObject({
    id: runIdSchema,
  })
  .readonly();

export const rawLogRangeQuerySchema = z
  .strictObject({
    startLine: z.coerce.number().int().positive(),
    endLine: z.coerce.number().int().positive(),
  })
  .refine(({ startLine, endLine }) => endLine >= startLine && endLine - startLine <= 2_000)
  .readonly();

export const lastEventIdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u)
  .transform((value) => Number(value))
  .pipe(eventIdSchema);

export type InstallApkRequest = z.output<typeof installApkRequestSchema>;
export type LaunchAppRequest = z.output<typeof launchAppRequestSchema>;
export type StartRunRequest = z.output<typeof startRunRequestSchema>;
export type RunIdParams = z.output<typeof runIdParamsSchema>;
export type RawLogRangeQuery = z.output<typeof rawLogRangeQuerySchema>;

export const environmentResponseSchema = z.strictObject({
  adb: z.strictObject({
    available: z.boolean(),
    path: z.string().optional(),
    checkedLocations: z.array(z.string()),
  }),
  apkanalyzer: z.strictObject({
    available: z.boolean(),
    path: z.string().optional(),
    checkedLocations: z.array(z.string()),
  }),
});

export const deviceInfoSchema = z.strictObject({
  serial: deviceSerialSchema,
  state: z.enum(["device", "offline", "unauthorized"]),
  model: z.string().optional(),
  product: z.string().optional(),
  transportId: z.string().optional(),
});

export const devicesResponseSchema = z.strictObject({
  devices: z.array(deviceInfoSchema),
  selectedSerial: deviceSerialSchema.optional(),
});

export const apkInfoSchema = z.strictObject({
  token: apkTokenSchema,
  applicationId: z.string(),
  versionName: z.string(),
  versionCode: z.string(),
  storedPath: z.string(),
});

export const runSummarySchema = z.strictObject({
  id: runIdSchema,
  state: z.enum(["idle", "preparing", "installing", "launching", "running", "stopping", "completed", "failed", "interrupted"]),
  config: runConfigSchema,
  device: deviceInfoSchema,
  apk: apkInfoSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  issueCount: z.number().int().nonnegative(),
  monkeyProgress: z.strictObject({ completedEvents: z.number().int().nonnegative(), totalEvents: z.number().int().nonnegative() }).optional(),
});

export const runsResponseSchema = z.strictObject({ runs: z.array(runSummarySchema) });

export const issueSchema = z.strictObject({
  id: z.string(),
  type: z.enum(["java", "anr", "native", "oom"]),
  timestamp: z.string(),
  processName: z.string(),
  threadName: z.string().optional(),
  summary: z.string(),
  exceptionClass: z.string().optional(),
  topApplicationFrame: z.string().optional(),
  fingerprint: z.string(),
  occurrenceCount: z.number().int().positive(),
  occurrenceTimestamps: z.array(z.string()),
  rawLogStartLine: z.number().int().positive(),
  rawLogEndLine: z.number().int().positive(),
  monkeyProgress: z.strictObject({ completedEvents: z.number().int().nonnegative(), totalEvents: z.number().int().nonnegative() }).optional(),
  labels: z.array(z.literal("di")).optional(),
});

export const runDetailsResponseSchema = z.strictObject({ run: runSummarySchema, issues: z.array(issueSchema) });
export const rawLogRangeResponseSchema = z.strictObject({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  lines: z.array(z.strictObject({ lineNumber: z.number().int().positive(), line: z.string() })),
});
