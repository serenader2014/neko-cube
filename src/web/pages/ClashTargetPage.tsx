import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettings, ClashTarget, ConfigFragment } from "@shared/types";
import { apiRequest, getErrorMessage } from "../lib/api";
import { Modal } from "../components/Modal";
import { ConfigFragmentCard } from "../components/ConfigFragmentCard";
import { pushToast } from "../components/toast";
import { HostsEditor } from "../components/StructuredFragmentEditors";
import { buildTextPreview, parseHostsEntries } from "../lib/config-fragments";
import { ProxyProbeSettingsPanel } from "../components/ProxyProbeSettingsPanel";

const fragmentKeys = ["root", "profile", "dns", "hosts", "extra"];

function createEmptyFragment(key: string): ConfigFragment {
  return {
    key,
    yamlText: "",
    enabled: false,
  };
}

function toNullableText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text ? text : null;
}

function normalizeAppSettings(values: AppSettings): AppSettings {
  return {
    ...values,
    fetchProxyUrl: toNullableText(values.fetchProxyUrl),
  };
}

export function ClashTargetPage() {
  const queryClient = useQueryClient();
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [togglingFragmentKey, setTogglingFragmentKey] = useState<string | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiRequest<AppSettings>("/api/app-settings"),
  });
  const targetQuery = useQuery({
    queryKey: ["clash-target"],
    queryFn: () => apiRequest<ClashTarget>("/api/clash-target"),
  });
  const fragmentsQuery = useQuery({
    queryKey: ["config-fragments"],
    queryFn: () => apiRequest<ConfigFragment[]>("/api/config-fragments"),
  });
  const previewQuery = useQuery({
    queryKey: ["config-preview"],
    queryFn: () => apiRequest<{ yaml: string; warnings: string[] }>("/api/config/preview"),
  });

  const settingsForm = useForm<AppSettings>();
  const targetForm = useForm<ClashTarget>();

  useEffect(() => {
    if (settingsQuery.data && isSettingsModalOpen) {
      settingsForm.reset({
        ...settingsQuery.data,
        fetchProxyUrl: settingsQuery.data.fetchProxyUrl ?? "",
      });
    }
  }, [isSettingsModalOpen, settingsForm, settingsQuery.data]);

  useEffect(() => {
    if (targetQuery.data && isTargetModalOpen) {
      targetForm.reset(targetQuery.data);
    }
  }, [isTargetModalOpen, targetForm, targetQuery.data]);

  const editableFragments = useMemo(() => {
    const existing = fragmentsQuery.data?.filter((fragment) => fragmentKeys.includes(fragment.key)) ?? [];

    return fragmentKeys.map((key) => existing.find((fragment) => fragment.key === key) ?? createEmptyFragment(key));
  }, [fragmentsQuery.data]);
  const hostsFragment = editableFragments.find((fragment) => fragment.key === "hosts") ?? null;
  const otherFragments = editableFragments.filter((fragment) => fragment.key !== "hosts");
  const previewWarnings = Array.isArray(previewQuery.data?.warnings) ? previewQuery.data.warnings : [];
  const previewText = previewQuery.data?.yaml ?? "暂无预览";
  const previewLineCount = previewText.split("\n").length;
  const previewExcerpt = isPreviewExpanded ? previewText : buildPreviewExcerpt(previewText, 36);

  const saveSettings = useMutation({
    mutationFn: (payload: AppSettings) =>
      apiRequest("/api/app-settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "服务设置已保存。" });
      setIsSettingsModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const saveTarget = useMutation({
    mutationFn: (payload: ClashTarget) =>
      apiRequest("/api/clash-target", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "Mihomo 目标已保存。" });
      setIsTargetModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["clash-target"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const saveFragment = useMutation({
    mutationFn: (payload: ConfigFragment) =>
      apiRequest(`/api/config-fragments/${payload.key}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "片段已保存。" });
      await queryClient.invalidateQueries({ queryKey: ["config-fragments"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleFragment = useMutation({
    mutationFn: async (payload: ConfigFragment) => {
      setTogglingFragmentKey(payload.key);
      return apiRequest(`/api/config-fragments/${payload.key}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async (_data, payload) => {
      pushToast({
        tone: "success",
        message: `${payload.key === "hosts" ? "域名映射" : payload.key} 已${payload.enabled ? "启用" : "停用"}。`,
      });
      await queryClient.invalidateQueries({ queryKey: ["config-fragments"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingFragmentKey(null);
    },
  });

  return (
    <section className="page">
      <div className="two-column">
        <article className="panel">
          <div className="section-header">
            <div>
              <h3>服务设置</h3>
              <p className="muted">管理服务绑定地址、端口、定时刷新等全局参数。</p>
            </div>
            <button className="button-secondary" onClick={() => setIsSettingsModalOpen(true)} type="button">
              编辑
            </button>
          </div>
          <dl className="summary-grid">
            <div className="summary-item">
              <dt>绑定主机</dt>
              <dd>{settingsQuery.data?.bindHost ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>绑定端口</dt>
              <dd>{settingsQuery.data?.bindPort ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>刷新间隔</dt>
              <dd>{settingsQuery.data?.refreshIntervalMinutes ?? "-"} 分钟</dd>
            </div>
            <div className="summary-item">
              <dt>测速 URL</dt>
              <dd>{settingsQuery.data?.defaultHealthcheckUrl ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>订阅拉取代理</dt>
              <dd>{settingsQuery.data?.fetchProxyUrl ?? "直连"}</dd>
            </div>
            <div className="summary-item">
              <dt>日志级别</dt>
              <dd>{settingsQuery.data?.logLevel ?? "-"}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <div className="section-header">
            <div>
              <h3>Mihomo 目标</h3>
              <p className="muted">配置文件落盘路径、控制器地址与行为开关。</p>
            </div>
            <button className="button-secondary" onClick={() => setIsTargetModalOpen(true)} type="button">
              编辑
            </button>
          </div>
          <dl className="summary-grid">
            <div className="summary-item">
              <dt>配置文件路径</dt>
              <dd>{targetQuery.data?.configPath ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>控制器 URL</dt>
              <dd>{targetQuery.data?.controllerUrl ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>控制器密钥</dt>
              <dd>{targetQuery.data?.secret?.trim() ? "已配置，将用于 reload 和 selector 恢复" : "未配置，调用控制器时不带鉴权"}</dd>
            </div>
            <div className="summary-item">
              <dt>mixed-port</dt>
              <dd>{targetQuery.data?.mixedPort ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>external-controller</dt>
              <dd>{targetQuery.data?.externalController ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>模式</dt>
              <dd>{targetQuery.data?.mode ?? "-"}</dd>
            </div>
            <div className="summary-item">
              <dt>状态</dt>
              <dd className="token-list">
                <span className={`chip ${targetQuery.data?.autoReload ? "success" : ""}`}>
                  {targetQuery.data?.autoReload ? "自动 reload" : "不自动 reload"}
                </span>
                <span className={`chip ${targetQuery.data?.restoreSelectors ? "success" : ""}`}>
                  {targetQuery.data?.restoreSelectors ? "恢复 selector" : "不恢复 selector"}
                </span>
                <span className={`chip ${targetQuery.data?.allowLan ? "success" : ""}`}>
                  {targetQuery.data?.allowLan ? "allow-lan" : "仅本机"}
                </span>
              </dd>
            </div>
          </dl>
        </article>
      </div>

      <ProxyProbeSettingsPanel />

      <article className="panel">
        <div className="section-header">
          <div>
            <h3>静态 YAML 片段</h3>
            <p className="muted">管理 YAML 顶层配置片段，如 DNS、hosts 映射和其他自定义扩展。</p>
          </div>
        </div>
        {hostsFragment ? (
          <div className="stack clash-fragment-stack">
            <ConfigFragmentCard
              description={fragmentDescriptionMap[hostsFragment.key] ?? "静态 YAML 片段"}
              editorHint="逐条维护域名和目标地址，保存时自动写回 `hosts` YAML 映射。"
              fragment={hostsFragment}
              isSaving={saveFragment.isPending}
              isTogglePending={toggleFragment.isPending && togglingFragmentKey === hostsFragment.key}
              key={hostsFragment.key}
              onSave={(value) => saveFragment.mutateAsync(value)}
              onToggleEnabled={(nextEnabled) => toggleFragment.mutateAsync({ ...hostsFragment, enabled: nextEnabled })}
              preview={<HostsPreview text={hostsFragment.yamlText} />}
              renderEditor={({ draft, setDraft }) => (
                <HostsEditor
                  onChange={(yamlText) => setDraft((current) => ({ ...current, yamlText }))}
                  value={draft.yamlText}
                />
              )}
              title="域名映射"
            />
          </div>
        ) : null}
        {otherFragments.length ? (
          <div className="card-grid">
            {otherFragments.map((fragment) => (
              <ConfigFragmentCard
                description={fragmentDescriptionMap[fragment.key] ?? "静态 YAML 片段"}
                editorHint="展示态只显示摘要内容，编辑态保留原始 YAML。"
                fragment={fragment}
                isSaving={saveFragment.isPending}
                isTogglePending={toggleFragment.isPending && togglingFragmentKey === fragment.key}
                key={fragment.key}
                onSave={(value) => saveFragment.mutateAsync(value)}
                onToggleEnabled={(nextEnabled) => toggleFragment.mutateAsync({ ...fragment, enabled: nextEnabled })}
                preview={<pre className="code-block">{buildTextPreview(fragment.yamlText)}</pre>}
                title={fragment.key}
              />
            ))}
          </div>
        ) : null}
      </article>

      <article className="panel">
        <div className="section-header">
          <div>
            <h3>配置预览</h3>
            <p className="muted">查看当前编译产物的 YAML 预览和编译告警。</p>
          </div>
          <div className="inline-actions">
            <span className="metric-badge">{previewLineCount} 行</span>
            <button
              className="button-secondary"
              onClick={() => setIsPreviewExpanded((current) => !current)}
              type="button"
            >
              {isPreviewExpanded ? "收起预览" : "展开全部"}
            </button>
          </div>
        </div>
        <div className="metric-grid compact-metric-grid">
          <article className="panel inset-panel metric">
            <span className="muted">静态片段</span>
            <strong className="value">{editableFragments.filter((fragment) => fragment.enabled).length}</strong>
          </article>
          <article className="panel inset-panel metric">
            <span className="muted">告警</span>
            <strong className="value">{previewWarnings.length}</strong>
          </article>
        </div>
        {previewWarnings.length ? (
          <div className="stack">
            {previewWarnings.map((warning) => (
              <span key={warning} className="chip">
                {warning}
              </span>
            ))}
          </div>
        ) : null}
        <pre className={`code-block preview-shell ${isPreviewExpanded ? "preview-shell-expanded" : ""}`}>{previewExcerpt}</pre>
      </article>

      <Modal
        description="服务设置主要影响 Web 服务监听与默认健康检查策略。"
        onClose={() => setIsSettingsModalOpen(false)}
        open={isSettingsModalOpen}
        title="编辑服务设置"
        size="wide"
      >
        <form className="stack" onSubmit={settingsForm.handleSubmit(async (values) => saveSettings.mutateAsync(normalizeAppSettings(values)))}>
          <div className="form-grid">
            <div className="field">
              <label>绑定主机</label>
              <input {...settingsForm.register("bindHost")} />
            </div>
            <div className="field">
              <label>绑定端口</label>
              <input type="number" {...settingsForm.register("bindPort", { valueAsNumber: true })} />
            </div>
            <div className="field">
              <label>刷新间隔（分钟）</label>
              <input type="number" {...settingsForm.register("refreshIntervalMinutes", { valueAsNumber: true })} />
            </div>
            <div className="field">
              <label>默认测速 URL</label>
              <input {...settingsForm.register("defaultHealthcheckUrl")} />
            </div>
            <div className="field field-span-2">
              <label>订阅拉取 HTTP 代理</label>
              <input placeholder="http://127.0.0.1:7890" {...settingsForm.register("fetchProxyUrl")} />
              <p className="field-hint">留空表示服务端直连拉取订阅源；填写后刷新订阅时会通过这个 HTTP 代理发起请求。</p>
            </div>
          </div>
          <div className="modal-actions">
            <button className="button-secondary" onClick={() => setIsSettingsModalOpen(false)} type="button">
              取消
            </button>
            <button className="button" disabled={saveSettings.isPending} type="submit">
              {saveSettings.isPending ? "保存中..." : "保存服务设置"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="这里维护写回本地 Mihomo 的目标地址和控制器参数。"
        onClose={() => setIsTargetModalOpen(false)}
        open={isTargetModalOpen}
        title="编辑 Mihomo 目标"
        size="wide"
      >
        <form className="stack" onSubmit={targetForm.handleSubmit(async (values) => saveTarget.mutateAsync(values))}>
          <div className="form-grid">
            <div className="field">
              <label>配置文件路径</label>
              <input {...targetForm.register("configPath")} />
            </div>
            <div className="field">
              <label>控制器 URL</label>
              <input {...targetForm.register("controllerUrl")} />
            </div>
            <div className="field">
              <label>控制器密钥</label>
              <input {...targetForm.register("secret")} />
              <p className="field-hint">如果你的 Mihomo 控制器配置了密钥，reload 和 selector 恢复都会用这里的值发起请求。</p>
            </div>
            <div className="field">
              <label>模式</label>
              <input {...targetForm.register("mode")} />
            </div>
            <div className="field">
              <label>mixed-port</label>
              <input type="number" {...targetForm.register("mixedPort", { valueAsNumber: true })} />
            </div>
            <div className="field">
              <label>external-controller</label>
              <input {...targetForm.register("externalController")} />
            </div>
          </div>
          <div className="inline-actions">
            <label className="chip">
              <input type="checkbox" {...targetForm.register("autoReload")} />
              reload Mihomo
            </label>
            <label className="chip">
              <input type="checkbox" {...targetForm.register("restoreSelectors")} />
              恢复 selector
            </label>
            <label className="chip">
              <input type="checkbox" {...targetForm.register("allowLan")} />
              allow-lan
            </label>
          </div>
          <div className="modal-actions">
            <button className="button-secondary" onClick={() => setIsTargetModalOpen(false)} type="button">
              取消
            </button>
            <button className="button" disabled={saveTarget.isPending} type="submit">
              {saveTarget.isPending ? "保存中..." : "保存目标"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}

function buildPreviewExcerpt(text: string, maxLines: number) {
  const lines = text.split("\n");

  if (lines.length <= maxLines) {
    return text;
  }

  return `${lines.slice(0, maxLines).join("\n")}\n\n... 已折叠 ${lines.length - maxLines} 行`;
}

const fragmentDescriptionMap: Record<string, string> = {
  root: "Mihomo 顶层基础配置",
  profile: "profile 节点运行配置",
  dns: "DNS 配置片段",
  hosts: "域名到地址的静态映射",
  extra: "额外附加配置",
};

function HostsPreview({ text }: { text: string }) {
  const result = parseHostsEntries(text);

  if (result.error) {
    return <div className="fragment-empty">hosts 解析失败：{result.error}</div>;
  }

  if (!result.items.length) {
    return <div className="fragment-empty">暂无 hosts 映射</div>;
  }

  return (
    <div className="hosts-preview-grid">
      {result.items.map((entry) => (
        <div className="hosts-preview-card" key={entry.host}>
          <div>
            <strong>{entry.host}</strong>
            <div className="muted">目标地址</div>
          </div>
          <div className="hosts-preview-target">
            <span className="chip">{entry.target}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
