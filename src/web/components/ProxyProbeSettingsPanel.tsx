import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProxyProbeNode, ProxyProbeSettings } from "../../shared/probes";
import { apiRequest, getErrorMessage } from "../lib/api";
import { pushToast } from "./toast";
import { StatusSwitch } from "./StatusSwitch";

type FilterListKind = "include" | "exclude";

const FILTER_LIST_META: Record<
  FilterListKind,
  {
    description: string;
    namesKey: "nodeFilterIncludeNames" | "nodeFilterExcludeNames";
    oppositeKey: "nodeFilterIncludeNames" | "nodeFilterExcludeNames";
    title: string;
  }
> = {
  include: {
    description: "配置后只探测这些节点。",
    namesKey: "nodeFilterIncludeNames",
    oppositeKey: "nodeFilterExcludeNames",
    title: "白名单",
  },
  exclude: {
    description: "这些节点不会被延迟探测。",
    namesKey: "nodeFilterExcludeNames",
    oppositeKey: "nodeFilterIncludeNames",
    title: "黑名单",
  },
};

function updateDraftNumber(
  draft: ProxyProbeSettings | null,
  key: "intervalSeconds" | "timeoutMs" | "concurrency" | "burstCount" | "burstGapMs",
  value: string,
) {
  if (!draft) {
    return draft;
  }
  const parsed = Number(value);
  return {
    ...draft,
    [key]: Number.isFinite(parsed) ? parsed : draft[key],
  };
}

function addNodeFilterName(draft: ProxyProbeSettings | null, kind: FilterListKind, name: string) {
  const normalized = name.trim();
  if (!draft || !normalized) {
    return draft;
  }
  const meta = FILTER_LIST_META[kind];
  return {
    ...draft,
    [meta.namesKey]: Array.from(new Set([...draft[meta.namesKey], normalized])).sort((left, right) => left.localeCompare(right)),
    [meta.oppositeKey]: draft[meta.oppositeKey].filter((item) => item !== normalized),
  };
}

function removeNodeFilterName(draft: ProxyProbeSettings | null, kind: FilterListKind, name: string) {
  if (!draft) {
    return draft;
  }
  const meta = FILTER_LIST_META[kind];
  return {
    ...draft,
    [meta.namesKey]: draft[meta.namesKey].filter((item) => item !== name),
  };
}

function formatNodeFilterSummary(kind: FilterListKind, names: string[]) {
  if (!names.length) {
    return kind === "include" ? "未限制，默认探测全部节点" : "未排除任何节点";
  }
  const visibleNames = names.slice(0, 3).join("、");
  return names.length > 3 ? `${visibleNames}，另 ${names.length - 3} 个` : visibleNames;
}

export function ProxyProbeSettingsPanel() {
  const queryClient = useQueryClient();
  const [settingsDraft, setSettingsDraft] = useState<ProxyProbeSettings | null>(null);
  const settingsQuery = useQuery({
    queryKey: ["proxy-probes", "settings"],
    queryFn: () => apiRequest<ProxyProbeSettings>("/api/proxy-probes/settings"),
  });
  const proxiesQuery = useQuery({
    queryKey: ["proxy-probes", "nodes"],
    queryFn: () => apiRequest<ProxyProbeNode[]>("/api/proxy-probes/nodes"),
    refetchOnWindowFocus: false,
  });
  const availableNodeNames = useMemo(() => (proxiesQuery.data ?? []).map((node) => node.name), [proxiesQuery.data]);

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsDraft(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const saveSettingsMutation = useMutation<ProxyProbeSettings, Error, Partial<ProxyProbeSettings>>({
    mutationFn: (payload) =>
      apiRequest<ProxyProbeSettings>("/api/proxy-probes/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (data) => {
      setSettingsDraft(data);
      await queryClient.invalidateQueries({ queryKey: ["proxy-probes"] });
      pushToast({ tone: "success", message: "延迟探测设置已保存。" });
    },
    onError: (error) => pushToast({ tone: "error", message: getErrorMessage(error) }),
  });

  return (
    <article className="panel proxy-probe-settings-panel">
      <div className="section-header">
        <div>
          <h3>延迟探测</h3>
          <p className="muted">管理自动延迟采样参数和健康检查 URL。</p>
        </div>
        <StatusSwitch
          checked={settingsDraft?.enabled ?? false}
          disabled={!settingsDraft || saveSettingsMutation.isPending}
          offLabel="禁用"
          onChange={(enabled) => saveSettingsMutation.mutate({ enabled })}
          onLabel="启用"
        />
      </div>

      {settingsQuery.isError ? <div className="runtime-banner is-error">延迟探测设置加载失败：{getErrorMessage(settingsQuery.error)}</div> : null}
      {proxiesQuery.isError ? <div className="runtime-banner">当前无法读取运行时节点列表，暂时不能选择节点。</div> : null}

      {settingsDraft ? (
        <>
          <div className="proxy-probe-settings-grid">
            <label>
              <span>探测间隔（秒）</span>
              <input
                max={3600}
                min={30}
                type="number"
                value={settingsDraft.intervalSeconds}
                onChange={(event) => setSettingsDraft((current) => updateDraftNumber(current, "intervalSeconds", event.target.value))}
              />
            </label>
            <label>
              <span>单轮次数</span>
              <input
                max={20}
                min={1}
                type="number"
                value={settingsDraft.burstCount}
                onChange={(event) => setSettingsDraft((current) => updateDraftNumber(current, "burstCount", event.target.value))}
              />
            </label>
            <label>
              <span>单次超时（ms）</span>
              <input
                max={30000}
                min={1000}
                type="number"
                value={settingsDraft.timeoutMs}
                onChange={(event) => setSettingsDraft((current) => updateDraftNumber(current, "timeoutMs", event.target.value))}
              />
            </label>
            <label>
              <span>节点并发</span>
              <input
                max={32}
                min={1}
                type="number"
                value={settingsDraft.concurrency}
                onChange={(event) => setSettingsDraft((current) => updateDraftNumber(current, "concurrency", event.target.value))}
              />
            </label>
            <label>
              <span>单次间隔（ms）</span>
              <input
                max={5000}
                min={0}
                type="number"
                value={settingsDraft.burstGapMs}
                onChange={(event) => setSettingsDraft((current) => updateDraftNumber(current, "burstGapMs", event.target.value))}
              />
            </label>
            <label className="proxy-probe-url-field">
              <span>探测 URL</span>
              <input
                placeholder="留空使用默认健康检查 URL"
                value={settingsDraft.probeUrl}
                onChange={(event) => setSettingsDraft((current) => (current ? { ...current, probeUrl: event.target.value } : current))}
              />
            </label>
          </div>

          <section className="proxy-probe-stats-options">
            <div>
              <span>首个样本参与统计</span>
              <p>关闭后，每轮第一次测速只保留在原始记录里，不进入图表、列表和成功率统计。</p>
            </div>
            <StatusSwitch
              checked={settingsDraft.includeFirstSampleInStats}
              disabled={saveSettingsMutation.isPending}
              offLabel="排除"
              onChange={(includeFirstSampleInStats) =>
                setSettingsDraft((current) => (current ? { ...current, includeFirstSampleInStats } : current))
              }
              onLabel="参与"
            />
          </section>

          <section className="proxy-probe-filter-panel">
            <div className="proxy-probe-filter-head">
              <span>节点范围</span>
              <strong>白名单为空时默认探测全部节点，黑名单始终会排除。</strong>
            </div>
            <div className="proxy-probe-filter-columns">
              {(["include", "exclude"] as const).map((kind) => (
                <NodeFilterList
                  availableNodeNames={availableNodeNames}
                  kind={kind}
                  key={kind}
                  names={settingsDraft[FILTER_LIST_META[kind].namesKey]}
                  oppositeNames={settingsDraft[FILTER_LIST_META[kind].oppositeKey]}
                  onToggle={(name, checked) =>
                    setSettingsDraft((current) =>
                      checked ? addNodeFilterName(current, kind, name) : removeNodeFilterName(current, kind, name),
                    )
                  }
                />
              ))}
            </div>
          </section>

          <div className="inline-actions proxy-probe-save-actions">
            <button
              className="button-secondary"
              disabled={saveSettingsMutation.isPending}
              onClick={() => saveSettingsMutation.mutate(settingsDraft)}
              type="button"
            >
              {saveSettingsMutation.isPending ? "保存中..." : "保存设置"}
            </button>
          </div>
        </>
      ) : null}
    </article>
  );
}

function NodeFilterList({
  availableNodeNames,
  kind,
  names,
  onToggle,
  oppositeNames,
}: {
  availableNodeNames: string[];
  kind: FilterListKind;
  names: string[];
  onToggle: (name: string, checked: boolean) => void;
  oppositeNames: string[];
}) {
  const meta = FILTER_LIST_META[kind];
  const optionNodeNames = Array.from(new Set([...names, ...availableNodeNames])).sort((left, right) => left.localeCompare(right));
  const summary = formatNodeFilterSummary(kind, names);
  return (
    <section className={`proxy-probe-filter-box is-${kind}`}>
      <div className="proxy-probe-filter-box-head">
        <h4>{meta.title}</h4>
        <p>{meta.description}</p>
      </div>
      <details className="proxy-probe-multi-select">
        <summary>
          <span className={names.length ? "proxy-probe-multi-summary is-active" : "proxy-probe-multi-summary"} title={names.join("、")}>
            {summary}
          </span>
          <strong>{names.length}</strong>
        </summary>
        <div className="proxy-probe-multi-menu">
          {optionNodeNames.map((name) => {
            const checked = names.includes(name);
            const disabled = !checked && oppositeNames.includes(name);
            return (
              <label className="proxy-probe-multi-option" key={name}>
                <input
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => onToggle(name, event.target.checked)}
                  type="checkbox"
                />
                <span>{name}</span>
              </label>
            );
          })}
          {!optionNodeNames.length ? <span className="muted">当前没有可选择节点。</span> : null}
        </div>
      </details>
    </section>
  );
}
