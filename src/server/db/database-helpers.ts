import { type Client } from "@libsql/client";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_CLASH_TARGET,
  DEFAULT_CONFIG_FRAGMENTS,
  DEFAULT_CUSTOM_RULES,
  DEFAULT_REGION_RULES,
  DEFAULT_RULE_PROVIDERS,
  DEFAULT_SOURCES,
} from "../../shared/defaults.js";
import {
  customRuleSchema,
  deviceProfileFragmentOverrideSchema,
  deviceProfileSchema,
  ruleProviderDraftSchema,
  type CustomRule,
  type DeviceProfile,
  type DeviceProfileFragmentOverride,
  type JobRun,
  type ParsedProxy,
  type ProxyGroupMember,
  type RuleProviderDraft,
} from "../../shared/types.js";
import { type AppPaths } from "../lib/paths.js";
import { getDevMihomoPaths, type RuntimeConfig } from "../lib/runtime.js";
import { deviceProfileTable, jobRunTable } from "./schema.js";
import { ensureTelemetryTables } from "./telemetry-db.js";
import { ensureProxyProbeTables } from "./probe-db.js";

type SeedContext = {
  paths: AppPaths;
  runtime: RuntimeConfig;
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  return JSON.parse(value) as T;
}

export function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : String(value ?? "");
}

export function rowNullableString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : rowString(row, key);
}

export function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" ? value : Number(value);
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value);
}

export const DEFAULT_SERVER_PORT = 36123;
export const DEFAULT_LOCAL_DEV_SERVER_PORT = 36124;
export const LEGACY_SERVER_PORTS = new Set([3000, 3001]);

function parseDeviceProfileFragmentOverrides(value: string | null | undefined): DeviceProfileFragmentOverride[] {
  return parseJson(value, []).map((item) => deviceProfileFragmentOverrideSchema.parse(item));
}

export function parseDeviceProfileRow(
  row: typeof deviceProfileTable.$inferSelect & { fragmentOverridesJson?: string | null },
): DeviceProfile {
  return deviceProfileSchema.parse({
    ...row,
    fragmentOverrides: parseDeviceProfileFragmentOverrides(row.fragmentOverridesJson),
  });
}

export function renameProxyMemberPrefix(value: string, oldPrefix: string, nextPrefix: string): string {
  if (!value.startsWith(oldPrefix)) {
    return value;
  }

  return `${nextPrefix}${value.slice(oldPrefix.length)}`;
}

function formatSourceGroupName(value: string): string {
  return `[订阅] ${value}`;
}

function formatRegionGroupName(value: string): string {
  return `[地区] ${value}`;
}

export function parseManualProxyYamlText(yamlText: string): ParsedProxy[] {
  const trimmed = yamlText.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = parseYaml(yamlText);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is ParsedProxy => isRecord(item)) as ParsedProxy[];
    }
  } catch {
    return [];
  }

  return [];
}

export function stringifyManualProxyYamlText(items: ParsedProxy[]): string {
  return items.length ? stringifyYaml(items).trim() : "";
}

export function renameSourcePolicyReference(value: string, oldName: string, nextName: string): string {
  if (value === oldName || value === `SOURCE/${oldName}` || value === formatSourceGroupName(oldName)) {
    return formatSourceGroupName(nextName);
  }

  return value;
}

export function renameRegionPolicyReference(value: string, oldName: string, nextName: string): string {
  if (value === oldName || value === `REGION/${oldName}` || value === formatRegionGroupName(oldName)) {
    return formatRegionGroupName(nextName);
  }

  return value;
}

export function renameExactReference(value: string, oldName: string, nextName: string): string {
  return value === oldName ? nextName : value;
}

export function renameGroupMemberReference(member: ProxyGroupMember, oldName: string, nextName: string): ProxyGroupMember {
  if (member.kind === "group" && member.value === oldName) {
    return { ...member, value: nextName };
  }

  return member;
}

export function renameProxyMemberReference(member: ProxyGroupMember, oldName: string, nextName: string): ProxyGroupMember {
  if (member.kind === "proxy" && member.value === oldName) {
    return { ...member, value: nextName };
  }

  return member;
}

export function renameRegionMemberReference(member: ProxyGroupMember, oldName: string, nextName: string): ProxyGroupMember {
  if (member.kind === "regionGroup" && member.value === oldName) {
    return { ...member, value: nextName };
  }

  if (member.kind === "special") {
    const nextValue = renameRegionPolicyReference(member.value, oldName, nextName);
    if (nextValue !== member.value) {
      return { ...member, value: nextValue };
    }
  }

  return member;
}

export function renameSourceMemberReference(member: ProxyGroupMember, oldName: string, nextName: string): ProxyGroupMember {
  if (member.kind === "sourceGroup" && member.value === oldName) {
    return { ...member, value: nextName };
  }

  if (member.kind === "special") {
    const nextValue = renameSourcePolicyReference(member.value, oldName, nextName);
    if (nextValue !== member.value) {
      return { ...member, value: nextValue };
    }
  }

  return member;
}

export function inferManualProxyRenames(
  previousRecords: ParsedProxy[],
  nextRecords: ParsedProxy[],
): Array<{ previousName: string; nextName: string }> {
  // Only in-place edits count as renames. Deleting, inserting, or reordering
  // records must NOT be interpreted as renames: pairing old/new records by
  // index after a deletion produces a bogus rename chain that rewrites every
  // proxy-group member to the wrong node.
  if (previousRecords.length !== nextRecords.length) {
    return [];
  }

  const previousNames = previousRecords.map((record) => String(record.name ?? "").trim());
  const nextNames = nextRecords.map((record) => String(record.name ?? "").trim());
  const previousNameSet = new Set(previousNames);
  const nextNameSet = new Set(nextNames);
  const renamePairs: Array<{ previousName: string; nextName: string }> = [];

  for (let index = 0; index < previousNames.length; index += 1) {
    const previousName = previousNames[index];
    const nextName = nextNames[index];

    if (!previousName || !nextName || previousName === nextName) {
      continue;
    }

    // The old name must be gone and the new name must be genuinely new,
    // otherwise this save looks like a reorder or duplicate — too ambiguous
    // to propagate anything.
    if (nextNameSet.has(previousName) || previousNameSet.has(nextName)) {
      return [];
    }

    renamePairs.push({ previousName, nextName });
  }

  return renamePairs;
}

export function renameMembers(members: ProxyGroupMember[], renamer: (member: ProxyGroupMember) => ProxyGroupMember) {
  let changed = false;
  const nextMembers = members.map((member) => {
    const nextMember = renamer(member);
    if (nextMember.kind !== member.kind || nextMember.value !== member.value) {
      changed = true;
    }
    return nextMember;
  });

  return { changed, members: nextMembers };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStructuredRuleProviderDefinition(
  value: unknown,
): Pick<RuleProviderDraft, "behavior" | "format" | "url" | "interval" | "path"> | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = typeof value.type === "string" ? value.type : "http";
  if (type !== "http") {
    return null;
  }

  const behavior: RuleProviderDraft["behavior"] =
    typeof value.behavior === "string" && ["classical", "domain", "ipcidr"].includes(value.behavior)
      ? (value.behavior as RuleProviderDraft["behavior"])
      : "classical";
  const format: RuleProviderDraft["format"] =
    typeof value.format === "string" && ["yaml", "text"].includes(value.format)
      ? (value.format as RuleProviderDraft["format"])
      : "yaml";

  return {
    behavior,
    format,
    url: typeof value.url === "string" ? value.url : "",
    interval:
      typeof value.interval === "number" && Number.isFinite(value.interval) && value.interval > 0 ? value.interval : 3600,
    path: typeof value.path === "string" ? value.path : "",
  };
}

export function normalizeRuleProvider(provider: RuleProviderDraft): RuleProviderDraft {
  if (provider.mode === "raw" && provider.rawYaml.trim()) {
    try {
      const parsed = parseStructuredRuleProviderDefinition(parseYaml(provider.rawYaml));
      if (parsed) {
        return ruleProviderDraftSchema.parse({
          ...provider,
          mode: "structured",
          behavior: parsed.behavior,
          format: parsed.format,
          url: parsed.url,
          interval: parsed.interval,
          path: parsed.path,
          rawYaml: "",
        });
      }
    } catch {
      return provider;
    }
  }

  if (provider.mode === "raw" && !provider.rawYaml.trim() && (provider.url.trim() || provider.path.trim())) {
    return ruleProviderDraftSchema.parse({
      ...provider,
      mode: "structured",
      rawYaml: "",
    });
  }

  return ruleProviderDraftSchema.parse({
    ...provider,
    rawYaml: provider.mode === "structured" ? "" : provider.rawYaml,
  });
}

export function mapJobRun(row: typeof jobRunTable.$inferSelect): JobRun {
  return {
    id: row.id,
    jobType: row.jobType as JobRun["jobType"],
    status: row.status as JobRun["status"],
    details: parseJson(row.detailsJson, {}),
    error: row.error,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export function parseBuiltinRuleLines(yamlText: string): string[] {
  const trimmed = yamlText.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = parseYaml(yamlText);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
    }
  } catch {
    // Fall back to line-based parsing below.
  }

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

export function parseBuiltinRuleLine(line: string, sortOrder: number): CustomRule | null {
  const segments = line.split(",").map((item) => item.trim());
  const type = segments[0] || "RAW";

  if (type === "RAW") {
      return customRuleSchema.parse({
        type: "RAW",
        target: line,
        policy: "FINAL",
        noResolve: false,
        note: "",
        enabled: true,
      sortOrder,
    });
  }

  if (type === "MATCH") {
      return customRuleSchema.parse({
        type: "MATCH",
        target: "",
        policy: segments[1] || "FINAL",
        noResolve: segments.slice(2).includes("no-resolve"),
        note: "",
        enabled: true,
      sortOrder,
    });
  }

  if (!segments[1] || !segments[2]) {
    return null;
  }

  return customRuleSchema.parse({
    type,
    target: segments[1],
    policy: segments[2],
    noResolve: segments.slice(3).includes("no-resolve"),
    note: "",
    enabled: true,
    sortOrder,
  });
}

export function createBuiltinRuleFingerprint(rule: Pick<CustomRule, "type" | "target" | "policy" | "noResolve">): string {
  return [rule.type, rule.target, rule.policy, rule.noResolve ? "1" : "0"].join("|");
}

export async function ensureTables(sqlite: Client) {
  await sqlite.batch(
    [
      `CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY,
        refresh_interval_minutes INTEGER NOT NULL,
        default_healthcheck_url TEXT NOT NULL,
        fetch_proxy_url TEXT,
        final_group_members_json TEXT,
        log_level TEXT NOT NULL,
        bind_host TEXT NOT NULL,
        bind_port INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS clash_target (
        id INTEGER PRIMARY KEY,
        config_path TEXT NOT NULL,
        controller_url TEXT NOT NULL,
        secret TEXT NOT NULL,
        auto_reload INTEGER NOT NULL,
        restore_selectors INTEGER NOT NULL,
        mixed_port INTEGER NOT NULL,
        allow_lan INTEGER NOT NULL,
        external_controller TEXT NOT NULL,
        mode TEXT NOT NULL,
        last_applied_hash TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS source_subscription (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        refresh_interval_minutes INTEGER,
        prefix_strategy TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS source_snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        raw_yaml TEXT,
        proxies_json TEXT NOT NULL,
        error TEXT,
        fetched_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS region_rule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rule_provider (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        mode TEXT NOT NULL,
        behavior TEXT NOT NULL,
        format TEXT NOT NULL,
        url TEXT NOT NULL,
        interval INTEGER NOT NULL,
        path TEXT NOT NULL,
        raw_yaml TEXT NOT NULL,
        policy TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS custom_rule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        policy TEXT NOT NULL,
        no_resolve INTEGER NOT NULL,
        note TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS proxy_group (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        url TEXT NOT NULL,
        interval INTEGER NOT NULL,
        timeout INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        sort_order INTEGER NOT NULL,
        members_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS config_fragment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        yaml_text TEXT NOT NULL,
        enabled INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS device_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        token TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        filename TEXT NOT NULL,
        mixed_port INTEGER,
        allow_lan INTEGER,
        external_controller TEXT,
        secret TEXT,
        mode TEXT,
        fragment_overrides_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS job_run (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        details_json TEXT NOT NULL,
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      )`,
    ],
    "write",
  );
  await sqlite.batch(
    [
      `CREATE INDEX IF NOT EXISTS idx_source_snapshot_source_latest
        ON source_snapshot(source_id, fetched_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_source_snapshot_source_status_latest
        ON source_snapshot(source_id, status, fetched_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_job_run_started_at
        ON job_run(started_at DESC, id DESC)`,
    ],
    "write",
  );

  await ensureOptionalColumn(sqlite, "app_settings", "fetch_proxy_url", "TEXT");
  await ensureOptionalColumn(sqlite, "app_settings", "final_group_members_json", "TEXT");
  await ensureOptionalColumn(sqlite, "source_subscription", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  await ensureOptionalColumn(sqlite, "device_profile", "fragment_overrides_json", "TEXT");
  await ensureTelemetryTables(sqlite);
  await ensureProxyProbeTables(sqlite);
}

async function ensureOptionalColumn(sqlite: Client, table: string, column: string, definition: string) {
  try {
    await sqlite.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate column name")) {
      throw error;
    }
  }
}

export function getSeedDefaults(context: SeedContext) {
  if (!context.runtime.localDevMode) {
    return {
      appSettings: DEFAULT_APP_SETTINGS,
      clashTarget: {
        ...DEFAULT_CLASH_TARGET,
        configPath: `${context.paths.dataDir}/clash/config.yaml`,
        controllerUrl: "http://127.0.0.1:9090",
        secret: "",
        autoReload: false,
        restoreSelectors: false,
        allowLan: false,
        externalController: "127.0.0.1:9090",
      },
      sources: DEFAULT_SOURCES,
      regions: DEFAULT_REGION_RULES,
      rules: DEFAULT_CUSTOM_RULES,
      providers: DEFAULT_RULE_PROVIDERS,
      fragments: DEFAULT_CONFIG_FRAGMENTS,
    };
  }

  const devMihomoPaths = getDevMihomoPaths(context.paths.cwd);
  const localDevClashTarget = context.runtime.devMihomoMode
    ? {
        ...DEFAULT_CLASH_TARGET,
        configPath: devMihomoPaths.configFile,
        controllerUrl: devMihomoPaths.controllerUrl,
        secret: context.runtime.devMihomoSecret,
        autoReload: true,
        restoreSelectors: true,
        mixedPort: 17890,
        allowLan: false,
        externalController: devMihomoPaths.externalController,
      }
    : {
        ...DEFAULT_CLASH_TARGET,
        configPath: `${context.paths.dataDir}/clash/config.yaml`,
        controllerUrl: "http://127.0.0.1:9090",
        secret: "",
        autoReload: false,
        restoreSelectors: false,
        externalController: "127.0.0.1:9090",
      };

  return {
    appSettings: {
      ...DEFAULT_APP_SETTINGS,
      bindPort: DEFAULT_LOCAL_DEV_SERVER_PORT,
      refreshIntervalMinutes: 60,
    },
    clashTarget: localDevClashTarget,
    sources: DEFAULT_SOURCES,
    regions: DEFAULT_REGION_RULES,
    rules: DEFAULT_CUSTOM_RULES,
    providers: DEFAULT_RULE_PROVIDERS,
    fragments: DEFAULT_CONFIG_FRAGMENTS,
  };
}
