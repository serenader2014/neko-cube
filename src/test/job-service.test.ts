import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createSource,
  createDatabase,
  createDeviceProfile,
  createCustomRule,
  createProxyGroup,
  createRuleProvider,
  exportConfigBundle,
  getAppSettings,
  getClashTarget,
  importConfigBundle,
  insertSnapshot,
  listConfigFragments,
  listCustomRules,
  listDeviceProfiles,
  listLatestSnapshotSummaries,
  listProxyGroups,
  listRuleProviders,
  listSources,
  loadCompileInput,
  seedDatabase,
  upsertConfigFragment,
  updateAppSettings,
  updateClashTarget,
  updateProxyGroup,
  updateSource,
} from "../server/db/database";
import { getRuntimeConfig } from "../server/lib/runtime";
import { configFragmentTable, customRuleTable } from "../server/db/schema";
import { createJobService } from "../server/services/job-service";

describe("job service", () => {
  let cwd: string;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-service-"));
    originalFetch = global.fetch;
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("refreshes sources and serves device subscriptions", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    await createSource(context, {
      name: "alpha",
      url: "https://mock.test/alpha.yaml",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });
    await createSource(context, {
      name: "beta",
      url: "https://mock.test/beta.yaml",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(
        `proxies:
  - name: "${url.includes("alpha") ? "香港 01" : "日本 01"}"
    type: ss
    server: ${url.includes("alpha") ? "192.0.2.1" : "198.51.100.2"}
    port: 443
    password: test
    cipher: aes-256-gcm
`,
        {
          status: 200,
          headers: { "content-type": "application/yaml" },
        },
      );
    }) as typeof fetch;

    const jobs = createJobService(context);
    const refreshResults = await jobs.refreshAllSources();
    const built = await jobs.buildConfig();
    const device = await createDeviceProfile(context, {
      name: "iphone",
      enabled: true,
      filename: "iphone.yaml",
      token: "iphone-token",
      mixedPort: 9999,
      allowLan: false,
      externalController: "127.0.0.1:9090",
      secret: "device-secret",
      mode: "Rule",
    });

    const subscription = await jobs.getSubscriptionYaml(device.token!);
    const sourceNames = (await listSources(context)).map((source) => source.name);

    expect(refreshResults.every((result) => result.status === "success")).toBe(true);
    expect(built.stats.sourceCount).toBeGreaterThan(0);
    expect(subscription?.yaml).toContain("mixed-port: 9999");
    expect(subscription?.yaml).toContain(sourceNames[0]!);
    expect(subscription?.yaml).toContain(sourceNames[1]!);
    expect(await jobs.getSubscriptionYaml("missing-token")).toBeNull();
  });

  it("loads bounded snapshot data for dashboard and compile input", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const source = await createSource(context, {
      name: "alpha",
      url: "https://mock.test/alpha.yaml",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });

    await insertSnapshot(context, {
      sourceId: source.id!,
      status: "success",
      rawYaml: "proxies: [{ name: old, type: ss }]",
      proxies: [{ name: "old", type: "ss" }],
      error: null,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    });
    await insertSnapshot(context, {
      sourceId: source.id!,
      status: "success",
      rawYaml: "proxies: [{ name: current, type: ss }]",
      proxies: [{ name: "current", type: "ss" }],
      error: null,
      fetchedAt: "2026-01-02T00:00:00.000Z",
    });
    await insertSnapshot(context, {
      sourceId: source.id!,
      status: "error",
      rawYaml: null,
      proxies: [],
      error: "network failed",
      fetchedAt: "2026-01-03T00:00:00.000Z",
    });

    const summaries = await listLatestSnapshotSummaries(context);
    const input = await loadCompileInput(context);

    expect(summaries).toEqual([
      {
        sourceId: source.id!,
        status: "error",
        fetchedAt: "2026-01-03T00:00:00.000Z",
        proxyCount: 0,
        error: "network failed",
      },
    ]);
    expect(input.snapshots).toHaveLength(1);
    expect(input.snapshots[0]?.status).toBe("success");
    expect(input.snapshots[0]?.proxies.map((proxy) => proxy.name)).toEqual(["current"]);
  });

  it("uses the configured HTTP proxy when refreshing subscription sources", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentSettings = await getAppSettings(context);
    await updateAppSettings(context, {
      ...currentSettings,
      fetchProxyUrl: "http://127.0.0.1:7890",
    });
    await createSource(context, {
      name: "alpha",
      url: "https://mock.test/alpha.yaml",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });

    const proxyFetch = vi.fn(async () =>
      new Response(
        `proxies:
  - name: "香港 01"
    type: ss
    server: 192.0.2.1
    port: 443
    password: test
    cipher: aes-256-gcm
`,
        {
          status: 200,
          headers: { "content-type": "application/yaml" },
        },
      ),
    );

    const jobs = createJobService(context, { proxyFetch });
    await jobs.refreshAllSources();

    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch.mock.calls[0]?.[1]).toMatchObject({
      dispatcher: expect.anything(),
    });
  });

  it("uses isolated local dev mode with mock subscriptions and safe apply", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    await createSource(context, {
      name: "demo-hk",
      url: "mock://demo-hk",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });
    await createSource(context, {
      name: "demo-global",
      url: "mock://demo-global",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });
    const jobs = createJobService(context);

    const refreshResults = await jobs.refreshAllSources();
    const compiled = await jobs.buildAndApplyConfig();

    expect(context.runtime.localDevMode).toBe(true);
    expect(context.runtime.devMihomoMode).toBe(false);
    expect(context.paths.dataDir.endsWith("/data/dev")).toBe(true);
    expect(refreshResults.every((result) => result.status === "success")).toBe(true);
    expect(compiled.yaml).toContain("[订阅] demo-hk");
    expect(compiled.yaml).toContain("[订阅] demo-global");
    expect(await fs.readFile(context.paths.lastSuccessfulConfigFile, "utf8")).toContain("FINAL");
  });

  it("reloads the controller without an auth header when no controller secret is configured", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentTarget = await getClashTarget(context);
    await updateClashTarget(context, {
      ...currentTarget,
      controllerUrl: "http://controller.test",
      configPath: path.join(cwd, "config.yaml"),
      secret: "",
      autoReload: true,
      restoreSelectors: true,
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);

      if (url.endsWith("/proxies")) {
        expect(headers.get("authorization")).toBeNull();
        return new Response(JSON.stringify({ proxies: { FINAL: { type: "Selector", now: "DIRECT" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("/configs")) {
        expect(headers.get("authorization")).toBeNull();
        expect(url).toContain("/configs?force=true");
        return new Response(null, { status: 204 });
      }

      if (url.includes("/proxies/")) {
        expect(headers.get("authorization")).toBeNull();
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 404 });
    });
    global.fetch = fetchMock as typeof fetch;

    const jobs = createJobService(context);
    await jobs.buildAndApplyConfig();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses the configured controller secret for reload and selector restore", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentTarget = await getClashTarget(context);
    await updateClashTarget(context, {
      ...currentTarget,
      controllerUrl: "http://controller.test",
      configPath: path.join(cwd, "config.yaml"),
      secret: "controller-secret",
      autoReload: true,
      restoreSelectors: true,
    });

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer controller-secret");

      if (String(_input).endsWith("/proxies")) {
        return new Response(JSON.stringify({ proxies: { FINAL: { type: "Selector", now: "DIRECT" } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (String(_input).includes("/configs")) {
        expect(String(_input)).toContain("/configs?force=true");
      }

      return new Response(null, { status: 204 });
    });
    global.fetch = fetchMock as typeof fetch;

    const jobs = createJobService(context);
    await jobs.buildAndApplyConfig();

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("updates proxy group source references when a source is renamed", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentSettings = await getAppSettings(context);
    await updateAppSettings(context, {
      ...currentSettings,
      finalGroupMembers: [{ kind: "sourceGroup", value: "alpha" }],
    });
    const source = await createSource(context, {
      name: "alpha",
      url: "https://mock.test/alpha.yaml",
      enabled: true,
      refreshIntervalMinutes: null,
      prefixStrategy: "source-name",
    });
    await createProxyGroup(context, {
      name: "homelab",
      type: "select",
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
      enabled: true,
      sortOrder: 10,
      members: [
        { kind: "sourceGroup", value: "alpha" },
        { kind: "special", value: "SOURCE/alpha" },
        { kind: "proxy", value: "[alpha] 香港 01" },
      ],
    });

    await updateSource(context, source.id!, {
      ...source,
      name: "beta",
    });

    const groups = await listProxyGroups(context);
    const settings = await getAppSettings(context);
    expect(groups[0]?.members).toEqual([
      { kind: "sourceGroup", value: "beta" },
      { kind: "special", value: "[订阅] beta" },
      { kind: "proxy", value: "[beta] 香港 01" },
    ]);
    expect(settings.finalGroupMembers).toEqual([{ kind: "sourceGroup", value: "beta" }]);
  });

  it("updates downstream references when a proxy group is renamed", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentSettings = await getAppSettings(context);
    await updateAppSettings(context, {
      ...currentSettings,
      finalGroupMembers: [{ kind: "group", value: "Proxy" }],
    });
    const targetGroup = await createProxyGroup(context, {
      name: "Proxy",
      type: "select",
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
      enabled: true,
      sortOrder: 10,
      members: [{ kind: "special", value: "DIRECT" }],
    });
    await createProxyGroup(context, {
      name: "Streaming",
      type: "select",
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
      enabled: true,
      sortOrder: 20,
      members: [{ kind: "group", value: "Proxy" }],
    });
    await createCustomRule(context, {
      type: "MATCH",
      target: "",
      policy: "Proxy",
      noResolve: false,
      note: "",
      enabled: true,
      sortOrder: 10,
    });
    await createRuleProvider(context, {
      name: "sample-provider",
      behavior: "classical",
      format: "yaml",
      url: "https://mock.test/rules.yaml",
      interval: 3600,
      path: "./rules/sample.yaml",
      policy: "Proxy",
      enabled: true,
      sortOrder: 20,
      mode: "structured",
      rawYaml: "",
    });
    await upsertConfigFragment(context, {
      key: "manual_proxies",
      enabled: true,
      yamlText: `- name: relay
  type: http
  server: 198.51.100.10
  port: 443
  dialer-proxy: Proxy
`,
    });

    await updateProxyGroup(context, targetGroup.id!, {
      ...targetGroup,
      name: "Gateway",
    });

    const groups = await listProxyGroups(context);
    const rules = await listCustomRules(context);
    const providers = await listRuleProviders(context);
    const settings = await getAppSettings(context);
    const fragments = await listConfigFragments(context);
    const manualFragment = fragments.find((fragment) => fragment.key === "manual_proxies");
    const manualProxies = Array.isArray(parseYaml(manualFragment?.yamlText ?? "")) ? (parseYaml(manualFragment?.yamlText ?? "") as Array<Record<string, unknown>>) : [];

    expect(groups.find((group) => group.name === "Streaming")?.members).toEqual([{ kind: "group", value: "Gateway" }]);
    expect(rules[0]?.policy).toBe("Gateway");
    expect(providers[0]?.policy).toBe("Gateway");
    expect(settings.finalGroupMembers).toEqual([{ kind: "group", value: "Gateway" }]);
    expect(manualProxies[0]?.["dialer-proxy"]).toBe("Gateway");
  });

  it("updates downstream references when a custom proxy is renamed", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const currentSettings = await getAppSettings(context);
    await updateAppSettings(context, {
      ...currentSettings,
      finalGroupMembers: [{ kind: "proxy", value: "Alpha" }],
    });
    await createProxyGroup(context, {
      name: "homelab",
      type: "select",
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
      enabled: true,
      sortOrder: 10,
      members: [{ kind: "proxy", value: "Alpha" }],
    });
    await createCustomRule(context, {
      type: "MATCH",
      target: "",
      policy: "Alpha",
      noResolve: false,
      note: "",
      enabled: true,
      sortOrder: 10,
    });
    await createRuleProvider(context, {
      name: "sample-provider",
      behavior: "classical",
      format: "yaml",
      url: "https://mock.test/rules.yaml",
      interval: 3600,
      path: "./rules/sample.yaml",
      policy: "Alpha",
      enabled: true,
      sortOrder: 20,
      mode: "structured",
      rawYaml: "",
    });
    await upsertConfigFragment(context, {
      key: "manual_proxies",
      enabled: true,
      yamlText: `- name: Alpha
  type: http
  server: 198.51.100.10
  port: 443
- name: Beta
  type: http
  server: 198.51.100.11
  port: 443
  dialer-proxy: Alpha
`,
    });

    await upsertConfigFragment(context, {
      key: "manual_proxies",
      enabled: true,
      yamlText: `- name: Alpha-2
  type: http
  server: 198.51.100.10
  port: 443
- name: Beta
  type: http
  server: 198.51.100.11
  port: 443
  dialer-proxy: Alpha
`,
    });

    const groups = await listProxyGroups(context);
    const rules = await listCustomRules(context);
    const providers = await listRuleProviders(context);
    const settings = await getAppSettings(context);
    const fragments = await listConfigFragments(context);
    const manualFragment = fragments.find((fragment) => fragment.key === "manual_proxies");
    const manualProxies = Array.isArray(parseYaml(manualFragment?.yamlText ?? "")) ? (parseYaml(manualFragment?.yamlText ?? "") as Array<Record<string, unknown>>) : [];

    expect(groups[0]?.members).toEqual([{ kind: "proxy", value: "Alpha-2" }]);
    expect(rules[0]?.policy).toBe("Alpha-2");
    expect(providers[0]?.policy).toBe("Alpha-2");
    expect(settings.finalGroupMembers).toEqual([{ kind: "proxy", value: "Alpha-2" }]);
    expect(manualProxies[1]?.["dialer-proxy"]).toBe("Alpha-2");
  });

  it("uses the dedicated dev Mihomo target for live Clash validation", async () => {
    const context = createDatabase(
      getRuntimeConfig({ LOCAL_DEV_MODE: "1", DEV_MIHOMO_MODE: "1", DEV_MIHOMO_SECRET: "test-dev-secret" }),
      cwd,
    );
    await seedDatabase(context);

    const target = await getClashTarget(context);

    expect(context.runtime.localDevMode).toBe(true);
    expect(context.runtime.devMihomoMode).toBe(true);
    expect(context.runtime.safeApplyMode).toBe(false);
    expect(target.configPath).toBe(path.join(cwd, ".dev", "mihomo", "home", "config.yaml"));
    expect(target.controllerUrl).toBe("http://127.0.0.1:9096");
    expect(target.secret).toBe("test-dev-secret");
    expect(target.autoReload).toBe(true);
    expect(target.restoreSelectors).toBe(true);
    expect(target.mixedPort).toBe(17890);
    expect(target.allowLan).toBe(false);
    expect(target.externalController).toBe("127.0.0.1:9096");
  });

  it("starts without seeded sources, custom rules, or config fragments", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);

    const sources = await listSources(context);
    const rules = await listCustomRules(context);
    const fragments = await listConfigFragments(context);

    expect(sources).toEqual([]);
    expect(rules).toEqual([]);
    expect(fragments).toEqual([]);
  });

  it("migrates legacy builtin rule fragments into the rule list", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);

    await context.db.delete(customRuleTable);
    await context.db.insert(configFragmentTable).values({
      key: "builtin_rules",
      enabled: true,
      yamlText: `- DOMAIN-SUFFIX,legacy.example,DIRECT
- MATCH,FINAL`,
    });

    await seedDatabase(context);

    const rules = await listCustomRules(context);
    const fragments = await listConfigFragments(context);

    expect(rules.some((rule) => rule.type === "DOMAIN-SUFFIX" && rule.target === "legacy.example" && rule.policy === "DIRECT")).toBe(
      true,
    );
    expect(rules.some((rule) => rule.type === "MATCH" && rule.policy === "FINAL")).toBe(true);
    expect(fragments.some((fragment) => fragment.key === "builtin_rules")).toBe(false);
  });

  it("exports and imports config bundles across isolated databases", async () => {
    const sourceContext = createDatabase(getRuntimeConfig({}), path.join(cwd, "source"));
    await seedDatabase(sourceContext);
    await createSource(sourceContext, {
      name: "alpha",
      url: "https://mock.test/alpha.yaml",
      enabled: true,
      refreshIntervalMinutes: 30,
      prefixStrategy: "source-name",
    });
    await createCustomRule(sourceContext, {
      type: "DOMAIN-SUFFIX",
      target: "example.com",
      policy: "DIRECT",
      noResolve: false,
      note: "round-trip",
      enabled: true,
      sortOrder: 10,
    });
    await createRuleProvider(sourceContext, {
      name: "sample-provider",
      behavior: "classical",
      format: "yaml",
      url: "https://mock.test/rules.yaml",
      interval: 3600,
      path: "./rules/sample.yaml",
      policy: "FINAL",
      enabled: true,
      sortOrder: 20,
      mode: "structured",
      rawYaml: "",
    });
    await createProxyGroup(sourceContext, {
      name: "homelab",
      type: "select",
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
      enabled: true,
      sortOrder: 30,
      members: [
        { kind: "special", value: "DIRECT" },
        { kind: "proxy", value: "alpha 节点" },
      ],
    });
    await upsertConfigFragment(sourceContext, {
      key: "extra",
      yamlText: "sniffer:\n  enable: true\n",
      enabled: true,
    });
    await createDeviceProfile(sourceContext, {
      name: "ipad",
      enabled: true,
      filename: "ipad.yaml",
      token: "ipad-token",
      mixedPort: 7999,
      allowLan: false,
      externalController: "127.0.0.1:9090",
      secret: "",
      mode: "Rule",
    });

    const bundle = await exportConfigBundle(sourceContext);

    const targetContext = createDatabase(getRuntimeConfig({}), path.join(cwd, "target"));
    await seedDatabase(targetContext);
    await importConfigBundle(targetContext, bundle);

    expect((await listSources(targetContext)).map((item) => item.name)).toEqual(["alpha"]);
    expect((await listCustomRules(targetContext)).map((item) => item.target)).toContain("example.com");
    expect((await listRuleProviders(targetContext)).map((item) => item.name)).toContain("sample-provider");
    expect((await listProxyGroups(targetContext)).map((item) => item.name)).toContain("homelab");
    expect((await listConfigFragments(targetContext)).map((item) => item.key)).toContain("extra");
    expect((await listDeviceProfiles(targetContext)).map((item) => item.token)).toContain("ipad-token");
  });
});
