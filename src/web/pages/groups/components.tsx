import type { ProxyGroupDraft, ProxyGroupMember, RegionRule } from "@shared/types";
import { StatusSwitch } from "../../components/StatusSwitch";
import { parseManualProxies } from "../../lib/config-fragments";
import { memberKindLabels } from "./constants";
import { getMemberKey } from "./helpers";

export function RegionRuleCard({
  region,
  proxies,
  onEdit,
  onDelete,
  onToggleEnabled,
  isTogglePending,
  isDeletePending,
}: {
  region: RegionRule;
  proxies: Array<{ finalName: string }>;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (nextEnabled: boolean) => void;
  isTogglePending: boolean;
  isDeletePending: boolean;
}) {
  return (
    <article className="entity-card">
      <div className="entity-card-header">
        <div>
          <h4>{region.name}</h4>
        </div>
        <div className="entity-card-metrics">
          <StatusSwitch
            checked={region.enabled}
            disabled={isTogglePending}
            onChange={onToggleEnabled}
            title={`切换地域规则 ${region.name} 的启用状态`}
          />
          <span className="metric-badge">{proxies.length} 个节点</span>
        </div>
      </div>
      <div className="entity-card-section">
        <span className="section-label">关键词</span>
        <div className="token-list">
          {region.keywords.map((keyword) => (
            <span className="chip" key={keyword}>
              {keyword}
            </span>
          ))}
        </div>
      </div>
      <div className="entity-card-section">
        <span className="section-label">命中节点</span>
        <ProxyChipList proxies={proxies} />
      </div>
      <div className="entity-card-footer">
        <div className="inline-actions">
          <button className="button-secondary" onClick={onEdit} type="button">
            编辑规则
          </button>
          <button className="button-danger" disabled={isDeletePending} onClick={onDelete} type="button">
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProxyGroupCard({
  group,
  preview,
  onEdit,
  onDelete,
  onToggleEnabled,
  isDeletePending,
  isTogglePending,
}: {
  group: ProxyGroupDraft;
  preview: { proxies: Array<{ finalName: string }>; extras: string[]; missing: ProxyGroupMember[] };
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (nextEnabled: boolean) => void;
  isDeletePending: boolean;
  isTogglePending: boolean;
}) {
  return (
    <article className="entity-card proxy-group-card">
      <div className="entity-card-header">
        <div>
          <h4>{group.name}</h4>
          <p className="muted">{group.type}</p>
        </div>
        <div className="entity-card-metrics">
          <StatusSwitch
            checked={group.enabled}
            disabled={isTogglePending}
            onChange={onToggleEnabled}
            title={`切换自定义分组 ${group.name} 的启用状态`}
          />
          <span className="metric-badge">{group.members.length} 个成员</span>
          <span className="metric-badge">{preview.proxies.length} 个节点</span>
        </div>
      </div>
      <div className="entity-card-section">
        <span className="section-label">成员来源</span>
        <div className="token-list proxy-group-token-list">
          {group.members.length ? (
            group.members.slice(0, 8).map((member) => (
              <span className="chip" key={getMemberKey(member)}>
                {memberKindLabels[member.kind]} · {member.value}
              </span>
            ))
          ) : (
            <span className="muted">暂无成员</span>
          )}
          {group.members.length > 8 ? <span className="chip">+{group.members.length - 8} 个输入</span> : null}
        </div>
      </div>
      <div className="entity-card-section">
        <span className="section-label">节点预览</span>
        <ProxyChipList extras={preview.extras} proxies={preview.proxies} />
      </div>
      <div className="entity-card-footer">
        <div className="inline-actions">
          <button className="button-secondary" onClick={onEdit} type="button">
            编辑分组
          </button>
          <button className="button-danger" disabled={isDeletePending} onClick={onDelete} type="button">
            删除
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProxyChipList({
  proxies,
  extras = [],
}: {
  proxies: Array<{ finalName: string }>;
  extras?: string[];
}) {
  if (!proxies.length && !extras.length) {
    return <span className="muted">暂无节点</span>;
  }

  const previewProxies = proxies.slice(0, 8);
  const hiddenCount = Math.max(0, proxies.length - previewProxies.length);

  return (
    <div className="token-list">
      {previewProxies.map((proxy) => (
        <span className="chip" key={proxy.finalName}>
          {proxy.finalName}
        </span>
      ))}
      {extras.map((item) => (
        <span className="chip" key={item}>
          {item}
        </span>
      ))}
      {hiddenCount > 0 ? <span className="chip">+{hiddenCount} 个</span> : null}
    </div>
  );
}

export function ManualProxiesPreview({
  text,
  onDelete,
  onEdit,
}: {
  text: string;
  onDelete: (index: number) => void;
  onEdit: (index: number) => void;
}) {
  const result = parseManualProxies(text);

  if (result.error) {
    return <div className="fragment-empty">自定义节点解析失败：{result.error}</div>;
  }

  if (!result.items.length) {
    return (
      <div className="fragment-empty">
        <div className="stack">
          <strong>暂无自定义节点</strong>
          <p className="muted">可以从右上角新增一个节点，或者直接从 YAML 快速导入一批节点。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="manual-proxy-grid">
      {result.items.map((proxy, index) => (
        <article className="entity-card manual-proxy-card" key={`${proxy.name}:${index}`}>
          <div className="entity-card-header">
            <div>
              <h4>{proxy.name}</h4>
              <p className="muted">
                {proxy.server || "未填写 server"}
                {proxy.port ? `:${proxy.port}` : ""}
              </p>
            </div>
            <div className="entity-card-metrics">
              <span className="metric-badge">{proxy.type}</span>
              {proxy.plugin ? <span className="metric-badge">{proxy.plugin}</span> : null}
            </div>
          </div>
          <div className="entity-card-section">
            <span className="section-label">连接信息</span>
            <div>
              <strong>{proxy.server || "未填写 server"}</strong>
              <div className="muted">
                {proxy.port ? `端口 ${proxy.port}` : "未填写端口"}
                {proxy.cipher ? ` · ${proxy.cipher}` : ""}
              </div>
              {proxy.dialerProxy ? <div className="muted">代理链：{proxy.dialerProxy}</div> : null}
            </div>
          </div>
          <div className="entity-card-section">
            <span className="section-label">标签</span>
            <div className="token-list">
              <span className="chip">{proxy.type}</span>
              {proxy.plugin ? <span className="chip">{proxy.plugin}</span> : null}
              {proxy.cipher ? <span className="chip">{proxy.cipher}</span> : null}
              {proxy.dialerProxy ? <span className="chip">链路: {proxy.dialerProxy}</span> : null}
            </div>
          </div>
          <div className="entity-card-footer">
            <div className="inline-actions">
              <button className="button-secondary" onClick={() => onEdit(index)} type="button">
                编辑
              </button>
              <button className="button-danger" onClick={() => onDelete(index)} type="button">
                删除
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function RegionPreviewList({
  proxies,
}: {
  proxies: Array<{ finalName: string; sourceName: string; type: string }>;
}) {
  if (!proxies.length) {
    return <div className="empty-state compact-empty-state">当前关键词还没有命中任何节点。</div>;
  }

  return (
    <div className="structured-list scroll-panel medium-scroll-panel">
      {proxies.map((proxy) => (
        <div className="structured-row" key={`${proxy.sourceName}:${proxy.finalName}`}>
          <div>
            <strong>{proxy.finalName}</strong>
            <div className="muted">{proxy.sourceName}</div>
          </div>
          <div className="structured-meta">
            <span className="metric-badge">{proxy.type}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
