import { z } from "zod";

export const telemetryQuerySourceSchema = z.enum(["auto", "sqlite", "clickhouse"]);
export type TelemetryQuerySource = z.infer<typeof telemetryQuerySourceSchema>;

export const telemetrySettingsSchema = z.object({
  id: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
  querySource: telemetryQuerySourceSchema.default("auto"),
  minuteRetentionDays: z.number().int().positive().default(7),
  hourlyRetentionDays: z.number().int().positive().default(90),
  realtimeBufferMinutes: z.number().int().positive().default(5),
  maxLiveLogs: z.number().int().positive().default(2000),
  maxLiveConnections: z.number().int().positive().default(500),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type TelemetrySettings = z.infer<typeof telemetrySettingsSchema>;

export const mihomoConnectionMetadataSchema = z.object({
  network: z.string().default(""),
  type: z.string().default(""),
  destinationIP: z.string().default(""),
  destinationPort: z.string().default(""),
  dnsMode: z.string().default(""),
  host: z.string().default(""),
  inboundIP: z.string().default(""),
  inboundName: z.string().default(""),
  inboundPort: z.string().default(""),
  inboundUser: z.string().default(""),
  process: z.string().default(""),
  processPath: z.string().default(""),
  remoteDestination: z.string().default(""),
  sniffHost: z.string().default(""),
  sourceIP: z.string().default(""),
  sourcePort: z.string().default(""),
  specialProxy: z.string().default(""),
  specialRules: z.string().default(""),
  uid: z.number().int().default(0),
});

export type MihomoConnectionMetadata = z.infer<typeof mihomoConnectionMetadataSchema>;

export const mihomoConnectionSchema = z.object({
  id: z.string().min(1),
  download: z.number().nonnegative().default(0),
  upload: z.number().nonnegative().default(0),
  chains: z.array(z.string()).default([]),
  rule: z.string().default("MATCH"),
  rulePayload: z.string().default(""),
  start: z.string().default(""),
  metadata: mihomoConnectionMetadataSchema.default({}),
});

export type MihomoConnection = z.infer<typeof mihomoConnectionSchema>;

export const mihomoConnectionsMessageSchema = z.object({
  uploadTotal: z.number().nonnegative().default(0),
  downloadTotal: z.number().nonnegative().default(0),
  connections: z.array(mihomoConnectionSchema).default([]),
});

export type MihomoConnectionsMessage = z.infer<typeof mihomoConnectionsMessageSchema>;

export const mihomoTrafficMessageSchema = z.object({
  up: z.number().nonnegative().default(0),
  down: z.number().nonnegative().default(0),
});

export type MihomoTrafficMessage = z.infer<typeof mihomoTrafficMessageSchema>;

export const runtimeLogLevelSchema = z.enum(["debug", "info", "warning", "error", "silent"]);
export type RuntimeLogLevel = z.infer<typeof runtimeLogLevelSchema>;

export const runtimeLogEntrySchema = z.object({
  id: z.string().min(1),
  type: runtimeLogLevelSchema.or(z.string().min(1)),
  payload: z.string().default(""),
  timestamp: z.string().min(1),
});

export type RuntimeLogEntry = z.infer<typeof runtimeLogEntrySchema>;

export const runtimeTrafficPointSchema = z.object({
  timestamp: z.string().min(1),
  up: z.number().nonnegative(),
  down: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
});

export type RuntimeTrafficPoint = z.infer<typeof runtimeTrafficPointSchema>;

export const runtimeHealthSchema = z.object({
  connected: z.boolean(),
  telemetryActive: z.boolean(),
  targetKey: z.string().min(1),
  controllerUrl: z.string().default(""),
  lastError: z.string().nullable(),
  lastConnectedAt: z.string().nullable(),
  lastEventAt: z.string().nullable(),
  lastProxiesSyncAt: z.string().nullable(),
});

export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;

export const runtimeProxyOptionSchema = z.object({
  name: z.string().min(1),
  type: z.string().default(""),
  alive: z.boolean().nullable().default(null),
  delay: z.number().nullable().default(null),
});

export type RuntimeProxyOption = z.infer<typeof runtimeProxyOptionSchema>;

export const runtimeProxyGroupSchema = z.object({
  name: z.string().min(1),
  type: z.string().default(""),
  now: z.string().default(""),
  all: z.array(z.string()).default([]),
  options: z.array(runtimeProxyOptionSchema).default([]),
});

export type RuntimeProxyGroup = z.infer<typeof runtimeProxyGroupSchema>;

export const runtimeSnapshotSchema = z.object({
  health: runtimeHealthSchema,
  trafficHistory: z.array(runtimeTrafficPointSchema),
  latestTraffic: mihomoTrafficMessageSchema.nullable(),
  totals: z.object({
    uploadTotal: z.number().nonnegative(),
    downloadTotal: z.number().nonnegative(),
    activeConnections: z.number().int().nonnegative(),
  }),
  activeConnections: z.array(mihomoConnectionSchema),
  recentClosedConnections: z.array(mihomoConnectionSchema),
  logs: z.array(runtimeLogEntrySchema),
  logLevel: runtimeLogLevelSchema,
  proxies: z.array(runtimeProxyGroupSchema),
});

export type RuntimeSnapshot = z.infer<typeof runtimeSnapshotSchema>;

export const runtimeOverviewProxyTrafficSchema = z.object({
  label: z.string().min(1),
  value: z.number().nonnegative(),
  connections: z.number().int().nonnegative(),
});

export type RuntimeOverviewProxyTraffic = z.infer<typeof runtimeOverviewProxyTrafficSchema>;

export const runtimeOverviewClosedConnectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rule: z.string().default("MATCH"),
  chain: z.string().default("DIRECT"),
  totalBytes: z.number().nonnegative(),
  start: z.string().default(""),
});

export type RuntimeOverviewClosedConnection = z.infer<typeof runtimeOverviewClosedConnectionSchema>;

export const runtimeOverviewStateSchema = z.object({
  proxyTraffic: z.array(runtimeOverviewProxyTrafficSchema),
  recentClosedConnections: z.array(runtimeOverviewClosedConnectionSchema),
});

export type RuntimeOverviewState = z.infer<typeof runtimeOverviewStateSchema>;

export const runtimeEventSchema = z.object({
  type: z.enum(["health", "traffic", "connections", "logs", "proxies", "snapshot"]),
  payload: z.unknown(),
  timestamp: z.string().min(1),
});

export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

export const analyticsRangePresetSchema = z.enum(["1h", "24h", "7d", "custom"]);
export type AnalyticsRangePreset = z.infer<typeof analyticsRangePresetSchema>;

export const analyticsDimensionSchema = z.enum(["domains", "proxies", "rules", "regions", "devices"]);
export type AnalyticsDimension = z.infer<typeof analyticsDimensionSchema>;

export const analyticsTrendPointSchema = z.object({
  bucket: z.string().min(1),
  uploadBytes: z.number().nonnegative(),
  downloadBytes: z.number().nonnegative(),
  connectionCount: z.number().int().nonnegative(),
});

export type AnalyticsTrendPoint = z.infer<typeof analyticsTrendPointSchema>;

export const analyticsSummarySchema = z.object({
  targetKey: z.string().min(1),
  rangeStart: z.string().min(1),
  rangeEnd: z.string().min(1),
  querySource: telemetryQuerySourceSchema,
  uploadBytes: z.number().nonnegative(),
  downloadBytes: z.number().nonnegative(),
  connectionCount: z.number().int().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;

export const analyticsListItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  uploadBytes: z.number().nonnegative(),
  downloadBytes: z.number().nonnegative(),
  connectionCount: z.number().int().nonnegative(),
  lastSeen: z.string().nullable().default(null),
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type AnalyticsListItem = z.infer<typeof analyticsListItemSchema>;

export const analyticsQuerySchema = z.object({
  preset: analyticsRangePresetSchema.default("7d"),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.number().int().positive().max(200).default(20),
  querySource: telemetryQuerySourceSchema.optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsDetailResponseSchema = z.object({
  items: z.array(analyticsListItemSchema),
  querySource: telemetryQuerySourceSchema,
});

export type AnalyticsDetailResponse = z.infer<typeof analyticsDetailResponseSchema>;

export const analyticsFlowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  layer: z.number().int().nonnegative(),
  nodeType: z.enum(["source", "domain", "rule", "group", "proxy", "direct"]),
  uploadBytes: z.number().nonnegative(),
  downloadBytes: z.number().nonnegative(),
  connectionCount: z.number().int().nonnegative(),
});

export type AnalyticsFlowNode = z.infer<typeof analyticsFlowNodeSchema>;

export const analyticsFlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  uploadBytes: z.number().nonnegative(),
  downloadBytes: z.number().nonnegative(),
  connectionCount: z.number().int().nonnegative(),
});

export type AnalyticsFlowEdge = z.infer<typeof analyticsFlowEdgeSchema>;

export const analyticsRuleFlowResponseSchema = z.object({
  querySource: telemetryQuerySourceSchema,
  nodes: z.array(analyticsFlowNodeSchema),
  edges: z.array(analyticsFlowEdgeSchema),
  maxLayer: z.number().int().nonnegative(),
});

export type AnalyticsRuleFlowResponse = z.infer<typeof analyticsRuleFlowResponseSchema>;
