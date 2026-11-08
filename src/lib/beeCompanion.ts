import type { BeeMood } from "./beeCoach";

export const BEE_POSES = [
  "greeting",
  "thinking",
  "encouraging",
  "celebrating",
  "caution",
  "resting",
  "searching",
  "success",
] as const;

export type BeePose = (typeof BEE_POSES)[number];

export const BEE_SITUATIONS = [
  "greeting",
  "emptyDay",
  "firstMeal",
  "searching",
  "needsClarification",
  "reviewingMatch",
  "logSuccess",
  "streak",
  "lowProtein",
  "fatReview",
  "underTarget",
  "nearTarget",
  "overTarget",
  "inactiveReturn",
  "lookupError",
  "barcodeFound",
  "barcodeNotFound",
  "emptyCollection",
  "thinking",
  "encouraging",
  "celebrating",
  "caution",
  "resting",
  "success",
] as const;

export type BeeSituation = (typeof BEE_SITUATIONS)[number];

const POSE_BY_SITUATION: Record<BeeSituation, BeePose> = {
  greeting: "greeting",
  emptyDay: "encouraging",
  firstMeal: "success",
  searching: "searching",
  needsClarification: "thinking",
  reviewingMatch: "thinking",
  logSuccess: "success",
  streak: "celebrating",
  lowProtein: "encouraging",
  fatReview: "thinking",
  underTarget: "encouraging",
  nearTarget: "success",
  overTarget: "caution",
  inactiveReturn: "resting",
  lookupError: "caution",
  barcodeFound: "success",
  barcodeNotFound: "thinking",
  emptyCollection: "encouraging",
  thinking: "thinking",
  encouraging: "encouraging",
  celebrating: "celebrating",
  caution: "caution",
  resting: "resting",
  success: "success",
};

const ACCESSIBILITY_LABELS: Record<BeeSituation, string> = {
  greeting: "Bee is ready to help",
  emptyDay: "Bee encourages your first food log",
  firstMeal: "Bee celebrates your first meal log",
  searching: "Bee is searching for a food match",
  needsClarification: "Bee needs one more food detail",
  reviewingMatch: "Bee is reviewing a food match",
  logSuccess: "Bee celebrates a successful food log",
  streak: "Bee celebrates your logging streak",
  lowProtein: "Bee suggests a protein boost",
  fatReview: "Bee invites a review of your recorded fat and saved target",
  underTarget: "Bee shows that there is room to fuel",
  nearTarget: "Bee celebrates balanced pacing",
  overTarget: "Bee offers a gentle target reminder",
  inactiveReturn: "Bee welcomes you back",
  lookupError: "Bee could not complete the food lookup",
  barcodeFound: "Bee found the scanned product",
  barcodeNotFound: "Bee needs help identifying the scanned product",
  emptyCollection: "Bee encourages adding the first item",
  thinking: "Bee is thinking",
  encouraging: "Bee is here to help",
  celebrating: "Bee acknowledges a saved update",
  caution: "Bee has a detail to review",
  resting: "Bee is resting and ready to help",
  success: "Bee acknowledges your recorded progress",
};

const MOOD_TO_SITUATION: Record<BeeMood, BeeSituation> = {
  inactiveMonth: "inactiveReturn",
  inactiveWeek: "inactiveReturn",
  empty: "emptyDay",
  over: "overTarget",
  strongProtein: "nearTarget",
  lowProtein: "lowProtein",
  streak: "streak",
  under: "underTarget",
  steady: "nearTarget",
};

export function getBeePose(
  situation: BeeSituation | null | undefined,
): BeePose {
  return situation ? POSE_BY_SITUATION[situation] ?? "greeting" : "greeting";
}

export function getBeeAccessibilityLabel(situation: BeeSituation): string {
  return ACCESSIBILITY_LABELS[situation];
}

export function beeMoodToSituation(mood: BeeMood): BeeSituation {
  return MOOD_TO_SITUATION[mood];
}

/** Semantic model poses cannot imply an unrecorded streak, diet state or error. */
export function beePoseToSituation(pose: BeePose): BeeSituation { return pose; }
