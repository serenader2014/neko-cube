import { z } from "zod";

export const parsedProxySchema = z.record(z.string(), z.unknown()).and(
  z.object({
    name: z.string().min(1),
    type: z.string().min(1),
  }),
);

export type ParsedProxy = z.infer<typeof parsedProxySchema>;

export const subscriptionSourceSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  url: z.string().url(),
  enabled: z.boolean().default(true),
  refreshIntervalMinutes: z.number().int().positive().nullable().default(null),
  prefixStrategy: z.enum(["source-name", "none"]).default("source-name"),
  sortOrder: z.number().int().default(0),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type SubscriptionSource = z.infer<typeof subscriptionSourceSchema>;

export const regionRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type RegionRule = z.infer<typeof regionRuleSchema>;

export const customRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.enum([
    "DOMAIN",
    "DOMAIN-SUFFIX",
    "DOMAIN-KEYWORD",
    "IP-CIDR",
    "IP-CIDR6",
    "SRC-IP-CIDR",
    "SRC-PORT",
    "DST-PORT",
    "PROCESS-NAME",
    "PROCESS-PATH",
    "GEOIP",
    "MATCH",
    "RAW",
  ]),
  target: z.string().default(""),
  policy: z.string().min(1),
  noResolve: z.boolean().default(false),
  note: z.string().default(""),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type CustomRule = z.infer<typeof customRuleSchema>;

export const ruleProviderDraftSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  mode: z.enum(["structured", "raw"]).default("structured"),
  behavior: z.enum(["classical", "domain", "ipcidr"]).default("classical"),
  format: z.enum(["yaml", "text"]).default("yaml"),
  url: z.string().default(""),
  interval: z.number().int().positive().default(3600),
  path: z.string().default(""),
  rawYaml: z.string().default(""),
  policy: z.string().min(1).default("FINAL"),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export type RuleProviderDraft = z.infer<typeof ruleProviderDraftSchema>;

export const proxyGroupMemberSchema = z.object({
  kind: z.enum(["proxy", "sourceGroup", "regionGroup", "group", "special"]),
  value: z.string().min(1),
});

export type ProxyGroupMember = z.infer<typeof proxyGroupMemberSchema>;

export const proxyGroupDraftSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  type: z.enum(["select", "url-test", "fallback"]).default("select"),
  url: z.string().default("http://cp.cloudflare.com/generate_204"),
  interval: z.number().int().positive().default(300),
  timeout: z.number().int().positive().default(5000),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  members: z.array(proxyGroupMemberSchema).default([]),
});

export type ProxyGroupDraft = z.infer<typeof proxyGroupDraftSchema>;

export const deviceProfileFragmentKeySchema = z.enum(["root", "profile", "dns", "hosts", "extra"]);

export type DeviceProfileFragmentKey = z.infer<typeof deviceProfileFragmentKeySchema>;

export const deviceProfileFragmentOverrideSchema = z.object({
  key: deviceProfileFragmentKeySchema,
  mode: z.enum(["inherit", "disable", "custom"]).default("inherit"),
  yamlText: z.string().default(""),
});

export type DeviceProfileFragmentOverride = z.infer<typeof deviceProfileFragmentOverrideSchema>;

export const deviceProfileSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  token: z.string().min(8).optional(),
  enabled: z.boolean().default(true),
  filename: z.string().min(1).default("mihomo.yaml"),
  mixedPort: z.number().int().positive().nullable().default(null),
  allowLan: z.boolean().nullable().default(null),
  externalController: z.string().nullable().default(null),
  secret: z.string().nullable().default(null),
  mode: z.string().nullable().default(null),
  fragmentOverrides: z.array(deviceProfileFragmentOverrideSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type DeviceProfile = z.infer<typeof deviceProfileSchema>;

export const appSettingsSchema = z.object({
  id: z.number().int().positive().optional(),
  refreshIntervalMinutes: z.number().int().positive().default(60),
  defaultHealthcheckUrl: z.string().url(),
  fetchProxyUrl: z.string().url().nullable().default(null),
  finalGroupMembers: z.array(proxyGroupMemberSchema).nullable().default(null),
  logLevel: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
  bindHost: z.string().default("127.0.0.1"),
  bindPort: z.number().int().positive().default(36123),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const clashTargetSchema = z.object({
  id: z.number().int().positive().optional(),
  configPath: z.string().min(1),
  controllerUrl: z.string().url(),
  secret: z.string().default(""),
  autoReload: z.boolean().default(false),
  restoreSelectors: z.boolean().default(false),
  mixedPort: z.number().int().positive().default(7890),
  allowLan: z.boolean().default(false),
  externalController: z.string().default("127.0.0.1:9090"),
  mode: z.string().default("Rule"),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ClashTarget = z.infer<typeof clashTargetSchema>;

export const configFragmentSchema = z.object({
  id: z.number().int().positive().optional(),
  key: z.string().min(1),
  yamlText: z.string().default(""),
  enabled: z.boolean().default(true),
});

export type ConfigFragment = z.infer<typeof configFragmentSchema>;

export const sourceSnapshotSchema = z.object({
  id: z.number().int().positive().optional(),
  sourceId: z.number().int().positive(),
  status: z.enum(["success", "error"]),
  rawYaml: z.string().nullable(),
  proxies: z.array(parsedProxySchema),
  error: z.string().nullable(),
  fetchedAt: z.string(),
});

export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

export const jobRunSchema = z.object({
  id: z.number().int().positive().optional(),
  jobType: z.enum(["refresh_sources", "build_config", "build_and_apply_config"]),
  status: z.enum(["running", "success", "error"]),
  details: z.record(z.string(), z.unknown()).default({}),
  error: z.string().nullable().default(null),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export type JobRun = z.infer<typeof jobRunSchema>;

export const compileConfigInputSchema = z.object({
  appSettings: appSettingsSchema,
  clashTarget: clashTargetSchema,
  sources: z.array(subscriptionSourceSchema),
  snapshots: z.array(sourceSnapshotSchema),
  regionRules: z.array(regionRuleSchema),
  customRules: z.array(customRuleSchema),
  ruleProviders: z.array(ruleProviderDraftSchema),
  proxyGroups: z.array(proxyGroupDraftSchema),
  configFragments: z.array(configFragmentSchema),
  deviceProfile: deviceProfileSchema.nullable().default(null),
});

export type CompileConfigInput = z.infer<typeof compileConfigInputSchema>;

export const compiledConfigStatsSchema = z.object({
  sourceCount: z.number().int().nonnegative(),
  proxyCount: z.number().int().nonnegative(),
  regionCounts: z.record(z.string(), z.number().int().nonnegative()),
  groupCount: z.number().int().nonnegative(),
  ruleCount: z.number().int().nonnegative(),
});

export type CompiledConfigStats = z.infer<typeof compiledConfigStatsSchema>;

export const compiledConfigResultSchema = z.object({
  yaml: z.string().min(1),
  config: z.record(z.string(), z.unknown()),
  stats: compiledConfigStatsSchema,
  warnings: z.array(z.string()),
});

export type CompiledConfigResult = z.infer<typeof compiledConfigResultSchema>;

export const configBundleDataSchema = z.object({
  appSettings: appSettingsSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  clashTarget: clashTargetSchema.omit({ id: true, createdAt: true, updatedAt: true }),
  sources: z.array(subscriptionSourceSchema.omit({ id: true, createdAt: true, updatedAt: true })),
  regionRules: z.array(regionRuleSchema.omit({ id: true })),
  customRules: z.array(customRuleSchema.omit({ id: true })),
  ruleProviders: z.array(ruleProviderDraftSchema.omit({ id: true })),
  proxyGroups: z.array(proxyGroupDraftSchema.omit({ id: true })),
  configFragments: z.array(configFragmentSchema.omit({ id: true })),
  deviceProfiles: z.array(deviceProfileSchema.omit({ id: true, createdAt: true, updatedAt: true })),
});

export const configBundleSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().min(1),
  data: configBundleDataSchema,
});

export type ConfigBundleData = z.infer<typeof configBundleDataSchema>;
export type ConfigBundle = z.infer<typeof configBundleSchema>;

export function sortByOrder<T extends { sortOrder?: number | null }>(items: T[]): T[] {
  return [...items].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}
