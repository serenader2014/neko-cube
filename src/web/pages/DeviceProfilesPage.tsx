import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigFragment, DeviceProfile, DeviceProfileFragmentKey, DeviceProfileFragmentOverride } from "@shared/types";
import { apiRequest, getErrorMessage } from "../lib/api";
import { Modal } from "../components/Modal";
import { StatusSwitch } from "../components/StatusSwitch";
import { SubscriptionLinks } from "../components/SubscriptionLinks";
import { pushToast } from "../components/toast";
import { buildTextPreview } from "../lib/config-fragments";

type DeviceFormValues = Omit<DeviceProfile, "createdAt" | "enabled" | "id" | "token" | "updatedAt">;

const overrideFragmentKeys: DeviceProfileFragmentKey[] = ["root", "profile", "dns", "hosts", "extra"];

const emptyDevice: DeviceFormValues = {
  name: "",
  filename: "mihomo.yaml",
  mixedPort: null,
  allowLan: null,
  externalController: null,
  secret: null,
  mode: null,
  fragmentOverrides: [],
};

function createEmptyFragment(key: DeviceProfileFragmentKey): ConfigFragment {
  return {
    key,
    yamlText: "",
    enabled: false,
  };
}

function describeFragment(key: DeviceProfileFragmentKey) {
  switch (key) {
    case "root":
      return { title: "root", description: "顶层基础配置" };
    case "profile":
      return { title: "profile", description: "运行时 profile 配置" };
    case "dns":
      return { title: "dns", description: "DNS 行为与监听配置" };
    case "hosts":
      return { title: "hosts", description: "域名到地址的静态映射" };
    case "extra":
      return { title: "extra", description: "附加的自定义扩展片段" };
    default:
      return { title: key, description: "静态配置片段" };
  }
}

function toNullableText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text ? text : null;
}

function toNullablePositiveNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDeviceFragmentOverrides(overrides: DeviceProfileFragmentOverride[]): DeviceProfileFragmentOverride[] {
  const result: DeviceProfileFragmentOverride[] = [];
  const seen = new Set<DeviceProfileFragmentKey>();

  for (const override of overrides) {
    if (seen.has(override.key)) {
      continue;
    }

    seen.add(override.key);
    if (override.mode === "inherit") {
      continue;
    }

    result.push({
      key: override.key,
      mode: override.mode,
      yamlText: override.mode === "custom" ? override.yamlText : "",
    });
  }

  return result;
}

function getFragmentOverride(
  overrides: DeviceProfileFragmentOverride[],
  key: DeviceProfileFragmentKey,
): DeviceProfileFragmentOverride {
  return overrides.find((item) => item.key === key) ?? { key, mode: "inherit", yamlText: "" };
}

function normalizeDeviceFormValues(values: DeviceFormValues): DeviceFormValues {
  return {
    ...values,
    mixedPort: toNullablePositiveNumber(values.mixedPort),
    externalController: toNullableText(values.externalController),
    secret: toNullableText(values.secret),
    mode: toNullableText(values.mode),
    fragmentOverrides: normalizeDeviceFragmentOverrides(values.fragmentOverrides),
  };
}

function buildFragmentPreviewText(fragment: ConfigFragment) {
  if (!fragment.enabled) {
    return "全局已停用";
  }

  return buildTextPreview(fragment.yamlText, 5);
}

export function DeviceProfilesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<DeviceProfile | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [togglingDeviceId, setTogglingDeviceId] = useState<number | null>(null);
  const form = useForm<DeviceFormValues>({ defaultValues: emptyDevice });

  const devices = useQuery({
    queryKey: ["device-profiles"],
    queryFn: () => apiRequest<DeviceProfile[]>("/api/device-profiles"),
  });
  const fragments = useQuery({
    queryKey: ["config-fragments"],
    queryFn: () => apiRequest<ConfigFragment[]>("/api/config-fragments"),
  });
  const deviceItems = Array.isArray(devices.data) ? devices.data : [];
  const globalFragments = useMemo(() => {
    const items = Array.isArray(fragments.data) ? fragments.data : [];
    return overrideFragmentKeys.map((key) => items.find((fragment) => fragment.key === key) ?? createEmptyFragment(key));
  }, [fragments.data]);
  const preview = useQuery({
    queryKey: ["device-preview", editing?.id],
    queryFn: () =>
      editing?.id
        ? apiRequest<{ yaml: string }>(`/api/config/preview?deviceProfileId=${editing.id}`)
        : Promise.resolve({ yaml: "" }),
    enabled: Boolean(editing?.id && isEditorOpen),
  });
  const fragmentOverrides = form.watch("fragmentOverrides") ?? [];

  useEffect(() => {
    if (isEditorOpen) {
      form.reset(
        editing
          ? {
              name: editing.name,
              filename: editing.filename,
              mixedPort: editing.mixedPort,
              allowLan: editing.allowLan,
              externalController: editing.externalController,
              secret: editing.secret,
              mode: editing.mode,
              fragmentOverrides: editing.fragmentOverrides,
            }
          : emptyDevice,
      );
    }
  }, [editing, form, isEditorOpen]);

  function openCreateModal() {
    setEditing(null);
    setIsEditorOpen(true);
  }

  function openEditModal(device: DeviceProfile) {
    setEditing(device);
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditing(null);
    form.reset(emptyDevice);
  }

  const saveMutation = useMutation({
    mutationFn: (payload: DeviceFormValues) =>
      apiRequest(editing?.id ? `/api/device-profiles/${editing.id}` : "/api/device-profiles", {
        method: editing?.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...normalizeDeviceFormValues(payload),
          enabled: editing?.enabled ?? true,
          id: editing?.id,
          token: editing?.token,
        } satisfies DeviceProfile),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: editing?.id ? "设备入口已更新。" : "设备入口已创建。" });
      closeEditor();
      await queryClient.invalidateQueries({ queryKey: ["device-profiles"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (device: DeviceProfile) => {
      if (!device.id) {
        return;
      }

      setTogglingDeviceId(device.id);
      return apiRequest(`/api/device-profiles/${device.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...device,
          enabled: !device.enabled,
        } satisfies DeviceProfile),
      });
    },
    onSuccess: async (_data, device) => {
      pushToast({ tone: "success", message: `${device.name} 已${device.enabled ? "停用" : "启用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["device-profiles"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingDeviceId(null);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/device-profiles/${id}/rotate-token`, { method: "POST" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "已轮换设备 token。" });
      await queryClient.invalidateQueries({ queryKey: ["device-profiles"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/device-profiles/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "设备入口已删除。" });
      await queryClient.invalidateQueries({ queryKey: ["device-profiles"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  function setFragmentOverride(key: DeviceProfileFragmentKey, nextValue: DeviceProfileFragmentOverride | null) {
    const nextOverrides = normalizeDeviceFragmentOverrides([
      ...fragmentOverrides.filter((item) => item.key !== key),
      ...(nextValue ? [nextValue] : []),
    ]);
    form.setValue("fragmentOverrides", nextOverrides, { shouldDirty: true });
  }

  function updateFragmentOverrideMode(key: DeviceProfileFragmentKey, mode: DeviceProfileFragmentOverride["mode"]) {
    if (mode === "inherit") {
      setFragmentOverride(key, null);
      return;
    }

    const current = getFragmentOverride(fragmentOverrides, key);
    const fragment = globalFragments.find((item) => item.key === key) ?? createEmptyFragment(key);
    setFragmentOverride(key, {
      key,
      mode,
      yamlText: mode === "custom" ? (current.mode === "custom" ? current.yamlText : fragment.yamlText) : "",
    });
  }

  return (
    <section className="page">
      <article className="panel">
        <div className="section-header">
          <div>
            <h3>入口列表</h3>
            <p className="muted">同一个设备 token 可生成 Mihomo、Surge 与 Quantumult X 三种原生订阅资源。</p>
          </div>
          <div className="inline-actions">
            <span className="chip">{deviceItems.length} 个入口</span>
            <button className="button" onClick={openCreateModal} type="button">
              新增设备入口
            </button>
          </div>
        </div>
        {deviceItems.length ? (
          <div className="card-grid">
            {deviceItems.map((device) => {
              const runtimeOverrideCount = [device.mixedPort, device.allowLan, device.externalController, device.secret, device.mode].filter(
                (value) => value !== null && value !== "" && value !== undefined,
              ).length;
              const fragmentOverrideCount = device.fragmentOverrides.length;
              const overrideCount = runtimeOverrideCount + fragmentOverrideCount;

              return (
                <article className="entity-card" key={device.id}>
                  <div className="entity-card-header">
                    <div>
                      <h4>{device.name}</h4>
                      <p className="muted">{device.filename}</p>
                    </div>
                    <div className="entity-card-metrics">
                      <StatusSwitch
                        checked={device.enabled}
                        disabled={toggleMutation.isPending && togglingDeviceId === device.id}
                        onChange={() => toggleMutation.mutate(device)}
                        title={`切换 ${device.name} 的启用状态`}
                      />
                      <span className="metric-badge">{overrideCount} 个覆写</span>
                    </div>
                  </div>
                  <div className="summary-grid compact-summary-grid">
                    <div className="summary-item">
                      <dt>文件名</dt>
                      <dd>{device.filename}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>mixed-port</dt>
                      <dd>{device.mixedPort ?? "默认"}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>模式</dt>
                      <dd>{device.mode ?? "默认"}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>allow-lan</dt>
                      <dd>{device.allowLan === null ? "默认" : device.allowLan ? "启用" : "关闭"}</dd>
                    </div>
                    <div className="summary-item">
                      <dt>静态片段</dt>
                      <dd>{fragmentOverrideCount ? `${fragmentOverrideCount} 项覆盖` : "继承全局"}</dd>
                    </div>
                  </div>
                  <div className="entity-card-section">
                    <span className="section-label">客户端订阅</span>
                    {device.token ? <SubscriptionLinks token={device.token} /> : null}
                  </div>
                  <div className="entity-card-footer">
                    <div className="inline-actions">
                      <button className="button-secondary" onClick={() => openEditModal(device)} type="button">
                        编辑
                      </button>
                      <button className="button-secondary" onClick={() => device.id && rotateMutation.mutate(device.id)} type="button">
                        {rotateMutation.isPending ? "轮换中..." : "轮换 token"}
                      </button>
                      <button className="button-danger" onClick={() => device.id && window.confirm(`确定要删除设备「${device.name}」吗？删除后对应的订阅地址将失效。`) && deleteMutation.mutate(device.id)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <strong>还没有设备入口</strong>
            <p className="muted">新增后就能为不同客户端生成独立订阅地址，并按设备覆盖运行参数或静态片段。</p>
            <button className="button" onClick={openCreateModal} type="button">
              新增设备入口
            </button>
          </div>
        )}
      </article>

      <Modal
        description="设备入口只覆盖本设备真正需要不同的内容，其他部分继续继承全局配置。"
        onClose={closeEditor}
        open={isEditorOpen}
        title={editing ? `编辑 ${editing.name}` : "新增设备入口"}
        size="wide"
      >
        <form className="stack" onSubmit={form.handleSubmit(async (values) => saveMutation.mutateAsync(values))}>
          <div className="group-editor-layout">
            <div className="group-editor-sidebar">
              <section className="group-editor-card">
                <div>
                  <h4>基础信息</h4>
                  <p className="muted">名称和文件名定义入口身份，下面的参数只在需要时才做覆写。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>名称</label>
                    <input {...form.register("name")} />
                  </div>
                  <div className="field">
                    <label>文件名</label>
                    <input {...form.register("filename")} />
                  </div>
                </div>
              </section>
              <section className="group-editor-card">
                <div>
                  <h4>运行覆写</h4>
                  <p className="muted">不填表示继承共享配置，只在这台设备需要特殊行为时再单独指定。</p>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label>mixed-port</label>
                    <input
                      type="number"
                      {...form.register("mixedPort", {
                        setValueAs: toNullablePositiveNumber,
                      })}
                    />
                  </div>
                  <div className="field">
                    <label>模式</label>
                    <input {...form.register("mode", { setValueAs: toNullableText })} />
                  </div>
                  <div className="field">
                    <label>external-controller</label>
                    <input {...form.register("externalController", { setValueAs: toNullableText })} />
                  </div>
                  <div className="field">
                    <label>密钥</label>
                    <input {...form.register("secret", { setValueAs: toNullableText })} />
                  </div>
                </div>
                <div className="inline-actions">
                  <label className="chip">
                    <input type="checkbox" {...form.register("allowLan")} />
                    allow-lan
                  </label>
                </div>
              </section>
            </div>
            <div className="group-editor-sidebar">
              <section className="group-editor-card">
                <div>
                  <h4>{editing?.id ? "设备预览" : "创建说明"}</h4>
                  <p className="muted">
                    {editing?.id
                      ? "这里保留当前设备的实时配置预览，便于确认覆写是否生效。"
                      : "保存后会生成一个独立 token，并派生出各客户端可直接复制的订阅地址。"}
                  </p>
                </div>
                {editing?.id ? (
                  <pre className="code-block preview-shell">{preview.data?.yaml || "加载中..."}</pre>
                ) : (
                  <div className="empty-state compact-empty-state">
                    <strong>保存后生成订阅地址</strong>
                    <p className="muted">创建完成后，这里会出现该入口的预览配置和三种客户端专属地址。</p>
                  </div>
                )}
              </section>

              <section className="group-editor-card">
                <div>
                  <h4>静态片段覆盖</h4>
                  <p className="muted">节点、分组、规则和规则集继续共享全局数据；这里只覆盖 root/profile/dns/hosts/extra。</p>
                </div>
                <div className="device-fragment-override-list">
                  {globalFragments.map((fragment) => {
                    const key = fragment.key as DeviceProfileFragmentKey;
                    const meta = describeFragment(key);
                    const override = getFragmentOverride(fragmentOverrides, key);
                    const isCustom = override.mode === "custom";

                    return (
                      <article className={`device-fragment-override-card ${override.mode !== "inherit" ? "is-overridden" : ""}`} key={fragment.key}>
                        <div className="device-fragment-override-header">
                          <div>
                            <h5>{meta.title}</h5>
                            <p className="muted">{meta.description}</p>
                          </div>
                          <span className="metric-badge">
                            {override.mode === "inherit" ? "继承全局" : override.mode === "disable" ? "该设备停用" : "自定义覆盖"}
                          </span>
                        </div>
                        <div className="device-fragment-override-grid">
                          <div className="device-fragment-override-pane">
                            <span className="section-label">当前全局</span>
                            <pre className="code-block code-block-compact">{buildFragmentPreviewText(fragment)}</pre>
                          </div>
                          <div className="device-fragment-override-pane">
                            <div className="field">
                              <label>该设备使用方式</label>
                              <select onChange={(event) => updateFragmentOverrideMode(key, event.target.value as DeviceProfileFragmentOverride["mode"])} value={override.mode}>
                                <option value="inherit">继承全局</option>
                                <option value="disable">停用这段配置</option>
                                <option value="custom">自定义覆盖</option>
                              </select>
                            </div>
                            {isCustom ? (
                              <div className="field">
                                <label>覆盖内容</label>
                                <textarea
                                  onChange={(event) =>
                                    setFragmentOverride(key, {
                                      key,
                                      mode: "custom",
                                      yamlText: event.target.value,
                                    })
                                  }
                                  placeholder={fragment.enabled ? fragment.yamlText : "在这里填写该设备专属的 YAML 片段"}
                                  value={override.yamlText}
                                />
                                <div className="inline-actions">
                                  <button
                                    className="button-secondary"
                                    onClick={() =>
                                      setFragmentOverride(key, {
                                        key,
                                        mode: "custom",
                                        yamlText: fragment.yamlText,
                                      })
                                    }
                                    type="button"
                                  >
                                    带入全局内容
                                  </button>
                                  <button
                                    className="button-secondary"
                                    onClick={() =>
                                      setFragmentOverride(key, {
                                        key,
                                        mode: "custom",
                                        yamlText: "",
                                      })
                                    }
                                    type="button"
                                  >
                                    清空覆盖内容
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="field-hint">
                                {override.mode === "disable"
                                  ? "生成这个设备的订阅时，这段全局配置不会被带进去。"
                                  : "这个设备会直接继承全局静态片段。"}
                              </p>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
          {editing?.id ? (
            <div className="inline-actions">
              <span className="chip success">实时预览</span>
            </div>
          ) : null}
          <div className="modal-actions">
            <button className="button-secondary" onClick={closeEditor} type="button">
              取消
            </button>
            <button className="button" disabled={saveMutation.isPending} type="submit">
              {saveMutation.isPending ? "保存中..." : "保存设备入口"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
