import { useLocalSearchParams, useRouter } from "expo-router";
import { Calculator, CheckCircle, X } from "@/src/components/icons";
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
import { BeeGroundedAnswerDialog } from "@/src/components/ai/BeeGroundedAnswer.dialog";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { requestAiFood, type AiFood } from "@/src/lib/aiFood";
import type { GroundedAnswer } from "@/src/lib/beeChat";
import {
  getAiFoodFeedback,
  shouldMarkAiEstimated,
} from "@/src/lib/aiFoodUi";
import {
  parseBarcode,
  sanitizeBarcodeInput,
} from "@/src/lib/barcodes";
import { calculateCaloriesFromMacros } from "@/src/lib/macros";
import { parseManualFood, parseServingGrams } from "@/src/lib/foodValidation";
import { createFoodAccountGuard } from "@/src/lib/foodAccountGuard";
import { emitFoodLibraryChanged } from "@/src/lib/foodLibraryEvents";
import { toPersonalFoodItem } from "@/src/lib/foodSearch";
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
const BARCODE_UNITS = ["serving", "g"] as const;

const formatMacroInput = (value: number) => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

export default function CreateFoodPage() {
  const router = useRouter();
  const params = useLocalSearchParams<{ barcode?: string | string[]; labelName?: string; recipeRequest?: string }>();
  const recipeRequest = typeof params.recipeRequest === "string" && /^[\da-f-]{36}$/i.test(params.recipeRequest)
    ? params.recipeRequest : null;
  const { width, isDesktop } = useResponsive();
  const compactForm = width < 390;
  const accountRef = useRef<ReturnType<typeof createFoodAccountGuard> | null>(null);
  useEffect(() => {
    const guard = createFoodAccountGuard();
    accountRef.current = guard;
    void (async () => {
      const account = await guard.authorize();
      if (!account?.isActive()) return;
      const { data, error } = await account.client.rpc("can_share_barcodes");
      if (account.isActive() && !error) setCanShareBarcode(data === true);
    })().catch(() => console.warn("Barcode sharing permission could not load"));
    return () => { guard.dispose(); accountRef.current = null; };
  }, []);
  const [name, setName] = useState("");
  const [prot, setProt] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [barcode, setBarcode] = useState("");
  const [labelCalories, setLabelCalories] = useState("");
  const [servingWeight, setServingWeight] = useState("");
  const [canShareBarcode, setCanShareBarcode] = useState(false);
  const [shareBarcode, setShareBarcode] = useState(false);
  const [unit, setUnit] = useState<FoodUnit>("serving");
  const hasBarcode = barcode.length > 0;
  const basis = hasBarcode && unit !== "g" ? "serving" : unit;
  const servingGrams = basis === "serving" ? parseServingGrams(servingWeight) : null;
  const labelEnergy = hasBarcode ? labelCalories : basis === "serving" ? labelCalories.trim() || undefined : undefined;

  const [submitting, setSubmitting] = useState(false);
  const [aiFillLoading, setAiFillLoading] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState<GroundedAnswer | null>(null);
  const [aiFillSource, setAiFillSource] = useState<AiFood["source"] | null>(
    null,
  );
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const calculatedCalories = calculateCaloriesFromMacros(
    parseFloat(prot),
    parseFloat(carbs),
    parseFloat(fat),
  );

  useEffect(() => {
    const routeBarcode = Array.isArray(params.barcode)
      ? params.barcode[0]
      : params.barcode;
    if (!routeBarcode) return;

    const parsed = parseBarcode(routeBarcode);
    if (parsed.ok && parsed.barcode) {
      setBarcode(parsed.barcode);
      setUnit("serving");
      if (typeof params.labelName === "string") setName(params.labelName.trim().slice(0, 160));
      return;
    }

    setBarcode("");
    setFeedback({
      type: "warning",
      title: "Barcode not carried over",
      message: "Use a barcode containing 4 to 32 digits.",
    });
  }, [params.barcode, params.labelName]);

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

    if (basis === "serving" && servingWeight.trim() && servingGrams === null) {
      setFeedback({ type: "warning", title: "Check the serving weight", message: "Enter a serving weight above 0 and up to 10,000 g." });
      return;
    }

    const checked = parseManualFood(name, prot, carbs, fat, labelEnergy);
    if (!checked.ok) {
      setFeedback({ type: "warning", title: "Check the food values", message: checked.message });
      return;
    }

    const aiEstimated = aiFillSource
      ? shouldMarkAiEstimated({ source: aiFillSource })
      : false;

    setSubmitting(true);
    const guard = accountRef.current;
    const writer = await guard?.authorize();
    if (!writer?.isActive()) {
      if (!guard?.isActive()) return;
      setSubmitting(false);
      setFeedback({
        type: "warning",
        title: "Sign in required",
        message: "Please sign in again before saving this food.",
      });
      return;
    }

    if (!writer.isActive()) return;
    const row = {
      user_id: writer.userId,
      name: checked.value.name,
      calories: checked.value.calories,
      protein: checked.value.protein,
      carbs: checked.value.carbs,
      fat: checked.value.fat,
      default_unit: basis,
      serving_grams: servingGrams,
      barcode: parsedBarcode.barcode,
      ai_estimated: aiEstimated,
      ...(canShareBarcode && shareBarcode && parsedBarcode.barcode ? { share_barcode: true } : {}),
    };
    const insert = writer.client.from("personal_foods").insert([row]);
    const { data, error } = await (recipeRequest ? insert.select("id").single() : insert);
    if (!writer.isActive()) return;

    if (error || (recipeRequest && typeof data?.id !== "string")) {
      const duplicateBarcode =
        error?.code === "23505" && parsedBarcode.barcode !== null;
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

    emitFoodLibraryChanged("personal_food", recipeRequest && data ? {
      requestId: recipeRequest,
      userId: writer.userId,
      food: toPersonalFoodItem({ ...row, id: data.id }),
    } : undefined);
    setFeedback({
      type: "success",
      title: "Saved!",
      message: canShareBarcode && shareBarcode && parsedBarcode.barcode
        ? "Food saved to My Foods and shared for barcode lookup."
        : "Food saved to your My Foods.",
      autoDismissMs: 1100,
      onClose: () => router.canGoBack() ? router.back() : router.replace("/my-foods"),
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
    setLiveAnswer(null);
    const result = await requestAiFood(trimmed, "fill");
    setAiFillLoading(false);

    if (!result.ok) {
      if (result.reason === "answer_only") {
        setLiveAnswer(result.answer);
        return;
      }
      setFeedback({ ...getAiFoodFeedback(result.reason), ...(result.reason === "needs_input" ? { message: result.message } : {}) });
      return;
    }

    setUnit("serving");
    setServingWeight("");
    setLabelCalories("");
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

  const isPer100 = basis === "g" || basis === "ml";
  const unitLabel = basis === "serving"
    ? servingGrams === null ? "(per serving)" : `(per ${servingGrams} g serving)`
    : `(per ${isPer100 ? "100" : "1"} ${basis})`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Create My Food</Text>
        <TouchableOpacity
          accessibilityLabel="Close create food"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={styles.closeBtn}
        >
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
            {hasBarcode
              ? "Copy the calories and macros from the same column on the package label."
              : "Enter the nutrition for the selected basis. TrackBing can calculate calories from macros if you leave label calories blank."}
          </Text>
        </View>

        <Text style={styles.label}>Food Name</Text>
        <TextInput
          style={styles.input}
          accessibilityLabel="Food name"
          maxLength={160}
          placeholder="e.g. Mama's Adobo"
          placeholderTextColor={Colors.textMuted}
          value={name}
          onChangeText={(value) => { setName(value); setAiFillSource(null); }}
          autoFocus
        />

        <Text style={styles.label}>Barcode number (optional)</Text>
        <TextInput
          accessibilityLabel="Barcode number"
          accessibilityHint="Optional. Used to recognize this food on future scans."
          inputMode="numeric"
          editable={!aiFillLoading && !submitting}
          keyboardType="numeric"
          maxLength={32}
          onChangeText={(value) => {
            const next = sanitizeBarcodeInput(value);
            if (!barcode && next) {
              setUnit("serving");
              setAiFillSource(null);
            }
            setBarcode(next);
            setShareBarcode(false);
          }}
          placeholder="e.g. 4800016123456"
          placeholderTextColor={Colors.textSecondary}
          style={styles.input}
          value={barcode}
        />
        <Text style={styles.inputHelper}>
          Saved to your account for future scans.
        </Text>

        {!hasBarcode ? <BeeGuide
          compact
          interactive={!aiFillLoading}
          situation={
            aiFillLoading
              ? "searching"
              : aiFillSource
                ? "reviewingMatch"
                : "emptyCollection"
          }
          title="Want Bee to fill it?"
          message="Add a name and portion, then Bee checks matching food records. Review the values before saving."
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
        /> : null}

        <Text style={styles.label}>{hasBarcode ? "Nutrition on the label" : "Nutrition basis"}</Text>
        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          {(hasBarcode ? BARCODE_UNITS : FOOD_UNITS).map((u) => (
            <TouchableOpacity
              accessibilityRole={hasBarcode ? "radio" : "button"}
              aria-checked={hasBarcode ? basis === u : undefined}
              accessibilityState={hasBarcode ? { checked: basis === u } : { selected: basis === u }}
              key={u}
              onPress={() => { setUnit(u); setAiFillSource(null); }}
              style={{
                backgroundColor: basis === u ? Colors.accent : "#333",
                paddingHorizontal: 20,
                paddingVertical: 10,
                borderRadius: 15,
                minWidth: 60,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: basis === u ? "black" : "white",
                  fontWeight: "bold",
                }}
              >
                {u === "serving" ? "Per serving" : u === "g" ? "Per 100 g" : u}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {basis === "serving" ? (
          <>
            <Text style={styles.label}>Serving weight (g)</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="Serving weight in grams"
              placeholder="e.g. 35"
              placeholderTextColor={Colors.textMuted}
              inputMode="decimal"
              keyboardType="decimal-pad"
              maxLength={16}
              editable={!submitting && !aiFillLoading}
              value={servingWeight}
              onChangeText={setServingWeight}
            />
            <Text style={styles.inputHelper}>
              Enter the weight of one serving to log this food in grams. Leave blank if you only know the serving count.
            </Text>
          </>
        ) : null}

        <View style={[styles.grid, compactForm && styles.gridCompact]}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Protein {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              accessibilityLabel="Protein in grams"
              maxLength={16}
              value={prot}
              onChangeText={(t) => { setProt(t); setAiFillSource(null); }}
            />
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Carbs {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              accessibilityLabel="Carbohydrate in grams"
              maxLength={16}
              value={carbs}
              onChangeText={(t) => { setCarbs(t); setAiFillSource(null); }}
            />
          </View>
        </View>

        <View style={[styles.grid, compactForm && styles.gridCompact]}>
          <View style={styles.gridItem}>
            <Text style={styles.label}>Fat {unitLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              accessibilityLabel="Fat in grams"
              maxLength={16}
              value={fat}
              onChangeText={(t) => { setFat(t); setAiFillSource(null); }}
            />
          </View>

          <View style={styles.gridItem}>
            <Text style={{ ...styles.label, color: Colors.accent }}>
              {hasBarcode || basis === "serving" ? `Calories ${unitLabel}` : "Calories"}
            </Text>
            {hasBarcode || basis === "serving" ? (
              <TextInput
                style={styles.input}
                placeholder={hasBarcode ? "kcal from label" : `${calculatedCalories} kcal from macros`}
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Calories from label"
                maxLength={16}
                value={labelCalories}
                onChangeText={setLabelCalories}
              />
            ) : <View
              accessible
              accessibilityLabel={`${calculatedCalories} calories, calculated from macros`}
              style={styles.calorieReadout}
            >
              <Text style={styles.calorieValue}>{calculatedCalories}</Text>
              <Text style={styles.calorieHelper}>Calculated from macros</Text>
            </View>}
          </View>
        </View>

        {hasBarcode && canShareBarcode ? (
          <TouchableOpacity
            accessibilityRole="checkbox"
            aria-checked={shareBarcode}
            accessibilityState={{ checked: shareBarcode }}
            onPress={() => setShareBarcode((current) => !current)}
            disabled={submitting}
            style={styles.shareOption}
          >
            <CheckCircle size={22} color={shareBarcode ? Colors.accent : Colors.textSecondary} weight={shareBarcode ? "fill" : "regular"} />
            <Text style={styles.infoText}>Share this label with TrackBing users who scan this barcode</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
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
      <BeeGroundedAnswerDialog
        answer={liveAnswer}
        onClose={() => setLiveAnswer(null)}
        onManual={() => setLiveAnswer(null)}
        onScan={() => { setLiveAnswer(null); router.push("/scan"); }}
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
  shareOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: Colors.surface,
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
  calorieReadout: {
    minHeight: 55,
    backgroundColor: Colors.secondary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 9,
    marginBottom: 20,
    justifyContent: "center",
  },
  calorieValue: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: "800",
  },
  calorieHelper: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
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
