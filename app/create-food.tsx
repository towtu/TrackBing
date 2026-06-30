import { useRouter } from "expo-router";
import { Calculator, CheckCircle, X } from "phosphor-react-native";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AiEstimateBadge } from "@/src/components/ai/AiEstimateBadge";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { requestAiFood, type AiFood } from "@/src/lib/aiFood";
import {
  getAiFoodFeedback,
  shouldMarkAiEstimated,
} from "@/src/lib/aiFoodUi";
import { supabase } from "@/src/lib/supabase";
import { Colors } from "@/src/styles/colors";
import { useResponsive } from "@/src/hooks/useResponsive";

type FoodUnit = "g" | "ml" | "oz" | "tsp" | "tbsp" | "cup" | "serving";

type FeedbackState = {
  type: SweetFeedbackType;
  title: string;
  message: string;
  confirmText?: string;
  autoDismissMs?: number;
  onClose?: () => void;
};

const FOOD_UNITS: FoodUnit[] = ["g", "ml", "oz", "tsp", "tbsp", "cup", "serving"];

const formatMacroInput = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export default function CreateFoodPage() {
  const router = useRouter();
  const { width, isDesktop } = useResponsive();
  const compactForm = width < 390;
  const skipNextMacroAutoCalc = useRef(false);
  const [name, setName] = useState("");
  const [cal, setCal] = useState("");
  const [prot, setProt] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const [unit, setUnit] = useState<FoodUnit>("g");

  const [submitting, setSubmitting] = useState(false);
  const [aiFillLoading, setAiFillLoading] = useState(false);
  const [aiFillSource, setAiFillSource] = useState<AiFood["source"] | null>(
    null,
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  useEffect(() => {
    if (skipNextMacroAutoCalc.current) {
      skipNextMacroAutoCalc.current = false;
      return;
    }

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
      setFeedback({
        type: "warning",
        title: "Missing info",
        message: "Please enter at least a name and calories.",
      });
      return;
    }

    const aiEstimated = aiFillSource
      ? shouldMarkAiEstimated({ source: aiFillSource })
      : false;

    setSubmitting(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSubmitting(false);
      setFeedback({
        type: "warning",
        title: "Sign in required",
        message: "Please sign in again before saving this food.",
      });
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
        default_unit: unit,
        ai_estimated: aiEstimated,
      },
    ]);

    if (error) {
      setFeedback({
        type: "error",
        title: "Could not save food",
        message: error.message,
      });
      setSubmitting(false);
    } else {
      setFeedback({
        type: "success",
        title: "Saved!",
        message: "Food added to My Foods.",
        autoDismissMs: 1100,
        onClose: () => router.back(),
      });
    }
  };

  const handleAiFill = async () => {
    const trimmed = name.trim();
    if (!trimmed || aiFillLoading) {
      setFeedback({
        type: "info",
        title: "Bee needs a food name",
        message: "Enter a food name first, then Bee can draft its macros.",
      });
      return;
    }

    setAiFillLoading(true);
    const result = await requestAiFood(trimmed, "fill");
    setAiFillLoading(false);

    if (!result.ok) {
      setFeedback(getAiFoodFeedback(result.reason));
      return;
    }

    skipNextMacroAutoCalc.current = true;
    setUnit("serving");
    setCal(String(Math.round(result.food.kcal)));
    setProt(formatMacroInput(result.food.protein));
    setCarbs(formatMacroInput(result.food.carbs));
    setFat(formatMacroInput(result.food.fat));
    setAiFillSource(result.food.source);
  };

  const closeFeedback = () => {
    const onClose = feedback?.onClose;
    setFeedback(null);
    onClose?.();
  };

  const isPer100 = unit === "g" || unit === "ml";
  const unitLabel = `(per ${isPer100 ? "100" : "1"}${unit === "serving" ? " serving" : unit})`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create My Food</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <X size={24} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          isDesktop && styles.webContent,
        ]}
      >
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

        <View style={styles.aiFillRow}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={aiFillLoading}
            onPress={handleAiFill}
            style={[
              styles.aiFillBtn,
              aiFillLoading && styles.aiFillBtnDisabled,
            ]}
          >
            {aiFillLoading ? (
              <ActivityIndicator color={Colors.textOnAccent} />
            ) : (
              <Text style={styles.aiFillBtnText}>🐝 AI fill</Text>
            )}
          </TouchableOpacity>
          {aiFillSource ? (
            <AiEstimateBadge source={aiFillSource} compact />
          ) : (
            <Text style={styles.aiFillHint}>
              Bee fills per-serving macros for review.
            </Text>
          )}
        </View>

        <Text style={styles.label}>Default Unit</Text>
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          {FOOD_UNITS.map((u) => (
            <TouchableOpacity
              key={u}
              onPress={() => setUnit(u)}
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

        <View style={[styles.grid, compactForm && styles.gridCompact]}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Protein {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={prot}
              onChangeText={(t) => setProt(t.replace(/[^0-9.]/g, ""))}
            />
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Carbs {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={carbs}
              onChangeText={(t) => setCarbs(t.replace(/[^0-9.]/g, ""))}
            />
          </View>
        </View>

        <View style={[styles.grid, compactForm && styles.gridCompact]}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Fat {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#666"
              keyboardType="numeric"
              value={fat}
              onChangeText={(t) => setFat(t.replace(/[^0-9.]/g, ""))}
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
              onChangeText={(t) => setCal(t.replace(/[^0-9.]/g, ""))}
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
      <SweetFeedback
        visible={!!feedback}
        type={feedback?.type}
        title={feedback?.title ?? ""}
        message={feedback?.message}
        confirmText={feedback?.confirmText}
        autoDismissMs={feedback?.autoDismissMs}
        onClose={closeFeedback}
      />
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
  content: {
    padding: 20,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  webContent: {
    paddingTop: 28,
  },
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
  aiFillRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginTop: -8,
    marginBottom: 20,
  },
  aiFillBtn: {
    minHeight: 42,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  aiFillBtnDisabled: {
    opacity: 0.65,
  },
  aiFillBtnText: {
    color: Colors.textOnAccent,
    fontSize: 13,
    fontWeight: "900",
  },
  aiFillHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    flexShrink: 1,
  },
  grid: { flexDirection: "row", gap: 15 },
  gridCompact: {
    flexDirection: "column",
    gap: 0,
  },
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
