import type { ProxyGroupDraft, ProxyGroupMember } from "@shared/types";

export type ProxyGroupFormValues = Omit<ProxyGroupDraft, "members">;

export type RegionFormValues = {
  name: string;
  keywordsText: string;
  sortOrder: number;
};

export type MemberOption = {
  key: string;
  member: ProxyGroupMember;
  label: string;
  description: string;
  category: "subscription" | "manual" | "sourceGroup" | "regionGroup" | "group" | "special";
  sourceName?: string;
};
