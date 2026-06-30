export type BeeStats = {
  calories: number;
  goal: number;
  protein: number;
  proteinGoal?: number;
  streak: number;
  mealCount: number;
  daysSinceLastLog?: number;
};

export type BeeMood =
  | "inactiveMonth"
  | "inactiveWeek"
  | "empty"
  | "over"
  | "strongProtein"
  | "lowProtein"
  | "streak"
  | "under"
  | "steady";

type BeeMessageTemplate = {
  title: string;
  message: (stats: NormalizedBeeStats) => string;
};

type NormalizedBeeStats = {
  calories: number;
  goal: number;
  protein: number;
  proteinGoal?: number;
  streak: number;
  mealCount: number;
  daysSinceLastLog?: number;
  remaining: number;
  overBy: number;
};

const BEE_MESSAGES: Record<BeeMood, BeeMessageTemplate[]> = {
  inactiveMonth: [
    {
      title: "Fresh restart",
      message: () => "Long break? Okay lang. One simple log and balik rhythm tayo.",
    },
    {
      title: "Welcome back",
      message: () => "Matagal-tagal din ah. Start small today, Bee has your back.",
    },
    {
      title: "Reset day",
      message: () => "No guilt, fresh start. Log one meal and rebuild the buzz.",
    },
  ],
  inactiveWeek: [
    {
      title: "Bee missed you",
      message: () => "A week off happens. One meal log lang and we're moving again.",
    },
    {
      title: "Back to it",
      message: () => "Welcome back, busy bee. Small log muna, then tuloy ulit.",
    },
    {
      title: "Check-in time",
      message: () => "Medyo tahimik this week. Start with today's first meal.",
    },
  ],
  empty: [
    {
      title: "Plate check",
      message: () => "Gutom pa? Log your first meal para ma-start natin today.",
    },
    {
      title: "Ready when you are",
      message: () => "Wala pang logs today. Start with your unang meal, busy bee.",
    },
    {
      title: "Fresh day",
      message: () => "No meals yet. Start with one quick log and Bee can track the buzz.",
    },
  ],
  over: [
    {
      title: "Soft landing",
      message: ({ overBy }) =>
        `Lagpas tayo ng ${formatKcal(overBy)} today, okay lang. Gentle reset bukas.`,
    },
    {
      title: "All good",
      message: ({ overBy }) =>
        `${formatKcal(overBy)} over today. No pressure, just note it and keep going.`,
    },
    {
      title: "Still tracking",
      message: () =>
        "Lagpas konti, pero logged and aware ka. That's still progress.",
    },
  ],
  strongProtein: [
    {
      title: "Protein power",
      message: () => "Solid protein today. Strong fuel yan, nice work.",
    },
    {
      title: "Muscle fuel",
      message: () => "Protein is buzzing nicely. Keep that steady pace.",
    },
    {
      title: "Nice protein",
      message: () => "Protina check: strong. Your meals are doing work.",
    },
  ],
  lowProtein: [
    {
      title: "Protein nudge",
      message: () => "Protein is low pa. Add eggs, chicken, tofu, or yogurt if kaya.",
    },
    {
      title: "Tiny boost",
      message: () => "Dagdag protein next meal? Small boost, big help.",
    },
    {
      title: "Balance cue",
      message: () => "Carbs and calories are moving. Protein needs a gentle boost.",
    },
  ],
  streak: [
    {
      title: "Buzz streak",
      message: ({ streak }) => `${streak}-day streak mo. Tuloy lang, sweet rhythm yan.`,
    },
    {
      title: "On a roll",
      message: ({ streak }) => `${streak}-day streak! Bee likes this consistency.`,
    },
    {
      title: "Daily rhythm",
      message: ({ streak }) => `${streak}-day streak na. Small logs, big momentum.`,
    },
  ],
  under: [
    {
      title: "Room to fuel",
      message: ({ remaining }) => `May room pa for ${formatKcal(remaining)}. Kain pa, busy bee.`,
    },
    {
      title: "Still under",
      message: ({ remaining }) => `${formatKcal(remaining)} left today. Pwede pa mag-fuel.`,
    },
    {
      title: "Good pacing",
      message: ({ remaining }) => `Under goal ka pa by ${formatKcal(remaining)}. Nice pace.`,
    },
  ],
  steady: [
    {
      title: "Nice landing",
      message: () => "Close to target today. Smooth landing, Bee approves.",
    },
    {
      title: "Steady day",
      message: () => "Balanced ang pacing today. Keep it calm and consistent.",
    },
    {
      title: "Target zone",
      message: () => "Nasa target zone ka. Good job keeping it steady.",
    },
  ],
};

export function getBeeMessage(
  stats: BeeStats,
  seed = 0,
): { title: string; message: string; mood: BeeMood } {
  const normalized = normalizeStats(stats);
  const mood = getBeeMood(normalized);
  const variants = BEE_MESSAGES[mood];
  const variant = variants[pickIndex(mood, seed, variants.length)];

  return {
    title: variant.title,
    message: variant.message(normalized),
    mood,
  };
}

function normalizeStats(stats: BeeStats): NormalizedBeeStats {
  const calories = positiveNumber(stats.calories);
  const goal = positiveNumber(stats.goal);
  const protein = positiveNumber(stats.protein);
  const proteinGoal = positiveNumber(stats.proteinGoal);
  const streak = Math.max(0, Math.floor(positiveNumber(stats.streak)));
  const mealCount = Math.max(0, Math.floor(positiveNumber(stats.mealCount)));
  const daysSinceLastLog = positiveNumber(stats.daysSinceLastLog);

  return {
    calories,
    goal,
    protein,
    proteinGoal: proteinGoal > 0 ? proteinGoal : undefined,
    streak,
    mealCount,
    daysSinceLastLog: daysSinceLastLog > 0 ? Math.floor(daysSinceLastLog) : undefined,
    remaining: Math.max(0, goal - calories),
    overBy: Math.max(0, calories - goal),
  };
}

function getBeeMood(stats: NormalizedBeeStats): BeeMood {
  if (stats.mealCount === 0 && stats.daysSinceLastLog) {
    if (stats.daysSinceLastLog >= 30) return "inactiveMonth";
    if (stats.daysSinceLastLog >= 7) return "inactiveWeek";
  }
  if (stats.mealCount === 0) return "empty";
  if (stats.goal > 0 && stats.calories > stats.goal) return "over";

  if (stats.proteinGoal) {
    if (stats.protein >= stats.proteinGoal * 0.85) return "strongProtein";
    if (stats.protein < stats.proteinGoal * 0.25) return "lowProtein";
  }

  if (stats.streak >= 3) return "streak";
  if (stats.goal > 0 && stats.calories < stats.goal) return "under";
  return "steady";
}

function pickIndex(mood: BeeMood, seed: number, length: number) {
  const safeSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
  return Math.abs(safeSeed + hashString(mood)) % length;
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

function positiveNumber(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function formatKcal(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} kcal`;
}
