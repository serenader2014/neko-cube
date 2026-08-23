import { describe, expect, it } from "vitest";
import { loadRuntimeConnectionsPage } from "../web/App";

describe("web route loaders", () => {
  it("resolves the runtime connections page to a React component", async () => {
    const page = await loadRuntimeConnectionsPage();

    expect(page.default).toBeTypeOf("function");
  });
});
