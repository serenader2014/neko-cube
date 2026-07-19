import { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { parseBuiltinRules, stringifyBuiltinRules, type ParsedBuiltinRule } from "../../lib/config-fragments";
import { SortHandle } from "../SortHandle";
import { SortableFragmentRow, useSortableInteractionSensors } from "./sortable";

type BuiltinRulesEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
};

const builtinRulePresets = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "SRC-IP-CIDR",
  "SRC-PORT",
  "DST-PORT",
  "PROCESS-NAME",
  "PROCESS-PATH",
  "GEOIP",
  "MATCH",
] as const;

const emptyBuiltinRule: ParsedBuiltinRule = {
  raw: "",
  matcher: "DOMAIN-SUFFIX",
  value: "",
  policy: "DIRECT",
  noResolve: false,
};

function createBuiltinRuleSortId(rule: ParsedBuiltinRule, index: number) {
  return `rule:${index}:${rule.matcher}:${rule.value}:${rule.policy}`;
}

export function BuiltinRulesEditor({ value, onChange }: BuiltinRulesEditorProps) {
  const parsed = useMemo(() => parseBuiltinRules(value), [value]);
  const [items, setItems] = useState<ParsedBuiltinRule[]>(parsed.items);
  const [editingIndex, setEditingIndex] = useState<number | null>(parsed.items.length ? 0 : null);
  const [draft, setDraft] = useState<ParsedBuiltinRule>(parsed.items[0] ?? emptyBuiltinRule);
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [overRuleId, setOverRuleId] = useState<string | null>(null);
  const sensors = useSortableInteractionSensors();
  const ruleSortIds = useMemo(() => items.map((rule, index) => createBuiltinRuleSortId(rule, index)), [items]);

  useEffect(() => {
    if (parsed.error) {
      return;
    }

    setItems(parsed.items);

    if (!parsed.items.length) {
      setEditingIndex(null);
      setDraft(emptyBuiltinRule);
      return;
    }

    const nextIndex = editingIndex !== null && parsed.items[editingIndex] ? editingIndex : 0;
    setEditingIndex(nextIndex);
    setDraft(parsed.items[nextIndex] ?? emptyBuiltinRule);
  }, [parsed.error, parsed.items]);

  function commit(nextItems: ParsedBuiltinRule[], nextEditingIndex: number | null) {
    setItems(nextItems);
    setEditingIndex(nextEditingIndex);
    onChange(stringifyBuiltinRules(nextItems));
  }

  function selectRule(index: number) {
    setEditingIndex(index);
    setDraft(items[index] ?? emptyBuiltinRule);
  }

  function startNewRule() {
    setEditingIndex(null);
    setDraft(emptyBuiltinRule);
  }

  function saveRule() {
    const normalized: ParsedBuiltinRule = {
      raw: "",
      matcher: draft.matcher.trim(),
      value: draft.value.trim(),
      policy: draft.policy.trim(),
      noResolve: draft.noResolve,
    };

    if (!normalized.matcher || !normalized.policy) {
      return;
    }

    const nextItems =
      editingIndex === null
        ? [...items, normalized]
        : items.map((item, index) => (index === editingIndex ? normalized : item));
    const nextIndex = editingIndex === null ? nextItems.length - 1 : editingIndex;

    commit(nextItems, nextIndex);
    setDraft(normalized);
  }

  function removeRule(index: number) {
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
    const nextIndex =
      editingIndex === null
        ? null
        : index < editingIndex
          ? editingIndex - 1
          : index === editingIndex
            ? (nextItems.length ? Math.min(index, nextItems.length - 1) : null)
            : editingIndex;

    commit(nextItems, nextIndex);
    setDraft(nextIndex === null ? emptyBuiltinRule : nextItems[nextIndex] ?? emptyBuiltinRule);
  }

  function reorderRule(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return;
    }

    const nextItems = arrayMove(items, fromIndex, toIndex);

    const nextEditingIndex =
      editingIndex === null ? null : editingIndex === fromIndex ? toIndex : editingIndex === toIndex ? fromIndex : editingIndex;

    commit(nextItems, nextEditingIndex);
    if (nextEditingIndex !== null) {
      setDraft(nextItems[nextEditingIndex] ?? emptyBuiltinRule);
    }
    setActiveRuleId(null);
    setOverRuleId(null);
  }

  function resetRuleDragState() {
    setActiveRuleId(null);
    setOverRuleId(null);
  }

  function handleRuleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveRuleId(id);
    setOverRuleId(id);
  }

  function handleRuleDragOver(event: DragOverEvent) {
    setOverRuleId(event.over ? String(event.over.id) : null);
  }

  function handleRuleDragEnd(event: DragEndEvent) {
    const nextOverId = event.over ? String(event.over.id) : null;
    if (!nextOverId) {
      resetRuleDragState();
      return;
    }

    const fromIndex = ruleSortIds.indexOf(String(event.active.id));
    const toIndex = ruleSortIds.indexOf(nextOverId);

    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      reorderRule(fromIndex, toIndex);
      return;
    }

    resetRuleDragState();
  }

  if (parsed.error) {
    return <div className="fragment-empty">规则片段解析失败，暂时无法进入结构化编辑：{parsed.error}</div>;
  }

  return (
    <div className="fragment-editor-layout">
      <section className="fragment-editor-panel">
        <div className="section-header">
          <div>
            <h4>规则列表</h4>
            <p className="muted">每条规则都可以单独编辑、删除和调整顺序。</p>
          </div>
          <span className="chip">{items.length} 条</span>
        </div>
        <button className="button-secondary fragment-editor-add" onClick={startNewRule} type="button">
          新增规则
        </button>
        <div className="fragment-editor-list">
          {items.length ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragCancel={resetRuleDragState}
              onDragEnd={handleRuleDragEnd}
              onDragOver={handleRuleDragOver}
              onDragStart={handleRuleDragStart}
              sensors={sensors}
            >
              <SortableContext items={ruleSortIds} strategy={verticalListSortingStrategy}>
                {items.map((rule, index) => {
                  const id = ruleSortIds[index]!;
                  return (
                    <SortableFragmentRow
                      id={id}
                      isActive={editingIndex === index}
                      isDragTarget={overRuleId === id && activeRuleId !== id}
                      key={id}
                    >
                      {({ buttonProps, handleRef }) => (
                        <>
                          <div className="fragment-editor-row-body">
                            <strong>{rule.matcher}</strong>
                            <p className="muted">{rule.value || "无目标值"}</p>
                            <div className="token-list">
                              <span className="chip">{rule.policy}</span>
                              {rule.noResolve ? <span className="chip">no-resolve</span> : null}
                            </div>
                          </div>
                          <div className="fragment-editor-actions">
                            <SortHandle buttonProps={buttonProps} handleRef={handleRef} title={`拖动调整规则 #${index + 1} 的顺序`} />
                            <button className="button-secondary" onClick={() => selectRule(index)} type="button">
                              编辑
                            </button>
                            <button className="button-danger" onClick={() => removeRule(index)} type="button">
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </SortableFragmentRow>
                  );
                })}
              </SortableContext>
            </DndContext>
          ) : (
            <div className="picker-empty-state">
              <span className="section-label">基础规则</span>
              <strong>还没有规则</strong>
              <p>先新增一条规则，再逐条补齐匹配类型、目标和策略。</p>
            </div>
          )}
        </div>
      </section>

      <section className="fragment-editor-panel">
        <div className="section-header">
          <div>
            <h4>{editingIndex === null ? "新增规则" : `编辑规则 #${editingIndex + 1}`}</h4>
            <p className="muted">用结构化字段维护规则，保存时自动写回 YAML 列表。</p>
          </div>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>匹配类型</label>
            <input
              list="builtin-rule-matchers"
              onChange={(event) => setDraft((current) => ({ ...current, matcher: event.target.value }))}
              value={draft.matcher}
            />
            <datalist id="builtin-rule-matchers">
              {builtinRulePresets.map((matcher) => (
                <option key={matcher} value={matcher} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>策略</label>
            <input onChange={(event) => setDraft((current) => ({ ...current, policy: event.target.value }))} value={draft.policy} />
          </div>
        </div>
        <div className="field">
          <label>目标值</label>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, value: event.target.value }))}
            placeholder={draft.matcher === "MATCH" ? "MATCH 类型通常不需要目标值" : "例如 example.com 或 192.0.2.1/32"}
            value={draft.value}
          />
        </div>
        <label className="chip">
          <input
            checked={draft.noResolve}
            onChange={(event) => setDraft((current) => ({ ...current, noResolve: event.target.checked }))}
            type="checkbox"
          />
          no-resolve
        </label>
        <div className="fragment-editor-actions">
          <button className="button-secondary" onClick={startNewRule} type="button">
            清空当前
          </button>
          <button className="button" disabled={!draft.matcher.trim() || !draft.policy.trim()} onClick={saveRule} type="button">
            {editingIndex === null ? "添加到规则列表" : "更新这条规则"}
          </button>
        </div>
      </section>
    </div>
  );
}
