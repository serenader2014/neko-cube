import {
  analyticsDetailResponseSchema,
  analyticsFlowEdgeSchema,
  analyticsFlowNodeSchema,
  analyticsListItemSchema,
  analyticsRuleFlowResponseSchema,
  analyticsSummarySchema,
  analyticsTrendPointSchema,
  type AnalyticsRuleFlowResponse,
  type AnalyticsDetailResponse,
  type AnalyticsListItem,
  type AnalyticsSummary,
  type AnalyticsTrendPoint,
  type TelemetryQuerySource,
} from "../../shared/telemetry.js";
import type { PersistedTrafficRecord } from "../db/telemetry-db.js";
import { pickTrendBucketMinutes } from "./telemetry-utils.js";

type PendingAnalyticsRecord = PersistedTrafficRecord & {
  id: number;
  timestamp: string;
  pendingSqlite: boolean;
  pendingClickhouse: boolean;
};

type TimeRange = { start: string; end: string };
type DetailScope = {
  proxyName?: string;
  ruleLabel?: string;
  sourceIp?: string;
};

type RealtimeAnalyticsStoreOptions = {
  maxPendingClickhouseAgeMs?: number;
  maxPendingClickhouseRecords?: number;
};

export class RealtimeAnalyticsStore {
  private nextId = 1;
  private records: PendingAnalyticsRecord[] = [];
  private options: Required<RealtimeAnalyticsStoreOptions>;

  constructor(options: RealtimeAnalyticsStoreOptions = {}) {
    this.options = {
      maxPendingClickhouseAgeMs: options.maxPendingClickhouseAgeMs ?? 15 * 60 * 1000,
      maxPendingClickhouseRecords: options.maxPendingClickhouseRecords ?? 20_000,
    };
  }

  addRecord(record: PersistedTrafficRecord, pendingClickhouse: boolean) {
    const entry: PendingAnalyticsRecord = {
      ...record,
      id: this.nextId++,
      timestamp: record.lastSeen,
      pendingSqlite: true,
      pendingClickhouse,
    };
    this.records.push(entry);
    return entry.id;
  }

  markSqliteFlushed(ids: number[]) {
    const idSet = new Set(ids);
    for (const record of this.records) {
      if (idSet.has(record.id)) {
        record.pendingSqlite = false;
      }
    }
    this.compact();
  }

  markClickhouseFlushed(ids: number[]) {
    const idSet = new Set(ids);
    for (const record of this.records) {
      if (idSet.has(record.id)) {
        record.pendingClickhouse = false;
      }
    }
    this.compact();
  }

  mergeSummary(
    base: AnalyticsSummary,
    targetKey: string,
    range: TimeRange,
    source: TelemetryQuerySource,
    activeConnections: number,
  ) {
    const totals = this.filter(targetKey, range, source).reduce(
      (accumulator, item) => {
        accumulator.uploadBytes += item.uploadBytes;
        accumulator.downloadBytes += item.downloadBytes;
        accumulator.connectionCount += item.connectionCount;
        return accumulator;
      },
      { uploadBytes: 0, downloadBytes: 0, connectionCount: 0 },
    );

    return analyticsSummarySchema.parse({
      ...base,
      uploadBytes: base.uploadBytes + totals.uploadBytes,
      downloadBytes: base.downloadBytes + totals.downloadBytes,
      connectionCount: base.connectionCount + totals.connectionCount,
      activeConnections,
    });
  }

  mergeTrend(base: AnalyticsTrendPoint[], targetKey: string, range: TimeRange, source: TelemetryQuerySource) {
    const bucketMinutes = pickTrendBucketMinutes(range);
    const rows = this.filter(targetKey, range, source);
    const merged = new Map<string, { uploadBytes: number; downloadBytes: number; connectionCount: number }>();

    for (const point of base) {
      merged.set(point.bucket, {
        uploadBytes: point.uploadBytes,
        downloadBytes: point.downloadBytes,
        connectionCount: point.connectionCount,
      });
    }

    for (const row of rows) {
      const bucket = bucketTime(row.timestamp, bucketMinutes);
      const current = merged.get(bucket) ?? { uploadBytes: 0, downloadBytes: 0, connectionCount: 0 };
      current.uploadBytes += row.uploadBytes;
      current.downloadBytes += row.downloadBytes;
      current.connectionCount += row.connectionCount;
      merged.set(bucket, current);
    }

    return Array.from(merged.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([bucket, values]) => analyticsTrendPointSchema.parse({ bucket, ...values }));
  }

  mergeList(
    base: AnalyticsListItem[],
    targetKey: string,
    range: TimeRange,
    source: TelemetryQuerySource,
    dimension: "domains" | "proxies" | "rules" | "regions" | "devices",
    limit: number,
  ) {
    const merged = new Map<string, AnalyticsListItem>(base.map((item) => [item.key, item]));
    for (const row of this.filter(targetKey, range, source)) {
      const item = this.toListItem(row, dimension);
      const current = merged.get(item.key);
      if (current) {
        merged.set(item.key, analyticsListItemSchema.parse({
          ...current,
          uploadBytes: current.uploadBytes + item.uploadBytes,
          downloadBytes: current.downloadBytes + item.downloadBytes,
          connectionCount: current.connectionCount + item.connectionCount,
          lastSeen: !current.lastSeen || (item.lastSeen && item.lastSeen > current.lastSeen) ? item.lastSeen : current.lastSeen,
          meta: { ...current.meta, ...item.meta },
        }));
      } else {
        merged.set(item.key, item);
      }
    }
    return Array.from(merged.values())
      .sort((left, right) => right.uploadBytes + right.downloadBytes - (left.uploadBytes + left.downloadBytes))
      .slice(0, limit);
  }

  mergeDetail(
    base: AnalyticsDetailResponse,
    targetKey: string,
    range: TimeRange,
    source: TelemetryQuerySource,
    mode:
      | "domain-proxies"
      | "proxy-domains"
      | "rule-domains"
      | "domain-ips"
      | "proxy-ips"
      | "rule-ips"
      | "device-domains"
      | "device-ips"
      | "ip-domains"
      | "ip-proxies",
    key: string,
    limit: number,
    scope?: DetailScope,
  ) {
    const merged = new Map<string, AnalyticsListItem>(base.items.map((item) => [item.key, item]));
    for (const row of this.filter(targetKey, range, source)) {
      if (!this.matchesScope(row, scope)) {
        continue;
      }
      const item = this.toDetailItem(row, mode, key);
      if (!item) {
        continue;
      }
      const current = merged.get(item.key);
      if (current) {
        merged.set(item.key, analyticsListItemSchema.parse({
          ...current,
          uploadBytes: current.uploadBytes + item.uploadBytes,
          downloadBytes: current.downloadBytes + item.downloadBytes,
          connectionCount: current.connectionCount + item.connectionCount,
          lastSeen: !current.lastSeen || (item.lastSeen && item.lastSeen > current.lastSeen) ? item.lastSeen : current.lastSeen,
          meta: current.meta,
        }));
      } else {
        merged.set(item.key, item);
      }
    }
    return analyticsDetailResponseSchema.parse({
      ...base,
      items: Array.from(merged.values())
        .sort((left, right) => right.uploadBytes + right.downloadBytes - (left.uploadBytes + left.downloadBytes))
        .slice(0, limit),
    });
  }

  mergeRuleFlow(base: AnalyticsRuleFlowResponse, targetKey: string, range: TimeRange, source: TelemetryQuerySource, sourceIp?: string) {
    const nodes = new Map(base.nodes.map((node) => [node.id, node]));
    const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
    const sourceIpFilter = sourceIp?.trim();

    for (const record of this.filter(targetKey, range, source)) {
      if (sourceIpFilter && record.sourceIp !== sourceIpFilter) {
        continue;
      }
      const ruleLabel = record.ruleLabel?.trim();
      if (!ruleLabel) {
        continue;
      }
      const uploadBytes = record.uploadBytes;
      const downloadBytes = record.downloadBytes;
      const connectionCount = record.connectionCount;
      const sourceIp = record.sourceIp?.trim() || "(unknown device)";
      const sourceNodeId = `source:${sourceIp}`;
      const sourceNode = nodes.get(sourceNodeId) ?? analyticsFlowNodeSchema.parse({
        id: sourceNodeId,
        label: sourceIp,
        layer: 0,
        nodeType: "source",
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      });
      sourceNode.uploadBytes += uploadBytes;
      sourceNode.downloadBytes += downloadBytes;
      sourceNode.connectionCount += connectionCount;
      nodes.set(sourceNodeId, sourceNode);

      const ruleNodeId = `rule:${ruleLabel}`;
      const ruleNode = nodes.get(ruleNodeId) ?? analyticsFlowNodeSchema.parse({
        id: ruleNodeId,
        label: ruleLabel,
        layer: 1,
        nodeType: "rule",
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      });
      ruleNode.uploadBytes += uploadBytes;
      ruleNode.downloadBytes += downloadBytes;
      ruleNode.connectionCount += connectionCount;
      nodes.set(ruleNodeId, ruleNode);

      const sourceToRuleEdgeId = `${sourceNodeId}->${ruleNodeId}`;
      const sourceToRuleEdge = edges.get(sourceToRuleEdgeId) ?? analyticsFlowEdgeSchema.parse({
        id: sourceToRuleEdgeId,
        source: sourceNodeId,
        target: ruleNodeId,
        uploadBytes: 0,
        downloadBytes: 0,
        connectionCount: 0,
      });
      sourceToRuleEdge.uploadBytes += uploadBytes;
      sourceToRuleEdge.downloadBytes += downloadBytes;
      sourceToRuleEdge.connectionCount += connectionCount;
      edges.set(sourceToRuleEdgeId, sourceToRuleEdge);

      const parts = record.proxyChain.split(">").map((part) => part.trim()).filter(Boolean);
      const normalizedParts = parts.length > 0 ? [...parts].reverse() : ["DIRECT"];
      let previousNodeId = ruleNodeId;
      for (let index = 0; index < normalizedParts.length; index += 1) {
        const part = normalizedParts[index]!;
        const nodeType =
          index === normalizedParts.length - 1 ? (part.toUpperCase() === "DIRECT" ? "direct" : "proxy") : "group";
        const nodeId = `${nodeType}:${part}`;
        const node = nodes.get(nodeId) ?? analyticsFlowNodeSchema.parse({
          id: nodeId,
          label: part,
          layer: index + 2,
          nodeType,
          uploadBytes: 0,
          downloadBytes: 0,
          connectionCount: 0,
        });
        node.uploadBytes += uploadBytes;
        node.downloadBytes += downloadBytes;
        node.connectionCount += connectionCount;
        nodes.set(nodeId, node);

        const edgeId = `${previousNodeId}->${nodeId}`;
        const edge = edges.get(edgeId) ?? analyticsFlowEdgeSchema.parse({
          id: edgeId,
          source: previousNodeId,
          target: nodeId,
          uploadBytes: 0,
          downloadBytes: 0,
          connectionCount: 0,
        });
        edge.uploadBytes += uploadBytes;
        edge.downloadBytes += downloadBytes;
        edge.connectionCount += connectionCount;
        edges.set(edgeId, edge);
        previousNodeId = nodeId;
      }
    }

    const nodeList = Array.from(nodes.values());
    return analyticsRuleFlowResponseSchema.parse({
      ...base,
      nodes: nodeList,
      edges: Array.from(edges.values()),
      maxLayer: nodeList.reduce((maximum, node) => Math.max(maximum, node.layer), 0),
    });
  }

  private filter(targetKey: string, range: TimeRange, source: TelemetryQuerySource) {
    return this.records.filter((record) => {
      if (record.targetKey !== targetKey) {
        return false;
      }
      if (record.timestamp < range.start || record.timestamp > range.end) {
        return false;
      }
      if (source === "clickhouse") {
        return record.pendingClickhouse;
      }
      return record.pendingSqlite;
    });
  }

  private toListItem(record: PendingAnalyticsRecord, dimension: "domains" | "proxies" | "rules" | "regions" | "devices") {
    switch (dimension) {
      case "domains":
        return analyticsListItemSchema.parse({
          key: record.domain || "(no host)",
          label: record.domain || "(no host)",
          uploadBytes: record.uploadBytes,
          downloadBytes: record.downloadBytes,
          connectionCount: record.connectionCount,
          lastSeen: record.lastSeen,
          meta: {},
        });
      case "proxies":
        return analyticsListItemSchema.parse({
          key: record.proxyName,
          label: record.proxyName,
          uploadBytes: record.uploadBytes,
          downloadBytes: record.downloadBytes,
          connectionCount: record.connectionCount,
          lastSeen: record.lastSeen,
          meta: { proxy_chain: record.proxyChain },
        });
      case "rules":
        return analyticsListItemSchema.parse({
          key: record.ruleLabel,
          label: record.ruleLabel,
          uploadBytes: record.uploadBytes,
          downloadBytes: record.downloadBytes,
          connectionCount: record.connectionCount,
          lastSeen: record.lastSeen,
          meta: { final_proxy: record.proxyName },
        });
      case "regions":
        return analyticsListItemSchema.parse({
          key: record.countryCode,
          label: record.countryName || record.countryCode,
          uploadBytes: record.uploadBytes,
          downloadBytes: record.downloadBytes,
          connectionCount: record.connectionCount,
          lastSeen: record.lastSeen,
          meta: {
            country_code: record.countryCode,
            continent_name: record.continentName,
          },
        });
      case "devices":
        return analyticsListItemSchema.parse({
          key: record.sourceIp || "(unknown)",
          label: record.sourceIp || "(unknown)",
          uploadBytes: record.uploadBytes,
          downloadBytes: record.downloadBytes,
          connectionCount: record.connectionCount,
          lastSeen: record.lastSeen,
          meta: {},
        });
    }
  }

  private toDetailItem(
    record: PendingAnalyticsRecord,
    mode:
      | "domain-proxies"
      | "proxy-domains"
      | "rule-domains"
      | "domain-ips"
      | "proxy-ips"
      | "rule-ips"
      | "device-domains"
      | "device-ips"
      | "ip-domains"
      | "ip-proxies",
    key: string,
  ) {
    if (mode === "domain-proxies" && record.domain === key) {
      return analyticsListItemSchema.parse({
        key: record.proxyName,
        label: record.proxyName,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "domain-ips" && record.domain === key) {
      return analyticsListItemSchema.parse({
        key: record.destinationIp || "(unknown)",
        label: record.destinationIp || "(unknown)",
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "proxy-domains" && record.proxyName === key) {
      const label = record.domain || "(no host)";
      return analyticsListItemSchema.parse({
        key: label,
        label,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "proxy-ips" && record.proxyName === key) {
      return analyticsListItemSchema.parse({
        key: record.destinationIp || "(unknown)",
        label: record.destinationIp || "(unknown)",
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "rule-domains" && record.ruleLabel === key) {
      const label = record.domain || "(no host)";
      return analyticsListItemSchema.parse({
        key: label,
        label,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "rule-ips" && record.ruleLabel === key) {
      return analyticsListItemSchema.parse({
        key: record.destinationIp || "(unknown)",
        label: record.destinationIp || "(unknown)",
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "device-domains" && record.sourceIp === key) {
      const label = record.domain || "(no host)";
      return analyticsListItemSchema.parse({
        key: label,
        label,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "device-ips" && record.sourceIp === key) {
      return analyticsListItemSchema.parse({
        key: record.destinationIp || "(unknown)",
        label: record.destinationIp || "(unknown)",
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "ip-domains" && record.destinationIp === key) {
      const label = record.domain || "(no host)";
      return analyticsListItemSchema.parse({
        key: label,
        label,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: {},
      });
    }
    if (mode === "ip-proxies" && record.destinationIp === key) {
      return analyticsListItemSchema.parse({
        key: record.proxyName,
        label: record.proxyName,
        uploadBytes: record.uploadBytes,
        downloadBytes: record.downloadBytes,
        connectionCount: record.connectionCount,
        lastSeen: record.lastSeen,
        meta: { proxy_chain: record.proxyChain },
      });
    }
    return null;
  }

  private compact() {
    const cutoff = Date.now() - this.options.maxPendingClickhouseAgeMs;
    const retained: PendingAnalyticsRecord[] = [];
    let pendingClickhouseCount = 0;

    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      const record = this.records[index]!;
      if (record.pendingSqlite) {
        retained.push(record);
        continue;
      }
      if (!record.pendingClickhouse) {
        continue;
      }

      const timestamp = new Date(record.timestamp).getTime();
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        continue;
      }
      if (pendingClickhouseCount >= this.options.maxPendingClickhouseRecords) {
        continue;
      }

      pendingClickhouseCount += 1;
      retained.push(record);
    }

    this.records = retained.reverse();
  }

  private matchesScope(record: PendingAnalyticsRecord, scope?: DetailScope) {
    if (!scope) {
      return true;
    }
    if (scope.proxyName && record.proxyName !== scope.proxyName) {
      return false;
    }
    if (scope.ruleLabel && record.ruleLabel !== scope.ruleLabel) {
      return false;
    }
    if (scope.sourceIp && record.sourceIp !== scope.sourceIp) {
      return false;
    }
    return true;
  }
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
