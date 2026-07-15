import type { MonkeyRunConfig } from "../../shared/contracts.js";
import { runConfigSchema } from "../../shared/schemas.js";

export function defaultMonkeyConfig(now = new Date()): MonkeyRunConfig {
  const parsed = runConfigSchema.parse({
    mode: "monkey",
    eventCount: 10_000,
    throttleMs: 350,
    seed: Number(
      `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
        now.getUTCDate(),
      ).padStart(2, "0")}`,
    ),
  });
  if (parsed.mode !== "monkey") {
    throw new TypeError("Default Monkey config parsed as manual mode");
  }
  return parsed;
}

export function buildMonkeyArgs(
  applicationId: string,
  configInput: MonkeyRunConfig,
): readonly string[] {
  const config = runConfigSchema.parse(configInput);
  if (config.mode !== "monkey") {
    throw new TypeError("Monkey arguments require monkey mode");
  }
  return [
    "shell",
    "monkey",
    "-p",
    applicationId,
    "--ignore-crashes",
    "--ignore-timeouts",
    "--ignore-security-exceptions",
    "--monitor-native-crashes",
    "--pct-syskeys",
    "0",
    "--pct-appswitch",
    "0",
    "-s",
    String(config.seed),
    "--throttle",
    String(config.throttleMs),
    "-v",
    String(config.eventCount),
  ];
}
