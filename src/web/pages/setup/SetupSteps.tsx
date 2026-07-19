import { useMemo, useRef, useState, type FormEvent } from "react";
import type { ClashTarget } from "@shared/types";
import { pushToast } from "../../components/toast";
import { StatusSwitch } from "../../components/StatusSwitch";
import { buildSubscriptionUrl, summarizeSnapshot } from "./helpers";
import {
  useAddSourceMutation,
  useBuildMutation,
  useClashTargetQuery,
  useControllerTestMutation,
  useDeleteSourceMutation,
  useEnsureDeviceProfileMutation,
  useImportBundleMutation,
  useRefreshSourceMutation,
  useSaveClashTargetMutation,
} from "./hooks";
import type { SetupDashboardData, SetupSourceItem } from "./types";

export function SetupWelcomeStep({ onStart, onImported }: { onStart: () => void; onImported: () => void }) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importMutation = useImportBundleMutation(onImported);

  async function handleBundleFile(file: File | undefined) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      importMutation.mutate(JSON.parse(text));
    } catch {
      pushToast({ tone: "error", message: "备份文件不是有效的 JSON。" });
    }
  }

  return (
    <div className="setup-step-body">
      <p className="lede">
        首次使用需要三步：添加节点来源、确认写出目标，然后构建第一份配置。整个过程大约两分钟，每一步都可以跳过，之后在「订阅与配置」里随时补齐。
      </p>
      <div className="setup-choice-grid">
        <button className="setup-choice-card" onClick={onStart} type="button">
          <strong>全新配置</strong>
          <span>从添加订阅源开始，逐步完成初始化。</span>
        </button>
        <button
          className="setup-choice-card"
          disabled={importMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <strong>{importMutation.isPending ? "正在导入…" : "导入备份"}</strong>
          <span>已有配置包（config-bundle JSON）？一键恢复订阅源、规则和策略组。</span>
        </button>
      </div>
      <input
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          void handleBundleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />
    </div>
  );
}

export function SetupSourcesStep({ sources }: { sources: SetupSourceItem[] }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const addMutation = useAddSourceMutation();
  const refreshMutation = useRefreshSourceMutation();
  const deleteMutation = useDeleteSourceMutation();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName || !trimmedUrl) {
      pushToast({ tone: "error", message: "请填写名称和订阅 URL。" });
      return;
    }
    addMutation.mutate(
      { name: trimmedName, url: trimmedUrl },
      {
        onSuccess: () => {
          setName("");
          setUrl("");
        },
      },
    );
  }

  return (
    <div className="setup-step-body">
      <form className="form-grid setup-source-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="setup-source-name">名称</label>
          <input id="setup-source-name" onChange={(event) => setName(event.target.value)} placeholder="例如：机场 A" value={name} />
        </div>
        <div className="field field-span-2">
          <label htmlFor="setup-source-url">订阅 URL</label>
          <input
            id="setup-source-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/subscription"
            value={url}
          />
        </div>
        <div className="setup-source-form-actions">
          <button className="button" disabled={addMutation.isPending} type="submit">
            {addMutation.isPending ? "正在验证…" : "添加并刷新"}
          </button>
        </div>
      </form>

      {sources.length === 0 ? (
        <div className="empty-state compact-empty-state">
          还没有订阅源。也可以先跳过，之后在「订阅与配置 → 订阅源」中添加，或在配置片段里粘贴手动节点。
        </div>
      ) : (
        <ul className="setup-source-list">
          {sources.map((source) => {
            const summary = summarizeSnapshot(source);
            return (
              <li className="setup-source-item" key={source.id}>
                <div className="setup-source-copy">
                  <strong>{source.name}</strong>
                  <span className="setup-source-url">{source.url}</span>
                </div>
                <span className={`setup-source-status is-${summary.tone}`}>{summary.text}</span>
                <div className="setup-source-actions">
                  <button
                    className="button-secondary"
                    disabled={refreshMutation.isPending}
                    onClick={() => source.id && refreshMutation.mutate(source.id)}
                    type="button"
                  >
                    刷新
                  </button>
                  <button
                    className="button-danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => source.id && deleteMutation.mutate(source.id)}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SetupTargetStep() {
  const targetQuery = useClashTargetQuery();

  if (targetQuery.isLoading) {
    return <div className="setup-step-body muted">正在加载目标配置…</div>;
  }
  if (!targetQuery.data) {
    return <div className="setup-step-body muted">目标配置加载失败，请稍后重试。</div>;
  }
  return <SetupTargetForm initial={targetQuery.data} />;
}

function SetupTargetForm({ initial }: { initial: ClashTarget }) {
  const [configPath, setConfigPath] = useState(initial.configPath);
  const [controllerUrl, setControllerUrl] = useState(initial.controllerUrl);
  const [secret, setSecret] = useState(initial.secret);
  const [autoReload, setAutoReload] = useState(initial.autoReload);
  const saveMutation = useSaveClashTargetMutation();
  const testMutation = useControllerTestMutation();

  function handleSave() {
    saveMutation.mutate({
      ...initial,
      configPath: configPath.trim(),
      controllerUrl: controllerUrl.trim(),
      secret,
      autoReload,
    });
  }

  return (
    <div className="setup-step-body">
      <div className="form-grid">
        <div className="field field-span-2">
          <label htmlFor="setup-config-path">配置写出路径</label>
          <input id="setup-config-path" onChange={(event) => setConfigPath(event.target.value)} value={configPath} />
          <p className="field-hint">构建产物会写入这个文件，应指向 Mihomo 实际加载的配置路径。</p>
        </div>
        <div className="field">
          <label htmlFor="setup-controller-url">控制器地址</label>
          <input id="setup-controller-url" onChange={(event) => setControllerUrl(event.target.value)} value={controllerUrl} />
        </div>
        <div className="field">
          <label htmlFor="setup-controller-secret">控制器密钥</label>
          <input
            autoComplete="off"
            id="setup-controller-secret"
            onChange={(event) => setSecret(event.target.value)}
            placeholder="没有可留空"
            type="password"
            value={secret}
          />
        </div>
        <div className="field">
          <span className="setup-switch-label">应用后自动重载控制器</span>
          <StatusSwitch checked={autoReload} offLabel="关闭" onChange={setAutoReload} onLabel="开启" title="自动重载" />
        </div>
      </div>
      <div className="setup-inline-actions">
        <button className="button" disabled={saveMutation.isPending} onClick={handleSave} type="button">
          {saveMutation.isPending ? "正在保存…" : "保存目标配置"}
        </button>
        <button className="button-secondary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()} type="button">
          {testMutation.isPending ? "正在测试…" : "测试控制器连接"}
        </button>
        {testMutation.data ? (
          <span className={`setup-test-result ${testMutation.data.connected ? "is-success" : "is-error"}`}>
            {testMutation.data.detail}
          </span>
        ) : null}
      </div>
      <p className="muted">提示：修改控制器地址后请先保存再测试；连接状态由后端实时维护，刚保存后可能需要几秒重连。</p>
    </div>
  );
}

export function SetupLaunchStep({ dashboard, onFinish }: { dashboard: SetupDashboardData; onFinish: () => void }) {
  const buildMutation = useBuildMutation(false);
  const applyMutation = useBuildMutation(true);
  const ensureDeviceMutation = useEnsureDeviceProfileMutation();
  const compiled = applyMutation.data ?? buildMutation.data ?? null;
  const firstDevice = dashboard.deviceProfiles[0] ?? null;
  const subscriptionUrl = useMemo(
    () => (firstDevice?.token ? buildSubscriptionUrl(window.location.origin, firstDevice.token) : null),
    [firstDevice?.token],
  );
  const busy = buildMutation.isPending || applyMutation.isPending;

  async function copySubscriptionUrl() {
    if (!subscriptionUrl || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(subscriptionUrl);
    pushToast({ tone: "success", message: "订阅地址已复制。" });
  }

  return (
    <div className="setup-step-body">
      <div className="setup-inline-actions">
        <button className="button" disabled={busy} onClick={() => applyMutation.mutate()} type="button">
          {applyMutation.isPending ? "正在构建并应用…" : "构建并应用"}
        </button>
        <button className="button-secondary" disabled={busy} onClick={() => buildMutation.mutate()} type="button">
          {buildMutation.isPending ? "正在构建…" : "仅构建预览"}
        </button>
        {dashboard.runtime.safeApplyMode ? <span className="muted">当前为安全模式：应用时不会触碰真实控制器。</span> : null}
      </div>

      {compiled ? (
        <div className="setup-build-stats">
          <div>
            <span>节点</span>
            <strong>{compiled.stats.proxyCount}</strong>
          </div>
          <div>
            <span>策略组</span>
            <strong>{compiled.stats.groupCount}</strong>
          </div>
          <div>
            <span>规则</span>
            <strong>{compiled.stats.ruleCount}</strong>
          </div>
          <div>
            <span>订阅源</span>
            <strong>{compiled.stats.sourceCount}</strong>
          </div>
        </div>
      ) : null}
      {compiled && compiled.warnings.length > 0 ? (
        <ul className="setup-warning-list">
          {compiled.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="setup-device-block">
        <h4>设备订阅地址</h4>
        {subscriptionUrl ? (
          <div className="setup-subscription-row">
            <code className="setup-subscription-url">{subscriptionUrl}</code>
            <button className="button-secondary" onClick={() => void copySubscriptionUrl()} type="button">
              复制
            </button>
          </div>
        ) : (
          <div className="setup-inline-actions">
            <span className="muted">创建一个设备档案，即可获得可分发给其他设备的订阅链接。</span>
            <button
              className="button-secondary"
              disabled={ensureDeviceMutation.isPending}
              onClick={() => ensureDeviceMutation.mutate()}
              type="button"
            >
              {ensureDeviceMutation.isPending ? "正在创建…" : "创建设备订阅"}
            </button>
          </div>
        )}
      </div>

      <div className="setup-finish-row">
        <button className="button" onClick={onFinish} type="button">
          完成初始化，进入实时控制台
        </button>
      </div>
    </div>
  );
}
