import type { AnalyticsDimension } from "../../../shared/telemetry";
import type { FlowViewport } from "./types";

export const DIMENSION_LABELS: Record<AnalyticsDimension, string> = {
  domains: "域名",
  proxies: "代理",
  rules: "规则",
  regions: "地区",
  devices: "设备",
};

export const DIMENSION_DESCRIPTIONS: Record<AnalyticsDimension, string> = {
  domains: "查看热门域名或目标 IP 的流量分布。",
  proxies: "查看代理承载、命中域名和目标 IP 的关系。",
  rules: "查看规则命中分布、关联域名和后续承载路径。",
  regions: "查看地区流量分布和区域占比变化。",
  devices: "查看来源设备的流量分布和热点域名。",
};

export const HIDE_DIMENSION_INTRO = new Set<AnalyticsDimension>(["rules", "regions", "proxies", "devices"]);

export const ANALYTICS_COLORS = ["#4a7de0", "#9463e7", "#2f9e73", "#d99636", "#c45a52", "#55a6a6", "#7a5af8", "#9b6a33"];
export const DOWNLOAD_COLOR = "#4a7de0";
export const UPLOAD_COLOR = "#9f63e2";
export const ANALYTICS_WORLD_MAP_NAME = "analytics-world";
export const DEFAULT_FLOW_VIEWPORT: FlowViewport = { zoom: 1, offsetX: 0, offsetY: 0 };
export const FLOW_ZOOM_STEP = 0.15;
export const FLOW_PAN_STEP = 56;
export const FLOW_MIN_ZOOM = 0.65;
export const FLOW_MAX_ZOOM = 2.2;
export const FLOW_MAX_OFFSET_X = 260;
export const FLOW_MAX_OFFSET_Y = 180;
export const COUNTRY_NAME_MAPPING: Record<string, string> = {
  US: "United States of America",
  GB: "United Kingdom",
  KR: "South Korea",
  RU: "Russia",
};
export const englishRegionNames =
  typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
