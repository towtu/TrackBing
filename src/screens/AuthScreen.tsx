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
import { supabase } from "@/src/lib/supabase";
import { AuthStyles as styles } from "@/src/styles/auth";
import { Colors } from "@/src/styles/colors";

export function AuthScreen() {
  // --- STATE ---
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState(1); // 1=Stats, 2=Auth, 3=Verify
  const [loading, setLoading] = useState(false);

  // --- MODAL STATE ---
  const [modalVisible, setModalVisible] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalMessage, setModalMessage] = useState("");

  // --- USER DATA ---
  const [gender, setGender] = useState<"male" | "female">("male");
  const [age, setAge] = useState("");
  const [weight, setWeight] = useState("");
  const [height, setHeight] = useState("");
  const [activity, setActivity] = useState(1.2);
  const [goalOffset, setGoalOffset] = useState(0);
  const [calculatedCalories, setCalculatedCalories] = useState(0);

  // --- AUTH DATA ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  // --- HELPER: SHOW CUSTOM ALERT ---
  const showAlert = (title: string, message: string) => {
    setModalTitle(title);
    setModalMessage(message);
    setModalVisible(true);
  };

  // --- LOGIC: CALCULATE WITH LIMITS ---
  const handleCalculate = () => {
    // 1. Check if empty
    if (!age || !weight || !height) {
      showAlert("Missing Info", "Please fill in all your stats.");
      return;
    }

    const w = parseFloat(weight);
    const h = parseFloat(height);
    const a = parseFloat(age);

    // 2. NEW: REALISTIC LIMITS CHECKS
    if (isNaN(w) || isNaN(h) || isNaN(a)) {
      showAlert("Invalid Input", "Please enter valid numbers.");
      return;
    }

    // Age Limit: 13 to 100
    if (a < 13 || a > 100) {
      showAlert(
        "Invalid Age",
        "You must be between 13 and 100 years old to use this app.",
      );
      return;
    }

    // Weight Limit: 30kg (66lbs) to 300kg (660lbs)
    if (w < 30 || w > 300) {
      showAlert(
        "Invalid Weight",
        "Please enter a realistic weight (30kg - 300kg).",
      );
      return;
    }

    // Height Limit: 100cm (3'3") to 250cm (8'2")
    if (h < 100 || h > 250) {
      showAlert(
        "Invalid Height",
        "Please enter a realistic height (100cm - 250cm).",
      );
      return;
    }

    // 3. Calculate BMR (Mifflin-St Jeor)
    let bmr = 10 * w + 6.25 * h - 5 * a;
    if (gender === "male") bmr += 5;
    else bmr -= 161;

    const tdee = bmr * activity;
    const finalTarget = Math.round(tdee + goalOffset);

    // Safety Floor
    const safeTarget = finalTarget < 1200 ? 1200 : finalTarget;

    setCalculatedCalories(safeTarget);
    setStep(2); // Go to Sign Up
  };

  // --- LOGIC: AUTH FLOW ---
  async function handleAuth() {
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) showAlert("Login Failed", error.message);
    } else {
      // SIGN UP -> Trigger Email
      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        showAlert("Signup Failed", error.message);
      } else {
        // SUCCESS: Move to Step 3 (Enter Code)
        setStep(3);
      }
    }
    setLoading(false);
  }

  // --- LOGIC: VERIFY CODE ---
  async function handleVerify() {
    setLoading(true);

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    if (error) {
      showAlert("Verification Failed", error.message);
    } else if (data.session) {
      // SAVE GOALS AFTER VERIFICATION
      const { error: dbError } = await supabase.from("user_goals").insert([
        {
          user_id: data.session.user.id,
          calorie_target: calculatedCalories,
          current_weight: weight,
          height: height,
          age: age,
          gender: gender,
          activity_level: activity.toString(),
        },
      ]);

      if (dbError) console.error(dbError);
    }
    setLoading(false);
  }

  // --- VIEWS ---
  const renderStatsForm = () => (
    <View style={styles.formContainer}>
      {/* Title */}
      <View style={{ alignItems: "center", marginBottom: 24 }}>
        <Text style={{ color: Colors.text, fontSize: 26, fontWeight: "900", letterSpacing: -0.5, marginBottom: 4 }}>
          Set Targets
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 13 }}>
          We'll dial in your daily numbers
        </Text>
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
            key={g}
            onPress={() => setGender(g)}
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
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
            <TextInput
              placeholder="25"
              keyboardType="numeric"
              value={age}
              onChangeText={setAge}
              placeholderTextColor={Colors.border}
              style={{ flex: 1, color: Colors.text, fontSize: 28, fontWeight: "900", padding: 0 }}
            />
            <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 4 }}>yr</Text>
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
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
            <TextInput
              placeholder="70"
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              placeholderTextColor={Colors.border}
              style={{ flex: 1, color: Colors.text, fontSize: 28, fontWeight: "900", padding: 0 }}
            />
            <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 4 }}>kg</Text>
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
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
          <TextInput
            placeholder="175"
            keyboardType="numeric"
            value={height}
            onChangeText={setHeight}
            placeholderTextColor={Colors.border}
            style={{ flex: 1, color: Colors.text, fontSize: 28, fontWeight: "900", padding: 0 }}
          />
          <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: "700", marginBottom: 4 }}>cm</Text>
        </View>
      </View>

      {/* Activity Level */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: Colors.inputBg, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: "700" }}>1</Text>
        </View>
        <Text style={{ color: Colors.text, fontSize: 14, fontWeight: "700" }}>Activity Level</Text>
      </View>
      <View style={{ gap: 8, marginBottom: 20 }}>
        {[
          { label: "Sedentary", sub: "Office / Desk Job", val: 1.2 },
          { label: "Light Active", sub: "1–3 days / week", val: 1.375 },
          { label: "Moderate",   sub: "3–5 days / week", val: 1.55 },
          { label: "Very Active", sub: "6–7 days / week", val: 1.725 },
        ].map((opt) => {
          const active = activity === opt.val;
          return (
            <TouchableOpacity
              key={opt.val}
              onPress={() => setActivity(opt.val)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: active ? Colors.accentDim : Colors.inputBg,
                borderWidth: 1,
                borderColor: active ? Colors.accent : Colors.border,
                borderRadius: 16,
                padding: 10,
                gap: 12,
              }}
            >
              <View style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: active ? Colors.accent : Colors.secondary,
                borderWidth: 1,
                borderColor: active ? Colors.accent : Colors.border,
                alignItems: "center", justifyContent: "center",
              }}>
                <Text style={{ fontSize: 18 }}>
                  {opt.val === 1.2 ? "💼" : opt.val === 1.375 ? "🚶" : opt.val === 1.55 ? "🏋️" : "🔥"}
                </Text>
              </View>
              <View>
                <Text style={{ color: active ? Colors.accent : Colors.text, fontWeight: "700", fontSize: 14 }}>
                  {opt.label}
                </Text>
                <Text style={{ color: active ? Colors.accent : Colors.textMuted, fontSize: 11, opacity: 0.8 }}>
                  {opt.sub}
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Lose Fast",   sub: "−1 kg/wk",    val: -1000, emoji: "📉" },
          { label: "Lose Slow",   sub: "−0.5 kg/wk",  val: -500,  emoji: "🎯" },
          { label: "Maintain",    sub: "±0 kg/wk",    val: 0,     emoji: "⚖️" },
          { label: "Gain Slow",   sub: "+0.5 kg/wk",  val: 500,   emoji: "📈" },
          { label: "Gain Fast",   sub: "+1 kg/wk",    val: 1000,  emoji: "💪" },
        ].map((opt) => {
          const active = goalOffset === opt.val;
          return (
            <TouchableOpacity
              key={opt.val}
              onPress={() => setGoalOffset(opt.val)}
              style={{
                flexBasis: "47%", flexGrow: 1,
                backgroundColor: active ? Colors.accentDim : Colors.inputBg,
                borderWidth: 1,
                borderColor: active ? Colors.accent : Colors.border,
                borderRadius: 18,
                padding: 14,
                alignItems: "center",
                gap: 6,
              }}
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
    <View style={styles.formContainer}>
      {!isLogin && (
        <TouchableOpacity
          style={{ position: "absolute", top: 20, left: 20, zIndex: 20 }}
          onPress={() => setStep(1)}
        >
          <Text
            style={{ color: Colors.accent, fontWeight: "bold", fontSize: 16 }}
          >
            ← Back
          </Text>
        </TouchableOpacity>
      )}

      <View
        style={{
          alignItems: "center",
          marginBottom: -80,
          marginTop: -50,
          zIndex: 10,
        }}
      >
        <Image
          source={require("../../assets/images/TrackBingLogo.png")}
          style={{ width: 150, height: 150 }}
          resizeMode="contain"
        />
      </View>

      {!isLogin && calculatedCalories > 0 && (
        <View
          style={{
            backgroundColor: Colors.inputBg,
            padding: 18,
            borderRadius: 16,
            marginBottom: 20,
            marginTop: 70,
            alignItems: "center",
            borderWidth: 1,
            borderColor: Colors.border,
          }}
        >
          <Text
            style={{
              color: Colors.textMuted,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              fontWeight: "700",
              marginBottom: 6,
            }}
          >
            Your Daily Target
          </Text>
          <Text
            style={{
              color: Colors.accent,
              fontSize: 38,
              fontWeight: "900",
              letterSpacing: -1,
            }}
          >
            {calculatedCalories}
          </Text>
          <Text style={{ color: Colors.textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 }}>
            kcal / day
          </Text>
        </View>
      )}

      <View style={{ marginTop: isLogin ? 80 : 0, gap: 12, marginBottom: 12 }}>
        {/* Email */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          backgroundColor: Colors.inputBg, borderWidth: 1,
          borderColor: Colors.border, borderRadius: 16,
        }}>
          <Text style={{ paddingLeft: 16, fontSize: 18, opacity: 0.5 }}>✉</Text>
          <TextInput
            onChangeText={setEmail}
            value={email}
            placeholder="name@example.com"
            placeholderTextColor={Colors.border}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              flex: 1, color: Colors.text, paddingVertical: 16,
              paddingHorizontal: 12, fontSize: 15, fontWeight: "600",
            }}
          />
        </View>

        {/* Password */}
        <View style={{
          flexDirection: "row", alignItems: "center",
          backgroundColor: Colors.inputBg, borderWidth: 1,
          borderColor: Colors.border, borderRadius: 16,
        }}>
          <Text style={{ paddingLeft: 16, fontSize: 18, opacity: 0.5 }}>🔑</Text>
          <TextInput
            onChangeText={setPassword}
            value={password}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={Colors.border}
            autoCapitalize="none"
            style={{
              flex: 1, color: Colors.text, paddingVertical: 16,
              paddingHorizontal: 12, fontSize: 15, fontWeight: "600",
            }}
          />
        </View>
      </View>

      <View style={styles.buttonContainer}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.accent} />
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAuth}>
            <Text style={styles.primaryBtnText}>
              {isLogin ? "Unlock Dashboard →" : "Create Account →"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={styles.toggleContainer}
        onPress={() => {
          if (isLogin) {
            setIsLogin(false);
            setStep(1);
          } else {
            setIsLogin(true);
          }
        }}
      >
        <Text style={styles.toggleText}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}{" "}
          <Text style={styles.toggleTextBold}>
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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
        style={{ width: "100%" }}
      >
        {step === 3
          ? renderVerificationForm()
          : isLogin || step === 2
            ? renderAuthForm()
            : renderStatsForm()}
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
