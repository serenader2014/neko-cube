import type { CustomRule, RuleProviderDraft } from "@shared/types";
import { Modal } from "../../components/Modal";
import { SortListModal } from "../../components/SortListModal";
import { type BulkProviderEditValues } from "../../lib/rule-providers";
import { normalizeLegacyPolicyTarget } from "../../lib/rule-targets";

type RulesModalsProps = {
  context: any;
};

export function RulesModals({ context }: RulesModalsProps) {
  const { bulkCreateProviders, bulkEditSelectedProviderIds, bulkImportedProviders, bulkProviderDuplicateNames, bulkProviderEditPreview, bulkProviderEditValues, bulkProviderParseError, bulkProviderPolicyOptions, bulkProviderYaml, bulkUpdateProviders, canSaveBulkProviderEdits, canSaveBulkProviders, closeBulkProviderEditModal, closeBulkProviderModal, closeProviderModal, closeRuleModal, editingProvider, editingRule, isBulkProviderEditModalOpen, isBulkProviderModalOpen, isProviderModalOpen, isProviderSortModalOpen, isRuleModalOpen, isRuleSortModalOpen, parseBulkProvidersFromYaml, providerForm, providerItems, providerPolicyOptions, removeBulkImportedProvider, reorderProviders, reorderRules, ruleForm, ruleItems, rulePolicyOptions, ruleType, saveProvider, saveRule, setBulkEditSelectedProviderIds, setBulkProviderEditValues, setBulkProviderYaml, setIsProviderSortModalOpen, setIsRuleSortModalOpen, updateBulkImportedProvider } = context;
  const selectedBulkEditProviderIds = new Set(bulkEditSelectedProviderIds);
  const selectedBulkEditProviders = providerItems.filter((provider) => provider.id && selectedBulkEditProviderIds.has(provider.id));

  return (
    <>
      <SortListModal
        description="只展示标题，在这里拖拽调整规则的执行顺序。"
        isSaving={reorderRules.isPending}
        items={ruleItems.map((rule) => ({
          id: String(rule.id ?? `${rule.type}:${rule.target}`),
          title: `${rule.target || "匹配所有流量"} · ${rule.type}`,
        }))}
        onClose={() => setIsRuleSortModalOpen(false)}
        onSave={async (items) => {
          const itemMap = new Map(ruleItems.map((rule) => [String(rule.id ?? `${rule.type}:${rule.target}`), rule]));
          const nextItems = items.map((item) => itemMap.get(item.id)).filter((item): item is CustomRule => Boolean(item));
          await reorderRules.mutateAsync(nextItems);
        }}
        open={isRuleSortModalOpen}
        title="排序规则"
      />

      <SortListModal
        description="只展示规则集名称，在这里拖拽调整展示和编译顺序。"
        isSaving={reorderProviders.isPending}
        items={providerItems.map((provider) => ({
          id: String(provider.id ?? provider.name),
          title: provider.name,
        }))}
        onClose={() => setIsProviderSortModalOpen(false)}
        onSave={async (items) => {
          const itemMap = new Map(providerItems.map((provider) => [String(provider.id ?? provider.name), provider]));
          const nextItems = items.map((item) => itemMap.get(item.id)).filter((item): item is RuleProviderDraft => Boolean(item));
          await reorderProviders.mutateAsync(nextItems);
        }}
        open={isProviderSortModalOpen}
        title="排序规则集"
      />

      <Modal
        description="规则编辑保持结构化字段，不再占用页面主布局。"
        onClose={closeRuleModal}
        open={isRuleModalOpen}
        title={editingRule ? "编辑规则" : "新增规则"}
        size="wide"
      >
        <form className="stack" onSubmit={ruleForm.handleSubmit(async (values) => saveRule.mutateAsync(values))}>
          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card">
                <div>
                  <h4>匹配逻辑</h4>
                  <p className="muted">先确定规则类型，再填写目标内容和落地策略。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>规则类型</label>
                    <select {...ruleForm.register("type")}>
                      {["DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "IP-CIDR", "GEOIP", "MATCH", "RAW"].map((type) => (
                        <option value={type} key={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>匹配目标 / RAW 内容</label>
                    <input {...ruleForm.register("target")} />
                  </div>
                  <div className="field">
                    <label>{ruleType === "RAW" ? "默认走向" : "命中后走向"}</label>
                    <select {...ruleForm.register("policy")}>
                      {rulePolicyOptions.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>
              </section>
            </div>
            <section className="group-editor-card">
              <div>
                <h4>补充说明</h4>
                <p className="muted">用备注解释规则意图，方便后续回看时快速判断是否还需要保留。</p>
              </div>
              <div className="field">
                <label>备注</label>
                <input {...ruleForm.register("note")} />
              </div>
              <div className="inline-actions">
                <label className="chip">
                  <input type="checkbox" {...ruleForm.register("noResolve")} />
                  no-resolve
                </label>
              </div>
            </section>
          </div>
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeRuleModal} type="button">
              取消
            </button>
            <button className="button" disabled={saveRule.isPending} type="submit">
              {saveRule.isPending ? "保存中..." : "保存规则"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="单个规则集统一维护结构化字段；如果你手里是 YAML，先走批量导入。"
        onClose={closeProviderModal}
        open={isProviderModalOpen}
        title={editingProvider ? "编辑规则集" : "新增规则集"}
        size="wide"
      >
        <form className="stack" onSubmit={providerForm.handleSubmit(async (values) => saveProvider.mutateAsync(values))}>
          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card">
                <div>
                  <h4>基础信息</h4>
                  <p className="muted">这里统一维护规则集的名称、行为和命中后走向，保存时都会落成结构化配置。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>名称</label>
                    <input {...providerForm.register("name")} />
                  </div>
                  <div className="field">
                    <label>命中后走向</label>
                    <select {...providerForm.register("policy")}>
                      {providerPolicyOptions.map((group) => (
                        <optgroup key={group.label} label={group.label}>
                          {group.options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>行为</label>
                    <select {...providerForm.register("behavior")}>
                      <option value="classical">传统规则（classical）</option>
                      <option value="domain">域名（domain）</option>
                      <option value="ipcidr">IP CIDR（ipcidr）</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>格式</label>
                    <select {...providerForm.register("format")}>
                      <option value="yaml">YAML</option>
                      <option value="text">文本（text）</option>
                    </select>
                  </div>
                </div>
              </section>
            </div>
            <div className="group-editor-sidebar">
              <section className="group-editor-card">
                <div>
                  <h4>结构化来源</h4>
                  <p className="muted">规则集统一存成结构化数据，列表展示和编译输出也都以这里的字段为准。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>URL</label>
                    <input {...providerForm.register("url")} />
                  </div>
                  <div className="field">
                    <label>路径</label>
                    <input {...providerForm.register("path")} />
                  </div>
                </div>
              </section>
              <section className="group-editor-card">
                <div>
                  <h4>刷新设置</h4>
                  <p className="muted">排序统一在列表排序弹窗里调整，这里只保留规则集自己的刷新参数。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>刷新间隔</label>
                    <input type="number" {...providerForm.register("interval", { valueAsNumber: true })} />
                  </div>
                </div>
              </section>
            </div>
          </div>
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeProviderModal} type="button">
              取消
            </button>
            <button className="button" disabled={saveProvider.isPending} type="submit">
              {saveProvider.isPending ? "保存中..." : "保存规则集"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="支持批量替换或查找替换 URL，也可以顺带统一调整走向和刷新间隔。"
        onClose={closeBulkProviderEditModal}
        open={isBulkProviderEditModalOpen}
        title="批量编辑规则集"
        size="wide"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSaveBulkProviderEdits) {
              return;
            }
            await bulkUpdateProviders.mutateAsync(bulkProviderEditPreview.items.map((item) => item.next));
          }}
        >
          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>选择目标规则集</h4>
                <p className="muted">先圈定要修改的范围，再统一应用 URL、走向或刷新间隔。</p>
              </div>
              <div className="inline-actions">
                <button
                  className="button-secondary"
                  onClick={() =>
                    setBulkEditSelectedProviderIds(providerItems.map((provider) => provider.id).filter((id): id is number => Boolean(id)))
                  }
                  type="button"
                >
                  全选
                </button>
                <button
                  className="button-secondary"
                  onClick={() =>
                    setBulkEditSelectedProviderIds(
                      providerItems.filter((provider) => provider.enabled).map((provider) => provider.id).filter((id): id is number => Boolean(id)),
                    )
                  }
                  type="button"
                >
                  仅启用项
                </button>
                <button className="button-secondary" onClick={() => setBulkEditSelectedProviderIds([])} type="button">
                  清空
                </button>
                <span className="chip">{selectedBulkEditProviders.length} / {providerItems.length}</span>
              </div>
            </div>
            {providerItems.length ? (
              <div className="section-stack">
                {providerItems.map((provider) => {
                  const providerId = provider.id;
                  const checked = providerId ? bulkEditSelectedProviderIds.includes(providerId) : false;

                  return (
                    <label className="entity-card compact-entity-card" key={provider.id ?? provider.name}>
                      <div className="entity-card-header compact-entity-card-header">
                        <div>
                          <h4>{provider.name}</h4>
                          <p className="muted">{provider.url || provider.path || "当前未配置来源"}</p>
                        </div>
                        <div className="entity-card-metrics">
                          <input
                            checked={checked}
                            disabled={!providerId}
                            onChange={(event) => {
                              if (!providerId) {
                                return;
                              }
                              setBulkEditSelectedProviderIds((current) =>
                                event.target.checked ? [...current, providerId] : current.filter((item) => item !== providerId),
                              );
                            }}
                            type="checkbox"
                          />
                        </div>
                      </div>
                      <div className="compact-meta-row">
                        <span className="metric-badge">走向 · {normalizeLegacyPolicyTarget(provider.policy)}</span>
                        <span className="metric-badge">刷新 · {provider.interval}s</span>
                        <span className="metric-badge">{provider.enabled ? "已启用" : "已停用"}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <strong>还没有规则集</strong>
                <p className="muted">先创建或导入规则集，再进行批量编辑。</p>
              </div>
            )}
          </section>

          <section className="group-editor-card">
            <div>
              <h4>批量编辑内容</h4>
              <p className="muted">URL 支持整段覆盖和局部替换；下面的走向、刷新间隔不填就保持原值。</p>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>URL 操作</label>
                <select
                  onChange={(event) =>
                    setBulkProviderEditValues((current) => ({
                      ...current,
                      urlMode: event.target.value as BulkProviderEditValues["urlMode"],
                    }))
                  }
                  value={bulkProviderEditValues.urlMode}
                >
                  <option value="keep">保持不变</option>
                  <option value="replace-all">统一覆盖</option>
                  <option value="find-replace">查找替换</option>
                </select>
              </div>
              <div className="field">
                <label>命中后走向</label>
                <select
                  onChange={(event) => setBulkProviderEditValues((current) => ({ ...current, policy: event.target.value }))}
                  value={bulkProviderEditValues.policy}
                >
                  <option value="">保持不变</option>
                  {bulkProviderPolicyOptions.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>刷新间隔</label>
                <input
                  min={1}
                  onChange={(event) =>
                    setBulkProviderEditValues((current) => ({
                      ...current,
                      interval: event.target.value ? Number(event.target.value) : null,
                    }))
                  }
                  placeholder="保持不变"
                  type="number"
                  value={bulkProviderEditValues.interval ?? ""}
                />
              </div>
            </div>
            {bulkProviderEditValues.urlMode === "replace-all" ? (
              <div className="field">
                <label>新 URL</label>
                <input
                  onChange={(event) => setBulkProviderEditValues((current) => ({ ...current, urlValue: event.target.value }))}
                  placeholder="https://example.com/rules.yaml"
                  value={bulkProviderEditValues.urlValue}
                />
              </div>
            ) : null}
            {bulkProviderEditValues.urlMode === "find-replace" ? (
              <div className="form-grid">
                <div className="field">
                  <label>查找</label>
                  <input
                    onChange={(event) => setBulkProviderEditValues((current) => ({ ...current, urlFind: event.target.value }))}
                    placeholder="old-domain.example.com"
                    value={bulkProviderEditValues.urlFind}
                  />
                </div>
                <div className="field">
                  <label>替换为</label>
                  <input
                    onChange={(event) => setBulkProviderEditValues((current) => ({ ...current, urlReplace: event.target.value }))}
                    placeholder="new-domain.example.com"
                    value={bulkProviderEditValues.urlReplace}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>变更预览</h4>
                <p className="muted">只会提交真正发生变化的规则集。</p>
              </div>
              <span className="chip">{bulkProviderEditPreview.items.length} 个将更新</span>
            </div>
            {bulkProviderEditPreview.error ? <div className="notice-banner error">{bulkProviderEditPreview.error}</div> : null}
            {!bulkProviderEditPreview.error && bulkProviderEditPreview.items.length ? (
              <div className="section-stack">
                {bulkProviderEditPreview.items.map((item) => (
                  <article className="entity-card compact-entity-card" key={item.current.id ?? item.current.name}>
                    <div className="entity-card-header compact-entity-card-header">
                      <div>
                        <h4>{item.current.name}</h4>
                        <p className="muted">{item.current.url || item.current.path || "当前未配置来源"}</p>
                      </div>
                      <div className="entity-card-metrics">
                        {item.changes.map((change) => (
                          <span className="metric-badge" key={change.field}>
                            {change.field === "url" ? "URL" : change.field === "policy" ? "走向" : "刷新"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="section-stack">
                      {item.changes.map((change) => (
                        <div className="compact-note" key={change.field}>
                          <strong>{change.field === "url" ? "URL" : change.field === "policy" ? "走向" : "刷新间隔"}</strong>
                          <br />
                          <span className="muted">{change.before || "空"}</span>
                          <br />
                          <span>{change.after || "空"}</span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <strong>当前没有待提交的修改</strong>
                <p className="muted">选择目标规则集，并至少填写一项会产生变更的内容。</p>
              </div>
            )}
          </section>

          <div className="modal-actions">
            <button className="button-secondary" onClick={closeBulkProviderEditModal} type="button">
              取消
            </button>
            <button className="button" disabled={bulkUpdateProviders.isPending || !canSaveBulkProviderEdits} type="submit">
              {bulkUpdateProviders.isPending ? "保存中..." : "批量保存修改"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="支持粘贴 `rule-providers:` 片段或纯规则集映射，解析后再逐条指定命中后的走向。"
        onClose={closeBulkProviderModal}
        open={isBulkProviderModalOpen}
        title="批量导入规则集"
        size="wide"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!canSaveBulkProviders) {
              return;
            }
            await bulkCreateProviders.mutateAsync(bulkImportedProviders);
          }}
        >
          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>粘贴 YAML</h4>
                <p className="muted">可以直接粘贴整个 `rule-providers:` 片段，也可以只粘贴内部那层名字到配置体的映射。</p>
              </div>
              <button className="button-secondary" onClick={parseBulkProvidersFromYaml} type="button">
                解析 YAML
              </button>
            </div>
            <div className="field">
              <label>规则集 YAML</label>
              <textarea onChange={(event) => setBulkProviderYaml(event.target.value)} value={bulkProviderYaml} />
            </div>
            {bulkProviderParseError ? <div className="notice-banner error">{bulkProviderParseError}</div> : null}
            {bulkProviderDuplicateNames.length ? (
              <div className="notice-banner error">以下规则集名称重复或已存在：{bulkProviderDuplicateNames.join("、")}</div>
            ) : null}
          </section>

          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>导入预览</h4>
                <p className="muted">解析后逐条确认来源摘要，并为每个规则集指定命中后的走向。</p>
              </div>
              <span className="chip">{bulkImportedProviders.length} 个待导入</span>
            </div>
            {bulkImportedProviders.length ? (
              <div className="section-stack">
                {bulkImportedProviders.map((provider, index) => (
                  <article className="entity-card compact-entity-card" key={`${provider.name}:${index}`}>
                    <div className="entity-card-header compact-entity-card-header">
                      <div>
                        <h4>{provider.name}</h4>
                        <p className="muted">{provider.sourceSummary}</p>
                      </div>
                      <div className="entity-card-metrics">
                        <span className="metric-badge">{provider.mode === "raw" ? "原始 YAML" : "结构化"}</span>
                        <span className="metric-badge">#{provider.sortOrder}</span>
                      </div>
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label>命中后走向</label>
                        <select onChange={(event) => updateBulkImportedProvider(index, { policy: event.target.value })} value={provider.policy}>
                          <option value="">请选择</option>
                          {bulkProviderPolicyOptions.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="entity-card-footer compact-entity-card-footer">
                      <div className="inline-actions">
                        <button className="button-danger" onClick={() => removeBulkImportedProvider(index)} type="button">
                          删除
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <strong>还没有解析结果</strong>
                <p className="muted">先粘贴 YAML 并点击“解析 YAML”，再逐条确认走向后统一导入。</p>
              </div>
            )}
          </section>

          <div className="modal-actions">
            <button className="button-secondary" onClick={closeBulkProviderModal} type="button">
              取消
            </button>
            <button className="button" disabled={bulkCreateProviders.isPending || !canSaveBulkProviders} type="submit">
              {bulkCreateProviders.isPending ? "导入中..." : "批量创建规则集"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
