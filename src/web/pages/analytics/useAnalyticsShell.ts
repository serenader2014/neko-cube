import { useOutletContext } from "react-router-dom";
import type { AnalyticsShellContext } from "./types";

export function useAnalyticsShell() {
  return useOutletContext<AnalyticsShellContext>();
}
