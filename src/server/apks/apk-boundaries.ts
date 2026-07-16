import { z } from "zod";

import type { MetadataField } from "./apk-errors.js";

const metadataSchemas = {
  "application-id": z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u),
  "version-name": z.string().min(1).max(255).regex(/^[^\r\n]+$/u),
  "version-code": z.string().regex(/^(?:0|[1-9]\d*)$/u),
} as const satisfies Record<MetadataField, z.ZodType<string>>;

const componentPartSchema = z
  .string()
  .min(1)
  .refine((value) => !/[\p{Cc}\p{White_Space}\p{Z}]/u.test(value));

const badgingPackageSchema = z
  .string()
  .regex(/^package: /u)
  .transform((line) => ({
    applicationId: attribute(line, "name"),
    versionCode: attribute(line, "versionCode"),
    versionName: attribute(line, "versionName"),
  }))
  .pipe(z.strictObject({
    applicationId: metadataSchemas["application-id"],
    versionCode: metadataSchemas["version-code"],
    versionName: metadataSchemas["version-name"],
  }));

export type ApkMetadata = z.output<typeof badgingPackageSchema>;

export function parseMetadataOutput(
  field: MetadataField,
  output: string,
): string | undefined {
  const result = metadataSchemas[field].safeParse(output.trim());
  return result.success ? result.data : undefined;
}

export function parseLauncherComponent(output: string): string | undefined {
  const lines = output
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0);
  if (lines.length !== 1) {
    return undefined;
  }
  const line = lines[0];
  if (line === undefined) {
    return undefined;
  }
  const separator = line.indexOf("/");
  if (separator < 1) {
    return undefined;
  }
  const packageName = componentPartSchema.safeParse(line.slice(0, separator));
  const className = componentPartSchema.safeParse(line.slice(separator + 1));
  return packageName.success && className.success ? line : undefined;
}

export function parseBadgingMetadata(output: string): ApkMetadata | undefined {
  const packageLine = output.split(/\r?\n/u).find((line) => line.startsWith("package: "));
  const result = badgingPackageSchema.safeParse(packageLine);
  return result.success ? result.data : undefined;
}

function attribute(line: string, name: string): string | undefined {
  const match = new RegExp(`(?:^| )${name}='([^']*)'`, "u").exec(line);
  return match?.[1];
}
