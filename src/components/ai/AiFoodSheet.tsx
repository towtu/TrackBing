import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Colors } from "@/src/styles/colors";
import { buildAiFoodReview, isLoggableAiFood, type AiFood } from "@/src/lib/aiFood";
import { getBeeSourceUrl } from "@/src/lib/beeChat";
import { BeeAction } from "./BeeMemories";
import { AiEstimateBadge } from "./AiEstimateBadge";
import { BeeGuide } from "./BeeGuide";

export type AiFoodSaveOpts = { toMyFoods: boolean; log: boolean };

type Props = {
  visible: boolean;
  food: AiFood | null;
  alternatives?: AiFood[];
  onSelectAlternative?: (alt: AiFood) => void;
  onFindMore?: () => Promise<void>;
  onClose: () => void;
  onSave: (edited: AiFood, opts: AiFoodSaveOpts) => Promise<void>;
};

const CONFIDENCE_COLOR: Record<AiFood["confidence"], string> = {
  high: Colors.success,
  medium: Colors.accent,
  low: Colors.error,
};

/**
 * Review-before-commit sheet for an independently matched food. The user chooses to log it, save it
 * to My Foods, or both — nothing is persisted until they confirm.
 */
export function AiFoodSheet({
  visible, food, alternatives = [], onSelectAlternative, onFindMore, onClose, onSave,
}: Props) {
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [saving, setSaving] = useState(false);
  const [findingMore, setFindingMore] = useState(false);
  const [sourceError, setSourceError] = useState(false);

  // Re-seed the editable fields whenever a new proposal arrives.
  useEffect(() => {
    if (!food) return;
    setName(food.name);
    setKcal(String(food.kcal));
    setProtein(String(food.protein));
    setCarbs(String(food.carbs));
    setFat(String(food.fat));
    setSourceError(false);
  }, [food]);

  if (!food || !isLoggableAiFood(food)) return null;
  const validNumbers = [kcal, protein, carbs, fat].every((value) => value.trim() && Number.isFinite(Number(value)) && Number(value) >= 0);
  const reviewed = buildAiFoodReview(food, {
    name: name.trim() || food.name,
    kcal: Number(kcal) || 0,
    protein: Number(protein) || 0,
    carbs: Number(carbs) || 0,
    fat: Number(fat) || 0,
  });
  const sourceUrl = getBeeSourceUrl(reviewed.evidence?.url ?? "");

  const handle = async (opts: AiFoodSaveOpts) => {
    if (saving || findingMore || !validNumbers) return;
    setSaving(true);
    try {
      await onSave(reviewed, opts);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={saving || findingMore ? undefined : onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <BeeGuide
              compact
              interactive={!findingMore && !saving}
              situation={findingMore ? "searching" : "reviewingMatch"}
              title="Review before saving"
              message={reviewed.user_entered ? "These are values you entered for the reviewed serving. Check them before saving." : "I found a draft for this serving. Check the numbers, then choose where it goes."}
              style={styles.beeHeader}
              footer={
                <>
                  <View style={styles.provenanceRow}>
                    {reviewed.user_entered ? <Text style={styles.sourceDetail}>User-entered values</Text> : <AiEstimateBadge source={reviewed.source} compact />}
                    <Text style={[styles.confidence, { color: CONFIDENCE_COLOR[reviewed.confidence] }]}>
                      {reviewed.confidence} confidence
                    </Text>
                  </View>
                  {reviewed.source_detail ? (
                    <Text style={styles.sourceDetail}>
                      matched: {reviewed.source_detail}
                    </Text>
                  ) : null}
                  {reviewed.evidence ? (
                    <>
                      {sourceUrl ? <BeeAction label={reviewed.evidence.title || "View nutrition source"} role="link" onPress={() => void Linking.openURL(sourceUrl).then(() => setSourceError(false)).catch(() => setSourceError(true))} /> : <Text style={styles.sourceDetail}>{reviewed.evidence.title}</Text>}
                      {reviewed.evidence.attribution ? <Text style={styles.sourceDetail}>{reviewed.evidence.attribution}{reviewed.evidence.license ? ` · ${reviewed.evidence.license}` : ""}</Text> : null}
                      {reviewed.evidence.basis.grams !== null ? <Text style={styles.sourceDetail}>{reviewed.serving_grams} g ÷ {reviewed.evidence.basis.grams} g × {reviewed.evidence.basis.nutrients.calories} kcal = {reviewed.kcal} kcal</Text> : null}
                      {sourceError ? <Text accessibilityLiveRegion="polite" style={styles.sourceDetail}>Couldn’t open the nutrition source. Try again.</Text> : null}
                    </>
                  ) : null}
                </>
              }
            />

            <Text style={styles.label}>Name</Text>
            <TextInput accessibilityLabel="Reviewed food name" style={styles.input} value={name} onChangeText={setName} placeholder="Food name"
              placeholderTextColor={Colors.textMuted} />

            <Text style={styles.label}>Serving</Text>
            <Text selectable accessibilityLabel="Reviewed serving" style={styles.input}>{food.serving_label}</Text>
            <Text style={styles.sourceDetail}>To change the amount, close this review and ask Bee with the new portion.</Text>

            <View style={styles.macroRow}>
              <Field label="Calories" color={Colors.accent} value={kcal} onChange={setKcal} />
              <Field label="Protein" color={Colors.protein} value={protein} onChange={setProtein} />
            </View>
            <View style={styles.macroRow}>
              <Field label="Carbs" color={Colors.carbs} value={carbs} onChange={setCarbs} />
              <Field label="Fat" color={Colors.fat} value={fat} onChange={setFat} />
            </View>

            {reviewed.notes ? <Text style={styles.notes}>{reviewed.notes}</Text> : null}

            {alternatives.length > 0 && onSelectAlternative ? (
              <View style={styles.altSection}>
                <Text style={styles.altTitle}>Other matches</Text>
                {alternatives.map((alt) => (
                  <Pressable
                    key={`${alt.source}-${alt.name}`}
                    style={styles.altRow}
                    disabled={saving || findingMore}
                    onPress={() => onSelectAlternative(alt)}
                  >
                    <View style={styles.altInfo}>
                      <Text style={styles.altName} numberOfLines={1}>{alt.name}</Text>
                      <Text style={styles.altMacros}>
                        {alt.kcal} kcal · P{alt.protein} C{alt.carbs} F{alt.fat}
                      </Text>
                    </View>
                    <AiEstimateBadge source={alt.source} compact />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {onFindMore ? (
              <Pressable
                style={[styles.btn, styles.btnFindMore]}
                disabled={saving || findingMore}
                onPress={async () => {
                  setFindingMore(true);
                  try {
                    await onFindMore();
                  } finally {
                    setFindingMore(false);
                  }
                }}
              >
                {findingMore ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <Text style={styles.btnFindMoreText}>
                    Search the web for more detail
                  </Text>
                )}
              </Pressable>
            ) : null}

            {!validNumbers ? <Text accessibilityLiveRegion="polite" style={styles.notes}>Enter a finite number of zero or more in every nutrition field.</Text> : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.btnSecondary]}
                disabled={saving || findingMore || !validNumbers}
                onPress={() => handle({ toMyFoods: true, log: false })}
              >
                <Text style={styles.btnSecondaryText}>Save to My Foods</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                disabled={saving || findingMore || !validNumbers}
                onPress={() => handle({ toMyFoods: false, log: true })}
              >
                {saving ? (
                  <ActivityIndicator color={Colors.textOnAccent} />
                ) : (
                  <Text style={styles.btnPrimaryText}>Log it</Text>
                )}
              </Pressable>
            </View>

            <Pressable
              style={[styles.btn, styles.btnCombined]}
              disabled={saving || findingMore || !validNumbers}
              onPress={() => handle({ toMyFoods: true, log: true })}
            >
              <Text style={styles.btnCombinedText}>Save + Log</Text>
            </Pressable>

            <Pressable style={styles.cancel} disabled={saving || findingMore} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({
  label, color, value, onChange,
}: { label: string; color: string; value: string; onChange: (t: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color }]}>{label}</Text>
      <TextInput
        accessibilityLabel={`Reviewed ${label.toLowerCase()}`}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={Colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    backgroundColor: Colors.secondary,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: "88%",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  beeHeader: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  provenanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  confidence: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  label: { color: Colors.textSecondary, fontSize: 11, fontWeight: "700", marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: Colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: "600",
  },
  macroRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  field: { flex: 1 },
  fieldLabel: { fontSize: 11, fontWeight: "800", marginBottom: 6, marginTop: 10, textTransform: "uppercase" },
  notes: { color: Colors.textMuted, fontSize: 12, marginTop: 14, fontStyle: "italic" },
  sourceDetail: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 8 },
  altSection: { marginTop: 18 },
  altTitle: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: "800",
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8,
  },
  altRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8,
  },
  altInfo: { flex: 1, minWidth: 0 },
  altName: { color: Colors.text, fontSize: 13, fontWeight: "800" },
  altMacros: { color: Colors.textSecondary, fontSize: 11, fontWeight: "700", marginTop: 2 },
  btnFindMore: {
    marginTop: 14, backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  btnFindMoreText: { color: Colors.accent, fontWeight: "800", fontSize: 13 },
  actions: { flexDirection: "row", gap: 12, marginTop: 22 },
  btn: { flex: 1, borderRadius: 16, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  btnPrimary: { backgroundColor: Colors.accent },
  btnPrimaryText: { color: Colors.textOnAccent, fontWeight: "900", fontSize: 15 },
  btnSecondary: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  btnSecondaryText: { color: Colors.text, fontWeight: "800", fontSize: 14 },
  btnCombined: {
    marginTop: 12,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: "rgba(255, 204, 0, 0.25)",
  },
  btnCombinedText: { color: Colors.accent, fontWeight: "900", fontSize: 15 },
  cancel: { alignItems: "center", paddingVertical: 16 },
  cancelText: { color: Colors.textMuted, fontWeight: "700", fontSize: 14 },
});
