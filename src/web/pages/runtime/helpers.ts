import type {
  MihomoConnection,
  RuntimeOverviewState,
  RuntimeProxyGroup,
  RuntimeSnapshot,
  RuntimeTrafficPoint,
} from "../../../shared/telemetry";
import { formatDateTime } from "../../lib/telemetry";
import { RUNTIME_TRAFFIC_WINDOW_MS } from "./constants";
import type { ConnectionGroupKey, QuickRuleSeed, RuntimeNavItem } from "./types";

export function buildProxyTrafficData(connections: MihomoConnection[]) {
  const groups = new Map<string, { label: string; value: number; connections: number }>();
  for (const connection of connections) {
    const label = connection.chains[0] || "DIRECT";
    const next = groups.get(label) ?? { label, value: 0, connections: 0 };
    next.value += connection.download + connection.upload;
    next.connections += 1;
    groups.set(label, next);
  }
  return [...groups.values()].sort((left, right) => right.value - left.value).slice(0, 5);
}

export function buildRuntimeOverviewState(snapshot: RuntimeSnapshot): RuntimeOverviewState {
  return {
    proxyTraffic: buildProxyTrafficData(snapshot.activeConnections),
    recentClosedConnections: buildRuntimeOverviewClosedConnections(snapshot.recentClosedConnections),
  };
}

export function buildRuntimeOverviewClosedConnections(connections: MihomoConnection[]): RuntimeOverviewState["recentClosedConnections"] {
  return connections.slice(0, 5).map((connection) => ({
    id: connection.id,
    title: getConnectionTitle(connection),
    rule: connection.rule || "MATCH",
    chain: connection.chains[0] || "DIRECT",
    totalBytes: connection.download + connection.upload,
    start: connection.start,
  }));
}

export function buildRuntimeTrafficWindow(
  history: RuntimeTrafficPoint[],
  nowMs: number,
  latest: { up: number; down: number; activeConnections: number },
) {
  const points = history
    .map((point) => ({
      ...point,
      timestampMs: new Date(point.timestamp).getTime(),
    }))
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((left, right) => left.timestampMs - right.timestampMs);

  if (!points.length) {
    return {
      points: [],
      domain: [nowMs - 1_000, nowMs] as [number, number],
    };
  }

  const firstPointMs = points[0]!.timestampMs;
  const domainEnd = Math.max(nowMs, firstPointMs + 1_000);
  const fullWindowStartMs = domainEnd - RUNTIME_TRAFFIC_WINDOW_MS;
  const domainStart = firstPointMs <= fullWindowStartMs ? fullWindowStartMs : firstPointMs;
  const visiblePoints = points.filter((point) => point.timestampMs >= domainStart && point.timestampMs <= domainEnd);
  const normalizedPoints = [...visiblePoints];
  const tailPoint = normalizedPoints[normalizedPoints.length - 1];

  if (!tailPoint || tailPoint.timestampMs < domainEnd) {
    normalizedPoints.push({
      timestamp: new Date(domainEnd).toISOString(),
      timestampMs: domainEnd,
      up: latest.up,
      down: latest.down,
      activeConnections: latest.activeConnections,
    });
  }

  return {
    points: normalizedPoints,
    domain: [domainStart, domainEnd] as [number, number],
  };
}

export function buildProxySegments(group: RuntimeProxyGroup) {
  const alive = group.options.filter((option) => option.alive === true && option.delay !== null);
  const good = alive.filter((option) => (option.delay ?? 0) <= 120).length;
  const warm = alive.filter((option) => (option.delay ?? 0) > 120 && (option.delay ?? 0) <= 280).length;
  const hot = alive.filter((option) => (option.delay ?? 0) > 280).length;
  const unknown = group.options.length - good - warm - hot;
  const total = Math.max(group.options.length, 1);
  return [good, warm, hot, unknown]
    .filter((count) => count > 0)
    .map((count) => ({ percent: (count / total) * 100 }));
}

export function getConnectionTitle(connection: MihomoConnection) {
  return connection.metadata.host || connection.metadata.sniffHost || connection.metadata.destinationIP || "(unknown)";
}

export function formatConnectionSource(connection: MihomoConnection) {
  return connection.metadata.sourceIP || "inner";
}

export function getConnectionColumnValue(connection: MihomoConnection, column: Exclude<ConnectionGroupKey, "none"> | "destination") {
  if (column === "type") {
    return `${connection.metadata.type || "-"} ${connection.metadata.network || "-"}`.trim();
  }
  if (column === "source") {
    return formatConnectionSource(connection);
  }
  if (column === "host") {
    return getConnectionTitle(connection);
  }
  if (column === "rule") {
    return connection.rulePayload ? `${connection.rule} ${connection.rulePayload}` : connection.rule || "";
  }
  if (column === "chain") {
    return connection.chains.join(" :: ") || "DIRECT";
  }
  if (column === "source") {
    return formatConnectionSource(connection);
  }
  if (column === "destination") {
    return connection.metadata.destinationIP || "";
  }
  return "";
}

export function matchesConnectionSearch(connection: MihomoConnection, keyword: string) {
  return [
    getConnectionColumnValue(connection, "type"),
    getConnectionColumnValue(connection, "source"),
    getConnectionColumnValue(connection, "host"),
    getConnectionColumnValue(connection, "rule"),
    getConnectionColumnValue(connection, "chain"),
    getConnectionColumnValue(connection, "source"),
    getConnectionColumnValue(connection, "destination"),
  ]
    .join(" ")
    .toLowerCase()
    .includes(keyword);
}

export function bestDelayLabel(group: RuntimeProxyGroup) {
  const delays = group.options.map((option) => option.delay).filter((delay): delay is number => typeof delay === "number");
  if (!delays.length) {
    return "n/a";
  }
  return `${Math.min(...delays)}ms`;
}

export function formatDelayChip(delay: number | null, alive: boolean | null) {
  if (alive === false) {
    return "down";
  }
  if (delay === null) {
    return "unknown";
  }
  return `${delay}ms`;
}

export function getLogNumericId(id: string) {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractLogType(payload: string) {
  const match = payload.match(/^\[([^\]]+)\]/);
  return match?.[1] ?? "";
}

function isIpv4(value: string) {
  const segments = value.split(".");
  return segments.length === 4 && segments.every((segment) => /^\d{1,3}$/.test(segment) && Number(segment) <= 255);
}

function isIpv6(value: string) {
  return value.includes(":") && /^[0-9a-f:]+$/i.test(value);
}

function stripDestinationPort(value: string) {
  const normalized = value.trim().replace(/[),;]+$/, "");
  const bracketed = normalized.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed?.[1]) {
    return bracketed[1];
  }

  const domainOrIpv4WithPort = normalized.match(/^([^:]+):\d+$/);
  return domainOrIpv4WithPort?.[1] ?? normalized;
}

function buildDestinationRuleSeed(
  destination: string,
  policy: string,
  note: string,
  context: string,
): QuickRuleSeed {
  const target = stripDestinationPort(destination);
  if (isIpv4(target)) {
    return { type: "IP-CIDR", target: `${target}/32`, policy, noResolve: true, note, context };
  }
  if (isIpv6(target)) {
    return { type: "IP-CIDR6", target: `${target}/128`, policy, noResolve: true, note, context };
  }
  return { type: "DOMAIN", target, policy, noResolve: false, note, context };
}

export function buildConnectionQuickRuleSeed(connection: MihomoConnection): QuickRuleSeed {
  const destination = connection.metadata.sniffHost || connection.metadata.host || connection.metadata.destinationIP;
  const source = formatConnectionSource(connection);
  const title = getConnectionTitle(connection);
  const policy = connection.chains.at(-1) || "FINAL";
  return buildDestinationRuleSeed(
    destination,
    policy === "GLOBAL" || policy === "AUTO" ? "FINAL" : policy,
    `来自运行连接：${source} → ${title}`,
    `${source} → ${title}`,
  );
}

export function buildLogQuickRuleSeed(log: { payload: string }): QuickRuleSeed {
  const destination = log.payload.match(/-->\s+(.+?)(?:\s+match\b|\s+using\b|$)/i)?.[1] ?? "";
  const rawPolicy = (log.payload.match(/\busing\s+(\S+)/i)?.[1] ?? "FINAL").split("[")[0] || "FINAL";
  const policy = rawPolicy === "GLOBAL" || rawPolicy === "AUTO" ? "FINAL" : rawPolicy;
  const context = log.payload.length > 220 ? `${log.payload.slice(0, 217)}…` : log.payload;
  return buildDestinationRuleSeed(destination, policy, "来自运行日志快速添加", context);
}

export function formatRuntimeAge(value?: string | null) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) {
    return "a few seconds ago";
  }
  if (diff < 3_600_000) {
    return `${Math.round(diff / 60_000)} minutes ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.round(diff / 3_600_000)} hours ago`;
  }
  return formatDateTime(value);
}

export function compareProxyGroups(left: RuntimeProxyGroup, right: RuntimeProxyGroup) {
  return proxyGroupRank(left.type) - proxyGroupRank(right.type) || left.name.localeCompare(right.name, "zh-Hans-CN");
}

export function proxyGroupRank(type: string) {
  const normalized = type.toLowerCase();
  if (normalized.includes("selector") || normalized.includes("urltest")) {
    return 0;
  }
  if (normalized.includes("fallback")) {
    return 1;
  }
  return 2;
}

export function getRuntimeSection(pathname: string): RuntimeNavItem["to"] | null {
  if (pathname.includes("/runtime/overview")) {
    return "overview";
  }
  if (pathname.includes("/runtime/proxies")) {
    return "proxies";
  }
  if (pathname.includes("/runtime/connections")) {
    return "connections";
  }
  if (pathname.includes("/runtime/logs")) {
    return "logs";
  }
  return null;
}
