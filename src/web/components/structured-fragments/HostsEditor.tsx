import { useEffect, useMemo, useState } from "react";
import { parseHostsEntries, stringifyHostsEntries } from "../../lib/config-fragments";

type HostsEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
};

const emptyHostEntry = {
  host: "",
  target: "",
};

export function HostsEditor({ value, onChange }: HostsEditorProps) {
  const parsed = useMemo(() => parseHostsEntries(value), [value]);
  const [items, setItems] = useState<Array<{ host: string; target: string }>>(parsed.items);
  const [editingIndex, setEditingIndex] = useState<number | null>(parsed.items.length ? 0 : null);
  const [draft, setDraft] = useState(parsed.items[0] ?? emptyHostEntry);

  useEffect(() => {
    if (parsed.error) {
      return;
    }

    setItems(parsed.items);

    if (!parsed.items.length) {
      setEditingIndex(null);
      setDraft(emptyHostEntry);
      return;
    }

    const nextIndex = editingIndex !== null && parsed.items[editingIndex] ? editingIndex : 0;
    setEditingIndex(nextIndex);
    setDraft(parsed.items[nextIndex] ?? emptyHostEntry);
  }, [parsed.error, parsed.items]);

  function commit(nextItems: Array<{ host: string; target: string }>, nextEditingIndex: number | null) {
    setItems(nextItems);
    setEditingIndex(nextEditingIndex);
    onChange(stringifyHostsEntries(nextItems));
  }

  function selectEntry(index: number) {
    setEditingIndex(index);
    setDraft(items[index] ?? emptyHostEntry);
  }

  function startNewEntry() {
    setEditingIndex(null);
    setDraft(emptyHostEntry);
  }

  function saveEntry() {
    const normalized = {
      host: draft.host.trim(),
      target: draft.target.trim(),
    };

    if (!normalized.host || !normalized.target) {
      return;
    }

    const nextItems =
      editingIndex === null
        ? [...items.filter((item) => item.host !== normalized.host), normalized]
        : items.map((item, index) => (index === editingIndex ? normalized : item)).filter((item, index, list) => {
            return list.findIndex((candidate) => candidate.host === item.host) === index;
          });
    const nextIndex = nextItems.findIndex((item) => item.host === normalized.host);

    commit(nextItems, nextIndex >= 0 ? nextIndex : null);
    setDraft(normalized);
  }

  function removeEntry(index: number) {
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
    setDraft(nextIndex === null ? emptyHostEntry : nextItems[nextIndex] ?? emptyHostEntry);
  }

  if (parsed.error) {
    return <div className="fragment-empty">hosts 片段解析失败，暂时无法进入结构化编辑：{parsed.error}</div>;
  }

  return (
    <div className="fragment-editor-layout">
      <section className="fragment-editor-panel">
        <div className="section-header">
          <div>
            <h4>hosts 列表</h4>
            <p className="muted">把域名映射按单条维护，新增、修改、删除都不需要再碰 YAML 键值对。</p>
          </div>
          <span className="chip">{items.length} 条</span>
        </div>
        <button className="button-secondary fragment-editor-add" onClick={startNewEntry} type="button">
          新增 hosts 映射
        </button>
        <div className="fragment-editor-list">
          {items.length ? (
            items.map((entry, index) => (
              <article
                className={`fragment-editor-row ${editingIndex === index ? "is-active" : ""}`}
                key={entry.host}
                onClick={() => selectEntry(index)}
              >
                <div className="fragment-editor-row-body">
                  <strong>{entry.host}</strong>
                  <p className="muted">{entry.target}</p>
                </div>
                <div className="fragment-editor-actions">
                  <button
                    className="button-secondary"
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEntry(index);
                    }}
                    type="button"
                  >
                    编辑
                  </button>
                  <button
                    className="button-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeEntry(index);
                    }}
                    type="button"
                  >
                    删除
                  </button>
                </div>
              </article>
            ))
          ) : (
            <div className="picker-empty-state">
              <span className="section-label">hosts</span>
              <strong>还没有静态域名映射</strong>
              <p>先新增一条域名到地址的映射，保存后会自动写回 `hosts` 片段。</p>
            </div>
          )}
        </div>
      </section>

      <section className="fragment-editor-panel">
        <div className="section-header">
          <div>
            <h4>{editingIndex === null ? "新增 hosts 映射" : `编辑映射 #${editingIndex + 1}`}</h4>
            <p className="muted">常见输入如域名、本地域名和 IP 都可以直接逐条维护。</p>
          </div>
        </div>
        <div className="field">
          <label>域名</label>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))}
            placeholder="例如 api.example.com"
            value={draft.host}
          />
        </div>
        <div className="field">
          <label>目标地址</label>
          <input
            onChange={(event) => setDraft((current) => ({ ...current, target: event.target.value }))}
            placeholder="例如 198.51.100.10 或 127.0.0.1"
            value={draft.target}
          />
        </div>
        <div className="fragment-editor-actions">
          <button className="button-secondary" onClick={startNewEntry} type="button">
            清空当前
          </button>
          <button className="button" disabled={!draft.host.trim() || !draft.target.trim()} onClick={saveEntry} type="button">
            {editingIndex === null ? "添加到 hosts 列表" : "更新这条映射"}
          </button>
        </div>
      </section>
    </div>
  );
}
