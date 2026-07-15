import type { FastifyInstance, FastifyReply } from "fastify";
import { lastEventIdSchema, runIdParamsSchema, startRunRequestSchema } from "../../shared/schemas.js";
import type { RunEvent } from "../../shared/contracts.js";
import type { AppDependencies } from "./api-types.js";

export function registerRunRoutes(app: FastifyInstance, dependencies: AppDependencies): void {
  app.post("/api/runs", async (request, reply) => {
    const parsed = startRunRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError("INVALID_REQUEST", "Invalid run request"));
    return { run: await dependencies.runs.start(parsed.data) };
  });
  app.post("/api/runs/:id/stop", async (request, reply) => {
    const params = parseRunId(request.params, reply);
    if (params === undefined) return;
    return { run: await dependencies.runs.stop(params.id) };
  });
  app.get("/api/runs", async () => ({ runs: await dependencies.runs.list() }));
  app.get("/api/runs/:id", async (request, reply) => {
    const params = parseRunId(request.params, reply);
    if (params === undefined) return;
    const details = await dependencies.runs.details(params.id);
    return details ?? reply.code(404).send(apiError("RUN_NOT_FOUND", "Run not found"));
  });
  app.get("/api/runs/:id/archive", async (request, reply) => {
    const params = parseRunId(request.params, reply);
    if (params === undefined) return;
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="droid-crash-lab-${params.id}.zip"`);
    return reply.send(await dependencies.runs.archive(params.id));
  });
  app.get("/api/runs/:id/events", async (request, reply) => {
    const params = parseRunId(request.params, reply);
    if (params === undefined) return;
    const afterId = parseLastEventId(request.headers["last-event-id"]);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    const unsubscribe = dependencies.runs.events(
      (event) => reply.raw.write(formatSse(event)),
      afterId,
    );
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);
    heartbeat.unref();
    request.raw.once("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

function parseRunId(value: unknown, reply: FastifyReply) {
  const parsed = runIdParamsSchema.safeParse(value);
  if (!parsed.success) {
    void reply.code(400).send(apiError("INVALID_RUN_ID", "Invalid run ID"));
    return undefined;
  }
  return parsed.data;
}

function parseLastEventId(value: string | string[] | undefined) {
  if (typeof value !== "string") return undefined;
  const parsed = lastEventIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function formatSse(event: RunEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function apiError(code: string, message: string) {
  return { error: { code, message } };
}
