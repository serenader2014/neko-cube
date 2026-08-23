import type { ParsedProxy } from "./types.js";
import type { SubscriptionClientId } from "./subscription-clients.js";
import { convertShadowrocketProxy } from "./subscription-export-shadowrocket.js";
import {
  booleanValue,
  endpoint,
  type LineConverter,
  numberValue,
  type ProxyConversion,
  type ProxyRecord,
  recordValue,
  sanitizeName,
  textValue,
  uniqueName,
  webSocketOptions,
} from "./subscription-export-utils.js";

export type SubscriptionDocument = {
  client: SubscriptionClientId;
  content: string;
  contentType: string;
  filename: string;
  proxyCount: number;
  skippedCount: number;
  warnings: string[];
};

function quoteSurge(value: string): string {
  if (!/[,"]/.test(value) && value === value.trim()) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function quoteLoonCredential(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function safeQuantumValue(value: string): string | null {
  return /[,\r\n]/.test(value) ? null : value;
}

function quantumEndpoint(host: string, port: number): string {
  return `${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

function commonQuantumParams(proxy: ProxyRecord): string[] {
  return [
    `fast-open=${booleanValue(proxy, "tfo")}`,
    `udp-relay=${booleanValue(proxy, "udp")}`,
  ];
}

function tlsQuantumParams(proxy: ProxyRecord, hostKey: "obfs-host" | "tls-host"): string[] {
  const params: string[] = [];
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.push(`${hostKey}=${sni}`);
  }
  params.push(`tls-verification=${!booleanValue(proxy, "skip-cert-verify")}`);

  const reality = recordValue(proxy, "reality-opts");
  const publicKey = textValue(reality, "public-key");
  const shortId = textValue(reality, "short-id");
  if (publicKey) {
    params.push(`reality-base64-pubkey=${publicKey}`);
  }
  if (shortId) {
    params.push(`reality-hex-shortid=${shortId}`);
  }
  return params;
}

function quantumTransportParams(proxy: ProxyRecord): ProxyConversion | { params: string[] } {
  const network = textValue(proxy, "network") || "tcp";
  const tls = booleanValue(proxy, "tls") || Object.keys(recordValue(proxy, "reality-opts")).length > 0;

  if (network === "tcp") {
    return { params: tls ? ["obfs=over-tls", ...tlsQuantumParams(proxy, "obfs-host")] : [] };
  }

  if (network === "ws") {
    const ws = webSocketOptions(proxy);
    return {
      params: [
        `obfs=${tls ? "wss" : "ws"}`,
        ...(ws.host ? [`obfs-host=${ws.host}`] : []),
        `obfs-uri=${ws.path}`,
        ...(tls ? tlsQuantumParams(proxy, "obfs-host").filter((item) => !item.startsWith("obfs-host=")) : []),
      ],
    };
  }

  if (network === "http" || network === "h2") {
    const options = recordValue(proxy, "http-opts");
    const hosts = options.host;
    const paths = options.path;
    const host = Array.isArray(hosts) ? String(hosts[0] ?? "") : textValue(options, "host");
    const path = Array.isArray(paths) ? String(paths[0] ?? "/") : textValue(options, "path") || "/";
    return { params: ["obfs=http", ...(host ? [`obfs-host=${host}`] : []), `obfs-uri=${path}`] };
  }

  return { line: null, reason: `不支持 ${network} 传输` };
}

function convertQuantumShadowsocks(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const method = textValue(proxy, "cipher");
  const password = safeQuantumValue(textValue(proxy, "password"));
  if (!target || !method || password === null || !password) {
    return { line: null, reason: "缺少服务器、加密方式或密码" };
  }

  const params = [`method=${method}`, `password=${password}`];
  const plugin = textValue(proxy, "plugin");
  const pluginOptions = recordValue(proxy, "plugin-opts");
  if (plugin) {
    if (plugin === "obfs" || plugin === "simple-obfs") {
      const mode = textValue(pluginOptions, "mode") || "http";
      params.push(`obfs=${mode}`);
      const host = textValue(pluginOptions, "host");
      if (host) {
        params.push(`obfs-host=${host}`);
      }
    } else if (plugin === "v2ray-plugin") {
      const tls = booleanValue(pluginOptions, "tls");
      params.push(`obfs=${tls ? "wss" : "ws"}`);
      const host = textValue(pluginOptions, "host");
      const path = textValue(pluginOptions, "path");
      if (host) {
        params.push(`obfs-host=${host}`);
      }
      if (path) {
        params.push(`obfs-uri=${path}`);
      }
    } else {
      return { line: null, reason: `不支持 ${plugin} 插件` };
    }
  }

  return {
    line: `shadowsocks=${quantumEndpoint(target.host, target.port)}, ${[
      ...params,
      ...commonQuantumParams(proxy),
      `tag=${name}`,
    ].join(", ")}`,
  };
}

function convertQuantumV2ray(proxy: ProxyRecord, name: string, type: "vmess" | "vless"): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = safeQuantumValue(textValue(proxy, "uuid"));
  if (!target || uuid === null || !uuid) {
    return { line: null, reason: "缺少服务器或 UUID" };
  }

  const transport = quantumTransportParams(proxy);
  if ("line" in transport) {
    return transport;
  }

  const cipher = type === "vless" ? "none" : textValue(proxy, "cipher") || "none";
  const params = [`method=${cipher === "auto" ? "none" : cipher}`, `password=${uuid}`, ...transport.params];
  if (type === "vmess" && (numberValue(proxy, "alterId", "alter-id") ?? 0) > 0) {
    params.push("aead=false");
  }
  if (type === "vless") {
    const flow = textValue(proxy, "flow");
    if (flow) {
      params.push(`vless-flow=${flow}`);
    }
  }

  return {
    line: `${type}=${quantumEndpoint(target.host, target.port)}, ${[
      ...params,
      ...commonQuantumParams(proxy),
      `tag=${name}`,
    ].join(", ")}`,
  };
}

function convertQuantumTrojan(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const password = safeQuantumValue(textValue(proxy, "password"));
  if (!target || password === null || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }

  const network = textValue(proxy, "network") || "tcp";
  const params = [`password=${password}`];
  if (network === "ws") {
    const ws = webSocketOptions(proxy);
    params.push("obfs=wss", ...(ws.host ? [`obfs-host=${ws.host}`] : []), `obfs-uri=${ws.path}`);
    params.push(...tlsQuantumParams(proxy, "obfs-host").filter((item) => !item.startsWith("obfs-host=")));
  } else if (network === "tcp") {
    params.push("over-tls=true", ...tlsQuantumParams(proxy, "tls-host"));
  } else {
    return { line: null, reason: `不支持 ${network} 传输` };
  }

  return {
    line: `trojan=${quantumEndpoint(target.host, target.port)}, ${[
      ...params,
      ...commonQuantumParams(proxy),
      `tag=${name}`,
    ].join(", ")}`,
  };
}

function convertQuantumHttpLike(
  proxy: ProxyRecord,
  name: string,
  type: "http" | "socks5" | "anytls",
): ProxyConversion {
  const target = endpoint(proxy);
  if (!target) {
    return { line: null, reason: "缺少服务器或端口" };
  }

  const params: string[] = [];
  const username = safeQuantumValue(textValue(proxy, "username"));
  const password = safeQuantumValue(textValue(proxy, "password"));
  if (username === null || password === null) {
    return { line: null, reason: "用户名或密码含有不兼容字符" };
  }
  if (username) {
    params.push(`username=${username}`);
  }
  if (password) {
    params.push(`password=${password}`);
  }

  const overTls = type === "anytls" || type === "http" && (proxy.type === "https" || booleanValue(proxy, "tls")) ||
    type === "socks5" && booleanValue(proxy, "tls");
  if (overTls) {
    params.push("over-tls=true", ...tlsQuantumParams(proxy, "tls-host"));
  }

  return {
    line: `${type}=${quantumEndpoint(target.host, target.port)}, ${[
      ...params,
      ...commonQuantumParams(proxy),
      `tag=${name}`,
    ].join(", ")}`,
  };
}

function convertQuantumProxy(proxy: ProxyRecord, name: string): ProxyConversion {
  switch (textValue(proxy, "type").toLowerCase()) {
    case "ss":
    case "shadowsocks":
      return convertQuantumShadowsocks(proxy, name);
    case "vmess":
      return convertQuantumV2ray(proxy, name, "vmess");
    case "vless":
      return convertQuantumV2ray(proxy, name, "vless");
    case "trojan":
      return convertQuantumTrojan(proxy, name);
    case "http":
    case "https":
      return convertQuantumHttpLike(proxy, name, "http");
    case "socks5":
      return convertQuantumHttpLike(proxy, name, "socks5");
    case "anytls":
      return convertQuantumHttpLike(proxy, name, "anytls");
    default:
      return { line: null, reason: `不支持 ${textValue(proxy, "type") || "未知"} 协议` };
  }
}

function commonSurgeParams(proxy: ProxyRecord): string[] {
  const params: string[] = [];
  if (booleanValue(proxy, "tfo")) {
    params.push("tfo=true");
  }
  const dialerProxy = textValue(proxy, "dialer-proxy");
  if (dialerProxy) {
    params.push(`underlying-proxy=${quoteSurge(sanitizeName(dialerProxy))}`);
  }
  return params;
}

function surgeTlsParams(proxy: ProxyRecord): string[] {
  const params: string[] = [];
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.push(`sni=${quoteSurge(sni)}`);
  }
  if (booleanValue(proxy, "skip-cert-verify")) {
    params.push("skip-cert-verify=true");
  }
  const alpn = proxy.alpn;
  if (Array.isArray(alpn) && alpn.length > 0) {
    params.push(`alpn=${quoteSurge(alpn.map(String).join(","))}`);
  }
  return params;
}

function surgeWsParams(proxy: ProxyRecord): string[] {
  const ws = webSocketOptions(proxy);
  const headers = Object.entries(ws.headers)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}:${String(value)}`)
    .join("|");
  return ["ws=true", `ws-path=${quoteSurge(ws.path)}`, ...(headers ? [`ws-headers=${quoteSurge(headers)}`] : [])];
}

function convertSurgeShadowsocks(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const method = textValue(proxy, "cipher");
  const password = textValue(proxy, "password");
  if (!target || !method || !password) {
    return { line: null, reason: "缺少服务器、加密方式或密码" };
  }

  const params = [`encrypt-method=${method}`, `password=${quoteSurge(password)}`];
  const plugin = textValue(proxy, "plugin");
  if (plugin) {
    if (plugin !== "obfs" && plugin !== "simple-obfs") {
      return { line: null, reason: `不支持 ${plugin} 插件` };
    }
    const pluginOptions = recordValue(proxy, "plugin-opts");
    params.push(`obfs=${textValue(pluginOptions, "mode") || "http"}`);
    const host = textValue(pluginOptions, "host");
    if (host) {
      params.push(`obfs-host=${quoteSurge(host)}`);
    }
  }
  if (booleanValue(proxy, "udp")) {
    params.push("udp-relay=true");
  }

  return {
    line: `${name} = ss, ${quoteSurge(target.host)}, ${target.port}, ${[...params, ...commonSurgeParams(proxy)].join(", ")}`,
  };
}

function convertSurgeVmess(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = textValue(proxy, "uuid");
  const network = textValue(proxy, "network") || "tcp";
  if (!target || !uuid) {
    return { line: null, reason: "缺少服务器或 UUID" };
  }
  if (network !== "tcp" && network !== "ws") {
    return { line: null, reason: `不支持 ${network} 传输` };
  }

  const params = [`username=${quoteSurge(uuid)}`, `vmess-aead=${(numberValue(proxy, "alterId", "alter-id") ?? 0) === 0}`];
  const cipher = textValue(proxy, "cipher");
  if (cipher === "aes-128-gcm" || cipher === "chacha20-ietf-poly1305") {
    params.push(`encrypt-method=${cipher}`);
  }
  if (booleanValue(proxy, "tls")) {
    params.push("tls=true", ...surgeTlsParams(proxy));
  }
  if (network === "ws") {
    params.push(...surgeWsParams(proxy));
  }

  return {
    line: `${name} = vmess, ${quoteSurge(target.host)}, ${target.port}, ${[...params, ...commonSurgeParams(proxy)].join(", ")}`,
  };
}

function convertSurgeTrojan(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const password = textValue(proxy, "password");
  const network = textValue(proxy, "network") || "tcp";
  if (!target || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  if (network !== "tcp" && network !== "ws") {
    return { line: null, reason: `不支持 ${network} 传输` };
  }

  const params = [`password=${quoteSurge(password)}`, ...surgeTlsParams(proxy)];
  if (network === "ws") {
    params.push(...surgeWsParams(proxy));
  }
  return {
    line: `${name} = trojan, ${quoteSurge(target.host)}, ${target.port}, ${[...params, ...commonSurgeParams(proxy)].join(", ")}`,
  };
}

function convertSurgeHttpLike(proxy: ProxyRecord, name: string, rawType: string): ProxyConversion {
  const target = endpoint(proxy);
  if (!target) {
    return { line: null, reason: "缺少服务器或端口" };
  }
  const isSocks = rawType === "socks5";
  const tls = rawType === "https" || booleanValue(proxy, "tls");
  const type = isSocks ? (tls ? "socks5-tls" : "socks5") : tls ? "https" : "http";
  const params: string[] = [];
  const username = textValue(proxy, "username");
  const password = textValue(proxy, "password");
  if (username) {
    params.push(`username=${quoteSurge(username)}`);
  }
  if (password) {
    params.push(`password=${quoteSurge(password)}`);
  }
  if (isSocks && booleanValue(proxy, "udp")) {
    params.push("udp-relay=true");
  }
  if (tls) {
    params.push(...surgeTlsParams(proxy));
  }
  const suffix = [...params, ...commonSurgeParams(proxy)];
  return {
    line: `${name} = ${type}, ${quoteSurge(target.host)}, ${target.port}${suffix.length ? `, ${suffix.join(", ")}` : ""}`,
  };
}

function convertSurgeHysteria2(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const password = textValue(proxy, "password", "auth-str", "auth");
  if (!target || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  const params = [`password=${quoteSurge(password)}`, ...surgeTlsParams(proxy)];
  const ports = textValue(proxy, "ports");
  if (ports) {
    params.push(`port-hopping=${quoteSurge(ports.replaceAll(",", ";"))}`);
  }
  const down = numberValue(proxy, "down", "download-bandwidth");
  if (down) {
    params.push(`download-bandwidth=${down}`);
  }
  if (textValue(proxy, "obfs") === "salamander") {
    const obfsPassword = textValue(proxy, "obfs-password");
    if (obfsPassword) {
      params.push(`salamander-password=${quoteSurge(obfsPassword)}`);
    }
  }
  return {
    line: `${name} = hysteria2, ${quoteSurge(target.host)}, ${target.port}, ${[...params, ...commonSurgeParams(proxy)].join(", ")}`,
  };
}

function convertSurgeTuic(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = textValue(proxy, "uuid");
  const password = textValue(proxy, "password");
  const token = textValue(proxy, "token");
  if (!target || (!token && (!uuid || !password))) {
    return { line: null, reason: "缺少服务器或认证信息" };
  }
  const type = token ? "tuic" : "tuic-v5";
  const params = token
    ? [`token=${quoteSurge(token)}`]
    : [`uuid=${quoteSurge(uuid)}`, `password=${quoteSurge(password)}`];
  return {
    line: `${name} = ${type}, ${quoteSurge(target.host)}, ${target.port}, ${[
      ...params,
      ...surgeTlsParams(proxy),
      ...commonSurgeParams(proxy),
    ].join(", ")}`,
  };
}

function convertSurgeSimpleTls(proxy: ProxyRecord, name: string, type: "anytls" | "snell"): ProxyConversion {
  const target = endpoint(proxy);
  const credential = type === "snell" ? textValue(proxy, "psk") : textValue(proxy, "password");
  if (!target || !credential) {
    return { line: null, reason: "缺少服务器或认证信息" };
  }
  const params = type === "snell"
    ? [`psk=${quoteSurge(credential)}`, `version=${numberValue(proxy, "version") ?? 4}`]
    : [`password=${quoteSurge(credential)}`, ...surgeTlsParams(proxy)];
  return {
    line: `${name} = ${type}, ${quoteSurge(target.host)}, ${target.port}, ${[...params, ...commonSurgeParams(proxy)].join(", ")}`,
  };
}

function convertSurgeProxy(proxy: ProxyRecord, name: string): ProxyConversion {
  const type = textValue(proxy, "type").toLowerCase();
  switch (type) {
    case "ss":
    case "shadowsocks":
      return convertSurgeShadowsocks(proxy, name);
    case "vmess":
      return convertSurgeVmess(proxy, name);
    case "trojan":
      return convertSurgeTrojan(proxy, name);
    case "http":
    case "https":
    case "socks5":
      return convertSurgeHttpLike(proxy, name, type);
    case "hysteria2":
    case "hy2":
      return convertSurgeHysteria2(proxy, name);
    case "tuic":
      return convertSurgeTuic(proxy, name);
    case "anytls":
      return convertSurgeSimpleTls(proxy, name, "anytls");
    case "snell":
      return convertSurgeSimpleTls(proxy, name, "snell");
    default:
      return { line: null, reason: `不支持 ${type || "未知"} 协议` };
  }
}

function commonLoonParams(proxy: ProxyRecord): string[] {
  return [
    `fast-open=${booleanValue(proxy, "tfo")}`,
    `udp=${booleanValue(proxy, "udp")}`,
  ];
}

function loonTlsParams(proxy: ProxyRecord): string[] {
  const params: string[] = [];
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.push(`sni=${quoteSurge(sni)}`);
  }
  params.push(`skip-cert-verify=${booleanValue(proxy, "skip-cert-verify")}`);
  const alpn = proxy.alpn;
  if (Array.isArray(alpn) && alpn.length > 0) {
    params.push(`alpn=${quoteSurge(alpn.map(String).join(","))}`);
  }
  return params;
}

function loonTransportParams(proxy: ProxyRecord): ProxyConversion | { params: string[] } {
  const network = textValue(proxy, "network") || "tcp";
  if (network === "tcp") {
    return { params: ["transport=tcp"] };
  }
  if (network === "ws") {
    const ws = webSocketOptions(proxy);
    return {
      params: [
        "transport=ws",
        `path=${quoteSurge(ws.path)}`,
        ...(ws.host ? [`host=${quoteSurge(ws.host)}`] : []),
      ],
    };
  }
  if (network === "http" || network === "h2") {
    const options = recordValue(proxy, "http-opts");
    const hosts = options.host;
    const paths = options.path;
    const host = Array.isArray(hosts) ? String(hosts[0] ?? "") : textValue(options, "host");
    const path = Array.isArray(paths) ? String(paths[0] ?? "/") : textValue(options, "path") || "/";
    return {
      params: [
        "transport=http",
        `path=${quoteSurge(path)}`,
        ...(host ? [`host=${quoteSurge(host)}`] : []),
      ],
    };
  }
  return { line: null, reason: `不支持 ${network} 传输` };
}

function convertLoonShadowsocks(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const method = textValue(proxy, "cipher");
  const password = textValue(proxy, "password");
  if (!target || !method || !password) {
    return { line: null, reason: "缺少服务器、加密方式或密码" };
  }

  const params = commonLoonParams(proxy);
  const plugin = textValue(proxy, "plugin");
  const pluginOptions = recordValue(proxy, "plugin-opts");
  if (plugin === "obfs" || plugin === "simple-obfs") {
    params.unshift(
      `obfs-name=${textValue(pluginOptions, "mode") || "http"}`,
      ...(textValue(pluginOptions, "host") ? [`obfs-host=${quoteSurge(textValue(pluginOptions, "host"))}`] : []),
      ...(textValue(pluginOptions, "path") ? [`obfs-uri=${quoteSurge(textValue(pluginOptions, "path"))}`] : []),
    );
  } else if (plugin === "shadow-tls") {
    const shadowPassword = textValue(pluginOptions, "password");
    const shadowSni = textValue(pluginOptions, "host", "sni");
    if (!shadowPassword || !shadowSni) {
      return { line: null, reason: "Shadow TLS 缺少密码或 SNI" };
    }
    params.unshift(
      `shadow-tls-password=${quoteLoonCredential(shadowPassword)}`,
      `shadow-tls-sni=${quoteSurge(shadowSni)}`,
      `shadow-tls-version=${numberValue(pluginOptions, "version") ?? 3}`,
    );
  } else if (plugin) {
    return { line: null, reason: `不支持 ${plugin} 插件` };
  }

  return {
    line: `${name} = Shadowsocks,${quoteSurge(target.host)},${target.port},${method},${quoteLoonCredential(password)},${params.join(",")}`,
  };
}

function convertLoonV2ray(proxy: ProxyRecord, name: string, type: "vmess" | "VLESS"): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = textValue(proxy, "uuid");
  if (!target || !uuid) {
    return { line: null, reason: "缺少服务器或 UUID" };
  }
  const transport = loonTransportParams(proxy);
  if ("line" in transport) {
    return transport;
  }

  const tls = booleanValue(proxy, "tls") || Object.keys(recordValue(proxy, "reality-opts")).length > 0;
  const params = [...transport.params];
  if (type === "vmess") {
    params.push(`alterId=${numberValue(proxy, "alterId", "alter-id") ?? 0}`);
  } else {
    const flow = textValue(proxy, "flow");
    const reality = recordValue(proxy, "reality-opts");
    const publicKey = textValue(reality, "public-key");
    const shortId = textValue(reality, "short-id");
    if (flow) {
      params.push(`flow=${flow}`);
    }
    if (publicKey) {
      params.push(`public-key=${quoteSurge(publicKey)}`);
    }
    if (shortId) {
      params.push(`short-id=${quoteSurge(shortId)}`);
    }
  }
  params.push(`over-tls=${tls}`);
  if (tls) {
    params.push(...loonTlsParams(proxy));
  }
  params.push(...commonLoonParams(proxy));

  const cipher = textValue(proxy, "cipher");
  const prefix = type === "vmess"
    ? `${name} = vmess,${quoteSurge(target.host)},${target.port},${cipher === "auto" ? "none" : cipher || "none"},${quoteLoonCredential(uuid)}`
    : `${name} = VLESS,${quoteSurge(target.host)},${target.port},${quoteLoonCredential(uuid)}`;
  return { line: `${prefix},${params.join(",")}` };
}

function convertLoonTrojan(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const password = textValue(proxy, "password");
  if (!target || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  const transport = loonTransportParams(proxy);
  if ("line" in transport) {
    return transport;
  }
  return {
    line: `${name} = trojan,${quoteSurge(target.host)},${target.port},${quoteLoonCredential(password)},${[
      ...transport.params,
      ...loonTlsParams(proxy),
      ...commonLoonParams(proxy),
    ].join(",")}`,
  };
}

function convertLoonHttpLike(proxy: ProxyRecord, name: string, rawType: string): ProxyConversion {
  const target = endpoint(proxy);
  if (!target) {
    return { line: null, reason: "缺少服务器或端口" };
  }
  const tls = rawType === "https" || booleanValue(proxy, "tls");
  const type = rawType === "socks5" ? "socks5" : tls ? "https" : "http";
  const username = textValue(proxy, "username");
  const password = textValue(proxy, "password");
  const credentials = username || password ? `,${quoteSurge(username)},${quoteLoonCredential(password)}` : "";
  const params = [
    ...(tls ? loonTlsParams(proxy) : []),
    ...(type === "socks5" ? commonLoonParams(proxy) : []),
  ];
  return {
    line: `${name} = ${type},${quoteSurge(target.host)},${target.port}${credentials}${params.length ? `,${params.join(",")}` : ""}`,
  };
}

function convertLoonSimpleTls(proxy: ProxyRecord, name: string, type: "Hysteria2" | "AnyTLS"): ProxyConversion {
  const target = endpoint(proxy);
  const password = textValue(proxy, "password", "auth-str", "auth");
  if (!target || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  const params = [...loonTlsParams(proxy), ...commonLoonParams(proxy)];
  if (type === "Hysteria2" && textValue(proxy, "obfs") === "salamander") {
    const obfsPassword = textValue(proxy, "obfs-password");
    if (obfsPassword) {
      params.push(`salamander-password=${quoteSurge(obfsPassword)}`);
    }
  }
  return {
    line: `${name} = ${type},${quoteSurge(target.host)},${target.port},${quoteLoonCredential(password)},${params.join(",")}`,
  };
}

function convertLoonProxy(proxy: ProxyRecord, name: string): ProxyConversion {
  const type = textValue(proxy, "type").toLowerCase();
  switch (type) {
    case "ss":
    case "shadowsocks":
      return convertLoonShadowsocks(proxy, name);
    case "vmess":
      return convertLoonV2ray(proxy, name, "vmess");
    case "vless":
      return convertLoonV2ray(proxy, name, "VLESS");
    case "trojan":
      return convertLoonTrojan(proxy, name);
    case "http":
    case "https":
    case "socks5":
      return convertLoonHttpLike(proxy, name, type);
    case "hysteria2":
    case "hy2":
      return convertLoonSimpleTls(proxy, name, "Hysteria2");
    case "anytls":
      return convertLoonSimpleTls(proxy, name, "AnyTLS");
    default:
      return { line: null, reason: `不支持 ${type || "未知"} 协议` };
  }
}

function buildProxyDocument(
  proxies: ParsedProxy[],
  client: "surge" | "quantumult-x" | "loon",
  converter: LineConverter,
): SubscriptionDocument {
  const seenNames = new Map<string, number>();
  const lines: string[] = [];
  const warnings: string[] = [];

  for (const proxy of proxies) {
    const name = uniqueName(textValue(proxy, "name"), seenNames);
    const converted = converter(proxy, name);
    if (converted.line !== null) {
      lines.push(converted.line);
    } else {
      warnings.push(`${name}: ${converted.reason}`);
    }
  }

  const labels = {
    surge: "Surge proxy list",
    "quantumult-x": "Quantumult X server resource",
    loon: "Loon native node list",
  } as const;
  const filenames = {
    surge: "surge.conf",
    "quantumult-x": "quantumult-x.conf",
    loon: "loon.conf",
  } as const;
  const comments = [
    "# Generated by NekoCube. Do not edit this managed resource.",
    `# Format: ${labels[client]}`,
    `# Exported proxies: ${lines.length}/${proxies.length}`,
    ...warnings.map((warning) => `# Skipped: ${warning}`),
  ];

  return {
    client,
    content: `${[...comments, "", ...lines].join("\n")}\n`,
    contentType: "text/plain; charset=utf-8",
    filename: filenames[client],
    proxyCount: lines.length,
    skippedCount: warnings.length,
    warnings,
  };
}

function buildShadowrocketDocument(proxies: ParsedProxy[]): SubscriptionDocument {
  const seenNames = new Map<string, number>();
  const lines: string[] = [];
  const warnings: string[] = [];
  for (const proxy of proxies) {
    const name = uniqueName(textValue(proxy, "name"), seenNames);
    const converted = convertShadowrocketProxy(proxy, name);
    if (converted.line !== null) {
      lines.push(converted.line);
    } else {
      warnings.push(`${name}: ${converted.reason}`);
    }
  }
  return {
    client: "shadowrocket",
    content: `${Buffer.from(lines.join("\n"), "utf8").toString("base64")}\n`,
    contentType: "text/plain; charset=utf-8",
    filename: "shadowrocket.txt",
    proxyCount: lines.length,
    skippedCount: warnings.length,
    warnings,
  };
}

export function exportSubscriptionDocument(
  config: Record<string, unknown>,
  client: Exclude<SubscriptionClientId, "mihomo">,
): SubscriptionDocument {
  const proxies = Array.isArray(config.proxies) ? (config.proxies as ParsedProxy[]) : [];
  switch (client) {
    case "surge":
      return buildProxyDocument(proxies, client, convertSurgeProxy);
    case "quantumult-x":
      return buildProxyDocument(proxies, client, convertQuantumProxy);
    case "loon":
      return buildProxyDocument(proxies, client, convertLoonProxy);
    case "shadowrocket":
      return buildShadowrocketDocument(proxies);
  }
}
