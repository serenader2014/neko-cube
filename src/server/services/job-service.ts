import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { compileClashConfig } from "../../shared/compile.js";
import { exportSubscriptionDocument, type SubscriptionDocument } from "../../shared/subscription-export.js";
import { exportClientProfileDocument } from "../../shared/subscription-profile-export.js";
import {
  buildSubscriptionRuleSetPath,
  type SubscriptionClientId,
  type SubscriptionKind,
  type SubscriptionRuleClientId,
} from "../../shared/subscription-clients.js";
import {
  exportRuleSetDocument,
  readRuleProviderSource,
  type RuleSetDocument,
} from "../../shared/subscription-rule-export.js";
import { parseClashSubscription } from "../../shared/subscription.js";
import type { DeviceProfile } from "../../shared/types.js";
import {
  finishJobRun,
  getAppSettings,
  getClashTarget,
  getDeviceProfileByToken,
  getSource,
  insertSnapshot,
  listSources,
  loadCompileInput,
  startJobRun,
  type DatabaseContext,
} from "../db/database.js";
import { fetchRemoteText, type ProxyFetch } from "./remote-text-fetcher.js";
import { createRuleProviderCache } from "./rule-provider-cache.js";

type SelectorSnapshot = Array<{ proxy: string; name: string }>;

export type JobService = ReturnType<typeof createJobService>;
type JobServiceDeps = {
  proxyFetch?: ProxyFetch;
  now?: () => number;
};

function nowIso() {
  return new Date().toISOString();
}

function buildControllerHeaders(secret: string, headers: Record<string, string> = {}) {
  const normalizedSecret = secret.trim();

  return normalizedSecret
    ? {
        ...headers,
        Authorization: `Bearer ${normalizedSecret}`,
      }
    : headers;
}

async function writeConfigFile(targetPath: string, yamlText: string) {
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, yamlText, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write compiled config to ${targetPath}: ${message}`);
  }
}

async function readSelectors(target: Awaited<ReturnType<typeof getClashTarget>>): Promise<SelectorSnapshot> {
  const response = await fetch(`${target.controllerUrl}/proxies`, {
    headers: buildControllerHeaders(target.secret),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Failed to read Mihomo selectors: HTTP 401，请检查 Controller Secret。"
        : `Failed to read Mihomo selectors: HTTP ${response.status}`,
    );
  }

  const body = (await response.json()) as { proxies?: Record<string, { type?: string; now?: string }> };
  const selectors = body.proxies ?? {};

  return Object.keys(selectors)
    .filter((name) => selectors[name]?.type === "Selector")
    .map((name) => ({
      proxy: name,
      name: selectors[name]?.now ?? "DIRECT",
    }));
}

async function restoreSelectors(
  target: Awaited<ReturnType<typeof getClashTarget>>,
  selectors: SelectorSnapshot,
): Promise<void> {
  for (const selector of selectors) {
    await fetch(`${target.controllerUrl}/proxies/${encodeURIComponent(selector.proxy)}`, {
      method: "PUT",
      headers: buildControllerHeaders(target.secret, {
        "content-type": "application/json",
      }),
      body: JSON.stringify({ name: selector.name }),
      signal: AbortSignal.timeout(10_000),
    });
  }
}

async function reloadClash(target: Awaited<ReturnType<typeof getClashTarget>>): Promise<void> {
  const response = await fetch(`${target.controllerUrl}/configs?force=true`, {
    method: "PUT",
    headers: buildControllerHeaders(target.secret, {
      "content-type": "application/json",
    }),
    body: JSON.stringify({ path: target.configPath }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const details = (await response.text()).trim();
    throw new Error(
      response.status === 401
        ? "Failed to reload Mihomo config: HTTP 401，请检查 Controller Secret。"
        : response.status === 400
          ? `Failed to reload Mihomo config: HTTP 400${details ? `，${details}` : "，请检查 configPath 是否可被 controller 访问，或 Mihomo 的 SAFE_PATHS 配置。"}`
          : `Failed to reload Mihomo config: HTTP ${response.status}${details ? `，${details}` : ""}`,
    );
  }
}

export function createJobService(context: DatabaseContext, deps: JobServiceDeps = {}) {
  let running = false;
  const proxyFetch = deps.proxyFetch;
  const ruleProviderCache = createRuleProviderCache(
    (url, proxyUrl) => fetchRemoteText(url, proxyUrl, proxyFetch),
    deps.now,
  );

  async function refreshSource(sourceId: number) {
    const source = await getSource(context, sourceId);
    if (!source) {
      throw new Error(`Source ${sourceId} not found`);
    }
    const settings = await getAppSettings(context);

    try {
      const rawYaml = await fetchRemoteText(source.url, settings.fetchProxyUrl, proxyFetch);
      const parsed = parseClashSubscription(rawYaml);

      return insertSnapshot(context, {
        sourceId,
        status: "success",
        rawYaml,
        proxies: parsed.proxies,
        error: null,
        fetchedAt: nowIso(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await insertSnapshot(context, {
        sourceId,
        status: "error",
        rawYaml: null,
        proxies: [],
        error: message,
        fetchedAt: nowIso(),
      });
      throw error;
    }
  }

  async function refreshAllSources() {
    const jobId = await startJobRun(context, "refresh_sources");
    const sources = await listSources(context);
    const settings = await getAppSettings(context);
    const results: Array<{ sourceId: number; name: string; status: "success" | "error"; proxyCount: number; error?: string }> =
      [];

    try {
      for (const source of sources.filter((item) => item.enabled)) {
        try {
          const rawYaml = await fetchRemoteText(source.url, settings.fetchProxyUrl, proxyFetch);
          const parsed = parseClashSubscription(rawYaml);
          await insertSnapshot(context, {
            sourceId: source.id!,
            status: "success",
            rawYaml,
            proxies: parsed.proxies,
            error: null,
            fetchedAt: nowIso(),
          });
          results.push({
            sourceId: source.id!,
            name: source.name,
            status: "success",
            proxyCount: parsed.proxies.length,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await insertSnapshot(context, {
            sourceId: source.id!,
            status: "error",
            rawYaml: null,
            proxies: [],
            error: message,
            fetchedAt: nowIso(),
          });
          results.push({
            sourceId: source.id!,
            name: source.name,
            status: "error",
            proxyCount: 0,
            error: message,
          });
        }
      }

      await finishJobRun(context, jobId, "success", { results }, null);
      return results;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishJobRun(context, jobId, "error", { results }, message);
      throw error;
    }
  }

  async function buildCompiledConfig(deviceProfile: DeviceProfile | null = null) {
    const input = await loadCompileInput(context);
    return compileClashConfig({
      ...input,
      deviceProfile,
    });
  }

  async function buildConfig() {
    const jobId = await startJobRun(context, "build_config");
    try {
      const compiled = await buildCompiledConfig();
      await writeConfigFile(context.paths.latestConfigFile, compiled.yaml);
      await finishJobRun(context, jobId, "success", { stats: compiled.stats, warnings: compiled.warnings }, null);
      return compiled;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishJobRun(context, jobId, "error", {}, message);
      throw error;
    }
  }

  async function buildAndApplyConfig() {
    if (running) {
      throw new Error("A job is already running");
    }

    running = true;
    const jobId = await startJobRun(context, "build_and_apply_config");

    try {
      await refreshAllSources();
      const compiled = await buildCompiledConfig();
      await writeConfigFile(context.paths.latestConfigFile, compiled.yaml);

      const clashTarget = await getClashTarget(context);
      let selectorSnapshot: SelectorSnapshot = [];

      if (!context.runtime.safeApplyMode && clashTarget.restoreSelectors) {
        selectorSnapshot = await readSelectors(clashTarget);
      }

      await writeConfigFile(clashTarget.configPath, compiled.yaml);

      if (!context.runtime.safeApplyMode && clashTarget.autoReload) {
        await reloadClash(clashTarget);
      }

      if (!context.runtime.safeApplyMode && clashTarget.restoreSelectors && selectorSnapshot.length > 0) {
        await restoreSelectors(clashTarget, selectorSnapshot);
      }

      await writeConfigFile(context.paths.lastSuccessfulConfigFile, compiled.yaml);

      const hash = crypto.createHash("sha256").update(compiled.yaml).digest("hex");
      await finishJobRun(
        context,
        jobId,
        "success",
        {
          stats: compiled.stats,
          warnings: compiled.warnings,
          hash,
          applyMode: context.runtime.safeApplyMode ? "safe-dev" : "live",
        },
        null,
      );

      return compiled;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishJobRun(context, jobId, "error", {}, message);
      throw error;
    } finally {
      running = false;
    }
  }

  async function getSubscriptionYaml(token: string) {
    const deviceProfile = await getDeviceProfileByToken(context, token);
    if (!deviceProfile || !deviceProfile.enabled) {
      return null;
    }

    return buildCompiledConfig(deviceProfile);
  }

  async function getSubscriptionDocument(
    token: string,
    client: SubscriptionClientId,
    kind: SubscriptionKind,
    subscriptionOrigin = "",
  ): Promise<SubscriptionDocument | null> {
    const deviceProfile = await getDeviceProfileByToken(context, token);
    if (!deviceProfile || !deviceProfile.enabled) {
      return null;
    }

    const compiled = await buildCompiledConfig(deviceProfile);
    if (client === "mihomo" && kind === "profile") {
      return {
        client,
        kind,
        content: compiled.yaml,
        contentType: "application/yaml; charset=utf-8",
        filename: deviceProfile.filename,
        proxyCount: compiled.stats.proxyCount,
        skippedCount: 0,
        warnings: compiled.warnings,
      };
    }

    if (client === "mihomo") {
      const proxies = Array.isArray(compiled.config.proxies) ? compiled.config.proxies : [];
      return {
        client,
        kind,
        content: yaml.dump({ proxies }, { noRefs: true, lineWidth: 120 }),
        contentType: "application/yaml; charset=utf-8",
        filename: "mihomo-nodes.yaml",
        proxyCount: proxies.length,
        skippedCount: 0,
        warnings: compiled.warnings,
      };
    }

    if (kind === "profile") {
      const options = subscriptionOrigin
        ? {
            ruleSetUrl: (providerName: string) =>
              `${subscriptionOrigin.replace(/\/$/, "")}${buildSubscriptionRuleSetPath(token, client, providerName)}`,
          }
        : undefined;
      return exportClientProfileDocument(compiled.config, client, options);
    }

    return exportSubscriptionDocument(compiled.config, client);
  }

  async function getSubscriptionRuleSetDocument(
    token: string,
    client: SubscriptionRuleClientId,
    providerName: string,
  ): Promise<RuleSetDocument | null> {
    const deviceProfile = await getDeviceProfileByToken(context, token);
    if (!deviceProfile || !deviceProfile.enabled) {
      return null;
    }

    const compiled = await buildCompiledConfig(deviceProfile);
    const source = readRuleProviderSource(compiled.config, providerName);
    if (!source) {
      return null;
    }

    const settings = await getAppSettings(context);
    const cached = await ruleProviderCache.get(source, settings.fetchProxyUrl);
    return exportRuleSetDocument(source, cached.content, client, cached.warning ? [cached.warning] : []);
  }

  return {
    refreshSource,
    refreshAllSources,
    previewConfig: buildCompiledConfig,
    buildConfig,
    buildAndApplyConfig,
    getSubscriptionYaml,
    getSubscriptionDocument,
    getSubscriptionRuleSetDocument,
    isRunning: () => running,
  };
}
