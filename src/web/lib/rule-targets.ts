import type { ProxyGroupDraft, RegionRule, SubscriptionSource } from "@shared/types";

export type PolicyTargetGroup = {
  label: string;
  options: string[];
};

const builtinPolicyTargets = ["FINAL", "MANUAL", "DIRECT", "REJECT"] as const;

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

export function normalizeLegacyPolicyTarget(value: string): string {
  return value === "GLOBAL" || value === "AUTO" ? "FINAL" : value;
}
