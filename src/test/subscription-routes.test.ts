import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import {
  createCustomRule,
  createDatabase,
  createDeviceProfile,
  createRuleProvider,
  createSource,
  insertSnapshot,
  seedDatabase,
} from "../server/db/database";
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
    await createCustomRule(context, {
      type: "DOMAIN-SUFFIX",
      target: "example.com",
      policy: "FINAL",
      noResolve: false,
      note: "route export test",
      enabled: true,
      sortOrder: 10,
    });
    await createRuleProvider(context, {
      name: "Apple",
      mode: "structured",
      behavior: "classical",
      format: "text",
      url: "https://rules.example.com/apple.list",
      interval: 3600,
      path: "",
      rawYaml: "",
      policy: "FINAL",
      enabled: true,
      sortOrder: 20,
    });

    const app = await createApp(context);
    try {
      const [
        mihomoNodes,
        mihomoProfile,
        surgeNodes,
        surgeProfile,
        quantumultXProfile,
        loonProfile,
        shadowrocketNodes,
        shadowrocketProfile,
        legacyMihomo,
        legacySurge,
        missing,
      ] = await Promise.all([
        app.inject({ method: "GET", url: "/subscriptions/route-token/mihomo-nodes.yaml" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/mihomo-profile.yaml" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/surge-nodes.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/surge-profile.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/quantumult-x-profile.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/loon-profile.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/shadowrocket-nodes.txt" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/shadowrocket-profile.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/mihomo.yaml" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/surge.conf" }),
        app.inject({ method: "GET", url: "/subscriptions/missing-token/surge.conf" }),
      ]);

      expect(mihomoNodes.statusCode).toBe(200);
      expect(mihomoNodes.headers["content-type"]).toContain("application/yaml");
      expect(mihomoNodes.headers["content-disposition"]).toContain("mihomo-nodes.yaml");
      expect(mihomoNodes.body).toContain("Hong Kong 01");
      expect(mihomoNodes.body).not.toContain("proxy-groups:");

      expect(mihomoProfile.statusCode).toBe(200);
      expect(mihomoProfile.headers["content-disposition"]).toContain("iphone.yaml");
      expect(mihomoProfile.body).toContain("proxy-groups:");
      expect(mihomoProfile.body).toContain("rule-providers:");

      expect(surgeNodes.statusCode).toBe(200);
      expect(surgeNodes.headers["content-type"]).toContain("text/plain");
      expect(surgeNodes.headers["cache-control"]).toBe("no-store");
      expect(surgeNodes.body).toContain("Hong Kong 01 = ss, 192.0.2.1, 443");
      expect(surgeNodes.body).not.toContain("[Rule]");

      expect(surgeProfile.body).toContain("[Proxy Group]");
      expect(surgeProfile.body).toContain("DOMAIN-SUFFIX,example.com,FINAL");
      expect(surgeProfile.body).toContain("RULE-SET,https://rules.example.com/apple.list,FINAL");

      expect(quantumultXProfile.body).toContain("[server_local]");
      expect(quantumultXProfile.body).toContain("[filter_remote]");
      expect(quantumultXProfile.body).toContain("force-policy=FINAL");

      expect(loonProfile.body).toContain("[Remote Rule]");
      expect(loonProfile.body).toContain("policy=FINAL");

      expect(shadowrocketNodes.headers["content-disposition"]).toContain("shadowrocket-nodes.txt");
      expect(Buffer.from(shadowrocketNodes.body.trim(), "base64").toString("utf8")).toContain("ss://");
      expect(shadowrocketProfile.body).toContain("[Proxy Group]");
      expect(shadowrocketProfile.body).toContain("[Rule]");

      expect(legacyMihomo.body).toBe(mihomoProfile.body);
      expect(legacySurge.body).toBe(surgeNodes.body);

      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
