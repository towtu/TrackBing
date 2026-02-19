import { useRouter } from "expo-router";
import { Calculator, CheckCircle, X } from "phosphor-react-native";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/lib/supabase";
import { Colors } from "../src/styles/colors";

export default function CreateFoodPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [cal, setCal] = useState("");
  const [prot, setProt] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  // ✅ NEW: Unit Selection State
  const [unit, setUnit] = useState<"g" | "ml" | "oz" | "tsp" | "tbsp" | "cup">(
    "g",
  );

  const [submitting, setSubmitting] = useState(false);

  // Auto-Calculate Calories
  useEffect(() => {
    const p = parseFloat(prot) || 0;
    const c = parseFloat(carbs) || 0;
    const f = parseFloat(fat) || 0;

    if (p > 0 || c > 0 || f > 0) {
      const calculated = Math.round(p * 4 + c * 4 + f * 9);
      setCal(calculated.toString());
    }
  }, [prot, carbs, fat]);

  const handleSave = async () => {
    if (submitting) return;
    if (!name || !cal) {
      return Alert.alert(
        "Missing Info",
        "Please enter at least a name and calories.",
      );
    }

    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      return;
    }

    const { error } = await supabase.from("personal_foods").insert([
      {
        user_id: user.id,
        name: name,
        calories: parseFloat(cal) || 0,
        protein: parseFloat(prot) || 0,
        carbs: parseFloat(carbs) || 0,
        fat: parseFloat(fat) || 0,
        default_unit: unit, // ✅ Save the selected unit to database
      },
    ]);

    if (error) {
      Alert.alert("Error", error.message);
      setSubmitting(false);
    } else {
      Alert.alert("Success", "Food saved!");
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create My Food</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.infoBanner}>
          <Calculator size={20} color={Colors.accent} weight="fill" />
          <Text style={styles.infoText}>
            Calories are{" "}
            <Text style={{ fontWeight: "bold" }}>auto-calculated</Text> as you
            type macros. You can also edit them manually.
          </Text>
        </View>

        <Text style={styles.label}>Food Name</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Mama's Adobo"
          placeholderTextColor="#666"
          value={name}
          onChangeText={setName}
          autoFocus
        />

        {/* ✅ NEW UNIT SELECTOR UI */}
        <Text style={styles.label}>Default Unit</Text>
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          {["g", "ml", "oz", "tsp", "tbsp", "cup"].map((u) => (
            <TouchableOpacity
              key={u}
              onPress={() => setUnit(u as any)}
              style={{
                backgroundColor: unit === u ? Colors.accent : "#333",
                paddingHorizontal: 20,
                paddingVertical: 10,
                borderRadius: 15,
                minWidth: 60,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: unit === u ? "black" : "white",
                  fontWeight: "bold",
                }}
              >
                {u}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Protein (per 100{unit})</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={prot}
              onChangeText={setProt}
            />
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Carbs (per 100{unit})</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={carbs}
              onChangeText={setCarbs}
            />
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Fat (per 100{unit})</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={fat}
              onChangeText={setFat}
            />
          </View>

          <View style={styles.gridItem}>
            <Text style={{ ...styles.label, color: Colors.accent }}>
              Calories
            </Text>
            <TextInput
              style={{
                ...styles.input,
                borderColor: Colors.accent,
                color: Colors.accent,
                fontWeight: "bold",
              }}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={cal}
              onChangeText={setCal}
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, submitting && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="black" />
          ) : (
            <CheckCircle size={24} color="black" weight="fill" />
          )}
          <Text style={styles.saveBtnText}>
            {submitting ? "Saving..." : "Save Food"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  title: { color: "white", fontSize: 20, fontWeight: "bold" },
  closeBtn: { padding: 5 },
  content: { padding: 20 },
  infoBanner: {
    flexDirection: "row",
    backgroundColor: "#333",
    padding: 15,
    borderRadius: 10,
    marginBottom: 25,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#444",
  },
  infoText: { color: "#CCC", fontSize: 13, flex: 1 },
  label: {
    color: "#888",
    marginBottom: 8,
    fontSize: 12,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  input: {
    backgroundColor: Colors.secondary,
    color: "white",
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#333",
  },
  grid: { flexDirection: "row", gap: 15 },
  gridItem: { flex: 1 },
  saveBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    borderRadius: 30,
    marginTop: 10,
  },
  saveBtnText: {
    fontWeight: "bold",
    fontSize: 16,
    marginLeft: 8,
    color: "black",
  },
});
