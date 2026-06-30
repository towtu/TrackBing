import { Text, View, StyleSheet } from "react-native";
import { Colors } from "@/src/styles/colors";
import type { FoodSource } from "@/src/lib/aiFood";

/**
 * Provenance pill for an AI-assisted food. Real database hits (USDA /
 * OpenFoodFacts) read as authoritative; only a true AI guess shows the
 * "AI estimate" warning styling. Rendered in the review sheet, My Foods, and
 * log rows so provenance stays visible.
 */
const LABEL: Record<FoodSource, string> = {
  my_food: "My Food",
  usda: "USDA",
  openfoodfacts: "OpenFoodFacts",
  ai_estimate: "✨ AI estimate",
};

export function AiEstimateBadge({
  source,
  compact = false,
}: {
  source: FoodSource;
  compact?: boolean;
}) {
  const estimated = source === "ai_estimate";
  const tone = estimated ? Colors.accent : Colors.success;
  return (
    <View
      style={[
        styles.pill,
        compact && styles.pillCompact,
        { borderColor: tone, backgroundColor: estimated ? Colors.accentDim : "rgba(74,222,128,0.10)" },
      ]}
    >
      <Text style={[styles.text, compact && styles.textCompact, { color: tone }]}>
        {LABEL[source]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillCompact: { paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  textCompact: { fontSize: 9 },
});
