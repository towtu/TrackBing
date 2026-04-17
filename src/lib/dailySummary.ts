import { supabase } from "./supabase";

/**
 * Returns a local "YYYY-MM-DD" date string (NOT UTC).
 * Avoids the timezone bug where toISOString() shifts the date.
 */
export function getLocalDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Upserts today's food log totals into the daily_summaries table.
 * Call this every time a food log is added, edited, or deleted.
 */
export async function upsertDailySummary() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = getLocalDateStr(); // local date, not UTC

  // Get today's current totals from food_logs
  const { data: logs } = await supabase
    .from("food_logs")
    .select("calories, protein, carbs, fat")
    .eq("user_id", user.id)
    .gte("created_at", todayStart.toISOString());

  const initial = { calories: 0, protein: 0, carbs: 0, fat: 0, meal_count: 0 };
  const totals = (logs || []).reduce(
    (acc: typeof initial, log) => ({
      calories: acc.calories + (log.calories || 0),
      protein: acc.protein + (log.protein || 0),
      carbs: acc.carbs + (log.carbs || 0),
      fat: acc.fat + (log.fat || 0),
      meal_count: acc.meal_count + 1,
    }),
    initial
  );

  // Upsert into daily_summaries (insert or update if today's row exists)
  await supabase.from("daily_summaries").upsert(
    {
      user_id: user.id,
      date: todayStr,
      calories: totals.calories,
      protein: totals.protein,
      carbs: totals.carbs,
      fat: totals.fat,
      meal_count: totals.meal_count,
    },
    { onConflict: "user_id,date" }
  );

  // Clean up summaries older than 7 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const cutoffStr = getLocalDateStr(cutoff);

  await supabase
    .from("daily_summaries")
    .delete()
    .eq("user_id", user.id)
    .lt("date", cutoffStr);
}
