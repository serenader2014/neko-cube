import { useEffect, useMemo, useState } from "react";
import { DndContext, closestCenter, type DragEndEvent, type DragOverEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ParsedProxy } from "@shared/types";
import { parseManualProxyRecords, stringifyManualProxyRecords } from "../../lib/config-fragments";
import { SortHandle } from "../SortHandle";
import { SortableFragmentRow, useSortableInteractionSensors } from "./sortable";
import {
  buildCommittedProxyState,
  clientFingerprintOptions,
  createEmptyExtraField,
  createManualProxyDraft,
  createManualProxySortId,
  emptyManualProxyDraft,
  getManualProxyDefaultPort,
  manualProxyTypeOptions,
  pluginModeOptions,
  pluginOptions,
  proxyNetworkOptions,
  ssCipherOptions,
  type ManualProxyDraft,
  type ManualProxyExtraFieldDraft,
} from "./manualProxyDraft";

type ManualProxiesEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  layout?: "full" | "detail";
  dialerProxyOptions?: string[];
  registerDraftSubmit?: (submit: null | (() => string)) => void;
  selectionRequest?: {
    mode: "new" | "edit";
    index?: number;
    token: number;
  } | null;
};

export function ManualProxiesEditor({
  value,
  onChange,
  layout = "full",
  dialerProxyOptions = [],
  registerDraftSubmit,
  selectionRequest = null,
}: ManualProxiesEditorProps) {
  const parsed = useMemo(() => parseManualProxyRecords(value), [value]);
  const [items, setItems] = useState<ParsedProxy[]>(parsed.items);
  const [editingIndex, setEditingIndex] = useState<number | null>(parsed.items.length ? 0 : null);
  const [draft, setDraft] = useState<ManualProxyDraft>(parsed.items[0] ? createManualProxyDraft(parsed.items[0]) : emptyManualProxyDraft);
  const [activeProxyId, setActiveProxyId] = useState<string | null>(null);
  const [overProxyId, setOverProxyId] = useState<string | null>(null);
  const sensors = useSortableInteractionSensors();
  const proxySortIds = useMemo(() => items.map((proxy, index) => createManualProxySortId(proxy, index)), [items]);

  useEffect(() => {
    if (parsed.error) {
      return;
    }

    setItems(parsed.items);

    if (!parsed.items.length) {
      setEditingIndex(null);
      setDraft(emptyManualProxyDraft);
      return;
    }

    const nextIndex = editingIndex !== null && parsed.items[editingIndex] ? editingIndex : 0;
    setEditingIndex(nextIndex);
    setDraft(createManualProxyDraft(parsed.items[nextIndex]!));
  }, [parsed.error, parsed.items]);

  useEffect(() => {
    if (parsed.error || !selectionRequest) {
      return;
    }

    if (selectionRequest.mode === "new") {
      setEditingIndex(null);
      setDraft(emptyManualProxyDraft);
      return;
    }

    const requestedIndex = selectionRequest.index ?? 0;
    const nextItem = parsed.items[requestedIndex];

    if (!nextItem) {
      if (parsed.items.length) {
        setEditingIndex(0);
        setDraft(createManualProxyDraft(parsed.items[0]!));
      } else {
        setEditingIndex(null);
        setDraft(emptyManualProxyDraft);
      }
      return;
    }

    setEditingIndex(requestedIndex);
    setDraft(createManualProxyDraft(nextItem));
  }, [parsed.error, parsed.items, selectionRequest]);

  function commit(nextItems: ParsedProxy[], nextEditingIndex: number | null) {
    setItems(nextItems);
    setEditingIndex(nextEditingIndex);
    onChange(stringifyManualProxyRecords(nextItems));
  }

  function selectProxy(index: number) {
    setEditingIndex(index);
    setDraft(createManualProxyDraft(items[index]!));
  }

  function startNewProxy() {
    setEditingIndex(null);
    setDraft(emptyManualProxyDraft);
  }

  function saveProxy() {
    const nextState = buildCommittedProxyState(items, draft, editingIndex);
    if (!nextState) {
      return;
    }

    commit(nextState.items, nextState.editingIndex);
    setDraft(createManualProxyDraft(nextState.record));
  }

  function removeProxy(index: number) {
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
    setDraft(nextIndex === null ? emptyManualProxyDraft : createManualProxyDraft(nextItems[nextIndex]!));
  }

  function reorderProxy(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) {
      return;
    }

    const nextItems = arrayMove(items, fromIndex, toIndex);

    const nextEditingIndex =
      editingIndex === null ? null : editingIndex === fromIndex ? toIndex : editingIndex === toIndex ? fromIndex : editingIndex;

    commit(nextItems, nextEditingIndex);
    if (nextEditingIndex !== null) {
      setDraft(createManualProxyDraft(nextItems[nextEditingIndex]!));
    }
    setActiveProxyId(null);
    setOverProxyId(null);
  }

  function resetProxyDragState() {
    setActiveProxyId(null);
    setOverProxyId(null);
  }

  function handleProxyDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveProxyId(id);
    setOverProxyId(id);
  }

  function handleProxyDragOver(event: DragOverEvent) {
    setOverProxyId(event.over ? String(event.over.id) : null);
  }

  function handleProxyDragEnd(event: DragEndEvent) {
    const nextOverId = event.over ? String(event.over.id) : null;
    if (!nextOverId) {
      resetProxyDragState();
      return;
    }

    const fromIndex = proxySortIds.indexOf(String(event.active.id));
    const toIndex = proxySortIds.indexOf(nextOverId);

    if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
      reorderProxy(fromIndex, toIndex);
      return;
    }

    resetProxyDragState();
  }

  function updateExtraField(id: string, patch: Partial<ManualProxyExtraFieldDraft>) {
    setDraft((current) => ({
      ...current,
      extraFields: current.extraFields.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    }));
  }

  function addExtraField() {
    setDraft((current) => ({
      ...current,
      extraFields: [...current.extraFields, createEmptyExtraField()],
    }));
  }

  function removeExtraField(id: string) {
    setDraft((current) => ({
      ...current,
      extraFields: current.extraFields.filter((field) => field.id !== id),
    }));
  }

  useEffect(() => {
    if (!registerDraftSubmit) {
      return;
    }

    registerDraftSubmit(() => {
      const nextState = buildCommittedProxyState(items, draft, editingIndex);
      return nextState ? stringifyManualProxyRecords(nextState.items) : stringifyManualProxyRecords(items);
    });

    return () => {
      registerDraftSubmit(null);
    };
  }, [draft, editingIndex, items, registerDraftSubmit]);

  if (parsed.error) {
    return <div className="fragment-empty">自定义节点片段解析失败，暂时无法进入结构化编辑：{parsed.error}</div>;
  }

  const currentType = draft.type.trim().toLowerCase();
  const typeDefinition =
    manualProxyTypeOptions.find((option) => option.value === currentType) ??
    (draft.type.trim()
      ? { value: draft.type.trim(), label: draft.type.trim(), description: "当前节点使用了预设之外的协议，保留名称并继续用高级字段补充参数。" }
      : manualProxyTypeOptions[0]);
  const availableTypeOptions =
    manualProxyTypeOptions.some((option) => option.value === draft.type.trim())
      ? manualProxyTypeOptions
      : [{ value: draft.type.trim(), label: `当前类型 · ${draft.type.trim()}`, description: "保留已有协议类型" }, ...manualProxyTypeOptions];
  const availableDialerProxyOptions =
    draft.dialerProxy && !dialerProxyOptions.includes(draft.dialerProxy)
      ? [draft.dialerProxy, ...dialerProxyOptions]
      : dialerProxyOptions;
  const showCipher = currentType === "ss";
  const showPassword = ["ss", "trojan", "http", "socks5", "hysteria2", "tuic"].includes(currentType);
  const showUuid = ["vless", "vmess", "tuic"].includes(currentType);
  const showUsername = ["http", "socks5"].includes(currentType);
  const showPlugin = currentType === "ss";
  const showTransport = ["vless", "vmess"].includes(currentType);
  const showTlsSection = ["trojan", "vless", "vmess", "hysteria2", "tuic"].includes(currentType);
  const showFingerprint = ["trojan", "vless", "vmess", "tuic"].includes(currentType);
  const showUdp = ["ss", "trojan", "socks5", "vless", "vmess", "hysteria2", "tuic"].includes(currentType);
  const showHysteriaFields = currentType === "hysteria2";
  const showServerName = ["trojan", "vless", "vmess", "hysteria2", "tuic"].includes(currentType);
  const showTlsToggle = ["vless", "vmess", "tuic"].includes(currentType);

  function handleTypeChange(nextType: string) {
    setDraft((current) => {
      const previousDefaultPort = getManualProxyDefaultPort(current.type);
      const nextDefaultPort = getManualProxyDefaultPort(nextType);
      return {
        ...current,
        type: nextType,
        port: !current.port.trim() || current.port.trim() === previousDefaultPort ? nextDefaultPort : current.port,
        cipher: nextType === "ss" && !current.cipher.trim() ? "aes-256-gcm" : current.cipher,
        network: ["vless", "vmess"].includes(nextType) ? current.network || "tcp" : current.network,
        pluginMode: current.pluginMode || "websocket",
        udpEnabled: nextType === "hysteria2" ? true : current.udpEnabled,
      };
    });
  }

  const editorPanel = (
    <section className="fragment-editor-panel">
      <div className="section-header">
        <div>
          <h4>{editingIndex === null ? "新增自定义节点" : `编辑节点 #${editingIndex + 1}`}</h4>
          <p className="muted">先选协议，再填这个协议真正需要的字段。不常见参数继续放到“高级字段”。</p>
        </div>
      </div>
      <div className="section-stack">
        <section className="editor-subsection">
          <div className="compact-section-header">
            <div>
              <h4>连接方式</h4>
              <p className="muted">先明确这是哪种节点，再填写地址、端口和代理链。</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field-span-2">
              <label>协议类型</label>
              <select onChange={(event) => handleTypeChange(event.target.value)} value={draft.type}>
                {availableTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">{typeDefinition.description}</p>
            </div>
            <div className="field">
              <label>节点名称</label>
              <input onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如 香港家宽落地" value={draft.name} />
            </div>
            <div className="field">
              <label>服务器地址</label>
              <input onChange={(event) => setDraft((current) => ({ ...current, server: event.target.value }))} placeholder="例如 proxy.example.com 或 192.0.2.1" value={draft.server} />
            </div>
            <div className="field">
              <label>端口</label>
              <input inputMode="numeric" onChange={(event) => setDraft((current) => ({ ...current, port: event.target.value }))} value={draft.port} />
            </div>
            <div className="field">
              <label>代理链</label>
              <select
                onChange={(event) => setDraft((current) => ({ ...current, dialerProxy: event.target.value }))}
                value={draft.dialerProxy}
              >
                <option value="">不使用代理链</option>
                {availableDialerProxyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <p className="field-hint">保存时会写成 `dialer-proxy`，让这个节点通过另一个代理分组出站。</p>
            </div>
          </div>
        </section>

        <section className="editor-subsection">
          <div className="compact-section-header">
            <div>
              <h4>鉴权与安全</h4>
              <p className="muted">只展示当前协议真正常用的身份和 TLS 相关字段。</p>
            </div>
          </div>
          <div className="form-grid">
            {showPassword ? (
              <div className="field">
                <label>{currentType === "http" || currentType === "socks5" ? "密码（可选）" : "密码"}</label>
                <input onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))} value={draft.password} />
              </div>
            ) : null}
            {showUsername ? (
              <div className="field">
                <label>用户名</label>
                <input onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} value={draft.username} />
              </div>
            ) : null}
            {showUuid ? (
              <div className="field">
                <label>UUID</label>
                <input onChange={(event) => setDraft((current) => ({ ...current, uuid: event.target.value }))} value={draft.uuid} />
              </div>
            ) : null}
            {showCipher ? (
              <div className="field">
                <label>加密方式</label>
                <select onChange={(event) => setDraft((current) => ({ ...current, cipher: event.target.value }))} value={draft.cipher}>
                  {ssCipherOptions.map((cipher) => (
                    <option key={cipher} value={cipher}>
                      {cipher}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {showServerName ? (
              <div className="field">
                <label>{currentType === "hysteria2" || currentType === "trojan" ? "SNI" : "服务名"}</label>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, serverName: event.target.value }))}
                  placeholder="例如 cdn.example.com"
                  value={draft.serverName}
                />
              </div>
            ) : null}
            {showFingerprint ? (
              <div className="field">
                <label>客户端指纹</label>
                <select
                  onChange={(event) => setDraft((current) => ({ ...current, clientFingerprint: event.target.value }))}
                  value={draft.clientFingerprint}
                >
                  <option value="">不指定</option>
                  {clientFingerprintOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          {(showTlsToggle || showTlsSection || showUdp) ? (
            <div className="manual-proxy-toggle-row">
              {showTlsToggle ? (
                <label className="chip">
                  <input
                    checked={draft.tlsEnabled}
                    onChange={(event) => setDraft((current) => ({ ...current, tlsEnabled: event.target.checked }))}
                    type="checkbox"
                  />
                  启用 TLS
                </label>
              ) : null}
              {showTlsSection ? (
                <label className="chip">
                  <input
                    checked={draft.skipCertVerify}
                    onChange={(event) => setDraft((current) => ({ ...current, skipCertVerify: event.target.checked }))}
                    type="checkbox"
                  />
                  跳过证书校验
                </label>
              ) : null}
              {showUdp ? (
                <label className="chip">
                  <input
                    checked={draft.udpEnabled}
                    onChange={(event) => setDraft((current) => ({ ...current, udpEnabled: event.target.checked }))}
                    type="checkbox"
                  />
                  支持 UDP
                </label>
              ) : null}
            </div>
          ) : null}
        </section>

        {showTransport ? (
          <section className="editor-subsection">
            <div className="compact-section-header">
              <div>
                <h4>传输层</h4>
                <p className="muted">根据 VMess / VLESS 的传输方式，只展开对应的主机、路径或 gRPC 服务名。</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>传输方式</label>
                <select onChange={(event) => setDraft((current) => ({ ...current, network: event.target.value }))} value={draft.network}>
                  {proxyNetworkOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {draft.network === "ws" || draft.network === "http" || draft.network === "h2" ? (
                <>
                  <div className="field">
                    <label>主机</label>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, transportHost: event.target.value }))}
                      placeholder="例如 cdn.example.com"
                      value={draft.transportHost}
                    />
                  </div>
                  <div className="field">
                    <label>路径</label>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, transportPath: event.target.value }))}
                      placeholder="例如 /ws"
                      value={draft.transportPath}
                    />
                  </div>
                </>
              ) : null}
              {draft.network === "grpc" ? (
                <div className="field">
                  <label>gRPC 服务名</label>
                  <input
                    onChange={(event) => setDraft((current) => ({ ...current, grpcServiceName: event.target.value }))}
                    placeholder="例如 proxy"
                    value={draft.grpcServiceName}
                  />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {showPlugin ? (
          <section className="editor-subsection">
            <div className="compact-section-header">
              <div>
                <h4>插件</h4>
                <p className="muted">Shadowsocks 常见的插件能力单独放这里，不需要再手写 `plugin-opts`。</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>插件</label>
                <select onChange={(event) => setDraft((current) => ({ ...current, plugin: event.target.value }))} value={draft.plugin}>
                  {pluginOptions.map((option) => (
                    <option key={option.value || "none"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {draft.plugin ? (
                <>
                  <div className="field">
                    <label>插件模式</label>
                    <select
                      onChange={(event) => setDraft((current) => ({ ...current, pluginMode: event.target.value }))}
                      value={draft.pluginMode}
                    >
                      {pluginModeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>插件主机</label>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, pluginHost: event.target.value }))}
                      placeholder="例如 cdn.example.com"
                      value={draft.pluginHost}
                    />
                  </div>
                  <div className="field">
                    <label>插件路径</label>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, pluginPath: event.target.value }))}
                      placeholder="例如 /ws"
                      value={draft.pluginPath}
                    />
                  </div>
                  <div className="field">
                    <label>Mux</label>
                    <input
                      onChange={(event) => setDraft((current) => ({ ...current, pluginMux: event.target.value }))}
                      placeholder="例如 0"
                      value={draft.pluginMux}
                    />
                  </div>
                  <div className="manual-proxy-toggle-row">
                    <label className="chip">
                      <input
                        checked={draft.pluginTlsEnabled}
                        onChange={(event) => setDraft((current) => ({ ...current, pluginTlsEnabled: event.target.checked }))}
                        type="checkbox"
                      />
                      插件 TLS
                    </label>
                    <label className="chip">
                      <input
                        checked={draft.pluginSkipCertVerify}
                        onChange={(event) => setDraft((current) => ({ ...current, pluginSkipCertVerify: event.target.checked }))}
                        type="checkbox"
                      />
                      跳过插件证书校验
                    </label>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {showHysteriaFields ? (
          <section className="editor-subsection">
            <div className="compact-section-header">
              <div>
                <h4>Hysteria2 附加项</h4>
                <p className="muted">把多端口和混淆拆成单独字段，避免继续手写原始 YAML。</p>
              </div>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>多端口</label>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, ports: event.target.value }))}
                  placeholder="例如 20000-30000"
                  value={draft.ports}
                />
              </div>
              <div className="field">
                <label>混淆方式</label>
                <input onChange={(event) => setDraft((current) => ({ ...current, obfs: event.target.value }))} placeholder="例如 salamander" value={draft.obfs} />
              </div>
              <div className="field">
                <label>混淆密码</label>
                <input onChange={(event) => setDraft((current) => ({ ...current, obfsPassword: event.target.value }))} value={draft.obfsPassword} />
              </div>
            </div>
          </section>
        ) : null}
      </div>

      <div className="section-header">
        <div>
          <h4>高级字段</h4>
          <p className="muted">这里只留给少见字段。像 `udp`、TLS、`plugin-opts`、常见传输参数已经在上面结构化处理。</p>
        </div>
        <button className="button-secondary" onClick={addExtraField} type="button">
          新增字段
        </button>
      </div>
      <div className="extra-field-list">
        {draft.extraFields.length ? (
          draft.extraFields.map((field) => (
            <div className="extra-field-row" key={field.id}>
              <div className="field">
                <label>字段名</label>
                <input onChange={(event) => updateExtraField(field.id, { key: event.target.value })} value={field.key} />
              </div>
              <div className="field">
                <label>类型</label>
                <select
                  onChange={(event) =>
                    updateExtraField(field.id, {
                      valueType: event.target.value as ManualProxyExtraFieldDraft["valueType"],
                    })
                  }
                  value={field.valueType}
                >
                  <option value="string">文本</option>
                  <option value="number">数字</option>
                  <option value="boolean">开关</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <div className="field">
                <label>字段值</label>
                {field.valueType === "boolean" ? (
                  <select onChange={(event) => updateExtraField(field.id, { value: event.target.value })} value={field.value || "true"}>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : field.valueType === "json" ? (
                  <textarea onChange={(event) => updateExtraField(field.id, { value: event.target.value })} value={field.value} />
                ) : (
                  <input onChange={(event) => updateExtraField(field.id, { value: event.target.value })} value={field.value} />
                )}
              </div>
              <button className="button-danger" onClick={() => removeExtraField(field.id)} type="button">
                删除
              </button>
            </div>
          ))
        ) : (
          <div className="picker-empty-state">
            <span className="section-label">高级字段</span>
            <strong>当前没有额外参数</strong>
            <p>如果这个节点还有 `reality-opts`、`private-key`、`alpn` 之类的特殊字段，再在这里逐个补上。</p>
          </div>
        )}
      </div>

      {layout === "full" ? (
        <div className="fragment-editor-actions">
          <button className="button-secondary" onClick={startNewProxy} type="button">
            清空当前
          </button>
          <button className="button" disabled={!draft.name.trim() || !draft.type.trim()} onClick={saveProxy} type="button">
            {editingIndex === null ? "添加到节点列表" : "更新这个节点"}
          </button>
        </div>
      ) : null}
    </section>
  );

  if (layout === "detail") {
    return editorPanel;
  }

  return (
    <div className="fragment-editor-layout">
      <section className="fragment-editor-panel">
        <div className="section-header">
          <div>
            <h4>自定义节点列表</h4>
            <p className="muted">支持逐个节点编辑、删除和调整顺序，不需要再面对整段代理 YAML。</p>
          </div>
          <span className="chip">{items.length} 个节点</span>
        </div>
        <button className="button-secondary fragment-editor-add" onClick={startNewProxy} type="button">
          新增自定义节点
        </button>
        <div className="fragment-editor-list">
          {items.length ? (
            <DndContext
              collisionDetection={closestCenter}
              onDragCancel={resetProxyDragState}
              onDragEnd={handleProxyDragEnd}
              onDragOver={handleProxyDragOver}
              onDragStart={handleProxyDragStart}
              sensors={sensors}
            >
              <SortableContext items={proxySortIds} strategy={verticalListSortingStrategy}>
                {items.map((proxy, index) => {
                  const id = proxySortIds[index]!;
                  return (
                    <SortableFragmentRow
                      id={id}
                      isActive={editingIndex === index}
                      isDragTarget={overProxyId === id && activeProxyId !== id}
                      key={id}
                    >
                      {({ buttonProps, handleRef }) => (
                        <>
                          <div className="fragment-editor-row-body">
                            <strong>{String(proxy.name || `自定义节点 ${index + 1}`)}</strong>
                            <p className="muted">
                              {String(proxy.server || "未填写 server")}
                              {proxy.port ? `:${String(proxy.port)}` : ""}
                            </p>
                            <div className="token-list">
                              <span className="chip">{String(proxy.type || "unknown")}</span>
                              {proxy.plugin ? <span className="chip">{String(proxy.plugin)}</span> : null}
                              {proxy.cipher ? <span className="chip">{String(proxy.cipher)}</span> : null}
                            </div>
                          </div>
                          <div className="fragment-editor-actions">
                            <SortHandle buttonProps={buttonProps} handleRef={handleRef} title={`拖动调整节点 ${String(proxy.name || index + 1)} 的顺序`} />
                            <button className="button-secondary" onClick={() => selectProxy(index)} type="button">
                              编辑
                            </button>
                            <button className="button-danger" onClick={() => removeProxy(index)} type="button">
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
              <span className="section-label">自定义节点</span>
              <strong>还没有自定义节点</strong>
              <p>先新增一个节点，再逐项填写类型、地址和鉴权信息。</p>
            </div>
          )}
        </div>
      </section>
      {editorPanel}
    </div>
  );
}
