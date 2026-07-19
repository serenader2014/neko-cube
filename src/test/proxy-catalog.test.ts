import { describe, expect, it } from "vitest";
import { buildProxyCatalog, type SourceWithSnapshot } from "../web/lib/proxy-catalog";

describe("proxy catalog", () => {
  it("keeps manual proxies that share the same endpoint but have different names or dialer groups", () => {
    const sources: SourceWithSnapshot[] = [];
    const manualProxyYaml = `
- name: HK-yecao-HGC
  type: trojan
  server: 203.0.113.39
  port: 20485
  password: same-password
- name: 香港家宽落地
  type: trojan
  server: 203.0.113.39
  port: 20485
  password: same-password
  dialer-proxy: 香港家宽中转
`.trim();

    const catalog = buildProxyCatalog(sources, manualProxyYaml, []);

    expect(catalog.manualNames).toEqual(["HK-yecao-HGC", "香港家宽落地"]);
    expect(catalog.proxies.map((proxy) => proxy.finalName)).toContain("HK-yecao-HGC");
    expect(catalog.proxies.map((proxy) => proxy.finalName)).toContain("香港家宽落地");
  });
});
