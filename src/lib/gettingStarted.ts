const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const gettingStartedSteps = [
  { path: "/", target: "calories", title: "Your daily calories", text: "The ring compares today’s logged calories with your daily target. The dashboard also tracks protein, carbs, and fat." },
  { path: "/add", target: "log", title: "Log food", text: "Search for a food, pick the matching result, and enter the amount you ate. Check the portion and nutrition before adding it to your diary." },
  { path: "/add", target: "scan", title: "Scan a barcode", text: "Open the scanner to use your camera or type the barcode. For one item, use its wrapper. If nutrition is missing, enter the values from the label." },
  { path: "/diary", target: "diary", title: "Review your food diary", text: "Choose a date to see what you logged and how it adds up. To change an entry from today, open it in the dashboard’s Today’s log." },
  { path: "/my-foods", target: "foods", title: "Save a food for next time", text: "Create a food using its label. For per-serving values, include the serving weight when you know it. A saved barcode helps you find it on future scans." },
  { path: "/cookbook", target: "cookbook", title: "Build a recipe", text: "Add ingredients and their amounts, then set how many servings the recipe makes. Review a serving before logging it, or edit the saved recipe to add an ingredient." },
  { path: "/stats", target: "stats", title: "See your weekly progress", text: "Check your logging streak and average calories. The weekly charts below show how your logged days compare." },
  { path: "/stats", target: "weight", title: "Record a weigh-in", text: "Enter your weight and measurement date in Weight history. Review it before saving. You can correct or delete an entry later." },
  { path: "/profile", target: "profile", title: "Set units and goals", text: "Profile is where you set units, body measurements, and nutrition targets. Review the calculation before saving. Account controls are farther down." },
  { path: "/", target: "bee", title: "Ask Bee", text: "Open Bee to ask about a food, review progress, or draft a recipe when your plan includes that feature. Review any proposed entry before confirming it." },
  { path: "/plans", target: "plans", title: "Check your plan and usage", text: "See which features your plan includes and how much AI usage remains. Manual food logging is available on the free plan." },
  { path: "/data", target: "export", title: "Download your tracking data", text: "Export your diary and dated weight history when you need a copy. Open Getting started again from the dashboard or Profile whenever you want a refresher." },
] as const;

export type TourTarget = (typeof gettingStartedSteps)[number]["target"];

export function tourStorageKey(accountId: string) {
  return `trackbing:getting-started:v2:${accountId}`;
}

export function isNewTrackBingAccount(createdAt: string | undefined, now = Date.now()) {
  if (!createdAt) return false;
  const age = now - Date.parse(createdAt);
  return age >= 0 && age < ONE_WEEK_MS;
}

export type SpotlightFrame = { x: number; y: number; width: number; height: number };

export function clipSpotlight(frame: SpotlightFrame, width: number, height: number): SpotlightFrame | null {
  if (!Object.values(frame).every(Number.isFinite) || frame.width <= 0 || frame.height <= 0 ||
    frame.x >= width || frame.y >= height || frame.x + frame.width <= 0 || frame.y + frame.height <= 0) return null;
  const padding = 4;
  const x = Math.max(0, frame.x - padding);
  const y = Math.max(0, frame.y - padding);
  return {
    x,
    y,
    width: Math.min(width, frame.x + frame.width + padding) - x,
    height: Math.min(height, frame.y + frame.height + padding) - y,
  };
}
