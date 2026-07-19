import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import type { ClashTarget, CompiledConfigResult, DeviceProfile, SubscriptionSource } from "@shared/types";
import type { RuntimeSnapshot } from "@shared/telemetry";
import { apiRequest, getErrorMessage, toJsonBody } from "../../lib/api";
import { pushToast } from "../../components/toast";
import { DEFAULT_DEVICE_PROFILE_NAME, SETUP_DASHBOARD_QUERY_KEY } from "./constants";
import { isSetupNeeded, readSetupDismissed } from "./helpers";
import type { ControllerTestResult, SetupDashboardData, SetupSourceSnapshot } from "./types";

export function useSetupDashboard() {
  return useQuery({
    queryKey: SETUP_DASHBOARD_QUERY_KEY,
    queryFn: () => apiRequest<SetupDashboardData>("/api/dashboard"),
  });
}

export function useInvalidateSetupDashboard() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SETUP_DASHBOARD_QUERY_KEY });
}

/**
 * Redirects to /setup once per page load when the database has no usable
 * configuration yet (no sources and no successful build).
 */
export function useSetupGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const hasRedirected = useRef(false);
  const dashboardQuery = useSetupDashboard();
  const dashboard = dashboardQuery.data;
  const onSetupRoute = location.pathname.startsWith("/setup");

  useEffect(() => {
    if (hasRedirected.current || onSetupRoute || !dashboard) {
      return;
    }
    if (isSetupNeeded(dashboard, readSetupDismissed())) {
      hasRedirected.current = true;
      navigate("/setup", { replace: true });
    }
  }, [dashboard, navigate, onSetupRoute]);
}

export function useAddSourceMutation() {
  const invalidate = useInvalidateSetupDashboard();
  return useMutation({
    mutationFn: async (payload: { name: string; url: string }) => {
      const created = await apiRequest<SubscriptionSource>("/api/sources", toJsonBody(payload));
      // Refresh immediately so the wizard can show how many proxies the URL yields.
      // A refresh failure still counts as a successful add — the source exists and
      // can be retried from the list, so the form must not invite a duplicate submit.
      try {
        await apiRequest<SetupSourceSnapshot>(`/api/sources/${created.id}/refresh`, { method: "POST" });
        return { created, refreshError: null as string | null };
      } catch (error) {
        return { created, refreshError: getErrorMessage(error) };
      }
    },
    onSuccess: ({ refreshError }) => {
      if (refreshError) {
        pushToast({ tone: "error", message: `订阅源已保存，但刷新失败：${refreshError}` });
      } else {
        pushToast({ tone: "success", message: "订阅源已添加并刷新成功。" });
      }
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
    onSettled: () => invalidate(),
  });
}

export function useRefreshSourceMutation() {
  const invalidate = useInvalidateSetupDashboard();
  return useMutation({
    mutationFn: (sourceId: number) => apiRequest<SetupSourceSnapshot>(`/api/sources/${sourceId}/refresh`, { method: "POST" }),
    onSuccess: () => pushToast({ tone: "success", message: "订阅源刷新成功。" }),
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
    onSettled: () => invalidate(),
  });
}

export function useDeleteSourceMutation() {
  const invalidate = useInvalidateSetupDashboard();
  return useMutation({
    mutationFn: (sourceId: number) => apiRequest<void>(`/api/sources/${sourceId}`, { method: "DELETE" }),
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
    onSettled: () => invalidate(),
  });
}

export function useClashTargetQuery() {
  return useQuery({
    queryKey: ["setup-clash-target"],
    queryFn: () => apiRequest<ClashTarget>("/api/clash-target"),
  });
}

export function useSaveClashTargetMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: ClashTarget) => apiRequest<ClashTarget>("/api/clash-target", { ...toJsonBody(target), method: "PUT" }),
    onSuccess: (target) => {
      queryClient.setQueryData(["setup-clash-target"], target);
      pushToast({ tone: "success", message: "目标配置已保存。" });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });
}

export function useControllerTestMutation() {
  return useMutation({
    mutationFn: async (): Promise<ControllerTestResult> => {
      const snapshot = await apiRequest<RuntimeSnapshot>("/api/runtime/snapshot");
      return {
        connected: snapshot.health.connected,
        detail: snapshot.health.connected
          ? `已连接 ${snapshot.health.controllerUrl || "控制器"}`
          : snapshot.health.lastError || "控制器尚未连接，请检查地址和密钥。",
      };
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });
}

export function useBuildMutation(apply: boolean) {
  const invalidate = useInvalidateSetupDashboard();
  return useMutation({
    mutationFn: () => apiRequest<CompiledConfigResult>(apply ? "/api/jobs/apply" : "/api/jobs/build", { method: "POST" }),
    onSuccess: () => {
      pushToast({ tone: "success", message: apply ? "构建并应用成功。" : "构建成功。" });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
    onSettled: () => invalidate(),
  });
}

export function useEnsureDeviceProfileMutation() {
  const invalidate = useInvalidateSetupDashboard();
  return useMutation({
    mutationFn: () =>
      apiRequest<DeviceProfile>("/api/device-profiles", toJsonBody({ name: DEFAULT_DEVICE_PROFILE_NAME })),
    onSuccess: () => pushToast({ tone: "success", message: "设备订阅已创建。" }),
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
    onSettled: () => invalidate(),
  });
}

export function useImportBundleMutation(onImported: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bundle: unknown) => apiRequest<unknown>("/api/config-bundle/import", toJsonBody(bundle)),
    onSuccess: () => {
      void queryClient.invalidateQueries();
      pushToast({ tone: "success", message: "备份导入成功，请继续确认目标配置。" });
      onImported();
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });
}
