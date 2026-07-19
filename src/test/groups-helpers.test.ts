import { describe, expect, it } from "vitest";
import type { ParsedProxy, ProxyGroupDraft, ProxyGroupMember } from "@shared/types";
import { findManualProxyReferences, getManualProxyFinalName, removeProxyMember } from "../web/pages/groups/helpers";

function buildGroup(name: string, members: ProxyGroupMember[]): ProxyGroupDraft {
  return {
    id: 1,
    name,
    type: "select",
    url: "http://cp.cloudflare.com/generate_204",
    interval: 300,
    timeout: 5000,
    enabled: true,
    sortOrder: 10,
    members,
  };
}

describe("groups helpers", () => {
  const items: ParsedProxy[] = [
    { name: "HK-A", type: "trojan" },
    { plugin: "broken-without-name-or-type" },
    { name: "HK-B", type: "ss" },
  ];

  it("maps a record index to its catalog final name, skipping invalid records", () => {
    expect(getManualProxyFinalName(items, 0, ["HK-A", "HK-B"])).toBe("HK-A");
    expect(getManualProxyFinalName(items, 1, ["HK-A", "HK-B"])).toBeNull();
    expect(getManualProxyFinalName(items, 2, ["HK-A", "HK-B"])).toBe("HK-B");
  });

  it("finds proxy groups and configured FINAL members that reference a manual proxy", () => {
    const groups = [
      buildGroup("自建", [
        { kind: "proxy", value: "HK-A" },
        { kind: "special", value: "DIRECT" },
      ]),
      buildGroup("落地", [{ kind: "proxy", value: "HK-B" }]),
    ];
    const finalMembers: ProxyGroupMember[] = [{ kind: "proxy", value: "HK-A" }];

    const references = findManualProxyReferences("HK-A", groups, finalMembers);
    expect(references.groups.map((group) => group.name)).toEqual(["自建"]);
    expect(references.usedByFinal).toBe(true);

    expect(findManualProxyReferences(null, groups, finalMembers)).toEqual({ groups: [], usedByFinal: false });
  });

  it("removes only the matching proxy member and keeps groups or specials with the same value", () => {
    const members: ProxyGroupMember[] = [
      { kind: "proxy", value: "HK-A" },
      { kind: "group", value: "HK-A" },
      { kind: "special", value: "DIRECT" },
    ];

    expect(removeProxyMember(members, "HK-A")).toEqual([
      { kind: "group", value: "HK-A" },
      { kind: "special", value: "DIRECT" },
    ]);
  });
});
