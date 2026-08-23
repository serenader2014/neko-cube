export const subscriptionClients = [
  {
    id: "mihomo",
    label: "Mihomo / Clash",
    shortLabel: "MI",
    pathSuffix: "mihomo.yaml",
    description: "完整 YAML 配置",
  },
  {
    id: "surge",
    label: "Surge",
    shortLabel: "SG",
    pathSuffix: "surge.conf",
    description: "代理列表资源",
  },
  {
    id: "quantumult-x",
    label: "Quantumult X",
    shortLabel: "QX",
    pathSuffix: "quantumult-x.conf",
    description: "节点远程资源",
  },
  {
    id: "loon",
    label: "Loon",
    shortLabel: "LO",
    pathSuffix: "loon.conf",
    description: "原生节点订阅",
  },
  {
    id: "shadowrocket",
    label: "Shadowrocket",
    shortLabel: "SR",
    pathSuffix: "shadowrocket.txt",
    description: "Base64 节点订阅",
  },
] as const;

export type SubscriptionClientId = (typeof subscriptionClients)[number]["id"];

export function buildSubscriptionPath(token: string, clientId: SubscriptionClientId = "mihomo") {
  const client = subscriptionClients.find((item) => item.id === clientId) ?? subscriptionClients[0];
  return `/subscriptions/${encodeURIComponent(token)}/${client.pathSuffix}`;
}
