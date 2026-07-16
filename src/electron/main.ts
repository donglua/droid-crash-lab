import { app, BrowserWindow } from "electron";
import { resolve } from "node:path";
import { buildProductionApp } from "../server/production-app.js";
import { listenProductionApp } from "../server/production-server.js";

type DesktopRuntime = {
  readonly url: URL;
  readonly shutdown: () => Promise<void>;
};

let runtime: DesktopRuntime | undefined;
let backendClosed = false;

async function startDesktop(): Promise<void> {
  await app.whenReady();
  const production = await buildProductionApp({
    webRoot: resolve(app.getAppPath(), "dist"),
  });
  const url = await listenProductionApp({ app: production.app, host: "127.0.0.1", port: 0 });
  runtime = { url, shutdown: production.shutdown };
  await createWindow(url);
}

async function createWindow(url: URL): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: "#f5f7fa",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== url.origin) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(url.href);
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && runtime !== undefined) {
    void createWindow(runtime.url).catch(handleFatalError);
  }
});

app.on("before-quit", (event) => {
  if (backendClosed || runtime === undefined) return;
  event.preventDefault();
  const closingRuntime = runtime;
  runtime = undefined;
  void closingRuntime.shutdown().then(() => {
    backendClosed = true;
    app.quit();
  }).catch(handleFatalError);
});

function handleFatalError(error: unknown): void {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  app.exit(1);
}

void startDesktop().catch(handleFatalError);
