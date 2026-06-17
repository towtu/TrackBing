import React, { useState } from "react";
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    ScrollView,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from "react-native";
import { createClient, type Session } from "@supabase/supabase-js";
import { EnvelopeSimple, LockKey } from "phosphor-react-native";
import { supabase } from "@/src/lib/supabase";
import {
  ACTIVITY_MULTIPLIERS,
  DEFAULT_MACRO_PERCENTAGES,
  GOAL_RATE_PRESETS,
  activityLevelToStoredValue,
  calculateMacroGrams,
  calculateNutritionTarget,
  cmToFtIn,
  ftInToCm,
  getBodyStatsValidationError,
  isValidImperialHeight,
  kgToLb,
  lbToKg,
  type ActivityLevel,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { TargetBreakdown } from "@/src/components/nutrition/TargetBreakdown";
import { UnitSystemToggle } from "@/src/components/nutrition/UnitSystemToggle";
import { AuthStyles as styles } from "@/src/styles/auth";
import { Colors } from "@/src/styles/colors";
import { router } from "expo-router";
import { useResponsive } from "@/src/hooks/useResponsive";

const ACTIVITY_OPTIONS: readonly {
  label: string;
  sub: string;
  value: ActivityLevel;
  emoji: string;
}[] = [
  {
    label: "Sedentary",
    sub: "Office / desk job",
    value: "sedentary",
    emoji: "💼",
  },
  {
    label: "Light Active",
    sub: "1-3 days / week",
    value: "light",
    emoji: "🚶",
  },
  {
    label: "Moderate",
    sub: "3-5 days / week",
    value: "moderate",
    emoji: "🏋️",
  },
  {
    label: "Very Active",
    sub: "6-7 days / week",
    value: "very_active",
    emoji: "🔥",
  },
];

const SIGNUP_GOAL_OPTIONS = [
  {
    label: "Lose Slowly",
    sub: "-0.25% / wk",
    value: GOAL_RATE_PRESETS.lose_slow,
    emoji: "🐢",
  },
  {
    label: "Lose",
    sub: "-0.50% / wk",
    value: GOAL_RATE_PRESETS.lose,
    emoji: "🎯",
  },
  {
    label: "Lose Faster",
    sub: "-0.75% / wk",
    value: GOAL_RATE_PRESETS.lose_faster,
    emoji: "📉",
  },
  {
    label: "Maintain",
    sub: "0% / wk",
    value: GOAL_RATE_PRESETS.maintain,
    emoji: "⚖️",
  },
  {
    label: "Gain Slowly",
    sub: "+0.10% / wk",
    value: GOAL_RATE_PRESETS.gain_slow,
    emoji: "📈",
  },
  {
    label: "Gain",
    sub: "+0.25% / wk",
    value: GOAL_RATE_PRESETS.gain,
    emoji: "💪",
  },
  {
    label: "Gain Faster",
    sub: "+0.50% / wk",
    value: GOAL_RATE_PRESETS.gain_faster,
    emoji: "🔥",
  },
] as const;

const parseDisplay = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundDisplay = (value: number | null) =>
  value === null ? "" : String(Math.round(value * 10) / 10);

// Keep OTP verification isolated so the app does not enter authenticated
// routes until the initial user_goals row has been saved successfully.
const signupVerificationClient = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

export function AuthScreen() {
  const { isDesktop } = useResponsive();

  // --- STATE ---
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState(1); // 1=Stats, 2=Auth, 3=Verify
  const [loading, setLoading] = useState(false);

  // --- MODAL STATE ---
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");

  // --- USER DATA ---
  const [unitSystem, setUnitSystem] = useState<UnitSystem>("metric");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [age, setAge] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [weightLb, setWeightLb] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [activityLevel, setActivityLevel] =
    useState<ActivityLevel>("sedentary");
  const [goalRate, setGoalRate] = useState<number>(
    GOAL_RATE_PRESETS.maintain,
  );
  const [targetResult, setTargetResult] =
    useState<NutritionTargetResult | null>(null);

  // --- AUTH DATA ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verifiedSignupSession, setVerifiedSignupSession] =
    useState<Session | null>(null);

  // --- HELPER: SHOW CUSTOM ALERT ---
  const showAlert = (title: string, message: string) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalVisible(true);
  };

  const handleAgeChange = (value: string) => {
    setAge(value);
    setTargetResult(null);

    const parsedAge = parseDisplay(value);
    if (parsedAge !== null && parsedAge >= 13 && parsedAge < 18) {
      setGoalRate(GOAL_RATE_PRESETS.maintain);
    }
  };

  const handleWeightKgChange = (value: string) => {
    setWeightKg(value);
    setTargetResult(null);
    const parsed = parseDisplay(value);
    setWeightLb(roundDisplay(parsed === null ? null : kgToLb(parsed)));
  };

  const handleWeightLbChange = (value: string) => {
    setWeightLb(value);
    setTargetResult(null);
    const parsed = parseDisplay(value);
    setWeightKg(roundDisplay(parsed === null ? null : lbToKg(parsed)));
  };

  const handleHeightCmChange = (value: string) => {
    setHeightCm(value);
    setTargetResult(null);
  };

  const updateImperialHeight = (feetText: string, inchesText: string) => {
    const feet = parseDisplay(feetText);
    const inches = parseDisplay(inchesText);

    if (
      feet !== null &&
      inches !== null &&
      isValidImperialHeight(feet, inches)
    ) {
      setHeightCm(roundDisplay(ftInToCm(feet, inches)));
    } else {
      setHeightCm("");
    }
  };

  const handleHeightFtChange = (value: string) => {
    setHeightFt(value);
    setTargetResult(null);
    updateImperialHeight(value, heightIn);
  };

  const handleHeightInChange = (value: string) => {
    setHeightIn(value);
    setTargetResult(null);
    updateImperialHeight(heightFt, value);
  };

  const switchSignupUnitSystem = (next: UnitSystem) => {
    if (next === "imperial") {
      const parsedHeight = parseDisplay(heightCm);
      const convertedHeight =
        parsedHeight === null ? null : cmToFtIn(parsedHeight);
      setHeightFt(convertedHeight ? String(convertedHeight.feet) : "");
      setHeightIn(convertedHeight ? String(convertedHeight.inches) : "");

      const parsedWeight = parseDisplay(weightKg);
      setWeightLb(
        roundDisplay(parsedWeight === null ? null : kgToLb(parsedWeight)),
      );
    }

    setUnitSystem(next);
  };

  // --- LOGIC: CALCULATE WITH LIMITS ---
  const handleCalculate = () => {
    const parsedAge = parseDisplay(age);
    const canonicalWeight = parseDisplay(weightKg);
    const canonicalHeight = parseDisplay(heightCm);
    const parsedFeet = parseDisplay(heightFt);
    const parsedInches = parseDisplay(heightIn);

    if (
      unitSystem === "imperial" &&
      (parsedFeet === null ||
        parsedInches === null ||
        !isValidImperialHeight(parsedFeet, parsedInches))
    ) {
      showAlert(
        "Invalid Height",
        "Enter feet and inches, with inches between 0 and 11.",
      );
      return;
    }

    const isMinor =
      parsedAge !== null && parsedAge >= 13 && parsedAge < 18;
    const input = {
      age: parsedAge ?? Number.NaN,
      sex: gender,
      weightKg: canonicalWeight ?? Number.NaN,
      heightCm: canonicalHeight ?? Number.NaN,
      activityLevel,
      weeklyRate: isMinor ? GOAL_RATE_PRESETS.maintain : goalRate,
    };
    const validationError = getBodyStatsValidationError(input, unitSystem);

    if (validationError) {
      showAlert("Invalid Stats", validationError);
      return;
    }

    try {
      const result = calculateNutritionTarget(input);
      setTargetResult(result);
      setStep(2);
    } catch (error) {
      showAlert(
        "Unable to Calculate",
        error instanceof Error
          ? error.message
          : "Check your stats and try again.",
      );
    }
  };

  // --- LOGIC: AUTH FLOW ---
  async function handleAuth() {
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        showAlert("Login Failed", error.message);
      } else {
        router.replace("/");
      }
    } else {
      // SIGN UP -> Trigger Email
      const { error } = await supabase.auth.signUp({ email, password });

      if (error) {
        showAlert("Signup Failed", error.message);
      } else {
        // SUCCESS: Move to Step 3 (Enter Code)
        setVerifiedSignupSession(null);
        setStep(3);
      }
    }
    setLoading(false);
  }

  // --- LOGIC: VERIFY CODE ---
  async function handleVerify() {
    setLoading(true);

    try {
      if (!targetResult) {
        showAlert(
          "Missing Target",
          "Return to the target step and calculate again.",
        );
        return;
      }

      let signupSession = verifiedSignupSession;

      if (!signupSession) {
        const { data, error } = await signupVerificationClient.auth.verifyOtp({
          email,
          token: code,
          type: "signup",
        });

        if (error) {
          showAlert("Verification Failed", error.message);
          return;
        }

        if (!data.session) {
          showAlert(
            "Verification Failed",
            "Your email was verified, but no session was created. Please sign in.",
          );
          return;
        }

        signupSession = data.session;
        setVerifiedSignupSession(data.session);
      }

      const macroGrams = calculateMacroGrams(
        targetResult.finalCalories,
        DEFAULT_MACRO_PERCENTAGES,
      );
      const numericAge = Number(age);
      const minor = numericAge < 18;
      const savedMode = minor
        ? "minor_maintenance"
        : goalRate === GOAL_RATE_PRESETS.maintain
          ? "maintenance"
          : "estimated_rate";
      const { error: setupSessionError } =
        await signupVerificationClient.auth.setSession({
          access_token: signupSession.access_token,
          refresh_token: signupSession.refresh_token,
        });

      if (setupSessionError) {
        showAlert("Profile Setup Failed", setupSessionError.message);
        return;
      }

      const { error: dbError } = await signupVerificationClient
        .from("user_goals")
        .upsert(
          {
            user_id: signupSession.user.id,
            calorie_target: targetResult.finalCalories,
            current_weight: Number(weightKg),
            height: Number(heightCm),
            age: numericAge,
            gender,
            activity_level: activityLevelToStoredValue(activityLevel),
            goal_mode: savedMode,
            goal_rate:
              minor || goalRate === GOAL_RATE_PRESETS.maintain
                ? null
                : goalRate,
            unit_system: unitSystem,
            protein_ratio: DEFAULT_MACRO_PERCENTAGES.protein,
            carbs_ratio: DEFAULT_MACRO_PERCENTAGES.carbs,
            fat_ratio: DEFAULT_MACRO_PERCENTAGES.fat,
            protein_grams: macroGrams.protein,
            carbs_grams: macroGrams.carbs,
            fat_grams: macroGrams.fat,
          },
          { onConflict: "user_id" },
        );

      if (dbError) {
        showAlert("Profile Setup Failed", dbError.message);
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: signupSession.access_token,
        refresh_token: signupSession.refresh_token,
      });

      if (sessionError) {
        showAlert("Sign In Failed", sessionError.message);
        return;
      }

      setVerifiedSignupSession(null);
      router.replace("/");
    } catch (error) {
      showAlert(
        "Verification Failed",
        error instanceof Error
          ? error.message
          : "Unable to finish account setup. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  const parsedAge = parseDisplay(age);
  const isMinor =
    parsedAge !== null && parsedAge >= 13 && parsedAge < 18;

  // --- VIEWS ---
  const renderStatsForm = () => (
    <View style={[styles.formContainer, isDesktop && styles.webStatsContainer]}>
      {/* Title */}
      <View style={{ alignItems: "center", marginBottom: 24 }}>
        <Text style={{ color: Colors.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4 }}>
          Set Targets
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 13 }}>
          We&apos;ll dial in your daily numbers
        </Text>
      </View>

      <View style={styles.unitSection}>
        <UnitSystemToggle
          value={unitSystem}
          onChange={switchSignupUnitSystem}
        />
      </View>

      {/* Gender Toggle */}
      <View style={{
        flexDirection: "row",
        backgroundColor: Colors.inputBg,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: Colors.border,
        padding: 4,
        marginBottom: 12,
        gap: 4,
      }}>
        {(["male", "female"] as const).map((g) => (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ selected: gender === g }}
            key={g}
            onPress={() => {
              setGender(g);
              setTargetResult(null);
            }}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
              backgroundColor: gender === g ? Colors.accent : "transparent",
            }}
          >
            <Text style={{
              fontWeight: "800",
              fontSize: 14,
              color: gender === g ? Colors.textOnAccent : Colors.textMuted,
            }}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bento Stats Grid */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
        {/* Age */}
        <View style={{
          flex: 1, backgroundColor: Colors.inputBg, borderWidth: 1,
          borderColor: Colors.border, borderRadius: 20, padding: 14,
        }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
            Age
          </Text>
          <View style={styles.statValueRow}>
            <TextInput
              accessibilityLabel="Age in years"
              placeholder="25"
              keyboardType="numeric"
              value={age}
              onChangeText={handleAgeChange}
              placeholderTextColor={Colors.border}
              style={styles.statValueInput}
            />
            <Text style={styles.statUnitText}>yr</Text>
          </View>
        </View>

        {/* Weight */}
        <View style={{
          flex: 1, backgroundColor: Colors.inputBg, borderWidth: 1,
          borderColor: Colors.border, borderRadius: 20, padding: 14,
        }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
            Weight
          </Text>
          <View style={styles.statValueRow}>
            <TextInput
              accessibilityLabel={
                unitSystem === "metric"
                  ? "Weight in kilograms"
                  : "Weight in pounds"
              }
              placeholder={unitSystem === "metric" ? "70" : "154"}
              keyboardType="numeric"
              value={unitSystem === "metric" ? weightKg : weightLb}
              onChangeText={
                unitSystem === "metric"
                  ? handleWeightKgChange
                  : handleWeightLbChange
              }
              placeholderTextColor={Colors.border}
              style={styles.statValueInput}
            />
            <Text style={styles.statUnitText}>
              {unitSystem === "metric" ? "kg" : "lb"}
            </Text>
          </View>
        </View>
      </View>

      {/* Height – full width */}
      <View style={{
        backgroundColor: Colors.inputBg, borderWidth: 1,
        borderColor: Colors.border, borderRadius: 20, padding: 14, marginBottom: 20,
      }}>
        <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8 }}>
          Height
        </Text>
        {unitSystem === "metric" ? (
          <View style={styles.statValueRow}>
            <TextInput
              accessibilityLabel="Height in centimeters"
              placeholder="175"
              keyboardType="numeric"
              value={heightCm}
              onChangeText={handleHeightCmChange}
              placeholderTextColor={Colors.border}
              style={styles.statValueInput}
            />
            <Text style={styles.statUnitText}>cm</Text>
          </View>
        ) : (
          <View style={styles.imperialHeightRow}>
            <View style={styles.imperialHeightField}>
              <TextInput
                accessibilityHint="Enter the feet portion of your height."
                accessibilityLabel="Height in feet"
                placeholder="5"
                keyboardType="numeric"
                value={heightFt}
                onChangeText={handleHeightFtChange}
                placeholderTextColor={Colors.border}
                style={styles.statValueInput}
              />
              <Text style={styles.statUnitText}>ft</Text>
            </View>
            <View style={styles.imperialHeightField}>
              <TextInput
                accessibilityHint="Enter a value from 0 through 11."
                accessibilityLabel="Height in inches"
                placeholder="9"
                keyboardType="numeric"
                value={heightIn}
                onChangeText={handleHeightInChange}
                placeholderTextColor={Colors.border}
                style={styles.statValueInput}
              />
              <Text style={styles.statUnitText}>in</Text>
            </View>
          </View>
        )}
      </View>

      {/* Activity Level */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700" }}>1</Text>
        </View>
        <Text style={{ color: Colors.text, fontSize: 14, fontWeight: "700" }}>Activity Level</Text>
      </View>
      <View style={[{ gap: 8, marginBottom: 20 }, isDesktop && styles.webActivityGrid]}>
        {ACTIVITY_OPTIONS.map((opt) => {
          const active = activityLevel === opt.value;
          return (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={opt.value}
              onPress={() => {
                setActivityLevel(opt.value);
                setTargetResult(null);
              }}
              style={[
                {
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: active ? Colors.accentDim : Colors.inputBg,
                  borderWidth: 1,
                  borderColor: active ? Colors.accent : Colors.border,
                  borderRadius: 16,
                  padding: 10,
                  gap: 12,
                },
                isDesktop && styles.webActivityOption,
              ]}
            >
              <View style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: active ? Colors.accent : Colors.secondary,
                borderWidth: 1,
                borderColor: active ? Colors.accent : Colors.border,
                alignItems: "center", justifyContent: "center",
              }}>
                <Text style={{ fontSize: 18 }}>{opt.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: active ? Colors.accent : Colors.text, fontWeight: "700", fontSize: 14 }}>
                  {opt.label}
                </Text>
                <Text style={{ color: active ? Colors.accent : Colors.textMuted, fontSize: 11, opacity: 0.8 }}>
                  {opt.sub} · {ACTIVITY_MULTIPLIERS[opt.value]}x
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Goal */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700" }}>2</Text>
        </View>
        <Text style={{ color: Colors.text, fontSize: 14, fontWeight: "700" }}>Main Goal</Text>
      </View>
      {isMinor ? (
        <View style={styles.minorNotice}>
          <Text style={styles.minorNoticeTitle}>
            Maintain for healthy growth
          </Text>
          <Text style={styles.minorNoticeText}>
            TrackBing estimates maintenance only for ages 13-17.
            Weight-change plans for children and teens should be set with a
            qualified health professional.
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
          {SIGNUP_GOAL_OPTIONS.map((opt) => {
            const active = goalRate === opt.value;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={opt.label}
                onPress={() => {
                  setGoalRate(opt.value);
                  setTargetResult(null);
                }}
                style={[
                  {
                    flexBasis: "47%", flexGrow: 1,
                    backgroundColor: active ? Colors.accentDim : Colors.inputBg,
                    borderWidth: 1,
                    borderColor: active ? Colors.accent : Colors.border,
                    borderRadius: 18,
                    padding: 14,
                    alignItems: "center",
                    gap: 6,
                  },
                  isDesktop && styles.webGoalOption,
                ]}
              >
                <Text style={{ fontSize: 22 }}>{opt.emoji}</Text>
                <Text style={{ color: active ? Colors.accent : Colors.text, fontWeight: "700", fontSize: 13 }}>
                  {opt.label}
                </Text>
                <Text style={{ color: active ? Colors.accent : Colors.textMuted, fontSize: 11, opacity: 0.8 }}>
                  {opt.sub}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.calculatorNotice}>
        This is a general estimate, not medical advice. It is not designed for
        pregnancy, breastfeeding, eating-disorder treatment or recovery, or
        clinician-managed nutrition therapy.
      </Text>

      <TouchableOpacity style={styles.primaryBtn} onPress={handleCalculate}>
        <Text style={styles.primaryBtnText}>Calculate & Continue</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.toggleContainer} onPress={() => setIsLogin(true)}>
        <Text style={styles.toggleText}>
          Already have an account?{"  "}
          <Text style={styles.toggleTextBold}>Log In</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderAuthForm = () => (
    <View style={[styles.formContainer, styles.authFormContainer, isDesktop && styles.webAuthFormContainer]}>
      {!isLogin && (
        <TouchableOpacity
          style={{ position: "absolute", top: 20, left: 24, zIndex: 20, flexDirection: "row", alignItems: "center" }}
          onPress={() => setStep(1)}
        >
          <Text style={{ color: Colors.accent, fontWeight: "bold", fontSize: 24, marginRight: 4 }}>
            ‹
          </Text>
          <Text style={{ color: Colors.accent, fontWeight: "600", fontSize: 16 }}>
            Back
          </Text>
        </TouchableOpacity>
      )}

      <View style={{ alignItems: "center", marginBottom: 32, marginTop: isDesktop ? 0 : isLogin ? 20 : 10 }}>
        {!isDesktop && (
          <View style={{
            width: 120, height: 120, borderRadius: 60,
            backgroundColor: "rgba(255,255,255,0.03)",
            alignItems: "center", justifyContent: "center",
            marginBottom: 24,
            borderWidth: 1, borderColor: "rgba(255,255,255,0.1)"
          }}>
            <Image
              source={require("../../assets/images/TrackBingLogo.png")}
              style={{ width: 80, height: 80 }}
              resizeMode="contain"
            />
          </View>
        )}
        <Text style={{ color: Colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5 }}>
          {isLogin ? "Welcome Back" : "Create Account"}
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 14, marginTop: 8 }}>
          {isLogin ? "Sign in to continue to your dashboard" : "Sign up to track your progress"}
        </Text>
      </View>

      {!isLogin && targetResult && (
        <View style={styles.targetBreakdownSection}>
          <TargetBreakdown
            result={targetResult}
            weightKg={Number(weightKg)}
            unitSystem={unitSystem}
          />
        </View>
      )}

      <View style={{ gap: 16, marginBottom: 32 }}>
        <View style={{
          flexDirection: "row", alignItems: "center", backgroundColor: Colors.inputBg,
          borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 20, overflow: "hidden"
        }}>
          <View style={styles.authInputIcon}>
            <EnvelopeSimple size={21} color={Colors.accent} weight="bold" />
          </View>
          <TextInput
            onChangeText={setEmail}
            value={email}
            placeholder="Email Address"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              flex: 1, color: Colors.text, paddingVertical: 18,
              paddingRight: 16, fontSize: 16, fontWeight: "500",
            }}
          />
        </View>

        <View style={{
          flexDirection: "row", alignItems: "center", backgroundColor: Colors.inputBg,
          borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", borderRadius: 20, overflow: "hidden"
        }}>
          <View style={styles.authInputIcon}>
            <LockKey size={21} color={Colors.accent} weight="bold" />
          </View>
          <TextInput
            onChangeText={setPassword}
            value={password}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            style={{
              flex: 1, color: Colors.text, paddingVertical: 18,
              paddingRight: 16, fontSize: 16, fontWeight: "500",
            }}
          />
        </View>
      </View>

      <View style={{ marginBottom: 24 }}>
        {loading ? (
          <View style={{ paddingVertical: 16 }}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.primaryBtn, { borderRadius: 20, paddingVertical: 18, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 }]}
            onPress={handleAuth}
          >
            <Text style={[styles.primaryBtnText, { fontSize: 16, fontWeight: "800", letterSpacing: 0.5 }]}>
              {isLogin ? "Sign In" : "Create Account"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={{ paddingVertical: 12, alignItems: "center" }}
        onPress={() => {
          if (isLogin) {
            setIsLogin(false);
            setStep(1);
          } else {
            setIsLogin(true);
          }
        }}
      >
        <Text style={{ color: Colors.textMuted, fontSize: 14, fontWeight: "500" }}>
          {isLogin ? "New to TrackBing? " : "Already have an account? "}
          <Text style={{ color: Colors.accent, fontWeight: "800" }}>
            {isLogin ? "Sign Up" : "Log In"}
          </Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderVerificationForm = () => (
    <View style={styles.formContainer}>
      <View style={{ alignItems: "center", marginBottom: 20 }}>
        <Image
          source={require("../../assets/images/TrackBingLogo.png")}
          style={{ width: 120, height: 120, marginBottom: -40 }}
          resizeMode="contain"
        />
      </View>

      <Text
        style={{
          color: "white",
          fontSize: 24,
          fontWeight: "bold",
          textAlign: "center",
          marginBottom: 10,
        }}
      >
        Verify Email
      </Text>
      <Text style={{ color: "#999", textAlign: "center", marginBottom: 30 }}>
        We sent a 6-digit code to {email}
      </Text>

      <Text style={styles.label}>Enter Code</Text>
      <TextInput
        onChangeText={setCode}
        value={code}
        placeholder="123456"
        placeholderTextColor="#666"
        keyboardType="number-pad"
        maxLength={6}
        style={[
          styles.input,
          {
            textAlign: "center",
            fontSize: 24,
            letterSpacing: 5,
            fontWeight: "bold",
          },
        ]}
      />

      <View style={styles.buttonContainer}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.accent} />
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleVerify}>
            <Text style={styles.primaryBtnText}>Verify & Start</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.toggleContainer}
        onPress={() => setStep(2)}
      >
        <Text style={{ color: Colors.accent }}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  const activeForm =
    step === 3
      ? renderVerificationForm()
      : isLogin || step === 2
        ? renderAuthForm()
        : renderStatsForm();

  const showWebAuthShell = isDesktop && step !== 3 && (isLogin || step === 2);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[styles.scrollContent, isDesktop && styles.webScrollContent]}
        style={{ width: "100%" }}
      >
        {showWebAuthShell ? (
          <View style={styles.webAuthShell}>
            <View style={styles.webBrandPanel}>
              <View style={styles.webBrandMark}>
                <Image
                  source={require("../../assets/images/TrackBingLogo.png")}
                  style={styles.webBrandLogo}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.webBrandTitle}>TrackBing</Text>
              <Text style={styles.webBrandCopy}>
                Keep calories and macros easy to scan before you start logging.
              </Text>
              <View style={styles.webBrandStats}>
                <View style={styles.webBrandStat}>
                  <Text style={styles.webBrandStatValue}>Daily</Text>
                  <Text style={styles.webBrandStatLabel}>Targets</Text>
                </View>
                <View style={styles.webBrandStat}>
                  <Text style={styles.webBrandStatValue}>Macro</Text>
                  <Text style={styles.webBrandStatLabel}>Tracking</Text>
                </View>
              </View>
            </View>
            <View style={styles.webFormSlot}>{activeForm}</View>
          </View>
        ) : (
          activeForm
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={{ height: 3, backgroundColor: Colors.accent }} />
            <View style={{ padding: 25, alignItems: "center" }}>
              <Text style={styles.modalTitle}>{modalTitle}</Text>
              <Text style={styles.modalMessage}>{modalMessage}</Text>
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.modalButtonText}>OK</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
