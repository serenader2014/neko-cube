import { sortByOrder, type ConfigFragment, type ParsedProxy, type ProxyGroupDraft, type ProxyGroupMember, type RegionRule } from "@shared/types";
import type { SourceWithSnapshot } from "../../lib/proxy-catalog";
import type { MemberOption } from "./types";

export function formatSourceGroupName(value: string) {
  return `[订阅] ${value}`;
}

export function formatRegionGroupName(value: string) {
  return `[地区] ${value}`;
}

export function createEmptyManualProxyFragment(): ConfigFragment {
  return {
    key: "manual_proxies",
    yamlText: "",
    enabled: false,
  };
}

export function getMemberKey(member: ProxyGroupMember) {
  return `${member.kind}:${member.value}`;
}

export function dedupeMembers(members: ProxyGroupMember[]) {
  const seen = new Set<string>();
  const result: ProxyGroupMember[] = [];

  for (const member of members) {
    const key = getMemberKey(member);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(member);
  }

  return result;
}

export function buildDefaultFinalMembers(regionItems: RegionRule[], sources: SourceWithSnapshot[]) {
  return dedupeMembers([
    ...sortByOrder(regionItems).filter((item) => item.enabled).map((item) => ({ kind: "regionGroup" as const, value: item.name })),
    ...sortByOrder(sources).filter((item) => item.enabled).map((item) => ({ kind: "sourceGroup" as const, value: item.name })),
    { kind: "special", value: "MANUAL" },
    { kind: "special", value: "DIRECT" },
    { kind: "special", value: "REJECT" },
  ]);
}

export function filterMemberOptions(
  options: MemberOption[],
  memberCategory: MemberOption["category"] | "all",
  sourceFilter: string,
  memberSearch: string,
) {
  const keyword = memberSearch.trim().toLowerCase();

  return options.filter((option) => {
    if (memberCategory !== "all" && option.category !== memberCategory) {
      return false;
    }

    if (sourceFilter !== "all" && option.sourceName !== sourceFilter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return `${option.label} ${option.description}`.toLowerCase().includes(keyword);
  });
}

export function getMemberDirectoryEmptyState({
  memberCategory,
  memberSearch,
  sourceFilterEnabled,
  memberSourceFilter,
  reusableGroupCount,
}: {
  memberCategory: MemberOption["category"] | "all";
  memberSearch: string;
  sourceFilterEnabled: boolean;
  memberSourceFilter: string;
  reusableGroupCount: number;
}) {
  if (memberSearch.trim()) {
    return {
      eyebrow: "搜索结果",
      title: "没有匹配到成员",
      description: "换一个关键词，或者先清空搜索，再从目录里继续挑选。",
    };
  }

  if (memberCategory === "group" && reusableGroupCount === 0) {
    return {
      eyebrow: "自定义分组",
      title: "还没有可复用的分组",
      description: "先保存至少一个自定义分组，这里才会出现可再次引用的分组成员。",
    };
  }

  if (!sourceFilterEnabled && memberSourceFilter !== "all") {
    return {
      eyebrow: "筛选提醒",
      title: "当前分类不按来源过滤",
      description: "地域分组、自定义分组和内置策略不会归属某个订阅来源，切回来源过滤后会自动恢复。",
    };
  }

  if (memberSourceFilter !== "all") {
    return {
      eyebrow: "来源筛选",
      title: "这个来源下没有可选成员",
      description: "换一个来源，或者切回“全部来源”再继续浏览。",
    };
  }

  return {
    eyebrow: "节点目录",
    title: "当前筛选条件下没有可选成员",
    description: "可以切换到其它分类，或从左侧先定义分组基础信息再回来选择。",
  };
}

export function getManualProxyFinalName(items: ParsedProxy[], index: number, manualNames: string[]): string | null {
  const record = items[index];
  if (!record?.name || !record?.type) {
    return null;
  }

  const validIndex = items.slice(0, index).filter((item) => item?.name && item?.type).length;
  return manualNames[validIndex] ?? null;
}

export function findManualProxyReferences(
  finalName: string | null,
  groups: ProxyGroupDraft[],
  configuredFinalMembers: ProxyGroupMember[],
): { groups: ProxyGroupDraft[]; usedByFinal: boolean } {
  if (!finalName) {
    return { groups: [], usedByFinal: false };
  }

  const matches = (member: ProxyGroupMember) => member.kind === "proxy" && member.value === finalName;
  return {
    groups: groups.filter((group) => group.members.some(matches)),
    usedByFinal: configuredFinalMembers.some(matches),
  };
}

export function removeProxyMember(members: ProxyGroupMember[], finalName: string): ProxyGroupMember[] {
  return members.filter((member) => !(member.kind === "proxy" && member.value === finalName));
}

export function parseKeywordText(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function previewRegionProxies(
  proxies: Array<{ finalName: string; sourceName: string; type: string }>,
  keywords: string[],
) {
  if (!keywords.length) {
    return [];
  }

  const loweredKeywords = keywords.map((keyword) => keyword.toLowerCase());
  return proxies.filter((proxy) => {
    const loweredName = proxy.finalName.toLowerCase();
    return loweredKeywords.some((keyword) => loweredName.includes(keyword));
  });
}
