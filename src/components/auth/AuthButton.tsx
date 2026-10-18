import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { Colors, Radii } from "@/src/styles/colors";

/** Keep the action and its dimensions visible while authentication is in flight. */
export function AuthButton({ label, busyLabel, loading = false, onPress }: {
  label: string;
  busyLabel: string;
  loading?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID="auth-primary-action"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: loading, busy: loading }}
      aria-busy={loading}
      disabled={loading}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.button, focused && styles.focused, pressed && styles.pressed]}
    >
      {loading && <ActivityIndicator color={Colors.textOnAccent} />}
      <Text accessibilityLiveRegion="polite" style={styles.text}>{loading ? busyLabel : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.accent,
    borderRadius: Radii.inner,
    borderWidth: 2,
    borderColor: "transparent",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  focused: { borderColor: Colors.textOnAccent },
  pressed: { opacity: 0.85 },
  text: { color: Colors.textOnAccent, fontSize: 16, fontWeight: "700" },
});
