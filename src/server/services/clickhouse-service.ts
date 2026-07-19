import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  analyticsDetailResponseSchema,
  analyticsFlowEdgeSchema,
  analyticsFlowNodeSchema,
  analyticsListItemSchema,
  analyticsSummarySchema,
  analyticsTrendPointSchema,
  analyticsRuleFlowResponseSchema,
  type AnalyticsDetailResponse,
  type AnalyticsListItem,
  type AnalyticsQuery,
  type AnalyticsRuleFlowResponse,
  type TelemetryQuerySource,
} from "../../shared/telemetry.js";
import type { PersistedTrafficBatch } from "../db/telemetry-db.js";

type TimeRange = { start: string; end: string };

type QueryRow = Record<string, unknown>;

function normalizeAnalyticsKey(value: unknown, fallbackLabel: unknown) {
  const rawValue = typeof value === "string" ? value : "";
  if (rawValue.length > 0) {
    return rawValue;
  }
  const rawLabel = typeof fallbackLabel === "string" ? fallbackLabel : "";
  return rawLabel.length > 0 ? rawLabel : "(unknown)";
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function bucketExpression(bucketMinutes: number) {
  if (bucketMinutes >= 60) {
    return "toStartOfHour(bucket_time)";
  }
  if (bucketMinutes === 5) {
    return "toStartOfInterval(bucket_time, INTERVAL 5 MINUTE)";
  }
  return "bucket_time";
}

function selectBucketKind(range: TimeRange) {
  return new Date(range.end).getTime() - new Date(range.start).getTime() > 48 * 60 * 60 * 1000 ? "hour" : "minute";
}

export class ClickHouseService {
  private client: ClickHouseClient | null = null;
  private database: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const url = env.CLICKHOUSE_URL?.trim();
    this.database = env.CLICKHOUSE_DATABASE?.trim() || "default";
    if (!url) {
      return;
    }

    this.client = createClient({
      url,
      username: env.CLICKHOUSE_USER?.trim() || "default",
      password: env.CLICKHOUSE_PASSWORD?.trim() || "",
      database: this.database,
    });
  }

  isConfigured() {
    return this.client !== null;
  }

  async ensureSchema() {
    if (!this.client) {
      return;
    }
    const ddl = [
      `CREATE TABLE IF NOT EXISTS traffic_detail (
        target_key String,
        ts DateTime64(3, 'UTC'),
        domain String,
        destination_ip String,
        source_ip String,
        proxy_name String,
        proxy_chain String,
        rule_label String,
        country_code String,
        country_name String,
        continent_code String,
        continent_name String,
        upload_bytes UInt64,
        download_bytes UInt64,
        connection_count UInt64
      ) ENGINE = MergeTree
      ORDER BY (target_key, ts, domain, destination_ip, source_ip, proxy_name, rule_label)`,
      `CREATE TABLE IF NOT EXISTS traffic_detail_buffer AS traffic_detail ENGINE = MergeTree ORDER BY (target_key, ts, domain, destination_ip, source_ip, proxy_name, rule_label)`,
      `CREATE TABLE IF NOT EXISTS traffic_agg (
        target_key String,
        bucket_kind LowCardinality(String),
        bucket_time DateTime('UTC'),
        domain String,
        destination_ip String,
        source_ip String,
        proxy_name String,
        proxy_chain String,
        rule_label String,
        country_code String,
        country_name String,
        continent_code String,
        continent_name String,
        upload_bytes UInt64,
        download_bytes UInt64,
        connection_count UInt64
      ) ENGINE = SummingMergeTree
      ORDER BY (target_key, bucket_kind, bucket_time, domain, destination_ip, source_ip, proxy_name, rule_label)`,
      `CREATE TABLE IF NOT EXISTS traffic_agg_buffer AS traffic_agg ENGINE = SummingMergeTree ORDER BY (target_key, bucket_kind, bucket_time, domain, destination_ip, source_ip, proxy_name, rule_label)`,
      `CREATE TABLE IF NOT EXISTS region_agg (
        target_key String,
        bucket_kind LowCardinality(String),
        bucket_time DateTime('UTC'),
        country_code String,
        country_name String,
        continent_code String,
        continent_name String,
        upload_bytes UInt64,
        download_bytes UInt64,
        connection_count UInt64
      ) ENGINE = SummingMergeTree
      ORDER BY (target_key, bucket_kind, bucket_time, country_code)`,
      `CREATE TABLE IF NOT EXISTS region_agg_buffer AS region_agg ENGINE = SummingMergeTree ORDER BY (target_key, bucket_kind, bucket_time, country_code)`,
    ];

    for (const statement of ddl) {
      await this.client.command({ query: statement });
    }
  }

  async ping() {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async writeBatch(batch: PersistedTrafficBatch) {
    if (!this.client) {
      return;
    }

    const detailRows = batch.minuteDims.map((item) => ({
      target_key: item.targetKey,
      ts: item.lastSeen,
      domain: item.domain,
      destination_ip: item.destinationIp,
      source_ip: item.sourceIp,
      proxy_name: item.proxyName,
      proxy_chain: item.proxyChain,
      rule_label: item.ruleLabel,
      country_code: item.countryCode,
      country_name: item.countryName,
      continent_code: item.continentCode,
      continent_name: item.continentName,
      upload_bytes: item.uploadBytes,
      download_bytes: item.downloadBytes,
      connection_count: item.connectionCount,
    }));
    if (detailRows.length > 0) {
      await this.client.insert({
        table: "traffic_detail",
        values: detailRows,
        format: "JSONEachRow",
      });
    }

    const aggRows = [
      ...batch.minuteDims.map((item) => ({
        target_key: item.targetKey,
        bucket_kind: "minute",
        bucket_time: item.minute,
        domain: item.domain,
        destination_ip: item.destinationIp,
        source_ip: item.sourceIp,
        proxy_name: item.proxyName,
        proxy_chain: item.proxyChain,
        rule_label: item.ruleLabel,
        country_code: item.countryCode,
        country_name: item.countryName,
        continent_code: item.continentCode,
        continent_name: item.continentName,
        upload_bytes: item.uploadBytes,
        download_bytes: item.downloadBytes,
        connection_count: item.connectionCount,
      })),
      ...batch.hourlyDims.map((item) => ({
        target_key: item.targetKey,
        bucket_kind: "hour",
        bucket_time: item.hour,
        domain: item.domain,
        destination_ip: item.destinationIp,
        source_ip: item.sourceIp,
        proxy_name: item.proxyName,
        proxy_chain: item.proxyChain,
        rule_label: item.ruleLabel,
        country_code: item.countryCode,
        country_name: item.countryName,
        continent_code: item.continentCode,
        continent_name: item.continentName,
        upload_bytes: item.uploadBytes,
        download_bytes: item.downloadBytes,
        connection_count: item.connectionCount,
      })),
    ];
    if (aggRows.length > 0) {
      await this.client.insert({
        table: "traffic_agg",
        values: aggRows,
        format: "JSONEachRow",
      });
    }

    const regionRows = [
      ...batch.minuteDims.map((item) => ({
        target_key: item.targetKey,
        bucket_kind: "minute",
        bucket_time: item.minute,
        country_code: item.countryCode,
        country_name: item.countryName,
        continent_code: item.continentCode,
        continent_name: item.continentName,
        upload_bytes: item.uploadBytes,
        download_bytes: item.downloadBytes,
        connection_count: item.connectionCount,
      })),
      ...batch.hourlyDims.map((item) => ({
        target_key: item.targetKey,
        bucket_kind: "hour",
        bucket_time: item.hour,
        country_code: item.countryCode,
        country_name: item.countryName,
        continent_code: item.continentCode,
        continent_name: item.continentName,
        upload_bytes: item.uploadBytes,
        download_bytes: item.downloadBytes,
        connection_count: item.connectionCount,
      })),
    ];
    if (regionRows.length > 0) {
      await this.client.insert({
        table: "region_agg",
        values: regionRows,
        format: "JSONEachRow",
      });
    }
  }

  async getSummary(targetKey: string, range: TimeRange, querySource: TelemetryQuerySource, activeConnections: number) {
    const bucketKind = selectBucketKind(range);
    const rows = await this.queryRows(
      `SELECT
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})`,
      { targetKey, bucketKind, start: range.start, end: range.end },
    );
    const row = rows[0] ?? {};
    return analyticsSummarySchema.parse({
      targetKey,
      rangeStart: range.start,
      rangeEnd: range.end,
      querySource,
      uploadBytes: toNumber(row.upload_bytes),
      downloadBytes: toNumber(row.download_bytes),
      connectionCount: toNumber(row.connection_count),
      activeConnections,
    });
  }

  async getTrend(targetKey: string, range: TimeRange, bucketMinutes: number) {
    const bucketKind = bucketMinutes >= 60 ? "hour" : "minute";
    const rows = await this.queryRows(
      `SELECT
        ${bucketExpression(bucketMinutes)} AS bucket,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
       GROUP BY bucket
       ORDER BY bucket ASC`,
      { targetKey, bucketKind, start: range.start, end: range.end },
    );
    return rows.map((row) =>
      analyticsTrendPointSchema.parse({
        bucket: String(row.bucket),
        uploadBytes: toNumber(row.upload_bytes),
        downloadBytes: toNumber(row.download_bytes),
        connectionCount: toNumber(row.connection_count),
      }),
    );
  }

  async listDomains(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    const bucketKind = selectBucketKind(range);
    const rows = await this.queryRows(
      `SELECT
        domain AS item_key,
        if(domain = '', '(no host)', domain) AS label,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count,
        max(bucket_time) AS last_seen,
        any(proxy_name) AS proxy_name,
        any(proxy_chain) AS proxy_chain,
        uniqIf(destination_ip, destination_ip != '') AS ip_count
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
       GROUP BY domain
       ORDER BY (upload_bytes + download_bytes) DESC
       LIMIT {limit:UInt32}`,
      { targetKey, bucketKind, start: range.start, end: range.end, limit: String(query.limit) },
    );
    return rows.map((row) =>
      analyticsListItemSchema.parse({
        key: normalizeAnalyticsKey(row.item_key, row.label),
        label: String(row.label || row.item_key || "(unknown)"),
        uploadBytes: toNumber(row.upload_bytes),
        downloadBytes: toNumber(row.download_bytes),
        connectionCount: toNumber(row.connection_count),
        lastSeen: String(row.last_seen || ""),
        meta: {
          proxy_name: row.proxy_name ?? "",
          proxy_chain: row.proxy_chain ?? "",
          ip_count: toNumber(row.ip_count),
        },
      }),
    );
  }

  async listProxies(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    return this.listGrouped(targetKey, range, query.limit, "proxy_name", "proxy_name", "traffic_agg", false);
  }

  async listRules(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    return this.listGrouped(targetKey, range, query.limit, "rule_label", "rule_label", "traffic_agg", false);
  }

  async listRegions(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    return this.listGrouped(targetKey, range, query.limit, "country_code", "country_name", "region_agg", true);
  }

  async listDevices(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    return this.listGrouped(targetKey, range, query.limit, "source_ip", "source_ip", "traffic_agg", false);
  }

  async listIps(targetKey: string, range: TimeRange, query: AnalyticsQuery) {
    const bucketKind = selectBucketKind(range);
    const rows = await this.queryRows(
      `SELECT
        if(destination_ip = '', '(unknown ip)', destination_ip) AS item_key,
        if(destination_ip = '', '(unknown ip)', destination_ip) AS label,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count,
        max(bucket_time) AS last_seen,
        any(country_code) AS country_code,
        any(country_name) AS country_name,
        any(proxy_name) AS proxy_name,
        any(proxy_chain) AS proxy_chain,
        uniqIf(domain, domain != '') AS domain_count
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
       GROUP BY item_key, label
       ORDER BY (upload_bytes + download_bytes) DESC
       LIMIT {limit:UInt32}`,
      { targetKey, bucketKind, start: range.start, end: range.end, limit: String(query.limit) },
    );
    return rows.map((row) =>
      analyticsListItemSchema.parse({
        key: normalizeAnalyticsKey(row.item_key, row.label),
        label: String(row.label || row.item_key || "(unknown)"),
        uploadBytes: toNumber(row.upload_bytes),
        downloadBytes: toNumber(row.download_bytes),
        connectionCount: toNumber(row.connection_count),
        lastSeen: String(row.last_seen || ""),
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

  async domainProxies(
    targetKey: string,
    range: TimeRange,
    domain: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "proxy_name", "proxy_name", "domain = {value:String}", { value: domain }, scope);
  }

  async proxyDomains(
    targetKey: string,
    range: TimeRange,
    proxyName: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "domain", "domain", "proxy_name = {value:String}", { value: proxyName }, scope);
  }

  async ruleDomains(
    targetKey: string,
    range: TimeRange,
    ruleLabel: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "domain", "domain", "rule_label = {value:String}", { value: ruleLabel }, scope);
  }

  async domainIps(
    targetKey: string,
    range: TimeRange,
    domain: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "destination_ip", "destination_ip", "domain = {value:String}", { value: domain }, scope);
  }

  async proxyIps(
    targetKey: string,
    range: TimeRange,
    proxyName: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "destination_ip", "destination_ip", "proxy_name = {value:String}", { value: proxyName }, scope);
  }

  async ruleIps(
    targetKey: string,
    range: TimeRange,
    ruleLabel: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "destination_ip", "destination_ip", "rule_label = {value:String}", { value: ruleLabel }, scope);
  }

  async deviceDomains(
    targetKey: string,
    range: TimeRange,
    device: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "domain", "domain", "source_ip = {value:String}", { value: device }, scope);
  }

  async deviceIps(
    targetKey: string,
    range: TimeRange,
    device: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "destination_ip", "destination_ip", "source_ip = {value:String}", { value: device }, scope);
  }

  async ipDomains(
    targetKey: string,
    range: TimeRange,
    ip: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(
      targetKey,
      range,
      limit,
      "domain",
      "if(domain = '', '(no host)', domain)",
      "destination_ip = {value:String}",
      { value: ip },
      scope,
    );
  }

  async ipProxies(
    targetKey: string,
    range: TimeRange,
    ip: string,
    limit: number,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ) {
    return this.detailGrouped(targetKey, range, limit, "proxy_name", "proxy_name", "destination_ip = {value:String}", { value: ip }, scope);
  }

  async ruleFlow(targetKey: string, range: TimeRange, sourceIp?: string): Promise<AnalyticsRuleFlowResponse> {
    const bucketKind = selectBucketKind(range);
    const sourceIpFilter = sourceIp?.trim();
    const rows = await this.queryRows(
      `SELECT
        source_ip,
        rule_label,
        proxy_chain,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
         AND rule_label != ''
         ${sourceIpFilter ? "AND source_ip = {sourceIp:String}" : ""}
       GROUP BY source_ip, rule_label, proxy_chain
       ORDER BY (upload_bytes + download_bytes) DESC`,
      { targetKey, bucketKind, start: range.start, end: range.end, sourceIp: sourceIpFilter ?? "" },
    );

    const nodes = new Map<string, { id: string; label: string; layer: number; nodeType: "source" | "domain" | "rule" | "group" | "proxy" | "direct"; uploadBytes: number; downloadBytes: number; connectionCount: number }>();
    const edges = new Map<string, { id: string; source: string; target: string; uploadBytes: number; downloadBytes: number; connectionCount: number }>();

    const flowNodeTypeForPart = (index: number, parts: string[]) => {
      const value = parts[index]?.trim().toUpperCase();
      if (index === parts.length - 1) {
        return value === "DIRECT" ? "direct" as const : "proxy" as const;
      }
      return "group" as const;
    };

    for (const row of rows) {
      const ruleLabel = String(row.rule_label ?? "").trim();
      if (!ruleLabel) continue;
      const uploadBytes = toNumber(row.upload_bytes);
      const downloadBytes = toNumber(row.download_bytes);
      const connectionCount = toNumber(row.connection_count);
      const sourceIp = String(row.source_ip || "").trim() || "(unknown device)";
      const sourceNodeId = `source:${sourceIp}`;
      const sourceNode = nodes.get(sourceNodeId) ?? {
        id: sourceNodeId,
        label: sourceIp,
        layer: 0,
        nodeType: "source" as const,
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      };
      sourceNode.uploadBytes += uploadBytes;
      sourceNode.downloadBytes += downloadBytes;
      sourceNode.connectionCount += connectionCount;
      nodes.set(sourceNodeId, sourceNode);

      const ruleNodeId = `rule:${ruleLabel}`;
      const ruleNode = nodes.get(ruleNodeId) ?? {
        id: ruleNodeId,
        label: ruleLabel,
        layer: 1,
        nodeType: "rule" as const,
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      };
      ruleNode.uploadBytes += uploadBytes;
      ruleNode.downloadBytes += downloadBytes;
      ruleNode.connectionCount += connectionCount;
      nodes.set(ruleNodeId, ruleNode);

      const sourceToRuleEdgeId = `${sourceNodeId}->${ruleNodeId}`;
      const sourceToRuleEdge = edges.get(sourceToRuleEdgeId) ?? {
        id: sourceToRuleEdgeId,
        source: sourceNodeId,
        target: ruleNodeId,
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      };
      sourceToRuleEdge.uploadBytes += uploadBytes;
      sourceToRuleEdge.downloadBytes += downloadBytes;
      sourceToRuleEdge.connectionCount += connectionCount;
      edges.set(sourceToRuleEdgeId, sourceToRuleEdge);

      const parts = String(row.proxy_chain || "").split(">").map((part) => part.trim()).filter(Boolean);
      const normalizedParts = parts.length > 0 ? [...parts].reverse() : ["DIRECT"];
      let previousNodeId = ruleNodeId;
      for (let index = 0; index < normalizedParts.length; index += 1) {
        const part = normalizedParts[index]!;
        const nodeId = `${flowNodeTypeForPart(index, normalizedParts)}:${part}`;
        const node = nodes.get(nodeId) ?? {
          id: nodeId,
          label: part,
          layer: index + 2,
          nodeType: flowNodeTypeForPart(index, normalizedParts),
          uploadBytes: 0,
          downloadBytes: 0,
          connectionCount: 0,
        };
        node.uploadBytes += uploadBytes;
        node.downloadBytes += downloadBytes;
        node.connectionCount += connectionCount;
        nodes.set(nodeId, node);

        const edgeId = `${previousNodeId}->${nodeId}`;
        const edge = edges.get(edgeId) ?? {
          id: edgeId,
          source: previousNodeId,
          target: nodeId,
          uploadBytes: 0,
          downloadBytes: 0,
          connectionCount: 0,
        };
        edge.uploadBytes += uploadBytes;
        edge.downloadBytes += downloadBytes;
        edge.connectionCount += connectionCount;
        edges.set(edgeId, edge);
        previousNodeId = nodeId;
      }
    }

    const nodeList = Array.from(nodes.values()).map((node) => analyticsFlowNodeSchema.parse(node));
    const edgeList = Array.from(edges.values()).map((edge) => analyticsFlowEdgeSchema.parse(edge));
    return analyticsRuleFlowResponseSchema.parse({
      querySource: "clickhouse",
      nodes: nodeList,
      edges: edgeList,
      maxLayer: nodeList.reduce((maximum, node) => Math.max(maximum, node.layer), 0),
    });
  }

  private async listGrouped(
    targetKey: string,
    range: TimeRange,
    limit: number,
    groupBy: string,
    labelField: string,
    table: "traffic_agg" | "region_agg",
    useRegionTable: boolean,
  ): Promise<AnalyticsListItem[]> {
    const bucketKind = selectBucketKind(range);
    const rows = await this.queryRows(
      `SELECT
        ${groupBy} AS item_key,
        ${labelField} AS label,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count,
        max(bucket_time) AS last_seen
       FROM ${table}
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
       GROUP BY item_key, label
       ORDER BY (upload_bytes + download_bytes) DESC
       LIMIT {limit:UInt32}`,
      { targetKey, bucketKind, start: range.start, end: range.end, limit: String(limit) },
    );
    return rows.map((row) =>
      analyticsListItemSchema.parse({
        key: normalizeAnalyticsKey(row.item_key, row.label),
        label: String(row.label || row.item_key || "(unknown)"),
        uploadBytes: toNumber(row.upload_bytes),
        downloadBytes: toNumber(row.download_bytes),
        connectionCount: toNumber(row.connection_count),
        lastSeen: String(row.last_seen || ""),
        meta: useRegionTable ? {} : {},
      }),
    );
  }

  private async detailGrouped(
    targetKey: string,
    range: TimeRange,
    limit: number,
    groupBy: string,
    labelField: string,
    filterSql: string,
    params: Record<string, string>,
    scope?: { proxyName?: string; ruleLabel?: string; sourceIp?: string },
  ): Promise<AnalyticsDetailResponse> {
    const bucketKind = selectBucketKind(range);
    const scopeSql = [
      scope?.proxyName ? "proxy_name = {scopeProxyName:String}" : "",
      scope?.ruleLabel ? "rule_label = {scopeRuleLabel:String}" : "",
      scope?.sourceIp ? "source_ip = {scopeSourceIp:String}" : "",
    ]
      .filter(Boolean)
      .map((clause) => `AND ${clause}`)
      .join("\n         ");
    const rows = await this.queryRows(
      `SELECT
        ${groupBy} AS item_key,
        ${labelField} AS label,
        sum(upload_bytes) AS upload_bytes,
        sum(download_bytes) AS download_bytes,
        sum(connection_count) AS connection_count,
        max(bucket_time) AS last_seen
       FROM traffic_agg
       WHERE target_key = {targetKey:String}
         AND bucket_kind = {bucketKind:String}
         AND bucket_time >= parseDateTimeBestEffort({start:String})
         AND bucket_time <= parseDateTimeBestEffort({end:String})
         AND ${filterSql}
         ${scopeSql}
       GROUP BY item_key, label
       ORDER BY (upload_bytes + download_bytes) DESC
       LIMIT {limit:UInt32}`,
      {
        targetKey,
        bucketKind,
        start: range.start,
        end: range.end,
        limit: String(limit),
        ...params,
        ...(scope?.proxyName ? { scopeProxyName: scope.proxyName } : {}),
        ...(scope?.ruleLabel ? { scopeRuleLabel: scope.ruleLabel } : {}),
        ...(scope?.sourceIp ? { scopeSourceIp: scope.sourceIp } : {}),
      },
    );
    return analyticsDetailResponseSchema.parse({
      items: rows.map((row) => ({
        key: normalizeAnalyticsKey(row.item_key, row.label),
        label: String(row.label || row.item_key || "(unknown)"),
        uploadBytes: toNumber(row.upload_bytes),
        downloadBytes: toNumber(row.download_bytes),
        connectionCount: toNumber(row.connection_count),
        lastSeen: String(row.last_seen || ""),
        meta: {},
      })),
      querySource: "clickhouse",
    });
  }

  private async queryRows(query: string, query_params: Record<string, string>): Promise<QueryRow[]> {
    if (!this.client) {
      throw new Error("ClickHouse is not configured.");
    }
    const resultSet = await this.client.query({
      query,
      format: "JSONEachRow",
      query_params,
    });
    return (await resultSet.json()) as QueryRow[];
  }
}
