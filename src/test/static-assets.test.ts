import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { createDatabase } from "../server/db/database";
import { getRuntimeConfig } from "../server/lib/runtime";

describe("static assets", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-static-"));
    vi.stubEnv("GEOIP_MMDB_AUTO_UPDATE", "0");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("serves bundled topojson files instead of the SPA fallback", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    const app = await createApp(context);

    try {
      const response = await app.inject({
        method: "GET",
        url: "/topojson/countries-110m.json",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.json()).toMatchObject({ type: "Topology" });
    } finally {
      await app.close();
    }
  });
});
