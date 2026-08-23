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
      format: "yaml",
      url: "mock://rules/apple",
      interval: 3600,
      path: "",
      rawYaml: "",
      policy: "FINAL",
      enabled: true,
      sortOrder: 20,
    });
    await createRuleProvider(context, {
      name: "Invalid",
      mode: "structured",
      behavior: "classical",
      format: "yaml",
      url: "mock://rules/invalid",
      interval: 3600,
      path: "",
      rawYaml: "",
      policy: "FINAL",
      enabled: true,
      sortOrder: 30,
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
        app.inject({
          method: "GET",
          url: "/subscriptions/route-token/surge-profile.conf",
          headers: {
            host: "internal:4000",
            "x-forwarded-host": "subscriptions.example.test",
            "x-forwarded-proto": "https",
          },
        }),
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
      expect(surgeProfile.body).toContain(
        "RULE-SET,https://subscriptions.example.test/subscriptions/route-token/rules/surge/Apple.list,FINAL",
      );

      expect(quantumultXProfile.body).toContain("[server_local]");
      expect(quantumultXProfile.body).toContain("[filter_remote]");
      expect(quantumultXProfile.body).toContain(
        "http://localhost:80/subscriptions/route-token/rules/quantumult-x/Apple.list",
      );
      expect(quantumultXProfile.body).toContain("force-policy=FINAL");
      expect(quantumultXProfile.body).not.toContain("使用 YAML 格式");

      expect(loonProfile.body).toContain("[Remote Rule]");
      expect(loonProfile.body).toContain("/subscriptions/route-token/rules/loon/Apple.list");
      expect(loonProfile.body).toContain("policy=FINAL");

      expect(shadowrocketNodes.headers["content-disposition"]).toContain("shadowrocket-nodes.txt");
      expect(Buffer.from(shadowrocketNodes.body.trim(), "base64").toString("utf8")).toContain("ss://");
      expect(shadowrocketProfile.body).toContain("[Proxy Group]");
      expect(shadowrocketProfile.body).toContain("[Rule]");
      expect(shadowrocketProfile.body).toContain("/subscriptions/route-token/rules/shadowrocket/Apple.list");

      expect(legacyMihomo.body).toBe(mihomoProfile.body);
      expect(legacySurge.body).toBe(surgeNodes.body);

      expect(missing.statusCode).toBe(404);

      const [surgeRules, quantumultXRules, loonRules, shadowrocketRules, missingRules, invalidRules] = await Promise.all([
        app.inject({ method: "GET", url: "/subscriptions/route-token/rules/surge/Apple.list" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/rules/quantumult-x/Apple.list" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/rules/loon/Apple.list" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/rules/shadowrocket/Apple.list" }),
        app.inject({ method: "GET", url: "/subscriptions/missing-token/rules/surge/Apple.list" }),
        app.inject({ method: "GET", url: "/subscriptions/route-token/rules/surge/Invalid.list" }),
      ]);

      expect(surgeRules.statusCode).toBe(200);
      expect(surgeRules.headers["content-type"]).toContain("text/plain");
      expect(surgeRules.headers["x-rule-count"]).toBe("3");
      expect(surgeRules.body).toContain("DOMAIN-SUFFIX,apple.com");
      expect(surgeRules.body).toContain("IP-CIDR,192.0.2.0/24,no-resolve");
      expect(quantumultXRules.body).toContain("host-suffix,apple.com,direct");
      expect(quantumultXRules.body).toContain("ip-cidr,192.0.2.0/24,direct");
      expect(loonRules.body).toContain("DOMAIN,cdn.example.com");
      expect(shadowrocketRules.body).toContain("DOMAIN-SUFFIX,apple.com");
      expect(missingRules.statusCode).toBe(404);
      expect(invalidRules.statusCode).toBe(502);
      expect(invalidRules.body).toContain("Clash YAML 缺少 payload 数组");
    } finally {
      await app.close();
    }
  });
});
