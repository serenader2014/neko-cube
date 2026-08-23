export type ProxyRecord = Record<string, unknown>;
export type ProxyConversion = { line: string } | { line: null; reason: string };
export type LineConverter = (proxy: ProxyRecord, name: string) => ProxyConversion;

export function textValue(record: ProxyRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

export function numberValue(record: ProxyRecord, ...keys: string[]): number | null {
  const value = textValue(record, ...keys);
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : null;
}

export function booleanValue(record: ProxyRecord, key: string, fallback = false): boolean {
  const value = record[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

export function recordValue(record: ProxyRecord, key: string): ProxyRecord {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ProxyRecord) : {};
}

export function endpoint(proxy: ProxyRecord): { host: string; port: number } | null {
  const host = textValue(proxy, "server");
  const port = numberValue(proxy, "port");
  return host && port && port > 0 && port <= 65_535 ? { host, port } : null;
}

export function sanitizeName(value: string): string {
  return value.replace(/[=,\r\n]/g, " · ").replace(/\s+/g, " ").trim() || "Proxy";
}

export function uniqueName(value: string, seen: Map<string, number>): string {
  const sanitized = sanitizeName(value);
  const count = seen.get(sanitized) ?? 0;
  seen.set(sanitized, count + 1);
  return count === 0 ? sanitized : `${sanitized} ${count + 1}`;
}

export function webSocketOptions(proxy: ProxyRecord) {
  const options = recordValue(proxy, "ws-opts");
  const headers = recordValue(options, "headers");
  return {
    path: textValue(options, "path") || "/",
    host: textValue(headers, "Host", "host") || textValue(proxy, "servername", "sni"),
    headers,
  };
}
