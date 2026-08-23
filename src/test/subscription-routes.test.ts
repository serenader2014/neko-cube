import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { createDatabase, createDeviceProfile, createSource, insertSnapshot, seedDatabase } from "../server/db/database";
import { getRuntimeConfig } from "../server/lib/runtime";

describe("client subscription routes", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-subscription-routes-"));
    vi.stubEnv("GEOIP_MMDB_AUTO_UPDATE", "0");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("serves all client documents from one device token", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    const source = await createSource(context, {
      name: "alpha",
      url: "https://example.com/subscription",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "none",
      sortOrder: 0,
    });
    await insertSnapshot(context, {
      sourceId: source.id!,
      status: "success",
      rawYaml: null,
      proxies: [
        {
          name: "Hong Kong 01",
          type: "ss",
          server: "192.0.2.1",
          port: 443,
          cipher: "aes-256-gcm",
          password: "test-secret",
        },
      ],
      error: null,
      fetchedAt: "2026-08-23T00:00:00.000Z",
    });
    await createDeviceProfile(context, {
      name: "iPhone",
      token: "route-token",
      enabled: true,
      filename: "iphone.yaml",
      mixedPort: null,
      allowLan: null,
      externalController: null,
      secret: null,
      mode: null,
      fragmentOverrides: [],
    });

    const app = await createApp(context);
    try {
      const [mihomo, surge, quantumultX, loon, shadowrocket, missing] = await Promise.all([
        app.inject({ method: "GET", url: "/subscriptions/route-token/mihomo.yaml" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/surge.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/quantumult-x.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/loon.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/shadowrocket.txt" }),
        app.inject({ method: "GET", url: "/subscriptions/missing-token/surge.conf" }),
      ]);

      expect(mihomo.statusCode).toBe(200);
      expect(mihomo.headers["content-type"]).toContain("application/yaml");
      expect(mihomo.headers["content-disposition"]).toContain("iphone.yaml");
      expect(mihomo.body).toContain("Hong Kong 01");

      expect(surge.statusCode).toBe(200);
      expect(surge.headers["content-type"]).toContain("text/plain");
      expect(surge.headers["cache-control"]).toBe("no-store");
      expect(surge.body).toContain("Hong Kong 01 = ss, 192.0.2.1, 443");

      expect(quantumultX.statusCode).toBe(200);
      expect(quantumultX.body).toContain("shadowsocks=192.0.2.1:443");
      expect(quantumultX.body).toContain("tag=Hong Kong 01");

      expect(loon.statusCode).toBe(200);
      expect(loon.body).toContain("Hong Kong 01 = Shadowsocks,192.0.2.1,443");

      expect(shadowrocket.statusCode).toBe(200);
      expect(shadowrocket.headers["content-disposition"]).toContain("shadowrocket.txt");
      expect(Buffer.from(shadowrocket.body.trim(), "base64").toString("utf8")).toContain("ss://");

      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
