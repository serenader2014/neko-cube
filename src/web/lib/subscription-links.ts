import { buildSubscriptionPath, type SubscriptionClientId } from "@shared/subscription-clients";

export function buildSubscriptionUrl(
  origin: string,
  token: string,
  clientId: SubscriptionClientId = "mihomo",
) {
  return `${origin.replace(/\/$/, "")}${buildSubscriptionPath(token, clientId)}`;
}
