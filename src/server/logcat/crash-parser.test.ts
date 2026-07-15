import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CrashParser, type CrashParseBatch } from "./crash-parser.js";
import { LogFramer, type RawLogLine } from "./log-framer.js";

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/logcat",
);

function fixture(name: string): string {
  return readFileSync(join(fixtureDirectory, name), "utf8");
}

function parse(raw: string): CrashParseBatch {
  const parser = new CrashParser({ applicationPackage: "cn.jingzhuan.stock" });
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

describe("CrashParser Java records", () => {
  it("extracts the deepest cause, thread, process, application frame, and raw range", () => {
    // Given / When
    const result = parse(fixture("java-crash.txt"));

    // Then
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      issue: {
        type: "java",
        threadName: "main",
        processName: "cn.jingzhuan.stock",
        exceptionClass: "java.lang.NullPointerException",
        topApplicationFrame:
          "cn.jingzhuan.stock.ui.HomeScreen.render(HomeScreen.kt:42)",
        rawLogStartLine: 1,
        rawLogEndLine: 5,
      },
    });
    expect(result.issues[0]?.rawLines).toHaveLength(5);
  });

  it("keeps DI failures as Java issues and adds the DI label", () => {
    // Given / When
    const result = parse(fixture("di-crash.txt"));

    // Then
    expect(result.issues[0]?.issue).toMatchObject({ type: "java", labels: ["di"] });
  });

  it.each(["Unknown model class DemoViewModel", "No injector factory bound for DemoScreen"])(
    "adds the DI label when the record contains only %s",
    (marker) => {
      // Given
      const raw = fixture("java-crash.txt").replace("screen failed", marker);

      // When
      const result = parse(raw);

      // Then
      expect(result.issues[0]?.issue).toMatchObject({ type: "java", labels: ["di"] });
    },
  );

  it("classifies OutOfMemoryError separately while retaining its raw Java stack", () => {
    // Given / When
    const result = parse(fixture("oom.txt"));

    // Then
    expect(result.issues[0]?.issue).toMatchObject({
      type: "oom",
      exceptionClass: "java.lang.OutOfMemoryError",
    });
    expect(result.issues[0]?.rawLines.join("\n")).toContain("ImageLoader.decode");
  });
});

describe("CrashParser Android records", () => {
  it("extracts an ANR package and input dispatch reason", () => {
    // Given / When
    const result = parse(fixture("anr.txt"));

    // Then
    expect(result.issues[0]?.issue).toMatchObject({
      type: "anr",
      processName: "cn.jingzhuan.stock",
      summary: "Input dispatching timed out (DemoActivity is not responding)",
    });
  });

  it("extracts a native signal, process, and first stable tombstone frame", () => {
    // Given / When
    const result = parse(fixture("native-crash.txt"));

    // Then
    expect(result.issues[0]?.issue).toMatchObject({
      type: "native",
      processName: "cn.jingzhuan.stock",
      exceptionClass: "SIGSEGV",
      topApplicationFrame:
        "#00 pc 0000000000012340  /data/app/lib/arm64/libstock.so (render_frame+32)",
    });
    expect(result.issues).toHaveLength(1);
    expect(result.warnings.map((warning) => warning.code)).not.toContain("missing_native_frame");
  });

  it("excludes unrelated timestamped records from the crash raw range", () => {
    // Given / When
    const result = parse(fixture("interleaved.txt"));

    // Then
    expect(result.issues[0]?.issue).toMatchObject({
      rawLogStartLine: 2,
      rawLogEndLine: 5,
    });
    expect(result.issues[0]?.rawLines).toHaveLength(4);
  });

  it("finalizes before a same-tag timestamped record from another process PID", () => {
    // Given
    const raw = [
      "07-15 10:05:00.000  1200  1200 E AndroidRuntime: FATAL EXCEPTION: main",
      "07-15 10:05:00.001  1200  1200 E AndroidRuntime: Process: cn.jingzhuan.stock, PID: 1200",
      "07-15 10:05:00.002  1200  1200 E AndroidRuntime: java.lang.IllegalStateException: failed",
      "07-15 10:05:00.003  1200  1200 E AndroidRuntime:     at cn.jingzhuan.stock.Home.open(Home.kt:9)",
      "07-15 10:05:01.000  1300  1300 I AndroidRuntime: unrelated process startup",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.rawLogEndLine).toBe(4);
    expect(result.issues[0]?.rawLines).toHaveLength(4);
  });

  it("uses any nonempty ANR Reason content as the summary", () => {
    // Given
    const raw = [
      "07-15 10:06:00.000  1000  1010 E ActivityManager: ANR in cn.example",
      "07-15 10:06:00.001  1000  1010 E ActivityManager: Reason: executing service cn.example/.SyncService",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.summary).toBe("executing service cn.example/.SyncService");
  });

  it("warns when an ANR candidate has no recognized nonempty reason", () => {
    // Given / When
    const result = parse("07-15 10:06:00.000  1000  1010 E ActivityManager: ANR in cn.example\n");

    // Then
    expect(result.warnings.map((warning) => warning.code)).toContain("missing_anr_reason");
  });

  it("extracts a standard native DEBUG frame without a tombstone prefix", () => {
    // Given
    const raw = [
      "07-15 10:07:00.000  1203  1203 F libc: Fatal signal 11 (SIGSEGV), code 1 in pid 1203 (cn.example)",
      "07-15 10:07:00.001  1203  1203 F DEBUG: #00 pc 0000000000001234 /data/app/libexample.so (render+16)",
    ].join("\n");

    // When
    const result = parse(raw);

    // Then
    expect(result.issues[0]?.issue.topApplicationFrame).toBe(
      "#00 pc 0000000000001234 /data/app/libexample.so (render+16)",
    );
  });

  it("warns separately when a native candidate lacks a signal and stable frame", () => {
    // Given
    const parser = new CrashParser({ applicationPackage: "cn.example" });
    parser.push({ lineNumber: 3, raw: "Fatal signal" });

    // When
    const result = parser.flush();

    // Then
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "missing_timestamp",
      "missing_process",
      "missing_native_signal",
      "missing_native_frame",
    ]);
  });
});

describe("CrashParser streaming boundaries", () => {
  it("accepts candidates delivered line by line after arbitrary byte chunking", () => {
    // Given
    const bytes = new TextEncoder().encode(fixture("chunked-java-crash.txt"));
    const framer = new LogFramer();
    const parser = new CrashParser({ applicationPackage: "cn.jingzhuan.stock" });
    const lines: RawLogLine[] = [];
    const splitPoints = [17, 63, 119, bytes.length] as const;
    let start = 0;

    // When
    for (const end of splitPoints) {
      lines.push(...framer.push(bytes.slice(start, end)));
      start = end;
    }
    lines.push(...framer.flush());
    for (const line of lines) parser.push(line);
    const result = parser.flush();

    // Then
    expect(result.issues[0]?.issue.exceptionClass).toBe("java.lang.NullPointerException");
  });

  it("returns parse warnings for incomplete records instead of throwing", () => {
    // Given
    const parser = new CrashParser({ applicationPackage: "cn.jingzhuan.stock" });
    parser.push({ lineNumber: 7, raw: "FATAL EXCEPTION:" });

    // When
    const result = parser.flush();

    // Then
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "missing_timestamp",
      "missing_process",
      "missing_exception",
    ]);
    expect(result.issues[0]?.issue.rawLogStartLine).toBe(7);
  });

  it("bounds a candidate to 400 raw lines", () => {
    // Given
    const parser = new CrashParser({ applicationPackage: "cn.jingzhuan.stock" });
    parser.push({ lineNumber: 1, raw: "FATAL EXCEPTION: main" });

    // When
    let result: CrashParseBatch = { issues: [], warnings: [] };
    for (let lineNumber = 2; lineNumber <= 400; lineNumber += 1) {
      result = parser.push({ lineNumber, raw: `continuation ${lineNumber}` });
    }

    // Then
    expect(result.issues[0]?.issue.rawLogEndLine).toBe(400);
    expect(result.warnings.some((warning) => warning.code === "candidate_truncated")).toBe(true);
  });
});
