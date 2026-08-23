import type { ParsedProxy } from "./types.js";
import type { SubscriptionClientId } from "./subscription-clients.js";
import {
  convertLoonProxy,
  convertQuantumProxy,
  convertSurgeProxy,
  type SubscriptionDocument,
} from "./subscription-export.js";
import {
  booleanValue,
  endpoint,
  numberValue,
  type ProxyConversion,
  type ProxyRecord,
  recordValue,
  textValue,
  uniqueName,
  webSocketOptions,
} from "./subscription-export-utils.js";

type ProfileClient = Exclude<SubscriptionClientId, "mihomo">;

type PreparedProfile = {
  groupLines: string[];
  localRules: string[];
  proxyLines: string[];
  remoteRules: string[];
  skippedCount: number;
  warnings: string[];
};

const DIRECT_POLICIES = new Set(["DIRECT", "REJECT"]);

function quoteParameter(value: string): string {
  return /[,"]/.test(value) || value !== value.trim()
    ? `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
    : value;
}

function shadowrocketTransportParams(proxy: ProxyRecord): string[] {
  const network = textValue(proxy, "network") || "tcp";
  if (network === "tcp") {
    return [];
  }
  if (network === "ws") {
    const ws = webSocketOptions(proxy);
    return ["transport=ws", `path=${quoteParameter(ws.path)}`, ...(ws.host ? [`host=${quoteParameter(ws.host)}`] : [])];
  }
  if (network === "http" || network === "h2") {
    const options = recordValue(proxy, "http-opts");
    const host = Array.isArray(options.host) ? String(options.host[0] ?? "") : textValue(options, "host");
    const path = Array.isArray(options.path) ? String(options.path[0] ?? "/") : textValue(options, "path") || "/";
    return ["transport=http", ...(host ? [`host=${quoteParameter(host)}`] : []), `path=${quoteParameter(path)}`];
  }
  return [`transport=${quoteParameter(network)}`];
}

function shadowrocketTlsParams(proxy: ProxyRecord): string[] {
  const reality = recordValue(proxy, "reality-opts");
  const publicKey = textValue(reality, "public-key");
  const shortId = textValue(reality, "short-id");
  const sni = textValue(proxy, "servername", "sni");
  const tls = booleanValue(proxy, "tls") || Boolean(publicKey);
  if (!tls) {
    return [];
  }
  return [
    "tls=true",
    ...(sni ? [`peer=${quoteParameter(sni)}`] : []),
    `skip-cert-verify=${booleanValue(proxy, "skip-cert-verify")}`,
    ...(publicKey ? ["security=reality", `pbk=${quoteParameter(publicKey)}`] : []),
    ...(shortId ? [`sid=${quoteParameter(shortId)}`] : []),
  ];
}

function convertShadowrocketProfileProxy(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  if (!target) {
    return { line: null, reason: "缺少服务器或端口" };
  }

  const type = textValue(proxy, "type").toLowerCase();
  const common = [
    `udp=${booleanValue(proxy, "udp")}`,
    `fast-open=${booleanValue(proxy, "tfo")}`,
  ];
  let protocol = type;
  let params: string[] = [];

  switch (type) {
    case "ss":
      params = [
        `password=${quoteParameter(textValue(proxy, "password"))}`,
        `method=${quoteParameter(textValue(proxy, "cipher"))}`,
        ...common,
      ];
      break;
    case "vmess":
    case "vless": {
      const uuid = textValue(proxy, "uuid");
      if (!uuid) {
        return { line: null, reason: "缺少 UUID" };
      }
      params = [
        `password=${quoteParameter(uuid)}`,
        ...(type === "vmess" ? [`method=${quoteParameter(textValue(proxy, "cipher") || "none")}`] : []),
        ...shadowrocketTransportParams(proxy),
        ...shadowrocketTlsParams(proxy),
        ...(textValue(proxy, "flow") ? [`flow=${quoteParameter(textValue(proxy, "flow"))}`] : []),
        ...common,
      ];
      break;
    }
    case "trojan":
      params = [
        `password=${quoteParameter(textValue(proxy, "password"))}`,
        ...shadowrocketTransportParams(proxy),
        ...shadowrocketTlsParams({ ...proxy, tls: true }),
        ...common,
      ];
      break;
    case "hysteria2":
    case "hy2":
      protocol = "hysteria2";
      params = [
        `auth=${quoteParameter(textValue(proxy, "password", "auth"))}`,
        ...shadowrocketTlsParams({ ...proxy, tls: true }),
        ...(textValue(proxy, "obfs") ? [`obfs=${quoteParameter(textValue(proxy, "obfs"))}`] : []),
        ...(textValue(proxy, "obfs-password")
          ? [`obfs-password=${quoteParameter(textValue(proxy, "obfs-password"))}`]
          : []),
        ...common,
      ];
      break;
    case "anytls":
      params = [
        `password=${quoteParameter(textValue(proxy, "password"))}`,
        ...shadowrocketTlsParams({ ...proxy, tls: true }),
        ...common,
      ];
      break;
    case "http":
    case "https":
    case "socks5":
      params = [
        ...(textValue(proxy, "username") ? [`username=${quoteParameter(textValue(proxy, "username"))}`] : []),
        ...(textValue(proxy, "password") ? [`password=${quoteParameter(textValue(proxy, "password"))}`] : []),
        ...(type === "https" ? shadowrocketTlsParams({ ...proxy, tls: true }) : shadowrocketTlsParams(proxy)),
      ];
      break;
    default:
      return { line: null, reason: `不支持 ${type || "未知"} 协议` };
  }

  if (params.some((item) => item.endsWith("="))) {
    return { line: null, reason: "缺少认证信息" };
  }
  return { line: `${name} = ${protocol}, ${target.host}, ${target.port}, ${params.join(", ")}` };
}

function convertProxy(client: ProfileClient, proxy: ProxyRecord, name: string): ProxyConversion {
  switch (client) {
    case "surge":
      return convertSurgeProxy(proxy, name);
    case "quantumult-x":
      return convertQuantumProxy(proxy, name);
    case "loon":
      return convertLoonProxy(proxy, name);
    case "shadowrocket":
      return convertShadowrocketProfileProxy(proxy, name);
  }
}

function mapBuiltinPolicy(client: ProfileClient, value: string): string | null {
  const normalized = value.toUpperCase();
  if (!DIRECT_POLICIES.has(normalized)) {
    return null;
  }
  return client === "quantumult-x" ? normalized.toLowerCase() : normalized;
}

function buildGroupLine(
  client: ProfileClient,
  group: ProxyRecord,
  name: string,
  members: string[],
): string {
  const rawType = textValue(group, "type") || "select";
  const interval = numberValue(group, "interval") ?? 300;
  const timeoutSeconds = Math.max(1, Math.ceil((numberValue(group, "timeout") ?? 5000) / 1000));
  const url = textValue(group, "url") || "http://cp.cloudflare.com/generate_204";

  if (client === "quantumult-x") {
    const type = rawType === "url-test" ? "url-latency-benchmark" : rawType === "fallback" ? "available" : "static";
    return `${type} = ${[name, ...members, ...(type === "url-latency-benchmark" ? [`check-interval=${interval}`] : [])].join(", ")}`;
  }

  const options = rawType === "select"
    ? []
    : client === "loon"
      ? [`url=${url}`, `interval=${interval}`]
      : [`url=${url}`, `interval=${interval}`, `timeout=${timeoutSeconds}`];
  return `${name} = ${[rawType, ...members, ...options].join(", ")}`;
}

function quantumRuleType(type: string): string | null {
  const types: Record<string, string> = {
    DOMAIN: "host",
    "DOMAIN-SUFFIX": "host-suffix",
    "DOMAIN-KEYWORD": "host-keyword",
    "IP-CIDR": "ip-cidr",
    "IP-CIDR6": "ip6-cidr",
    GEOIP: "geoip",
  };
  return types[type] ?? null;
}

function nativeRuleType(client: ProfileClient, type: string): string | null {
  if (client === "quantumult-x") {
    return quantumRuleType(type);
  }
  const supported = new Set([
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "IP-CIDR",
    "IP-CIDR6",
    "SRC-IP-CIDR",
    "SRC-PORT",
    "DST-PORT",
    "PROCESS-NAME",
    "PROCESS-PATH",
    "GEOIP",
  ]);
  if (!supported.has(type)) {
    return null;
  }
  return client === "shadowrocket" && type === "IP-CIDR6" ? "IP-CIDR" : type;
}

function buildPreparedProfile(config: Record<string, unknown>, client: ProfileClient): PreparedProfile {
  const proxies = Array.isArray(config.proxies) ? (config.proxies as ParsedProxy[]) : [];
  const groups = Array.isArray(config["proxy-groups"])
    ? (config["proxy-groups"] as ProxyRecord[])
    : [];
  const rules = Array.isArray(config.rules) ? config.rules.filter((item): item is string => typeof item === "string") : [];
  const providers = recordValue(config, "rule-providers");
  const seenNames = new Map<string, number>();
  const proxyNames = new Map<string, string>();
  const groupNames = new Map<string, string>();
  const proxyLines: string[] = [];
  const warnings: string[] = [];
  const warningSet = new Set<string>();

  const warn = (message: string) => {
    if (!warningSet.has(message)) {
      warningSet.add(message);
      warnings.push(message);
    }
  };

  for (const proxy of proxies) {
    const originalName = textValue(proxy, "name");
    const name = uniqueName(originalName, seenNames);
    const converted = convertProxy(client, proxy, name);
    if (converted.line === null) {
      warn(`${name}: ${converted.reason}`);
      continue;
    }
    proxyNames.set(originalName, name);
    proxyLines.push(converted.line);
  }

  for (const group of groups) {
    const originalName = textValue(group, "name");
    groupNames.set(originalName, uniqueName(originalName, seenNames));
  }

  const fallbackPolicy = groupNames.get("FINAL") ?? (client === "quantumult-x" ? "direct" : "DIRECT");
  const mapPolicy = (value: string): string => {
    const builtin = mapBuiltinPolicy(client, value);
    if (builtin) {
      return builtin;
    }
    const mapped = groupNames.get(value) ?? proxyNames.get(value);
    if (mapped) {
      return mapped;
    }
    warn(`策略 ${value} 无法在 ${client} 中解析，已回退到 ${fallbackPolicy}`);
    return fallbackPolicy;
  };

  const groupLines = groups.map((group) => {
    const originalName = textValue(group, "name");
    const name = groupNames.get(originalName) ?? originalName;
    const rawMembers = Array.isArray(group.proxies)
      ? group.proxies.filter((item): item is string => typeof item === "string")
      : [];
    const members = rawMembers.flatMap((member) => {
      const builtin = mapBuiltinPolicy(client, member);
      const mapped = builtin ?? groupNames.get(member) ?? proxyNames.get(member);
      if (!mapped) {
        warn(`策略组 ${originalName} 跳过不可用成员 ${member}`);
        return [];
      }
      return [mapped];
    });
    return buildGroupLine(client, group, name, members.length > 0 ? members : [client === "quantumult-x" ? "direct" : "DIRECT"]);
  });

  const localRules: string[] = [];
  const remoteRules: string[] = [];
  let finalPolicy = fallbackPolicy;

  for (const rawRule of rules) {
    const parts = rawRule.split(",").map((item) => item.trim());
    const type = (parts[0] ?? "").toUpperCase();
    if (type === "MATCH" || type === "FINAL") {
      finalPolicy = mapPolicy(parts[1] ?? "FINAL");
      continue;
    }
    if (type === "RULE-SET") {
      const providerName = parts[1] ?? "";
      const provider = recordValue(providers, providerName);
      const url = textValue(provider, "url");
      if (!url) {
        warn(`规则集 ${providerName} 缺少可用于 ${client} 的远程地址`);
        continue;
      }
      if (textValue(provider, "format") === "yaml") {
        warn(`规则集 ${providerName} 使用 YAML 格式，请确认上游同时兼容 ${client}`);
      }
      const policy = mapPolicy(parts[2] ?? "FINAL");
      if (client === "quantumult-x") {
        remoteRules.push(`${url}, tag=${providerName}, force-policy=${policy}, enabled=true`);
      } else if (client === "loon") {
        remoteRules.push(`${url},policy=${policy},tag=${providerName},enabled=true`);
      } else {
        localRules.push(`RULE-SET,${url},${policy}`);
      }
      continue;
    }

    const mappedType = nativeRuleType(client, type);
    if (!mappedType || parts.length < 3) {
      warn(`跳过 ${client} 不支持的规则：${rawRule}`);
      continue;
    }
    const policy = mapPolicy(parts[2] ?? "FINAL");
    const noResolve = parts.slice(3).some((item) => item.toLowerCase() === "no-resolve");
    localRules.push(`${mappedType},${parts[1]},${policy}${noResolve && client !== "quantumult-x" ? ",no-resolve" : ""}`);
  }

  localRules.push(`${client === "quantumult-x" ? "final" : "FINAL"},${finalPolicy}`);
  return {
    groupLines,
    localRules,
    proxyLines,
    remoteRules,
    skippedCount: proxies.length - proxyLines.length,
    warnings,
  };
}

function joinSections(sections: Array<[string, string[]]>): string[] {
  return sections.flatMap(([name, lines], index) => [
    ...(index > 0 ? [""] : []),
    `[${name}]`,
    ...lines,
  ]);
}

function buildProfileContent(client: ProfileClient, profile: PreparedProfile): string {
  const comments = [
    "# Generated by NekoCube. Do not edit this managed profile.",
    `# Exported proxies: ${profile.proxyLines.length}`,
    ...profile.warnings.map((warning) => `# Warning: ${warning}`),
    "",
  ];

  if (client === "quantumult-x") {
    return `${[
      ...comments,
      ...joinSections([
        ["general", ["server_check_url = http://cp.cloudflare.com/generate_204"]],
        ["server_local", profile.proxyLines],
        ["policy", profile.groupLines],
        ["filter_remote", profile.remoteRules],
        ["filter_local", profile.localRules],
      ]),
    ].join("\n")}\n`;
  }

  const general = client === "loon"
    ? [
        "internet-test-url = http://cp.cloudflare.com/generate_204",
        "proxy-test-url = http://cp.cloudflare.com/generate_204",
      ]
    : ["dns-server = system"];
  const sections: Array<[string, string[]]> = [
    ["General", general],
    ["Proxy", profile.proxyLines],
    ["Proxy Group", profile.groupLines],
    ["Rule", profile.localRules],
  ];
  if (client === "loon") {
    sections.push(["Remote Rule", profile.remoteRules]);
  }
  return `${[...comments, ...joinSections(sections)].join("\n")}\n`;
}

export function exportClientProfileDocument(
  config: Record<string, unknown>,
  client: ProfileClient,
): SubscriptionDocument {
  const profile = buildPreparedProfile(config, client);
  return {
    client,
    kind: "profile",
    content: buildProfileContent(client, profile),
    contentType: "text/plain; charset=utf-8",
    filename: `${client}-profile.conf`,
    proxyCount: profile.proxyLines.length,
    skippedCount: profile.skippedCount,
    warnings: profile.warnings,
  };
}
