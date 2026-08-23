import { useState } from "react";
import {
  subscriptionClients,
  subscriptionKinds,
  type SubscriptionClientId,
  type SubscriptionKind,
} from "@shared/subscription-clients";
import { buildSubscriptionUrl } from "@web/lib/subscription-links";
import { pushToast } from "./toast";

type CopiedLink = `${SubscriptionClientId}:${SubscriptionKind}`;

export function SubscriptionLinks({ token }: { token: string }) {
  const [copiedLink, setCopiedLink] = useState<CopiedLink | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function copyLink(
    clientId: SubscriptionClientId,
    kind: SubscriptionKind,
    url: string,
  ) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      pushToast({ tone: "error", message: "当前浏览器无法访问剪贴板。" });
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      const key: CopiedLink = `${clientId}:${kind}`;
      setCopiedLink(key);
      const client = subscriptionClients.find((item) => item.id === clientId);
      const linkKind = subscriptionKinds.find((item) => item.id === kind);
      pushToast({
        tone: "success",
        message: `${client?.label ?? "客户端"}${linkKind?.label ?? "订阅"}地址已复制。`,
      });
      window.setTimeout(() => {
        setCopiedLink((current) => (current === key ? null : current));
      }, 1800);
    } catch {
      pushToast({ tone: "error", message: "复制失败，请手动选择订阅地址。" });
    }
  }

  return (
    <div className="subscription-link-list">
      {subscriptionClients.map((client) => (
        <section className="subscription-link-row" key={client.id}>
          <div className="subscription-client-meta">
            <span className={`subscription-client-mark is-${client.id}`} aria-hidden="true">
              {client.shortLabel}
            </span>
            <span className="subscription-client-name">
              <strong>{client.label}</strong>
              <small>{client.description}</small>
            </span>
          </div>
          <div className="subscription-link-options">
            {subscriptionKinds.map((kind) => {
              const key: CopiedLink = `${client.id}:${kind.id}`;
              const url = buildSubscriptionUrl(origin, token, client.id, kind.id);
              return (
                <div className="subscription-link-option" key={kind.id}>
                  <span className={`subscription-kind-badge is-${kind.id}`}>
                    {kind.label}
                  </span>
                  <a
                    aria-label={`打开 ${client.label}${kind.label}地址`}
                    className="subscription-link-value"
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                    title={kind.description}
                  >
                    {url}
                  </a>
                  <button
                    aria-label={`复制 ${client.label}${kind.label}地址`}
                    className="button-secondary subscription-copy-button"
                    onClick={() => void copyLink(client.id, kind.id, url)}
                    type="button"
                  >
                    {copiedLink === key ? "已复制" : "复制"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
