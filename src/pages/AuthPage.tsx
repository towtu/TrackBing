// src/pages/AuthPage.tsx
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
import { supabase } from "../lib/supabase";
import { AuthStyles as styles } from "../styles/AuthStyles";
import { Colors } from "../styles/colors";

export function AuthPage() {
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
      <Text
        style={{
          color: Colors.text,
          fontSize: 22,
          fontWeight: "bold",
          textAlign: "center",
          marginBottom: 20,
        }}
      >
        Let's set your goals
      </Text>

      <View style={{ flexDirection: "row", gap: 10, marginBottom: 15 }}>
        <TouchableOpacity
          onPress={() => setGender("male")}
          style={[
            styles.input,
            {
              flex: 1,
              padding: 12,
              backgroundColor:
                gender === "male" ? Colors.accent : Colors.inputBg,
              borderColor: gender === "male" ? Colors.accent : Colors.border,
            },
          ]}
        >
          <Text
            style={{
              textAlign: "center",
              fontWeight: "bold",
              color: gender === "male" ? "black" : "white",
            }}
          >
            Male
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setGender("female")}
          style={[
            styles.input,
            {
              flex: 1,
              padding: 12,
              backgroundColor:
                gender === "female" ? Colors.accent : Colors.inputBg,
              borderColor: gender === "female" ? Colors.accent : Colors.border,
            },
          ]}
        >
          <Text
            style={{
              textAlign: "center",
              fontWeight: "bold",
              color: gender === "female" ? "black" : "white",
            }}
          >
            Female
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Age</Text>
            <TextInput
              placeholder="13-100"
              keyboardType="numeric"
              value={age}
              onChangeText={setAge}
              style={styles.input}
              placeholderTextColor="#666"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Wgt (kg)</Text>
            <TextInput
              placeholder="30-300"
              keyboardType="numeric"
              value={weight}
              onChangeText={setWeight}
              style={styles.input}
              placeholderTextColor="#666"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Hgt (cm)</Text>
            <TextInput
              placeholder="100-250"
              keyboardType="numeric"
              value={height}
              onChangeText={setHeight}
              style={styles.input}
              placeholderTextColor="#666"
            />
          </View>
        </View>
      </View>

      <Text style={styles.label}>1. How active are you?</Text>
      <View style={{ gap: 8, marginBottom: 20 }}>
        {[
          { label: "Sedentary (Office Job)", val: 1.2 },
          { label: "Light Exercise (1-2 days)", val: 1.375 },
          { label: "Moderate (3-5 days)", val: 1.55 },
          { label: "Heavy (6-7 days)", val: 1.725 },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.val}
            onPress={() => setActivity(opt.val)}
            style={[
              styles.input,
              {
                marginBottom: 0,
                padding: 12,
                backgroundColor: activity === opt.val ? "#333" : Colors.inputBg,
                borderColor:
                  activity === opt.val ? Colors.accent : Colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: activity === opt.val ? Colors.accent : "#ccc",
                fontWeight: activity === opt.val ? "bold" : "normal",
              }}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>2. What is your goal?</Text>
      <View style={{ gap: 8, marginBottom: 20 }}>
        {[
          { label: "Lose 1 lb / week", val: -750 },
          { label: "Lose 0.5 lb / week", val: -500 },
          { label: "Lose 0.25 lb / week", val: -250 },
          { label: "Maintain Weight", val: 0 },
          { label: "Gain 0.25 lb / week", val: 250 },
          { label: "Gain 0.5 lb / week", val: 500 },
          { label: "Gain 1 lb / week", val: 750 },
        ].map((opt) => (
          <TouchableOpacity
            key={opt.val}
            onPress={() => setGoalOffset(opt.val)}
            style={[
              styles.input,
              {
                marginBottom: 0,
                padding: 12,
                backgroundColor:
                  goalOffset === opt.val ? "#333" : Colors.inputBg,
                borderColor:
                  goalOffset === opt.val ? Colors.accent : Colors.border,
              },
            ]}
          >
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Text
                style={{
                  color: goalOffset === opt.val ? Colors.accent : "#ccc",
                  fontWeight: goalOffset === opt.val ? "bold" : "normal",
                }}
              >
                {opt.label}
              </Text>
              {opt.val !== 0 && (
                <Text
                  style={{
                    color: opt.val < 0 ? "#ef4444" : "#22c55e",
                    fontSize: 12,
                  }}
                >
                  {opt.val > 0 ? "+" : ""}
                  {opt.val} cal
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={handleCalculate}>
        <Text style={styles.primaryBtnText}>Calculate & Continue</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.toggleContainer}
        onPress={() => setIsLogin(true)}
      >
        <Text style={styles.toggleText}>
          Back to <Text style={styles.toggleTextBold}>Log In</Text>
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
            backgroundColor: "#222",
            padding: 15,
            borderRadius: 10,
            marginBottom: 20,
            marginTop: 70,
            alignItems: "center",
            borderWidth: 1,
            borderColor: Colors.accent,
          }}
        >
          <Text
            style={{
              color: "#fff",
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Your Daily Target
          </Text>
          <Text
            style={{ color: Colors.accent, fontSize: 32, fontWeight: "bold" }}
          >
            {calculatedCalories}
          </Text>
          <Text style={{ color: "#666", fontSize: 12 }}>calories / day</Text>
        </View>
      )}

      <View style={{ marginTop: isLogin ? 80 : 0 }}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          onChangeText={setEmail}
          value={email}
          placeholder="name@example.com"
          placeholderTextColor="#666"
          autoCapitalize="none"
          keyboardType="email-address"
          style={styles.input}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          onChangeText={setPassword}
          value={password}
          secureTextEntry
          placeholder="Enter your password"
          placeholderTextColor="#666"
          autoCapitalize="none"
          style={styles.input}
        />
      </View>

      <View style={styles.buttonContainer}>
        {loading ? (
          <ActivityIndicator size="large" color={Colors.accent} />
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={handleAuth}>
            <Text style={styles.primaryBtnText}>
              {isLogin ? "Sign In" : "Create Account"}
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
      </Modal>
    </KeyboardAvoidingView>
  );
}
