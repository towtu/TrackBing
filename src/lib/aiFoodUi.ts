import type { AiFood, AiFoodReason } from "./aiFood";

export type AiFoodFeedback = {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  confirmText?: string;
};

export function shouldMarkAiEstimated(food: Pick<AiFood, "source">): boolean {
  return food.source === "ai_estimate";
}

export function getAiFoodFeedback(reason: AiFoodReason): AiFoodFeedback {
  if (reason === "rate_limited") {
    return {
      type: "warning",
      title: "Bee's catching its breath",
      message: "Try again in a moment.",
    };
  }

  if (reason === "over_free_quota" || reason === "over_pro_cap") {
    return {
      type: "info",
      title: "Bee Pro is coming soon",
      message:
        reason === "over_free_quota"
          ? "You've used your free Bee lookups for this month. Pro passes are coming soon."
          : "You've reached Bee's daily Pro safety cap. Try again tomorrow.",
      confirmText: "Got it",
    };
  }

  return {
    type: "error",
    title: "Bee couldn't read that yet",
    message: "Try again with a shorter food or meal description.",
  };
}
