import { describe, expect, it } from "vitest";
import type { ParsedProxy } from "@shared/types";
import { inferManualProxyRenames } from "../server/db/database-helpers";

function node(name: string): ParsedProxy {
  return { name, type: "trojan", server: "192.0.2.1", port: 443 };
}

describe("inferManualProxyRenames", () => {
  it("detects a single in-place rename", () => {
    expect(inferManualProxyRenames([node("A"), node("B")], [node("A"), node("B2")])).toEqual([
      { previousName: "B", nextName: "B2" },
    ]);
  });

  it("detects multiple in-place renames", () => {
    expect(inferManualProxyRenames([node("A"), node("B")], [node("A2"), node("B2")])).toEqual([
      { previousName: "A", nextName: "A2" },
      { previousName: "B", nextName: "B2" },
    ]);
  });

  it("does not treat a deletion as a rename chain", () => {
    expect(inferManualProxyRenames([node("A"), node("B"), node("C")], [node("B"), node("C")])).toEqual([]);
  });

  it("does not treat an insertion as renames", () => {
    expect(inferManualProxyRenames([node("B"), node("C")], [node("A"), node("B"), node("C")])).toEqual([]);
  });

  it("does not treat reordering as renames", () => {
    expect(inferManualProxyRenames([node("A"), node("B"), node("C")], [node("C"), node("A"), node("B")])).toEqual([]);
  });

  it("bails out when a record is renamed to an existing name", () => {
    expect(inferManualProxyRenames([node("A"), node("B")], [node("A"), node("A")])).toEqual([]);
  });

  it("ignores records without names", () => {
    expect(inferManualProxyRenames([node("A"), { type: "ss" }], [node("A"), { type: "ss" }])).toEqual([]);
  });
});
