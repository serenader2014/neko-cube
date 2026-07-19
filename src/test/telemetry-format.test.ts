import { describe, expect, it } from "vitest";
import { formatBytes, formatCount } from "../web/lib/telemetry";

describe("formatBytes", () => {
  it("scales units and adjusts precision", () => {
    expect(formatBytes(0)).toBe("0\u00A0B");
    expect(formatBytes(1024)).toBe("1.00\u00A0KB");
    expect(formatBytes(35.9 * 1024 ** 3)).toBe("35.9\u00A0GB");
    expect(formatBytes(150 * 1024 ** 2)).toBe("150\u00A0MB");
  });

  it("joins number and unit with a no-break space, not a regular space", () => {
    expect(formatBytes(1024)).not.toContain(" ");
  });

  it("clamps negative input to zero", () => {
    expect(formatBytes(-5)).toBe("0\u00A0B");
  });
});

describe("formatCount", () => {
  it("keeps small counts verbatim", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(20)).toBe("20");
    expect(formatCount(999)).toBe("999");
  });

  it("abbreviates large counts", () => {
    expect(formatCount(1000)).toBe("1K");
    expect(formatCount(228_780)).toBe("228.8K");
    expect(formatCount(1_234_567)).toBe("1.2M");
  });

  it("clamps negative input to zero", () => {
    expect(formatCount(-3)).toBe("0");
  });
});
