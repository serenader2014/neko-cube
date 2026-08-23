import { describe, expect, it, vi } from "vitest";
import { createRuleProviderCache } from "../server/services/rule-provider-cache";
import type { RuleProviderSource } from "../shared/subscription-rule-export";

const source: RuleProviderSource = {
  name: "AdBlock",
  behavior: "domain",
  format: "yaml",
  url: "https://rules.example.com/adblock.yaml",
  interval: 60,
};

describe("rule provider cache", () => {
  it("deduplicates refreshes and serves the last result when an update fails", async () => {
    let now = 1_000;
    const fetchText = vi.fn(async () => "payload:\n  - +.example.com\n");
    const cache = createRuleProviderCache(fetchText, () => now);

    const [first, concurrent] = await Promise.all([cache.get(source, null), cache.get(source, null)]);
    const fresh = await cache.get(source, null);

    expect(first.content).toBe(concurrent.content);
    expect(fresh.warning).toBeNull();
    expect(fetchText).toHaveBeenCalledTimes(1);

    now += 61_000;
    fetchText.mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"));
    const stale = await cache.get(source, null);

    expect(stale.content).toBe(first.content);
    expect(stale.warning).toContain("已使用缓存规则");
    expect(stale.warning).toContain("HTTP 503");
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it("propagates the first upstream failure when no cached result exists", async () => {
    const cache = createRuleProviderCache(
      vi.fn(async () => {
        throw new Error("network failed");
      }),
    );

    await expect(cache.get(source, null)).rejects.toThrow("network failed");
  });
});
