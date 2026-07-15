import type { FastifyInstance } from "fastify";
import type { AppDependencies } from "./api-types.js";

export function registerEnvironmentRoutes(
  app: FastifyInstance,
  dependencies: AppDependencies,
): void {
  app.get("/api/health", async () => ({ status: "ok" as const }));
  app.get("/api/environment", dependencies.environment);
  app.get("/api/devices", dependencies.devices);
}
