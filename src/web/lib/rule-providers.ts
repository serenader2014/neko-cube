import type { RuleProviderDraft } from "@shared/types";

export type BulkProviderUrlMode = "keep" | "replace-all" | "find-replace";

export type BulkProviderEditValues = {
  urlMode: BulkProviderUrlMode;
  urlValue: string;
  urlFind: string;
  urlReplace: string;
  policy: string;
  interval: number | null;
};

export type BulkProviderEditPreviewItem = {
  current: RuleProviderDraft;
  next: RuleProviderDraft;
  changes: Array<{ field: "url" | "policy" | "interval"; before: string; after: string }>;
};

export function previewBulkProviderEdits(
  providers: RuleProviderDraft[],
  values: BulkProviderEditValues,
): BulkProviderEditPreviewItem[] {
  return providers
    .map((provider) => {
      const next = applyBulkProviderEdits(provider, values);
      const changes = collectProviderChanges(provider, next);
      return changes.length > 0 ? { current: provider, next, changes } : null;
    })
    .filter((item): item is BulkProviderEditPreviewItem => Boolean(item));
}

export function applyBulkProviderEdits(provider: RuleProviderDraft, values: BulkProviderEditValues): RuleProviderDraft {
  let next = provider;

  if (values.urlMode === "replace-all") {
    const url = values.urlValue.trim();
    if (!url) {
      throw new Error("批量覆盖 URL 时需要填写新 URL。");
    }
    if (url !== next.url) {
      next = {
        ...next,
        url,
      };
    }
  } else if (values.urlMode === "find-replace") {
    const find = values.urlFind;
    if (!find) {
      throw new Error("批量替换 URL 时需要填写要查找的内容。");
    }
    const replacedUrl = next.url.replaceAll(find, values.urlReplace);
    if (replacedUrl !== next.url) {
      if (!replacedUrl.trim()) {
        throw new Error(`Provider「${provider.name}」替换后的 URL 为空。`);
      }
      next = {
        ...next,
        url: replacedUrl.trim(),
      };
    }
  }

  const policy = values.policy.trim();
  if (policy && policy !== next.policy) {
    next = {
      ...next,
      policy,
    };
  }

  if (values.interval !== null) {
    if (!Number.isInteger(values.interval) || values.interval <= 0) {
      throw new Error("刷新间隔需要是大于 0 的整数秒。");
    }
  }

  if (values.interval !== null && values.interval !== next.interval) {
    next = {
      ...next,
      interval: values.interval,
    };
  }

  return next;
}

function collectProviderChanges(current: RuleProviderDraft, next: RuleProviderDraft) {
  const changes: Array<{ field: "url" | "policy" | "interval"; before: string; after: string }> = [];

  if (current.url !== next.url) {
    changes.push({
      field: "url",
      before: current.url,
      after: next.url,
    });
  }

  if (current.policy !== next.policy) {
    changes.push({
      field: "policy",
      before: current.policy,
      after: next.policy,
    });
  }

  if (current.interval !== next.interval) {
    changes.push({
      field: "interval",
      before: String(current.interval),
      after: String(next.interval),
    });
  }

  return changes;
}
