import {
  buildSubscriptionPath,
  type SubscriptionClientId,
  type SubscriptionKind,
} from "@shared/subscription-clients";

export function buildSubscriptionUrl(
  origin: string,
  token: string,
  clientId: SubscriptionClientId = "mihomo",
  kind: SubscriptionKind = "profile",
) {
  return `${origin.replace(/\/$/, "")}${buildSubscriptionPath(token, clientId, kind)}`;
}
