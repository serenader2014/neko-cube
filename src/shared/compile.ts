import yaml from "js-yaml";
import {
  compileConfigInputSchema,
  compiledConfigResultSchema,
  sortByOrder,
  type CompileConfigInput,
  type CompiledConfigResult,
  type ConfigFragment,
  type ParsedProxy,
  type ProxyGroupDraft,
  type ProxyGroupMember,
  type RuleProviderDraft,
} from "./types.js";

type AggregatedProxy = {
  fingerprint: string;
  sourceName: string;
  originalName: string;
  finalName: string;
  regionName: string;
  proxy: ParsedProxy;
  isManual: boolean;
};

type GroupMaps = {
  sourceGroups: Map<string, string[]>;
  regionGroups: Map<string, string[]>;
  manualNames: string[];
};

function getMemberKey(member: ProxyGroupMember): string {
  return `${member.kind}:${member.value}`;
}

function dedupeMembers(members: ProxyGroupMember[]): ProxyGroupMember[] {
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

function formatSourceGroupName(value: string): string {
  return `[订阅] ${value}`;
}

function formatRegionGroupName(value: string): string {
  return `[地区] ${value}`;
}

function normalizeSourceGroupName(value: string): string {
  if (value.startsWith("[订阅] ")) {
    return value;
  }

  if (value.startsWith("SOURCE/")) {
    return formatSourceGroupName(value.slice("SOURCE/".length));
  }

  return formatSourceGroupName(value);
}

function normalizeRegionGroupName(value: string): string {
  if (value.startsWith("[地区] ")) {
    return value;
  }

  if (value.startsWith("REGION/")) {
    return formatRegionGroupName(value.slice("REGION/".length));
  }

  return formatRegionGroupName(value);
}

function normalizePolicyTarget(value: string): string {
  if (value === "GLOBAL" || value === "AUTO") {
    return "FINAL";
  }

  if (value === "FINAL" || value === "MANUAL" || value === "DIRECT" || value === "REJECT") {
    return value;
  }

  if (value.startsWith("SOURCE/") || value.startsWith("[订阅] ")) {
    return normalizeSourceGroupName(value);
  }

  if (value.startsWith("REGION/") || value.startsWith("[地区] ")) {
    return normalizeRegionGroupName(value);
  }

  return value;
}

function createPolicyTargetNormalizer(input: CompileConfigInput) {
  const sourceNames = new Set(input.sources.filter((item) => item.enabled).map((item) => item.name));
  const regionNames = new Set(sortByOrder(input.regionRules).filter((item) => item.enabled).map((item) => item.name));
  const customGroupNames = new Set(sortByOrder(input.proxyGroups).filter((item) => item.enabled).map((item) => item.name));

  return (value: string): string => {
    const normalized = normalizePolicyTarget(value);
    if (normalized !== value) {
      return normalized;
    }

    if (customGroupNames.has(value)) {
      return value;
    }

    if (sourceNames.has(value)) {
      return formatSourceGroupName(value);
    }

    if (regionNames.has(value)) {
      return formatRegionGroupName(value);
    }

    return value;
  };
}

function createDefaultFinalGroupMembers(input: CompileConfigInput): ProxyGroupMember[] {
  return [
    ...sortByOrder(input.regionRules)
      .filter((item) => item.enabled)
      .map((item) => ({ kind: "regionGroup" as const, value: item.name })),
    ...sortByOrder(input.sources)
      .filter((item) => item.enabled)
      .map((item) => ({ kind: "sourceGroup" as const, value: item.name })),
    { kind: "special", value: "MANUAL" },
    { kind: "special", value: "DIRECT" },
    { kind: "special", value: "REJECT" },
  ];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseFragmentYaml(fragment: ConfigFragment): unknown {
  if (!fragment.enabled || !fragment.yamlText.trim()) {
    return null;
  }

  return yaml.load(fragment.yamlText);
}

function getFragments(fragments: ConfigFragment[]) {
  const fragmentMap = new Map<string, unknown>();

  for (const fragment of fragments) {
    fragmentMap.set(fragment.key, parseFragmentYaml(fragment));
  }

  return fragmentMap;
}

function mergeDeviceProfileConfigFragments(input: CompileConfigInput): ConfigFragment[] {
  const merged = new Map<string, ConfigFragment>(input.configFragments.map((fragment) => [fragment.key, fragment]));
  const overrides = input.deviceProfile?.fragmentOverrides ?? [];

  for (const override of overrides) {
    if (override.mode === "inherit") {
      continue;
    }

    const existing = merged.get(override.key);
    merged.set(override.key, {
      id: existing?.id,
      key: override.key,
      enabled: override.mode === "custom",
      yamlText: override.mode === "custom" ? override.yamlText : "",
    });
  }

  return Array.from(merged.values());
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

function uniqueName(name: string, seen: Map<string, number>): string {
  const current = seen.get(name) ?? 0;

  if (current === 0) {
    seen.set(name, 1);
    return name;
  }

  const next = current + 1;
  seen.set(name, next);
  return `${name} #${next}`;
}

function matchRegion(proxyName: string, rules: CompileConfigInput["regionRules"]): string {
  const lowered = proxyName.toLowerCase();

  for (const rule of sortByOrder(rules).filter((item) => item.enabled)) {
    if (rule.keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))) {
      return rule.name;
    }
  }

  return "Other";
}

function aggregateProxies(input: CompileConfigInput, fragments: Map<string, unknown>) {
  const seenFingerprints = new Set<string>();
  const seenNames = new Map<string, number>();
  const warnings: string[] = [];
  const proxies: AggregatedProxy[] = [];
  const manualFragment = fragments.get("manual_proxies");
  const manualProxies = Array.isArray(manualFragment) ? manualFragment : [];

  for (const source of input.sources.filter((item) => item.enabled)) {
    const snapshot = input.snapshots
      .filter((item) => item.sourceId === source.id && item.status === "success")
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))[0];

    if (!snapshot) {
      warnings.push(`Source "${source.name}" has no successful snapshot`);
      continue;
    }

    for (const proxy of snapshot.proxies) {
      const clonedProxy = deepClone(proxy);
      const fingerprint = fingerprintProxy(clonedProxy);

      if (seenFingerprints.has(fingerprint)) {
        continue;
      }

      seenFingerprints.add(fingerprint);

      const sourcePrefix = source.prefixStrategy === "source-name" ? `[${source.name}] ` : "";
      const namedProxy = {
        ...clonedProxy,
        name: `${sourcePrefix}${String(clonedProxy.name)}`,
      };
      const finalName = uniqueName(String(namedProxy.name), seenNames);

      proxies.push({
        fingerprint,
        sourceName: source.name,
        originalName: String(clonedProxy.name),
        finalName,
        regionName: matchRegion(finalName, input.regionRules),
        proxy: {
          ...namedProxy,
          name: finalName,
        },
        isManual: false,
      });
    }
  }

  for (const manualProxy of manualProxies) {
    if (!manualProxy || typeof manualProxy !== "object" || Array.isArray(manualProxy)) {
      warnings.push("Skipped invalid manual proxy entry");
      continue;
    }

    const candidate = manualProxy as ParsedProxy;

    if (!candidate.name || !candidate.type) {
      warnings.push("Skipped manual proxy without name or type");
      continue;
    }

    // Manual proxies skip fingerprint dedupe: relay/landing chains legitimately
    // share type/server/port and differ only by name and dialer-proxy.
    const finalName = uniqueName(String(candidate.name), seenNames);
    if (finalName !== String(candidate.name)) {
      warnings.push(`Manual proxy "${String(candidate.name)}" renamed to "${finalName}" due to duplicate name`);
    }

    proxies.push({
      fingerprint: fingerprintProxy(candidate),
      sourceName: "manual",
      originalName: String(candidate.name),
      finalName,
      regionName: matchRegion(finalName, input.regionRules),
      proxy: {
        ...deepClone(candidate),
        name: finalName,
      },
      isManual: true,
    });
  }

  return { proxies, warnings };
}

function buildAutomaticGroups(
  input: CompileConfigInput,
  aggregated: AggregatedProxy[],
  healthcheckUrl: string,
  normalizeTarget: (value: string) => string,
): { groups: Record<string, unknown>[]; maps: GroupMaps; warnings: string[] } {
  const sourceGroups = new Map<string, string[]>();
  const regionGroups = new Map<string, string[]>();
  const manualNames = aggregated.filter((proxy) => proxy.isManual).map((proxy) => proxy.finalName);
  const warnings: string[] = [];

  for (const source of input.sources.filter((item) => item.enabled)) {
    sourceGroups.set(
      source.name,
      aggregated.filter((proxy) => proxy.sourceName === source.name).map((proxy) => proxy.finalName),
    );
  }

  for (const regionRule of sortByOrder(input.regionRules).filter((item) => item.enabled)) {
    regionGroups.set(
      regionRule.name,
      aggregated.filter((proxy) => proxy.regionName === regionRule.name).map((proxy) => proxy.finalName),
    );
  }

  const defaultFinalGroupMembers = createDefaultFinalGroupMembers(input);
  const configuredFinalGroupMembers = dedupeMembers(input.appSettings.finalGroupMembers ?? defaultFinalGroupMembers).filter(
    (member) => !(member.kind === "special" && (member.value === "FINAL" || member.value === "GLOBAL" || member.value === "AUTO")),
  );
  const knownProxyNames = new Set(aggregated.map((proxy) => proxy.finalName));
  const knownGroupNames = new Set<string>([
    "FINAL",
    "MANUAL",
    ...sortByOrder(input.sources)
      .filter((item) => item.enabled)
      .map((item) => formatSourceGroupName(item.name)),
    ...sortByOrder(input.regionRules)
      .filter((item) => item.enabled)
      .map((item) => formatRegionGroupName(item.name)),
    ...sortByOrder(input.proxyGroups)
      .filter((item) => item.enabled)
      .map((item) => item.name),
  ]);
  const validFinalTargets = configuredFinalGroupMembers
    .map((member) => resolveMember(member, normalizeTarget))
    .filter((target) => {
      const valid = target === "DIRECT" || target === "REJECT" || knownGroupNames.has(target) || knownProxyNames.has(target);
      if (!valid) {
        warnings.push(`FINAL skipped unknown member "${target}"`);
      }
      return valid;
    });
  const automaticGroups: Record<string, unknown>[] = [];

  automaticGroups.push({
    name: "MANUAL",
    type: "select",
    proxies: manualNames.length > 0 ? manualNames : ["DIRECT"],
  });

  for (const [sourceName, proxies] of sourceGroups.entries()) {
    automaticGroups.push({
      name: formatSourceGroupName(sourceName),
      type: "select",
      proxies: proxies.length > 0 ? proxies : ["DIRECT"],
    });
  }

  for (const [regionName, proxies] of regionGroups.entries()) {
    automaticGroups.push({
      name: formatRegionGroupName(regionName),
      type: "select",
      proxies: proxies.length > 0 ? proxies : ["DIRECT"],
    });
  }

  automaticGroups.unshift({
    name: "FINAL",
    type: "select",
    proxies: validFinalTargets.length > 0 ? validFinalTargets : ["DIRECT"],
  });

  return {
    groups: automaticGroups,
    maps: {
      sourceGroups,
      regionGroups,
      manualNames,
    },
    warnings,
  };
}

function resolveMember(member: ProxyGroupMember, normalizeTarget: (value: string) => string): string {
  switch (member.kind) {
    case "proxy":
      return member.value;
    case "sourceGroup":
      return normalizeSourceGroupName(member.value);
    case "regionGroup":
      return normalizeRegionGroupName(member.value);
    case "group":
      return member.value;
    case "special":
      if (member.value === "GLOBAL" || member.value === "AUTO") {
        return "FINAL";
      }
      return normalizeTarget(member.value);
    default:
      return normalizeTarget(member.value);
  }
}

function buildCustomGroups(
  proxyGroups: ProxyGroupDraft[],
  allProxies: string[],
  autoGroups: Record<string, unknown>[],
  normalizeTarget: (value: string) => string,
): { groups: Record<string, unknown>[]; warnings: string[] } {
  const sortedGroups = sortByOrder(proxyGroups).filter((group) => group.enabled);
  const knownGroups = new Set<string>(autoGroups.map((group) => String(group.name)));
  const groupMap = new Map(sortedGroups.map((group) => [group.name, group]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const warnings: string[] = [];

  function visit(group: ProxyGroupDraft) {
    if (visited.has(group.name)) {
      return;
    }

    if (visiting.has(group.name)) {
      throw new Error(`Custom proxy group cycle detected at "${group.name}"`);
    }

    visiting.add(group.name);

    for (const member of group.members) {
      if (member.kind === "group") {
        const child = groupMap.get(member.value);
        if (!child) {
          warnings.push(`Proxy group "${group.name}" skipped missing group "${member.value}"`);
          continue;
        }

        visit(child);
      }
    }

    visiting.delete(group.name);
    visited.add(group.name);
  }

  for (const group of sortedGroups) {
    visit(group);
  }

  const groups = sortedGroups.map((group) => {
    const proxies = group.members.map((member) => resolveMember(member, normalizeTarget));
    const validProxies: string[] = [];

    for (const proxyName of proxies) {
      if (proxyName === "DIRECT" || proxyName === "REJECT" || proxyName === "FINAL" || proxyName === "MANUAL") {
        validProxies.push(proxyName);
        continue;
      }

      if (knownGroups.has(proxyName)) {
        validProxies.push(proxyName);
        continue;
      }

      if (!allProxies.includes(proxyName)) {
        warnings.push(`Proxy group "${group.name}" skipped unknown member "${proxyName}"`);
        continue;
      }

      validProxies.push(proxyName);
    }

    knownGroups.add(group.name);

    return {
      name: group.name,
      type: group.type,
      proxies: validProxies.length > 0 ? validProxies : ["DIRECT"],
      ...(group.type === "select"
        ? {}
        : {
            url: group.url,
            interval: group.interval,
            timeout: group.timeout,
          }),
    };
  });

  return { groups, warnings };
}

function validateResolvedTarget(
  target: string,
  knownProxyNames: Set<string>,
  knownGroupNames: Set<string>,
): boolean {
  return target === "DIRECT" || target === "REJECT" || knownProxyNames.has(target) || knownGroupNames.has(target);
}

function sanitizeDialerProxyTargets(
  aggregated: AggregatedProxy[],
  normalizeTarget: (value: string) => string,
  knownProxyNames: Set<string>,
  knownGroupNames: Set<string>,
): string[] {
  const warnings: string[] = [];

  for (const item of aggregated) {
    const dialerProxy = typeof item.proxy["dialer-proxy"] === "string" ? item.proxy["dialer-proxy"].trim() : "";
    if (!dialerProxy) {
      continue;
    }

    const normalizedDialerProxy = normalizeTarget(dialerProxy);
    if (!validateResolvedTarget(normalizedDialerProxy, knownProxyNames, knownGroupNames)) {
      delete item.proxy["dialer-proxy"];
      warnings.push(`Proxy "${item.finalName}" skipped unknown dialer-proxy "${normalizedDialerProxy}"`);
      continue;
    }

    item.proxy["dialer-proxy"] = normalizedDialerProxy;
  }

  return warnings;
}

function normalizeValidatedPolicyTarget(
  rawValue: string,
  ownerLabel: string,
  normalizeTarget: (value: string) => string,
  knownProxyNames: Set<string>,
  knownGroupNames: Set<string>,
  warnings: string[],
): string {
  const normalized = normalizeTarget(rawValue);
  if (validateResolvedTarget(normalized, knownProxyNames, knownGroupNames)) {
    return normalized;
  }

  warnings.push(`${ownerLabel} referenced unknown target "${normalized}", fallback to FINAL`);
  return "FINAL";
}

function buildRuleProviders(
  providers: RuleProviderDraft[],
  normalizeTarget: (value: string) => string,
  knownProxyNames: Set<string>,
  knownGroupNames: Set<string>,
) {
  const enabledProviders = sortByOrder(providers).filter((provider) => provider.enabled);
  const result: Record<string, unknown> = {};
  const ruleLines: string[] = [];
  const warnings: string[] = [];

  for (const provider of enabledProviders) {
    const normalizedProvider = normalizeRuleProvider(provider);
    const providerConfig: unknown =
      normalizedProvider.mode === "raw" && normalizedProvider.rawYaml.trim()
        ? yaml.load(normalizedProvider.rawYaml)
        : {
            type: "http",
            behavior: normalizedProvider.behavior,
            format: normalizedProvider.format,
            url: normalizedProvider.url,
            path: normalizedProvider.path || `./providers/${normalizedProvider.name}.yaml`,
            interval: normalizedProvider.interval,
          };

    result[normalizedProvider.name] = providerConfig ?? {};
    const policyTarget = normalizeValidatedPolicyTarget(
      normalizedProvider.policy,
      `Rule provider "${normalizedProvider.name}"`,
      normalizeTarget,
      knownProxyNames,
      knownGroupNames,
      warnings,
    );
    ruleLines.push(`RULE-SET,${normalizedProvider.name},${policyTarget}`);
  }

  return { providerConfig: result, ruleLines, warnings };
}

function normalizeRuleProvider(provider: RuleProviderDraft): RuleProviderDraft {
  if (provider.mode === "raw" && provider.rawYaml.trim()) {
    try {
      const parsed = parseStructuredRuleProviderDefinition(yaml.load(provider.rawYaml));
      if (parsed) {
        return {
          ...provider,
          mode: "structured",
          behavior: parsed.behavior,
          format: parsed.format,
          url: parsed.url,
          interval: parsed.interval,
          path: parsed.path,
          rawYaml: "",
        };
      }
    } catch {
      return provider;
    }
  }

  if (provider.mode === "raw" && !provider.rawYaml.trim() && (provider.url.trim() || provider.path.trim())) {
    return {
      ...provider,
      mode: "structured",
      rawYaml: "",
    };
  }

  return {
    ...provider,
    rawYaml: provider.mode === "structured" ? "" : provider.rawYaml,
  };
}

function parseStructuredRuleProviderDefinition(
  value: unknown,
): Pick<RuleProviderDraft, "behavior" | "format" | "url" | "interval" | "path"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : "http";
  if (type !== "http") {
    return null;
  }

  const behavior: RuleProviderDraft["behavior"] =
    typeof record.behavior === "string" && ["classical", "domain", "ipcidr"].includes(record.behavior)
      ? (record.behavior as RuleProviderDraft["behavior"])
      : "classical";
  const format: RuleProviderDraft["format"] =
    typeof record.format === "string" && ["yaml", "text"].includes(record.format)
      ? (record.format as RuleProviderDraft["format"])
      : "yaml";

  return {
    behavior,
    format,
    url: typeof record.url === "string" ? record.url : "",
    interval:
      typeof record.interval === "number" && Number.isFinite(record.interval) && record.interval > 0 ? record.interval : 3600,
    path: typeof record.path === "string" ? record.path : "",
  };
}

function buildRuleLines(
  input: CompileConfigInput,
  normalizeTarget: (value: string) => string,
  knownProxyNames: Set<string>,
  knownGroupNames: Set<string>,
): { rules: string[]; warnings: string[] } {
  const ruleProviders = buildRuleProviders(input.ruleProviders, normalizeTarget, knownProxyNames, knownGroupNames);
  const warnings = [...ruleProviders.warnings];
  const customRules = sortByOrder(input.customRules)
    .filter((rule) => rule.enabled)
    .map((rule) => {
      if (rule.type === "RAW") {
        return rule.target;
      }

      const pieces: string[] = [rule.type];
      if (rule.type !== "MATCH") {
        pieces.push(rule.target);
      }
      pieces.push(
        normalizeValidatedPolicyTarget(
          rule.policy,
          `Rule "${rule.type}${rule.target ? ` ${rule.target}` : ""}"`,
          normalizeTarget,
          knownProxyNames,
          knownGroupNames,
          warnings,
        ),
      );
      if (rule.noResolve) {
        pieces.push("no-resolve");
      }

      return pieces.join(",");
    });

  return {
    rules: [...customRules, ...ruleProviders.ruleLines, "MATCH,FINAL"],
    warnings,
  };
}

function validateCompiledConfig(config: Record<string, unknown>) {
  const schema = compileConfigInputSchema.shape;
  const proxyGroupSchema = {
    name: "proxy-groups",
  };
  void schema;
  void proxyGroupSchema;

  if (!Array.isArray(config.proxies)) {
    throw new Error("Compiled config is missing proxies");
  }

  if (!Array.isArray(config["proxy-groups"])) {
    throw new Error("Compiled config is missing proxy-groups");
  }

  if (!Array.isArray(config.rules)) {
    throw new Error("Compiled config is missing rules");
  }

  const proxyNames = new Set<string>();
  for (const proxy of config.proxies as ParsedProxy[]) {
    if (!proxy?.name) {
      throw new Error("Compiled config contains unnamed proxy");
    }

    if (proxyNames.has(String(proxy.name))) {
      throw new Error(`Compiled config contains duplicate proxy name "${String(proxy.name)}"`);
    }

    proxyNames.add(String(proxy.name));
  }
}

export function compileClashConfig(rawInput: CompileConfigInput): CompiledConfigResult {
  const input = compileConfigInputSchema.parse(rawInput);
  const normalizeTarget = createPolicyTargetNormalizer(input);
  const fragments = getFragments(mergeDeviceProfileConfigFragments(input));
  const { proxies: aggregated, warnings } = aggregateProxies(input, fragments);
  const healthcheckUrl = input.appSettings.defaultHealthcheckUrl;
  const { groups: automaticGroups, maps, warnings: automaticGroupWarnings } = buildAutomaticGroups(input, aggregated, healthcheckUrl, normalizeTarget);
  const { groups: customGroups, warnings: customGroupWarnings } = buildCustomGroups(
    input.proxyGroups,
    aggregated.map((proxy) => proxy.finalName),
    automaticGroups,
    normalizeTarget,
  );
  const knownProxyNames = new Set(aggregated.map((proxy) => proxy.finalName));
  const knownGroupNames = new Set<string>([...automaticGroups, ...customGroups].map((group) => String(group.name)));
  const dialerProxyWarnings = sanitizeDialerProxyTargets(aggregated, normalizeTarget, knownProxyNames, knownGroupNames);
  const { providerConfig } = buildRuleProviders(input.ruleProviders, normalizeTarget, knownProxyNames, knownGroupNames);
  const { rules, warnings: ruleWarnings } = buildRuleLines(input, normalizeTarget, knownProxyNames, knownGroupNames);
  const rootFragment = (fragments.get("root") as Record<string, unknown> | null) ?? {};
  const profileFragment = (fragments.get("profile") as Record<string, unknown> | null) ?? undefined;
  const dnsFragment = (fragments.get("dns") as Record<string, unknown> | null) ?? undefined;
  const hostsFragment = (fragments.get("hosts") as Record<string, unknown> | null) ?? undefined;
  const extraFragment = (fragments.get("extra") as Record<string, unknown> | null) ?? {};
  const deviceProfile = input.deviceProfile;

  const config: Record<string, unknown> = {
    ...rootFragment,
    ...extraFragment,
    mode: deviceProfile?.mode ?? input.clashTarget.mode,
    "mixed-port": deviceProfile?.mixedPort ?? input.clashTarget.mixedPort,
    "allow-lan": deviceProfile?.allowLan ?? input.clashTarget.allowLan,
    "external-controller": deviceProfile?.externalController ?? input.clashTarget.externalController,
    secret: deviceProfile?.secret ?? input.clashTarget.secret,
    profile: profileFragment,
    dns: dnsFragment,
    hosts: hostsFragment,
    proxies: aggregated.map((proxy) => proxy.proxy),
    "proxy-groups": [...automaticGroups, ...customGroups],
    ...(Object.keys(providerConfig).length > 0 ? { "rule-providers": providerConfig } : {}),
    rules,
  };

  validateCompiledConfig(config);

  const result: CompiledConfigResult = {
    yaml: yaml.dump(config, { noRefs: true, lineWidth: 120 }),
    config,
    stats: {
      sourceCount: input.sources.filter((item) => item.enabled).length,
      proxyCount: aggregated.length,
      regionCounts: Object.fromEntries(
        Array.from(maps.regionGroups.entries()).map(([name, values]) => [name, values.length]),
      ),
      groupCount: (config["proxy-groups"] as unknown[]).length,
      ruleCount: rules.length,
    },
    warnings: [...warnings, ...automaticGroupWarnings, ...customGroupWarnings, ...dialerProxyWarnings, ...ruleWarnings],
  };

  return compiledConfigResultSchema.parse(result);
}
