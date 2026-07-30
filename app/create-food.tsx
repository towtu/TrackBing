import { useLocalSearchParams, useRouter } from "expo-router";
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
import { BeeGuide } from "@/src/components/ai/BeeGuide";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { requestAiFood, type AiFood } from "@/src/lib/aiFood";
import {
  getAiFoodFeedback,
  shouldMarkAiEstimated,
} from "@/src/lib/aiFoodUi";
import {
  parseBarcode,
  sanitizeBarcodeInput,
} from "@/src/lib/barcodes";
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
  const params = useLocalSearchParams<{ barcode?: string | string[] }>();
  const { width, isDesktop } = useResponsive();
  const compactForm = width < 390;
  const skipNextMacroAutoCalc = useRef(false);
  const [name, setName] = useState("");
  const [cal, setCal] = useState("");
  const [prot, setProt] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [barcode, setBarcode] = useState("");

  const [unit, setUnit] = useState<FoodUnit>("g");

  const [submitting, setSubmitting] = useState(false);
  const [aiFillLoading, setAiFillLoading] = useState(false);
  const [aiFillSource, setAiFillSource] = useState<AiFood["source"] | null>(
    null,
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  useEffect(() => {
    const routeBarcode = Array.isArray(params.barcode)
      ? params.barcode[0]
      : params.barcode;
    if (!routeBarcode) return;

    const parsed = parseBarcode(routeBarcode);
    if (parsed.ok && parsed.barcode) {
      setBarcode(parsed.barcode);
      return;
    }

    setBarcode("");
    setFeedback({
      type: "warning",
      title: "Barcode not carried over",
      message: "Use a barcode containing 4 to 32 digits.",
    });
  }, [params.barcode]);

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
    const parsedBarcode = parseBarcode(barcode, { optional: true });
    if (!parsedBarcode.ok) {
      setFeedback({
        type: "warning",
        title: "Check the barcode",
        message: parsedBarcode.reason,
      });
      return;
    }

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
        barcode: parsedBarcode.barcode,
        ai_estimated: aiEstimated,
      },
    ]);

    if (error) {
      const duplicateBarcode =
        error.code === "23505" && parsedBarcode.barcode !== null;
      setFeedback({
        type: "error",
        title: duplicateBarcode ? "Barcode already saved" : "Could not save food",
        message: duplicateBarcode
          ? "This barcode is already saved in My Foods."
          : "Please try again. Your food details are still here.",
      });
      setSubmitting(false);
      return;
    }

    setFeedback({
      type: "success",
      title: "Saved!",
      message: "Food added to My Foods.",
      autoDismissMs: 1100,
      onClose: () => router.back(),
    });
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

        <Text style={styles.label}>Barcode number (optional)</Text>
        <TextInput
          accessibilityLabel="Barcode number"
          accessibilityHint="Optional. Used to recognize this food on future scans."
          inputMode="numeric"
          keyboardType="numeric"
          maxLength={32}
          onChangeText={(value) => setBarcode(sanitizeBarcodeInput(value))}
          placeholder="e.g. 4800016123456"
          placeholderTextColor={Colors.textSecondary}
          style={styles.input}
          value={barcode}
        />
        <Text style={styles.inputHelper}>
          Optional. Lets TrackBing recognize this food on future scans.
        </Text>

        <BeeGuide
          compact
          title="Want Bee to fill it?"
          message="Add a name, then Bee can draft per-serving macros you can edit."
          style={styles.aiFillCard}
          footer={aiFillSource ? <AiEstimateBadge source={aiFillSource} compact /> : null}
          action={
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
                <Text style={styles.aiFillBtnText}>AI fill</Text>
              )}
            </TouchableOpacity>
          }
        />

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
  inputHelper: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -12,
    marginBottom: 20,
  },
  aiFillCard: {
    marginTop: -8,
    marginBottom: 20,
    padding: 12,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
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
