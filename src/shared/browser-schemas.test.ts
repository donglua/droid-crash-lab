import { describe, expect, it } from "vitest";

import {
  apkTokenSchema,
  deviceSerialSchema,
  installApkRequestSchema,
  lastEventIdSchema,
  launchAppRequestSchema,
  runIdParamsSchema,
  runIdSchema,
  startRunRequestSchema,
} from "./schemas.js";

const validApkToken = "550e8400-e29b-41d4-a716-446655440000";
const validDeviceSerial = "emulator-5554";
const validRunId = "20260714T120000Z-a1b2c3";
const validMonkeyConfig = {
  mode: "monkey",
  eventCount: 500,
  throttleMs: 200,
  seed: 42,
} as const;

describe("apkTokenSchema", () => {
  it("parses a UUID APK token", () => {
    // Given
    const input = validApkToken;

    // When
    const result = apkTokenSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID APK token", () => {
    // Given
    const input = "uploaded.apk";

    // When
    const result = apkTokenSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("deviceSerialSchema", () => {
  it("parses an ADB device serial", () => {
    // Given
    const input = validDeviceSerial;

    // When
    const result = deviceSerialSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects an empty device serial", () => {
    // Given
    const input = "";

    // When
    const result = deviceSerialSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("runIdSchema", () => {
  it("parses a generated run ID", () => {
    // Given
    const input = validRunId;

    // When
    const result = runIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a path traversal as a run ID", () => {
    // Given
    const input = "../../settings.json";

    // When
    const result = runIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("installApkRequestSchema", () => {
  it("parses an APK token and device serial", () => {
    // Given
    const input = { apkToken: validApkToken, deviceSerial: validDeviceSerial };

    // When
    const result = installApkRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a browser-supplied APK path", () => {
    // Given
    const input = {
      apkToken: validApkToken,
      deviceSerial: validDeviceSerial,
      storedPath: "/tmp/untrusted.apk",
    };

    // When
    const result = installApkRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("launchAppRequestSchema", () => {
  it("parses an APK token and device serial", () => {
    // Given
    const input = { apkToken: validApkToken, deviceSerial: validDeviceSerial };

    // When
    const result = launchAppRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a browser-supplied command", () => {
    // Given
    const input = {
      apkToken: validApkToken,
      deviceSerial: validDeviceSerial,
      command: "adb shell am start",
    };

    // When
    const result = launchAppRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("startRunRequestSchema", () => {
  it("parses a manual start request", () => {
    // Given
    const input = {
      apkToken: validApkToken,
      deviceSerial: validDeviceSerial,
      config: { mode: "manual" },
    } as const;

    // When
    const result = startRunRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("parses a Monkey start request", () => {
    // Given
    const input = {
      apkToken: validApkToken,
      deviceSerial: validDeviceSerial,
      config: validMonkeyConfig,
    };

    // When
    const result = startRunRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects an unknown start option", () => {
    // Given
    const input = {
      apkToken: validApkToken,
      deviceSerial: validDeviceSerial,
      config: { mode: "manual" },
      shell: true,
    } as const;

    // When
    const result = startRunRequestSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("runIdParamsSchema", () => {
  it("parses a run route parameter", () => {
    // Given
    const input = { id: validRunId };

    // When
    const result = runIdParamsSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects an invalid run route parameter", () => {
    // Given
    const input = { id: "latest" };

    // When
    const result = runIdParamsSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects an unknown route parameter", () => {
    // Given
    const input = { id: validRunId, path: "../../settings.json" };

    // When
    const result = runIdParamsSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});

describe("lastEventIdSchema", () => {
  it("parses the initial event cursor", () => {
    // Given
    const input = "0";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success && result.data).toBe(0);
  });

  it("parses a positive event cursor", () => {
    // Given
    const input = "42";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success && result.data).toBe(42);
  });

  it("rejects a negative event cursor", () => {
    // Given
    const input = "-1";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a fractional event cursor", () => {
    // Given
    const input = "1.5";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a cursor with leading zeroes", () => {
    // Given
    const input = "0042";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects an unsafe integer event cursor", () => {
    // Given
    const input = "9007199254740992";

    // When
    const result = lastEventIdSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});
