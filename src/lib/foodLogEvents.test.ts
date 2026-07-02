import { describe, expect, it } from "vitest";
import { emitFoodLogChanged, subscribeFoodLogChanged } from "./foodLogEvents";

describe("foodLogEvents", () => {
  it("notifies subscribers when food logs change", () => {
    let count = 0;
    const unsubscribe = subscribeFoodLogChanged(() => {
      count += 1;
    });

    emitFoodLogChanged();
    unsubscribe();
    emitFoodLogChanged();

    expect(count).toBe(1);
  });
});
