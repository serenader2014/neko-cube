import { tailscaleIpVersionOptions, type ManualProxyDraft } from "./manualProxyDraft";

type ManualProxyTailscaleFieldsProps = {
  draft: ManualProxyDraft;
  onChange: (patch: Partial<ManualProxyDraft>) => void;
};

export function ManualProxyTailscaleFields({ draft, onChange }: ManualProxyTailscaleFieldsProps) {
  return (
    <section className="editor-subsection">
      <div className="compact-section-header">
        <div>
          <h4>Tailscale 配置</h4>
          <p className="muted">作为 Tailnet 设备接入；不需要填写传统代理的服务器地址和端口。</p>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>设备名称</label>
          <input
            onChange={(event) => onChange({ tailscaleHostname: event.target.value })}
            placeholder="例如 mihomo"
            value={draft.tailscaleHostname}
          />
        </div>
        <div className="field">
          <label>认证 Key</label>
          <input
            onChange={(event) => onChange({ tailscaleAuthKey: event.target.value })}
            placeholder="例如 tskey-auth-..."
            value={draft.tailscaleAuthKey}
          />
        </div>
        <div className="field field-span-2">
          <label>控制面地址</label>
          <input
            onChange={(event) => onChange({ tailscaleControlUrl: event.target.value })}
            placeholder="例如 https://controlplane.tailscale.com 或 Headscale 地址"
            value={draft.tailscaleControlUrl}
          />
        </div>
        <div className="field">
          <label>状态目录</label>
          <input
            onChange={(event) => onChange({ tailscaleStateDir: event.target.value })}
            placeholder="默认 tailscale"
            value={draft.tailscaleStateDir}
          />
        </div>
        <div className="field">
          <label>出口节点</label>
          <input
            onChange={(event) => onChange({ tailscaleExitNode: event.target.value })}
            placeholder="节点 IP 或 auto:any"
            value={draft.tailscaleExitNode}
          />
        </div>
        <div className="field">
          <label>出站网卡</label>
          <input
            onChange={(event) => onChange({ tailscaleInterfaceName: event.target.value })}
            placeholder="例如 WLAN"
            value={draft.tailscaleInterfaceName}
          />
        </div>
        <div className="field">
          <label>Linux 路由标记</label>
          <input
            inputMode="numeric"
            onChange={(event) => onChange({ tailscaleRoutingMark: event.target.value })}
            placeholder="例如 6666"
            value={draft.tailscaleRoutingMark}
          />
        </div>
        <div className="field">
          <label>IP 版本</label>
          <select onChange={(event) => onChange({ tailscaleIpVersion: event.target.value })} value={draft.tailscaleIpVersion}>
            <option value="">跟随 Mihomo 默认值</option>
            {tailscaleIpVersionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="manual-proxy-toggle-row">
        <label className="chip">
          <input
            checked={draft.tailscaleEphemeral}
            onChange={(event) => onChange({ tailscaleEphemeral: event.target.checked })}
            type="checkbox"
          />
          临时设备
        </label>
        <label className="chip">
          <input
            checked={draft.udpEnabled}
            onChange={(event) => onChange({ udpEnabled: event.target.checked })}
            type="checkbox"
          />
          支持 UDP
        </label>
        <label className="chip">
          <input
            checked={draft.tailscaleAcceptRoutes}
            onChange={(event) => onChange({ tailscaleAcceptRoutes: event.target.checked })}
            type="checkbox"
          />
          接受子网路由
        </label>
        <label className="chip">
          <input
            checked={draft.tailscaleExitNodeAllowLanAccess}
            onChange={(event) => onChange({ tailscaleExitNodeAllowLanAccess: event.target.checked })}
            type="checkbox"
          />
          出口节点允许访问局域网
        </label>
      </div>
    </section>
  );
}
