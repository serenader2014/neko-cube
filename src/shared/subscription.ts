import yaml from "js-yaml";
import { parsedProxySchema, type ParsedProxy } from "./types.js";

export type ParsedSubscription = {
  rawConfig: Record<string, unknown>;
  proxies: ParsedProxy[];
};

function normalizeName(rawName: string, fallback: string): string {
  try {
    const decoded = decodeURIComponent(rawName);
    return decoded.trim() || fallback;
  } catch {
    return rawName.trim() || fallback;
  }
}

function shouldSkipNodeName(name: string): boolean {
  return [
    "剩余流量",
    "下次重置",
    "套餐到期",
    "到期",
    "流量",
    "Traffic:",
    "Traffic ",
    "Expire",
    "Remaining",
    "Reset",
  ].some((keyword) => name.includes(keyword));
}

function isPlaceholderProxy(proxy: ParsedProxy): boolean {
  const name = String(proxy.name ?? "");
  const server = String(proxy.server ?? "");
  const port = Number(proxy.port ?? 0);

  if (shouldSkipNodeName(name)) {
    return true;
  }

  if (server === "127.0.0.1" && port === 1234) {
    return true;
  }

  return [
    "官网地址",
    "当前Clash客户端不支持本机场协议",
    "请更换以下支持协议的代理软件",
    "Win客户端",
    "Mac客户端",
    "安卓客户端",
    "iOS客户端",
    "IOS客户端",
  ].some((keyword) => name.includes(keyword));
}

function parseYamlSubscription(rawYaml: string): ParsedSubscription | null {
  let loaded: unknown;

  try {
    loaded = yaml.load(rawYaml);
  } catch (error) {
    return null;
  }

  if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
    return null;
  }

  const rawConfig = loaded as Record<string, unknown>;
  const rawProxies = rawConfig.proxies;

  if (!Array.isArray(rawProxies)) {
    return null;
  }

  const proxies = rawProxies
    .map((proxy, index) => {
      if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) {
        throw new Error(`Proxy at index ${index} is not an object`);
      }

      const candidate = parsedProxySchema.safeParse(proxy);
      if (!candidate.success) {
        throw new Error(`Proxy at index ${index} is invalid: ${candidate.error.message}`);
      }

      return candidate.data;
    })
    .filter((proxy) => !isPlaceholderProxy(proxy));

  return { rawConfig, proxies };
}

function tryDecodeBase64(input: string): string | null {
  const compact = input.replace(/\s+/g, "");

  if (!compact || compact.length % 4 === 1 || /[^A-Za-z0-9+/=_-]/.test(compact)) {
    return null;
  }

  try {
    const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return decoded.includes("://") ? decoded : null;
  } catch {
    return null;
  }
}

function parseHysteria2Uri(url: URL): ParsedProxy | null {
  const name = normalizeName(url.hash.slice(1), "hysteria2");
  if (shouldSkipNodeName(name)) {
    return null;
  }

  return parsedProxySchema.parse({
    name,
    type: "hysteria2",
    server: url.hostname,
    port: Number(url.port || "443"),
    password: decodeURIComponent(url.username),
    sni: url.searchParams.get("sni") || undefined,
    "skip-cert-verify": ["1", "true"].includes((url.searchParams.get("insecure") || "").toLowerCase()),
    ...(url.searchParams.get("mport") ? { ports: url.searchParams.get("mport") } : {}),
    ...(url.searchParams.get("obfs") ? { obfs: url.searchParams.get("obfs") } : {}),
    ...(url.searchParams.get("obfs-password") ? { "obfs-password": url.searchParams.get("obfs-password") } : {}),
    udp: true,
  });
}

function parseVlessUri(url: URL): ParsedProxy | null {
  const name = normalizeName(url.hash.slice(1), "vless");
  if (shouldSkipNodeName(name)) {
    return null;
  }

  const network = url.searchParams.get("type") || "tcp";
  const security = url.searchParams.get("security") || "";
  const host = url.searchParams.get("host") || "";
  const path = url.searchParams.get("path") || "";

  const proxy: Record<string, unknown> = {
    name,
    type: "vless",
    server: url.hostname,
    port: Number(url.port || "443"),
    uuid: decodeURIComponent(url.username),
    udp: true,
    tls: security === "tls" || security === "reality",
    servername: url.searchParams.get("sni") || undefined,
    network,
    flow: url.searchParams.get("flow") || undefined,
    "client-fingerprint": url.searchParams.get("fp") || undefined,
    encryption: url.searchParams.get("encryption") || "",
    "skip-cert-verify": false,
  };

  if (security === "reality" && url.searchParams.get("pbk")) {
    proxy["reality-opts"] = {
      "public-key": url.searchParams.get("pbk"),
      "short-id": url.searchParams.get("sid") || "",
    };
  }

  if (network === "ws") {
    proxy["ws-opts"] = {
      path: path || "/",
      ...(host ? { headers: { Host: host } } : {}),
    };
  }

  if (network === "grpc") {
    proxy["grpc-opts"] = {
      "grpc-service-name": url.searchParams.get("serviceName") || "",
    };
  }

  if (network === "http" || network === "h2") {
    proxy["http-opts"] = {
      path: [path || "/"],
      ...(host ? { host: [host] } : {}),
    };
  }

  return parsedProxySchema.parse(proxy);
}

function parseUriLine(line: string): ParsedProxy | null {
  let url: URL;

  try {
    url = new URL(line);
  } catch {
    return null;
  }

  switch (url.protocol.replace(":", "")) {
    case "hysteria2":
      return parseHysteria2Uri(url);
    case "vless":
      return parseVlessUri(url);
    default:
      return null;
  }
}

function parseUriSubscription(rawContent: string): ParsedSubscription | null {
  const decoded = tryDecodeBase64(rawContent) ?? rawContent;
  const lines = decoded
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.some((line) => line.includes("://"))) {
    return null;
  }

  const proxies = lines
    .map(parseUriLine)
    .filter((proxy): proxy is ParsedProxy => proxy !== null);

  if (proxies.length === 0) {
    return null;
  }

  return {
    rawConfig: {
      format: "uri-list",
      lineCount: lines.length,
    },
    proxies,
  };
}

export function parseClashSubscription(rawContent: string): ParsedSubscription {
  const yamlResult = parseYamlSubscription(rawContent);
  if (yamlResult) {
    return yamlResult;
  }

  const uriResult = parseUriSubscription(rawContent);
  if (uriResult) {
    return uriResult;
  }

  throw new Error("Unsupported subscription format: expected Mihomo YAML or supported URI subscription");
}
