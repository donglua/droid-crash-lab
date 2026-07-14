import { describe, expect, it } from "vitest";

import { runConfigSchema } from "./schemas.js";

const validMonkeyConfig = {
  mode: "monkey",
  eventCount: 500,
  throttleMs: 200,
  seed: 42,
} as const;

describe("runConfigSchema", () => {
  it("parses a Monkey run configuration when every field is valid", () => {
    // Given
    const input = validMonkeyConfig;

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("accepts the minimum event count", () => {
    // Given
    const input = { ...validMonkeyConfig, eventCount: 1 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("accepts the maximum event count", () => {
    // Given
    const input = { ...validMonkeyConfig, eventCount: 1_000_000 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects an event count below the minimum", () => {
    // Given
    const input = { ...validMonkeyConfig, eventCount: 0 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects an event count above the maximum", () => {
    // Given
    const input = { ...validMonkeyConfig, eventCount: 1_000_001 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("accepts the minimum throttle", () => {
    // Given
    const input = { ...validMonkeyConfig, throttleMs: 0 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("accepts the maximum throttle", () => {
    // Given
    const input = { ...validMonkeyConfig, throttleMs: 10_000 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a throttle below the minimum", () => {
    // Given
    const input = { ...validMonkeyConfig, throttleMs: -1 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a throttle above the maximum", () => {
    // Given
    const input = { ...validMonkeyConfig, throttleMs: 10_001 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("accepts the minimum signed 32-bit seed", () => {
    // Given
    const input = { ...validMonkeyConfig, seed: -2_147_483_648 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("accepts the maximum signed 32-bit seed", () => {
    // Given
    const input = { ...validMonkeyConfig, seed: 2_147_483_647 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects a seed below the signed 32-bit range", () => {
    // Given
    const input = { ...validMonkeyConfig, seed: -2_147_483_649 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a seed above the signed 32-bit range", () => {
    // Given
    const input = { ...validMonkeyConfig, seed: 2_147_483_648 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer seed", () => {
    // Given
    const input = { ...validMonkeyConfig, seed: 1.5 };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("parses a manual run configuration without Monkey fields", () => {
    // Given
    const input = { mode: "manual" } as const;

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(true);
  });

  it("rejects an event count in manual mode", () => {
    // Given
    const input = { mode: "manual", eventCount: 500 } as const;

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a throttle in manual mode", () => {
    // Given
    const input = { mode: "manual", throttleMs: 200 } as const;

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects a seed in manual mode", () => {
    // Given
    const input = { mode: "manual", seed: 42 } as const;

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });

  it("rejects unknown run configuration fields", () => {
    // Given
    const input = { ...validMonkeyConfig, command: "rm -rf /" };

    // When
    const result = runConfigSchema.safeParse(input);

    // Then
    expect(result.success).toBe(false);
  });
});
