import type {
  AppSettings,
  ClashTarget,
  ConfigFragment,
  CustomRule,
  RegionRule,
  RuleProviderDraft,
  SubscriptionSource,
} from "./types.js";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  id: 1,
  refreshIntervalMinutes: 60,
  defaultHealthcheckUrl: "http://cp.cloudflare.com/generate_204",
  fetchProxyUrl: null,
  finalGroupMembers: null,
  logLevel: "info",
  bindHost: "127.0.0.1",
  bindPort: 36123,
};

export const DEFAULT_CLASH_TARGET: ClashTarget = {
  id: 1,
  configPath: "./config.yaml",
  controllerUrl: "http://127.0.0.1:9090",
  secret: "",
  autoReload: false,
  restoreSelectors: false,
  mixedPort: 7890,
  allowLan: false,
  externalController: "127.0.0.1:9090",
  mode: "Rule",
};

export const DEFAULT_SOURCES: SubscriptionSource[] = [];

export const DEFAULT_REGION_RULES: RegionRule[] = [
  { name: "香港", keywords: ["香港", "Hong Kong", "HK", "HongKong", "港"], enabled: true, sortOrder: 10 },
  { name: "台湾", keywords: ["台湾", "Taiwan", "TW", "Taipei", "台"], enabled: true, sortOrder: 20 },
  { name: "新加坡", keywords: ["新加坡", "Singapore", "SG", "Sing"], enabled: true, sortOrder: 30 },
  { name: "日本", keywords: ["日本", "Japan", "JP", "Tokyo", "日"], enabled: true, sortOrder: 40 },
  { name: "美国", keywords: ["美国", "United States", "USA", "US", "America", "美"], enabled: true, sortOrder: 50 },
];

export const DEFAULT_RULE_PROVIDERS: RuleProviderDraft[] = [];

export const DEFAULT_CUSTOM_RULES: CustomRule[] = [];

export const DEFAULT_CONFIG_FRAGMENTS: ConfigFragment[] = [];
