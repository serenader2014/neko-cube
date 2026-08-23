import { useState } from "react";
import { subscriptionClients, type SubscriptionClientId } from "@shared/subscription-clients";
import { buildSubscriptionUrl } from "@web/lib/subscription-links";
import { pushToast } from "./toast";

export function SubscriptionLinks({ token }: { token: string }) {
  const [copiedClient, setCopiedClient] = useState<SubscriptionClientId | null>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function copyLink(clientId: SubscriptionClientId, url: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      pushToast({ tone: "error", message: "当前浏览器无法访问剪贴板。" });
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopiedClient(clientId);
      const client = subscriptionClients.find((item) => item.id === clientId);
      pushToast({ tone: "success", message: `${client?.label ?? "客户端"} 订阅地址已复制。` });
      window.setTimeout(() => {
        setCopiedClient((current) => (current === clientId ? null : current));
      }, 1800);
    } catch {
      pushToast({ tone: "error", message: "复制失败，请手动选择订阅地址。" });
    }
  }

  return (
    <div className="subscription-link-list">
      {subscriptionClients.map((client) => {
        const url = buildSubscriptionUrl(origin, token, client.id);
        return (
          <div className="subscription-link-row" key={client.id}>
            <div className="subscription-client-meta">
              <span className={`subscription-client-mark is-${client.id}`} aria-hidden="true">
                {client.shortLabel}
              </span>
              <span className="subscription-client-name">
                <strong>{client.label}</strong>
                <small>{client.description}</small>
              </span>
            </div>
            <a
              aria-label={`打开 ${client.label} 订阅地址`}
              className="subscription-link-value"
              href={url}
              rel="noreferrer"
              target="_blank"
              title={`${client.label}：在新窗口打开订阅地址`}
            >
              {url}
            </a>
            <button
              aria-label={`复制 ${client.label} 订阅地址`}
              className="button-secondary subscription-copy-button"
              onClick={() => void copyLink(client.id, url)}
              type="button"
            >
              {copiedClient === client.id ? "已复制" : "复制"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
