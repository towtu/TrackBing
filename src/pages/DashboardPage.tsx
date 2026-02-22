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
import React, { useCallback, useState } from "react";
import {
  Alert,
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
import { supabase } from "../lib/supabase";
import { Colors } from "../styles/colors";
import { DailyTotals, FoodLog } from "../types";

export function DashboardPage() {
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [totals, setTotals] = useState<DailyTotals>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [goals, setGoals] = useState({ p: 150, c: 200, f: 70 });

  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  const [editGoalModal, setEditGoalModal] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState("");

  const [editLogModal, setEditLogModal] = useState(false);
  const [editingLog, setEditingLog] = useState<FoodLog | null>(null);
  const [editWeightInput, setEditWeightInput] = useState("");
  const [editUnit, setEditUnit] = useState<
    "g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "pc"
  >("g");

  const router = useRouter();

  const fetchData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
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

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: currentGoals } = await supabase
      .from("user_goals")
      .select("protein_ratio, carbs_ratio, fat_ratio")
      .eq("user_id", user.id)
      .maybeSingle();

    let proteinGrams = 150;
    let carbsGrams = 200;
    let fatGrams = 70;

    if (currentGoals) {
      const pRatio = currentGoals.protein_ratio || 30;
      const cRatio = currentGoals.carbs_ratio || 35;
      const fRatio = currentGoals.fat_ratio || 35;
      proteinGrams = Math.round((val * pRatio) / 100 / 4);
      carbsGrams = Math.round((val * cRatio) / 100 / 4);
      fatGrams = Math.round((val * fRatio) / 100 / 9);
      setGoals({ p: proteinGrams, c: carbsGrams, f: fatGrams });
    }

    const { data: existing } = await supabase
      .from("user_goals")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    const updates = {
      user_id: user.id,
      calorie_target: val,
      protein_grams: proteinGrams,
      carbs_grams: carbsGrams,
      fat_grams: fatGrams,
    };

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

    if (isNaN(newAmount) || newAmount <= 0) return alert("Invalid weight");

    let ratio = 1;

    // Fixed math so switching units in the UI doesn't crash the numbers
    if (editUnit === oldUnit || editUnit === "pc" || oldUnit === "pc") {
      ratio = oldAmount > 0 ? newAmount / oldAmount : 1;
    } else {
      const getWeightInGrams = (val: number, unit: string) => {
        if (unit === "oz") return val * 28.3495;
        if (unit === "tsp") return val * 4.92892;
        if (unit === "tbsp") return val * 14.7868;
        if (unit === "cup") return val * 236.588;
        return val;
      };
      let weightInGramsNew = getWeightInGrams(newAmount, editUnit);
      let weightInGramsOld = getWeightInGrams(oldAmount, oldUnit);
      ratio = weightInGramsOld > 0 ? weightInGramsNew / weightInGramsOld : 1;
    }

    const newCalories = Math.round(editingLog.calories * ratio);
    const newProtein = Math.round(editingLog.protein * ratio);
    const newCarbs = Math.round(editingLog.carbs * ratio);
    const newFat = Math.round(editingLog.fat * ratio);

    const updatedLogs = logs.map((l) =>
      l.id === editingLog.id
        ? {
            ...l,
            serving_size: editWeightInput,
            serving_unit: editUnit,
            calories: newCalories,
            protein: newProtein,
            carbs: newCarbs,
            fat: newFat,
          }
        : l,
    );

    setLogs(updatedLogs);
    calculateTotals(updatedLogs);
    setEditLogModal(false);

    const { error } = await supabase
      .from("food_logs")
      .update({
        serving_size: editWeightInput,
        serving_unit: editUnit,
        calories: newCalories,
        protein: newProtein,
        carbs: newCarbs,
        fat: newFat,
      })
      .eq("id", editingLog.id);

    if (error) {
      console.error("Update failed", error);
      fetchData();
    }
  };

  const calculateTotals = (data: FoodLog[]) => {
    const newTotals = data.reduce(
      (acc, curr) => ({
        calories: acc.calories + (curr.calories || 0),
        protein: acc.protein + (curr.protein || 0),
        carbs: acc.carbs + (curr.carbs || 0),
        fat: acc.fat + (curr.fat || 0),
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
    setTotals(newTotals);
  };

  const handleDeleteLog = (id: string, name: string) => {
    if (Platform.OS === "web") {
      if (confirm(`Remove "${name}"?`)) performDeleteLog(id);
      return;
    }
    Alert.alert("Remove Entry", `Remove "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => performDeleteLog(id),
      },
    ]);
  };

  const performDeleteLog = async (id: string) => {
    const previousLogs = [...logs];
    const updatedLogs = logs.filter((item) => item.id !== id);
    setLogs(updatedLogs);
    calculateTotals(updatedLogs);
    const { error } = await supabase.from("food_logs").delete().eq("id", id);
    if (error) {
      setLogs(previousLogs);
      calculateTotals(previousLogs);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchData();
      setMenuOpen(false);
    }, []),
  );

  const getProgress = (current: number, goal: number) =>
    Math.min((current / goal) * 100, 100);

  const rawDiff = calorieGoal - totals.calories;
  const isOver = rawDiff < 0;
  const displayDiff = Math.abs(Math.round(rawDiff));

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.contentContainer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>
              Track<Text style={{ color: Colors.accent }}>Bing</Text>
            </Text>
            <Text style={styles.dateText}>{new Date().toDateString()}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/profile")}
            style={styles.profileButton}
          >
            <User size={20} color={Colors.accent} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.ringRow}>
            <View>
              <Text style={styles.summaryLabel}>Eaten</Text>
              <Text style={styles.summaryValue}>
                {Math.round(totals.calories)}
              </Text>
              <Text style={styles.summaryUnit}>kcal</Text>
            </View>

            <CircularProgress
              value={totals.calories}
              radius={50}
              maxValue={calorieGoal}
              showProgressValue={false}
              activeStrokeColor={isOver ? "#ef4444" : Colors.accent}
              inActiveStrokeColor={"#333"}
              inActiveStrokeOpacity={0.5}
              title={displayDiff.toString()}
              titleColor={isOver ? "#ef4444" : "white"}
              titleStyle={{ fontWeight: "bold", fontSize: 20 }}
              subtitle={isOver ? "Over" : "Left"}
              subtitleStyle={{
                color: isOver ? "#ef4444" : Colors.textSecondary,
                fontSize: 10,
              }}
            />

            <TouchableOpacity
              style={{ alignItems: "flex-end" }}
              onPress={() => {
                setNewGoalInput(calorieGoal.toString());
                setEditGoalModal(true);
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Text style={styles.summaryLabel}>Goal</Text>
                <PencilSimple size={12} color="#666" />
              </View>
              <Text style={styles.summaryValueGoal}>{calorieGoal}</Text>
              <Text style={styles.summaryUnit}>kcal</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.macroRow}>
            {[
              { l: "Prot", c: "#3b82f6", v: totals.protein, g: goals.p },
              { l: "Carbs", c: "#22c55e", v: totals.carbs, g: goals.c },
              { l: "Fat", c: "#ef4444", v: totals.fat, g: goals.f },
            ].map((m) => (
              <View key={m.l} style={{ flex: 1, marginHorizontal: 5 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginBottom: 5,
                  }}
                >
                  <Text style={styles.macroLabel}>{m.l}</Text>
                  <Text style={styles.macroText}>
                    {Math.round(m.v)}/{m.g}g
                  </Text>
                </View>
                <View style={styles.macroTrack}>
                  <View
                    style={{
                      width: `${getProgress(m.v, m.g)}%`,
                      height: "100%",
                      backgroundColor: m.v > m.g ? "#ef4444" : m.c,
                      borderRadius: 2,
                    }}
                  />
                </View>
              </View>
            ))}
          </View>
        </View>

        <FlatList
          data={logs}
          keyExtractor={(item) => item.id || Math.random().toString()}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchData}
              tintColor={Colors.accent}
            />
          }
          contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item }) => (
            <View style={styles.logItem}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => handleEditLogStart(item)}
              >
                <Text style={styles.foodName}>{item.name}</Text>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                >
                  <Text style={styles.foodSub}>
                    {Math.round(item.calories)} kcal
                  </Text>
                  <Text style={{ color: "#444" }}>|</Text>
                  <View
                    style={{
                      backgroundColor: "#333",
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: Colors.accent,
                        fontSize: 10,
                        fontWeight: "bold",
                      }}
                    >
                      {item.serving_size}
                      {item.serving_unit || "g"}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => handleDeleteLog(item.id!, item.name)}
                style={styles.deleteButton}
              >
                <Trash size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No food logged today.</Text>
          }
        />

        {menuOpen && (
          <View style={styles.menuContainer}>
            <View style={styles.menuItem}>
              <Text style={styles.menuLabel}>Scan</Text>
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => router.push("/scan")}
              >
                <Barcode size={24} color="black" />
              </TouchableOpacity>
            </View>
            <View style={styles.menuItem}>
              <Text style={styles.menuLabel}>My Food</Text>
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => router.push("/create-food")}
              >
                <Cookie size={24} color="black" />
              </TouchableOpacity>
            </View>
            <View style={styles.menuItem}>
              <Text style={styles.menuLabel}>Search</Text>
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => router.push("/(tabs)/add")}
              >
                <MagnifyingGlass size={24} color="black" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.fab,
            menuOpen
              ? { backgroundColor: "#444" }
              : { backgroundColor: Colors.accent },
          ]}
          onPress={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? (
            <X size={32} color="white" />
          ) : (
            <Plus size={32} color="black" weight="bold" />
          )}
        </TouchableOpacity>

        <Modal visible={editGoalModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Set Calorie Goal</Text>
              <TextInput
                style={styles.goalInput}
                keyboardType="numeric"
                value={newGoalInput}
                // ✅ FIXED: Strips out letters!
                onChangeText={(t) => setNewGoalInput(t.replace(/[^0-9.]/g, ""))}
                autoFocus
              />
              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setEditGoalModal(false)}
                >
                  <Text style={styles.btnTextWhite}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveGoal}
                >
                  <Text style={styles.btnTextBlack}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <Modal visible={editLogModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Amount</Text>
              <Text style={{ color: "#888", marginBottom: 15 }}>
                Update amount for "{editingLog?.name}"
              </Text>

              <View
                style={{
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  width: "100%",
                }}
              >
                <TextInput
                  style={styles.goalInput}
                  keyboardType="numeric"
                  value={editWeightInput}
                  // ✅ FIXED: Strips out letters!
                  onChangeText={(t) =>
                    setEditWeightInput(t.replace(/[^0-9.]/g, ""))
                  }
                  autoFocus
                  selectTextOnFocus
                />
                <View
                  style={{
                    flexDirection: "row",
                    gap: 5,
                    flexWrap: "wrap",
                    justifyContent: "center",
                    marginTop: 10,
                  }}
                >
                  {["g", "ml", "oz", "tsp", "tbsp", "cup", "pc"].map((u) => (
                    <TouchableOpacity
                      key={u}
                      onPress={() => setEditUnit(u as any)}
                      style={{
                        backgroundColor:
                          editUnit === u ? Colors.accent : "#333",
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderRadius: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "bold",
                          color: editUnit === u ? "black" : "#888",
                        }}
                      >
                        {u}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.modalBtnRow}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setEditLogModal(false)}
                >
                  <Text style={styles.btnTextWhite}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={handleSaveLogEdit}
                >
                  <Text style={styles.btnTextBlack}>Update</Text>
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
  contentContainer: { padding: 20, flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: { color: "white", fontSize: 24, fontWeight: "bold" },
  dateText: { color: Colors.textSecondary, fontSize: 12 },
  profileButton: { backgroundColor: "#333", padding: 8, borderRadius: 20 },
  summaryCard: {
    backgroundColor: Colors.secondary,
    borderRadius: 20,
    padding: 20,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ringRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },
  summaryLabel: {
    color: Colors.textSecondary,
    fontSize: 12,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  summaryValue: { color: Colors.accent, fontSize: 24, fontWeight: "bold" },
  summaryValueGoal: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    textDecorationLine: "underline",
  },
  summaryUnit: { color: Colors.textSecondary, fontSize: 10 },
  macroRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    borderTopWidth: 1,
    borderTopColor: "#333",
    paddingTop: 15,
  },
  macroLabel: { color: "#999", fontSize: 12, fontWeight: "bold" },
  macroText: { color: "white", fontSize: 10 },
  macroTrack: {
    width: "100%",
    height: 6,
    backgroundColor: "#333",
    borderRadius: 3,
    overflow: "hidden",
  },
  logItem: {
    backgroundColor: Colors.secondary,
    padding: 15,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  foodName: { color: Colors.text, fontSize: 16, fontWeight: "600" },
  foodSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  deleteButton: { padding: 10 },
  emptyText: { color: "#666", textAlign: "center", marginTop: 30 },
  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    elevation: 10,
    zIndex: 10,
  },
  menuContainer: {
    position: "absolute",
    bottom: 100,
    right: 28,
    alignItems: "flex-end",
    gap: 15,
    zIndex: 10,
  },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  menuLabel: {
    color: "white",
    fontWeight: "bold",
    backgroundColor: "#333",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  menuButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#1A1A1A",
    padding: 25,
    borderRadius: 20,
    width: "85%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  modalTitle: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 10,
  },
  goalInput: {
    backgroundColor: "#333",
    color: "white",
    fontSize: 32,
    fontWeight: "bold",
    padding: 10,
    borderRadius: 10,
    textAlign: "center",
    minWidth: 120,
  },
  modalBtnRow: { flexDirection: "row", gap: 10, marginTop: 20, width: "100%" },
  saveBtn: {
    backgroundColor: Colors.accent,
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  cancelBtn: {
    backgroundColor: "#333",
    padding: 12,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },
  btnTextWhite: { color: "white", fontWeight: "bold" },
  btnTextBlack: { color: "black", fontWeight: "bold" },
});
