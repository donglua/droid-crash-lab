import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { dependencies } from "./api/environment-routes.test.js";

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("production static serving", () => {
  it("serves index fallback for browser routes without intercepting unknown APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "droid-crash-lab-dist-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>DroidCrashLab built</title>");
    const app = await buildApp(dependencies(), { webRoot: root });
    apps.push(app);

    expect((await app.inject({ method: "GET", url: "/history" })).body).toContain("DroidCrashLab built");
    const api = await app.inject({ method: "GET", url: "/api/missing" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
});
