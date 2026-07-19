import type { ProxyGroupDraft, ProxyGroupMember } from "@shared/types";
import type { MemberOption } from "./types";

export const emptyGroup: ProxyGroupDraft = {
  name: "",
  type: "select",
  url: "http://cp.cloudflare.com/generate_204",
  interval: 300,
  timeout: 5000,
  enabled: true,
  sortOrder: 100,
  members: [],
};

export const specialOptions = ["DIRECT", "REJECT", "MANUAL", "FINAL"] as const;
export const dialerProxyBuiltinOptions = ["FINAL", "MANUAL"] as const;

export const memberCategoryLabels: Record<MemberOption["category"] | "all", string> = {
  all: "全部来源",
  subscription: "订阅节点",
  manual: "自定义节点",
  sourceGroup: "订阅分组",
  regionGroup: "地域分组",
  group: "自定义分组",
  special: "内置策略",
};

export const memberKindLabels: Record<ProxyGroupMember["kind"], string> = {
  proxy: "节点",
  sourceGroup: "订阅分组",
  regionGroup: "地域分组",
  group: "自定义分组",
  special: "内置策略",
};
