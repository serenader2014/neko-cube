import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase, seedDatabase } from "../server/db/database";
import {
  cleanupProxyProbeData,
  getProxyProbeRecentSamples,
  getProxyProbeSettings,
  getProxyProbeSummary,
  getProxyProbeTrend,
  updateProxyProbeSettings,
  writeProxyDelaySamples,
} from "../server/db/probe-db";
import { getRuntimeConfig } from "../server/lib/runtime";

describe("proxy probe database", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-probes-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("seeds settings and aggregates smoke-style delay samples", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);

    const settings = await getProxyProbeSettings(context);
    expect(settings.intervalSeconds).toBe(120);
    expect(settings.burstCount).toBe(5);
    expect(settings.nodeFilterMode).toBe("all");
    expect(settings.nodeFilterNames).toEqual([]);
    expect(settings.nodeFilterIncludeNames).toEqual([]);
    expect(settings.nodeFilterExcludeNames).toEqual([]);
    expect(settings.includeFirstSampleInStats).toBe(true);

    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-09T00:00:00.000Z", 100),
      sample("alpha", "HK-01", "2026-04-09T00:00:01.000Z", 120),
      sample("alpha", "HK-01", "2026-04-09T00:00:02.000Z", 180),
      sample("alpha", "HK-01", "2026-04-09T00:00:03.000Z", 300),
      sample("alpha", "HK-01", "2026-04-09T00:00:04.000Z", null, "timeout"),
      sample("alpha", "US-01", "2026-04-09T00:01:00.000Z", 90),
    ]);

    const range = {
      start: "2026-04-09T00:00:00.000Z",
      end: "2026-04-09T01:00:00.000Z",
    };
    const summary = await getProxyProbeSummary(context, "alpha", range, { preset: "1h", limit: 20 });
    const hk = summary.items.find((item) => item.proxyName === "HK-01");
    expect(hk?.sampleCount).toBe(5);
    expect(hk?.successCount).toBe(4);
    expect(hk?.p50DelayMs).toBe(180);
    expect(hk?.p90DelayMs).toBe(300);
    expect(hk?.p95DelayMs).toBe(300);
    expect(hk?.jitterMs).toBe(78);
    expect(hk?.lossRate).toBeCloseTo(0.2);

    const trend = await getProxyProbeTrend(context, "alpha", "HK-01", range);
    expect(trend.points).toHaveLength(1);
    expect(trend.points[0]?.failureCount).toBe(1);
    expect(trend.points[0]?.maxDelayMs).toBe(300);
    expect(trend.points[0]?.jitterMs).toBe(78);
    expect(trend.points[0]?.smokeDelayMs).toEqual([100, 120, 180, 300]);
  });

  it("stores node allow and deny list probe settings", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);

    await expect(
      updateProxyProbeSettings(context, {
        nodeFilterIncludeNames: ["HK-01", " HK-01 ", "US-01"],
        nodeFilterExcludeNames: ["US-01", "JP-01"],
      }),
    ).resolves.toMatchObject({
      nodeFilterMode: "include",
      nodeFilterNames: ["HK-01", "US-01"],
      nodeFilterIncludeNames: ["HK-01", "US-01"],
      nodeFilterExcludeNames: ["JP-01"],
    });

    await expect(
      updateProxyProbeSettings(context, {
        nodeFilterIncludeNames: [],
        nodeFilterExcludeNames: [],
      }),
    ).resolves.toMatchObject({
      nodeFilterMode: "all",
      nodeFilterNames: [],
      nodeFilterIncludeNames: [],
      nodeFilterExcludeNames: [],
    });
  });

  it("backfills node filter settings for existing probe settings rows", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await context.sqlite.execute(`CREATE TABLE proxy_probe_settings (
      id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL,
      interval_seconds INTEGER NOT NULL,
      timeout_ms INTEGER NOT NULL,
      concurrency INTEGER NOT NULL,
      burst_count INTEGER NOT NULL,
      burst_gap_ms INTEGER NOT NULL,
      probe_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await context.sqlite.execute({
      sql: `INSERT INTO proxy_probe_settings
        (id, enabled, interval_seconds, timeout_ms, concurrency, burst_count, burst_gap_ms, probe_url, created_at, updated_at)
        VALUES (1, 1, 120, 5000, 8, 5, 400, '', '2026-04-09T00:00:00.000Z', '2026-04-09T00:00:00.000Z')`,
      args: [],
    });

    await seedDatabase(context);

    await expect(getProxyProbeSettings(context)).resolves.toMatchObject({
      includeFirstSampleInStats: true,
      nodeFilterMode: "all",
      nodeFilterNames: [],
      nodeFilterIncludeNames: [],
      nodeFilterExcludeNames: [],
    });
  });

  it("filters summary items with the current probe node settings", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-09T00:00:00.000Z", 100),
      sample("alpha", "JP-01", "2026-04-09T00:00:01.000Z", 120),
      sample("alpha", "US-01", "2026-04-09T00:00:02.000Z", 140),
    ]);
    const settings = await updateProxyProbeSettings(context, {
      nodeFilterIncludeNames: ["HK-01", "JP-01"],
      nodeFilterExcludeNames: ["US-01"],
    });

    const summary = await getProxyProbeSummary(
      context,
      "alpha",
      {
        start: "2026-04-09T00:00:00.000Z",
        end: "2026-04-09T01:00:00.000Z",
      },
      { preset: "1h", limit: 20 },
      settings,
    );

    expect(summary.items.map((item) => item.proxyName).sort()).toEqual(["HK-01", "JP-01"]);
  });

  it("can exclude the first burst sample from probe statistics", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    const settings = await updateProxyProbeSettings(context, {
      includeFirstSampleInStats: false,
    });

    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-09T00:00:00.000Z", 800, null, "ss", "round-1", "2026-04-09T00:00:00.000Z"),
      sample("alpha", "HK-01", "2026-04-09T00:00:01.000Z", 100, null, "ss", "round-1", "2026-04-09T00:00:00.000Z"),
      sample("alpha", "HK-01", "2026-04-09T00:00:02.000Z", 120, null, "ss", "round-1", "2026-04-09T00:00:00.000Z"),
      sample("alpha", "HK-01", "2026-04-09T00:02:00.000Z", 600, null, "ss", "round-2", "2026-04-09T00:02:00.000Z"),
      sample("alpha", "HK-01", "2026-04-09T00:02:01.000Z", 110, null, "ss", "round-2", "2026-04-09T00:02:00.000Z"),
      sample("alpha", "HK-01", "2026-04-09T00:02:02.000Z", 130, null, "ss", "round-2", "2026-04-09T00:02:00.000Z"),
    ]);

    const range = {
      start: "2026-04-09T00:00:00.000Z",
      end: "2026-04-09T01:00:00.000Z",
    };
    const summary = await getProxyProbeSummary(context, "alpha", range, { preset: "1h", limit: 20 }, settings);
    const trend = await getProxyProbeTrend(context, "alpha", "HK-01", range, settings);
    const recentSamples = await getProxyProbeRecentSamples(context, "alpha", "HK-01", { limit: "10" });
    const hk = summary.items.find((item) => item.proxyName === "HK-01");

    expect(hk).toMatchObject({
      sampleCount: 4,
      successCount: 4,
      p50DelayMs: 120,
    });
    expect(hk?.latestDelayMs).toBe(130);
    expect(hk?.p90DelayMs).toBe(130);
    expect(trend.points.flatMap((point) => point.smokeDelayMs).sort((left, right) => left - right)).toEqual([100, 110, 120, 130]);
    expect(recentSamples.items.map((item) => item.delayMs)).toEqual([130, 110, 600, 120, 100, 800]);
  });

  it("hides builtin compatible probe samples from reports", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-09T00:00:00.000Z", 100),
      sample("alpha", "COMPATIBLE", "2026-04-09T00:00:01.000Z", 10, null, "Compatible"),
    ]);
    const range = {
      start: "2026-04-09T00:00:00.000Z",
      end: "2026-04-09T01:00:00.000Z",
    };

    const summary = await getProxyProbeSummary(context, "alpha", range, { preset: "1h", limit: 20 });
    const trend = await getProxyProbeTrend(context, "alpha", "COMPATIBLE", range);

    expect(summary.items.map((item) => item.proxyName)).toEqual(["HK-01"]);
    expect(trend.points).toEqual([]);
  });

  it("returns recent raw samples for an expanded probe node", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-09T00:00:00.000Z", 100),
      sample("alpha", "HK-01", "2026-04-09T00:00:01.000Z", null, "timeout"),
      sample("alpha", "HK-01", "2026-04-09T00:00:02.000Z", 140),
      sample("alpha", "COMPATIBLE", "2026-04-09T00:00:03.000Z", 1, null, "Compatible"),
    ]);

    const samples = await getProxyProbeRecentSamples(context, "alpha", "HK-01", { limit: "2" });
    const compatibleSamples = await getProxyProbeRecentSamples(context, "alpha", "COMPATIBLE", { limit: "2" });

    expect(samples.items.map((item) => item.delayMs)).toEqual([140, null]);
    expect(samples.items[1]).toMatchObject({ success: false, error: "timeout" });
    expect(compatibleSamples.items).toEqual([]);
  });

  it("uses hourly stats for long ranges and cleans data with telemetry retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T00:00:00.000Z"));
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);

    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-01T00:00:00.000Z", 100),
      sample("alpha", "HK-01", "2026-04-19T00:00:00.000Z", 160),
      sample("alpha", "HK-01", "2026-04-19T00:00:01.000Z", 240),
    ]);

    const summary = await getProxyProbeSummary(
      context,
      "alpha",
      {
        start: "2026-04-01T00:00:00.000Z",
        end: "2026-04-20T00:00:00.000Z",
      },
      { preset: "7d", limit: 20 },
    );
    expect(summary.items.find((item) => item.proxyName === "HK-01")?.sampleCount).toBe(3);

    await cleanupProxyProbeData(context, {
      enabled: true,
      querySource: "auto",
      minuteRetentionDays: 7,
      hourlyRetentionDays: 90,
      realtimeBufferMinutes: 5,
      maxLiveLogs: 2000,
      maxLiveConnections: 500,
    });

    const rawRows = await context.sqlite.execute("SELECT COUNT(*) AS count FROM proxy_delay_probe_samples");
    expect(Number(rawRows.rows[0]?.count ?? 0)).toBe(2);
    const hourlyRows = await context.sqlite.execute("SELECT COUNT(*) AS count FROM proxy_delay_probe_hourly_stats");
    expect(Number(hourlyRows.rows[0]?.count ?? 0)).toBe(2);
  });

  it("keeps recent smoke trends granular even when the selected range is seven days", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);

    await writeProxyDelaySamples(context, [
      sample("alpha", "HK-01", "2026-04-19T10:00:00.000Z", 100),
      sample("alpha", "HK-01", "2026-04-19T10:02:00.000Z", 140),
      sample("alpha", "HK-01", "2026-04-19T10:04:00.000Z", 180),
      sample("alpha", "HK-01", "2026-04-19T10:06:00.000Z", 120),
    ]);

    const trend = await getProxyProbeTrend(context, "alpha", "HK-01", {
      start: "2026-04-13T00:00:00.000Z",
      end: "2026-04-20T00:00:00.000Z",
    });

    expect(trend.points.map((point) => point.bucket)).toEqual([
      "2026-04-19T10:00:00.000Z",
      "2026-04-19T10:02:00.000Z",
      "2026-04-19T10:04:00.000Z",
      "2026-04-19T10:06:00.000Z",
    ]);
  });
});

function sample(
  targetKey: string,
  proxyName: string,
  testedAt: string,
  delayMs: number | null,
  error: string | null = null,
  proxyType = "ss",
  roundId = "round-1",
  roundStartedAt = "2026-04-09T00:00:00.000Z",
) {
  return {
    targetKey,
    proxyName,
    proxyType,
    roundId,
    roundStartedAt,
    testedAt,
    probeUrl: "http://cp.cloudflare.com/generate_204",
    delayMs,
    success: delayMs !== null,
    error,
  };
}
