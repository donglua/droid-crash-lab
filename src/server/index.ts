import { SERVER_HOST, SERVER_PORT } from "./config.js";
import { buildProductionApp } from "./production-app.js";
import { listenProductionApp } from "./production-server.js";

async function main(): Promise<void> {
  const { app, shutdown } = await buildProductionApp();
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await listenProductionApp({ app, host: SERVER_HOST, port: SERVER_PORT });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
