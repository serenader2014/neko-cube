import { describe, expect, it } from "vitest";
import type { JobRun } from "../shared/types";
import {
  buildSubscriptionUrl,
  getAdjacentStepId,
  hasSuccessfulBuild,
  isSetupNeeded,
} from "../web/pages/setup/helpers";
import type { SetupDashboardData } from "../web/pages/setup/types";

function makeDashboard(overrides: Partial<SetupDashboardData> = {}): SetupDashboardData {
  return {
    runtime: { localDevMode: true, devMihomoMode: false, schedulerEnabled: false, safeApplyMode: true, dataDir: "/tmp" },
    sources: [],
    recentJobs: [],
    deviceProfiles: [],
    ...overrides,
  };
}

function makeJob(overrides: Partial<JobRun> = {}): JobRun {
  return {
    jobType: "build_config",
    status: "success",
    details: {},
    error: null,
    startedAt: "2026-06-11T00:00:00.000Z",
    finishedAt: "2026-06-11T00:00:01.000Z",
    ...overrides,
  };
}

describe("hasSuccessfulBuild", () => {
  it("accepts successful build jobs of both build types", () => {
    expect(hasSuccessfulBuild([makeJob()])).toBe(true);
    expect(hasSuccessfulBuild([makeJob({ jobType: "build_and_apply_config" })])).toBe(true);
  });

  it("ignores failed builds and unrelated jobs", () => {
    expect(hasSuccessfulBuild([])).toBe(false);
    expect(hasSuccessfulBuild([makeJob({ status: "error" })])).toBe(false);
    expect(hasSuccessfulBuild([makeJob({ jobType: "refresh_sources" })])).toBe(false);
  });
});

describe("isSetupNeeded", () => {
  it("requires setup only for an empty database", () => {
    expect(isSetupNeeded(makeDashboard(), false)).toBe(true);
  });

  it("is satisfied once a source exists", () => {
    const dashboard = makeDashboard({
      sources: [
        {
          name: "a",
          url: "https://example.com/sub",
          enabled: true,
          refreshIntervalMinutes: null,
          prefixStrategy: "source-name",
          sortOrder: 0,
          latestSnapshot: null,
        },
      ],
    });
    expect(isSetupNeeded(dashboard, false)).toBe(false);
  });

  it("is satisfied by a past successful build even without sources", () => {
    expect(isSetupNeeded(makeDashboard({ recentJobs: [makeJob()] }), false)).toBe(false);
  });

  it("respects the dismissed flag", () => {
    expect(isSetupNeeded(makeDashboard(), true)).toBe(false);
  });
});

describe("getAdjacentStepId", () => {
  it("walks forward and backward with clamping", () => {
    expect(getAdjacentStepId("welcome", 1)).toBe("sources");
    expect(getAdjacentStepId("sources", -1)).toBe("welcome");
    expect(getAdjacentStepId("welcome", -1)).toBe("welcome");
    expect(getAdjacentStepId("launch", 1)).toBe("launch");
  });
});

describe("buildSubscriptionUrl", () => {
  it("builds client-specific subscription URLs", () => {
    expect(buildSubscriptionUrl("http://127.0.0.1:4000", "abc123")).toBe(
      "http://127.0.0.1:4000/subscriptions/abc123/mihomo.yaml",
    );
    expect(buildSubscriptionUrl("http://127.0.0.1:4000/", "abc123", "surge")).toBe(
      "http://127.0.0.1:4000/subscriptions/abc123/surge.conf",
    );
    expect(buildSubscriptionUrl("http://127.0.0.1:4000", "abc 123", "quantumult-x")).toBe(
      "http://127.0.0.1:4000/subscriptions/abc%20123/quantumult-x.conf",
    );
    expect(buildSubscriptionUrl("http://127.0.0.1:4000", "abc123", "loon")).toBe(
      "http://127.0.0.1:4000/subscriptions/abc123/loon.conf",
    );
    expect(buildSubscriptionUrl("http://127.0.0.1:4000", "abc123", "shadowrocket")).toBe(
      "http://127.0.0.1:4000/subscriptions/abc123/shadowrocket.txt",
    );
  });
});
