import { describe, expect, it } from "vitest";
import {
  exportRuleSetDocument,
  readRuleProviderSource,
  type RuleProviderSource,
} from "../shared/subscription-rule-export";

const classicalSource: RuleProviderSource = {
  name: "AdBlock",
  behavior: "classical",
  format: "yaml",
  url: "https://rules.example.com/adblock.yaml",
  interval: 3600,
};

const classicalYaml = `payload:
  - DOMAIN,ads.example.com
  - DOMAIN-SUFFIX,tracking.example
  - DOMAIN-KEYWORD,advert
  - IP-CIDR,192.0.2.0/24,no-resolve
  - IP-CIDR6,2001:db8::/32,no-resolve
  - PROCESS-NAME,AdApp
  - DOMAIN-SUFFIX,tracking.example
`;

describe("exportRuleSetDocument", () => {
  it("converts Clash classical YAML into a Surge rule set without policies", () => {
    const result = exportRuleSetDocument(classicalSource, classicalYaml, "surge");

    expect(result.content).toContain("DOMAIN,ads.example.com");
    expect(result.content).toContain("DOMAIN-SUFFIX,tracking.example");
    expect(result.content).toContain("IP-CIDR,192.0.2.0/24,no-resolve");
    expect(result.content).toContain("IP-CIDR6,2001:db8::/32,no-resolve");
    expect(result.content).toContain("PROCESS-NAME,AdApp");
    expect(result.content).not.toContain("DOMAIN,ads.example.com,DIRECT");
    expect(result.ruleCount).toBe(6);
    expect(result.skippedCount).toBe(1);
    expect(result.warnings).toContain("跳过 1 条规则：转换后规则重复");
  });

  it("maps Clash rule types to Quantumult X filter syntax", () => {
    const result = exportRuleSetDocument(classicalSource, classicalYaml, "quantumult-x");

    expect(result.content).toContain("host,ads.example.com,direct");
    expect(result.content).toContain("host-suffix,tracking.example,direct");
    expect(result.content).toContain("host-keyword,advert,direct");
    expect(result.content).toContain("ip-cidr,192.0.2.0/24,direct");
    expect(result.content).toContain("ip6-cidr,2001:db8::/32,direct");
    expect(result.content).not.toContain("PROCESS-NAME,AdApp");
    expect(result.warnings).toContain("跳过 1 条规则：Quantumult X 不支持 PROCESS-NAME");
  });

  it("expands domain and ipcidr behavior payloads", () => {
    const domainResult = exportRuleSetDocument(
      { ...classicalSource, behavior: "domain" },
      "payload:\n  - +.example.com\n  - exact.example\n  - '*.unsupported.*'\n",
      "loon",
    );
    const ipResult = exportRuleSetDocument(
      { ...classicalSource, behavior: "ipcidr" },
      "payload:\n  - 198.51.100.0/24\n  - 2001:db8::/32\n",
      "shadowrocket",
    );

    expect(domainResult.content).toContain("DOMAIN-SUFFIX,example.com");
    expect(domainResult.content).toContain("DOMAIN,exact.example");
    expect(domainResult.warnings).toContain("跳过 1 条规则：不支持的域名通配表达式");
    expect(ipResult.content).toContain("IP-CIDR,198.51.100.0/24");
    expect(ipResult.content).toContain("IP-CIDR,2001:db8::/32");
  });

  it("accepts text sources and reports malformed YAML", () => {
    const textResult = exportRuleSetDocument(
      { ...classicalSource, format: "text" },
      "# comment\nDOMAIN-SUFFIX,example.com\n\nIP-CIDR,203.0.113.0/24\n",
      "loon",
    );

    expect(textResult.ruleCount).toBe(2);
    expect(() => exportRuleSetDocument(classicalSource, "proxies: []", "surge")).toThrow(
      "Clash YAML 缺少 payload 数组",
    );
  });
});

describe("readRuleProviderSource", () => {
  it("reads a compiled HTTP rule provider", () => {
    expect(
      readRuleProviderSource(
        {
          "rule-providers": {
            AdBlock: {
              type: "http",
              behavior: "domain",
              format: "yaml",
              url: "https://rules.example.com/adblock.yaml",
              interval: 7200,
            },
          },
        },
        "AdBlock",
      ),
    ).toEqual({
      name: "AdBlock",
      behavior: "domain",
      format: "yaml",
      url: "https://rules.example.com/adblock.yaml",
      interval: 7200,
    });
  });
});
