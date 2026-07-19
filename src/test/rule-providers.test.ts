import { describe, expect, it } from "vitest";
import type { RuleProviderDraft } from "@shared/types";
import { applyBulkProviderEdits, previewBulkProviderEdits, type BulkProviderEditValues } from "../web/lib/rule-providers";

const baseProvider: RuleProviderDraft = {
  id: 1,
  name: "OpenAI",
  mode: "structured",
  behavior: "domain",
  format: "yaml",
  url: "https://rules.example.com/openai.yaml",
  interval: 3600,
  path: "./ruleset/openai.yaml",
  rawYaml: "",
  policy: "FINAL",
  enabled: true,
  sortOrder: 10,
};

const noOpValues: BulkProviderEditValues = {
  urlMode: "keep",
  urlValue: "",
  urlFind: "",
  urlReplace: "",
  policy: "",
  interval: null,
};

describe("rule provider bulk edits", () => {
  it("replaces the full url and optional fields", () => {
    const next = applyBulkProviderEdits(baseProvider, {
      ...noOpValues,
      urlMode: "replace-all",
      urlValue: "https://mirror.example.com/openai.yaml",
      policy: "[地区] 美国",
      interval: 7200,
    });

    expect(next.url).toBe("https://mirror.example.com/openai.yaml");
    expect(next.policy).toBe("[地区] 美国");
    expect(next.interval).toBe(7200);
  });

  it("supports find and replace for urls", () => {
    const next = applyBulkProviderEdits(baseProvider, {
      ...noOpValues,
      urlMode: "find-replace",
      urlFind: "rules.example.com",
      urlReplace: "cdn.example.com",
    });

    expect(next.url).toBe("https://cdn.example.com/openai.yaml");
  });

  it("returns only changed providers in preview", () => {
    const preview = previewBulkProviderEdits(
      [
        baseProvider,
        {
          ...baseProvider,
          id: 2,
          name: "Claude",
          url: "https://mirror.example.com/claude.yaml",
        },
      ],
      {
        ...noOpValues,
        urlMode: "find-replace",
        urlFind: "rules.example.com",
        urlReplace: "mirror.example.com",
      },
    );

    expect(preview).toHaveLength(1);
    expect(preview[0]?.current.name).toBe("OpenAI");
    expect(preview[0]?.changes[0]?.field).toBe("url");
  });
});
