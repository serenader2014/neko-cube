import { describe, expect, it } from "vitest";
import { DEFAULT_APP_SETTINGS, DEFAULT_CLASH_TARGET, DEFAULT_REGION_RULES } from "@shared/defaults";
import { compileClashConfig } from "@shared/compile";

describe("compileClashConfig", () => {
  it("deduplicates proxies and builds automatic groups", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [
        { id: 1, name: "alpha", url: "https://alpha.test", enabled: true, refreshIntervalMinutes: null, prefixStrategy: "source-name" },
        { id: 2, name: "beta", url: "https://beta.test", enabled: true, refreshIntervalMinutes: null, prefixStrategy: "source-name" },
      ],
      snapshots: [
        {
          sourceId: 1,
          status: "success",
          rawYaml: "",
          proxies: [
            { name: "香港 01", type: "ss", server: "192.0.2.1", port: 443, password: "a" },
            { name: "美国 01", type: "ss", server: "198.51.100.2", port: 443, password: "b" },
          ],
          error: null,
          fetchedAt: "2026-04-01T00:00:00.000Z",
        },
        {
          sourceId: 2,
          status: "success",
          rawYaml: "",
          proxies: [{ name: "香港 01", type: "ss", server: "192.0.2.1", port: 443, password: "a" }],
          error: null,
          fetchedAt: "2026-04-01T00:00:01.000Z",
        },
      ],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [{ type: "DOMAIN-SUFFIX", target: "example.com", policy: "FINAL", noResolve: false, note: "", enabled: true, sortOrder: 10 }],
      ruleProviders: [],
      proxyGroups: [],
      configFragments: [],
      deviceProfile: {
        name: "macbook",
        enabled: true,
        filename: "clash.yaml",
        token: "token-token",
        mixedPort: 9000,
        allowLan: false,
        externalController: "127.0.0.1:9090",
        secret: "device-secret",
        mode: "Global",
      },
    });

    expect(result.stats.proxyCount).toBeGreaterThanOrEqual(2);
    expect(result.yaml).toContain("name: FINAL");
    expect(result.yaml).toContain("[地区] 香港");
    expect(result.yaml).toContain("[订阅] alpha");
    expect(result.yaml).not.toContain("REGION/香港");
    expect(result.yaml).toContain("MATCH,FINAL");
    expect(result.config["proxy-groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "FINAL",
        }),
      ]),
    );
    expect(result.yaml).toContain("mixed-port: 9000");
    expect(result.yaml).toContain("[alpha] 香港 01");
    expect(result.yaml).not.toContain("[beta] 香港 01");
  });

  it("keeps manual proxies that share an endpoint but differ by name or dialer-proxy", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [
        {
          name: "家宽节点",
          type: "select",
          url: "http://cp.cloudflare.com/generate_204",
          interval: 300,
          timeout: 5000,
          enabled: true,
          sortOrder: 10,
          members: [
            { kind: "proxy", value: "HK-yecao-HGC" },
            { kind: "proxy", value: "香港家宽落地" },
          ],
        },
      ],
      configFragments: [
        {
          key: "manual_proxies",
          enabled: true,
          yamlText: `- name: HK-yecao-HGC
  type: trojan
  server: 203.0.113.39
  port: 20485
  password: same-password
- name: 香港家宽落地
  type: trojan
  server: 203.0.113.39
  port: 20485
  password: same-password
  dialer-proxy: MANUAL`,
        },
      ],
      deviceProfile: null,
    });

    const proxyNames = (result.config.proxies as Array<{ name: string }>).map((proxy) => proxy.name);
    expect(proxyNames).toContain("HK-yecao-HGC");
    expect(proxyNames).toContain("香港家宽落地");
    expect(result.config["proxy-groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "家宽节点",
          proxies: ["HK-yecao-HGC", "香港家宽落地"],
        }),
      ]),
    );
    expect(result.warnings).toEqual([]);
  });

  it("renames duplicate manual proxy names with a warning instead of dropping them", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [],
      configFragments: [
        {
          key: "manual_proxies",
          enabled: true,
          yamlText: `- name: HK
  type: ss
  server: 192.0.2.1
  port: 443
  cipher: aes-256-gcm
  password: a
- name: HK
  type: ss
  server: 198.51.100.2
  port: 443
  cipher: aes-256-gcm
  password: b`,
        },
      ],
      deviceProfile: null,
    });

    const proxyNames = (result.config.proxies as Array<{ name: string }>).map((proxy) => proxy.name);
    expect(proxyNames).toContain("HK");
    expect(proxyNames).toContain("HK #2");
    expect(result.warnings).toContain('Manual proxy "HK" renamed to "HK #2" due to duplicate name');
  });

  it("normalizes legacy REGION/ policy targets to prefixed region names", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [
        { id: 1, name: "alpha", url: "https://alpha.test", enabled: true, refreshIntervalMinutes: null, prefixStrategy: "source-name" },
      ],
      snapshots: [
        {
          sourceId: 1,
          status: "success",
          rawYaml: "",
          proxies: [{ name: "香港 01", type: "ss", server: "192.0.2.1", port: 443, password: "a" }],
          error: null,
          fetchedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [{ type: "MATCH", target: "", policy: "REGION/香港", noResolve: false, note: "", enabled: true, sortOrder: 10 }],
      ruleProviders: [],
      proxyGroups: [],
      configFragments: [],
      deviceProfile: null,
    });

    expect(result.yaml).toContain("MATCH,[地区] 香港");
    expect(result.yaml).not.toContain("MATCH,REGION/香港");
  });

  it("uses configured FINAL members instead of the built-in default order", () => {
    const result = compileClashConfig({
      appSettings: {
        ...DEFAULT_APP_SETTINGS,
        finalGroupMembers: [
          { kind: "group", value: "Proxy" },
          { kind: "special", value: "DIRECT" },
        ],
      },
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [{ id: 1, name: "alpha", url: "https://alpha.test", enabled: true, refreshIntervalMinutes: null, prefixStrategy: "source-name" }],
      snapshots: [
        {
          sourceId: 1,
          status: "success",
          rawYaml: "",
          proxies: [{ name: "香港 01", type: "ss", server: "192.0.2.1", port: 443, password: "a" }],
          error: null,
          fetchedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [
        {
          name: "Proxy",
          type: "select",
          url: "http://cp.cloudflare.com/generate_204",
          interval: 300,
          timeout: 5000,
          enabled: true,
          sortOrder: 10,
          members: [{ kind: "proxy", value: "[alpha] 香港 01" }],
        },
      ],
      configFragments: [],
      deviceProfile: null,
    });

    expect(result.config["proxy-groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "FINAL",
          proxies: ["Proxy", "DIRECT"],
        }),
      ]),
    );
  });

  it("skips stale custom group members with warnings instead of failing the whole build", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [
        {
          name: "Proxy",
          type: "select",
          url: "http://cp.cloudflare.com/generate_204",
          interval: 300,
          timeout: 5000,
          enabled: true,
          sortOrder: 10,
          members: [
            { kind: "proxy", value: "missing-node" },
            { kind: "special", value: "DIRECT" },
          ],
        },
      ],
      configFragments: [],
      deviceProfile: null,
    });

    expect(result.warnings).toContain('Proxy group "Proxy" skipped unknown member "missing-node"');
    expect(result.config["proxy-groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Proxy",
          proxies: ["DIRECT"],
        }),
      ]),
    );
  });

  it("rejects cyclic custom groups", () => {
    expect(() =>
      compileClashConfig({
        appSettings: DEFAULT_APP_SETTINGS,
        clashTarget: DEFAULT_CLASH_TARGET,
        sources: [{ id: 1, name: "alpha", url: "https://alpha.test", enabled: true, refreshIntervalMinutes: null, prefixStrategy: "source-name" }],
        snapshots: [
          {
            sourceId: 1,
            status: "success",
            rawYaml: "",
            proxies: [{ name: "香港 01", type: "ss", server: "192.0.2.1", port: 443, password: "a" }],
            error: null,
            fetchedAt: "2026-04-01T00:00:00.000Z",
          },
        ],
        regionRules: DEFAULT_REGION_RULES,
        customRules: [],
        ruleProviders: [],
        proxyGroups: [
          {
            name: "A",
            type: "select",
            url: "http://cp.cloudflare.com/generate_204",
            interval: 300,
            timeout: 5000,
            enabled: true,
            sortOrder: 1,
            members: [{ kind: "group", value: "B" }],
          },
          {
            name: "B",
            type: "select",
            url: "http://cp.cloudflare.com/generate_204",
            interval: 300,
            timeout: 5000,
            enabled: true,
            sortOrder: 2,
            members: [{ kind: "group", value: "A" }],
          },
        ],
        configFragments: [],
        deviceProfile: null,
      }),
    ).toThrow(/cycle detected/);
  });

  it("warns and recovers from stale final members, policies, and dialer-proxy references", () => {
    const result = compileClashConfig({
      appSettings: {
        ...DEFAULT_APP_SETTINGS,
        finalGroupMembers: [
          { kind: "group", value: "DeletedGroup" },
          { kind: "proxy", value: "DeletedNode" },
          { kind: "special", value: "DIRECT" },
        ],
      },
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [
        { type: "MATCH", target: "", policy: "DeletedGroup", noResolve: false, note: "", enabled: true, sortOrder: 10 },
      ],
      ruleProviders: [
        {
          name: "sample-provider",
          behavior: "classical",
          format: "yaml",
          url: "https://mock.test/rules.yaml",
          interval: 3600,
          path: "./rules/sample.yaml",
          policy: "DeletedGroup",
          enabled: true,
          sortOrder: 20,
          mode: "structured",
          rawYaml: "",
        },
      ],
      proxyGroups: [],
      configFragments: [
        {
          key: "manual_proxies",
          enabled: true,
          yamlText: `- name: chained-node
  type: ss
  server: 192.0.2.1
  port: 443
  cipher: aes-256-gcm
  password: test
  dialer-proxy: DeletedGroup`,
        },
      ],
      deviceProfile: null,
    });

    expect(result.warnings).toContain('FINAL skipped unknown member "DeletedGroup"');
    expect(result.warnings).toContain('FINAL skipped unknown member "DeletedNode"');
    expect(result.warnings).toContain('Rule "MATCH" referenced unknown target "DeletedGroup", fallback to FINAL');
    expect(result.warnings).toContain('Rule provider "sample-provider" referenced unknown target "DeletedGroup", fallback to FINAL');
    expect(result.warnings).toContain('Proxy "chained-node" skipped unknown dialer-proxy "DeletedGroup"');
    expect(result.config["proxy-groups"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "FINAL",
          proxies: ["DIRECT"],
        }),
      ]),
    );
    expect(result.yaml).toContain("MATCH,FINAL");
    expect(result.yaml).toContain("RULE-SET,sample-provider,FINAL");
    expect(result.yaml).not.toContain("dialer-proxy: DeletedGroup");
  });

  it("applies device-specific static fragment overrides on top of global fragments", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [],
      configFragments: [
        {
          key: "dns",
          enabled: true,
          yamlText: "enable: true\nlisten: 127.0.0.1:5353",
        },
      ],
      deviceProfile: {
        name: "ios",
        enabled: true,
        filename: "clash.yaml",
        token: "token-token",
        mixedPort: null,
        allowLan: null,
        externalController: null,
        secret: null,
        mode: null,
        fragmentOverrides: [
          {
            key: "dns",
            mode: "custom",
            yamlText: "enable: false\nlisten: 127.0.0.1:1053",
          },
        ],
      },
    });

    expect(result.config.dns).toEqual({
      enable: false,
      listen: "127.0.0.1:1053",
    });
    expect(result.yaml).toContain("listen: 127.0.0.1:1053");
    expect(result.yaml).not.toContain("listen: 127.0.0.1:5353");
  });

  it("can disable a global static fragment for a device subscription", () => {
    const result = compileClashConfig({
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: DEFAULT_CLASH_TARGET,
      sources: [],
      snapshots: [],
      regionRules: DEFAULT_REGION_RULES,
      customRules: [],
      ruleProviders: [],
      proxyGroups: [],
      configFragments: [
        {
          key: "profile",
          enabled: true,
          yamlText: "store-fake-ip: true",
        },
      ],
      deviceProfile: {
        name: "tv",
        enabled: true,
        filename: "clash.yaml",
        token: "token-token",
        mixedPort: null,
        allowLan: null,
        externalController: null,
        secret: null,
        mode: null,
        fragmentOverrides: [
          {
            key: "profile",
            mode: "disable",
            yamlText: "",
          },
        ],
      },
    });

    expect(result.config.profile).toBeUndefined();
    expect(result.yaml).not.toContain("store-fake-ip: true");
  });
});
