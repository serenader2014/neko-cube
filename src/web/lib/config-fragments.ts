import type { ParsedProxy } from "@shared/types";
import { parse, stringify } from "yaml";

export type ParsedBuiltinRule = {
  raw: string;
  matcher: string;
  value: string;
  policy: string;
  noResolve: boolean;
};

export type ParsedManualProxy = {
  name: string;
  type: string;
  server: string;
  port: string;
  plugin: string;
  cipher: string;
  dialerProxy: string;
};

type ParseResult<T> = {
  items: T[];
  error: string | null;
};

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function toYamlList(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return { items: [] as string[], error: null };
  }

  try {
    const parsed = parse(text);
    if (Array.isArray(parsed)) {
      return {
        items: parsed.map((item) => stringifyValue(item).trim()).filter(Boolean),
        error: null,
      };
    }
  } catch (error) {
    return {
      items: [] as string[],
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }

  return {
    items: trimmed
      .split("\n")
      .map((line) => line.replace(/^\s*-\s*/, "").trim())
      .filter(Boolean),
    error: null,
  };
}

export function parseBuiltinRules(text: string): ParseResult<ParsedBuiltinRule> {
  const list = toYamlList(text);
  return {
    error: list.error,
    items: list.items.map((line) => {
      const segments = line.split(",").map((item) => item.trim());
      const matcher = segments[0] || "RAW";
      const value = matcher === "MATCH" ? "" : segments[1] || "";
      const policy = matcher === "MATCH" ? segments[1] || "" : segments[2] || "";
      const flags = matcher === "MATCH" ? segments.slice(2) : segments.slice(3);
      return {
        raw: line,
        matcher,
        value,
        policy,
        noResolve: flags.includes("no-resolve"),
      };
    }),
  };
}

export function stringifyBuiltinRules(items: ParsedBuiltinRule[]): string {
  const lines = items
    .map((item) => buildBuiltinRuleLine(item))
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length ? stringify(lines).trim() : "";
}

export function parseHostsEntries(text: string): ParseResult<{ host: string; target: string }> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { items: [], error: null };
  }

  try {
    const parsed = parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        items: Object.entries(parsed as Record<string, unknown>).map(([host, target]) => ({
          host,
          target: stringifyValue(target),
        })),
        error: null,
      };
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }

  return { items: [], error: "hosts 片段不是合法的键值映射" };
}

export function stringifyHostsEntries(items: Array<{ host: string; target: string }>): string {
  const next = Object.fromEntries(
    items
      .map((item) => [item.host.trim(), item.target.trim()] as const)
      .filter(([host, target]) => host && target),
  );

  return Object.keys(next).length ? stringify(next).trim() : "";
}

export function parseManualProxies(text: string): ParseResult<ParsedManualProxy> {
  const raw = parseManualProxyRecords(text);

  if (raw.error) {
    return {
      items: [],
      error: raw.error,
    };
  }

  return {
    items: raw.items.map((record, index) => ({
      name: stringifyValue(record.name) || `自定义节点 ${index + 1}`,
      type: stringifyValue(record.type) || "unknown",
      server: stringifyValue(record.server),
      port: stringifyValue(record.port),
      plugin: stringifyValue(record.plugin),
      cipher: stringifyValue(record.cipher),
      dialerProxy: stringifyValue(record["dialer-proxy"]),
    })),
    error: null,
  };
}

export function parseManualProxyRecords(text: string): ParseResult<ParsedProxy> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { items: [], error: null };
  }

  try {
    const parsed = parse(text);
    if (Array.isArray(parsed)) {
      return {
        items: parsed
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item) => item as ParsedProxy),
        error: null,
      };
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }

  return { items: [], error: "manual_proxies 片段需要是 YAML 列表" };
}

export function parseImportableManualProxyRecords(text: string): ParseResult<ParsedProxy> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { items: [], error: null };
  }

  try {
    const parsed = parse(text);
    if (Array.isArray(parsed)) {
      return {
        items: parsed
          .filter((item) => item && typeof item === "object" && !Array.isArray(item))
          .map((item) => item as ParsedProxy),
        error: null,
      };
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const proxies = (parsed as Record<string, unknown>).proxies;
      if (Array.isArray(proxies)) {
        return {
          items: proxies
            .filter((item) => item && typeof item === "object" && !Array.isArray(item))
            .map((item) => item as ParsedProxy),
          error: null,
        };
      }
    }
  } catch (error) {
    return {
      items: [],
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }

  return { items: [], error: "导入内容需要是 YAML 节点列表，或包含 proxies 列表的对象" };
}

export function stringifyManualProxyRecords(items: ParsedProxy[]): string {
  return items.length ? stringify(items).trim() : "";
}

export function buildTextPreview(text: string, maxLines = 6) {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (!lines.length) {
    return "暂无内容";
  }

  const visible = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${visible}\n...` : visible;
}

function buildBuiltinRuleLine(item: ParsedBuiltinRule) {
  const matcher = item.matcher.trim();
  const value = item.value.trim();
  const policy = item.policy.trim();
  const flags = item.noResolve ? ["no-resolve"] : [];

  if (!matcher) {
    return "";
  }

  if (matcher === "MATCH") {
    return [matcher, policy, ...flags].filter(Boolean).join(",");
  }

  return [matcher, value, policy, ...flags].filter((segment, index) => segment || index < 3).join(",");
}
