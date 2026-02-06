import { useRouter } from "expo-router";
import {
  Barbell,
  CaretLeft,
  CheckCircle,
  FloppyDisk,
  Lightning,
  Ruler,
  SignOut,
  Target,
} from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { Colors } from "../styles/colors";

export function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Profile State
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("male");
  const [activity, setActivity] = useState(1.2);

  // Goal State
  const [goalOffset, setGoalOffset] = useState(0);
  const [calories, setCalories] = useState(0);

  // Macros
  const [pRatio, setPRatio] = useState("30");
  const [cRatio, setCRatio] = useState("35");
  const [fRatio, setFRatio] = useState("35");

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("user_goals")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setWeight(data.current_weight ? data.current_weight.toString() : "");
        setTargetWeight(
          data.target_weight ? data.target_weight.toString() : "",
        );
        setHeight(data.height ? data.height.toString() : "");
        setAge(data.age ? data.age.toString() : "");
        setGender(data.gender || "male");
        setActivity(parseFloat(data.activity_level) || 1.2);

        setPRatio(data.protein_ratio ? data.protein_ratio.toString() : "30");
        setCRatio(data.carbs_ratio ? data.carbs_ratio.toString() : "35");
        setFRatio(data.fat_ratio ? data.fat_ratio.toString() : "35");

        if (data.calorie_target) {
          setCalories(data.calorie_target);
        } else {
          recalculateCalories(
            data.current_weight,
            data.height,
            data.age,
            data.gender,
            data.activity_level,
            0,
          );
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const recalculateCalories = (
    wStr: string,
    hStr: string,
    aStr: string,
    gen: string,
    act: number,
    offset: number,
  ) => {
    const w = parseFloat(wStr);
    const h = parseFloat(hStr);
    const a = parseFloat(aStr);

    if (!w || !h || !a || isNaN(w) || isNaN(h) || isNaN(a)) return;

    let bmr = 10 * w + 6.25 * h - 5 * a;
    if (gen === "male") bmr += 5;
    else bmr -= 161;

    const tdee = bmr * act;
    const target = Math.round(tdee + offset);

    setCalories(target < 1200 ? 1200 : target);
  };

  useEffect(() => {
    if (!loading) {
      recalculateCalories(weight, height, age, gender, activity, goalOffset);
    }
  }, [weight, height, age, gender, activity, goalOffset]);

  // ✅ HELPER: Cross-Platform Alert
  const showMessage = (title: string, message: string) => {
    if (Platform.OS === "web") {
      alert(`${title}: ${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSave = async () => {
    // 1. VALIDATE MACROS (Must sum to 100%)
    const p = parseInt(pRatio) || 0;
    const c = parseInt(cRatio) || 0;
    const f = parseInt(fRatio) || 0;

    if (p + c + f !== 100) {
      return showMessage(
        "Macro Error",
        `Your macros sum to ${p + c + f}%. They must equal exactly 100%.`,
      );
    }

    // 2. VALIDATE REALISTIC LIMITS
    const numWeight = parseFloat(weight);
    const numTarget = parseFloat(targetWeight);
    const numHeight = parseFloat(height);
    const numAge = parseInt(age);

    if (numWeight < 20 || numWeight > 300)
      return showMessage(
        "Invalid Weight",
        "Please enter a realistic weight (20kg - 300kg).",
      );
    if (numTarget < 20 || numTarget > 300)
      return showMessage(
        "Invalid Target",
        "Please enter a realistic target weight (20kg - 300kg).",
      );
    if (numHeight < 50 || numHeight > 250)
      return showMessage(
        "Invalid Height",
        "Please enter a realistic height (50cm - 250cm).",
      );
    if (numAge < 10 || numAge > 100)
      return showMessage(
        "Invalid Age",
        "Please enter a realistic age (10 - 100 years).",
      );

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const updates = {
        user_id: user.id,
        current_weight: numWeight,
        target_weight: numTarget,
        height: numHeight,
        age: numAge,
        gender,
        activity_level: activity.toString(),
        calorie_target: calories,
        protein_ratio: p,
        carbs_ratio: c,
        fat_ratio: f,
      };

      const { error } = await supabase
        .from("user_goals")
        .upsert(updates, { onConflict: "user_id" });

      setSaving(false);
      if (error) {
        showMessage("Save Failed", error.message);
      } else {
        setShowSuccessModal(true);
      }
    } else {
      setSaving(false);
    }
  };

  const handleCloseModal = () => {
    setShowSuccessModal(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: Colors.primary,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Colors.primary }}
      edges={["top", "left", "right"]}
    >
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        {/* HEADER */}
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <CaretLeft size={24} color={Colors.accent} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Profile</Text>
          <TouchableOpacity onPress={handleLogout}>
            <SignOut size={24} color="#ef4444" />
          </TouchableOpacity>
        </View>

        {/* --- CARD 1: PHYSICAL STATS --- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ruler color={Colors.accent} weight="fill" />
            <Text style={styles.cardTitle}>Body Stats</Text>
          </View>

          {/* Row 1: Weight & Target */}
          <View style={styles.inputRow}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>CURRENT (KG)</Text>
              <TextInput
                value={weight}
                onChangeText={setWeight}
                keyboardType="numeric"
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#555"
              />
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>TARGET (KG)</Text>
              <TextInput
                value={targetWeight}
                onChangeText={setTargetWeight}
                keyboardType="numeric"
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#555"
              />
            </View>
          </View>

          {/* Row 2: Height & Age */}
          <View style={styles.inputRow}>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>HEIGHT (CM)</Text>
              <TextInput
                value={height}
                onChangeText={setHeight}
                keyboardType="numeric"
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#555"
              />
            </View>
            <View style={styles.inputContainer}>
              <Text style={styles.label}>AGE (YRS)</Text>
              <TextInput
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#555"
              />
            </View>
          </View>

          {/* Row 3: Gender */}
          <View style={{ marginTop: 15 }}>
            <Text style={styles.label}>GENDER</Text>
            <View style={styles.genderRow}>
              <TouchableOpacity
                style={[
                  styles.genderBtn,
                  gender === "male" && styles.genderBtnActive,
                ]}
                onPress={() => setGender("male")}
              >
                <Text
                  style={[
                    styles.genderText,
                    gender === "male" && { color: "black" },
                  ]}
                >
                  Male
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.genderBtn,
                  gender === "female" && styles.genderBtnActive,
                ]}
                onPress={() => setGender("female")}
              >
                <Text
                  style={[
                    styles.genderText,
                    gender === "female" && { color: "black" },
                  ]}
                >
                  Female
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* --- CARD 2: ACTIVITY LEVEL --- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Lightning color={Colors.accent} weight="fill" />
            <Text style={styles.cardTitle}>Activity Level</Text>
          </View>
          <View style={{ gap: 8 }}>
            {[
              { l: "Sedentary (Desk Job)", v: 1.2 },
              { l: "Light Active (1-3 days)", v: 1.375 },
              { l: "Moderate (3-5 days)", v: 1.55 },
              { l: "Very Active (6-7 days)", v: 1.725 },
            ].map((item) => (
              <TouchableOpacity
                key={item.v}
                style={[
                  styles.activityOption,
                  activity === item.v && styles.activityActive,
                ]}
                onPress={() => setActivity(item.v)}
              >
                <Text
                  style={{
                    color: activity === item.v ? Colors.accent : "#888",
                    fontWeight: "600",
                  }}
                >
                  {item.l}
                </Text>
                {activity === item.v && (
                  <CheckCircle size={16} color={Colors.accent} weight="fill" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* --- CARD 3: GOAL SETTING --- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Target color={Colors.accent} weight="fill" />
            <Text style={styles.cardTitle}>Calculated Goal</Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 20 }}
          >
            {[
              { l: "-1 kg/wk", v: -1100 },
              { l: "-0.5 kg", v: -550 },
              { l: "Maintain", v: 0 },
              { l: "+0.5 kg", v: 550 },
              { l: "+1 kg", v: 1100 },
            ].map((item) => (
              <TouchableOpacity
                key={item.v}
                onPress={() => setGoalOffset(item.v)}
                style={[
                  styles.goalPill,
                  goalOffset === item.v
                    ? { backgroundColor: Colors.accent }
                    : { backgroundColor: "#333" },
                ]}
              >
                <Text
                  style={{
                    color: goalOffset === item.v ? "black" : "white",
                    fontWeight: "bold",
                    fontSize: 12,
                  }}
                >
                  {item.l}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.caloriesBox}>
            <Text style={{ color: "white", fontSize: 32, fontWeight: "bold" }}>
              {calories}
            </Text>
            <Text style={{ color: "#888", fontSize: 14, fontWeight: "bold" }}>
              kcal / day
            </Text>
          </View>
        </View>

        {/* --- CARD 4: MACROS --- */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Barbell color={Colors.accent} weight="fill" />
            <Text style={styles.cardTitle}>Macros (%)</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { l: "Prot", v: pRatio, f: setPRatio, c: "#3b82f6" },
              { l: "Carb", v: cRatio, f: setCRatio, c: "#22c55e" },
              { l: "Fat", v: fRatio, f: setFRatio, c: "#ef4444" },
            ].map((m) => (
              <View key={m.l} style={{ flex: 1 }}>
                <Text
                  style={{
                    color: m.c,
                    fontSize: 12,
                    fontWeight: "bold",
                    marginBottom: 5,
                  }}
                >
                  {m.l}
                </Text>
                <TextInput
                  value={m.v}
                  onChangeText={m.f}
                  keyboardType="numeric"
                  maxLength={3}
                  style={styles.input}
                />
              </View>
            ))}
          </View>
        </View>

        {/* SAVE BUTTON */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving}
          style={styles.saveBtn}
        >
          {saving ? (
            <ActivityIndicator color="black" />
          ) : (
            <>
              <FloppyDisk
                size={20}
                color="black"
                weight="bold"
                style={{ marginRight: 10 }}
              />
              <Text style={styles.saveBtnText}>Save Changes</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* SUCCESS MODAL */}
      <Modal
        transparent
        visible={showSuccessModal}
        animationType="fade"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <CheckCircle
              size={64}
              color={Colors.accent}
              weight="fill"
              style={{ marginBottom: 20 }}
            />
            <Text style={styles.modalTitle}>Success!</Text>
            <Text style={styles.modalText}>
              Your profile has been updated. Return to the dashboard to see your
              new goal.
            </Text>
            <TouchableOpacity
              style={styles.modalButton}
              onPress={handleCloseModal}
            >
              <Text style={styles.modalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  backBtn: { flexDirection: "row", alignItems: "center" },
  backText: { color: Colors.accent, fontWeight: "bold", fontSize: 16 },
  headerTitle: { color: "white", fontSize: 20, fontWeight: "bold" },

  card: {
    backgroundColor: Colors.secondary,
    padding: 20,
    borderRadius: 15,
    marginBottom: 20,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 15 },
  cardTitle: {
    color: "white",
    fontWeight: "bold",
    fontSize: 18,
    marginLeft: 10,
  },

  inputRow: { flexDirection: "row", gap: 15, marginBottom: 15 },
  inputContainer: { flex: 1 },
  label: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginBottom: 5,
    textTransform: "uppercase",
    fontWeight: "bold",
  },
  input: {
    backgroundColor: "#27272a",
    color: "white",
    padding: 12,
    borderRadius: 8,
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 18,
  },

  genderRow: { flexDirection: "row", gap: 10 },
  genderBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#27272a",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  genderBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  genderText: { color: "#888", fontWeight: "bold" },

  activityOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
    backgroundColor: "#27272a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  activityActive: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(255, 215, 0, 0.05)",
  },

  goalPill: {
    padding: 10,
    borderRadius: 15,
    marginRight: 10,
    minWidth: 80,
    alignItems: "center",
  },
  caloriesBox: {
    backgroundColor: "#222",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    marginTop: 10,
  },

  saveBtn: {
    backgroundColor: Colors.accent,
    padding: 18,
    borderRadius: 15,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  saveBtnText: { color: "black", fontWeight: "bold", fontSize: 16 },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "80%",
    backgroundColor: Colors.secondary,
    padding: 30,
    borderRadius: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  modalTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
  },
  modalText: {
    color: Colors.textSecondary,
    textAlign: "center",
    marginBottom: 25,
  },
  modalButton: {
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 25,
    width: "100%",
  },
  modalButtonText: {
    color: "black",
    fontWeight: "bold",
    textAlign: "center",
    fontSize: 16,
  },
});
