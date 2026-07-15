import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { registerApkRoutes } from "./api/apk-routes.js";
import type { AppDependencies } from "./api/api-types.js";
import { registerEnvironmentRoutes } from "./api/environment-routes.js";
import { registerRunRoutes } from "./api/run-routes.js";

export type { AppDependencies } from "./api/api-types.js";

export type BuildAppOptions = { readonly webRoot?: string };

export async function buildApp(
  dependencies: AppDependencies,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(multipart, {
    limits: { files: 1, fileSize: 512 * 1024 * 1024, fields: 0, parts: 1 },
  });
  registerEnvironmentRoutes(app, dependencies);
  registerApkRoutes(app, dependencies);
  registerRunRoutes(app, dependencies);
  if (options.webRoot !== undefined && (await directoryExists(options.webRoot))) {
    await app.register(fastifyStatic, { root: options.webRoot, wildcard: false });
  }
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
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
    }
    if (options.webRoot !== undefined && (request.method === "GET" || request.method === "HEAD")) {
      return reply.type("text/html").sendFile("index.html");
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  return app;
}

async function directoryExists(path: string): Promise<boolean> {
  try { await access(join(path, "index.html")); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
