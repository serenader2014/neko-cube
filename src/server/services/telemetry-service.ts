import {
  analyticsQuerySchema,
  type AnalyticsRuleFlowResponse,
  type AnalyticsDetailResponse,
  type AnalyticsListItem,
  type AnalyticsSummary,
  type AnalyticsTrendPoint,
  type RuntimeEvent,
  type RuntimeSnapshot,
  type TelemetrySettings,
} from "../../shared/telemetry.js";
import { getAppSettings, getClashTarget, type DatabaseContext } from "../db/database.js";
import {
  getAnalyticsDeviceDomainsSqlite,
  getAnalyticsDeviceIpsSqlite,
  getAnalyticsDomainProxiesSqlite,
  getAnalyticsDomainIpsSqlite,
  getAnalyticsIpDomainsSqlite,
  getAnalyticsIpProxiesSqlite,
  getAnalyticsProxyDomainsSqlite,
  getAnalyticsProxyIpsSqlite,
  getAnalyticsRuleFlowSqlite,
  getAnalyticsRuleDomainsSqlite,
  getAnalyticsRuleIpsSqlite,
  getAnalyticsSummarySqlite,
  getAnalyticsTrendSqlite,
  getTelemetrySettings,
  listAnalyticsDevicesSqlite,
  listAnalyticsDomainsSqlite,
  listAnalyticsIpsSqlite,
  listAnalyticsProxiesSqlite,
  listAnalyticsRegionsSqlite,
  listAnalyticsRulesSqlite,
  resolveTelemetryQuerySource,
  updateTelemetrySettings,
} from "../db/telemetry-db.js";
import { ClickHouseService } from "./clickhouse-service.js";
import { GeoIpService } from "./geoip-service.js";
import { MihomoRuntimeClient } from "./mihomo-runtime-client.js";
import { RealtimeAnalyticsStore } from "./realtime-analytics-store.js";
import { RuntimeStore } from "./runtime-store.js";
import { TrafficAggregator } from "./traffic-aggregator.js";
import { ProxyProbeService } from "./proxy-probe-service.js";
import { computeTargetKey, normalizeRuntimeLogLevel, parseAnalyticsRange, pickTrendBucketMinutes } from "./telemetry-utils.js";

type RuntimeListener = (event: RuntimeEvent) => void;
const EMPTY_DOMAIN_LABEL = "(no host)";

export class TelemetryService {
  private runtimeStore: RuntimeStore;
  private runtimeClient: MihomoRuntimeClient;
  private realtimeAnalyticsStore: RealtimeAnalyticsStore;
  private clickhouse: ClickHouseService;
  private geoIpService: GeoIpService;
  private aggregator: TrafficAggregator;
  private proxyProbe: ProxyProbeService;
  private listeners = new Set<RuntimeListener>();
  private started = false;

  constructor(private context: DatabaseContext) {
    this.runtimeStore = new RuntimeStore({
      realtimeBufferMinutes: 5,
      maxLiveLogs: 2000,
      maxLiveConnections: 500,
    });
    this.runtimeClient = new MihomoRuntimeClient();
    this.realtimeAnalyticsStore = new RealtimeAnalyticsStore();
    this.clickhouse = new ClickHouseService();
    this.geoIpService = new GeoIpService(process.env.GEOIP_MMDB_PATH);
    this.aggregator = new TrafficAggregator(this.context, this.realtimeAnalyticsStore, this.geoIpService, this.clickhouse);
    this.proxyProbe = new ProxyProbeService(this.context, this.runtimeClient);

    this.runtimeClient.on("traffic", (message) => {
      this.runtimeStore.applyTraffic(message);
      this.broadcast("traffic", this.runtimeStore.getTrafficState());
    });
    this.runtimeClient.on("connections", (message) => {
      this.runtimeStore.applyConnections(message);
      this.aggregator.onConnections(message);
      this.broadcast("connections", this.runtimeStore.getConnectionsState());
    });
    this.runtimeClient.on("logs", (entry) => {
      this.runtimeStore.appendLog(entry);
      this.broadcast("logs", this.runtimeStore.getLogs());
    });
    this.runtimeClient.on("proxies", (groups) => {
      this.runtimeStore.setProxies(groups);
      this.broadcast("proxies", groups);
    });
    this.runtimeClient.on("health", ({ connected, lastError }) => {
      this.runtimeStore.setConnected(connected);
      this.runtimeStore.setLastError(lastError);
      this.broadcast("health", this.runtimeStore.getHealth());
    });
  }

  async start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.aggregator.start();
    await this.proxyProbe.start();
    await this.geoIpService.whenReady();
    if (this.clickhouse.isConfigured()) {
      await this.clickhouse.ensureSchema();
    }
    await this.reloadConfig();
  }

  async stop() {
    this.started = false;
    await this.proxyProbe.stop();
    await this.runtimeClient.stop();
    await this.aggregator.flush();
    this.aggregator.stop();
  }

  onRuntimeEvent(listener: RuntimeListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): RuntimeSnapshot {
    return this.runtimeStore.snapshot();
  }

  async setLogLevel(level: string) {
    const normalized = normalizeRuntimeLogLevel(level);
    this.runtimeStore.setLogLevel(normalized);
    await this.runtimeClient.setLogLevel(normalized);
    this.broadcast("snapshot", this.snapshot());
    return this.snapshot();
  }

  clearLogs() {
    this.runtimeStore.clearLogs();
    this.broadcast("logs", []);
  }

  async listProxies() {
    await this.runtimeClient.refreshProxies();
    return this.snapshot().proxies;
  }

  async selectProxy(group: string, name: string) {
    await this.runtimeClient.selectProxy(group, name);
    return this.snapshot().proxies;
  }

  async testProxyGroup(groupName: string) {
    const settings = await getAppSettings(this.context);
    const group = this.runtimeStore.getProxies().find((item) => item.name === groupName);
    if (!group) {
      throw new Error(`Proxy group ${groupName} was not found.`);
    }
    await this.runtimeClient.testProxies(group.options.map((option) => option.name), settings.defaultHealthcheckUrl, 5000);
    return this.snapshot().proxies;
  }

  async listProxyProbeNodes() {
    return this.runtimeClient.listProbeNodes();
  }

  async getTelemetrySettings() {
    return getTelemetrySettings(this.context);
  }

  async updateTelemetrySettings(payload: Partial<TelemetrySettings>) {
    const result = await updateTelemetrySettings(this.context, payload);
    await this.reloadConfig();
    return result;
  }

  async reloadConfig() {
    const [settings, target] = await Promise.all([getTelemetrySettings(this.context), getClashTarget(this.context)]);
    this.runtimeStore.updateOptions({
      realtimeBufferMinutes: settings.realtimeBufferMinutes,
      maxLiveLogs: settings.maxLiveLogs,
      maxLiveConnections: settings.maxLiveConnections,
    });

    const targetKey = computeTargetKey(target);
    const runtimeActive = settings.enabled && (!this.context.runtime.safeApplyMode || this.context.runtime.devMihomoMode);
    this.runtimeStore.setTelemetryActive(runtimeActive);
    this.runtimeStore.setTarget(targetKey, target.controllerUrl);
    this.aggregator.setTargetKey(targetKey);
    this.aggregator.setEnabled(runtimeActive);

    if (!runtimeActive) {
      await this.proxyProbe.setRuntimeState({ targetKey, active: false });
      await this.runtimeClient.stop();
      this.runtimeStore.setConnected(false);
      return;
    }

    await this.runtimeClient.reload(target, this.runtimeStore.getLogLevel());
    await this.proxyProbe.setRuntimeState({ targetKey, active: true });
    this.broadcast("snapshot", this.snapshot());
  }

  async getProxyProbeSettings() {
    return this.proxyProbe.getSettings();
  }

  async updateProxyProbeSettings(payload: Record<string, unknown>) {
    return this.proxyProbe.updateSettings(payload);
  }

  async runProxyProbe(payload: unknown) {
    return this.proxyProbe.runManual(payload);
  }

  async getProxyProbeSummary(rawQuery: Record<string, string | undefined>) {
    return this.proxyProbe.getSummary(rawQuery);
  }

  async getProxyProbeTrend(proxyName: string, rawQuery: Record<string, string | undefined>) {
    return this.proxyProbe.getTrend(proxyName, rawQuery);
  }

  async getProxyProbeRecentSamples(proxyName: string, rawQuery: Record<string, string | undefined>) {
    return this.proxyProbe.getRecentSamples(proxyName, rawQuery);
  }

  async getAnalyticsSummary(rawQuery: Record<string, string | undefined>): Promise<AnalyticsSummary> {
    const target = await getClashTarget(this.context);
    const targetKey = computeTargetKey(target);
    const settings = await getTelemetrySettings(this.context);
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const source = await this.resolveQuerySource(rawQuery.querySource, settings, range);
    const activeConnections = this.snapshot().totals.activeConnections;
    const base =
      source === "clickhouse"
        ? await this.clickhouse.getSummary(targetKey, range, source, activeConnections)
        : await getAnalyticsSummarySqlite(this.context, targetKey, range, source, activeConnections);
    return this.realtimeAnalyticsStore.mergeSummary(base, targetKey, range, source, activeConnections);
  }

  async getAnalyticsTrend(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; points: AnalyticsTrendPoint[] }> {
    const target = await getClashTarget(this.context);
    const targetKey = computeTargetKey(target);
    const settings = await getTelemetrySettings(this.context);
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const source = await this.resolveQuerySource(rawQuery.querySource, settings, range);
    const bucketMinutes = pickTrendBucketMinutes(range);
    const base =
      source === "clickhouse"
        ? await this.clickhouse.getTrend(targetKey, range, bucketMinutes)
        : await getAnalyticsTrendSqlite(this.context, targetKey, range, bucketMinutes);
    return {
      querySource: source,
      points: this.realtimeAnalyticsStore.mergeTrend(base, targetKey, range, source),
    };
  }

  async listDomains(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("domains", rawQuery);
  }

  async listProxiesAnalytics(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("proxies", rawQuery);
  }

  async listRules(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("rules", rawQuery);
  }

  async listRegions(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("regions", rawQuery);
  }

  async listDevices(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("devices", rawQuery);
  }

  async listIps(rawQuery: Record<string, string | undefined>): Promise<{ querySource: string; items: AnalyticsListItem[] }> {
    return this.listDimension("ips", rawQuery);
  }

  async getDomainProxies(domain: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("domain-proxies", domain, rawQuery);
  }

  async getProxyDomains(proxyName: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("proxy-domains", proxyName, rawQuery);
  }

  async getRuleDomains(ruleLabel: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("rule-domains", ruleLabel, rawQuery);
  }

  async getDomainIps(domain: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("domain-ips", domain, rawQuery);
  }

  async getProxyIps(proxyName: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("proxy-ips", proxyName, rawQuery);
  }

  async getRuleIps(ruleLabel: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("rule-ips", ruleLabel, rawQuery);
  }

  async getDeviceDomains(device: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("device-domains", device, rawQuery);
  }

  async getDeviceIps(device: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("device-ips", device, rawQuery);
  }

  async getIpDomains(ip: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("ip-domains", ip, rawQuery);
  }

  async getIpProxies(ip: string, rawQuery: Record<string, string | undefined>): Promise<AnalyticsDetailResponse> {
    return this.detail("ip-proxies", ip, rawQuery);
  }

  async getRuleFlow(rawQuery: Record<string, string | undefined>): Promise<AnalyticsRuleFlowResponse> {
    const target = await getClashTarget(this.context);
    const targetKey = computeTargetKey(target);
    const settings = await getTelemetrySettings(this.context);
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const source = await this.resolveQuerySource(rawQuery.querySource, settings, range);
    const sourceIp = typeof rawQuery.sourceIp === "string" && rawQuery.sourceIp.trim() ? rawQuery.sourceIp.trim() : undefined;
    const base =
      source === "clickhouse"
        ? await this.clickhouse.ruleFlow(targetKey, range, sourceIp)
        : await getAnalyticsRuleFlowSqlite(this.context, targetKey, range, sourceIp);
    return this.realtimeAnalyticsStore.mergeRuleFlow(base, targetKey, range, source, sourceIp);
  }

  private async listDimension(
    dimension: "domains" | "proxies" | "rules" | "regions" | "devices" | "ips",
    rawQuery: Record<string, string | undefined>,
  ) {
    const target = await getClashTarget(this.context);
    const targetKey = computeTargetKey(target);
    const settings = await getTelemetrySettings(this.context);
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const source = await this.resolveQuerySource(rawQuery.querySource, settings, range);
    const limit = Number(rawQuery.limit || 20);
    const query = analyticsQuerySchema.parse({ ...rawQuery, start: range.start, end: range.end, limit });

    const base =
      source === "clickhouse"
        ? dimension === "domains"
          ? await this.clickhouse.listDomains(targetKey, range, query)
          : dimension === "proxies"
            ? await this.clickhouse.listProxies(targetKey, range, query)
            : dimension === "rules"
              ? await this.clickhouse.listRules(targetKey, range, query)
              : dimension === "regions"
                ? await this.clickhouse.listRegions(targetKey, range, query)
                : dimension === "devices"
                  ? await this.clickhouse.listDevices(targetKey, range, query)
                  : await this.clickhouse.listIps(targetKey, range, query)
        : dimension === "domains"
          ? await listAnalyticsDomainsSqlite(this.context, targetKey, query)
          : dimension === "proxies"
            ? await listAnalyticsProxiesSqlite(this.context, targetKey, query)
            : dimension === "rules"
              ? await listAnalyticsRulesSqlite(this.context, targetKey, query)
              : dimension === "regions"
                ? await listAnalyticsRegionsSqlite(this.context, targetKey, query)
                : dimension === "devices"
                  ? await listAnalyticsDevicesSqlite(this.context, targetKey, query)
                  : await listAnalyticsIpsSqlite(this.context, targetKey, query);

    return {
      querySource: source,
      items:
        dimension === "ips"
          ? base
          : this.realtimeAnalyticsStore.mergeList(base, targetKey, range, source, dimension, query.limit),
    };
  }

  private async detail(
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
    rawQuery: Record<string, string | undefined>,
  ) {
    const target = await getClashTarget(this.context);
    const targetKey = computeTargetKey(target);
    const settings = await getTelemetrySettings(this.context);
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const source = await this.resolveQuerySource(rawQuery.querySource, settings, range);
    const limit = Number(rawQuery.limit || 20);
    const resolvedKey = mode === "domain-proxies" && key === EMPTY_DOMAIN_LABEL ? "" : key;
    const scope = {
      proxyName: rawQuery.proxy || undefined,
      ruleLabel: rawQuery.rule || undefined,
      sourceIp: rawQuery.device || undefined,
    };
    const base =
      source === "clickhouse"
        ? mode === "domain-proxies"
          ? await this.clickhouse.domainProxies(targetKey, range, resolvedKey, limit, scope)
          : mode === "proxy-domains"
            ? await this.clickhouse.proxyDomains(targetKey, range, resolvedKey, limit, scope)
            : mode === "rule-domains"
              ? await this.clickhouse.ruleDomains(targetKey, range, resolvedKey, limit, scope)
              : mode === "domain-ips"
                ? await this.clickhouse.domainIps(targetKey, range, resolvedKey, limit, scope)
                : mode === "proxy-ips"
                  ? await this.clickhouse.proxyIps(targetKey, range, resolvedKey, limit, scope)
                  : mode === "rule-ips"
                    ? await this.clickhouse.ruleIps(targetKey, range, resolvedKey, limit, scope)
                    : mode === "device-domains"
                      ? await this.clickhouse.deviceDomains(targetKey, range, resolvedKey, limit, scope)
                      : mode === "device-ips"
                        ? await this.clickhouse.deviceIps(targetKey, range, resolvedKey, limit, scope)
                        : mode === "ip-domains"
                          ? await this.clickhouse.ipDomains(targetKey, range, resolvedKey, limit, scope)
                          : await this.clickhouse.ipProxies(targetKey, range, resolvedKey, limit, scope)
        : mode === "domain-proxies"
          ? await getAnalyticsDomainProxiesSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
          : mode === "proxy-domains"
            ? await getAnalyticsProxyDomainsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
            : mode === "rule-domains"
              ? await getAnalyticsRuleDomainsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
              : mode === "domain-ips"
                ? await getAnalyticsDomainIpsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                : mode === "proxy-ips"
                  ? await getAnalyticsProxyIpsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                  : mode === "rule-ips"
                    ? await getAnalyticsRuleIpsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                    : mode === "device-domains"
                      ? await getAnalyticsDeviceDomainsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                      : mode === "device-ips"
                        ? await getAnalyticsDeviceIpsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                        : mode === "ip-domains"
                          ? await getAnalyticsIpDomainsSqlite(this.context, targetKey, range, resolvedKey, limit, scope)
                          : await getAnalyticsIpProxiesSqlite(this.context, targetKey, range, resolvedKey, limit, scope);
    return this.realtimeAnalyticsStore.mergeDetail(base, targetKey, range, source, mode, resolvedKey, limit, scope);
  }

  private broadcast(type: RuntimeEvent["type"], payload: unknown) {
    const event = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    } as RuntimeEvent;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async resolveQuerySource(
    preferred: string | undefined,
    settings: TelemetrySettings,
    range: { start: string; end: string },
  ) {
    const resolved = resolveTelemetryQuerySource(preferred, settings, process.env.ANALYTICS_QUERY_SOURCE_DEFAULT);
    if (resolved === "sqlite") {
      return resolved;
    }
    const clickhouseAvailable = this.clickhouse.isConfigured() && (await this.clickhouse.ping());
    if (resolved === "clickhouse") {
      if (!clickhouseAvailable) {
        throw new Error("ClickHouse query source is not available.");
      }
      return resolved;
    }
    if (new Date(range.end).getTime() - new Date(range.start).getTime() <= 48 * 60 * 60 * 1000) {
      return "sqlite";
    }
    return clickhouseAvailable ? "clickhouse" : "sqlite";
  }
}
