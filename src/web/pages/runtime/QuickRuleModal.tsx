import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomRule, ProxyGroupDraft, RegionRule, SubscriptionSource } from "@shared/types";
import { Modal } from "../../components/Modal";
import { pushToast } from "../../components/toast";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { buildPolicyTargetGroups, normalizeLegacyPolicyTarget } from "../../lib/rule-targets";
import type { QuickRuleSeed } from "./types";

type QuickRuleFormValues = Pick<CustomRule, "type" | "target" | "policy" | "noResolve" | "note">;

const ruleTypes: CustomRule["type"][] = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "SRC-IP-CIDR",
  "SRC-PORT",
  "DST-PORT",
  "PROCESS-NAME",
  "PROCESS-PATH",
  "GEOIP",
  "MATCH",
  "RAW",
];

export function QuickRuleModal({ seed, onClose }: { seed: QuickRuleSeed | null; onClose: () => void }) {
  const open = seed !== null;
  const queryClient = useQueryClient();
  const form = useForm<QuickRuleFormValues>({
    defaultValues: {
      type: "DOMAIN",
      target: "",
      policy: "FINAL",
      noResolve: false,
      note: "",
    },
  });
  const ruleType = form.watch("type");
  const rules = useQuery({
    queryKey: ["rules"],
    queryFn: () => apiRequest<CustomRule[]>("/api/rules"),
    enabled: open,
  });
  const regions = useQuery({
    queryKey: ["region-rules"],
    queryFn: () => apiRequest<RegionRule[]>("/api/region-rules"),
    enabled: open,
  });
  const proxyGroups = useQuery({
    queryKey: ["proxy-groups"],
    queryFn: () => apiRequest<ProxyGroupDraft[]>("/api/proxy-groups"),
    enabled: open,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SubscriptionSource[]>("/api/sources"),
    enabled: open,
  });

  useEffect(() => {
    if (!seed) {
      return;
    }
    form.reset({
      type: seed.type,
      target: seed.target,
      policy: normalizeLegacyPolicyTarget(seed.policy),
      noResolve: seed.noResolve,
      note: seed.note,
    });
  }, [form, seed]);

  const policyGroups = useMemo(
    () =>
      buildPolicyTargetGroups({
        regions: (regions.data ?? []).filter((item) => item.enabled),
        proxyGroups: (proxyGroups.data ?? []).filter((item) => item.enabled),
        sources: (sources.data ?? []).filter((item) => item.enabled),
        currentValue: normalizeLegacyPolicyTarget(seed?.policy || "FINAL"),
      }),
    [proxyGroups.data, regions.data, seed?.policy, sources.data],
  );

  const createRule = useMutation({
    mutationFn: async (values: QuickRuleFormValues) => {
      if (values.type !== "MATCH" && !values.target.trim()) {
        throw new Error("请填写规则的匹配目标。");
      }
      const existingRules = rules.data ?? await apiRequest<CustomRule[]>("/api/rules");
      const sortOrder = existingRules.reduce((maximum, rule) => Math.max(maximum, rule.sortOrder), 0) + 10;
      return apiRequest<CustomRule>("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          target: values.target.trim(),
          policy: values.policy.trim(),
          note: values.note.trim(),
          enabled: true,
          sortOrder,
        } satisfies CustomRule),
      });
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "规则已创建，可前往规则与策略页面继续调整顺序。" });
      onClose();
      await queryClient.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  return (
    <Modal
      description="已根据当前记录预填匹配条件；确认走向后即可保存为自定义规则。"
      onClose={onClose}
      open={open}
      size="wide"
      title="快速新增规则"
    >
      <form className="stack" onSubmit={form.handleSubmit(async (values) => createRule.mutateAsync(values))}>
        <div className="quick-rule-context">
          <span>来源上下文</span>
          <p>{seed?.context || "当前记录没有可识别的目标，请手动填写规则。"}</p>
        </div>

        <div className="quick-rule-form-grid">
          <div className="field">
            <label>规则类型</label>
            <select {...form.register("type")}>
              {ruleTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>
          <div className="field quick-rule-target-field">
            <label>{ruleType === "RAW" ? "RAW 内容" : ruleType === "MATCH" ? "匹配目标（可留空）" : "匹配目标"}</label>
            <input autoFocus {...form.register("target")} />
          </div>
          <div className="field">
            <label>命中后走向</label>
            <select {...form.register("policy")}>
              {policyGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field quick-rule-note-field">
            <label>备注</label>
            <input {...form.register("note")} />
          </div>
        </div>

        <label className="quick-rule-resolve-toggle">
          <input type="checkbox" {...form.register("noResolve")} />
          <span>
            <strong>no-resolve</strong>
            <small>IP 类规则可避免额外 DNS 解析。</small>
          </span>
        </label>

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose} type="button">
            取消
          </button>
          <button className="button" disabled={createRule.isPending} type="submit">
            {createRule.isPending ? "保存中..." : "保存规则"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
