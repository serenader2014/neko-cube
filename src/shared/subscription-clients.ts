export const subscriptionKinds = [
  {
    id: "nodes",
    label: "节点订阅",
    description: "仅同步节点，适合合并到已有配置",
  },
  {
    id: "profile",
    label: "完整配置",
    description: "包含节点、策略组、规则与规则集",
  },
] as const;

export type SubscriptionKind = (typeof subscriptionKinds)[number]["id"];

export const subscriptionClients = [
  {
    id: "mihomo",
    label: "Mihomo / Clash",
    shortLabel: "MI",
    description: "YAML 配置",
    paths: {
      nodes: "mihomo-nodes.yaml",
      profile: "mihomo-profile.yaml",
    },
  },
  {
    id: "surge",
    label: "Surge",
    shortLabel: "SG",
    description: "Surge 原生配置",
    paths: {
      nodes: "surge-nodes.conf",
      profile: "surge-profile.conf",
    },
  },
  {
    id: "quantumult-x",
    label: "Quantumult X",
    shortLabel: "QX",
    description: "Quantumult X 原生配置",
    paths: {
      nodes: "quantumult-x-nodes.conf",
      profile: "quantumult-x-profile.conf",
    },
  },
  {
    id: "loon",
    label: "Loon",
    shortLabel: "LO",
    description: "Loon 原生配置",
    paths: {
      nodes: "loon-nodes.conf",
      profile: "loon-profile.conf",
    },
  },
  {
    id: "shadowrocket",
    label: "Shadowrocket",
    shortLabel: "SR",
    description: "Shadowrocket 节点与规则配置",
    paths: {
      nodes: "shadowrocket-nodes.txt",
      profile: "shadowrocket-profile.conf",
    },
  },
] as const;

export type SubscriptionClientId = (typeof subscriptionClients)[number]["id"];

export function buildSubscriptionPath(
  token: string,
  clientId: SubscriptionClientId = "mihomo",
  kind: SubscriptionKind = "profile",
) {
  const client = subscriptionClients.find((item) => item.id === clientId) ?? subscriptionClients[0];
  return `/subscriptions/${encodeURIComponent(token)}/${client.paths[kind]}`;
}
