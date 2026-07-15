import { describe, expect, it } from "vitest";

import { CrashParser, type CrashParseBatch } from "./crash-parser.js";
import { LogFramer } from "./log-framer.js";

function parse(raw: string, applicationPackage = "cn.example"): CrashParseBatch {
  const parser = new CrashParser({ applicationPackage });
  const framer = new LogFramer();
  const issues = [];
  const warnings = [];
  for (const line of [...framer.push(raw), ...framer.flush()]) {
    const batch = parser.push(line);
    issues.push(...batch.issues);
    warnings.push(...batch.warnings);
  }
  const final = parser.flush();
  return { issues: [...issues, ...final.issues], warnings: [...warnings, ...final.warnings] };
}

function javaCrash(message: string, frame: string): string {
  return [
    "07-15 11:00:00.000  1200  1200 E AndroidRuntime: FATAL EXCEPTION: main",
    "07-15 11:00:00.001  1200  1200 E AndroidRuntime: Process: cn.example, PID: 1200",
    `07-15 11:00:00.002  1200  1200 E AndroidRuntime: java.lang.IllegalStateException: ${message}`,
    `07-15 11:00:00.003  1200  1200 E AndroidRuntime:     at ${frame}`,
  ].join("\n");
}

function nativeCrash(pc: string): string {
  return [
    "07-15 11:01:00.000  1201  1201 F libc: Fatal signal 11 (SIGSEGV), pid 1201 (cn.example)",
    `07-15 11:01:00.001  1300  1300 F DEBUG: #00 pc ${pc} /data/app/lib/arm64/libstock.so (render_frame+32)`,
  ].join("\n");
}

describe("CrashParser stable fingerprints", () => {
  it("ignores dynamic Java messages but distinguishes application frames", () => {
    // Given / When
    const first = parse(javaCrash("user 123 failed", "cn.example.Home.open(Home.kt:9)"));
    const second = parse(javaCrash("user 456 failed", "cn.example.Home.open(Home.kt:9)"));
    const otherFrame = parse(javaCrash("user 123 failed", "cn.example.Detail.open(Detail.kt:8)"));

    // Then
    expect(first.issues[0]?.issue.fingerprint).toBe(second.issues[0]?.issue.fingerprint);
    expect(first.issues[0]?.issue.fingerprint).not.toBe(otherFrame.issues[0]?.issue.fingerprint);
  });

  it("normalizes volatile native PC addresses while preserving module and symbol", () => {
    // Given / When
    const first = parse(nativeCrash("0000000000001234"));
    const second = parse(nativeCrash("0000000000009876"));

    // Then
    expect(first.issues[0]?.issue.fingerprint).toBe(second.issues[0]?.issue.fingerprint);
  });

  it("uses ANR process and reason as the fingerprint contract", () => {
    // Given
    const anr = (processName: string) =>
      [
        `07-15 11:02:00.000  1000  1010 E ActivityManager: ANR in ${processName}`,
        "07-15 11:02:00.001  1000  1010 E ActivityManager: Reason: executing service .SyncService",
      ].join("\n");

    // When
    const first = parse(anr("cn.example"));
    const same = parse(anr("cn.example"));
    const otherProcess = parse(anr("cn.other"));

    // Then
    expect(first.issues[0]?.issue.fingerprint).toBe(same.issues[0]?.issue.fingerprint);
    expect(first.issues[0]?.issue.fingerprint).not.toBe(otherProcess.issues[0]?.issue.fingerprint);
  });
});

describe("CrashParser field attribution", () => {
  it("pairs the deepest Java cause with its following application frame", () => {
    // Given
    const raw = [
      "07-15 11:03:00.000  1200  1200 E AndroidRuntime: FATAL EXCEPTION: main",
      "07-15 11:03:00.001  1200  1200 E AndroidRuntime: Process: cn.example, PID: 1200",
      "07-15 11:03:00.002  1200  1200 E AndroidRuntime: java.lang.RuntimeException: outer",
      "07-15 11:03:00.003  1200  1200 E AndroidRuntime:     at cn.example.Outer.run(Outer.kt:10)",
      "07-15 11:03:00.004  1200  1200 E AndroidRuntime: Caused by: java.lang.NullPointerException: inner",
      "07-15 11:03:00.005  1200  1200 E AndroidRuntime:     at cn.example.Inner.run(Inner.kt:20)",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue).toMatchObject({
      exceptionClass: "java.lang.NullPointerException",
      topApplicationFrame: "cn.example.Inner.run(Inner.kt:20)",
    });
  });

  it("requires an exact application package boundary for Java frames", () => {
    // Given
    const raw = `${javaCrash("failed", "cn.examplemalware.Bad.run(Bad.kt:1)")}\n07-15 11:00:00.004  1200  1200 E AndroidRuntime:     at cn.example.Good.run(Good.kt:2)`;

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.topApplicationFrame).toBe("cn.example.Good.run(Good.kt:2)");
  });

  it("prefers an app-owned native frame over an earlier platform frame", () => {
    // Given
    const raw = [
      "07-15 11:04:00.000  1201  1201 F libc: Fatal signal 6 (SIGABRT), pid 1201 (cn.example)",
      "07-15 11:04:00.001  1300  1300 F DEBUG: #00 pc 00001000 /apex/lib64/bionic/libc.so (abort+16)",
      "07-15 11:04:00.002  1300  1300 F DEBUG: #01 pc 00002000 /data/app/lib/arm64/libstock.so (render_frame+32)",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.topApplicationFrame).toBe(
      "#01 pc 00002000 /data/app/lib/arm64/libstock.so (render_frame+32)",
    );
  });
});

describe("CrashParser marker and timestamp boundaries", () => {
  it.each([
    "07-15 11:05:00.000  1000  1000 I ActivityManager: observed FATAL EXCEPTION during diagnostics",
    "07-15 11:05:00.000  1000  1000 I DemoTag: ANR in documentation example",
    "07-15 11:05:00.000  1000  1000 I DEBUG: ignored Fatal signal text",
  ])("ignores an ordinary timestamped record containing a crash phrase", (raw) => {
    // Given / When
    const result = parse(raw);

    // Then
    expect(result.issues).toEqual([]);
  });

  it("recovers the first valid timestamp after a standalone marker", () => {
    // Given
    const raw = [
      "FATAL EXCEPTION: main",
      "07-15 11:06:00.001  1200  1200 E AndroidRuntime: Process: cn.example, PID: 1200",
      "07-15 11:06:00.002  1200  1200 E AndroidRuntime: java.lang.IllegalStateException: failed",
      "07-15 11:06:00.003  1200  1200 E AndroidRuntime:     at cn.example.Home.open(Home.kt:9)",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.timestamp).toBe("07-15 11:06:00.001");
    expect(result.issues[0]?.issue.occurrenceTimestamps).toEqual(["07-15 11:06:00.001"]);
    expect(result.warnings.map((warning) => warning.code)).not.toContain("missing_timestamp");
  });

  it("keeps occurrence timestamps empty when no timestamp is available", () => {
    // Given
    const parser = new CrashParser({ applicationPackage: "cn.example" });
    parser.push({ lineNumber: 1, raw: "FATAL EXCEPTION: main" });

    // When
    const result = parser.flush();

    // Then
    expect(result.issues[0]?.issue.occurrenceTimestamps).toEqual([]);
  });
});
