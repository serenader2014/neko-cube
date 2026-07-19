import type { MihomoConnection, RuntimeLogEntry, RuntimeLogLevel } from "../../../shared/telemetry";

export const LOG_LEVELS: Array<RuntimeLogLevel | "all"> = ["all", "debug", "info", "warning", "error", "silent"];
export const PROXY_SEGMENT_COLORS = [
  "var(--runtime-good)",
  "var(--runtime-warm)",
  "var(--runtime-hot)",
  "var(--runtime-muted-line)",
];
export const RUNTIME_TRAFFIC_WINDOW_MS = 60_000;
export const RUNTIME_CHART_FRAME_MS = 200;
export const EMPTY_CONNECTIONS: MihomoConnection[] = [];
export const EMPTY_LOGS: RuntimeLogEntry[] = [];
export const RUNTIME_CHART_GRID_COLOR = "rgba(121, 97, 79, 0.14)";
export const RUNTIME_CHART_AXIS_COLOR = "rgba(121, 97, 79, 0.52)";
export const RUNTIME_CHART_TICK_COLOR = "rgba(77, 52, 29, 0.7)";
