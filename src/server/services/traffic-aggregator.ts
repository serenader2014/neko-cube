import type { MihomoConnectionMetadata, MihomoConnectionsMessage } from "../../shared/telemetry.js";
import type { DatabaseContext } from "../db/database.js";
import {
  cleanupTelemetryData,
  getTelemetrySettings,
  writeAnalyticsBatchToSqlite,
  type PersistedTrafficBatch,
  type PersistedTrafficRecord,
} from "../db/telemetry-db.js";
import { GeoIpService } from "./geoip-service.js";
import { RealtimeAnalyticsStore } from "./realtime-analytics-store.js";
import { ClickHouseService } from "./clickhouse-service.js";
import { toHourIso, toMinuteIso } from "./telemetry-utils.js";

type TrackedConnection = {
  id: string;
  domain: string;
  destinationIp: string;
  sourceIp: string;
  proxyName: string;
  proxyChain: string;
  ruleLabel: string;
  lastUpload: number;
  lastDownload: number;
  counted: boolean;
};

type BufferedRecord = {
  id: number;
  record: PersistedTrafficRecord;
};

export class TrafficAggregator {
  private targetKey = "inactive";
  private enabled = false;
  private trackedConnections = new Map<string, TrackedConnection>();
  private buffer: BufferedRecord[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private flushPromise: Promise<void> | null = null;
  private lastUploadTotal = 0;
  private lastDownloadTotal = 0;

  constructor(
    private context: DatabaseContext,
    private realtimeStore: RealtimeAnalyticsStore,
    private geoIpService: GeoIpService,
    private clickhouse: ClickHouseService,
  ) {}

  start() {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, 30_000);
    this.cleanupTimer = setInterval(() => {
      void this.runCleanup();
    }, 60 * 60 * 1000);
  }

  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.resetState();
    }
  }

  setTargetKey(targetKey: string) {
    if (this.targetKey !== targetKey) {
      this.targetKey = targetKey;
      this.resetState();
    }
  }

  onConnections(message: MihomoConnectionsMessage) {
    if (!this.enabled) {
      return;
    }

    if (message.uploadTotal < this.lastUploadTotal || message.downloadTotal < this.lastDownloadTotal) {
      this.resetState();
    }
    this.lastUploadTotal = message.uploadTotal;
    this.lastDownloadTotal = message.downloadTotal;

    const currentIds = new Set<string>();
    for (const connection of message.connections) {
      currentIds.add(connection.id);
      const metadata = connection.metadata ?? {};
      const domain = metadata.host || metadata.sniffHost || "";
      const destinationIp = getConnectionDestinationIp(metadata);
      const sourceIp = metadata.sourceIP || "";
      const proxyName = connection.chains[0] || "DIRECT";
      const proxyChain = connection.chains.join(" > ") || proxyName;
      const ruleLabel = connection.rulePayload ? `${connection.rule}(${connection.rulePayload})` : connection.rule || "MATCH";
      const geo = this.geoIpService.lookup(destinationIp, `${proxyName} ${proxyChain}`);
      const existing = this.trackedConnections.get(connection.id);

      if (!existing) {
        const counted = connection.upload > 0 || connection.download > 0;
        this.trackedConnections.set(connection.id, {
          id: connection.id,
          domain,
          destinationIp,
          sourceIp,
          proxyName,
          proxyChain,
          ruleLabel,
          lastUpload: connection.upload,
          lastDownload: connection.download,
          counted,
        });
        if (counted) {
          this.bufferRecord({
            targetKey: this.targetKey,
            minute: toMinuteIso(connection.start || Date.now()),
            hour: toHourIso(connection.start || Date.now()),
            domain,
            destinationIp,
            sourceIp,
            proxyName,
            proxyChain,
            ruleLabel,
            ...geo,
            uploadBytes: connection.upload,
            downloadBytes: connection.download,
            connectionCount: 1,
            lastSeen: new Date().toISOString(),
          });
        }
        continue;
      }

      const uploadDelta = Math.max(0, connection.upload - existing.lastUpload);
      const downloadDelta = Math.max(0, connection.download - existing.lastDownload);
      if (uploadDelta <= 0 && downloadDelta <= 0) {
        existing.lastUpload = connection.upload;
        existing.lastDownload = connection.download;
        continue;
      }

      const connectionCount = existing.counted ? 0 : 1;
      existing.counted = true;
      existing.lastUpload = connection.upload;
      existing.lastDownload = connection.download;
      existing.domain = domain;
      existing.destinationIp = destinationIp;
      existing.sourceIp = sourceIp;
      existing.proxyName = proxyName;
      existing.proxyChain = proxyChain;
      existing.ruleLabel = ruleLabel;
      this.bufferRecord({
        targetKey: this.targetKey,
        minute: toMinuteIso(Date.now()),
        hour: toHourIso(Date.now()),
        domain,
        destinationIp,
        sourceIp,
        proxyName,
        proxyChain,
        ruleLabel,
        ...geo,
        uploadBytes: uploadDelta,
        downloadBytes: downloadDelta,
        connectionCount,
        lastSeen: new Date().toISOString(),
      });
    }

    for (const id of this.trackedConnections.keys()) {
      if (!currentIds.has(id)) {
        this.trackedConnections.delete(id);
      }
    }
  }

  async flush() {
    if (this.flushPromise) {
      return this.flushPromise;
    }
    if (this.buffer.length === 0) {
      return;
    }

    const pending = [...this.buffer];
    this.buffer = [];
    this.flushPromise = (async () => {
      const batch = aggregateBatch(pending.map((item) => item.record));
      const ids = pending.map((item) => item.id);

      try {
        await writeAnalyticsBatchToSqlite(this.context, batch);
      } catch (error) {
        this.buffer = [...pending, ...this.buffer];
        throw error;
      }

      this.realtimeStore.markSqliteFlushed(ids);

      if (this.clickhouse.isConfigured()) {
        try {
          await this.clickhouse.writeBatch(batch);
          this.realtimeStore.markClickhouseFlushed(ids);
        } catch (error) {
          console.warn("[telemetry] clickhouse write failed:", error);
        }
      } else {
        this.realtimeStore.markClickhouseFlushed(ids);
      }
    })();

    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private bufferRecord(record: PersistedTrafficRecord) {
    const id = this.realtimeStore.addRecord(record, this.clickhouse.isConfigured());
    this.buffer.push({ id, record });
    if (this.buffer.length >= 5000) {
      void this.flush();
    }
  }

  private async runCleanup() {
    const settings = await getTelemetrySettings(this.context);
    await cleanupTelemetryData(this.context, settings);
  }

  private resetState() {
    this.trackedConnections.clear();
    this.lastUploadTotal = 0;
    this.lastDownloadTotal = 0;
  }
}

function getConnectionDestinationIp(metadata: MihomoConnectionMetadata) {
  return metadata.destinationIP || extractIpFromEndpoint(metadata.remoteDestination) || "";
}

function extractIpFromEndpoint(value: string) {
  const raw = value.trim();
  if (!raw) {
    return "";
  }
  const bracketedIpv6 = raw.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketedIpv6) {
    return bracketedIpv6[1];
  }
  const ipv4WithPort = raw.match(/^([0-9.]+):\d+$/);
  if (ipv4WithPort) {
    return ipv4WithPort[1];
  }
  return raw;
}

function aggregateBatch(records: PersistedTrafficRecord[]): PersistedTrafficBatch {
  const minuteStats = new Map<string, PersistedTrafficBatch["minuteStats"][number]>();
  const hourlyStats = new Map<string, PersistedTrafficBatch["hourlyStats"][number]>();
  const minuteDims = new Map<string, PersistedTrafficRecord>();
  const hourlyDims = new Map<string, PersistedTrafficRecord>();
  const domains = new Map<string, PersistedTrafficBatch["domains"][number]>();
  const proxies = new Map<string, PersistedTrafficBatch["proxies"][number]>();
  const rules = new Map<string, PersistedTrafficBatch["rules"][number]>();
  const regions = new Map<string, PersistedTrafficBatch["regions"][number]>();

  const accumulate = <T extends { uploadBytes: number; downloadBytes: number; connectionCount: number; lastSeen?: string }>(
    map: Map<string, T>,
    key: string,
    create: () => T,
    record: PersistedTrafficRecord,
  ) => {
    const current = map.get(key) ?? create();
    current.uploadBytes += record.uploadBytes;
    current.downloadBytes += record.downloadBytes;
    current.connectionCount += record.connectionCount;
    if ("lastSeen" in current && (!current.lastSeen || record.lastSeen > current.lastSeen)) {
      current.lastSeen = record.lastSeen;
    }
    map.set(key, current);
  };

  for (const record of records) {
    accumulate(minuteStats, `${record.targetKey}:${record.minute}`, () => ({
      targetKey: record.targetKey,
      minute: record.minute,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
    }), record);
    accumulate(hourlyStats, `${record.targetKey}:${record.hour}`, () => ({
      targetKey: record.targetKey,
      hour: record.hour,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
    }), record);

    accumulate(minuteDims, `${record.targetKey}:${record.minute}:${record.domain}:${record.destinationIp}:${record.sourceIp}:${record.proxyName}:${record.ruleLabel}`, () => ({
      ...record,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
    }), record);
    accumulate(hourlyDims, `${record.targetKey}:${record.hour}:${record.domain}:${record.destinationIp}:${record.sourceIp}:${record.proxyName}:${record.ruleLabel}`, () => ({
      ...record,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
    }), record);

    accumulate(domains, `${record.targetKey}:${record.domain}`, () => ({
      targetKey: record.targetKey,
      domain: record.domain,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
      lastSeen: record.lastSeen,
    }), record);
    accumulate(proxies, `${record.targetKey}:${record.proxyName}`, () => ({
      targetKey: record.targetKey,
      proxyName: record.proxyName,
      proxyChain: record.proxyChain,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
      lastSeen: record.lastSeen,
    }), record);
    accumulate(rules, `${record.targetKey}:${record.ruleLabel}`, () => ({
      targetKey: record.targetKey,
      ruleLabel: record.ruleLabel,
      finalProxy: record.proxyName,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
      lastSeen: record.lastSeen,
    }), record);
    accumulate(regions, `${record.targetKey}:${record.countryCode}`, () => ({
      targetKey: record.targetKey,
      countryCode: record.countryCode,
      countryName: record.countryName,
      continentCode: record.continentCode,
      continentName: record.continentName,
      uploadBytes: 0,
      downloadBytes: 0,
      connectionCount: 0,
      lastSeen: record.lastSeen,
    }), record);
  }

  return {
    minuteStats: Array.from(minuteStats.values()),
    hourlyStats: Array.from(hourlyStats.values()),
    minuteDims: Array.from(minuteDims.values()),
    hourlyDims: Array.from(hourlyDims.values()),
    domains: Array.from(domains.values()),
    proxies: Array.from(proxies.values()),
    rules: Array.from(rules.values()),
    regions: Array.from(regions.values()),
  };
}
