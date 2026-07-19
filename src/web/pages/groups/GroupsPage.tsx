import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sortByOrder, type AppSettings, type ConfigFragment, type ProxyGroupDraft, type ProxyGroupMember, type RegionRule } from "@shared/types";
import { apiRequest, getErrorMessage } from "../../lib/api";
import { StatusSwitch } from "../../components/StatusSwitch";
import { pushToast } from "../../components/toast";
import { parseImportableManualProxyRecords, parseManualProxyRecords, stringifyManualProxyRecords } from "../../lib/config-fragments";
import { buildGroupPreview, buildProxyCatalog, type SourceWithSnapshot } from "../../lib/proxy-catalog";
import { withSequentialSortOrder } from "../../lib/sortable";
import {
  ManualProxiesPreview,
  ProxyChipList,
  ProxyGroupCard,
  RegionRuleCard,
} from "./components";
import { GroupsModals } from "./GroupsModals";
import {
  dialerProxyBuiltinOptions,
  emptyGroup,
  memberCategoryLabels,
  memberKindLabels,
  specialOptions,
} from "./constants";
import {
  buildDefaultFinalMembers,
  createEmptyManualProxyFragment,
  dedupeMembers,
  filterMemberOptions,
  findManualProxyReferences,
  formatRegionGroupName,
  formatSourceGroupName,
  getManualProxyFinalName,
  getMemberDirectoryEmptyState,
  getMemberKey,
  parseKeywordText,
  previewRegionProxies,
  removeProxyMember,
} from "./helpers";
import type { MemberOption, ProxyGroupFormValues, RegionFormValues } from "./types";

export function GroupsPage() {
  const queryClient = useQueryClient();
  const [editingRegion, setEditingRegion] = useState<RegionRule | null>(null);
  const [editingGroup, setEditingGroup] = useState<ProxyGroupDraft | null>(null);
  const [isFinalGroupModalOpen, setIsFinalGroupModalOpen] = useState(false);
  const [isRegionModalOpen, setIsRegionModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isRegionPreviewVisible, setIsRegionPreviewVisible] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<ProxyGroupMember[]>([]);
  const [memberCategory, setMemberCategory] = useState<MemberOption["category"] | "all">("all");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberSourceFilter, setMemberSourceFilter] = useState("all");
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [bulkTargetGroupIds, setBulkTargetGroupIds] = useState<number[]>([]);
  const [bulkSelectedMembers, setBulkSelectedMembers] = useState<ProxyGroupMember[]>([]);
  const [bulkMemberCategory, setBulkMemberCategory] = useState<MemberOption["category"] | "all">("all");
  const [bulkMemberSearch, setBulkMemberSearch] = useState("");
  const [bulkMemberSourceFilter, setBulkMemberSourceFilter] = useState("all");
  const [togglingRegionId, setTogglingRegionId] = useState<number | null>(null);
  const [togglingGroupId, setTogglingGroupId] = useState<number | null>(null);
  const [togglingFragmentKey, setTogglingFragmentKey] = useState<string | null>(null);
  const [isGroupSortModalOpen, setIsGroupSortModalOpen] = useState(false);
  const [isCustomProxySortModalOpen, setIsCustomProxySortModalOpen] = useState(false);
  const [isSelectedMemberSortModalOpen, setIsSelectedMemberSortModalOpen] = useState(false);
  const [isCustomProxyModalOpen, setIsCustomProxyModalOpen] = useState(false);
  const [isCustomProxyImportModalOpen, setIsCustomProxyImportModalOpen] = useState(false);
  const [customProxySelectionRequest, setCustomProxySelectionRequest] = useState<{
    mode: "new" | "edit";
    index?: number;
    token: number;
  } | null>(null);
  const [customProxyDraftFragment, setCustomProxyDraftFragment] = useState<ConfigFragment | null>(null);
  const customProxyDraftSubmitRef = useRef<null | (() => string)>(null);
  const [customProxyImportYaml, setCustomProxyImportYaml] = useState("");
  const [customProxyImportResult, setCustomProxyImportResult] = useState<{
    items: ReturnType<typeof parseImportableManualProxyRecords>["items"];
    error: string | null;
  }>({ items: [], error: null });
  const regionForm = useForm<RegionFormValues>({
    defaultValues: { name: "", keywordsText: "", sortOrder: 100 },
  });
  const groupForm = useForm<ProxyGroupFormValues>({
    defaultValues: emptyGroup,
  });
  const regionKeywordsText = regionForm.watch("keywordsText");
  const regionName = regionForm.watch("name");

  const appSettings = useQuery({
    queryKey: ["app-settings"],
    queryFn: () => apiRequest<AppSettings>("/api/app-settings"),
  });
  const regionRules = useQuery({
    queryKey: ["region-rules"],
    queryFn: () => apiRequest<RegionRule[]>("/api/region-rules"),
  });
  const proxyGroups = useQuery({
    queryKey: ["proxy-groups"],
    queryFn: () => apiRequest<ProxyGroupDraft[]>("/api/proxy-groups"),
  });
  const fragments = useQuery({
    queryKey: ["config-fragments"],
    queryFn: () => apiRequest<ConfigFragment[]>("/api/config-fragments"),
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiRequest<SourceWithSnapshot[]>("/api/sources"),
  });
  const regionItems = useMemo(() => sortByOrder(Array.isArray(regionRules.data) ? regionRules.data : []), [regionRules.data]);
  const proxyGroupItems = useMemo(() => sortByOrder(Array.isArray(proxyGroups.data) ? proxyGroups.data : []), [proxyGroups.data]);
  const sourceItems = useMemo(() => (Array.isArray(sources.data) ? sources.data : []), [sources.data]);
  const nextProxyGroupSortOrder = useMemo(
    () => proxyGroupItems.reduce((maxSortOrder, group) => Math.max(maxSortOrder, group.sortOrder ?? 0), 0) + 10,
    [proxyGroupItems],
  );

  const customProxyFragment = useMemo(
    () => fragments.data?.find((fragment) => fragment.key === "manual_proxies") ?? createEmptyManualProxyFragment(),
    [fragments.data],
  );
  const customProxyRecords = useMemo(() => parseManualProxyRecords(customProxyFragment.yamlText), [customProxyFragment.yamlText]);
  const manualProxyFragment = customProxyFragment.yamlText;

  function openCustomProxyCreator() {
    setCustomProxyDraftFragment(customProxyFragment);
    setCustomProxySelectionRequest({ mode: "new", token: Date.now() });
    setIsCustomProxyModalOpen(true);
  }

  function openCustomProxyEditor(index: number) {
    setCustomProxyDraftFragment(customProxyFragment);
    setCustomProxySelectionRequest({ mode: "edit", index, token: Date.now() });
    setIsCustomProxyModalOpen(true);
  }

  function closeCustomProxyModal() {
    setIsCustomProxyModalOpen(false);
    setCustomProxySelectionRequest(null);
    setCustomProxyDraftFragment(null);
  }

  function openCustomProxyImportModal() {
    setCustomProxyImportYaml("");
    setCustomProxyImportResult({ items: [], error: null });
    setIsCustomProxyImportModalOpen(true);
  }

  function closeCustomProxyImportModal() {
    setIsCustomProxyImportModalOpen(false);
    setCustomProxyImportYaml("");
    setCustomProxyImportResult({ items: [], error: null });
  }

  const proxyCatalog = useMemo(
    () => buildProxyCatalog(sourceItems, manualProxyFragment, regionItems),
    [manualProxyFragment, regionItems, sourceItems],
  );
  const finalGroupMembers = useMemo(() => {
    const configuredMembers = appSettings.data?.finalGroupMembers;
    return dedupeMembers(configuredMembers && configuredMembers.length ? configuredMembers : buildDefaultFinalMembers(regionItems, sourceItems)).filter(
      (member) => !(member.kind === "special" && (member.value === "FINAL" || member.value === "GLOBAL" || member.value === "AUTO")),
    );
  }, [appSettings.data?.finalGroupMembers, regionItems, sourceItems]);
  const dialerProxyOptions = useMemo(() => {
    const options = new Set<string>(dialerProxyBuiltinOptions);

    for (const region of regionItems.filter((item) => item.enabled)) {
      options.add(formatRegionGroupName(region.name));
    }

    for (const source of sourceItems.filter((item) => item.enabled)) {
      options.add(formatSourceGroupName(source.name));
    }

    for (const group of proxyGroupItems.filter((item) => item.enabled)) {
      options.add(group.name);
    }

    return Array.from(options);
  }, [proxyGroupItems, regionItems, sourceItems]);

  const regionPreviewMap = useMemo(
    () => new Map(regionItems.map((region) => [region.name, proxyCatalog.byRegion.get(region.name) ?? []])),
    [proxyCatalog.byRegion, regionItems],
  );

  const groupPreviewMap = useMemo(
    () =>
      new Map(
        proxyGroupItems.map((group) => [
          group.name,
          buildGroupPreview(group.members, proxyCatalog, proxyGroupItems, group.name, finalGroupMembers),
        ]),
      ),
    [finalGroupMembers, proxyCatalog, proxyGroupItems],
  );
  const finalGroupPreview = useMemo(
    () => buildGroupPreview(finalGroupMembers, proxyCatalog, proxyGroupItems, "FINAL", finalGroupMembers),
    [finalGroupMembers, proxyCatalog, proxyGroupItems],
  );

  const memberOptions = useMemo(() => {
    const options: MemberOption[] = [];

    for (const proxy of proxyCatalog.proxies) {
      options.push({
        key: `proxy:${proxy.finalName}`,
        member: { kind: "proxy", value: proxy.finalName },
        label: proxy.finalName,
        description:
          proxy.sourceType === "manual"
            ? `${proxy.type} · 自定义节点 · ${proxy.regionName}`
            : `${proxy.type} · 订阅 ${proxy.sourceName} · ${proxy.regionName}`,
        category: proxy.sourceType,
        sourceName: proxy.sourceName,
      });
    }

    for (const sourceName of Array.from(proxyCatalog.bySource.keys()).filter((name) => name !== "自定义节点")) {
      options.push({
        key: `sourceGroup:${sourceName}`,
        member: { kind: "sourceGroup", value: sourceName },
        label: `订阅分组 · ${sourceName}`,
        description: `${proxyCatalog.bySource.get(sourceName)?.length ?? 0} 个节点`,
        category: "sourceGroup",
        sourceName,
      });
    }

    for (const regionName of Array.from(proxyCatalog.byRegion.keys()).filter((name) => name !== "Other")) {
      options.push({
        key: `regionGroup:${regionName}`,
        member: { kind: "regionGroup", value: regionName },
        label: `地域分组 · ${regionName}`,
        description: `${proxyCatalog.byRegion.get(regionName)?.length ?? 0} 个节点`,
        category: "regionGroup",
      });
    }

    for (const group of proxyGroupItems) {
      if (group.name === editingGroup?.name) {
        continue;
      }

      const preview = groupPreviewMap.get(group.name);
      options.push({
        key: `group:${group.name}`,
        member: { kind: "group", value: group.name },
        label: `自定义分组 · ${group.name}`,
        description: `${preview?.proxies.length ?? 0} 个节点`,
        category: "group",
      });
    }

    for (const special of specialOptions) {
      options.push({
        key: `special:${special}`,
        member: { kind: "special", value: special },
        label: special,
        description: special === "MANUAL" ? "引用全部自定义节点" : "内置最终入口或保留策略",
        category: "special",
      });
    }

    return options;
  }, [editingGroup?.name, groupPreviewMap, proxyCatalog.byRegion, proxyCatalog.bySource, proxyCatalog.proxies, proxyGroupItems]);

  const selectedMemberKeySet = useMemo(
    () => new Set(selectedMembers.map((member) => getMemberKey(member))),
    [selectedMembers],
  );
  const bulkSelectedMemberKeySet = useMemo(
    () => new Set(bulkSelectedMembers.map((member) => getMemberKey(member))),
    [bulkSelectedMembers],
  );
  const selectedBulkGroups = useMemo(
    () => proxyGroupItems.filter((group) => group.id && bulkTargetGroupIds.includes(group.id)),
    [bulkTargetGroupIds, proxyGroupItems],
  );
  const bulkTargetGroupNameSet = useMemo(() => new Set(selectedBulkGroups.map((group) => group.name)), [selectedBulkGroups]);
  const bulkMemberOptions = useMemo(
    () =>
      memberOptions.filter(
        (option) => option.member.kind !== "group" || !bulkTargetGroupNameSet.has(option.member.value),
      ),
    [bulkTargetGroupNameSet, memberOptions],
  );

  const availableSourceFilters = useMemo(() => {
    const sourceNames = Array.from(
      new Set(
        memberOptions
          .filter((option) => option.category === "subscription" || option.category === "sourceGroup" || option.category === "manual")
          .map((option) => option.sourceName)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    return ["all", ...sourceNames];
  }, [memberOptions]);
  const finalMemberOptions = useMemo(
    () => memberOptions.filter((option) => !(option.member.kind === "special" && (option.member.value === "FINAL" || option.member.value === "GLOBAL" || option.member.value === "AUTO"))),
    [memberOptions],
  );
  const availableFinalSourceFilters = useMemo(() => {
    const sourceNames = Array.from(
      new Set(
        finalMemberOptions
          .filter((option) => option.category === "subscription" || option.category === "sourceGroup" || option.category === "manual")
          .map((option) => option.sourceName)
          .filter((value): value is string => Boolean(value)),
      ),
    );

    return ["all", ...sourceNames];
  }, [finalMemberOptions]);

  const sourceFilterEnabled =
    memberCategory === "all" ||
    memberCategory === "subscription" ||
    memberCategory === "manual" ||
    memberCategory === "sourceGroup";

  const effectiveSourceFilter = sourceFilterEnabled ? memberSourceFilter : "all";
  const sourceFilterOptions = isFinalGroupModalOpen ? availableFinalSourceFilters : availableSourceFilters;

  const visibleMemberOptions = useMemo(() => {
    const options = isFinalGroupModalOpen ? finalMemberOptions : memberOptions;
    return filterMemberOptions(options, memberCategory, effectiveSourceFilter, memberSearch);
  }, [effectiveSourceFilter, finalMemberOptions, isFinalGroupModalOpen, memberCategory, memberOptions, memberSearch]);

  const bulkSourceFilterEnabled =
    bulkMemberCategory === "all" ||
    bulkMemberCategory === "subscription" ||
    bulkMemberCategory === "manual" ||
    bulkMemberCategory === "sourceGroup";

  const effectiveBulkSourceFilter = bulkSourceFilterEnabled ? bulkMemberSourceFilter : "all";

  const bulkVisibleMemberOptions = useMemo(
    () => filterMemberOptions(bulkMemberOptions, bulkMemberCategory, effectiveBulkSourceFilter, bulkMemberSearch),
    [bulkMemberCategory, bulkMemberOptions, bulkMemberSearch, effectiveBulkSourceFilter],
  );

  const reusableGroupCount = useMemo(
    () => proxyGroupItems.filter((group) => group.name !== editingGroup?.name).length,
    [editingGroup?.name, proxyGroupItems],
  );

  const memberDirectoryMode = !visibleMemberOptions.length ? "is-empty" : visibleMemberOptions.length <= 4 ? "is-sparse" : "";
  const memberDirectoryEmptyState = useMemo(
    () =>
      getMemberDirectoryEmptyState({
        memberCategory,
        memberSearch,
        sourceFilterEnabled,
        memberSourceFilter,
        reusableGroupCount,
      }),
    [memberCategory, memberSearch, memberSourceFilter, reusableGroupCount, sourceFilterEnabled],
  );
  const bulkDirectoryMode =
    !bulkVisibleMemberOptions.length ? "is-empty" : bulkVisibleMemberOptions.length <= 4 ? "is-sparse" : "";
  const bulkDirectoryEmptyState = useMemo(
    () =>
      getMemberDirectoryEmptyState({
        memberCategory: bulkMemberCategory,
        memberSearch: bulkMemberSearch,
        sourceFilterEnabled: bulkSourceFilterEnabled,
        memberSourceFilter: bulkMemberSourceFilter,
        reusableGroupCount: proxyGroupItems.length,
      }),
    [bulkMemberCategory, bulkMemberSearch, bulkMemberSourceFilter, bulkSourceFilterEnabled, proxyGroupItems.length],
  );

  const selectedPreview = useMemo(
    () => buildGroupPreview(selectedMembers, proxyCatalog, proxyGroupItems, editingGroup?.name ?? (isFinalGroupModalOpen ? "FINAL" : undefined), finalGroupMembers),
    [editingGroup?.name, finalGroupMembers, isFinalGroupModalOpen, proxyCatalog, proxyGroupItems, selectedMembers],
  );
  const missingSelectedProxyMembers = useMemo(
    () => selectedMembers.filter((member) => member.kind === "proxy" && !proxyCatalog.byName.has(member.value)),
    [proxyCatalog.byName, selectedMembers],
  );
  const bulkSelectedPreview = useMemo(
    () => buildGroupPreview(bulkSelectedMembers, proxyCatalog, proxyGroupItems, undefined, finalGroupMembers),
    [bulkSelectedMembers, finalGroupMembers, proxyCatalog, proxyGroupItems],
  );
  const visibleSelectedCount = useMemo(
    () => visibleMemberOptions.filter((option) => selectedMemberKeySet.has(getMemberKey(option.member))).length,
    [selectedMemberKeySet, visibleMemberOptions],
  );
  const allVisibleSelected = visibleMemberOptions.length > 0 && visibleSelectedCount === visibleMemberOptions.length;
  const visibleBulkSelectedCount = useMemo(
    () => bulkVisibleMemberOptions.filter((option) => bulkSelectedMemberKeySet.has(getMemberKey(option.member))).length,
    [bulkSelectedMemberKeySet, bulkVisibleMemberOptions],
  );
  const allVisibleBulkMembersSelected =
    bulkVisibleMemberOptions.length > 0 && visibleBulkSelectedCount === bulkVisibleMemberOptions.length;
  const activeMemberCategoryLabel = memberCategoryLabels[memberCategory];
  const activeBulkMemberCategoryLabel = memberCategoryLabels[bulkMemberCategory];

  const regionDraftKeywords = useMemo(() => parseKeywordText(regionKeywordsText), [regionKeywordsText]);
  const regionDraftPreview = useMemo(
    () => previewRegionProxies(proxyCatalog.proxies, regionDraftKeywords),
    [proxyCatalog.proxies, regionDraftKeywords],
  );

  useEffect(() => {
    if (isRegionModalOpen) {
      setIsRegionPreviewVisible(false);
      regionForm.reset({
        name: editingRegion?.name ?? "",
        keywordsText: editingRegion?.keywords.join(", ") ?? "",
        sortOrder: editingRegion?.sortOrder ?? 100,
      });
    }
  }, [editingRegion, isRegionModalOpen, regionForm]);

  useEffect(() => {
    if (isGroupModalOpen) {
      groupForm.reset(editingGroup ?? { ...emptyGroup, sortOrder: nextProxyGroupSortOrder });
      setSelectedMembers(dedupeMembers(editingGroup?.members ?? []));
      setMemberCategory("all");
      setMemberSearch("");
      setMemberSourceFilter("all");
    }
  }, [editingGroup, groupForm, isGroupModalOpen, nextProxyGroupSortOrder]);

  useEffect(() => {
    if (isFinalGroupModalOpen) {
      setSelectedMembers(finalGroupMembers);
      setMemberCategory("all");
      setMemberSearch("");
      setMemberSourceFilter("all");
    }
  }, [finalGroupMembers, isFinalGroupModalOpen]);

  useEffect(() => {
    if (!bulkTargetGroupNameSet.size) {
      return;
    }

    setBulkSelectedMembers((current) =>
      current.filter((member) => member.kind !== "group" || !bulkTargetGroupNameSet.has(member.value)),
    );
  }, [bulkTargetGroupNameSet]);

  function closeRegionModal() {
    setIsRegionModalOpen(false);
    setIsRegionPreviewVisible(false);
    setEditingRegion(null);
    regionForm.reset({ name: "", keywordsText: "", sortOrder: 100 });
  }

  function closeGroupModal() {
    setIsGroupModalOpen(false);
    setEditingGroup(null);
    setSelectedMembers([]);
    setMemberCategory("all");
    setMemberSearch("");
    setMemberSourceFilter("all");
    setIsSelectedMemberSortModalOpen(false);
    groupForm.reset({ ...emptyGroup, sortOrder: nextProxyGroupSortOrder });
  }

  function openFinalGroupModal() {
    setSelectedMembers(finalGroupMembers);
    setMemberCategory("all");
    setMemberSearch("");
    setMemberSourceFilter("all");
    setIsSelectedMemberSortModalOpen(false);
    setIsFinalGroupModalOpen(true);
  }

  function closeFinalGroupModal() {
    setIsFinalGroupModalOpen(false);
    setSelectedMembers([]);
    setMemberCategory("all");
    setMemberSearch("");
    setMemberSourceFilter("all");
    setIsSelectedMemberSortModalOpen(false);
  }

  function openBulkAssignModal() {
    setBulkTargetGroupIds([]);
    setBulkSelectedMembers([]);
    setBulkMemberCategory("all");
    setBulkMemberSearch("");
    setBulkMemberSourceFilter("all");
    setIsBulkAssignModalOpen(true);
  }

  function closeBulkAssignModal() {
    setIsBulkAssignModalOpen(false);
    setBulkTargetGroupIds([]);
    setBulkSelectedMembers([]);
    setBulkMemberCategory("all");
    setBulkMemberSearch("");
    setBulkMemberSourceFilter("all");
  }

  function toggleMember(member: ProxyGroupMember) {
    const key = getMemberKey(member);
    setSelectedMembers((current) =>
      current.some((item) => getMemberKey(item) === key)
        ? current.filter((item) => getMemberKey(item) !== key)
        : [...current, member],
    );
  }

  function removeSelectedMember(member: ProxyGroupMember) {
    const key = getMemberKey(member);
    setSelectedMembers((current) => current.filter((item) => getMemberKey(item) !== key));
  }

  function clearSelectedMembers() {
    setSelectedMembers([]);
  }

  function clearMissingSelectedProxyMembers() {
    const missingKeys = new Set(missingSelectedProxyMembers.map((member) => getMemberKey(member)));
    setSelectedMembers((current) => current.filter((member) => !missingKeys.has(getMemberKey(member))));
    pushToast({ tone: "success", message: `已清除 ${missingKeys.size} 个不存在的节点。` });
  }

  function toggleAllVisibleMembers() {
    if (!visibleMemberOptions.length) {
      return;
    }

    const visibleKeys = new Set(visibleMemberOptions.map((option) => getMemberKey(option.member)));
    

    setSelectedMembers((current) => {
      if (allVisibleSelected) {
        return current.filter((member) => !visibleKeys.has(getMemberKey(member)));
      }

      const next = [...current];
      const existingKeys = new Set(current.map((member) => getMemberKey(member)));

      for (const option of visibleMemberOptions) {
        const key = getMemberKey(option.member);
        if (!existingKeys.has(key)) {
          next.push(option.member);
        }
      }

      return next;
    });
  }

  function toggleBulkTargetGroup(groupId: number) {
    setBulkTargetGroupIds((current) => (current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]));
  }

  function toggleBulkMember(member: ProxyGroupMember) {
    const key = getMemberKey(member);
    setBulkSelectedMembers((current) =>
      current.some((item) => getMemberKey(item) === key)
        ? current.filter((item) => getMemberKey(item) !== key)
        : [...current, member],
    );
  }

  function removeBulkSelectedMember(member: ProxyGroupMember) {
    const key = getMemberKey(member);
    setBulkSelectedMembers((current) => current.filter((item) => getMemberKey(item) !== key));
  }

  function toggleAllVisibleBulkMembers() {
    if (!bulkVisibleMemberOptions.length) {
      return;
    }

    const visibleKeys = new Set(bulkVisibleMemberOptions.map((option) => getMemberKey(option.member)));

    setBulkSelectedMembers((current) => {
      if (allVisibleBulkMembersSelected) {
        return current.filter((member) => !visibleKeys.has(getMemberKey(member)));
      }

      const next = [...current];
      const existingKeys = new Set(current.map((member) => getMemberKey(member)));

      for (const option of bulkVisibleMemberOptions) {
        const key = getMemberKey(option.member);
        if (!existingKeys.has(key)) {
          next.push(option.member);
        }
      }

      return next;
    });
  }

  const saveRegion = useMutation({
    mutationFn: (payload: RegionRule) =>
      apiRequest(editingRegion?.id ? `/api/region-rules/${editingRegion.id}` : "/api/region-rules", {
        method: editingRegion?.id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: editingRegion?.id ? "地域规则已更新。" : "地域规则已创建。" });
      closeRegionModal();
      await queryClient.invalidateQueries({ queryKey: ["region-rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const deleteRegion = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/region-rules/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "地域规则已删除。" });
      closeRegionModal();
      await queryClient.invalidateQueries({ queryKey: ["region-rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const saveGroup = useMutation({
    mutationFn: (payload: ProxyGroupDraft) =>
      apiRequest(editingGroup?.id ? `/api/proxy-groups/${editingGroup.id}` : "/api/proxy-groups", {
        method: editingGroup?.id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: editingGroup?.id ? "自定义分组已更新。" : "自定义分组已创建。" });
      closeGroupModal();
      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const saveFinalGroup = useMutation({
    mutationFn: async (members: ProxyGroupMember[]) => {
      const currentSettings = appSettings.data;
      if (!currentSettings) {
        throw new Error("应用设置尚未加载完成");
      }

      return apiRequest("/api/app-settings", {
        method: "PUT",
        body: JSON.stringify({
          ...currentSettings,
          finalGroupMembers: dedupeMembers(members).filter(
            (member) => !(member.kind === "special" && (member.value === "FINAL" || member.value === "GLOBAL" || member.value === "AUTO")),
          ),
        } satisfies AppSettings),
      });
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "FINAL 分组已更新。" });
      closeFinalGroupModal();
      await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const upsertFragment = useMutation({
    mutationFn: (payload: ConfigFragment) =>
      apiRequest(`/api/config-fragments/${payload.key}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "自定义节点已保存。" });
      await queryClient.invalidateQueries({ queryKey: ["config-fragments"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleRegion = useMutation({
    mutationFn: async (region: RegionRule) => {
      if (!region.id) {
        return;
      }

      setTogglingRegionId(region.id);
      return apiRequest(`/api/region-rules/${region.id}`, {
        method: "PUT",
        body: JSON.stringify(region satisfies RegionRule),
      });
    },
    onSuccess: async (_data, region) => {
      pushToast({ tone: "success", message: `地域规则 ${region.name} 已${region.enabled ? "启用" : "停用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["region-rules"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingRegionId(null);
    },
  });

  const toggleGroup = useMutation({
    mutationFn: async (group: ProxyGroupDraft) => {
      if (!group.id) {
        return;
      }

      setTogglingGroupId(group.id);
      return apiRequest(`/api/proxy-groups/${group.id}`, {
        method: "PUT",
        body: JSON.stringify(group satisfies ProxyGroupDraft),
      });
    },
    onSuccess: async (_data, group) => {
      pushToast({ tone: "success", message: `自定义分组 ${group.name} 已${group.enabled ? "启用" : "停用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingGroupId(null);
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async (groupId: number) =>
      apiRequest(`/api/proxy-groups/${groupId}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      pushToast({ tone: "success", message: "自定义分组已删除。" });
      closeGroupModal();
      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const reorderGroup = useMutation({
    mutationFn: async (orderedGroups: ProxyGroupDraft[]) => {
      for (const group of withSequentialSortOrder(orderedGroups)) {
        if (!group.id) {
          continue;
        }

        await apiRequest(`/api/proxy-groups/${group.id}`, {
          method: "PUT",
          body: JSON.stringify(group satisfies ProxyGroupDraft),
        });
      }
    },
    onSuccess: async () => {
      pushToast({ tone: "success", message: "分组顺序已更新。" });
      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const bulkAssignGroupMembers = useMutation({
    mutationFn: async (payload: { groupIds: number[]; members: ProxyGroupMember[] }) => {
      for (const groupId of payload.groupIds) {
        const group = proxyGroupItems.find((item) => item.id === groupId);
        if (!group?.id) {
          continue;
        }

        await apiRequest(`/api/proxy-groups/${group.id}`, {
          method: "PUT",
          body: JSON.stringify({
            ...group,
            members: payload.members,
          } satisfies ProxyGroupDraft),
        });
      }
    },
    onSuccess: async (_data, payload) => {
      pushToast({
        tone: "success",
        message: `已把同一组节点分配给 ${payload.groupIds.length} 个自定义分组。`,
      });
      closeBulkAssignModal();
      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
  });

  const toggleFragment = useMutation({
    mutationFn: async (fragment: ConfigFragment) => {
      setTogglingFragmentKey(fragment.key);
      return apiRequest(`/api/config-fragments/${fragment.key}`, {
        method: "PUT",
        body: JSON.stringify(fragment satisfies ConfigFragment),
      });
    },
    onSuccess: async (_data, fragment) => {
      pushToast({ tone: "success", message: `自定义节点已${fragment.enabled ? "启用" : "停用"}。` });
      await queryClient.invalidateQueries({ queryKey: ["config-fragments"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    },
    onError: (error) => {
      pushToast({ tone: "error", message: getErrorMessage(error) });
    },
    onSettled: () => {
      setTogglingFragmentKey(null);
    },
  });

  function parseCustomProxyImport() {
    const result = parseImportableManualProxyRecords(customProxyImportYaml);
    setCustomProxyImportResult(result);
  }

  async function saveCustomProxyDraft() {
    if (!customProxyDraftFragment) {
      return;
    }

    const committedYamlText = customProxyDraftSubmitRef.current?.();
    const nextFragment = committedYamlText !== undefined
      ? {
          ...customProxyDraftFragment,
          yamlText: committedYamlText,
        }
      : customProxyDraftFragment;

    setCustomProxyDraftFragment(nextFragment);

    await upsertFragment.mutateAsync({
      ...nextFragment,
      enabled: nextFragment.enabled || Boolean(nextFragment.yamlText.trim()),
    });
    closeCustomProxyModal();
  }

  async function deleteCustomProxyAt(index: number) {
    const record = customProxyRecords.items[index];
    const label = String(record?.name ?? "").trim() || `自定义节点 ${index + 1}`;
    const finalName = getManualProxyFinalName(customProxyRecords.items, index, proxyCatalog.manualNames);
    const configuredFinalMembers = appSettings.data?.finalGroupMembers ?? [];
    const references = findManualProxyReferences(finalName, proxyGroupItems, configuredFinalMembers);
    const usageLabels = [
      ...references.groups.map((group) => `「${group.name}」`),
      ...(references.usedByFinal ? ["「FINAL」"] : []),
    ];

    const confirmed = window.confirm(
      usageLabels.length
        ? `自定义节点「${label}」正在被分组 ${usageLabels.join("、")} 使用，删除后会同时移除这些分组里的引用。确定继续吗？`
        : `确定要删除自定义节点「${label}」吗？`,
    );
    if (!confirmed) {
      return;
    }

    const nextItems = customProxyRecords.items.filter((_, itemIndex) => itemIndex !== index);

    await upsertFragment.mutateAsync({
      ...customProxyFragment,
      enabled: nextItems.length > 0 ? customProxyFragment.enabled : false,
      yamlText: stringifyManualProxyRecords(nextItems),
    });

    if (finalName && usageLabels.length) {
      try {
        for (const group of references.groups) {
          if (!group.id) {
            continue;
          }

          await apiRequest(`/api/proxy-groups/${group.id}`, {
            method: "PUT",
            body: JSON.stringify({
              ...group,
              members: removeProxyMember(group.members, finalName),
            } satisfies ProxyGroupDraft),
          });
        }

        if (references.usedByFinal && appSettings.data) {
          await apiRequest("/api/app-settings", {
            method: "PUT",
            body: JSON.stringify({
              ...appSettings.data,
              finalGroupMembers: removeProxyMember(configuredFinalMembers, finalName),
            } satisfies AppSettings),
          });
        }

        pushToast({ tone: "success", message: `已同步移除 ${usageLabels.length} 个分组里的节点引用。` });
      } catch (error) {
        pushToast({ tone: "error", message: getErrorMessage(error) });
      }

      await queryClient.invalidateQueries({ queryKey: ["proxy-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["app-settings"] });
      await queryClient.invalidateQueries({ queryKey: ["config-preview"] });
    }

    closeCustomProxyModal();
  }

  async function saveCustomProxyOrder(nextItems: typeof customProxyRecords.items) {
    await upsertFragment.mutateAsync({
      ...customProxyFragment,
      enabled: customProxyFragment.enabled || nextItems.length > 0,
      yamlText: stringifyManualProxyRecords(nextItems),
    });
  }

  function removeCustomProxyImportItem(index: number) {
    setCustomProxyImportResult((current) => ({
      ...current,
      items: current.items.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  async function importCustomProxyYaml() {
    if (!customProxyImportResult.items.length) {
      return;
    }

    const existing = customProxyRecords.items;
    const mergedByName = new Map<string, (typeof existing)[number]>();

    for (const item of existing) {
      const key = String(item.name ?? "").trim() || JSON.stringify(item);
      mergedByName.set(key, item);
    }

    for (const item of customProxyImportResult.items) {
      const key = String(item.name ?? "").trim() || JSON.stringify(item);
      mergedByName.set(key, item);
    }

    await upsertFragment.mutateAsync({
      ...customProxyFragment,
      enabled: true,
      yamlText: stringifyManualProxyRecords(Array.from(mergedByName.values())),
    });
    closeCustomProxyImportModal();
  }

  return (
    <section className="page">
      <div className="section-stack">
        <article className="panel">
          <div className="section-header">
            <div>
              <h3>地域规则列表</h3>
              <p className="muted">按地域浏览命中的节点，先看结果，再决定是否需要改关键词。</p>
            </div>
            <div className="inline-actions">
              <span className="chip">{regionItems.length} 条</span>
              <button
                className="button-secondary"
                onClick={() => {
                  setEditingRegion(null);
                  setIsRegionModalOpen(true);
                }}
                type="button"
              >
                新增地域规则
              </button>
            </div>
          </div>
          {regionItems.length ? (
            <div className="card-grid">
              {regionItems.map((region) => {
                const proxies = regionPreviewMap.get(region.name) ?? [];
                return (
                  <RegionRuleCard
                    isTogglePending={toggleRegion.isPending && togglingRegionId === region.id}
                    key={region.id}
                    isDeletePending={deleteRegion.isPending}
                    onDelete={() => region.id && window.confirm(`确定要删除地域规则「${region.name}」吗？`) && deleteRegion.mutate(region.id)}
                    onEdit={() => {
                      setEditingRegion(region);
                      setIsRegionModalOpen(true);
                    }}
                    onToggleEnabled={(nextEnabled) => toggleRegion.mutate({ ...region, enabled: nextEnabled })}
                    proxies={proxies}
                    region={region}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <strong>还没有地域规则</strong>
              <p className="muted">先添加一个地域和关键词，系统才知道哪些节点要归到这个地域分组里。</p>
              <button
                className="button-secondary"
                onClick={() => {
                  setEditingRegion(null);
                  setIsRegionModalOpen(true);
                }}
                type="button"
              >
                新增地域规则
              </button>
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-header">
            <div>
              <h3>自定义分组列表</h3>
              <p className="muted">这里重点看分组类型、成员来源和最终展开后的节点，而不是堆成表格。</p>
            </div>
            <div className="inline-actions">
              <span className="chip">{proxyGroupItems.length} 组</span>
              {proxyGroupItems.length ? (
                <button className="button-secondary" onClick={openBulkAssignModal} type="button">
                  批量分配节点
                </button>
              ) : null}
              {proxyGroupItems.length > 1 ? (
                <button className="button-secondary" onClick={() => setIsGroupSortModalOpen(true)} type="button">
                  排序
                </button>
              ) : null}
              <button
                className="button"
                onClick={() => {
                  setEditingGroup(null);
                  setIsGroupModalOpen(true);
                }}
                type="button"
              >
                新增自定义分组
              </button>
            </div>
          </div>
          <div className="card-grid system-group-grid">
            <article className="entity-card proxy-group-card system-group-card">
              <div className="entity-card-header">
                <div>
                  <h4>FINAL</h4>
                  <p className="muted">最终出口分组，方便在各个客户端直接切换最终策略。</p>
                </div>
                <div className="entity-card-metrics">
                  <span className="metric-badge">{finalGroupMembers.length} 个成员</span>
                  <span className="metric-badge">{finalGroupPreview.proxies.length} 个节点</span>
                </div>
              </div>
              <div className="entity-card-section">
                <span className="section-label">成员来源</span>
                <div className="token-list proxy-group-token-list">
                  {finalGroupMembers.length ? (
                    finalGroupMembers.slice(0, 8).map((member) => (
                      <span className="chip" key={`final:${getMemberKey(member)}`}>
                        {memberKindLabels[member.kind]} · {member.value}
                      </span>
                    ))
                  ) : (
                    <span className="muted">暂无成员</span>
                  )}
                  {finalGroupMembers.length > 8 ? <span className="chip">+{finalGroupMembers.length - 8} 个输入</span> : null}
                </div>
              </div>
              <div className="entity-card-section">
                <span className="section-label">节点预览</span>
                <ProxyChipList extras={finalGroupPreview.extras} proxies={finalGroupPreview.proxies} />
              </div>
              <div className="entity-card-footer">
                <div className="inline-actions">
                  <button className="button-secondary" onClick={openFinalGroupModal} type="button">
                    编辑 FINAL
                  </button>
                </div>
              </div>
            </article>
          </div>
          {proxyGroupItems.length ? (
            <div className="card-grid proxy-group-list-grid">
              {proxyGroupItems.map((group) => {
                const preview = groupPreviewMap.get(group.name) ?? { proxies: [], extras: [], missing: [] };

                return (
                  <ProxyGroupCard
                    group={group}
                    isDeletePending={deleteGroup.isPending}
                    isTogglePending={toggleGroup.isPending && togglingGroupId === group.id}
                    key={group.id}
                    onDelete={() => group.id && window.confirm(`确定要删除分组「${group.name}」吗？`) && deleteGroup.mutate(group.id)}
                    onEdit={() => {
                      setEditingGroup(group);
                      setIsGroupModalOpen(true);
                    }}
                    onToggleEnabled={(nextEnabled) => toggleGroup.mutate({ ...group, enabled: nextEnabled })}
                    preview={preview}
                  />
                );
              })}
            </div>
          ) : (
            <div className="empty-state group-empty-state">
              <div className="group-empty-copy">
                <span className="section-label">从这里开始</span>
                <strong>还没有自定义分组</strong>
                <p className="muted">从订阅节点、地域分组或自定义节点里挑输入，再把真正展开后的节点预览成一个可用策略组。</p>
              </div>
              <div className="group-empty-metrics">
                <div className="group-empty-metric">
                  <strong>{proxyCatalog.proxies.length}</strong>
                  <span>可选节点</span>
                </div>
                <div className="group-empty-metric">
                  <strong>{regionItems.length}</strong>
                  <span>地域分组</span>
                </div>
                <div className="group-empty-metric">
                  <strong>{customProxyRecords.items.length}</strong>
                  <span>自定义节点</span>
                </div>
              </div>
              <div className="token-list">
                <span className="chip">订阅节点</span>
                <span className="chip">订阅分组</span>
                <span className="chip">地域分组</span>
                <span className="chip">自定义节点</span>
                <span className="chip">内置策略</span>
              </div>
              <button
                className="button"
                onClick={() => {
                  setEditingGroup(null);
                  setIsGroupModalOpen(true);
                }}
                type="button"
              >
                立即创建
              </button>
            </div>
          )}
        </article>
      </div>

      <article className="panel">
        <div className="section-header">
          <div>
            <h3>自定义节点</h3>
            <p className="muted">自定义节点在这里单独维护，新增和编辑都只针对具体某一个节点，避免再面对整段 YAML。</p>
          </div>
          <div className="inline-actions custom-proxy-actions">
            <StatusSwitch
              checked={customProxyFragment.enabled}
              disabled={toggleFragment.isPending && togglingFragmentKey === customProxyFragment.key}
              onChange={(nextEnabled) => toggleFragment.mutateAsync({ ...customProxyFragment, enabled: nextEnabled })}
              title="切换自定义节点的启用状态"
            />
            {customProxyRecords.items.length > 1 ? (
              <button className="button-secondary" onClick={() => setIsCustomProxySortModalOpen(true)} type="button">
                排序
              </button>
            ) : null}
            <button className="button-secondary" onClick={openCustomProxyImportModal} type="button">
              YAML 导入
            </button>
            <button className="button-secondary" onClick={openCustomProxyCreator} type="button">
              新增节点
            </button>
          </div>
        </div>
        <div className="fragment-preview custom-proxy-preview">
          <ManualProxiesPreview
            onDelete={deleteCustomProxyAt}
            onEdit={openCustomProxyEditor}
            text={customProxyFragment.yamlText}
          />
        </div>
      </article>

      <GroupsModals context={{ activeBulkMemberCategoryLabel, activeMemberCategoryLabel, allVisibleBulkMembersSelected, allVisibleSelected, availableSourceFilters, bulkAssignGroupMembers, bulkDirectoryEmptyState, bulkDirectoryMode, bulkMemberCategory, bulkMemberSearch, bulkMemberSourceFilter, bulkSelectedMemberKeySet, bulkSelectedMembers, bulkSelectedPreview, bulkSourceFilterEnabled, bulkTargetGroupIds, bulkVisibleMemberOptions, clearMissingSelectedProxyMembers, clearSelectedMembers, closeBulkAssignModal, closeCustomProxyImportModal, closeCustomProxyModal, closeFinalGroupModal, closeGroupModal, closeRegionModal, customProxyDraftFragment, customProxyDraftSubmitRef, customProxyImportResult, customProxyImportYaml, customProxyRecords, customProxySelectionRequest, dedupeMembers, deleteCustomProxyAt, deleteGroup, deleteRegion, dialerProxyOptions, editingGroup, editingRegion, groupForm, importCustomProxyYaml, isBulkAssignModalOpen, isCustomProxyImportModalOpen, isCustomProxyModalOpen, isCustomProxySortModalOpen, isFinalGroupModalOpen, isGroupModalOpen, isGroupSortModalOpen, isRegionModalOpen, isRegionPreviewVisible, isSelectedMemberSortModalOpen, memberCategory, memberDirectoryEmptyState, memberDirectoryMode, memberSearch, memberSourceFilter, missingSelectedProxyMembers, parseCustomProxyImport, proxyGroupItems, regionDraftKeywords, regionDraftPreview, regionForm, regionName, removeBulkSelectedMember, removeCustomProxyImportItem, removeSelectedMember, reorderGroup, saveCustomProxyDraft, saveCustomProxyOrder, saveFinalGroup, saveGroup, saveRegion, selectedBulkGroups, selectedMemberKeySet, selectedMembers, selectedPreview, setBulkMemberCategory, setBulkMemberSearch, setBulkMemberSourceFilter, setCustomProxyDraftFragment, setCustomProxyImportYaml, setIsCustomProxySortModalOpen, setIsGroupSortModalOpen, setIsRegionPreviewVisible, setIsSelectedMemberSortModalOpen, setMemberCategory, setMemberSearch, setMemberSourceFilter, setSelectedMembers, sourceFilterEnabled, sourceFilterOptions, toggleAllVisibleBulkMembers, toggleAllVisibleMembers, toggleBulkMember, toggleBulkTargetGroup, toggleMember, upsertFragment, visibleBulkSelectedCount, visibleMemberOptions, visibleSelectedCount }} />
    </section>
  );
}
