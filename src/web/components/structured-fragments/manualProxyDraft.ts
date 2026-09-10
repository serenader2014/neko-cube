import type { ParsedProxy } from "@shared/types";

export type ManualProxyExtraFieldDraft = {
  id: string;
  key: string;
  valueType: "string" | "number" | "boolean" | "json";
  value: string;
};

export type ManualProxyDraft = {
  name: string;
  type: string;
  server: string;
  port: string;
  password: string;
  uuid: string;
  username: string;
  cipher: string;
  plugin: string;
  pluginMode: string;
  pluginHost: string;
  pluginPath: string;
  pluginTlsEnabled: boolean;
  pluginSkipCertVerify: boolean;
  pluginMux: string;
  dialerProxy: string;
  tailscaleHostname: string;
  tailscaleAuthKey: string;
  tailscaleControlUrl: string;
  tailscaleStateDir: string;
  tailscaleEphemeral: boolean;
  tailscaleAcceptRoutes: boolean;
  tailscaleExitNode: string;
  tailscaleExitNodeAllowLanAccess: boolean;
  tailscaleInterfaceName: string;
  tailscaleRoutingMark: string;
  tailscaleIpVersion: string;
  network: string;
  transportHost: string;
  transportPath: string;
  grpcServiceName: string;
  tlsEnabled: boolean;
  serverName: string;
  skipCertVerify: boolean;
  udpEnabled: boolean;
  clientFingerprint: string;
  ports: string;
  obfs: string;
  obfsPassword: string;
  extraFields: ManualProxyExtraFieldDraft[];
};

export const emptyManualProxyDraft: ManualProxyDraft = {
  name: "",
  type: "ss",
  server: "",
  port: "443",
  password: "",
  uuid: "",
  username: "",
  cipher: "aes-256-gcm",
  plugin: "",
  pluginMode: "websocket",
  pluginHost: "",
  pluginPath: "",
  pluginTlsEnabled: false,
  pluginSkipCertVerify: false,
  pluginMux: "",
  dialerProxy: "",
  tailscaleHostname: "",
  tailscaleAuthKey: "",
  tailscaleControlUrl: "",
  tailscaleStateDir: "",
  tailscaleEphemeral: false,
  tailscaleAcceptRoutes: false,
  tailscaleExitNode: "",
  tailscaleExitNodeAllowLanAccess: false,
  tailscaleInterfaceName: "",
  tailscaleRoutingMark: "",
  tailscaleIpVersion: "",
  network: "tcp",
  transportHost: "",
  transportPath: "",
  grpcServiceName: "",
  tlsEnabled: false,
  serverName: "",
  skipCertVerify: false,
  udpEnabled: false,
  clientFingerprint: "",
  ports: "",
  obfs: "",
  obfsPassword: "",
  extraFields: [],
};

const manualProxyCoreKeys = new Set([
  "name",
  "type",
  "server",
  "port",
  "password",
  "uuid",
  "username",
  "cipher",
  "plugin",
  "plugin-opts",
  "dialer-proxy",
  "network",
  "ws-opts",
  "grpc-opts",
  "http-opts",
  "tls",
  "servername",
  "sni",
  "skip-cert-verify",
  "udp",
  "client-fingerprint",
  "ports",
  "obfs",
  "obfs-password",
]);

const tailscaleProxyCoreKeys = new Set([
  "hostname",
  "auth-key",
  "control-url",
  "state-dir",
  "ephemeral",
  "accept-routes",
  "exit-node",
  "exit-node-allow-lan-access",
  "interface-name",
  "routing-mark",
  "ip-version",
]);

export const manualProxyTypeOptions = [
  { value: "ss", label: "Shadowsocks", description: "适合常见 SS 节点，可选加密方式、UDP 和插件。" },
  { value: "trojan", label: "Trojan", description: "适合 Trojan/TLS 节点，重点配置密码、SNI 和证书校验。" },
  { value: "http", label: "HTTP 代理", description: "适合作为落地节点或中转出口，支持用户名密码。" },
  { value: "socks5", label: "SOCKS5", description: "适合本地网关或上游代理，支持用户名密码。" },
  { value: "vless", label: "VLESS", description: "支持 UUID、传输方式、TLS 和常见传输参数。" },
  { value: "vmess", label: "VMess", description: "支持 UUID、传输方式、TLS 和常见传输参数。" },
  { value: "hysteria2", label: "Hysteria2", description: "适合低延迟链路，可配置 SNI、混淆和多端口。" },
  { value: "wireguard", label: "WireGuard", description: "基础信息先在这里维护，其它密钥和参数走高级字段。" },
  { value: "tuic", label: "TUIC", description: "支持 UUID、密码和 TLS 相关参数，其它高级参数走下方高级字段。" },
  { value: "tailscale", label: "Tailscale", description: "作为 Tailnet 设备接入，可配置认证、子网路由和出口节点。" },
] as const;

const manualProxyDefaultPorts: Record<string, string> = {
  ss: "443",
  trojan: "443",
  http: "8080",
  socks5: "1080",
  vless: "443",
  vmess: "443",
  hysteria2: "443",
  wireguard: "51820",
  tuic: "443",
  tailscale: "",
};

export const ssCipherOptions = [
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
] as const;

export const proxyNetworkOptions = [
  { value: "tcp", label: "TCP" },
  { value: "ws", label: "WebSocket" },
  { value: "grpc", label: "gRPC" },
  { value: "http", label: "HTTP" },
  { value: "h2", label: "HTTP/2" },
] as const;

export const pluginOptions = [
  { value: "", label: "不使用插件" },
  { value: "v2ray-plugin", label: "v2ray-plugin" },
] as const;

export const pluginModeOptions = [
  { value: "websocket", label: "WebSocket" },
  { value: "quic", label: "QUIC" },
] as const;

export const clientFingerprintOptions = ["chrome", "firefox", "safari", "ios", "android", "edge"] as const;

export const tailscaleIpVersionOptions = ["dual", "ipv4", "ipv6", "ipv4-prefer", "ipv6-prefer"] as const;

export function createManualProxySortId(proxy: ParsedProxy, index: number) {
  return `proxy:${index}:${String(proxy.name || "")}:${String(proxy.server || "")}:${String(proxy.port || "")}`;
}

export function createManualProxyDraft(record: ParsedProxy): ManualProxyDraft {
  const normalizedType = stringifyKnownValue(record.type).trim().toLowerCase();
  const pluginOptions = asRecord(record["plugin-opts"]);
  const wsOptions = asRecord(record["ws-opts"]);
  const wsHeaders = asRecord(wsOptions?.headers);
  const grpcOptions = asRecord(record["grpc-opts"]);
  const httpOptions = asRecord(record["http-opts"]);
  const extraFields = Object.entries(record)
    .filter(([key]) => !manualProxyCoreKeys.has(key) && !(normalizedType === "tailscale" && tailscaleProxyCoreKeys.has(key)))
    .map(([key, value]) => createExtraFieldDraft(key, value));

  return {
    name: stringifyKnownValue(record.name),
    type: stringifyKnownValue(record.type),
    server: stringifyKnownValue(record.server),
    port: stringifyKnownValue(record.port),
    password: stringifyKnownValue(record.password),
    uuid: stringifyKnownValue(record.uuid),
    username: stringifyKnownValue(record.username),
    cipher: stringifyKnownValue(record.cipher),
    plugin: stringifyKnownValue(record.plugin),
    pluginMode: stringifyKnownValue(pluginOptions?.mode) || "websocket",
    pluginHost: stringifyKnownValue(pluginOptions?.host),
    pluginPath: stringifyKnownValue(pluginOptions?.path),
    pluginTlsEnabled: readBooleanValue(pluginOptions?.tls),
    pluginSkipCertVerify: readBooleanValue(pluginOptions?.["skip-cert-verify"]),
    pluginMux: stringifyKnownValue(pluginOptions?.mux),
    dialerProxy: stringifyKnownValue(record["dialer-proxy"]),
    tailscaleHostname: stringifyKnownValue(record.hostname),
    tailscaleAuthKey: stringifyKnownValue(record["auth-key"]),
    tailscaleControlUrl: stringifyKnownValue(record["control-url"]),
    tailscaleStateDir: stringifyKnownValue(record["state-dir"]),
    tailscaleEphemeral: readBooleanValue(record.ephemeral),
    tailscaleAcceptRoutes: readBooleanValue(record["accept-routes"]),
    tailscaleExitNode: stringifyKnownValue(record["exit-node"]),
    tailscaleExitNodeAllowLanAccess: readBooleanValue(record["exit-node-allow-lan-access"]),
    tailscaleInterfaceName: stringifyKnownValue(record["interface-name"]),
    tailscaleRoutingMark: stringifyKnownValue(record["routing-mark"]),
    tailscaleIpVersion: stringifyKnownValue(record["ip-version"]),
    network: inferNetwork(record),
    transportHost: stringifyKnownValue(wsHeaders?.Host ?? getFirstArrayValue(httpOptions?.host)),
    transportPath: stringifyKnownValue(wsOptions?.path ?? getFirstArrayValue(httpOptions?.path)),
    grpcServiceName: stringifyKnownValue(grpcOptions?.["grpc-service-name"]),
    tlsEnabled: readBooleanValue(record.tls),
    serverName: stringifyKnownValue(record.servername ?? record.sni),
    skipCertVerify: readBooleanValue(record["skip-cert-verify"]),
    udpEnabled: readBooleanValue(record.udp),
    clientFingerprint: stringifyKnownValue(record["client-fingerprint"]),
    ports: stringifyKnownValue(record.ports),
    obfs: stringifyKnownValue(record.obfs),
    obfsPassword: stringifyKnownValue(record["obfs-password"]),
    extraFields,
  };
}

function createManualProxyRecord(draft: ManualProxyDraft): ParsedProxy {
  const record = {
    name: draft.name.trim(),
    type: draft.type.trim(),
  } as ParsedProxy;
  const normalizedType = draft.type.trim().toLowerCase();

  if (normalizedType !== "tailscale") {
    assignIfPresent(record, "server", draft.server);
  }
  assignIfPresent(record, "dialer-proxy", draft.dialerProxy);

  if (normalizedType !== "tailscale" && draft.port.trim()) {
    const parsedPort = Number(draft.port.trim());
    record.port = Number.isFinite(parsedPort) ? parsedPort : draft.port.trim();
  }

  if (normalizedType === "tailscale") {
    assignIfPresent(record, "hostname", draft.tailscaleHostname);
    assignIfPresent(record, "auth-key", draft.tailscaleAuthKey);
    assignIfPresent(record, "control-url", draft.tailscaleControlUrl);
    assignIfPresent(record, "state-dir", draft.tailscaleStateDir);
    assignIfPresent(record, "exit-node", draft.tailscaleExitNode);
    assignIfPresent(record, "interface-name", draft.tailscaleInterfaceName);
    assignIfPresent(record, "ip-version", draft.tailscaleIpVersion);

    if (draft.tailscaleRoutingMark.trim()) {
      const routingMark = Number(draft.tailscaleRoutingMark.trim());
      record["routing-mark"] = Number.isFinite(routingMark) ? routingMark : draft.tailscaleRoutingMark.trim();
    }

    if (draft.tailscaleEphemeral) {
      record.ephemeral = true;
    }

    if (draft.tailscaleAcceptRoutes) {
      record["accept-routes"] = true;
    }

    if (draft.tailscaleExitNodeAllowLanAccess) {
      record["exit-node-allow-lan-access"] = true;
    }
  }

  if (supportsPassword(normalizedType)) {
    assignIfPresent(record, "password", draft.password);
  }

  if (supportsUuid(normalizedType)) {
    assignIfPresent(record, "uuid", draft.uuid);
  }

  if (supportsUsername(normalizedType)) {
    assignIfPresent(record, "username", draft.username);
  }

  if (normalizedType === "ss") {
    assignIfPresent(record, "cipher", draft.cipher);
  }

  if (supportsUdp(normalizedType) && draft.udpEnabled) {
    record.udp = true;
  }

  if (supportsServerName(normalizedType)) {
    const serverName = draft.serverName.trim();
    if (serverName) {
      if (normalizedType === "trojan" || normalizedType === "hysteria2" || normalizedType === "tuic") {
        record.sni = serverName;
      } else {
        record.servername = serverName;
      }
    }
  }

  if (supportsSkipCertVerify(normalizedType) && draft.skipCertVerify) {
    record["skip-cert-verify"] = true;
  }

  if (supportsFingerprint(normalizedType)) {
    assignIfPresent(record, "client-fingerprint", draft.clientFingerprint);
  }

  if (supportsTlsToggle(normalizedType) && draft.tlsEnabled) {
    record.tls = true;
  }

  if (normalizedType === "ss" && draft.plugin.trim()) {
    record.plugin = draft.plugin.trim();
    const pluginOptions: Record<string, unknown> = {};
    if (draft.pluginMode.trim()) {
      pluginOptions.mode = draft.pluginMode.trim();
    }
    if (draft.pluginHost.trim()) {
      pluginOptions.host = draft.pluginHost.trim();
    }
    if (draft.pluginPath.trim()) {
      pluginOptions.path = draft.pluginPath.trim();
    }
    if (draft.pluginTlsEnabled) {
      pluginOptions.tls = true;
    }
    if (draft.pluginSkipCertVerify) {
      pluginOptions["skip-cert-verify"] = true;
    }
    if (draft.pluginMux.trim()) {
      pluginOptions.mux = parsePluginMuxValue(draft.pluginMux);
    }
    if (Object.keys(pluginOptions).length) {
      record["plugin-opts"] = pluginOptions;
    }
  }

  if (supportsTransport(normalizedType)) {
    const network = draft.network.trim() || "tcp";
    record.network = network;
    if (network === "ws") {
      const wsOptions: Record<string, unknown> = {
        path: draft.transportPath.trim() || "/",
      };
      if (draft.transportHost.trim()) {
        wsOptions.headers = { Host: draft.transportHost.trim() };
      }
      record["ws-opts"] = wsOptions;
    } else if (network === "grpc" && draft.grpcServiceName.trim()) {
      record["grpc-opts"] = {
        "grpc-service-name": draft.grpcServiceName.trim(),
      };
    } else if ((network === "http" || network === "h2") && (draft.transportHost.trim() || draft.transportPath.trim())) {
      record["http-opts"] = {
        ...(draft.transportPath.trim() ? { path: [draft.transportPath.trim()] } : {}),
        ...(draft.transportHost.trim() ? { host: [draft.transportHost.trim()] } : {}),
      };
    }
  }

  if (normalizedType === "hysteria2") {
    assignIfPresent(record, "ports", draft.ports);
    assignIfPresent(record, "obfs", draft.obfs);
    assignIfPresent(record, "obfs-password", draft.obfsPassword);
  }

  for (const field of draft.extraFields) {
    const key = field.key.trim();
    if (!key) {
      continue;
    }

    record[key] = parseExtraFieldValue(field);
  }

  return record;
}

export function buildCommittedProxyState(
  items: ParsedProxy[],
  draft: ManualProxyDraft,
  editingIndex: number | null,
): { items: ParsedProxy[]; editingIndex: number; record: ParsedProxy } | null {
  const normalized = createManualProxyRecord(draft);
  if (!normalized.name || !normalized.type) {
    return null;
  }

  const nextItems =
    editingIndex === null
      ? [...items, normalized]
      : items.map((item, index) => (index === editingIndex ? normalized : item));
  const nextEditingIndex = editingIndex === null ? nextItems.length - 1 : editingIndex;

  return {
    items: nextItems,
    editingIndex: nextEditingIndex,
    record: normalized,
  };
}

export function getManualProxyDefaultPort(type: string) {
  return manualProxyDefaultPorts[type.trim().toLowerCase()] ?? "443";
}

function inferNetwork(record: ParsedProxy) {
  if (typeof record.network === "string" && record.network.trim()) {
    return record.network.trim();
  }

  if (record["ws-opts"]) {
    return "ws";
  }

  if (record["grpc-opts"]) {
    return "grpc";
  }

  if (record["http-opts"]) {
    return "http";
  }

  return "tcp";
}

function supportsPassword(type: string) {
  return ["ss", "trojan", "http", "socks5", "hysteria2", "tuic"].includes(type);
}

function supportsUuid(type: string) {
  return ["vless", "vmess", "tuic"].includes(type);
}

function supportsUsername(type: string) {
  return ["http", "socks5"].includes(type);
}

function supportsTransport(type: string) {
  return ["vless", "vmess"].includes(type);
}

function supportsServerName(type: string) {
  return ["trojan", "vless", "vmess", "hysteria2", "tuic"].includes(type);
}

function supportsSkipCertVerify(type: string) {
  return ["trojan", "vless", "vmess", "hysteria2", "tuic"].includes(type);
}

function supportsUdp(type: string) {
  return ["ss", "trojan", "socks5", "vless", "vmess", "hysteria2", "tuic", "tailscale"].includes(type);
}

function supportsFingerprint(type: string) {
  return ["trojan", "vless", "vmess", "tuic"].includes(type);
}

function supportsTlsToggle(type: string) {
  return ["vless", "vmess", "tuic"].includes(type);
}

function readBooleanValue(value: unknown) {
  return value === true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getFirstArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createExtraFieldDraft(key: string, value: unknown): ManualProxyExtraFieldDraft {
  if (typeof value === "boolean") {
    return { id: createLocalId(), key, valueType: "boolean", value: value ? "true" : "false" };
  }

  if (typeof value === "number") {
    return { id: createLocalId(), key, valueType: "number", value: String(value) };
  }

  if (value && typeof value === "object") {
    return { id: createLocalId(), key, valueType: "json", value: JSON.stringify(value, null, 2) };
  }

  return { id: createLocalId(), key, valueType: "string", value: stringifyKnownValue(value) };
}

export function createEmptyExtraField(): ManualProxyExtraFieldDraft {
  return {
    id: createLocalId(),
    key: "",
    valueType: "string",
    value: "",
  };
}

function parseExtraFieldValue(field: ManualProxyExtraFieldDraft): unknown {
  const value = field.value.trim();

  if (field.valueType === "boolean") {
    return value !== "false";
  }

  if (field.valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (field.valueType === "json") {
    if (!value) {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return field.value;
}

function parsePluginMuxValue(value: string): unknown {
  const normalized = value.trim();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : normalized;
}

function assignIfPresent(record: ParsedProxy, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) {
    record[key] = trimmed;
  }
}

function stringifyKnownValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function createLocalId() {
  return Math.random().toString(36).slice(2, 10);
}
