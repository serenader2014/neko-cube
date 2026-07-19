import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appSettingsTable = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  refreshIntervalMinutes: integer("refresh_interval_minutes").notNull(),
  defaultHealthcheckUrl: text("default_healthcheck_url").notNull(),
  fetchProxyUrl: text("fetch_proxy_url"),
  finalGroupMembersJson: text("final_group_members_json"),
  logLevel: text("log_level").notNull(),
  bindHost: text("bind_host").notNull(),
  bindPort: integer("bind_port").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const clashTargetTable = sqliteTable("clash_target", {
  id: integer("id").primaryKey(),
  configPath: text("config_path").notNull(),
  controllerUrl: text("controller_url").notNull(),
  secret: text("secret").notNull(),
  autoReload: integer("auto_reload", { mode: "boolean" }).notNull(),
  restoreSelectors: integer("restore_selectors", { mode: "boolean" }).notNull(),
  mixedPort: integer("mixed_port").notNull(),
  allowLan: integer("allow_lan", { mode: "boolean" }).notNull(),
  externalController: text("external_controller").notNull(),
  mode: text("mode").notNull(),
  lastAppliedHash: text("last_applied_hash"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceSubscriptionTable = sqliteTable("source_subscription", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  refreshIntervalMinutes: integer("refresh_interval_minutes"),
  prefixStrategy: text("prefix_strategy").notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sourceSnapshotTable = sqliteTable("source_snapshot", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull(),
  status: text("status").notNull(),
  rawYaml: text("raw_yaml"),
  proxiesJson: text("proxies_json").notNull(),
  error: text("error"),
  fetchedAt: text("fetched_at").notNull(),
});

export const regionRuleTable = sqliteTable("region_rule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  keywordsJson: text("keywords_json").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const ruleProviderTable = sqliteTable("rule_provider", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  behavior: text("behavior").notNull(),
  format: text("format").notNull(),
  url: text("url").notNull(),
  interval: integer("interval").notNull(),
  path: text("path").notNull(),
  rawYaml: text("raw_yaml").notNull(),
  policy: text("policy").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const customRuleTable = sqliteTable("custom_rule", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  target: text("target").notNull(),
  policy: text("policy").notNull(),
  noResolve: integer("no_resolve", { mode: "boolean" }).notNull(),
  note: text("note").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const proxyGroupTable = sqliteTable("proxy_group", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  url: text("url").notNull(),
  interval: integer("interval").notNull(),
  timeout: integer("timeout").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  membersJson: text("members_json").notNull(),
});

export const configFragmentTable = sqliteTable("config_fragment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  yamlText: text("yaml_text").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
});

export const deviceProfileTable = sqliteTable("device_profile", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  token: text("token").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  filename: text("filename").notNull(),
  mixedPort: integer("mixed_port"),
  allowLan: integer("allow_lan", { mode: "boolean" }),
  externalController: text("external_controller"),
  secret: text("secret"),
  mode: text("mode"),
  fragmentOverridesJson: text("fragment_overrides_json"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const jobRunTable = sqliteTable("job_run", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type").notNull(),
  status: text("status").notNull(),
  detailsJson: text("details_json").notNull(),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

export const telemetrySettingsTable = sqliteTable("telemetry_settings", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  querySource: text("query_source").notNull(),
  minuteRetentionDays: integer("minute_retention_days").notNull(),
  hourlyRetentionDays: integer("hourly_retention_days").notNull(),
  realtimeBufferMinutes: integer("realtime_buffer_minutes").notNull(),
  maxLiveLogs: integer("max_live_logs").notNull(),
  maxLiveConnections: integer("max_live_connections").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const proxyProbeSettingsTable = sqliteTable("proxy_probe_settings", {
  id: integer("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  intervalSeconds: integer("interval_seconds").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  concurrency: integer("concurrency").notNull(),
  burstCount: integer("burst_count").notNull(),
  burstGapMs: integer("burst_gap_ms").notNull(),
  includeFirstSampleInStats: integer("include_first_sample_in_stats", { mode: "boolean" }).notNull(),
  probeUrl: text("probe_url").notNull(),
  nodeFilterMode: text("node_filter_mode").notNull(),
  nodeFilterNamesJson: text("node_filter_names_json").notNull(),
  nodeFilterIncludeNamesJson: text("node_filter_include_names_json").notNull(),
  nodeFilterExcludeNamesJson: text("node_filter_exclude_names_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const proxyDelayProbeSampleTable = sqliteTable("proxy_delay_probe_samples", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetKey: text("target_key").notNull(),
  proxyName: text("proxy_name").notNull(),
  proxyType: text("proxy_type").notNull(),
  roundId: text("round_id").notNull(),
  roundStartedAt: text("round_started_at").notNull(),
  testedAt: text("tested_at").notNull(),
  probeUrl: text("probe_url").notNull(),
  delayMs: integer("delay_ms"),
  success: integer("success", { mode: "boolean" }).notNull(),
  error: text("error"),
});

export const proxyDelayProbeHourlyStatsTable = sqliteTable("proxy_delay_probe_hourly_stats", {
  targetKey: text("target_key").notNull(),
  proxyName: text("proxy_name").notNull(),
  proxyType: text("proxy_type").notNull(),
  hour: text("hour").notNull(),
  latestDelayMs: integer("latest_delay_ms"),
  minDelayMs: integer("min_delay_ms"),
  p50DelayMs: integer("p50_delay_ms"),
  avgDelayMs: integer("avg_delay_ms"),
  p90DelayMs: integer("p90_delay_ms"),
  p95DelayMs: integer("p95_delay_ms"),
  maxDelayMs: integer("max_delay_ms"),
  jitterMs: integer("jitter_ms"),
  successCount: integer("success_count").notNull(),
  failureCount: integer("failure_count").notNull(),
  sampleCount: integer("sample_count").notNull(),
  lastTestedAt: text("last_tested_at"),
  lastError: text("last_error"),
});

export const analyticsMinuteStatsTable = sqliteTable("analytics_minute_stats", {
  targetKey: text("target_key").notNull(),
  minute: text("minute").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
});

export const analyticsHourlyStatsTable = sqliteTable("analytics_hourly_stats", {
  targetKey: text("target_key").notNull(),
  hour: text("hour").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
});

export const analyticsMinuteDimStatsTable = sqliteTable("analytics_minute_dim_stats", {
  targetKey: text("target_key").notNull(),
  minute: text("minute").notNull(),
  domain: text("domain").notNull(),
  destinationIp: text("destination_ip").notNull(),
  sourceIp: text("source_ip").notNull(),
  proxyName: text("proxy_name").notNull(),
  proxyChain: text("proxy_chain").notNull(),
  ruleLabel: text("rule_label").notNull(),
  countryCode: text("country_code").notNull(),
  countryName: text("country_name").notNull(),
  continentCode: text("continent_code").notNull(),
  continentName: text("continent_name").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
});

export const analyticsHourlyDimStatsTable = sqliteTable("analytics_hourly_dim_stats", {
  targetKey: text("target_key").notNull(),
  hour: text("hour").notNull(),
  domain: text("domain").notNull(),
  destinationIp: text("destination_ip").notNull(),
  sourceIp: text("source_ip").notNull(),
  proxyName: text("proxy_name").notNull(),
  proxyChain: text("proxy_chain").notNull(),
  ruleLabel: text("rule_label").notNull(),
  countryCode: text("country_code").notNull(),
  countryName: text("country_name").notNull(),
  continentCode: text("continent_code").notNull(),
  continentName: text("continent_name").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
});

export const analyticsDomainStatsTable = sqliteTable("analytics_domain_stats", {
  targetKey: text("target_key").notNull(),
  domain: text("domain").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
  lastSeen: text("last_seen"),
});

export const analyticsProxyStatsTable = sqliteTable("analytics_proxy_stats", {
  targetKey: text("target_key").notNull(),
  proxyName: text("proxy_name").notNull(),
  proxyChain: text("proxy_chain").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
  lastSeen: text("last_seen"),
});

export const analyticsRuleStatsTable = sqliteTable("analytics_rule_stats", {
  targetKey: text("target_key").notNull(),
  ruleLabel: text("rule_label").notNull(),
  finalProxy: text("final_proxy").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
  lastSeen: text("last_seen"),
});

export const analyticsRegionStatsTable = sqliteTable("analytics_region_stats", {
  targetKey: text("target_key").notNull(),
  countryCode: text("country_code").notNull(),
  countryName: text("country_name").notNull(),
  continentCode: text("continent_code").notNull(),
  continentName: text("continent_name").notNull(),
  uploadBytes: integer("upload_bytes").notNull(),
  downloadBytes: integer("download_bytes").notNull(),
  connectionCount: integer("connection_count").notNull(),
  lastSeen: text("last_seen"),
});
