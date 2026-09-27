import { useFocusEffect, useRouter } from "expo-router";
import {
  Barcode,
  Basket,
  BookOpen,
  ChartBar,
  Gear,
  House,
  MagnifyingGlass,
  Plus,
  Trash,
  User,
} from "@/src/components/icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import CircularProgress from "react-native-circular-progress-indicator";
import { SafeAreaView } from "react-native-safe-area-context";
import { AiEstimateBadge } from "@/src/components/ai/AiEstimateBadge";
import { BeeGuide } from "@/src/components/ai/BeeGuide";
import { useBeeInsight } from "@/src/lib/useBeeInsight";
import { beePoseToSituation } from "@/src/lib/beeCompanion";
import { subscribeFoodLogChanged } from "@/src/lib/foodLogEvents";
import { supabase } from "@/src/lib/supabase";
import { accountDay } from "@/src/lib/accountDay";
import { shiftDay } from "../../supabase/functions/_shared/beeDates";
import { upsertDailySummary, getLocalDateStr } from "@/src/lib/dailySummary";
import { Colors, Radii } from "@/src/styles/colors";
import { DailyTotals, FoodLog } from "@/src/types";
import { useResponsive } from "@/src/hooks/useResponsive";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";

const getDateDistanceInDays = (fromDate: string, toDate: string) => {
  const parseLocalDate = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return Number.NaN;
    return Date.UTC(year, month - 1, day);
  };
  const fromMs = parseLocalDate(fromDate);
  const toMs = parseLocalDate(toDate);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.round((toMs - fromMs) / 86400000));
};

export function DashboardScreen() {
  const { isDesktop } = useResponsive();
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState<DailyTotals>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [goals, setGoals] = useState({ p: 150, c: 200, f: 70 });
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editLogModal, setEditLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  const [editWeightInput, setEditWeightInput] = useState("");
  const [editUnit, setEditUnit] = useState<"g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "serving">("g");
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingLog, setDeletingLog] = useState<{ id: string; name: string } | null>(null);
  const [streak, setStreak] = useState(0);
  const [diaryDay, setDiaryDay] = useState(getLocalDateStr);
  const [, setDaysSinceLastLog] = useState<number | undefined>(undefined);
  const [feedback, setFeedback] = useState<{
    type: SweetFeedbackType;
    title: string;
    message: string;
  } | null>(null);
  const router = useRouter();

  // ── FAB ANIMATIONS ──
  const fabScale   = useRef(new Animated.Value(1)).current;
  const fabRotate  = useRef(new Animated.Value(0)).current;
  const MENU_COUNT = 3;
  const menuAnims  = useRef(
    Array.from({ length: MENU_COUNT }, () => ({
      translateY: new Animated.Value(16),
      opacity:    new Animated.Value(0),
      scale:      new Animated.Value(0.85),
    }))
  ).current;

  // Sync FAB rotation + menu items when menuOpen changes
  useEffect(() => {
    Animated.spring(fabRotate, {
      toValue: menuOpen ? 1 : 0,
      tension: 180,
      friction: 10,
      useNativeDriver: true,
    }).start();

    if (menuOpen) {
      menuAnims.forEach((anim, i) => {
        anim.translateY.setValue(16);
        anim.opacity.setValue(0);
        anim.scale.setValue(0.85);
        Animated.parallel([
          Animated.spring(anim.translateY, { toValue: 0, delay: i * 55, tension: 160, friction: 10, useNativeDriver: true }),
          Animated.timing(anim.opacity,    { toValue: 1, delay: i * 55, duration: 180, useNativeDriver: true }),
          Animated.spring(anim.scale,      { toValue: 1, delay: i * 55, tension: 160, friction: 10, useNativeDriver: true }),
        ]).start();
      });
    } else {
      menuAnims.forEach((anim) => {
        Animated.parallel([
          Animated.timing(anim.opacity,    { toValue: 0, duration: 100, useNativeDriver: true }),
          Animated.timing(anim.translateY, { toValue: 16, duration: 120, useNativeDriver: true }),
        ]).start();
      });
    }
  }, [fabRotate, menuAnims, menuOpen]);

  const handleFabPress = () => {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.82, duration: 65,  useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1,    tension: 220,  friction: 7, useNativeDriver: true }),
    ]).start();
    setMenuOpen((prev) => !prev);
  };

  const calculateStreak = useCallback(async (userId: string, day: ReturnType<typeof accountDay>) => {
    // Use daily_summaries for historical data + check today's food_logs
    const { data: summaries } = await supabase
      .from("daily_summaries")
      .select("date")
      .eq("user_id", userId)
      .gt("meal_count", 0)
      .order("date", { ascending: false });

    // Also check if today has food_logs (might not be in daily_summaries yet)
    const todayStr = day.date;
    const { data: todayLogs } = await supabase
      .from("food_logs")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", day.start)
      .lt("created_at", day.end)
      .limit(1);

    const dates = new Set<string>();
    if (summaries) {
      summaries.forEach((summary) => {
        if (typeof summary.date === "string") dates.add(summary.date);
      });
    }
    if (todayLogs && todayLogs.length > 0) dates.add(todayStr);

    if (dates.size === 0) {
      setStreak(0);
      setDaysSinceLastLog(undefined);
      return;
    }

    const sorted = Array.from(dates).sort().reverse();
    setDaysSinceLastLog(getDateDistanceInDays(sorted[0], todayStr));
    const yesterdayStr = shiftDay(todayStr, -1);

    if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) { setStreak(0); return; }

    let count = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] === shiftDay(sorted[0], -i)) { count++; } else { break; }
    }
    setStreak(count);
  }, []);

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userGoal, error: goalError } = await supabase
      .from("user_goals")
      .select("calorie_target, protein_grams, carbs_grams, fat_grams, time_zone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (goalError) {
      console.error("Unable to load nutrition goals:", goalError);
    }

    if (userGoal?.calorie_target) setCalorieGoal(userGoal.calorie_target);
    if (userGoal) {
      setGoals({
        p: userGoal.protein_grams ?? 150,
        c: userGoal.carbs_grams ?? 200,
        f: userGoal.fat_grams ?? 70,
      });
    }

    const day = accountDay(userGoal?.time_zone);
    setDiaryDay(day.date);

    const { data } = await supabase
      .from("food_logs")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", day.start)
      .lt("created_at", day.end)
      .order("created_at", { ascending: false });

    if (data) {
      setLogs(data as FoodLog[]);
      calculateTotals(data as FoodLog[]);
    }

    await calculateStreak(user.id, day);
    await upsertDailySummary();
    setLoading(false);
  }, [calculateStreak]);

  const handleEditLogStart = (log: FoodLog) => {
    setEditingLog(log);
    const numericWeight = parseFloat(log.serving_size || "0");
    setEditWeightInput(numericWeight ? numericWeight.toString() : "");
    setEditUnit((log.serving_unit as any) || "g");
    setEditLogModal(true);
  };

  const handleSaveLogEdit = async () => {
    if (!editingLog || !editWeightInput) return;
    const newAmount = parseFloat(editWeightInput);
    const oldAmount = parseFloat(editingLog.serving_size || "100");
    const oldUnit = editingLog.serving_unit || "g";
    if (isNaN(newAmount) || newAmount <= 0) {
      setFeedback({
        type: "warning",
        title: "Invalid amount",
        message: "Enter an amount greater than zero.",
      });
      return;
    }

    let ratio = 1;
    if (editUnit === oldUnit || editUnit === "serving" || oldUnit === "serving") {
      ratio = oldAmount > 0 ? newAmount / oldAmount : 1;
    } else {
      const toGrams = (val: number, unit: string) => {
        if (unit === "oz") return val * 28.3495;
        if (unit === "tsp") return val * 4.92892;
        if (unit === "tbsp") return val * 14.7868;
        if (unit === "cup") return val * 236.588;
        return val;
      };
      ratio = toGrams(oldAmount, oldUnit) > 0 ? toGrams(newAmount, editUnit) / toGrams(oldAmount, oldUnit) : 1;
    }

    const updatePayload = {
      serving_size: editWeightInput,
      serving_unit: editUnit,
      calories: Math.round(editingLog.calories * ratio),
      protein: Math.round(editingLog.protein * ratio),
      carbs: Math.round(editingLog.carbs * ratio),
      fat: Math.round(editingLog.fat * ratio),
    };

    const previousLogs = [...logs];
    const updatedLogs = logs.map((l) => l.id === editingLog.id ? { ...l, ...updatePayload } : l);
    setLogs(updatedLogs);
    calculateTotals(updatedLogs);
    setEditLogModal(false);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLogs(previousLogs); calculateTotals(previousLogs); return; }

    // Atomic in-place update (scoped to the owner) instead of delete-then-insert,
    // which could permanently lose the log if the re-insert failed mid-way.
    const { error: updateError } = await supabase
      .from("food_logs")
      .update(updatePayload)
      .eq("id", editingLog.id)
      .eq("user_id", user.id);
    if (updateError) { setLogs(previousLogs); calculateTotals(previousLogs); return; }

    upsertDailySummary();
  };

  const calculateTotals = (data: FoodLog[]) => {
    setTotals(data.reduce(
      (acc, curr) => ({
        calories: acc.calories + (curr.calories || 0),
        protein: acc.protein + (curr.protein || 0),
        carbs: acc.carbs + (curr.carbs || 0),
        fat: acc.fat + (curr.fat || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ));
  };

  const handleDeleteLog = (id: string, name: string) => {
    setDeletingLog({ id, name });
    setDeleteModal(true);
  };

  const confirmDeleteLog = () => {
    if (deletingLog) performDeleteLog(deletingLog.id);
    setDeleteModal(false);
    setDeletingLog(null);
  };

  const performDeleteLog = async (id: string) => {
    const previousLogs = [...logs];
    const updatedLogs = logs.filter((item) => item.id !== id);
    setLogs(updatedLogs);
    calculateTotals(updatedLogs);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLogs(previousLogs); calculateTotals(previousLogs); return; }
    const { error } = await supabase
      .from("food_logs")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) { setLogs(previousLogs); calculateTotals(previousLogs); }
    else upsertDailySummary();
  };

  useFocusEffect(useCallback(() => { fetchData(); setMenuOpen(false); }, [fetchData]));

  useEffect(() => {
    return subscribeFoodLogChanged(() => {
      void fetchData();
    });
  }, [fetchData]);

  const getProgress = (current: number, goal: number) => Math.min((current / goal) * 100, 100);
  const rawDiff = calorieGoal - totals.calories;
  const isOver = rawDiff < 0;
  const displayDiff = Math.abs(Math.round(rawDiff));

  const dateStr = new Date(`${diaryDay}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const insight = useBeeInsight(`${diaryDay}:${totals.calories}:${totals.protein}:${logs.length}:${calorieGoal}`);
  const beeMessage = {title:"Your next step",message:insight?.text ?? "Review your diary, log a food, or record a weigh-in. Tap Bee to ask for help."};
  
  // Format time for logs
  const formatTime = (dateString?: string) => {
    if (!dateString) return "12:00 PM";
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const macros = [
    { id: "protein", l: "Protein", c: Colors.protein, v: totals.protein, g: goals.p },
    { id: "carbs",   l: "Carbs",   c: Colors.carbs,   v: totals.carbs,   g: goals.c },
    { id: "fat",     l: "Fat",     c: Colors.fat,     v: totals.fat,     g: goals.f },
  ];

  const menuItems = [
    { label: "Search Food", icon: <MagnifyingGlass size={20} weight="bold" color={Colors.accent} />, route: "/(tabs)/add" },
    { label: "My Cookbook", icon: <BookOpen size={20} weight="bold" color={Colors.accent} />, route: "/(tabs)/cookbook" },
    { label: "Scan Barcode", icon: <Barcode size={20} weight="bold" color={Colors.accent} />, route: "/scan" },
  ];
  const quickActions = [
    {
      label: "Search",
      helper: "Find foods fast",
      icon: <MagnifyingGlass size={20} weight="bold" color={Colors.accent} />,
      route: "/(tabs)/add",
    },
    {
      label: "Scan",
      helper: "Use barcode",
      icon: <Barcode size={20} weight="bold" color={Colors.accent} />,
      route: "/scan",
    },
    {
      label: "Recent",
      helper: "Repeat food",
      icon: <Basket size={20} weight="bold" color={Colors.accent} />,
      route: "/(tabs)/add",
    },
    {
      label: "Recipe",
      helper: "Log serving",
      icon: <BookOpen size={20} weight="bold" color={Colors.accent} />,
      route: "/create-recipe",
    },
  ];

  const renderQuickActions = () => (
    <View style={styles.quickActionGrid}>
      {quickActions.map((action) => (
        <TouchableOpacity
          key={action.label}
          activeOpacity={0.84}
          accessibilityRole="button"
          accessibilityLabel={`${action.label}: ${action.helper}`}
          style={[
            styles.quickActionCard,
            !isDesktop && styles.quickActionCardMobile,
          ]}
          onPress={() => router.push(action.route as any)}
        >
          <View style={styles.quickActionIcon}>{action.icon}</View>
          <View style={styles.quickActionCopy}>
            <Text style={styles.quickActionLabel}>{action.label}</Text>
            <Text style={styles.quickActionHelper} numberOfLines={1}>
              {action.helper}
            </Text>
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderBeeCompanion = () => (
    <BeeGuide
      compact={!isDesktop}
      interactive
      mascotSize={isDesktop ? "large" : "medium"}
      situation={beePoseToSituation(insight?.suggested_pose ?? "greeting")}
      title={beeMessage.title}
      message={beeMessage.message}
      style={styles.beeCompanionCard}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={isDesktop ? [] : ["top", "left", "right"]}>
      <View style={[styles.contentContainer, isDesktop && { maxWidth: 1280 }]}>


        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={() => router.push("/(tabs)/profile")} style={styles.avatarWrapper}>
              <User size={24} color={Colors.textSecondary} weight="fill" />
              <View style={styles.avatarDot} />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerGreeting}>{(() => {
                const h = new Date().getHours();
                return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
              })()}</Text>
              <Text style={styles.headerTitle}>Ready to fuel up?</Text>
            </View>
          </View>
          {streak > 0 && (
            <Text style={styles.streakText}>
              <Text style={styles.streakCount}>{streak}-day</Text> streak
            </Text>
          )}
        </View>

        {isDesktop ? (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Colors.accent} />}
          >
            {renderBeeCompanion()}
            <View style={{ flexDirection: "row", gap: 24, marginTop: 16 }}>
              {/* Left Column: Stats & Goals */}
              <View style={{ flex: 3 }}>
                {/* ── PREMIUM HERO CARD ── */}
                <View style={styles.heroCard}>
                  <Text style={styles.dateText}>
                    <Text style={styles.dateTextDim}>Today, </Text>{dateStr}
                  </Text>

                  <View style={styles.heroContent}>
                    <View style={styles.heroLeft}>
                      <View style={{ marginBottom: 24 }}>
                        <Text style={styles.heroSmallLabel}>Consumed</Text>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                          <Text style={styles.heroBigValue}>{Math.round(totals.calories)}</Text>
                          <Text style={styles.heroUnit}>kcal</Text>
                        </View>
                      </View>

                      <View style={styles.goalButtonGroup}>
                        <View>
                          <Text style={styles.heroSmallLabel}>Daily target</Text>
                          <View style={styles.goalValueRow}>
                            <Text style={styles.goalValueText}>{calorieGoal}</Text>
                            <Text style={styles.goalUnitText}>kcal</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          accessibilityLabel="View calculated calorie target settings in Profile"
                          accessibilityRole="button"
                          hitSlop={6}
                          onPress={() => router.push("/(tabs)/profile")}
                          style={styles.goalProfileLink}
                        >
                          <Text style={styles.goalHelper}>
                            Calculated from your profile · View
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.heroRight}>
                      <View style={styles.progressRingWrapper}>
                        <CircularProgress
                          value={totals.calories}
                          radius={65}
                          maxValue={calorieGoal}
                          showProgressValue={false}
                          activeStrokeColor={isOver ? Colors.error : Colors.accent}
                          activeStrokeWidth={9}
                          inActiveStrokeColor={Colors.border}
                          inActiveStrokeWidth={9}
                          inActiveStrokeOpacity={1}
                          title={""}
                        />
                        <View style={styles.ringInner}>
                          <Text style={[styles.ringValue, { color: isOver ? Colors.error : Colors.text }]}>
                            {displayDiff}
                          </Text>
                          <Text style={styles.ringLabel}>{isOver ? "kcal over" : "kcal left"}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>

                {renderQuickActions()}

                {/* ── DETAILED MACRO BENTO GRID ── */}
                <View style={styles.macroRow}>
                  {macros.map((m, i) => {
                    const percent = getProgress(m.v, m.g);
                    return (
                      <View key={m.id} style={[styles.macroCell, i > 0 && styles.macroCellDivider]}>
                        <Text style={styles.macroLabel}>{m.l}</Text>
                        <Text style={styles.macroValue}>
                          {Math.round(m.v)}
                          <Text style={styles.macroGoal}> / {m.g} g</Text>
                        </Text>
                        <View style={styles.macroTrack}>
                          <View style={[styles.macroFill, { width: `${percent}%` as any, backgroundColor: m.v > m.g ? Colors.error : m.c }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Right Column: Timeline / Logs list */}
              <View style={{ flex: 2 }}>
                {/* ── TIMELINE HEADER ── */}
                <View style={styles.timelineHeader}>
                  <Text style={styles.timelineTitle}>Today&apos;s log</Text>
                  <Text style={styles.itemCountText}>{logs.length} items</Text>
                </View>

                {logs.length > 0 ? (
                  logs.map((item, index) => (
                    <View key={item.id || index} style={styles.timelineItemRow}>
                      {/* Timeline Connector */}
                      <View style={styles.timelineColumn}>
                        <Text style={styles.timelineTime}>{formatTime(item.created_at)}</Text>
                        <View style={styles.timelineDot} />
                        {index !== logs.length - 1 && <View style={styles.timelineLine} />}
                      </View>
                      
                      {/* Log Card */}
                      <TouchableOpacity style={styles.logCard} onPress={() => handleEditLogStart(item)}>
                        <View style={styles.logContent}>
                          <Text style={styles.logName} numberOfLines={2}>{item.name}</Text>
                          <View style={styles.logSubRow}>
                            {item.ai_estimated && (
                              <AiEstimateBadge source="ai_estimate" compact />
                            )}
                            <View style={styles.servingBadge}>
                              <Text style={styles.servingText}>{item.serving_size} {item.serving_unit || "g"}</Text>
                            </View>
                            <Text style={styles.logMacros}>
                              <Text style={{ color: Colors.protein }}>P:{Math.round(item.protein)} </Text>
                              <Text style={{ color: Colors.carbs }}>C:{Math.round(item.carbs)} </Text>
                              <Text style={{ color: Colors.fat }}>F:{Math.round(item.fat)}</Text>
                            </Text>
                          </View>
                        </View>

                        <View style={styles.logCaloriesCol}>
                          <Text style={styles.logCalories}>{Math.round(item.calories)}</Text>
                          <Text style={styles.logKcal}>kcal</Text>
                        </View>

                        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteLog(item.id!, item.name)}>
                          <Trash size={16} color={Colors.error} weight="bold" />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    </View>
                  ))
                ) : (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIconBox}>
                      <Basket size={32} color={Colors.textSecondary} weight="duotone" />
                    </View>
                    <Text style={styles.emptyTitle}>Plate is empty</Text>
                    <Text style={styles.emptySubtext}>Your logged meals will appear here in a timeline.</Text>
                  </View>
                )}
              </View>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            data={logs}
            keyExtractor={(item) => item.id || Math.random().toString()}
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Colors.accent} />}
            contentContainerStyle={{ paddingBottom: 160 }}
            ListHeaderComponent={
              <>
                {renderBeeCompanion()}

                {/* ── PREMIUM HERO CARD ── */}
                <View style={styles.heroCard}>
                  <Text style={styles.dateText}>
                    <Text style={styles.dateTextDim}>Today, </Text>{dateStr}
                  </Text>

                  <View style={styles.heroContent}>
                    <View style={styles.heroLeft}>
                      <View style={{ marginBottom: 24 }}>
                        <Text style={styles.heroSmallLabel}>Consumed</Text>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                          <Text style={styles.heroBigValue}>{Math.round(totals.calories)}</Text>
                          <Text style={styles.heroUnit}>kcal</Text>
                        </View>
                      </View>

                      <View style={styles.goalButtonGroup}>
                        <View>
                          <Text style={styles.heroSmallLabel}>Daily target</Text>
                          <View style={styles.goalValueRow}>
                            <Text style={styles.goalValueText}>{calorieGoal}</Text>
                            <Text style={styles.goalUnitText}>kcal</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          accessibilityLabel="View calculated calorie target settings in Profile"
                          accessibilityRole="button"
                          hitSlop={6}
                          onPress={() => router.push("/(tabs)/profile")}
                          style={styles.goalProfileLink}
                        >
                          <Text style={styles.goalHelper}>
                            Calculated from your profile · View
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.heroRight}>
                      <View style={styles.progressRingWrapper}>
                        <CircularProgress
                          value={totals.calories}
                          radius={65}
                          maxValue={calorieGoal}
                          showProgressValue={false}
                          activeStrokeColor={isOver ? Colors.error : Colors.accent}
                          activeStrokeWidth={9}
                          inActiveStrokeColor={Colors.border}
                          inActiveStrokeWidth={9}
                          inActiveStrokeOpacity={1}
                          title={""}
                        />
                        <View style={styles.ringInner}>
                          <Text style={[styles.ringValue, { color: isOver ? Colors.error : Colors.text }]}>
                            {displayDiff}
                          </Text>
                          <Text style={styles.ringLabel}>{isOver ? "kcal over" : "kcal left"}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </View>

                {/* ── DETAILED MACRO BENTO GRID ── */}
                {renderQuickActions()}

                <View style={styles.macroRow}>
                  {macros.map((m, i) => {
                    const percent = getProgress(m.v, m.g);
                    return (
                      <View key={m.id} style={[styles.macroCell, i > 0 && styles.macroCellDivider]}>
                        <Text style={styles.macroLabel}>{m.l}</Text>
                        <Text style={styles.macroValue}>
                          {Math.round(m.v)}
                          <Text style={styles.macroGoal}> / {m.g} g</Text>
                        </Text>
                        <View style={styles.macroTrack}>
                          <View style={[styles.macroFill, { width: `${percent}%` as any, backgroundColor: m.v > m.g ? Colors.error : m.c }]} />
                        </View>
                      </View>
                    );
                  })}
                </View>

                {/* ── TIMELINE HEADER ── */}
                <View style={styles.timelineHeader}>
                  <Text style={styles.timelineTitle}>Today&apos;s log</Text>
                  <Text style={styles.itemCountText}>{logs.length} items</Text>
                </View>
              </>
            }
            renderItem={({ item, index }) => (
              <View style={styles.timelineItemRow}>
                {/* Timeline Connector */}
                <View style={styles.timelineColumn}>
                  <Text style={styles.timelineTime}>{formatTime(item.created_at)}</Text>
                  <View style={styles.timelineDot} />
                  {index !== logs.length - 1 && <View style={styles.timelineLine} />}
                </View>
                
                {/* Log Card */}
                <TouchableOpacity style={styles.logCard} onPress={() => handleEditLogStart(item)}>
                  <View style={styles.logContent}>
                    <Text style={styles.logName} numberOfLines={2}>{item.name}</Text>
                    <View style={styles.logSubRow}>
                      {item.ai_estimated && (
                        <AiEstimateBadge source="ai_estimate" compact />
                      )}
                      <View style={styles.servingBadge}>
                        <Text style={styles.servingText}>{item.serving_size} {item.serving_unit || "g"}</Text>
                      </View>
                      <Text style={styles.logMacros}>
                        <Text style={{ color: Colors.protein }}>P:{Math.round(item.protein)} </Text>
                        <Text style={{ color: Colors.carbs }}>C:{Math.round(item.carbs)} </Text>
                        <Text style={{ color: Colors.fat }}>F:{Math.round(item.fat)}</Text>
                      </Text>
                    </View>
                  </View>

                  <View style={styles.logCaloriesCol}>
                    <Text style={styles.logCalories}>{Math.round(item.calories)}</Text>
                    <Text style={styles.logKcal}>kcal</Text>
                  </View>

                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteLog(item.id!, item.name)}>
                    <Trash size={16} color={Colors.error} weight="bold" />
                  </TouchableOpacity>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <View style={styles.emptyIconBox}>
                  <Basket size={32} color={Colors.textSecondary} weight="duotone" />
                </View>
                <Text style={styles.emptyTitle}>Plate is empty</Text>
                <Text style={styles.emptySubtext}>Your logged meals will appear here in a timeline.</Text>
              </View>
            }
          />
        )}

        {/* ── BOTTOM NAV BAR ── */}
        {!isDesktop && (
          <View style={styles.bottomBar}>
            <View style={styles.bottomBarInner}>
              <TouchableOpacity style={styles.navItem}>
                <House size={24} color={Colors.accent} weight="fill" />
                <Text style={[styles.navLabel, { color: Colors.accent }]}>Home</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.navItem} onPress={() => router.push("/(tabs)/stats")}>
                <ChartBar size={24} color={Colors.textSecondary} />
                <Text style={styles.navLabel}>Stats</Text>
              </TouchableOpacity>

              {/* Spacer for FAB */}
              <View style={{ width: 64 }} />

              <TouchableOpacity style={styles.navItem} onPress={() => router.push("/(tabs)/cookbook")}>
                <BookOpen size={24} color={Colors.textSecondary} />
                <Text style={styles.navLabel}>Cookbook</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.navItem} onPress={() => router.push("/(tabs)/profile")}>
                <Gear size={24} color={Colors.textSecondary} />
                <Text style={styles.navLabel}>Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── FAB BACKDROP (covers screen but NOT menu) ── */}
        {!isDesktop && menuOpen && (
          <TouchableOpacity style={styles.fabBackdrop} onPress={() => setMenuOpen(false)} activeOpacity={1} />
        )}

        {/* ── FAB POPUP MENU (highest z) ── */}
        {!isDesktop && (
          <View style={styles.menuContainer} pointerEvents="box-none">
            {menuItems.map((item, i) => (
              <Animated.View
                key={item.label}
                style={{
                  opacity: menuAnims[i].opacity,
                  transform: [{ translateY: menuAnims[i].translateY }, { scale: menuAnims[i].scale }],
                }}
                pointerEvents={menuOpen ? "auto" : "none"}
              >
                <TouchableOpacity style={styles.menuItemBtn} onPress={() => { setMenuOpen(false); router.push(item.route as any); }}>
                  <View style={styles.menuIconBg}>{item.icon}</View>
                  <Text style={styles.menuItemText}>{item.label}</Text>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>
        )}

        {/* ── CENTER FAB BUTTON ── */}
        {!isDesktop && (
          <Animated.View style={[styles.fabFixed, { transform: [{ scale: fabScale }] }]}>
            <TouchableOpacity
              style={[styles.mainFab, menuOpen && styles.mainFabActive]}
              onPress={handleFabPress}
              activeOpacity={1}
            >
              <Animated.View style={{ transform: [{ rotate: fabRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "135deg"] }) }] }}>
                <Plus size={28} color={menuOpen ? Colors.accent : "#000"} weight="bold" />
              </Animated.View>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* ── DELETE CONFIRMATION MODAL ── */}
        <Modal visible={deleteModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => { setDeleteModal(false); setDeletingLog(null); }} />
            <View style={styles.glassModal}>
              <View style={styles.modalDrag} />
              <View style={styles.deleteModalIcon}>
                <Trash size={32} color={Colors.error} weight="fill" />
              </View>
              <Text style={styles.modalTitle}>Remove Entry</Text>
              <Text style={styles.modalSubtitle}>Are you sure you want to remove &quot;{deletingLog?.name}&quot;?</Text>
              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.btnCancel} onPress={() => { setDeleteModal(false); setDeletingLog(null); }}>
                  <Text style={styles.btnCancelText}>Keep it</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnDelete} onPress={confirmDeleteLog}>
                  <Trash size={18} color={Colors.white} weight="bold" />
                  <Text style={styles.btnDeleteText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={editLogModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setEditLogModal(false)} />
            <View style={styles.glassModal}>
              <View style={styles.modalDrag} />
              <Text style={styles.modalTitle}>Edit Portion</Text>
              <Text style={styles.modalAccentSubtitle} numberOfLines={1}>{editingLog?.name}</Text>
              
              <View style={styles.editInputWrapper}>
                <TextInput
                  style={styles.editInputBox}
                  keyboardType="numeric"
                  value={editWeightInput}
                  onChangeText={(t) => setEditWeightInput(t.replace(/[^0-9.]/g, ""))}
                  autoFocus
                  selectTextOnFocus
                />
              </View>

              <View style={styles.unitGrid}>
                {["g", "ml", "oz", "tsp", "tbsp", "cup", "serving"].map((u) => (
                  <TouchableOpacity
                    key={u}
                    onPress={() => setEditUnit(u as any)}
                    style={[styles.unitPill, editUnit === u && styles.unitPillActive]}
                  >
                    <Text style={[styles.unitPillText, editUnit === u && styles.unitPillTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.btnCancel} onPress={() => setEditLogModal(false)}>
                  <Text style={styles.btnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSave} onPress={handleSaveLogEdit}>
                  <Text style={styles.btnSaveText}>Save Changes</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <SweetFeedback
          visible={feedback !== null}
          type={feedback?.type}
          title={feedback?.title ?? ""}
          message={feedback?.message}
          onClose={() => setFeedback(null)}
        />

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    maxWidth: 480,
    alignSelf: "center",
    width: "100%",
  },
  


  // ── HEADER ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 32,
    paddingBottom: 16,
    zIndex: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarWrapper: {
    width: 48, height: 48,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 2, borderColor: Colors.surface,
    alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  avatarDot: {
    position: "absolute", bottom: -2, right: -2,
    width: 14, height: 14,
    borderRadius: 7,
    backgroundColor: Colors.accent,
    borderWidth: 2, borderColor: Colors.secondary,
  },
  headerGreeting: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 2,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "600",
    letterSpacing: -0.3,
  },
  streakText: { color: Colors.textSecondary, fontSize: 13 },
  streakCount: { color: Colors.accent, fontWeight: "600" },

  // ── BEE COMPANION ──
  beeCompanionCard: {
    marginTop: 4,
    marginBottom: 16,
    padding: 14,
    borderRadius: Radii.card,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  // ── HERO CARD ──
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radii.card,
    padding: 20,
    borderWidth: 1, borderColor: Colors.border,
    marginTop: 16, marginBottom: 14,
  },
  dateText: { color: Colors.text, fontSize: 15, fontWeight: "600", letterSpacing: -0.2 },
  dateTextDim: { color: Colors.textSecondary, fontWeight: "400" },
  heroContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20 },
  heroLeft: { flex: 1, justifyContent: "center" },
  heroSmallLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "500" },
  heroBigValue: { color: Colors.text, fontSize: 42, fontWeight: "600", letterSpacing: -1, fontVariant: ["tabular-nums"] },
  heroUnit: { color: Colors.textSecondary, fontSize: 14, fontWeight: "400" },
  goalButtonGroup: { width: '100%' },
  goalProfileLink: {
    alignSelf: "flex-start",
    minHeight: 28,
    justifyContent: "center",
  },
  goalHelper: {
    color: Colors.accent,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  goalValueRow: { flexDirection: "row", alignItems: "baseline", gap: 4, alignSelf: "flex-start", marginTop: 2 },
  goalValueText: { color: Colors.text, fontSize: 19, fontWeight: "600", letterSpacing: -0.3, fontVariant: ["tabular-nums"] },
  goalUnitText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "400" },

  heroRight: { width: 130, height: 130, alignItems: "center", justifyContent: "center", position: "relative" },
  progressRingWrapper: { alignItems: "center", justifyContent: "center" },
  ringInner: { position: "absolute", alignItems: "center", justifyContent: "center" },

  ringValue: { fontSize: 24, fontWeight: "600", letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  ringLabel: { fontSize: 11, fontWeight: "500", color: Colors.textSecondary, marginTop: 2 },

  // ── QUICK ACTIONS ──
  quickActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 20,
  },
  quickActionCard: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 132,
    minHeight: 74,
    backgroundColor: Colors.surface,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  quickActionCardMobile: {
    flexBasis: "44%",
  },
  quickActionIcon: {
    width: 38,
    height: 38,
    borderRadius: Radii.inner,
    backgroundColor: Colors.accentDim,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  quickActionCopy: {
    flex: 1,
    minWidth: 0,
  },
  quickActionLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  quickActionHelper: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "400",
    marginTop: 3,
  },

  // ── MACRO ROW ──
  macroRow: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radii.card,
    overflow: "hidden",
    marginBottom: 24,
  },
  macroCell: { flex: 1, paddingVertical: 14, paddingHorizontal: 14 },
  macroCellDivider: { borderLeftWidth: 1, borderLeftColor: Colors.border },
  macroLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "500" },
  macroValue: { color: Colors.text, fontSize: 18, fontWeight: "600", marginTop: 3, marginBottom: 10, fontVariant: ["tabular-nums"] },
  macroGoal: { color: Colors.textSecondary, fontSize: 11, fontWeight: "400" },
  macroTrack: { height: 3, backgroundColor: Colors.border, borderRadius: 2, overflow: "hidden" },
  macroFill: { height: "100%", borderRadius: 2 },

  // ── TIMELINE ──
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  timelineTitle: { color: Colors.text, fontSize: 16, fontWeight: "600", letterSpacing: -0.2 },
  itemCountText: { color: Colors.textSecondary, fontSize: 13 },

  timelineItemRow: { flexDirection: "row", width: "100%" },
  timelineColumn: { width: 52, alignItems: "center", paddingTop: 16, position: "relative" },
  timelineTime: { fontSize: 11, fontWeight: "500", color: Colors.textSecondary, marginBottom: 8 },
  timelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  timelineLine: { position: "absolute", top: 44, bottom: -12, left: "50%", width: 1, backgroundColor: Colors.borderLight },

  logCard: {
    flex: 1,
    paddingVertical: 13, paddingRight: 4,
    flexDirection: "row", alignItems: "center",
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  logContent: { flex: 1, marginRight: 12 },
  logName: { color: Colors.text, fontSize: 14.5, fontWeight: "600", letterSpacing: -0.1, marginBottom: 3 },
  logSubRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  servingBadge: { backgroundColor: Colors.secondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  servingText: { color: Colors.textSecondary, fontSize: 11, fontWeight: "500" },
  logMacros: { fontSize: 12, fontWeight: "500", fontVariant: ["tabular-nums"] },

  logCaloriesCol: { alignItems: "flex-end", paddingLeft: 12 },
  logCalories: { fontSize: 15, fontWeight: "600", color: Colors.text, letterSpacing: -0.2, lineHeight: 18, fontVariant: ["tabular-nums"] },
  logKcal: { fontSize: 11, fontWeight: "400", color: Colors.textSecondary, marginTop: 2 },

  deleteBtn: { padding: 8, borderRadius: Radii.inner, marginLeft: 4 },

  emptyState: { backgroundColor: Colors.surface, borderRadius: Radii.card, padding: 32, borderWidth: 1, borderColor: Colors.border, borderStyle: "dashed", alignItems: "center", marginTop: 16 },
  emptyIconBox: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: "600", marginBottom: 4 },
  emptySubtext: { color: Colors.textSecondary, fontSize: 13, textAlign: "center" },

  // ── BOTTOM NAV ──
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    zIndex: 30,
  },
  bottomBarInner: {
    backgroundColor: "rgba(14, 13, 11, 0.97)",
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    borderTopLeftRadius: Radii.card,
    borderTopRightRadius: Radii.card,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  navItem: { flex: 1, alignItems: "center", gap: 4 },
  navLabel: { fontSize: 11, fontWeight: "500", color: Colors.textSecondary },

  // ── FAB & MENU ──
  fabBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 40 },
  menuContainer: { position: "absolute", bottom: 130, alignSelf: "center", width: 200, gap: 10, zIndex: 60 },
  menuItemBtn: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, padding: 10, borderRadius: Radii.card, borderWidth: 1, borderColor: Colors.border, elevation: 2 },
  menuIconBg: { width: 40, height: 40, borderRadius: Radii.inner, backgroundColor: Colors.accentDim, alignItems: "center", justifyContent: "center", marginRight: 12 },
  menuItemText: { color: Colors.text, fontSize: 14, fontWeight: "500" },
  fabFixed: { position: "absolute", bottom: 48, alignSelf: "center", width: 62, height: 62, borderRadius: 31, zIndex: 50 },
  mainFab: { width: 62, height: 62, borderRadius: 31, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center", elevation: 2, borderWidth: 4, borderColor: Colors.primary },
  mainFabActive: { backgroundColor: Colors.surface, borderColor: Colors.border },

  // ── MODALS ──
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  glassModal: { width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 48 },
  modalDrag: { width: 40, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: "center", marginBottom: 24 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: "600", textAlign: "center", marginBottom: 4, letterSpacing: -0.3 },
  modalSubtitle: { color: Colors.textSecondary, fontSize: 14, textAlign: "center", marginBottom: 28 },
  modalAccentSubtitle: { color: Colors.accent, fontSize: 14, fontWeight: "500", textAlign: "center", marginBottom: 24 },

  editInputWrapper: { alignItems: "center", marginBottom: 28 },
  editInputBox: { backgroundColor: Colors.inputBg, color: Colors.text, fontSize: 32, fontWeight: "600", padding: 16, borderRadius: Radii.card, textAlign: "center", width: 140, borderWidth: 1, borderColor: Colors.border, fontVariant: ["tabular-nums"] },

  unitGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 28 },
  unitPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radii.inner, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.inputBg },
  unitPillActive: { backgroundColor: Colors.accentGlow, borderColor: Colors.accent },
  unitPillText: { fontSize: 13, fontWeight: "500", color: Colors.textSecondary },
  unitPillTextActive: { color: Colors.accent, fontWeight: "600" },

  modalBtnRow: { flexDirection: "row", gap: 12 },
  btnCancel: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, paddingVertical: 16, borderRadius: Radii.inner, alignItems: "center" },
  btnCancelText: { color: Colors.text, fontSize: 15, fontWeight: "600" },
  btnSave: { flex: 1, backgroundColor: Colors.accent, paddingVertical: 16, borderRadius: Radii.inner, alignItems: "center" },
  btnSaveText: { color: Colors.textOnAccent, fontSize: 15, fontWeight: "600" },

  deleteModalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: `${Colors.error}26`, alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16 },
  btnDelete: { flex: 1, backgroundColor: Colors.error, paddingVertical: 16, borderRadius: Radii.inner, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, elevation: 2 },
  btnDeleteText: { color: Colors.white, fontSize: 15, fontWeight: "600" },
});
