import { Modal } from "../../components/Modal";
import { SortListModal } from "../../components/SortListModal";
import { ManualProxiesEditor } from "../../components/StructuredFragmentEditors";
import type { ProxyGroupDraft, ProxyGroupMember } from "@shared/types";
import { ProxyChipList, RegionPreviewList } from "./components";
import { memberCategoryLabels, memberKindLabels } from "./constants";
import { getMemberKey } from "./helpers";
import type { MemberOption } from "./types";

type GroupsModalsProps = {
  context: any;
};

export function GroupsModals({ context }: GroupsModalsProps) {
  const { activeBulkMemberCategoryLabel, activeMemberCategoryLabel, allVisibleBulkMembersSelected, allVisibleSelected, availableSourceFilters, bulkAssignGroupMembers, bulkDirectoryEmptyState, bulkDirectoryMode, bulkMemberCategory, bulkMemberSearch, bulkMemberSourceFilter, bulkSelectedMemberKeySet, bulkSelectedMembers, bulkSelectedPreview, bulkSourceFilterEnabled, bulkTargetGroupIds, bulkVisibleMemberOptions, clearMissingSelectedProxyMembers, clearSelectedMembers, closeBulkAssignModal, closeCustomProxyImportModal, closeCustomProxyModal, closeFinalGroupModal, closeGroupModal, closeRegionModal, customProxyDraftFragment, customProxyDraftSubmitRef, customProxyImportResult, customProxyImportYaml, customProxyRecords, customProxySelectionRequest, dedupeMembers, deleteCustomProxyAt, deleteGroup, deleteRegion, dialerProxyOptions, editingGroup, editingRegion, groupForm, importCustomProxyYaml, isBulkAssignModalOpen, isCustomProxyImportModalOpen, isCustomProxyModalOpen, isCustomProxySortModalOpen, isFinalGroupModalOpen, isGroupModalOpen, isGroupSortModalOpen, isRegionModalOpen, isRegionPreviewVisible, isSelectedMemberSortModalOpen, memberCategory, memberDirectoryEmptyState, memberDirectoryMode, memberSearch, memberSourceFilter, missingSelectedProxyMembers, parseCustomProxyImport, proxyGroupItems, regionDraftKeywords, regionDraftPreview, regionForm, regionName, removeBulkSelectedMember, removeCustomProxyImportItem, removeSelectedMember, reorderGroup, saveCustomProxyDraft, saveCustomProxyOrder, saveFinalGroup, saveGroup, saveRegion, selectedBulkGroups, selectedMemberKeySet, selectedMembers, selectedPreview, setBulkMemberCategory, setBulkMemberSearch, setBulkMemberSourceFilter, setCustomProxyDraftFragment, setCustomProxyImportYaml, setIsCustomProxySortModalOpen, setIsGroupSortModalOpen, setIsRegionPreviewVisible, setIsSelectedMemberSortModalOpen, setMemberCategory, setMemberSearch, setMemberSourceFilter, setSelectedMembers, sourceFilterEnabled, sourceFilterOptions, toggleAllVisibleBulkMembers, toggleAllVisibleMembers, toggleBulkMember, toggleBulkTargetGroup, toggleMember, upsertFragment, visibleBulkSelectedCount, visibleMemberOptions, visibleSelectedCount } = context;

  return (
    <>
      <Modal
        description="一次选中多个自定义分组，再给它们分配完全相同的一组成员。保存后会覆盖这些分组当前的成员列表。"
        onClose={closeBulkAssignModal}
        open={isBulkAssignModalOpen}
        title="批量分配自定义分组节点"
        size="wide"
      >
        <form
          className="stack group-builder-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await bulkAssignGroupMembers.mutateAsync({
              groupIds: bulkTargetGroupIds,
              members: bulkSelectedMembers,
            });
          }}
        >
          <section className="group-builder-overview">
            <div className="group-builder-copy">
              <span className="section-label">批量分配</span>
              <h4>先选目标分组，再统一分配同一组成员</h4>
              <p className="muted">这里不会改分组名和类型，只会把所选分组的成员列表替换成右侧当前这组输入。</p>
            </div>
            <div className="group-builder-metrics">
              <div className="group-builder-metric">
                <span>目标分组</span>
                <strong>{bulkTargetGroupIds.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>分配成员</span>
                <strong>{bulkSelectedMembers.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>展开节点</span>
                <strong>{bulkSelectedPreview.proxies.length}</strong>
              </div>
            </div>
          </section>

          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card group-editor-card-primary">
                <div className="section-header">
                  <div>
                    <h4>目标分组</h4>
                    <p className="muted">勾选需要一起更新的自定义分组，保存后这些分组都会使用同一组成员。</p>
                  </div>
                  <span className="chip">{bulkTargetGroupIds.length} 个已选</span>
                </div>
                <div className="structured-list scroll-panel medium-scroll-panel">
                  {proxyGroupItems.map((group) => {
                    const isChecked = group.id ? bulkTargetGroupIds.includes(group.id) : false;

                    return (
                      <label className={`structured-row selectable-row ${isChecked ? "is-selected" : ""}`} key={group.id ?? group.name}>
                        <div>
                          <strong>{group.name}</strong>
                          <div className="muted">
                            {group.type} · 当前 {group.members.length} 个成员
                          </div>
                        </div>
                        <div className="structured-meta">
                          <input checked={isChecked} onChange={() => group.id && toggleBulkTargetGroup(group.id)} type="checkbox" />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="group-editor-card group-editor-card-soft">
                <div className="section-header">
                  <div>
                    <h4>待分配成员</h4>
                    <p className="muted">这里保留概览和移除；右侧负责浏览和勾选成员。</p>
                  </div>
                  <div className="inline-actions">
                    <span className="chip">{bulkSelectedMembers.length} 项</span>
                    <span className="chip">{activeBulkMemberCategoryLabel}</span>
                  </div>
                </div>
                <div className="token-list">
                  {bulkSelectedMembers.length ? (
                    bulkSelectedMembers.map((member) => (
                      <button
                        className="removable-chip"
                        key={getMemberKey(member)}
                        onClick={() => removeBulkSelectedMember(member)}
                        type="button"
                      >
                        {memberKindLabels[member.kind]} · {member.value} ×
                      </button>
                    ))
                  ) : (
                    <span className="muted">尚未选择成员</span>
                  )}
                </div>
              </section>

              <section className="group-editor-card group-editor-card-highlight">
                <div className="section-header">
                  <div>
                    <h4>展开预览</h4>
                    <p className="muted">保存前确认这组成员真正会展开成哪些节点，避免一次改错多个分组。</p>
                  </div>
                  <span className="chip">{bulkSelectedPreview.proxies.length} 个节点</span>
                </div>
                <ProxyChipList extras={bulkSelectedPreview.extras} proxies={bulkSelectedPreview.proxies} />
                {bulkSelectedPreview.missing.length ? (
                  <div className="fragment-empty">
                    未匹配成员：
                    {bulkSelectedPreview.missing.map((member) => getMemberKey(member)).join(", ")}
                  </div>
                ) : null}
              </section>
            </div>

            <div className={`member-picker member-picker-library ${bulkDirectoryMode}`.trim()}>
              <div className="section-header">
                <div>
                  <h4>节点目录</h4>
                  <p className="muted">筛选右侧成员后批量分配给左侧所选分组，这里仍然支持按当前结果一键全选。</p>
                </div>
                <div className="inline-actions">
                  <span className="chip">
                    {visibleBulkSelectedCount}/{bulkVisibleMemberOptions.length} 已选
                  </span>
                  <button
                    className="button-secondary"
                    disabled={!bulkVisibleMemberOptions.length}
                    onClick={toggleAllVisibleBulkMembers}
                    type="button"
                  >
                    {allVisibleBulkMembersSelected ? "取消全选" : "全选当前结果"}
                  </button>
                </div>
              </div>

              <div className="picker-toolbar">
                <div className="field">
                  <label>搜索成员</label>
                  <input
                    onChange={(event) => setBulkMemberSearch(event.target.value)}
                    placeholder="搜索节点名、订阅名、分组名"
                    value={bulkMemberSearch}
                  />
                </div>
                <div className="field">
                  <label>来源筛选</label>
                  <select
                    disabled={!bulkSourceFilterEnabled}
                    onChange={(event) => setBulkMemberSourceFilter(event.target.value)}
                    value={bulkMemberSourceFilter}
                  >
                    {sourceFilterOptions.map((value) => (
                      <option key={value} value={value}>
                        {value === "all" ? "全部来源" : value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="filter-bar">
                {[
                  ["all", "全部"],
                  ["subscription", "订阅节点"],
                  ["manual", "自定义节点"],
                  ["sourceGroup", "订阅分组"],
                  ["regionGroup", "地域分组"],
                  ["group", "自定义分组"],
                  ["special", "内置策略"],
                ].map(([value, label]) => (
                  <button
                    className={`filter-chip ${bulkMemberCategory === value ? "is-active" : ""}`}
                    key={value}
                    onClick={() => setBulkMemberCategory(value as MemberOption["category"] | "all")}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={`member-option-list member-option-grid ${bulkDirectoryMode}`.trim()}>
                {bulkVisibleMemberOptions.map((option) => {
                  const isChecked = bulkSelectedMemberKeySet.has(getMemberKey(option.member));

                  return (
                    <label className={`member-option ${isChecked ? "is-selected" : ""}`} key={`bulk:${option.key}`}>
                      <input checked={isChecked} onChange={() => toggleBulkMember(option.member)} type="checkbox" />
                      <div className="member-option-body">
                        <div className="member-option-meta">
                          <span className="member-option-kind">{memberCategoryLabels[option.category]}</span>
                          {option.sourceName && option.sourceName !== memberCategoryLabels[option.category] ? (
                            <span className="member-option-source">{option.sourceName}</span>
                          ) : null}
                        </div>
                        <strong>{option.label}</strong>
                        <div className="muted">{option.description}</div>
                      </div>
                    </label>
                  );
                })}
                {!bulkVisibleMemberOptions.length ? (
                  <div className="picker-empty-state">
                    <span className="section-label">{bulkDirectoryEmptyState.eyebrow}</span>
                    <strong>{bulkDirectoryEmptyState.title}</strong>
                    <p>{bulkDirectoryEmptyState.description}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {selectedBulkGroups.length ? (
            <div className="notice-banner">
              将要更新：
              {" "}
              {selectedBulkGroups.map((group) => group.name).join("、")}
            </div>
          ) : null}

          <div className="modal-actions">
            <button className="button-secondary" onClick={closeBulkAssignModal} type="button">
              取消
            </button>
            <button
              className="button"
              disabled={bulkAssignGroupMembers.isPending || !bulkTargetGroupIds.length || !bulkSelectedMembers.length}
              type="submit"
            >
              {bulkAssignGroupMembers.isPending ? "分配中..." : "批量分配节点"}
            </button>
          </div>
        </form>
      </Modal>

      <SortListModal
        description="排序只在这个弹窗里完成，外层列表继续专注浏览分组内容。"
        isSaving={reorderGroup.isPending}
        items={proxyGroupItems.map((group) => ({ id: String(group.id), title: group.name }))}
        onClose={() => setIsGroupSortModalOpen(false)}
        onSave={async (items) => {
          const orderedGroups = items
            .map((item) => proxyGroupItems.find((group) => String(group.id) === item.id))
            .filter((item): item is ProxyGroupDraft => Boolean(item));
          await reorderGroup.mutateAsync(orderedGroups);
          setIsGroupSortModalOpen(false);
        }}
        open={isGroupSortModalOpen}
        title="排序自定义分组"
      />

      <SortListModal
        description="这里只展示节点标题，拖拽后保存新的自定义节点顺序。"
        isSaving={upsertFragment.isPending}
        items={customProxyRecords.items.map((proxy, index) => ({
          id: String(index),
          title: String(proxy.name || `自定义节点 ${index + 1}`),
        }))}
        onClose={() => setIsCustomProxySortModalOpen(false)}
        onSave={async (items) => {
          const orderedItems = items
            .map((item) => customProxyRecords.items[Number(item.id)] ?? null)
            .filter((item): item is (typeof customProxyRecords.items)[number] => Boolean(item));
          await saveCustomProxyOrder(orderedItems);
          setIsCustomProxySortModalOpen(false);
        }}
        open={isCustomProxySortModalOpen}
        title="排序自定义节点"
      />

      <SortListModal
        description="成员顺序会直接影响分组展开后的展示顺序，这里只保留标题，方便连续拖拽。"
        items={selectedMembers.map((member) => ({
          id: getMemberKey(member),
          title: `${memberKindLabels[member.kind]} · ${member.value}`,
        }))}
        onClose={() => setIsSelectedMemberSortModalOpen(false)}
        onSave={async (items) => {
          const orderedMembers = items
            .map((item) => selectedMembers.find((member) => getMemberKey(member) === item.id))
            .filter((item): item is ProxyGroupMember => Boolean(item));
          setSelectedMembers(orderedMembers);
          setIsSelectedMemberSortModalOpen(false);
        }}
        open={isSelectedMemberSortModalOpen}
        title="排序已选成员"
      />

      <Modal
        description="新增和编辑都只处理一个具体节点，保存时自动回写到自定义节点片段。"
        onClose={closeCustomProxyModal}
        open={isCustomProxyModalOpen}
        title={customProxySelectionRequest?.mode === "new" ? "新增自定义节点" : "编辑自定义节点"}
        size="wide"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await saveCustomProxyDraft();
          }}
        >
          {customProxyDraftFragment ? (
            <ManualProxiesEditor
              dialerProxyOptions={dialerProxyOptions}
              layout="detail"
              onChange={(yamlText) => setCustomProxyDraftFragment((current) => (current ? { ...current, yamlText } : current))}
              registerDraftSubmit={(submit) => {
                customProxyDraftSubmitRef.current = submit;
              }}
              selectionRequest={customProxySelectionRequest}
              value={customProxyDraftFragment.yamlText}
            />
          ) : null}
          <div className="modal-actions">
            {customProxySelectionRequest?.mode === "edit" && customProxySelectionRequest.index !== undefined ? (
              <button
                className="button-danger"
                onClick={() => deleteCustomProxyAt(customProxySelectionRequest.index!)}
                type="button"
              >
                删除这个节点
              </button>
            ) : null}
            <button className="button-secondary" onClick={closeCustomProxyModal} type="button">
              取消
            </button>
            <button className="button" disabled={upsertFragment.isPending} type="submit">
              {upsertFragment.isPending ? "保存中..." : "保存节点"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="支持直接粘贴节点列表 YAML，或带 `proxies:` 根键的配置片段，解析后快速导入。"
        onClose={closeCustomProxyImportModal}
        open={isCustomProxyImportModalOpen}
        title="快捷导入自定义节点"
        size="wide"
      >
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await importCustomProxyYaml();
          }}
        >
          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>粘贴 YAML</h4>
                <p className="muted">可直接粘贴 `proxies:` 片段，或只粘贴节点列表本身。</p>
              </div>
              <button className="button-secondary" onClick={parseCustomProxyImport} type="button">
                解析 YAML
              </button>
            </div>
            <div className="field">
              <label>节点 YAML</label>
              <textarea
                data-autofocus
                onChange={(event) => setCustomProxyImportYaml(event.target.value)}
                placeholder="- name: my-node&#10;  type: ss&#10;  server: example.com&#10;  port: 443"
                value={customProxyImportYaml}
              />
            </div>
            {customProxyImportResult.error ? <div className="notice-banner error">{customProxyImportResult.error}</div> : null}
          </section>
          <section className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>导入预览</h4>
                <p className="muted">同名节点会用导入结果覆盖，未重名的节点会直接追加。</p>
              </div>
              <span className="chip">{customProxyImportResult.items.length} 个节点</span>
            </div>
            {customProxyImportResult.items.length ? (
              <div className="structured-list">
                {customProxyImportResult.items.map((proxy, index) => (
                  <div className="structured-row" key={`${String(proxy.name || "node")}:${index}`}>
                    <div>
                      <strong>{String(proxy.name || `自定义节点 ${index + 1}`)}</strong>
                      <div className="muted">
                        {String(proxy.server || "未填写 server")}
                        {proxy.port ? `:${String(proxy.port)}` : ""}
                      </div>
                    </div>
                    <div className="structured-meta">
                      <span className="chip">{String(proxy.type || "unknown")}</span>
                      {proxy.plugin ? <span className="chip">{String(proxy.plugin)}</span> : null}
                      <button className="button-danger" onClick={() => removeCustomProxyImportItem(index)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">
                <strong>还没有解析结果</strong>
                <p className="muted">先粘贴一段节点 YAML，再点击“解析 YAML”查看要导入的节点。</p>
              </div>
            )}
          </section>
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeCustomProxyImportModal} type="button">
              取消
            </button>
            <button className="button" disabled={upsertFragment.isPending || !customProxyImportResult.items.length} type="submit">
              {upsertFragment.isPending ? "导入中..." : "导入这些节点"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="地域规则以逗号分隔的关键词存储，列表里会直接展示这个地域分组命中的节点。"
        onClose={closeRegionModal}
        open={isRegionModalOpen}
        title={editingRegion ? "编辑地域规则" : "新增地域规则"}
      >
        <form
          className="stack"
          onSubmit={regionForm.handleSubmit(async (values) =>
            saveRegion.mutateAsync({
              id: editingRegion?.id,
              name: values.name,
              keywords: values.keywordsText
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
              enabled: editingRegion?.enabled ?? true,
              sortOrder: values.sortOrder,
            }),
          )}
        >
          <div className="form-grid">
            <div className="field">
              <label>地域名</label>
              <input {...regionForm.register("name")} />
            </div>
            <div className="field">
              <label>排序</label>
              <input type="number" {...regionForm.register("sortOrder", { valueAsNumber: true })} />
            </div>
          </div>
          <div className="field">
            <label>关键词（逗号分隔）</label>
            <textarea {...regionForm.register("keywordsText")} />
          </div>
          <div className="group-editor-card">
            <div className="section-header">
              <div>
                <h4>命中预览</h4>
                <p className="muted">保存前先看当前关键词会抓到哪些节点，避免改完才发现命中范围不对。</p>
              </div>
              <button
                className="button-secondary"
                onClick={() => setIsRegionPreviewVisible((current) => !current)}
                type="button"
              >
                {isRegionPreviewVisible ? "收起预览" : "预览命中节点"}
              </button>
            </div>
            {isRegionPreviewVisible ? (
              regionDraftKeywords.length ? (
                <div className="stack">
                  <div className="inline-actions">
                    <span className="metric-badge">{regionDraftPreview.length} 个命中节点</span>
                    <span className="chip">{regionName?.trim() || "未命名地域"}</span>
                  </div>
                  <RegionPreviewList proxies={regionDraftPreview} />
                </div>
              ) : (
                <div className="empty-state compact-empty-state">
                  <strong>先填写关键词</strong>
                  <p className="muted">至少输入一个关键词后再预览，才能判断这个地域规则会命中哪些节点。</p>
                </div>
              )
            ) : null}
          </div>
          <div className="modal-actions">
            {editingRegion?.id ? (
              <button
                className="button-danger"
                disabled={deleteRegion.isPending}
                onClick={() => deleteRegion.mutate(editingRegion.id!)}
                type="button"
              >
                删除地域规则
              </button>
            ) : null}
            <button className="button-secondary" onClick={closeRegionModal} type="button">
              取消
            </button>
            <button className="button" type="submit">
              保存地域规则
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="成员改成从节点目录里选择，支持按订阅来源和自定义节点筛选，并实时预览最终会落入分组的节点。"
        onClose={closeGroupModal}
        open={isGroupModalOpen}
        title={editingGroup ? "编辑自定义分组" : "新增自定义分组"}
        size="wide"
      >
        <form
          className="stack group-builder-form"
          onSubmit={groupForm.handleSubmit(async (values) =>
            saveGroup.mutateAsync({
              ...values,
              enabled: editingGroup?.enabled ?? true,
              id: editingGroup?.id,
              members: dedupeMembers(selectedMembers),
            }),
          )}
        >
          <section className="group-builder-overview">
            <div className="group-builder-copy">
              <span className="section-label">构建器</span>
              <h4>先挑输入，再确认真正会产出的节点</h4>
              <p className="muted">右侧负责浏览和筛选节点来源，左侧负责沉淀成一个可复用的策略组。</p>
            </div>
            <div className="group-builder-metrics">
              <div className="group-builder-metric">
                <span>已选成员</span>
                <strong>{selectedMembers.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>展开节点</span>
                <strong>{selectedPreview.proxies.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>当前分类</span>
                <strong>{activeMemberCategoryLabel}</strong>
              </div>
            </div>
          </section>

          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card group-editor-card-primary">
                <div className="section-header">
                  <div>
                    <h4>分组基础信息</h4>
                    <p className="muted">先定义分组类型，再去挑选成员。</p>
                  </div>
                </div>
                <div className="stack">
                  <div className="form-grid">
                    <div className="field">
                      <label>分组名</label>
                      <input {...groupForm.register("name")} />
                    </div>
                    <div className="field">
                      <label>类型</label>
                      <select {...groupForm.register("type")}>
                        <option value="select">select</option>
                        <option value="url-test">url-test</option>
                        <option value="fallback">fallback</option>
                      </select>
                    </div>
                    <div className="field">
                      <label>排序</label>
                      <input type="number" {...groupForm.register("sortOrder", { valueAsNumber: true })} />
                    </div>
                  </div>
                  <div className="form-grid">
                    <div className="field">
                      <label>测速 URL</label>
                      <input {...groupForm.register("url")} />
                    </div>
                    <div className="field">
                      <label>间隔</label>
                      <input type="number" {...groupForm.register("interval", { valueAsNumber: true })} />
                    </div>
                    <div className="field">
                      <label>超时</label>
                      <input type="number" {...groupForm.register("timeout", { valueAsNumber: true })} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="group-editor-card group-editor-card-soft">
                <div className="section-header">
                  <div>
                    <h4>已选成员</h4>
                    <p className="muted">成员是分组的输入。顺序调整放到独立排序弹窗里，这里只保留概览和移除。</p>
                  </div>
                  <div className="inline-actions">
                    <span className="chip">{selectedMembers.length} 项</span>
                    {missingSelectedProxyMembers.length ? (
                      <button className="button-secondary" onClick={clearMissingSelectedProxyMembers} type="button">
                        清除不存在节点
                      </button>
                    ) : null}
                    {selectedMembers.length ? (
                      <button className="button-danger" onClick={clearSelectedMembers} type="button">
                        清空全部
                      </button>
                    ) : null}
                    {selectedMembers.length > 1 ? (
                      <button className="button-secondary" onClick={() => setIsSelectedMemberSortModalOpen(true)} type="button">
                        排序成员
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="token-list">
                  {selectedMembers.length ? (
                    selectedMembers.map((member) => (
                      <button
                        className="removable-chip"
                        key={getMemberKey(member)}
                        onClick={() => removeSelectedMember(member)}
                        type="button"
                      >
                        {memberKindLabels[member.kind]} · {member.value} ×
                      </button>
                    ))
                  ) : (
                    <span className="muted">尚未选择成员</span>
                  )}
                </div>
              </section>

              <section className="group-editor-card group-editor-card-highlight">
                <div className="section-header">
                  <div>
                    <h4>节点预览</h4>
                    <p className="muted">实时展开成员后，确认这个分组真正会包含哪些节点。</p>
                  </div>
                  <span className="chip">{selectedPreview.proxies.length} 个节点</span>
                </div>
                <ProxyChipList extras={selectedPreview.extras} proxies={selectedPreview.proxies} />
                {selectedPreview.missing.length ? (
                  <div className="fragment-empty">
                    未匹配成员：
                    {selectedPreview.missing.map((member) => getMemberKey(member)).join(", ")}
                  </div>
                ) : null}
              </section>
            </div>

            <div className={`member-picker member-picker-library ${memberDirectoryMode}`.trim()}>
              <div className="section-header">
                <div>
                  <h4>节点目录</h4>
                  <p className="muted">先筛来源，再勾选成员。这里保留“浏览库”的感觉，不跟预览挤在一起。</p>
                </div>
                <div className="inline-actions">
                  <span className="chip">
                    {visibleSelectedCount}/{visibleMemberOptions.length} 已选
                  </span>
                  <button
                    className="button-secondary"
                    disabled={!visibleMemberOptions.length}
                    onClick={toggleAllVisibleMembers}
                    type="button"
                  >
                    {allVisibleSelected ? "取消全选" : "全选当前结果"}
                  </button>
                </div>
              </div>

              <div className="picker-toolbar">
                <div className="field">
                  <label>搜索成员</label>
                  <input onChange={(event) => setMemberSearch(event.target.value)} placeholder="搜索节点名、订阅名、分组名" value={memberSearch} />
                </div>
                <div className="field">
                  <label>来源筛选</label>
                  <select
                    disabled={!sourceFilterEnabled}
                    onChange={(event) => setMemberSourceFilter(event.target.value)}
                    value={memberSourceFilter}
                  >
                    {availableSourceFilters.map((value) => (
                      <option key={value} value={value}>
                        {value === "all" ? "全部来源" : value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="filter-bar">
                {[
                  ["all", "全部"],
                  ["subscription", "订阅节点"],
                  ["manual", "自定义节点"],
                  ["sourceGroup", "订阅分组"],
                  ["regionGroup", "地域分组"],
                  ["group", "自定义分组"],
                  ["special", "内置策略"],
                ].map(([value, label]) => (
                  <button
                    className={`filter-chip ${memberCategory === value ? "is-active" : ""}`}
                    key={value}
                    onClick={() => setMemberCategory(value as MemberOption["category"] | "all")}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={`member-option-list member-option-grid ${memberDirectoryMode}`.trim()}>
                {visibleMemberOptions.map((option) => {
                  const isChecked = selectedMemberKeySet.has(getMemberKey(option.member));

                  return (
                    <label className={`member-option ${isChecked ? "is-selected" : ""}`} key={option.key}>
                      <input checked={isChecked} onChange={() => toggleMember(option.member)} type="checkbox" />
                      <div className="member-option-body">
                        <div className="member-option-meta">
                          <span className="member-option-kind">{memberCategoryLabels[option.category]}</span>
                          {option.sourceName && option.sourceName !== memberCategoryLabels[option.category] ? (
                            <span className="member-option-source">{option.sourceName}</span>
                          ) : null}
                        </div>
                        <strong>{option.label}</strong>
                        <div className="muted">{option.description}</div>
                      </div>
                    </label>
                  );
                })}
                {!visibleMemberOptions.length ? (
                  <div className="picker-empty-state">
                    <span className="section-label">{memberDirectoryEmptyState.eyebrow}</span>
                    <strong>{memberDirectoryEmptyState.title}</strong>
                    <p>{memberDirectoryEmptyState.description}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="modal-actions">
            {editingGroup?.id ? (
              <button
                className="button-danger"
                disabled={deleteGroup.isPending}
                onClick={() => deleteGroup.mutate(editingGroup.id!)}
                type="button"
              >
                删除自定义分组
              </button>
            ) : null}
            <button className="button-secondary" onClick={closeGroupModal} type="button">
              取消
            </button>
            <button className="button" type="submit">
              保存分组
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        description="FINAL 是系统保留的最终出口分组，不能删除或改名，但成员和顺序都可以在这里调整。"
        onClose={closeFinalGroupModal}
        open={isFinalGroupModalOpen}
        title="编辑 FINAL 分组"
        size="wide"
      >
        <form
          className="stack group-builder-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await saveFinalGroup.mutateAsync(dedupeMembers(selectedMembers));
          }}
        >
          <section className="group-builder-overview">
            <div className="group-builder-copy">
              <span className="section-label">系统分组</span>
              <h4>维护真正暴露给客户端的最终出口</h4>
              <p className="muted">这里决定客户端里最终会让用户切到哪些入口。保留 `FINAL` 这个名字，但成员完全由你控制。</p>
            </div>
            <div className="group-builder-metrics">
              <div className="group-builder-metric">
                <span>已选成员</span>
                <strong>{selectedMembers.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>展开节点</span>
                <strong>{selectedPreview.proxies.length}</strong>
              </div>
              <div className="group-builder-metric">
                <span>当前分类</span>
                <strong>{activeMemberCategoryLabel}</strong>
              </div>
            </div>
          </section>

          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card group-editor-card-primary">
                <div className="section-header">
                  <div>
                    <h4>FINAL 基础说明</h4>
                    <p className="muted">这是系统保留分组，固定为 `select`。这里不编辑名字和类型，只维护成员和顺序。</p>
                  </div>
                </div>
                <div className="stack">
                  <div className="token-list">
                    <span className="chip">固定名称 · FINAL</span>
                    <span className="chip">固定类型 · select</span>
                    <span className="chip">系统最终出口</span>
                  </div>
                  <p className="muted">建议把常用的地区分组、订阅分组、自定义分组和 `MANUAL` / `DIRECT` 这些最终入口放在这里。</p>
                </div>
              </section>

              <section className="group-editor-card group-editor-card-soft">
                <div className="section-header">
                  <div>
                    <h4>已选成员</h4>
                    <p className="muted">成员顺序会直接决定客户端里看到的 FINAL 入口顺序。</p>
                  </div>
                  <div className="inline-actions">
                    <span className="chip">{selectedMembers.length} 项</span>
                    {selectedMembers.length ? (
                      <button className="button-danger" onClick={clearSelectedMembers} type="button">
                        清空全部
                      </button>
                    ) : null}
                    {selectedMembers.length > 1 ? (
                      <button className="button-secondary" onClick={() => setIsSelectedMemberSortModalOpen(true)} type="button">
                        排序成员
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="token-list">
                  {selectedMembers.length ? (
                    selectedMembers.map((member) => (
                      <button
                        className="removable-chip"
                        key={`final-selected:${getMemberKey(member)}`}
                        onClick={() => removeSelectedMember(member)}
                        type="button"
                      >
                        {memberKindLabels[member.kind]} · {member.value} ×
                      </button>
                    ))
                  ) : (
                    <span className="muted">尚未选择成员</span>
                  )}
                </div>
              </section>

              <section className="group-editor-card group-editor-card-highlight">
                <div className="section-header">
                  <div>
                    <h4>节点预览</h4>
                    <p className="muted">保存前确认 FINAL 真正会展开成哪些节点，避免客户端里的最终出口不符合预期。</p>
                  </div>
                  <span className="chip">{selectedPreview.proxies.length} 个节点</span>
                </div>
                <ProxyChipList extras={selectedPreview.extras} proxies={selectedPreview.proxies} />
                {selectedPreview.missing.length ? (
                  <div className="fragment-empty">
                    未匹配成员：
                    {selectedPreview.missing.map((member) => getMemberKey(member)).join(", ")}
                  </div>
                ) : null}
              </section>
            </div>

            <div className={`member-picker member-picker-library ${memberDirectoryMode}`.trim()}>
              <div className="section-header">
                <div>
                  <h4>可选入口</h4>
                  <p className="muted">这里会自动排除 `FINAL` 自身和旧的废弃入口，避免形成循环引用。</p>
                </div>
                <div className="inline-actions">
                  <span className="chip">
                    {visibleSelectedCount}/{visibleMemberOptions.length} 已选
                  </span>
                  <button
                    className="button-secondary"
                    disabled={!visibleMemberOptions.length}
                    onClick={toggleAllVisibleMembers}
                    type="button"
                  >
                    {allVisibleSelected ? "取消全选" : "全选当前结果"}
                  </button>
                </div>
              </div>

              <div className="picker-toolbar">
                <div className="field">
                  <label>搜索成员</label>
                  <input onChange={(event) => setMemberSearch(event.target.value)} placeholder="搜索节点名、订阅名、分组名" value={memberSearch} />
                </div>
                <div className="field">
                  <label>来源筛选</label>
                  <select
                    disabled={!sourceFilterEnabled}
                    onChange={(event) => setMemberSourceFilter(event.target.value)}
                    value={memberSourceFilter}
                  >
                    {sourceFilterOptions.map((value) => (
                      <option key={`final:${value}`} value={value}>
                        {value === "all" ? "全部来源" : value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="filter-bar">
                {[
                  ["all", "全部"],
                  ["subscription", "订阅节点"],
                  ["manual", "自定义节点"],
                  ["sourceGroup", "订阅分组"],
                  ["regionGroup", "地域分组"],
                  ["group", "自定义分组"],
                  ["special", "内置策略"],
                ].map(([value, label]) => (
                  <button
                    className={`filter-chip ${memberCategory === value ? "is-active" : ""}`}
                    key={`final-filter:${value}`}
                    onClick={() => setMemberCategory(value as MemberOption["category"] | "all")}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={`member-option-list member-option-grid ${memberDirectoryMode}`.trim()}>
                {visibleMemberOptions.map((option) => {
                  const isChecked = selectedMemberKeySet.has(getMemberKey(option.member));

                  return (
                    <label className={`member-option ${isChecked ? "is-selected" : ""}`} key={`final:${option.key}`}>
                      <input checked={isChecked} onChange={() => toggleMember(option.member)} type="checkbox" />
                      <div className="member-option-body">
                        <div className="member-option-meta">
                          <span className="member-option-kind">{memberCategoryLabels[option.category]}</span>
                          {option.sourceName && option.sourceName !== memberCategoryLabels[option.category] ? (
                            <span className="member-option-source">{option.sourceName}</span>
                          ) : null}
                        </div>
                        <strong>{option.label}</strong>
                        <div className="muted">{option.description}</div>
                      </div>
                    </label>
                  );
                })}
                {!visibleMemberOptions.length ? (
                  <div className="picker-empty-state">
                    <span className="section-label">{memberDirectoryEmptyState.eyebrow}</span>
                    <strong>{memberDirectoryEmptyState.title}</strong>
                    <p>{memberDirectoryEmptyState.description}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="button-secondary" onClick={closeFinalGroupModal} type="button">
              取消
            </button>
            <button className="button" disabled={saveFinalGroup.isPending} type="submit">
              {saveFinalGroup.isPending ? "保存中..." : "保存 FINAL"}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
