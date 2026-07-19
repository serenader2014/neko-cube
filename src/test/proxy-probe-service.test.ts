import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CLASH_TARGET } from "../shared/defaults";
import { createDatabase, seedDatabase } from "../server/db/database";
import { getProxyProbeSummary, updateProxyProbeSettings } from "../server/db/probe-db";
import { getRuntimeConfig } from "../server/lib/runtime";
import { MihomoRuntimeClient } from "../server/services/mihomo-runtime-client";
import { ProxyProbeService } from "../server/services/proxy-probe-service";

describe("mihomo runtime probe client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists real probe nodes and measures delay through the controller", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer secret");
      if (url.pathname === "/proxies") {
        return Response.json({
          proxies: {
            Selector: { type: "Selector", all: ["HK 01"] },
            "HK 01": { type: "ss" },
            COMPATIBLE: { type: "Compatible" },
            "compat-node": { type: "compatible" },
            DIRECT: { type: "Direct" },
            REJECT: { type: "Reject" },
          },
        });
      }
      expect(url.pathname).toBe("/proxies/HK%2001/delay");
      expect(url.searchParams.get("url")).toBe("http://cp.cloudflare.com/generate_204");
      expect(url.searchParams.get("timeout")).toBe("5000");
      return Response.json({ delay: 123 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new MihomoRuntimeClient();
    Object.assign(client, {
      target: {
        ...DEFAULT_CLASH_TARGET,
        controllerUrl: "http://127.0.0.1:9090",
        secret: "secret",
      },
    });

    await expect(client.listProbeNodes()).resolves.toEqual([{ name: "HK 01", type: "ss" }]);
    await expect(client.testProxyDelay("HK 01", "http://cp.cloudflare.com/generate_204", 5000)).resolves.toBe(123);
  });
});

describe("proxy probe service", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), "nekocube-probe-service-"));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it("records burst samples and protects against overlapping manual runs", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    await updateProxyProbeSettings(context, {
      burstCount: 2,
      burstGapMs: 0,
      concurrency: 2,
    });

    const delayCalls: string[] = [];
    let releaseDelay: ((value: number) => void) | null = null;
    const runtimeClient = {
      listProbeNodes: vi.fn(async () => [
        { name: "HK-01", type: "ss" },
        { name: "US-01", type: "vmess" },
      ]),
      testProxyDelay: vi.fn(async (name: string) => {
        delayCalls.push(name);
        if (delayCalls.length === 1) {
          return new Promise<number>((resolve) => {
            releaseDelay = resolve;
          });
        }
        if (name === "US-01") {
          throw new Error("timeout");
        }
        return 160;
      }),
    } as unknown as MihomoRuntimeClient;

    const service = new ProxyProbeService(context, runtimeClient);
    await service.setRuntimeState({ targetKey: "alpha", active: true });
    const firstRun = service.runManual({});
    await vi.waitFor(() => expect(delayCalls.length).toBeGreaterThan(0));
    await expect(service.runManual({})).rejects.toThrow(/already running/i);
    releaseDelay?.(120);

    const result = await firstRun;
    expect(result.targetCount).toBe(2);
    expect(result.sampleCount).toBe(4);
    expect(result.failureCount).toBe(2);

    const summary = await getProxyProbeSummary(
      context,
      "alpha",
      {
        start: "2000-01-01T00:00:00.000Z",
        end: "2100-01-01T00:00:00.000Z",
      },
      { preset: "custom", limit: 20 },
    );
    expect(summary.items.find((item) => item.proxyName === "HK-01")?.successCount).toBe(2);
    expect(summary.items.find((item) => item.proxyName === "US-01")?.failureCount).toBe(2);
  });

  it("honors include and exclude probe node filters", async () => {
    const context = createDatabase(getRuntimeConfig({ LOCAL_DEV_MODE: "1" }), cwd);
    await seedDatabase(context);
    const delayCalls: string[] = [];
    const runtimeClient = {
      listProbeNodes: vi.fn(async () => [
        { name: "HK-01", type: "ss" },
        { name: "JP-01", type: "trojan" },
        { name: "US-01", type: "vmess" },
      ]),
      testProxyDelay: vi.fn(async (name: string) => {
        delayCalls.push(name);
        return 120;
      }),
    } as unknown as MihomoRuntimeClient;
    const service = new ProxyProbeService(context, runtimeClient);
    await service.setRuntimeState({ targetKey: "alpha", active: true });

    await updateProxyProbeSettings(context, {
      burstCount: 1,
      nodeFilterIncludeNames: ["HK-01"],
      nodeFilterExcludeNames: ["US-01"],
    });
    await expect(service.runManual({})).resolves.toMatchObject({ targetCount: 1, sampleCount: 1 });
    expect(delayCalls).toEqual(["HK-01"]);

    delayCalls.length = 0;
    await updateProxyProbeSettings(context, {
      nodeFilterIncludeNames: [],
      nodeFilterExcludeNames: ["US-01"],
    });
    await expect(service.runManual({})).resolves.toMatchObject({ targetCount: 2, sampleCount: 2 });
    expect(delayCalls).toEqual(["HK-01", "JP-01"]);
  });
});
