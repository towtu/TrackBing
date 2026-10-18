import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { Colors } from "../../styles/colors";
import { CalorieProgress } from "./CalorieProgress.web";

// Use the installed SSR runtime without adding a type-only test dependency.
const renderToStaticMarkup = createRequire(import.meta.url)("react-dom/server")
  .renderToStaticMarkup as (node: ReactNode) => string;

// Illustrative display TEST DATA only; these values describe no actual food.
function render(calories: number, goal: number) {
  return renderToStaticMarkup(createElement(CalorieProgress, { calories, goal, over: calories > goal }));
}

describe("web calorie progress", () => {
  it("exposes an empty diary and its real target without a progress animation", () => {
    const html = render(0, 2000);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('aria-valuemax="2000"');
    expect(html).toContain('aria-valuetext="0 of 2000 calories logged"');
    expect(html).toContain('opacity="0"');
    expect(html).toContain('width="130" height="130" viewBox="0 0 148 148"');
  });

  it("draws the actual fraction with the existing ring geometry", () => {
    const html = render(500, 2000);
    const offset = Number(/stroke-dashoffset="([^"]+)"/.exec(html)?.[1]);
    const length = Number(/stroke-dasharray="([^"]+)"/.exec(html)?.[1]);
    expect(offset / length).toBeCloseTo(0.75, 12);
    expect(html).toContain('aria-valuenow="500"');
    expect(html).toContain('stroke="' + Colors.accent + '"');
  });

  it("fills an over-target ring while retaining actual intake in accessible text", () => {
    const html = render(2500, 2000);
    expect(html).toContain('stroke-dashoffset="0"');
    expect(html).toContain('aria-valuenow="2000"');
    expect(html).toContain('aria-valuetext="2500 of 2000 calories logged"');
    expect(html).toContain('stroke="' + Colors.error + '"');
  });

  it.each([[NaN, 2000], [Infinity, 2000], [-1, 2000], [10, 0], [10, Infinity]])(
    "shows unknown progress without invalid ARIA or SVG values: %s / %s",
    (calories, goal) => {
      const html = render(calories, goal);
      expect(html).toContain('aria-label="Calorie progress unavailable"');
      expect(html).not.toContain('aria-valuenow');
      expect(html).not.toMatch(/NaN|Infinity/);
    },
  );
});
