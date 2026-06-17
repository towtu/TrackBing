import { useFocusEffect, useRouter } from "expo-router";
import {
  CaretLeft,
  ChartBar,
  Fire,
  Lightning,
  TrendUp,
  Trophy,
} from "phosphor-react-native";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/src/lib/supabase";
import { getLocalDateStr } from "@/src/lib/dailySummary";
import { readCache, writeCache } from "@/src/lib/cache";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

interface DayData {
  date: string;
  label: string;
  dayName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  count: number;
}

interface CachedStats {
  weekData: DayData[];
  streak: number;
  calorieGoal: number;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type SummaryRow = {
  date: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  meal_count: number | null;
};

/** Pure streak calc from the (already-fetched) summaries + today's live state. */
function computeStreak(summaries: SummaryRow[], loggedToday: boolean): number {
  const dates = new Set<string>();
  summaries.forEach((s) => {
    if ((s.meal_count || 0) > 0) dates.add(s.date);
  });

  const todayStr = getLocalDateStr();
  if (loggedToday) dates.add(todayStr);
  if (dates.size === 0) return 0;

  const sorted = Array.from(dates).sort().reverse();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateStr(yesterday);

  if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) return 0;

  let count = 0;
  const checkDate = new Date(sorted[0]);
  for (let i = 0; i < sorted.length; i++) {
    const expected = new Date(checkDate);
    expected.setDate(expected.getDate() - i);
    if (sorted[i] === getLocalDateStr(expected)) count++;
    else break;
  }
  return count;
}

/**
 * Fetches and shapes the weekly stats for a user. One daily_summaries read
 * feeds both the 7-day chart and the streak (summaries are capped at 7 days by
 * the cleanup job, so the result set stays tiny).
 */
type TodayTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  count: number;
};

type WeeklyRaw = {
  calorieTarget: number | null;
  summaries: SummaryRow[];
  today: TodayTotals;
};

/** Shape of the get_weekly_stats RPC payload. */
type WeeklyStatsRpc = {
  calorie_target: number | null;
  summaries: SummaryRow[];
  today: TodayTotals;
};

const EMPTY_TODAY: TodayTotals = {
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  count: 0,
};

/**
 * Fetches the raw weekly data. Prefers the single-round-trip get_weekly_stats
 * RPC; if it isn't available yet (migration not applied), falls back to the
 * three source queries run in parallel.
 */
async function fetchWeeklyRaw(
  userId: string,
  todayStartIso: string,
): Promise<WeeklyRaw> {
  const { data, error } = await supabase.rpc("get_weekly_stats", {
    p_today_start: todayStartIso,
  });

  if (!error && data) {
    const payload = data as WeeklyStatsRpc;
    return {
      calorieTarget: payload.calorie_target ?? null,
      summaries: payload.summaries ?? [],
      today: payload.today ?? EMPTY_TODAY,
    };
  }

  // Fallback: parallel queries (still one round-trip's worth of latency).
  const [goalRes, summaryRes, todayRes] = await Promise.all([
    supabase
      .from("user_goals")
      .select("calorie_target")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("daily_summaries")
      .select("date, calories, protein, carbs, fat, meal_count")
      .eq("user_id", userId)
      .order("date", { ascending: false }),
    supabase
      .from("food_logs")
      .select("calories, protein, carbs, fat")
      .eq("user_id", userId)
      .gte("created_at", todayStartIso),
  ]);

  const today = (todayRes.data ?? []).reduce<TodayTotals>(
    (acc, log) => ({
      calories: acc.calories + (log.calories || 0),
      protein: acc.protein + (log.protein || 0),
      carbs: acc.carbs + (log.carbs || 0),
      fat: acc.fat + (log.fat || 0),
      count: acc.count + 1,
    }),
    { ...EMPTY_TODAY },
  );

  return {
    calorieTarget: goalRes.data?.calorie_target ?? null,
    summaries: (summaryRes.data ?? []) as SummaryRow[],
    today,
  };
}

async function computeStats(userId: string): Promise<CachedStats> {
  const now = new Date();
  const todayStr = getLocalDateStr(now);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const raw = await fetchWeeklyRaw(userId, todayStart.toISOString());
  const calorieGoal = raw.calorieTarget || 2000;

  const dayMap: Record<string, DayData> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(now.getDate() - 6 + i);
    const key = getLocalDateStr(d);
    dayMap[key] = {
      date: key,
      label: d.getDate().toString(),
      dayName: DAY_NAMES[d.getDay()],
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      count: 0,
    };
  }

  raw.summaries.forEach((s) => {
    if (dayMap[s.date]) {
      dayMap[s.date].calories = s.calories || 0;
      dayMap[s.date].protein = s.protein || 0;
      dayMap[s.date].carbs = s.carbs || 0;
      dayMap[s.date].fat = s.fat || 0;
      dayMap[s.date].count = s.meal_count || 0;
    }
  });

  // Today may not be flushed to a summary yet — fold in live totals, preferring
  // whichever source has more meals recorded.
  const loggedToday = raw.today.count > 0;
  if (loggedToday && raw.today.count >= (dayMap[todayStr]?.count || 0)) {
    dayMap[todayStr] = { ...dayMap[todayStr], ...raw.today };
  }

  const streak = computeStreak(raw.summaries, loggedToday);
  return { weekData: Object.values(dayMap), streak, calorieGoal };
}

export default function StatsPage() {
  const router = useRouter();
  const { isDesktop } = useResponsive();

  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState(0);
  const [calorieGoal, setCalorieGoal] = useState(2000);

  const applyStats = useCallback((s: CachedStats) => {
    setWeekData(s.weekData);
    setStreak(s.streak);
    setCalorieGoal(s.calorieGoal);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        // getSession reads from local storage (no network round-trip); RLS still
        // enforces ownership server-side on the queries below.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) {
          setLoading(false);
          return;
        }

        const cacheKey = `stats:week:${user.id}`;

        // Render last-known data instantly; only block on a true cold start.
        const cached = await readCache<CachedStats>(cacheKey);
        if (cached && !cancelled) {
          applyStats(cached);
          setLoading(false);
        }

        // Revalidate in the background and update if anything changed.
        try {
          const fresh = await computeStats(user.id);
          if (cancelled) return;
          applyStats(fresh);
          writeCache(cacheKey, fresh);
        } catch (e) {
          console.warn("Stats refresh failed", e);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [applyStats]),
  );

  // Computed stats
  const daysWithData = weekData.filter((d) => d.count > 0);
  const avgCalories =
    daysWithData.length > 0
      ? Math.round(
          daysWithData.reduce((a, d) => a + d.calories, 0) / daysWithData.length
        )
      : 0;
  const avgProtein =
    daysWithData.length > 0
      ? Math.round(
          daysWithData.reduce((a, d) => a + d.protein, 0) / daysWithData.length
        )
      : 0;
  const avgCarbs =
    daysWithData.length > 0
      ? Math.round(
          daysWithData.reduce((a, d) => a + d.carbs, 0) / daysWithData.length
        )
      : 0;
  const avgFat =
    daysWithData.length > 0
      ? Math.round(
          daysWithData.reduce((a, d) => a + d.fat, 0) / daysWithData.length
        )
      : 0;

  const totalLogged = weekData.reduce((a, d) => a + d.count, 0);
  const maxCalDay = weekData.reduce(
    (mx, d) => (d.calories > mx.calories ? d : mx),
    weekData[0] || { calories: 0, dayName: "-" }
  );
  const chartMax = Math.max(
    calorieGoal,
    ...weekData.map((d) => d.calories),
    1
  );

  const todayStr = new Date().toISOString().split("T")[0];

  if (loading) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: Colors.primary }}
        edges={["top"]}
      >
        <ActivityIndicator
          color={Colors.accent}
          size="large"
          style={{ marginTop: 100 }}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top"]}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          {
            padding: 18,
            width: "100%",
            paddingBottom: 40,
          },
          isDesktop ? { maxWidth: 1280, alignSelf: "center" } : { maxWidth: 520, alignSelf: "center" }
        ]}
      >
        {/* ── HEADER ── */}
        <View style={styles.header}>
          {!isDesktop && (
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backBtn}
            >
              <CaretLeft size={24} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle}>Weekly Stats</Text>
          <View style={{ width: 42 }} />
        </View>

        {/* ── STREAK + SUMMARY ROW ── */}
        <View style={styles.summaryRow}>
          <View style={styles.streakCard}>
            <View style={styles.streakIconWrap}>
              <Fire size={24} color="#FF6B35" weight="fill" />
            </View>
            <Text style={styles.streakValue}>{streak}</Text>
            <Text style={styles.streakLabel}>DAY STREAK</Text>
          </View>

          <View style={styles.streakCard}>
            <View
              style={[
                styles.streakIconWrap,
                { backgroundColor: `${Colors.accent}22` },
              ]}
            >
              <Lightning size={24} color="#FFD700" weight="fill" />
            </View>
            <Text style={styles.streakValue}>{avgCalories}</Text>
            <Text style={styles.streakLabel}>AVG KCAL</Text>
          </View>

          <View style={styles.streakCard}>
            <View
              style={[
                styles.streakIconWrap,
                { backgroundColor: "rgba(74,222,128,0.12)" },
              ]}
            >
              <TrendUp size={24} color={Colors.success} weight="bold" />
            </View>
            <Text style={styles.streakValue}>{totalLogged}</Text>
            <Text style={styles.streakLabel}>MEALS</Text>
          </View>
        </View>

        {isDesktop ? (
          <View style={{ flexDirection: "row", gap: 24, marginTop: 16 }}>
            {/* Left side: Calorie Intake Chart */}
            <View style={{ flex: 3 }}>
              {/* ── WEEKLY BAR CHART ── */}
              <View style={[styles.chartCard, { marginBottom: 0 }]}>
                <View style={styles.chartHeader}>
                  <ChartBar size={18} color={Colors.accent} weight="fill" />
                  <Text style={styles.chartTitle}>Calorie Intake</Text>
                  <Text style={styles.chartSubtitle}>Last 7 days</Text>
                </View>

                {/* Goal line indicator */}
                <View style={styles.goalIndicator}>
                  <View style={styles.goalLine} />
                  <Text style={styles.goalLineText}>{calorieGoal} goal</Text>
                </View>

                <View style={styles.barsRow}>
                  {weekData.map((day) => {
                    const barHeight = chartMax > 0 ? (day.calories / chartMax) * 140 : 0;
                    const isToday = day.date === todayStr;
                    const overGoal = day.calories > calorieGoal;

                    return (
                      <View key={day.date} style={styles.barColumn}>
                        <Text style={styles.barValue}>
                          {day.calories > 0 ? day.calories : ""}
                        </Text>
                        <View style={styles.barTrack}>
                          <View
                            style={[
                              styles.barFill,
                              {
                                height: Math.max(barHeight, day.calories > 0 ? 6 : 0),
                                backgroundColor: overGoal
                                  ? Colors.error
                                  : isToday
                                  ? Colors.accent
                                  : "rgba(255, 204, 0, 0.5)",
                              },
                              isToday && {
                                shadowColor: Colors.accent,
                                shadowOffset: { width: 0, height: 0 },
                                shadowOpacity: 0.6,
                                shadowRadius: 8,
                                elevation: 4,
                              },
                            ]}
                          />
                        </View>
                        <Text
                          style={[
                            styles.barDayName,
                            isToday && { color: Colors.accent, fontWeight: "900" },
                          ]}
                        >
                          {day.dayName}
                        </Text>
                        <Text
                          style={[
                            styles.barDateNum,
                            isToday && { color: Colors.accent },
                          ]}
                        >
                          {day.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Right side: Averages & Best Day */}
            <View style={{ flex: 2, gap: 20 }}>
              <Text style={[styles.sectionTitle, { marginBottom: 4 }]}>Daily Averages</Text>
              
              <View style={styles.avgGrid}>
                <View
                  style={[
                    styles.avgCard,
                    { borderLeftColor: Colors.protein, borderLeftWidth: 3 },
                  ]}
                >
                  <Text style={[styles.avgValue, { color: Colors.protein }]}>
                    {avgProtein}g
                  </Text>
                  <Text style={styles.avgLabel}>Protein</Text>
                </View>
                <View
                  style={[
                    styles.avgCard,
                    { borderLeftColor: Colors.carbs, borderLeftWidth: 3 },
                  ]}
                >
                  <Text style={[styles.avgValue, { color: Colors.carbs }]}>
                    {avgCarbs}g
                  </Text>
                  <Text style={styles.avgLabel}>Carbs</Text>
                </View>
                <View
                  style={[
                    styles.avgCard,
                    { borderLeftColor: Colors.fat, borderLeftWidth: 3 },
                  ]}
                >
                  <Text style={[styles.avgValue, { color: Colors.fat }]}>
                    {avgFat}g
                  </Text>
                  <Text style={styles.avgLabel}>Fat</Text>
                </View>
              </View>

              {maxCalDay && maxCalDay.calories > 0 && (
                <View style={[styles.bestDayCard, { flex: 0 }]}>
                  <View style={styles.bestDayIcon}>
                    <Trophy size={24} color="#FFD700" weight="fill" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bestDayTitle}>Highest Intake Day</Text>
                    <Text style={styles.bestDaySubtext}>
                      {maxCalDay.dayName} — {maxCalDay.calories} kcal
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            {/* ── WEEKLY BAR CHART ── */}
            <View style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <ChartBar size={18} color={Colors.accent} weight="fill" />
                <Text style={styles.chartTitle}>Calorie Intake</Text>
                <Text style={styles.chartSubtitle}>Last 7 days</Text>
              </View>

              {/* Goal line indicator */}
              <View style={styles.goalIndicator}>
                <View style={styles.goalLine} />
                <Text style={styles.goalLineText}>{calorieGoal} goal</Text>
              </View>

              <View style={styles.barsRow}>
                {weekData.map((day) => {
                  const barHeight = chartMax > 0 ? (day.calories / chartMax) * 140 : 0;
                  const isToday = day.date === todayStr;
                  const overGoal = day.calories > calorieGoal;

                  return (
                    <View key={day.date} style={styles.barColumn}>
                      <Text style={styles.barValue}>
                        {day.calories > 0 ? day.calories : ""}
                      </Text>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.barFill,
                            {
                              height: Math.max(barHeight, day.calories > 0 ? 6 : 0),
                              backgroundColor: overGoal
                                ? Colors.error
                                : isToday
                                ? Colors.accent
                                : "rgba(255, 204, 0, 0.5)",
                            },
                            isToday && {
                              shadowColor: Colors.accent,
                              shadowOffset: { width: 0, height: 0 },
                              shadowOpacity: 0.6,
                              shadowRadius: 8,
                              elevation: 4,
                            },
                          ]}
                        />
                      </View>
                      <Text
                        style={[
                          styles.barDayName,
                          isToday && { color: Colors.accent, fontWeight: "900" },
                        ]}
                      >
                        {day.dayName}
                      </Text>
                      <Text
                        style={[
                          styles.barDateNum,
                          isToday && { color: Colors.accent },
                        ]}
                      >
                        {day.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ── DAILY AVERAGES ── */}
            <Text style={styles.sectionTitle}>Daily Averages</Text>
            <View style={styles.avgGrid}>
              <View
                style={[
                  styles.avgCard,
                  { borderLeftColor: Colors.protein, borderLeftWidth: 3 },
                ]}
              >
                <Text style={[styles.avgValue, { color: Colors.protein }]}>
                  {avgProtein}g
                </Text>
                <Text style={styles.avgLabel}>Protein</Text>
              </View>
              <View
                style={[
                  styles.avgCard,
                  { borderLeftColor: Colors.carbs, borderLeftWidth: 3 },
                ]}
              >
                <Text style={[styles.avgValue, { color: Colors.carbs }]}>
                  {avgCarbs}g
                </Text>
                <Text style={styles.avgLabel}>Carbs</Text>
              </View>
              <View
                style={[
                  styles.avgCard,
                  { borderLeftColor: Colors.fat, borderLeftWidth: 3 },
                ]}
              >
                <Text style={[styles.avgValue, { color: Colors.fat }]}>
                  {avgFat}g
                </Text>
                <Text style={styles.avgLabel}>Fat</Text>
              </View>
            </View>

            {/* ── BEST DAY HIGHLIGHT ── */}
            {maxCalDay && maxCalDay.calories > 0 && (
              <View style={styles.bestDayCard}>
                <View style={styles.bestDayIcon}>
                  <Trophy size={24} color="#FFD700" weight="fill" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bestDayTitle}>Highest Intake Day</Text>
                  <Text style={styles.bestDaySubtext}>
                    {maxCalDay.dayName} — {maxCalDay.calories} kcal
                  </Text>
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  backBtn: {
    padding: 9,
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },

  // ── SUMMARY ROW ──
  summaryRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  streakCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  streakIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255, 107, 53, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  streakValue: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -1,
  },
  streakLabel: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5,
    marginTop: 4,
  },

  // ── CHART CARD ──
  chartCard: {
    backgroundColor: Colors.surface,
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  chartHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
  },
  chartTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    flex: 1,
  },
  chartSubtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  goalIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  goalLine: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(255,204,0,0.2)",
    borderStyle: "dashed",
  },
  goalLineText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  barsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 6,
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
  },
  barValue: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: "800",
    marginBottom: 6,
    height: 12,
  },
  barTrack: {
    width: "100%",
    height: 140,
    backgroundColor: Colors.secondary,
    borderRadius: 8,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderRadius: 8,
  },
  barDayName: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 8,
  },
  barDateNum: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: "600",
    marginTop: 2,
    opacity: 0.6,
  },

  // ── DAILY AVERAGES ──
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.2,
    marginBottom: 12,
  },
  avgGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 20,
  },
  avgCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  avgValue: {
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  avgLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // ── BEST DAY ──
  bestDayCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  bestDayIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,215,0,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  bestDayTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  bestDaySubtext: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
});
