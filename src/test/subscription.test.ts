import { describe, expect, it } from "vitest";
import { parseClashSubscription } from "@shared/subscription";

describe("parseClashSubscription", () => {
  it("parses clash yaml proxies", () => {
    const result = parseClashSubscription(`
proxies:
  - name: HK 01
    type: ss
    server: 192.0.2.1
    port: 443
    password: abc
    cipher: aes-256-gcm
`);

    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0]?.name).toBe("HK 01");
  });

  it("throws on invalid yaml", () => {
    expect(() => parseClashSubscription("proxies: [")).toThrow(/Unsupported subscription format|Invalid YAML/);
  });

  it("parses base64 encoded uri subscriptions", () => {
    const uriList = [
      "hysteria2://password@example.com:443/?insecure=1&sni=www.bing.com#%F0%9F%87%AF%F0%9F%87%B5%E6%97%A5%E6%9C%AC",
      "vless://uuid@example.com:443?type=ws&encryption=none&security=tls&host=cdn.example.com&path=%2Fws&sni=cdn.example.com#US-01",
    ].join("\n");
    const encoded = Buffer.from(uriList, "utf8").toString("base64");

    const result = parseClashSubscription(encoded);

    expect(result.proxies).toHaveLength(2);
    expect(result.proxies[0]?.type).toBe("hysteria2");
    expect(result.proxies[1]?.type).toBe("vless");
    expect(result.proxies[1]?.["ws-opts"]).toEqual({
      path: "/ws",
      headers: { Host: "cdn.example.com" },
    });
  });

  it("filters metadata lines from uri subscriptions", () => {
    const uriList = [
      "hysteria2://password@example.com:443/?insecure=1&sni=www.bing.com#%E5%89%A9%E4%BD%99%E6%B5%81%E9%87%8F%EF%BC%9A99.97%20GB",
      "hysteria2://password@example.com:443/?insecure=1&sni=www.bing.com#SG-01",
    ].join("\n");

    const result = parseClashSubscription(Buffer.from(uriList, "utf8").toString("base64"));
    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0]?.name).toBe("SG-01");
  });

  it("filters placeholder clash yaml proxies", () => {
    const result = parseClashSubscription(`
proxies:
  - name: 当前Clash客户端不支持本机场协议
    type: ss
    server: 127.0.0.1
    port: 1234
    password: test
    cipher: aes-256-gcm
  - name: HK 01
    type: ss
    server: 192.0.2.1
    port: 443
    password: test
    cipher: aes-256-gcm
`);

    expect(result.proxies).toHaveLength(1);
    expect(result.proxies[0]?.name).toBe("HK 01");
  });
});
