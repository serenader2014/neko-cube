import { describe, expect, it } from "vitest";
import { exportClientProfileDocument } from "../shared/subscription-profile-export";

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
  ],
  "proxy-groups": [
    {
      name: "FINAL",
      type: "select",
      proxies: ["Hong Kong, 01", "DIRECT"],
    },
    {
      name: "AUTO",
      type: "url-test",
      proxies: ["Hong Kong, 01"],
      url: "http://cp.cloudflare.com/generate_204",
      interval: 300,
      timeout: 5000,
    },
  ],
  "rule-providers": {
    Apple: {
      type: "http",
      behavior: "classical",
      format: "text",
      url: "https://rules.example.com/apple.list",
      interval: 3600,
    },
  },
  rules: [
    "DOMAIN-SUFFIX,example.com,AUTO",
    "IP-CIDR,192.0.2.0/24,DIRECT,no-resolve",
    "RULE-SET,Apple,FINAL",
    "MATCH,FINAL",
  ],
};

describe("exportClientProfileDocument", () => {
  it("builds a complete Surge profile with groups, rules, and rule sets", () => {
    const result = exportClientProfileDocument(config, "surge");

    expect(result.kind).toBe("profile");
    expect(result.filename).toBe("surge-profile.conf");
    expect(result.content).toContain("[Proxy]");
    expect(result.content).toContain("Hong Kong · 01 = ss, 192.0.2.1, 443");
    expect(result.content).toContain("[Proxy Group]");
    expect(result.content).toContain("AUTO = url-test, Hong Kong · 01");
    expect(result.content).toContain("DOMAIN-SUFFIX,example.com,AUTO");
    expect(result.content).toContain("RULE-SET,https://rules.example.com/apple.list,FINAL");
    expect(result.content).toContain("FINAL,FINAL");
  });

  it("builds a complete Quantumult X profile with remote filters", () => {
    const result = exportClientProfileDocument(config, "quantumult-x");

    expect(result.content).toContain("[server_local]");
    expect(result.content).toContain("shadowsocks=192.0.2.1:443");
    expect(result.content).toContain("[policy]");
    expect(result.content).toContain("url-latency-benchmark = AUTO, Hong Kong · 01, check-interval=300");
    expect(result.content).toContain("[filter_remote]");
    expect(result.content).toContain(
      "https://rules.example.com/apple.list, tag=Apple, force-policy=FINAL, enabled=true",
    );
    expect(result.content).toContain("host-suffix,example.com,AUTO");
    expect(result.content).toContain("final,FINAL");
  });

  it("builds a complete Loon profile with its Remote Rule section", () => {
    const result = exportClientProfileDocument(config, "loon");

    expect(result.content).toContain("[Proxy]");
    expect(result.content).toContain("Hong Kong · 01 = Shadowsocks,192.0.2.1,443");
    expect(result.content).toContain("[Remote Rule]");
    expect(result.content).toContain(
      "https://rules.example.com/apple.list,policy=FINAL,tag=Apple,enabled=true",
    );
    expect(result.content).toContain("IP-CIDR,192.0.2.0/24,DIRECT,no-resolve");
  });

  it("builds a complete Shadowrocket profile instead of a Base64 node feed", () => {
    const result = exportClientProfileDocument(config, "shadowrocket");

    expect(result.filename).toBe("shadowrocket-profile.conf");
    expect(result.content).toContain("[Proxy]");
    expect(result.content).toContain(
      "Hong Kong · 01 = ss, 192.0.2.1, 443, password=ss-secret, method=aes-256-gcm",
    );
    expect(result.content).toContain("[Proxy Group]");
    expect(result.content).toContain("RULE-SET,https://rules.example.com/apple.list,FINAL");
    expect(result.content).not.toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
