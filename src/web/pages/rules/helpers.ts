import { parse as parseYaml } from "yaml";
import type { ProxyGroupDraft, RegionRule, RuleProviderDraft, SubscriptionSource } from "@shared/types";
import { builtinPolicyTargets } from "./constants";
import type { BulkImportedProvider, PolicyTargetGroup } from "./types";

export function formatSourceGroupName(value: string) {
  return `[订阅] ${value}`;
}

export function formatRegionGroupName(value: string) {
  return `[地区] ${value}`;
}

export function buildPolicyTargetGroups({
  regions,
  proxyGroups,
  sources,
  currentValue,
}: {
  regions: RegionRule[];
  proxyGroups: ProxyGroupDraft[];
  sources: SubscriptionSource[];
  currentValue: string;
}): PolicyTargetGroup[] {
  const groups: PolicyTargetGroup[] = [
    {
      label: "内置策略",
      options: [...builtinPolicyTargets],
    },
  ];

  if (regions.length) {
    groups.push({
      label: "地域分组",
      options: regions.map((region) => formatRegionGroupName(region.name)),
    });
  }

  if (proxyGroups.length) {
    groups.push({
      label: "自定义分组",
      options: proxyGroups.map((group) => group.name),
    });
  }

  if (sources.length) {
    groups.push({
      label: "订阅分组",
      options: sources.map((source) => formatSourceGroupName(source.name)),
    });
  }

  if (currentValue && !groups.some((group) => group.options.includes(currentValue))) {
    groups.unshift({
      label: "当前值",
      options: [currentValue],
    });
  }

  return groups;
}

export function parseProviderYamlCollection(yamlText: string, initialSortOrder: number): BulkImportedProvider[] {
  const parsed = parseYaml(yamlText);
  const root = isRecord(parsed) && isRecord(parsed["rule-providers"]) ? parsed["rule-providers"] : parsed;

  if (!isRecord(root)) {
    throw new Error("YAML 需要是 provider 名称到配置体的映射，或包含 rule-providers 根键。");
  }

  const items: BulkImportedProvider[] = [];
  let nextSortOrder = initialSortOrder;

  for (const [name, value] of Object.entries(root)) {
    if (!isRecord(value)) {
      throw new Error(`规则集 ${name} 的内容不是合法对象。`);
    }

    const normalized = normalizeImportedProvider(name, value, nextSortOrder);
    items.push(normalized);
    nextSortOrder += 10;
  }

  return items;
}

export function normalizeImportedProvider(name: string, value: Record<string, unknown>, sortOrder: number): BulkImportedProvider {
  const parsed = parseStructuredProviderDefinition(value);
  return {
    name,
    mode: "structured",
    behavior: parsed.behavior,
    format: parsed.format,
    url: parsed.url,
    interval: parsed.interval,
    path: parsed.path,
    rawYaml: "",
    policy: "",
    sortOrder,
    sourceSummary: parsed.url || parsed.path || "结构化来源",
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeProviderForUi(provider: RuleProviderDraft): RuleProviderDraft {
  if (provider.mode !== "raw") {
    return {
      ...provider,
      policy: normalizeLegacyPolicyTarget(provider.policy),
      mode: "structured",
      rawYaml: "",
    };
  }

  try {
    const parsed = parseStructuredProviderDefinition(parseYaml(provider.rawYaml));
    return {
      ...provider,
      policy: normalizeLegacyPolicyTarget(provider.policy),
      mode: "structured",
      behavior: parsed.behavior,
      format: parsed.format,
      url: parsed.url,
      interval: parsed.interval,
      path: parsed.path,
      rawYaml: "",
    };
  } catch {
    return {
      ...provider,
      policy: normalizeLegacyPolicyTarget(provider.policy),
    };
  }
}

export function normalizeProviderDraftForSave(provider: RuleProviderDraft): RuleProviderDraft {
  const normalized = normalizeProviderForUi(provider);

  return {
    ...normalized,
    policy: normalizeLegacyPolicyTarget(normalized.policy),
    mode: "structured",
    rawYaml: "",
  };
}

export function normalizeLegacyPolicyTarget(value: string): string {
  return value === "GLOBAL" || value === "AUTO" ? "FINAL" : value;
}

export function parseStructuredProviderDefinition(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("规则集 YAML 需要是单个对象。");
  }

  const supportedKeys = new Set(["type", "behavior", "format", "url", "interval", "path"]);
  const unsupportedKeys = Object.keys(value).filter((key) => !supportedKeys.has(key));
  if (unsupportedKeys.length) {
    throw new Error(`存在当前结构化模式不支持的字段：${unsupportedKeys.join("、")}`);
  }

  const type = typeof value.type === "string" ? value.type : "http";
  if (type !== "http") {
    throw new Error(`当前仅支持 http 类型的 rule provider，收到的是 ${type}`);
  }

  const behavior = typeof value.behavior === "string" && ["classical", "domain", "ipcidr"].includes(value.behavior) ? value.behavior : "classical";
  const format = typeof value.format === "string" && ["yaml", "text"].includes(value.format) ? value.format : "yaml";
  const url = typeof value.url === "string" ? value.url.trim() : "";
  const path = typeof value.path === "string" ? value.path.trim() : "";
  const interval =
    typeof value.interval === "number" && Number.isFinite(value.interval) && value.interval > 0 ? value.interval : 3600;

  if (!url) {
    throw new Error("规则集缺少 url，无法转成结构化配置。");
  }

  return {
    behavior,
    format,
    url,
    interval,
    path,
  };
}
