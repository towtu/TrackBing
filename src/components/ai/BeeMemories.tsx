import React, { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import type { BeeCommand, BeeMemory, MemoryKey } from "@/src/lib/beeChat";
import { Colors, Radii } from "@/src/styles/colors";

const PREFERENCES: { key: MemoryKey; label: string; hint: string; maxLength: number }[] = [
  { key: "preferred_name", label: "Name", hint: "What Bee should call you", maxLength: 60 },
  { key: "preferred_units", label: "Weight units", hint: "Your preferred way to enter portions", maxLength: 10 },
  { key: "usual_product", label: "Usual product", hint: "A product and variant you often eat", maxLength: 120 },
  { key: "usual_preparation", label: "Usual preparation", hint: "For example, you measure rice cooked", maxLength: 120 },
];

export function BeeMemories({
  memories,
  busy,
  onCommand,
  onProfile,
}: {
  memories: BeeMemory[];
  busy: boolean;
  onCommand: (command: BeeCommand) => Promise<boolean>;
  onProfile: () => void;
}) {
  const [editing, setEditing] = useState<MemoryKey | null>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [clearing, setClearing] = useState(false);

  const save = async (key: MemoryKey) => {
    if (!value.trim() || busy) return;
    if (key === "preferred_units" && !["grams", "ounces"].includes(value)) return;
    if (await onCommand({ kind: "memory_set", key, value: value.trim() })) setEditing(null);
  };

  return (
    <View style={styles.preferences}>
      <Text accessibilityRole="header" style={styles.heading}>Saved preferences</Text>
      <Text style={styles.body}>
        Bee remembers details you explicitly ask to keep. Editing or deleting one here updates future replies.
      </Text>
      {PREFERENCES.map((preference) => {
        const memory = memories.find((item) => item.key === preference.key);
        const isEditing = editing === preference.key;
        return (
          <View key={preference.key} style={styles.preference}>
            <Text style={styles.label}>{preference.label}</Text>
            {isEditing ? (
              <>
                <Text style={styles.body}>{preference.hint}</Text>
                {preference.key === "preferred_units" ? (
                  <View style={styles.actions}>
                    {(["grams", "ounces"] as const).map((unit) => (
                      <BeeAction
                        key={unit}
                        label={unit === "grams" ? "Grams" : "Ounces"}
                        accessibilityLabel={`${unit === "grams" ? "Grams" : "Ounces"}${value === unit ? ", selected" : ""}`}
                        primary={value === unit}
                        disabled={busy}
                        onPress={() => setValue(unit)}
                      />
                    ))}
                  </View>
                ) : (
                  <TextInput
                    accessibilityLabel={`Saved ${preference.label.toLowerCase()}`}
                    accessibilityHint={preference.hint}
                    autoFocus
                    value={value}
                    maxLength={preference.maxLength}
                    onChangeText={setValue}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    editable={!busy}
                    returnKeyType="done"
                    onSubmitEditing={() => void save(preference.key)}
                    style={[styles.input, focused && styles.focused]}
                    placeholder={preference.hint}
                    placeholderTextColor={Colors.textSecondary}
                  />
                )}
                <View style={styles.actions}>
                  <BeeAction label="Save preference" primary disabled={busy || !value.trim()} onPress={() => void save(preference.key)} />
                  <BeeAction label="Cancel edit" disabled={busy} onPress={() => setEditing(null)} />
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.value, !memory && styles.body]}>{memory?.value ?? "Not saved"}</Text>
                <View style={styles.actions}>
                  <BeeAction
                    label={memory ? "Edit" : "Add"}
                    accessibilityLabel={`${memory ? "Edit" : "Add"} saved ${preference.label.toLowerCase()}`}
                    disabled={busy || editing !== null}
                    onPress={() => {
                      setEditing(preference.key);
                      setValue(memory?.value ?? (preference.key === "preferred_units" ? "grams" : ""));
                    }}
                  />
                  {memory ? (
                    <BeeAction
                      label="Delete"
                      accessibilityLabel={`Delete saved ${preference.label.toLowerCase()}`}
                      disabled={busy || editing !== null}
                      onPress={() => void onCommand({ kind: "memory_delete", key: preference.key })}
                    />
                  ) : null}
                </View>
              </>
            )}
          </View>
        );
      })}
      <Text style={styles.body}>
        Your profile and nutrition targets are separate from these preferences. Clearing preferences leaves your diary and conversations in place.
      </Text>
      {clearing ? (
        <View style={styles.clearPreferences}>
          <Text style={styles.body}>Delete all saved preferences? Bee will ask for these details again when needed.</Text>
          <View style={styles.actions}>
            <BeeAction label="Delete all preferences" primary disabled={busy} onPress={() => void (async () => {
              if (await onCommand({ kind: "memory_clear" })) setClearing(false);
            })()} />
            <BeeAction label="Keep preferences" disabled={busy} onPress={() => setClearing(false)} />
          </View>
        </View>
      ) : (
        <BeeAction label="Clear all preferences" disabled={busy || editing !== null || memories.length === 0} onPress={() => setClearing(true)} />
      )}
      <BeeAction label="Open profile" onPress={onProfile} />
    </View>
  );
}

/** Shared Bee controls retain 44px touch targets and an explicit keyboard focus ring. */
export function BeeAction({
  label,
  accessibilityLabel = label,
  icon,
  iconOnly = false,
  primary = false,
  disabled = false,
  role = "button",
  onPress,
  style,
}: {
  label: string;
  accessibilityLabel?: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  primary?: boolean;
  disabled?: boolean;
  role?: "button" | "link";
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.button,
        primary && styles.primaryButton,
        iconOnly && styles.iconButton,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        focused && styles.focused,
        style,
      ]}
    >
      {icon}
      {!iconOnly ? <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preferences: { gap: 10, paddingTop: 8, paddingBottom: 18 },
  heading: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  preference: { gap: 8, paddingVertical: 14, borderBottomColor: Colors.border, borderBottomWidth: 1 },
  label: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  value: { color: Colors.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: {
    minHeight: 48, paddingHorizontal: 12, color: Colors.text, fontSize: 14,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radii.inner, backgroundColor: Colors.inputBg,
  },
  clearPreferences: { gap: 10, paddingVertical: 8 },
  button: {
    minHeight: 44, minWidth: 44, paddingHorizontal: 12, paddingVertical: 9, gap: 6,
    flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1,
    borderColor: Colors.border, borderRadius: Radii.inner, backgroundColor: Colors.surface,
  },
  primaryButton: { borderColor: Colors.accent, backgroundColor: Colors.accent },
  primaryText: { color: Colors.textOnAccent },
  buttonText: { color: Colors.text, fontSize: 12, lineHeight: 17, fontWeight: "700", flexShrink: 1 },
  iconButton: { width: 44, paddingHorizontal: 0 },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  focused: { borderColor: Colors.accent, outlineColor: Colors.accent, outlineWidth: 2, outlineOffset: 2 },
});
