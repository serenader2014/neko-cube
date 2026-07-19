import { EventEmitter } from "node:events";
import {
  runtimeHealthSchema,
  runtimeLogEntrySchema,
  runtimeLogLevelSchema,
  runtimeSnapshotSchema,
  type MihomoConnection,
  type MihomoConnectionsMessage,
  type MihomoTrafficMessage,
  type RuntimeHealth,
  type RuntimeLogEntry,
  type RuntimeLogLevel,
  type RuntimeProxyGroup,
  type RuntimeSnapshot,
  type RuntimeTrafficPoint,
} from "../../shared/telemetry.js";

type RuntimeStoreOptions = {
  realtimeBufferMinutes: number;
  maxLiveLogs: number;
  maxLiveConnections: number;
};

const DEFAULT_HEALTH = runtimeHealthSchema.parse({
  connected: false,
  telemetryActive: false,
  targetKey: "inactive",
  controllerUrl: "",
  lastError: null,
  lastConnectedAt: null,
  lastEventAt: null,
  lastProxiesSyncAt: null,
});

export class RuntimeStore extends EventEmitter {
  private health: RuntimeHealth = DEFAULT_HEALTH;
  private trafficHistory: RuntimeTrafficPoint[] = [];
  private latestTraffic: MihomoTrafficMessage | null = null;
  private totals = {
    uploadTotal: 0,
    downloadTotal: 0,
    activeConnections: 0,
  };
  private activeConnections: MihomoConnection[] = [];
  private recentClosedConnections: MihomoConnection[] = [];
  private logs: RuntimeLogEntry[] = [];
  private proxies: RuntimeProxyGroup[] = [];
  private logLevel: RuntimeLogLevel = "info";
  private options: RuntimeStoreOptions;
  private activeConnectionMap = new Map<string, MihomoConnection>();

  constructor(options: RuntimeStoreOptions) {
    super();
    this.options = options;
  }

  updateOptions(options: Partial<RuntimeStoreOptions>) {
    this.options = { ...this.options, ...options };
    this.logs = this.logs.slice(0, this.options.maxLiveLogs);
    this.activeConnections = this.activeConnections.slice(0, this.options.maxLiveConnections);
    this.recentClosedConnections = this.recentClosedConnections.slice(0, this.options.maxLiveConnections);
    this.emit("logs", this.logs);
    this.emit("connections", {
      activeConnections: this.activeConnections,
      recentClosedConnections: this.recentClosedConnections,
      totals: this.totals,
      trafficHistory: this.trafficHistory,
    });
  }

  setTelemetryActive(active: boolean) {
    this.health = { ...this.health, telemetryActive: active };
    this.emit("health", this.health);
  }

  setTarget(targetKey: string, controllerUrl: string) {
    this.health = {
      ...this.health,
      targetKey,
      controllerUrl,
    };
    this.emit("health", this.health);
  }

  setConnected(connected: boolean) {
    this.health = {
      ...this.health,
      connected,
      lastConnectedAt: connected ? new Date().toISOString() : this.health.lastConnectedAt,
    };
    this.emit("health", this.health);
  }

  setLastError(message: string | null) {
    this.health = {
      ...this.health,
      lastError: message,
    };
    this.emit("health", this.health);
  }

  setLastProxiesSyncAt(value: string) {
    this.health = {
      ...this.health,
      lastProxiesSyncAt: value,
    };
    this.emit("health", this.health);
  }

  setLogLevel(level: string) {
    this.logLevel = runtimeLogLevelSchema.parse(level);
    this.emit("logs", this.logs);
  }

  getLogLevel() {
    return this.logLevel;
  }

  applyTraffic(message: MihomoTrafficMessage) {
    this.latestTraffic = message;
    this.markEvent();
    this.pushTrafficPoint();
    this.emit("traffic", {
      latestTraffic: this.latestTraffic,
      trafficHistory: this.trafficHistory,
      totals: this.totals,
    });
  }

  applyConnections(message: MihomoConnectionsMessage) {
    const nextMap = new Map<string, MihomoConnection>();
    const closed: MihomoConnection[] = [];

    for (const connection of message.connections) {
      nextMap.set(connection.id, connection);
    }
    for (const [id, previous] of this.activeConnectionMap) {
      if (!nextMap.has(id)) {
        closed.unshift(previous);
      }
    }

    this.activeConnectionMap = nextMap;
    this.activeConnections = message.connections.slice(0, this.options.maxLiveConnections);
    this.recentClosedConnections = [...closed, ...this.recentClosedConnections].slice(0, this.options.maxLiveConnections);
    this.totals = {
      uploadTotal: message.uploadTotal,
      downloadTotal: message.downloadTotal,
      activeConnections: message.connections.length,
    };
    this.markEvent();
    this.pushTrafficPoint();
    this.emit("connections", {
      activeConnections: this.activeConnections,
      recentClosedConnections: this.recentClosedConnections,
      totals: this.totals,
      trafficHistory: this.trafficHistory,
    });
  }

  setProxies(groups: RuntimeProxyGroup[]) {
    this.proxies = groups;
    const timestamp = new Date().toISOString();
    this.markEvent(timestamp);
    this.setLastProxiesSyncAt(timestamp);
    this.emit("proxies", this.proxies);
  }

  appendLog(log: RuntimeLogEntry) {
    this.logs = [runtimeLogEntrySchema.parse(log), ...this.logs].slice(0, this.options.maxLiveLogs);
    this.markEvent(log.timestamp);
    this.emit("logs", this.logs);
  }

  clearLogs() {
    this.logs = [];
    this.emit("logs", this.logs);
  }

  getHealth() {
    return this.health;
  }

  getLogs() {
    return this.logs;
  }

  getProxies() {
    return this.proxies;
  }

  getTrafficState() {
    return {
      latestTraffic: this.latestTraffic,
      trafficHistory: this.trafficHistory,
      totals: this.totals,
    };
  }

  getConnectionsState() {
    return {
      activeConnections: this.activeConnections,
      recentClosedConnections: this.recentClosedConnections,
      totals: this.totals,
      trafficHistory: this.trafficHistory,
    };
  }

  snapshot(): RuntimeSnapshot {
    return runtimeSnapshotSchema.parse({
      health: this.health,
      trafficHistory: this.trafficHistory,
      latestTraffic: this.latestTraffic,
      totals: this.totals,
      activeConnections: this.activeConnections,
      recentClosedConnections: this.recentClosedConnections,
      logs: this.logs,
      logLevel: this.logLevel,
      proxies: this.proxies,
    });
  }

  private markEvent(timestamp = new Date().toISOString()) {
    this.health = {
      ...this.health,
      lastEventAt: timestamp,
    };
  }

  private pushTrafficPoint() {
    const now = Date.now();
    const point = {
      timestamp: new Date(now).toISOString(),
      up: this.latestTraffic?.up ?? 0,
      down: this.latestTraffic?.down ?? 0,
      activeConnections: this.totals.activeConnections,
    };
    const cutoff = now - this.options.realtimeBufferMinutes * 60 * 1000;
    this.trafficHistory.push(point);

    while (this.trafficHistory.length > 0) {
      const firstPoint = this.trafficHistory[0];
      if (!firstPoint || new Date(firstPoint.timestamp).getTime() >= cutoff) {
        break;
      }
      this.trafficHistory.shift();
    }
  }
}
