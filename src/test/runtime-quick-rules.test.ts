import { describe, expect, it } from "vitest";
import { mihomoConnectionSchema } from "../shared/telemetry";
import { buildConnectionQuickRuleSeed, buildLogQuickRuleSeed } from "../web/pages/runtime/helpers";

describe("runtime quick rule seeds", () => {
  it("prefills an exact domain rule from a live connection", () => {
    const connection = mihomoConnectionSchema.parse({
      id: "connection-1",
      chains: ["Tokyo 01", "自动选择"],
      metadata: {
        host: "api.example.com",
        sourceIP: "192.168.1.8",
      },
    });

    expect(buildConnectionQuickRuleSeed(connection)).toMatchObject({
      type: "DOMAIN",
      target: "api.example.com",
      policy: "自动选择",
      noResolve: false,
    });
  });

  it("falls back to a no-resolve CIDR rule for an IP destination", () => {
    const connection = mihomoConnectionSchema.parse({
      id: "connection-2",
      chains: ["DIRECT"],
      metadata: {
        destinationIP: "203.0.113.9",
      },
    });

    expect(buildConnectionQuickRuleSeed(connection)).toMatchObject({
      type: "IP-CIDR",
      target: "203.0.113.9/32",
      policy: "DIRECT",
      noResolve: true,
    });
  });

  it("extracts the destination and current policy from a Mihomo connection log", () => {
    const seed = buildLogQuickRuleSeed({
      payload: "[TCP] 192.168.1.8:51422 --> media.example.com:443 match Match using FINAL[Tokyo 01]",
    });

    expect(seed).toMatchObject({
      type: "DOMAIN",
      target: "media.example.com",
      policy: "FINAL",
      noResolve: false,
    });
  });

  it("keeps the form editable when a log has no recognizable destination", () => {
    const seed = buildLogQuickRuleSeed({ payload: "[Warning] controller reconnecting" });

    expect(seed.type).toBe("DOMAIN");
    expect(seed.target).toBe("");
    expect(seed.policy).toBe("FINAL");
  });
});
