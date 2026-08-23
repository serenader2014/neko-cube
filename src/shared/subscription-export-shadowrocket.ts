import {
  booleanValue,
  endpoint,
  numberValue,
  type ProxyConversion,
  type ProxyRecord,
  recordValue,
  textValue,
  webSocketOptions,
} from "./subscription-export-utils.js";

function uriHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function uriFragment(name: string): string {
  return `#${encodeURIComponent(name)}`;
}

function transportParams(proxy: ProxyRecord): ProxyConversion | { params: URLSearchParams } {
  const network = textValue(proxy, "network") || "tcp";
  const params = new URLSearchParams({ type: network });
  if (network === "tcp") {
    return { params };
  }
  if (network === "ws") {
    const ws = webSocketOptions(proxy);
    params.set("path", ws.path);
    if (ws.host) {
      params.set("host", ws.host);
    }
    return { params };
  }
  if (network === "http" || network === "h2") {
    const options = recordValue(proxy, "http-opts");
    const hosts = options.host;
    const paths = options.path;
    const host = Array.isArray(hosts) ? String(hosts[0] ?? "") : textValue(options, "host");
    const path = Array.isArray(paths) ? String(paths[0] ?? "/") : textValue(options, "path") || "/";
    params.set("path", path);
    if (host) {
      params.set("host", host);
    }
    return { params };
  }
  if (network === "grpc") {
    const options = recordValue(proxy, "grpc-opts");
    params.set("serviceName", textValue(options, "grpc-service-name"));
    return { params };
  }
  return { line: null, reason: `不支持 ${network} 传输` };
}

function appendTlsParams(proxy: ProxyRecord, params: URLSearchParams): void {
  const reality = recordValue(proxy, "reality-opts");
  const security = Object.keys(reality).length > 0 ? "reality" : booleanValue(proxy, "tls") ? "tls" : "none";
  params.set("security", security);
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.set("sni", sni);
  }
  if (booleanValue(proxy, "skip-cert-verify")) {
    params.set("allowInsecure", "1");
  }
  const fingerprint = textValue(proxy, "client-fingerprint", "fingerprint");
  if (fingerprint) {
    params.set("fp", fingerprint);
  }
  const alpn = proxy.alpn;
  if (Array.isArray(alpn) && alpn.length > 0) {
    params.set("alpn", alpn.map(String).join(","));
  }
  const publicKey = textValue(reality, "public-key");
  const shortId = textValue(reality, "short-id");
  if (publicKey) {
    params.set("pbk", publicKey);
  }
  if (shortId) {
    params.set("sid", shortId);
  }
}

function convertShadowsocks(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const method = textValue(proxy, "cipher");
  const password = textValue(proxy, "password");
  if (!target || !method || !password) {
    return { line: null, reason: "缺少服务器、加密方式或密码" };
  }
  const params = new URLSearchParams();
  const plugin = textValue(proxy, "plugin");
  const options = recordValue(proxy, "plugin-opts");
  if (plugin === "obfs" || plugin === "simple-obfs") {
    const parts = ["obfs-local", `obfs=${textValue(options, "mode") || "http"}`];
    const host = textValue(options, "host");
    if (host) {
      parts.push(`obfs-host=${host}`);
    }
    params.set("plugin", parts.join(";"));
  } else if (plugin === "v2ray-plugin") {
    const parts = ["v2ray-plugin", "mode=websocket"];
    const host = textValue(options, "host");
    const path = textValue(options, "path");
    if (host) {
      parts.push(`host=${host}`);
    }
    if (path) {
      parts.push(`path=${path}`);
    }
    if (booleanValue(options, "tls")) {
      parts.push("tls");
    }
    params.set("plugin", parts.join(";"));
  } else if (plugin) {
    return { line: null, reason: `不支持 ${plugin} 插件` };
  }
  const userInfo = Buffer.from(`${method}:${password}`, "utf8").toString("base64url");
  const query = params.size > 0 ? `/?${params.toString()}` : "";
  return {
    line: `ss://${userInfo}@${uriHost(target.host)}:${target.port}${query}${uriFragment(name)}`,
  };
}

function convertVmess(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = textValue(proxy, "uuid");
  if (!target || !uuid) {
    return { line: null, reason: "缺少服务器或 UUID" };
  }
  const transport = transportParams(proxy);
  if ("line" in transport) {
    return transport;
  }
  const network = transport.params.get("type") || "tcp";
  const payload = {
    v: "2",
    ps: name,
    add: target.host,
    port: String(target.port),
    id: uuid,
    aid: String(numberValue(proxy, "alterId", "alter-id") ?? 0),
    scy: textValue(proxy, "cipher") || "auto",
    net: network,
    type: "none",
    host: transport.params.get("host") || "",
    path: transport.params.get("path") || transport.params.get("serviceName") || "",
    tls: booleanValue(proxy, "tls") ? "tls" : "",
    sni: textValue(proxy, "servername", "sni"),
    alpn: Array.isArray(proxy.alpn) ? proxy.alpn.map(String).join(",") : "",
    fp: textValue(proxy, "client-fingerprint", "fingerprint"),
  };
  return { line: `vmess://${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}` };
}

function convertVlessOrTrojan(
  proxy: ProxyRecord,
  name: string,
  type: "vless" | "trojan",
): ProxyConversion {
  const target = endpoint(proxy);
  const credential = type === "vless" ? textValue(proxy, "uuid") : textValue(proxy, "password");
  if (!target || !credential) {
    return { line: null, reason: `缺少服务器或${type === "vless" ? " UUID" : "密码"}` };
  }
  const transport = transportParams(proxy);
  if ("line" in transport) {
    return transport;
  }
  const params = transport.params;
  appendTlsParams(proxy, params);
  if (type === "vless") {
    params.set("encryption", textValue(proxy, "encryption") || "none");
    const flow = textValue(proxy, "flow");
    if (flow) {
      params.set("flow", flow);
    }
  }
  return {
    line: `${type}://${encodeURIComponent(credential)}@${uriHost(target.host)}:${target.port}?${params.toString()}${uriFragment(name)}`,
  };
}

function convertHysteria2(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const password = textValue(proxy, "password", "auth-str", "auth");
  if (!target || !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  const params = new URLSearchParams();
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.set("sni", sni);
  }
  if (booleanValue(proxy, "skip-cert-verify")) {
    params.set("insecure", "1");
  }
  const ports = textValue(proxy, "ports");
  if (ports) {
    params.set("mport", ports);
  }
  if (textValue(proxy, "obfs") === "salamander") {
    params.set("obfs", "salamander");
    const obfsPassword = textValue(proxy, "obfs-password");
    if (obfsPassword) {
      params.set("obfs-password", obfsPassword);
    }
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return {
    line: `hysteria2://${encodeURIComponent(password)}@${uriHost(target.host)}:${target.port}/${query}${uriFragment(name)}`,
  };
}

function convertTuic(proxy: ProxyRecord, name: string): ProxyConversion {
  const target = endpoint(proxy);
  const uuid = textValue(proxy, "uuid");
  const password = textValue(proxy, "password");
  if (!target || !uuid || !password) {
    return { line: null, reason: "仅支持带 UUID 和密码的 TUIC v5 节点" };
  }
  const params = new URLSearchParams();
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.set("sni", sni);
  }
  if (booleanValue(proxy, "skip-cert-verify")) {
    params.set("allow_insecure", "1");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return {
    line: `tuic://${encodeURIComponent(uuid)}:${encodeURIComponent(password)}@${uriHost(target.host)}:${target.port}/${query}${uriFragment(name)}`,
  };
}

function convertSimpleUri(
  proxy: ProxyRecord,
  name: string,
  type: "http" | "socks5" | "anytls",
): ProxyConversion {
  const target = endpoint(proxy);
  if (!target) {
    return { line: null, reason: "缺少服务器或端口" };
  }
  const username = type === "anytls" ? "" : textValue(proxy, "username");
  const password = textValue(proxy, "password");
  if (type === "anytls" && !password) {
    return { line: null, reason: "缺少服务器或密码" };
  }
  const tls = type === "anytls" || proxy.type === "https" || booleanValue(proxy, "tls");
  const scheme = type === "http" ? (tls ? "https" : "http") : type;
  const auth = type === "anytls"
    ? `${encodeURIComponent(password)}@`
    : username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : "";
  const params = new URLSearchParams();
  const sni = textValue(proxy, "servername", "sni");
  if (sni) {
    params.set("sni", sni);
  }
  if (booleanValue(proxy, "skip-cert-verify")) {
    params.set("allowInsecure", "1");
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return {
    line: `${scheme}://${auth}${uriHost(target.host)}:${target.port}/${query}${uriFragment(name)}`,
  };
}

export function convertShadowrocketProxy(proxy: ProxyRecord, name: string): ProxyConversion {
  const type = textValue(proxy, "type").toLowerCase();
  switch (type) {
    case "ss":
    case "shadowsocks":
      return convertShadowsocks(proxy, name);
    case "vmess":
      return convertVmess(proxy, name);
    case "vless":
      return convertVlessOrTrojan(proxy, name, "vless");
    case "trojan":
      return convertVlessOrTrojan(proxy, name, "trojan");
    case "hysteria2":
    case "hy2":
      return convertHysteria2(proxy, name);
    case "tuic":
      return convertTuic(proxy, name);
    case "http":
    case "https":
      return convertSimpleUri(proxy, name, "http");
    case "socks5":
      return convertSimpleUri(proxy, name, "socks5");
    case "anytls":
      return convertSimpleUri(proxy, name, "anytls");
    default:
      return { line: null, reason: `不支持 ${type || "未知"} 协议` };
  }
}
