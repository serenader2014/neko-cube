import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fsSync from "node:fs";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import type { MihomoConnection, RuntimeEvent, RuntimeOverviewState, RuntimeSnapshot } from "../shared/telemetry.js";
import type { SubscriptionClientId } from "../shared/subscription-clients.js";
import {
  createCustomRule,
  createDeviceProfile,
  createProxyGroup,
  createRegionRule,
  createRuleProvider,
  createSource,
  deleteCustomRule,
  deleteDeviceProfile,
  deleteProxyGroup,
  deleteRegionRule,
  deleteRuleProvider,
  deleteSource,
  exportConfigBundle,
  getAppSettings,
  getClashTarget,
  getDeviceProfile,
  importConfigBundle,
  listConfigFragments,
  listCustomRules,
  listDeviceProfiles,
  listLatestSnapshotSummaries,
  listProxyGroups,
  listRegionRules,
  listRecentJobRuns,
  listRuleProviders,
  listSnapshots,
  listSources,
  seedDatabase,
  upsertConfigFragment,
  updateAppSettings,
  updateClashTarget,
  updateCustomRule,
  updateDeviceProfile,
  updateProxyGroup,
  updateRegionRule,
  updateRuleProvider,
  updateSource,
  type DatabaseContext,
} from "./db/database.js";
import { createScheduler } from "./services/scheduler.js";
import { createJobService } from "./services/job-service.js";
import { TelemetryService } from "./services/telemetry-service.js";
import { createGeoIpDatabaseUpdater } from "./services/geoip-database-updater.js";
import { getTelemetrySettings } from "./db/telemetry-db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type RuntimeEventSection = "overview" | "proxies" | "connections" | "logs";
type RuntimeEventSender = (type: string, payload: unknown) => void;

function parseRuntimeEventSection(value: string | undefined): RuntimeEventSection {
  return value === "proxies" || value === "connections" || value === "logs" ? value : "overview";
}

function sendScopedRuntimeInitialEvents(sendEvent: RuntimeEventSender, section: RuntimeEventSection, snapshot: RuntimeSnapshot) {
  sendEvent("health", snapshot.health);

  if (section === "overview") {
    sendEvent("traffic", {
      latestTraffic: snapshot.latestTraffic,
      trafficHistory: snapshot.trafficHistory,
      totals: snapshot.totals,
    });
    sendEvent("overview", buildRuntimeOverviewState(snapshot));
    return;
  }

  if (section === "connections") {
    sendEvent("connections", {
      activeConnections: snapshot.activeConnections,
      recentClosedConnections: snapshot.recentClosedConnections,
      totals: snapshot.totals,
      trafficHistory: snapshot.trafficHistory,
    });
    return;
  }

  if (section === "logs") {
    sendEvent("logs", snapshot.logs);
    return;
  }

  sendEvent("proxies", snapshot.proxies);
}

function sendScopedRuntimeEvent(sendEvent: RuntimeEventSender, section: RuntimeEventSection, event: RuntimeEvent) {
  if (event.type === "health") {
    sendEvent(event.type, event.payload);
    return;
  }

  if (event.type === "snapshot") {
    sendScopedRuntimeInitialEvents(sendEvent, section, event.payload as RuntimeSnapshot);
    return;
  }

  if (section === "overview") {
    if (event.type === "traffic") {
      sendEvent("traffic", event.payload);
    } else if (event.type === "connections") {
      sendEvent("overview", buildRuntimeOverviewState(event.payload as Pick<RuntimeSnapshot, "activeConnections" | "recentClosedConnections">));
    }
    return;
  }

  if (section === "connections" && event.type === "connections") {
    sendEvent("connections", event.payload);
    return;
  }

  if (section === "logs" && event.type === "logs") {
    sendEvent("logs", event.payload);
    return;
  }

  if (section === "proxies" && event.type === "proxies") {
    sendEvent("proxies", event.payload);
  }
}

function buildRuntimeOverviewState(state: Pick<RuntimeSnapshot, "activeConnections" | "recentClosedConnections">): RuntimeOverviewState {
  return {
    proxyTraffic: buildRuntimeProxyTraffic(state.activeConnections),
    recentClosedConnections: state.recentClosedConnections.slice(0, 5).map((connection) => ({
      id: connection.id,
      title: getRuntimeConnectionTitle(connection),
      rule: connection.rule || "MATCH",
      chain: connection.chains[0] || "DIRECT",
      totalBytes: connection.download + connection.upload,
      start: connection.start,
    })),
  };
}

function buildRuntimeProxyTraffic(connections: MihomoConnection[]) {
  const groups = new Map<string, { label: string; value: number; connections: number }>();
  for (const connection of connections) {
    const label = connection.chains[0] || "DIRECT";
    const next = groups.get(label) ?? { label, value: 0, connections: 0 };
    next.value += connection.download + connection.upload;
    next.connections += 1;
    groups.set(label, next);
  }
  return [...groups.values()].sort((left, right) => right.value - left.value).slice(0, 5);
}

function getRuntimeConnectionTitle(connection: MihomoConnection) {
  return connection.metadata.host || connection.metadata.sniffHost || connection.metadata.destinationIP || "(unknown)";
}

function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Invalid id");
  }
  return id;
}

function getCorsOriginOption(env: NodeJS.ProcessEnv = process.env): boolean | string[] {
  const rawOrigins = env.NEKOCUBE_CORS_ORIGINS?.trim() || env.CLASH_CONFIG_CORS_ORIGINS?.trim();
  if (!rawOrigins) {
    return false;
  }

  if (rawOrigins === "*") {
    return true;
  }

  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : false;
}

export async function createApp(context: DatabaseContext) {
  await seedDatabase(context);

  const jobs = createJobService(context);
  const scheduler = createScheduler(context, jobs);
  const geoIpDatabaseUpdater = createGeoIpDatabaseUpdater();
  await geoIpDatabaseUpdater.start();
  const telemetry = new TelemetryService(context);
  await telemetry.start();

  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: getCorsOriginOption(),
  });

  const publicDirCandidates = [
    path.resolve(__dirname, "../public"),
    path.resolve(__dirname, "../../public"),
    path.resolve(process.cwd(), "dist/public"),
  ];
  const publicDir = publicDirCandidates.find((candidate) => fsSync.existsSync(candidate)) ?? publicDirCandidates[0];
  await app.register(fastifyStatic, {
    root: path.join(publicDir, "assets"),
    prefix: "/assets/",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: path.join(publicDir, "topojson"),
    prefix: "/topojson/",
    decorateReply: false,
  });

  app.get("/api/dashboard", async (request) => {
    const query = request.query as { includePreview?: string };
    const [sources, snapshotSummaries, jobsList, deviceProfiles] = await Promise.all([
      listSources(context),
      listLatestSnapshotSummaries(context),
      listRecentJobRuns(context, 10),
      listDeviceProfiles(context),
    ]);

    const latestSnapshotBySource = new Map(snapshotSummaries.map((snapshot) => [snapshot.sourceId, snapshot]));

    let preview: Awaited<ReturnType<typeof jobs.buildConfig>> | null = null;
    let previewError: string | null = null;

    if (query.includePreview === "1") {
      try {
        preview = await jobs.previewConfig();
      } catch (error) {
        previewError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      runtime: {
        localDevMode: context.runtime.localDevMode,
        devMihomoMode: context.runtime.devMihomoMode,
        schedulerEnabled: context.runtime.schedulerEnabled,
        safeApplyMode: context.runtime.safeApplyMode,
        dataDir: context.paths.dataDir,
      },
      sources: sources.map((source) => {
        const snapshot = latestSnapshotBySource.get(source.id!);
        return {
          ...source,
          latestSnapshot: snapshot
            ? {
                status: snapshot.status,
                fetchedAt: snapshot.fetchedAt,
                proxyCount: snapshot.proxyCount,
                error: snapshot.error,
              }
            : null,
        };
      }),
      recentJobs: jobsList,
      deviceProfiles,
      previewStats: preview?.stats ?? null,
      previewWarnings: preview?.warnings ?? [],
      previewError,
    };
  });

  app.get("/api/app-settings", async () => getAppSettings(context));
  app.put("/api/app-settings", async (request) => {
    const settings = await updateAppSettings(context, request.body as never);
    await scheduler.reschedule();
    return settings;
  });

  app.get("/api/config-bundle", async () => exportConfigBundle(context));
  app.post("/api/config-bundle/import", async (request) => {
    const bundle = await importConfigBundle(context, request.body as never);
    await scheduler.reschedule();
    return bundle;
  });

  app.get("/api/sources", async () => {
    const [sources, snapshots] = await Promise.all([listSources(context), listSnapshots(context)]);
    const latestSnapshotBySource = new Map<number, (typeof snapshots)[number]>();

    for (const snapshot of snapshots) {
      if (!latestSnapshotBySource.has(snapshot.sourceId)) {
        latestSnapshotBySource.set(snapshot.sourceId, snapshot);
      }
    }

    return sources.map((source) => ({
      ...source,
      latestSnapshot: latestSnapshotBySource.get(source.id!) ?? null,
    }));
  });

  app.post("/api/sources", async (request) => createSource(context, request.body as never));
  app.put("/api/sources/:id", async (request) => updateSource(context, parseId((request.params as { id: string }).id), request.body as never));
  app.delete("/api/sources/:id", async (request, reply) => {
    await deleteSource(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });
  app.post("/api/sources/:id/refresh", async (request) => jobs.refreshSource(parseId((request.params as { id: string }).id)));

  app.get("/api/rule-providers", async () => listRuleProviders(context));
  app.post("/api/rule-providers", async (request) => createRuleProvider(context, request.body as never));
  app.put("/api/rule-providers/:id", async (request) =>
    updateRuleProvider(context, parseId((request.params as { id: string }).id), request.body as never),
  );
  app.delete("/api/rule-providers/:id", async (request, reply) => {
    await deleteRuleProvider(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.get("/api/rules", async () => listCustomRules(context));
  app.post("/api/rules", async (request) => createCustomRule(context, request.body as never));
  app.put("/api/rules/:id", async (request) =>
    updateCustomRule(context, parseId((request.params as { id: string }).id), request.body as never),
  );
  app.delete("/api/rules/:id", async (request, reply) => {
    await deleteCustomRule(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.get("/api/proxy-groups", async () => listProxyGroups(context));
  app.post("/api/proxy-groups", async (request) => createProxyGroup(context, request.body as never));
  app.put("/api/proxy-groups/:id", async (request) =>
    updateProxyGroup(context, parseId((request.params as { id: string }).id), request.body as never),
  );
  app.delete("/api/proxy-groups/:id", async (request, reply) => {
    await deleteProxyGroup(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.get("/api/region-rules", async () => listRegionRules(context));
  app.post("/api/region-rules", async (request) => createRegionRule(context, request.body as never));
  app.put("/api/region-rules/:id", async (request) =>
    updateRegionRule(context, parseId((request.params as { id: string }).id), request.body as never),
  );
  app.delete("/api/region-rules/:id", async (request, reply) => {
    await deleteRegionRule(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });

  app.get("/api/config-fragments", async () => listConfigFragments(context));
  app.put("/api/config-fragments/:key", async (request) =>
    upsertConfigFragment(context, {
      ...(request.body as { yamlText: string; enabled: boolean }),
      key: (request.params as { key: string }).key,
    }),
  );

  app.get("/api/clash-target", async () => getClashTarget(context));
  app.put("/api/clash-target", async (request) => {
    const target = await updateClashTarget(context, request.body as never);
    await telemetry.reloadConfig();
    return target;
  });

  app.get("/api/telemetry-settings", async () => getTelemetrySettings(context));
  app.put("/api/telemetry-settings", async (request) => telemetry.updateTelemetrySettings(request.body as never));

  app.get("/api/proxy-probes/settings", async () => telemetry.getProxyProbeSettings());
  app.put("/api/proxy-probes/settings", async (request) => telemetry.updateProxyProbeSettings(request.body as Record<string, unknown>));
  app.get("/api/proxy-probes/nodes", async () => telemetry.listProxyProbeNodes());
  app.post("/api/proxy-probes/run", async (request) => telemetry.runProxyProbe(request.body));
  app.get("/api/proxy-probes/summary", async (request) =>
    telemetry.getProxyProbeSummary(request.query as Record<string, string | undefined>),
  );
  app.get("/api/proxy-probes/proxies/:proxy/trend", async (request) =>
    telemetry.getProxyProbeTrend(
      (request.params as { proxy: string }).proxy,
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/proxy-probes/proxies/:proxy/samples", async (request) =>
    telemetry.getProxyProbeRecentSamples(
      (request.params as { proxy: string }).proxy,
      request.query as Record<string, string | undefined>,
    ),
  );

  app.get("/api/runtime/snapshot", async () => telemetry.snapshot());
  app.get("/api/runtime/proxies", async () => telemetry.listProxies());
  app.post("/api/runtime/proxies/:group/delay", async (request) => {
    const params = request.params as { group: string };
    return telemetry.testProxyGroup(params.group);
  });
  app.put("/api/runtime/log-level", async (request) => {
    const body = request.body as { level?: string };
    return telemetry.setLogLevel(body.level ?? "info");
  });
  app.delete("/api/runtime/logs", async (_request, reply) => {
    telemetry.clearLogs();
    return reply.code(204).send();
  });
  app.put("/api/runtime/selectors/:group", async (request) => {
    const params = request.params as { group: string };
    const body = request.body as { name?: string };
    if (!body.name) {
      throw new Error("Selector name is required");
    }
    return telemetry.selectProxy(params.group, body.name);
  });
  app.get("/api/runtime/events", async (request, reply) => {
    const section = parseRuntimeEventSection((request.query as { section?: string }).section);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const sendEvent = (type: string, payload: unknown) => {
      reply.raw.write(`event: ${type}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendScopedRuntimeInitialEvents(sendEvent, section, telemetry.snapshot());
    const unsubscribe = telemetry.onRuntimeEvent((event) => {
      sendScopedRuntimeEvent(sendEvent, section, event);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
    }, 15_000);
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return reply.hijack();
  });

  app.get("/api/analytics/summary", async (request) =>
    telemetry.getAnalyticsSummary(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/trend", async (request) =>
    telemetry.getAnalyticsTrend(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/domains", async (request) =>
    telemetry.listDomains(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/proxies", async (request) =>
    telemetry.listProxiesAnalytics(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/rules", async (request) =>
    telemetry.listRules(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/regions", async (request) =>
    telemetry.listRegions(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/devices", async (request) =>
    telemetry.listDevices(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/rules/flow", async (request) =>
    telemetry.getRuleFlow(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/ip-addresses", async (request) =>
    telemetry.listIps(request.query as Record<string, string | undefined>),
  );
  app.get("/api/analytics/domains/:domain/proxies", async (request) =>
    telemetry.getDomainProxies(
      decodeURIComponent((request.params as { domain: string }).domain),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/domains/:domain/ips", async (request) =>
    telemetry.getDomainIps(
      decodeURIComponent((request.params as { domain: string }).domain),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/proxies/:proxy/domains", async (request) =>
    telemetry.getProxyDomains(
      decodeURIComponent((request.params as { proxy: string }).proxy),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/proxies/:proxy/ips", async (request) =>
    telemetry.getProxyIps(
      decodeURIComponent((request.params as { proxy: string }).proxy),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/rules/:rule/domains", async (request) =>
    telemetry.getRuleDomains(
      decodeURIComponent((request.params as { rule: string }).rule),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/rules/:rule/ips", async (request) =>
    telemetry.getRuleIps(
      decodeURIComponent((request.params as { rule: string }).rule),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/devices/:device/domains", async (request) =>
    telemetry.getDeviceDomains(
      decodeURIComponent((request.params as { device: string }).device),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/devices/:device/ips", async (request) =>
    telemetry.getDeviceIps(
      decodeURIComponent((request.params as { device: string }).device),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/ips/:ip/domains", async (request) =>
    telemetry.getIpDomains(
      decodeURIComponent((request.params as { ip: string }).ip),
      request.query as Record<string, string | undefined>,
    ),
  );
  app.get("/api/analytics/ips/:ip/proxies", async (request) =>
    telemetry.getIpProxies(
      decodeURIComponent((request.params as { ip: string }).ip),
      request.query as Record<string, string | undefined>,
    ),
  );

  app.get("/api/device-profiles", async () => listDeviceProfiles(context));
  app.post("/api/device-profiles", async (request) => createDeviceProfile(context, request.body as never));
  app.put("/api/device-profiles/:id", async (request) =>
    updateDeviceProfile(context, parseId((request.params as { id: string }).id), request.body as never),
  );
  app.delete("/api/device-profiles/:id", async (request, reply) => {
    await deleteDeviceProfile(context, parseId((request.params as { id: string }).id));
    return reply.code(204).send();
  });
  app.post("/api/device-profiles/:id/rotate-token", async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    const profile = await getDeviceProfile(context, id);
    if (!profile) {
      return reply.code(404).send({ message: "Device profile not found" });
    }

    return updateDeviceProfile(context, id, {
      ...profile,
      token: crypto.randomUUID().replaceAll("-", ""),
    });
  });

  app.post("/api/jobs/build", async () => jobs.buildConfig());
  app.post("/api/jobs/apply", async () => jobs.buildAndApplyConfig());

  app.get("/api/config/preview", async (request, reply) => {
    const query = request.query as { deviceProfileId?: string };
    if (!query.deviceProfileId) {
      return jobs.previewConfig();
    }

    const deviceProfile = await getDeviceProfile(context, parseId(query.deviceProfileId));
    if (!deviceProfile) {
      return reply.code(404).send({ message: "Device profile not found" });
    }

    const compiled = await jobs.getSubscriptionYaml(deviceProfile.token!);
    if (!compiled) {
      return reply.code(404).send({ message: "Device profile not found" });
    }
    return compiled;
  });

  const sendSubscription = (client: SubscriptionClientId) => {
    return async (request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {
      const document = await jobs.getSubscriptionDocument(request.params.token, client);
      if (!document) {
        return reply.code(404).type("text/plain; charset=utf-8").send("未找到订阅。");
      }

      const safeFilename = document.filename.replace(/["\r\n]/g, "").replace(/[^\x20-\x7e]/g, "_");
      reply.header("cache-control", "no-store");
      reply.header("content-disposition", `inline; filename="${safeFilename}"`);
      return reply.type(document.contentType).send(document.content);
    };
  };

  app.get("/subscriptions/:token/mihomo.yaml", sendSubscription("mihomo"));
  app.get("/subscriptions/:token/clash.yaml", sendSubscription("mihomo"));
  app.get("/subscriptions/:token/surge.conf", sendSubscription("surge"));
  app.get("/subscriptions/:token/quantumult-x.conf", sendSubscription("quantumult-x"));
  app.get("/subscriptions/:token/loon.conf", sendSubscription("loon"));
  app.get("/subscriptions/:token/shadowrocket.txt", sendSubscription("shadowrocket"));

  app.get("/*", async (request, reply) => {
    const indexPath = path.join(publicDir, "index.html");

    try {
      const html = await fs.readFile(indexPath, "utf8");
      reply.type("text/html; charset=utf-8");
      return html;
    } catch {
      return reply.type("text/plain; charset=utf-8").send("Frontend build not found. Run npm run build.");
    }
  });

  app.addHook("onClose", async () => {
    scheduler.stop();
    geoIpDatabaseUpdater.stop();
    await telemetry.stop();
  });

  if (context.runtime.schedulerEnabled) {
    await scheduler.start();
  }

  return app;
}
