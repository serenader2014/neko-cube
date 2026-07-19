import { ModuleShell, type ModuleTab } from "../components/ModuleShell";
import {
  ConfigDevicesGlyph,
  ConfigOverviewGlyph,
  ConfigRulesGlyph,
  GroupsGlyph,
  SourcesGlyph,
  TargetGlyph,
} from "../components/icons";

const CONFIG_TABS: ModuleTab[] = [
  { to: "overview", label: "总览", icon: (active) => <ConfigOverviewGlyph active={active} /> },
  { to: "sources", label: "订阅源", icon: (active) => <SourcesGlyph active={active} /> },
  { to: "groups", label: "节点分组", icon: (active) => <GroupsGlyph active={active} /> },
  { to: "rules", label: "规则与策略", icon: (active) => <ConfigRulesGlyph active={active} /> },
  { to: "target", label: "服务与目标", icon: (active) => <TargetGlyph active={active} /> },
  { to: "devices", label: "设备订阅", icon: (active) => <ConfigDevicesGlyph active={active} /> },
];

export function ConfigPage() {
  return (
    <ModuleShell
      eyebrow="配置"
      title="订阅与配置"
      description="管理订阅源、节点分组、规则策略、本地目标和设备订阅入口。"
      navLabel="配置导航"
      tabs={CONFIG_TABS}
    />
  );
}
