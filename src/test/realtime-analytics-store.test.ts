import { describe, expect, it, vi } from "vitest";
import { RealtimeAnalyticsStore } from "../server/services/realtime-analytics-store";

describe("realtime analytics store", () => {
  it("merges pending sqlite records into summary, trend, lists, and details with target isolation", () => {
    const store = new RealtimeAnalyticsStore();
    const firstId = store.addRecord(
      {
        targetKey: "alpha",
        minute: "2026-04-09T00:00:00.000Z",
        hour: "2026-04-09T00:00:00.000Z",
        domain: "example.com",
        destinationIp: "192.0.2.1",
        sourceIp: "192.168.0.2",
        proxyName: "HK-01",
        proxyChain: "HK-01",
        ruleLabel: "RULE-SET(test)",
        countryCode: "HK",
        countryName: "Hong Kong",
        continentCode: "AS",
        continentName: "Asia",
        uploadBytes: 100,
        downloadBytes: 200,
        connectionCount: 1,
        lastSeen: "2026-04-09T00:01:00.000Z",
      },
      false,
    );
    store.addRecord(
      {
        targetKey: "beta",
        minute: "2026-04-09T00:00:00.000Z",
        hour: "2026-04-09T00:00:00.000Z",
        domain: "other.test",
        destinationIp: "203.0.113.8",
        sourceIp: "192.168.0.3",
        proxyName: "US-01",
        proxyChain: "US-01",
        ruleLabel: "MATCH",
        countryCode: "US",
        countryName: "United States",
        continentCode: "NA",
        continentName: "North America",
        uploadBytes: 500,
        downloadBytes: 800,
        connectionCount: 2,
        lastSeen: "2026-04-09T00:01:00.000Z",
      },
      false,
    );

    const range = { start: "2026-04-09T00:00:00.000Z", end: "2026-04-09T01:00:00.000Z" };
    const summary = store.mergeSummary(
      {
        targetKey: "alpha",
        rangeStart: range.start,
        rangeEnd: range.end,
        querySource: "sqlite",
        uploadBytes: 10,
        downloadBytes: 20,
        connectionCount: 0,
        activeConnections: 0,
      },
      "alpha",
      range,
      "sqlite",
      3,
    );
    expect(summary.uploadBytes).toBe(110);
    expect(summary.downloadBytes).toBe(220);
    expect(summary.connectionCount).toBe(1);
    expect(summary.activeConnections).toBe(3);

    const trend = store.mergeTrend([], "alpha", range, "sqlite");
    expect(trend).toEqual([
      {
        bucket: "2026-04-09T00:01:00.000Z",
        uploadBytes: 100,
        downloadBytes: 200,
        connectionCount: 1,
      },
    ]);

    const domains = store.mergeList([], "alpha", range, "sqlite", "domains", 10);
    expect(domains).toHaveLength(1);
    expect(domains[0]?.key).toBe("example.com");

    const detail = store.mergeDetail(
      {
        items: [],
        querySource: "sqlite",
      },
      "alpha",
      range,
      "sqlite",
      "domain-proxies",
      "example.com",
      10,
    );
    expect(detail.items[0]?.key).toBe("HK-01");

    store.markSqliteFlushed([firstId]);
    const afterFlush = store.mergeList([], "alpha", range, "sqlite", "domains", 10);
    expect(afterFlush).toHaveLength(0);
  });

  it("bounds clickhouse backlog after sqlite flush so stale pending rows do not accumulate forever", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-09T00:20:00.000Z"));
    try {
      const store = new RealtimeAnalyticsStore({
        maxPendingClickhouseAgeMs: 5 * 60 * 1000,
        maxPendingClickhouseRecords: 10,
      });
      const id = store.addRecord(
        {
          targetKey: "alpha",
          minute: "2026-04-09T00:00:00.000Z",
          hour: "2026-04-09T00:00:00.000Z",
          domain: "stale.example",
          destinationIp: "192.0.2.1",
          sourceIp: "192.168.0.2",
          proxyName: "HK-01",
          proxyChain: "HK-01",
          ruleLabel: "MATCH",
          countryCode: "HK",
          countryName: "Hong Kong",
          continentCode: "AS",
          continentName: "Asia",
          uploadBytes: 100,
          downloadBytes: 200,
          connectionCount: 1,
          lastSeen: "2026-04-09T00:00:00.000Z",
        },
        true,
      );

      store.markSqliteFlushed([id]);

      const range = { start: "2026-04-09T00:00:00.000Z", end: "2026-04-09T01:00:00.000Z" };
      expect(store.mergeList([], "alpha", range, "clickhouse", "domains", 10)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
