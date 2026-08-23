import { describe, expect, it } from "vitest";
import { exportSubscriptionDocument } from "../shared/subscription-export";

const config = {
  proxies: [
    {
      name: "Hong Kong, 01",
      type: "ss",
      server: "192.0.2.1",
      port: 443,
      cipher: "aes-256-gcm",
      password: "ss-secret",
      udp: true,
    },
    {
      name: "Tokyo VMess",
      type: "vmess",
      server: "vmess.example.com",
      port: 443,
      uuid: "00000000-0000-4000-8000-000000000001",
      alterId: 0,
      cipher: "auto",
      tls: true,
      network: "ws",
      sni: "edge.example.com",
      "ws-opts": { path: "/socket", headers: { Host: "edge.example.com" } },
    },
    {
      name: "Reality VLESS",
      type: "vless",
      server: "198.51.100.8",
      port: 443,
      uuid: "00000000-0000-4000-8000-000000000002",
      tls: true,
      network: "tcp",
      sni: "www.example.com",
      flow: "xtls-rprx-vision",
      "reality-opts": { "public-key": "public-key", "short-id": "01ab" },
    },
    {
      name: "Singapore Trojan",
      type: "trojan",
      server: "203.0.113.9",
      port: 443,
      password: "trojan-secret",
      sni: "trojan.example.com",
    },
    {
      name: "Hysteria 2",
      type: "hysteria2",
      server: "hy2.example.com",
      port: 443,
      password: "hy2-secret",
      ports: "2000-3000,4000",
      obfs: "salamander",
      "obfs-password": "obfs-secret",
      down: 100,
    },
    {
      name: "Unsupported WireGuard",
      type: "wireguard",
      server: "192.0.2.9",
      port: 51820,
    },
  ],
};

describe("exportSubscriptionDocument", () => {
  it("exports a native Quantumult X server resource and reports skipped protocols", () => {
    const result = exportSubscriptionDocument(config, "quantumult-x");

    expect(result.contentType).toContain("text/plain");
    expect(result.proxyCount).toBe(4);
    expect(result.skippedCount).toBe(2);
    expect(result.content).toContain("shadowsocks=192.0.2.1:443, method=aes-256-gcm");
    expect(result.content).toContain("tag=Hong Kong · 01");
    expect(result.content).toContain("vmess=vmess.example.com:443");
    expect(result.content).toContain("obfs=wss");
    expect(result.content).toContain("vless=198.51.100.8:443");
    expect(result.content).toContain("reality-base64-pubkey=public-key");
    expect(result.content).toContain("vless-flow=xtls-rprx-vision");
    expect(result.content).toContain("trojan=203.0.113.9:443");
    expect(result.content).toContain("# Skipped: Hysteria 2: 不支持 hysteria2 协议");
  });

  it("exports a native Surge proxy list with modern protocols", () => {
    const result = exportSubscriptionDocument(config, "surge");

    expect(result.proxyCount).toBe(4);
    expect(result.skippedCount).toBe(2);
    expect(result.content).toContain("Hong Kong · 01 = ss, 192.0.2.1, 443");
    expect(result.content).toContain("encrypt-method=aes-256-gcm");
    expect(result.content).toContain("Tokyo VMess = vmess, vmess.example.com, 443");
    expect(result.content).toContain("vmess-aead=true");
    expect(result.content).toContain("Singapore Trojan = trojan, 203.0.113.9, 443");
    expect(result.content).toContain("Hysteria 2 = hysteria2, hy2.example.com, 443");
    expect(result.content).toContain("port-hopping=2000-3000;4000");
    expect(result.content).toContain("salamander-password=obfs-secret");
    expect(result.content).toContain("# Skipped: Reality VLESS: 不支持 vless 协议");
  });

  it("exports a native Loon node subscription", () => {
    const result = exportSubscriptionDocument(config, "loon");

    expect(result.filename).toBe("loon-nodes.conf");
    expect(result.proxyCount).toBe(5);
    expect(result.skippedCount).toBe(1);
    expect(result.content).toContain(
      'Hong Kong · 01 = Shadowsocks,192.0.2.1,443,aes-256-gcm,"ss-secret",fast-open=false,udp=true',
    );
    expect(result.content).toContain(
      'Tokyo VMess = vmess,vmess.example.com,443,none,"00000000-0000-4000-8000-000000000001"',
    );
    expect(result.content).toContain("transport=ws,path=/socket,host=edge.example.com,alterId=0,over-tls=true");
    expect(result.content).toContain("Reality VLESS = VLESS,198.51.100.8,443");
    expect(result.content).toContain("public-key=public-key,short-id=01ab,over-tls=true,sni=www.example.com");
    expect(result.content).toContain('Hysteria 2 = Hysteria2,hy2.example.com,443,"hy2-secret"');
    expect(result.content).toContain("salamander-password=obfs-secret");
    expect(result.content).toContain("# Skipped: Unsupported WireGuard: 不支持 wireguard 协议");
  });

  it("exports a Base64 encoded Shadowrocket URI subscription", () => {
    const result = exportSubscriptionDocument(config, "shadowrocket");
    const decoded = Buffer.from(result.content.trim(), "base64").toString("utf8");

    expect(result.filename).toBe("shadowrocket-nodes.txt");
    expect(result.proxyCount).toBe(5);
    expect(result.skippedCount).toBe(1);
    expect(decoded).toContain("ss://");
    expect(decoded).toContain("#Hong%20Kong%20%C2%B7%2001");
    expect(decoded).toContain("vmess://");
    expect(decoded).toContain("vless://00000000-0000-4000-8000-000000000002@198.51.100.8:443?");
    expect(decoded).toContain("security=reality");
    expect(decoded).toContain("flow=xtls-rprx-vision");
    expect(decoded).toContain("pbk=public-key");
    expect(decoded).toContain("trojan://trojan-secret@203.0.113.9:443?");
    expect(decoded).toContain("hysteria2://hy2-secret@hy2.example.com:443/");
    expect(decoded).not.toContain("Unsupported%20WireGuard");
  });

  it("skips plugin transports that the target client cannot represent", () => {
    const result = exportSubscriptionDocument(
      {
        proxies: [
          {
            name: "Plugin SS",
            type: "ss",
            server: "192.0.2.10",
            port: 443,
            cipher: "aes-128-gcm",
            password: "secret",
            plugin: "shadow-tls",
          },
        ],
      },
      "surge",
    );

    expect(result.proxyCount).toBe(0);
    expect(result.warnings).toEqual(["Plugin SS: 不支持 shadow-tls 插件"]);
  });
});
