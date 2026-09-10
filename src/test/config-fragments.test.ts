import { describe, expect, it } from "vitest";
import {
  parseBuiltinRules,
  parseHostsEntries,
  parseManualProxyRecords,
  stringifyBuiltinRules,
  stringifyHostsEntries,
  stringifyManualProxyRecords,
} from "../web/lib/config-fragments";
import {
  buildCommittedProxyState,
  createManualProxyDraft,
  emptyManualProxyDraft,
  manualProxyTypeOptions,
} from "../web/components/structured-fragments/manualProxyDraft";

describe("config fragment helpers", () => {
  it("serializes builtin rules in structured order", () => {
    const yaml = stringifyBuiltinRules([
      {
        raw: "",
        matcher: "DOMAIN-SUFFIX",
        value: "example.com",
        policy: "DIRECT",
        noResolve: false,
      },
      {
        raw: "",
        matcher: "IP-CIDR",
        value: "192.0.2.1/32",
        policy: "DIRECT",
        noResolve: true,
      },
      {
        raw: "",
        matcher: "MATCH",
        value: "",
        policy: "FINAL",
        noResolve: false,
      },
    ]);

    const parsed = parseBuiltinRules(yaml);

    expect(parsed.error).toBeNull();
    expect(parsed.items).toEqual([
      {
        raw: "DOMAIN-SUFFIX,example.com,DIRECT",
        matcher: "DOMAIN-SUFFIX",
        value: "example.com",
        policy: "DIRECT",
        noResolve: false,
      },
      {
        raw: "IP-CIDR,192.0.2.1/32,DIRECT,no-resolve",
        matcher: "IP-CIDR",
        value: "192.0.2.1/32",
        policy: "DIRECT",
        noResolve: true,
      },
      {
        raw: "MATCH,FINAL",
        matcher: "MATCH",
        value: "",
        policy: "FINAL",
        noResolve: false,
      },
    ]);
  });

  it("serializes manual proxies with advanced fields", () => {
    const yaml = stringifyManualProxyRecords([
      {
        name: "[手动] HK",
        type: "ss",
        server: "192.0.2.1",
        port: 443,
        password: "test",
        cipher: "aes-256-gcm",
        udp: true,
        "plugin-opts": {
          mode: "websocket",
          host: "cdn.example.com",
        },
      },
    ]);

    const parsed = parseManualProxyRecords(yaml);

    expect(parsed.error).toBeNull();
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.name).toBe("[手动] HK");
    expect(parsed.items[0]?.port).toBe(443);
    expect(parsed.items[0]?.udp).toBe(true);
    expect(parsed.items[0]?.["plugin-opts"]).toEqual({
      mode: "websocket",
      host: "cdn.example.com",
    });
  });

  it("preserves v2ray-plugin boolean options when editing manual proxies", () => {
    const record = {
      name: "[手动] Plugin",
      type: "ss",
      server: "192.0.2.1",
      port: 443,
      password: "test",
      cipher: "aes-256-gcm",
      plugin: "v2ray-plugin",
      "plugin-opts": {
        mode: "websocket",
        host: "cdn.example.com",
        path: "/ws",
        tls: true,
        "skip-cert-verify": true,
        mux: true,
      },
    };
    const draft = createManualProxyDraft(record);
    const nextState = buildCommittedProxyState([record], draft, 0);

    expect(nextState?.record["plugin-opts"]).toEqual({
      mode: "websocket",
      host: "cdn.example.com",
      path: "/ws",
      tls: true,
      "skip-cert-verify": true,
      mux: true,
    });
  });

  it("preserves numeric v2ray-plugin mux values when editing manual proxies", () => {
    const record = {
      name: "[手动] Plugin",
      type: "ss",
      server: "192.0.2.1",
      port: 443,
      password: "test",
      cipher: "aes-256-gcm",
      plugin: "v2ray-plugin",
      "plugin-opts": {
        mode: "websocket",
        mux: 0,
      },
    };
    const draft = createManualProxyDraft(record);
    const nextState = buildCommittedProxyState([record], draft, 0);

    expect(draft.pluginMux).toBe("0");
    expect(nextState?.record["plugin-opts"]).toEqual({
      mode: "websocket",
      mux: 0,
    });
  });

  it("creates structured Tailscale manual proxies without server and port fields", () => {
    const nextState = buildCommittedProxyState(
      [],
      {
        ...emptyManualProxyDraft,
        name: "Tailnet 出口",
        type: "tailscale",
        server: "should-not-be-saved.example.com",
        port: "443",
        dialerProxy: "中转节点",
        tailscaleHostname: "routune",
        tailscaleAuthKey: "tskey-auth-test",
        tailscaleControlUrl: "https://headscale.example.com",
        tailscaleStateDir: "./tailscale-routune",
        tailscaleEphemeral: true,
        tailscaleAcceptRoutes: true,
        tailscaleExitNode: "auto:any",
        tailscaleExitNodeAllowLanAccess: true,
        tailscaleInterfaceName: "en0",
        tailscaleRoutingMark: "6666",
        tailscaleIpVersion: "ipv4-prefer",
        udpEnabled: true,
      },
      null,
    );

    expect(manualProxyTypeOptions).toEqual(expect.arrayContaining([expect.objectContaining({ value: "tailscale" })]));
    expect(nextState?.record).toEqual({
      name: "Tailnet 出口",
      type: "tailscale",
      "dialer-proxy": "中转节点",
      hostname: "routune",
      "auth-key": "tskey-auth-test",
      "control-url": "https://headscale.example.com",
      "state-dir": "./tailscale-routune",
      "exit-node": "auto:any",
      "interface-name": "en0",
      "ip-version": "ipv4-prefer",
      "routing-mark": 6666,
      ephemeral: true,
      "accept-routes": true,
      "exit-node-allow-lan-access": true,
      udp: true,
    });
  });

  it("preserves structured Tailscale fields when editing a manual proxy", () => {
    const record = {
      name: "Tailnet",
      type: "tailscale",
      hostname: "routune",
      "auth-key": "tskey-auth-test",
      "control-url": "https://controlplane.tailscale.com",
      "state-dir": "./tailscale",
      ephemeral: true,
      udp: true,
      "accept-routes": true,
      "exit-node": "100.64.0.1",
      "exit-node-allow-lan-access": true,
      "interface-name": "en0",
      "routing-mark": 6666,
      "ip-version": "dual",
    };
    const draft = createManualProxyDraft(record);
    const nextState = buildCommittedProxyState([record], draft, 0);

    expect(draft.extraFields).toEqual([]);
    expect(nextState?.record).toEqual(record);
  });

  it("serializes hosts entries as a mapping", () => {
    const yaml = stringifyHostsEntries([
      { host: "api.example.com", target: "198.51.100.10" },
      { host: "local.service", target: "127.0.0.1" },
    ]);

    const parsed = parseHostsEntries(yaml);

    expect(parsed.error).toBeNull();
    expect(parsed.items).toEqual([
      { host: "api.example.com", target: "198.51.100.10" },
      { host: "local.service", target: "127.0.0.1" },
    ]);
  });
});
