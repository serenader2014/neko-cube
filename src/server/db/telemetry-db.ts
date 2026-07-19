import type { Client, InStatement } from "@libsql/client";
import { eq } from "drizzle-orm";
import {
  analyticsDetailResponseSchema,
  analyticsFlowEdgeSchema,
  analyticsFlowNodeSchema,
  analyticsListItemSchema,
  analyticsQuerySchema,
  analyticsRuleFlowResponseSchema,
  analyticsSummarySchema,
  analyticsTrendPointSchema,
  telemetryQuerySourceSchema,
  telemetrySettingsSchema,
  type AnalyticsDetailResponse,
  type AnalyticsRuleFlowResponse,
  type AnalyticsListItem,
  type AnalyticsQuery,
  type AnalyticsSummary,
  type AnalyticsTrendPoint,
  type TelemetryQuerySource,
  type TelemetrySettings,
} from "../../shared/telemetry.js";
import { GeoIpService, getCountryDisplayName, inferGeoFromText, isKnownGeoLocation, type GeoLocation } from "../services/geoip-service.js";
import type { DatabaseContext } from "./database.js";
import {
  durationMs,
  normalizeAnalyticsKey,
  nowIso,
  toNullableString,
  toNumber,
  type TimeRange,
} from "./telemetry-db-helpers.js";
import {
  flowNodeTypeForPart,
  normalizeFlowProxyParts,
  upsertFlowEdge,
  upsertFlowNode,
  type FlowEdgeAccumulator,
  type FlowNodeAccumulator,
} from "./telemetry-flow.js";
import { telemetrySettingsTable } from "./schema.js";

type DimensionTotals = {
  targetKey: string;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
};

export type PersistedTrafficRecord = {
  targetKey: string;
  minute: string;
  hour: string;
  domain: string;
  destinationIp: string;
  sourceIp: string;
  proxyName: string;
  proxyChain: string;
  ruleLabel: string;
  countryCode: string;
  countryName: string;
  continentCode: string;
  continentName: string;
  uploadBytes: number;
  downloadBytes: number;
  connectionCount: number;
  lastSeen: string;
};

export type PersistedTrafficBatch = {
  minuteStats: Array<DimensionTotals & { minute: string }>;
  hourlyStats: Array<DimensionTotals & { hour: string }>;
  minuteDims: PersistedTrafficRecord[];
  hourlyDims: PersistedTrafficRecord[];
  domains: Array<DimensionTotals & { domain: string; lastSeen: string }>;
  proxies: Array<DimensionTotals & { proxyName: string; proxyChain: string; lastSeen: string }>;
  rules: Array<DimensionTotals & { ruleLabel: string; finalProxy: string; lastSeen: string }>;
  regions: Array<
    DimensionTotals & {
      countryCode: string;
      countryName: string;
      continentCode: string;
      continentName: string;
      lastSeen: string;
    }
  >;
};

const DEFAULT_TELEMETRY_SETTINGS: Omit<TelemetrySettings, "id" | "createdAt" | "updatedAt"> = {
  enabled: true,
  querySource: "auto",
  minuteRetentionDays: 7,
  hourlyRetentionDays: 90,
  realtimeBufferMinutes: 5,
  maxLiveLogs: 2000,
  maxLiveConnections: 500,
};

let analyticsRegionGeoIpService: GeoIpService | null = null;

function getAnalyticsRegionGeoIpService() {
  analyticsRegionGeoIpService ??= new GeoIpService(process.env.GEOIP_MMDB_PATH);
  return analyticsRegionGeoIpService;
}


function resolveSqliteTables(range: TimeRange) {
  return durationMs(range) > 48 * 60 * 60 * 1000
    ? { statsTable: "analytics_hourly_stats", statsTimeColumn: "hour", dimTable: "analytics_hourly_dim_stats", dimTimeColumn: "hour" }
    : { statsTable: "analytics_minute_stats", statsTimeColumn: "minute", dimTable: "analytics_minute_dim_stats", dimTimeColumn: "minute" };
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

export async function ensureTelemetryTables(sqlite: Client) {
  await sqlite.batch(
    [
      `CREATE TABLE IF NOT EXISTS telemetry_settings (
        id INTEGER PRIMARY KEY,
        enabled INTEGER NOT NULL,
        query_source TEXT NOT NULL,
        minute_retention_days INTEGER NOT NULL,
        hourly_retention_days INTEGER NOT NULL,
        realtime_buffer_minutes INTEGER NOT NULL,
        max_live_logs INTEGER NOT NULL,
        max_live_connections INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_minute_stats (
        target_key TEXT NOT NULL,
        minute TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        PRIMARY KEY (target_key, minute)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_hourly_stats (
        target_key TEXT NOT NULL,
        hour TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        PRIMARY KEY (target_key, hour)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_minute_dim_stats (
        target_key TEXT NOT NULL,
        minute TEXT NOT NULL,
        domain TEXT NOT NULL,
        destination_ip TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        proxy_name TEXT NOT NULL,
        proxy_chain TEXT NOT NULL,
        rule_label TEXT NOT NULL,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        continent_code TEXT NOT NULL,
        continent_name TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        PRIMARY KEY (target_key, minute, domain, destination_ip, source_ip, proxy_name, rule_label)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_hourly_dim_stats (
        target_key TEXT NOT NULL,
        hour TEXT NOT NULL,
        domain TEXT NOT NULL,
        destination_ip TEXT NOT NULL,
        source_ip TEXT NOT NULL,
        proxy_name TEXT NOT NULL,
        proxy_chain TEXT NOT NULL,
        rule_label TEXT NOT NULL,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        continent_code TEXT NOT NULL,
        continent_name TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        PRIMARY KEY (target_key, hour, domain, destination_ip, source_ip, proxy_name, rule_label)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_domain_stats (
        target_key TEXT NOT NULL,
        domain TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        last_seen TEXT,
        PRIMARY KEY (target_key, domain)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_proxy_stats (
        target_key TEXT NOT NULL,
        proxy_name TEXT NOT NULL,
        proxy_chain TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        last_seen TEXT,
        PRIMARY KEY (target_key, proxy_name)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_rule_stats (
        target_key TEXT NOT NULL,
        rule_label TEXT NOT NULL,
        final_proxy TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        last_seen TEXT,
        PRIMARY KEY (target_key, rule_label)
      )`,
      `CREATE TABLE IF NOT EXISTS analytics_region_stats (
        target_key TEXT NOT NULL,
        country_code TEXT NOT NULL,
        country_name TEXT NOT NULL,
        continent_code TEXT NOT NULL,
        continent_name TEXT NOT NULL,
        upload_bytes INTEGER NOT NULL,
        download_bytes INTEGER NOT NULL,
        connection_count INTEGER NOT NULL,
        last_seen TEXT,
        PRIMARY KEY (target_key, country_code)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_minute_stats_target_minute ON analytics_minute_stats(target_key, minute)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_hourly_stats_target_hour ON analytics_hourly_stats(target_key, hour)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_minute_dim_target_minute ON analytics_minute_dim_stats(target_key, minute)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dim_target_hour ON analytics_hourly_dim_stats(target_key, hour)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_minute_dim_domain ON analytics_minute_dim_stats(target_key, domain)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_minute_dim_proxy ON analytics_minute_dim_stats(target_key, proxy_name)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_minute_dim_rule ON analytics_minute_dim_stats(target_key, rule_label)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dim_domain ON analytics_hourly_dim_stats(target_key, domain)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dim_proxy ON analytics_hourly_dim_stats(target_key, proxy_name)`,
      `CREATE INDEX IF NOT EXISTS idx_analytics_hourly_dim_rule ON analytics_hourly_dim_stats(target_key, rule_label)`,
    ],
    "write",
  );
}

export async function seedTelemetrySettings(context: DatabaseContext) {
  const existing = await context.db.select().from(telemetrySettingsTable).limit(1);
  if (existing.length > 0) {
    return;
  }

  const timestamp = nowIso();
  await context.db.insert(telemetrySettingsTable).values({
    id: 1,
    enabled: DEFAULT_TELEMETRY_SETTINGS.enabled,
    querySource: DEFAULT_TELEMETRY_SETTINGS.querySource,
    minuteRetentionDays: DEFAULT_TELEMETRY_SETTINGS.minuteRetentionDays,
    hourlyRetentionDays: DEFAULT_TELEMETRY_SETTINGS.hourlyRetentionDays,
    realtimeBufferMinutes: DEFAULT_TELEMETRY_SETTINGS.realtimeBufferMinutes,
    maxLiveLogs: DEFAULT_TELEMETRY_SETTINGS.maxLiveLogs,
    maxLiveConnections: DEFAULT_TELEMETRY_SETTINGS.maxLiveConnections,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function getTelemetrySettings(context: DatabaseContext): Promise<TelemetrySettings> {
  const [row] = await context.db.select().from(telemetrySettingsTable).limit(1);
  if (!row) {
    return telemetrySettingsSchema.parse(DEFAULT_TELEMETRY_SETTINGS);
  }

  return telemetrySettingsSchema.parse(row);
}

export async function updateTelemetrySettings(context: DatabaseContext, payload: Partial<TelemetrySettings>): Promise<TelemetrySettings> {
  const current = await getTelemetrySettings(context);
  const parsed = telemetrySettingsSchema.parse({ ...current, ...payload, id: 1 });
  await context.db
    .update(telemetrySettingsTable)
    .set({
      enabled: parsed.enabled,
      querySource: parsed.querySource,
      minuteRetentionDays: parsed.minuteRetentionDays,
      hourlyRetentionDays: parsed.hourlyRetentionDays,
      realtimeBufferMinutes: parsed.realtimeBufferMinutes,
      maxLiveLogs: parsed.maxLiveLogs,
      maxLiveConnections: parsed.maxLiveConnections,
      updatedAt: nowIso(),
    })
    .where(eq(telemetrySettingsTable.id, 1));
  return getTelemetrySettings(context);
}

function upsertStatements(batch: PersistedTrafficBatch): InStatement[] {
  const statements: InStatement[] = [];

  for (const item of batch.minuteStats) {
    statements.push({
      sql: `INSERT INTO analytics_minute_stats (target_key, minute, upload_bytes, download_bytes, connection_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(target_key, minute) DO UPDATE SET
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count`,
      args: [item.targetKey, item.minute, item.uploadBytes, item.downloadBytes, item.connectionCount],
    });
  }

  for (const item of batch.hourlyStats) {
    statements.push({
      sql: `INSERT INTO analytics_hourly_stats (target_key, hour, upload_bytes, download_bytes, connection_count)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(target_key, hour) DO UPDATE SET
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count`,
      args: [item.targetKey, item.hour, item.uploadBytes, item.downloadBytes, item.connectionCount],
    });
  }

  for (const item of batch.minuteDims) {
    statements.push({
      sql: `INSERT INTO analytics_minute_dim_stats
        (target_key, minute, domain, destination_ip, source_ip, proxy_name, proxy_chain, rule_label, country_code, country_name, continent_code, continent_name, upload_bytes, download_bytes, connection_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, minute, domain, destination_ip, source_ip, proxy_name, rule_label) DO UPDATE SET
          proxy_chain = excluded.proxy_chain,
          country_code = excluded.country_code,
          country_name = excluded.country_name,
          continent_code = excluded.continent_code,
          continent_name = excluded.continent_name,
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count`,
      args: [
        item.targetKey,
        item.minute,
        item.domain,
        item.destinationIp,
        item.sourceIp,
        item.proxyName,
        item.proxyChain,
        item.ruleLabel,
        item.countryCode,
        item.countryName,
        item.continentCode,
        item.continentName,
        item.uploadBytes,
        item.downloadBytes,
        item.connectionCount,
      ],
    });
  }

  for (const item of batch.hourlyDims) {
    statements.push({
      sql: `INSERT INTO analytics_hourly_dim_stats
        (target_key, hour, domain, destination_ip, source_ip, proxy_name, proxy_chain, rule_label, country_code, country_name, continent_code, continent_name, upload_bytes, download_bytes, connection_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, hour, domain, destination_ip, source_ip, proxy_name, rule_label) DO UPDATE SET
          proxy_chain = excluded.proxy_chain,
          country_code = excluded.country_code,
          country_name = excluded.country_name,
          continent_code = excluded.continent_code,
          continent_name = excluded.continent_name,
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count`,
      args: [
        item.targetKey,
        item.hour,
        item.domain,
        item.destinationIp,
        item.sourceIp,
        item.proxyName,
        item.proxyChain,
        item.ruleLabel,
        item.countryCode,
        item.countryName,
        item.continentCode,
        item.continentName,
        item.uploadBytes,
        item.downloadBytes,
        item.connectionCount,
      ],
    });
  }

  for (const item of batch.domains) {
    statements.push({
      sql: `INSERT INTO analytics_domain_stats (target_key, domain, upload_bytes, download_bytes, connection_count, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, domain) DO UPDATE SET
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count,
          last_seen = CASE
            WHEN analytics_domain_stats.last_seen IS NULL OR analytics_domain_stats.last_seen < excluded.last_seen THEN excluded.last_seen
            ELSE analytics_domain_stats.last_seen
          END`,
      args: [item.targetKey, item.domain, item.uploadBytes, item.downloadBytes, item.connectionCount, item.lastSeen],
    });
  }

  for (const item of batch.proxies) {
    statements.push({
      sql: `INSERT INTO analytics_proxy_stats (target_key, proxy_name, proxy_chain, upload_bytes, download_bytes, connection_count, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, proxy_name) DO UPDATE SET
          proxy_chain = excluded.proxy_chain,
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count,
          last_seen = CASE
            WHEN analytics_proxy_stats.last_seen IS NULL OR analytics_proxy_stats.last_seen < excluded.last_seen THEN excluded.last_seen
            ELSE analytics_proxy_stats.last_seen
          END`,
      args: [item.targetKey, item.proxyName, item.proxyChain, item.uploadBytes, item.downloadBytes, item.connectionCount, item.lastSeen],
    });
  }

  for (const item of batch.rules) {
    statements.push({
      sql: `INSERT INTO analytics_rule_stats (target_key, rule_label, final_proxy, upload_bytes, download_bytes, connection_count, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, rule_label) DO UPDATE SET
          final_proxy = excluded.final_proxy,
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count,
          last_seen = CASE
            WHEN analytics_rule_stats.last_seen IS NULL OR analytics_rule_stats.last_seen < excluded.last_seen THEN excluded.last_seen
            ELSE analytics_rule_stats.last_seen
          END`,
      args: [item.targetKey, item.ruleLabel, item.finalProxy, item.uploadBytes, item.downloadBytes, item.connectionCount, item.lastSeen],
    });
  }

  for (const item of batch.regions) {
    statements.push({
      sql: `INSERT INTO analytics_region_stats (target_key, country_code, country_name, continent_code, continent_name, upload_bytes, download_bytes, connection_count, last_seen)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_key, country_code) DO UPDATE SET
          country_name = excluded.country_name,
          continent_code = excluded.continent_code,
          continent_name = excluded.continent_name,
          upload_bytes = upload_bytes + excluded.upload_bytes,
          download_bytes = download_bytes + excluded.download_bytes,
          connection_count = connection_count + excluded.connection_count,
          last_seen = CASE
            WHEN analytics_region_stats.last_seen IS NULL OR analytics_region_stats.last_seen < excluded.last_seen THEN excluded.last_seen
            ELSE analytics_region_stats.last_seen
          END`,
      args: [
        item.targetKey,
        item.countryCode,
        item.countryName,
        item.continentCode,
        item.continentName,
        item.uploadBytes,
        item.downloadBytes,
        item.connectionCount,
        item.lastSeen,
      ],
    });
  }

  return statements;
}

export async function writeAnalyticsBatchToSqlite(context: DatabaseContext, batch: PersistedTrafficBatch) {
  const statements = upsertStatements(batch);
  if (statements.length === 0) {
    return;
  }
  await context.sqlite.batch(statements, "write");
}

export async function cleanupTelemetryData(context: DatabaseContext, settings: TelemetrySettings) {
  const minuteCutoff = new Date(Date.now() - settings.minuteRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  const hourCutoff = new Date(Date.now() - settings.hourlyRetentionDays * 24 * 60 * 60 * 1000).toISOString();
  await context.sqlite.batch(
    [
      { sql: `DELETE FROM analytics_minute_stats WHERE minute < ?`, args: [minuteCutoff] },
      { sql: `DELETE FROM analytics_minute_dim_stats WHERE minute < ?`, args: [minuteCutoff] },
      { sql: `DELETE FROM analytics_hourly_stats WHERE hour < ?`, args: [hourCutoff] },
      { sql: `DELETE FROM analytics_hourly_dim_stats WHERE hour < ?`, args: [hourCutoff] },
    ],
    "write",
  );
}

async function queryRows(context: DatabaseContext, sql: string, args: Array<string | number>) {
  const result = await context.sqlite.execute({ sql, args });
  return result.rows;
}

export async function getAnalyticsSummarySqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  querySource: TelemetryQuerySource,
  activeConnections: number,
): Promise<AnalyticsSummary> {
  const { statsTable, statsTimeColumn } = resolveSqliteTables(range);
  const rows = await queryRows(
    context,
    `SELECT
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count
     FROM ${statsTable}
     WHERE target_key = ? AND ${statsTimeColumn} >= ? AND ${statsTimeColumn} <= ?`,
    [targetKey, range.start, range.end],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  return analyticsSummarySchema.parse({
    targetKey,
    rangeStart: range.start,
    rangeEnd: range.end,
    querySource,
    uploadBytes: toNumber(row?.upload_bytes),
    downloadBytes: toNumber(row?.download_bytes),
    connectionCount: toNumber(row?.connection_count),
    activeConnections,
  });
}

export async function getAnalyticsTrendSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  bucketMinutes: number,
): Promise<AnalyticsTrendPoint[]> {
  const useHourly = bucketMinutes >= 60;
  const table = useHourly ? "analytics_hourly_stats" : "analytics_minute_stats";
  const timeColumn = useHourly ? "hour" : "minute";
  const rows = await queryRows(
    context,
    `SELECT ${timeColumn} AS bucket_time, upload_bytes, download_bytes, connection_count
      FROM ${table}
      WHERE target_key = ? AND ${timeColumn} >= ? AND ${timeColumn} <= ?
      ORDER BY ${timeColumn} ASC`,
    [targetKey, range.start, range.end],
  );
  const buckets = new Map<string, { uploadBytes: number; downloadBytes: number; connectionCount: number }>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const rawBucket = typeof row.bucket_time === "string" ? row.bucket_time : range.start;
    const key = bucketTime(rawBucket, bucketMinutes);
    const current = buckets.get(key) ?? { uploadBytes: 0, downloadBytes: 0, connectionCount: 0 };
    current.uploadBytes += toNumber(row.upload_bytes);
    current.downloadBytes += toNumber(row.download_bytes);
    current.connectionCount += toNumber(row.connection_count);
    buckets.set(key, current);
  }
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, values]) => analyticsTrendPointSchema.parse({ bucket, ...values }));
}

async function listByGroupSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  groupExpr: string,
  labelExpr: string,
  metaColumns: string[],
  limit: number,
): Promise<AnalyticsListItem[]> {
  const { dimTable, dimTimeColumn } = resolveSqliteTables(range);
  const selectMeta = metaColumns.length > 0 ? `, ${metaColumns.join(", ")}` : "";
  const rows = await queryRows(
    context,
    `SELECT
      ${groupExpr} AS item_key,
      ${labelExpr} AS label,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count,
      MAX(${dimTimeColumn}) AS last_seen
      ${selectMeta}
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ?
     GROUP BY ${groupExpr}
     ORDER BY (SUM(upload_bytes) + SUM(download_bytes)) DESC
     LIMIT ?`,
    [targetKey, range.start, range.end, limit],
  );
  return (rows as Array<Record<string, unknown>>).map((row) =>
    analyticsListItemSchema.parse({
      key: normalizeAnalyticsKey(row.item_key, row.label),
      label: normalizeAnalyticsKey(row.label, row.item_key),
      uploadBytes: toNumber(row.upload_bytes),
      downloadBytes: toNumber(row.download_bytes),
      connectionCount: toNumber(row.connection_count),
      lastSeen: toNullableString(row.last_seen),
      meta: Object.fromEntries(
        metaColumns.map((column) => [column, row[column.replace(/\s+AS\s+.*/i, "").trim().split(".").pop() ?? column] ?? null]),
      ),
    }),
  );
}

export async function listAnalyticsDomainsSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  const { dimTable, dimTimeColumn } = resolveSqliteTables({ start: parsed.start!, end: parsed.end! });
  const rows = await queryRows(
    context,
    `SELECT
      domain AS item_key,
      CASE WHEN domain = '' THEN '(no host)' ELSE domain END AS label,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count,
      MAX(${dimTimeColumn}) AS last_seen,
      MAX(proxy_name) AS proxy_name,
      MAX(proxy_chain) AS proxy_chain,
      COUNT(DISTINCT NULLIF(destination_ip, '')) AS ip_count
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ?
     GROUP BY domain
     ORDER BY (SUM(upload_bytes) + SUM(download_bytes)) DESC
     LIMIT ?`,
    [targetKey, parsed.start!, parsed.end!, parsed.limit],
  );
  return (rows as Array<Record<string, unknown>>).map((row) =>
    analyticsListItemSchema.parse({
      key: normalizeAnalyticsKey(row.item_key, row.label),
      label: normalizeAnalyticsKey(row.label, row.item_key),
      uploadBytes: toNumber(row.upload_bytes),
      downloadBytes: toNumber(row.download_bytes),
      connectionCount: toNumber(row.connection_count),
      lastSeen: toNullableString(row.last_seen),
      meta: {
        proxy_name: row.proxy_name ?? "",
        proxy_chain: row.proxy_chain ?? "",
        ip_count: toNumber(row.ip_count),
      },
    }),
  );
}

export async function listAnalyticsProxiesSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  return listByGroupSqlite(
    context,
    targetKey,
    { start: parsed.start!, end: parsed.end! },
    "proxy_name",
    "proxy_name",
    ["MAX(proxy_chain) AS proxy_chain"],
    parsed.limit,
  );
}

export async function listAnalyticsRulesSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  return listByGroupSqlite(
    context,
    targetKey,
    { start: parsed.start!, end: parsed.end! },
    "rule_label",
    "rule_label",
    ["MAX(proxy_name) AS final_proxy"],
    parsed.limit,
  );
}

export async function listAnalyticsRegionsSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  const { dimTable, dimTimeColumn } = resolveSqliteTables({ start: parsed.start!, end: parsed.end! });
  const rows = await queryRows(
    context,
    `SELECT
      destination_ip,
      country_code,
      country_name,
      continent_code,
      continent_name,
      proxy_name,
      proxy_chain,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count,
      MAX(${dimTimeColumn}) AS last_seen
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ?
     GROUP BY destination_ip, country_code, country_name, continent_code, continent_name, proxy_name, proxy_chain`,
    [targetKey, parsed.start!, parsed.end!],
  );

  const regionGeoIpService = getAnalyticsRegionGeoIpService();
  await regionGeoIpService.whenReady();
  const destinationTraffic = new Map<string, number>();
  for (const row of rows as Array<Record<string, unknown>>) {
    const destinationIp = typeof row.destination_ip === "string" ? row.destination_ip : "";
    if (!destinationIp) {
      continue;
    }
    destinationTraffic.set(destinationIp, (destinationTraffic.get(destinationIp) ?? 0) + toNumber(row.upload_bytes) + toNumber(row.download_bytes));
  }
  const destinationIps = Array.from(destinationTraffic.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([destinationIp]) => destinationIp);
  const destinationGeoByIp = new Map<string, GeoLocation>();
  let primedLookups = 0;
  for (const ip of destinationIps) {
    const geo = regionGeoIpService.lookupIpCached(ip);
    destinationGeoByIp.set(ip, geo);
    if (!isKnownGeoLocation(geo) && primedLookups < 80) {
      regionGeoIpService.primeIpLookup(ip);
      primedLookups += 1;
    }
  }

  const regions = new Map<
    string,
    {
      countryCode: string;
      countryName: string;
      continentName: string;
      uploadBytes: number;
      downloadBytes: number;
      connectionCount: number;
      lastSeen: string | null;
    }
  >();

  for (const row of rows as Array<Record<string, unknown>>) {
    const destinationIp = typeof row.destination_ip === "string" ? row.destination_ip : "";
    const destinationGeo = destinationIp ? destinationGeoByIp.get(destinationIp) : null;
    const storedGeo: GeoLocation = {
      countryCode: typeof row.country_code === "string" && row.country_code ? row.country_code : "Unknown",
      countryName: typeof row.country_name === "string" && row.country_name ? row.country_name : "Unknown",
      continentCode: typeof row.continent_code === "string" && row.continent_code ? row.continent_code : "Unknown",
      continentName: typeof row.continent_name === "string" && row.continent_name ? row.continent_name : "Unknown",
    };
    const inferred = inferGeoFromText(`${String(row.proxy_name ?? "")} ${String(row.proxy_chain ?? "")}`);
    const geo =
      destinationGeo && isKnownGeoLocation(destinationGeo)
        ? destinationGeo
        : isKnownGeoLocation(storedGeo)
          ? storedGeo
          : inferred ?? storedGeo;
    const countryCode = geo.countryCode || "Unknown";
    const countryName = getCountryDisplayName(countryCode, geo.countryName || countryCode);
    const continentName = geo.continentName || "";
    const current = regions.get(countryCode) ?? {
      countryCode,
      countryName,
      continentName,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
      lastSeen: null,
    };
    current.uploadBytes += toNumber(row.upload_bytes);
    current.downloadBytes += toNumber(row.download_bytes);
    current.connectionCount += toNumber(row.connection_count);
    const lastSeen = toNullableString(row.last_seen);
    if (lastSeen && (!current.lastSeen || lastSeen > current.lastSeen)) {
      current.lastSeen = lastSeen;
    }
    regions.set(countryCode, current);
  }

  return Array.from(regions.values())
    .sort((left, right) => right.uploadBytes + right.downloadBytes - (left.uploadBytes + left.downloadBytes))
    .slice(0, parsed.limit)
    .map((row) =>
      analyticsListItemSchema.parse({
        key: row.countryCode,
        label: row.countryName,
        uploadBytes: row.uploadBytes,
        downloadBytes: row.downloadBytes,
        connectionCount: row.connectionCount,
        lastSeen: row.lastSeen,
        meta: {
          country_code: row.countryCode,
          country_name: row.countryName,
          continent_name: row.continentName,
        },
      }),
    );
}

export async function listAnalyticsDevicesSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  return listByGroupSqlite(
    context,
    targetKey,
    { start: parsed.start!, end: parsed.end! },
    "CASE WHEN source_ip = '' THEN '(unknown device)' ELSE source_ip END",
    "CASE WHEN source_ip = '' THEN '(unknown device)' ELSE source_ip END",
    [],
    parsed.limit,
  );
}

export async function listAnalyticsIpsSqlite(context: DatabaseContext, targetKey: string, query: AnalyticsQuery) {
  const parsed = analyticsQuerySchema.parse(query);
  const { dimTable, dimTimeColumn } = resolveSqliteTables({ start: parsed.start!, end: parsed.end! });
  const rows = await queryRows(
    context,
    `SELECT
      CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END AS item_key,
      CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END AS label,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count,
      MAX(${dimTimeColumn}) AS last_seen,
      MAX(country_code) AS country_code,
      MAX(country_name) AS country_name,
      MAX(proxy_name) AS proxy_name,
      MAX(proxy_chain) AS proxy_chain,
      COUNT(DISTINCT NULLIF(domain, '')) AS domain_count
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ?
     GROUP BY item_key, label
     ORDER BY (SUM(upload_bytes) + SUM(download_bytes)) DESC
     LIMIT ?`,
    [targetKey, parsed.start!, parsed.end!, parsed.limit],
  );
  return (rows as Array<Record<string, unknown>>).map((row) =>
    analyticsListItemSchema.parse({
      key: normalizeAnalyticsKey(row.item_key, row.label),
      label: normalizeAnalyticsKey(row.label, row.item_key),
      uploadBytes: toNumber(row.upload_bytes),
      downloadBytes: toNumber(row.download_bytes),
      connectionCount: toNumber(row.connection_count),
      lastSeen: toNullableString(row.last_seen),
      meta: {
        country_code: row.country_code ?? "",
        country_name: row.country_name ?? "",
        proxy_name: row.proxy_name ?? "",
        proxy_chain: row.proxy_chain ?? "",
        domain_count: toNumber(row.domain_count),
      },
    }),
  );
}

async function detailByGroupSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  whereSql: string,
  whereArgs: Array<string | number>,
  groupExpr: string,
  labelExpr: string,
  limit: number,
  scope?: {
    proxyName?: string;
    ruleLabel?: string;
    sourceIp?: string;
  },
): Promise<AnalyticsDetailResponse> {
  const { dimTable, dimTimeColumn } = resolveSqliteTables(range);
  const scopeClauses: string[] = [];
  const scopeArgs: Array<string | number> = [];
  if (scope?.proxyName) {
    scopeClauses.push("proxy_name = ?");
    scopeArgs.push(scope.proxyName);
  }
  if (scope?.ruleLabel) {
    scopeClauses.push("rule_label = ?");
    scopeArgs.push(scope.ruleLabel);
  }
  if (scope?.sourceIp) {
    scopeClauses.push("source_ip = ?");
    scopeArgs.push(scope.sourceIp);
  }
  const combinedWhere = [whereSql, ...scopeClauses].join(" AND ");
  const rows = await queryRows(
    context,
    `SELECT
      ${groupExpr} AS item_key,
      ${labelExpr} AS label,
      COALESCE(SUM(upload_bytes), 0) AS upload_bytes,
      COALESCE(SUM(download_bytes), 0) AS download_bytes,
      COALESCE(SUM(connection_count), 0) AS connection_count,
      MAX(${dimTimeColumn}) AS last_seen
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ? AND ${combinedWhere}
     GROUP BY ${groupExpr}
     ORDER BY (SUM(upload_bytes) + SUM(download_bytes)) DESC
     LIMIT ?`,
    [targetKey, range.start, range.end, ...whereArgs, ...scopeArgs, limit],
  );
  return analyticsDetailResponseSchema.parse({
    items: (rows as Array<Record<string, unknown>>).map((row) => ({
      key: normalizeAnalyticsKey(row.item_key, row.label),
      label: normalizeAnalyticsKey(row.label, row.item_key),
      uploadBytes: toNumber(row.upload_bytes),
      downloadBytes: toNumber(row.download_bytes),
      connectionCount: toNumber(row.connection_count),
      lastSeen: toNullableString(row.last_seen),
      meta: {},
    })),
    querySource: "sqlite",
  });
}

export async function getAnalyticsDomainProxiesSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  domain: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(context, targetKey, range, "domain = ?", [domain], "proxy_name", "proxy_name", limit, scope);
}

export async function getAnalyticsProxyDomainsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  proxyName: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "proxy_name = ?",
    [proxyName],
    "domain",
    "CASE WHEN domain = '' THEN '(no host)' ELSE domain END",
    limit,
    scope,
  );
}

export async function getAnalyticsRuleDomainsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  ruleLabel: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "rule_label = ?",
    [ruleLabel],
    "domain",
    "CASE WHEN domain = '' THEN '(no host)' ELSE domain END",
    limit,
    scope,
  );
}

export async function getAnalyticsDomainIpsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  domain: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "domain = ?",
    [domain],
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    limit,
    scope,
  );
}

export async function getAnalyticsProxyIpsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  proxyName: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "proxy_name = ?",
    [proxyName],
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    limit,
    scope,
  );
}

export async function getAnalyticsRuleIpsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  ruleLabel: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "rule_label = ?",
    [ruleLabel],
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    limit,
    scope,
  );
}

export async function getAnalyticsDeviceDomainsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  device: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "source_ip = ?",
    [device],
    "domain",
    "CASE WHEN domain = '' THEN '(no host)' ELSE domain END",
    limit,
    scope,
  );
}

export async function getAnalyticsDeviceIpsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  device: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "source_ip = ?",
    [device],
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    "CASE WHEN destination_ip = '' THEN '(unknown ip)' ELSE destination_ip END",
    limit,
    scope,
  );
}

export async function getAnalyticsIpDomainsSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  ip: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "destination_ip = ?",
    [ip],
    "domain",
    "CASE WHEN domain = '' THEN '(no host)' ELSE domain END",
    limit,
    scope,
  );
}

export async function getAnalyticsIpProxiesSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  ip: string,
  limit: number,
  scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
) {
  return detailByGroupSqlite(
    context,
    targetKey,
    range,
    "destination_ip = ?",
    [ip],
    "proxy_name",
    "proxy_name",
    limit,
    scope,
  );
}

export async function getAnalyticsRuleFlowSqlite(
  context: DatabaseContext,
  targetKey: string,
  range: TimeRange,
  sourceIp?: string,
): Promise<AnalyticsRuleFlowResponse> {
  const { dimTable, dimTimeColumn } = resolveSqliteTables(range);
  const sourceIpFilter = sourceIp?.trim();
  const rows = await queryRows(
    context,
    `SELECT
      source_ip,
      rule_label,
      proxy_chain,
      SUM(upload_bytes) AS upload_bytes,
      SUM(download_bytes) AS download_bytes,
      SUM(connection_count) AS connection_count
     FROM ${dimTable}
     WHERE target_key = ? AND ${dimTimeColumn} >= ? AND ${dimTimeColumn} <= ? AND rule_label <> ''
       ${sourceIpFilter ? "AND source_ip = ?" : ""}
     GROUP BY source_ip, rule_label, proxy_chain
     ORDER BY (SUM(upload_bytes) + SUM(download_bytes)) DESC`,
    sourceIpFilter ? [targetKey, range.start, range.end, sourceIpFilter] : [targetKey, range.start, range.end],
  );

  const nodes = new Map<string, FlowNodeAccumulator>();
  const edges = new Map<string, FlowEdgeAccumulator>();

  for (const row of rows as Array<Record<string, unknown>>) {
    const sourceIp = String(row.source_ip || "").trim() || "(unknown device)";
    const ruleLabel = String(row.rule_label ?? "").trim();
    if (!ruleLabel) {
      continue;
    }
    const uploadBytes = toNumber(row.upload_bytes);
    const downloadBytes = toNumber(row.download_bytes);
    const connectionCount = toNumber(row.connection_count);
    const sourceNodeId = `source:${sourceIp}`;
    upsertFlowNode(nodes, { id: sourceNodeId, label: sourceIp, layer: 0, nodeType: "source" }, uploadBytes, downloadBytes, connectionCount);

    const ruleNodeId = `rule:${ruleLabel}`;
    upsertFlowNode(nodes, { id: ruleNodeId, label: ruleLabel, layer: 1, nodeType: "rule" }, uploadBytes, downloadBytes, connectionCount);
    upsertFlowEdge(edges, sourceNodeId, ruleNodeId, uploadBytes, downloadBytes, connectionCount);

    const parts = String(row.proxy_chain || "").split(">").map((part) => part.trim()).filter(Boolean);
    const normalizedParts = normalizeFlowProxyParts(parts);
    let previousNodeId = ruleNodeId;
    for (let index = 0; index < normalizedParts.length; index += 1) {
      const part = normalizedParts[index]!;
      const nodeType = flowNodeTypeForPart(index, normalizedParts);
      const nodeId = `${nodeType}:${part}`;
      upsertFlowNode(nodes, { id: nodeId, label: part, layer: index + 2, nodeType }, uploadBytes, downloadBytes, connectionCount);
      upsertFlowEdge(edges, previousNodeId, nodeId, uploadBytes, downloadBytes, connectionCount);
      previousNodeId = nodeId;
    }
  }

  const nodeList = Array.from(nodes.values()).map((node) => analyticsFlowNodeSchema.parse(node));
  const edgeList = Array.from(edges.values()).map((edge) => analyticsFlowEdgeSchema.parse(edge));
  const maxLayer = nodeList.reduce((maximum, node) => Math.max(maximum, node.layer), 0);
  return analyticsRuleFlowResponseSchema.parse({
    querySource: "sqlite",
    nodes: nodeList,
    edges: edgeList,
    maxLayer,
  });
}

export function resolveTelemetryQuerySource(
  preferred: string | undefined,
  settings: TelemetrySettings,
  fallback: string | undefined,
) {
  return telemetryQuerySourceSchema.parse(preferred ?? settings.querySource ?? fallback ?? "auto");
}
