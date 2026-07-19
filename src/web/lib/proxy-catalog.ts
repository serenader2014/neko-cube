import { sortByOrder, type ParsedProxy, type ProxyGroupDraft, type ProxyGroupMember, type RegionRule, type SubscriptionSource } from "@shared/types";
import { parseManualProxyRecords } from "./config-fragments";

export type SourceWithSnapshot = SubscriptionSource & {
  latestSnapshot: null | {
    status: "success" | "error";
    fetchedAt: string;
    proxies: ParsedProxy[];
    error: string | null;
  };
};

export type CatalogProxy = {
  key: string;
  finalName: string;
  originalName: string;
  sourceType: "subscription" | "manual";
  sourceName: string;
  regionName: string;
  type: string;
};

export type ProxyCatalog = {
  proxies: CatalogProxy[];
  bySource: Map<string, CatalogProxy[]>;
  byRegion: Map<string, CatalogProxy[]>;
  byName: Map<string, CatalogProxy>;
  manualNames: string[];
};

export type GroupPreview = {
  proxies: CatalogProxy[];
  extras: string[];
  missing: ProxyGroupMember[];
};

function stripSourceGroupPrefix(value: string): string {
  if (value.startsWith("[订阅] ")) {
    return value.slice("[订阅] ".length);
  }

  if (value.startsWith("SOURCE/")) {
    return value.slice("SOURCE/".length);
  }

  return value;
}

function stripRegionGroupPrefix(value: string): string {
  if (value.startsWith("[地区] ")) {
    return value.slice("[地区] ".length);
  }

  if (value.startsWith("REGION/")) {
    return value.slice("REGION/".length);
  }

  return value;
}

function fingerprintProxy(proxy: ParsedProxy): string {
  const pick = [
    proxy.type,
    proxy.server,
    proxy.port,
    proxy.uuid,
    proxy.password,
    proxy.network,
    proxy.tls,
    proxy.sni,
    proxy["grpc-service-name"],
    proxy["ws-opts"] ? JSON.stringify(proxy["ws-opts"]) : "",
    proxy["plugin-opts"] ? JSON.stringify(proxy["plugin-opts"]) : "",
  ];

  return pick.map((part) => String(part ?? "")).join("|");
}

function uniqueName(name: string, seen: Map<string, number>) {
  const current = seen.get(name) ?? 0;

  if (current === 0) {
    seen.set(name, 1);
    return name;
  }

  const next = current + 1;
  seen.set(name, next);
  return `${name} #${next}`;
}

function matchRegion(proxyName: string, rules: RegionRule[]) {
  const lowered = proxyName.toLowerCase();

  for (const rule of sortByOrder(rules).filter((item) => item.enabled)) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))) {
      return rule.name;
    }
  }

  return "Other";
}

export function buildProxyCatalog(sources: SourceWithSnapshot[], manualProxyYaml: string, regionRules: RegionRule[]): ProxyCatalog {
  const seenFingerprints = new Set<string>();
  const seenNames = new Map<string, number>();
  const proxies: CatalogProxy[] = [];
  const bySource = new Map<string, CatalogProxy[]>();
  const byRegion = new Map<string, CatalogProxy[]>();
  const byName = new Map<string, CatalogProxy>();
  const manualNames: string[] = [];

  for (const source of sources.filter((item) => item.enabled)) {
    const snapshot = source.latestSnapshot?.status === "success" ? source.latestSnapshot : null;
    if (!snapshot) {
      continue;
    }

    for (const proxy of snapshot.proxies) {
      const fingerprint = fingerprintProxy(proxy);
      if (seenFingerprints.has(fingerprint)) {
        continue;
      }

      seenFingerprints.add(fingerprint);
      const sourcePrefix = source.prefixStrategy === "source-name" ? `[${source.name}] ` : "";
      const finalName = uniqueName(`${sourcePrefix}${String(proxy.name)}`, seenNames);
      const entry: CatalogProxy = {
        key: `proxy:${finalName}`,
        finalName,
        originalName: String(proxy.name),
        sourceType: "subscription",
        sourceName: source.name,
        regionName: matchRegion(finalName, regionRules),
        type: String(proxy.type),
      };

      proxies.push(entry);
      byName.set(entry.finalName, entry);
    }
  }

  const manualRecords = parseManualProxyRecords(manualProxyYaml);
  if (!manualRecords.error) {
    for (const record of manualRecords.items) {
      if (!record?.name || !record?.type) {
        continue;
      }
      const finalName = uniqueName(String(record.name), seenNames);
      const entry: CatalogProxy = {
        key: `proxy:${finalName}`,
        finalName,
        originalName: String(record.name),
        sourceType: "manual",
        sourceName: "自定义节点",
        regionName: matchRegion(finalName, regionRules),
        type: String(record.type),
      };

      proxies.push(entry);
      byName.set(entry.finalName, entry);
      manualNames.push(entry.finalName);
    }
  }

  for (const proxy of proxies) {
    const sourceList = bySource.get(proxy.sourceName) ?? [];
    sourceList.push(proxy);
    bySource.set(proxy.sourceName, sourceList);

    const regionList = byRegion.get(proxy.regionName) ?? [];
    regionList.push(proxy);
    byRegion.set(proxy.regionName, regionList);
  }

  return {
    proxies,
    bySource,
    byRegion,
    byName,
    manualNames,
  };
}

function addUniqueProxy(target: CatalogProxy[], seen: Set<string>, proxy: CatalogProxy) {
  if (seen.has(proxy.finalName)) {
    return;
  }

  seen.add(proxy.finalName);
  target.push(proxy);
}

function addUniqueText(target: string[], seen: Set<string>, value: string) {
  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  target.push(value);
}

export function buildGroupPreview(
  members: ProxyGroupMember[],
  catalog: ProxyCatalog,
  customGroups: ProxyGroupDraft[],
  currentGroupName?: string,
  finalGroupMembers: ProxyGroupMember[] = [],
): GroupPreview {
  const proxies: CatalogProxy[] = [];
  const extras: string[] = [];
  const missing: ProxyGroupMember[] = [];
  const seenProxies = new Set<string>();
  const seenExtras = new Set<string>();
  const seenGroups = new Set<string>();
  const groupMap = new Map(customGroups.map((group) => [group.name, group]));
  let resolvingFinal = false;

  function visit(member: ProxyGroupMember) {
    switch (member.kind) {
      case "proxy": {
        const proxy = catalog.byName.get(member.value);
        if (proxy) {
          addUniqueProxy(proxies, seenProxies, proxy);
        } else {
          missing.push(member);
        }
        return;
      }
      case "sourceGroup": {
        for (const proxy of catalog.bySource.get(member.value) ?? []) {
          addUniqueProxy(proxies, seenProxies, proxy);
        }
        return;
      }
      case "regionGroup": {
        for (const proxy of catalog.byRegion.get(member.value) ?? []) {
          addUniqueProxy(proxies, seenProxies, proxy);
        }
        return;
      }
      case "group": {
        if (member.value === currentGroupName || seenGroups.has(member.value)) {
          return;
        }

        const group = groupMap.get(member.value);
        if (!group) {
          missing.push(member);
          return;
        }

        seenGroups.add(member.value);
        for (const child of group.members) {
          visit(child);
        }
        return;
      }
      case "special": {
        if (member.value === "MANUAL") {
          for (const proxyName of catalog.manualNames) {
            const proxy = catalog.byName.get(proxyName);
            if (proxy) {
              addUniqueProxy(proxies, seenProxies, proxy);
            }
          }
          addUniqueText(extras, seenExtras, member.value);
          return;
        }

        if (member.value === "AUTO" || member.value === "GLOBAL" || member.value === "FINAL") {
          addUniqueText(extras, seenExtras, "FINAL");

          if (!finalGroupMembers.length || resolvingFinal) {
            for (const proxy of catalog.proxies) {
              addUniqueProxy(proxies, seenProxies, proxy);
            }
            return;
          }

          resolvingFinal = true;
          for (const finalMember of finalGroupMembers) {
            visit(finalMember);
          }
          resolvingFinal = false;
          return;
        }

        const sourceGroupName = stripSourceGroupPrefix(member.value);
        if (catalog.bySource.has(sourceGroupName)) {
          for (const proxy of catalog.bySource.get(sourceGroupName) ?? []) {
            addUniqueProxy(proxies, seenProxies, proxy);
          }
          addUniqueText(extras, seenExtras, member.value);
          return;
        }

        const regionGroupName = stripRegionGroupPrefix(member.value);
        if (catalog.byRegion.has(regionGroupName)) {
          for (const proxy of catalog.byRegion.get(regionGroupName) ?? []) {
            addUniqueProxy(proxies, seenProxies, proxy);
          }
          addUniqueText(extras, seenExtras, member.value);
          return;
        }

        addUniqueText(extras, seenExtras, member.value);
        return;
      }
      default:
        return;
    }
  }

  for (const member of members) {
    visit(member);
  }

  return { proxies, extras, missing };
}
