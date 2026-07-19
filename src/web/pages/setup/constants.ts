import type { SetupStepDefinition } from "./types";

export const SETUP_STEPS: SetupStepDefinition[] = [
  { id: "welcome", title: "欢迎", description: "选择全新配置或导入备份" },
  { id: "sources", title: "订阅源", description: "添加至少一个节点来源" },
  { id: "target", title: "目标与控制器", description: "确认输出路径和控制器连接" },
  { id: "launch", title: "构建与完成", description: "首次构建并获取订阅地址" },
];

export const SETUP_SKIP_STORAGE_KEY = "mihomo-setup-dismissed";

export const SETUP_DASHBOARD_QUERY_KEY = ["setup-dashboard"] as const;

export const DEFAULT_DEVICE_PROFILE_NAME = "我的设备";
