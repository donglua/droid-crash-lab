import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Issue, RunEvent, RunSummary } from "../../shared/contracts.js";
import {
  apkTokenSchema,
  deviceSerialSchema,
  eventIdSchema,
  runIdSchema,
} from "../../shared/schemas.js";
import { RunRepository } from "./run-repository.js";

function summary(id = "20260715T020304Z-a1b2c3"): RunSummary {
  return {
    id: runIdSchema.parse(id),
    state: "running",
    config: { mode: "manual" },
    device: { serial: deviceSerialSchema.parse("emulator-5554"), state: "device", model: "Pixel_9" },
    apk: {
      token: apkTokenSchema.parse("123e4567-e89b-42d3-a456-426614174000"),
      applicationId: "cn.example.app",
      versionName: "1.2.3",
      versionCode: "123",
      storedPath: "/tmp/app.apk",
    },
    startedAt: "2026-07-15T02:03:04.000Z",
    issueCount: 0,
  };
}

function issue(): Issue {
  return {
    id: "parsed-4",
    type: "anr",
    timestamp: "07-15 10:00:00.000",
    processName: "cn.example.app",
    summary: "Input dispatching timed out",
    fingerprint: "anr|cn.example.app|Input dispatching timed out",
    occurrenceCount: 1,
    occurrenceTimestamps: ["07-15 10:00:00.000"],
    rawLogStartLine: 4,
    rawLogEndLine: 12,
  };
}

async function streamBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function zipNames(buffer: Buffer): readonly string[] {
  const names: string[] = [];
  for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe("RunRepository", () => {
  it("creates a run directory with every required base file", async () => {
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-runs-"));
    const repository = new RunRepository(root, () => runIdSchema.parse("20260715T020304Z-a1b2c3"));

    const created = await repository.create(summary());

    expect(created.id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{6}$/u);
    expect(await readdir(join(root, "runs", created.id))).toEqual([
      "events.jsonl",
      "install.txt",
      "issues.json",
      "logcat.txt",
      "metadata.json",
      "monkey.txt",
    ]);
  });

  it("atomically replaces JSON and appends JSONL and raw text", async () => {
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-runs-"));
    const repository = new RunRepository(root, () => runIdSchema.parse("20260715T020304Z-a1b2c3"));
    const run = await repository.create(summary());
    const event: RunEvent = {
      id: eventIdSchema.parse(1),
      type: "state",
      timestamp: "2026-07-15T02:03:05.000Z",
      state: "running",
    };

    await repository.writeMetadata({ ...run, state: "completed", completedAt: "2026-07-15T02:04:05.000Z" });
    await repository.writeIssues(run.id, [issue()]);
    await repository.appendEvent(run.id, event);
    await repository.appendLogcat(run.id, "logcat line\n");
    await repository.appendMonkey(run.id, "monkey line\n");
    await repository.appendInstall(run.id, "install line\n");

    const directory = join(root, "runs", run.id);
    expect(JSON.parse(await readFile(join(directory, "metadata.json"), "utf8"))).toMatchObject({ state: "completed" });
    expect(JSON.parse(await readFile(join(directory, "issues.json"), "utf8"))).toEqual([issue()]);
    expect((await readFile(join(directory, "events.jsonl"), "utf8")).trim()).toBe(JSON.stringify(event));
    expect(await readFile(join(directory, "logcat.txt"), "utf8")).toBe("logcat line\n");
    expect(await readFile(join(directory, "monkey.txt"), "utf8")).toBe("monkey line\n");
    expect(await readFile(join(directory, "install.txt"), "utf8")).toBe("install line\n");
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("reloads valid history while isolating a damaged run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-runs-"));
    const generatedIds = [
      runIdSchema.parse("20260715T020304Z-a1b2c3"),
      runIdSchema.parse("20260715T030405Z-d4e5f6"),
    ];
    const repository = new RunRepository(root, () => {
      const next = generatedIds.shift();
      if (next === undefined) throw new RangeError("No generated run ID remains");
      return next;
    });
    const older = await repository.create(summary());
    const newer = await repository.create(summary());
    const brokenId = "20260715T040506Z-abcdef";
    await mkdir(join(root, "runs", brokenId), { recursive: true });
    await writeFile(join(root, "runs", brokenId, "metadata.json"), "{broken", "utf8");

    const history = await repository.list();

    expect(history).toEqual([
      { kind: "unreadable", id: runIdSchema.parse(brokenId), reason: "invalid metadata" },
      { kind: "readable", summary: newer },
      { kind: "readable", summary: older },
    ]);
  });

  it("streams a ZIP containing only files from the selected run", async () => {
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-runs-"));
    const generatedIds = [
      runIdSchema.parse("20260715T020304Z-a1b2c3"),
      runIdSchema.parse("20260715T030405Z-d4e5f6"),
    ];
    const repository = new RunRepository(root, () => {
      const next = generatedIds.shift();
      if (next === undefined) throw new RangeError("No generated run ID remains");
      return next;
    });
    const selected = await repository.create(summary());
    const sibling = await repository.create(summary());
    await repository.appendLogcat(selected.id, "selected-marker\n");
    await repository.appendLogcat(sibling.id, "sibling-secret\n");

    const archive = await streamBytes(await repository.createArchive(selected.id));

    expect([...zipNames(archive)].sort()).toEqual([
      "events.jsonl",
      "install.txt",
      "issues.json",
      "logcat.txt",
      "metadata.json",
      "monkey.txt",
    ]);
    expect(archive.includes(Buffer.from("sibling-secret"))).toBe(false);
  });
});
