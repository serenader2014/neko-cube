import type { Client, InStatement } from "@libsql/client";
import { eq } from "drizzle-orm";
import {
  isBuiltinProxyProbeNode,
  isProxyNameAllowedByProbeSettings,
  proxyProbeOverviewSchema,
  proxyProbeQuerySchema,
  proxyProbeRecentSamplesQuerySchema,
  proxyProbeRecentSamplesResponseSchema,
  proxyProbeSettingsSchema,
  proxyProbeSummaryItemSchema,
  proxyProbeSummaryResponseSchema,
  proxyProbeTrendPointSchema,
  proxyProbeTrendResponseSchema,
  type ProxyDelayProbeSampleInput,
  type ProxyProbeQuery,
  type ProxyProbeRecentSamplesResponse,
  type ProxyProbeSettings,
  type ProxyProbeSummaryItem,
  type ProxyProbeSummaryResponse,
  type ProxyProbeTrendPoint,
  type ProxyProbeTrendResponse,
} from "../../shared/probes.js";
import type { TelemetrySettings } from "../../shared/telemetry.js";
import { pickTrendBucketMinutes, toHourIso } from "../services/telemetry-utils.js";
import type { DatabaseContext } from "./database-types.js";
import { durationMs, nowIso, toNullableString, toNumber, type TimeRange } from "./telemetry-db-helpers.js";
import { proxyProbeSettingsTable } from "./schema.js";

type ProbeRow = {
  proxyName: string;
  proxyType: string;
  roundId: string;
  roundStartedAt: string;
  testedAt: string;
  probeUrl: string;
  delayMs: number | null;
  success: boolean;
  error: string | null;
};

type HourlyRow = {
  proxyName: string;
  proxyType: string;
  hour: string;
  latestDelayMs: number | null;
  minDelayMs: number | null;
  p50DelayMs: number | null;
  avgDelayMs: number | null;
  p90DelayMs: number | null;
  p95DelayMs: number | null;
  maxDelayMs: number | null;
  jitterMs: number | null;
  successCount: number;
  failureCount: number;
  sampleCount: number;
  lastTestedAt: string | null;
  lastError: string | null;
};

type ProbeStats = Omit<HourlyRow, "proxyName" | "proxyType" | "hour">;

type ProbeStatsOptions = {
  includeFirstSampleInStats: boolean;
};

const MAX_SMOKE_DELAYS_PER_POINT = 80;

export const DEFAULT_PROXY_PROBE_SETTINGS: Omit<ProxyProbeSettings, "id" | "createdAt" | "updatedAt"> = {
  enabled: true,
  intervalSeconds: 120,
  timeoutMs: 5000,
  concurrency: 8,
  burstCount: 5,
  burstGapMs: 400,
  includeFirstSampleInStats: true,
  probeUrl: "",
  nodeFilterMode: "all",
  nodeFilterNames: [],
  nodeFilterIncludeNames: [],
  nodeFilterExcludeNames: [],
};

function emptyStats(): ProbeStats {
  return {
    latestDelayMs: null,
    minDelayMs: null,
    p50DelayMs: null,
    avgDelayMs: null,
    p90DelayMs: null,
    p95DelayMs: null,
    maxDelayMs: null,
    jitterMs: null,
    successCount: 0,
    failureCount: 0,
    sampleCount: 0,
    lastTestedAt: null,
    lastError: null,
  };
}

function percentile(sortedValues: number[], percentileValue: number) {
  if (!sortedValues.length) {
    return null;
  }
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((sortedValues.length - 1) * percentileValue)));
  return sortedValues[index] ?? null;
}

function standardDeviation(values: number[]) {
  if (!values.length) {
    return null;
  }
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / values.length;
  return Math.round(Math.sqrt(variance));
}

function probeStatsOptions(settings?: ProxyProbeSettings): ProbeStatsOptions {
  return {
    includeFirstSampleInStats: settings?.includeFirstSampleInStats ?? true,
  };
}

function roundSampleKey(row: ProbeRow) {
  return `${row.proxyName}\0${row.roundId}\0${row.roundStartedAt}`;
}

function rowsForStats(rows: ProbeRow[], options: ProbeStatsOptions = { includeFirstSampleInStats: true }) {
  if (options.includeFirstSampleInStats) {
    return rows;
  }
  const firstRows = new Map<string, ProbeRow>();
  for (const row of rows) {
    const key = roundSampleKey(row);
    const current = firstRows.get(key);
    if (!current || row.testedAt < current.testedAt) {
      firstRows.set(key, row);
    }
  }
  const excludedRows = new Set(firstRows.values());
  return rows.filter((row) => !excludedRows.has(row));
}

function smokeJitterFromRows(rows: ProbeRow[]) {
  const roundDelays = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.success || typeof row.delayMs !== "number") {
      continue;
    }
    const key = `${row.roundId}\0${row.roundStartedAt}`;
    const delays = roundDelays.get(key);
    if (delays) {
      delays.push(row.delayMs);
    } else {
      roundDelays.set(key, [row.delayMs]);
    }
  }
  let weightedTotal = 0;
  let weightedCount = 0;
  for (const delays of roundDelays.values()) {
    const jitter = standardDeviation(delays);
    if (jitter === null) {
      continue;
    }
    weightedTotal += jitter * delays.length;
    weightedCount += delays.length;
  }
  return weightedCount > 0 ? Math.round(weightedTotal / weightedCount) : null;
}

function sampleSmokeDelays(rows: ProbeRow[], options?: ProbeStatsOptions) {
  const delays = rowsForStats(rows, options)
    .flatMap((row) => (row.success && typeof row.delayMs === "number" ? [row.delayMs] : []))
    .sort((left, right) => left - right);
  if (delays.length <= MAX_SMOKE_DELAYS_PER_POINT) {
    return delays;
  }
  return Array.from({ length: MAX_SMOKE_DELAYS_PER_POINT }, (_value, index) => {
    const sourceIndex = Math.round((index * (delays.length - 1)) / (MAX_SMOKE_DELAYS_PER_POINT - 1));
    return delays[sourceIndex]!;
  });
}

function statsFromRows(rows: ProbeRow[], options?: ProbeStatsOptions): ProbeStats {
  const stats = emptyStats();
  const delays: number[] = [];
  const statRows = rowsForStats(rows, options);
  for (const row of statRows) {
    stats.sampleCount += 1;
    stats.lastTestedAt = !stats.lastTestedAt || row.testedAt > stats.lastTestedAt ? row.testedAt : stats.lastTestedAt;
    if (row.success && typeof row.delayMs === "number") {
      stats.successCount += 1;
      stats.latestDelayMs = !stats.lastTestedAt || row.testedAt >= stats.lastTestedAt ? row.delayMs : stats.latestDelayMs;
      delays.push(row.delayMs);
    } else {
      stats.failureCount += 1;
      if (row.error) {
        stats.lastError = row.error;
      }
    }
  }
  delays.sort((left, right) => left - right);
  if (!delays.length) {
    return stats;
  }
  const sum = delays.reduce((total, value) => total + value, 0);
  stats.minDelayMs = delays[0] ?? null;
  stats.p50DelayMs = percentile(delays, 0.5);
  stats.avgDelayMs = Math.round(sum / delays.length);
  stats.p90DelayMs = percentile(delays, 0.9);
  stats.p95DelayMs = percentile(delays, 0.95);
  stats.maxDelayMs = delays[delays.length - 1] ?? null;
  stats.jitterMs = smokeJitterFromRows(statRows);
  return stats;
}

function statsFromHourlyRows(rows: HourlyRow[]): ProbeStats {
  const stats = emptyStats();
  let weightedAvgTotal = 0;
  let weightedP50Total = 0;
  let weightedP90Total = 0;
  let weightedP95Total = 0;
  let weightedJitterTotal = 0;
  let weightedP50Count = 0;
  let weightedP90Count = 0;
  let weightedP95Count = 0;
  let weightedJitterCount = 0;
  for (const row of rows) {
    stats.successCount += row.successCount;
    stats.failureCount += row.failureCount;
    stats.sampleCount += row.sampleCount;
    stats.minDelayMs = row.minDelayMs === null ? stats.minDelayMs : Math.min(stats.minDelayMs ?? row.minDelayMs, row.minDelayMs);
    stats.maxDelayMs = row.maxDelayMs === null ? stats.maxDelayMs : Math.max(stats.maxDelayMs ?? row.maxDelayMs, row.maxDelayMs);
    if (row.avgDelayMs !== null && row.successCount > 0) {
      weightedAvgTotal += row.avgDelayMs * row.successCount;
    }
    if (row.p50DelayMs !== null && row.successCount > 0) {
      weightedP50Total += row.p50DelayMs * row.successCount;
      weightedP50Count += row.successCount;
    }
    if (row.p90DelayMs !== null && row.successCount > 0) {
      weightedP90Total += row.p90DelayMs * row.successCount;
      weightedP90Count += row.successCount;
    }
    if (row.p95DelayMs !== null && row.successCount > 0) {
      weightedP95Total += row.p95DelayMs * row.successCount;
      weightedP95Count += row.successCount;
    }
    if (row.jitterMs !== null && row.successCount > 0) {
      weightedJitterTotal += row.jitterMs * row.successCount;
      weightedJitterCount += row.successCount;
    }
    if (!stats.lastTestedAt || (row.lastTestedAt && row.lastTestedAt > stats.lastTestedAt)) {
      stats.lastTestedAt = row.lastTestedAt;
      stats.latestDelayMs = row.latestDelayMs;
    }
    if (row.lastError) {
      stats.lastError = row.lastError;
    }
  }
  stats.avgDelayMs = stats.successCount > 0 ? Math.round(weightedAvgTotal / stats.successCount) : null;
  stats.p50DelayMs = weightedP50Count > 0 ? Math.round(weightedP50Total / weightedP50Count) : null;
  stats.p90DelayMs = weightedP90Count > 0 ? Math.round(weightedP90Total / weightedP90Count) : null;
  stats.p95DelayMs = weightedP95Count > 0 ? Math.round(weightedP95Total / weightedP95Count) : null;
  stats.jitterMs = weightedJitterCount > 0 ? Math.round(weightedJitterTotal / weightedJitterCount) : null;
  return stats;
}

function toSummaryItem(proxyName: string, proxyType: string, stats: ProbeStats): ProxyProbeSummaryItem {
  const successRate = stats.sampleCount > 0 ? stats.successCount / stats.sampleCount : 0;
  const lossRate = stats.sampleCount > 0 ? stats.failureCount / stats.sampleCount : 0;
  return proxyProbeSummaryItemSchema.parse({
    proxyName,
    proxyType,
    latestDelayMs: stats.latestDelayMs,
    p50DelayMs: stats.p50DelayMs,
    avgDelayMs: stats.avgDelayMs,
    p90DelayMs: stats.p90DelayMs,
    p95DelayMs: stats.p95DelayMs,
    jitterMs: stats.jitterMs,
    successRate,
    lossRate,
    sampleCount: stats.sampleCount,
    successCount: stats.successCount,
    failureCount: stats.failureCount,
    lastTestedAt: stats.lastTestedAt,
    lastError: stats.lastError,
  });
}

function toTrendPoint(bucket: string, stats: ProbeStats, smokeDelayMs: number[] = []): ProxyProbeTrendPoint {
  const lossRate = stats.sampleCount > 0 ? stats.failureCount / stats.sampleCount : 0;
  return proxyProbeTrendPointSchema.parse({
    bucket,
    minDelayMs: stats.minDelayMs,
    p50DelayMs: stats.p50DelayMs,
    avgDelayMs: stats.avgDelayMs,
    p90DelayMs: stats.p90DelayMs,
    p95DelayMs: stats.p95DelayMs,
    maxDelayMs: stats.maxDelayMs,
    jitterMs: stats.jitterMs,
    smokeDelayMs,
    successCount: stats.successCount,
    failureCount: stats.failureCount,
    sampleCount: stats.sampleCount,
    lossRate,
  });
}

function bucketTime(timestamp: string, bucketMinutes: number) {
  const date = new Date(timestamp);
  if (bucketMinutes >= 60) {
    date.setUTCMinutes(0, 0, 0);
  } else {
    const minutes = Math.floor(date.getUTCMinutes() / bucketMinutes) * bucketMinutes;
    date.setUTCMinutes(minutes, 0, 0);
  }
  return date.toISOString();
}

function nextHourIso(hour: string) {
  return new Date(new Date(hour).getTime() + 60 * 60 * 1000).toISOString();
}

function shouldUseHourly(range: TimeRange) {
  return durationMs(range) > 48 * 60 * 60 * 1000;
}

async function queryRows(context: DatabaseContext, sql: string, args: Array<string | number | null>) {
  const result = await context.sqlite.execute({ sql, args });
  return result.rows as Array<Record<string, unknown>>;
}

function mapSampleRows(rows: Array<Record<string, unknown>>): ProbeRow[] {
  return rows.map((row) => ({
    proxyName: String(row.proxy_name ?? ""),
    proxyType: String(row.proxy_type ?? ""),
    roundId: String(row.round_id ?? ""),
    roundStartedAt: String(row.round_started_at ?? row.tested_at ?? ""),
    testedAt: String(row.tested_at ?? ""),
    probeUrl: String(row.probe_url ?? ""),
    delayMs: row.delay_ms === null || row.delay_ms === undefined ? null : toNumber(row.delay_ms),
    success: toNumber(row.success) === 1,
    error: toNullableString(row.error),
  }));
}

function mapHourlyRows(rows: Array<Record<string, unknown>>): HourlyRow[] {
  return rows.map((row) => ({
    proxyName: String(row.proxy_name ?? ""),
    proxyType: String(row.proxy_type ?? ""),
    hour: String(row.hour ?? ""),
    latestDelayMs: row.latest_delay_ms === null || row.latest_delay_ms === undefined ? null : toNumber(row.latest_delay_ms),
    minDelayMs: row.min_delay_ms === null || row.min_delay_ms === undefined ? null : toNumber(row.min_delay_ms),
    p50DelayMs: row.p50_delay_ms === null || row.p50_delay_ms === undefined ? null : toNumber(row.p50_delay_ms),
    avgDelayMs: row.avg_delay_ms === null || row.avg_delay_ms === undefined ? null : toNumber(row.avg_delay_ms),
    p90DelayMs: row.p90_delay_ms === null || row.p90_delay_ms === undefined ? null : toNumber(row.p90_delay_ms),
    p95DelayMs: row.p95_delay_ms === null || row.p95_delay_ms === undefined ? null : toNumber(row.p95_delay_ms),
    maxDelayMs: row.max_delay_ms === null || row.max_delay_ms === undefined ? null : toNumber(row.max_delay_ms),
    jitterMs: row.jitter_ms === null || row.jitter_ms === undefined ? null : toNumber(row.jitter_ms),
    successCount: toNumber(row.success_count),
    failureCount: toNumber(row.failure_count),
    sampleCount: toNumber(row.sample_count),
    lastTestedAt: toNullableString(row.last_tested_at),
    lastError: toNullableString(row.last_error),
  }));
}

export async function ensureProxyProbeTables(sqlite: Client) {
  await sqlite.batch(
    [
      `CREATE TABLE IF NOT EXISTS proxy_probe_settings (
        id INTEGER PRIMARY KEY,
        enabled INTEGER NOT NULL,
        interval_seconds INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        concurrency INTEGER NOT NULL,
        burst_count INTEGER NOT NULL,
        burst_gap_ms INTEGER NOT NULL,
        include_first_sample_in_stats INTEGER NOT NULL,
        probe_url TEXT NOT NULL,
        node_filter_mode TEXT NOT NULL,
        node_filter_names_json TEXT NOT NULL,
        node_filter_include_names_json TEXT NOT NULL,
        node_filter_exclude_names_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS proxy_delay_probe_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_key TEXT NOT NULL,
        proxy_name TEXT NOT NULL,
        proxy_type TEXT NOT NULL,
        round_id TEXT NOT NULL,
        round_started_at TEXT NOT NULL,
        tested_at TEXT NOT NULL,
        probe_url TEXT NOT NULL,
        delay_ms INTEGER,
        success INTEGER NOT NULL,
        error TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS proxy_delay_probe_hourly_stats (
        target_key TEXT NOT NULL,
        proxy_name TEXT NOT NULL,
        proxy_type TEXT NOT NULL,
        hour TEXT NOT NULL,
        latest_delay_ms INTEGER,
        min_delay_ms INTEGER,
        p50_delay_ms INTEGER,
        avg_delay_ms INTEGER,
        p90_delay_ms INTEGER,
        p95_delay_ms INTEGER,
        max_delay_ms INTEGER,
        jitter_ms INTEGER,
        success_count INTEGER NOT NULL,
        failure_count INTEGER NOT NULL,
        sample_count INTEGER NOT NULL,
        last_tested_at TEXT,
        last_error TEXT,
        PRIMARY KEY (target_key, proxy_name, hour)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proxy_delay_samples_target_time
        ON proxy_delay_probe_samples(target_key, tested_at)`,
      `CREATE INDEX IF NOT EXISTS idx_proxy_delay_samples_proxy_time
        ON proxy_delay_probe_samples(target_key, proxy_name, tested_at)`,
      `CREATE INDEX IF NOT EXISTS idx_proxy_delay_hourly_target_time
        ON proxy_delay_probe_hourly_stats(target_key, hour)`,
      `CREATE INDEX IF NOT EXISTS idx_proxy_delay_hourly_proxy_time
        ON proxy_delay_probe_hourly_stats(target_key, proxy_name, hour)`,
    ],
    "write",
  );
  await ensureOptionalColumn(sqlite, "proxy_probe_settings", "node_filter_mode", "TEXT NOT NULL DEFAULT 'all'");
  await ensureOptionalColumn(sqlite, "proxy_probe_settings", "node_filter_names_json", "TEXT NOT NULL DEFAULT '[]'");
  await ensureOptionalColumn(sqlite, "proxy_probe_settings", "node_filter_include_names_json", "TEXT NOT NULL DEFAULT '[]'");
  await ensureOptionalColumn(sqlite, "proxy_probe_settings", "node_filter_exclude_names_json", "TEXT NOT NULL DEFAULT '[]'");
  await ensureOptionalColumn(sqlite, "proxy_probe_settings", "include_first_sample_in_stats", "INTEGER NOT NULL DEFAULT 1");
}

async function ensureOptionalColumn(sqlite: Client, table: string, column: string, definition: string) {
  try {
    await sqlite.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }
}

export async function seedProxyProbeSettings(context: DatabaseContext) {
  const existing = await context.db.select().from(proxyProbeSettingsTable).limit(1);
  if (existing.length > 0) {
    return;
  }
  const timestamp = nowIso();
  await context.db.insert(proxyProbeSettingsTable).values({
    id: 1,
    enabled: DEFAULT_PROXY_PROBE_SETTINGS.enabled,
    intervalSeconds: DEFAULT_PROXY_PROBE_SETTINGS.intervalSeconds,
    timeoutMs: DEFAULT_PROXY_PROBE_SETTINGS.timeoutMs,
    concurrency: DEFAULT_PROXY_PROBE_SETTINGS.concurrency,
    burstCount: DEFAULT_PROXY_PROBE_SETTINGS.burstCount,
    burstGapMs: DEFAULT_PROXY_PROBE_SETTINGS.burstGapMs,
    includeFirstSampleInStats: DEFAULT_PROXY_PROBE_SETTINGS.includeFirstSampleInStats,
    probeUrl: DEFAULT_PROXY_PROBE_SETTINGS.probeUrl,
    nodeFilterMode: DEFAULT_PROXY_PROBE_SETTINGS.nodeFilterMode,
    nodeFilterNamesJson: JSON.stringify(DEFAULT_PROXY_PROBE_SETTINGS.nodeFilterNames),
    nodeFilterIncludeNamesJson: JSON.stringify(DEFAULT_PROXY_PROBE_SETTINGS.nodeFilterIncludeNames),
    nodeFilterExcludeNamesJson: JSON.stringify(DEFAULT_PROXY_PROBE_SETTINGS.nodeFilterExcludeNames),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function getProxyProbeSettings(context: DatabaseContext): Promise<ProxyProbeSettings> {
  const [row] = await context.db.select().from(proxyProbeSettingsTable).limit(1);
  if (!row) {
    return proxyProbeSettingsSchema.parse(DEFAULT_PROXY_PROBE_SETTINGS);
  }
  return proxyProbeSettingsSchema.parse({
    ...row,
    nodeFilterNames: parseNodeFilterNames(row.nodeFilterNamesJson),
    nodeFilterIncludeNames: parseNodeFilterNames(row.nodeFilterIncludeNamesJson),
    nodeFilterExcludeNames: parseNodeFilterNames(row.nodeFilterExcludeNamesJson),
  });
}

export async function updateProxyProbeSettings(context: DatabaseContext, payload: Partial<ProxyProbeSettings>) {
  const current = await getProxyProbeSettings(context);
  const nextPayload = { ...payload };
  if ("nodeFilterIncludeNames" in payload || "nodeFilterExcludeNames" in payload) {
    nextPayload.nodeFilterMode = "all";
    nextPayload.nodeFilterNames = [];
  }
  const parsed = proxyProbeSettingsSchema.parse({ ...current, ...nextPayload, id: 1 });
  await context.db
    .update(proxyProbeSettingsTable)
    .set({
      enabled: parsed.enabled,
      intervalSeconds: parsed.intervalSeconds,
      timeoutMs: parsed.timeoutMs,
      concurrency: parsed.concurrency,
      burstCount: parsed.burstCount,
      burstGapMs: parsed.burstGapMs,
      includeFirstSampleInStats: parsed.includeFirstSampleInStats,
      probeUrl: parsed.probeUrl,
      nodeFilterMode: parsed.nodeFilterMode,
      nodeFilterNamesJson: JSON.stringify(parsed.nodeFilterNames),
      nodeFilterIncludeNamesJson: JSON.stringify(parsed.nodeFilterIncludeNames),
      nodeFilterExcludeNamesJson: JSON.stringify(parsed.nodeFilterExcludeNames),
      updatedAt: nowIso(),
    })
    .where(eq(proxyProbeSettingsTable.id, 1));
  return getProxyProbeSettings(context);
}

function parseNodeFilterNames(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function writeProxyDelaySamples(context: DatabaseContext, samples: ProxyDelayProbeSampleInput[]) {
  if (!samples.length) {
    return;
  }
  const statements: InStatement[] = samples.map((sample) => ({
    sql: `INSERT INTO proxy_delay_probe_samples
      (target_key, proxy_name, proxy_type, round_id, round_started_at, tested_at, probe_url, delay_ms, success, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      sample.targetKey,
      sample.proxyName,
      sample.proxyType,
      sample.roundId,
      sample.roundStartedAt,
      sample.testedAt,
      sample.probeUrl,
      sample.delayMs,
      sample.success ? 1 : 0,
      sample.error,
    ],
  }));
  await context.sqlite.batch(statements, "write");
  await rebuildHourlyStats(context, samples);
}

async function rebuildHourlyStats(context: DatabaseContext, samples: ProxyDelayProbeSampleInput[]) {
  const keys = new Map<string, { targetKey: string; proxyName: string; hour: string }>();
  for (const sample of samples) {
    const hour = toHourIso(sample.testedAt);
    keys.set(`${sample.targetKey}\0${sample.proxyName}\0${hour}`, {
      targetKey: sample.targetKey,
      proxyName: sample.proxyName,
      hour,
    });
  }

  const statements: InStatement[] = [];
  for (const key of keys.values()) {
    const rows = mapSampleRows(
      await queryRows(
        context,
        `SELECT proxy_name, proxy_type, round_id, round_started_at, tested_at, delay_ms, success, error
          FROM proxy_delay_probe_samples
          WHERE target_key = ? AND proxy_name = ? AND tested_at >= ? AND tested_at < ?
          ORDER BY tested_at ASC, id ASC`,
        [key.targetKey, key.proxyName, key.hour, nextHourIso(key.hour)],
      ),
    );
    if (!rows.length) {
      continue;
    }
    const stats = statsFromRows(rows);
    const proxyType = rows[rows.length - 1]?.proxyType ?? "";
    statements.push({
      sql: `INSERT INTO proxy_delay_probe_hourly_stats
        (target_key, proxy_name, proxy_type, hour, latest_delay_ms, min_delay_ms, p50_delay_ms, avg_delay_ms, p90_delay_ms, p95_delay_ms, max_delay_ms, jitter_ms, success_count, failure_count, sample_count, last_tested_at, last_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, proxy_name, hour) DO UPDATE SET
          proxy_type = excluded.proxy_type,
          latest_delay_ms = excluded.latest_delay_ms,
          min_delay_ms = excluded.min_delay_ms,
          p50_delay_ms = excluded.p50_delay_ms,
          avg_delay_ms = excluded.avg_delay_ms,
          p90_delay_ms = excluded.p90_delay_ms,
          p95_delay_ms = excluded.p95_delay_ms,
          max_delay_ms = excluded.max_delay_ms,
          jitter_ms = excluded.jitter_ms,
          success_count = excluded.success_count,
          failure_count = excluded.failure_count,
          sample_count = excluded.sample_count,
          last_tested_at = excluded.last_tested_at,
          last_error = excluded.last_error`,
      args: [
        key.targetKey,
        key.proxyName,
        proxyType,
        key.hour,
        stats.latestDelayMs,
        stats.minDelayMs,
        stats.p50DelayMs,
        stats.avgDelayMs,
        stats.p90DelayMs,
        stats.p95DelayMs,
        stats.maxDelayMs,
        stats.jitterMs,
        stats.successCount,
        stats.failureCount,
        stats.sampleCount,
        stats.lastTestedAt,
        stats.lastError,
      ],
    });
  }
  if (statements.length) {
    await context.sqlite.batch(statements, "write");
  }
}

export async function cleanupProxyProbeData(context: DatabaseContext, settings: TelemetrySettings) {
  const sampleCutoff = new Date(Date.now() - settings.minuteRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const hourCutoff = new Date(Date.now() - settings.hourlyRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  await context.sqlite.batch(
    [
      { sql: `DELETE FROM proxy_delay_probe_samples WHERE tested_at < ?`, args: [sampleCutoff] },
      { sql: `DELETE FROM proxy_delay_probe_hourly_stats WHERE hour < ?`, args: [hourCutoff] },
    ],
    "write",
  );
}

export async function getProxyProbeSummary(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  rawQuery: Partial<ProxyProbeQuery>,
  settings?: ProxyProbeSettings,
): Promise<ProxyProbeSummaryResponse> {
  const query = proxyProbeQuerySchema.parse({ ...rawQuery, start: range.start, end: range.end });
  const useHourlyStats = (settings?.includeFirstSampleInStats ?? true) && shouldUseHourly(range);
  let items = useHourlyStats
    ? await getHourlySummaryItems(context, targetKey, range, query)
    : await getRawSummaryItems(context, targetKey, range, query, settings);
  if (!items.length && !useHourlyStats && shouldUseHourly(range)) {
    items = await getHourlySummaryItems(context, targetKey, range, query);
  }
  const visibleItems = items.filter((item) => {
    if (isBuiltinProxyProbeNode(item.proxyName, item.proxyType)) {
      return false;
    }
    return settings ? isProxyNameAllowedByProbeSettings(item.proxyName, settings) : true;
  });
  const sortedItems = visibleItems
    .sort((left, right) => {
      const leftScore = (left.jitterMs ?? 0) + left.lossRate * 1000;
      const rightScore = (right.jitterMs ?? 0) + right.lossRate * 1000;
      return (
        rightScore - leftScore
        || (right.p90DelayMs ?? right.p95DelayMs ?? 0) - (left.p90DelayMs ?? left.p95DelayMs ?? 0)
        || left.proxyName.localeCompare(right.proxyName)
      );
    })
    .slice(0, query.limit);
  const totals = sortedItems.reduce(
    (accumulator, item) => {
      accumulator.sampleCount += item.sampleCount;
      accumulator.successCount += item.successCount;
      accumulator.p50Total += item.p50DelayMs ?? 0;
      accumulator.p90Total += item.p90DelayMs ?? 0;
      accumulator.p95Total += item.p95DelayMs ?? 0;
      accumulator.jitterTotal += item.jitterMs ?? 0;
      accumulator.delayItemCount += item.p50DelayMs === null ? 0 : 1;
      if (!accumulator.lastTestedAt || (item.lastTestedAt && item.lastTestedAt > accumulator.lastTestedAt)) {
        accumulator.lastTestedAt = item.lastTestedAt;
      }
      return accumulator;
    },
    {
      sampleCount: 0,
      successCount: 0,
      p50Total: 0,
      p90Total: 0,
      p95Total: 0,
      jitterTotal: 0,
      delayItemCount: 0,
      lastTestedAt: null as string | null,
    },
  );
  return proxyProbeSummaryResponseSchema.parse({
    rangeStart: range.start,
    rangeEnd: range.end,
    overview: proxyProbeOverviewSchema.parse({
      monitoredCount: sortedItems.length,
      avgP50DelayMs: totals.delayItemCount > 0 ? Math.round(totals.p50Total / totals.delayItemCount) : null,
      avgP90DelayMs: totals.delayItemCount > 0 ? Math.round(totals.p90Total / totals.delayItemCount) : null,
      avgP95DelayMs: totals.delayItemCount > 0 ? Math.round(totals.p95Total / totals.delayItemCount) : null,
      avgJitterMs: totals.delayItemCount > 0 ? Math.round(totals.jitterTotal / totals.delayItemCount) : null,
      successRate: totals.sampleCount > 0 ? totals.successCount / totals.sampleCount : 0,
      sampleCount: totals.sampleCount,
      lastTestedAt: totals.lastTestedAt,
    }),
    items: sortedItems,
  });
}

async function getRawSummaryItems(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  query: ProxyProbeQuery,
  settings?: ProxyProbeSettings,
) {
  const searchSql = query.q ? "AND proxy_name LIKE ?" : "";
  const searchArgs = query.q ? [`%${query.q}%`] : [];
  const rows = mapSampleRows(
    await queryRows(
      context,
      `SELECT proxy_name, proxy_type, round_id, round_started_at, tested_at, delay_ms, success, error
        FROM proxy_delay_probe_samples
        WHERE target_key = ? AND tested_at >= ? AND tested_at <= ? ${searchSql}
        ORDER BY proxy_name ASC, tested_at ASC, id ASC`,
      [targetKey, range.start, range.end, ...searchArgs],
    ),
  );
  const byProxy = new Map<string, ProbeRow[]>();
  for (const row of rows) {
    const group = byProxy.get(row.proxyName);
    if (group) {
      group.push(row);
    } else {
      byProxy.set(row.proxyName, [row]);
    }
  }
  const options = probeStatsOptions(settings);
  return Array.from(byProxy.entries()).map(([proxyName, proxyRows]) =>
    toSummaryItem(proxyName, proxyRows[proxyRows.length - 1]?.proxyType ?? "", statsFromRows(proxyRows, options)),
  );
}

async function getHourlySummaryItems(context: DatabaseContext, targetKey: string, range: TimeRange, query: ProxyProbeQuery) {
  const searchSql = query.q ? "AND proxy_name LIKE ?" : "";
  const searchArgs = query.q ? [`%${query.q}%`] : [];
  const rows = mapHourlyRows(
    await queryRows(
      context,
      `SELECT *
        FROM proxy_delay_probe_hourly_stats
        WHERE target_key = ? AND hour >= ? AND hour <= ? ${searchSql}
        ORDER BY proxy_name ASC, hour ASC`,
      [targetKey, range.start, range.end, ...searchArgs],
    ),
  );
  const byProxy = new Map<string, HourlyRow[]>();
  for (const row of rows) {
    const group = byProxy.get(row.proxyName);
    if (group) {
      group.push(row);
    } else {
      byProxy.set(row.proxyName, [row]);
    }
  }
  return Array.from(byProxy.entries()).map(([proxyName, proxyRows]) =>
    toSummaryItem(proxyName, proxyRows[proxyRows.length - 1]?.proxyType ?? "", statsFromHourlyRows(proxyRows)),
  );
}

export async function getProxyProbeTrend(
  context: DatabaseContext,
  targetKey: string,
  proxyName: string,
  range: TimeRange,
  settings?: ProxyProbeSettings,
): Promise<ProxyProbeTrendResponse> {
  if (isBuiltinProxyProbeNode(proxyName)) {
    return proxyProbeTrendResponseSchema.parse({
      proxyName,
      rangeStart: range.start,
      rangeEnd: range.end,
      points: [],
    });
  }
  const rawBounds = await getRawSampleBounds(context, targetKey, proxyName, range);
  const shouldUseRawSamples = rawBounds.sampleCount > 0;
  const points = shouldUseRawSamples
    ? await getRawTrendPoints(
        context,
        targetKey,
        proxyName,
        range,
        pickTrendBucketMinutes({ start: rawBounds.firstTestedAt!, end: rawBounds.lastTestedAt! }),
        settings,
      )
    : await getHourlyTrendPoints(context, targetKey, proxyName, range);
  return proxyProbeTrendResponseSchema.parse({
    proxyName,
    rangeStart: range.start,
    rangeEnd: range.end,
    points,
  });
}

export async function getProxyProbeRecentSamples(
  context: DatabaseContext,
  targetKey: string,
  proxyName: string,
  rawQuery: Record<string, string | undefined>,
): Promise<ProxyProbeRecentSamplesResponse> {
  const query = proxyProbeRecentSamplesQuerySchema.parse(rawQuery);
  if (isBuiltinProxyProbeNode(proxyName)) {
    return proxyProbeRecentSamplesResponseSchema.parse({ proxyName, items: [] });
  }
  const rows = mapSampleRows(
    await queryRows(
      context,
      `SELECT proxy_name, proxy_type, round_id, round_started_at, tested_at, probe_url, delay_ms, success, error
        FROM proxy_delay_probe_samples
        WHERE target_key = ? AND proxy_name = ?
        ORDER BY tested_at DESC, id DESC
        LIMIT ?`,
      [targetKey, proxyName, query.limit],
    ),
  ).filter((row) => !isBuiltinProxyProbeNode(row.proxyName, row.proxyType));
  return proxyProbeRecentSamplesResponseSchema.parse({
    proxyName,
    items: rows.map((row) => ({
      proxyName: row.proxyName,
      proxyType: row.proxyType,
      roundId: row.roundId,
      roundStartedAt: row.roundStartedAt,
      testedAt: row.testedAt,
      probeUrl: row.probeUrl,
      delayMs: row.delayMs,
      success: row.success,
      error: row.error,
    })),
  });
}

async function getRawSampleBounds(context: DatabaseContext, targetKey: string, proxyName: string, range: TimeRange) {
  const rows = await queryRows(
    context,
    `SELECT
      COUNT(*) AS sample_count,
      MIN(tested_at) AS first_tested_at,
      MAX(tested_at) AS last_tested_at
      FROM proxy_delay_probe_samples
      WHERE target_key = ? AND proxy_name = ? AND tested_at >= ? AND tested_at <= ?`,
    [targetKey, proxyName, range.start, range.end],
  );
  const row = rows[0];
  return {
    sampleCount: toNumber(row?.sample_count),
    firstTestedAt: toNullableString(row?.first_tested_at),
    lastTestedAt: toNullableString(row?.last_tested_at),
  };
}

async function getRawTrendPoints(
  context: DatabaseContext,
  targetKey: string,
  proxyName: string,
  range: TimeRange,
  bucketMinutes: number,
  settings?: ProxyProbeSettings,
) {
  const rows = mapSampleRows(
    await queryRows(
      context,
      `SELECT proxy_name, proxy_type, round_id, round_started_at, tested_at, delay_ms, success, error
        FROM proxy_delay_probe_samples
        WHERE target_key = ? AND proxy_name = ? AND tested_at >= ? AND tested_at <= ?
        ORDER BY tested_at ASC, id ASC`,
      [targetKey, proxyName, range.start, range.end],
    ),
  );
  const statRows = rowsForStats(rows, probeStatsOptions(settings));
  const buckets = new Map<string, ProbeRow[]>();
  for (const row of statRows) {
    const bucket = bucketTime(row.testedAt, bucketMinutes);
    const bucketRows = buckets.get(bucket);
    if (bucketRows) {
      bucketRows.push(row);
    } else {
      buckets.set(bucket, [row]);
    }
  }
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketRows]) =>
      toTrendPoint(
        bucket,
        statsFromRows(bucketRows),
        sampleSmokeDelays(bucketRows),
      ),
    );
}

async function getHourlyTrendPoints(context: DatabaseContext, targetKey: string, proxyName: string, range: TimeRange) {
  const rows = mapHourlyRows(
    await queryRows(
      context,
      `SELECT *
        FROM proxy_delay_probe_hourly_stats
        WHERE target_key = ? AND proxy_name = ? AND hour >= ? AND hour <= ?
        ORDER BY hour ASC`,
      [targetKey, proxyName, range.start, range.end],
    ),
  );
  return rows.map((row) =>
    toTrendPoint(row.hour, {
      latestDelayMs: row.latestDelayMs,
      minDelayMs: row.minDelayMs,
      p50DelayMs: row.p50DelayMs,
      avgDelayMs: row.avgDelayMs,
      p90DelayMs: row.p90DelayMs,
      p95DelayMs: row.p95DelayMs,
      maxDelayMs: row.maxDelayMs,
      jitterMs: row.jitterMs,
      successCount: row.successCount,
      failureCount: row.failureCount,
      sampleCount: row.sampleCount,
      lastTestedAt: row.lastTestedAt,
      lastError: row.lastError,
    }),
  );
}
