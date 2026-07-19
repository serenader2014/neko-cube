import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sortByOrder, type AppSettings, type SubscriptionSource } from "@shared/types";
import { apiRequest, getErrorMessage } from "../lib/api";
import { Modal } from "../components/Modal";
import { SortListModal } from "../components/SortListModal";
import { StatusSwitch } from "../components/StatusSwitch";
import { pushToast } from "../components/toast";
import { withSequentialSortOrder } from "../lib/sortable";

type SourceItem = SubscriptionSource & {
  latestSnapshot: null | {
    status: "success" | "error";
    fetchedAt: string;
    proxies: Array<{ name: string; type: string }>;
    error: string | null;
  };
};

type SourceFormValues = Omit<SubscriptionSource, "createdAt" | "enabled" | "id" | "updatedAt">;

const emptySource: SourceFormValues = {
  name: "",
  url: "",
  refreshIntervalMinutes: null,
  prefixStrategy: "source-name",
  sortOrder: 100,
};

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isSortModalOpen, setIsSortModalOpen] = useState(false);
  const [togglingSourceId, setTogglingSourceId] = useState<number | null>(null);
  const form = useForm<SourceFormValues>({
    defaultValues: emptySource,
  });

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SourceItem[]>("/api/sources"),
  });
  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiRequest<AppSettings>("/api/app-settings"),
  });
  const globalRefreshMinutes = settingsQuery.data?.refreshIntervalMinutes ?? null;
  const sourceItems = useMemo(() => sortByOrder(Array.isArray(sources.data) ? sources.data : []), [sources.data]);
  const nextSourceSortOrder = useMemo(
    () => sourceItems.reduce((maxSortOrder, source) => Math.max(maxSortOrder, source.sortOrder ?? 0), 0) + 10,
    [sourceItems],
  );

  useEffect(() => {
    if (isEditorOpen) {
      form.reset(
        editing
          ? {
              name: editing.name,
              url: editing.url,
              refreshIntervalMinutes: editing.refreshIntervalMinutes,
              prefixStrategy: editing.prefixStrategy,
              sortOrder: editing.sortOrder,
            }
          : { ...emptySource, sortOrder: nextSourceSortOrder },
      );
    }
  }, [editing, form, isEditorOpen, nextSourceSortOrder]);

  function openCreateModal() {
    setEditing(null);
    setIsEditorOpen(true);
  }

  function openEditModal(source: SourceItem) {
    setEditing(source);
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditing(null);
    form.reset({ ...emptySource, sortOrder: nextSourceSortOrder });
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: SourceFormValues) => {
      const requestBody: SubscriptionSource = {
        ...payload,
        enabled: editing?.enabled ?? true,
        id: editing?.id,
      };

      if (editing?.id) {
        return apiRequest(`/api/sources/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(requestBody),
        });
      }

      return apiRequest("/api/sources", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: editing?.id ? "订阅源已更新。" : "订阅源已创建。" });
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (source: SourceItem) => {
      if (!source.id) {
        return;
      }

      setTogglingSourceId(source.id);
      return apiRequest(`/api/sources/${source.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: source.name,
          url: source.url,
          enabled: !source.enabled,
          refreshIntervalMinutes: source.refreshIntervalMinutes,
          prefixStrategy: source.prefixStrategy,
          sortOrder: source.sortOrder,
        } satisfies SubscriptionSource),
      });
    },
    onSuccess: async (_data, source) => {
      pushToast({ tone: "success", message: `${source.name} 已${source.enabled ? "停用" : "启用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingSourceId(null);
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/sources/${id}/refresh`, { method: "POST" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "已触发订阅刷新。" });
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/sources/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "订阅源已删除。" });
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderedSources: SourceItem[]) => {
      for (const source of withSequentialSortOrder(orderedSources)) {
        if (!source.id) {
          continue;
        }

        await apiRequest(`/api/sources/${source.id}`, {
          method: "PUT",
          body: JSON.stringify({
            name: source.name,
            url: source.url,
            enabled: source.enabled,
            refreshIntervalMinutes: source.refreshIntervalMinutes,
            prefixStrategy: source.prefixStrategy,
            sortOrder: source.sortOrder,
          } satisfies SubscriptionSource),
        });
      }
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "订阅源顺序已更新。" });
      await queryClient.invalidateQueries({ queryKey: ["sources"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  return (
    <section className="page">
      <article className="panel">
        <div className="section-header">
          <div>
            <h3>当前订阅源</h3>
            <p className="muted">各订阅源的状态、节点数量和抓取摘要一览。</p>
          </div>
          <div className="inline-actions">
            <span className="chip">{sourceItems.length} 个源</span>
            {sourceItems.length > 1 ? (
              <button className="button-secondary" onClick={() => setIsSortModalOpen(true)} type="button">
                排序
              </button>
            ) : null}
            <button className="button" onClick={openCreateModal} type="button">
              新增订阅源
            </button>
          </div>
        </div>
        {sourceItems.length ? (
          <div className="card-grid">
            {sourceItems.map((source) => (
              <article className="entity-card" key={source.id}>
                <div className="entity-card-header">
                  <div>
                    <h4>{source.name}</h4>
                    <p className="muted">
                      {source.latestSnapshot?.fetchedAt ? `最近抓取 · ${formatDateTime(source.latestSnapshot.fetchedAt)}` : "还没有抓取记录"}
                    </p>
                  </div>
                  <div className="entity-card-metrics">
                    <StatusSwitch
                      checked={source.enabled}
                      disabled={toggleMutation.isPending && togglingSourceId === source.id}
                      onChange={() => toggleMutation.mutate(source)}
                      title={`切换 ${source.name} 的启用状态`}
                    />
                    <span className={`chip ${source.latestSnapshot?.status === "success" ? "success" : source.latestSnapshot?.status === "error" ? "error" : ""}`}>
                      {formatSourceStatus(source.latestSnapshot?.status)}
                    </span>
                    <span className="metric-badge">{source.latestSnapshot?.proxies?.length ?? 0} 节点</span>
                  </div>
                </div>
                <div className="entity-card-section">
                  <span className="section-label">订阅地址</span>
                  <div className="compact-link-preview" title={source.url}>
                    {source.url}
                  </div>
                </div>
                <div className="summary-grid compact-summary-grid">
                  <div className="summary-item">
                    <dt>前缀策略</dt>
                    <dd>{source.prefixStrategy === "source-name" ? "使用源名前缀" : "不加前缀"}</dd>
                  </div>
                  <div className="summary-item">
                    <dt>刷新间隔</dt>
                    <dd>{source.refreshIntervalMinutes ? `${source.refreshIntervalMinutes} 分钟` : `跟随全局${globalRefreshMinutes ? `（${globalRefreshMinutes} 分钟）` : ""}`}</dd>
                  </div>
                </div>
                {source.latestSnapshot?.error ? <div className="fragment-empty">{source.latestSnapshot.error}</div> : null}
                <div className="entity-card-footer">
                  <div className="inline-actions">
                    <button className="button-secondary" onClick={() => openEditModal(source)} type="button">
                      编辑
                    </button>
                    <button
                      className="button-secondary"
                      disabled={refreshMutation.isPending}
                      onClick={() => source.id && refreshMutation.mutate(source.id)}
                      type="button"
                    >
                      {refreshMutation.isPending ? "刷新中..." : "刷新"}
                    </button>
                    <button
                      className="button-danger"
                      disabled={deleteMutation.isPending}
                      onClick={() => source.id && window.confirm(`确定要删除订阅源「${source.name}」吗？`) && deleteMutation.mutate(source.id)}
                      type="button"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <strong>还没有订阅源</strong>
            <p className="muted">先添加一个可用订阅地址，后续的节点分组、预览和应用配置才会出现内容。</p>
            <button className="button" onClick={openCreateModal} type="button">
              新增订阅源
            </button>
          </div>
        )}
      </article>

      <SortListModal
        description="拖拽调整订阅源的排列顺序。"
        isSaving={reorderMutation.isPending}
        items={sourceItems.map((source) => ({ id: String(source.id), title: source.name }))}
        onClose={() => setIsSortModalOpen(false)}
        onSave={async (items) => {
          const orderedSources = items
            .map((item) => sourceItems.find((source) => String(source.id) === item.id))
            .filter((item): item is SourceItem => Boolean(item));
          await reorderMutation.mutateAsync(orderedSources);
          setIsSortModalOpen(false);
        }}
        open={isSortModalOpen}
        title="排序订阅源"
      />

      <Modal
        description="为每个订阅源维护名称、抓取地址和前缀策略。保存后会立即回到列表。"
        onClose={closeEditor}
        open={isEditorOpen}
        title={editing ? `编辑 ${editing.name}` : "新增订阅源"}
        size="wide"
      >
        <form
          className="stack"
          onSubmit={form.handleSubmit(async (values) => {
            await saveMutation.mutateAsync(values);
          })}
        >
          <input type="hidden" {...form.register("sortOrder", { valueAsNumber: true })} />
          <div className="form-grid">
            <div className="field">
              <label>名称</label>
              <input {...form.register("name", { required: true })} />
            </div>
            <div className="field">
              <label>订阅 URL</label>
              <input {...form.register("url", { required: true })} />
            </div>
            <div className="field">
              <label>前缀策略</label>
              <select {...form.register("prefixStrategy")}>
                <option value="source-name">使用源名前缀</option>
                <option value="none">不加前缀</option>
              </select>
            </div>
            <div className="field">
              <label>刷新间隔（分钟，可空）</label>
              <input
                type="number"
                {...form.register("refreshIntervalMinutes", {
                  setValueAs: (value) => (value === "" ? null : Number(value)),
                })}
              />
            </div>
          </div>
          {editing?.latestSnapshot ? (
            <div className="stack">
              <div className="section-header">
                <h4>最近解析到的节点</h4>
                <span className="chip">{editing.latestSnapshot.proxies.length} 个</span>
              </div>
              <SourceSnapshotPreview snapshot={editing.latestSnapshot} />
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeEditor} type="button">
              取消
            </button>
            <button className="button" disabled={saveMutation.isPending} type="submit">
              {saveMutation.isPending ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

function SourceSnapshotPreview({ snapshot }: { snapshot: SourceItem["latestSnapshot"] }) {
  if (!snapshot?.proxies?.length) {
    return <div className="empty-state compact-empty-state">还没有抓取到节点，可以先执行一次刷新。</div>;
  }

  const typeCounts = snapshot.proxies.reduce<Record<string, number>>((accumulator, proxy) => {
    accumulator[proxy.type] = (accumulator[proxy.type] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <div className="stack">
      <div className="summary-grid compact-summary-grid">
        <div className="summary-item">
          <dt>抓取结果</dt>
          <dd>{formatSourceStatus(snapshot.status)}</dd>
        </div>
        <div className="summary-item">
          <dt>最近刷新</dt>
          <dd>{formatDateTime(snapshot.fetchedAt)}</dd>
        </div>
      </div>
      <div className="filter-bar">
        {Object.entries(typeCounts).map(([type, count]) => (
          <span className="metric-badge" key={type}>
            {type} · {count}
          </span>
        ))}
      </div>
      <div className="structured-list scroll-panel medium-scroll-panel">
        {snapshot.proxies.map((proxy) => (
          <div className="structured-row" key={`${proxy.type}-${proxy.name}`}>
            <div>
              <strong>{proxy.name}</strong>
            </div>
            <div className="structured-meta">
              <span className="metric-badge">{proxy.type}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSourceStatus(status: string | null | undefined) {
  if (status === "success") {
    return "成功";
  }
  if (status === "error") {
    return "失败";
  }
  return "未抓取";
}
