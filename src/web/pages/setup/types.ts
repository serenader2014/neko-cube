import type { DeviceProfile, JobRun, SubscriptionSource } from "@shared/types";

export type SetupStepId = "welcome" | "sources" | "target" | "launch";

export type SetupStepDefinition = {
  id: SetupStepId;
  title: string;
  description: string;
};

export type SetupSourceSnapshot = {
  status: "success" | "error";
  fetchedAt: string;
  proxyCount: number;
  error: string | null;
};

export type SetupSourceItem = SubscriptionSource & {
  latestSnapshot: SetupSourceSnapshot | null;
};

export type SetupDashboardData = {
  runtime: {
    localDevMode: boolean;
    devMihomoMode: boolean;
    schedulerEnabled: boolean;
    safeApplyMode: boolean;
    dataDir: string;
  };
  sources: SetupSourceItem[];
  recentJobs: JobRun[];
  deviceProfiles: DeviceProfile[];
};

export type ControllerTestResult = {
  connected: boolean;
  detail: string;
};
