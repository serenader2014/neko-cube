import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, seedDatabase } from "../server/db/database";
import { getAnalyticsRuleFlowSqlite, getAnalyticsSummarySqlite, listAnalyticsRegionsSqlite } from "../server/db/telemetry-db";
import { getRuntimeConfig } from "../server/lib/runtime";
import { ClickHouseService } from "../server/services/clickhouse-service";
import { GeoIpService } from "../server/services/geoip-service";
import { RealtimeAnalyticsStore } from "../server/services/realtime-analytics-store";
import { TrafficAggregator } from "../server/services/traffic-aggregator";

describe("traffic aggregator", () => {
  let cwd: string;
  let originalGeoLookupProvider: string | undefined;
  let originalGeoMmdbDisabled: string | undefined;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-telemetry-"));
    originalGeoLookupProvider = process.env.GEOIP_LOOKUP_PROVIDER;
    originalGeoMmdbDisabled = process.env.GEOIP_MMDB_DISABLED;
    process.env.GEOIP_LOOKUP_PROVIDER = "local";
    process.env.GEOIP_MMDB_DISABLED = "1";
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (originalGeoLookupProvider === undefined) {
      delete process.env.GEOIP_LOOKUP_PROVIDER;
    } else {
      process.env.GEOIP_LOOKUP_PROVIDER = originalGeoLookupProvider;
    }
    if (originalGeoMmdbDisabled === undefined) {
      delete process.env.GEOIP_MMDB_DISABLED;
    } else {
      process.env.GEOIP_MMDB_DISABLED = originalGeoMmdbDisabled;
    }
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("tracks connection deltas without double counting and isolates target keys", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:15:00.000Z"));
    try {
      const context = createDatabase(getRuntimeConfig({}), cwd);
      await seedDatabase(context);
      const store = new RealtimeAnalyticsStore();
      const aggregator = new TrafficAggregator(context, store, new GeoIpService(undefined), new ClickHouseService({}));
      aggregator.setEnabled(true);
      aggregator.setTargetKey("alpha");

      aggregator.onConnections({
        uploadTotal: 100,
        downloadTotal: 200,
        connections: [
          {
            id: "conn-1",
            upload: 100,
            download: 200,
            chains: ["HK-01"],
            rule: "MATCH",
            rulePayload: "",
            start: "2026-04-09T00:00:00.000Z",
            metadata: {
              network: "tcp",
              type: "http",
              destinationIP: "192.0.2.1",
              destinationPort: "443",
              dnsMode: "",
              host: "example.com",
              inboundIP: "",
              inboundName: "",
              inboundPort: "",
              inboundUser: "",
              process: "",
              processPath: "",
              remoteDestination: "",
              sniffHost: "",
              sourceIP: "192.168.0.2",
              sourcePort: "50000",
              specialProxy: "",
              specialRules: "",
              uid: 0,
            },
          },
        ],
      });
      aggregator.onConnections({
        uploadTotal: 150,
        downloadTotal: 260,
        connections: [
          {
            id: "conn-1",
            upload: 150,
            download: 260,
            chains: ["HK-01"],
            rule: "MATCH",
            rulePayload: "",
            start: "2026-04-09T00:00:00.000Z",
            metadata: {
              network: "tcp",
              type: "http",
              destinationIP: "192.0.2.1",
              destinationPort: "443",
              dnsMode: "",
              host: "example.com",
              inboundIP: "",
              inboundName: "",
              inboundPort: "",
              inboundUser: "",
              process: "",
              processPath: "",
              remoteDestination: "",
              sniffHost: "",
              sourceIP: "192.168.0.2",
              sourcePort: "50000",
              specialProxy: "",
              specialRules: "",
              uid: 0,
            },
          },
        ],
      });
      aggregator.onConnections({
        uploadTotal: 150,
        downloadTotal: 260,
        connections: [],
      });
      await aggregator.flush();

      const range = {
        start: "2026-04-08T00:00:00.000Z",
        end: "2026-04-10T00:00:00.000Z",
      };
      const alphaSummary = await getAnalyticsSummarySqlite(context, "alpha", range, "sqlite", 0);
      expect(alphaSummary.uploadBytes).toBe(150);
      expect(alphaSummary.downloadBytes).toBe(260);
      expect(alphaSummary.connectionCount).toBe(1);

      aggregator.setTargetKey("beta");
      aggregator.onConnections({
        uploadTotal: 20,
        downloadTotal: 30,
        connections: [
          {
            id: "conn-2",
            upload: 20,
            download: 30,
            chains: ["US-01"],
            rule: "MATCH",
            rulePayload: "",
            start: "2026-04-09T00:10:00.000Z",
            metadata: {
              network: "tcp",
              type: "http",
              destinationIP: "198.51.100.2",
              destinationPort: "443",
              dnsMode: "",
              host: "beta.example",
              inboundIP: "",
              inboundName: "",
              inboundPort: "",
              inboundUser: "",
              process: "",
              processPath: "",
              remoteDestination: "",
              sniffHost: "",
              sourceIP: "192.168.0.4",
              sourcePort: "51000",
              specialProxy: "",
              specialRules: "",
              uid: 0,
            },
          },
        ],
      });
      await aggregator.flush();

      const betaSummary = await getAnalyticsSummarySqlite(context, "beta", range, "sqlite", 0);
      expect(betaSummary.uploadBytes).toBe(20);
      expect(betaSummary.downloadBytes).toBe(30);

      const alphaSummaryAgain = await getAnalyticsSummarySqlite(context, "alpha", range, "sqlite", 0);
      expect(alphaSummaryAgain.uploadBytes).toBe(150);
      expect(alphaSummaryAgain.downloadBytes).toBe(260);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries buffered writes after a sqlite flush failure instead of orphaning pending records", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);

    const originalBatch = context.sqlite.batch.bind(context.sqlite);
    let attempts = 0;
    context.sqlite.batch = vi.fn(async (...args: Parameters<typeof context.sqlite.batch>) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("sqlite unavailable");
      }
      return originalBatch(...args);
    });

    const store = new RealtimeAnalyticsStore();
    const aggregator = new TrafficAggregator(context, store, new GeoIpService(undefined), new ClickHouseService({}));
    aggregator.setEnabled(true);
    aggregator.setTargetKey("alpha");

    aggregator.onConnections({
      uploadTotal: 100,
      downloadTotal: 200,
      connections: [
        {
          id: "conn-1",
          upload: 100,
          download: 200,
          chains: ["HK-01"],
          rule: "MATCH",
          rulePayload: "",
          start: "2026-04-09T00:00:00.000Z",
          metadata: {
            network: "tcp",
            type: "http",
            destinationIP: "192.0.2.1",
            destinationPort: "443",
            dnsMode: "",
            host: "example.com",
            inboundIP: "",
            inboundName: "",
            inboundPort: "",
            inboundUser: "",
            process: "",
            processPath: "",
            remoteDestination: "",
            sniffHost: "",
            sourceIP: "192.168.0.2",
            sourcePort: "50000",
            specialProxy: "",
            specialRules: "",
            uid: 0,
          },
        },
      ],
    });

    await expect(aggregator.flush()).rejects.toThrow("sqlite unavailable");
    await aggregator.flush();

    const summary = await getAnalyticsSummarySqlite(
      context,
      "alpha",
      {
        start: "2026-04-08T00:00:00.000Z",
        end: "2026-04-10T00:00:00.000Z",
      },
      "sqlite",
      0,
    );

    expect(summary.uploadBytes).toBe(100);
    expect(summary.downloadBytes).toBe(200);
    expect(summary.connectionCount).toBe(1);
  });

  it("falls back to proxy chain region when GeoIP has no database or destination IP is only in remoteDestination", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const store = new RealtimeAnalyticsStore();
    const aggregator = new TrafficAggregator(context, store, new GeoIpService(undefined), new ClickHouseService({}));
    aggregator.setEnabled(true);
    aggregator.setTargetKey("alpha");

    aggregator.onConnections({
      uploadTotal: 10,
      downloadTotal: 20,
      connections: [
        {
          id: "conn-us",
          upload: 10,
          download: 20,
          chains: ["美国DMIT", "美国家宽中转"],
          rule: "MATCH",
          rulePayload: "",
          start: "2026-04-09T00:00:00.000Z",
          metadata: {
            network: "tcp",
            type: "http",
            destinationIP: "",
            destinationPort: "443",
            dnsMode: "",
            host: "example.com",
            inboundIP: "",
            inboundName: "",
            inboundPort: "",
            inboundUser: "",
            process: "",
            processPath: "",
            remoteDestination: "192.0.2.1:443",
            sniffHost: "",
            sourceIP: "192.168.0.2",
            sourcePort: "50000",
            specialProxy: "",
            specialRules: "",
            uid: 0,
          },
        },
      ],
    });
    await aggregator.flush();

    const regions = await listAnalyticsRegionsSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
      limit: 20,
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({
      key: "US",
      label: "美国",
      uploadBytes: 10,
      downloadBytes: 20,
      connectionCount: 1,
    });
  });

  it("reclassifies existing Unknown region rows from proxy names when listing regions", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    await context.sqlite.execute({
      sql: `INSERT INTO analytics_hourly_dim_stats (
        target_key, hour, domain, destination_ip, source_ip, proxy_name, proxy_chain, rule_label,
        country_code, country_name, continent_code, continent_name, upload_bytes, download_bytes, connection_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "alpha",
        "2026-04-09T00:00:00.000Z",
        "example.com",
        "",
        "192.168.0.2",
        "日本节点",
        "日本节点 > Proxy",
        "MATCH",
        "Unknown",
        "Unknown",
        "Unknown",
        "Unknown",
        30,
        40,
        2,
      ],
    });

    const regions = await listAnalyticsRegionsSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
      limit: 20,
    });
    expect(regions[0]).toMatchObject({
      key: "JP",
      label: "日本",
      uploadBytes: 30,
      downloadBytes: 40,
      connectionCount: 2,
    });
  });

  it("returns stored regions immediately and primes online destination IP GeoIP for later listings", async () => {
    process.env.GEOIP_LOOKUP_PROVIDER = "online";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          country: "DE",
          country_name: "Germany",
          continent: "EU",
          continent_name: "Europe",
        }),
      })),
    );

    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    await context.sqlite.execute({
      sql: `INSERT INTO analytics_hourly_dim_stats (
        target_key, hour, domain, destination_ip, source_ip, proxy_name, proxy_chain, rule_label,
        country_code, country_name, continent_code, continent_name, upload_bytes, download_bytes, connection_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "alpha",
        "2026-04-09T00:00:00.000Z",
        "example.com",
        "203.0.113.8",
        "192.168.0.2",
        "美国节点",
        "美国节点 > Proxy",
        "MATCH",
        "US",
        "美国",
        "NA",
        "North America",
        30,
        40,
        2,
      ],
    });

    const regions = await listAnalyticsRegionsSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
      limit: 20,
    });
    expect(regions[0]).toMatchObject({
      key: "US",
      label: "美国",
      uploadBytes: 30,
      downloadBytes: 40,
      connectionCount: 2,
    });
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const refreshedRegions = await listAnalyticsRegionsSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
      limit: 20,
    });
    expect(refreshedRegions[0]).toMatchObject({
      key: "DE",
      label: "德国",
      uploadBytes: 30,
      downloadBytes: 40,
      connectionCount: 2,
    });
  });

  it("builds rule flow as source to rule to proxy chain", async () => {
    const context = createDatabase(getRuntimeConfig({}), cwd);
    await seedDatabase(context);
    const store = new RealtimeAnalyticsStore();
    const aggregator = new TrafficAggregator(context, store, new GeoIpService(undefined), new ClickHouseService({}));
    aggregator.setEnabled(true);
    aggregator.setTargetKey("alpha");

    aggregator.onConnections({
      uploadTotal: 80,
      downloadTotal: 800,
      connections: [
        {
          id: "conn-flow",
          upload: 50,
          download: 500,
          chains: ["HK-PCCW", "HK-ViuTV"],
          rule: "RuleSet",
          rulePayload: "AppleCN",
          start: "2026-04-09T00:00:00.000Z",
          metadata: {
            network: "tcp",
            type: "http",
            destinationIP: "192.0.2.1",
            destinationPort: "443",
            dnsMode: "",
            host: "apple.com",
            inboundIP: "",
            inboundName: "",
            inboundPort: "",
            inboundUser: "",
            process: "",
            processPath: "",
            remoteDestination: "",
            sniffHost: "",
            sourceIP: "127.0.0.1",
            sourcePort: "50000",
            specialProxy: "",
            specialRules: "",
            uid: 0,
          },
        },
        {
          id: "conn-flow-other",
          upload: 30,
          download: 300,
          chains: ["DIRECT"],
          rule: "MATCH",
          rulePayload: "",
          start: "2026-04-09T00:00:00.000Z",
          metadata: {
            network: "tcp",
            type: "http",
            destinationIP: "198.51.100.2",
            destinationPort: "443",
            dnsMode: "",
            host: "other.example",
            inboundIP: "",
            inboundName: "",
            inboundPort: "",
            inboundUser: "",
            process: "",
            processPath: "",
            remoteDestination: "",
            sniffHost: "",
            sourceIP: "198.18.0.1",
            sourcePort: "51000",
            specialProxy: "",
            specialRules: "",
            uid: 0,
          },
        },
      ],
    });
    await aggregator.flush();

    const flow = await getAnalyticsRuleFlowSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
    });

    expect(flow.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "source:127.0.0.1", layer: 0, nodeType: "source" }),
        expect.objectContaining({ id: "rule:RuleSet(AppleCN)", layer: 1, nodeType: "rule" }),
        expect.objectContaining({ id: "group:HK-ViuTV", layer: 2, nodeType: "group" }),
        expect.objectContaining({ id: "proxy:HK-PCCW", layer: 3, nodeType: "proxy" }),
      ]),
    );
    expect(flow.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ nodeType: "domain" })]));
    expect(flow.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "source:127.0.0.1", target: "rule:RuleSet(AppleCN)" }),
        expect.objectContaining({ source: "rule:RuleSet(AppleCN)", target: "group:HK-ViuTV" }),
        expect.objectContaining({ source: "group:HK-ViuTV", target: "proxy:HK-PCCW" }),
      ]),
    );

    const filteredFlow = await getAnalyticsRuleFlowSqlite(context, "alpha", {
      start: "2026-04-07T00:00:00.000Z",
      end: "2026-04-10T00:00:00.000Z",
    }, "127.0.0.1");
    expect(filteredFlow.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: "source:127.0.0.1" })]));
    expect(filteredFlow.nodes).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "source:198.18.0.1" })]));
  });
});
