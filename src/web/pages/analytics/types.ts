import type { Dispatch, SetStateAction } from "react";
import type { TelemetryQuerySource } from "../../../shared/telemetry";

export type Preset = "1h" | "24h" | "7d" | "custom";
export type SortMode = "traffic" | "connections";
export type DetailMode = "domains" | "ips";
export type TableSortKey = "label" | "download" | "upload" | "connections" | "lastSeen";
export type SortOrder = "asc" | "desc";

export type FlowViewport = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type ProxyProbeSmokeSeriesKey = "median" | "smoke" | "jitterBand" | "fullRange" | "loss";
export type ProxyProbeSmokeSeriesVisibility = Record<ProxyProbeSmokeSeriesKey, boolean>;
export type ProxyProbeSmokeXAxisMode = "time" | "dateTime";

export type GeoPosition = [number, number, ...number[]];
export type GeoRing = GeoPosition[];
export type GeoPolygon = GeoRing[];
export type GeoMultiPolygon = GeoPolygon[];
export type WorldMapFeature = {
  type: "Feature";
  id?: string | number;
  properties?: { name?: string };
  geometry: { type: "Polygon"; coordinates: GeoPolygon } | { type: "MultiPolygon"; coordinates: GeoMultiPolygon };
};
export type WorldMapGeoJson = {
  type: "FeatureCollection";
  features: WorldMapFeature[];
};

export type AnalyticsShellContext = {
  preset: Preset;
  setPreset: Dispatch<SetStateAction<Preset>>;
  customStart: string;
  setCustomStart: Dispatch<SetStateAction<string>>;
  customEnd: string;
  setCustomEnd: Dispatch<SetStateAction<string>>;
  querySource: TelemetryQuerySource;
  setQuerySource: Dispatch<SetStateAction<TelemetryQuerySource>>;
  buildSearch: (limit?: number) => string;
  rangeLabel: string;
};

export type AnalyticsNavRoute = "overview" | "rules" | "domains" | "regions" | "proxies" | "devices" | "probes";
