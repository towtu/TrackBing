import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Colors } from "@/src/styles/colors";
import type { AiFood } from "@/src/lib/aiFood";
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
 * Review-before-commit sheet for an AI-proposed food. Every field is editable;
 * the "AI estimate" badge is always shown. The user chooses to log it, save it
 * to My Foods, or both — nothing is persisted until they confirm.
 */
export function AiFoodSheet({
  visible, food, alternatives = [], onSelectAlternative, onFindMore, onClose, onSave,
}: Props) {
  const [name, setName] = useState("");
  const [serving, setServing] = useState("");
  const [kcal, setKcal] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");
  const [saving, setSaving] = useState(false);
  const [findingMore, setFindingMore] = useState(false);

  // Re-seed the editable fields whenever a new proposal arrives.
  useEffect(() => {
    if (!food) return;
    setName(food.name);
    setServing(food.serving_label);
    setKcal(String(food.kcal));
    setProtein(String(food.protein));
    setCarbs(String(food.carbs));
    setFat(String(food.fat));
  }, [food]);

  if (!food) return null;

  const edited = (): AiFood => ({
    ...food,
    name: name.trim() || food.name,
    serving_label: serving.trim() || food.serving_label,
    kcal: Number(kcal) || 0,
    protein: Number(protein) || 0,
    carbs: Number(carbs) || 0,
    fat: Number(fat) || 0,
  });

  const handle = async (opts: AiFoodSaveOpts) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(edited(), opts);
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
              interactive
              situation={findingMore ? "searching" : "reviewingMatch"}
              title="Review before saving"
              message="I found a draft for this serving. Check the numbers, then choose where it goes."
              style={styles.beeHeader}
              footer={
                <>
                  <View style={styles.provenanceRow}>
                    <AiEstimateBadge source={food.source} compact />
                    <Text style={[styles.confidence, { color: CONFIDENCE_COLOR[food.confidence] }]}>
                      {food.confidence} confidence
                    </Text>
                  </View>
                  {food.source_detail ? (
                    <Text style={styles.sourceDetail}>
                      {food.source === "web" ? "from " : "matched: "}
                      {food.source_detail}
                    </Text>
                  ) : null}
                </>
              }
            />

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Food name"
              placeholderTextColor={Colors.textMuted} />

            <Text style={styles.label}>Serving</Text>
            <TextInput style={styles.input} value={serving} onChangeText={setServing}
              placeholder="1 serving" placeholderTextColor={Colors.textMuted} />

            <View style={styles.macroRow}>
              <Field label="Calories" color={Colors.accent} value={kcal} onChange={setKcal} />
              <Field label="Protein" color={Colors.protein} value={protein} onChange={setProtein} />
            </View>
            <View style={styles.macroRow}>
              <Field label="Carbs" color={Colors.carbs} value={carbs} onChange={setCarbs} />
              <Field label="Fat" color={Colors.fat} value={fat} onChange={setFat} />
            </View>

            {food.notes ? <Text style={styles.notes}>{food.notes}</Text> : null}

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
                    🔎 Not right? Find more on the web (1 AI use)
                  </Text>
                )}
              </Pressable>
            ) : null}

            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.btnSecondary]}
                disabled={saving || findingMore}
                onPress={() => handle({ toMyFoods: true, log: false })}
              >
                <Text style={styles.btnSecondaryText}>Save to My Foods</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnPrimary]}
                disabled={saving || findingMore}
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
              disabled={saving}
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
