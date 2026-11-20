import { describe, expect, it } from "vitest";
import { heatStep, niceTicks } from "./chart-scale";

describe("niceTicks", () => {
  it("steps by 1, 2 or 5 times a power of ten, in whole numbers, up to at least the maximum", () => {
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(37)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("heatStep", () => {
  it("puts a share into one of five steps, and nothing into none", () => {
    expect([null, 0, 0.05, 0.1, 0.2, 0.5, 0.6, 0.75, 0.9, 1].map(heatStep)).toEqual([0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
  });
});
