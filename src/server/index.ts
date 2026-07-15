import { buildApp } from "./app.js";
import { DATA_ROOT, SERVER_HOST, SERVER_PORT } from "./config.js";
import { locateTool } from "./adb/tool-locator.js";
import { ApkService } from "./apks/apk-service.js";
import { DeviceService } from "./devices/device-service.js";
import { RunEventBus } from "./events/event-bus.js";
import { RunCoordinator } from "./runs/run-coordinator.js";
import { RunRepository } from "./runs/run-repository.js";
import { resolve } from "node:path";

async function main(): Promise<void> {
  const { app, shutdown } = await buildProductionApp();
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
}

export async function buildProductionApp(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const [adb, apkanalyzer] = await Promise.all([
    locateTool("adb", environment),
    locateTool("apkanalyzer", environment),
  ]);
  const dataRoot = environment["DROID_CRASH_LAB_DATA_ROOT"] ?? DATA_ROOT;
  const adbPath = adb.kind === "found" ? adb.executablePath : "adb";
  const apkanalyzerPath = apkanalyzer.kind === "found" ? apkanalyzer.executablePath : "apkanalyzer";
  const devices = new DeviceService(adbPath);
  const apks = new ApkService({ dataRoot, adbExecutable: adbPath, apkanalyzerExecutable: apkanalyzerPath });
  const repository = new RunRepository(dataRoot);
  const eventBus = new RunEventBus({ replayLimit: 256 });
  const coordinator = new RunCoordinator({
    adbExecutable: adbPath,
    repository,
    eventBus,
    preparation: {
      install: async (apk, device) => {
        const result = await apks.install(apk.token, device.serial);
        return `${result.process.stdout}${result.process.stderr}`;
      },
      launch: async (apk, device) => {
        const result = await apks.launch(apk.token, device.serial);
        return `${result.resolutionProcess.stdout}${result.resolutionProcess.stderr}${result.process.stdout}${result.process.stderr}`;
      },
    },
  });
  if (adb.kind === "found") {
    devices.onChange((event) => {
      if (event.type === "disconnect") void coordinator.handleDeviceDisconnect(event.serial);
    });
    devices.startPolling(2_000);
  }
  const app = await buildApp({
    environment: async () => ({ adb: toolStatus(adb), apkanalyzer: toolStatus(apkanalyzer) }),
    devices: async () => devices.refresh(),
    apks: {
      inspect: (filename, content) => apks.inspectUpload(filename, content),
      install: async (token, serial) => { await apks.install(token, serial); },
      launch: async (token, serial) => (await apks.launch(token, serial)).apk,
    },
    runs: {
      start: async (input) => {
        const snapshot = await devices.refresh();
        const device = snapshot.devices.find((candidate) => candidate.serial === input.deviceSerial);
        if (device === undefined) throw new RangeError("Selected device is unavailable");
        return coordinator.start({ device, apk: apks.get(input.apkToken), config: input.config });
      },
      stop: async () => coordinator.stop(),
      list: async () => (await repository.list()).flatMap((entry) => entry.kind === "readable" ? [entry.summary] : []),
      details: async (runId) => repository.details(runId).catch((error: unknown) => {
        if (error instanceof Error && error.name === "RunNotFoundError") return undefined;
        throw error;
      }),
      logRange: (runId, startLine, endLine) => repository.readLogRange(runId, startLine, endLine),
      archive: (runId) => repository.createArchive(runId),
      events: (listener, afterId) => eventBus.subscribe(listener, afterId),
    },
  }, { webRoot: resolve("dist") });
  const shutdown = async (): Promise<void> => {
    devices.stopPolling();
    if (coordinator.current()?.state === "running") await coordinator.stop();
    await app.close();
  };
  return { app, shutdown };
}

function toolStatus(result: Awaited<ReturnType<typeof locateTool>>) {
  return result.kind === "found"
    ? { available: true, path: result.executablePath, checkedLocations: [] }
    : { available: false, checkedLocations: result.checkedLocations };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
