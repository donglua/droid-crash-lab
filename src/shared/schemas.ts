import { z } from "zod";

import type { RunConfig } from "./contracts.js";

const eventCountSchema = z.number().int().min(1).max(1_000_000);
const throttleMsSchema = z.number().int().min(0).max(10_000);
const seedSchema = z.number().int().min(-2_147_483_648).max(2_147_483_647);

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
  .readonly() satisfies z.ZodType<RunConfig>;

export const apkTokenSchema = z.uuid();

export const deviceSerialSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[!-~]+$/u);

export const runIdSchema = z
  .string()
  .regex(/^\d{8}T\d{6}Z-[0-9a-f]{6}$/u);

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

export const lastEventIdSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u)
  .transform((value) => Number(value))
  .pipe(z.number().int().nonnegative().safe());

export type InstallApkRequest = z.output<typeof installApkRequestSchema>;
export type LaunchAppRequest = z.output<typeof launchAppRequestSchema>;
export type StartRunRequest = z.output<typeof startRunRequestSchema>;
export type RunIdParams = z.output<typeof runIdParamsSchema>;
