import { UnitSystemToggle } from "@/src/components/nutrition/UnitSystemToggle";
import { TargetBreakdown } from "@/src/components/nutrition/TargetBreakdown";
import {
  SweetFeedback,
  type SweetFeedbackType,
} from "@/src/components/feedback/SweetFeedback";
import { useResponsive } from "@/src/hooks/useResponsive";
import { isCompactPhoneLayout } from "@/src/lib/responsiveLayout";
import {
  CUSTOM_RATE_LIMITS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  activityLevelFromStoredValue,
  activityLevelToStoredValue,
  calculateMacroGrams,
  calculateNutritionTarget,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isUnitSystem,
  kgToLb,
  lbToKg,
  resolveStoredGoalMode,
  validateMacroPercentages,
  type ActivityLevel,
  type BiologicalSex,
  type GoalMode,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { supabase } from "@/src/lib/supabase";
import { Colors } from "@/src/styles/colors";
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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const ACTIVITY_OPTIONS: readonly {
  label: string;
  value: ActivityLevel;
}[] = [
  { label: "Sedentary (Desk Job)", value: "sedentary" },
  { label: "Light Active (1-3 days)", value: "light" },
  { label: "Moderate (3-5 days)", value: "moderate" },
  { label: "Very Active (6-7 days)", value: "very_active" },
];

const GOAL_CHIPS: readonly { label: string; rate: number }[] = [
  { label: "Lose 0.25%", rate: GOAL_RATE_PRESETS.lose_slow },
  { label: "Lose 0.50%", rate: GOAL_RATE_PRESETS.lose },
  { label: "Lose 0.75%", rate: GOAL_RATE_PRESETS.lose_faster },
  { label: "Maintain", rate: GOAL_RATE_PRESETS.maintain },
  { label: "Gain 0.10%", rate: GOAL_RATE_PRESETS.gain_slow },
  { label: "Gain 0.25%", rate: GOAL_RATE_PRESETS.gain },
  { label: "Gain 0.50%", rate: GOAL_RATE_PRESETS.gain_faster },
];

const isEstimatedMode = (mode: GoalMode) =>
  mode === "estimated_rate" ||
  mode === "maintenance" ||
  mode === "minor_maintenance";

const isPresetRate = (rate: number) =>
  GOAL_CHIPS.some((preset) => Math.abs(preset.rate - rate) < 0.000001);

export function ProfileScreen() {
  const { isDesktop, width } = useResponsive();
  const isCompactPhone = isCompactPhoneLayout(width);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: SweetFeedbackType;
    title: string;
    message: string;
  } | null>(null);
  const [profileError, setProfileError] = useState("");

  // Canonical profile values remain kg/cm regardless of the selected display.
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [height, setHeight] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<BiologicalSex>("male");
  const [activityLevel, setActivityLevel] =
    useState<ActivityLevel>("sedentary");

  // Imperial fields are display mirrors. They never replace canonical storage.
  const [weightLb, setWeightLb] = useState("");
  const [targetWeightLb, setTargetWeightLb] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");

  const [goalMode, setGoalMode] = useState<GoalMode>("legacy_custom");
  const [goalRate, setGoalRate] = useState(0);
  const [targetResult, setTargetResult] =
    useState<NutritionTargetResult | null>(null);
  const [calories, setCalories] = useState(0);

  const [useCustomRate, setUseCustomRate] = useState(false);
  const [customDir, setCustomDir] = useState<"lose" | "gain">("lose");
  const [customPercent, setCustomPercent] = useState("0.50");

  const [pRatio, setPRatio] = useState(
    DEFAULT_MACRO_PERCENTAGES.protein.toString(),
  );
  const [cRatio, setCRatio] = useState(
    DEFAULT_MACRO_PERCENTAGES.carbs.toString(),
  );
  const [fRatio, setFRatio] = useState(
    DEFAULT_MACRO_PERCENTAGES.fat.toString(),
  );
  const [proteinGrams, setProteinGrams] = useState(0);
  const [carbsGrams, setCarbsGrams] = useState(0);
  const [fatGrams, setFatGrams] = useState(0);

  const isMinor = Number(age) >= 13 && Number(age) < 18;

  useEffect(() => {
    let mounted = true;

    const fetchProfile = async () => {
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (!mounted) return;
        if (authError) {
          setProfileError(authError.message);
          return;
        }
        if (!user) {
          setProfileError("Your profile could not be loaded. Please sign in again.");
          return;
        }

        const { data, error } = await supabase
          .from("user_goals")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle();

        if (!mounted) return;
        if (error) {
          setProfileError(error.message);
          return;
        }
        if (!data) {
          setProfileError("No saved profile was found for this account.");
          return;
        }

        const loadedUnitSystem = isUnitSystem(data.unit_system)
          ? data.unit_system
          : "metric";
        const loadedActivity = activityLevelFromStoredValue(
          data.activity_level,
        );
        const loadedAge = Number(data.age);
        const loadedWeight = Number(data.current_weight);
        const loadedHeight = Number(data.height);
        const hasLoadedTargetWeight = data.target_weight != null;
        const loadedTargetWeight = Number(data.target_weight);
        const loadedMode = resolveStoredGoalMode(data.goal_mode);
        const loadedRate =
          data.goal_rate == null ? 0 : Number(data.goal_rate);
        const loadedCalories = Number(data.calorie_target) || 0;
        const loadedSex: BiologicalSex =
          data.gender === "female" ? "female" : "male";

        setUnitSystem(loadedUnitSystem);
        setActivityLevel(loadedActivity);
        setWeight(Number.isFinite(loadedWeight) ? String(loadedWeight) : "");
        setTargetWeight(
          hasLoadedTargetWeight && Number.isFinite(loadedTargetWeight)
            ? String(loadedTargetWeight)
            : "",
        );
        setHeight(Number.isFinite(loadedHeight) ? String(loadedHeight) : "");
        setAge(Number.isFinite(loadedAge) ? String(loadedAge) : "");
        setGender(loadedSex);
        setCalories(loadedCalories);
        setPRatio(
          String(
            data.protein_ratio ?? DEFAULT_MACRO_PERCENTAGES.protein,
          ),
        );
        setCRatio(
          String(data.carbs_ratio ?? DEFAULT_MACRO_PERCENTAGES.carbs),
        );
        setFRatio(String(data.fat_ratio ?? DEFAULT_MACRO_PERCENTAGES.fat));

        if (loadedUnitSystem === "imperial") {
          setWeightLb(
            Number.isFinite(loadedWeight)
              ? kgToLb(loadedWeight).toFixed(1)
              : "",
          );
          setTargetWeightLb(
            hasLoadedTargetWeight && Number.isFinite(loadedTargetWeight)
              ? kgToLb(loadedTargetWeight).toFixed(1)
              : "",
          );
          if (Number.isFinite(loadedHeight)) {
            const convertedHeight = cmToFtIn(loadedHeight);
            setHeightFt(String(convertedHeight.feet));
            setHeightIn(String(convertedHeight.inches));
          }
        }

        let effectiveMode = loadedMode;
        if (isEstimatedMode(loadedMode)) {
          if (loadedAge < 18) {
            effectiveMode = "minor_maintenance";
          } else if (loadedMode === "minor_maintenance") {
            effectiveMode = "maintenance";
          }
        }
        const effectiveRate =
          effectiveMode === "estimated_rate" && Number.isFinite(loadedRate)
            ? loadedRate
            : 0;

        setGoalMode(effectiveMode);
        setGoalRate(effectiveRate);
        setUseCustomRate(
          effectiveMode === "estimated_rate" &&
            !isPresetRate(effectiveRate),
        );
        if (
          effectiveMode === "estimated_rate" &&
          !isPresetRate(effectiveRate)
        ) {
          setCustomDir(effectiveRate < 0 ? "lose" : "gain");
          setCustomPercent((Math.abs(effectiveRate) * 100).toFixed(2));
        }

        if (isEstimatedMode(effectiveMode)) {
          const input = {
            age: loadedAge,
            sex: loadedSex,
            weightKg: loadedWeight,
            heightCm: loadedHeight,
            activityLevel: loadedActivity,
            weeklyRate: effectiveRate,
          };
          const validationError = getBodyStatsValidationError(
            input,
            loadedUnitSystem,
          );
          if (validationError) {
            setProfileError(validationError);
            setTargetResult(null);
          } else {
            const result = calculateNutritionTarget(input);
            setTargetResult(result);
            setCalories(result.finalCalories);
          }
        } else {
          setTargetResult(null);
        }
      } catch (error) {
        if (mounted) {
          setProfileError(
            error instanceof Error
              ? error.message
              : "The profile could not be loaded.",
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void fetchProfile();
    return () => {
      mounted = false;
    };
  }, []);

  const recalculateEstimatedTarget = (
    overrides: {
      weightKg?: number;
      heightCm?: number;
      age?: number;
      sex?: BiologicalSex;
      activityLevel?: ActivityLevel;
      weeklyRate?: number;
      goalMode?: GoalMode;
    } = {},
  ): string | null => {
    const requestedMode = overrides.goalMode ?? goalMode;

    // Existing custom targets stay untouched until a plan is selected.
    if (
      requestedMode === "legacy_custom" ||
      requestedMode === "custom_calories"
    ) {
      return null;
    }

    const nextAge = overrides.age ?? Number(age);
    const nextMode: GoalMode =
      nextAge < 18
        ? "minor_maintenance"
        : requestedMode === "minor_maintenance"
          ? "maintenance"
          : requestedMode;
    const weeklyRate =
      nextMode === "maintenance" || nextMode === "minor_maintenance"
        ? 0
        : (overrides.weeklyRate ?? goalRate);
    const input = {
      age: nextAge,
      sex: overrides.sex ?? gender,
      weightKg: overrides.weightKg ?? Number(weight),
      heightCm: overrides.heightCm ?? Number(height),
      activityLevel: overrides.activityLevel ?? activityLevel,
      weeklyRate,
    };
    const validationError = getBodyStatsValidationError(input, unitSystem);

    if (validationError) {
      setTargetResult(null);
      return validationError;
    }

    try {
      const result = calculateNutritionTarget(input);
      setGoalMode(nextMode);
      setGoalRate(weeklyRate);
      setTargetResult(result);
      setCalories(result.finalCalories);
      setProfileError("");
      return null;
    } catch (error) {
      setTargetResult(null);
      return error instanceof Error
        ? error.message
        : "The calorie estimate could not be calculated.";
    }
  };

  const handleWeightKg = (value: string) => {
    setWeight(value);
    recalculateEstimatedTarget({ weightKg: Number(value) });
  };

  const handleTargetWeightKg = (value: string) => {
    setTargetWeight(value);
  };

  const handleHeightCm = (value: string) => {
    setHeight(value);
    recalculateEstimatedTarget({ heightCm: Number(value) });
  };

  const handleAge = (value: string) => {
    setAge(value);
    recalculateEstimatedTarget({ age: Number(value) });
  };

  const handleGender = (value: BiologicalSex) => {
    setGender(value);
    recalculateEstimatedTarget({ sex: value });
  };

  const handleActivityLevel = (value: ActivityLevel) => {
    setActivityLevel(value);
    recalculateEstimatedTarget({ activityLevel: value });
  };

  const handleWeightLb = (value: string) => {
    setWeightLb(value);
    const pounds = Number(value);
    const nextWeight =
      value.trim() !== "" && Number.isFinite(pounds)
        ? String(lbToKg(pounds))
        : "";
    setWeight(nextWeight);
    recalculateEstimatedTarget({ weightKg: Number(nextWeight) });
  };

  const handleTargetWeightLb = (value: string) => {
    setTargetWeightLb(value);
    const pounds = Number(value);
    setTargetWeight(
      value.trim() !== "" && Number.isFinite(pounds)
        ? String(lbToKg(pounds))
        : "",
    );
  };

  const updateImperialHeight = (feetValue: string, inchesValue: string) => {
    const feet = Number(feetValue);
    const inches = Number(inchesValue);
    const validParts =
      feetValue.trim() !== "" &&
      inchesValue.trim() !== "" &&
      Number.isFinite(feet) &&
      Number.isFinite(inches) &&
      inches >= 0 &&
      inches <= 11;
    const nextHeight = validParts ? String(ftInToCm(feet, inches)) : "";

    setHeight(nextHeight);
    recalculateEstimatedTarget({ heightCm: Number(nextHeight) });
  };

  const handleHeightFt = (value: string) => {
    setHeightFt(value);
    updateImperialHeight(value, heightIn);
  };

  const handleHeightIn = (value: string) => {
    setHeightIn(value);
    updateImperialHeight(heightFt, value);
  };

  const switchUnitSystem = (nextUnit: UnitSystem) => {
    if (nextUnit === unitSystem) return;

    if (nextUnit === "imperial") {
      const canonicalWeight = Number(weight);
      const canonicalTarget = Number(targetWeight);
      const canonicalHeight = Number(height);

      setWeightLb(
        weight.trim() !== "" && Number.isFinite(canonicalWeight)
          ? kgToLb(canonicalWeight).toFixed(1)
          : "",
      );
      setTargetWeightLb(
        targetWeight.trim() !== "" && Number.isFinite(canonicalTarget)
          ? kgToLb(canonicalTarget).toFixed(1)
          : "",
      );
      if (height.trim() !== "" && Number.isFinite(canonicalHeight)) {
        const convertedHeight = cmToFtIn(canonicalHeight);
        setHeightFt(String(convertedHeight.feet));
        setHeightIn(String(convertedHeight.inches));
      } else {
        setHeightFt("");
        setHeightIn("");
      }
    }

    setUnitSystem(nextUnit);
  };

  const showMessage = (
    title: string,
    message: string,
    type: SweetFeedbackType = "warning",
  ) => {
    setFeedback({ type, title, message });
  };

  const selectGoalRate = (rate: number) => {
    const nextMode: GoalMode =
      rate === 0 ? "maintenance" : "estimated_rate";
    const error = recalculateEstimatedTarget({
      weeklyRate: rate,
      goalMode: nextMode,
    });

    if (error) {
      showMessage("Invalid Stats", error);
      return;
    }
    setUseCustomRate(false);
  };

  const activateMinorMaintenance = () => {
    const error = recalculateEstimatedTarget({
      weeklyRate: 0,
      goalMode: "minor_maintenance",
    });

    if (error) {
      showMessage("Invalid Stats", error);
    }
  };

  const toggleCustomRate = () => {
    if (!useCustomRate) {
      const direction = goalRate > 0 ? "gain" : "lose";
      const percent =
        goalRate === 0 ? 0.5 : Math.abs(goalRate) * 100;
      setCustomDir(direction);
      setCustomPercent(percent.toFixed(2));
    }
    setUseCustomRate((current) => !current);
  };

  const applyCustomRate = () => {
    const percent = Number(customPercent);
    const limits =
      customDir === "lose"
        ? CUSTOM_RATE_LIMITS.lose
        : CUSTOM_RATE_LIMITS.gain;
    const magnitude = percent / 100;

    if (
      !Number.isFinite(percent) ||
      magnitude < limits.min ||
      magnitude > limits.max
    ) {
      showMessage(
        "Invalid Rate",
        customDir === "lose"
          ? "Loss rate must be between 0.25% and 1.0% per week."
          : "Gain rate must be between 0.1% and 0.5% per week.",
      );
      return;
    }

    const signedRate = customDir === "lose" ? -magnitude : magnitude;
    const error = recalculateEstimatedTarget({
      weeklyRate: signedRate,
      goalMode: "estimated_rate",
    });
    if (error) {
      showMessage("Invalid Stats", error);
      return;
    }
    setUseCustomRate(true);
  };

  useEffect(() => {
    const percentages = {
      protein: Number(pRatio),
      carbs: Number(cRatio),
      fat: Number(fRatio),
    };

    if (calories > 0 && validateMacroPercentages(percentages)) {
      const grams = calculateMacroGrams(calories, percentages);
      setProteinGrams(grams.protein);
      setCarbsGrams(grams.carbs);
      setFatGrams(grams.fat);
    } else {
      setProteinGrams(0);
      setCarbsGrams(0);
      setFatGrams(0);
    }
  }, [calories, pRatio, cRatio, fRatio]);

  const handleSave = async () => {
    if (unitSystem === "imperial") {
      const feet = Number(heightFt);
      const inches = Number(heightIn);
      if (
        heightFt.trim() === "" ||
        heightIn.trim() === "" ||
        !Number.isFinite(feet) ||
        !Number.isFinite(inches) ||
        inches < 0 ||
        inches > 11
      ) {
        showMessage("Invalid Height", "Inches must be between 0 and 11.");
        return;
      }
    }

    const bodyInput = {
      age: Number(age),
      sex: gender,
      weightKg: Number(weight),
      heightCm: Number(height),
      activityLevel,
      weeklyRate: isMinor ? 0 : goalRate,
    };
    const bodyError = getBodyStatsValidationError(bodyInput, unitSystem);
    if (bodyError) {
      showMessage("Invalid Stats", bodyError);
      return;
    }

    const savedTargetWeight = Number(targetWeight);
    if (
      !Number.isFinite(savedTargetWeight) ||
      savedTargetWeight < 30 ||
      savedTargetWeight > 300
    ) {
      showMessage(
        "Invalid Target",
        unitSystem === "metric"
          ? "Target weight must be between 30-300 kg."
          : "Target weight must be between 66.2-661.3 lb.",
      );
      return;
    }

    const percentages = {
      protein: Number(pRatio),
      carbs: Number(cRatio),
      fat: Number(fRatio),
    };
    if (!validateMacroPercentages(percentages)) {
      showMessage(
        "Macro Error",
        "Macro percentages must total exactly 100%.",
      );
      return;
    }

    const effectiveTargetResult =
      isMinor && goalMode !== "legacy_custom"
        ? calculateNutritionTarget(bodyInput)
        : targetResult;
    const savedCalories = effectiveTargetResult?.finalCalories ?? calories;
    if (!Number.isFinite(savedCalories) || savedCalories <= 0) {
      showMessage(
        "Invalid Target",
        "Select a calorie plan before saving this profile.",
      );
      return;
    }
    const grams = calculateMacroGrams(savedCalories, percentages);

    setSaving(true);
    setProfileError("");
    try {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Please sign in again before saving.");

      const updates: Record<string, string | number | null> = {
        user_id: user.id,
        current_weight: bodyInput.weightKg,
        target_weight: savedTargetWeight,
        height: bodyInput.heightCm,
        age: bodyInput.age,
        gender: bodyInput.sex,
        activity_level: activityLevelToStoredValue(activityLevel),
        calorie_target: savedCalories,
        unit_system: unitSystem,
        protein_ratio: percentages.protein,
        carbs_ratio: percentages.carbs,
        fat_ratio: percentages.fat,
        protein_grams: grams.protein,
        carbs_grams: grams.carbs,
        fat_grams: grams.fat,
      };

      const savedGoalMode: GoalMode =
        isMinor && goalMode !== "legacy_custom"
          ? "minor_maintenance"
          : goalMode;

      // Untouched legacy rows intentionally keep null goal metadata.
      if (savedGoalMode !== "legacy_custom") {
        updates.goal_mode = savedGoalMode;
        updates.goal_rate =
          savedGoalMode === "maintenance" ||
          savedGoalMode === "minor_maintenance" ||
          savedGoalMode === "custom_calories"
            ? null
            : goalRate;
      }

      const { error } = await supabase
        .from("user_goals")
        .upsert(updates, { onConflict: "user_id" });
      if (error) throw error;

      setCalories(savedCalories);
      if (effectiveTargetResult) setTargetResult(effectiveTargetResult);
      setGoalMode(savedGoalMode);
      if (savedGoalMode === "minor_maintenance") setGoalRate(0);
      setProteinGrams(grams.protein);
      setCarbsGrams(grams.carbs);
      setFatGrams(grams.fat);
      setFeedback({
        type: "success",
        title: "Profile saved",
        message: "Your profile has been updated and your goals are ready.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The profile could not be saved.";
      setProfileError(message);
      showMessage("Save failed", message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const renderBodyStats = (flush: boolean) => (
    <View style={[styles.card, flush && styles.flushCard]}>
      <View style={styles.cardHeader}>
        <Ruler color={Colors.accent} weight="fill" />
        <Text style={styles.cardTitle}>Body Stats</Text>
      </View>

      <View style={styles.unitToggleWrap}>
        <UnitSystemToggle value={unitSystem} onChange={switchUnitSystem} />
      </View>

      <View style={styles.inputRow}>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>
            {unitSystem === "metric" ? "CURRENT (KG)" : "CURRENT (LB)"}
          </Text>
          <TextInput
            accessibilityLabel="Current weight"
            value={unitSystem === "metric" ? weight : weightLb}
            onChangeText={
              unitSystem === "metric" ? handleWeightKg : handleWeightLb
            }
            keyboardType="numeric"
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#A8C0D6"
          />
        </View>
        <View style={styles.inputContainer}>
          <Text style={styles.label}>
            {unitSystem === "metric" ? "TARGET (KG)" : "TARGET (LB)"}
          </Text>
          <TextInput
            accessibilityLabel="Target weight"
            value={unitSystem === "metric" ? targetWeight : targetWeightLb}
            onChangeText={
              unitSystem === "metric"
                ? handleTargetWeightKg
                : handleTargetWeightLb
            }
            keyboardType="numeric"
            style={styles.input}
            placeholder="0"
            placeholderTextColor="#A8C0D6"
          />
        </View>
      </View>

      {unitSystem === "metric" ? (
        <View style={styles.inputRow}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>HEIGHT (CM)</Text>
            <TextInput
              accessibilityLabel="Height in centimeters"
              value={height}
              onChangeText={handleHeightCm}
              keyboardType="numeric"
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#A8C0D6"
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>AGE (YRS)</Text>
            <TextInput
              accessibilityLabel="Age in years"
              value={age}
              onChangeText={handleAge}
              keyboardType="numeric"
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#A8C0D6"
            />
          </View>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>HEIGHT (FT)</Text>
            <TextInput
              accessibilityLabel="Height feet"
              value={heightFt}
              onChangeText={handleHeightFt}
              keyboardType="numeric"
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#A8C0D6"
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>HEIGHT (IN)</Text>
            <TextInput
              accessibilityLabel="Height inches"
              value={heightIn}
              onChangeText={handleHeightIn}
              keyboardType="numeric"
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#A8C0D6"
            />
          </View>
          <View style={styles.inputContainer}>
            <Text style={styles.label}>AGE (YRS)</Text>
            <TextInput
              accessibilityLabel="Age in years"
              value={age}
              onChangeText={handleAge}
              keyboardType="numeric"
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#A8C0D6"
            />
          </View>
        </View>
      )}

      <View style={styles.genderSection}>
        <Text style={styles.label}>GENDER</Text>
        <View style={styles.genderRow}>
          {(["male", "female"] as const).map((option) => {
            const active = gender === option;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={option}
                style={[styles.genderBtn, active && styles.genderBtnActive]}
                onPress={() => handleGender(option)}
              >
                <Text
                  style={[
                    styles.genderText,
                    active && styles.selectedText,
                  ]}
                >
                  {option === "male" ? "Male" : "Female"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderActivityCard = (flush: boolean) => (
    <View style={[styles.card, flush && styles.flushCard]}>
      <View style={styles.cardHeader}>
        <Lightning color={Colors.accent} weight="fill" />
        <Text style={styles.cardTitle}>Activity Level</Text>
      </View>
      <View style={styles.activityList}>
        {ACTIVITY_OPTIONS.map((option) => {
          const active = activityLevel === option.value;
          return (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={option.value}
              style={[
                styles.activityOption,
                active && styles.activityActive,
              ]}
              onPress={() => handleActivityLevel(option.value)}
            >
              <Text
                style={[
                  styles.activityText,
                  active && styles.activityTextActive,
                ]}
              >
                {option.label}
              </Text>
              {active && (
                <CheckCircle
                  size={16}
                  color={Colors.accentBlue}
                  weight="fill"
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderGoalCard = (flush: boolean) => {
    const customLimits =
      customDir === "lose"
        ? CUSTOM_RATE_LIMITS.lose
        : CUSTOM_RATE_LIMITS.gain;
    const preservedCustom =
      goalMode === "legacy_custom" || goalMode === "custom_calories";
    const goalChipControls = GOAL_CHIPS.map((item) => {
      const active =
        !useCustomRate &&
        ((goalMode === "maintenance" && item.rate === 0) ||
          (goalMode === "estimated_rate" &&
            Math.abs(goalRate - item.rate) < 0.000001));
      return (
        <TouchableOpacity
          accessibilityRole="radio"
          accessibilityState={{ checked: active }}
          hitSlop={4}
          key={item.label}
          onPress={() => selectGoalRate(item.rate)}
          style={[
            styles.goalPill,
            !isDesktop && styles.goalPillMobile,
            active ? styles.goalPillActive : styles.goalPillIdle,
          ]}
        >
          <Text
            style={[
              styles.goalPillText,
              active && styles.selectedText,
            ]}
          >
            {item.label}
          </Text>
        </TouchableOpacity>
      );
    });

    return (
      <View style={[styles.card, flush && styles.flushCard]}>
        <View style={styles.cardHeader}>
          <Target color={Colors.accent} weight="fill" />
          <Text style={styles.cardTitle}>Calculated Goal</Text>
        </View>

        {isMinor ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>
              Maintain for healthy growth
            </Text>
            <Text style={styles.noticeText}>
              TrackBing does not provide loss, gain, or custom calorie plans
              for ages 13-17. Ask a qualified health professional about
              weight-change goals.
            </Text>
            {preservedCustom && (
              <>
                <Text style={styles.noticeText}>
                  {goalMode === "legacy_custom"
                    ? `Your saved ${calories} kcal target remains unchanged until you choose the maintenance estimate.`
                    : `Your saved ${calories} kcal custom target will be replaced with the maintenance estimate when you save.`}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={activateMinorMaintenance}
                  style={styles.noticeAction}
                >
                  <Text style={styles.noticeActionText}>
                    Use maintenance estimate
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : goalMode === "legacy_custom" ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Existing custom target</Text>
            <Text style={styles.noticeText}>
              Your saved {calories} kcal target is unchanged. Select a plan
              below to replace it with a new estimate.
            </Text>
          </View>
        ) : goalMode === "custom_calories" ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Custom calorie target</Text>
            <Text style={styles.noticeText}>
              Your saved {calories} kcal target is unchanged. Select a plan
              below to replace it with a new estimate.
            </Text>
          </View>
        ) : null}

        {!isMinor && (
          <>
            {isDesktop ? (
              <View
                accessibilityRole="radiogroup"
                style={styles.goalPillGrid}
              >
                {goalChipControls}
              </View>
            ) : (
              <ScrollView
                accessibilityRole="radiogroup"
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.goalScroller}
                contentContainerStyle={styles.goalScrollerContent}
              >
                {goalChipControls}
              </ScrollView>
            )}

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: useCustomRate }}
              onPress={toggleCustomRate}
              style={[
                styles.customToggle,
                useCustomRate && styles.customToggleActive,
              ]}
            >
              <Text
                style={[
                  styles.customToggleText,
                  useCustomRate && styles.customToggleTextActive,
                ]}
              >
                Advanced: custom rate
              </Text>
            </TouchableOpacity>

            {useCustomRate && (
              <View style={styles.customBlock}>
                <View
                  accessibilityRole="radiogroup"
                  style={[
                    styles.customDirRow,
                    isCompactPhone && styles.customDirRowCompact,
                  ]}
                >
                  {(["lose", "gain"] as const).map((direction) => {
                    const active = customDir === direction;
                    return (
                      <TouchableOpacity
                        accessibilityRole="radio"
                        accessibilityState={{ checked: active }}
                        hitSlop={4}
                        key={direction}
                        onPress={() => setCustomDir(direction)}
                        style={[
                          styles.customDirBtn,
                          isCompactPhone && styles.customDirBtnCompact,
                          active && styles.customDirActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.customDirText,
                            active && styles.selectedText,
                          ]}
                        >
                          {direction === "lose" ? "Lose" : "Gain"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  <View
                    style={[
                      styles.customPctWrap,
                      isCompactPhone && styles.customPctWrapCompact,
                    ]}
                  >
                    <TextInput
                      accessibilityLabel="Custom weekly percentage"
                      value={customPercent}
                      onChangeText={setCustomPercent}
                      keyboardType="numeric"
                      style={styles.customPctInput}
                      placeholder="0.50"
                      placeholderTextColor="#A8C0D6"
                    />
                    <Text style={styles.customPctUnit}>% / wk</Text>
                  </View>
                </View>
                <Text style={styles.customHint}>
                  {customDir === "lose" ? "Loss" : "Gain"} allowed{" "}
                  {customLimits.min * 100}% - {customLimits.max * 100}% of body
                  weight per week.
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={applyCustomRate}
                  style={styles.customApplyButton}
                >
                  <Text style={styles.customApplyText}>
                    Apply custom rate
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {targetResult && Number.isFinite(Number(weight)) ? (
          <TargetBreakdown
            result={targetResult}
            weightKg={Number(weight)}
            unitSystem={unitSystem}
          />
        ) : (
          <View style={styles.caloriesBox}>
            <Text style={styles.caloriesValue}>{calories}</Text>
            <Text style={styles.caloriesUnit}>kcal / day</Text>
          </View>
        )}

        <Text style={styles.calculatorNotice}>
          Estimates are not intended for pregnancy, breastfeeding,
          eating-disorder treatment or recovery, or clinician-managed
          nutrition therapy.
        </Text>
      </View>
    );
  };

  const renderMacrosCard = (flush: boolean) => (
    <View style={[styles.card, flush && styles.flushCard]}>
      <View style={styles.cardHeader}>
        <Barbell color={Colors.accent} weight="fill" />
        <Text style={styles.cardTitle}>Macros (%)</Text>
      </View>

      <View style={styles.macroInputs}>
        {[
          { label: "Prot", value: pRatio, setter: setPRatio, color: "#3b82f6" },
          { label: "Carb", value: cRatio, setter: setCRatio, color: "#22c55e" },
          { label: "Fat", value: fRatio, setter: setFRatio, color: "#ef4444" },
        ].map((macro) => (
          <View key={macro.label} style={styles.macroInput}>
            <Text style={[styles.macroInputLabel, { color: macro.color }]}>
              {macro.label}
            </Text>
            <TextInput
              accessibilityLabel={`${macro.label} percentage`}
              value={macro.value}
              onChangeText={macro.setter}
              keyboardType="numeric"
              maxLength={3}
              style={styles.input}
            />
          </View>
        ))}
      </View>

      <View style={styles.gramsPreview}>
        <Text style={styles.gramsLabel}>Calculated Daily Targets:</Text>
        <View style={styles.gramsRow}>
          <View style={styles.gramItem}>
            <Text style={[styles.gramValue, { color: "#3b82f6" }]}>
              {proteinGrams}g
            </Text>
            <Text style={styles.gramLabel}>Protein</Text>
          </View>
          <View style={styles.gramItem}>
            <Text style={[styles.gramValue, { color: "#22c55e" }]}>
              {carbsGrams}g
            </Text>
            <Text style={styles.gramLabel}>Carbs</Text>
          </View>
          <View style={styles.gramItem}>
            <Text style={[styles.gramValue, { color: "#ef4444" }]}>
              {fatGrams}g
            </Text>
            <Text style={styles.gramLabel}>Fat</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderSaveButton = () => (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={handleSave}
      disabled={saving}
      style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
    >
      {saving ? (
        <ActivityIndicator color={Colors.textOnAccent} />
      ) : (
        <>
          <FloppyDisk
            size={20}
            color={Colors.textOnAccent}
            weight="bold"
          />
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={isDesktop ? [] : ["top", "left", "right"]}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          isDesktop ? styles.desktopContent : styles.mobileContent,
        ]}
      >
        <View style={styles.headerRow}>
          {!isDesktop ? (
            <>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => router.back()}
                style={styles.backBtn}
              >
                <CaretLeft size={24} color={Colors.accent} />
                <Text style={styles.backText}>Back</Text>
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Profile</Text>
              <TouchableOpacity
                accessibilityLabel="Sign out"
                accessibilityRole="button"
                onPress={handleLogout}
              >
                <SignOut size={24} color={Colors.error} />
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.headerTitle}>Profile Settings</Text>
          )}
        </View>

        {profileError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{profileError}</Text>
          </View>
        ) : null}

        {isDesktop ? (
          <View style={styles.desktopColumns}>
            <View style={styles.desktopColumn}>
              {renderBodyStats(true)}
              {renderActivityCard(true)}
            </View>
            <View style={styles.desktopColumn}>
              {renderGoalCard(true)}
              {renderMacrosCard(true)}
              {renderSaveButton()}
            </View>
          </View>
        ) : (
          <>
            {renderBodyStats(false)}
            {renderActivityCard(false)}
            {renderGoalCard(false)}
            {renderMacrosCard(false)}
            {renderSaveButton()}
          </>
        )}
      </ScrollView>

      <SweetFeedback
        visible={feedback !== null}
        type={feedback?.type}
        title={feedback?.title ?? ""}
        message={feedback?.message}
        onClose={() => setFeedback(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: "100%",
    padding: 18,
    paddingBottom: 100,
  },
  desktopContent: {
    maxWidth: 1280,
    alignSelf: "center",
  },
  mobileContent: {
    maxWidth: 520,
    alignSelf: "center",
  },
  desktopColumns: {
    flexDirection: "row",
    gap: 24,
    marginTop: 16,
    alignItems: "flex-start",
  },
  desktopColumn: {
    flex: 1,
    minWidth: 0,
    gap: 16,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  backText: {
    color: Colors.accent,
    fontWeight: "700",
    fontSize: 15,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  errorBox: {
    padding: 12,
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 12,
    lineHeight: 17,
  },
  card: {
    backgroundColor: Colors.secondary,
    padding: 20,
    borderRadius: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  flushCard: {
    marginBottom: 0,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
    gap: 10,
  },
  cardTitle: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 16,
    letterSpacing: -0.1,
  },
  unitToggleWrap: {
    marginBottom: 16,
  },
  inputRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 14,
  },
  inputContainer: {
    flex: 1,
  },
  label: {
    color: Colors.textMuted,
    fontSize: 10,
    marginBottom: 6,
    textTransform: "uppercase",
    fontWeight: "700",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: Colors.inputBg,
    color: Colors.text,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 12,
    textAlign: "center",
    fontWeight: "700",
    fontSize: 17,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  genderSection: {
    marginTop: 15,
  },
  genderRow: {
    flexDirection: "row",
    gap: 10,
  },
  genderBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  genderBtnActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  genderText: {
    color: Colors.textSecondary,
    fontWeight: "700",
    fontSize: 14,
  },
  selectedText: {
    color: Colors.textOnAccent,
  },
  activityList: {
    gap: 8,
  },
  activityOption: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 14,
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  activityActive: {
    borderColor: Colors.accentBlue,
    backgroundColor: Colors.accentBlue + "33",
  },
  activityText: {
    color: Colors.textSecondary,
    fontWeight: "600",
  },
  activityTextActive: {
    color: Colors.accentBlue,
  },
  noticeBox: {
    padding: 14,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
    gap: 7,
  },
  noticeTitle: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: "800",
  },
  noticeText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  noticeAction: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 5,
    borderRadius: 10,
    backgroundColor: Colors.accent,
  },
  noticeActionText: {
    color: Colors.textOnAccent,
    fontSize: 12,
    fontWeight: "800",
  },
  goalScroller: {
    marginBottom: 16,
  },
  goalScrollerContent: {
    paddingRight: 8,
  },
  goalPillGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  goalPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    minWidth: 96,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  goalPillMobile: {
    marginRight: 8,
  },
  goalPillActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  goalPillIdle: {
    backgroundColor: Colors.inputBg,
  },
  goalPillText: {
    color: Colors.text,
    fontWeight: "700",
    fontSize: 12,
  },
  customToggle: {
    alignItems: "center",
    paddingVertical: 11,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  customToggleActive: {
    borderColor: Colors.accentBlue,
  },
  customToggleText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  customToggleTextActive: {
    color: Colors.accentBlue,
  },
  customBlock: {
    gap: 10,
    padding: 12,
    marginBottom: 14,
    borderRadius: 12,
    backgroundColor: Colors.inputBg,
  },
  customDirRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  customDirRowCompact: {
    flexWrap: "wrap",
  },
  customDirBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  customDirBtnCompact: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  customDirActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  customDirText: {
    color: Colors.textSecondary,
    fontWeight: "700",
  },
  customPctWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  customPctWrapCompact: {
    flexBasis: "100%",
    minWidth: 0,
  },
  customPctInput: {
    flex: 1,
    minWidth: 0,
    color: Colors.text,
    paddingVertical: 10,
    paddingHorizontal: 12,
    textAlign: "right",
    fontWeight: "700",
  },
  customPctUnit: {
    color: Colors.textMuted,
    paddingRight: 10,
    fontSize: 12,
  },
  customHint: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  customApplyButton: {
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.accent,
  },
  customApplyText: {
    color: Colors.textOnAccent,
    fontSize: 12,
    fontWeight: "800",
  },
  caloriesBox: {
    backgroundColor: Colors.inputBg,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  caloriesValue: {
    color: Colors.accent,
    fontSize: 32,
    fontWeight: "bold",
  },
  caloriesUnit: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: "bold",
  },
  calculatorNotice: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 12,
  },
  macroInputs: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 15,
  },
  macroInput: {
    flex: 1,
  },
  macroInputLabel: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 5,
  },
  gramsPreview: {
    backgroundColor: Colors.inputBg,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gramsLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  gramsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  gramItem: {
    alignItems: "center",
  },
  gramValue: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  gramLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    paddingVertical: 18,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: Colors.textOnAccent,
    fontWeight: "800",
    fontSize: 16,
    letterSpacing: 0.2,
  },
});
