import { useFocusEffect, useRouter } from "expo-router";
import {
  Barcode,
  Basket,
  BookOpen,
  BowlFood,
  CalendarBlank,
  ChartBar,
  Cookie,
  Drop,
  Egg,
  Fire,
  Gear,
  Grains,
  House,
  Leaf,
  Lightning,
  MagnifyingGlass,
  PencilSimple,
  PintGlass,
  Plus,
  Trash,
  User,
  X,
} from "phosphor-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import CircularProgress from "react-native-circular-progress-indicator";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/src/lib/supabase";
import { upsertDailySummary, getLocalDateStr } from "@/src/lib/dailySummary";
import { Colors } from "@/src/styles/colors";
import { DailyTotals, FoodLog } from "@/src/types";

export function DashboardScreen() {
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState<DailyTotals>({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [goals, setGoals] = useState({ p: 150, c: 200, f: 70 });
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editGoalModal, setEditGoalModal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState("");
  const [editLogModal, setEditLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  const [editWeightInput, setEditWeightInput] = useState("");
  const [editUnit, setEditUnit] = useState<"g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "serving">("g");
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingLog, setDeletingLog] = useState<{ id: string; name: string } | null>(null);
  const [streak, setStreak] = useState(0);
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
  }, [menuOpen]);

  const handleFabPress = () => {
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.82, duration: 65,  useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1,    tension: 220,  friction: 7, useNativeDriver: true }),
    ]).start();
    setMenuOpen((prev) => !prev);
  };

  const calculateStreak = async (userId: string) => {
    // Use daily_summaries for historical data + check today's food_logs
    const { data: summaries } = await supabase
      .from("daily_summaries")
      .select("date")
      .eq("user_id", userId)
      .gt("meal_count", 0)
      .order("date", { ascending: false });

    // Also check if today has food_logs (might not be in daily_summaries yet)
    const todayStr = getLocalDateStr();
    const { data: todayLogs } = await supabase
      .from("food_logs")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    const dates = new Set<string>();
    if (summaries) summaries.forEach((s) => dates.add(s.date));
    if (todayLogs && todayLogs.length > 0) dates.add(todayStr);

    if (dates.size === 0) { setStreak(0); return; }

    const sorted = Array.from(dates).sort().reverse();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = getLocalDateStr(yesterday);

    if (sorted[0] !== todayStr && sorted[0] !== yesterdayStr) { setStreak(0); return; }

    let count = 0;
    const checkDate = new Date(sorted[0]);
    for (let i = 0; i < sorted.length; i++) {
      const expected = new Date(checkDate);
      expected.setDate(expected.getDate() - i);
      if (sorted[i] === getLocalDateStr(expected)) { count++; } else { break; }
    }
    setStreak(count);
  };

  const fetchData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: userGoal } = await supabase
      .from("user_goals")
      .select("calorie_target, protein_grams, carbs_grams, fat_grams")
      .eq("user_id", user.id)
      .maybeSingle();

    if (userGoal?.calorie_target) setCalorieGoal(userGoal.calorie_target);
    if (userGoal) {
      setGoals({
        p: userGoal.protein_grams || 150,
        c: userGoal.carbs_grams || 200,
        f: userGoal.fat_grams || 70,
      });
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from("food_logs")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", todayStart.toISOString())
      .order("created_at", { ascending: false });

    if (data) {
      setLogs(data as FoodLog[]);
      calculateTotals(data as FoodLog[]);
    }

    await calculateStreak(user.id);
    await upsertDailySummary();
    setLoading(false);
  };

  const handleSaveGoal = async () => {
    const val = parseInt(newGoalInput);
    if (!val || val < 500) return alert("Please enter a valid calorie goal.");
    setCalorieGoal(val);
    setEditGoalModal(false);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: currentGoals } = await supabase
      .from("user_goals")
      .select("protein_ratio, carbs_ratio, fat_ratio")
      .eq("user_id", user.id)
      .maybeSingle();

    let proteinGrams = 150, carbsGrams = 200, fatGrams = 70;
    if (currentGoals) {
      const pR = currentGoals.protein_ratio || 30;
      const cR = currentGoals.carbs_ratio || 35;
      const fR = currentGoals.fat_ratio || 35;
      proteinGrams = Math.round((val * pR) / 100 / 4);
      carbsGrams = Math.round((val * cR) / 100 / 4);
      fatGrams = Math.round((val * fR) / 100 / 9);
      setGoals({ p: proteinGrams, c: carbsGrams, f: fatGrams });
    }

    const { data: existing } = await supabase.from("user_goals").select("id").eq("user_id", user.id).maybeSingle();
    const updates = { user_id: user.id, calorie_target: val, protein_grams: proteinGrams, carbs_grams: carbsGrams, fat_grams: fatGrams };
    if (existing) {
      await supabase.from("user_goals").update(updates).eq("user_id", user.id);
    } else {
      await supabase.from("user_goals").insert([updates]);
    }
  };

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
    if (isNaN(newAmount) || newAmount <= 0) return alert("Invalid amount");

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
    if (!user) return;

    const { error: delError } = await supabase.from("food_logs").delete().eq("id", editingLog.id);
    if (delError) { setLogs(previousLogs); calculateTotals(previousLogs); return; }

    const { error: insError } = await supabase.from("food_logs").insert([{
      user_id: user.id, name: editingLog.name, barcode: editingLog.barcode || null, ...updatePayload,
    }]);
    if (insError) fetchData();
    else upsertDailySummary();
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
    const { error } = await supabase.from("food_logs").delete().eq("id", id);
    if (error) { setLogs(previousLogs); calculateTotals(previousLogs); }
    else upsertDailySummary();
  };

  useFocusEffect(useCallback(() => { fetchData(); setMenuOpen(false); }, []));

  const getProgress = (current: number, goal: number) => Math.min((current / goal) * 100, 100);
  const rawDiff = calorieGoal - totals.calories;
  const isOver = rawDiff < 0;
  const displayDiff = Math.abs(Math.round(rawDiff));

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  
  // Format time for logs
  const formatTime = (dateString?: string) => {
    if (!dateString) return "12:00 PM";
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const macros = [
    { id: "protein", l: "Protein", c: Colors.protein, v: totals.protein, g: goals.p, icon: <Egg weight="fill" color={Colors.protein} size={18} /> },
    { id: "carbs",   l: "Carbs",   c: Colors.carbs,   v: totals.carbs,   g: goals.c, icon: <Grains weight="fill" color={Colors.carbs} size={18} /> },
    { id: "fat",     l: "Fat",     c: Colors.fat,     v: totals.fat,     g: goals.f, icon: <Drop weight="fill" color={Colors.fat} size={18} /> },
  ];

  const menuItems = [
    { label: "Search Food", icon: <MagnifyingGlass size={20} weight="bold" color={Colors.accent} />, route: "/(tabs)/add" },
    { label: "My Cookbook", icon: <BookOpen size={20} weight="bold" color={Colors.accent} />, route: "/(tabs)/cookbook" },
    { label: "Scan Barcode", icon: <Barcode size={20} weight="bold" color={Colors.accent} />, route: "/scan" },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.contentContainer}>


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
          <TouchableOpacity style={styles.fireBtn}>
            <Fire size={18} weight="fill" color="#FF6B35" />
            <View style={styles.fireBadge}>
              <Text style={styles.fireBadgeText}>{streak}</Text>
            </View>
          </TouchableOpacity>
        </View>

        <FlatList
          data={logs}
          keyExtractor={(item) => item.id || Math.random().toString()}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Colors.accent} />}
          contentContainerStyle={{ paddingBottom: 160 }}
          ListHeaderComponent={
            <>
              {/* ── PREMIUM HERO CARD ── */}
              <View style={styles.heroCard}>
                <View style={styles.datePill}>
                  <CalendarBlank size={14} color={Colors.accent} weight="fill" />
                  <Text style={styles.datePillText}>
                    <Text style={{ opacity: 0.8, fontWeight: "400" }}>Today, </Text>{dateStr}
                  </Text>
                </View>

                <View style={styles.heroContent}>
                  <View style={styles.heroLeft}>
                    <View style={{ marginBottom: 24 }}>
                      <Text style={styles.heroSmallLabel}>CONSUMED</Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                        <Text style={styles.heroBigValue}>{Math.round(totals.calories)}</Text>
                        <Text style={styles.heroUnit}>kcal</Text>
                      </View>
                    </View>

                    <TouchableOpacity onPress={() => { setNewGoalInput(calorieGoal.toString()); setEditGoalModal(true); }} style={styles.goalButtonGroup}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.8 }}>
                        <Text style={styles.heroSmallLabel}>DAILY TARGET</Text>
                        <PencilSimple size={12} color={Colors.accent} weight="fill" />
                      </View>
                      <View style={styles.goalValueRow}>
                        <Text style={styles.goalValueText}>{calorieGoal}</Text>
                        <Text style={styles.goalUnitText}>kcal</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.heroRight}>
                    <View style={styles.progressRingWrapper}>
                      <CircularProgress
                        value={totals.calories}
                        radius={65}
                        maxValue={calorieGoal}
                        showProgressValue={false}
                        activeStrokeColor={isOver ? Colors.error : Colors.accent}
                        activeStrokeWidth={12}
                        inActiveStrokeColor={Colors.border}
                        inActiveStrokeWidth={12}
                        inActiveStrokeOpacity={1}
                        title={""}
                      />
                      <View style={styles.ringInner}>
                        <Lightning size={24} color="#FFD700" weight="fill" />
                        <Text style={[styles.ringValue, { color: isOver ? Colors.error : Colors.text }]}>
                          {displayDiff}
                        </Text>
                        <Text style={styles.ringLabel}>{isOver ? "OVER" : "LEFT"}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              {/* ── DETAILED MACRO BENTO GRID ── */}
              <View style={styles.bentoGrid}>
                {macros.map((m) => {
                  const percent = getProgress(m.v, m.g);
                  return (
                    <View key={m.id} style={styles.bentoCard}>
                      <View style={[styles.bentoGlow, { backgroundColor: m.c }]} />
                      
                      <View style={styles.bentoTop}>
                        <View style={[styles.macroIconWrap, { backgroundColor: `${m.c}33` }]}>
                          {m.icon}
                        </View>
                        <Text style={styles.bentoLabel}>{m.l}</Text>
                      </View>
                      
                      <View style={styles.bentoBottom}>
                        <View style={styles.bentoValueRow}>
                          <Text style={styles.bentoValue}>{Math.round(m.v)}</Text>
                          <Text style={styles.bentoGoal}>/{m.g}g</Text>
                        </View>
                        <View style={styles.bentoTrack}>
                          <View style={[styles.bentoFill, { width: `${percent}%` as any, backgroundColor: m.v > m.g ? Colors.error : m.c }]} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>

              {/* ── TIMELINE HEADER ── */}
              <View style={styles.timelineHeader}>
                <Text style={styles.timelineTitle}>Today's Log</Text>
                <View style={styles.itemCountBadge}>
                  <Text style={styles.itemCountText}>{logs.length} items</Text>
                </View>
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
                <View style={[styles.logIconBox, { backgroundColor: `${Colors.accent}33` }]}>
                  <BowlFood size={24} color={Colors.accent} weight="fill" />
                </View>
                
                <View style={styles.logContent}>
                  <Text style={styles.logName} numberOfLines={1}>{item.name}</Text>
                  <View style={styles.logSubRow}>
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
                  <Text style={styles.logKcal}>KCAL</Text>
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

        {/* ── BOTTOM NAV BAR ── */}
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

        {/* ── FAB BACKDROP (covers screen but NOT menu) ── */}
        {menuOpen && (
          <TouchableOpacity style={styles.fabBackdrop} onPress={() => setMenuOpen(false)} activeOpacity={1} />
        )}

        {/* ── FAB POPUP MENU (highest z) ── */}
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

        {/* ── CENTER FAB BUTTON ── */}
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
              <Text style={styles.modalSubtitle}>Are you sure you want to remove "{deletingLog?.name}"?</Text>
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

        {/* ── MODALS (Adapted to match glass-modal look) ── */}
        <Modal visible={editGoalModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setEditGoalModal(false)} />
            <View style={styles.glassModal}>
              <View style={styles.modalDrag} />
              <Text style={styles.modalTitle}>Set Daily Goal</Text>
              <Text style={styles.modalSubtitle}>Adjust your calorie target for the day</Text>
              
              <View style={styles.modalInputWrap}>
                <TextInput
                  style={styles.modalInputBig}
                  keyboardType="numeric"
                  value={newGoalInput}
                  onChangeText={(t) => setNewGoalInput(t.replace(/[^0-9]/g, ""))}
                  autoFocus
                />
                <View style={styles.modalInputDivider}>
                  <View style={styles.modalInputDividerActive} />
                </View>
                <Text style={styles.modalInputUnit}>KCAL</Text>
              </View>

              <View style={styles.modalBtnRow}>
                <TouchableOpacity style={styles.btnCancel} onPress={() => setEditGoalModal(false)}>
                  <Text style={styles.btnCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnSave} onPress={handleSaveGoal}>
                  <Text style={styles.btnSaveText}>Update Target</Text>
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
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  fireBtn: {
    width: 40, height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderLight,
    alignItems: "center", justifyContent: "center",
    position: "relative",
  },
  fireBadge: {
    position: "absolute", top: -4, right: -4,
    backgroundColor: Colors.accent,
    width: 16, height: 16,
    borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    shadowColor: Colors.accent, shadowOffset: { width:0, height:0 }, shadowOpacity: 0.8, shadowRadius: 6, elevation: 4,
  },
  fireBadgeText: { color: "#000", fontSize: 10, fontWeight: "900" },

  // ── PREMIUM HERO CARD ──
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 32,
    padding: 24,
    borderWidth: 1, borderColor: Colors.borderLight,
    shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.6, shadowRadius: 30, elevation: 15,
    marginTop: 16, marginBottom: 20,
    position: "relative", overflow: "hidden",
  },
  datePill: {
    position: "absolute", top: 16, left: 16,
    backgroundColor: "rgba(0,0,0,0.4)",
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  datePillText: { color: Colors.text, fontSize: 12, fontWeight: "600", letterSpacing: 0.5 },
  heroContent: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 28 },
  heroLeft: { flex: 1, justifyContent: "center" },
  heroSmallLabel: { color: Colors.textSecondary, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 2 },
  heroBigValue: { color: Colors.text, fontSize: 44, fontWeight: "900", letterSpacing: -2 },
  heroUnit: { color: Colors.textSecondary, fontSize: 14, fontWeight: "600" },
  goalButtonGroup: { width: '100%' },
  goalValueRow: { borderBottomWidth: 1, borderStyle: "dashed", borderBottomColor: Colors.border, paddingBottom: 2, flexDirection: "row", alignItems: "baseline", gap: 4, alignSelf: "flex-start", marginTop: 2 },
  goalValueText: { color: Colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },
  goalUnitText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  
  heroRight: { width: 130, height: 130, alignItems: "center", justifyContent: "center", position: "relative" },
  progressRingWrapper: { alignItems: "center", justifyContent: "center" },
  ringInner: { position: "absolute", alignItems: "center", justifyContent: "center" },

  ringValue: { fontSize: 24, fontWeight: "900", letterSpacing: -1 },
  ringLabel: { fontSize: 10, fontWeight: "800", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 2, marginTop: 2 },

  // ── MACRO BENTO GRID ──
  bentoGrid: { flexDirection: "row", gap: 12, marginBottom: 24 },
  bentoCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1, borderColor: Colors.borderLight,
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
    height: 128, justifyContent: "space-between",
    position: "relative", overflow: "hidden",
  },
  bentoGlow: {
    position: "absolute", top: -20, right: -20,
    width: 64, height: 64,
    borderRadius: 32, opacity: 0.15,
  },
  bentoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", zIndex: 2 },
  macroIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  bentoLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", color: Colors.textSecondary, letterSpacing: 1 },
  bentoBottom: { zIndex: 2 },
  bentoValueRow: { flexDirection: "row", alignItems: "baseline", gap: 2, marginBottom: 8 },
  bentoValue: { fontSize: 20, fontWeight: "800", color: Colors.text, letterSpacing: -0.5 },
  bentoGoal: { fontSize: 12, color: Colors.textSecondary, fontWeight: "500" },
  bentoTrack: { height: 6, backgroundColor: Colors.secondary, borderRadius: 3, overflow: "hidden" },
  bentoFill: { height: "100%", borderRadius: 3 },

  // ── TIMELINE ──
  timelineHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 16 },
  timelineTitle: { color: Colors.text, fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  itemCountBadge: { backgroundColor: Colors.surface, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: Colors.borderLight },
  itemCountText: { color: Colors.textSecondary, fontSize: 12, fontWeight: "700" },

  timelineItemRow: { flexDirection: "row", width: "100%", marginBottom: 16 },
  timelineColumn: { width: 56, alignItems: "center", paddingTop: 8, position: "relative" },
  timelineTime: { fontSize: 10, fontWeight: "800", color: Colors.textSecondary, marginBottom: 8 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent, borderWidth: 2, borderColor: Colors.surface, shadowColor: Colors.accent, shadowOffset: {width:0,height:0}, shadowOpacity: 0.6, shadowRadius: 8, elevation: 4 },
  timelineLine: { position: "absolute", top: 40, bottom: -20, left: "50%", width: 2, marginLeft: -1, backgroundColor: Colors.border },
  
  logCard: {
    flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight, borderRadius: 24,
    padding: 14, paddingRight: 16, flexDirection: "row", alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 6,
    position: "relative",
  },
  logIconBox: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", marginRight: 12 },
  logContent: { flex: 1, marginRight: 12 },
  logName: { color: Colors.text, fontSize: 15, fontWeight: "800", letterSpacing: -0.2, marginBottom: 4 },
  logSubRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  servingBadge: { backgroundColor: Colors.secondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  servingText: { color: Colors.textSecondary, fontSize: 10, fontWeight: "600" },
  logMacros: { fontSize: 10, fontWeight: "700" },
  
  logCaloriesCol: { alignItems: "flex-end", borderLeftWidth: 1, borderLeftColor: Colors.borderLight, paddingLeft: 16 },
  logCalories: { fontSize: 18, fontWeight: "900", color: Colors.text, letterSpacing: -0.5, lineHeight: 20 },
  logKcal: { fontSize: 9, fontWeight: "800", color: Colors.textSecondary, textTransform: "uppercase", letterSpacing: 2, marginTop: 4 },

  deleteBtn: { padding: 8, borderRadius: 10, marginLeft: 4 },
  
  emptyState: { backgroundColor: Colors.surface, borderRadius: 24, padding: 32, borderWidth: 1, borderColor: Colors.border, borderStyle: "dashed", alignItems: "center", marginTop: 16 },
  emptyIconBox: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.secondary, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: "800", marginBottom: 4 },
  emptySubtext: { color: Colors.textSecondary, fontSize: 12, textAlign: "center" },

  // ── BOTTOM NAV ──
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    zIndex: 30,
  },
  bottomBarInner: {
    backgroundColor: "rgba(18, 18, 20, 0.95)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.05)",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 28,
    paddingHorizontal: 16,
  },
  navItem: { flex: 1, alignItems: "center", gap: 4 },
  navLabel: { fontSize: 10, fontWeight: "700", color: Colors.textSecondary },

  // ── FAB & MENU ──
  fabBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 40 },
  menuContainer: { position: "absolute", bottom: 130, alignSelf: "center", width: 200, gap: 12, zIndex: 60 },
  menuItemBtn: { flexDirection: "row", alignItems: "center", backgroundColor: Colors.surface, padding: 10, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, elevation: 8 },
  menuIconBg: { width: 40, height: 40, borderRadius: 14, backgroundColor: Colors.accentDim, alignItems: "center", justifyContent: "center", marginRight: 12 },
  menuItemText: { color: Colors.text, fontSize: 14, fontWeight: "700", letterSpacing: 0.2 },
  fabFixed: { position: "absolute", bottom: 48, alignSelf: "center", width: 62, height: 62, borderRadius: 31, zIndex: 50 },
  mainFab: { width: 62, height: 62, borderRadius: 31, backgroundColor: Colors.accent, alignItems: "center", justifyContent: "center", elevation: 10, borderWidth: 4, borderColor: "rgba(18, 18, 20, 0.95)" },
  mainFabActive: { backgroundColor: Colors.surface, borderColor: Colors.border },

  // ── MODALS (Glassmorphism look) ──
  modalOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  glassModal: { width: "100%", maxWidth: 480, alignSelf: "center", backgroundColor: "rgba(18, 18, 20, 0.8)", borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 48 },
  modalDrag: { width: 48, height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, alignSelf: "center", marginBottom: 24 },
  modalTitle: { color: Colors.text, fontSize: 24, fontWeight: "800", textAlign: "center", marginBottom: 4, letterSpacing: -0.5 },
  modalSubtitle: { color: Colors.textSecondary, fontSize: 14, textAlign: "center", marginBottom: 32 },
  modalAccentSubtitle: { color: Colors.accent, fontSize: 14, fontWeight: "700", textAlign: "center", marginBottom: 24 },

  modalInputWrap: { alignItems: "center", marginBottom: 40 },
  modalInputBig: { color: Colors.accent, fontSize: 56, fontWeight: "900", textAlign: "center", letterSpacing: -2, width: 200, padding: 0 },
  modalInputDivider: { height: 2, backgroundColor: Colors.border, width: "100%", maxWidth: 200, borderRadius: 1 },
  modalInputDividerActive: { height: "100%", width: "50%", backgroundColor: Colors.accent, alignSelf: "center" },
  modalInputUnit: { color: Colors.textSecondary, fontSize: 11, fontWeight: "800", letterSpacing: 2, marginTop: 12 },

  editInputWrapper: { alignItems: "center", marginBottom: 32 },
  editInputBox: { backgroundColor: "rgba(24,24,27,0.5)", color: Colors.text, fontSize: 36, fontWeight: "900", padding: 16, borderRadius: 24, textAlign: "center", width: 140, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  
  unitGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginBottom: 32 },
  unitPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", backgroundColor: "rgba(24,24,27,0.5)" },
  unitPillActive: { backgroundColor: Colors.accentGlow, borderColor: Colors.accent },
  unitPillText: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, color: Colors.textSecondary },
  unitPillTextActive: { color: Colors.accent },

  modalBtnRow: { flexDirection: "row", gap: 12 },
  btnCancel: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingVertical: 18, borderRadius: 20, alignItems: "center" },
  btnCancelText: { color: Colors.text, fontSize: 16, fontWeight: "800" },
  btnSave: { flex: 1, backgroundColor: Colors.accent, paddingVertical: 18, borderRadius: 20, alignItems: "center", shadowColor: Colors.accent, shadowOffset:{width:0,height:0}, shadowOpacity:0.4, shadowRadius:12, elevation:6 },
  btnSaveText: { color: "#000", fontSize: 16, fontWeight: "800" },
  
  deleteModalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(239,68,68,0.15)", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 16 },
  btnDelete: { flex: 1, backgroundColor: Colors.error, paddingVertical: 18, borderRadius: 20, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8, elevation: 6 },
  btnDeleteText: { color: Colors.white, fontSize: 16, fontWeight: "800" },
});
