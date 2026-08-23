import type { RuleProviderSource } from "../../shared/subscription-rule-export.js";

export type CachedRuleProviderContent = {
  content: string;
  warning: string | null;
};

type CacheEntry = {
  content: string;
  expiresAt: number;
};

export function createRuleProviderCache(
  fetchText: (url: string, proxyUrl: string | null) => Promise<string>,
  now: () => number = Date.now,
) {
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CachedRuleProviderContent>>();

  async function refresh(
    cacheKey: string,
    source: RuleProviderSource,
    proxyUrl: string | null,
  ): Promise<CachedRuleProviderContent> {
    const stale = entries.get(cacheKey);
    try {
      const content = await fetchText(source.url, proxyUrl);
      entries.set(cacheKey, {
        content,
        expiresAt: now() + source.interval * 1000,
      });
      return { content, warning: null };
    } catch (error) {
      if (!stale) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: stale.content,
        warning: `上游刷新失败，已使用缓存规则：${message}`,
      };
    }
  }

  async function get(source: RuleProviderSource, proxyUrl: string | null): Promise<CachedRuleProviderContent> {
    const cacheKey = `${source.url}\0${source.interval}`;
    const cached = entries.get(cacheKey);
    if (cached && cached.expiresAt > now()) {
      return { content: cached.content, warning: null };
    }

    const pending = inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = refresh(cacheKey, source, proxyUrl).finally(() => inFlight.delete(cacheKey));
    inFlight.set(cacheKey, request);
    return request;
  }

  return { get };
}
