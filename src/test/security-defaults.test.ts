import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { createDatabase, getAppSettings } from "../server/db/database";
import { getRuntimeConfig } from "../server/lib/runtime";

describe("security defaults", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-security-"));
    vi.stubEnv("GEOIP_MMDB_AUTO_UPDATE", "0");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("binds new app settings to loopback by default", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    const app = await createApp(context);

    try {
      await expect(getAppSettings(context)).resolves.toMatchObject({ bindHost: "127.0.0.1" });
    } finally {
      await app.close();
    }
  });

  it("does not allow arbitrary browser origins by default", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    const app = await createApp(context);

    try {
      const response = await app.inject({
        headers: { origin: "https://example.test" },
        method: "GET",
        url: "/api/app-settings",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("allows explicitly configured browser origins", async () => {
    vi.stubEnv("NEKOCUBE_CORS_ORIGINS", "https://console.example, https://admin.example");
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    const app = await createApp(context);

    try {
      const response = await app.inject({
        headers: { origin: "https://console.example" },
        method: "GET",
        url: "/api/app-settings",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("https://console.example");
    } finally {
      await app.close();
    }
  });

  it("supports the legacy CORS origin variable", async () => {
    vi.stubEnv("CLASH_CONFIG_CORS_ORIGINS", "https://legacy.example");
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    const app = await createApp(context);

    try {
      const response = await app.inject({
        headers: { origin: "https://legacy.example" },
        method: "GET",
        url: "/api/app-settings",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("https://legacy.example");
    } finally {
      await app.close();
    }
  });
});
