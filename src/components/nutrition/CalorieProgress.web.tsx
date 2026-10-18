import React from "react";
import { Colors } from "../../styles/colors";
import type { CalorieProgressProps } from "./CalorieProgress";

// Match the native renderer's 130px surface and its 148-unit SVG geometry.
const circumference = 2 * Math.PI * 69.5;

/** Web SVG avoids shipping the native animation runtime for a simple ring. */
export function CalorieProgress({ calories, goal, over }: CalorieProgressProps) {
  const known = Number.isFinite(calories) && calories >= 0 && Number.isFinite(goal) && goal > 0;
  const progress = known ? Math.min(calories / goal, 1) : 0;
  return (
    <svg
      width={130}
      height={130}
      viewBox="0 0 148 148"
      role={known ? "progressbar" : "img"}
      aria-label={known ? "Calories logged" : "Calorie progress unavailable"}
      aria-valuemin={known ? 0 : undefined}
      aria-valuemax={known ? goal : undefined}
      aria-valuenow={known ? Math.min(calories, goal) : undefined}
      aria-valuetext={known ? `${Math.round(calories)} of ${Math.round(goal)} calories logged` : undefined}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx={74} cy={74} r={69.5} fill="none" stroke={Colors.border} strokeWidth={9} />
      <circle
        cx={74}
        cy={74}
        r={69.5}
        fill="none"
        stroke={over ? Colors.error : Colors.accent}
        strokeWidth={9}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        opacity={progress > 0 ? 1 : 0}
        transform="rotate(-90 74 74)"
      />
    </svg>
  );
}
