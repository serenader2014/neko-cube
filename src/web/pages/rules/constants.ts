import type { BulkProviderEditValues } from "../../lib/rule-providers";
import type { ProviderFormValues, RuleFormValues } from "./types";

export const emptyRule: RuleFormValues = {
  type: "DOMAIN-SUFFIX",
  target: "",
  policy: "FINAL",
  noResolve: false,
  note: "",
  sortOrder: 100,
};

export const emptyProvider: ProviderFormValues = {
  name: "",
  behavior: "classical",
  format: "yaml",
  url: "",
  interval: 3600,
  path: "",
  policy: "FINAL",
  sortOrder: 100,
  mode: "structured",
  rawYaml: "",
};

export const builtinPolicyTargets = ["FINAL", "MANUAL", "DIRECT", "REJECT"] as const;

export const emptyBulkProviderEditValues: BulkProviderEditValues = {
  urlMode: "keep",
  urlValue: "",
  urlFind: "",
  urlReplace: "",
  policy: "",
  interval: null,
};
