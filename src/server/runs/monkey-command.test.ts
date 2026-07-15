import { describe, expect, it } from "vitest";
import { buildMonkeyArgs, defaultMonkeyConfig } from "./monkey-command.js";

describe("buildMonkeyArgs", () => {
  it("builds the exact safe default command arguments", () => {
    const config = defaultMonkeyConfig(new Date("2026-07-15T08:00:00.000Z"));

    expect(buildMonkeyArgs("cn.example.app", config)).toEqual([
      "shell",
      "monkey",
      "-p",
      "cn.example.app",
      "--ignore-crashes",
      "--ignore-timeouts",
      "--ignore-security-exceptions",
      "--monitor-native-crashes",
      "--pct-syskeys",
      "0",
      "--pct-appswitch",
      "0",
      "-s",
      "20260715",
      "--throttle",
      "350",
      "-v",
      "10000",
    ]);
  });

  it.each([
    { eventCount: 0, throttleMs: 350, seed: 1 },
    { eventCount: 1_000_001, throttleMs: 350, seed: 1 },
    { eventCount: 100, throttleMs: -1, seed: 1 },
    { eventCount: 100, throttleMs: 10_001, seed: 1 },
    { eventCount: 100, throttleMs: 350, seed: -2_147_483_649 },
    { eventCount: 100, throttleMs: 350, seed: 2_147_483_648 },
  ])("rejects invalid Monkey bounds: $eventCount/$throttleMs/$seed", (config) => {
    expect(() => buildMonkeyArgs("cn.example.app", { mode: "monkey", ...config })).toThrow();
  });
});
