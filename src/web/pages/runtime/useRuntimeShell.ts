import { useOutletContext } from "react-router-dom";
import type { RuntimeShellContext } from "./types";

export function useRuntimeShell() {
  return useOutletContext<RuntimeShellContext>();
}
