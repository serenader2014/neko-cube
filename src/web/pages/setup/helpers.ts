import type { JobRun } from "@shared/types";
import { SETUP_SKIP_STORAGE_KEY, SETUP_STEPS } from "./constants";
import type { SetupDashboardData, SetupStepId } from "./types";

export { buildSubscriptionUrl } from "@web/lib/subscription-links";

export function hasSuccessfulBuild(jobs: JobRun[]) {
  return jobs.some(
    (job) => job.status === "success" && (job.jobType === "build_config" || job.jobType === "build_and_apply_config"),
  );
}

export function isSetupNeeded(dashboard: SetupDashboardData, dismissed: boolean) {
  if (dismissed) {
    return false;
  }
  return dashboard.sources.length === 0 && !hasSuccessfulBuild(dashboard.recentJobs);
}

export function readSetupDismissed() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(SETUP_SKIP_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSetupDismissed() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(SETUP_SKIP_STORAGE_KEY, "1");
  } catch {
    // Storage may be unavailable (private mode); the data-driven check still applies.
  }
}

export function getSetupStepIndex(stepId: SetupStepId) {
  return Math.max(
    0,
    SETUP_STEPS.findIndex((step) => step.id === stepId),
  );
}

export function getAdjacentStepId(stepId: SetupStepId, offset: -1 | 1): SetupStepId {
  const nextIndex = Math.min(SETUP_STEPS.length - 1, Math.max(0, getSetupStepIndex(stepId) + offset));
  return SETUP_STEPS[nextIndex].id;
}

export function summarizeSnapshot(item: { latestSnapshot: { status: string; proxyCount: number; error: string | null } | null }) {
  if (!item.latestSnapshot) {
    return { tone: "muted" as const, text: "尚未刷新" };
  }
  if (item.latestSnapshot.status === "success") {
    return { tone: "success" as const, text: `${item.latestSnapshot.proxyCount} 个节点` };
  }
  return { tone: "error" as const, text: item.latestSnapshot.error || "刷新失败" };
}
