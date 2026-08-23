import yaml from "js-yaml";
import type { SubscriptionRuleClientId } from "./subscription-clients.js";

export type RuleProviderSource = {
  name: string;
  behavior: "classical" | "domain" | "ipcidr";
  format: "yaml" | "text";
  url: string;
  interval: number;
};

export type RuleSetDocument = {
  client: SubscriptionRuleClientId;
  content: string;
  contentType: string;
  filename: string;
  ruleCount: number;
  skippedCount: number;
  warnings: string[];
};

type ConversionResult =
  | { line: string; reason?: never }
  | { line: null; reason: string };

const QUANTUMULT_X_RULE_TYPES: Record<string, string> = {
  DOMAIN: "host",
  "DOMAIN-SUFFIX": "host-suffix",
  "DOMAIN-KEYWORD": "host-keyword",
  "IP-CIDR": "ip-cidr",
  "IP-CIDR6": "ip6-cidr",
  GEOIP: "geoip",
  "USER-AGENT": "user-agent",
};

const STANDARD_RULE_TYPES = new Set([
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
  "USER-AGENT",
  "URL-REGEX",
]);

const SHADOWROCKET_UNSUPPORTED_TYPES = new Set(["PROCESS-NAME", "PROCESS-PATH"]);

function sourcePayload(rawContent: string, format: RuleProviderSource["format"]): {
  entries: string[];
  invalidCount: number;
} {
  if (format === "text") {
    return {
      entries: rawContent
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !line.startsWith(";") && !line.startsWith("//")),
      invalidCount: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(rawContent);
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(`Clash YAML 解析失败：${message}`);
  }

  const payload = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).payload
      : null;
  if (!Array.isArray(payload)) {
    throw new Error("Clash YAML 缺少 payload 数组");
  }

  const entries = payload.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  return {
    entries: entries.map((entry) => entry.trim()),
    invalidCount: payload.length - entries.length,
  };
}

function standardRuleType(client: SubscriptionRuleClientId, type: string): string | null {
  if (!STANDARD_RULE_TYPES.has(type)) {
    return null;
  }
  if (client === "shadowrocket") {
    if (SHADOWROCKET_UNSUPPORTED_TYPES.has(type)) {
      return null;
    }
    return type === "IP-CIDR6" ? "IP-CIDR" : type;
  }
  return type;
}

function convertClassicalRule(entry: string, client: SubscriptionRuleClientId): ConversionResult {
  const parts = entry.split(",").map((part) => part.trim());
  const type = (parts[0] ?? "").toUpperCase();
  const target = parts[1] ?? "";
  if (!type || !target) {
    return { line: null, reason: "规则缺少类型或匹配内容" };
  }

  if (client === "quantumult-x") {
    const mappedType = QUANTUMULT_X_RULE_TYPES[type];
    if (!mappedType) {
      return { line: null, reason: `Quantumult X 不支持 ${type}` };
    }
    return { line: `${mappedType},${target},direct` };
  }

  const mappedType = standardRuleType(client, type);
  if (!mappedType) {
    return { line: null, reason: `${client} 不支持 ${type}` };
  }
  const noResolve = parts.slice(2).some((part) => part.toLowerCase() === "no-resolve");
  return { line: `${mappedType},${target}${noResolve ? ",no-resolve" : ""}` };
}

function domainRule(entry: string): ConversionResult {
  const value = entry.trim();
  if (!value || value.includes(",") || value.includes("/")) {
    return { line: null, reason: "无效的 domain behavior 条目" };
  }

  if (value.startsWith("+.") || value.startsWith("*.") || value.startsWith(".")) {
    const domain = value.replace(/^(\+\.|\*\.|\.)/, "");
    return domain && !/[?*]/.test(domain)
      ? { line: `DOMAIN-SUFFIX,${domain}` }
      : { line: null, reason: "不支持的域名通配表达式" };
  }
  if (/[?*]/.test(value)) {
    return { line: null, reason: "不支持的域名通配表达式" };
  }
  return { line: `DOMAIN,${value}` };
}

function ipCidrRule(entry: string): ConversionResult {
  const value = entry.trim();
  if (!value || value.includes(",") || !value.includes("/")) {
    return { line: null, reason: "无效的 ipcidr behavior 条目" };
  }
  return { line: `${value.includes(":") ? "IP-CIDR6" : "IP-CIDR"},${value}` };
}

function normalizeSourceEntry(entry: string, behavior: RuleProviderSource["behavior"]): ConversionResult {
  if (behavior === "classical") {
    return { line: entry };
  }
  return behavior === "domain" ? domainRule(entry) : ipCidrRule(entry);
}

function warningLines(reasons: Map<string, number>): string[] {
  return [...reasons.entries()].map(([reason, count]) => `跳过 ${count} 条规则：${reason}`);
}

function safeFilename(name: string): string {
  const normalized = name.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${normalized || "rules"}.list`;
}

export function readRuleProviderSource(
  config: Record<string, unknown>,
  providerName: string,
): RuleProviderSource | null {
  const providers = config["rule-providers"];
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
    return null;
  }
  const provider = (providers as Record<string, unknown>)[providerName];
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    return null;
  }

  const record = provider as Record<string, unknown>;
  const behavior = record.behavior;
  const format = record.format;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url || (behavior !== "classical" && behavior !== "domain" && behavior !== "ipcidr")) {
    return null;
  }

  return {
    name: providerName,
    behavior,
    format: format === "text" ? "text" : "yaml",
    url,
    interval:
      typeof record.interval === "number" && Number.isFinite(record.interval) && record.interval > 0
        ? record.interval
        : 3600,
  };
}

export function exportRuleSetDocument(
  source: RuleProviderSource,
  rawContent: string,
  client: SubscriptionRuleClientId,
  additionalWarnings: string[] = [],
): RuleSetDocument {
  const parsed = sourcePayload(rawContent, source.format);
  const rules: string[] = [];
  const seen = new Set<string>();
  const skippedReasons = new Map<string, number>();

  const skip = (reason: string) => skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
  if (parsed.invalidCount > 0) {
    skippedReasons.set("payload 包含非文本条目", parsed.invalidCount);
  }

  for (const entry of parsed.entries) {
    const normalized = normalizeSourceEntry(entry, source.behavior);
    if (normalized.line === null) {
      skip(normalized.reason);
      continue;
    }
    const converted = convertClassicalRule(normalized.line, client);
    if (converted.line === null) {
      skip(converted.reason);
      continue;
    }
    if (seen.has(converted.line)) {
      skip("转换后规则重复");
      continue;
    }
    seen.add(converted.line);
    rules.push(converted.line);
  }

  const warnings = [...additionalWarnings, ...warningLines(skippedReasons)];
  const skippedCount = [...skippedReasons.values()].reduce((total, count) => total + count, 0);
  const comments = [
    "# Generated by NekoCube from a Clash rule provider.",
    `# Source: ${source.name} (${source.format}/${source.behavior})`,
    `# Exported rules: ${rules.length}; skipped: ${skippedCount}`,
    ...warnings.map((warning) => `# Warning: ${warning}`),
  ];

  return {
    client,
    content: `${[...comments, ...rules].join("\n")}\n`,
    contentType: "text/plain; charset=utf-8",
    filename: safeFilename(source.name),
    ruleCount: rules.length,
    skippedCount,
    warnings,
  };
}
