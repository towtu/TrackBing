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
  "underTarget",
  "nearTarget",
  "overTarget",
  "inactiveReturn",
  "lookupError",
  "barcodeFound",
  "barcodeNotFound",
  "emptyCollection",
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
  underTarget: "encouraging",
  nearTarget: "success",
  overTarget: "caution",
  inactiveReturn: "resting",
  lookupError: "caution",
  barcodeFound: "success",
  barcodeNotFound: "thinking",
  emptyCollection: "encouraging",
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
  underTarget: "Bee shows that there is room to fuel",
  nearTarget: "Bee celebrates balanced pacing",
  overTarget: "Bee offers a gentle target reminder",
  inactiveReturn: "Bee welcomes you back",
  lookupError: "Bee could not complete the food lookup",
  barcodeFound: "Bee found the scanned product",
  barcodeNotFound: "Bee needs help identifying the scanned product",
  emptyCollection: "Bee encourages adding the first item",
};

const TAP_REACTIONS: Record<
  BeeSituation,
  readonly [string, string, string]
> = {
  greeting: [
    "Ready when you are.",
    "What are we logging?",
    "Let’s make today count.",
  ],
  emptyDay: [
    "One quick log is enough to get today moving.",
    "Start small—your next meal is a good place.",
    "I’ll keep the first log easy.",
  ],
  firstMeal: [
    "First log landed.",
    "That’s the day started.",
    "Nice first step.",
  ],
  searching: [
    "Checking the closest match.",
    "Still looking.",
    "Almost there.",
  ],
  needsClarification: [
    "One detail will sharpen the estimate.",
    "A little context helps.",
    "Tell me the portion or preparation.",
  ],
  reviewingMatch: [
    "Check the serving before logging.",
    "You stay in control of the final numbers.",
    "Review first, then log.",
  ],
  logSuccess: [
    "Logged and ready.",
    "That meal is in.",
    "Nice—your totals are updated.",
  ],
  streak: [
    "Consistency looks good on you.",
    "Keep the rhythm.",
    "Small logs, strong streak.",
  ],
  lowProtein: [
    "A small protein add-on can help.",
    "Eggs, tofu, yogurt, or chicken could fit.",
    "Your next meal can balance this.",
  ],
  underTarget: [
    "There is still room to fuel.",
    "Keep listening to your appetite.",
    "You have space for another meal.",
  ],
  nearTarget: [
    "Smooth pacing today.",
    "You’re close to the target zone.",
    "Steady work.",
  ],
  overTarget: [
    "No guilt—just useful information.",
    "One day does not define progress.",
    "Log it, learn, and continue.",
  ],
  inactiveReturn: [
    "Welcome back.",
    "A fresh log is a fresh start.",
    "No catching up required.",
  ],
  lookupError: [
    "Try again or search manually.",
    "The lookup paused, not your progress.",
    "Your other logging tools still work.",
  ],
  barcodeFound: [
    "Product found.",
    "Check the serving, then log.",
    "The barcode match is ready.",
  ],
  barcodeNotFound: [
    "Try another scan or create it manually.",
    "A clearer barcode may help.",
    "We can still add this food.",
  ],
  emptyCollection: [
    "Your first saved item starts here.",
    "Add one favorite to make this useful.",
    "A small collection is still a collection.",
  ],
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

export function getBeeTapReaction(
  situation: BeeSituation,
  tapCount: number,
): string {
  const reactions = TAP_REACTIONS[situation];
  const index = Math.abs(Math.floor(tapCount)) % reactions.length;
  return reactions[index];
}

export function beeMoodToSituation(mood: BeeMood): BeeSituation {
  return MOOD_TO_SITUATION[mood];
}

export function beePoseToSituation(pose:BeePose):BeeSituation {return ({greeting:"greeting",thinking:"needsClarification",encouraging:"underTarget",celebrating:"streak",caution:"lookupError",resting:"inactiveReturn",searching:"searching",success:"logSuccess"} as const)[pose];}
