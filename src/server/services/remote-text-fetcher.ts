import { fetch as undiciFetch, ProxyAgent } from "undici";
import { getMockSubscription } from "../lib/mock-subscriptions.js";

export type ProxyFetch = typeof undiciFetch;

function createFetchOptions(proxyUrl: string | null | undefined, timeoutMs: number) {
  const options: { signal: AbortSignal; dispatcher?: ProxyAgent } = {
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (proxyUrl) {
    options.dispatcher = new ProxyAgent(proxyUrl);
  }

  return options;
}

export async function fetchRemoteText(
  url: string,
  proxyUrl: string | null = null,
  proxyFetch: ProxyFetch = undiciFetch,
): Promise<string> {
  const mockContent = getMockSubscription(url);
  if (mockContent) {
    return mockContent;
  }

  const response = proxyUrl
    ? await proxyFetch(url, createFetchOptions(proxyUrl, 30_000))
    : await fetch(url, createFetchOptions(null, 30_000));

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  return response.text();
}
