import {
  kgToLb,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { Colors } from "@/src/styles/colors";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  result: NutritionTargetResult;
  weightKg: number;
  unitSystem: UnitSystem;
};

function formatSigned(value: number, fractionDigits = 0): string {
  const rounded = Number(value.toFixed(fractionDigits));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

export function TargetBreakdown({
  result,
  weightKg,
  unitSystem,
}: Props) {
  const weeklyChangeKg = weightKg * (result.requestedRate ?? 0);
  const weeklyChange =
    unitSystem === "metric" ? weeklyChangeKg : kgToLb(weeklyChangeKg);
  const weeklyUnit = unitSystem === "metric" ? "kg" : "lb";
  const safeguardApplied =
    result.adjustmentCapApplied || result.floorApplied;

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <Text style={styles.label}>Estimated maintenance</Text>
        <Text style={styles.value}>{result.maintenanceCalories} kcal</Text>
      </View>

      {result.requestedRate !== null && (
        <View style={styles.row}>
          <Text style={styles.label}>Selected rate</Text>
          <Text style={styles.value}>
            {formatSigned(result.requestedRate * 100, 2)}% / week (
            {formatSigned(weeklyChange, 2)} {weeklyUnit} / week)
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <Text style={styles.label}>Requested adjustment</Text>
        <Text style={styles.value}>
          {formatSigned(result.requestedAdjustment)} kcal/day
        </Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Applied adjustment</Text>
        <Text style={styles.value}>
          {formatSigned(result.appliedAdjustment)} kcal/day
        </Text>
      </View>

      <View style={styles.targetRow}>
        <Text style={styles.targetLabel}>Daily target</Text>
        <Text style={styles.target}>{result.finalCalories} kcal</Text>
      </View>

      {safeguardApplied && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            The requested plan was adjusted to stay within the configured
            calorie safeguards.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 9,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.inputBg,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  label: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  value: {
    flex: 1.4,
    color: Colors.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "right",
  },
  targetRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  targetLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  target: {
    color: Colors.accent,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "right",
  },
  notice: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  noticeText: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
});
