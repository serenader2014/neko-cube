import type { CustomRule, RuleProviderDraft } from "@shared/types";

export type RuleFormValues = Omit<CustomRule, "enabled" | "id">;
export type ProviderFormValues = Omit<RuleProviderDraft, "enabled" | "id">;

export type BulkImportedProvider = ProviderFormValues & {
  sourceSummary: string;
};
