import { z } from "zod";
import { analyticsRangePresetSchema } from "./telemetry.js";

export const proxyProbeSettingsSchema = z
  .object({
    id: z.number().int().positive().optional(),
    enabled: z.boolean().default(true),
    intervalSeconds: z.number().int().min(30).max(3600).default(120),
    timeoutMs: z.number().int().min(1000).max(30000).default(5000),
    concurrency: z.number().int().min(1).max(32).default(8),
    burstCount: z.number().int().min(1).max(20).default(5),
    burstGapMs: z.number().int().min(0).max(5000).default(400),
    includeFirstSampleInStats: z.boolean().default(true),
    probeUrl: z.string().trim().default(""),
    nodeFilterMode: z.enum(["all", "include", "exclude"]).default("all"),
    nodeFilterNames: z.array(z.string().trim().min(1)).default([]),
    nodeFilterIncludeNames: z.array(z.string().trim().min(1)).default([]),
    nodeFilterExcludeNames: z.array(z.string().trim().min(1)).default([]),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .refine((value) => value.probeUrl === "" || URL.canParse(value.probeUrl), {
    message: "Probe URL must be empty or a valid URL.",
    path: ["probeUrl"],
  })
  .transform((value) => {
    const legacyNames = normalizeProxyProbeFilterNames(value.nodeFilterNames);
    let nodeFilterIncludeNames = normalizeProxyProbeFilterNames(value.nodeFilterIncludeNames);
    let nodeFilterExcludeNames = normalizeProxyProbeFilterNames(value.nodeFilterExcludeNames);
    if (!nodeFilterIncludeNames.length && !nodeFilterExcludeNames.length && legacyNames.length) {
      if (value.nodeFilterMode === "include") {
        nodeFilterIncludeNames = legacyNames;
      } else if (value.nodeFilterMode === "exclude") {
        nodeFilterExcludeNames = legacyNames;
      }
    }
    const includeSet = new Set(nodeFilterIncludeNames);
    nodeFilterExcludeNames = nodeFilterExcludeNames.filter((name) => !includeSet.has(name));
    const nodeFilterMode = nodeFilterIncludeNames.length ? "include" : nodeFilterExcludeNames.length ? "exclude" : "all";
    const nodeFilterNames = nodeFilterMode === "include" ? nodeFilterIncludeNames : nodeFilterMode === "exclude" ? nodeFilterExcludeNames : [];
    return {
      ...value,
      nodeFilterMode,
      nodeFilterNames,
      nodeFilterIncludeNames,
      nodeFilterExcludeNames,
    };
  });

export type ProxyProbeSettings = z.infer<typeof proxyProbeSettingsSchema>;

export const proxyProbeRunRequestSchema = z.object({
  proxyName: z.string().trim().min(1).optional(),
});

export type ProxyProbeRunRequest = z.infer<typeof proxyProbeRunRequestSchema>;

export const proxyProbeRunResultSchema = z.object({
  roundId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  targetCount: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
});

export type ProxyProbeRunResult = z.infer<typeof proxyProbeRunResultSchema>;

export const proxyProbeQuerySchema = z.object({
  preset: analyticsRangePresetSchema.default("7d"),
  start: z.string().optional(),
  end: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  q: z.string().trim().optional(),
});

export type ProxyProbeQuery = z.infer<typeof proxyProbeQuerySchema>;

export const proxyProbeOverviewSchema = z.object({
  monitoredCount: z.number().int().nonnegative(),
  avgP50DelayMs: z.number().nullable(),
  avgP90DelayMs: z.number().nullable(),
  avgP95DelayMs: z.number().nullable(),
  avgJitterMs: z.number().nullable(),
  successRate: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative(),
  lastTestedAt: z.string().nullable(),
});

export type ProxyProbeOverview = z.infer<typeof proxyProbeOverviewSchema>;

export const proxyProbeSummaryItemSchema = z.object({
  proxyName: z.string().min(1),
  proxyType: z.string().default(""),
  latestDelayMs: z.number().nullable(),
  p50DelayMs: z.number().nullable(),
  avgDelayMs: z.number().nullable(),
  p90DelayMs: z.number().nullable(),
  p95DelayMs: z.number().nullable(),
  jitterMs: z.number().nullable(),
  successRate: z.number().min(0).max(1),
  lossRate: z.number().min(0).max(1),
  sampleCount: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  lastTestedAt: z.string().nullable(),
  lastError: z.string().nullable(),
});

export type ProxyProbeSummaryItem = z.infer<typeof proxyProbeSummaryItemSchema>;

export const proxyProbeSummaryResponseSchema = z.object({
  rangeStart: z.string().min(1),
  rangeEnd: z.string().min(1),
  overview: proxyProbeOverviewSchema,
  items: z.array(proxyProbeSummaryItemSchema),
});

export type ProxyProbeSummaryResponse = z.infer<typeof proxyProbeSummaryResponseSchema>;

export const proxyProbeTrendPointSchema = z.object({
  bucket: z.string().min(1),
  minDelayMs: z.number().nullable(),
  p50DelayMs: z.number().nullable(),
  avgDelayMs: z.number().nullable(),
  p90DelayMs: z.number().nullable(),
  p95DelayMs: z.number().nullable(),
  maxDelayMs: z.number().nullable(),
  jitterMs: z.number().nullable(),
  smokeDelayMs: z.array(z.number()).default([]),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  sampleCount: z.number().int().nonnegative(),
  lossRate: z.number().min(0).max(1),
});

export type ProxyProbeTrendPoint = z.infer<typeof proxyProbeTrendPointSchema>;

export const proxyProbeTrendResponseSchema = z.object({
  proxyName: z.string().min(1),
  rangeStart: z.string().min(1),
  rangeEnd: z.string().min(1),
  points: z.array(proxyProbeTrendPointSchema),
});

export type ProxyProbeTrendResponse = z.infer<typeof proxyProbeTrendResponseSchema>;

export const proxyProbeRecentSamplesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type ProxyProbeRecentSamplesQuery = z.infer<typeof proxyProbeRecentSamplesQuerySchema>;

export const proxyProbeRecentSampleSchema = z.object({
  proxyName: z.string().min(1),
  proxyType: z.string().default(""),
  roundId: z.string().min(1),
  roundStartedAt: z.string().min(1),
  testedAt: z.string().min(1),
  probeUrl: z.string().min(1),
  delayMs: z.number().nullable(),
  success: z.boolean(),
  error: z.string().nullable(),
});

export type ProxyProbeRecentSample = z.infer<typeof proxyProbeRecentSampleSchema>;

export const proxyProbeRecentSamplesResponseSchema = z.object({
  proxyName: z.string().min(1),
  items: z.array(proxyProbeRecentSampleSchema),
});

export type ProxyProbeRecentSamplesResponse = z.infer<typeof proxyProbeRecentSamplesResponseSchema>;

export type ProxyProbeNode = {
  name: string;
  type: string;
};

const BUILTIN_PROXY_PROBE_NODE_NAMES = new Set(["DIRECT", "REJECT", "REJECT-DROP", "PASS", "GLOBAL", "COMPATIBLE"]);
const BUILTIN_PROXY_PROBE_NODE_TYPES = new Set(["direct", "reject", "compatible"]);

export function normalizeProxyProbeFilterNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

export function isBuiltinProxyProbeNode(name: string, type = "") {
  return BUILTIN_PROXY_PROBE_NODE_NAMES.has(name.trim().toUpperCase()) || BUILTIN_PROXY_PROBE_NODE_TYPES.has(type.trim().toLowerCase());
}

export function isProxyNameAllowedByProbeSettings(proxyName: string, settings: ProxyProbeSettings) {
  if (settings.nodeFilterExcludeNames.includes(proxyName)) {
    return false;
  }
  if (settings.nodeFilterIncludeNames.length > 0) {
    return settings.nodeFilterIncludeNames.includes(proxyName);
  }
  return true;
}

export function filterProxyProbeNodesBySettings(nodes: ProxyProbeNode[], settings: ProxyProbeSettings) {
  return nodes.filter((node) => isProxyNameAllowedByProbeSettings(node.name, settings));
}

export type ProxyDelayProbeSampleInput = {
  targetKey: string;
  proxyName: string;
  proxyType: string;
  roundId: string;
  roundStartedAt: string;
  testedAt: string;
  probeUrl: string;
  delayMs: number | null;
  success: boolean;
  error: string | null;
};
