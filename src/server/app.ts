import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import { registerApkRoutes } from "./api/apk-routes.js";
import type { AppDependencies } from "./api/api-types.js";
import { registerEnvironmentRoutes } from "./api/environment-routes.js";
import { registerRunRoutes } from "./api/run-routes.js";

export type { AppDependencies } from "./api/api-types.js";

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 512 * 1024 * 1024, fields: 0, parts: 1 },
  });
  registerEnvironmentRoutes(app, dependencies);
  registerApkRoutes(app, dependencies);
  registerRunRoutes(app, dependencies);
  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "FST_INVALID_MULTIPART_CONTENT_TYPE"
    ) {
      return reply.code(400).send({
        error: { code: "INVALID_APK", message: "An APK upload is required" },
      });
    }
    throw error;
  });
  return app;
}
