import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sortByOrder, type CustomRule, type ProxyGroupDraft, type RegionRule, type RuleProviderDraft, type SubscriptionSource } from "@shared/types";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { StatusSwitch } from "../../components/StatusSwitch";
import { pushToast } from "../../components/toast";
import { withSequentialSortOrder } from "../../lib/sortable";
import { previewBulkProviderEdits, type BulkProviderEditValues } from "../../lib/rule-providers";
import { buildPolicyTargetGroups, normalizeLegacyPolicyTarget } from "../../lib/rule-targets";
import { emptyBulkProviderEditValues, emptyProvider, emptyRule } from "./constants";
import {
  normalizeProviderDraftForSave,
  normalizeProviderForUi,
  parseProviderYamlCollection,
} from "./helpers";
import { RulesModals } from "./RulesModals";
import type { BulkImportedProvider, ProviderFormValues, RuleFormValues } from "./types";

export function RulesPage() {
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<CustomRule | null>(null);
  const [editingProvider, setEditingProvider] = useState<RuleProviderDraft | null>(null);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isBulkProviderModalOpen, setIsBulkProviderModalOpen] = useState(false);
  const [isBulkProviderEditModalOpen, setIsBulkProviderEditModalOpen] = useState(false);
  const [isRuleSortModalOpen, setIsRuleSortModalOpen] = useState(false);
  const [isProviderSortModalOpen, setIsProviderSortModalOpen] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [togglingProviderId, setTogglingProviderId] = useState<number | null>(null);
  const [bulkProviderYaml, setBulkProviderYaml] = useState("");
  const [bulkImportedProviders, setBulkImportedProviders] = useState<BulkImportedProvider[]>([]);
  const [bulkProviderParseError, setBulkProviderParseError] = useState<string | null>(null);
  const [bulkEditSelectedProviderIds, setBulkEditSelectedProviderIds] = useState<number[]>([]);
  const [bulkProviderEditValues, setBulkProviderEditValues] = useState<BulkProviderEditValues>(emptyBulkProviderEditValues);
  const ruleForm = useForm<RuleFormValues>({ defaultValues: emptyRule });
  const providerForm = useForm<ProviderFormValues>({ defaultValues: emptyProvider });

  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiRequest<CustomRule[]>("/api/rules"),
  });

  const providers = useQuery({
    queryKey: ["rule-providers"],
    queryFn: () => apiRequest<RuleProviderDraft[]>("/api/rule-providers"),
  });
  const regions = useQuery({
    queryKey: ["region-rules"],
    queryFn: () => apiRequest<RegionRule[]>("/api/region-rules"),
  });
  const proxyGroups = useQuery({
    queryKey: ["proxy-groups"],
    queryFn: () => apiRequest<ProxyGroupDraft[]>("/api/proxy-groups"),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SubscriptionSource[]>("/api/sources"),
  });
  const ruleItems = useMemo(() => sortByOrder(Array.isArray(rules.data) ? rules.data : []), [rules.data]);
  const providerItems = useMemo(
    () => sortByOrder((Array.isArray(providers.data) ? providers.data : []).map(normalizeProviderForUi)),
    [providers.data],
  );
  const regionItems = sortByOrder(Array.isArray(regions.data) ? regions.data : []).filter((region) => region.enabled);
  const proxyGroupItems = sortByOrder(Array.isArray(proxyGroups.data) ? proxyGroups.data : []).filter((group) => group.enabled);
  const sourceItems = (Array.isArray(sources.data) ? sources.data : []).filter((source) => source.enabled);
  const ruleType = ruleForm.watch("type");

  const rulePolicyOptions = useMemo(
    () =>
      buildPolicyTargetGroups({
        regions: regionItems,
        proxyGroups: proxyGroupItems,
        sources: sourceItems,
        currentValue: normalizeLegacyPolicyTarget(editingRule?.policy ?? emptyRule.policy),
      }),
    [editingRule?.policy, proxyGroupItems, regionItems, sourceItems],
  );

  const providerPolicyOptions = useMemo(
    () =>
      buildPolicyTargetGroups({
        regions: regionItems,
        proxyGroups: proxyGroupItems,
        sources: sourceItems,
        currentValue: normalizeLegacyPolicyTarget(editingProvider?.policy ?? emptyProvider.policy),
      }),
    [editingProvider?.policy, proxyGroupItems, regionItems, sourceItems],
  );
  const bulkProviderPolicyOptions = useMemo(
    () =>
      buildPolicyTargetGroups({
        regions: regionItems,
        proxyGroups: proxyGroupItems,
        sources: sourceItems,
        currentValue: "",
      }),
    [proxyGroupItems, regionItems, sourceItems],
  );
  const nextRuleSortOrder = useMemo(
    () => ruleItems.reduce((maxSortOrder, rule) => Math.max(maxSortOrder, rule.sortOrder ?? 0), 0) + 10,
    [ruleItems],
  );
  const nextProviderSortOrder = useMemo(
    () => providerItems.reduce((maxSortOrder, provider) => Math.max(maxSortOrder, provider.sortOrder ?? 0), 0) + 10,
    [providerItems],
  );
  const bulkProviderDuplicateNames = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    const existingNames = new Set(providerItems.map((provider) => provider.name));

    for (const provider of bulkImportedProviders) {
      const normalizedName = provider.name.trim();
      if (!normalizedName) {
        continue;
      }

      if (seen.has(normalizedName) || existingNames.has(normalizedName)) {
        duplicates.add(normalizedName);
      }

      seen.add(normalizedName);
    }

    return Array.from(duplicates);
  }, [bulkImportedProviders, providerItems]);
  const canSaveBulkProviders =
    bulkImportedProviders.length > 0 &&
    !bulkProviderParseError &&
    bulkProviderDuplicateNames.length === 0 &&
    bulkImportedProviders.every((provider) => provider.name.trim() && provider.policy.trim());
  const selectedBulkEditProviders = useMemo(() => {
    const idSet = new Set(bulkEditSelectedProviderIds);
    return providerItems.filter((provider) => provider.id && idSet.has(provider.id));
  }, [bulkEditSelectedProviderIds, providerItems]);
  const bulkProviderEditPreview = useMemo(() => {
    try {
      return {
        items: previewBulkProviderEdits(selectedBulkEditProviders, bulkProviderEditValues),
        error: null,
      };
    } catch (error) {
      return {
        items: [],
        error: getErrorMessage(error),
      };
    }
  }, [bulkProviderEditValues, selectedBulkEditProviders]);
  const canSaveBulkProviderEdits =
    selectedBulkEditProviders.length > 0 && !bulkProviderEditPreview.error && bulkProviderEditPreview.items.length > 0;

  useEffect(() => {
    if (isRuleModalOpen) {
      ruleForm.reset(
        editingRule
          ? {
              type: editingRule.type,
              target: editingRule.target,
              policy: normalizeLegacyPolicyTarget(editingRule.policy),
              noResolve: editingRule.noResolve,
              note: editingRule.note,
              sortOrder: editingRule.sortOrder,
            }
          : { ...emptyRule, sortOrder: nextRuleSortOrder },
      );
    }
  }, [editingRule, isRuleModalOpen, nextRuleSortOrder, ruleForm]);

  useEffect(() => {
    if (isProviderModalOpen) {
      providerForm.reset(
        editingProvider
          ? {
              name: editingProvider.name,
              behavior: editingProvider.behavior,
              format: editingProvider.format,
              url: editingProvider.url,
              interval: editingProvider.interval,
              path: editingProvider.path,
              policy: normalizeLegacyPolicyTarget(editingProvider.policy),
              sortOrder: editingProvider.sortOrder,
              mode: "structured",
              rawYaml: "",
            }
          : { ...emptyProvider, sortOrder: nextProviderSortOrder },
      );
    }
  }, [editingProvider, isProviderModalOpen, nextProviderSortOrder, providerForm]);

  function closeRuleModal() {
    setIsRuleModalOpen(false);
    setEditingRule(null);
    ruleForm.reset(emptyRule);
  }

  function closeProviderModal() {
    setIsProviderModalOpen(false);
    setEditingProvider(null);
    providerForm.reset(emptyProvider);
  }

  function closeBulkProviderModal() {
    setIsBulkProviderModalOpen(false);
    setBulkProviderYaml("");
    setBulkImportedProviders([]);
    setBulkProviderParseError(null);
  }

  function openBulkProviderEditModal() {
    setBulkEditSelectedProviderIds(providerItems.map((provider) => provider.id).filter((id): id is number => Boolean(id)));
    setBulkProviderEditValues(emptyBulkProviderEditValues);
    setIsBulkProviderEditModalOpen(true);
  }

  function closeBulkProviderEditModal() {
    setIsBulkProviderEditModalOpen(false);
    setBulkEditSelectedProviderIds([]);
    setBulkProviderEditValues(emptyBulkProviderEditValues);
  }

  const saveRule = useMutation({
    mutationFn: (payload: RuleFormValues) =>
      apiRequest(editingRule?.id ? `/api/rules/${editingRule.id}` : "/api/rules", {
        method: editingRule?.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...payload,
          enabled: editingRule?.enabled ?? true,
          id: editingRule?.id,
        } satisfies CustomRule),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: editingRule?.id ? "规则已更新。" : "规则已创建。" });
      closeRuleModal();
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: CustomRule) => {
      if (!rule.id) {
        return;
      }

      setTogglingRuleId(rule.id);
      return apiRequest(`/api/rules/${rule.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...rule,
          enabled: !rule.enabled,
        } satisfies CustomRule),
      });
    },
    onSuccess: async (_data, rule) => {
      pushToast({ tone: "success", message: `${rule.type} 规则已${rule.enabled ? "停用" : "启用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingRuleId(null);
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/rules/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "规则已删除。" });
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const reorderRules = useMutation({
    mutationFn: async (nextItems: CustomRule[]) => {
      for (const rule of withSequentialSortOrder(nextItems)) {
        if (!rule.id) {
          continue;
        }

        await apiRequest(`/api/rules/${rule.id}`, {
          method: "PUT",
          body: JSON.stringify(rule satisfies CustomRule),
        });
      }
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "规则顺序已保存。" });
      setIsRuleSortModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const saveProvider = useMutation({
    mutationFn: (payload: ProviderFormValues) =>
      apiRequest(editingProvider?.id ? `/api/rule-providers/${editingProvider.id}` : "/api/rule-providers", {
        method: editingProvider?.id ? "PUT" : "POST",
        body: JSON.stringify(
          normalizeProviderDraftForSave({
            ...payload,
            enabled: editingProvider?.enabled ?? true,
            id: editingProvider?.id,
          } satisfies RuleProviderDraft),
        ),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: editingProvider?.id ? "规则集已更新。" : "规则集已创建。" });
      closeProviderModal();
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleProvider = useMutation({
    mutationFn: async (provider: RuleProviderDraft) => {
      if (!provider.id) {
        return;
      }

      setTogglingProviderId(provider.id);
      return apiRequest(`/api/rule-providers/${provider.id}`, {
        method: "PUT",
        body: JSON.stringify(
          normalizeProviderDraftForSave({
            ...provider,
            enabled: !provider.enabled,
          }),
        ),
      });
    },
    onSuccess: async (_data, provider) => {
      pushToast({ tone: "success", message: `${provider.name} 已${provider.enabled ? "停用" : "启用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingProviderId(null);
    },
  });

  const deleteProvider = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/rule-providers/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "规则集已删除。" });
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const reorderProviders = useMutation({
    mutationFn: async (nextItems: RuleProviderDraft[]) => {
      for (const provider of withSequentialSortOrder(nextItems)) {
        if (!provider.id) {
          continue;
        }

        await apiRequest(`/api/rule-providers/${provider.id}`, {
          method: "PUT",
          body: JSON.stringify(normalizeProviderDraftForSave(provider)),
        });
      }
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "规则集顺序已保存。" });
      setIsProviderSortModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const bulkCreateProviders = useMutation({
    mutationFn: async (payload: BulkImportedProvider[]) => {
      for (const provider of payload) {
        await apiRequest("/api/rule-providers", {
          method: "POST",
          body: JSON.stringify(
            normalizeProviderDraftForSave({
              ...provider,
              enabled: true,
            } satisfies RuleProviderDraft),
          ),
        });
      }
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: `已批量导入 ${bulkImportedProviders.length} 个规则集。` });
      closeBulkProviderModal();
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const bulkUpdateProviders = useMutation({
    mutationFn: async (payload: RuleProviderDraft[]) => {
      for (const provider of payload) {
        if (!provider.id) {
          continue;
        }

        await apiRequest(`/api/rule-providers/${provider.id}`, {
          method: "PUT",
          body: JSON.stringify(normalizeProviderDraftForSave(provider)),
        });
      }
    },
    onSuccess: async (_data, payload) => {
      pushToast({ tone: "success", message: `已批量更新 ${payload.length} 个规则集。` });
      closeBulkProviderEditModal();
      await queryClient.invalidateQueries({ queryKey: ["rule-providers"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  function parseBulkProvidersFromYaml() {
    try {
      const parsed = parseProviderYamlCollection(bulkProviderYaml, nextProviderSortOrder);
      setBulkImportedProviders(parsed);
      setBulkProviderParseError(null);
    } catch (error) {
      setBulkImportedProviders([]);
      setBulkProviderParseError(getErrorMessage(error));
    }
  }

  function updateBulkImportedProvider(index: number, patch: Partial<BulkImportedProvider>) {
    setBulkImportedProviders((current) => current.map((provider, itemIndex) => (itemIndex === index ? { ...provider, ...patch } : provider)));
  }

  function removeBulkImportedProvider(index: number) {
    setBulkImportedProviders((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section className="page">
      <div className="section-stack">
        <article className="panel">
          <div className="section-header">
            <div>
              <h3>规则列表</h3>
              <p className="muted">规则改成高密度列表，优先让你快速扫过匹配条件、走向和启停状态。</p>
            </div>
            <div className="inline-actions">
              {ruleItems.length > 1 ? (
                <button className="button-secondary" onClick={() => setIsRuleSortModalOpen(true)} type="button">
                  排序
                </button>
              ) : null}
              <span className="chip">{ruleItems.length} 条</span>
              <button
                className="button"
                onClick={() => {
                  setEditingRule(null);
                  setIsRuleModalOpen(true);
                }}
                type="button"
              >
                新增规则
              </button>
            </div>
          </div>
          {ruleItems.length ? (
            <div className="compact-entity-list dual-entity-grid">
              {ruleItems.map((rule) => (
                <article className="entity-card compact-entity-card" key={rule.id}>
                  <div className="entity-card-header compact-entity-card-header">
                    <div>
                      <h4>{rule.target || "匹配所有流量"}</h4>
                      <p className="muted">{rule.type}</p>
                    </div>
                  <div className="entity-card-metrics">
                    <StatusSwitch
                      checked={rule.enabled}
                      disabled={toggleRule.isPending && togglingRuleId === rule.id}
                      onChange={() => toggleRule.mutate(rule)}
                      title={`切换 ${rule.type} 规则的启用状态`}
                    />
                  </div>
                  </div>
                  <div className="compact-meta-row">
                    <span className="metric-badge">走向 · {normalizeLegacyPolicyTarget(rule.policy)}</span>
                    <span className="metric-badge">no-resolve · {rule.noResolve ? "开" : "关"}</span>
                  </div>
                  {rule.note ? <p className="compact-note">{rule.note}</p> : null}
                  <div className="entity-card-footer compact-entity-card-footer">
                    <div className="inline-actions">
                      <button
                        className="button-secondary"
                        onClick={() => {
                          setEditingRule(rule);
                          setIsRuleModalOpen(true);
                        }}
                        type="button"
                      >
                        编辑
                      </button>
                      <button className="button-danger" onClick={() => rule.id && window.confirm(`确定要删除规则「${rule.target}」吗？`) && deleteRule.mutate(rule.id)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>还没有自定义规则</strong>
              <p className="muted">如果需要覆写默认流量去向，可以从常见的域名、IP 或 MATCH 规则开始。</p>
              <button
                className="button-secondary"
                onClick={() => {
                  setEditingRule(null);
                  setIsRuleModalOpen(true);
                }}
                type="button"
              >
                新增规则
              </button>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-header">
            <div>
              <h3>规则集列表</h3>
              <p className="muted">管理远程规则集的来源、行为模式和刷新策略。</p>
            </div>
            <div className="inline-actions">
              {providerItems.length ? (
                <button className="button-secondary" onClick={openBulkProviderEditModal} type="button">
                  批量编辑
                </button>
              ) : null}
              <button className="button-secondary" onClick={() => setIsBulkProviderModalOpen(true)} type="button">
                批量导入
              </button>
              {providerItems.length > 1 ? (
                <button className="button-secondary" onClick={() => setIsProviderSortModalOpen(true)} type="button">
                  排序
                </button>
              ) : null}
              <span className="chip">{providerItems.length} 个</span>
              <button
                className="button"
                onClick={() => {
                  setEditingProvider(null);
                  setIsProviderModalOpen(true);
                }}
                type="button"
              >
                新增规则集
              </button>
            </div>
          </div>
          {providerItems.length ? (
            <div className="dual-entity-grid">
              {providerItems.map((provider) => (
                <article className="entity-card" key={provider.id}>
                  <div className="entity-card-header">
                    <div>
                      <h4>{provider.name}</h4>
                      <p className="muted">{provider.url || provider.path || "当前未配置来源"}</p>
                  </div>
                  <div className="entity-card-metrics">
                    <StatusSwitch
                      checked={provider.enabled}
                      disabled={toggleProvider.isPending && togglingProviderId === provider.id}
                      onChange={() => toggleProvider.mutate(provider)}
                      title={`切换 ${provider.name} 的启用状态`}
                    />
                    <span className="metric-badge">{provider.format}</span>
                  </div>
                </div>
                  <div className="summary-grid compact-summary-grid provider-summary-grid">
                    <div className="summary-item">
                      <dt>行为</dt>
                      <dd>{provider.behavior}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>刷新间隔</dt>
                      <dd>{provider.interval}s</dd>
                    </div>
                    <div className="summary-item">
                      <dt>策略</dt>
                      <dd>{normalizeLegacyPolicyTarget(provider.policy)}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>路径</dt>
                      <dd>{provider.path || "按名称自动生成"}</dd>
                    </div>
                  </div>
                  <div className="entity-card-footer">
                    <div className="inline-actions">
                      <button
                        className="button-secondary"
                        onClick={() => {
                          setEditingProvider(provider);
                          setIsProviderModalOpen(true);
                        }}
                        type="button"
                      >
                        编辑
                      </button>
                      <button
                        className="button-danger"
                        onClick={() => provider.id && window.confirm(`确定要删除规则集「${provider.name}」吗？`) && deleteProvider.mutate(provider.id)}
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
              <strong>还没有规则集</strong>
              <p className="muted">如果有外部规则集，可以先添加规则集，再在规则列表里通过 RULE-SET 引用。</p>
              <button
                className="button-secondary"
                onClick={() => setIsBulkProviderModalOpen(true)}
                type="button"
              >
                批量导入 YAML
              </button>
              <button
                className="button"
                onClick={() => {
                  setEditingProvider(null);
                  setIsProviderModalOpen(true);
                }}
                type="button"
              >
                新增规则集
              </button>
            </div>
          )}
        </article>
      </div>

      <RulesModals context={{ bulkCreateProviders, bulkEditSelectedProviderIds, bulkImportedProviders, bulkProviderDuplicateNames, bulkProviderEditPreview, bulkProviderEditValues, bulkProviderParseError, bulkProviderPolicyOptions, bulkProviderYaml, bulkUpdateProviders, canSaveBulkProviderEdits, canSaveBulkProviders, closeBulkProviderEditModal, closeBulkProviderModal, closeProviderModal, closeRuleModal, editingProvider, editingRule, isBulkProviderEditModalOpen, isBulkProviderModalOpen, isProviderModalOpen, isProviderSortModalOpen, isRuleModalOpen, isRuleSortModalOpen, parseBulkProvidersFromYaml, providerForm, providerItems, providerPolicyOptions, removeBulkImportedProvider, reorderProviders, reorderRules, ruleForm, ruleItems, rulePolicyOptions, ruleType, saveProvider, saveRule, setBulkEditSelectedProviderIds, setBulkProviderEditValues, setBulkProviderYaml, setIsProviderSortModalOpen, setIsRuleSortModalOpen, updateBulkImportedProvider }} />
    </section>
  );
}
