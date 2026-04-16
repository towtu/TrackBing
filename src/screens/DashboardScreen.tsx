import { useFocusEffect, useRouter } from "expo-router";
import {
  Barcode,
  Cookie,
  MagnifyingGlass,
  PencilSimple,
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
    // Rotate FAB icon: 0 → 45deg when open (+ becomes ×)
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
    // Spring bounce on press
    Animated.sequence([
      Animated.timing(fabScale, { toValue: 0.82, duration: 65,  useNativeDriver: true }),
      Animated.spring(fabScale, { toValue: 1,    tension: 220,  friction: 7, useNativeDriver: true }),
    ]).start();
    setMenuOpen((prev) => !prev);
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
    if (Platform.OS === "web") {
      if (confirm(`Remove "${name}"?`)) performDeleteLog(id);
      return;
    }
    Alert.alert("Remove Entry", `Remove "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => performDeleteLog(id) },
    ]);
  };

  const performDeleteLog = async (id: string) => {
    const previousLogs = [...logs];
    const updatedLogs = logs.filter((item) => item.id !== id);
    setLogs(updatedLogs);
    calculateTotals(updatedLogs);
    const { error } = await supabase.from("food_logs").delete().eq("id", id);
    if (error) { setLogs(previousLogs); calculateTotals(previousLogs); }
  };

  useFocusEffect(useCallback(() => { fetchData(); setMenuOpen(false); }, []));

  const getProgress = (current: number, goal: number) => Math.min((current / goal) * 100, 100);
  const rawDiff = calorieGoal - totals.calories;
  const isOver = rawDiff < 0;
  const displayDiff = Math.abs(Math.round(rawDiff));

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const macros = [
    { l: "Protein", s: "Pro",  c: Colors.protein, v: totals.protein, g: goals.p },
    { l: "Carbs",   s: "Carb", c: Colors.carbs,   v: totals.carbs,   g: goals.c },
    { l: "Fat",     s: "Fat",  c: Colors.fat,      v: totals.fat,      g: goals.f },
  ];

  const menuItems = [
    { label: "Scan Barcode", icon: <Barcode size={22} color={Colors.text} weight="bold" />, route: "/scan" },
    { label: "My Foods",     icon: <Cookie size={22} color={Colors.text} weight="bold" />, route: "/create-food" },
    { label: "Search",       icon: <MagnifyingGlass size={22} color={Colors.text} weight="bold" />, route: "/(tabs)/add" },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.contentContainer}>

        {/* ── HEADER ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {/* Avatar — tappable, navigates to profile */}
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/profile")}
              style={styles.avatarCircle}
            >
              <User size={18} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
            <View>
              <Text style={styles.headerLabel}>TODAY</Text>
              <Text style={styles.headerDate}>{dateStr}</Text>
            </View>
          </View>
          {/* No duplicate button — profile is accessed via avatar on the left */}
        </View>

        <FlatList
          data={logs}
          keyExtractor={(item) => item.id || Math.random().toString()}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 110 }}
          ListHeaderComponent={
            <>
              {/* ── HERO SUMMARY CARD ── */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  {/* Left: Stats */}
                  <View style={styles.summaryLeft}>
                    <View style={{ marginBottom: 18 }}>
                      <Text style={styles.summarySmallLabel}>EATEN</Text>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                        <Text style={styles.summaryBigValue}>{Math.round(totals.calories)}</Text>
                        <Text style={styles.summaryUnit}>kcal</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={() => { setNewGoalInput(calorieGoal.toString()); setEditGoalModal(true); }}
                      style={{ opacity: 0.6 }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Text style={styles.summarySmallLabel}>GOAL</Text>
                        <PencilSimple size={10} color={Colors.textMuted} />
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                        <Text style={styles.summaryGoalValue}>{calorieGoal}</Text>
                        <Text style={styles.summaryUnit}>kcal</Text>
                      </View>
                    </TouchableOpacity>
                  </View>

                  {/* Right: Ring */}
                  <View style={styles.summaryRingWrap}>
                    <CircularProgress
                      value={totals.calories}
                      radius={62}
                      maxValue={calorieGoal}
                      showProgressValue={false}
                      activeStrokeColor={isOver ? Colors.error : Colors.accent}
                      activeStrokeWidth={10}
                      inActiveStrokeColor={Colors.border}
                      inActiveStrokeWidth={10}
                      inActiveStrokeOpacity={1}
                      title={displayDiff.toString()}
                      titleColor={isOver ? Colors.error : Colors.text}
                      titleStyle={{ fontWeight: "bold", fontSize: 22 }}
                      subtitle={isOver ? "over" : "left"}
                      subtitleStyle={{ color: isOver ? Colors.error : Colors.textSecondary, fontSize: 10, letterSpacing: 0.5 }}
                    />
                  </View>
                </View>
              </View>

              {/* ── MACRO BENTO CARDS ── */}
              <View style={styles.macrosRow}>
                {macros.map((m) => (
                  <View key={m.l} style={styles.macroCard}>
                    {/* Thin progress bar at very top */}
                    <View style={styles.macroProgressBg}>
                      <View
                        style={[
                          styles.macroProgressFill,
                          {
                            width: `${getProgress(m.v, m.g)}%` as any,
                            backgroundColor: m.v > m.g ? Colors.error : m.c,
                          },
                        ]}
                      />
                    </View>

                    {/* Card body */}
                    <View style={styles.macroCardBody}>
                      <View style={styles.macroCardTop}>
                        <Text style={styles.macroCardLabel}>{m.s}</Text>
                        <View style={[styles.macroDot, { backgroundColor: m.c }]} />
                      </View>
                      <Text style={styles.macroCardValue}>
                        {Math.round(m.v)}
                        <Text style={styles.macroCardGoal}>/{m.g}g</Text>
                      </Text>
                    </View>
                  </View>
                ))}
              </View>

              {/* ── SECTION HEADER ── */}
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Today's Meals</Text>
                {logs.length > 0 && (
                  <View style={styles.sectionBadge}>
                    <Text style={styles.sectionBadgeText}>
                      {logs.length} {logs.length === 1 ? "item" : "items"}
                    </Text>
                  </View>
                )}
              </View>
            </>
          }
          renderItem={({ item }) => (
            <View style={styles.logItem}>
              {/* Icon box */}
              <View style={styles.logItemIconBox}>
                <Cookie size={22} color={Colors.accent} weight="duotone" />
              </View>

              {/* Content */}
              <TouchableOpacity
                style={styles.logItemContent}
                onPress={() => handleEditLogStart(item)}
              >
                <Text style={styles.foodName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.foodMacros}>
                  {item.serving_size}{item.serving_unit || "g"}
                  {"  ·  "}P:{Math.round(item.protein)}  C:{Math.round(item.carbs)}  F:{Math.round(item.fat)}
                </Text>
              </TouchableOpacity>

              {/* Calorie pill */}
              <TouchableOpacity
                style={styles.caloriesPill}
                onPress={() => handleEditLogStart(item)}
              >
                <Text style={styles.caloriesPillValue}>{Math.round(item.calories)}</Text>
                <Text style={styles.caloriesPillUnit}>kcal</Text>
              </TouchableOpacity>

              {/* Delete */}
              <TouchableOpacity
                onPress={() => handleDeleteLog(item.id!, item.name)}
                style={styles.deleteButton}
              >
                <Trash size={17} color={Colors.error} />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Cookie size={28} color={Colors.accent} weight="duotone" />
              </View>
              <Text style={styles.emptyTitle}>Nothing logged yet</Text>
              <Text style={styles.emptySubtext}>Tap + to add your first meal</Text>
            </View>
          }
        />

        {/* ── FAB MENU ── */}
        {menuOpen && (
          <TouchableOpacity
            style={styles.menuBackdrop}
            onPress={() => setMenuOpen(false)}
            activeOpacity={1}
          />
        )}
        <View style={styles.menuContainer} pointerEvents="box-none">
          {menuItems.map((item, i) => (
            <Animated.View
              key={item.label}
              style={{
                opacity:   menuAnims[i].opacity,
                transform: [
                  { translateY: menuAnims[i].translateY },
                  { scale:      menuAnims[i].scale },
                ],
              }}
              pointerEvents={menuOpen ? "auto" : "none"}
            >
              <View style={styles.menuItem}>
                <View style={styles.menuLabel}>
                  <Text style={styles.menuLabelText}>{item.label}</Text>
                </View>
                <TouchableOpacity
                  style={styles.menuButton}
                  onPress={() => { setMenuOpen(false); router.push(item.route as any); }}
                >
                  {item.icon}
                </TouchableOpacity>
              </View>
            </Animated.View>
          ))}
        </View>

        {/* ── MAIN FAB (Rounded Square) ── */}
        <Animated.View style={[styles.fab, { transform: [{ scale: fabScale }] }]}>
          <TouchableOpacity
            style={[
              styles.fabInner,
              menuOpen
                ? { backgroundColor: Colors.secondary, borderWidth: 1, borderColor: Colors.border }
                : { backgroundColor: Colors.accent },
            ]}
            onPress={handleFabPress}
            activeOpacity={1}
          >
            <Animated.View style={{
              transform: [{
                rotate: fabRotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "45deg"] }),
              }],
            }}>
              <Plus
                size={28}
                color={menuOpen ? Colors.text : Colors.textOnAccent}
                weight="bold"
              />
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        {/* ── EDIT GOAL MODAL ── */}
        <Modal visible={editGoalModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalAccentBar} />
              <View style={styles.modalBody}>
                <Text style={styles.modalTitle}>Daily Goal</Text>
                <Text style={styles.modalSubtitle}>Set your calorie target</Text>
                <TextInput
                  style={styles.modalInput}
                  keyboardType="numeric"
                  value={newGoalInput}
                  onChangeText={(t) => setNewGoalInput(t.replace(/[^0-9]/g, ""))}
                  autoFocus
                />
                <Text style={styles.modalInputUnit}>kcal / day</Text>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity style={styles.btnCancel} onPress={() => setEditGoalModal(false)}>
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnSave} onPress={handleSaveGoal}>
                    <Text style={styles.btnSaveText}>Save</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── EDIT LOG MODAL ── */}
        <Modal visible={editLogModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalAccentBar} />
              <View style={styles.modalBody}>
                <Text style={styles.modalTitle}>Edit Portion</Text>
                <Text style={styles.modalSubtitle} numberOfLines={1}>{editingLog?.name}</Text>
                <TextInput
                  style={styles.modalInput}
                  keyboardType="numeric"
                  value={editWeightInput}
                  onChangeText={(t) => setEditWeightInput(t.replace(/[^0-9.]/g, ""))}
                  autoFocus
                  selectTextOnFocus
                />
                <View style={styles.unitGrid}>
                  {["g", "ml", "oz", "tsp", "tbsp", "cup", "serving"].map((u) => (
                    <TouchableOpacity
                      key={u}
                      onPress={() => setEditUnit(u as any)}
                      style={[styles.unitPill, editUnit === u && styles.unitPillActive]}
                    >
                      <Text style={[styles.unitPillText, editUnit === u && styles.unitPillTextActive]}>
                        {u}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.modalBtnRow}>
                  <TouchableOpacity style={styles.btnCancel} onPress={() => setEditLogModal(false)}>
                    <Text style={styles.btnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnSave} onPress={handleSaveLogEdit}>
                    <Text style={styles.btnSaveText}>Update</Text>
                  </TouchableOpacity>
                </View>
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
    paddingHorizontal: 18,
    paddingTop: 8,
    maxWidth: 520,
    alignSelf: "center",
    width: "100%",
  },

  // ── HEADER ──
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerLabel: {
    color: Colors.accent,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 2,
  },
  headerDate: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  // ── HERO SUMMARY CARD ──
  summaryCard: {
    backgroundColor: Colors.secondary,
    borderRadius: 28,
    padding: 22,
    marginTop: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    position: "relative",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryLeft: { flex: 1, justifyContent: "center" },
  summarySmallLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  summaryBigValue: {
    color: Colors.text,
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  summaryGoalValue: {
    color: Colors.textSecondary,
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  summaryUnit: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  summaryRingWrap: { marginRight: -6 },

  // ── MACRO BENTO CARDS ──
  macrosRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 22,
  },
  macroCard: {
    flex: 1,
    backgroundColor: Colors.secondary,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    position: "relative",
  },
  macroProgressBg: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: Colors.border,
  },
  macroProgressFill: {
    height: "100%",
  },
  macroCardBody: {
    padding: 12,
    paddingTop: 14,
  },
  macroCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  macroCardLabel: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  macroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    opacity: 0.85,
  },
  macroCardValue: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  macroCardGoal: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "400",
  },

  // ── SECTION HEADER ──
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionBadge: {
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  sectionBadgeText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // ── LOG ITEMS ──
  logItem: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 22,
    padding: 8,
    paddingRight: 10,
    marginBottom: 10,
  },
  logItemIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    flexShrink: 0,
  },
  logItemContent: {
    flex: 1,
    marginRight: 8,
  },
  foodName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: -0.1,
    marginBottom: 3,
  },
  foodMacros: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  caloriesPill: {
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
    marginRight: 8,
  },
  caloriesPillValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  caloriesPillUnit: {
    color: Colors.textSecondary,
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  deleteButton: {
    padding: 8,
    borderRadius: 10,
  },

  // ── EMPTY STATE ──
  emptyState: { alignItems: "center", paddingTop: 48, paddingBottom: 32 },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: "700", marginBottom: 5 },
  emptySubtext: { color: Colors.textSecondary, fontSize: 13, textAlign: "center" },

  // ── FAB ──
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
    zIndex: 9,
  },
  menuContainer: {
    position: "absolute",
    bottom: 100,
    right: 18,
    alignItems: "flex-end",
    gap: 12,
    zIndex: 10,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12 },
  menuLabel: {
    backgroundColor: "rgba(28,25,23,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  menuLabelText: { color: Colors.text, fontWeight: "600", fontSize: 13 },
  menuButton: {
    width: 50,
    height: 50,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    bottom: 28,
    right: 18,
    width: 62,
    height: 62,
    borderRadius: 22,
    zIndex: 10,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 12,
  },
  fabInner: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  // ── MODALS ──
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: "85%",
    maxWidth: 340,
    backgroundColor: Colors.secondary,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  modalAccentBar: { height: 3, backgroundColor: Colors.accent },
  modalBody: { padding: 24, alignItems: "center" },
  modalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  modalSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginBottom: 18,
    textAlign: "center",
  },
  modalInput: {
    backgroundColor: Colors.inputBg,
    color: Colors.accent,
    fontSize: 38,
    fontWeight: "900",
    padding: 14,
    borderRadius: 14,
    textAlign: "center",
    minWidth: 140,
    borderWidth: 1,
    borderColor: Colors.border,
    letterSpacing: -1,
  },
  modalInputUnit: {
    color: Colors.textSecondary,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 18,
  },
  unitGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    marginTop: 14,
    marginBottom: 18,
  },
  unitPill: {
    backgroundColor: Colors.inputBg,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  unitPillActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitPillText: { color: Colors.textSecondary, fontSize: 12, fontWeight: "600" },
  unitPillTextActive: { color: Colors.textOnAccent },
  modalBtnRow: { flexDirection: "row", gap: 10, width: "100%" },
  btnSave: {
    backgroundColor: Colors.accent,
    padding: 14,
    borderRadius: 12,
    flex: 1,
    alignItems: "center",
  },
  btnSaveText: { color: Colors.textOnAccent, fontWeight: "700" },
  btnCancel: {
    backgroundColor: Colors.inputBg,
    padding: 14,
    borderRadius: 12,
    flex: 1,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  btnCancelText: { color: Colors.text, fontWeight: "700" },
});
