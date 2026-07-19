import crypto from "node:crypto";
import {
  filterProxyProbeNodesBySettings,
  isProxyNameAllowedByProbeSettings,
  proxyProbeRunRequestSchema,
  proxyProbeRunResultSchema,
  type ProxyDelayProbeSampleInput,
  type ProxyProbeRunRequest,
  type ProxyProbeRunResult,
  type ProxyProbeSettings,
} from "../../shared/probes.js";
import {
  cleanupProxyProbeData,
  getProxyProbeSettings,
  getProxyProbeRecentSamples,
  getProxyProbeSummary,
  getProxyProbeTrend,
  updateProxyProbeSettings,
  writeProxyDelaySamples,
} from "../db/probe-db.js";
import { getAppSettings, type DatabaseContext } from "../db/database.js";
import { getTelemetrySettings } from "../db/telemetry-db.js";
import { parseAnalyticsRange } from "./telemetry-utils.js";
import type { MihomoRuntimeClient } from "./mihomo-runtime-client.js";

type RuntimeState = {
  targetKey: string;
  active: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function summarizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (item !== undefined) {
          await worker(item);
        }
      }
    }),
  );
}

export class ProxyProbeService {
  private state: RuntimeState = { targetKey: "inactive", active: false };
  private started = false;
  private probeTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private runningPromise: Promise<ProxyProbeRunResult> | null = null;

  constructor(
    private context: DatabaseContext,
    private runtimeClient: MihomoRuntimeClient,
  ) {}

  async start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.cleanupTimer = setInterval(() => {
      void this.runCleanup();
    }, 60 * 60 * 1000);
    await this.reschedule();
  }

  async stop() {
    this.started = false;
    this.clearProbeTimer();
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.runningPromise) {
      await this.runningPromise.catch(() => undefined);
    }
  }

  async setRuntimeState(state: RuntimeState) {
    this.state = state;
    await this.reschedule();
  }

  async getSettings() {
    return getProxyProbeSettings(this.context);
  }

  async updateSettings(payload: Partial<ProxyProbeSettings>) {
    const settings = await updateProxyProbeSettings(this.context, payload);
    await this.reschedule();
    return settings;
  }

  async runManual(payload: unknown) {
    const parsed = proxyProbeRunRequestSchema.parse(payload ?? {});
    if (!this.state.active) {
      throw new Error("Proxy probe requires an active Mihomo runtime target.");
    }
    return this.runOnce(parsed, true);
  }

  async getSummary(rawQuery: Record<string, string | undefined>) {
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const settings = await this.getSettings();
    return getProxyProbeSummary(this.context, this.state.targetKey, range, {
      preset: range.preset,
      start: range.start,
      end: range.end,
      limit: rawQuery.limit ? Number(rawQuery.limit) : undefined,
      q: rawQuery.q,
    }, settings);
  }

  async getTrend(proxyName: string, rawQuery: Record<string, string | undefined>) {
    const range = parseAnalyticsRange(rawQuery.preset, rawQuery.start, rawQuery.end);
    const settings = await this.getSettings();
    if (!isProxyNameAllowedByProbeSettings(proxyName, settings)) {
      return {
        proxyName,
        rangeStart: range.start,
        rangeEnd: range.end,
        points: [],
      };
    }
    return getProxyProbeTrend(this.context, this.state.targetKey, proxyName, range, settings);
  }

  async getRecentSamples(proxyName: string, rawQuery: Record<string, string | undefined>) {
    const settings = await this.getSettings();
    if (!isProxyNameAllowedByProbeSettings(proxyName, settings)) {
      return {
        proxyName,
        items: [],
      };
    }
    return getProxyProbeRecentSamples(this.context, this.state.targetKey, proxyName, rawQuery);
  }

  private async reschedule() {
    this.clearProbeTimer();
    if (!this.started || !this.state.active) {
      return;
    }
    const settings = await this.getSettings();
    if (!settings.enabled) {
      return;
    }
    this.probeTimer = setInterval(() => {
      void this.runAuto();
    }, settings.intervalSeconds * 1000);
    void this.runAuto();
  }

  private clearProbeTimer() {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  private async runAuto() {
    if (!this.state.active) {
      return;
    }
    try {
      await this.runOnce({}, false);
    } catch (error) {
      console.warn("[proxy-probe] background probe skipped:", error);
    }
  }

  private async runOnce(request: ProxyProbeRunRequest, manual: boolean): Promise<ProxyProbeRunResult> {
    if (this.runningPromise) {
      if (manual) {
        throw new Error("Proxy probe is already running.");
      }
      return this.runningPromise;
    }

    this.runningPromise = this.executeRun(request);
    try {
      return await this.runningPromise;
    } finally {
      this.runningPromise = null;
    }
  }

  private async executeRun(request: ProxyProbeRunRequest): Promise<ProxyProbeRunResult> {
    const [settings, appSettings] = await Promise.all([this.getSettings(), getAppSettings(this.context)]);
    const targetKey = this.state.targetKey;
    const probeUrl = settings.probeUrl.trim() || appSettings.defaultHealthcheckUrl;
    const roundId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const nodes = filterProxyProbeNodesBySettings(await this.runtimeClient.listProbeNodes(), settings).filter(
      (node) => !request.proxyName || node.name === request.proxyName,
    );
    if (request.proxyName && nodes.length === 0) {
      throw new Error(`Proxy ${request.proxyName} was not found.`);
    }

    const samples: ProxyDelayProbeSampleInput[] = [];
    await mapWithConcurrency(nodes, settings.concurrency, async (node) => {
      for (let index = 0; index < settings.burstCount; index += 1) {
        if (index > 0 && settings.burstGapMs > 0) {
          await sleep(settings.burstGapMs);
        }
        const testedAt = new Date().toISOString();
        try {
          const delayMs = await this.runtimeClient.testProxyDelay(node.name, probeUrl, settings.timeoutMs);
          samples.push({
            targetKey,
            proxyName: node.name,
            proxyType: node.type,
            roundId,
            roundStartedAt: startedAt,
            testedAt,
            probeUrl,
            delayMs,
            success: true,
            error: null,
          });
        } catch (error) {
          samples.push({
            targetKey,
            proxyName: node.name,
            proxyType: node.type,
            roundId,
            roundStartedAt: startedAt,
            testedAt,
            probeUrl,
            delayMs: null,
            success: false,
            error: summarizeError(error),
          });
        }
      }
    });

    await writeProxyDelaySamples(this.context, samples);
    const successCount = samples.filter((sample) => sample.success).length;
    return proxyProbeRunResultSchema.parse({
      roundId,
      startedAt,
      finishedAt: new Date().toISOString(),
      targetCount: nodes.length,
      sampleCount: samples.length,
      successCount,
      failureCount: samples.length - successCount,
    });
  }

  private async runCleanup() {
    const settings = await getTelemetrySettings(this.context);
    await cleanupProxyProbeData(this.context, settings);
  }
}
