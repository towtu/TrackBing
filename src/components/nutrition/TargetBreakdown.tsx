import {
  kgToLb,
  type NutritionTargetResult,
  type UnitSystem,
} from "@/src/lib/nutritionTargets";
import { isCompactPhoneLayout } from "@/src/lib/responsiveLayout";
import { Colors } from "@/src/styles/colors";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";

type Props = {
  result: NutritionTargetResult;
  weightKg: number;
  unitSystem: UnitSystem;
};

function formatSigned(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "Unavailable";

  const rounded = Object.is(Number(value.toFixed(fractionDigits)), -0)
    ? 0
    : value;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${rounded > 0 ? "+" : ""}${formatted}`;
}

const formatCalories = (value: number): string =>
  Number.isFinite(value)
    ? Math.round(value).toLocaleString("en-US")
    : "Unavailable";

export function TargetBreakdown({
  result,
  weightKg,
  unitSystem,
}: Props) {
  const { width } = useWindowDimensions();
  const isCompactPhone = isCompactPhoneLayout(width);
  const weeklyChangeKg = weightKg * (result.requestedRate ?? 0);
  const weeklyChange =
    unitSystem === "metric" ? weeklyChangeKg : kgToLb(weeklyChangeKg);
  const weeklyUnit = unitSystem === "metric" ? "kg" : "lb";
  const safeguardApplied =
    result.adjustmentCapApplied || result.floorApplied;

  return (
    <View style={styles.box}>
      <View style={[styles.row, isCompactPhone && styles.rowCompact]}>
        <Text style={[styles.label, isCompactPhone && styles.labelCompact]}>
          Estimated maintenance
        </Text>
        <Text style={[styles.value, isCompactPhone && styles.valueCompact]}>
          {formatCalories(result.maintenanceCalories)} kcal
        </Text>
      </View>

      {result.requestedRate !== null && (
        <View style={[styles.row, isCompactPhone && styles.rowCompact]}>
          <Text style={[styles.label, isCompactPhone && styles.labelCompact]}>
            Selected rate
          </Text>
          <Text style={[styles.value, isCompactPhone && styles.valueCompact]}>
            {formatSigned(result.requestedRate * 100, 2)}% / week (
            {formatSigned(weeklyChange, 2)} {weeklyUnit} / week)
          </Text>
        </View>
      )}

      <View style={[styles.row, isCompactPhone && styles.rowCompact]}>
        <Text style={[styles.label, isCompactPhone && styles.labelCompact]}>
          Requested adjustment
        </Text>
        <Text style={[styles.value, isCompactPhone && styles.valueCompact]}>
          {formatSigned(result.requestedAdjustment)} kcal/day
        </Text>
      </View>

      <View style={[styles.row, isCompactPhone && styles.rowCompact]}>
        <Text style={[styles.label, isCompactPhone && styles.labelCompact]}>
          Applied adjustment
        </Text>
        <Text style={[styles.value, isCompactPhone && styles.valueCompact]}>
          {formatSigned(result.appliedAdjustment)} kcal/day
        </Text>
      </View>

      <View
        style={[styles.targetRow, isCompactPhone && styles.targetRowCompact]}
      >
        <Text
          style={[styles.targetLabel, isCompactPhone && styles.labelCompact]}
        >
          Daily target
        </Text>
        <Text style={[styles.target, isCompactPhone && styles.targetCompact]}>
          {formatCalories(result.finalCalories)} kcal
        </Text>
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
  rowCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 2,
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
  labelCompact: {
    flex: 0,
    width: "100%",
  },
  valueCompact: {
    flex: 0,
    width: "100%",
    textAlign: "left",
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
  targetRowCompact: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 2,
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
  targetCompact: {
    width: "100%",
    textAlign: "left",
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
