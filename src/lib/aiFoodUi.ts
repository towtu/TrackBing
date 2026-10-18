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

  if (reason === "upgrade_required" || reason === "pro_required" || reason === "over_free_quota" || reason === "over_pro_cap") {
    return {type:"info",title:reason === "pro_required" ? "Upgrade to Pro" : "Upgrade to Plus",message:"Open Plans in Profile to review AI features and allowances. Manual food tracking stays free.",confirmText:"Got it"};
  }
  if (reason.startsWith("monthly_")) return {type:"info",title:"Monthly AI allowance reached",message:"Check Plans for your remaining allowance and reset date. Manual tracking stays available."};
  if (reason === "age_required" || reason === "age_restricted") return {type:"info",title:"AI access needs an adult profile",message:"Bee's cloud AI is available to adults with a complete age setting. Manual tracking stays available."};
  if (reason === "paid_data_unavailable") return {type:"info",title:"Bee is temporarily unavailable",message:"The service is not ready for private AI requests yet. Scan or enter your package label manually."};

  if (reason === "ai_unavailable") {
    return {
      type: "warning",
      title: "Bee could not reach the AI",
      message: "The lookup did not finish. Try again in a moment, or enter your package label manually.",
    };
  }

  if (reason === "needs_input" || reason === "answer_only") {
    return { type: "info", title: "Bee needs a little more detail", message: "Add the preparation, flavor, and package size, or enter the values from your label." };
  }
  if (reason === "search_unavailable" || reason === "not_configured") {
    return { type: "info", title: "Bee lookup is unavailable", message: "Scan a barcode or enter your package label manually." };
  }
  if (reason === "busy" || reason === "conflict") {
    return { type: "warning", title: "Bee is finishing another lookup", message: "Give it a moment, then try again." };
  }

  if (reason === "unauthorized") {
    return {
      type: "warning",
      title: "Sign in required",
      message: "Please sign in again before Bee checks that food.",
    };
  }

  if (reason === "bad_request") {
    return {
      type: "warning",
      title: "Bee needs a food to check",
      message: "Try a food name with an amount, like 60g white rice.",
    };
  }

  return {
    type: "error",
    title: "Bee couldn't read that yet",
    message: "Try again in a moment, or use Find Food while Bee reconnects.",
  };
}
