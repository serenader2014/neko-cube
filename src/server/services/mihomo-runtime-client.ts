import { EventEmitter } from "node:events";
import WebSocket from "ws";
import {
  mihomoConnectionsMessageSchema,
  mihomoTrafficMessageSchema,
  runtimeLogEntrySchema,
  type RuntimeProxyGroup,
} from "../../shared/telemetry.js";
import { isBuiltinProxyProbeNode, type ProxyProbeNode } from "../../shared/probes.js";
import type { ClashTarget } from "../../shared/types.js";

type StreamKind = "connections" | "traffic" | "logs";

const CONNECTIONS_STREAM_INTERVAL_MS = 250;

function toWsUrl(controllerUrl: string, path: string) {
  const normalized = controllerUrl.replace(/\/+$/, "");
  return normalized.replace(/^http/i, "ws") + path;
}

function buildHeaders(target: ClashTarget) {
  const headers: Record<string, string> = {};
  if (target.secret.trim()) {
    headers.Authorization = `Bearer ${target.secret.trim()}`;
  }
  return headers;
}

function isProxyGroup(value: Record<string, unknown>) {
  return Array.isArray(value.all);
}

function normalizeProxyGroups(payload: Record<string, unknown>): RuntimeProxyGroup[] {
  const proxies = (payload.proxies ?? {}) as Record<string, Record<string, unknown>>;
  const groups: RuntimeProxyGroup[] = [];
  for (const [name, value] of Object.entries(proxies)) {
    if (!value || typeof value !== "object" || !isProxyGroup(value)) {
      continue;
    }
    const all = Array.isArray(value.all) ? value.all.map(String) : [];
    const options = all
      .map((optionName) => {
        const node = proxies[optionName] ?? {};
        const history = Array.isArray(node.history) ? (node.history.at(-1) as Record<string, unknown> | undefined) : undefined;
        return {
          name: optionName,
          type: typeof node.type === "string" ? node.type : "",
          alive: typeof node.alive === "boolean" ? node.alive : null,
          delay: typeof history?.delay === "number" ? history.delay : null,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    groups.push({
      name,
      type: typeof value.type === "string" ? value.type : "",
      now: typeof value.now === "string" ? value.now : "",
      all,
      options,
    });
  }
  return groups.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeProbeNodes(payload: Record<string, unknown>): ProxyProbeNode[] {
  const proxies = (payload.proxies ?? {}) as Record<string, Record<string, unknown>>;
  const nodes = new Map<string, ProxyProbeNode>();
  for (const [name, value] of Object.entries(proxies)) {
    if (!value || typeof value !== "object" || isProxyGroup(value)) {
      continue;
    }
    const type = typeof value.type === "string" ? value.type : "";
    if (isBuiltinProxyProbeNode(name, type)) {
      continue;
    }
    nodes.set(name, { name, type });
  }
  return Array.from(nodes.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export class MihomoRuntimeClient extends EventEmitter {
  private target: ClashTarget | null = null;
  private logLevel = "info";
  private sockets = new Map<StreamKind, WebSocket>();
  private reconnectTimers = new Map<StreamKind, NodeJS.Timeout>();
  private proxiesTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastError: string | null = null;
  private openStreams = new Set<StreamKind>();

  async start(target: ClashTarget, logLevel: string) {
    this.stopped = false;
    this.target = target;
    this.logLevel = logLevel;
    this.connectAll();
    await this.refreshProxies();
    this.startProxiesPolling();
  }

  async reload(target: ClashTarget, logLevel: string) {
    await this.stop();
    await this.start(target, logLevel);
  }

  async stop() {
    this.stopped = true;
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    if (this.proxiesTimer) {
      clearInterval(this.proxiesTimer);
      this.proxiesTimer = null;
    }
    for (const socket of this.sockets.values()) {
      socket.removeAllListeners();
      socket.close();
    }
    this.sockets.clear();
    this.openStreams.clear();
    this.emitHealth(false, this.lastError);
  }

  async setLogLevel(level: string) {
    this.logLevel = level;
    const current = this.sockets.get("logs");
    current?.removeAllListeners();
    current?.close();
    this.sockets.delete("logs");
    this.openStreams.delete("logs");
    if (!this.stopped) {
      this.connectSocket("logs");
    }
  }

  async selectProxy(group: string, name: string) {
    if (!this.target) {
      throw new Error("Mihomo runtime target is not configured.");
    }
    const response = await fetch(`${this.target.controllerUrl.replace(/\/+$/, "")}/proxies/${encodeURIComponent(group)}`, {
      method: "PUT",
      headers: {
        ...buildHeaders(this.target),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to switch selector ${group}: HTTP ${response.status}`);
    }
    await this.refreshProxies();
  }

  async testProxies(names: string[], url: string, timeout: number) {
    if (!this.target) {
      throw new Error("Mihomo runtime target is not configured.");
    }
    const uniqueNames = Array.from(new Set(names.filter(Boolean)));
    const concurrency = 8;
    for (let index = 0; index < uniqueNames.length; index += concurrency) {
      const batch = uniqueNames.slice(index, index + concurrency);
      await Promise.allSettled(
        batch.map((name) => {
          const params = new URLSearchParams({
            timeout: String(timeout),
            url,
          });
          return fetch(`${this.target!.controllerUrl.replace(/\/+$/, "")}/proxies/${encodeURIComponent(name)}/delay?${params.toString()}`, {
            headers: buildHeaders(this.target!),
            signal: AbortSignal.timeout(Math.max(timeout + 2_000, 5_000)),
          });
        }),
      );
    }
    await this.refreshProxies();
  }

  async listProbeNodes(): Promise<ProxyProbeNode[]> {
    if (!this.target) {
      throw new Error("Mihomo runtime target is not configured.");
    }
    const response = await fetch(`${this.target.controllerUrl.replace(/\/+$/, "")}/proxies`, {
      headers: buildHeaders(this.target),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch proxies: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return normalizeProbeNodes(payload);
  }

  async testProxyDelay(name: string, url: string, timeout: number): Promise<number> {
    if (!this.target) {
      throw new Error("Mihomo runtime target is not configured.");
    }
    const params = new URLSearchParams({
      timeout: String(timeout),
      url,
    });
    const response = await fetch(`${this.target.controllerUrl.replace(/\/+$/, "")}/proxies/${encodeURIComponent(name)}/delay?${params.toString()}`, {
      headers: buildHeaders(this.target),
      signal: AbortSignal.timeout(Math.max(timeout + 2_000, 5_000)),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Failed to test proxy ${name}: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const delay = Number(payload.delay);
    if (!Number.isFinite(delay) || delay < 0) {
      throw new Error(`Invalid delay response for proxy ${name}.`);
    }
    return Math.round(delay);
  }

  async refreshProxies() {
    if (!this.target) {
      return;
    }
    try {
      const response = await fetch(`${this.target.controllerUrl.replace(/\/+$/, "")}/proxies`, {
        headers: buildHeaders(this.target),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch proxies: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as Record<string, unknown>;
      this.emit("proxies", normalizeProxyGroups(payload));
      this.lastError = null;
      this.emitHealth(this.openStreams.size > 0, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.emitHealth(this.openStreams.size > 0, message);
    }
  }

  private connectAll() {
    this.connectSocket("connections");
    this.connectSocket("traffic");
    this.connectSocket("logs");
  }

  private connectSocket(kind: StreamKind) {
    if (this.stopped || !this.target) {
      return;
    }
    const socket = new WebSocket(this.buildStreamUrl(kind), {
      headers: buildHeaders(this.target),
      followRedirects: true,
    });
    this.sockets.set(kind, socket);

    socket.on("open", () => {
      this.openStreams.add(kind);
      this.lastError = null;
      this.emitHealth(true, null);
    });

    socket.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (kind === "connections") {
          this.emit("connections", mihomoConnectionsMessageSchema.parse(data));
        } else if (kind === "traffic") {
          this.emit("traffic", mihomoTrafficMessageSchema.parse(data));
        } else {
          this.emit(
            "logs",
            runtimeLogEntrySchema.parse({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              type: typeof data.type === "string" ? data.type : this.logLevel,
              payload: typeof data.payload === "string" ? data.payload : "",
              timestamp: new Date().toISOString(),
            }),
          );
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.emitHealth(this.openStreams.size > 0, this.lastError);
      }
    });

    socket.on("error", (error) => {
      this.lastError = error.message;
      this.emitHealth(this.openStreams.size > 0, this.lastError);
    });

    socket.on("close", () => {
      this.openStreams.delete(kind);
      this.sockets.delete(kind);
      this.emitHealth(this.openStreams.size > 0, this.lastError);
      if (!this.stopped) {
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(kind);
          this.connectSocket(kind);
        }, 3_000);
        this.reconnectTimers.set(kind, timer);
      }
    });
  }

  private buildStreamUrl(kind: StreamKind) {
    if (!this.target) {
      throw new Error("Mihomo runtime target is not configured.");
    }
    if (kind === "logs") {
      return toWsUrl(this.target.controllerUrl, `/logs?level=${encodeURIComponent(this.logLevel)}`);
    }
    if (kind === "connections") {
      return toWsUrl(this.target.controllerUrl, `/connections?interval=${CONNECTIONS_STREAM_INTERVAL_MS}`);
    }
    return toWsUrl(this.target.controllerUrl, `/${kind}`);
  }

  private startProxiesPolling() {
    if (this.proxiesTimer) {
      clearInterval(this.proxiesTimer);
    }
    this.proxiesTimer = setInterval(() => {
      void this.refreshProxies();
    }, 15_000);
  }

  private emitHealth(connected: boolean, lastError: string | null) {
    this.emit("health", { connected, lastError });
  }
}
