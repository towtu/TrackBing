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

  // The authenticated RPC reads the authoritative log and updates its totals
  // in one transaction. A failed read never overwrites a summary with zeros.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { data, error } = await supabase.rpc("refresh_daily_summary", {
    p_day: getLocalDateStr(), p_timezone: timeZone,
  });
  if (error || !data?.ok) {
    console.warn("Daily totals could not refresh. Food entries remain saved.");
    return false;
  }
  return true;
}
