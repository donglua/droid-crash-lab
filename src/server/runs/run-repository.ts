import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { z } from "zod";
import {
  DEVICE_STATES,
  RUN_STATES,
  type Issue,
  type RunEvent,
  type RunSummary,
} from "../../shared/contracts.js";
import {
  apkTokenSchema,
  deviceSerialSchema,
  runConfigSchema,
  runIdSchema,
  type RunId,
} from "../../shared/schemas.js";

const RUN_FILES = [
  "metadata.json",
  "events.jsonl",
  "logcat.txt",
  "monkey.txt",
  "install.txt",
  "issues.json",
] as const;

const deviceSchema = z.strictObject({
  serial: deviceSerialSchema,
  state: z.enum(DEVICE_STATES),
  model: z.string().optional(),
  product: z.string().optional(),
  transportId: z.string().optional(),
});

const apkSchema = z.strictObject({
  token: apkTokenSchema,
  applicationId: z.string(),
  versionName: z.string(),
  versionCode: z.string(),
  storedPath: z.string(),
});

const runSummarySchema = z.strictObject({
  id: runIdSchema,
  state: z.enum(RUN_STATES),
  config: runConfigSchema,
  device: deviceSchema,
  apk: apkSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  issueCount: z.number().int().nonnegative(),
  monkeyProgress: z
    .strictObject({
      completedEvents: z.number().int().nonnegative(),
      totalEvents: z.number().int().nonnegative(),
    })
    .optional(),
});

export type RunHistoryEntry =
  | { readonly kind: "readable"; readonly summary: RunSummary }
  | { readonly kind: "unreadable"; readonly id: RunId; readonly reason: "invalid metadata" };

export type CreateRunSummary = Omit<RunSummary, "id">;

export class RunNotFoundError extends Error {
  override readonly name = "RunNotFoundError";

  constructor(readonly runId: RunId) {
    super(`Run ${runId} does not exist`);
  }
}

export class RunRepository {
  private readonly runsRoot: string;

  constructor(
    dataRoot: string,
    private readonly generateRunId: () => RunId = createRunId,
  ) {
    this.runsRoot = join(dataRoot, "runs");
  }

  async create(input: CreateRunSummary): Promise<RunSummary> {
    await mkdir(this.runsRoot, { recursive: true });
    const summary = { ...input, id: this.generateRunId() };
    const directory = this.runDirectory(summary.id);
    await mkdir(directory);
    await Promise.all(
      RUN_FILES.map((name) =>
        name === "metadata.json"
          ? this.writeJson(join(directory, name), summary)
          : name === "issues.json"
            ? this.writeJson(join(directory, name), [])
            : writeFile(join(directory, name), "", { encoding: "utf8", flag: "wx" }),
      ),
    );
    return summary;
  }

  async writeMetadata(summary: RunSummary): Promise<void> {
    await this.assertRunExists(summary.id);
    await this.writeJson(join(this.runDirectory(summary.id), "metadata.json"), summary);
  }

  async writeIssues(runId: RunId, issues: readonly Issue[]): Promise<void> {
    await this.assertRunExists(runId);
    await this.writeJson(join(this.runDirectory(runId), "issues.json"), issues);
  }

  async appendEvent(runId: RunId, event: RunEvent): Promise<void> {
    await this.append(runId, "events.jsonl", `${JSON.stringify(event)}\n`);
  }

  async appendLogcat(runId: RunId, content: string | Uint8Array): Promise<void> {
    await this.append(runId, "logcat.txt", content);
  }

  async appendMonkey(runId: RunId, content: string | Uint8Array): Promise<void> {
    await this.append(runId, "monkey.txt", content);
  }

  async appendInstall(runId: RunId, content: string | Uint8Array): Promise<void> {
    await this.append(runId, "install.txt", content);
  }

  async list(): Promise<readonly RunHistoryEntry[]> {
    await mkdir(this.runsRoot, { recursive: true });
    const entries = await readdir(this.runsRoot, { withFileTypes: true });
    const runIds = entries
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const parsed = runIdSchema.safeParse(entry.name);
        return parsed.success ? [parsed.data] : [];
      })
      .sort((left, right) => right.localeCompare(left));
    return Promise.all(runIds.map((runId) => this.readHistoryEntry(runId)));
  }

  async createArchive(runId: RunId): Promise<Readable> {
    await this.assertRunExists(runId);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const directory = this.runDirectory(runId);
    for (const name of RUN_FILES) {
      archive.append(createReadStream(join(directory, name)), { name });
    }
    void archive.finalize();
    return archive;
  }

  private async readHistoryEntry(runId: RunId): Promise<RunHistoryEntry> {
    try {
      const raw = await readFile(join(this.runDirectory(runId), "metadata.json"), "utf8");
      return { kind: "readable", summary: parseRunSummary(JSON.parse(raw)) };
    } catch (error) {
      if (isInvalidMetadataError(error)) {
        return { kind: "unreadable", id: runId, reason: "invalid metadata" };
      }
      throw error;
    }
  }

  private async append(
    runId: RunId,
    name: (typeof RUN_FILES)[number],
    content: string | Uint8Array,
  ): Promise<void> {
    await this.assertRunExists(runId);
    await appendFile(join(this.runDirectory(runId), name), content);
  }

  private async assertRunExists(runId: RunId): Promise<void> {
    try {
      await readFile(join(this.runDirectory(runId), "metadata.json"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new RunNotFoundError(runId);
      }
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const temporaryPath = `${path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  }

  private runDirectory(runId: RunId): string {
    return join(this.runsRoot, runId);
  }
}

function createRunId(): RunId {
  const timestamp = new Date().toISOString().replaceAll(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  return runIdSchema.parse(`${timestamp}-${randomBytes(3).toString("hex")}`);
}

function parseRunSummary(value: unknown): RunSummary {
  const parsed = runSummarySchema.parse(value);
  return {
    id: parsed.id,
    state: parsed.state,
    config: parsed.config,
    device: {
      serial: parsed.device.serial,
      state: parsed.device.state,
      ...(parsed.device.model === undefined ? {} : { model: parsed.device.model }),
      ...(parsed.device.product === undefined ? {} : { product: parsed.device.product }),
      ...(parsed.device.transportId === undefined
        ? {}
        : { transportId: parsed.device.transportId }),
    },
    apk: parsed.apk,
    startedAt: parsed.startedAt,
    issueCount: parsed.issueCount,
    ...(parsed.completedAt === undefined ? {} : { completedAt: parsed.completedAt }),
    ...(parsed.monkeyProgress === undefined ? {} : { monkeyProgress: parsed.monkeyProgress }),
  };
}

function isInvalidMetadataError(error: unknown): boolean {
  if (error instanceof SyntaxError || error instanceof z.ZodError) return true;
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
