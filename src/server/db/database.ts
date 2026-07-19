import fs from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, desc, asc } from "drizzle-orm";
import {
  appSettingsSchema,
  clashTargetSchema,
  configBundleSchema,
  configFragmentSchema,
  customRuleSchema,
  deviceProfileSchema,
  regionRuleSchema,
  ruleProviderDraftSchema,
  sourceSnapshotSchema,
  subscriptionSourceSchema,
  proxyGroupDraftSchema,
  type AppSettings,
  type ClashTarget,
  type ConfigBundle,
  type ConfigFragment,
  type CustomRule,
  type DeviceProfile,
  type JobRun,
  type ParsedProxy,
  type ProxyGroupDraft,
  type ProxyGroupMember,
  type RegionRule,
  type RuleProviderDraft,
  type SourceSnapshot,
  type SubscriptionSource,
} from "../../shared/types.js";
import { getAppPaths } from "../lib/paths.js";
import { type RuntimeConfig } from "../lib/runtime.js";
import {
  DEFAULT_LOCAL_DEV_SERVER_PORT,
  DEFAULT_SERVER_PORT,
  LEGACY_SERVER_PORTS,
  createBuiltinRuleFingerprint,
  ensureTables,
  getSeedDefaults,
  inferManualProxyRenames,
  mapJobRun,
  nowIso,
  normalizeRuleProvider,
  parseBuiltinRuleLine,
  parseBuiltinRuleLines,
  parseDeviceProfileRow,
  parseJson,
  parseManualProxyYamlText,
  renameExactReference,
  renameGroupMemberReference,
  renameMembers,
  renameProxyMemberPrefix,
  renameProxyMemberReference,
  renameRegionMemberReference,
  renameRegionPolicyReference,
  renameSourceMemberReference,
  renameSourcePolicyReference,
  rowNullableString,
  rowNumber,
  rowString,
  serializeJson,
  stringifyManualProxyYamlText,
} from "./database-helpers.js";
import {
  appSettingsTable,
  clashTargetTable,
  configFragmentTable,
  customRuleTable,
  deviceProfileTable,
  jobRunTable,
  proxyGroupTable,
  regionRuleTable,
  ruleProviderTable,
  sourceSnapshotTable,
  sourceSubscriptionTable,
} from "./schema.js";
import { seedTelemetrySettings } from "./telemetry-db.js";
import { seedProxyProbeSettings } from "./probe-db.js";
export type { DatabaseContext, SourceSnapshotSummary } from "./database-types.js";
import { type DatabaseContext, type SourceSnapshotSummary } from "./database-types.js";

async function rewriteProxyGroups(
  context: DatabaseContext,
  renamer: (member: ProxyGroupMember) => ProxyGroupMember,
): Promise<void> {
  const proxyGroups = await listProxyGroups(context);

  for (const group of proxyGroups) {
    const { changed, members } = renameMembers(group.members, renamer);
    if (!changed) {
      continue;
    }

    await context.db
      .update(proxyGroupTable)
      .set({
        membersJson: serializeJson(members),
      })
      .where(eq(proxyGroupTable.id, group.id!));
  }
}

async function rewriteFinalGroupMembers(
  context: DatabaseContext,
  renamer: (member: ProxyGroupMember) => ProxyGroupMember,
): Promise<void> {
  const settings = await getAppSettings(context);
  const currentMembers = settings.finalGroupMembers ?? [];
  const { changed, members } = renameMembers(currentMembers, renamer);

  if (!changed) {
    return;
  }

  await context.db
    .update(appSettingsTable)
    .set({
      finalGroupMembersJson: serializeJson(members),
      updatedAt: nowIso(),
    })
    .where(eq(appSettingsTable.id, 1));
}

async function rewriteCustomRulesPolicies(
  context: DatabaseContext,
  renamer: (value: string) => string,
): Promise<void> {
  const rules = await listCustomRules(context);

  for (const rule of rules) {
    const nextPolicy = renamer(rule.policy);
    if (nextPolicy === rule.policy) {
      continue;
    }

    await context.db
      .update(customRuleTable)
      .set({
        policy: nextPolicy,
      })
      .where(eq(customRuleTable.id, rule.id!));
  }
}

async function rewriteRuleProviderPolicies(
  context: DatabaseContext,
  renamer: (value: string) => string,
): Promise<void> {
  const providers = await listRuleProviders(context);

  for (const provider of providers) {
    const nextPolicy = renamer(provider.policy);
    if (nextPolicy === provider.policy) {
      continue;
    }

    await context.db
      .update(ruleProviderTable)
      .set({
        policy: nextPolicy,
      })
      .where(eq(ruleProviderTable.id, provider.id!));
  }
}

async function rewriteManualProxyFragment(
  context: DatabaseContext,
  rewriter: (records: ParsedProxy[]) => { changed: boolean; records: ParsedProxy[] },
): Promise<void> {
  const fragments = await listConfigFragments(context);
  const fragment = fragments.find((item) => item.key === "manual_proxies");
  if (!fragment) {
    return;
  }

  const records = parseManualProxyYamlText(fragment.yamlText);
  const { changed, records: nextRecords } = rewriter(records);
  if (!changed) {
    return;
  }

  await context.db
    .update(configFragmentTable)
    .set({
      yamlText: stringifyManualProxyYamlText(nextRecords),
      enabled: fragment.enabled || nextRecords.length > 0,
    })
    .where(eq(configFragmentTable.key, fragment.key));
}
export function createDatabase(runtime: RuntimeConfig, cwd = process.cwd()): DatabaseContext {
  const paths = getAppPaths(cwd, runtime.dataNamespace);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  const sqlite = createClient({
    url: `file:${paths.databaseFile}`,
  });
  const db = drizzle(sqlite);

  return { sqlite, db, paths, runtime };
}

export async function seedDatabase(context: DatabaseContext): Promise<void> {
  const { db } = context;
  await ensureTables(context.sqlite);
  await seedTelemetrySettings(context);
  await seedProxyProbeSettings(context);
  const timestamp = nowIso();
  const defaults = getSeedDefaults(context);

  const appSettings = await db.select().from(appSettingsTable).limit(1);
  if (appSettings.length === 0) {
    await db.insert(appSettingsTable).values({
      id: 1,
      refreshIntervalMinutes: defaults.appSettings.refreshIntervalMinutes,
      defaultHealthcheckUrl: defaults.appSettings.defaultHealthcheckUrl,
      fetchProxyUrl: defaults.appSettings.fetchProxyUrl,
      finalGroupMembersJson: serializeJson(defaults.appSettings.finalGroupMembers),
      logLevel: defaults.appSettings.logLevel,
      bindHost: defaults.appSettings.bindHost,
      bindPort: defaults.appSettings.bindPort,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } else {
    const currentBindPort = Number(appSettings[0].bindPort ?? 0);
    const recommendedPort = context.runtime.localDevMode ? DEFAULT_LOCAL_DEV_SERVER_PORT : DEFAULT_SERVER_PORT;
    if (LEGACY_SERVER_PORTS.has(currentBindPort)) {
      await db
        .update(appSettingsTable)
        .set({
          bindPort: recommendedPort,
          updatedAt: timestamp,
        })
        .where(eq(appSettingsTable.id, 1));
    }
  }

  const clashTarget = await db.select().from(clashTargetTable).limit(1);
  if (clashTarget.length === 0) {
    await db.insert(clashTargetTable).values({
      id: 1,
      configPath: defaults.clashTarget.configPath,
      controllerUrl: defaults.clashTarget.controllerUrl,
      secret: defaults.clashTarget.secret,
      autoReload: defaults.clashTarget.autoReload,
      restoreSelectors: defaults.clashTarget.restoreSelectors,
      mixedPort: defaults.clashTarget.mixedPort,
      allowLan: defaults.clashTarget.allowLan,
      externalController: defaults.clashTarget.externalController,
      mode: defaults.clashTarget.mode,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const existingSources = await db.select().from(sourceSubscriptionTable).limit(1);
  if (existingSources.length === 0 && defaults.sources.length > 0) {
    await db.insert(sourceSubscriptionTable).values(
      defaults.sources.map((source) => ({
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        refreshIntervalMinutes: source.refreshIntervalMinutes,
        prefixStrategy: source.prefixStrategy,
        sortOrder: source.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
  }

  const existingRegions = await db.select().from(regionRuleTable).limit(1);
  if (existingRegions.length === 0) {
    await db.insert(regionRuleTable).values(
      defaults.regions.map((region) => ({
        name: region.name,
        keywordsJson: serializeJson(region.keywords),
        enabled: region.enabled,
        sortOrder: region.sortOrder,
      })),
    );
  }

  const existingProviders = await db.select().from(ruleProviderTable).limit(1);
  if (existingProviders.length === 0 && defaults.providers.length > 0) {
    await db.insert(ruleProviderTable).values(
      defaults.providers.map((provider) => ({
        name: provider.name,
        mode: provider.mode,
        behavior: provider.behavior,
        format: provider.format,
        url: provider.url,
        interval: provider.interval,
        path: provider.path,
        rawYaml: provider.rawYaml,
        policy: provider.policy,
        enabled: provider.enabled,
        sortOrder: provider.sortOrder,
      })),
    );
  }

  const existingCustomRules = await db.select().from(customRuleTable).limit(1);
  if (existingCustomRules.length === 0 && defaults.rules.length > 0) {
    await db.insert(customRuleTable).values(
      defaults.rules.map((rule) => ({
        type: rule.type,
        target: rule.target,
        policy: rule.policy,
        noResolve: rule.noResolve,
        note: rule.note,
        enabled: rule.enabled,
        sortOrder: rule.sortOrder,
      })),
    );
  }

  const existingFragments = await db.select().from(configFragmentTable).limit(1);
  if (existingFragments.length === 0 && defaults.fragments.length > 0) {
    await db.insert(configFragmentTable).values(
      defaults.fragments.map((fragment) => ({
        key: fragment.key,
        yamlText: fragment.yamlText,
        enabled: fragment.enabled,
      })),
    );
  }

  const builtinRuleFragments = await db.select().from(configFragmentTable).where(eq(configFragmentTable.key, "builtin_rules"));
  if (builtinRuleFragments.length > 0) {
    const existingRules = await db.select().from(customRuleTable);
    const knownRuleFingerprints = new Set(existingRules.map((rule) => createBuiltinRuleFingerprint(customRuleSchema.parse(rule))));
    let nextSortOrder =
      existingRules.reduce((maxSortOrder, rule) => Math.max(maxSortOrder, rule.sortOrder ?? 0), 0) + 10;

    for (const fragment of builtinRuleFragments) {
      const migratedRules = parseBuiltinRuleLines(fragment.yamlText)
        .map((line) => {
          const rule = parseBuiltinRuleLine(line, nextSortOrder);
          nextSortOrder += 10;
          return rule;
        })
        .filter((rule): rule is CustomRule => Boolean(rule))
        .filter((rule) => {
          const fingerprint = createBuiltinRuleFingerprint(rule);
          if (knownRuleFingerprints.has(fingerprint)) {
            return false;
          }

          knownRuleFingerprints.add(fingerprint);
          return true;
        });

      if (migratedRules.length > 0) {
        await db.insert(customRuleTable).values(
          migratedRules.map((rule) => ({
            type: rule.type,
            target: rule.target,
            policy: rule.policy,
            noResolve: rule.noResolve,
            note: rule.note,
            enabled: rule.enabled,
            sortOrder: rule.sortOrder,
          })),
        );
      }
    }

    await db.delete(configFragmentTable).where(eq(configFragmentTable.key, "builtin_rules"));
  }
}

export async function getAppSettings(context: DatabaseContext): Promise<AppSettings> {
  const [row] = await context.db.select().from(appSettingsTable).where(eq(appSettingsTable.id, 1));
  return appSettingsSchema.parse({
    ...row,
    finalGroupMembers: parseJson(row?.finalGroupMembersJson, null),
  });
}

export async function updateAppSettings(
  context: DatabaseContext,
  payload: AppSettings,
): Promise<AppSettings> {
  const parsed = appSettingsSchema.parse({ ...payload, id: 1 });
  await context.db
    .update(appSettingsTable)
    .set({
      refreshIntervalMinutes: parsed.refreshIntervalMinutes,
      defaultHealthcheckUrl: parsed.defaultHealthcheckUrl,
      fetchProxyUrl: parsed.fetchProxyUrl,
      finalGroupMembersJson: serializeJson(parsed.finalGroupMembers),
      logLevel: parsed.logLevel,
      bindHost: parsed.bindHost,
      bindPort: parsed.bindPort,
      updatedAt: nowIso(),
    })
    .where(eq(appSettingsTable.id, 1));

  return getAppSettings(context);
}

export async function getClashTarget(context: DatabaseContext): Promise<ClashTarget> {
  const [row] = await context.db.select().from(clashTargetTable).where(eq(clashTargetTable.id, 1));
  return clashTargetSchema.parse(row);
}

export async function updateClashTarget(
  context: DatabaseContext,
  payload: ClashTarget,
): Promise<ClashTarget> {
  const parsed = clashTargetSchema.parse({ ...payload, id: 1 });

  await context.db
    .update(clashTargetTable)
    .set({
      configPath: parsed.configPath,
      controllerUrl: parsed.controllerUrl,
      secret: parsed.secret,
      autoReload: parsed.autoReload,
      restoreSelectors: parsed.restoreSelectors,
      mixedPort: parsed.mixedPort,
      allowLan: parsed.allowLan,
      externalController: parsed.externalController,
      mode: parsed.mode,
      updatedAt: nowIso(),
    })
    .where(eq(clashTargetTable.id, 1));

  return getClashTarget(context);
}

export async function listSources(context: DatabaseContext): Promise<SubscriptionSource[]> {
  const rows = await context.db.select().from(sourceSubscriptionTable).orderBy(asc(sourceSubscriptionTable.sortOrder), asc(sourceSubscriptionTable.id));
  return rows.map((row) => subscriptionSourceSchema.parse(row));
}

async function getNextSourceSortOrder(context: DatabaseContext): Promise<number> {
  const rows = await context.db.select({ sortOrder: sourceSubscriptionTable.sortOrder }).from(sourceSubscriptionTable);
  return rows.reduce((maxSortOrder, row) => Math.max(maxSortOrder, row.sortOrder ?? 0), 0) + 10;
}

export async function createSource(
  context: DatabaseContext,
  payload: SubscriptionSource,
): Promise<SubscriptionSource> {
  const parsed = subscriptionSourceSchema.parse(payload);
  const timestamp = nowIso();
  const sortOrder = parsed.sortOrder > 0 ? parsed.sortOrder : await getNextSourceSortOrder(context);
  const result = await context.db
    .insert(sourceSubscriptionTable)
    .values({
      name: parsed.name,
      url: parsed.url,
      enabled: parsed.enabled,
      refreshIntervalMinutes: parsed.refreshIntervalMinutes,
      prefixStrategy: parsed.prefixStrategy,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return subscriptionSourceSchema.parse(result[0]);
}

export async function updateSource(
  context: DatabaseContext,
  id: number,
  payload: SubscriptionSource,
): Promise<SubscriptionSource> {
  const parsed = subscriptionSourceSchema.parse({ ...payload, id });
  const existing = await getSource(context, id);

  if (!existing) {
    throw new Error(`Source ${id} not found`);
  }

  const result = await context.db
    .update(sourceSubscriptionTable)
    .set({
      name: parsed.name,
      url: parsed.url,
      enabled: parsed.enabled,
      refreshIntervalMinutes: parsed.refreshIntervalMinutes,
      prefixStrategy: parsed.prefixStrategy,
      sortOrder: parsed.sortOrder,
      updatedAt: nowIso(),
    })
    .where(eq(sourceSubscriptionTable.id, id))
    .returning();

  if (existing.name !== parsed.name) {
    const oldPrefixedProxyPrefix = existing.prefixStrategy === "source-name" ? `[${existing.name}] ` : "";
    const nextPrefixedProxyPrefix = parsed.prefixStrategy === "source-name" ? `[${parsed.name}] ` : "";
    await rewriteProxyGroups(context, (member) => {
      const renamedSourceMember = renameSourceMemberReference(member, existing.name, parsed.name);
      if (renamedSourceMember.kind === "proxy" && oldPrefixedProxyPrefix) {
        const nextValue = renameProxyMemberPrefix(renamedSourceMember.value, oldPrefixedProxyPrefix, nextPrefixedProxyPrefix);
        if (nextValue !== renamedSourceMember.value) {
          return { ...renamedSourceMember, value: nextValue };
        }
      }

      return renamedSourceMember;
    });
    await rewriteFinalGroupMembers(context, (member) => renameSourceMemberReference(member, existing.name, parsed.name));
    await rewriteCustomRulesPolicies(context, (value) => renameSourcePolicyReference(value, existing.name, parsed.name));
    await rewriteRuleProviderPolicies(context, (value) => renameSourcePolicyReference(value, existing.name, parsed.name));
  }

  return subscriptionSourceSchema.parse(result[0]);
}

export async function deleteSource(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(sourceSubscriptionTable).where(eq(sourceSubscriptionTable.id, id));
}

export async function getSource(context: DatabaseContext, id: number): Promise<SubscriptionSource | null> {
  const [row] = await context.db.select().from(sourceSubscriptionTable).where(eq(sourceSubscriptionTable.id, id));
  return row ? subscriptionSourceSchema.parse(row) : null;
}

export async function insertSnapshot(
  context: DatabaseContext,
  payload: Omit<SourceSnapshot, "id">,
): Promise<SourceSnapshot> {
  const parsed = sourceSnapshotSchema.parse(payload);
  const result = await context.db
    .insert(sourceSnapshotTable)
    .values({
      sourceId: parsed.sourceId,
      status: parsed.status,
      rawYaml: parsed.rawYaml,
      proxiesJson: serializeJson(parsed.proxies),
      error: parsed.error,
      fetchedAt: parsed.fetchedAt,
    })
    .returning();

  return sourceSnapshotSchema.parse({
    ...result[0],
    proxies: parseJson(result[0]?.proxiesJson, []),
  });
}

export async function listSnapshots(context: DatabaseContext): Promise<SourceSnapshot[]> {
  const rows = await context.db.select().from(sourceSnapshotTable).orderBy(desc(sourceSnapshotTable.fetchedAt));
  return rows.map((row) =>
    sourceSnapshotSchema.parse({
      id: row.id,
      sourceId: row.sourceId,
      status: row.status,
      rawYaml: row.rawYaml,
      proxies: parseJson(row.proxiesJson, []),
      error: row.error,
      fetchedAt: row.fetchedAt,
    }),
  );
}

async function queryLatestSnapshotRows(context: DatabaseContext, columns: string, statusFilter?: SourceSnapshot["status"]) {
  const nestedStatusCondition = statusFilter ? "AND s2.status = ?" : "";
  const args = statusFilter ? [statusFilter] : undefined;
  const sql = `
    SELECT ${columns}
    FROM source_subscription source
    JOIN source_snapshot s ON s.id = (
      SELECT s2.id
      FROM source_snapshot s2
      WHERE s2.source_id = source.id
      ${nestedStatusCondition}
      ORDER BY s2.fetched_at DESC, s2.id DESC
      LIMIT 1
    )
    ORDER BY s.fetched_at DESC, s.id DESC
  `;
  const result = await context.sqlite.execute(args ? { sql, args } : sql);
  return result.rows as Array<Record<string, unknown>>;
}

export async function listLatestSnapshotSummaries(context: DatabaseContext): Promise<SourceSnapshotSummary[]> {
  const rows = await queryLatestSnapshotRows(
    context,
    [
      "s.source_id AS sourceId",
      "s.status AS status",
      "COALESCE(json_array_length(s.proxies_json), 0) AS proxyCount",
      "s.error AS error",
      "s.fetched_at AS fetchedAt",
    ].join(", "),
  );

  return rows.map((row) => {
    return {
      sourceId: rowNumber(row, "sourceId"),
      status: sourceSnapshotSchema.shape.status.parse(rowString(row, "status")),
      fetchedAt: rowString(row, "fetchedAt"),
      proxyCount: rowNumber(row, "proxyCount"),
      error: rowNullableString(row, "error"),
    };
  });
}

export async function listLatestSuccessfulSnapshots(context: DatabaseContext): Promise<SourceSnapshot[]> {
  const rows = await queryLatestSnapshotRows(
    context,
    [
      "s.id AS id",
      "s.source_id AS sourceId",
      "s.status AS status",
      "s.raw_yaml AS rawYaml",
      "s.proxies_json AS proxiesJson",
      "s.error AS error",
      "s.fetched_at AS fetchedAt",
    ].join(", "),
    "success",
  );

  return rows.map((row) =>
    sourceSnapshotSchema.parse({
      id: rowNumber(row, "id"),
      sourceId: rowNumber(row, "sourceId"),
      status: rowString(row, "status"),
      rawYaml: rowNullableString(row, "rawYaml"),
      proxies: parseJson(rowString(row, "proxiesJson"), []),
      error: rowNullableString(row, "error"),
      fetchedAt: rowString(row, "fetchedAt"),
    }),
  );
}

export async function listRegionRules(context: DatabaseContext): Promise<RegionRule[]> {
  const rows = await context.db.select().from(regionRuleTable);
  return rows.map((row) =>
    regionRuleSchema.parse({
      id: row.id,
      name: row.name,
      keywords: parseJson<string[]>(row.keywordsJson, []),
      enabled: row.enabled,
      sortOrder: row.sortOrder,
    }),
  );
}

export async function createRegionRule(context: DatabaseContext, payload: RegionRule): Promise<RegionRule> {
  const parsed = regionRuleSchema.parse(payload);
  const result = await context.db
    .insert(regionRuleTable)
    .values({
      name: parsed.name,
      keywordsJson: serializeJson(parsed.keywords),
      enabled: parsed.enabled,
      sortOrder: parsed.sortOrder,
    })
    .returning();

  return regionRuleSchema.parse({
    id: result[0].id,
    name: result[0].name,
    keywords: parseJson(result[0].keywordsJson, []),
    enabled: result[0].enabled,
    sortOrder: result[0].sortOrder,
  });
}

export async function updateRegionRule(context: DatabaseContext, id: number, payload: RegionRule): Promise<RegionRule> {
  const parsed = regionRuleSchema.parse({ ...payload, id });
  const existing = await context.db.select().from(regionRuleTable).where(eq(regionRuleTable.id, id));
  const result = await context.db
    .update(regionRuleTable)
    .set({
      name: parsed.name,
      keywordsJson: serializeJson(parsed.keywords),
      enabled: parsed.enabled,
      sortOrder: parsed.sortOrder,
    })
    .where(eq(regionRuleTable.id, id))
    .returning();

  const previous = existing[0];
  if (previous && previous.name !== parsed.name) {
    await rewriteProxyGroups(context, (member) => renameRegionMemberReference(member, previous.name, parsed.name));
    await rewriteFinalGroupMembers(context, (member) => renameRegionMemberReference(member, previous.name, parsed.name));
    await rewriteCustomRulesPolicies(context, (value) => renameRegionPolicyReference(value, previous.name, parsed.name));
    await rewriteRuleProviderPolicies(context, (value) => renameRegionPolicyReference(value, previous.name, parsed.name));
  }

  return regionRuleSchema.parse({
    id: result[0].id,
    name: result[0].name,
    keywords: parseJson(result[0].keywordsJson, []),
    enabled: result[0].enabled,
    sortOrder: result[0].sortOrder,
  });
}

export async function deleteRegionRule(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(regionRuleTable).where(eq(regionRuleTable.id, id));
}

export async function listRuleProviders(context: DatabaseContext): Promise<RuleProviderDraft[]> {
  const rows = await context.db.select().from(ruleProviderTable).orderBy(asc(ruleProviderTable.sortOrder), asc(ruleProviderTable.id));
  return rows.map((row) => normalizeRuleProvider(ruleProviderDraftSchema.parse(row)));
}

export async function createRuleProvider(
  context: DatabaseContext,
  payload: RuleProviderDraft,
): Promise<RuleProviderDraft> {
  const parsed = normalizeRuleProvider(ruleProviderDraftSchema.parse(payload));
  const result = await context.db.insert(ruleProviderTable).values(parsed).returning();
  return normalizeRuleProvider(ruleProviderDraftSchema.parse(result[0]));
}

export async function updateRuleProvider(
  context: DatabaseContext,
  id: number,
  payload: RuleProviderDraft,
): Promise<RuleProviderDraft> {
  const parsed = normalizeRuleProvider(ruleProviderDraftSchema.parse({ ...payload, id }));
  const result = await context.db
    .update(ruleProviderTable)
    .set(parsed)
    .where(eq(ruleProviderTable.id, id))
    .returning();

  return normalizeRuleProvider(ruleProviderDraftSchema.parse(result[0]));
}

export async function deleteRuleProvider(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(ruleProviderTable).where(eq(ruleProviderTable.id, id));
}

export async function listCustomRules(context: DatabaseContext): Promise<CustomRule[]> {
  const rows = await context.db.select().from(customRuleTable).orderBy(asc(customRuleTable.sortOrder), asc(customRuleTable.id));
  return rows.map((row) => customRuleSchema.parse(row));
}

export async function createCustomRule(context: DatabaseContext, payload: CustomRule): Promise<CustomRule> {
  const parsed = customRuleSchema.parse(payload);
  const result = await context.db.insert(customRuleTable).values(parsed).returning();
  return customRuleSchema.parse(result[0]);
}

export async function updateCustomRule(context: DatabaseContext, id: number, payload: CustomRule): Promise<CustomRule> {
  const parsed = customRuleSchema.parse({ ...payload, id });
  const result = await context.db
    .update(customRuleTable)
    .set(parsed)
    .where(eq(customRuleTable.id, id))
    .returning();

  return customRuleSchema.parse(result[0]);
}

export async function deleteCustomRule(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(customRuleTable).where(eq(customRuleTable.id, id));
}

export async function listProxyGroups(context: DatabaseContext): Promise<ProxyGroupDraft[]> {
  const rows = await context.db.select().from(proxyGroupTable);
  return rows.map((row) =>
    proxyGroupDraftSchema.parse({
      ...row,
      members: parseJson(row.membersJson, []),
    }),
  );
}

export async function createProxyGroup(context: DatabaseContext, payload: ProxyGroupDraft): Promise<ProxyGroupDraft> {
  const parsed = proxyGroupDraftSchema.parse(payload);
  const result = await context.db
    .insert(proxyGroupTable)
    .values({
      name: parsed.name,
      type: parsed.type,
      url: parsed.url,
      interval: parsed.interval,
      timeout: parsed.timeout,
      enabled: parsed.enabled,
      sortOrder: parsed.sortOrder,
      membersJson: serializeJson(parsed.members),
    })
    .returning();

  return proxyGroupDraftSchema.parse({
    ...result[0],
    members: parseJson(result[0].membersJson, []),
  });
}

export async function updateProxyGroup(
  context: DatabaseContext,
  id: number,
  payload: ProxyGroupDraft,
): Promise<ProxyGroupDraft> {
  const parsed = proxyGroupDraftSchema.parse({ ...payload, id });
  const existingGroups = await listProxyGroups(context);
  const existing = existingGroups.find((group) => group.id === id);
  const result = await context.db
    .update(proxyGroupTable)
    .set({
      name: parsed.name,
      type: parsed.type,
      url: parsed.url,
      interval: parsed.interval,
      timeout: parsed.timeout,
      enabled: parsed.enabled,
      sortOrder: parsed.sortOrder,
      membersJson: serializeJson(parsed.members),
    })
    .where(eq(proxyGroupTable.id, id))
    .returning();

  if (existing && existing.name !== parsed.name) {
    await rewriteProxyGroups(context, (member) => renameGroupMemberReference(member, existing.name, parsed.name));
    await rewriteFinalGroupMembers(context, (member) => renameGroupMemberReference(member, existing.name, parsed.name));
    await rewriteCustomRulesPolicies(context, (value) => renameExactReference(value, existing.name, parsed.name));
    await rewriteRuleProviderPolicies(context, (value) => renameExactReference(value, existing.name, parsed.name));
    await rewriteManualProxyFragment(context, (records) => {
      let changed = false;
      const nextRecords = records.map((record) => {
        if (String(record["dialer-proxy"] ?? "") !== existing.name) {
          return record;
        }

        changed = true;
        return {
          ...record,
          "dialer-proxy": parsed.name,
        };
      });

      return { changed, records: nextRecords };
    });
  }

  return proxyGroupDraftSchema.parse({
    ...result[0],
    members: parseJson(result[0].membersJson, []),
  });
}

export async function deleteProxyGroup(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(proxyGroupTable).where(eq(proxyGroupTable.id, id));
}

export async function listConfigFragments(context: DatabaseContext): Promise<ConfigFragment[]> {
  const rows = await context.db.select().from(configFragmentTable);
  return rows.map((row) => configFragmentSchema.parse(row));
}

export async function upsertConfigFragment(
  context: DatabaseContext,
  payload: ConfigFragment,
): Promise<ConfigFragment> {
  const parsed = configFragmentSchema.parse(payload);
  const existing = await context.db.select().from(configFragmentTable).where(eq(configFragmentTable.key, parsed.key));
  const previous = existing[0] ? configFragmentSchema.parse(existing[0]) : null;

  if (existing.length === 0) {
    const result = await context.db.insert(configFragmentTable).values(parsed).returning();
    return configFragmentSchema.parse(result[0]);
  }

  const result = await context.db
    .update(configFragmentTable)
    .set({
      yamlText: parsed.yamlText,
      enabled: parsed.enabled,
    })
    .where(eq(configFragmentTable.key, parsed.key))
    .returning();

  if (parsed.key === "manual_proxies" && previous) {
    const previousRecords = parseManualProxyYamlText(previous.yamlText);
    const nextRecords = parseManualProxyYamlText(parsed.yamlText);
    const renamePairs = inferManualProxyRenames(previousRecords, nextRecords);

    for (const { previousName, nextName } of renamePairs) {
      await rewriteProxyGroups(context, (member) => renameProxyMemberReference(member, previousName, nextName));
      await rewriteFinalGroupMembers(context, (member) => renameProxyMemberReference(member, previousName, nextName));
      await rewriteCustomRulesPolicies(context, (value) => renameExactReference(value, previousName, nextName));
      await rewriteRuleProviderPolicies(context, (value) => renameExactReference(value, previousName, nextName));
      await rewriteManualProxyFragment(context, (records) => {
        let changed = false;
        const rewritten = records.map((record) => {
          if (String(record["dialer-proxy"] ?? "") !== previousName) {
            return record;
          }

          changed = true;
          return {
            ...record,
            "dialer-proxy": nextName,
          };
        });

        return { changed, records: rewritten };
      });
    }
  }

  return configFragmentSchema.parse(result[0]);
}

export async function listDeviceProfiles(context: DatabaseContext): Promise<DeviceProfile[]> {
  const rows = await context.db.select().from(deviceProfileTable);
  return rows.map((row) => parseDeviceProfileRow(row));
}

export async function createDeviceProfile(
  context: DatabaseContext,
  payload: DeviceProfile,
): Promise<DeviceProfile> {
  const parsed = deviceProfileSchema.parse(payload);
  const timestamp = nowIso();
  const result = await context.db
    .insert(deviceProfileTable)
    .values({
      name: parsed.name,
      token: parsed.token ?? crypto.randomUUID().replaceAll("-", ""),
      enabled: parsed.enabled,
      filename: parsed.filename,
      mixedPort: parsed.mixedPort,
      allowLan: parsed.allowLan,
      externalController: parsed.externalController,
      secret: parsed.secret,
      mode: parsed.mode,
      fragmentOverridesJson: serializeJson(parsed.fragmentOverrides),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  return parseDeviceProfileRow(result[0]);
}

export async function updateDeviceProfile(
  context: DatabaseContext,
  id: number,
  payload: DeviceProfile,
): Promise<DeviceProfile> {
  const parsed = deviceProfileSchema.parse({ ...payload, id });
  const result = await context.db
    .update(deviceProfileTable)
    .set({
      name: parsed.name,
      token: parsed.token ?? crypto.randomUUID().replaceAll("-", ""),
      enabled: parsed.enabled,
      filename: parsed.filename,
      mixedPort: parsed.mixedPort,
      allowLan: parsed.allowLan,
      externalController: parsed.externalController,
      secret: parsed.secret,
      mode: parsed.mode,
      fragmentOverridesJson: serializeJson(parsed.fragmentOverrides),
      updatedAt: nowIso(),
    })
    .where(eq(deviceProfileTable.id, id))
    .returning();

  return parseDeviceProfileRow(result[0]);
}

export async function deleteDeviceProfile(context: DatabaseContext, id: number): Promise<void> {
  await context.db.delete(deviceProfileTable).where(eq(deviceProfileTable.id, id));
}

export async function getDeviceProfile(context: DatabaseContext, id: number): Promise<DeviceProfile | null> {
  const [row] = await context.db.select().from(deviceProfileTable).where(eq(deviceProfileTable.id, id));
  return row ? parseDeviceProfileRow(row) : null;
}

export async function getDeviceProfileByToken(
  context: DatabaseContext,
  token: string,
): Promise<DeviceProfile | null> {
  const [row] = await context.db.select().from(deviceProfileTable).where(eq(deviceProfileTable.token, token));
  return row ? parseDeviceProfileRow(row) : null;
}

export async function startJobRun(
  context: DatabaseContext,
  jobType: JobRun["jobType"],
  details: Record<string, unknown> = {},
): Promise<number> {
  const result = await context.db
    .insert(jobRunTable)
    .values({
      jobType,
      status: "running",
      detailsJson: serializeJson(details),
      startedAt: nowIso(),
    })
    .returning();

  return result[0].id;
}

export async function finishJobRun(
  context: DatabaseContext,
  id: number,
  status: JobRun["status"],
  details: Record<string, unknown>,
  error: string | null,
): Promise<void> {
  await context.db
    .update(jobRunTable)
    .set({
      status,
      detailsJson: serializeJson(details),
      error,
      finishedAt: nowIso(),
    })
    .where(eq(jobRunTable.id, id));
}

export async function listJobRuns(context: DatabaseContext): Promise<JobRun[]> {
  const rows = await context.db.select().from(jobRunTable).orderBy(desc(jobRunTable.startedAt));
  return rows.map(mapJobRun);
}

export async function listRecentJobRuns(context: DatabaseContext, limit = 10): Promise<JobRun[]> {
  const rows = await context.db.select().from(jobRunTable).orderBy(desc(jobRunTable.startedAt)).limit(limit);
  return rows.map(mapJobRun);
}

export async function loadCompileInput(context: DatabaseContext) {
  const [appSettings, clashTarget, sources, snapshots, regionRules, customRules, ruleProviders, proxyGroups, configFragments] =
    await Promise.all([
      getAppSettings(context),
      getClashTarget(context),
      listSources(context),
      listLatestSuccessfulSnapshots(context),
      listRegionRules(context),
      listCustomRules(context),
      listRuleProviders(context),
      listProxyGroups(context),
      listConfigFragments(context),
    ]);

  return {
    appSettings,
    clashTarget,
    sources,
    snapshots,
    regionRules,
    customRules,
    ruleProviders,
    proxyGroups,
    configFragments,
  };
}

export async function exportConfigBundle(context: DatabaseContext): Promise<ConfigBundle> {
  const [appSettings, clashTarget, sources, regionRules, customRules, ruleProviders, proxyGroups, configFragments, deviceProfiles] =
    await Promise.all([
      getAppSettings(context),
      getClashTarget(context),
      listSources(context),
      listRegionRules(context),
      listCustomRules(context),
      listRuleProviders(context),
      listProxyGroups(context),
      listConfigFragments(context),
      listDeviceProfiles(context),
    ]);

  const { id: _appSettingsId, createdAt: _appCreatedAt, updatedAt: _appUpdatedAt, ...exportableAppSettings } = appSettings;
  const {
    id: _targetId,
    createdAt: _targetCreatedAt,
    updatedAt: _targetUpdatedAt,
    ...exportableClashTarget
  } = clashTarget;

  return configBundleSchema.parse({
    version: 1,
    exportedAt: nowIso(),
    data: {
      appSettings: exportableAppSettings,
      clashTarget: exportableClashTarget,
      sources: sources.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...source }) => source),
      regionRules: regionRules.map(({ id: _id, ...region }) => region),
      customRules: customRules.map(({ id: _id, ...rule }) => rule),
      ruleProviders: ruleProviders.map(({ id: _id, ...provider }) => provider),
      proxyGroups: proxyGroups.map(({ id: _id, ...group }) => group),
      configFragments: configFragments.map(({ id: _id, ...fragment }) => fragment),
      deviceProfiles: deviceProfiles.map(({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...device }) => device),
    },
  });
}

export async function importConfigBundle(context: DatabaseContext, payload: ConfigBundle): Promise<ConfigBundle> {
  const parsed = configBundleSchema.parse(payload);
  const timestamp = nowIso();

  await updateAppSettings(context, parsed.data.appSettings);
  await context.db.update(clashTargetTable).set({ lastAppliedHash: null }).where(eq(clashTargetTable.id, 1));
  await updateClashTarget(context, parsed.data.clashTarget);

  await context.db.delete(sourceSnapshotTable);
  await context.db.delete(jobRunTable);
  await context.db.delete(sourceSubscriptionTable);
  await context.db.delete(regionRuleTable);
  await context.db.delete(ruleProviderTable);
  await context.db.delete(customRuleTable);
  await context.db.delete(proxyGroupTable);
  await context.db.delete(configFragmentTable);
  await context.db.delete(deviceProfileTable);

  if (parsed.data.sources.length) {
    await context.db.insert(sourceSubscriptionTable).values(
      parsed.data.sources.map((source) => ({
        name: source.name,
        url: source.url,
        enabled: source.enabled,
        refreshIntervalMinutes: source.refreshIntervalMinutes,
        prefixStrategy: source.prefixStrategy,
        sortOrder: source.sortOrder,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
  }

  if (parsed.data.regionRules.length) {
    await context.db.insert(regionRuleTable).values(
      parsed.data.regionRules.map((region) => ({
        name: region.name,
        keywordsJson: serializeJson(region.keywords),
        enabled: region.enabled,
        sortOrder: region.sortOrder,
      })),
    );
  }

  if (parsed.data.ruleProviders.length) {
    await context.db.insert(ruleProviderTable).values(parsed.data.ruleProviders.map((provider) => normalizeRuleProvider(provider)));
  }

  if (parsed.data.customRules.length) {
    await context.db.insert(customRuleTable).values(parsed.data.customRules);
  }

  if (parsed.data.proxyGroups.length) {
    await context.db.insert(proxyGroupTable).values(
      parsed.data.proxyGroups.map((group) => ({
        name: group.name,
        type: group.type,
        url: group.url,
        interval: group.interval,
        timeout: group.timeout,
        enabled: group.enabled,
        sortOrder: group.sortOrder,
        membersJson: serializeJson(group.members),
      })),
    );
  }

  if (parsed.data.configFragments.length) {
    await context.db.insert(configFragmentTable).values(parsed.data.configFragments);
  }

  if (parsed.data.deviceProfiles.length) {
    await context.db.insert(deviceProfileTable).values(
      parsed.data.deviceProfiles.map((device) => ({
        name: device.name,
        token: device.token ?? crypto.randomUUID().replaceAll("-", ""),
        enabled: device.enabled,
        filename: device.filename,
        mixedPort: device.mixedPort,
        allowLan: device.allowLan,
        externalController: device.externalController,
        secret: device.secret,
        mode: device.mode,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    );
  }

  return exportConfigBundle(context);
}
