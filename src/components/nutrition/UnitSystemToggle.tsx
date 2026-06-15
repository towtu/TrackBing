import type { UnitSystem } from "@/src/lib/nutritionTargets";
import { Colors } from "@/src/styles/colors";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

type Props = {
  value: UnitSystem;
  onChange: (value: UnitSystem) => void;
};

const OPTIONS: readonly { label: string; value: UnitSystem }[] = [
  { label: "Metric (kg/cm)", value: "metric" },
  { label: "Imperial (lb/ft)", value: "imperial" },
];

export function UnitSystemToggle({ value, onChange }: Props) {
  return (
    <View accessibilityRole="radiogroup" style={styles.row}>
      {OPTIONS.map((option) => {
        const active = value === option.value;

        return (
          <TouchableOpacity
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            activeOpacity={0.8}
            hitSlop={4}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.button, active && styles.activeButton]}
          >
            <Text style={[styles.text, active && styles.activeText]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  button: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  activeButton: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  activeText: {
    color: Colors.textOnAccent,
  },
});
