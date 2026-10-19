import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { BeeAction } from "./BeeMemories";
import { createLabelReader } from "@/src/lib/labelReader";
import { createBeeRequestId, getBeeErrorFeedback } from "@/src/lib/beeChat";
import {
  type LabelExtraction,
  labelReviewMessage,
  parseLabelExtraction,
  stripLabelMetadata,
  validateLabelImage,
} from "../../../supabase/functions/_shared/nutritionLabel";
import { Colors, Radii } from "@/src/styles/colors";
type Props = {
  userId: string;
  disabled: boolean;
  onReview(text: string): Promise<boolean>;
  onClose(): void;
};
const empty: LabelExtraction = {
  foodName: null,
  basis: null,
  servingGrams: null,
  servingDescription: null,
  energy: null,
  energyUnit: null,
  protein: null,
  carbs: null,
  fat: null,
  warnings: [],
};
export function BeeLabelPhoto({ userId, disabled, onReview, onClose }: Props) {
  const [photo, setPhoto] = useState<{ uri: string; data: string } | null>(
    null,
  );
  const [label, setLabel] = useState<LabelExtraction | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<"g" | "serving">("serving");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readAgain, setReadAgain] = useState(false);
  const reader = useRef<ReturnType<typeof createLabelReader> | null>(null);
  const mounted = useRef(true);
  const operation = useRef(false);
  const readId = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    reader.current = createLabelReader(userId);
    return () => {
      mounted.current = false;
      reader.current?.dispose();
    };
  }, [userId]);
  const blocked = disabled || busy;
  const pick = async (camera: boolean) => {
    if (operation.current || disabled) return;
    operation.current = true;
    setError(null);
    try {
      if (camera && Platform.OS !== "web") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          throw new Error(
            "Camera access is off. Allow it in device settings, or choose a photo.",
          );
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        allowsMultipleSelection: false,
        exif: false,
        quality: 0.9,
      };
      const result = await (camera
        ? ImagePicker.launchCameraAsync(options)
        : ImagePicker.launchImageLibraryAsync(options));
      if (result.canceled || !mounted.current) {
        return;
      }
      setBusy(true);
      const asset = result.assets[0];
      if (
        !asset.width || !asset.height ||
        asset.width * asset.height > 60_000_000 ||
        (asset.fileSize ?? 0) > 20_000_000
      ) {
        throw new Error("Choose a smaller, clear photo of the label.");
      }
      const actions = asset.width >= asset.height
        ? [{ resize: { width: Math.min(1600, asset.width) } }]
        : [{ resize: { height: Math.min(1600, asset.height) } }];
      const resized = await ImageManipulator.manipulateAsync(
        asset.uri,
        actions,
        {
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.85,
          base64: true,
        },
      );
      const data = stripLabelMetadata(
        `data:image/jpeg;base64,${resized.base64 ?? ""}`,
      );
      validateLabelImage(data);
      if (mounted.current) {
        setPhoto({ uri: resized.uri, data });
        setLabel(null);
        readId.current = null;
        setReadAgain(false);
      }
    } catch (e) {
      if (mounted.current) {
        setError(
          e instanceof Error && e.message.includes("Camera access")
            ? e.message
            : "Could not prepare that photo. Choose a clear label image under 2 MB after resizing.",
        );
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const extract = async () => {
    if (!photo || operation.current || disabled) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    // A new paid attempt requires this explicit press; offline/busy retain the key.
    const id = readAgain
      ? createBeeRequestId()
      : readId.current ?? createBeeRequestId();
    readId.current = id;
    setReadAgain(false);
    try {
      const result = await reader.current?.read(id, photo.data);
      if (!mounted.current || !result) return;
      if (!result.ok) {
        if (result.error === "provider_unavailable") {
          setReadAgain(true);
          setError(
            "Could not read this label. Read again starts a new AI request and uses your allowance. You can also enter the label manually.",
          );
        } else setError(getBeeErrorFeedback(result.error).message);
        return;
      }
      setLabel(result.label);
      setFields(
        Object.fromEntries(
          ["foodName", "servingGrams", "energy", "protein", "carbs", "fat"].map(
            (k) => [k, String(result.label[k as keyof LabelExtraction] ?? "")],
          ),
        ),
      );
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const reviewed = (): LabelExtraction =>
    parseLabelExtraction({
      ...label,
      foodName: fields.foodName || null,
      ...Object.fromEntries(
        ["servingGrams", "energy", "protein", "carbs", "fat"].map(
          (k) => [k, fields[k]?.trim() ? Number(fields[k]) : null],
        ),
      ),
    });
  const review = async () => {
    if (blocked) return;
    setError(null);
    try {
      const message = labelReviewMessage(reviewed(), Number(amount), unit);
      setBusy(true);
      if (await onReview(message)) onClose();
    } catch {
      setError(
        "Check the food name, nutrition basis, energy unit, calories and all three macros. Fill missing values from your label; do not guess. Grams need a known serving weight.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const field = (key: string, title: string) => (
    <View key={key} style={styles.field}>
      <Text style={styles.help}>{title}</Text>
      <TextInput
        accessibilityLabel={title}
        value={fields[key] ?? ""}
        maxLength={key === "foodName" ? 160 : 12}
        keyboardType={key === "foodName" ? "default" : "decimal-pad"}
        editable={!blocked}
        onChangeText={(v) =>
          setFields((f) => ({ ...f, [key]: v }))}
        style={styles.input}
        placeholder={key === "foodName" ? "Name on your package" : "Unknown"}
        placeholderTextColor={Colors.textSecondary}
      />
    </View>
  );
  return (
    <View style={styles.panel} testID="bee-label-panel">
      <Text accessibilityRole="header" style={styles.title}>
        Read a nutrition label
      </Text>
      <Text style={styles.help}>
        Photograph the nutrition facts, including the serving size. Crop out
        personal details. Only this photo is sent to DeepSeek when you tap Read
        label; TrackBing does not store the photo.
      </Text>
      <View style={styles.actions}>
        <BeeAction
          label="Take label photo"
          disabled={blocked}
          onPress={() => void pick(true)}
        />
        <BeeAction
          label="Choose label photo"
          disabled={blocked}
          onPress={() => void pick(false)}
        />
      </View>
      {photo
        ? (
          <Image
            source={{ uri: photo.uri }}
            accessibilityLabel="Your selected nutrition label"
            style={styles.preview}
            resizeMode="contain"
          />
        )
        : null}
      {photo && !label
        ? (
          <BeeAction
            label={readAgain ? "Read label again" : "Read label"}
            primary
            disabled={blocked}
            onPress={() => void extract()}
          />
        )
        : null}
      {busy
        ? (
          <View style={styles.actions} accessibilityLiveRegion="polite">
            <ActivityIndicator color={Colors.accent} />
            <Text style={styles.help}>Reading your label…</Text>
          </View>
        )
        : null}
      {label
        ? (
          <>
            <Text style={styles.help}>
              AI transcription can be wrong. Compare every value with your
              package. Missing values stay unknown.
            </Text>
            {label.warnings.map((warning, i) => (
              <Text key={i} style={styles.help}>{warning}</Text>
            ))}
            {field("foodName", "Food name")}
            <Text style={styles.help}>All numbers below use one column:</Text>
            <View style={styles.actions}>
              {(["per_serving", "per_100g"] as const).map((b) => (
                <BeeAction
                  key={b}
                  label={b === "per_100g" ? "Per 100 g" : "Per labeled serving"}
                  primary={label.basis === b}
                  disabled={blocked}
                  onPress={() => setLabel((l) => ({ ...l ?? empty, basis: b }))}
                />
              ))}
            </View>
            {label.servingDescription
              ? (
                <Text style={styles.help}>
                  Printed serving: {label.servingDescription}
                </Text>
              )
              : null}
            {label.basis === "per_serving"
              ? field("servingGrams", "Serving weight (g, if printed)")
              : null}
            {field("energy", "Energy on label")}
            <View style={styles.actions}>
              {(["kcal", "kJ"] as const).map((u) => (
                <BeeAction
                  key={u}
                  label={u}
                  primary={label.energyUnit === u}
                  disabled={blocked}
                  onPress={() =>
                    setLabel((l) => ({ ...l ?? empty, energyUnit: u }))}
                />
              ))}
            </View>
            <View style={styles.grid}>
              {field("protein", "Protein (g)")}
              {field("carbs", "Carbohydrates (g)")}
              {field("fat", "Total fat (g)")}
            </View>
            <Text style={styles.help}>Portion to review</Text>
            <TextInput
              accessibilityLabel="Portion to review"
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              editable={!blocked}
              maxLength={12}
              style={styles.input}
            />
            <View style={styles.actions}>
              <BeeAction
                label="Grams"
                primary={unit === "g"}
                disabled={blocked}
                onPress={() => setUnit("g")}
              />
              <BeeAction
                label={label.basis === "per_100g"
                  ? "100 g portions"
                  : "Labeled servings"}
                primary={unit === "serving"}
                disabled={blocked}
                onPress={() => setUnit("serving")}
              />
            </View>
            <BeeAction
              label="Review food"
              primary
              disabled={blocked}
              onPress={() => void review()}
            />
            <Text style={styles.help}>
              Nothing is logged yet. The next card shows the exact portion
              before Add to today.
            </Text>
          </>
        )
        : null}
      {error
        ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
        : null}
      <BeeAction label="Close label reader" disabled={busy} onPress={onClose} />
    </View>
  );
}
const styles = StyleSheet.create({
  panel: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.card,
    backgroundColor: Colors.surface,
  },
  title: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  help: { color: Colors.textSecondary, fontSize: 13, lineHeight: 20 },
  actions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  preview: { width: "100%", height: 160 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  field: { flexGrow: 1, minWidth: 100, gap: 4 },
  input: {
    color: Colors.text,
    backgroundColor: Colors.inputBg,
    borderWidth: 1,
    borderColor: Colors.controlBorder,
    borderRadius: 8,
    padding: 12,
    minHeight: 44,
    fontSize: 16,
  },
  error: { color: Colors.error, fontSize: 13, lineHeight: 20 },
});
