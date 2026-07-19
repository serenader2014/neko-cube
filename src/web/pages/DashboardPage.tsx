import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { configBundleSchema, type ConfigBundle } from "@shared/types";
import { apiRequest, getErrorMessage } from "../lib/api";
import { Modal } from "../components/Modal";
import { pushToast } from "../components/toast";

type DashboardResponse = {
  sources: Array<{
    id: number;
    name: string;
    enabled: boolean;
    latestSnapshot: null | {
      status: "success" | "error";
      fetchedAt: string;
      proxyCount: number;
      error: string | null;
    };
  }>;
  recentJobs: Array<{
    id: number;
    jobType: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  }>;
  deviceProfiles: Array<{ id: number; name: string; enabled: boolean }>;
  previewStats: null | {
    sourceCount: number;
    proxyCount: number;
    groupCount: number;
    ruleCount: number;
  };
  previewWarnings: string[];
  previewError: string | null;
};

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiRequest<DashboardResponse>("/api/dashboard"),
  });

  const applyMutation = useMutation({
    mutationFn: () => apiRequest("/api/jobs/apply", { method: "POST" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "已提交生成并应用任务。" });
      await queryClient.invalidateQueries();
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const buildMutation = useMutation({
    mutationFn: () => apiRequest("/api/jobs/build", { method: "POST" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "已提交预览生成任务。" });
      await queryClient.invalidateQueries();
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const exportBundleMutation = useMutation({
    mutationFn: () => apiRequest<ConfigBundle>("/api/config-bundle"),
    onSuccess: (bundle) => {
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = buildBundleFilename(bundle.exportedAt);
      link.click();
      URL.revokeObjectURL(downloadUrl);
      pushToast({ tone: "success", message: "配置包已导出。" });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const importPreview = useMemo(() => {
    const trimmed = importText.trim();
    if (!trimmed) {
      return { error: null, bundle: null as ConfigBundle | null };
    }

    try {
      const parsed = configBundleSchema.parse(JSON.parse(trimmed));
      return { error: null, bundle: parsed };
    } catch (error) {
      return { error: getErrorMessage(error), bundle: null };
    }
  }, [importText]);

  const importBundleMutation = useMutation({
    mutationFn: (bundle: ConfigBundle) =>
      apiRequest<ConfigBundle>("/api/config-bundle/import", {
        method: "POST",
        body: JSON.stringify(bundle),
      }),
    onSuccess: async () => {
      setIsImportModalOpen(false);
      setImportText("");
      pushToast({ tone: "success", message: "配置包已导入，当前配置已替换。" });
      await queryClient.invalidateQueries();
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const data = dashboard.data;
  const sources = data?.sources ?? [];
  const recentJobs = data?.recentJobs ?? [];
  const deviceProfiles = data?.deviceProfiles ?? [];
  const previewWarnings = data?.previewWarnings ?? [];
  const enabledSourceCount = sources.filter((source) => source.enabled).length;
  const enabledDeviceCount = deviceProfiles.filter((device) => device.enabled).length;
  const previewStats = data?.previewStats;

  return (
    <section className="page">
      <div className="metric-grid">
        <article className="panel metric">
          <span className="muted">启用订阅源</span>
          <strong className="value">{enabledSourceCount}</strong>
        </article>
        <article className="panel metric">
          <span className="muted">设备订阅入口</span>
          <strong className="value">{enabledDeviceCount}</strong>
        </article>
        <article className="panel metric">
          <span className="muted">预览节点数</span>
          <strong className="value">{data?.previewStats?.proxyCount ?? 0}</strong>
        </article>
        <article className="panel metric">
          <span className="muted">预览规则数</span>
          <strong className="value">{data?.previewStats?.ruleCount ?? 0}</strong>
        </article>
      </div>

      <div className="two-column">
        <article className="panel">
          <div className="section-header">
            <div>
              <h3>订阅源状态</h3>
              <p className="muted">查看各订阅源的启用状态、节点数量和最近抓取结果。</p>
            </div>
            <span className="chip">{sources.length} 个源</span>
          </div>
          {sources.length ? (
            <div className="card-grid">
              {sources.map((source) => (
                <article className="entity-card" key={source.id}>
                  <div className="entity-card-header">
                    <div>
                      <h4>{source.name}</h4>
                      <p className="muted">
                        {source.enabled ? "当前启用" : "当前停用"}
                        {source.latestSnapshot?.fetchedAt ? ` · ${formatDateTime(source.latestSnapshot.fetchedAt)}` : ""}
                      </p>
                    </div>
                    <div className="entity-card-metrics">
                      <span className={`chip ${source.latestSnapshot?.status === "success" ? "success" : source.latestSnapshot?.status === "error" ? "error" : ""}`}>
                        {formatStatusLabel(source.latestSnapshot?.status)}
                      </span>
                      <span className="metric-badge">{source.latestSnapshot?.proxyCount ?? 0} 节点</span>
                    </div>
                  </div>
                  {source.latestSnapshot?.error ? <div className="fragment-empty">{source.latestSnapshot.error}</div> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>还没有订阅源</strong>
              <p className="muted">先添加一个可用订阅，首页才会有抓取状态和编译结果。</p>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-header">
            <div>
              <h3>最近任务</h3>
              <p className="muted">最近的构建和刷新任务执行记录。</p>
            </div>
            <span className="chip">{recentJobs.length} 条记录</span>
          </div>
          {recentJobs.length ? (
            <div className="structured-list scroll-panel">
              {recentJobs.map((job) => (
                <div className="structured-row" key={job.id}>
                  <div>
                    <strong>{jobTypeLabelMap[job.jobType] ?? job.jobType}</strong>
                    <div className="muted">{formatDateTime(job.startedAt)}</div>
                    {job.error ? <div className="error-detail" title={job.error}>{job.error}</div> : null}
                  </div>
                  <div className="structured-meta">
                    <span className={`chip ${job.status === "success" ? "success" : job.status === "error" ? "error" : ""}`}>
                      {formatStatusLabel(job.status)}
                    </span>
                    <span className="metric-badge">
                      {job.finishedAt ? `耗时 ${formatDuration(job.startedAt, job.finishedAt)}` : "进行中"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>还没有任务记录</strong>
              <p className="muted">执行一次“仅生成预览”或“生成并应用”后，这里会留下最近的运行轨迹。</p>
            </div>
          )}
        </article>
      </div>

      <article className="panel">
        <div className="section-header">
          <div>
            <h3>编译预览</h3>
            <p className="muted">当前编译产物的关键指标和告警信息。</p>
          </div>
          <div className="inline-actions compile-actions">
            {data?.previewError ? <span className="chip error">编译失败</span> : <span className="chip success">可生成</span>}
            <button className="button-secondary" onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending}>
              {buildMutation.isPending ? "正在生成..." : "仅生成预览"}
            </button>
            <button className="button" onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
              {applyMutation.isPending ? "正在应用..." : "生成并应用"}
            </button>
          </div>
        </div>
        <div className="metric-grid compact-metric-grid">
          <article className="panel inset-panel metric">
            <span className="muted">启用源</span>
            <strong className="value">{previewStats?.sourceCount ?? enabledSourceCount}</strong>
          </article>
          <article className="panel inset-panel metric">
            <span className="muted">节点组</span>
            <strong className="value">{previewStats?.groupCount ?? 0}</strong>
          </article>
          <article className="panel inset-panel metric">
            <span className="muted">节点</span>
            <strong className="value">{previewStats?.proxyCount ?? 0}</strong>
          </article>
          <article className="panel inset-panel metric">
            <span className="muted">规则</span>
            <strong className="value">{previewStats?.ruleCount ?? 0}</strong>
          </article>
        </div>
        {data?.previewError ? <div className="fragment-empty">{data.previewError}</div> : null}
        {previewWarnings.length ? (
          <div className="stack">
            {previewWarnings.map((warning) => (
              <div key={warning} className="chip">
                {warning}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact-empty-state">
            <strong>当前没有编译告警</strong>
            <p className="muted">预览结果结构完整，可以直接继续检查分组和目标配置。</p>
          </div>
        )}
      </article>

      <article className="panel">
        <div className="section-header">
          <div>
            <h3>配置迁移</h3>
            <p className="muted">导出当前配置为 JSON 配置包，或从已有配置包整包导入。</p>
          </div>
          <div className="inline-actions">
            <button
              className="button-secondary"
              disabled={exportBundleMutation.isPending}
              onClick={() => exportBundleMutation.mutate()}
              type="button"
            >
              {exportBundleMutation.isPending ? "导出中..." : "导出配置包"}
            </button>
            <button className="button" onClick={() => setIsImportModalOpen(true)} type="button">
              导入配置包
            </button>
          </div>
        </div>
        <div className="summary-grid compact-summary-grid">
          <div className="summary-item">
            <dt>导出范围</dt>
            <dd>订阅源、规则、规则集、分组、片段、设备、服务设置、Mihomo 目标</dd>
          </div>
          <div className="summary-item">
            <dt>不包含</dt>
            <dd>任务记录、订阅抓取快照</dd>
          </div>
          <div className="summary-item">
            <dt>导入模式</dt>
            <dd>整包替换当前配置</dd>
          </div>
        </div>
      </article>

      <Modal
        description="导入会整包替换当前配置，并清空旧的抓取快照与任务记录。建议先导出一份当前配置做备份。"
        onClose={() => {
          setIsImportModalOpen(false);
          setImportText("");
        }}
        open={isImportModalOpen}
        title="导入配置包"
        size="wide"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!importPreview.bundle) {
              return;
            }

            await importBundleMutation.mutateAsync(importPreview.bundle);
          }}
        >
          <div className="section-header">
            <div>
              <h4>选择配置包</h4>
              <p className="muted">支持直接粘贴 JSON，或选择之前导出的 `.json` 文件。</p>
            </div>
            <div className="inline-actions">
              <input
                accept="application/json,.json"
                hidden
                name="configBundleFile"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }

                  setImportText(await file.text());
                  event.target.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
              <button className="button-secondary" onClick={() => fileInputRef.current?.click()} type="button">
                选择文件
              </button>
            </div>
          </div>

          <div className="field">
            <label>配置包 JSON</label>
            <textarea name="configBundleJson" onChange={(event) => setImportText(event.target.value)} value={importText} />
          </div>

          {importPreview.error ? <div className="notice-banner error">{importPreview.error}</div> : null}

          {importPreview.bundle ? (
            <div className="summary-grid compact-summary-grid">
              <div className="summary-item">
                <dt>订阅源</dt>
                <dd>{importPreview.bundle.data.sources.length}</dd>
              </div>
              <div className="summary-item">
                <dt>规则 / 规则集</dt>
                <dd>
                  {importPreview.bundle.data.customRules.length} / {importPreview.bundle.data.ruleProviders.length}
                </dd>
              </div>
              <div className="summary-item">
                <dt>分组 / 片段</dt>
                <dd>
                  {importPreview.bundle.data.proxyGroups.length} / {importPreview.bundle.data.configFragments.length}
                </dd>
              </div>
              <div className="summary-item">
                <dt>设备</dt>
                <dd>{importPreview.bundle.data.deviceProfiles.length}</dd>
              </div>
            </div>
          ) : (
            <div className="empty-state compact-empty-state">
              <strong>还没有可导入的配置包</strong>
              <p className="muted">先选择文件或粘贴 JSON，系统会先做结构校验，再允许导入。</p>
            </div>
          )}

          <div className="modal-actions">
            <button
              className="button-secondary"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportText("");
              }}
              type="button"
            >
              取消
            </button>
            <button className="button" disabled={importBundleMutation.isPending || !importPreview.bundle} type="submit">
              {importBundleMutation.isPending ? "导入中..." : "确认导入并替换"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

const jobTypeLabelMap: Record<string, string> = {
  refresh_sources: "刷新订阅源",
  build_config: "生成预览",
  build_and_apply_config: "生成并应用",
};

function formatStatusLabel(status: string | null | undefined) {
  if (status === "success") {
    return "成功";
  }
  if (status === "error") {
    return "失败";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "pending") {
    return "等待中";
  }
  return "未抓取";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(startedAt: string, finishedAt: string) {
  const seconds = Math.max(1, Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
}

function buildBundleFilename(exportedAt: string) {
  const date = new Date(exportedAt);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ];

  return `mihomo-config-bundle-${parts.join("")}.json`;
}
