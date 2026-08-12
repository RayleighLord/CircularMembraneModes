import { describe, expect, it } from "vitest";

import { modeShapeTex } from "../ui/math";

describe("KaTeX formula sources", () => {
  it("shows the generic mode shape without substituting selected indices", () => {
    expect(modeShapeTex()).toBe(
      "\\phi_{m,n}(r,\\theta)=" +
        "J_m\\!\\left(j_{m,n}r/R\\right)\\cos(m\\theta)"
    );
  });

  it("does not expose normalization or a frequency expression", () => {
    expect(modeShapeTex()).not.toMatch(/widehat|A_\{|lVert|\\omega|frequency/i);
  });
});
