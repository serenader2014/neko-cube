import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { useMutation } from "@tanstack/react-query";
import type {
  RuntimeLogLevel,
  RuntimeOverviewState,
  RuntimeProxyGroup,
  RuntimeSnapshot,
  RuntimeTrafficPoint,
} from "../../../shared/telemetry";

export type StreamState = "connecting" | "connected" | "reconnecting";
export type ConnectionTab = "active" | "closed";
export type ConnectionSortKey = "recent" | "type" | "source" | "host" | "rule" | "chain" | "download" | "upload";
export type ConnectionSortDirection = "desc" | "asc";
export type ConnectionGroupKey = "none" | "type" | "host" | "rule" | "chain" | "source";
export type LogSortKey = "seq" | "level" | "type";
export type LogSortDirection = "desc" | "asc";
export type LogGroupKey = "none" | "level" | "type";

export type RuntimeShellContext = {
  snapshot: RuntimeSnapshot | null;
  overviewState: RuntimeOverviewState | null;
  snapshotError: string | null;
  streamState: StreamState;
  streamNotice: string | null;
  selectedOptions: Record<string, string>;
  setSelectedOptions: Dispatch<SetStateAction<Record<string, string>>>;
  logsPaused: boolean;
  setLogsPaused: Dispatch<SetStateAction<boolean>>;
  selectorMutation: ReturnType<typeof useMutation<RuntimeProxyGroup[], Error, { group: string; name: string }>>;
  proxyDelayMutation: ReturnType<typeof useMutation<RuntimeProxyGroup[], Error, string>>;
  logLevelMutation: ReturnType<typeof useMutation<RuntimeSnapshot, Error, RuntimeLogLevel>>;
  clearLogsMutation: ReturnType<typeof useMutation<void, Error, void>>;
  refreshProxiesMutation: ReturnType<typeof useMutation<RuntimeProxyGroup[], Error, void>>;
};

export type RuntimeNavItem = {
  to: "overview" | "proxies" | "connections" | "logs";
  label: string;
  icon: (active: boolean) => ReactNode;
};

export type RuntimeTrafficChartPoint = RuntimeTrafficPoint & { timestampMs: number };
