import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runProcess, streamProcess } from "./process-runner.js";

const temporaryDirectories: string[] = [];

async function fixtureScript(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "droid-crash-lab-process-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "fixture.js");
  await writeFile(path, `#!/usr/bin/env node\n${source}`, "utf8");
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runProcess", () => {
  it("preserves argument-array boundaries including spaces and metacharacters", async () => {
    // Given
    const script = await fixtureScript(
      "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
    );
    const args = ["two words", "$(touch impossible)", "; echo impossible", "*.apk"];

    // When
    const result = await runProcess(script, args);

    // Then
    expect(result.kind).toBe("exited");
    if (result.kind === "exited") {
      expect(JSON.parse(result.stdout)).toEqual(args);
    }
  });

  it("captures stdout and stderr", async () => {
    // Given
    const script = await fixtureScript(
      'process.stdout.write("out"); process.stderr.write("err");\n',
    );

    // When
    const result = await runProcess(script, []);

    // Then
    expect(result).toMatchObject({ kind: "exited", stdout: "out", stderr: "err" });
  });

  it("returns a nonzero exit result without throwing", async () => {
    // Given
    const script = await fixtureScript(
      'process.stderr.write("failed"); process.exitCode = 17;\n',
    );

    // When
    const result = await runProcess(script, []);

    // Then
    expect(result).toEqual({
      kind: "exited",
      exitCode: 17,
      stdout: "",
      stderr: "failed",
    });
  });

  it("returns a typed spawn error when the executable cannot start", async () => {
    // Given
    const missingExecutable = join(tmpdir(), "droid-crash-lab-does-not-exist");

    // When
    const result = await runProcess(missingExecutable, []);

    // Then
    expect(result.kind).toBe("spawn_error");
    if (result.kind === "spawn_error") {
      expect(result.error.name).toBe("ProcessSpawnError");
      expect(result.error.executable).toBe(missingExecutable);
    }
  });

  it("returns a signal result when the child exits by signal", async () => {
    // Given
    const script = await fixtureScript(
      'process.kill(process.pid, "SIGTERM");\n',
    );

    // When
    const result = await runProcess(script, []);

    // Then
    expect(result).toMatchObject({ kind: "signaled", signal: "SIGTERM" });
  });
});

describe("streamProcess", () => {
  it("streams stdout and stderr while retaining completion output", async () => {
    // Given
    const script = await fixtureScript(
      'process.stdout.write("first"); process.stderr.write("second");\n',
    );
    const stdout: string[] = [];
    const stderr: string[] = [];

    // When
    const handle = streamProcess(script, [], {
      onStdout: (chunk) => stdout.push(chunk),
      onStderr: (chunk) => stderr.push(chunk),
    });
    const result = await handle.completion;

    // Then
    expect(stdout.join("")).toBe("first");
    expect(stderr.join("")).toBe("second");
    expect(result).toMatchObject({ kind: "exited", stdout: "first", stderr: "second" });
  });

  it("makes stop idempotent after the first termination request", async () => {
    // Given
    const script = await fixtureScript(
      'process.on("SIGTERM", () => process.exit(0)); process.stdout.write("ready\\n"); setInterval(() => {}, 1_000);\n',
    );
    let announceReady: (() => void) | undefined;
    const ready = new Promise<void>((resolveReady) => {
      announceReady = resolveReady;
    });
    const handle = streamProcess(script, [], {
      onStdout: (chunk) => {
        if (chunk.includes("ready")) {
          announceReady?.();
        }
      },
    });
    await ready;

    // When
    const firstStop = handle.stop();
    const secondStop = handle.stop();
    const result = await handle.completion;

    // Then
    expect(firstStop).toBe(true);
    expect(secondStop).toBe(false);
    expect(result.kind).toBe("exited");
  });

  it("terminates and resolves as aborted when its AbortSignal fires", async () => {
    // Given
    const script = await fixtureScript(
      'process.stdout.write("ready\\n"); setInterval(() => {}, 1_000);\n',
    );
    const controller = new AbortController();
    let announceReady: (() => void) | undefined;
    const ready = new Promise<void>((resolveReady) => {
      announceReady = resolveReady;
    });
    const handle = streamProcess(script, [], {
      signal: controller.signal,
      onStdout: (chunk) => {
        if (chunk.includes("ready")) {
          announceReady?.();
        }
      },
    });
    await ready;

    // When
    controller.abort();
    const result = await handle.completion;

    // Then
    expect(result.kind).toBe("aborted");
  });
});
